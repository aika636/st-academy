import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildPlanPrompt, parsePlanResponse, validatePlan, slugify, extractJson, balancedBlock,
} from '../core/plan-gen.mjs';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));

const survey = {
  era: 'современность',
  country: 'Россия',
  institution: 'вуз',
  faculty: 'химический факультет',
  year: '2-й',
  lang: 'ru',
};

/** План из n предметов, каждый со своим преподавателем. */
const bigPlan = (n) => ({
  subjects: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: `Предмет ${i}`, teacherId: `t${i}` })),
  teachers: Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: `Педагог ${i}`, traits: ['строг'] })),
});

// --- промпт -----------------------------------------------------------------

test('промпт собирается из анкеты и потолков пресета', () => {
  const { system, prompt } = buildPlanPrompt(survey, preset);
  assert.ok(system.length > 0);
  for (const value of Object.values(survey)) assert.ok(prompt.includes(value), `в промпте нет «${value}»`);
  assert.ok(prompt.includes(String(preset.limits.maxSubjects)), 'не сказан потолок предметов');
  assert.ok(prompt.includes(String(preset.limits.maxTeachers)));
  assert.ok(/json/i.test(system), 'не потребован строгий JSON');
  // Ни одного неподставленного плейсхолдера (фигурные скобки JSON-образца — не они).
  assert.equal(/\{[a-zA-Z]\w*\}/.test(prompt), false, prompt);
});

test('шаблон промпта перекрывается пресетом', () => {
  const custom = { ...preset, prompts: { plan: { system: 'S', user: 'PLAN {faculty} <= {maxSubjects}' } } };
  assert.deepEqual(buildPlanPrompt(survey, custom), { system: 'S', prompt: 'PLAN химический факультет <= 8' });
});

// --- выковыривание JSON -----------------------------------------------------

const goodJson = `{
  "subjects": [
    {"id": "chemistry", "name": "аналитическая химия", "teacherId": "petrova"},
    {"id": "physics", "name": "физика", "teacherId": "ivanov"}
  ],
  "teachers": [
    {"id": "petrova", "name": "Петрова Анна Сергеевна", "traits": ["злопамятна"]},
    {"id": "ivanov", "name": "Иванов Пётр Ильич", "traits": ["добродушен", "рассеян"]}
  ]
}`;

test('JSON выковыривается из markdown-заборчика', () => {
  const res = parsePlanResponse('Конечно! Вот план:\n\n```json\n' + goodJson + '\n```\nГотово.', preset);
  assert.equal(res.ok, true);
  assert.deepEqual(res.errors, []);
  assert.deepEqual(res.plan.subjects.map((s) => s.id), ['chemistry', 'physics']);
  assert.deepEqual(res.plan.teachers.map((t) => t.name), ['Петрова Анна Сергеевна', 'Иванов Пётр Ильич']);
});

test('JSON выковыривается из болтовни вокруг, без заборчика', () => {
  const res = parsePlanResponse(`Разумеется. ${goodJson}\n\nЕсли нужно больше предметов — скажите.`, preset);
  assert.equal(res.ok, true);
  assert.equal(res.plan.subjects.length, 2);
});

test('одинарные кавычки, висячие запятые и «ёлочки» чинятся', () => {
  const dirty = "{'subjects': [{'id': 'math', 'name': «высшая математика», 'teacherId': 'sidorov',},],"
    + " 'teachers': [{'id': 'sidorov', 'name': 'Сидоров', 'traits': ['язвителен',]},]}";
  const res = parsePlanResponse(dirty, preset);
  assert.equal(res.ok, true);
  assert.deepEqual(res.plan.subjects[0], { id: 'math', name: 'высшая математика', teacherId: 'sidorov', grades: [], debt: false });
});

test('лишние поля и чужая обёртка не мешают', () => {
  const text = JSON.stringify({
    explanation: 'вот план',
    plan: {
      subjects: [{ id: 'chemistry', name: 'химия', teacherId: 'petrova', hours: 72, semester: 3 }],
      teachers: [{ id: 'petrova', name: 'Петрова', traits: ['злопамятна'], age: 44 }],
    },
  });
  const res = parsePlanResponse(text, preset);
  assert.equal(res.ok, true);
  assert.deepEqual(Object.keys(res.plan.subjects[0]).sort(), ['debt', 'grades', 'id', 'name', 'teacherId']);
  assert.deepEqual(Object.keys(res.plan.teachers[0]).sort(), ['id', 'name', 'traits']);
});

test('преподаватель внутри предмета вытаскивается наверх', () => {
  const text = '[{"name": "Зельеварение", "teacher": {"name": "Северус Снейп", "traits": "злопамятен, придирчив"}}]';
  const res = parsePlanResponse(text, preset);
  assert.equal(res.ok, true);
  assert.equal(res.plan.subjects[0].name, 'Зельеварение');
  assert.equal(res.plan.teachers.length, 1);
  assert.equal(res.plan.subjects[0].teacherId, res.plan.teachers[0].id);
  assert.deepEqual(res.plan.teachers[0].traits, ['злопамятен', 'придирчив']);
  // Идентификатор короткий и латинский — поправка 1 замера B.
  assert.match(res.plan.subjects[0].id, /^[a-z0-9-]+$/);
});

test('не-JSON честно возвращает ok:false и то, что пришло', () => {
  const text = 'Извините, я не могу составить учебный план.';
  const res = parsePlanResponse(text, preset);
  assert.equal(res.ok, false);
  assert.equal(res.raw, text);
  assert.deepEqual(res.plan, { subjects: [], teachers: [] });
  assert.ok(res.errors.length > 0);
});

test('обрезанный ответ не роняет разбор', () => {
  const res = parsePlanResponse('```json\n{"subjects": [{"id": "chemistry", "name": "хим', preset);
  assert.equal(res.ok, false);
  assert.ok(res.raw.includes('chemistry'));
});

test('балансировщик знает про строки и скобки внутри них', () => {
  assert.equal(balancedBlock('шум {"a": "}{"} хвост'), '{"a": "}{"}');
  assert.equal(extractJson('совсем не json'), undefined);
});

// --- схема ------------------------------------------------------------------

test('двадцать предметов — обрезка до потолка с записью в errors, а не отказ', () => {
  const res = parsePlanResponse(JSON.stringify(bigPlan(20)), preset);
  assert.equal(res.ok, true, 'обрезка не должна выглядеть как «всё пропало»');
  assert.equal(res.plan.subjects.length, preset.limits.maxSubjects);
  assert.equal(res.plan.teachers.length, preset.limits.planTeachers, 'генерация режет до своего потолка');
  assert.ok(res.errors.some((e) => e.startsWith('too-many-subjects')));
  assert.ok(res.errors.some((e) => e.startsWith('too-many-teachers')));
});

test('пустое название и повторяющийся id отбраковываются', () => {
  const { ok, plan, errors } = validatePlan({
    subjects: [
      { id: 'chemistry', name: 'химия', teacherId: 'petrova' },
      { id: 'physics', name: '   ', teacherId: 'petrova' },
      { id: 'chemistry', name: 'химия ещё раз', teacherId: 'petrova' },
    ],
    teachers: [{ id: 'petrova', name: 'Петрова', traits: ['злопамятна'] }],
  }, preset);

  assert.equal(ok, true);
  assert.deepEqual(plan.subjects.map((s) => s.name), ['химия']);
  assert.ok(errors.some((e) => e.startsWith('subject-empty-name')));
  assert.ok(errors.some((e) => e === 'subject-duplicate-id:chemistry'));
});

test('преподаватель без имени и дубль преподавателя тоже отбраковываются', () => {
  const { plan, errors } = validatePlan({
    subjects: [{ id: 'chemistry', name: 'химия', teacherId: 'ghost' }],
    teachers: [
      { id: 'petrova', name: 'Петрова', traits: ['злопамятна'] },
      { id: 'petrova', name: 'Петрова-двойник', traits: ['добра'] },
      { id: 'ghost', name: '', traits: ['тиха'] },
    ],
  }, preset);

  assert.deepEqual(plan.teachers.map((t) => t.id), ['petrova']);
  assert.ok(errors.includes('teacher-duplicate-id:petrova'));
  assert.ok(errors.some((e) => e.startsWith('teacher-empty-name')));
  // Ссылка на выброшенного преподавателя гасится, предмет остаётся редактируемым.
  assert.equal(plan.subjects[0].teacherId, null);
  assert.ok(errors.includes('subject-unknown-teacher:chemistry'));
  assert.ok(errors.includes('subject-no-teacher:chemistry'));
});

test('черт у преподавателя одна-две: лишние обрезаются, ноль — претензия', () => {
  const { plan, errors } = validatePlan({
    subjects: [{ id: 'chemistry', name: 'химия', teacherId: 'petrova' }],
    teachers: [
      { id: 'petrova', name: 'Петрова', traits: ['злопамятна', 'придирчива', 'громкая', 'курит'] },
      { id: 'ivanov', name: 'Иванов', traits: [] },
    ],
  }, preset);

  assert.equal(plan.teachers[0].traits.length, 2);
  assert.ok(errors.includes('teacher-too-many-traits:petrova'));
  assert.ok(errors.includes('teacher-no-traits:ivanov'));
});

test('ни одного годного предмета — вот это и есть ok:false', () => {
  const { ok } = validatePlan({ subjects: [{ id: '', name: '' }], teachers: [] }, preset);
  assert.equal(ok, false);
});

// --- короткий латинский id --------------------------------------------------

test('slugify даёт короткий латинский id без пробелов', () => {
  assert.equal(slugify('Аналитическая химия'), 'analiticheskaya-himiya');
  assert.equal(slugify('Physics 101'), 'physics-101');
  assert.equal(slugify('  Защита  Отечества  '), 'zaschita-otechestva');
  assert.equal(slugify('Café Étude'), 'cafe-etude');
  for (const name of ['Аналитическая химия', 'История древнего мира', '魔法薬学', '', '???']) {
    const id = slugify(name);
    assert.match(id, /^[a-z0-9-]+$/, `id «${id}» не годится для метки grade=id:4`);
    assert.ok(id.length > 0 && id.length <= 24);
  }
  // Один и тот же вход даёт один и тот же id: он уезжает в состояние.
  assert.equal(slugify('Высшая математика'), slugify('Высшая математика'));
});

// --- учителя с душой --------------------------------------------------------

const PRESET_FILES = ['ru-university', 'magic-academy', 'jp-highschool'];
const readPreset = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));

test('во всех встроенных пресетах генерация зовёт не больше четырёх, таблица держит прежний потолок', () => {
  for (const id of PRESET_FILES) {
    const p = readPreset(id);
    assert.equal(p.limits.planTeachers, 4, id);
    assert.ok(p.limits.maxTeachers > 4, `${id}: потолок таблицы не урезан — старые семестры сохраняются`);
    const { prompt } = buildPlanPrompt(survey, p);
    // В промпт уходит потолок генерации, а не таблицы.
    assert.match(prompt, /не больше 4[:.]/, `${id}: ${prompt}`);
    assert.ok(!prompt.includes(`не больше ${p.limits.maxTeachers}:`), id);
    for (const key of ['"post"', '"likes"', '"secret"']) assert.ok(prompt.includes(key), `${id}: нет ${key} в образце`);
    assert.match(prompt, /от одно(го|й) до 3/, `${id}: не сказано «1–3 предмета»`);
    assert.equal(/\{[a-zA-Z]\w*\}/.test(prompt), false, prompt);
  }
  // Умолчание без пресета — тоже четыре и те же поля.
  const bare = buildPlanPrompt(survey, {}).prompt;
  assert.match(bare, /преподавателей не больше 4/);
  assert.ok(bare.includes('"secret"'));
});

test('потолок генерации не выше потолка таблицы', () => {
  const tight = { ...preset, limits: { ...preset.limits, maxTeachers: 2, planTeachers: 4 } };
  const res = validatePlan(bigPlan(6), tight);
  assert.equal(res.plan.teachers.length, 2);
  assert.match(buildPlanPrompt(survey, tight).prompt, /не больше 2:/);
});

test('должность, «любит» и тайна разбираются, режутся по длине; без них план не брак', () => {
  const raw = '```json\n' + JSON.stringify({
    subjects: [
      { id: 'necro', name: 'Некромантия', teacherId: 'veyl' },
      { id: 'herbs', name: 'Травы', teacherId: 'kass' },
    ],
    teachers: [
      {
        id: 'veyl', name: 'Магистр Вейл', traits: ['злопамятен'],
        post: '  директор  ', likes: 'белое вино и дорогие картины', secret: 'х'.repeat(300),
      },
      // Синонимы ключей, которые модель любит больше наших.
      { id: 'kass', name: 'Кассандра Палагея', traits: ['строга'], role: 'заведующая кафедрой', loves: ['травы', 'тишина'] },
    ],
  }) + '\n```';
  const res = parsePlanResponse(raw, preset);
  assert.equal(res.ok, true);
  const [veyl, kass] = res.plan.teachers;
  assert.equal(veyl.post, 'директор');
  assert.equal(veyl.likes, 'белое вино и дорогие картины');
  assert.equal(veyl.secret.length, 160, 'тайна обрезана до потолка');
  assert.equal(kass.post, 'заведующая кафедрой');
  assert.equal(kass.likes, 'травы, тишина');
  assert.equal('secret' in kass, false, 'нет тайны — нет ключа');
  assert.ok(!res.errors.some((e) => /post|likes|secret/.test(e)), res.errors.join(', '));

  // Старый формат без души — по-прежнему годный план без претензий к ней.
  const old = parsePlanResponse(JSON.stringify({
    subjects: [{ id: 'chem', name: 'Химия', teacherId: 'p' }],
    teachers: [{ id: 'p', name: 'Петрова', traits: ['строга'] }],
  }), preset);
  assert.equal(old.ok, true);
  assert.deepEqual(old.errors, []);
  assert.deepEqual(Object.keys(old.plan.teachers[0]).sort(), ['id', 'name', 'traits']);
});

test('больше трёх предметов на одного — замечание, а не брак', () => {
  const res = validatePlan({
    subjects: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: `Предмет ${id}`, teacherId: 'p' })),
    teachers: [{ id: 'p', name: 'Петрова', traits: ['строга'] }],
  }, preset);
  assert.equal(res.ok, true);
  assert.equal(res.plan.subjects.length, 4);
  assert.ok(res.errors.includes('teacher-many-subjects:p'), res.errors.join(', '));
});

test('день рождения в ответе плана молча отбрасывается и план не бракует', () => {
  const raw = JSON.stringify({
    subjects: [
      { id: 'chem', name: 'Химия', teacherId: 'petrova' },
      { id: 'phys', name: 'Физика', teacherId: 'ivanov' },
    ],
    teachers: [
      { id: 'petrova', name: 'Петрова Анна', traits: ['строга'], birthday: '8.3' },
      { id: 'ivanov', name: 'Иванов Пётр', traits: ['рассеян'], birthday: 'весной' },
    ],
  });
  const parsed = parsePlanResponse(raw);
  const v = validatePlan(parsed.plan, preset);
  assert.equal(v.ok, true);
  const byId = Object.fromEntries(v.plan.teachers.map((t) => [t.id, t]));
  assert.equal('birthday' in byId.petrova, false);
  assert.equal('birthday' in byId.ivanov, false);
  assert.ok(!v.errors.some((e) => /birthday/.test(e)), 'день рождения план не бракует');
  assert.doesNotMatch(buildPlanPrompt(survey, preset).prompt, /birthday/);
});

// test/classmates — курс героини как данные (раздел «Сейчас», шаг 2):
// нормализация и потолки, id из имени, слияние имён, стоп-лист, кандидаты,
// миграция схемы, отношение однокурсника, запись лорбука, роли в пресетах и
// вид части «Курс» на вкладке «Люди».

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import {
  normalizeClassmate, normalizeClassmates, sameName, findClassmate, classmateIdOf,
  addClassmate, updateClassmate, removeClassmate, addCandidate, listCandidates,
  confirmCandidate, dropCandidate, tieTarget, markerPeople, classmateSize, classmateSeeds,
  classmateLabels, CLASSMATE_TEXT_MAX, CLASSMATES_MAX, HEROINE, DEFAULT_SIZE,
} from '../core/classmates.mjs';
import { createState, migrate, validateState, cloneState, SCHEMA_VERSION } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { stopList } from '../core/stop-names.mjs';
import {
  changeRelation, relationOf, relationLabel, relationMemory, dampRepeats, findPerson,
} from '../core/relations.mjs';
import { applyResponse } from '../core/engine.mjs';
import { classmateEntry, buildEntries, buildLorebook, CLASSMATE_ENTRY_MAX, classmateUid } from '../core/lorebook.mjs';
import { normalizePreset, BUILTIN_PRESETS } from '../core/preset.mjs';
import { readState, buildExport, readExport } from '../storage.js';
import { classmatesView, peopleView, DEFAULT_UI, uiLabels } from '../ui.js';
import { parsePreset } from './preset-file.mjs';

const load = (f) => parsePreset(readFileSync(new URL(`../presets/${f}`, import.meta.url), 'utf8'));
const preset = load('ru-university.json');

const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }];
const SUBJECTS = [{ id: 'chemistry', name: 'химия', teacherId: 'petrova' }];

function semester(classmates = []) {
  const s = createState(preset, {
    startDay: '2024-09-02', subjects: SUBJECTS, teachers: TEACHERS,
    schedule: buildSchedule(SUBJECTS, preset), classmates,
  });
  s.started = true;
  return s;
}

const VERA = {
  name: 'Вера Соколова',
  desire: 'попасть в тройку лучших',
  tie: { to: HEROINE, what: 'соперничает за стипендию' },
  problem: 'висит долг по физике',
  club: 'театральный',
  seed: 'завистница',
};

const stop = stopList({ user: 'Алиса Воронова', char: 'Мира Ланская', preset, survey: { institution: 'Академия Звёздного Света' } });

// --- нормализация ----------------------------------------------------------------

test('нормализация: имя обязательно, поля режутся по потолку, пустых ключей нет', () => {
  assert.equal(normalizeClassmate({ desire: 'что-то' }, preset), null, 'без имени человека нет');
  const long = 'а'.repeat(500);
  const c = normalizeClassmate({ name: `  Вера   Соколова  `, desire: long, problem: long, club: '', tie: { to: '', what: '' } }, preset);
  assert.equal(c.name, 'Вера Соколова');
  assert.equal(c.desire.length, CLASSMATE_TEXT_MAX.desire);
  assert.equal(c.problem.length, CLASSMATE_TEXT_MAX.problem);
  assert.ok(!('club' in c), 'пустой кружок — без ключа');
  assert.ok(!('tie' in c), 'пустая связь — без ключа');
  assert.equal(c.relation, preset.relations.start, 'отношение — с начала шкалы');
  assert.equal(c.source, 'manual');
  assert.equal(c.locked, false);
  assert.match(c.id, /^[a-z0-9-]+$/, 'id латиницей из имени');
});

test('список: повторы id и безымянные выпадают, потолок держится', () => {
  const many = Array.from({ length: CLASSMATES_MAX + 5 }, (_, i) => ({ id: `p${i}`, name: `Человек ${i}` }));
  assert.equal(normalizeClassmates(many, preset).length, CLASSMATES_MAX);
  const list = normalizeClassmates([{ id: 'a', name: 'А' }, { id: 'a', name: 'Б' }, { name: '' }], preset);
  assert.deepEqual(list.map((c) => c.name), ['А']);
});

// --- имена ---------------------------------------------------------------------------

test('один человек: «Петрова», «Анна Петрова», «А. П.» и «ё» вместо «е»', () => {
  assert.ok(sameName('Петрова', 'Анна Петрова'));
  assert.ok(sameName('Анна Петрова', 'Петрова Анна'));
  assert.ok(sameName('А. П.', 'Анна Петрова'));
  assert.ok(sameName('Пётр Рябов', 'петр рябов'));
  assert.ok(!sameName('А.', 'Анна Петрова'), 'одинокий инициал — не человек');
  assert.ok(!sameName('Петрова', 'Петровская'));
  assert.ok(!sameName('Анна Петрова', 'Мария Петрова'));
});

test('id из имени: латиница, занятый — с номером; id преподавателя не отдаётся', () => {
  assert.equal(classmateIdOf('Вера Соколова'), 'vera-sokolova');
  assert.equal(classmateIdOf('Вера Соколова', ['vera-sokolova']), 'vera-sokolova-2');
  const s = semester();
  s.teachers.push({ id: 'oleg', name: 'Олег Ильич', traits: [], relation: 0 });
  const res = addClassmate(s, { name: 'Олег' }, preset);
  assert.ok(res.ok);
  assert.notEqual(res.id, 'oleg', 'у метки одно пространство id на всех людей');
  assert.ok(validateState(s, preset).ok, validateState(s, preset).errors.join('; '));
});

test('поиск: id, имя, часть имени — и только однозначно', () => {
  const s = semester([{ id: 'vera', name: 'Вера Соколова' }, { id: 'anna', name: 'Анна Петрова' }, { id: 'mila', name: 'Мила Петрова' }]);
  assert.equal(findClassmate(s, 'vera').name, 'Вера Соколова');
  assert.equal(findClassmate(s, 'Соколова').id, 'vera');
  assert.equal(findClassmate(s, 'В. С.').id, 'vera');
  assert.equal(findClassmate(s, 'Петрова'), null, 'две Петровы — никто');
  assert.equal(findClassmate(s, 'анна петрова').id, 'anna');
  assert.equal(findClassmate(s, ''), null);
});

// --- операции ------------------------------------------------------------------------

test('добавить: тот же человек не удваивается, героиня и заведение — в стоп-листе', () => {
  const s = semester();
  const a = addClassmate(s, VERA, preset, { stop });
  assert.ok(a.ok);
  const c = findClassmate(s, a.id);
  assert.equal(c.seed, 'завистница', 'зерно хранится, но только в данных');
  assert.equal(c.locked, true, 'руками добавленный — правленый руками');
  assert.deepEqual(c.tie, { to: HEROINE, what: 'соперничает за стипендию' });

  const twin = addClassmate(s, { name: 'Соколова' }, preset, { stop });
  assert.equal(twin.code, 'known');
  assert.equal(twin.id, a.id);
  assert.equal(s.classmates.length, 1);

  assert.equal(addClassmate(s, { name: 'Алиса' }, preset, { stop }).code, 'stop', 'героиня по имени');
  assert.equal(addClassmate(s, { name: 'Академия Звёздного Света' }, preset, { stop }).code, 'stop');
  assert.equal(addClassmate(s, { name: 'деканат' }, preset, { stop }).code, 'stop', 'служебное слово пресета');
  assert.equal(addClassmate(s, { name: 'Петрова Анна Сергеевна' }, preset, { stop }).code, 'teacher');
  assert.ok(addClassmate(s, { name: 'Мира Ланская' }, preset, { stop }).ok,
    'карточку руками взять можно: чат «один на один» с однокурсницей бывает');
  assert.equal(addClassmate(s, { name: '  ' }, preset).code, 'empty');
});

test('потолок курса', () => {
  const s = semester(Array.from({ length: CLASSMATES_MAX }, (_, i) => ({ id: `p${i}`, name: `Имярек${i} Фамилия${i}` })));
  assert.equal(addClassmate(s, { name: 'Ещё Один' }, preset).code, 'full');
});

test('правка: id стоит, пустое убирает поле, связь с собой — отказ, замок ставится', () => {
  const s = semester([{ id: 'vera', name: 'Вера Соколова', club: 'театр', locked: false }]);
  assert.ok(updateClassmate(s, 'vera', { name: 'Вера Андреевна Соколова', club: '', desire: 'стипендия' }, preset).ok);
  const c = findClassmate(s, 'vera');
  assert.equal(c.name, 'Вера Андреевна Соколова');
  assert.ok(!('club' in c));
  assert.equal(c.desire, 'стипендия');
  assert.equal(c.locked, true);
  assert.equal(updateClassmate(s, 'vera', { tie: { to: 'vera', what: 'сама с собой' } }, preset).code, 'self-tie');
  assert.equal(updateClassmate(s, 'nobody', {}, preset).code, 'unknown');
  assert.equal(updateClassmate(s, 'vera', { name: '' }, preset).code, 'empty');
});

test('удалить: связи на человека уходят вместе с ним, серия антиинфляции — тоже', () => {
  const s = semester([
    { id: 'vera', name: 'Вера Соколова' },
    { id: 'gleb', name: 'Глеб Орлов', tie: { to: 'vera', what: 'влюблён' } },
  ]);
  s.relStreak = { vera: { delta: 1, count: 1, day: '2024-09-02' } };
  assert.ok(removeClassmate(s, 'vera').ok);
  assert.equal(findClassmate(s, 'vera'), null);
  assert.ok(!('tie' in findClassmate(s, 'gleb')));
  assert.ok(!('vera' in s.relStreak));
  assert.equal(removeClassmate(s, 'vera').ok, false);
});

test('связь ведёт к героине, однокурснику, преподавателю или к никому', () => {
  const s = semester([{ id: 'vera', name: 'Вера Соколова' }]);
  assert.equal(tieTarget(s, HEROINE).kind, 'heroine');
  assert.deepEqual(tieTarget(s, 'vera'), { kind: 'classmate', id: 'vera', name: 'Вера Соколова' });
  assert.equal(tieTarget(s, 'petrova').kind, 'teacher');
  assert.equal(tieTarget(s, 'ghost').kind, 'unknown');
  assert.equal(tieTarget(s, '').kind, 'none');
});

// --- кандидаты -----------------------------------------------------------------------

test('кандидат: id, слияние с тем же человеком, отсев стоп-листа и знакомых, галочка', () => {
  const s = semester([{ id: 'vera', name: 'Вера Соколова' }]);
  const id = addCandidate(s, { name: 'Орлов', source: 'scene' }, { stop });
  assert.ok(id);
  assert.equal(addCandidate(s, { name: 'Глеб Орлов', desire: 'попасть в сборную' }, { stop }), id, 'тот же человек — тот же кандидат');
  assert.equal(listCandidates(s).length, 1);
  assert.equal(listCandidates(s)[0].name, 'Глеб Орлов', 'полное имя уточняет фамилию');
  assert.equal(listCandidates(s)[0].desire, 'попасть в сборную');

  assert.equal(addCandidate(s, { name: 'Соколова' }, { stop }), null, 'уже на курсе');
  assert.equal(addCandidate(s, { name: 'Мира Ланская' }, { stop }), null, 'карточку кандидатом не берём');
  assert.equal(addCandidate(s, { name: 'Рассказчик' }, { stop }), null, 'служебное слово пресета');
  assert.equal(addCandidate(s, { name: 'Алиса Воронова' }, { stop }), null, 'героиня');
  assert.equal(addCandidate(s, { name: 'Петрова' }, { stop }), null, 'преподаватель — не однокурсник');

  const c = confirmCandidate(s, id, preset, { stop });
  assert.equal(c.name, 'Глеб Орлов');
  assert.equal(c.source, 'scene');
  assert.equal(c.locked, false, 'подтверждённый из сцены — не правлен руками');
  assert.equal(listCandidates(s).length, 0);
  assert.equal(confirmCandidate(s, id, preset), null, 'второй раз — нечего');

  const other = addCandidate(s, { name: 'Мила Гусева' });
  assert.ok(dropCandidate(s, other));
  assert.equal(listCandidates(s).length, 0);
  assert.ok(validateState(s, preset).ok, validateState(s, preset).errors.join('; '));
});

// --- миграция, снимок, перенос -------------------------------------------------------

test('миграция на схему 3: старый чат открывается без потерь, курс пустой', () => {
  assert.equal(SCHEMA_VERSION, 3);
  const old = semester();
  delete old.classmates;
  delete old.classmateCandidates;
  old.schemaVersion = 2;
  old.subjects[0].grades.push({ value: '5', day: '2024-09-03' });
  old.events = [{ id: 'e1', name: 'вечеринка', from: '2024-09-10' }];
  const report = readState(JSON.parse(JSON.stringify(old)), preset);
  assert.equal(report.status, 'migrated');
  const s = report.state;
  assert.equal(s.schemaVersion, 3);
  assert.deepEqual(s.classmates, []);
  assert.deepEqual(s.classmateCandidates, []);
  assert.deepEqual(s.subjects[0].grades, [{ value: '5', day: '2024-09-03' }]);
  assert.equal(s.events[0].name, 'вечеринка', 'свои события не теряются');
  assert.deepEqual(s.teachers, old.teachers);
});

test('миграция схемы 3 сохраняет курс и чинит битые записи', () => {
  const s = semester([VERA]);
  s.classmates.push({ name: '' }, 'мусор');
  const m = migrate(s, preset);
  assert.equal(m.classmates.length, 1);
  assert.equal(m.classmates[0].desire, VERA.desire);
  assert.ok(validateState(m, preset).ok);
});

test('проверка ловит повтор id, id преподавателя и поле не по форме', () => {
  const s = semester([{ id: 'vera', name: 'Вера' }]);
  s.classmates.push({ id: 'vera', name: 'Вера 2', relation: 0 });
  s.classmates.push({ id: 'petrova', name: 'Не та Петрова', relation: 0 });
  s.classmates.push({ id: 'x', name: 'Икс', relation: 0, desire: 'а'.repeat(500) });
  const { errors } = validateState(s, preset);
  assert.ok(errors.some((e) => e.includes('vera повторяется')));
  assert.ok(errors.some((e) => e.includes('тот же id у преподавателя')));
  assert.ok(errors.some((e) => e.includes('desire')));
});

test('миграция разводит однокурсника с преподавателем, получившим тот же id', () => {
  const s = semester([{ id: 'petrova', name: 'Мила Петрова' }]);
  const m = migrate(s, preset);
  assert.notEqual(m.classmates[0].id, 'petrova');
  assert.equal(m.classmates[0].name, 'Мила Петрова');
  assert.ok(validateState(m, preset).ok, validateState(m, preset).errors.join('; '));
});

test('снимок хода и выгрузка берут курс вместе с состоянием', () => {
  const s = semester([VERA]);
  addCandidate(s, { name: 'Глеб Орлов' });
  const snap = cloneState(s);
  s.classmates[0].desire = 'другое';
  assert.equal(snap.classmates[0].desire, VERA.desire, 'снимок — копия, а не ссылка');

  const env = buildExport(snap, preset, { now: 0 });
  const back = readExport(JSON.stringify(env), preset);
  assert.ok(back.ok);
  assert.equal(back.state.classmates[0].name, VERA.name);
  assert.equal(back.state.classmateCandidates[0].name, 'Глеб Орлов');
});

// --- отношения -----------------------------------------------------------------------

test('отношение однокурсника: та же шкала, свои слова, память «за что»', () => {
  let s = semester([{ id: 'vera', name: 'Вера Соколова' }]);
  assert.equal(findPerson(s, 'vera').name, 'Вера Соколова');
  assert.equal(relationLabel(s, 'vera', preset), 'ровно');
  const r = changeRelation(s, { teacherId: 'vera', delta: -2, reason: { kind: 'marker', text: 'увидела мою пятёрку' } }, preset);
  assert.ok(r.applied);
  assert.deepEqual(r.crossed, { from: 'ровно', to: 'неприязнь' });
  s = r.state;
  assert.equal(relationOf(s, 'vera'), -2);
  for (let i = 0; i < 10; i += 1) s = changeRelation(s, { teacherId: 'vera', delta: -1 }, preset).state;
  assert.equal(relationOf(s, 'vera'), preset.relations.min, 'зажим по шкале пресета');
  assert.equal(relationLabel(s, 'vera', preset), classmateLabels(preset)[0].label);
  assert.notEqual(relationLabel(s, 'vera', preset), preset.relations.labels[0].label,
    'слово однокурсника — своё, не преподавательское');
  const memory = relationMemory(s, 'vera', preset, 10);
  assert.equal(memory[memory.length - 1].reason, 'увидела мою пятёрку');
  assert.equal(relationOf(s, 'petrova'), preset.relations.start, 'преподаватель не задет');
});

test('антиинфляция одна на всех: штамп к однокурснику гасится так же', () => {
  let s = semester([{ id: 'vera', name: 'Вера Соколова' }]);
  const ev = [{ teacherId: 'vera', delta: 1 }];
  let damped = [];
  for (let i = 0; i < 3; i += 1) {
    const r = dampRepeats(s, ev, preset);
    s = r.state;
    damped = r.damped;
  }
  assert.equal(damped.length, 1, 'третий одинаковый подряд — погашен');
});

test('метка rel= в ответе двигает однокурсника по id и по фамилии', () => {
  let s = semester([{ id: 'vera', name: 'Вера Соколова' }]);
  s = applyResponse(s, 'Сцена.\n<!-- [ACADEMY rel=Соколова:minor-:увидела пятёрку] -->', preset).state;
  assert.equal(relationOf(s, 'vera'), -preset.relations.impact.minor);
  s = applyResponse(s, 'Сцена.\n<!-- [ACADEMY rel=vera:+2] -->', preset).state;
  assert.equal(relationOf(s, 'vera'), 2 - preset.relations.impact.minor);
  assert.deepEqual(markerPeople(s).map((p) => p.id), ['petrova', 'vera'], 'преподаватели первыми');
});

// --- лорбук ---------------------------------------------------------------------------

test('запись однокурсника: по имени, коротко, без зерна; слово отношения, а не число', () => {
  const s = semester([{ id: 'vera', ...VERA }, { id: 'gleb', name: 'Глеб Орлов', tie: { to: 'vera', what: 'влюблён в неё' } }]);
  const e = classmateEntry(s, 'vera', preset);
  assert.equal(e.uid, classmateUid('vera'));
  assert.equal(e.category, 'people');
  assert.deepEqual(e.keys, ['Вера Соколова', 'Вера', 'Соколова']);
  assert.equal(e.constant, false, 'только по упоминанию имени');
  assert.match(e.content, /театральный/);
  assert.match(e.content, /попасть в тройку лучших/);
  assert.match(e.content, /героиня — соперничает за стипендию/);
  assert.match(e.content, /висит долг по физике/);
  assert.match(e.content, /К героине: ровно/);
  assert.doesNotMatch(e.content, /завистница/, 'роль-зерно в лорбук не идёт');
  assert.doesNotMatch(e.content, /Говорят/, 'ленты нет — и слуха в записи нет');
  assert.match(classmateEntry(s, 'gleb', preset).content, /Вера Соколова — влюблён в неё/);
  assert.match(classmateEntry(s, 'vera', preset, { rumor: 'встречается с преподом' }).content, /Говорят \(может быть неправдой\), что встречается с преподом\./);
  assert.match(e.content, /Что не ладится: висит долг по физике/, 'как на карточке, а не «Сейчас не так»');
  assert.equal(classmateEntry(s, 'nobody', preset), null);
});

test('запись однокурсника не длиннее потолка', () => {
  const big = 'очень длинное описание '.repeat(20);
  const s = semester([{ id: 'vera', name: 'Вера Соколова', desire: big, problem: big, club: big, tie: { to: HEROINE, what: big } }]);
  const e = classmateEntry(s, 'vera', preset);
  assert.ok(e.content.length <= CLASSMATE_ENTRY_MAX, `${e.content.length}`);
  assert.ok(e.content.startsWith('Вера Соколова.'));
});

test('лорбук: одна запись на человека, правка обновляет её, удаление убирает из плана', () => {
  const s = semester([{ id: 'vera', ...VERA }]);
  const entries = buildEntries(s, preset);
  assert.equal(entries.filter((e) => e.uid === classmateUid('vera')).length, 1);
  const snapshot = entries.map((e) => ({ uid: e.uid, content: e.content, fingerprint: e.fingerprint }));

  updateClassmate(s, 'vera', { problem: 'поссорилась с соседкой' }, preset);
  const plan = buildLorebook(s, preset, { snapshot });
  assert.deepEqual(plan.update.map((e) => e.uid), [classmateUid('vera')], 'обновление, а не вторая запись');
  assert.equal(plan.create.length, 0);

  removeClassmate(s, 'vera');
  assert.ok(!buildEntries(s, preset).some((e) => e.uid === classmateUid('vera')));
});

test('перемена отношения однокурсника хроники не заводит', () => {
  let s = semester([{ id: 'vera', name: 'Вера Соколова' }]);
  s = changeRelation(s, { teacherId: 'vera', delta: -3 }, preset).state;
  s = changeRelation(s, { teacherId: 'petrova', delta: -3 }, preset).state;
  const chronicle = buildEntries(s, preset).filter((e) => e.category === 'chronicle');
  assert.equal(chronicle.length, 1, 'только преподаватель');
  assert.match(chronicle[0].content, /Петрова/);
});

test('лорбук-слой: удалённый однокурсник уносит свою запись (forgetClassmate)', async () => {
  const { syncLorebook, forgetClassmate, snapshotOf } = await import('../lorebook.js');
  const worlds = new Map();
  const t = {
    chatMetadata: {},
    getCurrentChatId: () => 'chat-1',
    async saveMetadata() {},
    async loadWorldInfo(name) { return worlds.get(name) || null; },
    async saveWorldInfo(name, data) { worlds.set(name, data); },
    getWorldInfoNames: () => [...worlds.keys()],
  };
  const settings = { lorebook: { enabled: true } };
  const s = semester([{ id: 'vera', ...VERA }]);
  const first = await syncLorebook(t, s, preset, { settings });
  assert.ok(first.ok);
  const book = () => worlds.get(first.name);
  assert.ok(snapshotOf(book()).marks.has(classmateUid('vera')));

  const after = cloneState(s);
  removeClassmate(after, 'vera');
  await syncLorebook(t, after, preset, { settings });
  assert.ok(snapshotOf(book()).marks.has(classmateUid('vera')), 'синхронизация сама не удаляет');
  const res = await forgetClassmate(t, 'vera', { settings });
  assert.equal(res.removed, 1);
  assert.ok(!snapshotOf(book()).marks.has(classmateUid('vera')));

  const refused = await forgetClassmate(t, 'vera', { settings, guard: () => false });
  assert.equal(refused.ok, false, 'чужой чат — отказ');
});

// --- пресеты ---------------------------------------------------------------------------

test('во всех двенадцати пресетах: размер курса, 6–8 ролей-зёрен, свои слова отношения', () => {
  const files = readdirSync(new URL('../presets/', import.meta.url)).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, BUILTIN_PRESETS.length);
  for (const f of files) {
    const p = load(f);
    assert.equal(classmateSize(p), 6, f);
    const seeds = classmateSeeds(p);
    assert.ok(seeds.length >= 6 && seeds.length <= 8, `${f}: ролей ${seeds.length}`);
    const labels = classmateLabels(p);
    assert.ok(labels.length >= 3, f);
    assert.ok(labels[labels.length - 1].upTo >= p.relations.max, `${f}: верх шкалы покрыт`);
    assert.notDeepEqual(labels, p.relations.labels, `${f}: слова однокурсника свои`);
    for (const key of ['teachersTitle', 'classmatesTitle', 'classmatesNone']) {
      assert.ok(typeof p.ui[key] === 'string' && p.ui[key].trim(), `${f}: ui.${key}`);
    }
  }
  assert.equal(load('ru-school.json').ui.classmatesTitle, 'Класс');
  assert.equal(load('ru-university.json').ui.classmatesTitle, 'Курс');
});

test('нормализация пресета: размер зажат, зёрна вычищены, битые ярлыки — отказ', () => {
  const builtins = { 'ru-university': preset };
  const res = normalizePreset({ id: 'mine', classmates: { size: 40, seeds: ['староста', '', 'староста', 7] } }, { builtins });
  assert.ok(res.ok, res.message);
  assert.equal(res.preset.classmates.size, 12);
  assert.deepEqual(res.preset.classmates.seeds, ['староста']);
  assert.deepEqual(res.preset.classmates.labels, preset.classmates.labels, 'ярлыки — из основы');
  assert.ok(res.warnings.some((w) => w.includes('classmates.size')));

  const inherited = normalizePreset({ id: 'bare' }, { builtins });
  assert.deepEqual(inherited.preset.classmates, preset.classmates, 'нет блока — весь из основы');

  const bad = normalizePreset({ id: 'bad', classmates: { labels: [{ label: 'x' }] } }, { builtins });
  assert.equal(bad.ok, false);
  assert.equal(classmateSize({}), DEFAULT_SIZE);
});

// --- вкладка «Люди», часть «Курс» -------------------------------------------------------

test('вид «Курс»: имя, кружок, желание, связь словами, проблема, отношение словом и числом', () => {
  let s = semester([{ id: 'vera', ...VERA }, { id: 'gleb', name: 'Глеб Орлов', tie: { to: 'vera', what: 'влюблён' } }]);
  s = changeRelation(s, { teacherId: 'vera', delta: -1, reason: { kind: 'marker', text: 'увидела пятёрку' } }, preset).state;
  const v = classmatesView(s, preset);
  assert.equal(v.title, 'Курс');
  assert.equal(v.count, 2);
  const vera = v.people.find((p) => p.id === 'vera');
  assert.equal(vera.club, 'театральный');
  // «С кем связан: с героиней — соперничает…» — без второго двоеточия.
  assert.equal(vera.tieText, 'с героиней — соперничает за стипендию');
  assert.equal(vera.relationText, 'косится · −1');
  assert.deepEqual(vera.memory.map((m) => m.text), ['−1 — увидела пятёрку']);
  assert.ok(!('seed' in vera), 'зерно на карточку не идёт');
  assert.equal(v.people.find((p) => p.id === 'gleb').tieText, 'Вера Соколова — влюблён');
  assert.equal(v.people.find((p) => p.id === 'gleb').memoryText, uiLabels(preset).relationNoHistory);
  assert.deepEqual(v.tieOptions.slice(0, 2).map((o) => o.value), ['', HEROINE]);
  assert.ok(v.tieOptions.some((o) => o.value === 'petrova'), 'связь может вести к преподавателю');
});

test('вид «Люди»: две части, у школы — «Класс», пустой курс — подсказка', () => {
  const view = peopleView(semester(), preset);
  assert.equal(view.teachersTitle, 'Преподаватели');
  assert.equal(view.course.count, 0);
  assert.match(view.course.none, /руками/);
  assert.match(view.course.none, /секретарь/);
  const school = load('ru-school.json');
  const st = createState(school, { startDay: '2024-09-02' });
  st.started = true;
  const sv = peopleView(st, school);
  assert.equal(sv.kind, 'ok');
  assert.equal(sv.course.title, 'Класс');
  assert.equal(DEFAULT_UI.classmatesTitle, 'Курс');
});

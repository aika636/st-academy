// test/preset — переносимые пресеты заведений (план 9.3.2), чистое ядро.
//
// Пресет от чужого человека — недоверенные данные. Каждое правило проверки
// `core/preset.mjs` здесь — отдельный тест: правило, у которого нет теста,
// снимут при первой же «чистке», и узнают об этом по упавшей у кого-то таверне.
// Проводка (настройки, откат, панель) — в `test/preset-flow.test.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  BUILTIN_PRESETS, DEFAULT_BASE, PRESET_FORMAT, PRESET_FORMAT_VERSION, PRESET_MAX_BYTES, TREE_LIMITS,
  cleanId, cleanString, clampLimits, freeId, freeName, mergeOverBase, normalizePreset, presetEnvelope,
  presetFilename, presetSummary, probePreset, readPresetFile, sanitizeTree,
} from '../core/preset.mjs';

const load = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));
const BUILTINS = Object.fromEntries(BUILTIN_PRESETS.map((id) => [id, load(id)]));
const ru = BUILTINS['ru-university'];

/** Пресет человека: копия встроенного с новым id и именем. */
const mine = (patch = {}, base = ru) => ({ ...structuredClone(base), id: 'my-uni', displayName: 'Мой вуз', ...patch });
const norm = (raw, opts = {}) => normalizePreset(raw, { builtins: BUILTINS, ...opts });

// --- встроенные проходят свою же проверку ----------------------------------

for (const id of BUILTIN_PRESETS) {
  test(`встроенный ${id} проходит normalizePreset без единой претензии`, () => {
    // Иначе выгруженная основа не загрузилась бы обратно — и «выгрузить
    // встроенный как основу для своего» не работало бы вовсе.
    const res = norm(BUILTINS[id], { basedOn: id });
    assert.equal(res.ok, true, res.message);
    assert.deepEqual(res.warnings, []);
    assert.equal(res.preset.source, 'user');
    assert.equal(res.preset.basedOn, id);
  });
}

// --- конверт ------------------------------------------------------------------

test('конверт: format academy-preset + version, пресет внутри', () => {
  const env = presetEnvelope(ru, { extensionVersion: '0.9.0', exportedAt: '2026-09-21T00:00:00Z' });
  assert.equal(env.format, PRESET_FORMAT);
  assert.equal(env.version, PRESET_FORMAT_VERSION);
  assert.equal(env.basedOn, 'ru-university', 'встроенный выгружается основой самого себя');
  assert.equal(env.extensionVersion, '0.9.0');
  const back = readPresetFile(JSON.stringify(env));
  assert.equal(back.ok, true);
  assert.equal(back.basedOn, 'ru-university');
  assert.equal(back.raw.id, 'ru-university');
  assert.equal(presetFilename(ru), 'academy-preset-ru-university.json');
});

test('конверт: служебные поля своего пресета в файл не уходят внутрь preset', () => {
  const env = presetEnvelope({ ...mine(), source: 'user', basedOn: 'jp-highschool' });
  assert.equal('source' in env.preset, false);
  assert.equal('basedOn' in env.preset, false);
  assert.equal(env.basedOn, 'jp-highschool');
});

test('файл без конверта принимается как пресет из папки — с замечанием', () => {
  const res = readPresetFile(JSON.stringify(ru));
  assert.equal(res.ok, true);
  assert.match(res.warnings.join(' '), /без конверта/);
});

test('файл больше 1 МБ отвергается до разбора JSON', () => {
  const big = `{"format":"academy-preset","x":"${'я'.repeat(PRESET_MAX_BYTES / 2 + 10)}"}`;
  const res = readPresetFile(big);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'too-big');
  assert.match(res.message, /1 МБ/);
});

test('размер считается в байтах: 600 тысяч кириллических символов — больше мегабайта', () => {
  const text = JSON.stringify({ format: PRESET_FORMAT, version: 1, preset: { id: 'x', note: 'ж'.repeat(600000) } });
  assert.ok(text.length < PRESET_MAX_BYTES, 'в символах файл меньше предела');
  assert.equal(readPresetFile(text).code, 'too-big');
});

test('не JSON, не объект, пустой файл — отказ словами, а не исключение', () => {
  assert.equal(readPresetFile('{нет').code, 'not-json');
  assert.equal(readPresetFile('[1,2]').code, 'not-object');
  assert.equal(readPresetFile('   ').code, 'empty');
  assert.equal(readPresetFile(null).code, 'not-object');
});

test('выгрузка состояния вместо пресета — отказ с подсказкой, куда её нести', () => {
  const res = readPresetFile(JSON.stringify({ format: 'academy-state', state: {} }));
  assert.equal(res.code, 'state-file');
  assert.match(res.message, /Выгрузка и загрузка/);
});

test('чужой format и объект без словаря — отказ', () => {
  assert.equal(readPresetFile(JSON.stringify({ format: 'comic-forge', preset: {} })).code, 'foreign');
  assert.equal(readPresetFile(JSON.stringify({ hello: 1 })).code, 'foreign');
});

test('конверт из будущей версии формата не читается', () => {
  const res = readPresetFile(JSON.stringify({ format: PRESET_FORMAT, version: PRESET_FORMAT_VERSION + 1, preset: ru }));
  assert.equal(res.code, 'format-future');
});

test('конверт без самого пресета — отказ', () => {
  assert.equal(readPresetFile(JSON.stringify({ format: PRESET_FORMAT, version: 1 })).code, 'no-preset');
});

// --- общий фильтр дерева ------------------------------------------------------

test('фильтр: __proto__ и constructor не проходят в объект', () => {
  const raw = JSON.parse('{"vocab":{"__proto__":{"polluted":1},"term":"год"},"constructor":{"x":1}}');
  const { value, warnings } = sanitizeTree(raw);
  assert.equal(Object.getPrototypeOf(value.vocab), Object.prototype);
  assert.equal(({}).polluted, undefined);
  assert.equal(Object.hasOwn(value, 'constructor'), false);
  assert.equal(value.vocab.term, 'год');
  assert.ok(warnings.some((w) => /запретный ключ/.test(w)));
});

test('фильтр: слишком глубокое дерево обрезается', () => {
  let deep = { leaf: 1 };
  for (let i = 0; i < TREE_LIMITS.depth + 3; i += 1) deep = { d: deep };
  const { value, warnings } = sanitizeTree({ x: deep });
  assert.ok(warnings.some((w) => /вложенность/.test(w)));
  assert.ok(JSON.stringify(value).length < JSON.stringify({ x: deep }).length);
});

test('фильтр: огромное число полей — отказ целиком, а не обрезка', () => {
  const many = { list: Array.from({ length: 90 }, () => Array.from({ length: 90 }, (_, i) => i)) };
  const res = sanitizeTree(many);
  assert.ok(res.errors.length, 'восемь тысяч полей — не пресет');
});

test('фильтр: длинный список и длинная строка обрезаются с замечанием', () => {
  const { value, warnings } = sanitizeTree({
    list: Array.from({ length: TREE_LIMITS.array + 5 }, (_, i) => i),
    text: 'а'.repeat(TREE_LIMITS.string + 50),
  });
  assert.equal(value.list.length, TREE_LIMITS.array);
  assert.equal(value.text.length, TREE_LIMITS.string);
  assert.equal(warnings.length, 2);
});

test('фильтр: NaN и бесконечность не бывают числами пресета', () => {
  const { value } = sanitizeTree({ a: Number.NaN, b: Infinity, c: 3 });
  assert.deepEqual(value, { c: 3 });
});

test('фильтр: слишком длинное имя ключа выбрасывается', () => {
  const { value } = sanitizeTree({ ['k'.repeat(TREE_LIMITS.key + 1)]: 1, ok: 2 });
  assert.deepEqual(value, { ok: 2 });
});

test('фильтр не трогает исходный объект: превью держит его как есть', () => {
  const raw = { vocab: { term: '{{user}}' } };
  sanitizeTree(raw);
  assert.equal(raw.vocab.term, '{{user}}');
});

// --- строки: исполняемое -----------------------------------------------------

test('строка: макросы таверны {{…}} обезврежены, подстановки {ключ} — нет', () => {
  const r = cleanString('{{setvar::x::1}} и {n}-я неделя');
  assert.ok(!r.text.includes('{{'), r.text);
  assert.ok(r.text.includes('{n}'));
  assert.equal(r.changed, true);
});

test('строка: <img onerror>, <script> и теги с атрибутами вырезаются', () => {
  const r = cleanString('до <img src=x onerror=alert(1)> <script>alert(1)</script> <a href="javascript:1">x</a> после');
  assert.ok(!/<img|<script|<a\b|onerror|href/i.test(r.text), r.text);
  assert.ok(r.text.startsWith('до') && r.text.endsWith('после'));
});

test('строка: <code> из справки команд остаётся — встроенные пресеты им пользуются', () => {
  assert.equal(cleanString('<code>/academy-time days=1</code>').text, '<code>/academy-time days=1</code>');
  assert.equal(cleanString('<CODE class="x">y</CODE>').text, 'y</code>', 'тег с атрибутом не проходит даже из белого списка');
});

test('строка: из обрезков не собирается новый тег', () => {
  const r = cleanString('<scr<script>ipt>alert(1)');
  assert.ok(!r.text.includes('<script'), r.text);
  assert.ok(!/<[a-z]/i.test(r.text.replace(/<\/?(code|b|i|em|strong|u|br)>/g, '')));
});

test('строка: одинокое «<» в арифметике не трогается', () => {
  assert.equal(cleanString('3 < 5').text, '3 < 5');
});

test('строка: управляющие символы вон, перевод строки остаётся', () => {
  assert.equal(cleanString('a\u0000b\u0007c\nd\te').text, 'abc\nd\te');
});

test('нормализация обезвреживает строки во всём пресете, включая справку команд', () => {
  const res = norm(mine({
    vocab: { ...ru.vocab, term: 'семестр {{char}}' },
    ui: { ...ru.ui, cmdTimeHelp: '<img src=x onerror=alert(1)>справка' },
  }));
  assert.equal(res.ok, true, res.message);
  assert.ok(!res.preset.vocab.term.includes('{{'));
  assert.equal(res.preset.ui.cmdTimeHelp, 'справка');
});

// --- слияние с основой ----------------------------------------------------------

test('недостающие ключи словаря берутся из основы', () => {
  const vocab = { ...ru.vocab };
  delete vocab.debt;
  const ui = { ...ru.ui };
  delete ui.presetChange;
  const res = norm(mine({ vocab, ui }));
  assert.equal(res.ok, true, res.message);
  assert.equal(res.preset.vocab.debt, ru.vocab.debt);
  assert.equal(res.preset.ui.presetChange, ru.ui.presetChange);
});

test('основа — из basedOn: пресет на японской основе добирает японские слова', () => {
  const jp = BUILTINS['jp-highschool'];
  const res = norm({ id: 'my-school', displayName: 'Моя школа', vocab: { term: 'полугодие' } }, { basedOn: 'jp-highschool' });
  assert.equal(res.ok, true, res.message);
  assert.equal(res.preset.vocab.term, 'полугодие');
  assert.equal(res.preset.vocab.period, jp.vocab.period);
  assert.deepEqual(res.preset.calendar, jp.calendar);
  assert.equal(res.preset.basedOn, 'jp-highschool');
});

test('новый ключ встроенного доезжает до старого своего пресета (решение 2)', () => {
  // Пресет человека сохранён до того, как во встроенных появился exams.dc.
  const old = mine();
  delete old.exams.dc;
  delete old.phrases.milestones;
  const res = norm(old);
  assert.equal(res.ok, true, res.message);
  assert.deepEqual(res.preset.exams.dc, ru.exams.dc);
  assert.deepEqual(res.preset.phrases.milestones, ru.phrases.milestones);
});

test('неизвестная основа — берётся русский вуз, с замечанием', () => {
  const res = norm(mine(), { basedOn: 'hogwarts' });
  assert.equal(res.ok, true);
  assert.equal(res.preset.basedOn, DEFAULT_BASE);
  assert.ok(res.warnings.some((w) => /hogwarts/.test(w)));
});

test('календарь не смешивается: скаляры пресета не перебиваются списком периодов основы', () => {
  const merged = mergeOverBase(BUILTINS['jp-highschool'], { calendar: { termStart: '09-01', studyWeeks: 10, examWeeks: 1 } });
  assert.equal('terms' in merged.calendar, false, 'terms основы перебил бы скаляры пресета');
});

test('учебная неделя не смешивается: шесть уроков не получают потолок пяти пар основы', () => {
  // Поймано прогоном: японская школа на русской основе получала
  // `maxPeriodsPerDay: 5` вуза при своих шести уроках — и отказ.
  const week = { studyDays: [1, 2, 3, 4, 5, 6], periodsPerDay: 6 };
  const merged = mergeOverBase(ru, { week });
  assert.deepEqual(merged.week, week);
  const res = norm({ ...structuredClone(BUILTINS['jp-highschool']), id: 'jp-copy' });
  assert.equal(res.ok, true, res.message);
});

test('шкала оценок сливается на один уровень: синонимы основы не подмешиваются к своим', () => {
  const merged = mergeOverBase(ru, { grades: { values: [{ value: 'A', points: 4, pass: true }], aliases: { a: 'A' } } });
  assert.deepEqual(merged.grades.aliases, { a: 'A' });
});

test('списки заменяются целиком: звонки основы не дописываются к своим', () => {
  const bells = [{ start: '09:00', end: '09:45' }, { start: '10:00', end: '10:45' },
    { start: '11:00', end: '11:45' }, { start: '12:00', end: '12:45' }];
  const res = norm(mine({ bells }));
  assert.equal(res.ok, true, res.message);
  assert.deepEqual(res.preset.bells, bells);
});

test('секции, которых нет вовсе, названы в замечании', () => {
  const res = norm({ id: 'bare', displayName: 'Голый' });
  assert.equal(res.ok, true, res.message);
  assert.ok(res.warnings.some((w) => /взято целиком/.test(w) && /calendar/.test(w)));
});

// --- id и имя -------------------------------------------------------------------

test('id чистится до латиницы, цифр, дефиса и подчёркивания', () => {
  assert.equal(cleanId('My Uni/../x'), 'my-uni-x');
  assert.equal(cleanId('Вуз'), '');
  assert.equal(cleanId('a'.repeat(100)).length, 48);
});

test('без годного id пресет называется custom', () => {
  const res = norm(mine({ id: 'Вуз' }));
  assert.equal(res.preset.id, 'custom');
  assert.ok(res.warnings.some((w) => /custom/.test(w)));
});

test('коллизия id: занятый встроенным или своим получает хвост', () => {
  assert.equal(freeId('ru-university', BUILTIN_PRESETS), 'ru-university-2');
  assert.equal(freeId('ru-university', [...BUILTIN_PRESETS, 'ru-university-2']), 'ru-university-3');
  assert.equal(freeId('fresh', BUILTIN_PRESETS), 'fresh');
  assert.ok(freeId('x'.repeat(48), ['x'.repeat(48)]).length <= 48);
});

test('коллизия имени: два одинаковых имени в выпадашке неотличимы', () => {
  assert.equal(freeName('Российский вуз', ['Российский вуз']), 'Российский вуз (2)');
  assert.equal(freeName('', []), 'Свой пресет');
});

test('имя без displayName берётся из name, иначе из id; длинное режется', () => {
  assert.equal(norm(mine({ displayName: undefined, name: 'Имя' })).preset.displayName, 'Имя');
  assert.equal(norm(mine({ displayName: '', name: undefined })).preset.displayName, 'my-uni');
  assert.equal(norm(mine({ displayName: 'Я'.repeat(200) })).preset.displayName.length, 80);
});

// --- формы секций: каждое правило -----------------------------------------------

/** Отказ с претензией, совпадающей с образцом. */
function rejects(patch, re, base = ru) {
  const res = norm(mine(patch, base));
  assert.equal(res.ok, false, `пресет принят, а должен был отказ по ${re}`);
  assert.ok(res.errors.some((e) => re.test(e)), `нет претензии ${re}: ${res.errors.join(' | ')}`);
  assert.match(res.message, /Пресет не принят/);
}

test('week: учебные дни — числа 1–7 без повторов', () => {
  rejects({ week: { ...ru.week, studyDays: [0, 8] } }, /studyDays/);
  rejects({ week: { ...ru.week, studyDays: [1, 1, 2] } }, /studyDays/);
  rejects({ week: { ...ru.week, studyDays: [] } }, /studyDays/);
});

test('week: занятий в день — целое 1–12', () => {
  rejects({ week: { ...ru.week, periodsPerDay: 0 } }, /periodsPerDay/);
  rejects({ week: { ...ru.week, periodsPerDay: 1e6 } }, /periodsPerDay/);
  rejects({ week: { ...ru.week, periodsPerDay: 2.5 } }, /periodsPerDay/);
});

test('week: maxPeriodsPerDay не меньше periodsPerDay', () => {
  rejects({ week: { ...ru.week, periodsPerDay: 4, maxPeriodsPerDay: 3 } }, /maxPeriodsPerDay/);
});

test('bells: время ЧЧ:ММ, начало раньше конца, звонков не меньше занятий', () => {
  rejects({ bells: [{ start: '25:00', end: '26:00' }] }, /bells\[1\]/);
  rejects({ bells: [{ start: '10:00', end: '09:00' }] }, /bells\[1\]/);
  rejects({ bells: [{ start: '09:00', end: '10:00' }] }, /звонков 1/);
  rejects({ bells: [] }, /сетки звонков/);
});

test('calendar: начало ММ-ДД, учебные недели 1–60, контрольные 0–12', () => {
  rejects({ calendar: { termStart: '2026-09-01', studyWeeks: 16, examWeeks: 3 } }, /calendar\.start/);
  rejects({ calendar: { termStart: '09-01', studyWeeks: 0, examWeeks: 3 } }, /studyWeeks/);
  rejects({ calendar: { termStart: '09-01', studyWeeks: 16, examWeeks: 99 } }, /examWeeks/);
});

test('calendar: список периодов — не больше шести, каждый своей формы', () => {
  const t = { start: '09-01', studyWeeks: 4, examWeeks: 1 };
  rejects({ calendar: { terms: Array.from({ length: 7 }, () => t) } }, /шести/);
  rejects({ calendar: { terms: [t, { start: '13-01', studyWeeks: 4 }] } }, /terms\[2\]\.start/);
  rejects({ calendar: { ...ru.calendar, vacations: 'летом' } }, /vacations/);
});

test('grades: у оценки есть значение, pass — булево, points — число или null', () => {
  rejects({ grades: { values: [{ value: '', pass: true }] } }, /нет значения/);
  rejects({ grades: { values: [{ value: '5', points: 'пять', pass: true }] } }, /points/);
  rejects({ grades: { values: [{ value: '5', points: 5, pass: 'да' }] } }, /pass/);
  rejects({ grades: { values: [{ value: '5', points: 5, pass: true }, { value: '5', points: 5, pass: true }] } }, /повторяется/);
});

test('grades: хотя бы одна проходная оценка', () => {
  rejects({ grades: { values: [{ value: '2', points: 2, pass: false }] } }, /проходной/);
});

test('exams: хотя бы один вид контрольного с годным id', () => {
  rejects({ exams: { ...ru.exams, kinds: [] } }, /вида контрольного/);
  rejects({ exams: { ...ru.exams, kinds: [{ id: 'не латиница', name: 'x' }] } }, /kinds\[1\]/);
  rejects({ exams: { ...ru.exams, kinds: [{ id: 'a', name: 'x' }, { id: 'a', name: 'y' }] } }, /повторяется/);
  rejects({ exams: { ...ru.exams, retakes: 50 } }, /retakes/);
});

test('relations и reputation: min < max, старт внутри, ступени списком', () => {
  rejects({ relations: { ...ru.relations, min: 5, max: -5 } }, /relations: min/);
  rejects({ relations: { ...ru.relations, start: 99 } }, /relations\.start/);
  rejects({ reputation: { ...ru.reputation, labels: [] } }, /reputation\.labels/);
  rejects({ reputation: { ...ru.reputation, max: 1e9 } }, /reputation: min/);
});

test('vocab: слова — строки', () => {
  rejects({ vocab: { ...ru.vocab, term: 42 } }, /vocab: не строки/);
});

test('limits: чужой потолок зажимается, а не протаскивается', () => {
  const res = norm(mine({ limits: { ...ru.limits, journalSize: 1e9, maxSubjects: 0 } }));
  assert.equal(res.ok, true, res.message);
  assert.equal(res.preset.limits.journalSize, 1000);
  assert.equal(res.preset.limits.maxSubjects, 1);
  assert.ok(res.warnings.some((w) => /journalSize/.test(w)));
});

test('limits: не число — берётся из основы', () => {
  const { limits, warnings } = clampLimits({ maxSubjects: 'много', journalSize: 100 });
  assert.equal('maxSubjects' in limits, false);
  assert.equal(limits.journalSize, 100);
  assert.equal(warnings.length, 1);
  assert.equal(norm(mine({ limits: { maxSubjects: 'много' } })).preset.limits.maxSubjects, ru.limits.maxSubjects);
});

test('отказ перечисляет все претензии, а не первую', () => {
  const res = norm(mine({ week: { ...ru.week, periodsPerDay: 0 }, grades: { values: [] } }));
  assert.equal(res.ok, false);
  assert.ok(res.errors.length >= 2, res.errors.join(' | '));
});

// --- пробный прогон ---------------------------------------------------------------

test('пробный прогон: встроенный пресет проходит ядро без претензий', () => {
  assert.deepEqual(probePreset(ru), []);
});

test('пробный прогон ловит то, что упало бы в игре, и называет шаг', () => {
  const errors = probePreset(ru, [function statusLine() { throw new Error('бум'); }]);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /statusLine.*бум/);
});

test('пробный прогон: пресет, на котором ядро падает, не принимается', () => {
  // Формы секций целы — падает шаг прогона, которого формы не проверяют (здесь
  // подставной вью панели). Отказ обязан назвать шаг: человеку чинить файл.
  const res = norm(mine(), { probe: [function panel() { throw new TypeError('x is undefined'); }] });
  assert.equal(res.ok, false);
  assert.match(res.message, /panel/);
});

// --- превью ------------------------------------------------------------------------

test('превью: «семестр · пары в день: 4 · 2–5 · хвост после 3 прогулов»', () => {
  assert.equal(presetSummary(ru).line, 'семестр · пары в день: 4 · 2–5 · хвост после 3 прогулов');
});

test('превью говорит словами загружаемого пресета, а не активного', () => {
  const magic = presetSummary(BUILTINS['magic-academy']);
  assert.match(magic.line, /^круг · занятия в день: 5 · провал–триумф · учебный долг после 2 прогулов$/);
  const jp = presetSummary(BUILTINS['jp-highschool']);
  assert.match(jp.line, /×3/, 'три триместра видны в превью');
});

test('превью переживает пресет без половины секций', () => {
  assert.equal(presetSummary({ id: 'x' }).line, '');
  assert.equal(presetSummary(null).name, '');
  assert.match(presetSummary({ attendance: { debtAfterSkips: 1 } }).line, /после 1 прогула/);
});

// test/ui — чистая половина ui.js: что показывать при данном состоянии.
//
// Браузера для проверки нет, поэтому вся логика отрисовки, которую можно
// вычислить без DOM, вынесена в чистые функции `ui.js` и проверяется здесь.
// Импорт самого `ui.js` в Node — тоже часть проверки: он обязан грузиться без
// `document`, иначе тест бы упал на разборе модуля.

import { parsePreset } from './preset-file.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState } from '../core/state.mjs';
import { applyResponse } from '../core/engine.mjs';
import { diffDays } from '../core/time.mjs';
import { statusLine } from '../prompt.mjs';
import { addGrade, setDebt } from '../core/gradebook.mjs';
import { changeRelation } from '../core/relations.mjs';
import { changeReputation } from '../core/reputation.mjs';
import { resolveConflict } from '../core/exams.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import {
  DEBUG_TAB, DEBUG_TEXT, DEFAULT_MAX_NUMBERS, DEFAULT_UI, PEOPLE_HISTORY,
  SURVEY_FIELDS, TABS, TIME_MODES,
  capNumbers, countNumbers, debugView, describeApplied, fill, formatDate, formatScore, formatWeek,
  gradebookView, peopleView, plural, rowsFromState, settingsView, stateHealth,
  surveyOf, tabsFor, todayView, uiLabels, validateSubjectRows,
} from '../ui.js';

const preset = parsePreset(readFileSync(new URL('../presets/ru-university.json', import.meta.url), 'utf8'));

const TERM = '2024-09-02'; // понедельник

const teachers = [
  { id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['злопамятна'] },
  { id: 'grinev', name: 'Гринёв Пётр Андреевич', traits: ['придирается к опозданиям'] },
];
const subjects = [
  { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'grinev' },
  { id: 'math', name: 'высшая математика', teacherId: 'petrova' },
];

/** Начатый семестр с расписанием: базовая точка почти всех тестов ниже. */
function started(over = {}) {
  const state = createState(preset, { startDay: TERM, subjects, teachers });
  state.schedule = buildSchedule(state.subjects, preset);
  state.started = true;
  Object.assign(state.calendar, over);
  return state;
}

// --- 1. Отрисовка переживает всё ---------------------------------------------

test('состояния нет вовсе — предложена анкета, а не пустой экран', () => {
  for (const empty of [null, undefined]) {
    const h = stateHealth(empty, preset);
    assert.equal(h.kind, 'no-state');
    assert.ok(h.title && h.text, 'у пустой ветки есть и заголовок, и объяснение');
    assert.equal(h.action.id, 'open-settings');

    const view = todayView(empty, preset);
    assert.equal(view.kind, 'no-state');
    assert.equal(countNumbers(view), 0, 'на пустом экране чисел нет');
    assert.equal(gradebookView(empty, preset).kind, 'no-state');
  }
});

test('семестр не начат — панель молчит про расписание и зовёт в анкету', () => {
  const state = createState(preset, { startDay: TERM });
  const view = todayView(state, preset);
  assert.equal(view.kind, 'not-started');
  assert.equal(view.silent, true);
  assert.ok(view.action);
});

test('битое состояние — показана ошибка со списком претензий, а не пустой экран', () => {
  const broken = started();
  broken.subjects = 'не массив';
  const view = todayView(broken, preset);
  assert.equal(view.kind, 'broken');
  assert.ok(view.errors.length > 0, 'претензии перечислены поимённо');
  assert.ok(view.text.length > 0);

  const gb = gradebookView(broken, preset);
  assert.equal(gb.kind, 'broken');
  assert.deepEqual(gb.subjects, []);
});

test('предметов нет, расписания нет, преподавателей нет — не падает', () => {
  const state = createState(preset, { startDay: TERM });
  state.started = true;
  const view = todayView(state, preset);
  assert.equal(view.kind, 'ok');
  assert.equal(view.silent, true, 'пустое расписание — повод молчать');
  assert.deepEqual(view.plan, []);

  const gb = gradebookView(state, preset);
  assert.equal(gb.kind, 'ok');
  assert.deepEqual(gb.subjects, []);
  assert.equal(gb.overallText, '—', 'ноль вместо отсутствующего балла — это враньё');

  const st = settingsView(state, {}, preset);
  assert.equal(st.canStart, false);
  assert.ok(st.startBlockers.length, 'недоступная кнопка объясняет, почему недоступна');
});

// --- 2. «Сегодня»: расписание молчит там, где должно -------------------------

test('в учебный день с часами показана текущая пара и следующая', () => {
  const state = started({ time: '08:40', precision: 'datetime' });
  const view = todayView(state, preset);

  assert.equal(view.kind, 'ok');
  assert.equal(view.silent, false);
  assert.equal(view.phase, 'study');
  assert.ok(view.now, 'текущая пара найдена');
  assert.equal(view.now.status, 'now');
  assert.equal(view.now.ordinal, 1);
  assert.ok(view.now.name);
  assert.ok(view.now.teacher, 'преподаватель подписан именем');
  assert.ok(view.next, 'следующая пара тоже есть');
  assert.ok(view.plan.some((p) => p.current), 'текущая отмечена и в списке дня');
});

test('перемена и утро до первой пары — разные заголовки, обе не молчание', () => {
  const brk = todayView(started({ time: '10:10', precision: 'datetime' }), preset);
  assert.equal(brk.now.status, 'break');
  assert.equal(brk.silent, false);

  const morning = todayView(started({ time: '07:30', precision: 'datetime' }), preset);
  assert.equal(morning.now.status, 'before');
  assert.notEqual(morning.now.title, brk.now.title);
});

test('в выходной, на каникулах, ночью и после последней пары расписание молчит', () => {
  const cases = [
    ['выходной', started({ day: '2024-09-07' }), /Выходной/],
    ['каникулы', started({ day: '2024-11-05' }), /Каникул/],
    ['ночь', started({ day: TERM, time: '23:40', precision: 'datetime' }), /Ночь/],
    ['после занятий', started({ day: TERM, time: '19:00', precision: 'datetime' }), /кончились/],
  ];
  for (const [name, state, re] of cases) {
    const view = todayView(state, preset);
    assert.equal(view.kind, 'ok', name);
    assert.equal(view.silent, true, `${name}: расписание обязано молчать`);
    assert.equal(view.now, null, `${name}: текущей пары быть не может`);
    assert.match(view.silentReason, re, `${name}: сказано, почему молчит`);
  }
});

test('в сессию лекционная сетка не подставляется', () => {
  const state = started({ day: '2025-01-07' }); // после 16 учебных недель
  const view = todayView(state, preset);
  assert.equal(view.phase, 'exams');
  assert.equal(view.silent, true);
});

test('точность date: пара идёт по счётчику, а часы не выдумываются', () => {
  const state = started({ precision: 'date', time: null, periodIndex: 2 });
  const view = todayView(state, preset);
  assert.equal(view.time, null, 'часов нет — и на экране их нет');
  assert.ok(view.now);
  assert.equal(view.now.ordinal, 3);
  assert.equal(view.numbers.some((n) => n.key === 'time'), false);
});

// --- 3. Индикатор простоя (3.2) ---------------------------------------------

test('отметка «время сдвинулось тогда-то» и превращение её в жалобу', () => {
  const fresh = todayView(started({ source: 'A', idle: 0 }), preset);
  assert.equal(fresh.stalled, false);
  assert.match(fresh.timeMark, /сдвинулось в последнем ответе/);
  assert.match(fresh.timeMark, /из текста ответа/, 'видно, какой источник сработал');

  const quiet = todayView(started({ source: 'B', idle: 3 }), preset);
  assert.equal(quiet.stalled, false);
  assert.match(quiet.timeMark, /3 ответа назад/);

  const stuck = todayView(started({ source: 'B', idle: preset.limits.idleWarnAfter }), preset);
  assert.equal(stuck.stalled, true);
  assert.match(stuck.timeMark, /Время в чате давно не двигалось/);

  const never = todayView(started(), preset);
  assert.match(never.timeMark, /ещё не сдвигалось/);
});

// --- 4. Не больше шести чисел на экране (3.3) --------------------------------

test('«Сегодня» укладывается в потолок чисел пресета', () => {
  const loaded = started({ time: '08:40', precision: 'datetime', source: 'B', idle: 50 });
  const view = todayView(loaded, preset);
  assert.ok(countNumbers(view) <= preset.limits.maxNumbersInPrompt,
    `чисел на экране ${countNumbers(view)}, потолок ${preset.limits.maxNumbersInPrompt}`);
  assert.ok(countNumbers(view) > 0, 'но и не пусто: дата с неделей на экране обязаны быть');
});

test('«Зачётка» укладывается в потолок сводных чисел', () => {
  let state = started();
  state = addGrade(state, { subjectId: 'chemistry', value: '4' }, preset).state;
  state = addGrade(state, { subjectId: 'chemistry', value: '5' }, preset).state;
  state = addGrade(state, { subjectId: 'physics', value: '3' }, preset).state;
  state = setDebt(state, 'math', true, preset);

  const view = gradebookView(state, preset);
  assert.ok(countNumbers(view) <= preset.limits.maxNumbersInPrompt);
  assert.deepEqual(view.debts, ['высшая математика']);
  assert.equal(view.overallText, '4,0');
});

test('лишние числа режутся по хвосту, а не пропадают молча', () => {
  const list = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, text: String(i) }));
  const { shown, dropped, max } = capNumbers(list, preset);
  assert.equal(max, preset.limits.maxNumbersInPrompt);
  assert.equal(shown.length, max);
  assert.equal(dropped.length, 9 - max);
  assert.equal(shown[0].key, 'k0', 'режется хвост, важное остаётся');
});

test('пресет без лимитов даёт потолок по умолчанию', () => {
  assert.equal(capNumbers([], {}).max, DEFAULT_MAX_NUMBERS);
  assert.equal(capNumbers([{ key: 'a', text: '' }], {}).shown.length, 0, 'пустые не считаются');
});

// --- 5. Наружу идут слова, а не числа (3.3, 3.4) -----------------------------

test('отношение преподавателя — слово из пресета, а не число', () => {
  let state = started();
  state = changeRelation(state, { teacherId: 'petrova', delta: -4 }, preset).state;
  const view = gradebookView(state, preset);
  const chem = view.subjects.find((s) => s.id === 'chemistry');

  assert.equal(typeof chem.relation, 'string');
  assert.ok(!/^-?\d+([.,]\d+)?$/.test(chem.relation), `ярлык не число: ${chem.relation}`);
  assert.ok(preset.relations.labels.some((l) => l.label === chem.relation));

  // И ни одно поле вида не отдаёт наружу само число отношения.
  assert.equal(JSON.stringify(view).includes('"relation":-4'), false);
});

test('репутация — слово, и число внутрь экрана не просачивается', () => {
  let state = started();
  state = changeReputation(state, { delta: -35 }, preset).state;
  const view = gradebookView(state, preset);
  assert.ok(preset.reputation.labels.some((l) => l.label === view.reputation));
  assert.equal(view.numbers.some((n) => /репутац/i.test(n.text)), false);
});

test('преподавателя нет — предмет всё равно показывается', () => {
  const state = started();
  state.subjects[0].teacherId = null;
  const chem = gradebookView(state, preset).subjects.find((s) => s.id === 'chemistry');
  assert.equal(chem.teacher, '');
  assert.equal(chem.relation, '');
});

// --- 6. Редактируемая таблица предметов и преподавателей (3.6) ---------------

test('таблица берётся из состояния и возвращается в него без потерь', () => {
  const rows = rowsFromState(started());
  assert.equal(rows.subjects.length, 3);
  assert.equal(rows.teachers.length, 2);
  assert.equal(rows.teachers[0].traits, 'злопамятна', 'черты правятся строкой через запятую');

  const res = validateSubjectRows(rows, preset);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.deepEqual(res.subjects.map((s) => s.id), ['chemistry', 'physics', 'math']);
  assert.deepEqual(res.teachers[0].traits, ['злопамятна']);
});

test('пустая таблица — это ошибка «начать не из чего», а не тишина', () => {
  const res = validateSubjectRows({ subjects: [], teachers: [] }, preset);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.scope === 'form' && /предмет/i.test(e.text)));
});

test('id достраивается из названия, если человек его не вписал', () => {
  const res = validateSubjectRows({
    teachers: [{ name: 'Петрова Анна', traits: 'злопамятна' }],
    subjects: [{ name: 'аналитическая химия', teacherId: 'petrova-anna' }],
  }, preset);
  assert.equal(res.ok, true, JSON.stringify(res.errors));
  assert.equal(res.teachers[0].id, 'petrova-anna');
  assert.match(res.subjects[0].id, /^[a-z0-9][a-z0-9_-]*$/);
  assert.ok(res.subjects[0].id.length <= preset.limits.maxIdLength);
});

test('дубли, пустые названия и ссылка на несуществующего преподавателя ловятся', () => {
  const res = validateSubjectRows({
    teachers: [{ id: 'p', name: 'Петрова' }, { id: 'p', name: 'Двойник' }, { name: '' }],
    subjects: [
      { id: 'chem', name: 'химия', teacherId: 'p' },
      { id: 'chem', name: 'та же химия', teacherId: 'p' },
      { id: 'phys', name: 'физика', teacherId: 'ghost' },
      { id: 'x', name: '', teacherId: 'p' },
    ],
  }, preset);

  assert.equal(res.ok, false);
  const texts = res.errors.map((e) => e.text).join(' | ');
  assert.match(texts, /слишком похоже на уже записанное имя/);
  assert.match(texts, /слишком похоже на уже записанное название/);
  assert.match(texts, /которого нет в списке/);
  assert.match(texts, /нет названия/);
  // Годные строки при этом уцелели: правится одна ячейка, а не всё заново.
  assert.deepEqual(res.subjects.map((s) => s.id), ['chem', 'phys']);
  assert.equal(res.subjects[1].teacherId, null, 'битая ссылка снята, предмет остался');
});

test('потолки пресета — ошибка формы, а не молчаливая обрезка', () => {
  const many = Array.from({ length: preset.limits.maxSubjects + 2 }, (_, i) => ({ id: `s${i}`, name: `предмет ${i}` }));
  const res = validateSubjectRows({ subjects: many, teachers: [] }, preset);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.field === 'subjects' && /потолок/.test(e.text)));
  assert.equal(res.subjects.length, many.length, 'строки не выброшены — человек решает, какую убрать');
});

test('отсутствие черт и преподавателя — замечание, а не брак', () => {
  const res = validateSubjectRows({
    teachers: [{ id: 'p', name: 'Петрова' }],
    subjects: [{ id: 'chem', name: 'химия' }],
  }, preset);
  assert.equal(res.ok, true, 'вписать своё и дописать характер позже — законный сценарий');
  assert.equal(res.notes.length, 2);
});

// --- 7. Настройки (3.6, 3.2) -------------------------------------------------

test('анкета — ровно шесть полей из плана, все со значением', () => {
  assert.equal(SURVEY_FIELDS.length, 6);
  const view = settingsView(started(), {}, preset);
  assert.equal(view.survey.length, 6);
  for (const f of view.survey) {
    assert.equal(typeof f.value, 'string');
    assert.ok(f.label && f.hint);
  }
});

test('черновик анкеты живёт в настройках, пока состояния нет, и только в своём чате', () => {
  const draft = { era: 'киберпанк', country: 'Япония', chatId: 'chat-A' };
  assert.equal(surveyOf(null, { ui: { surveyDraft: draft } }, 'chat-A').era, 'киберпанк');
  assert.equal(surveyOf(null, { ui: { surveyDraft: draft } }, 'chat-A').chatId, undefined, 'метка чата в анкету не течёт');
  // Как только семестр начат, истина — в состоянии.
  const state = started();
  state.survey.era = 'современность';
  assert.equal(surveyOf(state, { ui: { surveyDraft: draft } }, 'chat-A').era, 'современность');
});

test('черновик анкеты не переезжает в другой чат, старый безымянный не применяется нигде', () => {
  const draft = { era: 'современность', country: 'Woodland Court', chatId: 'chat-A' };
  const other = surveyOf(null, { ui: { surveyDraft: draft } }, 'chat-B');
  assert.deepEqual(other, surveyOf(null, {}, 'chat-B'), 'в чужом чате анкета пустая');
  assert.equal(other.era, '');

  const legacy = { era: 'современность', country: 'Woodland Court' };
  assert.equal(surveyOf(null, { ui: { surveyDraft: legacy } }, 'chat-A').era, '');
  assert.equal(surveyOf(null, { ui: { surveyDraft: legacy } }, '').era, '');
  assert.equal(settingsView(null, { ui: { surveyDraft: draft } }, preset, { chatId: 'chat-B' })
    .survey.filter((f) => f.key !== 'lang').every((f) => f.value === ''), true);
  assert.equal(settingsView(null, { ui: { surveyDraft: draft } }, preset, { chatId: 'chat-A' })
    .survey.find((f) => f.key === 'era').value, 'современность');
});

test('три положения источника времени, «авто» по умолчанию', () => {
  assert.deepEqual(TIME_MODES.map((m) => m.id), ['auto', 'context', 'marker']);
  assert.equal(settingsView(null, {}, preset).mode, 'auto');
  assert.equal(settingsView(null, { mode: 'чушь' }, preset).mode, 'auto');
  assert.equal(settingsView(null, { mode: 'marker' }, preset).modes.find((m) => m.active).id, 'marker');
});

test('в режиме «из контекста» галочка инжекта выключена и заперта', () => {
  const ctx = settingsView(null, { mode: 'context', injectMarker: true }, preset);
  assert.equal(ctx.injectMarker, false, 'инструкция про метку в этом режиме бессмысленна');
  assert.equal(ctx.injectMarkerLocked, true);

  const auto = settingsView(null, { mode: 'auto' }, preset);
  assert.equal(auto.injectMarker, true, 'по умолчанию инжект включён');
  assert.equal(auto.injectMarkerLocked, false);
  assert.equal(settingsView(null, { injectMarker: false }, preset).injectMarker, false);
});

test('видимая метка: предупреждение доходит до вида и молчит там, где метки нет', () => {
  const risk = { markerRisk: true };
  assert.equal(settingsView(null, { mode: 'auto' }, preset, risk).markerRisk, true);
  assert.equal(settingsView(null, { mode: 'marker' }, preset, risk).markerRisk, true);
  assert.equal(
    settingsView(null, { mode: 'context' }, preset, risk).markerRisk,
    false,
    'в режиме «из контекста» метки в промпте нет — видеть в тексте нечего',
  );
  assert.equal(settingsView(null, { mode: 'auto' }, preset, { markerRisk: false }).markerRisk, false);
  assert.equal(settingsView(null, { mode: 'auto' }, preset).markerRisk, false, 'вызов без четвёртого аргумента');
});

test('относительные сдвиги по умолчанию выключены — самая ненадёжная часть', () => {
  assert.equal(settingsView(null, {}, preset).relativeWords, false);
  assert.equal(settingsView(null, { relativeWords: true }, preset).relativeWords, true);
});

test('пустой адрес API — не ошибка, а запасной путь через таверну', () => {
  const empty = settingsView(null, {}, preset);
  assert.equal(empty.api.fallback, true);
  assert.equal(empty.api.endpoint, '');

  const own = settingsView(null, { api: { endpoint: 'https://x/', key: 'k', model: 'm' } }, preset);
  assert.equal(own.api.fallback, false);
  assert.equal(own.api.model, 'm');
});

test('«начать семестр» доступна при годной таблице и заперта у начатого', () => {
  const ready = createState(preset, { startDay: TERM, subjects, teachers });
  assert.equal(settingsView(ready, {}, preset).canStart, true);

  const running = settingsView(started(), {}, preset);
  assert.equal(running.canStart, false);
  assert.ok(running.startBlockers.includes('семестр уже начат'));
});

// --- 8. Форматирование -------------------------------------------------------

test('дата по-русски, без года: год на экране — лишнее число', () => {
  assert.equal(formatDate('2024-09-02'), 'понедельник, 2 сентября');
  assert.equal(formatDate('2024-11-05'), 'вторник, 5 ноября');
  assert.equal(formatDate('чушь'), '');
  assert.equal(formatDate(null), '');
});

test('неделя и балл: до начала семестра и без оценок числа не выдумываются', () => {
  assert.equal(formatWeek(3), '3-я неделя');
  assert.equal(formatWeek(0), 'семестр ещё не начался');
  assert.equal(formatWeek(NaN), '');
  assert.equal(formatScore(3.44), '3,4');
  assert.equal(formatScore(null), '—');
  assert.equal(formatScore(undefined), '—');
});

test('склонение «ответ / ответа / ответов»', () => {
  const f = (n) => plural(n, 'ответ', 'ответа', 'ответов');
  assert.deepEqual([1, 2, 5, 11, 14, 21, 22, 25, 101].map(f),
    ['ответ', 'ответа', 'ответов', 'ответов', 'ответов', 'ответ', 'ответа', 'ответов', 'ответ']);
});

test('вкладки — четыре из плана, «Поток» и «Достижения», в том же порядке', () => {
  // `plan-academy.md:486-491`: «Сегодня», «Зачётка», «Люди», «Настройки»; «Достижения» — перед настройками,
  // «Поток» (шаг 4) — сразу за людьми: лента — про них.
  const ids = ['today', 'gradebook', 'people', 'feed', 'achievements', 'settings'];
  assert.deepEqual(TABS.map((t) => t.id), ids);
  assert.deepEqual(tabsFor(preset).map((t) => t.id), ids);
});

test('пятая вкладка есть только при включённой отладке', () => {
  // «При выключенной отладке ничего лишнего на экране» — буквально: вкладки нет
  // ни при выключенной галочке, ни при отсутствии настроек вовсе.
  assert.equal(tabsFor(preset).some((t) => t.id === 'debug'), false);
  assert.equal(tabsFor(preset, {}).some((t) => t.id === 'debug'), false);
  assert.equal(tabsFor(preset, { debug: false }).some((t) => t.id === 'debug'), false);
  // И не от любой правдоподобной строки: галочка — булева.
  assert.equal(tabsFor(preset, { debug: 'да' }).some((t) => t.id === 'debug'), false);

  const on = tabsFor(preset, { debug: true });
  assert.deepEqual(on.map((t) => t.id), ['today', 'gradebook', 'people', 'feed', 'achievements', 'settings', 'debug']);
  assert.equal(on[6].label, DEBUG_TAB.label);
});

// --- 8а. Вкладка «Люди» (3.9, 3.4) -------------------------------------------

/** Все строки, которые вкладка «Люди» реально выводит на экран, одним массивом. */
function peopleStrings(view) {
  const out = [view.reputation, ...view.numbers.map((n) => n.text), ...view.orphans];
  for (const t of view.teachers) {
    out.push(t.name, t.relation, t.traitsText, t.subjectsText, t.memoryText, t.post, t.likesText, t.secret);
    for (const m of t.memory) out.push(m.text, m.dateLine, m.shift);
  }
  return out.filter((s) => s !== '' && s !== undefined);
}

test('«Люди»: у преподавателя видны предмет, черты и отношение словом', () => {
  const view = peopleView(started(), preset);
  assert.equal(view.kind, 'ok');
  assert.equal(view.teachers.length, 2);

  const petrova = view.teachers.find((t) => t.id === 'petrova');
  assert.equal(petrova.name, 'Петрова Анна Сергеевна');
  assert.deepEqual(petrova.subjects, ['аналитическая химия', 'высшая математика']);
  assert.equal(petrova.traitsText, 'злопамятна');
  // Без записанной истории слова отношения нет (макет «Люди», п. 10).
  assert.equal(petrova.relation, '');
  assert.equal(petrova.score, '');
  const moved = changeRelation(started(), { teacherId: 'petrova', delta: -1, reason: 'прогул' }, preset).state;
  const after = peopleView(moved, preset).teachers.find((t) => t.id === 'petrova');
  assert.ok(preset.relations.labels.some((l) => l.label === after.relation), 'ярлык из таблицы пресета, а не число');
});

test('«Люди»: число отношения видно рядом со словом — со знаком, по краю шкалы', () => {
  // Правило «только словом» владелица сняла 06.10: слово одно на целый отрезок
  // шкалы, и сдвиг внутри него без числа не видно.
  let state = started();
  for (let i = 0; i < 5; i += 1) {
    state = changeRelation(state, { teacherId: 'petrova', delta: -1, reason: 'прогул' }, preset).state;
  }
  const value = state.teachers.find((t) => t.id === 'petrova').relation;
  assert.equal(value, preset.relations.min);

  const petrova = peopleView(state, preset).teachers.find((t) => t.id === 'petrova');
  assert.equal(petrova.relation, 'ненавидит', 'слово осталось');
  assert.equal(petrova.score, `−${-value}`, 'число со знаком минус, а не дефисом');
  assert.equal(peopleView(started(), preset).teachers.find((t) => t.id === 'petrova').score, '', 'без истории числа нет');
});

test('«Люди»: память «за что» — каждый сдвиг со знаком и поводом, переход ярлыка — при нём', () => {
  // Внутри шкалы `-1` и `-2` дают разные ярлыки, а `-2 → -3` — один и тот же.
  // Раньше вкладка помнила только переходы; теперь помнит и сдвиг внутри
  // ярлыка: «недоволен» за прогул — зацепка для сцены, даже если слово то же.
  let state = started();
  state = changeRelation(state, {
    teacherId: 'petrova', delta: -2, reason: { kind: 'skip', subjectId: 'chemistry' },
  }, preset).state; // ровно → неприязнь
  state = changeRelation(state, { teacherId: 'petrova', delta: -1 }, preset).state; // ярлык тот же, повода нет
  state = changeRelation(state, {
    teacherId: 'petrova', delta: 1, reason: { kind: 'marker', text: 'спасла опыт' },
  }, preset).state;
  const view = peopleView(state, preset);
  const petrova = view.teachers.find((t) => t.id === 'petrova');

  assert.deepEqual(petrova.memory.map((m) => m.text),
    ['+1 — спасла опыт', '−1', '−2 — прогул: аналитическая химия'],
    'свежим вперёд, со знаком; без повода — только знак, без «без повода» и висящего тире');
  assert.equal(petrova.memory[2].shift, 'ровно → неприязнь', 'переход ярлыка живёт при своём сдвиге');
  assert.equal(petrova.memory[1].shift, '', 'сдвиг внутри ярлыка перехода не выдумывает');
  assert.equal(petrova.memory[0].sign, '+1');
  assert.equal(petrova.memoryText, '');
  assert.equal(view.teachers.find((t) => t.id === 'grinev').memoryText,
    uiLabels(preset).relationNoHistory, 'у нетронутого преподавателя — своя фраза, а не пустота');
});

test('«Люди»: память обрезается по потолку, свежим вперёд; упор в край шкалы не помнится', () => {
  let state = started();
  for (const delta of [2, 2, -2, -2, -2, 2]) {
    state = changeRelation(state, { teacherId: 'petrova', delta }, preset).state;
  }
  let petrova = peopleView(state, preset).teachers.find((t) => t.id === 'petrova');
  assert.equal(petrova.memory.length, PEOPLE_HISTORY);
  assert.deepEqual(petrova.memory.map((m) => m.delta), [2, -2, -2], 'первым стоит последний сдвиг');

  // Сдвиг, упёршийся в край шкалы, отношения не сдвинул — и помнить нечего.
  let edge = started();
  for (let i = 0; i < 12; i += 1) edge = changeRelation(edge, { teacherId: 'petrova', delta: -1 }, preset).state;
  petrova = peopleView(edge, preset).teachers.find((t) => t.id === 'petrova');
  assert.equal(petrova.memory.length, PEOPLE_HISTORY);
  assert.ok(petrova.memory.every((m) => m.delta === -1));
  assert.equal(petrova.memory[0].to, undefined, 'наружу — знак и повод, а не числа шкалы');
});

test('«Люди»: должность, «любит» и тайна — из состояния, пустые не рисуются', () => {
  const state = started();
  state.teachers[0] = { ...state.teachers[0], post: 'заведующая кафедрой', likes: 'белое вино', secret: 'влюблена в декана' };
  const view = peopleView(state, preset);
  const petrova = view.teachers.find((t) => t.id === state.teachers[0].id);
  assert.equal(petrova.post, 'заведующая кафедрой');
  assert.equal(petrova.likesText, 'любит: белое вино');
  assert.equal(petrova.secret, 'влюблена в декана');
  const other = view.teachers.find((t) => t.id !== state.teachers[0].id);
  assert.equal(other.post, '');
  assert.equal(other.likesText, '');
  assert.equal(other.secret, '');
});

test('«Люди»: преподаватель без черт и предмет без преподавателя не ломают вкладку', () => {
  const state = createState(preset, {
    startDay: TERM,
    subjects: [
      { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
      { id: 'physics', name: 'физика' },
      { id: 'math', name: 'высшая математика', teacherId: null },
    ],
    teachers: [{ id: 'petrova', name: 'Петрова Анна Сергеевна', traits: [] }],
  });
  state.schedule = buildSchedule(state.subjects, preset);
  state.started = true;

  const view = peopleView(state, preset);
  assert.equal(view.kind, 'ok');
  const petrova = view.teachers[0];
  assert.equal(petrova.hasTraits, false);
  assert.equal(petrova.traitsText, uiLabels(preset).traitsNone);
  assert.equal(petrova.subjectsText, 'аналитическая химия');
  assert.deepEqual(view.orphans, ['физика', 'высшая математика']);

  // Преподавателей нет вовсе — тоже не пустой экран.
  const none = peopleView({ ...state, teachers: [], subjects: [] }, preset);
  assert.deepEqual(none.teachers, []);
  assert.equal(uiLabels(preset).peopleNone.length > 0, true);

  // Ссылка на выбывшего преподавателя до вкладки не доходит — такое состояние
  // `stateHealth` объявляет повреждённым раньше, — но считается она той же
  // дырой, и на разборе состояния руками вкладка её показывает.
  const dangling = peopleView.call(null,
    { ...state, subjects: [{ id: 'chemistry', name: 'аналитическая химия', teacherId: 'ghost' }] }, preset);
  assert.equal(dangling.kind, 'broken', 'ядро ловит висячую ссылку раньше панели');
});

test('«Люди»: без состояния и на битом состоянии — тот же экран, что у остальных вкладок', () => {
  assert.equal(peopleView(null, preset).kind, 'no-state');
  assert.deepEqual(peopleView(null, preset).teachers, []);
  assert.equal(peopleView({ started: true, subjects: 'нет' }, preset).kind, 'broken');
});

test('«Люди»: сводное число ровно одно, репутация словом', () => {
  const view = peopleView(started(), preset);
  assert.equal(countNumbers(view), 1);
  assert.match(view.numbers[0].text, /преподавателей: 2/);
  assert.ok(countNumbers(view) <= preset.limits.maxNumbersInPrompt);
  assert.ok(preset.reputation.labels.some((l) => l.label === view.reputation));
  assert.equal(view.numbers.some((n) => /репутац/i.test(n.text)), false);
});

// --- 8б. Режим отладки (3.2 `:277-279`, 3.5 `:342`, README `:632-633`) --------

/** Прогон, какой кладёт в `live.lastRun` сам `index.js`: разбор плюс инжекты. */
const RUN = {
  debug: {
    mode: 'auto',
    source: 'B',
    moved: true,
    marker: '[ACADEMY t=+1 day]',
    applied: [
      { kind: 'grade', subjectId: 'chemistry', value: '4' },
      { kind: 'rel', teacherId: 'petrova', delta: -1 },
    ],
    rejected: [{ raw: 'grade=алхимия:5', reason: 'нет такого предмета' }],
    notes: ['сдвиг больше потолка обрезан'],
    idle: 0,
    stalled: false,
  },
  injects: [{ id: 'exam:e1:done', text: 'Свершилось: аналитическая химия — 4.' }],
  permission: 'сессия: аналитическая химия — средний балл 4,0, автомат возможен.',
  source: 'received',
  mesId: 12,
};

test('отладка выключена — наружу не уходит ничего', () => {
  for (const settings of [undefined, {}, { debug: false }, { debug: 'да' }]) {
    const view = debugView(RUN, started(), preset, settings);
    assert.equal(view.enabled, false);
    assert.equal(view.hasRun, false);
    assert.equal(view.head, '');
    assert.equal(view.source, '');
    assert.deepEqual(view.applied, []);
    assert.deepEqual(view.rejected, []);
    assert.deepEqual(view.injects, []);
    assert.deepEqual(view.divergences, []);
    assert.deepEqual(view.journal, [], 'журнал при выключенной отладке тоже не показывается');
  }
});

test('отладка включена — видно источник, разобранное, отброшенное и ушедшее в промпт', () => {
  const view = debugView(RUN, started(), preset, { debug: true });
  assert.equal(view.enabled, true);
  assert.equal(view.hasRun, true);

  // Что пришло и откуда.
  assert.match(view.head, /#12/);
  assert.match(view.head, /received/);
  assert.match(view.head, /auto/);
  // Какой источник сработал — теми же словами, что у `/academy-debug`.
  assert.match(view.source, /метка/);
  assert.match(view.source, /сдвинулось/);
  assert.match(view.marker, /ACADEMY/);
  assert.equal(view.stalled, '', 'время идёт — жалобы нет');

  // Что распозналось.
  assert.deepEqual(view.applied, [
    'оценка: chemistry — 4',
    'отношение: petrova -1',
  ]);
  // Что отброшено и почему.
  assert.deepEqual(view.rejected, ['grade=алхимия:5 — нет такого предмета']);
  assert.deepEqual(view.notes, ['сдвиг больше потолка обрезан']);
  // Что именно ушло в промпт.
  assert.deepEqual(view.injects, ['Свершилось: аналитическая химия — 4.']);
  assert.match(view.permission, /автомат возможен/);
});

test('отладка: остановившееся время названо прямо', () => {
  const stuck = { ...RUN, debug: { ...RUN.debug, source: null, moved: false, stalled: true, idle: 11 } };
  const view = debugView(stuck, started(), preset, { debug: true });
  assert.match(view.source, /не сработал ни один/);
  assert.match(view.source, /осталось на месте/);
  assert.match(view.stalled, /11 ответов/);
});

test('отладки ещё не было — сказано словами, а не пустым экраном', () => {
  const view = debugView(null, started(), preset, { debug: true });
  assert.equal(view.enabled, true);
  assert.equal(view.hasRun, false);
  assert.equal(view.noRun, DEBUG_TEXT.noRun);
});

test('отладка: расхождение исхода экзамена с версией модели видно (3.5)', () => {
  // Расхождение пишет `core/exams.mjs:resolveConflict` в журнал; панель его
  // оттуда и берёт, а не заводит свой учёт.
  let state = started();
  state.exams = {
    active: true,
    term: 0,
    items: [{
      id: 'e1', subjectId: 'chemistry', kind: preset.exams.kinds[0].id,
      day: state.calendar.day, outcome: '3', attempt: 1,
    }],
  };
  const res = resolveConflict(state, { examId: 'e1', modelSaid: '5' }, preset);
  assert.equal(res.divergence.applied, true, 'ядро расхождение записало — иначе проверять нечего');

  const view = debugView(RUN, res.state, preset, { debug: true });
  assert.equal(view.divergences.length, 1);
  const d = view.divergences[0];
  assert.equal(d.subject, 'аналитическая химия');
  assert.equal(d.computed, '3');
  assert.equal(d.said, '5');
  assert.match(d.text, /посчитано 3/);
  assert.match(d.text, /аналитическая химия/);

  // И в журнале на вкладке та же запись видна целиком.
  assert.ok(view.journal.length > 0);
  assert.ok(view.journal.some((e) => /аналитическая химия/.test(e.text)));
});

test('отладка: расхождение, которого не разобрали, отличается от применённого', () => {
  let state = started();
  state.exams = {
    active: true,
    term: 0,
    items: [{ id: 'e1', subjectId: 'chemistry', kind: preset.exams.kinds[0].id, day: state.calendar.day, outcome: '3' }],
  };
  const res = resolveConflict(state, { examId: 'e1', modelSaid: 'что-то невнятное' }, preset);
  assert.equal(res.divergence.applied, false);

  const view = debugView(null, res.state, preset, { debug: true });
  assert.equal(view.divergences.length, 1);
  assert.equal(view.divergences[0].applied, false);
  assert.match(view.divergences[0].text, /разобрать не удалось/);
});

test('отладка на живом прогоне: поля разбора называются так, как их кладёт движок', () => {
  // Ручной `RUN` выше — договор с `index.js`; здесь тот же договор проверяется
  // настоящим `applyResponse`, чтобы переименование поля в движке не осталось
  // незамеченным до первого живого запуска.
  const run = applyResponse(started(), 'Пара идёт.\n<!-- [ACADEMY t=+1 day] -->', preset, { mode: 'marker' });
  const view = debugView({ ...run, injects: run.injects, permission: '', source: 'received', mesId: 1 },
    run.state, preset, { debug: true });
  assert.equal(view.hasRun, true);
  assert.match(view.head, /#1/);
  assert.ok(view.source.length > 0);
  assert.equal(typeof view.marker, 'string');
  assert.ok(Array.isArray(view.applied));
});

test('галочка отладки живёт в настройках и по умолчанию выключена', () => {
  assert.equal(settingsView(started(), {}, preset).debug, false);
  assert.equal(settingsView(started(), { debug: true }, preset).debug, true);
  assert.equal(settingsView(started(), { debug: 'да' }, preset).debug, false);
});

test('слова отладки — технические и в пресеты не едут', () => {
  // Сторож правила: `MESSAGE_RECEIVED`, «источник», «инжект» — слова механизма,
  // а не заведения, и в `DEFAULT_UI` их быть не должно.
  for (const key of Object.keys(DEBUG_TEXT)) {
    assert.equal(key in DEFAULT_UI, false, `техническое слово «${key}» просочилось в словарь пресета`);
  }
});

// --- 9. Лексика панели приходит из пресета -----------------------------------
//
// Экзамен из раздела 1 плана, только для панели, а не для ядра: один и тот же
// прогон гоняется по всем пресетам и обязан дать три РАЗНЫХ текста. Список
// пресетов — одна строка, как в `test/presets.test.mjs`; четвёртый подключается
// дописыванием имени файла.

const PRESET_FILES = ['ru-university.json', 'jp-highschool.json', 'magic-academy.json'];
const PRESETS = PRESET_FILES.map((f) => parsePreset(
  readFileSync(new URL(`../presets/${f}`, import.meta.url), 'utf8'),
));

/** Понедельник, учебный день у всех трёх, ни у кого не каникулы. */
const NEUTRAL_DAY = '2026-09-07';

// Предметы и преподаватели нарочно безлики: всё, что различается в тексте,
// обязано прийти из пресета, а не отсюда.
const FLAT_SUBJECTS = [
  { id: 'alpha', name: 'Альфа', teacherId: 'first' },
  { id: 'beta', name: 'Бета', teacherId: 'second' },
];
const FLAT_TEACHERS = [{ id: 'first', name: 'Первый' }, { id: 'second', name: 'Второй' }];

/** Одинаковый для всех пресетов семестр: тот же день, то же время, те же данные. */
function sameRun(preset) {
  const state = createState(preset, {
    startDay: NEUTRAL_DAY, subjects: FLAT_SUBJECTS, teachers: FLAT_TEACHERS,
  });
  state.schedule = buildSchedule(state.subjects, preset);
  state.started = true;
  state.calendar.time = '09:30';
  state.calendar.precision = 'datetime';
  const withGrade = addGrade(state, { subjectId: 'alpha', value: preset.grades.values[0].value }, preset).state;
  const withDebt = setDebt(withGrade, 'beta', true, preset);
  withDebt.exams = {
    active: false,
    items: [{ id: 'e1', subjectId: 'beta', kind: preset.exams.kinds[0].id, day: NEUTRAL_DAY }],
  };
  return withDebt;
}

/**
 * Весь текст, который панель показала бы на этом прогоне, одной строкой:
 * «Сегодня», «Зачётка», ярлыки вкладок, пустые экраны и претензии проверки.
 * Ничего, кроме того, что реально выходит на экран.
 */
function panelText(preset) {
  const state = sameRun(preset);
  const today = todayView(state, preset);
  const book = gradebookView(state, preset);
  const weekend = todayView({ ...state, calendar: { ...state.calendar, day: '2026-09-13' } }, preset);
  const empty = stateHealth(null, preset);
  const check = validateSubjectRows({ subjects: [], teachers: [{ name: 'Первый' }] }, preset);
  const settings = settingsView(state, {}, preset);
  // Слова про несколько периодов в году. У пресета с одним периодом такой день
  // не наступает никогда, но словарь у него всё равно свой, и протечка «между
  // семестрами» в магическую академию — ровно та ошибка, что и остальные.
  const U = uiLabels(preset);
  const many = [
    formatWeek(5, preset, 'between'), U.phases.break, U.silentBreak,
    fill(U.termNumber, { n: 2 }), fill(U.examsTerm, { name: fill(U.termNumber, { n: 2 }) }),
  ];

  // Вкладка «Люди»: её словарь такой же преетный, как остальные, и протечка
  // «наставника» в японскую школу — ровно та же ошибка. Один преподаватель
  // нарочно без черт и без предмета, у другого — переход ярлыка из журнала.
  const relPreset = preset.relations.labels;
  const shifted = changeRelation(
    changeRelation(state, { teacherId: 'first', delta: relPreset[relPreset.length - 1].upTo }, preset).state,
    { teacherId: 'first', delta: -(relPreset[relPreset.length - 1].upTo * 2) }, preset,
  ).state;
  const people = peopleView({
    ...shifted,
    subjects: [...shifted.subjects, { id: 'gamma', name: 'Гамма', teacherId: null }],
    teachers: [...shifted.teachers, { id: 'third', name: 'Третий', traits: [], relation: 0 }],
  }, preset);

  return [
    ...many,
    today.weekLine, today.phaseLabel, today.now.title, today.now.slotText, today.next.when,
    ...today.numbers.map((n) => n.text),
    weekend.silentReason,
    book.scoreName, ...book.numbers.map((n) => n.text),
    ...peopleStrings(people), uiLabels(preset).orphanSubjectsTitle,
    uiLabels(preset).relationTitle, uiLabels(preset).peopleNone, uiLabels(preset).tabPeople,
    empty.title, empty.text,
    ...check.errors.map((e) => e.text), ...check.notes,
    ...settings.startBlockers,
    ...tabsFor(preset).map((t) => t.label),
  ].join(' | ');
}

/**
 * Чужие слова: у каждого пресета — корни, которые в его тексте означали бы
 * протечку из кода или из соседнего пресета. Проверка идёт по началу слова
 * (`\b` в русском тексте бесполезен: `\w` знает только латиницу), иначе
 * «понедельник» считался бы «неделей».
 */
const FOREIGN = {
  'ru-university': ['урок', 'седмиц', 'прорех', 'заняти', 'дисциплин', 'триместр'],
  'jp-highschool': ['пара', 'пары', 'пар ', 'хвост', 'седмиц', 'прорех', 'дисциплин', 'семестр'],
  'magic-academy': ['пара', 'пары', 'пар ', 'хвост', 'недел', 'урок', 'семестр', 'триместр'],
};

const startsWord = (stem) => new RegExp(`(?<!\\p{L})${stem}`, 'iu');

for (const preset of PRESETS) {
  test(`пресет ${preset.id}: панель не говорит словами чужого заведения`, () => {
    const text = panelText(preset);
    for (const stem of FOREIGN[preset.id]) {
      assert.ok(!startsWord(stem).test(text),
        `в тексте пресета ${preset.id} нашлось чужое «${stem}»: ${text}`);
    }
  });

  test(`пресет ${preset.id}: словарь панели полон`, () => {
    // Недостающий ключ — не авария (сработает умолчание), но умолчание написано
    // словами русского вуза, и в чужом пресете это ровно та протечка, ради
    // которой всё затевалось.
    const missing = Object.keys(DEFAULT_UI).filter((k) => !(preset.ui && k in preset.ui));
    assert.deepEqual(missing, [], `пресет ${preset.id} не перевёл: ${missing.join(', ')}`);
  });
}

test('одинаковый прогон под тремя пресетами даёт три разных текста панели', () => {
  const texts = PRESETS.map(panelText);
  for (let i = 0; i < texts.length; i += 1) {
    for (let j = i + 1; j < texts.length; j += 1) {
      assert.notEqual(texts[i], texts[j],
        `${PRESETS[i].id} и ${PRESETS[j].id} показали один и тот же текст — слово просочилось из кода`);
    }
  }
  // И проверка не вырождена: род числительного действительно разный.
  assert.match(texts[0], /1-я пара/);
  assert.match(texts[1], /1-й урок/);
  assert.match(texts[2], /1-е занятие/);
});

// --- 10. Несколько учебных периодов за год -----------------------------------
//
// Японский пресет: три триместра, у каждого своя сессия. Год не подставляется
// руками — он проживается настоящим ядром (`applyResponse` с меткой источника
// B), потому что и границы периодов, и открытие с закрытием сессии считает
// именно оно, а состояние, собранное в тесте вручную, проверяло бы фантазию
// теста, а не панель.

const jp = PRESETS.find((p) => p.id === 'jp-highschool');

/** Среда, начало первого триместра: неделя начала — первая целиком. */
const JP_START = '2026-04-08';

/** Первый триместр: 14 учебных недель + 1 экзаменационная, дальше второй. */
const JP_WEEK_TWO = '2026-04-13'; // понедельник второй недели
const JP_EXAMS_ONE = '2026-07-13'; // 15-я неделя первого триместра
const JP_BETWEEN = '2026-07-20'; // триместр кончился, летние каникулы ещё нет
const JP_TERM_TWO = '2026-09-07'; // вторая неделя второго триместра
const JP_EXAMS_TWO = '2026-12-14'; // экзаменационная неделя второго

function jpStarted() {
  const state = createState(jp, {
    startDay: JP_START, subjects: FLAT_SUBJECTS, teachers: FLAT_TEACHERS,
  });
  state.schedule = buildSchedule(state.subjects, jp);
  state.started = true;
  return state;
}

/**
 * Прожить до дня лентой ответов модели. Шаг не длиннее потолка `maxTimeShift`:
 * сдвиг больше потолка ядро не примет, и это тоже часть настоящего прогона.
 */
function liveUntil(state, day) {
  let s = state;
  let left = diffDays(s.calendar.day, day);
  while (left > 0) {
    const step = Math.min(left, 28);
    s = applyResponse(s, `День идёт своим чередом.\n<!-- [ACADEMY t=+${step} day] -->`, jp, { mode: 'marker' }).state;
    left -= step;
  }
  assert.equal(s.calendar.day, day, `прожили до ${day}`);
  return s;
}

test('японская школа: панель называет триместр и считает недели заново', () => {
  const first = todayView(liveUntil(jpStarted(), JP_WEEK_TWO), jp);
  assert.equal(first.termLine, 'первый триместр');
  assert.equal(first.weekLine, '2-я неделя триместра');

  const second = liveUntil(jpStarted(), JP_TERM_TWO);
  const view = todayView(second, jp);
  assert.equal(view.termLine, 'второй триместр', 'человек видит, чей это счёт недель');
  assert.equal(view.week, 2, 'во втором триместре счёт недель начинается заново, а не с двадцатой');
  assert.equal(view.weekLine, '2-я неделя триместра');
  // Экран и промпт обязаны говорить одно и то же: строка состояния считает
  // неделю тем же `weekIndex` с пресетом.
  assert.match(statusLine(second, jp), /2-я неделя триместра/);
});

test('между триместрами панель молчит своей фразой, а не чужой', () => {
  const state = liveUntil(jpStarted(), JP_BETWEEN);
  const view = todayView(state, jp);

  assert.equal(view.phase, 'break');
  assert.equal(view.phaseLabel, 'между триместрами', 'у промежутка есть имя, он не безымянный');
  assert.equal(view.silent, true, 'уроков между триместрами нет, показывать их нельзя');
  assert.equal(view.silentReason, 'Между триместрами — уроков нет.');
  assert.equal(view.now, null);
  // Номер недели прошлого триместра тут ничего не значит и на экран не идёт.
  assert.equal(view.weekLine, 'перерыв между триместрами');
  // («понедельник» в дате — не номер недели, поэтому проверка по шаблону.)
  assert.equal(view.numbers.some((n) => /^\d+-я неделя/.test(n.text)), false);
});

test('сессия названа своим триместром, а несданное прошлого ушло', () => {
  const first = liveUntil(jpStarted(), JP_EXAMS_ONE);
  const book1 = gradebookView(first, jp);
  assert.equal(book1.examsActive, true);
  assert.match(book1.examsTermLine, /первый триместр/);
  assert.ok(book1.openExams.length, 'в свою сессию несданное видно');
  assert.ok(book1.openExams.every((e) => e.id.startsWith('0:')));

  // Сессия кончилась вместе с триместром — «идёт сессия» на экране не висит.
  const between = gradebookView(liveUntil(first, JP_BETWEEN), jp);
  assert.equal(between.examsActive, false);
  assert.equal(between.examsTermLine, '', 'закрытую сессию панель не называет');

  const second = liveUntil(first, JP_EXAMS_TWO);
  const book2 = gradebookView(second, jp);
  assert.equal(second.exams.term, 1);
  assert.match(book2.examsTermLine, /второй триместр/);
  assert.ok(book2.openExams.length, 'у второго триместра своя сессия по тем же предметам');
  assert.equal(book2.openExams.some((e) => e.id.startsWith('0:')), false,
    'несданное первого триместра в текущей сессии не висит: пересдавать его негде');
});

test('период в году один — панель его не называет вовсе', () => {
  // Сторож умолчаний: у русского вуза «семестр» один, и лишней строки на
  // экране быть не должно ни при каком дне.
  for (const day of [TERM, '2024-11-05', '2025-01-07']) {
    const view = todayView(started({ day }), preset);
    assert.equal(view.termLine, '', day);
    assert.equal(view.termsCount, 1, day);
  }
});

test('пресет без блока ui печатает ровно то, что панель печатала до него', () => {
  // Сторож умолчаний: `DEFAULT_UI` — не «примерно как было», а тот же текст.
  const bare = { ...preset, ui: undefined };
  assert.equal(formatWeek(3, bare), '3-я неделя');
  assert.equal(formatWeek(3, undefined), '3-я неделя');
  assert.equal(stateHealth(null, bare).title, 'Семестр не начат');

  const view = todayView(started({ day: '2024-11-05' }), bare);
  assert.equal(view.silentReason, 'Каникулы — занятий нет.');
  assert.equal(todayView(started({ time: '08:40', precision: 'datetime' }), bare).now.slotText,
    '1-я пара, 08:30–10:05');
  assert.equal(uiLabels(bare).debtTag, 'хвост');
  // Ярлыки трёх вкладок, что были до этапа 3, сверяются поимённо: список целиком
  // сверять больше нельзя — четвёртая вкладка «Люди» пришла из плана (3.9), и
  // требование «умолчания не меняются» относится к тексту умолчаний, а не к
  // числу вкладок.
  const tabLabels = Object.fromEntries(tabsFor(bare).map((t) => [t.id, t.label]));
  assert.equal(tabLabels.today, 'Сегодня');
  assert.equal(tabLabels.gradebook, 'Зачётка');
  assert.equal(tabLabels.settings, 'Настройки');
});

test('отладка печатает исход контрольного, а не пустоту после тире', () => {
  // Поймано на живой таверне: `engine.mjs:487` кладёт исход в поле `value`
  // (`exam: { examId, subjectId, value, reason }`), а строка отладки читала
  // `outcome` — поля с таким именем в объекте нет, и человек, разбирающийся,
  // что случилось на сессии, видел «контрольное: алхимия —».
  const V = preset.vocab;
  const item = { kind: 'exam', examId: 'e1', subjectId: 'алхимия', value: '4', reason: 'roll' };
  assert.equal(describeApplied(item, V), 'контрольное: алхимия — 4');
  // Тире без исхода не остаётся: пустое событие печатается без хвоста.
  assert.equal(describeApplied({ kind: 'exam', subjectId: 'алхимия' }, V), 'контрольное: алхимия —');
});

test('разбор времени в отладке читается во всех трёх формах', () => {
  // Поймано на живой таверне: абсолютный переход печатался голым «время:» —
  // ни дня, ни часов. У него нет ни `unit`, ни `reason`, а строка собиралась
  // только из них. Три формы перехода — три разные записи в `applied`.
  const V = preset.vocab;
  assert.equal(
    describeApplied({ kind: 'time', source: 'A', day: '2026-09-02', time: '10:15' }, V),
    'время: 2026-09-02 10:15',
  );
  assert.equal(
    describeApplied({ kind: 'time', source: 'B', unit: 'day', n: 1 }, V),
    'время: +1 day',
  );
  assert.equal(
    describeApplied({ kind: 'time', source: 'B', reason: 'сцена продолжается, время на месте' }, V),
    'время: сцена продолжается, время на месте',
  );
  // Пустой строки после двоеточия не бывает ни при какой форме.
  assert.equal(describeApplied({ kind: 'time' }, V), 'время: сдвинулось');
});

// --- 12. Живой прогон на `deepseek-v4-flash`: что панель говорила неправдой ---
//
// Три находки из живой таверны (`etap-live2-fixes.md`). Все три — про строки,
// которые человек читает глазами и которым до сих пор верили на слово.

test('счётчик лорбука: потолок стоит при записях, а не при токенах', async () => {
  const { buildLorebook } = await import('../core/lorebook.mjs');
  const state = started();
  const measure = buildLorebook(state, preset).measure;

  // Фикстура не вырождена: токенов заведомо больше потолка записей, поэтому
  // старая фраза «примерно {tokens} токенов из {cap}» показывала бы
  // многократное превышение там, где записей всего три из шестидесяти.
  assert.ok(measure.tokens > measure.cap,
    `замер обязан быть таким, чтобы подмена числа была видна: ${JSON.stringify(measure)}`);

  const view = settingsView(state, {}, preset, { lorebook: { enabled: true, measure } });
  const line = view.lorebook.measureLine;

  const m = /^Записей (\d+) из (\d+), примерно (\d+) токенов\.$/.exec(line);
  assert.ok(m, `строка замера читается не так: «${line}»`);
  assert.equal(Number(m[1]), measure.entries, 'первое число — сколько записей');
  assert.equal(Number(m[2]), measure.cap, '«из {cap}» — потолок ЧИСЛА ЗАПИСЕЙ (core/lorebook.mjs: entryCap)');
  assert.equal(Number(m[3]), measure.tokens, 'токены названы отдельно и ни с чем не сравниваются');
  assert.equal(/токенов из/.test(line), false, `токены снова приписаны потолку записей: «${line}»`);

  assert.equal(view.lorebook.overCap, false, 'три записи из шестидесяти — это не превышение');
  assert.equal(view.lorebook.overCapLine, '', 'и предупреждения о превышении быть не должно');
});

test('фраза про превышение потолка не спорит со счётчиком', () => {
  // `withinCap` считается по записям (`entries <= cap`), поэтому и предупреждение
  // обязано говорить про записи: рядом стоит «Записей 61 из 60».
  const measure = { entries: 61, chars: 100, tokens: 40, cap: 60, withinCap: false };
  const view = settingsView(started(), {}, preset, { lorebook: { enabled: true, measure } });

  assert.equal(view.lorebook.measureLine, 'Записей 61 из 60, примерно 40 токенов.');
  assert.equal(view.lorebook.overCap, true);
  assert.match(view.lorebook.overCapLine, /Записей больше потолка/,
    'превышение названо тем же, чем оно посчитано, — числом записей');
  for (const p of PRESETS) {
    assert.match(uiLabels(p).lorebookOverCap, /Записей больше потолка/, `пресет ${p.id} говорит про другое`);
  }
});

test('справка /academy-time не подсовывает дату из чужого года', () => {
  // Справка регистрируется один раз за загрузку страницы и живёт вечно, поэтому
  // конкретной даты в ней быть не может ни в одном пресете: скопировав её через
  // год, человек получил бы отказ по правилу 3.2 (откаты запрещены), и причина
  // отказа из подсказки не читалась бы.
  for (const p of [null, ...PRESETS]) {
    const help = uiLabels(p).cmdTimeHelp;
    assert.equal(/\d{4}-\d{2}-\d{2}/.test(help), false,
      `в справке ${(p && p.id) || 'умолчания'} стоит конкретная дата: ${help}`);
    assert.ok(help.includes('ГГГГ-ММ-ДД'), `форму дня всё-таки надо показать: ${help}`);
  }
});

test('в словах отладки нет ни одного слова заведения', () => {
  // Обещание в шапке `DEBUG_TEXT`: «источник», «инжект», «отброшено» — слова
  // механизма, они переводу не подлежат; а вот название учебного периода
  // отладка обязана брать у пресета. Заголовок «Разрешение сессии» это обещание
  // нарушал и говорил «сессия» в магической академии.
  const forbidden = /сесси|семестр|тримест|пара|пары|предмет|преподавател|зачётк|хвост|дисциплин|наставник/i;
  for (const [key, value] of Object.entries(DEBUG_TEXT)) {
    assert.equal(forbidden.test(String(value)), false, `DEBUG_TEXT.${key} говорит словом заведения: ${value}`);
  }
});

// --- 9.2 и 9.3.1: отладка реплики человека и галочка макроса ------------------

test('9.2 отладка называет промотку, телефонный ход и выброшенное время словами механизма', async () => {
  const { describeApplied, settingsView } = await import('../ui.js');
  const skip = describeApplied({ kind: 'time-skip', days: 7, cap: 8, policy: 'attend', examDay: '2024-12-23' }, {});
  assert.match(skip, /промотка времени/);
  assert.match(skip, /потолок 8/);
  assert.match(skip, /присутствие/);
  assert.match(skip, /2024-12-23/);
  assert.match(describeApplied({ kind: 'phone-turn' }, {}), /телефон/);
  assert.match(describeApplied({ kind: 'time-dropped', reason: 'phone-turn', events: 1 }, {}), /не проведено/);
  // Слова отладки — механизма, не заведения (та же проверка, что у DEBUG_TEXT).
  const forbidden = /сесси|семестр|тримест|пара|пары|предмет|преподавател|зачётк|хвост|дисциплин|наставник/i;
  for (const line of [skip, describeApplied({ kind: 'phone-turn' }, {})]) assert.equal(forbidden.test(line), false, line);

  // 9.3.1: галочка «через макрос» доезжает до панели, умолчание — выключена.
  const off = settingsView(null, {}, null);
  assert.equal(off.statusViaMacro, false);
  const on = settingsView(null, { statusViaMacro: true }, null);
  assert.equal(on.statusViaMacro, true);
});

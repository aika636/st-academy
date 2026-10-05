// Секретарь (`core/analysis`), правило экзаменов «решает сюжет» и протокол
// ответов для плашки под сообщением.
//
// Три слоя: чистое ядро (промпт, разбор ответа секретаря, текст для движка),
// движок (`sitExam` по правилу чата) и сквозной прогон через фальшивую таверну —
// кнопка «разобрать», свайп, вычёркивание вывода, автоматический разбор.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildAnalysisPrompt, parseAnalysis, effectiveText, tokenText, analysisMarker, tokenOf,
} from '../core/analysis.mjs';
import { keepMarkerKinds } from '../core/parse-marker.mjs';
import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { scheduleExams, examRule } from '../core/exams.mjs';
import { sitExam } from '../core/engine.mjs';
import { readLedger, LEDGER_SIZE } from '../storage.js';
import { rowText, summaryText } from '../mes-panel.js';

const loadPresetFile = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));
const preset = loadPresetFile('ru-university');
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../manifest.json', import.meta.url)), 'utf8'));

const SUBJECTS = [
  { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'ivanov' },
  { id: 'history', name: 'история', teacherId: 'sidorova' },
  { id: 'math', name: 'высшая математика', teacherId: 'kuznecov' },
];
const TEACHERS = [
  { id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['злопамятна'] },
  { id: 'ivanov', name: 'Иванов Пётр Ильич', traits: ['добродушен'] },
  { id: 'sidorova', name: 'Сидорова Мария Львовна', traits: ['придирается к опозданиям'] },
  { id: 'kuznecov', name: 'Кузнецов Илья Львович', traits: ['требователен'] },
];

function semester(day = '2024-09-03', edit = null) {
  const s = createState(preset, {
    startDay: '2024-09-02', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
  });
  s.started = true;
  s.calendar.day = day;
  if (edit) edit(s);
  return s;
}

const lexicon = (s) => ({ ...preset, subjects: s.subjects, teachers: s.teachers, survey: s.survey, names: { user: 'Аня', char: 'Рассказчик' } });

// --- ядро ---------------------------------------------------------------------

test('секретарь: промпт называет id предметов и преподавателей, шкалу и героиню', () => {
  const s = semester();
  const { system, user } = buildAnalysisPrompt(s, preset, {
    reply: 'Петрова поставила Ане пятёрку.', userText: 'Аня отвечает у доски.', statusLine: 'вторник, 2-я пара', heroine: 'Аня',
  });
  assert.ok(system.length > 0);
  for (const id of ['chemistry', 'petrova', 'kuznecov']) assert.ok(user.includes(id), id);
  assert.ok(user.includes('зачёт'), 'шкала оценок');
  assert.ok(user.includes('Аня получила оценку'));
  assert.ok(user.includes('Петрова поставила Ане пятёрку.'));
  assert.ok(user.includes('Аня отвечает у доски.'));
  assert.ok(user.includes('вторник, 2-я пара'));
  assert.ok(user.includes('Время и дату не пиши'));
});

test('секретарь: в день контрольного промпт называет его', () => {
  const s = scheduleExams(semester('2024-12-23'), preset, { day: '2024-12-23', term: 0 });
  const { user } = buildAnalysisPrompt(s, preset, { reply: 'Зачёт.' });
  assert.match(user, /Сегодня по расписанию: .*зачёт: аналитическая химия \(chemistry\)/);
});

test('секретарь: ответ → канонические токены; время, рассуждения и чужие имена отброшены', () => {
  const s = semester();
  const raw = [
    '<think>может, <!-- [ACADEMY grade=физика:2] --> ? нет</think>',
    'Вот: <!-- [ACADEMY t=+1 grade=аналитическая химия:5 rel=Петрова:minor+:помогла с опытом skip=история late=math rel=Аня:major+] -->',
  ].join('\n');
  const res = parseAnalysis(raw, lexicon(s));
  assert.equal(res.found, true);
  assert.deepEqual(res.tokens, [
    'skip=history', 'late=math', 'grade=chemistry:5', 'rel=petrova:minor+:помогла с опытом',
  ].sort((a, b) => res.tokens.indexOf(a) - res.tokens.indexOf(b)));
  assert.equal(res.tokens.length, 4);
  assert.ok(!res.tokens.some((t) => t.startsWith('t=')), 'время секретарь не пишет');
  assert.ok(!res.tokens.some((t) => t.includes('physics')), 'черновик из рассуждения не подобран');
  assert.ok(res.rejected.some((r) => /стоп-лист/.test(r.reason)), 'героиня — не преподаватель');
});

test('короткое имя узнаётся, только если оно однозначно', () => {
  const s = semester();
  const lex = lexicon(s);
  assert.deepEqual(parseAnalysis('<!-- [ACADEMY grade=химия:5 rel=Львовна:minor-] -->', lex).tokens, ['grade=chemistry:5', 'rel=sidorova:minor-']);
  const two = { ...lex, subjects: [...s.subjects, { id: 'organic', name: 'органическая химия', teacherId: 'petrova' }] };
  const res = parseAnalysis('<!-- [ACADEMY grade=химия:5 grade=органическая химия:4] -->', two);
  assert.deepEqual(res.tokens, ['grade=organic:4'], '«химия» теперь двусмысленна');
  assert.ok(res.rejected.some((r) => /неизвестный предмет/.test(r.reason)));
});

test('секретарь: пустая метка — «ничего не случилось», без метки — сбой', () => {
  const s = semester();
  assert.deepEqual(parseAnalysis('<!-- [ACADEMY] -->', lexicon(s)), { found: true, tokens: [], rejected: [] });
  assert.equal(parseAnalysis('Ничего не произошло.', lexicon(s)).found, false);
});

test('секретарь: повод чистится от знаков, ломающих метку, токен читается обратно тем же', () => {
  const t = tokenOf({ kind: 'rel', teacherId: 'petrova', delta: -2, impact: 'major', reason: 'сорвала [опыт] a=b -->' });
  assert.equal(t, 'rel=petrova:major-:сорвала опыт a b');
  const s = semester();
  assert.deepEqual(parseAnalysis(analysisMarker([t]), lexicon(s)).tokens, [t]);
  assert.equal(tokenOf({ kind: 'time', unit: 'day', n: 1 }), null);
});

test('секретарь: разбор главнее метки рассказчика — из неё остаётся только время', () => {
  const text = 'Сцена. <!-- [ACADEMY t=+1 grade=химия:3] -->';
  assert.equal(effectiveText(text, null), text, 'разбора нет — ответ как есть');
  const out = effectiveText(text, ['grade=chemistry:5']);
  assert.ok(out.includes('<!-- [ACADEMY t=+1] -->'));
  assert.ok(out.endsWith('<!-- [ACADEMY grade=chemistry:5] -->'));
  assert.ok(!out.includes('химия:3'));
  assert.equal(keepMarkerKinds('без метки', ['time']), 'без метки');
});

test('секретарь: токен словами для плашки', () => {
  const lex = lexicon(semester());
  assert.equal(tokenText('grade=chemistry:5', lex), 'оценка: аналитическая химия — 5');
  assert.equal(tokenText('skip=history', lex), 'прогул: история');
  assert.equal(tokenText('rel=petrova:minor+:помогла', lex), 'Петрова Анна Сергеевна: теплее (немного) — помогла');
  assert.equal(tokenText('grade=unknown:5', lex), 'grade=unknown:5', 'не читается — как есть');
});

// --- правило экзаменов ----------------------------------------------------------

const inSession = (rule) => {
  const s = scheduleExams(semester('2024-12-23'), preset, { day: '2024-12-23', term: 0 });
  if (rule) s.examBy = rule;
  return s;
};

test('правило: поля нет — кубик (старые чаты играют по-прежнему)', () => {
  assert.equal(examRule(semester()), 'dice');
  assert.equal(examRule({ examBy: 'story' }), 'story');
  assert.equal(examRule({ examBy: 'что-то' }), 'dice');
  const r = sitExam(inSession(), preset, { seed: 'x' });
  assert.equal(r.applied, true);
  assert.ok(r.exam.check, 'бросок был');
});

test('правило «сюжет»: сцена промолчала — никто не садился, броска нет', () => {
  const s = inSession('story');
  const r = sitExam(s, preset, { seed: 'x' });
  assert.equal(r.applied, false);
  assert.deepEqual(r.state.exams.items.filter((i) => i.outcome), []);
});

test('правило «сюжет»: исход из сцены ложится как есть — без броска и без расхождения', () => {
  const s = inSession('story');
  const item = s.exams.items.find((i) => i.subjectId === 'chemistry');
  const r = sitExam(s, preset, { seed: 'x', examId: item.id, modelSaid: 'незачёт' });
  assert.equal(r.applied, true);
  assert.equal(r.exam.value, 'незачёт');
  assert.equal(r.exam.reason, 'story');
  assert.equal(r.exam.check, null);
  assert.equal(r.divergence, null);
  const done = r.state.exams.items.find((i) => i.id === item.id);
  assert.equal(done.outcome, 'незачёт');
  assert.ok(!(done.rolls || []).some((x) => Number.isFinite(x.roll)), 'кубик не бросался');
});

test('правило «сюжет»: кубик соседа в реплике — тоже сцена', () => {
  const s = inSession('story');
  const r = sitExam(s, preset, { seed: 'x', dice: { tier: 'success', roll: 15, dc: 10 } });
  assert.equal(r.applied, true);
  assert.equal(r.exam.reason, 'story');
  assert.equal(r.exam.external.source, 'dice');
});

// --- протокол и плашка -----------------------------------------------------------

test('протокол: чужое выбрасывается, длина режется', () => {
  const list = [
    { stamp: 'a', rows: ['x', 5, ''], day: '2024-09-03', time: '10:15', tokens: ['grade=chemistry:5', 7], marker: true, at: 1 },
    { stamp: '', rows: [] },
    null,
    { stamp: 'b', tokens: 'не список' },
  ];
  const out = readLedger({ v: 1, list });
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].rows, ['x']);
  assert.deepEqual(out[0].tokens, ['grade=chemistry:5']);
  assert.equal(out[1].tokens, null);
  assert.deepEqual(readLedger({ v: 99, list }), []);
  const many = Array.from({ length: LEDGER_SIZE + 5 }, (_, i) => ({ stamp: `s${i}` }));
  assert.equal(readLedger({ v: 1, list: many }).length, LEDGER_SIZE);
  assert.equal(readLedger({ v: 1, list: many })[0].stamp, 's5', 'старые уходят первыми');
});

test('плашка: строки событий словами, отметка «был» — не событие', () => {
  assert.equal(rowText({ kind: 'grade', subject: 'химия', value: '5', label: 'отлично' }), 'химия: 5 (отлично)');
  assert.equal(rowText({ kind: 'grade', subject: 'химия', value: 'зачёт', label: 'зачёт' }), 'химия: зачёт');
  assert.equal(rowText({ kind: 'attendance', subject: 'история', status: 'skip' }), 'прогул: история');
  assert.equal(rowText({ kind: 'attendance', subject: 'история', status: 'present' }), '');
  assert.equal(rowText({ kind: 'relation', teacher: 'Петрова', from: 'холодна', to: 'нейтральна', changed: true }), 'Петрова: холодна → нейтральна');
  assert.equal(rowText({ kind: 'relation', teacher: 'Петрова', direction: 'up', changed: false, reason: 'помогла' }), 'Петрова: теплее — помогла');
  assert.equal(rowText({ kind: 'exam', subject: 'химия', value: 'зачёт', label: 'зачёт', passed: true }), 'химия: зачёт — сдано');
  assert.equal(rowText({ kind: 'что-то' }), '');
});

test('плашка: сводка — когда и что, лишнее «ещё N»', () => {
  assert.equal(summaryText({ date: 'вторник, 3 сентября', time: '10:15', rows: [] }), 'вторник, 3 сентября · 10:15 | без перемен');
  assert.equal(summaryText({ rows: ['a', 'b', 'c', 'd'] }), 'a · b · ещё 2');
});

// --- сквозной прогон ---------------------------------------------------------------

function fakeTavern(answer) {
  const listeners = new Map();
  const prompts = {};
  const tavern = {
    chat: [],
    chatMetadata: {},
    extensionSettings: {},
    powerUserSettings: { encode_tags: false, experimental_macro_engine: true },
    extension_prompt_types: { NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 },
    extension_prompt_roles: { SYSTEM: 0, USER: 1, ASSISTANT: 2 },
    event_types: {
      MESSAGE_RECEIVED: 'message_received',
      MESSAGE_SWIPED: 'message_swiped',
      MESSAGE_EDITED: 'message_edited',
      MESSAGE_UPDATED: 'message_updated',
      MESSAGE_DELETED: 'message_deleted',
      CHAT_CHANGED: 'chat_id_changed',
      GENERATION_STARTED: 'generation_started',
      GENERATION_ENDED: 'generation_ended',
    },
    eventSource: {
      on(name, fn) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(fn);
      },
      async emit(name, ...args) {
        for (const fn of listeners.get(name) || []) await fn(...args);
      },
    },
    prompts,
    extensionPrompts: prompts,
    setExtensionPrompt(key, value, position, depth, scan, role) {
      prompts[key] = { value: String(value), position, depth, scan, role };
    },
    saveMetadataDebounced() {},
    async saveMetadata() {},
    saveSettingsDebounced() {},
    chatId: 'chat-s',
    getCurrentChatId: () => tavern.chatId,
    macros: { registry: {}, category: { MISC: 'misc' }, register(name, def) { tavern.macros.registry[name] = def; } },
    registerMacro() {},
    name1: 'Аня',
    name2: 'Рассказчик',
    /** Что спросили у секретаря. */
    asked: [],
    answer,
    async generateRaw({ prompt, systemPrompt }) {
      tavern.asked.push({ prompt, systemPrompt });
      return typeof tavern.answer === 'function' ? tavern.answer(prompt) : tavern.answer;
    },
  };
  return tavern;
}

globalThis.toastr = Object.fromEntries(['success', 'info', 'warning', 'error'].map((k) => [k, () => {}]));

async function boot(opts = {}) {
  const tavern = fakeTavern(opts.answer || '<!-- [ACADEMY] -->');
  const s = semester(opts.day || '2024-09-03', opts.edit);
  tavern.chatMetadata.academy = s;
  Object.assign(tavern.extensionSettings, opts.settings || {});
  globalThis.SillyTavern = { getContext: () => tavern };
  globalThis.fetch = async (url) => {
    const str = String(url);
    const m = /\/presets\/([\w-]+)\.json$/.exec(str);
    if (m) return { ok: true, status: 200, json: async () => loadPresetFile(m[1]) };
    if (str.endsWith('/manifest.json')) return { ok: true, status: 200, json: async () => manifest };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const mod = await import(`../index.js?run=${Math.random()}`);
  await mod.__seam.ready;
  tavern.seam = mod.__seam;
  return tavern;
}

async function reply(tavern, text) {
  tavern.chat.push({ mes: 'Аня идёт на пару.', is_user: true, is_system: false });
  tavern.chat.push({ mes: text, is_user: false, is_system: false, swipes: [text], swipe_id: 0 });
  const id = tavern.chat.length - 1;
  await tavern.eventSource.emit('message_received', id, 'normal');
  return id;
}

const stateOf = (tavern) => tavern.chatMetadata.academy;
const grades = (tavern, id) => stateOf(tavern).subjects.find((x) => x.id === id).grades.map((g) => g.value);
const actions = (tavern) => tavern.seam.host.actions;
const ledger = (tavern) => tavern.chatMetadata.academy_ledger.list;

test('сквозной: метки нет — «разобрать» записывает пятёрку, повторный разбор не удваивает', async () => {
  const tavern = await boot({ answer: '<!-- [ACADEMY grade=химия:5 rel=petrova:minor+:блестящий ответ] -->' });
  const id = await reply(tavern, 'Петрова кивает: «Отлично, пять». Время идёт дальше.');
  assert.deepEqual(grades(tavern, 'chemistry'), [], 'без метки оценки нет — это и была жалоба');
  const rel0 = stateOf(tavern).teachers.find((t) => t.id === 'petrova').relation;

  const res = await actions(tavern).analyzeMessage(id);
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(grades(tavern, 'chemistry'), ['5']);
  assert.equal(stateOf(tavern).teachers.find((t) => t.id === 'petrova').relation, rel0 + 1);
  assert.equal(tavern.asked.length, 1);
  assert.ok(tavern.asked[0].prompt.includes('Отлично, пять'), 'секретарь читал сам ответ');

  await actions(tavern).analyzeMessage(id);
  assert.deepEqual(grades(tavern, 'chemistry'), ['5'], 'пересчёт от снимка, а не поверх');

  const entry = ledger(tavern).at(-1);
  assert.deepEqual(entry.tokens, ['grade=chemistry:5', 'rel=petrova:minor+:блестящий ответ']);
  assert.ok(entry.rows.some((r) => r.includes('аналитическая химия: 5')), entry.rows.join(' | '));
  assert.equal(entry.marker, false);
});

test('сквозной: разбор главнее метки рассказчика — её оценка не ложится второй', async () => {
  const tavern = await boot({ answer: '<!-- [ACADEMY grade=chemistry:4] -->' });
  const id = await reply(tavern, 'Сцена. <!-- [ACADEMY grade=chemistry:3] -->');
  assert.deepEqual(grades(tavern, 'chemistry'), ['3']);
  await actions(tavern).analyzeMessage(id);
  assert.deepEqual(grades(tavern, 'chemistry'), ['4']);
});

test('сквозной: вычеркнуть вывод и вернуть метку рассказчика', async () => {
  const tavern = await boot({ answer: '<!-- [ACADEMY grade=chemistry:5 skip=history] -->' });
  const id = await reply(tavern, 'Сцена. <!-- [ACADEMY grade=chemistry:3] -->');
  await actions(tavern).analyzeMessage(id);
  const { live } = tavern.seam;
  const histSkips = () => stateOf(tavern).attendance.records.filter((r) => r.subjectId === 'history' && r.status === 'skip').length;
  assert.equal(histSkips(), 1);

  // То же, что крестик на плашке: секретарь ошибся с прогулом.
  const dropIdx = live.ledger.at(-1).tokens.indexOf('skip=history');
  await panelDrop(tavern, id, dropIdx);
  assert.equal(histSkips(), 0, 'вычеркнутый прогул снят');
  assert.deepEqual(grades(tavern, 'chemistry'), ['5'], 'оценка разбора осталась');

  await panelClear(tavern, id);
  assert.deepEqual(grades(tavern, 'chemistry'), ['3'], 'без разбора снова работает метка рассказчика');
  assert.equal(live.ledger.at(-1).tokens, null);
});

// Плашечные действия живут в `panelHost` внутри index.js; наружу они выходят
// тем же путём, что кнопка, — через DOM. Без DOM их зовём через seam.
async function panelDrop(tavern, id, index) {
  return tavern.seam.panel.dropToken(id, index);
}
async function panelClear(tavern, id) {
  return tavern.seam.panel.clearAnalysis(id);
}

test('сквозной: разбирается только последний ответ', async () => {
  const tavern = await boot();
  const first = await reply(tavern, 'Первая сцена.');
  await reply(tavern, 'Вторая сцена.');
  const res = await actions(tavern).analyzeMessage(first);
  assert.equal(res.ok, false);
  assert.match(res.error, /только последний/);
  assert.equal(tavern.asked.length, 0, 'запроса не было');
});

test('сквозной: ответ без метки → сбой словами, состояние не тронуто', async () => {
  const tavern = await boot({ answer: 'Я не понял задачу.' });
  const id = await reply(tavern, 'Сцена.');
  const res = await actions(tavern).analyzeMessage(id);
  assert.equal(res.ok, false);
  assert.match(res.error, /не по форме/);
  assert.equal(tavern.seam.panel.panelFor(id).error, res.error, 'отказ виден на плашке');
});

test('сквозной: свайп забывает разбор, возврат на прежний текст его находит', async () => {
  const tavern = await boot({ answer: '<!-- [ACADEMY grade=chemistry:5] -->' });
  const id = await reply(tavern, 'Первый вариант.');
  await actions(tavern).analyzeMessage(id);
  assert.deepEqual(grades(tavern, 'chemistry'), ['5']);

  const m = tavern.chat[id];
  m.swipe_id = 1;
  await tavern.eventSource.emit('message_swiped', id);
  m.swipes.push('Второй вариант.');
  m.mes = 'Второй вариант.';
  await tavern.eventSource.emit('message_received', id, 'swipe');
  assert.deepEqual(grades(tavern, 'chemistry'), [], 'новый вариант без разбора');

  m.swipe_id = 0;
  m.mes = 'Первый вариант.';
  await tavern.eventSource.emit('message_swiped', id);
  assert.deepEqual(grades(tavern, 'chemistry'), ['5'], 'вернулись — разбор снова в силе');
});

test('сквозной: «если нет метки» — секретарь сам, но только там, где метки нет', async () => {
  const tavern = await boot({ settings: { academy: { analysis: 'missing' } }, answer: '<!-- [ACADEMY grade=chemistry:5] -->' });
  await reply(tavern, 'Сцена с меткой. <!-- [ACADEMY t=+0] -->');
  assert.equal(tavern.asked.length, 0);
  await reply(tavern, 'Сцена без метки.');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(tavern.asked.length, 1);
  assert.deepEqual(grades(tavern, 'chemistry'), ['5']);
});

test('сквозной: «сюжет» — зачёт сдан в сцене, кубик не бросается; не сыграли — ждёт', async () => {
  const tavern = await boot({
    day: '2024-12-22',
    edit: (s) => { s.examBy = 'story'; },
    answer: '<!-- [ACADEMY grade=chemistry:зачёт] -->',
  });
  await reply(tavern, 'Утро сессии. <!-- [ACADEMY t=+1 day] -->');
  assert.deepEqual(stateOf(tavern).exams.items.filter((i) => i.outcome), [], 'сцена промолчала — никто не садился');

  const id = await reply(tavern, 'Аня сдаёт зачёт по химии, Петрова ставит «зачтено».');
  await actions(tavern).analyzeMessage(id);
  const done = stateOf(tavern).exams.items.filter((i) => i.outcome);
  assert.equal(done.length, 1);
  assert.equal(done[0].subjectId, 'chemistry');
  assert.equal(done[0].outcome, 'зачёт');
  assert.ok(!(done[0].rolls || []).some((x) => Number.isFinite(x.roll)), 'без броска');
});

test('сквозной: правило экзаменов меняется посреди семестра', async () => {
  const tavern = await boot();
  assert.equal(examRule(stateOf(tavern)), 'dice', 'старый чат без поля — кубик');
  const res = await actions(tavern).setExamRule('story');
  assert.equal(res.ok, true);
  assert.equal(stateOf(tavern).examBy, 'story');
  assert.equal((await actions(tavern).setExamRule('монетка')).ok, false);
});

test('сквозной: сосед молча дописал текст ответа — плашка и разбор на месте', async () => {
  const tavern = await boot({ answer: '<!-- [ACADEMY grade=chemistry:5] -->' });
  const id = await reply(tavern, 'Петрова ставит пять.');
  // Трекер дописывает свой блок прямо в `mes` и событий не шлёт.
  tavern.chat[id].mes += '\n<horae>time:10:15</horae>';
  const view = tavern.seam.panel.panelFor(id);
  assert.ok(view, 'плашка есть');
  assert.equal(view.canAnalyze, true);
  assert.ok(view.date, 'запись протокола нашлась по ходу');

  const res = await actions(tavern).analyzeMessage(id);
  assert.equal(res.ok, true, res.error);
  assert.deepEqual(grades(tavern, 'chemistry'), ['5']);
  assert.equal(tavern.seam.panel.panelFor(id).analyzed, true);
  assert.match(tavern.seam.host.panelDiagnosis(), /последний ход — #\d+, текст совпадает/);
});

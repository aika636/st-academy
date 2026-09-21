import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Проводка 9.4.1–9.4.2 и крючки 9.7 через настоящий `index.js` поверх
// поддельной таверны (та же подделка, что в `remont.test.mjs`, списанная с
// исходника 1.18.0): seed броска экзамена, тосты вех, события `academy:*`,
// `window.AcademyAPI`, портрет и день рождения, корпус и аудитория, доктор
// промпта, кубик соседа, сводка прыжка, объявление после принятого прыжка.
//
// Подделка здесь добавляет три вещи, которых не было:
// - `extensionPrompts` — тот же объект, куда пишет `setExtensionPrompt`: так
//   его отдаёт `getContext()` (`st-context.js:151` → `script.js:625`);
// - `toastr` — счётчик всплывашек (в таверне он глобальный);
// - подписчики `academy:*` на `eventSource` — так события ловит сосед.

const presetPath = (id) => fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url));
const loadPresetFile = (id) => JSON.parse(readFileSync(presetPath(id), 'utf8'));
const preset = loadPresetFile('ru-university');
const manifestPath = fileURLToPath(new URL('../manifest.json', import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const TERM_START = '2024-09-02';

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

const marker = (body) => `<!-- [ACADEMY ${body}] -->`;

// --- поддельная таверна ------------------------------------------------------

function fakeTavern() {
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
      MESSAGE_SENT: 'message_sent',
      MESSAGE_SWIPED: 'message_swiped',
      MESSAGE_EDITED: 'message_edited',
      MESSAGE_UPDATED: 'message_updated',
      MESSAGE_DELETED: 'message_deleted',
      CHAT_CHANGED: 'chat_id_changed',
      GENERATION_STARTED: 'generation_started',
      GENERATION_ENDED: 'generation_ended',
      GENERATION_STOPPED: 'generation_stopped',
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
    // `getContext().extensionPrompts` — живая ссылка на тот же объект, куда
    // пишет `setExtensionPrompt` (script.js:8866).
    extensionPrompts: prompts,
    setExtensionPrompt(key, value, position, depth, scan, role) {
      prompts[key] = { value: String(value), position, depth, scan, role };
    },
    saveMetadataDebounced() {},
    async saveMetadata() {},
    saveSettingsDebounced() {},
    chatId: 'chat-1',
    getCurrentChatId: () => tavern.chatId,
    macros: { registry: {}, category: { MISC: 'misc' }, register(name, def) { tavern.macros.registry[name] = def; } },
    registerMacro() {},
    /** Что поймал сосед: `[имя, detail]` по порядку. */
    hooks: [],
  };
  for (const name of ['academy:day', 'academy:period', 'academy:phase', 'academy:exam', 'academy:milestone', 'academy:rollback']) {
    tavern.eventSource.on(name, (detail) => { tavern.hooks.push([name, detail]); });
  }
  return tavern;
}

/** Всплывашки таверны: `[вид, текст, заголовок]`. */
const toasts = [];
globalThis.toastr = Object.fromEntries(['success', 'info', 'warning', 'error']
  .map((k) => [k, (text, title) => { toasts.push([k, String(text), String(title || '')]); }]));

async function boot(tavern) {
  globalThis.SillyTavern = { getContext: () => tavern };
  globalThis.fetch = async (url) => {
    const s = String(url);
    const m = /\/presets\/([\w-]+)\.json$/.exec(s);
    if (m) {
      try {
        return { ok: true, status: 200, json: async () => loadPresetFile(m[1]) };
      } catch {
        return { ok: false, status: 404, json: async () => ({}) };
      }
    }
    if (s.endsWith('/manifest.json')) return { ok: true, status: 200, json: async () => manifest };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const mod = await import(`../index.js?run=${Math.random()}`);
  await mod.__seam.ready;
  return mod.__seam;
}

async function withSemester(opts = {}) {
  const tavern = fakeTavern();
  const { createState } = await import('../core/state.mjs');
  const { buildSchedule } = await import('../core/schedule.mjs');
  const state = createState(preset, {
    startDay: opts.start || TERM_START,
    subjects: opts.subjects || SUBJECTS,
    teachers: TEACHERS,
    schedule: buildSchedule(opts.subjects || SUBJECTS, preset),
  });
  state.started = true;
  if (opts.day) state.calendar.day = opts.day;
  if (opts.edit) opts.edit(state);
  tavern.chatMetadata.academy = state;
  if (opts.chatId) tavern.chatId = opts.chatId;
  Object.assign(tavern.extensionSettings, opts.settings || {});
  tavern.seam = await boot(tavern);
  toasts.length = 0;
  return tavern;
}

async function reload(tavern) {
  const next = fakeTavern();
  next.chat = JSON.parse(JSON.stringify(tavern.chat));
  next.chatMetadata = JSON.parse(JSON.stringify(tavern.chatMetadata));
  next.extensionSettings = JSON.parse(JSON.stringify(tavern.extensionSettings));
  next.chatId = tavern.chatId;
  next.seam = await boot(next);
  return next;
}

const emit = (tavern, name, ...args) => tavern.eventSource.emit(name, ...args);

function say(tavern, text) {
  tavern.chat.push({ mes: text, is_user: false, is_system: false, swipes: [text], swipe_id: 0 });
  return tavern.chat.length - 1;
}

function user(tavern, text) {
  tavern.chat.push({ mes: text, is_user: true, is_system: false });
  return tavern.chat.length - 1;
}

async function reply(tavern, text) {
  const id = say(tavern, text);
  await emit(tavern, 'message_received', id, 'normal');
  return id;
}

/** Свайп на новую генерацию так, как его делает таверна (см. `remont.test.mjs`). */
async function swipeNew(tavern, id, text) {
  const m = tavern.chat[id];
  m.swipe_id = m.swipes.length;
  await emit(tavern, 'message_swiped', id);
  await emit(tavern, 'generation_started', 'swipe', {}, false);
  m.swipes.push(text);
  m.mes = text;
  await emit(tavern, 'message_received', id, 'swipe');
  await emit(tavern, 'generation_ended', tavern.chat.length);
}

const stateOf = (tavern) => tavern.chatMetadata.academy;
const hooksOf = (tavern, name) => tavern.hooks.filter(([n]) => n === name).map(([, d]) => d);
const sat = (tavern) => stateOf(tavern).exams.items.filter((i) => i.outcome);

/** Канун сессии: первый же ответ «через день» сажает за контрольное. */
async function examDay(opts = {}) {
  const tavern = await withSemester({ day: '2024-12-22', ...opts });
  const id = await reply(tavern, `Утро экзаменационного дня. ${marker('t=+1 day')}`);
  return { tavern, id };
}

const lastRoll = (item) => (item.rolls || [])[item.rolls.length - 1];

// --- 1. seed броска экзамена (9.3.9) ------------------------------------------

test('seed: свайп ответа в день экзамена даёт тот же бросок и тот же исход', async () => {
  const { tavern, id } = await examDay();
  const [first] = sat(tavern);
  assert.ok(first, 'в день сессии контрольное обязано сесть');
  const was = { roll: lastRoll(first).roll, dc: lastRoll(first).dc, outcome: first.outcome };

  await swipeNew(tavern, id, `Совсем другое утро того же дня. ${marker('t=+1 day')}`);
  const [again] = sat(tavern);
  assert.equal(again.id, first.id, 'то же событие');
  assert.equal(again.rolls.length, 1, 'бросок не дописан вторым — снимок откатил первый');
  assert.deepEqual(
    { roll: lastRoll(again).roll, dc: lastRoll(again).dc, outcome: again.outcome }, was,
    'новый вариант ответа не выбивает другой исход',
  );
});

test('seed: после F5 свайп того же ответа бросает то же число', async () => {
  const { tavern, id } = await examDay();
  const was = lastRoll(sat(tavern)[0]).roll;
  const again = await reload(tavern);
  await swipeNew(again, id, `И снова это утро. ${marker('t=+1 day')}`);
  assert.equal(lastRoll(sat(again)[0]).roll, was);
});

test('seed: чат и начало семестра входят в seed; Math.random броску больше не нужен', async () => {
  const { tavern } = await examDay();
  const base = tavern.seam.examSeedBase(stateOf(tavern));
  assert.equal(base, `chat-1|${TERM_START}`);
  const other = { ...stateOf(tavern), calendar: { ...stateOf(tavern).calendar, termStart: '2025-09-01' } };
  assert.notEqual(tavern.seam.examSeedBase(other), base, 'новый семестр в том же чате — другой seed');

  // Бросок в чужом чате — от другого seed; а `Math.random` не зовётся вовсе.
  // (Подмена — после загрузки: сам прогон берёт `Math.random` для адреса модуля.)
  const t2 = await withSemester({ day: '2024-12-22', chatId: 'chat-2' });
  const real = Math.random;
  Math.random = () => { throw new Error('бросок обязан идти от seed'); };
  try {
    await reply(t2, `Утро. ${marker('t=+1 day')}`);
    assert.equal(sat(t2).length, 1);
    assert.equal(t2.seam.examSeedBase(stateOf(t2)), `chat-2|${TERM_START}`);
  } finally {
    Math.random = real;
  }
});

test('seed: шов `live.examRng` сильнее seed — прогону есть чем зажать бросок', async () => {
  const tavern = await withSemester({ day: '2024-12-22' });
  tavern.seam.live.examRng = () => 0; // d20 = 1
  await reply(tavern, `Утро. ${marker('t=+1 day')}`);
  assert.equal(lastRoll(sat(tavern)[0]).roll, 1);
});

// --- 2. вехи: тост, звук, «по миру» (9.4.2, 9.4.3) ----------------------------

const milestoneToasts = () => toasts.filter(([, , title]) => title === 'Веха').map(([, text]) => text);

test('вехи: первая высшая оценка — один тост «Веха» и одно событие; свайп того же не повторяет', async () => {
  const tavern = await withSemester({ day: '2024-09-03' });
  const id = await reply(tavern, `Пара. ${marker('t=+1 grade=chemistry:5')}`);
  assert.deepEqual(milestoneToasts(), ['Первая пятёрка: аналитическая химия']);
  assert.equal(hooksOf(tavern, 'academy:milestone').length, 1);
  assert.equal(hooksOf(tavern, 'academy:milestone')[0].kind, 'firstTop');

  await swipeNew(tavern, id, `Пара иначе. ${marker('t=+1 grade=chemistry:5')}`);
  assert.equal(milestoneToasts().length, 1, 'колебание свайпом не даёт второго тоста');
  assert.equal(hooksOf(tavern, 'academy:milestone').length, 1);
});

test('вехи: открытый чат с уже заработанной вехой тостом о ней не говорит', async () => {
  const tavern = await withSemester({ day: '2024-09-03' });
  await reply(tavern, `Пара. ${marker('t=+1 grade=chemistry:5')}`);
  toasts.length = 0;
  const again = await reload(tavern);
  await reply(again, `Ещё пара. ${marker('t=+1')}`);
  assert.deepEqual(milestoneToasts(), []);
});

test('вехи: звук — только если включён в настройках, и один на ответ', async () => {
  const quiet = await withSemester({ day: '2024-09-03' });
  let rings = 0;
  quiet.seam.live.chime = () => { rings += 1; };
  await reply(quiet, `Пара. ${marker('t=+1 grade=chemistry:5')}`);
  assert.equal(rings, 0, 'умолчание — без звука');

  const loud = await withSemester({ day: '2024-09-03', settings: { academy: { milestoneSound: true } } });
  loud.seam.live.chime = () => { rings += 1; };
  // Две вехи одним ответом: первая пятёрка по двум предметам — а звук один.
  await reply(loud, `Пара. ${marker('t=+1 grade=chemistry:5 grade=physics:5')}`);
  assert.equal(milestoneToasts().length >= 1, true);
  assert.equal(rings, 1);
});

test('вехи по миру: блестящая сдача не звучит до объявления итога (9.4.3)', async () => {
  const { tavern } = await examDay();
  tavern.seam.live.examRng = () => 0.99; // d20 = 20: крит
  toasts.length = 0;
  await reply(tavern, `Назавтра. ${marker('t=+1 day')}`);
  const physics = stateOf(tavern).exams.items.find((i) => i.id === '0:physics:exam');
  assert.equal(physics.announced, false, 'письменный экзамен объявляют назавтра');
  assert.equal(milestoneToasts().some((t) => /физика/.test(t)), false, 'до ведомости о пятёрке не знает никто');

  await reply(tavern, `Ещё день. ${marker('t=+1 day')}`);
  assert.ok(milestoneToasts().some((t) => /физика/.test(t)), 'в день объявления веха звучит');
});

// --- 3. события academy:* ------------------------------------------------------

test('события: смена дня, фазы и исход зачёта уходят соседу с полями', async () => {
  const { tavern } = await examDay();
  const [day] = hooksOf(tavern, 'academy:day');
  assert.equal(day.day, '2024-12-23');
  assert.equal(day.from, '2024-12-22');
  assert.equal(day.weekday, 'понедельник');
  assert.equal(day.chatId, 'chat-1');
  const [phase] = hooksOf(tavern, 'academy:phase');
  assert.equal(phase.phase, 'exams');
  assert.equal(phase.label, 'сессия', 'фаза словом пресета');
  const [exam] = hooksOf(tavern, 'academy:exam');
  assert.equal(exam.subjectId, 'chemistry');
  assert.equal(exam.kindName, 'зачёт');
  assert.equal(typeof exam.passed, 'boolean');
  assert.ok(Number.isFinite(exam.roll) && Number.isFinite(exam.dc), 'бросок и DC видны соседу');
});

test('события: исход письменного экзамена уходит в день объявления, а не в день сдачи', async () => {
  const { tavern } = await examDay();
  tavern.hooks.length = 0;
  await reply(tavern, `Назавтра. ${marker('t=+1 day')}`);
  assert.deepEqual(hooksOf(tavern, 'academy:exam'), [], 'мир ещё не знает');
  await reply(tavern, `Ещё день. ${marker('t=+1 day')}`);
  const told = hooksOf(tavern, 'academy:exam').find((e) => e.examId === '0:physics:exam');
  assert.ok(told, 'объявили — сосед узнал');
  assert.equal(told.announced, true);
});

test('события: «пара началась» — при смене текущего занятия', async () => {
  const tavern = await withSemester({ day: '2024-09-03' });
  await reply(tavern, `Пара. ${marker('t=+1')}`);
  await reply(tavern, `Следующая. ${marker('t=+1')}`);
  const periods = hooksOf(tavern, 'academy:period');
  assert.equal(periods.length, 2);
  assert.notEqual(periods[0].ordinal, periods[1].ordinal);
  assert.equal(periods[1].status, 'now');
  assert.ok(periods[1].subject, 'название занятия — словами');
});

test('события: во время фоновой генерации не уходят, после неё — все по порядку', async () => {
  const tavern = await withSemester({ day: '2024-09-03' });
  await emit(tavern, 'generation_started', 'quiet', {}, false);
  await reply(tavern, `День прошёл. ${marker('t=+1 day')}`);
  assert.deepEqual(tavern.hooks, [], 'quiet — наружу ничего');
  await emit(tavern, 'generation_ended', tavern.chat.length);
  assert.ok(hooksOf(tavern, 'academy:day').length === 1, 'после конца фоновой — событие дошло');
});

test('события: откат свайпом и удалением — academy:rollback с днём после отката', async () => {
  const tavern = await withSemester({ day: '2024-09-03' });
  const id = await reply(tavern, `День прошёл. ${marker('t=+1 day')}`);
  await swipeNew(tavern, id, `Иначе. ${marker('t=+1')}`);
  const [swiped] = hooksOf(tavern, 'academy:rollback');
  assert.equal(swiped.reason, 'swipe');
  assert.equal(swiped.day, '2024-09-03', 'день — тот, на который откатились');

  tavern.chat.pop();
  await emit(tavern, 'message_deleted', tavern.chat.length);
  assert.equal(hooksOf(tavern, 'academy:rollback')[1].reason, 'delete');
});

test('события: document получает CustomEvent с detail-копией', async () => {
  const seen = [];
  const prev = globalThis.document;
  globalThis.document = { dispatchEvent: (e) => { seen.push(e); return true; } };
  try {
    const tavern = await withSemester({ day: '2024-09-03' });
    await reply(tavern, `День прошёл. ${marker('t=+1 day')}`);
    const day = seen.find((e) => e.type === 'academy:day');
    assert.ok(day, 'событие дошло до document');
    day.detail.day = '1999-01-01';
    assert.equal(stateOf(tavern).calendar.day, '2024-09-04', 'правка detail у соседа семестр не трогает');
  } finally {
    if (prev === undefined) delete globalThis.document;
    else globalThis.document = prev;
  }
});

// --- 4. window.AcademyAPI -------------------------------------------------------

test('AcademyAPI: now, today, summary, journal, milestones, version — копиями', async () => {
  const tavern = await withSemester({ day: '2024-09-03' });
  await reply(tavern, `Пара. ${marker('t=+1 grade=chemistry:5')}`);
  const api = globalThis.AcademyAPI;
  assert.equal(api, tavern.seam.api, 'на window висит тот же объект');
  assert.equal(api.version, manifest.version);
  assert.equal(api.apiVersion, 1);
  assert.ok(api.events.includes('academy:exam'));
  assert.equal(Object.isFrozen(api), true, 'сосед не подменит методы');

  assert.equal(api.now().day, '2024-09-03');
  const today = api.today();
  assert.equal(today.weekday, 'вторник');
  assert.ok(today.period && today.period.subject, 'текущее занятие');
  assert.match(api.summary(), /^вторник, \d-я пара$/);

  const journal = api.journal(5);
  const grade = journal.find((e) => e.kind === 'grade');
  assert.equal(grade.subject, 'аналитическая химия');
  assert.equal(grade.value, '5');
  assert.equal(grade.label, 'отлично', 'значение — словом шкалы пресета');
  assert.equal('text' in grade, false, 'технический текст журнала наружу не идёт');
  grade.value = '2';
  assert.equal(stateOf(tavern).subjects[0].grades[0].value, '5', 'копия, а не ссылка');

  assert.deepEqual(api.milestones().map((m) => m.kind), ['firstTop']);
});

test('AcademyAPI: без семестра — null и пустое, без исключений', async () => {
  const tavern = fakeTavern();
  tavern.seam = await boot(tavern);
  const api = globalThis.AcademyAPI;
  assert.equal(api.now(), null);
  assert.equal(api.today(), null);
  assert.equal(api.summary(), '');
  assert.deepEqual(api.journal(), []);
  assert.deepEqual(api.milestones(), []);
});

test('AcademyAPI: журнал и хвосты не выдают необъявленный итог (9.4.3)', async () => {
  const { tavern } = await examDay();
  tavern.seam.live.examRng = () => 0; // d20 = 1: провал физики
  await reply(tavern, `Назавтра. ${marker('t=+1 day')}`);
  const physics = stateOf(tavern).exams.items.find((i) => i.id === '0:physics:exam');
  assert.equal(physics.announced, false);
  const api = globalThis.AcademyAPI;
  const rows = api.journal(50).filter((e) => e.subjectId === 'physics');
  assert.deepEqual(rows, [], 'ни оценки, ни исхода по физике до ведомости');
  assert.doesNotMatch(api.summary(), /хвост/, 'хвост от необъявленного провала — тоже секрет');

  await reply(tavern, `Ещё день. ${marker('t=+1 day')}`);
  assert.ok(api.journal(50).some((e) => e.subjectId === 'physics' && e.kind === 'exam'), 'объявили — видно');
});

// --- 5. портрет, день рождения, корпус и аудитория ------------------------------

test('портрет и день рождения: сохраняются с вкладки «Люди», негодное — отказ без записи', async () => {
  const tavern = await withSemester({ day: '2024-09-03' });
  const act = tavern.seam.host.actions;
  const ok = await act.setTeacherDetails('petrova', { portrait: 'characters/Петрова/портрет.png', birthday: '8.3' });
  assert.equal(ok.ok, true);
  const petrova = () => stateOf(tavern).teachers.find((t) => t.id === 'petrova');
  assert.equal(petrova().portrait, 'characters/Петрова/портрет.png');
  assert.equal(petrova().birthday, '03-08', 'день.месяц приведён к ММ-ДД');

  const bad = await act.setTeacherDetails('petrova', { portrait: 'javascript:alert(1)', birthday: '' });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'bad-portrait');
  assert.equal(petrova().birthday, '03-08', 'половину правки не пишем');

  const badDay = await act.setTeacherDetails('petrova', { birthday: '31.02' });
  assert.equal(badDay.code, 'bad-birthday');

  await act.setTeacherDetails('petrova', { portrait: '' });
  assert.equal('portrait' in petrova(), false, 'пустое поле убирает портрет');
  assert.equal(petrova().birthday, '03-08', 'ключа нет в правке — не трогаем');
});

test('таблица плана: сохранение на идущем семестре не стирает зачётку и отношения', async () => {
  const tavern = await withSemester({ day: '2024-09-03' });
  await reply(tavern, `Пара. ${marker('t=+1 grade=chemistry:5 rel=petrova:major+')}`);
  await tavern.seam.host.actions.setTeacherDetails('petrova', { portrait: 'https://example.com/p.png' });
  const relation = stateOf(tavern).teachers.find((t) => t.id === 'petrova').relation;

  const { rowsFromState, validateSubjectRows } = await import('../ui.js');
  const rows = rowsFromState(stateOf(tavern));
  rows.subjects[0].building = 'главный';
  rows.subjects[0].room = '214';
  const table = validateSubjectRows(rows, preset);
  assert.equal(table.ok, true);
  await tavern.seam.host.actions.setSubjects({ subjects: table.subjects, teachers: table.teachers });

  const s = stateOf(tavern);
  const chem = s.subjects.find((x) => x.id === 'chemistry');
  assert.deepEqual(chem.grades.map((g) => g.value), ['5'], 'оценки остались');
  assert.equal(chem.building, 'главный');
  assert.equal(chem.room, '214');
  const petrova = s.teachers.find((t) => t.id === 'petrova');
  assert.equal(petrova.relation, relation, 'отношение не сброшено к стартовому');
  assert.equal(petrova.portrait, 'https://example.com/p.png', 'портрет пережил таблицу');

  // Стёртый в таблице корпус — это «корпуса нет», а не «оставить старый».
  const rows2 = rowsFromState(stateOf(tavern));
  rows2.subjects[0].building = '';
  const table2 = validateSubjectRows(rows2, preset);
  await tavern.seam.host.actions.setSubjects({ subjects: table2.subjects, teachers: table2.teachers });
  const chem2 = stateOf(tavern).subjects.find((x) => x.id === 'chemistry');
  assert.equal('building' in chem2, false);
  assert.equal(chem2.room, '214');
});

// --- 6. доктор промпта ------------------------------------------------------------

test('доктор промпта: сосед, просящий первую строку, назван причиной пропавшей метки', async () => {
  const tavern = await withSemester({ day: '2024-09-03' });
  // Метки в ответе нет — и сосед Scene State просит начало ответа глубже нашего.
  await reply(tavern, '<div class="scene">📍 Коридор</div>\nОна шла по коридору.');
  tavern.setExtensionPrompt('scene_state', 'MANDATORY: output the scene block as the first line of your response.', 1, 0, false, 0);
  tavern.setExtensionPrompt('bb_phone', 'Append the phone status at the end of your response.', 1, 0, false, 1);
  const d = tavern.seam.host.getPromptDoctor();
  assert.equal(d.available, true);
  const ours = d.rows.filter((r) => r.ours).map((r) => r.key).sort();
  assert.deepEqual(ours, ['academy_marker', 'academy_status']);
  const scene = d.rows.find((r) => r.key === 'scene_state');
  assert.equal(scene.wantsStart, true);
  assert.equal(scene.mandatory, true);
  assert.match(d.status, /метки не было/);
  assert.ok(d.reasons.some((r) => r.includes('scene_state') && r.includes('ближе к концу')), d.reasons.join(' | '));
  assert.ok(d.reasons.some((r) => r.includes('чужим блоком')), 'шапка ответа названа');
  assert.ok(d.notes.some((n) => n.includes('bb_phone')), 'занятый конец — заметкой, не причиной');
});

test('доктор промпта: сборка без extensionPrompts — честное «показать нечего»', async () => {
  const tavern = await withSemester({ day: '2024-09-03' });
  delete tavern.extensionPrompts;
  const d = tavern.seam.host.getPromptDoctor();
  assert.equal(d.available, false);
  assert.match(d.status, /не отдаёт/);
});

// --- 7. кубик соседа, сводка прыжка, объявление после прыжка ----------------------

test('кубик Enhance-Gen в реплике перед ответом решает сегодняшний исход', async () => {
  const tavern = await withSemester({ day: '2024-12-22' });
  user(tavern, '> 🎲 **ПРОВАЛ (4 из 12)** | *Сдаст ли она?*\n<span style="display:none">DICE OF FATE — FAILURE (Roll: 4 vs DC: 12)</span>');
  await reply(tavern, `Утро экзамена. ${marker('t=+1 day')}`);
  const exam = tavern.seam.live.lastRun.exam;
  assert.equal(exam.external.source, 'dice');
  assert.equal(exam.external.roll, 4);
  assert.equal(sat(tavern)[0].outcome, exam.external.value, 'в зачётке — исход кубика');
});

test('кубик в телефонном ходе не действует: СМС — пауза сцены', async () => {
  const tavern = await withSemester({ day: '2024-12-22' });
  user(tavern, '[СМС → Лиза] 🎲 **ПРОВАЛ (4 из 12)** | *Сдаст ли она?*');
  await reply(tavern, `Ответ Лизы. ${marker('t=+1 day')}`);
  const exam = tavern.seam.live.lastRun.exam;
  assert.equal(exam ? exam.external : undefined, undefined);
});

test('прыжок через дни: один тост «прошло занятий», а не пачка', async () => {
  const tavern = await withSemester({ day: '2024-09-03' });
  await reply(tavern, `Прошло три дня. ${marker('t=+3 day')}`);
  const info = toasts.filter(([k]) => k === 'info');
  assert.equal(info.length, 1);
  assert.match(info[0][1], /^Прошло занятий: 12, из них пропущено: 12\.$/);
});

test('принятый прыжок, дошедший до объявления, взводит факт сразу, а не ходом позже', async () => {
  const { tavern } = await examDay();
  await reply(tavern, `Назавтра. ${marker('t=+1 day')}`);
  await reply(tavern, '📅 Пятница, 27 декабря 2024 года | 🕰 10:15\nОна проснулась поздно.');
  assert.ok(stateOf(tavern).calendar.heldJump, 'прыжок на три дня придержан');
  const res = await tavern.seam.host.actions.resolveJump(true);
  assert.equal(res.ok, true);
  assert.deepEqual(stateOf(tavern).pending, [], 'в очереди состояния ничего не осталось');
  assert.match(tavern.prompts.academy_oneshot.value, /^Итоги объявлены: физика/);
  // И следующая генерация видит его же: взведён через историю ходов.
  await emit(tavern, 'generation_started', 'normal', {}, false);
  assert.match(tavern.prompts.academy_oneshot.value, /Итоги объявлены: физика/);
  assert.ok(hooksOf(tavern, 'academy:exam').some((e) => e.examId === '0:physics:exam'));
});

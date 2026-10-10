import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Ремонт 9.1: дыры, которые разбор соседних расширений нашёл в самой Academy.
//
// Прогон — тот же, что в `integration.test.mjs`: настоящий `index.js` поверх
// поддельной таверны. Подделка здесь расширена ровно тем, чего не хватало для
// этих дефектов, и каждое расширение списано с исходника 1.18.0, а не с памяти:
//
// - **перезагрузка страницы** — новый экземпляр модуля над тем же чатом и теми
//   же метаданными, прогнанными через JSON (таверна хранит их файлом, и всё,
//   что не пережило бы `JSON.stringify`, здесь теряется так же, как после F5);
// - **свайп на новую генерацию так, как его делает таверна**: `MESSAGE_SWIPED`
//   приходит, пока в `mes` ещё СТАРЫЙ текст, а `swipe_id` уже смотрит в пустой
//   слот (`script.js`, `swipe` → `animateSwipe`, :10255), потом
//   `GENERATION_STARTED('swipe')`, потом `MESSAGE_RECEIVED` с новым текстом;
// - **регенерация**: `GENERATION_STARTED('regenerate')` приходит ДО того, как
//   таверна срежет последний ответ и пошлёт `MESSAGE_DELETED` (:4240, :4320);
// - **фоновые генерации**: `GENERATION_STARTED(type, params, dryRun)` —
//   сигнатура с :4240, `GENERATION_ENDED`/`GENERATION_STOPPED` — :3477, :5559;
// - **смена чата посреди запроса**: `getCurrentChatId` меняется, `chatMetadata`
//   переприсваивается, `CHAT_CHANGED` приходит после (:7598, :7641).

const presetPath = (id) => fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url));
const loadPresetFile = (id) => JSON.parse(readFileSync(presetPath(id), 'utf8'));
const preset = loadPresetFile('ru-university');
const manifestPath = fileURLToPath(new URL('../manifest.json', import.meta.url));

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
    powerUserSettings: { encode_tags: false },
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
    setExtensionPrompt(key, value, position, depth, scan, role) {
      prompts[key] = { value: String(value), position, depth, scan, role };
    },
    saveMetadataDebounced() { tavern.saves += 1; },
    async saveMetadata() { tavern.flushes += 1; },
    saveSettingsDebounced() {},
    chatId: 'chat-1',
    getCurrentChatId: () => tavern.chatId,
    saves: 0,
    flushes: 0,
    // Макросы (9.3.1), сверено с 1.18.0: новый движок — `macros.register(name,
    // {handler, category, description})` (`st-context.js:244`,
    // `macros/macro-system.js`), включён по умолчанию (`power-user.js:302`);
    // старый — `registerMacro(key, fn, description)` (`st-context.js:179`).
    macros: {
      registry: {},
      category: { MISC: 'misc' },
      register(name, def) { tavern.macros.registry[name] = def; return def; },
    },
    legacyMacros: {},
    registerMacro(key, value) { tavern.legacyMacros[key] = value; },
  };
  tavern.powerUserSettings.experimental_macro_engine = true;
  return tavern;
}

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
    if (s.endsWith('/manifest.json')) {
      return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(manifestPath, 'utf8')) };
    }
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
    startDay: TERM_START, subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
  });
  state.started = true;
  if (opts.day) state.calendar.day = opts.day;
  tavern.chatMetadata.academy = state;
  tavern.seam = await boot(tavern);
  return tavern;
}

/**
 * F5. Всё, что таверна хранит, — чат и метаданные — переживает перезагрузку
 * только через JSON, память вкладки не переживает ничего. Новая подделка, а не
 * та же: у старой остались подписчики прошлого экземпляра модуля.
 */
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

function say(tavern, text, extra = null) {
  const m = { mes: text, is_user: false, is_system: false, swipes: [text], swipe_id: 0 };
  if (extra) m.extra = extra;
  tavern.chat.push(m);
  return tavern.chat.length - 1;
}

function user(tavern, text) {
  tavern.chat.push({ mes: text, is_user: true, is_system: false });
  return tavern.chat.length - 1;
}

/** Ответ модели целиком: как его досылает таверна. */
async function reply(tavern, text) {
  const id = say(tavern, text);
  await emit(tavern, 'message_received', id, 'normal');
  return id;
}

/**
 * Свайп на новую генерацию так, как его делает таверна. Возвращает, что лежало
 * в одноразовом инжекте в тот момент, когда таверна собирала промпт.
 */
async function swipeNew(tavern, id, text) {
  const m = tavern.chat[id];
  m.swipe_id = m.swipes.length; // пустой слот; `mes` пока старый
  await emit(tavern, 'message_swiped', id);
  await emit(tavern, 'generation_started', 'swipe', {}, false);
  const seen = promptsNow(tavern);
  m.swipes.push(text);
  m.mes = text;
  await emit(tavern, 'message_received', id, 'swipe');
  await emit(tavern, 'generation_ended', tavern.chat.length);
  return seen;
}

/** Регенерация: сначала старт, потом таверна сама срезает ответ. */
async function regenerate(tavern, text) {
  await emit(tavern, 'generation_started', 'regenerate', {}, false);
  tavern.chat.pop();
  await emit(tavern, 'message_deleted', tavern.chat.length);
  const seen = promptsNow(tavern);
  const id = say(tavern, text);
  await emit(tavern, 'message_received', id, 'normal');
  await emit(tavern, 'generation_ended', tavern.chat.length);
  return seen;
}

const promptsNow = (tavern) => ({
  status: (tavern.prompts.academy_status || {}).value || '',
  marker: (tavern.prompts.academy_marker || {}).value || '',
  oneShot: (tavern.prompts.academy_oneshot || {}).value || '',
});

const stateOf = (tavern) => tavern.chatMetadata.academy;
const gradesOf = (tavern, id) => stateOf(tavern).subjects.find((s) => s.id === id).grades;
const skips = (tavern) => stateOf(tavern).attendance.records.filter((r) => r.status === 'skip').length;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// --- 9.1.1: снимки свайпов переживают перезагрузку ---------------------------

test('9.1.1 свайп после перезагрузки заменяет оценку, а не дописывает вторую', async () => {
  let tavern = await withSemester();
  const id = await reply(tavern, `Пара прошла. ${marker('t=+1 grade=chemistry:5')}`);
  assert.equal(gradesOf(tavern, 'chemistry').length, 1);

  tavern = await reload(tavern);
  await swipeNew(tavern, id, `Пара прошла иначе. ${marker('t=+1 grade=chemistry:2')}`);

  const grades = gradesOf(tavern, 'chemistry');
  assert.equal(grades.length, 1, 'после F5 новый вариант лёг поверх старого');
  assert.equal(grades[0].value, '2');
  assert.equal(stateOf(tavern).calendar.periodIndex, 1, 'и пара посчитана один раз, а не две');
});

test('9.1.1 прогулы свайпнутого дня после перезагрузки не удваиваются', async () => {
  let tavern = await withSemester({ day: '2024-09-03' });
  const id = await reply(tavern, `Прогуляла химию. ${marker('t=+1 day skip=chemistry')}`);
  const once = skips(tavern);
  assert.ok(once > 0);

  tavern = await reload(tavern);
  await swipeNew(tavern, id, `И физику тоже мимо. ${marker('t=+1 day skip=physics')}`);
  assert.equal(skips(tavern), once);
  assert.equal(stateOf(tavern).calendar.day, '2024-09-04');
});

test('9.1.1 правка и удаление последнего ответа после перезагрузки откатывают', async () => {
  let tavern = await withSemester();
  const start = stateOf(tavern).calendar.periodIndex;
  const id = await reply(tavern, `Пара прошла. ${marker('t=+1 grade=physics:3')}`);

  tavern = await reload(tavern);
  tavern.chat[id].mes = `Пара прошла. ${marker('t=+1 grade=physics:5')}`;
  await emit(tavern, 'message_edited', id);
  assert.deepEqual(gradesOf(tavern, 'physics').map((g) => g.value), ['5'], 'правка пересчитала, а не дописала');

  tavern = await reload(tavern);
  tavern.chat.pop();
  await emit(tavern, 'message_deleted', tavern.chat.length);
  assert.equal(gradesOf(tavern, 'physics').length, 0, 'удалённый ответ унёс свою оценку и после F5');
  assert.equal(stateOf(tavern).calendar.periodIndex, start, 'и календарь вернулся');
});

test('9.1.1 тот же ответ, досланный ещё раз после перезагрузки, не считается дважды', async () => {
  let tavern = await withSemester();
  const id = await reply(tavern, `Пара прошла. ${marker('t=+1 grade=history:4')}`);
  tavern = await reload(tavern);
  // Соседи умеют пересылать MESSAGE_RECEIVED (перерисовка, перевод) — сторож
  // отпечатка обязан пережить перезагрузку вместе со снимком.
  await emit(tavern, 'message_received', id, 'normal');
  assert.equal(gradesOf(tavern, 'history').length, 1);
  assert.equal(stateOf(tavern).calendar.periodIndex, 1);
});

test('9.1.1 история ходов короткая, лежит рядом с состоянием и не едет в выгрузку', async () => {
  const tavern = await withSemester();
  for (let i = 0; i < 12; i += 1) await reply(tavern, `Шёл день. ${marker('t=+1')}`);

  const storage = await import('../storage.js');
  const turns = tavern.chatMetadata[storage.TURNS_KEY];
  assert.ok(turns && Array.isArray(turns.list), 'история ходов записана в метаданные чата');
  assert.equal(turns.list.length, storage.TURN_HISTORY, 'история не растёт без края');
  assert.ok(turns.list.every((t) => t.before && !t.before[storage.TURNS_KEY]), 'снимок — голое состояние');

  const { validateState } = await import('../core/state.mjs');
  assert.equal(validateState(stateOf(tavern), preset).ok, true, 'форма семестра не поменялась');
  const exported = await tavern.seam.host.actions.exportState();
  assert.equal(exported.json.includes('"before"'), false, 'снимки в файл выгрузки не уезжают');
});

test('9.1.1 новый семестр и загрузка стирают историю: свайп не вернёт чужое состояние', async () => {
  const tavern = await withSemester();
  const donor = await withSemester();
  donor.chatMetadata.academy.calendar.day = '2024-10-14';
  const file = (await donor.seam.host.actions.exportState()).json;
  globalThis.SillyTavern = { getContext: () => tavern };

  const id = await reply(tavern, `Пара прошла. ${marker('t=+1 grade=math:5')}`);
  const res = await tavern.seam.host.actions.importState(file, { confirm: true });
  assert.equal(res.ok, true);
  const storage = await import('../storage.js');
  const turns = tavern.chatMetadata[storage.TURNS_KEY];
  assert.equal(turns ? turns.list.length : 0, 0, 'история заменённого семестра забыта');

  // Свайп последнего ответа после загрузки не откатывает к семестру ДО загрузки.
  await swipeNew(tavern, id, 'Она молча шла по коридору.');
  assert.equal(stateOf(tavern).calendar.day, '2024-10-14', 'загруженный семестр остался на месте');
  assert.equal(gradesOf(tavern, 'math').length, 0);
});

// --- 9.1.2: вердикт переживает свайп и регенерацию ---------------------------

/** Канун сессии: первый же ответ «через день» сажает за контрольное. */
async function examDay() {
  const tavern = await withSemester({ day: '2024-12-22' });
  await reply(tavern, `Утро экзаменационного дня. ${marker('t=+1 day')}`);
  const verdict = promptsNow(tavern).oneShot;
  assert.ok(verdict.length > 0, 'исход контрольного обязан уйти в одноразовый инжект');
  return { tavern, verdict };
}

test('9.1.2 свайп ответа, описывающего экзамен, не стирает вердикт до генерации', async () => {
  const { tavern, verdict } = await examDay();
  user(tavern, 'Как прошло?');
  const answer = await reply(tavern, 'Она вышла из аудитории.');
  assert.equal(promptsNow(tavern).oneShot, '', 'вердикт отработал свою генерацию и снят');

  const seen = await swipeNew(tavern, answer, 'Она вышла из аудитории, сияя.');
  assert.equal(seen.oneShot, verdict, 'перегенерируемому ответу нужен тот же вердикт');
  assert.equal(stateOf(tavern).exams.items.filter((i) => i.outcome).length, 1, 'бросок не повторился');
  assert.equal(promptsNow(tavern).oneShot, '', 'а после нового варианта вердикт снова снят');
});

test('9.1.2 регенерация получает тот же вердикт', async () => {
  const { tavern, verdict } = await examDay();
  user(tavern, 'Как прошло?');
  await reply(tavern, 'Она вышла из аудитории.');

  const seen = await regenerate(tavern, 'Она вышла, не глядя ни на кого.');
  assert.equal(seen.oneShot, verdict);
  assert.equal(stateOf(tavern).exams.items.filter((i) => i.outcome).length, 1);
});

test('9.1.2 переключение на готовый свайп считает его сразу и не теряет вердикт следующему', async () => {
  const { tavern, verdict } = await examDay();
  const answer = await reply(tavern, `Она вышла. ${marker('grade=physics:4')}`);
  await swipeNew(tavern, answer, 'Она вышла молча.');
  assert.equal(gradesOf(tavern, 'physics').length, 0);

  // Назад, на первый вариант: MESSAGE_RECEIVED не придёт.
  const m = tavern.chat[answer];
  m.swipe_id = 0;
  m.mes = m.swipes[0];
  await emit(tavern, 'message_swiped', answer);
  assert.equal(gradesOf(tavern, 'physics').length, 1, 'готовый вариант посчитан без MESSAGE_RECEIVED');

  // И ещё раз вправо — на готовый второй: снова генерация для этого ответа
  // вердикт должна видеть, если бы она была.
  await emit(tavern, 'generation_started', 'swipe', {}, false);
  assert.equal(promptsNow(tavern).oneShot, verdict);
});

test('9.1.2 вердикт переживает F5 до следующей генерации', async () => {
  const { tavern, verdict } = await examDay();
  const again = await reload(tavern);
  assert.equal(promptsNow(again).oneShot, verdict, 'после F5 вердикт обязан дойти до следующего ответа');
});

// --- 9.1.3: фоновые генерации без наших инжектов -----------------------------

test('9.1.3 quiet-генерация соседа не видит ни строки состояния, ни вердикта', async () => {
  const { tavern, verdict } = await examDay();
  const before = promptsNow(tavern);
  assert.ok(before.status.length > 0 && before.marker.length > 0);

  await emit(tavern, 'generation_started', 'quiet', { quiet_prompt: 'Напиши СМС' }, false);
  assert.deepEqual(promptsNow(tavern), { status: '', marker: '', oneShot: '' });

  await emit(tavern, 'generation_ended', tavern.chat.length);
  assert.deepEqual(promptsNow(tavern), before, 'после фоновой генерации всё вернулось');
  assert.equal(promptsNow(tavern).oneShot, verdict, 'и вердикт не потрачен на СМС');
});

test('9.1.3 остановленная quiet-генерация тоже возвращает инжекты', async () => {
  const { tavern } = await examDay();
  const before = promptsNow(tavern);
  await emit(tavern, 'generation_started', 'quiet', {}, false);
  await emit(tavern, 'generation_stopped');
  assert.deepEqual(promptsNow(tavern), before);
});

test('9.1.3 если ENDED так и не пришёл, следующая обычная генерация всё вернёт', async () => {
  const { tavern } = await examDay();
  const before = promptsNow(tavern);
  await emit(tavern, 'generation_started', 'quiet', {}, false);
  await emit(tavern, 'generation_started', 'normal', {}, false);
  assert.deepEqual(promptsNow(tavern), before);
});

test('9.1.3 ответ, пришедший во время quiet, не распечатывает инжекты раньше времени', async () => {
  const { tavern } = await examDay();
  await emit(tavern, 'generation_started', 'quiet', {}, false);
  await reply(tavern, 'Она вышла в коридор.');
  assert.deepEqual(promptsNow(tavern), { status: '', marker: '', oneShot: '' });
  await emit(tavern, 'generation_ended', tavern.chat.length);
  assert.ok(promptsNow(tavern).status.length > 0);
});

test('9.1.3 пробная сборка промпта (dryRun) ничего не трогает', async () => {
  const { tavern } = await examDay();
  user(tavern, 'Как прошло?');
  await reply(tavern, 'Она вышла.');
  const before = promptsNow(tavern);
  await emit(tavern, 'generation_started', 'quiet', {}, true);
  assert.deepEqual(promptsNow(tavern), before, 'подсчёт токенов — не фоновая генерация');
  await emit(tavern, 'generation_started', 'swipe', {}, true);
  assert.deepEqual(promptsNow(tavern), before, 'и не свайп');
});

// --- 9.1.4: долгий запрос не пишет в чужой чат -------------------------------

const planJson = JSON.stringify({
  subjects: [{ id: 'chemistry', name: 'Химия', teacherId: 'petrova' }],
  teachers: [{ id: 'petrova', name: 'Петрова Анна', traits: ['злопамятна'] }],
});
const survey = { era: 'современность', country: 'Россия', institution: 'вуз', faculty: 'химфак', year: '2-й', lang: 'ru' };

/** Подключение таверны, которое отвечает, только когда тест разрешит. */
function slowTavern(tavern, answer) {
  const gate = { release: null };
  tavern.generateRaw = () => new Promise((resolve) => { gate.release = () => resolve(answer); });
  return gate;
}

async function switchChat(tavern, id, { emitEvent = true } = {}) {
  tavern.chatMetadata = {};
  tavern.chat = [];
  tavern.chatId = id;
  if (emitEvent) await emit(tavern, 'chat_id_changed', id);
}

test('9.1.4 план, пришедший после смены чата, не ложится в новый чат', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  const gate = slowTavern(tavern, planJson);

  const pending = seam.host.actions.generatePlan(survey);
  while (!gate.release) await tick();
  const oldMetadata = tavern.chatMetadata;
  await switchChat(tavern, 'chat-2');
  gate.release();
  const res = await pending;

  assert.equal(res.ok, false);
  assert.equal(res.code, 'chat-changed');
  assert.ok(res.error.length > 0, 'человеку говорят, куда делся план');
  assert.equal(tavern.chatMetadata.academy, undefined, 'в новый чат не записано ничего');
  assert.equal(oldMetadata.academy, undefined, 'и в мёртвый объект старого — тоже');
  assert.equal(seam.host.getState(), null);
});

test('9.1.4 смена чата замечается и до CHAT_CHANGED — по id чата', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  const gate = slowTavern(tavern, planJson);

  const pending = seam.host.actions.generatePlan(survey);
  while (!gate.release) await tick();
  await switchChat(tavern, 'chat-2', { emitEvent: false });
  gate.release();
  const res = await pending;
  assert.equal(res.code, 'chat-changed');
  assert.equal(tavern.chatMetadata.academy, undefined);
});

test('9.1.4 план в том же чате ложится как раньше', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  const gate = slowTavern(tavern, planJson);
  const pending = seam.host.actions.generatePlan(survey);
  while (!gate.release) await tick();
  gate.release();
  const res = await pending;
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(stateOf(tavern).subjects.map((s) => s.id), ['chemistry']);
});

test('9.1.4 автоанкета по карточке прошлого чата не заполняет анкету нового', async () => {
  const tavern = fakeTavern();
  tavern.name2 = 'Хината';
  tavern.characterId = 0;
  tavern.characters = [{ name: 'Хината', description: 'Старшая школа, наши дни.', personality: '', scenario: '', first_mes: '' }];
  const seam = await boot(tavern);
  const gate = slowTavern(tavern, '{"era":"наши дни","country":"Япония","institution":"старшая школа","faculty":"","year":"2"}');

  const pending = seam.host.actions.guessSurvey();
  while (!gate.release) await tick();
  await switchChat(tavern, 'chat-2');
  gate.release();
  const res = await pending;
  assert.equal(res.ok, false);
  assert.equal(res.code, 'chat-changed');
});

// --- 9.1.6: сообщения, которые вставляют расширения --------------------------

test('9.1.6 сообщение с чужим extra.from не считается ответом модели', async () => {
  const tavern = await withSemester();
  const start = stateOf(tavern).calendar.periodIndex;
  const id = say(tavern, `Комикс: «пятёрка по химии!» ${marker('t=+1 grade=chemistry:5')}`, { from: 'BB-Comic-Forge' });
  await emit(tavern, 'message_received', id, 'extension');
  assert.equal(gradesOf(tavern, 'chemistry').length, 0);
  assert.equal(stateOf(tavern).calendar.periodIndex, start, 'и пара не прошла');
});

test('9.1.6 удаление сообщения из середины не откатывает последний ход', async () => {
  const tavern = await withSemester();
  await reply(tavern, `Пара прошла. ${marker('t=+1 grade=chemistry:5')}`);
  user(tavern, 'Идём дальше.');
  await reply(tavern, `Вторая пара. ${marker('t=+1 grade=physics:4')}`);

  // Удаляется реплика человека между ответами: длина становится равна
  // индексу последнего ответа, и старое правило «снимки id >= length» считало
  // последний ход удалённым.
  tavern.chat.splice(1, 1);
  await emit(tavern, 'message_deleted', tavern.chat.length);

  assert.equal(gradesOf(tavern, 'physics').length, 1, 'последний ход на месте');
  assert.equal(gradesOf(tavern, 'chemistry').length, 1);
  assert.equal(stateOf(tavern).calendar.periodIndex, 2);

  // И после сдвига индексов свайп последнего ответа по-прежнему откатывает его.
  await swipeNew(tavern, tavern.chat.length - 1, `Вторая пара иначе. ${marker('t=+1 grade=physics:2')}`);
  assert.deepEqual(gradesOf(tavern, 'physics').map((g) => g.value), ['2']);
});

test('9.1.6 журнал телефона в середине чата: вставка без событий и удаление', async () => {
  const tavern = await withSemester();
  await reply(tavern, `Пара прошла. ${marker('t=+1 grade=chemistry:5')}`);
  user(tavern, 'Идём дальше.');
  const last = await reply(tavern, `Вторая пара. ${marker('t=+1 grade=physics:4')}`);

  // Телефон дописывает журнал в середину — без событий.
  tavern.chat.splice(1, 0, { mes: '[журнал соцсетей]', is_user: false, is_system: true });
  assert.equal(tavern.chat[last + 1].mes.startsWith('Вторая пара'), true);
  // ...и удаляет его штатным deleteMessage.
  tavern.chat.splice(1, 1);
  await emit(tavern, 'message_deleted', tavern.chat.length);
  assert.equal(gradesOf(tavern, 'physics').length, 1);

  // Вставка без событий и новый ответ после неё: ход считается как новый.
  tavern.chat.splice(1, 0, { mes: '[журнал соцсетей]', is_user: false, is_system: true });
  user(tavern, 'Дальше.');
  const third = await reply(tavern, `Третья пара. ${marker('t=+1 grade=history:5')}`);
  assert.equal(gradesOf(tavern, 'history').length, 1);
  await swipeNew(tavern, third, `Третья пара иначе. ${marker('t=+1 grade=history:3')}`);
  assert.deepEqual(gradesOf(tavern, 'history').map((g) => g.value), ['3']);
  assert.equal(gradesOf(tavern, 'physics').length, 1, 'свайп третьего не задел второй');
});

test('9.1.6 удаление двух последних ответов откатывает оба', async () => {
  const tavern = await withSemester();
  await reply(tavern, `Пара. ${marker('t=+1 grade=chemistry:5')}`);
  await reply(tavern, `Ещё пара. ${marker('t=+1 grade=physics:4')}`);
  await reply(tavern, `И ещё. ${marker('t=+1 grade=history:3')}`);
  tavern.chat.length = 1;
  await emit(tavern, 'message_deleted', tavern.chat.length);
  assert.equal(gradesOf(tavern, 'chemistry').length, 1);
  assert.equal(gradesOf(tavern, 'physics').length, 0);
  assert.equal(gradesOf(tavern, 'history').length, 0);
  assert.equal(stateOf(tavern).calendar.periodIndex, 1);
});

test('9.1.6 правка старого ответа не стирает всё, что было после него', async () => {
  const tavern = await withSemester();
  const first = await reply(tavern, `Пара. ${marker('t=+1 grade=chemistry:5')}`);
  await reply(tavern, `Ещё пара. ${marker('t=+1 grade=physics:4')}`);

  tavern.chat[first].mes = 'Пара. (опечатку поправила)';
  await emit(tavern, 'message_edited', first);
  assert.equal(gradesOf(tavern, 'physics').length, 1, 'поздний ход не откатился вместе с правкой раннего');
  assert.equal(gradesOf(tavern, 'chemistry').length, 1);
});

test('9.1.6 MESSAGE_UPDATED без смены текста не перебрасывает экзамен', async () => {
  const { tavern } = await examDay();
  const id = tavern.chat.length - 1;
  const outcome = stateOf(tavern).exams.items.find((i) => i.outcome).outcome;
  const journal = stateOf(tavern).journal.length;
  // Соседи шлют MESSAGE_UPDATED, дописав в `extra` картинку или перевод.
  await emit(tavern, 'message_updated', id);
  assert.equal(stateOf(tavern).exams.items.find((i) => i.outcome).outcome, outcome);
  assert.equal(stateOf(tavern).journal.length, journal);
});

test('9.1.6 два одинаковых ответа подряд — два хода, а не один', async () => {
  // Сторож по тексту узнаёт сообщение хода и после сдвига индексов, но не
  // должен склеивать соседей с одинаковым текстом: короткие ответы («Она
  // кивнула.») повторяются.
  const tavern = await withSemester();
  const start = stateOf(tavern).calendar.periodIndex;
  await reply(tavern, `Она кивнула. ${marker('t=+1')}`);
  await reply(tavern, `Она кивнула. ${marker('t=+1')}`);
  const once = stateOf(tavern).calendar.periodIndex;
  assert.notEqual(once, start);
  const storage = await import('../storage.js');
  assert.equal(tavern.chatMetadata[storage.TURNS_KEY].list.length, 2);

  // И удаление последнего из двух откатывает ровно один.
  tavern.chat.pop();
  await emit(tavern, 'message_deleted', tavern.chat.length);
  assert.equal(tavern.chatMetadata[storage.TURNS_KEY].list.length, 1);
});

// --- 9.2: реплика человека о времени — промотка и телефон ---------------------
//
// Проводка через `index.js`: реплика ищется перед ответом (`userTextBefore`),
// cue промотки на старте генерации даёт одноразовую строку. Ядро этих правил —
// в `time-skip.test.mjs`.

/** Cue ровно в том виде, в каком его пишет BB-Enhance-Gen (`BOT_CUES.ts_specific`). */
const bbCue = (time) => `\n\n> ⏩ **ПРОМОТКА ВРЕМЕНИ:** *Глава* ⏳ (${time}) <span style="display:none;">\n<system_note>\nTIME SKIP EVENT: Execute a logical TIME SKIP forward by ${time}. New Chapter: "Глава". Summary of situation: "—". In your next response, seamlessly transition the narrative.\n</system_note>\n</span>`;
const WEEK_LATER = 'Понедельник, 14 октября 2024 года. Неделя пролетела.';

test('9.2 ответ на реплику с промоткой прыгает без вопроса и без прогулов', async () => {
  const tavern = await withSemester({ day: '2024-10-07' });
  user(tavern, `Хватит на сегодня.${bbCue('Неделя')}`);
  await reply(tavern, WEEK_LATER);
  assert.equal(stateOf(tavern).calendar.day, '2024-10-14');
  assert.equal(stateOf(tavern).calendar.heldJump, null, 'человек уже выбрал промотку — «принять?» не спрашивается');
  assert.equal(skips(tavern), 0, 'skipPolicy attend: промотанная неделя — не прогулы');
});

test('9.2 промотка разрешает один прыжок: следующий ответ уже без неё', async () => {
  const tavern = await withSemester({ day: '2024-10-07' });
  user(tavern, `Спать.${bbCue('Завтра утром')}`);
  await reply(tavern, 'Утро. Она проспала первую лекцию.');
  user(tavern, 'Ну и ладно.');
  await reply(tavern, WEEK_LATER);
  assert.equal(stateOf(tavern).calendar.day, '2024-10-07', 'прыжок на неделю без промотки придержан');
  assert.equal(stateOf(tavern).calendar.heldJump.day, '2024-10-14');
});

test('9.2 свайп ответа на промотку — та же промотка', async () => {
  const tavern = await withSemester({ day: '2024-10-07' });
  user(tavern, `Спать.${bbCue('Неделя')}`);
  const id = await reply(tavern, WEEK_LATER);
  await swipeNew(tavern, id, 'Вторник, 15 октября 2024 года.');
  assert.equal(stateOf(tavern).calendar.day, '2024-10-15');
  assert.equal(stateOf(tavern).calendar.heldJump, null);
});

test('9.2 Enhance-Gen без текста в поле: cue дописан в прошлую реплику и свайп вправо', async () => {
  // `executeSkip`: пустое поле ввода → cue в `chat[lastUserIndex].mes`, потом
  // `.last_mes .swipe_right` — то есть свайп на новую генерацию.
  const tavern = await withSemester({ day: '2024-10-07' });
  const u = user(tavern, 'Пойдём домой.');
  const id = await reply(tavern, 'Они вышли из корпуса.');
  tavern.chat[u].mes += bbCue('Неделя');
  await swipeNew(tavern, id, WEEK_LATER);
  assert.equal(stateOf(tavern).calendar.day, '2024-10-14');
});

test('9.2 старт генерации после промотки кладёт строку «не перешагни контрольное»', async () => {
  const tavern = await withSemester({ day: '2024-12-16' });
  user(tavern, `Отдохнём.${bbCue('две недели')}`);
  await emit(tavern, 'generation_started', 'normal', {}, false);
  const seen = promptsNow(tavern).oneShot;
  assert.match(seen, /23\.12/);
  assert.match(seen, /накануне/);

  // Фоновая генерация соседа строку не видит — как и остальные инжекты (9.1.3).
  await emit(tavern, 'generation_started', 'quiet', {}, false);
  assert.equal(promptsNow(tavern).oneShot, '');
  await emit(tavern, 'generation_ended', tavern.chat.length);

  await emit(tavern, 'generation_started', 'normal', {}, false);
  await reply(tavern, 'Пятница, 20 декабря 2024 года.');
  await emit(tavern, 'generation_ended', tavern.chat.length);
  assert.equal(promptsNow(tavern).oneShot.includes('23.12'), false, 'ответ пришёл — строка отработала');
  assert.equal(stateOf(tavern).calendar.day, '2024-12-20');
});

test('9.2 без промотки и без контрольного впереди строки нет', async () => {
  const tavern = await withSemester({ day: '2024-10-07' });
  user(tavern, `Отдохнём.${bbCue('два дня')}`);
  await emit(tavern, 'generation_started', 'normal', {}, false);
  assert.equal(promptsNow(tavern).oneShot, '', 'контрольного в пределах промотки нет');
  user(tavern, 'Просто реплика.');
  await emit(tavern, 'generation_started', 'normal', {}, false);
  assert.equal(promptsNow(tavern).oneShot, '');
});

test('9.2 регенерация считает строку промотки от дня ДО срезанного ответа', async () => {
  const tavern = await withSemester({ day: '2024-12-16' });
  user(tavern, `Отдохнём.${bbCue('две недели')}`);
  await emit(tavern, 'generation_started', 'normal', {}, false);
  // Модель доехала ровно до первого дня сессии — туда можно.
  await reply(tavern, 'Понедельник, 23 декабря 2024 года.');
  await emit(tavern, 'generation_ended', tavern.chat.length);
  assert.equal(stateOf(tavern).calendar.day, '2024-12-23');

  // Старт регенерации приходит ДО среза: от 23-го ближайшее контрольное — 24-е.
  // После отката к 16-му строка обязана снова говорить про 23-е.
  const seen = await regenerate(tavern, 'Пятница, 20 декабря 2024 года.');
  assert.match(seen.oneShot, /23\.12/);
  assert.equal(seen.oneShot.includes('24.12'), false);
});

test('9.2 ответ на [СМС → X] не двигает пару и не даёт прогулов', async () => {
  const tavern = await withSemester();
  const start = stateOf(tavern).calendar.periodIndex;
  user(tavern, '[СМС → Лиза] ты где?');
  await reply(tavern, `Лиза: «в библиотеке». ${marker('t=+1')}`);
  assert.equal(stateOf(tavern).calendar.periodIndex, start, 'переписка — пауза, а не пара');
  user(tavern, '[Голосовое → Лиза] иду');
  await reply(tavern, `Лиза прислала стикер. ${marker('t=+1 day')}`);
  assert.equal(stateOf(tavern).calendar.day, TERM_START);
  assert.equal(skips(tavern), 0);

  // Обычная реплика — и время снова идёт.
  user(tavern, 'Она вернулась в аудиторию.');
  await reply(tavern, `Пара кончилась. ${marker('t=+1')}`);
  assert.equal(stateOf(tavern).calendar.periodIndex, start + 1);
});

// --- etap-time-a-plus: подсказка дня старта видит теги соседей ----------------

test('startDayHint берёт год из тега телефона, который проза не видит', async () => {
  const tavern = fakeTavern();
  tavern.chat.push({ mes: 'Утро. Она собирается на учёбу.\n<!--tel:time:08:10 02.09.1987-->', is_user: false, is_system: false });
  const seam = await boot(tavern);
  const hint = seam.host.getStartHint();
  assert.equal(hint.from, 'chat');
  assert.equal(hint.day, '1987-09-02');
});

// --- 9.3.1: макрос {{academy}} -------------------------------------------------

test('9.3.1 {{academy}} зарегистрирован в новом движке и отдаёт строку состояния', async () => {
  const tavern = await withSemester();
  const def = tavern.macros.registry.academy;
  assert.ok(def && typeof def.handler === 'function', 'макрос зарегистрирован через macros.register');
  assert.equal(tavern.legacyMacros.academy, undefined, 'и не продублирован в старом движке');
  const line = def.handler({});
  assert.ok(line.length > 0);
  assert.equal(line, promptsNow(tavern).status, 'та же строка, что и автоинжект');
});

test('9.3.1 галочка «через макрос» гасит только строку; инструкция и факт — инжектами', async () => {
  const { tavern, verdict } = await examDay();
  const before = promptsNow(tavern);
  tavern.seam.host.setSettings({ statusViaMacro: true });
  const after = promptsNow(tavern);
  assert.equal(after.status, '', 'строку человек ставит сам');
  assert.equal(after.marker, before.marker, 'инструкция метки на месте');
  assert.equal(after.oneShot, verdict, 'одноразовый факт на месте');
  assert.equal(tavern.macros.registry.academy.handler({}), before.status, 'макрос отдаёт строку');

  tavern.seam.host.setSettings({ statusViaMacro: false });
  assert.equal(promptsNow(tavern).status, before.status, 'галочку сняли — автоинжект вернулся');
});

test('9.3.1 в фоновой генерации {{academy}} пуст, как и инжекты', async () => {
  const tavern = await withSemester();
  const macro = tavern.macros.registry.academy;
  await emit(tavern, 'generation_started', 'quiet', {}, false);
  assert.equal(macro.handler({}), '');
  await emit(tavern, 'generation_ended', tavern.chat.length);
  assert.ok(macro.handler({}).length > 0);
});

/** Семестр в подделке, собранной руками до запуска модуля. */
async function seedSemester(tavern) {
  const { createState } = await import('../core/state.mjs');
  const { buildSchedule } = await import('../core/schedule.mjs');
  const state = createState(preset, {
    startDay: TERM_START, subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
  });
  state.started = true;
  tavern.chatMetadata.academy = state;
  return state;
}

test('9.3.1 старый движок макросов: регистрация через registerMacro', async () => {
  const tavern = fakeTavern();
  tavern.powerUserSettings.experimental_macro_engine = false;
  await seedSemester(tavern);
  await boot(tavern);
  assert.equal(tavern.macros.registry.academy, undefined);
  assert.equal(typeof tavern.legacyMacros.academy, 'function');
  assert.ok(tavern.legacyMacros.academy('nonce').length > 0);
});

test('9.3.1 без семестра {{academy}} пуст', async () => {
  const tavern = fakeTavern();
  await boot(tavern);
  assert.equal(tavern.macros.registry.academy.handler({}), '');
});

// --- 9.3.6: стоп-лист имён из таверны ----------------------------------------

test('9.3.6 rel= к героине не проходит: name1 уходит в стоп-лист', async () => {
  const tavern = fakeTavern();
  tavern.name1 = 'Сидорова Мария Львовна';
  await seedSemester(tavern);
  tavern.seam = await boot(tavern);
  const rel = () => stateOf(tavern).teachers.find((t) => t.id === 'sidorova').relation;
  const was = rel();
  await reply(tavern, `Разговор. ${marker('rel=sidorova:+2')}`);
  assert.equal(rel(), was, 'преподаватель с именем героини — это героиня');
  assert.ok(tavern.seam.live.lastRun.rejected.some((r) => /стоп-лист/.test(r.reason)));
});

test('9.3.6 план с преподавателем-тёзкой героини ложится целиком, но с предупреждением', async () => {
  const tavern = fakeTavern();
  tavern.name1 = 'Петрова Анна';
  const seam = await boot(tavern);
  const gate = slowTavern(tavern, planJson);
  const pending = seam.host.actions.generatePlan(survey);
  while (!gate.release) await tick();
  gate.release();
  const res = await pending;
  assert.equal(res.ok, true);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /Петрова Анна/);
  assert.match(res.warnings[0], /вашего персонажа/);
  assert.deepEqual(stateOf(tavern).teachers.map((t) => t.id), ['petrova'], 'выбросить нельзя: на него ссылается предмет');
});

test('9.3.6 в групповом чате в стоп-лист идут все карточки группы', async () => {
  const tavern = fakeTavern();
  tavern.name2 = 'Рассказчик';
  tavern.groupId = 'g1';
  tavern.groups = [{ id: 'g1', members: ['narr.png', 'anna.png'] }];
  tavern.characters = [{ avatar: 'narr.png', name: 'Рассказчик' }, { avatar: 'anna.png', name: 'Петрова Анна' }];
  const seam = await boot(tavern);
  const gate = slowTavern(tavern, planJson);
  const pending = seam.host.actions.generatePlan(survey);
  while (!gate.release) await tick();
  gate.release();
  const res = await pending;
  assert.equal(res.ok, true);
  assert.equal(res.warnings.length, 1);
  assert.match(res.warnings[0], /карточкой/);
});

test('9.3.6 чистый план — без предупреждений, как раньше', async () => {
  const tavern = fakeTavern();
  tavern.name1 = 'Алиса';
  const seam = await boot(tavern);
  const gate = slowTavern(tavern, planJson);
  const pending = seam.host.actions.generatePlan(survey);
  while (!gate.release) await tick();
  gate.release();
  assert.deepEqual(await pending, { ok: true });
});

// --- 9.1.4 для лорбука: World Info не пишется в чужой чат ---------------------

/** World Info таверны: `loadWorldInfo` отвечает, только когда тест разрешит. */
function slowWorldInfo(tavern) {
  const books = { 'Academy chat-1': { entries: {} } };
  const gate = { release: null, saved: [] };
  tavern.loadWorldInfo = (name) => new Promise((resolve) => {
    gate.release = () => resolve(structuredClone(books[name] || { entries: {} }));
  });
  tavern.saveWorldInfo = async (name, data) => { gate.saved.push(name); books[name] = data; };
  tavern.getWorldInfoNames = () => Object.keys(books);
  tavern.updateWorldInfoList = async () => {};
  tavern.extensionSettings.academy = { ...(tavern.extensionSettings.academy || {}), lorebook: { enabled: true } };
  return gate;
}

test('9.1.4 лорбук: ответ World Info после смены чата не пишется никуда', async () => {
  const tavern = await withSemester();
  tavern.chatMetadata.world_info = 'Academy chat-1';
  const gate = slowWorldInfo(tavern);
  const pending = tavern.seam.host.actions.syncLorebook();
  while (!gate.release) await tick();
  await switchChat(tavern, 'chat-2');
  gate.release();
  await pending;
  assert.deepEqual(gate.saved, [], 'записи семестра прошлого чата в лорбук не легли');
  assert.equal(tavern.chatMetadata.world_info, undefined, 'и новый чат ни к чему не привязан');
});

test('9.1.4 лорбук: в том же чате синхронизация пишет, как раньше', async () => {
  const tavern = await withSemester();
  tavern.chatMetadata.world_info = 'Academy chat-1';
  const gate = slowWorldInfo(tavern);
  const pending = tavern.seam.host.actions.syncLorebook();
  while (!gate.release) await tick();
  gate.release();
  const res = await pending;
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(gate.saved, ['Academy chat-1']);
});

test('9.1.4 лорбук: привязка нового лорбука не ложится в чужой чат', async () => {
  const lorebook = await import('../lorebook.js');
  const tavern = fakeTavern();
  const saved = [];
  let here = true;
  tavern.loadWorldInfo = async () => ({ entries: {} });
  tavern.saveWorldInfo = async (name) => { saved.push(name); };
  tavern.getWorldInfoNames = () => [];
  // Человек ушёл, пока таверна обновляла список лорбуков.
  tavern.updateWorldInfoList = async () => { here = false; };
  const state = await seedSemester(tavern);
  const md = tavern.chatMetadata;
  const res = await lorebook.syncLorebook(tavern, state, preset, {
    settings: { lorebook: { enabled: true } },
    guard: () => here,
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, lorebook.CHAT_CHANGED);
  assert.equal(md.world_info, undefined, 'привязка не записана');
  assert.equal(tavern.flushes, 0, 'и текущий (уже чужой) чат не сохранён');
  assert.deepEqual(saved, ['Академия — chat-1'], 'пустой файл остаётся — прошлый чат его просто привяжет');
});

test('9.1.4 лорбук: удаление сирот после смены чата не удаляет ничего', async () => {
  const lorebook = await import('../lorebook.js');
  const tavern = fakeTavern();
  tavern.chatMetadata.world_info = 'Academy chat-1';
  let here = true;
  const saved = [];
  tavern.loadWorldInfo = async () => {
    here = false;
    return { entries: { 0: { uid: 0, content: 'x', academy: { uid: 'chronicle:1', fingerprint: 'f' } } } };
  };
  tavern.saveWorldInfo = async (name) => { saved.push(name); };
  const res = await lorebook.pruneOrphans(tavern, ['chronicle:1'], {
    settings: { lorebook: { enabled: true } },
    guard: () => here,
  });
  assert.equal(res.reason, lorebook.CHAT_CHANGED);
  assert.deepEqual(saved, []);
});

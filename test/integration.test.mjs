import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILTIN_PRESETS } from '../core/preset.mjs';

// Это прогон `index.js` целиком — того самого файла, который в живой таверне
// сшивает события с ядром. Таверны здесь нет, вместо неё подделка: контекст с
// теми полями и той семантикой, что записаны в `etap2-st-facts.md`, и лента
// событий, которую таверна шлёт на самом деле.
//
// Смысл прогона ровно один: швы этапа 1 нашлись не чтением, а исполнением.
// Здесь проверяется то, чего не видит ни один модульный тест — что один ответ
// модели посчитан один раз, что свайп откатывает, а не удваивает, и что
// одноразовый инжект живёт ровно одну генерацию.

const presetPath = (id) => fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url));
const loadPresetFile = (id) => JSON.parse(readFileSync(presetPath(id), 'utf8'));
const preset = loadPresetFile('ru-university');
const manifestPath = fileURLToPath(new URL('../manifest.json', import.meta.url));
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const TERM_START = '2024-09-02'; // понедельник: первая неделя начинается с первого учебного дня

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

/**
 * Контекст с теми именами полей, что стоят в `st-context.js`: `chatMetadata`,
 * `extensionSettings`, `characterId`. Ошибка в имени здесь означала бы, что
 * прогон зелёный, а живое расширение молчит, — поэтому имена списаны с фактов,
 * а не с памяти.
 */
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
      MESSAGE_SWIPED: 'message_swiped',
      MESSAGE_EDITED: 'message_edited',
      MESSAGE_UPDATED: 'message_updated',
      MESSAGE_DELETED: 'message_deleted',
      CHAT_CHANGED: 'chat_id_changed',
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
    getCurrentChatId: () => 'chat-1',
    saves: 0,
    flushes: 0,
  };
  return tavern;
}

/**
 * World Info поверх поддельной таверны — с теми именами, что выведены наружу в
 * `st-context.js:276-282`: `loadWorldInfo`, `saveWorldInfo`, `updateWorldInfoList`,
 * `getWorldInfoNames`. Больше таверна наружу ничего не отдаёт, поэтому и здесь
 * нет ни `createNewWorldInfo`, ни `createWorldInfoEntry`: расширение обязано
 * обходиться тем, что есть.
 *
 * `calls` считает **любое** обращение — на нём держится проверка «выключенная
 * галочка означает, что в World Info не ходят вовсе».
 */
function withWorldInfo(tavern) {
  const worlds = new Map();
  const wi = { worlds, calls: 0, loads: 0, saves: 0 };
  tavern.wi = wi;
  tavern.loadWorldInfo = async (name) => { wi.calls += 1; wi.loads += 1; return worlds.get(name) || null; };
  tavern.saveWorldInfo = async (name, data) => { wi.calls += 1; wi.saves += 1; worlds.set(name, data); };
  tavern.updateWorldInfoList = async () => { wi.calls += 1; };
  tavern.getWorldInfoNames = () => { wi.calls += 1; return [...worlds.keys()]; };
  return tavern;
}

/** Записи лорбука чата — так, как их увидит таверна в `getChatLore`. */
function bookEntries(tavern) {
  const name = tavern.chatMetadata.world_info;
  const data = name ? tavern.wi.worlds.get(name) : null;
  return data ? Object.values(data.entries) : [];
}

const LOREBOOK_ON = { academy: { lorebook: { enabled: true } } };

/** Ответ модели приходит в чат так же, как его кладёт таверна: текст в `mes`. */
function say(tavern, text) {
  tavern.chat.push({ mes: text, is_user: false, is_system: false, swipes: [text], swipe_id: 0 });
  return tavern.chat.length - 1;
}

/**
 * Загрузка `index.js` в Node.
 *
 * `index.js` — модуль браузера: он зовёт `SillyTavern.getContext()` и читает
 * пресет через `fetch`. Обе зависимости подставляются здесь, а не правятся в
 * самом файле: расширение должно проверяться тем же кодом, который поедет в
 * таверну, иначе прогон проверяет не его.
 */
async function boot(tavern) {
  globalThis.SillyTavern = { getContext: () => tavern };
  globalThis.fetch = async (url) => {
    const s = String(url);
    // Все три пресета и манифест — то же, что лежит в папке расширения.
    // Подменять их выдумкой нельзя: выбор пресета и версия в конверте выгрузки
    // читаются именно этими походами, и прогон по фальшивке проверял бы себя.
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
  // Свежий модуль на каждый прогон: `index.js` держит состояние вкладки в
  // замыкании, и общий на два теста экземпляр склеил бы два разных семестра.
  const mod = await import(`../index.js?run=${Math.random()}`);
  // Запуск ждётся его собственным обещанием, а не паузой: пресет, манифест и
  // список пресетов — четыре похода за файлами, и фиксированная пауза была бы
  // зелёной ровно до первого медленного диска.
  await mod.__seam.ready;
  return mod.__seam;
}

/**
 * Поддельная панель: в Node её нет, а проверять надо именно то, что после
 * действия она перерисовывается. Считаем вызовы `render` — это и есть шов
 * `index.js:refreshPanel` → `ui.js:renderPanel`.
 */
function watchPanel(seam) {
  const panel = { renders: 0, render() { panel.renders += 1; } };
  seam.live.panel = panel;
  return panel;
}

/** Готовый семестр прямо в метаданных: анкету и генерацию плана здесь не гоняем. */
async function withSemester(extra = {}, opts = {}) {
  const tavern = fakeTavern();
  const { createState } = await import('../core/state.mjs');
  const { buildSchedule } = await import('../core/schedule.mjs');
  // Пресет по умолчанию — вуз, как во всём файле. Другой берётся аргументом:
  // японская школа нужна ровно одному прогону (середина периода), и заводить
  // ради неё вторую поддельную таверну значило бы держать две правды о том, как
  // расширение запускается.
  const active = opts.preset || preset;
  const state = createState(active, {
    startDay: opts.start || TERM_START,
    subjects: SUBJECTS,
    teachers: TEACHERS,
    schedule: buildSchedule(SUBJECTS, active),
  });
  state.started = true;
  // День ставится ДО загрузки: `storage` отдаёт расширению разобранную копию, и
  // правка метаданных задним числом до него уже не доедет.
  if (opts.day) state.calendar.day = opts.day;
  tavern.chatMetadata.academy = state;
  Object.assign(tavern.extensionSettings, extra);
  if (opts.worldInfo) withWorldInfo(tavern);
  tavern.seam = await boot(tavern);
  return tavern;
}

const stateOf = (tavern) => tavern.chatMetadata.academy;
const skips = (tavern) => stateOf(tavern).attendance.records.filter((r) => r.status === 'skip').length;

// --- прогон ------------------------------------------------------------------

test('расширение молчит, пока семестр не начат: инжектов нет', async () => {
  const tavern = fakeTavern();
  await boot(tavern);
  const id = say(tavern, `Она пришла на пару. ${marker('t=+1')}`);
  await tavern.eventSource.emit('message_received', id);

  assert.equal(tavern.prompts.academy_status.value, '');
  assert.equal(tavern.chatMetadata.academy, undefined);
});

test('обычный ответ: время двигается, состояние сохраняется, строка уходит в промпт', async () => {
  const tavern = await withSemester();
  const before = stateOf(tavern).calendar.day;

  const id = say(tavern, `Химия прошла спокойно. ${marker('t=+1 grade=chemistry:5')}`);
  await tavern.eventSource.emit('message_received', id);

  const state = stateOf(tavern);
  assert.equal(state.calendar.day, before, 'одна пара — день тот же');
  assert.equal(state.calendar.periodIndex, 1);
  assert.equal(state.subjects.find((s) => s.id === 'chemistry').grades.length, 1);
  assert.ok(tavern.prompts.academy_status.value.length > 0);
  assert.equal(tavern.prompts.academy_status.position, 1, 'IN_CHAT');
  assert.equal(tavern.prompts.academy_status.depth, 1);
  assert.ok(tavern.saves > 0);
});

test('тот же ответ дважды не считается дважды', async () => {
  const tavern = await withSemester();
  const id = say(tavern, `Пара прошла. ${marker('t=+1 grade=chemistry:4')}`);

  await tavern.eventSource.emit('message_received', id);
  await tavern.eventSource.emit('message_received', id);
  await tavern.eventSource.emit('character_message_rendered', id);

  assert.equal(stateOf(tavern).subjects.find((s) => s.id === 'chemistry').grades.length, 1);
  assert.equal(stateOf(tavern).calendar.periodIndex, 1);
});

test('свайп на новую генерацию откатывает состояние, а не удваивает его', async () => {
  // Со следующего дня после заведения: сутки, в которые семестр заведён,
  // ведомостью не обсчитываются вовсе (`attendance.countsAttendance`), и
  // прогуливать в них нечего.
  const tavern = await withSemester({}, { day: '2024-09-03' });
  const id = say(tavern, `Прогуляла химию. ${marker('t=+1 day skip=chemistry')}`);
  await tavern.eventSource.emit('message_received', id);
  const afterFirst = skips(tavern);
  assert.ok(afterFirst > 0, 'названный прогул должен появиться');

  // Свайп: таверна шлёт MESSAGE_SWIPED, подменяет текст и шлёт MESSAGE_RECEIVED
  // повторно (script.js:6610-6632). Текст обязан быть ДРУГИМ: на том же самом
  // ответ отсеял бы сторож отпечатка, и тест прошёл бы даже без отката —
  // проверял бы не то, ради чего написан.
  tavern.chat[id].mes = `И физику она тоже пропустила. ${marker('t=+1 day skip=physics')}`;
  await tavern.eventSource.emit('message_swiped', id);
  await tavern.eventSource.emit('message_received', id);

  assert.equal(
    skips(tavern), afterFirst,
    'свайп на другой текст с тем же исходом обязан заменить прогулы, а не добавить вторые',
  );
  assert.equal(stateOf(tavern).calendar.day, '2024-09-04', 'календарь тоже откатывается и едет заново');
});

test('переключение на готовый свайп считается без MESSAGE_RECEIVED', async () => {
  const tavern = await withSemester();
  const id = say(tavern, `Пара прошла. ${marker('t=+1 grade=chemistry:5')}`);
  await tavern.eventSource.emit('message_received', id);
  assert.equal(stateOf(tavern).subjects.find((s) => s.id === 'chemistry').grades[0].value, '5');

  // Готовый свайп: MESSAGE_RECEIVED не придёт вовсе (script.js:10232).
  tavern.chat[id].mes = `Пара прошла иначе. ${marker('t=+1 grade=chemistry:2')}`;
  await tavern.eventSource.emit('message_swiped', id);

  const grades = stateOf(tavern).subjects.find((s) => s.id === 'chemistry').grades;
  assert.equal(grades.length, 1, 'старая оценка обязана исчезнуть вместе со старым свайпом');
  assert.equal(grades[0].value, '2');
});

test('правка сообщения руками пересчитывает, а не дописывает', async () => {
  const tavern = await withSemester();
  const id = say(tavern, `Пара прошла. ${marker('t=+1 grade=physics:3')}`);
  await tavern.eventSource.emit('message_received', id);

  tavern.chat[id].mes = `Пара прошла. ${marker('t=+1 grade=physics:5')}`;
  await tavern.eventSource.emit('message_edited', id);

  const grades = stateOf(tavern).subjects.find((s) => s.id === 'physics').grades;
  assert.equal(grades.length, 1);
  assert.equal(grades[0].value, '5');
});

test('одноразовый инжект живёт ровно одну генерацию', async () => {
  const tavern = await withSemester();

  // Три ответа подряд с четырьмя названными прогулами: репутация пробивает
  // порог (десятый прогул) и приходит одноразовый инжект (3.4).
  let last = null;
  for (let i = 0; i < 3; i += 1) {
    last = say(tavern, `Её не было. ${marker('t=+1 day skip=chemistry skip=physics skip=history skip=math')}`);
    await tavern.eventSource.emit('message_received', last);
    if (tavern.prompts.academy_oneshot.value) break;
  }
  assert.ok(tavern.prompts.academy_oneshot.value.length > 0, 'порог репутации обязан дать инжект');
  assert.equal(tavern.prompts.academy_oneshot.depth, 0, 'повелительный факт — ближе всех к концу');

  const quiet = say(tavern, 'Она молча шла по коридору.');
  await tavern.eventSource.emit('message_received', quiet);
  assert.equal(tavern.prompts.academy_oneshot.value, '', 'на следующем ответе инжект обязан сняться');
});

test('режим «из контекста»: инструкция про метку не инжектится', async () => {
  const tavern = await withSemester({ academy: { mode: 'context', injectMarker: true } });
  const id = say(tavern, `📅 3 сентября 2024, 09:00. Она вошла в аудиторию.`);
  await tavern.eventSource.emit('message_received', id);

  assert.equal(tavern.prompts.academy_marker.value, '', 'метку в этом режиме никто не просит');
  assert.equal(stateOf(tavern).calendar.day, '2024-09-03', 'время взято из прозы');
});

test('смена чата не тащит семестр в другой чат', async () => {
  const tavern = await withSemester();
  const id = say(tavern, `Пара прошла. ${marker('t=+1')}`);
  await tavern.eventSource.emit('message_received', id);
  assert.ok(tavern.prompts.academy_status.value.length > 0);

  tavern.chatMetadata = {}; // таверна переприсваивает объект целиком (script.js:7598)
  tavern.chat = [];
  await tavern.eventSource.emit('chat_id_changed', 'chat-2');

  assert.equal(tavern.prompts.academy_status.value, '', 'в чужом чате расширение молчит');
  assert.equal(tavern.prompts.academy_oneshot.value, '');
});

test('удаление сообщения откатывает то, что оно принесло', async () => {
  const tavern = await withSemester();
  const id = say(tavern, `Пара прошла. ${marker('t=+1 grade=history:5')}`);
  await tavern.eventSource.emit('message_received', id);
  assert.equal(stateOf(tavern).subjects.find((s) => s.id === 'history').grades.length, 1);

  tavern.chat.pop();
  await tavern.eventSource.emit('message_deleted', tavern.chat.length);

  assert.equal(stateOf(tavern).subjects.find((s) => s.id === 'history').grades.length, 0);
});

test('сессия: исход считается расширением и уходит одноразовым инжектом, не чаще раза в день', async () => {
  // Канун сессии: семнадцатая неделя от 2 сентября начинается 23 декабря.
  // Гонять шестнадцать недель ответов ради этой проверки незачем — вход в
  // сессию считает `time.phaseOf` сам.
  const tavern = await withSemester({}, { day: '2024-12-22' });

  const first = say(tavern, `Утро экзаменационного дня. ${marker('t=+1 day')}`);
  await tavern.eventSource.emit('message_received', first);

  const state = stateOf(tavern);
  assert.equal(state.exams.active, true, 'календарь вошёл в сессию — контрольные назначены');
  const done = state.exams.items.filter((i) => i.outcome);
  assert.equal(done.length, 1, 'за один день сдаётся ровно одно контрольное');
  assert.ok(
    tavern.prompts.academy_oneshot.value.includes(state.subjects.find((s) => s.id === done[0].subjectId).name),
    'посчитанный исход обязан уйти в промпт повелительной фразой',
  );

  // Второй ответ в тот же день: считать второй экзамен нельзя, иначе лента из
  // четырёх контрольных сгорает за четыре сообщения.
  const same = say(tavern, 'Она вышла в коридор и села на подоконник.');
  await tavern.eventSource.emit('message_received', same);
  assert.equal(stateOf(tavern).exams.items.filter((i) => i.outcome).length, 1);
  assert.equal(tavern.prompts.academy_oneshot.value, '', 'инжект прошлого исхода снят');

  // Следующий день — следующее контрольное.
  const next = say(tavern, `Назавтра. ${marker('t=+1 day')}`);
  await tavern.eventSource.emit('message_received', next);
  assert.equal(stateOf(tavern).exams.items.filter((i) => i.outcome).length, 2);
});

// --- 8.1: модель написала свой исход -----------------------------------------
//
// Шов, ради которого всё и затевалось: `resolveConflict` был написан, покрыт
// тестами и недостижим — `index.js` не передавал `modelSaid` никогда, и оценка
// от модели ложилась в зачётку второй записью рядом с брошенной. Поэтому
// проверяется он здесь, ответом в чате, а не вызовом ядра руками.

/**
 * Зажатый бросок. Раньше подменялся `Math.random`: `index.js` своего rng не
 * принимал. Теперь бросок идёт от seed (id чата + начало семестра, 9.3.9), и
 * `Math.random` на него не влияет вовсе, — поэтому зажим идёт через шов
 * `live.examRng`, который ядро ставит выше seed (`engine.sitExam`: rng → seed).
 */
async function withRoll(tavern, value, fn) {
  const live = tavern.seam.live;
  const was = live.examRng;
  live.examRng = () => value;
  try { return await fn(); } finally { live.examRng = was; }
}

const divergencesOf = (tavern) => stateOf(tavern).journal
  .filter((e) => e.data && e.data.modelSaid !== undefined);

test('сессия: `grade=` за сегодняшнее контрольное побеждает бросок и не удваивает оценку (8.1)', async () => {
  const tavern = await withSemester({}, { day: '2024-12-22' });
  const first = say(tavern, `Утро экзаменационного дня. ${marker('t=+1 day')}`);
  await tavern.eventSource.emit('message_received', first);

  // Следующее контрольное известно заранее — за него завтра и сядут.
  const item = stateOf(tavern).exams.items.find((i) => !i.outcome);
  const subjectId = item.subjectId;
  const before = stateOf(tavern).subjects.find((s) => s.id === subjectId).grades.length;

  await withRoll(tavern, 0, async () => {
    const id = say(tavern, `Назавтра она вышла с экзамена с пятёркой. ${marker(`t=+1 day grade=${subjectId}:5`)}`);
    await tavern.eventSource.emit('message_received', id);
  });

  const state = stateOf(tavern);
  const done = state.exams.items.find((i) => i.id === item.id);
  assert.equal(done.outcome, '5', 'побеждает модель: в событии стоит её версия');
  assert.equal(done.modelOverride, true);

  const subject = state.subjects.find((s) => s.id === subjectId);
  assert.equal(subject.grades.length, before + 1, 'в зачётке ровно одна новая оценка, а не две');
  assert.equal(subject.grades[subject.grades.length - 1].value, '5');

  const record = divergencesOf(tavern).find((e) => e.data.examId === item.id);
  assert.ok(record, 'расхождение записано в журнал');
  assert.equal(record.data.applied, true);
  assert.notEqual(record.data.computed, '5', 'бросок при зажатом случае даёт не пятёрку — спорить есть о чём');

  // И то же самое видно в отладке панели — тем же путём, каким её читает `ui.js`.
  const { debugView } = await import('../ui.js');
  const view = debugView(tavern.seam.live.lastRun, state, tavern.seam.host.getPreset(), { debug: true });
  assert.equal(view.divergences.length, 1);
  assert.equal(view.divergences[0].said, '5');

  // Второй ответ того же дня: бросок уже был, и вторая оценка от модели тоже
  // переписывает исход, а не ложится рядом.
  const again = say(tavern, `Преподаватель передумал: четыре. ${marker(`grade=${subjectId}:4`)}`);
  await tavern.eventSource.emit('message_received', again);
  const late = stateOf(tavern);
  assert.equal(late.exams.items.find((i) => i.id === item.id).outcome, '4');
  assert.equal(late.subjects.find((s) => s.id === subjectId).grades.length, before + 1,
    'запись переписана, а не добавлена');
});

test('оценка по другому предмету в день контрольного остаётся обычной оценкой (8.1)', async () => {
  const tavern = await withSemester({}, { day: '2024-12-22' });
  const first = say(tavern, `Утро экзаменационного дня. ${marker('t=+1 day')}`);
  await tavern.eventSource.emit('message_received', first);

  const state = stateOf(tavern);
  const sat = state.exams.items.find((i) => i.outcome);
  const other = state.subjects.find((s) => s.id !== sat.subjectId);
  const before = state.subjects.find((s) => s.id === other.id).grades.length;

  const id = say(tavern, `Она забежала на пересдачу к другому. ${marker(`grade=${other.id}:4`)}`);
  await tavern.eventSource.emit('message_received', id);

  const after = stateOf(tavern);
  assert.equal(after.subjects.find((s) => s.id === other.id).grades.length, before + 1);
  assert.deepEqual(divergencesOf(tavern), [], 'с броском это никак не связано');
  assert.equal(after.exams.items.filter((i) => i.outcome).length, 1,
    'и второго контрольного за день не случилось');
});

test('свайп уносит расхождение из журнала вместе со всем ответом (8.1)', async () => {
  const tavern = await withSemester({}, { day: '2024-12-22' });
  const first = say(tavern, `Утро экзаменационного дня. ${marker('t=+1 day')}`);
  await tavern.eventSource.emit('message_received', first);

  const item = stateOf(tavern).exams.items.find((i) => !i.outcome);
  const subjectId = item.subjectId;
  const grades = () => stateOf(tavern).subjects.find((s) => s.id === subjectId).grades.length;
  const before = grades();

  let id;
  await withRoll(tavern, 0, async () => {
    id = say(tavern, `Назавтра — пятёрка. ${marker(`t=+1 day grade=${subjectId}:5`)}`);
    await tavern.eventSource.emit('message_received', id);
  });
  assert.equal(divergencesOf(tavern).length, 1, 'расхождение записано — иначе откатывать нечего');

  // Свайп с новой генерацией: таверна подменяет текст и шлёт оба события.
  await tavern.eventSource.emit('message_swiped', id);
  tavern.chat[id].mes = 'Она вышла из аудитории молча.';
  await tavern.eventSource.emit('message_received', id);

  assert.deepEqual(divergencesOf(tavern), [], 'после отката расхождения в журнале нет');
  // Новый текст времени не двигает, значит день прежний, а за него уже сдавали:
  // контрольное снова несданное, и ни исхода, ни оценки от снятого ответа.
  const done = stateOf(tavern).exams.items.find((i) => i.id === item.id);
  assert.equal(done.outcome ?? null, null, 'исход снят вместе с ответом');
  assert.equal(done.modelOverride ?? false, false, 'и версии модели там больше нет');
  assert.equal(grades(), before, 'оценка от снятого ответа в зачётке не осталась');
});

// --- швы с панелью -----------------------------------------------------------
//
// Панель писалась отдельно от `index.js` по общему контракту, и проверяется тем
// же способом, каким на этапе 1 нашлись все три разъехавшихся шва: вызовом.

test('таблица предметов: панель шлёт только списки, расписание собирает index.js', async () => {
  const tavern = await withSemester();
  const res = await tavern.seam.host.actions.setSubjects({
    subjects: [
      { id: 'potions', name: 'зельеварение', teacherId: 'snape' },
      { id: 'charms', name: 'заклинания', teacherId: null },
    ],
    teachers: [{ id: 'snape', name: 'Северус Снейп', traits: ['злопамятен'] }],
  });

  assert.equal(res.ok, true, 'действие обязано отвечать панели формой {ok}');
  const state = stateOf(tavern);
  assert.equal(state.subjects.length, 2);
  assert.ok(Object.keys(state.schedule).length > 0, 'расписание пересобрано, а не осталось от старых предметов');

  const { validateState } = await import('../core/state.mjs');
  const check = validateState(state, preset);
  assert.equal(check.ok, true, `состояние обязано остаться целым: ${check.errors.join('; ')}`);
});

test('поля API сохраняются молча: перерисовка не гасит результат проверки связи', async () => {
  // Дефект был здесь: `setSettings` всегда заканчивался `refreshPanel`, а панель
  // строит вкладку заново — вместе с узлом, в который «Проверить связь» пишет
  // ответ. Флаг `quiet` есть ровно у полей, не меняющих ни один другой экран.
  const tavern = await withSemester();
  const panel = watchPanel(tavern.seam);

  tavern.seam.host.setSettings({
    api: { endpoint: 'https://api.example.com', key: 'secret', model: 'tiny' },
  }, { quiet: true });
  assert.equal(panel.renders, 0, 'перерисовка отцепила бы от дерева узел статуса');

  const storage = await import('../storage.js');
  const saved = storage.apiSettings(tavern);
  assert.equal(saved.endpoint, 'https://api.example.com', 'молча — не значит «мимо настроек»');
  assert.equal(saved.model, 'tiny');

  // Умолчание прежнее: всё остальное панель перерисовывает, как и раньше.
  tavern.seam.host.setSettings({ debug: true });
  assert.ok(panel.renders >= 1, 'обычное сохранение обязано перерисовывать панель');
});

test('актуальный API: профили таверны доезжают до панели, а проверка связи — до подключения', async () => {
  // Шов графы «актуальный API» целиком: `index.js` читает профили ровно там,
  // где их держит таверна, и «Проверить связь» ходит тем же путём, каким потом
  // пойдёт генерация, — через подключение, а не на вписанный адрес.
  const tavern = await withSemester({
    connectionManager: {
      selectedProfile: 'p-1',
      profiles: [{ id: 'p-1', name: 'Дешёвый', model: 'mini', api: 'openai', mode: 'cc' }],
    },
  });
  let asked = null;
  tavern.generateRaw = async (req) => { asked = req; return 'pong'; };

  const conn = tavern.seam.host.getConnections();
  assert.equal(conn.available, true);
  assert.equal(conn.selected, 'p-1');
  assert.deepEqual(conn.profiles, [{ id: 'p-1', name: 'Дешёвый', model: 'mini' }]);

  tavern.seam.host.setSettings({
    api: { source: 'tavern', endpoint: 'https://не-туда.example', key: 'sk-1', model: 'm' },
  }, { quiet: true });
  globalThis.fetch = async () => { throw new Error('на свой адрес ходить не должны'); };

  const res = await tavern.seam.host.actions.testApi();
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(asked, 'запрос не дошёл до подключения таверны');
  assert.match(res.message, /подключение таверны/i);

  // Списка моделей у подключения таверны нет — панель узнаёт об этом по коду.
  const models = await tavern.seam.host.actions.listModels();
  assert.equal(models.ok, false);
  assert.equal(models.code, 'tavern-no-models');
});

test('сборка без менеджера подключений: графа остаётся, список профилей пуст', async () => {
  const tavern = await withSemester();
  const conn = tavern.seam.host.getConnections();
  assert.deepEqual(conn.profiles, []);
  assert.equal(conn.service, false);
  assert.equal(conn.selected, '');
});

test('ручной сдвиг: словарь панели переводится в словарь ядра', async () => {
  const tavern = await withSemester();
  const day = stateOf(tavern).calendar.day;

  const forward = await tavern.seam.host.actions.manualTime({ shift: { days: 1 } });
  assert.equal(forward.ok, true);
  assert.notEqual(stateOf(tavern).calendar.day, day);

  // Назад календарь двигает только человек, и только отсюда (3.2).
  const back = await tavern.seam.host.actions.manualTime({ shift: { days: -1 } });
  assert.equal(back.ok, true);
  assert.equal(stateOf(tavern).calendar.day, day);
  assert.equal(stateOf(tavern).calendar.source, 'manual');
});

test('отказ действия приходит панели текстом, а не исключением', async () => {
  const tavern = await withSemester();
  const res = await tavern.seam.host.actions.manualTime({ day: 'не дата' });
  assert.equal(res.ok, false);
  assert.equal(typeof res.error, 'string');
  assert.ok(res.error.length > 0, 'панели нужен текст, который можно показать');
});

// --- лорбук (3.7) ------------------------------------------------------------
//
// Проверяется не «что должно лежать в лорбуке» (это ядро и `core/lorebook.mjs`),
// а поведение слоя: ходит ли расширение в World Info, когда галочка выключена,
// куда девается привязка к чату, и что происходит с записью, которую тронули
// руками.

test('лорбук: галочка выключена — ни одного обращения к World Info', async () => {
  const tavern = await withSemester({}, { worldInfo: true });

  const id = say(tavern, `Пара прошла. ${marker('t=+1 grade=chemistry:5')}`);
  await tavern.eventSource.emit('message_received', id);
  await tavern.eventSource.emit('chat_id_changed', 'chat-1');

  assert.equal(tavern.wi.calls, 0, 'выключенная галочка означает, что в World Info не ходят вовсе');
  assert.equal(tavern.chatMetadata.world_info, undefined, 'и чат ни к чему не привязан');
});

test('лорбук: записи созданы и привязаны к чату, а не к глобальному World Info', async () => {
  const tavern = await withSemester(LOREBOOK_ON, { worldInfo: true });

  const id = say(tavern, `Пара прошла. ${marker('t=+1')}`);
  await tavern.eventSource.emit('message_received', id);

  const name = tavern.chatMetadata.world_info;
  assert.equal(typeof name, 'string');
  assert.ok(name.startsWith('Академия — '), `лорбук чата, а не глобальный: ${name}`);

  const entries = bookEntries(tavern);
  const uids = entries.map((e) => e.academy.uid);
  assert.ok(uids.includes('academy:charter'), 'устав — постоянная запись, она обязана появиться первой');
  assert.ok(uids.includes('academy:teacher:petrova'), 'преподаватели — половина смысла лорбука');
  assert.equal(entries.length, 1 + TEACHERS.length);

  const charter = entries.find((e) => e.academy.uid === 'academy:charter');
  assert.equal(charter.constant, true, 'устав постоянно активен (3.7)');
  const petrova = entries.find((e) => e.academy.uid === 'academy:teacher:petrova');
  assert.ok(petrova.key.includes('Петрова'), 'ключ — имя и фамилия, каждая часть отдельно');
  assert.ok(petrova.content.includes('злопамятна'), 'характер преподавателя — то, ради чего запись заведена');
  assert.ok(petrova.comment.length > 0, 'заголовок записи не пуст: иначе таверна заполнит его сама');
});

test('лорбук: повторный прогон без изменений ничего не пишет и не сохраняет', async () => {
  const tavern = await withSemester(LOREBOOK_ON, { worldInfo: true });
  const first = say(tavern, `Пара прошла. ${marker('t=+1')}`);
  await tavern.eventSource.emit('message_received', first);

  const after = { calls: tavern.wi.calls, saves: tavern.wi.saves };
  assert.ok(after.saves > 0, 'первый прогон обязан записать');

  const quiet = say(tavern, 'Она молча шла по коридору.');
  await tavern.eventSource.emit('message_received', quiet);

  assert.equal(tavern.wi.saves, after.saves, 'нечего писать — нечего сохранять');
  assert.equal(tavern.wi.calls, after.calls, 'и читать файл лорбука тоже незачем');
});

test('лорбук: правленую руками запись расширение больше не трогает', async () => {
  const tavern = await withSemester(LOREBOOK_ON, { worldInfo: true });
  const id = say(tavern, `Пара прошла. ${marker('t=+1')}`);
  await tavern.eventSource.emit('message_received', id);

  const mine = 'Это я переписала сама, и трогать это нельзя.';
  const petrova = bookEntries(tavern).find((e) => e.academy.uid === 'academy:teacher:petrova');
  petrova.content = mine;

  // Правка таблицы меняет текст записи у обоих преподавателей — значит ядро
  // предложит обновить обе. Пройти должна ровно одна.
  await tavern.seam.host.actions.setSubjects({
    subjects: SUBJECTS,
    teachers: TEACHERS.map((t) => (
      t.id === 'petrova' || t.id === 'ivanov' ? { ...t, traits: ['стала другой'] } : t
    )),
  });

  const now = bookEntries(tavern);
  assert.equal(
    now.find((e) => e.academy.uid === 'academy:teacher:petrova').content, mine,
    'запись, тронутая руками, не переписывается (3.7)',
  );
  assert.ok(
    now.find((e) => e.academy.uid === 'academy:teacher:ivanov').content.includes('стала другой'),
    'а нетронутая — обновляется, иначе правило бессмысленно',
  );
});

test('детали наставника с вкладки «Люди»: нормализуются, ложатся в лорбук, правку руками не трогают', async () => {
  const tavern = await withSemester(LOREBOOK_ON, { worldInfo: true });
  const id = say(tavern, `Пара прошла. ${marker('t=+1')}`);
  await tavern.eventSource.emit('message_received', id);
  const act = tavern.seam.host.actions;
  const teacher = (tid) => stateOf(tavern).teachers.find((t) => t.id === tid);
  const entry = (tid) => bookEntries(tavern).find((e) => e.academy.uid === `academy:teacher:${tid}`);

  const res = await act.setTeacherDetails('petrova', {
    post: '  заведующая   кафедрой ',
    likes: 'белое вино и дорогие картины.',
    secret: 'влюблена в декана '.repeat(20),
    traits: 'злопамятна, , любит порядок ',
  });
  assert.equal(res.ok, true);
  const p = teacher('petrova');
  assert.equal(p.post, 'заведующая кафедрой', 'пробелы схлопнуты');
  assert.equal(p.secret.length, 160, 'тайна обрезана тем же потолком, что держит состояние');
  assert.deepEqual(p.traits, ['злопамятна', 'любит порядок'], 'черты — через запятую, пустые выброшены');
  assert.equal((await import('../core/state.mjs')).validateState(stateOf(tavern), preset).ok, true);

  // Лорбук пересобран тем же действием: должность, «любит» и тайна — в записи.
  const text = entry('petrova').content;
  assert.match(text, /Должность: заведующая кафедрой\./);
  assert.match(text, /Любит: белое вино и дорогие картины\./, 'точка из анкеты не удваивается');
  assert.match(text, /Тайна \(героиня не знает; проявлять только намёками, прямо не раскрывать\): влюблена/);
  assert.doesNotMatch(text, /\.\./);

  // Пустое — убрать ключ; ключа нет в правке — не трогать.
  await act.setTeacherDetails('petrova', { secret: '' });
  assert.equal('secret' in teacher('petrova'), false);
  assert.equal(teacher('petrova').post, 'заведующая кафедрой');
  assert.doesNotMatch(entry('petrova').content, /Тайна/);

  // Запись, тронутая руками, переживает и эту правку (3.7).
  const mine = 'Петрову я описала сама.';
  entry('petrova').content = mine;
  await act.setTeacherDetails('petrova', { likes: 'тишина' });
  assert.equal(teacher('petrova').likes, 'тишина', 'состояние правится');
  assert.equal(entry('petrova').content, mine, 'а правленая руками запись — нет');

  const missing = await act.setTeacherDetails('nobody', { post: 'директор' });
  assert.equal(missing.ok, false);
});

test('лорбук: предложение про NPC само в лорбук не попадает', async () => {
  const tavern = await withSemester(LOREBOOK_ON, { worldInfo: true });
  const id = say(tavern, `Пара прошла. ${marker('t=+1')}`);
  await tavern.eventSource.emit('message_received', id);
  const before = bookEntries(tavern).length;

  await tavern.seam.host.actions.suggestLorebookEntry({ name: 'Маша Лебедева', note: 'соседка по комнате' });

  const view = tavern.seam.host.getLorebook();
  assert.equal(view.suggest.length, 1, 'предложение обязано дойти до панели');
  assert.equal(bookEntries(tavern).length, before, 'но в лорбук само не уйти — только предложить (3.7)');

  // Решение человека — единственный путь предложения в лорбук.
  const res = await tavern.seam.host.actions.acceptLorebookSuggestion(view.suggest[0].uid);
  assert.equal(res.ok, true);
  const added = bookEntries(tavern).find((e) => e.academy.uid === view.suggest[0].uid);
  assert.ok(added, 'принятое предложение обязано появиться в лорбуке');
  assert.equal(added.academy.origin, 'suggested', 'и остаться помеченным как принятое, а не сочинённое');
  assert.equal(tavern.seam.host.getLorebook().suggest.length, 0, 'принятое больше не предлагается');
});

test('лорбук: старая таверна без World Info не роняет расширение', async () => {
  const tavern = await withSemester(LOREBOOK_ON); // без loadWorldInfo/saveWorldInfo

  const id = say(tavern, `Пара прошла. ${marker('t=+1 grade=chemistry:5')}`);
  await tavern.eventSource.emit('message_received', id);

  assert.equal(stateOf(tavern).subjects.find((s) => s.id === 'chemistry').grades.length, 1,
    'зачётка обязана работать и без лорбука');
  const view = tavern.seam.host.getLorebook();
  assert.equal(view.enabled, true);
  assert.equal(view.reason, 'no-world-info', 'панель должна уметь объяснить, почему лорбука нет');
  assert.equal(view.error, null, 'это не авария, а отсутствие возможности');
});

test('лорбук: свайп не стирает записанное, но осиротевшее видно и сносится руками', async () => {
  // День входа в сессию: исход контрольного — значимое событие, под него ядро
  // заводит запись хроники (3.7, :471).
  const tavern = await withSemester(LOREBOOK_ON, { worldInfo: true, day: '2024-12-22' });
  const id = say(tavern, `Утро экзаменационного дня. ${marker('t=+1 day')}`);
  // Бросок зажат снизу: с вехами (9.4.2) удачный исход — первая пятёрка или
  // блестящая сдача — заводит в хронику вторую запись, и на `Math.random`
  // тест краснел бы через раз. Здесь проверяется судьба записи при свайпе, а
  // не то, сколько вех выпало.
  await withRoll(tavern, 0, () => tavern.eventSource.emit('message_received', id));

  const chronicle = bookEntries(tavern).filter((e) => e.academy.uid.startsWith('academy:chronicle:'));
  assert.equal(chronicle.length, 1, 'сданное контрольное обязано попасть в хронику');

  // Свайп на текст, который никуда не двигает время: состояние откатывается к
  // «до экзамена», и запись хроники становится осиротевшей.
  tavern.chat[id].mes = 'Она передумала и осталась в коридоре.';
  await tavern.eventSource.emit('message_swiped', id);
  await tavern.eventSource.emit('message_received', id);

  assert.equal(
    bookEntries(tavern).filter((e) => e.academy.uid.startsWith('academy:chronicle:')).length, 1,
    'молча стирать записи расширение не будет — 3.7 отдаёт удаление человеку',
  );
  const view = tavern.seam.host.getLorebook();
  assert.equal(view.orphans.length, 1, 'но осиротевшую запись видно, и панель может её показать');

  const res = await tavern.seam.host.actions.pruneLorebook();
  assert.equal(res.removed, 1, 'кнопка убирает её — по решению человека, а не сама');
  assert.equal(bookEntries(tavern).filter((e) => e.academy.uid.startsWith('academy:chronicle:')).length, 0);
});

test('семестр заводится анкетой и сразу начинает инжектить', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  assert.equal(tavern.prompts.academy_status.value, '');

  const res = await seam.host.actions.startTerm({
    era: 'современность', country: 'Россия', institution: 'вуз',
    faculty: 'химфак', year: '2', lang: 'ru',
  });
  assert.equal(res.ok, true);
  assert.equal(stateOf(tavern).started, true);
  assert.equal(stateOf(tavern).survey.faculty, 'химфак');
  assert.ok(tavern.flushes > 0, 'начало семестра сохраняется немедленно, а не отложенно');
});

test('начало семестра не выбрасывает набранную до него таблицу', async () => {
  // Поймано глазами на живой таверне 1.18.0, модульными тестами не видно:
  // `startTerm` собирал состояние с пустыми списками, и кнопка «начать
  // семестр» стирала всё, что человек вписал в таблицу минуту назад. Панель
  // при этом честно пускала стартовать — предметы она видела.
  const tavern = fakeTavern();
  const seam = await boot(tavern);

  await seam.host.actions.setSubjects({
    subjects: [
      { id: 'analytics', name: 'аналитическая химия', teacherId: 'petrova' },
      { id: 'physics', name: 'физика', teacherId: null },
    ],
    teachers: [{ id: 'petrova', name: 'Петрова Ирина Львовна', traits: ['злопамятна'] }],
  });

  const res = await seam.host.actions.startTerm({
    era: 'современность', country: 'Россия', institution: 'вуз',
    faculty: 'химико-технологический', year: '2-й', lang: 'ru',
  });
  assert.equal(res.ok, true);

  const state = stateOf(tavern);
  assert.equal(state.started, true);
  assert.deepEqual(state.subjects.map((s) => s.id), ['analytics', 'physics'],
    'предметы обязаны пережить старт семестра');
  assert.equal(state.teachers.length, 1, 'и преподаватели вместе с ними');
  assert.ok(Object.keys(state.schedule).length > 0,
    'расписание непустое — иначе «Сегодня» скажет «на сегодня расписание пустое»');
});

/* ========================================================================== *
 *  Этап 3: швы, выведенные в интерфейс.
 *
 *  Всё ниже проверяется исполнением через настоящий \`index.js\`, а не чтением:
 *  функции выгрузки, автоанкеты и лорбука были написаны и покрыты модульными
 *  тестами порознь, но ни одна из них не была подключена к панели — а этап 2
 *  ровно это и записал главным уроком: из четырёх заранее объявленных швов
 *  разъехались три, и ни одного не увидел ни один модульный тест.
 * ========================================================================== */

// --- выгрузка и загрузка состояния (3.8) -------------------------------------

test('выгрузка отдаёт готовый файл: текст, имя и версию из манифеста', async () => {
  const tavern = await withSemester();
  tavern.extensionSettings.academy.api = { endpoint: 'https://api.example.com', key: 'sk-секрет', model: 'gpt' };

  const res = await tavern.seam.host.actions.exportState();
  assert.equal(res.ok, true);
  assert.match(res.filename, /^academy-ru-university-\d{4}-\d{2}-\d{2}\.json$/);

  const data = JSON.parse(res.json);
  assert.equal(data.format, 'academy-state');
  assert.equal(data.presetId, 'ru-university');
  assert.equal(data.state.subjects.length, SUBJECTS.length);
  // Версия — из манифеста, а не из константы-копии в \`storage.js\`: копия
  // разъедется на первом же выпуске, и молча.
  assert.equal(data.extensionVersion, manifest.version);
  // Ключ API не уезжает в файл ни при каких условиях (поправка 6 этапа 2).
  assert.equal(res.json.includes('sk-секрет'), false, 'ключ в выгрузке — это ключ в чужих руках');
});

test('выгружать нечего — панель получает текст, а не пустой файл', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  const res = await seam.host.actions.exportState();
  assert.equal(res.ok, false);
  assert.equal(res.code, 'empty');
  assert.ok(res.error.length > 0, 'панели нужен текст, который можно показать рядом с кнопкой');
});

test('загрузка требует подтверждения, а со вторым вызовом заменяет семестр', async () => {
  // Файл: другой семестр, собранный тем же пресетом, но с другим днём и другими
  // предметами — чтобы «заменилось» было видно, а не совпало само собой.
  const donor = await withSemester({}, { day: '2024-10-14' });
  donor.chatMetadata.academy.subjects = donor.chatMetadata.academy.subjects.slice(0, 2);
  donor.chatMetadata.academy.schedule = { 1: ['chemistry'], 2: ['physics'], 3: [], 4: [], 5: [], 6: [], 7: [] };
  const file = (await donor.seam.host.actions.exportState()).json;

  const tavern = await withSemester();
  const panel = watchPanel(tavern.seam);
  const before = stateOf(tavern).calendar.day;

  const asked = await tavern.seam.host.actions.importState(file);
  assert.equal(asked.ok, false, 'молча затирать идущий семестр нельзя');
  assert.equal(asked.needsConfirm, true);
  assert.ok(asked.reasons.length > 0, 'человеку говорят, что именно он потеряет');
  // Обе сводки приходят ДО записи — ради этого разбор и запись разведены.
  assert.equal(asked.current.day, before);
  assert.equal(asked.incoming.day, '2024-10-14');
  assert.equal(asked.current.subjects, SUBJECTS.length);
  assert.equal(asked.incoming.subjects, 2);
  assert.equal(stateOf(tavern).calendar.day, before, 'первый вызов не тронул ничего');
  assert.equal(panel.renders, 0, 'и панель перерисовывать было незачем');

  const done = await tavern.seam.host.actions.importState(file, { confirm: true });
  assert.equal(done.ok, true);
  assert.equal(done.replaced, true);
  assert.equal(stateOf(tavern).calendar.day, '2024-10-14');
  assert.equal(stateOf(tavern).subjects.length, 2);
  assert.ok(tavern.flushes > 0, 'загрузка сохраняется немедленно, как и начало семестра');
  assert.ok(panel.renders > 0, 'панель показывает уже заменённый семестр');
  // Живое состояние вкладки тоже заменено, а не осталось от прошлого семестра.
  assert.equal(tavern.seam.host.getState().calendar.day, '2024-10-14');
});

test('в пустой чат состояние грузится без единого вопроса', async () => {
  const donor = await withSemester();
  const file = (await donor.seam.host.actions.exportState()).json;

  const tavern = fakeTavern();
  const seam = await boot(tavern);
  const res = await seam.host.actions.importState(file);
  assert.equal(res.ok, true, 'терять нечего — и спрашивать не о чем');
  assert.equal(res.replaced, false);
  assert.equal(stateOf(tavern).subjects.length, SUBJECTS.length);
  // И расширение сразу заговорило: инжект собран по приехавшему состоянию.
  assert.ok(tavern.prompts.academy_status.value.length > 0);
});

test('чужой файл — отказ с объяснением, а не «ошибка импорта»', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  for (const [source, code] of [['не json вовсе', 'not-json'], ['{"format":"chatlog"}', 'foreign']]) {
    const res = await seam.host.actions.importState(source);
    assert.equal(res.ok, false, source);
    assert.equal(res.code, code, source);
    assert.ok(res.error.length > 0, source);
  }
  assert.equal(tavern.chatMetadata.academy, undefined, 'ни одна неудача ничего не записала');
});

test('настоящее японское состояние под русским пресетом: предупреждение, а не отказ', async () => {
  // Проверка, которую обещал автор выгрузки: он ждал, что японский триместр с
  // его шкалой не пройдёт \`validateState\` под русским пресетом и даст жёсткий
  // \`invalid\`. Прогон говорит обратное — и это правильно: \`validateState\`
  // проверяет целостность состояния, а не совместимость со шкалой, а предметы,
  // преподаватели и оценки лежат внутри состояния и от пресета не зависят.
  // Состояние здесь настоящее — прожитое японским ядром до второго триместра, —
  // а не русское с подменённым \`presetId\`: подмена проверяла бы одну строчку.
  const jp = loadPresetFile('jp-highschool');
  const { createState } = await import('../core/state.mjs');
  const { buildSchedule } = await import('../core/schedule.mjs');
  const { applyResponse } = await import('../core/engine.mjs');

  let s = createState(jp, {
    startDay: '2026-04-08', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, jp),
  });
  s.started = true;
  const liveTo = (day) => {
    let left = Math.round((Date.parse(day) - Date.parse(s.calendar.day)) / 86400000);
    while (left > 0) {
      const step = Math.min(left, 28);
      s = applyResponse(s, 'День шёл своим чередом.\n' + marker('t=+' + step + ' day'), jp, { mode: 'marker' }).state;
      left -= step;
    }
  };
  liveTo('2026-07-13');
  s = applyResponse(s, 'Урок кончился. ' + marker('grade=chemistry:5'), jp, { mode: 'marker' }).state;
  liveTo('2026-12-14');
  assert.equal(s.exams.term, 1, 'состояние настоящее: второй триместр со своей сессией');

  // Выгружаем японским пресетом, грузим русским — панель русская.
  const donor = fakeTavern();
  donor.chatMetadata.academy = s;
  donor.extensionSettings.academy = { preset: 'jp-highschool' };
  const donorSeam = await boot(donor);
  assert.equal(donorSeam.host.getPreset().id, 'jp-highschool', 'пресет берётся из настроек при запуске');
  const file = (await donorSeam.host.actions.exportState()).json;

  const tavern = fakeTavern();
  const seam = await boot(tavern);
  const asked = await seam.host.actions.importState(file);
  assert.equal(asked.ok, false, 'чужой пресет — повод спросить');
  assert.equal(asked.needsConfirm, true, 'но именно спросить, а не отказать');
  assert.notEqual(asked.code, 'invalid', 'жёсткого отказа тут быть не должно');
  assert.ok(asked.reasons.some((r) => r.includes('Японская старшая школа') && r.includes('Российский вуз')),
    'предупреждение называет оба пресета');

  const done = await seam.host.actions.importState(file, { confirm: true });
  assert.equal(done.ok, true);
  const state = stateOf(tavern);
  assert.equal(state.exams.term, 1, 'триместровая сессия приехала как есть');
  assert.equal(state.subjects.find((x) => x.id === 'chemistry').grades.length, 1);

  // И последствие, ради которого предупреждение вообще написано: оценки и
  // предметы целы, а год под русским пресетом стал одним периодом.
  const { todayView } = await import('../ui.js');
  assert.equal(todayView(state, seam.host.getPreset()).termsCount, 1,
    'триместров у русского вуза нет — ровно то, о чём предупреждение и говорит');
});

// --- автозаполнение анкеты (3.6) ---------------------------------------------

/** Карточка персонажа и подключение таверны — запасной путь \`generateRaw\` (3.6). */
function withCharacter(tavern, answer) {
  tavern.name2 = 'Хината';
  tavern.characterId = 0;
  tavern.characters = [{
    name: 'Хината',
    description: 'Второй год старшей школы в маленьком приморском городе, наши дни.',
    personality: 'застенчива',
    scenario: '',
    first_mes: 'Звонок на первый урок уже прозвенел.',
  }];
  tavern.generateRaw = async (req) => { tavern.lastPrompt = req; return answer; };
  return tavern;
}

test('автоанкета кладёт поля в анкету и не пишет состояние', async () => {
  const tavern = fakeTavern();
  withCharacter(tavern, '{"era":"наши дни","country":"Япония","institution":"старшая школа","faculty":"общий класс","year":"2"}');
  const seam = await boot(tavern);

  const res = await seam.host.actions.guessSurvey();
  assert.equal(res.ok, true);
  assert.equal(res.survey.country, 'Япония');
  assert.equal(res.survey.institution, 'старшая школа');
  assert.equal(res.survey.lang, 'ru', 'язык дописан из пресета');
  assert.ok(res.filled.includes('era') && res.filled.includes('country'));
  // Главное свойство действия: предположение — это предположение.
  assert.equal(tavern.chatMetadata.academy, undefined, 'состояние не записано ни на байт');
  assert.equal(tavern.saves, 0);
  assert.equal(tavern.flushes, 0);
  // И промпт собран по карточке, а не по пустому месту.
  assert.match(tavern.lastPrompt.prompt, /Хината/);
  assert.match(tavern.lastPrompt.prompt, /приморском/);
});

test('автоанкета: незаполненные поля — не ошибка', async () => {
  const tavern = fakeTavern();
  withCharacter(tavern, '{"era":"наши дни","country":"","institution":"школа","faculty":"","year":""}');
  const seam = await boot(tavern);

  const res = await seam.host.actions.guessSurvey();
  assert.equal(res.ok, true, 'половина полей — это половина полей, а не сбой');
  assert.deepEqual(res.filled, ['era', 'institution']);
  assert.ok(res.errors.includes('no-country'), 'но панель знает, чего не хватает');
});

test('автоанкета без персонажа отказывает текстом', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  const res = await seam.host.actions.guessSurvey();
  assert.equal(res.ok, false);
  assert.ok(res.error.length > 0, 'пустой экран здесь хуже всего');
  assert.equal(tavern.chatMetadata.academy, undefined);
});

// --- лорбук: галочка и путь предложения (3.7) --------------------------------

test('галочка лорбука включается из панели, и лорбук заводится сразу', async () => {
  const tavern = await withSemester({}, { worldInfo: true });
  assert.equal(tavern.seam.host.getSettings().lorebook.enabled, false,
    'по умолчанию выключено — требование плана 3.7, а не вкус');
  assert.equal(tavern.wi.calls, 0);

  // Ровно то, что делает галочка в панели.
  tavern.seam.host.setSettings({ lorebook: { enabled: true } });
  // \`setSettings\` синхронный, а поход в World Info — нет: он идёт отдельным
  // обещанием, и без ожидания прогон проверял бы момент до записи.
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(tavern.seam.host.getSettings().lorebook.enabled, true);
  const view = tavern.seam.host.getLorebook();
  assert.equal(view.enabled, true);
  assert.ok(view.name.startsWith('Академия — '), 'лорбук завёлся и назван: ' + view.name);
  assert.ok(bookEntries(tavern).length > 0, 'записи появились от самой галочки, а не после экзамена');
  assert.ok(view.measure && Number.isFinite(view.measure.tokens), 'замер есть, панели есть что показать');
  assert.equal(view.measure.withinCap, true);

  // И обратно: выключенная галочка перестаёт показывать отчёт от прошлого раза.
  tavern.seam.host.setSettings({ lorebook: { enabled: false } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(tavern.seam.host.getLorebook().enabled, false);
  assert.equal(tavern.seam.host.getLorebook().name, '');
});

test('умолчания лорбука живут в storage, а не своей копией в lorebook.js', async () => {
  // Блок переехал в \`storage.DEFAULT_SETTINGS\`, и переехал целиком: две правды
  // об \`enabled: false\` — это то самое умолчание, которое однажды разъедется.
  const storage = await import('../storage.js');
  const lorebook = await import('../lorebook.js');
  assert.deepEqual(storage.DEFAULT_SETTINGS.lorebook, { enabled: false, book: '' });
  assert.equal(lorebook.DEFAULT_LOREBOOK_SETTINGS, storage.DEFAULT_SETTINGS.lorebook);

  const tavern = fakeTavern();
  await boot(tavern);
  assert.deepEqual(tavern.extensionSettings.academy.lorebook, { enabled: false, book: '' },
    'умолчание долилось в живые настройки таверны');
});

// --- выбор пресета -----------------------------------------------------------

test('пресет виден списком, выбирается и перерисовывает панель целиком', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  const panel = watchPanel(seam);

  const list = seam.host.getPresets();
  assert.equal(list.active, 'ru-university');
  assert.deepEqual(list.list.map((p) => p.id), BUILTIN_PRESETS);
  // Имена — из самих пресетов, а не из кода: слова заведения в код не едут.
  assert.equal(list.list.find((p) => p.id === 'jp-highschool').name,
    loadPresetFile('jp-highschool').displayName);

  const res = await seam.host.actions.setPreset('magic-academy');
  assert.equal(res.ok, true);
  assert.equal(seam.host.getPreset().id, 'magic-academy');
  assert.equal(tavern.extensionSettings.academy.preset, 'magic-academy', 'выбор переживёт перезагрузку страницы');
  assert.ok(panel.renders > 0, 'панель перерисована: ярлыки вкладок и слова стали другими');

  // Ярлыки вкладок действительно поехали — иначе перерисовка ничего не значит.
  const { tabsFor } = await import('../ui.js');
  const before = tabsFor(loadPresetFile('ru-university')).map((t) => t.label);
  const after = tabsFor(seam.host.getPreset()).map((t) => t.label);
  assert.notDeepEqual(before, after);
});

test('смена пресета на идущем семестре спрашивает, а второй раз — делает', async () => {
  const tavern = await withSemester();
  const panel = watchPanel(tavern.seam);

  const asked = await tavern.seam.host.actions.setPreset('magic-academy');
  assert.equal(asked.ok, false, 'слова, шкала оценок и виды контрольных поменяются под живым состоянием');
  assert.equal(asked.needsConfirm, true);
  assert.equal(asked.question.title, 'Сменить пресет на «Магическая академия»?');
  assert.equal(tavern.seam.host.getPreset().id, 'ru-university', 'первый вызов не сменил ничего');
  assert.equal(panel.renders, 0);

  const done = await tavern.seam.host.actions.setPreset('magic-academy', { confirm: true });
  assert.equal(done.ok, true);
  assert.equal(tavern.seam.host.getPreset().id, 'magic-academy');
  // Состояние и пресет перестают врать друг другу: иначе выгрузка унесла бы
  // чужой \`presetId\`, и обратная загрузка ругалась бы на несовпадение, которого нет.
  assert.equal(stateOf(tavern).presetId, 'magic-academy');
  const back = await tavern.seam.host.actions.exportState();
  assert.equal(JSON.parse(back.json).presetId, 'magic-academy');
  // Семестр целиком пережил смену: предметы, преподаватели и оценки лежат в
  // состоянии и от пресета не зависят.
  assert.equal(stateOf(tavern).subjects.length, SUBJECTS.length);
  assert.ok(panel.renders > 0);
});

test('несуществующий пресет — отказ текстом, старый остаётся жить', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  const res = await seam.host.actions.setPreset('hogwarts');
  assert.equal(res.ok, false);
  assert.ok(res.error.length > 0);
  assert.equal(seam.host.getPreset().id, 'ru-university');
});

test('выбранный пресет поднимается при запуске, а исчезнувший не роняет панель', async () => {
  const tavern = fakeTavern();
  tavern.extensionSettings.academy = { preset: 'magic-academy' };
  const seam = await boot(tavern);
  assert.equal(seam.host.getPreset().id, 'magic-academy');

  const broken = fakeTavern();
  broken.extensionSettings.academy = { preset: 'hogwarts' };
  const seam2 = await boot(broken);
  assert.equal(seam2.host.getPreset().id, 'ru-university', 'пропавший пресет — не повод остаться без панели');
  assert.equal(broken.extensionSettings.academy.preset, 'ru-university', 'и выбор чинится, а не спрашивается снова');
});

// --- панель поверх всего этого -----------------------------------------------

test('вид настроек собирает лорбук и пресеты из хоста, а без них не падает', async () => {
  const tavern = await withSemester(LOREBOOK_ON, { worldInfo: true });
  const id = say(tavern, 'Пара прошла. ' + marker('t=+1'));
  await tavern.eventSource.emit('message_received', id);

  const { settingsView } = await import('../ui.js');
  const host = tavern.seam.host;
  const view = settingsView(host.getState(), host.getSettings(), host.getPreset(), {
    lorebook: host.getLorebook(), presets: host.getPresets(),
  });

  assert.equal(view.lorebook.enabled, true);
  assert.ok(view.lorebook.boundLine.includes(host.getLorebook().name), 'панель называет лорбук и чат');
  assert.match(view.lorebook.measureLine, /примерно/, 'замер подан прикидкой, а не точным числом');
  assert.equal(view.lorebook.explain, '', 'объяснять нечего: лорбук на месте');
  assert.equal(view.presets.list.length, BUILTIN_PRESETS.length);
  assert.equal(view.presets.drift, '', 'состояние и пресет сходятся');

  // Вызов без четвёртого аргумента — так зовут старые тесты и \`commands.js\`.
  // Галочка — из самих настроек, а не из отчёта лорбука: без отчёта она всё
  // равно стоит, как её поставили (иначе «Лорбук выключен.» висел под ней).
  const bare = settingsView(host.getState(), host.getSettings(), host.getPreset());
  assert.equal(bare.lorebook.enabled, true);
  assert.equal(bare.presets.list.length, 1, 'без списка от хоста виден только активный');
});

test('лорбука нет — панель говорит почему, а не показывает пустой экран', async () => {
  // Старая сборка без World Info: галочка стоит, лорбука не будет.
  const tavern = await withSemester(LOREBOOK_ON);
  const id = say(tavern, 'Пара прошла. ' + marker('t=+1'));
  await tavern.eventSource.emit('message_received', id);

  const { settingsView } = await import('../ui.js');
  const host = tavern.seam.host;
  const view = settingsView(host.getState(), host.getSettings(), host.getPreset(), {
    lorebook: host.getLorebook(), presets: host.getPresets(),
  });
  assert.equal(view.lorebook.enabled, true);
  assert.ok(view.lorebook.explain.length > 0, 'пустой экран здесь хуже всего');
  assert.match(view.lorebook.explain, /World Info/);
});

test('расхождение состояния и пресета названо вслух', async () => {
  const tavern = await withSemester();
  // Состояние русское, пресет магический — так бывает, если пресет сменили в
  // другом чате: настройка общая, а состояние у каждого чата своё.
  tavern.extensionSettings.academy.preset = 'magic-academy';
  const seam = await boot(tavern);

  const { settingsView } = await import('../ui.js');
  const view = settingsView(seam.host.getState(), seam.host.getSettings(), seam.host.getPreset(), {
    presets: seam.host.getPresets(),
  });
  assert.ok(view.presets.drift.includes('Российский вуз') && view.presets.drift.includes('Магическая академия'),
    'молча это не расходится ни в одной проверке, а средний балл на экране перестаёт считаться');
});

// --- середина периода в живом расширении -------------------------------------

test('середина периода: расширение сажает за контрольное посреди учебных недель', async () => {
  // Ворота дня в `index.js` раньше спрашивали фазу `exams` и флаг сессии.
  // Событие вида со своей неделей (`atWeek`) приходится на учебную неделю, где
  // ни того, ни другого нет, и без правки ворот оно было бы заведено, но
  // несдаваемо: этот прогон проверяет именно ворота, а не ядро.
  const jp = loadPresetFile('jp-highschool');
  const tavern = await withSemester(
    { academy: { preset: 'jp-highschool' } },
    { preset: jp, start: '2024-04-08', day: '2024-05-19' },
  );

  // Воскресенье перед седьмой учебной неделей плюс сутки: контрольные вида
  // заводятся календарём и одно из них сдаётся тем же ответом.
  const id = say(tavern, `Понедельник начался. ${marker('t=+1 day')}`);
  await tavern.eventSource.emit('message_received', id);

  const state = stateOf(tavern);
  assert.equal(state.calendar.day, '2024-05-20');
  assert.equal(state.exams.items.length, SUBJECTS.length, 'середина не заведена по календарю');
  assert.ok(state.exams.items.every((i) => i.kind === 'midterm'));
  assert.equal(state.exams.active, false, 'середина открыла режим сессии');

  const sat = state.exams.items.filter((i) => i.outcome !== null);
  assert.equal(sat.length, 1, 'за середину не сели (или сели больше одного раза)');
  assert.equal(sat[0].day, '2024-05-20');
  // Посчитанный факт ушёл в промпт одноразовым инжектом, как и на сессии.
  assert.ok(tavern.prompts.academy_oneshot.value.length > 0, 'исход не уехал в промпт');

  // И второй ответ того же дня второго контрольного не сажает.
  const second = say(tavern, `День продолжился. ${marker('t=+1')}`);
  await tavern.eventSource.emit('message_received', second);
  assert.equal(
    stateOf(tavern).exams.items.filter((i) => i.outcome !== null && i.day === '2024-05-20').length,
    1,
    'за день сдано больше одного контрольного',
  );
});

test('вопрос о смене пресета: названия пресетов, а не id, и с заглавной после точки', async () => {
  // Живьём это читалось так: «Заменить то, что есть? состояние собрано с
  // пресетом «jp-highschool»…» — id вместо названия и строчная после вопроса.
  const tavern = await withSemester();
  await tavern.seam.host.actions.setPreset('magic-academy', { confirm: true });

  const asked = await tavern.seam.host.actions.setPreset('ru-university');
  assert.equal(asked.needsConfirm, true);
  assert.equal(asked.question.title, 'Сменить пресет на «Российский вуз»?');
  assert.match(asked.question.note, /^Предметы, [^ ]+ и оценки останутся\./);

  assert.equal(/\.\s+\p{Ll}/u.test(asked.error), false,
    `после точки стоит строчная буква: ${asked.error}`);
  assert.equal(/ru-university|magic-academy/.test(asked.error), false, `в вопросе id пресета: ${asked.error}`);
  // Слово людей — из активного пресета, а не из кода.
  const magic = tavern.seam.host.getPreset();
  assert.ok(asked.question.note.includes(magic.vocab.teacherPlural), asked.question.note);
});

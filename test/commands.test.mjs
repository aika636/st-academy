import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Прогон слэш-команд через настоящий `index.js`, тем же приёмом, что
// `integration.test.mjs`: поддельная таверна кладётся в `globalThis` до импорта,
// расширение поднимается само, команды достаются из парсера.
//
// Имена полей у `SlashCommand`, `SlashCommandNamedArgument` и `addCommandObject`
// списаны с исходника 1.18.0 (`slash-commands/SlashCommand.js:44`,
// `SlashCommandArgument.js:97`, `SlashCommandParser.js:65,79`), а не с памяти:
// ошибка в имени дала бы зелёный прогон при мёртвом расширении.

const presetPath = fileURLToPath(new URL('../presets/ru-university.json', import.meta.url));
const preset = JSON.parse(readFileSync(presetPath, 'utf8'));

const TERM_START = '2024-09-02';
const SECRET = 'sk-academy-очень-секретный-ключ-42';

const SUBJECTS = [
  { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'ivanov' },
];

const TEACHERS = [
  { id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['злопамятна'] },
  { id: 'ivanov', name: 'Иванов Пётр Ильич', traits: ['добродушен'] },
];

const marker = (body) => `<!-- [ACADEMY ${body}] -->`;

// --- поддельные слэш-команды -------------------------------------------------

/** `SlashCommand.fromProps` — `Object.assign(new this(), props)` (SlashCommand.js:44). */
class FakeSlashCommand {
  name = '';
  callback = null;
  helpString = '';
  aliases = [];
  returns = '';
  namedArgumentList = [];
  unnamedArgumentList = [];

  static fromProps(props) {
    return Object.assign(new this(), props);
  }
}

/** Позиционный конструктор с `aliasList` восьмым — как в SlashCommandArgument.js:97. */
class FakeNamedArgument {
  constructor(name, description, typeList, isRequired, acceptsMultiple, defaultValue, enumList, aliasList) {
    this.name = name;
    this.description = description;
    this.typeList = Array.isArray(typeList) ? typeList : [typeList];
    this.isRequired = Boolean(isRequired);
    this.acceptsMultiple = Boolean(acceptsMultiple);
    this.defaultValue = defaultValue ?? null;
    this.enumList = enumList ?? [];
    this.aliasList = aliasList ?? [];
  }

  static fromProps(props) {
    return new FakeNamedArgument(
      props.name, props.description, props.typeList ?? ['string'],
      props.isRequired ?? false, props.acceptsMultiple ?? false,
      props.defaultValue ?? null, props.enumList ?? [], props.aliasList ?? [],
    );
  }
}

/**
 * Парсер копит команды и, как настоящий, замечает повтор имени
 * (`addCommandObjectUnsafe`, SlashCommandParser.js:79-81) — только вместо
 * `console.trace` пишет в список, чтобы тест мог на него посмотреть.
 */
function fakeParser() {
  const P = {
    commands: {},
    registered: [],
    duplicates: [],
    addCommandObject(command) {
      for (const start of ['/', '#', ':', 'parser-flag', 'breakpoint']) {
        if (command.name.toLowerCase().startsWith(start)) {
          throw new Error(`Illegal Name. Slash command name cannot begin with "${start}".`);
        }
      }
      const keys = [command.name, ...(command.aliases ?? [])];
      if (keys.some((k) => Object.hasOwn(P.commands, k))) P.duplicates.push(command.name);
      for (const k of keys) P.commands[k] = command;
      P.registered.push(command.name);
    },
  };
  return P;
}

// --- поддельная таверна ------------------------------------------------------

function fakeTavern({ withParser = true } = {}) {
  const listeners = new Map();
  const prompts = {};
  const tavern = {
    chat: [],
    chatMetadata: {},
    extensionSettings: { academy: { api: { endpoint: 'https://x/v1', key: SECRET, model: 'gpt-x' } } },
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
    saveMetadataDebounced() {},
    async saveMetadata() {},
    saveSettingsDebounced() {},
    getCurrentChatId: () => 'chat-1',
  };

  if (withParser) {
    // Имена ровно те, что отдаёт `getContext()` (st-context.js:164-169).
    tavern.SlashCommandParser = fakeParser();
    tavern.SlashCommand = FakeSlashCommand;
    tavern.SlashCommandNamedArgument = FakeNamedArgument;
    tavern.ARGUMENT_TYPE = { STRING: 'string', NUMBER: 'number', BOOLEAN: 'bool' };
  }
  return tavern;
}

function say(tavern, text) {
  tavern.chat.push({ mes: text, is_user: false, is_system: false, swipes: [text], swipe_id: 0 });
  return tavern.chat.length - 1;
}

/**
 * Поднять расширение. Регистрация команд — последнее, что делает `init`, и
 * стоит она за двумя динамическими импортами, поэтому ждём её появления, а не
 * один тик: тик, которого хватило бы сегодня, завтра начал бы врать.
 */
async function boot(tavern) {
  globalThis.SillyTavern = { getContext: () => tavern };
  globalThis.fetch = async (url) => {
    const m = /\/presets\/([\w-]+)\.json$/.exec(String(url));
    if (m) {
      try {
        return {
          ok: true,
          status: 200,
          json: async () => JSON.parse(readFileSync(
            fileURLToPath(new URL(`../presets/${m[1]}.json`, import.meta.url)), 'utf8',
          )),
        };
      } catch {
        return { ok: false, status: 404, json: async () => ({}) };
      }
    }
    if (String(url).endsWith('/manifest.json')) {
      return { ok: true, status: 200, json: async () => ({ version: '0.0.1' }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const mod = await import(`../index.js?run=${Math.random()}`);
  for (let i = 0; i < 50; i += 1) {
    if (tavern.prompts.academy_status !== undefined
      && (!tavern.SlashCommandParser || tavern.SlashCommandParser.registered.length)) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return mod.__seam;
}

async function withSemester(opts = {}) {
  const tavern = fakeTavern(opts);
  const { createState } = await import('../core/state.mjs');
  const { buildSchedule } = await import('../core/schedule.mjs');
  const state = createState(preset, {
    startDay: TERM_START,
    subjects: SUBJECTS,
    teachers: TEACHERS,
    schedule: buildSchedule(SUBJECTS, preset),
  });
  state.started = true;
  tavern.chatMetadata.academy = state;
  tavern.seam = await boot(tavern);
  return tavern;
}

/** Вызвать команду так же, как это делает таверна: `callback(named, unnamed)`. */
const run = (tavern, name, args = {}, unnamed = '') => {
  const cmd = tavern.SlashCommandParser.commands[name];
  assert.ok(cmd, `команда /${name} не зарегистрирована`);
  return cmd.callback(args, unnamed);
};

// --- регистрация -------------------------------------------------------------

test('все пять команд регистрируются, алиас на месте', async () => {
  const tavern = await withSemester();
  const P = tavern.SlashCommandParser;

  assert.deepEqual(P.registered, [
    'academy', 'academy-grades', 'academy-time', 'academy-state', 'academy-debug',
  ]);
  assert.ok(P.commands['academy-status'], 'алиас /academy-status обязан быть виден парсеру');
  assert.equal(P.commands['academy-status'], P.commands.academy);
  assert.deepEqual(P.duplicates, []);

  // Аргументы `/academy-time` — те пять, что понимает `manualTime`. Пятый,
  // `count`, включает счёт посещаемости за пропущенное; по умолчанию его нет,
  // и ремонт календаря ведомость не трогает.
  const time = P.commands['academy-time'];
  assert.deepEqual(time.namedArgumentList.map((a) => a.name), ['day', 'time', 'days', 'periods', 'count']);
  assert.ok(time.namedArgumentList.every((a) => a.isRequired === false));
  assert.ok(P.commands.academy.helpString.length > 0);
});

test('/academy-time всегда говорит, что стало с посещаемостью', async () => {
  // Сутки заведения семестра ведомостью не считаются вовсе, поэтому двигаем на
  // двое: в промежуток попадает настоящий учебный день.
  const tavern = await withSemester();

  const silent = await run(tavern, 'academy-time', { days: '2' });
  assert.match(silent, /Посещаемость не записывалась/, silent);
  assert.match(silent, /count=yes/, 'про ключ сказано там же, где про пропуск');

  const counted = await run(tavern, 'academy-time', { days: '2', count: 'yes' });
  assert.match(counted, /Записано посещёнными/, counted);
  assert.equal(/Посещаемость не записывалась/.test(counted), false,
    'записанное не предлагается записать второй раз');
  assert.equal(/Репутация/.test(counted), false, 'посещённое репутацию не двигает');
});

test('count= понимает живые слова и не включается пустым', async () => {
  for (const word of ['да', 'true', '1']) {
    const tavern = await withSemester();
    const out = await run(tavern, 'academy-time', { days: '2', count: word });
    assert.match(out, /Записано посещёнными/, `«${word}» — это согласие: ${out}`);
  }

  const tavern = await withSemester();
  const empty = await run(tavern, 'academy-time', { days: '2', count: '' });
  assert.match(empty, /Посещаемость не записывалась/, empty);
});

test('повторный registerCommands не регистрирует дубли', async () => {
  const tavern = await withSemester();
  const P = tavern.SlashCommandParser;
  const before = P.registered.length;

  const { registerCommands } = await import('../commands.js');
  const again = registerCommands(tavern.seam.host, tavern);

  assert.deepEqual(again, [], 'второй заход обязан вернуть пустой список');
  assert.equal(P.registered.length, before);
  assert.deepEqual(P.duplicates, [], 'таверна не должна увидеть ни одного дубля');
});

test('таверна без SlashCommandParser: расширение поднимается, команд просто нет', async () => {
  const tavern = fakeTavern({ withParser: false });
  const seam = await boot(tavern);

  assert.ok(seam && seam.host, 'расширение обязано подняться целиком');
  assert.ok(tavern.prompts.academy_status !== undefined, 'инжекты выставлены, значит init дошёл до конца');

  // И сам модуль команд на таком контексте молчит, а не бросает.
  const { registerCommands } = await import('../commands.js');
  assert.deepEqual(registerCommands(seam.host, tavern), []);
});

// --- до начала семестра ------------------------------------------------------

test('до начала семестра каждая команда объясняется словами, а не падает', async () => {
  const tavern = fakeTavern();
  await boot(tavern);

  for (const name of ['academy', 'academy-grades', 'academy-time', 'academy-state', 'academy-debug']) {
    const out = await run(tavern, name);
    assert.equal(typeof out, 'string', `/${name} обязана вернуть строку`);
    assert.ok(out.length > 0, `/${name} не должна отвечать пустотой`);
  }

  assert.match(await run(tavern, 'academy'), /Семестр не начат/);
  assert.match(await run(tavern, 'academy-grades'), /Семестр не начат/);
  assert.match(await run(tavern, 'academy-time', { days: '1' }), /Семестр не начат/);
  assert.match(await run(tavern, 'academy-debug'), /Разбора ещё не было/);

  const state = JSON.parse(await run(tavern, 'academy-state'));
  assert.equal(state.started, false);
  assert.equal(state.status, 'empty');
});

test('повреждённое состояние — тоже строка, а не исключение', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  // Состояние подкладывается мимо `storage`: тот битый объект чинит миграцией, а
  // проверяется здесь как раз собственный сторож команд. Форма — ровно та, на
  // которой `validateState` когда-то падала сама (`subjects` строкой).
  seam.live.state = { version: 1, started: true, subjects: 'строка', calendar: {} };

  for (const name of ['academy', 'academy-grades', 'academy-time']) {
    const out = await run(tavern, name);
    assert.equal(typeof out, 'string');
    assert.match(out, /повреждено/i, `/${name} обязана объяснить, а не показать пустоту`);
  }
  // JSON при этом всё равно отдаётся: автору карточки нужно видеть, что сломано.
  assert.equal(JSON.parse(await run(tavern, 'academy-state')).subjects, 'строка');
});

// --- после начала ------------------------------------------------------------

test('/academy: дата, неделя, пары дня и балл — словами панели', async () => {
  const tavern = await withSemester();
  const { todayView, gradebookView } = await import('../ui.js');
  const view = todayView(tavern.seam.host.getState(), preset);
  const book = gradebookView(tavern.seam.host.getState(), preset);

  const out = await run(tavern, 'academy');
  assert.ok(out.includes(view.dateLine), 'дата обязана совпасть с той, что показывает панель');
  assert.ok(out.includes(view.weekLine));
  assert.ok(out.includes(book.overallText));
  assert.ok(out.includes(view.timeMark));
  // Своих склонений команда не изобретает: строка недели пришла из вью целиком.
  assert.ok(/неделя|семестр ещё не начался/.test(out));
});

test('/academy-status — тот же ответ, что /academy', async () => {
  const tavern = await withSemester();
  assert.equal(await run(tavern, 'academy-status'), await run(tavern, 'academy'));
});

test('/academy-grades: предметы, оценки и средний балл', async () => {
  const tavern = await withSemester();
  const id = say(tavern, `Химия прошла. ${marker('t=+1 grade=chemistry:5')}`);
  await tavern.eventSource.emit('message_received', id);

  const out = await run(tavern, 'academy-grades');
  assert.ok(out.includes('аналитическая химия'));
  assert.ok(out.includes('физика'));
  assert.ok(/химия: .*5/.test(out), 'выставленная оценка обязана быть видна');
  assert.ok(out.includes('Петрова Анна Сергеевна'));
});

test('/academy-time: сдвиг днями двигает календарь и возвращает новую точку', async () => {
  const tavern = await withSemester();
  const before = tavern.seam.host.getState().calendar.day;

  const out = await run(tavern, 'academy-time', { days: '1' });
  const after = tavern.seam.host.getState().calendar.day;

  assert.notEqual(after, before, 'день обязан сдвинуться');
  assert.equal(after, '2024-09-03');
  assert.equal(tavern.chatMetadata.academy.calendar.day, after, 'сдвиг обязан доехать до метаданных');
  assert.ok(out.includes('3 сентября'), `в ответе новая дата, получено: ${out}`);
  assert.equal(tavern.seam.host.getState().calendar.source, 'manual');
});

test('/academy-time: сдвиг парами и абсолютная дата', async () => {
  const tavern = await withSemester();

  await run(tavern, 'academy-time', { periods: '2' });
  assert.equal(tavern.seam.host.getState().calendar.periodIndex, 2);

  await run(tavern, 'academy-time', { day: '2024-09-10', time: '10:30' });
  const cal = tavern.seam.host.getState().calendar;
  assert.equal(cal.day, '2024-09-10');
  assert.equal(cal.time, '10:30');
});

test('/academy-time: отказ ядра доезжает до чата текстом', async () => {
  const tavern = await withSemester();
  const before = tavern.seam.host.getState().calendar.day;

  const out = await run(tavern, 'academy-time', { day: 'вчера' });
  assert.match(out, /не сдвинулся/);
  assert.ok(out.includes('вчера'), 'причина отказа берётся у ядра, а не выдумывается');
  assert.equal(tavern.seam.host.getState().calendar.day, before, 'состояние не тронуто');
});

test('/academy-time без аргументов показывает, где календарь, и не двигает его', async () => {
  const tavern = await withSemester();
  const before = tavern.seam.host.getState().calendar.day;

  const out = await run(tavern, 'academy-time');
  assert.ok(out.includes('2 сентября'));
  assert.match(out, /day=|periods=/);
  assert.equal(tavern.seam.host.getState().calendar.day, before);
});

test('/academy-time: нечисловой сдвиг — объяснение, а не молчание', async () => {
  const tavern = await withSemester();
  assert.match(await run(tavern, 'academy-time', { days: 'много' }), /целое число/);
  assert.match(await run(tavern, 'academy-time', { days: '1', periods: '1' }), /либо днями, либо парами/);
});

test('/academy-state: разбираемый JSON с календарём и предметами', async () => {
  const tavern = await withSemester();
  const out = await run(tavern, 'academy-state');
  const parsed = JSON.parse(out);

  assert.equal(parsed.started, true);
  assert.equal(parsed.calendar.day, TERM_START);
  assert.deepEqual(parsed.subjects.map((s) => s.id), ['chemistry', 'physics']);
});

// --- ключ API ----------------------------------------------------------------

test('/academy-state не выносит ключ API в чат даже из самого состояния', async () => {
  const tavern = await withSemester();

  // Ключ подкладывается прямо в живое состояние — то самое, чего `stripSecrets`
  // и сторожит: панель или чужой код могли положить настройки внутрь семестра.
  tavern.seam.live.state.api = { key: SECRET, endpoint: 'https://x/v1' };
  tavern.seam.live.state.settings = { api: { key: SECRET } };

  const out = await run(tavern, 'academy-state');
  assert.ok(!out.includes(SECRET), 'ключ API не должен попасть в чат ни при каких условиях');
  assert.ok(!out.includes('sk-'), 'и никакого хвоста ключа тоже');
  JSON.parse(out); // срез не должен ломать сериализацию
});

test('/academy-debug не выносит ключ API и печатает разбор, а не состояние', async () => {
  const tavern = await withSemester();
  const id = say(tavern, `Химия прошла. ${marker('t=+1 grade=chemistry:5')}`);
  await tavern.eventSource.emit('message_received', id);
  tavern.seam.live.state.api = { key: SECRET };

  const out = await run(tavern, 'academy-debug');
  assert.ok(!out.includes(SECRET));
  assert.ok(!out.includes('sk-'));

  assert.match(out, /Источник времени/);
  assert.ok(out.includes('chemistry'), 'разобранная оценка обязана быть видна');
  assert.ok(out.includes('#0'), 'номер сообщения');
  // Состояние целиком в отладку не уезжает.
  assert.ok(!out.includes('"subjects"'));
  assert.ok(!out.includes('endpoint'));
});

test('/academy-debug после ответа без метки: говорит, что метки не было', async () => {
  const tavern = await withSemester();
  const id = say(tavern, 'Она молча сидела на паре.');
  await tavern.eventSource.emit('message_received', id);

  const out = await run(tavern, 'academy-debug');
  assert.match(out, /Метки в ответе не было/);
});

/**
 * Долг этапа 2: `describeApplied` печатала слова русского вуза в общем коде —
 * «пропущено пар» и «назначена сессия на …», — из-за чего `/academy-debug` в
 * магической академии врал, хотя вкладка «Отладка» уже брала лексику из
 * пресета. Копий больше нет: команда зовёт ту же функцию, что и панель.
 *
 * Проверяется исполнением под чужим пресетом, а не чтением кода: расхождение
 * в словах — это ровно то, чего не видит ни один модульный тест.
 */
test('/academy-debug говорит словами активного пресета, а не русского вуза', async () => {
  const magic = JSON.parse(readFileSync(
    fileURLToPath(new URL('../presets/magic-academy.json', import.meta.url)), 'utf8',
  ));
  const tavern = fakeTavern();
  tavern.extensionSettings.academy = { preset: 'magic-academy' };

  const { createState } = await import('../core/state.mjs');
  const { buildSchedule } = await import('../core/schedule.mjs');
  const state = createState(magic, {
    startDay: TERM_START, subjects: SUBJECTS, teachers: TEACHERS,
    schedule: buildSchedule(SUBJECTS, magic),
  });
  state.started = true;
  // Со следующего дня после заведения: сутки, в которые семестр заведён,
  // ведомостью не обсчитываются вовсе (`attendance.countsAttendance`).
  state.calendar.day = '2024-09-03';
  tavern.chatMetadata.academy = state;
  tavern.seam = await boot(tavern);
  assert.equal(tavern.seam.host.getPreset().id, 'magic-academy');

  // Прогул бывает только из прямого факта (`skip=`): сутки, перешагнутые
  // календарём, посещены и в разборе не светятся.
  const id = say(tavern, `Она проспала химию. ${marker('t=+1 day skip=chemistry')}`);
  await tavern.eventSource.emit('message_received', id);
  const out = await run(tavern, 'academy-debug');

  assert.ok(/посещаемость/.test(out), `в разборе нет отметки посещаемости: ${out}`);
  assert.equal(/(?<!\p{L})пар/iu.test(out), false, `«пары» в магической академии: ${out}`);
  assert.equal(/(?<!\p{L})сесси/iu.test(out), false, `«сессия» в магической академии: ${out}`);
  assert.equal(/(?<!\p{L})хвост/iu.test(out), false, `«хвосты» в магической академии: ${out}`);

  // И то же самое печатает вкладка «Отладка» — иначе человек, читающий то одно,
  // то другое, увидит два разных заведения.
  const { debugView } = await import('../ui.js');
  const view = debugView(tavern.seam.host.getDebug(), tavern.seam.host.getState(),
    tavern.seam.host.getPreset(), { debug: true });
  for (const line of view.applied) {
    assert.ok(out.includes(line), `команда и вкладка разошлись: «${line}» есть только на вкладке`);
  }
});

// --- подсказка `/academy-time` ------------------------------------------------

test('/academy-time без аргументов показывает сегодняшний день календаря, а не выдуманный', async () => {
  const tavern = await withSemester();
  // Календарь уведён в другой год — ровно та обстановка, в которой дефект и
  // нашёлся: подсказка звала на 2024-09-05 при календаре 2026-го. Сдвиг на
  // пару дней тест бы не поймал: он случайно попал бы в ту же дату.
  await run(tavern, 'academy-time', { day: '2026-09-23' });
  const today = tavern.seam.host.getState().calendar.day;
  assert.equal(today, '2026-09-23', 'календарь обязан уехать, иначе проверять нечего');

  const out = await run(tavern, 'academy-time');
  assert.ok(out.includes(`day=${today}`), `в примере обязан стоять день календаря (${today}); получено: ${out}`);

  // И никакой другой даты в подсказке нет. Живьём человек копировал day=2024-09-05
  // при календаре 2026-09-23 и получал отказ: откат назад запрещён правилом 3.2,
  // а из подсказки этого было не видно.
  const dates = [...new Set(out.match(/\d{4}-\d{2}-\d{2}/g) || [])];
  assert.deepEqual(dates, [today], `в подсказке чужие даты: ${JSON.stringify(dates)}`);

  // Пример исполним: скопированный из подсказки, он проходит и календарь не двигает.
  const back = await run(tavern, 'academy-time', { day: today });
  assert.equal(/не сдвинулся/.test(back), false, `подсказанное же и отвергнуто: ${back}`);
  assert.equal(tavern.seam.host.getState().calendar.day, today);
});

test('справка /academy-time, зарегистрированная в таверне, даты не содержит', async () => {
  const tavern = await withSemester();
  const help = tavern.SlashCommandParser.commands['academy-time'].helpString;
  assert.equal(/\d{4}-\d{2}-\d{2}/.test(help), false, `в справке конкретная дата: ${help}`);
  assert.ok(help.includes('ГГГГ-ММ-ДД'));
});

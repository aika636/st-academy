// storage — где живёт состояние семестра и настройки расширения.
//
// Слой таверны: единственный файл, который знает про `chat_metadata` и
// `extension_settings`. Всё, что можно проверить без браузера (выбор ветки
// миграции, доливка умолчаний, разбор чужого объекта из метаданных), вынесено в
// чистые экспортируемые функции — их и покрывает `test/storage.test.mjs`.
//
// Четыре решения, из которых вытекает файл.
//
// 1. **Ссылка на `chatMetadata` не кэшируется.** Таверна переприсваивает
//    `chat_metadata` новым объектом при каждой смене чата (`script.js:7598` и ещё
//    семь мест), а `CHAT_CHANGED` эмитится уже после. Модуль, запомнивший ссылку,
//    после переключения чата пишет в мёртвый объект — семестр «теряется». Поэтому
//    `getContext()` спрашивается на каждое обращение.
//
// 2. **Пока семестр не начат явно — молчим.** `loadState` возвращает `null`, если
//    в метаданных ничего нет. Расширение не заводит состояние само: чужой чат, в
//    котором никто не начинал учиться, не должен обрастать нашими полями.
//
// 3. **Битое состояние — это отчёт, а не исключение и не пустой экран.**
//    `loadStateReport` возвращает статус и список претензий, панель показывает их
//    человеку. Состояние из будущей версии схемы не грузится вовсе: тихо
//    «домигрировать» вперёд нельзя, обратной дороги у чужих данных не будет.
//
// 4. **Умолчания настроек доливаются по ключам, а не заменой объекта.** Чужие и
//    новые ключи должны пережить обновление расширения; объект настроек к тому же
//    тот самый, который таверна сериализует, поэтому он правится на месте.

import { METADATA_KEY, SCHEMA_VERSION, migrate, validateState } from './core/state.mjs';
import { normalizePlot } from './core/plot.mjs';
import { MARKS_MAX } from './core/feed.mjs';
// Словарь панели — за словами заведения. Направление импорта необычное (данные
// зовут интерфейс), но словарь один на всё расширение, и второй копии у него
// быть не должно: этим же путём за словами ходит `commands.js`. Цикла нет —
// `ui.js` о `storage.js` не знает.
import { fill, uiLabels } from './ui.js';

/** Ключ и в `chat_metadata`, и в `extension_settings` — один. */
export const KEY = METADATA_KEY;

/**
 * Умолчания настроек — данные, не логика.
 *
 * ВАЖНО ПРО КЛЮЧ API (3.6): `api.key` лежит только здесь, то есть в
 * `settings.json` таверны открытым текстом, и попадает в экспорт настроек. В
 * `chat_metadata` ключ не пишется никогда: метаданные уезжают вместе с файлом
 * чата, а чаты люди пересылают друг другу. Никакая функция этого модуля ключ в
 * состояние не копирует — см. `saveState`.
 */
export const DEFAULT_SETTINGS = {
  /** Источник времени (3.2): 'auto' — сперва проза, 'context' — только проза, 'marker' — только метка. */
  mode: 'auto',
  /** Инжектить ли инструкцию про метку (3.1). Выключается, когда модель и так печатает шапку. */
  injectMarker: true,
  /** Понимать относительные сдвиги словами («на следующий день») — по умолчанию выключено. */
  relativeWords: false,
  /** Глубина инжекта состояния в чат (`setExtensionPrompt`, IN_CHAT). */
  injectDepth: 1,
  /**
   * Строку состояния ставит человек макросом `{{academy}}` туда, куда хочет
   * (9.3.1): хвост промпта на глубине 0–2 тесный (9.5), и место строки там
   * решает не Academy. Включено — автоинжект строки гаснет; инструкция метки и
   * одноразовый факт остаются инжектами, их место важно (3.1, 3.5).
   */
  statusViaMacro: false,
  /** Режим отладки: журнал и разбор ответа в панели. */
  debug: false,
  /**
   * Короткий звук на новую веху (9.4.2, `ui.playChime`). Выключен: расширение
   * не шумит без спроса, а браузер всё равно глушит звук до первого жеста.
   * Всплывашка с названием вехи приходит и без него.
   */
  milestoneSound: false,
  /**
   * Счёт «во всех историях» для вкладки «Достижения»
   * (`core/milestones.recordTally`): `{ [вид]: { chats: [id чата], first } }`.
   * Общий для всех чатов, поэтому здесь, а не в метаданных чата.
   */
  achievementTally: {},
  api: {
    /**
     * Откуда генерировать (правка «актуальный API»):
     * `'auto'` — как было до появления этой графы: свой адрес, если он вписан,
     * иначе подключение таверны. Умолчание сохраняет поведение старых настроек,
     * где графы не было вовсе;
     * `'tavern'` — тем, чем таверна отвечает прямо сейчас (ключ не нужен);
     * `'own'` — только свой адрес с ключом, без тихого ухода в таверну.
     */
    source: 'auto',
    /**
     * Профиль подключения таверны (`connectionManager.profiles[].id`). Пусто —
     * текущее подключение как есть. Имя не годится: профили переименовывают.
     */
    profile: '',
    /** Любой OpenAI-совместимый адрес; нормализуется в api.js. */
    endpoint: '',
    key: '',
    model: '',
  },
  /**
   * Пресет: лексика, шкала оценок и правила заведения (раздел 1 плана).
   * Настройка общая для всех чатов, а `state.presetId` — своя у каждого чата;
   * расходятся они законно, и панель об этом говорит вслух.
   */
  preset: 'ru-university',
  /**
   * Свои пресеты человека (9.3.2): `{ [id]: пресет }`, каждый — уже прошедший
   * `core/preset.mjs: normalizePreset` при загрузке. Лежат здесь, а не файлами
   * в папке установки: на телефоне и на хостинге папки нет. Встроенные сюда не
   * копируются никогда — они файлы и обновляются вместе с расширением.
   */
  presets: {},
  /**
   * Лорбук академии (3.7). Жил в `lorebook.js` временно — на время, пока
   * блок настроек не был написан. `enabled: false` — требование плана
   * (`:476-477`), а не вкус: у людей есть свои лорбуки, и сюрприз в чужом
   * World Info недопустим.
   */
  /**
   * Поток курса (шаг 4). `hooks` — рубильник слоя 3: кнопка «Взять в сюжет»
   * и разовый повод в промпте; выключен — поводы не уходят вовсе. `auto` —
   * «подкидывать поводы автоматически» (`core/plot.autoPick`): выключено,
   * пока человек не попросил. `background` — фон в сцене: что говорят о
   * свежем, строкой состояния; выключен — фон молчит, поводы живут.
   */
  feed: {
    hooks: true,
    auto: false,
    /** Фон курса в строке состояния («на курсе говорят: …», слой 1). */
    background: true,
  },
  /**
   * «Нарисовать портрет» (шаг 4): чем рисовать, модель на каждый путь, стиль
   * и размер NAI. Привычка человека, а не факт семестра — поэтому здесь.
   * Ключей тут нет и не будет: рисует сервер таверны её же ключами.
   * `route` пустой — первый доступный путь (`core/draw.availableRoutes`).
   */
  draw: {
    route: '',
    models: {},
    style: 'anime',
    naiSize: 'portrait',
  },
  lorebook: {
    enabled: false,
    /** Имя лорбука. Пусто — берётся привязанный к чату, иначе по имени чата. */
    book: '',
  },
  /**
   * Своё у панели: черновик анкеты, положение окна, выбранная вкладка.
   * Умолчаний тут нет ни одного — панель пишет сюда сама и сама же читает
   * через `settings.ui && ...`. Ключ объявлен, чтобы `mergeDefaults` завёл
   * объект и панели не приходилось создавать его на лету.
   *
   * Здесь жил `compact` — «только Сегодня, без карточек». Его никто не читал
   * ни разу: ни панель, ни команды, ни промпт; единственным читателем был
   * тест умолчаний. Настройка, о которой знает только тест, — это обещание
   * поведения, которого нет, поэтому поле выброшено, а не реализовано.
   */
  ui: {},
};

// --- доступ к таверне --------------------------------------------------------

let contextProvider = () => (globalThis.SillyTavern && globalThis.SillyTavern.getContext
  ? globalThis.SillyTavern.getContext()
  : null);

/** Подменить источник контекста (тесты, а также раннее внедрение из index.js). */
export function setContextProvider(fn) {
  contextProvider = typeof fn === 'function' ? fn : () => null;
}

/** Контекст таверны: либо переданный аргументом, либо лениво добытый. Никогда не кэшируется. */
export function context(ctx) {
  const c = ctx || contextProvider();
  if (!c) throw new Error('academy/storage: контекст SillyTavern недоступен');
  return c;
}

/**
 * Разбор пары аргументов `(ctx, preset)`. Порядок в контракте — `(ctx, preset)`,
 * но соседние модули пишутся параллельно, и вызов `loadState(preset)` слишком
 * вероятен, чтобы падать на нём. Пресет узнаётся по `id`+`limits`/`vocab`,
 * контекст — по `chatMetadata`/`getContext`-полям.
 */
export function resolveArgs(a, b) {
  if (looksLikeContext(a)) return { ctx: a, preset: b };
  if (a && !looksLikeContext(a)) return { ctx: looksLikeContext(b) ? b : undefined, preset: a };
  return { ctx: a, preset: b };
}

function looksLikeContext(v) {
  return Boolean(v && typeof v === 'object'
    && ('chatMetadata' in v || 'saveMetadataDebounced' in v || 'extensionSettings' in v));
}

// --- состояние семестра ------------------------------------------------------

/**
 * Какую ветку выбрать для объекта, пришедшего из метаданных. Чистая функция —
 * именно её проверяет тест, а не поход в таверну.
 *
 * @returns {{action: 'empty'|'invalid'|'refuse'|'migrate'|'load', from?: number, reason?: string}}
 */
export function migrationPlan(raw) {
  if (raw === undefined || raw === null) return { action: 'empty' };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { action: 'invalid', reason: 'состояние в метаданных не объект' };
  }
  const v = raw.schemaVersion;
  // Состояние из версии, где поля ещё не было: гоним через migrate как нулевую.
  if (typeof v !== 'number' || !Number.isFinite(v)) return { action: 'migrate', from: 0 };
  if (v > SCHEMA_VERSION) return { action: 'refuse', from: v };
  if (v < SCHEMA_VERSION) return { action: 'migrate', from: v };
  return { action: 'load', from: v };
}

/**
 * Чистое ядро загрузки: сырое значение из метаданных → отчёт.
 *
 * @param {*} raw
 * @param {Object} preset
 * @returns {{status: 'empty'|'ok'|'migrated'|'invalid'|'future', state: ?Object, errors: string[], from?: number}}
 */
export function readState(raw, preset) {
  const plan = migrationPlan(raw);

  if (plan.action === 'empty') return { status: 'empty', state: null, errors: [] };
  if (plan.action === 'invalid') return { status: 'invalid', state: null, errors: [plan.reason] };
  if (plan.action === 'refuse') {
    // Осознанный отказ (3.8): состояние новее нашей схемы. Если его «домигрировать»
    // назад, человек потеряет семестр, откатившись на старую версию расширения.
    return {
      status: 'future',
      state: null,
      from: plan.from,
      errors: [`состояние записано схемой версии ${plan.from}, расширение понимает ${SCHEMA_VERSION};`
        + ' обновите расширение — состояние не тронуто'],
    };
  }

  let migrated;
  try {
    migrated = migrate(raw, preset);
  } catch (err) {
    return { status: 'invalid', state: null, errors: [`миграция не прошла: ${err && err.message}`] };
  }

  const checked = validateState(migrated, preset);
  if (!checked.ok) {
    // Состояние отдаём вместе с претензиями: панель покажет и то и другое, а
    // человек решит — чинить руками или начинать семестр заново.
    return { status: 'invalid', state: migrated, errors: checked.errors, from: plan.from };
  }
  return {
    status: plan.action === 'migrate' ? 'migrated' : 'ok',
    state: migrated,
    errors: [],
    from: plan.from,
  };
}

/**
 * Подробный отчёт о загрузке — для панели. `state` не `null` и при `invalid`:
 * показать то, что есть, полезнее пустого экрана.
 */
export function loadStateReport(ctx, preset) {
  const args = resolveArgs(ctx, preset);
  const c = context(args.ctx);
  const md = c.chatMetadata || {};
  return readState(md[KEY], args.preset);
}

/**
 * Состояние семестра из метаданных текущего чата, либо `null`.
 *
 * `null` значит «расширение молчит»: семестр не начат, схема из будущего или
 * объект битый. Что именно случилось — в `loadStateReport`.
 */
export function loadState(ctx, preset) {
  const report = loadStateReport(ctx, preset);
  return report.status === 'ok' || report.status === 'migrated' ? report.state : null;
}

/**
 * Записать состояние в метаданные текущего чата. Мутация объекта +
 * `saveMetadataDebounced()` — как это делает сама таверна (`extensions.js:89`);
 * дебаунс к тому же проверяет, что чат и персонаж не сменились.
 */
export function saveState(ctx, state) {
  const c = context(looksLikeContext(ctx) ? ctx : undefined);
  const target = looksLikeContext(ctx) ? state : ctx;
  const md = c.chatMetadata;
  if (!md) throw new Error('academy/storage: у чата нет метаданных');
  // Ключ API в метаданные чата не пишется никогда (3.6): чат уезжает файлом.
  md[KEY] = stripSecrets(target);
  c.saveMetadataDebounced();
  return target;
}

/**
 * То же немедленно и целиком (`saveMetadata()` = `saveChatConditional()`).
 * Для критичных точек: начало семестра, сгенерированный план. Дебаунс там
 * недопустим — человек может закрыть вкладку сразу после кнопки.
 */
export async function flushState(ctx, state) {
  const c = context(looksLikeContext(ctx) ? ctx : undefined);
  const target = looksLikeContext(ctx) ? state : ctx;
  const md = c.chatMetadata;
  if (!md) throw new Error('academy/storage: у чата нет метаданных');
  if (target !== undefined) md[KEY] = stripSecrets(target);
  await c.saveMetadata();
  return target;
}

/** Забыть семестр в этом чате — вместе с историей ходов, которая без него бессмысленна. */
export function clearState(ctx) {
  const c = context(ctx);
  const md = c.chatMetadata;
  if (md) {
    delete md[KEY];
    delete md[TURNS_KEY];
  }
  c.saveMetadataDebounced();
}

// --- история ходов (ремонт 9.1.1) --------------------------------------------
//
// Снимок «до ответа» нужен свайпу, правке и удалению: без него новый вариант
// ответа ложится поверх старого, и оценки с прогулами удваиваются. Раньше
// снимки жили только в памяти вкладки (`live.snapshots`), и после F5 откатывать
// было не к чему.
//
// Три решения.
//
// 1. **История лежит рядом с состоянием, а не внутри него** — отдельным ключом
//    `academy_turns` в тех же метаданных чата. Внутри состояния снимок был бы
//    состоянием в состоянии: `validateState` пришлось бы учить его форме,
//    выгрузка (3.8) унесла бы в файл пять копий семестра, а загрузка привезла бы
//    снимки, указывающие на сообщения чужого чата. Рядом — форма семестра не
//    меняется, `SCHEMA_VERSION` не растёт, миграции не нужно. У истории своя
//    версия формата (`v`): её данные одноразовые, и истории из будущей версии
//    расширение не читает, а просто начинает новую.
//
// 2. **История короткая** (`TURN_HISTORY`). Метаданные чата таверна пишет
//    целиком при каждом сохранении, а снимок — это полное состояние семестра.
//    Свайпнуть можно только последний ответ; удалить подряд несколько последних —
//    бывает, но редко больше пары. Снимки старше этого окна нужны только на
//    правку старого ответа, а её расширение и так не пересчитывает (см. index.js,
//    правило «откатывается только последний ход»).
//
// 3. **Снимок проходит тот же путь загрузки, что и состояние**: `readState`, то
//    есть миграция и проверка. Снимок, записанный старой схемой, после
//    обновления расширения поднимается; битый — выбрасывается, и ход становится
//    «ходом без снимка», который не откатывается. Лучше не откатить, чем
//    откатить в мусор.

/** Ключ истории ходов в `chat_metadata`. */
export const TURNS_KEY = `${KEY}_turns`;

/** Версия формата истории ходов — не схемы состояния (решение 1). */
export const TURNS_FORMAT = 1;

/** Сколько последних ходов помнить (решение 2). */
export const TURN_HISTORY = 5;

/**
 * Чистое ядро чтения истории: сырое значение из метаданных → список ходов.
 * Ход — `{mesId, stamp, before, oneShotBefore, oneShot}`; всё, что на него не
 * похоже, выбрасывается молча: история — подсказка для отката, а не данные
 * человека, и отказ здесь значил бы только «свайп не откатится».
 */
export function readTurns(raw, preset) {
  if (!raw || typeof raw !== 'object' || raw.v !== TURNS_FORMAT || !Array.isArray(raw.list)) return [];
  const out = [];
  for (const t of raw.list) {
    if (!t || typeof t !== 'object' || !Number.isInteger(t.mesId) || t.mesId < 0) continue;
    const report = readState(t.before, preset);
    if (report.status !== 'ok' && report.status !== 'migrated') continue;
    out.push({
      mesId: t.mesId,
      stamp: typeof t.stamp === 'string' ? t.stamp : null,
      before: report.state,
      oneShotBefore: typeof t.oneShotBefore === 'string' ? t.oneShotBefore : '',
      oneShot: typeof t.oneShot === 'string' ? t.oneShot : '',
      // Каким разбором секретаря ход посчитан (`null` — без разбора).
      analysis: typeof t.analysis === 'string' ? t.analysis : null,
      marks: readMarks(t.marks),
    });
  }
  return out.slice(-TURN_HISTORY);
}

/**
 * Память отметок ленты у хода (`feed.rememberFeedMarks`): `{id, read, mine,
 * status, playedSrc}`. Чужое на неё не похожее выбрасывается молча — это
 * украшение, а не данные семестра.
 */
export function readMarks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m) => m && typeof m.id === 'string' && m.id).slice(-MARKS_MAX).map((m) => ({
    id: m.id,
    read: m.read === true,
    mine: typeof m.mine === 'string' ? m.mine : '',
    status: typeof m.status === 'string' ? m.status : 'new',
    playedSrc: typeof m.playedSrc === 'string' ? m.playedSrc : '',
  }));
}

/** История ходов текущего чата. Пустой список — «откатывать не к чему». */
export function loadTurns(ctx, preset) {
  const c = context(ctx);
  const md = c.chatMetadata || {};
  return readTurns(md[TURNS_KEY], preset);
}

/**
 * Записать историю ходов. Тем же дебаунсом, что и состояние, и всегда вместе
 * с ним: состояние без своей истории (или наоборот) после F5 откатило бы свайп
 * не туда. Длина режется здесь, чтобы ни один вызывающий не мог её раздуть.
 */
export function saveTurns(ctx, list) {
  const c = context(ctx);
  const md = c.chatMetadata;
  if (!md) throw new Error('academy/storage: у чата нет метаданных');
  const turns = (Array.isArray(list) ? list : []).slice(-TURN_HISTORY).map((t) => ({
    mesId: t.mesId,
    stamp: t.stamp,
    // Ключ API не едет и сюда: снимок — такое же состояние, как основное.
    before: stripSecrets(t.before),
    oneShotBefore: t.oneShotBefore || '',
    oneShot: t.oneShot || '',
    analysis: typeof t.analysis === 'string' ? t.analysis : null,
    // Отметки ленты с ушедших свайпов (`feed.rememberFeedMarks`).
    marks: readMarks(t.marks),
  }));
  md[TURNS_KEY] = { v: TURNS_FORMAT, list: turns };
  c.saveMetadataDebounced();
  return turns;
}

// --- протокол ответов (плашка под сообщением) --------------------------------
//
// Что расширение записало из каждого ответа модели: строки событий для плашки
// и выводы секретаря. Ключ — отпечаток текста сообщения (`index.js: stamp`), а
// не индекс: индексы едут от вставок соседей, а свайп туда и обратно должен
// найти свой разбор, а не чужой.
//
// Лежит отдельно от истории ходов: ход откатывается свайпом и забывает себя, а
// разбор, за который заплачено запросом, при возврате на тот же свайп нужен
// снова. Список короткий (`LEDGER_SIZE`): плашки старых ответов — справка, а
// метаданные чата таверна пишет целиком при каждом сохранении.

/** Ключ протокола в `chat_metadata`. */
export const LEDGER_KEY = `${KEY}_ledger`;

/** Версия формата протокола. */
export const LEDGER_FORMAT = 1;

/** Сколько ответов помнить. */
export const LEDGER_SIZE = 100;

/**
 * Запись протокола: `{stamp, rows, day, time, tokens, marker, at, mode, receipts, summary}`.
 * `tokens` — выводы секретаря (`null` — разбора не было), `rows` — события
 * мира, которые этот ответ сделал, готовыми строками (`mes-panel.rowText`), `marker` — была ли
 * метка рассказчика. Всё непохожее выбрасывается молча, как в истории ходов.
 */
export function readLedger(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== LEDGER_FORMAT || !Array.isArray(raw.list)) return [];
  const out = [];
  for (const e of raw.list) {
    if (!e || typeof e !== 'object' || typeof e.stamp !== 'string' || !e.stamp) continue;
    out.push({
      stamp: e.stamp,
      rows: Array.isArray(e.rows) ? e.rows.filter((r) => typeof r === 'string' && r) : [],
      day: typeof e.day === 'string' ? e.day : '',
      time: typeof e.time === 'string' ? e.time : '',
      tokens: Array.isArray(e.tokens) ? e.tokens.filter((t) => typeof t === 'string' && t) : null,
      marker: e.marker === true,
      at: Number.isFinite(e.at) ? e.at : 0,
      // Как легли выводы (`core/corrections`): `'live'` — пересчётом хода,
      // `'late'` — поправкой к старому ответу; у поправки — квитанции по токенам.
      mode: e.mode === 'late' ? 'late' : 'live',
      receipts: Array.isArray(e.receipts) ? e.receipts.map((r) => (r && typeof r === 'object' ? r : null)) : null,
      summary: typeof e.summary === 'string' ? e.summary.slice(0, 300) : '',
      // Кого секретарь назвал, а в списках не нашлось (`analysis.unparsedNames`):
      // плашка говорит «Не разобрано: …», а не молчит.
      unparsed: unparsedList(e.unparsed),
      // Черновик не участвует в расчётах до явного сохранения игроком.
      draft: e.draft && Array.isArray(e.draft.tokens) ? {
        tokens: e.draft.tokens.filter((t) => typeof t === 'string' && t),
        summary: typeof e.draft.summary === 'string' ? e.draft.summary.slice(0, 300) : '',
        unparsed: unparsedList(e.draft.unparsed),
      } : null,
      previousAnalysis: e.previousAnalysis && typeof e.previousAnalysis === 'object'
        && (e.previousAnalysis.tokens === null || Array.isArray(e.previousAnalysis.tokens)) ? {
          tokens: Array.isArray(e.previousAnalysis.tokens)
            ? e.previousAnalysis.tokens.filter((t) => typeof t === 'string' && t) : null,
          summary: typeof e.previousAnalysis.summary === 'string' ? e.previousAnalysis.summary.slice(0, 300) : '',
        } : null,
    });
  }
  return out.slice(-LEDGER_SIZE);
}

/** Имена «не разобрано»: строки, не больше шести, каждая короче 80 знаков. */
function unparsedList(v) {
  return (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 80)).slice(0, 6);
}

/** Протокол текущего чата. */
export function loadLedger(ctx) {
  const c = context(ctx);
  const md = c.chatMetadata || {};
  return readLedger(md[LEDGER_KEY]);
}

/** Записать протокол; длина режется здесь. */
export function saveLedger(ctx, list) {
  const c = context(ctx);
  const md = c.chatMetadata;
  if (!md) throw new Error('academy/storage: у чата нет метаданных');
  const ledger = readLedger({ v: LEDGER_FORMAT, list: Array.isArray(list) ? list : [] });
  md[LEDGER_KEY] = { v: LEDGER_FORMAT, list: ledger };
  c.saveMetadataDebounced();
  return ledger;
}

// --- очередь поводов (шаг 4) --------------------------------------------------
//
// «Взять в сюжет» (`core/plot.mjs`): что ждёт следующей генерации и что уже
// ушло рассказчику. Лежит отдельно от состояния, как протокол: жизнь повода —
// функция генераций, и снимок хода не должен откатывать её свайпом.

/** Ключ очереди поводов в `chat_metadata`. */
export const PLOT_KEY = `${KEY}_plot`;

/** Очередь поводов текущего чата (нормализованная). */
export function loadPlot(ctx) {
  const c = context(ctx);
  const md = c.chatMetadata || {};
  return normalizePlot(md[PLOT_KEY]);
}

/** Записать очередь поводов. */
export function savePlot(ctx, plot) {
  const c = context(ctx);
  const md = c.chatMetadata;
  if (!md) throw new Error('academy/storage: у чата нет метаданных');
  const clean = normalizePlot(plot);
  md[PLOT_KEY] = clean;
  c.saveMetadataDebounced();
  return clean;
}

/**
 * Страховка к правилу «ключ только в extension_settings»: если кто-то в панели
 * положит настройки внутрь состояния, секреты сюда всё равно не уедут.
 */
export function stripSecrets(state) {
  if (!state || typeof state !== 'object') return state;
  if (state.api || state.settings) {
    const out = { ...state };
    delete out.api;
    delete out.settings;
    return out;
  }
  return state;
}

// --- выгрузка и загрузка состояния (3.8) -------------------------------------
//
// Пять решений, из которых вытекает весь блок ниже.
//
// 1. **Состояние в файле лежит в конверте, а не голым.** Голый объект нельзя
//    осмысленно прочитать через полгода: неясно, чем он выгружен и подо что
//    собран. Конверт отвечает на четыре вопроса — что это (`format`), каким
//    форматом файла (`formatVersion`), когда (`exportedAt`), чем и подо что
//    (`extensionVersion`, `presetId`). Версия схемы состояния при этом лежит
//    внутри самого состояния, как и в метаданных: две правды о версии — верный
//    способ разъехаться, поэтому копия в конверте (`schemaVersion`) объявлена
//    справочной, а решает всегда `state.schemaVersion`.
//
// 2. **Формат файла версионируется отдельно от схемы состояния.** Это разные
//    вещи: конверт может обрасти полями, не трогая форму семестра, и наоборот.
//    Файл из будущего формата — такой же отказ, как состояние из будущей схемы.
//
// 3. **Ключ API не уезжает в выгрузку ни при каких условиях** — поправка 6
//    этапа 2. Файл выгрузки люди пересылают друг другу охотнее, чем чат.
//    Поэтому та же защита, что при записи в метаданные: `stripSecrets` перед
//    сериализацией, и тест на отсутствие подстроки ключа в готовом JSON.
//
// 4. **Разбор и запись — два разных вызова.** `readExport` не умеет писать
//    вовсе (ему даже контекст не нужен), `importState` пишет, но отказывается
//    затирать непустой чат без `confirm: true`. Один вызов с флагом был бы
//    короче, но «случайно нажала не туда» стоит семестра, а разделение даёт
//    панели то, чего иначе неоткуда взять: показать человеку, что именно
//    приедет и что именно пропадёт, ДО того как что-то произошло.
//
// 5. **Каждый отказ говорит своё.** Не-JSON, чужой файл, будущий формат,
//    будущая схема, битое состояние, состояние чужого пресета — шесть разных
//    случаев и шесть разных текстов: «ошибка импорта» не подсказывает
//    ни одного следующего шага.

/** Что написано в поле `format`. Отличает нашу выгрузку от чужого JSON. */
export const EXPORT_FORMAT = 'academy-state';

/** Версия конверта. Растёт при несовместимой правке ФАЙЛА, не состояния. */
export const EXPORT_FORMAT_VERSION = 1;

/**
 * Запасная версия расширения на случай, когда настоящую взять неоткуда.
 *
 * Настоящая живёт в `manifest.json` и приходит сюда аргументом
 * (`opts.extensionVersion`): `index.js` читает манифест тем же `fetch`, которым
 * читает пресет, и передаёт версию в `exportState`. Константа-копия манифеста
 * разъехалась бы с ним на первом же выпуске — и молча, потому что поле
 * справочное и никакой проверкой не подпирается: импорт по нему ничего не
 * решает, иначе выгрузка из соседней версии отказывалась бы грузиться на ровном
 * месте. Именно поэтому копия и опасна: ошибку в ней никто не заметит.
 *
 * Строка ниже — не версия расширения, а признание, что её не дали.
 */
export const EXTENSION_VERSION = 'unknown';

/** Глубокая копия через JSON: заодно проверяет, что состояние сериализуемо без потерь. */
function jsonClone(v) {
  return JSON.parse(JSON.stringify(v));
}

/**
 * Конверт выгрузки из готового состояния. Чистая функция: ни таверны, ни файлов.
 *
 * @param {Object} state
 * @param {Object} [preset] только для справочных полей конверта
 * @param {Object} [opts] {extensionVersion, now}
 * @returns {Object} объект конверта, готовый к `JSON.stringify`
 */
export function buildExport(state, preset, opts = {}) {
  const clean = jsonClone(stripSecrets(state));
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: (opts.now ? new Date(opts.now) : new Date()).toISOString(),
    extensionVersion: String(opts.extensionVersion || EXTENSION_VERSION),
    // Пресет назван и словом: `presetId` человеку ни о чём не говорит, а имя —
    // говорит, и именно по нему он поймёт, куда это состояние вообще везти.
    presetId: String((clean && clean.presetId) || (preset && preset.id) || ''),
    presetName: String((preset && (preset.displayName || preset.name)) || ''),
    // Справочная копия: решает всегда `state.schemaVersion`, см. решение 1.
    schemaVersion: clean && clean.schemaVersion,
    state: clean,
  };
}

/** Имя файла выгрузки: пресет и дата — по ним человек найдёт нужный из десятка. */
export function exportFilename(envelope) {
  const id = String((envelope && envelope.presetId) || 'academy') || 'academy';
  const day = String((envelope && envelope.exportedAt) || '').slice(0, 10) || 'no-date';
  return `academy-${id}-${day}.json`;
}

/**
 * Выгрузить состояние текущего чата.
 *
 * Битое состояние выгружается вместе с претензиями (`warnings`): выгрузка — это
 * ещё и способ унести семестр до починки. Не выгружается только то, чего мы не
 * читали: пустой чат и состояние из будущей схемы (поправка 7 этапа 2 — такое
 * состояние не трогаем вовсе, в том числе не переписываем в файл, где его форма
 * станет уже нашей ответственностью).
 *
 * @returns {{ok: true, data: Object, json: string, filename: string, warnings: string[]}
 *   | {ok: false, code: 'empty'|'future'|'invalid', message: string, errors: string[]}}
 */
export function exportState(ctx, preset, opts = {}) {
  const args = resolveArgs(ctx, preset);
  const report = loadStateReport(args.ctx, args.preset);

  if (report.status === 'empty') {
    return { ok: false, code: 'empty', message: 'Семестр в этом чате не начат — выгружать нечего.', errors: [] };
  }
  if (report.status === 'future') {
    return {
      ok: false,
      code: 'future',
      message: `Состояние в этом чате новее расширения (${report.errors[0]}). Выгрузка не делается:`
        + ' переписав его своей рукой, расширение возьмёт на себя чужую форму.',
      errors: report.errors,
    };
  }
  if (!report.state) {
    return { ok: false, code: 'invalid', message: `Состояние не читается: ${report.errors.join('; ')}.`, errors: report.errors };
  }

  const data = buildExport(report.state, args.preset, opts);
  return {
    ok: true,
    data,
    json: JSON.stringify(data, null, 2),
    filename: exportFilename(data),
    // Пустой список у целого состояния; у битого — то, чем оно не нравится.
    warnings: report.errors.slice(),
  };
}

/** Похоже ли на голое состояние без конверта (человек скопировал из метаданных). */
function looksLikeBareState(v) {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v)
    && ('calendar' in v || 'subjects' in v) && ('presetId' in v || 'schemaVersion' in v));
}

/**
 * Разобрать и проверить выгрузку. **Ничего никуда не пишет** и контекста не
 * просит: это половина контракта из решения 4.
 *
 * @param {string|Object} source текст файла либо уже разобранный объект
 * @param {Object} preset активный пресет — по нему состояние и проверяется
 * @returns {{ok: true, status: 'ok'|'migrated', state: Object, from: number,
 *            envelope: Object, presetId: string, presetMatches: boolean,
 *            warnings: string[]}
 *   | {ok: false, code: string, message: string, errors: string[]}}
 */
export function readExport(source, preset) {
  const fail = (code, message, errors = []) => ({ ok: false, code, message, errors });

  let data = source;
  if (typeof source === 'string') {
    const text = source.trim();
    if (!text) return fail('not-json', 'Файл пуст: в нём нет ни состояния, ни чего-либо ещё.');
    try {
      data = JSON.parse(text);
    } catch (err) {
      return fail('not-json', `Это не JSON: ${(err && err.message) || 'разбор не удался'}.`
        + ' Нужен файл, выгруженный кнопкой «Выгрузить состояние».', [String(err && err.message)]);
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return fail('not-object', 'В файле JSON, но не объект: ожидался объект выгрузки академии.');
  }

  const warnings = [];
  let envelope = data;
  if (data.format === 'academy-preset') {
    // Файлы двух выгрузок лежат рядом в «Загрузках», и перепутать их легко.
    return fail('preset-file', 'Это пресет заведения, а не состояние семестра. Его загружают в блоке «Пресет заведения».');
  }
  if (data.format !== EXPORT_FORMAT) {
    if (looksLikeBareState(data)) {
      // Состояние без конверта: скопировано прямо из метаданных чата. Работает,
      // но человек должен знать, что дату выгрузки и версию тут взять неоткуда.
      warnings.push('состояние без конверта: ни даты выгрузки, ни версии расширения в файле нет');
      envelope = { format: EXPORT_FORMAT, formatVersion: EXPORT_FORMAT_VERSION, state: data, presetId: data.presetId };
    } else {
      return fail('foreign', data.format
        ? `Это выгрузка чего-то другого: format = «${String(data.format)}», ожидалось «${EXPORT_FORMAT}».`
        : 'Это не выгрузка академии: в объекте нет поля format. Возможно, выбран не тот файл.');
    }
  }

  const fv = envelope.formatVersion;
  if (typeof fv === 'number' && Number.isFinite(fv) && fv > EXPORT_FORMAT_VERSION) {
    return fail('format-future', `Файл выгружен форматом версии ${fv}, расширение понимает ${EXPORT_FORMAT_VERSION}.`
      + ' Обновите расширение — файл не тронут.');
  }

  const raw = envelope.state;
  if (raw === undefined || raw === null) {
    return fail('no-state', 'В выгрузке нет поля state: файл нашей формы, но состояния в нём нет.');
  }

  const report = readState(raw, preset);
  if (report.status === 'empty') return fail('no-state', 'В выгрузке нет состояния.');
  if (report.status === 'future') {
    return fail('future', `Состояние в файле записано схемой версии ${report.from},`
      + ` расширение понимает ${SCHEMA_VERSION}. Обновите расширение — файл не тронут.`, report.errors);
  }
  if (report.status === 'invalid') {
    return fail('invalid', `Состояние в файле не проходит проверку: ${report.errors.join('; ')}.`
      + ' Скорее всего, оно собрано другой версией расширения или правлено вручную.', report.errors);
  }

  if (report.status === 'migrated') {
    warnings.push(`состояние собрано схемой версии ${report.from}, поднято до ${SCHEMA_VERSION}`);
  }

  const presetId = String(report.state.presetId || envelope.presetId || '');
  const activeId = String((preset && preset.id) || '');
  const presetMatches = !activeId || !presetId || presetId === activeId;
  if (!presetMatches) {
    // Состояние ссылается на предметы и преподавателей своими id — они приедут
    // целиком, они лежат внутри. А слова заведения, шкала оценок и виды
    // контрольных берутся из активного пресета: с другим пресетом та же оценка
    // будет называться иначе, а сессия — идти по другим правилам. Проверку
    // состояние уже прошло (иначе был бы `invalid`), значит это не отказ, а
    // предупреждение, которое человек обязан увидеть до записи.
    warnings.push(presetMismatchNote(presetId, activeId, preset));
  }

  return {
    ok: true,
    status: report.status,
    state: report.state,
    from: report.from,
    envelope,
    presetId,
    presetMatches,
    warnings,
  };
}

/**
 * Слова про чужой пресет — одни и те же в предупреждении разбора и в вопросе
 * подтверждения, поэтому живут в одном месте.
 *
 * Само предупреждение объясняет, что слова заведения зависят от пресета, —
 * и до правки говорило «Предметы, преподаватели» под любым пресетом, то есть
 * опровергало себя на глазах у человека, который читал его в магической
 * академии. Текст берётся из того же словаря, которым говорит панель
 * (`uiLabels(preset)`), а не собирается здесь.
 *
 * @param {string} presetId  чей пресет в состоянии
 * @param {string} activeId  какой активен сейчас
 * @param {Object} [preset]  активный пресет — за словами. Без него сработает
 *                           умолчание словаря, то есть слова русского вуза.
 */
export function presetMismatchNote(presetId, activeId, preset = null) {
  return fill(uiLabels(preset).presetMismatch, { from: presetId, to: activeId });
}

/**
 * Короткая сводка о состоянии — то, что панель показывает человеку в вопросе
 * «заменить идущий семестр этим?». Чистая функция.
 */
export function stateSummary(state) {
  if (!state || typeof state !== 'object') return null;
  return {
    presetId: String(state.presetId || ''),
    day: (state.calendar && state.calendar.day) || null,
    termStart: (state.calendar && state.calendar.termStart) || null,
    started: Boolean(state.started),
    subjects: Array.isArray(state.subjects) ? state.subjects.length : 0,
    teachers: Array.isArray(state.teachers) ? state.teachers.length : 0,
    grades: Array.isArray(state.subjects)
      ? state.subjects.reduce((n, s) => n + ((s && Array.isArray(s.grades)) ? s.grades.length : 0), 0)
      : 0,
    schemaVersion: state.schemaVersion,
  };
}

/**
 * Записать выгрузку в текущий чат.
 *
 * Молча не затирает: если в чате уже что-то есть (в том числе битое или из
 * будущей схемы) или пресет не тот, без `opts.confirm === true` возвращается
 * отказ `needs-confirm` вместе со сводками «что было» и «что приедет» — панель
 * покажет их в вопросе. Запись немедленная (`flushState`): импорт — ровно такая
 * же критичная точка, как начало семестра.
 *
 * @param {Object} ctx
 * @param {string|Object} source
 * @param {Object} preset
 * @param {{confirm?: boolean}} [opts]
 * @returns {Promise<{ok: true, state: Object, status: string, warnings: string[], replaced: boolean}
 *   | {ok: false, code: string, message: string, errors: string[],
 *      needsConfirm?: boolean, reasons?: string[], current?: Object, incoming?: Object}>}
 */
export async function importState(ctx, source, preset, opts = {}) {
  const parsed = readExport(source, preset);
  if (!parsed.ok) return parsed;

  const current = loadStateReport(ctx, preset);
  const occupied = current.status !== 'empty';

  const reasons = [];
  if (occupied) {
    const s = stateSummary(current.state);
    const U = uiLabels(preset);
    // Слова — из словаря пресета: у магической академии здесь «круг» и
    // «дисциплины», и панель строкой выше уже говорит именно так.
    reasons.push(s && s.started
      ? fill(U.importOccupiedStarted, { subjects: s.subjects, day: s.day })
      : U.importOccupiedEmpty);
  }
  if (!parsed.presetMatches) reasons.push(presetMismatchNote(parsed.presetId, String((preset && preset.id) || ''), preset));

  if (reasons.length && opts.confirm !== true) {
    return {
      ok: false,
      code: 'needs-confirm',
      message: `Загрузка перезапишет то, что есть: ${reasons.join('; ')}. Подтвердите замену.`,
      errors: [],
      needsConfirm: true,
      reasons,
      current: stateSummary(current.state),
      incoming: stateSummary(parsed.state),
      warnings: parsed.warnings,
    };
  }

  // История ходов относится к заменяемому семестру: снимок «до последнего
  // ответа» оттуда откатил бы свайп к состоянию ДО загрузки (ремонт 9.1.1).
  const md = context(ctx).chatMetadata;
  if (md) delete md[TURNS_KEY];
  await flushState(ctx, parsed.state);
  return { ok: true, state: parsed.state, status: parsed.status, warnings: parsed.warnings, replaced: occupied };
}

// --- настройки ---------------------------------------------------------------

/**
 * Долить умолчания по ключам. Объект правится на месте и возвращается: это тот
 * самый объект, который таверна сериализует, подменять его нельзя.
 *
 * Правила: отсутствующий ключ дописывается; вложенный объект обходится вглубь;
 * значение не того типа, что умолчание, считается испорченным и заменяется;
 * чужие ключи не трогаются вовсе.
 */
export function mergeDefaults(defaults, stored) {
  const out = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  for (const [k, def] of Object.entries(defaults)) {
    if (Array.isArray(def)) {
      if (!Array.isArray(out[k])) out[k] = def.slice();
    } else if (def && typeof def === 'object') {
      out[k] = mergeDefaults(def, out[k]);
    } else if (!(k in out) || out[k] === null || typeof out[k] !== typeof def) {
      out[k] = def;
    }
  }
  return out;
}

/** Настройки расширения с долитыми умолчаниями. Возвращается живой объект настроек. */
export function loadSettings(ctx) {
  const c = context(ctx);
  const all = c.extensionSettings;
  if (!all || typeof all !== 'object') throw new Error('academy/storage: нет extension_settings');
  if (!all[KEY] || typeof all[KEY] !== 'object') all[KEY] = {};
  return mergeDefaults(DEFAULT_SETTINGS, all[KEY]);
}

/**
 * Сохранить настройки. Если передан объект — его ключи доливаются в живой
 * (частичная правка из панели работает как патч), потом дебаунс таверны.
 */
export function saveSettings(settings, ctx) {
  const c = context(looksLikeContext(settings) ? settings : ctx);
  const patch = looksLikeContext(settings) ? ctx : settings;
  const live = loadSettings(c);
  if (patch && patch !== live && typeof patch === 'object') deepAssign(live, patch);
  c.saveSettingsDebounced();
  return live;
}

/** Присвоение вглубь: вложенные объекты сливаются, а не затираются целиком. */
export function deepAssign(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
      deepAssign(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

// --- свои пресеты (9.3.2) ------------------------------------------------------
//
// Хранилище, и только оно: проверка формы — `core/preset.mjs`, выбор и откат —
// `index.js`. Пресет пишется в настройки присвоением, а не через `deepAssign`:
// слияние оставило бы в сохранённом пресете ключи его прошлой версии, и
// «загрузила исправленный файл» не исправляло бы ничего.

/** Карта своих пресетов из живых настроек. Не объект — пусто, а не исключение. */
export function userPresetMap(ctx) {
  const s = loadSettings(ctx);
  if (!s.presets || typeof s.presets !== 'object' || Array.isArray(s.presets)) s.presets = {};
  return s.presets;
}

/** Список своих пресетов для выпадашки: `[{id, name, basedOn}]`, без тел. */
export function listUserPresets(ctx) {
  return Object.entries(userPresetMap(ctx))
    .filter(([, p]) => p && typeof p === 'object')
    .map(([id, p]) => ({ id, name: String(p.displayName || p.name || id), basedOn: String(p.basedOn || '') }));
}

/** Сырой свой пресет или `null`. Нормализация — забота вызывающего. */
export function getUserPreset(ctx, id) {
  const p = userPresetMap(ctx)[String(id || '')];
  return p && typeof p === 'object' ? p : null;
}

/** Положить свой пресет (заменой). `id` — из самого пресета. */
export function putUserPreset(ctx, preset) {
  const c = context(ctx);
  const map = userPresetMap(c);
  map[String(preset.id)] = preset;
  c.saveSettingsDebounced();
  return preset;
}

/** Убрать свой пресет. `true` — был и убран. */
export function removeUserPreset(ctx, id) {
  const c = context(ctx);
  const map = userPresetMap(c);
  const key = String(id || '');
  if (!(key in map)) return false;
  delete map[key];
  c.saveSettingsDebounced();
  return true;
}

/** Настройки API одним куском — то, что уходит в `api.js`. */
export function apiSettings(ctx) {
  const s = loadSettings(ctx);
  return { ...s.api };
}

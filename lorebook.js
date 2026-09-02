// lorebook — слой между планом ядра и живым World Info таверны (3.7).
//
// `core/lorebook.mjs` решает, **что** должно лежать в лорбуке, и про браузер не
// знает вовсе. Этот файл относит его план в таверну и приносит обратно снимок —
// и больше не делает ничего: ни одного правила игры здесь нет.
//
// Шесть решений, из которых вытекает файл.
//
// 1. **Галочка выключена — расширение в World Info не ходит вовсе** (3.7, :476).
//    Не «ходит и ничего не пишет», а не ходит: `syncLorebook` выходит раньше
//    любого обращения к контексту. Человек с собственными лорбуками не должен
//    получать даже лишнего чтения чужого файла.
//
// 2. **Из `getContext()` доступно не всё, что обещал план.** Проверено по
//    исходнику 1.18.0: `st-context.js:276-282` отдаёт `loadWorldInfo`,
//    `saveWorldInfo`, `updateWorldInfoList`, `getWorldInfoNames`, — а вот
//    `createNewWorldInfo` (`world-info.js:4336`) и `createWorldInfoEntry`
//    (`:4057`) наружу не выведены. Обе воспроизводятся здесь через то, что
//    выведено: завести лорбук — это `saveWorldInfo(name, {entries: {}}, true)`
//    плюс `updateWorldInfoList()` (ровно тело `createNewWorldInfo`), завести
//    запись — свободный uid (`getFreeWorldEntryUid`, `:4283`) плюс шаблон полей.
//    Если таверна когда-нибудь выведет их в контекст — они будут использованы
//    вместо самодельных: см. `worldInfo()`.
//
// 3. **Лорбук привязан к чату, не глобальный.** Привязка — `chat_metadata`
//    под ключом `world_info` (`world-info.js:94`), и её достаточно: `getChatLore`
//    (`:4432`) читает лорбук чата прямо по этому ключу, наличие имени в
//    `world_names` ему не нужно. Уже привязанный к чату лорбук мы не подменяем —
//    пишем в него: чат-лорбук у чата один, и отобрать его у человека хуже, чем
//    сложить записи рядом с его собственными.
//
// 4. **Отпечаток лежит в своём поле записи, а не в `comment`.** Автор ядра
//    рассчитывал на `comment`, но по исходнику это заголовок записи, который
//    видно человеку в редакторе (`world-info.js:3303`, предпросмотр — `:3974`),
//    и который таверна умеет заполнять сама из ключей (кнопка «backfill memos»,
//    `:2482`). Хеш там — мусор на виду, который первым же делом сотрут, после
//    чего все записи разом станут «правлеными руками». Поэтому в `comment` идёт
//    человеческий заголовок, а служебное — в собственное поле `academy`:
//    файл лорбука пишется на диск как есть (`src/endpoints/worldinfo.js:154`
//    сериализует `request.body.data` целиком), редактор таверны правит объект
//    записи на месте и чужих полей не сбрасывает.
//
// 5. **Предложения сами в лорбук не попадают.** `suggest` из ядра — это то, что
//    расширение «может только предложить, а не сочинить само» (3.7, :458).
//    `syncLorebook` их не пишет никогда; в лорбук они уходят единственным путём —
//    `acceptSuggestion`, то есть по решению человека.
//
// 6. **Чужого мы не удаляем, а осиротевшее своё — только по кнопке.** Свайп или
//    удаление сообщения откатывают состояние, и запись хроники, которой в новом
//    состоянии нет, остаётся в лорбуке. Молча стирать записи расширение не будет
//    (3.7: «видно, правится и удаляется средствами таверны»), поэтому такие
//    записи только называются вслух — `orphans`, — а сносит их `pruneOrphans`,
//    и только по явному действию.

import { buildEntries, buildLorebook, fingerprint, KEEP_FOREIGN } from './core/lorebook.mjs';
import { DEFAULT_SETTINGS } from './storage.js';

/** Тот же отпечаток, что у ядра: ре-экспорт, чтобы не разъехались две реализации. */
export { fingerprint };

/** Ключ привязки лорбука к чату — `world-info.js:94`. */
export const METADATA_KEY = 'world_info';

/** Имя собственного поля в записи World Info. Всё служебное — только внутри него. */
export const MARK = 'academy';

/** Версия формата метки: пригодится, когда содержимое `MARK` придётся менять. */
export const MARK_VERSION = 1;

/**
 * Умолчания настроек лорбука.
 *
 * Настоящее место этого блока — `storage.DEFAULT_SETTINGS`, там он теперь и
 * лежит: доливка умолчаний, запись в `extension_settings` и галочка в панели
 * ходят через один список, а не через два. Здесь остался ре-экспорт, потому что
 * `settingsOf` ниже — единственный читатель этих настроек, и держать его на
 * своей копии значило бы завести вторую правду об `enabled: false` (3.7,
 * `:476-477`) — ровно тот шов, из-за которого умолчание однажды и разъедется.
 */
export const DEFAULT_LOREBOOK_SETTINGS = DEFAULT_SETTINGS.lorebook;

/**
 * Шаблон записи World Info — копия `newWorldInfoEntryTemplate`
 * (`world-info.js:4000-4047`) на случай, если таверна не отдала
 * `createWorldInfoEntry` в контекст (а она не отдаёт, см. решение 2).
 *
 * Копия — плохо, и это осознанно: альтернатива — импорт
 * `../../../world-info.js`, который привязывает расширение к раскладке файлов
 * таверны и ломается вне браузера, то есть в прогоне. Поля здесь только те, что
 * есть в шаблоне; разъедется — запись всё равно откроется в редакторе, потому
 * что недостающие поля таверна читает через `?? default`.
 */
export const ENTRY_TEMPLATE = {
  key: [],
  keysecondary: [],
  comment: '',
  content: '',
  constant: false,
  vectorized: false,
  selective: true,
  selectiveLogic: 0,
  addMemo: false,
  order: 100,
  position: 0,
  disable: false,
  ignoreBudget: false,
  excludeRecursion: false,
  preventRecursion: false,
  matchPersonaDescription: false,
  matchCharacterDescription: false,
  matchCharacterPersonality: false,
  matchCharacterDepthPrompt: false,
  matchScenario: false,
  matchCreatorNotes: false,
  delayUntilRecursion: 0,
  probability: 100,
  useProbability: true,
  depth: 4,
  outletName: '',
  group: '',
  groupOverride: false,
  groupWeight: 100,
  scanDepth: null,
  caseSensitive: null,
  matchWholeWords: null,
  useGroupScoring: null,
  automationId: '',
  role: 0,
  sticky: null,
  cooldown: null,
  delay: null,
  triggers: [],
};

// --- настройки ---------------------------------------------------------------

/** Настройки лорбука с долитыми умолчаниями. На вход — весь объект настроек. */
export function settingsOf(settings) {
  const raw = (settings && typeof settings === 'object' && settings.lorebook) || {};
  const def = DEFAULT_LOREBOOK_SETTINGS;
  // Строгая проверка `=== true`, а не «истинное значение»: сюда приезжает то,
  // что лежит в `settings.json`, и строка «false» оттуда включила бы лорбук.
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : def.enabled === true,
    book: typeof raw.book === 'string' ? raw.book.trim() : def.book,
  };
}

// --- доступ к World Info -----------------------------------------------------

/**
 * Функции World Info из контекста таверны — либо `null`.
 *
 * `null` значит «сборка старая, World Info из контекста не достать». Это не
 * авария: расширение обязано остаться живым, просто без лорбука (в 1.18.0 сам
 * лорбук в `getContext()` появился не с первого дня, а чужие сборки бывают
 * какие угодно).
 */
export function worldInfo(ctx) {
  if (!ctx || typeof ctx.loadWorldInfo !== 'function' || typeof ctx.saveWorldInfo !== 'function') {
    return null;
  }
  return {
    load: (name) => ctx.loadWorldInfo(name),
    save: (name, data, immediately) => ctx.saveWorldInfo(name, data, Boolean(immediately)),
    /** Не во всех сборках есть; без него мы просто не обновим выпадашку редактора. */
    refresh: typeof ctx.updateWorldInfoList === 'function' ? () => ctx.updateWorldInfoList() : null,
    names: typeof ctx.getWorldInfoNames === 'function' ? () => ctx.getWorldInfoNames() || [] : () => [],
    /** Если таверна когда-нибудь выведет их наружу — берём таверные, не свои. */
    createEntry: typeof ctx.createWorldInfoEntry === 'function' ? ctx.createWorldInfoEntry : null,
  };
}

/**
 * Имя лорбука для этого чата.
 *
 * Приоритет: уже привязанный к чату → заданный в настройках → по имени чата.
 * Отсев символов — тот же, которым таверна зовёт чат-лорбук из слэш-команды
 * (`world-info.js:1178`): имя уезжает в имя файла, и хотя сервер санирует его
 * сам (`src/endpoints/worldinfo.js:151`), расходиться с таверной в том, как
 * называется один и тот же лорбук, нельзя.
 */
export function bookName(ctx, s = {}) {
  const md = (ctx && ctx.chatMetadata) || {};
  const bound = typeof md[METADATA_KEY] === 'string' ? md[METADATA_KEY].trim() : '';
  if (bound) return bound;
  if (s.book) return s.book;
  const chatId = ctx && typeof ctx.getCurrentChatId === 'function' ? ctx.getCurrentChatId() : '';
  if (!chatId) return '';
  return `Academy ${chatId}`.replace(/[^a-z0-9 -]/gi, '_').replace(/_{2,}/g, '_').substring(0, 64);
}

// --- снимок ------------------------------------------------------------------

/**
 * Живой World Info → снимок в форме, которую понимает ядро (`SnapshotEntry`).
 *
 * В снимок идут **все** записи лорбука, а не только наши: потолок числа записей
 * (риски, :598) меряет лорбук целиком, и чужие записи занимают в нём место
 * ровно так же. Чужие получают синтетический uid `foreign:<n>` — по нему ядро
 * их не спутает с нашими и отправит в `keep` как есть.
 *
 * @returns {{snapshot: Array, index: Map<string, number>, marks: Map<string, Object>}}
 */
export function snapshotOf(data) {
  const snapshot = [];
  const index = new Map();
  const marks = new Map();

  for (const [key, raw] of Object.entries((data && data.entries) || {})) {
    if (!raw || typeof raw !== 'object') continue;
    const wiUid = Number.isFinite(Number(raw.uid)) ? Number(raw.uid) : Number(key);
    const mark = raw[MARK];
    const mine = mark && typeof mark === 'object' && typeof mark.uid === 'string' ? mark : null;
    const uid = mine ? mine.uid : `foreign:${wiUid}`;

    index.set(uid, wiUid);
    if (mine) marks.set(uid, mine);
    snapshot.push({
      uid,
      content: String(raw.content || ''),
      // У чужой записи отпечатка нет — и правильно: ядро считает записи без
      // отпечатка нетронутыми, а тронуть чужую нам всё равно нечем (её uid не
      // порождается ядром, значит она всегда уходит в `keep`).
      ...(mine && mine.fingerprint ? { fingerprint: String(mine.fingerprint) } : {}),
    });
  }

  return { snapshot, index, marks };
}

/** Свободный uid записи — то же, что `getFreeWorldEntryUid` (`world-info.js:4283`). */
export function freeUid(data) {
  const entries = (data && data.entries) || {};
  for (let uid = 0; uid < 1000000; uid += 1) {
    if (!(uid in entries)) return uid;
  }
  return null;
}

/**
 * Положить запись плана в объект лорбука. Возвращает номер записи World Info.
 *
 * Правится ровно то, что описывает план: ключи, заголовок, текст, постоянность и
 * порядок. Всё остальное — глубина, вероятность, группы, фильтры по персонажам —
 * остаётся тем, что стоит в записи: человек мог это настроить, и переписывать
 * его настройки на каждом обновлении текста мы не будем.
 */
export function writeEntry(data, entry, wiUid = null, wi = null) {
  if (!data.entries) data.entries = {};
  let target = wiUid !== null && wiUid !== undefined ? data.entries[wiUid] : null;

  if (!target) {
    if (wi && wi.createEntry) {
      target = wi.createEntry(null, data);
      if (!target) return null;
    } else {
      const uid = freeUid(data);
      if (uid === null) return null;
      target = { uid, ...structuredClone(ENTRY_TEMPLATE) };
      data.entries[uid] = target;
    }
  }

  target.key = [...entry.keys];
  target.content = entry.content;
  target.constant = Boolean(entry.constant);
  target.order = entry.order;
  // Заголовок записи. Он на виду в редакторе, поэтому в нём человеческое: метка
  // расширения (чтобы было видно, чьё) и первый ключ. Пустым его не оставляем —
  // иначе таверна однажды заполнит его сама (`world-info.js:2482`).
  target.comment = `[${MARK}] ${entry.keys[0] || entry.uid}`;
  target[MARK] = {
    v: MARK_VERSION,
    uid: entry.uid,
    fingerprint: entry.fingerprint,
    origin: entry.origin || 'own',
  };

  return target.uid;
}

// --- сторож лишней работы ----------------------------------------------------

/**
 * Дешёвый отпечаток того, чем лорбук должен быть.
 *
 * Считается из состояния, без единого обращения к таверне. Если он не изменился
 * с прошлой синхронизации — в World Info можно не ходить вовсе: ни читать файл,
 * ни сохранять. Именно это и делает обновление лорбука «после каждого ответа»
 * дешёвым: в обычном ответе, где никто не сдавал экзамен и не менял отношение,
 * работы ровно на одну склейку строк.
 */
export function planSignature(state, preset) {
  if (!state || !state.started) return '';
  const entries = buildEntries(state, preset);
  return entries.map((e) => `${e.uid}:${e.fingerprint}`).join('|');
}

// --- синхронизация -----------------------------------------------------------

/**
 * Отнести план ядра в лорбук чата.
 *
 * @param {Object} ctx контекст таверны
 * @param {Object} state состояние семестра
 * @param {Object} preset
 * @param {Object} [opts]
 * @param {Object} [opts.settings] настройки расширения целиком
 * @param {Array}  [opts.npcs]   замеченные NPC — уйдут в `suggest`, не в лорбук
 * @param {Array}  [opts.places] замеченные места — туда же
 * @param {boolean} [opts.immediately] сохранять немедленно, а не дебаунсом
 * @returns {Promise<Object>} отчёт: `{ok, reason, name, created, wrote, plan, orphans}`
 */
export async function syncLorebook(ctx, state, preset, opts = {}) {
  const s = settingsOf(opts.settings);
  // Выключенная галочка — выход до единого обращения к World Info (решение 1).
  if (!s.enabled) return { ok: false, reason: 'off' };
  if (!state || !state.started) return { ok: false, reason: 'no-state' };

  const wi = worldInfo(ctx);
  if (!wi) return { ok: false, reason: 'no-world-info' };

  const book = await ensureBook(ctx, wi, s);
  if (!book.name) return { ok: false, reason: 'no-chat' };

  const data = normalizeBook(await wi.load(book.name));
  const { snapshot, index, marks } = snapshotOf(data);
  const plan = buildLorebook(state, preset, { ...opts, snapshot });

  let wrote = 0;
  for (const entry of [...plan.create, ...plan.update]) {
    const at = writeEntry(data, entry, index.has(entry.uid) ? index.get(entry.uid) : null, wi);
    if (at !== null) wrote += 1;
  }

  // Ни одной правки — ни одного сохранения. Лишняя запись на диск это ещё и
  // лишний запрос к серверу таверны, а обновление лорбука зовётся часто.
  if (wrote > 0) await wi.save(book.name, data, opts.immediately || book.created);

  return {
    ok: true,
    name: book.name,
    created: book.created,
    wrote,
    plan,
    orphans: orphansOf(plan, marks),
    measure: plan.measure,
  };
}

/**
 * Принять предложенную запись. Единственный путь, которым `suggest` попадает в
 * лорбук, и зовётся он только из действия человека (решение 5).
 */
export async function acceptSuggestion(ctx, entry, opts = {}) {
  const s = settingsOf(opts.settings);
  if (!s.enabled) return { ok: false, reason: 'off' };
  if (!entry || !entry.uid) return { ok: false, reason: 'no-entry' };

  const wi = worldInfo(ctx);
  if (!wi) return { ok: false, reason: 'no-world-info' };

  const book = await ensureBook(ctx, wi, s);
  if (!book.name) return { ok: false, reason: 'no-chat' };

  const data = normalizeBook(await wi.load(book.name));
  const { index } = snapshotOf(data);
  const at = writeEntry(data, entry, index.has(entry.uid) ? index.get(entry.uid) : null, wi);
  if (at === null) return { ok: false, reason: 'no-uid' };

  // Немедленно: это нажатие кнопки, и отложить его на дебаунс значит потерять
  // запись, если вкладку закроют сразу после нажатия.
  await wi.save(book.name, data, true);
  return { ok: true, name: book.name, uid: entry.uid };
}

/**
 * Снести осиротевшие записи — свои, никем не тронутые, которых в нынешнем
 * состоянии больше нет. Только по явному действию (решение 6). Чужие записи и
 * принятые предложения не трогаются никогда.
 */
export async function pruneOrphans(ctx, orphans, opts = {}) {
  const s = settingsOf(opts.settings);
  if (!s.enabled) return { ok: false, reason: 'off' };
  const wi = worldInfo(ctx);
  if (!wi) return { ok: false, reason: 'no-world-info' };

  const name = bookName(ctx, s);
  if (!name) return { ok: false, reason: 'no-chat' };

  const data = normalizeBook(await wi.load(name));
  const { index, marks } = snapshotOf(data);
  let removed = 0;

  for (const uid of (orphans || []).map((o) => (typeof o === 'string' ? o : o.uid))) {
    const mark = marks.get(uid);
    // Ещё раз, уже перед самим удалением: наша, не предложенная, не правленая.
    if (!mark || mark.origin === 'suggested') continue;
    const at = index.get(uid);
    if (at === undefined || !data.entries[at]) continue;
    if (mark.fingerprint && fingerprint(data.entries[at].content) !== String(mark.fingerprint)) continue;
    delete data.entries[at];
    removed += 1;
  }

  if (removed > 0) await wi.save(name, data, true);
  return { ok: true, name, removed };
}

// --- мелочи ------------------------------------------------------------------

/**
 * Лорбук чата: привязанный — используется, отсутствующий — заводится.
 *
 * Заведение — это ровно тело `createNewWorldInfo` (`world-info.js:4336-4360`)
 * без диалога подтверждения: пустой `{entries: {}}`, немедленное сохранение,
 * обновление списка имён. Диалог здесь не нужен и вреден — существующий файл мы
 * не перезаписываем вовсе, а привязываем.
 */
async function ensureBook(ctx, wi, s) {
  const md = ctx && ctx.chatMetadata;
  const name = bookName(ctx, s);
  if (!name) return { name: '', created: false };

  const bound = md && typeof md[METADATA_KEY] === 'string' && md[METADATA_KEY].trim();
  if (bound) return { name, created: false };

  // Лорбук с таким именем уже есть — значит это наш прошлый (или чей-то с тем
  // же именем). Перезаписать его пустым было бы разрушением: только привязываем.
  const exists = wi.names().includes(name);
  if (!exists) {
    await wi.save(name, { entries: {} }, true);
    if (wi.refresh) await wi.refresh();
  }

  if (md) md[METADATA_KEY] = name;
  // Привязка сохраняется немедленно: она нужна таверне уже на ближайшей
  // генерации, а дебаунс её туда не донесёт, если вкладку закроют.
  if (typeof ctx.saveMetadata === 'function') await ctx.saveMetadata();
  else if (typeof ctx.saveMetadataDebounced === 'function') ctx.saveMetadataDebounced();

  return { name, created: !exists };
}

/** Чужой объект лорбука бывает каким угодно; дальше по коду `entries` обязателен. */
function normalizeBook(data) {
  if (!data || typeof data !== 'object') return { entries: {} };
  if (!data.entries || typeof data.entries !== 'object') return { ...data, entries: {} };
  return data;
}

/**
 * Осиротевшее своё: ядро больше не порождает такой записи, а метка на ней наша.
 * Принятые предложения сюда не попадают — ядро их и не порождало никогда, они
 * живут в лорбуке по решению человека.
 */
function orphansOf(plan, marks) {
  return (plan.keep || [])
    .filter((k) => k.reason === KEEP_FOREIGN)
    .map((k) => ({ uid: k.uid, mark: marks.get(k.uid) }))
    .filter((o) => o.mark && o.mark.origin !== 'suggested')
    .map((o) => ({ uid: o.uid }));
}

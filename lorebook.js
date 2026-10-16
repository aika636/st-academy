import { buildEntries, buildLorebook, acceptedSpellings, fingerprint, isHandEdited, keysEdited, KEEP_FOREIGN, KEEP_UNCHANGED, classmateUid } from './core/lorebook.mjs';
import { DEFAULT_SETTINGS } from './storage.js';

export { fingerprint };

export const METADATA_KEY = 'world_info';

export const MARK = 'academy';

export const MARK_VERSION = 2;

const TRANSIENT_PREFIXES = ['academy:rumor:', 'academy:chronicle:', 'academy:case:deal:'];

export const META_KEY = 'academy_lore';

export const COPY_SUFFIX = ' (резервная копия)';

export const CHAT_CHANGED = 'chat-changed';

function stillHere(opts) {
  if (!opts || typeof opts.guard !== 'function') return true;
  try {
    return opts.guard() !== false;
  } catch {
    return false;
  }
}

function stillChat(opts) {
  return opts && typeof opts.chatGuard === 'function' ? stillHere({ guard: opts.chatGuard }) : stillHere(opts);
}

export const DEFAULT_LOREBOOK_SETTINGS = DEFAULT_SETTINGS.lorebook;

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

export function settingsOf(settings) {
  const raw = (settings && typeof settings === 'object' && settings.lorebook) || {};
  const def = DEFAULT_LOREBOOK_SETTINGS;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : def.enabled === true,
    book: typeof raw.book === 'string' ? raw.book.trim() : def.book,
  };
}

export function worldInfo(ctx) {
  if (!ctx || typeof ctx.loadWorldInfo !== 'function' || typeof ctx.saveWorldInfo !== 'function') {
    return null;
  }
  return {
    load: (name) => ctx.loadWorldInfo(name),
    save: (name, data, immediately) => ctx.saveWorldInfo(name, data, Boolean(immediately)),
    refresh: typeof ctx.updateWorldInfoList === 'function' ? () => ctx.updateWorldInfoList() : null,
    names: typeof ctx.getWorldInfoNames === 'function' ? () => ctx.getWorldInfoNames() || [] : () => [],
    createEntry: typeof ctx.createWorldInfoEntry === 'function' ? ctx.createWorldInfoEntry : null,
  };
}

export function bookName(ctx, s = {}) {
  const md = (ctx && ctx.chatMetadata) || {};
  const bound = typeof md[METADATA_KEY] === 'string' ? md[METADATA_KEY].trim() : '';
  if (bound) return bound;
  if (s.book) return s.book;
  const chatId = ctx && typeof ctx.getCurrentChatId === 'function' ? ctx.getCurrentChatId() : '';
  if (!chatId) return '';
  let names = [];
  try {
    names = typeof ctx.getWorldInfoNames === 'function' ? (ctx.getWorldInfoNames() || []) : [];
  } catch { names = []; }
  const legacy = legacyBookName(chatId);
  if (names.includes(legacy)) return legacy;
  const base = freshBookName(ctx, chatId);
  let name = base;
  for (let n = 2; names.includes(name) && n < 100; n += 1) name = `${base} ${n}`;
  return name;
}

export const BOOK_OWNER_KEY = 'academy_chat';

function freshBookName(ctx, chatId) {
  return cleanBookName(`${BOOK_PREFIX}${chatTitle(ctx, chatId)}`).substring(0, 60).trim();
}

async function claimBookName(ctx, wi, s) {
  const name = bookName(ctx, s);
  const md = (ctx && ctx.chatMetadata) || {};
  const chatId = ctx && typeof ctx.getCurrentChatId === 'function' ? ctx.getCurrentChatId() : '';
  const names = wi.names();
  const fixed = (typeof md[METADATA_KEY] === 'string' && md[METADATA_KEY].trim()) || s.book
    || names.includes(legacyBookName(chatId));
  if (fixed || !chatId) return { name, exists: names.includes(name) };
  const base = freshBookName(ctx, chatId);
  for (let n = 1; n < 100; n += 1) {
    const candidate = n === 1 ? base : `${base} ${n}`;
    if (!names.includes(candidate)) return { name: candidate, exists: false };
    let data = null;
    try {
      data = await wi.load(candidate);
    } catch { data = null; }
    if (data && data[BOOK_OWNER_KEY] === chatId) return { name: candidate, exists: true };
  }
  return { name, exists: names.includes(name) };
}

export const BOOK_PREFIX = 'Академия — ';

export function legacyBookName(chatId) {
  return cleanBookName(`Academy ${chatId}`).substring(0, 64);
}

function cleanBookName(raw) {
  return String(raw).replace(/[^\p{L}\p{N} —-]/gu, '_').replace(/_{2,}/g, '_');
}

const CHAT_STAMP = /\s*-\s*\d{4}-\d{1,2}-\d{1,2}\s*[@_ ]\s*\d{1,2}h\s*\d{1,2}m(?:\s*\d{1,2}s)?(?:\s*\d{1,3}ms)?\s*$/iu;

function chatTitle(ctx, chatId) {
  const bare = String(chatId).replace(CHAT_STAMP, '').trim();
  if (bare) return bare;
  const card = ctx && typeof ctx.name2 === 'string' ? ctx.name2.trim() : '';
  return card || String(chatId);
}

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
      ...(mine && mine.fingerprint ? { fingerprint: String(mine.fingerprint) } : {}),
      ...(Array.isArray(raw.key) ? { keys: raw.key.map(String) } : {}),
      ...(mine && mine.keys ? { keysMark: String(mine.keys) } : {}),
    });
  }

  return { snapshot, index, marks };
}

export function freeUid(data) {
  const entries = (data && data.entries) || {};
  for (let uid = 0; uid < 1000000; uid += 1) {
    if (!(uid in entries)) return uid;
  }
  return null;
}

export function writeEntry(data, entry, wiUid = null, wi = null, mark = null, opts = {}) {
  if (!data.entries) data.entries = {};
  let target = wiUid !== null && wiUid !== undefined ? data.entries[wiUid] : null;
  const fresh = !target;

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

  const keptKeys = Boolean(mark) && keysEdited({ keys: target.key, keysMark: mark.keys });
  if (!keptKeys) target.key = [...entry.keys];
  target.content = entry.content;
  target.constant = Boolean(entry.constant);
  target.order = entry.order;
  if (fresh || (mark && mark.v !== MARK_VERSION)) {
    target.position = entry.constant ? WI_BEFORE : WI_AT_DEPTH;
    target.depth = entry.constant ? 4 : 3;
    target.role = 0;
    target.selective = false;
    target.excludeRecursion = Boolean(entry.quiet);
    target.preventRecursion = Boolean(entry.quiet);
  }
  const title = commentFor(entry, opts.own);
  const renamed = Boolean(mark) && renamedByHand(target.comment, mark);
  if (!renamed) target.comment = title;
  target[MARK] = {
    v: MARK_VERSION,
    uid: entry.uid,
    fingerprint: entry.fingerprint,
    src: entry.src || entry.fingerprint,
    lang: entry.lang || 'ru',
    keys: keptKeys ? String(mark.keys) : fingerprint(entry.keys.join('\n')),
    origin: entry.origin || 'own',
    comment: renamed ? String(mark.comment || '') : title,
  };

  return target.uid;
}

function commentFor(entry, own) {
  const title = entry.title || entry.keys[0] || entry.uid;
  return own ? title : `[${MARK}] ${title}`;
}

function renamedByHand(comment, mark) {
  if (typeof mark.comment === 'string') return String(comment) !== mark.comment;
  return !String(comment).startsWith(`[${MARK}] `);
}

export function isOwnBook(name, data) {
  return Boolean(data && typeof data[BOOK_OWNER_KEY] === 'string' && data[BOOK_OWNER_KEY])
    || String(name || '').startsWith(BOOK_PREFIX) || String(name || '').startsWith('Academy ');
}

export const WI_BEFORE = 0;
export const WI_AT_DEPTH = 4;

export function planSignature(state, preset, opts = {}) {
  if (!state || !state.started) return '';
  const cache = opts.cache || {};
  const entries = buildEntries(state, preset, opts);
  return entries.map((e) => `${e.uid}:${e.fingerprint}:${cache[e.uid] && cache[e.uid].src === e.fingerprint ? 't' : ''}:${fingerprint(e.keys.join('\n'))}`).join('|');
}

export function loreMeta(ctx) {
  const md = ctx && ctx.chatMetadata;
  if (!md || typeof md !== 'object') return { en: {}, copy: '' };
  const m = md[META_KEY] && typeof md[META_KEY] === 'object' ? md[META_KEY] : (md[META_KEY] = {});
  if (!m.en || typeof m.en !== 'object') m.en = {};
  if (typeof m.copy !== 'string') m.copy = '';
  return m;
}

function saveMeta(ctx) {
  if (typeof ctx.saveMetadataDebounced === 'function') ctx.saveMetadataDebounced();
  else if (typeof ctx.saveMetadata === 'function') ctx.saveMetadata();
}

export async function syncLorebook(ctx, state, preset, opts = {}) {
  const s = settingsOf(opts.settings);
  if (!s.enabled) return { ok: false, reason: 'off' };
  if (!state || !state.started) return { ok: false, reason: 'no-state' };
  if (!stillHere(opts)) return { ok: false, reason: CHAT_CHANGED };

  const wi = worldInfo(ctx);
  if (!wi) return { ok: false, reason: 'no-world-info' };

  const book = await ensureBook(ctx, wi, s, opts);
  if (book.changed) return { ok: false, reason: CHAT_CHANGED };
  if (!book.name) return { ok: false, reason: 'no-chat' };

  const data = normalizeBook(await wi.load(book.name));
  if (!stillHere(opts)) return { ok: false, reason: CHAT_CHANGED };
  const { snapshot, index, marks } = snapshotOf(data);
  const meta = loreMeta(ctx);

  const tr = await translatePending(state, preset, snapshot, meta, opts);
  if (!stillChat(opts)) return { ok: false, reason: CHAT_CHANGED };
  if (tr.changed) saveMeta(ctx);
  if (!stillHere(opts)) return { ok: false, reason: CHAT_CHANGED };

  const plan = buildLorebook(state, preset, { ...opts, snapshot, cache: meta.en });

  const present = new Set([...(state.teachers || []).map((t) => `academy:teacher:${t.id}`), ...(state.classmates || []).map((c) => classmateUid(c.id))]);
  const legacy = orphansOf(plan, marks).filter((o) => {
    const mark = marks.get(o.uid);
    const raw = data.entries[index.get(o.uid)];
    const stale = mark.v !== MARK_VERSION || TRANSIENT_PREFIXES.some((p) => String(o.uid).startsWith(p)) || present.has(o.uid);
    return stale && raw && !(mark.fingerprint && fingerprint(raw.content) !== String(mark.fingerprint));
  });
  const evicted = plan.evict.filter((o) => index.has(o.uid));
  const touches = plan.create.length + plan.update.length + legacy.length + evicted.length > 0;
  const old = [...marks.values()].some((m) => m.origin !== 'suggested' && m.v !== MARK_VERSION);
  let backup = '';
  if (touches && old && !meta.copy) backup = await backupBook(ctx, wi, book.name, data, opts);
  if (touches && old && !meta.copy && !backup) return { ok: false, reason: CHAT_CHANGED };
  if (backup) {
    meta.copy = backup;
    saveMeta(ctx);
  }

  if (!stillHere(opts)) return { ok: false, reason: CHAT_CHANGED };

  let wrote = 0;
  const own = isOwnBook(book.name, data);
  const changes = [];
  for (const entry of [...plan.create, ...plan.update]) {
    const uid = entry.uid;
    const had = index.has(uid);
    const at = writeEntry(data, entry, had ? index.get(uid) : null, wi, marks.get(uid) || null, { own });
    if (at === null) continue;
    wrote += 1;
    changes.push({ kind: had ? 'updated' : 'added', title: entry.title || entry.keys[0] || uid });
  }
  const migrated = new Set();
  for (const o of [...legacy, ...evicted]) {
    const raw = data.entries[index.get(o.uid)];
    changes.push({ kind: 'removed', title: (raw && raw.comment) || o.uid });
    delete data.entries[index.get(o.uid)];
    migrated.add(o.uid);
  }

  const renamed = own ? renameQuietly(data, plan, index, marks) : 0;
  if (wrote > 0 || migrated.size || renamed) await wi.save(book.name, data, opts.immediately || book.created);

  return {
    ok: true,
    name: book.name,
    created: book.created,
    wrote,
    changes,
    plan,
    orphans: orphansOf(plan, marks).filter((o) => !migrated.has(o.uid)),
    measure: plan.measure,
    translated: tr.done,
    untranslated: tr.failed,
    migrated: migrated.size,
    backup: meta.copy,
  };
}

function renameQuietly(data, plan, index, marks) {
  let n = 0;
  for (const k of plan.keep) {
    if (k.reason !== KEEP_UNCHANGED) continue;
    const raw = data.entries[index.get(k.uid)];
    const mark = marks.get(k.uid);
    if (!raw || !mark || typeof mark.comment === 'string' || renamedByHand(raw.comment, mark)) continue;
    raw.comment = String(raw.comment).slice(`[${MARK}] `.length);
    mark.comment = raw.comment;
    n += 1;
  }
  return n;
}

async function translatePending(state, preset, snapshot, meta, opts) {
  const none = { done: 0, failed: 0, changed: false };
  if (typeof opts.translate !== 'function') return none;
  const entries = buildEntries(state, preset, opts);
  const live = new Set(entries.map((e) => e.uid));
  let changed = false;
  for (const uid of Object.keys(meta.en)) {
    if (!live.has(uid)) { delete meta.en[uid]; changed = true; }
  }
  const edited = new Set(snapshot.filter((x) => isHandEdited(x)).map((x) => x.uid));
  const pending = entries.filter((e) => e.lang !== 'en' && !edited.has(e.uid) && !(meta.en[e.uid] && meta.en[e.uid].src === e.fingerprint));
  if (!pending.length) return { ...none, changed };
  const items = pending.map((e) => ({
    id: e.uid,
    kind: e.kind,
    name: e.spec.name || e.title,
    aliases: e.spec.aliases || [],
    text: e.tail ? e.content.slice(0, e.content.length - e.tail.length).trim() : e.content,
    wantKeys: e.spec.type === 'person' || e.spec.type === 'event',
  }));
  let res;
  try {
    res = await opts.translate(items, { spellings: acceptedSpellings(state, meta.en) });
  } catch {
    res = null;
  }
  if (!stillChat(opts)) return { ...none, changed };
  const results = res && res.results instanceof Map ? res.results : new Map();
  for (const e of pending) {
    const got = results.get(e.uid);
    if (!got || !got.en) continue;
    meta.en[e.uid] = { src: e.fingerprint, en: e.tail ? `${got.en}\n${e.tail}` : got.en, ...(got.hints ? { hints: got.hints } : {}) };
    changed = true;
  }
  return { done: results.size, failed: pending.length - results.size, changed };
}

async function backupBook(ctx, wi, name, data, opts) {
  const copy = `${name}${COPY_SUFFIX}`;
  if (!wi.names().includes(copy)) {
    const clone = structuredClone(data);
    delete clone[BOOK_OWNER_KEY];
    if (!stillHere(opts)) return '';
    await wi.save(copy, clone, true);
    if (wi.refresh) await wi.refresh();
  }
  return stillHere(opts) ? copy : '';
}

export async function acceptSuggestion(ctx, entry, opts = {}) {
  const s = settingsOf(opts.settings);
  if (!s.enabled) return { ok: false, reason: 'off' };
  if (!entry || !entry.uid) return { ok: false, reason: 'no-entry' };

  if (!stillHere(opts)) return { ok: false, reason: CHAT_CHANGED };
  const wi = worldInfo(ctx);
  if (!wi) return { ok: false, reason: 'no-world-info' };

  const book = await ensureBook(ctx, wi, s, opts);
  if (book.changed) return { ok: false, reason: CHAT_CHANGED };
  if (!book.name) return { ok: false, reason: 'no-chat' };

  const data = normalizeBook(await wi.load(book.name));
  if (!stillHere(opts)) return { ok: false, reason: CHAT_CHANGED };
  const { index } = snapshotOf(data);
  const at = writeEntry(data, entry, index.has(entry.uid) ? index.get(entry.uid) : null, wi);
  if (at === null) return { ok: false, reason: 'no-uid' };

  await wi.save(book.name, data, true);
  return { ok: true, name: book.name, uid: entry.uid };
}

export async function pruneOrphans(ctx, orphans, opts = {}) {
  const s = settingsOf(opts.settings);
  if (!s.enabled) return { ok: false, reason: 'off' };
  if (!stillHere(opts)) return { ok: false, reason: CHAT_CHANGED };
  const wi = worldInfo(ctx);
  if (!wi) return { ok: false, reason: 'no-world-info' };

  const name = bookName(ctx, s);
  if (!name) return { ok: false, reason: 'no-chat' };

  const data = normalizeBook(await wi.load(name));
  if (!stillHere(opts)) return { ok: false, reason: CHAT_CHANGED };
  const { index, marks } = snapshotOf(data);
  let removed = 0;

  for (const uid of (orphans || []).map((o) => (typeof o === 'string' ? o : o.uid))) {
    const mark = marks.get(uid);
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

export async function forgetClassmate(ctx, id, opts = {}) {
  if (!id) return { ok: false, reason: 'no-entry' };
  return pruneOrphans(ctx, [classmateUid(id)], opts);
}

async function ensureBook(ctx, wi, s, opts = {}) {
  const md = ctx && ctx.chatMetadata;
  if (!bookName(ctx, s)) return { name: '', created: false };

  const bound = md && typeof md[METADATA_KEY] === 'string' && md[METADATA_KEY].trim();
  if (bound) return { name: bound, created: false };

  const { name, exists } = await claimBookName(ctx, wi, s);
  if (!stillHere(opts)) return { name, created: false, changed: true };
  if (!exists) {
    const chatId = typeof ctx.getCurrentChatId === 'function' ? ctx.getCurrentChatId() : '';
    await wi.save(name, { entries: {}, ...(chatId ? { [BOOK_OWNER_KEY]: chatId } : {}) }, true);
    if (wi.refresh) await wi.refresh();
  }

  if (!stillHere(opts)) return { name, created: !exists, changed: true };
  if (md) md[METADATA_KEY] = name;
  if (typeof ctx.saveMetadata === 'function') await ctx.saveMetadata();
  else if (typeof ctx.saveMetadataDebounced === 'function') ctx.saveMetadataDebounced();

  return { name, created: !exists };
}

function normalizeBook(data) {
  if (!data || typeof data !== 'object') return { entries: {} };
  if (!data.entries || typeof data.entries !== 'object') return { ...data, entries: {} };
  return data;
}

function orphansOf(plan, marks) {
  return (plan.keep || [])
    .filter((k) => k.reason === KEEP_FOREIGN)
    .map((k) => ({ uid: k.uid, mark: marks.get(k.uid) }))
    .filter((o) => o.mark && o.mark.origin !== 'suggested')
    .map((o) => ({ uid: o.uid }));
}

export async function loadBook(ctx, name) {
  const wi = worldInfo(ctx);
  if (!wi || !name) return { entries: {} };
  return normalizeBook(await wi.load(name));
}

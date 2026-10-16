import { diffDays } from './time.mjs';

export const FEED_MAX = 120;

export const DEALS_MAX = 40;

export const DEAL_DAYS = 14;

function dealAlive(state, d) {
  const today = state && state.calendar && state.calendar.day;
  const day = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (!d.open || !day(d.since) || !day(today)) return d.open;
  return diffDays(d.since, today) < DEAL_DAYS;
}

export const SEEN_MAX = 40;

export const REACTION_CAP = 6;

export const CAP_BOUNDS = [1, 12];

export const CHANNELS = ['chat', 'anon'];

export const STATUSES = ['new', 'taken', 'played', 'expired'];

export const FEED_TEXT_MAX = 200;

export const NICK_MAX = 32;

export const REACT_SETS = {
  chat: ['😂', '👍', '🙄', '❤️'],
  drama: ['😱', '🍿', '😂', '👀'],
  anon: ['👀', '😱', '🤫', '🔥'],
};

const ALL_REACTS = new Set(Object.values(REACT_SETS).flat());

const HEROINE = '@heroine';

export const LOUDNESS = [
  { level: 0, max: 1, word: 'тихо' },
  { level: 1, max: 2, word: 'заметно' },
  { level: 2, max: 3, word: 'шумно' },
  { level: 3, max: Infinity, word: 'на всю школу' },
];

export function reactionCap(preset) {
  const own = preset && preset.feed && preset.feed.reactionCap;
  const n = Number(own);
  if (own === undefined || own === null || own === '' || !Number.isFinite(n)) return REACTION_CAP;
  return Math.max(CAP_BOUNDS[0], Math.min(CAP_BOUNDS[1], Math.round(n)));
}

export const DEFAULT_EXTRAS = [
  'завистница', 'сплетница', 'ботан', 'тихоня', 'сердцеед', 'сноб', 'задира',
  'вечный двоечник', 'старый знакомый', 'фанатка', 'шутник',
];

export const DEFAULT_NICK_EXAMPLES = ['всё-видел (сплетник)', 'не скажу кто (завистница)', 'вечно второй (ботан)'];

export const DEFAULT_MANNERS = [
  'коротко, строчными, без точек; иногда один из 💀/😭; обычно огрызается, но по делу отвечает прямо',
  'грамотно, с точками, без эмодзи; обычно объясняет причину, но может ответить двумя словами; опекает на «вы»',
  'часто парой слов, иногда одним эмодзи (👀 или 🤝)',
  'средне, с заглавными; часто спрашивает; иногда капс для эмоций',
  'коротко, без заглавных; изредка сухая ирония, обычно без эмодзи',
  'бывает длинными кусками без абзацев, перебивает сам себя; изредка 😅',
  'грамотно, но коротко; иногда притворная похвала, может ответить прямо; на «ты»',
  'строчными, нередко с многоточием; уклоняется от личного, практические ответы понятны; изредка 🤫',
];

export const DEFAULT_WORLD_TOPICS = [
  'очередь в столовую и что сегодня дали',
  'кто занял лучшие места в читальном зале',
  'дежурство по уборке: чья очередь',
  'расписание опять поменяли в последний момент',
  'у кого сломалось что-то в общем помещении',
];

function presetList(raw, fallback, max, len = 48) {
  const out = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const t = oneLine(v, len);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.length ? out.slice(0, max) : fallback;
}

export function feedExtras(preset) {
  return presetList(preset && preset.feed && preset.feed.extras, DEFAULT_EXTRAS, 16);
}

export function feedNickExamples(preset) {
  return presetList(preset && preset.feed && preset.feed.nickExamples, DEFAULT_NICK_EXAMPLES, 4);
}

export function feedWorldTopics(preset) {
  return presetList(preset && preset.feed && preset.feed.worldTopics, DEFAULT_WORLD_TOPICS, 12, 70);
}

export function feedManners(preset) {
  return presetList(preset && preset.feed && preset.feed.manners, DEFAULT_MANNERS, 16, 160);
}

export const BANTER_KEYS = ['slang', 'quarrel', 'dismiss_mild', 'dismiss_free', 'mom', 'insults_mild', 'insults_free'];
export function feedBanter(preset) {
  const b = preset && preset.feed && preset.feed.banter;
  const out = {};
  for (const k of BANTER_KEYS) out[k] = presetList(b && b[k], [], 24, 200);
  return out;
}

export const DEFAULT_REGISTER = 'Неформальный чат: простые слова, короткие реплики, кто-то пишет строчными и без точек, эмодзи по настроению; каждый пишет по-своему.';

export function feedRegister(preset) {
  const own = preset && preset.feed && preset.feed.register;
  return (typeof own === 'string' && oneLine(own, 400)) || DEFAULT_REGISTER;
}

export function feedSamples(preset) {
  return presetList(preset && preset.feed && preset.feed.samples, [], 10, 120);
}

export const toneKey = (v) => String(v == null ? '' : v).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}-]+/gu, '');

export const NO_TONE = 'нет';

const PAL_BOUNDS = [6, 8];
const EMOJI_RE = /^[^\p{L}\p{N}\s|]{1,12}$/u;

export function feedReactions(preset) {
  const list = preset && preset.feed && preset.feed.reactions;
  const out = [];
  for (const v of Array.isArray(list) ? list : []) {
    const emoji = v && typeof v.emoji === 'string' ? v.emoji.trim() : '';
    const tone = v && typeof v.tone === 'string' ? v.tone.trim().toLowerCase() : '';
    if (!EMOJI_RE.test(emoji) || !/^[\p{L}-]{2,20}$/u.test(tone) || toneKey(tone) === NO_TONE) continue;
    if (!out.some((p) => p.emoji === emoji)) out.push({ emoji, tone });
  }
  return out.length >= PAL_BOUNDS[0] ? out.slice(0, PAL_BOUNDS[1]) : [];
}

export function pickReacts(pal, { id, tone = '', loud = 1, quiet = false, reply = false } = {}) {
  const key = toneKey(tone);
  if (!pal.length || key === NO_TONE) return [];
  const rand = seeded(hash(`${id}|pick`));
  const hit = pal.find((p) => toneKey(p.tone) === key);
  const out = hit ? [hit.emoji] : [];
  let more;
  if (hit) more = quiet || reply || loud < 3 ? 0 : 1;
  else if (quiet) return [];
  else more = reply ? (loud >= 2 ? 1 : 0) : 1;
  const rest = pal.map((p) => p.emoji).filter((e) => !out.includes(e));
  for (let i = 0; i < more && rest.length; i += 1) out.push(rest.splice(Math.floor(rand() * rest.length), 1)[0]);
  return out;
}

export function loudCap(loud, cap = REACTION_CAP) {
  const row = LOUDNESS.find((l) => l.level === loud) || LOUDNESS[1];
  return Math.min(row.max, cap);
}

export function emptyFeed() {
  return { items: [], seen: {}, deals: [], cast: [], threads: [], molva: emptyMolva() };
}

export function ensureFeed(state) {
  const fresh = normalizeFeed(state && state.feed);
  if (state && typeof state === 'object') state.feed = fresh;
  return fresh;
}

export function normalizeFeed(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const items = trimRing(dropOrphans((Array.isArray(src.items) ? src.items : []).map(normalizeItem).filter(Boolean)));
  const seen = {};
  if (src.seen && typeof src.seen === 'object') {
    for (const [id, v] of Object.entries(src.seen)) {
      if (!id || !v || typeof v !== 'object') continue;
      seen[id] = { day: str(v.day), time: str(v.time), ...(v.local ? { local: true } : {}) };
    }
  }
  const deals = (Array.isArray(src.deals) ? src.deals : []).map(normalizeDeal).filter(Boolean).slice(-DEALS_MAX);
  const cast = normalizeCastList(src.cast);
  const temper = clipText(String(src.heroineTemper || '').replace(/^\s*(?:нрав|характер)\s*:\s*/iu, ''), TEMPER_MAX);
  const role = clipText(String(src.charRole || '').replace(/^\s*роль\s*:\s*/iu, ''), ROLE_MAX);
  return { items, seen: trimSeen(seen), deals, cast, threads: normalizeThreads(src.threads, cast), molva: normalizeMolva(src.molva), ...(temper ? { heroineTemper: temper } : {}), ...(role ? { charRole: role } : {}) };
}

export const ROLE_MAX = 120;

export const TEMPER_MAX = 400;

export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id);
  const text = clipText(raw.text, FEED_TEXT_MAX);
  if (!id || !text) return null;
  const chan = CHANNELS.includes(raw.chan) ? raw.chan : 'chat';
  const kind = raw.kind === 'fact' ? 'fact' : 'reaction';
  const nick = kind === 'reaction' ? cleanNick(raw.nick) : '';
  const parent = kind === 'reaction' && str(raw.parent) !== id ? str(raw.parent) : '';
  const emojis = (v, max) => [...new Set((Array.isArray(v) ? v : []).filter((e) => typeof e === 'string' && EMOJI_RE.test(e)))].slice(0, max);
  const pal = emojis(raw.pal, PAL_BOUNDS[1]);
  const reacts = Array.isArray(raw.reacts) ? emojis(raw.reacts, 4) : null;
  return {
    id,
    src: str(raw.src),
    at: { day: str(raw.at && raw.at.day), time: str(raw.at && raw.at.time) },
    factRef: str(raw.factRef),
    kind,
    who: nick ? '' : str(raw.who),
    nick,
    type: nick ? cleanType(raw.type) : '',
    parent,
    chan,
    text,
    rumor: kind === 'reaction' ? chan === 'anon' : raw.rumor === true,
    truth: raw.truth === true || raw.truth === false ? raw.truth : null,
    status: STATUSES.includes(raw.status) ? raw.status : 'new',
    read: raw.read === true,
    mine: ALL_REACTS.has(raw.mine) || pal.includes(raw.mine) || (reacts || []).includes(raw.mine) ? raw.mine : '',
    about: (Array.isArray(raw.about) ? raw.about : []).map(str).filter(Boolean).slice(0, 4),
    heroine: raw.heroine === true,
    loud: Number.isInteger(raw.loud) && raw.loud >= 0 && raw.loud <= 3 ? raw.loud : null,
    factText: clipText(raw.factText, FACT_TEXT_MAX),
    gist: kind === 'fact' ? clipText(raw.gist, FEED_TEXT_MAX) : '',
    playedSrc: raw.status === 'played' ? str(raw.playedSrc) : '',
    ...(kind === 'fact' && raw.private === true ? { private: true } : {}),
    ...(kind === 'fact' && raw.minor === true ? { minor: true } : {}),
    ...(kind === 'fact' && raw.act && typeof raw.act === 'object' && str(raw.act.kind)
      ? { act: { kind: clipText(raw.act.kind, 20), access: clipText(raw.act.access, 20), reach: clipText(raw.act.reach, 20), say: clipText(raw.act.say, 100) } } : {}),
    ...(kind === 'reaction' && raw.occ && typeof raw.occ === 'object' && str(raw.occ.kind)
      ? { occ: { kind: clipText(raw.occ.kind, 12), ref: clipText(raw.occ.ref, 90) } } : {}),
    ...(reacts ? { reacts } : {}),
    ...(pal.length ? { pal } : {}),
  };
}

export const FACT_TEXT_MAX = 100;

export function cleanNick(raw) {
  const t = str(raw)
    .replace(/-->|[=:[\]<>«»"“”„]/g, ' ')
    .replace(/^[~@\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NICK_MAX)
    .trim();
  return (t.match(/\p{L}/gu) || []).length >= 2 ? t : '';
}

export function cleanType(raw) {
  return cleanNick(raw);
}

export function nickWord(nick) {
  const n = cleanNick(nick);
  return n ? `@${n}` : '';
}

function dropOrphans(items) {
  const posts = new Set(items.filter((x) => !x.parent).map((x) => x.id));
  return items.filter((x) => !x.parent || posts.has(x.parent));
}

function trimRing(items) {
  let list = items;
  while (list.length > FEED_MAX) {
    const head = list.find((x) => !x.parent) || list[0];
    list = list.filter((x) => x.id !== head.id && x.parent !== head.id);
  }
  return list;
}

function normalizeDeal(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id);
  const a = str(raw.a);
  const b = str(raw.b);
  const what = oneLine(raw.what, 80);
  const intent = str(raw.intent);
  if (!id || !a || (!b && !intent) || !what) return null;
  const closed = raw.open === false;
  const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : '');
  return {
    id, src: str(raw.src), a, b, what,
    open: !closed,
    since: str(raw.since),
    closedOn: closed ? str(raw.closedOn) : '',
    ...(str(raw.on) ? { on: str(raw.on) } : {}),
    ...(day(raw.onDay) ? { onDay: day(raw.onDay) } : {}),
    ...(intent ? { intent } : {}),
    ...(intent && day(raw.until) ? { until: day(raw.until) } : {}),
    ...(intent && closed && DEAL_RESULTS.includes(raw.result) ? { result: raw.result } : {}),
    ...(intent && closed && DEAL_WHY.includes(raw.why) ? { why: raw.why } : {}),
  };
}

export const DEAL_RESULTS = ['done', 'failed'];
export const DEAL_WHY = ['done', 'failed', 'late', 'gone'];

export const CAST_MAX = 8;

export const THREADS_MAX = 3;

export const THREAD_MEMBERS = [1, 3];

export const THREAD_STATES = ['active', 'paused', 'archived'];

export const PAUSED_MAX = 3;
export const ARCHIVE_MAX = 6;

export const IDLE_ARCHIVE = 6;
export const STALE_MAX = 3;

export const AFFAIR_TURNS = 5;

export const THREAD_SOURCES = ['calendar', 'study', 'cast'];

export const CAST_TEXT_MAX = { nick: NICK_MAX, type: 60, interest: 120, goal: 150, manner: 260, jealousy: 220 };
export const THREAD_TEXT_MAX = { topic: 90, want: 180, last: 120, question: 100 };

const ID_RE = /^[\w-]{1,24}$/;

const isMateId = (v) => ID_RE.test(v) && !/^cast\d+$/.test(v) && v !== '@heroine';

export function cutWords(text, max) {
  const t = String(text == null ? '' : text).trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return (at > max / 2 && /[\p{L}\p{N}]/u.test(t[max]) ? cut.slice(0, at) : cut).replace(/[\s,;:\-–—]+$/u, '').trim();
}

export function plain(v, max) {
  return cutWords(oneLine(v, max * 2).replace(/\|/g, '/'), max);
}

export function freeId(prefix, used) {
  for (let n = 1; ; n += 1) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

export function normalizeMember(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const nick = cleanNick(str(raw.nick).replace(/\|/g, ' '));
  if (!nick) return null;
  const id = str(raw.id);
  return {
    id: ID_RE.test(id) ? id : '',
    nick,
    type: plain(raw.type, CAST_TEXT_MAX.type),
    interest: plain(raw.interest, CAST_TEXT_MAX.interest),
    goal: plain(raw.goal, CAST_TEXT_MAX.goal),
    manner: clipManner(plain(raw.manner, CAST_TEXT_MAX.manner * 2), CAST_TEXT_MAX.manner),
    jealousy: plain(raw.jealousy, CAST_TEXT_MAX.jealousy),
    ally: str(raw.ally),
    rival: str(raw.rival),
    ...(raw.fan === true ? { fan: true } : {}),
  };
}

export function normalizeCastList(raw) {
  const out = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const m = normalizeMember(r);
    if (!m || (m.id && out.some((x) => x.id === m.id))) continue;
    out.push(m);
    if (out.length >= CAST_MAX) break;
  }
  const used = new Set(out.map((m) => m.id).filter(Boolean));
  for (const m of out) {
    if (m.id) continue;
    m.id = freeId('cast', used);
    used.add(m.id);
  }
  for (const m of out) {
    if (!used.has(m.ally) || m.ally === m.id) m.ally = '';
    if (!used.has(m.rival) || m.rival === m.id || m.rival === m.ally) m.rival = '';
  }
  return out;
}

export function normalizeThread(raw, ids) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id);
  const topic = clipText(raw.topic, THREAD_TEXT_MAX.topic);
  if (!ID_RE.test(id) || !topic) return null;
  const members = [];
  for (const m of Array.isArray(raw.members) ? raw.members : []) {
    const v = str(m);
    if ((ids.has(v) || isMateId(v)) && !members.includes(v)) members.push(v);
  }
  if (members.length < THREAD_MEMBERS[0]) return null;
  const count = (v, max) => (Number.isInteger(v) && v > 0 ? Math.min(v, max) : 0);
  const kept = members.slice(0, THREAD_MEMBERS[1]);
  return {
    id,
    topic,
    members: kept,
    owner: kept.includes(str(raw.owner)) ? str(raw.owner) : kept[0],
    want: oneLine(raw.want !== undefined ? raw.want : raw.dispute, THREAD_TEXT_MAX.want),
    last: clipText(raw.last, THREAD_TEXT_MAX.last),
    question: clipText(raw.question, THREAD_TEXT_MAX.question),
    source: THREAD_SOURCES.includes(raw.source) ? raw.source : 'cast',
    since: str(raw.since),
    on: /^\d{4}-\d{2}-\d{2}$/.test(str(raw.on)) ? str(raw.on) : '',
    idle: count(raw.idle, 9),
    stale: count(raw.stale, 9),
    turns: count(raw.turns, 99),
    state: THREAD_STATES.includes(raw.state) ? raw.state : 'active',
  };
}

export function normalizeThreads(raw, cast) {
  const ids = new Set((Array.isArray(cast) ? cast : []).map((m) => m.id));
  const all = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const t = normalizeThread(r, ids);
    if (t && !all.some((x) => x.id === t.id)) all.push(t);
  }
  let active = 0;
  for (const t of all) {
    if (t.state !== 'active') continue;
    if (active >= THREADS_MAX) t.state = 'paused';
    else active += 1;
  }
  const paused = all.filter((t) => t.state === 'paused').slice(0, PAUSED_MAX);
  const archived = all.filter((t) => t.state === 'archived').slice(-ARCHIVE_MAX);
  return all.filter((t) => t.state === 'active' || paused.includes(t) || archived.includes(t));
}

export const MOLVA_FACTS_MAX = 60;

export function emptyMolva() {
  return { issue: 0, since: 0, facts: [], at: { day: '', time: '' }, topics: [], lead: { topic: '', stage: '' }, leads: [], cal: [], offered: [], hot: [] };
}

export const MOLVA_TOPICS_MAX = 10;

export const MOLVA_LEADS_MAX = 3;

export const CALENDAR_GAP = 3;

export const EVENTS_OFFERED_MAX = 12;

const EVENTS_MAX_HOT = 3;

export function normalizeMolva(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const num = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  return {
    issue: num(src.issue),
    since: num(src.since),
    facts: (Array.isArray(src.facts) ? src.facts : []).map(str).filter(Boolean).slice(-MOLVA_FACTS_MAX),
    at: { day: str(src.at && src.at.day), time: str(src.at && src.at.time) },
    topics: (Array.isArray(src.topics) ? src.topics : []).map((t) => clipText(t, 90)).filter(Boolean).slice(-MOLVA_TOPICS_MAX),
    lead: { topic: clipText(src.lead && src.lead.topic, 90), stage: str(src.lead && src.lead.stage) },
    leads: (Array.isArray(src.leads) ? src.leads : [])
      .map((l) => ({ topic: clipText(l && l.topic, 90), stage: str(l && l.stage) })).filter((l) => l.topic).slice(-MOLVA_LEADS_MAX),
    cal: (Array.isArray(src.cal) ? src.cal : [])
      .map((c) => ({ topic: clipText(c && c.topic, 90), issue: num(c && c.issue) })).filter((c) => c.topic).slice(-6),
    offered: (Array.isArray(src.offered) ? src.offered : []).map(str).filter(Boolean).slice(-EVENTS_OFFERED_MAX),
    hot: (Array.isArray(src.hot) ? src.hot : [])
      .map((h) => ({ id: str(h && h.id), issue: num(h && h.issue) })).filter((h) => h.id).slice(-EVENTS_MAX_HOT),
  };
}

export function feedItems(state) {
  return normalizeFeed(state && state.feed).items;
}

export function addFeedItem(state, raw) {
  const feed = ensureFeed(state);
  const item = normalizeItem(raw);
  if (!item) return null;
  if (item.parent && !feed.items.some((x) => x.id === item.parent && !x.parent)) return null;
  const at = feed.items.findIndex((x) => x.id === item.id);
  if (at >= 0) feed.items[at] = item;
  else feed.items.push(item);
  feed.items = trimRing(feed.items);
  return feed.items.some((x) => x.id === item.id) ? item.id : null;
}

function removeWhere(state, test) {
  const feed = ensureFeed(state);
  const before = feed.items.length;
  feed.items = dropOrphans(feed.items.filter((x) => !test(x)));
  return before - feed.items.length;
}

export function removeFeedItem(state, id) {
  return removeWhere(state, (x) => x.id === id) > 0;
}

export function dropByFact(state, src, factRef) {
  return removeWhere(state, (x) => x.src === src && x.factRef === factRef);
}

export function retimeSource(state, src, day, time = '') {
  const feed = state && state.feed;
  if (!feed || !src || !day) return state;
  const mine = (x) => x.src === src || String(x.src || '').endsWith(`-${hash(src)}`);
  for (const x of feed.items || []) if (mine(x)) x.at = { day, time: time || (x.at && x.at.time) || '' };
  for (const d of feed.deals || []) if (mine(d)) d.since = day;
  return state;
}

export function removeBySource(state, src, kind = null) {
  return removeWhere(state, (x) => x.src === src && (!kind || x.kind === kind));
}

export function putReactions(state, src, reactions, opts = {}) {
  removeBySource(state, src, 'reaction');
  const cap = Number.isFinite(opts.cap) ? opts.cap : REACTION_CAP;
  const out = [];
  const byToken = new Map();
  let posts = 0;
  for (const r of (Array.isArray(reactions) ? reactions : []).slice(0, cap)) {
    if (!r || !r.fact) continue;
    const id = addFeedItem(state, {
      id: `${src}#${posts + 1}`,
      src,
      at: { day: opts.day, time: opts.time },
      factRef: r.fact,
      kind: 'reaction',
      who: r.who || '',
      nick: r.nick || '',
      type: r.type || '',
      chan: r.chan,
      text: r.text,
      rumor: r.rumor === true || r.chan === 'anon',
      truth: null,
      about: r.about,
      heroine: r.heroine === true,
      loud: opts.loud,
      factText: r.factText,
    });
    if (!id) continue;
    posts += 1;
    out.push(id);
    if (r.token) byToken.set(r.token, id);
  }
  let replies = 0;
  for (const a of Array.isArray(opts.replies) ? opts.replies : []) {
    if (!a || !a.parent) continue;
    const parentId = a.parent.token ? byToken.get(a.parent.token) : str(a.parent.feed);
    const post = parentId ? ensureFeed(state).items.find((x) => x.id === parentId && !x.parent) : null;
    if (!post) continue;
    const id = addFeedItem(state, {
      id: `${src}^${replies + 1}`,
      src,
      at: { day: opts.day, time: opts.time },
      factRef: post.src === src ? post.factRef : '',
      kind: 'reaction',
      parent: post.id,
      who: a.who || '',
      nick: a.nick || '',
      type: a.type || '',
      chan: post.chan,
      text: a.text,
      rumor: post.chan === 'anon',
      truth: null,
      about: post.about,
      heroine: post.heroine,
      loud: opts.loud,
      factText: post.factText,
    });
    if (!id) continue;
    replies += 1;
    out.push(id);
  }
  return out;
}

export function repliesOf(state, postId) {
  return feedItems(state).filter((x) => x.parent && x.parent === postId);
}

export function threadOf(state, postId) {
  const items = feedItems(state);
  const post = items.find((x) => x.id === postId && !x.parent);
  return post ? { post, replies: items.filter((x) => x.parent === post.id) } : null;
}

export const REPLY_REACTS = 3;

export function reactSet(item) {
  if (!item) return REACT_SETS.chat;
  if (Array.isArray(item.reacts)) return item.reacts;
  const set = item.chan === 'anon' ? REACT_SETS.anon
    : ((item.loud ?? 1) >= 2 || /^(?:clash=|act=(?:[^:]*:){3}конфликт:)/.test(item.factRef || '')) ? REACT_SETS.drama
      : REACT_SETS.chat;
  return item.parent ? set.slice(0, REPLY_REACTS) : set;
}

const REACT_SCALE = [3, 7, 16, 34];

const REACT_SCALE_FIXED = [2, 4, 16, 34];

const REACT_WEIGHTS = [1, 0.6, 0.4, 0.25];

const REPLY_SCALE = [1, 2, 4, 7];

export function reactCounts(item, replies = 0) {
  if (!item || !item.id) return [];
  const reply = Boolean(item.parent);
  const rand = seeded(hash(`${item.id}|react`));
  const loud = Number.isInteger(item.loud) && item.loud >= 0 && item.loud <= 3 ? item.loud : 1;
  const fixed = Array.isArray(item.reacts);
  const asked = Math.max(0, Math.trunc(replies) || 0);
  const base = reply ? REPLY_SCALE[loud]
    : fixed ? REACT_SCALE_FIXED[loud] + Math.min(3, asked)
      : REACT_SCALE[loud] + Math.min(10, asked) * 2;
  if (fixed) {
    const out = item.reacts.map((emoji, i) => {
      const n = Math.floor(base * REACT_WEIGHTS[i] * (0.35 + 0.65 * rand()));
      const own = item.mine === emoji;
      return { emoji, n: Math.max(i === 0 && loud >= 1 ? 1 : 0, n) + (own ? 1 : 0), mine: own };
    }).filter((r) => r.n > 0);
    if (item.mine && !item.reacts.includes(item.mine)) out.push({ emoji: item.mine, n: 1, mine: true });
    return out;
  }
  const floor = reply ? 2 : 3;
  return reactSet(item).map((emoji, i) => {
    const own = item.mine === emoji;
    const n = Math.max(i < floor ? 1 : 0, Math.floor(base * REACT_WEIGHTS[i] * (0.35 + 0.65 * rand()))) + (own ? 1 : 0);
    return { emoji, n, mine: own };
  }).filter((r) => r.n > 0);
}

export function canReact(item, emoji) {
  return reactSet(item).includes(emoji) || (Array.isArray(item.pal) && item.pal.includes(emoji));
}

export function toggleReact(state, id, emoji) {
  const item = ensureFeed(state).items.find((x) => x.id === id);
  if (!item || !canReact(item, emoji)) return null;
  item.mine = item.mine === emoji ? '' : emoji;
  return item.mine;
}

export const RECENT_POSTS = 4;

export function recentPosts(state, max = RECENT_POSTS) {
  const items = feedItems(state);
  const posts = items.filter((x) => x.kind === 'reaction' && !x.parent && x.status !== 'expired').slice(-max).reverse();
  return posts.map((x, i) => ({
    ref: `f${i + 1}`, id: x.id, who: x.who, nick: x.nick, type: x.type || '', chan: x.chan, text: x.text,
    replies: items.filter((y) => y.parent === x.id).length,
  }));
}

export function postRef(id) {
  return hash(`post|${str(id)}`);
}

export function postByRef(state, ref) {
  return feedItems(state).find((x) => !x.parent && postRef(x.id) === ref) || null;
}

function seeded(seedText) {
  let a = parseInt(String(seedText), 36) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function setLoudness(state, src, loud) {
  if (!Number.isInteger(loud)) return 0;
  let n = 0;
  for (const x of ensureFeed(state).items) {
    if (x.src !== src || (x.kind === 'fact' && /^act=/.test(x.factRef || ''))) continue;
    x.loud = loud;
    n += 1;
  }
  return n;
}

export function markRead(state, ids = null) {
  const feed = ensureFeed(state);
  const want = ids === null ? null : new Set([].concat(ids));
  let n = 0;
  for (const x of feed.items) {
    if (x.read || (want && !want.has(x.id))) continue;
    x.read = true;
    n += 1;
  }
  return n;
}

export function setStatus(state, id, status, playedSrc = '') {
  if (!STATUSES.includes(status)) return false;
  const item = ensureFeed(state).items.find((x) => x.id === id);
  if (!item) return false;
  item.status = status;
  item.playedSrc = status === 'played' ? str(playedSrc) : '';
  return true;
}

export function feedItem(state, id) {
  return feedItems(state).find((x) => x.id === id) || null;
}

export const privateFact = (x) => Boolean(x) && x.kind === 'fact' && x.private === true && x.rumor !== true;

export function hiddenFact(x, items = []) {
  if (!x || x.kind !== 'fact' || x.rumor === true) return false;
  return privateFact(x) || !items.some((y) => y && y.parent === x.id);
}

export function unreadCount(state, chan = null) {
  const items = feedItems(state);
  return items.filter((x) => !x.read && !hiddenFact(x, items) && (!chan || x.chan === chan)).length;
}

export function carryFeedMarks(prev, next, src = '', memory = []) {
  const old = prev && prev.feed && Array.isArray(prev.feed.items) ? prev.feed.items : [];
  const byId = new Map((Array.isArray(memory) ? memory : []).filter((m) => m && m.id).map((m) => [m.id, m]));
  for (const x of old) if (x && x.id) byId.set(x.id, x);
  if (!byId.size || !next || typeof next !== 'object') return next;
  const feed = normalizeFeed(next.feed);
  let changed = false;
  for (const x of feed.items) {
    const was = byId.get(x.id);
    if (!was) continue;
    if (was.read === true && !x.read) {
      x.read = true;
      changed = true;
    }
    const mine = canReact(x, was.mine) ? was.mine : '';
    if (mine !== x.mine) {
      x.mine = mine;
      changed = true;
    }
    if (src && x.status === 'played' && x.playedSrc === src) continue;
    const own = Boolean(src) && was.status === 'played' && was.playedSrc === src;
    const status = own ? 'taken' : (STATUSES.includes(was.status) ? was.status : x.status);
    const playedSrc = status === 'played' && !own ? str(was.playedSrc) : '';
    if (status !== x.status || playedSrc !== x.playedSrc) {
      x.status = status;
      x.playedSrc = playedSrc;
      changed = true;
    }
  }
  return changed ? { ...next, feed } : next;
}

export const MARKS_MAX = 2 * FEED_MAX;

export function rememberFeedMarks(memory, state) {
  const byId = new Map();
  for (const m of Array.isArray(memory) ? memory : []) {
    if (m && typeof m.id === 'string' && m.id) byId.set(m.id, m);
  }
  for (const x of feedItems(state)) {
    if (!x || !x.id) continue;
    byId.delete(x.id);
    byId.set(x.id, {
      id: x.id,
      read: x.read === true,
      mine: str(x.mine),
      status: STATUSES.includes(x.status) ? x.status : 'new',
      playedSrc: str(x.playedSrc),
    });
  }
  return [...byId.values()].slice(-MARKS_MAX);
}

export function markPlayed(state, src, ids) {
  unmarkPlayed(state, src);
  const feed = ensureFeed(state);
  const want = new Set([].concat(ids || []));
  let n = 0;
  for (const x of feed.items) {
    if (!want.has(x.id)) continue;
    x.status = 'played';
    x.playedSrc = str(src);
    n += 1;
  }
  return n;
}

export function unmarkPlayed(state, src) {
  if (!src) return 0;
  let n = 0;
  for (const x of ensureFeed(state).items) {
    if (x.status !== 'played' || x.playedSrc !== src) continue;
    x.status = 'taken';
    x.playedSrc = '';
    n += 1;
  }
  return n;
}

export function knownToHeroine(item) {
  return Boolean(item && (item.heroine || item.read));
}

export const BACKGROUND_DAYS = 1;

export const BACKGROUND_MAX = 2;

export const BACKGROUND_TEXT_MAX = 90;

export const RUMOR_DAYS = 3;

function freshOn(item, day, days) {
  if (!item || !item.at || !item.at.day || !day) return false;
  let d;
  try {
    d = diffDays(item.at.day, day);
  } catch {
    return false;
  }
  return Number.isFinite(d) && d >= 0 && d <= days;
}

const onEvent = (x) => /^event=/.test(x.factRef || '');

function pointOf(x) {
  if (x.kind === 'fact') return { kind: x.rumor ? 'rumor' : 'fact', text: clipWords(x.gist || x.text, BACKGROUND_TEXT_MAX) };
  if (x.rumor) return { kind: 'gossip', text: clipWords(x.text, BACKGROUND_TEXT_MAX) };
  return { kind: 'talk', text: clipWords(x.factText || x.text, BACKGROUND_TEXT_MAX), quoted: !x.factText };
}

function factPoint(fact) {
  const text = clipWords(fact.gist || fact.text, BACKGROUND_TEXT_MAX);
  return fact.rumor ? { kind: 'rumor', text } : { kind: 'talk', text, quoted: false };
}

export function feedBackground(state, opts = {}) {
  const max = Number.isInteger(opts.max) ? opts.max : BACKGROUND_MAX;
  if (max <= 0) return [];
  const day = opts.day || (state && state.calendar && state.calendar.day) || '';
  const items = feedItems(state)
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => !x.parent && !x.minor && knownToHeroine(x) && x.status !== 'expired' && !onEvent(x) && freshOn(x, day, BACKGROUND_DAYS));
  items.sort((a, b) => (Number(b.x.heroine) - Number(a.x.heroine))
    || ((b.x.loud ?? 1) - (a.x.loud ?? 1))
    || (b.i - a.i));
  const factOf = new Map(feedItems(state).filter((x) => x.kind === 'fact').map((x) => [`${x.src}|${x.factRef}`, x]));
  const out = [];
  const facts = new Set();
  for (const { x } of items) {
    const key = `${x.src}|${x.factRef || x.id}`;
    if (facts.has(key)) continue;
    facts.add(key);
    const fact = x.kind === 'reaction' ? factOf.get(key) : null;
    const point = fact ? factPoint(fact) : pointOf(x);
    out.push({ ...point, heroine: x.heroine, id: x.id });
    if (out.length >= max) break;
  }
  return out;
}

export function rumorFor(state, personId, opts = {}) {
  const id = str(personId);
  if (!id || id === HEROINE) return null;
  const day = opts.day || (state && state.calendar && state.calendar.day) || '';
  const feed = normalizeFeed(state && state.feed);
  const seen = feed.seen[id];
  const echoed = new Set(feed.items.filter((x) => x.kind === 'reaction' && x.who === id).map((x) => `${x.src}|${x.factRef}`));
  const heard = (x) => x.about.includes(id)
    || echoed.has(`${x.src}|${x.factRef}`)
    || Boolean(seen && seen.day && seen.day === x.at.day);
  for (let i = feed.items.length - 1; i >= 0; i -= 1) {
    const x = feed.items[i];
    if (x.kind !== 'fact' || x.minor || x.status === 'expired' || !freshOn(x, day, RUMOR_DAYS) || !heard(x)) continue;
    return { ...pointOf(x), id: x.id, gist: Boolean(x.gist) };
  }
  return null;
}

export function clipText(v, max) {
  const t = oneLine(v, 4000);
  if (t.length <= max) return t;
  const room = t.slice(0, max - 1);
  const stop = Math.max(room.lastIndexOf('. '), room.lastIndexOf('! '), room.lastIndexOf('? '));
  if (stop >= max * 0.6) return room.slice(0, stop + 1).trim();
  const clause = Math.max(room.lastIndexOf(', '), room.lastIndexOf('; '));
  if (clause >= max * 0.7) return room.slice(0, clause).trim();
  const at = room.lastIndexOf(' ');
  return `${(at > max / 2 ? room.slice(0, at) : room).replace(/[\s,;:\-–—]+$/u, '').trim()}…`;
}

function clipManner(t, max) {
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = Math.max(cut.lastIndexOf(';'), cut.lastIndexOf(','));
  return (at > max / 2 ? cut.slice(0, at) : cut.slice(0, Math.max(cut.lastIndexOf(' '), 1))).trim();
}

export function clipWords(text, max) {
  const t = oneLine(text, 1000);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).trim()}…`;
}

export function markSeen(state, personId, at = {}, { local = false } = {}) {
  const feed = ensureFeed(state);
  const id = str(personId);
  if (!id || id === HEROINE) return null;
  const prev = feed.seen[id] ? { ...feed.seen[id] } : null;
  const day = str(at.day);
  if (local && prev && !prev.local && prev.day === day) return prev;
  delete feed.seen[id];
  feed.seen[id] = { day, time: str(at.time), ...(local ? { local: true } : {}) };
  feed.seen = trimSeen(feed.seen);
  return prev;
}

export function restoreSeen(state, personId, prev) {
  const feed = ensureFeed(state);
  if (prev && typeof prev === 'object') feed.seen[personId] = { ...prev };
  else delete feed.seen[personId];
}

export function lastSeen(state, personId) {
  const seen = normalizeFeed(state && state.feed).seen;
  return seen[personId] || null;
}

function trimSeen(seen) {
  const keys = Object.keys(seen);
  if (keys.length <= SEEN_MAX) return seen;
  const out = {};
  for (const k of keys.slice(-SEEN_MAX)) out[k] = seen[k];
  return out;
}

function sameDeal(d, a, b, what) {
  const pair = (d.a === a && d.b === b) || (d.a === b && d.b === a);
  return pair && key(d.what) === key(what);
}

export function openDeal(state, { a, b, what, src = '', day = '', ...extra }) {
  const feed = ensureFeed(state);
  const twin = feed.deals.find((d) => dealAlive(state, d) && sameDeal(d, a, b, what));
  if (twin) return { id: twin.id, created: false };
  const id = `${src || 'deal'}~${hash(`${a}|${b}|${key(what)}`)}`;
  const deal = normalizeDeal({ ...extra, id, src, a, b, what, open: true, since: day });
  if (!deal) return { id: '', created: false };
  feed.deals = feed.deals.filter((d) => d.id !== id);
  feed.deals.push(deal);
  if (feed.deals.length > DEALS_MAX) {
    const closed = feed.deals.findIndex((d) => !d.open);
    feed.deals.splice(closed >= 0 ? closed : 0, 1);
  }
  return { id, created: true };
}

export function closeDeal(state, { a, b, what, src = '', day = '' }) {
  const feed = ensureFeed(state);
  const open = feed.deals.find((d) => dealAlive(state, d) && sameDeal(d, a, b, what))
    || feed.deals.find((d) => dealAlive(state, d) && ((d.a === a && d.b === b) || (d.a === b && d.b === a)) && near(d.what, what));
  if (open) {
    open.open = false;
    open.closedOn = day;
    return { id: open.id, created: false, wasOpen: true };
  }
  const made = openDeal(state, { a, b, what, src, day });
  const deal = feed.deals.find((d) => d.id === made.id);
  if (deal) {
    deal.open = false;
    deal.closedOn = day;
  }
  return { id: made.id, created: made.created, wasOpen: false };
}

export function finishDeal(state, id, { why, result = '', day = '' }) {
  const deal = ensureFeed(state).deals.find((d) => d.id === id && d.open);
  if (!deal || !DEAL_WHY.includes(why)) return false;
  deal.open = false;
  deal.closedOn = day;
  deal.why = why;
  if (DEAL_RESULTS.includes(result)) deal.result = result;
  return true;
}

export function revertDeal(state, receipt) {
  const feed = ensureFeed(state);
  const at = feed.deals.findIndex((d) => d.id === receipt.id);
  if (at < 0) return;
  if (receipt.created) feed.deals.splice(at, 1);
  else if (receipt.wasOpen) {
    feed.deals[at].open = true;
    feed.deals[at].closedOn = '';
  }
}

export function openDeals(state, personId = null) {
  return normalizeFeed(state && state.feed).deals
    .filter((d) => dealAlive(state, d) && (!personId || d.a === personId || d.b === personId));
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function oneLine(v, max) {
  return str(v).replace(/\s+/g, ' ').slice(0, max).trim();
}

function key(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function near(a, b) {
  const x = new Set(key(a).split(' ').filter((w) => w.length >= 4).map((w) => w.slice(0, 5)));
  return key(b).split(' ').some((w) => w.length >= 4 && x.has(w.slice(0, 5)));
}

export function hash(s) {
  let h = 0;
  const t = String(s);
  for (let i = 0; i < t.length; i += 1) h = (Math.imul(31, h) + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

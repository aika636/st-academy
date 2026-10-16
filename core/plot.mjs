import { cloneState } from './state.mjs';
import { HEROINE } from './parse-marker.mjs';
import { feedItems, setStatus, openDeals, normalizeFeed, nickWord } from './feed.mjs';
import { diffDays } from './time.mjs';
import { dealText, shortName } from './scene.mjs';
import { heroGender, heroWords, presetGender } from './gender.mjs';

export const PLOT_EXPIRE = 6;

export const AUTO_PAUSE = 6;

export const AUTO_PAUSE_LOUD = 2;

export const AUTO_FRESH_DAYS = 2;

export const QUEUE_MAX = 5;

export const LOG_MAX = 20;

export const SECRETARY_HOOKS = 3;

export const HOOK_TEXT_MAX = 600;
export const BULLY_HOOK_MAX = 1300;
export const CORE_MAX = 320;

export const DEFAULT_PLOT_PHRASES = {
  frame: 'Если уместно, можно вплести в сцену (необязательная находка, не приказ): {core}.',
  rumor: 'Это слух — правда ли, неизвестно.',
  outward: 'Покажи внешнее; слова и решения персонажа игрока оставь игроку. Прозвучит — дальше не возвращайся к этому.',
  notAgain: 'Не повторяй: {last}.',
  said: '{who} пишет в чате: «{text}»',
  someone: 'кто-то с курса',
  gossip: 'пишут без подписи: «{text}»',
  molva: 'слух от {who}: «{text}»; само утверждение не установленный факт',
  rumorFact: 'говорят, что {gist}',
  molvaFact: 'говорят о {fact}: «{text}» ({who})',
  deal: 'незакрытое дело — {deal}',
  heroine: 'героиня',
  threadArgue: 'в ветке спорят',
  threadBack: 'в ветке поддерживают',
  threadTease: 'в ветке подкалывают',
  threadTalk: 'в ветке отвечают',
  threadGlue: '; ',
};

export const INVITE_KIND = 'invite';

export const BULLY_KIND = 'bully';

const SELF_KINDS = [INVITE_KIND, BULLY_KIND];

export const HOLIDAY_KIND = 'holiday';

export function holidayIn(injects) {
  return (Array.isArray(injects) ? injects : []).some((i) => i && i.kind === HOLIDAY_KIND);
}

const MUTE_RE = /\(\s*без\s+(?:сплетен|поводов)\s*\)/iu;

export function isMuted(text) {
  return MUTE_RE.test(String(text || ''));
}

export function quietScene(_text) {
  return false;
}

export function emptyPlot() {
  return { queue: [], log: [], replies: 0, seq: 0, autoAt: null, hookAt: null, lastCore: '' };
}

export function normalizePlot(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const all = (Array.isArray(src.queue) ? src.queue : []).map(normalizeHook).filter(Boolean);
  const own = new Set(all.filter((h) => !SELF_KINDS.includes(h.kind)).slice(0, QUEUE_MAX));
  const queue = all.filter((h) => SELF_KINDS.includes(h.kind) || own.has(h));
  let armed = false;
  for (const h of queue) {
    if (h.armed && !armed) armed = true;
    else if (h.armed) {
      h.armed = false;
      h.delivered = false;
    }
  }
  const log = (Array.isArray(src.log) ? src.log : []).map((e) => {
    if (!e || typeof e !== 'object' || !str(e.id) || !str(e.ref)) return null;
    return {
      id: str(e.id), ref: str(e.ref), kind: kindOf(e.kind),
      core: oneLine(e.core, CORE_MAX), plate: oneLine(e.plate, CORE_MAX), deliveredAt: int(e.deliveredAt, 0),
    };
  }).filter(Boolean).slice(-LOG_MAX);
  return {
    queue,
    log,
    replies: int(src.replies, 0),
    seq: int(src.seq, 0),
    autoAt: Number.isInteger(src.autoAt) ? src.autoAt : null,
    hookAt: Number.isInteger(src.hookAt) ? src.hookAt : null,
    lastCore: oneLine(src.lastCore, CORE_MAX),
  };
}

const kindOf = (k) => (k === 'deal' || SELF_KINDS.includes(k) ? k : 'item');

function normalizeHook(h) {
  if (!h || typeof h !== 'object') return null;
  const id = str(h.id);
  const ref = str(h.ref);
  const text = oneLine(h.text, h.kind === BULLY_KIND ? BULLY_HOOK_MAX : HOOK_TEXT_MAX);
  if (!id || !ref || !text) return null;
  const armed = h.armed === true && !SELF_KINDS.includes(kindOf(h.kind));
  return {
    id, ref,
    kind: kindOf(h.kind),
    core: oneLine(h.core, CORE_MAX),
    plate: oneLine(h.plate, CORE_MAX),
    text,
    rumor: h.rumor === true,
    auto: h.auto === true,
    armed,
    delivered: armed && h.delivered === true,
    takenAt: int(h.takenAt, 0),
  };
}

function phrasesOf(preset) {
  const own = preset && preset.phrases && preset.phrases.plot;
  const someone = preset && preset.vocab && typeof preset.vocab.someone === 'string' && preset.vocab.someone.trim();
  return {
    ...DEFAULT_PLOT_PHRASES,
    heroine: heroWords(presetGender(preset)).hero,
    ...(someone ? { someone } : {}),
    ...(own && typeof own === 'object' ? own : {}),
  };
}

export function unsaid(text) {
  const t = str(text).replace(/^(?:говорят|ходят слухи|ходит слух|поговаривают)\s*(?:[,:—–-]\s*)?(?:что\s+)?/iu, '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : str(text);
}

function peopleOf(state) {
  return [...((state && state.teachers) || []), ...((state && state.classmates) || [])].filter((p) => p && p.id);
}

const ARGUE_WORDS = [
  'неправд', 'вр[её]шь', 'вр[её]т', 'вран', 'враки', 'не ври', 'брехн', 'бред', 'чушь', 'чепух', 'глупост', 'ерунд',
  'не верю', 'да ладно', 'да ну', 'с чего', 'с какой стати', 'ты что', 'ты чего', 'вы что', 'чего[?]', 'фейк',
  'гон(?:ишь|ят|ит)', 'не так', 'не неси', 'не выдумывай', 'ничего подобного', 'вовсе нет', 'вообще не',
  'кто бы говорил', 'сам[аи]? (?:такой|такая|такие|ты)', 'докажи', 'пруф', 'отвали', 'отстань',
  'я-то', 'это ты', 'не смеши', 'ага,? щас', 'ещ[её] чего', 'не правда',
];
const ARGUE_RE = new RegExp(`(?<![\\p{L}])(?:${ARGUE_WORDS.join('|').replace(/ /g, '\\s+')})`, 'iu');
const BACK_RE = /(?<![\p{L}])(?:соглас|поддерж|точно|правильно|прав[аы]?(?![\p{L}])|так и есть|жиза|респект|молод(?:ец|цы)|держись|за неё|за него|\+1)/iu;
const TEASE_RE = /(?<![\p{L}])(?:ха(?:ха)+|лол|кек|ну-ну|ага,? конечно|ну конечно|клоун)(?![\p{L}])/iu;

export function threadTone(texts) {
  const list = (Array.isArray(texts) ? texts : []).map(str).filter(Boolean);
  if (!list.length) return '';
  const n = (re) => list.filter((t) => re.test(t)).length;
  const scores = [['argue', n(ARGUE_RE)], ['back', n(BACK_RE)], ['tease', n(TEASE_RE)]];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][1] > 0 ? scores[0][0] : 'talk';
}

function threadPhrase(tone, P) {
  if (tone === 'argue') return P.threadArgue;
  if (tone === 'back') return P.threadBack;
  if (tone === 'tease') return P.threadTease;
  return tone ? P.threadTalk : '';
}

function nameOf(id, state, P, heroine) {
  if (id === HEROINE) return heroine || P.heroine;
  if (!id || id === 'someone') return P.someone;
  const p = peopleOf(state).find((x) => x.id === id);
  if (!p) return P.someone;
  const teacher = ((state && state.teachers) || []).some((t) => t && t.id === id);
  return shortName(p.name || p.id, { teacher }) || p.id;
}

function isPublicTalk(item) {
  return isMolva(item) && item.rumor !== true && item.chan !== 'anon' && Boolean(item.factText);
}

function isMolva(item) {
  return item.kind === 'reaction' && /^molva-/.test(String(item.src || ''));
}

export function hookCore(state, ref, opts = {}) {
  const P = phrasesOf(opts.preset);
  const heroine = str(opts.heroine);
  const items = feedItems(state);
  const item = items.find((x) => x.id === ref);
  if (item) {
    let core;
    if (item.kind === 'fact') core = item.rumor && item.gist ? fill(P.rumorFact, { gist: bare(item.gist) }) : item.text;
    else if (item.chan === 'anon') core = fill(P.gossip, { text: bare(unsaid(item.text)) });
    else if (isPublicTalk(item)) {
      const nick = item.nick ? `${nickWord(item.nick)}${item.type ? ` (${item.type})` : ''}` : nameOf(item.who, state, P, heroine);
      core = fill(P.molvaFact, { fact: bare(item.factText), text: bare(item.text), who: nick });
    } else if (isMolva(item)) core = fill(P.molva, { who: item.nick ? `${nickWord(item.nick)}${item.type ? ` (${item.type})` : ''}` : nameOf(item.who, state, P, heroine), text: bare(item.text) });
    else core = fill(P.said, { who: item.nick ? (item.type || P.someone) : nameOf(item.who, state, P, heroine), text: bare(item.text) });
    const thread = isMolva(item) ? '' : threadPhrase(threadTone(items.filter((x) => x.parent === item.id).map((x) => x.text)), P);
    if (thread) core = `${bare(core)}${P.threadGlue}${thread}`;
    return { ref, kind: 'item', core: oneLine(core, CORE_MAX), rumor: item.rumor === true || (isMolva(item) && !isPublicTalk(item)) };
  }
  const deal = openDeals(state).find((d) => d.id === ref);
  if (deal) {
    const core = fill(P.deal, {
      deal: dealText({ ...deal, closed: false }, peopleOf(state), heroine, heroGender(state, heroine)),
      a: nameOf(deal.a, state, P, heroine), b: nameOf(deal.b, state, P, heroine), what: deal.what,
    });
    return { ref, kind: 'deal', core: oneLine(core, CORE_MAX), rumor: false };
  }
  return null;
}

export function hookWording({ core, rumor }, opts = {}) {
  const P = phrasesOf(opts.preset);
  const parts = [fill(P.frame, { core: bare(core) })];
  if (rumor && !/^слух(?![\p{L}])/iu.test(bare(core))) parts.push(P.rumor);
  parts.push(P.outward);
  const last = bare(opts.notAgain);
  if (last && last !== bare(core)) parts.push(fill(P.notAgain, { last }));
  return oneLine(parts.filter(Boolean).join(' '), HOOK_TEXT_MAX);
}

export function draftHook(state, ref, opts = {}) {
  const c = hookCore(state, ref, opts);
  if (!c) return null;
  return { ...c, text: hookWording(c, opts) };
}

export function takeHook(plot, state, what = {}) {
  const p = normalizePlot(plot);
  const ref = str(what.ref);
  const c = hookCore(state, ref, what);
  if (!c) return { ok: false, plot: p, state, error: 'этой записи больше нет' };
  if (p.queue.some((h) => h.ref === ref)) return { ok: false, plot: p, state, error: 'этот повод уже ждёт своего ответа' };
  if (p.queue.filter((h) => h.kind !== BULLY_KIND).length >= QUEUE_MAX) return { ok: false, plot: p, state, error: `в очереди уже ${QUEUE_MAX} — уберите лишний` };
  const text = oneLine(what.text, HOOK_TEXT_MAX) || hookWording(c, what);
  p.seq += 1;
  const id = `p${p.seq}`;
  p.queue.push({
    id, ref, kind: c.kind, core: c.core, text, rumor: c.rumor,
    auto: what.auto === true, armed: false, delivered: false, takenAt: p.replies,
  });
  let next = state;
  if (c.kind === 'item') {
    next = cloneState(state);
    setStatus(next, ref, 'taken');
  }
  return { ok: true, plot: p, state: next, id };
}

export function dropHook(plot, state, id) {
  const p = normalizePlot(plot);
  const at = p.queue.findIndex((h) => h.id === id);
  if (at < 0) return { ok: false, plot: p, state };
  const [h] = p.queue.splice(at, 1);
  let next = state;
  if (h.delivered) toLog(p, h);
  else if (h.kind === 'item') {
    next = cloneState(state);
    const item = normalizeFeed(next.feed).items.find((x) => x.id === h.ref);
    if (item && item.status === 'taken') setStatus(next, h.ref, 'new');
  }
  return { ok: true, plot: p, state: next };
}

export function armedHook(plot) {
  return normalizePlot(plot).queue.find((h) => h.armed) || null;
}

export function hookPrompt(plot) {
  const p = normalizePlot(plot);
  const h = p.queue.find((x) => x.armed);
  return [h && h.text, ...p.queue.filter((x) => x.kind === INVITE_KIND).map((x) => x.text)].filter(Boolean).join(' ');
}

function arm(p) {
  if (p.queue.some((h) => h.armed)) return p;
  const head = p.queue.find((h) => !SELF_KINDS.includes(h.kind));
  if (head) {
    head.armed = true;
    head.delivered = false;
  }
  return p;
}

function toLog(p, h) {
  p.log = [...p.log.filter((e) => e.id !== h.id), {
    id: h.id, ref: h.ref, kind: h.kind, core: h.core, plate: h.plate, deliveredAt: p.replies,
  }].slice(-LOG_MAX);
  p.lastCore = h.core;
}

export function onGeneration(plot, { enabled = true, muted = false, yielded = false } = {}) {
  const p = normalizePlot(plot);
  if (!enabled || muted) return p;
  if (yielded) return yieldTo(p);
  return arm(p);
}

function yieldTo(p) {
  for (const h of p.queue) {
    if (h.armed && !h.delivered) h.armed = false;
  }
  return p;
}

export function bullyHookPrompt(plot) {
  return normalizePlot(plot).queue.filter((x) => x.kind === BULLY_KIND).map((x) => x.text).filter(Boolean).join(' ');
}

export function onPlayerSent(plot, { enabled = true, muted = false, yielded = false } = {}) {
  const p = normalizePlot(plot);
  const sent = p.queue.filter((h) => h.armed && h.delivered);
  for (const h of sent) toLog(p, h);
  p.queue = p.queue.filter((h) => !(h.armed && h.delivered));
  if (!enabled || muted) {
    for (const h of p.queue) h.armed = false;
    return { plot: p, sent };
  }
  if (yielded) return { plot: yieldTo(p), sent };
  return { plot: arm(p), sent };
}

export function onReply(plot, { fresh = false, delivered = true } = {}) {
  const p = normalizePlot(plot);
  if (fresh) p.replies += 1;
  let carried = false;
  if (delivered) {
    for (const h of p.queue) {
      if (!h.armed) continue;
      if (!h.delivered) carried = true;
      h.delivered = true;
    }
  }
  if (carried) p.hookAt = p.replies;
  return p;
}

export function expireHooks(plot, state) {
  const p = normalizePlot(plot);
  const young = (e) => p.replies - e.deliveredAt < PLOT_EXPIRE;
  p.log = p.log.filter(young);
  const alive = new Set([...p.queue.map((h) => h.ref), ...p.log.map((e) => e.ref)]);
  const stale = feedItems(state).filter((x) => x.status === 'taken' && !alive.has(x.id));
  if (!stale.length) return { plot: p, state, expired: [] };
  const next = cloneState(state);
  for (const x of stale) setStatus(next, x.id, 'expired');
  return { plot: p, state: next, expired: stale.map((x) => x.id) };
}

export function dropStale(plot, state) {
  const p = normalizePlot(plot);
  const deals = normalizeFeed(state && state.feed).deals;
  const items = feedItems(state);
  const dead = (ref) => {
    const post = items.find((x) => x.id === ref);
    const id = post ? (/^prep=(.+)$/.exec(post.factRef || '') || [])[1] : ref;
    if (!id) return false;
    const deal = deals.find((d) => d.id === id);
    return post ? !deal || !deal.open : Boolean(deal && deal.intent && !deal.open);
  };
  const gone = p.queue.filter((h) => (h.kind === 'item' || h.kind === 'deal') && dead(h.ref));
  if (!gone.length) return p;
  for (const h of gone) if (h.delivered) toLog(p, h);
  p.queue = p.queue.filter((h) => !gone.includes(h));
  return p;
}

export function secretaryHooks(plot, state) {
  const p = normalizePlot(plot);
  const items = new Map(feedItems(state).map((x) => [x.id, x]));
  const pend = state && state.invites && state.invites.pending;
  const open = (e) => e.kind === 'deal'
    || (e.kind === INVITE_KIND && Boolean(pend) && pend.hookId === e.id && pend.played !== true)
    || (e.kind === BULLY_KIND && !(Number.isInteger(e.takenAt) && p.replies <= e.takenAt))
    || (items.get(e.ref) && items.get(e.ref).status === 'taken');
  const list = [
    ...p.queue.filter((h) => h.delivered || SELF_KINDS.includes(h.kind)),
    ...[...p.log].reverse(),
  ].filter(open);
  const out = [];
  for (const e of list) {
    if (out.some((x) => x.id === e.id)) continue;
    out.push({ id: e.id, ref: e.ref, text: e.core });
    if (out.length >= SECRETARY_HOOKS) break;
  }
  return out;
}

export function hookById(plot, id) {
  const p = normalizePlot(plot);
  return p.queue.find((h) => h.id === id) || p.log.find((e) => e.id === id) || null;
}

export function knownHooks(plot) {
  const p = normalizePlot(plot);
  const out = [];
  for (const h of [...p.queue, ...p.log]) {
    if (!out.some((x) => x.id === h.id)) out.push({ id: h.id, text: h.core || h.text, ...(h.plate ? { plate: h.plate } : {}) });
  }
  return out;
}

export function playedRefs(plot, ids) {
  const out = [];
  for (const id of [].concat(ids || [])) {
    const h = hookById(plot, id);
    if (h && h.kind === 'item' && !out.includes(h.ref)) out.push(h.ref);
  }
  return out;
}

export function syncInviteHook(plot, state, words) {
  const p = normalizePlot(plot);
  const pend = state && state.invites && state.invites.pending;
  const want = pend && !pend.played ? str(pend.hookId) : '';
  if (pend && pend.played) for (const h of p.queue) if (h.kind === INVITE_KIND && h.id === str(pend.hookId)) toLog(p, h);
  p.queue = p.queue.filter((h) => h.kind !== INVITE_KIND || h.id === want);
  if (want && words && !p.queue.some((h) => h.id === want) && p.queue.length < QUEUE_MAX) {
    p.log = p.log.filter((e) => e.id !== want);
    p.queue.push({
      id: want, ref: `invite:${str(pend.key)}`, kind: INVITE_KIND, core: oneLine(words.core, CORE_MAX),
      plate: oneLine(words.plate, CORE_MAX), text: oneLine(words.text, HOOK_TEXT_MAX), rumor: false, auto: false, armed: false, delivered: false, takenAt: p.replies,
    });
  }
  return p;
}

export function syncBullyHook(plot, words, { hookId = '', resolved = '' } = {}) {
  const p = normalizePlot(plot);
  const gone = p.queue.filter((h) => h.kind === BULLY_KIND && h.id !== hookId);
  for (const h of gone) if (resolved && h.id === resolved) toLog(p, h);
  p.queue = p.queue.filter((h) => h.kind !== BULLY_KIND || h.id === hookId);
  if (hookId && words && !p.queue.some((h) => h.id === hookId)) {
    p.log = p.log.filter((e) => e.id !== hookId);
    p.queue.push({
      id: hookId, ref: `bully:${hookId}`, kind: BULLY_KIND, core: oneLine(words.core, CORE_MAX), plate: oneLine(words.plate, CORE_MAX),
      text: oneLine(words.text, BULLY_HOOK_MAX), rumor: false, auto: false, armed: false, delivered: false, takenAt: p.replies,
    });
  }
  return p;
}

export function autoPick(plot, state, opts = {}) {
  const p = normalizePlot(plot);
  const none = { plot: p, state, id: null };
  if (!opts.enabled || opts.muted || opts.yielded || p.queue.some((h) => h.kind !== BULLY_KIND)) return none;
  const day = (state && state.calendar && state.calendar.day) || '';
  const fresh = (x) => {
    if (!x.at || !x.at.day || !day) return false;
    try {
      const d = diffDays(x.at.day, day);
      return d >= 0 && d <= AUTO_FRESH_DAYS;
    } catch {
      return false;
    }
  };
  const list = feedItems(state)
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => !x.parent && !x.minor && x.status === 'new' && fresh(x) && !/^event=/.test(x.factRef || '')
      && !(/^prep=/.test(x.factRef || '') && !x.heroine));
  if (!list.length) return none;
  list.sort((a, b) => ((b.x.loud ?? 1) - (a.x.loud ?? 1))
    || (Number(a.x.read) - Number(b.x.read))
    || (b.i - a.i));
  const last = p.hookAt !== null ? p.hookAt : (p.autoAt !== null ? p.autoAt + 1 : null);
  for (const { x: top } of list) {
    const pause = (top.loud ?? 1) >= 2 ? AUTO_PAUSE_LOUD : AUTO_PAUSE;
    if (last !== null && p.replies + 1 - last < pause) continue;
    const res = takeHook(p, state, {
      ref: top.id, auto: true, heroine: opts.heroine, preset: opts.preset, notAgain: p.lastCore,
    });
    if (!res.ok) continue;
    res.plot.autoAt = res.plot.replies;
    return { plot: arm(res.plot), state: res.state, id: res.id };
  }
  return none;
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function int(v, fallback) {
  return Number.isInteger(v) && v >= 0 ? v : fallback;
}

function oneLine(v, max) {
  return str(v).replace(/\s+/g, ' ').slice(0, max).trim();
}

function bare(v) {
  return str(v).replace(/[\s.;,]+$/u, '');
}

function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

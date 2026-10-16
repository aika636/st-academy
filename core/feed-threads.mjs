import {
  THREADS_MAX, THREAD_MEMBERS, THREAD_SOURCES, THREAD_TEXT_MAX, PAUSED_MAX, ARCHIVE_MAX, IDLE_ARCHIVE, STALE_MAX, AFFAIR_TURNS,
  ensureFeed, normalizeFeed, freeId, normalizeThread,
} from './feed.mjs';
import { castOf, similar, rumorAuthors, worldPreset } from './feed-cast.mjs';
import { feedWorldTopics, clipText } from './feed.mjs';
import { holidaysAhead } from './holidays.mjs';
import { upcomingEvents } from './upcoming.mjs';
import { subjectWord } from './words.mjs';
import { diffDays, addDays, mondayOf, preExamWeek, preExamWord } from './time.mjs';

export const CALENDAR_HORIZON = 14;

export const AFTER_EVENT_DAYS = 2;

const copy = (t) => ({ ...t, members: [...t.members] });
const inState = (state, name) => normalizeFeed(state && state.feed).threads.filter((t) => t.state === name).map(copy);

export function openThreads(state) {
  return inState(state, 'active');
}

export function pausedThreads(state) {
  return inState(state, 'paused');
}

export function archivedThreads(state) {
  return inState(state, 'archived');
}

export function allThreads(state) {
  return normalizeFeed(state && state.feed).threads.map(copy);
}

export function threadRoom(state) {
  return Math.max(0, THREADS_MAX - openThreads(state).length);
}

export function hasTopic(state, topic) {
  return normalizeFeed(state && state.feed).threads.some((t) => similar(t.topic, topic));
}

export function startThread(state, spec) {
  const feed = ensureFeed(state);
  const s = spec && typeof spec === 'object' ? spec : {};
  const full = feed.threads.filter((t) => t.state === 'active').length >= THREADS_MAX;
  if (full && !(s.paused && feed.threads.filter((t) => t.state === 'paused').length < PAUSED_MAX)) return { ok: false, reason: 'full' };
  if (feed.threads.some((t) => similar(t.topic, s.topic))) return { ok: false, reason: 'duplicate' };
  const used = new Set([...feed.threads.map((t) => t.id), ...feed.items.filter((x) => x.occ && x.occ.kind === 'affair').map((x) => x.occ.ref)]);
  const thread = normalizeThread({
    id: freeId('t', used),
    topic: s.topic,
    members: s.members,
    owner: s.owner,
    want: s.want !== undefined ? s.want : s.dispute,
    last: s.last,
    question: s.question,
    source: s.source,
    since: s.day,
    on: s.on,
    state: full ? 'paused' : 'active',
  }, new Set(feed.cast.map((m) => m.id)));
  if (!thread) return { ok: false, reason: 'bad' };
  feed.threads.push(thread);
  return { ok: true, thread: copy(thread) };
}

export function archiveThread(state, id) {
  const feed = ensureFeed(state);
  const t = feed.threads.find((x) => x.id === id);
  if (!t || t.state === 'archived') return false;
  t.state = 'archived';
  const old = feed.threads.filter((x) => x.state === 'archived');
  const drop = new Set(old.slice(0, Math.max(0, old.length - ARCHIVE_MAX)).map((x) => x.id));
  feed.threads = feed.threads.filter((x) => !drop.has(x.id));
  return true;
}

export function pruneThreads(state) {
  const feed = ensureFeed(state);
  const known = new Set([...feed.cast.map((m) => m.id), ...((state && state.classmates) || []).map((c) => c && c.id)]);
  const traits = (t) => t.source === 'cast' && (!isWish(t.topic) || ((state && state.classmates) || []).some((c) => c && t.members.includes(c.id) && c.problem && similar(c.problem, t.topic)));
  feed.threads = feed.threads.filter((t) => t.state === 'archived' || !traits(t));
  for (const t of feed.threads) {
    t.members = t.members.filter((id) => known.has(id));
    if (!t.members.includes(t.owner)) t.owner = t.members[0] || '';
  }
  feed.threads = feed.threads.filter((t) => t.members.length);
}

export function closeThread(state, id) {
  const feed = ensureFeed(state);
  const at = feed.threads.findIndex((t) => t.id === id);
  if (at < 0) return false;
  feed.threads.splice(at, 1);
  return true;
}

export function noteThreads(state, { touched = new Set(), changed = new Set() } = {}, day = '') {
  const feed = ensureFeed(state);
  const archived = [];
  for (const t of feed.threads) {
    if (t.state !== 'active') continue;
    if (touched.has(t.id)) {
      t.idle = 0;
      t.stale = changed.has(t.id) ? 0 : Math.min(t.stale + 1, 9);
      t.turns = Math.min((t.turns || 0) + 1, 99);
      if (threadOver(t, day) || t.turns >= AFFAIR_TURNS) archived.push(t.id);
    } else {
      t.idle = Math.min(t.idle + 1, 9);
      if (t.idle >= IDLE_ARCHIVE) archived.push(t.id);
    }
  }
  for (const id of archived) archiveThread(state, id);
  return { archived };
}

export const isEnding = (t) => Boolean(t) && (t.turns || 0) >= AFFAIR_TURNS - 1;

export const isStale = (t) => Boolean(t) && t.stale >= STALE_MAX;

function load(state) {
  const n = new Map();
  for (const t of openThreads(state)) for (const id of t.members) n.set(id, (n.get(id) || 0) + 1);
  return n;
}

function pickMembers(state, { three = false } = {}) {
  const cast = castOf(state);
  const byId = new Map(cast.map((m) => [m.id, m]));
  const busy = load(state);
  const linked = cast.filter((m) => m.rival && byId.has(m.rival)).map((m) => ({ a: m, b: byId.get(m.rival) }));
  const near = cast.length >= 2 ? cast.map((m, i) => ({ a: m, b: cast[(i + 1) % cast.length] })).filter((x) => x.a.id !== x.b.id) : [];
  const pairs = (linked.length ? linked : near)
    .map((p, i) => ({ ...p, i }))
    .sort((x, y) => (busy.get(x.a.id) || 0) + (busy.get(x.b.id) || 0) - (busy.get(y.a.id) || 0) - (busy.get(y.b.id) || 0) || x.i - y.i);
  return pairs.map(({ a, b }) => {
    const third = three && a.ally && a.ally !== b.id && byId.has(a.ally) ? byId.get(a.ally) : null;
    return { a, b, third };
  });
}

const NOT_WISH = /^(?:убежд|счита|уверен|верит|полагает|думает|боит|страдает|склонн|неспособн|постоянн|ранни|переживает|ненавидит)/iu;

export const isWish = (text) => {
  const t = String(text == null ? '' : text).trim();
  return Boolean(t) && !NOT_WISH.test(t);
};

function wantOf(a, b, own) {
  if (own) return isWish(a.goal) ? `${a.nick} хочет: ${a.goal}` : '';
  return `${a.nick} и ${b.nick} заняты этим вместе`;
}

export const MATES_MIN = 8;

export function worldTopicsOf(state, preset) {
  return state && state.survey && String(state.survey.canon || '').trim() ? [] : feedWorldTopics(preset);
}

function orderedMates(state, stop) {
  const busy = load(state);
  const seen = new Map();
  for (const t of allThreads(state)) for (const id of t.members) seen.set(id, (seen.get(id) || 0) + 1);
  return rumorAuthors(state, { stop }).filter((a) => a.kind === 'classmate')
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (busy.get(x.a.id) || 0) - (busy.get(y.a.id) || 0) || (seen.get(x.a.id) || 0) - (seen.get(y.a.id) || 0) || x.i - y.i)
    .map(({ a }) => a);
}

function mateTopics(state, preset, stop) {
  const list = orderedMates(state, stop);
  const out = [];
  for (const a of list) {
    const b = list.find((x) => x.id !== a.id);
    if (!isWish(a.desire) || !b) continue;
    out.push({ topic: clip(a.desire, THREAD_TEXT_MAX.topic), ids: [a.id, b.id], want: `${a.name} хочет: ${a.desire}` });
  }
  return [...out, ...worldTopicsOf(state, preset).map((topic) => ({ topic: clip(topic, THREAD_TEXT_MAX.topic) }))];
}

function clip(s, max) {
  return clipText(s, max);
}

function eventEnd(holiday, start) {
  if (holiday.dated && /^\d{4}-\d{2}-\d{2}$/.test(String(holiday.to))) return holiday.to;
  if (holiday.shift !== undefined) {
    return Number.isInteger(holiday.days) ? addDays(start, Math.min(holiday.days - 1, 30)) : start;
  }
  const from = String(holiday.from || '');
  const to = String(holiday.to || '');
  if (!/^\d{2}-\d{2}$/.test(from) || !/^\d{2}-\d{2}$/.test(to)) return start;
  let span = diffDays(`2001-${from}`, `2001-${to}`);
  if (span < 0) span += 365;
  return addDays(start, Math.min(span, 30));
}

export function calendarTopics(state, preset) {
  const day = state && state.calendar && state.calendar.day;
  if (!day) return [];
  const out = holidaysAhead(worldPreset(state, preset), day, CALENDAR_HORIZON, state).filter(({ holiday }) => !holiday.auto).map(({ holiday, days, day: start }) => ({
    topic: clip(holiday.name, THREAD_TEXT_MAX.topic), days, on: eventEnd(holiday, start),
  }));
  if (preExamWeek(preset, state, day)) out.push({ topic: clip(preExamWord(preset), THREAD_TEXT_MAX.topic), days: 0, on: addDays(mondayOf(day), 6) });
  return out;
}

export function studyTopics(state, preset) {
  const day = state && state.calendar && state.calendar.day;
  if (!day) return [];
  const subjects = new Map(((state && state.subjects) || []).filter((s) => s && s.id).map((s) => [s.id, s.name || s.id]));
  const out = [];
  for (const e of upcomingEvents(state, preset, { horizon: CALENDAR_HORIZON, limit: 4 })) {
    const name = e.subjectId ? subjects.get(e.subjectId) : '';
    const on = Number.isFinite(e.days) ? addDays(day, e.days) : '';
    if (e.kind === 'announce') out.push({ topic: clip(name ? `итоги: ${name}` : 'итоги сессии', THREAD_TEXT_MAX.topic), days: e.days, on });
    else out.push({ topic: clip(name ? `${e.what}: ${name}` : e.what || 'контрольные', THREAD_TEXT_MAX.topic), days: e.days, on });
  }
  if (!out.length && subjects.size) {
    const names = [...subjects.values()];
    const n = Math.abs(diffDays('2000-01-01', day)) % names.length;
    out.push({ topic: clip(`задание по ${subjectWord(preset, 'dat')} «${names[n]}»`, THREAD_TEXT_MAX.topic), days: null });
  }
  return out;
}

function pairTopics(state, preset) {
  const pairs = pickMembers(state).map(({ a, b }) => ({
    topic: clip((isWish(a.goal) && a.goal) || a.interest || b.interest || `${a.nick} и ${b.nick}`, THREAD_TEXT_MAX.topic),
    pair: [a.id, b.id],
  }));
  return [...pairs, ...worldTopicsOf(state, preset).map((topic) => ({ topic: clip(topic, THREAD_TEXT_MAX.topic) }))];
}

export function settleThreads(state, day) {
  const out = { closed: [], settled: [] };
  const today = String(day || (state && state.calendar && state.calendar.day) || '');
  if (!today) return out;
  for (const t of ensureFeed(state).threads) {
    if (t.state === 'archived' || !t.on || !isPast(t.on, today)) continue;
    if (diffDays(t.on, today) > AFTER_EVENT_DAYS) out.closed.push(t.id);
    else if (t.state === 'active') out.settled.push(t.id);
  }
  for (const id of out.closed) archiveThread(state, id);
  return out;
}

function isPast(on, today) {
  try {
    return diffDays(on, today) > 0;
  } catch {
    return false;
  }
}

export function threadOver(thread, day) {
  return Boolean(thread && thread.on && day && isPast(thread.on, day));
}

export function spawnThread(state, preset, opts = {}) {
  const feed = ensureFeed(state);
  if (feed.threads.filter((t) => t.state === 'active').length >= THREADS_MAX) return { ok: false, reason: 'full' };
  const waiting = !opts.source && feed.threads.find((t) => t.state === 'paused');
  if (waiting) {
    waiting.state = 'active';
    waiting.idle = 0;
    return { ok: true, thread: copy(waiting), resumed: true };
  }
  const mates = orderedMates(state, opts.stop).length >= MATES_MIN;
  if (feed.cast.length < 2 && !mates) return { ok: false, reason: 'no-cast' };
  const day = opts.day || (state && state.calendar && state.calendar.day) || '';
  const open = (src) => feed.threads.filter((t) => t.state === 'active' && t.source === src).length;
  const order = THREAD_SOURCES.includes(opts.source)
    ? [opts.source]
    : [...THREAD_SOURCES].sort((x, y) => open(x) - open(y) || THREAD_SOURCES.indexOf(x) - THREAD_SOURCES.indexOf(y));
  let last = 'no-topic';
  for (const source of order) {
    const topics = source === 'calendar' ? calendarTopics(state, preset)
      : source === 'study' ? studyTopics(state, preset)
        : mates ? mateTopics(state, preset, opts.stop) : pairTopics(state, preset);
    for (const t of topics) {
      if (!t.topic || hasTopic(state, t.topic)) continue;
      let members;
      let want;
      if (t.ids) {
        ({ ids: members, want } = t);
      } else if (mates) {
        const [a, b] = orderedMates(state, opts.stop);
        members = [a.id, b.id];
        want = `${a.name} и ${b.name} заняты этим вместе`;
      } else {
        const pairs = pickMembers(state, { three: source === 'calendar' });
        const own = t.pair && pairs.find((p) => p.a.id === t.pair[0] && p.b.id === t.pair[1]);
        const chosen = own || pairs[0];
        if (!chosen) {
          last = 'no-pair';
          continue;
        }
        members = [chosen.a.id, chosen.b.id, ...(chosen.third ? [chosen.third.id] : [])].slice(0, THREAD_MEMBERS[1]);
        want = wantOf(chosen.a, chosen.b, Boolean(own));
      }
      const res = startThread(state, { topic: t.topic, members, want, source, day, on: t.on });
      if (res.ok) return res;
      last = res.reason;
    }
  }
  return { ok: false, reason: last };
}

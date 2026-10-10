// core/feed-threads — сюжетики массовки (шаг 1 плана «Молва», `etap-molva.md`).
//
// Сюжетик — то, о чём статисты спорят несколько выпусков подряд: бал, зачёт,
// ссора двух соседей. Не больше трёх одновременно (`THREADS_MAX`), у каждого от
// двух до трёх участников из каста, тема, «о чём спорят» и стадия:
// завязка → спор → торг → развязка. После развязки сюжетик закрывается и
// освобождает место.
//
// Всё, что можно решить кодом, решает код (решение владелицы 09.10: «повестку
// выбирает код, модель только пишет реплики»): откуда взялся сюжетик (календарь,
// учёба, пара «союзник/соперник» каста), кто в нём участвует, на какой он стадии.
// Модель в шаге 2 получает готовые тему, участников и стадию и пишет реплики.
//
// Функции правят переданное состояние на месте, как `core/feed.mjs`: их зовут
// на рабочей копии вызывающего. Сюжетики лежат в `state.feed.threads` и
// откатываются свайпом вместе со всей лентой.

import {
  THREADS_MAX, THREAD_MEMBERS, STAGES, THREAD_SOURCES, THREAD_TEXT_MAX, ensureFeed, normalizeFeed, freeId, normalizeThread,
} from './feed.mjs';
import { castOf, similar } from './feed-cast.mjs';
import { feedWorldTopics, clipText } from './feed.mjs';
import { holidaysAhead } from './holidays.mjs';
import { upcomingEvents } from './upcoming.mjs';
import { diffDays, addDays } from './time.mjs';

/** За сколько дней вперёд календарь даёт тему сюжетика. */
export const CALENDAR_HORIZON = 14;

/** Сколько дней после события сюжетик ещё подводит итог; дальше он закрывается (баг 64). */
export const AFTER_EVENT_DAYS = 2;

// Читают через `normalizeFeed`, а не `ensureFeed`: тот заводит поле заново, и
// ссылка на ленту, взятая до чтения, смотрела бы на прежнюю копию.

/** Открытые сюжетики — копия списка. */
export function openThreads(state) {
  return normalizeFeed(state && state.feed).threads.map((t) => ({ ...t, members: [...t.members] }));
}

/** Сколько мест ещё свободно. */
export function threadRoom(state) {
  return Math.max(0, THREADS_MAX - normalizeFeed(state && state.feed).threads.length);
}

/**
 * Есть ли уже открытый сюжетик на эту тему — по грубому сравнению, не только
 * по равенству: «Зимний бал» и «зимний бал: билеты» — одна тема.
 */
export function hasTopic(state, topic) {
  return normalizeFeed(state && state.feed).threads.some((t) => similar(t.topic, topic));
}

/**
 * Завести сюжетик. Темы дважды не заводятся, лимит три — жёсткий, участники —
 * только из каста.
 *
 * @param {Object} state
 * @param {{topic: string, members: string[], dispute?: string, source?: string, day?: string, on?: string}} spec
 *   `on` — день, когда событие кончается (для календаря и учёбы)
 * @returns {{ok: true, thread: Object} | {ok: false, reason: 'full'|'duplicate'|'bad'}}
 */
export function startThread(state, spec) {
  const feed = ensureFeed(state);
  if (feed.threads.length >= THREADS_MAX) return { ok: false, reason: 'full' };
  const s = spec && typeof spec === 'object' ? spec : {};
  if (feed.threads.some((t) => similar(t.topic, s.topic))) return { ok: false, reason: 'duplicate' };
  const used = new Set(feed.threads.map((t) => t.id));
  const thread = normalizeThread({
    id: freeId('t', used),
    topic: s.topic,
    members: s.members,
    dispute: s.dispute,
    stage: STAGES[0],
    source: s.source,
    since: s.day,
    on: s.on,
  }, new Set(feed.cast.map((m) => m.id)));
  if (!thread) return { ok: false, reason: 'bad' };
  feed.threads.push(thread);
  return { ok: true, thread: { ...thread, members: [...thread.members] } };
}

/**
 * Продвинуть сюжетик на одну стадию. С «развязки» — следующего шага нет, и
 * сюжетик закрывается: место освобождается.
 *
 * @returns {?{id: string, stage: string, closed: boolean}} `null` — такого нет
 */
export function advanceThread(state, id) {
  const feed = ensureFeed(state);
  const at = feed.threads.findIndex((t) => t.id === id);
  if (at < 0) return null;
  const next = STAGES.indexOf(feed.threads[at].stage) + 1;
  if (next >= STAGES.length) {
    const [gone] = feed.threads.splice(at, 1);
    return { id: gone.id, stage: gone.stage, closed: true };
  }
  feed.threads[at].stage = STAGES[next];
  feed.threads[at].idle = 0;
  return { id, stage: STAGES[next], closed: false };
}

/** Закрыть сюжетик досрочно (человек убрал, участник ушёл). @returns {boolean} */
export function closeThread(state, id) {
  const feed = ensureFeed(state);
  const at = feed.threads.findIndex((t) => t.id === id);
  if (at < 0) return false;
  feed.threads.splice(at, 1);
  return true;
}

// --- заведение кодом -----------------------------------------------------------------

/** Сколько сюжетиков уже держит каждый статист. */
function load(state) {
  const n = new Map();
  for (const t of normalizeFeed(state && state.feed).threads) for (const id of t.members) n.set(id, (n.get(id) || 0) + 1);
  return n;
}

/**
 * Пара для сюжетика: статист и его соперник, оба наименее занятые другими
 * сюжетиками. Третьим — союзник первого, если он свободен и просили троих.
 * Каст без связей пару не даёт.
 */
function pickMembers(state, { three = false } = {}) {
  const cast = castOf(state);
  const byId = new Map(cast.map((m) => [m.id, m]));
  const busy = load(state);
  // Без связей (каст правили руками) пары берутся по соседству: сюжетик заводится всё равно.
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

/** «О чём спорят» одной строкой из целей участников; пусто — общая формулировка. */
function disputeOf(a, b, topic) {
  return a.goal
    ? `${a.nick} хочет: ${a.goal}; ${b.nick} с этим не согласен`
    : `${a.nick} и ${b.nick} по-разному видят, как быть с темой «${topic}»`;
}

// Тема не обрывается посреди слова (баг 81): по слову, с «…».
function clip(s, max) {
  return clipText(s, max);
}

/** День, когда событие кончается: у своего события — его последний день, у праздника пресета — по числам. */
function eventEnd(holiday, start) {
  if (holiday.dated && /^\d{4}-\d{2}-\d{2}$/.test(String(holiday.to))) return holiday.to;
  if (holiday.shift !== undefined) {
    // Плавающая дата: даты `from`/`to` — запасные, длительность — `days` или один день.
    return Number.isInteger(holiday.days) ? addDays(start, Math.min(holiday.days - 1, 30)) : start;
  }
  const from = String(holiday.from || '');
  const to = String(holiday.to || '');
  if (!/^\d{2}-\d{2}$/.test(from) || !/^\d{2}-\d{2}$/.test(to)) return start;
  let span = diffDays(`2001-${from}`, `2001-${to}`);
  if (span < 0) span += 365;
  return addDays(start, Math.min(span, 30));
}

/** Темы календаря: ближайшие праздники и события чата, не дальше `CALENDAR_HORIZON` дней. */
export function calendarTopics(state, preset) {
  const day = state && state.calendar && state.calendar.day;
  if (!day) return [];
  return holidaysAhead(preset, day, CALENDAR_HORIZON, state).map(({ holiday, days, day: start }) => ({
    topic: clip(holiday.name, THREAD_TEXT_MAX.topic), days, on: eventEnd(holiday, start),
  }));
}

/** Темы учёбы: ближайшие контрольные и объявления итогов; нет их — предмет дня. */
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
    // Событий нет — тема из быта предмета; какой именно, решает день, без случайности.
    const names = [...subjects.values()];
    const n = Math.abs(diffDays('2000-01-01', day)) % names.length;
    out.push({ topic: clip(`задание по предмету «${names[n]}»`, THREAD_TEXT_MAX.topic), days: null });
  }
  return out;
}

/**
 * Темы пар каста: чем живут двое, что стоят друг у друга на пути. Следом —
 * бытовые темы мира (`feed.worldTopics` пресета): сюжетик заводится и тогда,
 * когда у каста нет ни календаря, ни учёбы, ни ярких интересов.
 */
function pairTopics(state, preset) {
  const pairs = pickMembers(state).map(({ a, b }) => ({
    // Одна тема пресета, а не склейка двух через «или» (баг 81).
    topic: clip(a.interest || b.interest || `${a.nick} и ${b.nick}`, THREAD_TEXT_MAX.topic),
    pair: [a.id, b.id],
  }));
  return [...pairs, ...feedWorldTopics(preset).map((topic) => ({ topic: clip(topic, THREAD_TEXT_MAX.topic) }))];
}

/**
 * Сюжетики, привязанные к событию, после его даты (баг 64): «Мабон» не тянется
 * после Мабона. Событие прошло — сюжетик переходит на «развязку» (подводит итог);
 * прошло больше `AFTER_EVENT_DAYS` дней — закрывается. Правит `state`.
 *
 * @returns {{closed: string[], settled: string[]}} id закрытых и переведённых
 */
export function settleThreads(state, day) {
  const out = { closed: [], settled: [] };
  const today = String(day || (state && state.calendar && state.calendar.day) || '');
  if (!today) return out;
  const feed = ensureFeed(state);
  feed.threads = feed.threads.filter((t) => {
    if (!t.on || !isPast(t.on, today)) return true;
    if (diffDays(t.on, today) > AFTER_EVENT_DAYS || t.stage === STAGES[STAGES.length - 1]) {
      out.closed.push(t.id);
      return false;
    }
    t.stage = STAGES[STAGES.length - 1];
    out.settled.push(t.id);
    return true;
  });
  return out;
}

/** Событие `on` уже позади к дню `today`. */
function isPast(on, today) {
  try {
    return diffDays(on, today) > 0;
  } catch {
    return false;
  }
}

/** Прошёл ли срок события сюжетика (для повестки: «после события»). */
export function threadOver(thread, day) {
  return Boolean(thread && thread.on && day && isPast(thread.on, day));
}

/**
 * Завести один новый сюжетик кодом. Источники по очереди: сначала тот, из
 * которого открыто меньше всего (бал, зачёт и пара каста не вытесняют друг
 * друга), при равенстве — календарь, учёба, пара. Не вышло из одного — следующий.
 *
 * @param {Object} state
 * @param {Object} preset
 * @param {{source?: 'calendar'|'study'|'cast', day?: string}} [opts] `source` — только этот источник
 * @returns {{ok: true, thread: Object} | {ok: false, reason: string}}
 */
export function spawnThread(state, preset, opts = {}) {
  const feed = normalizeFeed(state && state.feed);
  if (feed.threads.length >= THREADS_MAX) return { ok: false, reason: 'full' };
  if (feed.cast.length < 2) return { ok: false, reason: 'no-cast' };
  const day = opts.day || (state && state.calendar && state.calendar.day) || '';
  const open = (src) => feed.threads.filter((t) => t.source === src).length;
  const order = THREAD_SOURCES.includes(opts.source)
    ? [opts.source]
    : [...THREAD_SOURCES].sort((x, y) => open(x) - open(y) || THREAD_SOURCES.indexOf(x) - THREAD_SOURCES.indexOf(y));
  let last = 'no-topic';
  for (const source of order) {
    const topics = source === 'calendar' ? calendarTopics(state, preset)
      : source === 'study' ? studyTopics(state, preset)
        : pairTopics(state, preset);
    for (const t of topics) {
      if (!t.topic || hasTopic(state, t.topic)) continue;
      const pairs = pickMembers(state, { three: source === 'calendar' });
      // Для темы со своей парой (каст) — она; иначе наименее занятая.
      const chosen = (t.pair && pairs.find((p) => p.a.id === t.pair[0] && p.b.id === t.pair[1])) || pairs[0];
      if (!chosen) {
        last = 'no-pair';
        continue;
      }
      const members = [chosen.a.id, chosen.b.id, ...(chosen.third ? [chosen.third.id] : [])].slice(0, THREAD_MEMBERS[1]);
      const res = startThread(state, { topic: t.topic, members, dispute: disputeOf(chosen.a, chosen.b, t.topic), source, day, on: t.on });
      if (res.ok) return res;
      last = res.reason;
    }
  }
  return { ok: false, reason: last };
}

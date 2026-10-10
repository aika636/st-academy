// core/molva — выпуск молвы (шаг 2 плана «Молва», `etap-molva.md`).
//
// Лента была хвостом промпта секретаря: каждый пост обязан был опираться на факт
// сцены, и школьный чат превращался в пересказ ролки. Выпуск молвы — отдельный
// вызов модели, у которого есть свой мир: статисты каста, их сюжетики, календарь.
//
// Решение владелицы 09.10: **повестку собирает код, модель только пишет
// реплики.** Здесь это и лежит.
//
// 1. **Повестка** (`buildAgenda`): слоты «Главные», «Массовка», «Календарь»,
//    «Мир». В каждом слоте код заранее назначает автора, отвечающего и
//    разногласие. Размер выпуска зависит от частоты (`issueSize`): раз в ответ —
//    один-два треда, раз в несколько — три-четыре слота.
// 2. **Квота на главных**: о героине и персонаже бота — не больше трети по окну
//    последних двадцати тредов (`mainRoom`); слот «Главные» появляется, только
//    если с прошлого выпуска был новый публичный факт. Сцена «наедине» попадает
//    реже (через выпуск) и только слухом — через статиста, что подслушал.
// 3. **Промпт** (`buildMolvaPrompt`): короткий, намерения и вопросы можно,
//    свершившиеся события без источника — нельзя.
// 4. **Разбор и проверки** (`parseIssue`): построчный формат `П1 | ник | текст`
//    (пост слота 1) и `О1 | ник | текст` (ответ в ветке слота 1). Ответ
//    привязан к посту НОМЕРОМ СЛОТА, который расставил код, а не позицией
//    строки: ответ про турнир не уедет под пост о помолвке (баг 55). Автор —
//    из каста или «Людей»; не героиня и не персонаж карточки; самоответ до
//    чужого ответа и два поста подряд от одного автора выкидываются; оборванная
//    строка (баг 56) тоже.
// 5. **Запись** (`applyIssue`, `replayMolva`): выпуск ложится в `state.feed` и
//    запоминается дельтой, привязанной к ответу бота, — свайп откатывает его, как
//    всю ленту, а пересчёт того же ответа кладёт обратно.
//
// Вызов модели — в `api.js` (`generateMolva`) и `index.js`: ядро о сети не знает.

import { heroWords, presetGender } from './gender.mjs';
import {
  FEED_TEXT_MAX, FACT_TEXT_MAX, MOLVA_FACTS_MAX, MOLVA_TOPICS_MAX, normalizeFeed, normalizeItem, normalizeThreads, addFeedItem, ensureFeed,
  feedItems, hash, feedWorldTopics, THREADS_MAX, MOLVA_LEADS_MAX, CALENDAR_GAP, clipText,
} from './feed.mjs';
import { castOf, rumorAuthors, worldRealities, calendarNames, textKey, similar, brokenManner, foreignSpell, END_MARK } from './feed-cast.mjs';
import { openThreads, spawnThread, advanceThread, settleThreads, threadOver, studyTopics, CALENDAR_HORIZON } from './feed-threads.mjs';
import { holidaysOn, holidaysAhead } from './holidays.mjs';
import { normName } from './stop-names.mjs';
import { diffDays, addDays } from './time.mjs';
import { shortName } from './scene.mjs';

/** Окно, по которому считается доля главных, — последние тредов. */
export const WINDOW = 20;

/** Меньше этого окно в расчёте не считается: на пустой ленте квота не должна запрещать всё. */
export const MIN_WINDOW = 6;

/** Сколько игровых дней факт ещё «новый» для молвы. */
export const FACT_DAYS = 3;

/** Меньше стольких букв реплика — не реплика. */
export const MIN_LETTERS = 3;

/** Ответ короче стольких знаков — не ответ по существу («Грубый выпад.», баг 66). */
export const REPLY_MIN = 25;
/** Сколько последних реплик автора помнят проверка оборотов и промпт. */
export const RECENT_OWN = 3;

/** Сколько ветвей прошлого видит модель как «израсходованные». */
export const RECENT_BRANCHES = 6;

/** Сколько выпусков-дельт держит ход (свайп туда и обратно). */
export const DELTAS_KEPT = 4;

/** Сколько выпусков подряд сюжетик может стоять: на третьем он идёт на следующую стадию сам. */
export const IDLE_MAX = 3;

/** Откуда id записей выпуска. */
const SRC = 'molva-';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const clip = (v, max) => str(v).replace(/\s+/g, ' ').slice(0, max).trim();
const clone = (v) => JSON.parse(JSON.stringify(v));

// --- размер и частота ---------------------------------------------------------------

/**
 * Сколько слотов в выпуске при частоте «раз в `every` ответов». Раз в ответ —
 * маленький выпуск, чтобы частые обновления не превращались в простыню; кнопка
 * (0) и редкие выпуски — полные.
 *
 * @returns {{min: number, max: number}}
 */
export function issueSize(every) {
  const n = Math.trunc(Number(every));
  if (!(n >= 1)) return { min: 3, max: 4 };
  if (n === 1) return { min: 1, max: 2 };
  if (n === 2) return { min: 2, max: 3 };
  return { min: 3, max: 4 };
}

/** Частота из настроек: целое от 1, мусор — 3. */
export function everyOf(raw) {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 99) : 3;
}

/** Счёт в состоянии: ещё один ответ бота прошёл. Состояние не правится, возвращается копия. */
export function tickMolva(state) {
  const feed = normalizeFeed(state && state.feed);
  return { ...state, feed: { ...feed, molva: { ...feed.molva, since: feed.molva.since + 1 } } };
}

/** Пора ли выпускать: включён автомат и с прошлого выпуска прошло достаточно ответов. */
export function molvaDue(state, { every = 3, manual = false } = {}) {
  if (manual) return false;
  const feed = normalizeFeed(state && state.feed);
  return feed.molva.since >= everyOf(every);
}

// --- что было с прошлого выпуска ----------------------------------------------------------

function freshFact(x, day) {
  if (!day || !x.at || !x.at.day) return true;
  try {
    const d = diffDays(x.at.day, day);
    return Number.isFinite(d) && d >= 0 && d <= FACT_DAYS;
  } catch {
    return true;
  }
}

/**
 * Новые факты ленты, что ещё не были темой молвы: публичные (стычка при людях) и
 * подслушанные (слух из сцены, сцена наедине). Громкие первыми, потом свежие.
 *
 * @returns {{open: Object[], overheard: Object[]}}
 */
export function newFacts(state) {
  const feed = normalizeFeed(state && state.feed);
  const used = new Set(feed.molva.facts);
  const day = state && state.calendar && state.calendar.day;
  const list = feed.items
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => x.kind === 'fact' && x.status !== 'expired' && !used.has(x.id) && freshFact(x, day))
    // Заметные факты из разбора (прогул, опоздание, провал) — после стычек и слухов.
    .sort((a, b) => (Number(a.x.minor === true) - Number(b.x.minor === true)) || ((b.x.loud ?? 1) - (a.x.loud ?? 1)) || (b.i - a.i))
    .map(({ x }) => x);
  return { open: list.filter((x) => !x.rumor && !x.private), overheard: list.filter((x) => x.rumor || x.private) };
}

/** Доля главных в окне: сколько тредов о героине из последних. */
export function mainShare(state, window = WINDOW) {
  const roots = feedItems(state).filter((x) => x.kind === 'reaction' && !x.parent).slice(-window);
  return { main: roots.filter((x) => x.heroine).length, total: roots.length };
}

/**
 * Можно ли добавить ещё `adding` тредов о главных, если в выпуске всего `slots`:
 * доля не больше трети окна. Окно короче `MIN_WINDOW` считается за `MIN_WINDOW`.
 */
export function mainRoom(state, adding, slots) {
  const { main, total } = mainShare(state);
  return (main + adding) * 3 <= Math.max(total + slots, MIN_WINDOW);
}

// --- люди --------------------------------------------------------------------------------

const keyOfItem = (x) => (x.nick ? `n:${normName(x.nick)}` : x.who ? `w:${x.who}` : '');
const keyOfAuthor = (a) => (a.kind === 'cast' ? `n:${normName(a.name)}` : `w:${a.id}`);

/** Автор для повестки и разбора — без лишнего. */
function slim(a) {
  return {
    id: a.id, kind: a.kind, name: a.name, masked: a.masked,
    type: a.type || '', interest: a.interest || '', goal: a.goal || a.desire || a.problem || '', manner: a.manner || '',
  };
}

/** Позиция последней записи автора в ленте: чем меньше, тем давнее молчит. */
function recency(state) {
  const pos = new Map();
  feedItems(state).forEach((x, i) => {
    if (x.kind !== 'reaction') return;
    const k = keyOfItem(x);
    if (k) pos.set(k, i);
  });
  return pos;
}

/**
 * Самый давно молчавший из `list`. `avoid` — ключи, которых лучше избежать;
 * `spent` — уже выбранные в этом выпуске. Сперва не тронутые ни тем, ни другим,
 * потом хотя бы не запрещённые, потом хотя бы свежие, потом любой.
 */
function leastRecent(list, pos, avoid = new Set(), spent = new Set()) {
  const rank = (a) => (pos.has(keyOfAuthor(a)) ? pos.get(keyOfAuthor(a)) : -1);
  const pick = (l) => l.map((a, i) => ({ a, i })).sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)[0];
  const tiers = [
    list.filter((a) => !avoid.has(keyOfAuthor(a)) && !spent.has(keyOfAuthor(a))),
    list.filter((a) => !avoid.has(keyOfAuthor(a))),
    list.filter((a) => !spent.has(keyOfAuthor(a))),
    list,
  ];
  const tier = tiers.find((t) => t.length);
  return tier ? pick(tier).a : null;
}

/** Кому отвечать автору: недруг из каста, иначе друг, иначе самый давний из остальных. */
function replierFor(author, pool, state, pos, avoid) {
  const cast = castOf(state);
  const me = author.kind === 'cast' ? cast.find((m) => normName(m.nick) === normName(author.name)) : null;
  const others = pool.filter((a) => keyOfAuthor(a) !== keyOfAuthor(author) && !avoid.has(keyOfAuthor(a)));
  const by = (id) => (id ? others.find((a) => a.kind === 'cast' && a.id === id) : null);
  return (me && (by(me.rival) || by(me.ally))) || leastRecent(others, pos) || leastRecent(pool.filter((a) => keyOfAuthor(a) !== keyOfAuthor(author)), pos);
}

/** «Разногласие» слота, если у сюжетика своего нет: цели двух людей. */
function dissent(a, b) {
  if (!a || !b) return '';
  const want = (p) => (p.goal ? `хочет: ${p.goal}` : p.interest ? `живёт этим: ${p.interest}` : 'видит иначе');
  return `${a.name} ${want(a)}; ${b.name} с этим не согласен`;
}

// --- повестка ----------------------------------------------------------------------------------

const STAGE_HINT = {
  завязка: 'тема только всплыла, мнения расходятся',
  спор: 'спорят в лоб, каждый при своём',
  торг: 'ищут компромисс, торгуются, давят на слабое',
  развязка: 'чем-то кончается, ставят точку',
};

/** Сюжетик привязан к событию, а оно уже прошло: говорят о том, как всё вышло (баг 64). */
const OVER_HINT = 'событие уже прошло: подводят итоги, вспоминают, как всё вышло, без планов на него';

/** События календаря: идут сейчас или начнутся не позже `CALENDAR_HORIZON` дней, ближние первыми. */
export function calendarEvents(state, preset) {
  const day = state && state.calendar && state.calendar.day;
  if (!day) return [];
  const out = [];
  try {
    for (const h of holidaysOn(preset, day, state)) out.push({ name: clip(h.name, 90), days: 0 });
    for (const a of holidaysAhead(preset, day, CALENDAR_HORIZON, state)) out.push({ name: clip(a.holiday.name, 90), days: a.days });
  } catch {
    return [];
  }
  return out.filter((e) => e.name);
}

/** Сколько дней назад ещё помнится прошедшее событие календаря. */
export const PAST_HORIZON = 21;

/**
 * Календарь мира относительно сегодняшнего дня (баг 90): каждое событие, что идёт,
 * недавно прошло или скоро будет, с числом дней. Модель не должна гадать по названию,
 * было ли это уже: «Мабон» после праздника обсуждали как будущее.
 *
 * @returns {Array<{name: string, state: 'now'|'past'|'ahead', days: number}>}
 *   `days` — сколько дней назад кончилось (past) или через сколько начнётся (ahead)
 */
export function calendarTimeline(state, preset) {
  const day = state && state.calendar && state.calendar.day;
  if (!day) return [];
  const seen = new Map();
  try {
    for (let n = -PAST_HORIZON; n <= CALENDAR_HORIZON; n += 1) {
      const at = addDays(day, n);
      for (const h of holidaysOn(preset, at, state)) {
        const name = clip(h.name, 90);
        if (!name) continue;
        const e = seen.get(name) || { name, first: n, last: n };
        e.last = n;
        seen.set(name, e);
      }
    }
  } catch {
    return [];
  }
  const out = [];
  for (const e of seen.values()) {
    if (e.first <= 0 && e.last >= 0) out.push({ name: e.name, state: 'now', days: 0 });
    else if (e.last < 0) out.push({ name: e.name, state: 'past', days: -e.last });
    else out.push({ name: e.name, state: 'ahead', days: e.first });
  }
  return out.sort((a, b) => (a.state === 'past' ? -a.days : a.days) - (b.state === 'past' ? -b.days : b.days));
}

const dayCount = (n) => {
  const a = n % 100;
  const b = a % 10;
  return `${n} ${a > 10 && a < 20 ? 'дней' : b === 1 ? 'день' : b > 1 && b < 5 ? 'дня' : 'дней'}`;
};

/** «Мабон — уже прошло, 3 дня назад», «Самайн — ещё не наступило, будет через 12 дней». */
export function timelineLine(e) {
  if (e.state === 'now') return `${e.name} — идёт сейчас`;
  if (e.state === 'past') return `${e.name} — уже прошло, ${e.days === 1 ? 'вчера' : `${dayCount(e.days)} назад`}`;
  return `${e.name} — ещё не наступило, будет ${e.days === 1 ? 'завтра' : `через ${dayCount(e.days)}`}`;
}

/** Слово прошедшего события в будущем смысле: «к Мабону», «на бал», «до Самайна», «перед балом». */
function futureMention(text, name) {
  const words = String(name).toLowerCase().replace(/ё/g, 'е').match(/\p{L}{3,}/gu) || [];
  const t = textKey(text);
  for (const w of words) {
    const stem = w.length > 5 ? w.slice(0, -2) : w.length > 3 ? w.slice(0, -1) : w;
    const re = new RegExp(`(?:^| )(?:к|ко|на|до|перед|накануне|ждем|ждет|скоро)(?: \\p{L}+)? ${stem}\\p{L}{0,${w.length <= 5 ? 2 : 3}}(?![\\p{L}])`, 'u');
    const hit = re.exec(t);
    if (hit) return hit[0].trim();
  }
  return '';
}

/**
 * Завести сюжетики до потолка (три): молве есть что продвигать, а свободное место
 * не пустует (баг 73). Правит переданную копию состояния.
 */
export function prepareThreads(work, preset) {
  const day = work && work.calendar && work.calendar.day;
  // Сперва убрать устаревшее: событие позади — сюжетик подводит итог или закрыт.
  settleThreads(work, day);
  for (let guard = 0; guard < THREADS_MAX && openThreads(work).length < THREADS_MAX; guard += 1) {
    const res = spawnThread(work, preset, { day });
    if (!res.ok) break;
  }
}

/** Последний корневой пост выпусков молвы, чей автор — из `keys`, и кто в его ветке уже говорил. */
function branchFor(state, keys) {
  const items = feedItems(state);
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const x = items[i];
    if (x.parent || x.kind !== 'reaction' || x.chan !== 'chat' || !keys.has(keyOfItem(x))) continue;
    const replies = items.filter((y) => y.parent === x.id);
    if (replies.length >= 3) continue;
    return {
      id: x.id, text: clip(x.text, 90), authorKey: keyOfItem(x), nick: x.nick || '',
      lastKey: replies.length ? keyOfItem(replies[replies.length - 1]) : keyOfItem(x),
      spoke: replies.some((y) => keyOfItem(y) !== keyOfItem(x)),
    };
  }
  return null;
}

/**
 * Повестка выпуска. Состояние не правится; сюжетики должны быть уже заведены
 * (`prepareThreads`).
 *
 * @param {Object} state
 * @param {Object} preset
 * @param {{issue?: number, every?: number, stop?: Array|Object}} [opts]
 * @returns {{issue: number, size: {min: number, max: number}, slots: Object[], mainDenied: boolean}}
 */
export function buildAgenda(state, preset, opts = {}) {
  const feed = normalizeFeed(state && state.feed);
  const issue = Number.isInteger(opts.issue) ? opts.issue : feed.molva.issue + 1;
  const size = issueSize(opts.every);
  const pool = rumorAuthors(state, { stop: opts.stop }).map(slim);
  const cast = pool.filter((a) => a.kind === 'cast');
  if (!cast.length) return { issue, size, slots: [], mainDenied: false, past: [] };
  const pos = recency(state);
  const roots = feed.items.filter((x) => x.kind === 'reaction' && !x.parent);
  const lastKey = roots.length ? keyOfItem(roots[roots.length - 1]) : '';
  const facts = newFacts(state);
  const byId = new Map(cast.map((a) => [a.id, a]));

  // --- кандидаты в слоты, без авторов -----------------------------------------------
  const wanted = [];

  // «Главные» — только с новым публичным фактом и пока квота позволяет. Скандал
  // (громкость 3) даёт второй тред, если и это в долю.
  let mainDenied = false;
  const mainPlan = [];
  if (facts.open.length) {
    const scandal = facts.open.length > 1 && (facts.open[0].loud ?? 1) >= 3;
    const want = scandal ? 2 : 1;
    for (let k = 0; k < want; k += 1) {
      if (mainRoom(state, k + 1, size.max)) mainPlan.push(facts.open[k]);
      else mainDenied = true;
    }
  }
  for (const f of mainPlan) wanted.push({ kind: 'main', facts: [f], loud: Math.max(2, f.loud ?? 2) });

  // «Массовка» — шаг сюжетика, всегда, если есть сюжетики, и каждый выпуск двигает
  // сюжетик (баг 73). Идёт тот, что дольше всех стоял; при равенстве — по кругу.
  // Сюжетик, чьё событие прошло, идёт вне очереди и закрывается (баг 64).
  const today = state && state.calendar && state.calendar.day;
  const threads = openThreads(state);
  let crowd = null;
  if (threads.length) {
    const over = threads.find((t) => threadOver(t, today));
    const ring = (i) => (((i - (issue - 1)) % threads.length) + threads.length) % threads.length;
    const t = over || threads
      .map((x, i) => ({ x, i }))
      .sort((a, b) => ((b.x.idle || 0) - (a.x.idle || 0)) || (ring(a.i) - ring(b.i)))[0].x;
    crowd = { kind: 'crowd', thread: t, advance: true, over: Boolean(over) };
    wanted.push(crowd);
  }

  // Слух: подслушанное попадает реже (через выпуск) и только слухом, через статиста.
  if (facts.overheard.length && issue % 2 === 0 && mainRoom(state, mainPlan.length + 1, size.max)) {
    wanted.push({ kind: 'rumor', facts: [facts.overheard[0]], loud: 1 });
  }

  // Календарь — ближайшее событие, если оно не то же самое, что тема сюжетика (о нём
  // тогда говорит сам сюжетик, меняя стадию) и не шло слотом в последние выпуски (баг 72).
  const events = calendarEvents(state, preset)
    .filter((e) => !threads.some((t) => similar(t.topic, e.name)))
    .filter((e) => !feed.molva.cal.some((c) => similar(c.topic, e.name) && issue - c.issue < CALENDAR_GAP));

  // Мир — быт заведения (темы пресета), учёба позже. Темы последних выпусков и
  // открытых сюжетиков не повторяются, пока есть свежие.
  const recent = [...feed.molva.topics, ...threads.map((t) => t.topic)];
  const fresh = (t) => !recent.some((r) => similar(r, t));
  const homely = feedWorldTopics(preset);
  const study = studyTopics(state, preset).map((t) => t.topic);
  const worldTopics = [...homely.filter(fresh), ...study.filter(fresh), ...homely.filter((t) => !fresh(t))];
  let worldAt = (issue - 1) % worldTopics.length;
  const world = () => {
    const topic = worldTopics[worldAt % worldTopics.length];
    worldAt += 1;
    return { kind: 'world', topic };
  };
  // Календарь и мир чередуются: при тесном выпуске не один и тот же лишний слот.
  const optional = [...(events.length ? [{ kind: 'calendar', event: events[0] }] : []), world()];
  const turn = (issue - 1) % optional.length;
  wanted.push(...optional.slice(turn), ...optional.slice(0, turn));

  // Режем до максимума: сперва главные и массовка, потом остальное по кругу.
  let picked = wanted.slice(0, size.max);
  if (!picked.some((s) => s.kind === 'crowd') && crowd) picked = [...picked.slice(0, size.max - 1), crowd];
  while (picked.length < size.min && picked.length < size.max) picked.push(world());
  // Порядок в ленте: главные идут не первыми подряд — перемежаются с остальными.
  picked.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  // Тема, что открывала любой из трёх прошлых выпусков, не открывает следующий (баги 65,
  // 72: «Канун Тёмной седмицы» ×3 — смена стадии не оправдание): открывающим становится
  // первый слот с другой темой.
  const leads = feed.molva.leads.length ? feed.molva.leads : (feed.molva.lead.topic ? [feed.molva.lead] : []);
  const topicOf = (s) => (s.kind === 'crowd' ? s.thread.topic : s.kind === 'calendar' ? s.event.name : s.kind === 'world' ? s.topic : s.facts[0].text);
  const repeats = (s) => leads.some((l) => similar(topicOf(s), l.topic));
  if (picked.length > 1 && repeats(picked[0])) {
    const at = picked.findIndex((s, i) => i > 0 && !repeats(s) && s.kind !== 'main' && s.kind !== 'rumor');
    if (at > 0) picked.unshift(...picked.splice(at, 1));
  }

  // --- авторы, отвечающие, разногласия -------------------------------------------------
  const slots = [];
  const chosen = new Set();
  let prev = lastKey;
  const take = (list) => leastRecent(list, pos, new Set(prev ? [prev] : []), chosen);
  for (const s of picked) {
    const n = slots.length + 1;
    const base = { n, kind: s.kind, mode: 'post', maxReplies: size.max <= 2 ? 1 : 2, heroine: false, rumor: false, loud: s.loud || 1 };
    let slot = null;

    if (s.kind === 'crowd') {
      const members = s.thread.members.map((id) => byId.get(id)).filter(Boolean);
      const ring = members.length >= 2 ? members : cast;
      const keys = new Set(ring.map(keyOfAuthor));
      const branch = !s.advance ? branchFor(state, keys) : null;
      if (branch) {
        const first = ring.find((a) => keyOfAuthor(a) === branch.authorKey) || ring[0];
        const replier = replierFor(first, ring, state, pos, new Set([branch.lastKey]));
        slot = {
          ...base, mode: 'reply', author: first, replier: replier || null, replyTo: branch,
          maxReplies: 1,
        };
      } else {
        const author = take(ring);
        slot = { ...base, author, replier: author ? replierFor(author, ring, state, pos, new Set()) : null };
      }
      Object.assign(slot, {
        topic: s.thread.topic, stage: s.thread.stage, stageHint: s.over ? OVER_HINT : (STAGE_HINT[s.thread.stage] || ''), threadId: s.thread.id,
        over: s.over === true,
        advance: s.advance && slot.mode === 'post', dispute: s.thread.dispute || dissent(slot.author, slot.replier),
      });
    } else if (s.kind === 'rumor') {
      const author = take(cast);
      const replier = author ? replierFor(author, pool, state, pos, new Set()) : null;
      const f = s.facts[0];
      slot = {
        ...base, author, replier, rumor: true, heroine: true,
        topic: clip(f.gist || f.text, FACT_TEXT_MAX), facts: [{ id: f.id, text: clip(f.gist || f.text, FACT_TEXT_MAX), about: f.about }],
        dispute: dissent(author, replier),
      };
    } else if (s.kind === 'main') {
      const author = take(pool);
      const replier = author ? replierFor(author, pool, state, pos, new Set()) : null;
      const f = s.facts[0];
      slot = {
        ...base, author, replier, heroine: true,
        topic: clip(f.gist || f.text, FACT_TEXT_MAX), facts: [{ id: f.id, text: clip(f.gist || f.text, FACT_TEXT_MAX), about: f.about }],
        dispute: dissent(author, replier),
      };
    } else {
      const author = take(pool);
      const replier = author ? replierFor(author, pool, state, pos, new Set()) : null;
      slot = {
        ...base, author, replier,
        topic: s.kind === 'calendar' ? s.event.name : s.topic,
        ...(s.kind === 'calendar' ? { event: s.event } : {}),
        dispute: dissent(author, replier),
      };
    }
    if (!slot.author) continue;
    chosen.add(keyOfAuthor(slot.author));
    prev = keyOfAuthor(slot.author);
    slots.push(slot);
  }
  slots.forEach((s, i) => { s.n = i + 1; });
  return { issue, size, slots, mainDenied, lastKey, past: calendarTimeline(state, preset).filter((e) => e.state === 'past') };
}

/** Порядок слотов в выпуске: массовка, календарь, главные, мир — главные не открывают выпуск. */
const ORDER = ['crowd', 'calendar', 'main', 'rumor', 'world'];

/**
 * Подготовить выпуск: рабочая копия состояния (с заведёнными сюжетиками) и
 * повестка. Состояние вызывающего не правится.
 *
 * @returns {{work: Object, agenda: Object}}
 */
export function planIssue(state, preset, opts = {}) {
  const work = clone(state);
  ensureFeed(work);
  prepareThreads(work, preset);
  return { work, agenda: buildAgenda(work, preset, opts) };
}

// --- промпт ----------------------------------------------------------------------------------

const systemOf = (preset) => 'Ты ведёшь молву — общий школьный чат массовки в ролевой игре: слухи, мелкие конфликты, споры о балах, зачётах и быте.'
  + ` Это не пересказ ролевой сцены: у статистов свои дела, ${heroWords(presetGender(preset)).heroAcc} они знают понаслышке.`
  + ' Отвечай только строками формата, без пояснений, вступлений и markdown.';

const when = (days) => (days === 0 ? 'идёт сейчас' : days === 1 ? 'завтра' : `через ${days} дн.`);

/** Одна строка слота для промпта. */
function slotLine(s, w) {
  const who = `Пост П${s.n} пишет: ${s.author.name}.`;
  // Ответ называет свой пост и разногласие прямо: отвечать надо на содержание поста (баг 66).
  const reply = s.replier ? ` Ответ О${s.n} пишет: ${s.replier.name} — по сути поста П${s.n}, не мимо него.` : '';
  const split = s.dispute ? ` Разногласие: ${s.dispute}.` : '';
  if (s.mode === 'reply') {
    return `${s.n}. Массовка, продолжение ветки «${s.topic}»${s.stage ? ` (стадия «${s.stage}»: ${s.stageHint})` : ''}. Пост ветки, ${s.author.name}: «${s.replyTo.text}». Нового поста не пиши — только реплика О${s.n}, её пишет ${s.replier ? s.replier.name : 'другой статист'} в ответ на слова этого поста.${split}`;
  }
  if (s.kind === 'crowd') return `${s.n}. Массовка, сюжетик «${s.topic}», стадия «${s.stage}»: ${s.stageHint}. ${who}${reply}${split} Сдвинь историю вперёд, не пересказывай начало.`;
  if (s.kind === 'main') return `${s.n}. На людях случилось, видели все: «${s.facts[0].text}». ${who}${reply}${split} Обсуждают случившееся, не добавляя подробностей.`;
  if (s.kind === 'rumor') return `${s.n}. Слух. ${s.author.name} краем уха услышал(а) чужой разговор наедине: «${s.facts[0].text}». ${who}${reply} Пересказ неточный: перевирает, не уверен(а), сам(а) додумывает. Это слух, а не новость; сам разговор в чате не видели.${split}`;
  if (s.kind === 'calendar') return `${s.n}. Календарь: «${s.topic}» — ${when(s.event.days)}. ${who}${reply}${split} Говорят о подготовке, ожиданиях, ссорах вокруг события.`;
  return `${s.n}. Мир: ${s.topic}. ${who}${reply}${split} Бытовое, без ${w.heroGen} и сцен из ролевой.`;
}

/** Статист для списка: ник и всё, что нужно голосу. */
function memberLine(a) {
  const parts = a.kind === 'cast'
    ? [a.type, a.interest && `интерес: ${a.interest}`, a.goal && `цель: ${a.goal}`, a.manner && !brokenManner(a.manner) && `манера: ${a.manner}`]
    : ['живой сокурсник', a.goal && `про него: ${a.goal}`];
  return `— ${a.name}${a.masked ? ' (ник)' : ''} | ${parts.filter(Boolean).join('; ')}`;
}

/**
 * Промпт выпуска.
 *
 * @param {Object} state состояние (рабочая копия после `planIssue`)
 * @param {Object} preset
 * @param {Object} agenda повестка (`buildAgenda`)
 * @param {{statusLine?: string}} [opts]
 * @returns {{system: string, user: string}}
 */
export function buildMolvaPrompt(state, preset, agenda, opts = {}) {
  const lines = [];
  const w0 = heroWords(presetGender(preset));
  const real = worldRealities(state, preset);
  if (real.length) lines.push('Мир:', ...real.map((r) => `— ${r}`), '');
  const day = state && state.calendar && state.calendar.day;
  if (opts.statusLine || day) lines.push(`Сегодня: ${opts.statusLine || day}.`);
  const cal = calendarNames(state, preset);
  lines.push(cal.length
    ? `Календарь мира (праздники и события есть только эти, других не выдумывай): ${cal.join('; ')}.`
    : 'В календаре мира нет ни праздников, ни событий: не выдумывай их.');
  // Что уже было, а что ещё будет: без этого прошедший праздник обсуждали как будущий (баг 90).
  const line = calendarTimeline(state, preset);
  if (line.length) lines.push('Календарь относительно сегодня:', ...line.map((e) => `— ${timelineLine(e)}`));
  lines.push('');

  const used = new Map();
  for (const s of agenda.slots) for (const a of [s.author, s.replier]) if (a) used.set(keyOfAuthor(a), a);
  const own = feedItems(state).filter((x) => x.kind === 'reaction');
  lines.push('Кто пишет (только они):');
  for (const a of used.values()) {
    lines.push(memberLine(a));
    // Свои недавние реплики — чтобы не повторять обороты и начала (баг 94).
    const last = own.filter((x) => keyOfItem(x) === keyOfAuthor(a)).slice(-RECENT_OWN);
    if (last.length) lines.push(`  его недавние реплики (обороты и начала не повторяй): ${last.map((x) => `«${clip(x.text, 70)}»`).join(' ')}`);
  }
  lines.push('');

  const cast = castOf(state);
  const nick = new Map(cast.map((m) => [m.id, m.nick]));
  const threads = openThreads(state);
  if (threads.length) {
    lines.push('Сюжетики массовки:', ...threads.map((t) => `— «${t.topic}», стадия «${t.stage}», участвуют: ${t.members.map((id) => nick.get(id)).filter(Boolean).join(', ')}`), '');
  }

  const items = feedItems(state);
  const roots = items.filter((x) => x.kind === 'reaction' && !x.parent).slice(-RECENT_BRANCHES);
  if (roots.length) {
    lines.push('Последние ветки — эти темы израсходованы, продвигай, не повторяй:');
    for (const r of roots) {
      const reps = items.filter((y) => y.parent === r.id).slice(0, 2);
      const who = (x) => (x.nick ? x.nick : x.who || 'без подписи');
      lines.push(`— ${who(r)}: «${clip(r.text, 80)}»${reps.map((y) => ` → ${who(y)}: «${clip(y.text, 60)}»`).join('')}`);
    }
    lines.push('');
  }

  lines.push('Повестка выпуска (автор, отвечающий и разногласие назначены — не меняй их):', ...agenda.slots.map((s) => slotLine(s, heroWords(presetGender(preset)))), '');
  lines.push(
    'Формат, по строке на реплику:',
    'П<номер слота> | автор | текст поста',
    'О<номер слота> | отвечающий | текст ответа',
    `В конце — строка «${END_MARK}».`,
    '',
    'Правила:',
    '— Пост пишет назначенный автор. Ответ — назначенный отвечающий, под постом своего же слота; в слоте не больше '
      + `${Math.max(...agenda.slots.map((s) => s.maxReplies), 1)} ответов. Автор может вернуться в свою ветку только после чужого ответа.`,
    `— Реплика: одно-два законченных предложения, не длиннее ${FEED_TEXT_MAX - 20} знаков. Не обрывай мысль на полуслове. Ответ — не короче ${REPLY_MIN} знаков.`,
    '— Ответ отвечает на содержание своего поста: цепляется за его слова, возражает, уточняет, поддерживает или подкалывает именно по этому поводу, а не говорит о другом.',
    '— Не строй реплики по шаблону «я… а ты…» и не начинай подряд одним словом. Длина разная: одна реплика в несколько слов, другая — два предложения. Манера — у каждого своя.',
    '— Намерения, планы, вопросы, мнения, догадки и обиды — можно. Свершившиеся события, которых нет в повестке, календаре и сюжетиках, придумывать нельзя.',
    '— Статист знает только то, что видел сам или о чём шумит чат; слух — неточно и с перевираниями.',
    '— Голос — поведением и манерой, а не словом из типажа («завистница»). Реплики разных людей не похожи.',
    '— Манера — словарь, интонация, привычные фразы и отношение к собеседнику. Слова пишутся правильно: без вставок внутрь слов, заикания и искажённой орфографии.',
    '— Присказка автора — не в каждой реплике: не чаще одной реплики из трёх. Манера живёт в интонации и словаре, а не в повторе одной фразы.',
    '— Только заклинания и термины этого мира и пресета, ничего из известных книг и фильмов.',
    '— Время событий — по строкам «Календарь относительно сегодня». Что уже прошло — вспоминают как прошедшее («было», «прошло»); о прошедшем нельзя говорить как о будущем: никаких «готовимся к», «скоро», «ждём» про него.',
    '— Свои обороты автор не повторяет: ни начало фразы («Клянусь…», «Я бы так не…»), ни любимый оборот из трёх слов не стоят в двух репликах из трёх подряд.',
    `— ${w0.heroAcc[0].toUpperCase()}${w0.heroAcc.slice(1)} игрока и персонажей карточки не называй и не пиши от их имени, кроме слотов, где факт о них назначен.`,
    '— Не повторяй темы последних веток: сдвигай историю дальше.',
  );
  return { system: systemOf(preset), user: lines.join('\n') };
}

// --- разбор и проверки -----------------------------------------------------------------------

/** Присказки манеры: то, что в ней взято в кавычки («только никому»). */
export function catchphrases(manner) {
  const out = [];
  for (const m of String(manner == null ? '' : manner).matchAll(/[«"“„]([^»"”“]{3,40})[»"”]/gu)) {
    const p = normPhrase(m[1]);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

const normPhrase = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Присказка автора, что уже стоит в двух его последних репликах (лента и этот
 * же выпуск), — третью с ней отбрасываем (баг 84): механичный тик. Возвращает
 * присказку или пустую строку.
 */
export function overusedCatchphrase(text, author, history, said) {
  const phrases = catchphrases(author && author.manner);
  if (!phrases.length) return '';
  const key = keyOfAuthor(author);
  const past = [
    ...(Array.isArray(history) ? history : []).filter((x) => x && x.kind === 'reaction' && keyOfItem(x) === key).map((x) => x.text),
    ...((said && said.get(key)) || []),
  ].slice(-2);
  if (past.length < 2) return '';
  const now = normPhrase(text);
  return phrases.find((p) => now.includes(p) && past.every((x) => normPhrase(x).includes(p))) || '';
}

/** Слова реплики для сравнения оборотов. */
const wordsOf = (s) => textKey(s).split(' ').filter(Boolean);

/** Сколько букв должно быть в обороте из трёх слов, чтобы он считался оборотом, а не «я не знаю». */
const PHRASE_LETTERS = 11;

/**
 * Оборот автора, что уже был в одной из его трёх последних реплик (лента и этот же
 * выпуск), — реплику с ним отбрасываем (баг 94). Оборот — то же начало (две первых
 * слова и больше, если слова длинные) или любые три слова подряд. Короткие «я не знаю»
 * оборотом не считаются: порог по буквам. Возвращает найденный оборот или пустую строку.
 */
export function repeatedPhrase(text, author, history, said) {
  if (!author) return '';
  const key = keyOfAuthor(author);
  const past = [
    ...(Array.isArray(history) ? history : []).filter((x) => x && x.kind === 'reaction' && keyOfItem(x) === key).map((x) => x.text),
    ...((said && said.get(key)) || []),
  ].slice(-RECENT_OWN);
  if (!past.length) return '';
  const now = wordsOf(text);
  const letters = (ws) => ws.join('').length;
  for (const old of past) {
    const was = wordsOf(old);
    // То же начало: «клянусь основателями …».
    for (const n of [3, 2]) {
      if (now.length >= n && was.length >= n && now.slice(0, n).join(' ') === was.slice(0, n).join(' ') && letters(now.slice(0, n)) >= (n === 2 ? 14 : PHRASE_LETTERS)) {
        return now.slice(0, n).join(' ');
      }
    }
    // Три слова подряд в любом месте.
    const grams = new Set();
    for (let i = 0; i + 3 <= was.length; i += 1) grams.add(was.slice(i, i + 3).join(' '));
    for (let i = 0; i + 3 <= now.length; i += 1) {
      const g = now.slice(i, i + 3);
      if (grams.has(g.join(' ')) && letters(g) >= PHRASE_LETTERS) return g.join(' ');
    }
  }
  return '';
}

/**
 * Слова, на которых мысль не заканчивается. Жёсткие — предлоги и союзы: после
 * них всегда должно что-то быть (разве что «что?» с вопросом). Мягкие —
 * частицы: «ну и ладно, мне то» обрыв, «вот это да.» — нет.
 */
const DANGLING_HARD = new Set([
  'и', 'а', 'но', 'или', 'либо', 'что', 'чтобы', 'чтоб', 'как', 'если', 'когда', 'пока', 'хотя', 'будто', 'словно', 'потому',
  'про', 'о', 'об', 'обо', 'на', 'в', 'во', 'с', 'со', 'к', 'ко', 'у', 'из', 'за', 'для', 'по', 'от', 'до', 'без', 'над', 'под',
  'при', 'через', 'между', 'перед', 'его', 'её', 'их', 'мой', 'моя', 'свой', 'свою', 'такой', 'такая',
  'который', 'которая', 'которые', 'кого', 'чего', 'чей',
]);
const DANGLING_SOFT = new Set(['ли', 'бы', 'же', 'не', 'ни', 'то', 'вот', 'там', 'тут', 'этот', 'эта', 'эти']);

/** Реплика оборвана: нет конца мысли (баг 56, «Говорят, она ляпнула про»). */
export function isCutOff(text) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return true;
  const open = (t.match(/«/g) || []).length - (t.match(/»/g) || []).length;
  const par = (t.match(/\(/g) || []).length - (t.match(/\)/g) || []).length;
  if (open > 0 || par > 0) return true;
  if (/[,:;\-–—(«]$/.test(t)) return true;
  const body = t.replace(/[.…!?»)"\s]+$/u, '');
  const last = textKey(body).split(' ').pop() || '';
  // «про…» с многоточием — тоже обрыв; «что?» и «что!» — нет.
  if (DANGLING_HARD.has(last)) return !/[!?]$/.test(t);
  if (DANGLING_SOFT.has(last)) return !/[.…!?]$/.test(t);
  return false;
}

/**
 * Голова строки: `П1`, `О2`, `P1`, «Пост 1», «Ответ 2», «Reply 1» — слово и номер слота.
 * Регистр любой, латинские и кириллические буквы, «№» и «#» допустимы.
 */
const HEAD = /^(п(?:ост)?|о(?:твет)?|p(?:ost)?|o|r(?:eply)?|answer)\s*[№#]?\s*(\d{1,2})(?![\p{L}\d])\s*/iu;

const BULLET = /^\s*(?:[-–—*•>]+|\d+[.)])\s*/;

const kindOfWord = (w) => {
  const c = String(w).toLowerCase()[0];
  if (c === 'п' || c === 'p') return 'post';
  if (c === 'о' || c === 'o' || c === 'r' || c === 'a') return 'reply';
  return null;
};

/** Строка ответа к виду без разметки: markdown, список, обрамление таблицей, скобки вокруг головы. */
function cleanLine(line) {
  let t = String(line).replace(/[*`]+/g, '').replace(/^\s*#+\s*/, '').replace(BULLET, '').trim();
  t = t.replace(/^[|_\s]+/, '').replace(/^[[(<]\s*((?:п|о|p|o|r|a)[\p{L}]{0,5}\s*[№#]?\s*\d{1,2})\s*[\])>]/iu, '$1');
  return t.replace(/^_+/, '').replace(/[|\s]+$/, '').trim();
}

/**
 * Строка формата: `П1 | ник | текст`, а также `П1: ник | текст`, `П1: ник: текст`,
 * `П1 — ник — текст`. Нет головы — не строка формата (`null`).
 */
function splitRow(body) {
  const m = HEAD.exec(body);
  const kind = m && kindOfWord(m[1]);
  if (!m || !kind) return null;
  const rest = body.slice(m[0].length).replace(/^[\s.):\-–—|]+/, '');
  let who;
  let text;
  const bar = rest.indexOf('|');
  if (bar >= 0) {
    who = rest.slice(0, bar);
    text = rest.slice(bar + 1);
  } else {
    // Без «|»: «ник: текст» или «ник — текст».
    const alt = /^(@?[^:—–«"“„]{1,40}?)\s*(?::|\s[—–-]\s)\s*([\s\S]+)$/u.exec(rest);
    if (!alt) return null;
    [, who, text] = alt;
  }
  who = who.trim();
  text = text.replace(/^[\s|]+|[\s|]+$/g, '');
  if (!who || !text) return null;
  return { kind, n: Number(m[2]), who, body: text };
}

/** Автор по тому, как его назвала модель: ник каста или имя сокурсника (имя, фамилия, имя фамилия). */
export function resolveAuthor(raw, pool) {
  const name = normName(String(raw || '').replace(/\s*\([^)]*\)\s*$/, '').replace(/^[~@\s«"“„[<]+|[»"”\s\]>]+$/g, ''));
  if (!name) return null;
  const exact = pool.find((a) => normName(a.name) === name);
  if (exact) return exact;
  const mates = pool.filter((a) => a.kind === 'classmate');
  const by = (test) => {
    const hit = mates.filter(test);
    return hit.length === 1 ? hit[0] : null;
  };
  return by((a) => normName(shortName(a.name)) === name)
    || by((a) => normName(a.name).split(' ')[0] === name)
    || by((a) => normName(a.name).split(' ').includes(name) && name.length >= 4);
}

/** Упомянута ли в тексте героиня или персонаж карточки (по началу слов их имён). */
export function mentionsStop(text, stop) {
  const list = Array.isArray(stop) ? stop : [];
  const words = normName(text).split(' ').filter(Boolean);
  return list.some((s) => (s.kind === 'user' || s.kind === 'char')
    && s.tokens.some((t) => t.length >= 3 && words.some((w) => w.startsWith(t.slice(0, Math.min(t.length, 5))))));
}

/** Один и тот же текст: совпал после нормализации или длинный входит в другой. */
function sameText(a, b) {
  const x = textKey(a);
  const y = textKey(b);
  if (!x || !y) return false;
  return x === y || (Math.min(x.length, y.length) >= 24 && (x.includes(y) || y.includes(x)));
}

/** Реплика к виду для ленты: без кавычек вокруг и ника в начале; длинную режет по предложению. */
function tidy(raw) {
  let t = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  t = t.replace(/^[«"“„'](.*)[»"”“']$/u, '$1').trim();
  if (t.length > FEED_TEXT_MAX) {
    const cut = t.slice(0, FEED_TEXT_MAX);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '), cut.lastIndexOf('…'));
    const dot = /[.!?…]$/.test(cut) ? cut.length - 1 : -1;
    const at = Math.max(end, dot);
    return at >= 30 ? cut.slice(0, at + 1).trim() : null;
  }
  return t;
}

/**
 * Слова, в которые вставлен один и тот же кусок («Клюмостёл снлюмосва», баг 71):
 * манера статиста «вставляет \«люмо\» внутрь слов» ломает написание. Два признака:
 * кусок из манеры (если манера искажающая — `brokenManner`) стоит внутри слова; либо
 * один и тот же внутренний кусок из четырёх букв повторяется в трёх разных словах
 * (из пяти и больше — в двух). «Внутренний» — с буквой впереди и тремя позади:
 * суффиксы «-ность», «-ение» сюда не попадают.
 *
 * @param {string} text реплика
 * @param {string} [manner] манера автора
 * @returns {string} найденный кусок или пустая строка
 */
export function brokenWords(text, manner = '') {
  const words = String(text == null ? '' : text).toLowerCase().replace(/ё/g, 'е').match(/\p{L}{4,}/gu) || [];
  if (brokenManner(manner)) {
    for (const m of String(manner).toLowerCase().replace(/ё/g, 'е').matchAll(/[«"“„']([\p{L}-]{3,8})[»"”“']/gu)) {
      const piece = m[1];
      if (words.some((w) => w.indexOf(piece, 1) > 0 && w.length > piece.length + 1 && w.indexOf(piece, 1) + piece.length < w.length)) return piece;
    }
  }
  const long = [...new Set(words.filter((w) => w.length >= 6))];
  const found = new Map();
  for (const w of long) {
    for (let len = 4; len <= 6; len += 1) {
      for (let at = 1; at + len <= w.length - 3; at += 1) {
        const piece = w.slice(at, at + len);
        if (!found.has(piece)) found.set(piece, new Set());
        found.get(piece).add(w);
      }
    }
  }
  let best = '';
  for (const [piece, set] of found) {
    // Слова одного корня («расписание», «расписанием») — не повтор: считаются по первым четырём буквам.
    const roots = new Set([...set].map((w) => w.slice(0, 4)));
    if (roots.size < (piece.length >= 5 ? 2 : 3)) continue;
    if (piece.length > best.length) best = piece;
  }
  return best;
}

/**
 * Разобрать ответ модели и проверить кодом.
 *
 * Формат читается терпимо: markdown (`**П1**`, `- П1`, `# П1`), «П1:» и «—» вместо
 * «|», латинские `P`/`O`, «Пост 1»/«Ответ 1», ник с «@», в скобках и в кавычках,
 * кавычки вокруг текста, таблица с краевыми «|», лишние пустые строки,
 * пояснения модели до и после. Строка без головы и без «|» — пояснение, молча мимо.
 *
 * Проверки, по порядку: строка по формату; слот есть; автор из каста или
 * «Людей», не героиня и не персонаж карточки; пост — к своему слоту; написал не
 * назначенный, но существующий автор — принимается, автор переназначается
 * (`reassigned`); ответ — к посту своего слота (номером, не позицией — баг 55);
 * самоответ до чужого — вон; один автор не пишет подряд ни два поста, ни две
 * реплики в ветке; реплика не пустая, не обрывок (баг 56), не длиннее ленты, без
 * слов с вставленным куском (баг 71) и вне слотов о главных не называет героиню;
 * повтор текста — вон. Оборванная последняя строка (нет «КОНЕЦ» и ответ упёрся
 * в потолок) отбрасывается; без «КОНЕЦ», но целая — принимается.
 *
 * @param {string} text ответ модели
 * @param {Object} agenda повестка
 * @param {{pool: Object[], stop?: Array, truncated?: boolean, existing?: string[], lastKey?: string}} opts
 *   `pool` — `rumorAuthors` (кто вообще может писать), `existing` — тексты, что уже в ленте
 * @returns {{lines: Array<Object>, rejected: Array<{raw: string, reason: string, line?: number}>,
 *   reassigned: Array<{line: number, n: number, from: string, to: string}>, rows: number, complete: boolean}}
 *   `line` — номер строки в ответе модели (с единицы), `rows` — сколько строк формата нашлось
 */
export function parseIssue(text, agenda, opts = {}) {
  const history = Array.isArray(opts.history) ? opts.history : [];
  const said = new Map();
  const raw = String(text == null ? '' : text)
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/\r/g, '');
  const endRe = new RegExp(`^[\\s#*=>_\`[(-]*${END_MARK}(?![\\p{L}])`, 'iu');
  const complete = raw.split('\n').some((l) => endRe.test(l)) && opts.truncated !== true;
  const pool = (Array.isArray(opts.pool) ? opts.pool : []).map(slim);
  const stop = Array.isArray(opts.stop) ? opts.stop : [];
  const rejected = [];
  const reassigned = [];
  const warned = [];
  const past = (Array.isArray(opts.past) ? opts.past : agenda.past || []).filter((e) => e && e.name);
  const rows = [];
  raw.split('\n').forEach((line, i) => {
    const body = cleanLine(line);
    if (!body || endRe.test(body)) return;
    const row = splitRow(body);
    if (!row) {
      if (body.includes('|') || HEAD.test(body)) rejected.push({ raw: body, line: i + 1, reason: 'строка не по формату' });
      return;
    }
    rows.push({ ...row, raw: body, line: i + 1 });
  });
  if (!rows.length) {
    rejected.push({
      raw: clip(raw, 160),
      reason: raw.trim() ? 'в ответе нет ни одной строки формата «П1 | автор | текст»' : 'пустой ответ модели',
    });
  }

  // Конец ответа: без «КОНЕЦ» последняя строка могла оборваться. Принимается,
  // если ответ не упёрся в потолок и строка не обрывок.
  if (!complete && rows.length) {
    const last = rows[rows.length - 1];
    const tidyLast = tidy(last.body);
    if (opts.truncated === true || !tidyLast || isCutOff(tidyLast)) {
      rows.pop();
      rejected.push({ raw: last.raw, line: last.line, reason: 'ответ оборван на этой строке' });
    }
  }

  const slots = new Map((agenda.slots || []).map((s) => [s.n, s]));
  const seen = [...(opts.existing || []).map(String)];
  const dup = (t) => seen.some((x) => sameText(x, t));
  const fail = (row, reason) => rejected.push({ raw: row.raw, line: row.line, reason });

  /** Текст реплики после проверок; `null` и причина отказа — если не годится. */
  const checkText = (row, slot, author) => {
    const t = tidy(row.body);
    if (t === null) return { reason: `реплика длиннее ${FEED_TEXT_MAX} знаков` };
    if ((t.match(/\p{L}/gu) || []).length < MIN_LETTERS) return { reason: 'пустая реплика' };
    if (row.kind === 'reply' && t.length < REPLY_MIN) return { reason: `ответ короче ${REPLY_MIN} знаков — не ответ по существу` };
    if (isCutOff(t)) return { reason: 'реплика оборвана на полуслове' };
    if (!slot.heroine && mentionsStop(t, stop)) return { reason: 'речь о персонаже игрока или карточки вне слота главных' };
    const piece = brokenWords(t, author && author.manner);
    if (piece) return { reason: `в словах вставлен кусок «${piece}» — написание искажено` };
    if (dup(t)) return { reason: 'повтор уже сказанного' };
    const spell = foreignSpell(t);
    if (spell) return { reason: `заклинание из чужого произведения «${spell}»` };
    const tic = author ? overusedCatchphrase(t, author, history, said) : '';
    if (tic) return { reason: `присказка «${tic}» в третьей реплике автора подряд` };
    const again = repeatedPhrase(t, author, history, said);
    if (again) return { reason: `оборот «${again}» уже был у автора в последних репликах` };
    // Прошедшее событие календаря в будущем смысле — только замечание: надёжно отбросить нельзя.
    for (const e of past) {
      const hit = futureMention(t, e.name);
      if (hit) warned.push({ raw: row.raw, line: row.line, reason: `«${e.name}» уже прошло, а реплика говорит как о будущем («${hit}»)` });
    }
    if (author) said.set(keyOfAuthor(author), [...(said.get(keyOfAuthor(author)) || []), t]);
    return { text: t };
  };
  const whoOf = (row) => {
    const a = resolveAuthor(row.who, pool);
    if (!a) return { reason: `автор «${clip(row.who, 30)}» не из каста и не из «Людей»` };
    return { author: a };
  };
  const noteMove = (row, slot, from, to) => reassigned.push({ line: row.line, n: row.n, from: from ? from.name : '', to: to.name, kind: row.kind, slot: slot.kind });

  // --- посты ---------------------------------------------------------------------------
  const posts = new Map();
  for (const row of rows.filter((r) => r.kind === 'post')) {
    const slot = slots.get(row.n);
    if (!slot) { fail(row, 'такого слота нет в повестке'); continue; }
    if (slot.mode !== 'post') { fail(row, 'в этом слоте поста не просили'); continue; }
    if (posts.has(row.n)) { fail(row, 'второй пост в слоте'); continue; }
    const w = whoOf(row);
    if (w.reason) { fail(row, w.reason); continue; }
    // Слух пишет статист из каста, остальное — любой существующий автор: переназначаем, не выбрасываем.
    if (slot.rumor && w.author.kind !== 'cast') { fail(row, 'слух пишет статист из каста, а не живой сокурсник'); continue; }
    const c = checkText(row, slot, w.author);
    if (c.reason) { fail(row, c.reason); continue; }
    if (keyOfAuthor(w.author) !== keyOfAuthor(slot.author)) noteMove(row, slot, slot.author, w.author);
    seen.push(c.text);
    posts.set(row.n, { slot, author: w.author, text: c.text, row });
  }
  // Один автор не пишет два поста подряд: сверка по порядку слотов с последним постом ленты.
  let prev = opts.lastKey ?? agenda.lastKey ?? '';
  for (const n of [...posts.keys()].sort((a, b) => a - b)) {
    const p = posts.get(n);
    const key = keyOfAuthor(p.author);
    if (key === prev) {
      fail(p.row, 'тот же автор уже писал пост перед этим');
      posts.delete(n);
      const at = reassigned.findIndex((r) => r.line === p.row.line);
      if (at >= 0) reassigned.splice(at, 1);
    } else {
      prev = key;
    }
  }

  // --- ответы ---------------------------------------------------------------------------
  const branch = new Map();
  const replies = [];
  for (const row of rows.filter((r) => r.kind === 'reply')) {
    const slot = slots.get(row.n);
    if (!slot) { fail(row, 'такого слота нет в повестке'); continue; }
    const post = posts.get(row.n);
    const old = slot.mode === 'reply' ? slot.replyTo : null;
    if (!post && !old) { fail(row, 'поста этого слота нет — ответ не к чему привязать'); continue; }
    const w = whoOf(row);
    if (w.reason) { fail(row, w.reason); continue; }
    const key = keyOfAuthor(w.author);
    const th = branch.get(row.n) || (post
      ? { postKey: keyOfAuthor(post.author), lastKey: keyOfAuthor(post.author), spoke: false, count: 0 }
      : { postKey: old.authorKey, lastKey: old.lastKey, spoke: old.spoke, count: 0 });
    if (th.count >= slot.maxReplies) { fail(row, 'в ветке больше ответов, чем разрешено'); continue; }
    if (key === th.postKey && !th.spoke) { fail(row, 'ответ автора самому себе до чужого ответа'); continue; }
    if (key === th.lastKey) { fail(row, 'тот же автор подряд в одной ветке'); continue; }
    const c = checkText(row, slot, w.author);
    if (c.reason) { fail(row, c.reason); continue; }
    if (!slot.replier || key !== keyOfAuthor(slot.replier)) {
      if (key !== th.postKey) noteMove(row, slot, slot.replier, w.author);
    }
    seen.push(c.text);
    th.lastKey = key;
    th.count += 1;
    if (key !== th.postKey) th.spoke = true;
    branch.set(row.n, th);
    replies.push({ slot, n: row.n, author: w.author, text: c.text });
  }

  const lines = [];
  for (const slot of agenda.slots || []) {
    const p = posts.get(slot.n);
    if (p) lines.push({ kind: 'post', n: slot.n, slotKind: slot.kind, author: p.author, text: p.text });
    for (const r of replies.filter((x) => x.n === slot.n)) {
      lines.push({ kind: 'reply', n: slot.n, slotKind: slot.kind, author: r.author, text: r.text, ...(slot.replyTo ? { parent: slot.replyTo.id } : {}) });
    }
  }
  return { lines, rejected, reassigned, warned, rows: rows.length, complete };
}

// --- запись -------------------------------------------------------------------------------------

/**
 * Лечь в рабочую копию: записи, продвинутые сюжетики, использованные факты,
 * номер выпуска. Правит `work` (копию из `planIssue`) и возвращает дельту —
 * то, что нужно, чтобы повторить выпуск на любом состоянии (`replayMolva`).
 *
 * Выпуск без единой записи — не выпуск: `ok: false`, сюжетики не двигаются. Если
 * `resetOnFail`, счёт ответов всё равно обнуляется (автомат не бьёт по запросам
 * после каждого ответа, пока модель капризничает; пропущенное не догоняется).
 *
 * @param {Object} work
 * @param {{lines: Object[]}} result `parseIssue`
 * @param {Object} agenda
 * @param {{stamp?: string, day?: string, time?: string, resetOnFail?: boolean, preset?: Object}} [opts]
 *   `preset` — чтобы на место закрытого сюжетика завести новый в том же выпуске
 * @returns {{ok: boolean, delta: Object|null, posts: number, replies: number}}
 */
export function applyIssue(work, result, agenda, opts = {}) {
  const day = opts.day || (work.calendar && work.calendar.day) || '';
  const time = opts.time || (work.calendar && work.calendar.time) || '';
  const issue = agenda.issue;
  const src = `${SRC}${issue}${opts.stamp ? `-${hash(opts.stamp)}` : ''}`;
  const made = [];
  let posts = 0;
  let replies = 0;
  const idOf = new Map();
  const slotOf = new Map((agenda.slots || []).map((s) => [s.n, s]));

  for (const l of result.lines) {
    const slot = slotOf.get(l.n);
    const base = {
      src, at: { day, time }, factRef: '', kind: 'reaction',
      who: l.author.kind === 'classmate' ? l.author.id : '',
      nick: l.author.masked ? l.author.name : '',
      type: l.author.masked ? l.author.type : '',
      text: l.text, truth: null, status: 'new',
    };
    if (l.kind === 'post') {
      const id = `${src}#${posts + 1}`;
      const item = {
        ...base, id, chan: slot.rumor ? 'anon' : 'chat', rumor: slot.rumor === true,
        about: slot.facts ? (slot.facts[0].about || []) : [], heroine: slot.heroine === true,
        loud: slot.loud, factText: slot.facts ? clip(slot.facts[0].text, FACT_TEXT_MAX) : '',
      };
      if (addFeedItem(work, item)) {
        posts += 1;
        idOf.set(l.n, id);
        made.push(id);
      }
    } else {
      const parentId = l.parent || idOf.get(l.n);
      const parent = parentId ? ensureFeed(work).items.find((x) => x.id === parentId && !x.parent) : null;
      if (!parent) continue;
      const id = `${src}^${replies + 1}`;
      const item = {
        ...base, id, parent: parent.id, chan: parent.chan, rumor: parent.chan === 'anon',
        about: parent.about, heroine: parent.heroine, loud: parent.loud, factText: parent.factText,
      };
      if (addFeedItem(work, item)) {
        replies += 1;
        made.push(id);
      }
    }
  }

  const fresh = ensureFeed(work);
  if (!made.length) {
    if (opts.resetOnFail) {
      fresh.molva = { ...fresh.molva, since: 0 };
      return { ok: false, delta: deltaOf(work, [], opts.stamp), posts: 0, replies: 0 };
    }
    return { ok: false, delta: null, posts: 0, replies: 0 };
  }
  // Сюжетик продвигается, только если в его слоте легла хотя бы одна реплика.
  const moved = new Set();
  for (const slot of agenda.slots || []) {
    if (!slot.advance || !slot.threadId) continue;
    if (idOf.has(slot.n)) {
      advanceThread(work, slot.threadId);
      moved.add(slot.threadId);
    }
  }
  // Кто простоял выпуск — копит простой; на третьем идёт на следующую стадию сам (баг 73).
  for (const t of [...ensureFeed(work).threads]) {
    if (moved.has(t.id)) continue;
    const live = ensureFeed(work).threads.find((x) => x.id === t.id);
    if (!live) continue;
    live.idle = (live.idle || 0) + 1;
    if (live.idle >= IDLE_MAX) advanceThread(work, live.id);
  }
  // Место освободилось (развязка закрыла сюжетик) — новый заводится в том же выпуске.
  if (opts.preset) {
    const day2 = day || (work.calendar && work.calendar.day) || '';
    for (let guard = 0; guard < THREADS_MAX && openThreads(work).length < THREADS_MAX; guard += 1) {
      if (!spawnThread(work, opts.preset, { day: day2 }).ok) break;
    }
  }
  const usedFacts = [];
  for (const slot of agenda.slots || []) {
    if (slot.facts && idOf.has(slot.n)) usedFacts.push(...slot.facts.map((f) => f.id));
  }
  const after = ensureFeed(work);
  // Первый слот выпуска и темы всех слотов: следующий выпуск не откроется той же темой.
  const posted = (agenda.slots || []).filter((s) => idOf.has(s.n) || made.some((id) => id.endsWith(`^${s.n}`)));
  const lead = posted[0] || (agenda.slots || [])[0];
  const leadNow = lead && lead.topic ? { topic: clipText(lead.topic, 90), stage: lead.stage || '' } : null;
  const calNow = posted.filter((s) => s.kind === 'calendar' && s.topic).map((s) => ({ topic: clipText(s.topic, 90), issue }));
  after.molva = {
    issue,
    since: 0,
    facts: [...after.molva.facts, ...usedFacts].slice(-MOLVA_FACTS_MAX),
    at: { day, time },
    topics: [...after.molva.topics, ...(agenda.slots || []).filter((s) => s.topic).map((s) => clipText(s.topic, 90))].slice(-MOLVA_TOPICS_MAX),
    lead: leadNow || after.molva.lead,
    // Открывающие темы трёх последних выпусков и последний слот календаря по событиям (баги 65, 72).
    leads: leadNow ? [...after.molva.leads, leadNow].slice(-MOLVA_LEADS_MAX) : after.molva.leads,
    cal: [...after.molva.cal.filter((c) => !calNow.some((n) => similar(n.topic, c.topic))), ...calNow].slice(-6),
  };
  const delta = deltaOf(work, made, opts.stamp);
  return { ok: true, delta, posts, replies };
}

/** Дельта выпуска: новые записи, сюжетики после выпуска и счёт. */
function deltaOf(work, ids, stamp) {
  const feed = ensureFeed(work);
  const want = new Set(ids);
  return {
    stamp: str(stamp),
    items: feed.items.filter((x) => want.has(x.id)).map((x) => ({ ...x })),
    threads: clone(feed.threads),
    molva: clone(feed.molva),
  };
}

/** Дельты из хранилища: всё непохожее выбрасывается, держится последние `DELTAS_KEPT`. */
export function readDeltas(raw) {
  const out = [];
  for (const d of Array.isArray(raw) ? raw : []) {
    if (!d || typeof d !== 'object') continue;
    const items = (Array.isArray(d.items) ? d.items : []).map(normalizeItem).filter(Boolean).slice(0, 24);
    const m = normalizeFeed({ molva: d.molva }).molva;
    out.push({ stamp: str(d.stamp), items, threads: Array.isArray(d.threads) ? clone(d.threads) : [], molva: m });
  }
  return out.slice(-DELTAS_KEPT);
}

/**
 * Повторить выпуски на состоянии: записи ложатся (тот же id — на место),
 * сюжетики и счёт становятся такими, какими их оставил выпуск. Состояние не
 * правится — возвращается копия. Дельты без записей (`resetOnFail`) только
 * обнуляют счёт.
 *
 * @param {Object} state
 * @param {Object[]} deltas
 * @param {string} [stamp] если задан, берутся только дельты этого ответа
 */
export function replayMolva(state, deltas, stamp) {
  const list = (Array.isArray(deltas) ? deltas : []).filter((d) => d && (stamp === undefined || d.stamp === stamp));
  if (!list.length) return state;
  const next = clone(state);
  const feed = ensureFeed(next);
  for (const d of list) {
    for (const item of d.items || []) addFeedItem(next, item);
    const f = ensureFeed(next);
    f.threads = normalizeThreads(d.threads, f.cast);
    f.molva = { ...f.molva, ...normalizeFeed({ molva: d.molva }).molva };
  }
  return next;
}

/** Сколько постов и ответов в дельтах — для отчёта кнопки. */
export function countDelta(delta) {
  const items = (delta && delta.items) || [];
  return { posts: items.filter((x) => !x.parent).length, replies: items.filter((x) => x.parent).length };
}

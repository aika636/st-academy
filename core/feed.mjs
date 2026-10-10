// core/feed — лента курса: что люди говорят о том, что случилось (шаг 3).
//
// Лента — не журнал. Журнал кольцевой на двести записей и пишет механику
// (оценки, сдвиги, отладку); сплетни из него выпадали бы через неделю игры.
// Поэтому у ленты своё поле `state.feed` со своим потолком
// (`nabrosok-odnokursniki.md` раздел 4).
//
//   state.feed = {
//     items: [ { id, src, at: {day, time}, factRef, kind: 'fact'|'reaction',
//                who, nick, parent, chan: 'chat'|'anon', text, rumor, truth,
//                status: 'new'|'taken'|'played'|'expired', read, mine,
//                about: [id…], heroine, loud?, factText?, gist?, playedSrc? } ],
//     seen:  { [personId]: {day, time, local?} },   // кто когда был в сцене
//     deals: [ { id, src, a, b, what, open, since, closedOn } ],
//     cast:  [ { id, nick, type, interest, goal, manner, ally, rival } ],
//     threads: [ { id, topic, members: [id…], dispute, stage, source, since } ],
//     molva: { issue, since, facts: [factId…], at: {day, time}, topics: [текст…], lead: {topic, stage} },
//   }
//
// `cast` — постоянные статисты слухов (до 8), `threads` — сюжетики массовки
// (до 3): шаг 1 плана «Слухи» (`etap-molva.md`). Что с ними делать — в
// `core/feed-cast.mjs` и `core/feed-threads.mjs`; здесь только форма и
// нормализация, чтобы они жили в `state.feed` и откатывались со всей лентой.
// `molva` — счёт выпусков (шаг 2, `core/molva.mjs`): номер выпуска, сколько
// ответов бота прошло с прошлого и какие факты уже стали темой.
//
// Четыре решения.
//
// 1. **Поле заводится лениво** (`ensureFeed`): миграцию схемы ведёт
//    `core/state.mjs`, а ленты у старых семестров просто нет — это не поломка,
//    а пустая лента. Битое поле нормализуется при чтении, не бросает.
// 2. **Откат — вместе с состоянием.** Лента лежит внутри `state`, и снимок
//    хода (`chat_metadata.academy_turns`, `cloneState`) берёт её целиком:
//    свайп откатывает и слухи, а пересчёт ответа кладёт их заново.
// 3. **Запись помнит, из какого ответа она** (`src` — отпечаток ответа) и на
//    какой факт опирается (`factRef` — канонический токен разбора). Так
//    вычеркнутый факт уносит свои реакции, а снятый разбор — всё своё, не
//    трогая записей других ответов.
// 4. **Слух — не правда.** У анонимки и у прозвучавшего в сцене слуха
//    `rumor: true` (реплика чата про слух — обсуждение, не слух); `truth` хранится внутри (`null` — неизвестно) и в промпт
//    не идёт никогда. Знание мягкое (ответ владелицы 07.10): всё, что касается
//    героини (`heroine: true`), может идти в дайджест; чужое — только
//    прочитанное (`read`). Фон строки состояния (`feedBackground`) и слух в
//    лорбуке однокурсника (`rumorFor`) — шаг 4.
//
// Ветки и маски (решение владелицы 08.10, «формат ленты»).
//
// - **Ответ в ветке** — запись с `parent` (id поста). Ветка плоская: ответ
//   цепляется к посту, не к ответу. Пост ушёл (вычеркнули факт, сняли разбор,
//   вытеснило кольцо) — его ответы уходят с ним, из какого бы ответа модели
//   они ни были: сирот лента не держит (`normalizeFeed`).
// - **Ник** (`nick`) — одноразовая маска вместо автора: «школьный бес».
//   С основных аккаунтов пишут только люди из состава (`who`); остальные — под
//   ником. Ник не человек: в состав, кандидаты, «был в сцене», лорбук и
//   отношения он не идёт — у записи с ником `who` пустой.
// - **Типаж** (`type`) — кто под ником: «футболист-альфа», «завистница».
//   На экране его нет, ник говорит сам; он нужен рассказчику в поводе
//   (`plot.hookCore`) вместо безликого «кто-то с курса» и секретарю, чтобы
//   ник держал характер. Персонажем типаж не становится, как и ник.
// - **Значки** под постом (😂 12, 👀 7) считает код, без модели: от id записи,
//   громкости и числа ответов (`reactCounts`), так что пересчёт и перерисовка
//   их не меняют. У ответа в ветке значков меньше и счёт скромнее — первые
//   три из набора поста (решение 08.10). Хранится только значок игрока
//   (`mine`, у поста и у ответа) — украшение: ни состояние семестра, ни
//   отношения, ни промпт он не трогает; откатывается вместе с лентой и
//   переносится пересчётом (`carryFeedMarks`).
//
// Функции правят переданное состояние на месте, как `classmates.addCandidate`:
// их зовут на рабочей копии вызывающего (`core/scene.mjs`).

import { diffDays } from './time.mjs';

/** Потолок записей ленты: кольцо, старые уходят первыми. */
export const FEED_MAX = 120;

/** Потолок дел между людьми: открытые старше уходят раньше закрытых новых. */
export const DEALS_MAX = 40;

/** Потолок «кто был в сцене» — больше людей курс не держит. */
export const SEEN_MAX = 40;

/** Потолок реакций на один разбор, если пресет не задал свой (ответ владелицы 07.10). */
export const REACTION_CAP = 6;

/** Границы потолка из пресета (`core/preset.mjs` проверяет те же). */
export const CAP_BOUNDS = [1, 12];

/** Каналы: чат курса (автор виден, обсуждают факт) и анонимка (слух). */
export const CHANNELS = ['chat', 'anon'];

/** Жизнь повода: ждёт, взят в сюжет, сыгран, истёк (`razbor-inject.md`, приём 2). */
export const STATUSES = ['new', 'taken', 'played', 'expired'];

/** Длина текста записи. */
export const FEED_TEXT_MAX = 200;

/** Длина ника-маски. */
export const NICK_MAX = 32;

/**
 * Значки под постом — по тону: анонимка шепчется, шумное и стычки — драма,
 * обычный чат — смех и согласие. Набор выбирается детерминированно
 * (`reactSet`), игрок ставит свой значок из того же набора.
 */
export const REACT_SETS = {
  chat: ['😂', '👍', '🙄', '❤️'],
  drama: ['😱', '🍿', '😂', '👀'],
  anon: ['👀', '😱', '🤫', '🔥'],
};

/** Все значки, что может хранить запись. */
const ALL_REACTS = new Set(Object.values(REACT_SETS).flat());

/** Знак героини — тот же, что у `tie.to` курса и сторон метки. */
const HEROINE = '@heroine';

/**
 * Громкость события (`loud=` секретаря) → сколько реакций оно стоит.
 * 0 — тихо: обычная оценка, её замечает разве что один заинтересованный;
 * 1 — заметно; 2 — громко: прогул при всех, ссора; 3 — скандал, до потолка.
 */
export const LOUDNESS = [
  { level: 0, max: 1, word: 'тихо' },
  { level: 1, max: 2, word: 'заметно' },
  { level: 2, max: 3, word: 'шумно' },
  { level: 3, max: Infinity, word: 'скандал' },
];

/**
 * Потолок реакций на один разбор. Пресет может задать свой
 * (`feed.reactionCap`); мусор и отсутствие — умолчание 6.
 */
export function reactionCap(preset) {
  const own = preset && preset.feed && preset.feed.reactionCap;
  const n = Number(own);
  if (own === undefined || own === null || own === '' || !Number.isFinite(n)) return REACTION_CAP;
  return Math.max(CAP_BOUNDS[0], Math.min(CAP_BOUNDS[1], Math.round(n)));
}

/**
 * Типажи статистов под никами (`feed.extras`): в космической академии нет
 * чирлидерши, в секте — футболиста. Пресет без своих — общие, без примет
 * школы или мира.
 */
export const DEFAULT_EXTRAS = [
  'завистница', 'сплетница', 'ботан', 'тихоня', 'сердцеед', 'сноб', 'задира',
  'вечный двоечник', 'старый знакомый', 'фанатка', 'шутник',
];

/** Примеры ников с типажом в скобках (`feed.nickExamples`); пресет без своих — общие. */
export const DEFAULT_NICK_EXAMPLES = ['всё-видел (сплетник)', 'не скажу кто (завистница)', 'вечно второй (ботан)'];

/**
 * Манеры речи статистов (`feed.manners`): поведение, а не ярлык. Пресет без
 * своих — общие, без примет заведения.
 */
export const DEFAULT_MANNERS = [
  'отвечает вопросом на вопрос',
  'хвалит и тут же поддевает',
  'пишет коротко, без знаков препинания',
  'всё переводит на своё увлечение',
  'начинает фразу с «только никому» и рассказывает всем',
  'оговаривается и сам же поправляет',
  'ссылается на то, что «все уже знают»',
  'шутит там, где другие ругаются',
];

/**
 * Бытовые темы слота «Мир» (`feed.worldTopics`): очередь в столовую, дежурство,
 * сломанный лифт — то, о чём болтают, когда в сюжете ничего не случилось. Пресет
 * без своих — общие, без примет заведения.
 */
export const DEFAULT_WORLD_TOPICS = [
  'очередь в столовую и что сегодня дали',
  'кто занял лучшие места в читальном зале',
  'дежурство по уборке: чья очередь',
  'расписание опять поменяли в последний момент',
  'у кого сломалось что-то в общем помещении',
];

/** Список строк пресета: без пустых и повторов, с потолком; пусто — умолчание. */
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
  return presetList(preset && preset.feed && preset.feed.manners, DEFAULT_MANNERS, 16, 120);
}

/** Сколько реакций допускает громкость при потолке пресета. */
export function loudCap(loud, cap = REACTION_CAP) {
  const row = LOUDNESS.find((l) => l.level === loud) || LOUDNESS[1];
  return Math.min(row.max, cap);
}

// --- поле ---------------------------------------------------------------------------

/** Пустая лента. */
export function emptyFeed() {
  return { items: [], seen: {}, deals: [], cast: [], threads: [], molva: emptyMolva() };
}

/**
 * Лента состояния — заведённая и нормализованная, на месте. Старое
 * состояние без поля получает пустую.
 * @returns {{items: Object[], seen: Object, deals: Object[], cast: Object[], threads: Object[]}}
 */
export function ensureFeed(state) {
  const fresh = normalizeFeed(state && state.feed);
  if (state && typeof state === 'object') state.feed = fresh;
  return fresh;
}

/** Нормализовать сырое поле ленты: всё непохожее выбрасывается молча. */
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
  // Каст сперва: сюжетики держатся за его id, а ссылка на ушедшего снимается.
  const cast = normalizeCastList(src.cast);
  return { items, seen: trimSeen(seen), deals, cast, threads: normalizeThreads(src.threads, cast), molva: normalizeMolva(src.molva) };
}

/** Запись ленты; без текста или без id — `null`. */
export function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id);
  const text = clipText(raw.text, FEED_TEXT_MAX);
  if (!id || !text) return null;
  const chan = CHANNELS.includes(raw.chan) ? raw.chan : 'chat';
  const kind = raw.kind === 'fact' ? 'fact' : 'reaction';
  const nick = kind === 'reaction' ? cleanNick(raw.nick) : '';
  const parent = kind === 'reaction' && str(raw.parent) !== id ? str(raw.parent) : '';
  return {
    id,
    src: str(raw.src),
    at: { day: str(raw.at && raw.at.day), time: str(raw.at && raw.at.time) },
    factRef: str(raw.factRef),
    kind,
    // Под маской автора нет: ник не человек и в состав не ведёт.
    who: nick ? '' : str(raw.who),
    nick,
    type: nick ? cleanType(raw.type) : '',
    // Ответ в ветке — только реакция и только к другому посту.
    parent,
    chan,
    text,
    // Слух — анонимка и факт-слух из сцены. Реплика чата про слух — это
    // обсуждение («Это неправда!»), не слух сама; старые записи, где она
    // была помечена слухом, читаются по-новому.
    rumor: kind === 'reaction' ? chan === 'anon' : raw.rumor === true,
    truth: raw.truth === true || raw.truth === false ? raw.truth : null,
    status: STATUSES.includes(raw.status) ? raw.status : 'new',
    read: raw.read === true,
    // Значок игрока — у поста и у ответа в ветке (решение 08.10).
    mine: ALL_REACTS.has(raw.mine) ? raw.mine : '',
    about: (Array.isArray(raw.about) ? raw.about : []).map(str).filter(Boolean).slice(0, 4),
    heroine: raw.heroine === true,
    // Громкость разбора, из которого запись (`loud=`), — по ней авто-режим
    // выбирает повод; к какому факту реакция — словами, для вкладки и фона;
    // каким ответом секретарь отметил повод сыгранным — чтобы снять отметку
    // вместе с разбором.
    loud: Number.isInteger(raw.loud) && raw.loud >= 0 && raw.loud <= 3 ? raw.loud : null,
    factText: clipText(raw.factText, FACT_TEXT_MAX),
    // Суть факта одной фразой («Вера Соколова списала контрольную») — то,
    // что пересказывают лорбук и фон после «говорят, что…» (`scene.sceneGist`).
    gist: kind === 'fact' ? clipText(raw.gist, FEED_TEXT_MAX) : '',
    playedSrc: raw.status === 'played' ? str(raw.playedSrc) : '',
    // Сцена без свидетелей: в слухи она идёт только слухом (`core/molva.mjs`).
    ...(kind === 'fact' && raw.private === true ? { private: true } : {}),
    // Заметный факт о героине из разбора (прогул, опоздание, провал, триумф): тема слухов
    // с низким приоритетом, а не повод рассказчику и не пункт ленты (`core/scene.mjs`).
    ...(kind === 'fact' && raw.minor === true ? { minor: true } : {}),
  };
}

/** Длина подписи «к какому факту». */
export const FACT_TEXT_MAX = 100;

/**
 * Ник-маска: одна строка без знаков метки, до `NICK_MAX`. Подчёркивания и
 * дефисы — как написано («школьный_бес»), служебные `~` и `@` в начале
 * снимаются. Меньше двух букв — не ник.
 */
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

/** Типаж под ником: «футболист-альфа». Те же правила, что у ника. */
export function cleanType(raw) {
  return cleanNick(raw);
}

/** Ник на экране: «@школьный бес» — видно, что это маска, а не человек. */
export function nickWord(nick) {
  const n = cleanNick(nick);
  return n ? `@${n}` : '';
}

/** Ответы, чьего поста в списке нет, уходят: сирот лента не держит. */
function dropOrphans(items) {
  const posts = new Set(items.filter((x) => !x.parent).map((x) => x.id));
  return items.filter((x) => !x.parent || posts.has(x.parent));
}

/**
 * Кольцо режется с головы, но ветками: уходит самый старый пост целиком, со
 * всеми ответами, — ветку посередине не обрывает.
 */
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
  if (!id || !a || !b || !what) return null;
  return {
    id, src: str(raw.src), a, b, what,
    open: raw.open !== false,
    since: str(raw.since),
    closedOn: raw.open === false ? str(raw.closedOn) : '',
  };
}

// --- каст и сюжетики --------------------------------------------------------------------

/** Потолок каста: статистов модель не добавляет, больше восьми лента не держит. */
export const CAST_MAX = 8;

/** Потолок сюжетиков массовки, одновременно открытых. */
export const THREADS_MAX = 3;

/** Сколько участников у сюжетика. */
export const THREAD_MEMBERS = [2, 3];

/** Стадии сюжетика по порядку; после «развязки» он закрывается. */
export const STAGES = ['завязка', 'спор', 'торг', 'развязка'];

/** Откуда сюжетик: событие календаря, учёба, пара «союзник/соперник» каста. */
export const THREAD_SOURCES = ['calendar', 'study', 'cast'];

/** Длины полей статиста и сюжетика. */
export const CAST_TEXT_MAX = { nick: NICK_MAX, type: 40, interest: 90, goal: 110, manner: 140 };
export const THREAD_TEXT_MAX = { topic: 90, dispute: 180 };

/** Id статиста и сюжетика: латиница, цифры, дефис — их не печатают, ими ссылаются. */
const ID_RE = /^[\w-]{1,24}$/;

/** Короткий текст поля: одна строка, без «|» — разделителя построчного формата. */
function plain(v, max) {
  return oneLine(v, max * 2).replace(/\|/g, '/').slice(0, max).trim();
}

/** Первый свободный id статиста: cast1, cast2… */
export function freeId(prefix, used) {
  for (let n = 1; ; n += 1) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

/**
 * Статист к форме. Без ника (меньше двух букв) — `null`: безымянного нечем
 * подписать. Остальные поля необязательны — человек мог стереть их руками.
 * Связи (`ally`, `rival`) здесь не проверяются: это делает список целиком.
 */
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
    manner: plain(raw.manner, CAST_TEXT_MAX.manner),
    ally: str(raw.ally),
    rival: str(raw.rival),
  };
}

/**
 * Каст: битые записи и повторы id выбрасываются, потолок `CAST_MAX` жёсткий.
 * Запись без id получает свободный; союзник и соперник, которых в списке нет
 * (или это сам статист), обнуляются; один и тот же человек не бывает и тем и
 * другим — остаётся союзник.
 */
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

/**
 * Сюжетик к форме. Участники — только из каста (`ids`), без повторов, от двух
 * до трёх; меньше двух осталось — сюжетика нет. Без темы или id — `null`.
 */
export function normalizeThread(raw, ids) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id);
  const topic = clipText(raw.topic, THREAD_TEXT_MAX.topic);
  if (!ID_RE.test(id) || !topic) return null;
  const members = [];
  for (const m of Array.isArray(raw.members) ? raw.members : []) {
    const v = str(m);
    if (ids.has(v) && !members.includes(v)) members.push(v);
  }
  if (members.length < THREAD_MEMBERS[0]) return null;
  return {
    id,
    topic,
    members: members.slice(0, THREAD_MEMBERS[1]),
    dispute: oneLine(raw.dispute, THREAD_TEXT_MAX.dispute),
    stage: STAGES.includes(raw.stage) ? raw.stage : STAGES[0],
    source: THREAD_SOURCES.includes(raw.source) ? raw.source : 'cast',
    since: str(raw.since),
    // День, когда событие кончилось (бал, контрольная): после него сюжетик подводит итог и закрывается.
    on: /^\d{4}-\d{2}-\d{2}$/.test(str(raw.on)) ? str(raw.on) : '',
    // Сколько выпусков подряд сюжетик не двигался: на третьем он идёт на следующую стадию сам.
    idle: Number.isInteger(raw.idle) && raw.idle > 0 ? Math.min(raw.idle, 9) : 0,
  };
}

/** Сюжетики: не больше `THREADS_MAX`, id не повторяются; участники — из `cast`. */
export function normalizeThreads(raw, cast) {
  const ids = new Set((Array.isArray(cast) ? cast : []).map((m) => m.id));
  const out = [];
  for (const r of Array.isArray(raw) ? raw : []) {
    const t = normalizeThread(r, ids);
    if (!t || out.some((x) => x.id === t.id)) continue;
    out.push(t);
    if (out.length >= THREADS_MAX) break;
  }
  return out;
}

/** Сколько фактов-тем выпусков помнит счёт: старые давно вышли из «нового». */
export const MOLVA_FACTS_MAX = 60;

/** Счёт выпусков слухов: ни одного, ни одного ответа с тех пор, ни одного факта. */
export function emptyMolva() {
  return { issue: 0, since: 0, facts: [], at: { day: '', time: '' }, topics: [], lead: { topic: '', stage: '' }, leads: [], cal: [] };
}

/** Сколько тем последних выпусков помнит счёт: ими не открывают следующий и не повторяют «Мир». */
export const MOLVA_TOPICS_MAX = 10;

/** Сколько открывающих тем последних выпусков помнит счёт: ими выпуск не открывается снова. */
export const MOLVA_LEADS_MAX = 3;

/** Сколько выпусков события календаря не повторяются в слоте «Календарь». */
export const CALENDAR_GAP = 3;

/** Счёт выпусков к форме; битое поле — пустой счёт. */
export function normalizeMolva(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const num = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  return {
    issue: num(src.issue),
    since: num(src.since),
    facts: (Array.isArray(src.facts) ? src.facts : []).map(str).filter(Boolean).slice(-MOLVA_FACTS_MAX),
    at: { day: str(src.at && src.at.day), time: str(src.at && src.at.time) },
    // Темы последних выпусков и тема, что открывала прошлый: слухи не начинается дважды одним.
    topics: (Array.isArray(src.topics) ? src.topics : []).map((t) => clipText(t, 90)).filter(Boolean).slice(-MOLVA_TOPICS_MAX),
    lead: { topic: clipText(src.lead && src.lead.topic, 90), stage: str(src.lead && src.lead.stage) },
    // Открывающие темы трёх последних выпусков и когда в последний раз шёл слот «Календарь» о событии.
    leads: (Array.isArray(src.leads) ? src.leads : [])
      .map((l) => ({ topic: clipText(l && l.topic, 90), stage: str(l && l.stage) })).filter((l) => l.topic).slice(-MOLVA_LEADS_MAX),
    cal: (Array.isArray(src.cal) ? src.cal : [])
      .map((c) => ({ topic: clipText(c && c.topic, 90), issue: num(c && c.issue) })).filter((c) => c.topic).slice(-6),
  };
}

// --- записи -------------------------------------------------------------------------

/** Записи ленты, старые первыми (копия списка). */
export function feedItems(state) {
  return normalizeFeed(state && state.feed).items;
}

/**
 * Дописать запись. Тот же id уже есть — запись заменяется на месте (пересчёт
 * ответа кладёт те же записи заново). Кольцо режется с головы.
 * @returns {?string} id записи; `null` — запись не годится
 */
export function addFeedItem(state, raw) {
  const feed = ensureFeed(state);
  const item = normalizeItem(raw);
  if (!item) return null;
  // Ответ без поста не ложится.
  if (item.parent && !feed.items.some((x) => x.id === item.parent && !x.parent)) return null;
  const at = feed.items.findIndex((x) => x.id === item.id);
  if (at >= 0) feed.items[at] = item;
  else feed.items.push(item);
  feed.items = trimRing(feed.items);
  return feed.items.some((x) => x.id === item.id) ? item.id : null;
}

/** Убрать записи, подходящие под условие, — посты вместе с ветками. @returns {number} сколько ушло */
function removeWhere(state, test) {
  const feed = ensureFeed(state);
  const before = feed.items.length;
  feed.items = dropOrphans(feed.items.filter((x) => !test(x)));
  return before - feed.items.length;
}

/** Снять запись по id. */
export function removeFeedItem(state, id) {
  return removeWhere(state, (x) => x.id === id) > 0;
}

/** Снять всё, что опирается на факт `factRef` этого ответа: сам факт и его реакции. */
export function dropByFact(state, src, factRef) {
  return removeWhere(state, (x) => x.src === src && x.factRef === factRef);
}

/** Снять записи ответа `src`; `kind` — только реакции или только факты. */
export function removeBySource(state, src, kind = null) {
  return removeWhere(state, (x) => x.src === src && (!kind || x.kind === kind));
}

/**
 * Реакции сохранённого разбора — в ленту, с ветками ответов. Прежние реакции
 * и ответы того же ответа снимаются: функция идемпотентна, и пересчёт,
 * поправка и её снятие ходят через неё одну. Пустой список — просто снять.
 *
 * Ответ (`opts.replies`) цепляется к посту: к реакции этого же разбора
 * (`parent.token` — токен реакции) или к посту ленты (`parent.feed` — id
 * записи). Поста нет — ответ не ложится.
 *
 * @param {Object} state
 * @param {string} src отпечаток ответа
 * @param {Array<{fact: string, token?: string, who?: string, nick?: string, type?: string, chan?: string, text: string, rumor?: boolean, about?: string[], heroine?: boolean}>} reactions
 * @param {{day?: string, time?: string, cap?: number, loud?: number, replies?: Array<{parent: {token?: string, feed?: string}, who?: string, nick?: string, type?: string, text: string}>}} [opts]
 * @returns {string[]} id легших записей
 */
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
      // К факту — только в своём ответе: чужой `factRef` с этим `src` не сходится.
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

// --- ветки и значки -------------------------------------------------------------------

/** Ответы поста по порядку (копии). */
export function repliesOf(state, postId) {
  return feedItems(state).filter((x) => x.parent && x.parent === postId);
}

/** Ветка: пост и его ответы; `null` — поста нет (или это ответ). */
export function threadOf(state, postId) {
  const items = feedItems(state);
  const post = items.find((x) => x.id === postId && !x.parent);
  return post ? { post, replies: items.filter((x) => x.parent === post.id) } : null;
}

/** Сколько значков у ответа в ветке: первые из набора поста. */
export const REPLY_REACTS = 3;

/**
 * Набор значков записи — по каналу и тону, детерминированно. У ответа —
 * первые `REPLY_REACTS` набора по тому же правилу: ветка компактнее поста.
 * Канал у ответа — его поста (`putReactions`), громкость — своего разбора.
 */
export function reactSet(item) {
  if (!item) return REACT_SETS.chat;
  const set = item.chan === 'anon' ? REACT_SETS.anon
    : ((item.loud ?? 1) >= 2 || /^clash=/.test(item.factRef || '')) ? REACT_SETS.drama
      : REACT_SETS.chat;
  return item.parent ? set.slice(0, REPLY_REACTS) : set;
}

/** Сколько значков «стоит» пост по громкости: тихо — горстка, скандал — десятки. */
const REACT_SCALE = [3, 7, 16, 34];

/** Веса значков набора: первый — самый частый. */
const REACT_WEIGHTS = [1, 0.6, 0.4, 0.25];

/** Сколько значков «стоит» ответ в ветке: в разы меньше, чем пост. */
const REPLY_SCALE = [1, 2, 4, 7];

/**
 * Счёт значков под записью: функция id записи (seed), громкости и числа
 * ответов — без модели и без случайности, так что пересчёт ответа и
 * перерисовка дают те же числа. Значок игрока (`mine`) — плюс один и
 * подсветка. Нули не показываются, кроме значка игрока; первые три — от
 * единицы, чтобы строка не пустовала.
 *
 * Ответ в ветке считается так же, но от своего id и скромнее
 * (`REPLY_SCALE`): три значка из набора поста, от единицы — первые два, так
 * что под ответом их два или три (решение 08.10).
 *
 * @param {Object} item пост или ответ ленты
 * @param {number} [replies] сколько у поста ответов (у ответа не считается)
 * @returns {Array<{emoji: string, n: number, mine: boolean}>}
 */
export function reactCounts(item, replies = 0) {
  if (!item || !item.id) return [];
  const reply = Boolean(item.parent);
  const rand = seeded(hash(`${item.id}|react`));
  const loud = Number.isInteger(item.loud) && item.loud >= 0 && item.loud <= 3 ? item.loud : 1;
  const base = reply ? REPLY_SCALE[loud]
    : REACT_SCALE[loud] + Math.max(0, Math.min(10, Math.trunc(replies) || 0)) * 2;
  const floor = reply ? 2 : 3;
  return reactSet(item).map((emoji, i) => {
    const own = item.mine === emoji;
    const n = Math.max(i < floor ? 1 : 0, Math.floor(base * REACT_WEIGHTS[i] * (0.35 + 0.65 * rand()))) + (own ? 1 : 0);
    return { emoji, n, mine: own };
  }).filter((r) => r.n > 0);
}

/**
 * Значок игрока — переключатель: тот же значок снимает, другой заменяет.
 * У поста и у ответа — из набора этой записи (`reactSet`).
 * @returns {?string} значок после нажатия ('' — снят); `null` — нельзя
 */
export function toggleReact(state, id, emoji) {
  const item = ensureFeed(state).items.find((x) => x.id === id);
  if (!item || !reactSet(item).includes(emoji)) return null;
  item.mine = item.mine === emoji ? '' : emoji;
  return item.mine;
}

/** Сколько недавних постов видит секретарь. */
export const RECENT_POSTS = 4;

/**
 * Недавние посты ленты для секретаря — чтобы он мог продолжить старую ветку
 * (`reply=f2:…`). Только реплики-посты (не факты и не ответы), не истёкшие;
 * свежие первыми, с короткими ссылками f1, f2…
 *
 * @returns {Array<{ref: string, id: string, who: string, nick: string, type: string, chan: string, text: string, replies: number}>}
 */
export function recentPosts(state, max = RECENT_POSTS) {
  const items = feedItems(state);
  const posts = items.filter((x) => x.kind === 'reaction' && !x.parent && x.status !== 'expired').slice(-max).reverse();
  return posts.map((x, i) => ({
    ref: `f${i + 1}`, id: x.id, who: x.who, nick: x.nick, type: x.type || '', chan: x.chan, text: x.text,
    replies: items.filter((y) => y.parent === x.id).length,
  }));
}

/** Ссылка на пост ленты в токене разбора — отпечаток id: в id есть двоеточия. */
export function postRef(id) {
  return hash(`post|${str(id)}`);
}

/** Пост ленты по ссылке токена; `null` — его уже нет. */
export function postByRef(state, ref) {
  return feedItems(state).find((x) => !x.parent && postRef(x.id) === ref) || null;
}

/** Числа от seed (mulberry32): тот же seed — те же числа. */
function seeded(seedText) {
  let a = parseInt(String(seedText), 36) >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Громкость разбора — всем записям ответа `src`, и фактам, и реакциям. */
export function setLoudness(state, src, loud) {
  if (!Number.isInteger(loud)) return 0;
  let n = 0;
  for (const x of ensureFeed(state).items) {
    if (x.src !== src) continue;
    x.loud = loud;
    n += 1;
  }
  return n;
}

/** Пометить прочитанным: id или список id; без списка — всё. @returns {number} */
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

/**
 * Сменить жизнь повода (`STATUSES`). «Сыграно» помнит, каким ответом его
 * отметил секретарь (`playedSrc`): снятый разбор снимает и отметку.
 */
export function setStatus(state, id, status, playedSrc = '') {
  if (!STATUSES.includes(status)) return false;
  const item = ensureFeed(state).items.find((x) => x.id === id);
  if (!item) return false;
  item.status = status;
  item.playedSrc = status === 'played' ? str(playedSrc) : '';
  return true;
}

/** Запись по id; `null` — нет такой. */
export function feedItem(state, id) {
  return feedItems(state).find((x) => x.id === id) || null;
}

/** Сколько непрочитанного; `chan` — только в этом канале. */
export function unreadCount(state, chan = null) {
  return feedItems(state).filter((x) => !x.read && (!chan || x.chan === chan)).length;
}

/**
 * Отметки человека и жизнь повода — с прошлой версии ленты на новую.
 *
 * Пересчёт последнего ответа (свайп, сохранённый разбор, правка) идёт от
 * снимка «до него», а «прочитано», «взято в сюжет», «истекло» ставились уже
 * после — и без переноса сбрасывались бы на каждом пересчёте (значок игрока
 * `mine` — тоже). Записи узнаются
 * по id: у пересчёта того же ответа он тот же (`scene.factId`,
 * `putReactions`). «Прочитано» не снимается никогда; жизнь повода берётся с
 * прошлой версии — кроме «сыграно», которое поставил сам пересчитываемый
 * ответ `src`: это решает новый разбор (отметки нет — повод снова «взят»).
 *
 * @param {Object} prev прежнее состояние (живое до пересчёта)
 * @param {Object} next новое; не правится
 * @param {string} [src] отпечаток пересчитываемого ответа
 * @returns {Object} `next` или его копия с перенесёнными отметками
 */
export function carryFeedMarks(prev, next, src = '', memory = []) {
  const old = prev && prev.feed && Array.isArray(prev.feed.items) ? prev.feed.items : [];
  // Память свайпов — снизу, живая лента — сверху: что игрок поменял на
  // нынешнем варианте, важнее того, что помнится с ушедшего.
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
    // Значок игрока — его отметка, как «прочитано»; у ответа — тоже.
    const mine = reactSet(x).includes(was.mine) ? was.mine : '';
    if (mine !== x.mine) {
      x.mine = mine;
      changed = true;
    }
    // Новый разбор этого ответа сам отметил «сыграно» — его слово последнее.
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

/** Сколько отметок помнит память свайпов (`rememberFeedMarks`). */
export const MARKS_MAX = 2 * FEED_MAX;

/**
 * Память отметок игрока поверх свайпов (решение владелицы 08.10).
 *
 * Свайп откатывает ленту к снимку «до ответа» — и записи ушедшего варианта
 * уходят вместе со «своим» значком, «прочитано» и «взято». Вернулся игрок на
 * тот же вариант — записи те же (id от отпечатка ответа), и отметки должны
 * вернуться с ними. Поэтому перед откатом отметки живой ленты кладутся сюда, а
 * пересчёт отдаёт их `carryFeedMarks` четвёртым аргументом. У другого
 * варианта свои id — чужие отметки к ним не прилипают.
 *
 * @param {Array} memory прежняя память (не правится)
 * @param {Object} state живое состояние
 * @returns {Array<{id, read, mine, status, playedSrc}>} новая память
 */
export function rememberFeedMarks(memory, state) {
  const byId = new Map();
  for (const m of Array.isArray(memory) ? memory : []) {
    if (m && typeof m.id === 'string' && m.id) byId.set(m.id, m);
  }
  for (const x of feedItems(state)) {
    if (!x || !x.id) continue;
    // Перезапись сдвигает запись в конец: свежее вытесняется последним.
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

/**
 * Отметить записи сыгранными ответом `src` (секретарь, `played=`). Прежние
 * отметки этого ответа сперва снимаются: функция идемпотентна, как
 * `putReactions`, и пересчёт ходит через неё одну.
 * @param {string[]} ids записи ленты
 * @returns {number} сколько отмечено
 */
export function markPlayed(state, src, ids) {
  // Сперва снять: `ensureFeed` заводит поле заново, и ссылка, взятая до
  // снятия, смотрела бы на старую копию.
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

/** Снять отметки «сыграно», поставленные ответом `src`: повод снова «взят». */
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

/**
 * Знает ли героиня запись (мягкое знание, ответ владелицы 07.10): всё про неё
 * — да, чужое — только прочитанное.
 */
export function knownToHeroine(item) {
  return Boolean(item && (item.heroine || item.read));
}

// --- фон строки состояния и слух в лорбуке (шаг 4) ----------------------------------
//
// Лента целиком в промпт не идёт (9.11): модель утонула бы и пересказывала
// сплетни в каждом ответе. Наружу уходят два тонких среза.
//
// - **Фон** (слой 1) — не больше двух свежих пунктов к строке состояния, и
//   только когда есть что сказать. Свежее — за сегодня и вчера по календарю
//   игры. Знание мягкое: всё о героине — да, чужое — только прочитанное. Слух
//   помечен слухом всегда. Праздники и события уже звучат своим фоном
//   (`core/holidays`), поэтому реакции на `event=` сюда не идут.
// - **Слух в лорбуке** (слой 2) — одна строка в запись однокурсника: что
//   говорят о нём или что он мог слышать сам (автор, сторона, был в сцене в
//   тот день). Ложный слух о героине так и остаётся «говорят»: в её знание
//   он не превращается.
//
// Слова — не здесь: ядро отдаёт пункты с видом, а формулировки держат
// `prompt.mjs` и `core/lorebook.mjs`.

/** За сколько игровых дней запись ещё свежая для фона: сегодня и вчера. */
export const BACKGROUND_DAYS = 1;

/** Сколько пунктов фона самое большее. */
export const BACKGROUND_MAX = 2;

/** Длина одного пункта фона. */
export const BACKGROUND_TEXT_MAX = 90;

/** За сколько игровых дней слух ещё держится в записи лорбука. */
export const RUMOR_DAYS = 3;

/** Свежа ли запись к дню `day`: не раньше чем `days` дней назад и не из будущего. */
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

/** Опора записи — событие календаря: о нём говорит фон праздников. */
const onEvent = (x) => /^event=/.test(x.factRef || '');

/**
 * Вид пункта: `fact` — случилось и сыграно; `rumor` — прозвучавший в сцене
 * слух (текст факта как есть); `talk` — чат курса обсуждает факт; `gossip` —
 * сочинённый слух анонимки.
 */
function pointOf(x) {
  if (x.kind === 'fact') return { kind: x.rumor ? 'rumor' : 'fact', text: clipWords(x.gist || x.text, BACKGROUND_TEXT_MAX) };
  if (x.rumor) return { kind: 'gossip', text: clipWords(x.text, BACKGROUND_TEXT_MAX) };
  return { kind: 'talk', text: clipWords(x.factText || x.text, BACKGROUND_TEXT_MAX), quoted: !x.factText };
}

/**
 * Реплика ленты в фоне — сутью своего факта: слух — «Ренее встречается с
 * преподом (слух)», стычка — «Вера и Ренее поссорились (из-за конспекта) —
 * обсуждают». Сути нет — подпись факта, как у самого факта.
 */
function factPoint(fact) {
  const text = clipWords(fact.gist || fact.text, BACKGROUND_TEXT_MAX);
  return fact.rumor ? { kind: 'rumor', text } : { kind: 'talk', text, quoted: false };
}

/**
 * Фон потока курса: до `max` свежих пунктов, что героиня может знать.
 * Один пункт на факт (реакции одного факта — одно «обсуждают»). Порядок —
 * про героиню первым, потом громче, потом новее. Пусто — норма.
 *
 * @param {Object} state
 * @param {{max?: number, day?: string}} [opts]
 * @returns {Array<{kind: 'fact'|'rumor'|'talk'|'gossip', text: string, heroine: boolean, id: string}>}
 */
export function feedBackground(state, opts = {}) {
  const max = Number.isInteger(opts.max) ? opts.max : BACKGROUND_MAX;
  if (max <= 0) return [];
  const day = opts.day || (state && state.calendar && state.calendar.day) || '';
  const items = feedItems(state)
    .map((x, i) => ({ x, i }))
    // Ответы в ветках в фон не идут: фон краток, ему хватает поста.
    .filter(({ x }) => !x.parent && !x.minor && knownToHeroine(x) && x.status !== 'expired' && !onEvent(x) && freshOn(x, day, BACKGROUND_DAYS));
  items.sort((a, b) => (Number(b.x.heroine) - Number(a.x.heroine))
    || ((b.x.loud ?? 1) - (a.x.loud ?? 1))
    || (b.i - a.i));
  // Факт, к которому реплика: в фон идёт его суть, а не сама реплика —
  // «У неё роман с физруком» без того, о ком речь, читалось загадкой
  // (третий прогон 08.10).
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

/**
 * Свежая строка о человеке для его записи в лорбуке (слой 2): последний факт,
 * что о нём говорят или что он мог слышать сам. «Мог слышать» — он сторона
 * факта, откликнулся на него в ленте или был в сцене в тот же день.
 *
 * Только факты, и суть факта, а не реплика: реакция «Это неправда!» на слух
 * — обсуждение, и в запись она не идёт, иначе в лорбук вместо слуха ложилось
 * опровержение — и обоим людям сразу. Лопнувшее (истёкший слух) не идёт.
 *
 * @returns {?{kind: 'fact'|'rumor', text: string, id: string, gist: boolean}} `gist` —
 *   текст — суть одной фразой (ложится после «говорят, что…»), а не подпись факта
 */
export function rumorFor(state, personId, opts = {}) {
  const id = str(personId);
  if (!id || id === HEROINE) return null;
  const day = opts.day || (state && state.calendar && state.calendar.day) || '';
  const feed = normalizeFeed(state && state.feed);
  const seen = feed.seen[id];
  // Откликнулся в ленте — значит, слышал сам факт.
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

/**
 * Текст записи не длиннее `max` знаков: влезает — как есть; нет — по концу
 * предложения (если оно не слишком рано) или по слову, с «…». Резать посреди
 * слова без знака было багом 60.
 */
export function clipText(v, max) {
  const t = oneLine(v, 4000);
  if (t.length <= max) return t;
  const room = t.slice(0, max - 1);
  const stop = Math.max(room.lastIndexOf('. '), room.lastIndexOf('! '), room.lastIndexOf('? '));
  if (stop >= max * 0.6) return room.slice(0, stop + 1).trim();
  const at = room.lastIndexOf(' ');
  return `${(at > max / 2 ? room.slice(0, at) : room).replace(/[\s,;:\-–—]+$/u, '').trim()}…`;
}

/** Обрезать по слову с многоточием. */
export function clipWords(text, max) {
  const t = oneLine(text, 1000);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).trim()}…`;
}

// --- кто был в сцене ------------------------------------------------------------------

/**
 * Отметить, что человек был в сцене. Локальная отметка (`local` — имя
 * мелькнуло в тексте) не затирает отметку секретаря того же дня.
 * @returns {?Object} прежняя отметка — для квитанции
 */
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

/** Вернуть отметку «был в сцене» к прежней (`null` — убрать). */
export function restoreSeen(state, personId, prev) {
  const feed = ensureFeed(state);
  if (prev && typeof prev === 'object') feed.seen[personId] = { ...prev };
  else delete feed.seen[personId];
}

/** Когда человек был в сцене последний раз; `null` — не был. */
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

// --- дела между людьми ------------------------------------------------------------------

/** Одно ли это дело: те же стороны (в любом порядке) и то же «что». */
function sameDeal(d, a, b, what) {
  const pair = (d.a === a && d.b === b) || (d.a === b && d.b === a);
  return pair && key(d.what) === key(what);
}

/**
 * Открыть дело. Такое же открытое уже есть — второго нет.
 * @returns {{id: string, created: boolean}}
 */
export function openDeal(state, { a, b, what, src = '', day = '' }) {
  const feed = ensureFeed(state);
  const twin = feed.deals.find((d) => d.open && sameDeal(d, a, b, what));
  if (twin) return { id: twin.id, created: false };
  const id = `${src || 'deal'}~${hash(`${a}|${b}|${key(what)}`)}`;
  const deal = normalizeDeal({ id, src, a, b, what, open: true, since: day });
  if (!deal) return { id: '', created: false };
  feed.deals = feed.deals.filter((d) => d.id !== id);
  feed.deals.push(deal);
  if (feed.deals.length > DEALS_MAX) {
    const closed = feed.deals.findIndex((d) => !d.open);
    feed.deals.splice(closed >= 0 ? closed : 0, 1);
  }
  return { id, created: true };
}

/**
 * Закрыть дело. Открытого такого нет — ложится сразу закрытым: сцена
 * сказала «вернула конспект», и это след, даже если обещания мы не видели.
 * @returns {{id: string, created: boolean, wasOpen: boolean}}
 */
export function closeDeal(state, { a, b, what, src = '', day = '' }) {
  const feed = ensureFeed(state);
  const open = feed.deals.find((d) => d.open && sameDeal(d, a, b, what))
    || feed.deals.find((d) => d.open && ((d.a === a && d.b === b) || (d.a === b && d.b === a)) && near(d.what, what));
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

/** Снять дело по квитанции: созданное — убрать, закрытое — открыть снова. */
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

/** Открытые дела; с `personId` — только где он сторона. */
export function openDeals(state, personId = null) {
  return normalizeFeed(state && state.feed).deals
    .filter((d) => d.open && (!personId || d.a === personId || d.b === personId));
}

// --- мелочи ------------------------------------------------------------------------------

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function oneLine(v, max) {
  return str(v).replace(/\s+/g, ' ').slice(0, max).trim();
}

/** Ключ сравнения свободного текста. */
function key(s) {
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Похоже ли «что» закрытия на «что» открытого дела: общее слово от четырёх букв. */
function near(a, b) {
  const x = new Set(key(a).split(' ').filter((w) => w.length >= 4).map((w) => w.slice(0, 5)));
  return key(b).split(' ').some((w) => w.length >= 4 && x.has(w.slice(0, 5)));
}

/** Короткий отпечаток строки для id. */
export function hash(s) {
  let h = 0;
  const t = String(s);
  for (let i = 0; i < t.length; i += 1) h = (Math.imul(31, h) + t.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

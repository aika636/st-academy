// core/time-source — откуда в этом ответе берётся время. Один вход на всё.
//
// До этого модуля чтение времени было размазано: проза разбиралась в
// `parse-context`, год ей подставлял `engine`, там же жил переход через Новый
// год, а метка читалась третьим путём. План 9.7 («Часы сюжета») просит собрать
// это в одно место, пока ядро не застыло: когда появится шина времени соседей,
// меняться должен один файл, а не разбор по всему ядру.
//
// Здесь три источника, и у каждого своё место в очереди (`PRIORITY`):
//
//   A+ — машинные теги соседних расширений (9.2). Их пишет не модель «от
//        себя», а чужой код или жёсткая инструкция чужого расширения, формат у
//        них один и тот же в каждом ответе. Это самые надёжные даты в посте — и
//        ровно их `cleanForScan` выбрасывал вместе с HTML-комментариями.
//        Поэтому A+ читается ДО снятия HTML и стоит выше прозы.
//   A  — проза и инфоблоки: `parse-context`, как было.
//   B  — собственная метка (`<!-- [ACADEMY t=+1] -->`), подстраховка.
//
// Модуль ничего не двигает и ни с чем не спорит. Защиты — «назад нельзя» и
// «прыжок дальше потолка придержать» — живут в `time.setAbsolute`, и A+ идёт в
// календарь через тот же вызов, что и проза: доверие к тегу даёт ему очередь,
// но не право перепрыгнуть защиту. Чужой тег тоже может врать — например, если
// соседнее расширение завело свой календарь в другом году.

import { parseContext, dropThinking, resolveTwoDigitYear } from './parse-context.mjs';
import { stripMarker } from './parse-marker.mjs';

/** Источники времени и их очередь: чем больше число, тем раньше спрашивают. */
export const PRIORITY = Object.freeze({ 'A+': 30, A: 20, B: 10 });

// --- A+: белый список машинных тегов ----------------------------------------
//
// Каждый формат — дословно из разбора соседей (plan-academy.md, 9.2) и замера
// A (etap0-academy.md, «Вывод по этапу 0»). Белый список, а не «любой
// комментарий с датой»: чужой комментарий с датой внутри может быть чем угодно
// — датой письма в телефоне, днём рождения персонажа из лорбука, — и в очередь
// выше прозы попадает только то, чей смысл «сейчас в сцене вот это время»
// известен заранее.
//
// Порядок в списке — очередь внутри A+, если в одном ответе нашлись два разных
// тега. Первыми стоят те, что лежат в HTML-комментарии: их не видит ни человек,
// ни — чаще всего — модель в следующем ходе, и пишет их чужой код, а не проза.

const Y = '(\\d{4}|\\d{2})';
const D = '(\\d{1,2})';
const HM = '(\\d{1,2}):(\\d{2})';

/**
 * @typedef {Object} TagRule
 * @property {string} id       имя для отладки
 * @property {RegExp} re       глобальный: берётся последнее вхождение
 * @property {(m: RegExpMatchArray) => {y: string, mo: string, d: string, h?: string, mi?: string}} take
 */

/** @type {TagRule[]} */
export const TAGS = [
  {
    // Phone-ST: `<!--tel:time:HH:MM DD.MM.YYYY-->` в КАЖДОМ ответе, последней
    // строкой. Время идёт раньше даты — единственный такой формат в списке.
    id: 'tel:time',
    re: new RegExp(`<!--\\s*tel:time:\\s*${HM}\\s+${D}\\.${D}\\.${Y}\\s*-->`, 'gi'),
    take: (m) => ({ h: m[1], mi: m[2], d: m[3], mo: m[4], y: m[5] }),
  },
  {
    // Pregnancy-and-menstruation: `<!-- [RP_DATE:DD.MM.YYYY HH:MM] -->` в конце.
    // Часы необязательны: в замере A формат записан как `[RP_DATE: ...]`, без
    // гарантии, что время там всегда есть.
    id: 'RP_DATE',
    re: new RegExp(`<!--\\s*\\[\\s*RP_DATE\\s*:\\s*${D}\\.${D}\\.${Y}(?:\\s*,?\\s+${HM})?\\s*\\]\\s*-->`, 'gi'),
    take: (m) => ({ d: m[1], mo: m[2], y: m[3], h: m[4], mi: m[5] }),
  },
  {
    // Дневник: `<!-- diary Дневник DD.MM.YYYY, HH:MM` — комментарий на этом не
    // кончается, дальше идёт сама запись, поэтому закрывающее `-->` не
    // требуется. Слово «Дневник» не зашито: у дневника на другом языке оно своё,
    // а якорем служит `<!-- diary`.
    id: 'diary',
    re: new RegExp(`<!--\\s*diary\\b[^\\d\\n-]{0,40}?${D}\\.${D}\\.${Y}(?:\\s*,?\\s*${HM})?`, 'gi'),
    take: (m) => ({ d: m[1], mo: m[2], y: m[3], h: m[4], mi: m[5] }),
  },
  {
    // Horae: `time: ГГГГ/ММ/ДД HH:MM`, строкой внутри своего блока. Не
    // комментарий, но формат машинный: год впереди и через косую черту так не
    // пишет ни одна шапка из замера A. До этой правки из строки бралось только
    // время — дата терялась (`parse-context` ждал день первым), и календарь
    // двигался часами внутри одного дня. Между датой и часами допускается
    // короткая скобка — день недели, который Horae может дописать.
    id: 'horae',
    re: new RegExp(`(?:^|[\\n>])[ \\t]*time[ \\t]*[:：][ \\t]*(\\d{4})([/.-])${D}\\2${D}(?:[ \\t]*\\([^)\\n]{0,16}\\))?(?:[ \\t]+${HM})?(?![\\d:])`, 'gi'),
    take: (m) => ({ y: m[1], mo: m[3], d: m[4], h: m[5], mi: m[6] }),
  },
];

/** BB-телефон (регекс-пакет): две соседние строки подвала — склеиваются в одну. */
const BB_TIME_RE = /(?:^|\n)[ \t]*time[ \t]*[:：][ \t]*\[[ \t]*(\d{1,2}:\d{2}(?:[ \t]?[ap]\.?[ \t]?m\.?)?)[ \t]*\]/gi;
const BB_DATE_RE = /^[ \t]*date[ \t]*[:：][ \t]*\[([^\]\n]{1,40})\]/i;

/**
 * Машинный тег времени в сыром тексте ответа (источник A+).
 *
 * @param {string} text  сырой ответ модели — комментарии обязаны быть на месте
 * @param {{refYear?: number, year?: number}} [opts] опорный год — для
 *   двузначного года (9.1.5) и для даты BB-телефона, у которой года нет вовсе
 * @returns {?Object} находка в форме `parseContext` плюс `source: 'A+'`,
 *   `via` (имя тега) и `priority`
 */
export function readMachineTags(text, opts = {}) {
  const raw = dropThinking(typeof text === 'string' ? text : '');
  if (!raw) return null;
  const ref = numOr(opts.refYear, numOr(opts.year, undefined));

  for (let rank = 0; rank < TAGS.length; rank++) {
    const rule = TAGS[rank];
    const all = [...raw.matchAll(rule.re)];
    // Тегов одного вида в ответе может быть несколько — например, телефон
    // процитировал прошлую переписку. Сейчас в сцене то, что написано ПОСЛЕДНИМ:
    // Phone-ST ставит свой тег последней строкой, Pregnancy — в конец.
    for (let i = all.length - 1; i >= 0; i--) {
      const hit = fromParts(rule.take(all[i]), ref);
      if (!hit) continue;
      return finding(hit, rule.id, all[i][0].trim(), rank);
    }
  }

  const bb = readBbPhone(raw, opts, ref);
  if (bb) return finding(bb, 'bb-phone', bb.matched, TAGS.length);
  return null;
}

/**
 * BB-телефон: `Time: [HH:MM]` и `Date: [Thu, 5 Mar]` соседними строками.
 *
 * По отдельности обе строки проза уже читает (`Time:` — метка из словаря), но
 * склеить их она не может: правило (2) из 3.2 берёт дату с часами только в
 * пределах одной строки, и из подвала доставались одни часы. Здесь две строки
 * становятся одной и уходят в тот же `parseContext` — свой разбор даты словами
 * заводить незачем. Года в формате нет: подставляется опорный, и
 * `yearFromText` остаётся false — переход через Новый год движок поправит.
 *
 * Одинокое `Time: [HH:MM]` без даты в A+ не идёт: часов без даты мало, чтобы
 * перебивать прозу, в которой дата может быть. Его прочитает источник A.
 */
function readBbPhone(raw, opts, ref) {
  const text = raw.replace(/\r/g, '');
  const lines = text.split('\n');
  const all = [...text.matchAll(BB_TIME_RE)];
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i];
    const start = m.index + (m[0].startsWith('\n') ? 1 : 0);
    const lineNo = text.slice(0, start).split('\n').length - 1;
    // «Соседними строками» — в любом порядке: дата бывает и над часами, и под.
    const near = [lines[lineNo + 1], lines[lineNo - 1]].filter((l) => typeof l === 'string');
    const dateLine = near.map((l) => l.match(BB_DATE_RE)).find(Boolean);
    if (!dateLine) continue;
    const glued = `Date: ${dateLine[1]} | Time: ${m[1]}`;
    const hit = parseContext(glued, { clean: false, year: opts.year, refYear: ref });
    if (!hit || !hit.day || !hit.time) continue;
    return { ...hit, matched: `${m[0].trim()} / ${dateLine[0].trim()}` };
  }
  return null;
}

/** Числа тега → находка той же формы, что у `parseContext`. Мусор — null. */
function fromParts(p, ref) {
  let year = Number(p.y);
  let guessed = false;
  if (p.y.length === 2) {
    const r = resolveTwoDigitYear(year, ref);
    year = r.year;
    guessed = r.guessed;
  }
  const month = Number(p.mo);
  const day = Number(p.d);
  if (!validDate(year, month, day)) return null;

  let time = null;
  if (p.h !== undefined && p.mi !== undefined) {
    const h = Number(p.h);
    const mi = Number(p.mi);
    // Неверные часы при верной дате не губят дату: день из тега всё равно
    // надёжнее прозы, а часы просто не названы.
    if (h <= 23 && mi <= 59) time = `${pad(h)}:${pad(mi)}`;
  }
  return {
    day: `${String(year).padStart(4, '0')}-${pad(month)}-${pad(day)}`,
    time,
    daypart: null,
    weekday: null,
    dateParts: { year, month, day },
    yearFromText: !guessed,
  };
}

function finding(hit, via, matched, rank) {
  return {
    ...hit,
    matched,
    source: 'A+',
    via,
    // Внутри A+ очередь по списку: чем выше тег в `TAGS`, тем больше число.
    priority: PRIORITY['A+'] + (TAGS.length - rank),
    confidence: 1,
  };
}

// --- опорный год --------------------------------------------------------------

/** Год, в котором сейчас живёт календарь: им достраиваются даты без года. */
export function calendarYear(state) {
  const day = state && state.calendar && state.calendar.day;
  const year = typeof day === 'string' ? Number(day.slice(0, 4)) : NaN;
  return Number.isFinite(year) ? year : undefined;
}

/**
 * Год из эпохи анкеты (3.6): «1980-е», «Токио, 1987», «год 1247 от Основания».
 * Берётся только число из четырёх цифр — «80-е» или «XIX век» не читаются: это
 * догадка, а не год, и на двузначный год из неё опираться нельзя.
 */
export function eraYear(era) {
  if (typeof era !== 'string') return undefined;
  const m = era.match(/(?<!\d)(\d{4})(?!\d)/);
  return m ? Number(m[1]) : undefined;
}

/**
 * Опорный год для двузначного года (9.1.5): год календаря, а без него — эпоха
 * анкеты. Календарь впереди, потому что он и есть «сейчас в сцене»; анкета
 * описывает сеттинг целиком и нужна только новому семестру, у которого дня ещё
 * нет.
 */
export function referenceYear(state) {
  const cal = calendarYear(state);
  if (cal !== undefined) return cal;
  return eraYear(state && state.survey && state.survey.era);
}

// --- переход через Новый год --------------------------------------------------

/**
 * Переход через Новый год для даты, у которой год подставили мы.
 *
 * «3 января» в конце декабря с подставленным текущим годом уезжает на одиннадцать
 * месяцев назад, и `setAbsolute` отвергнет это как откат. Учебный год через
 * январь переваливает у всех трёх пресетов, так что случай обычный, а не
 * краевой. Правим только там, где год подставлен нами (`yearFromText === false`)
 * и промах больше полугода: настоящий флешбэк с написанным годом не трогаем
 * никогда, а обычный сдвиг вперёд на день-два под условие не попадает.
 *
 * Перенесено из `engine.mjs` без изменений: достраивание года — часть чтения,
 * а не движения календаря.
 */
const ROLLOVER_DAYS = 180;

export function rollYear(hit, state) {
  if (!hit || !hit.day || hit.yearFromText) return hit;
  const from = state && state.calendar && state.calendar.day;
  if (typeof from !== 'string') return hit;

  const gapDays = (Date.parse(from) - Date.parse(hit.day)) / 86400000;
  if (!Number.isFinite(gapDays) || gapDays <= ROLLOVER_DAYS) return hit;

  const parts = hit.dateParts;
  if (!parts || typeof parts.year !== 'number') return hit;
  const bumped = { ...parts, year: parts.year + 1 };
  const day = `${String(bumped.year).padStart(4, '0')}-${String(bumped.month).padStart(2, '0')}-${String(bumped.day).padStart(2, '0')}`;
  return { ...hit, day, dateParts: bumped };
}

// --- один вход ----------------------------------------------------------------

/**
 * Что этот ответ говорит о времени — все источники сразу, с очередью.
 *
 * Режим (3.2) решает, кого вообще спрашивать:
 *
 * | режим   | A+ | A  | B  |
 * |---------|----|----|----|
 * | context | да | да | нет |
 * | marker  | нет | нет | да |
 * | auto    | да | да | да |
 *
 * `context` — лучшая находка из текста поста: A+, если тег есть, иначе проза.
 * Проза при найденном теге не читается вовсе — у одного ответа одно время, и
 * брать его надо у самого надёжного, а не склеивать дату из тега с часами из
 * прозы. `marker` — события времени из метки, как их разобрал `parse-marker`.
 * `best` — первое по очереди из того, что есть.
 *
 * Правило «подстраховка вступает, только когда A промолчал» остаётся у движка:
 * «промолчал» — это не «нет находки», а «находка не назвала ни дня, ни часов»
 * (часть суток словом календарь не двигает), и решать это здесь значило бы
 * тащить сюда семантику `setAbsolute`.
 *
 * @param {string} text  сырой ответ модели, вместе с меткой и комментариями
 * @param {Object} [opts]
 * @param {'auto'|'context'|'marker'} [opts.mode='auto']
 * @param {Object}  [opts.state]  состояние: из него год календаря и эпоха анкеты
 * @param {boolean} [opts.relative=false] относительные сдвиги словами (A)
 * @param {Array}   [opts.markerEvents] события `kind: 'time'` из `parseMarker`
 * @returns {{context: ?Object, marker: ?Object, best: ?Object, candidates: Object[]}}
 *   Каждая находка несёт `source` ('A+' | 'A' | 'B'), `priority` и `via` —
 *   что именно сработало: имя тега, шаг разбора прозы или `marker`.
 */
export function readTime(text, opts = {}) {
  const mode = ['auto', 'context', 'marker'].includes(opts.mode) ? opts.mode : 'auto';
  const src = typeof text === 'string' ? text : '';
  const state = opts.state || null;
  const year = calendarYear(state);
  const refYear = referenceYear(state);
  const candidates = [];

  let context = null;
  if (mode !== 'marker') {
    // Своя метка снимается до всего: это не чужой тег, и `ACADEMY` в
    // белом списке нет, но и путать её ни с чем не нужно.
    const body = stripMarker(src);
    const tag = readMachineTags(body, { year, refYear });
    if (tag) {
      context = rollYear(tag, state);
      candidates.push(context);
    } else {
      const hit = parseContext(body, { relative: Boolean(opts.relative), year, refYear });
      if (hit) {
        // `source` у `parseContext` — шаг разбора (header, line, edge…). Он
        // уезжает в `via`, а `source` становится именем источника, как у всех.
        context = { ...rollYear(hit, state), source: 'A', via: hit.source, priority: PRIORITY.A };
        candidates.push(context);
      }
    }
  }

  let marker = null;
  const events = Array.isArray(opts.markerEvents) ? opts.markerEvents.filter((e) => e && e.kind === 'time') : [];
  if (mode !== 'context' && events.length) {
    marker = { source: 'B', via: 'marker', priority: PRIORITY.B, events };
    candidates.push(marker);
  }

  candidates.sort((a, b) => b.priority - a.priority);
  return { context, marker, best: candidates[0] || null, candidates };
}

// --- мелочи -------------------------------------------------------------------

function validDate(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(2000, m - 1, d));
  // Год проверяется отдельно от дня: `Date.UTC` с годом 0..99 уезжает в 1900-е,
  // а високосность надо спрашивать у настоящего года.
  if (dt.getUTCMonth() !== m - 1) return false;
  if (m === 2 && d === 29) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return true;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function numOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

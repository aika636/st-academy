const THINK = /<(think|thinking|reasoning|CoD)\b[^>]*>[\s\S]*?<\/\1>/gi;

const TAG = /<\/?[a-zA-Z][^<>\n]{0,400}>/g;
const ENTITY = /&(?:nbsp|amp|lt|gt|quot|#\d{1,5}|[a-zA-Z]{2,8});/g;
const COMMENT = /<!--[\s\S]*?-->/g;

export function dropThinking(mes) {
  if (typeof mes !== 'string' || !mes) return '';
  return mes.replace(THINK, ' ');
}

export function cleanForScan(mes) {
  if (typeof mes !== 'string' || !mes) return '';
  return mes
    .replace(THINK, ' ')
    .replace(COMMENT, ' ')
    .replace(TAG, ' ')
    .replace(ENTITY, ' ')
    .replace(/[⠀ ️]/g, ' ')
    .replace(/[ \t]+/g, ' ');
}

const L = '\\p{L}\\p{M}';
const NOTL = `(?<![${L}])`;
const ENDL = `(?![${L}])`;

const MONTHS = [
  { n: 1, re: 'январ[ьяем]|янв' },
  { n: 2, re: 'феврал[ьяем]|фев' },
  { n: 3, re: 'март[аеу]|март|мар' },
  { n: 4, re: 'апрел[ьяем]|апр' },
  { n: 5, re: 'ма[йяею]' },
  { n: 6, re: 'июн[ьяем]|июн' },
  { n: 7, re: 'июл[ьяем]|июл' },
  { n: 8, re: 'август[аеу]|август|авг' },
  { n: 9, re: 'сентябр[ьяем]|сент|сен' },
  { n: 10, re: 'октябр[ьяем]|окт' },
  { n: 11, re: 'ноябр[ьяем]|ноя' },
  { n: 12, re: 'декабр[ьяем]|дек' },
  { n: 1, re: 'january|jan' },
  { n: 2, re: 'february|feb' },
  { n: 3, re: 'march|mar' },
  { n: 4, re: 'april|apr' },
  { n: 5, re: 'may' },
  { n: 6, re: 'june|jun' },
  { n: 7, re: 'july|jul' },
  { n: 8, re: 'august|aug' },
  { n: 9, re: 'september|sept|sep' },
  { n: 10, re: 'october|oct' },
  { n: 11, re: 'november|nov' },
  { n: 12, re: 'december|dec' },
];

const MONTH_ALT = MONTHS.map((m) => m.re).join('|');

function monthNumber(word) {
  const w = word.toLowerCase().replace(/\.$/, '');
  for (const m of MONTHS) if (new RegExp(`^(?:${m.re})$`, 'iu').test(w)) return m.n;
  return null;
}

const WDAY_WORDS = [
  { n: 1, re: 'понедельник[аму]?|monday' },
  { n: 2, re: 'вторник[аму]?|tuesday' },
  { n: 3, re: 'сред[аыеу]|wednesday' },
  { n: 4, re: 'четверг[аому]?|thursday' },
  { n: 5, re: 'пятниц[аыеу]|friday' },
  { n: 6, re: 'суббот[аыеу]|saturday' },
  { n: 7, re: 'воскресень[еяю]|sunday' },
];
const WDAY_WORD_RE = new RegExp(
  `${NOTL}(${WDAY_WORDS.map((w) => w.re).join('|')})${ENDL}`, 'iu',
);

const WDAY_ABBR = [
  { n: 1, w: ['пн', 'mon'] }, { n: 2, w: ['вт', 'tue', 'tues'] },
  { n: 3, w: ['ср', 'wed'] }, { n: 4, w: ['чт', 'thu', 'thur', 'thurs'] },
  { n: 5, w: ['пт', 'fri'] }, { n: 6, w: ['сб', 'sat'] },
  { n: 7, w: ['вс', 'sun'] },
];
const WDAY_ABBR_RE = new RegExp(
  `${NOTL}(${WDAY_ABBR.flatMap((w) => w.w).join('|')})\\.?\\s*,?\\s+(?=\\d)`, 'iu',
);
const WDAY_ABBR_AFTER_RE = new RegExp(
  `[,|(\\[]\\s*(${WDAY_ABBR.flatMap((w) => w.w).join('|')})\\.?\\s*(?=[\\]\\)|,]|$)`, 'iu',
);

const DAYPARTS = [
  { part: 'night', re: `ноч[ьиью]${ENDL}|ночью|полночь|midnight|night${ENDL}|nightfall` },
  { part: 'morning', re: `утр[оаеуы]${ENDL}|утром|рассвет[аеуы]?${ENDL}|morning|dawn` },
  { part: 'day', re: `днём|днем|полдень|afternoon|noon${ENDL}|midday` },
  { part: 'evening', re: `вечер[аеуом]*${ENDL}|сумерк[аиеу]${ENDL}|закат[аеуы]?${ENDL}|evening|dusk` },
];
const DAYPART_RE = new RegExp(
  `${NOTL}(?:${DAYPARTS.map((d) => `(?<${d.part}>${d.re})`).join('|')})`, 'iu',
);

const EMOJI_RE = /[\u{1F4C5}\u{1F4C6}\u{1F5D3}\u{1F550}-\u{1F55B}\u{1F570}\u{23F0}\u{231A}\u{23F3}]/u;

const LABEL_RE = new RegExp(
  `${NOTL}(?:врем[${L}]{0,3}|time|дата|date|день недели|weekday|timezone)\\s*[:：]`, 'iu',
);

const CLOCK_RE = new RegExp(`(?<![\\d${L}.:])([01]?\\d|2[0-3]):([0-5]\\d)(?!\\d|:\\d|\\.\\d)`, 'u');
const AMPM_RE = /(?<![\d:.])(\d{1,2})(?::([0-5]\d))?\s?([ap])\.?\s?m\.?(?![a-z])/i;

const DATE_YMD_RE = /(?<![\d.,:/-])(\d{4})([./-])(0?[1-9]|1[0-2])\2(0?[1-9]|[12]\d|3[01])(?![\d./-])/;
const DATE_NUM_RE = /(?<![\d.,:/])(0?[1-9]|[12]\d|3[01])[./](0?[1-9]|1[0-2])[./](\d{4}|\d{3}|\d{2})(?![\d.])/;
const DATE_SHORT_RE = /(?<![\d.,:/])(0?[1-9]|[12]\d|3[01])\.(0?[1-9]|1[0-2])(?![\d./])/;
const DATE_DMY_RE = new RegExp(
  `${NOTL}(\\d{1,2})\\s+(${MONTH_ALT})\\.?${ENDL}(?:\\s*,?\\s*(\\d{4}))?`, 'iu',
);
const DATE_MDY_RE = new RegExp(
  `${NOTL}(${MONTH_ALT})\\.?${ENDL}\\s+(\\d{1,2})(?:\\s*,?\\s*(\\d{4}))?`, 'iu',
);

const DAYNUM_RE = new RegExp(`${NOTL}(?:день|day|сутки)\\s*[№#]?\\s*(\\d{1,3})(?![\\d:.])`, 'iu');

const NUMWORDS = new Map(Object.entries({
  'один': 1, 'одну': 1, 'одного': 1, 'два': 2, 'две': 2, 'двух': 2, 'пару': 2,
  'три': 3, 'трёх': 3, 'трех': 3, 'четыре': 4, 'пять': 5, 'шесть': 6,
  'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10, 'несколько': 2, 'нескольких': 2,
}));

const REL_UNITS = [
  { unit: 'minute', re: 'минут[уыа]?|минуток' },
  { unit: 'hour', re: 'час[аов]?|часок' },
  { unit: 'day', re: 'дня|дней|день|сутки|суток' },
  { unit: 'week', re: 'недел[юяьи]|недель' },
  { unit: 'month', re: 'месяц[аев]?' },
  { unit: 'year', re: 'год[аеу]?|лет' },
];
const REL_UNIT_ALT = REL_UNITS.map((u) => u.re).join('|');

const RELATIVE = [
  {
    re: new RegExp(
      `${NOTL}(?:через|спустя|прошл[оаи])\\s+(?:(\\d{1,3}|[${L}]+)\\s+)?(${REL_UNIT_ALT})${ENDL}`, 'iu',
    ),
    take: (m) => ({ unit: relUnit(m[2]), n: relCount(m[1]) }),
  },
  {
    re: new RegExp(
      `${NOTL}(?:наутро|назавтра|на следующ[${L}]+\\s+(?:утро|день|вечер|ночь)|next\\s+(?:morning|day)|later\\s+that\\s+(?:day|evening|night))${ENDL}`, 'iu',
    ),
    take: () => ({ unit: 'day', n: 1 }),
  },
  { re: new RegExp(`${NOTL}(?:на следующ[${L}]+\\s+недел[${L}]+|next\\s+week)${ENDL}`, 'iu'), take: () => ({ unit: 'week', n: 1 }) },
  {
    re: new RegExp(`${NOTL}(?:после\\s+(?:пар|уроков|занятий|лекций)|after\\s+(?:school|class(?:es)?|lessons?))${ENDL}`, 'iu'),
    take: () => ({ unit: 'period', n: 1 }),
  },
];

function relUnit(word) {
  const w = word.toLowerCase();
  for (const u of REL_UNITS) if (new RegExp(`^(?:${u.re})$`, 'iu').test(w)) return u.unit;
  return null;
}

function relCount(word) {
  if (!word) return 1;
  if (/^\d+$/.test(word)) return Number(word);
  return NUMWORDS.get(word.toLowerCase()) ?? 1;
}

export function resolveTwoDigitYear(yy, ref) {
  if (!Number.isFinite(ref)) return { year: 2000 + yy, guessed: true };
  const base = Math.floor(ref / 100) * 100;
  let best = null;
  for (const c of [base - 100 + yy, base + yy, base + 100 + yy]) {
    if (c < 0) continue;
    if (best === null || Math.abs(c - ref) < Math.abs(best - ref)) best = c;
  }
  return { year: best, guessed: false };
}

export function parseContext(text, opts = {}) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const clean = opts.clean === false ? text : cleanForScan(text);
  const refRaw = opts.refYear !== undefined ? opts.refYear : opts.year;
  const ref = typeof refRaw === 'number' && Number.isFinite(refRaw) ? refRaw : undefined;
  const lines = clean.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return null;

  const isEdge = (i) => i < 3 || i >= lines.length - 3;

  for (let i = 0; i < Math.min(3, lines.length); i++) {
    if (!isHeader(lines[i])) continue;
    const r = scanLine(lines[i], true, ref);
    if (r) return build(r, 'header', 0.9, lines[i], opts);
  }

  for (const line of lines) {
    const r = scanLine(line, false, ref);
    if (r && r.date && r.time) return build(r, 'line', 0.8, line, opts);
  }

  for (let i = 3; i < lines.length; i++) {
    if (!isHeader(lines[i])) continue;
    const r = scanLine(lines[i], true, ref);
    if (r && (r.date || r.time || r.dayIndex !== null)) return build(r, 'label', 0.7, lines[i], opts);
  }

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 80 || !isEdge(i)) continue;
    const r = scanLine(lines[i], false, ref);
    if (r && (r.time || r.date)) return build(r, 'edge', 0.5, lines[i], opts);
  }

  for (const line of lines) {
    const m = line.match(DAYPART_RE);
    if (!m) continue;
    return {
      day: null, time: null, daypart: daypartOf(m), weekday: null,
      confidence: 0.3, source: 'daypart', matched: m[0], dateParts: null,
    };
  }

  if (opts.relative) {
    for (const line of lines) {
      for (const rule of RELATIVE) {
        const m = line.match(rule.re);
        if (!m) continue;
        const rel = rule.take(m);
        if (!rel.unit) continue;
        return {
          day: null, time: null, daypart: null, weekday: null,
          confidence: 0.2, source: 'relative', matched: m[0], dateParts: null,
          relative: rel,
        };
      }
    }
  }

  return null;
}

function isHeader(line) {
  return EMOJI_RE.test(line) || LABEL_RE.test(line);
}

function scanLine(line, loose, ref) {
  const time = scanTime(line);
  const date = scanDate(line, loose, ref);
  const dp = line.match(DAYPART_RE);
  const dayIndex = loose ? scanDayIndex(line) : null;
  const weekday = scanWeekday(line, Boolean(date));

  if (!time && !date && !dp && dayIndex === null && weekday === null) return null;
  return { time, date, daypart: dp ? daypartOf(dp) : null, weekday, dayIndex };
}

function scanTime(line) {
  const m = line.match(CLOCK_RE);
  if (m) {
    let h = Number(m[1]);
    const tail = line.slice(m.index + m[0].length, m.index + m[0].length + 5);
    const ap = tail.match(/^\s?([ap])\.?\s?m\.?/i);
    if (ap) h = to24(h, ap[1]);
    return hhmm(h, Number(m[2]));
  }
  const a = line.match(AMPM_RE);
  if (a) return hhmm(to24(Number(a[1]), a[3]), a[2] ? Number(a[2]) : 0);
  return null;
}

function to24(h, ap) {
  const pm = ap.toLowerCase() === 'p';
  if (pm) return h === 12 ? 12 : h + 12;
  return h === 12 ? 0 : h;
}

function hhmm(h, m) {
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function scanDate(line, loose, ref) {
  let m = line.match(DATE_YMD_RE);
  if (m) return { year: Number(m[1]), month: Number(m[3]), day: Number(m[4]) };
  m = line.match(DATE_NUM_RE);
  if (m && m[3].length === 3 && !loose) m = null;
  if (m) {
    if (m[3].length === 2) {
      const y = resolveTwoDigitYear(Number(m[3]), ref);
      return { year: y.year, month: Number(m[2]), day: Number(m[1]), guessed: y.guessed };
    }
    return { year: Number(m[3]), month: Number(m[2]), day: Number(m[1]) };
  }
  m = line.match(DATE_DMY_RE);
  if (m) {
    const mon = monthNumber(m[2]);
    if (mon) return { year: m[3] ? Number(m[3]) : null, month: mon, day: Number(m[1]) };
  }
  m = line.match(DATE_MDY_RE);
  if (m) {
    const mon = monthNumber(m[1]);
    if (mon) return { year: m[3] ? Number(m[3]) : null, month: mon, day: Number(m[2]) };
  }
  if (loose) {
    m = line.match(DATE_SHORT_RE);
    if (m) return { year: null, month: Number(m[2]), day: Number(m[1]) };
  }
  return null;
}

function scanWeekday(line, hasDate) {
  const w = line.match(WDAY_WORD_RE);
  if (w) {
    const key = w[1].toLowerCase();
    for (const d of WDAY_WORDS) if (new RegExp(`^(?:${d.re})$`, 'iu').test(key)) return d.n;
  }
  if (!hasDate) return null;
  const a = line.match(WDAY_ABBR_RE);
  if (a) {
    const key = a[1].toLowerCase();
    for (const d of WDAY_ABBR) if (d.w.includes(key)) return d.n;
  }
  const b = line.match(WDAY_ABBR_AFTER_RE);
  if (b) {
    const key = b[1].toLowerCase();
    for (const d of WDAY_ABBR) if (d.w.includes(key)) return d.n;
  }
  return null;
}

function scanDayIndex(line) {
  const m = line.match(DAYNUM_RE);
  return m ? Number(m[1]) : null;
}

function daypartOf(m) {
  if (!m.groups) return null;
  for (const [name, val] of Object.entries(m.groups)) if (val !== undefined) return name;
  return null;
}

function build(r, source, confidence, matched, opts) {
  const parts = r.date
    ? { year: r.date.year ?? (typeof opts.year === 'number' ? opts.year : null), month: r.date.month, day: r.date.day }
    : null;

  const out = {
    day: parts && parts.year !== null ? iso(parts) : null,
    time: r.time || null,
    daypart: r.daypart || null,
    weekday: r.weekday,
    confidence,
    source,
    matched,
    dateParts: parts,
    yearFromText: Boolean(r.date && r.date.year !== null && r.date.year !== undefined && !r.date.guessed),
  };
  if (r.dayIndex !== null && r.dayIndex !== undefined) out.dayIndex = r.dayIndex;
  return out;
}

function iso({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

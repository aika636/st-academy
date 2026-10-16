import { parseContext, dropThinking, resolveTwoDigitYear } from './parse-context.mjs';
import { stripMarker } from './parse-marker.mjs';

export const PRIORITY = Object.freeze({ 'A+': 30, A: 20, B: 10 });

const Y = '(\\d{4}|\\d{2})';
const D = '(\\d{1,2})';
const HM = '(\\d{1,2}):(\\d{2})';

export const TAGS = [
  {
    id: 'tel:time',
    re: new RegExp(`<!--\\s*tel:time:\\s*${HM}\\s+${D}\\.${D}\\.${Y}\\s*-->`, 'gi'),
    take: (m) => ({ h: m[1], mi: m[2], d: m[3], mo: m[4], y: m[5] }),
  },
  {
    id: 'RP_DATE',
    re: new RegExp(`<!--\\s*\\[\\s*RP_DATE\\s*:\\s*${D}\\.${D}\\.${Y}(?:\\s*,?\\s+${HM})?\\s*\\]\\s*-->`, 'gi'),
    take: (m) => ({ d: m[1], mo: m[2], y: m[3], h: m[4], mi: m[5] }),
  },
  {
    id: 'diary',
    re: new RegExp(`<!--\\s*diary\\b[^\\d\\n-]{0,40}?${D}\\.${D}\\.${Y}(?:\\s*,?\\s*${HM})?`, 'gi'),
    take: (m) => ({ d: m[1], mo: m[2], y: m[3], h: m[4], mi: m[5] }),
  },
  {
    id: 'time-line',
    re: new RegExp(`(?:^|[\\n>])[ \\t]*time[ \\t]*[:：][ \\t]*(\\d{4})([/.-])${D}\\2${D}(?:[ \\t]*\\([^)\\n]{0,16}\\))?(?:[ \\t]+${HM})?(?![\\d:])`, 'gi'),
    take: (m) => ({ y: m[1], mo: m[3], d: m[4], h: m[5], mi: m[6] }),
  },
];

const FOOTER_TIME_RE = /(?:^|\n)[ \t]*time[ \t]*[:：][ \t]*\[[ \t]*(\d{1,2}:\d{2}(?:[ \t]?[ap]\.?[ \t]?m\.?)?)[ \t]*\]/gi;
const FOOTER_DATE_RE = /^[ \t]*date[ \t]*[:：][ \t]*\[([^\]\n]{1,40})\]/i;

export function readMachineTags(text, opts = {}) {
  const raw = dropThinking(typeof text === 'string' ? text : '');
  if (!raw) return null;
  const ref = numOr(opts.refYear, numOr(opts.year, undefined));

  for (let rank = 0; rank < TAGS.length; rank++) {
    const rule = TAGS[rank];
    const all = [...raw.matchAll(rule.re)];
    for (let i = all.length - 1; i >= 0; i--) {
      const hit = fromParts(rule.take(all[i]), ref);
      if (!hit) continue;
      return finding(hit, rule.id, all[i][0].trim(), rank);
    }
  }

  const lines = readTimeDateLines(raw, opts, ref);
  if (lines) return finding(lines, 'date-time-lines', lines.matched, TAGS.length);
  return null;
}

function readTimeDateLines(raw, opts, ref) {
  const text = raw.replace(/\r/g, '');
  const lines = text.split('\n');
  const all = [...text.matchAll(FOOTER_TIME_RE)];
  for (let i = all.length - 1; i >= 0; i--) {
    const m = all[i];
    const start = m.index + (m[0].startsWith('\n') ? 1 : 0);
    const lineNo = text.slice(0, start).split('\n').length - 1;
    const near = [lines[lineNo + 1], lines[lineNo - 1]].filter((l) => typeof l === 'string');
    const dateLine = near.map((l) => l.match(FOOTER_DATE_RE)).find(Boolean);
    if (!dateLine) continue;
    const glued = `Date: ${dateLine[1]} | Time: ${m[1]}`;
    const hit = parseContext(glued, { clean: false, year: opts.year, refYear: ref });
    if (!hit || !hit.day || !hit.time) continue;
    return { ...hit, matched: `${m[0].trim()} / ${dateLine[0].trim()}` };
  }
  return null;
}

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
    priority: PRIORITY['A+'] + (TAGS.length - rank),
    confidence: 1,
  };
}

export function calendarYear(state) {
  const day = state && state.calendar && state.calendar.day;
  const year = typeof day === 'string' ? Number(day.slice(0, 4)) : NaN;
  return Number.isFinite(year) ? year : undefined;
}

export function eraYear(era) {
  if (typeof era !== 'string') return undefined;
  const m = era.match(/(?<!\d)(\d{4})(?!\d)/);
  return m ? Number(m[1]) : undefined;
}

export function surveyYear(survey) {
  return eraYear(survey && survey.era) ?? eraYear(survey && survey.canon);
}

export function referenceYear(state) {
  const cal = calendarYear(state);
  if (cal !== undefined) return cal;
  return eraYear(state && state.survey && state.survey.era);
}

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

export function readTime(text, opts = {}) {
  const mode = ['auto', 'context', 'marker'].includes(opts.mode) ? opts.mode : 'auto';
  const src = typeof text === 'string' ? text : '';
  const state = opts.state || null;
  const year = calendarYear(state);
  const refYear = referenceYear(state);
  const candidates = [];

  let context = null;
  if (mode !== 'marker') {
    const body = stripMarker(src);
    const tag = readMachineTags(body, { year, refYear });
    if (tag) {
      context = rollYear(tag, state);
      candidates.push(context);
    } else {
      const hit = parseContext(body, { relative: Boolean(opts.relative), year, refYear });
      if (hit) {
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

function validDate(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(2000, m - 1, d));
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

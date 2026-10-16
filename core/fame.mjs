import { cloneState, findSubject } from './state.mjs';
import { resolveGrade, addGrade } from './gradebook.mjs';
import { shiftFame, unshiftFame } from './reputation.mjs';
import { seededRng } from './exams.mjs';

export const BG_EVERY = 3;

const ODDS = {
  normal: { best: 5, good: 20, low: 55, weak: 15, worst: 5 },
  strong: { best: 5, good: 30, low: 55, weak: 5, worst: 5 },
  hard: { best: 5, good: 10, low: 55, weak: 25, worst: 5 },
};

const FAME = { best: 2, good: 1, low: 0, weak: -1, worst: -3 };

const FAME_NO_POINTS_FAIL = -2;

export function gradeTiers(preset) {
  const seen = new Set();
  const list = ((preset && preset.grades && preset.grades.values) || [])
    .filter((g) => g && typeof g.points === 'number')
    .sort((a, b) => b.points - a.points)
    .filter((g) => !seen.has(g.points) && seen.add(g.points));
  const pass = list.filter((g) => g.pass);
  const fail = list.filter((g) => !g.pass);
  return {
    best: pass[0] || null,
    good: pass[1] || null,
    low: pass.length ? pass[pass.length - 1] : null,
    weak: fail[0] || null,
    worst: fail.length ? fail[fail.length - 1] : null,
    list,
  };
}

export function fameOfGrade(preset, value) {
  const spec = resolveGrade(preset, value);
  if (!spec) return 0;
  if (typeof spec.points !== 'number') return spec.pass ? 0 : FAME_NO_POINTS_FAIL;
  const t = gradeTiers(preset);
  const at = (tier) => t[tier] && t[tier].points === spec.points;
  if (at('best')) return FAME.best;
  if (at('good')) return FAME.good;
  if (at('low')) return FAME.low;
  if (at('worst')) return FAME.worst;
  if (at('weak')) return FAME.weak;
  return spec.pass ? 0 : FAME.weak;
}

export function notableGrade(preset, value) {
  const spec = resolveGrade(preset, value);
  if (!spec) return null;
  if (typeof spec.points !== 'number') return spec.pass ? null : 'worst';
  const t = gradeTiers(preset);
  if (t.worst && spec.points === t.worst.points) return 'worst';
  if (t.best && spec.points === t.best.points && t.list.length > 1) return 'best';
  return null;
}

export function backgroundOdds(preset, profile = null) {
  const t = gradeTiers(preset);
  const odds = ODDS[profile] || ODDS.normal;
  if (!t.low) return [];
  const pick = {
    best: t.best, good: t.good || t.best, low: t.low, weak: t.weak || t.low, worst: t.worst || t.weak || t.low,
  };
  const sum = new Map();
  for (const tier of ['best', 'good', 'low', 'weak', 'worst']) {
    const g = pick[tier];
    sum.set(g.value, (sum.get(g.value) || 0) + odds[tier]);
  }
  return [...sum].map(([value, p]) => ({ value, p }));
}

function lastPair(state, subjectId) {
  const records = (state.attendance && state.attendance.records) || [];
  for (let i = records.length - 1; i >= 0; i -= 1) {
    if (records[i].subjectId === subjectId) return records[i].periodIndex == null ? 0 : records[i].periodIndex;
  }
  return 0;
}

export function rollBackground(state, subject, preset, day = state.calendar.day) {
  const odds = backgroundOdds(preset, subject.profile);
  const r = seededRng(`bg|${subject.id}|${day}|${lastPair(state, subject.id)}`)() * 100;
  let acc = 0;
  for (const o of odds) {
    acc += o.p;
    if (r < acc) return o.value;
  }
  return odds.length ? odds[odds.length - 1].value : null;
}

export function gradeFame(state, subjectId, value, preset, { bg = false } = {}) {
  const base = fameOfGrade(preset, value);
  if (!base) return state;
  const res = shiftFame(state, { delta: bg ? base / 2 : base, kind: 'grade', reason: bg ? 'grade-bg' : 'grade' }, preset);
  if (bg && res.applied) {
    const subject = findSubject(res.state, subjectId);
    const rec = subject && subject.grades[subject.grades.length - 1];
    if (rec && rec.bg) rec.fame = res.applied;
  }
  return res.state;
}

export function settleBackground(state, preset) {
  let s = state;
  const out = [];
  if (s.exams && s.exams.active) {
    if (!s.subjects.some((x) => x.bg)) return { state: s, grades: out };
    s = cloneState(s);
    for (const x of s.subjects) delete x.bg;
    return { state: s, grades: out };
  }
  const day = s.calendar.day;
  for (const id of s.subjects.map((x) => x.id)) {
    const subject = findSubject(s, id);
    if ((subject.bg || 0) < BG_EVERY) continue;
    if (subject.grades.some((g) => g.bg && g.day === day)) continue;
    const value = rollBackground(s, subject, preset, day);
    if (!value) continue;
    const res = addGrade(s, { subjectId: id, value, day, bg: true }, preset);
    if (!res.applied) continue;
    s = gradeFame(res.state, id, value, preset, { bg: true });
    out.push({ subjectId: id, value });
  }
  return { state: s, grades: out };
}

export function dropBackground(state, subjectId, day, preset) {
  const probe = findSubject(state, subjectId);
  if (!probe || !probe.grades.some((g) => g.bg && g.day === day)) return state;
  let s = cloneState(state);
  const subject = findSubject(s, subjectId);
  const at = subject.grades.findIndex((g) => g.bg && g.day === day);
  const [gone] = subject.grades.splice(at, 1);
  if (gone.fame) s = unshiftFame(s, gone.fame, day, preset);
  return s;
}

export function applyEventFame(state, items, preset, { loud = null, isPrivate = null } = {}) {
  const fame = (items || []).find((x) => x && x.ev && x.ev.kind === 'fame');
  if (!fame) return state;
  const size = Number.isInteger(loud) ? Math.max(0, Math.min(3, loud)) : 0;
  if (!size) return state;
  const mine = (items || []).filter((x) => x && x.ev && x.ev.kind === 'act' && (x.ev.a === '@heroine' || x.ev.b === '@heroine'));
  const closed = (x) => x.ev.access === 'наедине' || Boolean(isPrivate && isPrivate(x));
  if (mine.length && mine.every(closed)) return state;
  const sign = fame.ev.sign < 0 ? -1 : 1;
  return shiftFame(state, { delta: sign * size, kind: 'event', reason: 'fame', why: fame.ev.why || '' }, preset).state;
}

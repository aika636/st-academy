import { cloneState, findSubject, pushJournal, isDay } from './state.mjs';
import { termAt } from './time.mjs';

export const REJECT_UNKNOWN_SUBJECT = 'unknown-subject';
export const REJECT_UNKNOWN_VALUE = 'unknown-value';

export const DEBT_GRADE = 'grade';
export const DEBT_SKIPS = 'skips';
export const DEBT_EXAM = 'exam';
export const DEBT_MISSED = 'missed';
export const DEBT_RETAKE = 'retake';

export function resolveGrade(preset, raw) {
  const scale = (preset && preset.grades && preset.grades.values) || [];
  const aliases = (preset && preset.grades && preset.grades.aliases) || {};
  const key = String(raw == null ? '' : raw).trim();
  if (!key) return null;

  const exact = scale.find((g) => g.value === key);
  if (exact) return exact;

  const lower = key.toLowerCase();
  const aliased = aliases[key] != null ? aliases[key] : aliases[lower];
  if (aliased != null) return scale.find((g) => g.value === aliased) || null;

  return scale.find((g) => String(g.value).toLowerCase() === lower) || null;
}

export function pointsOf(preset, value) {
  const spec = resolveGrade(preset, value);
  return spec && typeof spec.points === 'number' ? spec.points : null;
}

export function addGrade(state, ev, preset) {
  const next = cloneState(state);
  const subjectId = ev && ev.subjectId;
  const subject = findSubject(next, subjectId);

  if (!subject) {
    pushJournal(next, {
      kind: 'grade',
      text: `grade rejected [${REJECT_UNKNOWN_SUBJECT}] ${subjectId}=${ev && ev.value}`,
      data: { subjectId, value: ev && ev.value, reason: REJECT_UNKNOWN_SUBJECT },
    }, preset);
    return { state: next, applied: false, reason: REJECT_UNKNOWN_SUBJECT };
  }

  const spec = resolveGrade(preset, ev.value);
  if (!spec) {
    pushJournal(next, {
      kind: 'grade',
      text: `grade rejected [${REJECT_UNKNOWN_VALUE}] ${subjectId}=${ev.value}`,
      data: { subjectId, value: ev.value, reason: REJECT_UNKNOWN_VALUE },
    }, preset);
    return { state: next, applied: false, reason: REJECT_UNKNOWN_VALUE };
  }

  const day = String(ev.day || (next.calendar && next.calendar.day) || '');
  subject.grades.push({ value: spec.value, day, ...(ev.bg ? { bg: true } : {}) });
  delete subject.bg;

  if (!ev.bg) stampDebt(subject, spec.pass ? null : DEBT_GRADE);

  pushJournal(next, {
    kind: 'grade',
    text: `grade ${subject.id}=${spec.value}`,
    data: { subjectId: subject.id, value: spec.value, points: spec.points, ...(ev.bg ? { bg: true } : {}) },
  }, preset);

  return { state: next, applied: true, reason: null };
}

export function gradesInTerm(state, grades, preset, term) {
  if (!Number.isFinite(term)) return grades;
  const today = state && state.calendar && state.calendar.day;
  const now = termAt(preset, state, today);
  const current = now.index >= 0 ? now.serial : term;
  return (grades || []).filter((g) => {
    if (!isDay(g && g.day)) return term === current;
    const at = termAt(preset, state, g.day);
    return at.index < 0 || at.serial === term;
  });
}

export function subjectScore(state, subjectId, preset, opts = {}) {
  const subject = findSubject(state, subjectId);
  if (!subject) return { average: null, grades: [], passed: false, debt: false };

  const grades = gradesInTerm(state, subject.grades || [], preset, opts.term);
  const points = grades.map((g) => pointsOf(preset, g.value)).filter((p) => p !== null);
  const debt = Boolean(subject.debt);
  const passed = !debt && grades.some((g) => {
    const spec = resolveGrade(preset, g.value);
    return Boolean(spec && spec.pass);
  });

  return { average: mean(points), grades, passed, debt };
}

export function overallScore(state, preset) {
  const points = [];
  for (const s of state.subjects || []) {
    for (const g of s.grades || []) {
      const p = pointsOf(preset, g.value);
      if (p !== null) points.push(p);
    }
  }
  return mean(points);
}

export function debts(state) {
  return (state.subjects || []).filter((s) => Boolean(s.debt));
}

export function setDebt(state, subjectId, value, preset, reason = null) {
  const next = cloneState(state);
  const subject = findSubject(next, subjectId);
  if (!subject) return next;

  const flag = Boolean(value);
  const skips = !reason || reason === DEBT_SKIPS;
  if (flag ? (skips ? subject.debtSkips : subject.debtReason === reason) : !subject.debt) return next;

  if (!flag) { delete subject.debtSkips; stampDebt(subject, null); } else if (skips) { subject.debtSkips = true; stampDebt(subject, subject.debtReason); } else stampDebt(subject, reason);
  pushJournal(next, {
    kind: 'grade',
    text: `debt ${subject.id}=${flag}`,
    data: { subjectId: subject.id, debt: flag, reason: flag ? reason : null },
  }, preset);
  return next;
}

export function closeSkipDebt(state, subjectId, preset) {
  const next = cloneState(state);
  const subject = findSubject(next, subjectId);
  if (!subject || !subject.debtSkips) return next;
  delete subject.debtSkips;
  stampDebt(subject, subject.debtReason);
  if (!subject.debt) {
    pushJournal(next, {
      kind: 'grade', text: `debt ${subject.id}=false`, data: { subjectId: subject.id, debt: false, reason: null },
    }, preset);
  }
  return next;
}

export function debtReasons(subject) {
  if (!subject || !subject.debt) return [];
  return [...(subject.debtSkips ? [DEBT_SKIPS] : []), ...(subject.debtReason ? [subject.debtReason] : [])];
}

export const debtMemo = (s) => ({ debt: Boolean(s.debt), debtReason: s.debtReason, debtSkips: s.debtSkips });
export function restoreDebt(subject, memo) {
  if (memo.debtReason) subject.debtReason = memo.debtReason; else delete subject.debtReason;
  if (memo.debtSkips ?? (memo.debt && !memo.debtReason)) subject.debtSkips = true; else delete subject.debtSkips;
  subject.debt = Boolean(subject.debtReason || subject.debtSkips);
}

export function stampDebt(subject, reason) {
  if (!subject) return subject;
  if (reason) subject.debtReason = String(reason);
  else delete subject.debtReason;
  subject.debt = Boolean(subject.debtReason || subject.debtSkips);
  return subject;
}

function mean(list) {
  if (!list.length) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

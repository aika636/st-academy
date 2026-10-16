import { findSubject, teacherOfSubject } from './state.mjs';
import { addDays, bellsOf, weekdayIn, isStudyDay, minutesOf, phaseOf, periodPosition } from './time.mjs';

const NEXT_LOOKAHEAD = 120;

export function buildSchedule(subjects, preset, opts = {}) {
  const ids = (subjects || []).map((s) => (typeof s === 'string' ? s : s && s.id)).filter(Boolean);
  const days = (opts.studyDays || (preset.week && preset.week.studyDays) || []).slice().sort((a, b) => a - b);
  const perDay = Math.max(0, Math.trunc(opts.periodsPerDay ?? (preset.week && preset.week.periodsPerDay) ?? 0));

  const out = {};
  if (!ids.length || !days.length || !perDay) {
    for (const d of days) out[String(d)] = [];
    return out;
  }

  let k = Math.trunc(opts.offset || 0);
  for (const d of days) {
    const row = [];
    for (let p = 0; p < perDay; p += 1) {
      row.push(ids[((k % ids.length) + ids.length) % ids.length]);
      k += 1;
    }
    out[String(d)] = row;
  }
  return out;
}

export function dayPlan(state, preset, day = state.calendar.day) {
  if (!isStudyDay(preset, day, state)) return [];
  if (phaseOf(preset, state, day) !== 'study') return [];

  const row = state.schedule ? state.schedule[String(weekdayIn(state, day))] : null;
  if (!Array.isArray(row) || !row.length) return [];

  const bells = bellsOf(preset);
  const perDay = preset.week && Number.isInteger(preset.week.periodsPerDay) ? preset.week.periodsPerDay : 0;
  const slots = bells.length || perDay || row.length;
  const out = [];
  for (let i = 0; i < Math.min(row.length, slots); i += 1) {
    const subjectId = row[i];
    if (!subjectId) continue;
    const subject = findSubject(state, subjectId);
    const teacher = teacherOfSubject(state, subjectId);
    out.push({
      index: i,
      subjectId,
      name: (subject && subject.name) || subjectId,
      teacherId: teacher ? teacher.id : (subject && subject.teacherId) || null,
      start: bells[i] ? bells[i].start : null,
      end: bells[i] ? bells[i].end : null,
    });
  }
  return out;
}

export function currentPeriod(state, preset) {
  const plan = dayPlan(state, preset);
  if (!plan.length) return null;

  const first = plan[0];
  const last = plan[plan.length - 1];

  if (state.calendar.precision === 'datetime') {
    const t = minutesOf(state.calendar.time);
    if (t === null) return null;
    for (const item of plan) {
      if (item.start === null || item.end === null) continue;
      if (t < minutesOf(item.start)) {
        return { index: item.index, subjectId: item.subjectId, status: item === first ? 'before' : 'break' };
      }
      if (t < minutesOf(item.end)) return { index: item.index, subjectId: item.subjectId, status: 'now' };
    }
    return { index: last.index, subjectId: last.subjectId, status: 'after' };
  }

  const idx = Number.isFinite(state.calendar.periodIndex) ? state.calendar.periodIndex : null;
  if (idx === null || idx < first.index) {
    return { index: first.index, subjectId: first.subjectId, status: 'before' };
  }
  const hit = plan.find((p) => p.index === idx);
  if (hit) return { index: hit.index, subjectId: hit.subjectId, status: 'now' };
  if (idx > last.index) return { index: last.index, subjectId: last.subjectId, status: 'after' };
  const upcoming = plan.find((p) => p.index > idx) || last;
  return { index: upcoming.index, subjectId: upcoming.subjectId, status: 'break' };
}

export function dayEndInfo(state, preset) {
  const none = { available: false, remaining: 0, endTime: null };
  const cal = state && state.calendar;
  if (!cal || cal.precision !== 'datetime') return none;
  const now = minutesOf(cal.time);
  if (now === null) return none;
  const plan = dayPlan(state, preset, cal.day).filter((p) => p.end !== null);
  if (!plan.length) return none;
  const last = plan[plan.length - 1];
  if (now >= minutesOf(last.end)) return none;
  const left = plan.filter((p) => minutesOf(p.end) > now);
  return { available: true, remaining: left.length, endTime: last.end };
}

export function nextPeriod(state, preset) {
  const today = dayPlan(state, preset);
  if (today.length) {
    const cur = currentPeriod(state, preset);
    if (cur && cur.status !== 'after') {
      const after = cur.status === 'now'
        ? today.find((p) => p.index > cur.index)
        : today.find((p) => p.index >= cur.index);
      if (after) return { day: state.calendar.day, index: after.index, subjectId: after.subjectId };
    }
  }

  for (let i = 1; i <= NEXT_LOOKAHEAD; i += 1) {
    const day = addDays(state.calendar.day, i);
    const plan = dayPlan(state, preset, day);
    if (plan.length) return { day, index: plan[0].index, subjectId: plan[0].subjectId };
  }
  return null;
}

export function weekGrid(state, preset) {
  const monday = addDays(state.calendar.day, 1 - weekdayIn(state, state.calendar.day));
  const out = {};
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(monday, i);
    out[String(i + 1)] = dayPlan(state, preset, day);
  }
  return out;
}

export function periodAt(state, preset, day, index) {
  return dayPlan(state, preset, day).find((p) => p.index === index) || null;
}

export { periodPosition };

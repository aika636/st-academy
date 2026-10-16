import { cloneState, findSubject, teacherOfSubject, pushJournal, isDay } from './state.mjs';
import { diffDays } from './time.mjs';

export const STATUSES = ['present', 'skip', 'late', 'excused'];

const noEffects = () => ({ relation: [], reputation: 0, debt: [] });

export function countsAttendance(state, day) {
  const start = state && state.calendar && state.calendar.termStart;
  if (!isDay(start) || !isDay(day)) return true;
  return day !== start;
}

export function mark(state, ev, preset, opts = {}) {
  const next = cloneState(state);
  const subjectId = ev && ev.subjectId;
  const status = ev && ev.status;

  if (!STATUSES.includes(status) || !findSubject(next, subjectId)) {
    pushJournal(next, {
      kind: 'attendance',
      text: `attendance rejected ${subjectId}=${status}`,
      data: { subjectId, status },
    }, preset);
    return { state: next, effects: noEffects() };
  }

  const day = String(ev.day || (next.calendar && next.calendar.day) || '');
  const periodIndex = ev.periodIndex == null ? null : Number(ev.periodIndex);

  const same = (r) => r.day === day && r.subjectId === subjectId && r.periodIndex === periodIndex;
  const at = next.attendance.records.findIndex(same);
  const was = at >= 0 ? next.attendance.records[at].status : null;
  const record = { day, subjectId, status, periodIndex };
  if (opts.montage) record.montage = true;
  const cost = status === 'skip' ? skipCost(preset) : 0;
  if (cost) record.cost = cost;
  if (at >= 0 && next.attendance.records[at].status === status) return { state: next, effects: noEffects() };
  if (at >= 0) next.attendance.records[at] = record;
  else next.attendance.records.push(record);

  if (opts.journal !== false) {
    pushJournal(next, {
      kind: 'attendance',
      text: `attendance ${subjectId}=${status}`,
      data: record,
    }, preset);
  }

  if ((status === 'present' || status === 'late') && was !== 'present' && was !== 'late') {
    const subject = findSubject(next, subjectId);
    subject.bg = (subject.bg || 0) + 1;
  }

  const effects = effectsFor(next, subjectId, status, preset, day);
  if (was && SEVERITY[status] > SEVERITY[was]) subtractMark(effects, effectsFor(next, subjectId, was, preset, day));
  return { state: next, effects };
}

const SEVERITY = { present: 0, excused: 0, late: 1, skip: 2 };

function subtractMark(effects, old) {
  effects.reputation -= old.reputation;
  for (const o of old.relation) {
    const same = effects.relation.find((r) => r.teacherId === o.teacherId);
    if (same) same.delta -= o.delta;
    else effects.relation.push({ ...o, delta: -o.delta });
  }
  effects.relation = effects.relation.filter((r) => r.delta !== 0);
}

function effectsFor(state, subjectId, status, preset, day) {
  const out = noEffects();
  const att = (preset && preset.attendance) || {};
  const rep = (preset && preset.reputation && preset.reputation.delta) || {};

  const relDelta = (att.relationDelta || {})[status];
  const teacher = teacherOfSubject(state, subjectId);
  if (teacher && typeof relDelta === 'number' && relDelta !== 0) {
    out.relation.push({ teacherId: teacher.id, delta: relDelta, reason: { kind: status, subjectId, day } });
  }

  if (typeof rep[status] === 'number') out.reputation += rep[status];

  const subject = findSubject(state, subjectId);
  const threshold = att.debtAfterSkips;
  if (subject && !subject.debtSkips && typeof threshold === 'number') {
    if (effectiveSkips(state, subjectId, preset) >= threshold) out.debt.push(subjectId);
  }

  return out;
}

export function effectiveSkips(state, subjectId, preset) {
  const s = stats(state, subjectId);
  const open = s.skips - s.worked;
  const per = preset && preset.attendance && preset.attendance.lateEqualsSkip;
  if (typeof per !== 'number' || per <= 0) return open;
  return open + Math.floor(s.lates / per);
}

function skipCost(preset) {
  const v = preset && preset.reputation && preset.reputation.delta && preset.reputation.delta.skip;
  return typeof v === 'number' && v < 0 ? -v : 0;
}

export function workOff(state, ev, preset) {
  const next = cloneState(state);
  const subjectId = (ev && ev.subjectId) || null;
  const today = String((ev && ev.day) || (next.calendar && next.calendar.day) || '');
  const open = (next.attendance.records || [])
    .filter((r) => r.status === 'skip' && !r.workedOff && (!subjectId || r.subjectId === subjectId))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : (a.periodIndex || 0) - (b.periodIndex || 0)));
  const record = open[0];
  if (!record) return { state: next, closed: null, effects: noEffects() };

  record.workedOff = today;
  const effects = noEffects();
  effects.reputation = typeof record.cost === 'number' ? record.cost : skipCost(preset);

  pushJournal(next, {
    kind: 'attendance',
    text: `attendance ${record.subjectId}: skip ${record.day} worked off`,
    data: { workedOff: true, subjectId: record.subjectId, skipDay: record.day, day: today },
  }, preset);
  return { state: next, closed: { ...record }, effects };
}

export function shouldInfer(fromDay, toDay, preset) {
  const horizon = preset && preset.attendance && preset.attendance.inferHorizonDays;
  if (typeof horizon !== 'number' || !Number.isFinite(horizon)) return true;
  if (!isDay(fromDay) || !isDay(toDay)) return true;
  return Math.abs(diffDays(fromDay, toDay)) <= horizon;
}

export function inferMissed(state, arg, preset, opts = {}) {
  const day = String((arg && arg.day) || '');
  const expected = (arg && arg.expected) || [];
  let acc = state;

  if (!countsAttendance(state, day)) {
    const next = cloneState(state);
    pushJournal(next, {
      kind: 'attendance',
      text: `attendance skipped: ${day} — сутки заведения семестра`,
      data: { day, reason: 'term-start' },
    }, preset);
    return { state: next, missed: [], effects: noEffects() };
  }

  const horizon = preset && preset.attendance && preset.attendance.inferHorizonDays;
  const today = state.calendar && state.calendar.day;
  if (typeof horizon === 'number' && Number.isFinite(horizon) && isDay(day) && isDay(today)) {
    const gap = Math.abs(diffDays(day, today));
    if (gap > horizon) {
      const next = cloneState(state);
      pushJournal(next, {
        kind: 'attendance',
        text: `attendance skipped: ${day} дальше горизонта (${gap} дн. > ${horizon})`,
        data: { day, gap, horizon },
      }, preset);
      return { state: next, missed: [], effects: noEffects() };
    }
  }
  const missed = [];
  const effects = noEffects();

  for (const item of expected) {
    const subjectId = item && item.subjectId;
    const periodIndex = item && item.periodIndex != null ? Number(item.periodIndex) : null;
    const known = (acc.attendance.records || []).some(
      (r) => r.day === day && r.subjectId === subjectId && r.periodIndex === periodIndex,
    );
    if (known) continue;

    const res = mark(acc, { subjectId, status: 'skip', day, periodIndex }, preset, opts);
    acc = res.state;
    missed.push(subjectId);
    effects.relation.push(...res.effects.relation);
    effects.reputation += res.effects.reputation;
    effects.debt.push(...res.effects.debt);
  }

  return { state: acc, missed, effects };
}

export function stats(state, subjectId) {
  return count((state.attendance && state.attendance.records) || [], (r) => r.subjectId === subjectId);
}

export function totalStats(state) {
  return count((state.attendance && state.attendance.records) || [], () => true);
}

function count(records, keep) {
  const out = { present: 0, skips: 0, lates: 0, excused: 0, worked: 0 };
  for (const r of records) {
    if (!keep(r)) continue;
    if (r.status === 'present') out.present += 1;
    else if (r.status === 'skip') {
      out.skips += 1;
      if (r.workedOff) out.worked += 1;
    }
    else if (r.status === 'late') out.lates += 1;
    else if (r.status === 'excused') out.excused += 1;
  }
  return out;
}

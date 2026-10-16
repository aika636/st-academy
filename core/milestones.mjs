import { findSubject, findTeacher } from './state.mjs';
import { addDays, diffDays, mondayOf, termsOf } from './time.mjs';
import { dayPlan } from './schedule.mjs';
import { countsAttendance } from './attendance.mjs';
import { gradeInfo, isDatedExam } from './exams.mjs';

export const KINDS = [
  'firstTop', 'cleanWeek', 'debtCleared', 'cleanSession', 'autoPass', 'brilliant',
  'retakeWin', 'favorite', 'nemesis', 'onTheEdge', 'firstSkip', 'ghost', 'critFail',
];

export const GHOST_SKIPS = 10;

export function milestones(state, preset) {
  if (!state || typeof state !== 'object') return [];
  const out = [
    firstTop(state, preset),
    cleanWeek(state, preset),
    debtCleared(state, preset),
    ...cleanSessions(state, preset),
    fromRolls(state, 'autoPass', (r) => r.tier === 'auto'),
    fromRolls(state, 'brilliant', (r) => r.tier === 'critSuccess'),
    retakeWin(state, preset),
    ...relationZones(state, preset),
    onTheEdge(state, preset),
    firstSkip(state),
    ghost(state),
    fromRolls(state, 'critFail', (r) => r.tier === 'critFail'),
  ].filter(Boolean);

  const rank = (m) => KINDS.indexOf(m.kind);
  return out
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      if (a.m.when && b.m.when && a.m.when !== b.m.when) return a.m.when < b.m.when ? -1 : 1;
      if (Boolean(a.m.when) !== Boolean(b.m.when)) return a.m.when ? -1 : 1;
      return (rank(a.m) - rank(b.m)) || (a.i - b.i);
    })
    .map((x) => x.m);
}

export function diffMilestones(before, after) {
  const was = new Set((before || []).map((m) => m.id));
  const now = new Set((after || []).map((m) => m.id));
  return {
    added: (after || []).filter((m) => !was.has(m.id)),
    removed: (before || []).filter((m) => !now.has(m.id)),
  };
}

export function milestoneDetail(m, state, preset) {
  if (!m) return '';
  if (m.teacherId) {
    const teacher = findTeacher(state, m.teacherId);
    return (teacher && teacher.name) || m.teacherId;
  }
  if (m.subjectId) {
    const subject = findSubject(state, m.subjectId);
    return (subject && subject.name) || m.subjectId;
  }
  if (Number.isFinite(m.term)) {
    const n = (m.term % Math.max(1, termsOf(preset, state).length)) + 1;
    return [preset && preset.vocab && preset.vocab.term, n].filter(Boolean).join(' ');
  }
  return '';
}

function firstTop(state, preset) {
  const points = ((preset && preset.grades && preset.grades.values) || [])
    .filter((v) => typeof v.points === 'number' && Number.isFinite(v.points))
    .map((v) => v.points);
  if (!points.length) return null;
  const top = Math.max(...points);

  let best = null;
  for (const subject of state.subjects || []) {
    for (const g of subject.grades || []) {
      const info = gradeInfo(preset, g.value);
      if (!info || info.points !== top) continue;
      const day = g.day || null;
      if (!best || (day && (!best.when || day < best.when))) {
        best = { id: 'firstTop', kind: 'firstTop', when: day, subjectId: subject.id, value: String(info.value) };
      }
    }
  }
  return best;
}

function cleanWeek(state, preset) {
  const records = (state.attendance && state.attendance.records) || [];
  const today = state.calendar && state.calendar.day;
  if (!records.length || !today) return null;

  const weeks = [...new Set(records.map((r) => r.day).filter(Boolean).map(mondayOf))].sort();
  const thisWeek = mondayOf(today);
  for (const monday of weeks) {
    if (diffDays(monday, thisWeek) <= 0) break;
    const mine = records.filter((r) => r.day && mondayOf(r.day) === monday);
    if (mine.some((r) => r.status === 'skip')) continue;

    let last = null;
    let ok = true;
    for (let d = 0; d < 7; d += 1) {
      const day = addDays(monday, d);
      if (!countsAttendance(state, day)) continue;
      if (!dayPlan(state, preset, day).length) continue;
      if (!mine.some((r) => r.day === day && !r.montage)) { ok = false; break; }
      last = day;
    }
    if (ok && last) return { id: 'cleanWeek', kind: 'cleanWeek', when: last };
  }
  return null;
}

function debtCleared(state, preset) {
  let best = null;
  for (const subject of state.subjects || []) {
    const debtDays = [skipDebtDay(state, subject.id, preset), missedDebtDay(state, subject.id)]
      .filter(Boolean)
      .sort();
    let inDebt = false;
    let pendingIdx = 0;
    for (const g of subject.grades || []) {
      while (pendingIdx < debtDays.length && g.day && debtDays[pendingIdx] < g.day) {
        inDebt = true;
        pendingIdx += 1;
      }
      const info = gradeInfo(preset, g.value);
      if (!info) continue;
      if (!info.pass) { inDebt = true; continue; }
      if (inDebt) {
        const when = g.day || null;
        if (!best || (when && (!best.when || when < best.when))) {
          best = { id: 'debtCleared', kind: 'debtCleared', when, subjectId: subject.id };
        }
        break;
      }
    }
  }
  return best;
}

function skipDebtDay(state, subjectId, preset) {
  const att = (preset && preset.attendance) || {};
  const threshold = att.debtAfterSkips;
  if (typeof threshold !== 'number') return null;
  const per = typeof att.lateEqualsSkip === 'number' && att.lateEqualsSkip > 0 ? att.lateEqualsSkip : null;
  const mine = ((state.attendance && state.attendance.records) || [])
    .filter((r) => r.subjectId === subjectId && r.day)
    .slice()
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  let skips = 0;
  let lates = 0;
  for (const r of mine) {
    if (r.status === 'skip') skips += 1;
    else if (r.status === 'late') lates += 1;
    else continue;
    if (skips + (per ? Math.floor(lates / per) : 0) >= threshold) return r.day;
  }
  return null;
}

function missedDebtDay(state, subjectId) {
  const items = ((state.exams && state.exams.items) || []).filter((i) => i.subjectId === subjectId && i.missed && i.day);
  return items.length ? items.map((i) => i.day).sort()[0] : null;
}

function cleanSessions(state, preset) {
  const items = ((state.exams && state.exams.items) || []).filter((i) => !isDatedExam(preset, i));
  const terms = [...new Set(items.map((i) => (Number.isFinite(i.term) ? i.term : 0)))].sort((a, b) => a - b);
  const out = [];
  for (const term of terms) {
    const mine = items.filter((i) => (Number.isFinite(i.term) ? i.term : 0) === term);
    if (!mine.length) continue;
    const clean = mine.every((i) => !i.missed
      && i.outcome !== null && i.outcome !== undefined && i.outcome !== ''
      && Number(i.attempts) === 1
      && Boolean(gradeInfo(preset, i.outcome) && gradeInfo(preset, i.outcome).pass));
    if (!clean) continue;
    const days = mine.map((i) => i.day).filter(Boolean).sort();
    out.push({ id: `cleanSession:${term}`, kind: 'cleanSession', when: days.length ? days[days.length - 1] : null, term });
  }
  return out;
}

function fromRolls(state, kind, test) {
  let best = null;
  for (const item of (state.exams && state.exams.items) || []) {
    const rolls = Array.isArray(item.rolls) ? item.rolls : [];
    rolls.forEach((r, idx) => {
      if (!r || !test(r)) return;
      const lastOverridden = idx === rolls.length - 1 && item.modelOverride && String(item.outcome) !== String(r.value);
      if (lastOverridden) return;
      const when = r.day || null;
      if (!best || (when && (!best.when || when < best.when))) {
        best = { id: kind, kind, when, subjectId: item.subjectId, value: String(r.value) };
      }
    });
  }
  return best;
}

function relationZones(state, preset) {
  const labels = (preset && preset.relations && preset.relations.labels) || [];
  if (labels.length < 2) return [];
  const topFrom = labels[labels.length - 2].upTo;
  const bottomTo = labels[0].upTo;
  const inTop = (v) => typeof v === 'number' && v > topFrom;
  const inBottom = (v) => typeof v === 'number' && v <= bottomTo;

  const out = [];
  for (const t of state.teachers || []) {
    for (const [kind, inside] of [['favorite', inTop], ['nemesis', inBottom]]) {
      if (!inside(t.relation)) continue;
      const when = lastJournalDay(state, (e) => e.kind === 'rel' && e.data
        && e.data.teacherId === t.id && !inside(e.data.from) && inside(e.data.to));
      out.push({ id: `${kind}:${t.id}`, kind, when, teacherId: t.id });
    }
  }
  return out;
}

function onTheEdge(state, preset) {
  if (!(state.reputation && state.reputation.warned)) return null;
  const warnAt = preset && preset.reputation && preset.reputation.warnAt;
  const when = typeof warnAt === 'number'
    ? firstJournalDay(state, (e) => e.kind === 'reputation' && e.data
      && typeof e.data.from === 'number' && typeof e.data.to === 'number'
      && e.data.from > warnAt && e.data.to <= warnAt)
    : null;
  return { id: 'onTheEdge', kind: 'onTheEdge', when };
}

function retakeWin(state, preset) {
  let best = null;
  for (const item of (state.exams && state.exams.items) || []) {
    if (!(Number(item.attempts) > 1)) continue;
    const info = item.outcome !== null && item.outcome !== undefined && item.outcome !== ''
      ? gradeInfo(preset, item.outcome) : null;
    if (!info || !info.pass) continue;
    const rolls = Array.isArray(item.rolls) ? item.rolls : [];
    const last = rolls.length ? rolls[rolls.length - 1] : null;
    const when = (last && last.day) || item.day || null;
    if (!best || (when && (!best.when || when < best.when))) {
      best = { id: 'retakeWin', kind: 'retakeWin', when, subjectId: item.subjectId };
    }
  }
  return best;
}

function skipsInOrder(state) {
  return ((state.attendance && state.attendance.records) || [])
    .filter((r) => r && r.status === 'skip' && r.day)
    .slice()
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

function firstSkip(state) {
  const first = skipsInOrder(state)[0];
  return first ? { id: 'firstSkip', kind: 'firstSkip', when: first.day, subjectId: first.subjectId } : null;
}

function ghost(state) {
  const list = skipsInOrder(state);
  return list.length >= GHOST_SKIPS ? { id: 'ghost', kind: 'ghost', when: list[GHOST_SKIPS - 1].day } : null;
}

function firstJournalDay(state, test) {
  const hit = (state.journal || []).find((e) => e && test(e));
  return (hit && hit.day) || null;
}

function lastJournalDay(state, test) {
  const list = state.journal || [];
  for (let i = list.length - 1; i >= 0; i -= 1) if (list[i] && test(list[i])) return list[i].day || null;
  return null;
}

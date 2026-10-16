import { cloneState, findTeacher, pushJournal, labelFor, clamp, teacherOfSubject, findSubject } from './state.mjs';
import { classmateLabels } from './classmates.mjs';

export function findPerson(state, id) {
  const t = findTeacher(state, id);
  if (t) return t;
  return ((state && state.classmates) || []).find((c) => c && c.id === id) || null;
}

export function isClassmate(state, id) {
  if (findTeacher(state, id)) return false;
  return ((state && state.classmates) || []).some((c) => c && c.id === id);
}

export function labelsOf(state, id, preset) {
  if (isClassmate(state, id)) return classmateLabels(preset);
  return (preset && preset.relations && preset.relations.labels) || [];
}

export const IMPACT_LEVELS = ['minor', 'major'];

export const DEFAULT_IMPACT = { minor: 1, major: 2 };

export function impactWeight(preset, level) {
  if (!IMPACT_LEVELS.includes(level)) return 0;
  const own = preset && preset.relations && preset.relations.impact;
  const v = own && Number(own[level]);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_IMPACT[level];
}

export const DEFAULT_REPEAT_LIMIT = 2;

export function repeatLimit(preset) {
  const v = Number(preset && preset.relations && preset.relations.repeatLimit);
  return Number.isInteger(v) && v >= 1 ? v : DEFAULT_REPEAT_LIMIT;
}

export function teachersOfSubjects(state, subjectIds) {
  const out = [];
  for (const id of subjectIds || []) {
    const t = teacherOfSubject(state, id);
    if (t && !out.includes(t.id)) out.push(t.id);
  }
  return out;
}

export function dampRepeats(state, events, preset, ctx = {}) {
  const next = cloneState(state);
  const day = ctx.day || (next.calendar && next.calendar.day) || '';
  const fresh = new Set(ctx.fresh || []);
  const limit = repeatLimit(preset);
  const prev = next.relStreak && typeof next.relStreak === 'object' ? next.relStreak : {};

  const sums = new Map();
  for (const ev of events || []) {
    const d = Number(ev && ev.delta);
    if (!ev || !ev.teacherId || !Number.isFinite(d)) continue;
    sums.set(ev.teacherId, (sums.get(ev.teacherId) || 0) + d);
  }

  const streak = {};
  const muted = new Set();
  const damped = [];
  for (const [teacherId, delta] of sums) {
    if (delta === 0) continue;
    const p = prev[teacherId];
    const same = p && p.delta === delta && p.day === day && !fresh.has(teacherId);
    const count = same ? p.count + 1 : 1;
    streak[teacherId] = { delta, count, day };
    if (count > limit) {
      muted.add(teacherId);
      damped.push({ teacherId, delta, count });
      pushJournal(next, {
        kind: 'rel',
        text: `relation damped ${teacherId} ${delta > 0 ? '+' : ''}${delta} x${count}`,
        data: { teacherId, delta, damped: true, count, limit },
      }, preset);
    }
  }
  next.relStreak = streak;

  const kept = (events || []).filter((ev) => !(ev && muted.has(ev.teacherId)));
  return { state: next, events: kept, damped };
}

export const PACES = ['slow', 'normal', 'fast'];
export const DEFAULT_PACE = 'normal';

export const PACE_WORDS = { slow: 'медленный', normal: 'обычный', fast: 'быстрый' };

export const PACE_CAPS = {
  slow: { up: 1, day: 1, down: 2 },
  normal: { up: 1, day: 2, down: 2 },
  fast: { up: 2, day: 3, down: 3 },
};

export function paceOf(state) {
  const v = state && state.relPace;
  return PACES.includes(v) ? v : DEFAULT_PACE;
}

export function paceCaps(pace, preset) {
  const base = PACE_CAPS[PACES.includes(pace) ? pace : DEFAULT_PACE];
  const r = (preset && preset.relations) || {};
  const span = Number(r.max) - Number(r.min);
  const k = Number.isFinite(span) ? Math.max(1, Math.ceil(span / 6)) : 1;
  return { up: base.up * k, day: base.day * k, down: base.down * k };
}

export function capRelation(state, events, preset, ctx = {}) {
  const next = cloneState(state);
  const pace = PACES.includes(ctx.pace) ? ctx.pace : paceOf(next);
  const day = ctx.day || (next.calendar && next.calendar.day) || '';
  const caps = paceCaps(pace, preset);
  const prev = next.relDay && typeof next.relDay === 'object' && next.relDay.day === day && next.relDay.up
    ? next.relDay.up : {};
  const up = { ...prev };

  const sums = new Map();
  for (const ev of events || []) {
    const d = Number(ev && ev.delta);
    if (!ev || !ev.teacherId || !Number.isFinite(d)) continue;
    sums.set(ev.teacherId, (sums.get(ev.teacherId) || 0) + d);
  }

  const capped = [];
  const cut = new Map();
  for (const [teacherId, delta] of sums) {
    if (delta === 0) continue;
    let allowed = delta;
    if (delta > 0) {
      const left = Math.max(0, caps.day - (up[teacherId] || 0));
      allowed = Math.min(delta, caps.up, left);
      up[teacherId] = (up[teacherId] || 0) + allowed;
    } else {
      allowed = Math.max(delta, -caps.down);
    }
    if (allowed === delta) continue;
    cut.set(teacherId, allowed);
    capped.push({ teacherId, delta, allowed, pace });
    pushJournal(next, {
      kind: 'rel',
      text: `relation capped ${teacherId} ${delta > 0 ? '+' : ''}${delta} -> ${allowed > 0 ? '+' : ''}${allowed}`,
      data: { teacherId, delta, allowed, capped: true, pace },
    }, preset);
  }
  next.relDay = { day, up };

  const done = new Set();
  const kept = [];
  for (const ev of events || []) {
    if (!ev || !cut.has(ev.teacherId)) { kept.push(ev); continue; }
    if (done.has(ev.teacherId)) continue;
    done.add(ev.teacherId);
    const allowed = cut.get(ev.teacherId);
    if (allowed !== 0) kept.push({ ...ev, delta: allowed, capOf: ev });
  }
  return { state: next, events: kept, capped };
}

export const REASON_PHRASES = {
  grade: 'оценка {value}: {subject}',
  exam: 'испытание: {subject} — {value}',
  skip: 'прогул: {subject}',
  skipMany: 'прогулы: {subject} ×{count}',
  late: 'опоздание: {subject}',
  present: 'присутствие: {subject}',
  marker: '{text}',
  withText: '{base} ({text})',
};

export function reasonText(reason, state, preset) {
  if (!reason || typeof reason !== 'object') return typeof reason === 'string' ? reason : '';
  const ph = { ...REASON_PHRASES, ...((preset && preset.phrases && preset.phrases.relationReason) || {}) };
  const subject = reason.subjectId ? findSubject(state || {}, reason.subjectId) : null;
  const vars = {
    subject: (subject && subject.name) || reason.subjectId || '',
    value: reason.value == null ? '' : String(reason.value),
    count: String(reason.count || ''),
    text: reason.text || '',
  };
  const key = reason.kind === 'skip' && reason.count > 1 ? 'skipMany' : reason.kind;
  const base = key && key !== 'marker' && ph[key] ? fillReason(ph[key], vars) : '';
  if (base && vars.text && !repeats(base, vars.text)) return fillReason(ph.withText, { base, text: vars.text });
  return base || vars.text;
}

function repeats(base, text) {
  const stems = (v) => String(v).toLowerCase().replace(/ё/g, 'е').split(/[^\p{L}]+/u).filter((w) => w.length >= 4).map((w) => w.slice(0, 4));
  const have = new Set(stems(base));
  const mine = stems(text);
  return mine.length > 0 && mine.every((w) => have.has(w));
}

export const MEMORY_SIZE = 3;

export function relationMemory(state, teacherId, preset, limit = MEMORY_SIZE) {
  const labels = labelsOf(state, teacherId, preset);
  const out = [];
  const journal = (state && state.journal) || [];
  for (let i = journal.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const e = journal[i];
    if (!e || e.kind !== 'rel' || !e.data || e.data.teacherId !== teacherId) continue;
    const { from, to } = e.data;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) continue;
    const a = labelFor(labels, from);
    const b = labelFor(labels, to);
    out.push({
      day: e.day || '',
      delta: to - from,
      subjectId: (e.data.reason && typeof e.data.reason === 'object' && e.data.reason.subjectId) || '',
      reason: reasonText(e.data.reason, state, preset).replace(/\s+/g, ' ').trim(),
      from,
      to,
      crossed: a && b && a !== b ? { from: a, to: b } : null,
    });
  }
  return out;
}

function fillReason(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function mergeDeltas(list) {
  const by = new Map();
  for (const ev of list || []) {
    const d = Number(ev && ev.delta);
    if (!ev || !ev.teacherId || !Number.isFinite(d)) continue;
    const acc = by.get(ev.teacherId) || { teacherId: ev.teacherId, delta: 0, reasons: [] };
    acc.delta += d;
    acc.reasons.push((ev.reason && typeof ev.reason === 'object') ? ev.reason : {});
    by.set(ev.teacherId, acc);
  }
  const out = [];
  for (const acc of by.values()) {
    if (acc.delta === 0) continue;
    const kinds = new Set(acc.reasons.map((r) => r.kind || 'skip'));
    const subjects = new Set(acc.reasons.map((r) => r.subjectId || ''));
    const kind = kinds.size === 1 ? [...kinds][0] : 'skip';
    const reason = { kind, count: acc.reasons.length };
    if (subjects.size === 1 && [...subjects][0]) reason.subjectId = [...subjects][0];
    out.push({ teacherId: acc.teacherId, delta: acc.delta, reason });
  }
  return out;
}

export function relationOf(state, teacherId) {
  const t = findPerson(state, teacherId);
  return t && Number.isFinite(t.relation) ? t.relation : 0;
}

export function relationLabel(state, teacherId, preset) {
  return labelFor(labelsOf(state, teacherId, preset), relationOf(state, teacherId));
}

export function changeRelation(state, ev, preset) {
  const next = cloneState(state);
  const teacherId = ev && ev.teacherId;
  const teacher = findPerson(next, teacherId);

  if (!teacher) {
    pushJournal(next, {
      kind: 'rel',
      text: `relation rejected: unknown teacher ${teacherId}`,
      data: { teacherId, delta: ev && ev.delta },
    }, preset);
    return { state: next, applied: false, crossed: null };
  }

  const scale = (preset && preset.relations) || {};
  const delta = Number(ev.delta);
  if (!Number.isFinite(delta)) return { state: next, applied: false, crossed: null };

  const before = teacher.relation;
  const labelBefore = relationLabel(next, teacherId, preset);

  teacher.relation = clamp(before + delta, scale.min, scale.max);

  const labelAfter = relationLabel(next, teacherId, preset);
  const applied = teacher.relation !== before;
  const crossed = labelAfter !== labelBefore ? { from: labelBefore, to: labelAfter } : null;

  pushJournal(next, {
    kind: 'rel',
    text: `relation ${teacher.id} ${labelBefore}->${labelAfter}`,
    data: { teacherId: teacher.id, delta, from: before, to: teacher.relation, reason: ev.reason || null },
  }, preset);

  return { state: next, applied, crossed };
}

export function applyRelationDeltas(state, list, preset) {
  let acc = state;
  const crossed = [];
  for (const ev of list || []) {
    const res = changeRelation(acc, ev, preset);
    acc = res.state;
    if (res.crossed) crossed.push({ teacherId: ev.teacherId, ...res.crossed });
  }
  return { state: acc, crossed };
}

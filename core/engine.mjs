import {
  cloneState, pushJournal, takePending, teacherOfSubject, findSubject,
} from './state.mjs';
import {
  advance, setAbsolute, shiftYears, noteIdle, phaseOf, isStudyDay, isStalled, addDays, parseDay, minutesOf, periodPosition,
} from './time.mjs';
import { dayPlan, dayEndInfo } from './schedule.mjs';
import { parseMarker, MARKER_RE } from './parse-marker.mjs';
import { readTime } from './time-source.mjs';
import { addGrade, setDebt, closeSkipDebt, resolveGrade, REJECT_UNKNOWN_VALUE } from './gradebook.mjs';
import { mark, workOff, countsAttendance, effectiveSkips } from './attendance.mjs';
import { applyAcademicCompletion } from './academic-completion.mjs';
import { applyRelationDeltas, dampRepeats, capRelation, paceOf, teachersOfSubjects, mergeDeltas } from './relations.mjs';
import { changeReputation } from './reputation.mjs';
import { settleBackground, dropBackground, gradeFame } from './fame.mjs';
import { armHolidayHooks, planEvent, planPause } from './holidays.mjs';
import { markerPeople } from './classmates.mjs';
import { subjectWord } from './words.mjs';
import {
  scheduleExams, examMode, rollOutcome, applyOutcome, resolveConflict, permissionLine,
  examTermIndex, examSessionEnded, closeExamSession, isPassing, examScore,
  scheduleDatedExams, datedExams, sittableExams, isDatedExam, kindOf, seededRng, examSeed,
  announceResults, awaitingAnnouncement, externalValue, examRule, fromPastTerm, retakesLeft,
} from './exams.mjs';

export const MODES = ['auto', 'context', 'marker'];

export const SKIP_POLICIES = ['attend'];

export function skipPolicyOf() {
  return 'attend';
}

export function jumpPolicyOf() {
  return 'attend';
}

function jumpCapOf(preset) {
  const v = Number(preset && preset.limits && preset.limits.maxForwardJump);
  return Number.isFinite(v) ? v : 1;
}

export function timeSkipCap(preset, days = null) {
  const base = jumpCapOf(preset);
  let cap = 2 * base;
  if (Number.isFinite(days) && days >= 0) cap = Math.max(cap, Math.ceil(days) + 1);
  const limit = Number(preset && preset.limits && preset.limits.maxTimeShift);
  if (Number.isFinite(limit)) cap = Math.min(cap, Math.max(limit, base));
  return cap;
}

export function examAhead(state, preset, horizon) {
  const today = state && state.calendar && state.calendar.day;
  const n = Math.floor(Number(horizon));
  if (!today || !Number.isFinite(n) || n < 1) return null;
  for (let k = 1; k <= n; k += 1) {
    const day = addDays(today, k);
    const probe = cloneState(state);
    probe.calendar.day = day;
    const s = calendarEvents(probe, preset).state;
    const due = sittableExams(s, preset, day);
    if (!due.length) continue;
    const item = due.find((i) => !i.outcome) || due[0];
    const vocab = (preset && preset.vocab) || {};
    const dated = isDatedExam(preset, item);
    const what = dated
      ? String((kindOf(preset, item.kind) || {}).name || item.kind || '')
      : String(vocab.examPeriod || item.kind || '');
    return { day, days: k, what, subjectId: item.subjectId, count: due.length, dated };
  }
  return null;
}

export function examsAhead(state, preset, horizon) {
  const today = state && state.calendar && state.calendar.day;
  const n = Math.floor(Number(horizon));
  if (!today || !Number.isFinite(n) || n < 1) return null;
  for (let k = 1; k <= n; k += 1) {
    const day = addDays(today, k);
    const probe = cloneState(state);
    probe.calendar.day = day;
    const due = sittableExams(calendarEvents(probe, preset).state, preset, day);
    if (due.length) return { day, days: k, items: due.filter((i) => !i.outcome) };
  }
  return null;
}

function timeSkipOf(state, preset, cue) {
  if (!cue) return null;
  const days = cue && typeof cue === 'object' && Number.isFinite(cue.days) ? cue.days : null;
  let cap = timeSkipCap(preset, days);
  const exam = examAhead(state, preset, cap);
  if (exam) cap = Math.max(jumpCapOf(preset), Math.min(cap, exam.days));
  return {
    days,
    cap,
    policy: skipPolicyOf(preset),
    exam,
    preset: { ...preset, limits: { ...((preset && preset.limits) || {}), maxForwardJump: cap } },
  };
}

export const TIME_SKIP_PHRASES = {
  examAhead: 'Промотка времени не может перешагнуть {date}: в этот день — {what}. Останови сцену накануне.',
};

export function timeSkipWarning(state, preset, cue) {
  if (!cue || !state || !state.started) return '';
  const days = typeof cue === 'object' && Number.isFinite(cue.days) ? cue.days : null;
  const exam = examAhead(state, preset, timeSkipCap(preset, days));
  if (!exam) return '';
  const p = parseDay(exam.day);
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${pad(p.d)}.${pad(p.m)}`;
  const phrases = (preset && preset.phrases && preset.phrases.timeSkip) || {};
  const tpl = typeof phrases.examAhead === 'string' && phrases.examAhead ? phrases.examAhead : TIME_SKIP_PHRASES.examAhead;
  return tpl.replace(/\{date\}/g, date).replace(/\{what\}/g, exam.what);
}

const posOf = (state, preset) => {
  const cal = state.calendar;
  if (preset && cal.precision === 'datetime' && cal.time) return periodPosition(preset, cal.time);
  return Number.isFinite(cal.periodIndex) ? cal.periodIndex : 0;
};

export function applyResponse(state, text, preset, opts = {}) {
  const mode = MODES.includes(opts.mode) ? opts.mode : 'auto';
  const src = typeof text === 'string' ? text : '';

  const out = {
    state: null,
    injects: [],
    rejected: [],
    missed: [],
    notes: [],
    exam: null,
    permission: '',
    divergence: null,
    modelSaid: null,
    heldJump: null,
    jump: null,
    debug: {
      mode,
      source: null,
      via: null,
      moved: false,
      marker: markerText(src),
      applied: [],
      refused: [],
      rejected: [],
      notes: [],
      stalled: false,
      idle: 0,
    },
  };

  let s = cloneState(state);

  const lexicon = {
    ...preset,
    subjects: s.subjects,
    teachers: markerPeople(s),
    survey: s.survey,
    names: opts.names && typeof opts.names === 'object' ? opts.names : null,
  };
  const parsed = parseMarker(src, lexicon);
  out.rejected = parsed.rejected;
  out.debug.rejected = parsed.rejected;

  const effects = { relation: [], reputation: 0, debt: [] };
  const attendance = parsed.events.filter((e) => e.kind === 'attendance');
  const counted = new Set();
  const markDay = (acc, day, pos) => {
    const plan = dayPlan(acc, preset, day);
    for (const ev of attendance) {
      const slot = plan.find((p) => p.subjectId === ev.subjectId);
      if (acc.attendance.records.some((r) => r.day === day && r.subjectId === ev.subjectId && r.status === ev.status
        && r.periodIndex === (slot ? slot.index : pos))) counted.add(ev.subjectId);
      const res = mark(acc, { subjectId: ev.subjectId, status: ev.status, day, periodIndex: slot ? slot.index : pos }, preset);
      acc = res.state;
      absorb(effects, res.effects);
      out.debug.applied.push({ kind: 'attendance', subjectId: ev.subjectId, status: ev.status });
    }
    return acc;
  };

  const skip = opts.phoneTurn ? null : timeSkipOf(s, preset, opts.timeSkip);
  if (opts.phoneTurn) out.debug.applied.push({ kind: 'phone-turn' });
  if (skip) {
    out.debug.applied.push({
      kind: 'time-skip', days: skip.days, cap: skip.cap, policy: skip.policy,
      examDay: skip.exam ? skip.exam.day : null,
    });
  }
  const fromDay = s.calendar.day;
  const fromPos = posOf(s, preset);
  const fromTime = s.calendar.precision === 'datetime' ? s.calendar.time : null;
  const moveRes = applyTime(s, src, parsed, mode, preset, { ...opts, skip, phoneTurn: Boolean(opts.phoneTurn) });
  s = moveRes.state;
  out.notes.push(...moveRes.notes);
  out.debug.source = moveRes.source;
  out.debug.via = moveRes.via;
  out.debug.moved = moveRes.moved;
  if (attendance.length) {
    if (moveRes.held && s.calendar.heldJump === moveRes.held) {
      s.calendar.heldJump.marks = attendance.map((e) => ({ subjectId: e.subjectId, status: e.status }));
    } else if (moveRes.unit === 'absolute') s = markDay(s, s.calendar.day, posOf(s, preset));
    else s = markDay(s, fromDay, fromPos);
  }
  out.heldJump = s.calendar.heldJump || null;
  out.debug.applied.push(...moveRes.applied);

  const sweep = sweepAttendance(
    s, fromDay, fromPos, opts.phoneTurn ? null : moveRes.unit, preset,
    { policy: skip ? skip.policy : jumpPolicyOf(preset, fromDay, s.calendar.day) },
  );
  s = sweep.state;
  out.missed = sweep.missed;
  out.jump = sweep.summary || null;
  absorb(effects, sweep.effects);
  if (sweep.missed.length) out.debug.applied.push({ kind: 'missed', count: sweep.missed.length });

  if (!opts.phoneTurn) {
    const late = arrivalLate(s, parsed.events, fromDay, fromTime, preset);
    s = late.state;
    absorb(effects, late.effects);
    for (const subjectId of late.subjectIds) out.debug.applied.push({ kind: 'attendance', subjectId, status: 'late', derived: true });
  }

  const relEvents = parsed.events.filter((e) => e.kind === 'rel').filter((ev) => {
    const why = counted.size ? relReason(s, ev, parsed.events, []) : null;
    return !(why && (why.kind === 'skip' || why.kind === 'late') && counted.has(why.subjectId));
  });
  const touched = [
    ...parsed.events.filter((e) => e.kind === 'grade' || e.kind === 'attendance').map((e) => e.subjectId),
    ...sweep.missed,
  ];
  const damp = dampRepeats(s, relEvents, preset, { fresh: teachersOfSubjects(s, touched) });
  s = damp.state;
  const reasons = new Map(relEvents.map((ev) => [ev, relReason(s, ev, parsed.events, sweep.missed)]));
  const cap = capRelation(s, damp.events, preset, { pace: paceOf(s) });
  s = cap.state;
  const cappedIds = new Set(cap.capped.map((c) => c.teacherId));
  s = applyRelationDeltas(s, cap.events.map((ev) => ({ ...ev, reason: reasons.get(ev) || reasons.get(ev.capOf) })), preset).state;
  for (const ev of relEvents) {
    const reason = reasons.get(ev);
    out.debug.applied.push({
      kind: 'rel',
      teacherId: ev.teacherId,
      delta: ev.delta,
      ...(ev.impact ? { impact: ev.impact } : {}),
      ...(reason ? { reason } : {}),
      ...(!damp.events.includes(ev) ? { damped: true } : cappedIds.has(ev.teacherId) ? { capped: true } : {}),
    });
  }

  s = applyRelationDeltas(s, effects.relation, preset).state;
  for (const id of effects.debt) s = setDebt(s, id, true, preset);
  if (effects.reputation) {
    s = changeReputation(s, { delta: effects.reputation, reason: 'attendance' }, preset).state;
  }

  if (moveRes.moved) {
    const cal = calendarEvents(s, preset);
    s = cal.state;
    out.debug.applied.push(...cal.applied);
  }

  const bg = settleBackground(s, preset);
  s = bg.state;
  for (const g of bg.grades) out.debug.applied.push({ kind: 'grade', subjectId: g.subjectId, value: g.value, bg: true });

  const todays = todaysExam(s, preset);
  const sits = Boolean(opts.exam || opts.sitsExam);
  let routed = false;
  const told = new Set();
  for (const ev of parsed.events.filter((e) => e.kind === 'grade')) {
    const mine = Boolean(todays) && !routed && todays.item.subjectId === ev.subjectId
      && (todays.sat || sits);
    if (!mine && !told.has(ev.subjectId) && resolveGrade(preset, ev.value)) {
      const wait = todays && todays.sat && todays.item.subjectId !== ev.subjectId ? waitingExam(s, preset, ev.subjectId) : null;
      const item = wait || retakeExam(s, preset, ev.subjectId);
      if (item) {
        const done = narratedOutcome(s, preset, item, ev.value);
        s = done.state;
        told.add(ev.subjectId);
        out.debug.applied.push({
          kind: 'exam', examId: item.id, subjectId: item.subjectId, value: done.item.outcome, reason: 'story', told: true,
          ...(awaitingAnnouncement(done.item) ? { announceOn: done.item.announceOn } : {}),
        });
        continue;
      }
    }
    if (mine && todays.sat) {
      const conflict = resolveConflict(s, { examId: todays.item.id, modelSaid: ev.value }, preset);
      s = conflict.state;
      routed = true;
      told.add(ev.subjectId);
      if (conflict.divergence && !conflict.divergence.applied) {
        out.notes.push(REJECT_UNKNOWN_VALUE);
      } else {
        out.divergence = conflict.divergence || out.divergence;
        out.debug.applied.push({ kind: 'grade', subjectId: ev.subjectId, value: ev.value });
      }
      continue;
    }
    if (mine) {
      out.modelSaid = { examId: todays.item.id, subjectId: ev.subjectId, value: String(ev.value) };
      routed = true;
      told.add(ev.subjectId);
      continue;
    }
    s = dropBackground(s, ev.subjectId, s.calendar.day, preset);
    const r = addGrade(s, { subjectId: ev.subjectId, value: ev.value }, preset);
    s = r.state;
    if (r.applied) {
      s = gradeFame(s, ev.subjectId, ev.value, preset);
      out.debug.applied.push({ kind: 'grade', subjectId: ev.subjectId, value: ev.value });
      const spec = resolveGrade(preset, ev.value);
      if (spec && spec.pass) s = settleWorkOff(s, [ev.subjectId], preset);
    } else {
      out.notes.push(r.reason);
      out.debug.refused.push({ subjectId: ev.subjectId, reason: r.reason === REJECT_UNKNOWN_VALUE ? 'такой оценки нет в шкале' : `нет в списке ${subjectWord(preset, 'genMany')}` });
    }
  }

  for (const event of parsed.events.filter((entry) => entry.kind === 'completion')) {
    const completed = applyAcademicCompletion(s, event, preset);
    s = completed.state;
    if (completed.applied) {
      out.debug.applied.push({ ...event, subjectIds: completed.subjectIds });
      s = settleWorkOff(s, completed.subjectIds, preset);
    }
  }

  if (opts.exam) {
    const held = out.modelSaid && (!opts.examId || opts.examId === out.modelSaid.examId)
      ? out.modelSaid.value
      : undefined;
    const said = opts.modelSaid === undefined || opts.modelSaid === null || opts.modelSaid === ''
      ? held
      : opts.modelSaid;
    const sat = sitExam(s, preset, {
      rng: opts.rng, seed: opts.seed, examId: opts.examId, modelSaid: said, dice: opts.dice,
    });
    s = sat.state;
    out.exam = sat.exam;
    out.permission = sat.permission;
    out.divergence = sat.divergence;
    if (sat.applied) out.debug.applied.push({ kind: 'exam', ...sat.exam });
  }

  for (const ev of parsed.events.filter((e) => e.kind === 'event')) {
    const planned = planEvent(s, preset, ev);
    if (planned.ok) {
      s = planned.state;
      out.debug.applied.push({ kind: 'event', id: planned.event.id, name: planned.event.name, from: planned.event.from });
    } else if (planned.duplicate) {
      out.debug.applied.push({ kind: 'event-known', name: ev.name });
    }
  }

  const heldNow = out.debug.applied.find((a) => a.kind === 'time-held' && typeof a.day === 'string');
  for (const ev of parsed.events.filter((e) => e.kind === 'pause')) {
    const planned = planPause(s, preset, ev, heldNow ? heldNow.day : s.calendar.day);
    if (planned.ok) {
      s = planned.state;
      out.debug.applied.push({
        kind: 'pause',
        action: planned.action,
        name: (planned.event || planned.prev).name,
        from: (planned.event || planned.prev).from,
        receipt: { action: planned.action, id: (planned.event || planned.prev).id, prev: planned.prev },
      });
    } else if (planned.duplicate) {
      out.debug.applied.push({ kind: 'pause-known', name: ev.name || '' });
    }
  }

  armHolidayHooks(s, preset);
  out.injects = takePending(s);
  out.state = s;
  out.debug.notes = out.notes;
  out.debug.idle = s.calendar.idle;
  out.debug.stalled = isStalled(s, preset);
  return out;
}

function settleWorkOff(state, subjectIds, preset) {
  let s = state;
  const day = s.calendar.day;
  for (const subjectId of (subjectIds && subjectIds.length ? subjectIds : [null])) {
    const res = workOff(s, { subjectId, day }, preset);
    s = res.state;
    if (res.effects.reputation) {
      s = changeReputation(s, { delta: res.effects.reputation, reason: 'workoff' }, preset).state;
    }
    const id = subjectId || (res.closed && res.closed.subjectId);
    const owner = id && s.subjects.find((x) => x.id === id);
    const limit = preset.attendance && preset.attendance.debtAfterSkips;
    if (owner && owner.debtSkips && (typeof limit !== 'number' || effectiveSkips(s, id, preset) < limit)) {
      s = closeSkipDebt(s, id, preset);
    }
  }
  return s;
}

function arrivalLate(state, events, fromDay, fromTime, preset) {
  const none = { state, effects: { relation: [], reputation: 0, debt: [] }, subjectIds: [] };
  const cal = state.calendar || {};
  if (!fromTime || cal.precision !== 'datetime' || cal.day !== fromDay || !cal.time) return none;
  const graded = new Set(events.filter((e) => e.kind === 'grade').map((e) => e.subjectId));
  if (!graded.size || !countsAttendance(state, cal.day)) return none;
  const grace = Number((preset.attendance || {}).lateAfterMinutes);
  const limit = Number.isFinite(grace) && grace >= 0 ? grace : 10;
  const before = minutesOf(fromTime);
  const after = minutesOf(cal.time);

  let s = state;
  const effects = { relation: [], reputation: 0, debt: [] };
  const subjectIds = [];
  for (const item of dayPlan(s, preset)) {
    if (!graded.has(item.subjectId) || !item.start || !item.end) continue;
    const start = minutesOf(item.start);
    if (!(before < start && after >= start + limit && after < minutesOf(item.end))) continue;
    const taken = s.attendance.records.some(
      (r) => r.day === cal.day && r.subjectId === item.subjectId && r.periodIndex === item.index,
    );
    if (taken) continue;
    const res = mark(s, { subjectId: item.subjectId, status: 'late', day: cal.day, periodIndex: item.index }, preset);
    s = res.state;
    absorb(effects, res.effects);
    subjectIds.push(item.subjectId);
  }
  return { state: s, effects, subjectIds };
}

function sweepAndSettle(state, fromDay, fromPos, unit, preset, opts = {}) {
  const sweep = sweepAttendance(state, fromDay, fromPos, unit, preset, opts);
  let s = sweep.state;
  s = applyRelationDeltas(s, sweep.effects.relation, preset).state;
  for (const id of sweep.effects.debt) s = setDebt(s, id, true, preset);
  if (sweep.effects.reputation) {
    s = changeReputation(s, { delta: sweep.effects.reputation, reason: 'attendance' }, preset).state;
  }
  return { state: s, missed: sweep.missed, counted: sweep.counted };
}

function calendarEvents(state, preset) {
  let s = state;
  const applied = [];

  if (examSessionEnded(s, preset, s.calendar.day)) {
    const was = s.exams.term;
    s = closeExamSession(s, preset);
    applied.push({ kind: 'exams-closed', term: was });
  }
  const dated = scheduleDatedExams(s, preset, s.calendar.day);
  if (dated.added) {
    s = dated.state;
    applied.push({ kind: 'exams-dated', day: s.calendar.day, added: dated.added });
  }
  if (phaseOf(preset, s, s.calendar.day) === 'exams') {
    const term = examTermIndex(preset, s, s.calendar.day);
    if (!s.exams.active || s.exams.term !== term) {
      s = scheduleExams(s, preset, { day: s.calendar.day, term });
      applied.push({ kind: 'exams-scheduled', day: s.calendar.day, term });
    }
  }
  const told = announceResults(s, preset, s.calendar.day);
  if (told.announced.length) {
    s = told.state;
    applied.push({ kind: 'announced', examIds: told.announced });
  }
  return { state: s, applied };
}

export function resolveHeldJump(state, preset, accept = true) {
  const held = state && state.calendar && state.calendar.heldJump;
  if (!held) return { state, applied: false, reason: 'придержанного прыжка нет', counted: 0 };

  if (!accept) {
    const s = cloneState(state);
    s.calendar.heldJump = null;
    s.calendar.dismissedJump = { day: held.day, ...(held.era ? { era: held.day.slice(0, 4) } : {}) };
    if (held.era) s.calendar.yearShift = held.era;
    return { state: s, applied: false, reason: `прыжок на ${held.day} отклонён`, counted: 0 };
  }

  const fromDay = held.era ? shiftYears(state.calendar.day, held.era) : state.calendar.day;
  const fromPos = posOf(state, preset);
  const r = setAbsolute(state, { day: held.day, time: held.time, daypart: held.daypart, weekday: held.weekday }, held.source || 'A', preset, { force: true, eraOk: Boolean(held.era) });
  let s = cloneState(r.state);
  s.calendar.heldJump = null;
  if (!r.applied) return { state: s, applied: false, reason: r.reason, counted: 0 };

  if (Array.isArray(held.marks) && held.marks.length) {
    const plan = dayPlan(s, preset, s.calendar.day);
    const fx = { relation: [], reputation: 0, debt: [] };
    for (const ev of held.marks) {
      const slot = plan.find((p) => p.subjectId === ev.subjectId);
      const res = mark(s, { subjectId: ev.subjectId, status: ev.status, day: s.calendar.day, periodIndex: slot ? slot.index : posOf(s, preset) }, preset);
      s = res.state;
      absorb(fx, res.effects);
    }
    s = applyRelationDeltas(s, fx.relation, preset).state;
    for (const id of fx.debt) s = setDebt(s, id, true, preset);
    if (fx.reputation) s = changeReputation(s, { delta: fx.reputation, reason: 'attendance' }, preset).state;
  }

  const policy = held.skipPolicy && SKIP_POLICIES.includes(held.skipPolicy) ? held.skipPolicy : skipPolicyOf(preset);
  const swept = sweepAndSettle(s, fromDay, fromPos, 'absolute', preset, { policy });
  s = calendarEvents(swept.state, preset).state;
  return { state: s, applied: true, reason: r.reason, counted: swept.counted };
}

export function manualTime(state, { day, time, shift, count = false } = {}, preset) {
  let s = cloneState(state);
  const reasons = [];
  let applied = false;
  const fromDay = s.calendar.day;
  const fromPos = posOf(s, preset);
  let unit = null;

  if (day !== undefined || time !== undefined) {
    const at = {};
    if (day !== undefined) at.day = day;
    if (time !== undefined) at.time = time;
    const r = setAbsolute(s, at, 'manual', preset, { force: true });
    s = r.state;
    reasons.push(r.reason);
    applied = applied || r.applied;
    if (r.applied) unit = 'absolute';
  }

  if (shift !== undefined && shift !== null) {
    const ev = typeof shift === 'number' ? { unit: 'period', n: shift } : shift;
    const r = advance(s, ev, preset, { allowBack: true });
    s = r.state;
    reasons.push(r.reason);
    applied = applied || r.applied;
    if (r.applied) unit = ev.unit;
  }

  if (applied) {
    s.calendar.source = 'manual';
    delete s.calendar.weekdayShift;
    delete s.calendar.weekdaySeen;
  }

  let counted = 0;
  let wouldCount = 0;
  if (applied && unit) {
    const swept = sweepAndSettle(s, fromDay, fromPos, unit, preset);
    wouldCount = swept.counted;
    if (count) {
      s = swept.state;
      counted = swept.counted;
      wouldCount = 0;
    }
  }
  if (applied) s = calendarEvents(s, preset).state;

  return { state: s, applied, reason: reasons.filter(Boolean).join('; '), counted, wouldCount };
}

export function skipToDayEnd(state, preset) {
  const info = dayEndInfo(state, preset);
  if (!info.available) {
    return { state: cloneState(state), applied: false, reason: 'сегодня занятий впереди нет', counted: 0 };
  }
  let s = cloneState(state);
  const day = s.calendar.day;
  const from = periodPosition(preset, s.calendar.time);
  s.calendar.time = info.endTime;
  s.calendar.periodIndex = periodPosition(preset, info.endTime);
  s.calendar.moved += 1;
  s.calendar.source = 'manual';
  s.calendar.idle = 0;
  const swept = sweepAndSettle(s, day, from, 'period', preset);
  s = calendarEvents(swept.state, preset).state;
  return { state: s, applied: true, reason: `до конца занятий: ${info.endTime}`, counted: swept.counted };
}

export function todaysExam(state, preset) {
  const day = (state && state.calendar && state.calendar.day) || '';
  if (!day) return null;
  const inSession = phaseOf(preset, state, day) === 'exams' && examMode(state, preset).active;
  const sat = ((state.exams && state.exams.items) || [])
    .find((i) => i.outcome && i.day === day);
  if (sat && (inSession || isDatedExam(preset, sat))) return { item: sat, sat: true };
  const queue = sittableExams(state, preset, day);
  const next = queue.find((i) => !i.outcome) || queue[0];
  return next ? { item: next, sat: false } : null;
}

function waitingExam(state, preset, subjectId) {
  const open = (i) => i.subjectId === subjectId && !i.outcome;
  return examMode(state, preset).pending.find(open) || datedExams(state, preset, state.calendar.day).find(open) || null;
}

function retakeExam(state, preset, subjectId) {
  const day = state.calendar.day;
  const sittable = new Set(sittableExams(state, preset, day).map((i) => i.id));
  const list = ((state.exams && state.exams.items) || []).filter((i) => i.subjectId === subjectId
    && i.outcome && !isPassing(preset, i.outcome) && retakesLeft(preset, i) > 0
    && !i.missed && !awaitingAnnouncement(i) && i.day !== day && !sittable.has(i.id));
  return list[list.length - 1] || null;
}

function examReputation(state, preset, item, done) {
  const delta = (preset.reputation && preset.reputation.delta) || {};
  const passed = isPassing(preset, done.outcome);
  if (!passed && item.outcome && !isPassing(preset, item.outcome)) return state;
  return changeReputation(state, { delta: passed ? delta.examPassed : delta.examFailed, reason: 'exam' }, preset).state;
}

function narratedOutcome(state, preset, item, value) {
  let s = applyOutcome(state, { examId: item.id, value, day: state.calendar.day, reason: 'story', check: null }, preset).state;
  const done = s.exams.items.find((i) => i.id === item.id) || item;
  s = examReputation(s, preset, item, done);
  if (isPassing(preset, done.outcome)) s = settleWorkOff(s, [item.subjectId], preset);
  return { state: s, item: done };
}

export function sitExam(state, preset, opts = {}) {
  const rng = typeof opts.rng === 'function'
    ? opts.rng
    : (opts.seed !== undefined && opts.seed !== null && opts.seed !== '' ? null : Math.random);
  const mode = examMode(state, preset);
  const dated = datedExams(state, preset, state.calendar && state.calendar.day);
  const queue = [...dated, ...mode.pending.filter((i) => !dated.some((d) => d.id === i.id)
    && !awaitingAnnouncement(i) && !fromPastTerm(preset, state, i))];
  const item = opts.examId
    ? queue.find((i) => i.id === opts.examId)
    : (queue.find((i) => !i.outcome) || queue[0]);
  if (!item) {
    return { state: cloneState(state), exam: null, permission: '', divergence: null, applied: false };
  }
  const said = opts.modelSaid !== undefined && opts.modelSaid !== null && opts.modelSaid !== '';
  if (examRule(state) === 'story') return sitByStory(state, preset, item, said ? String(opts.modelSaid) : '', opts.dice);

  const score = examScore(state, preset, item);
  const teacher = teacherOfSubject(state, item.subjectId);
  const permission = permissionLine(state, preset, { subjectId: item.subjectId, score, kind: item.kind });

  const roll = rollOutcome(
    {
      score,
      relation: teacher ? teacher.relation : 0,
      reputation: state.reputation ? state.reputation.value : undefined,
      kind: item.kind,
    },
    preset,
    rng || seededRng(examSeed(opts.seed, item, state.calendar && state.calendar.day)),
  );
  let s = applyOutcome(
    state,
    { examId: item.id, value: roll.value, day: state.calendar.day, reason: roll.reason, check: roll.check },
    preset,
  ).state;

  let divergence = null;
  let external = null;
  if (opts.modelSaid !== undefined && opts.modelSaid !== null && opts.modelSaid !== '') {
    const conflict = resolveConflict(s, { examId: item.id, modelSaid: opts.modelSaid }, preset);
    s = conflict.state;
    divergence = conflict.divergence;
  } else if (opts.dice && roll.reason !== 'auto') {
    const value = externalValue(preset, item.kind, opts.dice);
    if (value) {
      const conflict = resolveConflict(s, { examId: item.id, modelSaid: value, source: 'dice' }, preset);
      s = conflict.state;
      divergence = conflict.divergence;
      external = { source: 'dice', tier: opts.dice.tier, roll: opts.dice.roll ?? null, dc: opts.dice.dc ?? null, value };
    }
  }

  const done = s.exams.items.find((i) => i.id === item.id) || item;

  s = examReputation(s, preset, item, done);
  if (isPassing(preset, done.outcome)) s = settleWorkOff(s, [item.subjectId], preset);
  return {
    state: s,
    exam: {
      examId: item.id, subjectId: item.subjectId, value: done.outcome, reason: roll.reason, check: roll.check,
      ...(external ? { external } : {}),
      ...(awaitingAnnouncement(done) ? { announceOn: done.announceOn } : {}),
    },
    permission,
    divergence,
    applied: true,
  };
}

function sitByStory(state, preset, item, said, dice) {
  let value = said;
  let external = null;
  if (!value && dice) {
    value = externalValue(preset, item.kind, dice);
    if (value) external = { source: 'dice', tier: dice.tier, roll: dice.roll ?? null, dc: dice.dc ?? null, value };
  }
  if (!value) return { state: cloneState(state), exam: null, permission: '', divergence: null, applied: false };

  const score = examScore(state, preset, item);
  const permission = permissionLine(state, preset, { subjectId: item.subjectId, score, kind: item.kind });
  const { state: s, item: done } = narratedOutcome(state, preset, item, value);
  return {
    state: s,
    exam: {
      examId: item.id, subjectId: item.subjectId, value: done.outcome, reason: 'story', check: null,
      ...(external ? { external } : {}),
      ...(awaitingAnnouncement(done) ? { announceOn: done.announceOn } : {}),
    },
    permission,
    divergence: null,
    applied: true,
  };
}

function applyTime(state, text, parsed, mode, preset, opts) {
  let s = state;
  const notes = [];
  const applied = [];
  let held = null;

  let moved = false;
  let unit = null;
  let source = null;
  let via = null;

  const read = readTime(text, {
    mode,
    state: s,
    relative: Boolean(opts.relativeWords),
    markerEvents: parsed.events,
  });
  const hit = read.context;
  const timeEvents = read.marker && !opts.phoneTurn ? read.marker.events : [];
  if (opts.phoneTurn && read.marker && read.marker.events.length) {
    applied.push({ kind: 'time-dropped', reason: 'phone-turn', events: read.marker.events.length });
  }
  const jumpPreset = opts.skip ? opts.skip.preset : preset;

  if (hit && hit.daypart && !hit.day && !hit.time && !hit.relative) {
    s = cloneState(s);
    s.calendar.daypart = hit.daypart;
    applied.push({ kind: 'daypart', source: 'A', daypart: hit.daypart });
  }

  const fromContext = () => {
    if (!hit) return false;

    if (hit.relative) {
      const r = advance(s, hit.relative, preset);
      s = r.state;
      source = 'A';
      via = hit.via || null;
      if (r.applied) {
        moved = true;
        unit = hit.relative.unit;
        s.calendar.source = 'A';
        applied.push({ kind: 'time', source: 'A', unit: hit.relative.unit, n: hit.relative.n, matched: hit.matched });
      } else notes.push(r.reason);
      return true;
    }

    if (!(hit.day || hit.time)) return false;
    const who = hit.source === 'A+' ? 'A+' : 'A';
    const r = setAbsolute(s, { day: hit.day, time: hit.time, daypart: hit.daypart, weekday: hit.weekday }, who, jumpPreset);
    s = r.state;
    source = who;
    via = hit.via || null;
    if (r.applied) {
      moved = true;
      unit = 'absolute';
      applied.push({ kind: 'time', source: who, via, day: hit.day, time: hit.time, matched: hit.matched });
    } else {
      notes.push(r.reason);
      if (r.held && s.calendar.dismissedJump && (s.calendar.dismissedJump.day === r.held.day
        || (r.held.era && s.calendar.dismissedJump.era === r.held.day.slice(0, 4)))) {
        notes.push('дата чата расходится с календарём');
      } else if (r.held) {
        s = cloneState(s);
        delete s.calendar.dismissedJump;
        s.calendar.heldJump = { ...r.held, matched: hit.matched, source: who, via };
        s.calendar.heldJump.skipPolicy = opts.skip ? opts.skip.policy : skipPolicyOf(preset);
        held = s.calendar.heldJump;
        applied.push({ kind: 'time-held', source: who, via, day: r.held.day, jump: r.held.jump });
      }
    }
    return true;
  };

  const fromMarker = () => {
    if (!timeEvents.length) return false;
    for (const ev of timeEvents) {
      const r = advance(s, ev, preset);
      s = r.state;
      if (r.applied) {
        moved = true;
        unit = ev.unit;
        source = 'B';
        via = 'marker';
        applied.push({ kind: 'time', source: 'B', unit: ev.unit, n: ev.n });
      } else {
        source = source || 'B';
        via = via || 'marker';
        notes.push(r.reason);
      }
    }
    return true;
  };

  let spoke = false;
  if (mode === 'marker') spoke = fromMarker();
  else if (mode === 'context') spoke = fromContext();
  else spoke = fromContext() || fromMarker();

  if (!spoke && !opts.phoneTurn) s = noteIdle(s);

  if (moved && ((s.calendar.heldJump && s.calendar.heldJump !== held) || s.calendar.dismissedJump)) {
    s = cloneState(s);
    s.calendar.heldJump = null;
    if (!(s.calendar.dismissedJump && s.calendar.dismissedJump.era)) delete s.calendar.dismissedJump;
  }
  return { state: s, moved, unit, source, via, notes, applied, held };
}

export function sweepAttendance(state, fromDay, fromPos, unit, preset, opts = {}) {
  let s = state;
  const policy = SKIP_POLICIES.includes(opts.policy) ? opts.policy : 'attend';
  const missed = [];
  const effects = { relation: [], reputation: 0, debt: [] };
  if (!unit) return { state: s, missed, effects, summary: null, counted: 0 };
  const sameDay = unit === 'absolute' && s.calendar.day === fromDay;
  const quiet = unit !== 'period' && !sameDay;
  const markOpts = quiet ? { journal: false, montage: true } : {};
  let presentCount = 0;

  const present = (acc, day, from, to) => {
    if (!countsAttendance(acc, day)) return acc;
    for (const item of dayPlan(acc, preset, day)) {
      if (item.index < from || item.index >= to) continue;
      const taken = acc.attendance.records.some(
        (r) => r.day === day && r.subjectId === item.subjectId && r.periodIndex === item.index,
      );
      if (taken) continue;
      const res = mark(acc, { subjectId: item.subjectId, status: 'present', day, periodIndex: item.index }, preset, markOpts);
      acc = res.state;
      presentCount += 1;
      absorb(effects, res.effects);
    }
    return acc;
  };

  if (unit === 'period' || sameDay) {
    if (s.calendar.day === fromDay) {
      s = present(s, fromDay, fromPos, posOf(s, preset));
      return { state: s, missed, effects, summary: null, counted: presentCount };
    }
    s = present(s, fromDay, fromPos, Infinity);
    s = present(s, s.calendar.day, 0, posOf(s, preset));
    return { state: s, missed, effects, summary: null, counted: presentCount };
  }

  const finish = (acc) => {
    const days = isDayStr(fromDay) && isDayStr(acc.calendar.day) ? Math.max(0, dayDiff(fromDay, acc.calendar.day)) : 0;
    const summary = {
      fromDay, toDay: acc.calendar.day, days,
      periods: missed.length + presentCount, missed: missed.length, present: presentCount, policy,
    };
    effects.relation = mergeDeltas(effects.relation);
    if (summary.periods) {
      acc = pushJournal(cloneState(acc), {
        kind: 'attendance',
        text: `jump ${fromDay} -> ${acc.calendar.day}: +${summary.periods} (skip ${summary.missed}, present ${summary.present})`,
        data: { jump: true, ...summary },
      }, preset);
    }
    return { state: acc, missed, effects, summary: summary.days || summary.periods ? summary : null, counted: presentCount };
  };

  for (let day = fromDay; day < s.calendar.day; day = addDays(day, 1)) {
    if (!isStudyDay(preset, day, s)) continue;
    s = present(s, day, day === fromDay ? fromPos : 0, Infinity);
  }
  if (unit === 'absolute' && isStudyDay(preset, s.calendar.day, s)) s = present(s, s.calendar.day, 0, posOf(s, preset));
  return finish(s);
}

function relReason(state, ev, events, missed) {
  const subjects = (state.subjects || [])
    .filter((x) => x.teacherId === ev.teacherId)
    .map((x) => x.id);
  const mine = (id) => subjects.includes(id);
  const text = ev.reason ? { text: ev.reason } : {};

  const grade = events.find((x) => x.kind === 'grade' && mine(x.subjectId));
  if (grade) return { kind: 'grade', subjectId: grade.subjectId, value: String(grade.value), ...text };

  const day = state.calendar && state.calendar.day;
  const exam = ((state.exams && state.exams.items) || [])
    .find((i) => i.outcome && i.day === day && mine(i.subjectId));
  if (exam) return { kind: 'exam', subjectId: exam.subjectId, examId: exam.id, value: String(exam.outcome), ...text };

  const mark = events.find((x) => x.kind === 'attendance' && mine(x.subjectId));
  if (mark) return { kind: mark.status, subjectId: mark.subjectId, ...text };

  const skipped = (missed || []).filter(mine);
  if (skipped.length) return { kind: 'skip', subjectId: skipped[0], count: skipped.length, ...text };

  return ev.reason ? { kind: 'marker', text: ev.reason } : null;
}

const isDayStr = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

function absorb(acc, effects) {
  acc.relation.push(...effects.relation);
  acc.reputation += effects.reputation;
  acc.debt.push(...effects.debt.filter((id) => !acc.debt.includes(id)));
}

function markerText(text) {
  if (typeof text !== 'string' || !text) return null;
  const hits = [...text.matchAll(MARKER_RE)];
  return hits.length ? hits[hits.length - 1][0].trim() : null;
}

function sameWord(a, b) {
  if (a === b) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i >= 6 || (i >= 4 && a.length - i <= 2 && b.length - i <= 2);
}

export function sceneExamId(state, preset, text = '') {
  const queue = sittableExams(state, preset);
  const ids = [...new Set(queue.map((i) => i.subjectId))];
  if (!ids.length) return null;
  const words = String(text).toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я]{4,}/g) || [];
  const score = (id) => {
    const subject = findSubject(state, id);
    const names = [subject && subject.name, ...((subject && subject.aliases) || [])].filter(Boolean);
    return Math.max(0, ...names.map((n) => {
      const ws = String(n).toLowerCase().replace(/ё/g, 'е').match(/[a-zа-я]{4,}/g) || [];
      return ws.length ? ws.filter((w) => words.some((t) => sameWord(w, t))).length / ws.length : 0;
    }));
  };
  const pick = (id) => (queue.find((i) => i.subjectId === id && !i.outcome) || queue.find((i) => i.subjectId === id)).id;
  const ranked = ids.map((id) => ({ id, s: score(id) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (ranked.length) return ranked[1] && ranked[1].s === ranked[0].s ? null : pick(ranked[0].id);
  const other = (state.subjects || []).some((x) => x.id && !ids.includes(x.id) && score(x.id) > 0);
  return ids.length === 1 && !other ? pick(ids[0]) : null;
}

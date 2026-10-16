import { labelFor } from '../core/state.mjs';
import { debts } from '../core/gradebook.mjs';
import { reasonText } from '../core/relations.mjs';
import { dayOfWeek, weekdayShiftOf } from '../core/time.mjs';
import { awaitingAnnouncement, gradeInfo, isPassing, publicView } from '../core/exams.mjs';
import { WEEKDAYS, uiLabels, fill, whereText } from './common.js';
import { todayView } from './today.js';

export function hookNow(state) {
  if (!state || !state.started || !state.calendar) return null;
  const c = state.calendar;
  return {
    started: true,
    day: c.day,
    time: c.precision === 'datetime' && c.time ? c.time : null,
    precision: c.precision,
    weekday: WEEKDAYS[dayOfWeek(c.day, weekdayShiftOf(state))] || '',
  };
}

export function hookToday(state, preset) {
  if (!state || !state.started) return null;
  const v = todayView(state, preset);
  if (v.kind !== 'ok') return null;
  const where = (id) => whereText((state.subjects || []).find((s) => s.id === id));
  const period = v.now ? {
    status: v.now.status,
    ordinal: v.now.ordinal,
    subjectId: v.now.subjectId,
    subject: v.now.name,
    teacher: v.now.teacher,
    start: v.now.start,
    end: v.now.end,
    where: where(v.now.subjectId),
    text: v.now.slotText,
  } : null;
  const next = v.next ? {
    subjectId: v.next.subjectId,
    subject: v.next.name,
    teacher: v.next.teacher,
    day: v.next.day,
    when: v.next.when,
    where: where(v.next.subjectId),
  } : null;
  return {
    day: v.day,
    dateLine: v.dateLine,
    weekday: WEEKDAYS[dayOfWeek(v.day, weekdayShiftOf(state))] || '',
    time: v.time,
    week: v.week,
    weekLine: v.weekLine,
    term: { index: v.termIndex, name: v.termLine || v.termName || '', count: v.termsCount },
    phase: v.phase,
    phaseLabel: v.phaseLabel,
    silent: v.silent,
    silentReason: v.silentReason,
    period,
    next,
  };
}

export function hookSummary(state, preset) {
  if (!state || !state.started) return '';
  const v = todayView(state, preset);
  if (v.kind !== 'ok') return '';
  const U = uiLabels(preset);
  const vocab = (preset && preset.vocab) || {};
  const parts = [];
  if (v.termLine) parts.push(v.termLine);
  parts.push(WEEKDAYS[dayOfWeek(v.day, weekdayShiftOf(state))] || v.dateLine);
  if (v.now && v.now.status === 'now') parts.push(fill(U.slot, { ordinal: v.now.ordinal }));
  else if (v.phase && v.phase !== 'study') parts.push(v.phaseLabel);
  const tails = debts(publicView(state, preset)).length;
  if (tails) parts.push(fill(U.debtsLine, { debtPlural: vocab.debtPlural || 'хвосты', count: tails }));
  return parts.filter(Boolean).join(', ');
}

export const HOOK_JOURNAL_MAX = 50;

export function hookJournal(state, preset, n = 10) {
  if (!state || !Array.isArray(state.journal)) return [];
  const limit = Math.max(0, Math.min(HOOK_JOURNAL_MAX, Number.isFinite(Number(n)) ? Math.floor(Number(n)) : 10));
  if (!limit) return [];
  const findS = (id) => (state.subjects || []).find((s) => s.id === id);
  const subjectName = (id) => (((state.subjects || []).find((s) => s.id === id)) || {}).name || id || '';
  const teacherName = (id) => (([...(state.teachers || []), ...(state.classmates || [])].find((t) => t && t.id === id)) || {}).name || id || '';
  const relLabels = (preset && preset.relations && preset.relations.labels) || [];
  const repLabels = (preset && preset.reputation && preset.reputation.labels) || [];
  const items = (state.exams && state.exams.items) || [];
  const hidden = items.filter(awaitingAnnouncement);
  const secret = (subjectId, day) => hidden.some((i) => i.subjectId === subjectId && (!i.day || i.day === day));
  const why = (reason) => {
    if (!reason) return '';
    if (typeof reason === 'object' && reason.subjectId && secret(reason.subjectId, reason.day || '')
      && reason.value !== undefined) {
      return '';
    }
    return reasonText(reason, state, preset);
  };
  const out = [];
  for (const e of state.journal) {
    const d = e && e.data;
    if (!e || !d || typeof d !== 'object') continue;
    const day = String(e.day || '');
    let row = null;
    switch (e.kind) {
      case 'grade':
        if (d.reason && d.debt === undefined) break;
        if (!d.subjectId || secret(d.subjectId, day)) break;
        if (d.bg && !(findS(d.subjectId)?.grades || []).some((g) => g.bg && g.day === day && g.value === d.value)) break;
        if (d.debt !== undefined) {
          row = { kind: 'debt', subjectId: d.subjectId, subject: subjectName(d.subjectId), debt: Boolean(d.debt) };
        } else if (d.value !== undefined) {
          const info = gradeInfo(preset, d.value);
          row = {
            kind: 'grade', subjectId: d.subjectId, subject: subjectName(d.subjectId),
            value: String(d.value), label: (info && info.label) || String(d.value), passed: isPassing(preset, d.value),
            ...(d.bg ? { bg: true } : {}),
          };
        }
        break;
      case 'attendance':
        if (d.workedOff) {
          row = { kind: 'attendance', subjectId: d.subjectId, subject: subjectName(d.subjectId), status: 'worked' };
        } else if (d.jump) {
          row = { kind: 'attendance-jump', periods: d.periods || 0, missed: d.missed || 0, present: d.present || 0 };
        } else if (d.subjectId && d.status && d.periodIndex !== undefined) {
          row = { kind: 'attendance', subjectId: d.subjectId, subject: subjectName(d.subjectId), status: String(d.status) };
        }
        break;
      case 'rel': {
        if (d.damped || !Number.isFinite(d.from) || !Number.isFinite(d.to)) break;
        const from = labelFor(relLabels, d.from);
        const to = labelFor(relLabels, d.to);
        row = {
          kind: 'relation', teacherId: d.teacherId, teacher: teacherName(d.teacherId),
          from: from || '', to: to || '', changed: Boolean(from && to && from !== to),
          direction: d.to > d.from ? 'up' : d.to < d.from ? 'down' : 'same',
          ...(why(d.reason) ? { reason: why(d.reason) } : {}),
        };
        break;
      }
      case 'reputation': {
        if (!Number.isFinite(d.from) || !Number.isFinite(d.to)) break;
        row = {
          kind: 'reputation',
          from: labelFor(repLabels, d.from) || '', to: labelFor(repLabels, d.to) || '',
          direction: d.to > d.from ? 'up' : d.to < d.from ? 'down' : 'same',
          ...(typeof d.reason === 'string' && d.reason ? { reason: d.reason } : {}),
          ...(d.reason === 'fame' ? { fame: d.delta > 0 ? 'up' : 'down', ...(d.why ? { why: d.why } : {}) } : {}),
        };
        break;
      }
      case 'exam': {
        if (d.private) break;
        const item = items.find((i) => i.id === d.examId);
        const subjectId = d.subjectId || (item && item.subjectId) || '';
        if (d.missed) {
          row = { kind: 'exam-missed', examId: d.examId, subjectId, subject: subjectName(subjectId) };
        } else if (d.modelSaid !== undefined) {
          if (item && item.announced === false) break;
          row = { kind: 'exam-conflict', examId: d.examId, subjectId, subject: subjectName(subjectId), said: String(d.modelSaid), applied: d.applied !== false };
        } else if (d.value !== undefined && d.examId) {
          const info = gradeInfo(preset, d.value);
          row = {
            kind: 'exam', examId: d.examId, subjectId, subject: subjectName(subjectId),
            value: String(d.value), label: (info && info.label) || String(d.value), passed: Boolean(d.passed),
            ...(d.announced ? { announced: true } : {}),
          };
        } else if (d.added) {
          row = { kind: 'exams-scheduled', count: d.added, ...(d.kind ? { examKind: String(d.kind) } : {}) };
        }
        break;
      }
      default:
        break;
    }
    if (row) out.push({ day, ...row });
  }
  return out.slice(-limit);
}

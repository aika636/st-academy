import { addDays, dayOfWeek } from './time.mjs';
import { examMode, awaitingAnnouncement } from './exams.mjs';
import { examAhead } from './engine.mjs';

export const DEFAULT_HORIZON = 3;

export const DEFAULT_LIMIT = 2;

const MAX_HORIZON = 7;

const PRIORITY = { exam: 0, announce: 1 };

export function nearHorizon(preset) {
  const v = Number(preset && preset.limits && preset.limits.nearHorizon);
  if (!Number.isInteger(v) || v < 0) return DEFAULT_HORIZON;
  return Math.min(v, MAX_HORIZON);
}

export function nearLimit(preset) {
  const v = Number(preset && preset.limits && preset.limits.nearEvents);
  return Number.isInteger(v) && v >= 0 ? v : DEFAULT_LIMIT;
}

export function upcomingEvents(state, preset, opts = {}) {
  const today = state && state.calendar && state.calendar.day;
  if (!today) return [];
  const horizon = Number.isInteger(opts.horizon) ? opts.horizon : nearHorizon(preset);
  const limit = Number.isInteger(opts.limit) ? opts.limit : nearLimit(preset);
  if (horizon < 0 || limit <= 0) return [];

  const out = [];

  if (horizon >= 1 && !examMode(state, preset).active) {
    const ahead = examAhead(state, preset, horizon);
    if (ahead) {
      out.push({
        kind: 'exam',
        day: ahead.day,
        days: ahead.days,
        what: ahead.what,
        subjectId: ahead.count === 1 ? ahead.subjectId : null,
        count: ahead.count,
      });
    }
  }

  for (const item of (state.exams && state.exams.items) || []) {
    if (!awaitingAnnouncement(item) || !item.announceOn) continue;
    const days = daysUntil(today, item.announceOn, horizon);
    if (days === null) continue;
    out.push({ kind: 'announce', day: item.announceOn, days, subjectId: item.subjectId });
  }

  return out
    .sort((a, b) => (a.days - b.days) || (PRIORITY[a.kind] - PRIORITY[b.kind]))
    .slice(0, limit);
}

export const weekdayOf = (day) => dayOfWeek(day);

function daysUntil(today, day, horizon) {
  for (let k = 0; k <= horizon; k += 1) if (addDays(today, k) === day) return k;
  return null;
}

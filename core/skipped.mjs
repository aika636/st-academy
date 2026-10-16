import { addDays, diffDays, mondayOf, termAt } from './time.mjs';
import { examKinds, kindWeek } from './exams.mjs';
import { holidaysAhead } from './holidays.mjs';
import { isDay } from './state.mjs';

const MAX_SPAN = 400;

export function eventsInJump(state, preset, fromDay, toDay) {
  if (!isDay(fromDay) || !isDay(toDay)) return [];
  const span = diffDays(fromDay, toDay);
  if (span < 1) return [];
  const last = span > MAX_SPAN ? addDays(fromDay, MAX_SPAN) : toDay;
  const inside = (day) => isDay(day) && day > fromDay && day <= last;
  const found = new Map();
  const put = (key, item) => { if (!found.has(key)) found.set(key, item); };

  const kinds = examKinds(preset);
  for (let n = 1; n <= Math.min(span, MAX_SPAN); n += 1) {
    const at = termAt(preset, state, addDays(fromDay, n));
    if (!at.term) continue;
    const monday = mondayOf(at.term.start);
    if (at.term.examWeeks > 0) {
      const day = addDays(monday, at.term.studyWeeks * 7);
      if (inside(day)) put(`s:${day}`, { type: 'session', day, name: '' });
    }
    for (const k of kinds) {
      const week = kindWeek(k, at.index);
      if (week === null) continue;
      const day = addDays(monday, (week - 1) * 7);
      if (inside(day)) put(`m:${k.id}:${day}`, { type: 'midterm', day, name: String(k.name || k.id) });
    }
  }

  for (const item of (state && state.exams && state.exams.items) || []) {
    if (!inside(item.day) || item.missed || (item.outcome !== null && item.outcome !== undefined && item.outcome !== '')) continue;
    const kind = kinds.find((k) => k.id === item.kind);
    const subject = ((state.subjects || []).find((s) => s.id === item.subjectId) || {}).name || item.subjectId || '';
    put(`e:${item.id}`, { type: 'exam', day: item.day, name: String((kind && kind.name) || item.kind || ''), subject });
  }

  for (const { holiday, day } of holidaysAhead(preset, fromDay, Math.min(span, MAX_SPAN), state)) {
    if (inside(day)) put(`h:${holiday.id}:${day}`, { type: 'holiday', day, name: holiday.name, off: holiday.off === true });
  }

  return [...found.values()].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

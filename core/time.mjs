import { cloneState, isDay, isTime, pushJournal } from './state.mjs';
import { lunarToSolar } from './lunar.mjs';

const STUDY_DAY_LOOKAHEAD = 31;

const DEFAULT_STUDY_WEEKS = 16;

export function parseDay(day) {
  if (day && typeof day === 'object') return { y: day.y, m: day.m, d: day.d };
  if (!isDay(day)) throw new TypeError(`parseDay: «${day}» не в форме ГГГГ-ММ-ДД`);
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) };
}

export function formatDay(parts) {
  if (typeof parts === 'string') return parts;
  const t = Date.UTC(parts.y, parts.m - 1, parts.d);
  return stampToDay(t);
}

export function addDays(day, n) {
  return stampToDay(dayToStamp(day) + Math.trunc(n) * 86400000);
}

export function diffDays(a, b) {
  return Math.round((dayToStamp(b) - dayToStamp(a)) / 86400000);
}

export function dayOfWeek(day, shift = 0) {
  const js = new Date(dayToStamp(day)).getUTCDay();
  const iso = js === 0 ? 7 : js;
  const k = Number.isInteger(shift) ? ((shift % 7) + 7) % 7 : 0;
  return ((iso - 1 + k) % 7) + 1;
}

export function weekdayShiftOf(state) {
  const k = state && state.calendar ? Number(state.calendar.weekdayShift) : 0;
  return Number.isInteger(k) ? ((k % 7) + 7) % 7 : 0;
}

export function weekdayIn(state, day) {
  return dayOfWeek(day, weekdayShiftOf(state));
}

export function mondayOf(day) {
  return addDays(day, 1 - dayOfWeek(day));
}

export function termsOf(preset, state) {
  const cal = (preset && preset.calendar) || {};
  const raw = Array.isArray(cal.terms) && cal.terms.length
    ? cal.terms
    : [{ start: cal.termStart, studyWeeks: cal.studyWeeks, examWeeks: cal.examWeeks, name: cal.termName }];

  const anchor = state && state.calendar ? state.calendar.termStart : null;
  const starts = termStarts(raw, isDay(anchor) ? anchor : null);
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    const t = raw[i] || {};
    const start = starts[i];
    if (!start) continue;
    const studyWeeks = numberOr(t.studyWeeks, DEFAULT_STUDY_WEEKS);
    const examWeeks = numberOr(t.examWeeks, 0);
    out.push({
      index: out.length,
      name: t.name ? String(t.name) : '',
      start,
      studyWeeks,
      examWeeks,
      span: studyWeeks + examWeeks,
      declared: { studyWeeks: t.studyWeeks, examWeeks: t.examWeeks },
    });
  }
  return out;
}

const EARLY_START_DAYS = 21;

function termStarts(raw, anchor) {
  const n = raw.length;
  const md = raw.map((t) => (t && typeof t.start === 'string' && /^\d{2}-\d{2}$/.test(t.start) ? t.start : null));
  const hit = anchor && md.every(Boolean) ? termHit(md, anchor) : null;
  const k = hit ? hit.index : 0;
  const out = new Array(n).fill(null);
  let prev = null;
  for (let i = k; i < n; i += 1) {
    const t = raw[i] || {};
    const start = i === k && anchor ? anchor : absoluteStart(t.start, prev);
    out[i] = start;
    if (start) prev = start;
  }
  let next = out[k];
  for (let i = k - 1; i >= 0 && next; i -= 1) {
    const start = absoluteBefore(md[i] || raw[i].start, next);
    out[i] = start;
    if (start) next = start;
  }
  return out;
}

function termHit(md, anchor) {
  const a = parseDay(anchor);
  const ref = Date.UTC(a.y, a.m - 1, a.d);
  let best = Infinity;
  let hit = { index: 0, day: anchor };
  md.forEach((s, i) => {
    for (const y of [a.y + 1, a.y, a.y - 1]) {
      const dist = (ref - Date.UTC(y, Number(s.slice(0, 2)) - 1, Number(s.slice(3, 5)))) / 86400000;
      if (dist >= -EARLY_START_DAYS && dist < best) { best = dist; hit = { index: i, day: `${String(y).padStart(4, '0')}-${s}` }; }
    }
  });
  return hit;
}

export function runningTermStart(preset, today) {
  const cal = (preset && preset.calendar) || {};
  const terms = Array.isArray(cal.terms) ? cal.terms : [];
  if (terms.length < 2 || !isDay(today)) return '';
  const md = terms.map((t) => (t && typeof t.start === 'string' && /^\d{2}-\d{2}$/.test(t.start) ? t.start : null));
  return md.every(Boolean) ? termHit(md, today).day : '';
}

function absoluteBefore(start, next) {
  if (isDay(start)) return start;
  if (typeof start !== 'string' || !/^\d{2}-\d{2}$/.test(start)) return null;
  const year = parseDay(next).y;
  const same = `${String(year).padStart(4, '0')}-${start}`;
  if (diffDays(same, next) > 0) return same;
  return `${String(year - 1).padStart(4, '0')}-${start}`;
}

function absoluteStart(start, prev) {
  if (isDay(start)) return start;
  if (typeof start !== 'string' || !/^\d{2}-\d{2}$/.test(start)) return null;
  const year = prev ? parseDay(prev).y : new Date().getUTCFullYear();
  const same = `${String(year).padStart(4, '0')}-${start}`;
  if (!prev || diffDays(prev, same) > 0) return same;
  return `${String(year + 1).padStart(4, '0')}-${start}`;
}

export function termAt(preset, state, day = state.calendar.day) {
  const all = termsOf(preset, state);
  let terms = all;
  let years = 0;
  if (all.length) {
    while (years < 400 && diffDays(mondayOf(shiftYears(all[0].start, years + 1)), day) >= 0) years += 1;
    if (years) terms = all.map((t) => ({ ...t, start: shiftYears(t.start, years) }));
  }
  if (!terms.length) {
    return { term: null, index: -1, week: weekIndex(state, day), inside: true, scope: 'in', terms };
  }

  let index = 0;
  for (let i = 1; i < terms.length; i += 1) {
    if (diffDays(mondayOf(terms[i].start), day) >= 0) index = i;
    else break;
  }
  const term = terms[index];
  const week = Math.floor(diffDays(mondayOf(term.start), day) / 7) + 1;
  const inside = week >= 1 && week <= term.span;
  const last = index === terms.length - 1;
  const scope = inside ? 'in' : (week < 1 ? 'before' : (last ? 'after' : 'between'));
  return { term, index, serial: years * terms.length + index, week, inside, scope, terms };
}

export function weekIndex(state, day = state.calendar.day, preset = null) {
  if (preset) {
    const at = termAt(preset, state, day);
    if (at.term) return at.week;
  }
  const base = mondayOf(state.calendar.termStart);
  return Math.floor(diffDays(base, day) / 7) + 1;
}

export function isVacation(preset, day, state = null) {
  const { m, d } = parseDay(day);
  const x = m * 100 + d;
  const inMD = (v) => {
    const from = mdToNumber(v.from);
    const to = mdToNumber(v.to === undefined ? v.from : v.to);
    if (from === null || to === null) return false;
    return from <= to ? x >= from && x <= to : x >= from || x <= to;
  };
  const inRange = (v) => (isFloating(v) ? holidayCoversDay(v, day, state) : inMD(v));
  const vacations = (preset.calendar && preset.calendar.vacations) || [];
  if (vacations.some((v) => v && inRange(v))) return true;
  const holidays = Array.isArray(preset.holidays) ? preset.holidays : [];
  if (holidays.some((h) => h && h.off === true && inRange(h))) return true;
  const events = state && Array.isArray(state.events) ? state.events : [];
  return events.some((e) => e && e.off === true && isDay(e.from) && day >= e.from
    && (e.open === true && !isDay(e.to) ? true : day <= (isDay(e.to) && e.to >= e.from ? e.to : e.from)));
}

export function isStudyDay(preset, day, state = null) {
  if (isVacation(preset, day, state)) return false;
  const days = (preset.week && preset.week.studyDays) || [];
  return days.includes(weekdayIn(state, day));
}

export function phaseOf(preset, state, day = state.calendar.day) {
  if (isVacation(preset, day, state)) return 'vacation';

  const at = termAt(preset, state, day);
  if (!at.inside) return at.scope === 'between' ? 'break' : 'vacation';

  const days = (preset.week && preset.week.studyDays) || [];
  if (!days.includes(weekdayIn(state, day))) return 'weekend';

  if (!at.term) return 'study';
  return at.week <= at.term.studyWeeks ? 'study' : 'exams';
}

export const PRE_EXAMS_DEFAULT = 'последняя неделя перед экзаменами';

export function preExamWord(preset) {
  const w = preset && preset.labels && preset.labels.phases && preset.labels.phases.preExams;
  return typeof w === 'string' && w.trim() ? w.trim() : PRE_EXAMS_DEFAULT;
}

export function preExamWeek(preset, state, day = state.calendar.day) {
  if (phaseOf(preset, state, day) !== 'study') return false;
  const at = termAt(preset, state, day);
  return Boolean(at.term) && at.term.examWeeks > 0 && at.week === at.term.studyWeeks;
}

export function nextStudyDay(preset, day, step = 1, state = null) {
  let cur = day;
  for (let i = 0; i < STUDY_DAY_LOOKAHEAD; i += 1) {
    cur = addDays(cur, step);
    if (isStudyDay(preset, cur, state)) return cur;
  }
  return null;
}

function periodPlural(preset) {
  return String((preset && preset.vocab && preset.vocab.periodPlural) || 'пары');
}

export function bellsOf(preset) {
  const bells = (preset.bells || []).filter((b) => isTime(b.start) && isTime(b.end));
  const limit = numberOr(preset.week && preset.week.periodsPerDay, bells.length);
  return bells.slice(0, Math.max(0, Math.min(limit, bells.length)));
}

export function minutesOf(time) {
  if (!isTime(time)) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

export function timeOf(minutes) {
  const m = ((Math.trunc(minutes) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

export function periodPosition(preset, time) {
  const bells = bellsOf(preset);
  const t = minutesOf(time);
  if (t === null) return 0;
  for (let i = 0; i < bells.length; i += 1) {
    if (t < minutesOf(bells[i].end)) return i;
  }
  return bells.length;
}

export function alignToGrid(state, preset) {
  const next = cloneState(state);
  const cal = next.calendar;
  const bells = bellsOf(preset);
  if (cal.precision !== 'datetime' || !bells.length || !isTime(cal.time)) {
    return { state: next, applied: false, reason: 'сетка звонков не при чём' };
  }

  const idx = periodPosition(preset, cal.time);
  if (idx >= bells.length) {
    return { state: next, applied: false, reason: 'время после последнего звонка — это не пара' };
  }

  const start = bells[idx].start;
  if (start === cal.time && cal.periodIndex === idx) {
    return { state: next, applied: false, reason: 'часы уже стоят по этой сетке' };
  }

  const was = cal.time;
  cal.time = start;
  cal.periodIndex = idx;
  return {
    state: next,
    applied: true,
    reason: `часы привязаны к сетке пресета: ${was} → ${start}`,
  };
}

export function advance(state, event, preset, opts = {}) {
  const next = cloneState(state);
  const unit = event && typeof event.unit === 'string' ? event.unit.toLowerCase() : '';
  const n = event && Number.isFinite(Number(event.n)) ? Math.trunc(Number(event.n)) : NaN;

  if (unit !== 'period' && unit !== 'day' && unit !== 'week') {
    const reason = `неизвестная единица времени «${event && event.unit}»`;
    pushJournal(next, { kind: 'debug', text: reason, data: { event } }, preset);
    return { state: next, applied: false, reason };
  }
  if (!Number.isFinite(n)) {
    const reason = `нечисловой сдвиг «${event && event.n}»`;
    pushJournal(next, { kind: 'debug', text: reason, data: { event } }, preset);
    return { state: next, applied: false, reason };
  }

  if (n < 0 && !opts.allowBack) {
    const reason = `откат календаря назад: ${n} ${unit}`;
    pushJournal(next, { kind: 'debug', text: reason, data: { event } }, preset);
    next.calendar.idle = 0;
    return { state: next, applied: false, reason };
  }

  const limit = preset && preset.limits && preset.limits.maxTimeShift;
  const days = shiftInDays(unit, n, preset);
  if (typeof limit === 'number' && Number.isFinite(limit) && Math.abs(days) > limit) {
    const reason = `сдвиг на ${days} дн. больше потолка в ${limit}`;
    pushJournal(next, { kind: 'debug', text: reason, data: { event, days, limit } }, preset);
    next.calendar.idle = 0;
    return { state: next, applied: false, reason };
  }

  next.calendar.idle = 0;
  next.calendar.source = 'B';

  if (n === 0) {
    return { state: next, applied: true, reason: 'сцена продолжается, время на месте' };
  }

  if (unit === 'day' || unit === 'week') {
    const shift = unit === 'week' ? n * 7 : n;
    next.calendar.day = addDays(next.calendar.day, shift);
    if (next.calendar.precision === 'date') next.calendar.periodIndex = 0;
    next.calendar.moved += 1;
    return { state: next, applied: true, reason: `сдвиг на ${shift} дн.` };
  }

  return advancePeriods(next, n, preset);
}

function shiftInDays(unit, n, preset) {
  if (unit === 'day') return n;
  if (unit === 'week') return n * 7;
  const perDay = bellsOf(preset).length || numberOr(preset && preset.week && preset.week.periodsPerDay, 0);
  if (perDay <= 0) return n;
  return Math.sign(n) * Math.ceil(Math.abs(n) / perDay);
}

function advancePeriods(next, n, preset) {
  const perDay = bellsOf(preset).length || numberOr(preset.week && preset.week.periodsPerDay, 0);
  if (perDay <= 0) {
    const reason = `в пресете нет ни звонков, ни числа: сколько ${periodPlural(preset)} в дне`;
    pushJournal(next, { kind: 'debug', text: reason }, preset);
    return { state: next, applied: false, reason };
  }

  const datetime = next.calendar.precision === 'datetime';
  const from = datetime
    ? periodPosition(preset, next.calendar.time)
    : numberOr(next.calendar.periodIndex, 0);

  let target = from + n;
  if (datetime && n > 0) {
    const bells = bellsOf(preset);
    const t = minutesOf(next.calendar.time);
    const inside = from < bells.length && t !== null && t >= minutesOf(bells[from].start);
    if (!inside) target -= 1;
  }
  let day = next.calendar.day;
  const step = n > 0 ? 1 : -1;

  while (target >= perDay || target < 0) {
    const moved = nextStudyDay(preset, day, step, next);
    if (!moved) {
      const reason = `учебных дней в пресете не нашлось, сдвиг на ${periodPlural(preset)} невозможен`;
      pushJournal(next, { kind: 'debug', text: reason }, preset);
      return { state: next, applied: false, reason };
    }
    day = moved;
    target += target >= perDay ? -perDay : perDay;
  }

  next.calendar.day = day;
  if (datetime) {
    next.calendar.time = bellsOf(preset)[target].start;
    next.calendar.periodIndex = target;
  } else {
    next.calendar.periodIndex = target;
  }
  next.calendar.moved += 1;
  return { state: next, applied: true, reason: `сдвиг на ${n} ${periodPlural(preset)}` };
}

export function setAbsolute(state, at, source, preset, opts = {}) {
  const next = cloneState(state);
  const cal = next.calendar;
  const payload = at || {};

  let day = payload.day === undefined || payload.day === null ? cal.day : payload.day;
  if (!isDay(day)) {
    const reason = `дата «${payload.day}» не в форме ГГГГ-ММ-ДД`;
    pushJournal(next, { kind: 'debug', text: reason, data: { at } }, preset);
    return { state: next, applied: false, reason };
  }

  const rawTime = payload.time === undefined ? null : payload.time;
  if (rawTime !== null && !isTime(rawTime)) {
    const reason = `время «${rawTime}» не в форме ЧЧ:ММ`;
    pushJournal(next, { kind: 'debug', text: reason, data: { at } }, preset);
    return { state: next, applied: false, reason };
  }

  if (payload.day !== undefined && payload.day !== null && !opts.force) {
    const remembered = rememberedYearShift(cal, day);
    if (remembered) day = remembered;
  }
  if (payload.day !== undefined && payload.day !== null && !opts.force) {
    const kept = sameDayOtherYear(cal.day, day);
    if (kept) {
      pushJournal(next, { kind: 'debug', text: `год в ответе (${parseDay(day).y}) не принят: календарь держит свой ${parseDay(kept).y}`, data: { at, source } }, preset);
      day = kept;
    }
  }
  let rebased = false;
  if (payload.day !== undefined && payload.day !== null) {
    const era = eraDrift(next, day);
    if (era && !opts.eraOk && !isFreshCalendar(next) && !opts.force) {
      const reason = `год в ответе (${parseDay(day).y}) далёк от календаря (${parseDay(cal.day).y}): перенос ждёт решения`;
      pushJournal(next, { kind: 'debug', text: reason, data: { at, source } }, preset);
      next.calendar.idle = 0;
      return {
        state: next,
        applied: false,
        reason,
        held: { day, time: rawTime || null, daypart: payload.daypart || null, ...(payload.weekday ? { weekday: payload.weekday } : {}), jump: diffDays(cal.day, day), from: cal.day, era: era.dy },
      };
    }
    const shifted = era && (opts.eraOk || isFreshCalendar(next)) ? reanchoredTerm(next, era) : null;
    if (shifted) {
      const note = `календарь перенесён на эпоху сюжета: ${cal.day} → ${shifted.day}`;
      shiftStateDates(next, era.dy);
      cal.day = shifted.day;
      cal.termStart = shifted.termStart;
      delete cal.yearShift;
      rebased = true;
      pushJournal(next, { kind: 'debug', text: note, data: { at: { ...at }, source } }, preset);
    }
  }

  const sameDay = day === cal.day;
  const time = rawTime !== null ? rawTime : (sameDay ? cal.time : null);

  const back = !rebased && isBackwards(cal, day, rawTime);
  if (back && !opts.force && diffDays(cal.day, day) < -1) {
    const reason = `откат времени назад на ${-diffDays(cal.day, day)} дн.: ${cal.day} → ${day}`;
    pushJournal(next, { kind: 'debug', text: reason, data: { at, source } }, preset);
    next.calendar.idle = 0;
    return {
      state: next,
      applied: false,
      reason,
      held: { day, time: rawTime || null, daypart: payload.daypart || null, ...(payload.weekday ? { weekday: payload.weekday } : {}), jump: diffDays(cal.day, day), from: cal.day },
    };
  }
  if (back && !opts.force) {
    const reason = `откат времени назад: ${[cal.day, cal.time].filter(Boolean).join(' ')} → ${[day, rawTime].filter(Boolean).join(' ')}`;
    pushJournal(next, { kind: 'debug', text: reason, data: { at, source } }, preset);
    next.calendar.idle = 0;
    return { state: next, applied: false, reason };
  }

  if (payload.day !== undefined && payload.day !== null) noteWeekday(next, day, payload.weekday);

  const jump = diffDays(cal.day, day);
  const jumpCap = numberOr(preset && preset.limits && preset.limits.maxForwardJump, 1);
  if (jump > jumpCap && !opts.force && !rebased) {
    const reason = `скачок времени вперёд на ${jump} дн. больше потолка в ${jumpCap}: ${cal.day} → ${day}`;
    pushJournal(next, { kind: 'debug', text: reason, data: { at, source, jump, cap: jumpCap } }, preset);
    next.calendar.idle = 0;
    return {
      state: next,
      applied: false,
      reason,
      held: { day, time: rawTime || null, daypart: payload.daypart || null, ...(payload.weekday ? { weekday: payload.weekday } : {}), jump, from: cal.day },
    };
  }

  cal.day = day;
  cal.time = time;
  cal.precision = time ? 'datetime' : 'date';
  if (payload.daypart !== undefined) cal.daypart = payload.daypart || null;
  else if (!sameDay) cal.daypart = null;
  if (!sameDay) cal.periodIndex = cal.precision === 'date' ? 0 : null;
  cal.idle = 0;
  cal.source = source || 'A';
  cal.moved += 1;

  if (back) {
    const reason = `откат назад применён вручную (${jump} дн.)`;
    pushJournal(next, { kind: 'time', text: reason, data: { at, source } }, preset);
    return { state: next, applied: true, reason };
  }
  return { state: next, applied: true, reason: jump > 0 ? `скачок вперёд на ${jump} дн.` : 'время уточнено' };
}

function noteWeekday(state, day, weekday) {
  const cal = state.calendar;
  const w = Number(weekday);
  if (!Number.isInteger(w) || w < 1 || w > 7) return;
  const current = weekdayShiftOf(state);
  const need = (((w - dayOfWeek(day)) % 7) + 7) % 7;
  if (need === current) {
    delete cal.weekdaySeen;
    return;
  }
  const seen = cal.weekdaySeen && cal.weekdaySeen.shift === need ? numberOr(cal.weekdaySeen.n, 0) : 0;
  if (seen + 1 >= 2) {
    cal.weekdayShift = need;
    delete cal.weekdaySeen;
    pushJournal(state, { kind: 'debug', text: `день недели в истории сдвинут на ${need} (${day} — ${w})`, data: { day, weekday: w } }, null);
    return;
  }
  cal.weekdaySeen = { shift: need, day, n: seen + 1 };
}

const ERA_NEAR = 5;
const ERA_AHEAD = 45;

function sameDayOtherYear(calDay, textDay) {
  const t = parseDay(textDay);
  const c = parseDay(calDay);
  if (t.y === c.y || Math.abs(t.y - c.y) > ERA_NEAR) return null;
  if (Math.abs(diffDays(calDay, textDay)) <= 3) return null;
  for (const y of [c.y, c.y - 1, c.y + 1]) {
    const cand = formatDay({ y, m: t.m, d: t.d });
    if (Math.abs(diffDays(calDay, cand)) <= 3) return cand;
  }
  return null;
}

function eraDrift(state, textDay) {
  const dy = parseDay(textDay).y - parseDay(state.calendar.day).y;
  if (Math.abs(dy) > ERA_NEAR) return { dy };
  if (dy !== 0) {
    const ahead = diffDays(state.calendar.day, shiftYears(textDay, -dy));
    if (ahead > 3 && ahead <= ERA_AHEAD) return { dy };
  }
  return null;
}

function rememberedYearShift(cal, textDay) {
  const dy = Number(cal.yearShift);
  if (!Number.isInteger(dy) || dy === 0) return null;
  const off = parseDay(textDay).y - parseDay(cal.day).y;
  return off === dy || off === dy + 1 ? shiftYears(textDay, -dy) : null;
}

function isFreshCalendar(state) {
  const cal = state.calendar;
  if (numberOr(cal.moved, 0) !== 0) return false;
  return !(state.attendance && Array.isArray(state.attendance.records) && state.attendance.records.length);
}

function reanchoredTerm(state, era) {
  const cal = state.calendar;
  return { day: shiftYears(cal.day, era.dy), termStart: isDay(cal.termStart) ? shiftYears(cal.termStart, era.dy) : cal.termStart };
}

export function shiftYears(day, dy) {
  const { y, m, d } = parseDay(day);
  return formatDay({ y: y + dy, m, d });
}

const DATED_KEYS = new Set(['day', 'since', 'on', 'closedOn', 'from', 'to', 'announceOn', 'skipDay', 'start', 'end']);

export function shiftStateDates(state, dy) {
  if (!state || typeof state !== 'object' || !Number.isInteger(dy) || dy === 0) return 0;
  let n = 0;
  const walk = (node, key) => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => {
        if (v && typeof v === 'object') walk(v, key);
        else if (typeof v === 'string' && DATED_KEYS.has(key) && isDay(v)) { node[i] = shiftYears(v, dy); n += 1; }
      });
      return;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (v && typeof v === 'object') walk(v, k);
      else if (typeof v === 'string' && DATED_KEYS.has(k) && isDay(v)) { node[k] = shiftYears(v, dy); n += 1; }
    }
  };
  for (const k of Object.keys(state)) {
    if (k === 'calendar' || k === 'preset') continue;
    if (state[k] && typeof state[k] === 'object') walk(state[k], k);
  }
  const cal = state.calendar;
  if (cal) {
    if (cal.heldJump && typeof cal.heldJump === 'object') walk(cal.heldJump, 'heldJump');
    if (cal.weekdaySeen && typeof cal.weekdaySeen === 'object') walk(cal.weekdaySeen, 'weekdaySeen');
    if (cal.dismissedJump && typeof cal.dismissedJump === 'object') walk(cal.dismissedJump, 'dismissedJump');
  }
  return n;
}

function isBackwards(cal, day, rawTime) {
  const delta = diffDays(cal.day, day);
  if (delta < 0) return true;
  if (delta > 0) return false;
  if (!rawTime || !cal.time || cal.precision !== 'datetime') return false;
  return minutesOf(rawTime) < minutesOf(cal.time);
}

export function noteIdle(state) {
  const next = cloneState(state);
  next.calendar.idle = numberOr(next.calendar.idle, 0) + 1;
  return next;
}

export function isStalled(state, preset) {
  const limit = numberOr(preset && preset.limits && preset.limits.idleWarnAfter, 10);
  return numberOr(state.calendar.idle, 0) >= limit;
}

const WEEKDAY_NUMBERS = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

export const WEEKDAY_KEYS = Object.keys(WEEKDAY_NUMBERS);

export function isFloating(h) {
  return Boolean(h) && (mdToNumber(h.lunar) !== null || WEEKDAY_NUMBERS[h.weekday] !== undefined
    || (Number.isInteger(h.days) && h.days >= 1));
}

export function holidaySpan(h, year, state = null) {
  if (!h || !Number.isInteger(year) || year < 0 || year > 9999 || mdToNumber(h.from) === null) return null;
  const y4 = (n) => String(n).padStart(4, '0');
  let from = null;
  if (mdToNumber(h.lunar) !== null) from = lunarToSolar(year, Number(h.lunar.slice(0, 2)), Number(h.lunar.slice(3, 5)));
  const solved = from !== null;
  if (!solved) from = `${y4(year)}-${h.from}`;
  if (!isDay(from)) return null;
  const wd = WEEKDAY_NUMBERS[h.weekday];
  if (wd) from = addDays(from, wd - weekdayIn(state, from));
  let to = from;
  if (Number.isInteger(h.days) && h.days >= 1) to = addDays(from, h.days - 1);
  else if (!wd && !solved && mdToNumber(h.to) !== null) {
    to = `${y4(mdToNumber(h.to) < mdToNumber(h.from) ? year + 1 : year)}-${h.to}`;
  }
  return { from, to };
}

export function holidayCoversDay(h, day, state = null) {
  const year = parseDay(day).y;
  for (let y = year - 1; y <= year + 1; y += 1) {
    const span = holidaySpan(h, y, state);
    if (span && day >= span.from && day <= span.to) return true;
  }
  return false;
}

function dayToStamp(day) {
  const { y, m, d } = parseDay(day);
  return Date.UTC(y, m - 1, d);
}

function stampToDay(stamp) {
  const dt = new Date(stamp);
  return `${String(dt.getUTCFullYear()).padStart(4, '0')}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function mdToNumber(md) {
  if (typeof md !== 'string' || !/^\d{2}-\d{2}$/.test(md)) return null;
  return Number(md.slice(0, 2)) * 100 + Number(md.slice(3, 5));
}

const pad2 = (n) => String(n).padStart(2, '0');

function numberOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

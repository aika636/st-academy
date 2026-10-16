import { addDays, holidayCoversDay, holidaySpan, isFloating, isVacation, weekdayShiftOf } from './time.mjs';
import { isDay, pushPending } from './state.mjs';

export const DEFAULT_LEAD = 3;

export const MAX_LEAD = 14;

export const MAX_HOLIDAYS = 40;

export const MAX_EVENTS = 30;

export const EVENT_TEXT_MAX = { name: 80, about: 200, buzz: 200, buzzNear: 200, today: 200, hook: 300 };

export const OPEN_END = '9999-12-31';

export const MAX_PAUSE_DAYS = 366;

export const HOOKS_KEPT = 80;

export const DEFAULT_HOOK_PHRASES = {
  hook: 'Сегодня {name}. Если уместно, можно вплести в сцену: {hook}',
  hookBare: 'Сегодня {name}{note}. Если уместно, пусть праздник мелькнёт в сцене — фоном, без нажима.',
  hookOff: 'Сейчас {name}{note}; занятий нет. Если уместно, пусть это почувствуется в сцене — без нажима.',
};

const isMD = (v) => typeof v === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
const mdNum = (md) => Number(md.slice(0, 2)) * 100 + Number(md.slice(3, 5));
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const capFirst = (v) => (v ? v[0].toUpperCase() + v.slice(1) : v);

export const bare = (v) => str(v).replace(/[\s.,;:!?…]+$/u, '');

export const buzzFor = (h, days) => (days <= 1 && h.buzzNear ? h.buzzNear : h.buzz);

export function holidaysOf(preset, state = null) {
  const raw = preset && Array.isArray(preset.holidays) ? preset.holidays : [];
  const out = [];
  raw.slice(0, MAX_HOLIDAYS).forEach((h, i) => {
    if (!h || typeof h !== 'object' || !str(h.name) || !isMD(h.from)) return;
    out.push({
      ...texts(h),
      id: str(h.id) || `holiday-${i + 1}`,
      from: h.from,
      to: isMD(h.to) ? h.to : h.from,
      ...floating(h, state),
      lead: leadOf(h),
      off: h.off === true,
      dated: false,
    });
  });
  return out;
}

function floating(h, state) {
  if (!isFloating(h)) return {};
  const out = { shift: weekdayShiftOf(state) };
  if (isMD(h.lunar)) out.lunar = h.lunar;
  if (typeof h.weekday === 'string') out.weekday = h.weekday;
  if (Number.isInteger(h.days) && h.days >= 1) out.days = h.days;
  return out;
}

export function vacationsOf(preset, state = null) {
  const raw = preset && preset.calendar && Array.isArray(preset.calendar.vacations) ? preset.calendar.vacations : [];
  const out = [];
  raw.slice(0, MAX_HOLIDAYS).forEach((v, i) => {
    if (!v || typeof v !== 'object' || !isMD(v.from) || !isMD(v.to)) return;
    out.push({
      ...texts({ ...v, name: capFirst(str(v.name) || 'каникулы') }),
      id: str(v.id) || `vacation-${i + 1}`,
      from: v.from,
      to: v.to,
      ...floating(v, state),
      lead: leadOf(v),
      off: true,
      dated: false,
    });
  });
  return out;
}

export function eventsOf(state) {
  const raw = state && Array.isArray(state.events) ? state.events : [];
  const out = [];
  raw.slice(0, MAX_EVENTS).forEach((e, i) => {
    if (!e || typeof e !== 'object' || !str(e.name) || !isDay(e.from)) return;
    const open = e.open === true && !isDay(e.to);
    const to = open ? OPEN_END : isDay(e.to) && e.to >= e.from ? e.to : e.from;
    out.push({
      ...texts(e), id: str(e.id) || `event-${i + 1}`, from: e.from, to, lead: leadOf(e), off: e.off === true, dated: true,
      ...(open ? { open: true } : {}),
      ...(e.pause === true ? { pause: true } : {}),
      ...(e.auto === true ? { auto: true } : {}),
    });
  });
  return out;
}

function texts(h) {
  return {
    name: str(h.name).slice(0, EVENT_TEXT_MAX.name),
    about: str(h.about).slice(0, EVENT_TEXT_MAX.about),
    buzz: str(h.buzz).slice(0, EVENT_TEXT_MAX.buzz),
    buzzNear: str(h.buzzNear).slice(0, EVENT_TEXT_MAX.buzzNear),
    today: str(h.today).slice(0, EVENT_TEXT_MAX.today),
    hook: str(h.hook).slice(0, EVENT_TEXT_MAX.hook),
  };
}

function leadOf(h) {
  return Number.isInteger(h.lead) ? Math.min(Math.max(h.lead, 0), MAX_LEAD) : DEFAULT_LEAD;
}

function allOf(preset, state) {
  const { holidays, vacations } = mergeVacations(holidaysOf(preset, state), vacationsOf(preset, state));
  return [...holidays, ...eventsOf(state), ...vacations];
}

export function mergeVacations(holidays, vacations) {
  const out = holidays.slice();
  const rest = [];
  const pairs = [];
  for (const v of vacations) {
    const i = v.shift !== undefined ? -1 : out.findIndex((h) => !h.dated && h.shift === undefined && sameName(h.name, v.name) && (coversMD(h, v.from) || coversMD(v, h.from)));
    if (i < 0) { rest.push(v); continue; }
    const h = out[i];
    pairs.push({ holiday: holidays[i], vacation: v });
    out[i] = {
      ...h,
      from: coversMD(h, v.from) ? h.from : v.from,
      to: coversMD(h, v.to) ? h.to : v.to,
      about: h.about || v.about,
      buzz: h.buzz || v.buzz,
      buzzNear: h.buzzNear || v.buzzNear,
      today: h.today || v.today,
      hook: h.hook || v.hook,
      off: true,
    };
  }
  return { holidays: out, vacations: rest, pairs };
}

function coversMD(h, md) {
  const x = mdNum(md);
  const from = mdNum(h.from);
  const to = mdNum(h.to);
  return from <= to ? x >= from && x <= to : x >= from || x <= to;
}

function covers(h, day) {
  if (h.dated) return day >= h.from && day <= h.to;
  if (h.shift !== undefined) return holidayCoversDay(h, day, shiftState(h));
  return coversMD(h, day.slice(5));
}

function startsOn(h, day) {
  if (h.dated) return h.from === day;
  if (h.shift !== undefined) {
    const year = Number(day.slice(0, 4));
    for (let y = year - 1; y <= year + 1; y += 1) {
      const span = holidaySpan(h, y, shiftState(h));
      if (span && span.from === day) return true;
    }
    return false;
  }
  return h.from === day.slice(5);
}

const shiftState = (h) => ({ calendar: { weekdayShift: h.shift } });

export function holidaysOn(preset, day, state = null) {
  return allOf(preset, state).filter((h) => covers(h, day));
}

export function holidaysAhead(preset, day, horizon = MAX_LEAD, state = null) {
  const list = allOf(preset, state);
  if (!list.length) return [];
  const out = [];
  const limit = Math.min(Math.max(Math.trunc(Number(horizon) || 0), 0), 366);
  for (let n = 1; n <= limit; n += 1) {
    const at = addDays(day, n);
    for (const h of list) {
      if (!startsOn(h, at) || covers(h, day)) continue;
      out.push({ holiday: h, day: at, days: n });
    }
  }
  return out;
}

export const MAX_PER_DAY = 2;

export function holidayBackground(preset, day, state = null) {
  const now = holidaysOn(preset, day, state).slice(0, MAX_PER_DAY);
  const heard = holidaysAhead(preset, day, MAX_LEAD, state).filter((a) => a.days <= a.holiday.lead);
  const aheadAll = heard.length ? heard.filter((a) => a.day === heard[0].day).slice(0, MAX_PER_DAY) : [];
  return { now, ahead: aheadAll[0] || null, aheadAll };
}

export function holidayDayIndex(h, day) {
  for (let n = 0; n <= 366; n += 1) {
    const back = addDays(day, -n);
    if (startsOn(h, back)) return n;
    if (!covers(h, back)) return null;
  }
  return null;
}

export function occurrenceKey(h, day) {
  const back = holidayDayIndex(h, day);
  return back === null ? null : `${h.id}@${addDays(day, -back)}`;
}

export function holidayEnd(h, day) {
  if (h.open) return day;
  if (h.dated) return h.to;
  let cur = day;
  for (let n = 0; n < 366 && covers(h, addDays(cur, 1)); n += 1) cur = addDays(cur, 1);
  return cur;
}

export function hookText(h, preset) {
  const own = (preset && preset.phrases && preset.phrases.holidays) || {};
  const P = { ...DEFAULT_HOOK_PHRASES, ...own };
  const vars = { name: h.name, hook: h.hook, note: bare(h.today) ? ` — ${bare(h.today)}` : '' };
  const template = h.hook ? P.hook : h.off ? P.hookOff : P.hookBare;
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export function armHolidayHooks(state, preset) {
  if (!state || !state.started || !state.calendar || !isDay(state.calendar.day)) return [];
  const day = state.calendar.day;
  const fired = Array.isArray(state.holidayHooks) ? state.holidayHooks : [];
  const armed = [];
  for (const h of holidaysOn(preset, day, state).slice(0, MAX_PER_DAY)) {
    const key = occurrenceKey(h, day);
    if (!key || fired.includes(key)) continue;
    pushPending(state, { id: `holiday:${key}`, kind: 'holiday', text: hookText(h, preset) });
    armed.push(key);
  }
  if (armed.length) state.holidayHooks = [...fired, ...armed].slice(-HOOKS_KEPT);
  return armed;
}

export function addEvent(state, raw) {
  if (!state || typeof state !== 'object') return { ok: false, error: 'семестра в этом чате нет' };
  const r = raw && typeof raw === 'object' ? raw : {};
  const name = str(r.name).slice(0, EVENT_TEXT_MAX.name);
  if (!name) return { ok: false, error: 'у события нет названия' };
  if (!isDay(r.from)) return { ok: false, error: 'у события нет даты' };
  const to = isDay(r.to) ? r.to : r.from;
  if (to < r.from) return { ok: false, error: 'конец события раньше начала' };
  const list = Array.isArray(state.events) ? state.events : [];
  if (list.length >= MAX_EVENTS) return { ok: false, error: `своих событий уже ${MAX_EVENTS} — уберите прошедшие` };

  const base = `${r.from}-${name.toLowerCase().replace(/[^a-zа-яё0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'event'}`;
  let id = base;
  for (let n = 2; list.some((e) => e && e.id === id); n += 1) id = `${base}-${n}`;

  const event = { id, name, from: r.from };
  if (r.open === true && !isDay(r.to)) event.open = true;
  else if (to !== r.from) event.to = to;
  if (r.pause === true) event.pause = true;
  if (r.auto === true) event.auto = true;
  if (Number.isInteger(r.lead)) event.lead = Math.min(Math.max(r.lead, 0), MAX_LEAD);
  if (r.off === true) event.off = true;
  for (const key of ['about', 'buzz', 'buzzNear', 'today', 'hook']) {
    const v = str(r[key]).slice(0, EVENT_TEXT_MAX[key]);
    if (v) event[key] = v;
  }
  return { ok: true, state: { ...state, events: [...list, event] }, event };
}

export function removeEvent(state, id) {
  const list = state && Array.isArray(state.events) ? state.events : [];
  if (!list.some((e) => e && e.id === id)) return { ok: false, error: 'такого события нет' };
  return { ok: true, state: { ...state, events: list.filter((e) => e && e.id !== id) } };
}

const nameKey = (v) => str(v).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function sharesWord(a, b) {
  const stems = (v) => new Set(nameKey(v).split(' ').filter((w) => w.length >= 5).map((w) => w.slice(0, 5)));
  const x = stems(a);
  return [...stems(b)].some((w) => x.has(w));
}

export function carryEvents(live, before) {
  if (!before || typeof before !== 'object' || !live) return before;
  const mine = (Array.isArray(live.events) ? live.events : []).filter((e) => e && e.auto !== true);
  const kept = (Array.isArray(before.events) ? before.events : []).filter((e) => e && e.auto === true);
  const events = [...kept, ...mine];
  return JSON.stringify(events) === JSON.stringify(before.events || []) ? before : { ...before, events };
}

function sameName(a, b) {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 3 && ` ${long} `.includes(` ${short} `);
}

export function knownEvent(state, preset, name, from, to = from) {
  const last = isDay(to) && to >= from ? to : from;
  for (const e of eventsOf(state)) {
    if (sameName(e.name, name) && e.to >= from && e.from <= last) return e;
  }
  for (const e of eventsOf(state)) {
    if (!e.pause && !sameName(e.name, name) && sharesWord(e.name, name) && addDays(e.from, 3) >= from && e.from <= addDays(last, 3)) return e;
  }
  const others = [...holidaysOf(preset, state), ...vacationsOf(preset, state)];
  for (let day = from; day <= last; day = addDays(day, 1)) {
    const hit = others.find((h) => covers(h, day) && sameName(h.name, name));
    if (hit) return hit;
  }
  return null;
}

export function planEvent(state, preset, ev, day = state && state.calendar && state.calendar.day) {
  const span = eventSpan(ev, day);
  if (!span) return { ok: false, error: 'нет дня сцены' };
  const dup = knownEvent(state, preset, ev.name, span.from, span.to);
  if (dup) return { ok: false, error: `«${ev.name}» уже в планах`, duplicate: dup };
  return addEvent(state, { name: ev.name, from: span.from, to: span.to, auto: true });
}

function eventSpan(ev, day) {
  if (!ev || !isDay(day)) return null;
  return { from: addDays(day, ev.days), to: addDays(day, Number.isInteger(ev.until) ? ev.until : ev.days) };
}

export function alreadyPlanned(state, preset, ev, day, except = []) {
  const span = eventSpan(ev, day);
  if (!span) return false;
  const skip = new Set(except);
  const events = (state && Array.isArray(state.events) ? state.events : []).filter((e) => !(e && skip.has(e.id)));
  return Boolean(knownEvent({ ...state, events }, preset, ev.name, span.from, span.to));
}

export const DEFAULT_PAUSE_NAME = 'Каникулы';

function pauseLast(e) {
  if (e.open === true && !isDay(e.to)) return OPEN_END;
  return isDay(e.to) && e.to >= e.from ? e.to : e.from;
}

export function pausesOf(state) {
  const list = state && Array.isArray(state.events) ? state.events : [];
  return list.filter((e) => e && e.pause === true && e.off === true && isDay(e.from));
}

export function activePause(state, day) {
  if (!isDay(day)) return null;
  return pausesOf(state).find((e) => e.from <= day && pauseLast(e) >= day) || null;
}

export function planPause(state, preset, ev, day = state && state.calendar && state.calendar.day) {
  if (!state || typeof state !== 'object' || !ev || !isDay(day)) return { ok: false, error: 'нет дня сцены' };
  const list = Array.isArray(state.events) ? state.events : [];

  if (ev.end) {
    const cur = activePause(state, day);
    if (!cur) return { ok: false, error: 'идущей приостановки нет' };
    const last = addDays(day, -1);
    if (last < cur.from) {
      return { ok: true, state: { ...state, events: list.filter((e) => e !== cur) }, action: 'close', event: null, prev: cur };
    }
    const closed = { ...cur, to: last };
    delete closed.open;
    if (last === cur.from) delete closed.to;
    return { ok: true, state: { ...state, events: list.map((e) => (e === cur ? closed : e)) }, action: 'close', event: closed, prev: cur };
  }

  const days = Number.isInteger(ev.days) && ev.days > 0 ? Math.min(ev.days, MAX_PAUSE_DAYS) : null;
  const to = days ? addDays(day, days - 1) : null;
  const last = to || OPEN_END;
  const cur = pausesOf(state).find((e) => e.from <= last && pauseLast(e) >= day);
  if (cur) {
    const next = { ...cur, from: cur.from < day ? cur.from : day };
    delete next.to;
    delete next.open;
    if (!to) next.open = true;
    else if (to !== next.from) next.to = to;
    if (JSON.stringify(next) === JSON.stringify(cur)) return { ok: false, error: 'приостановка уже в календаре', duplicate: true };
    return { ok: true, state: { ...state, events: list.map((e) => (e === cur ? next : e)) }, action: 'update', event: next, prev: cur };
  }

  let covered = isVacation(preset, day, state);
  for (let d = day, n = 0; covered && to && d < to && n < MAX_PAUSE_DAYS; d = addDays(d, 1), n += 1) {
    covered = isVacation(preset, addDays(d, 1), state);
  }
  if (covered) return { ok: false, error: 'нерабочие дни уже в календаре', duplicate: true };

  const name = str(ev.name) || DEFAULT_PAUSE_NAME;
  const added = addEvent(state, { name, from: day, to: to || undefined, open: !to, off: true, pause: true, lead: 0, auto: true });
  if (!added.ok) return added;
  return { ok: true, state: added.state, action: 'new', event: added.event, prev: null };
}

export function updateEventDates(state, id, patch) {
  const list = state && Array.isArray(state.events) ? state.events : [];
  const cur = list.find((e) => e && e.id === id);
  if (!cur) return { ok: false, error: 'такого события нет' };
  const p = patch && typeof patch === 'object' ? patch : {};
  const from = isDay(p.from) ? p.from : cur.from;
  const open = p.open === true;
  if (!open && isDay(p.to) && p.to < from) return { ok: false, error: 'конец раньше начала' };
  const next = { ...cur, from };
  delete next.to;
  delete next.open;
  if (open) next.open = true;
  else if (isDay(p.to) && p.to !== from) next.to = p.to;
  return { ok: true, state: { ...state, events: list.map((e) => (e === cur ? next : e)) }, event: next };
}

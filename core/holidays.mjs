// core/holidays — праздники и мероприятия заведения (план, раздел «Сейчас», шаг 1).
//
// Бал, ярмарка, посвящение, турнир — то, что даёт общие сцены и причины
// встречаться. Академия не играет праздник сама: она даёт **фон** (за несколько
// дней до события «академия гудит») и сам день («сегодня Зимний бал»). Это
// атмосфера в строке состояния, а не задание модели.
//
// Список — данные пресета, верхний ключ `holidays`:
//
//   { id: 'winter-ball', name: 'Зимний бал', from: '12-27', to: '12-27',
//     lead: 3, about: 'бал в главном зале перед сессией',
//     buzz: 'все ищут пару и платье', today: 'вечером бал, днём суета' }
//
// - `from`/`to` — `ММ-ДД` без года, как у каникул: праздник повторяется каждый
//   год. `to` не задан — праздник одного дня. Конец раньше начала — диапазон
//   через Новый год (`12-31`…`01-01`).
// - `lead` — за сколько дней до начала праздник слышен в фоне (0–14, по
//   умолчанию 3). Ноль — только в сам день.
// - `about` — что это такое; для панели и для человека, в промпт не идёт.
// - `buzz` — фон перед праздником, `today` — фон в его дни. Оба необязательны:
//   без них в строке только название.
// - `hook` — разовый повод в день праздника («на балу можно…»): одноразовый
//   инжект, который звучит один раз за наступление (`armHolidayHooks`). Нет
//   его — повод всё равно звучит, но мягче: «пусть праздник мелькнёт фоном».
// - `off: true` — в эти дни занятий нет: расписание молчит, прогулов нет, фаза
//   дня — каникулы (`time.isVacation`). Праздник становится каникулами.
//
// Каникулы пресета (`calendar.vacations`) входят в тот же список с `off: true`
// — после праздников, чтобы бал внутри зимних каникул не вытеснялся ими. Так
// их приближение видно на панели и в строке состояния, а первый день даёт
// повод «занятий нет». Праздник и каникулы, которые совпадают и по датам, и по
// имени («Золотая неделя» в обоих списках, «День благодарения» и «каникулы на
// День благодарения»), — одно событие: праздник с `off: true` на общий срок
// (`mergeVacations`). Иначе строка состояния говорила о нём дважды подряд.
//
// Рядом с праздниками пресета живут **свои события чата** (`state.events`):
// та же форма, но с годом — `from`/`to` в виде `ГГГГ-ММ-ДД`. Их заводит
// человек в панели; функции ниже принимают состояние и видят их наравне.
//
// Модуль чистый: пресет и день на входе, список на выходе; единственное
// исключение — `armHolidayHooks`, который, как `pushPending`, правит рабочую
// копию состояния движка. Слова строки состояния — в `prompt.mjs`
// (`DEFAULT_LABELS`), слова повода — здесь, в `DEFAULT_HOOK_PHRASES`.

import { addDays } from './time.mjs';
import { isDay, pushPending } from './state.mjs';

/** За сколько дней праздник слышен по умолчанию. */
export const DEFAULT_LEAD = 3;

/** Потолок `lead`: через две недели праздник — уже не фон, а календарь. */
export const MAX_LEAD = 14;

/** Сколько праздников держит пресет. */
export const MAX_HOLIDAYS = 40;

/** Сколько своих событий держит чат. */
export const MAX_EVENTS = 30;

/** Потолок длины текстов своего события: панель и промпт печатают их как есть. */
export const EVENT_TEXT_MAX = { name: 80, about: 200, buzz: 200, today: 200, hook: 300 };

/** Сколько уже поданных поводов помнит состояние. */
export const HOOKS_KEPT = 80;

/**
 * Разовый повод в день праздника (одноразовый инжект, 3.5). Пресет перекрывает
 * блоком `phrases.holidays`. `hook` — когда у праздника есть свой повод,
 * `hookBare` — когда нет: тогда только «пусть мелькнёт фоном».
 */
export const DEFAULT_HOOK_PHRASES = {
  hook: 'Сегодня {name}. Если уместно, можно вплести в сцену: {hook}',
  hookBare: 'Сегодня {name}{note}. Если уместно, пусть праздник мелькнёт в сцене — фоном, без нажима.',
  hookOff: 'Сейчас {name}{note}; занятий нет. Если уместно, пусть это почувствуется в сцене — без нажима.',
};

const isMD = (v) => typeof v === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
const mdNum = (md) => Number(md.slice(0, 2)) * 100 + Number(md.slice(3, 5));
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const capFirst = (v) => (v ? v[0].toUpperCase() + v.slice(1) : v);

/**
 * Текст без конечной точки и прочих знаков: `buzz` и `today` в пресетах — то
 * с точкой, то без, а строка и повод ставят свою пунктуацию сами. Без этого
 * выходило «…бэнто.. Сегодня» и «руки.;».
 */
export const bare = (v) => str(v).replace(/[\s.,;:!?…]+$/u, '');

/**
 * Праздники пресета в чистом виде: без битых записей, с `to` и `lead`.
 * `id` — данный или по позиции: по нему панель и тосты узнают праздник.
 *
 * @returns {{id: string, name: string, from: string, to: string, lead: number,
 *   about: string, buzz: string, today: string, hook: string, dated: false}[]}
 */
export function holidaysOf(preset) {
  const raw = preset && Array.isArray(preset.holidays) ? preset.holidays : [];
  const out = [];
  raw.slice(0, MAX_HOLIDAYS).forEach((h, i) => {
    if (!h || typeof h !== 'object' || !str(h.name) || !isMD(h.from)) return;
    out.push({
      ...texts(h),
      id: str(h.id) || `holiday-${i + 1}`,
      from: h.from,
      to: isMD(h.to) ? h.to : h.from,
      lead: leadOf(h),
      off: h.off === true,
      dated: false,
    });
  });
  return out;
}

/**
 * Каникулы пресета (`calendar.vacations`) в той же форме, что праздники, с
 * `off: true`. Названия у них бывают не всегда — тогда просто «Каникулы».
 * Название — с заглавной, как у праздников: в пресетах каникулы записаны
 * строчными («зимние каникулы»), и рядом с «Зимним балом» это смотрелось
 * опечаткой.
 */
export function vacationsOf(preset) {
  const raw = preset && preset.calendar && Array.isArray(preset.calendar.vacations) ? preset.calendar.vacations : [];
  const out = [];
  raw.slice(0, MAX_HOLIDAYS).forEach((v, i) => {
    if (!v || typeof v !== 'object' || !isMD(v.from) || !isMD(v.to)) return;
    out.push({
      ...texts({ ...v, name: capFirst(str(v.name) || 'каникулы') }),
      id: str(v.id) || `vacation-${i + 1}`,
      from: v.from,
      to: v.to,
      lead: leadOf(v),
      off: true,
      dated: false,
    });
  });
  return out;
}

/**
 * Свои события чата (`state.events`): «вечеринка у Миражи в субботу». В отличие
 * от праздников пресета они с годом — случаются один раз, — и живут в
 * состоянии чата, поэтому откатываются свайпом вместе с остальным.
 *
 * @returns {Object[]} та же форма, что у `holidaysOf`, с `dated: true`
 */
export function eventsOf(state) {
  const raw = state && Array.isArray(state.events) ? state.events : [];
  const out = [];
  raw.slice(0, MAX_EVENTS).forEach((e, i) => {
    if (!e || typeof e !== 'object' || !str(e.name) || !isDay(e.from)) return;
    const to = isDay(e.to) && e.to >= e.from ? e.to : e.from;
    out.push({ ...texts(e), id: str(e.id) || `event-${i + 1}`, from: e.from, to, lead: leadOf(e), off: e.off === true, dated: true });
  });
  return out;
}

function texts(h) {
  return {
    name: str(h.name).slice(0, EVENT_TEXT_MAX.name),
    about: str(h.about).slice(0, EVENT_TEXT_MAX.about),
    buzz: str(h.buzz).slice(0, EVENT_TEXT_MAX.buzz),
    today: str(h.today).slice(0, EVENT_TEXT_MAX.today),
    hook: str(h.hook).slice(0, EVENT_TEXT_MAX.hook),
  };
}

function leadOf(h) {
  return Number.isInteger(h.lead) ? Math.min(Math.max(h.lead, 0), MAX_LEAD) : DEFAULT_LEAD;
}

/** Всё сразу: праздники пресета, свои события чата и каникулы — последними. */
function allOf(preset, state) {
  const { holidays, vacations } = mergeVacations(holidaysOf(preset), vacationsOf(preset));
  return [...holidays, ...eventsOf(state), ...vacations];
}

/**
 * Праздник и каникулы, совпадающие по датам и по имени, — одно событие:
 * праздник (его слова, id и `lead`) с `off: true` на общий срок обоих. Бал
 * внутри зимних каникул не сливается: имена разные, это два события.
 *
 * @returns {{holidays: Object[], vacations: Object[], pairs: Array<{holiday: Object, vacation: Object}>}}
 *   праздники уже слитые, каникулы — оставшиеся, пары — что с чем слилось
 */
export function mergeVacations(holidays, vacations) {
  const out = holidays.slice();
  const rest = [];
  const pairs = [];
  for (const v of vacations) {
    const i = out.findIndex((h) => !h.dated && sameName(h.name, v.name) && (coversMD(h, v.from) || coversMD(v, h.from)));
    if (i < 0) { rest.push(v); continue; }
    const h = out[i];
    pairs.push({ holiday: holidays[i], vacation: v });
    out[i] = {
      ...h,
      from: coversMD(h, v.from) ? h.from : v.from,
      to: coversMD(h, v.to) ? h.to : v.to,
      about: h.about || v.about,
      buzz: h.buzz || v.buzz,
      today: h.today || v.today,
      hook: h.hook || v.hook,
      off: true,
    };
  }
  return { holidays: out, vacations: rest, pairs };
}

/** Попадает ли `ММ-ДД` в праздник без года — с переходом через Новый год. */
function coversMD(h, md) {
  const x = mdNum(md);
  const from = mdNum(h.from);
  const to = mdNum(h.to);
  return from <= to ? x >= from && x <= to : x >= from || x <= to;
}

/** Попадает ли день в праздник (у праздника пресета — с переходом через Новый год). */
function covers(h, day) {
  if (h.dated) return day >= h.from && day <= h.to;
  return coversMD(h, day.slice(5));
}

/** Начинается ли праздник в этот день. */
function startsOn(h, day) {
  return h.dated ? h.from === day : h.from === day.slice(5);
}

/** Праздники и события, которые идут в этот день. */
export function holidaysOn(preset, day, state = null) {
  return allOf(preset, state).filter((h) => covers(h, day));
}

/**
 * Ближайшие начала праздников после `day` в пределах `horizon` дней —
 * от ближнего к дальнему. Праздник, который уже идёт, сюда не попадает: он в
 * `holidaysOn`.
 *
 * @param {Object} preset
 * @param {string} day
 * @param {number} [horizon]  сколько дней вперёд смотреть, по умолчанию `MAX_LEAD`
 * @param {?Object} [state]   состояние чата — ради своих событий
 * @returns {{holiday: Object, day: string, days: number}[]}
 */
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

/** Сколько праздников одного дня называет строка состояния. */
export const MAX_PER_DAY = 2;

/**
 * Фон для строки состояния: что идёт сегодня и что слышно впереди.
 *
 * Впереди — только то, до чего дней не больше, чем `lead` самого праздника, и
 * только ближайший день: два «академия гудит» о разных днях читаются как шум.
 * Но если в этот день начинаются два события (концерт и бал выпускников), они
 * оба в `aheadAll` — до `MAX_PER_DAY`; `ahead` — первое из них.
 *
 * @returns {{now: Object[], ahead: ?{holiday: Object, day: string, days: number},
 *   aheadAll: Array<{holiday: Object, day: string, days: number}>}}
 */
export function holidayBackground(preset, day, state = null) {
  const now = holidaysOn(preset, day, state).slice(0, MAX_PER_DAY);
  const heard = holidaysAhead(preset, day, MAX_LEAD, state).filter((a) => a.days <= a.holiday.lead);
  const aheadAll = heard.length ? heard.filter((a) => a.day === heard[0].day).slice(0, MAX_PER_DAY) : [];
  return { now, ahead: aheadAll[0] || null, aheadAll };
}

/**
 * Сколько дней праздник уже идёт: 0 — первый день. Нужно панели, чтобы сказать
 * «второй день ярмарки», и ключу повода.
 */
export function holidayDayIndex(h, day) {
  for (let n = 0; n <= 366; n += 1) {
    const back = addDays(day, -n);
    if (startsOn(h, back)) return n;
    if (!covers(h, back)) return null;
  }
  return null;
}

/**
 * Ключ одного наступления праздника: `id@день начала`. Праздник пресета
 * повторяется каждый год, и повод должен прозвучать в каждом — поэтому в ключе
 * день, а не только id.
 */
export function occurrenceKey(h, day) {
  const back = holidayDayIndex(h, day);
  return back === null ? null : `${h.id}@${addDays(day, -back)}`;
}

/**
 * Последний день наступления, в которое попал `day`: «каникулы до 11 января».
 * У праздника пресета года нет, поэтому конец ищется шагом вперёд.
 */
export function holidayEnd(h, day) {
  if (h.dated) return h.to;
  let cur = day;
  for (let n = 0; n < 366 && covers(h, addDays(cur, 1)); n += 1) cur = addDays(cur, 1);
  return cur;
}

/** Текст разового повода словами пресета. */
export function hookText(h, preset) {
  const own = (preset && preset.phrases && preset.phrases.holidays) || {};
  const P = { ...DEFAULT_HOOK_PHRASES, ...own };
  const vars = { name: h.name, hook: h.hook, note: bare(h.today) ? ` — ${bare(h.today)}` : '' };
  const template = h.hook ? P.hook : h.off ? P.hookOff : P.hookBare;
  return String(template).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/**
 * Взвести разовый повод: праздник идёт сегодня, а его повод в этом наступлении
 * ещё не звучал. Повод — одноразовый инжект (`state.pending`), то есть уходит в
 * следующую генерацию один раз; что он уже прозвучал, помнит
 * `state.holidayHooks`, и это часть состояния — свайп, откативший ход, вернёт
 * повод в очередь вместе со снимком.
 *
 * Правит состояние на месте — так же, как `pushPending`: зовётся движком на
 * рабочей копии.
 *
 * @returns {string[]} ключи поводов, взведённых сейчас
 */
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

/**
 * Завести своё событие чата. Чистая функция: новое состояние или причина
 * отказа словами. `id` придумывается по названию и дню, чтобы два одинаковых
 * события в разные дни не слились, а повод каждого прозвучал своим ключом.
 *
 * @param {Object} state
 * @param {{name: string, from: string, to?: string, lead?: number, about?: string,
 *   buzz?: string, today?: string, hook?: string, off?: boolean}} raw
 * @returns {{ok: true, state: Object, event: Object} | {ok: false, error: string}}
 */
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
  if (to !== r.from) event.to = to;
  if (Number.isInteger(r.lead)) event.lead = Math.min(Math.max(r.lead, 0), MAX_LEAD);
  if (r.off === true) event.off = true;
  for (const key of ['about', 'buzz', 'today', 'hook']) {
    const v = str(r[key]).slice(0, EVENT_TEXT_MAX[key]);
    if (v) event[key] = v;
  }
  return { ok: true, state: { ...state, events: [...list, event] }, event };
}

/** Убрать своё событие по id. Чужого id нет — отказ словами, а не тишина. */
export function removeEvent(state, id) {
  const list = state && Array.isArray(state.events) ? state.events : [];
  if (!list.some((e) => e && e.id === id)) return { ok: false, error: 'такого события нет' };
  return { ok: true, state: { ...state, events: list.filter((e) => e && e.id !== id) } };
}

/** Ключ сравнения названий: регистр, «ё» и знаки не важны. */
const nameKey = (v) => str(v).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Одно ли это событие по названию: совпадение или одно целиком внутри другого. */
function sameName(a, b) {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 3 && ` ${long} `.includes(` ${short} `);
}

/**
 * Уже известное событие с тем же названием в те же дни: праздник пресета,
 * каникулы или своё событие чата. Секретарь видит бал в каждом ответе,
 * который о нём упоминает, — записать его надо один раз. Сверяются и имя, и
 * даты: концерт через два дня и концерт через три — разные концерты, и второй
 * молча пропадать не должен.
 *
 * @param {string} from первый день события
 * @param {string} [to] последний; по умолчанию — тот же
 * @returns {?Object} найденное событие или `null`
 */
export function knownEvent(state, preset, name, from, to = from) {
  const last = isDay(to) && to >= from ? to : from;
  for (const e of eventsOf(state)) {
    if (sameName(e.name, name) && e.to >= from && e.from <= last) return e;
  }
  const others = [...holidaysOf(preset), ...vacationsOf(preset)];
  for (let day = from; day <= last; day = addDays(day, 1)) {
    const hit = others.find((h) => covers(h, day) && sameName(h.name, name));
    if (hit) return hit;
  }
  return null;
}

/**
 * Событие в планы из разбора секретаря (`event=+3:бал у Миражи`): день — от
 * дня сцены. Уже известное (`knownEvent`) не дублируется: тогда `ok: false` с
 * `duplicate`.
 *
 * @param {Object} state
 * @param {Object} preset
 * @param {{name: string, days: number, until?: number}} ev событие разборщика
 * @param {string} [day] день сцены; по умолчанию — день календаря
 * @returns {{ok: true, state: Object, event: Object} | {ok: false, error: string, duplicate?: Object}}
 */
export function planEvent(state, preset, ev, day = state && state.calendar && state.calendar.day) {
  const span = eventSpan(ev, day);
  if (!span) return { ok: false, error: 'нет дня сцены' };
  const dup = knownEvent(state, preset, ev.name, span.from, span.to);
  if (dup) return { ok: false, error: `«${ev.name}» уже в планах`, duplicate: dup };
  return addEvent(state, { name: ev.name, from: span.from, to: span.to });
}

/** Дни события разборщика от дня сцены; нет дня — `null`. */
function eventSpan(ev, day) {
  if (!ev || !isDay(day)) return null;
  return { from: addDays(day, ev.days), to: addDays(day, Number.isInteger(ev.until) ? ev.until : ev.days) };
}

/**
 * Записал бы `planEvent` это событие или оно уже в планах — для черновика
 * секретаря, который ещё не сохранён. `except` — id своих событий, которые
 * положил прежний разбор того же ответа: пересохранение снимет их и положит
 * заново, так что дублем они не считаются.
 */
export function alreadyPlanned(state, preset, ev, day, except = []) {
  const span = eventSpan(ev, day);
  if (!span) return false;
  const skip = new Set(except);
  const events = (state && Array.isArray(state.events) ? state.events : []).filter((e) => !(e && skip.has(e.id)));
  return Boolean(knownEvent({ ...state, events }, preset, ev.name, span.from, span.to));
}


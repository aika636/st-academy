// core/time — календарь: период → день → неделя → семестр.
//
// Модуль отвечает на два вопроса: «какое сейчас число» и «можно ли двигать
// календарь тем, что пришло из поста». Расписанием он не занимается — это
// `schedule.mjs`, который стоит поверх и импортирует отсюда арифметику.
//
// Четыре решения, из которых вытекает всё остальное.
//
// 1. **Никаких `Date` наружу.** Дата — строка `ГГГГ-ММ-ДД`, время — `ЧЧ:ММ`
//    (контракт `state.mjs`). Внутри арифметика идёт через `Date.UTC`: это
//    единственный способ считать дни в JS, не завися от часового пояса машины.
//    Локальный `new Date(2024, 8, 1)` у пользовательницы в UTC+3 и на CI в UTC
//    даёт разные сутки при полуночных переходах, и такой баг ловится не тестами,
//    а жалобами.
// 2. **Два источника — две функции.** `advance` берёт относительный сдвиг из
//    метки модели (источник B), `setAbsolute` — распознанную дату из текста
//    (источник A). Проверки у них разные, и сливать их в одну «умную» функцию
//    значит потерять оба набора защит.
// 3. **Защита несимметрична, но не односторонняя** — поправка 4 замера A и
//    правка после живого прогона. Откат назад встречается в 3.8% переходов и
//    почти всегда это ошибка распознавания: не применяем, пишем в журнал.
//    Скачок вперёд — 10.7%, и в пределах суток это нормальная игра (сон, «на
//    следующее утро»): применяем молча, спрашивать про это значит попрошайничать
//    раз на десять постов. А вот прыжок ЧЕРЕЗ сутки молча применять нельзя:
//    источник A читает и чужие инфоблоки соседних расширений, и такой прыжок
//    тащит за собой прогулы и репутацию. Потолок — `limits.maxForwardJump`,
//    по умолчанию сутки; `force` его снимает.
// 4. **Точность не растёт сама.** Календарь либо знает часы (`datetime`), либо
//    только дату (`date`). Если источник дал новую дату без часов, старые часы
//    не переносятся: 08:40 позавчерашней пары ничего не говорят о сегодняшнем
//    дне, а строка состояния по ним бодро объявит «сейчас: химия». Часы
//    сохраняются только тогда, когда день не изменился — там это не догадка.
//
// Все функции чистые: приходящее состояние не правится, возвращается новое.

import { cloneState, isDay, isTime, pushJournal } from './state.mjs';
import { lunarToSolar } from './lunar.mjs';

/** Сколько дней подряд ищем ближайший учебный день, прежде чем сдаться. */
const STUDY_DAY_LOOKAHEAD = 31;

/**
 * Сколько учебных недель у периода, если пресет молчит. Число историческое: до
 * появления `calendar.terms` оно стояло прямо в `phaseOf`, и менять его нельзя —
 * пресет без `calendar` обязан вести себя ровно как раньше.
 */
const DEFAULT_STUDY_WEEKS = 16;

// --- арифметика дат ---------------------------------------------------------

/**
 * Строка `ГГГГ-ММ-ДД` → `{y, m, d}`. Месяц человеческий, с единицы: наружу из
 * модуля номера месяцев уходят только в таком виде, и «сентябрь = 8» —
 * источник ошибок в каждом втором разборе даты.
 *
 * @param {string|{y: number, m: number, d: number}} day
 * @returns {{y: number, m: number, d: number}}
 */
export function parseDay(day) {
  if (day && typeof day === 'object') return { y: day.y, m: day.m, d: day.d };
  if (!isDay(day)) throw new TypeError(`parseDay: «${day}» не в форме ГГГГ-ММ-ДД`);
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) };
}

/** `{y, m, d}` → `ГГГГ-ММ-ДД`. Нормализует перелив: 32 января станет 1 февраля. */
export function formatDay(parts) {
  if (typeof parts === 'string') return parts;
  const t = Date.UTC(parts.y, parts.m - 1, parts.d);
  return stampToDay(t);
}

/** Сдвиг на n суток (n может быть отрицательным). Строка на входе, строка на выходе. */
export function addDays(day, n) {
  return stampToDay(dayToStamp(day) + Math.trunc(n) * 86400000);
}

/** Сколько суток от `a` до `b`: `b − a`. Отрицательное — значит `b` раньше. */
export function diffDays(a, b) {
  return Math.round((dayToStamp(b) - dayToStamp(a)) / 86400000);
}

/**
 * День недели: 1 — понедельник, 7 — воскресенье (ISO, не как у `Date.getUTCDay`).
 * `shift` — сдвиг истории (`calendar.weekdayShift`): в вымышленном году бот
 * называет «24/10/1248, Вторник», а григорианский счёт даёт субботу.
 */
export function dayOfWeek(day, shift = 0) {
  const js = new Date(dayToStamp(day)).getUTCDay();
  const iso = js === 0 ? 7 : js;
  const k = Number.isInteger(shift) ? ((shift % 7) + 7) % 7 : 0;
  return ((iso - 1 + k) % 7) + 1;
}

/** Сдвиг дня недели, принятый в состоянии (0, если не установлен). */
export function weekdayShiftOf(state) {
  const k = state && state.calendar ? Number(state.calendar.weekdayShift) : 0;
  return Number.isInteger(k) ? ((k % 7) + 7) % 7 : 0;
}

/** День недели с учётом сдвига истории этого чата. */
export function weekdayIn(state, day) {
  return dayOfWeek(day, weekdayShiftOf(state));
}

/** Понедельник той недели, в которую попадает день. Опора для нумерации недель. */
export function mondayOf(day) {
  return addDays(day, 1 - dayOfWeek(day));
}

// --- недели и фазы семестра -------------------------------------------------

/**
 * Учебные периоды пресета в абсолютных датах.
 *
 * **Две формы записи, одна внутренняя.** Старая — три скаляра
 * (`calendar.termStart`, `studyWeeks`, `examWeeks`) — описывает ровно один
 * период; новая — `calendar.terms: [{start, studyWeeks, examWeeks, name?}]` —
 * сколько угодно. Выбрана нормализация «скаляры → список из одного элемента», а
 * не миграция пресетов: `ru-university.json` уже уехал в живую таверну, и
 * состояние там ссылается на пресет по id, а не копирует его внутрь (решение 3
 * в шапке `state.mjs`). Обновлённый пресет доедет до уже начатого семестра
 * немедленно, и пресет, потерявший знакомые ключи, сломал бы чужую игру задним
 * числом. Вдобавок один период — честное большинство сеттингов, и заставлять
 * вуз писать список из одного элемента значит брать плату за чужую механику.
 *
 * **Год берётся из состояния, а не из пресета.** В пресете периоды записаны как
 * `ММ-ДД` без года — они повторяются каждый учебный год. Первый период
 * привязывается к `state.calendar.termStart` (тому дню, с которого игрок
 * действительно начал), остальные — к ближайшему году строго после предыдущего
 * периода. Так японский год апрель→март переваливает через Новый год сам, без
 * отдельного поля «а этот триместр в следующем году».
 *
 * @param {Object} preset
 * @param {Object} state
 * @returns {Array<{index: number, name: string, start: string, studyWeeks: number,
 *   examWeeks: number, span: number, declared: {studyWeeks: *, examWeeks: *}}>}
 */
export function termsOf(preset, state) {
  const cal = (preset && preset.calendar) || {};
  const raw = Array.isArray(cal.terms) && cal.terms.length
    ? cal.terms
    : [{ start: cal.termStart, studyWeeks: cal.studyWeeks, examWeeks: cal.examWeeks, name: cal.termName }];

  const anchor = state && state.calendar ? state.calendar.termStart : null;
  const out = [];
  let prev = null;
  for (let i = 0; i < raw.length; i += 1) {
    const t = raw[i] || {};
    const start = i === 0 && isDay(anchor) ? anchor : absoluteStart(t.start, prev);
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
      // Что пресет написал на самом деле: `phaseOf` подставляет умолчания, а
      // «пресет вообще не объявлял длину» — отдельный случай для тех, кто без
      // объявленной длины обязан молчать (остаток дней сессии, `prompt.mjs`).
      declared: { studyWeeks: t.studyWeeks, examWeeks: t.examWeeks },
    });
    prev = start;
  }
  return out;
}

/** `ММ-ДД` → ближайший год строго после `prev`. Готовая дата принимается как есть. */
function absoluteStart(start, prev) {
  if (isDay(start)) return start;
  if (typeof start !== 'string' || !/^\d{2}-\d{2}$/.test(start)) return null;
  const year = prev ? parseDay(prev).y : new Date().getUTCFullYear();
  const same = `${String(year).padStart(4, '0')}-${start}`;
  if (!prev || diffDays(prev, same) > 0) return same;
  return `${String(year + 1).padStart(4, '0')}-${start}`;
}

/**
 * В какой период попадает день и какая это неделя внутри него.
 *
 * Периодом «владеет» последний, чья первая неделя началась не позже дня, —
 * поэтому день между двумя периодами относится к предыдущему, и по нему видно,
 * что тот кончился. Границей служит **понедельник** недели начала, а не сама
 * дата начала: неделя, в которую период начался, — первая целиком (см.
 * `weekIndex`), и считать её принадлежность иначе значило бы получить день,
 * который по номеру недели уже в периоде, а по владельцу — ещё нет.
 *
 * @returns {{term: ?Object, index: number, week: number, inside: boolean,
 *   scope: 'before'|'in'|'between'|'after', terms: Array}}
 */
export function termAt(preset, state, day = state.calendar.day) {
  const terms = termsOf(preset, state);
  if (!terms.length) {
    // Пресета с датами нет вовсе — считать нечего, но и запрещать нечего:
    // календарь просто не знает границ и не мешает игре.
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
  return { term, index, week, inside, scope, terms };
}

/**
 * Номер недели, с единицы. Неделя, в которую попало начало периода, — первая,
 * даже если период начался в четверг: студентка говорит «вторая неделя», имея в
 * виду календарную неделю, а не «прошло 7 дней с первого числа». До начала
 * периода числа нулевые и отрицательные — так `phaseOf` отличает «ещё не
 * началось» от первой недели.
 *
 * **Номер — внутри своего периода, а не сквозной.** Второй триместр начинается с
 * первой недели, а не с двадцатой. Причина в том, что число выходит на экран
 * через шаблон пресета («{week}-я неделя триместра»): сквозной счёт превратил бы
 * его в ложь, которую человеку пришлось бы объяснять, а объяснить «третья
 * неделя второго триместра» не надо никому. Для одного периода обе нумерации
 * совпадают, поэтому старые пресеты ничего не замечают.
 *
 * `preset` необязателен ради вызывающих, у которых его под рукой нет: без него
 * счёт идёт от `state.calendar.termStart`, то есть от первого периода сквозь
 * все следующие — ровно так, как считалось до появления `calendar.terms`.
 *
 * @param {Object} state
 * @param {string} [day]
 * @param {Object} [preset]
 * @returns {number}
 */
export function weekIndex(state, day = state.calendar.day, preset = null) {
  if (preset) {
    const at = termAt(preset, state, day);
    if (at.term) return at.week;
  }
  const base = mondayOf(state.calendar.termStart);
  return Math.floor(diffDays(base, day) / 7) + 1;
}

/**
 * Каникулы заданы в пресете как `ММ-ДД` без года: они повторяются каждый год, а
 * семестр может пересекать новогоднюю границу. Диапазон, у которого конец
 * раньше начала (`12-25`…`01-08`), считается перешагивающим через Новый год.
 *
 * Кроме `calendar.vacations` занятий нет в дни праздников пресета и своих
 * событий чата с флажком `off: true` (`core/holidays.mjs`): «день основания —
 * выходной», «школу закрыли на карантин». Свои события живут в состоянии,
 * поэтому без `state` они не видны — вызывающий, у которого состояние есть,
 * обязан его передать.
 */
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
  // Открытый период (`open: true`, «до отмены») длится с `from` без конца; без
  // флага событие без `to` — один день.
  return events.some((e) => e && e.off === true && isDay(e.from) && day >= e.from
    && (e.open === true && !isDay(e.to) ? true : day <= (isDay(e.to) && e.to >= e.from ? e.to : e.from)));
}

/** Учебный ли день: стоит в `preset.week.studyDays` и не попал в каникулы. */
export function isStudyDay(preset, day, state = null) {
  if (isVacation(preset, day, state)) return false;
  const days = (preset.week && preset.week.studyDays) || [];
  return days.includes(weekdayIn(state, day));
}

/**
 * Фаза семестра. Порядок проверок важен и выбран так, чтобы наружу шло самое
 * информативное слово: каникулы важнее выходного (в субботу на каникулах
 * пользовательнице интересно «каникулы»), выходной важнее сессии (в
 * воскресенье посреди сессии экзамена нет).
 *
 * Границы считаются по своему учебному периоду (`termAt`): `study` до конца
 * `studyWeeks`, дальше `exams` до конца `examWeeks`.
 *
 * **Каникулы бывают двух разных сортов, и их надо различать.** Промежуток между
 * двумя периодами — `break`: год не кончился, впереди ещё триместр, и панель
 * обязана говорить об этом иначе, чем о лете после последнего. Всё, что до
 * первого периода и после последнего, остаётся `vacation` — как и явные
 * диапазоны `calendar.vacations`, которые важнее всего прочего. У пресета с
 * одним периодом `break` не возникает никогда, поэтому старый набор из четырёх
 * слов для него полон.
 *
 * @returns {'study'|'weekend'|'vacation'|'break'|'exams'}
 */
export function phaseOf(preset, state, day = state.calendar.day) {
  if (isVacation(preset, day, state)) return 'vacation';

  const at = termAt(preset, state, day);
  if (!at.inside) return at.scope === 'between' ? 'break' : 'vacation';

  const days = (preset.week && preset.week.studyDays) || [];
  if (!days.includes(weekdayIn(state, day))) return 'weekend';

  if (!at.term) return 'study';
  return at.week <= at.term.studyWeeks ? 'study' : 'exams';
}

/**
 * Ближайший учебный день строго после `day` (или строго до, если `step` = −1).
 * Возвращает null, если за месяц поиска учебного дня не нашлось: пресет с
 * пустыми `studyDays` или каникулы длиннее горизонта — не повод зациклиться.
 */
export function nextStudyDay(preset, day, step = 1, state = null) {
  let cur = day;
  for (let i = 0; i < STUDY_DAY_LOOKAHEAD; i += 1) {
    cur = addDays(cur, step);
    if (isStudyDay(preset, cur, state)) return cur;
  }
  return null;
}

/**
 * Как этот пресет зовёт занятия во множественном числе. Нужно причинам сдвига:
 * они уходят человеку — в отладку и в ответ `/academy-time` («Календарь не
 * сдвинулся: …»), — а «пары» в магической академии там не бывает.
 */
function periodPlural(preset) {
  return String((preset && preset.vocab && preset.vocab.periodPlural) || 'пары');
}

// --- звонки -----------------------------------------------------------------

/** Сетка звонков, обрезанная до `periodsPerDay`: в пресете их обычно больше про запас. */
export function bellsOf(preset) {
  const bells = (preset.bells || []).filter((b) => isTime(b.start) && isTime(b.end));
  const limit = numberOr(preset.week && preset.week.periodsPerDay, bells.length);
  return bells.slice(0, Math.max(0, Math.min(limit, bells.length)));
}

/** `ЧЧ:ММ` → минуты от полуночи. Для сравнения времени внутри суток. */
export function minutesOf(time) {
  if (!isTime(time)) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Минуты от полуночи → `ЧЧ:ММ`. Сутки не переполняются: это забота вызывающего. */
export function timeOf(minutes) {
  const m = ((Math.trunc(minutes) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/**
 * Какая пара «текущая» по часам: первая, которая ещё не кончилась. На перемене
 * это следующая пара, до первого звонка — нулевая, после последней — число,
 * равное количеству пар (день кончился). Различать «идёт» и «перемена» — дело
 * `schedule.currentPeriod`, здесь нужна только позиция для сдвига.
 */
export function periodPosition(preset, time) {
  const bells = bellsOf(preset);
  const t = minutesOf(time);
  if (t === null) return 0;
  for (let i = 0; i < bells.length; i += 1) {
    if (t < minutesOf(bells[i].end)) return i;
  }
  return bells.length;
}

/**
 * Привязать часы календаря к сетке звонков пресета.
 *
 * Нужна ровно в одном месте — при смене пресета на идущем круге. Состояние
 * смену переживает (решение 3 в `state.mjs`), а сетка берётся из активного
 * пресета, и после смены панель показывала две соседние строки с разным
 * временем: в шапке 15:00 — часы, доставшиеся от старой сетки, — а в строке
 * «Сейчас» 14:05, начало той пары, в которую эти 15:00 попадают по новой.
 * Расхождение объяснимое, но человек читает его как поломку.
 *
 * Правило: день и позиция в дне остаются (третья пара остаётся третьей), часы
 * берутся из новых звонков. Смена пресета — явное действие человека, поэтому
 * часам разрешено уехать назад: защита от отката стережёт источники, а не
 * ремонт.
 *
 * Ничего не делается там, где нечего делать: у календаря без часов
 * (`precision: 'date'`) позиция и так считается парами, а у пресета без
 * звонков сетки нет вовсе. Отдельный случай — время после последнего звонка:
 * вечер парой не является, и придумывать ему пару значило бы соврать.
 *
 * @returns {{state: Object, applied: boolean, reason: string}}
 */
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

// --- движение календаря -----------------------------------------------------

/**
 * Относительный сдвиг из метки источника B: `{unit: 'period'|'day'|'week', n}`.
 *
 * `n === 0` — законное «сцена продолжается» (поправка 3 замера B: модель
 * придумала `t=+0` сама и применяла осмысленно). Время не двигается, но простой
 * сбрасывается: источник сработал, календарь не завис, индикатор простоя должен
 * молчать.
 *
 * Неизвестная единица не применяется вовсе — поправка 4 замера B (`t=+night`).
 * Угадывать дешевле не выходит: ошибка стоит один пост, выдуманный день — весь
 * семестр.
 *
 * **Откат назад запрещён по умолчанию** — та же несимметричная защита, что в
 * `setAbsolute` (решение 3 в шапке), и она обязана быть здесь, а не в слое
 * интеграции: правило принадлежит календарю. Источник B ошибается заметно чаще,
 * чем человек чинит календарь руками, поэтому безопасное поведение — умолчание, а
 * `opts.allowBack` — явная просьба вызывающего (ручная правка, отладка, откат
 * свайпом).
 *
 * **Один сдвиг ограничен `preset.limits.maxTimeShift`** (в днях; пары считаются
 * по числу пар в дне). Модель, написавшая `t=+300`, уводит семестр в никуда
 * одним ответом, а стоит эта ошибка ровно столько же, сколько выдуманная
 * единица. Пресет, где поля нет, потолка не имеет.
 *
 * @param {Object} state
 * @param {{unit: string, n: number}} event
 * @param {Object} preset
 * @param {{allowBack?: boolean}} [opts]
 * @returns {{state: Object, applied: boolean, reason: string}}
 */
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

  // Обе защиты ведут себя как отвергнутый откат в `setAbsolute`: сдвиг не
  // применяется, причина уходит наружу и строчкой в отладку, но простой не
  // растёт — источник сработал, календарь не завис, а ошибся.
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
    // Новые сутки — старый счётчик пар недействителен. Часы при точности
    // `datetime` остаются: «через день в это же время» — ровно то, что сказано.
    if (next.calendar.precision === 'date') next.calendar.periodIndex = 0;
    next.calendar.moved += 1;
    return { state: next, applied: true, reason: `сдвиг на ${shift} дн.` };
  }

  return advancePeriods(next, n, preset);
}

/**
 * Сдвиг в сутках — общая мера для потолка. Пары переводятся по числу пар в дне
 * и округляются вверх: полдня — это уже сутки, а не ноль, иначе пресет с
 * потолком в один день пропускал бы `t=+4`.
 */
function shiftInDays(unit, n, preset) {
  if (unit === 'day') return n;
  if (unit === 'week') return n * 7;
  const perDay = bellsOf(preset).length || numberOr(preset && preset.week && preset.week.periodsPerDay, 0);
  if (perDay <= 0) return n;
  return Math.sign(n) * Math.ceil(Math.abs(n) / perDay);
}

/**
 * Сдвиг на пары. Обе точности переливаются в следующий учебный день одинаково:
 * пятая пара в пятницу плюс одна — это первая пара понедельника, а не суббота.
 * Выходные и каникулы при переливе пропускаются, иначе панель показала бы
 * занятие в день, когда заведение закрыто.
 */
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
  // Часы вне пары (до первого звонка, перемена, вечер): `from` — уже ближайшая
  // пара, и «+1 пара» значит именно её. Без этой поправки сдвиг с 08:22 при паре в
  // 09:00 перешагивал её и вставал на следующую.
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

/**
 * Абсолютное время из источника A (или ручной правки).
 *
 * @param {Object} state
 * @param {{day?: string, time?: ?string, daypart?: ?string, weekday?: ?number}} at
 * @param {'A+'|'A'|'B'|'manual'} source
 * @param {Object} preset
 * @param {{force?: boolean}} [opts] `force` снимает защиту от отката — это
 *   ручной сдвиг, человек знает, что делает.
 * @returns {{state: Object, applied: boolean, reason: string,
 *   held?: {day: string, time: ?string, daypart: ?string, jump: number, from: string}}}
 *   `held` — прыжок вперёд, отвергнутый по потолку и придержанный до
 *   подтверждения человеком; см. `limits.maxForwardJump`.
 */
export function setAbsolute(state, at, source, preset, opts = {}) {
  const next = cloneState(state);
  const cal = next.calendar;
  const payload = at || {};

  const day = payload.day === undefined || payload.day === null ? cal.day : payload.day;
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

  // Первое чтение времени в чате с эпохой не из нашего года (фэнтези «1824»,
  // а календарь заведён по сегодняшнему 2026): якорь календаря — просто дата по
  // умолчанию, а не факт сюжета. Иначе каждая дата сюжета была бы «откатом на
  // двести лет», время не двинулось бы никогда (живой прогон 10.10). Якорь
  // переезжает на год текста целиком — месяц и число остаются. Сразу — пока на
  // календаре ничего не построено (время не двигалось, посещаемости нет); а если
  // что-то уже было (круг начат, нажато «+1 занятие»), — когда два ответа подряд
  // назвали один и тот же далёкий год: чат живёт там стабильно, а не мелькнул
  // чужой инфоблок. Разница в год-два — обычный переход через Новый год, её не
  // трогаем.
  if (payload.day !== undefined && payload.day !== null) {
    const era = eraDrift(next, day);
    const shifted = era ? reanchoredTerm(next, era) : null;
    if (shifted) {
      pushJournal(next, { kind: 'debug', text: `календарь перенесён на эпоху сюжета: ${cal.day} → ${shifted.day}`, data: { at, source } }, preset);
      shiftStateDates(next, era.dy);
      cal.day = shifted.day;
      cal.termStart = shifted.termStart;
      delete cal.eraSeen;
    }
  }

  // Часы переносятся со старого дня только тогда, когда день не изменился: там
  // это не догадка, а уже известный факт. На новый день часы не додумываются.
  const sameDay = day === cal.day;
  const time = rawTime !== null ? rawTime : (sameDay ? cal.time : null);

  const back = isBackwards(cal, day, rawTime);
  if (back && !opts.force) {
    const reason = `откат времени назад: ${[cal.day, cal.time].filter(Boolean).join(' ')} → ${[day, rawTime].filter(Boolean).join(' ')}`;
    pushJournal(next, { kind: 'debug', text: reason, data: { at, source } }, preset);
    // Источник всё-таки сработал — календарь не завис, а ошибся. Простой не растёт.
    next.calendar.idle = 0;
    return { state: next, applied: false, reason };
  }

  // Потолок на скачок вперёд — вторая половина защиты 3.2, до сих пор
  // отсутствовавшая. Замер A мерил вперёд «сон и смену сцены», то есть часы, и
  // из этого сделали вывод «вперёд применяем молча в любом размере». Живой
  // прогон показал, чем это кончается: чужой инфоблок соседнего расширения
  // читается источником A как наше время, и прыжок вперёд проходит без единого
  // вопроса — а за ним едут прогулы, репутация и отношения. Откат ловился, а
  // прыжок нет, хотя портит он больше.
  //
  // Потолок в сутках и только для прыжка ЧЕРЕЗ день: «на следующее утро» и
  // ночёвка под ним не ходят вовсе, а месяц вперёд из чужой шапки — ходит.
  // `force` (ручная правка) снимает потолок так же, как снимает запрет отката:
  // человек знает, что делает.
  // День недели метки считается до решения о скачке (баг 85): придержанный прыжок
  // тоже говорит, как в этой истории зовутся дни, и два таких ответа сдвиг ставят.
  if (payload.day !== undefined && payload.day !== null) noteWeekday(next, day, payload.weekday);

  const jump = diffDays(cal.day, day);
  const jumpCap = numberOr(preset && preset.limits && preset.limits.maxForwardJump, 1);
  if (jump > jumpCap && !opts.force) {
    const reason = `скачок времени вперёд на ${jump} дн. больше потолка в ${jumpCap}: ${cal.day} → ${day}`;
    pushJournal(next, { kind: 'debug', text: reason, data: { at, source, jump, cap: jumpCap } }, preset);
    // Как и у отвергнутого отката: источник сработал, календарь не завис.
    next.calendar.idle = 0;
    // Прыжок не выбрасывается, а придерживается: отвергнуть его молча значило бы
    // разойтись с видимым текстом поста, чего 3.2 не разрешает. Кто его придержал,
    // тот и показывает человеку — панель спросит «принять?» одной кнопкой.
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
  // Скачок вперёд применяется молча: 10.7% переходов в живых чатах — это сон и
  // смена сцены, а не сбой (замер A). В журнал он не пишется, чтобы не забить
  // кольцо; наружу уходит причина, панель покажет «+N дней».
  return { state: next, applied: true, reason: jump > 0 ? `скачок вперёд на ${jump} дн.` : 'время уточнено' };
}

/**
 * День недели из метки даты против календарного. В вымышленном году (1248)
 * бот пишет «24/10/1248, Вторник», а григорианский счёт даёт субботу; расписание
 * зависит от дня недели, поэтому календарь идёт в ногу с историей. Сдвиг
 * (`calendar.weekdayShift`) ставится, когда два ответа подряд называют один и тот
 * же сдвиг (`calendar.weekdaySeen`): одиночная ошибка модели его не двигает.
 * Совпадение гасит счётчик. Состояние откатывается свайпом вместе со снимком.
 */
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

/**
 * Далёкий год текста относительно календаря: `{dy, stable}` или `null`, если
 * разница меньше двух лет. Заодно ведёт счёт подряд идущих ответов с одним и тем
 * же далёким годом (`calendar.eraSeen`): второй такой ответ — `stable`. Год
 * рядом с календарным счётчик гасит.
 */
function eraDrift(state, textDay) {
  const cal = state.calendar;
  const year = parseDay(textDay).y;
  const dy = year - parseDay(cal.day).y;
  if (Math.abs(dy) < 2) {
    delete cal.eraSeen;
    return null;
  }
  const seen = cal.eraSeen && cal.eraSeen.year === year ? numberOr(cal.eraSeen.n, 0) : 0;
  cal.eraSeen = { year, n: seen + 1 };
  return { dy, stable: seen + 1 >= 2 };
}

/**
 * Новые `{day, termStart}` для календаря, живущего в году, далёком от года даты
 * сюжета: либо ещё ничего не переживший, либо с далёким годом текста два ответа
 * подряд (`eraDrift`); иначе `null`. См. `setAbsolute`.
 */
function reanchoredTerm(state, era) {
  const cal = state.calendar;
  const dy = era.dy;
  if (!era.stable) {
    if (numberOr(cal.moved, 0) !== 0) return null;
    if (state.attendance && Array.isArray(state.attendance.records) && state.attendance.records.length) return null;
  }
  return { day: shiftYears(cal.day, dy), termStart: isDay(cal.termStart) ? shiftYears(cal.termStart, dy) : cal.termStart };
}

/** Та же дата на `dy` лет дальше. 29 февраля в невисокосном году станет 1 марта: нормализует formatDay. */
function shiftYears(day, dy) {
  const { y, m, d } = parseDay(day);
  return formatDay({ y: y + dy, m, d });
}

/** Ключи с датами `ГГГГ-ММ-ДД` в состоянии: лента, сюжетики, молва, журнал, посещаемость, оценки, сессия. */
const DATED_KEYS = new Set(['day', 'since', 'on', 'closedOn', 'from', 'to', 'announceOn', 'skipDay', 'start', 'end']);

/**
 * Переезд календаря на год сюжета (баг 80): все даты, привязанные к старому
 * календарю, едут на ту же разницу лет. Иначе сюжетик «Мабон» с датой 2026-09-21
 * при календаре 1248-10 не закрылся бы никогда, а посты ленты остались бы
 * подписаны сентябрём. Правит переданное состояние; сам `calendar.day` и
 * `termStart` не трогает — их сдвигает вызывающий.
 *
 * @param {Object} state
 * @param {number} dy разница в годах
 * @returns {number} сколько дат сдвинуто
 */
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
    // Календарь сдвигает вызывающий; пресет, если он лежит в состоянии, — справочник, не история.
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

/**
 * Откат ли это назад. Дата без часов на тот же день откатом не считается:
 * источник просто не назвал время, новой информации о часах нет.
 */
function isBackwards(cal, day, rawTime) {
  const delta = diffDays(cal.day, day);
  if (delta < 0) return true;
  if (delta > 0) return false;
  if (!rawTime || !cal.time || cal.precision !== 'datetime') return false;
  return minutesOf(rawTime) < minutesOf(cal.time);
}

// --- индикатор простоя ------------------------------------------------------

/** Ни один источник не сработал в ответе. Сам по себе времени не двигает (3.2). */
export function noteIdle(state) {
  const next = cloneState(state);
  next.calendar.idle = numberOr(next.calendar.idle, 0) + 1;
  return next;
}

/** Время стоит дольше, чем `preset.limits.idleWarnAfter` ответов подряд. */
export function isStalled(state, preset) {
  const limit = numberOr(preset && preset.limits && preset.limits.idleWarnAfter, 10);
  return numberOr(state.calendar.idle, 0) >= limit;
}

// --- плавающие даты праздников ----------------------------------------------

const WEEKDAY_NUMBERS = { mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6, sun: 7 };

/** Названия дней недели для поля праздника `weekday`. */
export const WEEKDAY_KEYS = Object.keys(WEEKDAY_NUMBERS);

/**
 * Дата праздника зависит от года: по лунному календарю (`lunar: "08-15"`), на
 * день недели (`weekday: "sat"`) или с длительностью (`days`). Остальные
 * праздники — просто `ММ-ДД`…`ММ-ДД` каждый год.
 */
export function isFloating(h) {
  return Boolean(h) && (mdToNumber(h.lunar) !== null || WEEKDAY_NUMBERS[h.weekday] !== undefined
    || (Number.isInteger(h.days) && h.days >= 1));
}

/**
 * Дни праздника или каникул, начавшихся в году `year`: `{from, to}` полными
 * датами.
 *
 * - `lunar` — `ММ-ДД` китайского лунного календаря; год вне таблицы
 *   (выдуманный 1248) падает на запасную фиксированную `from`;
 * - `weekday` (`mon`…`sun`) — `from` лишь указывает неделю (пн–вс), а
 *   праздник выпадает на этот день недели. Недели считаются по дням недели
 *   чата (`weekdayIn`): у выдуманного года они свои;
 * - `days` — длительность в днях от начала; иначе конец — `to` (через Новый
 *   год, если раньше начала), а у лунного без `days` и у недельного — один день.
 *
 * @returns {?{from: string, to: string}} `null`, если даты нет
 */
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

/** Попадает ли день в праздник с плавающей датой. Смотрит наступления соседних лет: они перешагивают Новый год. */
export function holidayCoversDay(h, day, state = null) {
  const year = parseDay(day).y;
  for (let y = year - 1; y <= year + 1; y += 1) {
    const span = holidaySpan(h, y, state);
    if (span && day >= span.from && day <= span.to) return true;
  }
  return false;
}

// --- мелочи -----------------------------------------------------------------

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

// core/schedule — сетка недели и ответ на вопрос «что сейчас идёт».
//
// Три решения, объясняющие форму модуля.
//
// 1. **Раскладка детерминированная, без случайности.** `buildSchedule` при
//    одних и тех же предметах и пресете всегда даёт одну и ту же сетку. Причина
//    не в чистоте ради чистоты: расписание строится один раз при старте
//    семестра, но пересобирается при добавлении предмета и при импорте
//    состояния, и «случайное» расписание в этот момент перетасовалось бы у
//    пользовательницы под руками. Плюс так сетку можно проверить тестом, а не
//    глазами.
// 2. **Две точности времени разведены по веткам** (3.2). При `datetime` текущая
//    пара определяется сеткой звонков пресета, при `date` — счётчиком
//    `calendar.periodIndex`, который двигает `t=+1`. Общего кода у веток почти
//    нет, и попытка их слить даёт функцию, которая при отсутствии часов
//    придумывает часы.
// 3. **В несобытийные дни возвращается пусто, а не «ближайшее похожее».**
//    Выходной, каникулы и сессия — дни, когда пар нет. Панель, которая в
//    субботу бодро показывает «сейчас: химия», хуже панели, которая молчит.
//    Сессия сюда включена сознательно: занятия к ней уже кончились, экзамены
//    ведёт `exams.mjs` по своему расписанию, и подставлять на их место
//    лекционную сетку нельзя.

import { findSubject, teacherOfSubject } from './state.mjs';
import { addDays, bellsOf, dayOfWeek, isStudyDay, minutesOf, phaseOf, periodPosition } from './time.mjs';

/** Горизонт поиска следующей пары в днях: две недели, дальше искать бессмысленно. */
const NEXT_LOOKAHEAD = 14;

/**
 * Разложить предметы по учебным дням недели.
 *
 * Раскладка — обход по кругу в порядке «день за днём, пара за парой»: слот
 * (день d, пара p) получает предмет номер `(d * пар_в_дне + p) mod N`. Обход
 * именно в таком порядке, а не «пара за парой по всем дням», потому что при
 * втором один и тот же предмет садится в один день на все пары, когда число
 * предметов кратно числу учебных дней. При этом обходе, пока предметов не
 * меньше, чем пар в дне, повторов внутри дня не возникает вовсе, а числа пар у
 * разных предметов различаются не больше чем на одну.
 *
 * @param {Array<{id: string}>} subjects
 * @param {Object} preset
 * @param {{periodsPerDay?: number, studyDays?: number[], offset?: number}} [opts]
 * @returns {Object<string, string[]>} день недели `'1'`…`'7'` → id предметов по порядку
 */
export function buildSchedule(subjects, preset, opts = {}) {
  const ids = (subjects || []).map((s) => (typeof s === 'string' ? s : s && s.id)).filter(Boolean);
  const days = (opts.studyDays || (preset.week && preset.week.studyDays) || []).slice().sort((a, b) => a - b);
  const perDay = Math.max(0, Math.trunc(opts.periodsPerDay ?? (preset.week && preset.week.periodsPerDay) ?? 0));

  const out = {};
  if (!ids.length || !days.length || !perDay) {
    for (const d of days) out[String(d)] = [];
    return out;
  }

  let k = Math.trunc(opts.offset || 0);
  for (const d of days) {
    const row = [];
    for (let p = 0; p < perDay; p += 1) {
      row.push(ids[((k % ids.length) + ids.length) % ids.length]);
      k += 1;
    }
    out[String(d)] = row;
  }
  return out;
}

/**
 * Что стоит в этот день. В выходной, на каникулах и в сессию — пустой массив
 * (см. решение 3 в шапке).
 *
 * @returns {Array<{index: number, subjectId: string, name: string, teacherId: ?string,
 *   start: ?string, end: ?string}>}
 */
export function dayPlan(state, preset, day = state.calendar.day) {
  if (!isStudyDay(preset, day, state)) return [];
  if (phaseOf(preset, state, day) !== 'study') return [];

  const row = state.schedule ? state.schedule[String(dayOfWeek(day))] : null;
  if (!Array.isArray(row) || !row.length) return [];

  // Пар в дне не больше, чем мест в сетке пресета: строка расписания могла
  // остаться от прежнего пресета, где пар было шесть, а у нового пять звонков.
  // Лишняя пара без времени показывалась номером «6», а часы и `t=+1` до неё
  // всё равно не доходят (`time.advancePeriods` считает по тем же звонкам).
  const bells = bellsOf(preset);
  const perDay = preset.week && Number.isInteger(preset.week.periodsPerDay) ? preset.week.periodsPerDay : 0;
  const slots = bells.length || perDay || row.length;
  const out = [];
  for (let i = 0; i < Math.min(row.length, slots); i += 1) {
    const subjectId = row[i];
    if (!subjectId) continue; // дырка в сетке — законное «окно», не пара
    const subject = findSubject(state, subjectId);
    const teacher = teacherOfSubject(state, subjectId);
    out.push({
      index: i,
      subjectId,
      name: (subject && subject.name) || subjectId,
      teacherId: teacher ? teacher.id : (subject && subject.teacherId) || null,
      start: bells[i] ? bells[i].start : null,
      end: bells[i] ? bells[i].end : null,
    });
  }
  return out;
}

/**
 * Какая пара сейчас. `status`:
 * - `now` — идёт, `index` её;
 * - `break` — перемена, `index` той, что вот-вот начнётся;
 * - `before` — до первой пары, `index` первой;
 * - `after` — после последней, `index` последней (она уже прошла).
 *
 * Момент ровно в `start` считается началом пары, ровно в `end` — уже переменой:
 * звонок с урока звенит один раз, и попадание в обе пары сразу дало бы «сейчас
 * химия и физика».
 *
 * @returns {{index: number, subjectId: string, status: 'now'|'break'|'before'|'after'}|null}
 */
export function currentPeriod(state, preset) {
  const plan = dayPlan(state, preset);
  if (!plan.length) return null;

  const first = plan[0];
  const last = plan[plan.length - 1];

  if (state.calendar.precision === 'datetime') {
    const t = minutesOf(state.calendar.time);
    if (t === null) return null;
    for (const item of plan) {
      if (item.start === null || item.end === null) continue;
      if (t < minutesOf(item.start)) {
        // Раньше этой пары и позже всех предыдущих: либо утро, либо перемена.
        return { index: item.index, subjectId: item.subjectId, status: item === first ? 'before' : 'break' };
      }
      if (t < minutesOf(item.end)) return { index: item.index, subjectId: item.subjectId, status: 'now' };
    }
    return { index: last.index, subjectId: last.subjectId, status: 'after' };
  }

  // Точность `date`: часов нет, пары переключаются событием `t=+1`.
  const idx = Number.isFinite(state.calendar.periodIndex) ? state.calendar.periodIndex : null;
  if (idx === null || idx < first.index) {
    return { index: first.index, subjectId: first.subjectId, status: 'before' };
  }
  const hit = plan.find((p) => p.index === idx);
  if (hit) return { index: hit.index, subjectId: hit.subjectId, status: 'now' };
  if (idx > last.index) return { index: last.index, subjectId: last.subjectId, status: 'after' };
  // Счётчик попал в «окно» между парами — ближайшая следующая, это перемена.
  const upcoming = plan.find((p) => p.index > idx) || last;
  return { index: upcoming.index, subjectId: upcoming.subjectId, status: 'break' };
}

/**
 * Ближайшая следующая пара — сегодняшняя оставшаяся или в один из следующих
 * дней. Горизонт поиска ограничен двумя неделями: если за две недели пары не
 * нашлось, значит семестр кончился или расписание пустое, и честнее вернуть
 * null, чем показывать пару в следующем году.
 *
 * @returns {{day: string, index: number, subjectId: string}|null}
 */
export function nextPeriod(state, preset) {
  const today = dayPlan(state, preset);
  if (today.length) {
    const cur = currentPeriod(state, preset);
    // «Идёт» — следующая та, что за ней; «перемена»/«до первой» — та самая,
    // на которую мы уже смотрим; «после последней» — искать в другом дне.
    if (cur && cur.status !== 'after') {
      const after = cur.status === 'now'
        ? today.find((p) => p.index > cur.index)
        : today.find((p) => p.index >= cur.index);
      if (after) return { day: state.calendar.day, index: after.index, subjectId: after.subjectId };
    }
  }

  for (let i = 1; i <= NEXT_LOOKAHEAD; i += 1) {
    const day = addDays(state.calendar.day, i);
    const plan = dayPlan(state, preset, day);
    if (plan.length) return { day, index: plan[0].index, subjectId: plan[0].subjectId };
  }
  return null;
}

/**
 * Вся неделя, в которую попадает текущий день, — для вкладки «Неделя».
 * Ключи всегда все семь: пустой выходной в сетке нужен, иначе на узком экране
 * список дней поедет и суббота встанет на место среды.
 *
 * @returns {Object<string, Array>} день недели `'1'`…`'7'` → как в `dayPlan`
 */
export function weekGrid(state, preset) {
  const monday = addDays(state.calendar.day, 1 - dayOfWeek(state.calendar.day));
  const out = {};
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(monday, i);
    out[String(i + 1)] = dayPlan(state, preset, day);
  }
  return out;
}

/** Пара по её месту в дне: то же, что `dayPlan(...)[i]`, но с проверкой «окон». */
export function periodAt(state, preset, day, index) {
  return dayPlan(state, preset, day).find((p) => p.index === index) || null;
}

/** Позиция по часам без обращения к расписанию — реэкспорт для панели и отладки. */
export { periodPosition };

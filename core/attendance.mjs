// core/attendance — посещаемость: кто был, кто прогулял, кто опоздал.
//
// Без этого расписание — справочник: оно ни к чему не обязывает, и нарушить его
// нельзя (3.4). Поэтому пропуск здесь не запись в таблице, а событие с тремя
// последствиями сразу: отношение конкретного преподавателя вниз, хвост по предмету,
// репутация вниз.
//
// Главное архитектурное решение: **эффекты считаются здесь, а применяются снаружи**.
// Прогул трогает и relations.mjs, и reputation.mjs, и зачётку; если импортировать их
// отсюда, а из reputation.mjs — обратно посмотреть на прогулы, получится кольцо
// импортов, которое разваливается при первой же попытке протестировать модуль
// отдельно. Поэтому `mark()` возвращает `effects` — список того, что нужно сделать, —
// и вызывающий слой применяет их теми модулями, которым они принадлежат.
//
// **Прогул — только прямой факт.** Календарь молчаливых прогулов больше не выводит:
// скачок времени засчитывает пары посещёнными (`engine.skipPolicyOf`), а прогул
// приходит меткой `skip=`. `inferMissed()` ниже остался как инструмент ядра для
// тестов и будущих ручных правок, движок его не зовёт.
//
// Второе решение: **уважительная причина ставится только руками**. `inferMissed()`
// выводит пропуски из календаря — пара по расписанию прошла, записи о ней нет,
// значит прогул, — но никогда не ставит `excused`. Отличить «болела» от «проспала»
// по тексту сцены нельзя, а ошибка в эту сторону обесценивает всю механику: если
// прогул иногда прощается сам, бояться его перестают.

import { cloneState, findSubject, teacherOfSubject, pushJournal, isDay } from './state.mjs';
import { diffDays } from './time.mjs';

/** Допустимые отметки. Ключи, а не слова языка: перевод живёт в интерфейсе. */
export const STATUSES = ['present', 'skip', 'late', 'excused'];

/** Пустые эффекты — форма, на которую опирается вызывающий слой. */
const noEffects = () => ({ relation: [], reputation: 0, debt: [] });

/**
 * Считается ли этот день по посещаемости вообще.
 *
 * Ровно одно исключение: **сутки, в которые семестр заведён**. Семестр заводят
 * не в полночь: анкету заполняют днём, а `termStart` — это дата, а не момент.
 * Поэтому первый же ответ модели («настало утро второго сентября») формально
 * оставляет позади целый учебный день, которого не было ни у кого: сцена в нём
 * не происходила, расширение в нём не работало. На живом прогоне
 * (`etap-live.md`) это стоило четырёх прогулов, репутации 50 → 34 и
 * единственного преподавателя, проехавшего «ровно → ненавидит» за один ответ.
 *
 * Правило узкое намеренно: не «первый день семестра прощается», а «день
 * заведения не обсчитывается». Дальше календарь работает как раньше — прыжок
 * через неделю выведет прогулы за все дни, кроме этого одного.
 *
 * Отметку **руками** (`mark()` из метки или из панели) это не трогает: там
 * пропуск не выведен из молчания календаря, а назван вслух, и выбрасывать
 * названное было бы уже враньём.
 *
 * @param {Object} state
 * @param {string} day `ГГГГ-ММ-ДД`
 * @returns {boolean}
 */
export function countsAttendance(state, day) {
  const start = state && state.calendar && state.calendar.termStart;
  if (!isDay(start) || !isDay(day)) return true;
  return day !== start;
}

/**
 * Отметить пару.
 *
 * @param {Object} state
 * @param {{subjectId: string, status: string, day?: string, periodIndex?: ?number}} ev
 * @param {Object} preset
 * @param {{journal?: boolean}} [opts] `journal: false` — строку в журнал не писать:
 *   так отмечает развёртка прыжка (`engine.sweepAttendance`), которая пишет одну
 *   сводную строку на весь прыжок вместо строки на каждую пару (9.4.4)
 * @returns {{state: Object, effects: {relation: Array<{teacherId: string, delta: number, reason?: Object}>, reputation: number, debt: string[]}}}
 */
export function mark(state, ev, preset, opts = {}) {
  const next = cloneState(state);
  const subjectId = ev && ev.subjectId;
  const status = ev && ev.status;

  if (!STATUSES.includes(status) || !findSubject(next, subjectId)) {
    pushJournal(next, {
      kind: 'attendance',
      text: `attendance rejected ${subjectId}=${status}`,
      data: { subjectId, status },
    }, preset);
    return { state: next, effects: noEffects() };
  }

  const day = String(ev.day || (next.calendar && next.calendar.day) || '');
  const periodIndex = ev.periodIndex == null ? null : Number(ev.periodIndex);

  // Отметка по одной и той же паре заменяется, а не копится: `inferMissed()` может
  // проехаться по дню повторно, а руками можно исправить прогул на уважительный.
  const same = (r) => r.day === day && r.subjectId === subjectId && r.periodIndex === periodIndex;
  const at = next.attendance.records.findIndex(same);
  const record = { day, subjectId, status, periodIndex };
  // Во что обошёлся прогул репутации — чтобы отработка вернула ровно это
  // (`workOff`). Число не выводится из пресета задним числом: шкалу можно
  // поправить посреди семестра, а возвращают то, что реально сняли.
  const cost = status === 'skip' ? skipCost(preset) : 0;
  if (cost) record.cost = cost;
  if (at >= 0) next.attendance.records[at] = record;
  else next.attendance.records.push(record);

  if (opts.journal !== false) {
    pushJournal(next, {
      kind: 'attendance',
      text: `attendance ${subjectId}=${status}`,
      data: record,
    }, preset);
  }

  return { state: next, effects: effectsFor(next, subjectId, status, preset, day) };
}

/**
 * Что должно случиться после отметки. Считается по накопленной статистике, а не по
 * одному событию: хвост даёт не прогул сам по себе, а третий подряд.
 */
function effectsFor(state, subjectId, status, preset, day) {
  const out = noEffects();
  const att = (preset && preset.attendance) || {};
  const rep = (preset && preset.reputation && preset.reputation.delta) || {};

  const relDelta = (att.relationDelta || {})[status];
  const teacher = teacherOfSubject(state, subjectId);
  if (teacher && typeof relDelta === 'number' && relDelta !== 0) {
    // Повод сдвига едет вместе с дельтой (9.7B): «прогул химии 12.10», а не
    // безымянное «−1» в журнале. Форма повода — `relations.reasonText`.
    out.relation.push({ teacherId: teacher.id, delta: relDelta, reason: { kind: status, subjectId, day } });
  }

  if (typeof rep[status] === 'number') out.reputation += rep[status];

  // Хвост ставится ровно в тот момент, когда порог перейдён, и один раз.
  //
  // **Хвост за прогулы репутацию не трогает.** Он возникает из тех же самых
  // прогулов, за каждый из которых репутация уже заплачена (`rep.skip`); второй
  // вычет за ту же пару и тот же предмет был бы двойной платой за один поступок.
  // Ярлык `reputation.delta.debt` в пресетах поэтому не нужен: другого источника
  // хвоста, который бил бы по репутации, нет — провал на сессии платит своим
  // `examFailed`.
  const subject = findSubject(state, subjectId);
  const threshold = att.debtAfterSkips;
  if (subject && !subject.debt && typeof threshold === 'number') {
    if (effectiveSkips(state, subjectId, preset) >= threshold) out.debt.push(subjectId);
  }

  return out;
}

/**
 * Прогулы с учётом опозданий: `preset.attendance.lateEqualsSkip` опозданий
 * складываются в прогул. Правило есть в любой живой ведомости и держит опоздания
 * от превращения в бесплатный вариант прогула.
 */
export function effectiveSkips(state, subjectId, preset) {
  const s = stats(state, subjectId);
  // Отработанный прогул (`workOff`) в зачёт хвоста больше не идёт: он закрыт.
  const open = s.skips - s.worked;
  const per = preset && preset.attendance && preset.attendance.lateEqualsSkip;
  if (typeof per !== 'number' || per <= 0) return open;
  return open + Math.floor(s.lates / per);
}

/** Цена одного прогула в репутации (положительное число); `0` — пресет её не задаёт. */
function skipCost(preset) {
  const v = preset && preset.reputation && preset.reputation.delta && preset.reputation.delta.skip;
  return typeof v === 'number' && v < 0 ? -v : 0;
}

/**
 * Отработка: закрыть самый старый открытый прогул.
 *
 * Прогул, который герой потом отработал — сдал зачёт по предмету, получил
 * проходную оценку за домашнюю работу, — перестаёт висеть на нём. Запись при этом
 * не удаляется: история «прогуливал» остаётся (вехи, «призрак аудитории»), а
 * закрытость отмечается полем `workedOff` с днём закрытия. Репутация, снятая за
 * этот прогул, возвращается (`effects.reputation > 0`); применяет её вызывающий,
 * как и остальные эффекты этого модуля.
 *
 * Закрывается один прогул за одно событие: сданный зачёт — это одно «отработал»,
 * а не амнистия всему предмету. `subjectId: null` — событие без предмета (общий
 * экзамен, сессия): закрывается самый старый открытый прогул любого предмета.
 * Если открытых нет — ничего не происходит.
 *
 * @param {Object} state
 * @param {{subjectId?: ?string, day?: string}} ev
 * @param {Object} preset
 * @returns {{state: Object, closed: ?Object, effects: Object}}
 */
export function workOff(state, ev, preset) {
  const next = cloneState(state);
  const subjectId = (ev && ev.subjectId) || null;
  const today = String((ev && ev.day) || (next.calendar && next.calendar.day) || '');
  const open = (next.attendance.records || [])
    .filter((r) => r.status === 'skip' && !r.workedOff && (!subjectId || r.subjectId === subjectId))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : (a.periodIndex || 0) - (b.periodIndex || 0)));
  const record = open[0];
  if (!record) return { state: next, closed: null, effects: noEffects() };

  record.workedOff = today;
  const effects = noEffects();
  effects.reputation = typeof record.cost === 'number' ? record.cost : skipCost(preset);

  pushJournal(next, {
    kind: 'attendance',
    text: `attendance ${record.subjectId}: skip ${record.day} worked off`,
    data: { workedOff: true, subjectId: record.subjectId, skipDay: record.day, day: today },
  }, preset);
  return { state: next, closed: { ...record }, effects };
}

/**
 * Стоит ли вообще дозаполнять ведомость за этот прыжок календаря.
 *
 * Правило «на прыжок», а не «на день», и это принципиально. Ответ «три месяца
 * спустя» не означает, что последнюю неделю из этих трёх месяцев человек
 * прогуливал, — он означает, что про эти три месяца не известно ничего.
 * Восстановить из них хвостовую неделю и отчислить по ней значит выдумать
 * последствия, а по разделу 5 плана цена ложного вывода выше цены пропуска: не
 * сдвинуть календарь дешевле, чем сдвинуть его неверно. Та же логика, что у
 * запрета отката времени в `time.advance`.
 *
 * Функция вызывается **один раз на прыжок**, до обхода дней. Горизонт —
 * `preset.attendance.inferHorizonDays`; пресет без него и невнятные даты
 * потолка не имеют — считать не от чего, ведём себя как раньше.
 *
 * @param {string} fromDay день, с которого календарь ушёл, `ГГГГ-ММ-ДД`
 * @param {string} toDay   день, на который он пришёл
 * @param {Object} preset
 * @returns {boolean}
 */
export function shouldInfer(fromDay, toDay, preset) {
  const horizon = preset && preset.attendance && preset.attendance.inferHorizonDays;
  if (typeof horizon !== 'number' || !Number.isFinite(horizon)) return true;
  if (!isDay(fromDay) || !isDay(toDay)) return true;
  return Math.abs(diffDays(fromDay, toDay)) <= horizon;
}

/**
 * Вывод пропусков из календаря (3.4): пары, которые по расписанию прошли, а записи
 * о них нет, считаются прогулянными.
 *
 * `expected` приходит аргументом — календарь и расписание считаются в других
 * модулях, и знать о них здесь не нужно.
 *
 * **Горизонт.** Дозаполнение ограничено `preset.attendance.inferHorizonDays`,
 * считая от `state.calendar.day` до переданного дня. Ответ «три месяца спустя» —
 * смена сцены, а не двести прогулов: без потолка один такой пост отчисляет кого
 * угодно мгновенно, и это ловится не рассуждением, а первым же прогоном
 * семестра. За горизонтом ведомость честно остаётся пустой — расширение не
 * знает, что там было, — и в журнал уходит строчка. Пресет без поля и состояние
 * без внятной даты потолка не имеют: считать не от чего.
 *
 * @param {Object} state
 * @param {{day: string, expected: Array<{subjectId: string, periodIndex: ?number}>}} arg
 * @param {Object} preset
 * @param {{journal?: boolean}} [opts] передаётся в `mark` (см. там)
 * @returns {{state: Object, missed: string[], effects: Object}} `effects` — суммарные
 *   последствия всех выведенных прогулов, в той же форме, что у `mark()`.
 */
export function inferMissed(state, arg, preset, opts = {}) {
  const day = String((arg && arg.day) || '');
  const expected = (arg && arg.expected) || [];
  let acc = state;

  // Сутки заведения семестра ведомостью не обсчитываются вовсе — см. `countsAttendance`.
  if (!countsAttendance(state, day)) {
    const next = cloneState(state);
    pushJournal(next, {
      kind: 'attendance',
      text: `attendance skipped: ${day} — сутки заведения семестра`,
      data: { day, reason: 'term-start' },
    }, preset);
    return { state: next, missed: [], effects: noEffects() };
  }

  const horizon = preset && preset.attendance && preset.attendance.inferHorizonDays;
  const today = state.calendar && state.calendar.day;
  if (typeof horizon === 'number' && Number.isFinite(horizon) && isDay(day) && isDay(today)) {
    const gap = Math.abs(diffDays(day, today));
    if (gap > horizon) {
      const next = cloneState(state);
      pushJournal(next, {
        kind: 'attendance',
        text: `attendance skipped: ${day} дальше горизонта (${gap} дн. > ${horizon})`,
        data: { day, gap, horizon },
      }, preset);
      return { state: next, missed: [], effects: noEffects() };
    }
  }
  const missed = [];
  const effects = noEffects();

  for (const item of expected) {
    const subjectId = item && item.subjectId;
    const periodIndex = item && item.periodIndex != null ? Number(item.periodIndex) : null;
    const known = (acc.attendance.records || []).some(
      (r) => r.day === day && r.subjectId === subjectId && r.periodIndex === periodIndex,
    );
    if (known) continue;

    // Именно `skip`, и никогда `excused`: расширение не умеет знать причину.
    const res = mark(acc, { subjectId, status: 'skip', day, periodIndex }, preset, opts);
    acc = res.state;
    missed.push(subjectId);
    effects.relation.push(...res.effects.relation);
    effects.reputation += res.effects.reputation;
    effects.debt.push(...res.effects.debt);
  }

  return { state: acc, missed, effects };
}

/** Статистика по предмету. */
export function stats(state, subjectId) {
  return count((state.attendance && state.attendance.records) || [], (r) => r.subjectId === subjectId);
}

/** Статистика по семестру целиком. */
export function totalStats(state) {
  return count((state.attendance && state.attendance.records) || [], () => true);
}

function count(records, keep) {
  const out = { present: 0, skips: 0, lates: 0, excused: 0, worked: 0 };
  for (const r of records) {
    if (!keep(r)) continue;
    if (r.status === 'present') out.present += 1;
    else if (r.status === 'skip') {
      out.skips += 1;
      if (r.workedOff) out.worked += 1;
    }
    else if (r.status === 'late') out.lates += 1;
    else if (r.status === 'excused') out.excused += 1;
  }
  return out;
}

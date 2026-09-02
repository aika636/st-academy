// core/gradebook — зачётка: оценки, хвосты, накопительный балл.
//
// Модуль отвечает на три вопроса и больше ни на что: что за оценка пришла,
// сдан ли предмет и какой сейчас накопительный балл. Ни одного правила в коде —
// вся шкала живёт в `preset.grades`.
//
// Два решения, из которых вытекает всё остальное.
//
// 1. **Шкала — список значений, а не диапазон чисел** (поправка 2 этапа 0). Модель
//    пишет `grade=физика:автомат` и `grade=физика:зачёт`, потому что так естественно
//    для сеттинга. Поэтому оценка внутри состояния — строка из `preset.grades.values`,
//    а числовой вес лежит рядом, в поле `points`, и у `зачёт`/`незачёт` его нет.
//    Средний балл считается только по тем оценкам, у которых `points` — число;
//    иначе «зачёт» либо провалит средний в ноль, либо потребует выдумать ему вес.
// 2. **Неизвестное значение не применяется.** Оно уходит в журнал с причиной и не
//    портит зачётку. Ошибка стоит один пост — это дешевле, чем угадывать, что
//    имелось в виду под `t=+night` или `grade=химия:отлично!!!`.
//
// Хвост (`debt`) — флаг на предмете, а не вывод из последней оценки: хвост можно
// получить не только за двойку (прогулы его тоже ставят, см. attendance.mjs), и
// снимается он пересдачей, то есть новой проходной оценкой.
//
// У хвоста есть **причина** (`subject.debtReason`) — код источника, а не текст.
// Источников три: непроходная оценка, прогулы и несевшее событие закрытой сессии
// (`exams.closeExamSession`). Причина ничего не решает: флаг `debt` ставится и
// снимается ровно теми же правилами, что и до её появления, — она только
// называет, откуда хвост взялся, чтобы столкновение источников было видно в
// журнале и в отладке, а не угадывалось. Разводить источники поведением —
// отдельное решение владелицы, см. `etap-terms.md`.

import { cloneState, findSubject, pushJournal, isDay } from './state.mjs';
// Периоды считает `time.mjs`: своя арифметика дат здесь означала бы второй ответ
// на вопрос «какому триместру принадлежит день».
import { termAt } from './time.mjs';

/** Коды отказа. Машинные: наружу их переводит слой интерфейса, а не ядро. */
export const REJECT_UNKNOWN_SUBJECT = 'unknown-subject';
export const REJECT_UNKNOWN_VALUE = 'unknown-value';

/** Коды причин хвоста. Тоже машинные и тоже без единого слова сеттинга. */
/** Непроходная оценка в зачётке. */
export const DEBT_GRADE = 'grade';
/** Прогулы: порог `attendance.debtAfterSkips`. */
export const DEBT_SKIPS = 'skips';
/** Исчерпанные попытки на сессии. */
export const DEBT_EXAM = 'exam';
/** Событие, за которое так и не сели до конца сессии. */
export const DEBT_MISSED = 'missed';

/**
 * Опознать значение оценки по шкале пресета.
 *
 * Три попытки, по убыванию строгости: точное совпадение со шкалой, псевдоним из
 * `aliases`, совпадение без учёта регистра. Псевдонимы нужны потому, что модель
 * пишет `зачет` без «ё» примерно так же часто, как с ней, и ловить это регуляркой
 * в коде — значит зашить русский язык в ядро.
 *
 * @returns {?{value: string, points: ?number, pass: boolean, label: string}}
 */
export function resolveGrade(preset, raw) {
  const scale = (preset && preset.grades && preset.grades.values) || [];
  const aliases = (preset && preset.grades && preset.grades.aliases) || {};
  const key = String(raw == null ? '' : raw).trim();
  if (!key) return null;

  const exact = scale.find((g) => g.value === key);
  if (exact) return exact;

  const lower = key.toLowerCase();
  const aliased = aliases[key] != null ? aliases[key] : aliases[lower];
  if (aliased != null) return scale.find((g) => g.value === aliased) || null;

  return scale.find((g) => String(g.value).toLowerCase() === lower) || null;
}

/** Числовой вес оценки, если он у неё есть. `зачёт` веса не имеет — это не ноль. */
export function pointsOf(preset, value) {
  const spec = resolveGrade(preset, value);
  return spec && typeof spec.points === 'number' ? spec.points : null;
}

/**
 * Выставить оценку.
 *
 * @param {Object} state
 * @param {{subjectId: string, value: string, day?: string}} ev
 * @param {Object} preset
 * @returns {{state: Object, applied: boolean, reason: ?string}}
 */
export function addGrade(state, ev, preset) {
  const next = cloneState(state);
  const subjectId = ev && ev.subjectId;
  const subject = findSubject(next, subjectId);

  if (!subject) {
    pushJournal(next, {
      kind: 'grade',
      text: `grade rejected [${REJECT_UNKNOWN_SUBJECT}] ${subjectId}=${ev && ev.value}`,
      data: { subjectId, value: ev && ev.value, reason: REJECT_UNKNOWN_SUBJECT },
    }, preset);
    return { state: next, applied: false, reason: REJECT_UNKNOWN_SUBJECT };
  }

  const spec = resolveGrade(preset, ev.value);
  if (!spec) {
    pushJournal(next, {
      kind: 'grade',
      text: `grade rejected [${REJECT_UNKNOWN_VALUE}] ${subjectId}=${ev.value}`,
      data: { subjectId, value: ev.value, reason: REJECT_UNKNOWN_VALUE },
    }, preset);
    return { state: next, applied: false, reason: REJECT_UNKNOWN_VALUE };
  }

  const day = String(ev.day || (next.calendar && next.calendar.day) || '');
  subject.grades.push({ value: spec.value, day });

  // Проходная оценка закрывает хвост, непроходная его ставит: пересдача — это
  // просто ещё одна запись в зачётке, отдельной механики «закрыть хвост» не нужно.
  subject.debt = !spec.pass;
  stampDebt(subject, DEBT_GRADE);

  pushJournal(next, {
    kind: 'grade',
    text: `grade ${subject.id}=${spec.value}`,
    data: { subjectId: subject.id, value: spec.value, points: spec.points },
  }, preset);

  return { state: next, applied: true, reason: null };
}

/**
 * Оценки предмета, попавшие в учебный период с номером `term`.
 *
 * Фильтр по датам, а не по хранению: `subject.grades` — один плоский список за
 * всю игру, и делить его на периоды физически незачем, пока у каждой оценки
 * лежит `day` (он лежит с самого начала, миграции не требуется).
 *
 * Два края.
 * 1. **Пресет без объявленных периодов** (`termAt` возвращает `index: -1`) —
 *    период один, «весь год», и фильтр обязан быть тождественным. Поэтому такой
 *    день считается своим всегда.
 * 2. **Оценка без даты** (состояние, собранное руками, или очень старое) —
 *    относится к периоду, в котором календарь стоит сейчас: другого разумного
 *    места у неё нет, а выбрасывать её из счёта значит терять оценку молча.
 *
 * У пресетов с одним периодом `termAt` возвращает `index: 0` любому дню, так что
 * фильтр не выбрасывает ничего и балл остаётся ровно тем же, что и до его
 * появления. Это проверяется тестом, а не обещается.
 */
export function gradesInTerm(state, grades, preset, term) {
  if (!Number.isFinite(term)) return grades;
  const today = state && state.calendar && state.calendar.day;
  const now = termAt(preset, state, today);
  const current = now.index >= 0 ? now.index : term;
  return (grades || []).filter((g) => {
    if (!isDay(g && g.day)) return term === current;
    const at = termAt(preset, state, g.day);
    return at.index < 0 || at.index === term;
  });
}

/**
 * Сводка по предмету.
 *
 * `average` — только по оценкам с числовым весом, поэтому у зачётного предмета он
 * `null`, а не ноль. `passed` — есть хотя бы одна проходная оценка и нет хвоста.
 *
 * `opts.term` сужает счёт до одного учебного периода — этим пользуется сессия
 * (`exams.examScore`), которой годовой балл подпирал бы исход третьего триместра
 * оценками первого. Панель зачётки его не передаёт нарочно: там балл и список
 * оценок — картина за год, и прятать с экрана сентябрь при наступлении января
 * значило бы ту самую тихую потерю, против которой написан 3.8.
 *
 * @param {Object} state
 * @param {string} subjectId
 * @param {Object} preset
 * @param {{term?: number}} [opts]
 * @returns {{average: ?number, grades: Array<{value: string, day: string}>, passed: boolean, debt: boolean}}
 */
export function subjectScore(state, subjectId, preset, opts = {}) {
  const subject = findSubject(state, subjectId);
  if (!subject) return { average: null, grades: [], passed: false, debt: false };

  const grades = gradesInTerm(state, subject.grades || [], preset, opts.term);
  const points = grades.map((g) => pointsOf(preset, g.value)).filter((p) => p !== null);
  const debt = Boolean(subject.debt);
  const passed = !debt && grades.some((g) => {
    const spec = resolveGrade(preset, g.value);
    return Boolean(spec && spec.pass);
  });

  return { average: mean(points), grades, passed, debt };
}

/**
 * Накопительный балл по всему семестру: среднее всех оценок с числовым весом.
 * Пока таких оценок нет — `null`, а не стартовое значение из пресета: показывать
 * «балл 3.0» до первой контрольной значит врать в строке состояния.
 *
 * @returns {?number}
 */
export function overallScore(state, preset) {
  const points = [];
  for (const s of state.subjects || []) {
    for (const g of s.grades || []) {
      const p = pointsOf(preset, g.value);
      if (p !== null) points.push(p);
    }
  }
  return mean(points);
}

/** Хвосты: предметы, по которым есть несданное. Порядок — как в состоянии. */
export function debts(state) {
  return (state.subjects || []).filter((s) => Boolean(s.debt));
}

/**
 * Поставить или снять хвост вручную (и из attendance.mjs через эффекты).
 *
 * `reason` — код источника из списка `DEBT_*`; не задан — причина остаётся
 * неназванной. Умолчания здесь нет нарочно: этот вход зовут и прогулы, и
 * человек из панели, и подставить одному источнику имя другого хуже, чем
 * промолчать.
 */
export function setDebt(state, subjectId, value, preset, reason = null) {
  const next = cloneState(state);
  const subject = findSubject(next, subjectId);
  if (!subject) return next;

  const flag = Boolean(value);
  if (subject.debt === flag) return next;

  subject.debt = flag;
  stampDebt(subject, reason);
  pushJournal(next, {
    kind: 'grade',
    text: `debt ${subject.id}=${flag}`,
    data: { subjectId: subject.id, debt: flag, reason: flag ? reason : null },
  }, preset);
  return next;
}

/**
 * Проставить причину хвоста по флагу `subject.debt`: снятый хвост причины не
 * имеет. Отдельная функция потому, что мест, где флаг переставляется, четыре
 * (здесь, `addGrade`, `exams.applyOutcome`, `exams.resolveConflict`), и оставить
 * в одном из них старую причину — значит получить хвост «за прогулы», которого
 * уже нет.
 */
export function stampDebt(subject, reason) {
  if (!subject) return subject;
  if (subject.debt && reason) subject.debtReason = String(reason);
  else delete subject.debtReason;
  return subject;
}

/** Среднее по списку; пустой список — `null`, а не ноль. */
function mean(list) {
  if (!list.length) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

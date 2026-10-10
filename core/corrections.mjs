// core/corrections — поправки по разбору старого ответа.
//
// Последний ответ секретарь разбирает начисто: ход откатывается к снимку «до
// него» и считается заново (`index.js: handleMessage`). У старого ответа такого
// снимка нет — после него прошли другие ходы, и пересчитать его, не выбросив
// их, нельзя. Поэтому выводы по старому ответу ложатся **поправкой**: в
// нынешнее состояние дописывается то, что секретарь нашёл, датой того ответа.
//
// Три решения.
//
// 1. **Каждая поправка возвращает квитанцию** — что именно изменилось, чтобы
//    снять ровно это: удалить ту оценку, вернуть прежнюю отметку посещаемости,
//    отыграть сдвиг отношения на столько, на сколько он сдвинул (с зажимом
//    шкалы это не всегда то, что написано в токене).
// 2. **Без каскада.** Прогул поправкой — это запись в ведомости, а не повод
//    заново прогнать штрафы отношения и репутации: их секретарь пишет сам,
//    отдельными выводами, и снимаются они тоже отдельно. Иначе снять один
//    прогул значило бы угадывать, что из его последствий ещё в силе.
// 3. **Снять можно и без квитанции** — по самому токену. Так снимаются выводы
//    ответа, который разбирали, пока он был последним (они легли пересчётом,
//    квитанций у них нет), а потом пришли новые ответы.
//
// Модуль чистый: состояние на входе, новое состояние и квитанция на выходе.

import { cloneState, findSubject, pushJournal } from './state.mjs';
import { addGrade } from './gradebook.mjs';
import { mark } from './attendance.mjs';
import { changeRelation, findPerson } from './relations.mjs';
import { SCENE_KINDS, SCENE_RECEIPTS, applySceneEvent, revertSceneEvent } from './scene.mjs';
import { applyAcademicCompletion } from './academic-completion.mjs';
import { planEvent, planPause } from './holidays.mjs';
import { addDays } from './time.mjs';

/** Remember only the academic fields changed by a summary, leaving later play intact. */
export function completionReceipt(before, after, subjectIds) {
  const subjects = (before.subjects || []).filter((s) => subjectIds.includes(s.id)).map((s) => {
    const updated = findSubject(after, s.id);
    return { subjectId: s.id, prev: { debt: s.debt, debtReason: s.debtReason },
      after: { debt: updated.debt, debtReason: updated.debtReason },
      grades: updated.grades.slice(s.grades.length).map((g, offset) => ({ index: s.grades.length + offset, grade: { ...g } })) };
  });
  const exams = (before.exams?.items || []).flatMap((item) => {
    const updated = after.exams?.items.find((x) => x.id === item.id);
    return subjectIds.includes(item.subjectId) && updated && JSON.stringify(item) !== JSON.stringify(updated)
      ? [{ id: item.id, before: { ...item }, after: { ...updated } }] : [];
  });
  return { kind: 'completion', subjects, exams };
}

/**
 * Применить событие разбора (`parseMarker`) к нынешнему состоянию.
 *
 * @param {Object} state
 * @param {{kind: string}} ev событие `grade` / `rel` / `attendance`
 * @param {Object} preset
 * @param {{day?: string, src?: string, token?: string, stop?: *}} [opts] день того
 *   ответа (нет — сегодняшний); для фактов курса — отпечаток ответа, токен и
 *   стоп-лист (`core/scene`)
 * @returns {{state: Object, receipt: ?Object}} квитанция `null` — ничего не легло
 */
export function applyCorrection(state, ev, preset, opts = {}) {
  const day = opts.day || (state.calendar && state.calendar.day) || '';
  if (!ev) return { state, receipt: null };

  if (ev.kind === 'completion') {
    const base = cloneState(state);
    base.calendar.day = day;
    const result = applyAcademicCompletion(base, ev, preset);
    result.state.calendar = { ...state.calendar };
    return { state: result.state, receipt: completionReceipt(state, result.state, result.subjectIds) };
  }

  if (ev.kind === 'grade') {
    const subject = findSubject(state, ev.subjectId);
    if (!subject) return { state, receipt: null };
    const prev = { debt: Boolean(subject.debt), debtReason: subject.debtReason };
    const r = addGrade(state, { subjectId: ev.subjectId, value: ev.value, day }, preset);
    if (!r.applied) return { state: r.state, receipt: null };
    return { state: r.state, receipt: { kind: 'grade', subjectId: ev.subjectId, value: String(ev.value), day, prev } };
  }

  if (ev.kind === 'rel') {
    // Преподаватель или однокурсник (шаг 2): у `rel=` одно пространство id.
    const teacher = findPerson(state, ev.teacherId);
    if (!teacher) return { state, receipt: null };
    const before = teacher.relation;
    const r = changeRelation(state, { teacherId: ev.teacherId, delta: ev.delta, reason: ev.reason || null }, preset);
    const after = (findPerson(r.state, ev.teacherId) || {}).relation;
    const applied = Number(after) - Number(before);
    return { state: r.state, receipt: { kind: 'rel', teacherId: ev.teacherId, applied: Number.isFinite(applied) ? applied : 0 } };
  }

  // Событие в планы — от дня того ответа: «через три дня бал», сказанное
  // позавчера, — бал завтра. Уже прошедшее событие тоже ложится: оно просто
  // окажется в списке прошедшим. Уже записанное в те же дни — квитанция
  // `known`: плашка скажет «уже в планах», а снятие разбора не тронет чужую
  // запись (без квитанции оно снимало бы по имени и дню — то самое событие).
  if (ev.kind === 'event') {
    const r = planEvent(state, preset, ev, day);
    if (!r.ok) return { state, receipt: r.duplicate ? { kind: 'event', known: true, name: ev.name } : null };
    return { state: r.state, receipt: { kind: 'event', id: r.event.id, name: r.event.name, from: r.event.from } };
  }

  // Приостановка занятий: квитанция помнит прежнее событие (`prev`), чтобы снять
  // разбор — вернуть период, каким он был, или убрать заведённый.
  if (ev.kind === 'pause') {
    const r = planPause(state, preset, ev, day);
    if (!r.ok) return { state, receipt: r.duplicate ? { kind: 'pause', known: true } : null };
    return { state: r.state, receipt: { kind: 'pause', action: r.action, id: (r.event || r.prev).id, prev: r.prev } };
  }

  // Факты курса (шаг 3): кто был, стычка, слух, новое имя, дело — со своей
  // квитанцией из `core/scene`.
  if (SCENE_KINDS.includes(ev.kind)) {
    return applySceneEvent(state, ev, preset, { ...opts, day });
  }

  if (ev.kind === 'attendance') {
    const prev = (state.attendance.records || []).find((x) => x.day === day && x.subjectId === ev.subjectId && x.periodIndex === null) || null;
    const r = mark(state, { subjectId: ev.subjectId, status: ev.status, day, periodIndex: null }, preset);
    const placed = (r.state.attendance.records || []).some((x) => x.day === day && x.subjectId === ev.subjectId && x.status === ev.status);
    if (!placed) return { state: r.state, receipt: null };
    return {
      state: r.state,
      receipt: { kind: 'attendance', subjectId: ev.subjectId, status: ev.status, day, prev: prev ? { ...prev } : null },
    };
  }

  return { state, receipt: null };
}

/**
 * Снять поправку по квитанции. Квитанция без `prev`/`applied` — снятие по
 * токену (решение 3): оценка и отметка ищутся по значению и дню, сдвиг
 * отношения отыгрывается на величину токена.
 */
export function revertCorrection(state, receipt, preset) {
  if (!receipt || typeof receipt !== 'object') return state;
  if (SCENE_RECEIPTS.includes(receipt.kind)) return revertSceneEvent(state, receipt);
  let next = cloneState(state);

  if (receipt.kind === 'completion') {
    for (const entry of receipt.subjects || []) {
      const subject = findSubject(next, entry.subjectId);
      if (!subject) continue;
      const laterGrades = entry.grades.length && subject.grades.length > Math.max(...entry.grades.map((g) => g.index)) + 1;
      for (const added of [...entry.grades].reverse()) {
        if (JSON.stringify(subject.grades[added.index]) === JSON.stringify(added.grade)) subject.grades.splice(added.index, 1);
      }
      // A later failure or manual debt repair owns the current debt flag.
      if (!laterGrades && subject.debt === entry.after.debt && subject.debtReason === entry.after.debtReason) {
        subject.debt = entry.prev.debt;
        if (entry.prev.debtReason === undefined) delete subject.debtReason;
        else subject.debtReason = entry.prev.debtReason;
      }
    }
    for (const entry of receipt.exams || []) {
      const item = next.exams?.items.find((x) => x.id === entry.id);
      if (!item || JSON.stringify(item) !== JSON.stringify(entry.after)) continue;
      for (const key of new Set([...Object.keys(entry.before), ...Object.keys(entry.after)])) {
        if (JSON.stringify(item[key]) !== JSON.stringify(entry.after[key])) continue;
        if (key in entry.before) item[key] = entry.before[key];
        else delete item[key];
      }
    }
    return next;
  }

  if (receipt.kind === 'grade') {
    const subject = findSubject(next, receipt.subjectId);
    if (!subject) return next;
    const list = subject.grades || [];
    let at = -1;
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (String(list[i].value) === String(receipt.value) && (!receipt.day || list[i].day === receipt.day)) { at = i; break; }
    }
    if (at < 0) return next;
    list.splice(at, 1);
    if (receipt.prev) {
      subject.debt = Boolean(receipt.prev.debt);
      if (receipt.prev.debtReason) subject.debtReason = receipt.prev.debtReason;
      else delete subject.debtReason;
    }
    pushJournal(next, {
      kind: 'debug', text: `correction undone: grade ${receipt.subjectId}=${receipt.value}`, data: { undo: 'grade', subjectId: receipt.subjectId },
    }, preset);
    return next;
  }

  if (receipt.kind === 'rel') {
    const delta = Number.isFinite(receipt.applied) ? -receipt.applied : -Number(receipt.delta || 0);
    if (!delta) return next;
    return changeRelation(next, { teacherId: receipt.teacherId, delta, reason: null }, preset).state;
  }

  if (receipt.kind === 'event') {
    if (receipt.known) return next;
    const list = Array.isArray(next.events) ? next.events : [];
    const at = list.findIndex((e) => e && (receipt.id ? e.id === receipt.id : e.name === receipt.name && e.from === receipt.from));
    if (at >= 0) list.splice(at, 1);
    return next;
  }

  if (receipt.kind === 'pause') {
    if (receipt.known) return next;
    const list = Array.isArray(next.events) ? next.events : [];
    const at = list.findIndex((e) => e && e.id === receipt.id);
    if (receipt.prev) {
      if (at >= 0) list[at] = { ...receipt.prev };
      else list.push({ ...receipt.prev });
    } else if (at >= 0) list.splice(at, 1);
    next.events = list;
    return next;
  }

  if (receipt.kind === 'attendance') {
    const records = next.attendance.records || [];
    let at = -1;
    for (let i = records.length - 1; i >= 0; i -= 1) {
      const x = records[i];
      if (x.subjectId === receipt.subjectId && x.status === receipt.status && (!receipt.day || x.day === receipt.day)) { at = i; break; }
    }
    if (at < 0) return next;
    if (receipt.prev) records[at] = { ...receipt.prev };
    else records.splice(at, 1);
    return next;
  }

  return next;
}

/**
 * Квитанция «по токену» для выводов, легших пересчётом (решение 3).
 * @param {{kind: string}} ev событие разбора
 * @param {string} day день того ответа
 */
export function receiptOf(ev, day) {
  if (!ev) return null;
  if (ev.kind === 'grade') return { kind: 'grade', subjectId: ev.subjectId, value: String(ev.value), day };
  if (ev.kind === 'rel') return { kind: 'rel', teacherId: ev.teacherId, delta: ev.delta };
  if (ev.kind === 'attendance') return { kind: 'attendance', subjectId: ev.subjectId, status: ev.status, day };
  if (ev.kind === 'event' && day) return { kind: 'event', name: ev.name, from: addDays(day, ev.days) };
  return null;
}

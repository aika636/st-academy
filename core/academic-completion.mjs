// Подтверждённая учебная сводка: закрыты все экзамены / хвосты / один предмет.
import { cloneState, pushJournal } from './state.mjs';
import { addGrade, resolveGrade } from './gradebook.mjs';
import { applyOutcome, isPassing, examTermIndex } from './exams.mjs';

export function applyAcademicCompletion(state, event, preset) {
  let next = cloneState(state);
  const grade = resolveGrade(preset, event.value);
  const subjectIds = [];
  if (!grade?.pass) return { state: next, applied: false, subjectIds };
  const day = next.calendar.day;
  const term = examTermIndex(preset, next, day);
  const due = (item) => (item.term === undefined || item.term === term)
    && item.day && item.day <= day && !isPassing(preset, item.outcome);
  const selected = next.subjects.filter((subject) => event.scope === 'all'
    || event.scope === subject.id
    || (event.scope === 'debts' && (subject.debt
      || next.exams.items.some((item) => item.subjectId === subject.id && due(item)))));
  for (const selectedSubject of selected) {
    const exams = next.exams.items.filter((item) => item.subjectId === selectedSubject.id && due(item));
    for (const exam of exams) {
      const result = applyOutcome(next, { examId: exam.id, value: grade.value, day, reason: 'story-summary' }, preset);
      next = result.state;
      const item = next.exams.items.find((candidate) => candidate.id === exam.id);
      // Итог уже прозвучал в истории: повторного объявления сцены не требуется.
      item.announced = true;
      delete item.announceOn;
      if (result.pending) next.pending = next.pending.filter((entry) => entry.id !== result.pending.id);
    }
    const subject = next.subjects.find((candidate) => candidate.id === selectedSubject.id);
    const last = subject.grades.at(-1);
    if (!exams.length && (subject.debt || !last || last.value !== grade.value)) {
      next = addGrade(next, { subjectId: subject.id, value: grade.value, day }, preset).state;
    } else if (!exams.length) continue;
    subjectIds.push(subject.id);
  }
  if (subjectIds.length) pushJournal(next, {
    kind: 'grade', text: `Учебная сводка: ${subjectIds.join(', ')} — ${grade.value}`,
    data: { completion: event.scope, subjectIds, value: grade.value },
  }, preset);
  return { state: next, applied: subjectIds.length > 0, subjectIds };
}

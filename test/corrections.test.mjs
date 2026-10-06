import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createState } from '../core/state.mjs';
import { applyCorrection, revertCorrection } from '../core/corrections.mjs';
import { addGrade } from '../core/gradebook.mjs';

const preset = JSON.parse(readFileSync(new URL('../presets/ru-university.json', import.meta.url), 'utf8'));
function state() {
  return createState(preset, { startDay: '2024-09-02', subjects: [{ id: 'chemistry', name: 'Chemistry', teacherId: 'teacher' }],
    teachers: [{ id: 'teacher', name: 'Teacher', relation: 4 }] });
}

test('relationship correction undo restores accumulated value at scale limit', () => {
  const initial = state();
  const result = applyCorrection(initial, { kind: 'rel', teacherId: 'teacher', delta: 2 }, preset);
  assert.equal(result.state.teachers[0].relation, 5);
  assert.equal(result.receipt.applied, 1);
  assert.equal(revertCorrection(result.state, result.receipt, preset).teachers[0].relation, 4);
  assert.equal(initial.teachers[0].relation, 4);
});

test('completion correction restores exact previous grades, debt and exam on undo', () => {
  const initial = state();
  initial.subjects[0].grades = [{ value: '2', day: '2024-09-01' }];
  initial.subjects[0].debt = true;
  initial.subjects[0].debtReason = 'grade';
  initial.exams.items = [{ id: 'exam', subjectId: 'chemistry', day: '2024-09-02', kind: 'exam', attempts: 0, outcome: null }];
  const result = applyCorrection(initial, { kind: 'completion', scope: 'all', value: '5' }, preset);
  assert.equal(result.state.subjects[0].debt, false);
  assert.equal(result.state.exams.items[0].outcome, '5');
  const restored = revertCorrection(result.state, result.receipt, preset);
  assert.deepEqual(restored.subjects, initial.subjects);
  assert.deepEqual(restored.exams.items, initial.exams.items);
  assert.deepEqual(restored.pending, initial.pending);
});

test('undoing old completion leaves later grade and its debt intact', () => {
  const initial = state();
  initial.subjects[0].debt = true;
  const result = applyCorrection(initial, { kind: 'completion', scope: 'debts', value: '5' }, preset);
  const later = addGrade(result.state, { subjectId: 'chemistry', value: '2', day: '2024-09-03' }, preset).state;
  const restored = revertCorrection(later, result.receipt, preset);
  assert.deepEqual(restored.subjects[0].grades, [{ value: '2', day: '2024-09-03' }]);
  assert.equal(restored.subjects[0].debt, true);
});

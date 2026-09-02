import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState } from '../core/state.mjs';
import {
  addGrade, subjectScore, overallScore, debts, setDebt, resolveGrade, pointsOf,
  REJECT_UNKNOWN_SUBJECT, REJECT_UNKNOWN_VALUE,
} from '../core/gradebook.mjs';

const preset = JSON.parse(readFileSync(new URL('../presets/ru-university.json', import.meta.url), 'utf8'));

const base = () => createState(preset, {
  startDay: '2024-09-02',
  teachers: [{ id: 'petrova', name: 'Петрова' }, { id: 'sidorov', name: 'Сидоров' }],
  subjects: [
    { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
    { id: 'physics', name: 'физика', teacherId: 'sidorov' },
  ],
});

const put = (state, subjectId, value, day = '2024-09-02') =>
  addGrade(state, { subjectId, value, day }, preset).state;

// --- поправка 2 этапа 0: оценка бывает не числом -----------------------------

test('зачёт и автомат не ломают средний балл', () => {
  // «зачёт» веса не имеет и в средний не входит; «автомат» имеет вес 5 и входит.
  let s = base();
  s = put(s, 'chemistry', '4');
  s = put(s, 'chemistry', 'зачёт');
  s = put(s, 'chemistry', '5');

  const score = subjectScore(s, 'chemistry', preset);
  assert.equal(score.grades.length, 3);
  assert.equal(score.average, 4.5, 'зачёт не должен считаться ни нулём, ни пятёркой');
  assert.equal(score.passed, true);
  assert.equal(score.debt, false);

  let a = base();
  a = put(a, 'physics', 'автомат');
  assert.equal(subjectScore(a, 'physics', preset).average, 5);
});

test('зачётный предмет: среднего нет, но предмет сдан', () => {
  let s = base();
  s = put(s, 'chemistry', 'зачёт');
  const score = subjectScore(s, 'chemistry', preset);
  assert.equal(score.average, null);
  assert.equal(score.passed, true);
});

test('незачёт ставит хвост, пересдача его снимает', () => {
  let s = base();
  s = put(s, 'chemistry', 'незачёт');
  assert.equal(subjectScore(s, 'chemistry', preset).debt, true);
  assert.equal(subjectScore(s, 'chemistry', preset).passed, false);
  assert.deepEqual(debts(s).map((x) => x.id), ['chemistry']);

  s = put(s, 'chemistry', 'зачёт', '2024-09-16');
  assert.equal(subjectScore(s, 'chemistry', preset).debt, false);
  assert.deepEqual(debts(s), []);
});

test('псевдонимы пресета: зачет без ё и латинские буквы', () => {
  assert.equal(resolveGrade(preset, 'зачет').value, 'зачёт');
  assert.equal(resolveGrade(preset, 'A').value, '5');
  assert.equal(resolveGrade(preset, ' 4 ').value, '4');
  assert.equal(resolveGrade(preset, 'Автомат').value, 'автомат');
  assert.equal(pointsOf(preset, 'зачёт'), null);
  assert.equal(pointsOf(preset, 'автомат'), 5);
});

// --- мусор не попадает в зачётку --------------------------------------------

test('неизвестное значение не применяется и уходит в журнал', () => {
  const s0 = base();
  const res = addGrade(s0, { subjectId: 'chemistry', value: 'отлично!!!' }, preset);
  assert.equal(res.applied, false);
  assert.equal(res.reason, REJECT_UNKNOWN_VALUE);
  assert.equal(subjectScore(res.state, 'chemistry', preset).grades.length, 0);
  assert.equal(res.state.journal.at(-1).kind, 'grade');
  assert.equal(res.state.journal.at(-1).data.reason, REJECT_UNKNOWN_VALUE);
});

test('неизвестный предмет не применяется', () => {
  const res = addGrade(base(), { subjectId: 'potions', value: '5' }, preset);
  assert.equal(res.applied, false);
  assert.equal(res.reason, REJECT_UNKNOWN_SUBJECT);
});

// --- накопительный балл ------------------------------------------------------

test('накопительный балл пуст, пока оценок нет', () => {
  assert.equal(overallScore(base(), preset), null);
});

test('накопительный балл считается по всем предметам сразу', () => {
  let s = base();
  s = put(s, 'chemistry', '5');
  s = put(s, 'physics', '3');
  s = put(s, 'physics', 'зачёт');
  assert.equal(overallScore(s, preset), 4);
});

// --- чистота и ручной хвост --------------------------------------------------

test('состояние не правится на месте', () => {
  const s0 = base();
  const before = JSON.stringify(s0);
  addGrade(s0, { subjectId: 'chemistry', value: '5' }, preset);
  setDebt(s0, 'chemistry', true, preset);
  assert.equal(JSON.stringify(s0), before);
});

test('setDebt ставит и снимает хвост', () => {
  let s = setDebt(base(), 'physics', true, preset);
  assert.deepEqual(debts(s).map((x) => x.id), ['physics']);
  s = setDebt(s, 'physics', false, preset);
  assert.deepEqual(debts(s), []);
  // неизвестный предмет молча ничего не меняет
  assert.deepEqual(debts(setDebt(s, 'potions', true, preset)), []);
});

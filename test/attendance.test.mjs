import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState } from '../core/state.mjs';
import { mark, inferMissed, stats, totalStats, effectiveSkips } from '../core/attendance.mjs';
import { applyRelationDeltas, relationOf } from '../core/relations.mjs';
import { setDebt, debts } from '../core/gradebook.mjs';

const preset = JSON.parse(readFileSync(new URL('../presets/ru-university.json', import.meta.url), 'utf8'));

const base = () => createState(preset, {
  startDay: '2024-09-02',
  teachers: [{ id: 'petrova', name: 'Петрова' }, { id: 'sidorov', name: 'Сидоров' }],
  subjects: [
    { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
    { id: 'physics', name: 'физика', teacherId: 'sidorov' },
  ],
});

/** Дни разные — иначе повторная отметка по той же паре заменяет прежнюю. */
const day = (n) => `2024-09-${String(n).padStart(2, '0')}`;

test('прогул расходится по трём направлениям сразу', () => {
  const res = mark(base(), { subjectId: 'chemistry', status: 'skip', day: day(2), periodIndex: 0 }, preset);
  // Повод едет вместе с дельтой (9.7B): прогул, предмет, день.
  assert.deepEqual(res.effects.relation, [{
    teacherId: 'petrova', delta: preset.attendance.relationDelta.skip,
    reason: { kind: 'skip', subjectId: 'chemistry', day: day(2) },
  }]);
  assert.equal(res.effects.reputation, preset.reputation.delta.skip);
  assert.deepEqual(res.effects.debt, []); // до порога ещё далеко
  assert.deepEqual(stats(res.state, 'chemistry'), { present: 0, skips: 1, lates: 0, excused: 0 });
});

test('присутствие не даёт последствий', () => {
  const res = mark(base(), { subjectId: 'chemistry', status: 'present', day: day(2), periodIndex: 0 }, preset);
  assert.deepEqual(res.effects, { relation: [], reputation: 0, debt: [] });
});

test('опоздания складываются в прогул', () => {
  const per = preset.attendance.lateEqualsSkip;
  let s = base();
  for (let i = 0; i < per - 1; i += 1) {
    s = mark(s, { subjectId: 'chemistry', status: 'late', day: day(2 + i), periodIndex: 0 }, preset).state;
  }
  assert.equal(effectiveSkips(s, 'chemistry', preset), 0, 'до порога опоздания прогулом не считаются');

  s = mark(s, { subjectId: 'chemistry', status: 'late', day: day(2 + per), periodIndex: 0 }, preset).state;
  assert.equal(stats(s, 'chemistry').skips, 0, 'сами опоздания прогулами не становятся');
  assert.equal(effectiveSkips(s, 'chemistry', preset), 1);
});

test('порог прогулов даёт хвост ровно один раз', () => {
  const need = preset.attendance.debtAfterSkips;
  let s = base();
  let debtEvents = 0;

  for (let i = 0; i < need + 2; i += 1) {
    const res = mark(s, { subjectId: 'chemistry', status: 'skip', day: day(2 + i), periodIndex: 0 }, preset);
    s = res.state;
    if (res.effects.debt.length) {
      debtEvents += 1;
      assert.equal(i + 1, need, 'хвост должен встать ровно на пороговом прогуле');
      // Эффект применяет зачётка — здесь только его учёт.
      s = setDebt(s, 'chemistry', true, preset);
      assert.equal(res.effects.reputation, preset.reputation.delta.skip + preset.reputation.delta.debt);
    }
  }

  assert.equal(debtEvents, 1);
  assert.deepEqual(debts(s).map((x) => x.id), ['chemistry']);
});

test('опоздания и прогулы вместе добирают до порога', () => {
  const per = preset.attendance.lateEqualsSkip;
  const need = preset.attendance.debtAfterSkips;
  let s = base();
  let n = 2;

  for (let i = 0; i < need - 1; i += 1, n += 1) {
    s = mark(s, { subjectId: 'physics', status: 'skip', day: day(n), periodIndex: 1 }, preset).state;
  }
  let last = null;
  for (let i = 0; i < per; i += 1, n += 1) {
    last = mark(s, { subjectId: 'physics', status: 'late', day: day(n), periodIndex: 1 }, preset);
    s = last.state;
  }
  assert.equal(effectiveSkips(s, 'physics', preset), need);
  assert.deepEqual(last.effects.debt, ['physics']);
});

test('вывод пропусков из календаря: чего нет в записях, то прогул', () => {
  let s = base();
  s = mark(s, { subjectId: 'chemistry', status: 'present', day: day(3), periodIndex: 0 }, preset).state;

  const expected = [
    { subjectId: 'chemistry', periodIndex: 0 },
    { subjectId: 'physics', periodIndex: 1 },
  ];
  const res = inferMissed(s, { day: day(3), expected }, preset);

  assert.deepEqual(res.missed, ['physics'], 'отмеченная пара пропуском не становится');
  assert.equal(stats(res.state, 'chemistry').present, 1);
  assert.equal(stats(res.state, 'physics').skips, 1);
  assert.deepEqual(res.effects.relation, [{
    teacherId: 'sidorov', delta: preset.attendance.relationDelta.skip,
    reason: { kind: 'skip', subjectId: 'physics', day: '2024-09-03' },
  }]);
  assert.equal(res.effects.reputation, preset.reputation.delta.skip);

  // Повторный проход по тому же дню ничего не добавляет.
  const again = inferMissed(res.state, { day: day(3), expected }, preset);
  assert.deepEqual(again.missed, []);
  assert.equal(again.state.attendance.records.length, res.state.attendance.records.length);
});

test('уважительная причина никогда не выставляется сама', () => {
  const expected = [{ subjectId: 'chemistry', periodIndex: 0 }, { subjectId: 'physics', periodIndex: 1 }];
  const res = inferMissed(base(), { day: day(4), expected }, preset);
  assert.equal(totalStats(res.state).excused, 0);
  assert.ok(res.state.attendance.records.every((r) => r.status === 'skip'));

  // Руками — пожалуйста, и это перекрывает выведенный прогул.
  const fixed = mark(res.state, { subjectId: 'physics', status: 'excused', day: day(4), periodIndex: 1 }, preset);
  assert.deepEqual(stats(fixed.state, 'physics'), { present: 0, skips: 0, lates: 0, excused: 1 });
  assert.deepEqual(fixed.effects, { relation: [], reputation: 0, debt: [] });
});

test('эффекты применяются модулем отношений, а не здесь', () => {
  const res = mark(base(), { subjectId: 'chemistry', status: 'skip', day: day(5), periodIndex: 0 }, preset);
  assert.equal(relationOf(res.state, 'petrova'), preset.relations.start, 'mark() чужую шкалу не трогает');

  const applied = applyRelationDeltas(res.state, res.effects.relation, preset);
  assert.equal(relationOf(applied.state, 'petrova'), preset.relations.start + preset.attendance.relationDelta.skip);
});

test('мусорный статус и незнакомый предмет отбрасываются', () => {
  const bad = mark(base(), { subjectId: 'chemistry', status: 'проспала', day: day(6) }, preset);
  assert.deepEqual(bad.effects, { relation: [], reputation: 0, debt: [] });
  assert.equal(bad.state.attendance.records.length, 0);
  assert.equal(bad.state.journal.at(-1).kind, 'attendance');

  const unknown = mark(base(), { subjectId: 'potions', status: 'skip', day: day(6) }, preset);
  assert.equal(unknown.state.attendance.records.length, 0);
});

test('состояние не правится на месте', () => {
  const s0 = base();
  const before = JSON.stringify(s0);
  mark(s0, { subjectId: 'chemistry', status: 'skip', day: day(7), periodIndex: 0 }, preset);
  inferMissed(s0, { day: day(7), expected: [{ subjectId: 'physics', periodIndex: 1 }] }, preset);
  assert.equal(JSON.stringify(s0), before);
});

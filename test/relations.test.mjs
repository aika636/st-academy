import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState } from '../core/state.mjs';
import { changeRelation, relationLabel, relationOf, applyRelationDeltas } from '../core/relations.mjs';

const preset = JSON.parse(readFileSync(new URL('../presets/ru-university.json', import.meta.url), 'utf8'));

const base = () => createState(preset, {
  startDay: '2024-09-02',
  teachers: [{ id: 'petrova', name: 'Петрова' }, { id: 'sidorov', name: 'Сидоров' }],
  subjects: [{ id: 'chemistry', name: 'химия', teacherId: 'petrova' }],
});

const move = (state, delta, teacherId = 'petrova') =>
  changeRelation(state, { teacherId, delta }, preset).state;

test('отношение зажимается на границах пресета', () => {
  const { min, max } = preset.relations;

  let up = base();
  for (let i = 0; i < 20; i += 1) up = move(up, 1);
  assert.equal(relationOf(up, 'petrova'), max);

  let down = base();
  for (let i = 0; i < 20; i += 1) down = move(down, -1);
  assert.equal(relationOf(down, 'petrova'), min);

  // На потолке дальнейший сдвиг ничего не применяет.
  const res = changeRelation(up, { teacherId: 'petrova', delta: 3 }, preset);
  assert.equal(res.applied, false);
  assert.equal(relationOf(res.state, 'petrova'), max);
});

test('наружу уходит слово, а не число', () => {
  const s = move(base(), -5);
  const label = relationLabel(s, 'petrova', preset);
  assert.equal(typeof label, 'string');
  assert.ok(label.length > 0);
  assert.ok(!/^-?\d+([.,]\d+)?$/.test(label), `ярлык не должен быть числом: ${label}`);
  assert.ok(preset.relations.labels.some((l) => l.label === label));
});

test('ярлык меняется вместе со шкалой', () => {
  const start = base();
  const neutral = relationLabel(start, 'petrova', preset);
  const hated = relationLabel(move(start, preset.relations.min), 'petrova', preset);
  const loved = relationLabel(move(start, preset.relations.max), 'petrova', preset);
  assert.notEqual(neutral, hated);
  assert.notEqual(neutral, loved);
  assert.notEqual(hated, loved);
});

test('crossed отмечает переход через границу ярлыка, но не движение внутри полосы', () => {
  // Стартовое 0 и +1 лежат в одной полосе — значимого события нет.
  const inside = changeRelation(base(), { teacherId: 'petrova', delta: 1 }, preset);
  assert.equal(inside.applied, true);
  assert.equal(inside.crossed, null);

  // Ещё шаг выводит за границу — вот это событие для хроники.
  const out = changeRelation(inside.state, { teacherId: 'petrova', delta: 1 }, preset);
  assert.ok(out.crossed, 'переход через границу ярлыка должен быть отмечен');
  assert.equal(out.crossed.from, relationLabel(inside.state, 'petrova', preset));
  assert.equal(out.crossed.to, relationLabel(out.state, 'petrova', preset));
  assert.notEqual(out.crossed.from, out.crossed.to);
});

test('неизвестный преподаватель ничего не ломает', () => {
  const res = changeRelation(base(), { teacherId: 'snape', delta: -3 }, preset);
  assert.equal(res.applied, false);
  assert.equal(res.crossed, null);
  assert.equal(relationOf(res.state, 'snape'), 0);
  assert.equal(res.state.journal.at(-1).kind, 'rel');
});

test('нечисловой сдвиг не применяется', () => {
  const res = changeRelation(base(), { teacherId: 'petrova', delta: 'много' }, preset);
  assert.equal(res.applied, false);
  assert.equal(relationOf(res.state, 'petrova'), preset.relations.start);
});

test('состояние не правится на месте', () => {
  const s0 = base();
  const before = JSON.stringify(s0);
  changeRelation(s0, { teacherId: 'petrova', delta: -2 }, preset);
  assert.equal(JSON.stringify(s0), before);
});

test('пачка сдвигов применяется подряд и собирает переходы', () => {
  const res = applyRelationDeltas(base(), [
    { teacherId: 'petrova', delta: -2 },
    { teacherId: 'sidorov', delta: 2 },
  ], preset);
  assert.equal(relationOf(res.state, 'petrova'), -2);
  assert.equal(relationOf(res.state, 'sidorov'), 2);
  assert.equal(res.crossed.length, 2);
  assert.deepEqual(res.crossed.map((c) => c.teacherId), ['petrova', 'sidorov']);
});

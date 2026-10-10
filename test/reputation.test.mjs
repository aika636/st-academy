import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState, takePending } from '../core/state.mjs';
import {
  changeReputation, reputationLabel, warnText, expelText, INJECT_WARN, INJECT_EXPEL,
} from '../core/reputation.mjs';
import { mark } from '../core/attendance.mjs';
import { setDebt } from '../core/gradebook.mjs';
import { parsePreset } from './preset-file.mjs';

const preset = parsePreset(readFileSync(new URL('../presets/ru-university.json', import.meta.url), 'utf8'));

const base = () => createState(preset, {
  startDay: '2024-09-02',
  teachers: [{ id: 'petrova', name: 'Петрова' }, { id: 'sidorov', name: 'Сидоров' }],
  subjects: [
    { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
    { id: 'physics', name: 'физика', teacherId: 'sidorov' },
  ],
});

const move = (state, delta) => changeReputation(state, { delta }, preset).state;
const day = (n) => `2024-${String(9 + Math.floor(n / 28)).padStart(2, '0')}-${String((n % 28) + 1).padStart(2, '0')}`;

test('репутация зажимается на границах пресета', () => {
  const { min, max } = preset.reputation;
  assert.equal(move(base(), 1000).reputation.value, max);
  assert.equal(move(base(), -1000).reputation.value, min);

  const top = move(base(), 1000);
  assert.equal(changeReputation(top, { delta: 5 }, preset).applied, false);
});

test('наружу уходит слово, а не число', () => {
  const label = reputationLabel(base(), preset);
  assert.equal(typeof label, 'string');
  assert.ok(!/^-?\d+([.,]\d+)?$/.test(label), `ярлык не должен быть числом: ${label}`);
  assert.ok(preset.reputation.labels.some((l) => l.label === label));
  assert.notEqual(reputationLabel(move(base(), -30), preset), label);
});

// --- 3.5: одноразовость инжекта ---------------------------------------------

test('порог предупреждения ставит ровно один одноразовый инжект', () => {
  const { warnAt, start } = preset.reputation;
  const first = changeReputation(base(), { delta: warnAt - start }, preset);

  assert.equal(first.crossedWarn, true);
  assert.equal(first.expelled, false);
  assert.equal(first.state.reputation.warned, true);
  assert.equal(first.state.pending.length, 1);
  assert.equal(first.state.pending[0].id, INJECT_WARN);

  // Каждое следующее сообщение ниже порога нового инжекта не ставит.
  let s = first.state;
  for (let i = 0; i < 5; i += 1) {
    const res = changeReputation(s, { delta: -1 }, preset);
    assert.equal(res.crossedWarn, false, 'порог пробивается один раз, а не на каждом сообщении');
    s = res.state;
  }
  assert.equal(s.pending.filter((p) => p.id === INJECT_WARN).length, 1);

  // Инжект снят по ответу модели — и заново не встаёт: он одноразовый.
  const taken = takePending(s);
  assert.equal(taken.length, 1);
  const after = changeReputation(s, { delta: -1 }, preset);
  assert.deepEqual(after.state.pending, []);
});

test('текст инжекта собран из лексики пресета, а не зашит в код', () => {
  const { warnAt, start } = preset.reputation;
  const warned = changeReputation(base(), { delta: warnAt - start }, preset).state;
  const text = warned.pending[0].text;

  // В пресете лежит готовая формулировка (3.5: не справка, а уже случившийся
  // факт в повелительном тоне) — она и уходит в инжект дословно.
  assert.equal(text, preset.vocab.warnInject);
  assert.equal(text, warnText(preset, warned));

  // Пресет чужого сеттинга подставляет свои слова, правок в core/ не требуется.
  const hogwarts = {
    ...preset,
    vocab: {
      ...preset.vocab,
      warnInject: 'The Head of House has summoned her: one more absence means expulsion.',
      expelInject: 'She has been expelled. Play out what follows.',
    },
  };
  assert.ok(warnText(hogwarts, warned).includes('Head of House'));
  assert.ok(expelText(hogwarts).includes('expelled'));

  // Готовой формулировки может и не быть — тогда текст собирается из отдельных
  // слов пресета, и он всё равно на языке пресета, а не зашит в код.
  const bare = { ...preset, vocab: { ...preset.vocab, warnInject: undefined, expelInject: undefined } };
  const fallback = warnText(bare, warned);
  assert.ok(fallback.includes(preset.vocab.warning), `в тексте должна быть лексика пресета: ${fallback}`);
  assert.ok(fallback.includes(reputationLabel(warned, preset)));
});

test('отчисление старше предупреждения: один удар — один инжект', () => {
  const { expelAt, start } = preset.reputation;
  const res = changeReputation(base(), { delta: expelAt - start }, preset);

  assert.equal(res.expelled, true);
  assert.equal(res.state.reputation.expelled, true);
  assert.equal(res.state.pending.length, 1);
  assert.equal(res.state.pending[0].id, INJECT_EXPEL);
  assert.equal(res.state.pending[0].text, expelText(preset));

  // Дальнейшие удары инжект не дублируют.
  const more = changeReputation(res.state, { delta: -10 }, preset);
  assert.equal(more.state.pending.filter((p) => p.id === INJECT_EXPEL).length, 1);
});

// --- то, ради чего шкала существует -----------------------------------------

test('прогульщицу доводит до отчисления', () => {
  let s = base();
  let expelledAt = null;

  for (let n = 0; n < 40 && !expelledAt; n += 1) {
    for (const subjectId of ['chemistry', 'physics']) {
      const att = mark(s, { subjectId, status: 'skip', day: day(n), periodIndex: 0 }, preset);
      s = att.state;
      for (const id of att.effects.debt) s = setDebt(s, id, true, preset);

      const rep = changeReputation(s, { delta: att.effects.reputation, reason: 'skip' }, preset);
      s = rep.state;
      if (rep.expelled) { expelledAt = n; break; }
    }
  }

  assert.ok(expelledAt !== null, 'бесконечные прогулы обязаны кончаться отчислением');
  assert.equal(s.reputation.value, preset.reputation.min);
  assert.equal(s.reputation.warned, true, 'перед порогом должно быть предупреждение');
  assert.equal(reputationLabel(s, preset), preset.reputation.labels[0].label);
  assert.deepEqual(
    s.pending.map((p) => p.id).sort(),
    [INJECT_EXPEL, INJECT_WARN].sort(),
    'по одному инжекту на каждый пробитый порог, не больше',
  );
});

test('состояние не правится на месте', () => {
  const s0 = base();
  const before = JSON.stringify(s0);
  changeReputation(s0, { delta: -50 }, preset);
  assert.equal(JSON.stringify(s0), before);
});

test('нечисловой сдвиг не применяется', () => {
  const res = changeReputation(base(), { delta: null }, preset);
  assert.equal(res.applied, false);
  assert.equal(res.state.reputation.value, preset.reputation.start);
});

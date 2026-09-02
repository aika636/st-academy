import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createState, takePending } from '../core/state.mjs';
import {
  scheduleExams, rollOutcome, applyOutcome, resolveConflict, examMode, permissionLine,
  outcomeLadder, autoValue, outcomeWeights, retakesLeft, DEFAULTS,
} from '../core/exams.mjs';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));

/** Семестр из двух предметов с назначенными преподавателями. */
function semester(opts = {}) {
  const state = createState(preset, {
    startDay: '2024-09-02',
    subjects: [
      { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
      { id: 'physics', name: 'физика', teacherId: 'ivanov' },
    ],
    teachers: [
      { id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['злопамятна'], relation: -3 },
      { id: 'ivanov', name: 'Иванов Пётр Ильич', traits: ['добродушен'], relation: 2 },
    ],
    ...opts,
  });
  return scheduleExams(state, preset, { day: '2024-12-20' });
}

/** Подставной rng: конечная лента чисел по кругу — исход обязан быть воспроизводим. */
const tape = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

const passing = (value) => preset.grades.values.find((v) => v.value === value).pass;

// --- шкала ------------------------------------------------------------------

test('лестница исходов строится из пресета и схлопывает дубли по весу', () => {
  assert.deepEqual(outcomeLadder(preset, 'exam').map((v) => v.value), ['5', '4', '3', '2']);
  assert.deepEqual(outcomeLadder(preset, 'credit').map((v) => v.value), ['зачёт', 'незачёт']);
  // «автомат» стоит теми же пятью баллами, что и «5», и в лестницу не попадает,
  // зато он и есть то, что ставят без испытания.
  assert.equal(autoValue(preset, 'exam'), 'автомат');
  assert.equal(autoValue(preset, 'credit'), 'зачёт');
});

// --- зажатая случайность (прямое требование 3.5) -----------------------------

test('отличница не заваливается: тысяча прогонов, ни одной незачётной оценки', () => {
  const outcomes = new Set();
  for (let i = 0; i < 1000; i += 1) {
    const luck = i / 1000; // вся лента случайности целиком, а не выборка
    const { value } = rollOutcome({ score: 4.4, relation: 0, kind: 'exam' }, preset, tape(luck));
    assert.ok(passing(value), `на балле 4.4 выпало «${value}» при случайности ${luck}`);
    outcomes.add(value);
  }
  // И не потому, что исход всегда один и тот же: разброс есть, просто он сверху.
  assert.ok(outcomes.size > 1, `разброса нет вовсе: ${[...outcomes]}`);
});

test('отличница не заваливается даже у ненавидящего преподавателя', () => {
  for (let i = 0; i < 1000; i += 1) {
    const { value } = rollOutcome({ score: 4.4, relation: preset.relations.min, kind: 'exam' }, preset, tape(i / 1000));
    assert.ok(passing(value), `на балле 4.4 и худшем отношении выпало «${value}»`);
  }
});

test('зажим держится и против пресета, выкрутившего случайность в лотерею', () => {
  const lottery = { ...preset, exams: { ...preset.exams, weights: { score: 1, relation: 1, luck: 100 } } };
  const w = outcomeWeights(lottery);
  assert.ok(w.luck <= DEFAULTS.maxLuck, `доля случая ${w.luck} выше потолка`);
  for (let i = 0; i < 1000; i += 1) {
    const { value } = rollOutcome({ score: 4.4, relation: 0, kind: 'exam' }, lottery, tape(i / 1000));
    assert.ok(passing(value), `лотерейный пресет уронил отличницу до «${value}»`);
  }
});

test('двоечница не получает автомат и не получает высшую оценку', () => {
  for (let i = 0; i < 1000; i += 1) {
    const { value, reason } = rollOutcome({ score: 2.0, relation: preset.relations.max, kind: 'exam' }, preset, tape(i / 1000));
    assert.notEqual(reason, 'auto');
    assert.ok(value !== 'автомат' && value !== '5', `на балле 2.0 выпало «${value}»`);
  }
});

test('автомат — только по порогу пресета, и это не бросок', () => {
  const below = rollOutcome({ score: preset.exams.autoPassScore - 0.1, relation: 0, kind: 'exam' }, preset, tape(0.99));
  const above = rollOutcome({ score: preset.exams.autoPassScore, relation: 0, kind: 'exam' }, preset, tape(0));
  assert.notEqual(below.value, 'автомат');
  assert.equal(above.value, 'автомат');
  assert.equal(above.reason, 'auto');
});

test('исход воспроизводим при подставном rng', () => {
  const args = { score: 3.4, relation: -3, kind: 'exam' };
  const a = rollOutcome(args, preset, tape(0.1, 0.9));
  const b = rollOutcome(args, preset, tape(0.1, 0.9));
  assert.deepEqual({ v: a.value, r: a.roll }, { v: b.value, r: b.roll });
  // Разная случайность — разный исход: rng действительно участвует.
  const c = rollOutcome(args, preset, tape(0.99));
  const d = rollOutcome(args, preset, tape(0.0));
  assert.notEqual(c.value, d.value);
});

test('зачёт даёт только значения своей шкалы', () => {
  for (let i = 0; i < 200; i += 1) {
    const { value } = rollOutcome({ score: 2 + (i / 100), relation: 0, kind: 'credit' }, preset, tape(i / 200));
    assert.ok(['зачёт', 'незачёт', 'автомат'].includes(value), `в зачёте выпало «${value}»`);
  }
});

test('чужой сеттинг обходится правкой пресета, а не правкой ядра', () => {
  const hogwarts = {
    id: 'hogwarts',
    vocab: { examPeriod: 'exams', teacher: 'professor', debt: 'incomplete', score: 'marks' },
    grades: {
      values: [
        { value: 'O', points: 5, pass: true, label: 'Outstanding' },
        { value: 'E', points: 4, pass: true, label: 'Exceeds Expectations' },
        { value: 'A', points: 3, pass: true, label: 'Acceptable' },
        { value: 'P', points: 2, pass: false, label: 'Poor' },
      ],
      passMark: 3,
    },
    relations: { min: -5, max: 5, start: 0 },
    exams: { kinds: [{ id: 'owl', name: 'O.W.L.', scale: 'points' }], retakes: 1, autoPassScore: 4.5 },
    limits: { journalSize: 50 },
  };
  const values = new Set();
  for (let i = 0; i < 200; i += 1) {
    values.add(rollOutcome({ score: 4.4, relation: 0, kind: 'owl' }, hogwarts, tape(i / 200)).value);
  }
  assert.ok([...values].every((v) => ['O', 'E', 'A'].includes(v)), `выпало лишнее: ${[...values]}`);
});

// --- назначение сессии ------------------------------------------------------

test('сессия заводит по контрольному событию на предмет и не дублирует их', () => {
  const state = semester();
  assert.equal(state.exams.active, true);
  assert.deepEqual(state.exams.items.map((i) => i.subjectId), ['chemistry', 'physics']);
  assert.ok(state.exams.items.every((i) => preset.exams.kinds.some((k) => k.id === i.kind)));
  assert.ok(state.exams.items.every((i) => i.day === '2024-12-20' && i.outcome === null && i.attempts === 0));

  const again = scheduleExams(state, preset, { day: '2024-12-21' });
  assert.equal(again.exams.items.length, 2);
  // Исходное состояние не тронуто: ядро чистое.
  assert.equal(state.exams.items[0].day, '2024-12-20');
});

test('режим сессии перечисляет несданное и остаток дней', () => {
  const state = semester();
  const before = examMode(state, preset);
  assert.equal(before.active, true);
  assert.equal(before.pending.length, 2);
  assert.equal(typeof before.daysLeft, 'number');

  const { state: after } = applyOutcome(state, { examId: '0:chemistry:credit', value: 'зачёт', day: '2024-12-20' }, preset);
  assert.equal(examMode(after, preset).pending.length, 1);
});

// --- одноразовый инжект -----------------------------------------------------

test('исход записывается, а инжект ставится один раз и снимается takePending', () => {
  const state = semester();
  const examId = state.exams.items[0].id;
  const { state: after, pending } = applyOutcome(state, { examId, value: 'зачёт', day: '2024-12-20' }, preset);

  const item = after.exams.items.find((i) => i.id === examId);
  assert.equal(item.outcome, 'зачёт');
  assert.equal(item.attempts, 1);
  assert.deepEqual(after.subjects[0].grades, [{ value: 'зачёт', day: '2024-12-20' }]);
  assert.equal(after.subjects[0].debt, false);

  assert.equal(after.pending.length, 1);
  assert.equal(after.pending[0].id, pending.id);
  assert.ok(pending.text.includes('аналитическая химия'));
  assert.equal(takePending(after).length, 1);
  assert.equal(takePending(after).length, 0);
  assert.ok(after.journal.some((e) => e.kind === 'exam'));
});

test('провал даёт пересдачу, а исчерпанные попытки — хвост', () => {
  let state = semester();
  const examId = state.exams.items[0].id;
  const allowed = 1 + preset.exams.retakes;

  for (let attempt = 1; attempt <= allowed; attempt += 1) {
    const res = applyOutcome(state, { examId, value: 'незачёт', day: '2024-12-20' }, preset);
    state = res.state;
    const item = state.exams.items.find((i) => i.id === examId);
    assert.equal(item.attempts, attempt);
    assert.equal(retakesLeft(preset, item), allowed - attempt);
    // Инжект у каждой попытки свой: пересдача не должна съедаться как дубль.
    assert.equal(state.pending.length, attempt);
    assert.equal(state.subjects[0].debt, attempt === allowed);
  }
});

test('фразы инжекта берутся из пресета, а не из кода', () => {
  const custom = { ...preset, phrases: { exams: { passed: 'DONE {subject} {value}', auto: 'AUTO {subject}' } } };
  const { pending } = applyOutcome(semester(), { examId: '0:chemistry:credit', value: 'зачёт', day: '2024-12-20' }, custom);
  assert.equal(pending.text, 'DONE аналитическая химия зачёт');

  // Автомат по шкале «зачёт/незачёт» неотличим от обычной сдачи по значению —
  // отличает его причина исхода, приехавшая из rollOutcome.
  const auto = applyOutcome(semester(), { examId: '0:chemistry:credit', value: 'зачёт', day: '2024-12-20', reason: 'auto' }, custom);
  assert.equal(auto.pending.text, 'AUTO аналитическая химия');
});

// --- «считает расширение, но не задним числом» -------------------------------

test('модель отыграла своё — принимается версия модели, расхождение в журнал', () => {
  const start = semester();
  const examId = start.exams.items[1].id; // физика, экзамен
  const { state: computed } = applyOutcome(start, { examId, value: '2', day: '2024-12-25' }, preset);
  assert.equal(computed.pending.length, 1);

  const { state: after, divergence } = resolveConflict(computed, { examId, modelSaid: '5' }, preset);

  assert.equal(after.exams.items[1].outcome, '5');
  assert.equal(divergence.applied, true);
  assert.deepEqual(
    { computed: divergence.computed, said: divergence.modelSaid },
    { computed: '2', said: '5' },
  );
  // Оценка в зачётке переписана, а не удвоена.
  assert.deepEqual(after.subjects[1].grades, [{ value: '5', day: '2024-12-25' }]);
  assert.equal(after.subjects[1].debt, false);
  // Ставший ложью приказ снят: модель уже отыграла своё.
  assert.equal(after.pending.length, 0);
  assert.ok(after.journal.some((e) => e.kind === 'exam' && e.data && e.data.applied === true));
  // Спорить не с чем: посчитанное состояние осталось нетронутым как объект.
  assert.equal(computed.exams.items[1].outcome, '2');
});

test('совпадение с посчитанным расхождением не считается, синонимы понимаются', () => {
  const examId = '0:chemistry:credit';
  const { state } = applyOutcome(semester(), { examId, value: 'зачёт', day: '2024-12-20' }, preset);
  const same = resolveConflict(state, { examId, modelSaid: 'зачет' }, preset);
  assert.equal(same.divergence, null);
  assert.equal(same.state.exams.items[0].outcome, 'зачёт');
});

test('невнятное значение от модели не переписывает исход, а уходит в отладку', () => {
  const examId = '0:chemistry:credit';
  const { state } = applyOutcome(semester(), { examId, value: 'зачёт', day: '2024-12-20' }, preset);
  const { state: after, divergence } = resolveConflict(state, { examId, modelSaid: 'блестяще' }, preset);
  assert.equal(divergence.applied, false);
  assert.equal(after.exams.items[0].outcome, 'зачёт');
  // Расхождение пишется в журнал под тем же `kind`, что и принятое: обе ветки —
  // один и тот же факт, а различает их поле `applied`, а не имя записи.
  const record = after.journal.find((e) => e.data && e.data.modelSaid === 'блестяще');
  assert.ok(record, 'расхождение обязано быть в журнале');
  assert.equal(record.kind, 'exam');
  assert.equal(record.data.applied, false);
  // И в хронику лорбука такая запись не уходит: там `kind: 'exam'` значим
  // только при выставленном значении (`data.value`), которого у расхождения нет.
  assert.equal(record.data.value, undefined);
});

// --- разрешено / запрещено --------------------------------------------------

test('фраза о разрешённом и запрещённом зависит от балла', () => {
  const state = semester();
  const high = permissionLine(state, preset, { subjectId: 'chemistry', score: 4.8 });
  const mid = permissionLine(state, preset, { subjectId: 'chemistry', score: 3.4 });
  const low = permissionLine(state, preset, { subjectId: 'chemistry', score: 2.2 });

  assert.ok(new Set([high, mid, low]).size === 3, 'три разных балла дали одинаковую фразу');
  for (const line of [high, mid, low]) {
    assert.ok(line.includes(preset.vocab.examPeriod), 'нет слова из словаря пресета');
    assert.ok(line.includes('аналитическая химия'));
    assert.ok(!/\{\w+\}/.test(line), `остался неподставленный плейсхолдер: ${line}`);
  }
  assert.ok(mid.includes('Петрова Анна Сергеевна'));
  assert.ok(mid.includes(autoValue(preset, 'credit')), 'не сказано, чего именно нельзя');
});

test('фраза разрешения перекрывается пресетом', () => {
  const custom = { ...preset, phrases: { exams: { permissionRisk: 'NO AUTO FOR {subject}' } } };
  assert.equal(
    permissionLine(semester(), custom, { subjectId: 'physics', score: 2.0 }),
    'NO AUTO FOR физика',
  );
});

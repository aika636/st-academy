// test/dc — экзамен как видимая проверка против сложности (план 9.4.1).
//
// Что закрепляется здесь, а не в `exams.test.mjs`:
//
// - сложность складывается из имён и целых чисел, и репутация — одно из них
//   (вопрос 8.8 закрыт весом, который видно);
// - ступени и их отображение на шкалу пресета: высшая — только за крит, крит —
//   по запасу, а не по натуральной двадцатке;
// - воспроизводимый бросок от seed: свайп не выбивает исход (9.3.9);
// - история бросков в состоянии и полная проверка в журнале;
// - у всех трёх пресетов свой блок `exams.dc`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createState, validateState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import {
  scheduleExams, rollOutcome, examDC, checkTier, dcParams, rollDie, fnv1a, seededRng, examSeed,
  applyOutcome, resolveConflict, rollRecord, outcomeLadder, isPassing, DEFAULTS, TIERS,
} from '../core/exams.mjs';
import { applyResponse, sitExam } from '../core/engine.mjs';
import { describeCheck, describeApplied } from '../ui.js';

const load = (file) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${file}`, import.meta.url)), 'utf8'));
const RU = load('ru-university.json');
const PRESETS = ['ru-university.json', 'jp-highschool.json', 'magic-academy.json'].map(load);

/** rng, который даёт ровно этот d20: середина соответствующей двадцатой доли. */
const die = (n) => () => (n - 0.5) / 20;

const SUBJECTS = [
  { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'ivanov' },
];
const TEACHERS = [
  { id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['злопамятна'], relation: -3 },
  { id: 'ivanov', name: 'Иванов Пётр Ильич', traits: ['добродушен'], relation: 2 },
];

function session(preset = RU) {
  const s = createState(preset, {
    startDay: '2024-09-02', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
  });
  s.started = true;
  s.calendar.day = '2024-12-24';
  return scheduleExams(s, preset, { day: '2024-12-24' });
}

// --- сложность --------------------------------------------------------------

test('DC — база вида минус целые поправки, и сумма сходится на глаз', () => {
  const check = examDC({ score: 3.5, relation: -3, reputation: 30, kind: 'exam' }, RU);
  assert.equal(check.base, 8, 'база вида из пресета');
  for (const v of Object.values(check.mods)) assert.ok(Number.isInteger(v), `поправка ${v} не целая`);
  assert.equal(check.dc, check.base - check.mods.score - check.mods.relation - check.mods.reputation);
  // 24 × (3.5 − 3) / 3 = 4; 6 × (−3 − 0) / 10 = −1.8 → −2; 6 × (30 − 50) / 100 = −1.2 → −1.
  assert.deepEqual(check.mods, { score: 4, relation: -2, reputation: -1 });
  assert.equal(check.dc, 7);
});

test('нейтральное всё — сложность равна базе вида', () => {
  const r = RU.relations;
  const rep = RU.reputation;
  for (const kind of RU.exams.kinds) {
    const c = examDC({ score: RU.grades.passMark, relation: r.start, reputation: rep.start, kind: kind.id }, RU);
    assert.equal(c.dc, kind.dc, `${kind.id}: на проходном балле у нейтрального наставника DC не равен базе`);
    assert.deepEqual(c.mods, { score: 0, relation: 0, reputation: 0 });
  }
});

test('репутация двигает сложность в обе стороны, и вес виден числом (8.8)', () => {
  const at = (reputation) => examDC({ score: 3, relation: 0, reputation, kind: 'exam' }, RU);
  const low = at(RU.reputation.warnAt);
  const mid = at(RU.reputation.start);
  const high = at(RU.reputation.max);
  assert.ok(low.dc > mid.dc, 'предупреждённой сдавать труднее');
  assert.ok(high.dc < mid.dc, 'гордости факультета — легче');
  assert.equal(high.mods.reputation, RU.exams.dc.reputation / 2, 'от старта до потолка — половина веса');
  // Без репутации в вызове поправки нет, а не штраф: отсутствие сведений — не повод валить.
  assert.equal(examDC({ score: 3, relation: 0, kind: 'exam' }, RU).mods.reputation, 0);
});

test('сложность не прячет минус-ноль: округлённое слагаемое печатается как 0', () => {
  const c = examDC({ score: 3, relation: -0.1, reputation: 49, kind: 'exam' }, RU);
  assert.ok(Object.is(c.mods.relation, 0) && Object.is(c.mods.reputation, 0), JSON.stringify(c.mods));
});

test('пресет без блока dc получает умолчания кода, мусор в блоке — тоже', () => {
  const bare = { ...RU, exams: { ...RU.exams, dc: undefined, kinds: RU.exams.kinds.map(({ dc, ...k }) => k) } };
  const p = dcParams(bare);
  assert.equal(p.base, DEFAULTS.dc.base);
  assert.equal(p.score, DEFAULTS.dc.score);
  assert.equal(p.safeScore, (RU.grades.passMark + RU.exams.autoPassScore) / 2, 'страховка — середина до автомата');
  assert.equal(examDC({ score: 3, relation: 0, reputation: 50, kind: 'exam' }, bare).dc, DEFAULTS.dc.base);

  const junk = { ...RU, exams: { ...RU.exams, dc: { base: 'много', score: -5, critMargin: 0 } } };
  assert.equal(dcParams(junk).score, DEFAULTS.dc.score, 'отрицательный вес — умолчание');
  assert.equal(dcParams(junk).critMargin, DEFAULTS.dc.critMargin, 'нулевой запас крита — умолчание');
  assert.equal(dcParams(junk).base, DEFAULTS.dc.base);
});

// --- ступени ----------------------------------------------------------------

test('ступень — по запасу над DC, натуральные 1 и 20 сами ничего не решают', () => {
  const crit = RU.exams.dc.critMargin;
  assert.equal(checkTier(10, 10, RU), 'success', 'ровно DC — успех');
  assert.equal(checkTier(9, 10, RU), 'fail');
  assert.equal(checkTier(10 + crit, 10, RU), 'critSuccess');
  assert.equal(checkTier(10 - crit, 10, RU), 'critFail');
  assert.equal(checkTier(20, 15, RU), 'success', 'двадцатка без запаса — не крит');
  assert.equal(checkTier(1, -5, RU), 'success', 'единица при низком DC — не провал');
  assert.deepEqual(TIERS, ['critFail', 'fail', 'success', 'critSuccess']);
});

test('d20 из rng: весь отрезок [0, 1) даёт ровно 1…20, мусор — середину', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i += 1) seen.add(rollDie(() => i / 2000));
  assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(rollDie(() => 1), 20, 'единица из кривого rng не даёт 21');
  assert.equal(rollDie(() => NaN), 11);
  assert.equal(rollDie(undefined), 11);
});

test('отображение ступеней на шкалу пресета', () => {
  const magic = PRESETS.find((p) => p.id === 'magic-academy');
  const ladder = outcomeLadder(magic, 'trial').map((v) => v.value);
  assert.deepEqual(ladder, ['триумф', 'искусно', 'сносно', 'слабо', 'провал']);
  const base = magic.exams.kinds.find((k) => k.id === 'trial').dc;
  const at = (n) => rollOutcome({ score: magic.grades.passMark, relation: 0, reputation: magic.reputation.start, kind: 'trial' }, magic, die(n));

  assert.equal(at(base).check.dc, base);
  assert.equal(at(base + 10).value, 'триумф', 'крит — высшая');
  assert.equal(at(base).value, 'сносно', 'успех без запаса — низшая проходная');
  assert.equal(at(base + 5).value, 'искусно', 'полкрита запаса — ступенью выше');
  assert.equal(at(base - 1).value, 'слабо', 'провал — лучшая из непроходных');
  assert.equal(at(1).check.tier, 'fail', `при DC ${base} единица — недобор ${base - 1}, ещё не крит`);

  // Крит-провал нужен недобор в critMargin: поднимем сложность злым наставником.
  const hard = rollOutcome({ score: magic.grades.passMark, relation: magic.relations.min, reputation: magic.reputation.min, kind: 'trial' }, magic, die(1));
  assert.equal(hard.check.tier, 'critFail', JSON.stringify(hard.check));
  assert.equal(hard.value, 'провал', 'крит-провал — худшая из непроходных');
});

test('шкала «сдал/не сдал»: успех и крит дают одно слово, провал — другое', () => {
  for (let n = 1; n <= 20; n += 1) {
    const r = rollOutcome({ score: 3, relation: 0, reputation: 50, kind: 'credit' }, RU, die(n));
    const expected = r.check.margin >= 0 ? 'зачёт' : 'незачёт';
    assert.equal(r.value, expected, `d20 = ${n}, DC ${r.check.dc}`);
  }
});

test('страховка балла видна флагом, а не спрятана в сумме', () => {
  const safe = RU.exams.dc.safeScore;
  const hard = { ...RU, exams: { ...RU.exams, kinds: RU.exams.kinds.map((k) => ({ ...k, dc: 30 })) } };
  const saved = rollOutcome({ score: safe, relation: 0, reputation: 50, kind: 'exam' }, hard, die(1));
  assert.equal(saved.check.tier, 'critFail', 'сама проверка провалена');
  assert.equal(saved.check.saved, true);
  assert.equal(saved.value, '3', 'засчитано низшей проходной');

  const below = rollOutcome({ score: safe - 0.01, relation: 0, reputation: 50, kind: 'exam' }, hard, die(1));
  assert.equal(below.check.saved, false, 'ниже порога страховки не спасает');
  assert.equal(isPassing(RU, below.value), false);
});

test('автомат — не бросок: проверки нет, rng не спрашивается', () => {
  let asked = 0;
  const r = rollOutcome({ score: RU.exams.autoPassScore, relation: 0, reputation: 50, kind: 'exam' }, RU, () => { asked += 1; return 0.5; });
  assert.equal(r.reason, 'auto');
  assert.equal(r.check, null);
  assert.equal(r.roll, null);
  assert.equal(asked, 0);
});

// --- воспроизводимый бросок -------------------------------------------------

test('FNV-1a и поток от seed: одна строка — одна последовательность', () => {
  assert.equal(fnv1a(''), 0x811c9dc5, 'пустая строка — начальное смещение FNV');
  assert.equal(fnv1a('a'), 0xe40c292c, 'эталон FNV-1a/32 для «a»');
  const a = seededRng('чат-1|0:chemistry:credit|1|2024-12-24');
  const b = seededRng('чат-1|0:chemistry:credit|1|2024-12-24');
  const c = seededRng('чат-1|0:chemistry:credit|2|2024-12-24');
  const first = [a(), a(), a()];
  assert.deepEqual([b(), b(), b()], first);
  assert.notDeepEqual([c(), c(), c()], first, 'другая попытка — другой бросок');
  for (const x of first) assert.ok(x >= 0 && x < 1);
});

test('seed раскладывается по d20 без перекоса', () => {
  const counts = new Array(21).fill(0);
  for (let i = 0; i < 4000; i += 1) counts[rollDie(seededRng(`чат|событие|${i}|день`))] += 1;
  for (let n = 1; n <= 20; n += 1) {
    assert.ok(counts[n] > 120 && counts[n] < 280, `грань ${n}: ${counts[n]} из 4000`);
  }
});

test('seed попытки: чат, событие, номер попытки и день', () => {
  const item = { id: '0:chemistry:credit', attempts: 1 };
  assert.equal(examSeed('abc', item, '2024-12-24'), 'abc|0:chemistry:credit|2|2024-12-24');
  assert.equal(examSeed(undefined, { id: 'x' }, ''), '|x|1|');
});

test('sitExam с seed: тот же снимок — тот же исход, как ни свайпай', () => {
  const s = session();
  const results = new Set();
  for (let i = 0; i < 5; i += 1) {
    const r = sitExam(s, RU, { seed: 'chat-42' });
    results.add(JSON.stringify(r.exam.check));
  }
  assert.equal(results.size, 1, 'свайп выбил исход');

  // Другой чат — в общем случае другой бросок: из десяти чатов хоть один да разный.
  const others = new Set();
  for (let i = 0; i < 10; i += 1) others.add(sitExam(s, RU, { seed: `chat-${i}` }).exam.check.roll);
  assert.ok(others.size > 1, 'seed чата в броске не участвует');
});

test('rng сильнее seed; без обоих — прежний Math.random', () => {
  const s = session();
  const r = sitExam(s, RU, { seed: 'chat-42', rng: die(20) });
  assert.equal(r.exam.check.roll, 20);

  const real = Math.random;
  Math.random = die(1);
  try {
    assert.equal(sitExam(s, RU, {}).exam.check.roll, 1);
  } finally {
    Math.random = real;
  }
});

test('applyResponse пробрасывает seed до броска', () => {
  const s = session();
  s.calendar.day = '2024-12-23';
  const text = 'Сессия.\n<!-- [ACADEMY t=+1 day] -->';
  const a = applyResponse(s, text, RU, { mode: 'marker', exam: true, seed: 'chat-7' });
  const b = applyResponse(s, text, RU, { mode: 'marker', exam: true, seed: 'chat-7' });
  assert.ok(a.exam && a.exam.check, 'контрольное состоялось с проверкой');
  assert.deepEqual(a.exam, b.exam);
});

// --- что остаётся в состоянии -------------------------------------------------

test('история бросков — компактно на событии, полная проверка — в журнале', () => {
  const s = session();
  const r = sitExam(s, RU, { rng: die(4) });
  const item = r.state.exams.items.find((i) => i.id === r.exam.examId);
  assert.equal(item.rolls.length, 1);
  assert.deepEqual(Object.keys(item.rolls[0]).sort(), ['day', 'dc', 'roll', 'tier', 'value']);
  assert.equal(item.rolls[0].roll, 4);
  assert.equal(item.rolls[0].value, item.outcome);

  const rec = r.state.journal.filter((e) => e.kind === 'exam' && e.data && e.data.check).at(-1);
  assert.ok(rec, 'проверка ушла в журнал');
  assert.deepEqual(rec.data.check, r.exam.check);
  assert.deepEqual(validateState(r.state, RU).errors, []);
});

test('пересдача дописывает строку истории, а не переписывает первую', () => {
  let s = session();
  const first = sitExam(s, RU, { rng: die(1) });
  s = first.state;
  const again = sitExam(s, RU, { rng: die(1), examId: first.exam.examId });
  const item = again.state.exams.items.find((i) => i.id === first.exam.examId);
  assert.equal(item.attempts, 2);
  assert.equal(item.rolls.length, 2);
});

test('версия модели историю бросков не стирает: что выпало — то выпало', () => {
  const s = session();
  const r = sitExam(s, RU, { rng: die(1), modelSaid: 'зачёт' });
  const item = r.state.exams.items.find((i) => i.id === r.exam.examId);
  assert.equal(item.outcome, 'зачёт');
  assert.equal(item.modelOverride, true);
  assert.equal(item.rolls.length, 1);
  assert.equal(item.rolls[0].value, 'незачёт', 'в истории — посчитанное');
  // resolveConflict — прежний маршрут, он и принял версию модели.
  assert.ok(r.divergence && r.divergence.applied);
});

test('автомат оставляет строку истории без броска; исход руками — не оставляет', () => {
  assert.deepEqual(rollRecord({ day: '2024-12-24', value: 'автомат', reason: 'auto' }), { day: '2024-12-24', tier: 'auto', value: 'автомат' });
  assert.equal(rollRecord({ day: '2024-12-24', value: '4', reason: 'roll' }), null);
  const s = session();
  const res = applyOutcome(s, { examId: s.exams.items[0].id, value: 'зачёт', day: '2024-12-24' }, RU);
  assert.equal(res.state.exams.items[0].rolls, undefined);
  // И resolveConflict по такому событию работает как раньше.
  assert.equal(resolveConflict(res.state, { examId: s.exams.items[0].id, modelSaid: 'незачёт' }, RU).divergence.applied, true);
});

test('состояние с кривой историей бросков валидация ловит', () => {
  const s = session();
  s.exams.items[0].rolls = 'много';
  assert.ok(validateState(s, RU).errors.some((e) => e.includes('истори')));
});

// --- отладка ----------------------------------------------------------------

test('отладка объясняет исход: DC, слагаемые, бросок, ступень', () => {
  const line = describeCheck({ dc: 12, base: 14, mods: { score: 1, relation: 1, reputation: 0 }, roll: 15, tier: 'success', saved: false });
  assert.equal(line, 'DC 12 = 14 база − 1 балл − 1 отношение + 0 репутация; бросок 15 → успех');

  const s = session();
  const r = sitExam(s, RU, { rng: die(2) });
  const text = describeApplied({ kind: 'exam', ...r.exam }, RU.vocab);
  assert.ok(text.includes(`DC ${r.exam.check.dc} = ${r.exam.check.base} база`), text);
  assert.ok(text.includes('бросок 2 →'), text);

  const auto = describeApplied({ kind: 'exam', subjectId: 'x', value: 'автомат', reason: 'auto', check: null }, RU.vocab);
  assert.ok(auto.includes('без броска'), auto);
  assert.equal(describeCheck(null), '');
});

// --- пресеты ----------------------------------------------------------------

test('у каждого пресета свой блок dc и сложность у каждого вида', () => {
  for (const p of PRESETS) {
    const dc = p.exams.dc;
    assert.ok(dc && typeof dc === 'object', `${p.id}: нет exams.dc`);
    for (const key of ['base', 'score', 'relation', 'reputation', 'critMargin', 'safeScore']) {
      assert.ok(Number.isFinite(dc[key]), `${p.id}: exams.dc.${key}`);
    }
    assert.ok(dc.safeScore > p.grades.passMark && dc.safeScore < p.exams.autoPassScore,
      `${p.id}: страховка между проходным и автоматом`);
    for (const k of p.exams.kinds) assert.ok(Number.isFinite(k.dc), `${p.id}: у вида ${k.id} нет dc`);
    assert.equal(p.exams.weights, undefined, `${p.id}: веса старой формулы остались мёртвым грузом`);
    assert.equal(p.exams.maxLuck, undefined);
  }
});

test('каждый пресет: отличница не заваливается, двоечница не получает высшую', () => {
  for (const p of PRESETS) {
    const safe = p.exams.dc.safeScore;
    const points = p.grades.values.filter((v) => typeof v.points === 'number').map((v) => v.points);
    const worst = Math.min(...points);
    for (const kind of p.exams.kinds) {
      const top = outcomeLadder(p, kind.id)[0].value;
      const hasFail = outcomeLadder(p, kind.id).some((v) => v.pass === false);
      for (let n = 1; n <= 20; n += 1) {
        const strong = rollOutcome({ score: safe, relation: p.relations.min, reputation: p.reputation.warnAt, kind: kind.id }, p, die(n));
        assert.ok(isPassing(p, strong.value), `${p.id}/${kind.id}: отличница у злого наставника, d20=${n}: ${strong.value}`);
        const weak = rollOutcome({ score: worst + (p.grades.passMark - worst) / 2, relation: p.relations.max, reputation: p.reputation.max, kind: kind.id }, p, die(n));
        if (hasFail && outcomeLadder(p, kind.id).filter((v) => v.pass !== false).length > 1) {
          assert.notEqual(weak.value, top, `${p.id}/${kind.id}: двоечница получила высшую на d20=${n}`);
        }
      }
    }
  }
});

test('у середнячки у каждого пресета исход действительно разный', () => {
  for (const p of PRESETS) {
    for (const kind of p.exams.kinds) {
      const seen = new Set();
      for (let n = 1; n <= 20; n += 1) {
        seen.add(rollOutcome({ score: p.grades.passMark, relation: p.relations.start, reputation: p.reputation.start, kind: kind.id }, p, die(n)).value);
      }
      assert.ok(seen.size >= 2, `${p.id}/${kind.id}: на проходном балле исход не зависит от броска: ${[...seen]}`);
    }
  }
});

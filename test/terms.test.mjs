// Период вместо года и несевшее вместо тишины.
//
// Два правила, которые проверяет этот файл, и оба про границу учебного периода.
//
// 1. **Балл для исхода считается внутри периода** (`exams.examScore`). Годовой
//    балл делал триместры декорацией: первый на пятёрки — и третий сдаётся
//    автоматом. Здесь проверено и новое поведение у японского пресета, и
//    **неизменность** у пресетов с одним периодом: у них «год» и «период» — одно
//    и то же, и балл обязан остаться прежним до последнего знака.
// 2. **Несевшее закрытой сессии становится хвостом** (`exams.closeExamSession`).
//    Раньше оно исчезало с экрана молча при открытии следующей сессии. Проверено
//    на всех трёх пресетах, и отдельно — что слова берутся из словаря пресета, а
//    не из умолчания в коде.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState } from '../core/state.mjs';
import {
  addGrade, subjectScore, setDebt, gradesInTerm,
  DEBT_SKIPS, DEBT_MISSED, DEBT_EXAM,
} from '../core/gradebook.mjs';
import {
  scheduleExams, closeExamSession, examScore, applyOutcome, rollOutcome, examMode,
  DEFAULT_PHRASES, fill,
} from '../core/exams.mjs';
import { sitExam } from '../core/engine.mjs';

const load = (name) => JSON.parse(readFileSync(new URL(`../presets/${name}.json`, import.meta.url), 'utf8'));
const RU = load('ru-university');
const JP = load('jp-highschool');
const MAGIC = load('magic-academy');

/** Состояние из двух предметов с преподавателями. День начала — аргументом. */
function school(preset, startDay) {
  return createState(preset, {
    startDay,
    subjects: [
      { id: 'math', name: 'математика', teacherId: 'petrova' },
      { id: 'history', name: 'история', teacherId: 'ivanov' },
    ],
    teachers: [
      { id: 'petrova', name: 'Петрова', relation: 0 },
      { id: 'ivanov', name: 'Иванов', relation: 0 },
    ],
  });
}

const put = (state, preset, subjectId, value, day) =>
  addGrade(state, { subjectId, value, day }, preset).state;

/** Шкала вида события: у `pass`-вида веса нет, у остальных — есть. */
const scaleOf = (preset, kindId) => {
  const kind = (preset.exams.kinds || []).find((k) => k.id === kindId);
  return kind && kind.scale === 'pass' ? 'pass' : 'points';
};
const valueFor = (preset, kindId, pass) => preset.grades.values.find((v) => (
  Boolean(v.pass) === pass && (scaleOf(preset, kindId) === 'pass' ? v.points === null : typeof v.points === 'number')
)).value;

/** Записи журнала о несевшем: их пишет только закрытие сессии. */
const missedRecords = (state) =>
  (state.journal || []).filter((r) => r.data && r.data.missed === true);

// --- 1. балл считается внутри периода ---------------------------------------

// Японский год: первый триместр с 8 апреля, второй с 1 сентября, третий с 8
// января. Три даты ниже лежат по одной в каждом.
const JP_START = '2024-04-08';
const JP_T0 = '2024-04-15';
const JP_T1 = '2024-09-10';
const JP_T2 = '2025-01-20';

test('сильный первый триместр не подпирает исход третьего', () => {
  let s = school(JP, JP_START);
  s = put(s, JP, 'math', '5', JP_T0);
  s = put(s, JP, 'math', '5', JP_T0);
  s = put(s, JP, 'math', '5', JP_T1);
  s = put(s, JP, 'math', '3', JP_T2);
  s.calendar.day = JP_T2;

  // Годовой балл по-прежнему годовой: он и на экране такой.
  assert.equal(subjectScore(s, 'math', JP).average, 4.5);

  // А судят на сессии по периоду: в третьем триместре стоит одна тройка.
  assert.equal(examScore(s, JP, { subjectId: 'math', term: 2 }), 3);
  assert.equal(examScore(s, JP, { subjectId: 'math', term: 0 }), 5);
  assert.equal(examScore(s, JP, { subjectId: 'math', term: 1 }), 5);

  // Цена вопроса ровно та, ради которой всё затевалось: автомат в третьем
  // триместре на годовом балле 4.5 был бы… впрочем, порог у jp — 4.8.
  assert.equal(JP.exams.autoPassScore, 4.8);
});

test('прогулянный третий триместр отменяет автомат, который давал годовой балл', () => {
  let s = school(JP, JP_START);
  // Первый и второй триместры на пятёрки — годовой балл выше порога автомата.
  for (const day of [JP_T0, JP_T0, JP_T0, JP_T1]) s = put(s, JP, 'math', '5', day);
  s.calendar.day = JP_T2;

  const yearly = subjectScore(s, 'math', JP).average;
  assert.ok(yearly >= JP.exams.autoPassScore, `годовой балл ${yearly} — выше порога автомата`);

  // В третьем триместре оценок нет вовсе: балл падает к стартовому из пресета,
  // а не наследуется от апреля.
  const now = examScore(s, JP, { subjectId: 'math', term: 2 });
  assert.equal(now, JP.grades.startScore);
  assert.ok(now < JP.exams.autoPassScore);

  // И это видно на исходе, а не только в числе: на годовом балле бросок вернул
  // бы автомат при любой случайности, на периодном — не возвращает ни при какой.
  for (let i = 0; i <= 20; i += 1) {
    const roll = rollOutcome({ score: now, relation: 0, kind: 'final' }, JP, () => i / 20);
    assert.notEqual(roll.reason, 'auto', `случайность ${i / 20} дала автомат`);
  }
  assert.equal(rollOutcome({ score: yearly, relation: 0, kind: 'final' }, JP, () => 0).reason, 'auto');
});

test('у пресета с одним периодом балл сессии остаётся годовым до последнего знака', () => {
  // Это и есть обещание «буква в букву»: у ru и magic период один, фильтр обязан
  // быть тождественным на любых датах — включая дату до начала семестра и
  // оценку вообще без дня.
  for (const preset of [RU, MAGIC]) {
    const start = preset === RU ? '2024-09-02' : '2024-09-23';
    let s = school(preset, start);
    const scale = preset.grades.values.filter((v) => typeof v.points === 'number');
    const days = ['2024-06-01', '2024-09-03', '2024-10-15', '2024-12-20', '2025-02-01', ''];
    days.forEach((day, i) => {
      s = put(s, preset, 'math', scale[i % scale.length].value, day);
    });
    s.calendar.day = '2024-12-20';

    const yearly = subjectScore(s, 'math', preset).average;
    assert.equal(examScore(s, preset, { subjectId: 'math', term: 0 }), yearly, preset.id);
    // И список оценок фильтр не режет: все шесть на месте.
    assert.equal(subjectScore(s, 'math', preset, { term: 0 }).grades.length, days.length, preset.id);
  }
});

test('оценка без даты относится к текущему периоду, а не теряется', () => {
  const s = school(JP, JP_START);
  // День проставляет `addGrade` сам, так что оценка без даты — это состояние,
  // собранное руками или пришедшее из старого сохранения. Так её и заводим.
  s.subjects.find((x) => x.id === 'math').grades.push({ value: '2', day: '' });
  s.calendar.day = JP_T2;

  assert.equal(examScore(s, JP, { subjectId: 'math', term: 2 }), 2, 'в текущем — считается');
  assert.equal(
    examScore(s, JP, { subjectId: 'math', term: 0 }), JP.grades.startScore,
    'в чужом — не считается, и это не ноль, а стартовый балл',
  );
});

test('фильтр без номера периода не фильтрует ничего', () => {
  let s = school(JP, JP_START);
  s = put(s, JP, 'math', '5', JP_T0);
  s = put(s, JP, 'math', '3', JP_T2);
  const all = s.subjects.find((x) => x.id === 'math').grades;
  assert.equal(gradesInTerm(s, all, JP, undefined).length, 2);
  assert.equal(gradesInTerm(s, all, JP, null).length, 2);
  assert.equal(subjectScore(s, 'math', JP).grades.length, 2, 'панель зачётки видит весь год');
});

test('период события берётся из самого события, а не из сегодняшнего дня', () => {
  let s = school(JP, JP_START);
  s = put(s, JP, 'math', '5', JP_T0);
  s = put(s, JP, 'math', '2', JP_T2);
  s.calendar.day = JP_T2;
  // Пересдача события первого триместра, если бы до неё дошло, судится по
  // первому триместру: балл берётся по `item.term`.
  assert.equal(examScore(s, JP, { subjectId: 'math', term: 0, day: JP_T0 }), 5);
  // Событию без номера период назначает его день.
  assert.equal(examScore(s, JP, { subjectId: 'math', day: JP_T0 }), 5);
  assert.equal(examScore(s, JP, { subjectId: 'math', day: JP_T2 }), 2);
});

// --- 2. несевшее закрытой сессии --------------------------------------------

const CASES = [
  { name: 'ru-university', preset: RU, start: '2024-09-02', exams: '2024-12-23' },
  { name: 'jp-highschool', preset: JP, start: JP_START, exams: '2024-07-15' },
  { name: 'magic-academy', preset: MAGIC, start: '2024-09-23', exams: '2024-12-16' },
];

for (const { name, preset, start, exams } of CASES) {
  test(`несевшее закрытой сессии становится хвостом: ${name}`, () => {
    let s = school(preset, start);
    s = scheduleExams(s, preset, { day: exams });
    s.calendar.day = exams;
    const items = s.exams.items;
    assert.ok(items.length >= 2, 'сессия завелась');

    // За математику сели (у японского пресета — за оба её события), за историю нет.
    for (const sat of items.filter((i) => i.subjectId === 'math')) {
      s = applyOutcome(s, { examId: sat.id, value: valueFor(preset, sat.kind, true), day: exams }, preset).state;
    }

    const before = s.subjects.find((x) => x.id === 'history');
    assert.equal(before.debt, false, 'до закрытия хвоста нет');

    const closed = closeExamSession(s, preset);
    const history = closed.subjects.find((x) => x.id === 'history');
    assert.equal(history.debt, true, 'несевшее превратилось в хвост');
    assert.equal(history.debtReason, DEBT_MISSED, 'и причина хвоста названа');

    // Сданное закрытие не трогает.
    assert.equal(closed.subjects.find((x) => x.id === 'math').debt, false);

    const records = missedRecords(closed);
    assert.equal(records.length, closed.exams.items.filter((i) => i.missed).length);
    assert.ok(records.length >= 1, 'в журнале есть строка, а не тишина');
    for (const r of records) {
      assert.equal(r.kind, 'exam');
      assert.ok(r.text.length > 0, 'строка не пустая');
      assert.ok(!/\{\w+\}/.test(r.text), `в тексте остался плейсхолдер: ${r.text}`);
    }
  });
}

test('слова о несевшем берутся из словаря пресета, а не из кода', () => {
  const texts = CASES.map(({ preset, start, exams }) => {
    let s = school(preset, start);
    s = scheduleExams(s, preset, { day: exams });
    s.calendar.day = exams;
    const closed = closeExamSession(s, preset);
    const record = missedRecords(closed)[0];
    const subject = closed.subjects.find((x) => x.id === record.data.subjectId);
    const item = closed.exams.items.find((i) => i.id === record.data.examId);
    const kind = (preset.exams.kinds || []).find((k) => k.id === item.kind);
    // Ровно те же подстановки, что у движка, — значит, отличаться текст может
    // только шаблоном, то есть словарём пресета.
    const byDefault = fill(DEFAULT_PHRASES.missed, {
      subject: subject.name,
      kind: (kind && kind.name) || '',
      debt: preset.vocab.debt,
      examPeriod: preset.vocab.examPeriod,
    });
    assert.notEqual(record.text, byDefault, `${preset.id}: фраза взята из умолчания движка, а не из пресета`);
    return record.text;
  });

  // И каждый пресет говорит своими словами, а не соседскими.
  assert.equal(new Set(texts).size, texts.length, 'три пресета — три разные фразы');
  for (let i = 0; i < CASES.length; i += 1) {
    const { preset } = CASES[i];
    assert.ok(texts[i].includes(preset.vocab.debt), `${preset.id}: слово хвоста из словаря`);
    assert.ok(texts[i].includes(preset.vocab.examPeriod), `${preset.id}: слово сессии из словаря`);
  }
});

test('закрытие не считает несевшее дважды', () => {
  let s = school(RU, '2024-09-02');
  s = scheduleExams(s, RU, { day: '2024-12-23' });
  s.calendar.day = '2024-12-23';

  const once = closeExamSession(s, RU);
  const first = missedRecords(once).length;
  assert.ok(first >= 2);

  // Сессия того же периода открылась снова (так делает календарь, входя в фазу
  // повторно) и закрылась снова: событий не прибавилось, записей тоже.
  const again = closeExamSession(scheduleExams(once, RU, { day: '2024-12-24', term: once.exams.term }), RU);
  assert.equal(missedRecords(again).length, first, 'второй раз то же несевшее не пересчитывается');
});

test('заваленное с оставшимися пересдачами закрытие сессии не трогает', () => {
  let s = school(RU, '2024-09-02');
  s = scheduleExams(s, RU, { day: '2024-12-23' });
  s.calendar.day = '2024-12-23';
  const item = s.exams.items.find((i) => i.subjectId === 'math');
  const fail = RU.grades.values.find((v) => !v.pass && (item.kind === 'credit' ? v.points === null : v.points !== null));
  s = applyOutcome(s, { examId: item.id, value: fail.value, day: '2024-12-23' }, RU).state;
  assert.ok(examMode(s, RU).pending.some((i) => i.id === item.id), 'пересдача ещё есть');

  const closed = closeExamSession(s, RU);
  const math = closed.subjects.find((x) => x.id === 'math');
  assert.equal(math.debt, false, 'хвост ставит исчерпание попыток, а не конец сессии');
  assert.equal(closed.exams.items.find((i) => i.id === item.id).missed, undefined);
});

// --- источники хвоста --------------------------------------------------------

test('у хвоста названа причина: прогулы, оценка, сессия, несевшее', () => {
  let s = school(RU, '2024-09-02');

  s = setDebt(s, 'history', true, RU, DEBT_SKIPS);
  assert.equal(s.subjects.find((x) => x.id === 'history').debtReason, DEBT_SKIPS);

  s = put(s, RU, 'math', '2', '2024-09-10');
  assert.equal(s.subjects.find((x) => x.id === 'math').debtReason, 'grade');

  // Проходная оценка снимает хвост — и причину вместе с ним.
  s = put(s, RU, 'math', '4', '2024-09-17');
  assert.equal(s.subjects.find((x) => x.id === 'math').debt, false);
  assert.equal(s.subjects.find((x) => x.id === 'math').debtReason, undefined);
});

test('сессия по-прежнему снимает хвост за прогулы — но теперь видно, чей это был хвост', () => {
  // Известное столкновение источников (`etap-week.md`, `etap-terms.md`):
  // `applyOutcome` переставляет флаг по правилу сессии, ничего не зная о том,
  // откуда хвост взялся. Правило здесь не меняется — тест его фиксирует, чтобы
  // покраснеть, если владелица решит развести источники поведением.
  let s = school(RU, '2024-09-02');
  s = setDebt(s, 'math', true, RU, DEBT_SKIPS);
  s = scheduleExams(s, RU, { day: '2024-12-23' });
  const item = s.exams.items.find((i) => i.subjectId === 'math');
  const pass = RU.grades.values.find((v) => v.pass && (item.kind === 'credit' ? v.points === null : v.points !== null));

  const after = applyOutcome(s, { examId: item.id, value: pass.value, day: '2024-12-23' }, RU).state;
  const math = after.subjects.find((x) => x.id === 'math');
  assert.equal(math.debt, false, 'сентябрьский хвост за прогулы снят сдачей декабрьского зачёта');
  assert.equal(math.debtReason, undefined);

  // След остался в журнале: хвост ставился с причиной, и она там названа.
  const put = (s.journal || []).find((r) => r.data && r.data.debt === true);
  assert.equal(put.data.reason, DEBT_SKIPS);
});

test('исчерпанные попытки называют хвост своим именем', () => {
  const preset = MAGIC; // retakes: 0 — первая же неудача исчерпывает попытки
  let s = school(preset, '2024-09-23');
  s = scheduleExams(s, preset, { day: '2024-12-16' });
  const item = s.exams.items.find((i) => i.subjectId === 'math');
  const fail = preset.grades.values.find((v) => !v.pass && (item.kind === 'admission' ? v.points === null : v.points !== null));

  const after = applyOutcome(s, { examId: item.id, value: fail.value, day: '2024-12-16' }, preset).state;
  const math = after.subjects.find((x) => x.id === 'math');
  assert.equal(math.debt, true);
  assert.equal(math.debtReason, DEBT_EXAM, 'не «за оценку»: на сессии правило другое');
});

// --- 3. периодность доходит до сессии, а не остаётся в `exams.mjs` -----------
//
// Отдельный тест на ШОВ, а не на правило. `examScore` считает балл по периоду и
// покрыт выше, но судит на сессии не она, а `engine.sitExam`, и до правки он
// звал `subjectScore` — годовой. Снятие правки в движке проверки выше не роняет
// ни одной: они зовут `examScore` напрямую. Этот тест зовёт движок.

test('сессия судит периодным баллом: шов в `engine.sitExam`', () => {
  let s = school(JP, JP_START);
  // Первый и второй триместры на пятёрки: годовой балл выше порога автомата.
  for (const day of [JP_T0, JP_T0, JP_T0, JP_T1]) s = put(s, JP, 'math', '5', day);
  assert.ok(subjectScore(s, 'math', JP).average >= JP.exams.autoPassScore);

  // Третий триместр прожит без единой оценки — судить не за что.
  const T2_EXAMS = '2025-03-26';
  s = scheduleExams(s, JP, { day: T2_EXAMS });
  s.calendar.day = T2_EXAMS;
  const item = examMode(s, JP).pending.find((i) => i.subjectId === 'math');
  assert.ok(item, 'контрольное по математике заведено');
  assert.equal(item.term, 2, 'и оно из третьего триместра');

  // Годовой балл дал бы автомат при любой случайности, периодный — ни при
  // какой. Спрашиваем движок, а не `examScore`: правку в `engine.mjs` держит
  // именно это.
  for (let i = 0; i <= 20; i += 1) {
    const res = sitExam(s, JP, { rng: () => i / 20, examId: item.id });
    assert.ok(res.applied, 'за контрольное посадили');
    assert.notEqual(res.exam.reason, 'auto', `случайность ${i / 20} дала автомат`);
  }
});

// Середина периода: у вида контрольного своё окно в календаре.
//
// Разобранный вопрос 2 из `etap3-scale.md`: 中間考査 и 期末考査 падали в одну
// экзаменационную неделю, потому что контрольные заводились входом в фазу, а
// фаза даёт одно слово на день. Решение — назначение по календарю: у вида
// появилось поле `atWeek` (номер учебной недели периода), и события такого вида
// заводятся, когда календарь до этой недели дошёл.
//
// Файл проверяет четыре вещи, и все — **через движок** (`applyResponse`), а не
// через ядро напрямую: правка живёт в `engine.mjs`, и тест, зовущий
// `core/exams.mjs`, снятие этой правки не заметил бы.
//
// 1. Середина заводится на своей неделе, посреди уроков, и сессию не открывает.
// 2. Второй раз не заводится — ни на следующий день, ни входом в сессию.
// 3. Пресеты без `atWeek` (`ru-university`, `magic-academy`) ведут себя ровно
//    как прежде: до экзаменационной недели ни одного события.
// 4. Уже сделанное не сломано: балл внутри периода, хвост из несевшего,
//    пересдача, маршрут `grade=` в `resolveConflict`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState, migrate } from '../core/state.mjs';
import { buildSchedule, dayPlan } from '../core/schedule.mjs';
import { applyResponse } from '../core/engine.mjs';
import { examMode, datedExams, retakesLeft, announceResults } from '../core/exams.mjs';
import { phaseOf, addDays, termAt, isStudyDay } from '../core/time.mjs';
import { buildPrompt } from '../prompt.mjs';
import { gradebookView } from '../ui.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../presets/${name}.json`, import.meta.url), 'utf8'));
const JP = load('jp-highschool');
const RU = load('ru-university');
const MAGIC = load('magic-academy');

const SUBJECTS = [
  { id: 'math', name: 'математика', teacherId: 'petrova' },
  { id: 'history', name: 'история', teacherId: 'ivanov' },
  { id: 'physics', name: 'физика', teacherId: 'sidorova' },
  { id: 'lit', name: 'литература', teacherId: 'kuznecov' },
];
const TEACHERS = [
  { id: 'petrova', name: 'Петрова', relation: 0 },
  { id: 'ivanov', name: 'Иванов', relation: 0 },
  { id: 'sidorova', name: 'Сидорова', relation: 0 },
  { id: 'kuznecov', name: 'Кузнецов', relation: 0 },
];

/** Понедельник первой недели: у всех трёх пресетов год начинается с него. */
const START = { jp: '2024-04-08', ru: '2024-09-02', magic: '2024-09-23' };

function school(preset, startDay) {
  const state = createState(preset, {
    startDay,
    subjects: SUBJECTS,
    teachers: TEACHERS,
    schedule: buildSchedule(SUBJECTS, preset),
  });
  state.started = true;
  return state;
}

/** Один ответ модели с меткой; проза в сценарии не участвует. */
const post = (state, preset, marker, opts = {}) =>
  applyResponse(state, `Сцена.\n<!-- [ACADEMY ${marker}] -->`, preset, { mode: 'marker', ...opts });

/**
 * Прогон календаря по суткам — тем же каналом, каким его двигает игра. Дни
 * НЕ проставляются присваиванием: назначение по календарю проверяется только
 * тогда, когда календарь до недели действительно дошёл, ответ за ответом.
 */
function walk(state, preset, days, opts = {}) {
  let s = state;
  const trace = [];
  for (let i = 0; i < days; i += 1) {
    const out = post(s, preset, 't=+1 day', opts);
    s = out.state;
    trace.push({ day: s.calendar.day, state: s, out });
  }
  return { state: s, trace };
}

/** Первый день, в который в состоянии появилось хоть одно контрольное событие. */
const firstExamItemDay = (trace) => {
  const step = trace.find((t) => t.state.exams.items.length > 0);
  return step ? step.day : null;
};

const kindsOf = (state) => [...new Set(state.exams.items.map((i) => i.kind))].sort();
const midterms = (state) => state.exams.items.filter((i) => i.kind === 'midterm');
const weekOf = (preset, state, day) => termAt(preset, state, day).week;

// --- 1. середина заводится по календарю, а не входом в сессию ----------------

test('японская середина заводится на седьмой учебной неделе, посреди уроков', () => {
  const s0 = school(JP, START.jp);
  const { trace } = walk(s0, JP, 60);

  const day = firstExamItemDay(trace);
  assert.ok(day, 'за два месяца не завелось ни одного контрольного');
  const step = trace.find((t) => t.day === day);
  const s = step.state;

  // Неделя — та, что написана в пресете, и ни днём раньше.
  assert.equal(weekOf(JP, s, day), JP.exams.kinds.find((k) => k.id === 'midterm').atWeek);
  assert.deepEqual(kindsOf(s), ['midterm']);
  assert.equal(midterms(s).length, SUBJECTS.length);

  // Это учебная неделя: уроки в этот день идут, а сессии нет.
  assert.equal(phaseOf(JP, s, day), 'study');
  assert.ok(dayPlan(s, JP).length > 0, 'расписание в день середины опустело');
  assert.equal(s.exams.active, false, 'середина открыла режим сессии');
  assert.equal(s.exams.term, null, 'середина назвала себя сессией периода');

  // Событие приписано к своему периоду и своему дню.
  for (const item of midterms(s)) {
    assert.equal(item.term, 0);
    assert.equal(item.day, day);
    assert.equal(item.outcome, null);
  }

  // Заведение видно в отладке и в журнале — своей фразой, а не фразой сессии.
  assert.ok(step.out.debug.applied.some((a) => a.kind === 'exams-dated' && a.added === SUBJECTS.length));
  const записи = s.journal.filter((r) => r.data && r.data.kind === 'midterm');
  assert.equal(записи.length, 1);
  assert.ok(записи[0].text.includes('промежуточная аттестация'), `фраза не назвала вид: ${записи[0].text}`);
});

test('до седьмой недели середины нет ни в один день', () => {
  const { trace } = walk(school(JP, START.jp), JP, 60);
  for (const step of trace) {
    const week = weekOf(JP, step.state, step.day);
    if (week < 7) {
      assert.equal(step.state.exams.items.length, 0, `${step.day}: контрольное на ${week}-й неделе`);
    }
  }
});

// --- 2. повторного заведения нет ---------------------------------------------

test('середина не заводится второй раз — ни назавтра, ни входом в сессию', () => {
  const s0 = school(JP, START.jp);
  // Учебных недель у первого триместра 14, сессия — пятнадцатая: 110 суток
  // покрывают её с запасом.
  const { trace } = walk(s0, JP, 110);
  // Состояние берётся первым днём сессии, а не концом прогона: к сотому дню
  // сессия уже закрыта каникулами, и о её открытии по нему судить нельзя.
  const exams = trace.find((t) => phaseOf(JP, t.state, t.day) === 'exams');
  assert.ok(exams, 'экзаменационной недели за 110 дней не случилось');
  const s = exams.state;

  // Событий ровно по два на предмет, и все id различны.
  assert.equal(s.exams.items.length, SUBJECTS.length * 2);
  assert.equal(new Set(s.exams.items.map((i) => i.id)).size, s.exams.items.length);
  assert.deepEqual(kindsOf(s), ['final', 'midterm']);

  // Заведение случилось ровно в один день из ста десяти. Считается по отладке,
  // а не по журналу: журнал за триместр успевает подрезаться по длине.
  assert.equal(
    trace.filter((t) => t.out.debug.applied.some((a) => a.kind === 'exams-dated')).length,
    1,
    'середина заводилась не один раз',
  );

  // Число середин не росло ни в один день прогона.
  const counts = new Set(trace.map((t) => midterms(t.state).length));
  assert.deepEqual([...counts].sort((a, b) => a - b), [0, SUBJECTS.length]);

  // Конец периода назначен своим днём — днём входа в сессию, а не днём середины.
  const finals = s.exams.items.filter((i) => i.kind === 'final');
  const midterm = midterms(s)[0];
  assert.equal(finals.length, SUBJECTS.length);
  assert.ok(finals.every((f) => f.day !== midterm.day), 'конец встал в тот же день, что и середина');
  assert.equal(phaseOf(JP, s, finals[0].day), 'exams');
  assert.equal(phaseOf(JP, s, midterm.day), 'study');
  assert.equal(s.exams.active, true, 'сессия конца периода не открылась');
});

test('рывок времени через неделю середины её не теряет', () => {
  // Одна метка умеет двинуть время на месяц: событие, чья неделя осталась
  // позади, обязано завестись с опозданием, а не пропасть.
  // Потолок одного сдвига — 30 суток, поэтому рывок из двух: пятая неделя, а
  // следом девятая. Седьмая не наступала ни в одном ответе.
  let s = school(JP, START.jp);
  s = post(s, JP, 't=+4 weeks').state;
  assert.equal(weekOf(JP, s, s.calendar.day), 5);
  assert.equal(s.exams.items.length, 0, 'пятая неделя — середины ещё нет');
  s = post(s, JP, 't=+4 weeks').state;
  assert.equal(weekOf(JP, s, s.calendar.day), 9);
  assert.equal(midterms(s).length, SUBJECTS.length, 'середина, перепрыгнутая рывком, потеряна');
  assert.equal(s.exams.active, false);
});

// --- 3. пресеты без поля: эталон ---------------------------------------------

test('пресеты без своей недели у вида ведут себя как прежде', () => {
  for (const preset of [RU, MAGIC]) {
    const start = preset.id === 'ru-university' ? START.ru : START.magic;
    const { trace } = walk(school(preset, start), preset, 130);

    // Ни одного события до первого дня экзаменационной фазы: ровно то место,
    // где их заводил вход в фазу, и ни днём раньше.
    let seenExamPhase = false;
    for (const step of trace) {
      if (phaseOf(preset, step.state, step.day) === 'exams') seenExamPhase = true;
      if (!seenExamPhase) {
        assert.equal(step.state.exams.items.length, 0,
          `${preset.id}: контрольное завелось до сессии (${step.day})`);
      }
      assert.equal(step.out.debug.applied.some((a) => a.kind === 'exams-dated'), false,
        `${preset.id}: сработало назначение по календарю (${step.day})`);
    }

    const exams = trace.find((t) => phaseOf(preset, t.state, t.day) === 'exams');
    assert.ok(exams, `${preset.id}: экзаменационной недели не случилось`);
    const s = exams.state;
    assert.equal(s.exams.items.length, SUBJECTS.length, `${preset.id}: событий не по одному на предмет`);
    assert.equal(s.exams.active, true, `${preset.id}: сессия не открылась`);
    // Ни одной записи о назначении по календарю: этот путь у них не работает.
    assert.equal(s.journal.filter((r) => r.data && r.data.kind).length, 0,
      `${preset.id}: в журнале появилось назначение по календарю`);
    assert.ok(datedExams(s, preset, s.calendar.day).length === 0);
  }
});

// --- 4. что уже сделано, тем и осталось --------------------------------------

/** Состояние на дне середины: события заведены, за них ещё не садились. */
function atMidterm() {
  const { trace } = walk(school(JP, START.jp), JP, 60);
  const day = firstExamItemDay(trace);
  return { state: trace.find((t) => t.day === day).state, day };
}

test('за середину садятся посреди учебных недель, и режима сессии от этого нет', () => {
  const { state, day } = atMidterm();
  const out = post(state, JP, 't=+0', { exam: true, rng: () => 0.9 });
  const s = out.state;

  assert.ok(out.exam, 'середина не состоялась');
  const item = s.exams.items.find((i) => i.id === out.exam.examId);
  assert.equal(item.kind, 'midterm');
  assert.equal(item.day, day);
  assert.equal(item.attempts, 1);
  assert.notEqual(item.outcome, null);

  // Режим не поднят: расписание на месте, сессии в промпте нет.
  assert.equal(s.exams.active, false);
  assert.equal(examMode(s, JP).active, false);
  const status = buildPrompt(s, JP, { injects: [] }).status;
  assert.ok(status.includes(SUBJECTS.find((x) => dayPlan(s, JP).some((p) => p.subjectId === x.id)).name),
    `в промпте нет расписания дня: ${status}`);
  assert.ok(!status.includes(JP.vocab.examPeriod), `в промпте включился режим сессии: ${status}`);

  // Оценка в зачётке одна — её пишет `applyOutcome` через зачётку, и только он.
  assert.equal(s.subjects.find((x) => x.id === item.subjectId).grades.length, 1);
  // Разрешение модели выдано, и оно про этот предмет.
  assert.ok(out.permission.includes(SUBJECTS.find((x) => x.id === item.subjectId).name));

  // Правило «не больше одного в день» держится и здесь: ворота стоят в
  // `index.js`, а движок по второму зову сажает за следующее событие — но
  // сегодняшним днём помечено ровно одно.
  assert.equal(s.exams.items.filter((i) => i.outcome && i.day === day).length, 1);
});

test('grade= в день середины уходит в контрольное, а не второй оценкой в зачётку', () => {
  const { state } = atMidterm();
  const first = datedExams(state, JP, state.calendar.day)[0];
  const subject = SUBJECTS.find((x) => x.id === first.subjectId);

  // Значение назвать надо непроходное: при высоком броске посчитанное будет
  // «5», и совпадение двух версий расхождением не является.
  const out = post(state, JP, `t=+0 grade=${subject.name}:1`, { exam: true, rng: () => 0.99 });
  const s = out.state;

  assert.ok(out.divergence && out.divergence.applied, 'версия модели не принята');
  assert.equal(s.exams.items.find((i) => i.id === first.id).outcome, '1');
  assert.equal(s.subjects.find((x) => x.id === subject.id).grades.length, 1, 'оценка записана дважды');
});

test('заваленная середина остаётся пересдаваемой, пока попытки есть', () => {
  const { state } = atMidterm();
  // Провал: «1» — единственное непроходное значение числовой шкалы пресета, и
  // приходит оно версией модели (у неё преимущество — 3.5).
  const first = datedExams(state, JP, state.calendar.day)[0];
  const subject = SUBJECTS.find((x) => x.id === first.subjectId);
  const out = post(state, JP, `t=+0 grade=${subject.name}:1`, { exam: true, rng: () => 0.99 });
  const s = out.state;
  const item = s.exams.items.find((i) => i.id === out.exam.examId);

  assert.equal(item.outcome, '1');
  assert.ok(retakesLeft(JP, item) > 0);
  // Итог японской школы объявляют через два учебных дня (9.4.3): до того
  // пересдавать нечего — героиня ещё не знает, что провалилась.
  assert.equal(item.announced, false);
  assert.equal(datedExams(s, JP, s.calendar.day).some((i) => i.id === item.id), false);
  // Пересдача достижима: после объявления событие снова в списке того, за что
  // можно сесть.
  const told = announceResults({ ...s, calendar: { ...s.calendar, day: item.announceOn } }, JP).state;
  assert.ok(datedExams(told, JP, item.announceOn).some((i) => i.id === item.id));
});

test('несданная середина становится хвостом при закрытии сессии периода', () => {
  // Ни за одно контрольное не садились весь триместр: закрытие сессии обязано
  // назвать несевшее хвостом, а не стереть его молча (3.8).
  const { state } = walk(school(JP, START.jp), JP, 130);
  assert.equal(state.exams.active, false, 'сессия первого триместра не закрылась');

  const missed = state.journal.filter((r) => r.data && r.data.missed === true);
  assert.equal(missed.length, SUBJECTS.length * 2, 'несевшее сосчитано не всё');
  assert.ok(missed.some((r) => r.data.examId.endsWith(':midterm')), 'середина не попала в несевшее');
  for (const item of state.exams.items) assert.equal(item.missed, true);
  for (const subject of state.subjects) assert.equal(subject.debt, true);
});

test('балл середины считается внутри её периода', () => {
  // Первый триместр на пятёрки, второй — на двойки: середина второго обязана
  // судить по второму, иначе триместры снова декорация.
  let s = school(JP, START.jp);
  const day1 = '2024-04-15';
  for (const value of ['5', '5', '5']) {
    s = post({ ...s, calendar: { ...s.calendar, day: day1 } }, JP, `t=+0 grade=математика:${value}`).state;
  }

  // Второй триместр, его седьмая неделя.
  const t1 = termAt(JP, s, '2024-10-01');
  assert.equal(t1.index, 1);
  s.calendar.day = '2024-09-30';
  s = post(s, JP, 't=+1 day').state;
  s = post(s, JP, 't=+0 grade=математика:2').state;

  const start = termAt(JP, s, s.calendar.day).term.start;
  let cur = start;
  while (termAt(JP, s, cur).week < 7 || !isStudyDay(JP, cur)) cur = addDays(cur, 1);
  s.calendar.day = addDays(cur, -1);
  s = post(s, JP, 't=+1 day').state;

  const mid = s.exams.items.filter((i) => i.kind === 'midterm' && i.term === 1 && i.subjectId === 'math');
  assert.equal(mid.length, 1, 'середины второго триместра нет');

  const out = post(s, JP, 't=+0', { exam: true, examId: mid[0].id, rng: () => 0.5 });
  // Автомат японского пресета — 4.8: годовой балл (5,5,5,2 → 4.25) от него
  // далёк, но и балл второго триместра (2) не должен подпереться первым.
  assert.equal(out.exam.reason, 'roll');
  assert.ok(['2', '3'].includes(out.exam.value), `исход по годовому баллу: ${out.exam.value}`);
});

// --- старое сохранение --------------------------------------------------------

test('сохранение старой схемы не теряет событий и не заводит их дважды', () => {
  // Семестр, идущий прямо сейчас на схеме 1: сессия уже была заведена, события
  // лежат без номера периода и со старым id.
  const day = '2024-05-20'; // понедельник седьмой недели первого триместра
  const old = {
    ...school(JP, START.jp),
    schemaVersion: 1,
  };
  old.calendar.day = addDays(day, -1);
  old.exams = {
    active: false,
    items: SUBJECTS.map((s) => ({
      id: `${s.id}:midterm`, subjectId: s.id, kind: 'midterm', day: '2024-04-20', outcome: null, attempts: 0,
    })),
  };
  const s0 = migrate(old, JP);
  assert.equal(s0.exams.items.length, SUBJECTS.length);
  assert.ok(s0.exams.items.every((i) => i.id.startsWith('0:')));

  const s = post(s0, JP, 't=+1 day').state;
  assert.equal(midterms(s).length, SUBJECTS.length, 'середина заведена вторым комплектом');
  assert.equal(s.exams.items.length, SUBJECTS.length);
  assert.equal(s.calendar.day, day);
});

test('старое сохранение посреди учебных недель получает середину, а не тишину', () => {
  const old = { ...school(JP, START.jp), schemaVersion: 1 };
  old.calendar.day = '2024-05-19';
  old.exams = { active: false, items: [] };
  const s0 = migrate(old, JP);
  assert.equal(s0.exams.term, null, 'пустая сессия получила номер периода');

  const s = post(s0, JP, 't=+1 day').state;
  assert.equal(midterms(s).length, SUBJECTS.length);
  assert.equal(s.exams.active, false);
});

/**
 * Состояние на дне середины ВТОРОГО триместра: сессия первого прошла и закрыта,
 * `exams.term` равен нулю, а событие середины принадлежит первому периоду.
 */
function atSecondMidterm() {
  const { state: afterFirst } = walk(school(JP, START.jp), JP, 110);
  let s = afterFirst;
  const start = termAt(JP, s, '2024-09-10').term.start;
  let cur = start;
  while (termAt(JP, s, cur).week < 7 || !isStudyDay(JP, cur)) cur = addDays(cur, 1);
  s.calendar.day = addDays(cur, -1);
  s = post(s, JP, 't=+1 day').state;
  return { state: s, day: cur, afterFirst };
}

test('середина второго триместра сдаётся, хотя номер закрытой сессии — от первого', () => {
  // Самый узкий случай правки. `exams.term` после первого триместра равен нулю,
  // и `sessionItems` — тот фильтр, по которому живёт «несданное сессии», —
  // выбрасывает события второго триместра как чужие. Событие со своим окном
  // приходится ровно на такое время: сессии нет, номер от прошлой. Если очередь
  // `sitExam` спрашивает только сессию, за середину второго триместра сесть
  // нельзя вовсе.
  const { state: s, afterFirst } = atSecondMidterm();
  assert.equal(afterFirst.exams.term, 0, 'номер закрытой сессии не от первого триместра');

  const mine = s.exams.items.filter((i) => i.kind === 'midterm' && i.term === 1);
  assert.equal(mine.length, SUBJECTS.length, 'середина второго триместра не заведена');
  assert.equal(s.exams.active, false);
  assert.equal(s.exams.term, 0, 'номер сессии переписан событием вне сессии');
  // Фильтр сессии их не видит — и это правильно: сессии второго ещё не было.
  assert.equal(examMode(s, JP).pending.some((i) => i.term === 1), false);

  const out = post(s, JP, 't=+0', { exam: true, rng: () => 0.9 });
  assert.ok(out.exam, 'за середину второго триместра сесть не удалось');
  assert.equal(out.state.exams.items.find((i) => i.id === out.exam.examId).term, 1);
});

// --- что видит человек --------------------------------------------------------

test('назначенная середина видна в панели, хотя сессии нет', () => {
  // Решение про сессию: середина — событие периода, а не режим. Режима на
  // экране быть не должно (`examsActive`), а вот само назначенное и несданное
  // обязано быть видно: контрольная, которой нет ни на одном экране, — тихая
  // потеря (3.8).
  const { state, day } = atMidterm();
  const view = gradebookView(state, JP);

  assert.equal(view.examsActive, false, 'панель объявила сессию посреди учебных недель');
  assert.equal(view.openExams.length, SUBJECTS.length);
  assert.ok(view.openExams.every((e) => e.day === day));
  assert.ok(view.openExams.every((e) => e.kind.includes('промежуточная аттестация')), 'вид назван не своим именем');

  // Сданное с экрана уходит: несданных становится на одну меньше.
  const sat = post(state, JP, 't=+0', { exam: true, rng: () => 0.9 }).state;
  assert.equal(gradebookView(sat, JP).openExams.length, SUBJECTS.length - 1);
});

test('середина второго триместра видна в панели, а не только середина первого', () => {
  // Тот же узкий случай, что и у очереди `sitExam`: `exams.term` от закрытой
  // сессии первого триместра, и фильтр сессии выбрасывает события второго. На
  // экране это выглядело бы как «ничего не назначено» в день, когда контрольная
  // уже назначена и сегодня сдаётся.
  const { state, day } = atSecondMidterm();
  const view = gradebookView(state, JP);

  assert.equal(view.examsActive, false);
  const mine = view.openExams.filter((e) => e.id.startsWith('1:'));
  assert.equal(mine.length, SUBJECTS.length, 'середина второго триместра с экрана пропала');
  assert.ok(mine.every((e) => e.day === day));
  // Несевшее первого триместра в остатке ещё висит — это известное и нарочное
  // поведение закрытой сессии (вопрос 5 из `etap3-scale.md`: до открытия
  // следующей сессии оно остаётся на экране, чтобы не исчезнуть молча), и
  // середина его не меняет.
  assert.ok(view.openExams.some((e) => e.id.startsWith('0:')));
});

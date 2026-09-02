// test/presets — экзамен для абстракции из раздела 1 плана.
//
// Это не проверка формы JSON: каждый пресет прогоняется через настоящее ядро
// одним и тем же сценарием — собрать семестр, прожить учебный день по парам,
// прогулять, получить оценки, довести репутацию до порога, войти в сессию и
// сдать контрольное. Предметы, преподаватели, метки и порядок ходов у всех
// пресетов ОДИНАКОВЫЕ, поэтому любое различие в тексте наружу может прийти
// только из пресета — и обратное тоже верно: совпадение текста у двух пресетов
// означает, что слово просочилось из кода.
//
// Список пресетов — одна строка ниже. Четвёртый подключается дописыванием
// имени файла и ничем больше.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createState, validateState, cloneState, findSubject } from '../core/state.mjs';
import { addDays, phaseOf, isStudyDay, bellsOf, termsOf, termAt } from '../core/time.mjs';
import { buildSchedule, dayPlan, currentPeriod } from '../core/schedule.mjs';
import { resolveGrade, overallScore, subjectScore } from '../core/gradebook.mjs';
import { totalStats, stats } from '../core/attendance.mjs';
import { changeReputation, reputationLabel } from '../core/reputation.mjs';
import { relationLabel } from '../core/relations.mjs';
import { examMode } from '../core/exams.mjs';
import { applyResponse } from '../core/engine.mjs';
import { statusLine, countNumbers } from '../prompt.mjs';

/** Пресеты под экзаменом. Четвёртый добавляется одной строкой. */
const FILES = ['ru-university.json', 'jp-highschool.json', 'magic-academy.json'];

const load = (file) => JSON.parse(
  readFileSync(fileURLToPath(new URL(`../presets/${file}`, import.meta.url)), 'utf8'),
);
const PRESETS = FILES.map(load);

/**
 * Год фиксирован: `defaultStartDay` берёт текущий, и тест, зелёный в 2026-м,
 * иначе поехал бы в 2027-м вместе с календарём машины.
 */
const YEAR = 2026;

// Предметы и преподаватели у всех пресетов одни и те же и нарочно безлики:
// всё, что различается в выводе, обязано прийти из пресета, а не отсюда.
const SUBJECTS = [
  { id: 'alpha', name: 'Альфа', teacherId: 'first' },
  { id: 'beta', name: 'Бета', teacherId: 'second' },
  { id: 'gamma', name: 'Гамма', teacherId: 'first' },
  { id: 'delta', name: 'Дельта', teacherId: 'second' },
];
const TEACHERS = [
  { id: 'first', name: 'Первый' },
  { id: 'second', name: 'Второй' },
];

/**
 * Начало первого учебного периода, `ММ-ДД`. Пресет пишет его либо тремя
 * скалярами (`calendar.termStart`), либо списком периодов — обе формы живые.
 */
function termStartOf(preset) {
  const cal = preset.calendar || {};
  return cal.termStart || (cal.terms && cal.terms[0] && cal.terms[0].start);
}

/** Первый учебный день семестра в зафиксированном году. */
function firstStudyDay(preset) {
  let day = `${YEAR}-${termStartOf(preset)}`;
  for (let i = 0; i < 40; i += 1) {
    if (isStudyDay(preset, day)) return day;
    day = addDays(day, 1);
  }
  throw new Error(`${preset.id}: за 40 дней от termStart учебного дня не нашлось`);
}

/** Первый день, который пресет считает днём сессии. */
function firstExamDay(preset, state) {
  let day = state.calendar.termStart;
  for (let i = 0; i < 400; i += 1) {
    if (phaseOf(preset, state, day) === 'exams') return day;
    day = addDays(day, 1);
  }
  throw new Error(`${preset.id}: фазы «сессия» в календаре не нашлось`);
}

/** Первый день сессии не раньше `from`: для года из нескольких периодов. */
function firstExamDayFrom(preset, state, from) {
  let day = from;
  for (let i = 0; i < 400; i += 1) {
    if (phaseOf(preset, state, day) === 'exams') return day;
    day = addDays(day, 1);
  }
  throw new Error(`${preset.id}: от ${from} фазы «сессия» не нашлось`);
}

/**
 * Готовый к игре семестр: расписание построено, семестр начат.
 *
 * `day` — с какого дня идёт сцена, если не с самого дня заведения. Сутки, в
 * которые семестр заведён, посещаемостью не обсчитываются вовсе
 * (`attendance.countsAttendance`), поэтому сценарии про пары и прогулы
 * начинаются со следующего учебного дня.
 */
function makeState(preset, day) {
  const start = firstStudyDay(preset);
  const state = createState(preset, {
    startDay: start,
    subjects: SUBJECTS,
    teachers: TEACHERS,
    schedule: buildSchedule(SUBJECTS, preset),
  });
  state.started = true;
  if (day) state.calendar.day = day;
  return state;
}

/** Учебный день сразу после дня заведения — в нём посещаемость уже считается. */
function secondStudyDay(preset) {
  let day = addDays(firstStudyDay(preset), 1);
  for (let i = 0; i < 40; i += 1) {
    if (isStudyDay(preset, day)) return day;
    day = addDays(day, 1);
  }
  throw new Error(`${preset.id}: второго учебного дня не нашлось`);
}

/** Один ответ модели с меткой; режим `marker` — проза в сценарии не участвует. */
function post(state, preset, marker, opts = {}) {
  return applyResponse(state, `Сцена.\n<!-- [ACADEMY ${marker}] -->`, preset, {
    mode: 'marker',
    ...opts,
  });
}

/**
 * Вхождение без учёта регистра. `prompt.statusLine` поднимает первую букву
 * каждого сегмента («Сессия: …»), и сравнивать слово пресета побуквенно значит
 * ловить не лексику, а заглавную букву.
 */
const has = (text, word) => String(text).toLowerCase().includes(String(word).toLowerCase());

/**
 * Сколько контрольных обязан завести пресет на нашем наборе предметов. Виды с
 * `everySubject` идут каждому предмету, остальные раздаются по кругу — по одному
 * на предмет. Формула повторяет правило пресета, а не подсматривает в ядро.
 */
function expectedExamCount(preset) {
  const kinds = (preset.exams && preset.exams.kinds) || [];
  const every = kinds.filter((k) => k.everySubject === true).length;
  return SUBJECTS.length * (every || 1);
}

const passingPointGrade = (preset) =>
  preset.grades.values.find((g) => typeof g.points === 'number' && g.pass);
const passingPassGrade = (preset) =>
  preset.grades.values.find((g) => (g.points === null || g.points === undefined) && g.pass);

// Собранное на прогоне — для перекрёстных проверок «слова не от того пресета».
const artifacts = new Map();

for (const preset of PRESETS) {
  test(`пресет ${preset.id}: семестр собирается и живёт`, () => {
    const state = makeState(preset);

    const check = validateState(state, preset);
    assert.deepEqual(check.errors, [], `${preset.id}: состояние не прошло валидацию`);

    // Расписание уложено ровно в столько периодов, сколько объявил пресет.
    const plan = dayPlan(state, preset);
    assert.equal(plan.length, preset.week.periodsPerDay);
    assert.equal(phaseOf(preset, state, state.calendar.day), 'study');

    // Сетка звонков пресета, а не зашитая: первый период идёт по своим часам.
    const bells = bellsOf(preset);
    assert.equal(bells.length, preset.week.periodsPerDay);
    const timed = cloneState(state);
    timed.calendar.time = bells[0].start;
    timed.calendar.precision = 'datetime';
    const cur = currentPeriod(timed, preset);
    assert.equal(cur.status, 'now');
    assert.equal(cur.index, 0);
  });

  test(`пресет ${preset.id}: день по периодам, прогул, оценки`, () => {
    let s = makeState(preset, secondStudyDay(preset));
    const perDay = preset.week.periodsPerDay;

    // Учебный день прожит по периодам: `t=+1` столько раз, сколько их в дне.
    for (let i = 0; i < perDay; i += 1) s = post(s, preset, 't=+1').state;
    assert.ok(totalStats(s).present >= perDay - 1, `${preset.id}: посещённых пар не появилось`);

    // Прогул отдельной парой: отношение вниз, репутация вниз.
    const repBefore = s.reputation.value;
    s = post(s, preset, 'skip=beta').state;
    assert.equal(stats(s, 'beta').skips, 1);
    assert.ok(s.reputation.value < repBefore, `${preset.id}: прогул не тронул репутацию`);
    assert.ok(
      s.teachers.find((t) => t.id === 'second').relation < preset.relations.start,
      `${preset.id}: прогул не тронул отношение преподавателя`,
    );

    // Оценки — значениями из шкалы ЭТОГО пресета, обеими её половинами.
    const pointGrade = passingPointGrade(preset);
    const passGrade = passingPassGrade(preset);
    assert.ok(pointGrade && passGrade, `${preset.id}: в шкале нет обеих половин`);

    const res = post(s, preset, `grade=alpha:${pointGrade.value} grade=gamma:${passGrade.value}`);
    s = res.state;
    assert.deepEqual(res.rejected, [], `${preset.id}: метка со своими же оценками отвергнута`);
    assert.equal(findSubject(s, 'alpha').grades.at(-1).value, pointGrade.value);
    assert.equal(findSubject(s, 'gamma').grades.at(-1).value, passGrade.value);
    // Оценка без числового веса в средний балл не идёт — иначе «зачёт» пришлось
    // бы оценивать нулём.
    assert.equal(subjectScore(s, 'gamma', preset).average, null);
    assert.equal(overallScore(s, preset), pointGrade.points);

    // Строка состояния говорит словами пресета и не превышает потолок чисел.
    const line = statusLine(s, preset);
    assert.ok(has(line, preset.vocab.score), `${preset.id}: в строке нет «${preset.vocab.score}»`);
    assert.ok(
      countNumbers(line) <= preset.limits.maxNumbersInPrompt,
      `${preset.id}: чисел в строке ${countNumbers(line)} > ${preset.limits.maxNumbersInPrompt}: ${line}`,
    );
    artifacts.set(`${preset.id}:status`, line);
  });

  test(`пресет ${preset.id}: репутация доходит до порога словами пресета`, () => {
    let s = makeState(preset);
    const scale = preset.reputation;

    // Ровно до порога предупреждения, одним ударом: пороги пробиваются по разу.
    const warn = changeReputation(s, { delta: scale.warnAt - s.reputation.value }, preset);
    s = warn.state;
    assert.equal(warn.crossedWarn, true);
    assert.equal(s.pending.length, 1);
    assert.equal(s.pending[0].text, preset.vocab.warnInject);
    artifacts.set(`${preset.id}:warn`, s.pending[0].text);

    // Ярлык — словом; числа шкалы наружу не выходят вовсе.
    const label = reputationLabel(s, preset);
    assert.ok(label, `${preset.id}: у порога нет ярлыка`);
    s.pending = [];
    s.started = true;
    const line = statusLine(s, preset);
    assert.ok(has(line, label), `${preset.id}: ярлык репутации не дошёл до строки: ${line}`);

    // И отношение тоже словом: `-5` модель не отыгрывает.
    s.teachers[0].relation = preset.relations.min;
    const relLabel = relationLabel(s, 'first', preset);
    assert.ok(relLabel, `${preset.id}: у дна шкалы отношений нет ярлыка`);
    const relLine = statusLine(s, preset);
    assert.ok(
      !relLine.includes(String(preset.relations.min)),
      `${preset.id}: число отношения просочилось в строку: ${relLine}`,
    );

    // Дно шкалы — вылет, и называется он тоже по-своему.
    const out = changeReputation(s, { delta: scale.min - s.reputation.value }, preset);
    assert.equal(out.expelled, true);
    assert.equal(out.state.pending.at(-1).text, preset.vocab.expelInject);
  });

  test(`пресет ${preset.id}: сессия и контрольное событие`, () => {
    let s = makeState(preset);
    const examDay = firstExamDay(preset, s);

    // Вход в сессию — событие календаря, а не кнопка: день перед ней плюс сутки.
    s.calendar.day = addDays(examDay, -1);
    const entered = post(s, preset, 't=+1 day');
    s = entered.state;
    assert.equal(phaseOf(preset, s, s.calendar.day), 'exams');
    assert.equal(s.exams.active, true);
    assert.equal(s.exams.items.length, expectedExamCount(preset));

    // Виды контрольных розданы по пресету, а не свалены в один.
    const kinds = new Set(s.exams.items.map((i) => i.kind));
    const every = preset.exams.kinds.filter((k) => k.everySubject === true);
    assert.equal(
      kinds.size,
      every.length || Math.min(preset.exams.kinds.length, SUBJECTS.length),
    );
    for (const item of s.exams.items) {
      assert.ok(preset.exams.kinds.some((k) => k.id === item.kind));
    }
    // Событие различается парой «предмет + вид»: одинаковых id быть не может.
    assert.equal(new Set(s.exams.items.map((i) => i.id)).size, s.exams.items.length);

    const mode = examMode(s, preset);
    assert.equal(mode.pending.length, expectedExamCount(preset));
    assert.ok(typeof mode.daysLeft === 'number' && mode.daysLeft >= 0);

    // Сдача: случайность инжектится, чтобы прогон был воспроизводим.
    const sat = post(s, preset, 't=+0', { exam: true, rng: () => 0.9 });
    s = sat.state;
    assert.ok(sat.exam, `${preset.id}: контрольное не состоялось`);

    // Исход — значение ИЗ ЭТОЙ шкалы, а не выдуманное ядром.
    const info = resolveGrade(preset, sat.exam.value);
    assert.ok(info, `${preset.id}: исход «${sat.exam.value}» не из шкалы пресета`);

    // Разрешение и запрет — фразами пресета, с его же словом для сессии.
    assert.ok(
      has(sat.permission, preset.vocab.examPeriod),
      `${preset.id}: в разрешении нет «${preset.vocab.examPeriod}»: ${sat.permission}`,
    );
    assert.ok(
      has(sat.permission, preset.vocab.score),
      `${preset.id}: в разрешении нет «${preset.vocab.score}»: ${sat.permission}`,
    );
    artifacts.set(`${preset.id}:permission`, sat.permission);

    // Посчитанный факт ушёл одноразовым инжектом и снят тем же ходом.
    const examInject = sat.injects.find((i) => i.kind === 'exam');
    assert.ok(examInject, `${preset.id}: инжекта об исходе нет`);
    assert.ok(
      has(examInject.text, info.label),
      `${preset.id}: в инжекте нет ярлыка исхода: ${examInject.text}`,
    );
    assert.equal(s.pending.length, 0);
    artifacts.set(`${preset.id}:exam`, examInject.text);

    // Строка состояния в сессии сменила тон — словом пресета, и без лишних чисел.
    s.started = true;
    const line = statusLine(s, preset);
    assert.ok(
      has(line, preset.vocab.examPeriod),
      `${preset.id}: строка сессии молчит о «${preset.vocab.examPeriod}»: ${line}`,
    );
    assert.ok(
      countNumbers(line) <= preset.limits.maxNumbersInPrompt,
      `${preset.id}: чисел в строке сессии ${countNumbers(line)} > ${preset.limits.maxNumbersInPrompt}: ${line}`,
    );
    artifacts.set(`${preset.id}:examStatus`, line);

    assert.deepEqual(validateState(s, preset).errors, []);
  });
}

// --- несколько учебных периодов в одном пресете ------------------------------

test('каждый учебный период пресета живой, а не только первый', () => {
  for (const preset of PRESETS) {
    const s = makeState(preset);
    const terms = termsOf(preset, s);
    assert.ok(terms.length >= 1, `${preset.id}: периодов не нашлось вовсе`);

    for (const term of terms) {
      // Внутри периода обязан найтись день с учебной фазой. Ищем по всей его
      // длине: у периода бывают и каникулы внутри (золотая неделя), и экзамены.
      const seen = new Set();
      let day = term.start;
      for (let i = 0; i < term.span * 7; i += 1) {
        seen.add(phaseOf(preset, s, day));
        day = addDays(day, 1);
      }
      assert.ok(
        seen.has('study'),
        `${preset.id}: период «${term.name || term.index}» с ${term.start} не дал ни одного учебного дня: ${[...seen]}`,
      );
      assert.ok(
        seen.has('exams'),
        `${preset.id}: период «${term.name || term.index}» с ${term.start} не дал ни одного дня сессии: ${[...seen]}`,
      );
      // И номер недели считается внутри своего периода, а не сквозь весь год.
      assert.equal(termAt(preset, s, term.start).week, 1);
    }
  }
});

test('японский год: три триместра, и второй с третьим не каникулы', () => {
  const preset = PRESETS.find((p) => p.id === 'jp-highschool');
  const s = makeState(preset);
  assert.equal(termsOf(preset, s).length, 3);

  // Тот самый день, ради которого правилось ядро: 1 сентября — начало второго
  // триместра, а на трёх скалярах оно приходилось на вечные каникулы.
  assert.equal(phaseOf(preset, s, `${YEAR}-09-01`), 'study');
  assert.equal(termAt(preset, s, `${YEAR}-09-01`).index, 1);

  // Середина каждого триместра — учебная фаза, а не каникулы и не «между».
  assert.equal(phaseOf(preset, s, `${YEAR}-04-15`), 'study', 'первый триместр');
  assert.equal(phaseOf(preset, s, `${YEAR}-09-15`), 'study', 'второй триместр');
  assert.equal(phaseOf(preset, s, `${YEAR + 1}-02-16`), 'study', 'третий триместр');

  // Номер недели — внутри своего триместра: во втором это снова начало счёта.
  assert.equal(termAt(preset, s, `${YEAR}-09-15`).week, 3);
  assert.equal(termAt(preset, s, `${YEAR + 1}-02-16`).week, 7);

  // Промежуток между триместрами отличается от каникул после последнего.
  assert.equal(phaseOf(preset, s, `${YEAR}-12-21`), 'break', 'между вторым и третьим');
  assert.equal(phaseOf(preset, s, `${YEAR + 1}-03-22`), 'vacation', 'после третьего');
});

test('японский год прожит целиком: у каждого триместра своя сессия', () => {
  // Главный тест правки «сессия принадлежит периоду». До неё флаг `exams.active`,
  // поднятый в первом триместре, никогда не гас, и вход во второй не заводил ни
  // одного контрольного: три триместра были декорацией, работал только первый.
  const preset = PRESETS.find((p) => p.id === 'jp-highschool');
  let s = makeState(preset);
  const terms = termsOf(preset, s);
  assert.equal(terms.length, 3);

  const perTerm = SUBJECTS.length * 2; // 中間考査 и 期末考査 по каждому предмету
  const outcomes = new Map(); // id события → исход, каким он был сразу после сдачи

  terms.forEach((term, index) => {
    // Вход в сессию — событие календаря: день перед ней плюс сутки. Календарь
    // ставится руками только на канун, всё остальное делает ядро.
    const examDay = firstExamDayFrom(preset, s, term.start);
    s.calendar.day = addDays(examDay, -1);
    const entered = post(s, preset, 't=+1 day');
    s = entered.state;

    assert.equal(phaseOf(preset, s, s.calendar.day), 'exams', `триместр ${index + 1}: не сессия`);
    assert.equal(s.exams.active, true, `триместр ${index + 1}: сессия не открылась`);
    assert.equal(s.exams.term, index, `триместр ${index + 1}: сессия чужого периода`);
    assert.ok(
      entered.debug.applied.some((x) => x.kind === 'exams-scheduled' && x.term === index),
      `триместр ${index + 1}: контрольные не заведены`,
    );

    // Заведено ровно столько, сколько положено ЭТОМУ триместру, и ни одного id
    // не отобрано у прошлых: событие различается периодом, предметом и видом.
    const mine = s.exams.items.filter((i) => i.term === index);
    assert.equal(mine.length, perTerm);
    assert.equal(s.exams.items.length, perTerm * (index + 1));
    assert.equal(new Set(s.exams.items.map((i) => i.id)).size, s.exams.items.length);
    for (const item of mine) assert.equal(item.id, `${index}:${item.subjectId}:${item.kind}`);

    // Несданное — только своё: прошлые триместры пересдавать никто не зовёт.
    const mode = examMode(s, preset);
    assert.equal(mode.pending.length, perTerm, `триместр ${index + 1}: в остатке чужие контрольные`);
    assert.ok(mode.pending.every((i) => i.term === index));

    // Правило index.js «не больше одного контрольного за календарный день»
    // считается по дате и потому переживает смену периода: после первой сдачи
    // сегодняшний день занят, и второй раз садиться нельзя.
    const first = post(s, preset, 't=+0', { exam: true, rng: () => 0.9 });
    s = first.state;
    assert.ok(first.exam, `триместр ${index + 1}: контрольное не состоялось`);
    assert.equal(
      s.exams.items.filter((i) => i.outcome && i.day === s.calendar.day).length,
      1,
      `триместр ${index + 1}: за один день сдано больше одного контрольного`,
    );

    // Дальше сессия досдаётся: каждое контрольное — свой день.
    for (let n = 1; n < perTerm; n += 1) {
      const day = post(s, preset, 't=+1 day', { exam: true, rng: () => 0.9 });
      s = day.state;
      assert.ok(day.exam, `триместр ${index + 1}: контрольное ${n + 1} не состоялось`);
    }
    assert.equal(examMode(s, preset).pending.length, 0, `триместр ${index + 1}: сессия не досдана`);

    // Результаты всех прошлых сессий целы и не пересданы: попытка одна, исход
    // тот же, что был в день сдачи.
    for (const item of s.exams.items) {
      assert.equal(item.attempts, 1, `${item.id}: пересдано без причины`);
      assert.notEqual(item.outcome, null, `${item.id}: исход потерян`);
      if (outcomes.has(item.id)) assert.equal(item.outcome, outcomes.get(item.id), `${item.id}: исход переписан`);
      else outcomes.set(item.id, item.outcome);
    }

    // Зачётка складывается из всех сессий подряд, а не из одной за год.
    for (const subject of s.subjects) {
      assert.equal(subject.grades.length, 2 * (index + 1), `${subject.id}: оценок не по две за триместр`);
    }
    assert.equal(typeof overallScore(s, preset), 'number');
  });

  // Сессия последнего триместра — третья по счёту, а всего событий 24.
  assert.equal(s.exams.term, 2);
  assert.equal(s.exams.items.length, perTerm * 3);
  assert.equal(new Set(s.exams.items.map((i) => i.term)).size, 3);

  // И сессия гаснет, когда год кончился: иначе на каникулах панель прячет
  // расписание и обещает отрицательный остаток дней.
  s.calendar.day = `${YEAR + 1}-03-23`;
  const after = post(s, preset, 't=+1 day').state;
  assert.equal(phaseOf(preset, after, after.calendar.day), 'vacation');
  assert.equal(after.exams.active, false, 'сессия осталась включённой после года');
  assert.equal(after.exams.items.length, perTerm * 3, 'закрытие сессии стёрло результаты');
});

// --- несколько видов контрольных по одному предмету --------------------------

test('японский пресет даёт по предмету середину и конец, а не одно контрольное', () => {
  const preset = PRESETS.find((p) => p.id === 'jp-highschool');
  let s = makeState(preset);
  const examDay = firstExamDay(preset, s);
  s.calendar.day = addDays(examDay, -1);
  s = post(s, preset, 't=+1 day').state;

  assert.equal(s.exams.items.length, SUBJECTS.length * 2);
  for (const subject of SUBJECTS) {
    const mine = s.exams.items.filter((i) => i.subjectId === subject.id).map((i) => i.kind).sort();
    assert.deepEqual(mine, ['final', 'midterm'], `${subject.id}: видов не два`);
  }

  // Правило «не больше одного контрольного за календарный день» (index.js)
  // держится и при двух видах: сдаётся одно, второе остаётся на другой день.
  const sat = post(s, preset, 't=+0', { exam: true, rng: () => 0.9 });
  const done = sat.state.exams.items.filter((i) => i.outcome !== null);
  assert.equal(done.length, 1);
  assert.equal(done[0].day, sat.state.calendar.day);
  const takenToday = sat.state.exams.items
    .filter((i) => i.outcome && i.day === sat.state.calendar.day).length;
  assert.equal(takenToday, 1, 'за день сдано больше одного контрольного');
});

test('пресеты на одном виде на предмет не начали плодить лишние контрольные', () => {
  for (const preset of PRESETS) {
    if ((preset.exams.kinds || []).some((k) => k.everySubject === true)) continue;
    let s = makeState(preset);
    const examDay = firstExamDay(preset, s);
    s.calendar.day = addDays(examDay, -1);
    s = post(s, preset, 't=+1 day').state;
    assert.equal(
      s.exams.items.length,
      SUBJECTS.length,
      `${preset.id}: контрольных стало больше, чем предметов`,
    );
    const perSubject = new Set(s.exams.items.map((i) => i.subjectId));
    assert.equal(perSubject.size, SUBJECTS.length);
  }
});

// --- перекрёстная проверка: одинаковый прогон, разные слова ------------------

test('одинаковый прогон на разных пресетах даёт разный текст', () => {
  for (const slot of ['status', 'warn', 'permission', 'exam', 'examStatus']) {
    const seen = new Map();
    for (const preset of PRESETS) {
      const text = artifacts.get(`${preset.id}:${slot}`);
      assert.ok(text, `${preset.id}: артефакт «${slot}» не собран`);
      const twin = seen.get(text);
      assert.equal(
        twin,
        undefined,
        `${slot}: «${preset.id}» и «${twin}» выдали одинаковый текст — слово пришло из кода:\n${text}`,
      );
      seen.set(text, preset.id);
    }
  }
});

test('чужая лексика не просачивается в текст пресета', () => {
  // Слова, по которым пресет узнаётся: если они всплыли у соседа — течёт ядро.
  const marks = (p) => [p.vocab.examPeriod, p.vocab.debtPlural, p.vocab.score, p.vocab.teacher];

  for (const preset of PRESETS) {
    // Слово, которое встречается в собственном файле пресета, уликой быть не
    // может: «испытание» стоит в русской фразе про сдачу без испытания и
    // одновременно служит магической академии названием сессии. Совпадение
    // словарей двух сеттингов — не протечка ядра.
    const ownText = JSON.stringify(preset).toLowerCase();
    const mine = ['status', 'permission', 'exam', 'examStatus']
      .map((slot) => artifacts.get(`${preset.id}:${slot}`))
      .join('\n');

    for (const other of PRESETS) {
      if (other.id === preset.id) continue;
      for (const word of marks(other)) {
        if (ownText.includes(String(word).toLowerCase())) continue;
        assert.ok(
          !has(mine, word),
          `${preset.id}: в тексте всплыло «${word}» из пресета ${other.id}:\n${mine}`,
        );
      }
    }
  }
});

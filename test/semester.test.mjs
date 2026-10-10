import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createState, cloneState, validateState, takePending, pushJournal, teacherOfSubject,
} from '../core/state.mjs';
import { advance, setAbsolute, noteIdle, phaseOf, isStudyDay, weekIndex } from '../core/time.mjs';
import { buildSchedule, dayPlan } from '../core/schedule.mjs';
import { parseMarker, stripMarker } from '../core/parse-marker.mjs';
import { parseContext } from '../core/parse-context.mjs';
import { addGrade, setDebt, subjectScore, overallScore, debts } from '../core/gradebook.mjs';
import { mark, inferMissed, shouldInfer, effectiveSkips, totalStats } from '../core/attendance.mjs';
import { applyRelationDeltas, relationOf, relationLabel } from '../core/relations.mjs';
import { changeReputation, reputationLabel } from '../core/reputation.mjs';
import { scheduleExams, examMode, rollOutcome, applyOutcome, permissionLine, examTermIndex } from '../core/exams.mjs';
import { resolveHeldJump } from '../core/engine.mjs';
import { parsePreset } from './preset-file.mjs';

const preset = parsePreset(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));

// Это не тест одного модуля, а прогон всей цепочки — того, что во втором этапе
// сделает `index.js`: ответ модели → парсеры → календарь → расписание →
// посещаемость → зачётка/отношения/репутация → сессия. Таверны здесь нет,
// вместо неё лента синтетических «ответов модели» со служебной меткой из 3.1.

// --- семестр ----------------------------------------------------------------

/** Понедельник: первая неделя семестра начинается ровно с первого учебного дня. */
const TERM_START = '2024-09-02';

const SUBJECTS = [
  { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'ivanov' },
  { id: 'history', name: 'история', teacherId: 'sidorova' },
  { id: 'math', name: 'высшая математика', teacherId: 'kuznecov' },
];

const TEACHERS = [
  { id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['злопамятна'] },
  { id: 'ivanov', name: 'Иванов Пётр Ильич', traits: ['добродушен'] },
  { id: 'sidorova', name: 'Сидорова Мария Львовна', traits: ['придирается к опозданиям'] },
  { id: 'kuznecov', name: 'Кузнецов Илья Львович', traits: ['требователен'] },
];

/**
 * Свежий семестр: четыре предмета, четыре пары в дне, расписание из `schedule`.
 * `day` — с какого дня идёт сцена, если не с самого дня заведения.
 */
function semester(day) {
  const state = createState(preset, {
    startDay: TERM_START,
    subjects: SUBJECTS,
    teachers: TEACHERS,
    schedule: buildSchedule(SUBJECTS, preset),
  });
  state.started = true;
  if (day) state.calendar.day = day;
  return state;
}

/**
 * День, с которого идёт сцена, когда проверяется посещаемость. Сутки, в которые
 * семестр заведён, ведомостью не обсчитываются вовсе (`attendance.countsAttendance`),
 * поэтому прогулы считаются со следующего учебного дня — как в живой игре, где
 * семестр заводят днём, а прогуливать начинают назавтра.
 */
const DAY_TWO = '2024-09-03'; // вторник первой учебной недели


/** Подставной rng: конечная лента по кругу, исход обязан быть воспроизводим. */
const tape = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

/** Метка так, как её ставит модель: последней строкой, внутри HTML-комментария. */
const marker = (body) => `<!-- [ACADEMY ${body}] -->`;

// --- сшивка -----------------------------------------------------------------

/** Позиция в дне при точности «только день»: счётчик пар, а не часы. */
const posOf = (state) => (Number.isFinite(state.calendar.periodIndex) ? state.calendar.periodIndex : 0);

/**
 * Один ответ модели, прогнанный по всей цепочке.
 *
 * Порядок шагов не произволен и повторяет 3.2–3.5:
 *
 *  1. метка (источник B) разбирается первой — она точнее прозы;
 *  2. если метки со временем нет, время ищется в тексте (источник A), и только
 *     если нет и его — растёт счётчик простоя;
 *  3. посещаемость отмечается **до** сдвига времени: `skip=chemistry` относится
 *     к паре, которая идёт сейчас, а не к той, куда мы уедем;
 *  4. время двигается, и пройденные пары разносятся по ведомости (см. ниже);
 *  5. эффекты посещаемости — отношения, хвосты, репутация — применяются одним
 *     пакетом в конце, чтобы пороги репутации пробивались один раз, а не по
 *     разу на каждую отметку;
 *  6. одноразовые инжекты снимаются `takePending` — как по MESSAGE_RECEIVED.
 *
 * @returns {{state, injects, rejected, missed, notes}}
 */
function post(state, text, opts = {}) {
  const out = { rejected: [], missed: [], notes: [] };
  let s = state;

  const ctx = { ...preset, subjects: s.subjects, teachers: s.teachers };
  const parsed = parseMarker(text, ctx);
  out.rejected = parsed.rejected;

  // --- (3) посещаемость по метке: до сдвига времени -------------------------
  const effects = { relation: [], reputation: 0, debt: [] };
  const plan = dayPlan(s, preset);
  for (const ev of parsed.events.filter((e) => e.kind === 'attendance')) {
    const slot = plan.find((p) => p.subjectId === ev.subjectId);
    const res = mark(s, {
      subjectId: ev.subjectId,
      status: ev.status,
      day: s.calendar.day,
      periodIndex: slot ? slot.index : posOf(s),
    }, preset);
    s = res.state;
    absorb(effects, res.effects);
  }

  // --- (1,2,4) время --------------------------------------------------------
  const fromDay = s.calendar.day;
  const fromPos = posOf(s);
  const timeEvents = parsed.events.filter((e) => e.kind === 'time');
  let moved = false;
  let unit = null;

  for (const ev of timeEvents) {
    // `allowBack` не передаётся: метка модели правом двигать календарь назад не
    // обладает, и отказ приходит из `time.advance` — сшивка ему доверяет, своей
    // защиты у неё нет. Ручной ремонт календаря в панели пойдёт с `allowBack`.
    const r = advance(s, ev, preset);
    s = r.state;
    if (r.applied) {
      moved = true;
      unit = ev.unit;
    } else out.notes.push(r.reason);
  }

  if (!timeEvents.length) {
    const hit = parseContext(stripMarker(text));
    if (hit && (hit.day || hit.time)) {
      // `force` — это ответ человека «принять» на придержанный прыжок
      // (`engine.resolveHeldJump`). Клон повторяет и его: иначе шов не смог бы
      // проверить, что происходит ПОСЛЕ согласия на далёкий прыжок.
      const r = setAbsolute(s, { day: hit.day, time: hit.time, daypart: hit.daypart }, 'A', preset,
        { force: Boolean(opts.force) });
      s = r.state;
      if (r.applied) {
        moved = true;
        unit = 'absolute';
      } else {
        out.notes.push(r.reason);
        // Тот же шаг, что в `engine.applyTime`: прыжок дальше потолка не
        // выбрасывается, а придерживается до слова человека.
        if (r.held) { s = cloneState(s); s.calendar.heldJump = { ...r.held }; }
      }
    } else {
      s = noteIdle(s);
    }
  }

  // --- (4) что стало с парами, которые прошли -------------------------------
  const sweep = sweepAttendance(s, fromDay, fromPos, unit, preset);
  s = sweep.state;
  out.missed = sweep.missed;
  absorb(effects, sweep.effects);

  // --- зачётка и отношения из метки ----------------------------------------
  for (const ev of parsed.events.filter((e) => e.kind === 'grade')) {
    const r = addGrade(s, { subjectId: ev.subjectId, value: ev.value }, preset);
    s = r.state;
    if (!r.applied) out.notes.push(r.reason);
  }
  const rel = applyRelationDeltas(s, parsed.events.filter((e) => e.kind === 'rel'), preset);
  s = rel.state;

  // --- (5) эффекты посещаемости одним пакетом -------------------------------
  s = applyRelationDeltas(s, effects.relation, preset).state;
  for (const id of effects.debt) s = setDebt(s, id, true, preset);
  if (effects.reputation) {
    s = changeReputation(s, { delta: effects.reputation, reason: 'посещаемость' }, preset).state;
  }

  // --- сессия ---------------------------------------------------------------
  // Сторож повторяет `engine.applyResponse`: сессия принадлежит учебному
  // периоду, и открыта ли она — вопрос про ЭТОТ период, а не про год.
  if (moved && phaseOf(preset, s, s.calendar.day) === 'exams') {
    const term = examTermIndex(preset, s, s.calendar.day);
    if (!s.exams.active || s.exams.term !== term) {
      s = scheduleExams(s, preset, { day: s.calendar.day, term });
    }
  }
  if (opts.exam) s = sitExam(s, opts.rng || Math.random, out);

  // --- (6) инварианты и одноразовые инжекты ---------------------------------
  assertInvariants(s);
  out.injects = takePending(s);
  out.state = s;
  return out;
}

/**
 * Пары, оставшиеся позади, разносятся по ведомости.
 *
 * Правило прямо из 3.4: «если пара прошла, а сцена всё это время была в другом
 * месте, она считается пропущенной». Отличить одно от другого можно по тому, чем
 * двигалось время: `t=+1` — сцена идёт по учебному дню, пара за парой, значит
 * студентка на месте; `t=+1 day` и прыжок датой из прозы — день перескочили
 * целиком, и всё, что в нём стояло, прошло без неё.
 *
 * Перелив через полночь считается сдвигом по парам, а не прыжком: четвёртое
 * подряд `t=+1` в дне из четырёх пар уводит календарь в следующий учебный день
 * (`time.advancePeriods`), и последняя пара дня обязана остаться посещённой, а
 * не превратиться в прогул на ровном месте.
 *
 * Записи, которые уже есть (`skip=` из метки), ни одна ветка не трогает:
 * `inferMissed` их пропускает, `present` ставится только на пустой слот.
 */
function sweepAttendance(state, fromDay, fromPos, unit, cfg) {
  let s = state;
  const missed = [];
  const effects = { relation: [], reputation: 0, debt: [] };
  if (!unit) return { state: s, missed, effects };

  const present = (acc, day, from, to) => {
    for (const item of dayPlan(acc, cfg, day)) {
      if (item.index < from || item.index >= to) continue;
      const taken = acc.attendance.records.some(
        (r) => r.day === day && r.subjectId === item.subjectId && r.periodIndex === item.index,
      );
      if (taken) continue;
      const res = mark(acc, { subjectId: item.subjectId, status: 'present', day, periodIndex: item.index }, cfg);
      acc = res.state;
      absorb(effects, res.effects);
    }
    return acc;
  };

  if (unit === 'period') {
    if (s.calendar.day === fromDay) return { state: present(s, fromDay, fromPos, posOf(s)), missed, effects };
    s = present(s, fromDay, fromPos, Infinity);
    return { state: present(s, s.calendar.day, 0, posOf(s)), missed, effects };
  }

  // Решение «дозаполнять ли ведомость за этот прыжок» принимает ядро, и ровно
  // один раз на прыжок: горизонта в сшивке нет ни константой, ни условием, иначе
  // на втором этапе его пришлось бы писать заново в `index.js`.
  if (!shouldInfer(fromDay, s.calendar.day, cfg)) {
    s = pushJournal(cloneState(s), {
      kind: 'attendance',
      text: `attendance skipped: прыжок ${fromDay} → ${s.calendar.day} дальше горизонта`,
      data: { fromDay, toDay: s.calendar.day },
    }, cfg);
    return { state: s, missed, effects };
  }

  // День сменился прыжком: всё, что стояло в пройденных учебных днях, прошло мимо.
  for (let day = fromDay; isBefore(day, s.calendar.day); day = nextDay(day)) {
    if (!isStudyDay(cfg, day)) continue;
    const expected = dayPlan(s, cfg, day).map((p) => ({ subjectId: p.subjectId, periodIndex: p.index }));
    if (!expected.length) continue; // сессия и каникулы: лекций нет, прогуливать нечего
    const res = inferMissed(s, { day, expected }, cfg);
    s = res.state;
    missed.push(...res.missed);
    absorb(effects, res.effects);
  }
  return { state: s, missed, effects };
}

/** Одно контрольное событие сессии: балл + отношение + зажатый случай (3.5). */
function sitExam(state, rng, out) {
  const mode = examMode(state, preset);
  const item = mode.pending[0];
  if (!item) return state;

  const score = subjectScore(state, item.subjectId, preset).average ?? preset.grades.startScore;
  const teacher = teacherOfSubject(state, item.subjectId);
  out.permission = permissionLine(state, preset, { subjectId: item.subjectId, score });

  // Репутация входит в сложность с 9.4.1 — черновик держится в ногу с
  // `engine.sitExam`, иначе сравнение с ним в `engine.test` потеряло бы смысл.
  const roll = rollOutcome({
    score, relation: teacher ? teacher.relation : 0, reputation: state.reputation.value, kind: item.kind,
  }, preset, rng);
  const res = applyOutcome(state, { examId: item.id, value: roll.value, day: state.calendar.day, reason: roll.reason }, preset);
  out.exam = { subjectId: item.subjectId, value: roll.value, reason: roll.reason };

  const delta = preset.reputation.delta;
  const passed = subjectScore(res.state, item.subjectId, preset).passed;
  return changeReputation(res.state, { delta: passed ? delta.examPassed : delta.examFailed, reason: 'сессия' }, preset).state;
}

/** Инварианты, которые обязаны держаться после каждого ответа модели. */
function assertInvariants(s) {
  const v = validateState(s, preset);
  assert.deepEqual(v.errors, [], 'состояние обязано оставаться валидным на каждом шаге');
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s, 'состояние переживает круг через JSON без потерь');
  assert.ok(s.journal.length <= preset.limits.journalSize, 'журнал не перерастает потолок пресета');
}

function absorb(acc, effects) {
  acc.relation.push(...effects.relation);
  acc.reputation += effects.reputation;
  acc.debt.push(...effects.debt.filter((id) => !acc.debt.includes(id)));
}

const nextDay = (day) => {
  const t = Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) + 86400000;
  const d = new Date(t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
};
const isBefore = (a, b) => a < b;

/** Прогнать ленту ответов; вернуть последнее состояние и все шаги. */
function run(state, feed) {
  let s = state;
  const steps = [];
  for (const item of feed) {
    const text = typeof item === 'string' ? item : item.text;
    const opts = typeof item === 'string' ? {} : item;
    const r = post(s, text, opts);
    s = r.state;
    steps.push(r);
  }
  return { state: s, steps };
}

/**
 * Один учебный день целиком: четыре `t=+1` по числу пар в пресете. Пятого
 * ответа с «наступила ночь» не нужно — четвёртое `t=+1` само переливается в
 * следующий учебный день, выходные при этом пропускаются календарём.
 */
function studyDay(extra = {}) {
  const feed = [];
  for (let i = 0; i < preset.week.periodsPerDay; i += 1) {
    const body = extra[i] ? `t=+1 ${extra[i]}` : 't=+1';
    feed.push(`Пара идёт своим чередом.\n${marker(body)}`);
  }
  return feed;
}

// --- сценарий 1: прилежная студентка ----------------------------------------

test('прилежная студентка доходит до сессии и закрывает её без хвостов', () => {
  let s = semester();
  // Отыгрываются последние три учебные недели семестра: 2 декабря — понедельник
  // четырнадцатой недели, шестнадцатая кончается 20-го, дальше сессия. Так лента
  // упирается в неё сама, без прыжка через полсеместра.
  s.calendar.day = '2024-12-02';
  assert.equal(weekIndex(s), 14);

  // Три учебные недели: ходит на всё, каждый третий день — контрольные по всем
  // четырём предметам, оценки чередуются «5/4».
  const feed = [];
  for (let d = 0; d < 15; d += 1) {
    const extra = {};
    if (d % 3 === 0) {
      for (let i = 0; i < SUBJECTS.length; i += 1) extra[i] = `grade=${SUBJECTS[i].id}:${(d + i) % 2 === 0 ? '5' : '4'}`;
    }
    if (d % 5 === 0) extra[0] = `${extra[0] || ''} rel=petrova:+1`.trim();
    feed.push(...studyDay(extra));
  }
  ({ state: s } = run(s, feed));

  const att = totalStats(s);
  assert.equal(att.skips, 0, 'ни одного прогула за три недели');
  assert.equal(att.present, 60, 'пятнадцать учебных дней по четыре пары');
  assert.equal(debts(s).length, 0, 'хвостов нет');
  assert.ok(s.reputation.value >= preset.reputation.start, 'репутация не упала ниже стартовой');
  assert.equal(s.reputation.warned, false, 'в деканат не вызывали');
  assert.equal(s.reputation.expelled, false);
  assert.equal(relationOf(s, 'petrova'), 3, 'три «+1» от Петровой');
  assert.equal(relationLabel(s, 'petrova', preset), 'благоволит');

  // Прыжок в сессию: время двигает не метка, а проза (источник A).
  const jump = post(s, '📅 24 декабря 2024, 09:00\nСессия началась.');
  s = jump.state;
  assert.equal(phaseOf(preset, s, s.calendar.day), 'exams');
  assert.equal(s.exams.active, true, 'вход в период завёл сессию');
  assert.equal(s.exams.items.length, 4, 'по контрольному событию на предмет');
  assert.deepEqual(jump.missed, [], 'в сессию лекций нет — прогулов не выводится');

  // Четыре контрольных подряд. Лента rng — середина шкалы: везение ни при чём,
  // всё решает накопленный балл.
  const rng = tape(0.5, 0.5, 0.5, 0.5);
  const session = [];
  for (let i = 0; i < 4; i += 1) {
    session.push({ text: `Аудитория, ведомость на столе.\n${marker('t=+1 day')}`, exam: true, rng });
  }
  const done = run(s, session);
  s = done.state;

  assert.equal(examMode(s, preset).pending.length, 0, 'сессия закрыта целиком');
  assert.equal(debts(s).length, 0, 'хвостов после сессии нет');
  assert.ok(s.exams.items.every((i) => i.attempts === 1), 'все с первой попытки');
  // Обе шкалы пресета отработали: зачёт по накопленному баллу и оценка броском.
  assert.deepEqual(s.exams.items.map((i) => `${i.kind}=${i.outcome}`),
    // Было `exam=4` — до проверки против DC (9.4.1). Середина кубика у
    // прилежной студентки проходит с запасом больше `critMargin`: крит, высшая.
    ['credit=зачёт', 'exam=5', 'credit=зачёт', 'exam=5']);

  const score = overallScore(s, preset);
  assert.ok(score > 4 && score <= 5, `итоговый балл вменяем: ${score}`);
  assert.equal(s.reputation.value, preset.reputation.start + 4 * preset.reputation.delta.examPassed,
    'репутация выросла ровно на четыре сданных');
  assert.equal(s.reputation.expelled, false, 'прилежную не отчисляют');

  // Каждый исход подан ровно одним одноразовым инжектом и снят сразу.
  for (const step of done.steps) {
    assert.equal(step.injects.length, 1, 'один инжект на одно контрольное событие');
    assert.equal(step.injects[0].kind, 'exam');
    assert.ok(step.permission.includes(preset.vocab.examPeriod), 'фраза разрешения ушла в промпт');
  }
  assert.deepEqual(s.pending, [], 'очередь пуста: takePending снял всё');
});

// --- сценарий 2: прогульщица -------------------------------------------------

test('прогульщицу отчисляют, и каждый порог инжектится ровно один раз', () => {
  let s = semester(DAY_TWO);
  const before = s.reputation.value;

  // Прогул — только прямой факт (`skip=`): сцена каждый день называет все четыре
  // пары прогулянными. Календарь молчаливых прогулов больше не выводит.
  const feed = [];
  for (let d = 0; d < 5; d += 1) {
    feed.push(`Она снова не пошла.\n${marker('t=+1 day skip=chemistry skip=physics skip=history skip=math')}`);
  }
  const { state: after, steps } = run(s, feed);
  s = after;

  const att = totalStats(s);
  assert.equal(att.skips, 20, `прогулов: ${att.skips}`);
  assert.equal(effectiveSkips(s, 'chemistry', preset) >= preset.attendance.debtAfterSkips, true);
  assert.equal(debts(s).length, 4, 'хвост по каждому предмету');

  assert.ok(s.reputation.value < before);
  assert.equal(s.reputation.value, preset.reputation.min, 'репутация ушла в пол');
  assert.equal(s.reputation.warned, true);
  assert.equal(s.reputation.expelled, true, 'прогульщица обязана быть отчислена');
  assert.equal(reputationLabel(s, preset), 'отчислена');

  // Пороги: предупреждение на десятом прогуле (третий день), отчисление на
  // семнадцатом (пятый) — и ни одного повтора, хотя репутация всё это время
  // лежит ниже порога предупреждения.
  const kinds = steps.map((st) => st.injects.map((i) => i.id));
  assert.deepEqual(kinds, [[], [], ['reputation-warn'], [], ['reputation-expel']], JSON.stringify(kinds));
  assert.deepEqual(s.pending, [], 'очередь снята полностью');
  assert.equal(steps[2].injects[0].text, preset.vocab.warnInject);
  assert.equal(steps[4].injects[0].text, preset.vocab.expelInject);
});

test('порог репутации не размножается, даже когда за один ответ пробиты оба', () => {
  let s = semester(DAY_TWO);
  s.reputation.value = 3; // один удар ниже и предупреждения, и отчисления
  const r = post(s, `Скандал на весь факультет.\n${marker('t=+1 day')}`);

  assert.equal(r.state.reputation.expelled, true);
  assert.equal(r.state.reputation.warned, true, 'порог предупреждения тоже отмечен пройденным');
  assert.deepEqual(r.injects.map((i) => i.id), ['reputation-expel'],
    'отчисление старше предупреждения: инжект один, а не два');
});

// --- сценарий 3: своенравная модель ------------------------------------------

test('кривая метка не роняет ядро: мусор в rejected, годное из того же блока применяется', () => {
  let s = semester();
  s = post(s, `Первая пара.\n${marker('t=+1')}`).state;

  // В одном блоке: выдуманная единица времени, неизвестный предмет, неизвестная
  // оценка, дельта отношения за пределами шкалы — и рядом три годных события.
  const r = post(s, [
    'Петрова придиралась всю пару.',
    marker('t=+night grade=биология:5 grade=физика:отл rel=petrova:+9 grade=аналитическая химия:4 skip=история'),
  ].join('\n'));
  s = r.state;

  const reasons = r.rejected.map((x) => x.raw);
  assert.deepEqual(reasons, ['t=+night', 'grade=биология:5', 'grade=физика:отл'],
    'мусор опознан поимённо: единица, предмет, оценка');
  assert.ok(s.journal.some((e) => e.kind === 'attendance' && e.text.includes('history=skip')));

  assert.equal(subjectScore(s, 'chemistry', preset).grades.length, 1, 'годная оценка того же блока применена');
  assert.equal(relationOf(s, 'petrova'), preset.relations.max,
    'дельта +9 зажата шкалой пресета — зажим живёт в relations, не в парсере');
  assert.equal(totalStats(s).skips, 1, 'прогул по метке отмечен');
  assert.equal(s.calendar.day, TERM_START, 'выдуманная единица времени календарь не двинула');

  // `t=+night` отсеивается парсером, а не календарём: до `time.advance` он не
  // доходит вовсе. Значит, для сшивки этот ответ — ответ без времени, и счётчик
  // простоя растёт. Это ровно тот случай, ради которого он заведён.
  assert.equal(s.calendar.idle, 1, 'ответ, в котором время не разобралось, считается простоем');

  // Откат назад — и меткой, и прозой. Календарь назад не едет ни там ни там.
  const dayBefore = s.calendar.day;
  const back = post(s, `Всё сначала.\n${marker('t=-3 day')}`);
  assert.equal(back.state.calendar.day, dayBefore, 'откат по метке отклонён самим time.advance');
  assert.ok(back.notes.some((n) => n.startsWith('откат календаря назад')), JSON.stringify(back.notes));
  assert.equal(back.state.calendar.idle, 0, 'источник сработал — простой не растёт');

  const prose = post(back.state, 'Она проснулась.\n\n1 сентября 2024 года, 07:00\nВсё сначала.');
  assert.equal(prose.state.calendar.day, dayBefore, 'откат прозой отклонён time.setAbsolute');
  assert.ok(prose.state.journal.some((e) => e.kind === 'debug' && e.text.startsWith('откат времени назад')));

  // «автомат» выглядит как мусор, но это законное значение шкалы пресета.
  const auto = post(prose.state, `Кузнецов махнул рукой.\n${marker('t=+1 grade=высшая математика:автомат')}`);
  assert.deepEqual(auto.rejected, []);
  assert.equal(subjectScore(auto.state, 'math', preset).grades[0].value, 'автомат');
  assert.equal(subjectScore(auto.state, 'math', preset).debt, false);
});

test('ответ без метки и без времени в прозе копит простой, а не двигает календарь', () => {
  const s = semester();
  const r = post(s, 'Она молча смотрела в окно, и ничего не происходило.');
  assert.equal(r.state.calendar.day, TERM_START);
  assert.equal(r.state.calendar.idle, 1);
  assert.deepEqual(r.missed, []);
});

// --- швы --------------------------------------------------------------------

test('шов: «в сессии ли мы» одинаково по time.phaseOf и по exams.examMode', () => {
  const s = semester();
  const cal = preset.calendar;

  // Последний день, который `phaseOf` называет сессией, — он же последний день,
  // на который `examMode` обещает неотрицательный остаток.
  let last = null;
  let cur = TERM_START;
  for (let i = 0; i < 250; i += 1) {
    if (phaseOf(preset, s, cur) === 'exams') last = cur;
    cur = nextDay(cur);
  }
  assert.ok(last, 'сессия в календаре нашлась');
  assert.equal(weekIndex(s, last), cal.studyWeeks + cal.examWeeks);

  const at = (day) => examMode({ ...s, calendar: { ...s.calendar, day }, exams: { active: true, items: [] } }, preset);
  assert.equal(at(last).daysLeft >= 0, true, `в последний день сессии остаток ${at(last).daysLeft}`);
  assert.ok(at(nextDay(last)).daysLeft < at(last).daysLeft);
  // Ровно два дня до конца недели: суббота и воскресенье, парами не занятые.
  assert.equal(at(last).daysLeft, 2);
});

test('шов: сессия и каникулы дают пустой день — прогулов из них не выводится', () => {
  const s = semester();
  for (const day of ['2024-12-25', '2024-11-05', '2024-09-07']) {
    assert.deepEqual(dayPlan(s, preset, day), [], `${day}: пар нет`);
    const r = inferMissed(s, { day, expected: [] }, preset);
    assert.deepEqual(r.missed, [], `${day}: и прогулов нет`);
    assert.equal(r.state.attendance.records.length, 0);
  }
});

test('шов: оценка сессии попадает в зачётку один раз, хвост ставится один раз', () => {
  let s = semester();
  s = scheduleExams(s, preset, { day: '2024-12-24' });
  const item = s.exams.items.find((i) => i.subjectId === 'physics');

  const fail = applyOutcome(s, { examId: item.id, value: '2', day: '2024-12-24' }, preset);
  const view = subjectScore(fail.state, 'physics', preset);
  assert.equal(view.grades.length, 1, 'одна запись, а не две: пишет только gradebook');
  assert.equal(view.grades[0].value, '2');
  assert.equal(view.debt, false, 'пока есть пересдачи, хвоста нет — правило сессии сильнее общего');

  // Попытки кончились — вот теперь хвост, и тоже один.
  let acc = fail.state;
  for (let i = 0; i < preset.exams.retakes; i += 1) {
    const cur = acc.exams.items.find((x) => x.id === item.id);
    acc = applyOutcome(acc, { examId: cur.id, value: '2', day: '2024-12-25' }, preset).state;
  }
  const ended = subjectScore(acc, 'physics', preset);
  assert.equal(acc.exams.items.find((x) => x.id === item.id).attempts, preset.exams.retakes + 1);
  assert.equal(ended.grades.length, preset.exams.retakes + 1);
  assert.equal(ended.debt, true, 'попытки исчерпаны — хвост');
  assert.equal(debts(acc).filter((x) => x.id === 'physics').length, 1, 'хвост ровно один');
});

test('шов: прыжок дальше горизонта не даёт ни одного прогула', () => {
  const s = semester(DAY_TWO);
  const horizon = preset.attendance.inferHorizonDays;

  // Сентябрь → конец декабря одним ответом. «Три месяца спустя» не значит, что
  // последнюю неделю из них она прогуливала, — это значит, что про эти три
  // месяца не известно ничего. Восстанавливать хвостовую неделю и отчислять по
  // ней было бы выдуманным последствием: цена ложного вывода выше цены пропуска
  // (раздел 5 плана), та же логика, что у запрета отката времени.
  // Прыжок дальше потолка календарь придерживает и спрашивает человека; здесь
  // ответ — «принять», и дальше проверяется ровно то же, что раньше.
  const text = `📅 24 декабря 2024, 09:00
Она вернулась после долгого перерыва.`;
  const asked = post(s, text);
  assert.equal(asked.state.calendar.heldJump.day, '2024-12-24', 'сперва вопрос, а не прыжок');

  const jump = post(s, text, { force: true });
  assert.equal(jump.state.calendar.day, '2024-12-24', 'принятый прыжок вперёд едет');

  assert.deepEqual(jump.missed, [], 'ни одного прогула за прыжок');
  assert.deepEqual(jump.state.attendance.records, [], 'ведомость не тронута вовсе');
  assert.equal(jump.state.reputation.value, preset.reputation.start, 'репутация не изменилась');
  assert.equal(jump.state.reputation.warned, false);
  assert.equal(jump.state.reputation.expelled, false, 'одним ответом человека не отчисляют');
  assert.equal(debts(jump.state).length, 0);
  assert.ok(jump.state.journal.some((e) => e.kind === 'attendance' && e.text.includes('дальше горизонта')));

  // Вторая сторона: прыжок в пределах горизонта ведомость дозаполняет как
  // раньше. Без этой половины тест доказывал бы только то, что всё выключено.
  const near = post(s, `Четыре дня как в тумане.
${marker(`t=+${horizon - 3} day`)}`);
  assert.equal(near.missed.length, (horizon - 3) * preset.week.periodsPerDay,
    'четыре учебных дня по четыре пары');
  assert.ok(near.state.reputation.value < preset.reputation.start, 'и последствия настоящие');
  assert.deepEqual(near.state.journal.filter((e) => e.text.includes('дальше горизонта')), []);

  // Само правило читается из ядра, а не из сшивки: предикат отвечает на вопрос
  // «прыжок с такого-то дня на такой-то» и вызывается один раз на прыжок.
  assert.equal(shouldInfer(TERM_START, '2024-12-24', preset), false);
  assert.equal(shouldInfer(TERM_START, '2024-09-06', preset), true);
  assert.equal(shouldInfer(TERM_START, '2024-09-09', preset), true, 'ровно горизонт — ещё в пределах');
  assert.equal(shouldInfer(TERM_START, '2024-09-10', preset), false, 'на день дальше — уже нет');
  assert.equal(shouldInfer('2024-09-10', TERM_START, preset), false, 'направление прыжка не важно');
  assert.equal(shouldInfer(TERM_START, '2024-12-24', { attendance: {} }), true,
    'пресет без горизонта потолка не имеет');
  assert.equal(shouldInfer('позавчера', '2024-12-24', preset), true, 'считать не от чего — как раньше');
});

test('шов: сдвиг больше потолка пресета календарь не двигает', () => {
  const s = semester();
  const r = post(s, `Прошло полгода.
${marker(`t=+${preset.limits.maxTimeShift + 10} day`)}`);
  assert.equal(r.state.calendar.day, TERM_START, 'потолок `limits.maxTimeShift` держит time.advance');
  assert.ok(r.notes.some((n) => n.includes('потолка')), JSON.stringify(r.notes));
  assert.deepEqual(r.missed, []);
});

test('шов: инжекты сессии и репутации живут в одной очереди и снимаются разом', () => {
  let s = semester();
  s = scheduleExams(s, preset, { day: '2024-12-24' });
  s.reputation.value = 21; // ещё выше порога предупреждения

  const item = s.exams.items[0];
  s = applyOutcome(s, { examId: item.id, value: '2', day: '2024-12-24' }, preset).state;
  s = changeReputation(s, { delta: preset.reputation.delta.examFailed, reason: 'сессия' }, preset).state;

  assert.equal(s.pending.length, 2, 'два разных факта — два инжекта, без дублей');
  const taken = takePending(s);
  assert.deepEqual(taken.map((p) => p.kind), ['exam', 'reputation']);
  assert.deepEqual(s.pending, [], 'снялось всё разом');
  assert.deepEqual(takePending(s), [], 'второй раз тот же инжект не выдаётся');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  scheduleExams, applyOutcome, resolveConflict, sittableExams, announceRule, announceDay,
  announceResults, awaitingAnnouncement, publicView, sceneGuard, withSceneGuard, DEFAULT_SCENE_GUARD,
} from '../core/exams.mjs';
import { applyResponse, sitExam } from '../core/engine.mjs';
import {
  createState, validateState, normalizeTeacher,
} from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { upcomingEvents, nearHorizon, nearLimit, DEFAULT_HORIZON, DEFAULT_LIMIT } from '../core/upcoming.mjs';
import { statusLine, countNumbers } from '../prompt.mjs';
import { isSignificant, significantEvents } from '../core/lorebook.mjs';
import { debts, overallScore } from '../core/gradebook.mjs';
import { dayOfWeek } from '../core/time.mjs';

// Шаг 6 порядка 9.6, ядро: «знает расширение / знает мир» (9.4.3), ближние
// события в строке (9.4.4), оговорка «сцена не для пары» (9.4.9) и сводка
// прыжка (9.4.4). Повод в `rel` и кубик соседа — в `dice-cue.test.mjs` и
// `rel-reason.test.mjs`.

const loadPreset = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));
const preset = loadPreset('ru-university');
const JP = loadPreset('jp-highschool');
const MAGIC = loadPreset('magic-academy');

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

function semester(day, p = preset, teachers = TEACHERS) {
  const s = createState(p, {
    startDay: '2024-09-02', subjects: SUBJECTS, teachers, schedule: buildSchedule(SUBJECTS, p),
  });
  s.started = true;
  if (day) s.calendar.day = day;
  return s;
}

/** Сессия открыта в понедельник 23.12.2024; у вуза по кругу: химия — зачёт, физика — экзамен. */
function inSession() {
  return scheduleExams(semester('2024-12-23'), preset, { day: '2024-12-23', term: 0 });
}

const PHYSICS = '0:physics:exam';
const CHEMISTRY = '0:chemistry:credit';

// --- 9.4.3: правило объявления ----------------------------------------------

test('9.4.3 правило объявления: учебные дни, день недели, число, вид сильнее пресета, мусор — сразу', () => {
  const p = { ...preset, exams: { ...preset.exams, announce: { studyDays: 2 }, kinds: [
    { id: 'a', scale: 'points', announce: { weekday: 5 } },
    { id: 'b', scale: 'points' },
    { id: 'c', scale: 'points', announce: 0 },
    { id: 'd', scale: 'points', announce: 3 },
    { id: 'e', scale: 'points', announce: { weekday: 9 } },
  ] } };
  assert.deepEqual(announceRule(p, 'a'), { weekday: 5 }, 'вид сильнее пресета');
  assert.deepEqual(announceRule(p, 'b'), { studyDays: 2 }, 'вид молчит — правило пресета');
  assert.equal(announceRule(p, 'c'), null, '0 — объявлено сразу');
  assert.deepEqual(announceRule(p, 'd'), { studyDays: 3 }, 'число — сокращение studyDays');
  assert.equal(announceRule(p, 'e'), null, 'мусор — сразу, а не догадка');
  assert.equal(announceRule({ ...preset, exams: { kinds: [{ id: 'x' }] } }, 'x'), null, 'пресет молчит — сразу');

  // Пятница 20.12: второй учебный день — вторник 24.12 (выходные не считаются).
  assert.equal(announceDay(p, 'b', '2024-12-20'), '2024-12-24');
  // «В ближайшую пятницу» — строго после сдачи: сдача в пятницу — через неделю.
  assert.equal(announceDay(p, 'a', '2024-12-18'), '2024-12-20');
  assert.equal(announceDay(p, 'a', '2024-12-20'), '2024-12-27');
  assert.equal(dayOfWeek(announceDay(p, 'a', '2024-12-23')), 5);
});

test('9.4.3 правила трёх пресетов: вуз — экзамен назавтра, зачёт сразу; Япония — через два дня; академия — в пятницу', () => {
  assert.equal(announceDay(preset, 'credit', '2024-12-23'), null, 'зачёт ставят в зачётку на месте');
  assert.equal(announceDay(preset, 'exam', '2024-12-23'), '2024-12-24');
  assert.equal(announceDay(JP, 'midterm', '2024-06-07'), '2024-06-11', 'пятница → вторник');
  assert.equal(dayOfWeek(announceDay(MAGIC, 'trial', '2024-12-23')), 5);
});

// --- 9.4.3: сдача, пометка, объявление --------------------------------------

test('9.4.3 исход посчитан сразу, а вердикт — «закрытые сведения, не знание персонажей» с датой', () => {
  const { state, pending } = applyOutcome(inSession(), { examId: PHYSICS, value: '2', day: '2024-12-23' }, preset);
  const item = state.exams.items.find((i) => i.id === PHYSICS);
  assert.equal(item.outcome, '2', 'исход известен расширению сразу');
  assert.equal(item.announced, false);
  assert.equal(item.announceOn, '2024-12-24');
  assert.ok(awaitingAnnouncement(item));

  // Тот же канал, что до правки (9.1.2 держит его через свайп и F5): kind и id.
  assert.equal(pending.kind, 'exam');
  assert.equal(pending.id, `exam:${PHYSICS}:1`);
  assert.match(pending.text, /Закрытые сведения симуляции, не знание персонажей/);
  assert.match(pending.text, /24\.12/);
  assert.match(pending.text, /неудовлетворительно/, 'модель итог знает');
  assert.match(pending.text, /Отыграй саму сдачу/, 'сама сдача по-прежнему отыгрывается сейчас');

  // Журнал — `private`: хроника такой исход не берёт.
  const rec = state.journal.filter((e) => e.kind === 'exam' && e.data && e.data.examId === PHYSICS).at(-1);
  assert.equal(rec.data.private, true);
  assert.equal(isSignificant(rec, state, preset), false);
});

test('9.4.3 зачёт вуза и автомат объявлены сразу — прежний вердикт без пометки', () => {
  const credit = applyOutcome(inSession(), { examId: CHEMISTRY, value: 'зачёт', day: '2024-12-23' }, preset);
  const item = credit.state.exams.items.find((i) => i.id === CHEMISTRY);
  assert.equal('announced' in item, false, 'сразу — ни одного нового поля на событии');
  assert.match(credit.pending.text, /^Свершилось: аналитическая химия — зачёт/);

  const auto = applyOutcome(inSession(), { examId: PHYSICS, value: 'автомат', day: '2024-12-23', reason: 'auto' }, preset);
  assert.equal(awaitingAnnouncement(auto.state.exams.items.find((i) => i.id === PHYSICS)), false,
    'автомат известен до сдачи — объявлять нечего');
});

test('9.4.3 объявление: в свой день, один раз, одноразовым фактом и записью для хроники', () => {
  const sat = applyOutcome(inSession(), { examId: PHYSICS, value: '4', day: '2024-12-23' }, preset).state;
  sat.pending = [];

  assert.deepEqual(announceResults(sat, preset, '2024-12-23').announced, [], 'рано');
  const r = announceResults(sat, preset, '2024-12-24');
  assert.deepEqual(r.announced, [PHYSICS]);
  const item = r.state.exams.items.find((i) => i.id === PHYSICS);
  assert.equal(item.announced, true);
  assert.equal(r.state.pending.length, 1);
  assert.equal(r.state.pending[0].id, `announce:${PHYSICS}:1`);
  assert.equal(r.state.pending[0].kind, 'announce');
  assert.match(r.state.pending[0].text, /^Итоги объявлены: физика — хорошо/);

  const rec = r.state.journal.at(-1);
  assert.equal(rec.data.announced, true);
  assert.equal(isSignificant(rec, r.state, preset), true, 'хроника берёт итог датой объявления');
  const chronicle = significantEvents(r.state, preset).filter((e) => e.kind === 'exam');
  assert.equal(chronicle.length, 1, 'одна запись хроники на исход — объявление, а не сдача');

  assert.deepEqual(announceResults(r.state, preset, '2024-12-25').announced, [], 'второй раз не объявляется');
});

test('9.4.3 объявление — событие календаря: время дошло до дня, ответ приносит факт', () => {
  const sat = applyOutcome(inSession(), { examId: PHYSICS, value: '3', day: '2024-12-23' }, preset).state;
  sat.pending = [];
  const next = applyResponse(sat, '<!-- [ACADEMY t=+1 day] -->', preset);
  assert.equal(next.state.calendar.day, '2024-12-24');
  assert.ok(next.debug.applied.some((a) => a.kind === 'announced' && a.examIds.includes(PHYSICS)));
  const fact = next.injects.find((i) => i.kind === 'announce');
  assert.ok(fact, JSON.stringify(next.injects));
  assert.match(fact.text, /удовлетворительно/);
});

test('9.4.3 строка состояния — знание мира: необъявленная двойка не в балле и не в хвостах', () => {
  let s = inSession();
  // Три попытки истрачены до этой — провал сейчас станет хвостом.
  s.exams.items.find((i) => i.id === PHYSICS).attempts = 2;
  s = applyOutcome(s, { examId: PHYSICS, value: '2', day: '2024-12-23' }, preset).state;
  assert.ok(debts(s).some((x) => x.id === 'physics'), 'расширение хвост знает');

  const world = publicView(s, preset);
  assert.equal(debts(world).some((x) => x.id === 'physics'), false, 'мир — нет');
  assert.equal(overallScore(world, preset), overallScore(semester('2024-12-23'), preset), 'двойки в балле мира нет');
  assert.equal(s.subjects.find((x) => x.id === 'physics').grades.length, 1, 'publicView состояние не правит');

  // «Хвосты: физика» в строке объявил бы провал раньше ведомости; «завтра
  // объявят итог: физика» — можно, это знание мира.
  const debtsOf = (line) => new RegExp(`${preset.vocab.debtPlural}: [^.]*физика`, 'i').test(line);
  const line = statusLine(s, preset);
  assert.equal(debtsOf(line), false, line);

  const told = announceResults(s, preset, '2024-12-24').state;
  told.calendar.day = '2024-12-24';
  assert.ok(debtsOf(statusLine(told, preset)), 'после объявления хвост в строке');
  assert.equal(publicView(told, preset), told, 'нечего прятать — тот же объект');
});

test('9.4.3 пересдача — после объявления: ждущее итога сегодня не сдаётся, вердикт не повторяется', () => {
  const sat = applyOutcome(inSession(), { examId: PHYSICS, value: '2', day: '2024-12-23' }, preset).state;
  const tue = { ...sat, pending: [], calendar: { ...sat.calendar, day: '2024-12-24' } };
  // Не объявлено (календарь поставлен руками, объявление не случилось) —
  // пересдавать нечего, очередь идёт дальше.
  assert.equal(sittableExams(tue, preset).some((i) => i.id === PHYSICS), false);
  const next = sitExam(tue, preset, { rng: () => 0.5 });
  assert.notEqual(next.exam.examId, PHYSICS);

  const told = announceResults(tue, preset).state;
  assert.ok(sittableExams(told, preset).some((i) => i.id === PHYSICS), 'после объявления — пересдача');
});

test('9.4.3 версия модели объявления не трогает: оценка меняется, дата — нет', () => {
  const sat = applyOutcome(inSession(), { examId: PHYSICS, value: '2', day: '2024-12-23' }, preset).state;
  const { state, divergence } = resolveConflict(sat, { examId: PHYSICS, modelSaid: '4' }, preset);
  assert.ok(divergence.applied);
  const item = state.exams.items.find((i) => i.id === PHYSICS);
  assert.equal(item.outcome, '4');
  assert.equal(item.announced, false);
  assert.equal(item.announceOn, '2024-12-24');
  const r = announceResults(state, preset, '2024-12-24');
  assert.match(r.state.pending.at(-1).text, /хорошо/, 'объявляется то, что в итоге записано');
});

test('9.4.3 вехи по необъявленному предмету ждут объявления в хронике', () => {
  const s = inSession();
  // Первая пятёрка — крит на физике: веха `firstTop` по физике.
  const sat = applyOutcome(s, { examId: PHYSICS, value: '5', day: '2024-12-23' }, preset).state;
  const secret = significantEvents(sat, preset).filter((e) => e.kind === 'milestone');
  assert.equal(secret.some((e) => e.record.data.subjectId === 'physics'), false);
  const told = announceResults(sat, preset, '2024-12-24').state;
  const open = significantEvents(told, preset).filter((e) => e.kind === 'milestone');
  assert.ok(open.some((e) => e.record.data.subjectId === 'physics'), JSON.stringify(open.map((e) => e.uid)));
});

test('9.4.3 validateState: итог ждёт объявления без даты — претензия', () => {
  const s = inSession();
  s.exams.items[0].outcome = '4';
  s.exams.items[0].announced = false;
  const res = validateState(s, preset);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('ждёт объявления')), res.errors.join('; '));
  s.exams.items[0].announceOn = '2024-12-24';
  assert.equal(validateState(s, preset).ok, true);
});

// --- 9.4.9: оговорка «сцена не для пары» ------------------------------------

test('9.4.9 вердикт кончается оговоркой; в журнал она не идёт; пресет перекрывает и выключает', () => {
  const { state, pending } = applyOutcome(inSession(), { examId: CHEMISTRY, value: 'зачёт', day: '2024-12-23' }, preset);
  assert.ok(pending.text.endsWith(DEFAULT_SCENE_GUARD), pending.text);
  assert.match(DEFAULT_SCENE_GUARD, /интимн/);
  assert.equal(state.journal.at(-1).text.includes(DEFAULT_SCENE_GUARD), false, 'наставление модели — не событие');

  const own = { ...preset, prompts: { ...preset.prompts, sceneGuard: 'Интим — потом.' } };
  assert.equal(sceneGuard(own), 'Интим — потом.');
  assert.ok(applyOutcome(inSession(), { examId: CHEMISTRY, value: 'зачёт', day: '2024-12-23' }, own)
    .pending.text.endsWith(' Интим — потом.'));

  const off = { ...preset, prompts: { ...preset.prompts, sceneGuard: '' } };
  assert.equal(withSceneGuard('X', off), 'X', 'пустая строка выключает оговорку');
});

test('9.4.9 объявление итога тоже с оговоркой; оговорка не отдельный инжект', () => {
  const sat = applyOutcome(inSession(), { examId: PHYSICS, value: '4', day: '2024-12-23' }, preset).state;
  assert.equal(sat.pending.length, 1, 'один вердикт — один инжект');
  sat.pending = [];
  const r = announceResults(sat, preset, '2024-12-24');
  assert.equal(r.state.pending.length, 1);
  assert.ok(r.state.pending[0].text.endsWith(DEFAULT_SCENE_GUARD));
});

// --- 9.4.4: ближние события --------------------------------------------------

/** Итоги, которые мир ещё не знает: `{предмет: день объявления}`. */
function withAnnounces(day, map) {
  const s = semester(day);
  s.exams.items = Object.entries(map).map(([subjectId, announceOn]) => ({
    id: `0:${subjectId}:credit`, subjectId, announced: false, announceOn,
  }));
  return s;
}

test('9.4.4 ближние события: горизонт 3 дня, не больше двух, ближайшие первыми', () => {
  // Вторник 01.10.2024.
  const s = withAnnounces('2024-10-01', {
    chemistry: '2024-10-04', physics: '2024-10-02', history: '2024-10-05', math: '2024-10-01',
  });
  const all = upcomingEvents(s, preset, { limit: 10 });
  assert.deepEqual(all.map((e) => [e.subjectId, e.days]), [['math', 0], ['physics', 1], ['chemistry', 3]],
    'история — через 4 дня, за горизонтом');
  assert.deepEqual(upcomingEvents(s, preset).map((e) => e.subjectId), ['math', 'physics'], 'умолчание — два');
  assert.equal(DEFAULT_HORIZON, 3);
  assert.equal(DEFAULT_LIMIT, 2);
});

test('9.4.4 ближние события: горизонт и число — из пресета, 0 выключает', () => {
  const s = withAnnounces('2024-10-01', { chemistry: '2024-10-02' });
  const off = { ...preset, limits: { ...preset.limits, nearEvents: 0 } };
  assert.equal(nearLimit(off), 0);
  assert.deepEqual(upcomingEvents(s, off), []);
  const blind = { ...preset, limits: { ...preset.limits, nearHorizon: 0 } };
  assert.equal(nearHorizon(blind), 0);
  assert.deepEqual(upcomingEvents(s, blind), [], 'горизонт 0 — только сегодня, а сегодня ничего');
  assert.equal(nearHorizon({ limits: { nearHorizon: 30 } }), 7, 'неделя — потолок «ближнего»');
});

test('дней рождения больше нет: старое поле наставника отпадает и в строку не идёт', () => {
  assert.equal('birthday' in normalizeTeacher({ id: 'p', name: 'П', birthday: '03-08' }, preset), false);
  // Среда 02.10.2024; в старом чате у Иванова записан день рождения на завтра.
  const s = semester('2024-10-02');
  s.teachers = s.teachers.map((t) => (t.id === 'ivanov' ? { ...t, birthday: '10-03' } : t));
  assert.deepEqual(upcomingEvents(s, preset), []);
  assert.equal(validateState(s, preset).ok, true, 'старое поле не ломает проверку');
  assert.ok(!statusLine(s, preset).includes('рожд'), statusLine(s, preset));
});

test('9.4.4 контрольное впереди: вход в сессию — словом сессии; в идущую сессию — не повторяется', () => {
  // Пятница 20.12, сессия с понедельника 23.12 — через 3 дня.
  const before = upcomingEvents(semester('2024-12-20'), preset);
  assert.equal(before[0].kind, 'exam');
  assert.equal(before[0].days, 3);
  assert.equal(before[0].what, preset.vocab.examPeriod);
  assert.equal(before[0].subjectId, null, 'сессия — пачка, предмет не называется');

  assert.deepEqual(upcomingEvents(inSession(), preset).filter((e) => e.kind === 'exam'), [],
    'в сессию строка и так говорит «не сдано N»');
});

test('9.4.4 объявление итога — ближнее событие мира, без значения', () => {
  const sat = applyOutcome(inSession(), { examId: PHYSICS, value: '2', day: '2024-12-23' }, preset).state;
  const near = upcomingEvents(sat, preset);
  assert.deepEqual(near.map((e) => [e.kind, e.subjectId, e.days]), [['announce', 'physics', 1]]);
  assert.equal('value' in near[0], false);
});

test('9.4.4 строка состояния: «завтра объявят итог: …» — словами, без новых чисел', () => {
  // Среда 02.10.2024: завтра объявят итог по физике, в пятницу — по химии.
  const s = withAnnounces('2024-10-02', { physics: '2024-10-03', chemistry: '2024-10-04' });
  const line = statusLine(s, preset);
  // Сегмент начинается с заглавной — строка собирается из предложений.
  assert.ok(line.includes('Завтра объявят итог: физика'), line);
  assert.ok(line.includes('в пятницу объявят итог: аналитическая химия'), line);
  const bare = statusLine(semester('2024-10-02'), preset);
  assert.equal(countNumbers(line), countNumbers(bare), 'ближние события чисел не добавляют');
});

test('9.4.4 строка: объявление итога — «завтра объявят итог: физика»', () => {
  const sat = applyOutcome(inSession(), { examId: PHYSICS, value: '4', day: '2024-12-23' }, preset).state;
  const line = statusLine(sat, preset);
  assert.ok(line.includes('Завтра объявят итог: физика'), line);
});

// --- 9.4.4: прыжок — одна сводка вместо пачки -------------------------------

test('9.4.4 прыжок через дни: одна строка журнала и сводка «+N пар», сдвиги отношения сведены', () => {
  const s = semester('2024-10-07'); // понедельник
  const withSkip = { ...preset, attendance: { ...preset.attendance, skipPolicy: 'absent' } };
  const run = applyResponse(s, '<!-- [ACADEMY t=+1 week] -->', withSkip);
  assert.equal(run.state.calendar.day, '2024-10-14');
  assert.ok(run.jump, 'сводка есть');
  assert.equal(run.jump.fromDay, '2024-10-07');
  assert.equal(run.jump.toDay, '2024-10-14');
  assert.equal(run.jump.days, 7);
  assert.equal(run.jump.missed, run.missed.length);
  assert.equal(run.jump.periods, run.jump.missed + run.jump.present);
  assert.ok(run.jump.missed > 4, `прогулов: ${run.jump.missed}`);

  const fresh = run.state.journal.slice(s.journal.length);
  const marks = fresh.filter((e) => e.kind === 'attendance' && /^attendance \w+=/.test(e.text));
  assert.equal(marks.length, 0, 'по строке на пару — это та самая пачка');
  assert.equal(fresh.filter((e) => e.kind === 'attendance' && e.data && e.data.jump).length, 1);
  // Сдвиги отношения — по одному на наставника, с поводом и счётом.
  const rels = fresh.filter((e) => e.kind === 'rel');
  const ids = rels.map((e) => e.data.teacherId);
  assert.equal(new Set(ids).size, ids.length, 'по одной записи на наставника');
  for (const e of rels) {
    assert.equal(e.data.reason.kind, 'skip');
    assert.ok(e.data.reason.count >= 1);
  }
  // Ведомость при этом полная: сводка — про журнал, не про отметки.
  assert.equal(run.state.attendance.records.filter((r) => r.status === 'skip').length, run.jump.missed);
});

test('9.4.4 сводка прыжка: итог отношения тот же, что при пачке', () => {
  const s = semester('2024-10-07');
  const withSkip = { ...preset, attendance: { ...preset.attendance, skipPolicy: 'absent' } };
  const run = applyResponse(s, '<!-- [ACADEMY t=+1 week] -->', withSkip);
  // Пачка: каждый прогул −1 по-отдельности, с зажимом краями шкалы.
  for (const t of run.state.teachers) {
    const skips = run.state.attendance.records.filter((r) => r.status === 'skip'
      && SUBJECTS.find((x) => x.id === r.subjectId).teacherId === t.id).length;
    const expected = Math.max(preset.relations.min, preset.relations.start - skips);
    assert.equal(t.relation, expected, t.id);
  }
});

test('9.4.4 ход по парам — не прыжок: сводки нет, журнал прежний', () => {
  const s = semester('2024-10-07');
  s.calendar.periodIndex = 0;
  const run = applyResponse(s, '<!-- [ACADEMY t=+1] -->', preset);
  assert.equal(run.jump, null);
  const fresh = run.state.journal.slice(s.journal.length);
  assert.ok(fresh.some((e) => e.kind === 'attendance' && /^attendance \w+=present/.test(e.text)), JSON.stringify(fresh));
});

test('9.4.3 вехи мира: milestones(publicView) не видит блестящую сдачу до объявления', async () => {
  const { milestones } = await import('../core/milestones.mjs');
  const s = inSession();
  const sat = sitExam(s, preset, { examId: PHYSICS, rng: () => 0.99 });
  assert.equal(sat.exam.check.tier, 'critSuccess');
  const ids = (st) => milestones(st, preset).map((m) => m.id);
  assert.ok(ids(sat.state).includes('brilliant'), 'расширение знает');
  assert.equal(ids(publicView(sat.state, preset)).includes('brilliant'), false, 'мир — ещё нет');
  const told = announceResults(sat.state, preset, '2024-12-24').state;
  assert.ok(ids(publicView(told, preset)).includes('brilliant'), 'после объявления — да');
});

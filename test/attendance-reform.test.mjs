import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createState, cloneState } from '../core/state.mjs';
import { buildSchedule, dayPlan } from '../core/schedule.mjs';
import { mark, workOff, stats, effectiveSkips } from '../core/attendance.mjs';
import { changeReputation, reputationLabel } from '../core/reputation.mjs';
import { setDebt } from '../core/gradebook.mjs';
import { applyResponse, sitExam, manualTime, resolveHeldJump } from '../core/engine.mjs';
import { scheduleExams } from '../core/exams.mjs';
import { hookJournal } from '../ui/hooks.js';
import { rowText } from '../mes-panel.js';

// Посещаемость и репутация после переделки (баги 15, 16, 27):
//  - скачок времени засчитывает пары посещёнными, прогул — только из метки;
//  - опоздание по ходу игры записывается (и метка `late=`, и приход на пару позже начала);
//  - у всех пресетов одна шкала репутации: предупреждение после 8–10 прогулов;
//  - прогул и хвост за него не списываются дважды;
//  - сданное по предмету закрывает самый старый открытый прогул и возвращает репутацию.

const PRESET_DIR = new URL('../presets/', import.meta.url);
const loadPreset = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`${id}.json`, PRESET_DIR)), 'utf8'));
const ids = readdirSync(fileURLToPath(PRESET_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
const preset = loadPreset('ru-university');

const SUBJECTS = [
  { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'ivanov' },
  { id: 'history', name: 'история', teacherId: 'sidorova' },
  { id: 'math', name: 'высшая математика', teacherId: 'kuznecov' },
];
const TEACHERS = [
  { id: 'petrova', name: 'Петрова Анна Сергеевна' },
  { id: 'ivanov', name: 'Иванов Пётр Ильич' },
  { id: 'sidorova', name: 'Сидорова Мария Львовна' },
  { id: 'kuznecov', name: 'Кузнецов Илья Львович' },
];

function semester(day = '2024-09-03', p = preset) {
  const s = createState(p, {
    startDay: '2024-09-02', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, p),
  });
  s.started = true;
  s.calendar.day = day;
  return s;
}
const marker = (body) => `<!-- [ACADEMY ${body}] -->`;
const skipsOf = (s) => s.attendance.records.filter((r) => r.status === 'skip');

// --- 15, 27: скачок засчитывает посещёнными ---------------------------------

test('скачок любой длины засчитывает пары посещёнными: ни прогулов, ни репутации, ни отношений', () => {
  for (const jump of ['t=+1 day', 't=+2 day', 't=+4 day', 't=+1 week']) {
    const s = semester('2024-10-07');
    const r = applyResponse(s, `Время пролетело.\n${marker(jump)}`, preset);
    assert.equal(skipsOf(r.state).length, 0, `${jump}: прогулов нет`);
    assert.deepEqual(r.missed, [], `${jump}: ничего не выведено прогулом`);
    assert.ok(r.state.attendance.records.length > 0, `${jump}: пары записаны`);
    assert.ok(r.state.attendance.records.every((x) => x.status === 'present'), `${jump}: все посещены`);
    assert.equal(r.state.reputation.value, preset.reputation.start, `${jump}: репутация цела`);
    assert.deepEqual(r.state.subjects.filter((x) => x.debt), [], `${jump}: хвостов нет`);
  }
});

test('промотка и принятый прыжок: тот же итог при любом потолке, прогулов нет', () => {
  const s = semester('2024-10-07');
  const skip = applyResponse(s, 'Понедельник, 14 октября 2024 года. Неделя пролетела.', preset, { timeSkip: { days: 7 } });
  assert.equal(skipsOf(skip.state).length, 0);
  const held = applyResponse(s, '📅 24 декабря 2024, 09:00\nНе было долго.', preset);
  assert.ok(held.heldJump, 'три месяца вперёд — сперва вопрос человеку');
  const accepted = resolveHeldJump(held.state, preset, true);
  assert.ok(accepted.counted > 100, 'скачок на три месяца записан посещёнными целиком');
  assert.equal(skipsOf(accepted.state).length, 0);
  assert.equal(accepted.state.reputation.value, preset.reputation.start);
});

test('явный прогул в ролке остаётся прогулом даже внутри скачка', () => {
  const s = semester('2024-10-07');
  const r = applyResponse(s, `Прошёл день.\n${marker('t=+1 day skip=chemistry')}`, preset);
  assert.equal(skipsOf(r.state).length, 1);
  assert.equal(skipsOf(r.state)[0].subjectId, 'chemistry');
  assert.equal(r.state.reputation.value, preset.reputation.start + preset.reputation.delta.skip);
});

// --- 16: опоздание ----------------------------------------------------------

test('метка late= записывается и видна в журнале панели', () => {
  const s = semester('2024-09-03');
  const r = applyResponse(s, `Она влетела на пару, когда все уже сидели.\n${marker('late=physics')}`, preset);
  const late = r.state.attendance.records.filter((x) => x.status === 'late');
  assert.equal(late.length, 1);
  assert.equal(late[0].subjectId, 'physics');
  assert.equal(stats(r.state, 'physics').lates, 1);
  assert.equal(r.state.reputation.value, preset.reputation.start + preset.reputation.delta.late);
  const rows = hookJournal(r.state, preset, 10).filter((x) => x.kind === 'attendance');
  assert.ok(rows.some((x) => x.status === 'late' && x.subject === 'физика'));
  assert.ok(rows.map(rowText).some((t) => t === 'опоздание: физика'));
});

function morning(time = '08:22') {
  const s = semester('2024-09-03');
  s.calendar.time = time;
  s.calendar.precision = 'datetime';
  return s;
}

test('пришла на пару позже её начала, и сцена это показала: опоздание по предмету', () => {
  const s = morning('08:22');
  const first = dayPlan(s, preset)[0]; // пара в 08:30
  const body = `📅 3 сентября 2024, 08:52\nОна вошла, когда лекция шла уже двадцать минут.\n${marker(`grade=${first.subjectId}:5`)}`;
  const r = applyResponse(s, body, preset);
  const rec = r.state.attendance.records.find((x) => x.subjectId === first.subjectId && x.periodIndex === 0);
  assert.ok(rec, 'запись по паре есть');
  assert.equal(rec.status, 'late');
  assert.ok(r.debug.applied.some((a) => a.kind === 'attendance' && a.status === 'late' && a.derived));
});

test('время продвинулось, но по сцене неясно, была ли героиня на паре: ничего не пишем', () => {
  const s = morning('08:22');
  const r = applyResponse(s, '📅 3 сентября 2024, 08:52\nОна ещё ходила по общежитию.', preset);
  assert.equal(r.state.attendance.records.length, 0);
  assert.equal(r.state.reputation.value, preset.reputation.start);
});

test('пришла в начале пары или заранее: это не опоздание', () => {
  const s = morning('08:22');
  const first = dayPlan(s, preset)[0];
  const r = applyResponse(s, `📅 3 сентября 2024, 08:34\nВошла вместе со всеми.\n${marker(`grade=${first.subjectId}:5`)}`, preset);
  assert.equal(r.state.attendance.records.filter((x) => x.status === 'late').length, 0);
});

test('явное late= сильнее выведенного и не дублируется', () => {
  const s = morning('08:22');
  const first = dayPlan(s, preset)[0];
  const r = applyResponse(s, `📅 3 сентября 2024, 08:52\nОпоздала.\n${marker(`late=${first.subjectId} grade=${first.subjectId}:5`)}`, preset);
  const mine = r.state.attendance.records.filter((x) => x.subjectId === first.subjectId && x.periodIndex === 0);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, 'late');
  assert.equal(r.state.reputation.value, preset.reputation.start + preset.reputation.delta.late, 'платит один раз');
});

// --- 3: шкала репутации -----------------------------------------------------

/** Сколько прогулов (по разным предметам, по одному в день) до предупреждения и до отчисления. */
function skipsUntil(p, spread) {
  const subs = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id, teacherId: 't' }));
  let s = createState(p, { startDay: '2024-09-02', teachers: [{ id: 't', name: 'T' }], subjects: subs });
  let warn = null;
  let expel = null;
  for (let i = 1; i < 200 && expel === null; i += 1) {
    const day = new Date(Date.UTC(2024, 8, 2 + i)).toISOString().slice(0, 10);
    const r = mark(s, { subjectId: spread ? subs[i % subs.length].id : 'a', status: 'skip', day, periodIndex: 0 }, p);
    s = r.state;
    for (const d of r.effects.debt) s = setDebt(s, d, true, p);
    const c = changeReputation(s, { delta: r.effects.reputation }, p);
    s = c.state;
    if (c.crossedWarn && warn === null) warn = i;
    if (c.expelled && expel === null) expel = i;
  }
  return { warn, expel };
}

test('шкала репутации одна у всех пресетов: предупреждение после 8-10 прогулов, отчисление заметно позже', () => {
  assert.equal(ids.length, 12);
  for (const id of ids) {
    const p = loadPreset(id);
    assert.equal(p.reputation.start, 50, id);
    assert.equal(p.reputation.max, 100, id);
    assert.equal(p.reputation.warnAt, 20, id);
    assert.equal(p.reputation.delta.debt, undefined, `${id}: отдельной платы за хвост нет`);
    for (const spread of [true, false]) {
      const { warn, expel } = skipsUntil(p, spread);
      assert.ok(warn >= 8 && warn <= 10, `${id}: предупреждение после ${warn} прогулов`);
      assert.ok(expel >= warn + 5, `${id}: отчисление после ${expel} прогулов, заметно позже ${warn}`);
    }
    // Ярлыки идут по возрастанию и закрывают шкалу.
    const upTo = p.reputation.labels.map((l) => l.upTo);
    assert.deepEqual([...upTo].sort((x, y) => x - y), upTo, `${id}: ярлыки по порядку`);
    assert.equal(upTo[upTo.length - 1], 100, id);
  }
});

// --- 4: нет двойной платы ----------------------------------------------------

test('хвост за прогулы репутацию не трогает: платит один прогул, а не прогул плюс хвост', () => {
  const need = preset.attendance.debtAfterSkips;
  let s = semester();
  let total = 0;
  let debtAt = null;
  for (let i = 0; i < need + 1; i += 1) {
    const r = mark(s, { subjectId: 'history', status: 'skip', day: `2024-09-${String(3 + i).padStart(2, '0')}`, periodIndex: 0 }, preset);
    s = r.state;
    total += r.effects.reputation;
    if (r.effects.debt.length) { debtAt = i + 1; s = setDebt(s, 'history', true, preset); }
  }
  assert.equal(debtAt, need, 'хвост встал на пороговом прогуле');
  assert.equal(total, (need + 1) * preset.reputation.delta.skip, 'каждый прогул оплачен ровно один раз');
});

// --- 5: отработка ------------------------------------------------------------

function withSkips() {
  let s = semester();
  const spec = [['chemistry', '2024-09-03'], ['physics', '2024-09-03'], ['chemistry', '2024-09-04'], ['history', '2024-09-04']];
  for (const [subjectId, day] of spec) {
    const r = mark(s, { subjectId, status: 'skip', day, periodIndex: subjectId === 'physics' ? 1 : 0 }, preset);
    s = changeReputation(r.state, { delta: r.effects.reputation }, preset).state;
  }
  return s;
}

test('проходная оценка по предмету закрывает самый старый открытый прогул и возвращает репутацию', () => {
  const s = withSkips();
  const start = s.reputation.value;
  assert.equal(start, preset.reputation.start + 4 * preset.reputation.delta.skip);

  const r = applyResponse(s, `Сдала работу по химии.\n${marker('grade=chemistry:5')}`, preset);
  const chem = r.state.attendance.records.filter((x) => x.subjectId === 'chemistry' && x.status === 'skip');
  assert.equal(chem.length, 2, 'прогулы в истории остались');
  const closed = chem.filter((x) => x.workedOff);
  assert.equal(closed.length, 1, 'закрыт один');
  assert.equal(closed[0].day, '2024-09-03', 'самый старый');
  assert.equal(r.state.reputation.value, start - preset.reputation.delta.skip, 'репутация за него вернулась');
  assert.equal(stats(r.state, 'chemistry').skips, 2);
  assert.equal(stats(r.state, 'chemistry').worked, 1);
  assert.equal(effectiveSkips(r.state, 'chemistry', preset), 1, 'открытым остался один');

  // Второй проходной ответ закрывает второй; третий уже нечего.
  const again = applyResponse(r.state, `И ещё одна работа.\n${marker('grade=chemistry:4')}`, preset);
  assert.equal(again.state.attendance.records.filter((x) => x.subjectId === 'chemistry' && x.workedOff).length, 2);
  const third = applyResponse(again.state, `Ещё.\n${marker('grade=chemistry:5')}`, preset);
  assert.equal(third.state.reputation.value, again.state.reputation.value, 'открытых прогулов нет — репутация не растёт');
  // Чужие предметы не тронуты.
  assert.equal(third.state.attendance.records.filter((x) => x.subjectId === 'physics' && x.workedOff).length, 0);
});

test('непроходная оценка не отрабатывает', () => {
  const s = withSkips();
  const r = applyResponse(s, `Провалила.\n${marker('grade=chemistry:2')}`, preset);
  assert.equal(r.state.attendance.records.filter((x) => x.workedOff).length, 0);
  assert.equal(r.state.reputation.value, s.reputation.value);
});

test('сданное контрольное закрывает прогул по предмету', () => {
  let s = scheduleExams(semester('2024-12-23'), preset, { day: '2024-12-23' });
  const r = mark(s, { subjectId: 'chemistry', status: 'skip', day: '2024-09-05', periodIndex: 0 }, preset);
  s = changeReputation(r.state, { delta: r.effects.reputation }, preset).state;
  const start = s.reputation.value;
  const examId = s.exams.items.find((i) => i.subjectId === 'chemistry').id;
  const sat = sitExam(s, preset, { examId, rng: () => 0.99 });
  assert.equal(sat.exam.subjectId, 'chemistry');
  const rec = sat.state.attendance.records.find((x) => x.subjectId === 'chemistry');
  assert.ok(rec.workedOff, `прогул закрыт сданным контрольным (${sat.exam.value})`);
  assert.equal(sat.state.reputation.value,
    start + preset.reputation.delta.examPassed - preset.reputation.delta.skip,
    'вернулось и за прогул, и за экзамен');
  // Проваленное контрольное не отрабатывает.
  const failed = sitExam(s, preset, { examId, rng: () => 0, modelSaid: 'незачёт' });
  assert.ok(!failed.state.attendance.records.find((x) => x.subjectId === 'chemistry').workedOff);
});

test('отработка без предмета (общий экзамен, сессия) закрывает самый старый прогул любого предмета', () => {
  const s = withSkips();
  const r = workOff(s, { subjectId: null, day: '2024-12-24' }, preset);
  assert.equal(r.closed.subjectId, 'chemistry');
  assert.equal(r.closed.day, '2024-09-03');
  assert.equal(r.effects.reputation, -preset.reputation.delta.skip);
  assert.equal(r.state.attendance.records.filter((x) => x.workedOff).length, 1);
  assert.equal(s.attendance.records.filter((x) => x.workedOff).length, 0, 'входное состояние не тронуто');
});

test('возвращённая репутация: ярлык следует за значением, а флаг warned остаётся вечным', () => {
  let s = semester();
  for (let i = 0; i < 12; i += 1) {
    const subjectId = SUBJECTS[i % 4].id;
    const day = new Date(Date.UTC(2024, 8, 3 + i)).toISOString().slice(0, 10);
    const r = mark(s, { subjectId, status: 'skip', day, periodIndex: 0 }, preset);
    s = changeReputation(r.state, { delta: r.effects.reputation }, preset).state;
  }
  assert.equal(s.reputation.warned, true);
  const low = reputationLabel(s, preset);
  assert.equal(s.reputation.value, 14);

  for (let i = 0; i < 4; i += 1) {
    const subjectId = SUBJECTS[i % 4].id;
    const done = applyResponse(s, `Отработала.\n${marker(`grade=${subjectId}:5`)}`, preset);
    s = done.state;
  }
  assert.ok(s.reputation.value > 14 + 3 * 3);
  assert.notEqual(reputationLabel(s, preset), low, 'ярлык поднялся вместе со значением');
  assert.equal(s.reputation.warned, true, 'предупреждение — история, оно не стирается');
});

test('в журнале панели видно, что прогул отработан', () => {
  const s = withSkips();
  const r = applyResponse(s, `Сдала.\n${marker('grade=physics:5')}`, preset);
  const rows = hookJournal(r.state, preset, 20);
  const worked = rows.filter((x) => x.kind === 'attendance' && x.status === 'worked');
  assert.equal(worked.length, 1);
  assert.equal(rowText(worked[0]), 'прогул отработан: физика');
});

test('откат и свайп: отработка живёт в состоянии, как остальное', () => {
  const s = withSkips();
  const before = JSON.stringify(s);
  const r = applyResponse(s, `Сдала.\n${marker('grade=chemistry:5')}`, preset);
  assert.equal(JSON.stringify(s), before, 'входное состояние не изменилось');
  assert.ok(r.state.attendance.records.some((x) => x.workedOff));
  // Свайп = повторный разбор из снимка «до сообщения»: результат тот же, без удвоения.
  const again = applyResponse(cloneState(s), `Сдала иначе.\n${marker('grade=chemistry:4')}`, preset);
  assert.equal(again.state.attendance.records.filter((x) => x.workedOff).length, 1);
  assert.equal(again.state.reputation.value, r.state.reputation.value);
});

test('ручной ремонт с count пишет посещёнными, прогулов не заводит', () => {
  const s = semester('2024-10-07');
  const r = manualTime(s, { shift: { unit: 'day', n: 3 }, count: true }, preset);
  assert.ok(r.counted > 0);
  assert.equal(skipsOf(r.state).length, 0);
});

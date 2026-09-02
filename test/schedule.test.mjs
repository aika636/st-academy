import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, validateState } from '../core/state.mjs';
import { buildSchedule, dayPlan, currentPeriod, nextPeriod, weekGrid, periodAt } from '../core/schedule.mjs';

const preset = {
  id: 'test',
  lang: 'ru',
  week: { studyDays: [1, 2, 3, 4, 5], periodsPerDay: 4 },
  bells: [
    { start: '08:30', end: '10:05' },
    { start: '10:15', end: '11:50' },
    { start: '12:20', end: '13:55' },
    { start: '14:05', end: '15:40' },
    { start: '15:50', end: '17:25' },
  ],
  calendar: {
    termStart: '09-01',
    studyWeeks: 16,
    examWeeks: 3,
    vacations: [{ name: 'ноябрьские', from: '11-04', to: '11-07' }],
  },
  relations: { start: 0 },
  reputation: { start: 50 },
  limits: { idleWarnAfter: 10, journalSize: 200 },
};

const TERM = '2024-09-02'; // понедельник

const teachers = [
  { id: 'petrova', name: 'Петрова Анна Сергеевна' },
  { id: 'grinev', name: 'Гринёв Пётр Андреевич' },
];
const subjects = [
  { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'grinev' },
  { id: 'math', name: 'высшая математика', teacherId: null },
  { id: 'history', name: 'история', teacherId: null },
  { id: 'cs', name: 'информатика', teacherId: null },
];

function mk(cal = {}, opts = {}) {
  const s = createState(preset, {
    startDay: TERM,
    subjects,
    teachers,
    schedule: opts.schedule || buildSchedule(subjects, preset),
  });
  s.calendar = { ...s.calendar, ...cal };
  return s;
}

// --- buildSchedule ----------------------------------------------------------

test('сетка строится только на учебные дни и по числу пар из пресета', () => {
  const grid = buildSchedule(subjects, preset);
  assert.deepEqual(Object.keys(grid).sort(), ['1', '2', '3', '4', '5']);
  for (const d of ['1', '2', '3', '4', '5']) assert.equal(grid[d].length, 4);
});

test('сетка детерминирована: два вызова совпадают до строчки', () => {
  assert.deepEqual(buildSchedule(subjects, preset), buildSchedule(subjects, preset));
});

test('раскладка ровная: числа пар у предметов различаются не больше чем на одну', () => {
  const grid = buildSchedule(subjects, preset);
  const count = new Map(subjects.map((s) => [s.id, 0]));
  for (const row of Object.values(grid)) for (const id of row) count.set(id, count.get(id) + 1);
  const values = [...count.values()];
  assert.equal(values.reduce((a, b) => a + b, 0), 20, '5 дней по 4 пары');
  assert.ok(Math.max(...values) - Math.min(...values) <= 1, `перекос: ${JSON.stringify([...count])}`);
});

test('пока предметов не меньше, чем пар в дне, один предмет дважды за день не ставится', () => {
  const grid = buildSchedule(subjects, preset);
  for (const [d, row] of Object.entries(grid)) {
    assert.equal(new Set(row).size, row.length, `день ${d}: ${row.join(', ')}`);
  }
});

test('предметов меньше, чем пар: повторы неизбежны, но раскладка всё равно ровная', () => {
  const two = [{ id: 'a' }, { id: 'b' }];
  const grid = buildSchedule(two, preset);
  assert.equal(grid['1'].length, 4);
  assert.deepEqual(grid['1'], ['a', 'b', 'a', 'b']);
});

test('пустой список предметов даёт пустые дни, а не падение', () => {
  const grid = buildSchedule([], preset);
  assert.deepEqual(grid, { 1: [], 2: [], 3: [], 4: [], 5: [] });
});

test('построенная сетка проходит валидацию состояния', () => {
  const s = mk();
  const { ok, errors } = validateState(s, preset);
  assert.equal(ok, true, errors.join('; '));
});

// --- dayPlan ----------------------------------------------------------------

test('план дня: индексы, имена, преподаватели и звонки', () => {
  const plan = dayPlan(mk(), preset);
  assert.equal(plan.length, 4);
  assert.deepEqual(plan.map((p) => p.index), [0, 1, 2, 3]);
  assert.equal(plan[0].subjectId, 'chemistry');
  assert.equal(plan[0].name, 'аналитическая химия');
  assert.equal(plan[0].teacherId, 'petrova');
  assert.equal(plan[0].start, '08:30');
  assert.equal(plan[0].end, '10:05');
  assert.equal(plan[3].start, '14:05');
});

test('в выходной и на каникулах план пуст', () => {
  const s = mk();
  assert.deepEqual(dayPlan(s, preset, '2024-09-07'), [], 'суббота');
  assert.deepEqual(dayPlan(s, preset, '2024-09-08'), [], 'воскресенье');
  assert.deepEqual(dayPlan(s, preset, '2024-11-05'), [], 'каникулы');
});

test('в сессию лекционной сетки нет: пары кончились', () => {
  const s = mk();
  assert.deepEqual(dayPlan(s, preset, '2024-12-24'), [], 'семнадцатая неделя — сессия');
  assert.equal(dayPlan(s, preset, '2024-12-17').length, 4, 'а шестнадцатая ещё учебная');
});

test('дырка в сетке — окно, а не пара', () => {
  const s = mk({}, { schedule: { 1: ['chemistry', null, 'physics', null] } });
  const plan = dayPlan(s, preset);
  assert.deepEqual(plan.map((p) => p.index), [0, 2]);
  assert.equal(periodAt(s, preset, TERM, 1), null);
  assert.equal(periodAt(s, preset, TERM, 2).subjectId, 'physics');
});

// --- currentPeriod по часам -------------------------------------------------

test('ровно звонок на пару — пара уже идёт', () => {
  const s = mk({ time: '08:30', precision: 'datetime' });
  assert.deepEqual(currentPeriod(s, preset), { index: 0, subjectId: 'chemistry', status: 'now' });
});

test('ровно звонок с пары — уже перемена, а не две пары сразу', () => {
  const s = mk({ time: '10:05', precision: 'datetime' });
  const cur = currentPeriod(s, preset);
  assert.equal(cur.status, 'break');
  assert.equal(cur.index, 1, 'перемена указывает на ту пару, что вот-вот начнётся');
});

test('перемена между парами', () => {
  const s = mk({ time: '12:00', precision: 'datetime' });
  const cur = currentPeriod(s, preset);
  assert.equal(cur.status, 'break');
  assert.equal(cur.index, 2);
});

test('до первой пары и после последней', () => {
  const before = currentPeriod(mk({ time: '07:15', precision: 'datetime' }), preset);
  assert.deepEqual(before, { index: 0, subjectId: 'chemistry', status: 'before' });

  const after = currentPeriod(mk({ time: '19:40', precision: 'datetime' }), preset);
  assert.equal(after.status, 'after');
  assert.equal(after.index, 3, 'последняя пара дня уже прошла');
});

test('в выходной текущей пары нет вовсе', () => {
  const s = mk({ day: '2024-09-07', time: '10:00', precision: 'datetime' });
  assert.equal(currentPeriod(s, preset), null);
});

// --- currentPeriod при точности «только день» -------------------------------

test('без часов текущая пара берётся из periodIndex', () => {
  const s = mk({ precision: 'date', time: null, periodIndex: 2 });
  const cur = currentPeriod(s, preset);
  assert.equal(cur.status, 'now');
  assert.equal(cur.index, 2);
  assert.equal(cur.subjectId, dayPlan(s, preset)[2].subjectId);
});

test('без часов и без счётчика — «до первой», а не выдуманная пара', () => {
  const s = mk({ precision: 'date', time: null, periodIndex: null });
  assert.equal(currentPeriod(s, preset).status, 'before');
});

test('счётчик за пределами дня — «после последней»', () => {
  const s = mk({ precision: 'date', time: null, periodIndex: 9 });
  const cur = currentPeriod(s, preset);
  assert.equal(cur.status, 'after');
  assert.equal(cur.index, 3);
});

test('счётчик попал в окно между парами — это перемена', () => {
  const s = mk({ precision: 'date', time: null, periodIndex: 1 },
    { schedule: { 1: ['chemistry', null, 'physics', null] } });
  const cur = currentPeriod(s, preset);
  assert.equal(cur.status, 'break');
  assert.equal(cur.index, 2);
});

// --- nextPeriod -------------------------------------------------------------

test('следующая пара в тот же день', () => {
  const s = mk({ time: '08:40', precision: 'datetime' });
  const next = nextPeriod(s, preset);
  assert.equal(next.day, TERM);
  assert.equal(next.index, 1);
  assert.equal(next.subjectId, dayPlan(s, preset)[1].subjectId);
});

test('на перемене следующая пара — та, что вот-вот начнётся', () => {
  const s = mk({ time: '12:00', precision: 'datetime' });
  assert.equal(nextPeriod(s, preset).index, 2);
});

test('после последней пары следующая — в другой день недели', () => {
  const s = mk({ time: '18:00', precision: 'datetime' });
  const next = nextPeriod(s, preset);
  assert.equal(next.day, '2024-09-03', 'вторник');
  assert.equal(next.index, 0);
  assert.equal(next.subjectId, dayPlan(s, preset, '2024-09-03')[0].subjectId);
});

test('вечер пятницы: следующая пара — в понедельник', () => {
  const s = mk({ day: '2024-09-06', time: '18:00', precision: 'datetime' });
  assert.equal(nextPeriod(s, preset).day, '2024-09-09');
});

test('в субботу следующая пара — в понедельник', () => {
  const s = mk({ day: '2024-09-07', time: '10:00', precision: 'datetime' });
  assert.equal(nextPeriod(s, preset).day, '2024-09-09');
});

test('перед каникулами следующая пара перескакивает через них', () => {
  const s = mk({ day: '2024-11-01', time: '18:00', precision: 'datetime' });
  assert.equal(nextPeriod(s, preset).day, '2024-11-08');
});

test('после конца семестра следующей пары нет', () => {
  const s = mk({ day: '2025-02-03', time: '09:00', precision: 'datetime' });
  assert.equal(nextPeriod(s, preset), null);
});

// --- weekGrid ---------------------------------------------------------------

test('недельная сетка: семь ключей, выходные пустые', () => {
  const grid = weekGrid(mk({ day: '2024-09-05' }), preset);
  assert.deepEqual(Object.keys(grid), ['1', '2', '3', '4', '5', '6', '7']);
  for (const d of ['1', '2', '3', '4', '5']) assert.equal(grid[d].length, 4, `день ${d}`);
  assert.deepEqual(grid['6'], []);
  assert.deepEqual(grid['7'], []);
});

test('недельная сетка строится от понедельника, а не от текущего дня', () => {
  // Воскресенье 8 сентября принадлежит неделе, начатой 2 сентября.
  const sunday = weekGrid(mk({ day: '2024-09-08' }), preset);
  const monday = weekGrid(mk({ day: '2024-09-02' }), preset);
  assert.deepEqual(sunday, monday);
});

test('неделя с каникулами: попавшие в них дни пусты', () => {
  const grid = weekGrid(mk({ day: '2024-11-06' }), preset); // среда каникул
  assert.deepEqual(grid['1'], [], '4 ноября');
  assert.deepEqual(grid['4'], [], '7 ноября');
  assert.equal(grid['5'].length, 4, '8 ноября — уже учебный');
});

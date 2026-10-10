import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createState, validateState } from '../core/state.mjs';
import { buildSchedule, dayEndInfo, dayPlan } from '../core/schedule.mjs';
import { mark } from '../core/attendance.mjs';
import { skipToDayEnd } from '../core/engine.mjs';

// Кнопка «До конца занятий»: чистая логика ядра, без панели.

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));
const PER_DAY = preset.week.periodsPerDay;
const LAST_END = preset.bells[PER_DAY - 1].end;
const DAY = '2024-09-03'; // вторник первой учебной недели

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

function semester(time = '08:30') {
  const state = createState(preset, {
    startDay: '2024-09-02',
    subjects: SUBJECTS,
    teachers: TEACHERS,
    schedule: buildSchedule(SUBJECTS, preset),
  });
  state.started = true;
  state.calendar.day = DAY;
  state.calendar.precision = 'datetime';
  state.calendar.time = time;
  return state;
}

test('dayEndInfo: кнопка есть в учебный день, пока занятия впереди или идёт занятие', () => {
  const s = semester();
  const info = dayEndInfo(s, preset);
  assert.equal(info.available, true);
  assert.equal(info.remaining, PER_DAY);
  assert.equal(info.endTime, LAST_END);

  s.calendar.time = '10:20'; // идёт вторая пара
  assert.equal(dayEndInfo(s, preset).remaining, PER_DAY - 1);

  s.calendar.time = LAST_END; // всё кончилось
  assert.equal(dayEndInfo(s, preset).available, false);

  const weekend = semester();
  weekend.calendar.day = '2024-09-07'; // суббота
  assert.equal(dayEndInfo(weekend, preset).available, false);

  const noClock = semester();
  noClock.calendar.precision = 'date';
  assert.equal(dayEndInfo(noClock, preset).available, false);
});

test('skipToDayEnd: оставшиеся занятия посещены, прогул остаётся, часы на конце последнего', () => {
  const s = semester('10:20'); // идёт вторая пара, первая позади
  const plan = dayPlan(s, preset);
  // Вторая пара уже отмечена прогулом (метка `skip=`) — стирать её нельзя.
  const marked = mark(s, { subjectId: plan[1].subjectId, status: 'skip', day: DAY, periodIndex: 1 }, preset).state;
  const before = JSON.stringify(marked);

  const r = skipToDayEnd(marked, preset);
  assert.equal(r.applied, true);
  assert.equal(JSON.stringify(marked), before, 'вход не мутирован');
  assert.equal(r.state.calendar.time, LAST_END);
  assert.equal(r.state.calendar.day, DAY);
  assert.deepEqual(validateState(r.state, preset).errors, []);

  const today = r.state.attendance.records.filter((x) => x.day === DAY);
  const at = (i) => today.filter((x) => x.periodIndex === i).map((x) => x.status);
  assert.deepEqual(at(0), [], 'прошедшая пара не трогается');
  assert.deepEqual(at(1), ['skip'], 'отмеченный прогул не стёрт');
  assert.deepEqual(at(2), ['present']);
  assert.deepEqual(at(3), ['present']);
  assert.equal(r.counted, 2);

  // Повторно: занятий впереди нет, кнопка не работает.
  const again = skipToDayEnd(r.state, preset);
  assert.equal(again.applied, false);
  assert.equal(again.counted, 0);
});

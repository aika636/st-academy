import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createState } from '../core/state.mjs';
import { buildSchedule, dayPlan } from '../core/schedule.mjs';
import { applyResponse } from '../core/engine.mjs';
import { dayOfWeek, weekdayIn } from '../core/time.mjs';
import { parseContext } from '../core/parse-context.mjs';
import { todayView } from '../ui/today.js';
import { formatDate } from '../ui/common.js';

// Живой прогон 10.10, п. 75: бот пишет «[Date: 24/10/1248, Вторник]», а
// григорианский счёт даёт субботу. Расписание зависит от дня недели, поэтому
// календарь берёт сдвиг дня недели из истории — но после двух согласных ответов.

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/magic-academy.json', import.meta.url)), 'utf8'));
const SUBJECTS = [{ id: 'a', name: 'Алхимия', teacherId: 't' }, { id: 'b', name: 'Травы', teacherId: 't' }];
const TEACHERS = [{ id: 't', name: 'Магистр Т', traits: ['строг'] }];

function semester() {
  const s = createState(preset, {
    startDay: '2026-10-12', survey: {}, subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
  });
  s.started = true;
  s.calendar.day = '1248-10-12';
  s.calendar.termStart = '1248-10-12';
  return s;
}
const say = (s, text) => applyResponse(s, text, preset, { mode: 'auto' }).state;

test('парсер: день недели рядом с датой, русские и английские названия и сокращения', () => {
  const w = (line) => parseContext(line, {}).weekday;
  assert.equal(w('[Date: 24/10/1248, Вторник]'), 2);
  assert.equal(w('Date: 24/10/1248, Tuesday'), 2);
  assert.equal(w('Вт, 24 октября 1248'), 2);
  assert.equal(w('Tue, 24 October 1248'), 2);
  assert.equal(w('Ср, 25 октября 1248'), 3);
  assert.equal(w('Wed, 25 October 1248'), 3);
});

test('dayOfWeek со сдвигом', () => {
  assert.equal(dayOfWeek('1248-10-24'), 6);
  assert.equal(dayOfWeek('1248-10-24', 3), 2);
  assert.equal(dayOfWeek('1248-10-24', 10), 2);
});

test('два согласных ответа подряд ставят сдвиг, один — нет', () => {
  let s = semester();
  s = say(s, 'Раз.\n[Date: 13/10/1248, Пятница]');
  assert.equal(s.calendar.day, '1248-10-13');
  assert.equal(s.calendar.weekdayShift, undefined, 'одиночный ответ не сдвигает');
  assert.equal(s.calendar.weekdaySeen.shift, 3);
  s = say(s, 'Два.\n[Date: 13/10/1248, Fri]');
  assert.equal(s.calendar.weekdayShift, 3);
  assert.equal(s.calendar.weekdaySeen, undefined);
  assert.equal(weekdayIn(s, s.calendar.day), 5);
});

test('одиночное расхождение гасится совпавшим ответом и не сдвигает', () => {
  let s = semester();
  s = say(s, 'Раз.\n[Date: 13/10/1248, Пятница]');
  s = say(s, 'Два.\n[Date: 14/10/1248, Среда]'); // по григорианскому счёту 14.10.1248 — среда
  assert.equal(s.calendar.weekdayShift, undefined);
  assert.equal(s.calendar.weekdaySeen, undefined);
});

test('несогласные ответы не складываются', () => {
  let s = semester();
  s = say(s, 'Раз.\n[Date: 13/10/1248, Пятница]');
  s = say(s, 'Два.\n[Date: 14/10/1248, Пятница]');
  assert.equal(s.calendar.weekdayShift, undefined);
  assert.equal(s.calendar.weekdaySeen.n, 1);
});

test('расписание и показ берут день недели со сдвигом', () => {
  let s = semester();
  s.schedule = { 5: ['a'], 2: [] };
  s = say(s, 'Раз.\n[Date: 13/10/1248, Пятница]');
  assert.deepEqual(dayPlan(s, preset), [], 'до сдвига день считается вторником');
  s = say(s, 'Два.\n[Date: 13/10/1248, Пятница]');
  assert.equal(dayPlan(s, preset).length, 1, 'после сдвига это пятница');
  const tv = todayView(s, preset);
  assert.equal(tv.kind, 'ok', JSON.stringify(tv.errors));
  assert.match(tv.dateLine, /^пятница/);
});

test('свайп: состояние до ответа не помнит счётчика', () => {
  const s0 = semester();
  const s1 = say(s0, 'Раз.\n[Date: 13/10/1248, Пятница]');
  assert.ok(s1.calendar.weekdaySeen);
  assert.equal(s0.calendar.weekdaySeen, undefined);
  const s2 = say(s0, 'Свайп.\n[Date: 13/10/1248, Пятница]');
  assert.equal(s2.calendar.weekdayShift, undefined, 'свайп — снова первый ответ');
});

test('плашка скачка без сдвига называет день недели из истории, а не свой счёт', () => {
  let s = semester();
  s = say(s, 'Раз.\n[Date: 18/10/1248]');
  s = say(s, 'Два.\n[Date: 18/10/1248]');
  s = say(s, 'Три.\n[Date: 24/10/1248, Вторник]');
  assert.ok(s.calendar.heldJump, 'скачок придержан');
  assert.match(todayView(s, preset).heldJump.dateLine, /^вторник/);
  assert.equal(formatDate('1248-10-24', 'full', 3).split(',')[0], 'вторник');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { applyResponse } from '../core/engine.mjs';
import { setAbsolute } from '../core/time.mjs';

// Живой прогон 10.10 (п. 62): сюжет в 1248, календарь заведён по 2026-му, время
// из ответа игнорировалось как «откат» на каждом ответе. Дата идёт в формате
// `[Date: DD/MM/YYYY]`.

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/magic-academy.json', import.meta.url)), 'utf8'));
const SUBJECTS = [{ id: 'a', name: 'Алхимия', teacherId: 't' }];
const TEACHERS = [{ id: 't', name: 'Магистр Т', traits: ['строг'] }];

function semester(startDay = '2026-10-12') {
  const s = createState(preset, {
    startDay, survey: {}, subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
  });
  s.started = true;
  return s;
}

test('[Date: 18/10/1248]: календарь переезжает на год сюжета, а не «откатывается»', () => {
  const r = applyResponse(semester(), 'Утро в башне.\n[Date: 18/10/1248]', preset, { mode: 'auto' });
  assert.equal(r.state.calendar.day.slice(0, 4), '1248');
  assert.equal(r.state.calendar.termStart.slice(0, 4), '1248');
  assert.ok(!r.debug.notes.some((n) => /откат/.test(n)), r.debug.notes.join('; '));
});

test('начатый круг: два ответа подряд с годом 1248 переносят календарь, даже если время двигали', () => {
  let s = semester();
  s.calendar.moved = 3; // нажато «+1 занятие» до первого ответа
  s = applyResponse(s, 'Раз.\n[Date: 18/10/1248]', preset, { mode: 'auto' }).state;
  assert.equal(s.calendar.day.slice(0, 4), '2026', 'один ответ — ещё может быть чужой инфоблок');
  assert.equal(s.calendar.eraSeen.year, 1248);
  s = applyResponse(s, 'Два.\n[Date: 18/10/1248]', preset, { mode: 'auto' }).state;
  assert.equal(s.calendar.day.slice(0, 4), '1248');
  assert.equal(s.calendar.eraSeen, undefined);
});

test('мелькнувший чужой год один раз не уводит календарь', () => {
  let s = semester();
  s.calendar.moved = 3;
  s = setAbsolute(s, { day: '1248-10-18' }, 'A', preset).state;
  s = setAbsolute(s, { day: '2026-10-13' }, 'A', preset).state;
  assert.equal(s.calendar.eraSeen, undefined, 'год рядом с календарным гасит счётчик');
  s = setAbsolute(s, { day: '1248-10-18' }, 'A', preset).state;
  assert.equal(s.calendar.day.slice(0, 4), '2026');
});

test('строка отката без двойного пробела', () => {
  const s = semester('2026-10-12');
  s.calendar.moved = 3;
  const r = setAbsolute(s, { day: '2026-10-10' }, 'A', preset);
  assert.equal(r.applied, false);
  assert.ok(!/ {2}/.test(r.reason), r.reason);
});

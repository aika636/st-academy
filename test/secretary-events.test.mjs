// Секретарь пишет в планы праздники и события из ответа (`event=`): разбор
// ключа, токен и его слова, промпт, движок (день — от сцены, без дублей),
// поправка к старому ответу и её снятие.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildAnalysisPrompt, parseAnalysis, effectiveText, tokenText, tokenOf } from '../core/analysis.mjs';
import { parseMarker } from '../core/parse-marker.mjs';
import { applyResponse } from '../core/engine.mjs';
import { applyCorrection, revertCorrection, receiptOf } from '../core/corrections.mjs';
import { addEvent, planEvent } from '../core/holidays.mjs';
import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));

const SUBJECTS = [{ id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' }];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }];

function semester(day = '2026-10-05') {
  const s = createState(preset, {
    startDay: '2026-09-01', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
  });
  s.started = true;
  s.calendar.day = day;
  return s;
}

const lexicon = (s) => ({ ...preset, subjects: s.subjects, teachers: s.teachers });

test('event=: дни, диапазон, русские имена ключа; дальше двух недель — отказ', () => {
  const { events, rejected } = parseMarker(
    '<!-- [ACADEMY event=+3:Бал у Миражи праздник=+5..+6:ярмарка событие=0:концерт event=+14:поход event=завтра:кино] -->', {},
  );
  assert.deepEqual(events.map((e) => [e.name, e.days, e.until]), [
    ['Бал у Миражи', 3, 3], ['ярмарка', 5, 6], ['концерт', 0, 0],
  ]);
  assert.equal(rejected.length, 2);
  assert.match(rejected[0].reason, /двух недель/);
});

test('секретарь: несколько событий — несколько токенов, слова для плашки', () => {
  const s = semester();
  const res = parseAnalysis('<!-- [ACADEMY event=+3:Бал у Миражи event=+5..+6:ярмарка] -->\nКратко: к учёбе не относится.', lexicon(s));
  assert.deepEqual(res.tokens, ['event=+3:Бал у Миражи', 'event=+5..+6:ярмарка']);
  assert.equal(tokenText(res.tokens[0], lexicon(s)), 'в планы: Бал у Миражи — через 3 дн.');
  assert.equal(tokenText(res.tokens[1], lexicon(s)), 'в планы: ярмарка — через 5 дн. (на 2 дн.)');
  assert.equal(tokenOf({ kind: 'event', days: 1, until: 1, name: 'кино: премьера' }), 'event=+1:кино премьера', 'двоеточие в названии не ломает токен');
});

test('секретарь: промпт объясняет event и называет то, что уже в планах', () => {
  const s = addEvent(semester(), { name: 'вечеринка у Миражи', from: '2026-10-09' }).state;
  const { user } = buildAnalysisPrompt(s, preset, { reply: 'Говорят, в пятницу вечеринка.' });
  assert.match(user, /event=\+дни:название/);
  assert.match(user, /Уже в планах \(не повторяй\): [^\n]*вечеринка у Миражи \(\+4\)/);
  const empty = buildAnalysisPrompt(semester('2026-10-12'), { ...preset, holidays: [], calendar: { ...preset.calendar, vacations: [] } }, { reply: '…' });
  assert.match(empty.user, /Уже в планах \(не повторяй\): ничего\./);
});

test('движок: события ложатся от дня сцены, после сдвига времени', () => {
  const s = semester('2026-10-05');
  const text = effectiveText('Наутро Мираж позвала на бал.\n<!-- [ACADEMY t=+1d] -->', ['event=+3:Бал у Миражи', 'event=+5..+6:ярмарка']);
  const out = applyResponse(s, text, preset, { mode: 'marker' });
  assert.equal(out.state.calendar.day, '2026-10-06');
  assert.deepEqual(out.state.events.map((e) => [e.name, e.from, e.to || e.from]), [
    ['Бал у Миражи', '2026-10-09', '2026-10-09'],
    ['ярмарка', '2026-10-11', '2026-10-12'],
  ]);
  assert.ok(out.debug.applied.some((a) => a.kind === 'event' && a.name === 'Бал у Миражи'));

  // Следующий ответ снова говорит о том же бале — второй записи нет.
  const again = applyResponse(out.state, effectiveText('Бал всё ближе.', ['event=+2:бал у Миражи']), preset, { mode: 'marker' });
  assert.equal(again.state.events.length, 2);
  assert.ok(again.debug.applied.some((a) => a.kind === 'event-known'));
});

test('без дублей: праздник пресета и каникулы уже в календаре', () => {
  const p = { ...preset, holidays: [{ id: 'ball', name: 'Зимний бал', from: '12-27' }] };
  const s = semester('2026-12-24');
  assert.equal(planEvent(s, p, { name: 'зимний бал', days: 3, until: 3 }).ok, false);
  assert.equal(planEvent(s, p, { name: 'бал', days: 2, until: 2 }).ok, false, 'короткое имя внутри полного');
  assert.equal(planEvent(semester('2026-11-01'), p, { name: 'Ноябрьские', days: 3, until: 3 }).ok, false, 'каникулы пресета');
  assert.equal(planEvent(s, p, { name: 'концерт', days: 1, until: 1 }).ok, true);
});

test('поправка к старому ответу: от дня того ответа, снимается по квитанции и по токену', () => {
  const s = semester('2026-10-10');
  const ev = parseMarker('<!-- [ACADEMY event=+3:концерт] -->', {}).events[0];
  const r = applyCorrection(s, ev, preset, { day: '2026-10-08' });
  assert.equal(r.state.events[0].from, '2026-10-11');
  assert.equal(r.receipt.kind, 'event');
  assert.deepEqual(revertCorrection(r.state, r.receipt, preset).events, []);

  const byToken = receiptOf(ev, '2026-10-08');
  assert.deepEqual(revertCorrection(r.state, byToken, preset).events, []);

  const twice = applyCorrection(r.state, ev, preset, { day: '2026-10-08' });
  assert.equal(twice.receipt, null, 'второй раз то же событие не ложится');
});

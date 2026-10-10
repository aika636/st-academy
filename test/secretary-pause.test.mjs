// Секретарь объявляет приостановку занятий (`pause=`): разбор ключа, токен,
// промпт, движок (срок и «до отмены»), обновление, закрытие, отказ на желания,
// поправка к старому ответу и её снятие, `isVacation` для открытого периода.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildAnalysisPrompt, parseAnalysis, effectiveText, tokenText, tokenOf, tokenEvent } from '../core/analysis.mjs';
import { parseMarker } from '../core/parse-marker.mjs';
import { applyResponse } from '../core/engine.mjs';
import { applyCorrection, revertCorrection } from '../core/corrections.mjs';
import { addEvent, planPause, activePause, updateEventDates } from '../core/holidays.mjs';
import { isVacation, isStudyDay, phaseOf } from '../core/time.mjs';
import { validateState, createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { pauseView } from '../ui/holidays.js';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));

const SUBJECTS = [{ id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' }];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }];

function semester(day = '2026-10-12') {
  const s = createState(preset, {
    startDay: '2026-09-01', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
  });
  s.started = true;
  s.calendar.day = day;
  return s;
}

const lexicon = (s) => ({ ...preset, subjects: s.subjects, teachers: s.teachers });
const run = (s, token, text = 'Ответ.') => applyResponse(s, effectiveText(text, [token]), preset, { mode: 'marker' });

test('pause=: срок, открытый период, конец, русские имена ключа; нелепое — отказ', () => {
  const { events, rejected } = parseMarker(
    '<!-- [ACADEMY pause=7:закрытие на неделю каникулы=open:карантин пауза=end pause=0:ничего pause=500:вечность pause=завтра] -->', {},
  );
  assert.deepEqual(events, [
    { kind: 'pause', days: 7, name: 'закрытие на неделю' },
    { kind: 'pause', days: null, name: 'карантин' },
    { kind: 'pause', end: true },
  ]);
  assert.equal(rejected.length, 3);
});

test('секретарь: токен и слова для плашки', () => {
  const s = semester();
  const res = parseAnalysis('<!-- [ACADEMY pause=7:закрытие pause=open:карантин pause=end] -->\nКратко: к учёбе не относится.', lexicon(s));
  assert.deepEqual(res.tokens, ['pause=7:закрытие', 'pause=open:карантин', 'pause=end']);
  assert.equal(tokenText(res.tokens[0], lexicon(s)), 'закрытие — занятий нет 7 дней');
  assert.equal(tokenText(res.tokens[1], lexicon(s)), 'карантин — занятий нет до отмены');
  assert.equal(tokenText(res.tokens[2], lexicon(s)), 'занятия возобновились');
  assert.equal(tokenOf({ kind: 'pause', days: 3, name: 'ремонт: крыша' }), 'pause=3:ремонт крыша');
  assert.deepEqual(tokenEvent('pause=open', lexicon(s)), { kind: 'pause', days: null, name: '' });
});

test('промпт секретаря: правило pause с примерами да/нет и днём сцены', () => {
  const { user } = buildAnalysisPrompt(semester(), preset, { reply: 'Началась тишина.' });
  assert.match(user, /pause=дни:название/);
  assert.match(user, /День сцены: 2026-10-12/);
  assert.match(user, /Желание[^\n]*«хорошо бы каникулы»/);
  assert.match(user, /Пример да:[^\n]*pause=open:/);
  assert.match(user, /Пример нет:[^\n]*«Скорее бы каникулы»/);
});

test('движок: назван срок — событие off с концом от дня сцены, занятий нет', () => {
  const out = run(semester('2026-10-12'), 'pause=7:закрытие на неделю');
  assert.deepEqual(out.state.events.map((e) => [e.name, e.from, e.to, e.off, e.pause, e.open]), [
    ['закрытие на неделю', '2026-10-12', '2026-10-18', true, true, undefined],
  ]);
  assert.equal(isVacation(preset, '2026-10-15', out.state), true);
  assert.equal(isVacation(preset, '2026-10-19', out.state), false);
  assert.equal(phaseOf(preset, out.state, '2026-10-12'), 'vacation');
  assert.ok(out.debug.applied.some((a) => a.kind === 'pause' && a.action === 'new'));
});

test('движок: срок не назван — период открытый, isVacation считает его длящимся, а однодневное событие без to — одним днём', () => {
  const out = run(semester('2026-10-12'), 'pause=open:карантин');
  const [e] = out.state.events;
  assert.equal(e.open, true);
  assert.equal(e.to, undefined);
  assert.equal(isVacation(preset, '2026-10-12', out.state), true);
  assert.equal(isVacation(preset, '2027-02-01', out.state), true);
  assert.equal(isVacation(preset, '2026-10-11', out.state), false, 'до начала занятия идут');
  assert.equal(validateState(out.state, preset).ok, true);

  // Своё событие без `to` и без `open` — по-прежнему один день.
  const own = addEvent(semester('2026-10-12'), { name: 'выходной', from: '2026-10-13', off: true }).state;
  assert.equal(isVacation(preset, '2026-10-13', own), true);
  assert.equal(isVacation(preset, '2026-10-14', own), false);
});

test('повторное упоминание обновляет период, а не плодит новый', () => {
  let s = run(semester('2026-10-12'), 'pause=open:карантин').state;
  // Через день названа дата конца: тот же период закрывается сроком.
  s.calendar.day = '2026-10-14';
  s = run(s, 'pause=5:карантин до 18-го').state;
  assert.equal(s.events.length, 1);
  assert.deepEqual([s.events[0].from, s.events[0].to, s.events[0].open], ['2026-10-12', '2026-10-18', undefined]);
  // Тот же срок ещё раз — ничего нового.
  const again = run(s, 'pause=5:карантин');
  assert.equal(again.state.events.length, 1);
  assert.ok(again.debug.applied.some((a) => a.kind === 'pause-known'));
});

test('«занятия возобновились» закрывает открытый период вчерашним днём', () => {
  let s = run(semester('2026-10-12'), 'pause=open:карантин').state;
  s.calendar.day = '2026-10-16';
  const out = run(s, 'pause=end');
  assert.deepEqual([out.state.events[0].to, out.state.events[0].open], ['2026-10-15', undefined]);
  assert.equal(isVacation(preset, '2026-10-15', out.state), true);
  assert.equal(isVacation(preset, '2026-10-16', out.state), false);
  assert.equal(activePause(out.state, '2026-10-16'), null);
  // Нечего закрывать — тишина, календарь на месте.
  const none = run(out.state, 'pause=end');
  assert.equal(none.state.events.length, 1);
  // Закрыли в день начала — период убирается целиком.
  const same = run(run(semester('2026-10-12'), 'pause=open:карантин').state, 'pause=end');
  assert.deepEqual(same.state.events, []);
});

test('каникулы пресета не дублируются', () => {
  const vac = preset.calendar.vacations[0];
  const from = `2026-${vac.from}`;
  const s = semester(from);
  const r = planPause(s, preset, { days: 2, name: 'каникулы' });
  assert.equal(r.ok, false);
  assert.equal(r.duplicate, true);
});

test('отказ на желания: без ключа pause календарь не меняется, а плохой ключ уходит в rejected', () => {
  const s = semester();
  for (const said of ['Хорошо бы каникулы.', 'Прошлой зимой каникулы были долгими.', 'Говорят, на карантин закроют.']) {
    const out = applyResponse(s, `${said}\n<!-- [ACADEMY] -->`, preset, { mode: 'marker' });
    assert.deepEqual(out.state.events || [], []);
  }
  const bad = parseAnalysis('<!-- [ACADEMY pause=когда-нибудь:каникулы] -->', lexicon(s));
  assert.deepEqual(bad.tokens, []);
  assert.equal(bad.rejected.length, 1);
});

test('поправка к старому ответу: период ложится от его дня, снятие возвращает прежнее', () => {
  const base = run(semester('2026-10-12'), 'pause=open:карантин').state;
  const applied = applyCorrection(base, tokenEvent('pause=3:карантин', lexicon(base)), preset, { day: '2026-10-13' });
  assert.equal(applied.receipt.kind, 'pause');
  assert.equal(applied.state.events[0].to, '2026-10-15');
  const back = revertCorrection(applied.state, applied.receipt, preset);
  assert.deepEqual(back.events, base.events);

  const fresh = applyCorrection(semester('2026-10-12'), tokenEvent('pause=2:ремонт', lexicon(base)), preset, { day: '2026-10-12' });
  assert.equal(fresh.state.events.length, 1);
  assert.deepEqual(revertCorrection(fresh.state, fresh.receipt, preset).events, []);
});

test('плашка: идущий период словами, «Изменить» правит даты, «до отмены» без конца', () => {
  const closed = run(semester('2026-10-12'), 'pause=7:закрытие').state;
  assert.equal(pauseView(closed, preset).line, 'Пары отменены: 12–18 октября');
  const open = run(semester('2026-10-12'), 'pause=open:карантин').state;
  const view = pauseView(open, preset);
  assert.equal(view.line, 'Пары отменены: с 12 октября, до отмены');
  assert.equal(view.open, true);
  assert.equal(pauseView(semester('2026-10-12'), preset), null);

  const moved = updateEventDates(open, view.id, { from: '2026-10-12', to: '2026-10-20' });
  assert.equal(moved.ok, true);
  assert.equal(pauseView(moved.state, preset).line, 'Пары отменены: 12–20 октября');
  assert.equal(updateEventDates(open, view.id, { from: '2026-10-12', to: '2026-10-01' }).ok, false);
  assert.equal(updateEventDates(open, 'нет', {}).ok, false);
});

test('расписание: в дни приостановки учебных дней нет, после неё они возвращаются', () => {
  const s = run(semester('2026-10-12'), 'pause=7:закрытие').state;
  assert.equal(isStudyDay(preset, '2026-10-13', s), false);
  assert.equal(isStudyDay(preset, '2026-10-19', s), true);
});

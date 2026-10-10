// Прогон 10.10, шестой: имя нерабочего периода в чипе фазы, начало периода при ещё не
// принятой дате ответа, «Кратко» секретаря без служебной пометки и с русским именем
// карточки, склонение в тосте «Новые слухи».

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseAnalysis, effectiveText } from '../core/analysis.mjs';
import { applyResponse, resolveHeldJump } from '../core/engine.mjs';
import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { todayView } from '../ui/today.js';
import { molvaDoneText } from '../ui/cast.js';
import { extraLabels, hintBody } from '../ui/common.js';

const load = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));
const preset = load('ru-university');
const SUBJECTS = [{ id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' }];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }];

function semester(day) {
  const s = createState(preset, {
    startDay: '2026-09-01', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
  });
  s.started = true;
  s.calendar.day = day;
  return s;
}

test('чип фазы в нерабочий период из текста зовётся именем периода', () => {
  const s = semester('2026-10-12');
  s.events = [{ id: 'p1', name: 'закрытие академии', from: '2026-10-12', to: '2026-10-18', off: true, pause: true }];
  const v = todayView(s, preset);
  assert.equal(v.phase, 'vacation');
  assert.equal(v.phaseLabel, 'закрытие академии');
  assert.match(v.silentReason, /^закрытие академии — /);
});

test('период pause= в ответе с ещё не принятой датой начинается с этой даты', () => {
  const s = semester('2026-10-21');
  const text = effectiveText('📅 24 декабря 2026, 09:00\nАкадемию закрыли.', ['pause=7:закрытие академии']);
  const r = applyResponse(s, text, preset);
  const held = r.state.calendar.heldJump;
  assert.ok(held, 'дата придержана, календарь ещё на 21-м');
  assert.equal(r.state.calendar.day, '2026-10-21');
  const [e] = r.state.events;
  assert.equal(e.from, held.day);
  // Принять дату — период остаётся там, где его назвал ответ.
  const ok = resolveHeldJump(r.state, preset, true);
  assert.equal(ok.state.calendar.day, held.day);
  assert.equal(ok.state.events[0].from, held.day);
});

test('«Кратко»: пометка «к учёбе не относится» убрана, имя карточки по-русски', () => {
  const names = { cast: [{ name: 'Vandrel Kharis', aliases: ['Вандрел Харис', 'Вандрел'] }] };
  const lex = { ...preset, subjects: SUBJECTS, teachers: TEACHERS, names, survey: { lang: 'ru' } };
  const res = parseAnalysis('<!-- [ACADEMY] -->\nКратко: К учёбе не относится: Стычка: Vandrel Kharis и Ренее — надзор и подозрения.', lex);
  assert.equal(res.summary, 'Стычка: Вандрел Харис и Ренее — надзор и подозрения.');
  assert.equal(parseAnalysis('<!-- [ACADEMY] -->\nКратко: к учёбе не относится.', lex).summary, '');
  assert.equal(parseAnalysis('<!-- [ACADEMY] -->\nКратко: Сдан зачёт.', lex).summary, 'Сдан зачёт.');
});

test('тост «Новые слухи»: числительные склоняются, хвост про отброшенное', () => {
  const X = extraLabels(preset);
  assert.equal(molvaDoneText(X, { posts: 1, replies: 2 }), 'Новые слухи: 1 пост, 2 ответа.');
  assert.equal(molvaDoneText(X, { posts: 5, replies: 21 }), 'Новые слухи: 5 постов, 21 ответ.');
  assert.equal(molvaDoneText(X, { posts: 2, replies: 11, skipped: true }), 'Новые слухи: 2 поста, 11 ответов. Часть реплик отброшена.');
});

test('пояснение после тире начинается со строчной, сокращения не трогаются', () => {
  assert.equal(hintBody('Неделя из семи дней.'), 'неделя из семи дней.');
  assert.equal(hintBody('ДЗ — домашнее задание'), 'ДЗ — домашнее задание');
});

test('строки пресетов: подписи скачка, зачёта и слухов; weekHint нет', () => {
  for (const id of ['cadet-academy', 'cn-highschool', 'dark-academia', 'hero-academy', 'jp-highschool', 'magic-academy',
    'ru-school', 'ru-university', 'space-academy', 'us-college', 'us-highschool', 'xianxia-sect']) {
    const ui = load(id).ui;
    assert.equal(ui.jumpTitle, 'В ответе другая дата', id);
    assert.match(ui.repairCounted, /засчитано посещёнными: \{count\}\.$/, id);
    assert.doesNotMatch(ui.surveyNote, /Шесть/, id);
    assert.equal(ui.weekHint, undefined, id);
  }
  assert.match(load('magic-academy').glossary['Тёмная седмица'], /26 октября/);
});

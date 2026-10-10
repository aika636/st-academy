// test/live-1010-labels — подписи и мелкие поведения из живых прогонов 10.10
// (design-mockup/full/bugs-found.md): слова заведения в плашке, род наставника,
// «+1 пара» с часами до первой пары, дубль пары на «Сегодня», показ результата
// слэш-команды человеку.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { advance } from '../core/time.mjs';
import { addGrade } from '../core/gradebook.mjs';
import { rowText, summaryText } from '../mes-panel.js';
import { showResult } from '../commands.js';
import { gradebookView, todayView, uiLabels, DEFAULT_UI } from '../ui.js';
import { renderGradebook } from '../ui/gradebook.js';
import { parsePreset } from './preset-file.mjs';

const load = (id) => parsePreset(readFileSync(new URL(`../presets/${id}.json`, import.meta.url), 'utf8'));
const IDS = readdirSync(new URL('../presets/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
const uni = load('ru-university');
const school = load('ru-school');

const SUBJECTS = [
  { id: 'chemistry', name: 'химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'grinev' },
];
const TEACHERS = [
  { id: 'petrova', name: 'Петрова Анна Сергеевна', traits: [] },
  { id: 'grinev', name: 'Гринёв Пётр Андреевич', traits: [] },
];

function started(preset, cal = {}) {
  const s = createState(preset, { startDay: '2024-09-02', subjects: SUBJECTS, teachers: TEACHERS });
  s.schedule = buildSchedule(s.subjects, preset);
  s.started = true;
  Object.assign(s.calendar, cal);
  return s;
}

// --- 1, 2: опечатка и склейка с «четвертью» ----------------------------------

test('школа: «между четвертями» без опечатки, устав не склеивает «четвертьи»', () => {
  assert.equal(school.labels.phases.break, 'между четвертями');
  const charter = school.phrases.lorebook.charter;
  assert.doesNotMatch(charter, /\{term\}[а-яё]/, 'слово периода к шаблону не приклеивается');
});

// --- 3, 4, 8, 34, 35: строки плашки словами заведения ------------------------

test('плашка: долг, промотка и несданное — словами пресета, не вузовскими', () => {
  const words = (p) => {
    const U = uiLabels(p);
    return { rowDebt: U.rowDebt, rowDebtClosed: U.rowDebtClosed, rowJump: U.rowJump, rowExamMissed: U.rowExamMissed, rowReputation: U.rowReputation };
  };
  const sch = words(school);
  assert.equal(rowText({ kind: 'debt', debt: true, subject: 'физика' }, sch), 'Долг по предмету: физика');
  assert.equal(rowText({ kind: 'debt', debt: false, subject: 'физика' }, sch), 'Долг по предмету закрыт: физика');
  assert.equal(rowText({ kind: 'attendance-jump', missed: 5 }, sch), 'Пропущено уроков: 5');
  assert.equal(rowText({ kind: 'exam-missed', subject: 'физика' }, sch), 'Не сдано к концу итоговой недели: физика');

  const un = words(uni);
  assert.equal(rowText({ kind: 'debt', debt: true, subject: 'физика' }, un), 'Хвост по предмету: физика');
  assert.equal(rowText({ kind: 'attendance-jump', missed: 5 }, un), 'Пропущено пар: 5');

  const magic = words(load('magic-academy'));
  assert.equal(rowText({ kind: 'reputation', from: 'a', to: 'b' }, magic), 'Слава: a → b', 'слава у магов, как в команде и «Людях»');
});

test('плашка: уважительный пропуск — с существительным, а не обрывком', () => {
  assert.equal(rowText({ kind: 'attendance', status: 'excused', subject: 'химия' }), 'уважительный пропуск: химия');
});

test('каждый пресет перевёл строки плашки и подсказку правила экзаменов', () => {
  for (const id of IDS) {
    const ui = load(id).ui;
    for (const k of ['rowDebt', 'rowDebtClosed', 'rowJump', 'rowExamMissed', 'rowReputation', 'examRuleStoryHint']) {
      assert.ok(ui[k], `${id}: нет ${k}`);
    }
    assert.match(ui.rowDebt, /\{subject\}/);
    assert.match(ui.rowJump, /\{count\}/);
  }
  assert.match(school.ui.examRuleStoryHint, /итоговой недели — долг/);
  assert.doesNotMatch(school.ui.examRuleStoryHint, /хвост|сессии/);
});

// --- 11, 21: ярлыки отношения без рода ---------------------------------------

test('ярлыки отношения не привязаны к мужскому роду наставника', () => {
  const masculine = ['холоден', 'недоволен', 'благосклонен', 'разочарован', 'расположен', 'приветлив', 'проклял'];
  for (const id of IDS) {
    for (const { label } of load(id).relations.labels) {
      assert.ok(!masculine.includes(label), `${id}: «${label}» — мужской род`);
    }
  }
});

// --- 22: «+1 пара» не перешагивает ближайшую -------------------------------------

test('+1 пара с часов до первой пары встаёт на неё, а не на вторую', () => {
  const s = started(uni, { precision: 'datetime', time: '08:22', periodIndex: 0 });
  const r = advance(s, { unit: 'period', n: 1 }, uni);
  assert.equal(r.applied, true);
  assert.equal(r.state.calendar.time, uni.bells[0].start, 'ближайшая пара — первая');
  assert.equal(r.state.calendar.periodIndex, 0);
  assert.equal(r.state.calendar.day, s.calendar.day);
});

test('+1 пара внутри пары — следующая; на перемене — ближайшая; вечером — первая завтра', () => {
  const inside = started(uni, { precision: 'datetime', time: uni.bells[0].start, periodIndex: 0 });
  assert.equal(advance(inside, { unit: 'period', n: 1 }, uni).state.calendar.time, uni.bells[1].start);

  const [b0, b1] = uni.bells;
  const gap = started(uni, { precision: 'datetime', time: b0.end, periodIndex: 1 });
  assert.equal(advance(gap, { unit: 'period', n: 1 }, uni).state.calendar.time, b1.start, 'перемена: следующая пара ближайшая');

  const late = started(uni, { precision: 'datetime', time: '19:00', periodIndex: 5 });
  const r = advance(late, { unit: 'period', n: 1 }, uni);
  assert.equal(r.state.calendar.time, uni.bells[0].start);
  assert.equal(r.state.calendar.day, '2024-09-03');
});

// --- 20: одна пара дважды ---------------------------------------------------

test('«Сегодня»: пара, с которой начнём, не повторяется карточкой «Дальше»', () => {
  const before = todayView(started(uni, { precision: 'datetime', time: '08:00', periodIndex: 0 }), uni);
  assert.equal(before.now.status, 'before');
  assert.equal(before.next, null, 'вторая карточка про ту же пару убрана');
  assert.equal(before.nextIsNow, true);

  const during = todayView(started(uni, { precision: 'datetime', time: '09:00', periodIndex: 0 }), uni);
  assert.equal(during.now.status, 'now');
  assert.ok(during.next, 'во время пары «Дальше» остаётся');
  assert.equal(during.nextIsNow, false);
});

// --- 25: прыжок времени и «без перемен» -------------------------------------

test('плашка при придержанном прыжке не врёт «без перемен»', () => {
  assert.match(summaryText({ rows: [], analyzed: true, heldJump: true }), /принять или оставить/);
  assert.equal(summaryText({ rows: [], analyzed: true }), 'без перемен');
  assert.equal(summaryText({ rows: ['химия: 5'], analyzed: true, heldJump: true }), 'химия: 5');
});

// --- 28: «Зачётка» без «— —» --------------------------------------------------

test('«Зачётка»: предмет без оценок — одна подпись; прогулы и причина отношения на виду', () => {
  let s = started(uni);
  const view = gradebookView(s, uni);
  assert.ok(view.subjects.every((x) => x.grades.length === 0));
  s = addGrade(s, { subjectId: 'chemistry', value: '4' }, uni).state;
  const v2 = gradebookView(s, uni);
  const chem = v2.subjects.find((x) => x.id === 'chemistry');
  assert.deepEqual(chem.grades, ['4']);
  assert.equal(chem.attendanceText, '');
  assert.ok(DEFAULT_UI.noGrades);
  assert.equal(typeof renderGradebook, 'function');
});

// --- 19: результат команды виден человеку -----------------------------------

test('showResult: окошко таверны с экранированным текстом, без ожидания закрытия', () => {
  const shown = [];
  const ctx = {
    POPUP_TYPE: { TEXT: 1 },
    callGenericPopup: (html, type, input, opts) => { shown.push({ html, type, opts }); return new Promise(() => {}); },
  };
  assert.equal(showResult(ctx, '/academy', 'строка <b>раз</b>\nдва'), true);
  assert.equal(shown.length, 1);
  assert.match(shown[0].html, /&lt;b&gt;раз&lt;\/b&gt;/, 'HTML из текста не исполняется');
  assert.match(shown[0].html, /pre-wrap/);
  assert.equal(showResult(ctx, '/academy', '   '), false, 'пустое не показываем');
  assert.equal(showResult({}, '/academy', 'текст'), false, 'нет ни окошка, ни тоста — молча');
});

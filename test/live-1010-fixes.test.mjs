import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createState } from '../core/state.mjs';
import { changeRelation } from '../core/relations.mjs';
import { dealText } from '../core/scene.mjs';
import { gradebookView } from '../ui/gradebook.js';
import { stateHealth, sectionIcon } from '../ui/common.js';
import { langWord } from '../ui/settings.js';
import { statusText } from '../commands.js';

// Живые прогоны 10.10: зачётка (п. 59), подписи (п. 68), слово отношения (п. 10).

const preset = JSON.parse(readFileSync(new URL('../presets/magic-academy.json', import.meta.url), 'utf8'));

const base = () => {
  const s = createState(preset, {
    startDay: '2026-10-12',
    teachers: [{ id: 'korvin', name: 'Магистр Корвин' }, { id: 'lira', name: 'Лира' }],
    subjects: [
      { id: 'alchemy', name: 'Алхимия', teacherId: 'korvin' },
      { id: 'runes', name: 'Руны', teacherId: 'korvin' },
      { id: 'herbs', name: 'Травы', teacherId: 'lira' },
    ],
  });
  s.started = true;
  return s;
};

const row = (view, id) => view.subjects.find((s) => s.id === id);

test('зачётка: причина отношения висит только у своего предмета', () => {
  const s = changeRelation(base(), {
    teacherId: 'korvin', delta: -1, reason: { kind: 'skip', subjectId: 'runes', count: 1 },
  }, preset).state;
  const view = gradebookView(s, preset);
  assert.match(row(view, 'runes').reason, /^−1/);
  assert.equal(row(view, 'alchemy').reason, '', 'у второго предмета того же наставника причины нет');
});

test('зачётка: повод без предмета — у первого предмета наставника', () => {
  const s = changeRelation(base(), { teacherId: 'korvin', delta: 1, reason: { text: 'помогла' } }, preset).state;
  const view = gradebookView(s, preset);
  assert.match(row(view, 'alchemy').reason, /^\+1/);
  assert.equal(row(view, 'runes').reason, '');
});

test('зачётка: наставник без истории — без слова отношения и «· 0»', () => {
  const view = gradebookView(base(), preset);
  assert.equal(row(view, 'herbs').relation, '');
  assert.equal(row(view, 'herbs').score, '');
});

test('зачётка: отработанный прогул помечен', () => {
  const s = base();
  s.attendance.records.push(
    { subjectId: 'alchemy', day: '2026-10-12', status: 'skip', workedOff: '2026-10-14' },
    { subjectId: 'runes', day: '2026-10-12', status: 'skip' },
    { subjectId: 'runes', day: '2026-10-13', status: 'skip', workedOff: '2026-10-14' },
  );
  const view = gradebookView(s, preset);
  assert.equal(row(view, 'alchemy').attendanceText, '1 прогул (отработан)');
  assert.equal(row(view, 'runes').attendanceText, '2 прогула, отработано 1');
});

test('сводка /academy: без оценок строки «балл: —» нет', () => {
  const s = base();
  const host = {
    getPreset: () => preset, getState: () => s, getStatus: () => ({ ok: true }),
  };
  const text = statusText(host);
  assert.ok(!/: —$/m.test(String(text)), String(text));
});

test('дело-отработка: направление не «наставник должен героине»', () => {
  const people = [{ id: 'korvin', name: 'Магистр Корвин' }];
  const flipped = dealText({ kind: 'deal', a: 'korvin', b: '@heroine', what: 'две секции отработки' }, people, 'Ренея');
  assert.equal(flipped, 'Ренея должна Магистру: две секции отработки');
  const same = dealText({ kind: 'deal', a: 'korvin', b: '@heroine', what: 'вернуть книгу' }, people, 'Ренея');
  assert.match(same, /^Магистр Корвин должен Ренее/);
});

test('до начала: при готовом плане кнопка ведёт к началу, а не к анкете', () => {
  const s = base();
  s.started = false;
  const health = stateHealth(s, preset);
  assert.equal(health.action.id, 'open-start');
  assert.match(health.action.label, /Начать круг/);
  const empty = createState(preset, { startDay: '2026-10-12' });
  assert.equal(stateHealth(empty, preset).action.id, 'open-settings');
});

test('язык названий: код показан словом, значки у разделов настроек есть', () => {
  assert.equal(langWord('ru'), 'русский');
  assert.equal(langWord('русский'), 'русский');
  assert.notEqual(sectionIcon('Персонаж карточки'), 'fa-circle-dot');
  assert.notEqual(sectionIcon('Достижения'), 'fa-circle-dot');
});

// Слова на экране и в тексте для модели: сводка багов 10.10, раздел 1 (служебные слова,
// склейки с {term}, иероглифы, скобки в словаре, род учителя).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { plural } from '../core/plural.mjs';
import { DEFAULT_UI } from '../ui/common.js';

const DIR = new URL('../presets/', import.meta.url);
const load = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(f, DIR)), 'utf8'));
const FILES = readdirSync(fileURLToPath(DIR)).filter((f) => f.endsWith('.json'));

test('служебные слова не показываются: ни id, ни «Идентификатор» в ошибках и сводках', () => {
  for (const f of FILES) {
    const ui = load(f).ui;
    for (const k of ['errTeacherDup', 'errSubjectId', 'errSubjectDup', 'errSubjectTeacher', 'presetDrift', 'summaryLine']) {
      assert.ok(ui[k], `${f}: нет ${k}`);
      assert.doesNotMatch(ui[k], /Идентификатор|\{id\}|\{teacherId\}|\{presetId\}/, `${f}/${k}: ${ui[k]}`);
    }
  }
  for (const k of ['errTeacherDup', 'errSubjectId', 'errSubjectDup', 'errSubjectTeacher', 'summaryLine']) {
    assert.doesNotMatch(DEFAULT_UI[k], /Идентификатор|\{id\}|\{teacherId\}|\{presetId\}/, k);
  }
});

test('пресеты без иероглифов, а {term} в уставе не склеен с окончанием', () => {
  for (const f of FILES) {
    const raw = readFileSync(fileURLToPath(new URL(f, DIR)), 'utf8');
    assert.doesNotMatch(raw, /[぀-ヿ一-鿿]/, `${f}: иероглифы`);
    assert.doesNotMatch(raw, /{(term|period)}[а-яё]/i, `${f}: суффикс приклеен к термину`);
  }
});

test('скобки не живут в названии оценки: «{score}: {value}» читается', () => {
  for (const f of FILES) {
    const p = load(f);
    assert.doesNotMatch(p.vocab.score, /[()]/, `${f}: скобки в vocab.score`);
  }
});

test('название контрольных заменяет иностранное, а освобождение не привязано к полу учителя', () => {
  const raw = FILES.map((f) => readFileSync(fileURLToPath(new URL(f, DIR)), 'utf8')).join('\n');
  assert.doesNotMatch(raw, /\{teacher\} освободил/);
});

test('склонение «дней»: 1, 2, 5', () => {
  const w = (n) => `${n} ${plural(n, 'день', 'дня', 'дней')}`;
  assert.deepEqual([1, 2, 5, 11, 22].map(w), ['1 день', '2 дня', '5 дней', '11 дней', '22 дня']);
});

test('подсказка про начало года во всех пресетах говорит про переезд календаря', () => {
  for (const f of FILES) {
    assert.match(load(f).ui.startDayFromPreset, /два ответа подряд/, f);
  }
  assert.match(DEFAULT_UI.startDayFromPreset, /два ответа подряд/);
});

// test/owner-texts-1010 — текстовые решения владелицы O1–O11 (design-mockup/full/bugs-package.md,
// раздел 2): «Слухи», единые термины, ярлыки отношений, шкала, переводы, слова мира.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { resolveGrade } from '../core/gradebook.mjs';
import { classmateSeeds } from '../core/classmates.mjs';
import { uiLabels } from '../ui.js';

const raw = (id) => readFileSync(new URL(`../presets/${id}.json`, import.meta.url), 'utf8');
const load = (id) => JSON.parse(raw(id));
const IDS = readdirSync(new URL('../presets/', import.meta.url)).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));

const TEACHER = ['не терпит', 'недолюбливает', 'сомневается', 'не выделяет', 'одобряет', 'доверяет', 'покровительствует'];
const MATE = ['враждует', 'недолюбливает', 'сторонится', 'не выделяет', 'привечает', 'дружит', 'дорожит'];

/** Слова каркаса по порядку; у шкалы короче семи ступеней часть слов выпадает, порядок сохраняется. */
function isOrderedSubset(labels, frame) {
  let at = -1;
  return labels.every((l) => {
    at = frame.indexOf(l.label, at + 1);
    return at >= 0;
  });
}

test('вкладка ленты: одно слово на сеттинг, «Слухи» как общее имя', () => {
  const want = {
    'cadet-academy': 'Казарма', 'cn-highschool': 'Слухи', 'dark-academia': 'Пересуды', 'hero-academy': 'Слухи',
    'jp-highschool': 'Шепотки', 'magic-academy': 'Шепотки', 'ru-school': 'Сплетни', 'ru-university': 'Болтовня',
    'space-academy': 'Эфир', 'us-college': 'Кампус', 'us-highschool': 'Сплетни', 'xianxia-sect': 'Пересуды',
  };
  assert.deepEqual(IDS.sort(), Object.keys(want).sort());
  for (const id of IDS) assert.equal(load(id).ui.tabFeed, want[id], id);
  assert.equal(uiLabels(null).tabFeed, 'Слухи');
});

test('«молва» осталась только в идентификаторах', () => {
  for (const id of IDS) assert.doesNotMatch(raw(id), /молв/i, id);
});

test('ярлыки отношений: каркас от минуса к плюсу, без родовых слов', () => {
  for (const id of IDS) {
    const p = load(id);
    assert.ok(isOrderedSubset(p.relations.labels, TEACHER), `${id}: ${p.relations.labels.map((l) => l.label).join(' → ')}`);
    assert.ok(isOrderedSubset(p.classmates.labels, MATE), `${id}: ${p.classmates.labels.map((l) => l.label).join(' → ')}`);
    for (const l of [...p.relations.labels, ...p.classmates.labels]) {
      assert.doesNotMatch(l.label, /любим|избранниц|протеже|ровно/, `${id}: «${l.label}»`);
    }
  }
});

test('единый термин долга: слово vocab.debt живёт в ярлыках, вехах и подсказках пресета', () => {
  const want = {
    'hero-academy': 'незачёт', 'magic-academy': 'учебный долг', 'xianxia-sect': 'долг по испытанию',
    'jp-highschool': 'незачёт', 'us-college': 'незакрытый предмет', 'us-highschool': 'незакрытый предмет',
    'cn-highschool': 'незачёт',
  };
  for (const [id, word] of Object.entries(want)) {
    const p = load(id);
    assert.equal(p.vocab.debt, word, id);
    assert.equal(p.ui.debtTag, word, id);
    assert.ok(p.ui.debtsTitle.toLowerCase().startsWith(word.split(' ')[0].slice(0, 5)), `${id}: ${p.ui.debtsTitle}`);
  }
  assert.doesNotMatch(raw('hero-academy'), /Пробел|— пробел|"пробел"/);
  assert.doesNotMatch(raw('magic-academy'), /[Пп]рореха|[Пп]рорехи|прореху/);
  assert.doesNotMatch(raw('xianxia-sect'), /[Ии]зъян/);
  assert.doesNotMatch(raw('jp-highschool'), /Красные баллы|Красный балл|красному баллу|"красные баллы"/);
});

test('испытательный срок — один статус в американских пресетах', () => {
  for (const id of ['us-college', 'us-highschool']) {
    const p = load(id);
    assert.equal(p.vocab.warning, 'испытательный срок', id);
    assert.equal(p.ui.warnedTag, 'испытательный срок', id);
    assert.match(p.ui.warnedLine, /^Испытательный срок: нужно подтянуть успеваемость/, id);
    assert.ok(p.reputation.labels.some((l) => l.label === 'на испытательном сроке'), id);
    assert.equal(p.phrases.milestones.onTheEdge, 'На испытательном сроке', id);
    assert.doesNotMatch(raw(id), /академический испытательный/, id);
  }
});

test('шкала: полный балл cn показывается как 100; у magic один «Триумф» и одна пересдача', () => {
  const cn = load('cn-highschool');
  assert.equal(resolveGrade(cn, '100').value, '100');
  assert.equal(resolveGrade(cn, '100').points, 100);
  assert.equal(resolveGrade(cn, '95').value, '95');
  assert.equal(resolveGrade(cn, '90').value, '95', 'прочие круглые числа по-прежнему сводятся к ступеням');

  const magic = load('magic-academy');
  const tens = magic.grades.values.filter((g) => g.points === 10);
  assert.deepEqual(tens.map((g) => g.label), ['триумф']);
  assert.equal(resolveGrade(magic, 'признание мастера').value, 'триумф', 'старое слово остаётся псевдонимом');
  assert.equal(magic.exams.retakes, 1);
});

test('состав: заготовок больше активных, типажи ленты не повторяют заготовки', () => {
  for (const id of ['cadet-academy', 'space-academy']) {
    const p = load(id);
    const seeds = classmateSeeds(p);
    assert.equal(p.classmates.size, 6, id);
    assert.equal(seeds.length, 7, id);
    for (const t of p.feed.extras) assert.ok(!seeds.includes(t), `${id}: типаж «${t}» дословно совпал с заготовкой`);
    assert.ok(!p.feed.extras.includes('тихий навигатор') && !p.feed.extras.includes('карьерист'), id);
  }
});

test('переводы O10: книга мира, средний балл, триместры, последний день занятий', () => {
  for (const id of IDS) {
    const t = raw(id);
    assert.doesNotMatch(t, /Лорбук академии|лорбук академии|Лорбук Академии/, id);
    assert.doesNotMatch(t, /GPA/, id);
    assert.doesNotMatch(t, /уходят в World Info,/, id);
  }
  for (const id of ['cadet-academy', 'hero-academy', 'space-academy', 'magic-academy']) {
    assert.match(load(id).ui.lorebookSection, /^Книга мира/, id);
  }
  assert.equal(load('us-high' + 'school').vocab.score, 'средний балл');
  assert.equal(load('us-college').vocab.score, 'средний балл');
  assert.deepEqual(load('dark-academia').calendar.terms.map((x) => x.name), ['Осенний триместр', 'Зимний триместр', 'Весенний триместр']);
  const uni = load('ru-university');
  assert.ok(uni.holidays.some((h) => h.name === 'Последний день занятий'));
  assert.doesNotMatch(raw('ru-university'), /Последний звонок/);
});

test('слова мира O11: рейтинг популярности, перерыв между кругами, Двенадцатая ночь', () => {
  assert.doesNotMatch(raw('hero-academy'), /желанных героев/);
  assert.match(raw('hero-academy'), /рейтинг популярности героев/);
  assert.doesNotMatch(raw('magic-academy'), /[Зз]атвор/);
  assert.equal(load('magic-academy').ui.silentVacation, 'Перерыв между кругами — занятий нет.');
  assert.ok(load('dark-academia').holidays.some((h) => h.name === 'Двенадцатая ночь'));
  assert.doesNotMatch(raw('dark-academia'), /Крещенская ночь/);
});

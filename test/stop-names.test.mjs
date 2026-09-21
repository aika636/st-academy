// test/stop-names — стоп-лист имён (9.3.6): кого не считать ни наставником, ни
// кандидатом в «Люди». Чистые функции `core/stop-names.mjs`; то, как список
// защищает `rel=`, проверяется в `test/rel-marker.test.mjs`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  stopList, stopHit, filterPeople, normName,
  STOP_USER, STOP_CHAR, STOP_INSTITUTION, STOP_PRESET,
} from '../core/stop-names.mjs';

const load = (f) => JSON.parse(readFileSync(new URL(`../presets/${f}`, import.meta.url), 'utf8'));
const ru = load('ru-university.json');

const list = (extra = {}) => stopList({
  user: 'Алиса Воронова',
  char: 'Рассказчик Академии',
  preset: ru,
  survey: { institution: 'Академия Звёздного Света' },
  ...extra,
});

test('в стоп-листе героиня, карточка, заведение из анкеты и пресета, слова пресета', () => {
  const s = list();
  const kinds = (kind) => s.filter((x) => x.kind === kind).map((x) => x.name);
  assert.deepEqual(kinds(STOP_USER), ['Алиса Воронова']);
  assert.deepEqual(kinds(STOP_CHAR), ['Рассказчик Академии']);
  assert.deepEqual(kinds(STOP_INSTITUTION), ['Академия Звёздного Света', ru.displayName]);
  assert.deepEqual(kinds(STOP_PRESET), ru.stopNames);
});

test('пустые имена и неподставленные макросы в список не попадают', () => {
  const s = stopList({ user: '', char: '{{char}}', survey: { institution: '   ' } });
  assert.deepEqual(s, []);
  // Пустой стоп-лист не запрещает ничего — в том числе пустую строку.
  assert.equal(stopHit('', s), null);
  assert.equal(stopHit('Петрова', s), null);
});

test('полное совпадение ловится без учёта регистра, ё и подчёркиваний', () => {
  const s = list();
  assert.equal(stopHit('алиса_воронова', s).kind, STOP_USER);
  assert.equal(stopHit('АКАДЕМИЯ ЗВЕЗДНОГО СВЕТА', s).kind, STOP_INSTITUTION);
  assert.equal(stopHit('narrator', s).kind, STOP_PRESET);
});

test('часть стоп-имени — совпадение: героиню пишут то по имени, то по фамилии', () => {
  const s = list();
  assert.equal(stopHit('Алиса', s).kind, STOP_USER);
  assert.equal(stopHit('воронова', s).kind, STOP_USER);
});

test('обратное не работает: у преподавательницы с именем героини есть чужие слова', () => {
  const s = stopList({ user: 'Анна' });
  assert.equal(stopHit('Анна', s).kind, STOP_USER);
  assert.equal(stopHit('Анна Сергеевна Петрова', s), null);
  assert.equal(stopHit('Петрова', s), null);
});

test('короткие куски имени не считаются частью: «Ли» не запрещает всех «ли»', () => {
  const s = stopList({ user: 'Ли Мэй' });
  assert.equal(stopHit('Ли', s), null, 'два знака — не часть имени');
  assert.equal(stopHit('Мэй', s).kind, STOP_USER);
  assert.equal(stopHit('Ли Мэй', s).kind, STOP_USER, 'полное совпадение — на любой длине');
});

test('из нескольких совпадений побеждает самое строгое: героиня старше карточки', () => {
  const s = stopList({ user: 'Петрова', char: 'Петрова' });
  assert.equal(stopHit('Петрова', s).kind, STOP_USER);
});

test('stopHit принимает и сырой вход, и список строк', () => {
  assert.equal(stopHit('Алиса', { user: 'Алиса' }).kind, STOP_USER);
  assert.equal(stopHit('деканат', ['Деканат']).kind, STOP_PRESET);
  assert.equal(stopHit('Алиса', null), null);
});

test('filterPeople: кандидаты из стоп-листа выпадают, включая карточку', () => {
  const s = list({ char: 'Рассказчик' });
  const { kept, dropped } = filterPeople([
    { id: 'petrova', name: 'Петрова Анна' },
    { id: 'narr', name: 'Рассказчик' },
    { id: 'alisa', name: 'Алиса' },
    { id: 'dean', name: 'Деканат' },
  ], s);
  assert.deepEqual(kept.map((x) => x.id), ['petrova']);
  assert.deepEqual(dropped.map((x) => [x.item.id, x.hit.kind]), [
    ['narr', STOP_PRESET], // «рассказчик» — ещё и слово пресета, оно строже карточки
    ['alisa', STOP_USER],
    ['dean', STOP_PRESET],
  ]);
});

test('filterPeople: подтверждённый наставник-карточка остаётся, героиня — нет', () => {
  // Чат «один на один с Петровой»: карточка и есть преподавательница.
  const s = stopList({ user: 'Алиса', char: 'Петрова Анна' });
  const people = [{ id: 'petrova', name: 'Петрова Анна' }, { id: 'alisa', name: 'Алиса' }];

  const asCandidates = filterPeople(people, s);
  assert.deepEqual(asCandidates.kept, [], 'кандидат-карточка отсеивается');

  const confirmed = filterPeople(people, s, { keep: ['petrova', 'alisa'] });
  assert.deepEqual(confirmed.kept.map((x) => x.id), ['petrova']);
  assert.deepEqual(confirmed.dropped.map((x) => x.item.id), ['alisa'], 'героиню не спасает и таблица');
});

test('filterPeople смотрит и на id, и на свой способ назвать кандидата', () => {
  const s = stopList({ user: 'Alice' });
  assert.equal(filterPeople([{ id: 'alice', name: 'Новенькая' }], s).kept.length, 0, 'по id');
  const strings = filterPeople(['Alice', 'Bob'], s);
  assert.deepEqual(strings.kept, ['Bob'], 'список строк');
  const custom = filterPeople([{ who: 'Alice' }], s, { namesOf: (x) => [x.who] });
  assert.equal(custom.kept.length, 0);
});

test('normName: дефис, точка и кавычки — разделители слов', () => {
  assert.equal(normName('«Анна-Мария» Ёлкина.'), 'анна мария елкина');
  assert.equal(normName('А.Петрова'), 'а петрова');
});

test('у каждого встроенного пресета стоп-слова есть, и среди них нет наставника по должности', () => {
  for (const f of ['ru-university.json', 'jp-highschool.json', 'magic-academy.json']) {
    const p = load(f);
    assert.ok(Array.isArray(p.stopNames) && p.stopNames.length, `${p.id}: нет stopNames`);
    // Слово должности не должно запрещать самого наставника: «Преподаватель
    // Петрова» — это человек, и выпасть из «Людей» ему не за что.
    assert.equal(stopHit(p.vocab.teacher, stopList({ preset: p })), null, `${p.id}: «${p.vocab.teacher}» в стоп-листе`);
  }
});

// test/holidays-floating — праздники с плавающей датой (`lunar`, `weekday`, `days`),
// лунная таблица (`core/lunar.mjs`) и подсказки ⓘ к словам мира (`glossary`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { lunarToSolar, lunarYearKnown } from '../core/lunar.mjs';
import { holidaysOn, holidaysAhead, holidaysOf, holidayEnd } from '../core/holidays.mjs';
import { isVacation, holidaySpan } from '../core/time.mjs';
import { normalizePreset } from '../core/preset.mjs';
import { glossaryHint } from '../ui/common.js';

const load = (id) => JSON.parse(
  readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'),
);
const ru = load('ru-university');
const cn = load('cn-highschool');
const xian = load('xianxia-sect');
const us = load('us-highschool');
const names = (preset, day, state = null) => holidaysOn(preset, day, state).map((h) => h.id);

test('лунная таблица: известные даты китайских праздников сходятся', () => {
  const known = [
    [2023, 1, 1, '2023-01-22'], [2024, 1, 1, '2024-02-10'], [2025, 1, 1, '2025-01-29'], [2026, 1, 1, '2026-02-17'],
    [2023, 8, 15, '2023-09-29'], [2024, 8, 15, '2024-09-17'], [2025, 8, 15, '2025-10-06'], [2026, 8, 15, '2026-09-25'],
    [2024, 5, 5, '2024-06-10'], [2025, 5, 5, '2025-05-31'],
    [2024, 7, 7, '2024-08-10'], [2025, 7, 7, '2025-08-29'],
    [2024, 9, 9, '2024-10-11'], [2025, 9, 9, '2025-10-29'],
    // Високосный месяц не сбивает счёт: в 2023 году был високосный второй месяц.
    [2023, 5, 5, '2023-06-22'], [2023, 7, 7, '2023-08-22'],
    // Края таблицы.
    [1900, 1, 1, '1900-01-31'], [2100, 1, 1, '2100-02-09'],
  ];
  for (const [y, m, d, solar] of known) assert.equal(lunarToSolar(y, m, d), solar, `${y} ${m}-${d}`);
});

test('лунная таблица: вне таблицы и несуществующий день — null', () => {
  assert.equal(lunarYearKnown(1248), false);
  assert.equal(lunarToSolar(1248, 1, 1), null);
  assert.equal(lunarToSolar(2101, 1, 1), null);
  assert.equal(lunarToSolar(2024, 13, 1), null);
  assert.equal(lunarToSolar(2024, 1, 31), null);
});

test('лунная таблица: Новый год из Intl, где ICU и таблица не спорят о полуночи', { skip: typeof Intl === 'undefined' }, () => {
  const fmt = new Intl.DateTimeFormat('en-u-ca-chinese', { timeZone: 'UTC', month: 'numeric', day: 'numeric' });
  let same = 0;
  for (let y = 1950; y <= 2050; y += 1) {
    const solar = lunarToSolar(y, 1, 1);
    const p = Object.fromEntries(fmt.formatToParts(new Date(`${solar}T00:00:00Z`)).map((x) => [x.type, x.value]));
    if (p.month === '1' && p.day === '1') same += 1;
  }
  // ICU считает границы суток по своему времени; расходится не больше чем в паре лет из ста.
  assert.ok(same >= 97, `совпало ${same} из 101`);
});

test('cn: Праздник весны идёт восемь дней от лунного Нового года', () => {
  assert.deepEqual(names(cn, '2024-02-09').includes('spring-festival'), false);
  for (const day of ['2024-02-10', '2024-02-17']) assert.ok(names(cn, day).includes('spring-festival'), day);
  assert.equal(names(cn, '2024-02-18').includes('spring-festival'), false);
  // В 2025 году он сдвинулся: 29 января.
  assert.ok(names(cn, '2025-01-29').includes('spring-festival'));
  assert.equal(names(cn, '2025-02-10').includes('spring-festival'), false);
  assert.equal(holidayEnd(holidaysOn(cn, '2025-01-30').find((h) => h.id === 'spring-festival'), '2025-01-30'), '2025-02-05');
});

test('cn и xianxia: лунные праздники по годам', () => {
  assert.ok(names(cn, '2024-09-17').includes('mid-autumn'));
  assert.ok(names(cn, '2025-10-06').includes('mid-autumn'));
  assert.equal(names(cn, '2025-09-17').includes('mid-autumn'), false);
  assert.ok(names(xian, '2025-10-29').includes('chongyang'));
  assert.ok(names(xian, '2024-06-10').includes('dragon-boat'));
  assert.ok(names(xian, '2025-05-31').includes('dragon-boat'));
  assert.deepEqual(['2024-02-10', '2024-02-12'].map((d) => names(xian, d).includes('spring-festival')), [true, true]);
  assert.equal(names(xian, '2024-02-13').includes('spring-festival'), false);
});

test('вымышленный год вне таблицы: запасная фиксированная дата from', () => {
  assert.ok(names(cn, '1248-09-17').includes('mid-autumn'));
  assert.equal(names(cn, '1248-09-18').includes('mid-autumn'), false);
  assert.ok(names(cn, '1248-02-17').includes('spring-festival'));
  assert.equal(names(cn, '1248-02-18').includes('spring-festival'), false);
});

test('holidaysAhead видит плавающие праздники и не дублирует идущие', () => {
  const ahead = holidaysAhead(cn, '2025-09-30', 14).filter((a) => a.holiday.id === 'mid-autumn');
  assert.deepEqual(ahead.map((a) => [a.day, a.days]), [['2025-10-06', 6]]);
  assert.deepEqual(holidaysAhead(cn, '2025-10-06', 14).filter((a) => a.holiday.id === 'mid-autumn'), []);
  const wk = holidaysAhead(us, '2025-10-05', 14).filter((a) => a.holiday.id === 'homecoming');
  assert.deepEqual(wk.map((a) => a.day), ['2025-10-11']);
});

test('isVacation: лунный праздник с off гасит занятия, а не только фиксированный', () => {
  const p = { calendar: { vacations: [] }, holidays: [{ id: 'x', name: 'Х', from: '09-17', lunar: '08-15', days: 2, off: true }] };
  assert.equal(isVacation(p, '2025-10-06'), true);
  assert.equal(isVacation(p, '2025-10-07'), true);
  assert.equal(isVacation(p, '2025-10-08'), false);
  assert.equal(isVacation(p, '2025-09-17'), false);
  assert.equal(isVacation(p, '1248-09-17'), true);
});

test('us: Homecoming и Prom выпадают на субботу своей недели', () => {
  assert.ok(names(us, '2025-10-11').includes('homecoming'));
  assert.equal(names(us, '2025-10-10').includes('homecoming'), false);
  // 2026: from 10-11 — воскресенье, неделя пн–вс кончается им, суббота — 10-10.
  assert.ok(names(us, '2026-10-10').includes('homecoming'));
  assert.equal(names(us, '2026-10-11').includes('homecoming'), false);
  assert.ok(names(us, '2026-05-09').includes('prom'));
  assert.ok(names(us, '2027-05-08').includes('prom'));
  assert.equal(names(us, '2027-05-09').includes('prom'), false);
});

test('weekday учитывает сдвиг дней недели чата', () => {
  // Сдвиг на +1: григорианская суббота зовётся воскресеньем, значит «суббота» чата — пятница.
  const state = { calendar: { weekdayShift: 1 } };
  const h = us.holidays.find((x) => x.id === 'homecoming');
  assert.equal(holidaySpan(h, 2025, state).from, '2025-10-10');
  assert.ok(names(us, '2025-10-10', state).includes('homecoming'));
  assert.equal(names(us, '2025-10-11', state).includes('homecoming'), false);
});

test('hero: ханами — неделя в конце марта', () => {
  const hero = load('hero-academy');
  for (const day of ['2025-03-28', '2025-04-03']) assert.ok(names(hero, day).includes('hanami'), day);
  assert.equal(names(hero, '2025-04-04').includes('hanami'), false);
  assert.equal(names(hero, '2025-03-27').includes('hanami'), false);
});

test('cn: День молодёжи внутри майских каникул — двойной выходной ничего не ломает', () => {
  const ids = names(cn, '2025-05-04');
  assert.ok(ids.includes('youth-day'));
  assert.equal(isVacation(cn, '2025-05-04'), true);
  assert.equal(holidaysOn(cn, '2025-05-04').length >= 2, true);
});

test('holidaysOf несёт плавающие поля только там, где они есть', () => {
  const list = holidaysOf(cn);
  const sf = list.find((h) => h.id === 'spring-festival');
  assert.equal(sf.lunar, '01-01');
  assert.equal(sf.days, 8);
  assert.equal(list.find((h) => h.id === 'new-year').lunar, undefined);
});

test('валидация: битые lunar, weekday, days и glossary — претензии', () => {
  const bad = (patch) => normalizePreset({ ...ru, ...patch }, { builtins: { 'ru-university': ru } });
  const h = (extra) => ({ holidays: [{ name: 'Х', from: '01-01', ...extra }] });
  assert.equal(bad(h({ lunar: '13-01' })).ok, false);
  assert.equal(bad(h({ lunar: '01-31' })).ok, false);
  assert.equal(bad(h({ weekday: 'funday' })).ok, false);
  assert.equal(bad(h({ days: 0 })).ok, false);
  assert.equal(bad(h({ days: 99 })).ok, false);
  assert.equal(bad(h({ lunar: '08-15', days: 3, weekday: 'sat' })).ok, true);
  assert.equal(bad({ glossary: ['x'] }).ok, false);
  assert.equal(bad({ glossary: { слово: '' } }).ok, false);
  assert.equal(bad({ glossary: { слово: 5 } }).ok, false);
  assert.equal(bad({ glossary: { слово: 'Пояснение.' } }).ok, true);
});

test('glossaryHint: слово из интерфейса, регистр и ё не важны, длинный ключ побеждает', () => {
  const p = { glossary: { седмица: 'Неделя.', круг: 'Период.', 'Перерыв между кругами': 'Каникулы.', Ёлка: 'Дерево.' } };
  assert.deepEqual(glossaryHint(p, '3-я седмица круга'), { term: 'седмица', text: 'Неделя.' });
  assert.equal(glossaryHint(p, 'Перерыв между кругами').text, 'Каникулы.');
  assert.equal(glossaryHint(p, 'ёлка во дворе').text, 'Дерево.');
  assert.equal(glossaryHint(p, 'обычный день'), null);
  assert.equal(glossaryHint(p, '', null, 'Круг 2').text, 'Период.');
  assert.equal(glossaryHint({}, 'седмица'), null);
});

test('пресеты: подсказки заполнены у сеттинговых миров и проходят проверку', () => {
  for (const id of ['magic-academy', 'xianxia-sect', 'hero-academy', 'dark-academia']) {
    const g = load(id).glossary;
    assert.ok(g && Object.keys(g).length >= 2, id);
  }
  assert.equal(glossaryHint(load('magic-academy'), '5-я седмица круга').term, 'седмица');
  assert.equal(glossaryHint(xian, 'Великое испытание').text, 'Итоговое испытание секты.');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseContext, cleanForScan } from '../core/parse-context.mjs';

// --- снятие HTML -----------------------------------------------------------

test('cleanForScan: теги снимаются, текст внутри остаётся', () => {
  const mes = '<div style="font-size:13px"><b>Четверг, 19 октября 2023</b> | 🕰 <b>20:45</b></div>';
  const out = cleanForScan(mes);
  assert.match(out, /Четверг, 19 октября 2023/);
  assert.match(out, /20:45/);
  assert.doesNotMatch(out, /font-size|div|<b>/);
});

test('ловушка: line-height:1.3 и padding:0.05 не становятся часами', () => {
  // На этом споткнулась первая версия scan-time.mjs: инлайновый CSS в атрибуте
  // дал фальшивые 47% сообщений с «часами» вместо настоящих 42%.
  const mes = '<div style="line-height:1.3;padding:0.05">Она молчала.</div>';
  assert.doesNotMatch(cleanForScan(mes), /1\.3|0\.05/);
  assert.equal(parseContext(mes), null);
});

test('cleanForScan: think/reasoning/CoD выбрасываются, memo остаётся', () => {
  const mes = '<think>Сейчас 03:00, но писать не буду</think>\n'
    + '<memo>📅 Пятница, 12 мая 2023 | 🕰 09:15</memo>';
  const out = cleanForScan(mes);
  assert.doesNotMatch(out, /03:00|писать не буду/);
  assert.match(out, /12 мая 2023/);

  const r = parseContext(mes);
  assert.equal(r.day, '2023-05-12');
  assert.equal(r.time, '09:15');
});

test('cleanForScan: HTML-комментарий выброшен вместе с нашей меткой', () => {
  const mes = 'Пост.\n<!-- [ACADEMY t=+1] -->';
  assert.doesNotMatch(cleanForScan(mes), /ACADEMY/);
});

// --- словарь замера A, дословно --------------------------------------------

test('📅 Четверг, 19 октября 2023 | 🕰 20:45', () => {
  const r = parseContext('📅 Четверг, 19 октября 2023 | 🕰 20:45\n\nОна вошла.');
  assert.equal(r.day, '2023-10-19');
  assert.equal(r.time, '20:45');
  assert.equal(r.weekday, 4);
  assert.equal(r.source, 'header');
});

test('📅 СБ, 18 мая 2024 | — сокращение перед датой', () => {
  const r = parseContext('📅 СБ, 18 мая 2024 |');
  assert.equal(r.day, '2024-05-18');
  assert.equal(r.weekday, 6);
});

test('📅 ПН, 20 января 2025 |', () => {
  const r = parseContext('📅 ПН, 20 января 2025 |');
  assert.equal(r.day, '2025-01-20');
  assert.equal(r.weekday, 1);
});

test('📅 Дата: Пт, 12 Окт 2024 — сокращённый месяц', () => {
  const r = parseContext('📅 Дата: Пт, 12 Окт 2024');
  assert.equal(r.day, '2024-10-12');
  assert.equal(r.weekday, 5);
});

test('📅 Сб, 16 Мар 2024 |', () => {
  const r = parseContext('📅 Сб, 16 Мар 2024 |');
  assert.equal(r.day, '2024-03-16');
});

test('📅 Будний день и 📅 неизвестно — дата не названа, ничего не выдумываем', () => {
  assert.equal(parseContext('📅 Будний день |\n\nОна шла по коридору.'), null);
  assert.equal(parseContext('📅 неизвестно |'), null);
});

test('🕰 Вечер — часть суток вместо часов', () => {
  const r = parseContext('🕰 Вечер |');
  assert.equal(r.time, null);
  assert.equal(r.day, null);
  assert.equal(r.daypart, 'evening');
});

test('ВРЕМЯ: 00:07 и Время: 21:35', () => {
  assert.equal(parseContext('ВРЕМЯ: 00:07').time, '00:07');
  assert.equal(parseContext('Время: 21:35').time, '21:35');
  assert.equal(parseContext('🕰 20:45').time, '20:45');
});

test('17:30 (5:30 PM) — две записи одного времени, берётся первая', () => {
  const r = parseContext('Время: 17:30 (5:30 PM)');
  assert.equal(r.time, '17:30');
});

test('Timezone: ⏰ 8:42 AM | 🗓️ Sat 15 Jun 2024 | Summer', () => {
  const r = parseContext('Timezone: ⏰ 8:42 AM | 🗓️ Sat 15 Jun 2024 | Summer');
  assert.equal(r.time, '08:42');
  assert.equal(r.day, '2024-06-15');
  assert.equal(r.weekday, 6);
});

test('am/pm: вечернее время переводится в 24 часа', () => {
  assert.equal(parseContext('Time: 8:42 PM').time, '20:42');
  assert.equal(parseContext('Time: 12:05 AM').time, '00:05');
  assert.equal(parseContext('Time: 12:05 PM').time, '12:05');
  assert.equal(parseContext('Time: 7 PM').time, '19:00');
});

test('ДАТА: 20.01.2025 — единственный случай даты цифрами', () => {
  const r = parseContext('ДАТА: 20.01.2025');
  assert.equal(r.day, '2025-01-20');
});

test('английская шапка: Thursday, October 19, 2023 — 8:15 AM', () => {
  const r = parseContext('📅 Thursday, October 19, 2023 | ⏰ 8:15 AM');
  assert.equal(r.day, '2023-10-19');
  assert.equal(r.time, '08:15');
  assert.equal(r.weekday, 4);
});

test('русские месяцы полностью и сокращением, любой регистр', () => {
  for (const [line, day] of [
    ['📅 1 ЯНВАРЯ 2024', '2024-01-01'],
    ['📅 3 фев 2024', '2024-02-03'],
    ['📅 7 марта 2024', '2024-03-07'],
    ['📅 9 Апр 2024', '2024-04-09'],
    ['📅 30 мая 2024', '2024-05-30'],
    ['📅 2 июня 2024', '2024-06-02'],
    ['📅 4 июля 2024', '2024-07-04'],
    ['📅 6 Авг 2024', '2024-08-06'],
    ['📅 8 сентября 2024', '2024-09-08'],
    ['📅 10 ноя 2024', '2024-11-10'],
    ['📅 31 декабря 2024', '2024-12-31'],
  ]) {
    assert.equal(parseContext(line).day, day, line);
  }
});

// --- год ------------------------------------------------------------------

test('дата без года: day=null, разобранное уезжает в dateParts', () => {
  const r = parseContext('📅 Пятница, 12 сентября | 🕰 08:40');
  assert.equal(r.day, null);
  assert.deepEqual(r.dateParts, { year: null, month: 9, day: 12 });
  assert.equal(r.time, '08:40');
});

test('opts.year подставляет год вызывающего', () => {
  const r = parseContext('📅 Пятница, 12 сентября | 🕰 08:40', { year: 2024 });
  assert.equal(r.day, '2024-09-12');
});

// --- приоритет разбора (правка 3.2 замера A) -------------------------------

test('приоритет 1: шапка в первых трёх строках важнее часов в прозе', () => {
  const mes = [
    '📅 Понедельник, 20 января 2025 | 🕰 08:40',
    '',
    'Она вспомнила, что в 23:00 обещала позвонить.',
  ].join('\n');
  const r = parseContext(mes);
  assert.equal(r.source, 'header');
  assert.equal(r.time, '08:40');
  assert.equal(r.day, '2025-01-20');
});

test('приоритет 2: дата и часы рядом в одной строке в середине поста', () => {
  const mes = [
    'Она шла по коридору и думала о вчерашнем разговоре с Петровой, который',
    'закончился ничем и оставил после себя только усталость и лёгкую злость.',
    'На доске объявлений висело: пересдача 14 марта 2024, 15:40, ауд. 312.',
    'Она сфотографировала объявление и пошла дальше по своим делам, не спеша.',
    'Коридор был пуст, и это было хорошо: разговаривать ни с кем не хотелось.',
  ].join('\n');
  const r = parseContext(mes);
  assert.equal(r.source, 'line');
  assert.equal(r.day, '2024-03-14');
  assert.equal(r.time, '15:40');
});

test('приоритет 3: одинокие часы берутся только с краю и в короткой строке', () => {
  const short = ['Утро.', '08:40.', 'Она опоздала.'].join('\n');
  const rs = parseContext(short);
  assert.equal(rs.time, '08:40');
  assert.equal(rs.source, 'edge');

  // те же часы в середине длинной прозы не берутся: правило 3 отрезает середину
  const long = [
    'Первая строка без всякого времени, просто чтобы отодвинуть середину поста.',
    'Вторая строка, тоже без времени, длинная и ничем не примечательная совсем.',
    'Третья строка, длиной заметно больше восьмидесяти символов, и где-то в ней в 08:40 упомянуто время.',
    'Четвёртая строка, снова длинная и снова совершенно без всякого времени тут.',
    'Пятая строка, последняя, и она тоже длинная, чтобы не считаться короткой.',
  ].join('\n');
  assert.equal(parseContext(long), null);
});

test('приоритет 4: часть суток не двигает календарь, а уточняет daypart', () => {
  const mes = 'Она проснулась поздним утром и долго не могла заставить себя встать с кровати.';
  const r = parseContext(mes);
  assert.equal(r.source, 'daypart');
  assert.equal(r.daypart, 'morning');
  assert.equal(r.day, null);
  assert.equal(r.time, null);
});

test('приоритет 5: относительные сдвиги выключены по умолчанию', () => {
  const mes = 'Договорились встретиться, и она ушла. Через два дня всё изменилось.';
  assert.equal(parseContext(mes), null);
  const r = parseContext(mes, { relative: true });
  assert.equal(r.source, 'relative');
  assert.deepEqual(r.relative, { unit: 'day', n: 2 });
});

test('относительные сдвиги: словарь при включённой галочке', () => {
  const cases = [
    ['Через час она вернулась.', { unit: 'hour', n: 1 }],
    ['Через несколько минут дверь открылась.', { unit: 'minute', n: 2 }],
    ['На следующий день всё повторилось.', { unit: 'day', n: 1 }],
    ['Наутро она проснулась разбитой.', { unit: 'day', n: 1 }],
    ['На следующей неделе будет пересдача.', { unit: 'week', n: 1 }],
    ['Спустя три года они снова встретились.', { unit: 'year', n: 3 }],
    ['После пар она осталась в аудитории.', { unit: 'period', n: 1 }],
  ];
  for (const [text, rel] of cases) {
    const r = parseContext(text, { relative: true });
    assert.ok(r, text);
    assert.deepEqual(r.relative, rel, text);
  }
});

// --- ловушки замера A ------------------------------------------------------

test('ловушка: «среди», «среднего», «средних» — не среда', () => {
  for (const w of ['среди', 'среднего', 'средних', 'средиземноморье']) {
    // строка с эмодзи, то есть шапка: если бы «сред» ловилось основой, день
    // недели встал бы прямо здесь
    assert.equal(parseContext(`📅 Она стояла ${w} чужих людей и молчала.`), null, w);
  }
  assert.equal(parseContext('📅 Среда, 20 марта 2024').weekday, 3);
});

test('ловушка: «закатились», «классический», «через пару минут»', () => {
  assert.equal(parseContext('Её глаза закатились от скуки.'), null);
  assert.equal(parseContext('Он играл классический этюд.'), null);
  assert.equal(parseContext('Через пару минут она вернулась.'), null);
});

test('ловушка: «ср» и «вс» в свободном тексте не день недели', () => {
  const r = parseContext('📅 Вс 15 человек ждали в коридоре, ср. с прошлым разом.');
  // сокращение ловится только вплотную перед датой, а «15 человек» датой не является
  assert.equal(r, null);
});

test('дата цифрами без года — только в шапке, не в прозе', () => {
  assert.equal(parseContext('📅 12.09 | 🕰 08:40', { year: 2024 }).day, '2024-09-12');
  // в прозе «3.05» это что угодно, чаще всего балл, и датой считаться не должно
  assert.equal(parseContext('У неё средний балл 3.05 и это ещё не приговор.'), null);
});

// --- остаточное: «День N» --------------------------------------------------

test('счётчик «День N» разбирается, но только в шапке', () => {
  const r = parseContext('📅 День 3');
  assert.equal(r.dayIndex, 3);
  assert.equal(r.day, null);
  assert.equal(parseContext('Она вспомнила день 3 сентября прошлого года.').day, null);
});

// --- разное ---------------------------------------------------------------

test('пустой и мусорный вход не роняют разбор', () => {
  assert.equal(parseContext(''), null);
  assert.equal(parseContext('   \n\n  '), null);
  assert.equal(parseContext(null), null);
  assert.equal(parseContext(undefined), null);
  assert.equal(cleanForScan(null), '');
});

test('уверенность падает вместе с надёжностью источника', () => {
  const header = parseContext('📅 СБ, 18 мая 2024 | 🕰 20:45');
  const edge = parseContext('08:40.\nОна опоздала.');
  const dp = parseContext('Она проснулась поздним утром и не смогла встать.');
  assert.ok(header.confidence > edge.confidence);
  assert.ok(edge.confidence > dp.confidence);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseContext, resolveTwoDigitYear, cleanForScan } from '../core/parse-context.mjs';
import {
  readTime, readMachineTags, referenceYear, eraYear, rollYear, PRIORITY, TAGS,
} from '../core/time-source.mjs';
import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { applyResponse, resolveHeldJump } from '../core/engine.mjs';
import { debugView, describeApplied } from '../ui.js';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));

// Этот файл — про чтение времени целиком (9.1.5, 9.2, 9.7): двузначный год,
// машинные теги соседей (источник A+) и один вход `readTime`, через который
// движок теперь спрашивает время. Проза поимённо проверена в
// `parse-context.test.mjs`, защиты календаря — в `time.test.mjs`; здесь
// проверяется, что A+ читается, стоит в очереди первым и идёт через те же
// защиты, что и проза.

const SUBJECTS = [
  { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'ivanov' },
];
const TEACHERS = [
  { id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['злопамятна'] },
  { id: 'ivanov', name: 'Иванов Пётр Ильич', traits: ['добродушен'] },
];

function semester(startDay = '2024-09-02', survey) {
  const state = createState(preset, {
    startDay,
    survey,
    subjects: SUBJECTS,
    teachers: TEACHERS,
    schedule: buildSchedule(SUBJECTS, preset),
  });
  state.started = true;
  return state;
}

const marker = (body) => `<!-- [ACADEMY ${body}] -->`;

/* --- 9.1.5: двузначный год ------------------------------------------------- */

test('двузначный год: век ближайший к опорному году', () => {
  assert.equal(resolveTwoDigitYear(87, 1986).year, 1987, '1980-е');
  assert.equal(resolveTwoDigitYear(87, 2024).year, 1987, 'из 2024 до 1987 ближе, чем до 2087');
  assert.equal(resolveTwoDigitYear(24, 2026).year, 2024, 'современность');
  assert.equal(resolveTwoDigitYear(25, 2024).year, 2025, 'шаг вперёд через Новый год');
  assert.equal(resolveTwoDigitYear(48, 1247).year, 1248, 'фэнтези-летоисчисление');
  assert.equal(resolveTwoDigitYear(0, 1999).year, 2000, 'через границу века вперёд');
  assert.equal(resolveTwoDigitYear(99, 2001).year, 1999, 'через границу века назад');
  assert.equal(resolveTwoDigitYear(87, 1986).guessed, false);
});

test('двузначный год без опоры: прежние 2000+YY, но «из текста» он уже не считается', () => {
  const r = resolveTwoDigitYear(87);
  assert.equal(r.year, 2087);
  assert.equal(r.guessed, true);

  // `index.js:startDayHint` заводит семестр только по году «из текста» — век,
  // додуманный вслепую, не должен начинать отыгрыш про 1987-й в 2087-м.
  const hit = parseContext('📅 14.09.87 | 🕰 09:15');
  assert.equal(hit.day, '2087-09-14');
  assert.equal(hit.yearFromText, false);
});

test('Scene State из BB-UI-Regex-Pack: 1987 в эпохе 80-х, 2024 в современной, фэнтези-год', () => {
  const line = (yy) => `::SCENE_STATE::\n14.09.${yy} | Sun | Общежитие | ☀️ 18°C | 09:15\n\nОна проснулась.`;

  const eighties = parseContext(line('87'), { refYear: 1987 });
  assert.equal(eighties.day, '1987-09-14');
  assert.equal(eighties.time, '09:15');
  assert.equal(eighties.yearFromText, true, 'две цифры написаны, век выведен из опоры');

  assert.equal(parseContext(line('24'), { refYear: 2026 }).day, '2024-09-14');
  assert.equal(parseContext(line('47'), { refYear: 1247 }).day, '1247-09-14');
});

test('опорный год по умолчанию — `opts.year`, тот же год календаря', () => {
  assert.equal(parseContext('📅 14.09.87 | 🕰 09:15', { year: 1987 }).day, '1987-09-14');
  assert.equal(parseContext('📅 14.09.87 | 🕰 09:15', { year: 2030, refYear: 1990 }).day, '1987-09-14',
    'явный refYear сильнее');
});

test('опорный год: календарь, а без него — эпоха анкеты (только год из четырёх цифр)', () => {
  assert.equal(eraYear('1980-е, Ленинград'), 1980);
  assert.equal(eraYear('год 1247 от Основания'), 1247);
  assert.equal(eraYear('80-е'), undefined, '«80-е» — догадка, а не год');
  assert.equal(eraYear('высокое фэнтези'), undefined);
  assert.equal(eraYear(null), undefined);

  assert.equal(referenceYear({ calendar: { day: '1987-09-01' }, survey: { era: '2024' } }), 1987,
    'календарь — это «сейчас в сцене», он главнее');
  assert.equal(referenceYear({ calendar: { day: null }, survey: { era: '1980-е' } }), 1980);
  assert.equal(referenceYear(null), undefined);
});

test('движок: Scene State 80-х двигает календарь на день, а не придерживает прыжок на век', () => {
  // До правки `15.09.87` превращалось в 2087, и охрана прыжка спрашивала
  // «принять?» на каждом посте.
  const s = semester('1987-09-14');
  const r = applyResponse(s, '14.09.87 | Mon | Общежитие | ☀️ 18°C | 09:15\n\nУтро.', preset);
  assert.equal(r.state.calendar.day, '1987-09-14');
  assert.equal(r.state.calendar.time, '09:15');

  const next = applyResponse(r.state, '15.09.87 | Tue | Аудитория | ☁️ 16°C | 08:30\n\nНовый день.', preset);
  assert.equal(next.state.calendar.day, '1987-09-15');
  assert.equal(next.heldJump, null);
  assert.equal(next.debug.moved, true);
});

/* --- 9.2: машинные теги, каждый формат -------------------------------------- */

test('Phone-ST: <!--tel:time:HH:MM DD.MM.YYYY-->', () => {
  const r = readMachineTags('Она убрала телефон.\n<!--tel:time:08:40 19.10.2024-->');
  assert.equal(r.day, '2024-10-19');
  assert.equal(r.time, '08:40');
  assert.equal(r.source, 'A+');
  assert.equal(r.via, 'tel:time');
  assert.equal(r.yearFromText, true);
});

test('Pregnancy-and-menstruation: <!-- [RP_DATE:DD.MM.YYYY HH:MM] -->, часы необязательны', () => {
  const r = readMachineTags('Текст ответа.\n<!-- [RP_DATE:19.10.2024 20:45] -->');
  assert.equal(r.day, '2024-10-19');
  assert.equal(r.time, '20:45');
  assert.equal(r.via, 'RP_DATE');

  const noClock = readMachineTags('<!-- [RP_DATE: 05.03.2025] -->');
  assert.equal(noClock.day, '2025-03-05');
  assert.equal(noClock.time, null);
});

test('дневник: <!-- diary Дневник DD.MM.YYYY, HH:MM — без закрывающего в той же строке', () => {
  const r = readMachineTags('Она легла спать.\n<!-- diary Дневник 19.10.2024, 23:10\nСегодня был странный день.\n-->');
  assert.equal(r.day, '2024-10-19');
  assert.equal(r.time, '23:10');
  assert.equal(r.via, 'diary');
});

test('Horae: time: ГГГГ/ММ/ДД HH:MM — дата больше не теряется', () => {
  const mes = '<horae>\ntime: 2024/10/19 20:45\nlocation: библиотека\n</horae>\nОна листала конспект.';
  const r = readMachineTags(mes);
  assert.equal(r.day, '2024-10-19', 'до правки day был null');
  assert.equal(r.time, '20:45');
  assert.equal(r.via, 'horae');

  // И проза сама по себе теперь тоже читает дату с годом впереди.
  const prose = parseContext('time: 2024/10/19 20:45');
  assert.equal(prose.day, '2024-10-19');
  assert.equal(prose.time, '20:45');
  assert.equal(parseContext('Дата: 2024-10-19').day, '2024-10-19');
  assert.equal(parseContext('📅 2024/10-19 | 🕰 09:00').day, null, 'разные разделители — не дата');
});

test('BB-телефон: Time: [HH:MM] и Date: [Thu, 5 Mar] склеиваются в одну находку', () => {
  const below = readMachineTags('Экран погас.\nTime: [08:40]\nDate: [Wed, 5 Mar]', { year: 2025 });
  assert.equal(below.day, '2025-03-05');
  assert.equal(below.time, '08:40');
  assert.equal(below.via, 'bb-phone');
  assert.equal(below.yearFromText, false, 'года в формате нет — он подставлен');

  const above = readMachineTags('Date: [Wed, 5 Mar]\nTime: [8:40 PM]', { year: 2025 });
  assert.equal(above.day, '2025-03-05');
  assert.equal(above.time, '20:40', 'дата и над часами, и под ними');

  // Одни часы без даты в A+ не идут — их прочитает проза.
  assert.equal(readMachineTags('Time: [08:40]', { year: 2025 }), null);
  assert.equal(readTime('Пост.\nTime: [08:40]', { state: semester() }).context.source, 'A');
});

test('теги: мусорная дата, размышление модели и чужие комментарии не читаются', () => {
  assert.equal(readMachineTags('<!--tel:time:08:40 31.02.2024-->'), null, '31 февраля');
  assert.equal(readMachineTags('<!-- [RP_DATE:29.02.2023 10:00] -->'), null, '2023 не високосный');
  assert.equal(readMachineTags('<!-- [RP_DATE:29.02.2024 10:00] -->').day, '2024-02-29');
  assert.equal(readMachineTags('<think>Прошлый тег: <!--tel:time:08:40 19.10.2024--></think>\nПост.'), null);
  assert.equal(readMachineTags('<!-- письмо от 19.10.2024 -->'), null, 'белый список, а не любая дата в комментарии');
  assert.equal(readMachineTags('Пост.\n<!-- [ACADEMY t=+1] -->'), null, 'своя метка — не тег соседа');
});

test('теги: последний одного вида главнее, тег выше в списке главнее другого', () => {
  const two = readMachineTags('<!--tel:time:08:00 18.10.2024-->\nцитата\n<!--tel:time:09:30 19.10.2024-->');
  assert.equal(two.day, '2024-10-19', 'Phone-ST пишет свой тег последней строкой');
  assert.equal(two.time, '09:30');

  const mixed = readMachineTags('<!-- [RP_DATE:20.10.2024 10:00] -->\n<!--tel:time:09:30 19.10.2024-->');
  assert.equal(mixed.via, 'tel:time');
  assert.ok(mixed.priority > PRIORITY.A, 'любой тег стоит выше прозы');
  assert.deepEqual(TAGS.map((t) => t.id), ['tel:time', 'RP_DATE', 'diary', 'horae']);
});

test('двузначный год в теге решается тем же правилом', () => {
  assert.equal(readMachineTags('<!--tel:time:08:40 14.09.87-->', { refYear: 1987 }).day, '1987-09-14');
});

test('A+ читается ДО снятия HTML: cleanForScan комментарии по-прежнему выбрасывает', () => {
  const mes = 'Пост.\n<!--tel:time:08:40 19.10.2024-->';
  assert.doesNotMatch(cleanForScan(mes), /tel:time/);
  assert.equal(parseContext(mes), null, 'проза тега не видит');
  assert.equal(readTime(mes, { state: semester() }).context.via, 'tel:time');
});

/* --- один вход: очередь и режимы ---------------------------------------------- */

test('readTime: тег сильнее прозы в том же посте', () => {
  const mes = '📅 Вторник, 3 сентября 2024 | 🕰 09:00\nОна вошла.\n<!--tel:time:10:15 03.09.2024-->';
  const r = readTime(mes, { state: semester() });
  assert.equal(r.context.source, 'A+');
  assert.equal(r.context.time, '10:15');
  assert.equal(r.best, r.context);
});

test('readTime: проза подписана источником A и шагом разбора в via', () => {
  const r = readTime('📅 Вторник, 3 сентября | 🕰 10:15', { state: semester() });
  assert.equal(r.context.source, 'A');
  assert.equal(r.context.via, 'header');
  assert.equal(r.context.priority, PRIORITY.A);
  assert.equal(r.context.day, '2024-09-03', 'год подставлен из календаря');
});

test('readTime: режимы 3.2 — marker не читает теги, context не читает метку', () => {
  const mes = `Пост.\n<!--tel:time:10:15 03.09.2024-->\n${marker('t=+1')}`;
  const events = [{ kind: 'time', unit: 'period', n: 1 }, { kind: 'grade', subjectId: 'x', value: 5 }];

  const auto = readTime(mes, { state: semester(), markerEvents: events });
  assert.equal(auto.context.source, 'A+');
  assert.equal(auto.marker.source, 'B');
  assert.equal(auto.marker.events.length, 1, 'в находку метки уходят только события времени');
  assert.deepEqual(auto.candidates.map((c) => c.source), ['A+', 'B']);

  const onlyMarker = readTime(mes, { mode: 'marker', state: semester(), markerEvents: events });
  assert.equal(onlyMarker.context, null);
  assert.equal(onlyMarker.best.source, 'B');

  const onlyContext = readTime(mes, { mode: 'context', state: semester(), markerEvents: events });
  assert.equal(onlyContext.marker, null);
  assert.equal(onlyContext.best.source, 'A+');
});

test('rollYear переехал из движка без изменений: подставленный год перекатывается, написанный — нет', () => {
  const st = { calendar: { day: '2024-12-28' } };
  const mine = { day: '2024-01-03', yearFromText: false, dateParts: { year: 2024, month: 1, day: 3 } };
  assert.equal(rollYear(mine, st).day, '2025-01-03');
  const written = { ...mine, yearFromText: true };
  assert.equal(rollYear(written, st).day, '2024-01-03');
});

/* --- движок: A+ идёт через те же защиты ------------------------------------- */

test('движок: тег соседа двигает календарь, отладка называет источник и тег', () => {
  const s = semester();
  const r = applyResponse(s, 'Она проверила телефон.\n<!--tel:time:10:15 02.09.2024-->', preset);

  assert.equal(r.state.calendar.time, '10:15');
  assert.equal(r.state.calendar.source, 'A+');
  assert.equal(r.debug.source, 'A+');
  assert.equal(r.debug.via, 'tel:time');
  assert.equal(r.debug.moved, true);
  const t = r.debug.applied.find((a) => a.kind === 'time');
  assert.equal(t.source, 'A+');
  assert.equal(t.via, 'tel:time');
});

test('движок: тег сильнее шапки — календарь идёт за тегом', () => {
  const s = semester();
  const mes = '📅 Понедельник, 2 сентября 2024 | 🕰 09:00\nЛекция.\n<!-- [RP_DATE:02.09.2024 11:20] -->';
  const r = applyResponse(s, mes, preset);
  assert.equal(r.state.calendar.time, '11:20');
  assert.equal(r.debug.source, 'A+');
  assert.equal(r.debug.via, 'RP_DATE');
});

test('движок: тег назад не пускает — та же защита от отката, что у прозы', () => {
  let s = applyResponse(semester(), '<!--tel:time:12:00 02.09.2024-->', preset).state;
  const back = applyResponse(s, '<!--tel:time:08:00 02.09.2024-->', preset);
  assert.equal(back.state.calendar.time, '12:00');
  assert.equal(back.debug.moved, false);
  assert.equal(back.debug.source, 'A+', 'источник высказался — это не простой');
  assert.ok(back.notes.some((n) => n.includes('откат')), JSON.stringify(back.notes));
  assert.equal(back.state.calendar.idle, 0);
});

test('движок: прыжок тега дальше суток придерживается, «принять» сохраняет подпись A+', () => {
  const s = semester();
  const r = applyResponse(s, 'Прошёл месяц.\n<!--tel:time:09:00 19.10.2024-->', preset);
  assert.equal(r.state.calendar.day, '2024-09-02', 'сам не двинулся');
  assert.equal(r.heldJump.day, '2024-10-19');
  assert.equal(r.heldJump.source, 'A+');
  assert.equal(r.heldJump.via, 'tel:time');
  assert.ok(r.debug.applied.some((a) => a.kind === 'time-held' && a.source === 'A+'));

  const yes = resolveHeldJump(r.state, preset, true);
  assert.equal(yes.state.calendar.day, '2024-10-19');
  assert.equal(yes.state.calendar.source, 'A+');
});

test('движок: метка Академии по-прежнему работает — и временем, и событиями', () => {
  const s = semester();
  const r = applyResponse(s, `Пара идёт.\n${marker('t=+1 grade=физика:5')}`, preset);
  assert.equal(r.debug.source, 'B');
  assert.equal(r.debug.via, 'marker');
  assert.equal(r.debug.moved, true);
  assert.ok(r.debug.applied.some((a) => a.kind === 'grade'));
});

test('движок: тег высказался — время из метки не применяется, а оценка из неё — да', () => {
  // То же правило, что у прозы: подстраховка вступает, только когда A молчит.
  const s = semester();
  const r = applyResponse(s, `Пост.\n<!--tel:time:10:15 02.09.2024-->\n${marker('t=+1 day grade=физика:5')}`, preset);
  assert.equal(r.state.calendar.day, '2024-09-02', 't=+1 day не применён');
  assert.equal(r.state.calendar.time, '10:15');
  assert.equal(r.debug.source, 'A+');
  assert.ok(r.debug.applied.some((a) => a.kind === 'grade'), 'метка всё ещё канал событий');
});

test('движок: в режиме «своя метка» тег соседа не читается', () => {
  const s = semester();
  const r = applyResponse(s, `Пост.\n<!--tel:time:10:15 02.09.2024-->\n${marker('t=+1')}`, preset, { mode: 'marker' });
  assert.equal(r.debug.source, 'B');
  assert.notEqual(r.state.calendar.time, '10:15');
});

/* --- отладка на экране ---------------------------------------------------------- */

test('отладка показывает, что сработал тег соседа, и чей именно', () => {
  const r = applyResponse(semester(), '<!--tel:time:10:15 02.09.2024-->', preset);
  const view = debugView({ mesId: 3, debug: r.debug, notes: r.notes, injects: r.injects }, r.state, preset, { debug: true });
  assert.match(view.source, /тег соседнего расширения/);
  assert.ok(view.applied.some((line) => line.includes('(tel:time)')), JSON.stringify(view.applied));

  // У прозы шаг разбора человеку ничего не скажет — его в строке нет.
  assert.equal(describeApplied({ kind: 'time', source: 'A', via: 'header', day: '2024-09-03' }, {}), 'время: 2024-09-03');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readTimeSkip, skipDays, readPhoneTurn } from '../core/cues.mjs';
import {
  applyResponse, resolveHeldJump, examAhead, timeSkipCap, timeSkipWarning, skipPolicyOf, SKIP_POLICIES,
} from '../core/engine.mjs';
import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { addDays } from '../core/time.mjs';

// 9.2: что человек сказал о времени своей репликой — промотка BB-Enhance-Gen и
// ход в телефоне Phone-ST. Здесь — ядро: разбор строк (`core/cues.mjs`) и то,
// что движок с ними делает (`engine.applyResponse`, `opts.timeSkip`,
// `opts.phoneTurn`). Проводка через `index.js` — в `remont.test.mjs`.

const loadPreset = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));
const preset = loadPreset('ru-university');

const SUBJECTS = [
  { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'ivanov' },
  { id: 'history', name: 'история', teacherId: 'sidorova' },
  { id: 'math', name: 'высшая математика', teacherId: 'kuznecov' },
];
const TEACHERS = [
  { id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['злопамятна'] },
  { id: 'ivanov', name: 'Иванов Пётр Ильич', traits: ['добродушен'] },
  { id: 'sidorova', name: 'Сидорова Мария Львовна', traits: ['придирается к опозданиям'] },
  { id: 'kuznecov', name: 'Кузнецов Илья Львович', traits: ['требователен'] },
];

function semester(day, p = preset) {
  const s = createState(p, {
    startDay: '2024-09-02', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, p),
  });
  s.started = true;
  if (day) s.calendar.day = day;
  return s;
}

const withPolicy = (policy) => ({ ...preset, attendance: { ...preset.attendance, skipPolicy: policy } });
const skipsOf = (s) => s.attendance.records.filter((r) => r.status === 'skip').length;
const presentOf = (s) => s.attendance.records.filter((r) => r.status === 'present').length;

/** Cue ровно в том виде, в каком его пишет BB-Enhance-Gen (`BOT_CUES.ts_specific`). */
const bbCue = (time, title = 'Глава: Новое начало') => `\n\n> ⏩ **ПРОМОТКА ВРЕМЕНИ:** *${title}* ⏳ (${time}) <span style="display:none;">\n<system_note>\nTIME SKIP EVENT: Execute a logical TIME SKIP forward by ${time}. New Chapter: "${title}". Summary of situation: "Персонажи просыпаются.". In your next response, seamlessly transition the narrative to the start of this new timeframe, establish the setting, and initiate the new scene.\n</system_note>\n</span>`;

// --- разбор cue ---------------------------------------------------------------

test('9.2 cue промотки Enhance-Gen узнаётся в том виде, в каком его пишет расширение', () => {
  const hit = readTimeSkip(`Ладно, хватит на сегодня.${bbCue('2 дня')}`);
  assert.ok(hit, 'cue из исходника BB-Enhance-Gen обязан узнаваться');
  assert.equal(hit.days, 2);
  assert.equal(hit.time, '2 дня');
  assert.match(hit.matched, /ПРОМОТКА ВРЕМЕНИ/);
});

test('9.2 разбор cue терпим: «Time passed», другие кавычки, только видимая строка', () => {
  // Вариант из разбора соседей (план 9.2): «Time passed: X» в скрытом блоке,
  // двойные кавычки без точки с запятой.
  const passed = readTimeSkip('Идём.\n<span style="display: none">\n<system_note>TIME SKIP. Time passed: неделя.</system_note></span>');
  assert.equal(passed && passed.days, 7);
  // Скрытый блок вырезан соседом-чистильщиком, осталась видимая строка.
  const visible = readTimeSkip('Спать.\n\n> ⏩ **ПРОМОТКА ВРЕМЕНИ:** *Утро* ⏳ (Завтра утром)');
  assert.equal(visible && visible.days, 1);
  // Длительность не прочлась — промотка всё равно промотка, просто без длины.
  const vague = readTimeSkip('<span style="display:none;"><system_note>TIME SKIP EVENT: skip ahead.</system_note></span>');
  assert.ok(vague);
  assert.equal(vague.days, null);
});

test('9.2 не промотка: Fast Travel того же расширения, «time skip» словами, пустое', () => {
  const travel = '\n\n> 📍 **Путешествие:** *Библиотека* ⏳ (15 мин) <span style="display:none;">\n<system_note>\nFAST TRAVEL EVENT: The user has decided to Fast Travel to "Библиотека". Time passed: 15 мин.\n</system_note>\n</span>';
  assert.equal(readTimeSkip(travel), null, 'переход в другое место — не промотка');
  assert.equal(readTimeSkip('Может, сделаем time skip до пятницы?'), null, 'вопрос человека — не кнопка');
  assert.equal(readTimeSkip(''), null);
  assert.equal(readTimeSkip(undefined), null);
});

test('9.2 длительность промотки словами — то, что пишет анализатор Enhance-Gen', () => {
  const cases = {
    'Завтра утром': 1,
    'Послезавтра': 2,
    '2 дня': 2,
    'Неделя спустя': 7,
    'две недели': 14,
    'пару недель': 14,
    'неделя и два дня': 9,
    'Выходные': 2,
    'через месяц': 30,
    'a few days': 3,
    'a couple of weeks': 14,
    '3 hours': 1,
    'Летом': null,
    '': null,
  };
  for (const [text, days] of Object.entries(cases)) assert.equal(skipDays(text), days, text);
});

test('9.2 телефонный ход: [СМС → X] и [Голосовое → X] в начале реплики, стрелка любая', () => {
  assert.deepEqual(readPhoneTurn('[СМС → Лиза] ты где?'), { channel: 'смс', to: 'Лиза' });
  assert.equal(readPhoneTurn('  [Голосовое → Лиза] (запись 0:12)').channel, 'голосовое');
  assert.equal(readPhoneTurn('[Голосовое сообщение -> Лиза] привет').to, 'Лиза');
  assert.equal(readPhoneTurn('[SMS => Liza] hi').channel, 'sms');
  assert.equal(readPhoneTurn('Вечером я отправила [СМС → Лиза] и легла.'), null, 'посреди сцены — это сцена');
  assert.equal(readPhoneTurn('[Звонок → Лиза]'), null, 'звонок в список не входит');
  assert.equal(readPhoneTurn('[СМС Лиза]'), null, 'без стрелки и адресата — не формат телефона');
});

// --- потолок и политика -------------------------------------------------------

test('9.2 потолок промотки: заказанное плюс сутки, не меньше 2×maxForwardJump, не больше maxTimeShift', () => {
  assert.equal(timeSkipCap(preset, null), 2, 'длина неизвестна — 2×maxForwardJump (умолчание сутки)');
  assert.equal(timeSkipCap(preset, 0), 2);
  assert.equal(timeSkipCap(preset, 7), 8);
  assert.equal(timeSkipCap(preset, 100), preset.limits.maxTimeShift, 'промотка не умеет больше, чем t=');
  const wide = { ...preset, limits: { ...preset.limits, maxForwardJump: 3 } };
  assert.equal(timeSkipCap(wide, 1), 6);
});

test('9.2 политика посещаемости промотки: умолчание attend, мусор — тоже attend', () => {
  assert.deepEqual(SKIP_POLICIES, ['attend', 'absent', 'ask']);
  for (const id of ['ru-university', 'jp-highschool', 'magic-academy']) {
    assert.equal(skipPolicyOf(loadPreset(id)), 'attend', `${id}: пресет объявляет attend`);
  }
  assert.equal(skipPolicyOf({}), 'attend');
  assert.equal(skipPolicyOf(withPolicy('прогул')), 'attend');
  assert.equal(skipPolicyOf(withPolicy('absent')), 'absent');
});

// --- санкционированный прыжок -----------------------------------------------

const WEEK_LATER = 'Понедельник, 14 октября 2024 года. Неделя пролетела незаметно.';

test('9.2 прыжок после промотки проходит без вопроса; без промотки — придерживается', () => {
  const s = semester('2024-10-07');
  const held = applyResponse(s, WEEK_LATER, preset);
  assert.equal(held.state.calendar.day, '2024-10-07', 'обычный прыжок на неделю ждёт слова человека');
  assert.equal(held.heldJump.day, '2024-10-14');

  const run = applyResponse(s, WEEK_LATER, preset, { timeSkip: { days: 7 } });
  assert.equal(run.state.calendar.day, '2024-10-14', 'человек уже выбрал промотку — спрашивать нечего');
  assert.equal(run.heldJump, null);
  assert.ok(run.debug.applied.some((a) => a.kind === 'time-skip' && a.cap === 8));
});

test('9.2 прыжок дальше потолка промотки всё равно придерживается — и помнит политику', () => {
  const s = semester('2024-10-07');
  // Заказали два дня, модель уехала на неделю.
  const run = applyResponse(s, WEEK_LATER, withPolicy('attend'), { timeSkip: { days: 2 } });
  assert.equal(run.state.calendar.day, '2024-10-07');
  assert.equal(run.heldJump.day, '2024-10-14');
  assert.equal(run.heldJump.skipPolicy, 'attend');

  const res = resolveHeldJump(run.state, withPolicy('attend'), true);
  assert.equal(res.applied, true);
  assert.equal(res.missed.length, 0, 'принятый прыжок из промотки не превращается в прогулы');
  assert.equal(skipsOf(res.state), 0);
  assert.ok(presentOf(res.state) > 0);
});

test('9.2 промотка не разрешает откат назад', () => {
  const s = semester('2024-10-14');
  const run = applyResponse(s, 'Понедельник, 7 октября 2024 года.', preset, { timeSkip: { days: 7 } });
  assert.equal(run.state.calendar.day, '2024-10-14');
  assert.equal(run.heldJump, null);
});

test('9.2 skipPolicy attend: перешагнутые дни — присутствие, не прогул', () => {
  const s = semester('2024-10-07');
  const run = applyResponse(s, WEEK_LATER, withPolicy('attend'), { timeSkip: { days: 7 } });
  assert.equal(run.missed.length, 0);
  assert.equal(skipsOf(run.state), 0);
  // Пять учебных дней по четыре пары: понедельник 7-го … пятница 11-го.
  assert.equal(presentOf(run.state), 20);
});

test('9.2 skipPolicy absent: перешагнутые дни — прогулы, как у любого прыжка', () => {
  const s = semester('2024-10-07');
  const run = applyResponse(s, WEEK_LATER, withPolicy('absent'), { timeSkip: { days: 7 } });
  assert.equal(run.state.calendar.day, '2024-10-14');
  assert.ok(run.missed.length > 0);
  assert.equal(presentOf(run.state), 0);
});

test('9.2 skipPolicy ask пока ведёт себя как attend и видна в отладке', () => {
  const s = semester('2024-10-07');
  const run = applyResponse(s, WEEK_LATER, withPolicy('ask'), { timeSkip: { days: 7 } });
  assert.equal(skipsOf(run.state), 0);
  assert.ok(run.debug.applied.some((a) => a.kind === 'time-skip' && a.policy === 'ask'));
});

test('9.2 промотка меткой t=+N day тоже обходит ведомость по политике', () => {
  const s = semester('2024-10-07');
  const run = applyResponse(s, 'Три дня прошли. <!-- [ACADEMY t=+3 day] -->', preset, { timeSkip: { days: 3 } });
  assert.equal(run.state.calendar.day, '2024-10-10');
  assert.equal(skipsOf(run.state), 0);
  assert.equal(presentOf(run.state), 12);
});

// --- контрольное впереди ------------------------------------------------------

test('9.2 контрольное впереди: день находится, потолок промотки его не перешагивает', () => {
  const s = semester('2024-12-16');
  const ahead = examAhead(s, preset, 14);
  // `subjectId`/`count`/`dated` — для ближних событий строки (9.4.4); здесь
  // проверяется то, что нужно промотке.
  const { day, days, what } = ahead;
  assert.deepEqual({ day, days, what }, { day: '2024-12-23', days: 7, what: preset.vocab.examPeriod });

  // Две недели заказано, модель прыгнула через начало сессии — придержано.
  const over = applyResponse(s, 'Понедельник, 30 декабря 2024 года.', preset, { timeSkip: { days: 14 } });
  assert.equal(over.state.calendar.day, '2024-12-16');
  assert.equal(over.heldJump.day, '2024-12-30');
  // А ровно в день контрольного — можно: сдают его как раз в этот день.
  const onDay = applyResponse(s, 'Понедельник, 23 декабря 2024 года.', preset, { timeSkip: { days: 14 } });
  assert.equal(onDay.state.calendar.day, '2024-12-23');
});

test('9.2 одноразовая строка промотки называет день контрольного словами пресета', () => {
  const s = semester('2024-12-16');
  const line = timeSkipWarning(s, preset, { days: 14 });
  assert.match(line, /23\.12/);
  assert.match(line, /накануне/);
  assert.ok(line.includes(preset.vocab.examPeriod));
  // Промотка короче расстояния до сессии — предупреждать не о чем.
  assert.equal(timeSkipWarning(s, preset, { days: 2 }), '');
  assert.equal(timeSkipWarning(s, preset, null), '', 'нет cue — нет строки');
  // Пресет вправе сказать это своими словами.
  const own = { ...preset, phrases: { ...preset.phrases, timeSkip: { examAhead: 'Стоп: {date} ({what}).' } } };
  assert.equal(timeSkipWarning(s, own, { days: 14 }), `Стоп: 23.12 (${preset.vocab.examPeriod}).`);
});

test('9.2 контрольное своей недели называется своим видом, а не сессией', () => {
  const jp = loadPreset('jp-highschool');
  const s = createState(jp, { subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, jp) });
  s.started = true;
  const start = s.calendar.day;
  // Ищем первое контрольное в пределах полугода — это середина триместра.
  let found = null;
  for (let k = 0; k < 20 && !found; k += 1) {
    const probe = { ...s, calendar: { ...s.calendar, day: addDays(start, k * 7) } };
    found = examAhead(probe, jp, 7);
  }
  assert.ok(found, 'у японского пресета есть событие своей недели');
  const midterm = jp.exams.kinds.find((k) => k.atWeek);
  assert.equal(found.what, midterm.name);
});

// --- телефонный ход -----------------------------------------------------------

test('9.2 телефонный ход: t=+1 из метки не проводится, простой не копится', () => {
  const s = semester('2024-10-07');
  const run = applyResponse(s, 'Лиза: «я в библиотеке». <!-- [ACADEMY t=+1] -->', preset, { phoneTurn: true });
  assert.equal(run.state.calendar.periodIndex, s.calendar.periodIndex, 'переписка не двигает пару');
  assert.equal(run.state.calendar.idle, s.calendar.idle, 'пауза — не простой');
  assert.ok(run.debug.applied.some((a) => a.kind === 'phone-turn'));
  assert.ok(run.debug.applied.some((a) => a.kind === 'time-dropped'));
});

test('9.2 телефонный ход: прогулы за него не выводятся, а явные события метки остаются', () => {
  const s = semester('2024-10-07');
  const run = applyResponse(s, 'Ответ пришёл. <!-- [ACADEMY t=+1 day grade=physics:5] -->', preset, { phoneTurn: true });
  assert.equal(run.state.calendar.day, '2024-10-07');
  assert.equal(skipsOf(run.state), 0);
  assert.equal(run.state.subjects.find((x) => x.id === 'physics').grades.length, 1, 'оценка — слово модели, не время');
});

test('9.2 телефонный ход сильнее промотки: пауза есть пауза', () => {
  const s = semester('2024-10-07');
  const run = applyResponse(s, 'ок <!-- [ACADEMY t=+2 day] -->', preset, { phoneTurn: true, timeSkip: { days: 2 } });
  assert.equal(run.state.calendar.day, '2024-10-07');
  assert.equal(run.debug.applied.some((a) => a.kind === 'time-skip'), false);
});

test('9.2 без реплики-подсказки движок ведёт себя как раньше', () => {
  const s = semester('2024-10-07');
  const run = applyResponse(s, 'Пара прошла. <!-- [ACADEMY t=+1] -->', preset);
  assert.equal(run.state.calendar.periodIndex, 1);
  assert.equal(run.debug.applied.some((a) => a.kind === 'phone-turn' || a.kind === 'time-skip'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../core/state.mjs';
import {
  parseDay, formatDay, addDays, diffDays, dayOfWeek, mondayOf,
  weekIndex, isStudyDay, isVacation, phaseOf, nextStudyDay,
  bellsOf, minutesOf, timeOf, periodPosition,
  advance, alignToGrid, setAbsolute, noteIdle, isStalled, termsOf, termAt,
} from '../core/time.mjs';

// Синтетический пресет: те же числа, что в `ru-university`, но зафиксированы
// здесь — тест не должен падать от правки пресета, он проверяет движок.
const preset = {
  id: 'test',
  lang: 'ru',
  week: { studyDays: [1, 2, 3, 4, 5], periodsPerDay: 4 },
  bells: [
    { start: '08:30', end: '10:05' },
    { start: '10:15', end: '11:50' },
    { start: '12:20', end: '13:55' },
    { start: '14:05', end: '15:40' },
    { start: '15:50', end: '17:25' },
  ],
  calendar: {
    termStart: '09-01',
    studyWeeks: 16,
    examWeeks: 3,
    vacations: [{ name: 'ноябрьские', from: '11-04', to: '11-07' }],
  },
  reputation: { start: 50 },
  limits: { idleWarnAfter: 10, journalSize: 200, maxTimeShift: 30 },
};

// 2 сентября 2024 — понедельник. Все даты ниже отсчитываются от него.
const TERM = '2024-09-02';

/** Состояние с заданным календарём поверх нового семестра. */
function mk(cal = {}) {
  const s = createState(preset, { startDay: TERM });
  s.calendar = { ...s.calendar, ...cal };
  return s;
}

// --- арифметика дат ---------------------------------------------------------

test('разбор и сборка даты — обратимы', () => {
  assert.deepEqual(parseDay('2024-09-02'), { y: 2024, m: 9, d: 2 });
  assert.equal(formatDay({ y: 2024, m: 9, d: 2 }), '2024-09-02');
  assert.equal(formatDay('2024-09-02'), '2024-09-02');
});

test('дата не в форме ГГГГ-ММ-ДД — исключение, а не тихий NaN', () => {
  assert.throws(() => parseDay('2.09.2024'), TypeError);
});

test('високосный год: 29 февраля есть в 2024 и нет в 2023', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(addDays('2023-02-28', 1), '2023-03-01');
  // Февраль 2024 — 29 дней, февраль 2023 — 28.
  assert.equal(diffDays('2024-02-01', '2024-03-01'), 29);
  assert.equal(diffDays('2023-02-01', '2023-03-01'), 28);
});

test('переход через границу года и месяца', () => {
  assert.equal(addDays('2024-12-31', 1), '2025-01-01');
  assert.equal(addDays('2025-01-01', -1), '2024-12-31');
  assert.equal(diffDays('2024-12-25', '2025-01-08'), 14);
});

test('арифметика дат не зависит от часового пояса машины', () => {
  // Прогон в UTC+13 и в UTC−11 должен давать те же сутки: считаем через
  // Date.UTC, а не через локальный конструктор.
  const before = process.env.TZ;
  try {
    process.env.TZ = 'Pacific/Kiritimati';
    assert.equal(addDays('2024-03-10', 1), '2024-03-11');
    process.env.TZ = 'Pacific/Midway';
    assert.equal(addDays('2024-03-10', 1), '2024-03-11');
    assert.equal(dayOfWeek('2024-09-02'), 1);
  } finally {
    if (before === undefined) delete process.env.TZ; else process.env.TZ = before;
  }
});

test('день недели: понедельник 1, воскресенье 7', () => {
  assert.equal(dayOfWeek('2024-09-02'), 1);
  assert.equal(dayOfWeek('2024-09-07'), 6);
  assert.equal(dayOfWeek('2024-09-08'), 7);
  assert.equal(mondayOf('2024-09-08'), '2024-09-02');
  assert.equal(mondayOf('2024-09-02'), '2024-09-02');
});

// --- недели и фазы ----------------------------------------------------------

test('номер недели считается от понедельника недели начала семестра', () => {
  const s = mk();
  assert.equal(weekIndex(s, '2024-09-02'), 1);
  assert.equal(weekIndex(s, '2024-09-08'), 1, 'воскресенье — ещё первая неделя');
  assert.equal(weekIndex(s, '2024-09-09'), 2);
  assert.equal(weekIndex(s, '2024-08-30'), 0, 'до семестра номера нулевые');
});

test('семестр, начатый в четверг, всё равно идёт с первой недели', () => {
  const s = createState(preset, { startDay: '2024-09-05' }); // четверг
  assert.equal(weekIndex(s, '2024-09-05'), 1);
  assert.equal(weekIndex(s, '2024-09-09'), 2, 'ближайший понедельник — уже вторая');
});

test('учебные дни, выходные и каникулы', () => {
  assert.equal(isStudyDay(preset, '2024-09-02'), true);
  assert.equal(isStudyDay(preset, '2024-09-07'), false, 'суббота');
  assert.equal(isStudyDay(preset, '2024-09-08'), false, 'воскресенье');
  assert.equal(isVacation(preset, '2024-11-05'), true);
  assert.equal(isStudyDay(preset, '2024-11-05'), false, 'вторник, но каникулы');
  assert.equal(isVacation(preset, '2024-11-08'), false);
});

test('каникулы через Новый год: конец диапазона раньше начала', () => {
  const winter = { calendar: { vacations: [{ from: '12-25', to: '01-08' }] } };
  assert.equal(isVacation(winter, '2024-12-31'), true);
  assert.equal(isVacation(winter, '2025-01-03'), true);
  assert.equal(isVacation(winter, '2025-01-09'), false);
  assert.equal(isVacation(winter, '2024-12-24'), false);
});

test('фазы семестра: учёба, выходной, каникулы, сессия', () => {
  const s = mk();
  assert.equal(phaseOf(preset, s, '2024-09-03'), 'study');
  assert.equal(phaseOf(preset, s, '2024-09-07'), 'weekend');
  assert.equal(phaseOf(preset, s, '2024-11-05'), 'vacation', 'каникулы важнее выходного и учёбы');

  // Учебных недель 16: последняя начинается 16 декабря, сессия — с 23-го.
  assert.equal(weekIndex(s, '2024-12-17'), 16);
  assert.equal(phaseOf(preset, s, '2024-12-17'), 'study');
  assert.equal(weekIndex(s, '2024-12-24'), 17);
  assert.equal(phaseOf(preset, s, '2024-12-24'), 'exams', 'вход в сессию');
  assert.equal(phaseOf(preset, s, '2024-12-28'), 'weekend', 'суббота в сессию — всё равно выходной');
  // Сессия три недели, 17–19; двадцатая — уже каникулы.
  assert.equal(phaseOf(preset, s, '2025-01-10'), 'exams');
  assert.equal(phaseOf(preset, s, '2025-01-14'), 'vacation', 'семестр кончился');
  assert.equal(phaseOf(preset, s, '2024-08-28'), 'vacation', 'семестр ещё не начался');
});

// --- несколько учебных периодов ---------------------------------------------

test('старая форма из трёх скаляров — это список из одного периода', () => {
  const s = mk();
  const terms = termsOf(preset, s);
  assert.equal(terms.length, 1);
  assert.deepEqual(
    { start: terms[0].start, studyWeeks: terms[0].studyWeeks, examWeeks: terms[0].examWeeks },
    { start: TERM, studyWeeks: 16, examWeeks: 3 },
  );
  // Первый период привязан к дате из СОСТОЯНИЯ, а не к `ММ-ДД` из пресета:
  // игрок волен начать семестр не первого сентября.
  const late = mk({ termStart: '2024-09-16' });
  assert.equal(termsOf(preset, late)[0].start, '2024-09-16');
  assert.equal(phaseOf(preset, late, '2024-09-17'), 'study');
});

test('пресет без календаря обходится умолчаниями, как и раньше', () => {
  const bare = { week: { studyDays: [1, 2, 3, 4, 5] } };
  const s = mk();
  assert.equal(termsOf(bare, s).length, 1, 'период всё равно один: начало берётся из состояния');
  assert.equal(phaseOf(bare, s, '2024-09-03'), 'study');
  assert.equal(phaseOf(bare, s, '2024-08-28'), 'vacation');
});

test('список периодов: годы расставляются сами, счёт недель — внутри периода', () => {
  const three = {
    week: { studyDays: [1, 2, 3, 4, 5] },
    calendar: {
      terms: [
        { name: 'первый', start: '04-08', studyWeeks: 14, examWeeks: 1 },
        { name: 'второй', start: '09-01', studyWeeks: 15, examWeeks: 1 },
        { name: 'третий', start: '01-08', studyWeeks: 10, examWeeks: 1 },
      ],
    },
  };
  const s = mk({ termStart: '2024-04-08', day: '2024-04-08' });
  const terms = termsOf(three, s);
  assert.deepEqual(terms.map((t) => t.start), ['2024-04-08', '2024-09-01', '2025-01-08'],
    'третий период переваливает через Новый год сам');

  // Каждый период начинает счёт недель заново — с той календарной недели, в
  // которую он попал. 1 сентября 2024 — воскресенье, поэтому понедельник 2-го
  // это уже вторая неделя: то же правило, что и у одного семестра.
  assert.equal(termAt(three, s, '2024-09-01').week, 1);
  assert.equal(termAt(three, s, '2024-09-02').week, 2);
  assert.equal(termAt(three, s, '2025-01-08').week, 1);
  // А без пресета `weekIndex` считает по-старому, сквозняком от начала первого.
  assert.ok(weekIndex(s, '2024-09-02') > 20);
  assert.equal(weekIndex(s, '2024-09-02', three), 2);

  // Второй и третий период — живые: учёба и сессия, а не вечные каникулы.
  assert.equal(phaseOf(three, s, '2024-09-02'), 'study');
  assert.equal(phaseOf(three, s, '2025-01-08'), 'study');
});

test('каникулы между периодами отличаются от каникул после последнего', () => {
  const two = {
    week: { studyDays: [1, 2, 3, 4, 5] },
    calendar: {
      terms: [
        { start: '09-02', studyWeeks: 2, examWeeks: 1 },
        { start: '11-04', studyWeeks: 2, examWeeks: 1 },
      ],
    },
  };
  const s = mk();
  assert.equal(phaseOf(two, s, '2024-09-18'), 'exams', 'третья неделя первого — сессия');
  assert.equal(phaseOf(two, s, '2024-10-07'), 'break', 'между периодами — не конец года');
  assert.equal(phaseOf(two, s, '2024-11-05'), 'study', 'второй период начался');
  assert.equal(phaseOf(two, s, '2024-11-25'), 'vacation', 'после последнего — каникулы');
  assert.equal(phaseOf(two, s, '2024-08-28'), 'vacation', 'до первого — тоже каникулы');
});

test('ближайший учебный день перешагивает выходные и каникулы', () => {
  assert.equal(nextStudyDay(preset, '2024-09-06'), '2024-09-09', 'после пятницы — понедельник');
  assert.equal(nextStudyDay(preset, '2024-11-01'), '2024-11-08', 'выходные плюс ноябрьские каникулы');
  assert.equal(nextStudyDay(preset, '2024-09-09', -1), '2024-09-06');
  assert.equal(nextStudyDay({ week: { studyDays: [] } }, '2024-09-02'), null, 'учебных дней нет — null, а не зацикливание');
});

// --- звонки -----------------------------------------------------------------

test('сетка звонков обрезается до числа пар в дне', () => {
  assert.equal(bellsOf(preset).length, 4, 'в пресете 5 звонков, пар в дне 4');
  assert.equal(minutesOf('08:30'), 510);
  assert.equal(timeOf(510), '08:30');
  assert.equal(minutesOf('не время'), null);
});

test('позиция по часам: до первой, внутри, на перемене, после последней', () => {
  assert.equal(periodPosition(preset, '07:00'), 0);
  assert.equal(periodPosition(preset, '08:30'), 0, 'ровно звонок — это уже первая пара');
  assert.equal(periodPosition(preset, '10:05'), 1, 'ровно конец первой — уже перемена перед второй');
  assert.equal(periodPosition(preset, '14:30'), 3);
  assert.equal(periodPosition(preset, '16:00'), 4, 'день кончился');
});

// --- advance ----------------------------------------------------------------

test('t=+0 — сцена продолжается: время стоит, простой сбрасывается', () => {
  const s = mk({ idle: 7, time: '12:30', precision: 'datetime' });
  const r = advance(s, { unit: 'period', n: 0 }, preset);
  assert.equal(r.applied, true, '+0 законен, это не мусор');
  assert.equal(r.state.calendar.day, TERM);
  assert.equal(r.state.calendar.time, '12:30');
  assert.equal(r.state.calendar.idle, 0);
  assert.equal(r.state.calendar.moved, 0, 'время не двигалось — счётчик сдвигов не растёт');
  assert.equal(r.state.calendar.source, 'B');
});

test('неизвестная единица не применяется и попадает в журнал', () => {
  const s = mk();
  const r = advance(s, { unit: 'night', n: 1 }, preset);
  assert.equal(r.applied, false);
  assert.match(r.reason, /неизвестная единица/);
  assert.equal(r.state.calendar.day, TERM, 'календарь не сдвинулся');
  assert.equal(r.state.journal.length, 1);
  assert.equal(r.state.journal[0].kind, 'debug');
  assert.equal(s.journal.length, 0, 'исходное состояние не тронуто');
});

test('нечисловой сдвиг тоже отбрасывается', () => {
  const r = advance(mk(), { unit: 'day', n: 'завтра' }, preset);
  assert.equal(r.applied, false);
  assert.match(r.reason, /нечисловой/);
});

test('сдвиг на пары при известных часах идёт по сетке звонков', () => {
  const s = mk({ time: '08:40', precision: 'datetime' });
  const r = advance(s, { unit: 'period', n: 1 }, preset);
  assert.equal(r.applied, true);
  assert.equal(r.state.calendar.day, TERM);
  assert.equal(r.state.calendar.time, '10:15', 'начало второй пары');
  assert.equal(r.state.calendar.moved, 1);
});

test('пара за последней переносит на следующий учебный день — переход через полночь', () => {
  const s = mk({ time: '15:00', precision: 'datetime' }); // четвёртая пара понедельника
  const r = advance(s, { unit: 'period', n: 1 }, preset);
  assert.equal(r.state.calendar.day, '2024-09-03', 'вторник');
  assert.equal(r.state.calendar.time, '08:30', 'первая пара');
});

test('последняя пара пятницы плюс одна — понедельник, конец недели', () => {
  const s = mk({ day: '2024-09-06', time: '15:00', precision: 'datetime' });
  const r = advance(s, { unit: 'period', n: 1 }, preset);
  assert.equal(r.state.calendar.day, '2024-09-09');
  assert.equal(dayOfWeek(r.state.calendar.day), 1);
});

test('перелив пар перешагивает каникулы, а не садится на них', () => {
  const s = mk({ day: '2024-11-01', time: '15:00', precision: 'datetime' }); // пятница
  const r = advance(s, { unit: 'period', n: 1 }, preset);
  assert.equal(r.state.calendar.day, '2024-11-08', 'выходные плюс 4–7 ноября');
});

test('сдвиг на несколько пар переливается через два дня сразу', () => {
  const s = mk({ time: '08:40', precision: 'datetime' }); // пара 0 понедельника
  const r = advance(s, { unit: 'period', n: 5 }, preset);
  assert.equal(r.state.calendar.day, '2024-09-03');
  assert.equal(r.state.calendar.time, '10:15', 'вторая пара вторника');
});

test('при точности «только день» пары считает periodIndex, а не часы', () => {
  const s = mk({ periodIndex: 2, precision: 'date', time: null });
  const r = advance(s, { unit: 'period', n: 1 }, preset);
  assert.equal(r.state.calendar.periodIndex, 3);
  assert.equal(r.state.calendar.day, TERM);
  assert.equal(r.state.calendar.time, null, 'часы не додумываются');

  const over = advance(r.state, { unit: 'period', n: 1 }, preset);
  assert.equal(over.state.calendar.day, '2024-09-03');
  assert.equal(over.state.calendar.periodIndex, 0);
  assert.equal(over.state.calendar.time, null);
});

// Движение назад — ручной ремонт, а не обычный ход: метка модели такого права
// не имеет (см. следующий тест), поэтому здесь стоит явный `allowBack`. Сама
// арифметика перелива при этом обязана работать в обе стороны.
test('сдвиг назад на пары по явной просьбе переливается в предыдущий учебный день', () => {
  const s = mk({ day: '2024-09-09', time: '08:40', precision: 'datetime' });
  const r = advance(s, { unit: 'period', n: -1 }, preset, { allowBack: true });
  assert.equal(r.applied, true);
  assert.equal(r.state.calendar.day, '2024-09-06', 'пятница');
  assert.equal(r.state.calendar.time, '14:05', 'последняя пара');
});

test('без явной просьбы откат назад не применяется: защита несимметрична', () => {
  const s = mk({ day: '2024-09-09', time: '08:40', precision: 'datetime' });
  for (const ev of [{ unit: 'period', n: -1 }, { unit: 'day', n: -3 }, { unit: 'week', n: -1 }]) {
    const r = advance(s, ev, preset);
    assert.equal(r.applied, false, `${ev.unit} ${ev.n}`);
    assert.equal(r.state.calendar.day, '2024-09-09', 'календарь на месте');
    assert.equal(r.state.calendar.time, '08:40');
    assert.match(r.reason, /откат календаря назад/);
    assert.ok(r.state.journal.some((e) => e.kind === 'debug' && e.text.startsWith('откат календаря назад')));
    // Источник сработал — просто ошибся. Простой не растёт, индикатор молчит.
    assert.equal(r.state.calendar.idle, 0);
  }
});

test('сдвиг больше потолка пресета не применяется и уходит в отладку', () => {
  const s = mk({ day: '2024-09-09' });
  const limit = preset.limits.maxTimeShift;
  const big = advance(s, { unit: 'day', n: limit + 1 }, preset);
  assert.equal(big.applied, false);
  assert.equal(big.state.calendar.day, '2024-09-09');
  assert.match(big.reason, /потолка/);
  assert.ok(big.state.journal.some((e) => e.kind === 'debug'));
  assert.equal(big.state.calendar.idle, 0, 'источник сработал, простой не растёт');

  // Ровно по потолку — законный сдвиг: граница включительная.
  assert.equal(advance(s, { unit: 'day', n: limit }, preset).applied, true);
  // Недели и пары меряются тем же аршином: пары — по числу пар в дне.
  assert.equal(advance(s, { unit: 'week', n: 5 }, preset).applied, false, '35 дней');
  assert.equal(advance(s, { unit: 'period', n: 4 * limit }, preset).applied, true, 'ровно 30 дней парами');
  assert.equal(advance(s, { unit: 'period', n: 4 * limit + 1 }, preset).applied, false);
  // Пресет без потолка не ограничивает ничего.
  const nolimit = { ...preset, limits: { ...preset.limits, maxTimeShift: undefined } };
  assert.equal(advance(s, { unit: 'day', n: 400 }, nolimit).applied, true);
});

test('сдвиг на дни и недели — календарный, без пропуска выходных', () => {
  const day = advance(mk({ time: '20:00', precision: 'datetime' }), { unit: 'day', n: 5 }, preset);
  assert.equal(day.state.calendar.day, '2024-09-07', 'суббота — законный результат «через 5 дней»');
  assert.equal(day.state.calendar.time, '20:00', 'часы при сдвиге на сутки сохраняются');

  const week = advance(mk(), { unit: 'week', n: 1 }, preset);
  assert.equal(week.state.calendar.day, '2024-09-09');
  assert.equal(week.state.calendar.moved, 1);
});

test('новые сутки сбрасывают счётчик пар', () => {
  const s = mk({ precision: 'date', periodIndex: 3 });
  const r = advance(s, { unit: 'day', n: 1 }, preset);
  assert.equal(r.state.calendar.periodIndex, 0);
});

// --- setAbsolute ------------------------------------------------------------

test('скачок вперёд в пределах суток применяется молча', () => {
  const s = mk({ time: '12:00', precision: 'datetime' });
  const r = setAbsolute(s, { day: '2024-09-03', time: '09:10' }, 'A', preset);
  assert.equal(r.applied, true);
  assert.equal(r.state.calendar.day, '2024-09-03');
  assert.equal(r.state.calendar.time, '09:10');
  assert.equal(r.state.calendar.source, 'A');
  assert.equal(r.state.calendar.moved, 1);
  assert.match(r.reason, /скачок вперёд на 1 дн/);
  assert.equal(r.state.journal.length, 0, 'скачок вперёд журнал не засоряет');
});

test('скачок вперёд дальше потолка придерживается, а не применяется', () => {
  // Вторая половина защиты 3.2: источник A читает и чужие инфоблоки соседних
  // расширений, и прыжок через сутки тащит за собой прогулы и репутацию.
  const s = mk({ time: '12:00', precision: 'datetime' });
  const r = setAbsolute(s, { day: '2024-09-05', time: '09:10' }, 'A', preset);
  assert.equal(r.applied, false);
  assert.equal(r.state.calendar.day, TERM, 'календарь остался на месте');
  assert.equal(r.state.calendar.idle, 0, 'источник сработал — простой не растёт');
  assert.deepEqual(r.held, {
    day: '2024-09-05', time: '09:10', daypart: null, jump: 3, from: TERM,
  });
  assert.equal(r.state.journal[0].kind, 'debug', 'причина ушла в отладку');
});

test('ручная правка потолок на прыжок вперёд снимает', () => {
  const s = mk({ time: '12:00', precision: 'datetime' });
  const r = setAbsolute(s, { day: '2024-12-24' }, 'manual', preset, { force: true });
  assert.equal(r.applied, true);
  assert.equal(r.state.calendar.day, '2024-12-24');
});

test('потолок на прыжок вперёд берётся из пресета', () => {
  const loose = { ...preset, limits: { ...preset.limits, maxForwardJump: 30 } };
  const r = setAbsolute(mk(), { day: '2024-09-20' }, 'A', loose, {});
  assert.equal(r.applied, true, 'пресет разрешил прыжки до месяца');
});

test('откат времени назад не применяется и уходит в отладку', () => {
  const s = mk({ day: '2024-09-05', time: '12:00', precision: 'datetime' });
  const r = setAbsolute(s, { day: '2024-09-03', time: '10:00' }, 'A', preset);
  assert.equal(r.applied, false);
  assert.equal(r.state.calendar.day, '2024-09-05', 'календарь остался на месте');
  assert.equal(r.state.calendar.time, '12:00');
  assert.equal(r.state.calendar.moved, 0);
  assert.equal(r.state.journal.length, 1);
  assert.equal(r.state.journal[0].kind, 'debug');
  assert.match(r.reason, /откат времени назад/);
  assert.equal(r.state.calendar.idle, 0, 'источник сработал, хоть и ошибся — это не простой');
});

test('откат в пределах одного дня по часам — тоже откат', () => {
  const s = mk({ time: '14:00', precision: 'datetime' });
  const r = setAbsolute(s, { day: TERM, time: '09:00' }, 'A', preset);
  assert.equal(r.applied, false);
});

test('force снимает защиту: ручной сдвиг назад проходит', () => {
  const s = mk({ day: '2024-09-05', time: '12:00', precision: 'datetime' });
  const r = setAbsolute(s, { day: '2024-09-03', time: '10:00' }, 'manual', preset, { force: true });
  assert.equal(r.applied, true);
  assert.equal(r.state.calendar.day, '2024-09-03');
  assert.equal(r.state.calendar.source, 'manual');
  assert.equal(r.state.journal.length, 1, 'ручной откат записан в журнал');
  assert.equal(r.state.journal[0].kind, 'time');
});

test('понижение точности допустимо: новая дата без часов стирает часы', () => {
  const s = mk({ time: '12:00', precision: 'datetime' });
  const r = setAbsolute(s, { day: '2024-09-03' }, 'A', preset);
  assert.equal(r.applied, true);
  assert.equal(r.state.calendar.precision, 'date');
  assert.equal(r.state.calendar.time, null, 'вчерашние часы на новый день не переносятся');
  assert.equal(r.state.calendar.periodIndex, 0);
});

test('повышение точности само не происходит: часы к голой дате не додумываются', () => {
  const s = mk({ precision: 'date', time: null, periodIndex: 2 });
  const r = setAbsolute(s, { day: '2024-09-04' }, 'A', preset);
  assert.equal(r.state.calendar.precision, 'date');
  assert.equal(r.state.calendar.time, null);
});

test('часы сохраняются, если день не изменился — это не догадка', () => {
  const s = mk({ time: '12:00', precision: 'datetime', periodIndex: 2 });
  const r = setAbsolute(s, { day: TERM }, 'A', preset);
  assert.equal(r.applied, true);
  assert.equal(r.state.calendar.time, '12:00');
  assert.equal(r.state.calendar.precision, 'datetime');
  assert.equal(r.state.calendar.periodIndex, 2, 'тот же день — счётчик пар не сбрасывается');
});

test('источник назвал часы к известному дню — точность растёт, это не догадка', () => {
  const s = mk({ precision: 'date', time: null });
  const r = setAbsolute(s, { day: TERM, time: '10:20' }, 'A', preset);
  assert.equal(r.applied, true);
  assert.equal(r.state.calendar.precision, 'datetime');
  assert.equal(r.state.calendar.time, '10:20');
});

test('часть суток кладётся рядом со временем и не двигает календарь сама', () => {
  const s = mk();
  const r = setAbsolute(s, { day: TERM, daypart: 'evening' }, 'A', preset);
  assert.equal(r.state.calendar.daypart, 'evening');
  assert.equal(r.state.calendar.day, TERM);
});

test('мусор в дате и во времени не применяется', () => {
  assert.equal(setAbsolute(mk(), { day: '2.09.2024' }, 'A', preset).applied, false);
  assert.equal(setAbsolute(mk(), { day: TERM, time: '25 часов' }, 'A', preset).applied, false);
});

// --- индикатор простоя ------------------------------------------------------

test('простой копится, порог берётся из пресета', () => {
  let s = mk();
  assert.equal(isStalled(s, preset), false);
  for (let i = 0; i < 9; i += 1) s = noteIdle(s);
  assert.equal(s.calendar.idle, 9);
  assert.equal(isStalled(s, preset), false);
  s = noteIdle(s);
  assert.equal(isStalled(s, preset), true, 'десять ответов подряд без времени — предупреждение');
});

test('сработавший источник обнуляет простой', () => {
  let s = mk();
  for (let i = 0; i < 12; i += 1) s = noteIdle(s);
  assert.equal(isStalled(s, preset), true);
  const r = advance(s, { unit: 'day', n: 1 }, preset);
  assert.equal(isStalled(r.state, preset), false);
});

test('noteIdle не правит исходное состояние', () => {
  const s = mk();
  noteIdle(s);
  assert.equal(s.calendar.idle, 0);
});

test('причина сдвига парами названа словом пресета', () => {
  // Причина уходит человеку: в отладку и в ответ `/academy-time` («Календарь не
  // сдвинулся: …»). «Пары» в магической академии там быть не может — у неё
  // «занятия». Пресеты здесь синтетические, как и весь файл: проверяется
  // движок, а не содержимое файла пресета.
  const magic = { ...preset, vocab: { periodPlural: 'занятия' } };
  const r = advance(createState(magic, { startDay: '2024-09-02' }), { unit: 'period', n: 2 }, magic);
  assert.equal(r.applied, true, JSON.stringify(r));
  assert.match(r.reason, /занятия/, `причина сдвига говорит не словом пресета: ${r.reason}`);
  assert.equal(/пар/.test(r.reason), false, r.reason);

  const ru = { ...preset, vocab: { periodPlural: 'пары' } };
  const out = advance(createState(ru, { startDay: '2024-09-02' }), { unit: 'period', n: 2 }, ru);
  assert.match(out.reason, /пары/, `у вуза это по-прежнему пары: ${out.reason}`);

  // Умолчание на пресете без словаря прежнее, иначе правка меняла бы поведение
  // там, где её не просили.
  const bare = advance(createState(preset, { startDay: '2024-09-02' }), { unit: 'period', n: 2 }, preset);
  assert.match(bare.reason, /пары/);
});

// --- alignToGrid ------------------------------------------------------------

test('смена сетки: часы встают на начало той пары, в которую попадали', () => {
  // Тот самый разнобой с живого прогона: в шапке 15:00 от старой сетки, а в
  // строке «Сейчас» — 14:05, начало пары по новой.
  const s = mk({ time: '15:00', precision: 'datetime', periodIndex: 3 });
  const other = { ...preset, bells: [
    { start: '09:00', end: '10:30' },
    { start: '10:45', end: '12:15' },
    { start: '14:05', end: '15:35' },
  ], week: { ...preset.week, periodsPerDay: 3 } };

  const r = alignToGrid(s, other);
  assert.equal(r.applied, true);
  assert.equal(r.state.calendar.time, '14:05');
  assert.equal(r.state.calendar.periodIndex, 2);
  assert.equal(r.state.calendar.day, s.calendar.day, 'день смена сетки не трогает');
});

test('смена сетки часам без сетки и без часов ничего не делает', () => {
  const noClock = alignToGrid(mk({ precision: 'date', time: null, periodIndex: 1 }), preset);
  assert.equal(noClock.applied, false);
  assert.equal(noClock.state.calendar.periodIndex, 1);

  const noBells = alignToGrid(mk({ time: '15:00', precision: 'datetime' }), { ...preset, bells: [] });
  assert.equal(noBells.applied, false);
  assert.equal(noBells.state.calendar.time, '15:00');
});

test('вечер после последнего звонка парой не притворяется', () => {
  const s = mk({ time: '23:30', precision: 'datetime' });
  const r = alignToGrid(s, preset);
  assert.equal(r.applied, false);
  assert.equal(r.state.calendar.time, '23:30', 'вечер остаётся вечером');
});

test('часы уже по сетке — привязка молчит и ничего не трогает', () => {
  const first = preset.bells[0].start;
  const s = mk({ time: first, precision: 'datetime', periodIndex: 0 });
  const r = alignToGrid(s, preset);
  assert.equal(r.applied, false);
  assert.equal(r.state.calendar.time, first);
});

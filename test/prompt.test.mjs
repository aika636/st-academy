import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createState, cloneState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { scheduleExams } from '../core/exams.mjs';
import {
  statusLine, markerInstruction, injectBlock, buildPrompt, countNumbers, DEFAULT_LABELS,
} from '../prompt.mjs';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));

const SUBJECTS = [
  { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'ivanov' },
  { id: 'history', name: 'история', teacherId: 'sidorova' },
  { id: 'math', name: 'высшая математика', teacherId: 'kuznecov' },
];
const TEACHERS = [
  { id: 'petrova', name: 'Петрова', traits: ['злопамятна'] },
  { id: 'ivanov', name: 'Иванов', traits: [] },
  { id: 'sidorova', name: 'Сидорова', traits: [] },
  { id: 'kuznecov', name: 'Кузнецов', traits: [] },
];

/** Вторник третьей недели, идёт вторая пара — та самая сцена из примера в 3.3. */
function scene(patch = {}) {
  const s = createState(preset, {
    startDay: '2024-09-02',
    subjects: SUBJECTS,
    teachers: TEACHERS,
    schedule: buildSchedule(SUBJECTS, preset),
  });
  s.started = true;
  s.calendar.day = '2024-09-17';
  s.calendar.time = '10:30';
  s.calendar.precision = 'datetime';
  return Object.assign(s, patch);
}

const withCalendar = (s, patch) => {
  const next = cloneState(s);
  Object.assign(next.calendar, patch);
  return next;
};

// --- строка состояния (3.3) --------------------------------------------------

test('до старта семестра расширение молчит', () => {
  const s = scene();
  s.started = false;
  assert.equal(statusLine(s, preset), '');
  assert.equal(statusLine(null, preset), '');
  assert.equal(buildPrompt(s, preset, {}).status, '');
});

test('строка состояния — одна, и в ней то, что влияет на сцену сейчас', () => {
  const s = scene();
  s.subjects[1].debt = true;
  s.subjects[0].grades = [{ value: '4', day: '2024-09-10' }, { value: '3', day: '2024-09-12' }];
  s.teachers[1].relation = -3;

  const line = statusLine(s, preset);
  assert.equal(line.includes('\n'), false, 'строка одна');
  assert.ok(line.startsWith('Вторник, 3-я неделя.'), line);
  assert.ok(line.includes('Сейчас: физика (Иванов)'), line);
  assert.ok(line.includes(`${cap(preset.vocab.debtPlural)}: физика`), line);
  assert.ok(line.includes('3.5'), line);
  assert.ok(line.includes('Иванов: неприязнь'), line);
  assert.ok(line.endsWith('.'), line);

  // Числа шкал наружу не выходят вовсе: только ярлыки пресета (3.3, 3.4).
  assert.equal(line.includes('-3'), false, 'отношение — словом, не числом');
  assert.equal(line.includes(String(s.reputation.value)), false, 'репутация — словом');
});

test('ровное отношение и стартовая репутация места не занимают', () => {
  const line = statusLine(scene(), preset);
  assert.equal(line.includes('ровно'), false, line);
  assert.equal(line.includes('ничем не выделяется'), false, line);
});

test('репутация появляется словом, когда съезжает со стартовой', () => {
  const s = scene();
  s.reputation.value = preset.reputation.warnAt;
  const line = statusLine(s, preset);
  assert.ok(line.endsWith('Под угрозой отчисления.'), line);
  assert.equal(line.includes(String(preset.reputation.warnAt)), false, 'число не уходит');
});

test('балла нет, пока нет ни одной оценки с весом', () => {
  const s = scene();
  s.subjects[0].grades = [{ value: 'зачёт', day: '2024-09-10' }];
  assert.equal(statusLine(s, preset).includes(preset.vocab.score), false,
    'зачёт веса не имеет — врать «балл 3.0» нельзя');
});

test('лимит чисел из пресета режет по приоритету значимости, а не с конца', () => {
  const s = scene();
  s.subjects[1].debt = true;
  s.subjects[0].grades = [{ value: '4', day: '2024-09-10' }];
  s.teachers[1].relation = -3;

  const full = statusLine(s, preset);
  assert.ok(countNumbers(full) <= preset.limits.maxNumbersInPrompt, full);

  // Потолок в одно число: неделя его забирает, средний балл остаётся за бортом,
  // а бесчисленные сегменты — текущая пара, хвосты, отношение — на месте.
  const tight = { ...preset, limits: { ...preset.limits, maxNumbersInPrompt: 1 } };
  const line = statusLine(s, tight);
  assert.equal(countNumbers(line), 1, line);
  assert.ok(line.includes('3-я неделя'), line);
  assert.ok(line.includes('Сейчас: физика'), line);
  assert.ok(line.includes('физика'), line);
  assert.ok(line.includes('Иванов: неприязнь'), line);
  assert.equal(line.includes(preset.vocab.score), false, 'средний балл вытеснен');

  // Ноль чисел — остаётся только бесчисленное, и строка всё ещё осмысленна.
  const none = statusLine(s, { ...preset, limits: { ...preset.limits, maxNumbersInPrompt: 0 } });
  assert.equal(countNumbers(none), 0, none);
  assert.ok(none.includes('Сейчас: физика'), none);
});

test('в выходной, на каникулах и ночью расписание молчит, а хвосты остаются', () => {
  const s = scene();
  s.subjects[1].debt = true;

  const sat = statusLine(withCalendar(s, { day: '2024-09-21' }), preset);
  assert.ok(sat.startsWith('Суббота, 3-я неделя, выходной.'), sat);
  assert.equal(sat.includes('Сейчас:'), false, 'в субботу пар нет');
  assert.ok(sat.includes(`${cap(preset.vocab.debtPlural)}: физика`), sat);

  const vac = statusLine(withCalendar(s, { day: '2024-11-05' }), preset);
  assert.ok(vac.includes('каникулы'), vac);
  assert.equal(vac.includes('Сейчас:'), false);

  const night = statusLine(withCalendar(s, { time: '23:40', daypart: 'night' }), preset);
  assert.equal(night.includes('Сейчас:'), false, 'ночью расписание молчит');
  assert.ok(night.includes(`${cap(preset.vocab.debtPlural)}: физика`), night);

  const late = statusLine(withCalendar(s, { time: '19:00', daypart: null }), preset);
  assert.equal(late.includes('Сейчас:'), false, 'после последней пары — тоже');
});

test('точность решает форму: часы — одна пара, только день — весь день по порядку', () => {
  const s = scene();
  const byClock = statusLine(s, preset);
  assert.ok(byClock.includes('Сейчас: физика (Иванов)'), byClock);

  const byDay = statusLine(withCalendar(s, { precision: 'date', time: null, periodIndex: 2 }), preset);
  assert.ok(byDay.includes('Сегодня: аналитическая химия, физика, история (сейчас), высшая математика'), byDay);
  assert.equal(byDay.includes('Сейчас:'), false);
});

test('на перемене строка говорит про следующую пару, а не про прошедшую', () => {
  const s = withCalendar(scene(), { time: '10:10' });
  assert.ok(statusLine(s, preset).includes('Скоро: физика (Иванов)'), statusLine(s, preset));
});

test('в сессии тон меняется: несданное и остаток времени вместо расписания', () => {
  let s = withCalendar(scene(), { day: '2024-12-24', time: '09:00' });
  s = scheduleExams(s, preset, { day: '2024-12-24' });
  s.teachers[0].relation = -3;

  const line = statusLine(s, preset);
  assert.ok(line.includes(`${cap(preset.vocab.examPeriod)}: не сдано 4, дней осталось`), line);
  assert.equal(line.includes('Сейчас:'), false, 'в сессию расписания нет');
  assert.equal(line.includes('Сегодня:'), false);
  // В кадре — преподаватель ближайшего контрольного, а не сегодняшней пары.
  assert.ok(line.includes('Петрова: неприязнь'), line);
});

// --- инструкция про метку (3.1) ---------------------------------------------

test('инструкция про метку короткая и перечисляет id, а не названия', () => {
  const s = scene();
  const text = markerInstruction(s, preset);

  assert.ok(text.includes('ACADEMY'), text);
  for (const key of ['t=', 'grade=', 'rel=', 'skip=', 'late=']) {
    assert.ok(text.includes(key), `нет ключа ${key}`);
  }
  for (const id of ['chemistry', 'physics', 'history', 'math']) assert.ok(text.includes(id), id);
  for (const id of ['petrova', 'ivanov', 'sidorova', 'kuznecov']) assert.ok(text.includes(id), id);
  assert.equal(text.includes('аналитическая химия'), false,
    'длинные имена с пробелами модель ломает — в метку идут короткие id');

  // Целевой размер — до ~60 токенов; на русском это порядка 350 знаков, и
  // потолок здесь стоит затем, чтобы инструкция не поползла при правках.
  assert.ok(text.length <= 400, `инструкция раздулась: ${text.length} знаков`);
});

test('инструкция без плана не ссылается на несуществующие предметы', () => {
  const bare = createState(preset, { startDay: '2024-09-02' });
  bare.started = true;
  const text = markerInstruction(bare, preset);
  assert.ok(text.includes('ACADEMY'), text);
  assert.equal(text.includes('Предметы:'), false, text);
  assert.equal(text.split('\n').length, 1, 'нечего перечислять — одна строка');
});

test('лексика инструкции берётся из пресета, а не из кода', () => {
  const hogwarts = {
    ...preset,
    vocab: { ...preset.vocab, period: 'lesson', teacherPlural: 'professors' },
    prompts: { ...preset.prompts, marker: 'Add [ACADEMY t=+1] ({period}).', markerIds: 'Subjects: {subjects}.' },
  };
  const text = markerInstruction(scene(), hogwarts);
  assert.ok(text.startsWith('Add [ACADEMY t=+1] (lesson).'), text);
  assert.ok(text.includes('Subjects: chemistry'), text);
  assert.ok(text.includes('Professors: petrova'), text);
});

// --- одноразовые факты (3.5) -------------------------------------------------

test('injectBlock склеивает факты одним куском и давит дубли', () => {
  assert.equal(injectBlock([]), '');
  assert.equal(injectBlock(null), '');

  const block = injectBlock([
    { id: 'exam:chemistry:1', kind: 'exam', text: 'Свершилось: химия — зачёт.' },
    { id: 'reputation-warn', kind: 'reputation', text: preset.vocab.warnInject },
    { id: 'exam:chemistry:1', kind: 'exam', text: 'Свершилось: химия — зачёт.' },
  ]);
  assert.deepEqual(block.split('\n'), ['Свершилось: химия — зачёт.', preset.vocab.warnInject]);
});

test('buildPrompt отдаёт три куска и выключает инструкцию галочкой', () => {
  const s = scene();
  const injects = [{ id: 'reputation-expel', text: preset.vocab.expelInject }];

  const on = buildPrompt(s, preset, { injects, withMarker: true });
  assert.deepEqual(Object.keys(on).sort(), ['instruction', 'oneShot', 'status']);
  assert.equal(on.status, statusLine(s, preset));
  assert.equal(on.instruction, markerInstruction(s, preset));
  assert.equal(on.oneShot, preset.vocab.expelInject);

  const off = buildPrompt(s, preset, { injects, withMarker: false });
  assert.equal(off.instruction, '', 'на тяжёлых пресетах инструкция отключается целиком');
  assert.equal(off.status, on.status, 'строка состояния от галочки не зависит');

  const bare = buildPrompt(s, preset);
  assert.equal(bare.oneShot, '');
  assert.equal(bare.instruction, markerInstruction(s, preset), 'метка включена по умолчанию');
});

// --- мелочи ------------------------------------------------------------------

test('число — цельная запись, а не цифра', () => {
  assert.equal(countNumbers('Вторник, 3-я неделя. Балл: 3.4. Сейчас: 10:15.'), 3);
  assert.equal(countNumbers('ни одного числа'), 0);
});

test('чужой пресет меняет и слова, и порядок слов, не трогая код', () => {
  const hogwarts = {
    ...preset,
    vocab: { ...preset.vocab, debtPlural: 'detentions', score: 'average', examPeriod: 'exams' },
    labels: {
      weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      day: 'week {week}, {weekday}',
      now: '{subject}{teacher} now',
      teacherOf: ' with {teacher}',
    },
  };
  const s = scene();
  s.subjects[1].debt = true;
  const line = statusLine(s, hogwarts);

  assert.ok(line.startsWith('Week 3, tuesday.'), line);
  assert.ok(line.includes('Физика with Иванов now'), line);
  assert.ok(line.includes('Detentions: физика'), line);
  assert.equal(line.includes('неделя'), false, 'ни одного русского слова из кода');

  // Незаданные поля берутся из блока данных модуля, а не падают.
  assert.ok(DEFAULT_LABELS.weekdays.length === 7);
});

const cap = (s) => s[0].toUpperCase() + s.slice(1);

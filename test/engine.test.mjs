import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createState, validateState, cloneState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { phaseOf, weekIndex } from '../core/time.mjs';
import { debts, overallScore, subjectScore } from '../core/gradebook.mjs';
import { totalStats, effectiveSkips } from '../core/attendance.mjs';
import { relationOf } from '../core/relations.mjs';
import { reputationLabel } from '../core/reputation.mjs';
import { examMode, scheduleExams } from '../core/exams.mjs';
import { applyResponse, manualTime, resolveHeldJump, sitExam, MODES } from '../core/engine.mjs';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));

// Этот файл проверяет сшивку, а не модули ядра: они уже проверены поимённо.
// Половина тестов — повтор сценариев `test/semester.test.mjs` через
// `applyResponse`: черновик `post()` оттуда и есть контракт этого модуля, и
// исход обязан совпасть до последнего числа.

const TERM_START = '2024-09-02'; // понедельник первой учебной недели

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

function semester(day) {
  const state = createState(preset, {
    startDay: TERM_START,
    subjects: SUBJECTS,
    teachers: TEACHERS,
    schedule: buildSchedule(SUBJECTS, preset),
  });
  state.started = true;
  if (day) state.calendar.day = day;
  return state;
}

/**
 * День, с которого идёт сцена, когда проверяется посещаемость. Сутки, в которые
 * семестр заведён, ведомостью не обсчитываются вовсе (`attendance.countsAttendance`),
 * поэтому прогулы считаются со следующего учебного дня — как в живой игре, где
 * семестр заводят днём, а прогуливать начинают назавтра.
 */
const DAY_TWO = '2024-09-03'; // вторник первой учебной недели


const marker = (body) => `<!-- [ACADEMY ${body}] -->`;
const tape = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

/** Прогнать ленту ответов через сшивку. */
function run(state, feed, common = {}) {
  let s = state;
  const steps = [];
  for (const item of feed) {
    const text = typeof item === 'string' ? item : item.text;
    const opts = { ...common, ...(typeof item === 'string' ? {} : item) };
    const r = applyResponse(s, text, preset, opts);
    assert.deepEqual(validateState(r.state, preset).errors, [], 'состояние остаётся валидным');
    s = r.state;
    steps.push(r);
  }
  return { state: s, steps };
}

/** Один учебный день целиком: четыре `t=+1` по числу пар в пресете. */
function studyDay(extra = {}) {
  const feed = [];
  for (let i = 0; i < preset.week.periodsPerDay; i += 1) {
    const body = extra[i] ? `t=+1 ${extra[i]}` : 't=+1';
    feed.push(`Пара идёт своим чередом.\n${marker(body)}`);
  }
  return feed;
}

// --- чистота ----------------------------------------------------------------

test('состояние на входе не мутируется ни одной веткой', () => {
  const s = semester();
  const before = JSON.stringify(s);

  applyResponse(s, `Пара идёт.\n${marker('t=+1 grade=chemistry:5 rel=petrova:-1 skip=physics')}`, preset);
  applyResponse(s, '📅 24 декабря 2024, 09:00\nСессия началась.', preset);
  applyResponse(s, 'Она молча смотрела в окно.', preset);
  applyResponse(s, `Мимо.\n${marker('t=+1 day')}`, preset);
  manualTime(s, { day: '2024-09-01' }, preset);
  manualTime(s, { shift: { unit: 'day', n: -3 } }, preset);
  sitExam(scheduleExams(cloneState(s), preset, { day: '2024-12-24' }), preset, { rng: () => 0.5 });

  assert.equal(JSON.stringify(s), before, 'входное состояние обязано остаться прежним');
});

test('очередь инжектов снимается с возвращённого состояния, а не с чужого', () => {
  let s = semester(DAY_TWO);
  s.reputation.value = 3;
  const r = applyResponse(s, `Скандал.\n${marker('t=+1 day')}`, preset);
  assert.deepEqual(r.injects.map((i) => i.id), ['reputation-expel']);
  assert.deepEqual(r.state.pending, [], 'takePending снял всё с копии');
  assert.deepEqual(s.pending, [], 'исходное состояние очереди не имело и не получило');
});

// --- режимы источника времени (3.2) -----------------------------------------

test('три режима источника времени расходятся ровно на том, кто двигает календарь', () => {
  const s = semester();
  // В одном ответе оба источника сразу: проза называет 3 сентября, метка просит
  // сдвиг на неделю (то есть 9-е). Даты разные — видно, кто победил; и обе в
  // пределах потолка на прыжок вперёд, иначе тест мерил бы не режимы, а потолок.
  const text = `📅 3 сентября 2024, 09:00\nОна вошла в аудиторию.\n${marker('t=+1 week')}`;

  const auto = applyResponse(s, text, preset, { mode: 'auto' });
  assert.equal(auto.state.calendar.day, '2024-09-03', 'авто: победила проза');
  assert.equal(auto.debug.source, 'A');

  const ctx = applyResponse(s, text, preset, { mode: 'context' });
  assert.equal(ctx.state.calendar.day, '2024-09-03');
  assert.equal(ctx.debug.source, 'A');

  const mk = applyResponse(s, text, preset, { mode: 'marker' });
  assert.equal(mk.state.calendar.day, '2024-09-09', 'метка: сдвиг на неделю от 2-го');
  assert.equal(mk.debug.source, 'B');

  assert.deepEqual(MODES, ['auto', 'context', 'marker']);
});

test('режим «из контекста» метку как источник времени не разбирает вовсе', () => {
  const s = semester();
  const r = applyResponse(s, `Пара идёт.\n${marker('t=+1 day')}`, preset, { mode: 'context' });

  assert.equal(r.state.calendar.day, TERM_START, 'календарь стоит: время из метки запрещено');
  assert.equal(r.debug.moved, false);
  assert.equal(r.debug.source, null);
  assert.equal(r.state.calendar.idle, 1, 'источник A промолчал — это простой');
  assert.deepEqual(r.missed, [], 'никто никуда не прыгал — прогулов нет');
});

test('режим «из контекста» оставляет метку единственным каналом оценок и прогулов', () => {
  const s = semester();
  const body = 't=+1 day grade=chemistry:4 rel=petrova:-1 skip=physics';
  const r = applyResponse(s, `Разбор полётов.\n${marker(body)}`, preset, { mode: 'context' });

  assert.equal(subjectScore(r.state, 'chemistry', preset).grades[0].value, '4', 'оценка применилась');
  assert.equal(relationOf(r.state, 'petrova'), -1, 'отношение применилось');
  assert.equal(totalStats(r.state).skips, 1, 'прогул из метки применился');
  assert.equal(r.state.calendar.day, TERM_START, 'а время — нет');
});

test('режим «своя метка» прозу не читает', () => {
  const s = semester();
  const r = applyResponse(s, '📅 5 сентября 2024, 09:00\nОна вошла в аудиторию.', preset, { mode: 'marker' });
  assert.equal(r.state.calendar.day, TERM_START);
  assert.equal(r.state.calendar.idle, 1, 'метки нет — простой');
  assert.equal(r.debug.source, null);
});

test('в «авто» метка подстраховывает молчание прозы, но не её ошибку', () => {
  const s = semester();

  // Проза молчит — работает метка.
  const b = applyResponse(s, `Пара идёт.\n${marker('t=+1 day')}`, preset);
  assert.equal(b.state.calendar.day, '2024-09-03');
  assert.equal(b.debug.source, 'B');

  // Проза высказалась и была отвергнута календарём (откат назад) — метка на
  // подмену не идёт: расходиться с видимым текстом нельзя ни в какую сторону.
  const moved = applyResponse(s, `Первая неделя позади.\n${marker('t=+1 week')}`, preset).state;
  assert.equal(moved.calendar.day, '2024-09-09');

  const back = applyResponse(moved, `📅 3 сентября 2024, 09:00\nВсё сначала.\n${marker('t=+1 day')}`, preset);
  assert.equal(back.state.calendar.day, '2024-09-09', 'откат отклонён, метка не подставлена');
  assert.equal(back.debug.source, 'A');
  assert.equal(back.debug.moved, false);
  assert.ok(back.notes.some((n) => n.startsWith('откат времени назад')), JSON.stringify(back.notes));
});

test('относительные сдвиги словами включаются опцией, а не сами', () => {
  const s = semester();
  const text = 'Прошло два дня, и ничего не изменилось.';

  const off = applyResponse(s, text, preset);
  assert.equal(off.state.calendar.day, TERM_START, 'по умолчанию словарь выключен');
  assert.equal(off.state.calendar.idle, 1);

  const on = applyResponse(s, text, preset, { relativeWords: true });
  assert.equal(on.state.calendar.day, '2024-09-04', 'с галочкой «прошло два дня» двигает календарь');
  assert.equal(on.debug.source, 'A');
});

// --- отладка (3.2) ----------------------------------------------------------

test('debug показывает, что пришло, что сработало и что отброшено', () => {
  const s = semester();
  const body = 't=+night grade=биология:5 grade=chemistry:4 skip=physics';
  const r = applyResponse(s, `Странный день.\n${marker(body)}`, preset);

  assert.equal(r.debug.marker, marker(body), 'сырая метка видна целиком');
  assert.deepEqual(r.debug.rejected.map((x) => x.raw), ['t=+night', 'grade=биология:5']);
  assert.deepEqual(r.debug.applied.map((x) => x.kind).sort(), ['attendance', 'grade']);
  assert.equal(r.debug.moved, false);
  assert.equal(r.debug.source, null, 'ни один источник не высказался');
  assert.equal(r.debug.idle, 1);
  assert.equal(r.debug.stalled, false);
  assert.equal(r.debug.mode, 'auto');
});

test('debug.stalled загорается ровно на пороге пресета, а не раньше', () => {
  let s = semester();
  const limit = preset.limits.idleWarnAfter;
  let last = null;
  for (let i = 0; i < limit; i += 1) {
    last = applyResponse(s, 'Она смотрела в окно.', preset);
    s = last.state;
    assert.equal(last.debug.stalled, i + 1 >= limit, `шаг ${i + 1}`);
  }
  assert.equal(last.debug.idle, limit);

  const alive = applyResponse(s, `Наконец звонок.\n${marker('t=+1')}`, preset);
  assert.equal(alive.debug.stalled, false, 'сработавший источник гасит индикатор');
  assert.equal(alive.debug.idle, 0);
});

// --- ручной ремонт календаря ------------------------------------------------

test('manualTime — единственное место, где календарь едет назад', () => {
  const s = semester();
  const forward = applyResponse(s, `Неделя прошла.\n${marker('t=+1 week')}`, preset).state;
  assert.equal(forward.calendar.day, '2024-09-09');

  // То же самое из метки — отказ.
  const byMarker = applyResponse(forward, `Всё сначала.\n${marker('t=-3 day')}`, preset);
  assert.equal(byMarker.state.calendar.day, '2024-09-09');

  // Руками — проходит, и обеими формами.
  const byShift = manualTime(forward, { shift: { unit: 'day', n: -3 } }, preset);
  assert.equal(byShift.applied, true);
  assert.equal(byShift.state.calendar.day, '2024-09-06');
  assert.equal(byShift.state.calendar.source, 'manual');

  const byDate = manualTime(forward, { day: '2024-09-03', time: '08:30' }, preset);
  assert.equal(byDate.applied, true);
  assert.equal(byDate.state.calendar.day, '2024-09-03');
  assert.equal(byDate.state.calendar.time, '08:30');
  assert.equal(byDate.state.calendar.precision, 'datetime');
  assert.equal(byDate.state.calendar.source, 'manual');

  // Число вместо объекта — пары: панель двигает календарь именно ими.
  const byPeriods = manualTime(forward, { shift: 2 }, preset);
  assert.equal(byPeriods.applied, true);
  assert.equal(byPeriods.state.calendar.periodIndex, 2);
});

test('manualTime не выдумывает ничего сверх ядра: битая дата — отказ с причиной', () => {
  const s = semester();
  const r = manualTime(s, { day: 'позавчера' }, preset);
  assert.equal(r.applied, false);
  assert.equal(r.state.calendar.day, TERM_START);
  assert.ok(r.reason.includes('ГГГГ-ММ-ДД'), r.reason);
  assert.equal(r.state.calendar.source, null, 'неудача источником не считается');
});

// --- сессия -----------------------------------------------------------------

test('sitExam считает исход до модели и подаёт его одноразовым инжектом', () => {
  let s = semester();
  s.calendar.day = '2024-12-24';
  s = scheduleExams(s, preset, { day: '2024-12-24' });

  // Лента 0.1 — это d20 = 3 (`exams.rollDie`). До 9.4.1 здесь стояло 0.5, и
  // взвешенная сумма на стартовом балле давала незачёт; у проверки против DC
  // середина кубика (11) на стартовом балле уже проходит зачёт (DC 9 = 7 база
  // + 2 за злопамятную Петрову), так что провал нужен низким броском.
  const r = sitExam(s, preset, { rng: tape(0.1) });
  assert.equal(r.applied, true);
  assert.equal(r.exam.check.roll, 3, 'бросок из ленты, а не из Math.random');
  assert.ok(r.exam.check.dc > r.exam.check.roll, `DC ${r.exam.check.dc} выше броска — провал`);
  assert.ok(r.permission.includes(preset.vocab.examPeriod), 'фраза разрешения собрана');
  // Незачёт с оставшимися пересдачами из списка несданного не выпадает: его
  // ещё предстоит пересдать (`exams.unfinished`). Выпадает сданное и то, что
  // исчерпало попытки, — там уже не пересдача, а хвост.
  const done = r.state.exams.items.find((i) => i.id === r.exam.examId);
  assert.equal(done.attempts, 1, 'попытка засчитана');
  assert.equal(done.outcome, r.exam.value, 'исход записан в само событие');
  assert.equal(examMode(r.state, preset).pending.length, 4, 'незачёт остаётся несданным');
  assert.equal(r.state.pending.length, 1, 'ровно один одноразовый факт');
  assert.equal(r.state.pending[0].kind, 'exam');
  assert.equal(r.exam.subjectId, s.exams.items[0].subjectId);

  const empty = sitExam(semester(), preset, { rng: () => 0.5 });
  assert.equal(empty.applied, false, 'сессии нет — садиться не за что');
  assert.equal(empty.exam, null);
});

test('sitExam принимает версию модели, когда та уже отыграла исход', () => {
  let s = semester();
  s.calendar.day = '2024-12-24';
  s = scheduleExams(s, preset, { day: '2024-12-24' });
  const item = s.exams.items.find((i) => i.kind === 'exam');

  const straight = sitExam(s, preset, { rng: tape(0.5), examId: item.id });
  assert.equal(straight.divergence, null);
  const computed = straight.exam.value;

  const said = computed === '2' ? '5' : '2';
  const conflict = sitExam(s, preset, { rng: tape(0.5), examId: item.id, modelSaid: said });
  assert.equal(conflict.divergence.applied, true);
  assert.equal(conflict.divergence.computed, computed);
  assert.equal(conflict.exam.value, said, 'наружу уходит версия модели');
  assert.equal(conflict.state.exams.items.find((i) => i.id === item.id).modelOverride, true);
  // Инжект «отыграй этот исход» стал ложью в тот момент, когда модель отыграла
  // свой, и снимается целиком: приказывать отыграть уже написанное нечего.
  assert.deepEqual(conflict.state.pending, []);
  assert.ok(conflict.state.journal.some((e) => e.kind === 'exam' && e.text.includes('Расхождение')));
});

// --- 8.1: кто выставляет оценку — модель или бросок --------------------------
//
// Граница проведена в `applyResponse`: `grade=` по предмету сегодняшнего
// контрольного — это исход контрольного, всё остальное — обычная оценка.
// Проверяется она исполнением всей цепочки от текста метки, а не вызовом
// `resolveConflict` руками: руками он вызывался и до шва, а живьём в него никто
// не входил.

/** Сессия, заведённая на дне контрольных: события уже расписаны. */
function session(day = '2024-12-24') {
  let s = semester(day);
  s = scheduleExams(s, preset, { day });
  return s;
}

const gradesOf = (s, id) => s.subjects.find((x) => x.id === id).grades;
const divergencesOf = (s) => s.journal.filter((e) => e.data && e.data.modelSaid !== undefined);

test('оценка от модели в день контрольного — исход этого контрольного, а не вторая запись (8.1)', () => {
  const s = session();
  const item = s.exams.items.find((i) => !i.outcome);
  const before = gradesOf(s, item.subjectId).length;

  const said = '5';
  const r = applyResponse(s, `Экзамен сдан. ${marker(`grade=${item.subjectId}:${said}`)}`, preset, {
    exam: true, examId: item.id, rng: tape(0),
  });

  const done = r.state.exams.items.find((i) => i.id === item.id);
  assert.equal(done.outcome, said, 'в событии стоит версия модели');
  assert.equal(done.modelOverride, true);
  assert.equal(gradesOf(r.state, item.subjectId).length, before + 1,
    'оценка появилась ровно один раз: маршрут, а не addGrade рядом с броском');
  assert.equal(gradesOf(r.state, item.subjectId).pop().value, said);
  assert.equal(r.divergence.applied, true, 'расхождение уехало наружу для панели');
  assert.notEqual(r.divergence.computed, said, 'бросок при rng=0 отличается — иначе спорить не о чем');
  assert.equal(divergencesOf(r.state).length, 1, 'и записано в журнал одной строкой');
});

test('оценка в первый же день сессии находит контрольное, заведённое тем же ответом (8.1)', () => {
  // Порядок шагов: сессию заводит `scheduleExams` внутри того же прохода, и
  // оценка, разобранная до него, не нашла бы события вовсе — ушла бы в зачётку
  // второй записью рядом с брошенной.
  const eve = semester('2024-12-22');
  // Какое контрольное выпадет — считает движок, а не тест: сухой прогон того же
  // ответа без оценки.
  const dry = applyResponse(eve, `Сессия. ${marker('t=+1 day')}`, preset, { exam: true, rng: tape(0) });
  const subjectId = dry.exam.subjectId;

  const r = applyResponse(eve, `Сессия, и сразу пятёрка. ${marker(`t=+1 day grade=${subjectId}:5`)}`, preset, {
    exam: true, rng: tape(0),
  });

  assert.equal(r.state.exams.active, true, 'сессия заведена этим же ответом');
  assert.equal(r.exam.value, '5', 'исход наружу уходит версией модели');
  assert.equal(gradesOf(r.state, subjectId).length, 1, 'и в зачётке она одна');
  assert.equal(r.divergence.applied, true);
});

test('оценка по предмету, за который сегодня не садились, остаётся обычной оценкой (8.1)', () => {
  const s = session();
  const item = s.exams.items.find((i) => !i.outcome);
  const other = s.subjects.find((x) => x.id !== item.subjectId);
  const before = gradesOf(s, other.id).length;

  const r = applyResponse(s, `Отработка зачёта. ${marker(`grade=${other.id}:4`)}`, preset, {
    exam: true, examId: item.id, rng: tape(0),
  });

  assert.equal(gradesOf(r.state, other.id).length, before + 1);
  assert.equal(gradesOf(r.state, other.id).pop().value, '4');
  assert.deepEqual(divergencesOf(r.state), [], 'ни с чем не спорили — расхождения нет');
  assert.equal(r.state.exams.items.find((i) => i.subjectId === other.id).outcome ?? null, null,
    'чужое контрольное оценкой не закрывается');
});

test('оценка вне сессии в конфликт не уходит: контрольного сегодня нет (8.1)', () => {
  const s = semester('2024-09-03');
  const r = applyResponse(s, `Опрос у доски. ${marker('grade=physics:4')}`, preset, { sitsExam: true });
  assert.equal(gradesOf(r.state, 'physics').length, 1);
  assert.deepEqual(divergencesOf(r.state), []);
  assert.equal(r.modelSaid, null, 'придерживать нечего');
});

test('оценка не из шкалы до маршрута не доходит: её отбраковывает метка (8.1)', () => {
  // Ветка `resolveConflict` «значения нет в шкале» через `grade=` недостижима:
  // `parse-marker` сверяет значение со шкалой раньше движка и кладёт событие в
  // `rejected`. Проверка стоит здесь именно затем, чтобы это было решением, а не
  // догадкой: если разбор когда-нибудь подобреет, красный тест скажет, что
  // ветка ожила и её маршрут надо посмотреть заново.
  let s = session();
  const item = s.exams.items.find((i) => !i.outcome);
  // Бросок уже был — сегодняшний день у события проставлен, спорить есть с чем.
  s = applyResponse(s, 'Экзамен.', preset, { exam: true, examId: item.id, rng: tape(0) }).state;
  const computed = s.exams.items.find((i) => i.id === item.id).outcome;
  const before = gradesOf(s, item.subjectId).length;

  const r = applyResponse(s, `Блестяще! ${marker(`grade=${item.subjectId}:блестяще`)}`, preset, {
    sitsExam: true,
  });

  assert.ok(r.rejected.some((x) => /блестяще/.test(JSON.stringify(x))), 'метка забраковала значение');
  assert.equal(r.state.exams.items.find((i) => i.id === item.id).outcome, computed,
    'посчитанное осталось стоять');
  assert.equal(gradesOf(r.state, item.subjectId).length, before,
    'и второй оценки в зачётке не появилось');
  assert.deepEqual(divergencesOf(r.state), [], 'спорить было нечем — расхождения нет');
});

test('у предмета с двумя контрольными оценка достаётся сегодняшнему (8.1)', () => {
  const s = session();
  const item = s.exams.items.find((i) => !i.outcome);
  // Второе событие того же предмета: у русского пресета их по одному на предмет,
  // а вопрос «какому из двух достанется оценка» от пресета не зависит.
  const twin = { ...item, id: `${item.id}:2`, outcome: null, attempts: 0 };
  s.exams.items.push(twin);

  const r = applyResponse(s, `Сдано. ${marker(`grade=${item.subjectId}:5`)}`, preset, {
    exam: true, examId: item.id, rng: tape(0),
  });

  assert.equal(r.state.exams.items.find((i) => i.id === item.id).outcome, '5');
  assert.equal(r.state.exams.items.find((i) => i.id === twin.id).outcome ?? null, null,
    'второе контрольное того же предмета осталось несданным');
  assert.equal(gradesOf(r.state, item.subjectId).length, 1, 'и оценка всё равно одна');
});

test('придержанную оценку движок отдаёт только тому, кто обещал сесть за контрольное (8.1)', () => {
  // Без обещания (`exam`/`sitsExam`) оценка идёт обычным путём: вызывающий, не
  // бросающий исход, иначе молча терял бы её вовсе.
  const s = session();
  const item = s.exams.items.find((i) => !i.outcome);
  const text = `Экзамен. ${marker(`grade=${item.subjectId}:5`)}`;

  const plain = applyResponse(s, text, preset, {});
  assert.equal(gradesOf(plain.state, item.subjectId).length, 1, 'оценка не потерялась');
  assert.equal(plain.modelSaid, null);
  assert.equal(plain.state.exams.items.find((i) => i.id === item.id).outcome ?? null, null);

  const promised = applyResponse(s, text, preset, { sitsExam: true });
  assert.deepEqual(
    { examId: promised.modelSaid.examId, value: promised.modelSaid.value },
    { examId: item.id, value: '5' },
    'обещавшему она уезжает придержанной — бросать будет он',
  );
  assert.equal(gradesOf(promised.state, item.subjectId).length, 0, 'и в зачётку сама не идёт');
});

test('вход в сессию заводится календарём один раз, а не на каждом ответе', () => {
  let s = semester();
  s.calendar.day = '2024-12-23';

  const jump = applyResponse(s, '📅 24 декабря 2024, 09:00\nСессия началась.', preset);
  s = jump.state;
  assert.equal(phaseOf(preset, s, s.calendar.day), 'exams');
  assert.equal(s.exams.active, true);
  assert.equal(s.exams.items.length, 4);
  assert.ok(jump.debug.applied.some((x) => x.kind === 'exams-scheduled'));

  const again = applyResponse(s, `Аудитория.\n${marker('t=+1 day')}`, preset);
  assert.equal(again.state.exams.items.length, 4, 'повторно ничего не назначается');
  assert.ok(!again.debug.applied.some((x) => x.kind === 'exams-scheduled'));
});

// --- совпадение с черновиком post() -----------------------------------------

test('прилежная студентка: applyResponse даёт тот же исход, что post() из semester.test', () => {
  let s = semester();
  s.calendar.day = '2024-12-02';
  assert.equal(weekIndex(s), 14);

  const feed = [];
  for (let d = 0; d < 15; d += 1) {
    const extra = {};
    if (d % 3 === 0) {
      for (let i = 0; i < SUBJECTS.length; i += 1) extra[i] = `grade=${SUBJECTS[i].id}:${(d + i) % 2 === 0 ? '5' : '4'}`;
    }
    if (d % 5 === 0) extra[0] = `${extra[0] || ''} rel=petrova:+1`.trim();
    feed.push(...studyDay(extra));
  }
  ({ state: s } = run(s, feed));

  const att = totalStats(s);
  assert.equal(att.skips, 0);
  assert.equal(att.present, 60);
  assert.equal(debts(s).length, 0);
  assert.equal(s.reputation.warned, false);
  assert.equal(s.reputation.expelled, false);
  assert.equal(relationOf(s, 'petrova'), 3);

  const jump = applyResponse(s, '📅 24 декабря 2024, 09:00\nСессия началась.', preset);
  s = jump.state;
  assert.equal(s.exams.active, true);
  assert.equal(s.exams.items.length, 4);
  assert.deepEqual(jump.missed, []);

  const rng = tape(0.5, 0.5, 0.5, 0.5);
  const session = [];
  for (let i = 0; i < 4; i += 1) {
    session.push({ text: `Аудитория, ведомость на столе.\n${marker('t=+1 day')}`, exam: true, rng });
  }
  const done = run(s, session);
  s = done.state;

  assert.equal(examMode(s, preset).pending.length, 0);
  assert.equal(debts(s).length, 0);
  assert.ok(s.exams.items.every((i) => i.attempts === 1));
  // До 9.4.1 здесь стояло `exam=4`: взвешенная сумма на середине ленты давала
  // вторую ступень. Проверка против DC у прилежной студентки (балл ≈ 4.5,
  // Петрова благоволит) даёт DC ниже нуля, и середина кубика (11) идёт с
  // запасом больше `critMargin` — крит, высшая оценка. Так и задумано: высшая
  // оценка — за блестящую сдачу, а блестяще сдаёт та, кому было легко.
  assert.deepEqual(s.exams.items.map((i) => `${i.kind}=${i.outcome}`),
    ['credit=зачёт', 'exam=5', 'credit=зачёт', 'exam=5']);

  const score = overallScore(s, preset);
  assert.ok(score > 4 && score <= 5, `итоговый балл: ${score}`);
  assert.equal(s.reputation.value, preset.reputation.start + 4 * preset.reputation.delta.examPassed);
  assert.equal(s.reputation.expelled, false);

  for (const step of done.steps) {
    // Итог письменного экзамена объявляют на следующий учебный день (9.4.3):
    // рядом с вердиктом дня может стоять объявление вчерашнего — своим фактом.
    const verdicts = step.injects.filter((i) => i.kind === 'exam');
    assert.equal(verdicts.length, 1, 'один вердикт на одно контрольное событие');
    assert.ok(step.injects.every((i) => i.kind === 'exam' || i.kind === 'announce'), JSON.stringify(step.injects));
    assert.ok(step.permission.includes(preset.vocab.examPeriod));
  }
  assert.deepEqual(s.pending, []);
});

test('прогульщица: тот же исход и те же пороги ровно по разу', () => {
  let s = semester(DAY_TWO);
  const before = s.reputation.value;

  const feed = [];
  for (let d = 0; d < 4; d += 1) feed.push(`Она снова не пошла.\n${marker('t=+1 day')}`);
  const { state: after, steps } = run(s, feed);
  s = after;

  const att = totalStats(s);
  assert.equal(att.present, 0);
  assert.ok(att.skips >= 12, `прогулов: ${att.skips}`);
  assert.equal(effectiveSkips(s, 'chemistry', preset) >= preset.attendance.debtAfterSkips, true);
  assert.equal(debts(s).length, 4);

  assert.ok(s.reputation.value < before);
  assert.equal(s.reputation.value, preset.reputation.min);
  assert.equal(s.reputation.warned, true);
  assert.equal(s.reputation.expelled, true);
  assert.equal(reputationLabel(s, preset), 'отчислена');

  const kinds = steps.map((st) => st.injects.map((i) => i.id));
  assert.deepEqual(kinds, [[], ['reputation-warn'], ['reputation-expel'], []], JSON.stringify(kinds));
  assert.deepEqual(s.pending, []);
  assert.equal(steps[1].injects[0].text, preset.vocab.warnInject);
  assert.equal(steps[2].injects[0].text, preset.vocab.expelInject);
});

test('кривая метка: мусор в rejected, годное из того же блока применяется', () => {
  let s = semester();
  s = applyResponse(s, `Первая пара.\n${marker('t=+1')}`, preset).state;

  const r = applyResponse(s, [
    'Петрова придиралась всю пару.',
    marker('t=+night grade=биология:5 grade=физика:отл rel=petrova:+9 grade=аналитическая химия:4 skip=история'),
  ].join('\n'), preset);
  s = r.state;

  assert.deepEqual(r.rejected.map((x) => x.raw), ['t=+night', 'grade=биология:5', 'grade=физика:отл']);
  assert.equal(subjectScore(s, 'chemistry', preset).grades.length, 1);
  assert.equal(relationOf(s, 'petrova'), preset.relations.max);
  assert.equal(totalStats(s).skips, 1);
  assert.equal(s.calendar.day, TERM_START);
  assert.equal(s.calendar.idle, 1, 'ответ, в котором время не разобралось, считается простоем');
});

test('ручной сдвиг ведомость не трогает, но говорит, сколько бы зачлось', () => {
  // Решение прежнее — ремонт календаря не наказывает за день, которого не
  // играли, — а вот молчание было дефектом: человек двигал время и не знал,
  // что прогулы, репутация и отношения при этом не наступают вовсе.
  const s = semester(DAY_TWO);
  const r = manualTime(s, { shift: { unit: 'day', n: 1 } }, preset);

  assert.equal(r.applied, true);
  assert.deepEqual(r.missed, [], 'без просьбы ведомость чистая');
  assert.deepEqual(r.state.attendance.records, []);
  assert.equal(r.state.reputation.value, preset.reputation.start);
  assert.equal(r.wouldMiss, preset.week.periodsPerDay, 'но сколько бы зачлось — известно');
});

test('ручной сдвиг с count зачитывает пропущенное как обычное движение времени', () => {
  const s = semester(DAY_TWO);
  const r = manualTime(s, { shift: { unit: 'day', n: 1 }, count: true }, preset);

  assert.equal(r.applied, true);
  assert.equal(r.missed.length, preset.week.periodsPerDay);
  assert.equal(r.wouldMiss, 0, 'зачтённое дважды не предлагается');
  assert.ok(r.state.reputation.value < preset.reputation.start, 'последствия настоящие');
  assert.ok(r.state.attendance.records.length, 'записи в ведомости появились');
});

test('ручной сдвиг никуда — ведомости не касается вовсе', () => {
  const s = semester(DAY_TWO);
  const r = manualTime(s, { shift: { unit: 'day', n: 0 }, count: true }, preset);
  assert.deepEqual(r.missed, []);
  assert.equal(r.wouldMiss, 0);
});

test('«не надо» прыжок забывает, календарь остаётся на месте', () => {
  const s = semester();
  const r = applyResponse(s, '📅 19 октября 2024, 08:30\nЛекция началась.', preset);
  assert.ok(r.heldJump, 'прыжок придержан');

  const no = resolveHeldJump(r.state, preset, false);
  assert.equal(no.applied, false);
  assert.equal(no.state.calendar.day, TERM_START, 'календарь не двинулся');
  assert.equal(no.state.calendar.heldJump, null, 'и вопрос больше не задаётся');
  assert.deepEqual(no.missed, []);
});

test('придержанный прыжок протухает, как только время пошло само', () => {
  // Иначе однажды панель предложит прыгнуть «отсюда туда» из позапрошлого дня.
  const s = semester();
  const held = applyResponse(s, '📅 19 октября 2024, 08:30\nЛекция началась.', preset);
  assert.ok(held.state.calendar.heldJump);

  const moved = applyResponse(held.state, `Пара идёт.\n${marker('t=+1 day')}`, preset);
  assert.equal(moved.debug.moved, true);
  assert.equal(moved.state.calendar.heldJump, null);
  assert.equal(moved.heldJump, null);
});

test('принятый прыжок в сессию её открывает — как это сделал бы ответ модели', () => {
  const s = semester();
  const held = applyResponse(s, '📅 24 декабря 2024, 09:00\nСессия.', preset);
  const yes = resolveHeldJump(held.state, preset, true);

  assert.equal(yes.state.exams.active, true, 'сессию заводит календарь, а не ответ модели');
  assert.ok(yes.state.exams.items.length);
});

test('прыжок дальше горизонта не даёт ни одного прогула, ближний — даёт', () => {
  const s = semester(DAY_TWO);
  const horizon = preset.attendance.inferHorizonDays;

  const held = applyResponse(s, '📅 24 декабря 2024, 09:00\nОна вернулась после долгого перерыва.', preset);
  assert.equal(held.heldJump.day, '2024-12-24', 'три месяца вперёд — сперва вопрос человеку');

  // Принятый прыжок идёт тем же путём, что обычное движение времени: горизонт
  // вывода прогулов работает и здесь, иначе «принять» стоило бы человеку
  // семестра прогулов задним числом.
  const far = resolveHeldJump(held.state, preset, true);
  assert.equal(far.state.calendar.day, '2024-12-24');
  assert.deepEqual(far.missed, []);
  assert.deepEqual(far.state.attendance.records, []);
  assert.equal(far.state.reputation.value, preset.reputation.start);
  assert.equal(far.state.reputation.expelled, false);

  const near = applyResponse(s, `Четыре дня как в тумане.\n${marker(`t=+${horizon - 3} day`)}`, preset);
  assert.equal(near.missed.length, (horizon - 3) * preset.week.periodsPerDay);
  assert.ok(near.state.reputation.value < preset.reputation.start);
  assert.ok(near.debug.applied.some((x) => x.kind === 'missed'));
});

test('сдвиг больше потолка пресета календарь не двигает, причина уходит в notes', () => {
  const s = semester();
  const r = applyResponse(s, `Прошло полгода.\n${marker(`t=+${preset.limits.maxTimeShift + 10} day`)}`, preset);
  assert.equal(r.state.calendar.day, TERM_START);
  assert.ok(r.notes.some((n) => n.includes('потолка')), JSON.stringify(r.notes));
  assert.deepEqual(r.missed, []);
  assert.equal(r.debug.moved, false);
});

/* --- дата без года (поймано на живой таверне 1.18.0) ------------------------ */

test('дата без года достраивается годом календаря, а не теряется', () => {
  // Год в отыгрыше почти никогда не пишут: «📅 Среда, 3 сентября | 🕰 10:15».
  // До этой правки такой пост двигал часы и не двигал дату — календарь навсегда
  // застревал в одном дне, и это было ровно то «время не идёт», ради которого
  // писалась вкладка отладки.
  const s = semester();
  const r = applyResponse(s, '📅 Вторник, 3 сентября | 🕰 10:15\nОна вошла в аудиторию.', preset);

  assert.equal(r.state.calendar.day, '2024-09-03', 'год взят из календаря');
  assert.equal(r.state.calendar.time, '10:15');
  assert.equal(r.state.calendar.source, 'A');
  assert.equal(r.debug.moved, true);
});

test('написанный в тексте год сильнее подставленного', () => {
  // Полтора месяца вперёд — прыжок дальше потолка, и календарь придерживает его
  // до слова человека. Разобранная дата от этого не меняется: год в ней тот,
  // что написан в тексте, и виден он теперь в придержанном прыжке.
  const s = semester();
  const r = applyResponse(s, '📅 19 октября 2024, 08:30\nЛекция началась.', preset);
  assert.equal(r.state.calendar.day, TERM_START, 'сам по себе прыжок не применился');
  assert.equal(r.heldJump.day, '2024-10-19');

  const ok = resolveHeldJump(r.state, preset, true);
  assert.equal(ok.state.calendar.day, '2024-10-19');
  assert.equal(ok.state.calendar.heldJump, null, 'отвеченный прыжок из состояния уходит');
});

test('переход через Новый год: январь после декабря идёт вперёд, а не на год назад', () => {
  // Учебный год через январь переваливает у всех трёх пресетов, так что случай
  // обычный. С годом календаря «3 января» уехало бы на одиннадцать месяцев
  // назад и было бы отвергнуто как откат — то есть время снова не пошло бы.
  // До декабря доезжаем ручной правкой: прыжок туда одним ответом модели
  // придерживается потолком, а тест не про потолок.
  const s = manualTime(semester(), { day: '2024-12-28', time: '09:00' }, preset).state;

  const jan = applyResponse(s, '📅 3 января | 🕰 11:00\nКаникулы кончились.', preset);
  assert.equal(jan.heldJump.day, '2025-01-03', 'год подставлен со сдвигом на следующий');
  assert.equal(resolveHeldJump(jan.state, preset, true).state.calendar.day, '2025-01-03');
});

test('настоящий флешбэк с написанным годом поправкой на Новый год не трогается', () => {
  // Год написан руками — значит это воля автора поста, а не наша подстановка.
  // Откат такой датой всё равно не применится, но и переписывать её на
  // следующий год расширение не вправе.
  const s = manualTime(semester(), { day: '2024-12-28', time: '09:00' }, preset).state;
  const back = applyResponse(s, '📅 3 января 2023, 11:00\nГод назад всё было иначе.', preset);

  assert.equal(back.state.calendar.day, '2024-12-28', 'откат назад по-прежнему не применяется');
  assert.equal(back.state.calendar.heldJump, null, 'откат придерживать нечего — он не прыжок');
  assert.ok(back.notes.some((n) => n.includes('откат')), JSON.stringify(back.notes));
});

/* --- сутки заведения семестра (поймано на живой таверне, `etap-live.md`) ---- */

// Дефект был такой: семестр завели 1 сентября, первый же ответ модели перевёл
// время на 2 сентября — и в состояние легли четыре прогула за день, которого не
// было ни у кого. Репутация 50 → 34, единственный преподаватель проехал
// «ровно → недоволен → неприязнь → ненавидит» за один ответ.
//
// Решение владелицы: **сутки, в которые семестр заведён, посещаемостью не
// обсчитываются вовсе**. Календарь дальше работает как раньше — это одно
// исключение, а не поблажка на первую неделю.

/** Семестр, заведённый в указанный день; сцена стоит в нём же. */
function foundedOn(startDay) {
  const state = createState(preset, {
    startDay,
    subjects: SUBJECTS,
    teachers: TEACHERS,
    schedule: buildSchedule(SUBJECTS, preset),
  });
  state.started = true;
  return state;
}

const MONDAY = '2025-09-01'; // 1 сентября 2025 — понедельник, как в живом прогоне

test('первый ответ в семестре не приносит прогулов за день заведения', () => {
  const s = foundedOn(MONDAY);
  const r = applyResponse(s, '📅 2 сентября 2025, 09:00\nОна проснулась в общежитии.', preset);

  assert.equal(r.state.calendar.day, '2025-09-02', 'время едет как раньше');
  assert.deepEqual(r.missed, [], 'ни одного прогула за сутки заведения');
  assert.deepEqual(r.state.attendance.records, [], 'ведомость пуста: считать этот день не с чего');
  assert.equal(r.state.reputation.value, preset.reputation.start, 'репутация 50 осталась 50');
  assert.equal(relationOf(r.state, 'petrova'), preset.relations.start,
    'преподаватель не проехал четыре ярлыка за один ответ');
  assert.deepEqual(debts(r.state), []);
  assert.ok(
    r.state.journal.some((e) => e.kind === 'attendance' && e.text.includes('сутки заведения семестра')),
    'причина названа в журнале, а не умолчана',
  );
});

test('семестр заводят посреди дня: ни прогулов, ни присутствия за эти сутки', () => {
  // Анкету заполняют днём, а `termStart` — дата, а не момент. Обе половины
  // ведомости за эти сутки одинаково выдуманы, поэтому не пишется ни одна.
  const s = foundedOn(MONDAY);
  s.calendar.time = '14:00';
  s.calendar.precision = 'datetime';

  let acc = s;
  for (let i = 0; i < preset.week.periodsPerDay; i += 1) {
    acc = applyResponse(acc, `Пара идёт.\n${marker('t=+1')}`, preset).state;
  }
  assert.deepEqual(acc.attendance.records.filter((r) => r.day === MONDAY), [],
    'за сутки заведения не записано ничего');

  // А в следующем дне ведомость заполняется как обычно.
  const next = applyResponse(acc, `Ещё день.\n${marker('t=+1 day')}`, preset);
  assert.ok(next.missed.length > 0, 'дальше календарь работает как раньше');
});

test('семестр заведён в выходной: правило держится на дате, а не на фазе', () => {
  const saturday = '2025-09-06';
  const s = foundedOn(saturday);
  assert.equal(phaseOf(preset, s, saturday), 'weekend');

  const toMonday = applyResponse(s, `Выходные прошли.\n${marker('t=+2 day')}`, preset);
  assert.equal(toMonday.state.calendar.day, '2025-09-08');
  assert.deepEqual(toMonday.missed, [], 'в выходные прогуливать нечего');

  // Понедельник — уже обычный день: прогулы за него считаются.
  const monday = applyResponse(toMonday.state, `И этот день мимо.\n${marker('t=+1 day')}`, preset);
  assert.equal(monday.missed.length, preset.week.periodsPerDay);
  assert.ok(monday.state.attendance.records.every((r) => r.day === '2025-09-08'));
});

test('прыжок сразу через неделю: день заведения не считается, остальные — считаются', () => {
  const s = foundedOn(MONDAY);
  const r = applyResponse(s, `Неделя прошла как в тумане.\n${marker('t=+7 day')}`, preset);

  assert.equal(r.state.calendar.day, '2025-09-08');
  // Понедельник — сутки заведения, вторник–пятница — четыре учебных дня.
  assert.equal(r.missed.length, 4 * preset.week.periodsPerDay);
  assert.deepEqual(r.state.attendance.records.filter((x) => x.day === MONDAY), [],
    'день заведения остался пустым, соседние — нет');
  assert.ok(r.state.reputation.value < preset.reputation.start, 'за остальные дни отвечать пришлось');
});

test('названный вслух прогул в день заведения записывается: правило про вывод, а не про отметку', () => {
  // Границу видно только так: молчание календаря в этот день ни о чём не
  // говорит, а метка `skip=` — говорит, и выбрасывать названное было бы враньём.
  const s = foundedOn(MONDAY);
  const r = applyResponse(s, `Первую пару она проспала.\n${marker('skip=аналитическая химия')}`, preset);

  assert.equal(totalStats(r.state).skips, 1);
  assert.ok(r.state.reputation.value < preset.reputation.start);
});

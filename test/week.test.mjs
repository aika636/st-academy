import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { applyResponse, resolveHeldJump } from '../core/engine.mjs';
import { totalStats, stats } from '../core/attendance.mjs';
import { debts, subjectScore } from '../core/gradebook.mjs';
import { examMode, retakesLeft } from '../core/exams.mjs';
import { relationLabel } from '../core/relations.mjs';
import { todayView, gradebookView } from '../ui.js';

// Учебная неделя целиком — долг, записанный в `etap-live.md`: «прожит один
// переход, а не неделя; хвосты, сессия и её исходы живьём не наступали».
// Живая таверна недоступна, поэтому неделя проживается синтетически — по дням,
// через `core/`, ответ за ответом.
//
// Чем это отличается от соседних прогонов и почему написано отдельно:
//
// * `test/integration.test.mjs` гоняет `index.js` со швами таверны — события,
//   свайпы, инжекты. Про учёбу он проверяет один переход, а не череду дней.
// * `test/semester.test.mjs` и `test/engine.test.mjs` гоняют сценарии по
//   одному: прилежная студентка, прогульщица, сессия отдельным тестом с
//   подставленной датой. Ни в одном из них состояние не доживает от первой
//   пары до хвоста и от хвоста до пересдачи.
// * Здесь одно состояние живёт всю дорогу: посещённые пары и прогулянные,
//   оценки, хвост, вход в сессию, три её исхода — сдано, пересдача, завал.
//
// И вторая половина, которой нет нигде: проверяется не только состояние, но и
// **что об этом говорит панель**. Ошибка «в состоянии хвост есть, а на экране
// его нет» модульным тестом не ловится, а стоит ровно столько же, сколько
// ошибка в самом хвосте: человек верит экрану.

const preset = JSON.parse(readFileSync(
  fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8',
));

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

const TERM_START = '2024-09-02'; // понедельник: семестр заводят в этот день
const TUESDAY = '2024-09-03';    // и в этот день начинается сцена

const marker = (body) => `<!-- [ACADEMY ${body}] -->`;

/** Лента для `rng`: исход обязан быть воспроизводим до последней оценки. */
const tape = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

/**
 * Семестр заведён в понедельник, сцена начинается во вторник.
 *
 * Вторник, а не понедельник, — по правилу `attendance.countsAttendance`: сутки
 * заведения посещаемостью не обсчитываются вовсе. Неделя от этого не
 * укорачивается: она первая, и `weekIndex` считает её от понедельника.
 */
function semester() {
  const state = createState(preset, {
    startDay: TERM_START,
    subjects: SUBJECTS,
    teachers: TEACHERS,
    schedule: buildSchedule(SUBJECTS, preset),
  });
  state.started = true;
  state.calendar.day = TUESDAY;
  state.calendar.time = '08:30';
  state.calendar.precision = 'datetime';
  return state;
}

/** Один ответ модели. Возвращается весь результат: инжекты тоже под проверкой. */
function post(state, body, opts = {}) {
  return applyResponse(state, `Сцена.\n${marker(body)}`, preset, opts);
}

/** Прожить учебный день по парам: одна пара — один ответ. */
function livePeriods(state, bodies) {
  let s = state;
  for (const body of bodies) s = post(s, body).state;
  return s;
}

const nameOf = (id) => SUBJECTS.find((x) => x.id === id).name;

// --- собственно неделя -------------------------------------------------------

test('учебная неделя целиком: пары, оценки, хвост, сессия и её исходы', () => {
  let s = semester();

  // --- вторник: первый прожитый день -----------------------------------------
  // Панель до единого ответа: день, неделя, первая пара — и ни слова о том,
  // чего ещё не было.
  const morning = todayView(s, preset);
  assert.equal(morning.day, TUESDAY);
  assert.equal(morning.weekLine, '1-я неделя');
  assert.equal(morning.phase, 'study');
  assert.equal(morning.silent, false);
  assert.equal(morning.now.name, nameOf('chemistry'), 'первая пара — та, что в расписании');
  assert.equal(morning.plan.length, preset.week.periodsPerDay);

  // Четыре пары одним днём: химия с оценкой, физика и математика просто
  // высижены, история прогуляна вслух — меткой, а не молчанием календаря.
  s = livePeriods(s, [
    't=+1 grade=аналитическая химия:5',
    't=+1',
    't=+1 skip=история',
    't=+1',
  ]);

  assert.equal(stats(s, 'history').skips, 1, 'названный прогул записан');
  assert.equal(totalStats(s).present, 3, 'три пары высижены');
  assert.equal(subjectScore(s, 'chemistry', preset).grades.length, 1);

  // --- среда и четверг: те же дни, но история прогуливается дальше ----------
  s = livePeriods(s, [
    't=+1 grade=аналитическая химия:5',
    't=+1 grade=физика:4',
    't=+1 skip=история',
    't=+1',
  ]);
  // Четыре `t=+1` в дне из четырёх пар переливают календарь в следующий день:
  // вторник прожит, среда прожита, стоим в четверге.
  assert.equal(s.calendar.day, '2024-09-05', 'перелив через последнюю пару уводит в следующий день');

  const beforeDebt = debts(s).length;
  assert.equal(beforeDebt, 0, 'двух прогулов на хвост ещё не хватает');

  s = livePeriods(s, [
    't=+1 grade=физика:4',
    't=+1',
    't=+1 skip=история',
    't=+1 grade=высшая математика:3',
  ]);

  // Третий прогул по предмету — хвост. Это и есть порог `debtAfterSkips`,
  // прожитый днями, а не выставленный руками.
  assert.equal(stats(s, 'history').skips, 3);
  assert.deepEqual(debts(s).map((x) => x.id), ['history'], 'хвост появился ровно один');

  // И то же самое говорит панель: не «в состоянии стоит флаг», а «на экране
  // написано слово».
  const afterDebt = gradebookView(s, preset);
  assert.deepEqual(afterDebt.debts, [nameOf('history')], 'хвост назван в зачётке');
  const historyRow = afterDebt.subjects.find((x) => x.id === 'history');
  assert.equal(historyRow.debt, true);
  assert.equal(historyRow.passed, false);
  assert.equal(historyRow.relation, relationLabel(s, 'sidorova', preset), 'отношение — словом');
  assert.equal(historyRow.relation, 'неприязнь', 'три прогула подряд преподаватель заметил');
  assert.ok(
    afterDebt.numbers.some((n) => n.key === 'debts' && n.text.includes('хвосты')),
    `в сводных числах нет хвостов: ${JSON.stringify(afterDebt.numbers)}`,
  );
  assert.equal(afterDebt.reputation, 'на плохом счету', 'репутация просела, но не в пол');

  // --- пятница: опоздание, и неделя закрыта ---------------------------------
  // Последний ответ уводит сразу в субботу. Четвёртая пара пятницы при этом не
  // отмечена никем — и становится прогулом не по метке, а по молчанию
  // календаря: пара по расписанию прошла, записи о ней нет. Обе половины
  // механики 3.4 живут в одном дне.
  const mathSkipsBefore = stats(s, 'math').skips;
  s = livePeriods(s, [
    't=+1 late=физика',
    't=+1',
    't=+1',
    't=+1 day grade=высшая математика:2',
  ]);
  assert.equal(s.calendar.day, '2024-09-07', 'пятница дожита, календарь в субботе');
  assert.equal(stats(s, 'physics').lates, 1);
  assert.equal(stats(s, 'math').skips, mathSkipsBefore + 1, 'неотмеченная пара выведена прогулом');
  assert.equal(
    totalStats(s).skips, 4,
    'три названных прогула по истории и один выведенный по математике',
  );

  // Суббота: расписание молчит — и объясняет, почему.
  const saturday = todayView(s, preset);
  assert.equal(saturday.phase, 'weekend');
  assert.equal(saturday.silent, true);
  assert.equal(saturday.silentReason, 'Выходной — пар нет.');
  assert.equal(saturday.now, null, 'в субботу «сейчас: химия» — хуже, чем молчание');

  // --- прыжок в сессию -------------------------------------------------------
  // Семнадцатая неделя от 2 сентября начинается 23 декабря. Гнать шестнадцать
  // недель ответов незачем: за горизонтом прогулы не выводятся (это отдельно
  // проверено в `engine.test.mjs`), а вход в сессию считает календарь.
  // Прыжок такой длины календарь сам не делает: он придерживает его и ждёт
  // слова человека (`resolveHeldJump`, потолок `limits.maxForwardJump`).
  // Здесь это слово — «принять»: три месяца молчания в отыгрыше законны.
  const weekEndDebts = debts(s).length;
  const asked = applyResponse(s, '📅 23 декабря 2024, 09:00\nПервый день сессии.', preset);
  assert.equal(asked.heldJump.day, '2024-12-23', 'сперва вопрос, а не прыжок');
  const toSession = resolveHeldJump(asked.state, preset, true);
  s = toSession.state;

  assert.equal(s.calendar.day, '2024-12-23');
  assert.deepEqual(toSession.missed, [], 'три месяца молчания прогулами не становятся');
  assert.equal(debts(s).length, weekEndDebts, 'и хвостов от них не прибавилось');
  assert.equal(s.exams.active, true, 'календарь сам открыл сессию');
  assert.equal(s.exams.items.length, SUBJECTS.length);

  const session = todayView(s, preset);
  assert.equal(session.phase, 'exams');
  assert.equal(session.silent, true);
  assert.equal(session.silentReason, 'Сессия — лекций нет, идут контрольные.');

  const board = gradebookView(s, preset);
  assert.equal(board.examsActive, true);
  assert.equal(board.openExams.length, SUBJECTS.length, 'несданными числятся все четыре');
  assert.ok(
    board.numbers.some((n) => n.key === 'exams' && n.text.includes('несдано в сессию: 4')),
    `панель молчит о несданном: ${JSON.stringify(board.numbers)}`,
  );

  // --- исход первый: сдано без испытания -------------------------------------
  // Химия — две пятёрки, средний балл выше `autoPassScore`: автомат.
  const first = post(s, 't=+1 day', { exam: true, rng: tape(0.5) });
  s = first.state;
  assert.equal(first.exam.subjectId, 'chemistry');
  assert.equal(first.exam.reason, 'auto', 'на пятёрках исход не бросается, а выдаётся');
  assert.equal(first.exam.value, 'зачёт');
  assert.equal(first.injects.length, 1, 'исход ушёл одноразовым фактом, а не справкой');
  assert.equal(first.injects[0].kind, 'exam');
  assert.ok(first.injects[0].text.includes(nameOf('chemistry')));
  assert.ok(first.permission.includes('сессия'), 'фраза разрешения собрана словами пресета');

  const afterFirst = gradebookView(s, preset);
  assert.equal(afterFirst.openExams.length, 3, 'сданное из несданного выпало');
  assert.equal(afterFirst.subjects.find((x) => x.id === 'chemistry').passed, true);

  // --- исход второй: сдано броском -------------------------------------------
  // Лента 0.4 — d20 = 9. До проверки против DC (9.4.1) здесь стояло 0.9, но
  // у физики балл 4.0, DC = 1, и 19 на кубике — запас 18, крит и пятёрка.
  // Четвёрка теперь — обычный успех: запас от половины `critMargin` до него.
  const second = post(s, 't=+1 day', { exam: true, rng: tape(0.4) });
  s = second.state;
  assert.equal(second.exam.subjectId, 'physics');
  assert.equal(second.exam.reason, 'roll');
  assert.deepEqual(
    { roll: second.exam.check.roll, dc: second.exam.check.dc, tier: second.exam.check.tier },
    { roll: 9, dc: 1, tier: 'success' },
  );
  assert.equal(second.exam.value, '4');
  assert.equal(gradebookView(s, preset).openExams.length, 2);

  // --- исход третий: пересдача -----------------------------------------------
  // История: оценок нет, преподаватель после трёх прогулов настроен плохо.
  const repBefore = s.reputation.value;
  const third = post(s, 't=+1 day', { exam: true, rng: tape(0.1) });
  s = third.state;
  assert.equal(third.exam.subjectId, 'history');
  assert.equal(third.exam.value, 'незачёт');
  // Письменный экзамен по физике объявляют на следующий учебный день (9.4.3,
  // `announce` у вида в пресете): итог вчерашнего идёт своим фактом рядом с
  // сегодняшним вердиктом — поэтому вердикт ищется по виду, а не первым.
  assert.deepEqual(third.injects.map((i) => i.kind), ['announce', 'exam']);
  const thirdVerdict = third.injects.find((i) => i.kind === 'exam').text;
  assert.ok(thirdVerdict.includes('пересдач'), thirdVerdict);
  assert.ok(thirdVerdict.includes('попыток осталось: 2'), thirdVerdict);
  assert.ok(s.reputation.value < repBefore, 'провал бьёт по репутации, а не поднимает её');

  // Расхождение, вскрытое этим прогоном, и оставленное как есть — оно про
  // решение, а не про правку (отдельный пункт в `etap-week.md`). Хвост по
  // истории поставлен за три сентябрьских прогула, а `exams.applyOutcome`
  // переставляет `subject.debt` по правилу сессии — «хвост только при
  // исчерпанных попытках», — ничего не зная о том, откуда хвост взялся.
  // Незачёт с оставшимися пересдачами хвост, стало быть, снимает: сентябрьский
  // долг исчезает и из состояния, и с экрана. Тест это фиксирует, а не
  // оправдывает: если правило поменяют, тест обязан покраснеть.
  assert.equal(s.subjects.find((x) => x.id === 'history').debt, false);
  assert.deepEqual(
    gradebookView(s, preset).debts, [nameOf('math')],
    'на экране остался только хвост за двойку, сентябрьский — ушёл',
  );

  const historyItem = s.exams.items.find((i) => i.subjectId === 'history');
  assert.equal(historyItem.attempts, 1);
  assert.equal(retakesLeft(preset, historyItem), 2);
  assert.ok(
    examMode(s, preset).pending.some((i) => i.subjectId === 'history'),
    'несданное с оставшимися пересдачами остаётся несданным',
  );

  // --- исход четвёртый: и математика туда же ---------------------------------
  const fourth = post(s, 't=+1 day', { exam: true, rng: tape(0.1) });
  s = fourth.state;
  assert.equal(fourth.exam.subjectId, 'math', 'сперва то, за чем не садились, и только потом пересдачи');
  assert.equal(fourth.exam.value, '2');
  // Экзамен объявляется завтра: сегодня в зачётке он есть, а мир его не знает.
  assert.equal(s.exams.items.find((i) => i.subjectId === 'math').announced, false);

  // --- пересдачи до исчерпания попыток ---------------------------------------
  // Пересдача — не новое событие, а вторая попытка того же: `attempts` растёт,
  // оценка дописывается в зачётку, инжект уходит заново.
  const retake = post(s, 't=+1 day', { exam: true, rng: tape(0.1) });
  s = retake.state;
  assert.equal(retake.exam.subjectId, 'history', 'к пересдаче очередь дошла сама');
  assert.equal(s.exams.items.find((i) => i.subjectId === 'history').attempts, 2);
  const retakeVerdict = retake.injects.find((i) => i.kind === 'exam').text;
  assert.ok(retakeVerdict.includes('попыток осталось: 1'), retakeVerdict);

  // К этому ответу репутация переваливает нижний порог, и предупреждение
  // уходит в игру вместе с исходом — двумя разными одноразовыми фактами.
  assert.deepEqual(retake.injects.filter((i) => i.kind !== 'announce').map((i) => i.id),
    ['exam:0:history:credit:2', 'reputation-warn']);
  // Итог математики объявят в следующий учебный день после сдачи (9.4.3): пока
  // он не наступил, мир итога не знает, и объявления среди фактов нет.
  const mathItem = s.exams.items.find((i) => i.subjectId === 'math');
  assert.equal(mathItem.announced, s.calendar.day >= mathItem.announceOn);
  assert.equal(retake.injects.some((i) => i.kind === 'announce'), mathItem.announced);
  assert.equal(s.reputation.warned, true);
  assert.equal(gradebookView(s, preset).reputation, 'под угрозой отчисления');

  const last = post(s, 't=+1 day', { exam: true, rng: tape(0.1) });
  s = last.state;
  assert.equal(last.exam.subjectId, 'history');
  const exhausted = s.exams.items.find((i) => i.subjectId === 'history');
  assert.equal(exhausted.attempts, 3, 'одна попытка и две пересдачи — потолок пресета');
  assert.equal(retakesLeft(preset, exhausted), 0);
  assert.ok(last.injects[0].text.includes('хвост'), last.injects[0].text);
  assert.equal(
    s.subjects.find((x) => x.id === 'history').debt, true,
    'исчерпанные попытки — это хвост',
  );
  assert.ok(
    !examMode(s, preset).pending.some((i) => i.subjectId === 'history'),
    'из несданного история ушла в хвосты: пересдавать больше нечего',
  );

  // --- что говорит панель в конце --------------------------------------------
  const final = gradebookView(s, preset);
  assert.deepEqual(final.debts, [nameOf('history')]);
  assert.equal(final.openExams.length, 1, 'осталась математика с непотраченными пересдачами');
  assert.equal(final.openExams[0].subject, nameOf('math'));
  assert.equal(final.subjects.find((x) => x.id === 'chemistry').passed, true);
  assert.equal(final.subjects.find((x) => x.id === 'physics').passed, true);
  assert.equal(final.subjects.find((x) => x.id === 'history').debt, true);
  assert.equal(final.expelled, false, 'неделя прогулов и два провала — ещё не отчисление');
  assert.ok(final.numbers.length <= preset.limits.maxNumbersInPrompt);
});

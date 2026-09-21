// test/milestones — вехи студента по состоянию (план 9.4.2) и вехи в хронике
// лорбука (ответ на вопрос 8.5).
//
// Главное свойство — чистый пересчёт: веха появляется, когда её основание
// лежит в состоянии, и исчезает, когда основание убрали (свайп вернул снимок,
// человек стёр оценку). Поэтому почти каждый тест здесь двусторонний: «есть» и
// «на снимке до — нет».

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createState, cloneState, pushJournal } from '../core/state.mjs';
import { addGrade, setDebt } from '../core/gradebook.mjs';
import { mark } from '../core/attendance.mjs';
import { changeRelation } from '../core/relations.mjs';
import { changeReputation } from '../core/reputation.mjs';
import { scheduleExams } from '../core/exams.mjs';
import { sitExam } from '../core/engine.mjs';
import { milestones, diffMilestones, milestoneName, KINDS, DEFAULT_NAMES } from '../core/milestones.mjs';
import { significantEvents, buildEntries, CHRONICLE_MILESTONES } from '../core/lorebook.mjs';

const load = (file) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${file}`, import.meta.url)), 'utf8'));
const RU = load('ru-university.json');
const PRESETS = ['ru-university.json', 'jp-highschool.json', 'magic-academy.json'].map(load);

const die = (n) => () => (n - 0.5) / 20;
const ids = (state, preset = RU) => milestones(state, preset).map((m) => m.id);

const SUBJECTS = [
  { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'ivanov' },
];
const TEACHERS = [
  { id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['злопамятна'] },
  { id: 'ivanov', name: 'Иванов Пётр Ильич', traits: ['добродушен'] },
];

/** Семестр с 2 сентября 2024 (понедельник), расписание — обе пары каждый день. */
function semester(preset = RU) {
  const s = createState(preset, {
    startDay: '2024-09-02',
    subjects: SUBJECTS,
    teachers: TEACHERS,
    schedule: { 1: ['chemistry', 'physics'], 2: ['chemistry', 'physics'], 3: ['chemistry', 'physics'], 4: ['chemistry', 'physics'], 5: ['chemistry', 'physics'] },
  });
  s.started = true;
  return s;
}

/** Отметить обе пары дня одним статусом. */
function day(state, dayStr, status = 'present') {
  let s = state;
  s = mark(s, { subjectId: 'chemistry', status, day: dayStr, periodIndex: 0 }, RU).state;
  s = mark(s, { subjectId: 'physics', status, day: dayStr, periodIndex: 1 }, RU).state;
  return s;
}

// --- общее ------------------------------------------------------------------

test('пустой семестр — вех нет; мусор на входе — тоже не падение', () => {
  assert.deepEqual(milestones(semester(), RU), []);
  assert.deepEqual(milestones(null, RU), []);
});

test('пересчёт чистый: состояние не меняется, повтор даёт то же', () => {
  let s = semester();
  s = addGrade(s, { subjectId: 'chemistry', value: '5', day: '2024-09-05' }, RU).state;
  const before = JSON.stringify(s);
  const a = milestones(s, RU);
  const b = milestones(s, RU);
  assert.equal(JSON.stringify(s), before);
  assert.deepEqual(a, b);
});

// --- первая высшая оценка ---------------------------------------------------

test('первая высшая оценка: самая ранняя по дню, и «автомат» тоже высшая', () => {
  let s = semester();
  s = addGrade(s, { subjectId: 'physics', value: '4', day: '2024-09-04' }, RU).state;
  assert.ok(!ids(s).includes('firstTop'), 'четвёрка — не высшая');
  s = addGrade(s, { subjectId: 'physics', value: '5', day: '2024-09-10' }, RU).state;
  s = addGrade(s, { subjectId: 'chemistry', value: '5', day: '2024-09-06' }, RU).state;
  const m = milestones(s, RU).find((x) => x.id === 'firstTop');
  assert.deepEqual({ when: m.when, subjectId: m.subjectId }, { when: '2024-09-06', subjectId: 'chemistry' });

  const auto = addGrade(semester(), { subjectId: 'chemistry', value: 'автомат', day: '2024-12-24' }, RU).state;
  assert.ok(ids(auto).includes('firstTop'), 'автомат стоит пятью баллами');
  const credit = addGrade(semester(), { subjectId: 'chemistry', value: 'зачёт', day: '2024-12-24' }, RU).state;
  assert.ok(!ids(credit).includes('firstTop'), 'зачёт баллов не имеет — не веха');
});

test('отзыв вехи бесплатен: стёрли оценку — вехи нет', () => {
  let s = addGrade(semester(), { subjectId: 'chemistry', value: '5', day: '2024-09-06' }, RU).state;
  const after = milestones(s, RU);
  const edited = cloneState(s);
  edited.subjects[0].grades = [];
  const d = diffMilestones(after, milestones(edited, RU));
  assert.deepEqual(d.removed.map((m) => m.id), ['firstTop']);
  assert.deepEqual(d.added, []);
});

// --- неделя без прогулов ----------------------------------------------------

test('неделя без прогулов засчитывается, когда кончилась и каждый день с парами отмечен', () => {
  let s = semester();
  // 2 сентября — день заведения, он не считается; дальше вторник–пятница.
  for (const d of ['2024-09-03', '2024-09-04', '2024-09-05', '2024-09-06']) s = day(s, d);
  s = mark(s, { subjectId: 'physics', status: 'late', day: '2024-09-05', periodIndex: 1 }, RU).state;
  s.calendar.day = '2024-09-06';
  assert.ok(!ids(s).includes('cleanWeek'), 'неделя ещё идёт');
  s.calendar.day = '2024-09-09';
  const m = milestones(s, RU).find((x) => x.id === 'cleanWeek');
  assert.ok(m, 'неделя кончилась — веха есть; опоздание — не прогул');
  assert.equal(m.when, '2024-09-06', 'дата — последний день с парами');
});

test('прогул или неотмеченный день недели веху не дают', () => {
  let skip = semester();
  for (const d of ['2024-09-03', '2024-09-04', '2024-09-05', '2024-09-06']) skip = day(skip, d);
  skip = mark(skip, { subjectId: 'chemistry', status: 'skip', day: '2024-09-04', periodIndex: 0 }, RU).state;
  skip.calendar.day = '2024-09-09';
  assert.ok(!ids(skip).includes('cleanWeek'));

  // Среду календарь перепрыгнул, ведомость о ней молчит — неделя не «чистая», а неизвестная.
  let gap = semester();
  for (const d of ['2024-09-03', '2024-09-05', '2024-09-06']) gap = day(gap, d);
  gap.calendar.day = '2024-09-09';
  assert.ok(!ids(gap).includes('cleanWeek'));
});

// --- закрытый хвост ---------------------------------------------------------

test('закрытый хвост: непроходная, потом проходная', () => {
  let s = semester();
  s = addGrade(s, { subjectId: 'physics', value: '2', day: '2024-09-10' }, RU).state;
  assert.ok(!ids(s).includes('debtCleared'), 'хвост есть, но не закрыт');
  s = addGrade(s, { subjectId: 'physics', value: '4', day: '2024-09-17' }, RU).state;
  const m = milestones(s, RU).find((x) => x.id === 'debtCleared');
  assert.deepEqual({ when: m.when, subjectId: m.subjectId }, { when: '2024-09-17', subjectId: 'physics' });
});

test('хвост за прогулы закрывается проходной оценкой после порога', () => {
  let s = semester();
  const threshold = RU.attendance.debtAfterSkips;
  const days = ['2024-09-03', '2024-09-04', '2024-09-05', '2024-09-06'].slice(0, threshold);
  s = addGrade(s, { subjectId: 'chemistry', value: '4', day: '2024-09-03' }, RU).state;
  for (const d of days) s = mark(s, { subjectId: 'chemistry', status: 'skip', day: d, periodIndex: 0 }, RU).state;
  assert.ok(!ids(s).includes('debtCleared'), 'четвёрка ДО порога хвост не закрывает');
  s = addGrade(s, { subjectId: 'chemistry', value: '3', day: '2024-09-20' }, RU).state;
  assert.equal(milestones(s, RU).find((x) => x.id === 'debtCleared').when, '2024-09-20');
});

// --- сессия, автомат, блестящая сдача ---------------------------------------

function inSession() {
  const s = semester();
  s.calendar.day = '2024-12-24';
  return scheduleExams(s, RU, { day: '2024-12-24' });
}

test('сессия без пересдач: веха появляется, когда сдано всё и с первой попытки', () => {
  let s = inSession();
  s = sitExam(s, RU, { rng: die(20) }).state;
  assert.ok(!ids(s).some((id) => id.startsWith('cleanSession')), 'сдано не всё');
  s.calendar.day = '2024-12-25';
  s = sitExam(s, RU, { rng: die(20) }).state;
  const m = milestones(s, RU).find((x) => x.kind === 'cleanSession');
  assert.deepEqual({ id: m.id, when: m.when, term: m.term }, { id: 'cleanSession:0', when: '2024-12-25', term: 0 });
});

test('пересдача вехе «сессия без пересдач» не даёт случиться', () => {
  let s = inSession();
  const first = sitExam(s, RU, { rng: die(1) });
  s = first.state;
  s.calendar.day = '2024-12-25';
  s = sitExam(s, RU, { rng: die(20) }).state;
  s.calendar.day = '2024-12-26';
  s = sitExam(s, RU, { rng: die(20), examId: first.exam.examId }).state;
  assert.ok(s.exams.items.every((i) => i.outcome && ['зачёт', '3', '4', '5'].includes(i.outcome)), 'всё сдано');
  assert.ok(!ids(s).some((id) => id.startsWith('cleanSession')));
  // Зато пересдача — это закрытый хвост: непроходная, потом проходная.
  assert.ok(ids(s).includes('debtCleared'));
});

test('блестящая сдача — по истории бросков; версия модели её отменяет', () => {
  const s = inSession();
  const brilliant = sitExam(s, RU, { rng: die(20) });
  assert.equal(brilliant.exam.check.tier, 'critSuccess');
  assert.ok(ids(brilliant.state).includes('brilliant'));

  const overridden = sitExam(s, RU, { rng: die(20), modelSaid: 'незачёт' });
  assert.ok(!ids(overridden.state).includes('brilliant'), 'модель отыграла провал — блеска в сцене не было');
});

test('автомат — веха по истории бросков', () => {
  let s = inSession();
  for (const [i, v] of ['5', '5', '5'].entries()) s = addGrade(s, { subjectId: 'chemistry', value: v, day: `2024-10-0${i + 1}` }, RU).state;
  const r = sitExam(s, RU, { rng: die(1) });
  assert.equal(r.exam.reason, 'auto');
  const m = milestones(r.state, RU).find((x) => x.id === 'autoPass');
  assert.deepEqual({ when: m.when, subjectId: m.subjectId }, { when: '2024-12-24', subjectId: 'chemistry' });
});

// --- отношение и репутация --------------------------------------------------

test('отношение через порог: крайние ярлыки шкалы, по вехе на наставника', () => {
  let s = semester();
  s.calendar.day = '2024-10-01';
  s = changeRelation(s, { teacherId: 'ivanov', delta: 5 }, RU).state;
  s = changeRelation(s, { teacherId: 'petrova', delta: -5 }, RU).state;
  const all = milestones(s, RU);
  const fav = all.find((m) => m.id === 'favorite:ivanov');
  const nem = all.find((m) => m.id === 'nemesis:petrova');
  assert.equal(fav.when, '2024-10-01', 'дата — из журнала');
  assert.ok(nem);

  // Остыл — веха отозвана: пересчёт без хранения.
  const cooled = changeRelation(s, { teacherId: 'ivanov', delta: -2 }, RU).state;
  assert.ok(!ids(cooled).includes('favorite:ivanov'));

  // Журнал забыл — веха есть, даты нет.
  const forgot = cloneState(s);
  forgot.journal = [];
  assert.equal(milestones(forgot, RU).find((m) => m.id === 'favorite:ivanov').when, null);
});

test('«на волоске» — вечная: флаг предупреждения не снимается', () => {
  let s = semester();
  s.calendar.day = '2024-11-11';
  s = changeReputation(s, { delta: -(RU.reputation.start - RU.reputation.warnAt) }, RU).state;
  assert.equal(milestones(s, RU).find((m) => m.id === 'onTheEdge').when, '2024-11-11');
  s.calendar.day = '2024-11-20';
  s = changeReputation(s, { delta: 40 }, RU).state;
  assert.ok(ids(s).includes('onTheEdge'), 'отмылась, но вызов к начальству был');
});

test('порядок: по дате, вехи без даты — в конце', () => {
  let s = semester();
  s.calendar.day = '2024-10-01';
  s = changeRelation(s, { teacherId: 'ivanov', delta: 5 }, RU).state;
  s.journal = [];
  s = addGrade(s, { subjectId: 'chemistry', value: '5', day: '2024-09-20' }, RU).state;
  s = addGrade(s, { subjectId: 'physics', value: '2', day: '2024-09-10' }, RU).state;
  s = addGrade(s, { subjectId: 'physics', value: '3', day: '2024-09-12' }, RU).state;
  assert.deepEqual(ids(s), ['debtCleared', 'firstTop', 'favorite:ivanov']);
});

// --- названия -----------------------------------------------------------------

test('названия — из словаря пресета, у каждого пресета свои и полные', () => {
  for (const p of PRESETS) {
    const own = (p.phrases && p.phrases.milestones) || {};
    const missing = KINDS.filter((k) => !(typeof own[k] === 'string' && own[k].trim()));
    assert.deepEqual(missing, [], `${p.id}: не названы вехи ${missing.join(', ')}`);
    assert.ok(typeof (p.phrases.lorebook || {}).chronicleMilestone === 'string', `${p.id}: нет шаблона хроники вехи`);
  }
  assert.deepEqual(Object.keys(DEFAULT_NAMES).sort(), [...KINDS].sort(), 'запасные названия есть у каждого вида');

  // Одна и та же веха в трёх пресетах — три разных текста: слово пришло не из кода.
  const texts = PRESETS.map((p) => {
    let s = semester(p);
    const top = p.grades.values.filter((v) => typeof v.points === 'number').sort((a, b) => b.points - a.points)[0].value;
    s = addGrade(s, { subjectId: 'chemistry', value: top, day: '2024-09-05' }, p).state;
    const m = milestones(s, p).find((x) => x.id === 'firstTop');
    return milestoneName(m, s, p);
  });
  assert.equal(new Set(texts).size, 3, texts.join(' | '));
  for (const t of texts) assert.ok(t.includes('аналитическая химия'), t);
});

test('ни одно название не называет вехи «ачивками»', () => {
  const all = JSON.stringify([DEFAULT_NAMES, ...PRESETS.map((p) => p.phrases.milestones)]).toLowerCase();
  assert.ok(!/ачивк|достижени|achievement/.test(all), all);
});

// --- хроника лорбука (8.5) ----------------------------------------------------

test('вехи — значимые события: попадают в хронику со своим uid и ключами', () => {
  let s = semester();
  s = addGrade(s, { subjectId: 'chemistry', value: '5', day: '2024-09-06' }, RU).state;
  const events = significantEvents(s, RU);
  assert.deepEqual(events.map((e) => e.uid), ['academy:chronicle:milestone:firstTop']);

  const entry = buildEntries(s, RU).find((e) => e.uid === 'academy:chronicle:milestone:firstTop');
  assert.ok(entry.content.includes('2024-09-06'), entry.content);
  assert.ok(entry.content.includes(milestoneName(milestones(s, RU)[0], s, RU)), entry.content);
  assert.ok(entry.keys.includes('аналитическая химия'));
  assert.ok(entry.keys.includes('Петрова'), `наставник предмета — участник: ${entry.keys}`);
});

test('в хронику идут не все вехи: повторов и записей без ключа нет', () => {
  let s = semester();
  s.calendar.day = '2024-10-01';
  s = changeRelation(s, { teacherId: 'ivanov', delta: 5 }, RU).state;
  s = changeReputation(s, { delta: -(RU.reputation.start - RU.reputation.warnAt) }, RU).state;
  const kinds = significantEvents(s, RU).map((e) => e.kind);
  assert.ok(!kinds.includes('milestone'), `порог отношения и репутации хроника пишет своими записями: ${kinds}`);
  assert.ok(kinds.includes('rel') && kinds.includes('reputation'));
  assert.ok(!CHRONICLE_MILESTONES.includes('cleanWeek'), 'у недели без прогулов нет участника — нет и ключа');
});

test('события хроники идут по дням, журнал и вехи вперемешку', () => {
  let s = semester();
  s = addGrade(s, { subjectId: 'chemistry', value: '5', day: '2024-09-06' }, RU).state;
  s.calendar.day = '2024-10-01';
  s = changeRelation(s, { teacherId: 'petrova', delta: -2 }, RU).state;
  s = addGrade(s, { subjectId: 'physics', value: '2', day: '2024-10-05' }, RU).state;
  s = addGrade(s, { subjectId: 'physics', value: '4', day: '2024-10-07' }, RU).state;
  const days = significantEvents(s, RU).map((e) => e.day);
  assert.deepEqual(days, [...days].sort(), days.join(', '));
  assert.equal(days.length, 3);
});

test('веха без даты в хронику не идёт, а uid вехи от даты не зависит', () => {
  // Оценка без дня бывает только у состояния старой схемы или правленного
  // руками — `addGrade` день подставляет сам, поэтому кладём напрямую.
  const s = semester();
  s.subjects[0].grades.push({ value: '5', day: '' });
  assert.ok(ids(s).includes('firstTop'));
  assert.deepEqual(significantEvents(s, RU), []);

  const dated = cloneState(s);
  dated.subjects[0].grades[0].day = '2024-09-06';
  const later = cloneState(s);
  later.subjects[0].grades[0].day = '2024-09-13';
  assert.equal(significantEvents(dated, RU)[0].uid, significantEvents(later, RU)[0].uid);
});

test('обычная оценка и явка хроники по-прежнему не заводят', () => {
  let s = semester();
  s = day(s, '2024-09-03');
  s = addGrade(s, { subjectId: 'chemistry', value: '4', day: '2024-09-03' }, RU).state;
  s = setDebt(s, 'physics', true, RU);
  pushJournal(s, { kind: 'debug', text: '', data: {} }, RU);
  assert.deepEqual(significantEvents(s, RU), []);
});

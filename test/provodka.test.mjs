import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Проводка шага 4 и крючки 9.7 — чистая половина: поля состояния (портрет,
// корпус, аудитория), вью панели (исход проверки на «Сегодня», вехи, итоги в
// ожидании объявления, портрет и день рождения), вид для соседей
// (`hookNow/hookToday/hookSummary/hookJournal`), доктор промпта, слова отладки
// и звук вехи. Проводка через `index.js` — в `hooks.test.mjs`.

import {
  createState, isPortrait, normalizePortrait, normalizeSubject, normalizeTeacher, PLACE_MAX, PORTRAIT_MAX,
  validateState,
} from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import {
  DEBUG_TEXT, DOCTOR_TEXT, EXTRA_UI, awaitingView, birthdayText, debugView, describeApplied, examResultsToday,
  extraLabels, fill, foreignHead, gradebookView, hookJournal, hookNow, hookSummary, hookToday, milestonesView,
  peopleView, playChime, promptDoctorView, promptOwner, rowsFromState, todayView, uiLabels, validateSubjectRows,
} from '../ui.js';

const load = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));
const ru = load('ru-university');
const jp = load('jp-highschool');
const magic = load('magic-academy');

const SUBJECTS = [
  { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova', building: 'главный', room: '214' },
  { id: 'physics', name: 'физика', teacherId: 'ivanov' },
];
const TEACHERS = [
  { id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['злопамятна'] },
  { id: 'ivanov', name: 'Иванов Пётр Ильич', traits: ['добродушен'] },
];

/** Идущий семестр: вторник первой недели, вторая пара. */
function started(preset = ru, edit = null) {
  const s = createState(preset, {
    startDay: '2024-09-02', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
  });
  s.started = true;
  s.calendar.day = '2024-09-03';
  s.calendar.periodIndex = 1;
  if (edit) edit(s);
  return s;
}

// --- состояние: портрет, корпус, аудитория -------------------------------------

test('портрет: путь от корня таверны и http(s) — да; всё со схемой и мусор — нет', () => {
  for (const ok of ['characters/Анна Петрова/портрет.png', '/user/images/p.webp', 'img/a.png',
    'https://example.com/p.png', 'http://127.0.0.1:8000/x.jpg']) {
    assert.equal(isPortrait(ok), true, ok);
  }
  for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///C:/x.png', 'C:/x.png',
    '\\\\server\\x.png', 'http://', ' p.png', 'p.png\n', `a${'x'.repeat(PORTRAIT_MAX)}`, '', null, 5, 'a\u0000b']) {
    assert.equal(isPortrait(bad), false, JSON.stringify(bad));
  }
  assert.equal(normalizePortrait('  https://example.com/p.png  '), 'https://example.com/p.png', 'края обрезаются');
  assert.equal(normalizePortrait('javascript:x'), null);
});

test('нормализация: портрет, корпус и аудитория необязательны и пустыми ключами не пишутся', () => {
  const t = normalizeTeacher({ id: 'a', name: 'А', portrait: 'img/a.png' }, ru);
  assert.equal(t.portrait, 'img/a.png');
  assert.equal('portrait' in normalizeTeacher({ id: 'a', name: 'А', portrait: 'javascript:1' }, ru), false);
  assert.equal('portrait' in normalizeTeacher({ id: 'a', name: 'А' }, ru), false);

  const s = normalizeSubject({ id: 'x', name: 'X', building: '  главный   корпус ', room: 214 });
  assert.equal(s.building, 'главный корпус', 'пробелы схлопнуты');
  assert.equal(s.room, '214', 'число — строкой');
  const bare = normalizeSubject({ id: 'x', name: 'X', building: '', room: '   ' });
  assert.equal('building' in bare, false);
  assert.equal('room' in bare, false);
  assert.equal(normalizeSubject({ id: 'x', building: 'я'.repeat(200) }).building.length, PLACE_MAX);
});

test('validateState: годные новые поля проходят, негодные названы', () => {
  assert.deepEqual(validateState(started(), ru).errors, []);
  const s = started(ru, (x) => {
    x.teachers[0].portrait = 'javascript:alert(1)';
    x.subjects[1].building = 42;
    x.subjects[1].room = 'я'.repeat(PLACE_MAX + 1);
  });
  const errors = validateState(s, ru).errors.join(' | ');
  assert.match(errors, /petrova: портрет/);
  assert.match(errors, /physics: корпус/);
  assert.match(errors, /physics: аудитория/);
});

// --- «Сегодня»: место занятия и исход проверки ----------------------------------

test('«Сегодня»: корпус и аудитория — у текущего занятия и в плане дня, числами не считаются', () => {
  const v = todayView(started(), ru);
  const withPlace = v.plan.find((p) => p.subjectId === 'chemistry');
  assert.equal(withPlace.where, 'главный · 214');
  assert.equal(v.plan.find((p) => p.subjectId === 'physics').where, '');
  assert.equal(v.numbers.some((n) => /214/.test(n.text)), false, 'место — слово, не сводное число');
});

function examState(item, preset = ru) {
  return started(preset, (s) => {
    s.calendar.day = '2024-12-23';
    s.exams.items = [{ attempts: 1, day: '2024-12-23', ...item }];
  });
}

test('исход проверки: сегодняшний бросок одной строкой — вид, предмет, оценка словом, d20 против DC', () => {
  const s = examState({
    id: '0:chemistry:exam', subjectId: 'chemistry', kind: 'exam', outcome: '4',
    rolls: [{ day: '2024-12-23', roll: 15, dc: 7, tier: 'success', value: '4' }],
  });
  const [r] = todayView(s, ru).exams;
  assert.equal(r.head, 'экзамен, аналитическая химия: хорошо');
  assert.equal(r.rollText, 'бросок 15 против DC 7 — успех');
  assert.equal(r.passed, true);
  assert.equal(r.key, '0:chemistry:exam:1:2024-12-23', 'ключ анимации — попытка и день');
});

test('исход проверки: автомат, страховка, версия модели и «мир узнает» — заметками', () => {
  const auto = examState({
    id: 'a', subjectId: 'chemistry', kind: 'exam', outcome: 'автомат',
    rolls: [{ day: '2024-12-23', tier: 'auto', value: 'автомат' }],
  });
  const [a] = examResultsToday(auto, ru);
  assert.equal(a.auto, true);
  assert.equal(a.roll, null);
  assert.equal(a.rollText, EXTRA_UI.checkAuto);

  const tricky = examState({
    id: 'b', subjectId: 'physics', kind: 'exam', outcome: '5', modelOverride: true,
    announced: false, announceOn: '2024-12-24',
    rolls: [{ day: '2024-12-23', roll: 3, dc: 8, tier: 'fail', value: '3', saved: true }],
  });
  const [b] = examResultsToday(tricky, ru);
  assert.equal(b.value, '5', 'в строке — принятая версия модели');
  assert.ok(b.notes.includes(EXTRA_UI.checkSaved));
  assert.ok(b.notes.some((n) => n.startsWith('в тексте ответа — отлично')));
  assert.ok(b.notes.some((n) => n === 'мир узнает вторник, 24 декабря'));
  assert.equal(b.pending, true);
});

test('исход проверки: вчерашний бросок на «Сегодня» не висит', () => {
  const s = examState({
    id: 'c', subjectId: 'chemistry', kind: 'exam', outcome: '4', day: '2024-12-20',
    rolls: [{ day: '2024-12-20', roll: 15, dc: 7, tier: 'success', value: '4' }],
  });
  assert.deepEqual(examResultsToday(s, ru), []);
});

// --- «Зачётка»: вехи и итоги в ожидании -----------------------------------------

test('вехи в зачётке: название словами пресета, дата словами, без даты — «—»', () => {
  const s = started(ru, (x) => {
    x.subjects[0].grades = [{ value: '5', day: '2024-09-03' }];
    x.reputation.warned = true; // «на волоске»: дата — из журнала, а журнал пуст
  });
  const list = milestonesView(s, ru);
  const top = list.find((m) => m.kind === 'firstTop');
  assert.equal(top.name, 'Первая пятёрка: аналитическая химия');
  assert.equal(top.whenLine, 'вторник, 3 сентября');
  const edge = list.find((m) => m.kind === 'onTheEdge');
  assert.equal(edge.when, null);
  assert.equal(edge.whenLine, '—');
  assert.deepEqual(gradebookView(s, ru).milestones.map((m) => m.id), list.map((m) => m.id));
});

test('зачётка: итог, который мир ещё не знает, — «итог объявят …»', () => {
  const s = examState({
    id: '0:physics:exam', subjectId: 'physics', kind: 'exam', outcome: '2',
    announced: false, announceOn: '2024-12-24',
    rolls: [{ day: '2024-12-23', roll: 2, dc: 8, tier: 'fail', value: '2' }],
  });
  assert.deepEqual(awaitingView(s, ru).map((a) => a.text), ['физика: итог объявят вторник, 24 декабря']);
  assert.equal(gradebookView(s, ru).awaiting.length, 1);
});

// --- «Люди»: портрет и день рождения ----------------------------------------------

test('«Люди»: в карточку идёт только годный портрет и день рождения словами', () => {
  const s = started(ru, (x) => {
    x.teachers[0].portrait = 'characters/Петрова/p.png';
    x.teachers[0].birthday = '03-08';
  });
  const v = peopleView(s, ru);
  const petrova = v.teachers.find((t) => t.id === 'petrova');
  assert.equal(petrova.portrait, 'characters/Петрова/p.png');
  assert.equal(petrova.birthday, '03-08');
  assert.equal(petrova.birthdayText, 'день рождения: 8 марта');
  const ivanov = v.teachers.find((t) => t.id === 'ivanov');
  assert.equal(ivanov.portrait, '');
  assert.equal(ivanov.birthdayText, '');
  assert.equal(birthdayText('02-29'), '29 февраля');
  assert.equal(birthdayText('13-01'), '1', 'месяца нет — только день, без выдумки');
});

// --- таблица плана: корпус и аудитория ------------------------------------------

test('таблица плана: корпус и аудитория из состояния и обратно, пустое — пустой строкой', () => {
  const rows = rowsFromState(started());
  assert.equal(rows.subjects[0].building, 'главный');
  assert.equal(rows.subjects[1].room, '');
  rows.subjects[1].room = `  ${'я'.repeat(PLACE_MAX + 5)} `;
  const res = validateSubjectRows(rows, ru);
  assert.equal(res.ok, true);
  assert.equal(res.subjects[0].room, '214');
  assert.equal(res.subjects[1].building, '', 'ключ есть: «стёрто», а не «не трогать»');
  assert.equal(res.subjects[1].room.length, PLACE_MAX);
});

// --- вид для соседей -------------------------------------------------------------

test('hookNow/hookToday: без семестра — null; с семестром — день, фаза, занятие с местом', () => {
  assert.equal(hookNow(null), null);
  assert.equal(hookToday({ ...started(), started: false }, ru), null);
  const now = hookNow(started());
  assert.deepEqual(now, { started: true, day: '2024-09-03', time: null, precision: 'date', weekday: 'вторник' });
  const today = hookToday(started(), ru);
  assert.equal(today.phase, 'study');
  assert.equal(today.period.ordinal, 2);
  assert.ok(today.period.subject);
  assert.equal(typeof today.period.where, 'string');
});

test('summary: словами пресета — период (если их несколько), день, занятие, долги', () => {
  const debt = (s) => { s.subjects[1].debt = true; };
  const r = hookSummary(started(ru, debt), ru);
  assert.equal(r, `вторник, ${fill(uiLabels(ru).slot, { ordinal: 2 })}, хвосты: 1`);

  const j = hookSummary(started(jp, debt), jp);
  assert.match(j, /^первый триместр, вторник, /);
  assert.ok(j.includes(fill(uiLabels(jp).slot, { ordinal: 2 })), j);
  assert.ok(j.includes('красные баллы: 1'), j);
  assert.doesNotMatch(j, /пара|хвост/);

  const m = hookSummary(started(magic, debt), magic);
  assert.ok(m.includes('прорехи: 1'), m);
  assert.doesNotMatch(m, /пара|хвост|семестр/);
});

test('summary: вне занятий — фаза вместо номера', () => {
  const s = started(ru, (x) => { x.calendar.day = '2024-09-07'; x.calendar.periodIndex = null; });
  assert.equal(hookSummary(s, ru), `суббота, ${uiLabels(ru).phases.weekend}`);
});

test('журнал наружу: поля по белому списку, ярлыки вместо чисел, без секретов и служебного', () => {
  const s = started(ru, (x) => {
    x.exams.items = [{
      id: '0:physics:exam', subjectId: 'physics', kind: 'exam', day: '2024-09-03', outcome: '2', attempts: 1,
      announced: false, announceOn: '2024-09-04',
    }];
    x.journal = [
      { day: '2024-09-03', kind: 'debug', text: 'x', data: { at: 1 } },
      { day: '2024-09-03', kind: 'grade', text: 'grade rejected', data: { subjectId: 'nope', value: '5', reason: 'unknown-subject' } },
      { day: '2024-09-03', kind: 'grade', text: 'grade chemistry=4', data: { subjectId: 'chemistry', value: '4', points: 4 } },
      { day: '2024-09-03', kind: 'attendance', text: 'a', data: { day: '2024-09-03', subjectId: 'chemistry', status: 'skip', periodIndex: 0 } },
      { day: '2024-09-03', kind: 'rel', text: 'r', data: { teacherId: 'petrova', delta: -3, from: 0, to: -3, reason: { kind: 'skip', subjectId: 'chemistry' } } },
      { day: '2024-09-03', kind: 'grade', text: 'grade physics=2', data: { subjectId: 'physics', value: '2', points: 2 } },
      { day: '2024-09-03', kind: 'exam', text: 'Свершилось…', data: { examId: '0:physics:exam', value: '2', passed: false, private: true } },
    ];
  });
  const out = hookJournal(s, ru, 50);
  assert.deepEqual(out.map((e) => e.kind), ['grade', 'attendance', 'relation']);
  const [grade, att, rel] = out;
  assert.equal(grade.label, 'хорошо');
  assert.equal(att.status, 'skip');
  assert.equal(typeof rel.from, 'string');
  assert.equal(rel.direction, 'down');
  assert.equal(rel.reason, 'прогул: аналитическая химия');
  assert.equal(JSON.stringify(out).includes('-3'), false, 'чисел отношения наружу нет');
  assert.equal(out.some((e) => e.subjectId === 'physics'), false, 'необъявленный итог — секрет');
  assert.deepEqual(hookJournal(s, ru, 1).map((e) => e.kind), ['relation'], 'n — последние');
  assert.deepEqual(hookJournal(s, ru, 0), []);
});

// --- доктор промпта ---------------------------------------------------------------

const OWN = ['academy_status', 'academy_marker', 'academy_oneshot'];
const ourPrompts = () => ({
  academy_status: { value: 'среда, 2-я пара', position: 1, depth: 1, role: 0 },
  academy_marker: { value: 'Первой строкой ответа поставь метку…', position: 1, depth: 2, role: 0 },
  academy_oneshot: { value: '', position: 1, depth: 0, role: 0 },
});

test('доктор: свои инжекты помечены и не подозреваются, пустые скрыты', () => {
  const d = promptDoctorView({ prompts: ourPrompts(), own: OWN, markerKey: 'academy_marker', markerSeen: true });
  assert.equal(d.available, true);
  assert.deepEqual(d.rows.map((r) => r.key), ['academy_marker', 'academy_status']);
  assert.ok(d.rows.every((r) => r.ours && !r.wantsStart), '«первой строкой» в нашей инструкции — не подозрение');
  assert.equal(d.hidden, 1);
  assert.equal(d.status, DOCTOR_TEXT.markerSeen);
  assert.equal(d.noReasons, DOCTOR_TEXT.noReasons);
  assert.equal(d.rows[0].where, 'в чате, глубина 2 · system');
});

test('доктор: просьбы начала и конца узнаются по-русски и по-английски', () => {
  const asks = {
    a: 'Begin your response with the status block.',
    b: 'В начале ответа выведи инфоблок сцены.',
    c: 'Выведи это первой строкой.',
    d: 'At the very start of each reply, print the clock.',
    e: 'Append this at the end of your response.',
    f: 'Последней строкой — статус телефона.',
    g: 'В конце ответа добавь <tel:*>.',
    h: 'Пиши живо и без повторов.',
  };
  const prompts = Object.fromEntries(Object.entries(asks).map(([k, v]) => [k, { value: v, position: 1, depth: 3, role: 0 }]));
  const d = promptDoctorView({ prompts, own: [], markerKey: 'x', markerSeen: false });
  const by = Object.fromEntries(d.rows.map((r) => [r.key, r]));
  for (const k of ['a', 'b', 'c', 'd']) assert.equal(by[k].wantsStart, true, asks[k]);
  for (const k of ['e', 'f', 'g']) assert.equal(by[k].wantsEnd, true, asks[k]);
  assert.equal(by.h.wantsStart || by.h.wantsEnd, false);
  assert.ok(by.b.startHint.includes('В начале ответа'), 'кусок текста для проверки глазами');
});

test('доктор: сосед ближе к хвосту, общая глубина, шапка ответа, encode_tags — причинами', () => {
  const prompts = {
    ...ourPrompts(),
    scene: { value: 'MANDATORY: scene header as the first line.', position: 1, depth: 0, role: 0 },
    same: { value: 'Держи тон.', position: 1, depth: 1, role: 0 },
  };
  const d = promptDoctorView({
    prompts, own: OWN, markerKey: 'academy_marker', markerSeen: false,
    lastText: '<div class="scene">📍 Коридор</div>\nОна шла.', encodeTags: true,
  });
  assert.equal(d.status, DOCTOR_TEXT.markerMissing);
  assert.ok(d.reasons[0].includes('scene') && d.reasons[0].includes('ближе к концу'), d.reasons[0]);
  assert.ok(d.reasons.some((r) => r.includes('<div class="scene">')));
  assert.ok(d.reasons.includes(DOCTOR_TEXT.reasonEncode));
  const same = d.rows.find((r) => r.key === 'same');
  assert.ok(same.flags.some((f) => f.includes('по алфавиту')), 'сосед на нашей глубине и роли помечен');
  assert.equal(d.rows.find((r) => r.key === 'scene').mandatory, true);
});

test('доктор: метку не просим — причин не ищем; инжектов нет — так и сказано', () => {
  const off = promptDoctorView({
    prompts: { scene: { value: 'first line of your response', position: 1, depth: 0, role: 0 } },
    own: OWN, markerKey: 'academy_marker', markerWanted: false,
  });
  assert.equal(off.status, DOCTOR_TEXT.markerOff);
  assert.deepEqual(off.reasons, []);
  assert.equal(promptDoctorView({ prompts: {}, own: OWN }).emptyText, DOCTOR_TEXT.empty);
  assert.equal(promptDoctorView({ prompts: null }).available, false);
});

test('доктор: ключи самой таверны — словами', () => {
  assert.equal(promptOwner('2_floating_prompt'), 'Заметка автора');
  assert.equal(promptOwner('customDepthWI_4_0'), 'World Info на глубине');
  assert.equal(promptOwner('DEPTH_PROMPT_1'), 'Заметка персонажа (depth prompt)');
  assert.equal(promptOwner('BB_phone'), 'BB_phone');
});

test('доктор: чужая шапка ответа — по форме; наша метка и проза — не шапка', () => {
  assert.equal(foreignHead('<!-- [ACADEMY t=+1] -->\nТекст'), '');
  assert.equal(foreignHead('Она вошла в аудиторию.'), '');
  assert.equal(foreignHead('```\nstatus\n```'), '```');
  assert.equal(foreignHead('📅 Среда | 🕰 10:15'), '📅 Среда | 🕰 10:15');
  assert.equal(foreignHead('[SCENE: коридор]'), '[SCENE: коридор]');
});

// --- отладка: объявление, повод, кубик ---------------------------------------------

test('отладка: объявление итогов, повод сдвига отношения, кубик соседа и дата объявления', () => {
  const s = started();
  assert.equal(describeApplied({ kind: 'announced', examIds: ['0:physics:exam'] }, ru.vocab),
    'объявлены итоги: 0:physics:exam');
  const rel = describeApplied({ kind: 'rel', teacherId: 'petrova', delta: -1, reason: { kind: 'skip', subjectId: 'chemistry' } },
    ru.vocab, { state: s, preset: ru });
  assert.match(rel, /повод: прогул: аналитическая химия$/);
  const exam = describeApplied({
    kind: 'exam', subjectId: 'physics', value: '2', reason: 'roll',
    check: { dc: 8, base: 8, mods: {}, roll: 12, tier: 'success' },
    external: { source: 'dice', tier: 'fail', roll: 4, dc: 12, value: '2' },
    announceOn: '2024-12-24',
  }, ru.vocab);
  assert.match(exam, /кубик соседа: провал 4 из 12 → 2/);
  assert.match(exam, /объявят 2024-12-24$/);
  assert.equal(describeApplied({ kind: 'rel', teacherId: 'p', delta: 1 }, ru.vocab), 'отношение: p +1', 'старый вызов — прежняя строка');
});

test('отладка: расхождение от кубика подписано кубиком, от модели — моделью', () => {
  const s = started(ru, (x) => {
    x.journal = [
      { day: '2024-12-23', kind: 'exam', text: '', data: { examId: 'e1', subjectId: 'physics', computed: '4', modelSaid: '2', applied: true, source: 'dice' } },
      { day: '2024-12-23', kind: 'exam', text: '', data: { examId: 'e2', subjectId: 'chemistry', computed: '3', modelSaid: '5', applied: true } },
    ];
  });
  const v = debugView(null, s, ru, { debug: true });
  assert.equal(v.divergences[0].source, 'dice');
  assert.match(v.divergences[0].text, /кубик соседа решил 2/);
  assert.match(v.divergences[1].text, /модель написала 5/);
});

// --- слова: без слов заведения, без «ачивок», перекрываются пресетом ---------------

test('слова проводки и доктора — механизма: ни «пары», ни «сессии», ни «ачивок»', () => {
  const forbidden = /сесси|семестр|тримест|пара|пары|предмет|преподавател|зачётк|хвост|дисциплин|наставник/i;
  const flat = (o) => Object.values(o).flatMap((v) => (v && typeof v === 'object' ? flat(v) : [String(v)]));
  for (const text of [...flat(EXTRA_UI), ...flat(DOCTOR_TEXT)]) {
    assert.equal(forbidden.test(text), false, `слово заведения: ${text}`);
    assert.equal(/ачивк|достижени|achievement/i.test(text), false, text);
  }
  for (const key of Object.keys(EXTRA_UI)) assert.equal(key in DEBUG_TEXT, false, key);
});

test('extraLabels: пресет перекрывает любой ключ, ступени сливаются по одной', () => {
  const own = { ...ru, ui: { ...ru.ui, roomField: 'Зал', checkTiers: { success: 'сдано' } } };
  const X = extraLabels(own);
  assert.equal(X.roomField, 'Зал');
  assert.equal(X.checkTiers.success, 'сдано');
  assert.equal(X.checkTiers.fail, EXTRA_UI.checkTiers.fail);
  assert.equal(extraLabels(ru).roomField, EXTRA_UI.roomField);
});

// --- звук вехи ------------------------------------------------------------------------

test('звук вехи: две ноты WebAudio без файлов; без WebAudio и до жеста — тихо и без исключений', () => {
  const made = [];
  class FakeAC {
    constructor() { this.state = 'running'; this.currentTime = 1; this.destination = {}; }
    createOscillator() {
      const o = { frequency: {}, connect() {}, start(t) { o.at = t; }, stop() {} };
      made.push(o);
      return o;
    }
    createGain() {
      return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
    }
  }
  const real = globalThis.AudioContext;
  try {
    delete globalThis.AudioContext;
    assert.equal(playChime(), false, 'WebAudio нет — false, не исключение');
    globalThis.AudioContext = FakeAC;
    assert.equal(playChime(), true);
    assert.equal(made.length, 2);
    assert.ok(made[1].frequency.value > made[0].frequency.value, 'вторая нота выше');
    assert.ok(made[1].at > made[0].at);
  } finally {
    if (real === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = real;
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SCHEMA_VERSION,
  createState,
  validateState,
  migrate,
  cloneState,
  normalizeSubject,
  normalizeTeacher,
  teacherOfSubject,
  pushJournal,
  pushPending,
  takePending,
  labelFor,
  defaultStartDay,
  TEACHER_TEXT_MAX,
  teacherDetails,
} from '../core/state.mjs';
import { overallScore } from '../core/gradebook.mjs';

const PRESET = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'),
);

/** Минимальный семестр: два предмета, два преподавателя, расписание на два дня. */
function semester() {
  return createState(PRESET, {
    startDay: '2026-09-01',
    subjects: [
      { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
      { id: 'physics', name: 'физика', teacherId: 'ivanov' },
    ],
    teachers: [
      { id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['злопамятна'] },
      { id: 'ivanov', name: 'Иванов Пётр Ильич', traits: ['добродушен'] },
    ],
    schedule: { 1: ['chemistry', 'physics'], 2: ['physics'] },
  });
}

test('новый семестр проходит валидацию', () => {
  const r = validateState(semester(), PRESET);
  assert.deepEqual(r.errors, []);
  assert.ok(r.ok);
});

test('состояние сериализуется без потерь', () => {
  // Требование 3.8: состояние уезжает в chat_metadata через JSON при каждом
  // сохранении. Ни Date, ни Map, ни функций внутри быть не должно.
  const s = semester();
  const back = JSON.parse(JSON.stringify(s));
  assert.deepEqual(back, s);
  assert.ok(validateState(back, PRESET).ok);
});

test('пресет внутрь состояния не копируется', () => {
  // Иначе правка пресета никогда не доедет до уже начатого семестра.
  const s = semester();
  assert.equal(s.presetId, 'ru-university');
  const json = JSON.stringify(s);
  assert.ok(!json.includes('bells'));
  assert.ok(!json.includes('displayName'));
});

test('семестр начинается невыключенным: расширение молчит, пока не начали явно', () => {
  // Открытый вопрос 3 плана: понять «академический» чат автоматически нельзя,
  // поэтому по умолчанию started = false.
  assert.equal(semester().started, false);
});

test('валидация ловит битый календарь', () => {
  const s = semester();
  s.calendar.day = '1 сентября';
  const r = validateState(s, PRESET);
  assert.ok(!r.ok);
  assert.ok(r.errors.some((e) => e.includes('ГГГГ-ММ-ДД')));
});

test('валидация ловит точность datetime без часов', () => {
  const s = semester();
  s.calendar.precision = 'datetime';
  s.calendar.time = null;
  assert.ok(validateState(s, PRESET).errors.some((e) => e.includes('datetime')));
});

test('валидация ловит висячие ссылки и повторы', () => {
  const s = semester();
  s.subjects.push({ id: 'chemistry', name: 'ещё химия', teacherId: 'sidorov', grades: [], debt: false });
  s.schedule['3'] = ['history'];
  const errors = validateState(s, PRESET).errors.join('\n');
  assert.ok(errors.includes('chemistry повторяется'));
  assert.ok(errors.includes('sidorov'));
  assert.ok(errors.includes('history'));
});

test('валидация ловит потолок предметов из пресета', () => {
  const s = semester();
  for (let i = 0; i < PRESET.limits.maxSubjects; i++) {
    s.subjects.push({ id: `s${i}`, name: `предмет ${i}`, teacherId: null, grades: [], debt: false });
  }
  assert.ok(validateState(s, PRESET).errors.some((e) => e.includes('потолок')));
});

test('день недели вне 1–7 в расписании — ошибка', () => {
  const s = semester();
  s.schedule['8'] = [];
  assert.ok(validateState(s, PRESET).errors.some((e) => e.includes('вне 1–7')));
});

test('migrate добивает поля состояния из версии, где их не было', () => {
  // Расширение, теряющее чужой семестр после обновления, теряет вместе с ним и
  // репутацию, — поэтому migrate есть до первой миграции.
  const ancient = { presetId: 'ru-university', calendar: { day: '2026-09-14' }, subjects: [{ id: 'chemistry' }] };
  const s = migrate(ancient, PRESET);
  assert.equal(s.schemaVersion, SCHEMA_VERSION);
  assert.equal(s.calendar.day, '2026-09-14');
  assert.equal(s.calendar.precision, 'date');
  assert.equal(s.subjects[0].name, 'chemistry');
  assert.equal(s.reputation.value, PRESET.reputation.start);
  assert.ok(validateState(s, PRESET).ok);
});

test('migrate от мусора даёт годный новый семестр', () => {
  for (const junk of [null, undefined, 'состояние', 42]) {
    const s = migrate(junk, PRESET);
    assert.ok(validateState(s, PRESET).ok, `не пережил ${String(junk)}`);
  }
});

test('migrate сохраняет уже посчитанное, а не сбрасывает', () => {
  const s = semester();
  s.reputation.value = 12;
  s.reputation.warned = true;
  s.calendar.moved = 30;
  const back = migrate(JSON.parse(JSON.stringify(s)), PRESET);
  assert.equal(back.reputation.value, 12);
  assert.equal(back.reputation.warned, true);
  assert.equal(back.calendar.moved, 30);
});

test('схема 1 → 2: сессия получает период, а зачётка не шевелится', () => {
  // Живой семестр из первой схемы: сессия идёт, одно контрольное сдано, второе
  // завалено и ждёт пересдачи. Именно такое состояние лежит в чужом чате в
  // момент обновления, и потерять его нельзя (3.8).
  const old = {
    schemaVersion: 1,
    presetId: 'ru-university',
    lang: 'ru',
    started: true,
    calendar: {
      day: '2024-12-26', time: null, precision: 'date', daypart: null,
      periodIndex: null, termStart: '2024-09-02', moved: 40, idle: 0, source: 'B',
    },
    subjects: [
      { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova', examKind: 'credit', grades: [{ value: 'зачёт', day: '2024-12-24' }], debt: false },
      { id: 'physics', name: 'физика', teacherId: 'ivanov', examKind: 'exam', grades: [{ value: '2', day: '2024-12-25' }], debt: false },
    ],
    teachers: [
      { id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['злопамятна'], relation: -3 },
      { id: 'ivanov', name: 'Иванов Пётр Ильич', traits: [], relation: 2 },
    ],
    schedule: { 1: ['chemistry', 'physics'] },
    attendance: { records: [{ day: '2024-09-02', subjectId: 'chemistry', status: 'skip', periodIndex: 0 }] },
    reputation: { value: 44, warned: false, expelled: false },
    exams: {
      active: true,
      items: [
        { id: 'chemistry:credit', subjectId: 'chemistry', kind: 'credit', day: '2024-12-24', outcome: 'зачёт', attempts: 1 },
        { id: 'physics:exam', subjectId: 'physics', kind: 'exam', day: '2024-12-25', outcome: '2', attempts: 1 },
      ],
    },
    journal: [
      { day: '2024-12-25', kind: 'exam', text: 'физика: 2', data: { examId: 'physics:exam', value: '2', passed: false } },
      { day: '2024-12-24', kind: 'grade', text: 'grade chemistry=зачёт', data: { subjectId: 'chemistry' } },
    ],
    pending: [{ id: 'exam:physics:exam:1', kind: 'exam', text: 'экзамен по физике не сдан' }],
  };
  const before = JSON.parse(JSON.stringify(old));

  const s = migrate(old, PRESET);
  assert.equal(s.schemaVersion, SCHEMA_VERSION);
  assert.ok(validateState(s, PRESET).ok, validateState(s, PRESET).errors.join('; '));

  // Сессия первой схемы была одна на всю игру — значит, нулевого периода.
  assert.equal(s.exams.term, 0);
  assert.deepEqual(s.exams.items.map((i) => i.term), [0, 0]);
  assert.deepEqual(s.exams.items.map((i) => i.id), ['0:chemistry:credit', '0:physics:exam']);
  assert.equal(s.exams.active, true);

  // Ничего не потеряно: исходы, попытки, дни — на месте.
  assert.deepEqual(
    s.exams.items.map((i) => [i.subjectId, i.kind, i.outcome, i.attempts, i.day]),
    [['chemistry', 'credit', 'зачёт', 1, '2024-12-24'], ['physics', 'exam', '2', 1, '2024-12-25']],
  );

  // Ссылки на id события переписаны вместе с ним: летопись первого семестра
  // обязана и дальше находить свой предмет, а одноразовый инжект — своё событие.
  assert.equal(s.journal[0].data.examId, '0:physics:exam');
  assert.equal(s.journal[1].data.subjectId, 'chemistry', 'чужие записи журнала не тронуты');
  assert.equal(s.pending[0].id, 'exam:0:physics:exam:1');

  // Зачётка — та же самая, до знака. Это и есть цена миграции: ноль.
  assert.deepEqual(s.subjects.map((x) => x.grades), before.subjects.map((x) => x.grades));
  assert.equal(overallScore(s, PRESET), overallScore(before, PRESET));
  assert.deepEqual(s.attendance.records, before.attendance.records);
  assert.equal(s.reputation.value, 44);
  assert.equal(s.calendar.moved, 40);

  // И чужой объект не изуродован по дороге: ядро чистое.
  assert.deepEqual(old, before);

  // Повторный подъём — тот же результат: миграция идемпотентна.
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(s)), PRESET), s);
});

test('схема 1 → 2: семестр без сессии остаётся без периода', () => {
  // Приписать нетронутой сессии нулевой период значило бы сказать «первая уже
  // была» и запереть вход в неё ровно тем сторожем, который чинится.
  const old = { schemaVersion: 1, presetId: 'ru-university', exams: { active: false, items: [] } };
  const s = migrate(old, PRESET);
  assert.equal(s.exams.term, null);
  assert.equal(s.exams.active, false);
});

test('normalizeSubject не выдумывает недостающего', () => {
  const s = normalizeSubject({ id: ' chemistry ' });
  assert.deepEqual(s, { id: 'chemistry', name: 'chemistry', teacherId: null, examKind: null, grades: [], debt: false });

  // Вид контрольного события, заданный планом, переживает нормализацию.
  assert.equal(normalizeSubject({ id: 'chemistry', examKind: 'exam' }).examKind, 'exam');
});

test('normalizeTeacher берёт стартовое отношение из пресета', () => {
  assert.equal(normalizeTeacher({ id: 'petrova' }, PRESET).relation, PRESET.relations.start);
  assert.equal(normalizeTeacher({ id: 'petrova', relation: -3 }, PRESET).relation, -3);
});

test('cloneState не делит ссылки с оригиналом', () => {
  const s = semester();
  const c = cloneState(s);
  c.subjects[0].name = 'другое';
  c.journal.push({ kind: 'debug', text: 'x' });
  assert.equal(s.subjects[0].name, 'аналитическая химия');
  assert.equal(s.journal.length, 0);
});

test('teacherOfSubject находит преподавателя и не падает на его отсутствии', () => {
  const s = semester();
  assert.equal(teacherOfSubject(s, 'chemistry').name, 'Петрова Анна Сергеевна');
  assert.equal(teacherOfSubject(s, 'history'), null);
  s.subjects[0].teacherId = null;
  assert.equal(teacherOfSubject(s, 'chemistry'), null);
});

test('журнал кольцевой: потолок из пресета не превышается', () => {
  const s = semester();
  const cap = PRESET.limits.journalSize;
  for (let i = 0; i < cap + 50; i++) pushJournal(s, { kind: 'debug', text: `строка ${i}` }, PRESET);
  assert.equal(s.journal.length, cap);
  assert.equal(s.journal[0].text, 'строка 50');
  assert.equal(s.journal[0].day, '2026-09-01');
});

test('одноразовый инжект не дублируется и снимается разом', () => {
  // 3.5: инжект повелительный и одноразовый, снимается по MESSAGE_RECEIVED и
  // MESSAGE_SWIPED. Два одинаковых в очереди — это два одинаковых требования
  // модели в одном промпте.
  const s = semester();
  pushPending(s, { id: 'exam:chemistry', kind: 'exam', text: 'зачёт не сдан' });
  pushPending(s, { id: 'exam:chemistry', kind: 'exam', text: 'зачёт не сдан' });
  assert.equal(s.pending.length, 1);
  const taken = takePending(s);
  assert.equal(taken.length, 1);
  assert.equal(s.pending.length, 0);
  assert.deepEqual(takePending(s), []);
});

test('labelFor даёт слово по числу на границах таблицы', () => {
  // Наружу уходит слово, число остаётся внутри (3.3).
  const rel = PRESET.relations.labels;
  assert.equal(labelFor(rel, -5), 'не терпит');
  assert.equal(labelFor(rel, -4), 'не терпит');
  assert.equal(labelFor(rel, 0), 'не выделяет');
  assert.equal(labelFor(rel, 5), 'покровительствует');
  assert.equal(labelFor(rel, 99), 'покровительствует');
  assert.equal(labelFor([], 3), '');
});

test('defaultStartDay берёт начало семестра из пресета', () => {
  assert.equal(defaultStartDay(PRESET, new Date(2026, 4, 17)), '2026-09-01');
});

test('validateState не падает на достаточно битом состоянии', () => {
  // Проверка целостности обязана пережить именно то, ради чего написана:
  // состояние, в котором списки — не списки. Раньше она доходила до расписания
  // и звала `some` у строки.
  const state = createState(PRESET, { startDay: '2024-09-02' });
  state.subjects = 'строка';
  state.teachers = null;
  state.schedule = { 1: ['chemistry'] };

  const res = validateState(state, PRESET);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('subjects не массив')));
  assert.ok(res.errors.some((e) => e.includes('teachers не массив')));
  assert.ok(res.errors.some((e) => e.includes('неизвестный предмет chemistry')));
});

// --- учителя с душой: должность, «любит», тайна -------------------------------

test('нормализация: должность, «любит» и тайна — строкой в одну строку, по потолку, пустые без ключа', () => {
  const t = normalizeTeacher({
    id: 'veyl', name: 'Магистр Вейл', traits: ['злопамятен'],
    post: '  директор\n академии ', likes: 'белое вино', secret: 'я'.repeat(500),
  }, PRESET);
  assert.equal(t.post, 'директор академии');
  assert.equal(t.likes, 'белое вино');
  assert.equal(t.secret.length, TEACHER_TEXT_MAX.secret);
  assert.equal(normalizeTeacher({ id: 'a', post: 'я'.repeat(100) }, PRESET).post.length, TEACHER_TEXT_MAX.post);

  const bare = normalizeTeacher({ id: 'a', name: 'А', post: '   ', likes: null, secret: {} }, PRESET);
  for (const key of ['post', 'likes', 'secret']) assert.equal(key in bare, false, key);
  assert.deepEqual(teacherDetails({ post: 'декан', other: 'x' }), { post: 'декан' });
});

test('старое состояние без полей души валидно и после миграции не обрастает ключами', () => {
  const old = semester();
  old.teachers = old.teachers.map(({ id, name, traits, relation }) => ({ id, name, traits, relation }));
  assert.deepEqual(validateState(old, PRESET).errors, []);
  const m = migrate(old, PRESET);
  assert.deepEqual(validateState(m, PRESET).errors, []);
  assert.deepEqual(Object.keys(m.teachers[0]).sort(), ['id', 'name', 'relation', 'traits']);

  // Восемь преподавателей прошлого семестра не урезаются: потолок генерации
  // (`planTeachers`) — про то, сколько звать, а не сколько держать.
  const many = semester();
  many.teachers = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, name: `П${i}`, traits: [], relation: 0 }));
  many.subjects.forEach((s) => { s.teacherId = 't0'; });
  assert.deepEqual(validateState(many, PRESET).errors, []);
  assert.equal(migrate(many, PRESET).teachers.length, 8);
});

test('миграция приводит длинную тайну к потолку, validateState называет негодную', () => {
  const s = semester();
  s.teachers[0].secret = 'я'.repeat(400);
  s.teachers[1].post = 42;
  const errors = validateState(s, PRESET).errors.join(' | ');
  assert.match(errors, /petrova: поле secret/);
  assert.match(errors, /ivanov: поле post/);
  const m = migrate(s, PRESET);
  assert.equal(m.teachers[0].secret.length, TEACHER_TEXT_MAX.secret);
  assert.equal(m.teachers[1].post, '42');
  assert.deepEqual(validateState(m, PRESET).errors, []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createState } from '../core/state.mjs';
import { mark } from '../core/attendance.mjs';
import { addGrade, setDebt } from '../core/gradebook.mjs';
import { changeRelation } from '../core/relations.mjs';
import { changeReputation } from '../core/reputation.mjs';
import { scheduleExams, applyOutcome } from '../core/exams.mjs';
import {
  buildLorebook, buildEntries, diffEntries, significantEvents, isSignificant,
  teacherEntry, charterEntry, suggestedEntry, fingerprint, isHandEdited,
  estimateTokens, measure, entryCap,
  KEEP_EDITED, KEEP_UNCHANGED, KEEP_FOREIGN, SKIP_CAP, DEFAULTS,
} from '../core/lorebook.mjs';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));

/** Семестр из двух предметов: минимум, на котором видно все четыре категории. */
function semester(opts = {}) {
  return createState(preset, {
    startDay: '2024-09-02',
    survey: { era: 'наши дни', country: 'Россия', institution: 'политехнический институт', faculty: 'химия', year: '2', lang: 'ru' },
    subjects: [
      { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
      { id: 'physics', name: 'физика', teacherId: 'ivanov' },
    ],
    teachers: [
      { id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['злопамятна', 'придирается к опозданиям'] },
      { id: 'ivanov', name: 'Иванов Пётр Ильич', traits: ['добродушен'] },
    ],
    schedule: { 1: ['chemistry', 'physics'], 2: ['physics', 'chemistry'], 3: ['chemistry', 'physics'], 4: ['physics', 'chemistry'], 5: ['chemistry', 'physics'] },
    ...opts,
  });
}

/**
 * Слой таверны, которого в ядре нет: применяет план и отдаёт снимок лорбука.
 * Отпечаток ложится рядом с записью — именно на нём держится правило про правки.
 */
function apply(snapshot, plan) {
  const next = (snapshot || []).map((s) => ({ ...s }));
  const put = (e) => {
    const row = { uid: e.uid, content: e.content, fingerprint: e.fingerprint };
    const at = next.findIndex((s) => s.uid === e.uid);
    if (at < 0) next.push(row); else next[at] = row;
  };
  plan.create.forEach(put);
  plan.update.forEach(put);
  return next;
}

// --- четыре категории из 3.7 ------------------------------------------------

test('преподаватель попадает в лорбук с предметом, характером и ключом по имени и фамилии', () => {
  const e = teacherEntry(semester(), 'petrova', preset);

  assert.equal(e.category, 'people');
  assert.equal(e.origin, 'own');
  assert.ok(e.content.includes('аналитическая химия'), e.content);
  assert.ok(e.content.includes('злопамятна'), e.content);
  assert.ok(e.keys.includes('Петрова Анна Сергеевна'));
  assert.ok(e.keys.includes('Петрова'), `в сцене её зовут и по фамилии: ${e.keys}`);
  assert.ok(e.keys.includes('Анна'));
});

test('устав — одна запись и постоянно активная', () => {
  const entries = buildEntries(semester(), preset);
  const charter = entries.filter((e) => e.category === 'charter');

  assert.equal(charter.length, 1, 'устав — ровно одна запись');
  assert.equal(charter[0].constant, true);
  assert.deepEqual(charter[0].keys, [], 'постоянной записи ключи не нужны');
  // Устав объясняет модели, почему репутация чего-то стоит (3.7).
  assert.ok(charter[0].content.includes(preset.vocab.expulsion), charter[0].content);
  assert.ok(charter[0].content.includes('ничем не выделяется'), charter[0].content);
});

// --- правило 1: правленое руками не трогаем ---------------------------------

test('запись, тронутую руками, модуль больше не трогает — только дописывает новые', () => {
  const state = semester();
  const first = buildLorebook(state, preset);
  let book = apply([], first);

  // Человек переписал запись про Петрову своими словами.
  const at = book.findIndex((s) => s.uid === 'academy:teacher:petrova');
  book[at] = { ...book[at], content: 'Петрова. Своими словами, как мне нравится.' };

  // ...а механика тем временем сдвинула отношение — запись «устарела».
  const moved = changeRelation(state, { teacherId: 'petrova', delta: -3 }, preset).state;
  const second = buildLorebook(moved, preset, { snapshot: book });

  const petrova = second.keep.find((k) => k.uid === 'academy:teacher:petrova');
  assert.ok(petrova, 'правленая запись обязана попасть в «оставить как есть»');
  assert.equal(petrova.reason, KEEP_EDITED);
  assert.ok(!second.update.some((e) => e.uid === 'academy:teacher:petrova'), 'обновлять её нельзя');
  assert.ok(!second.create.some((e) => e.uid === 'academy:teacher:petrova'));

  // Новые записи при этом дописываются: смена ярлыка отношения — событие хроники.
  assert.ok(second.create.some((e) => e.category === 'chronicle'), 'новое дописывать модуль не перестаёт');
});

test('правка узнаётся по отпечатку, а запись без отпечатка считается нетронутой', () => {
  const e = teacherEntry(semester(), 'petrova', preset);

  assert.equal(isHandEdited({ uid: e.uid, content: e.content, fingerprint: e.fingerprint }), false);
  assert.equal(isHandEdited({ uid: e.uid, content: `${e.content} и ещё кое-что`, fingerprint: e.fingerprint }), true);
  assert.equal(isHandEdited({ uid: e.uid, content: e.content, edited: true }), true, 'явный флаг старше отпечатка');
  // Отпечатка нет у всего, что записано до появления правила: объявить такие
  // записи правлеными значит перестать обновлять весь старый лорбук разом.
  assert.equal(isHandEdited({ uid: e.uid, content: 'что угодно' }), false);
  assert.notEqual(fingerprint('а'), fingerprint('б'));
});

test('повторный прогон без изменений не создаёт и не обновляет ничего', () => {
  const state = livedSemester();
  const first = buildLorebook(state, preset);
  const book = apply([], first);

  const second = buildLorebook(state, preset, { snapshot: book });
  assert.deepEqual(second.create, []);
  assert.deepEqual(second.update, []);
  assert.equal(second.keep.length, book.length);
  assert.ok(second.keep.every((k) => k.reason === KEEP_UNCHANGED), second.keep.map((k) => k.reason).join(','));
});

test('изменившаяся запись обновляется, а чужая в том же лорбуке не трогается', () => {
  const state = semester();
  const book = apply([{ uid: 'someone-else', content: 'запись из чужого лорбука' }], buildLorebook(state, preset));

  const moved = changeRelation(state, { teacherId: 'ivanov', delta: 3 }, preset).state;
  const plan = buildLorebook(moved, preset, { snapshot: book });

  assert.deepEqual(plan.update.map((e) => e.uid), ['academy:teacher:ivanov']);
  assert.equal(plan.keep.find((k) => k.uid === 'someone-else').reason, KEEP_FOREIGN);
});

// --- правило 2: хроника только по значимым событиям -------------------------

test('присутствие, оценка и ход времени в хронику не попадают', () => {
  let s = semester();
  s = mark(s, { subjectId: 'chemistry', status: 'present', day: '2024-09-02', periodIndex: 0 }, preset).state;
  s = mark(s, { subjectId: 'physics', status: 'late', day: '2024-09-02', periodIndex: 1 }, preset).state;
  s = addGrade(s, { subjectId: 'chemistry', value: '4', day: '2024-09-03' }, preset).state;
  s = setDebt(s, 'physics', true, preset);

  assert.ok(s.journal.length >= 4, 'события в журнале есть');
  assert.deepEqual(significantEvents(s, preset), [], 'но ни одно из них не значимо');
  assert.equal(buildEntries(s, preset).filter((e) => e.category === 'chronicle').length, 0);
});

test('значимо только то, что меняет сцену: исход сессии, порог репутации, смена ярлыка отношения', () => {
  const s = semester();
  const rep = preset.reputation;

  assert.equal(isSignificant({ kind: 'exam', data: { examId: 'e1', value: '2' } }, s, preset), true);
  assert.equal(isSignificant({ kind: 'exam', data: { count: 4 } }, s, preset), false, 'назначение сессии — не событие хроники');

  assert.equal(isSignificant({ kind: 'reputation', data: { from: rep.warnAt + 1, to: rep.warnAt } }, s, preset), true);
  assert.equal(isSignificant({ kind: 'reputation', data: { from: 50, to: 46 } }, s, preset), false, 'обычный сдвиг порога не пробил');
  assert.equal(isSignificant({ kind: 'reputation', data: { from: rep.warnAt, to: rep.warnAt - 1 } }, s, preset), false, 'порог пробивается один раз');

  // Отношение меряется ярлыком, а не числом: -1 → -2 внутри «недоволен» сцену не меняет.
  assert.equal(isSignificant({ kind: 'rel', data: { teacherId: 'petrova', from: -1, to: -2 } }, s, preset), true);
  assert.equal(isSignificant({ kind: 'rel', data: { teacherId: 'petrova', from: -2, to: -3 } }, s, preset), false);

  assert.equal(isSignificant({ kind: 'attendance', data: { status: 'skip' } }, s, preset), false);
  assert.equal(isSignificant({ kind: 'grade', data: { value: '2' } }, s, preset), false);
  assert.equal(isSignificant({ kind: 'time', data: {} }, s, preset), false);
});

test('на значимое событие заводится запись хроники с ключами по участникам', () => {
  let s = semester();
  s = changeRelation(s, { teacherId: 'petrova', delta: -2 }, preset).state;

  const chronicle = buildEntries(s, preset).filter((e) => e.category === 'chronicle');
  assert.equal(chronicle.length, 1);
  assert.ok(chronicle[0].keys.includes('Петрова'), chronicle[0].keys.join(','));
  assert.ok(chronicle[0].content.includes('не выделяет'), chronicle[0].content);
  assert.ok(chronicle[0].content.includes('недолюбливает'), `в записи видно, куда перешёл ярлык: ${chronicle[0].content}`);
  assert.equal(chronicle[0].constant, false, 'хроника подгружается по ключу, а не висит постоянно');
});

test('за прожитый семестр записей хроники — единицы, а не сотни', () => {
  const s = livedSemester();
  const chronicle = buildEntries(s, preset).filter((e) => e.category === 'chronicle');

  assert.ok(chronicle.length > 0, 'что-то значимое за семестр случилось');
  // Пар за семестр — сотни, событий журнала — сотня. Если бы значимость не была
  // правилом, лорбук вытеснил бы из контекста всё остальное (риски, :598).
  assert.ok(chronicle.length < s.journal.length / 4, `хроники ${chronicle.length} на ${s.journal.length} записей журнала`);
  assert.equal(new Set(chronicle.map((e) => e.uid)).size, chronicle.length, 'uid записей хроники не сталкиваются');
});

// --- правило 3: потолок из пресета ------------------------------------------

test('потолок числа записей берётся из пресета, а не из кода', () => {
  assert.equal(entryCap(preset), preset.limits.maxLorebookEntries);
  assert.equal(entryCap({}), DEFAULTS.maxEntries, 'молчащий пресет — запасное значение');

  const tight = { ...preset, limits: { ...preset.limits, maxLorebookEntries: 3 } };
  const s = livedSemester();
  const plan = buildLorebook(s, tight, {});

  assert.equal(plan.create.length, 3, 'сверх потолка не создаётся ничего');
  assert.ok(plan.skipped.length > 0);
  assert.ok(plan.skipped.every((x) => x.reason === SKIP_CAP));
  assert.ok(plan.measure.withinCap);

  // Приоритет при нехватке мест: устав и люди важнее хроники.
  assert.deepEqual(plan.create.map((e) => e.category), ['charter', 'people', 'people']);
  assert.ok(plan.skipped.every((x) => x.category === 'chronicle'));
});

test('уже лежащие записи потолок не выселяет — он только перестаёт добавлять новое', () => {
  const tight = { ...preset, limits: { ...preset.limits, maxLorebookEntries: 4 } };
  const state = semester();
  const book = apply([], buildLorebook(state, tight, {}));
  assert.equal(book.length, 3, 'устав и два преподавателя');

  const lived = livedSemester();
  const plan = buildLorebook(lived, tight, { snapshot: book });

  assert.equal(plan.create.length, 1, 'свободного места осталось на одну запись');
  assert.ok(plan.skipped.length > 0);
  // Ни одна лежащая запись не объявлена лишней: удаляет их таверна, а не мы.
  assert.equal(plan.keep.length + plan.update.length, 3);
});

// --- правило 4: слова из пресета --------------------------------------------

test('чужой пресет даёт чужие слова без единой правки в core/', () => {
  const hogwarts = {
    ...preset,
    id: 'hogwarts',
    lang: 'en',
    vocab: {
      period: 'lesson', periodPlural: 'lessons', term: 'term', teacher: 'professor',
      gradebook: 'record', debt: 'detention', debtPlural: 'detentions', examPeriod: 'O.W.L.s',
      expulsion: 'expulsion', expelled: 'expelled', warning: "summons to the Head of House",
      score: 'average mark',
    },
    relations: {
      ...preset.relations,
      labels: [
        { upTo: -4, label: 'loathes her' }, { upTo: -2, label: 'hostile' }, { upTo: -1, label: 'displeased' },
        { upTo: 1, label: 'indifferent' }, { upTo: 2, label: 'warm' }, { upTo: 4, label: 'favours her' },
        { upTo: 5, label: 'her champion' },
      ],
    },
    reputation: {
      ...preset.reputation,
      labels: [
        { upTo: 0, label: 'expelled' }, { upTo: 20, label: 'facing expulsion' }, { upTo: 40, label: 'in bad standing' },
        { upTo: 60, label: 'unremarkable' }, { upTo: 80, label: 'well regarded' }, { upTo: 100, label: 'the pride of the House' },
      ],
    },
    // Шаблонов лорбука у пресета нет вовсе: запасные обязаны собрать запись из
    // его лексики, а не подсунуть русские слова.
    phrases: { ...preset.phrases, lorebook: undefined },
  };

  let s = createState(hogwarts, {
    startDay: '1991-09-02',
    survey: { institution: 'Hogwarts', era: '', country: '', faculty: '', year: '', lang: 'en' },
    subjects: [{ id: 'potions', name: 'Potions', teacherId: 'snape' }],
    teachers: [{ id: 'snape', name: 'Severus Snape', traits: ['vindictive'] }],
  });
  s = changeRelation(s, { teacherId: 'snape', delta: -3 }, hogwarts).state;

  const text = buildEntries(s, hogwarts).map((e) => `${e.content} ${e.keys.join(' ')}`).join('\n');

  assert.ok(text.includes('Potions'), text);
  assert.ok(text.includes('Severus Snape'), text);
  assert.ok(text.includes('vindictive'), text);
  assert.ok(text.includes('expulsion'), text);
  assert.ok(text.includes('O.W.L.s'), text);
  for (const word of ['пара', 'зачёт', 'отчисление', 'преподаватель', 'сессия', 'хвост']) {
    assert.ok(!text.includes(word), `в записи не должно быть слова «${word}»: ${text}`);
  }
  assert.ok(!/[а-яА-ЯёЁ]/.test(text), `ни одной кириллической буквы: ${text}`);
});

test('пресет со своими шаблонами подставляет их дословно', () => {
  const custom = {
    ...preset,
    phrases: { ...preset.phrases, lorebook: { ...preset.phrases.lorebook, teacher: 'DOSSIER {name} // {subject} // {traits}' } },
  };
  const e = teacherEntry(semester(), 'petrova', custom);
  assert.equal(e.content, 'DOSSIER Петрова Анна Сергеевна // аналитическая химия // злопамятна, придирается к опозданиям');
});

// --- предложенные записи, а не сочинённые -----------------------------------

test('про NPC и места расширение только предлагает запись, а не сочиняет её само', () => {
  const plan = buildLorebook(semester(), preset, {
    npcs: [{ id: 'lena', name: 'Лена Ковалёва', note: 'соседка по комнате' }],
    places: [{ id: 'smoke', name: 'курилка за корпусом', note: 'там курят между парами' }],
  });

  assert.equal(plan.suggest.length, 2);
  assert.ok(plan.suggest.every((e) => e.origin === 'suggested'), 'предложение отличимо от собственной записи');
  assert.ok(plan.create.every((e) => e.origin === 'own'), 'в create уходит только то, что механика знает точно');
  assert.ok(!plan.create.some((e) => plan.suggest.some((p) => p.uid === e.uid)), 'предложение мимо create');

  const place = plan.suggest.find((e) => e.category === 'places');
  assert.deepEqual(place.keys, ['курилка за корпусом'], 'ключи мест — по названиям');
  assert.ok(plan.suggest.find((e) => e.category === 'people').keys.includes('Ковалёва'));

  // Предложения не входят в замер: без решения человека они контекст не съедят.
  assert.equal(plan.measure.entries, plan.create.length);

  // Принятое человеком предложение вторым прогоном не предлагается заново.
  const book = apply([{ uid: place.uid, content: place.content, fingerprint: place.fingerprint }], plan);
  const second = buildLorebook(semester(), preset, { snapshot: book, places: [{ id: 'smoke', name: 'курилка за корпусом' }] });
  assert.deepEqual(second.suggest, []);
});

// --- замер объёма -----------------------------------------------------------

test('замер токенов — честное приближение, а не подсчёт', () => {
  const per = preset.limits.lorebookCharsPerToken;
  assert.equal(estimateTokens('', preset), 0);
  assert.equal(estimateTokens('x'.repeat(per * 10), preset), 10);
  // Делитель — параметр пресета: у кириллицы и латиницы он разный.
  assert.equal(estimateTokens('x'.repeat(60), { limits: { lorebookCharsPerToken: 6 } }), 10);
  assert.equal(estimateTokens('x'.repeat(DEFAULTS.charsPerToken * 7), {}), 7);

  const m = measure([{ content: 'abc', keys: ['ab'] }], { limits: { lorebookCharsPerToken: 1 } });
  assert.equal(m.entries, 1);
  assert.equal(m.chars, 5, 'ключи уезжают в контекст вместе с текстом');
});

test('к концу синтетического семестра лорбук укладывается в потолок и в разумный объём', () => {
  const s = livedSemester();
  const plan = buildLorebook(s, preset, {});

  assert.ok(plan.measure.withinCap, `${plan.measure.entries} записей при потолке ${plan.measure.cap}`);
  assert.equal(plan.measure.entries, plan.create.length);
  // Число из прогона, не из намерения: если правка ядра его удвоит, тест это покажет.
  // eslint-disable-next-line no-console
  console.log(`лорбук за семестр: ${plan.measure.entries} записей, ${plan.measure.chars} символов, ~${plan.measure.tokens} токенов`);
  assert.ok(plan.measure.tokens < 2000, `лорбук не должен вытеснять контекст: ~${plan.measure.tokens} токенов`);
});

// --- чистота ----------------------------------------------------------------

test('состояние не правится на месте', () => {
  const s = livedSemester();
  const before = JSON.stringify(s);
  buildLorebook(s, preset, { npcs: [{ id: 'lena', name: 'Лена' }] });
  assert.equal(JSON.stringify(s), before);
});

test('план сериализуется без потерь: его понесут в таверну через JSON', () => {
  const plan = buildLorebook(livedSemester(), preset, {});
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
});

test('пустой семестр даёт только устав', () => {
  const s = createState(preset, { startDay: '2024-09-02' });
  const plan = buildLorebook(s, preset, {});
  assert.deepEqual(plan.create.map((e) => e.uid), ['academy:charter']);
  assert.deepEqual(plan.suggest, []);
  assert.deepEqual(plan.skipped, []);
});

test('снимок без записей и снимок из undefined — одно и то же', () => {
  const s = semester();
  assert.deepEqual(diffEntries(buildEntries(s, preset), undefined, preset), diffEntries(buildEntries(s, preset), [], preset));
});

test('устав пересобирается, когда меняется репутация', () => {
  const s = semester();
  const dropped = changeReputation(s, { delta: -35 }, preset).state;
  assert.notEqual(charterEntry(s, preset).content, charterEntry(dropped, preset).content);
});

test('предложение без имени не превращается в запись', () => {
  assert.equal(suggestedEntry({ id: 'x' }, preset), null);
  assert.equal(suggestedEntry(null, preset), null);
});

// --- синтетический семестр ---------------------------------------------------

/**
 * Прожитый семестр: пятнадцать учебных дней, прогулы, оценки, ссора с Петровой,
 * пробитый порог репутации и сданная сессия. Всё через штатные модули ядра —
 * лорбук обязан работать с журналом, который пишут они, а не с придуманным.
 */
function livedSemester() {
  let s = semester();
  const day = (n) => `2024-09-${String(2 + n).padStart(2, '0')}`;

  for (let n = 0; n < 15; n += 1) {
    for (const subjectId of ['chemistry', 'physics']) {
      // Каждый третий день химию прогуливает, остальное посещает.
      const skip = subjectId === 'chemistry' && n % 3 === 0;
      const att = mark(s, { subjectId, status: skip ? 'skip' : 'present', day: day(n), periodIndex: 0 }, preset);
      s = att.state;
      for (const id of att.effects.debt) s = setDebt(s, id, true, preset);
      if (att.effects.reputation) s = changeReputation(s, { delta: att.effects.reputation, reason: 'skip' }, preset).state;
      for (const d of att.effects.relation || []) s = changeRelation(s, d, preset).state;
    }
    if (n % 2 === 0) s = addGrade(s, { subjectId: 'physics', value: '4', day: day(n) }, preset).state;
  }

  s = scheduleExams(s, preset, { day: '2024-12-20' });
  for (const item of s.exams.items) {
    s = applyOutcome(s, { examId: item.id, value: item.kind === 'credit' ? 'зачёт' : '4', day: '2024-12-21' }, preset).state;
  }
  return s;
}

// --- учителя с душой -----------------------------------------------------------

test('запись преподавателя: должность, «любит», память поводами и тайна с оговоркой', () => {
  let s = semester();
  s.teachers[0] = { ...s.teachers[0], post: 'заведующая кафедрой', likes: 'белое вино и дорогие картины', secret: 'влюблена в Кассандру Палагею' };
  s = changeRelation(s, { teacherId: 'petrova', delta: -1, reason: { kind: 'skip', subjectId: 'chemistry' } }, preset).state;
  s = changeRelation(s, { teacherId: 'petrova', delta: 1 }, preset).state; // без повода — в память лорбука не идёт
  s = changeRelation(s, { teacherId: 'petrova', delta: 1, reason: { kind: 'marker', text: 'спасла опыт' } }, preset).state;

  const text = teacherEntry(s, 'petrova', preset).content;
  assert.match(text, /Должность: заведующая кафедрой\./);
  assert.match(text, /Любит: белое вино и дорогие картины\./);
  assert.match(text, /Помнит: спасла опыт; прогул: аналитическая химия\./, 'свежим вперёд, словами');
  assert.match(text,
    /Тайна \(героиня не знает; проявлять только намёками, прямо не раскрывать\): влюблена в Кассандру Палагею\.$/);
  assert.doesNotMatch(text.split('Помнит:')[1], /[+−-]\d/, 'в память лорбука числа не идут');
});

test('запись преподавателя без души — прежний текст, без пустых фраз и висящих точек', () => {
  const s = semester();
  const text = teacherEntry(s, 'ivanov', preset).content;
  assert.doesNotMatch(text, /Должность|Любит|Помнит|Тайна/);
  assert.doesNotMatch(text, /\.\s*\./);
  assert.ok(text.endsWith('.'));

  // Пустая строка и одни пробелы — то же, что нет поля.
  const blank = semester();
  blank.teachers[1] = { ...blank.teachers[1], post: '', likes: '   ' };
  assert.equal(teacherEntry(blank, 'ivanov', preset).content, text);
});

test('правленая руками запись преподавателя не затирается правкой души', () => {
  const s = semester();
  const first = buildLorebook(s, preset);
  const snapshot = apply([], first);
  const row = snapshot.find((x) => x.uid === 'academy:teacher:petrova');
  row.content = 'Моя Петрова.';

  const next = semester();
  next.teachers[0] = { ...next.teachers[0], secret: 'тайна' };
  next.teachers[1] = { ...next.teachers[1], secret: 'другая тайна' };
  const plan = buildLorebook(next, preset, { snapshot });
  assert.ok(plan.keep.some((k) => k.uid === 'academy:teacher:petrova' && k.reason === KEEP_EDITED));
  assert.ok(plan.update.some((e) => e.uid === 'academy:teacher:ivanov'), 'нетронутая — обновляется');
});

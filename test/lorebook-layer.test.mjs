import test from 'node:test';
import assert from 'node:assert/strict';

// Слой между планом ядра и живым World Info. Ядро проверяется своим тестом
// (`test/lorebook.test.mjs`), здесь — ровно то, что умеет только слой: чтение
// снимка из чужого формата записей, запись плана в этот формат, привязка к чату
// и поведение при выключенной галочке.
//
// `lorebook.js` — файл браузера, но зовёт он только `getContext()`-функции,
// поэтому прогоняется в Node без единой подмены глобалей.

const mod = await import('../lorebook.js');
const {
  METADATA_KEY, MARK, DEFAULT_LOREBOOK_SETTINGS, ENTRY_TEMPLATE,
  settingsOf, worldInfo, bookName, snapshotOf, freeUid, writeEntry, planSignature,
  syncLorebook, acceptSuggestion, pruneOrphans, fingerprint,
} = mod;

const { createState } = await import('../core/state.mjs');
const preset = JSON.parse(
  await (await import('node:fs/promises')).readFile(new URL('../presets/ru-university.json', import.meta.url), 'utf8'),
);

const TEACHERS = [
  { id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['злопамятна'] },
  { id: 'ivanov', name: 'Иванов Пётр Ильич', traits: ['добродушен'] },
];
const SUBJECTS = [
  { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'ivanov' },
];

function semester() {
  const state = createState(preset, { startDay: '2024-09-02', subjects: SUBJECTS, teachers: TEACHERS });
  state.started = true;
  return state;
}

/** Поддельная таверна ровно с теми функциями, что выведены в `st-context.js`. */
function tavern({ worlds = new Map(), chatId = 'chat-1', metadata = {} } = {}) {
  const t = {
    worlds,
    saves: [],
    chatMetadata: metadata,
    getCurrentChatId: () => chatId,
    async saveMetadata() { t.flushed = (t.flushed || 0) + 1; },
    saveMetadataDebounced() { t.debounced = (t.debounced || 0) + 1; },
    async loadWorldInfo(name) { return worlds.get(name) || null; },
    async saveWorldInfo(name, data, immediately) { worlds.set(name, data); t.saves.push({ name, immediately }); },
    async updateWorldInfoList() { t.listed = (t.listed || 0) + 1; },
    getWorldInfoNames: () => [...worlds.keys()],
  };
  return t;
}

const on = { lorebook: { enabled: true } };

// --- настройки ---------------------------------------------------------------

test('галочка по умолчанию выключена — это требование плана, а не умолчание кода', () => {
  assert.equal(DEFAULT_LOREBOOK_SETTINGS.enabled, false);
  assert.equal(settingsOf(undefined).enabled, false);
  assert.equal(settingsOf({}).enabled, false);
  assert.equal(settingsOf({ lorebook: {} }).enabled, false);
  // Только явное `true`: «1», «yes» и прочая правда по совместительству не в счёт.
  assert.equal(settingsOf({ lorebook: { enabled: 1 } }).enabled, false);
  assert.equal(settingsOf({ lorebook: { enabled: true } }).enabled, true);
});

// --- доступ к World Info -----------------------------------------------------

test('старая сборка без World Info в контексте — это null, а не исключение', () => {
  assert.equal(worldInfo(null), null);
  assert.equal(worldInfo({}), null);
  assert.equal(worldInfo({ loadWorldInfo: () => {} }), null, 'половины API мало');
  assert.ok(worldInfo(tavern()));
});

test('без updateWorldInfoList слой всё равно работает: обновляется только выпадашка', () => {
  const t = tavern();
  delete t.updateWorldInfoList;
  assert.equal(worldInfo(t).refresh, null);
});

// --- имя лорбука -------------------------------------------------------------

test('имя лорбука: привязанный к чату старше настройки и старше умолчания', () => {
  assert.equal(bookName(tavern({ metadata: { [METADATA_KEY]: 'Чужой лорбук' } }), { book: 'Мой' }), 'Чужой лорбук');
  assert.equal(bookName(tavern(), { book: 'Мой' }), 'Мой');
  assert.equal(bookName(tavern({ chatId: 'a/b:c' })), 'Академия — a_b_c');
});

test('без открытого чата имени нет — и лорбук не заводится', async () => {
  const t = tavern({ chatId: '' });
  assert.equal(bookName(t), '');
  const res = await syncLorebook(t, semester(), preset, { settings: on });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-chat');
  assert.equal(t.saves.length, 0);
});

// --- снимок ------------------------------------------------------------------

test('снимок собирается из живого World Info: наши записи по метке, чужие — по синтетическому uid', () => {
  const data = {
    entries: {
      0: { uid: 0, content: 'наша', [MARK]: { uid: 'academy:charter', fingerprint: 'abc' } },
      1: { uid: 1, content: 'чужая' },
    },
  };
  const { snapshot, index, marks } = snapshotOf(data);

  const ours = snapshot.find((s) => s.uid === 'academy:charter');
  assert.equal(ours.content, 'наша');
  assert.equal(ours.fingerprint, 'abc');
  assert.equal(index.get('academy:charter'), 0);
  assert.ok(marks.has('academy:charter'));

  // Чужая запись в снимке нужна: потолок числа записей меряет лорбук целиком.
  const foreign = snapshot.find((s) => s.uid === 'foreign:1');
  assert.ok(foreign, 'чужая запись обязана попасть в снимок');
  assert.equal(foreign.fingerprint, undefined, 'отпечатка у чужой записи нет и быть не может');
  assert.equal(marks.has('foreign:1'), false);
});

test('снимок переживает мусор в чужом лорбуке', () => {
  const { snapshot } = snapshotOf({ entries: { 0: null, 1: 'строка', 2: { uid: 2 } } });
  assert.equal(snapshot.length, 1);
  assert.equal(snapshot[0].content, '');
});

test('свободный uid — первый незанятый, как у getFreeWorldEntryUid', () => {
  assert.equal(freeUid({ entries: {} }), 0);
  assert.equal(freeUid({ entries: { 0: {}, 1: {}, 3: {} } }), 2);
});

// --- запись ------------------------------------------------------------------

test('запись плана ложится в формат World Info со всеми полями шаблона', () => {
  const data = { entries: {} };
  const entry = {
    uid: 'academy:teacher:petrova', keys: ['Петрова Анна Сергеевна', 'Петрова'],
    content: 'текст', constant: false, order: 50, origin: 'own', fingerprint: 'ff',
  };
  const at = writeEntry(data, entry);
  const wi = data.entries[at];

  assert.deepEqual(wi.key, entry.keys);
  assert.equal(wi.content, 'текст');
  assert.equal(wi.order, 50);
  assert.equal(wi.uid, 0);
  // Все поля шаблона на месте: иначе редактор таверны откроет запись с дырами.
  for (const k of Object.keys(ENTRY_TEMPLATE)) assert.ok(k in wi, `нет поля ${k}`);
  // Отпечаток — в своём поле, а не в `comment`: заголовок человек видит и правит.
  assert.equal(wi[MARK].uid, entry.uid);
  assert.equal(wi[MARK].fingerprint, 'ff');
  assert.equal(wi.comment.includes('ff'), false, 'служебному в заголовке не место');
  assert.ok(wi.comment.length > 0, 'пустой заголовок таверна однажды заполнит сама');
});

test('обновление записи не трогает того, что настроил человек', () => {
  const data = { entries: {} };
  const at = writeEntry(data, { uid: 'academy:charter', keys: [], content: 'было', constant: true, order: 100, fingerprint: 'a' });
  // Человек покрутил ручки записи: глубина, вероятность, группа.
  Object.assign(data.entries[at], { depth: 9, probability: 30, group: 'своя', disable: true });

  writeEntry(data, { uid: 'academy:charter', keys: [], content: 'стало', constant: true, order: 100, fingerprint: 'b' }, at);

  assert.equal(data.entries[at].content, 'стало');
  assert.equal(data.entries[at].depth, 9);
  assert.equal(data.entries[at].probability, 30);
  assert.equal(data.entries[at].group, 'своя');
  assert.equal(data.entries[at].disable, true);
  assert.equal(Object.keys(data.entries).length, 1, 'обновление — не вторая запись');
});

// --- сторож лишней работы ----------------------------------------------------

test('отпечаток плана считается без таверны и молчит на неначатом семестре', () => {
  assert.equal(planSignature(null, preset), '');
  const state = semester();
  const sig = planSignature(state, preset);
  assert.ok(sig.includes('academy:teacher:petrova'));
  assert.equal(planSignature(state, preset), sig, 'на том же состоянии — тот же');

  const changed = { ...state, teachers: [{ ...TEACHERS[0], traits: ['подобрела'] }, TEACHERS[1]] };
  assert.notEqual(planSignature(changed, preset), sig, 'изменившийся преподаватель обязан быть виден');
});

// --- синхронизация -----------------------------------------------------------

test('выключенная галочка: ни чтения, ни записи, ни привязки', async () => {
  const t = tavern();
  const res = await syncLorebook(t, semester(), preset, { settings: {} });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'off');
  assert.equal(t.saves.length, 0);
  assert.equal(t.chatMetadata[METADATA_KEY], undefined);
});

test('первый прогон заводит лорбук, привязывает к чату и сохраняет привязку немедленно', async () => {
  const t = tavern();
  const res = await syncLorebook(t, semester(), preset, { settings: on });

  assert.equal(res.ok, true);
  assert.equal(res.created, true);
  assert.equal(t.chatMetadata[METADATA_KEY], res.name);
  assert.ok(t.flushed > 0, 'привязка нужна таверне уже на ближайшей генерации');
  assert.equal(res.wrote, 1 + TEACHERS.length);
  assert.equal(res.orphans.length, 0);
  assert.ok(res.measure.withinCap);
});

test('уже привязанный лорбук чата не подменяется и не перезаписывается пустым', async () => {
  const worlds = new Map([['Чужой', { entries: { 0: { uid: 0, content: 'чужая запись' } } }]]);
  const t = tavern({ worlds, metadata: { [METADATA_KEY]: 'Чужой' } });

  const res = await syncLorebook(t, semester(), preset, { settings: on });

  assert.equal(res.name, 'Чужой');
  assert.equal(res.created, false);
  assert.equal(worlds.get('Чужой').entries[0].content, 'чужая запись', 'чужое остаётся нетронутым');
  assert.equal(Object.keys(worlds.get('Чужой').entries).length, 1 + 1 + TEACHERS.length);
});

test('лорбук с нужным именем уже лежит — привязываем, а не затираем', async () => {
  const worlds = new Map([['Academy chat-1', { entries: { 0: { uid: 0, content: 'из прошлой жизни' } } }]]);
  const t = tavern({ worlds });

  const res = await syncLorebook(t, semester(), preset, { settings: on });

  assert.equal(res.created, false, 'существующий файл заводить заново нельзя — это его уничтожит');
  assert.equal(worlds.get('Academy chat-1').entries[0].content, 'из прошлой жизни');
});

test('второй прогон без изменений: ни одного сохранения', async () => {
  const t = tavern();
  await syncLorebook(t, semester(), preset, { settings: on });
  const saves = t.saves.length;

  const res = await syncLorebook(t, semester(), preset, { settings: on });
  assert.equal(res.wrote, 0);
  assert.equal(t.saves.length, saves, 'лишняя запись на диск — это ещё и лишнее сохранение чата');
});

test('правленая руками запись не переписывается, соседняя — переписывается', async () => {
  const t = tavern();
  const state = semester();
  await syncLorebook(t, state, preset, { settings: on });
  const data = t.worlds.get(bookName(t));

  const mine = Object.values(data.entries).find((e) => e[MARK].uid === 'academy:teacher:petrova');
  mine.content = 'я переписала это сама';

  const changed = {
    ...state,
    teachers: state.teachers.map((x) => ({ ...x, traits: ['стал другим'] })),
  };
  const res = await syncLorebook(t, changed, preset, { settings: on });

  assert.equal(mine.content, 'я переписала это сама');
  const other = Object.values(data.entries).find((e) => e[MARK].uid === 'academy:teacher:ivanov');
  assert.ok(other.content.includes('стал другим'));
  assert.equal(res.wrote, 1, 'переписана ровно одна запись из двух');
});

test('предложения не пишутся никогда — только через решение человека', async () => {
  const t = tavern();
  const res = await syncLorebook(t, semester(), preset, {
    settings: on,
    npcs: [{ id: 'masha', name: 'Маша Лебедева', note: 'соседка' }],
    places: [{ id: 'canteen', name: 'столовая', note: 'шумно' }],
  });

  assert.equal(res.plan.suggest.length, 2);
  const data = t.worlds.get(res.name);
  const uids = Object.values(data.entries).map((e) => e[MARK].uid);
  assert.equal(uids.some((u) => u.includes('masha') || u.includes('canteen')), false);

  // Принятое человеком — попадает, и помечено как принятое, а не сочинённое.
  const accept = await acceptSuggestion(t, res.plan.suggest[0], { settings: on });
  assert.equal(accept.ok, true);
  const added = Object.values(data.entries).find((e) => e[MARK].uid === res.plan.suggest[0].uid);
  assert.equal(added[MARK].origin, 'suggested');

  // И второй раз то же самое уже не предлагается: оно лежит в лорбуке.
  const again = await syncLorebook(t, semester(), preset, {
    settings: on,
    npcs: [{ id: 'masha', name: 'Маша Лебедева', note: 'соседка' }],
    places: [{ id: 'canteen', name: 'столовая', note: 'шумно' }],
  });
  assert.equal(again.plan.suggest.length, 1);
});

test('принятое предложение осиротевшим не считается — иначе кнопка «убрать» его же и снесёт', async () => {
  const t = tavern();
  const state = semester();
  const first = await syncLorebook(t, state, preset, { settings: on, npcs: [{ id: 'masha', name: 'Маша Лебедева' }] });
  await acceptSuggestion(t, first.plan.suggest[0], { settings: on });

  const res = await syncLorebook(t, state, preset, { settings: on });
  assert.equal(res.orphans.length, 0, 'ядро эту запись не порождает — и не должно её потерять');
});

test('осиротевшее своё видно, чужое — нет', async () => {
  const t = tavern();
  const state = semester();
  await syncLorebook(t, state, preset, { settings: on });
  const data = t.worlds.get(bookName(t));
  data.entries[99] = { uid: 99, content: 'чужая запись из этого же лорбука' };

  // Преподаватель ушёл из состояния — запись про него ядро больше не порождает.
  const shrunk = { ...state, teachers: [state.teachers[0]], subjects: [state.subjects[0]] };
  const res = await syncLorebook(t, shrunk, preset, { settings: on });

  assert.deepEqual(res.orphans.map((o) => o.uid), ['academy:teacher:ivanov']);
});

test('осиротевшее сносится только по вызову и только если его не трогали руками', async () => {
  const t = tavern();
  const state = semester();
  await syncLorebook(t, state, preset, { settings: on });
  const data = t.worlds.get(bookName(t));
  const shrunk = { ...state, teachers: [state.teachers[0]], subjects: [state.subjects[0]] };
  await syncLorebook(t, shrunk, preset, { settings: on });

  const before = Object.keys(data.entries).length;
  const orphan = Object.values(data.entries).find((e) => e[MARK].uid === 'academy:teacher:ivanov');
  orphan.content = 'а тут я дописала своё';

  const kept = await pruneOrphans(t, [{ uid: 'academy:teacher:ivanov' }], { settings: on });
  assert.equal(kept.removed, 0, 'правленую руками не сносим даже осиротевшую');
  assert.equal(Object.keys(data.entries).length, before);

  // Вернули как было — тогда сносится.
  orphan.content = '';
  orphan[MARK].fingerprint = fingerprint('');
  const gone = await pruneOrphans(t, [{ uid: 'academy:teacher:ivanov' }], { settings: on });
  assert.equal(gone.removed, 1);
  assert.equal(Object.keys(data.entries).length, before - 1);
});

test('выключенная галочка запирает и принятие предложения, и уборку', async () => {
  const t = tavern();
  assert.equal((await acceptSuggestion(t, { uid: 'x', keys: [], content: 'y' }, { settings: {} })).reason, 'off');
  assert.equal((await pruneOrphans(t, [{ uid: 'x' }], { settings: {} })).reason, 'off');
  assert.equal(t.saves.length, 0);
});

test('неначатый семестр в лорбук не пишет: чужой чат не обрастает нашими записями', async () => {
  const t = tavern();
  const res = await syncLorebook(t, null, preset, { settings: on });
  assert.equal(res.reason, 'no-state');
  assert.equal(t.saves.length, 0);
});

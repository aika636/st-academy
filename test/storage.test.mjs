import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  KEY, DEFAULT_SETTINGS, migrationPlan, readState, mergeDefaults, deepAssign, resolveArgs,
  loadState, loadStateReport, saveState, flushState, clearState, loadSettings, saveSettings,
  apiSettings, stripSecrets, setContextProvider,
  EXPORT_FORMAT, EXPORT_FORMAT_VERSION, buildExport, exportFilename, exportState,
  readExport, importState, stateSummary,
  TURNS_KEY, TURNS_FORMAT, TURN_HISTORY, readTurns, loadTurns, saveTurns,
  readLedger, loadLedger, saveLedger,
} from '../storage.js';
import { SCHEMA_VERSION, createState } from '../core/state.mjs';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));

/** Поддельный контекст таверны: только те поля, которыми пользуется storage. */
function fakeContext(over = {}) {
  const calls = { debounced: 0, flushed: 0, settingsSaved: 0 };
  const ctx = {
    chatMetadata: over.chatMetadata !== undefined ? over.chatMetadata : {},
    extensionSettings: over.extensionSettings !== undefined ? over.extensionSettings : {},
    saveMetadataDebounced() { calls.debounced += 1; },
    async saveMetadata() { calls.flushed += 1; },
    saveSettingsDebounced() { calls.settingsSaved += 1; },
    calls,
  };
  return ctx;
}

const good = () => createState(preset, { startDay: '2024-09-02' });

test('analysis drafts and previous accepted analysis survive reload separately from saved tokens', () => {
  const ctx = fakeContext();
  const entry = { stamp: 'reply', tokens: ['rel=teacher:minor+'], summary: 'Saved',
    draft: { tokens: ['grade=math:5'], summary: 'Candidate', unparsed: ['sokolova'] },
    previousAnalysis: { tokens: null, summary: '' } };
  saveLedger(ctx, [entry]);
  const restored = loadLedger(fakeContext({ chatMetadata: JSON.parse(JSON.stringify(ctx.chatMetadata)) }))[0];
  assert.deepEqual(restored.tokens, entry.tokens);
  assert.deepEqual(restored.draft, entry.draft);
  assert.deepEqual(restored.previousAnalysis, entry.previousAnalysis);
  saveLedger(ctx, [{ ...restored, draft: null }]);
  assert.equal(loadLedger(ctx)[0].draft, null);
  assert.deepEqual(loadLedger(ctx)[0].tokens, entry.tokens);
  assert.equal(ctx.chatMetadata[KEY], undefined, 'draft persistence does not create or mutate Academy state');
});

test('invalid drafts are discarded and old ledger entries have no drafts', () => {
  const list = [
    { stamp: 'old' },
    { stamp: 'bad', draft: { tokens: 'grade=math:5' }, previousAnalysis: { tokens: 42 } },
    { stamp: 'filter', draft: { tokens: [null, '', 'grade=math:5', 42], summary: 1 } },
  ];
  const restored = readLedger({ v: 1, list });
  assert.equal(restored[0].draft, null);
  assert.equal(restored[1].draft, null);
  assert.equal(restored[1].previousAnalysis, null);
  assert.deepEqual(restored[2].draft, { tokens: ['grade=math:5'], summary: '', unparsed: [] });
  assert.deepEqual(restored[0].unparsed, [], '«не разобрано» у старой записи — пусто');
});

test('turn reload preserves accumulated teacher relations instead of preset defaults', () => {
  const ctx = fakeContext();
  const before = createState(preset, { startDay: '2024-09-02', teachers: [{ id: 'teacher', name: 'Teacher', relation: 4 }] });
  saveTurns(ctx, [{ mesId: 3, stamp: 'reply', before }]);
  const reloaded = loadTurns(fakeContext({ chatMetadata: JSON.parse(JSON.stringify(ctx.chatMetadata)) }), preset);
  assert.equal(reloaded[0].before.teachers[0].relation, 4);
});

// --- выбор ветки миграции ----------------------------------------------------

test('ветка миграции: пусто, битое, своя версия, старая версия, будущая версия', () => {
  assert.equal(migrationPlan(undefined).action, 'empty');
  assert.equal(migrationPlan(null).action, 'empty');
  assert.equal(migrationPlan('строка').action, 'invalid');
  assert.equal(migrationPlan([]).action, 'invalid');
  assert.deepEqual(migrationPlan({ schemaVersion: SCHEMA_VERSION }), { action: 'load', from: SCHEMA_VERSION });
  assert.deepEqual(migrationPlan({ schemaVersion: SCHEMA_VERSION + 1 }), { action: 'refuse', from: SCHEMA_VERSION + 1 });
  // Состояние без поля версии — из времён, когда его ещё не писали.
  assert.deepEqual(migrationPlan({ presetId: 'x' }), { action: 'migrate', from: 0 });
});

test('состояние из будущей схемы не грузится и не портится', () => {
  const future = { ...good(), schemaVersion: SCHEMA_VERSION + 3 };
  const report = readState(future, preset);
  assert.equal(report.status, 'future');
  assert.equal(report.state, null);
  assert.equal(report.from, SCHEMA_VERSION + 3);
  assert.ok(report.errors[0].includes(String(SCHEMA_VERSION + 3)));
  // Исходный объект не тронут — иначе откат на старую версию расширения стоил бы семестра.
  assert.equal(future.schemaVersion, SCHEMA_VERSION + 3);
});

test('старое состояние домигрируется и грузится', () => {
  const old = good();
  delete old.schemaVersion;
  delete old.pending;
  const report = readState(old, preset);
  assert.equal(report.status, 'migrated');
  assert.equal(report.state.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(report.state.pending, []);
});

test('целое состояние грузится как есть', () => {
  const report = readState(good(), preset);
  assert.equal(report.status, 'ok');
  assert.deepEqual(report.errors, []);
});

test('битое состояние — отчёт с претензиями, а не исключение', () => {
  const broken = { ...good(), calendar: { day: 'вчера', time: null, precision: 'date', termStart: 'никогда' } };
  const report = readState(broken, preset);
  assert.equal(report.status, 'invalid');
  assert.ok(report.errors.length > 0);
  // Показать человеку есть что: состояние отдаётся вместе с ошибками.
  assert.ok(report.state);
});

test('пустые метаданные — молчание, а не заведённый семестр', () => {
  assert.deepEqual(readState(undefined, preset), { status: 'empty', state: null, errors: [] });
});

// --- доливка умолчаний -------------------------------------------------------

test('умолчания доливаются по ключам, чужие ключи переживают', () => {
  const stored = { mode: 'marker', mine: 42, api: { key: 'sk-x' } };
  const out = mergeDefaults(DEFAULT_SETTINGS, stored);
  assert.equal(out, stored, 'объект настроек подменять нельзя — таверна держит ссылку');
  assert.equal(out.mode, 'marker', 'своё значение не затирается');
  assert.equal(out.mine, 42, 'чужой ключ на месте');
  assert.equal(out.api.key, 'sk-x');
  assert.equal(out.api.endpoint, '', 'недостающий вложенный ключ дописан');
  assert.equal(out.injectMarker, DEFAULT_SETTINGS.injectMarker);
  assert.equal(out.relativeWords, false, 'относительные сдвиги по умолчанию выключены');
  assert.deepEqual(out.ui, {}, 'блок панели заведён пустым: умолчаний у неё нет');
});

test('выброшенная настройка не возвращается и не роняет старые настройки', () => {
  // `ui.compact` объявлялся в умолчаниях и не читался нигде, кроме этого файла.
  // Поле убрано; проверяется обе стороны — что его больше не выдают за
  // умолчание и что сохранённые настройки с ним живут дальше как ни в чём не
  // бывало (чужой ключ переживает доливку, но своим уже не считается).
  assert.equal('compact' in DEFAULT_SETTINGS.ui, false);
  assert.equal(JSON.stringify(DEFAULT_SETTINGS).includes('compact'), false);

  const old = { mode: 'auto', ui: { compact: true, surveyDraft: { era: 'киберпанк' } } };
  const out = mergeDefaults(DEFAULT_SETTINGS, old);
  assert.equal(out.ui.compact, true, 'чужой ключ не стирается — своего в нём ничего нет');
  assert.deepEqual(out.ui.surveyDraft, { era: 'киберпанк' }, 'соседние ключи панели целы');

  const clean = mergeDefaults(DEFAULT_SETTINGS, {});
  assert.equal('compact' in clean.ui, false, 'обратно поле не тащится');
});

test('значение не того типа считается испорченным и заменяется умолчанием', () => {
  const out = mergeDefaults(DEFAULT_SETTINGS, { injectDepth: '3', debug: null, api: 'sk-x' });
  assert.equal(out.injectDepth, DEFAULT_SETTINGS.injectDepth);
  assert.equal(out.debug, false);
  assert.deepEqual(out.api, { source: 'auto', profile: '', endpoint: '', key: '', model: '' });
});

test('доливка идемпотентна', () => {
  const once = mergeDefaults(DEFAULT_SETTINGS, {});
  const twice = mergeDefaults(DEFAULT_SETTINGS, mergeDefaults(DEFAULT_SETTINGS, {}));
  assert.deepEqual(twice, once);
  assert.deepEqual(once, DEFAULT_SETTINGS);
});

test('deepAssign сливает вложенное, а не затирает объект целиком', () => {
  const live = { api: { endpoint: 'e', key: 'k', model: 'm' }, mode: 'auto' };
  deepAssign(live, { api: { model: 'm2' }, mode: 'marker' });
  assert.deepEqual(live, { api: { endpoint: 'e', key: 'k', model: 'm2' }, mode: 'marker' });
});

// --- аргументы ---------------------------------------------------------------

test('порядок аргументов терпит и (ctx, preset), и (preset)', () => {
  const ctx = fakeContext();
  assert.deepEqual(resolveArgs(ctx, preset), { ctx, preset });
  assert.deepEqual(resolveArgs(preset, undefined), { ctx: undefined, preset });
  assert.deepEqual(resolveArgs(preset, ctx), { ctx, preset });
});

// --- поход в «таверну» -------------------------------------------------------

test('saveState мутирует метаданные и зовёт дебаунс, loadState читает обратно', () => {
  const ctx = fakeContext();
  const state = good();
  saveState(ctx, state);
  assert.equal(ctx.calls.debounced, 1);
  assert.equal(ctx.chatMetadata[KEY].presetId, preset.id);
  assert.deepEqual(loadState(ctx, preset).calendar.day, '2024-09-02');
});

test('ключ API в метаданные чата не уезжает', () => {
  const ctx = fakeContext();
  saveState(ctx, { ...good(), api: { key: 'sk-secret' }, settings: { api: { key: 'sk-secret' } } });
  const dumped = JSON.stringify(ctx.chatMetadata);
  assert.equal(dumped.includes('sk-secret'), false, dumped);
  assert.equal(stripSecrets({ a: 1 }).a, 1);
});

test('ссылка на chatMetadata не кэшируется: смена чата видна сразу', () => {
  const ctx = fakeContext();
  saveState(ctx, good());
  // Таверна переприсваивает объект метаданных при смене чата.
  ctx.chatMetadata = {};
  assert.equal(loadState(ctx, preset), null);
});

test('loadState молчит на битом, а отчёт всё объясняет', () => {
  const ctx = fakeContext({
    chatMetadata: {
      [KEY]: {
        schemaVersion: SCHEMA_VERSION,
        presetId: 'x',
        calendar: { day: 'вчера', time: null, precision: 'date', termStart: 'никогда' },
      },
    },
  });
  assert.equal(loadState(ctx, preset), null);
  assert.equal(loadStateReport(ctx, preset).status, 'invalid');
});

test('flushState сохраняет немедленно, clearState забывает семестр', async () => {
  const ctx = fakeContext();
  await flushState(ctx, good());
  assert.equal(ctx.calls.flushed, 1);
  assert.ok(ctx.chatMetadata[KEY]);
  clearState(ctx);
  assert.equal(KEY in ctx.chatMetadata, false);
  assert.equal(ctx.calls.debounced, 1);
});

test('loadSettings заводит раздел, saveSettings патчит и дебаунсит', () => {
  const ctx = fakeContext({ extensionSettings: { other: { a: 1 } } });
  const s = loadSettings(ctx);
  assert.equal(ctx.extensionSettings[KEY], s, 'вернулся живой объект настроек');
  assert.deepEqual(ctx.extensionSettings.other, { a: 1 }, 'чужой раздел не тронут');
  saveSettings({ api: { model: 'glm-4' } }, ctx);
  assert.equal(ctx.calls.settingsSaved, 1);
  assert.equal(ctx.extensionSettings[KEY].api.model, 'glm-4');
  assert.equal(ctx.extensionSettings[KEY].api.endpoint, '');
  assert.deepEqual(apiSettings(ctx), { source: 'auto', profile: '', endpoint: '', key: '', model: 'glm-4' });
});

test('контекст берётся лениво, если аргументом не передан', () => {
  const ctx = fakeContext();
  setContextProvider(() => ctx);
  try {
    saveState(good());
    assert.ok(ctx.chatMetadata[KEY]);
    assert.equal(loadState(preset).presetId, preset.id);
    assert.equal(loadSettings().mode, 'auto');
  } finally {
    setContextProvider(null);
  }
});

test('без контекста — понятное исключение, а не TypeError', () => {
  setContextProvider(null);
  assert.throws(() => loadState(preset), /контекст SillyTavern недоступен/);
});

// --- выгрузка и загрузка (3.8) ----------------------------------------------

/** Состояние, в котором есть что терять: оценка, прогул, репутация, журнал. */
function lived() {
  const s = good();
  s.started = true;
  s.subjects = [{ id: 'chemistry', name: 'Химия', teacherId: 'petrova', grades: [{ value: '4', day: '2024-09-09' }], debt: false }];
  s.teachers = [{ id: 'petrova', name: 'Петрова Анна', traits: ['злопамятна'], relation: 40 }];
  s.schedule = { 1: ['chemistry'] };
  s.attendance.records = [{ day: '2024-09-09', subjectId: 'chemistry', status: 'skip', periodIndex: 0 }];
  s.journal = [{ day: '2024-09-09', kind: 'grade', text: 'Химия: 4' }];
  s.calendar.day = '2024-09-09';
  s.calendar.moved = 3;
  return s;
}

test('конверт выгрузки отвечает на четыре вопроса и несёт состояние целиком', () => {
  const env = buildExport(lived(), preset, { now: '2026-08-31T10:00:00.000Z', extensionVersion: '0.0.1' });
  assert.equal(env.format, EXPORT_FORMAT);
  assert.equal(env.formatVersion, EXPORT_FORMAT_VERSION);
  assert.equal(env.exportedAt, '2026-08-31T10:00:00.000Z');
  assert.equal(env.extensionVersion, '0.0.1');
  assert.equal(env.presetId, preset.id);
  assert.equal(env.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(env.state, lived());
  assert.equal(exportFilename(env), `academy-${preset.id}-2026-08-31.json`);
});

test('экспорт → импорт: круговой прогон без потерь', async () => {
  const from = fakeContext();
  const state = lived();
  saveState(from, state);

  const out = exportState(from, preset, { now: '2026-08-31T10:00:00.000Z' });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.deepEqual(out.warnings, []);

  // Через настоящую сериализацию: файл — это текст, а не объект в памяти.
  const to = fakeContext();
  const res = await importState(to, out.json, preset);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.replaced, false);
  assert.equal(to.calls.flushed, 1, 'импорт пишет немедленно, а не дебаунсом');
  // Сравнение читаемого с читаемым: доливка умолчаний одна и та же с обеих сторон.
  assert.deepEqual(loadState(to, preset), loadState(from, preset));
  assert.deepEqual(loadState(to, preset).subjects[0].grades, [{ value: '4', day: '2024-09-09' }]);
  assert.equal(loadState(to, preset).attendance.records.length, 1);
  assert.equal(loadState(to, preset).calendar.moved, 3);
});

test('ключа API нет в выгрузке ни при каких условиях', () => {
  const ctx = fakeContext({ extensionSettings: { academy: { api: { key: 'sk-secret' } } } });
  // Состояние, в которое кто-то в панели положил настройки с ключом.
  saveState(ctx, { ...lived(), api: { key: 'sk-secret' }, settings: { api: { key: 'sk-secret' } } });
  const out = exportState(ctx, preset);
  assert.equal(out.ok, true);
  assert.equal(out.json.includes('sk-secret'), false, out.json);
  assert.equal(JSON.stringify(buildExport({ ...lived(), api: { key: 'sk-secret' } }, preset)).includes('sk-secret'), false);
});

test('выгрузка отказывает на пустом чате и на состоянии из будущей схемы', () => {
  assert.equal(exportState(fakeContext(), preset).code, 'empty');

  const ctx = fakeContext({ chatMetadata: { [KEY]: { ...good(), schemaVersion: SCHEMA_VERSION + 1 } } });
  const out = exportState(ctx, preset);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'future');
  assert.ok(out.message.includes(String(SCHEMA_VERSION + 1)));
  // Состояние в чате не тронуто — то же правило, что и при загрузке.
  assert.equal(ctx.chatMetadata[KEY].schemaVersion, SCHEMA_VERSION + 1);
});

test('битое состояние всё-таки выгружается, но с претензиями', () => {
  const ctx = fakeContext({
    chatMetadata: {
      [KEY]: { ...good(), calendar: { day: 'вчера', time: null, precision: 'date', termStart: 'никогда' } },
    },
  });
  const out = exportState(ctx, preset);
  assert.equal(out.ok, true, 'унести семестр до починки — законное желание');
  assert.ok(out.warnings.length > 0);
});

test('импорт: каждый отказ говорит своё', () => {
  const cases = [
    ['не JSON', 'просто текст', 'not-json'],
    ['пустой файл', '   ', 'not-json'],
    ['JSON не той формы', '[1,2,3]', 'not-object'],
    ['чужая выгрузка', JSON.stringify({ format: 'lorebook', entries: [] }), 'foreign'],
    ['JSON без опознавательных знаков', JSON.stringify({ a: 1 }), 'foreign'],
    ['конверт без состояния', JSON.stringify({ format: EXPORT_FORMAT, formatVersion: 1 }), 'no-state'],
    ['формат из будущего', JSON.stringify({ format: EXPORT_FORMAT, formatVersion: EXPORT_FORMAT_VERSION + 1, state: good() }), 'format-future'],
    ['схема из будущего', JSON.stringify(buildExport({ ...good(), schemaVersion: SCHEMA_VERSION + 2 }, preset)), 'future'],
    ['битое состояние', JSON.stringify(buildExport({ ...good(), calendar: { day: 'вчера', time: null, precision: 'date', termStart: 'никогда' } }, preset)), 'invalid'],
  ];
  const seen = new Set();
  for (const [name, text, code] of cases) {
    const res = readExport(text, preset);
    assert.equal(res.ok, false, name);
    assert.equal(res.code, code, name);
    assert.ok(res.message.length > 20, `${name}: текст отказа должен объяснять, а не называться`);
    seen.add(res.message);
  }
  assert.equal(seen.size, cases.length, 'разные случаи — разные тексты, а не одно «ошибка»');
});

test('импорт поднимает состояние прошлой схемы и говорит об этом', async () => {
  const old = good();
  delete old.schemaVersion;
  delete old.pending;
  const env = { format: EXPORT_FORMAT, formatVersion: 1, presetId: preset.id, state: old };

  const parsed = readExport(JSON.stringify(env), preset);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.equal(parsed.status, 'migrated');
  assert.equal(parsed.state.schemaVersion, SCHEMA_VERSION);
  assert.ok(parsed.warnings.some((w) => w.includes('поднято')));

  const ctx = fakeContext();
  const res = await importState(ctx, env, preset);
  assert.equal(res.ok, true);
  assert.equal(ctx.chatMetadata[KEY].schemaVersion, SCHEMA_VERSION);
});

test('голое состояние без конверта грузится, но с оговоркой', () => {
  const parsed = readExport(JSON.stringify(lived()), preset);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.ok(parsed.warnings.some((w) => w.includes('без конверта')));
});

test('readExport ничего не пишет: контекст ему не нужен вовсе', () => {
  setContextProvider(null);
  const parsed = readExport(JSON.stringify(buildExport(lived(), preset)), preset);
  assert.equal(parsed.ok, true, 'разбор обязан работать без таверны — это половина контракта');
});

test('импорт не затирает идущий семестр молча', async () => {
  const ctx = fakeContext();
  saveState(ctx, lived());
  const incoming = buildExport({ ...good(), calendar: { ...good().calendar, day: '2025-01-10' } }, preset);

  const stop = await importState(ctx, incoming, preset);
  assert.equal(stop.ok, false);
  assert.equal(stop.code, 'needs-confirm');
  assert.equal(stop.needsConfirm, true);
  assert.ok(stop.reasons[0].includes('семестр'));
  // Панели есть что показать: что было и что приедет.
  assert.equal(stop.current.day, '2024-09-09');
  assert.equal(stop.incoming.day, '2025-01-10');
  assert.equal(ctx.chatMetadata[KEY].calendar.day, '2024-09-09', 'до подтверждения ничего не записано');
  assert.equal(ctx.calls.flushed, 0);

  const go = await importState(ctx, incoming, preset, { confirm: true });
  assert.equal(go.ok, true);
  assert.equal(go.replaced, true);
  assert.equal(ctx.chatMetadata[KEY].calendar.day, '2025-01-10');
});

test('состояние чужого пресета: не отказ, но предупреждение и подтверждение', async () => {
  const alien = { ...lived(), presetId: 'jp-highschool' };
  const parsed = readExport(JSON.stringify(buildExport(alien, preset)), preset);
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.equal(parsed.presetMatches, false);
  const note = parsed.warnings.find((w) => w.includes('jp-highschool'));
  assert.ok(note, JSON.stringify(parsed.warnings));
  assert.ok(note.includes(preset.id), 'сказано, чем именно оно разъехалось');
  assert.ok(/шкала оценок|виды контрольных/.test(note), 'сказано, что именно возьмётся из активного пресета');

  // Даже в пустом чате чужой пресет требует подтверждения: терять нечего, но
  // человек должен понимать, что предметы приедут, а слова будут другие.
  const ctx = fakeContext();
  const stop = await importState(ctx, buildExport(alien, preset), preset);
  assert.equal(stop.code, 'needs-confirm');
  const go = await importState(ctx, buildExport(alien, preset), preset, { confirm: true });
  assert.equal(go.ok, true);
  assert.equal(ctx.chatMetadata[KEY].presetId, 'jp-highschool', 'чужой presetId не переписывается тихо');
});

test('сводка состояния — то, чего хватает на вопрос «заменить?»', () => {
  const s = stateSummary(lived());
  assert.equal(s.presetId, preset.id);
  assert.equal(s.day, '2024-09-09');
  assert.equal(s.started, true);
  assert.equal(s.subjects, 1);
  assert.equal(s.teachers, 1);
  assert.equal(s.grades, 1);
  assert.equal(stateSummary(null), null);
});

// --- лексика предупреждений: она принадлежит пресету, а не коду ---------------
//
// Живая находка: панель строкой выше писала «дисциплин 7», а предупреждение
// рядом — «7 предметов», потому что фраза была зашита в `storage.js` словами
// русского вуза. Проверка идёт по всем трём пресетам сразу и ловит не только
// исходный случай, но и обратный — слово магической академии у русского вуза.

const ALL_PRESETS = ['ru-university', 'jp-highschool', 'magic-academy'].map((id) => JSON.parse(
  readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'),
));

/** Свои слова каждого пресета — и слова, которых у него быть не может. */
const WORDS = {
  'ru-university': { own: [/семестр/, /предмет/, /преподавател/], alien: /круг|дисциплин|наставник|триместр|учител[ья]/i },
  'jp-highschool': { own: [/триместр/, /предмет/, /учител/], alien: /круг|дисциплин|наставник|семестр|преподавател/i },
  'magic-academy': { own: [/круг/, /дисциплин/, /наставник/], alien: /семестр|предмет|преподавател|триместр|учител[ья]/i },
};

function livedWith(p) {
  const s = createState(p, { startDay: '2024-09-02' });
  s.started = true;
  s.subjects = [{ id: 'chemistry', name: 'Химия', teacherId: 'petrova', grades: [], debt: false }];
  s.teachers = [{ id: 'petrova', name: 'Петрова Анна', traits: [], relation: 40 }];
  s.schedule = { 1: ['chemistry'] };
  return s;
}

for (const p of ALL_PRESETS) {
  test(`пресет ${p.id}: вопрос перед заменой состояния говорит его словами`, async () => {
    const ctx = fakeContext();
    saveState(ctx, livedWith(p));

    // Приезжает состояние чужого пресета: так в одном ответе оказываются обе
    // фразы — и «в этом чате уже идёт …», и объяснение про чужой пресет.
    const incoming = buildExport({ ...createState(p, { startDay: '2025-01-10' }), presetId: 'hogwarts' }, p);
    const stop = await importState(ctx, incoming, p);

    assert.equal(stop.code, 'needs-confirm', JSON.stringify(stop));
    const text = stop.message;
    for (const own of WORDS[p.id].own) {
      assert.match(text, own, `пресет ${p.id} обязан говорить своим словом: ${text}`);
    }
    assert.equal(WORDS[p.id].alien.test(text), false,
      `в ${p.id} протекло слово чужого заведения: ${text}`);
    assert.match(text, /день 2024-09-02/, 'число предметов и день по-прежнему на месте');
  });

  test(`пресет ${p.id}: замена неначатого состояния тоже названа его словами`, async () => {
    const ctx = fakeContext();
    saveState(ctx, createState(p, { startDay: '2024-09-02' })); // started === false
    const stop = await importState(ctx, buildExport(createState(p, { startDay: '2025-01-10' }), p), p);

    assert.equal(stop.code, 'needs-confirm');
    assert.equal(WORDS[p.id].alien.test(stop.message), false,
      `в ${p.id} протекло слово чужого заведения: ${stop.message}`);
  });
}

// --- история ходов (ремонт 9.1.1) --------------------------------------------

const turn = (mesId, over = {}) => ({
  mesId, stamp: `s${mesId}`, before: good(), oneShotBefore: '', oneShot: '', ...over,
});

test('история ходов: пишется рядом с состоянием, режется по длине, без ключа API', () => {
  const ctx = fakeContext();
  saveState(ctx, good());
  const list = [];
  for (let i = 0; i < TURN_HISTORY + 3; i += 1) list.push(turn(i));
  list[list.length - 1].before = { ...good(), api: { key: 'sk-снимок' } };
  saveTurns(ctx, list);

  const raw = ctx.chatMetadata[TURNS_KEY];
  assert.equal(raw.v, TURNS_FORMAT);
  assert.equal(raw.list.length, TURN_HISTORY, 'история не растёт без края');
  assert.deepEqual(raw.list.map((t) => t.mesId), list.slice(-TURN_HISTORY).map((t) => t.mesId), 'помнятся последние');
  assert.equal(JSON.stringify(ctx.chatMetadata).includes('sk-снимок'), false, 'снимок — такое же состояние: без ключа');
  assert.equal(ctx.chatMetadata[KEY].schemaVersion, SCHEMA_VERSION, 'состояние лежит отдельно и не тронуто');

  const back = loadTurns(ctx, preset);
  assert.equal(back.length, TURN_HISTORY);
  assert.equal(back[0].before.presetId, preset.id);
});

test('история ходов: мусор и чужой формат не читаются, старый снимок поднимается миграцией', () => {
  assert.deepEqual(readTurns(undefined, preset), []);
  assert.deepEqual(readTurns({ v: TURNS_FORMAT + 1, list: [turn(1)] }, preset), [], 'история из будущей версии — начать новую');
  assert.deepEqual(readTurns({ v: TURNS_FORMAT, list: 'не список' }, preset), []);

  const old = good();
  delete old.schemaVersion;
  const read = readTurns({
    v: TURNS_FORMAT,
    list: [
      turn(1, { before: old }),
      turn(2, { before: 'не состояние' }),
      turn(-1),
      null,
      turn(4, { stamp: null }),
    ],
  }, preset);
  assert.deepEqual(read.map((t) => t.mesId), [1, 4], 'битый снимок — ход без снимка, он просто забыт');
  assert.equal(read[0].before.schemaVersion, SCHEMA_VERSION, 'снимок старой схемы поднят тем же migrate');
  assert.equal(read[1].stamp, null, 'откаченный ход остаётся откаченным');
});

test('история ходов: выпуски молвы переживают запись и чтение, мусор в них выбрасывается', () => {
  const ctx = fakeContext();
  saveState(ctx, good());
  const item = { id: 'molva-1-x#1', src: 'molva-1-x', kind: 'reaction', nick: 'всё-видел', text: 'Слышали про бал?', chan: 'chat' };
  const delta = { stamp: 's1', items: [item, { id: '', text: '' }], threads: [], molva: { issue: 1, since: 0, facts: ['f1'], at: { day: '2026-10-08', time: '' } } };
  saveTurns(ctx, [turn(1, { molva: [delta, 'мусор', null] }), turn(2)]);
  const back = loadTurns(ctx, preset);
  assert.equal(back[0].molva.length, 1);
  assert.equal(back[0].molva[0].stamp, 's1');
  assert.deepEqual(back[0].molva[0].items.map((x) => x.id), ['molva-1-x#1'], 'битая запись выброшена');
  assert.equal(back[0].molva[0].molva.issue, 1);
  assert.deepEqual(back[1].molva, [], 'у хода без выпусков — пусто');
});

test('clearState и загрузка забывают историю ходов', async () => {
  const ctx = fakeContext();
  saveState(ctx, good());
  saveTurns(ctx, [turn(3)]);
  clearState(ctx);
  assert.equal(ctx.chatMetadata[TURNS_KEY], undefined);

  saveState(ctx, good());
  saveTurns(ctx, [turn(3)]);
  const res = await importState(ctx, buildExport(good(), preset), preset, { confirm: true });
  assert.equal(res.ok, true);
  assert.equal(ctx.chatMetadata[TURNS_KEY], undefined, 'снимок до загрузки откатил бы свайп в заменённый семестр');
});

// test/preset-flow — переносимые пресеты в проводке `index.js` (план 9.3.2).
//
// Ядро проверки (`core/preset.mjs`) покрыто `test/preset.test.mjs`. Здесь —
// то, что видно только исполнением `index.js` над поддельной таверной: пресет
// ложится в `extension_settings`, выпадашка его видит, «добавить и применить»
// проходит через те же вопросы, что ручная смена, а удалённый пресет, на
// который ссылается чат, откатывается на встроенный С СООБЩЕНИЕМ — и в
// всплывашке, и строкой в панели.
//
// Попутно — два хвоста шага 3: `via` списка моделей доезжает до панели, а
// `/academy-debug` печатает новые виды отладки словами, а не сырыми именами.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { PRESET_FORMAT, USER_PRESETS_MAX, presetEnvelope } from '../core/preset.mjs';
import { settingsView, PRESET_TEXT, describeApplied } from '../ui.js';

const presetPath = (id) => fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url));
const loadPresetFile = (id) => JSON.parse(readFileSync(presetPath(id), 'utf8'));
const manifestPath = fileURLToPath(new URL('../manifest.json', import.meta.url));
const ru = loadPresetFile('ru-university');
const jp = loadPresetFile('jp-highschool');

const SUBJECTS = [
  { id: 'chemistry', name: 'химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'ivanov' },
];
const TEACHERS = [
  { id: 'petrova', name: 'Петрова Анна', traits: ['строгая'] },
  { id: 'ivanov', name: 'Иванов Пётр', traits: ['добрый'] },
];

// --- поддельная таверна (те же имена полей, что в `test/integration`) ----------

function fakeTavern() {
  const listeners = new Map();
  const tavern = {
    chat: [],
    chatMetadata: {},
    extensionSettings: {},
    powerUserSettings: {},
    extension_prompt_types: { NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 },
    extension_prompt_roles: { SYSTEM: 0, USER: 1, ASSISTANT: 2 },
    event_types: {
      MESSAGE_RECEIVED: 'message_received',
      MESSAGE_SWIPED: 'message_swiped',
      MESSAGE_EDITED: 'message_edited',
      MESSAGE_UPDATED: 'message_updated',
      MESSAGE_DELETED: 'message_deleted',
      CHAT_CHANGED: 'chat_id_changed',
    },
    eventSource: {
      on(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
      async emit(name, ...args) { for (const fn of listeners.get(name) || []) await fn(...args); },
    },
    setExtensionPrompt() {},
    saveMetadataDebounced() {},
    async saveMetadata() {},
    saveSettingsDebounced() { tavern.settingsSaves += 1; },
    getCurrentChatId: () => tavern.chatId,
    chatId: 'chat-1',
    settingsSaves: 0,
  };
  return tavern;
}

/** Всплывашки таверны: сообщение об откате обязано дойти до человека. */
function watchToasts() {
  const seen = [];
  globalThis.toastr = {
    warning: (text) => seen.push(['warning', text]),
    info: (text) => seen.push(['info', text]),
    success: (text) => seen.push(['success', text]),
    error: (text) => seen.push(['error', text]),
  };
  return seen;
}

async function boot(tavern, { fetchExtra } = {}) {
  globalThis.SillyTavern = { getContext: () => tavern };
  globalThis.fetch = async (url, init) => {
    const s = String(url);
    if (fetchExtra) {
      const r = await fetchExtra(s, init);
      if (r) return r;
    }
    const m = /\/presets\/([\w-]+)\.json$/.exec(s);
    if (m) {
      try {
        const data = loadPresetFile(m[1]);
        return { ok: true, status: 200, json: async () => data };
      } catch {
        return { ok: false, status: 404, json: async () => ({}) };
      }
    }
    if (s.endsWith('/manifest.json')) {
      return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(manifestPath, 'utf8')) };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  const mod = await import(`../index.js?run=${Math.random()}`);
  await mod.__seam.ready;
  return mod.__seam;
}

/** Идущий семестр под пресетом `preset` прямо в метаданных. */
async function semester(tavern, preset = ru) {
  const { createState } = await import('../core/state.mjs');
  const { buildSchedule } = await import('../core/schedule.mjs');
  const state = createState(preset, {
    startDay: '2024-09-02', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
  });
  state.started = true;
  return state;
}

/** Файл пресета «как его выгрузила бы соседка»: свой вуз на русской основе. */
function friendFile(patch = {}) {
  const preset = { ...structuredClone(ru), id: 'friend-uni', displayName: 'Вуз подруги', ...patch };
  preset.vocab = { ...preset.vocab, term: 'триместр' };
  return JSON.stringify(presetEnvelope(preset));
}

const settings = (tavern) => tavern.extensionSettings.academy;

// --- загрузка ------------------------------------------------------------------------

test('превью ничего не пишет и показывает заведение одной строкой', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  const res = await seam.host.actions.previewPreset(friendFile());
  assert.equal(res.ok, true, res.error);
  assert.equal(res.summary.name, 'Вуз подруги');
  assert.equal(res.summary.id, 'friend-uni');
  assert.equal(res.summary.line, 'триместр · пары в день: 4 · 2–5 · хвост после 3 прогулов');
  assert.equal(res.renamed, false);
  assert.deepEqual(settings(tavern).presets, {}, 'превью не добавляет');
});

test('«добавить»: пресет ложится в extension_settings.academy.presets и виден в выпадашке', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  const res = await seam.host.actions.importPreset(friendFile());
  assert.equal(res.ok, true, res.error);
  assert.equal(res.added, 'friend-uni');

  const stored = settings(tavern).presets['friend-uni'];
  assert.ok(stored, 'пресета нет в настройках');
  assert.equal(stored.source, 'user');
  assert.equal(stored.basedOn, 'ru-university');
  assert.ok(tavern.settingsSaves > 0, 'настройки не сохранены');

  const list = seam.host.getPresets().list;
  const item = list.find((p) => p.id === 'friend-uni');
  assert.deepEqual({ name: item.name, user: item.user }, { name: 'Вуз подруги', user: true });
  assert.equal(seam.host.getPresets().active, 'ru-university', '«добавить» не включает');
});

test('коллизия: встроенный, загруженный обратно, ложится рядом под новым id и именем', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  const exported = await seam.host.actions.exportPreset('ru-university');
  assert.equal(exported.ok, true);
  assert.equal(exported.filename, 'academy-preset-ru-university.json');
  assert.equal(JSON.parse(exported.json).format, PRESET_FORMAT);

  const preview = await seam.host.actions.previewPreset(exported.json);
  assert.equal(preview.renamed, true);
  assert.equal(preview.summary.id, 'ru-university-2');

  const res = await seam.host.actions.importPreset(exported.json);
  assert.equal(res.added, 'ru-university-2');
  assert.equal(res.name, 'Российский вуз (2)');
  // Встроенный не тронут: он файл, а не запись в настройках.
  assert.equal('ru-university' in settings(tavern).presets, false);

  // И второй раз — ещё один хвост, а не замена первого.
  const again = await seam.host.actions.importPreset(exported.json);
  assert.equal(again.added, 'ru-university-3');
});

test('«добавить и применить» без семестра: пресет сразу активен', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  const res = await seam.host.actions.importPreset(friendFile(), { apply: true });
  assert.equal(res.ok, true, res.error);
  assert.equal(seam.host.getPreset().id, 'friend-uni');
  assert.equal(seam.host.getPreset().vocab.term, 'триместр');
  assert.equal(settings(tavern).preset, 'friend-uni');
});

test('«добавить и применить» на идущем семестре спрашивает, как ручная смена', async () => {
  const tavern = fakeTavern();
  tavern.chatMetadata.academy = await semester(tavern);
  const seam = await boot(tavern);
  const res = await seam.host.actions.importPreset(friendFile(), { apply: true });
  assert.equal(res.needsConfirm, true);
  assert.equal(res.added, 'friend-uni', 'пресет уже добавлен — вопрос только про смену');
  assert.equal(seam.host.getPreset().id, 'ru-university');

  const yes = await seam.host.actions.setPreset('friend-uni', { confirm: true });
  assert.equal(yes.ok, true, yes.error);
  assert.equal(tavern.chatMetadata.academy.presetId, 'friend-uni');
});

test('своих пресетов не больше потолка', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  for (let i = 0; i < USER_PRESETS_MAX; i += 1) {
    const r = await seam.host.actions.importPreset(friendFile({ id: `p${i}`, displayName: `П${i}` }));
    assert.equal(r.ok, true, r.error);
  }
  const over = await seam.host.actions.importPreset(friendFile({ id: 'one-more' }));
  assert.equal(over.ok, false);
  assert.equal(over.code, 'full');
  const preview = await seam.host.actions.previewPreset(friendFile({ id: 'one-more' }));
  assert.equal(preview.full, true, 'превью предупреждает заранее');
});

test('битый файл: отказ словами со списком причин, в настройках пусто', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  const bad = friendFile({ week: { studyDays: [9], periodsPerDay: 0 } });
  const res = await seam.host.actions.importPreset(bad);
  assert.equal(res.ok, false);
  assert.ok(res.errors.length >= 2, res.errors.join(' | '));
  assert.match(res.error, /Пресет не принят/);
  assert.deepEqual(settings(tavern).presets, {});

  const huge = await seam.host.actions.previewPreset(`{"x":"${'a'.repeat(1024 * 1024)}"}`);
  assert.equal(huge.code, 'too-big');
});

test('выгрузка своего пресета — самодостаточный файл, который загружается обратно', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  await seam.host.actions.importPreset(friendFile());
  const out = await seam.host.actions.exportPreset('friend-uni');
  assert.equal(out.ok, true);
  const env = JSON.parse(out.json);
  assert.equal(env.basedOn, 'ru-university');
  assert.equal(env.preset.id, 'friend-uni');
  assert.equal('source' in env.preset, false);
  assert.ok(env.preset.ui && env.preset.grades, 'в файле весь пресет, а не только отличия');
});

// --- удаление и откат ---------------------------------------------------------------

test('встроенный не удаляется', async () => {
  const seam = await boot(fakeTavern());
  const res = await seam.host.actions.deletePreset('ru-university');
  assert.equal(res.ok, false);
  assert.equal(res.code, 'builtin');
});

test('удаление неактивного своего пресета — без вопросов и без смены', async () => {
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  await seam.host.actions.importPreset(friendFile());
  const res = await seam.host.actions.deletePreset('friend-uni');
  assert.equal(res.ok, true);
  assert.equal('friend-uni' in settings(tavern).presets, false);
  assert.equal(seam.host.getPresets().list.some((p) => p.id === 'friend-uni'), false);
  assert.equal(seam.host.getPreset().id, 'ru-university');
});

test('удаление активного на идущем семестре: вопрос, потом откат на основу с сообщением', async () => {
  const toasts = watchToasts();
  const tavern = fakeTavern();
  tavern.chatMetadata.academy = await semester(tavern, jp);
  tavern.extensionSettings.academy = { preset: 'jp-highschool' };
  const seam = await boot(tavern);

  // Своя школа на японской основе, включена в этом чате.
  const mineFile = JSON.stringify(presetEnvelope({ ...structuredClone(jp), id: 'my-school', displayName: 'Моя школа', basedOn: 'jp-highschool' }));
  const added = await seam.host.actions.importPreset(mineFile, { apply: true, confirm: true });
  assert.equal(added.ok, true, added.error);
  assert.equal(seam.host.getPreset().id, 'my-school');
  assert.equal(tavern.chatMetadata.academy.presetId, 'my-school');

  const ask = await seam.host.actions.deletePreset('my-school');
  assert.equal(ask.needsConfirm, true);
  assert.match(ask.error, /Моя школа/);
  assert.match(ask.error, /встроенный/);
  assert.ok('my-school' in settings(tavern).presets, 'без подтверждения ничего не удалено');

  const res = await seam.host.actions.deletePreset('my-school', { confirm: true });
  assert.equal(res.ok, true, res.error);
  assert.equal(res.fallback, 'jp-highschool', 'откат — на основу своего пресета');
  assert.equal(seam.host.getPreset().id, 'jp-highschool');
  assert.equal(settings(tavern).preset, 'jp-highschool');
  assert.equal(tavern.chatMetadata.academy.presetId, 'jp-highschool');

  const notice = seam.host.getPresets().notice;
  assert.match(notice, /Моя школа/);
  assert.match(notice, /удалён/);
  assert.ok(toasts.some(([, t]) => t === notice), 'сообщение не дошло всплывашкой');
  delete globalThis.toastr;
});

test('запуск: выбранный свой пресет исчез из настроек — встроенный и сообщение', async () => {
  const toasts = watchToasts();
  const tavern = fakeTavern();
  tavern.extensionSettings.academy = { preset: 'gone-uni', presets: {} };
  const seam = await boot(tavern);
  assert.equal(seam.host.getPreset().id, 'ru-university');
  assert.equal(settings(tavern).preset, 'ru-university');
  const notice = seam.host.getPresets().notice;
  assert.match(notice, /gone-uni/);
  assert.match(notice, /больше не найден/);
  assert.ok(toasts.some(([kind, t]) => kind === 'warning' && t === notice));
  delete globalThis.toastr;
});

test('запуск: свой пресет в настройках испорчен руками — откат на ЕГО основу с причиной', async () => {
  const tavern = fakeTavern();
  const broken = { ...structuredClone(jp), id: 'mine', displayName: 'Моя', basedOn: 'jp-highschool', week: { studyDays: [], periodsPerDay: 0 } };
  tavern.extensionSettings.academy = { preset: 'mine', presets: { mine: broken } };
  const seam = await boot(tavern);
  assert.equal(seam.host.getPreset().id, 'jp-highschool');
  assert.match(seam.host.getPresets().notice, /не прошёл проверку/);
  // Сам пресет не выброшен: человек может его выгрузить и починить.
  assert.ok(settings(tavern).presets.mine);
});

test('свой пресет из настроек нормализуется при каждой загрузке: {{макрос}} руками не протащить', async () => {
  const tavern = fakeTavern();
  const own = { ...structuredClone(ru), id: 'mine', displayName: 'Моя', basedOn: 'ru-university' };
  own.vocab = { ...own.vocab, term: '{{random::a,b}}' };
  tavern.extensionSettings.academy = { preset: 'mine', presets: { mine: own } };
  const seam = await boot(tavern);
  assert.equal(seam.host.getPreset().id, 'mine');
  assert.ok(!seam.host.getPreset().vocab.term.includes('{{'));
});

test('чат заведён удалённым пресетом: всплывашка при открытии и строка в панели', async () => {
  const toasts = watchToasts();
  const tavern = fakeTavern();
  const seam = await boot(tavern);
  // Другой чат: семестр заведён пресетом, которого больше нет.
  const state = await semester(tavern);
  state.presetId = 'deleted-uni';
  tavern.chatMetadata = { academy: state };
  tavern.chatId = 'chat-2';
  await tavern.eventSource.emit('chat_id_changed');

  assert.ok(toasts.some(([, t]) => /deleted-uni/.test(t) && /больше нет/.test(t)), JSON.stringify(toasts));
  const view = settingsView(seam.host.getState(), {}, seam.host.getPreset(), { presets: seam.host.getPresets() });
  assert.match(view.presets.gone, /deleted-uni/);
  assert.match(view.presets.gone, /Российский вуз/);
  // Состояние не переписано: пресет могут загрузить обратно тем же файлом.
  assert.equal(tavern.chatMetadata.academy.presetId, 'deleted-uni');

  // Загрузили обратно — строка пропала.
  await seam.host.actions.importPreset(friendFile({ id: 'deleted-uni' }));
  const after = settingsView(seam.host.getState(), {}, seam.host.getPreset(), { presets: seam.host.getPresets() });
  assert.equal(after.presets.gone, '');
  delete globalThis.toastr;
});

test('строка «пресета нет» не появляется от запасного списка без хоста', () => {
  const view = settingsView({ presetId: 'jp-highschool', started: true, subjects: [], teachers: [] }, {}, ru, {});
  assert.equal(view.presets.gone, '');
});

// --- хвосты шага 3 ---------------------------------------------------------------------

test('список моделей через сервер таверны: via доезжает до панели', async () => {
  const tavern = fakeTavern();
  tavern.getRequestHeaders = () => ({ 'Content-Type': 'application/json' });
  tavern.extensionSettings.academy = { api: { source: 'own', endpoint: 'https://cors.example', key: 'sk-test', model: '' } };
  const seam = await boot(tavern, {
    fetchExtra: async (url) => {
      if (url.includes('cors.example')) throw new TypeError('Failed to fetch');
      if (url.endsWith('/api/backends/chat-completions/status')) {
        const raw = JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }] });
        return { ok: true, status: 200, text: async () => raw, json: async () => JSON.parse(raw) };
      }
      return null;
    },
  });
  const res = await seam.host.actions.listModels();
  assert.equal(res.ok, true, res.error);
  assert.equal(res.via, 'tavern-backend');
  assert.deepEqual(res.models, ['model-a', 'model-b']);
});

test('/academy-debug: промотка, телефон, придержанный прыжок и время суток — словами', async () => {
  const { debugText } = await import('../commands.js');
  const run = {
    mesId: 3,
    source: 'received',
    debug: {
      mode: 'auto',
      applied: [
        { kind: 'time-skip', days: 3, cap: 7, policy: 'attend' },
        { kind: 'phone-turn' },
        { kind: 'time-dropped', reason: 'phone-turn' },
        { kind: 'time-held', source: 'A+', via: 'tel:time', day: '2024-10-01', jump: 20 },
        { kind: 'daypart', source: 'A', daypart: 'evening' },
        { kind: 'exams-dated', day: '2024-10-14', added: 2 },
        { kind: 'rel', teacherId: 'petrova', delta: 2, impact: 'major', damped: true },
      ],
      rejected: [{ raw: 'rel=алиса:+1', reason: 'стоп-лист (героиня): «алиса» — не преподаватель' }],
    },
    injects: [],
  };
  const state = await semester(fakeTavern());
  state.journal = [{ day: '2024-09-03', kind: 'exam', data: { examId: 'e1', subjectId: 'chemistry', computed: '4', modelSaid: '5', applied: true } }];
  const out = debugText({ getDebug: () => run, getState: () => state, getPreset: () => ru });

  for (const raw of ['time-skip', 'phone-turn', 'time-dropped', 'time-held', 'daypart', 'exams-dated']) {
    assert.equal(new RegExp(`(^|\\s|—\\s)${raw}(\\s|$|:)`, 'm').test(out), false, `сырое имя «${raw}» в выводе:\n${out}`);
  }
  assert.match(out, /промотка времени/);
  assert.match(out, /ход в телефоне/);
  assert.match(out, /погашено/);
  assert.match(out, /стоп-лист/);
  // Расхождение экзамена с версией модели команда раньше не печатала вовсе.
  assert.match(out, /посчитано 4, модель написала 5/);
  // И каждая строка «Применено» — та же, что на вкладке «Отладка».
  for (const item of run.debug.applied) assert.ok(out.includes(describeApplied(item, ru.vocab)));
});

test('слова переносимых пресетов — механизма, а не одного заведения', () => {
  // Ни пар, ни сессии, ни семестра: эти строки звучат под любым пресетом.
  const all = Object.values(PRESET_TEXT).join(' ');
  for (const stem of ['пар ', 'пары', 'сесси', 'семестр', 'хвост', 'урок']) {
    assert.equal(all.toLowerCase().includes(stem), false, `«${stem}» в PRESET_TEXT`);
  }
});

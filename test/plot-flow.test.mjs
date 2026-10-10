// «Взять в сюжет» сквозь фальшивую таверну (как `secretary-course-flow`):
// повод уходит в следующую генерацию, переживает свайп, снимается следующей
// репликой игрока; «(без сплетен)» гасит повод и фон; секретарь отмечает
// «сыграно»; пересчёт ответа не сбрасывает «прочитано» и «взято».

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';

const loadPresetFile = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));
const preset = loadPresetFile('ru-university');
const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../manifest.json', import.meta.url)), 'utf8'));

const SUBJECTS = [{ id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' }];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }];
const COURSE = [
  { id: 'sokolova', name: 'Вера Соколова', desire: 'попасть в тройку лучших' },
  { id: 'orlova', name: 'Мила Орлова', desire: 'удержать стипендию' },
];

function semester(day = '2024-09-03') {
  const s = createState(preset, {
    startDay: '2024-09-02', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset), classmates: COURSE,
  });
  s.started = true;
  s.calendar.day = day;
  return s;
}

function fakeTavern(answer) {
  const listeners = new Map();
  const prompts = {};
  const tavern = {
    chat: [],
    chatMetadata: {},
    extensionSettings: {},
    powerUserSettings: { encode_tags: false, experimental_macro_engine: true },
    extension_prompt_types: { NONE: -1, IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 },
    extension_prompt_roles: { SYSTEM: 0, USER: 1, ASSISTANT: 2 },
    event_types: {
      MESSAGE_RECEIVED: 'message_received',
      MESSAGE_SENT: 'message_sent',
      MESSAGE_SWIPED: 'message_swiped',
      MESSAGE_EDITED: 'message_edited',
      MESSAGE_UPDATED: 'message_updated',
      MESSAGE_DELETED: 'message_deleted',
      CHAT_CHANGED: 'chat_id_changed',
      GENERATION_STARTED: 'generation_started',
      GENERATION_ENDED: 'generation_ended',
    },
    eventSource: {
      on(name, fn) {
        if (!listeners.has(name)) listeners.set(name, []);
        listeners.get(name).push(fn);
      },
      async emit(name, ...args) {
        for (const fn of listeners.get(name) || []) await fn(...args);
      },
    },
    prompts,
    extensionPrompts: prompts,
    setExtensionPrompt(key, value, position, depth, scan, role) {
      prompts[key] = { value: String(value), position, depth, scan, role };
    },
    saveMetadataDebounced() {},
    async saveMetadata() {},
    saveSettingsDebounced() {},
    chatId: 'chat-p',
    getCurrentChatId: () => tavern.chatId,
    macros: { registry: {}, category: { MISC: 'misc' }, register(name, def) { tavern.macros.registry[name] = def; } },
    registerMacro() {},
    name1: 'Аня',
    name2: 'Рассказчик',
    asked: [],
    answer,
    async generateRaw({ prompt, systemPrompt }) {
      tavern.asked.push({ prompt, systemPrompt });
      return typeof tavern.answer === 'function' ? tavern.answer(prompt) : tavern.answer;
    },
  };
  return tavern;
}

globalThis.toastr = Object.fromEntries(['success', 'info', 'warning', 'error'].map((k) => [k, () => {}]));

async function boot(opts = {}) {
  const tavern = fakeTavern(opts.answer || '<!-- [ACADEMY] -->');
  tavern.chatMetadata.academy = semester();
  Object.assign(tavern.extensionSettings, opts.settings || {});
  globalThis.SillyTavern = { getContext: () => tavern };
  globalThis.fetch = async (url) => {
    const str = String(url);
    const m = /\/presets\/([\w-]+)\.json$/.exec(str);
    if (m) return { ok: true, status: 200, json: async () => loadPresetFile(m[1]) };
    if (str.endsWith('/manifest.json')) return { ok: true, status: 200, json: async () => manifest };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const mod = await import(`../index.js?run=${Math.random()}`);
  await mod.__seam.ready;
  mod.__seam.live.legacyPosts = true; // тест старой ленты секретаря
  tavern.seam = mod.__seam;
  return tavern;
}

/** Ход как в таверне: старт генерации, реплика игрока, ответ модели. */
async function send(tavern, said, text) {
  await tavern.eventSource.emit('generation_started', 'normal', {}, false);
  tavern.chat.push({ mes: said, is_user: true, is_system: false });
  await tavern.eventSource.emit('message_sent', tavern.chat.length - 1);
  const prompt = oneShot(tavern);
  const status = statusOf(tavern);
  tavern.chat.push({ mes: text, is_user: false, is_system: false, swipes: [text], swipe_id: 0 });
  const id = tavern.chat.length - 1;
  await tavern.eventSource.emit('message_received', id, 'normal');
  await tavern.eventSource.emit('generation_ended');
  return { id, prompt, status };
}

/** Свайп последнего ответа с новой генерацией. */
async function swipe(tavern, id, text) {
  const m = tavern.chat[id];
  m.swipe_id = m.swipes.length;
  await tavern.eventSource.emit('message_swiped', id);
  await tavern.eventSource.emit('generation_started', 'swipe', {}, false);
  const prompt = oneShot(tavern);
  m.swipes.push(text);
  m.mes = text;
  await tavern.eventSource.emit('message_received', id, 'swipe');
  await tavern.eventSource.emit('generation_ended');
  return prompt;
}

const stateOf = (tavern) => tavern.chatMetadata.academy;
const actions = (tavern) => tavern.seam.host.actions;
const feedOf = (tavern) => stateOf(tavern).feed || { items: [], seen: {}, deals: [] };
const item = (tavern, pred) => feedOf(tavern).items.find(pred);
const oneShot = (tavern) => (tavern.prompts.academy_oneshot || {}).value || '';
const statusOf = (tavern) => (tavern.prompts.academy_status || {}).value || '';
const plotOf = (tavern) => tavern.chatMetadata.academy_plot;

const ANSWER = [
  '<!-- [ACADEMY met=sokolova clash=sokolova:@heroine:из-за конспекта] -->',
  'Что сочинено:',
  'loud=2',
  'react=2:orlova:chat:Аня опять сцепилась с Верой',
  'react=2:someone:anon:Говорят, Аня всё подстроила',
  'Кратко: стычка.',
].join('\n');

async function seeded(opts = {}) {
  const tavern = await boot({ answer: ANSWER, ...opts });
  const { id } = await send(tavern, 'Аня идёт на пару.', 'Вера и Аня ругаются у доски.');
  assert.equal((await actions(tavern).analyzeMessage(id)).ok, true);
  assert.equal((await tavern.seam.panel.saveAnalysis(id)).ok, true);
  return { tavern, id };
}

test('взять в сюжет: повод уходит в следующий ответ, переживает свайп, снимается следующей репликой', async () => {
  const { tavern } = await seeded();
  const gossip = item(tavern, (x) => x.chan === 'anon');
  assert.ok(gossip, 'слух в анонимке');
  const draft = tavern.seam.host.getFeedDraft(gossip.id);
  assert.match(draft.text, /Это слух — правда ли, неизвестно/);
  const edited = `${draft.text} Пусть это прозвучит в столовой.`;
  assert.equal((await actions(tavern).takeHook(gossip.id, edited)).ok, true);
  assert.equal(item(tavern, (x) => x.id === gossip.id).status, 'taken');
  assert.equal(oneShot(tavern).includes('столовой'), false, 'до генерации — не в промпте');

  const turn2 = await send(tavern, 'Аня идёт в столовую.', 'В столовой шумно.');
  assert.ok(turn2.prompt.includes('Пусть это прозвучит в столовой.'), 'правленая формулировка ушла в ответ');

  const again = await swipe(tavern, turn2.id, 'В столовой тихо.');
  assert.ok(again.includes('Пусть это прозвучит в столовой.'), 'свайп повод не тратит');
  assert.equal(item(tavern, (x) => x.id === gossip.id).status, 'taken', 'свайп не сбросил «взято»');

  const turn3 = await send(tavern, 'Аня уходит.', 'Вечер.');
  assert.equal(turn3.prompt.includes('столовой'), false, 'следующая реплика повод сняла');
  assert.equal(plotOf(tavern).queue.length, 0);
  assert.equal(plotOf(tavern).log.length, 1);
});

test('«(без сплетен)»: повод не уходит и ждёт, фон потока молчит; рубильник выключает слой целиком', async () => {
  const { tavern } = await seeded();
  const gossip = item(tavern, (x) => x.chan === 'anon');
  await actions(tavern).takeHook(gossip.id);
  const quiet = await send(tavern, 'Аня просто гуляет. (без сплетен)', 'Тихо.');
  assert.equal(quiet.prompt.includes('подстроила'), false);
  assert.doesNotMatch(quiet.status, /говорят/);
  assert.equal(plotOf(tavern).queue.length, 1, 'повод ждёт следующего хода');
  const loud = await send(tavern, 'Аня идёт на пару.', 'Пара.');
  assert.ok(loud.prompt.includes('подстроила'));
  assert.match(loud.status, /На курсе говорят:/, 'стычка с героиней — её знание, фон звучит');

  tavern.seam.host.setSettings({ feed: { hooks: false } });
  const other = item(tavern, (x) => x.chan === 'chat' && x.kind === 'reaction');
  assert.equal((await actions(tavern).takeHook(other.id)).ok, false, 'рубильник выключен — брать нельзя');
  const off = await send(tavern, 'Дальше.', 'Дальше.');
  assert.equal(off.prompt.includes('подстроила'), false, 'и взведённое не уходит');
});

test('пересчёт ответа не сбрасывает «прочитано» и «взято»; «сыграно» — от секретаря', async () => {
  const { tavern, id } = await seeded();
  assert.ok(feedOf(tavern).items.some((x) => !x.read));
  await actions(tavern).feedRead(null);
  assert.ok(feedOf(tavern).items.every((x) => x.read));
  const talk = item(tavern, (x) => x.chan === 'chat' && x.kind === 'reaction');
  await actions(tavern).takeHook(talk.id);
  // Разобрать и сохранить тот же ответ заново — пересчёт от снимка «до него».
  assert.equal((await actions(tavern).analyzeMessage(id)).ok, true);
  assert.equal((await tavern.seam.panel.saveAnalysis(id)).ok, true);
  assert.ok(feedOf(tavern).items.every((x) => x.read), 'прочитанное осталось прочитанным');
  assert.equal(item(tavern, (x) => x.id === talk.id).status, 'taken');

  // Повод ушёл в ответ, секретарь видит его и отмечает сыгранным.
  const next = await send(tavern, 'Аня в коридоре.', 'Мила при всех вспоминает стычку.');
  tavern.answer = (prompt) => {
    const m = /- (p\d+) — /.exec(prompt);
    return `<!-- [ACADEMY${m ? ` played=${m[1]}` : ''}] -->\nКратко: повод прозвучал.`;
  };
  assert.equal((await actions(tavern).analyzeMessage(next.id)).ok, true);
  assert.match(tavern.asked.at(-1).prompt, /Поводы, которые игрок отдал рассказчику/);
  assert.equal((await tavern.seam.panel.saveAnalysis(next.id)).ok, true);
  assert.equal(item(tavern, (x) => x.id === talk.id).status, 'played');
  assert.ok(tavern.seam.panel.panelFor(next.id).tokens.some((t) => /^повод сыгран: /.test(t.text)));
  // Снять разбор — отметка уходит.
  assert.equal((await tavern.seam.panel.clearAnalysis(next.id)).ok, true);
  assert.equal(item(tavern, (x) => x.id === talk.id).status, 'taken');
});

test('авто-режим: подкидывает громкое сам, игрок может убрать', async () => {
  const { tavern } = await seeded({ settings: { academy: { feed: { auto: true } } } });
  const turn = await send(tavern, 'Аня идёт на пару.', 'Пара.');
  assert.match(turn.prompt, /Если уместно, можно вплести в сцену/, 'авто-режим подкинул повод');
  const queued = plotOf(tavern).queue;
  assert.equal(queued.length, 1);
  assert.equal(queued[0].auto, true);
  assert.equal((await actions(tavern).dropHook(queued[0].id)).ok, true);
  assert.equal(plotOf(tavern).queue.length, 0);
});

test('Р5: в ход повода праздника повод игрока молчит и ждёт; уходит следующим ходом', async () => {
  const { tavern } = await seeded();
  const day = stateOf(tavern).calendar.day;
  const ev = await actions(tavern).addEvent({ name: 'Посвящение', from: day, hook: 'старшекурсники зовут всех на посвящение' });
  assert.equal(ev.ok, true, ev.error);
  // Ответ этого дня взводит разовый повод события на следующую генерацию.
  await send(tavern, 'Аня идёт на пару.', 'Пара идёт своим чередом.');
  const gossip = item(tavern, (x) => x.chan === 'anon');
  assert.equal((await actions(tavern).takeHook(gossip.id)).ok, true);

  const festive = await send(tavern, 'Аня выходит в коридор.', 'В коридоре шумно.');
  assert.ok(festive.prompt.includes('посвящение'), 'повод праздника звучит');
  assert.equal(festive.prompt.includes('подстроила'), false, 'повод игрока в этот ход глушится');
  assert.equal(plotOf(tavern).queue.length, 1, 'и остаётся в очереди');
  assert.equal(plotOf(tavern).queue[0].delivered, false);

  const next = await send(tavern, 'Аня идёт дальше.', 'Дальше.');
  assert.ok(next.prompt.includes('подстроила'), 'следующим ходом повод игрока уходит');
  assert.equal(next.prompt.includes('посвящение'), false, 'повод праздника — один раз');
});

test('фон в сцене — своя галочка: выключен — строка молчит, поводы живут', async () => {
  const { tavern } = await seeded();
  const gossip = item(tavern, (x) => x.chan === 'anon');
  await actions(tavern).takeHook(gossip.id);
  tavern.seam.host.setSettings({ feed: { background: false } });
  const turn = await send(tavern, 'Аня идёт на пару.', 'Пара.');
  assert.doesNotMatch(turn.status, /говорят/, 'фон погашен');
  assert.ok(turn.prompt.includes('подстроила'), 'повод по-прежнему уходит');
  tavern.seam.host.setSettings({ feed: { background: true } });
  const back = await send(tavern, 'Дальше.', 'Дальше.');
  assert.match(back.status, /На курсе говорят:/);
});

// Секретарь видит курс — сквозной прогон через фальшивую таверну (как в
// `sekretar.test.mjs`): встреча по имени без разбора, черновик с фактами и
// реакциями, вычёркивание факта уносит реакции, «Сохранить» кладёт ленту,
// галочка «в курс», «Отменить сохранение» и поправка к старому ответу.

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

function semester(day = '2024-09-03', edit = null) {
  const s = createState(preset, {
    startDay: '2024-09-02', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset), classmates: COURSE,
  });
  s.started = true;
  s.calendar.day = day;
  if (edit) edit(s);
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
    chatId: 'chat-s',
    getCurrentChatId: () => tavern.chatId,
    macros: { registry: {}, category: { MISC: 'misc' }, register(name, def) { tavern.macros.registry[name] = def; } },
    registerMacro() {},
    name1: 'Аня',
    name2: 'Рассказчик',
    /** Что спросили у секретаря. */
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
  const s = semester(opts.day || '2024-09-03', opts.edit);
  tavern.chatMetadata.academy = s;
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
  tavern.seam = mod.__seam;
  return tavern;
}

async function reply(tavern, text) {
  tavern.chat.push({ mes: 'Аня идёт на пару.', is_user: true, is_system: false });
  tavern.chat.push({ mes: text, is_user: false, is_system: false, swipes: [text], swipe_id: 0 });
  const id = tavern.chat.length - 1;
  await tavern.eventSource.emit('message_received', id, 'normal');
  return id;
}

const stateOf = (tavern) => tavern.chatMetadata.academy;
const grades = (tavern, id) => stateOf(tavern).subjects.find((x) => x.id === id).grades.map((g) => g.value);
const actions = (tavern) => tavern.seam.host.actions;
const ledger = (tavern) => tavern.chatMetadata.academy_ledger.list;

const course = (tavern) => stateOf(tavern).classmates;
const feedOf = (tavern) => stateOf(tavern).feed || { items: [], seen: {}, deals: [] };

const ANSWER = [
  '<!-- [ACADEMY met=sokolova clash=sokolova:orlova:из-за конспекта new=Глеб Морозов deal=sokolova:@heroine:конспект] -->',
  'Что сочинено:',
  'loud=2',
  'react=2:orlova:chat:Пусть сама пишет свои конспекты',
  'react=2:someone:anon:Говорят, Вера всё подстроила',
  'react=4:someone:chat:Аня теперь должница',
  'Кратко: Вера поссорилась с Милой.',
].join('\n');

test('встреча по имени: однокурсница в тексте ответа — «была в сцене» без разбора', async () => {
  const tavern = await boot();
  await reply(tavern, 'В коридоре Соколову окружили первокурсники.');
  assert.equal(feedOf(tavern).seen.sokolova.local, true);
  assert.equal(feedOf(tavern).seen.orlova, undefined);
  assert.equal(tavern.asked.length, 0, 'без запроса');
});

test('черновик курса: факты и «что говорят» словами; вычеркнутый факт уносит реакции; сохранение кладёт ленту', async () => {
  const tavern = await boot({ answer: ANSWER });
  const id = await reply(tavern, 'Вера и Мила ругаются у доски.');
  assert.equal((await actions(tavern).analyzeMessage(id)).ok, true);
  const before = structuredClone(stateOf(tavern));
  assert.ok(tavern.asked[0].prompt.includes('- sokolova — Вера Соколова'), 'курс в промпте');
  let view = tavern.seam.panel.panelFor(id);
  const words = view.tokens.map((t) => t.text);
  assert.ok(words.includes('стычка: Вера Соколова и Мила Орлова — из-за конспекта'));
  assert.ok(words.includes('новое имя: Глеб Морозов — после сохранения его можно будет добавить'));
  assert.deepEqual(view.tokens.filter((t) => t.kind === 'react').map((t) => t.about), [
    'стычка: Вера Соколова и Мила Орлова — из-за конспекта',
    'стычка: Вера Соколова и Мила Орлова — из-за конспекта',
    'Вера Соколова должна Ане: конспект',
  ]);
  assert.deepEqual(stateOf(tavern), before, 'черновик не трогает мир');
  // Кружки рядом с именами в «Что говорят»: человек — инициалы, анонимка — силуэт.
  assert.deepEqual(view.tokens.filter((t) => t.kind === 'react').map((t) => t.avatar.kind === 'person' ? t.avatar.initials : t.avatar.icon), ['МО', '👤', '👤']);

  const clash = view.tokens.findIndex((t) => t.text.startsWith('стычка'));
  await tavern.seam.panel.dropToken(id, clash);
  view = tavern.seam.panel.panelFor(id);
  assert.equal(view.tokens.filter((t) => t.kind === 'react').length, 1, 'реакции стычки ушли с ней');

  assert.equal((await tavern.seam.panel.saveAnalysis(id)).ok, true);
  const feed = feedOf(tavern);
  assert.deepEqual(feed.items.map((x) => [x.kind, x.text]), [['reaction', 'Аня теперь должница']]);
  assert.equal(feed.seen.sokolova.local, undefined, 'секретарь уточнил локальную отметку');
  assert.equal(feed.deals.length, 1);
  assert.deepEqual(stateOf(tavern).classmateCandidates.map((c) => c.name), ['Глеб Морозов']);

  // Галочка «в курс» с плашки.
  view = tavern.seam.panel.panelFor(id);
  const cand = view.tokens.find((t) => t.candidate);
  assert.ok(cand, 'кнопка «в курс»');
  assert.equal((await tavern.seam.panel.confirmCandidate(id, cand.candidate)).ok, true);
  assert.ok(course(tavern).some((c) => c.name === 'Глеб Морозов'));
  assert.ok(tavern.seam.panel.panelFor(id).tokens.some((t) => t.text === 'новое имя: Глеб Морозов — уже в разделе «Курс»'));

  // Отменить сохранение — лента, дела и встреча уходят; человек, взятый галочкой, остаётся.
  assert.equal((await tavern.seam.panel.clearAnalysis(id)).ok, true);
  assert.equal(feedOf(tavern).items.length, 0);
  assert.equal(feedOf(tavern).deals.length, 0);
  assert.ok(course(tavern).some((c) => c.name === 'Глеб Морозов'), 'галочка — решение человека');
});

test('поправка к старому ответу: курс и лента ложатся и снимаются квитанциями', async () => {
  const tavern = await boot({ answer: ANSWER });
  const id = await reply(tavern, 'Вера и Мила ругаются.');
  await reply(tavern, 'Следующая сцена.');
  await actions(tavern).analyzeMessage(id);
  assert.equal((await tavern.seam.panel.saveAnalysis(id)).ok, true);
  assert.equal(feedOf(tavern).items.filter((x) => x.kind === 'reaction').length, 3);
  assert.equal(feedOf(tavern).items.filter((x) => x.kind === 'fact').length, 1);
  assert.equal(stateOf(tavern).classmateCandidates.length, 1);
  assert.equal((await tavern.seam.panel.clearAnalysis(id)).ok, true);
  assert.equal(feedOf(tavern).items.length, 0);
  assert.equal(feedOf(tavern).deals.length, 0);
  assert.equal(stateOf(tavern).classmateCandidates.length, 0);
});

test('свайп последнего ответа откатывает ленту вместе с состоянием', async () => {
  const tavern = await boot({ answer: ANSWER });
  const id = await reply(tavern, 'Вера и Мила ругаются.');
  await actions(tavern).analyzeMessage(id);
  await tavern.seam.panel.saveAnalysis(id);
  assert.ok(feedOf(tavern).items.length > 0);
  const m = tavern.chat[id];
  m.swipe_id = 1;
  await tavern.eventSource.emit('message_swiped', id);
  m.swipes.push('Тихий вечер.');
  m.mes = 'Тихий вечер.';
  await tavern.eventSource.emit('message_received', id, 'swipe');
  assert.equal(feedOf(tavern).items.length, 0);
  assert.equal(stateOf(tavern).classmateCandidates.length, 0);
});

test('В: незнакомое имя — строкой «Не разобрано»; человек, добавленный после ответа, виден разбору заново и переживает пересчёт', async () => {
  const tavern = await boot({ answer: '<!-- [ACADEMY met=sokolova met=morozov] -->\nКратко: x' });
  const id = await reply(tavern, 'Вера и Глеб у окна.');
  assert.equal((await actions(tavern).analyzeMessage(id)).ok, true);
  let view = tavern.seam.panel.panelFor(id);
  assert.deepEqual(view.unparsed, ['morozov'], 'не тишина в консоли, а строка на плашке');
  assert.ok(view.tokens.some((t) => t.text === 'в сцене: Вера Соколова'), 'sokolova нашлась и так');
  assert.equal(view.labels.course, 'Курс');
  assert.equal(view.labels.rel, 'Отношение преподавателей');

  // Человека добавили руками уже после ответа.
  assert.equal((await actions(tavern).addClassmate({ name: 'Глеб Морозов' })).ok, true);
  const gleb = course(tavern).find((c) => c.name === 'Глеб Морозов');
  assert.ok(gleb);
  // «Разобрать заново»: секретарь видит нынешний курс, и morozov ложится мягко.
  assert.equal((await actions(tavern).analyzeMessage(id)).ok, true);
  assert.ok(tavern.asked[tavern.asked.length - 1].prompt.includes('Глеб Морозов'), 'новый человек в промпте секретаря');
  view = tavern.seam.panel.panelFor(id);
  assert.deepEqual(view.unparsed, []);
  assert.ok(view.tokens.some((t) => t.text === 'в сцене: Глеб Морозов'));
  // Сохранение — пересчёт от снимка «до ответа»: Глеб из курса не пропадает.
  assert.equal((await tavern.seam.panel.saveAnalysis(id)).ok, true);
  assert.ok(course(tavern).some((c) => c.id === gleb.id), 'пересчёт не стёр добавленного руками');
  assert.ok(feedOf(tavern).seen[gleb.id], 'и встреча с ним записана');
});

// Секретарь: шлюзовая ошибка прокси, веб-поиск из пресета, чужая разметка в ответе (баги 14, 51, 52).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  classifyError, complete, tavernComplete, withoutForeignInjections, isGatewayText,
  setFetch, setSleep, GATEWAY_MESSAGE,
} from '../api.js';
import { buildAnalysisPrompt, stripForeignMarkup } from '../core/analysis.mjs';
import { createState } from '../core/state.mjs';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));

const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const GATEWAY_200 = { error: { message: 'Bad Gateway' } };
const api = { endpoint: 'https://x.y/v1', key: 'sk-1', model: 'glm-4' };

test.afterEach(() => { setFetch(null); setSleep(null); });

function fakeSleep() {
  const pauses = [];
  setSleep(async (ms) => { pauses.push(ms); });
  return pauses;
}

// --- 51: шлюз ----------------------------------------------------------------

test('шлюзовая ошибка узнаётся по тексту и по статусу', () => {
  assert.equal(isGatewayText('Bad Gateway'), true);
  assert.equal(isGatewayText('502 Gateway Timeout'), true);
  assert.equal(isGatewayText('Модель не нашла слово'), false);
  assert.equal(classifyError({ status: 200, body: GATEWAY_200, gateway: true }).code, 'gateway');
  assert.equal(classifyError({ status: 502 }).code, 'gateway');
  assert.equal(classifyError({ status: 504 }).code, 'gateway');
  assert.equal(classifyError({ status: 503 }).code, 'server', 'прочие 5xx — как раньше');
  assert.equal(classifyError({ status: 200, body: GATEWAY_200, gateway: true }).message, GATEWAY_MESSAGE);
});

test('HTTP 200 с телом Bad Gateway повторяется и потом проходит', async () => {
  const pauses = fakeSleep();
  let calls = 0;
  setFetch(async () => {
    calls += 1;
    return calls === 1 ? reply(200, GATEWAY_200) : reply(200, { choices: [{ message: { content: 'ответ' } }] });
  });
  const res = await complete(api, { user: 'U' });
  assert.equal(res.ok, true);
  assert.equal(res.text, 'ответ');
  assert.equal(calls, 2);
  assert.equal(pauses.length, 1);
});

test('шлюз не ответил ни разу: понятная подпись, а не «успех» с пустым текстом', async () => {
  const pauses = fakeSleep();
  let calls = 0;
  setFetch(async () => { calls += 1; return reply(200, GATEWAY_200); });
  const res = await complete(api, { user: 'U' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'gateway');
  assert.match(res.message, /Шлюз модели не ответил/);
  assert.equal(calls, 3, 'первая попытка и два повтора');
  assert.equal(pauses.length, 2);
});

test('таверна: исключение «Bad Gateway» — тот же повтор и тот же код', async () => {
  const pauses = fakeSleep();
  let calls = 0;
  const ctx = {
    generateRawData: async () => {
      calls += 1;
      if (calls < 3) throw new Error('Bad Gateway');
      return { choices: [{ message: { content: 'ответ' }, finish_reason: 'stop' }] };
    },
  };
  const ok = await tavernComplete(ctx, { user: 'U' });
  assert.equal(ok.ok, true);
  assert.equal(calls, 3);
  assert.equal(pauses.length, 2);

  calls = -10;
  const bad = await tavernComplete(ctx, { user: 'U' });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'gateway');
});

test('таверна: тело ответа {error:{message:"Bad Gateway"}} — шлюз, а не пустой ответ', async () => {
  fakeSleep();
  const ctx = { generateRawData: async () => GATEWAY_200 };
  const res = await tavernComplete(ctx, { user: 'U' });
  assert.equal(res.code, 'gateway');
});

test('таверна: обычная ошибка не повторяется', async () => {
  const pauses = fakeSleep();
  let calls = 0;
  const ctx = { generateRawData: async () => { calls += 1; throw new Error('Invalid key'); } };
  const res = await tavernComplete(ctx, { user: 'U' });
  assert.equal(res.code, 'tavern');
  assert.equal(calls, 1);
  assert.deepEqual(pauses, []);
});

test('служебный запрос не уносит enable_web_search из пресета генерации', async () => {
  const events = {};
  const bus = {
    makeFirst(e, f) { events[e] = [f, ...(events[e] || []).filter((x) => x !== f)]; },
    makeLast(e, f) { events[e] = [...(events[e] || []).filter((x) => x !== f), f]; },
    removeListener(e, f) { events[e] = (events[e] || []).filter((x) => x !== f); },
    async emit(e, d) { for (const f of [...(events[e] || [])]) await f(d); },
  };
  const ctx = { eventSource: bus };
  const ours = { messages: [{ role: 'user', content: 'Разбери этот фрагмент ответа' }], enable_web_search: true };
  const foreign = { messages: [{ role: 'user', content: 'реплика игрока' }], enable_web_search: true };
  await withoutForeignInjections(ctx, 'Разбери этот фрагмент', async () => {
    await bus.emit('chat_completion_settings_ready', ours);
    await bus.emit('chat_completion_settings_ready', foreign);
  });
  assert.equal('enable_web_search' in ours, false);
  assert.equal(foreign.enable_web_search, true, 'чужую генерацию не трогаем');
});

// --- 52: чужая разметка ------------------------------------------------------

test('картинка с JSON-подсказкой и блок <rp_plan> не доходят до секретаря', () => {
  const text = [
    'Вандрел поднял глаза.',
    `<div><img data-iig-instruction='{"style":"anime","prompt":"a > b, girl"}' src="[IMG:GEN]"></div>`,
    '<rp_plan>1. Ответить. 2. Съязвить.</rp_plan>',
    '— Опоздали, — сказал он.',
  ].join('\n');
  const out = stripForeignMarkup(text);
  assert.equal(out, 'Вандрел поднял глаза.\n\n— Опоздали, — сказал он.'.replace('\n\n', '\n\n'));
  const user = buildAnalysisPrompt(createState(preset), preset, { reply: text }).user;
  assert.doesNotMatch(user, /data-iig|<img|rp_plan|Съязвить/);
  assert.match(user, /Опоздали/);
});

test('любые <img> и вложенный служебный блок снимаются', () => {
  assert.equal(stripForeignMarkup('а <img src="x.png"> б <img src=y.png/> в'), 'а  б  в');
  assert.equal(stripForeignMarkup('до<div><rp_plan>скрыто</rp_plan></div>после'), 'допосле');
  assert.equal(stripForeignMarkup('<think>мысли</think>Текст'), 'Текст');
});

test('разметка сцены остаётся: курсив, жирный, переносы, сравнения и скобки', () => {
  const keep = '<i>Тише</i>, — <b>сказала</b> она.<br>Если 2 < 3 и 5 > 4, то <span>всё</span> хорошо. <3';
  assert.equal(stripForeignMarkup(keep), keep);
  assert.equal(stripForeignMarkup(''), '');
  assert.equal(stripForeignMarkup(null), '');
});

// --- 14: не усиливать сказанное ----------------------------------------------

test('в правилах блока 1 есть «не усиливай сказанное»', () => {
  const user = buildAnalysisPrompt(createState(preset), preset, { reply: 'Сцена.' }).user;
  assert.match(user, /Не усиливай сказанное/);
  assert.match(user, /извинилась/);
});

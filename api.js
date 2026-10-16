import { subjectWord } from './core/words.mjs';
import { buildPlanPrompt, parsePlanResponse, validatePlan, extractJson, fill, balancedBlock } from './core/plan-gen.mjs';
import { emptySurvey, CANON_MAX } from './core/state.mjs';
import { buildCastPrompt, castFromModel } from './core/card-cast.mjs';
import { assembleCast, buildTemperPrompt, parseTemperReply, END_MARK } from './core/feed-cast.mjs';
import { buildCanonCoursePrompt, parseCanonCourse } from './core/canon-course.mjs';
import { pickBully } from './core/bully-pick.mjs';
import { translateAll } from './core/lore-english.mjs';
import { canonLayerTargets, buildCanonLayerPrompt, parseCanonLayer } from './core/canon-layer.mjs';
import { bookEntries, prefilterPeople, splitBatches, buildLorePeoplePrompt, parseLorePeople } from './core/lore-people.mjs';

export const TIMEOUTS = {
  complete: 240000,
  models: 20000,
  test: 20000,
};

export const TOKEN_BUDGETS = {
  ping: 8,
  survey: 8192,
  cast: 8192,
  feedCast: 12288,
  molva: 8192,
  temper: 8192,
  bullyPick: 8192,
  loreEnglish: 12288,
  lorePeople: 8192,
  canonCourse: 8192,
  canonLayer: 16384,
  plan: 12288,
  analysis: 8192,
  looks: 6144,
  default: 1024,
};

export const RETRY = { pauses: [800, 1600] };

export function isRetryableStatus(status) {
  return typeof status === 'number' && (status === 429 || status >= 500);
}

export function isGatewayText(text) {
  return /bad gateway|gateway time-?out|upstream (?:connect|request|timed)|50[234]/i.test(String(text == null ? '' : text));
}

function isGatewayBody(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.choices) return false;
  return Boolean(data.error) && isGatewayText(errorDetail(data));
}

export const GATEWAY_MESSAGE = 'Шлюз модели не ответил. Попробуйте ещё раз чуть позже.';

function budgetOf(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|[\w-]+\.local)(:\d+)?(\/|$)/i;

export function normalizeBase(endpoint) {
  let s = String(endpoint == null ? '' : endpoint).trim();
  if (!s) return '';
  s = s.replace(/^["'<]+|["'>]+$/g, '').trim();
  if (!s) return '';
  s = s.replace(/[?#].*$/, '');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    s = (LOCAL_HOST.test(s) ? 'http://' : 'https://') + s.replace(/^\/+/, '');
  }
  s = s.replace(/\/+$/, '');
  const tails = [/\/chat\/completions$/i, /\/completions$/i, /\/models$/i, /\/v1$/i];
  for (let guard = 0; guard < 8; guard += 1) {
    const before = s;
    for (const t of tails) s = s.replace(t, '');
    s = s.replace(/\/+$/, '');
    if (s === before) break;
  }
  return s;
}

export function chatUrl(endpoint) {
  const base = normalizeBase(endpoint);
  return base ? `${base}/v1/chat/completions` : '';
}

export function modelsUrl(endpoint) {
  const base = normalizeBase(endpoint);
  return base ? `${base}/v1/models` : '';
}

export function hasOwnEndpoint(api) {
  const a = api || {};
  return Boolean(normalizeBase(a.endpoint));
}

export function resolveSource(api) {
  const src = api && api.source ? String(api.source) : 'auto';
  if (src === 'tavern') return 'tavern';
  if (src === 'own') return 'endpoint';
  return hasOwnEndpoint(api) ? 'endpoint' : 'tavern';
}

export function escapeMacros(text) {
  return String(text == null ? '' : text).replace(/\{(?=\{)/g, '{​');
}

function withDeadline(promise, ms, signal) {
  return new Promise((resolve, reject) => {
    const fail = (timeout) => {
      const error = new Error(timeout ? 'timeout' : 'aborted');
      error.name = 'AbortError';
      if (timeout) error.timeout = true;
      reject(error);
    };
    if (signal && signal.aborted) return fail(false);
    const timer = setTimeout(() => fail(true), ms);
    const onAbort = () => { clearTimeout(timer); fail(false); };
    if (signal && typeof signal.addEventListener === 'function') signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const WEB_SEARCH_KEYS = ['enable_web_search', 'use_web_search', 'web_search'];

export async function withoutForeignInjections(ctx, probe, run) {
  const bus = ctx && ctx.eventSource;
  if (!bus || typeof bus.makeFirst !== 'function' || typeof bus.makeLast !== 'function'
    || typeof bus.removeListener !== 'function') return run();
  const types = (ctx && (ctx.eventTypes || ctx.event_types)) || {};
  const chatEvent = types.CHAT_COMPLETION_PROMPT_READY || 'chat_completion_prompt_ready';
  const settingsEvent = types.CHAT_COMPLETION_SETTINGS_READY || 'chat_completion_settings_ready';
  const textEvent = types.GENERATE_AFTER_COMBINE_PROMPTS || 'generate_after_combine_prompts';
  const needle = String(probe == null ? '' : probe).trim().slice(0, 60);
  if (!needle) return run();
  const has = (content) => typeof content === 'string' && content.includes(needle);
  let chatSnap = null;
  let textSnap = null;

  const chatFirst = (data) => {
    if (chatSnap || !data || data.dryRun || !Array.isArray(data.chat)) return;
    if (data.chat.some((m) => m && has(m.content))) {
      chatSnap = { data, chat: data.chat, copy: data.chat.map((m) => ({ ...m })) };
    }
  };
  const settingsFirst = (data) => {
    if (!data || data.dryRun || !Array.isArray(data.messages)) return;
    if (!data.messages.some((m) => m && has(m.content))) return;
    for (const key of WEB_SEARCH_KEYS) if (key in data) delete data[key];
  };
  const chatLast = (data) => {
    if (!chatSnap || data !== chatSnap.data) return;
    chatSnap.chat.splice(0, chatSnap.chat.length, ...chatSnap.copy);
    data.chat = chatSnap.chat;
  };
  const textFirst = (data) => {
    if (textSnap || !data || data.dryRun || typeof data.prompt !== 'string') return;
    if (has(data.prompt)) textSnap = { data, prompt: data.prompt };
  };
  const textLast = (data) => {
    if (!textSnap || data !== textSnap.data) return;
    data.prompt = textSnap.prompt;
  };

  bus.makeFirst(settingsEvent, settingsFirst);
  bus.makeFirst(chatEvent, chatFirst);
  bus.makeLast(chatEvent, chatLast);
  bus.makeFirst(textEvent, textFirst);
  bus.makeLast(textEvent, textLast);
  try {
    return await run();
  } finally {
    for (const [e, f] of [[settingsEvent, settingsFirst], [chatEvent, chatFirst], [chatEvent, chatLast], [textEvent, textFirst], [textEvent, textLast]]) {
      try { bus.removeListener(e, f); } catch {}
    }
  }
}

export async function tavernComplete(ctx, req = {}) {
  let res = await tavernCompleteOnce(ctx, req);
  for (const pause of req.retry === false ? [] : RETRY.pauses) {
    if (res.ok || res.code !== 'gateway') break;
    await sleepImpl(pause, req.signal);
    if (req.signal && req.signal.aborted) return classifyError({ error: abortError() });
    res = await tavernCompleteOnce(ctx, req);
  }
  return res;
}

function tavernFailure(error, fallback) {
  const detail = (error && error.message) || '';
  if (isGatewayText(detail)) return classifyError({ gateway: true, status: 200, body: detail });
  return { ok: false, code: 'tavern', status: null, detail, message: fallback(detail || 'без подробностей') };
}

async function tavernCompleteOnce(ctx, req = {}) {
  const { system = '', user = '', profileId = '' } = req;
  const maxTokens = budgetOf(req.maxTokens, TOKEN_BUDGETS.default);
  const c = tavern(ctx);
  const service = c && c.ConnectionManagerRequestService;
  const profiles = (c && c.extensionSettings && c.extensionSettings.connectionManager
    && c.extensionSettings.connectionManager.profiles) || [];
  const profile = profileId ? profiles.find((p) => p && p.id === profileId) : null;

  if (profileId && !profile) {
    return {
      ok: false,
      code: 'no-profile',
      status: null,
      detail: '',
      message: 'Выбранный профиль подключения в таверне не найден: выберите его заново.',
    };
  }

  if (profile && service && typeof service.sendRequest === 'function') {
    try {
      const messages = [];
      if (system) messages.push({ role: 'system', content: system });
      messages.push({ role: 'user', content: user });
      const out = await withDeadline(service.sendRequest(profile.id, messages, maxTokens, {
        stream: false, extractData: true, includePreset: true, includeInstruct: true,
      }), req.timeout || TIMEOUTS.complete, req.signal);
      if (isGatewayBody(out)) return classifyError({ gateway: true, status: 200, body: out });
      const text = parseCompletion(out);
      if (!text.trim()) return { ok: false, code: 'empty', status: null, detail: '', message: 'Модель вернула пустой ответ.' };
      return {
        ok: true, text, via: 'tavern', profile: profile.name || profile.id,
        budget: maxTokens, truncated: isTruncated(out, text),
      };
    } catch (error) {
      if (error && error.name === 'AbortError') return classifyError({ error });
      return tavernFailure(error, (why) => `Профиль «${profile.name || profile.id}» не дал ответа: ${why}.`);
    }
  }

  if (!c || (typeof c.generateRaw !== 'function' && typeof c.generateRawData !== 'function')) {
    return {
      ok: false,
      code: 'no-endpoint',
      status: null,
      detail: '',
      message: profile
        ? 'Профиль выбран, но эта сборка таверны не умеет отвечать на запрос расширения по профилю.'
        : 'Подключение таверны недоступно.',
    };
  }
  try {
    const args = { prompt: escapeMacros(user), systemPrompt: escapeMacros(system), responseLength: maxTokens };
    const ask = typeof c.generateRawData === 'function'
      ? () => c.generateRawData(args)
      : () => c.generateRaw(args);
    const out = await withoutForeignInjections(c, args.prompt, () => withDeadline(
      ask(), req.timeout || TIMEOUTS.complete, req.signal,
    ));
    if (isGatewayBody(out)) return classifyError({ gateway: true, status: 200, body: out });
    const text = parseCompletion(out);
    if (!text.trim()) return { ok: false, code: 'empty', status: null, detail: '', message: 'Модель вернула пустой ответ.' };
    return { ok: true, text, via: 'tavern', budget: maxTokens, truncated: isTruncated(out, text) };
  } catch (error) {
    if (error && error.name === 'AbortError') return classifyError({ error });
    return tavernFailure(error, (why) => `Подключение таверны не дало ответа: ${why}.`);
  }
}

export function parseCompletion(data) {
  if (data == null) return '';
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return data.map(parseCompletion).filter(Boolean).join('\n');
  if (typeof data !== 'object') return String(data);

  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  if (choice) {
    const msg = choice.message || choice.delta;
    if (msg) {
      const c = contentToString(msg.content);
      if (c) return c;
      if (msg.reasoning_content || msg.reasoning) return '';
    }
    const t = contentToString(choice.text);
    if (t) return t;
  }
  for (const key of ['response', 'content', 'text', 'output_text', 'completion']) {
    const v = contentToString(data[key]);
    if (v) return v;
  }
  if (data.message) {
    const v = contentToString(data.message.content !== undefined ? data.message.content : data.message);
    if (v) return v;
  }
  if (Array.isArray(data.output)) {
    const v = data.output.map((o) => contentToString(o && o.content)).filter(Boolean).join('\n');
    if (v) return v;
  }
  return '';
}

function contentToString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(contentToString).filter(Boolean).join('');
  if (typeof v === 'object') return contentToString(v.text !== undefined ? v.text : v.content);
  return String(v);
}

export function finishReason(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const v = (choice && (choice.finish_reason || choice.finishReason || choice.stop_reason))
    || data.finish_reason || data.stop_reason || '';
  return v ? String(v) : '';
}

export function isTruncatedReason(reason) {
  return /^(length|max_tokens|max-tokens|maxtokens)$/i.test(String(reason || '').trim());
}

export function looksTruncated(text) {
  const s = String(text == null ? '' : text);
  if (!/[{[]/.test(s)) return false;
  return balancedBlock(s) === '';
}

function isTruncated(data, text) {
  return isTruncatedReason(finishReason(data)) || looksTruncated(text);
}

export function truncatedMessage(half, fallback = '') {
  return `Модель не договорила: ${half}. Попробуйте ещё раз.`
    + (fallback ? ` ${fallback}` : '');
}

function subjectsCount(n, preset) {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? subjectWord(preset)
    : (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) ? subjectWord(preset, 'gen') : subjectWord(preset, 'genMany');
  return `${n} ${word}`;
}

function planWord(preset) {
  return String((preset && preset.ui && preset.ui.planSection) || 'Учебный план');
}

export function parseModels(data) {
  const rows = Array.isArray(data) ? data
    : (data && (Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : [])));
  const out = [];
  for (const row of rows || []) {
    const id = typeof row === 'string' ? row : (row && (row.id || row.name || row.model));
    if (id && !out.includes(String(id))) out.push(String(id));
  }
  return out;
}

export function classifyError(info = {}) {
  const status = typeof info.status === 'number' ? info.status : null;
  const detail = errorDetail(info.body) || (info.error && info.error.message) || '';
  const err = info.error;
  const where = info.url ? ` (${info.url})` : '';
  const make = (code, message) => ({ ok: false, code, message, status, detail });

  if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
    return err.timeout
      ? make('timeout', `Модель не ответила за отведённое время${where}.`)
      : make('aborted', 'Запрос отменён.');
  }
  if (info.gateway === true || status === 502 || status === 504 || (status !== null && isGatewayText(detail))) {
    return make('gateway', GATEWAY_MESSAGE);
  }
  if (status === null) {
    return make('network', `Адрес не отвечает${where}: сервер недоступен, неверный адрес`
      + ' или провайдер не разрешает запросы из браузера (CORS).');
  }
  if (status === 401 || status === 403) {
    return make('auth', `Ключ не принят (${status}). Проверьте ключ API и права на этой модели.`);
  }
  if (status === 404) {
    if (/model/i.test(detail)) {
      return make('model', `Модель «${info.model || '?'}» не найдена (404). Возьмите её из списка моделей.`);
    }
    return make('not-found', `Путь не найден (404)${where}. Скорее всего, в адресе лишний или недостающий /v1.`);
  }
  if (status === 429) return make('rate', 'Слишком много запросов (429). Подождите и повторите.');
  if (status === 400 || status === 422) {
    if (/model/i.test(detail)) {
      return make('model', `Модель «${info.model || '?'}» не подходит: ${detail || 'сервер отверг запрос'}.`);
    }
    return make('bad-request', `Сервер отверг запрос (${status}): ${detail || 'без подробностей'}.`);
  }
  if (status >= 500) return make('server', `Ошибка на стороне сервера (${status}): ${detail || 'без подробностей'}.`);
  return make('http', `Неожиданный ответ (${status}): ${detail || 'без подробностей'}.`);
}

export function errorDetail(body) {
  if (!body) return '';
  if (typeof body === 'string') return body.slice(0, 400).trim();
  if (typeof body !== 'object') return String(body);
  const e = body.error;
  if (typeof e === 'string') return e.slice(0, 400);
  if (e && typeof e === 'object' && e.message) return String(e.message).slice(0, 400);
  if (body.message) return String(body.message).slice(0, 400);
  if (body.detail) return typeof body.detail === 'string' ? body.detail.slice(0, 400) : JSON.stringify(body.detail).slice(0, 400);
  return '';
}

let fetchImpl = (...args) => globalThis.fetch(...args);

export function setFetch(fn) {
  fetchImpl = typeof fn === 'function' ? fn : (...args) => globalThis.fetch(...args);
}

let contextProvider = () => (globalThis.SillyTavern && globalThis.SillyTavern.getContext
  ? globalThis.SillyTavern.getContext()
  : null);

export function setContextProvider(fn) {
  contextProvider = typeof fn === 'function' ? fn : () => null;
}

function tavern(ctx) {
  return ctx || contextProvider();
}

const KEY_INVISIBLE = /[​-‍⁠﻿]/g;

const KEY_EDGES = /^[\s ]+|[\s ]+$/g;

function describeKeyChar(ch) {
  const cp = ch.codePointAt(0);
  const hex = `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  if (ch === ' ') return 'пробел';
  if (ch === '\n' || ch === '\r') return 'перенос строки';
  if (ch === '\t') return 'табуляция';
  if (cp === 0xA0) return 'неразрывный пробел';
  if (cp < 0x20 || cp === 0x7F) return `управляющий символ ${hex}`;
  if (cp >= 0x400 && cp <= 0x4FF) return `кириллическая буква «${ch}» — скорее всего, вместо похожей латинской`;
  return `символ «${ch}» (${hex})`;
}

export function sanitizeApiKey(raw) {
  const key = String(raw == null ? '' : raw).replace(KEY_INVISIBLE, '').replace(KEY_EDGES, '');
  const at = key.search(/[^\x21-\x7E]/);
  if (at === -1) return { ok: true, key };
  const ch = String.fromCodePoint(key.codePointAt(at));
  return {
    ok: false,
    key,
    position: at + 1,
    message: `В ключе API лишний символ: ${describeKeyChar(ch)}, ${at + 1}-й по счёту.`
      + ' Так бывает, когда ключ копируют из мессенджера или заметок.'
      + ' Вставьте ключ заново — лучше прямо из кабинета провайдера.',
  };
}

export function keyProblem(api) {
  const res = sanitizeApiKey(api && api.key);
  if (res.ok) return null;
  return { ok: false, code: 'bad-key', status: null, detail: '', message: res.message };
}

export function headersFor(api) {
  const h = { 'Content-Type': 'application/json' };
  const res = sanitizeApiKey(api && api.key);
  if (res.ok && res.key) h.Authorization = `Bearer ${res.key}`;
  return h;
}

function defaultSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) { resolve(); return; }
    const done = () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    if (signal) signal.addEventListener('abort', done, { once: true });
  });
}

let sleepImpl = defaultSleep;

export function setSleep(fn) {
  sleepImpl = typeof fn === 'function' ? fn : defaultSleep;
}

function abortError() {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}

async function request(url, init, opts) {
  const pauses = opts.retry === false ? [] : RETRY.pauses;
  let res = await requestOnce(url, init, opts);
  let tries = 1;
  for (const pause of pauses) {
    if (res.ok || !(isRetryableStatus(res.status) || res.code === 'gateway')) break;
    await sleepImpl(pause, opts.signal);
    if (opts.signal && opts.signal.aborted) return classifyError({ error: abortError(), url, model: opts.model });
    res = await requestOnce(url, init, opts);
    tries += 1;
  }
  if (!res.ok && tries > 1 && res.code !== 'gateway') {
    const again = tries - 1 === 1 ? 'уже повторило запрос' : `уже повторило запрос ${tries - 1} раза`;
    return { ...res, tries, message: `${res.message} Расширение ${again} с паузой — попробуйте позже.` };
  }
  return res;
}

async function requestOnce(url, init, { timeout, signal, model }) {
  const ctl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, timeout);
  const onAbort = () => ctl.abort();
  if (signal) {
    if (signal.aborted) ctl.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    const res = await fetchImpl(url, { ...init, signal: ctl.signal });
    const raw = await res.text().catch(() => '');
    let data;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
    if (!res.ok) return classifyError({ status: res.status, body: data, url, model });
    if (isGatewayBody(data)) return classifyError({ status: res.status, body: data, url, model, gateway: true });
    return { ok: true, status: res.status, data, raw };
  } catch (error) {
    if (timedOut && error && error.name === 'AbortError') error.timeout = true;
    return classifyError({ error, url, model });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

export async function listModels(api, opts = {}) {
  if (resolveSource(api) === 'tavern') {
    return {
      ok: false,
      code: 'tavern-no-models',
      status: null,
      detail: '',
      message: 'Список моделей есть только у своего адреса. У актуального подключения таверны модель задаёт сама таверна — здесь её выбирать нечем.',
    };
  }
  const url = modelsUrl(api && api.endpoint);
  if (!url) return { ok: false, code: 'no-endpoint', message: 'Адрес не задан: вписать endpoint.', status: null, detail: '' };
  const bad = keyProblem(api);
  if (bad) return bad;
  const direct = await request(url, { method: 'GET', headers: headersFor(api) }, {
    timeout: opts.timeout || TIMEOUTS.models,
    signal: opts.signal,
  });
  let res = direct;
  let via = '';
  if (!direct.ok && direct.code === 'network') {
    const alt = await listModelsViaTavern(api, opts);
    if (alt && alt.ok) { res = alt; via = 'tavern-backend'; }
    else if (alt && alt.aborted) return alt.aborted;
    else if (alt) {
      return { ...direct, message: `${direct.message} Запрос через сервер таверны тоже не удался: ${alt.message}` };
    }
  }
  if (!res.ok) return res;
  const models = parseModels(res.data);
  if (!models.length) {
    return { ok: false, code: 'empty-list', message: 'Сервер ответил, но список моделей пуст — впишите имя модели вручную.', status: res.status, detail: '' };
  }
  return via ? { ok: true, models, via } : { ok: true, models };
}

export const TAVERN_STATUS_URL = '/api/backends/chat-completions/status';

async function listModelsViaTavern(api, opts = {}) {
  const c = tavern(opts.ctx);
  if (!c || typeof c.getRequestHeaders !== 'function') return null;
  let headers;
  try { headers = c.getRequestHeaders(); } catch { return null; }
  const base = normalizeBase(api && api.endpoint);
  if (!base) return null;
  const body = {
    chat_completion_source: 'openai',
    reverse_proxy: `${base}/v1`,
    proxy_password: sanitizeApiKey(api && api.key).key,
  };
  const res = await request(TAVERN_STATUS_URL, { method: 'POST', headers, body: JSON.stringify(body) }, {
    timeout: opts.timeout || TIMEOUTS.models,
    signal: opts.signal,
    retry: false,
  });
  if (!res.ok) {
    if (res.code === 'aborted') return { ok: false, aborted: res, message: res.message };
    const why = res.status === 403
      ? 'сервер таверны отказал (403) — обновите страницу таверны и повторите.'
      : (res.status ? `сервер таверны ответил ${res.status}.` : 'сервер таверны не ответил.');
    return { ok: false, message: why };
  }
  const data = res.data;
  if (data && typeof data === 'object' && data.error) {
    return {
      ok: false,
      message: 'сервер таверны до адреса дошёл, но списка не получил — адрес не тот или ключ не принят'
        + ' (подробности в консоли сервера таверны).',
    };
  }
  return { ok: true, data, status: res.status };
}

export async function testConnection(api, opts = {}) {
  if (resolveSource(api) === 'tavern') {
    const res = await tavernComplete(opts.ctx, {
      user: 'ping', maxTokens: budgetOf(opts.maxTokens, TOKEN_BUDGETS.ping), profileId: (api && api.profile) || '',
    });
    if (!res.ok && res.code !== 'empty') return res;
    return { ok: true, message: res.profile ? `Связь есть: профиль «${res.profile}» отвечает.` : 'Связь есть: текущее подключение таверны отвечает.', model: res.profile || '' };
  }
  const url = chatUrl(api && api.endpoint);
  if (!url) {
    return { ok: false, code: 'no-endpoint', message: 'Адрес не задан: вписать endpoint.', status: null, detail: '' };
  }
  const model = (api && api.model) || '';
  if (!model) {
    return { ok: false, code: 'no-model', message: 'Модель не выбрана: возьмите её из списка или впишите вручную.', status: null, detail: '' };
  }
  const bad = keyProblem(api);
  if (bad) return bad;
  const body = {
    model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
    temperature: 0,
  };
  const res = await request(url, { method: 'POST', headers: headersFor(api), body: JSON.stringify(body) }, {
    timeout: opts.timeout || TIMEOUTS.test,
    signal: opts.signal,
    model,
    retry: false,
  });
  if (!res.ok) return res;
  return { ok: true, message: `Связь есть: ${model} отвечает.`, model };
}

const BLANKS = [String.fromCharCode(0x200b), String.fromCharCode(0x200c)];

export function cacheMark(len = 24) {
  let out = '';
  for (let k = 0; k < len; k += 1) out += BLANKS[Math.floor(Math.random() * BLANKS.length)];
  return out;
}

export const withMark = (text) => `${text}${cacheMark()}`;

export function endMissing(text, mark) {
  return Boolean(mark) && !String(text == null ? '' : text).includes(mark);
}

function closed(res, mark) {
  return res && res.ok && endMissing(res.text, mark) ? { ...res, truncated: true, endMissing: true } : res;
}

export const wholeChars = (s) => String(s).replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');

export async function complete(api, req = {}) {
  return closed(await completeOnce(api, req), req.endMark);
}

async function completeOnce(api, req) {
  const system = wholeChars(req.system || '');
  const user = req.again ? withMark(wholeChars(req.user || '')) : wholeChars(req.user || '');
  const { ctx, signal } = req;
  const url = chatUrl(api && api.endpoint);
  const source = resolveSource(api);

  if (source === 'endpoint' && !(url && api && api.model)) {
    return {
      ok: false,
      code: 'no-endpoint',
      status: null,
      detail: '',
      message: url
        ? 'Выбран свой адрес, но модель не выбрана: возьмите её из списка или впишите вручную.'
        : 'Выбран свой адрес, но он не вписан.',
    };
  }

  if (source === 'endpoint') {
    const bad = keyProblem(api);
    if (bad) return bad;
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: user });
    const budget = budgetOf(req.maxTokens, TOKEN_BUDGETS.default);
    const body = { model: api.model, messages, temperature: req.temperature ?? 0.7, max_tokens: budget };
    const res = await request(url, { method: 'POST', headers: headersFor(api), body: JSON.stringify(body) }, {
      timeout: req.timeout || TIMEOUTS.complete,
      signal,
      model: api.model,
    });
    if (!res.ok) return res;
    const text = parseCompletion(res.data);
    if (!text.trim()) {
      return {
        ok: false, code: 'empty', status: res.status, detail: res.raw ? String(res.raw).slice(0, 400) : '',
        message: 'Модель вернула пустой ответ.',
      };
    }
    return { ok: true, text, via: 'endpoint', budget, truncated: isTruncated(res.data, text) };
  }

  return tavernComplete(ctx, {
    system, user, maxTokens: budgetOf(req.maxTokens, TOKEN_BUDGETS.default), profileId: (api && api.profile) || '',
    timeout: req.timeout, signal,
  });
}

export async function generatePlan(survey, preset, api, ctx, opts = {}) {
  const { system, prompt } = buildPlanPrompt(survey, preset, { lore: opts.lore });
  let last = { error: 'не было попыток', code: 'none', raw: '', errors: [] };
  let made = 0;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    made = attempt;
    const res = await complete(api, {
      system,
      user: attempt === 1 ? prompt : `${prompt}\n\nПредыдущий ответ не разобрался. Верни только JSON.`,
      ctx,
      signal: opts.signal,
      timeout: opts.timeout,
      maxTokens: budgetOf(opts.maxTokens, TOKEN_BUDGETS.plan),
    });

    if (!res.ok) {
      last = { error: res.message, code: res.code, raw: res.detail || '', errors: [res.code] };
      break;
    }

    const parsed = parsePlanResponse(res.text, preset, { salvage: res.truncated === true, canon: survey && survey.canon });
    const checked = validatePlan(parsed.plan, preset);
    if (parsed.ok && checked.ok && !parsed.partial) {
      return {
        ok: true,
        plan: checked.plan,
        errors: [...new Set([...parsed.errors, ...checked.errors])],
        raw: parsed.raw,
        attempts: attempt,
        via: res.via,
      };
    }
    if (res.truncated) {
      if (parsed.partial && parsed.ok && checked.ok) {
        return {
          ok: true,
          partial: true,
          plan: checked.plan,
          notice: `Модель не договорила — вот что успела: ${subjectsCount(checked.plan.subjects.length, preset)}.`
            + ' Можно дописать руками в таблице ниже или собрать план ещё раз.',
          errors: [...new Set([...parsed.errors, ...checked.errors, 'truncated'])],
          raw: parsed.raw,
          attempts: attempt,
          via: res.via,
        };
      }
      last = {
        error: `Модель не договорила, и ${planWord(preset)} из её ответа собрать не вышло.`
          + ' Нажмите кнопку генерации ещё раз. Таблицу ниже можно заполнить вручную.',
        code: 'truncated',
        raw: parsed.raw,
        errors: [...new Set([...parsed.errors, ...checked.errors, 'truncated'])],
      };
      break;
    }
    last = {
      error: 'Ответ модели не разобрался. Таблицу ниже можно заполнить вручную.',
      code: 'parse',
      raw: parsed.raw,
      errors: [...new Set([...parsed.errors, ...checked.errors])],
    };
  }

  return { ok: false, ...last, attempts: made };
}

export const CARD_LIMITS = { field: 1200, firstMessage: 1500 };

export const DEFAULT_SURVEY_PROMPT = {
  system: 'Ты читаешь карточку персонажа ролевой игры и заполняешь анкету учебного заведения.'
    + ' Отвечай одним объектом JSON и ничем больше: без пояснений, без markdown, без комментариев.'
    + ' Чего в тексте нет — оставляй пустой строкой: пустое поле лучше выдумки.',
  user: [
    'Прочитай карточку персонажа и первое сообщение и предположи, где и когда учится главный герой.',
    'Имя персонажа: {name}.',
    'Карточка:',
    '{card}',
    'Первое сообщение:',
    '{firstMessage}',
    'Заполни шесть полей:',
    'era — эпоха или сеттинг (современность, фэнтези, киберпанк, 1980-е);',
    'country — страна или традиция (Россия, Япония, Британия, выдуманная);',
    'institution — тип заведения (школа, колледж, вуз, магическая академия);',
    'faculty — направление или факультет;',
    'year — курс или год обучения;',
    'lang — язык названий и имён, по умолчанию {lang}.',
    'Если чего-то в тексте нет — оставь поле пустым. Не выдумывай и не переспрашивай.',
    'Формат ответа:',
    '{"era":"","country":"","institution":"","faculty":"","year":"","lang":"{lang}"}',
  ].join('\n'),
};

export const SURVEY_KEYS = Object.keys(emptySurvey());

const SURVEY_ALIASES = {
  era: ['era', 'setting', 'epoch', 'period', 'time', 'эпоха', 'сеттинг'],
  country: ['country', 'tradition', 'region', 'nation', 'страна'],
  institution: ['institution', 'school', 'schoolType', 'institutionType', 'type', 'заведение'],
  faculty: ['faculty', 'department', 'direction', 'major', 'field', 'факультет', 'направление'],
  year: ['year', 'grade', 'course', 'yearOfStudy', 'курс', 'год'],
  canon: ['canon', 'fandom', 'franchise', 'source', 'канон', 'фандом'],
  lang: ['lang', 'language', 'locale', 'язык'],
};

const EMPTY_WORDS = new Set(['', '-', '—', '?', 'n/a', 'na', 'null', 'none', 'unknown', 'unspecified',
  'неизвестно', 'не указано', 'не указан', 'не указана', 'нет данных', 'не определено', 'нет']);

const cardStr = (v) => (v == null ? '' : String(v)).trim();

function cut(s, limit) {
  const t = cardStr(s);
  return t.length > limit ? `${t.slice(0, limit).trim()}…` : t;
}

export function firstCharacterMessage(ctx) {
  const c = tavern(ctx);
  const chat = c && Array.isArray(c.chat) ? c.chat : [];
  for (const m of chat) {
    if (!m || m.is_user || m.is_system) continue;
    const text = cardStr(m.mes);
    if (text) return text;
  }
  return '';
}

export function readCharacterCard(ctx) {
  const c = tavern(ctx);
  if (!c) {
    return { ok: false, code: 'no-context', message: 'Контекст SillyTavern недоступен: карточку неоткуда взять.' };
  }

  let fields = null;
  if (typeof c.getCharacterCardFields === 'function') {
    try { fields = c.getCharacterCardFields(); } catch { fields = null; }
  }
  const chars = Array.isArray(c.characters) ? c.characters : [];
  const chid = c.characterId;
  const char = (chid !== null && chid !== undefined && chars[chid]) || null;
  const f = fields || {};

  const card = {
    name: cardStr(c.name2) || cardStr(char && char.name),
    description: cut(f.description || (char && char.description), CARD_LIMITS.field),
    personality: cut(f.personality || (char && char.personality), CARD_LIMITS.field),
    scenario: cut(f.scenario || (char && char.scenario), CARD_LIMITS.field),
    creatorNotes: cut(f.creatorNotes || (char && char.data && char.data.creator_notes), CARD_LIMITS.field),
    firstMessage: cut(firstCharacterMessage(c) || f.firstMessage || (char && char.first_mes), CARD_LIMITS.firstMessage),
  };

  const hasCardText = Boolean(card.description || card.personality || card.scenario || card.creatorNotes);
  if (!hasCardText && !card.firstMessage) {
    if (!char && c.groupId) {
      return {
        ok: false,
        code: 'group',
        message: 'Это групповой чат, и общей карточки в нём нет: заполните анкету вручную.',
      };
    }
    if (!char) {
      return { ok: false, code: 'no-character', message: 'Персонаж не выбран: расширению нечего читать.' };
    }
    return {
      ok: false,
      code: 'empty-card',
      message: `Карточка «${card.name || 'без имени'}» пуста: ни описания, ни сценария, ни первого сообщения.`
        + ' Угадывать не по чему — заполните анкету вручную.',
    };
  }

  const warnings = [];
  if (!card.firstMessage) warnings.push('первого сообщения нет: предположение построено только по карточке');
  if (!hasCardText) warnings.push('карточка пуста: предположение построено только по первому сообщению');
  return { ok: true, card, warnings };
}

export function cardToText(card) {
  const c = card || {};
  const parts = [];
  if (c.description) parts.push(`Описание: ${c.description}`);
  if (c.personality) parts.push(`Характер: ${c.personality}`);
  if (c.scenario) parts.push(`Сценарий: ${c.scenario}`);
  if (c.creatorNotes) parts.push(`Заметки автора: ${c.creatorNotes}`);
  return parts.join('\n') || '(карточка пуста)';
}

export function buildSurveyPrompt(card, preset, books = [], player = {}) {
  const tpl = { ...DEFAULT_SURVEY_PROMPT, ...((preset && preset.prompts && preset.prompts.survey) || {}) };
  const vars = {
    name: cardStr(card && card.name) || 'без имени',
    card: cardToText(card),
    firstMessage: cardStr(card && card.firstMessage) || '(первого сообщения нет)',
    lang: cardStr(preset && preset.lang) || 'ru',
  };
  const names = (Array.isArray(books) ? books : []).map(cardStr).filter(Boolean);
  const extra = [SURVEY_CANON_HINT];
  if (names.length) extra.push(`Подключённые лорбуки: ${names.join(', ')}.`);
  const heroine = cardStr(player && player.heroine);
  extra.push(SURVEY_HEROINE_HINT.replace('{heroine}', heroine ? `«${heroine}»` : 'игрока'));
  const persona = cardStr(player && player.persona);
  if (persona) extra.push(`Персона героини${heroine ? ` (${heroine})` : ''}:\n${persona}`);
  return { system: fill(tpl.system, vars), prompt: `${fill(tpl.user, vars)}\n${extra.join('\n')}` };
}

const SURVEY_HEROINE_HINT = 'Анкета описывает учёбу героини {heroine} (персонаж игрока), а не персонажа карточки: факультет, направление и курс бери из её персоны'
  + ' или из первых сообщений, где о них сказано про неё. Если про героиню не сказано, оставь faculty и year пустыми — факультет персонажа карточки ей не приписывай.'
  + ' Для известного произведения эпоха и страна — из него и его канона («Англия, 1813», «Северное королевство»), а не пример из подсказок выше.';

const SURVEY_CANON_HINT = 'Если карточка или первое сообщение явно взяты из известного произведения (книга, аниме, игра, сериал),'
  + ' впиши в поле canon его название по-русски и, если видно, учебный год, сезон или часть:'
  + ' «Гордость и предубеждение», «Ведьмак, 1 сезон». Мир свой или уверенности нет — пустая строка.';

let charLoreSource = null;
export async function warmCharLore() {
  try {
    const mod = await import('../../../world-info.js');
    charLoreSource = mod && mod.world_info ? mod.world_info : null;
  } catch {}
}

export function extraBookNames(ctx) {
  const out = [];
  try {
    const c = tavern(ctx) || {};
    const chars = Array.isArray(c.characters) ? c.characters : [];
    const char = c.characterId !== null && c.characterId !== undefined ? chars[c.characterId] : null;
    const avatar = cardStr(char && char.avatar);
    if (!avatar) return out;
    const bare = avatar.replace(/\.[^./]+$/, '');
    const lore = [c.world_info, c.worldInfoSettings, charLoreSource].map((w) => w && w.charLore).find(Array.isArray) || [];
    for (const e of lore) {
      const name = cardStr(e && e.name);
      if (!name || (name !== avatar && name !== bare)) continue;
      for (const b of Array.isArray(e.extraBooks) ? e.extraBooks : []) {
        const book = cardStr(b);
        if (book && !out.includes(book)) out.push(book);
      }
    }
  } catch {}
  return out;
}

export function activeBookNames(ctx) {
  const c = tavern(ctx) || {};
  const out = [];
  const add = (v) => {
    const name = cardStr(v);
    if (!name || name.startsWith('Академия — ') || name.startsWith('Academy ')) return;
    if (!out.includes(name)) out.push(name);
  };
  try {
    add(c.chatMetadata && c.chatMetadata.world_info);
    const chars = Array.isArray(c.characters) ? c.characters : [];
    const char = c.characterId !== null && c.characterId !== undefined ? chars[c.characterId] : null;
    const data = (char && char.data) || {};
    add(data.extensions && data.extensions.world);
    add(data.character_book && data.character_book.name);
  } catch {}
  extraBookNames(ctx).forEach(add);
  return out;
}

function surveyValue(v, limit = 80) {
  if (v == null) return '';
  if (Array.isArray(v)) {
    return surveyValue(v.map((x) => surveyValue(x, limit)).filter(Boolean).join(', '), limit);
  }
  if (typeof v === 'object') return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (EMPTY_WORDS.has(s.toLowerCase().replace(/[.!]+$/, ''))) return '';
  return s.length > limit ? `${s.slice(0, limit).trim()}…` : s;
}

function blankSurvey(preset) {
  const s = emptySurvey();
  const lang = cardStr(preset && preset.lang);
  if (lang) s.lang = lang;
  return s;
}

export function parseSurveyResponse(text, preset) {
  const raw = typeof text === 'string' ? text : String(text == null ? '' : text);
  const data = extractJson(raw);
  if (data === undefined) {
    return { ok: false, survey: blankSurvey(preset), filled: [], errors: ['no-json'], raw };
  }

  let root = data;
  for (const key of ['survey', 'result', 'data', 'answer']) {
    if (root && !Array.isArray(root) && typeof root === 'object' && root[key] && typeof root[key] === 'object') {
      root = root[key];
    }
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    return { ok: false, survey: blankSurvey(preset), filled: [], errors: ['not-object'], raw };
  }

  const lower = new Map();
  for (const [k, v] of Object.entries(root)) lower.set(String(k).toLowerCase(), v);

  const survey = blankSurvey(preset);
  for (const key of SURVEY_KEYS) {
    for (const alias of SURVEY_ALIASES[key] || [key]) {
      const hit = lower.get(alias.toLowerCase());
      if (hit === undefined) continue;
      const value = surveyValue(hit, key === 'canon' ? CANON_MAX : 80);
      if (value) { survey[key] = value; break; }
    }
  }
  const checked = validateSurveyGuess(survey, preset);
  return { ok: checked.ok, survey: checked.survey, filled: checked.filled, errors: checked.errors, raw };
}

export function validateSurveyGuess(survey, preset) {
  const out = blankSurvey(preset);
  for (const key of SURVEY_KEYS) {
    const v = surveyValue(survey && survey[key], key === 'canon' ? CANON_MAX : 80);
    if (v) out[key] = v;
  }
  const filled = SURVEY_KEYS.filter((k) => k !== 'lang' && out[k]);
  const errors = [];
  for (const key of ['era', 'country', 'institution']) if (!out[key]) errors.push(`no-${key}`);
  if (!filled.length) errors.push('survey-empty');
  return { ok: filled.length > 0, survey: out, filled, errors };
}

export async function guessSurvey(preset, api, ctx, opts = {}) {
  const read = readCharacterCard(ctx);
  if (!read.ok) {
    return { ok: false, code: read.code, error: read.message, errors: [read.code], warnings: [], raw: '', attempts: 0 };
  }
  const warnings = read.warnings;
  const tv = tavern(ctx) || {};
  const persona = String((tv.powerUserSettings && tv.powerUserSettings.persona_description) || '').trim().slice(0, 1500);
  const { system, prompt } = buildSurveyPrompt(read.card, preset, activeBookNames(ctx), { heroine: tv.name1, persona });
  let last = { error: 'не было попыток', code: 'none', raw: '', errors: [] };
  let made = 0;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    made = attempt;
    const res = await complete(api, {
      system,
      user: attempt === 1 ? prompt : `${prompt}\n\nПредыдущий ответ не разобрался. Верни только JSON.`,
      ctx,
      signal: opts.signal,
      timeout: opts.timeout,
      maxTokens: budgetOf(opts.maxTokens, TOKEN_BUDGETS.survey),
    });

    if (!res.ok) {
      last = { error: res.message, code: res.code, raw: res.detail || '', errors: [res.code] };
      break;
    }

    const parsed = parseSurveyResponse(res.text, preset);
    if (parsed.ok) {
      return {
        ok: true,
        survey: parsed.survey,
        filled: parsed.filled,
        errors: parsed.errors,
        warnings,
        raw: parsed.raw,
        attempts: attempt,
        via: res.via,
        card: { name: read.card.name },
      };
    }
    if (res.truncated) {
      last = {
        error: truncatedMessage('анкета пришла наполовину', 'Поля анкеты можно заполнить вручную.'),
        code: 'truncated',
        raw: parsed.raw,
        errors: [...new Set([...parsed.errors, 'truncated'])],
      };
      break;
    }
    last = {
      error: 'Ответ модели не разобрался в анкету.',
      code: 'parse',
      raw: parsed.raw,
      errors: parsed.errors,
    };
  }

  return { ok: false, ...last, warnings, attempts: made };
}

export async function guessCardCast(preset, api, ctx, opts = {}) {
  const read = readCharacterCard(ctx);
  if (!read.ok) return { ok: false, code: read.code, error: read.message, raw: '' };
  const text = [cardToText(read.card), read.card.firstMessage ? `Первое сообщение: ${read.card.firstMessage}` : '']
    .filter(Boolean).join('\n');
  const { system, user } = buildCastPrompt(text, { title: read.card.name, lang: preset && preset.lang });
  let last = { code: 'parse', error: 'Не удалось собрать список из ответа модели.', raw: '' };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const res = await complete(api, {
      system,
      user: attempt === 1 ? user : `${user}\n\nПредыдущий ответ не разобрался. Верни только JSON.`,
      ctx,
      signal: opts.signal,
      timeout: opts.timeout,
      maxTokens: budgetOf(opts.maxTokens, TOKEN_BUDGETS.cast),
    });
    if (!res.ok) return { ok: false, code: res.code, error: res.message, raw: res.detail || '' };
    const data = extractJson(res.text);
    const cast = data === undefined ? null : castFromModel(data);
    if (cast && cast.people.length) return { ok: true, cast, raw: res.text };
    last = {
      code: cast ? 'empty' : 'parse',
      error: cast ? 'Модель не нашла в карточке ни одного имени — впишите персонажа вручную.' : last.error,
      raw: res.text,
    };
    if (cast || res.truncated) break;
  }
  return { ok: false, ...last };
}

export async function loadLoreEntries(ctx, loadBook, only) {
  const names = Array.isArray(only) ? only : activeBookNames(ctx);
  const c = tavern(ctx) || {};
  const char = Array.isArray(c.characters) && c.characterId != null ? c.characters[c.characterId] : null;
  const embedded = char && char.data && char.data.character_book;
  const entries = [], books = [];
  for (const name of names) {
    let book = null;
    try {
      book = embedded && cardStr(embedded.name) === name ? embedded
        : typeof loadBook === 'function' ? await loadBook(name) : null;
    } catch {}
    const list = bookEntries(book, name);
    if (list.length) { books.push(name); entries.push(...list); }
  }
  return { entries, books, names };
}

export async function findLorePeople(preset, api, ctx, opts = {}) {
  const { entries, books, names } = await loadLoreEntries(ctx, opts.loadBook, opts.books);
  if (!names.length) return { ok: false, code: 'no-books', error: 'К чату не подключено ни одной книги мира. Подключите её в таверне: книга мира чата или персонажа.' };
  if (!entries.length) return { ok: false, code: 'no-books', error: 'Подключённые книги мира пусты или не читаются.' };
  const kept = prefilterPeople(entries, { stop: opts.stop });
  const people = [], seen = new Set();
  const batches = splitBatches(kept, 15000);
  let failed = 0;
  for (const batch of batches) {
    const { system, user } = buildLorePeoplePrompt(batch, { survey: opts.survey, heroName: opts.heroName, lang: preset && preset.lang, preset });
    let found = null;
    for (let attempt = 1; attempt <= 2 && !found; attempt += 1) {
      const res = await complete(api, {
        system,
        user: attempt === 1 ? user : `${user}

Предыдущий ответ не разобрался. Верни только JSON.`,
        ctx,
        signal: opts.signal,
        timeout: opts.timeout,
        maxTokens: budgetOf(opts.maxTokens, TOKEN_BUDGETS.lorePeople),
      });
      if (!res.ok) return { ok: false, code: res.code, error: res.message };
      const data = extractJson(res.text);
      if (data !== undefined) found = parseLorePeople(res.text, batch);
      else if (res.truncated) break;
    }
    if (!found) failed += 1;
    for (const p of found || []) {
      const key = JSON.stringify([p.lorebook.book, p.lorebook.uid]);
      if (!seen.has(key)) { seen.add(key); people.push(p); }
    }
  }
  if (failed && !people.length) {
    return { ok: false, code: 'parse', error: `Модель не договорила: не разобралась ни одна из ${batches.length} порций. Попробуйте ещё раз.` };
  }
  return { ok: true, people, books, scanned: entries.length, kept: kept.length, batches: batches.length, failed };
}

export async function findCanonCourse(state, preset, api, ctx, opts = {}) {
  if (!state || !state.survey || !String(state.survey.canon || '').trim()) {
    return { ok: false, code: 'no-canon', error: 'В анкете не указан фандом: нечего звать из канона.' };
  }
  const { system, user } = buildCanonCoursePrompt(state, preset, opts);
  let last = { code: 'parse', error: 'Ответ модели не разобрался в список людей.', raw: '' };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const res = await complete(api, {
      system,
      user: attempt === 1 ? user : `${user}

Предыдущий ответ не разобрался. Верни только JSON.`,
      ctx,
      signal: opts.signal,
      timeout: opts.timeout,
      maxTokens: budgetOf(opts.maxTokens, TOKEN_BUDGETS.canonCourse),
    });
    if (!res.ok) return { ok: false, code: res.code, error: res.message };
    const people = parseCanonCourse(res.text);
    if (people) return { ok: true, people: people.slice(0, opts.count > 0 ? opts.count : people.length), raw: res.text };
    last = { ...last, raw: res.text };
    if (res.truncated) break;
  }
  return { ok: false, ...last };
}

export async function generateCanonLayer(preset, state, api, ctx, opts = {}) {
  if (!state || !state.survey || !String(state.survey.canon || '').trim()) {
    return { ok: false, code: 'no-canon', error: 'В анкете не указан фандом: нечего переписывать.' };
  }
  const targets = canonLayerTargets(preset, undefined, state.canonVocab);
  const { system, user } = buildCanonLayerPrompt(targets, {
    survey: state.survey, vocab: state.canonVocab, preset, male: opts.male === true,
  });
  let last = { code: 'parse', error: 'Ответ модели не разобрался в слой канона.', raw: '' };
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const res = await complete(api, {
      system,
      user: attempt === 1 ? user : `${user}

Предыдущий ответ не разобрался. Верни только JSON.`,
      ctx,
      signal: opts.signal,
      timeout: opts.timeout,
      maxTokens: budgetOf(opts.maxTokens, TOKEN_BUDGETS.canonLayer),
    });
    if (!res.ok) return { ok: false, code: res.code, error: res.message };
    const layer = parseCanonLayer(res.text, targets);
    if (layer) return { ok: true, layer, count: Object.keys(layer.ui || {}).length, raw: res.text };
    last = { ...last, raw: res.text };
    if (res.truncated) break;
  }
  return { ok: false, ...last };
}

export async function generateFeedCast(input, api, ctx, opts = {}) {
  const ask = typeof opts.ask === 'function' ? opts.ask : async (prompt, how = {}) => {
    const res = await complete(api, {
      system: prompt.system,
      user: prompt.user,
      ctx,
      signal: opts.signal,
      timeout: opts.timeout,
      endMark: END_MARK,
      again: how.again === true,
      temperature: 0.9,
      maxTokens: budgetOf(opts.maxTokens, TOKEN_BUDGETS.feedCast),
    });
    return res.ok ? { ok: true, text: res.text, truncated: res.truncated === true } : { ok: false, code: res.code, message: res.message };
  };
  return assembleCast(input, ask);
}

export async function generateHeroineTemper(input, api, ctx, opts = {}) {
  return (await generateCastProfile(input, api, ctx, opts)).temper;
}

export async function generateCastProfile(input, api, ctx, opts = {}) {
  const prompt = buildTemperPrompt(input);
  const res = typeof opts.ask === 'function' ? await opts.ask(prompt) : await complete(api, {
    system: prompt.system, user: prompt.user, ctx, signal: opts.signal, timeout: opts.timeout, temperature: 0.5, maxTokens: budgetOf(opts.maxTokens, TOKEN_BUDGETS.temper),
  });
  const i = input || {};
  return res && res.ok && res.truncated !== true
    ? parseTemperReply(res.text, { heroine: i.heroine, charNames: [i.charName, ...(i.mainNames || [])].filter(Boolean) })
    : { temper: '', role: '' };
}

export async function generateBullyPick(state, preset, api, ctx, opts = {}) {
  const ask = typeof opts.ask === 'function' ? opts.ask : async (prompt) => {
    const res = await complete(api, {
      system: prompt.system,
      user: prompt.user,
      ctx,
      signal: opts.signal,
      timeout: opts.timeout,
      temperature: 0.7,
      maxTokens: budgetOf(opts.maxTokens, TOKEN_BUDGETS.bullyPick),
    });
    return res.ok ? { ok: true, text: res.text, truncated: res.truncated === true } : { ok: false, code: res.code, message: res.message };
  };
  return pickBully(state, preset, ask, opts);
}

export async function generateMolva(prompt, api, ctx, opts = {}) {
  const res = typeof opts.ask === 'function'
    ? await opts.ask(prompt)
    : await complete(api, {
      system: prompt.system,
      user: prompt.user,
      ctx,
      signal: opts.signal,
      timeout: opts.timeout,
      temperature: 0.95,
      endMark: END_MARK,
      maxTokens: budgetOf(opts.maxTokens, TOKEN_BUDGETS.molva),
    });
  if (!res || !res.ok) return { ok: false, code: (res && res.code) || 'api', error: (res && (res.message || res.error)) || 'запрос не удался' };
  return { ok: true, text: String(res.text || ''), truncated: res.truncated === true, ...(res.endMissing === true ? { endMissing: true } : {}) };
}

export async function generateLoreEnglish(items, api, ctx, opts = {}) {
  const ask = typeof opts.ask === 'function' ? opts.ask : async (prompt) => {
    const res = await complete(api, {
      system: prompt.system,
      user: prompt.user,
      ctx,
      signal: opts.signal,
      timeout: opts.timeout,
      temperature: 0.2,
      maxTokens: budgetOf(opts.maxTokens, TOKEN_BUDGETS.loreEnglish),
    });
    return res.ok ? { ok: true, text: res.text, truncated: res.truncated === true } : { ok: false, code: res.code, message: res.message };
  };
  return translateAll(items, ask, { userName: opts.userName, charNames: opts.charNames, chat: opts.chat, spellings: opts.spellings });
}

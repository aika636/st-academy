import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  normalizeBase, chatUrl, modelsUrl, hasOwnEndpoint, parseCompletion, parseModels,
  classifyError, errorDetail, headersFor, complete, listModels, testConnection, generatePlan,
  resolveSource, tavernComplete, withoutForeignInjections,
  setFetch, setContextProvider,
  TOKEN_BUDGETS, finishReason, isTruncatedReason, looksTruncated, truncatedMessage,
  DEFAULT_SURVEY_PROMPT, SURVEY_KEYS, readCharacterCard, firstCharacterMessage, cardToText,
  buildSurveyPrompt, parseSurveyResponse, validateSurveyGuess, guessSurvey,
  sanitizeApiKey, keyProblem, escapeMacros, setSleep, RETRY, isRetryableStatus, TAVERN_STATUS_URL,
} from '../api.js';
import { emptySurvey } from '../core/state.mjs';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));

const survey = { era: 'современность', country: 'Россия', institution: 'вуз', faculty: 'химфак', year: '2-й', lang: 'ru' };
const api = { endpoint: 'https://x.y/v1', key: 'sk-1', model: 'glm-4' };

/** Ответ-заглушка вместо fetch. */
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const planJson = JSON.stringify({
  subjects: [{ id: 'chemistry', name: 'Химия', teacherId: 'petrova' }],
  teachers: [{ id: 'petrova', name: 'Петрова Анна', traits: ['злопамятна'] }],
});

const chatReply = (text) => reply(200, { choices: [{ message: { role: 'assistant', content: text } }] });

test.afterEach(() => { setFetch(null); setContextProvider(null); setSleep(null); });

// --- нормализация адреса -----------------------------------------------------

test('три формы адреса сводятся к одной базе', () => {
  for (const v of ['https://x.y', 'https://x.y/', 'https://x.y/v1', 'https://x.y/v1/',
    'https://x.y/v1/chat/completions', 'https://x.y/v1/models', 'https://x.y/v1/chat/completions/']) {
    assert.equal(normalizeBase(v), 'https://x.y', v);
  }
  assert.equal(chatUrl('https://x.y/v1/chat/completions'), 'https://x.y/v1/chat/completions');
  assert.equal(modelsUrl('https://x.y'), 'https://x.y/v1/models');
});

test('путь до /v1 сохраняется', () => {
  assert.equal(chatUrl('https://x.y/api/openai/v1'), 'https://x.y/api/openai/v1/chat/completions');
  assert.equal(chatUrl('https://x.y/api'), 'https://x.y/api/v1/chat/completions');
});

test('схема угадывается: локалка по http, остальное по https', () => {
  assert.equal(chatUrl('localhost:5001'), 'http://localhost:5001/v1/chat/completions');
  assert.equal(chatUrl('127.0.0.1:8080/v1'), 'http://127.0.0.1:8080/v1/chat/completions');
  assert.equal(chatUrl('api.openai.com'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(chatUrl('http://x.y'), 'http://x.y/v1/chat/completions');
});

test('мусор вокруг адреса срезается, пустой адрес остаётся пустым', () => {
  assert.equal(normalizeBase('  "https://x.y/v1"  '), 'https://x.y');
  assert.equal(normalizeBase('https://x.y/v1?key=1#frag'), 'https://x.y');
  assert.equal(normalizeBase(''), '');
  assert.equal(normalizeBase(null), '');
  assert.equal(chatUrl(''), '');
  assert.equal(hasOwnEndpoint({ endpoint: '' }), false);
  assert.equal(hasOwnEndpoint({ endpoint: 'x.y' }), true);
});

test('ключ уходит только заголовком Bearer и только когда он есть', () => {
  assert.deepEqual(headersFor({ key: ' sk-1 ' }), { 'Content-Type': 'application/json', Authorization: 'Bearer sk-1' });
  assert.deepEqual(headersFor({}), { 'Content-Type': 'application/json' });
});

// --- разбор ответа -----------------------------------------------------------

test('разбор ответа терпит все известные формы', () => {
  assert.equal(parseCompletion({ choices: [{ message: { content: 'A' } }] }), 'A');
  assert.equal(parseCompletion({ choices: [{ text: 'B' }] }), 'B');
  assert.equal(parseCompletion({ response: 'C' }), 'C');
  assert.equal(parseCompletion({ content: 'D' }), 'D');
  assert.equal(parseCompletion({ text: 'E' }), 'E');
  assert.equal(parseCompletion({ message: { content: 'F' } }), 'F');
  // Куски контента массивом — так отвечают часть совместимых серверов.
  assert.equal(parseCompletion({ choices: [{ message: { content: [{ type: 'text', text: 'G' }, { text: 'H' }] } }] }), 'GH');
  assert.equal(parseCompletion('строка как есть'), 'строка как есть');
  assert.equal(parseCompletion(null), '');
  assert.equal(parseCompletion({}), '');
  assert.equal(parseCompletion({ choices: [] }), '');
});

test('список моделей разбирается из data[].id и из голого массива', () => {
  assert.deepEqual(parseModels({ data: [{ id: 'a' }, { id: 'b' }, { id: 'a' }] }), ['a', 'b']);
  assert.deepEqual(parseModels(['a', 'b']), ['a', 'b']);
  assert.deepEqual(parseModels({ models: [{ name: 'c' }] }), ['c']);
  assert.deepEqual(parseModels(null), []);
});

// --- классификация ошибок ----------------------------------------------------

test('ошибки различаются по причине, а не по «что-то пошло не так»', () => {
  assert.equal(classifyError({ error: new TypeError('Failed to fetch'), url: 'https://x.y' }).code, 'network');
  assert.equal(classifyError({ status: 401 }).code, 'auth');
  assert.equal(classifyError({ status: 403 }).code, 'auth');
  assert.equal(classifyError({ status: 404, body: { error: { message: 'not found' } } }).code, 'not-found');
  assert.equal(classifyError({ status: 404, body: { error: { message: 'The model `x` does not exist' } } }).code, 'model');
  assert.equal(classifyError({ status: 400, body: { error: { message: 'unknown model' } } }).code, 'model');
  assert.equal(classifyError({ status: 400, body: 'bad json' }).code, 'bad-request');
  assert.equal(classifyError({ status: 429 }).code, 'rate');
  assert.equal(classifyError({ status: 503 }).code, 'server');
  assert.equal(classifyError({ status: 418 }).code, 'http');
});

test('таймаут и отмена — разные вещи', () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  assert.equal(classifyError({ error: abort }).code, 'aborted');
  const timeout = Object.assign(new Error('aborted'), { name: 'AbortError', timeout: true });
  assert.equal(classifyError({ error: timeout }).code, 'timeout');
});

test('сетевая ошибка называет и недоступность, и CORS: браузер их не различает', () => {
  const m = classifyError({ error: new TypeError('Failed to fetch'), url: 'https://x.y/v1/chat/completions' }).message;
  assert.ok(/CORS/.test(m), m);
  assert.ok(m.includes('https://x.y/v1/chat/completions'), m);
});

test('текст ошибки достаётся из всех обычных форм тела', () => {
  assert.equal(errorDetail({ error: { message: 'm' } }), 'm');
  assert.equal(errorDetail({ error: 'e' }), 'e');
  assert.equal(errorDetail({ message: 'x' }), 'x');
  assert.equal(errorDetail('plain'), 'plain');
  assert.equal(errorDetail(null), '');
});

// --- сеть с подменённым fetch ------------------------------------------------

test('complete ходит на нормализованный адрес и возвращает текст', async () => {
  let seen = null;
  setFetch(async (url, init) => { seen = { url, init }; return chatReply('привет'); });
  const res = await complete({ ...api, endpoint: 'x.y' }, { system: 'S', user: 'U' });
  assert.deepEqual(res, { ok: true, text: 'привет', via: 'endpoint', budget: TOKEN_BUDGETS.default, truncated: false });
  assert.equal(seen.url, 'https://x.y/v1/chat/completions');
  assert.equal(seen.init.headers.Authorization, 'Bearer sk-1');
  const body = JSON.parse(seen.init.body);
  assert.equal(body.model, 'glm-4');
  assert.deepEqual(body.messages, [{ role: 'system', content: 'S' }, { role: 'user', content: 'U' }]);
  assert.ok(seen.init.signal, 'запрос без возможности отмены недопустим');
});

test('пустой адрес — запасной путь через generateRaw', async () => {
  let seen = null;
  setFetch(async () => { throw new Error('сеть трогать нельзя'); });
  const ctx = { generateRaw: async (arg) => { seen = arg; return 'из таверны'; } };
  const res = await complete({ endpoint: '', key: '', model: '' }, { system: 'S', user: 'U', ctx });
  assert.deepEqual(res, { ok: true, text: 'из таверны', via: 'tavern', budget: TOKEN_BUDGETS.default, truncated: false });
  assert.deepEqual(seen, { prompt: 'U', systemPrompt: 'S', responseLength: TOKEN_BUDGETS.default });
});

test('generateRaw бросает при пустом ответе — это не падение расширения', async () => {
  const ctx = { generateRaw: async () => { throw new Error('No message generated'); } };
  const res = await complete({}, { user: 'U', ctx });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'tavern');
  assert.ok(res.message.includes('No message generated'));
});

test('контекст таверны берётся лениво, если не передан', async () => {
  setContextProvider(() => ({ generateRaw: async () => 'ok' }));
  const res = await complete({}, { user: 'U' });
  assert.equal(res.text, 'ok');
});

test('пустой ответ своего endpoint — понятная ошибка', async () => {
  setFetch(async () => chatReply('   '));
  const res = await complete(api, { user: 'U' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'empty');
});

test('401 от своего endpoint доезжает до человека словом «ключ»', async () => {
  setFetch(async () => reply(401, { error: { message: 'invalid api key' } }));
  const res = await complete(api, { user: 'U' });
  assert.equal(res.code, 'auth');
  assert.ok(/ключ/i.test(res.message), res.message);
});

test('listModels: адрес, список, пустой список, отсутствие адреса', async () => {
  let url = null;
  setFetch(async (u) => { url = u; return reply(200, { data: [{ id: 'm1' }] }); });
  assert.deepEqual(await listModels(api), { ok: true, models: ['m1'] });
  assert.equal(url, 'https://x.y/v1/models');

  setFetch(async () => reply(200, { data: [] }));
  assert.equal((await listModels(api)).code, 'empty-list');

  // Пустой адрес при явно выбранном своём — «адрес не задан»; без выбора
  // (`auto`) пустой адрес значит подключение таверны, и ответ там другой.
  assert.equal((await listModels({ endpoint: '', source: 'own' })).code, 'no-endpoint');
});

test('testConnection: короткий запрос и понятные отказы', async () => {
  let body = null;
  setFetch(async (u, init) => { body = JSON.parse(init.body); return chatReply('pong'); });
  const ok = await testConnection(api);
  assert.equal(ok.ok, true);
  assert.equal(body.max_tokens, 1);

  assert.equal((await testConnection({ endpoint: '', model: 'm' })).code, 'no-endpoint');
  assert.equal((await testConnection({ endpoint: 'x.y', model: '' })).code, 'no-model');

  setFetch(async () => { throw new TypeError('Failed to fetch'); });
  assert.equal((await testConnection(api)).code, 'network');
});

test('таймаут прерывает висящий запрос', async () => {
  setFetch((url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  const res = await complete(api, { user: 'U', timeout: 20 });
  assert.equal(res.code, 'timeout');
});

test('внешняя отмена работает и отличается от таймаута', async () => {
  const ctl = new AbortController();
  setFetch((url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    setTimeout(() => ctl.abort(), 5);
  }));
  const res = await complete(api, { user: 'U', signal: ctl.signal });
  assert.equal(res.code, 'aborted');
});

// --- генерация плана ---------------------------------------------------------

test('план генерируется одним вызовом и проходит схему', async () => {
  let calls = 0;
  setFetch(async () => { calls += 1; return chatReply('Вот план:\n```json\n' + planJson + '\n```'); });
  const res = await generatePlan(survey, preset, api, null);
  assert.equal(res.ok, true);
  assert.equal(calls, 1, 'план генерируется ровно одним вызовом');
  assert.equal(res.attempts, 1);
  assert.deepEqual(res.plan.subjects.map((s) => s.id), ['chemistry']);
  assert.deepEqual(res.plan.teachers.map((t) => t.id), ['petrova']);
});

test('ровно один автоматический повтор при неразобранном ответе', async () => {
  let calls = 0;
  setFetch(async () => { calls += 1; return chatReply(calls === 1 ? 'извините, не понял' : planJson); });
  const res = await generatePlan(survey, preset, api, null);
  assert.equal(res.ok, true);
  assert.equal(calls, 2);
  assert.equal(res.attempts, 2);
});

test('после второго провала — сырой ответ и ошибка, без третьей попытки', async () => {
  let calls = 0;
  setFetch(async () => { calls += 1; return chatReply('никакого JSON'); });
  const res = await generatePlan(survey, preset, api, null);
  assert.equal(res.ok, false);
  assert.equal(calls, 2, 'третьей попытки быть не должно');
  assert.equal(res.raw, 'никакого JSON', 'сырой ответ показывается человеку');
  assert.ok(res.errors.includes('no-json'));
  assert.equal(res.code, 'parse');
});

test('ошибка настроек повтора не заслуживает', async () => {
  let calls = 0;
  setFetch(async () => { calls += 1; return reply(401, { error: { message: 'bad key' } }); });
  const res = await generatePlan(survey, preset, api, null);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'auth');
  assert.equal(calls, 1, 'повтор с тем же неверным ключом бессмыслен');
});

test('сетевой сбой не повторяется (9.1.7) и возвращает понятную ошибку', async () => {
  // Было: один повтор на всё, кроме ошибок настроек. Стало: сеть/CORS не
  // повторяется ни транспортом, ни планом — запрещённое браузером останется
  // запрещённым и через секунду.
  let calls = 0;
  setFetch(async () => { calls += 1; throw new TypeError('Failed to fetch'); });
  const res = await generatePlan(survey, preset, api, null);
  assert.equal(res.ok, false);
  assert.equal(calls, 1);
  assert.equal(res.attempts, 1);
  assert.equal(res.code, 'network');
});

test('план через запасной путь таверны', async () => {
  setFetch(async () => { throw new Error('сеть трогать нельзя'); });
  const ctx = { generateRaw: async () => planJson };
  const res = await generatePlan(survey, preset, { endpoint: '' }, ctx);
  assert.equal(res.ok, true);
  assert.equal(res.via, 'tavern');
});

// --- автозаполнение анкеты по карточке (3.6) ---------------------------------

/**
 * Поддельная таверна с ТЕМИ ЖЕ именами полей, что в `st-context.js:114`:
 * `characters`, `characterId`, `name2`, `chat`, `groupId`. Ошибка в имени дала бы
 * зелёный прогон при мёртвом расширении, поэтому имена списаны с исходника.
 */
function fakeTavern(over = {}) {
  const character = over.character === null ? null : {
    name: 'Аня',
    description: 'Второкурсница медицинского института в Петербурге, 2010-е.',
    personality: 'упрямая, не выносит опозданий',
    scenario: 'Первый день после каникул.',
    first_mes: '*Аня взбегает по лестнице главного корпуса, опаздывая на анатомию.*',
    data: { creator_notes: 'Карточка про учёбу.' },
    ...(over.character || {}),
  };
  return {
    characters: character ? [character] : [],
    characterId: character ? 0 : null,
    groupId: over.groupId === undefined ? null : over.groupId,
    name2: character ? character.name : '',
    chat: over.chat === undefined ? [] : over.chat,
  };
}

const guessJson = JSON.stringify({
  era: 'современность', country: 'Россия', institution: 'вуз',
  faculty: 'медицинский', year: '2-й', lang: 'русский',
});

test('карточка читается по живым именам полей контекста', () => {
  const res = readCharacterCard(fakeTavern());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.card.name, 'Аня');
  assert.ok(res.card.description.includes('медицинского'));
  assert.ok(res.card.personality.includes('упрямая'));
  assert.ok(res.card.creatorNotes.includes('Карточка'));
  assert.ok(res.card.firstMessage.includes('анатомию'));
  assert.deepEqual(res.warnings, []);
});

test('первое сообщение берётся из чата, а не из карточки: там оно настоящее', () => {
  const ctx = fakeTavern({
    chat: [
      { name: 'Аня', is_user: false, is_system: true, mes: 'служебное' },
      { name: 'Вы', is_user: true, is_system: false, mes: 'привет' },
      { name: 'Аня', is_user: false, is_system: false, mes: 'альтернативное приветствие про магию' },
    ],
  });
  assert.equal(firstCharacterMessage(ctx), 'альтернативное приветствие про магию');
  assert.equal(readCharacterCard(ctx).card.firstMessage, 'альтернативное приветствие про магию');
});

test('getCharacterCardFields, если он есть, старше сырых полей карточки', () => {
  const ctx = fakeTavern();
  ctx.getCharacterCardFields = () => ({ description: 'подставленное макросами', personality: '', scenario: '', creatorNotes: '', firstMessage: '' });
  assert.equal(readCharacterCard(ctx).card.description, 'подставленное макросами');
  // Он же бросает на кривом персонаже — падать нельзя, есть запасной путь.
  ctx.getCharacterCardFields = () => { throw new Error('нет персонажа'); };
  assert.ok(readCharacterCard(ctx).card.description.includes('медицинского'));
});

test('нет карточки, нет контекста, пустая карточка, группа — четыре разных отказа', () => {
  const codes = [
    [readCharacterCard(null), 'no-context'],
    [readCharacterCard(fakeTavern({ character: null })), 'no-character'],
    [readCharacterCard(fakeTavern({ character: null, groupId: 'g1' })), 'group'],
    [readCharacterCard(fakeTavern({
      character: { description: '', personality: '', scenario: '', first_mes: '', data: {} },
    })), 'empty-card'],
  ];
  const texts = new Set();
  for (const [res, code] of codes) {
    assert.equal(res.ok, false, code);
    assert.equal(res.code, code);
    assert.ok(res.message.length > 20, code);
    texts.add(res.message);
  }
  assert.equal(texts.size, codes.length, 'четыре случая — четыре текста');
});

test('пустое первое сообщение не отказ, пока есть описание, но об этом сказано', () => {
  const res = readCharacterCard(fakeTavern({ character: { first_mes: '' } }));
  assert.equal(res.ok, true);
  assert.equal(res.card.firstMessage, '');
  assert.ok(res.warnings.some((w) => w.includes('первого сообщения нет')));
});

test('промпт анкеты берётся из пресета, а умолчание живёт в коде', () => {
  const built = buildSurveyPrompt({ name: 'Аня', description: 'вуз', firstMessage: 'привет' }, preset);
  assert.ok(built.prompt.includes('Аня'));
  assert.ok(built.prompt.includes('Описание: вуз'));
  assert.ok(built.prompt.includes('привет'));
  assert.ok(built.prompt.includes(preset.lang), 'язык подставлен из пресета');
  assert.ok(built.system.includes('JSON'));
  assert.equal(built.system, DEFAULT_SURVEY_PROMPT.system);

  const withPreset = { ...preset, prompts: { ...preset.prompts, survey: { system: 'своя система', user: 'своё: {name}' } } };
  const over = buildSurveyPrompt({ name: 'Аня' }, withPreset);
  assert.equal(over.system, 'своя система');
  assert.equal(over.prompt, 'своё: Аня');
});

test('разбор анкеты: шесть полей всегда, синонимы понимаются, «не указано» — пусто', () => {
  const res = parseSurveyResponse('Вот анкета:\n```json\n{"setting":"киберпанк","nation":"Япония",'
    + '"schoolType":"академия","major":"боевая магия","course":2,"language":"ru",}\n```', preset);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(Object.keys(res.survey), SURVEY_KEYS);
  assert.deepEqual(Object.keys(res.survey), Object.keys(emptySurvey()), 'ровно шесть полей из плана');
  assert.equal(res.survey.era, 'киберпанк');
  assert.equal(res.survey.country, 'Япония');
  assert.equal(res.survey.institution, 'академия');
  assert.equal(res.survey.faculty, 'боевая магия');
  assert.equal(res.survey.year, '2');
  assert.equal(res.survey.lang, 'ru');

  // Вежливое «не знаю» — это пустое поле, а не значение формы.
  const shy = parseSurveyResponse('{"era":"фэнтези","country":"не указано","institution":"unknown"}', preset);
  assert.equal(shy.survey.country, '');
  assert.equal(shy.survey.institution, '');
  assert.deepEqual(shy.filled, ['era']);
  assert.ok(shy.errors.includes('no-country'));
  assert.equal(shy.ok, true, 'одно поле — уже польза: человек допишет остальное');
});

test('разбор анкеты терпит обёртку, массив и абзац вместо значения', () => {
  const wrapped = parseSurveyResponse('{"survey":{"era":"1980-е","country":["СССР","Россия"],"institution":"школа"}}', preset);
  assert.equal(wrapped.ok, true);
  assert.equal(wrapped.survey.era, '1980-е');
  assert.equal(wrapped.survey.country, 'СССР, Россия');

  const wordy = parseSurveyResponse(JSON.stringify({ era: 'ы'.repeat(200), country: 'Россия', institution: 'вуз' }), preset);
  assert.ok(wordy.survey.era.length <= 81, 'абзац в поле формы не влезет — режется');
});

test('мусорный ответ модели — отказ с сырым текстом, а не исключение', () => {
  const res = parseSurveyResponse('Конечно! Скорее всего, она учится в вузе.', preset);
  assert.equal(res.ok, false);
  assert.deepEqual(res.errors.slice(0, 1), ['no-json']);
  assert.equal(res.raw, 'Конечно! Скорее всего, она учится в вузе.');
  assert.deepEqual(Object.keys(res.survey), SURVEY_KEYS, 'даже при отказе форма ответа та же');

  // JSON есть, а полей анкеты в нём нет — тоже отказ, но уже не `no-json`.
  const off = parseSurveyResponse('{"answer":{"нечто":"иное"}}', preset);
  assert.equal(off.ok, false);
  assert.ok(off.errors.includes('survey-empty'));
});

test('validateSurveyGuess: язык один за заполненность не считается', () => {
  const only = validateSurveyGuess({ lang: 'ru' }, preset);
  assert.equal(only.ok, false);
  assert.ok(only.errors.includes('survey-empty'));
  assert.equal(validateSurveyGuess({ institution: 'школа' }, preset).ok, true);
});

test('автоанкета на правдоподобном ответе модели', async () => {
  let sent = null;
  setFetch(async (url, init) => { sent = JSON.parse(init.body); return chatReply(guessJson); });
  const res = await guessSurvey(preset, api, fakeTavern());
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.attempts, 1);
  assert.equal(res.via, 'endpoint');
  assert.deepEqual(res.survey, {
    era: 'современность', country: 'Россия', institution: 'вуз',
    faculty: 'медицинский', year: '2-й', lang: 'русский',
  });
  assert.deepEqual(res.filled, ['era', 'country', 'institution', 'faculty', 'year']);
  assert.equal(res.card.name, 'Аня');
  // Карточка и первое сообщение действительно уехали в запрос.
  assert.ok(sent.messages[1].content.includes('медицинского института'));
  assert.ok(sent.messages[1].content.includes('анатомию'));
});

test('автоанкета через запасной путь таверны', async () => {
  setFetch(async () => { throw new Error('сеть трогать нельзя'); });
  const ctx = { ...fakeTavern(), generateRaw: async () => guessJson };
  const res = await guessSurvey(preset, { endpoint: '' }, ctx);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.via, 'tavern');
});

test('автоанкета на мусорном ответе: один повтор, потом честный отказ', async () => {
  let calls = 0;
  setFetch(async () => { calls += 1; return chatReply('Думаю, она студентка. Точнее сказать не могу.'); });
  const res = await guessSurvey(preset, api, fakeTavern());
  assert.equal(res.ok, false);
  assert.equal(res.code, 'parse');
  assert.equal(calls, 2, 'ровно один автоматический повтор, как у плана');
  assert.equal(res.attempts, 2);
  assert.ok(res.raw.includes('студентка'), 'сырой ответ показывается человеку');
  assert.equal(res.survey, undefined, 'при отказе анкету не выдумываем');
});

test('автоанкета без карточки: отказ до сети, а не исключение', async () => {
  let calls = 0;
  setFetch(async () => { calls += 1; return chatReply(guessJson); });
  const res = await guessSurvey(preset, api, fakeTavern({ character: null }));
  assert.equal(res.ok, false);
  assert.equal(res.code, 'no-character');
  assert.ok(res.error.length > 20);
  assert.equal(calls, 0, 'без карточки ходить к модели не за чем');
  assert.equal(res.attempts, 0);
});

test('автоанкета при отказе API: код и текст те же, что у остальных вызовов', async () => {
  let calls = 0;
  setFetch(async () => { calls += 1; return reply(401, { error: { message: 'bad key' } }); });
  const res = await guessSurvey(preset, api, fakeTavern());
  assert.equal(res.ok, false);
  assert.equal(res.code, 'auth');
  assert.equal(calls, 1, 'повтор с тем же неверным ключом бессмыслен');
  assert.ok(/Ключ не принят/.test(res.error));

  setFetch(async () => { throw new TypeError('Failed to fetch'); });
  const net = await guessSurvey(preset, api, fakeTavern());
  assert.equal(net.code, 'network');
  assert.equal(net.attempts, 1, 'сеть не повторяется (9.1.7)');
});

test('автоанкета ничего не пишет: контекст даёт только чтение', async () => {
  setFetch(async () => chatReply(guessJson));
  const ctx = fakeTavern();
  // Ни метаданных, ни настроек в поддельном контексте нет вовсе: если бы
  // автозаполнение умело писать состояние, оно бы здесь упало.
  assert.equal('chatMetadata' in ctx, false);
  const res = await guessSurvey(preset, api, ctx);
  assert.equal(res.ok, true);
});

// --- графа «актуальный API» --------------------------------------------------

test('источник запроса: умолчание — прежнее правило, выбор — прямой', () => {
  // Старые настройки поля `source` не знают вовсе — и должны работать как до
  // появления графы: адрес вписан значит свой, пустой значит таверна.
  assert.equal(resolveSource({ endpoint: 'https://x.y' }), 'endpoint');
  assert.equal(resolveSource({ endpoint: '' }), 'tavern');
  assert.equal(resolveSource(undefined), 'tavern');
  assert.equal(resolveSource({ endpoint: 'https://x.y', source: 'auto' }), 'endpoint');
  // Выбранное человеком старше вписанного: свой адрес есть, а просили таверну.
  assert.equal(resolveSource({ endpoint: 'https://x.y', source: 'tavern' }), 'tavern');
  assert.equal(resolveSource({ endpoint: '', source: 'own' }), 'endpoint');
  // Незнакомое значение — не повод падать: правило прежнее.
  assert.equal(resolveSource({ endpoint: 'https://x.y', source: 'нечто' }), 'endpoint');
});

test('выбран актуальный API — запрос идёт в таверну, а не на вписанный адрес', async () => {
  setFetch(async () => { throw new Error('на свой адрес ходить не должны'); });
  const ctx = { generateRaw: async () => 'ответ таверны' };
  const res = await complete({ ...api, source: 'tavern' }, { user: 'привет', ctx });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.via, 'tavern');
  assert.equal(res.text, 'ответ таверны');
});

test('выбран свой адрес — молчаливого ухода в таверну больше нет', async () => {
  const ctx = { generateRaw: async () => 'таверна ответила бы' };
  const res = await complete({ endpoint: '', source: 'own' }, { user: 'привет', ctx });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'no-endpoint');
  assert.match(res.message, /свой адрес/i, 'человек выбрал своё — счёт основного подключения ему не нужен');
});

test('профиль подключения: запрос идёт через ConnectionManagerRequestService', async () => {
  const seen = [];
  const ctx = {
    generateRaw: async () => { throw new Error('мимо профиля ходить нельзя'); },
    extensionSettings: { connectionManager: { profiles: [{ id: 'p-1', name: 'Дешёвый', model: 'mini' }] } },
    ConnectionManagerRequestService: {
      sendRequest: async (id, messages, maxTokens, opts) => {
        seen.push({ id, messages, maxTokens, opts });
        return { choices: [{ message: { content: 'через профиль' } }] };
      },
    },
  };
  const res = await tavernComplete(ctx, { system: 'сис', user: 'юзер', maxTokens: 42, profileId: 'p-1' });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.text, 'через профиль');
  assert.equal(res.profile, 'Дешёвый');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, 'p-1');
  assert.equal(seen[0].maxTokens, 42);
  assert.deepEqual(seen[0].messages.map((m) => m.role), ['system', 'user']);
  assert.equal(seen[0].opts.extractData, true);
  assert.equal(seen[0].opts.stream, false);
});

test('сборка без менеджера подключений: остаётся честный generateRaw', async () => {
  const ctx = { generateRaw: async () => 'как есть' };
  const res = await tavernComplete(ctx, { user: 'привет' });
  assert.equal(res.ok, true);
  assert.equal(res.text, 'как есть');
  assert.equal(res.profile, undefined);

  // Профиль выбран, а в таверне его нет — молчать нельзя.
  const gone = await tavernComplete({ ...ctx, extensionSettings: { connectionManager: { profiles: [] } } },
    { user: 'привет', profileId: 'p-1' });
  assert.equal(gone.ok, false);
  assert.equal(gone.code, 'no-profile');
});

test('проверка связи актуального API идёт тем же путём, что и генерация', async () => {
  setFetch(async () => { throw new Error('на свой адрес ходить не должны'); });
  const ctx = { generateRaw: async () => 'pong' };
  const ok = await testConnection({ ...api, source: 'tavern' }, { ctx });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.match(ok.message, /подключение таверны/i);

  const dead = await testConnection({ source: 'tavern' }, { ctx: { generateRaw: async () => { throw new Error('провайдер молчит'); } } });
  assert.equal(dead.ok, false);
  assert.match(dead.message, /провайдер молчит/, 'причина отказа доезжает словами');
});

test('списка моделей у подключения таверны нет — и это сказано, а не выдумано', async () => {
  setFetch(async () => { throw new Error('за списком ходить некуда'); });
  const res = await listModels({ ...api, source: 'tavern' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'tavern-no-models', 'отдельный код: панель показывает это объяснением, а не поломкой');
  assert.match(res.message, /таверн/i);
});

// --- бюджет ответа и обрыв по длине ------------------------------------------
//
// Дефект был не в разборе, а в том, что уходило в `generateRaw`: расширение не
// просило бюджет и получало лимит, настроенный человеком под реплику в ролевой
// (400 токенов), — план обрывало по `finish_reason: 'length'`, а панель говорила
// «ответ не разобрался». Поэтому тесты ниже смотрят на **аргументы вызова**, а не
// только на разбор ответа: покрытие разбора этот шов не ловит.

/** Ответ своего адреса с явной причиной остановки. */
const chatReplyStopped = (text, reason) => reply(200, {
  choices: [{ message: { role: 'assistant', content: text }, finish_reason: reason }],
});

/** JSON плана, оборванный на середине: скобки открыты, закрывающих нет. */
const halfPlan = '{\n  "subjects": [\n    {"id": "chemistry", "name": "Хими';

test('генерация плана просит у таверны свой бюджет токенов, а не чужую настройку', async () => {
  setFetch(async () => { throw new Error('сеть трогать нельзя'); });
  const calls = [];
  const ctx = { generateRaw: async (arg) => { calls.push(arg); return planJson; } };
  const res = await generatePlan(survey, preset, { source: 'tavern' }, ctx);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].responseLength, TOKEN_BUDGETS.plan,
    'без responseLength лимит берёт настройка человека под реплику в ролевой');
  assert.ok(TOKEN_BUDGETS.plan > TOKEN_BUDGETS.survey, 'плану нужно больше, чем анкете');
});

test('автозаполнение анкеты просит свой бюджет, проверка связи — восемь токенов', async () => {
  setFetch(async () => { throw new Error('сеть трогать нельзя'); });
  const calls = [];
  const guess = JSON.stringify({ era: 'современность', country: 'Россия', institution: 'вуз' });
  const ctx = {
    ...fakeTavern(),
    generateRaw: async (arg) => { calls.push(arg); return guess; },
  };
  const res = await guessSurvey(preset, { source: 'tavern' }, ctx);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(calls[0].responseLength, TOKEN_BUDGETS.survey);

  const ping = await testConnection({ source: 'tavern' }, { ctx });
  assert.equal(ping.ok, true);
  assert.equal(calls[1].responseLength, TOKEN_BUDGETS.ping, 'проверке связи нужен факт ответа, а не ответ');
  assert.equal(TOKEN_BUDGETS.ping, 8);
});

test('профиль подключения получает тот же бюджет, что и запрос', async () => {
  setFetch(async () => { throw new Error('сеть трогать нельзя'); });
  let seen = null;
  const ctx = {
    generateRaw: async () => { throw new Error('мимо профиля ходить нельзя'); },
    extensionSettings: { connectionManager: { profiles: [{ id: 'p-1', name: 'дешёвая' }] } },
    ConnectionManagerRequestService: {
      sendRequest: async (id, messages, maxTokens) => { seen = { id, messages, maxTokens }; return planJson; },
    },
  };
  const res = await generatePlan(survey, preset, { source: 'tavern', profile: 'p-1' }, ctx);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(seen.maxTokens, TOKEN_BUDGETS.plan, 'прежнее «|| 1024» плану впритык и взято ниоткуда');
});

test('свой адрес получает max_tokens всегда, даже когда вызывающий промолчал', async () => {
  const bodies = [];
  setFetch(async (url, init) => { bodies.push(JSON.parse(init.body)); return chatReply(planJson); });
  await generatePlan(survey, preset, api, null);
  assert.equal(bodies[0].max_tokens, TOKEN_BUDGETS.plan);

  bodies.length = 0;
  setFetch(async (url, init) => { bodies.push(JSON.parse(init.body)); return chatReply('привет'); });
  await complete(api, { user: 'U' });
  assert.equal(bodies[0].max_tokens, TOKEN_BUDGETS.default, 'бюджет без имени — умолчание, а не отсутствие лимита');
});

test('бюджет вызывающего сильнее умолчания', async () => {
  setFetch(async () => { throw new Error('сеть трогать нельзя'); });
  let seen = null;
  const ctx = { generateRaw: async (arg) => { seen = arg; return planJson; } };
  await generatePlan(survey, preset, { source: 'tavern' }, ctx, { maxTokens: 3000 });
  assert.equal(seen.responseLength, 3000);
});

test('причина остановки и признак обрыва разбираются порознь', () => {
  assert.equal(finishReason({ choices: [{ finish_reason: 'length' }] }), 'length');
  assert.equal(finishReason({ choices: [{ stop_reason: 'max_tokens' }] }), 'max_tokens');
  assert.equal(finishReason({ choices: [{ finish_reason: 'stop' }] }), 'stop');
  assert.equal(finishReason('строка от generateRaw'), '', 'путь таверны причину не отдаёт вовсе');
  assert.equal(finishReason(null), '');

  assert.equal(isTruncatedReason('length'), true);
  assert.equal(isTruncatedReason('max_tokens'), true);
  assert.equal(isTruncatedReason('stop'), false);
  assert.equal(isTruncatedReason(''), false);

  assert.equal(looksTruncated(halfPlan), true);
  assert.equal(looksTruncated(planJson), false);
  assert.equal(looksTruncated('Извините, не могу.'), false, 'текст без скобок — не обрыв');
  assert.equal(looksTruncated(''), false);
  assert.equal(looksTruncated('Вот план: {"subjects":[]} и всё'), false, 'скобки закрыты — не обрыв');
});

test('обрыв через таверну называется обрывом, а не «не разобрался»', async () => {
  setFetch(async () => { throw new Error('сеть трогать нельзя'); });
  let calls = 0;
  const ctx = { generateRaw: async () => { calls += 1; return halfPlan; } };
  const res = await generatePlan(survey, preset, { source: 'tavern' }, ctx);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'truncated', 'прежний код `parse` уводил чинить разбор вместо лимита');
  assert.match(res.error, /не договорил/i);
  assert.doesNotMatch(res.error, /токен|лимит|адрес/i, 'игрок на это повлиять не может');
  assert.match(res.error, /ещё раз/i);
  assert.ok(res.errors.includes('truncated'));
  assert.equal(res.raw, halfPlan, 'сырой ответ человеку остаётся');
  assert.equal(calls, 1, 'повтор тем же бюджетом оборвётся там же — это трата чужих денег');
  assert.equal(res.attempts, 1);
});

test('обрыв на своём адресе виден по finish_reason даже при целых скобках', async () => {
  let calls = 0;
  // Скобки закрыты, признак «оборвался на середине JSON» молчит: обрыв ловится
  // только фактом из ответа.
  setFetch(async () => { calls += 1; return chatReplyStopped('{"subjects":[]}', 'length'); });
  const res = await generatePlan(survey, preset, api, null);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'truncated');
  assert.equal(calls, 1);
});

test('непонятый ответ без обрыва остаётся непонятым ответом и повторяется', async () => {
  let calls = 0;
  setFetch(async () => { calls += 1; return chatReplyStopped('это не JSON, а извинения', 'stop'); });
  const res = await generatePlan(survey, preset, api, null);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'parse', 'обрывом объявлено только то, что оборвано');
  assert.match(res.error, /не разобрался/);
  assert.equal(calls, 2, 'уточнение «верни только JSON» второй попытке помогает');
});

test('оборванная анкета тоже названа обрывом и не повторяется', async () => {
  setFetch(async () => { throw new Error('сеть трогать нельзя'); });
  let calls = 0;
  const ctx = {
    ...fakeTavern(),
    generateRaw: async () => { calls += 1; return '{"era": "совреме'; },
  };
  const res = await guessSurvey(preset, { source: 'tavern' }, ctx);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'truncated');
  assert.match(res.error, /не договорил/i);
  assert.match(res.error, /анкет/i);
  assert.equal(calls, 1);
});

test('фраза об обрыве говорит, что делать, без токенов и чужих настроек', () => {
  const m = truncatedMessage('анкета пришла наполовину', 'Поля можно вписать руками.');
  assert.match(m, /не договорил/i);
  assert.match(m, /ещё раз/i);
  assert.match(m, /руками/i);
  assert.doesNotMatch(m, /токен|лимит|адрес/i);
});

// Пин, а не доказательство правки: прежнее `req.maxTokens || 1024` давало то же
// число, что и `TOKEN_BUDGETS.default`. Тест держит умолчание на месте — чтобы
// «вызывающий промолчал» не означало снова «лимит берёт настройка человека».
test('вызывающий, который бюджет не назвал, получает умолчание обоими путями таверны', async () => {
  setFetch(async () => { throw new Error('сеть трогать нельзя'); });
  let seen = null;
  const raw = { generateRaw: async (arg) => { seen = arg; return 'ответ'; } };
  await tavernComplete(raw, { user: 'U' });
  assert.equal(seen.responseLength, TOKEN_BUDGETS.default);

  let maxTokens = null;
  const withProfile = {
    ...raw,
    extensionSettings: { connectionManager: { profiles: [{ id: 'p-1', name: 'дешёвая' }] } },
    ConnectionManagerRequestService: {
      sendRequest: async (id, messages, mt) => { maxTokens = mt; return 'ответ'; },
    },
  };
  await tavernComplete(withProfile, { user: 'U', profileId: 'p-1' });
  assert.equal(maxTokens, TOKEN_BUDGETS.default);

  for (const junk of [0, -5, 'много', null, undefined, NaN]) {
    seen = null;
    await tavernComplete(raw, { user: 'U', maxTokens: junk });
    assert.equal(seen.responseLength, TOKEN_BUDGETS.default, String(junk));
  }
});

// --- бюджет под модель, которая думает вслух ---------------------------------
//
// Замер живьём на `deepseek/deepseek-v4-flash`: рассуждение тратится из того же
// `max_tokens`, что и ответ. План с бюджетом 2048 оборвался по длине с первого
// запроса; на лимите 700 та же модель израсходовала на рассуждение ровно 700
// токенов и вернула пустой текст. Числа ниже — граница, ниже которой опускаться
// нельзя, а не украшение: тест смотрит на то, что реально уходит в запрос.

test('бюджет плана и анкеты выдерживает модель, которая думает вслух', async () => {
  setFetch(async () => { throw new Error('сеть трогать нельзя'); });

  const calls = [];
  const ctx = { generateRaw: async (arg) => { calls.push(arg); return planJson; } };
  const res = await generatePlan(survey, preset, { source: 'tavern' }, ctx);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(calls[0].responseLength >= 8192,
    `плану ушло ${calls[0].responseLength} токенов: живьём 2048 и 4096 обрывались`);

  const guessCalls = [];
  const guess = JSON.stringify({ era: 'современность', country: 'Россия', institution: 'вуз' });
  const gctx = { ...fakeTavern(), generateRaw: async (arg) => { guessCalls.push(arg); return guess; } };
  const g = await guessSurvey(preset, { source: 'tavern' }, gctx);
  assert.equal(g.ok, true, JSON.stringify(g));
  assert.ok(guessCalls[0].responseLength > 700,
    `анкете ушло ${guessCalls[0].responseLength} токенов: на 700 та же модель вернула пустой текст`);

  // Своим адресом уходит то же самое число — путей два, а бюджет один.
  const bodies = [];
  setFetch(async (url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return reply(200, { choices: [{ message: { role: 'assistant', content: planJson } }] });
  });
  await generatePlan(survey, preset, { endpoint: 'https://x.y', key: 'k', model: 'm' }, null);
  assert.equal(bodies[0].max_tokens, TOKEN_BUDGETS.plan);
  assert.ok(bodies[0].max_tokens >= 8192);
});

test('плашка про обрыв плана без единого предмета называет его словом пресета', async () => {
  setFetch(async () => { throw new Error('сеть трогать нельзя'); });
  const magic = JSON.parse(readFileSync(
    fileURLToPath(new URL('../presets/magic-academy.json', import.meta.url)), 'utf8'));
  const ctx = { generateRaw: async () => halfPlan };

  const ru = await generatePlan(survey, preset, { source: 'tavern' }, ctx);
  assert.equal(ru.code, 'truncated');
  assert.match(ru.error, /Учебный план/, `у вуза это «учебный план»: ${ru.error}`);
  assert.equal(/[Дд]исциплин/.test(ru.error), false,
    `слово магической академии показано студентке вуза: ${ru.error}`);

  const mg = await generatePlan(survey, magic, { source: 'tavern' }, ctx);
  assert.equal(mg.code, 'truncated');
  assert.match(mg.error, /Список дисциплин/, `у Академии это «список дисциплин»: ${mg.error}`);
  assert.equal(/[Уу]чебный план/.test(mg.error), false, mg.error);
});

// --- спасение оборванного плана (прогон 10.10) ---------------------------------

const cutPlans = {
  'посреди строки': '{"subjects":[{"id":"chem","name":"Химия","teacherId":"pet"},{"id":"bio","name":"Био',
  'посреди объекта': '{"subjects":[{"id":"chem","name":"Химия","teacherId":"pet"},{"id":"bio","name":"Биология",',
  'после запятой': '{"subjects":[{"id":"chem","name":"Химия","teacherId":"pet"},{"id":"bio","name":"Биология","teacherId":"pet"},',
  'в заборе': '```json\n{"subjects":[{"id":"chem","name":"Химия","teacherId":"pet"},{"id":"bio","name":"Био',
  'в преподавателях': '{"subjects":[{"id":"chem","name":"Химия","teacherId":"pet"}],"teachers":[{"id":"pet","name":"Петрова","traits":["строгая","злопамятная"]},{"id":"iv","name":"Ив","traits":["до',
};

for (const [where, text] of Object.entries(cutPlans)) {
  test(`оборванный план (${where}) отдаёт то, что договорено`, async () => {
    setFetch(async () => { throw new Error('сеть трогать нельзя'); });
    let calls = 0;
    const ctx = { generateRaw: async () => { calls += 1; return text; } };
    const res = await generatePlan(survey, preset, { source: 'tavern' }, ctx);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.partial, true);
    assert.equal(calls, 1, 'повтор тем же бюджетом оборвётся там же');
    assert.ok(res.plan.subjects.length >= 1);
    assert.equal(res.plan.subjects[0].id, 'chem');
    assert.match(res.notice, /Модель не договорила — вот что успела: \d+ предмет/);
    assert.doesNotMatch(res.notice, /токен|лимит|адрес|половин/i);
    assert.equal(res.raw, text, 'сырой ответ остаётся');
  });
}

test('оборванный план: недописанный элемент не попадает в таблицу', async () => {
  setFetch(async () => { throw new Error('сеть трогать нельзя'); });
  const ctx = { generateRaw: async () => cutPlans['посреди объекта'] };
  const res = await generatePlan(survey, preset, { source: 'tavern' }, ctx);
  assert.deepEqual(res.plan.subjects.map((s) => s.id), ['chem']);
  assert.match(res.notice, /1 предмет\./);

  const t = await generatePlan(survey, preset, { source: 'tavern' },
    { generateRaw: async () => cutPlans['в преподавателях'] });
  assert.deepEqual(t.plan.teachers.map((x) => x.id), ['pet'], 'Ив без дописанных черт не берётся');
});

test('сообщения «только половина» при пустой таблице больше нет', async () => {
  setFetch(async () => { throw new Error('сеть трогать нельзя'); });
  for (const text of [...Object.values(cutPlans), halfPlan, '{"subjects":[{"id":"a"', '[{"na']) {
    const res = await generatePlan(survey, preset, { source: 'tavern' }, { generateRaw: async () => text });
    const shown = res.ok ? res.notice : res.error;
    assert.doesNotMatch(shown, /половин|токен|лимит/i, shown);
    // Либо в таблице есть что показать, либо честно сказано, что не вышло.
    assert.ok(res.ok ? res.plan.subjects.length > 0 : res.code === 'truncated', text);
  }
});

test('целый, но кривой ответ не «спасается»: спасение только для оборванного', async () => {
  setFetch(async () => { throw new Error('сеть трогать нельзя'); });
  const res = await generatePlan(survey, preset, { source: 'tavern' },
    { generateRaw: async () => 'вот план: {"subjects": [ {"name": } ]}' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'parse');
});

// --- мелочи API (9.1.7) --------------------------------------------------------
//
// Паузы между повторами — через `setSleep`: тест записывает длительности и не
// ждёт ни миллисекунды. Реальная пауза здесь была бы и медленной, и ложной
// уверенностью: проверять надо, СКОЛЬКО просили ждать, а не что таймер тикает.

/** Подменённая пауза: запоминает длительности, не ждёт. */
function fakeSleep() {
  const pauses = [];
  setSleep(async (ms) => { pauses.push(ms); });
  return pauses;
}

/** Все ли символы годятся в заголовок fetch (ISO-8859-1) — ровно то, на чём падал браузер. */
const headerSafe = (v) => /^[\x00-\xFF]*$/.test(v);

// ключ

test('ключ: невидимки убираются везде, пробелы и NBSP — по краям', () => {
  const dirty = '  ​sk-‌ab‍c⁠﻿-123  \n';
  assert.deepEqual(sanitizeApiKey(dirty), { ok: true, key: 'sk-abc-123' });
  assert.deepEqual(sanitizeApiKey(null), { ok: true, key: '' }, 'пустой ключ — не ошибка: локалке он не нужен');
  assert.deepEqual(sanitizeApiKey('  '), { ok: true, key: '' });
});

test('ключ: оставшийся чужой символ назван по имени и месту, а ключ целиком не показан', () => {
  const cyr = sanitizeApiKey('sk-аbc123secret'); // кириллическая «а»
  assert.equal(cyr.ok, false);
  assert.equal(cyr.position, 4);
  assert.ok(/кириллическая буква «а»/.test(cyr.message), cyr.message);
  assert.ok(/4-й/.test(cyr.message), cyr.message);
  assert.equal(cyr.message.includes('secret'), false, 'ключ в тексте ошибки не светится');

  assert.ok(/неразрывный пробел/.test(sanitizeApiKey('sk-ab cd').message));
  assert.ok(/пробел/.test(sanitizeApiKey('sk-ab cd').message), 'пробел внутри ключа — тоже ошибка');
  assert.ok(/перенос строки/.test(sanitizeApiKey('sk-ab\ncd').message), 'ключ, разорванный переносом');
  assert.ok(/U\+00E9/.test(sanitizeApiKey('sk-é').message), 'прочее называется кодом');
});

test('ключ: в заголовок уходит очищенный, испорченный не уходит вовсе', () => {
  assert.equal(headersFor({ key: '​sk-1 ' }).Authorization, 'Bearer sk-1');
  assert.equal(headersFor({ key: 'sk-а' }).Authorization, undefined,
    'лучше честный 401, чем падение fetch на заголовке');
  assert.equal(keyProblem({ key: '﻿sk-1' }), null);
  assert.equal(keyProblem({ key: 'sk-а' }).code, 'bad-key');
});

test('ключ из Telegram доезжает до провайдера чистым', async () => {
  let seen = null;
  setFetch(async (url, init) => { seen = init.headers.Authorization; return chatReply('ok'); });
  const res = await complete({ ...api, key: '​sk-1​ ' }, { user: 'U' });
  assert.equal(res.ok, true);
  assert.equal(seen, 'Bearer sk-1');
  assert.ok(headerSafe(seen));
});

test('испорченный ключ — понятный отказ до сети во всех трёх вызовах', async () => {
  let calls = 0;
  setFetch(async () => { calls += 1; return chatReply('ok'); });
  const bad = { ...api, key: 'sk-сек' };
  for (const res of [await complete(bad, { user: 'U' }), await listModels(bad), await testConnection(bad)]) {
    assert.equal(res.ok, false);
    assert.equal(res.code, 'bad-key');
    assert.ok(/ключе API/.test(res.message), res.message);
  }
  assert.equal(calls, 0, 'с таким ключом fetch упал бы невнятно — не зовём его');

  const plan = await generatePlan(survey, preset, bad, null);
  assert.equal(plan.code, 'bad-key');
  assert.equal(plan.attempts, 1, 'испорченный ключ повтором не чинится');
});

test('подключению таверны чужой испорченный ключ не мешает: он там не используется', async () => {
  const ctx = { generateRaw: async () => 'из таверны' };
  const res = await complete({ ...api, key: 'sk-а', source: 'tavern' }, { user: 'U', ctx });
  assert.equal(res.ok, true);
  assert.equal(res.via, 'tavern');
});

// повтор на 429/5xx

test('повторяются только 429 и 5xx', () => {
  for (const s of [429, 500, 502, 503, 504, 529]) assert.equal(isRetryableStatus(s), true, String(s));
  for (const s of [200, 400, 401, 403, 404, 408, 413, 422, null, undefined]) {
    assert.equal(isRetryableStatus(s), false, String(s));
  }
  assert.deepEqual(RETRY.pauses, [800, 1600]);
});

test('503 дважды, потом ответ: два повтора с паузами 800 и 1600 мс', async () => {
  const pauses = fakeSleep();
  let calls = 0;
  setFetch(async () => { calls += 1; return calls < 3 ? reply(503, { error: 'overloaded' }) : chatReply('ok'); });
  const res = await complete(api, { user: 'U' });
  assert.equal(res.ok, true);
  assert.equal(calls, 3);
  assert.deepEqual(pauses, [800, 1600]);
});

test('429 не проходит и после повторов: третьей паузы нет, человеку сказано, что повтор уже был', async () => {
  const pauses = fakeSleep();
  let calls = 0;
  setFetch(async () => { calls += 1; return reply(429, { error: { message: 'rate limit' } }); });
  const res = await complete(api, { user: 'U' });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'rate');
  assert.equal(calls, 3, 'одна попытка и два повтора');
  assert.deepEqual(pauses, [800, 1600]);
  assert.equal(res.tries, 3);
  assert.ok(/повторило запрос 2 раза/.test(res.message), res.message);
});

test('4xx кроме 429 не повторяется: чинить надо настройки', async () => {
  const pauses = fakeSleep();
  for (const status of [400, 401, 403, 404, 422]) {
    let calls = 0;
    setFetch(async () => { calls += 1; return reply(status, { error: { message: 'no' } }); });
    const res = await complete(api, { user: 'U' });
    assert.equal(res.ok, false);
    assert.equal(calls, 1, `статус ${status}`);
  }
  assert.deepEqual(pauses, []);
});

test('сеть, таймаут и обрыв по токенам транспортом не повторяются', async () => {
  const pauses = fakeSleep();
  let calls = 0;
  setFetch(async () => { calls += 1; throw new TypeError('Failed to fetch'); });
  assert.equal((await complete(api, { user: 'U' })).code, 'network');
  assert.equal(calls, 1);

  calls = 0;
  setFetch((url, init) => new Promise((_, reject) => {
    calls += 1;
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }));
  assert.equal((await complete(api, { user: 'U', timeout: 10 })).code, 'timeout');
  assert.equal(calls, 1, 'второе ожидание по таймауту — ещё полторы минуты впустую');

  calls = 0;
  setFetch(async () => {
    calls += 1;
    return reply(200, { choices: [{ message: { content: '{"subjects": [' }, finish_reason: 'length' }] });
  });
  const cut = await generatePlan(survey, preset, api, null);
  assert.equal(cut.code, 'truncated');
  assert.equal(calls, 1, 'повтор тем же бюджетом оборвётся там же (etap-tokens)');
  assert.deepEqual(pauses, []);
});

test('отмена во время паузы — это отмена, а не повод для следующей попытки', async () => {
  const ctl = new AbortController();
  setSleep(async () => { ctl.abort(); });
  let calls = 0;
  setFetch(async () => { calls += 1; return reply(503, {}); });
  const res = await complete(api, { user: 'U', signal: ctl.signal });
  assert.equal(res.code, 'aborted');
  assert.equal(calls, 1);
});

test('штатная пауза прерывается отменой, а не досыпает своё', async () => {
  // Единственный тест со штатной паузой: RETRY подменён на час, и если бы
  // отмена его не прерывала, прогон бы завис.
  const saved = RETRY.pauses;
  RETRY.pauses = [3600000];
  try {
    const ctl = new AbortController();
    let calls = 0;
    setFetch(async () => { calls += 1; setTimeout(() => ctl.abort(), 5); return reply(503, {}); });
    const res = await complete(api, { user: 'U', signal: ctl.signal });
    assert.equal(res.code, 'aborted');
    assert.equal(calls, 1);
  } finally {
    RETRY.pauses = saved;
  }
});

test('проверка связи не повторяет: «сейчас 503» и есть ответ на вопрос', async () => {
  const pauses = fakeSleep();
  let calls = 0;
  setFetch(async () => { calls += 1; return reply(503, {}); });
  const res = await testConnection(api);
  assert.equal(res.code, 'server');
  assert.equal(calls, 1);
  assert.deepEqual(pauses, []);
});

test('список моделей повторяется на 502 так же, как генерация', async () => {
  const pauses = fakeSleep();
  let calls = 0;
  setFetch(async () => { calls += 1; return calls === 1 ? reply(502, {}) : reply(200, { data: [{ id: 'm1' }] }); });
  assert.deepEqual(await listModels(api), { ok: true, models: ['m1'] });
  assert.deepEqual(pauses, [800]);
});

test('повторы не удваиваются: упорный 503 на плане — три запроса, а не шесть', async () => {
  fakeSleep();
  let calls = 0;
  setFetch(async () => { calls += 1; return reply(503, {}); });
  const res = await generatePlan(survey, preset, api, null);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'server');
  assert.equal(calls, 3, 'транспорт повторил дважды, план поверх не повторяет');
  assert.equal(res.attempts, 1);

  calls = 0;
  const guess = await guessSurvey(preset, api, fakeTavern());
  assert.equal(guess.code, 'server');
  assert.equal(calls, 3);
});

test('503, потом план: план прошёл с первой смысловой попытки', async () => {
  fakeSleep();
  let calls = 0;
  setFetch(async () => { calls += 1; return calls === 1 ? reply(503, {}) : chatReply(planJson); });
  const res = await generatePlan(survey, preset, api, null);
  assert.equal(res.ok, true);
  assert.equal(calls, 2);
  assert.equal(res.attempts, 1, 'транспортный повтор не считается попыткой плана');
});

test('пустой ответ модели план больше не повторяет', async () => {
  let calls = 0;
  setFetch(async () => { calls += 1; return chatReply(''); });
  const res = await generatePlan(survey, preset, api, null);
  assert.equal(res.code, 'empty');
  assert.equal(calls, 1, 'у думающей модели пустой ответ — тот же обрыв по бюджету');
});

// экранирование макросов

test('escapeMacros разрывает каждую двойную скобку и не трогает одиночные', () => {
  assert.equal(escapeMacros('{{random::a,b}}'), '{​{random::a,b}}');
  assert.equal(escapeMacros('{{{'), '{​{​{', 'три скобки подряд — ни одной целой пары');
  assert.equal(escapeMacros('{"era":"","lang":"ru"}'), '{"era":"","lang":"ru"}', 'JSON-образец промпта цел');
  assert.equal(escapeMacros(null), '');
  assert.equal(/\{\{/.test(escapeMacros('a {{char}} b {{{{x}}}}')), false);
});

test('в generateRaw макросы из текста уходят обезвреженными — и в prompt, и в systemPrompt', async () => {
  let seen = null;
  const ctx = { generateRaw: async (arg) => { seen = arg; return 'ok'; } };
  await complete({}, { system: 'S {{setvar::x::1}}', user: 'U {{roll:1d20}}', ctx });
  assert.equal(seen.prompt, 'U {​{roll:1d20}}');
  assert.equal(seen.systemPrompt, 'S {​{setvar::x::1}}');
});

test('автоанкета: макрос из карточки не доезжает до generateRaw живым', async () => {
  let seen = null;
  const ctx = {
    ...fakeTavern({ character: { description: 'Учится в {{random::МГУ,СПбГУ}}.' } }),
    generateRaw: async (arg) => { seen = arg; return guessJson; },
  };
  const res = await guessSurvey(preset, { endpoint: '' }, ctx);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(seen.prompt.includes('{​{random::МГУ,СПбГУ}}'), seen.prompt);
  assert.equal(/\{\{/.test(seen.prompt + seen.systemPrompt), false);
});

test('профиль и свой адрес получают текст как есть: там макросы никто не исполняет', async () => {
  let messages = null;
  const ctx = {
    extensionSettings: { connectionManager: { profiles: [{ id: 'p1', name: 'Дешёвая' }] } },
    ConnectionManagerRequestService: { sendRequest: async (id, msgs) => { messages = msgs; return { content: 'ok' }; } },
    generateRaw: async () => { throw new Error('не сюда'); },
  };
  await complete({ source: 'tavern', profile: 'p1' }, { system: 'S {{x}}', user: 'U {{y}}', ctx });
  assert.deepEqual(messages, [{ role: 'system', content: 'S {{x}}' }, { role: 'user', content: 'U {{y}}' }]);

  let body = null;
  setFetch(async (url, init) => { body = JSON.parse(init.body); return chatReply('ok'); });
  await complete(api, { user: 'U {{y}}' });
  assert.equal(body.messages[0].content, 'U {{y}}');
});

// список моделей через сервер таверны при CORS

/** Таверна с заголовками CSRF, как `getContext().getRequestHeaders()` в 1.18.0. */
const csrfTavern = () => ({
  getRequestHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'tok' }),
});

test('CORS на списке моделей: список приходит через сервер таверны тем же адресом и ключом', async () => {
  setContextProvider(csrfTavern); // index.js зовёт listModels без ctx — берётся ленивый контекст
  const seen = [];
  setFetch(async (url, init) => {
    seen.push({ url, init });
    if (url === 'https://x.y/v1/models') throw new TypeError('Failed to fetch');
    return reply(200, { object: 'list', data: [{ id: 'm1' }, { id: 'm2' }] });
  });
  const res = await listModels({ ...api, key: '​sk-1 ' });
  assert.deepEqual(res, { ok: true, models: ['m1', 'm2'], via: 'tavern-backend' });
  assert.equal(seen.length, 2);
  assert.equal(seen[1].url, TAVERN_STATUS_URL);
  assert.equal(seen[1].init.method, 'POST');
  assert.equal(seen[1].init.headers['X-CSRF-Token'], 'tok', 'без токена CSRF сервер ответит 403');
  assert.deepEqual(JSON.parse(seen[1].init.body), {
    chat_completion_source: 'openai',
    reverse_proxy: 'https://x.y/v1',
    proxy_password: 'sk-1',
  });
});

test('сервер таверны тоже не достал список: отказ сетевой, но с обоими объяснениями', async () => {
  setContextProvider(csrfTavern);
  setFetch(async (url) => {
    if (url !== TAVERN_STATUS_URL) throw new TypeError('Failed to fetch');
    // Так сервер отвечает на провал у провайдера: статус 200, ошибка в теле.
    return reply(200, { error: true, data: { data: [] } });
  });
  const res = await listModels(api);
  assert.equal(res.ok, false);
  assert.equal(res.code, 'network');
  assert.ok(/CORS/.test(res.message) && /сервер таверны/.test(res.message), res.message);
});

test('403 от таверны — это токен CSRF, а не ключ провайдера', async () => {
  setContextProvider(csrfTavern);
  setFetch(async (url) => {
    if (url !== TAVERN_STATUS_URL) throw new TypeError('Failed to fetch');
    return reply(403, 'Invalid CSRF token');
  });
  const res = await listModels(api);
  assert.ok(/обновите страницу таверны/.test(res.message), res.message);
  assert.equal(/Ключ не принят/.test(res.message), false, res.message);
});

test('запасной путь только на сетевой отказ и только если таверна есть', async () => {
  let calls = 0;
  setFetch(async () => { calls += 1; throw new TypeError('Failed to fetch'); });
  const noTavern = await listModels(api);
  assert.equal(noTavern.code, 'network');
  assert.equal(calls, 1, 'без getRequestHeaders идти некуда');

  setContextProvider(csrfTavern);
  calls = 0;
  setFetch(async () => { calls += 1; return reply(401, { error: { message: 'bad key' } }); });
  assert.equal((await listModels(api)).code, 'auth');
  assert.equal(calls, 1, 'сервер ответил 401 — CORS тут ни при чём, таверну не беспокоим');
});

// --- живой прогон 10.10: чужие вставки, обрыв, зависание ---------------------------

/** Шина событий как в таверне: `makeFirst`/`makeLast`/`removeListener`, `emit` по порядку. */
function fakeBus() {
  const events = {};
  return {
    on(e, f) { (events[e] = events[e] || []).push(f); },
    makeFirst(e, f) { events[e] = [f, ...(events[e] || []).filter((x) => x !== f)]; },
    makeLast(e, f) { events[e] = [...(events[e] || []).filter((x) => x !== f), f]; },
    removeListener(e, f) { events[e] = (events[e] || []).filter((x) => x !== f); },
    async emit(e, data) { for (const f of [...(events[e] || [])]) await f(data); },
  };
}

test('таверна: чужие вставки в промпт запроса снимаются, чужая генерация не трогается', async () => {
  const bus = fakeBus();
  // Сосед дописывает свою инструкцию в каждый запрос, как «На износ» (`NI`).
  bus.on('chat_completion_prompt_ready', (d) => { d.chat.push({ role: 'system', content: 'FIRST line must be <!-- NI t=… -->' }); });
  let sent = null;
  const ctx = {
    eventSource: bus,
    eventTypes: { CHAT_COMPLETION_PROMPT_READY: 'chat_completion_prompt_ready', GENERATE_AFTER_COMBINE_PROMPTS: 'generate_after_combine_prompts' },
    generateRawData: async ({ prompt, systemPrompt }) => {
      const data = { chat: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }], dryRun: false };
      await bus.emit('chat_completion_prompt_ready', data);
      sent = data.chat;
      return { choices: [{ message: { content: 'ответ' }, finish_reason: 'stop' }] };
    },
  };
  const res = await tavernComplete(ctx, { system: 'СИС', user: 'Разбери этот фрагмент ответа рассказчика.' });
  assert.equal(res.ok, true);
  assert.equal(res.truncated, false);
  assert.deepEqual(sent.map((m) => m.content), ['СИС', 'Разбери этот фрагмент ответа рассказчика.'], 'вставка соседа снята');

  // Чужая генерация, у которой нашего текста нет, остаётся с вставками.
  const other = { chat: [{ role: 'user', content: 'реплика игрока' }] };
  await withoutForeignInjections(ctx, 'Разбери этот фрагмент', async () => { await bus.emit('chat_completion_prompt_ready', other); });
  assert.equal(other.chat.length, 2);
  // Слушатели за собой убраны: следующая чужая генерация идёт как обычно.
  const next = { chat: [{ role: 'user', content: 'Разбери этот фрагмент ответа' }] };
  await bus.emit('chat_completion_prompt_ready', next);
  assert.equal(next.chat.length, 2);
});

test('таверна: finish_reason=length из generateRawData — настоящий обрыв', async () => {
  const ctx = {
    generateRawData: async () => ({ choices: [{ message: { content: '<!-- [ACADEMY skip=история late=' }, finish_reason: 'length' }] }),
  };
  const res = await tavernComplete(ctx, { user: 'U' });
  assert.equal(res.ok, true);
  assert.equal(res.truncated, true);
});

test('таверна: запрос, который не отвечает, кончается таймаутом, а не зависанием', async () => {
  const ctx = { generateRawData: () => new Promise(() => {}) };
  const res = await tavernComplete(ctx, { user: 'U', timeout: 20 });
  assert.equal(res.ok, false);
  assert.equal(res.code, 'timeout');
});

test('бюджеты секретаря и каста выдерживают модель, которая думает вслух', () => {
  assert.ok(TOKEN_BUDGETS.analysis >= 4096);
  assert.ok(TOKEN_BUDGETS.feedCast >= 4096);
});

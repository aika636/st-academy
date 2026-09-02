import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  normalizeBase, chatUrl, modelsUrl, hasOwnEndpoint, parseCompletion, parseModels,
  classifyError, errorDetail, headersFor, complete, listModels, testConnection, generatePlan,
  resolveSource, tavernComplete,
  setFetch, setContextProvider,
  TOKEN_BUDGETS, finishReason, isTruncatedReason, looksTruncated, truncatedMessage,
  DEFAULT_SURVEY_PROMPT, SURVEY_KEYS, readCharacterCard, firstCharacterMessage, cardToText,
  buildSurveyPrompt, parseSurveyResponse, validateSurveyGuess, guessSurvey,
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

test.afterEach(() => { setFetch(null); setContextProvider(null); });

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

test('сетевой сбой повторяется один раз и возвращает понятную ошибку', async () => {
  let calls = 0;
  setFetch(async () => { calls += 1; throw new TypeError('Failed to fetch'); });
  const res = await generatePlan(survey, preset, api, null);
  assert.equal(res.ok, false);
  assert.equal(calls, 2);
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
  assert.equal(net.attempts, 2);
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
  assert.match(res.error, /оборван/i);
  assert.match(res.error, /лимит/i);
  assert.match(res.error, new RegExp(String(TOKEN_BUDGETS.plan)), 'сколько просили — часть ответа на «что делать»');
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
  assert.match(res.error, /оборван/i);
  assert.match(res.error, /анкет/i);
  assert.equal(calls, 1);
});

test('фраза об обрыве говорит, что делать', () => {
  const m = truncatedMessage('учебный план пришёл наполовину', 2048, 'Дисциплины можно вписать руками.');
  assert.match(m, /2048/);
  assert.match(m, /лимит ответа/i, 'первое лекарство — поднять лимит');
  assert.match(m, /свой адрес с ключом/i, 'второе — свой адрес, где лимитом распоряжается расширение');
  assert.match(m, /руками/i);
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
  assert.ok(calls[0].responseLength >= 4096,
    `плану ушло ${calls[0].responseLength} токенов: живьём 2048 обрывались на рассуждении`);

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
  assert.ok(bodies[0].max_tokens >= 4096);
});

test('плашка про обрыв плана называет его словом пресета, а не чужим', async () => {
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

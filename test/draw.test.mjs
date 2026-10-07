// «Нарисовать портрет» (аватарки, шаг 4): промпт шаблоном из полей человека
// (теги NAI без кириллицы, фраза для GPT/NB, сеттинги, пустые поля), выбор
// доступных путей по `secret_state`, тела запросов к серверу таверны, разбор
// ответов провайдеров и отказы понятным текстом; путь «как в таверне» через
// `/imagine` с отменой и таймаутом; своё описание внешности в состоянии.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildPortraitPrompt, portraitFacts, guessGender, hasCyrillic, SETTING_LOOKS, DRAW_STYLES, NAI_NEGATIVE,
  LOOKS_MAX, normalizeLooks,
} from '../core/draw-prompt.mjs';
import {
  SECRETS, DRAW_ROUTES, DRAW_MODELS, availableRoutes, pickRoute, pickModel, sdSourceReady, promptForm,
  drawRequest, parseNovelResponse, parseOpenAIResponse, parseGeminiResponse, parseOpenRouterResponse,
  parseImagenResponse, parseDrawResponse, cleanBase64, sniffMime, httpFailure, normalizeDrawSettings,
  isImagePath, hasSecret, DRAW_TEXT, timeoutFailure,
} from '../core/draw.mjs';
import { createState, validateState } from '../core/state.mjs';
import { normalizeClassmate, updateClassmate, classmateErrors } from '../core/classmates.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { DEFAULT_SETTINGS } from '../storage.js';
import { drawImage, drawInfo } from '../draw.js';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));

// Настоящий PNG 1×1 — длиннее порога «пустого» base64.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const JPG = `/9j/${'A'.repeat(80)}`;

const TEACHER = {
  id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['строгая', 'ироничная'],
  post: 'декан факультета', likes: 'белое вино и старые книги', looks: 'рыжая, в очках, длинные волосы',
};

// --- промпт -------------------------------------------------------------------

test('промпт: теги NAI преподавателя — из словарей, без кириллицы, с качеством впереди', () => {
  const p = buildPortraitPrompt(TEACHER, { kind: 'teacher', subjects: ['Зельеварение'], presetId: 'magic-academy' });
  assert.equal(hasCyrillic(p.tags), false, p.tags);
  assert.ok(p.tags.startsWith('masterpiece, best quality, very aesthetic'));
  for (const tag of ['1girl', 'mature female', 'solo', 'portrait', 'upper body', 'looking at viewer',
    'red hair', 'glasses', 'long hair', 'serious', 'wizard robe', 'holding potion', 'library']) {
    assert.ok(p.tags.split(', ').includes(tag), `нет тега ${tag}: ${p.tags}`);
  }
  // Имени в промпте нет ни в одной форме.
  assert.ok(!/Петров|Анна|petrov/i.test(p.tags + p.text));
  assert.equal(p.negative, NAI_NEGATIVE.join(', '));
});

test('промпт: фраза для GPT/NB — портрет по плечи, роль, одежда сеттинга, без текста; русское — в кавычках', () => {
  const p = buildPortraitPrompt(TEACHER, { kind: 'teacher', subjects: ['Зельеварение'], presetId: 'magic-academy' });
  assert.match(p.text, /^Head-and-shoulders portrait of an adult woman, a dean who teaches potions/);
  assert.match(p.text, /wearing an ornate wizard robe/);
  assert.match(p.text, /with a stern expression/);
  assert.match(p.text, /a glass of wine/);
  assert.match(p.text, /painterly anime style, no text/);
  assert.match(p.text, /Appearance \(in Russian\): "рыжая, в очках, длинные волосы"/);
  assert.match(p.text, /Character \(in Russian\): "строгая, ироничная"/);
});

test('промпт: однокурсница в японской школе — сейлор-фуку, однокурсник — гакуран, кружок — предмет в руках', () => {
  const f = buildPortraitPrompt({ id: 'vera', name: 'Вера Соколова', club: 'фотокружок' }, { kind: 'classmate', presetId: 'jp-highschool' });
  assert.ok(f.tags.includes('serafuku'));
  assert.ok(f.tags.includes('holding camera'));
  assert.match(f.text, /young woman, a student from the photography club/);
  assert.match(f.text, /sailor fuku/);
  const m = buildPortraitPrompt({ id: 'ivan', name: 'Иван Петров' }, { kind: 'classmate', presetId: 'jp-highschool' });
  assert.ok(m.tags.includes('gakuran') && m.tags.includes('1boy'));
  assert.ok(!m.tags.includes('serafuku'));
});

test('промпт: каждый встроенный пресет даёт свою одежду; сянься — ханьфу, космос — униформа', () => {
  const ids = ['cadet-academy', 'cn-highschool', 'dark-academia', 'hero-academy', 'jp-highschool', 'magic-academy',
    'ru-school', 'ru-university', 'space-academy', 'us-college', 'us-highschool', 'xianxia-sect'];
  for (const id of ids) {
    assert.ok(SETTING_LOOKS[id], `нет одежды для ${id}`);
    const p = buildPortraitPrompt({ id: 'x', name: 'Мила' }, { kind: 'classmate', presetId: id });
    assert.equal(hasCyrillic(p.tags), false, `${id}: ${p.tags}`);
  }
  assert.ok(buildPortraitPrompt({ id: 'x', name: 'Мила' }, { kind: 'teacher', presetId: 'xianxia-sect' }).tags.includes('hanfu'));
  assert.ok(buildPortraitPrompt({ id: 'x', name: 'Мила' }, { kind: 'classmate', presetId: 'space-academy' }).tags.includes('futuristic uniform'));
  // Свой пресет — по основе; неизвестный — общая «академия».
  assert.ok(buildPortraitPrompt({ id: 'x' }, { kind: 'classmate', presetId: 'my-own', basedOn: 'magic-academy' }).tags.includes('academy robe'));
  assert.ok(buildPortraitPrompt({ id: 'x' }, { kind: 'classmate', presetId: 'my-own' }).text.includes('an academy uniform'));
});

test('промпт: пустые поля — нейтрально, без пола и без пустых кусков', () => {
  const p = buildPortraitPrompt({ id: 'x', name: 'Ш.' }, { kind: 'classmate' });
  assert.ok(!/1girl|1boy/.test(p.tags));
  assert.match(p.text, /^Head-and-shoulders portrait of a young person, a student, wearing/);
  assert.ok(!/ ,|, ,|undefined|null/.test(p.tags + p.text), p.text);
  assert.ok(!/Appearance|Character/.test(p.text));
  const t = buildPortraitPrompt({}, { kind: 'teacher' });
  assert.match(t.text, /an adult person, a teacher, wearing/);
  assert.ok(t.tags.includes('adult'));
});

test('промпт: своё описание латиницей идёт в теги как есть, русское — только словарём', () => {
  const lat = buildPortraitPrompt({ id: 'x', name: 'Мила', looks: 'silver hair, heterochromia' }, { kind: 'classmate' });
  assert.ok(lat.tags.includes('silver hair') && lat.tags.includes('heterochromia'));
  assert.match(lat.text, /silver hair, heterochromia/);
  const ru = buildPortraitPrompt({ id: 'x', name: 'Мила', looks: 'с веснушками и косой, глаза как море' }, { kind: 'classmate' });
  assert.equal(hasCyrillic(ru.tags), false);
  assert.ok(ru.tags.includes('freckles') && ru.tags.includes('braid'));
  assert.match(ru.text, /"с веснушками и косой, глаза как море"/);
});

test('промпт: стиль — аниме по умолчанию, реализм и акварель меняют обе формы', () => {
  assert.deepEqual(Object.keys(DRAW_STYLES), ['anime', 'realism', 'watercolor']);
  const real = buildPortraitPrompt({ id: 'x', name: 'Мила' }, { kind: 'classmate', style: 'realism' });
  assert.ok(real.tags.includes('realistic') && real.negative.includes('anime'));
  assert.match(real.text, /realistic digital painting/);
  const wc = buildPortraitPrompt({ id: 'x', name: 'Мила' }, { kind: 'classmate', style: 'watercolor' });
  assert.ok(wc.tags.includes('watercolor (medium)'));
  assert.match(buildPortraitPrompt({ id: 'x' }, { kind: 'classmate', style: 'нет такого' }).text, /painterly anime style/);
});

test('пол: явное поле, слова описания, имя; иначе — не знаем', () => {
  assert.equal(guessGender({ name: 'Вера', gender: 'm' }), 'm');
  assert.equal(guessGender({ name: 'Саша', looks: 'высокая девушка' }), 'f');
  assert.equal(guessGender({ name: 'Rin', looks: 'boy, short hair' }), 'm');
  assert.equal(guessGender({ name: 'Олег' }), 'm');
  assert.equal(guessGender({ name: 'Rin' }), null);
  assert.equal(portraitFacts({ name: 'Rin' }, { kind: 'classmate' }).gender, null);
});

// --- своё описание внешности в состоянии -----------------------------------------

test('описание внешности: одна строка до потолка; лежит у преподавателя и однокурсника', () => {
  assert.equal(normalizeLooks('  рыжая,\n в очках  '), 'рыжая, в очках');
  assert.equal(normalizeLooks('х'.repeat(LOOKS_MAX + 50)).length, LOOKS_MAX);
  assert.equal(normalizeLooks(42), '');

  const SUBJECTS = [{ id: 'chem', name: 'химия', teacherId: 'petrova' }];
  const s = createState(preset, {
    startDay: '2026-09-01', subjects: SUBJECTS, teachers: [{ id: 'petrova', name: 'Петрова', looks: ' рыжая ' }],
    schedule: buildSchedule(SUBJECTS, preset), classmates: [{ id: 'vera', name: 'Вера', looks: 'в очках' }],
  });
  assert.equal(s.teachers[0].looks, 'рыжая');
  assert.equal(s.classmates[0].looks, 'в очках');
  assert.deepEqual(validateState(s).errors || [], []);
  s.teachers[0].looks = 'х'.repeat(LOOKS_MAX + 1);
  assert.ok((validateState(s).errors || []).some((e) => /внешност/.test(e)));

  const c = normalizeClassmate({ name: 'Мила', looks: '' }, preset);
  assert.equal('looks' in c, false);
  const st = { classmates: [c], teachers: [] };
  assert.equal(updateClassmate(st, c.id, { looks: 'с косой' }, preset).ok, true);
  assert.equal(st.classmates[0].looks, 'с косой');
  updateClassmate(st, c.id, { looks: '' }, preset);
  assert.equal('looks' in st.classmates[0], false);
  st.classmates[0].looks = '';
  assert.ok(classmateErrors(st).some((e) => /внешност/.test(e)));
});

// --- доступность путей ----------------------------------------------------------

const KEY = [{ id: '1', value: '****', active: true }];

test('доступность: пути — только с ключом в secret_state, по порядку предпочтения', () => {
  assert.deepEqual(availableRoutes({ secrets: {} }), []);
  assert.deepEqual(availableRoutes({ secrets: { [SECRETS.NOVEL]: KEY } }), ['novel']);
  assert.deepEqual(availableRoutes({ secrets: { [SECRETS.OPENAI]: KEY, [SECRETS.OPENROUTER]: KEY } }), ['openai', 'openrouter']);
  assert.deepEqual(availableRoutes({ secrets: { [SECRETS.MAKERSUITE]: KEY } }), ['gemini', 'imagen']);
  assert.deepEqual(availableRoutes({ secrets: { [SECRETS.VERTEXAI_SERVICE_ACCOUNT]: KEY } }), ['gemini', 'imagen']);
  // Пустой список ключей — это «нет ключа»; старая таверна отдавала `true`.
  assert.deepEqual(availableRoutes({ secrets: { [SECRETS.NOVEL]: [], [SECRETS.OPENAI]: null } }), []);
  assert.equal(hasSecret({ a: true }, 'a'), true);
  // Генерация таверны — первой, если есть `/imagine` и источник готов.
  const all = availableRoutes({
    secrets: { [SECRETS.NOVEL]: KEY, [SECRETS.OPENAI]: KEY, [SECRETS.MAKERSUITE]: KEY, [SECRETS.OPENROUTER]: KEY },
    imagine: true, sd: { source: 'novel' },
  });
  assert.deepEqual(all, DRAW_ROUTES);
  assert.deepEqual(availableRoutes({ secrets: {}, imagine: false, sd: { source: 'horde' } }), []);
  assert.deepEqual(availableRoutes({ secrets: {}, imagine: true, sd: { source: 'openai' } }), []);
});

test('доступность: источник таверны — как её isValidState', () => {
  assert.equal(sdSourceReady({}, {}), false);
  assert.equal(sdSourceReady({ source: 'horde' }, {}), true);
  assert.equal(sdSourceReady({ source: 'auto' }, {}), false);
  assert.equal(sdSourceReady({ source: 'auto', auto_url: 'http://127.0.0.1:7860' }, {}), true);
  assert.equal(sdSourceReady({ source: 'comfy', comfy_url: 'http://x' }, {}), true);
  assert.equal(sdSourceReady({ source: 'comfy', comfy_type: 'runpod_serverless', comfy_runpod_url: 'u' }, {}), false);
  assert.equal(sdSourceReady({ source: 'google' }, { [SECRETS.VERTEXAI]: KEY }), true);
  assert.equal(sdSourceReady({ source: 'openrouter' }, { [SECRETS.OPENROUTER]: KEY }), true);
  assert.equal(sdSourceReady({ source: 'pollinations' }, { api_key_pollinations: KEY }), true);
  assert.equal(sdSourceReady({ source: 'extras' }, {}, { modules: ['sd'] }), true);
  assert.equal(sdSourceReady({ source: 'workersai' }, { api_key_workers_ai: KEY }, { workersAccount: '' }), false);
  // Теги — SD-подобным, фраза — остальным.
  assert.equal(promptForm('tavern', 'novel'), 'tags');
  assert.equal(promptForm('tavern', 'comfy'), 'tags');
  assert.equal(promptForm('tavern', 'openai'), 'text');
  assert.equal(promptForm('novel'), 'tags');
  assert.equal(promptForm('gemini'), 'text');
});

test('выбор пути и модели: из настроек, если доступно; иначе первое', () => {
  assert.equal(pickRoute('openai', ['novel', 'openai']), 'openai');
  assert.equal(pickRoute('openai', ['novel']), 'novel');
  assert.equal(pickRoute('', []), null);
  assert.equal(pickModel('novel', {}), 'nai-diffusion-4-5-full');
  assert.equal(pickModel('openai', { openai: 'dall-e-3' }), 'dall-e-3');
  assert.equal(pickModel('openai', { openai: 'gpt-9' }), 'gpt-image-1');
  assert.equal(pickModel('tavern', {}), '');
  assert.deepEqual(normalizeDrawSettings({ route: 'xx', models: { novel: 'bad', openai: 'dall-e-3' }, style: 'x', naiSize: 'huge' }),
    { route: '', models: { openai: 'dall-e-3' }, style: 'anime', naiSize: 'portrait' });
  // Умолчания настроек — те же, что знает ядро.
  assert.deepEqual(DEFAULT_SETTINGS.draw, { route: '', models: {}, style: 'anime', naiSize: 'portrait' });
});

// --- тела запросов ---------------------------------------------------------------

const PROMPT = { tags: '1girl, solo', negative: 'lowres', text: 'Head-and-shoulders portrait of a woman.' };

test('запросы: NovelAI — теги, негатив, 28 шагов, euler ancestral + karras, 832×1216', () => {
  const r = drawRequest('novel', { model: 'nai-diffusion-4-5-curated', prompt: PROMPT });
  assert.equal(r.url, '/api/novelai/generate-image');
  assert.deepEqual(r.body, {
    prompt: '1girl, solo', negative_prompt: 'lowres', model: 'nai-diffusion-4-5-curated', sampler: 'k_euler_ancestral',
    scheduler: 'karras', steps: 28, scale: 5.5, width: 832, height: 1216, seed: -1,
  });
  const sq = drawRequest('novel', { prompt: PROMPT, naiSize: 'square' });
  assert.equal(sq.body.width, 1024);
  assert.equal(sq.body.model, 'nai-diffusion-4-5-full');
});

test('запросы: GPT — gpt-image без response_format и с moderation low, DALL·E 3 — b64_json', () => {
  const g = drawRequest('openai', { model: 'gpt-image-1', prompt: PROMPT });
  assert.equal(g.url, '/api/openai/generate-image');
  assert.equal(g.body.prompt, PROMPT.text);
  assert.equal(g.body.moderation, 'low');
  assert.equal(g.body.size, '1024x1024');
  assert.equal('response_format' in g.body, false);
  const d = drawRequest('openai', { model: 'dall-e-3', prompt: PROMPT });
  assert.equal(d.body.response_format, 'b64_json');
  assert.equal('moderation' in d.body, false);
});

test('запросы: Nano Banana через Gemini — маршрут чата, request_images, 1:1; gemini-3 — ещё 1K; Vertex — параметры из таверны', () => {
  const r = drawRequest('gemini', { model: 'gemini-2.5-flash-image', prompt: PROMPT, google: 'makersuite' });
  assert.equal(r.url, '/api/backends/chat-completions/generate');
  assert.equal(r.body.chat_completion_source, 'makersuite');
  assert.equal(r.body.request_images, true);
  assert.equal(r.body.stream, false);
  assert.equal(r.body.request_image_aspect_ratio, '1:1');
  assert.equal('request_image_resolution' in r.body, false);
  assert.deepEqual(r.body.messages, [{ role: 'user', content: PROMPT.text }]);
  assert.equal('vertexai_region' in r.body, false);
  const v = drawRequest('gemini', {
    model: 'gemini-3-pro-image-preview', prompt: PROMPT, google: 'vertexai',
    vertex: { vertexai_auth_mode: 'express', vertexai_region: 'global', vertexai_express_project_id: 'p', secret: 'нет' },
  });
  assert.equal(v.body.chat_completion_source, 'vertexai');
  assert.equal(v.body.request_image_resolution, '1K');
  assert.equal(v.body.vertexai_region, 'global');
  assert.equal('secret' in v.body, false);
  // Все модели Gemini — из белого списка сервера таверны.
  const allowed = ['gemini-2.5-flash-image', 'gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview'];
  for (const m of DRAW_MODELS.gemini) assert.ok(allowed.includes(m.id), m.id);
});

test('запросы: OpenRouter и Imagen', () => {
  const o = drawRequest('openrouter', { prompt: PROMPT });
  assert.deepEqual(o, { url: '/api/openrouter/image/generate', body: { model: 'google/gemini-2.5-flash-image', prompt: PROMPT.text, aspect_ratio: '1:1' } });
  const i = drawRequest('imagen', { prompt: PROMPT, google: 'makersuite' });
  assert.equal(i.url, '/api/google/generate-image');
  assert.equal(i.body.api, 'makersuite');
  assert.equal(i.body.aspect_ratio, '1:1');
  assert.throws(() => drawRequest('nope', {}));
});

// --- разбор ответов ---------------------------------------------------------------

test('ответы: NovelAI — голый base64 текстом; пусто — отказ «пустой ответ»', () => {
  assert.deepEqual(parseNovelResponse(`${PNG}\n`), { ok: true, base64: PNG, mime: 'image/png' });
  assert.equal(parseNovelResponse(`"${PNG}"`).ok, true);
  assert.equal(parseNovelResponse('').code, 'empty');
  assert.equal(parseNovelResponse('<html>oops</html>').code, 'empty');
});

test('ответы: OpenAI — data[0].b64_json; ссылка или пусто — отказ', () => {
  assert.deepEqual(parseOpenAIResponse({ created: 1, data: [{ b64_json: PNG, revised_prompt: 'x' }] }), { ok: true, base64: PNG, mime: 'image/png' });
  assert.equal(parseOpenAIResponse({ data: [{ url: 'https://x' }] }).code, 'empty');
  assert.equal(parseOpenAIResponse({ data: [] }).code, 'empty');
  assert.equal(parseOpenAIResponse(null).code, 'empty');
  assert.match(parseOpenAIResponse({ error: { message: 'billing hard limit' } }).error, /billing hard limit/);
});

test('ответы: Gemini — картинка в responseContent.parts[].inlineData, мысли пропускаются', () => {
  const ok = parseGeminiResponse({
    choices: [{ message: { content: 'Here you go' } }],
    responseContent: { parts: [
      { text: 'думаю', thought: true },
      { inlineData: { mimeType: 'image/png', data: `${'A'.repeat(10)}` }, thought: true },
      { text: 'Here you go' },
      { inlineData: { mimeType: 'image/jpeg', data: JPG } },
    ] },
  });
  assert.deepEqual(ok, { ok: true, base64: JPG, mime: 'image/jpeg' });
  // Отказ сервер шлёт статусом 200 и `{error: {message}}`.
  assert.equal(parseGeminiResponse({ error: { message: 'Google AI Studio API returned no candidate\nPrompt was blocked due to : PROHIBITED_CONTENT' } }).code, 'filter');
  assert.equal(parseGeminiResponse({ error: { message: 'Google AI Studio Candidate text empty' } }).code, 'filter');
  // Модель поговорила, но не нарисовала.
  const talk = parseGeminiResponse({ choices: [], responseContent: { parts: [{ text: 'I cannot draw that.' }] } });
  assert.equal(talk.code, 'no-image');
  assert.match(talk.error, /I cannot draw that/);
  assert.equal(parseGeminiResponse({}).code, 'empty');
});

test('ответы: OpenRouter — {format, image}; Imagen — {image} JPEG', () => {
  assert.deepEqual(parseOpenRouterResponse({ format: 'png', image: PNG }), { ok: true, base64: PNG, mime: 'image/png' });
  assert.equal(parseOpenRouterResponse({ format: 'jpg', image: JPG }).mime, 'image/jpeg');
  assert.equal(parseOpenRouterResponse({ error: 'OpenRouter API key not found' }).code, 'provider');
  assert.deepEqual(parseImagenResponse({ image: JPG }), { ok: true, base64: JPG, mime: 'image/jpeg' });
  assert.equal(parseImagenResponse({}).code, 'empty');
  assert.equal(parseDrawResponse('novel', PNG).ok, true);
  assert.equal(parseDrawResponse('tavern', PNG).ok, false);
});

test('base64: data URL и пробелы снимаются, тип — по первым байтам', () => {
  assert.equal(cleanBase64(`data:image/png;base64,${PNG.slice(0, 40)}\n${PNG.slice(40)}`), PNG);
  assert.equal(cleanBase64('short'), null);
  assert.equal(cleanBase64(`${PNG}!!`), null);
  assert.equal(sniffMime(PNG), 'image/png');
  assert.equal(sniffMime(JPG), 'image/jpeg');
  assert.equal(sniffMime('UklGRxxxx'), 'image/webp');
  assert.equal(sniffMime('zzz', 'image/jpeg'), 'image/jpeg');
});

test('отказы HTTP: 400 — нет ключа, модерация — фильтр, прочее — слова провайдера', () => {
  const nk = httpFailure('novel', 400, 'Bad Request');
  assert.equal(nk.code, 'no-key');
  assert.match(nk.error, /NovelAI/);
  assert.equal(httpFailure('openai', 500, JSON.stringify({ error: { message: 'Your request was rejected by the safety system', code: 'moderation_blocked' } })).code, 'filter');
  assert.equal(httpFailure('gemini', 500, JSON.stringify({ error: { code: 429, message: 'Quota exceeded for model' } })).error, 'Провайдер отказал: Quota exceeded for model');
  assert.match(httpFailure('openrouter', 500, 'Internal Server Error').error, /консоли/);
  assert.match(httpFailure('gemini', 500, JSON.stringify({ error: true })).error, /консоли/);
  assert.match(timeoutFailure(120000).error, /120 секунд/);
});

test('путь от генерации таверны: только картинка', () => {
  assert.equal(isImagePath('user/images/2026-10-08@12h00m00s.png'), true);
  assert.equal(isImagePath('/user/images/x.JPG?v=1'), true);
  assert.equal(isImagePath('user/images/clip.mp4'), false);
  assert.equal(isImagePath(''), false);
});

// --- путь «как в таверне» ----------------------------------------------------------

function fakeCtx(callback, sd = { source: 'horde' }) {
  return {
    SlashCommandParser: { commands: { imagine: { callback } } },
    extensionSettings: { sd },
    chatCompletionSettings: {},
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
  };
}

test('«как в таверне»: /imagine с quiet, без галереи, extend и edit; теги — SD-подобным источникам', async () => {
  const calls = [];
  const ctx = fakeCtx(async (args, prompt) => { calls.push([args, prompt]); return 'user/images/a.png'; });
  const info = drawInfo(ctx, {});
  assert.equal(info.route, 'tavern');
  assert.match(info.available[0].label, /таверне \(horde\)/);
  const res = await drawImage(ctx, {}, { tags: 'TAGS', negative: 'NEG', text: 'TEXT' }, { personId: 'vera' });
  assert.deepEqual(res, { ok: true, path: 'user/images/a.png', route: 'tavern' });
  const [args, prompt] = calls[0];
  assert.equal(prompt, 'TAGS');
  assert.equal(args.quiet, 'true');
  assert.equal(args.gallery, 'false');
  assert.equal(args.extend, 'false');
  assert.equal(args.edit, 'false');
  assert.equal(args.negative, 'NEG');
  assert.equal(typeof args._abortController.addEventListener, 'function');

  const ctx2 = fakeCtx(async (a, p) => { calls.push([a, p]); return ''; }, { source: 'openrouter' });
  // Ключа OpenRouter в secret_state нет (таверны в тестах нет) — путь недоступен.
  const none = await drawImage(ctx2, {}, { tags: 'T', text: 'X' }, { personId: 'vera' });
  assert.equal(none.code, 'no-route');
  assert.equal(none.error, DRAW_TEXT.noRoute);
  assert.equal(drawInfo(ctx2, {}).hint, DRAW_TEXT.noRoute);
});

test('«как в таверне»: пусто, видео, отмена и таймаут — понятным отказом', async () => {
  assert.equal((await drawImage(fakeCtx(async () => ''), {}, PROMPT, { personId: 'v' })).code, 'empty');
  assert.equal((await drawImage(fakeCtx(async () => 'user/images/v.mp4'), {}, PROMPT, { personId: 'v' })).code, 'not-image');

  let stopped = 0;
  const slow = fakeCtx((args) => new Promise((resolve) => {
    args._abortController.addEventListener('abort', () => { stopped += 1; });
    setTimeout(() => resolve('user/images/late.png'), 200);
  }));
  const ctrl = new AbortController();
  const pending = drawImage(slow, {}, PROMPT, { personId: 'v', signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), 10);
  const aborted = await pending;
  assert.equal(aborted.code, 'aborted');
  assert.equal(stopped, 1, 'генерации таверны сказали «стоп»');

  const timed = await drawImage(slow, {}, PROMPT, { personId: 'v', timeoutMs: 20 });
  assert.equal(timed.code, 'timeout');
});

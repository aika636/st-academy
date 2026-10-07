// core/draw — чистая часть «Нарисовать портрет» (аватарки, шаг 4): какие пути
// рисования есть, какой доступен, что послать серверу таверны и как прочитать
// ответ. Запросы, холст и сохранение — в браузерном `draw.js`.
//
// Все пути идут через сервер таверны и её secrets: ключ в браузер не вводится
// и в браузер не попадает (с телефона его и ввести-то негде). Поэтому
// доступность пути — это «у таверны есть ключ нужного провайдера»
// (`secret_state`), а не «человек вписал ключ в Академию».
//
// Пути — по порядку предпочтения:
//
// 1. `tavern` — генерация картинок таверны как она настроена (обработчик
//    `/imagine` с `quiet`, источник и модель — из её настроек). Источник не
//    трогается: `/imagine-source` меняет его навсегда;
// 2. `novel` — NovelAI, `POST /api/novelai/generate-image`, ответ — голый base64;
// 3. `openai` — GPT Image и DALL·E 3, `POST /api/openai/generate-image`;
// 4. `gemini` — Nano Banana через Google AI Studio или Vertex AI, тот же
//    маршрут, что у чата (`/api/backends/chat-completions/generate`) с
//    `request_images`;
// 5. `openrouter` — Nano Banana через OpenRouter, `POST /api/openrouter/image/generate`;
// 6. `imagen` — Google Imagen, `POST /api/google/generate-image`.
//
// Формы ответов сверены с сервером таверны 1.18.0: `novelai.js:300`,
// `openai.js:629`, `backends/chat-completions.js:707–742`, `openrouter.js:138`,
// `google.js:432`.

/** Имена ключей в `secret_state` таверны (`public/scripts/secrets.js: SECRET_KEYS`). */
export const SECRETS = {
  NOVEL: 'api_key_novel',
  OPENAI: 'api_key_openai',
  MAKERSUITE: 'api_key_makersuite',
  VERTEXAI: 'api_key_vertexai',
  VERTEXAI_SERVICE_ACCOUNT: 'vertexai_service_account_json',
  OPENROUTER: 'api_key_openrouter',
};

/** Пути рисования — по порядку предпочтения. */
export const DRAW_ROUTES = ['tavern', 'novel', 'openai', 'gemini', 'openrouter', 'imagen'];

/** Подписи путей для выбора «Чем рисовать». */
export const ROUTE_LABELS = {
  tavern: 'Как настроено в таверне',
  novel: 'NovelAI',
  openai: 'GPT (OpenAI)',
  gemini: 'Nano Banana (Google Gemini)',
  openrouter: 'Nano Banana (OpenRouter)',
  imagen: 'Google Imagen',
};

/** Провайдер словами — для отказов «нет ключа». */
export const ROUTE_PROVIDER = {
  tavern: 'генерации картинок таверны',
  novel: 'NovelAI',
  openai: 'OpenAI',
  gemini: 'Google AI Studio / Vertex AI',
  openrouter: 'OpenRouter',
  imagen: 'Google AI Studio / Vertex AI',
};

/** Модели на выбор; первая — умолчание. У `tavern` своих нет: модель — из таверны. */
export const DRAW_MODELS = {
  novel: [
    { id: 'nai-diffusion-4-5-full', label: 'NAI Diffusion V4.5 Full' },
    { id: 'nai-diffusion-4-5-curated', label: 'NAI Diffusion V4.5 Curated' },
    { id: 'nai-diffusion-4-full', label: 'NAI Diffusion V4 Full' },
    { id: 'nai-diffusion-3', label: 'NAI Diffusion Anime V3' },
  ],
  openai: [
    { id: 'gpt-image-1', label: 'gpt-image-1' },
    { id: 'gpt-image-1-mini', label: 'gpt-image-1-mini (дешевле)' },
    { id: 'dall-e-3', label: 'DALL·E 3' },
  ],
  // Модель должна быть в белом списке сервера (`imageGenerationModels`,
  // chat-completions.js:482), иначе картинку он не попросит вовсе.
  gemini: [
    { id: 'gemini-2.5-flash-image', label: 'Nano Banana (gemini-2.5-flash-image)' },
    { id: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2 (gemini-3.1-flash-image-preview)' },
    { id: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro (gemini-3-pro-image-preview)' },
  ],
  openrouter: [
    { id: 'google/gemini-2.5-flash-image', label: 'Nano Banana (google/gemini-2.5-flash-image)' },
    { id: 'google/gemini-3-pro-image-preview', label: 'Nano Banana Pro (google/gemini-3-pro-image-preview)' },
  ],
  imagen: [
    { id: 'imagen-4.0-generate-001', label: 'Imagen 4' },
    { id: 'imagen-4.0-fast-generate-001', label: 'Imagen 4 Fast' },
    { id: 'imagen-3.0-generate-002', label: 'Imagen 3' },
  ],
};

/** Размер NAI: портретный (832×1216) или квадрат (1024×1024). Оба — до 1 Мп. */
export const NAI_SIZES = {
  portrait: { width: 832, height: 1216 },
  square: { width: 1024, height: 1024 },
};

/** Сколько ждать картинку, мс. Генерация — 10–60 с; две минуты — с запасом. */
export const DRAW_TIMEOUT = 120000;

/** Умолчания блока настроек «Портреты» (`extension_settings.academy.draw`). */
export const DEFAULT_DRAW_SETTINGS = {
  /** Путь (`DRAW_ROUTES`); пусто — первый доступный. */
  route: '',
  /** Модель на каждый путь: `{ novel: 'nai-…', … }`; нет — первая из списка. */
  models: {},
  /** Стиль (`draw-prompt.DRAW_STYLES`). */
  style: 'anime',
  /** Размер NAI (`NAI_SIZES`). */
  naiSize: 'portrait',
};

/** Есть ли у таверны ключ: в `secret_state` — список ключей, в старых — `true`. */
export function hasSecret(secrets, key) {
  const v = secrets ? secrets[key] : undefined;
  return Array.isArray(v) ? v.length > 0 : Boolean(v);
}

/** Есть ли ключ Google: AI Studio, Vertex Express или служебный аккаунт Vertex. */
export function googleSource(secrets) {
  if (hasSecret(secrets, SECRETS.MAKERSUITE)) return 'makersuite';
  if (hasSecret(secrets, SECRETS.VERTEXAI) || hasSecret(secrets, SECRETS.VERTEXAI_SERVICE_ACCOUNT)) return 'vertexai';
  return null;
}

/**
 * Готов ли источник генерации картинок таверны — то же, что её
 * `isValidState` (stable-diffusion/index.js:5076): адрес у локальных, ключ у
 * облачных. Ключи облачных — по имени `api_key_<источник>`, кроме тех, у
 * кого оно другое.
 *
 * @param {Object} sd `extension_settings.sd`
 * @param {Object} secrets `secret_state`
 * @param {{modules?: string[], workersAccount?: string}} [extra]
 */
export function sdSourceReady(sd, secrets, extra = {}) {
  const s = sd && typeof sd === 'object' ? sd : {};
  const source = String(s.source || '');
  if (!source) return false;
  switch (source) {
    case 'extras': return Array.isArray(extra.modules) && extra.modules.includes('sd');
    case 'horde': return true;
    case 'auto': return Boolean(s.auto_url);
    case 'sdcpp': return Boolean(s.sdcpp_url);
    case 'drawthings': return Boolean(s.drawthings_url);
    case 'vlad': return Boolean(s.vlad_url);
    case 'comfy':
      if (s.comfy_type === 'runpod_serverless') return Boolean(s.comfy_runpod_url) && hasSecret(secrets, 'api_key_comfy_runpod');
      return Boolean(s.comfy_url);
    case 'google': return googleSource(secrets) !== null;
    case 'workersai': return Boolean(extra.workersAccount) && hasSecret(secrets, 'api_key_workers_ai');
    case 'novel': return hasSecret(secrets, SECRETS.NOVEL);
    default: return hasSecret(secrets, `api_key_${source}`);
  }
}

/**
 * Источники таверны, которым подходят теги (SD-подобные модели); остальным
 * (DALL·E, Imagen, Flux, Nano Banana…) — фраза.
 */
export const TAG_SOURCES = ['novel', 'auto', 'vlad', 'sdcpp', 'comfy', 'horde', 'drawthings', 'extras'];

/** Какую форму промпта ждёт путь: `'tags'` или `'text'`. */
export function promptForm(route, sdSource = '') {
  if (route === 'novel') return 'tags';
  if (route === 'tavern') return TAG_SOURCES.includes(String(sdSource || '')) ? 'tags' : 'text';
  return 'text';
}

/**
 * Доступные пути по порядку предпочтения.
 *
 * @param {Object} env
 * @param {Object} env.secrets `secret_state` таверны
 * @param {boolean} env.imagine есть ли обработчик `/imagine`
 * @param {Object} [env.sd] `extension_settings.sd`
 * @param {string[]} [env.modules] модули Extras
 * @param {string} [env.workersAccount] `oai_settings.workers_ai_account_id`
 * @returns {string[]}
 */
export function availableRoutes(env = {}) {
  const secrets = env.secrets || {};
  const out = [];
  if (env.imagine && sdSourceReady(env.sd, secrets, env)) out.push('tavern');
  if (hasSecret(secrets, SECRETS.NOVEL)) out.push('novel');
  if (hasSecret(secrets, SECRETS.OPENAI)) out.push('openai');
  if (googleSource(secrets)) out.push('gemini');
  if (hasSecret(secrets, SECRETS.OPENROUTER)) out.push('openrouter');
  if (googleSource(secrets)) out.push('imagen');
  return out;
}

/** Путь из настроек, если он доступен; иначе первый доступный; нет — `null`. */
export function pickRoute(wanted, available) {
  const list = Array.isArray(available) ? available : [];
  if (wanted && list.includes(wanted)) return wanted;
  return list[0] || null;
}

/** Модель пути: из настроек, если она в списке; иначе первая. У `tavern` — ''. */
export function pickModel(route, models = {}) {
  const list = DRAW_MODELS[route];
  if (!list) return '';
  const want = models && typeof models === 'object' ? models[route] : '';
  return list.some((m) => m.id === want) ? want : list[0].id;
}

/** Настройки «Портреты» к форме: чужое и битое — к умолчанию. */
export function normalizeDrawSettings(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const models = {};
  for (const [route, list] of Object.entries(DRAW_MODELS)) {
    const v = r.models && typeof r.models === 'object' ? r.models[route] : '';
    if (list.some((m) => m.id === v)) models[route] = v;
  }
  return {
    route: DRAW_ROUTES.includes(r.route) ? r.route : '',
    models,
    style: ['anime', 'realism', 'watercolor'].includes(r.style) ? r.style : DEFAULT_DRAW_SETTINGS.style,
    naiSize: NAI_SIZES[r.naiSize] ? r.naiSize : DEFAULT_DRAW_SETTINGS.naiSize,
  };
}

const isGemini3 = (model) => /^gemini-3/.test(String(model || ''));

/**
 * Запрос к серверу таверны для прямого пути: адрес и тело. Заголовки
 * (`getRequestHeaders`) ставит браузерная часть.
 *
 * @param {string} route `novel` | `openai` | `gemini` | `openrouter` | `imagen`
 * @param {Object} o
 * @param {string} o.model
 * @param {{tags: string, negative: string, text: string}} o.prompt
 * @param {string} [o.naiSize]
 * @param {string} [o.google] `makersuite` | `vertexai`
 * @param {Object} [o.vertex] `{vertexai_auth_mode, vertexai_region, vertexai_express_project_id}` из настроек чата таверны
 * @returns {{url: string, body: Object}}
 */
export function drawRequest(route, o = {}) {
  const model = o.model || pickModel(route, {});
  const p = o.prompt || {};
  const vertex = o.google === 'vertexai' && o.vertex && typeof o.vertex === 'object' ? {
    vertexai_auth_mode: o.vertex.vertexai_auth_mode,
    vertexai_region: o.vertex.vertexai_region,
    vertexai_express_project_id: o.vertex.vertexai_express_project_id,
  } : {};
  switch (route) {
    case 'novel': {
      const size = NAI_SIZES[o.naiSize] || NAI_SIZES.portrait;
      return {
        url: '/api/novelai/generate-image',
        body: {
          prompt: p.tags || '',
          negative_prompt: p.negative || '',
          model,
          sampler: 'k_euler_ancestral',
          scheduler: 'karras',
          steps: 28,
          scale: 5.5,
          width: size.width,
          height: size.height,
          seed: -1,
        },
      };
    }
    case 'openai': {
      // DALL·E 3 без `response_format` вернёт ссылку на час, а не картинку;
      // у gpt-image такого поля нет вовсе — он всегда отдаёт base64.
      const body = model === 'dall-e-3'
        ? { model, prompt: p.text || '', n: 1, size: '1024x1024', quality: 'standard', response_format: 'b64_json' }
        : { model, prompt: p.text || '', n: 1, size: '1024x1024', quality: 'medium', moderation: 'low' };
      return { url: '/api/openai/generate-image', body };
    }
    case 'gemini': {
      const body = {
        chat_completion_source: o.google === 'vertexai' ? 'vertexai' : 'makersuite',
        model,
        messages: [{ role: 'user', content: p.text || '' }],
        stream: false,
        request_images: true,
        // Обязательно: без него сервер напишет в запрос строку 'undefined'.
        request_image_aspect_ratio: '1:1',
        ...vertex,
      };
      if (isGemini3(model)) body.request_image_resolution = '1K';
      return { url: '/api/backends/chat-completions/generate', body };
    }
    case 'openrouter':
      return { url: '/api/openrouter/image/generate', body: { model, prompt: p.text || '', aspect_ratio: '1:1' } };
    case 'imagen':
      return {
        url: '/api/google/generate-image',
        body: { prompt: p.text || '', model, aspect_ratio: '1:1', api: o.google === 'vertexai' ? 'vertexai' : 'makersuite', ...vertex },
      };
    default:
      throw new Error(`нет такого пути рисования: ${route}`);
  }
}

// --- разбор ответов ----------------------------------------------------------

/** Короче не бывает настоящей картинки: и крошечный PNG длиннее. */
const MIN_BASE64 = 64;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Отказ «пустой ответ»: чаще всего картинку завернул фильтр провайдера. */
export const DRAW_TEXT = {
  empty: 'Провайдер вернул пустой ответ — похоже, картинку завернул его фильтр. Попробуйте «Ещё раз» или поправьте описание внешности.',
  filter: 'Провайдер отказался рисовать: сработал его фильтр содержимого. Поправьте описание внешности и попробуйте ещё раз.',
  noKey: 'У таверны нет ключа {provider}. Откройте в таверне подключение API этого провайдера, сохраните ключ и обновите страницу.',
  network: 'Нет связи с сервером таверны — проверьте, что таверна запущена, и попробуйте ещё раз.',
  timeout: 'Провайдер не ответил за {seconds} секунд. Попробуйте ещё раз позже.',
  aborted: 'Рисование отменено.',
  provider: 'Провайдер отказал: {why}',
  noRoute: 'Чтобы рисовать портреты, подключите генерацию картинок в таверне (NovelAI, OpenAI, Gemini или OpenRouter).',
  tavernEmpty: 'Генерация картинок таверны ничего не вернула. Подробности — во всплывашке таверны; проверьте её настройки «Генерация изображений».',
  notImage: 'Генерация таверны вернула не картинку (видео?) — для портрета выберите в таверне модель картинок.',
  noText: 'Модель ответила текстом, а не картинкой: {why}',
};

const fill = (t, vars) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

const fail = (code, error) => ({ ok: false, code, error });

/** Base64 картинки к чистому виду или `null`. Data URL — тоже годится. */
export function cleanBase64(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/is.exec(s);
  if (m) s = m[1];
  s = s.replace(/\s+/g, '');
  return s.length >= MIN_BASE64 && B64.test(s) ? s : null;
}

/** Тип картинки по первым байтам base64; не узнали — `fallback`. */
export function sniffMime(base64, fallback = 'image/png') {
  const s = String(base64 || '');
  if (s.startsWith('iVBOR')) return 'image/png';
  if (s.startsWith('/9j/')) return 'image/jpeg';
  if (s.startsWith('UklGR')) return 'image/webp';
  if (s.startsWith('R0lGOD')) return 'image/gif';
  return fallback;
}

const image = (base64, mime) => ({ ok: true, base64, mime: sniffMime(base64, mime) });

/** NovelAI: тело ответа — голый base64 PNG текстом. */
export function parseNovelResponse(text) {
  const b64 = cleanBase64(text);
  return b64 ? image(b64, 'image/png') : fail('empty', DRAW_TEXT.empty);
}

/** OpenAI: `{data: [{b64_json}]}`. Ссылка вместо картинки — тоже отказ. */
export function parseOpenAIResponse(json) {
  const item = json && Array.isArray(json.data) ? json.data[0] : null;
  const b64 = item ? cleanBase64(item.b64_json) : null;
  if (b64) return image(b64, 'image/png');
  if (json && json.error) return fail('provider', fill(DRAW_TEXT.provider, { why: errorWhy(json.error) }));
  return fail('empty', DRAW_TEXT.empty);
}

/**
 * Gemini через маршрут чата: `{choices, responseContent: {parts: [{inlineData:
 * {mimeType, data}}]}}`. Отказ сервер шлёт статусом 200 и `{error: {message}}`
 * («no candidate», «Prompt was blocked», «Candidate text empty»). Мысли модели
 * (`thought`) — не картинка.
 */
export function parseGeminiResponse(json) {
  if (!json || typeof json !== 'object') return fail('empty', DRAW_TEXT.empty);
  const parts = json.responseContent && Array.isArray(json.responseContent.parts) ? json.responseContent.parts : [];
  for (const part of parts) {
    if (!part || part.thought) continue;
    const data = part.inlineData || part.inline_data;
    const b64 = data ? cleanBase64(data.data) : null;
    if (b64) return image(b64, String(data.mimeType || data.mime_type || 'image/png'));
  }
  if (json.error) {
    const why = errorWhy(json.error);
    if (/block|safety|prohibit|empty|no candidate/i.test(why)) return fail('filter', DRAW_TEXT.filter);
    return fail('provider', fill(DRAW_TEXT.provider, { why }));
  }
  const said = parts.filter((x) => x && !x.thought && typeof x.text === 'string').map((x) => x.text).join(' ').trim();
  if (said) return fail('no-image', fill(DRAW_TEXT.noText, { why: said.slice(0, 160) }));
  return fail('empty', DRAW_TEXT.empty);
}

/** OpenRouter: `{format: 'png', image: base64}`. */
export function parseOpenRouterResponse(json) {
  const b64 = json ? cleanBase64(json.image) : null;
  if (b64) return image(b64, json.format ? `image/${String(json.format).replace(/^jpg$/i, 'jpeg')}` : 'image/png');
  if (json && json.error) return fail('provider', fill(DRAW_TEXT.provider, { why: errorWhy(json.error) }));
  return fail('empty', DRAW_TEXT.empty);
}

/** Imagen: `{image: base64}`, JPEG. */
export function parseImagenResponse(json) {
  const b64 = json ? cleanBase64(json.image) : null;
  return b64 ? image(b64, 'image/jpeg') : fail('empty', DRAW_TEXT.empty);
}

/** Разбор ответа пути: NAI — текст, остальные — JSON. */
export function parseDrawResponse(route, body) {
  switch (route) {
    case 'novel': return parseNovelResponse(body);
    case 'openai': return parseOpenAIResponse(body);
    case 'gemini': return parseGeminiResponse(body);
    case 'openrouter': return parseOpenRouterResponse(body);
    case 'imagen': return parseImagenResponse(body);
    default: return fail('empty', DRAW_TEXT.empty);
  }
}

/** Причина отказа строкой: строка, `{message}`, `{error: {message}}`. */
export function errorWhy(err) {
  if (!err) return '';
  if (typeof err === 'string') return err.trim();
  if (typeof err === 'object') {
    if (typeof err.message === 'string' && err.message.trim()) return err.message.trim();
    if (err.error) return errorWhy(err.error);
  }
  return '';
}

const FILTER_RE = /moderation|safety|content[_ ]?policy|blocked|prohibited|violat|not allowed|IMAGE_SAFETY|personGeneration/i;

/**
 * Неудачный HTTP-ответ сервера таверны — понятным текстом. 400 у всех прямых
 * маршрутов — «нет ключа» (сервер проверяет его первым и молча отвечает 400);
 * текст с модерацией — фильтр; прочее — отказ провайдера с его словами.
 *
 * @param {string} route
 * @param {number} status
 * @param {string} [text] тело ответа
 */
export function httpFailure(route, status, text = '') {
  const provider = ROUTE_PROVIDER[route] || route;
  const raw = String(text || '').trim();
  let why = raw;
  try {
    const parsed = JSON.parse(raw);
    why = typeof parsed === 'string' ? parsed : errorWhy(parsed);
  } catch { /* не JSON — как есть */ }
  if (FILTER_RE.test(why)) return fail('filter', DRAW_TEXT.filter);
  if (status === 400 || status === 401 || status === 403) return fail('no-key', fill(DRAW_TEXT.noKey, { provider }));
  // Пустое, «Internal Server Error», страница HTML, `{error: true}` — слов
  // провайдера нет: сервер таверны пишет их только в свою консоль.
  const plain = why && !/^<!doctype|^<html|^internal server error$/i.test(why);
  return fail('provider', fill(DRAW_TEXT.provider, {
    why: plain ? why.slice(0, 200) : `сервер таверны ответил ${status} — подробности в его консоли`,
  }));
}

/** Отказ «не дождались» и «отменено» — тем же видом, что остальные. */
export function timeoutFailure(ms = DRAW_TIMEOUT) {
  return fail('timeout', fill(DRAW_TEXT.timeout, { seconds: Math.round(ms / 1000) }));
}

export function abortedFailure() {
  return fail('aborted', DRAW_TEXT.aborted);
}

export function networkFailure() {
  return fail('network', DRAW_TEXT.network);
}

export function noKeyFailure(route) {
  return fail('no-key', fill(DRAW_TEXT.noKey, { provider: ROUTE_PROVIDER[route] || route }));
}

/** Путь, который вернул `/imagine`, годится ли в портрет-картинку. */
export function isImagePath(path) {
  const s = String(path || '').trim();
  return Boolean(s) && /\.(?:png|jpe?g|webp|gif|avif|bmp)$/i.test(s.split(/[?#]/)[0]);
}

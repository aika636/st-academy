import { normalizeStyleText } from './draw-prompt.mjs';

export const SECRETS = {
  NOVEL: 'api_key_novel',
  OPENAI: 'api_key_openai',
  MAKERSUITE: 'api_key_makersuite',
  VERTEXAI: 'api_key_vertexai',
  VERTEXAI_SERVICE_ACCOUNT: 'vertexai_service_account_json',
  OPENROUTER: 'api_key_openrouter',
};

export const DRAW_ROUTES = ['tavern', 'novel', 'openai', 'gemini', 'openrouter', 'imagen', 'custom'];

export const ROUTE_LABELS = {
  tavern: 'Как настроено в таверне',
  novel: 'NovelAI',
  openai: 'GPT (OpenAI)',
  gemini: 'Nano Banana (Google Gemini)',
  openrouter: 'Nano Banana (OpenRouter)',
  imagen: 'Google Imagen',
  custom: 'Свой адрес с ключом',
};

export const ROUTE_PROVIDER = {
  tavern: 'генерации картинок таверны',
  novel: 'NovelAI',
  openai: 'OpenAI',
  gemini: 'Google AI Studio / Vertex AI',
  openrouter: 'OpenRouter',
  imagen: 'Google AI Studio / Vertex AI',
  custom: 'свой адрес',
};

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

export const NAI_SIZES = {
  portrait: { width: 832, height: 1216 },
  square: { width: 1024, height: 1024 },
};

export const DRAW_TIMEOUT = 120000;

export const CUSTOM_TIMEOUT = 300000;

export const DEFAULT_DRAW_SETTINGS = {
  route: '',
  models: {},
  style: 'anime',
  styleText: '',
  naiSize: 'portrait',
  custom: { mode: 'openai', endpoint: '', key: '', model: '' },
};

export function hasSecret(secrets, key) {
  const v = secrets ? secrets[key] : undefined;
  return Array.isArray(v) ? v.length > 0 : Boolean(v);
}

export function googleSource(secrets) {
  if (hasSecret(secrets, SECRETS.MAKERSUITE)) return 'makersuite';
  if (hasSecret(secrets, SECRETS.VERTEXAI) || hasSecret(secrets, SECRETS.VERTEXAI_SERVICE_ACCOUNT)) return 'vertexai';
  return null;
}

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

export const TAG_SOURCES = ['novel', 'auto', 'vlad', 'sdcpp', 'comfy', 'horde', 'drawthings', 'extras'];

export function promptForm(route, sdSource = '', custom = null) {
  if (route === 'novel') return 'tags';
  if (route === 'custom') return custom ? customPromptForm(custom.mode, custom.model) : 'text';
  if (route === 'tavern') return TAG_SOURCES.includes(String(sdSource || '')) ? 'tags' : 'text';
  return 'text';
}

export function availableRoutes(env = {}) {
  const secrets = env.secrets || {};
  const out = [];
  if (env.imagine && sdSourceReady(env.sd, secrets, env)) out.push('tavern');
  if (hasSecret(secrets, SECRETS.NOVEL)) out.push('novel');
  if (hasSecret(secrets, SECRETS.OPENAI)) out.push('openai');
  if (googleSource(secrets)) out.push('gemini');
  if (hasSecret(secrets, SECRETS.OPENROUTER)) out.push('openrouter');
  if (googleSource(secrets)) out.push('imagen');
  out.push('custom');
  return out;
}

export function pickRoute(wanted, available) {
  const list = Array.isArray(available) ? available : [];
  if (wanted && list.includes(wanted)) return wanted;
  return list[0] || null;
}

export function pickModel(route, models = {}) {
  const list = DRAW_MODELS[route];
  if (!list) return '';
  const want = models && typeof models === 'object' ? models[route] : '';
  return list.some((m) => m.id === want) ? want : list[0].id;
}

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
    style: ['anime', 'realism', 'watercolor', 'own'].includes(r.style) ? r.style : DEFAULT_DRAW_SETTINGS.style,
    styleText: normalizeStyleText(r.styleText),
    naiSize: NAI_SIZES[r.naiSize] ? r.naiSize : DEFAULT_DRAW_SETTINGS.naiSize,
    custom: normalizeCustom(r.custom),
  };
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function normalizeCustom(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    mode: CUSTOM_MODE_IDS.includes(r.mode) ? r.mode : DEFAULT_DRAW_SETTINGS.custom.mode,
    endpoint: str(r.endpoint, 300),
    key: str(r.key, 600),
    model: str(r.model, 120),
  };
}

const isGemini3 = (model) => /^gemini-3/.test(String(model || ''));

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

const MIN_BASE64 = 64;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

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
  noCustom: 'Впишите адрес и ключ в блоке «Портреты».',
  linkFailed: 'Провайдер вернул ссылку, но картинка не скачалась: {why}',
  jobFailed: 'Naistera не нарисовала: {why}',
};

const fill = (t, vars) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

const fail = (code, error) => ({ ok: false, code, error });

export function cleanBase64(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.*)$/is.exec(s);
  if (m) s = m[1];
  s = s.replace(/\s+/g, '');
  return s.length >= MIN_BASE64 && B64.test(s) ? s : null;
}

export function sniffMime(base64, fallback = 'image/png') {
  const s = String(base64 || '');
  if (s.startsWith('iVBOR')) return 'image/png';
  if (s.startsWith('/9j/')) return 'image/jpeg';
  if (s.startsWith('UklGR')) return 'image/webp';
  if (s.startsWith('R0lGOD')) return 'image/gif';
  return fallback;
}

const image = (base64, mime) => ({ ok: true, base64, mime: sniffMime(base64, mime) });

export function parseNovelResponse(text) {
  const b64 = cleanBase64(text);
  return b64 ? image(b64, 'image/png') : fail('empty', DRAW_TEXT.empty);
}

export function parseOpenAIResponse(json) {
  const item = json && Array.isArray(json.data) ? json.data[0] : null;
  const b64 = item ? cleanBase64(item.b64_json) : null;
  if (b64) return image(b64, 'image/png');
  if (json && json.error) return fail('provider', fill(DRAW_TEXT.provider, { why: errorWhy(json.error) }));
  return fail('empty', DRAW_TEXT.empty);
}

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

export function parseOpenRouterResponse(json) {
  const b64 = json ? cleanBase64(json.image) : null;
  if (b64) return image(b64, json.format ? `image/${String(json.format).replace(/^jpg$/i, 'jpeg')}` : 'image/png');
  if (json && json.error) return fail('provider', fill(DRAW_TEXT.provider, { why: errorWhy(json.error) }));
  return fail('empty', DRAW_TEXT.empty);
}

export function parseImagenResponse(json) {
  const b64 = json ? cleanBase64(json.image) : null;
  return b64 ? image(b64, 'image/jpeg') : fail('empty', DRAW_TEXT.empty);
}

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

export function httpFailure(route, status, text = '') {
  const provider = ROUTE_PROVIDER[route] || route;
  const raw = String(text || '').trim();
  let why = raw;
  try {
    const parsed = JSON.parse(raw);
    why = typeof parsed === 'string' ? parsed : errorWhy(parsed);
  } catch {}
  if (FILTER_RE.test(why)) return fail('filter', DRAW_TEXT.filter);
  if (status === 400 || status === 401 || status === 403) return fail('no-key', fill(DRAW_TEXT.noKey, { provider }));
  const plain = why && !/^<!doctype|^<html|^internal server error$/i.test(why);
  return fail('provider', fill(DRAW_TEXT.provider, {
    why: plain ? why.slice(0, 200) : `сервер таверны ответил ${status} — подробности в его консоли`,
  }));
}

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

export function isImagePath(path) {
  const s = String(path || '').trim();
  return Boolean(s) && /\.(?:png|jpe?g|webp|gif|avif|bmp)$/i.test(s.split(/[?#]/)[0]);
}

const NAI_MODELS = [
  { id: 'nai-diffusion-4-5-full', label: 'NAI Diffusion V4.5 Full' },
  { id: 'nai-diffusion-4-5-curated', label: 'NAI Diffusion V4.5 Curated' },
  { id: 'nai-diffusion-5-full', label: 'NAI Diffusion V5 Full' },
  { id: 'nai-diffusion-5-curated', label: 'NAI Diffusion V5 Curated' },
];

export const CUSTOM_MODES = {
  naistera: {
    label: 'Naistera',
    defaultEndpoint: 'https://naistera.org',
    needsEndpoint: false,
    suggestions: ['nano-banana-2', 'nano-banana-2-lite', 'novelai-v4.5', 'novelai-v5'],
  },
  openai: {
    label: 'OpenAI-совместимый (картинки)',
    defaultEndpoint: 'https://api.openai.com',
    needsEndpoint: false,
    suggestions: ['gpt-image-1', 'gpt-image-1-mini', 'gpt-image-1.5'],
  },
  chat: {
    label: 'Nano Banana через прокси (формат чата)',
    defaultEndpoint: '',
    needsEndpoint: true,
    suggestions: [
      'gemini-3.1-flash-image-preview', 'gemini-3.1-flash-lite-image',
      'google/gemini-3.1-flash-image-preview', 'google/gemini-3.1-flash-lite-image',
    ],
  },
  gemini: {
    label: 'Google Gemini (родной формат)',
    defaultEndpoint: 'https://generativelanguage.googleapis.com',
    needsEndpoint: false,
    suggestions: ['gemini-3.1-flash-image-preview', 'gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image', 'gemini-3-pro-image-preview'],
  },
  novelai: {
    label: 'NovelAI (свой токен)',
    defaultEndpoint: 'https://image.novelai.net',
    needsEndpoint: false,
    suggestions: NAI_MODELS.map((m) => m.id),
    labels: Object.fromEntries(NAI_MODELS.map((m) => [m.id, m.label])),
  },
};

export const CUSTOM_MODE_IDS = Object.keys(CUSTOM_MODES);

export function normalizeEndpoint(raw) {
  return String(raw == null ? '' : raw).trim().replace(/\/+$/, '');
}

export function normalizeKey(raw) {
  let s = String(raw == null ? '' : raw).trim();
  s = s.replace(/^["'`]+|["'`]+$/g, '').trim();
  return s.replace(/^Bearer\s+/i, '').trim();
}

const isNaiModel = (m) => /^novelai(?:-|$)/i.test(String(m || ''));

export function customPromptForm(mode, model = '') {
  if (mode === 'novelai') return 'tags';
  if (mode === 'naistera' && isNaiModel(model)) return 'tags';
  return 'text';
}

function baseOf(mode, endpoint) {
  return normalizeEndpoint(endpoint) || CUSTOM_MODES[mode].defaultEndpoint;
}

const NAISTERA_PATH = /\/api\/generate$/;

const naisteraRoot = (endpoint) => baseOf('naistera', endpoint).replace(NAISTERA_PATH, '');

const chatRoot = (endpoint) => {
  const b = normalizeEndpoint(endpoint);
  return /\/(?:api\/)?v1$/.test(b) ? b : `${b}/v1`;
};

const openaiRoot = (endpoint) => baseOf('openai', endpoint).replace(/\/v1$/, '');

const geminiRoot = (endpoint) => baseOf('gemini', endpoint).replace(/\/(?:v1beta|v1)$/, '');

const isGoogleHost = (base) => {
  try { return new URL(base).hostname.endsWith('googleapis.com'); } catch { return false; }
};

const bearer = (key) => ({ Authorization: `Bearer ${key}` });
const JSON_TYPE = { 'Content-Type': 'application/json' };

export function customRequest(mode, o = {}) {
  const def = CUSTOM_MODES[mode];
  if (!def) throw new Error(`нет такого режима: ${mode}`);
  const key = normalizeKey(o.key);
  const model = String(o.model || '').trim() || def.suggestions[0];
  const p = o.prompt || {};
  const text = p.text || '';
  switch (mode) {
    case 'naistera': {
      const base = baseOf(mode, o.endpoint);
      const nai = isNaiModel(model);
      const body = { prompt: nai ? (p.tags || '') : text, aspect_ratio: '1:1', model };
      if (model === 'novelai-v4.5' || model === 'novelai-v5') body.negative_prompt = p.negative || '';
      return {
        url: NAISTERA_PATH.test(base) ? base : `${base}/api/generate`,
        method: 'POST',
        headers: { ...bearer(key), ...JSON_TYPE },
        body,
      };
    }
    case 'openai': {
      const body = { model, prompt: text, n: 1, size: '1024x1024' };
      if (/gpt-image/i.test(model)) body.quality = 'medium';
      else body.response_format = 'b64_json';
      return { url: `${openaiRoot(o.endpoint)}/v1/images/generations`, method: 'POST', headers: { ...bearer(key), ...JSON_TYPE }, body };
    }
    case 'chat':
      return {
        url: `${chatRoot(o.endpoint)}/chat/completions`,
        method: 'POST',
        headers: { ...bearer(key), ...JSON_TYPE },
        body: {
          model,
          messages: [{ role: 'user', content: text }],
          modalities: ['image', 'text'],
          image_config: { aspect_ratio: '1:1' },
        },
      };
    case 'gemini': {
      const base = geminiRoot(o.endpoint);
      const imageConfig = { aspectRatio: '1:1' };
      if (isGemini3(model)) imageConfig.imageSize = '1K';
      return {
        url: `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        method: 'POST',
        headers: { ...(isGoogleHost(base) ? { 'x-goog-api-key': key } : bearer(key)), ...JSON_TYPE },
        body: {
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig },
        },
      };
    }
    default: {
      const tags = p.tags || '';
      const negative = p.negative || '';
      const size = NAI_SIZES[o.naiSize] || NAI_SIZES.portrait;
      return {
        url: `${baseOf(mode, o.endpoint)}/ai/generate-image`,
        method: 'POST',
        headers: { ...bearer(key), ...JSON_TYPE },
        body: {
          action: 'generate',
          input: tags,
          model,
          parameters: {
            params_version: /^nai-diffusion-5/.test(model) ? 4 : 3,
            width: size.width,
            height: size.height,
            steps: 28,
            scale: 5,
            sampler: 'k_euler_ancestral',
            noise_schedule: 'karras',
            seed: Number.isFinite(o.seed) ? o.seed : 0,
            n_samples: 1,
            negative_prompt: negative,
            ucPreset: 0,
            qualityToggle: false,
            sm: false,
            sm_dyn: false,
            dynamic_thresholding: false,
            legacy: false,
            legacy_v3_extend: false,
            add_original_image: false,
            controlnet_strength: 1,
            cfg_rescale: 0,
            prefer_brownian: true,
            deliberate_euler_ancestral_bug: false,
            use_coords: false,
            characterPrompts: [],
            v4_prompt: { caption: { base_caption: tags, char_captions: [] }, use_coords: false, use_order: true },
            v4_negative_prompt: { caption: { base_caption: negative, char_captions: [] } },
          },
        },
      };
    }
  }
}

export function naisteraJobRequest(o = {}, jobId = '') {
  return {
    url: `${naisteraRoot(o.endpoint)}/api/generate/jobs/${encodeURIComponent(jobId)}`,
    method: 'GET',
    headers: bearer(normalizeKey(o.key)),
  };
}

export function customModelsRequest(mode, o = {}) {
  const key = normalizeKey(o.key);
  switch (mode) {
    case 'naistera':
      return { url: `${naisteraRoot(o.endpoint)}/api/models`, headers: key ? bearer(key) : {} };
    case 'openai':
      return { url: `${openaiRoot(o.endpoint)}/v1/models`, headers: bearer(key) };
    case 'chat':
      return { url: `${chatRoot(o.endpoint)}/models`, headers: bearer(key) };
    case 'gemini': {
      const base = geminiRoot(o.endpoint);
      const google = isGoogleHost(base);
      return { url: `${base}/v1beta/models${google ? '?pageSize=200' : ''}`, headers: google ? { 'x-goog-api-key': key } : bearer(key) };
    }
    default:
      return null;
  }
}

const MODEL_FILTERS = {
  openai: /image|dall-e|gpt-image|banana|imagen|flux/i,
  chat: /image|banana|gemini/i,
  gemini: /image/i,
};

export function parseCustomModels(mode, json) {
  if (mode === 'novelai') return CUSTOM_MODES.novelai.suggestions.slice();
  const list = Array.isArray(json) ? json : Array.isArray(json && json.models) ? json.models : Array.isArray(json && json.data) ? json.data : [];
  const out = [];
  for (const m of list) {
    if (!m) continue;
    if (mode === 'naistera' && (m.visible === false || m.deprecated)) continue;
    const raw = typeof m === 'string' ? m : String(m.id || m.name || '');
    const id = mode === 'gemini' ? raw.replace(/^models\//, '') : raw;
    if (!id) continue;
    if (MODEL_FILTERS[mode] && !MODEL_FILTERS[mode].test(id)) continue;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

const DATA_URL = /data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+/i;

function fromRef(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return { ok: true, url: s };
  const b64 = cleanBase64(s);
  return b64 ? image(b64, 'image/png') : null;
}

function fromImageItem(it) {
  if (typeof it === 'string') return fromRef(it);
  if (!it || typeof it !== 'object') return null;
  const iu = it.image_url;
  const cands = [
    iu && typeof iu === 'object' ? iu.url : iu,
    it.url, it.data_url, it.b64_json,
    it.image_base64 && typeof it.image_base64 === 'object' ? it.image_base64.data : it.image_base64,
  ];
  for (const c of cands) {
    const r = fromRef(c);
    if (r) return r;
  }
  return null;
}

function fromChatText(text) {
  const s = String(text || '');
  const d = DATA_URL.exec(s);
  if (d) {
    const b64 = cleanBase64(d[0]);
    if (b64) return image(b64, 'image/png');
  }
  const md = /!\[[^\]]*\]\(\s*([^)\s]+)\s*\)/.exec(s);
  if (md) {
    const r = fromRef(md[1]);
    if (r) return r;
  }
  const link = /https?:\/\/\S+?\.(?:png|jpe?g|webp)(?:\?[^\s)"']*)?/i.exec(s);
  if (link) return { ok: true, url: link[0] };
  const bare = s.trim();
  if (bare.length > 100) {
    const b64 = cleanBase64(bare);
    if (b64) return image(b64, 'image/png');
  }
  return null;
}

function errorFailure(err) {
  const why = errorWhy(err);
  if (FILTER_RE.test(why)) return fail('filter', DRAW_TEXT.filter);
  return fail('provider', fill(DRAW_TEXT.provider, { why: why.slice(0, 300) || 'без объяснения' }));
}

function parseChatResponse(json) {
  if (!json || typeof json !== 'object') return fail('empty', DRAW_TEXT.empty);
  const msg = Array.isArray(json.choices) && json.choices[0] ? json.choices[0].message : null;
  if (msg) {
    for (const it of Array.isArray(msg.images) ? msg.images : []) {
      const r = fromImageItem(it);
      if (r) return r;
    }
    const said = [];
    if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (!part || typeof part !== 'object') continue;
        if (part.type === 'image_url') {
          const r = fromRef(part.image_url && typeof part.image_url === 'object' ? part.image_url.url : part.image_url);
          if (r) return r;
        }
        const inline = part.inline_data || part.inlineData;
        const b64 = inline ? cleanBase64(inline.data) : null;
        if (b64) return image(b64, String(inline.mime_type || inline.mimeType || 'image/png'));
        if (typeof part.text === 'string') said.push(part.text);
      }
    } else if (typeof msg.content === 'string') {
      const r = fromChatText(msg.content);
      if (r) return r;
      said.push(msg.content);
    }
    const text = said.join(' ').trim();
    if (text) return fail('no-image', fill(DRAW_TEXT.noText, { why: text.slice(0, 160) }));
  }
  if (json.error) return errorFailure(json.error);
  return fail('empty', DRAW_TEXT.empty);
}

function parseGeminiNative(json) {
  if (!json || typeof json !== 'object') return fail('empty', DRAW_TEXT.empty);
  const cand = Array.isArray(json.candidates) ? json.candidates[0] : null;
  const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
  for (const part of parts) {
    if (!part || part.thought) continue;
    const data = part.inlineData || part.inline_data;
    const b64 = data ? cleanBase64(data.data) : null;
    if (b64) return image(b64, String(data.mimeType || data.mime_type || 'image/png'));
  }
  const fb = json.promptFeedback;
  if ((fb && fb.blockReason) || (cand && /SAFETY|PROHIBITED|BLOCK/i.test(String(cand.finishReason || '')))) {
    return fail('filter', DRAW_TEXT.filter);
  }
  const said = parts.filter((x) => x && !x.thought && typeof x.text === 'string').map((x) => x.text).join(' ').trim();
  if (said) return fail('no-image', fill(DRAW_TEXT.noText, { why: said.slice(0, 160) }));
  if (json.error) return errorFailure(json.error);
  return fail('empty', DRAW_TEXT.empty);
}

export function parseCustomResponse(mode, json) {
  switch (mode) {
    case 'naistera': {
      if (!json || typeof json !== 'object') return fail('empty', DRAW_TEXT.empty);
      const b64 = cleanBase64(json.data_url);
      if (b64) return image(b64, 'image/png');
      if (json.job_id) return { ok: true, job: String(json.job_id) };
      if (json.error || json.detail) return errorFailure(json.error || json.detail);
      return fail('empty', DRAW_TEXT.empty);
    }
    case 'openai': {
      const item = json && Array.isArray(json.data) ? json.data[0] : null;
      const b64 = item ? cleanBase64(item.b64_json) : null;
      if (b64) return image(b64, 'image/png');
      if (item && typeof item.url === 'string' && /^https?:\/\//i.test(item.url)) return { ok: true, url: item.url };
      if (json && json.error) return errorFailure(json.error);
      return fail('empty', DRAW_TEXT.empty);
    }
    case 'chat':
      return parseChatResponse(json);
    case 'gemini':
      return parseGeminiNative(json);
    default: {
      if (typeof json === 'string') {
        const b64 = cleanBase64(json);
        return b64 ? image(b64, 'image/png') : fail('empty', DRAW_TEXT.empty);
      }
      const b64 = json && typeof json === 'object' ? cleanBase64(json.image || json.data_url || json.b64_json) : null;
      if (b64) return image(b64, 'image/png');
      if (json && json.error) return errorFailure(json.error);
      return fail('empty', DRAW_TEXT.empty);
    }
  }
}

export function parseCustomJob(json) {
  if (!json || typeof json !== 'object') return fail('empty', DRAW_TEXT.empty);
  const b64 = cleanBase64(json.data_url);
  if (b64) return image(b64, 'image/png');
  const status = String(json.status || '').toLowerCase();
  if (status === 'failed' || json.error) {
    const why = errorWhy(json.error) || String(json.detail || '').trim();
    return fail('provider', fill(DRAW_TEXT.jobFailed, { why: why.slice(0, 300) || 'без объяснения' }));
  }
  if (status === 'completed') return fail('empty', DRAW_TEXT.empty);
  return { ok: true, pending: true };
}

export function stripKey(text, key) {
  const k = normalizeKey(key);
  const s = String(text == null ? '' : text);
  return k.length >= 4 ? s.split(k).join('•••') : s;
}

function whyOf(raw) {
  let why = String(raw || '').trim();
  try {
    const j = JSON.parse(why);
    if (typeof j === 'string') why = j;
    else if (j && typeof j === 'object') {
      const d = j.detail;
      why = errorWhy(j.error) || errorWhy(j) || (typeof d === 'string' ? d : d ? JSON.stringify(d) : '') || why;
    }
  } catch {}
  return why;
}

export function customHttpFailure(mode, status, text = '', key = '') {
  const label = CUSTOM_MODES[mode] ? CUSTOM_MODES[mode].label : mode;
  const why = stripKey(whyOf(text), key);
  if (status === 401 || status === 403) return fail('bad-key', `Ключ не подошёл (${label}).`);
  if (FILTER_RE.test(why)) return fail('filter', DRAW_TEXT.filter);
  const plain = why && !/^<!doctype|^<html/i.test(why) ? why.slice(0, 300) : `ответ ${status}`;
  return fail('provider', fill(DRAW_TEXT.provider, { why: plain }));
}

export function customNetworkFailure(url) {
  let host = String(url || '');
  try { host = new URL(url).host; } catch {}
  return fail('network', `Нет связи с ${host}: адрес недоступен или не принимает запросы из браузера (CORS).`);
}

export function bytesToBase64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function pngFromZip(arrayBuffer) {
  try {
    const u8 = new Uint8Array(arrayBuffer);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const count = dv.getUint16(eocd + 10, true);
    let pos = dv.getUint32(eocd + 16, true);
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(pos, true) !== 0x02014b50) return null;
      const method = dv.getUint16(pos + 10, true);
      const size = dv.getUint32(pos + 20, true);
      const nameLen = dv.getUint16(pos + 28, true);
      const extraLen = dv.getUint16(pos + 30, true);
      const commentLen = dv.getUint16(pos + 32, true);
      const local = dv.getUint32(pos + 42, true);
      const name = String.fromCharCode(...u8.subarray(pos + 46, pos + 46 + nameLen)).toLowerCase();
      pos += 46 + nameLen + extraLen + commentLen;
      if (!name.endsWith('.png')) continue;
      if (dv.getUint32(local, true) !== 0x04034b50) return null;
      const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
      let data = u8.subarray(start, start + size);
      if (method === 8) {
        data = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      } else if (method !== 0) {
        return null;
      }
      const png = data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
      return png ? bytesToBase64(data) : null;
    }
    return null;
  } catch {
    return null;
  }
}

import {
  DRAW_TIMEOUT, ROUTE_LABELS, DRAW_MODELS, availableRoutes, pickRoute, pickModel, promptForm,
  drawRequest, parseDrawResponse, httpFailure, timeoutFailure, abortedFailure, networkFailure,
  googleSource, normalizeDrawSettings, isImagePath, DRAW_TEXT, NAI_SIZES,
  CUSTOM_TIMEOUT, CUSTOM_MODES, normalizeKey, customRequest, customModelsRequest, naisteraJobRequest,
  parseCustomResponse, parseCustomJob, parseCustomModels, customHttpFailure, customNetworkFailure,
  pngFromZip, bytesToBase64, sniffMime,
} from './core/draw.mjs';
import { DRAW_STYLES } from './core/draw-prompt.mjs';
import { savePortraitImage } from './portraits.js';

const tavern = { secrets: null, extensions: null, loading: null };

export function loadTavernModules() {
  if (!tavern.loading) {
    tavern.loading = Promise.all([
      import('../../../secrets.js').then((m) => { tavern.secrets = m; }).catch(() => {}),
      import('../../../extensions.js').then((m) => { tavern.extensions = m; }).catch(() => {}),
    ]);
  }
  return tavern.loading;
}

export function drawEnv(ctx) {
  const c = ctx || {};
  const parser = c.SlashCommandParser;
  const imagine = parser && parser.commands ? parser.commands.imagine : null;
  const ext = c.extensionSettings || {};
  const oai = c.chatCompletionSettings || {};
  return {
    secrets: (tavern.secrets && tavern.secrets.secret_state) || {},
    imagine: Boolean(imagine && typeof imagine.callback === 'function'),
    sd: ext.sd || {},
    modules: (tavern.extensions && Array.isArray(tavern.extensions.modules)) ? tavern.extensions.modules : [],
    workersAccount: String(oai.workers_ai_account_id || ''),
  };
}

export function drawForm(ctx, raw) {
  const env = drawEnv(ctx);
  const settings = normalizeDrawSettings(raw);
  const route = pickRoute(settings.route, availableRoutes(env));
  return route ? promptForm(route, env.sd.source, settings.custom) : 'text';
}

export function drawInfo(ctx, raw) {
  const env = drawEnv(ctx);
  const settings = normalizeDrawSettings(raw);
  const available = availableRoutes(env);
  const route = pickRoute(settings.route, available);
  return {
    loaded: Boolean(tavern.secrets),
    available: available.map((id) => ({
      id,
      label: id === 'tavern' && env.sd.source ? `${ROUTE_LABELS.tavern} (${env.sd.source})` : ROUTE_LABELS[id],
    })),
    route,
    models: route && DRAW_MODELS[route] ? DRAW_MODELS[route] : [],
    model: route ? pickModel(route, settings.models) : '',
    style: settings.style,
    styleText: settings.styleText,
    styles: Object.keys(DRAW_STYLES),
    naiSize: settings.naiSize,
    naiSizes: Object.keys(NAI_SIZES),
    hint: available.length ? '' : DRAW_TEXT.noRoute,
    custom: {
      ...settings.custom,
      modes: Object.entries(CUSTOM_MODES).map(([id, m]) => ({ id, label: m.label })),
      suggestions: CUSTOM_MODES[settings.custom.mode].suggestions.slice(),
      suggestionLabels: CUSTOM_MODES[settings.custom.mode].labels || {},
      defaultEndpoint: CUSTOM_MODES[settings.custom.mode].defaultEndpoint,
      needsEndpoint: CUSTOM_MODES[settings.custom.mode].needsEndpoint,
    },
  };
}

function race(promise, { signal, timeoutMs, onStop }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve(v);
    };
    const onAbort = () => { try { if (onStop) onStop('abort'); } catch {} finish(abortedFailure()); };
    const timer = setTimeout(() => { try { if (onStop) onStop('timeout'); } catch {} finish(timeoutFailure(timeoutMs)); }, timeoutMs);
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort);
    }
    Promise.resolve(promise).then(finish, (err) => finish({ ok: false, code: 'provider', error: String((err && err.message) || err) }));
  });
}

async function drawViaTavern(ctx, env, prompt, opts) {
  const cmd = ctx.SlashCommandParser.commands.imagine;
  const form = promptForm('tavern', env.sd.source);
  const stopper = typeof EventTarget === 'function' ? new EventTarget() : null;
  const args = {
    quiet: 'true', gallery: 'false', extend: 'false', edit: 'false', width: '1024', height: '1024',
    ...(form === 'tags' && prompt.negative ? { negative: prompt.negative } : {}),
    ...(stopper ? { _abortController: stopper } : {}),
  };
  const run = Promise.resolve(cmd.callback(args, form === 'tags' ? prompt.tags : prompt.text)).then((path) => {
    const p = typeof path === 'string' ? path.trim() : '';
    if (!p) return { ok: false, code: 'empty', error: DRAW_TEXT.tavernEmpty };
    if (!isImagePath(p)) return { ok: false, code: 'not-image', error: DRAW_TEXT.notImage };
    return { ok: true, path: p };
  });
  return race(run, {
    ...opts,
    onStop: () => { if (stopper) stopper.dispatchEvent(new Event('abort')); },
  });
}

async function drawDirect(ctx, env, route, settings, prompt, opts) {
  const google = googleSource(env.secrets) || 'makersuite';
  const { url, body } = drawRequest(route, {
    model: pickModel(route, settings.models),
    prompt,
    naiSize: settings.naiSize,
    google,
    vertex: ctx.chatCompletionSettings || {},
  });
  const ctrl = new AbortController();
  const run = (async () => {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: typeof ctx.getRequestHeaders === 'function' ? ctx.getRequestHeaders() : { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch {
      if (ctrl.signal.aborted) return abortedFailure();
      return networkFailure();
    }
    const text = await res.text().catch(() => '');
    if (!res.ok) return httpFailure(route, res.status, text);
    let data = text;
    if (route !== 'novel') {
      try { data = JSON.parse(text); } catch { data = null; }
    }
    const img = parseDrawResponse(route, data);
    if (!img.ok) return img;
    const saved = await savePortraitImage(img.base64, { personId: opts.personId, mime: img.mime });
    return saved.ok ? { ok: true, path: saved.path } : saved;
  })();
  return race(run, { ...opts, onStop: () => ctrl.abort() });
}

const RETRY_STATUS = [429, 502, 503, 504];
const JOB_POLL_MS = 3000;

const pause = (ms, signal) => new Promise((resolve) => {
  const done = () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', done); resolve(); };
  const timer = setTimeout(done, ms);
  if (signal) signal.addEventListener('abort', done, { once: true });
});

async function fetchCustom(req, signal) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(req.url, {
      method: req.method,
      headers: req.headers,
      body: req.body ? JSON.stringify(req.body) : undefined,
      signal,
    });
    if (!RETRY_STATUS.includes(res.status) || attempt >= 2) return res;
    await pause(800 * 2 ** attempt, signal);
    if (signal.aborted) return res;
  }
}

async function downloadImage(url, signal) {
  const bad = (why) => ({ ok: false, code: 'provider', error: DRAW_TEXT.linkFailed.replace('{why}', why) });
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return bad(`ответ ${res.status}`);
    const base64 = bytesToBase64(await res.arrayBuffer());
    const type = String(res.headers.get('content-type') || '').split(';')[0].trim();
    return { ok: true, base64, mime: sniffMime(base64, type.startsWith('image/') ? type : 'image/png') };
  } catch (err) {
    if (signal.aborted) return abortedFailure();
    return bad(err && err.name === 'TypeError' ? 'адрес недоступен или не пускает браузер (CORS)' : String((err && err.message) || err));
  }
}

async function pollJob(c, jobId, signal) {
  const req = naisteraJobRequest(c, jobId);
  for (;;) {
    await pause(JOB_POLL_MS, signal);
    if (signal.aborted) return abortedFailure();
    let res;
    try {
      res = await fetch(req.url, { method: req.method, headers: req.headers, signal });
    } catch {
      return signal.aborted ? abortedFailure() : customNetworkFailure(req.url);
    }
    const text = await res.text().catch(() => '');
    if (!res.ok) return customHttpFailure('naistera', res.status, text, c.key);
    let json = null;
    try { json = JSON.parse(text); } catch {}
    const job = parseCustomJob(json);
    if (!job.pending) return job;
  }
}

async function readNovelai(res) {
  const buf = await res.arrayBuffer();
  const base64 = await pngFromZip(buf);
  if (base64) return { ok: true, base64, mime: 'image/png' };
  const text = new TextDecoder().decode(buf);
  let body = text;
  try { body = JSON.parse(text); } catch {}
  return parseCustomResponse('novelai', body);
}

async function drawCustom(ctx, settings, prompt, opts) {
  const c = settings.custom;
  const req = customRequest(c.mode, {
    endpoint: c.endpoint, key: c.key, model: c.model, prompt, naiSize: settings.naiSize,
    seed: Math.floor(Math.random() * 4294967295),
  });
  const ctrl = new AbortController();
  const run = (async () => {
    let img;
    try {
      const res = await fetchCustom(req, ctrl.signal);
      if (!res.ok) return customHttpFailure(c.mode, res.status, await res.text().catch(() => ''), c.key);
      if (c.mode === 'novelai') {
        img = await readNovelai(res);
      } else {
        let json = null;
        try { json = JSON.parse(await res.text()); } catch {}
        img = parseCustomResponse(c.mode, json);
      }
      if (img.ok && img.job) img = await pollJob(c, img.job, ctrl.signal);
      if (img.ok && img.url) img = await downloadImage(img.url, ctrl.signal);
    } catch {
      return ctrl.signal.aborted ? abortedFailure() : customNetworkFailure(req.url);
    }
    if (!img.ok) return img;
    const saved = await savePortraitImage(img.base64, { personId: opts.personId, mime: img.mime });
    return saved.ok ? { ok: true, path: saved.path } : saved;
  })();
  return race(run, { ...opts, onStop: () => ctrl.abort() });
}

function customReady(c) {
  return Boolean(normalizeKey(c.key)) && (Boolean(c.endpoint) || !CUSTOM_MODES[c.mode].needsEndpoint);
}

export async function loadCustomModels(rawSettings) {
  const c = normalizeDrawSettings(rawSettings).custom;
  const req = customModelsRequest(c.mode, c);
  if (!req) return { ok: true, models: parseCustomModels(c.mode, null) };
  if (CUSTOM_MODES[c.mode].needsEndpoint && !c.endpoint) return { ok: false, error: DRAW_TEXT.noCustom };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(req.url, { method: 'GET', headers: req.headers, signal: ctrl.signal });
    const text = await res.text().catch(() => '');
    if (!res.ok) return customHttpFailure(c.mode, res.status, text, c.key);
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: true, models: parseCustomModels(c.mode, json) };
  } catch {
    return customNetworkFailure(req.url);
  } finally {
    clearTimeout(timer);
  }
}

export async function drawImage(ctx, rawSettings, prompt, opts = {}) {
  await loadTavernModules();
  const c = ctx || {};
  const env = drawEnv(c);
  const settings = normalizeDrawSettings(rawSettings);
  const route = pickRoute(settings.route, availableRoutes(env));
  if (!route) return { ok: false, code: 'no-route', error: DRAW_TEXT.noRoute };
  if (route === 'custom' && !customReady(settings.custom)) return { ok: false, code: 'no-custom', error: DRAW_TEXT.noCustom };
  const run = {
    signal: opts.signal,
    timeoutMs: opts.timeoutMs || (route === 'custom' ? CUSTOM_TIMEOUT : DRAW_TIMEOUT),
    personId: opts.personId,
  };
  let res;
  if (route === 'tavern') res = await drawViaTavern(c, env, prompt, run);
  else if (route === 'custom') res = await drawCustom(c, settings, prompt, run);
  else res = await drawDirect(c, env, route, settings, prompt, run);
  return res.ok ? { ...res, route } : res;
}

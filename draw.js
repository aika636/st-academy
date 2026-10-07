// draw.js — «Нарисовать портрет» через провайдеров таверны (аватарки, шаг 4).
//
// Ключи — только на сервере таверны, в её secrets: Академия ходит на маршруты
// таверны с её заголовками (`getRequestHeaders`) и ключа не видит. С телефона
// так и удобнее: ничего не вводить, всё уже настроено в таверне.
//
// Что здесь: доступность путей (`drawEnv`, `drawInfo`), сам запрос с отменой и
// таймаутом (`drawImage`) и сохранение — тем же `portraits.savePortraitImage`,
// что у фото с телефона. Пути, тела запросов и разбор ответов — чистые, в
// `core/draw.mjs`; промпт — в `core/draw-prompt.mjs`.
//
// Путь «как настроено в таверне» — обработчик `/imagine` напрямую, с `quiet`:
// в чат ничего не вставляется, файл таверна сохраняет сама и отдаёт путь.
// `/imagine-source` не зовётся никогда — он меняет источник навсегда.
//
// `secrets.js` и `extensions.js` таверны грузятся лениво и один раз: в старой
// таверне или на стенде их нет, и тогда рисовать просто нечем — а не упавшее
// расширение.

import {
  DRAW_TIMEOUT, ROUTE_LABELS, DRAW_MODELS, availableRoutes, pickRoute, pickModel, promptForm,
  drawRequest, parseDrawResponse, httpFailure, timeoutFailure, abortedFailure, networkFailure,
  googleSource, normalizeDrawSettings, isImagePath, DRAW_TEXT, NAI_SIZES,
} from './core/draw.mjs';
import { DRAW_STYLES } from './core/draw-prompt.mjs';
import { savePortraitImage } from './portraits.js';

/** Модули таверны: `secret_state` — живая привязка, читается на каждый вызов. */
const tavern = { secrets: null, extensions: null, loading: null };

/** Подгрузить `secrets.js` и `extensions.js` таверны (один раз на страницу). */
export function loadTavernModules() {
  if (!tavern.loading) {
    tavern.loading = Promise.all([
      import('../../../secrets.js').then((m) => { tavern.secrets = m; }).catch(() => {}),
      import('../../../extensions.js').then((m) => { tavern.extensions = m; }).catch(() => {}),
    ]);
  }
  return tavern.loading;
}

/** Что таверна умеет прямо сейчас: ключи, `/imagine`, настройки её генерации. */
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

/**
 * Сводка для панели: что доступно, что выбрано, какие модели и стили.
 *
 * @param {Object} ctx `getContext()` таверны
 * @param {Object} raw `settings.draw`
 */
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
    styles: Object.keys(DRAW_STYLES),
    naiSize: settings.naiSize,
    naiSizes: Object.keys(NAI_SIZES),
    hint: available.length ? '' : DRAW_TEXT.noRoute,
  };
}

/**
 * Обещание с потолком ожидания и отменой. Отмена и таймаут не ждут ответа:
 * результат запоздавшего запроса просто никому не нужен.
 */
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
    const onAbort = () => { try { if (onStop) onStop('abort'); } catch { /* вежливость */ } finish(abortedFailure()); };
    const timer = setTimeout(() => { try { if (onStop) onStop('timeout'); } catch { /* вежливость */ } finish(timeoutFailure(timeoutMs)); }, timeoutMs);
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort);
    }
    Promise.resolve(promise).then(finish, (err) => finish({ ok: false, code: 'provider', error: String((err && err.message) || err) }));
  });
}

/** Путь «как в таверне»: обработчик `/imagine` с `quiet`, без галереи и чата. */
async function drawViaTavern(ctx, env, prompt, opts) {
  const cmd = ctx.SlashCommandParser.commands.imagine;
  const form = promptForm('tavern', env.sd.source);
  // Отмена — тем же путём, что у слэш-команд: генерация таверны слушает
  // событие `abort` у `_abortController` (stable-diffusion/index.js:3062).
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

/** Прямой путь: запрос к серверу таверны, разбор, сохранение. */
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

/**
 * Нарисовать портрет и сохранить файл. Портрет человека НЕ ставится: это
 * решает кнопка «Оставить» после превью.
 *
 * @param {Object} ctx `getContext()` таверны
 * @param {Object} rawSettings `settings.draw`
 * @param {{tags: string, negative: string, text: string}} prompt `buildPortraitPrompt`
 * @param {{personId: string, signal?: AbortSignal, timeoutMs?: number}} opts
 * @returns {Promise<{ok: true, path: string, route: string} | {ok: false, code: string, error: string}>}
 */
export async function drawImage(ctx, rawSettings, prompt, opts = {}) {
  await loadTavernModules();
  const c = ctx || {};
  const env = drawEnv(c);
  const settings = normalizeDrawSettings(rawSettings);
  const route = pickRoute(settings.route, availableRoutes(env));
  if (!route) return { ok: false, code: 'no-route', error: DRAW_TEXT.noRoute };
  const run = { signal: opts.signal, timeoutMs: opts.timeoutMs || DRAW_TIMEOUT, personId: opts.personId };
  const res = route === 'tavern'
    ? await drawViaTavern(c, env, prompt, run)
    : await drawDirect(c, env, route, settings, prompt, run);
  return res.ok ? { ...res, route } : res;
}

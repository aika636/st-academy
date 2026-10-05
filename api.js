// api — единственный файл, который ходит к модели.
//
// Два пути (3.6): свой OpenAI-совместимый endpoint, если человек вписал адрес и
// ключ, иначе — текущее подключение таверны через `ctx.generateRaw`. Оба пути
// сводятся к одной функции `complete`, чтобы генерация плана не знала, откуда
// пришёл текст.
//
// Четыре решения, из которых вытекает файл.
//
// 1. **Адрес нормализуется, а не требуется в каноническом виде.** Человек впишет
//    и `https://x.y`, и `https://x.y/v1`, и `https://x.y/v1/chat/completions` —
//    все три обязаны работать. Ошибка «404» из-за лишнего `/v1` в поле — ровно та
//    тишина, из-за которой люди бросают настройку.
//
// 2. **Понятная ошибка вместо тишины.** Ответ и исключение прогоняются через
//    `classifyError`: «адрес не отвечает / CORS», «401 — ключ», «404 — не тот
//    путь», «модель не найдена». Классификатор чистый и покрыт тестом; сеть в
//    тестах не трогается.
//
// 3. **Таймаут и отмена обязательны.** Висящий запрос без обратной связи — та же
//    тишина. Каждый вызов получает `AbortController`, снаружи можно передать свой
//    `signal` (кнопка «отмена» в панели).
//
// 4. **Повторы — два разных слоя, и каждый лечит своё** (3.6, 9.1.7).
//    * Транспорт: 429 и 5xx своего адреса повторяются внутри `request` ещё два
//      раза с паузами 800 и 1600 мс (`RETRY`). Это беды сервера, а не запроса:
//      тот же запрос через секунду обычно проходит.
//    * Смысл: ответ пришёл, но не разобрался — ровно один повтор с припиской
//      «верни только JSON» в `generatePlan`/`guessSurvey`. Любой отказ
//      транспорта этот слой больше не повторяет: иначе 503 давал бы 3 × 2 = 6
//      запросов, а неверный адрес — два таймаута по полторы минуты.
//    Не повторяется никогда: 4xx кроме 429 (чинить настройки), сеть/CORS
//    (браузер не отличает «лёг» от «запрещено»), таймаут, отмена человеком,
//    обрыв по токенам (etap-tokens: тот же бюджет оборвётся там же).
//    Дальше — честный `{ok: false, error, raw}`: панель показывает сырой ответ и
//    открывает ручную таблицу. Никаких запросов «каждые N сообщений»: план
//    генерируется по кнопке, один раз на семестр.

import { buildPlanPrompt, parsePlanResponse, validatePlan, extractJson, fill, balancedBlock } from './core/plan-gen.mjs';
import { emptySurvey } from './core/state.mjs';

/** Умолчания таймаутов, мс. Данные, не логика. */
export const TIMEOUTS = {
  complete: 90000,
  models: 20000,
  test: 20000,
};

/**
 * Бюджет ответа в токенах — по одному на каждый род запроса.
 *
 * Почему это вообще есть. Без явного числа лимит брала настройка человека под
 * реплику в ролевой («Response (tokens)»), а она стоит на длину одного абзаца.
 * План из восьми дисциплин с преподавателями в такой абзац не влезает: модель
 * начинает правильный JSON и её обрывает на середине — `finish_reason: 'length'`.
 * Ошибка при этом выглядела как «ответ не разобрался», то есть уводила чинить
 * разбор вместо лимита. Бюджет должен задавать тот, кто знает, о чём просит.
 *
 * Откуда числа:
 * - `ping` — восемь токенов: проверке связи нужен факт ответа, а не ответ;
 * - `survey` — шесть коротких полей анкеты, с запасом на болтливую обёртку и на
 *   рассуждение (см. ниже): 512 замер прошёл впритык к наблюдённым 700 на одно
 *   только размышление;
 * - `plan` — восемь дисциплин и восемь преподавателей с чертами
 *   (`core/plan-gen.mjs: DEFAULTS.maxSubjects`), кириллицей, то есть дорого по токенам;
 * - `default` — для вызывающего, который бюджет не назвал; он именно умолчание,
 *   а не «сколько-нибудь»: молча уходить в настройку человека нельзя.
 *
 * **Числа выбраны под модель, которая думает вслух.** Это не запас на пустом
 * месте. У рассуждающей модели (замер живьём на `deepseek/deepseek-v4-flash`)
 * размышление тратится из того же `max_tokens`, что и ответ: план с бюджетом
 * 2048 оборвался по длине с первого запроса, а на лимите 700 та же модель
 * израсходовала на рассуждение ровно 700 токенов и вернула пустой текст. То
 * есть до текста ответа очередь просто не доходит, и выглядит это не как
 * «мало токенов», а как «модель молчит». Платят при этом за выданные токены, а
 * не за разрешённые: поднятый потолок сам по себе ничего не стоит.
 */
export const TOKEN_BUDGETS = {
  ping: 8,
  survey: 1024,
  plan: 4096,
  // Разбор ответа (секретарь, `core/analysis`): сам ответ — одна строка метки,
  // остальное — запас на размышление думающей модели, как у анкеты.
  analysis: 1024,
  default: 1024,
};

/**
 * Повтор транспорта: паузы перед второй и третьей попыткой, мс. Длина массива
 * и есть число повторов. Повторяются только 429 и 5xx (`isRetryableStatus`).
 *
 * Почему 800/1600, а не «пока не ответит». Кнопку жмёт человек и ждёт; три
 * попытки за ~2,5 с паузы — это ещё «идёт запрос», а не «зависло». Перегруз
 * дольше пары секунд повтором не лечится, его лечит человек кнопкой позже —
 * и фраза отказа ему об этом говорит.
 */
export const RETRY = { pauses: [800, 1600] };

/** Статус, при котором тот же запрос имеет смысл повторить: перегруз или сбой сервера. */
export function isRetryableStatus(status) {
  return typeof status === 'number' && (status === 429 || status >= 500);
}

/** Бюджет запроса числом: чужое значение уважается, мусор — нет. */
function budgetOf(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// --- адрес -------------------------------------------------------------------

const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|[\w-]+\.local)(:\d+)?(\/|$)/i;

/**
 * База адреса: без схемы-угадайки не обойтись (люди пишут `localhost:5001`), без
 * срезания хвостов тоже (люди копируют полный путь из документации).
 *
 * `https://x.y`, `https://x.y/v1`, `https://x.y/v1/chat/completions`,
 * `x.y/v1/models`, `localhost:5001` → одна и та же база.
 */
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
  // Хвосты срезаются по кругу: `/v1/chat/completions` — это три из них подряд.
  const tails = [/\/chat\/completions$/i, /\/completions$/i, /\/models$/i, /\/v1$/i];
  for (let guard = 0; guard < 8; guard += 1) {
    const before = s;
    for (const t of tails) s = s.replace(t, '');
    s = s.replace(/\/+$/, '');
    if (s === before) break;
  }
  return s;
}

/** Полный адрес чат-комплишена. Пустая база — пустая строка (значит, запасной путь). */
export function chatUrl(endpoint) {
  const base = normalizeBase(endpoint);
  return base ? `${base}/v1/chat/completions` : '';
}

/** Полный адрес списка моделей. */
export function modelsUrl(endpoint) {
  const base = normalizeBase(endpoint);
  return base ? `${base}/v1/models` : '';
}

/** Свой endpoint настроен? Ключ обязателен: без него ходить некуда, кроме локалки. */
export function hasOwnEndpoint(api) {
  const a = api || {};
  return Boolean(normalizeBase(a.endpoint));
}

/**
 * Куда уйдёт запрос. Раньше эта развилка выводилась из пустоты полей, то есть
 * подключение таверны было невидимым запасным путём; теперь она названа вслух
 * настройкой `api.source` — но `'auto'` (и любое незнакомое значение, и старые
 * настройки без этого поля) значит ровно прежнее правило.
 *
 * @returns {'endpoint'|'tavern'}
 */
export function resolveSource(api) {
  const src = api && api.source ? String(api.source) : 'auto';
  if (src === 'tavern') return 'tavern';
  if (src === 'own') return 'endpoint';
  return hasOwnEndpoint(api) ? 'endpoint' : 'tavern';
}

/**
 * Обезвредить макросы таверны в тексте: `{{` → `{` + U+200B + `{`.
 *
 * Зачем. В промпт уезжает то, что писал человек или автор карточки: анкета,
 * описание персонажа, первое сообщение. `generateRaw` прогоняет и `prompt`, и
 * `systemPrompt` через `substituteParams` (`script.js: createRawPrompt`, 1.18.0) —
 * и `{{random::…}}`, `{{roll}}`, `{{setvar::…}}` из карточки исполнились бы:
 * план получил бы случайное слово, а чат — чужую переменную. Приём тот же, что
 * у BB-Enhance-Gen: пробел нулевой ширины между скобками ломает узнавание
 * макроса, а модель текст видит прежним.
 *
 * Где НЕ нужно, проверено по исходнику 1.18.0:
 * * **свой адрес** — текст уходит прямым `fetch`, таверна его не видит;
 * * **профиль через `ConnectionManagerRequestService.sendRequest`** — сообщения
 *   идут в `ChatCompletionService.processRequest` как есть, без
 *   `substituteParams` (`custom-request.js`); в текстовом режиме instruct
 *   подставляет макросы только в свои последовательности, не в содержимое
 *   (`formatInstructModeChat`). Лишний невидимый символ там был бы просто
 *   порчей текста.
 *
 * Считается каждая `{`, за которой идёт ещё одна: `{{{` → три скобки с двумя
 * разрывами, а не «одна пара заменена, одна осталась».
 */
export function escapeMacros(text) {
  return String(text == null ? '' : text).replace(/\{(?=\{)/g, '{​');
}

/**
 * Запрос через подключение самой таверны.
 *
 * Два пути, и оба настоящие. Выбран профиль подключения — идём
 * `ConnectionManagerRequestService.sendRequest`: он один умеет и chat, и text
 * completion, и пресет профиля, и прокси (так это делает NOVA). Профиля нет
 * или сервиса нет в сборке — `generateRaw`, то есть текущее подключение как
 * есть; это тот самый путь, которым расширение молча ходило до сих пор.
 *
 * `generateRaw` БРОСАЕТ при пустом ответе (`script.js:4089`) — поэтому здесь
 * try, а не проверка результата.
 */
export async function tavernComplete(ctx, req = {}) {
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
      const out = await service.sendRequest(profile.id, messages, maxTokens, {
        stream: false, extractData: true, includePreset: true, includeInstruct: true,
      });
      const text = parseCompletion(out);
      if (!text.trim()) return { ok: false, code: 'empty', status: null, detail: '', message: 'Модель вернула пустой ответ.' };
      return {
        ok: true, text, via: 'tavern', profile: profile.name || profile.id,
        budget: maxTokens, truncated: isTruncated(out, text),
      };
    } catch (error) {
      if (error && error.name === 'AbortError') return classifyError({ error });
      return {
        ok: false,
        code: 'tavern',
        status: null,
        detail: (error && error.message) || '',
        message: `Профиль «${profile.name || profile.id}» не дал ответа: ${(error && error.message) || 'без подробностей'}.`,
      };
    }
  }

  if (!c || typeof c.generateRaw !== 'function') {
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
    // `responseLength` — единственный способ не зависеть от настройки человека
    // под реплику в ролевой: таверна на время запроса подменяет лимит через
    // `TempResponseLength.save` (`script.js:3941`, `:4063`).
    // Экранирование макросов — только здесь, см. `escapeMacros`.
    const out = await c.generateRaw({
      prompt: escapeMacros(user), systemPrompt: escapeMacros(system), responseLength: maxTokens,
    });
    const text = parseCompletion(out);
    if (!text.trim()) return { ok: false, code: 'empty', status: null, detail: '', message: 'Модель вернула пустой ответ.' };
    return { ok: true, text, via: 'tavern', budget: maxTokens, truncated: isTruncated(out, text) };
  } catch (error) {
    if (error && error.name === 'AbortError') return classifyError({ error });
    return {
      ok: false,
      code: 'tavern',
      status: null,
      detail: (error && error.message) || '',
      message: `Подключение таверны не дало ответа: ${(error && error.message) || 'без подробностей'}.`,
    };
  }
}

// --- разбор ответа -----------------------------------------------------------

/**
 * Толерантный разбор: порядок из фактов по 1.18.0 — `choices[0].message.content`
 * → `choices[0].text` → `response` → `content` → `text` → `message.content`.
 * Строка на входе считается уже готовым ответом (так отвечает `generateRaw`).
 *
 * @returns {string} пустая строка, если содержимого нет
 */
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
      // Рассуждающие модели иногда кладут ответ рядом с пустым content.
      const r = contentToString(msg.reasoning_content || msg.reasoning);
      if (r) return r;
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
  // Responses API: output[].content[].text
  if (Array.isArray(data.output)) {
    const v = data.output.map((o) => contentToString(o && o.content)).filter(Boolean).join('\n');
    if (v) return v;
  }
  return '';
}

/** Содержимое бывает строкой, массивом кусков `{type,text}` или объектом `{text}`. */
function contentToString(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.map(contentToString).filter(Boolean).join('');
  if (typeof v === 'object') return contentToString(v.text !== undefined ? v.text : v.content);
  return String(v);
}

// --- обрыв по длине ----------------------------------------------------------
//
// Обрыв по лимиту токенов и непонятый ответ — две разные беды с разными
// лекарствами, а выглядели они одинаково: «ответ не разобрался». Различать их
// приходится двумя способами, потому что путей два.
//
// * Свой адрес — есть факт: `finish_reason: 'length'` (у Anthropic-совместимых
//   `stop_reason: 'max_tokens'`).
// * Путь таверны — факта нет: `generateRaw` отдаёт очищенную строку и причину
//   остановки выбрасывает (`script.js:4063`). Остаётся признак: текст оборвался
//   там, где скобка открыта и не закрыта.

/** Причина остановки из ответа OpenAI-совместимого API. Пустая строка — не сказано. */
export function finishReason(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return '';
  const choice = Array.isArray(data.choices) ? data.choices[0] : null;
  const v = (choice && (choice.finish_reason || choice.finishReason || choice.stop_reason))
    || data.finish_reason || data.stop_reason || '';
  return v ? String(v) : '';
}

/** Причина остановки, означающая «кончился бюджет». */
export function isTruncatedReason(reason) {
  return /^(length|max_tokens|max-tokens|maxtokens)$/i.test(String(reason || '').trim());
}

/**
 * Признак обрыва по тексту: скобка открыта и не закрыта. Это догадка, а не факт,
 * поэтому спрашивать её стоит только тогда, когда ответ уже не разобрался, —
 * иначе можно объявить обрывом болтовню с одинокой фигурной скобкой.
 */
export function looksTruncated(text) {
  const s = String(text == null ? '' : text);
  if (!/[{[]/.test(s)) return false;
  return balancedBlock(s) === '';
}

/** Обрыв: сперва факт из ответа, затем признак из текста. */
function isTruncated(data, text) {
  return isTruncatedReason(finishReason(data)) || looksTruncated(text);
}

/**
 * Фраза про обрыв. Говорит, что случилось и что делать; про «поднять лимит»
 * сказано ровно потому, что бюджет расширения доезжает не всегда — путь
 * `generateRaw` полагается на временную подмену лимита внутри таверны.
 *
 * @param {string} half целиком оборот про половину («учебный план пришёл наполовину»)
 * @param {number} [budget] бюджет, который просило расширение
 * @param {string} [fallback] что человек может сделать сам
 */
export function truncatedMessage(half, budget, fallback = '') {
  const asked = budget ? ` Расширение просило ${budget} токенов.` : '';
  return `Модель начала отвечать и была оборвана по лимиту токенов: ${half}.${asked}`
    + ' Поднимите лимит ответа в настройках подключения таверны'
    + ' или впишите свой адрес с ключом — там лимитом распоряжается расширение.'
    + (fallback ? ` ${fallback}` : '');
}

/**
 * Как этот пресет зовёт учебный план. Словарь панели сюда не импортируется:
 * `ui.js` сам зовёт `api.js`, и обратный импорт замкнул бы кольцо. Умолчание —
 * то же, что в `DEFAULT_UI.planSection`.
 */
function planWord(preset) {
  return String((preset && preset.ui && preset.ui.planSection) || 'Учебный план');
}

/** Список моделей из ответа `/v1/models`: `data[].id`, либо голый массив строк. */
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

// --- ошибки ------------------------------------------------------------------

/**
 * Классификация. Чистая функция: на входе то, что удалось узнать о неудаче, на
 * выходе — код и человеческая фраза. Кодов ровно столько, сколько разных
 * действий требуется от человека.
 *
 * @param {Object} info
 * @param {number} [info.status] HTTP-статус, если ответ вообще пришёл
 * @param {*} [info.body] разобранное или сырое тело ответа
 * @param {Error} [info.error] исключение fetch/abort
 * @param {string} [info.url] куда ходили
 * @param {string} [info.model]
 * @returns {{ok: false, code: string, message: string, status: ?number, detail: string}}
 */
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
  if (status === null) {
    // fetch бросает TypeError и на недоступный адрес, и на запрет CORS: браузер
    // намеренно не даёт различить их. Значит, называем оба варианта.
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

/** Вытащить текст ошибки из тела: `{error:{message}}`, `{error:'…'}`, `{message}` или строка. */
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

// --- поход в сеть ------------------------------------------------------------

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Подмена fetch (тесты). Без аргумента — вернуть штатный. */
export function setFetch(fn) {
  fetchImpl = typeof fn === 'function' ? fn : (...args) => globalThis.fetch(...args);
}

let contextProvider = () => (globalThis.SillyTavern && globalThis.SillyTavern.getContext
  ? globalThis.SillyTavern.getContext()
  : null);

/** Подмена источника контекста таверны (тесты, ранняя инициализация). */
export function setContextProvider(fn) {
  contextProvider = typeof fn === 'function' ? fn : () => null;
}

function tavern(ctx) {
  return ctx || contextProvider();
}

// --- ключ --------------------------------------------------------------------
//
// Ключ копируют из Telegram, из заметок, из письма — и вместе с ним приезжают
// невидимые символы: zero-width space и joiner (U+200B–U+200D), word joiner
// (U+2060), BOM (U+FEFF), неразрывный пробел по краям. Человек их не видит, а
// `fetch` падает на заголовке `Authorization` с «String contains non ISO-8859-1
// code point» — фраза, из которой нельзя понять, что виноват ключ. Та же беда
// решена у SLAYimages (`sanitizeApiKey`); здесь — та же идея и своё слово.
//
// Правило двухступенчатое. Что заведомо мусор — молча убирается: невидимки
// везде, пробелы (в том числе неразрывные) по краям. Что осталось странного —
// не чинится, а называется: кириллическая «с» вместо латинской c выглядит так
// же, и угадывать, что человек имел в виду, нельзя — можно только показать,
// где именно беда.

/** Невидимые символы, которые копирование подмешивает в ключ. Из ключа их убирать всегда безопасно. */
const KEY_INVISIBLE = /[​-‍⁠﻿]/g;

/** Края ключа: обычные пробелы, переносы, неразрывный пробел. */
const KEY_EDGES = /^[\s ]+|[\s ]+$/g;

/** Как назвать символ человеку, не показывая сам ключ целиком. */
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

/**
 * Очистка ключа API.
 *
 * @param {*} raw что вписал человек
 * @returns {{ok: true, key: string} | {ok: false, key: string, position: number, message: string}}
 *   `position` — с единицы, как считает человек.
 */
export function sanitizeApiKey(raw) {
  const key = String(raw == null ? '' : raw).replace(KEY_INVISIBLE, '').replace(KEY_EDGES, '');
  // Всё, что не печатный ASCII без пробела. Пробел и перенос внутри ключа —
  // тоже ошибка: ключей с пробелом не бывает, а перенос строки в заголовке
  // `fetch` отвергает так же невнятно.
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

/**
 * Проверка ключа перед походом в сеть. Пустой ключ — не ошибка: локальному
 * серверу он не нужен.
 *
 * @returns {null | {ok: false, code: 'bad-key', status: null, detail: string, message: string}}
 */
export function keyProblem(api) {
  const res = sanitizeApiKey(api && api.key);
  if (res.ok) return null;
  return { ok: false, code: 'bad-key', status: null, detail: '', message: res.message };
}

/**
 * Заголовки запроса. Ключ уходит только на указанный человеком адрес и никуда
 * больше — и уходит очищенным. Испорченный ключ сюда не доходит: его ловит
 * `keyProblem` раньше; если всё же дошёл, заголовок не ставится вовсе, чтобы
 * вместо понятного 401 не было падения `fetch`.
 */
export function headersFor(api) {
  const h = { 'Content-Type': 'application/json' };
  const res = sanitizeApiKey(api && api.key);
  if (res.ok && res.key) h.Authorization = `Bearer ${res.key}`;
  return h;
}

/** Пауза, которую можно прервать отменой. Резолвится в любом случае — отмену проверяет вызывающий. */
function defaultSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) { resolve(); return; }
    const done = () => { clearTimeout(timer); if (signal) signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    if (signal) signal.addEventListener('abort', done, { once: true });
  });
}

let sleepImpl = defaultSleep;

/**
 * Подмена паузы между повторами (тесты: без реального ожидания, с записью
 * длительностей). Без аргумента — вернуть штатную.
 */
export function setSleep(fn) {
  sleepImpl = typeof fn === 'function' ? fn : defaultSleep;
}

/** Ошибка отмены в той же форме, в какой её бросает `fetch`. */
function abortError() {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}

/**
 * Запрос с повтором на 429/5xx (`RETRY`). Одна попытка — это `requestOnce`;
 * здесь только решение «ещё раз или хватит».
 *
 * Отмена во время паузы — это отмена, а не повод сделать следующую попытку:
 * человек нажал «стоп», и третьего запроса после этого быть не должно.
 *
 * @param {Object} opts `{timeout, signal, model, retry}`; `retry: false` — одна попытка
 */
async function request(url, init, opts) {
  const pauses = opts.retry === false ? [] : RETRY.pauses;
  let res = await requestOnce(url, init, opts);
  let tries = 1;
  for (const pause of pauses) {
    if (res.ok || !isRetryableStatus(res.status)) break;
    await sleepImpl(pause, opts.signal);
    if (opts.signal && opts.signal.aborted) return classifyError({ error: abortError(), url, model: opts.model });
    res = await requestOnce(url, init, opts);
    tries += 1;
  }
  if (!res.ok && tries > 1) {
    // Человек должен знать, что «подождите и повторите» уже сделано за него —
    // иначе он нажмёт кнопку сразу и получит тот же 429.
    const again = tries - 1 === 1 ? 'уже повторило запрос' : `уже повторило запрос ${tries - 1} раза`;
    return { ...res, tries, message: `${res.message} Расширение ${again} с паузой — попробуйте позже.` };
  }
  return res;
}

/**
 * Одна попытка с таймаутом и отменой. Внешний `signal` (кнопка «отмена») уважается.
 * Возвращает `{ok, status, data, raw}` либо классифицированную ошибку.
 */
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
    return { ok: true, status: res.status, data, raw };
  } catch (error) {
    if (timedOut && error && error.name === 'AbortError') error.timeout = true;
    return classifyError({ error, url, model });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Список моделей: `GET {endpoint}/v1/models`, `Authorization: Bearer`.
 *
 * @returns {Promise<{ok: true, models: string[]} | {ok: false, code, message}>}
 */
export async function listModels(api, opts = {}) {
  // У подключения таверны своего списка моделей нет и быть не может: модель там
  // выбирает сама таверна (или пресет профиля). Притворяться, что список есть,
  // нечестно, поэтому отдельный код — панель показывает его как объяснение, а
  // не как поломку.
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
    // Сетевой отказ на списке моделей — чаще всего CORS: многие провайдеры
    // открывают `/v1/models` серверу, но не браузеру. Сервер таверны браузером
    // не является — просим его.
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
    return { ok: false, code: 'empty-list', message: 'Сервер ответил, но список моделей пуст — впишите имя модели руками.', status: res.status, detail: '' };
  }
  return via ? { ok: true, models, via } : { ok: true, models };
}

/** Адрес бэкенда таверны, который умеет спросить список моделей с сервера (`chat-completions.js:1735`). */
export const TAVERN_STATUS_URL = '/api/backends/chat-completions/status';

/**
 * Список моделей через сервер таверны — запасной путь на CORS.
 *
 * Как устроен эндпоинт (SillyTavern 1.18.0, `src/endpoints/backends/chat-completions.js`,
 * `router.post('/status')`): для `chat_completion_source: 'openai'` с непустым
 * `reverse_proxy` сервер берёт адрес из `reverse_proxy`, ключ — из
 * `proxy_password` (не из секретов таверны!) и делает
 * `GET {reverse_proxy}/models` с `Authorization: Bearer`. Значит, наш адрес и
 * наш ключ доезжают ровно туда же, куда шёл бы прямой запрос, — только
 * запрос делает сервер, а не браузер, и CORS его не касается. Графа `custom`
 * не подходит: там ключ читается из секретов таверны, то есть был бы чужим.
 *
 * Два неочевидных места из исходника:
 * * сервер защищён CSRF (`server-main.js:168`, `csrf-sync`) — без заголовка
 *   `X-CSRF-Token` ответ 403. Токен отдаёт `getContext().getRequestHeaders()`;
 * * провал у провайдера сервер отдаёт **статусом 200** с телом
 *   `{error: true, data: {data: []}}` — поэтому смотрим на `error` в теле, а
 *   не только на статус.
 *
 * Ключ при этом проходит через сервер таверны — это сервер самого человека,
 * тот же, что хранит ключ в `settings.json`; дальше указанного адреса он не
 * уходит.
 *
 * @returns {Promise<null | {ok: true, data: *} | {ok: false, message: string}>}
 *   `null` — пути нет вовсе (нет таверны или её заголовков), пробовать нечего.
 */
async function listModelsViaTavern(api, opts = {}) {
  const c = tavern(opts.ctx);
  if (!c || typeof c.getRequestHeaders !== 'function') return null;
  let headers;
  try { headers = c.getRequestHeaders(); } catch { return null; }
  const base = normalizeBase(api && api.endpoint);
  if (!base) return null;
  const body = {
    chat_completion_source: 'openai',
    // Сервер сам допишет `/models` (`urlJoin(apiUrl, '/models')`), поэтому
    // здесь база с `/v1`, а не адрес списка.
    reverse_proxy: `${base}/v1`,
    proxy_password: sanitizeApiKey(api && api.key).key,
  };
  const res = await request(TAVERN_STATUS_URL, { method: 'POST', headers, body: JSON.stringify(body) }, {
    timeout: opts.timeout || TIMEOUTS.models,
    signal: opts.signal,
    retry: false,
  });
  if (!res.ok) {
    // Фразы `classifyError` тут врут: 403 от таверны — это CSRF, а не ключ
    // провайдера. Поэтому своя фраза, а отмена остаётся отменой.
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

/**
 * Проверка связи: один короткий запрос к самому чат-комплишену — именно он потом
 * и будет использоваться. Проверять `/v1/models` мало: список часто открыт там,
 * где генерация уже требует прав.
 */
export async function testConnection(api, opts = {}) {
  // Актуальный API проверяется тем же путём, каким потом пойдёт генерация:
  // одним коротким запросом через таверну. Иначе «связь есть» означало бы
  // «поля заполнены», а не «оттуда приходит ответ».
  if (resolveSource(api) === 'tavern') {
    const res = await tavernComplete(opts.ctx, {
      user: 'ping', maxTokens: budgetOf(opts.maxTokens, TOKEN_BUDGETS.ping), profileId: (api && api.profile) || '',
    });
    if (!res.ok) return res;
    return { ok: true, message: res.profile ? `Связь есть: профиль «${res.profile}» отвечает.` : 'Связь есть: текущее подключение таверны отвечает.', model: res.profile || '' };
  }
  const url = chatUrl(api && api.endpoint);
  if (!url) {
    return { ok: false, code: 'no-endpoint', message: 'Адрес не задан: вписать endpoint.', status: null, detail: '' };
  }
  const model = (api && api.model) || '';
  if (!model) {
    return { ok: false, code: 'no-model', message: 'Модель не выбрана: возьмите её из списка или впишите руками.', status: null, detail: '' };
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
    // Проверка связи — диагноз, а не работа: «сейчас 429» и есть ответ на
    // вопрос человека. Повтор спрятал бы его за двумя с половиной секундами.
    retry: false,
  });
  if (!res.ok) return res;
  return { ok: true, message: `Связь есть: ${model} отвечает.`, model };
}

/**
 * Один запрос к модели. Свой endpoint, если он задан; иначе — текущее
 * подключение таверны.
 *
 * @param {Object} api {endpoint, key, model}
 * @param {Object} req {system, user, ctx, signal, timeout, maxTokens}
 * @returns {Promise<{ok: true, text: string, via: 'endpoint'|'tavern'} | {ok: false, code, message}>}
 */
export async function complete(api, req = {}) {
  const { system = '', user = '', ctx, signal } = req;
  const url = chatUrl(api && api.endpoint);
  const source = resolveSource(api);

  if (source === 'endpoint' && !(url && api && api.model)) {
    // Свой адрес выбран человеком явно — уходить в таверну молча нельзя: он
    // ждёт свою дешёвую модель, а получил бы счёт от основного подключения.
    return {
      ok: false,
      code: 'no-endpoint',
      status: null,
      detail: '',
      message: url
        ? 'Выбран свой адрес, но модель не выбрана: возьмите её из списка или впишите руками.'
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

  // Актуальное подключение таверны — теперь не «запасной путь», а такая же
  // графа выбора; при `source: 'auto'` она по-прежнему выбирается сама, когда
  // своего адреса нет.
  return tavernComplete(ctx, {
    system, user, maxTokens: budgetOf(req.maxTokens, TOKEN_BUDGETS.default), profileId: (api && api.profile) || '',
  });
}

/**
 * Учебный план по анкете (3.6): промпт → запрос → разбор → схема.
 * Ровно один автоматический повтор — только когда ответ пришёл и не
 * разобрался (повторы транспорта — в `request`); дальше — сырой ответ человеку и ручная
 * таблица. Ни одного вызова, кроме как по кнопке: один на семестр.
 *
 * @returns {Promise<{ok: true, plan, errors: string[], raw: string, attempts: number}
 *   | {ok: false, error: string, code: string, raw: string, errors: string[], attempts: number}>}
 */
export async function generatePlan(survey, preset, api, ctx, opts = {}) {
  const { system, prompt } = buildPlanPrompt(survey, preset);
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
      // Отказ транспорта здесь не повторяется НИКОГДА (9.1.7). Всё, что повтор
      // лечит, — 429 и 5xx своего адреса — уже повторено внутри `request`;
      // остальное повтором не лечится: ключ, адрес, модель (чинить настройки),
      // сеть/CORS (запрещённое браузером останется запрещённым), таймаут (ещё
      // полторы минуты ожидания), отмена (человек сказал «стоп»), пустой ответ
      // (у думающей модели это тот же обрыв по бюджету). Раньше здесь стоял
      // `continue` на всё, кроме списка, — и 503 давал бы шесть запросов.
      break;
    }

    const parsed = parsePlanResponse(res.text, preset);
    const checked = validatePlan(parsed.plan, preset);
    if (parsed.ok && checked.ok) {
      return {
        ok: true,
        plan: checked.plan,
        errors: [...new Set([...parsed.errors, ...checked.errors])],
        raw: parsed.raw,
        attempts: attempt,
        via: res.via,
      };
    }
    // Обрыв по длине повторять нечем: бюджет тот же, промпт от уточнения «верни
    // только JSON» стал длиннее — второй ответ оборвётся там же, только за
    // деньги. Поэтому здесь `break`, а не `continue`.
    if (res.truncated) {
      last = {
        // «Учебный план» и «дисциплины» тут стояли рядом и оба мимо словаря:
        // русскому вузу показывали слово магической академии, а магической —
        // слово вуза. Название берётся из пресета, а форма фразы выбрана без
        // рода: «Расписание предметов пришёл наполовину» не сказать.
        error: truncatedMessage(`${planWord(preset)} — только половина`, res.budget,
          'Таблицу ниже можно заполнить руками.'),
        code: 'truncated',
        raw: parsed.raw,
        errors: [...new Set([...parsed.errors, ...checked.errors, 'truncated'])],
      };
      break;
    }
    last = {
      // Без названия вовсе: род и падеж у него в каждом пресете свои, а
      // человеку здесь важно не как это называется, а что делать дальше.
      error: 'Ответ модели не разобрался. Таблицу ниже можно заполнить руками.',
      code: 'parse',
      raw: parsed.raw,
      errors: [...new Set([...parsed.errors, ...checked.errors])],
    };
  }

  return { ok: false, ...last, attempts: made };
}

// --- автозаполнение анкеты по карточке персонажа (3.6) -----------------------
//
// «Отдельным вызовом можно попросить модель прочитать карточку персонажа и
// первое сообщение и предположить эпоху, страну и тип заведения. Результат
// падает в поля анкеты, а не в состояние игры» — плана 3.6.
//
// Четыре решения, из которых вытекает блок.
//
// 1. **Это предположение, а не факт.** Ни одна функция здесь не умеет писать
//    состояние и не зовёт `storage`: наружу уходит объект из шести полей, его
//    место — поля формы, где человек их видит и правит. Отсюда же правило
//    «пустая строка лучше выдумки» в самом промпте: пустое поле человек
//    заполнит, а тихо угаданный «медицинский факультет» он не заметит.
//
// 2. **Шаблон живёт в пресете** (`prompts.survey`), как `prompts.plan`.
//    В коде — только перекрываемое умолчание: слова заведения в логике не
//    живут (раздел 1 плана).
//
// 3. **Недоверие к ответу — того же уровня, что у плана.** Тот же `extractJson`
//    (забор ```json, скобочный баланс, осторожная починка), те же синонимы
//    ключей, тот же один автоматический повтор. Модель ответит не тем, чего
//    ждёшь, и это нормальный ход событий, а не сбой.
//
// 4. **Карточка читается по живым именам полей `getContext()`.** Порядок:
//    `getCharacterCardFields()` (он же разрешает групповые карточки и макросы),
//    иначе `characters[characterId]` напрямую. Первое сообщение берётся из
//    `chat` — то есть то, которое реально в игре (правленное, альтернативное
//    приветствие), а карточное `first_mes` только как запасное.

/** Сколько текста карточки уезжает в промпт. Длинные карточки режутся, а не ломают запрос. */
export const CARD_LIMITS = { field: 1200, firstMessage: 1500 };

/**
 * Шаблон запроса по умолчанию. Данные: пресет перекрывает блоком
 * `preset.prompts.survey`. Плейсхолдеры `{name}`, `{card}`, `{firstMessage}`,
 * `{lang}`; фигурные скобки JSON-образца под подстановку не попадают —
 * подстановка видит только `{слово}` без кавычек.
 */
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

/** Ровно те шесть ключей, что и в анкете 3.6 (`emptySurvey`). */
export const SURVEY_KEYS = Object.keys(emptySurvey());

/**
 * Синонимы ключей: модель зовёт поля как ей удобнее, и ругать её за это
 * бессмысленно — дешевле понять. Порядок внутри списка — от точного к вольному.
 */
const SURVEY_ALIASES = {
  era: ['era', 'setting', 'epoch', 'period', 'time', 'эпоха', 'сеттинг'],
  country: ['country', 'tradition', 'region', 'nation', 'страна'],
  institution: ['institution', 'school', 'schoolType', 'institutionType', 'type', 'заведение'],
  faculty: ['faculty', 'department', 'direction', 'major', 'field', 'факультет', 'направление'],
  year: ['year', 'grade', 'course', 'yearOfStudy', 'курс', 'год'],
  lang: ['lang', 'language', 'locale', 'язык'],
};

/** Вежливое «не знаю» — это пустое поле, а не значение. Иначе оно приедет в форму текстом. */
const EMPTY_WORDS = new Set(['', '-', '—', '?', 'n/a', 'na', 'null', 'none', 'unknown', 'unspecified',
  'неизвестно', 'не указано', 'не указан', 'не указана', 'нет данных', 'не определено', 'нет']);

const cardStr = (v) => (v == null ? '' : String(v)).trim();

function cut(s, limit) {
  const t = cardStr(s);
  return t.length > limit ? `${t.slice(0, limit).trim()}…` : t;
}

/**
 * Первое сообщение персонажа так, как оно реально стоит в чате: правленное или
 * альтернативное приветствие важнее карточного `first_mes`. Форма записи чата —
 * `{name, is_user, is_system, mes}` (`script.js:7655`).
 */
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

/**
 * Карточка персонажа для промпта. Никогда не бросает: отсутствие персонажа —
 * такой же внятный отказ, как отказ сети.
 *
 * @returns {{ok: true, card: Object, warnings: string[]}
 *   | {ok: false, code: 'no-context'|'no-character'|'group'|'empty-card', message: string}}
 */
export function readCharacterCard(ctx) {
  const c = tavern(ctx);
  if (!c) {
    return { ok: false, code: 'no-context', message: 'Контекст SillyTavern недоступен: карточку неоткуда взять.' };
  }

  // `getCharacterCardFields` (script.js:3417) разрешает групповые карточки,
  // макросы и переопределения из метаданных — если он есть, он точнее.
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
        message: 'Это групповой чат, и общей карточки в нём нет: заполните анкету руками.',
      };
    }
    if (!char) {
      return { ok: false, code: 'no-character', message: 'Персонаж не выбран: расширению нечего читать.' };
    }
    return {
      ok: false,
      code: 'empty-card',
      message: `Карточка «${card.name || 'без имени'}» пуста: ни описания, ни сценария, ни первого сообщения.`
        + ' Угадывать не по чему — заполните анкету руками.',
    };
  }

  const warnings = [];
  // Пустое первое сообщение не отказ, пока есть описание: угадать по нему можно,
  // но человек должен знать, что предположение построено на половине данных.
  if (!card.firstMessage) warnings.push('первого сообщения нет: предположение построено только по карточке');
  if (!hasCardText) warnings.push('карточка пуста: предположение построено только по первому сообщению');
  return { ok: true, card, warnings };
}

/** Карточка одним текстовым куском: пустые поля не занимают место в промпте. */
export function cardToText(card) {
  const c = card || {};
  const parts = [];
  if (c.description) parts.push(`Описание: ${c.description}`);
  if (c.personality) parts.push(`Характер: ${c.personality}`);
  if (c.scenario) parts.push(`Сценарий: ${c.scenario}`);
  if (c.creatorNotes) parts.push(`Заметки автора: ${c.creatorNotes}`);
  return parts.join('\n') || '(карточка пуста)';
}

/**
 * Промпт автозаполнения анкеты.
 *
 * @param {Object} card из `readCharacterCard`
 * @param {Object} preset
 * @returns {{system: string, prompt: string}}
 */
export function buildSurveyPrompt(card, preset) {
  const tpl = { ...DEFAULT_SURVEY_PROMPT, ...((preset && preset.prompts && preset.prompts.survey) || {}) };
  const vars = {
    name: cardStr(card && card.name) || 'без имени',
    card: cardToText(card),
    firstMessage: cardStr(card && card.firstMessage) || '(первого сообщения нет)',
    lang: cardStr(preset && preset.lang) || 'ru',
  };
  return { system: fill(tpl.system, vars), prompt: fill(tpl.user, vars) };
}

/** Значение поля анкеты из чего угодно: строка, число, массив, «не знаю». */
function surveyValue(v) {
  if (v == null) return '';
  if (Array.isArray(v)) {
    return surveyValue(v.map((x) => surveyValue(x)).filter(Boolean).join(', '));
  }
  if (typeof v === 'object') return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (EMPTY_WORDS.has(s.toLowerCase().replace(/[.!]+$/, ''))) return '';
  // Модель, которой не хватило места в поле, пишет туда абзац. В форму он не
  // влезет, а человек всё равно перепишет: режем, а не берём целиком.
  return s.length > 80 ? `${s.slice(0, 80).trim()}…` : s;
}

/** Пустая анкета: шесть полей, язык — из пресета, если он там есть. */
function blankSurvey(preset) {
  const s = emptySurvey();
  const lang = cardStr(preset && preset.lang);
  if (lang) s.lang = lang;
  return s;
}

/**
 * Разбор ответа модели в анкету. Никогда не бросает: что не понято — в `errors`,
 * что пришло — в `raw`. На выходе всегда ровно шесть полей строками.
 *
 * @returns {{ok: boolean, survey: Object, filled: string[], errors: string[], raw: string}}
 */
export function parseSurveyResponse(text, preset) {
  const raw = typeof text === 'string' ? text : String(text == null ? '' : text);
  const data = extractJson(raw);
  if (data === undefined) {
    return { ok: false, survey: blankSurvey(preset), filled: [], errors: ['no-json'], raw };
  }

  // Модель любит обёртки: {survey: {…}}, {result: {…}}.
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
      const value = surveyValue(hit);
      if (value) { survey[key] = value; break; }
    }
  }
  const checked = validateSurveyGuess(survey, preset);
  return { ok: checked.ok, survey: checked.survey, filled: checked.filled, errors: checked.errors, raw };
}

/**
 * Проверка предположения. `ok` — «с этим можно работать»: заполнено хоть одно
 * поле, кроме языка. Язык один не считается: он подставляется из пресета и был
 * бы заполнен даже при полном молчании модели.
 *
 * @returns {{ok: boolean, survey: Object, filled: string[], errors: string[]}}
 */
export function validateSurveyGuess(survey, preset) {
  const out = blankSurvey(preset);
  for (const key of SURVEY_KEYS) {
    const v = surveyValue(survey && survey[key]);
    if (v) out[key] = v;
  }
  const filled = SURVEY_KEYS.filter((k) => k !== 'lang' && out[k]);
  const errors = [];
  // Три поля названы в плане прямо: «предположить эпоху, страну и тип заведения».
  for (const key of ['era', 'country', 'institution']) if (!out[key]) errors.push(`no-${key}`);
  if (!filled.length) errors.push('survey-empty');
  return { ok: filled.length > 0, survey: out, filled, errors };
}

/**
 * Автозаполнение анкеты (3.6): карточка → промпт → запрос → разбор → проверка.
 * Ровно один автоматический повтор на неразобранный ответ, как у плана; дальше — честный отказ и сырой
 * ответ человеку.
 *
 * **Состояние не пишется.** Результат — предположение для полей формы; кто и
 * когда положит его в состояние, решает человек кнопкой «начать семестр».
 *
 * @param {Object} preset
 * @param {Object} api {endpoint, key, model}
 * @param {Object} [ctx] контекст таверны; без него берётся установленный провайдер
 * @param {{signal?: AbortSignal, timeout?: number}} [opts]
 * @returns {Promise<{ok: true, survey: Object, filled: string[], errors: string[],
 *     warnings: string[], raw: string, attempts: number, via: string, card: Object}
 *   | {ok: false, code: string, error: string, errors: string[], warnings: string[],
 *      raw: string, attempts: number}>}
 */
export async function guessSurvey(preset, api, ctx, opts = {}) {
  const read = readCharacterCard(ctx);
  if (!read.ok) {
    return { ok: false, code: read.code, error: read.message, errors: [read.code], warnings: [], raw: '', attempts: 0 };
  }
  const warnings = read.warnings;
  const { system, prompt } = buildSurveyPrompt(read.card, preset);
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
      // То же правило, что у генерации плана: транспорт уже повторил, что мог.
      break;
    }

    const parsed = parseSurveyResponse(res.text, preset);
    if (parsed.ok) {
      return {
        ok: true,
        survey: parsed.survey,
        filled: parsed.filled,
        // Претензии вроде `no-country` — не ошибка: пустое поле человек допишет.
        errors: parsed.errors,
        warnings,
        raw: parsed.raw,
        attempts: attempt,
        via: res.via,
        card: { name: read.card.name },
      };
    }
    // То же решение, что и у плана: обрыв по длине повтором не лечится.
    if (res.truncated) {
      last = {
        error: truncatedMessage('анкета пришла наполовину', res.budget, 'Поля анкеты можно заполнить руками.'),
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

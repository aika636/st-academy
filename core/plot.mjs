// core/plot — «Взять в сюжет» (шаг 4, слой 3 из 9.11): очередь поводов,
// которые игрок отдаёт рассказчику по одному, разово.
//
// Лента целиком в промпт не идёт. Повод из неё уходит только по выбору игрока
// (или авто-режимом, если он сам его включил) — одной мягкой строкой в
// следующую генерацию. Режиссёр — игрок; модель не долбит поводом каждый ответ.
//
//   plot = {
//     queue: [ { id, ref, kind: 'item'|'deal', core, text, rumor, auto,
//                armed, delivered, takenAt } ],
//     log:   [ { id, ref, kind, core, deliveredAt } ],   // ушло в ответ, ждёт «сыграно»
//     replies,   // сколько новых ответов модели прошло (свайп не считается)
//     seq,       // счётчик id поводов: p1, p2…
//     autoAt,    // на каком ответе авто-режим подкинул последний повод
//     hookAt,    // какой ответ (по счёту `replies`) последним унёс повод — любой
//     lastCore,  // прошлая формулировка — для «не повторяй»
//   }
//
// Пять решений (`razbor-inject.md`).
//
// 1. **Повод живёт вне состояния семестра** (`chat_metadata.academy_plot`).
//    Его жизнь — функция генераций, а не сюжета: снимок хода откатывал бы
//    очередь при каждом свайпе. Статус записи ленты («взято», «сыграно»,
//    «истекло») — в самой ленте, и его переносит `feed.carryFeedMarks`.
// 2. **Снимается на следующей реплике игрока, а не на ответе** (приём 6).
//    Таверна шлёт `GENERATION_STARTED` раньше `MESSAGE_SENT`, а промпт
//    собирает после обоих. Поэтому: генерация взводит голову очереди
//    (`armed`); пришедший ответ помечает взведённый отданным (`delivered`);
//    следующая реплика игрока уносит отданный в журнал (`log`) и взводит
//    следующий. Свайп и регенерация реплики не шлют — повод переживает их.
// 3. **За раз — один повод** (приём 3). Взведён всегда только один.
// 4. **Без вечного «ждёт»** (приём 2, «не брать»). Отданный повод секретарь
//    отмечает сыгранным (`played=` в «что было»), иначе через `PLOT_EXPIRE`
//    ответов он истекает; у слуха это «лопнуло». Взятая запись, которой нет
//    ни в очереди, ни в свежем журнале, истекает тоже.
// 5. **Команда игрока важнее автоматики** (приём 11): «(без сплетен)» или
//    «(без поводов)» в реплике гасит повод и авто-режим на этот ход —
//    взведённый, но не отданный, возвращается ждать.
// 6. **Повод праздника главнее повода игрока** (решение владелицы Р5, 07.10).
//    В ход, когда звучит разовый повод праздника или события
//    (`holidays.armHolidayHooks`), повод игрока уступает (`yielded`): в этот
//    ответ уходит только праздничный, а повод игрока остаётся первым в
//    очереди до следующего хода. Авто-режим в такой ход тоже молчит.
//
// Модуль чистый: на входе очередь и состояние, на выходе — новые копии.

import { cloneState } from './state.mjs';
import { HEROINE } from './parse-marker.mjs';
import { feedItems, setStatus, openDeals, normalizeFeed } from './feed.mjs';
import { diffDays } from './time.mjs';
import { dealText, shortName } from './scene.mjs';

/** Через сколько ответов отданный, но не сыгранный повод истекает. */
export const PLOT_EXPIRE = 6;

/** Пауза авто-режима между поводами, в ответах. */
export const AUTO_PAUSE = 6;

/** Пауза авто-режима для громкого события (`loud` от 2). */
export const AUTO_PAUSE_LOUD = 2;

/** За сколько игровых дней запись ещё годится авто-режиму. */
export const AUTO_FRESH_DAYS = 2;

/** Сколько поводов ждёт в очереди самое большее. */
export const QUEUE_MAX = 5;

/** Сколько отданных поводов помнит журнал. */
export const LOG_MAX = 20;

/** Сколько отданных поводов видит секретарь. */
export const SECRETARY_HOOKS = 3;

/** Длина формулировки (с рамкой) и её сути. */
export const HOOK_TEXT_MAX = 600;
export const CORE_MAX = 220;

/**
 * Мягкая рамка повода (приём 8): находка, а не приказ; внешнее, а не слова
 * героини; прозвучало — дальше не повторять. Слова — данные: пресет волен
 * перекрыть их блоком `phrases.plot`.
 */
export const DEFAULT_PLOT_PHRASES = {
  frame: 'Если уместно, можно вплести в сцену (необязательная находка, не приказ): {core}.',
  rumor: 'Это слух — правда ли, неизвестно.',
  outward: 'Покажи внешнее; слова и решения персонажа игрока оставь игроку. Прозвучит — дальше не возвращайся к этому.',
  notAgain: 'Не повторяй: {last}.',
  // Реплика ленты — написанное в чате, а не сказанное в сцене.
  said: '{who} пишет в чате: «{text}»',
  // «Кто-то с курса» — словом пресета (`vocab.someone`: «кто-то из класса»).
  someone: 'кто-то с курса',
  gossip: 'пишут без подписи: «{text}»',
  rumorFact: 'говорят, что {gist}',
  // Дело — фразой `scene.dealText`: «Мила должна Вере: вернуть тетрадь».
  deal: 'незакрытое дело — {deal}',
  heroine: 'героиня',
  // Ветка под постом — одной фразой после сути (решение 08.10).
  threadArgue: 'в ветке спорят',
  threadBack: 'в ветке поддерживают',
  threadTease: 'в ветке подкалывают',
  threadTalk: 'в ветке отвечают',
  threadGlue: '; ',
};

/** Вид разового инжекта праздника и события (`holidays.armHolidayHooks`). */
export const HOLIDAY_KIND = 'holiday';

/** Звучит ли в этот ход повод праздника: среди одноразовых инжектов хода есть праздничный. */
export function holidayIn(injects) {
  return (Array.isArray(injects) ? injects : []).some((i) => i && i.kind === HOLIDAY_KIND);
}

/** «(без сплетен)» / «(без поводов)» в реплике игрока. */
const MUTE_RE = /\(\s*без\s+(?:сплетен|поводов)\s*\)/iu;

/** Молчат ли поводы на этот ход по слову игрока. */
export function isMuted(text) {
  return MUTE_RE.test(String(text || ''));
}

/**
 * Напряжённая или интимная ли сцена (приём 9: «в такой сцене фон и повод
 * молчат»). Надёжно это сейчас не определить: слова «поцелуй» и «крик»
 * встречаются и в бытовой сцене, а тихий запрос ради этого стоил бы денег
 * на каждом ответе. Поэтому эвристик нет — заглушка всегда отвечает «нет»,
 * а место, где ответ учитывается (фон слоя 1 и повод слоя 3 в `index.js`),
 * уже готово. Пока у игрока есть «(без сплетен)».
 *
 * @param {string} [_text] последний ответ или реплика
 * @returns {boolean}
 */
export function quietScene(_text) {
  return false;
}

// --- поле ---------------------------------------------------------------------------

export function emptyPlot() {
  return { queue: [], log: [], replies: 0, seq: 0, autoAt: null, hookAt: null, lastCore: '' };
}

/** Нормализовать сырую очередь: всё непохожее выбрасывается молча. */
export function normalizePlot(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const queue = (Array.isArray(src.queue) ? src.queue : []).map(normalizeHook).filter(Boolean).slice(0, QUEUE_MAX);
  // Взведён только один: лишние взведённые (битое поле) — снова ждут.
  let armed = false;
  for (const h of queue) {
    if (h.armed && !armed) armed = true;
    else if (h.armed) {
      h.armed = false;
      h.delivered = false;
    }
  }
  const log = (Array.isArray(src.log) ? src.log : []).map((e) => {
    if (!e || typeof e !== 'object' || !str(e.id) || !str(e.ref)) return null;
    return {
      id: str(e.id), ref: str(e.ref), kind: e.kind === 'deal' ? 'deal' : 'item',
      core: oneLine(e.core, CORE_MAX), deliveredAt: int(e.deliveredAt, 0),
    };
  }).filter(Boolean).slice(-LOG_MAX);
  return {
    queue,
    log,
    replies: int(src.replies, 0),
    seq: int(src.seq, 0),
    autoAt: Number.isInteger(src.autoAt) ? src.autoAt : null,
    hookAt: Number.isInteger(src.hookAt) ? src.hookAt : null,
    lastCore: oneLine(src.lastCore, CORE_MAX),
  };
}

function normalizeHook(h) {
  if (!h || typeof h !== 'object') return null;
  const id = str(h.id);
  const ref = str(h.ref);
  const text = oneLine(h.text, HOOK_TEXT_MAX);
  if (!id || !ref || !text) return null;
  const armed = h.armed === true;
  return {
    id, ref,
    kind: h.kind === 'deal' ? 'deal' : 'item',
    core: oneLine(h.core, CORE_MAX),
    text,
    rumor: h.rumor === true,
    auto: h.auto === true,
    armed,
    delivered: armed && h.delivered === true,
    takenAt: int(h.takenAt, 0),
  };
}

// --- формулировка -------------------------------------------------------------------

function phrasesOf(preset) {
  const own = preset && preset.phrases && preset.phrases.plot;
  const someone = preset && preset.vocab && typeof preset.vocab.someone === 'string' && preset.vocab.someone.trim();
  return {
    ...DEFAULT_PLOT_PHRASES,
    ...(someone ? { someone } : {}),
    ...(own && typeof own === 'object' ? own : {}),
  };
}

/**
 * Реплика анонимки без «говорят» в начале: рамка уже говорит «ходит слух»,
 * и «ходит слух: «Говорят, Вера…»» читалось дважды.
 */
export function unsaid(text) {
  const t = str(text).replace(/^(?:говорят|ходят слухи|ходит слух|поговаривают)\s*(?:[,:—–-]\s*)?(?:что\s+)?/iu, '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : str(text);
}

/** Люди для слов: преподаватели и курс. */
function peopleOf(state) {
  return [...((state && state.teachers) || []), ...((state && state.classmates) || [])].filter((p) => p && p.id);
}

/**
 * Тон ветки одним словом — по словам ответов, без модели: спорят, поддерживают,
 * подкалывают; не понять — «отвечают». Это подсказка рассказчику, а не
 * вывод: ошибка тона стоит одной мягкой фразы.
 */
// Словарь спора — по типичным репликам ветки (третий прогон 08.10: «спорят»
// не встречалось ни разу). Пробел в слове — любой пробельный (`ARGUE_RE`).
const ARGUE_WORDS = [
  'неправд', 'вр[её]шь', 'вр[её]т', 'вран', 'враки', 'не ври', 'брехн', 'бред', 'чушь', 'чепух', 'глупост', 'ерунд',
  'не верю', 'да ладно', 'да ну', 'с чего', 'с какой стати', 'ты что', 'ты чего', 'вы что', 'чего[?]', 'фейк',
  'гон(?:ишь|ят|ит)', 'не так', 'не неси', 'не выдумывай', 'ничего подобного', 'вовсе нет', 'вообще не',
  'кто бы говорил', 'сам[аи]? (?:такой|такая|такие|ты)', 'докажи', 'пруф', 'отвали', 'отстань',
  'я-то', 'это ты', 'не смеши', 'ага,? щас', 'ещ[её] чего', 'не правда',
];
const ARGUE_RE = new RegExp(`(?<![\\p{L}])(?:${ARGUE_WORDS.join('|').replace(/ /g, '\\s+')})`, 'iu');
const BACK_RE = /(?<![\p{L}])(?:соглас|поддерж|точно|правильно|прав[аы]?(?![\p{L}])|так и есть|жиза|респект|молод(?:ец|цы)|держись|за неё|за него|\+1)/iu;
const TEASE_RE = /(?<![\p{L}])(?:ха(?:ха)+|лол|кек|ну-ну|ага,? конечно|ну конечно|клоун)(?![\p{L}])/iu;

export function threadTone(texts) {
  const list = (Array.isArray(texts) ? texts : []).map(str).filter(Boolean);
  if (!list.length) return '';
  const n = (re) => list.filter((t) => re.test(t)).length;
  const scores = [['argue', n(ARGUE_RE)], ['back', n(BACK_RE)], ['tease', n(TEASE_RE)]];
  scores.sort((a, b) => b[1] - a[1]);
  return scores[0][1] > 0 ? scores[0][0] : 'talk';
}

function threadPhrase(tone, P) {
  if (tone === 'argue') return P.threadArgue;
  if (tone === 'back') return P.threadBack;
  if (tone === 'tease') return P.threadTease;
  return tone ? P.threadTalk : '';
}

function nameOf(id, state, P, heroine) {
  if (id === HEROINE) return heroine || P.heroine;
  if (!id || id === 'someone') return P.someone;
  const p = peopleOf(state).find((x) => x.id === id);
  if (!p) return P.someone;
  // Коротко: преподаватель — фамилией, однокурсник — без отчества (`scene.shortName`).
  const teacher = ((state && state.teachers) || []).some((t) => t && t.id === id);
  return shortName(p.name || p.id, { teacher }) || p.id;
}

/**
 * Суть повода — что именно может мелькнуть в сцене, без рамки.
 *
 * @param {Object} state
 * @param {string} ref id записи ленты или дела
 * @param {{heroine?: string, preset?: Object}} [opts]
 * @returns {?{ref: string, kind: 'item'|'deal', core: string, rumor: boolean}}
 */
export function hookCore(state, ref, opts = {}) {
  const P = phrasesOf(opts.preset);
  const heroine = str(opts.heroine);
  const items = feedItems(state);
  const item = items.find((x) => x.id === ref);
  if (item) {
    let core;
    if (item.kind === 'fact') core = item.rumor && item.gist ? fill(P.rumorFact, { gist: bare(item.gist) }) : item.text;
    else if (item.chan === 'anon') core = fill(P.gossip, { text: bare(unsaid(item.text)) });
    // Маска — не человек: рассказчику она «кто-то с курса», без ника, чтобы
    // из ника не вырос персонаж.
    else core = fill(P.said, { who: item.nick ? P.someone : nameOf(item.who, state, P, heroine), text: bare(item.text) });
    // Ветка — одной фразой: о чём спорят или что поддерживают, без реплик.
    const thread = threadPhrase(threadTone(items.filter((x) => x.parent === item.id).map((x) => x.text)), P);
    if (thread) core = `${bare(core)}${P.threadGlue}${thread}`;
    return { ref, kind: 'item', core: oneLine(core, CORE_MAX), rumor: item.rumor === true };
  }
  const deal = openDeals(state).find((d) => d.id === ref);
  if (deal) {
    const core = fill(P.deal, {
      deal: dealText({ ...deal, closed: false }, peopleOf(state), heroine),
      // Старые слова пресета (`{a}`, `{b}`, `{what}`) — по-прежнему подставляются.
      a: nameOf(deal.a, state, P, heroine), b: nameOf(deal.b, state, P, heroine), what: deal.what,
    });
    return { ref, kind: 'deal', core: oneLine(core, CORE_MAX), rumor: false };
  }
  return null;
}

/**
 * Формулировка повода целиком: мягкая рамка, пометка слуха, «внешнее, а не
 * слова героини»; у авто-режима — «не повторяй» с прошлой формулировкой.
 */
export function hookWording({ core, rumor }, opts = {}) {
  const P = phrasesOf(opts.preset);
  const parts = [fill(P.frame, { core: bare(core) })];
  if (rumor) parts.push(P.rumor);
  parts.push(P.outward);
  const last = bare(opts.notAgain);
  if (last && last !== bare(core)) parts.push(fill(P.notAgain, { last }));
  return oneLine(parts.filter(Boolean).join(' '), HOOK_TEXT_MAX);
}

/** Черновик для превью: суть и формулировка по умолчанию. `null` — нечего брать. */
export function draftHook(state, ref, opts = {}) {
  const c = hookCore(state, ref, opts);
  if (!c) return null;
  return { ...c, text: hookWording(c, opts) };
}

// --- очередь ------------------------------------------------------------------------

/**
 * Взять повод в сюжет. Запись ленты становится «взято в сюжет».
 *
 * @param {Object} plot
 * @param {Object} state
 * @param {{ref: string, text?: string, auto?: boolean, heroine?: string, preset?: Object, notAgain?: string}} what
 * @returns {{ok: boolean, plot: Object, state: Object, id?: string, error?: string}}
 */
export function takeHook(plot, state, what = {}) {
  const p = normalizePlot(plot);
  const ref = str(what.ref);
  const c = hookCore(state, ref, what);
  if (!c) return { ok: false, plot: p, state, error: 'этой записи больше нет' };
  if (p.queue.some((h) => h.ref === ref)) return { ok: false, plot: p, state, error: 'этот повод уже ждёт своего ответа' };
  if (p.queue.length >= QUEUE_MAX) return { ok: false, plot: p, state, error: `в очереди уже ${QUEUE_MAX} — уберите лишний` };
  const text = oneLine(what.text, HOOK_TEXT_MAX) || hookWording(c, what);
  p.seq += 1;
  const id = `p${p.seq}`;
  p.queue.push({
    id, ref, kind: c.kind, core: c.core, text, rumor: c.rumor,
    auto: what.auto === true, armed: false, delivered: false, takenAt: p.replies,
  });
  let next = state;
  if (c.kind === 'item') {
    next = cloneState(state);
    setStatus(next, ref, 'taken');
  }
  return { ok: true, plot: p, state: next, id };
}

/**
 * Убрать повод из очереди. Не отданный — запись ленты снова ждёт; отданный
 * уже побывал в промпте — он уходит в журнал и ждёт «сыграно» или истечения.
 */
export function dropHook(plot, state, id) {
  const p = normalizePlot(plot);
  const at = p.queue.findIndex((h) => h.id === id);
  if (at < 0) return { ok: false, plot: p, state };
  const [h] = p.queue.splice(at, 1);
  let next = state;
  if (h.delivered) toLog(p, h);
  else if (h.kind === 'item') {
    next = cloneState(state);
    const item = normalizeFeed(next.feed).items.find((x) => x.id === h.ref);
    if (item && item.status === 'taken') setStatus(next, h.ref, 'new');
  }
  return { ok: true, plot: p, state: next };
}

/** Взведённый повод — тот, что уйдёт в эту генерацию; `null` — нет. */
export function armedHook(plot) {
  return normalizePlot(plot).queue.find((h) => h.armed) || null;
}

/** Текст повода для промпта: один, взведённый. */
export function hookPrompt(plot) {
  const h = armedHook(plot);
  return h ? h.text : '';
}

function arm(p) {
  if (p.queue.some((h) => h.armed)) return p;
  const head = p.queue[0];
  if (head) {
    head.armed = true;
    head.delivered = false;
  }
  return p;
}

function toLog(p, h) {
  p.log = [...p.log.filter((e) => e.id !== h.id), {
    id: h.id, ref: h.ref, kind: h.kind, core: h.core, deliveredAt: p.replies,
  }].slice(-LOG_MAX);
  p.lastCore = h.core;
}

/**
 * Генерация начинается (`GENERATION_STARTED`): взвести голову очереди, если
 * ещё ничего не взведено. Слой выключен или игрок попросил тишины — нет.
 */
export function onGeneration(plot, { enabled = true, muted = false, yielded = false } = {}) {
  const p = normalizePlot(plot);
  if (!enabled || muted) return p;
  if (yielded) return yieldTo(p);
  return arm(p);
}

/**
 * Уступить повод празднику (решение 6 в шапке): взведённый, но ещё не
 * отданный повод снова ждёт и в этот ответ не уходит. Отданный прошлому
 * ответу не трогается — его снимет реплика игрока, как обычно.
 */
function yieldTo(p) {
  for (const h of p.queue) {
    if (h.armed && !h.delivered) h.armed = false;
  }
  return p;
}

/**
 * Реплика игрока ушла (`MESSAGE_SENT`): отданный повод — в журнал, его
 * место занимает следующий. «(без сплетен)» — взведённый, но не отданный,
 * снова ждёт, и ничего не взводится.
 *
 * @returns {{plot: Object, sent: Object[]}} `sent` — что ушло в журнал
 */
export function onPlayerSent(plot, { enabled = true, muted = false, yielded = false } = {}) {
  const p = normalizePlot(plot);
  const sent = p.queue.filter((h) => h.armed && h.delivered);
  for (const h of sent) toLog(p, h);
  p.queue = p.queue.filter((h) => !(h.armed && h.delivered));
  if (!enabled || muted) {
    for (const h of p.queue) h.armed = false;
    return { plot: p, sent };
  }
  if (yielded) return { plot: yieldTo(p), sent };
  return { plot: arm(p), sent };
}

/**
 * Пришёл ответ модели: взведённый повод в нём побывал. `fresh` — это новый
 * ответ, а не свайп или пересчёт: счёт ответов для истечения и пауз.
 */
export function onReply(plot, { fresh = false, delivered = true } = {}) {
  const p = normalizePlot(plot);
  if (fresh) p.replies += 1;
  let carried = false;
  if (delivered) {
    for (const h of p.queue) {
      if (!h.armed) continue;
      if (!h.delivered) carried = true;
      h.delivered = true;
    }
  }
  // Пауза авто-режима считается от ответа, который унёс повод, — любой, свой
  // или взятый кнопкой. Свайп того же ответа повод не «уносит» второй раз.
  if (carried) p.hookAt = p.replies;
  return p;
}

/**
 * Истечение (приём 2): отданный и не сыгранный за `PLOT_EXPIRE` ответов —
 * «истекло» (слух — «лопнуло»). Взятая запись, о которой очередь и свежий
 * журнал не знают (повод убрали, журнал срезан), истекает тоже: вечного
 * «взято» нет. Журнал держит только свежие записи.
 *
 * @returns {{plot: Object, state: Object, expired: string[]}}
 */
export function expireHooks(plot, state) {
  const p = normalizePlot(plot);
  const young = (e) => p.replies - e.deliveredAt < PLOT_EXPIRE;
  p.log = p.log.filter(young);
  const alive = new Set([...p.queue.map((h) => h.ref), ...p.log.map((e) => e.ref)]);
  const stale = feedItems(state).filter((x) => x.status === 'taken' && !alive.has(x.id));
  if (!stale.length) return { plot: p, state, expired: [] };
  const next = cloneState(state);
  for (const x of stale) setStatus(next, x.id, 'expired');
  return { plot: p, state: next, expired: stale.map((x) => x.id) };
}

/**
 * Поводы, которые видит секретарь: отданные рассказчику и ещё не решённые
 * (запись «взята»; у дела статуса нет). Свежие первыми, не больше трёх.
 * @returns {Array<{id: string, ref: string, text: string}>}
 */
export function secretaryHooks(plot, state) {
  const p = normalizePlot(plot);
  const items = new Map(feedItems(state).map((x) => [x.id, x]));
  const open = (e) => e.kind === 'deal' || (items.get(e.ref) && items.get(e.ref).status === 'taken');
  const list = [
    ...p.queue.filter((h) => h.delivered),
    ...[...p.log].reverse(),
  ].filter(open);
  const out = [];
  for (const e of list) {
    if (out.some((x) => x.id === e.id)) continue;
    out.push({ id: e.id, ref: e.ref, text: e.core });
    if (out.length >= SECRETARY_HOOKS) break;
  }
  return out;
}

/** Повод по id — из очереди или журнала; `null` — забыт. */
export function hookById(plot, id) {
  const p = normalizePlot(plot);
  return p.queue.find((h) => h.id === id) || p.log.find((e) => e.id === id) || null;
}

/**
 * Все поводы, о которых очередь помнит, — `{id, text}` для словаря
 * секретаря: по ним проверяется `played=` и пишется плашка.
 */
export function knownHooks(plot) {
  const p = normalizePlot(plot);
  const out = [];
  for (const h of [...p.queue, ...p.log]) {
    if (!out.some((x) => x.id === h.id)) out.push({ id: h.id, text: h.core || h.text });
  }
  return out;
}

/** Записи ленты, которые секретарь отметил сыгранными (`played=p3`). */
export function playedRefs(plot, ids) {
  const out = [];
  for (const id of [].concat(ids || [])) {
    const h = hookById(plot, id);
    if (h && h.kind === 'item' && !out.includes(h.ref)) out.push(h.ref);
  }
  return out;
}

// --- авто-режим (приём 3) ---------------------------------------------------------------

/**
 * Подкинуть повод самому — не больше одного на ответ, с паузой: обычной
 * `AUTO_PAUSE` ответов, для громкого события `AUTO_PAUSE_LOUD`. Берётся
 * не взятая свежая запись, самая громкая; при равной — непрочитанная, потом
 * новее. К формулировке — «не повторяй» с прошлой. Очередь не пуста (игрок
 * уже выбрал сам) — авто молчит; молчит и в ход праздничного повода.
 *
 * Пауза меряется **между ответами, которые унесли повод** (`hookAt`), и
 * любой повод её сдвигает — и свой, и взятый кнопкой. Раньше она шла от
 * момента, когда авто подкинуло своё (`autoAt`), а поводы игрока её не
 * трогали: после трёх ручных подряд авто подкидывало четвёртый сразу, а
 * подкинутое, но не ушедшее (ход заглушили) съедало паузу впустую. Пауза
 * `n` значит: следующий повод уходит не раньше чем `n`-м ответом после
 * прошлого — при шести между ними пять ответов без повода, при двух — один.
 *
 * @returns {{plot: Object, state: Object, id: ?string}}
 */
export function autoPick(plot, state, opts = {}) {
  const p = normalizePlot(plot);
  const none = { plot: p, state, id: null };
  if (!opts.enabled || opts.muted || opts.yielded || p.queue.length) return none;
  const day = (state && state.calendar && state.calendar.day) || '';
  const fresh = (x) => {
    if (!x.at || !x.at.day || !day) return false;
    try {
      const d = diffDays(x.at.day, day);
      return d >= 0 && d <= AUTO_FRESH_DAYS;
    } catch {
      return false;
    }
  };
  const list = feedItems(state)
    .map((x, i) => ({ x, i }))
    // Ответ в ветке — не повод: повод — пост, а ветка звучит фразой при нём.
    .filter(({ x }) => !x.parent && x.status === 'new' && fresh(x) && !/^event=/.test(x.factRef || ''));
  if (!list.length) return none;
  list.sort((a, b) => ((b.x.loud ?? 1) - (a.x.loud ?? 1))
    || (Number(a.x.read) - Number(b.x.read))
    || (b.i - a.i));
  // Какой ответ последним унёс повод. У очереди, записанной до `hookAt`, —
  // по старому счёту: подкинутое на `autoAt` ушло следующим ответом.
  const last = p.hookAt !== null ? p.hookAt : (p.autoAt !== null ? p.autoAt + 1 : null);
  for (const { x: top } of list) {
    const pause = (top.loud ?? 1) >= 2 ? AUTO_PAUSE_LOUD : AUTO_PAUSE;
    // Повод, взятый сейчас, уйдёт следующим ответом — `replies + 1`.
    if (last !== null && p.replies + 1 - last < pause) continue;
    const res = takeHook(p, state, {
      ref: top.id, auto: true, heroine: opts.heroine, preset: opts.preset, notAgain: p.lastCore,
    });
    if (!res.ok) continue;
    res.plot.autoAt = res.plot.replies;
    return { plot: arm(res.plot), state: res.state, id: res.id };
  }
  return none;
}

// --- мелочи --------------------------------------------------------------------------

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function int(v, fallback) {
  return Number.isInteger(v) && v >= 0 ? v : fallback;
}

function oneLine(v, max) {
  return str(v).replace(/\s+/g, ' ').slice(0, max).trim();
}

/** Без конечной точки: рамка ставит свою. */
function bare(v) {
  return str(v).replace(/[\s.;,]+$/u, '');
}

function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

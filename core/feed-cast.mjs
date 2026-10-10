// core/feed-cast — постоянные статисты молвы (шаг 1 плана «Молва», `etap-molva.md`).
//
// Ник в ленте был одноразовым: «школьный бес» написал пост и забылся, у
// статистов не было ни дел, ни отношений, и конфликту было не из чего взяться.
// Каст — восемь постоянных статистов со своим типажом, интересом, целью,
// манерой речи, союзником и соперником. Отношения — только внутри каста, не к
// героине: у массовки свои дела (решения владелицы 09.10).
//
// Что здесь живёт.
//
// 1. **Состояние**: чтение и правка каста в `state.feed.cast` (форма и
//    нормализация — в `core/feed.mjs`). Каст сам не растёт: модель не добавляет
//    новых постоянных участников, потолок восемь.
// 2. **Промпт и разбор** генерации каста. Формат построчный, не JSON:
//    `ник | типаж | интерес | цель | манера | союзник | соперник` — дешёвые
//    модели ломают скобки, а строка рвётся только на конце, и последняя целая
//    строка всё равно годится.
// 3. **Проверка разнообразия** — код, а не просьба в промпте: в касте нет двух
//    одинаковых типажей, интересов и манер (сравнение нормализованное, грубые
//    совпадения тоже ловятся), ник не совпадает со стоп-листом (героиня,
//    персонаж карточки) и с сокурсниками из «Людей». Нарушители отдаются
//    списком id, и перегенерируется **один** статист, а не весь каст.
// 4. **Союзники и соперники** — код расставляет, если модель не дала или дала
//    битые.
// 5. **Авторы молвы**: каст плюс сокурсники из «Людей», у которых есть
//    желание или проблема (они пишут под своими именами).
//
// Вызов модели — в `api.js` (`generateFeedCast`): ядро о сети не знает и
// получает ответ колбэком (`assembleCast`).

import {
  CAST_MAX, CAST_TEXT_MAX, normalizeCastList, normalizeThreads, normalizeFeed, ensureFeed,
  feedExtras, feedManners, feedNickExamples, cleanNick,
} from './feed.mjs';
import { stopList, stopHit, normName } from './stop-names.mjs';
import { holidaysOf, eventsOf } from './holidays.mjs';
import { HEROINE } from './classmates.mjs';

/** Сколько раз перегенерируется один статист за сборку каста; дальше — как есть, с пометкой. */
export const FIX_ATTEMPTS = 6;

/** Строка-замок в конце ответа: нет её — ответ оборван, последняя строка под подозрением. */
export const END_MARK = 'КОНЕЦ';

/** Поля статиста, по которым проверяется разнообразие. */
export const DIVERSE_FIELDS = ['type', 'interest', 'manner'];

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const oneLine = (v, max) => str(v).replace(/\s+/g, ' ').slice(0, max).trim();
const plain = (v, max) => oneLine(v, max * 2).replace(/\|/g, '/').slice(0, max).trim();

// --- состояние ----------------------------------------------------------------------

/** Каст состояния — копия, нормализованная. Пусто — каст ещё не собран. */
export function castOf(state) {
  return normalizeFeed(state && state.feed).cast;
}

/** Статист по id или `null`. */
export function memberOf(state, id) {
  return castOf(state).find((m) => m.id === id) || null;
}

/**
 * Положить каст в состояние (на месте). Сюжетики держатся за id статистов:
 * при полной пересборке id новые, и старые сюжетики уходят (`keepThreads:
 * false`); при замене одного статиста id прежние, и сюжетики остаются.
 *
 * @returns {Object[]} каст после нормализации
 */
export function setCast(state, members, { keepThreads = false } = {}) {
  const feed = ensureFeed(state);
  feed.cast = normalizeCastList(members);
  feed.threads = keepThreads ? normalizeThreads(feed.threads, feed.cast) : [];
  return feed.cast;
}

/** Поля, что человек правит руками. Союзник и соперник — дело кода и пересборки. */
export const EDITABLE = ['nick', 'type', 'interest', 'goal', 'manner'];

/**
 * Правка статиста руками: ник, типаж, интерес, цель, манера. Ник — как у всех
 * масок (две буквы минимум) и не совпадает с чужим ником каста. Остальные поля
 * можно стереть: пустое поле молвы не мешает.
 *
 * @returns {{ok: true, member: Object} | {ok: false, error: string}}
 */
export function updateMember(state, id, patch) {
  const feed = ensureFeed(state);
  const m = feed.cast.find((x) => x.id === id);
  if (!m) return { ok: false, error: 'Такого статиста в касте нет.' };
  const p = patch && typeof patch === 'object' ? patch : {};
  if (p.nick !== undefined) {
    const nick = cleanNick(p.nick);
    if (!nick) return { ok: false, error: 'Ник — хотя бы две буквы.' };
    if (feed.cast.some((x) => x.id !== id && normName(x.nick) === normName(nick))) {
      return { ok: false, error: `Ник «${nick}» уже занят в касте.` };
    }
    m.nick = nick;
  }
  for (const key of EDITABLE.slice(1)) if (p[key] !== undefined) m[key] = plain(p[key], CAST_TEXT_MAX[key]);
  return { ok: true, member: { ...m } };
}

/**
 * Каст — решение человека и сборки, а не событие ответа: свайп его не откатывает
 * (как состав курса, `classmates.carryRoster`). Снимок хода получает живой
 * каст; сюжетики снимка остаются теми, что были «до ответа», если их участники
 * всё ещё в касте, — свайп откатывает их, как остальную ленту.
 *
 * @param {Object} live живое состояние
 * @param {Object} before снимок хода
 * @returns {Object} снимок с живым кастом (копия) или он сам, если менять нечего
 */
export function carryCast(live, before) {
  if (!before || typeof before !== 'object' || !live || !live.feed) return before;
  const cast = normalizeFeed(live.feed).cast;
  if (!cast.length) return before;
  const was = normalizeFeed(before.feed);
  if (JSON.stringify(was.cast) === JSON.stringify(cast)) return before;
  return { ...before, feed: { ...was, cast, threads: normalizeThreads(was.threads, cast) } };
}

// --- сравнение ----------------------------------------------------------------------

/** Ключ сравнения свободного текста: регистр, «ё», знаки препинания. */
export function textKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Основы значимых слов (от четырёх букв, по пять первых): «завистница» ≈ «завистник». */
function stems(s) {
  return new Set(textKey(s).split(' ').filter((w) => w.length >= 4).map((w) => w.slice(0, 5)));
}

/**
 * Грубое совпадение двух фраз: равны после нормализации; одна целиком входит в
 * другую; или общих основ слов не меньше половины от всех. «сплетница» и
 * «сплетница с мостика» — одно и то же; «шепчет» и «говорит громко» — разное.
 */
export function similar(a, b) {
  const x = textKey(a);
  const y = textKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))) return true;
  const sa = stems(a);
  const sb = stems(b);
  if (!sa.size || !sb.size) return false;
  let common = 0;
  for (const w of sa) if (sb.has(w)) common += 1;
  return common / (sa.size + sb.size - common) >= 0.5;
}

// --- проверка разнообразия -----------------------------------------------------------

const FIELD_WORD = { type: 'типаж', interest: 'интерес', manner: 'манера речи' };

/**
 * Манера, что искажает написание слов (баг 71: «люмо», вставленное внутрь слов, —
 * «Клюмостёл снлюмосва»): вставки в слова и слоги, заикание, коверкание, дефект
 * речи. Манера — словарь, интонация, привычные фразы и отношение к людям, а не
 * орфография.
 */
const BROKEN_MANNER = new RegExp([
  '(?:внутр\\p{L}*|в\\s+середин\\p{L}*|посредине|посреди)\\s+(?:\\p{L}+\\s+)?(?:слов|слог|букв)',
  'вставля\\p{L}*\\s+(?:\\p{L}+\\s+){0,3}(?:слог|звук|букв|слов\\p{L}*\\s+внутр)',
  'заика\\p{L}*|заикан\\p{L}*|шепеляв\\p{L}*|картав\\p{L}*|коверка\\p{L}*',
  'искаж\\p{L}*\\s+(?:\\p{L}+\\s+)?(?:слов|букв|орфограф|написан|речь)',
  '(?:повторя|растягива|тянет|удлиня)\\p{L}*\\s+(?:\\p{L}+\\s+){0,2}(?:слог|букв|звук)',
  'ломает\\s+(?:\\p{L}+\\s+)?(?:слов|орфограф)',
  'пишет\\s+с\\s+ошибк',
].join('|'), 'iu');

/** Манера, которая ломает написание слов (`BROKEN_MANNER`). */
export function brokenManner(manner) {
  return BROKEN_MANNER.test(String(manner == null ? '' : manner));
}

/**
 * Проверка каста.
 *
 * - **Разнообразие**: типаж, интерес и манера не повторяют те же поля
 *   предыдущих (по порядку списка; виноват всегда тот, кто позже, — раньше
 *   стоящий остаётся).
 * - **Ник**: не совпадает со стоп-листом (героиня, персонаж карточки,
 *   заведение — `stop`), с сокурсниками из «Людей» (`classmates`: имена или
 *   объекты с `name`) и с ником раньше стоящего статиста.
 *
 * @param {Object[]} members каст
 * @param {{stop?: Array|Object, classmates?: Array<string|{name: string}>}} [opts]
 * @returns {{problems: Array<{id: string, field: string, hard: boolean, with: string, text: string}>, redo: string[]}}
 *   `redo` — id нарушителей без повторов, в порядке списка; `hard` — нарушение,
 *   с которым статиста оставить нельзя (ник), а не просто похожесть
 */
export function checkDiversity(members, opts = {}) {
  const list = normalizeCastList(members);
  const folks = (Array.isArray(opts.classmates) ? opts.classmates : [])
    .map((c) => (typeof c === 'string' ? c : c && c.name)).filter(Boolean);
  const folk = folks.length ? stopList({ char: folks }) : [];
  const problems = [];
  const add = (m, field, hard, other, text) => problems.push({ id: m.id, field, hard, with: other, text });

  list.forEach((m, i) => {
    const hit = stopHit(m.nick, opts.stop);
    if (hit) {
      add(m, 'nick', true, '', hit.kind === 'user' ? `ник «${m.nick}» — имя героини` : `ник «${m.nick}» совпадает с «${hit.name}»`);
    } else if (stopHit(m.nick, folk)) {
      add(m, 'nick', true, '', `ник «${m.nick}» — имя живого сокурсника`);
    }
    const twin = list.slice(0, i).find((o) => normName(o.nick) === normName(m.nick));
    if (twin) add(m, 'nick', true, twin.id, `ник «${m.nick}» уже есть у «${twin.nick}»`);
    if (brokenManner(m.manner)) add(m, 'manner', false, '', `манера речи «${m.manner}» искажает написание слов`);
    for (const field of DIVERSE_FIELDS) {
      if (!m[field]) continue;
      const other = list.slice(0, i).find((o) => o[field] && similar(o[field], m[field]));
      if (other) add(m, field, false, other.id, `${FIELD_WORD[field]} «${m[field]}» повторяет «${other[field]}» (${other.nick})`);
    }
  });
  return { problems, redo: [...new Set(problems.map((p) => p.id))] };
}

// --- союзники и соперники -----------------------------------------------------------

/**
 * Расставить союзников и соперников там, где их нет или они битые. Модель
 * могла не дать их вовсе, дать себя самого или ушедшего; код дополняет, а не
 * переписывает: что стоит правильно — остаётся. Расстановка детерминирована:
 * союзник — следующий по списку (лучше взаимный), соперник — через полкруга.
 * Союзник и соперник — разные люди.
 *
 * @returns {Object[]} новый каст
 */
export function assignRelations(members) {
  const list = normalizeCastList(members).map((m) => ({ ...m }));
  const n = list.length;
  if (n < 2) return list.map((m) => ({ ...m, ally: '', rival: '' }));
  const byId = new Map(list.map((m) => [m.id, m]));
  const around = (i, from) => Array.from({ length: n - 1 }, (_, k) => list[(i + from + k) % n]).filter((m) => m !== list[i]);

  list.forEach((m, i) => {
    if (m.ally) return;
    const pick = around(i, 1).find((c) => c.id !== m.rival && (!c.ally || c.ally === m.id))
      || around(i, 1).find((c) => c.id !== m.rival);
    if (!pick) return;
    m.ally = pick.id;
    if (!pick.ally && pick.rival !== m.id) pick.ally = m.id;
  });
  list.forEach((m, i) => {
    if (m.rival) return;
    const pick = around(i, Math.floor(n / 2)).find((c) => c.id !== m.ally && (!c.rival || c.rival === m.id))
      || around(i, Math.floor(n / 2)).find((c) => c.id !== m.ally);
    if (!pick) return;
    m.rival = pick.id;
    if (!pick.rival && pick.ally !== m.id) pick.rival = m.id;
  });
  // Страховка: связь на несуществующего — наружу не уходит.
  return normalizeCastList(list.map((m) => ({
    ...m, ally: byId.has(m.ally) ? m.ally : '', rival: byId.has(m.rival) ? m.rival : '',
  })));
}

// --- мир -----------------------------------------------------------------------------

/**
 * Реалии заведения для промпта: как оно называется, чему там учатся, какие
 * праздники и события. Каст «по реалиям мира» берёт их отсюда, а не из головы
 * модели: в космической академии нет чирлидерш, в секте — футбола.
 *
 * @returns {string[]} строки вида «предметы: …»
 */
export function worldRealities(state, preset) {
  const p = preset && typeof preset === 'object' ? preset : {};
  const survey = (state && state.survey) || {};
  const vocab = p.vocab || {};
  const out = [];
  const place = [p.displayName, str(survey.institution), str(survey.faculty)].filter(Boolean);
  if (place.length) out.push(`заведение: ${[...new Set(place)].join(', ')}`);
  const where = [str(survey.country), str(survey.era)].filter(Boolean);
  if (where.length) out.push(`где и когда: ${where.join(', ')}`);
  const words = [['teacher', 'преподаватель'], ['period', 'занятие'], ['term', 'семестр'], ['examPeriod', 'сессия']]
    .map(([k, w]) => (vocab[k] ? `${w} — «${vocab[k]}»` : '')).filter(Boolean);
  if (words.length) out.push(`здесь это называется так: ${words.join('; ')}`);
  const subjects = ((state && state.subjects) || []).map((s) => s && s.name).filter(Boolean).slice(0, 6);
  if (subjects.length) out.push(`предметы: ${subjects.join(', ')}`);
  const days = [...holidaysOf(p), ...eventsOf(state)].map((h) => h.name).filter(Boolean).slice(0, 6);
  if (days.length) out.push(`праздники и события: ${[...new Set(days)].join(', ')}`);
  return out;
}

/**
 * Праздники и события календаря пресета (и свои события чата) — полный список
 * названий. Каст и сюжетики ссылаются только на них: модель без списка
 * выдумывала «Ночь фонарей» там, где её нет (баг 57).
 *
 * @returns {string[]}
 */
export function calendarNames(state, preset) {
  const out = [];
  for (const h of [...holidaysOf(preset), ...eventsOf(state)]) {
    const name = h && str(h.name);
    if (name && !out.includes(name)) out.push(name);
  }
  return out.slice(0, 20);
}

// --- промпты --------------------------------------------------------------------------

const SYSTEM = 'Ты придумываешь постоянных второстепенных учеников для школьного чата — молвы — в ролевой игре.'
  + ' Это массовка: у каждого свои дела, героиню они знают понаслышке.'
  + ' Отвечай только строками списка, без пояснений, вступлений и markdown.';

/** Что мир и пресет говорят модели: общий кусок обоих промптов. */
function worldBlock(input) {
  const i = input || {};
  const lines = [];
  const real = (Array.isArray(i.realities) ? i.realities : []).filter(Boolean);
  if (real.length) lines.push('Реалии этого заведения (опирайся на них, а не на общие школьные штампы):', ...real.map((r) => `— ${r}`));
  if (Array.isArray(i.calendar)) {
    lines.push(i.calendar.length
      ? `Праздники и события этого мира — только эти: ${i.calendar.join('; ')}. Ссылайся лишь на них; других праздников, балов и турниров не выдумывай.`
      : 'В календаре этого мира нет ни праздников, ни событий: не упоминай никаких и не выдумывай.');
  }
  const types = i.types && i.types.length ? i.types : feedExtras(i.preset);
  const manners = i.manners && i.manners.length ? i.manners : feedManners(i.preset);
  lines.push(`Типажи этого мира (бери оттуда или близкие по духу): ${types.join('; ')}.`);
  lines.push('Манеры речи — это поведение в тексте, а не ярлык: словарь, интонация, привычные фразы. Слова при этом пишутся правильно (без вставок внутрь слов и заикания). Присказка, если она есть, одна и не в каждой реплике: манера живёт в интонации и словаре. Образцы этого мира:', ...manners.map((m) => `— ${m}`));
  lines.push('Только реалии этого мира и заведения: никаких заклинаний, названий и терминов из чужих произведений (книг, фильмов, игр) — ни «Люмоса», ни «Обливиэйта», ни «Экспеллиармуса».');
  return lines;
}

/** Чьи имена занимать нельзя: героиня, персонаж карточки, живые сокурсники. */
function avoidBlock(input) {
  const i = input || {};
  const names = [...new Set([i.heroine, ...(i.mainNames || []), ...(i.classmates || [])]
    .map((n) => (typeof n === 'string' ? n : n && n.name)).map(str).filter(Boolean))];
  return names.length
    ? [`Эти имена и их части в никах не использовать: ${names.join(', ')}.`]
    : [];
}

/**
 * Промпт генерации каста.
 *
 * @param {Object} input
 * @param {Object} input.preset пресет (типажи, манеры, примеры ников — из `feed`)
 * @param {string[]} [input.realities] реалии заведения (`worldRealities`)
 * @param {string} [input.heroine] имя героини
 * @param {string[]} [input.mainNames] персонаж(и) карточки
 * @param {Array<string|{name: string}>} [input.classmates] живые сокурсники
 * @param {number} [input.count] сколько статистов, по умолчанию и не больше `CAST_MAX`
 * @returns {{system: string, user: string}}
 */
export function buildCastPrompt(input) {
  const i = input || {};
  const count = Math.max(2, Math.min(CAST_MAX, Math.trunc(Number(i.count)) || CAST_MAX));
  const nicks = feedNickExamples(i.preset);
  const user = [
    `Придумай ${count} статистов — учеников этого мира, которые пишут в общий чат.`,
    '',
    ...worldBlock(i),
    '',
    ...avoidBlock(i),
    '',
    'Каждый статист — одна строка, поля через « | »:',
    'ник | типаж | интерес | цель | манера речи | ник союзника | ник соперника',
    '— ник: как назвался бы ученик этого мира в чате, это не имя и не фамилия.'
      + ` Образцы: ${nicks.map((n) => n.replace(/\s*\(.*\)$/, '')).join('; ')};`,
    '— типаж: кто он в этом мире (одно-два слова);',
    '— интерес: чем живёт кроме героини и её дел, конкретно и по реалиям мира;',
    '— цель: чего хочет добиться в ближайшие недели, одной фразой;',
    '— манера речи: как именно пишет, поведением («хвалит и тут же поддевает»), а не словом («язвительный»). Манера — это словарь, интонация, привычные фразы и отношение к людям;'
      + ' никаких вставок внутрь слов, заикания, повторов слогов и искажённой орфографии: слова у всех пишутся правильно;',
    '— союзник и соперник: ники других статистов из этого же списка, не себя; у каждого один союзник и один соперник.',
    '',
    `У всех ${count} разные типажи, интересы и манеры речи: ни одного повтора и ни одного близнеца.`,
    'Не придумывай событий и праздников вне календаря, не называй имён героини и сокурсников, не добавляй людей сверх списка.',
    `Выведи ровно ${count} строк, затем строку «${END_MARK}».`,
  ].join('\n');
  return { system: SYSTEM, user };
}

/**
 * Промпт замены одного статиста: остальные известны, прежний не прошёл проверку.
 *
 * @param {Object} input то же, что у `buildCastPrompt`
 * @param {Object[]} cast весь каст
 * @param {string} id кого заменить
 * @param {string[]} [reasons] что не так с прежним (`checkDiversity().problems[].text`)
 * @returns {{system: string, user: string}}
 */
export function buildReplacePrompt(input, cast, id, reasons = []) {
  const list = normalizeCastList(cast);
  const old = list.find((m) => m.id === id);
  const others = list.filter((m) => m.id !== id);
  const user = [
    'В молве уже есть статисты. Один не подошёл — замени только его, не повторяя остальных.',
    '',
    ...worldBlock(input),
    '',
    ...avoidBlock(input),
    '',
    'Остальные (их типажи, интересы и манеры брать нельзя):',
    ...others.map((m) => `— ${m.nick} | ${m.type} | ${m.interest} | ${m.manner}`),
    '',
    old ? `Не подошёл: «${old.nick}» — ${reasons.length ? reasons.join('; ') : 'повторяет остальных'}.` : 'Нужен ещё один статист.',
    'Выведи одну строку: ник | типаж | интерес | цель | манера речи',
    `Затем строку «${END_MARK}».`,
  ].join('\n');
  return { system: SYSTEM, user };
}

// --- разбор ответа ---------------------------------------------------------------------

/** Строка без маркера списка: «1. », «- », «* », «• ». */
const BULLET = /^\s*(?:[-–—*•]|\d+[.)])\s*/;

/**
 * Разобрать ответ модели в каст. Устойчив к обрыву: строка без пяти полей
 * отбрасывается; если «КОНЕЦ» нет (или ответ помечен оборванным), последняя
 * строка принимается только целиком — со всеми семью полями.
 *
 * Союзник и соперник пишутся никами; здесь они переводятся в id. Что не
 * нашлось — пусто (расставит `assignRelations`). Повторный ник — вторая
 * строка отбрасывается.
 *
 * @param {string} text
 * @param {{truncated?: boolean, max?: number}} [opts]
 * @returns {{members: Object[], rejected: string[], complete: boolean}}
 */
export function parseCastResponse(text, opts = {}) {
  // Чужие HTML-комментарии (`<!-- NI t=… | Имя: … -->` соседнего расширения,
  // в том числе оборванные) режутся до разбора: в них есть « | », и они
  // сошли бы за строки статистов.
  const raw = String(text == null ? '' : text).replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/\r/g, '');
  const complete = new RegExp(`^[\\s#*=>_-]*${END_MARK}(?![\\p{L}])`, 'imu').test(raw) && opts.truncated !== true;
  const max = Math.max(1, Math.min(CAST_MAX, Math.trunc(Number(opts.max)) || CAST_MAX));
  const rejected = [];
  const rows = [];
  for (const line of raw.split('\n')) {
    const body = line.replace(BULLET, '').trim().replace(/^\|+|\|+$/g, '');
    if (!body || !body.includes('|')) continue;
    const f = body.split('|').map((x) => x.trim());
    if (textKey(f[0]) === 'ник' && /типаж/i.test(f[1] || '')) continue; // шапка формата
    rows.push(f);
  }
  const whole = [];
  rows.forEach((f, i) => {
    const last = i === rows.length - 1;
    if (f.length < 5 || !f[0]) rejected.push(`строка ${i + 1}: меньше пяти полей`);
    else if (last && !complete && f.length < 7) rejected.push(`строка ${i + 1}: ответ оборван`);
    else whole.push(f);
  });

  const members = [];
  const names = new Map();
  for (const f of whole) {
    if (members.length >= max) {
      rejected.push(`«${f[0]}»: сверх ${max}`);
      continue;
    }
    const nick = cleanNick(f[0]);
    if (!nick) {
      rejected.push(`«${f[0]}»: ник не годится`);
      continue;
    }
    if (names.has(normName(nick))) {
      rejected.push(`«${nick}»: повторный ник`);
      continue;
    }
    const id = `cast${members.length + 1}`;
    names.set(normName(nick), id);
    members.push({
      id, nick, type: f[1], interest: f[2], goal: f[3], manner: f[4], allyNick: f[5] || '', rivalNick: f[6] || '',
    });
  }
  const resolved = members.map(({ allyNick, rivalNick, ...m }) => ({
    ...m,
    ally: names.get(normName(allyNick.replace(/^[~@\s]+/, ''))) || '',
    rival: names.get(normName(rivalNick.replace(/^[~@\s]+/, ''))) || '',
  }));
  return { members: normalizeCastList(resolved), rejected, complete };
}

// --- сборка ----------------------------------------------------------------------------

/**
 * Собрать каст целиком: один запрос на всех, затем по запросу на каждого
 * нарушителя разнообразия (не больше `FIX_ATTEMPTS` за сборку). Ядро о сети не
 * знает — запросы делает `ask(prompt) → {ok, text, truncated} | {ok: false,
 * message}`.
 *
 * После замен всё ещё нарушающие по нику (стоп-лист, сокурсник, двойник) — не
 * остаются: статист с чужим именем хуже, чем каст из семи. Похожесть
 * типажей и манер остаётся с пометкой в `warnings`: пусть лучше похожие, чем
 * ни одного, а человек увидит и поправит руками.
 *
 * @param {Object} input вход `buildCastPrompt` + `stop` (стоп-лист) для проверки
 * @param {(prompt: {system: string, user: string}) => Promise<Object>} ask
 * @returns {Promise<{ok: true, members: Object[], warnings: string[], calls: number}
 *   | {ok: false, error: string, code: string, raw?: string, calls: number}>}
 */
export async function assembleCast(input, ask) {
  const i = input || {};
  const check = { stop: i.stop, classmates: i.classmates };
  let calls = 0;

  const first = await ask(buildCastPrompt(i));
  calls += 1;
  if (!first.ok) return { ok: false, code: first.code || 'api', error: first.message || 'запрос не удался', calls };
  const parsed = parseCastResponse(first.text, { truncated: first.truncated === true });
  if (parsed.members.length < 2) {
    return {
      ok: false,
      code: first.truncated ? 'truncated' : 'parse',
      error: first.truncated
        ? 'Каст пришёл наполовину: модель оборвалась. Попробуйте ещё раз или выберите модель посвободнее.'
        : 'Не удалось собрать статистов из ответа модели.',
      raw: first.text,
      calls,
    };
  }
  let members = assignRelations(parsed.members);
  const warnings = [];
  if (members.length < Math.min(CAST_MAX, Math.trunc(Number(i.count)) || CAST_MAX)) {
    warnings.push(`Собрано ${members.length} из ${CAST_MAX}: остальных модель не дала.`);
  }

  for (let fix = 0; fix < FIX_ATTEMPTS; fix += 1) {
    const { problems, redo } = checkDiversity(members, check);
    if (!redo.length) break;
    // Сперва те, у кого нельзя оставить ник; потом по порядку списка.
    const target = redo.find((id) => problems.some((p) => p.id === id && p.hard)) || redo[0];
    const reasons = problems.filter((p) => p.id === target).map((p) => p.text);
    const res = await ask(buildReplacePrompt(i, members, target, reasons));
    calls += 1;
    if (!res.ok) {
      warnings.push(`Заменить «${members.find((m) => m.id === target).nick}» не вышло: ${res.message || 'запрос не удался'}.`);
      break;
    }
    const one = parseCastResponse(res.text, { truncated: res.truncated === true, max: 1 });
    const fresh = one.members[0];
    if (!fresh) continue;
    const old = members.find((m) => m.id === target);
    // Связи прежнего остаются: на статиста ссылаются по id, а не по нику.
    members = normalizeCastList(members.map((m) => (m.id === target
      ? { ...fresh, id: target, ally: old.ally, rival: old.rival } : m)));
  }

  // Манера, ломающая написание, после замен всё ещё стоит — стирается: пустая манера молве не мешает.
  const cleaned = members.filter((m) => brokenManner(m.manner));
  if (cleaned.length) {
    members = members.map((m) => (brokenManner(m.manner) ? { ...m, manner: '' } : m));
    for (const m of cleaned) warnings.push(`У «${m.nick}» убрана манера речи, что искажала слова — впишите свою руками.`);
  }

  const left = checkDiversity(members, check);
  const bad = new Set(left.problems.filter((p) => p.hard).map((p) => p.id));
  if (bad.size) {
    for (const m of members.filter((x) => bad.has(x.id))) warnings.push(`Убран «${m.nick}»: ${left.problems.find((p) => p.id === m.id && p.hard).text}.`);
    members = assignRelations(members.filter((m) => !bad.has(m.id)));
  }
  for (const p of left.problems.filter((x) => !x.hard && !bad.has(x.id))) {
    const m = members.find((x) => x.id === p.id);
    if (m) warnings.push(`«${m.nick}»: ${p.text}.`);
  }
  if (members.length < 2) {
    return { ok: false, code: 'empty', error: 'После проверки в касте осталось меньше двух статистов.', raw: first.text, calls };
  }
  return { ok: true, members, warnings, calls };
}

// --- авторы молвы -----------------------------------------------------------------------

/**
 * Все, кто может писать в молву: каст (под ником) и сокурсники из «Людей» с
 * желанием или проблемой (под своими именами). Без героини, персонажа карточки
 * и всего, что попало в стоп-лист: молву пишут про них, а не они.
 *
 * @param {Object} state
 * @param {{stop?: Array|Object}} [opts] стоп-лист (`stopList`)
 * @returns {Array<{id: string, kind: 'cast'|'classmate', name: string, masked: boolean,
 *   type?: string, interest?: string, goal?: string, manner?: string, desire?: string, problem?: string}>}
 */
export function rumorAuthors(state, opts = {}) {
  const out = [];
  for (const m of castOf(state)) {
    if (stopHit(m.nick, opts.stop)) continue;
    out.push({ id: m.id, kind: 'cast', name: m.nick, masked: true, type: m.type, interest: m.interest, goal: m.goal, manner: m.manner });
  }
  for (const c of Array.isArray(state && state.classmates) ? state.classmates : []) {
    if (!c || !c.id || c.id === HEROINE || !(c.desire || c.problem)) continue;
    if (stopHit(c.name, opts.stop)) continue;
    out.push({ id: c.id, kind: 'classmate', name: c.name, masked: false, desire: c.desire || '', problem: c.problem || '' });
  }
  return out;
}

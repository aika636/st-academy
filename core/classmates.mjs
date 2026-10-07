// core/classmates — курс героини: однокурсники как данные (раздел «Сейчас», шаг 2).
//
// Рядом с преподавателями — отдельный список `state.classmates`. У преподавателя
// есть предмет, должность и «любит»; у однокурсника — **желание, одна важная
// связь и одна текущая проблема** (решение 3 от 06.10, `nabrosok-odnokursniki.md`
// раздел 1). Из них рождаются помощь, соперничество, ложь и примирение; ярлык
// «завистница» давал бы одну реакцию на всё.
//
//   { id: 'sokolova', name: 'Вера Соколова',
//     desire: 'попасть в тройку лучших на курсе',
//     tie: { to: 'petrova-s', what: 'делит с ней комнату и прикрывает прогулы' },
//     problem: 'висит долг по физике, а мать ждёт красный диплом',
//     club: 'театральный кружок',
//     relation: -2,
//     seed: 'завистница',
//     source: 'manual',
//     locked: true }
//
// - `relation` — отношение к героине. Та же шкала пресета (`relations.min`…
//   `relations.max`), та же антиинфляция и та же память «за что», что у
//   преподавателей: сдвигает его `relations.changeRelation` по id однокурсника.
//   Поле названо как у преподавателя, а не `attitude` из наброска: одна функция
//   `relationOf` на обоих, и журнал (`data.teacherId`) не заводит второго ключа.
// - `tie.to` — id другого однокурсника, id преподавателя или `@heroine`.
//   Ссылка не проверяется на целостность: преподавателя убирают в настройках, и
//   битая ссылка не должна делать состояние негодным — панель покажет «кто-то».
// - `club` — пока свободный текст; список кружков в пресете появится в шаге 5.
// - `seed` — роль из пресета (`classmates.seeds`), **только зерно генерации**:
//   на карточку и в промпт не идёт, в ядре ни одного слова роли.
// - `source` — откуда человек: руками, из лорбука, карточки, генерации, сцены.
// - `locked` — человек правил руками, перегенерация (шаг 5) его не трогает.
//
// Кандидаты (`state.classmateCandidates`) — те, кого кто-то предложил, но
// человек ещё не подтвердил: имя из сцены (`new=` секретаря, шаг 3), из
// лорбука и карточки (шаг 5). В курс без галочки никто не попадает.
//
// **Функции правят переданное состояние на месте**, как `pushPending`: их зовут
// на рабочей копии (`cloneState` вызывающего). Так договорено с секретарём
// (шаг 3): `addCandidate(state, …)` возвращает id, а не новое состояние.
//
// Модуль чистый: ни таверны, ни браузера. Имена героини и карточки приходят
// готовым стоп-листом (`opts.stop`, см. `core/stop-names.mjs`).

import { HARD_STOPS, STOP_CHAR, normName, stopHit } from './stop-names.mjs';
import { slugify } from './plan-gen.mjs';

/** Связь «с героиней»: так пишется `tie.to`, когда главный человек — она. */
export const HEROINE = '@heroine';

/** Откуда приходят люди. */
export const SOURCES = ['manual', 'lorebook', 'card', 'generated', 'scene'];

/**
 * Потолки длины полей. Это подписи в карточке и одна фраза в лорбуке, а не
 * биография: длинное режется, запись лорбука остаётся короткой.
 */
export const CLASSMATE_TEXT_MAX = { name: 80, desire: 120, problem: 160, club: 60, seed: 40, tie: 120 };

/** Потолок длины id однокурсника: тот же, что у id преподавателя в метке. */
export const CLASSMATE_ID_MAX = 24;

/** Курс по умолчанию (ответ владелицы 07.10). */
export const DEFAULT_SIZE = 6;

/** Рамки размера курса в пресете. Больше дюжины модель не удержит. */
export const SIZE_BOUNDS = [1, 12];

/** Сколько людей держит курс с ручными добавлениями сверх размера. */
export const CLASSMATES_MAX = 20;

/** Сколько кандидатов ждёт галочки одновременно; старые вытесняются. */
export const CANDIDATES_MAX = 12;

/** Зёрна генерации в пресете: сколько и какой длины. */
export const SEEDS_MAX = 12;

// --- пресет ---------------------------------------------------------------------

const presetBlock = (preset) => (preset && preset.classmates && typeof preset.classmates === 'object'
  ? preset.classmates : {});

/** Размер курса из пресета (`classmates.size`), в рамках `SIZE_BOUNDS`. */
export function classmateSize(preset) {
  const v = Number(presetBlock(preset).size);
  if (!Number.isInteger(v)) return DEFAULT_SIZE;
  return Math.min(SIZE_BOUNDS[1], Math.max(SIZE_BOUNDS[0], v));
}

/** Роли-зёрна из пресета (`classmates.seeds`): строки, без пустых и повторов. */
export function classmateSeeds(preset) {
  const raw = presetBlock(preset).seeds;
  const out = [];
  for (const s of Array.isArray(raw) ? raw : []) {
    const v = oneLine(s, CLASSMATE_TEXT_MAX.seed);
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, SEEDS_MAX);
}

/**
 * Ярлыки отношения однокурсника к героине. Шкала та же, что у преподавателей,
 * а слова свои: «любимица» и «ставит в пример» — про учителя, однокурсница
 * бывает «подругой» и «терпеть не может». Пресет без своих слов — слова
 * преподавательской шкалы.
 */
export function classmateLabels(preset) {
  const own = presetBlock(preset).labels;
  if (Array.isArray(own) && own.length && own.every((l) => l && typeof l.upTo === 'number' && typeof l.label === 'string')) {
    return own;
  }
  return (preset && preset.relations && preset.relations.labels) || [];
}

/** Отношение нового однокурсника: `classmates.start`, иначе начало шкалы преподавателей. */
export function classmateStart(preset) {
  const own = Number(presetBlock(preset).start);
  if (Number.isFinite(own)) return own;
  const t = Number(preset && preset.relations && preset.relations.start);
  return Number.isFinite(t) ? t : 0;
}

// --- нормализация -----------------------------------------------------------------

/** Строка в одну строку до `max` символов; не-строка — пусто. */
function oneLine(raw, max) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  return String(raw).replace(/\s+/g, ' ').trim().slice(0, max).trim();
}

/**
 * Связь к форме `{to, what}` или `null`. `to` — id или `@heroine`; пустое
 * `what` без адресата — связи нет. Адресат без слов — связь есть, но сказать
 * про неё нечего: такая тоже держится, панель покажет одно имя.
 */
export function normalizeTie(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const to = oneLine(raw.to, 64);
  const what = oneLine(raw.what, CLASSMATE_TEXT_MAX.tie);
  if (!to && !what) return null;
  return { to, what };
}

/**
 * Однокурсник к форме `Classmate`. Без имени — `null`: человека без имени в
 * сцене не позовут, и лорбуку не за что зацепиться. Отношение — из пресета,
 * если не задано. Пустые необязательные поля — без ключей: форма короткая.
 */
export function normalizeClassmate(raw, preset) {
  if (!raw || typeof raw !== 'object') return null;
  const name = oneLine(raw.name, CLASSMATE_TEXT_MAX.name);
  if (!name) return null;
  const id = oneLine(raw.id, CLASSMATE_ID_MAX) || slugify(name, { maxLength: CLASSMATE_ID_MAX });
  const rel = Number(raw.relation);
  const out = {
    id,
    name,
    relation: Number.isFinite(rel) ? rel : classmateStart(preset),
    source: SOURCES.includes(raw.source) ? raw.source : 'manual',
    locked: Boolean(raw.locked),
  };
  for (const key of ['desire', 'problem', 'club', 'seed']) {
    const v = oneLine(raw[key], CLASSMATE_TEXT_MAX[key]);
    if (v) out[key] = v;
  }
  const tie = normalizeTie(raw.tie);
  if (tie) out.tie = tie;
  return out;
}

/**
 * Список однокурсников: нормализован, без безымянных и повторов id.
 *
 * `opts.taken` — id преподавателей. Однокурсник с тем же id (преподавателя
 * завели в настройках позже, и генерация дала ему тот же id) получает новый:
 * у метки `rel=` одно пространство id, и двоих под одним она не различила бы.
 */
export function normalizeClassmates(list, preset, opts = {}) {
  const out = [];
  const taken = new Set((opts.taken || []).map(String));
  for (const raw of Array.isArray(list) ? list : []) {
    const c = normalizeClassmate(raw, preset);
    if (!c || out.some((x) => x.id === c.id)) continue;
    if (taken.has(c.id)) c.id = classmateIdOf(c.name, [...taken, ...out.map((x) => x.id)]);
    out.push(c);
    if (out.length >= CLASSMATES_MAX) break;
  }
  return out;
}

/** Кандидат: то же, что однокурсник, но без отношения и замка — их даёт подтверждение. */
function normalizeCandidate(raw, preset) {
  const c = normalizeClassmate(raw, preset);
  if (!c) return null;
  const { relation, locked, ...rest } = c;
  return { ...rest, source: SOURCES.includes(raw.source) ? raw.source : 'scene' };
}

/** Список кандидатов к форме. */
export function normalizeCandidates(list, preset) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const c = normalizeCandidate(raw, preset);
    if (!c || out.some((x) => x.id === c.id)) continue;
    out.push(c);
  }
  return out.slice(-CANDIDATES_MAX);
}

/**
 * Претензии к курсу для `validateState`: форма, потолки, повторы id и
 * совпадение id с преподавателем (иначе `rel=` не знал бы, кого двигать).
 */
export function classmateErrors(state) {
  const errors = [];
  if (state.classmates === undefined) return errors;
  if (!Array.isArray(state.classmates)) return ['classmates не массив'];
  const teachers = new Set((Array.isArray(state.teachers) ? state.teachers : []).map((t) => t && t.id));
  const seen = new Set();
  for (const c of state.classmates) {
    if (!c || typeof c !== 'object' || !c.id) { errors.push('однокурсник без id'); continue; }
    if (seen.has(c.id)) errors.push(`однокурсник ${c.id} повторяется`);
    seen.add(c.id);
    if (teachers.has(c.id)) errors.push(`однокурсник ${c.id}: тот же id у преподавателя`);
    if (typeof c.name !== 'string' || !c.name.trim() || c.name.length > CLASSMATE_TEXT_MAX.name) {
      errors.push(`однокурсник ${c.id}: имя — не строка до ${CLASSMATE_TEXT_MAX.name} символов`);
    }
    if (typeof c.relation !== 'number' || !Number.isFinite(c.relation)) errors.push(`однокурсник ${c.id}: отношение не число`);
    for (const key of ['desire', 'problem', 'club', 'seed']) {
      if (c[key] === undefined) continue;
      if (typeof c[key] !== 'string' || !c[key].trim() || c[key].length > CLASSMATE_TEXT_MAX[key]) {
        errors.push(`однокурсник ${c.id}: поле ${key} — не строка до ${CLASSMATE_TEXT_MAX[key]} символов`);
      }
    }
    if (c.tie !== undefined && (!c.tie || typeof c.tie !== 'object'
      || typeof c.tie.what !== 'string' || c.tie.what.length > CLASSMATE_TEXT_MAX.tie)) {
      errors.push(`однокурсник ${c.id}: связь — не {to, what}`);
    }
  }
  if (state.classmates.length > CLASSMATES_MAX) errors.push(`однокурсников ${state.classmates.length}, потолок ${CLASSMATES_MAX}`);
  if (state.classmateCandidates !== undefined && !Array.isArray(state.classmateCandidates)) {
    errors.push('кандидаты в курс — не список');
  }
  return errors;
}

// --- имена ----------------------------------------------------------------------------

/**
 * Один ли это человек: «Петрова», «Анна Петрова» и «А. П.» — да.
 *
 * Слова короткого имени должны найтись в длинном, каждое своё: целиком (от трёх
 * букв, как у стоп-листа) или инициалом — одна-две буквы, с которых слово
 * начинается. Имя из одних инициалов годится только из двух и больше: одинокое
 * «А.» совпало бы с половиной курса. Регистр, «ё» и знаки — как у
 * `stop-names.normName`.
 */
export function sameName(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // В обе стороны: «В. С.» и «Вера Соколова» — слов поровну, и короче
  // здесь не то имя, в котором меньше слов, а то, в котором инициалы.
  return covers(x.split(' '), y.split(' ')) || covers(y.split(' '), x.split(' '));
}

/** Каждое слово `short` нашлось в `long` своим словом — целиком или инициалом. */
function covers(short, long) {
  if (short.length > long.length) return false;
  if (short.every((t) => t.length < 3) && short.length < 2) return false;
  const used = new Set();
  for (const t of short) {
    const i = long.findIndex((w, k) => !used.has(k) && (t.length >= 3 ? w === t : w.startsWith(t)));
    if (i < 0) return false;
    used.add(i);
  }
  return true;
}

/**
 * Однокурсник по id или имени. Сначала точный id, потом точное имя, потом
 * `sameName` — и только если он указывает ровно на одного: «Петрова» при двух
 * Петровых на курсе — никто, а не первая попавшаяся.
 */
export function findClassmate(state, idOrName) {
  const list = (state && Array.isArray(state.classmates)) ? state.classmates : [];
  return findIn(list, idOrName);
}

function findIn(list, idOrName) {
  const raw = String(idOrName == null ? '' : idOrName).trim();
  if (!raw) return null;
  const byId = list.find((c) => c && c.id === raw);
  if (byId) return byId;
  const key = normName(raw);
  const exact = list.filter((c) => c && normName(c.name) === key);
  if (exact.length === 1) return exact[0];
  const near = list.filter((c) => c && sameName(c.name, raw));
  return near.length === 1 ? near[0] : null;
}

/** Свободный id из имени: латиница, как у преподавателей; занятый — с номером. */
export function classmateIdOf(name, taken = []) {
  const busy = new Set([...taken].map(String));
  const base = slugify(name, { maxLength: CLASSMATE_ID_MAX });
  if (!busy.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const tail = `-${n}`;
    const id = `${base.slice(0, CLASSMATE_ID_MAX - tail.length)}${tail}`;
    if (!busy.has(id)) return id;
  }
  return `${base}-x`;
}

/** Все занятые id людей: однокурсники, кандидаты и преподаватели — у метки одно пространство. */
function takenIds(state) {
  return [
    ...(state.classmates || []),
    ...(state.classmateCandidates || []),
    ...(state.teachers || []),
  ].map((x) => x && x.id).filter(Boolean);
}

/**
 * Почему имя нельзя взять в курс; `null` — можно.
 *
 * - героиня, заведение, служебное слово пресета — никогда (`HARD_STOPS`);
 * - карточка — для кандидата нельзя («Рассказчик» среди сокурсников — ровно та
 *   ошибка, ради которой стоп-лист), а руками — можно: чат «один на один с
 *   однокурсницей» — это и есть сцена про неё;
 * - преподаватель с тем же полным именем — нельзя: `rel=` не различил бы двоих;
 *   кандидату — и с частью имени того же преподавателя.
 */
function nameProblem(state, name, opts = {}) {
  const hit = opts.stop ? stopHit(name, opts.stop) : null;
  if (hit && (HARD_STOPS.includes(hit.kind) || (hit.kind === STOP_CHAR && !opts.manual))) {
    return { code: 'stop', error: `«${name}» — в стоп-листе (${hit.name})`, hit };
  }
  // Руками — только полное совпадение: дочь преподавательницы с той же
  // фамилией бывает. Кандидат — любое совпадение: «Петрова» из сцены скорее
  // всего и есть Петрова Анна Сергеевна.
  const key = normName(name);
  const teacher = (state.teachers || []).find((t) => t
    && (normName(t.name) === key || (!opts.manual && sameName(t.name, name))));
  if (teacher) return { code: 'teacher', error: `«${name}» — это преподаватель`, id: teacher.id };
  return null;
}

// --- операции -------------------------------------------------------------------------

/**
 * Добавить однокурсника. Правит `state` на месте.
 *
 * Тот же человек под другим именем («Петрова» при «Анне Петровой») не
 * удваивается: исход `known` с id уже существующего — вызывающий решит,
 * дописать ли ему поля через `updateClassmate`.
 *
 * @param {Object} state
 * @param {Object} raw поля однокурсника; `name` обязательно
 * @param {Object} preset
 * @param {Object} [opts]
 * @param {*} [opts.stop] стоп-лист (`stopList(...)` или его вход)
 * @returns {{ok: boolean, id?: string, code?: string, error?: string}}
 */
export function addClassmate(state, raw, preset, opts = {}) {
  if (!Array.isArray(state.classmates)) state.classmates = [];
  const name = oneLine(raw && raw.name, CLASSMATE_TEXT_MAX.name);
  if (!name) return { ok: false, code: 'empty', error: 'нет имени' };
  const source = SOURCES.includes(raw.source) ? raw.source : 'manual';
  const problem = nameProblem(state, name, { stop: opts.stop, manual: source === 'manual' });
  if (problem) return { ok: false, ...problem };
  const known = state.classmates.find((c) => sameName(c.name, name));
  if (known) return { ok: false, code: 'known', id: known.id, error: `«${name}» уже на курсе: ${known.name}` };
  if (state.classmates.length >= CLASSMATES_MAX) return { ok: false, code: 'full', error: `на курсе уже ${CLASSMATES_MAX} человек` };

  const id = classmateIdOf(name, takenIds(state));
  const c = normalizeClassmate({
    ...raw, id, name, source,
    // Руками добавленный — правленый руками: генерация его не перепишет.
    locked: raw.locked === undefined ? source === 'manual' : Boolean(raw.locked),
  }, preset);
  state.classmates.push(c);
  return { ok: true, id };
}

/**
 * Поправить однокурсника. Ключ, которого в `patch` нет, не трогается; пустая
 * строка убирает поле. Id не меняется никогда — на нём держатся запись
 * лорбука, журнал и чужие связи. Правка руками ставит `locked`.
 *
 * @returns {{ok: boolean, code?: string, error?: string}}
 */
export function updateClassmate(state, id, patch, preset, opts = {}) {
  const c = (state.classmates || []).find((x) => x.id === id);
  if (!c) return { ok: false, code: 'unknown', error: `однокурсника «${id}» нет` };
  const p = patch && typeof patch === 'object' ? patch : {};
  if ('name' in p) {
    const name = oneLine(p.name, CLASSMATE_TEXT_MAX.name);
    if (!name) return { ok: false, code: 'empty', error: 'нет имени' };
    const problem = nameProblem(state, name, { stop: opts.stop, manual: true });
    if (problem) return { ok: false, ...problem };
    const twin = state.classmates.find((x) => x.id !== id && normName(x.name) === normName(name));
    if (twin) return { ok: false, code: 'known', id: twin.id, error: `«${name}» уже на курсе` };
    c.name = name;
  }
  for (const key of ['desire', 'problem', 'club']) {
    if (!(key in p)) continue;
    const v = oneLine(p[key], CLASSMATE_TEXT_MAX[key]);
    if (v) c[key] = v;
    else delete c[key];
  }
  if ('tie' in p) {
    const tie = normalizeTie(p.tie);
    if (tie && tie.to === id) return { ok: false, code: 'self-tie', error: 'связь с самим собой' };
    if (tie) c.tie = tie;
    else delete c.tie;
  }
  c.locked = opts.locked === undefined ? true : Boolean(opts.locked);
  return { ok: true };
}

/**
 * Убрать однокурсника. Связи других людей на него уходят вместе с ним —
 * «делит комнату с …» без адресата читалось бы загадкой. Серия антиинфляции
 * по нему забывается; журнал остаётся — это летопись, а не карточка.
 *
 * @returns {{ok: boolean, removed?: Object}}
 */
export function removeClassmate(state, id) {
  const list = state.classmates || [];
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return { ok: false, code: 'unknown', error: `однокурсника «${id}» нет` };
  const [removed] = list.splice(i, 1);
  for (const c of list) if (c.tie && c.tie.to === id) delete c.tie;
  if (state.relStreak && typeof state.relStreak === 'object') delete state.relStreak[id];
  return { ok: true, removed };
}

// --- кандидаты ------------------------------------------------------------------------

/** Кандидаты в курс, старые первыми. */
export function listCandidates(state) {
  return (state && Array.isArray(state.classmateCandidates)) ? state.classmateCandidates.slice() : [];
}

/**
 * Предложить человека в курс (секретарь — `new=`, шаг 3; лорбук и карточка —
 * шаг 5). Правит `state` на месте и возвращает id кандидата либо `null`:
 *
 * - имя пустое или в стоп-листе (включая карточку) — `null`;
 * - человек уже на курсе или он преподаватель — `null`: кандидат не нужен;
 * - тот же человек уже ждёт галочки — id того кандидата, новые поля
 *   дописываются в пустые места, второй записи нет.
 *
 * @param {Object} state
 * @param {{name: string, source?: string, desire?, tie?, problem?, club?, seed?}} raw
 * @param {Object} [opts]
 * @param {*} [opts.stop] стоп-лист
 * @param {Object} [opts.preset]
 * @returns {?string}
 */
export function addCandidate(state, raw, opts = {}) {
  const name = oneLine(raw && raw.name, CLASSMATE_TEXT_MAX.name);
  if (!name) return null;
  if (nameProblem(state, name, { stop: opts.stop, manual: false })) return null;
  if ((state.classmates || []).some((c) => sameName(c.name, name))) return null;
  if (!Array.isArray(state.classmateCandidates)) state.classmateCandidates = [];
  const list = state.classmateCandidates;
  const fresh = normalizeCandidate({ ...raw, name, source: raw.source || 'scene' }, opts.preset);
  const twin = list.find((c) => sameName(c.name, name));
  if (twin) {
    // Полное имя лучше фамилии: «Анна Петрова» после «Петровой» уточняет её.
    if (normName(name).split(' ').length > normName(twin.name).split(' ').length) twin.name = name;
    for (const key of ['desire', 'problem', 'club', 'seed', 'tie']) {
      if (twin[key] === undefined && fresh[key] !== undefined) twin[key] = fresh[key];
    }
    return twin.id;
  }
  fresh.id = classmateIdOf(name, takenIds(state));
  list.push(fresh);
  if (list.length > CANDIDATES_MAX) list.splice(0, list.length - CANDIDATES_MAX);
  return fresh.id;
}

/**
 * Галочка человека: кандидат становится однокурсником. Правит `state` на
 * месте. Возвращает однокурсника или `null` (кандидата нет, курс полон, имя
 * за это время стало занятым). Кандидат уходит из списка в любом исходе,
 * кроме «нет такого»: держать отвергнутого ядром незачем.
 *
 * @param {Object} state
 * @param {string} id
 * @param {Object} [preset]
 * @param {Object} [opts] `{stop}`
 * @returns {?Object}
 */
export function confirmCandidate(state, id, preset, opts = {}) {
  const list = state.classmateCandidates || [];
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const [cand] = list.splice(i, 1);
  const { id: _drop, ...fields } = cand;
  const res = addClassmate(state, { ...fields, locked: false }, preset, { stop: opts.stop });
  if (!res.ok) return null;
  return state.classmates.find((c) => c.id === res.id) || null;
}

/** Снять галочку: кандидат уходит без следа. */
export function dropCandidate(state, id) {
  const list = state.classmateCandidates || [];
  const i = list.findIndex((c) => c.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}

// --- связи и метка ----------------------------------------------------------------------

/**
 * К кому ведёт связь: героиня, однокурсник, преподаватель или неизвестно кто
 * (адресата убрали). Имя — для панели и лорбука; у героини его нет, его
 * подставляет вызывающий своим словом.
 *
 * @returns {{kind: 'heroine'|'classmate'|'teacher'|'unknown'|'none', id: string, name: string}}
 */
export function tieTarget(state, to) {
  const id = String(to == null ? '' : to).trim();
  if (!id) return { kind: 'none', id: '', name: '' };
  if (id === HEROINE) return { kind: 'heroine', id, name: '' };
  const c = (state.classmates || []).find((x) => x.id === id);
  if (c) return { kind: 'classmate', id, name: c.name };
  const t = (state.teachers || []).find((x) => x.id === id);
  if (t) return { kind: 'teacher', id, name: t.name || t.id };
  return { kind: 'unknown', id, name: '' };
}

/**
 * Люди, чьё отношение может сдвинуть метка `rel=`: преподаватели, за ними
 * однокурсники. Разборщик метки ищет по этому списку id и имя; id у обоих
 * в одном пространстве (`classmateIdOf` обходит занятые преподавателями).
 */
export function markerPeople(state) {
  return [
    ...((state && state.teachers) || []),
    ...((state && state.classmates) || []).map((c) => ({ id: c.id, name: c.name })),
  ];
}

// --- состав вне времени хода ------------------------------------------------------------

/**
 * Состав курса из живого состояния — в снимок хода, от которого будут
 * пересчитывать (свайп, «Разобрать заново», правка, удаление сообщений).
 *
 * Человека добавляют, правят и убирают руками — это решение игрока, а не
 * событие ответа, и откат хода его отменять не должен. Раньше снимок «до
 * ответа» про такого человека не знал: разбор заново читал старый список
 * (секретарь его не видел), а пересчёт от снимка молча стирал его из курса.
 *
 * Переносится состав и слова о людях; отношение (`relation`) остаётся из
 * снимка — его двигает сам пересчитываемый ответ (`rel=`). Новый человек
 * приходит целиком: ответ, в котором его ещё не было, сдвинуть его не мог.
 * Кандидаты не трогаются — их кладёт и снимает разбор.
 *
 * @param {Object} live живое состояние
 * @param {Object} before снимок хода
 * @returns {Object} снимок с составом живого (копия) или он сам, если менять нечего
 */
export function carryRoster(live, before) {
  if (!before || typeof before !== 'object' || !live || !Array.isArray(live.classmates)) return before;
  const old = new Map((Array.isArray(before.classmates) ? before.classmates : []).filter(Boolean).map((c) => [c.id, c]));
  const roster = live.classmates.filter((c) => c && c.id).map((c) => {
    const was = old.get(c.id);
    return was ? { ...c, relation: was.relation } : { ...c };
  });
  const same = roster.length === old.size && roster.every((c) => {
    const was = old.get(c.id);
    return was && JSON.stringify(was) === JSON.stringify(c);
  });
  if (same) return before;
  return { ...before, classmates: roster };
}

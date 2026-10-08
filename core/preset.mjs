// core/preset — переносимые пресеты заведений (план 9.3.2).
//
// До этого модуля свой пресет значил «положить JSON в папку установки»: на
// телефоне и на хостинге папки нет, и заведение, придуманное человеком, жить
// могло только у того, кто умеет в файловую систему таверны. Теперь пресет —
// файл, который выгружается кнопкой, отдаётся другому человеку и загружается
// кнопкой же; хранится он в `extension_settings.academy.presets`.
//
// Пять решений, из которых вытекает файл.
//
// 1. **Пресет от чужого человека — недоверенные данные.** Он не должен ни
//    уронить расширение, ни протащить что-то огромное или исполняемое. Поэтому
//    дерево сначала проходит общий фильтр (`sanitizeTree`: глубина, число узлов,
//    длина строк и списков, опасные ключи, нечисловые числа), потом каждая
//    секция, от которой зависит ядро, сверяется со своей формой, и последним —
//    пробный прогон настоящим ядром (`probePreset`). Проверка формы ловит то,
//    что можно назвать словами; прогон — то, чего никто не предусмотрел.
//    «Исполняемое» в JSON — это не функции (их там не бывает), а строки,
//    которые кто-то дальше исполнит: HTML в справке слэш-команд (её таверна
//    рисует как разметку) и макросы `{{…}}` таверны в строке состояния. Оба
//    обезвреживаются в каждой строке (`cleanString`).
//
// 2. **Пресет человека ложится поверх встроенного, а не вместо умолчаний кода.**
//    Недостающие ключи словарей берутся из встроенного пресета-основы
//    (`basedOn`, иначе русский вуз). Это не только удобство для тех, кто пишет
//    пресет руками: пресет, сохранённый в настройках, — снимок, а расширение
//    растёт. Ключ, добавленный в встроенные пресеты завтра (как `exams.dc` и
//    `phrases.milestones` этой осенью), в старом пресете человека должен
//    появиться сам, иначе обновление расширения молча ломало бы чужие заведения.
//    Поэтому нормализация идёт при КАЖДОЙ загрузке, а не один раз при импорте.
//
// 3. **Слияние знает, где смешивать нельзя.** Словари (`vocab`, `ui`, `labels`,
//    `phrases`, `limits`) сливаются по ключам. Календарь — никогда: у него две
//    формы (три скаляра или список периодов), и `terms` основы, подмешанный к
//    скалярам пресета, молча перебил бы их (`time.mjs: termsOf` смотрит на
//    `terms` первым). Учебная неделя — тоже целиком: `maxPeriodsPerDay: 5`
//    вуза, подмешанный к шести урокам японской школы, делает неделю
//    невозможной (поймано прогоном). Шкала оценок сливается на один уровень: синонимы основы,
//    указывающие на оценки, которых в чужой шкале нет, — мусор.
//
// 4. **Отказ — со списком причин, а не первой попавшейся.** Человек чинит файл
//    руками, и пять правок по одной за пять загрузок — издевательство.
//
// 5. **Модуль чистый**: ни `fetch`, ни `extension_settings`. Встроенные пресеты
//    ему приносят (`builtins`), хранение — забота `storage.js`, походы — `index.js`.

import { createState } from './state.mjs';
import { buildSchedule } from './schedule.mjs';
import { applyResponse } from './engine.mjs';
import { SIZE_BOUNDS, DEFAULT_SIZE, SEEDS_MAX, CLASSMATE_TEXT_MAX } from './classmates.mjs';
import { REACTION_CAP, CAP_BOUNDS } from './feed.mjs';

/** Имя формата в конверте файла. Отличается от выгрузки состояния (`academy-state`). */
export const PRESET_FORMAT = 'academy-preset';

/** Версия формата конверта — не схемы пресета: конверт может обрасти полями сам по себе. */
export const PRESET_FORMAT_VERSION = 1;

/** Потолок размера файла пресета (9.3.2): встроенные весят ~33 КБ, запас тридцатикратный. */
export const PRESET_MAX_BYTES = 1024 * 1024;

/**
 * Сколько своих пресетов держать. Каждый лежит в `settings.json` таверны
 * целиком, а его таверна переписывает при любой правке любой настройки.
 */
export const USER_PRESETS_MAX = 20;

/**
 * Встроенные пресеты — файлы в папке расширения. Список здесь, а не в
 * `index.js`: по нему же решается, чей `id` занят и на что откатываться.
 */
export const BUILTIN_PRESETS = [
  'ru-university', 'ru-school', 'jp-highschool', 'magic-academy', 'us-college', 'us-highschool',
  'dark-academia',
  'cadet-academy', 'space-academy', 'hero-academy', 'xianxia-sect', 'cn-highschool',
];

/** Основа по умолчанию и то, на что откатывается чат с исчезнувшим пресетом. */
export const DEFAULT_BASE = 'ru-university';

/**
 * Пределы общего фильтра. Подобраны по встроенным пресетам с запасом: там
 * глубина 4, самый длинный текст ~850 символов (промпт плана), самый длинный
 * список 8, самый большой словарь — `ui` на ~200 ключей.
 */
export const TREE_LIMITS = {
  depth: 6,
  nodes: 6000,
  string: 4000,
  key: 64,
  keys: 500,
  array: 100,
};

/** Длина `id` и отображаемого имени. `id` уходит в имя файла и в `state.presetId`. */
export const ID_MAX = 48;
export const NAME_MAX = 80;

/**
 * Разумные рамки числовых потолков `limits`. Чужой `journalSize: 1e9` иначе
 * раздул бы метаданные чата, а `maxSubjects: 0` сделал бы семестр невозможным.
 * Значение за рамкой не отвергается, а зажимается — с предупреждением.
 */
export const LIMIT_BOUNDS = {
  maxSubjects: [1, 20],
  maxTeachers: [1, 20],
  // Сколько преподавателей зовёт генерация плана и сколько предметов на одного.
  planTeachers: [1, 20],
  maxSubjectsPerTeacher: [1, 20],
  maxNumbersInPrompt: [0, 20],
  idleWarnAfter: [1, 100],
  journalSize: [10, 1000],
  minTraits: [0, 5],
  maxTraits: [0, 10],
  maxIdLength: [4, 48],
  maxTimeShift: [1, 366],
  maxForwardJump: [1, 366],
  maxLorebookEntries: [0, 200],
  lorebookCharsPerToken: [1, 10],
};

/** Ключи, которые в объект нельзя пускать никогда: загрязнение прототипа. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Теги, которые переживают очистку строки. Справку слэш-команд таверна рисует
 * разметкой, и встроенные пресеты пишут в ней `<code>`; всё остальное —
 * `<img onerror>`, `<script>`, `<a href="javascript:">`, любой тег с
 * атрибутом — вырезается.
 */
const SAFE_TAGS = new Set(['code', 'b', 'i', 'em', 'strong', 'u', 'br']);

/**
 * Насколько глубоко сливать секцию с основой. 0 — секция целиком либо своя,
 * либо основы (решение 3). Не названная здесь секция сливается на два уровня:
 * это словари (`phrases.milestones.*`, `prompts.plan.*`, `ui.phases.*`).
 */
const MERGE_DEPTH = { calendar: 0, week: 0, grades: 1, bells: 0, stopNames: 0, holidays: 0, classmates: 1 };

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isHM = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isMD = (v) => typeof v === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
const minutes = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

// --- строки -----------------------------------------------------------------

/**
 * Обезвредить одну строку (решение 1).
 *
 * - управляющие символы, кроме перевода строки и табуляции, — вон: в промпте
 *   они невидимы, а в имени файла опасны;
 * - `{{` → `{` + пробел нулевой ширины + `{`: тот же приём, что у `api.js:
 *   escapeMacros`. Одинарные `{ключ}` — подстановки самой Академии — не
 *   трогаются;
 * - теги вне `SAFE_TAGS` и любые теги с атрибутами вырезаются, одинокая `<`
 *   перед буквой становится `‹` — чтобы из обрезков не собрался новый тег.
 *
 * @returns {{text: string, changed: boolean, cut: boolean}}
 */
export function cleanString(value, max = TREE_LIMITS.string) {
  let s = String(value);
  const before = s;
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  s = s.replace(/\{(?=\{)/g, '{\u200B');
  // Один проход: тег целиком либо одинокая `<`. Двумя проходами второй
  // испортил бы теги, которые первый оставил.
  s = s.replace(/<\s*(\/?)\s*([a-zA-Z][\w-]*)([^<>]*)>|<(?=[a-zA-Z/!?])/g, (m, slash, tag, rest) => {
    if (!tag) return '‹';
    return SAFE_TAGS.has(tag.toLowerCase()) && !rest.trim().replace(/^\/$/, '') ? `<${slash}${tag.toLowerCase()}>` : '';
  });
  let cut = false;
  if (s.length > max) { s = s.slice(0, max); cut = true; }
  return { text: s, changed: s !== before, cut };
}

// --- общий фильтр дерева ------------------------------------------------------

/**
 * Пропустить JSON-дерево через общий фильтр. Возвращает копию: исходный объект
 * не трогается (его держит панель для превью).
 *
 * Что за пределами — не роняет разбор целиком, а обрезается с предупреждением,
 * кроме одного: дерево больше `nodes` узлов — это уже не пресет, и тогда отказ.
 *
 * @returns {{value: *, warnings: string[], errors: string[]}}
 */
export function sanitizeTree(input, limits = TREE_LIMITS) {
  const warnings = [];
  const errors = [];
  let nodes = 0;
  const note = (list, text) => { if (list.length < 30 && !list.includes(text)) list.push(text); };

  const walk = (v, path, depth) => {
    nodes += 1;
    if (nodes > limits.nodes) {
      if (!errors.length) errors.push(`в файле больше ${limits.nodes} полей — это не похоже на пресет`);
      return undefined;
    }
    if (v === null || typeof v === 'boolean') return v;
    if (typeof v === 'number') {
      if (Number.isFinite(v)) return v;
      note(warnings, `${path}: не число — поле выброшено`);
      return undefined;
    }
    if (typeof v === 'string') {
      const r = cleanString(v, limits.string);
      if (r.cut) note(warnings, `${path}: текст длиннее ${limits.string} символов — обрезан`);
      return r.text;
    }
    if (depth >= limits.depth) {
      note(warnings, `${path}: вложенность глубже ${limits.depth} — выброшено`);
      return undefined;
    }
    if (Array.isArray(v)) {
      if (v.length > limits.array) note(warnings, `${path}: в списке больше ${limits.array} элементов — лишние выброшены`);
      const out = [];
      for (const item of v.slice(0, limits.array)) {
        const x = walk(item, `${path}[]`, depth + 1);
        if (x !== undefined) out.push(x);
      }
      return out;
    }
    if (typeof v === 'object') {
      const out = {};
      const keys = Object.keys(v);
      if (keys.length > limits.keys) note(warnings, `${path}: больше ${limits.keys} ключей — лишние выброшены`);
      for (const k of keys.slice(0, limits.keys)) {
        if (FORBIDDEN_KEYS.has(k)) { note(warnings, `${path}.${k}: запретный ключ — выброшен`); continue; }
        if (k.length > limits.key) { note(warnings, `${path}: слишком длинное имя ключа — выброшено`); continue; }
        const x = walk(v[k], path ? `${path}.${k}` : k, depth + 1);
        if (x !== undefined) out[k] = x;
      }
      return out;
    }
    // undefined, функции, символы, bigint — в JSON их не бывает; если объект
    // пришёл не из JSON.parse, такое молча выбрасывается.
    return undefined;
  };

  const value = walk(input, '', 0);
  return { value, warnings, errors };
}

// --- слияние с основой ------------------------------------------------------------

function mergeDeep(base, own, depth) {
  if (own === undefined) return base;
  if (depth <= 0 || !isPlain(base) || !isPlain(own)) return own;
  const out = { ...base };
  for (const [k, v] of Object.entries(own)) out[k] = mergeDeep(base[k], v, depth - 1);
  return out;
}

/** Пресет человека поверх основы (решение 3). Верхние ключи — объединение. */
export function mergeOverBase(base, own) {
  const out = {};
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(own || {})]);
  for (const k of keys) {
    const depth = k in MERGE_DEPTH ? MERGE_DEPTH[k] : 2;
    const v = mergeDeep(base ? base[k] : undefined, own ? own[k] : undefined, depth);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

// --- формы секций -------------------------------------------------------------
//
// Каждая проверка возвращает список претензий словами. Слова — механизма, а не
// заведения: человек, собирающий японскую школу, читает про «сетку звонков», а
// не про «пары».

function checkWeek(w) {
  const e = [];
  if (!isPlain(w)) return ['week: нет учебной недели'];
  const days = w.studyDays;
  if (!Array.isArray(days) || !days.length || !days.every((d) => isInt(d) && d >= 1 && d <= 7)
    || new Set(days).size !== days.length) {
    e.push('week.studyDays: нужен список учебных дней недели, числа 1–7 без повторов');
  }
  if (!isInt(w.periodsPerDay) || w.periodsPerDay < 1 || w.periodsPerDay > 12) {
    e.push('week.periodsPerDay: занятий в день — целое от 1 до 12');
  }
  if (w.maxPeriodsPerDay !== undefined
    && (!isInt(w.maxPeriodsPerDay) || w.maxPeriodsPerDay > 12 || w.maxPeriodsPerDay < (w.periodsPerDay || 1))) {
    e.push('week.maxPeriodsPerDay: целое, не меньше periodsPerDay и не больше 12');
  }
  return e;
}

function checkBells(bells, week) {
  if (!Array.isArray(bells) || !bells.length) return ['bells: нет сетки звонков'];
  const e = [];
  bells.forEach((b, i) => {
    if (!isPlain(b) || !isHM(b.start) || !isHM(b.end) || minutes(b.start) >= minutes(b.end)) {
      e.push(`bells[${i + 1}]: нужны start и end в виде ЧЧ:ММ, начало раньше конца`);
    }
  });
  const need = week && isInt(week.periodsPerDay) ? week.periodsPerDay : 1;
  if (!e.length && bells.length < need) e.push(`bells: звонков ${bells.length}, а занятий в день ${need}`);
  return e;
}

function checkTerm(t, where) {
  const e = [];
  if (!isMD(t.start)) e.push(`${where}.start: начало периода в виде ММ-ДД`);
  if (!isInt(t.studyWeeks) || t.studyWeeks < 1 || t.studyWeeks > 60) e.push(`${where}.studyWeeks: учебных недель — целое от 1 до 60`);
  if (t.examWeeks !== undefined && (!isInt(t.examWeeks) || t.examWeeks < 0 || t.examWeeks > 12)) {
    e.push(`${where}.examWeeks: недель контрольных — целое от 0 до 12`);
  }
  return e;
}

function checkCalendar(cal) {
  if (!isPlain(cal)) return ['calendar: нет календаря'];
  const e = [];
  if (Array.isArray(cal.terms) && cal.terms.length) {
    if (cal.terms.length > 6) e.push('calendar.terms: больше шести учебных периодов в году');
    cal.terms.slice(0, 6).forEach((t, i) => {
      if (!isPlain(t)) e.push(`calendar.terms[${i + 1}]: не объект`);
      else e.push(...checkTerm(t, `calendar.terms[${i + 1}]`));
    });
  } else {
    e.push(...checkTerm({ start: cal.termStart, studyWeeks: cal.studyWeeks, examWeeks: cal.examWeeks }, 'calendar'));
  }
  if (cal.vacations !== undefined && !Array.isArray(cal.vacations)) e.push('calendar.vacations: нужен список');
  return e;
}

/**
 * Праздники (`core/holidays.mjs`): необязательный список. Битая запись — не
 * молчаливый пропуск, а претензия: человек, собирающий пресет, должен узнать,
 * что его бал не наступит никогда.
 */
function checkHolidays(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) return ['holidays: нужен список'];
  const e = [];
  if (list.length > 40) e.push('holidays: больше сорока праздников');
  list.slice(0, 40).forEach((h, i) => {
    const where = `holidays[${i + 1}]`;
    if (!isPlain(h)) { e.push(`${where}: не объект`); return; }
    if (typeof h.name !== 'string' || !h.name.trim()) e.push(`${where}.name: нет названия`);
    if (!isMD(h.from)) e.push(`${where}.from: начало в виде ММ-ДД`);
    if (h.to !== undefined && !isMD(h.to)) e.push(`${where}.to: конец в виде ММ-ДД`);
    if (h.lead !== undefined && (!isInt(h.lead) || h.lead < 0 || h.lead > 14)) e.push(`${where}.lead: за сколько дней — целое от 0 до 14`);
    if (h.off !== undefined && typeof h.off !== 'boolean') e.push(`${where}.off: «занятий нет» — true или false`);
  });
  return e;
}

/**
 * Курс (`core/classmates.mjs`): `{size, seeds, labels}`, весь блок
 * необязателен. Размер и зёрна не отвергаются, а приводятся к рамкам с
 * предупреждением — пресет с девятью ролями годен и так. Ярлыки — та же
 * форма, что у шкалы отношения: битая таблица означала бы немого человека.
 * Правит блок на месте (он уже копия слияния).
 *
 * @returns {{errors: string[], warnings: string[]}}
 */
export function normalizeClassmatesBlock(preset) {
  const errors = [];
  const warnings = [];
  const block = preset.classmates;
  if (block === undefined) return { errors, warnings };
  if (!isPlain(block)) return { errors: ['classmates: нужен объект {size, seeds, labels}'], warnings };
  if (block.size !== undefined) {
    const [lo, hi] = SIZE_BOUNDS;
    if (!isInt(block.size)) {
      warnings.push(`classmates.size: не целое — взято ${DEFAULT_SIZE}`);
      block.size = DEFAULT_SIZE;
    } else if (block.size < lo || block.size > hi) {
      const n = Math.min(hi, Math.max(lo, block.size));
      warnings.push(`classmates.size: ${block.size} за рамками ${lo}–${hi}, взято ${n}`);
      block.size = n;
    }
  }
  if (block.seeds !== undefined) {
    if (!Array.isArray(block.seeds)) {
      errors.push('classmates.seeds: нужен список ролей');
    } else {
      const seeds = [];
      for (const v of block.seeds) {
        const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, CLASSMATE_TEXT_MAX.seed) : '';
        if (t && !seeds.includes(t)) seeds.push(t);
      }
      if (seeds.length !== block.seeds.length) warnings.push('classmates.seeds: пустые, повторы и не-строки выброшены');
      if (seeds.length > SEEDS_MAX) warnings.push(`classmates.seeds: ролей больше ${SEEDS_MAX} — лишние отброшены`);
      block.seeds = seeds.slice(0, SEEDS_MAX);
    }
  }
  if (block.labels !== undefined && (!Array.isArray(block.labels) || !block.labels.length
    || !block.labels.every((l) => isPlain(l) && typeof l.upTo === 'number' && typeof l.label === 'string'))) {
    errors.push('classmates.labels: список ступеней {upTo, label}');
  }
  return { errors, warnings };
}

/**
 * Лента (`core/feed.mjs`): `{reactionCap}` — сколько реакций самое большее
 * ложится с одного разбора. Блок необязателен; число вне рамок 1–12 не
 * отвергается, а зажимается с предупреждением, мусор — умолчание 6. Правит
 * блок на месте (он уже копия слияния).
 *
 * @returns {{errors: string[], warnings: string[]}}
 */
export function normalizeFeedBlock(preset) {
  const errors = [];
  const warnings = [];
  const block = preset.feed;
  if (block === undefined) return { errors, warnings };
  if (!isPlain(block)) return { errors: ['feed: нужен объект {reactionCap, extras, nickExamples}'], warnings };
  if (block.reactionCap !== undefined) {
    const [lo, hi] = CAP_BOUNDS;
    if (!isInt(block.reactionCap)) {
      warnings.push(`feed.reactionCap: не целое — взято ${REACTION_CAP}`);
      block.reactionCap = REACTION_CAP;
    } else if (block.reactionCap < lo || block.reactionCap > hi) {
      const n = Math.min(hi, Math.max(lo, block.reactionCap));
      warnings.push(`feed.reactionCap: ${block.reactionCap} за рамками ${lo}–${hi}, взято ${n}`);
      block.reactionCap = n;
    }
  }
  // Типажи статистов и примеры ников (`feed.extras`, `feed.nickExamples`) —
  // списки строк; мусор не отвергает пресет, лента берёт общие слова.
  for (const key of ['extras', 'nickExamples']) {
    const list = block[key];
    if (list === undefined) continue;
    if (!Array.isArray(list) || !list.every((v) => typeof v === 'string' && v.trim())) {
      warnings.push(`feed.${key}: нужен список строк — взяты общие`);
      delete block[key];
    }
  }
  return { errors, warnings };
}

function checkGrades(g) {
  if (!isPlain(g) || !Array.isArray(g.values) || !g.values.length) return ['grades.values: нет шкалы оценок'];
  const e = [];
  const seen = new Set();
  g.values.forEach((v, i) => {
    const where = `grades.values[${i + 1}]`;
    if (!isPlain(v) || typeof v.value !== 'string' || !v.value.trim() || v.value.length > 40) {
      e.push(`${where}: у оценки нет значения (строка до 40 символов)`);
      return;
    }
    if (seen.has(v.value)) e.push(`${where}: оценка «${v.value}» повторяется`);
    seen.add(v.value);
    if (v.points !== null && v.points !== undefined && typeof v.points !== 'number') e.push(`${where}: points — число или null`);
    if (typeof v.pass !== 'boolean') e.push(`${where}: pass — true или false`);
  });
  if (!e.length && !g.values.some((v) => v.pass === true)) e.push('grades.values: ни одной проходной оценки');
  if (g.aliases !== undefined && !isPlain(g.aliases)) e.push('grades.aliases: нужен объект «синоним: оценка»');
  return e;
}

function checkExams(x) {
  if (!isPlain(x) || !Array.isArray(x.kinds) || !x.kinds.length) return ['exams.kinds: нет ни одного вида контрольного'];
  const e = [];
  const seen = new Set();
  x.kinds.forEach((k, i) => {
    if (!isPlain(k) || typeof k.id !== 'string' || !/^[\w-]{1,32}$/.test(k.id)) {
      e.push(`exams.kinds[${i + 1}]: id — латиница, цифры, дефис, до 32 символов`);
    } else if (seen.has(k.id)) e.push(`exams.kinds[${i + 1}]: id «${k.id}» повторяется`);
    else seen.add(k.id);
    if (isPlain(k) && typeof k.name !== 'string') e.push(`exams.kinds[${i + 1}]: нет названия`);
  });
  if (x.retakes !== undefined && (!isInt(x.retakes) || x.retakes < 0 || x.retakes > 10)) e.push('exams.retakes: пересдач — целое от 0 до 10');
  return e;
}

function checkScale(s, name) {
  if (!isPlain(s)) return [`${name}: нет шкалы`];
  const e = [];
  const num = (v) => typeof v === 'number' && Math.abs(v) <= 1000;
  if (!num(s.min) || !num(s.max) || s.min >= s.max) e.push(`${name}: min и max — числа до 1000 по модулю, min меньше max`);
  if (s.start !== undefined && (!num(s.start) || (num(s.min) && num(s.max) && (s.start < s.min || s.start > s.max)))) {
    e.push(`${name}.start: начальное значение внутри шкалы`);
  }
  if (!Array.isArray(s.labels) || !s.labels.length
    || !s.labels.every((l) => isPlain(l) && typeof l.upTo === 'number' && typeof l.label === 'string')) {
    e.push(`${name}.labels: список ступеней {upTo, label}`);
  }
  return e;
}

function checkVocab(v) {
  if (!isPlain(v)) return ['vocab: нет словаря заведения'];
  const bad = Object.entries(v).filter(([, x]) => typeof x !== 'string').map(([k]) => k);
  return bad.length ? [`vocab: не строки — ${bad.join(', ')}`] : [];
}

/**
 * Зажать числовые потолки в разумные рамки (`LIMIT_BOUNDS`). Правит копию.
 * @returns {{limits: Object, warnings: string[]}}
 */
export function clampLimits(limits) {
  const out = isPlain(limits) ? { ...limits } : {};
  const warnings = [];
  for (const [k, v] of Object.entries(out)) {
    if (typeof v !== 'number') { delete out[k]; warnings.push(`limits.${k}: не число — взято из основы`); continue; }
    const [lo, hi] = LIMIT_BOUNDS[k] || [0, 10000];
    const n = Math.min(hi, Math.max(lo, v));
    if (n !== v) { out[k] = n; warnings.push(`limits.${k}: ${v} за рамками ${lo}–${hi}, взято ${n}`); }
  }
  return { limits: out, warnings };
}

// --- id и имя -------------------------------------------------------------------

/**
 * `id` пресета: строчная латиница, цифры, дефис, подчёркивание. Он уходит в
 * `state.presetId`, в имя выгружаемого файла и в ключ настроек — пробел или
 * слэш там не нужны никому.
 */
export function cleanId(raw) {
  return String(raw || '').toLowerCase().trim()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, ID_MAX);
}

/**
 * Свободный `id` (9.3.2: «новые id при коллизии»). Занятый встроенным или уже
 * загруженным пресетом получает хвост `-2`, `-3`… Заменять существующий молча
 * нельзя: на него могут ссылаться чаты, и их семестры тихо сменили бы шкалу.
 */
export function freeId(wanted, taken) {
  const set = new Set(taken || []);
  const base = cleanId(wanted) || 'custom';
  if (!set.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const tail = `-${i}`;
    const id = `${base.slice(0, ID_MAX - tail.length)}${tail}`;
    if (!set.has(id)) return id;
  }
  return `${base.slice(0, ID_MAX - 14)}-${Date.now()}`;
}

/** Имя без повтора: два «Российский вуз» в выпадашке неотличимы. */
export function freeName(wanted, takenNames) {
  const set = new Set(takenNames || []);
  const base = String(wanted || '').trim().slice(0, NAME_MAX) || 'Свой пресет';
  if (!set.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const name = `${base.slice(0, NAME_MAX - 5)} (${i})`;
    if (!set.has(name)) return name;
  }
  return base;
}

// --- конверт ----------------------------------------------------------------------

/**
 * Похоже ли на голый пресет — тот, что лежал в папке установки до этого
 * модуля. Такие файлы у людей уже есть, и отвергать их было бы странно.
 */
export function looksLikeBarePreset(v) {
  return isPlain(v) && (isPlain(v.vocab) || isPlain(v.week) || isPlain(v.grades)) && !('format' in v);
}

/**
 * Разобрать текст или объект файла в `{envelope, preset}`.
 * @returns {{ok: true, raw: Object, basedOn: string, warnings: string[]}
 *   | {ok: false, code: string, message: string, errors: string[]}}
 */
export function readPresetFile(source) {
  const fail = (code, message, errors = []) => ({ ok: false, code, message, errors });
  let data = source;
  if (typeof source === 'string') {
    // Длина в байтах, а не в символах: кириллица в UTF-8 — по два байта.
    const bytes = typeof TextEncoder === 'function' ? new TextEncoder().encode(source).length : source.length * 2;
    if (bytes > PRESET_MAX_BYTES) return fail('too-big', `Файл больше 1 МБ (${Math.ceil(bytes / 1024)} КБ): пресет столько не весит.`);
    const text = source.trim();
    if (!text) return fail('empty', 'Файл пуст.');
    try {
      data = JSON.parse(text);
    } catch (err) {
      return fail('not-json', `Это не JSON: ${(err && err.message) || 'разбор не удался'}.`);
    }
  }
  if (!isPlain(data)) return fail('not-object', 'В файле не объект: ожидался пресет академии.');

  const warnings = [];
  if (data.format === 'academy-state') {
    return fail('state-file', 'Это выгрузка состояния семестра, а не пресет. Её загружают в блоке «Выгрузка и загрузка».');
  }
  if (data.format !== undefined && data.format !== PRESET_FORMAT) {
    return fail('foreign', `Это выгрузка чего-то другого: format = «${String(data.format).slice(0, 40)}», ожидалось «${PRESET_FORMAT}».`);
  }
  let raw;
  if (data.format === PRESET_FORMAT) {
    const v = data.version !== undefined ? data.version : data.formatVersion;
    if (typeof v === 'number' && v > PRESET_FORMAT_VERSION) {
      return fail('format-future', `Пресет выгружен форматом версии ${v}, расширение понимает ${PRESET_FORMAT_VERSION}. Обновите расширение.`);
    }
    if (!isPlain(data.preset)) return fail('no-preset', 'В конверте нет самого пресета (поле preset).');
    raw = data.preset;
  } else if (looksLikeBarePreset(data)) {
    warnings.push('пресет без конверта — принят как файл из папки пресетов');
    raw = data;
  } else {
    return fail('foreign', 'Это не пресет академии: нет ни поля format, ни словаря заведения.');
  }
  const basedOn = String(data.basedOn || raw.basedOn || '');
  return { ok: true, raw, basedOn, warnings };
}

/**
 * Конверт для выгрузки. Встроенный пресет выгружается с `basedOn` на самого
 * себя — чтобы загруженная копия, которую человек правит, помнила основу.
 */
export function presetEnvelope(preset, { extensionVersion, exportedAt } = {}) {
  const clean = { ...preset };
  delete clean.source;
  const basedOn = String(preset.basedOn || (BUILTIN_PRESETS.includes(preset.id) ? preset.id : DEFAULT_BASE));
  delete clean.basedOn;
  return {
    format: PRESET_FORMAT,
    version: PRESET_FORMAT_VERSION,
    exportedAt: exportedAt || new Date().toISOString(),
    ...(extensionVersion ? { extensionVersion: String(extensionVersion) } : {}),
    basedOn,
    preset: clean,
  };
}

/** Имя файла выгрузки: `academy-preset-<id>.json`. */
export const presetFilename = (preset) => `academy-preset-${cleanId(preset && preset.id) || 'custom'}.json`;

// --- пробный прогон ---------------------------------------------------------------

/**
 * Прогнать пресет настоящим ядром: завести семестр, построить расписание,
 * посчитать один ответ с меткой. Всё, что упадёт здесь, упало бы в чате —
 * только там посреди игры и с человеком, который не понимает, что случилось.
 *
 * `extra` — ещё проверки снаружи ядра (строка состояния из `prompt.mjs`, вью
 * панели): `core/` про них знать не должен, а прогнать их хочется тем же шагом.
 *
 * @returns {string[]} претензии; пусто — прогон прошёл
 */
export function probePreset(preset, extra = []) {
  const errors = [];
  try {
    const subjects = [
      { id: 'probe-a', name: 'A', teacherId: 'probe-t' },
      { id: 'probe-b', name: 'B', teacherId: 'probe-t' },
    ];
    const teachers = [{ id: 'probe-t', name: 'T', traits: ['x'] }];
    const state = createState(preset, { startDay: '2026-09-01', subjects, teachers, schedule: buildSchedule(subjects, preset) });
    state.started = true;
    const value = preset.grades.values.find((v) => v.pass) || preset.grades.values[0];
    const run = applyResponse(state, `Проба.\n<!-- [ACADEMY t=+1 grade=probe-a:${value.value}] -->`, preset, { mode: 'marker' });
    for (const fn of extra) {
      try { fn(run.state, preset); } catch (err) { errors.push(`пробный прогон (${fn.name || 'вид'}): ${(err && err.message) || err}`); }
    }
  } catch (err) {
    errors.push(`пробный прогон ядром упал: ${(err && err.message) || err}`);
  }
  return errors;
}

// --- нормализация -----------------------------------------------------------------

/**
 * Главная функция: сырой пресет человека → пресет, с которым ядро работает.
 *
 * @param {Object} raw     пресет (без конверта)
 * @param {Object} opts
 * @param {Object<string, Object>} opts.builtins  встроенные пресеты по id
 * @param {string} [opts.basedOn]  основа из конверта
 * @param {Function[]} [opts.probe]  доп. проверки к пробному прогону
 * @returns {{ok: true, preset: Object, warnings: string[]}
 *   | {ok: false, code: string, message: string, errors: string[], warnings: string[]}}
 */
export function normalizePreset(raw, opts = {}) {
  const builtins = opts.builtins || {};
  const fail = (errors, warnings) => ({
    ok: false,
    code: 'invalid',
    message: `Пресет не принят: ${errors.slice(0, 5).join('; ')}${errors.length > 5 ? `; и ещё ${errors.length - 5}` : ''}.`,
    errors,
    warnings,
  });

  const tree = sanitizeTree(raw);
  const warnings = [...tree.warnings];
  if (tree.errors.length) return fail(tree.errors, warnings);
  const own = tree.value;
  if (!isPlain(own)) return fail(['пресет — не объект'], warnings);

  const wantedBase = String(opts.basedOn || own.basedOn || '');
  const baseId = builtins[wantedBase] ? wantedBase : (builtins[DEFAULT_BASE] ? DEFAULT_BASE : Object.keys(builtins)[0]);
  const base = baseId ? builtins[baseId] : null;
  if (!base) return fail(['нет ни одного встроенного пресета, поверх которого его положить'], warnings);
  if (wantedBase && wantedBase !== baseId) warnings.push(`основа «${wantedBase}» неизвестна — недостающее взято из «${baseId}»`);

  // Секции, которых в пресете нет вовсе, — повод сказать, откуда они взялись.
  const borrowed = ['vocab', 'week', 'bells', 'calendar', 'grades', 'exams', 'relations', 'reputation', 'attendance']
    .filter((k) => own[k] === undefined);
  if (borrowed.length) warnings.push(`из «${base.displayName || baseId}» взято целиком: ${borrowed.join(', ')}`);

  const preset = mergeOverBase(base, own);

  const id = cleanId(own.id);
  preset.id = id || 'custom';
  if (!id) warnings.push('у пресета нет годного id — назван «custom»');
  const name = typeof own.displayName === 'string' && own.displayName.trim()
    ? own.displayName.trim().slice(0, NAME_MAX)
    : (typeof own.name === 'string' && own.name.trim() ? own.name.trim().slice(0, NAME_MAX) : preset.id);
  preset.displayName = name;
  preset.basedOn = baseId;
  preset.source = 'user';

  const clamped = clampLimits(own.limits);
  preset.limits = { ...(base.limits || {}), ...clamped.limits };
  warnings.push(...clamped.warnings);

  const errors = [
    ...checkVocab(preset.vocab),
    ...checkWeek(preset.week),
    ...checkBells(preset.bells, preset.week),
    ...checkCalendar(preset.calendar),
    ...checkHolidays(preset.holidays),
    ...checkGrades(preset.grades),
    ...checkExams(preset.exams),
    ...checkScale(preset.relations, 'relations'),
    ...checkScale(preset.reputation, 'reputation'),
  ];
  if (preset.attendance !== undefined && !isPlain(preset.attendance)) errors.push('attendance: нужен объект');
  const course = normalizeClassmatesBlock(preset);
  errors.push(...course.errors);
  warnings.push(...course.warnings);
  const feed = normalizeFeedBlock(preset);
  errors.push(...feed.errors);
  warnings.push(...feed.warnings);
  if (errors.length) return fail(errors, warnings);

  const probed = probePreset(preset, opts.probe || []);
  if (probed.length) return fail(probed, warnings);

  return { ok: true, preset, warnings };
}

// --- превью -----------------------------------------------------------------------

/** «1 прогула / 2 прогулов» — родительный после «после». */
const skipsWord = (n) => (Math.abs(n) % 10 === 1 && Math.abs(n) % 100 !== 11 ? 'прогула' : 'прогулов');

/**
 * Превью перед загрузкой (9.3.2): «семестр · пары в день: 4 · 2–5 · хвост
 * после 3 прогулов». Слова заведения — из самого пресета, а не из активного:
 * человек смотрит, что он ставит, а не на то, что у него стоит.
 *
 * Склонения здесь нет, и это сознательно: «4 пары» требует родительного падежа
 * от слова пресета, которого в словаре нет (`vocab.period` — именительный).
 * «пары в день: 4» читается одинаково у пары, урока и занятия.
 */
export function presetSummary(preset) {
  const p = preset || {};
  const v = p.vocab || {};
  const parts = [];
  const terms = p.calendar && Array.isArray(p.calendar.terms) ? p.calendar.terms.length : 1;
  if (v.term) parts.push(terms > 1 ? `${v.term} ×${terms}` : String(v.term));
  if (p.week && p.week.periodsPerDay) parts.push(`${v.periodPlural || 'занятия'} в день: ${p.week.periodsPerDay}`);
  // Края шкалы — первая по порядку пресета оценка с наименьшим и с наибольшим
  // баллом: у вуза «автомат» весит как «5», но шкала от этого не «2–автомат».
  const scored = ((p.grades && p.grades.values) || []).filter((g) => typeof g.points === 'number');
  if (scored.length) {
    const min = Math.min(...scored.map((g) => g.points));
    const max = Math.max(...scored.map((g) => g.points));
    const lo = scored.find((g) => g.points === min).value;
    const hi = scored.find((g) => g.points === max).value;
    parts.push(lo === hi ? String(lo) : `${lo}–${hi}`);
  }
  const skips = p.attendance && p.attendance.debtAfterSkips;
  if (typeof skips === 'number') parts.push(`${v.debt || 'долг'} после ${skips} ${skipsWord(skips)}`);
  return {
    id: String(p.id || ''),
    name: String(p.displayName || p.name || p.id || ''),
    basedOn: String(p.basedOn || ''),
    line: parts.join(' · '),
  };
}

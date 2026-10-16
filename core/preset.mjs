import { createState } from './state.mjs';
import { resolveGendered, checkGendered, isGenderedPair } from './gender.mjs';
import { buildSchedule } from './schedule.mjs';
import { applyResponse } from './engine.mjs';
import { SIZE_BOUNDS, DEFAULT_SIZE, SEEDS_MAX, CLASSMATE_TEXT_MAX } from './classmates.mjs';
import { REACTION_CAP, CAP_BOUNDS } from './feed.mjs';
import { WEEKDAY_KEYS } from './time.mjs';

export const PRESET_FORMAT = 'academy-preset';

export const PRESET_FORMAT_VERSION = 1;

export const PRESET_MAX_BYTES = 1024 * 1024;

export const USER_PRESETS_MAX = 20;

export const BUILTIN_PRESETS = [
  'ru-university', 'ru-school', 'jp-highschool', 'magic-academy', 'us-college', 'us-highschool',
  'dark-academia',
  'cadet-academy', 'space-academy', 'hero-academy', 'xianxia-sect',
];

export const REMOVED_PRESETS = { 'cn-highschool': 'jp-highschool' };
export const aliasPresetId = (id) => (Object.hasOwn(REMOVED_PRESETS, id) ? REMOVED_PRESETS[id] : id);

export function presetSwitchPlan({ started = false, confirm = false, viewOnly = false, wanted = '', active = '', chatId = '', viewing = false } = {}) {
  if (viewing && chatId && wanted === chatId) return 'end-view';
  if (viewing && wanted === active && !viewOnly) return confirm ? 'switch' : 'ask';
  if (wanted === active) return 'same';
  if (started && viewOnly) return 'view';
  if (started && !confirm) return 'ask';
  return 'switch';
}

export const PRESET_VIEW_SAFE = ['setPreset', 'endPresetView', 'exportPreset', 'previewPreset', 'importPreset', 'deletePreset', 'exportState', 'testApi', 'listModels', 'refresh'];
export const keepsPresetView = (name) => PRESET_VIEW_SAFE.includes(name);

export const DEFAULT_BASE = 'ru-university';

export const TREE_LIMITS = {
  depth: 6,
  nodes: 6000,
  string: 4000,
  key: 64,
  keys: 500,
  array: 100,
};

export const ID_MAX = 48;
export const NAME_MAX = 80;

export const LIMIT_BOUNDS = {
  maxSubjects: [1, 20],
  maxTeachers: [1, 20],
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
  prepIntents: [0, 6],
  prepExamLead: [1, 14],
};

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const SAFE_TAGS = new Set(['code', 'b', 'i', 'em', 'strong', 'u', 'br']);

const MERGE_DEPTH = { calendar: 0, week: 0, grades: 1, bells: 0, stopNames: 0, holidays: 0, glossary: 0, classmates: 1 };

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
const isHM = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const isMD = (v) => typeof v === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
const minutes = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

export function cleanString(value, max = TREE_LIMITS.string) {
  let s = String(value);
  const before = s;
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  s = s.replace(/\{(?=\{)/g, '{\u200B');
  s = s.replace(/<\s*(\/?)\s*([a-zA-Z][\w-]*)([^<>]*)>|<(?=[a-zA-Z/!?])/g, (m, slash, tag, rest) => {
    if (!tag) return '‹';
    return SAFE_TAGS.has(tag.toLowerCase()) && !rest.trim().replace(/^\/$/, '') ? `<${slash}${tag.toLowerCase()}>` : '';
  });
  let cut = false;
  if (s.length > max) { s = s.slice(0, max); cut = true; }
  return { text: s, changed: s !== before, cut };
}

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
    return undefined;
  };

  const value = walk(input, '', 0);
  return { value, warnings, errors };
}

function mergeDeep(base, own, depth) {
  if (own === undefined) return base;
  if (depth <= 0 || !isPlain(base) || !isPlain(own) || isGenderedPair(own) || isGenderedPair(base)) return own;
  const out = { ...base };
  for (const [k, v] of Object.entries(own)) out[k] = mergeDeep(base[k], v, depth - 1);
  return out;
}

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
    if (h.lunar !== undefined && !(isMD(h.lunar) && Number(h.lunar.slice(0, 2)) <= 12 && Number(h.lunar.slice(3, 5)) <= 30)) {
      e.push(`${where}.lunar: лунная дата в виде ММ-ДД (месяц 01–12, день 01–30)`);
    }
    if (h.weekday !== undefined && !WEEKDAY_KEYS.includes(h.weekday)) e.push(`${where}.weekday: день недели — ${WEEKDAY_KEYS.join(', ')}`);
    if (h.days !== undefined && (!isInt(h.days) || h.days < 1 || h.days > 60)) e.push(`${where}.days: сколько дней идёт праздник — целое от 1 до 60`);
  });
  return e;
}

function checkGlossary(g) {
  if (g === undefined) return [];
  if (!isPlain(g)) return ['glossary: нужен объект {слово: пояснение}'];
  const e = [];
  const keys = Object.keys(g);
  if (keys.length > 60) e.push('glossary: больше шестидесяти слов');
  for (const k of keys.slice(0, 60)) {
    if (!k.trim() || k.length > 60) e.push(`glossary: слово «${k.slice(0, 20)}» пустое или длиннее 60 знаков`);
    if (typeof g[k] !== 'string' || !g[k].trim()) e.push(`glossary.${k}: нужно пояснение текстом`);
    else if (g[k].length > 300) e.push(`glossary.${k}: пояснение длиннее 300 знаков`);
  }
  return e;
}

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

export function normalizeFeedBlock(preset) {
  const errors = [];
  const warnings = [];
  const block = preset.feed;
  if (block === undefined) return { errors, warnings };
  if (!isPlain(block)) return { errors: ['feed: нужен объект {reactionCap, extras, nickExamples, manners}'], warnings };
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
  for (const key of ['extras', 'nickExamples', 'manners', 'worldTopics', 'samples']) {
    const list = block[key];
    if (list === undefined) continue;
    if (!Array.isArray(list) || !list.every((v) => typeof v === 'string' && v.trim())) {
      warnings.push(`feed.${key}: нужен список строк — взяты общие`);
      delete block[key];
    }
  }
  if (block.banter !== undefined) {
    const b = block.banter;
    if (!isPlain(b) || !Object.values(b).every((l) => Array.isArray(l) && l.every((v) => typeof v === 'string' && v.trim()))) {
      warnings.push('feed.banter: нужен объект со списками строк — ругань и сленг общие');
      delete block.banter;
    }
  }
  if (block.register !== undefined && (typeof block.register !== 'string' || !block.register.trim())) {
    warnings.push('feed.register: нужна строка — взят общий регистр');
    delete block.register;
  }
  if (block.reactions !== undefined) {
    const list = block.reactions;
    const ok = Array.isArray(list) && list.length >= 6 && list.length <= 8 && list.every((v) => isPlain(v)
      && typeof v.emoji === 'string' && v.emoji.trim() && typeof v.tone === 'string' && /^[\p{L}-]{2,20}$/u.test(v.tone.trim()));
    if (!ok) {
      warnings.push('feed.reactions: нужно 6–8 пар {emoji, tone} (тон — одно слово) — реакции по-старому');
      delete block.reactions;
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

export function cleanId(raw) {
  return String(raw || '').toLowerCase().trim()
    .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, ID_MAX);
}

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

export function looksLikeBarePreset(v) {
  return isPlain(v) && (isPlain(v.vocab) || isPlain(v.week) || isPlain(v.grades)) && !('format' in v);
}

export function readPresetFile(source) {
  const fail = (code, message, errors = []) => ({ ok: false, code, message, errors });
  let data = source;
  if (typeof source === 'string') {
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

export const presetFilename = (preset) => `academy-preset-${cleanId(preset && preset.id) || 'custom'}.json`;

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

  const errors = [...checkGendered(preset)];
  for (const gender of ['f', 'm']) {
    const view = resolveGendered(preset, gender);
    for (const e of [
      ...checkVocab(view.vocab),
      ...checkWeek(view.week),
      ...checkBells(view.bells, view.week),
      ...checkCalendar(view.calendar),
      ...checkHolidays(view.holidays),
      ...checkGlossary(view.glossary),
      ...checkGrades(view.grades),
      ...checkExams(view.exams),
      ...checkScale(view.relations, 'relations'),
      ...checkScale(view.reputation, 'reputation'),
    ]) if (!errors.includes(e)) errors.push(e);
  }
  if (preset.attendance !== undefined && !isPlain(preset.attendance)) errors.push('attendance: нужен объект');
  const course = normalizeClassmatesBlock(preset);
  errors.push(...course.errors);
  warnings.push(...course.warnings);
  const feed = normalizeFeedBlock(preset);
  errors.push(...feed.errors);
  warnings.push(...feed.warnings);
  if (errors.length) return fail(errors, warnings);

  const probed = [];
  for (const gender of ['f', 'm']) {
    for (const e of probePreset(resolveGendered(preset, gender), opts.probe || [])) if (!probed.includes(e)) probed.push(e);
  }
  if (probed.length) return fail(probed, warnings);

  return { ok: true, preset, warnings };
}

const skipsWord = (n) => (Math.abs(n) % 10 === 1 && Math.abs(n) % 100 !== 11 ? 'прогула' : 'прогулов');

export function presetSummary(preset) {
  const p = resolveGendered(preset || {}, 'f');
  const v = p.vocab || {};
  const parts = [];
  const terms = p.calendar && Array.isArray(p.calendar.terms) ? p.calendar.terms.length : 1;
  if (v.term) parts.push(terms > 1 ? `${v.term} ×${terms}` : String(v.term));
  if (p.week && p.week.periodsPerDay) parts.push(`${v.periodPlural || 'занятия'} в день: ${p.week.periodsPerDay}`);
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

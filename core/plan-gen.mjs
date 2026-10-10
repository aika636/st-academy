// core/plan-gen — учебный план по анкете: сборка промпта и разбор ответа модели.
//
// Только чистая часть 3.6. Ни `fetch`, ни DOM, ни настроек: сеть живёт в
// `index.js`. Здесь текст на входе — план на выходе, и это ровно то, что можно
// прогнать тестом без браузера.
//
// Три решения, из которых вытекает всё остальное.
//
// 1. **Разбор обязан переживать обычный текст с JSON внутри.** `jsonSchema` у
//    `generateRaw` есть, но поддержка зависит от бэкенда (3.6), а дешёвая модель
//    вдобавок любит забор ```json, вежливое вступление и висячую запятую. Поэтому
//    JSON не «парсится», а выковыривается: забор, скобочный баланс, потом
//    осторожная починка. Всё, что не разобралось, честно возвращается в `raw` —
//    человеку показывают именно его.
//
// 2. **Провал схемы не равен «всё пропало».** Результат редактируемый (таблица
//    предметов открыта всегда), поэтому двадцать предметов — это обрезка до
//    потолка с записью в `errors`, а не отказ. Отбраковываются только вещи, с
//    которыми дальше нельзя работать: пустое название, повторяющийся id.
//
// 3. **Короткий латинский id.** Поправка 1 замера B: модель ломает значения с
//    пробелами (`grade=аналитическая химия:4`), поэтому в метке стоит
//    `grade=chemistry:4`, а длинное имя живёт отдельным полем.
//
// 4. **Учителей мало, но у каждого душа.** Генерация зовёт не больше
//    `limits.planTeachers` (умолчание — четыре) преподавателей, каждый ведёт
//    один-три предмета и приносит должность, «что любит» и тайну. Потолок
//    генерации отделён от `limits.maxTeachers`: тот держит таблицу, правленную
//    руками, и семестр с восемью наставниками не должен перестать сохраняться
//    оттого, что модель теперь зовёт четверых. Поля души необязательны: план
//    без них — не брак.
//
// Ни одного числа и ни одного слова сеттинга в логике: потолки — из
// `preset.limits`, промпт — шаблон из `preset.prompts.plan` (ниже лежит
// перекрываемый образец по умолчанию).

import { teacherDetails } from './state.mjs';

/**
 * Значения по умолчанию — данные, не логика; каждое перекрывается пресетом.
 */
export const DEFAULTS = {
  maxSubjects: 8,
  maxTeachers: 8,
  /** Сколько преподавателей зовёт генерация: мало, но с душой. Не больше `maxTeachers`. */
  planTeachers: 4,
  /** Сколько предметов ведёт один преподаватель: больше — замечание, не брак. */
  maxSubjectsPerTeacher: 3,
  /** Сколько черт характера ждём у преподавателя: одна-две (3.6). */
  minTraits: 1,
  maxTraits: 2,
  /** Потолок длины короткого id. */
  maxIdLength: 24,
};

/**
 * Шаблон запроса по умолчанию. Данные: пресет перекрывает блоком
 * `preset.prompts.plan`. Плейсхолдеры `{ключ}` берутся из анкеты и лимитов;
 * фигурные скобки JSON-образца под подстановку не попадают — она видит только
 * `{слово}` без кавычек.
 */
export const DEFAULT_PROMPT = {
  system: 'Ты составляешь учебный план для ролевой игры. Отвечай одним объектом JSON и ничем больше: без пояснений, без markdown, без комментариев.',
  user: [
    'Составь учебный план.',
    'Эпоха: {era}. Страна: {country}. Тип заведения: {institution}. Направление: {faculty}. Курс: {year}. Язык названий и имён: {lang}.',
    'Предметов не больше {maxSubjects}, преподавателей не больше {maxTeachers}: их мало, зато у каждого есть душа.',
    'У каждого предмета ровно один преподаватель; каждый преподаватель ведёт от одного до {maxSubjectsPerTeacher} предметов. У преподавателя имя в традиции страны и одна-две черты характера, из которых может вырасти конфликт («злопамятен», «придирается к опозданиям»).',
    'У каждого преподавателя ещё три поля: post — должность в заведении помимо предмета («директор», «заведующая кафедрой», «куратор общежития»), до 60 символов; likes — что любит, зацепка для сцены («белое вино и дорогие картины»), до 120 символов; secret — тайна, которой героиня не знает и которая может всплыть в сюжете («влюблён в коллегу», «скрывает долги»), до 160 символов.',
    'Поле id — короткий латинский идентификатор без пробелов, поле name — полное название на языке {lang}.',
    'Формат ответа:',
    '{"subjects":[{"id":"chemistry","name":"…","teacherId":"petrova"}],"teachers":[{"id":"petrova","name":"…","traits":["…"],"post":"…","likes":"…","secret":"…"}]}',
  ].join('\n'),
};

const limitsOf = (preset) => (preset && preset.limits) || {};
const maxSubjects = (preset) => intOr(limitsOf(preset).maxSubjects, DEFAULTS.maxSubjects);
const maxTeachers = (preset) => intOr(limitsOf(preset).maxTeachers, DEFAULTS.maxTeachers);
/** Потолок генерации: `planTeachers`, но не выше общего `maxTeachers`. */
const planTeachers = (preset) => Math.min(
  intOr(limitsOf(preset).planTeachers, DEFAULTS.planTeachers), maxTeachers(preset));
const maxSubjectsPerTeacher = (preset) => intOr(limitsOf(preset).maxSubjectsPerTeacher, DEFAULTS.maxSubjectsPerTeacher);
const minTraits = (preset) => intOr(limitsOf(preset).minTraits, DEFAULTS.minTraits);
const maxTraits = (preset) => intOr(limitsOf(preset).maxTraits, DEFAULTS.maxTraits);

/**
 * Промпт генерации плана по анкете 3.6.
 *
 * @param {Object} survey {era, country, institution, faculty, year, lang}
 * @param {Object} preset
 * @returns {{system: string, prompt: string}}
 */
export function buildPlanPrompt(survey, preset) {
  const tpl = { ...DEFAULT_PROMPT, ...((preset && preset.prompts && preset.prompts.plan) || {}) };
  const s = survey || {};
  const vars = {
    era: str(s.era), country: str(s.country), institution: str(s.institution),
    faculty: str(s.faculty), year: str(s.year),
    lang: str(s.lang) || str(preset && preset.lang),
    maxSubjects: String(maxSubjects(preset)),
    // В промпт уходит потолок генерации, а не таблицы: `{maxTeachers}` в
    // шаблонах пресетов — это «сколько звать», и оно теперь меньше.
    maxTeachers: String(planTeachers(preset)),
    maxSubjectsPerTeacher: String(maxSubjectsPerTeacher(preset)),
  };
  return { system: fill(tpl.system, vars), prompt: fill(tpl.user, vars) };
}

// --- разбор -----------------------------------------------------------------

/**
 * Разбор ответа модели. Никогда не бросает: что не понято — в `errors`, что
 * пришло — в `raw`, потому что при провале человеку показывают именно сырой
 * текст и открывают ручной ввод.
 *
 * @returns {{ok: boolean, plan: {subjects: Array, teachers: Array}, errors: string[], raw: string}}
 */
export function parsePlanResponse(text, preset, opts = {}) {
  const raw = typeof text === 'string' ? text : String(text == null ? '' : text);
  let data = extractJson(raw);
  let partial = false;
  // Спасение — только для ответа, про который известно, что он оборван:
  // целому, но кривому JSON «дорезать хвост» значило бы молча терять данные.
  if (data === undefined && opts.salvage === true) {
    data = salvageJson(raw);
    partial = data !== undefined;
  }
  if (data === undefined) {
    return { ok: false, plan: { subjects: [], teachers: [] }, errors: ['no-json'], raw };
  }
  const shaped = shapePlan(data);
  const checked = validatePlan(shaped.plan, preset);
  return {
    ok: checked.ok, plan: checked.plan, errors: [...shaped.errors, ...checked.errors], raw,
    ...(partial ? { partial: true } : {}),
  };
}

/**
 * Спасти оборванный JSON: оставить всё до последнего ПОЛНОГО элемента массива и
 * закрыть открытые скобки. Режем только по границе элемента (`}`/`]`, чей
 * родитель — массив): обрыв в середине строки, в середине объекта или сразу
 * после запятой отбрасывает недописанный элемент целиком, а не оставляет
 * предмет без половины полей. Возвращает `undefined`, если полного элемента нет.
 * Кавычки учитываются только двойные: апостроф в слове («Don't») строкой не
 * открывается.
 */
export function salvageJson(text) {
  const s = String(text || '');
  const open = s.search(/[{[]/);
  if (open < 0) return undefined;
  const stack = [];
  let inString = false;
  let escaped = false;
  let cut = -1;
  let closers = '';
  for (let i = open; i < s.length; i += 1) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') stack.push('}');
    else if (c === '[') stack.push(']');
    else if (c === '}' || c === ']') {
      if (stack.pop() !== c) return undefined;
      if (!stack.length) return undefined; // закрылось целиком — это не обрыв
      if (stack[stack.length - 1] === ']') {
        cut = i + 1;
        closers = [...stack].reverse().join('');
      }
    }
  }
  if (cut < 0) return undefined;
  const body = s.slice(open, cut) + closers;
  return tryParse(body) ?? tryParse(repairJson(body));
}

/**
 * Выковырять JSON из чего угодно. Порядок попыток — от честного к отчаянному:
 * целиком, из markdown-заборчика, из первого сбалансированного куска, и то же
 * самое после осторожной починки (одинарные кавычки, висячие запятые, «ёлочки»).
 * Возвращает `undefined`, если не вышло ничего.
 */
export function extractJson(text) {
  for (const candidate of jsonCandidates(text)) {
    const direct = tryParse(candidate);
    if (direct !== undefined) return direct;
    const repaired = tryParse(repairJson(candidate));
    if (repaired !== undefined) return repaired;
  }
  return undefined;
}

function* jsonCandidates(text) {
  const s = String(text || '').trim();
  if (!s) return;
  yield s;
  // Забор ```json … ``` — самая частая обёртка у болтливых моделей.
  const fences = [...s.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g)].map((m) => m[1].trim());
  for (const f of fences) yield f;
  // Первый сбалансированный объект или массив в тексте вокруг.
  const source = fences.length ? [s, ...fences] : [s];
  for (const src of source) {
    const block = balancedBlock(src);
    if (block) yield block;
  }
}

/** Первый сбалансированный `{…}`/`[…]`, со знанием о строках и экранировании. */
export function balancedBlock(text) {
  const s = String(text || '');
  const open = s.search(/[{[]/);
  if (open < 0) return '';
  const pairs = { '{': '}', '[': ']' };
  const stack = [];
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let i = open; i < s.length; i += 1) {
    const c = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) inString = false;
      continue;
    }
    if (c === '"' || c === "'") { inString = true; quote = c; continue; }
    if (pairs[c]) { stack.push(pairs[c]); continue; }
    if (c === '}' || c === ']') {
      if (stack.pop() !== c) return '';
      if (!stack.length) return s.slice(open, i + 1);
    }
  }
  return '';
}

/**
 * Осторожная починка. «Осторожная» — значит правки, у которых нет второго
 * толкования: типографские кавычки, висячие запятые, одинарные кавычки вокруг
 * ключей и значений без внутренних апострофов. Угадывать больше — значит тихо
 * подменять то, что написала модель, а это хуже честного `ok: false`.
 */
export function repairJson(text) {
  let s = String(text || '');
  s = s.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'");
  s = s.replace(/^﻿/, '');
  // Комментарии // и /* */ вне строк.
  s = stripOutsideStrings(s, /\/\/[^\n]*/g).replace(/\/\*[\s\S]*?\*\//g, '');
  // Одинарные кавычки → двойные, но только если внутри нет ни " ни '.
  s = s.replace(/'([^'"\\\n]*)'/g, '"$1"');
  // Неквотированные ключи: {name: …} → {"name": …}
  s = s.replace(/([{,]\s*)([A-Za-z_][\w-]*)(\s*:)/g, '$1"$2"$3');
  // Висячие запятые.
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s.trim();
}

function stripOutsideStrings(s, re) {
  // Комментарий внутри строки трогать нельзя: адрес «http://…» встречается.
  const parts = s.split(/("(?:[^"\\]|\\.)*")/);
  return parts.map((p, i) => (i % 2 ? p : p.replace(re, ''))).join('');
}

function tryParse(s) {
  if (!s) return undefined;
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Привести разобранное к форме `{subjects, teachers}`. Модель приносит планы в
 * трёх видах: объект с двумя списками, объект-обёртка (`plan`, `result`, `data`)
 * и просто массив предметов с преподавателем внутри. Лишние поля игнорируются
 * молча — за них ругать бессмысленно, они не мешают.
 */
export function shapePlan(data) {
  const errors = [];
  let root = data;
  for (const key of ['plan', 'result', 'data', 'curriculum']) {
    if (root && !Array.isArray(root) && typeof root === 'object' && root[key] && typeof root[key] === 'object') {
      root = root[key];
    }
  }

  const rawSubjects = Array.isArray(root) ? root
    : (root && (firstArray(root, ['subjects', 'courses', 'disciplines']) || []));
  const rawTeachers = Array.isArray(root) ? [] : (root && (firstArray(root, ['teachers', 'staff']) || []));

  if (!Array.isArray(rawSubjects) || !rawSubjects.length) errors.push('no-subjects');

  const teachers = [];
  const byId = new Map();
  const addTeacher = (raw) => {
    if (!raw) return null;
    const src = typeof raw === 'string' ? { name: raw } : raw;
    const name = str(src.name || src.teacher || src.fullName);
    const id = str(src.id) || slugify(name);
    if (!id) return null;
    if (!byId.has(id)) {
      const t = {
        id,
        name: name || id,
        traits: toTraits(src.traits || src.trait || src.character),
        // Душа преподавателя: синонимы — потому что модель любит своё слово.
        ...pickText(src, 'post', ['post', 'position', 'role']),
        ...pickText(src, 'likes', ['likes', 'loves', 'like']),
        ...pickText(src, 'secret', ['secret', 'secrets']),
      };
      byId.set(id, t);
      teachers.push(t);
    } else if (name && !byId.get(id).name) {
      byId.get(id).name = name;
    }
    return id;
  };

  for (const raw of Array.isArray(rawTeachers) ? rawTeachers : []) addTeacher(raw);

  const subjects = (Array.isArray(rawSubjects) ? rawSubjects : []).map((raw) => {
    const src = typeof raw === 'string' ? { name: raw } : (raw || {});
    const name = str(src.name || src.title || src.subject);
    const id = str(src.id) || slugify(name);
    const teacherId = str(src.teacherId || src.teacher_id)
      || (src.teacher ? addTeacher(src.teacher) : '')
      || '';
    return { id, name, teacherId: teacherId || null, grades: [], debt: false };
  });

  return { plan: { subjects, teachers }, errors };
}

/** `{[key]: строка}` из первого непустого синонима или `{}`; обрезка — в `validatePlan`. */
function pickText(src, key, names) {
  for (const n of names) {
    const v = Array.isArray(src[n]) ? src[n].map(str).filter(Boolean).join(', ') : str(src[n]);
    if (v) return { [key]: v };
  }
  return {};
}

function firstArray(obj, keys) {
  for (const k of keys) if (Array.isArray(obj[k])) return obj[k];
  return null;
}

function toTraits(v) {
  if (Array.isArray(v)) return v.map(str).filter(Boolean);
  const s = str(v);
  if (!s) return [];
  return s.split(/[,;]/).map((x) => x.trim()).filter(Boolean);
}

// --- проверка ---------------------------------------------------------------

/**
 * Схема из 3.6. Возвращает вычищенный план и список претензий.
 *
 * `ok` — «с этим можно работать», а не «придраться не к чему»: обрезка до
 * потолка и предмет без преподавателя оставляют `ok: true` с записью в `errors`,
 * потому что таблица всё равно откроется человеку. `ok: false` бывает, только
 * если после чистки не осталось ни одного годного предмета.
 */
export function validatePlan(plan, preset) {
  const errors = [];
  const inSubjects = Array.isArray(plan && plan.subjects) ? plan.subjects : [];
  const inTeachers = Array.isArray(plan && plan.teachers) ? plan.teachers : [];

  // Преподаватели: пустое имя — брак, дубль id — брак, потолок — обрезка.
  const teachers = [];
  const teacherIds = new Set();
  for (const raw of inTeachers) {
    const id = str(raw && raw.id) || slugify(str(raw && raw.name));
    const name = str(raw && raw.name);
    if (!name) { errors.push(`teacher-empty-name:${id || '?'}`); continue; }
    if (!id) { errors.push(`teacher-no-id:${name}`); continue; }
    if (teacherIds.has(id)) { errors.push(`teacher-duplicate-id:${id}`); continue; }
    teacherIds.add(id);
    let traits = toTraits(raw && raw.traits);
    if (traits.length > maxTraits(preset)) {
      errors.push(`teacher-too-many-traits:${id}`);
      traits = traits.slice(0, maxTraits(preset));
    }
    if (traits.length < minTraits(preset)) errors.push(`teacher-no-traits:${id}`);
    // Должность, «любит», тайна — той же нормализацией, что держит состояние:
    // одна строка, потолок длины, пустое — ключа нет. Отсутствие — не брак.
    teachers.push({ id, name, traits, ...teacherDetails(raw), relation: numberOr(raw && raw.relation, undefined) });
  }
  if (teachers.length > planTeachers(preset)) {
    errors.push(`too-many-teachers:${teachers.length}`);
    teachers.length = planTeachers(preset);
  }
  const kept = new Set(teachers.map((t) => t.id));
  for (const t of teachers) if (t.relation === undefined) delete t.relation;

  // Предметы: то же самое плюс ссылка на живого преподавателя.
  const subjects = [];
  const subjectIds = new Set();
  for (const raw of inSubjects) {
    const name = str(raw && raw.name);
    const id = str(raw && raw.id) || slugify(name);
    if (!name) { errors.push(`subject-empty-name:${id || '?'}`); continue; }
    if (!id) { errors.push(`subject-no-id:${name}`); continue; }
    if (subjectIds.has(id)) { errors.push(`subject-duplicate-id:${id}`); continue; }
    subjectIds.add(id);
    let teacherId = str(raw && raw.teacherId) || '';
    if (teacherId && !kept.has(teacherId)) {
      errors.push(`subject-unknown-teacher:${id}`);
      teacherId = '';
    }
    if (!teacherId) errors.push(`subject-no-teacher:${id}`);
    subjects.push({
      id,
      name,
      teacherId: teacherId || null,
      grades: Array.isArray(raw && raw.grades) ? raw.grades : [],
      debt: Boolean(raw && raw.debt),
    });
  }
  if (subjects.length > maxSubjects(preset)) {
    errors.push(`too-many-subjects:${subjects.length}`);
    subjects.length = maxSubjects(preset);
  }
  // Один-три предмета на преподавателя — просьба промпта, а не схема: лишний
  // предмет у одного — замечание, таблица всё равно откроется человеку.
  for (const t of teachers) {
    const count = subjects.filter((s) => s.teacherId === t.id).length;
    if (count > maxSubjectsPerTeacher(preset)) errors.push(`teacher-many-subjects:${t.id}`);
  }

  return { ok: subjects.length > 0, errors, plan: { subjects, teachers } };
}

// --- короткий латинский id --------------------------------------------------

/**
 * Таблица транслитерации — данные, а не логика: латиница на выходе нужна
 * механике метки, а не сеттингу. Для остальных алфавитов работает разложение
 * NFD со снятием диакритики; что не свелось к латинице, заменяется кодом
 * символа, лишь бы id остался коротким, устойчивым и без пробелов.
 */
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

/** Запасной префикс id: латиница, не слово сеттинга. */
const ID_FALLBACK = 'id';

/**
 * Короткий латинский идентификатор из названия. Поправка 1 замера B: в метке
 * стоит `grade=chemistry:4`, значения с пробелами модель ломает.
 */
export function slugify(name, opts = {}) {
  const max = intOr(opts.maxLength, DEFAULTS.maxIdLength);
  const src = String(name == null ? '' : name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let out = '';
  // Диакритика снята разложением NFD: класс ниже — комбинирующие знаки U+0300..U+036F.
  for (const ch of src) {
    if (/[a-z0-9]/.test(ch)) out += ch;
    else if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
    else if (/[\s\-_/.]/.test(ch)) out += '-';
    else if (ch.charCodeAt(0) > 0x7f) out += ch.codePointAt(0).toString(36);
  }
  out = out.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, max).replace(/-+$/g, '');
  return out || ID_FALLBACK;
}

// --- мелочи -----------------------------------------------------------------

/** Подстановка `{ключ}`; неизвестные ключи остаются как есть — их видно в отладке. */
export function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

const str = (v) => (v == null ? '' : String(v)).trim();

function intOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : fallback;
}

function numberOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

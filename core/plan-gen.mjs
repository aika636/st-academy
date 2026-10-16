import { presetGender } from './gender.mjs';
import { teacherDetails, cleanProfile } from './state.mjs';
import { normalizeLooks } from './portraits.mjs';
import { CANON_VOCAB_KEYS, cleanCanonVocab } from './canon-vocab.mjs';
import { subjectVars } from './words.mjs';

export const DEFAULTS = {
  maxSubjects: 8,
  maxTeachers: 8,
  planTeachers: 4,
  maxSubjectsPerTeacher: 3,
  minTraits: 1,
  maxTraits: 2,
  maxIdLength: 24,
};

export const DEFAULT_PROMPT = {
  system: 'Ты составляешь учебный план для ролевой игры. Отвечай одним объектом JSON и ничем больше: без пояснений, без markdown, без комментариев.',
  user: [
    'Составь учебный план.',
    'Эпоха: {era}. Страна: {country}. Тип заведения: {institution}. Направление: {faculty}. Курс: {year}. Язык названий и имён: {lang}.',
    'Не больше {maxSubjects} ({subjectGenPlural}), преподавателей не больше {maxTeachers}: их мало, зато у каждого есть душа.',
    'У каждой позиции списка ({subjectGenPlural}) ровно один преподаватель; каждый преподаватель ведёт от одной до {maxSubjectsPerTeacher} позиций. У преподавателя имя в традиции страны и одна-две черты характера, из которых может вырасти конфликт («злопамятен», «придирается к опозданиям»).',
    'У каждого преподавателя ещё три поля: post — должность в заведении помимо ({subjectGenPlural}) («директор», «заведующая кафедрой», «куратор общежития»), до 60 символов; likes — что любит, зацепка для сцены («белое вино и дорогие картины»), до 120 символов; secret — тайна, которой героиня не знает и которая может всплыть в сюжете («влюблён в коллегу», «скрывает долги»), до 160 символов.',
    'Поле id — короткий латинский идентификатор без пробелов, поле name — полное название на языке {lang}.',
    'Формат ответа:',
    '{"subjects":[{"id":"chemistry","name":"…","teacherId":"petrova"}],"teachers":[{"id":"petrova","name":"…","traits":["…"],"post":"…","likes":"…","secret":"…"}]}',
  ].join('\n'),
};

export const CANON_PROMPT = [
  'Мир игры — канон: {canon}. Это известное произведение; бери его людей.',
  'Преподаватели и их должности — канонические, ровно на этот курс и учебный год ({year}; {era}): кто в каноне вёл ({subjectAcc}) в тот год, тот и ведёт. Названия ({subjectGenPlural}) — канонические.',
  'Имена — в том русском переводе, каким ты их обычно пишешь; другие написания (второй перевод, оригинал латиницей) — в поле aliases.',
  'Характер, внешность, должность и «что любит» — по канону; тайна — каноническая или пустая строка, если канон её не даёт.',
  'Канонические события этого года идут фоном вокруг {hero}; не перекраивай их под неё.',
  'Новых людей придумывай только там, где канон молчит, — у них canon: false, и правила об именах выше относятся только к ним. Знаешь канон плохо — не выдумывай «канонических» людей.',
  'У каждого преподавателя ещё два поля: canon — true, если человек из канона; aliases — массив других написаний имени, может быть пустым. Пример: {"id":"…","name":"…","canon":true,"aliases":["…"],"traits":["…"]}',
].join('\n');

export const LOOKS_PROMPT = 'Ещё у каждого преподавателя поле looks — короткая внешность для портрета, под характер: начни с того, кто это и сколько лет на вид, дальше волосы, лицо, одежда или примета («женщина за шестьдесят, сухая, седой пучок, очки на цепочке, строгий серый костюм»), до 160 символов, в роде преподавателя, без имени и должности.';

export const PROFILE_PROMPT = 'Ещё у позиций списка ({subjectGenPlural}) необязательное поле profile — по характеру и прошлому {hero}: у одной-двух позиций "strong" (даётся легко, душа лежит), у одной-двух "hard" (даётся с трудом); у остальных поля нет вовсе.';

export { CANON_VOCAB_KEYS, cleanCanonVocab };

function canonVocabBlock(preset, male) {
  const v = (preset && preset.vocab) || {};
  const pick = (x) => (x && typeof x === 'object' ? (male ? x.male : x.female) : x);
  const sample = {};
  for (const k of CANON_VOCAB_KEYS) sample[k] = str(pick(v[k]));
  return [
    `Ещё поле vocab — слова мира: как в этом каноне зовутся понятия, которые в игре названы так (значения ниже — образец смысла, а не ответ): ${JSON.stringify(sample)}.`,
    `Верни vocab с теми же ключами и каноническими словами этого мира; expelled — в роде ${male ? 'героя' : 'героини'}, warnInject и expelInject — по одной фразе в роде ${male ? 'героя' : 'героини'}, события в духе канона. Нет аналога в каноне — пустая строка. score — название среднего балла успеваемости, а не баллы факультета или дома.`,
  ].join('\n');
}

const limitsOf = (preset) => (preset && preset.limits) || {};
const maxSubjects = (preset) => intOr(limitsOf(preset).maxSubjects, DEFAULTS.maxSubjects);
const maxTeachers = (preset) => intOr(limitsOf(preset).maxTeachers, DEFAULTS.maxTeachers);
const planTeachers = (preset) => Math.min(
  intOr(limitsOf(preset).planTeachers, DEFAULTS.planTeachers), maxTeachers(preset));
const maxSubjectsPerTeacher = (preset) => intOr(limitsOf(preset).maxSubjectsPerTeacher, DEFAULTS.maxSubjectsPerTeacher);
const minTraits = (preset) => intOr(limitsOf(preset).minTraits, DEFAULTS.minTraits);
const maxTraits = (preset) => intOr(limitsOf(preset).maxTraits, DEFAULTS.maxTraits);

export function buildPlanPrompt(survey, preset, opts = {}) {
  const male = presetGender(preset) === 'm';
  const tpl = {
    ...DEFAULT_PROMPT,
    ...(male ? { user: DEFAULT_PROMPT.user.replace('тайна, которой героиня не знает', 'тайна, которой герой не знает') } : {}),
    ...((preset && preset.prompts && preset.prompts.plan) || {}),
  };
  const s = survey || {};
  const canon = str(s.canon);
  const original = typeof tpl.original === 'string' && tpl.original.trim() ? tpl.original : '';
  const vars = {
    era: str(s.era), country: str(s.country), institution: str(s.institution),
    faculty: str(s.faculty), year: str(s.year), canon,
    original: canon ? '' : original,
    lang: str(s.lang) || str(preset && preset.lang),
    maxSubjects: String(maxSubjects(preset)),
    maxTeachers: String(planTeachers(preset)),
    maxSubjectsPerTeacher: String(maxSubjectsPerTeacher(preset)),
    ...subjectVars(preset),
  };
  let prompt = fill(tpl.user, vars);
  if (original) {
    if (String(tpl.user).includes('{original}')) {
      prompt = prompt.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    } else if (!canon) {
      prompt = `${prompt}\n${original.trim()}`;
    }
  }
  const looks = typeof tpl.looks === 'string' ? tpl.looks.trim() : LOOKS_PROMPT;
  if (looks && !String(tpl.user).includes('looks')) prompt = `${prompt}\n${fill(looks, vars)}`;
  const profile = typeof tpl.profile === 'string' ? tpl.profile.trim() : PROFILE_PROMPT;
  if (profile && !String(tpl.user).includes('profile')) prompt = `${prompt}
${fill(profile, { ...vars, hero: male ? 'героя' : 'героини' })}`;
  if (canon) {
    const block = (preset && preset.prompts && preset.prompts.plan && str(preset.prompts.plan.canon))
      ? String(preset.prompts.plan.canon)
      : (male ? CANON_PROMPT.replace('под неё', 'под него') : CANON_PROMPT);
    prompt = `${prompt}\n${fill(block, { ...vars, hero: male ? 'героя' : 'героини' })}\n${canonVocabBlock(preset, male)}`;
  }
  const lore = str(opts && opts.lore);
  if (lore) prompt = `${prompt}
${lore}
Если среди людей книги мира есть преподаватели этого заведения — ставь их наставниками с их именами, должностями и внешностью из книги; у них canon: false.`;
  return { system: fill(tpl.system, vars), prompt };
}

export function parsePlanResponse(text, preset, opts = {}) {
  const raw = typeof text === 'string' ? text : String(text == null ? '' : text);
  let data = extractJson(raw);
  let partial = false;
  if (data === undefined && opts.salvage === true) {
    data = salvageJson(raw);
    partial = data !== undefined;
  }
  if (data === undefined) {
    return { ok: false, plan: { subjects: [], teachers: [] }, errors: ['no-json'], raw };
  }
  const shaped = shapePlan(data);
  const checked = validatePlan(shaped.plan, preset);
  if (!str(opts.canon)) for (const t of checked.plan.teachers) delete t.canon;
  return {
    ok: checked.ok, plan: checked.plan, errors: [...shaped.errors, ...checked.errors], raw,
    ...(partial ? { partial: true } : {}),
  };
}

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
      if (!stack.length) return undefined;
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
  const fences = [...s.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g)].map((m) => m[1].trim());
  for (const f of fences) yield f;
  const source = fences.length ? [s, ...fences] : [s];
  for (const src of source) {
    const block = balancedBlock(src);
    if (block) yield block;
  }
}

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

export function repairJson(text) {
  let s = String(text || '');
  s = s.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'");
  s = s.replace(/^﻿/, '');
  s = stripOutsideStrings(s, /\/\/[^\n]*/g).replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/'([^'"\\\n]*)'/g, '"$1"');
  s = s.replace(/([{,]\s*)([A-Za-z_][\w-]*)(\s*:)/g, '$1"$2"$3');
  s = s.replace(/,\s*([}\]])/g, '$1');
  return s.trim();
}

function stripOutsideStrings(s, re) {
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
        ...pickText(src, 'post', ['post', 'position', 'role']),
        ...pickText(src, 'likes', ['likes', 'loves', 'like']),
        ...pickText(src, 'secret', ['secret', 'secrets']),
        ...pickText(src, 'looks', ['looks', 'appearance', 'look', 'внешность']),
        ...pickCanon(src),
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
    const profile = cleanProfile(src.profile);
    return { id, name, teacherId: teacherId || null, ...(profile ? { profile } : {}), grades: [], debt: false };
  });

  const vocab = cleanCanonVocab(root && !Array.isArray(root) ? root.vocab : null);
  return { plan: { subjects, teachers, ...(Object.keys(vocab).length ? { vocab } : {}) }, errors };
}

function pickText(src, key, names) {
  for (const n of names) {
    const v = Array.isArray(src[n]) ? src[n].map(str).filter(Boolean).join(', ') : str(src[n]);
    if (v) return { [key]: v };
  }
  return {};
}

function pickCanon(src) {
  const out = {};
  for (const n of ['canon', 'canonical', 'isCanon']) {
    const v = src[n];
    if (v === true || (typeof v === 'string' && /^(true|да|yes)$/i.test(v.trim()))) { out.canon = true; break; }
  }
  for (const n of ['aliases', 'alias', 'altNames', 'otherNames']) {
    const v = src[n];
    if (Array.isArray(v) ? v.length : str(v)) { out.aliases = v; break; }
  }
  return out;
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

export function validatePlan(plan, preset) {
  const errors = [];
  const inSubjects = Array.isArray(plan && plan.subjects) ? plan.subjects : [];
  const inTeachers = Array.isArray(plan && plan.teachers) ? plan.teachers : [];

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
    const looks = normalizeLooks(raw && raw.looks);
    teachers.push({ id, name, traits, ...teacherDetails(raw), ...(looks ? { looks } : {}), relation: numberOr(raw && raw.relation, undefined) });
  }
  if (teachers.length > planTeachers(preset)) {
    errors.push(`too-many-teachers:${teachers.length}`);
    teachers.length = planTeachers(preset);
  }
  const kept = new Set(teachers.map((t) => t.id));
  for (const t of teachers) if (t.relation === undefined) delete t.relation;

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
      ...(cleanProfile(raw && raw.profile) ? { profile: cleanProfile(raw.profile) } : {}),
      grades: Array.isArray(raw && raw.grades) ? raw.grades : [],
      debt: Boolean(raw && raw.debt),
    });
  }
  if (subjects.length > maxSubjects(preset)) {
    errors.push(`too-many-subjects:${subjects.length}`);
    subjects.length = maxSubjects(preset);
  }
  for (const t of teachers) {
    const count = subjects.filter((s) => s.teacherId === t.id).length;
    if (count > maxSubjectsPerTeacher(preset)) errors.push(`teacher-many-subjects:${t.id}`);
  }

  const vocab = cleanCanonVocab(plan && plan.vocab);
  return { ok: subjects.length > 0, errors, plan: { subjects, teachers, ...(Object.keys(vocab).length ? { vocab } : {}) } };
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
  й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

const ID_FALLBACK = 'id';

export function slugify(name, opts = {}) {
  const max = intOr(opts.maxLength, DEFAULTS.maxIdLength);
  const src = String(name == null ? '' : name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  let out = '';
  for (const ch of src) {
    if (/[a-z0-9]/.test(ch)) out += ch;
    else if (TRANSLIT[ch] !== undefined) out += TRANSLIT[ch];
    else if (/[\s\-_/.]/.test(ch)) out += '-';
    else if (ch.charCodeAt(0) > 0x7f) out += ch.codePointAt(0).toString(36);
  }
  out = out.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, max).replace(/-+$/g, '');
  return out || ID_FALLBACK;
}

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

import { extractJson } from './plan-gen.mjs';
import { presetGender, isGenderedPair } from './gender.mjs';
import { holidaysOf, vacationsOf } from './holidays.mjs';
import { CORE_LABELS, CORE_EXAMPLES } from './core-labels.mjs';
import { subjectWord } from './words.mjs';

const SECTIONS = ['ui', 'labels', 'phrases', 'reputation', 'classmates', 'feed', 'attendance', 'exams', 'week', 'calendar'];
export const TARGETS_MAX = 200;
export const TARGET_LEN_MAX = 300;
const STRING_MAX = 320;
const HOLIDAYS_MAX = 12;
const VACATIONS_MAX = 6;
const REWRITE_MIN_WORDS = 6;
const ALWAYS = [
  'ui.classmatesTitle', 'ui.classmatesNone',
  'ui.teacherNameHint', 'ui.subjectNameHint', 'ui.lorebookNewNameHint', 'ui.cmNameHint', 'ui.cmClubHint', 'ui.cmProblemHint', 'ui.traitsHint', 'ui.cmdShiftPeriods', 'ui.cmdCountArg', 'ui.repairCount', 'ui.repairCountNote', 'phrases.lorebook.chronicleMilestone', 'phrases.lorebook.chronicleExam', 'phrases.lorebook.chronicleWarn', 'phrases.lorebook.chronicleExpel', 'phrases.lorebook.chronicleRelation',
];
const LOCKED = ['ui.teachersTitle'];
const ALWAYS_RE = /^exams\.kinds\.\d+\.name$/;
const VACATION_NAME = /^calendar\.vacations\.\d+\.name$/;
const GLOSSARY_MAX = 6;
const TITLE_MAX = 80;
const GLOSS_TEXT_MAX = 200;
const COMMON_STEMS = new Set(['занят', 'учебн', 'среди', 'между', 'сила', 'дара', 'вызов', 'класс', 'совет', 'полев', 'выход', 'кто']);

const str = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const holes = (s) => [...String(s).matchAll(/\{([A-Za-z_]\w*)\}/g)].map((m) => m[1]).sort().join(',');
const lower = (s) => String(s).toLowerCase().replace(/ё/g, 'е');
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function stemsOf(value, force = false) {
  const out = [];
  for (const w of lower(value).split(/[^\p{L}]+/u)) {
    if (w.length < 4) continue;
    const st = w.slice(0, Math.max(4, w.length - 2));
    if (force || !COMMON_STEMS.has(st)) out.push(st);
  }
  return out;
}

const wordsOfValue = (v) => (isGenderedPair(v) ? [v.female, v.male] : [v]).filter((s) => typeof s === 'string');

function worldMarks(preset, canonVocab) {
  const stems = new Set();
  const phrases = new Set();
  const vocab = isObj(preset.vocab) ? preset.vocab : {};
  const cv = isObj(canonVocab) ? canonVocab : {};
  for (const [k, v] of Object.entries(vocab)) {
    if (/Inject$/.test(k) || /^(?:subject|expelPaths)/.test(k)) continue;
    const changed = typeof cv[k] === 'string' && cv[k].trim() && !wordsOfValue(v).some((s) => lower(s) === lower(cv[k]));
    for (const s of wordsOfValue(v)) stemsOf(s, changed).forEach((x) => stems.add(x));
  }
  if (typeof preset.displayName === 'string') stemsOf(preset.displayName).forEach((x) => stems.add(x));
  for (const k of Object.keys(isObj(preset.glossary) ? preset.glossary : {})) {
    const w = lower(k).trim();
    if (/\s/.test(w)) phrases.add(w);
    else stemsOf(w).forEach((x) => stems.add(x));
  }
  for (const h of Array.isArray(preset.holidays) ? preset.holidays : []) {
    const n = lower(str(h && h.name));
    if (n.length >= 4) phrases.add(n);
  }
  const parts = [...stems].map((s) => `(?<![\\p{L}])${escRe(s)}`);
  for (const p of phrases) parts.push(escRe(p));
  return parts.length ? new RegExp(parts.join('|'), 'u') : null;
}

export function canonLayerTargets(preset, max = TARGETS_MAX, canonVocab = null) {
  const re = preset && typeof preset === 'object' ? worldMarks(preset, canonVocab) : null;
  if (!re) return [];
  const out = [];
  const seen = new Set();
  const own = isObj(preset.ui) ? preset.ui : {};
  for (const [k, def] of Object.entries(CORE_LABELS)) {
    const text = typeof own[k] === 'string' ? own[k] : def;
    seen.add(`ui.${k}`);
    if (text.trim() && text.length <= TARGET_LEN_MAX && (CORE_EXAMPLES.includes(k) || re.test(lower(text)))) out.push({ path: `ui.${k}`, text });
  }
  const visit = (v, path, forced, only) => {
    if (out.length >= max) return;
    if (typeof v === 'string') {
      if (VACATION_NAME.test(path) || seen.has(path) || LOCKED.includes(path)) return;
      if (only ? !forced : !(forced || re.test(lower(v)))) return;
      if (v.length <= TARGET_LEN_MAX && v.trim()) { out.push({ path, text: v }); seen.add(path); }
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${path}.${i}`, forced, only));
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) if (!k.includes('.') && `${path}.${k}` !== 'phrases.bullying' && !/^feed.(?:register|samples|reactions)$/.test(`${path}.${k}`)) visit(x, `${path}.${k}`, forced || ALWAYS.includes(`${path}.${k}`) || ALWAYS_RE.test(`${path}.${k}`), only);
    }
  };
  for (const only of [true, false]) for (const s of SECTIONS) if (preset[s] !== undefined) visit(preset[s], s, false, only);
  return out;
}

export function buildCanonLayerPrompt(targets, { survey = {}, vocab = {}, preset = {}, male = false } = {}) {
  const canon = str(survey.canon);
  const place = str(survey.institution) || str(preset.displayName);
  const strings = {};
  for (const t of targets) strings[t.path] = t.text;
  const words = Object.entries(vocab || {}).filter(([k, v]) => !/Inject$/.test(k) && str(v)).map(([k, v]) => `${k}: ${str(v)}`).join('; ');
  const system = [
    'Ты переписываешь интерфейсные строки ролевого помощника под мир известного произведения. Отвечаешь только JSON, без пояснений и без ```.',
    `Мир — канон: ${canon}.`,
    `Герой${male ? '' : 'иня'} — ${male ? 'мужского' : 'женского'} рода.`,
  ].join('\n');
  const user = [
    `Мир — канон ${canon}. Перепиши строки интерфейса словами этого канона: термины, учреждения, наказания, названия периодов — как в каноне. Меняй только слова мира (термины, названия, учреждения); остальной текст строки оставь дословно, не перефразируй. Длину, падежи и плейсхолдеры вида {n} сохраняй; где строка в каноне и так годится — верни как есть. Исключение — строки-примеры в полях форм (подсказки, «например»): их перепиши настоящим примером из этого канона (имена, ${subjectWord(preset, 'many')}, места), даже если слов мира в них нет. Книгу мира (World Info) называй «книга мира», слово «лорбук» не вводи. Одно понятие называй одним словом во всех строках, включая строки labels и phrases (если «занятий нет» стало «уроков нет», а «седмица круга» — «неделя триместра», так и в остальных).`,
    words ? `Слова мира, уже выбранные для этого канона (держись их): ${words}.` : '',
    `Строки (путь → текст): ${JSON.stringify(strings)}`,
    `Ещё верни: holidays — канонические праздники и события учебного года этого канона (до ${HOLIDAYS_MAX}), каждый {"name":"…","from":"MM-DD","to":"MM-DD","about":"что это","buzz":"фон перед событием","buzzNear":"последние приготовления накануне","today":"фон в этот день"}; только то, что в каноне есть, даты — по канону или по духу учебного года. Перерывы в учёбе (каникулы) в holidays не клади: они — только в vacations, без дублей. vacations — каникулы учебного года канона (до ${VACATIONS_MAX}), каждые {"name":"Зимние каникулы","from":"12-20","to":"01-04"}; если в каноне их нет — пустой список. title — собственное имя заведения в шапке, с заглавной буквы, как оно зовётся в каноне${/^\p{Lu}/u.test(place) ? ` (обычно «${place}»)` : ''}; описание вроде «школа чародейства» именем не считается. glossary — до ${GLOSSARY_MAX} терминов канона с пояснением в одну строку: {"термин":"пояснение"}.`,
    'Формат ответа: {"strings":{"путь":"текст"},"holidays":[{"name":"Праздник урожая","from":"09-21","to":"09-22","about":"…","buzz":"…","buzzNear":"…","today":"…"}],"title":"…","glossary":{"термин":"…"},"vacations":[{"name":"Осенние каникулы","from":"10-26","to":"11-01"}]}',
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

function cleanHolidays(raw) {
  const rows = (Array.isArray(raw) ? raw : []).filter((h) => isObj(h)).slice(0, HOLIDAYS_MAX * 2);
  const out = [];
  const seen = new Set();
  for (const h of holidaysOf({ holidays: rows })) {
    const slug = lower(h.name).replace(/[^a-zа-я0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'event';
    let id = `canon-${slug}-${h.from.replace('-', '')}`;
    for (let n = 2; seen.has(id); n += 1) id = `canon-${slug}-${h.from.replace('-', '')}-${n}`;
    seen.add(id);
    out.push({ id, name: h.name, from: h.from, to: h.to, lead: h.lead, about: h.about, buzz: h.buzz, buzzNear: h.buzzNear, today: h.today });
    if (out.length >= HOLIDAYS_MAX) break;
  }
  return out;
}

const isMD = (v) => typeof v === 'string' && /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v);
const mdNum = (v) => Number(v.slice(0, 2)) * 100 + Number(v.slice(3));
const spanHas = (a, x) => (mdNum(a.from) <= mdNum(a.to) ? x >= mdNum(a.from) && x <= mdNum(a.to) : x >= mdNum(a.from) || x <= mdNum(a.to));
const overlaps = (a, b) => spanHas(a, mdNum(b.from)) || spanHas(b, mdNum(a.from));

function cleanVacations(raw) {
  const rows = (Array.isArray(raw) ? raw : []).slice(0, VACATIONS_MAX);
  if (!rows.length || rows.some((v) => !isObj(v) || !isMD(v.from) || !isMD(v.to))) return [];
  return vacationsOf({ calendar: { vacations: rows } }).map((v) => ({ name: v.name, from: v.from, to: v.to }));
}

function dupesVacation(h, vacations) {
  return vacations.some((v) => lower(h.name) === lower(v.name) || (/каникул/.test(lower(h.name)) && overlaps(h, v)));
}

function cleanGlossary(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    const key = str(k).slice(0, 60);
    const text = str(v).slice(0, GLOSS_TEXT_MAX);
    if (key && text && Object.keys(out).length < GLOSSARY_MAX) out[key] = text;
  }
  return out;
}

export function cleanCanonLayer(v) {
  const out = {};
  if (!isObj(v)) return out;
  const ui = {};
  if (isObj(v.ui)) {
    for (const [path, text] of Object.entries(v.ui)) {
      const s = str(text).slice(0, STRING_MAX);
      if (s && typeof path === 'string' && path.length <= 160) ui[path] = s;
    }
  }
  if (Object.keys(ui).length) out.ui = ui;
  if (isObj(v.from)) {
    const from = {};
    for (const [path, h] of Object.entries(v.from)) if (path in ui && typeof h === 'string' && h.length <= 16) from[path] = h;
    if (Object.keys(from).length) out.from = from;
  }
  const vacations = cleanVacations(v.vacations);
  if (vacations.length) out.vacations = vacations;
  const holidays = cleanHolidays(v.holidays).filter((h) => !dupesVacation(h, vacations));
  if (holidays.length) out.holidays = holidays;
  const title = str(v.title).slice(0, TITLE_MAX);
  if (title) out.title = title;
  const glossary = cleanGlossary(v.glossary);
  if (Object.keys(glossary).length) out.glossary = glossary;
  return out;
}

const sig = (s) => {
  let h = 0;
  for (const ch of String(s)) h = (Math.imul(31, h) + ch.codePointAt(0)) | 0;
  return (h >>> 0).toString(36);
};

const wordsOf = (s) => lower(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function rewritten(orig, next) {
  const a = wordsOf(orig);
  if (a.length < REWRITE_MIN_WORDS) return false;
  const b = wordsOf(next);
  const pool = new Map();
  for (const w of a) pool.set(w, (pool.get(w) || 0) + 1);
  let common = 0;
  for (const w of b) if (pool.get(w) > 0) { common += 1; pool.set(w, pool.get(w) - 1); }
  return common / Math.max(a.length, b.length) < 0.5;
}

export function parseCanonLayer(text, targets) {
  const data = typeof text === 'string' ? extractJson(text) : text;
  if (!isObj(data)) return null;
  const src = isObj(data.strings) ? data.strings : isObj(data.ui) ? data.ui : {};
  const known = new Map((targets || []).map((t) => [t.path, t.text]));
  const ui = {};
  const from = {};
  for (const [path, v] of Object.entries(src)) {
    if (!known.has(path)) continue;
    const s = str(v).slice(0, STRING_MAX);
    if (!s || holes(s) !== holes(known.get(path)) || rewritten(known.get(path), s)) continue;
    if (s !== str(known.get(path))) { ui[path] = s; from[path] = sig(known.get(path)); }
  }
  return cleanCanonLayer({ ui, from, holidays: data.holidays, vacations: data.vacations, title: data.title, glossary: data.glossary });
}

function setPath(root, path, text) {
  const keys = path.split('.');
  const nodes = [root];
  for (const k of keys) {
    const node = nodes[nodes.length - 1];
    if (node === null || typeof node !== 'object' || !(k in node)) return root;
    nodes.push(node[k]);
  }
  if (typeof nodes[keys.length] !== 'string') return root;
  let value = text;
  for (let i = keys.length - 1; i >= 0; i -= 1) {
    const copy = Array.isArray(nodes[i]) ? nodes[i].slice() : { ...nodes[i] };
    copy[keys[i]] = value;
    value = copy;
  }
  return value;
}

function applyOne(root, path, text, gender) {
  const keys = path.split('.');
  const end = keys[keys.length - 1];
  if (end !== 'female' && end !== 'male') return setPath(root, path, text);
  const direct = setPath(root, path, text);
  if (direct !== root) return direct;
  if (end !== (gender === 'm' ? 'male' : 'female')) return root;
  return setPath(root, keys.slice(0, -1).join('.'), text);
}

function textAt(preset, path) {
  let node = preset;
  for (const k of path.split('.')) node = node !== null && typeof node === 'object' ? node[k] : undefined;
  if (typeof node === 'string') return node;
  const core = /^ui\.(\w+)$/.exec(path);
  return core && core[1] in CORE_LABELS ? CORE_LABELS[core[1]] : null;
}

export function withCanonLayer(preset, state) {
  const layer = state && state.canonLayer;
  if (!preset || !isObj(layer) || !Object.keys(layer).length) return preset;
  if (!state.survey || !str(state.survey.canon)) return preset;
  const gender = presetGender(preset);
  let out = preset;
  for (const [path, text] of Object.entries(layer.ui || {})) {
    if (VACATION_NAME.test(path) || LOCKED.includes(path)) continue;
    const was = layer.from && layer.from[path];
    if (was && textAt(preset, path) !== null && sig(textAt(preset, path)) !== was) continue;
    const core = /^ui\.(\w+)$/.exec(path);
    if (core && core[1] in CORE_LABELS && !(isObj(out.ui) && typeof out.ui[core[1]] === 'string')) out = { ...out, ui: { ...(out.ui || {}), [core[1]]: text } };
    else out = applyOne(out, path, text, gender);
  }
  if (Array.isArray(layer.holidays) && layer.holidays.length) out = { ...out, holidays: layer.holidays };
  if (Array.isArray(layer.vacations) && layer.vacations.length) out = { ...out, calendar: { ...(out.calendar || {}), vacations: layer.vacations } };
  const named = (v) => /^\p{Lu}/u.test(str(v));
  const title = [str(state.survey.institution), str(layer.title)].find(named);
  if (title) out = { ...out, displayName: title };
  if (layer.glossary && Object.keys(layer.glossary).length) out = { ...out, glossary: layer.glossary };
  return out;
}

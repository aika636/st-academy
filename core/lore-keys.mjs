import { COMMON_NAME_WORDS } from './stop-names.mjs';

export const MAX_KEYS = 15;
export const MIN_STEM = 4;

const CYR = 'А-Яа-яЁё';
const LEFT = `(?<![${CYR}])`;
const RIGHT = `(?![${CYR}])`;
const TAIL = `[${CYR}]*`;

export const FREQUENT_WORDS = [
  'мир', 'мира', 'миру', 'миром', 'мире', 'мирный', 'мирная', 'мирные', 'друг', 'друга', 'другу', 'другом', 'друге', 'друзья', 'друзей',
  'студент', 'студента', 'студентка', 'студенты', 'магия', 'магии', 'магию', 'магией', 'день', 'дня', 'дню', 'днём', 'дни', 'время', 'времени',
  'ночь', 'утро', 'вечер', 'год', 'года', 'люди', 'людей', 'человек', 'человека', 'женщина', 'мужчина', 'девушка', 'парень', 'мальчик', 'девочка',
  'учитель', 'ученик', 'ученица', 'класс', 'урок', 'занятие', 'пара', 'круг', 'группа', 'курс', 'школа', 'школы', 'академия', 'академии',
  'университет', 'институт', 'колледж', 'комната', 'дом', 'дома', 'дверь', 'окно', 'рука', 'руки', 'глаза', 'голова', 'слово', 'слова', 'дело', 'дела',
  'жизнь', 'город', 'место', 'места', 'вопрос', 'ответ', 'правда', 'любовь', 'вера', 'надежда', 'воля', 'сила', 'свет', 'тень', 'огонь', 'вода',
  'земля', 'небо', 'звезда', 'искра', 'сорока', 'топот', 'топор', 'ворон', 'волк', 'лиса', 'кот', 'кошка', 'тихий', 'злой', 'добрый', 'старый', 'новый',
  'большой', 'первый', 'второй', 'последний', 'король', 'королева', 'принц', 'герой', 'рыцарь', 'мастер', 'магистр', 'директор', 'декан', 'ректор',
  'роза', 'лилия', 'ветер', 'гром', 'буря', 'ночи', 'зима', 'лето', 'весна', 'осень', 'камень', 'железо', 'золото', 'серебро',
  'the', 'school', 'teacher', 'student', 'friend', 'world', 'magic', 'day', 'time', 'girl', 'boy', 'man', 'woman', 'lord', 'lady', 'king', 'queen',
  'wolf', 'fox', 'shadow', 'light', 'fire', 'dark', 'stone', 'house', 'master', 'professor', 'doctor', 'mister', 'headmaster', 'director', 'dean',
  'room', 'class', 'book', 'night', 'morning', 'love', 'hope', 'faith', 'grace', 'rose', 'ivy', 'mark', 'will', 'hunter', 'baker', 'spark', 'magpie',
];

export const GENERIC_STEMS = [
  'заняти', 'лекци', 'экзамен', 'оценк', 'высш', 'отличн', 'класс', 'учебн', 'семестр', 'испытани', 'барьер', 'триместр',
  'после', 'перед', 'перерыв', 'против', 'публичн', 'вместе', 'опять', 'снова', 'только', 'сегодня', 'вчера', 'студент', 'препода', 'школь', 'ученик', 'ученица', 'учитель',
];

export const GENERIC_EXACT = new Set([
  'зачет', 'зачета', 'зачету', 'зачетом', 'зачете', 'зачеты', 'урок', 'урока', 'уроки', 'уроку', 'уроком', 'уроке', 'уроков', 'балл', 'балла', 'баллы', 'баллов', 'пара', 'пары', 'пару', 'парой', 'паре', 'пар', 'до', 'на', 'за', 'по', 'от', 'из',
  'after', 'before', 'class', 'classes', 'lesson', 'lessons', 'lecture', 'exam', 'exams', 'test', 'study', 'top', 'high', 'highest', 'best', 'mark', 'marks',
  'grade', 'grades', 'score', 'barrier', 'barriers', 'student', 'students', 'teacher', 'school', 'and', 'with', 'the', 'of', 'in', 'to', 'for', 'at',
]);

const GENERIC_ALONE = new Set(['долг', 'долги', 'долга', 'долгу', 'долгом', 'долге']);

const genericWord = (w) => GENERIC_EXACT.has(w) || GENERIC_STEMS.some((g) => w.startsWith(g)) || FREQUENT_WORDS.includes(w);

export function isGeneric(text) {
  const words = flat(text).split(/[^\p{L}]+/u).filter(Boolean);
  if (words.length === 1 && GENERIC_ALONE.has(words[0])) return true;
  return words.length > 0 && words.every(genericWord);
}

export const ROLE_WORDS = new Set([
  'магистр', 'архивариус', 'комендант', 'хранитель', 'хранительница', 'декан', 'ректор', 'проректор', 'куратор', 'наставник', 'наставница',
  'преподаватель', 'преподавательница', 'завуч', 'смотритель', 'библиотекарь', 'лаборант', 'ассистент', 'аспирант', 'инспектор', 'страж',
  'командир', 'лейтенант', 'сержант', 'генерал', 'адмирал', 'жрец', 'жрица', 'настоятель', 'старейшина', 'сенсей', 'сэнсэй', 'шифу', 'ректорат',
  'headmaster', 'headmistress', 'dean', 'rector', 'archivist', 'librarian', 'warden', 'curator', 'instructor', 'lecturer', 'commander', 'captain',
  'lieutenant', 'sergeant', 'sensei', 'chancellor', 'principal', 'coach', 'tutor', 'keeper', 'magister',
]);

const flat = (s) => String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е');
const lettersOf = (s) => String(s || '').replace(/[^\p{L}]/gu, '');
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/\s+/g, '\\s+');
const cyrWord = (w) => /^[А-Яа-яЁё]+(?:-[А-Яа-яЁё]+)*$/.test(w);
const latWord = (w) => /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/.test(w);

export const asKey = (body) => `/${body}/i`;

function bareWord(word, roles) {
  const w = flat(word);
  return COMMON_NAME_WORDS.has(w) || ROLE_WORDS.has(w) || (roles && roles.has(w));
}

export function ruStem(word) {
  const w = String(word || '');
  if (!cyrWord(w) || w.includes('-')) return null;
  if (w.length >= 6 && /(?:ый|ий|ой|ая|яя|ое|ее|ые|ие)$/i.test(w)) return w.slice(0, -2);
  const last = flat(w).slice(-1);
  if ('бвгджзклмнпрстфхцчшщ'.includes(last)) return w;
  if ('йьаяъ'.includes(last)) return w.slice(0, -1);
  return null;
}

function variant(lang, body, text, forms, extra = {}) {
  return { lang, body, text: flat(text), forms, ...extra };
}

function ruWord(word) {
  const stem = ruStem(word);
  if (stem && lettersOf(stem).length >= MIN_STEM) return variant('ru', `${LEFT}${esc(stem)}${TAIL}`, stem, [word], { single: true, stem: true });
  if (lettersOf(word).length < 3) return null;
  return variant('ru', `${LEFT}${esc(word)}${RIGHT}`, word, [word], { single: true });
}

function ruPhrase(words, loose = false) {
  const parts = words.map((w) => {
    const stem = ruStem(w);
    if (stem && lettersOf(stem).length >= 3) return { body: `${esc(stem)}${TAIL}`, open: true };
    if (loose && lettersOf(w).length >= 5) return { body: `${esc(w)}[${CYR}]{0,3}`, open: true };
    return { body: esc(w), open: false };
  });
  const last = parts[parts.length - 1];
  const body = `${LEFT}${parts.map((p) => p.body).join('\\s+')}${last.open ? '' : RIGHT}`;
  return variant('ru', body, words.join(' '), [words.join(' ')]);
}

function enVariant(text) {
  const t = String(text).trim().replace(/\s+/g, ' ');
  return variant('en', esc(t), t, [t], { single: !t.includes(' ') });
}

export function checkVariant(v, { frequent = true, generic = true } = {}) {
  if (!v) return false;
  let re;
  try {
    re = new RegExp(v.lang === 'en' ? `\\b(?:${v.body})\\b` : v.body, 'i');
  } catch {
    return false;
  }
  if (!v.forms.length || !v.forms.every((f) => re.test(f))) return false;
  if (frequent && v.single && FREQUENT_WORDS.some((w) => re.test(w))) return false;
  if (frequent && generic && isGeneric(v.text)) return false;
  return true;
}

function wordOk(word, roles) {
  return lettersOf(word).length >= 3 && !bareWord(word, roles);
}

const PATRONYMIC = /(?:ович|евич|ьич|овна|евна|ична|инична)$/i;

function middleOf(words) {
  return words.length >= 3 && !PATRONYMIC.test(words[words.length - 1]) ? words.slice(1, -1) : [];
}

export function nameVariants(name, ctx = {}) {
  const clean = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/["«»“”]/g, ' ').replace(/\s+/g, ' ').trim();
  if (lettersOf(clean).length < 3) return [];
  const words = clean.split(' ').filter(Boolean);
  const roles = ctx.roleWords;
  const out = [];
  const add = (v) => { if (checkVariant(v, { generic: false })) out.push(v); };
  const scripted = (ws) => {
    if (ws.every(cyrWord)) return ws.length === 1 ? ruWord(ws[0]) : ruPhrase(ws);
    if (ws.every(latWord)) return enVariant(ws.join(' '));
    return null;
  };
  if (words.length === 1) {
    if (wordOk(words[0], roles)) add(scripted(words));
    return out;
  }
  add(scripted(words));
  let at = 0;
  while (at < words.length - 1 && bareWord(words[at], roles)) at += 1;
  if (at > 0) add(scripted(words.slice(at)));
  const rest = words.slice(at);
  const middle = middleOf(rest);
  for (const w of rest) if (!middle.includes(w) && wordOk(w, roles)) add(scripted([w]));
  return out;
}

const NICKNAME_WORDS = new Set(['who', 'which', 'that', 'of', 'and', 'который', 'которая', 'которое', 'которые', 'из', 'без']);

const isNicknamePhrase = (a) => /[,;]/.test(a) || a.toLowerCase().split(/[\s-]+/).some((w) => NICKNAME_WORDS.has(w));

function personVariants(spec, ctx) {
  const all = [spec.name, ...(spec.aliases || []).filter((a) => typeof a === 'string' && !isNicknamePhrase(a))].filter((n) => typeof n === 'string');
  const middle = new Set(all.flatMap((n) => {
    return middleOf(n.replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean)).map(flat);
  }));
  const names = all.filter((n) => !middle.has(flat(n)));
  const out = [];
  for (const n of names) out.push(...nameVariants(n, ctx));
  return out;
}

function stemVariant(raw) {
  const stem = String((raw && raw.stem) || '').trim();
  if (!cyrWord(stem) || stem.includes('-') || lettersOf(stem).length < MIN_STEM) return null;
  const forms = (Array.isArray(raw.forms) ? raw.forms : []).map((f) => String(f || '').trim()).filter(cyrWord);
  return variant('ru', `${LEFT}${esc(stem)}${TAIL}`, stem, forms.length ? forms : [stem], { single: true, stem: true });
}

function phraseVariant(raw, roles) {
  const t = String(raw || '').trim().replace(/\s+/g, ' ');
  const words = t.split(' ').filter(Boolean);
  if (!words.length || words.length > 5) return null;
  if (words.every(latWord)) return words.length === 1 && !wordOk(t, roles) ? null : enVariant(t);
  if (!words.every(cyrWord)) return null;
  if (words.length === 1) return wordOk(t, roles) ? ruWord(t) : null;
  return ruPhrase(words, true);
}

function uniq(list) {
  const seen = new Set();
  return list.filter((v) => {
    const id = `${v.lang}|${v.body}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function hintVariants(hints, spec, ctx) {
  const h = hints && typeof hints === 'object' ? hints : {};
  const list = (v) => (Array.isArray(v) ? v : []);
  const own = new Set([spec.name, ...(spec.aliases || [])].map(flat));
  const chat = flat(ctx.chatText || '');
  const out = [];
  for (const t of list(h.latin)) if (typeof t === 'string') out.push(phraseVariant(t, ctx.roleWords));
  for (const s of list(h.stems)) out.push(stemVariant(s));
  for (const t of list(h.seen)) {
    if (typeof t !== 'string' || !t.trim()) continue;
    if (own.has(flat(t)) || (chat && chat.includes(flat(t)))) out.push(...nameVariants(t, ctx));
  }
  for (const t of list(h.phrases)) out.push(phraseVariant(t, ctx.roleWords));
  return out.filter((v) => checkVariant(v));
}

export function contentWords(text, { min = 6, max = 3 } = {}) {
  const out = [];
  for (const w of String(text || '').match(/[А-Яа-яЁё]+/g) || []) {
    if (lettersOf(w).length < min || bareWord(w) || FREQUENT_WORDS.includes(flat(w))) continue;
    if (out.some((x) => flat(x).slice(0, 5) === flat(w).slice(0, 5))) continue;
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}

function termBody(word) {
  const w = String(word);
  if (/[оеё][кц]$/i.test(w) && lettersOf(w).length >= 6) return `${esc(w.slice(0, -2))}[${CYR}]{0,4}`;
  const cut = /[аяеёиоуыьюэй]$/i.test(w) && lettersOf(w).length - 1 >= MIN_STEM ? w.slice(0, -1) : w;
  return `${esc(cut)}[${CYR}]{0,${cut.length >= 5 ? 3 : 2}}`;
}

function termVariant(ws) {
  const body = ws.map(termBody).join('\\s+');
  return variant('ru', `${LEFT}${body}${ws.length === 1 ? RIGHT : ''}`, ws.join(' '), ws.length === 1 ? [ws[0]] : [ws.join(' ')], { single: ws.length === 1 });
}

function looseWord(word) {
  const w = String(word);
  const two = /(?:ам|ом|ем|ах|ей|ов|ев|ою|ею|ие|ые|ий|ых|их|ми|ть|ла|ли|ло|ет|ют|ит|ат|ят)$/i;
  const stem = two.test(w) && w.length >= 7 ? w.slice(0, -2) : /[аяеёиоуыьюэй]$/i.test(w) ? w.slice(0, -1) : w;
  return variant('ru', `${LEFT}${esc(stem)}${TAIL}`, stem, [w], { single: true, stem: true });
}

export function essenceWords(text) {
  const out = new Set();
  for (const w of flat(text).split(/[^\p{L}]+/u)) if (w.length >= MIN_STEM) out.add(w);
  return [...out];
}

const sharedPrefix = (a, b) => {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1;
  return n;
};

export function nearEssence(v, ctx = {}) {
  const words = ctx.essenceWords;
  if (!v || !v.single || !words || !words.length) return false;
  const t = v.text;
  return words.some((w) => sharedPrefix(t, w) >= Math.max(MIN_STEM, Math.min(t.length, w.length) - 1));
}

export const OVERUSED_HITS = 4;

export function overused(v, ctx = {}) {
  const text = String(ctx.chatText || '');
  if (!v || !text) return false;
  let re;
  try {
    re = new RegExp(v.lang === 'en' ? `\\b(?:${v.body})\\b` : v.body, 'gi');
  } catch {
    return false;
  }
  return (text.match(re) || []).length >= OVERUSED_HITS;
}

export function variantsFor(spec, hints, ctx = {}) {
  if (!spec || spec.type === 'none') return [];
  const out = [];
  if (spec.type === 'vocab') {
    for (const t of spec.terms || []) {
      const all = String(t).trim().split(/\s+/);
      if (all.every(latWord)) {
        if (lettersOf(t).length >= MIN_STEM) out.push(enVariant(t));
        continue;
      }
      const ws = all.filter(cyrWord);
      if (!ws.length || (ws.length === 1 && lettersOf(ws[0]).length < MIN_STEM)) continue;
      out.push(termVariant(ws));
    }
    return uniq(out.filter((v) => checkVariant(v) && !nearEssence(v, ctx))).slice(0, MAX_KEYS);
  }
  if (spec.type === 'person') {
    out.push(...personVariants(spec, ctx), ...hintVariants(hints, spec, ctx));
  } else {
    const topic = hintVariants(hints, spec, ctx);
    const hinted = Boolean(hints && typeof hints === 'object' && (hints.stems || hints.phrases || hints.latin));
    if (!hinted) {
      for (const w of spec.words || []) {
        const ws = String(w).trim().split(/\s+/).filter(Boolean);
        if (ws.length === 1 && cyrWord(ws[0]) && lettersOf(ws[0]).length >= 5) { const v = looseWord(ws[0]); if (checkVariant(v)) topic.push(v); }
        else if (ws.length > 1 && ws.every(cyrWord)) topic.push(ruPhrase(ws, true));
        else if (ws.length && ws.every(latWord)) topic.push(enVariant(ws.join(' ')));
      }
    }
    out.push(...topic.filter((v) => !overused(v, ctx)));
    for (const p of spec.people || []) out.push(...personVariants(p, ctx).slice(0, 3));
  }
  const taken = new Set((ctx.exclude || []).map(flat));
  return uniq(out.filter((v) => v && !taken.has(v.text) && (spec.type === 'person' || !nearEssence(v, ctx)))).slice(0, MAX_KEYS);
}

export function composeKeys(variants) {
  const en = variants.filter((v) => v.lang === 'en').map((v) => v.body);
  const ru = variants.filter((v) => v.lang === 'ru').map((v) => asKey(v.body));
  return [...(en.length ? [asKey(`\\b(?:${en.join('|')})\\b`)] : []), ...ru];
}

function overlaps(a, b) {
  if (a.lang !== b.lang) return false;
  if (a.text === b.text) return true;
  if (!a.single || !b.single || a.lang !== 'ru') return false;
  return (a.stem && b.text.startsWith(a.text)) || (b.stem && a.text.startsWith(b.text));
}

export function composeAll(items, ctx = {}) {
  const sets = items.map((it) => ({ it, vs: variantsFor(it.spec, it.hints, ctx) }));
  const people = sets.filter((s) => s.it.spec && s.it.spec.type === 'person');
  const dropped = new Map(people.map((s) => [s, new Set()]));
  for (let i = 0; i < people.length; i += 1) {
    for (let j = i + 1; j < people.length; j += 1) {
      for (const a of people[i].vs) {
        for (const b of people[j].vs) {
          if (!overlaps(a, b) || (!a.single && !b.single)) continue;
          if (a.single) dropped.get(people[i]).add(a);
          if (b.single) dropped.get(people[j]).add(b);
        }
      }
    }
  }
  const out = new Map();
  for (const s of sets) {
    const gone = dropped.get(s);
    let vs = gone ? s.vs.filter((v) => !gone.has(v)) : s.vs;
    if (!vs.length && s.vs.length) vs = [s.vs[0]];
    out.set(s.it.uid, composeKeys(vs));
  }
  return out;
}

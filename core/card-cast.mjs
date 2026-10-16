export const CAST_MAX = 12;
export const ALIASES_MAX = 6;
export const NAME_MAX = 60;
export const ROLES = ['main', 'npc'];
export const SOURCES = ['auto', 'model', 'manual'];

const str = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();

export function emptyCast() {
  return { people: [], source: 'auto', checked: false };
}

function cleanName(v) {
  const s = str(v).replace(/^["'«»]+|["'«»]+$/g, '');
  if (!s || /\{\{.*\}\}/.test(s)) return '';
  return s.length > NAME_MAX ? s.slice(0, NAME_MAX).trim() : s;
}

export function normalizePerson(raw) {
  if (typeof raw === 'string') raw = { name: raw };
  if (!raw || typeof raw !== 'object') return null;
  const name = cleanName(raw.name);
  if (!name) return null;
  const seen = new Set([name.toLowerCase()]);
  const aliases = [];
  for (const a of [].concat(raw.aliases == null ? [] : raw.aliases)) {
    const s = cleanName(a);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    aliases.push(s);
    if (aliases.length >= ALIASES_MAX) break;
  }
  return { name, aliases, role: ROLES.includes(raw.role) ? raw.role : 'main' };
}

export function normalizeCast(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { people: raw };
  const people = [];
  for (const p of Array.isArray(r.people) ? r.people : []) {
    const n = normalizePerson(p);
    if (!n || people.some((x) => x.name.toLowerCase() === n.name.toLowerCase())) continue;
    people.push(n);
    if (people.length >= CAST_MAX) break;
  }
  return {
    people,
    source: SOURCES.includes(r.source) ? r.source : 'auto',
    checked: r.checked === true,
  };
}

export function castNames(cast, role = 'main') {
  const c = normalizeCast(cast);
  return c.people.filter((p) => p.role === role).flatMap((p) => [p.name, ...p.aliases]);
}

export function personFromLine(line, role = 'main') {
  const parts = String(line == null ? '' : line).split(/[,;\n]+/).map(cleanName).filter(Boolean);
  if (!parts.length) return null;
  return normalizePerson({ name: parts[0], aliases: parts.slice(1), role });
}

export function personLine(person) {
  const p = normalizePerson(person);
  return p ? [p.name, ...p.aliases].join(', ') : '';
}

const NOT_NAMES = new Set([
  'the', 'a', 'an', 'he', 'she', 'they', 'his', 'her', 'their', 'you', 'your', 'i', 'my', 'we', 'it', 'this',
  'that', 'when', 'while', 'after', 'before', 'if', 'but', 'and', 'or', 'as', 'in', 'on', 'at', 'with', 'for',
  'from', 'to', 'of', 'by', 'is', 'was', 'are', 'not', 'no', 'yes', 'all', 'one', 'name', 'age', 'gender',
  'personality', 'appearance', 'scenario', 'description', 'background', 'likes', 'dislikes', 'height',
  'occupation', 'species', 'relationship', 'user', 'char', 'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'lord', 'lady',
  'он', 'она', 'они', 'его', 'её', 'ее', 'их', 'ты', 'вы', 'твой', 'ваш', 'мой', 'я', 'мы', 'это', 'этот', 'эта',
  'когда', 'пока', 'после', 'если', 'но', 'и', 'или', 'как', 'в', 'на', 'с', 'со', 'для', 'от', 'до', 'по', 'не',
  'нет', 'да', 'все', 'всё', 'имя', 'возраст', 'пол', 'характер', 'внешность', 'сценарий', 'описание', 'рост',
  'профессия', 'раса', 'отношения',
  'overview', 'nickname', 'nicknames', 'alias', 'aliases', 'title', 'backstory', 'portray', 'connection',
  'connections', 'relationships', 'summary', 'info', 'information', 'notes', 'note', 'traits', 'role', 'sexuality',
  'body', 'outfit', 'outfits', 'clothing', 'speech', 'quirks', 'history', 'family', 'lore', 'setting', 'details',
  'bio', 'profile', 'friends', 'enemies', 'goals', 'fears', 'skills', 'abilities', 'powers', 'hobbies', 'kinks',
  'прозвище', 'обзор', 'история', 'семья', 'предыстория', 'навыки', 'цели', 'друзья', 'связи', 'роль',
]);

const PLACE = /^(?:academ|school|universit|college|institut|club|plant|factory|town|city|village|kingdom|empire|church|cult|clan|manor|hall|street|forest|magic|world|homestead|farm|academy|академи|школ|университет|колледж|институт|клуб|завод|город|деревн|королевств|импери|церк|культ|клан|улиц|лес|мир|ферм)/i;

const WORD = /^[A-ZА-ЯЁ][a-zа-яё'’]+(?:-[A-ZА-ЯЁ][a-zа-яё'’]+)?$/u;

const bareWord = (w) => w.replace(/^[^A-Za-zА-Яа-яЁё]+|[^A-Za-zА-Яа-яЁё'’-]+$/gu, '').replace(/['’]s$/u, '');
const isNameWord = (w) => WORD.test(w) && !NOT_NAMES.has(w.toLowerCase()) && !PLACE.test(w);

export function titleNames(title, known = null) {
  const out = [];
  for (const part of String(title || '').split(/[◇|☀︎☾\-—–:(),/\\[\]{}]|\s{2,}|[^\p{L}\p{Zs}'’-]+/u)) {
    for (const piece of part.split(/\s+(?:and|&|и)\s+/iu)) {
      const words = piece.trim().split(/\s+/u).filter(Boolean);
      if (!words.length || words.length > 3 || !words.every(isNameWord)) continue;
      if (known && known.size && !known.has(words[0])) continue;
      out.push(words.join(' '));
    }
    if (out.length) break;
  }
  return out;
}

export function nameStats(text) {
  const words = new Map();
  const runs = new Map();
  const lower = new Set();
  for (const chunk of String(text || '').split(/[.!?;:\n()"«»—–…*<>]+/u)) {
    const list = chunk.split(/\s+/u).filter(Boolean);
    let run = [];
    const flush = () => {
      if (run.length >= 2 && run.length <= 3) runs.set(run.join(' '), (runs.get(run.join(' ')) || 0) + 1);
      run = [];
    };
    list.forEach((raw, i) => {
      const w = bareWord(raw);
      if (!w) { flush(); return; }
      if (/^[a-zа-яё]/u.test(w)) lower.add(w.toLowerCase());
      if (!isNameWord(w)) { flush(); return; }
      const s = words.get(w) || { total: 0, mid: 0 };
      s.total += 1;
      if (i > 0) s.mid += 1;
      words.set(w, s);
      if (run[run.length - 1] !== w) run.push(w);
      if (/[,;]$/u.test(raw)) flush();
    });
    flush();
  }
  return { words, runs, lower };
}

export function frequentNames(text) {
  const { words, lower } = nameStats(text);
  return [...words.entries()]
    .filter(([w, s]) => s.mid > 0 && !lower.has(w.toLowerCase()))
    .map(([name, s]) => ({ name, count: s.total }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function fullNameOf(word, runs, good) {
  let best = '';
  let bestCount = 0;
  for (const [run, count] of runs.entries()) {
    const words = run.split(' ').filter((w) => w === word || good(w));
    if (!words.includes(word) || words.length < 2) continue;
    const name = words.join(' ');
    if (count > bestCount || (count === bestCount && name.length > best.length)) { best = name; bestCount = count; }
  }
  return best;
}

export function guessCastLocal(card) {
  const c = card || {};
  const text = [c.description, c.personality, c.scenario, c.scenario, c.firstMessage, c.firstMessage]
    .map(str).filter(Boolean).join('\n');
  const { words, runs, lower } = nameStats(text);
  const good = (w) => {
    const s = words.get(w);
    return Boolean(s && s.mid > 0 && !lower.has(w.toLowerCase()));
  };
  const person = (short) => {
    const name = fullNameOf(short.split(' ')[0], runs, good) || short;
    return { name, aliases: short !== name ? [short] : [], role: 'main' };
  };

  const fromTitle = titleNames(c.name, words);
  let people = fromTitle.map(person);
  if (!people.length) {
    const top = frequentNames(text)[0];
    if (top && top.count >= 3) people = [person(top.name)];
  }
  return people.length ? normalizeCast({ people, source: 'auto', checked: false }) : emptyCast();
}

export function buildCastPrompt(cardText, opts = {}) {
  const lang = str(opts.lang) || 'ru';
  const title = str(opts.title) || 'без названия';
  return {
    system: 'Ты читаешь карточку персонажа ролевой игры и перечисляешь, кто в ней живёт.'
      + ' Отвечай одним объектом JSON и ничем больше: без пояснений и markdown.',
    user: [
      `Название карточки в программе: «${title}». Название — не обязательно имя.`,
      'Карточка:',
      cardText || '(пусто)',
      '',
      'Перечисли людей карточки.',
      'main — персонаж, которого играет бот (обычно один; несколько — если карточка ведёт нескольких героев сразу).',
      'npc — другие люди, которые в карточке названы по имени.',
      `aliases — другие написания того же имени: короткое имя, прозвище, имя на языке «${lang}» (транслитерацией, если в карточке латиница).`,
      'Игрока ({{user}}) не пиши. Чего нет — не выдумывай.',
      'Формат:',
      '{"people":[{"name":"","aliases":[],"role":"main"}]}',
    ].join('\n'),
  };
}

export function castFromModel(data) {
  let list = [];
  if (Array.isArray(data)) list = data;
  else if (data && typeof data === 'object') {
    if (Array.isArray(data.people)) list = data.people;
    else if (Array.isArray(data.characters)) list = data.characters;
    else {
      for (const n of [].concat(data.main || [])) list.push({ name: n, role: 'main' });
      for (const n of [].concat(data.npc || [])) list.push({ name: n, role: 'npc' });
    }
  }
  const people = list.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const role = /npc|side|other|второстеп/i.test(String(p.role || '')) ? 'npc' : 'main';
    return { ...p, role };
  });
  return normalizeCast({ people, source: 'model', checked: false });
}

export function withCyrillicForms(people, pools) {
  const key = (v) => str(v).toLowerCase().replace(/ё/g, 'е');
  const cyr = (v) => /[а-яё]/i.test(v) && !/[a-z]/i.test(v);
  const rows = (Array.isArray(pools) ? pools : []).filter(Boolean).map((p) => [p.name, ...(Array.isArray(p.aliases) ? p.aliases : [])].map(str).filter(Boolean));
  return (Array.isArray(people) ? people : []).map((p) => {
    const have = [p.name, ...(p.aliases || [])];
    if (have.some(cyr)) return p;
    const mine = new Set(have.map(key));
    const row = rows.find((r) => r.some((n) => mine.has(key(n))) && r.some(cyr));
    if (!row) return p;
    const found = row.filter(cyr).sort((a, b) => b.split(/\s+/).length - a.split(/\s+/).length)[0];
    return { ...p, aliases: [...(p.aliases || []), found] };
  });
}

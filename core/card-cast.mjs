// core/card-cast — кто живёт в карточке персонажа: персонаж бота и люди вокруг.
//
// Зачем. Стоп-лист (`core/stop-names.mjs`) знает о карточке только `name2` —
// её название в таверне. Название часто не имя: карточка «Your Himbo Roommate»,
// а персонаж в ней — Джаспер Мираж. Модель пишет в сцене «Джаспер Мираж»,
// стоп-лист его не узнаёт, и персонаж бота приходит кандидатом в сокурсники
// (живой чат владелицы, 09.10).
//
// Список держится **по карточке**, а не по чату: персонаж тот же во всех чатах с
// ней, и спрашивать о нём в каждом новом чате незачем. Лежит в настройках
// расширения (`settings.cardCasts[avatar]`), хранилище — забота `index.js`.
//
//   cast = { people: [{name, aliases: [], role: 'main'|'npc'}],
//            source: 'auto'|'model'|'manual', checked: boolean }
//
// - `main` — персонаж бота: в стоп-лист видом `char` (кандидаты, лента).
// - `npc` — человек из мульти-карточки («общежитие на пятерых»): законный
//   сокурсник или наставник, в стоп-лист не идёт. Записан, чтобы человек видел,
//   что расширение его заметило и не перепутало с персонажем.
// - `checked` — человек посмотрел и сохранил. Догадку (`auto`, `model`) панель
//   показывает с просьбой проверить.
//
// Модуль чистый: карточка приходит объектом (`api.readCharacterCard`).

/** Сколько людей держит одна карточка. Больше — это уже лорбук, а не карточка. */
export const CAST_MAX = 12;
/** Сколько написаний у одного имени («Джаспер Мираж», «Jasper Mirage», «Джас»). */
export const ALIASES_MAX = 6;
export const NAME_MAX = 60;
export const ROLES = ['main', 'npc'];
export const SOURCES = ['auto', 'model', 'manual'];

const str = (v) => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();

/** Пустой список: карточку ещё не смотрели. */
export function emptyCast() {
  return { people: [], source: 'auto', checked: false };
}

function cleanName(v) {
  const s = str(v).replace(/^["'«»]+|["'«»]+$/g, '');
  if (!s || /\{\{.*\}\}/.test(s)) return '';
  return s.length > NAME_MAX ? s.slice(0, NAME_MAX).trim() : s;
}

/** Человек карточки; без имени — `null`. Имя не дублируется в написаниях. */
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

/** Список из чего угодно; битое — пустой список, не исключение. */
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

/** Все написания имён нужной роли: то, что уходит в стоп-лист. */
export function castNames(cast, role = 'main') {
  const c = normalizeCast(cast);
  return c.people.filter((p) => p.role === role).flatMap((p) => [p.name, ...p.aliases]);
}

/**
 * «Джаспер Мираж, Jasper Mirage» из поля панели → имя и написания. Первое —
 * имя, остальные — другие написания того же человека.
 */
export function personFromLine(line, role = 'main') {
  const parts = String(line == null ? '' : line).split(/[,;\n]+/).map(cleanName).filter(Boolean);
  if (!parts.length) return null;
  return normalizePerson({ name: parts[0], aliases: parts.slice(1), role });
}

/** Обратно для поля панели: «Джаспер Мираж, Jasper Mirage». */
export function personLine(person) {
  const p = normalizePerson(person);
  return p ? [p.name, ...p.aliases].join(', ') : '';
}

// --- догадка без модели ---------------------------------------------------------
//
// Бесплатная и мгновенная догадка на открытие чата. Два источника.
//
// 1. **Название карточки**, если в нём есть имя: «Bastien ◇ Childhood Friend»,
//    «HOMESTEAD ☀︎ Brock Hollister», «Liam  Steptember». Берётся первая часть
//    между украшениями, похожая на имя.
// 2. **Текст карточки**: о персонаже пишут по имени чаще, чем о ком-либо, —
//    «Jasper sprawled out…», «…that Jasper had grown». Слово считается именем,
//    только если оно хоть раз стоит с заглавной **посреди** фразы и ни разу не
//    встречается со строчной: «Every», «Still», «There» стоят с заглавной лишь
//    в начале предложения, а «still» в тексте есть. Места («Academy», «Plant»)
//    отсеиваются словарём.
//
// Проверено на полусотне живых карточек владелицы (09.10): первая версия —
// «самое частое имя из двух слов» — находила «Orwell Magic Academy» вместо
// Джаспера и «Diana» вместо Бастьена. Догадка всё равно слабая — карточка, где
// везде `{{char}}`, ничего не даст, — поэтому панель просит её проверить, а
// для надёжного ответа есть кнопка «Найти в карточке» (модель).

/** Слова с заглавной, которые не имена: служебное и обращения в карточках. */
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
  // Заголовки разделов карточек: «Overview:», «Nickname:» прилипали к имени.
  'overview', 'nickname', 'nicknames', 'alias', 'aliases', 'title', 'backstory', 'portray', 'connection',
  'connections', 'relationships', 'summary', 'info', 'information', 'notes', 'note', 'traits', 'role', 'sexuality',
  'body', 'outfit', 'outfits', 'clothing', 'speech', 'quirks', 'history', 'family', 'lore', 'setting', 'details',
  'bio', 'profile', 'friends', 'enemies', 'goals', 'fears', 'skills', 'abilities', 'powers', 'hobbies', 'kinks',
  'прозвище', 'обзор', 'история', 'семья', 'предыстория', 'навыки', 'цели', 'друзья', 'связи', 'роль',
]);

/** Части названий мест и организаций: имя человека их не содержит. */
const PLACE = /^(?:academ|school|universit|college|institut|club|plant|factory|town|city|village|kingdom|empire|church|cult|clan|manor|hall|street|forest|magic|world|homestead|farm|academy|академи|школ|университет|колледж|институт|клуб|завод|город|деревн|королевств|импери|церк|культ|клан|улиц|лес|мир|ферм)/i;

const WORD = /^[A-ZА-ЯЁ][a-zа-яё'’]+(?:-[A-ZА-ЯЁ][a-zа-яё'’]+)?$/u;

const bareWord = (w) => w.replace(/^[^A-Za-zА-Яа-яЁё]+|[^A-Za-zА-Яа-яЁё'’-]+$/gu, '').replace(/['’]s$/u, '');
const isNameWord = (w) => WORD.test(w) && !NOT_NAMES.has(w.toLowerCase()) && !PLACE.test(w);

/**
 * Имена из названия карточки. Части между украшениями («◇», «|», «☀︎», двойной
 * пробел, тире); часть «Brad and Kyle» — два имени. Часть годится, если в ней
 * одно-три слова с заглавной и первое слово хоть раз встречается в тексте
 * карточки — иначе «Hot Slasher Summer» из подзаголовка сошёл бы за имя.
 * Без текста — первая подходящая часть. «Your Himbo Roommate» — не имя («Your»).
 *
 * @param {string} title
 * @param {Map<string, Object>} [known] слова текста (`nameStats().words`)
 * @returns {string[]}
 */
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

/**
 * Слова-имена текста со счётом: всего, посреди фразы; и полные имена (два-три
 * слова подряд). Строчные формы — чтобы отсеять обычные слова в начале фразы.
 *
 * @returns {{words: Map<string, {total: number, mid: number}>, runs: Map<string, number>, lower: Set<string>}}
 */
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
      // «Brad, Kyle» — два человека, а не одно имя.
      if (/[,;]$/u.test(raw)) flush();
    });
    flush();
  }
  return { words, runs, lower };
}

/**
 * Самые вероятные имена текста, от частого к редкому: только слова, которые
 * стоят с заглавной посреди фразы и не встречаются со строчной.
 *
 * @returns {Array<{name: string, count: number}>}
 */
export function frequentNames(text) {
  const { words, lower } = nameStats(text);
  return [...words.entries()]
    .filter(([w, s]) => s.mid > 0 && !lower.has(w.toLowerCase()))
    .map(([name, s]) => ({ name, count: s.total }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/**
 * Самое частое полное имя текста со словом `word`. Из имени выпадают слова,
 * которые не похожи на имя (`good`): «However Jasper» → «Jasper», «Liam
 * Engelhorn Overview» → «Liam Engelhorn» — начало фразы и заголовок раздела
 * прилипают к имени, если между ними нет знака.
 */
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

/**
 * Догадка: персонаж бота по названию и тексту карточки. Начало сцены и
 * сценарий весят вдвое — там о персонаже пишут больше всего. Название с «and»
 * («Brad and Kyle») даёт двух персонажей.
 *
 * @param {Object} card `{name, description, personality, scenario, firstMessage}`
 * @returns {Object} cast
 */
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

// --- догадка моделью ------------------------------------------------------------

/**
 * Промпт «кто в карточке». Имена — во всех написаниях, в том числе на языке
 * чата: карточка бывает английской, а ролка — русской, и модель в сцене пишет
 * «Джаспер», а не «Jasper».
 */
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

/**
 * Разбор ответа модели. Принимает и `{people: […]}`, и голый массив, и
 * `{main: "…", npc: […]}`, — дешевле понять, чем ругать.
 *
 * @param {*} data уже разобранный JSON (`extractJson`)
 * @returns {Object} cast (`source: 'model'`)
 */
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

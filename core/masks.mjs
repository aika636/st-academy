import { isPortrait } from './portraits.mjs';

export const ANON_ICON = '👤';

export const MASK_STEMS = [
  [['=бес', '=беса', '=бесы', 'бесенок', 'черт', 'демон', 'дьявол', 'чертен', 'devil'], '😈'],
  [['футбол', 'мяч', 'нападающ', 'вратар', 'football', 'soccer'], '⚽'],
  [['любл', 'люблю', 'любит', 'любов', 'влюб', 'фанат', 'обожа', 'love'], '💘'],
  [['=кот', '=кота', 'котик', 'котэ', 'котя', 'кошк', 'кошак', 'мяу', '=cat', 'kitty'], '🐱'],
  [['сплетн', 'шепот', 'шепч', 'шушук', '=слух', 'слухи', 'инсайд', 'gossip'], '🤫'],
  [['кофе', 'кофей', 'латте', 'капуч', 'эспрес', 'coffee'], '☕'],
  [['ботан', 'зубрил', 'отличн', 'умник', 'заучк', 'nerd'], '🤓'],
  [['спорт', 'качок', 'качк', 'качал', 'фитнес', 'качаю', 'gym'], '💪'],
  [['тролл', 'troll'], '🧌'],
  [['призрак', 'привид', '=тень', '=тени', 'теней', 'тенев', 'невидим', 'ghost'], '👻'],
  [['звезд', 'звёзд', 'star'], '⭐'],
  [['магия', 'магии', 'магич', '=маг', '=маги', 'волшеб', 'чаров', 'заклин', 'руны', 'magic'], '✨'],
  [['ведьм', 'колдун', 'колдов', 'чародей', 'witch'], '🧙'],
  [['космос', 'космич', 'косми', 'ракет', 'астро', 'галакт', 'орбит', 'звездолет', 'пилот', 'space'], '🚀'],
  [['инопланет', '=пришелец', 'пришельц', 'alien'], '👽'],
  [['дракон', 'dragon'], '🐉'],
  [['=меч', 'мечник', 'клинок', 'клинк', 'фехтов'], '🗡️'],
  [['культив', '=дао', 'бессмерт', 'безсмерт', 'просветл', 'медитир', 'дзен'], '☯️'],
  [['пилюл', 'эликсир', 'зелье', 'зелья', 'алхим'], '⚗️'],
  [['лотос', 'сакур', 'цвет', '=роза', '=розы'], '🌸'],
  [['музык', 'гитар', '=рок', 'рокер', '=рэп', 'рэпер', 'диджей', 'music'], '🎸'],
  [['геймер', 'игроман', 'катк', 'gamer'], '🎮'],
  [['=сон', 'сонн', 'спящ', '=сплю', 'засып', 'недосып', 'sleep'], '😴'],
  [['злой', 'злая', 'злюк', 'ярост', 'бешен', 'бесящ', 'angry'], '😡'],
  [['ржу', 'смех', 'смеш', 'хаха', 'ахах', '=лол', 'угар', '=мем', '=мемы', 'юмор', 'lol'], '😂'],
  [['корол', 'принц', 'царь', 'царица', 'королев', 'queen', 'king'], '👑'],
  [['шпион', 'агент', 'детектив', 'сыщик', 'следов', 'spy'], '🕵️'],
  [['плак', 'слез', 'слёз', 'нытик', 'груст', 'печал', 'sad'], '😢'],
  [['огонь', 'огнен', 'пламен', 'горяч', 'fire'], '🔥'],
  [['=лис', '=лиса', 'лисич', 'лисен', 'fox'], '🦊'],
  [['сова', 'совен', 'филин', '=сов', 'owl'], '🦉'],
  [['=пес', 'песик', 'собак', 'щенок', 'щенк', 'doge', 'dog'], '🐶'],
  [['книг', 'библиот', 'читат', 'книжн', 'book'], '📚'],
  [['деньг', 'богат', 'мажор', 'бабл', 'money'], '💸'],
  [['ночь', 'ночн', '=луна', 'лунн', '=луны', 'moon'], '🌙'],
  [['наблюд', 'глаз', 'вижу', 'видел', 'слеж', 'смотрю', 'всевид'], '👀'],
  [['пицц', 'шаурм', 'шаверм', 'бургер', 'pizza'], '🍕'],
  [['=чай', '=чая', '=чаю', '=чаем', '=чаи', 'чайн', '=tea'], '🍵'],
  [['учител', 'препод', 'училк', 'декан', 'директ', 'teacher'], '🧑‍🏫'],
];

export const MASK_FALLBACK = ['🎭', '🦊', '🐸', '🦉', '🌚', '🍓', '🐙', '🦔', '🍄', '🐝', '🦄', '🐧'];

function words(nick) {
  return String(nick == null ? '' : nick)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^\p{L}]+/u)
    .filter(Boolean);
}

function fits(word, stem) {
  if (stem.startsWith('=')) return word === stem.slice(1).replace(/ё/g, 'е');
  return word.startsWith(stem.replace(/ё/g, 'е'));
}

const LITERAL = [[/[❤♥💘💕💖💗😍🥰]/u, '💘'], [/🔥/u, '🔥'], [/[⭐🌟★]/u, '⭐'], [/[😈👿]/u, '😈'], [/[⚽]/u, '⚽']];

export function maskIcon(nick) {
  const raw = String(nick == null ? '' : nick).trim();
  if (!raw) return ANON_ICON;
  for (const [re, icon] of LITERAL) if (re.test(raw)) return icon;
  for (const w of words(raw)) {
    for (const [stems, icon] of MASK_STEMS) {
      if (stems.some((s) => fits(w, s))) return icon;
    }
  }
  const key = words(raw).join(' ') || raw;
  return MASK_FALLBACK[hashOf(key) % MASK_FALLBACK.length];
}

export function initialsOf(name) {
  const list = String(name == null ? '' : name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return list.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
}

export function personColor(id) {
  return `hsl(${hashOf(String(id == null ? '' : id)) % 360}, 45%, 40%)`;
}

const HEROINE = '@heroine';

export function authorAvatar(state, author, opts = {}) {
  const a = author || {};
  if (a.nick) return { kind: 'mask', icon: maskIcon(a.nick) };
  if (a.chan === 'anon') return { kind: 'anon', icon: ANON_ICON };
  const who = String(a.who || '');
  if (who === HEROINE) {
    const name = String(opts.heroine || '').trim();
    return name ? { kind: 'person', id: HEROINE, name, initials: initialsOf(name), color: personColor(HEROINE), portrait: '' }
      : { kind: 'anon', icon: ANON_ICON };
  }
  const people = [...((state && state.teachers) || []), ...((state && state.classmates) || [])];
  const p = who ? people.find((x) => x && x.id === who) : null;
  return p ? personAvatar(p) : { kind: 'anon', icon: ANON_ICON };
}

export function personAvatar(person) {
  const p = person || {};
  const name = String(p.name || p.id || '').trim();
  return {
    kind: 'person',
    id: String(p.id || ''),
    name,
    initials: initialsOf(name) || '?',
    color: personColor(p.id || name),
    portrait: isPortrait(p.portrait) ? p.portrait : '',
  };
}

function hashOf(s) {
  let h = 0;
  const t = String(s);
  for (let i = 0; i < t.length; i += 1) h = (Math.imul(31, h) + t.charCodeAt(i)) | 0;
  return h >>> 0;
}

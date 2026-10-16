export const STOP_USER = 'user';
export const STOP_INSTITUTION = 'institution';
export const STOP_PRESET = 'preset';
export const STOP_CHAR = 'char';

export const HARD_STOPS = [STOP_USER, STOP_INSTITUTION, STOP_PRESET];

const MIN_TOKEN = 3;

export function stopList(src = {}) {
  const out = [];
  const add = (raw, kind) => {
    for (const name of [].concat(raw == null ? [] : raw)) {
      const s = String(name == null ? '' : name).trim();
      if (!s || /\{\{.*\}\}/.test(s)) continue;
      const n = normName(s);
      if (!n) continue;
      if (out.some((x) => x.norm === n && x.kind === kind)) continue;
      out.push({ name: s, norm: n, tokens: n.split(' '), kind });
    }
  };
  const preset = src.preset && typeof src.preset === 'object' ? src.preset : {};
  const survey = src.survey && typeof src.survey === 'object' ? src.survey : {};

  add(src.user, STOP_USER);
  add(survey.institution, STOP_INSTITUTION);
  add(preset.displayName, STOP_INSTITUTION);
  add(Array.isArray(preset.stopNames) ? preset.stopNames : [], STOP_PRESET);
  add(src.char, STOP_CHAR);
  return out;
}

export function stopHit(name, stop) {
  const list = asList(stop);
  if (!list.length) return null;
  const n = normName(name);
  if (!n) return null;
  const tokens = n.split(' ');
  const partial = tokens.every((t) => t.length >= MIN_TOKEN);

  let best = null;
  for (const s of list) {
    const hit = s.norm === n || (partial && tokens.every((t) => s.tokens.includes(t)))
      || (s.kind === STOP_CHAR && partial && charHit(tokens, s.tokens));
    if (!hit) continue;
    if (!best || rank(s.kind) < rank(best.kind)) best = s;
  }
  return best ? { kind: best.kind, name: best.name } : null;
}

export function filterPeople(list, stop, opts = {}) {
  const namesOf = typeof opts.namesOf === 'function'
    ? opts.namesOf
    : (x) => (x && typeof x === 'object' ? [x.name, x.id] : [x]);
  const keep = new Set((opts.keep || []).map(String));
  const kept = [];
  const dropped = [];
  for (const item of Array.isArray(list) ? list : []) {
    const hit = strictest((namesOf(item) || []).map((n) => stopHit(n, stop)));
    const confirmed = item && typeof item === 'object' && keep.has(String(item.id));
    if (hit && !(confirmed && !HARD_STOPS.includes(hit.kind))) dropped.push({ item, hit });
    else kept.push(item);
  }
  return { kept, dropped };
}

export function strictest(hits) {
  let best = null;
  for (const h of hits || []) if (h && (!best || rank(h.kind) < rank(best.kind))) best = h;
  return best;
}

function charHit(tokens, stopTokens) {
  const same = (a, b) => a === b || (a.length >= MIN_TOKEN && b.length >= MIN_TOKEN && (skeletonEq(a, b) || soundEq(a, b)));
  const inside = (xs, ys) => xs.every((x) => ys.some((y) => same(x, y)));
  const long = stopTokens.filter((t) => t.length >= MIN_TOKEN);
  return inside(tokens, stopTokens) || (long.length > 0 && long.length === stopTokens.length && inside(long, tokens));
}

const RU_LAT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function nameSkeleton(word) {
  return soundBase(word)
    .replace(/[aeiouyh]/g, '')
    .replace(/(.)\1+/g, '$1')
    .toLowerCase();
}

function soundBase(word) {
  const raw = String(word == null ? '' : word).toLowerCase().replace(/ё/g, 'е');
  let s = raw.replace(/[а-я]/g, (ch) => (RU_LAT[ch] === undefined ? ch : RU_LAT[ch]));
  s = s.replace(/[^a-z]/g, '');
  if (/^[a-z]+$/.test(raw) && s.length > 3) s = s.replace(/([^aeiouy])e$/, '$1');
  return s
    .replace(/kh/g, 'h')
    .replace(/^h/, 'H')
    .replace(/dzh|dj|zh|g(?=[eiy])|j|g$/g, 'J')
    .replace(/ck|q|c(?![eiyh])/g, 'k')
    .replace(/c/g, 's')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/w/g, 'v')
    .replace(/x/g, 'ks');
}

function soundEq(a, b) {
  const key = (w) => soundBase(w).replace(/(.)\1+/g, '$1').replace(/[eiy]/g, 'i').replace(/o/g, 'a').replace(/([aiu])[aeiouy]+/g, '$1').toLowerCase();
  return nameSkeleton(a).length >= 2 && key(a) === key(b);
}

function skeletonEq(a, b) {
  const x = nameSkeleton(a);
  return x.length >= MIN_TOKEN && x === nameSkeleton(b);
}

const ORDER = [STOP_USER, STOP_INSTITUTION, STOP_PRESET, STOP_CHAR];
const rank = (kind) => {
  const i = ORDER.indexOf(kind);
  return i < 0 ? ORDER.length : i;
};

function asList(stop) {
  if (!stop) return [];
  if (Array.isArray(stop)) {
    return stop.flatMap((s) => (typeof s === 'string' ? stopList({ preset: { stopNames: [s] } }) : [s]))
      .filter((s) => s && typeof s.norm === 'string');
  }
  if (typeof stop === 'object') return stopList(stop);
  return [];
}

export function normName(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[_\-.,;:!?"'«»()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const COMMON_NAME_WORDS = new Set([
  'человек', 'лишний', 'новый', 'новая', 'новенький', 'новенькая', 'старый', 'старая', 'старший', 'старшая',
  'младший', 'младшая', 'большой', 'малый', 'маленький', 'маленькая', 'белый', 'белая', 'черный', 'черная',
  'темный', 'темная', 'красный', 'красная', 'рыжий', 'рыжая', 'тихий', 'тихая', 'злой', 'злая',
  'мастер', 'леди', 'лорд', 'сэр', 'директор', 'мадам', 'господин', 'госпожа', 'мисс', 'мистер', 'миссис', 'доктор', 'профессор',
  'учитель', 'учительница', 'капитан', 'брат', 'сестра', 'друг', 'подруга', 'девочка', 'мальчик', 'девушка',
  'парень', 'сосед', 'соседка', 'староста', 'тень', 'кот', 'кошка', 'лис', 'лиса', 'волк', 'старик', 'дядя', 'тетя',
  'the', 'mister', 'miss', 'lady', 'lord', 'sir', 'doctor', 'master', 'professor', 'prof', 'headmaster', 'headmistress', 'madam', 'madame', 'mrs', 'mr', 'ms', 'man', 'girl', 'boy', 'old', 'new', 'little', 'big',
]);

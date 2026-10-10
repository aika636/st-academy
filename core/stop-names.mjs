// core/stop-names — стоп-лист имён: кто в этой сцене точно НЕ наставник и не NPC (9.3.6).
//
// Откуда берётся мусор, от которого он защищает. У модели и у всех будущих
// источников «людей» (3.10: лорбук, карточка, генерация) под рукой одни и те же
// имена, и три из них чаще всего попадают не туда:
//
//   * `name1` — персонаж человека. `rel=алиса:+1` — отношение героини к самой
//     себе, а преподаватель «Алиса Воронова», которого генерация плана сочинила
//     из анкеты, — двойник героини в таблице;
//   * `name2` — карточка. Особенно карточка-рассказчик («Рассказчик», «Академия
//     Звёздного Света», «Narrator»): модель пишет `rel=narrator:+1`, а разбор
//     карточки в 3.10 предлагает «Рассказчика» в сокурсники;
//   * название заведения — из пресета (`displayName`) и из анкеты
//     (`survey.institution`). `rel=академия:-1` — это не отношение, а
//     репутация, и у неё своя шкала (3.4).
//
// Плюс короткий список пресета (`preset.stopNames`): служебные слова сеттинга,
// которые модель пишет вместо имени («деканат», «рассказчик»). Слова живут в
// пресете, а не здесь — Хогвартс меняет пресет, а не этот файл.
//
// **Карточка — мягкий стоп, остальное — жёсткий.** Карточка бывает не
// рассказчиком, а самой преподавательницей: чат «один на один с Петровой» — это
// ровно та сцена, ради которой отношения вообще считаются. Поэтому совпадение с
// `name2` запрещает только то, чего в таблице наставников НЕТ (рассказчика,
// кандидата в «Люди»), а преподаватель, которого человек держит в таблице,
// остаётся живым. Героиня и заведение запрещены всегда: отношение к себе и
// отношение к зданию не бывают ни у какой карточки. Решение принимает не этот
// модуль, а тот, кто знает таблицу (`parse-marker`, `filterPeople`): здесь только
// вид совпадения.
//
// Модуль чистый. Имена `name1`/`name2` приходят параметром: читать их из таверны
// — забота `index.js`.

/** Виды совпадения. Порядок — порядок строгости: героиня старше всех. */
export const STOP_USER = 'user';
export const STOP_INSTITUTION = 'institution';
export const STOP_PRESET = 'preset';
export const STOP_CHAR = 'char';

/** Какие виды запрещают имя даже тогда, когда оно есть в таблице наставников. */
export const HARD_STOPS = [STOP_USER, STOP_INSTITUTION, STOP_PRESET];

/**
 * Слово короче этого не считается частью имени при частичном совпадении.
 * Иначе «Ли» из «Ли Мэй» запрещала бы всех, у кого в имени есть «ли», а
 * инициалы «А.» — всех на «А». Полное совпадение работает на любой длине.
 */
const MIN_TOKEN = 3;

/**
 * Собрать стоп-лист.
 *
 * Пустые и макросные имена (`{{user}}` — таверна не подставила) выбрасываются:
 * стоп на пустую строку запретил бы всё, а на `{{user}}` — ничего полезного.
 * `user` и `char` принимают и строку, и список: в групповом чате карточек
 * несколько, и рассказчиком бывает любая.
 *
 * @param {Object} [src]
 * @param {string|string[]} [src.user]  `name1`
 * @param {string|string[]} [src.char]  `name2` (или все карточки группы)
 * @param {Object} [src.preset]  `displayName` и `stopNames`
 * @param {Object} [src.survey]  анкета: `institution`
 * @returns {Array<{name: string, norm: string, tokens: string[], kind: string}>}
 */
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

/**
 * Попадает ли имя в стоп-лист, и как.
 *
 * Совпадение — полное (после нормализации) или **имя целиком входит в
 * стоп-имя**: «Алиса» и «Воронова» — части «Алисы Вороновой», модель пишет
 * героиню то по имени, то по фамилии. Обратное не работает намеренно: при
 * `name1 = «Анна»` преподавательница «Анна Сергеевна Петрова» остаётся
 * преподавательницей — у неё в имени есть и чужие слова.
 *
 * Из нескольких совпадений возвращается самое строгое (см. порядок видов):
 * если «Петрова» — одновременно карточка и героиня, это героиня.
 *
 * @param {string} name
 * @param {Array|Object} stop  готовый `stopList(...)` или его вход
 * @returns {?{kind: string, name: string}}
 */
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

/**
 * Отсев кандидатов в «Люди» (3.10) и в таблицу наставников (генерация плана).
 *
 * Кандидат выпадает при любом совпадении, включая карточку: кандидат — это ещё
 * не подтверждённый человеком наставник, и «Рассказчик» среди сокурсников —
 * ровно та ошибка, ради которой список пишется. Исключение — `keep`: id тех,
 * кого человек уже держит в таблице (см. «мягкий стоп» в шапке); для них
 * запрещают только жёсткие виды.
 *
 * @template T
 * @param {T[]} list
 * @param {Array|Object} stop
 * @param {Object} [opts]
 * @param {(item: T) => string[]} [opts.namesOf] чем кандидат называется; по
 *   умолчанию `name` и `id`
 * @param {string[]} [opts.keep] id уже подтверждённых наставников
 * @returns {{kept: T[], dropped: Array<{item: T, hit: {kind: string, name: string}}>}}
 */
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

/** Самое строгое из нескольких совпадений; `null` — совпадений нет. */
export function strictest(hits) {
  let best = null;
  for (const h of hits || []) if (h && (!best || rank(h.kind) < rank(best.kind))) best = h;
  return best;
}

// --- персонаж карточки -----------------------------------------------------
//
// Для карточки правила совпадения шире, чем для героини, по двум причинам.
//
// 1. **В обе стороны.** Карточка «Джаспер», а модель пишет «Джаспер Мираж»:
//    лишнее слово в имени из сцены — фамилия, а не другой человек. Для героини
//    обратное запрещено нарочно («Анна» не должна выбивать «Анну Петрову»), но
//    карточка — мягкий стоп: она отсекает только кандидатов, а человек, которого
//    держат в таблице, остаётся (`filterPeople`, `keep`). Ошибиться здесь —
//    значит не предложить кандидата, а не потерять наставника.
// 2. **Сквозь алфавит.** Карточка английская («Jasper Mirage»), ролка русская
//    («Джаспер Мираж»). Слова сравниваются ещё и «скелетом» — согласными
//    транслитерации (`nameSkeleton`): jspr = jspr, mrj = mrj.

/** Совпадение имени из сцены с именем карточки по словам (см. выше). */
function charHit(tokens, stopTokens) {
  const same = (a, b) => a === b || (a.length >= MIN_TOKEN && b.length >= MIN_TOKEN && skeletonEq(a, b));
  const inside = (xs, ys) => xs.every((x) => ys.some((y) => same(x, y)));
  const long = stopTokens.filter((t) => t.length >= MIN_TOKEN);
  return inside(tokens, stopTokens) || (long.length > 0 && long.length === stopTokens.length && inside(long, tokens));
}

const RU_LAT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/**
 * Согласный «скелет» слова для сравнения латиницы с кириллицей: транслитерация,
 * сведение похожих звуков (дж/ж/j/g → j, c/ck/q → k, ph → f, w → v, x → ks),
 * без гласных и удвоений. «Джаспер» и «Jasper» → `jspr`, «Мираж» и «Mirage» →
 * `mrj`. Короче трёх согласных скелет не считается: «Ли» и «Lee» слишком
 * похожи на что угодно.
 */
export function nameSkeleton(word) {
  let s = String(word == null ? '' : word).toLowerCase().replace(/ё/g, 'е');
  s = s.replace(/[а-я]/g, (ch) => (RU_LAT[ch] === undefined ? ch : RU_LAT[ch]));
  // «Kharis» ↔ «Харис» ↔ «Кхарис»: «kh» — один звук «х», а начальный «х» значим
  // (иначе скелет «Харис» — `rs`, короче порога). Прописная H переживает
  // удаление гласных ниже и приводится к строчной в конце.
  s = s.replace(/[^a-z]/g, '')
    .replace(/kh/g, 'h')
    .replace(/^h/, 'H')
    .replace(/dzh|dj|zh|g(?=[eiy])|j|g$/g, 'J')
    .replace(/ck|q|c(?![eiyh])/g, 'k')
    .replace(/c/g, 's')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/w/g, 'v')
    .replace(/x/g, 'ks')
    .replace(/[aeiouyh]/g, '')
    .replace(/(.)\1+/g, '$1');
  return s.toLowerCase();
}

function skeletonEq(a, b) {
  const x = nameSkeleton(a);
  return x.length >= MIN_TOKEN && x === nameSkeleton(b);
}

// --- мелочи -----------------------------------------------------------------

const ORDER = [STOP_USER, STOP_INSTITUTION, STOP_PRESET, STOP_CHAR];
const rank = (kind) => {
  const i = ORDER.indexOf(kind);
  return i < 0 ? ORDER.length : i;
};

/** Стоп-лист принимается и готовым, и сырым входом `stopList`, и списком строк. */
function asList(stop) {
  if (!stop) return [];
  if (Array.isArray(stop)) {
    return stop.flatMap((s) => (typeof s === 'string' ? stopList({ preset: { stopNames: [s] } }) : [s]))
      .filter((s) => s && typeof s.norm === 'string');
  }
  if (typeof stop === 'object') return stopList(stop);
  return [];
}

/**
 * Ключ сравнения имён. Та же идея, что `norm` в `parse-marker`: регистр,
 * «ё»/«е», подчёркивание и пробел — одно и то же. Плюс дефис и точка как
 * разделители слов: «Анна-Мария», «А.Петрова».
 */
export function normName(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[_\-.,;:!?"'«»()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

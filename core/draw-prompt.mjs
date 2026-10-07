// core/draw-prompt — промпт для «Нарисовать портрет» (аватарки, шаг 4).
//
// Промпт собирается шаблоном из полей человека, без запроса к модели: лишний
// запрос — лишние секунды и лишние деньги, а портрету хватает того, что уже
// лежит в карточке. Имени в промпте нет: художнику оно ничего не говорит, а
// генераторы картинок любят вписывать его буквами.
//
// Две формы одного и того же:
//
// - **теги** для NovelAI и прочих SD-подобных: английские, через запятую, с
//   качеством впереди и негативом отдельно. Русский текст в теги не идёт
//   никогда: NAI его не понимает и рисует мусор. В теги попадает только то, что
//   нашлось в словарях ниже, и своё описание внешности — если оно уже латиницей;
// - **фраза** для GPT, Nano Banana и Imagen: одна-две фразы по-английски. Им
//   можно подсказать и русским — черты и своё описание внешности уходят в
//   кавычках как есть, эти модели русский понимают.
//
// Сеттинг — по id пресета: у каждого заведения своя одежда и свой фон
// (`SETTING_LOOKS`). Пресет человека (свой, не из коробки) — общий «академия».
//
// Пол — по имени (`scene.genderOfName`) или по словам в описании внешности;
// не знаем — нейтрально: без 1girl/1boy и «person» во фразе.

import { genderOfName } from './scene.mjs';
import { normalizeLooks } from './portraits.mjs';

// Своё описание внешности живёт в состоянии, его нормализация — рядом с
// остальным про портреты; отсюда — по старому адресу для удобства.
export { LOOKS_MAX, normalizeLooks } from './portraits.mjs';

/** Стили рисования. Умолчание — аниме. */
export const DRAW_STYLES = {
  anime: {
    tags: [],
    text: 'painterly anime style',
  },
  realism: {
    tags: ['realistic', 'photorealistic', 'detailed skin'],
    text: 'realistic digital painting, natural colors',
  },
  watercolor: {
    tags: ['watercolor (medium)', 'traditional media', 'soft colors'],
    text: 'soft watercolor illustration, delicate brush strokes',
  },
};

export const DEFAULT_DRAW_STYLE = 'anime';

/** Качество впереди тегов NAI V4/4.5 (разбор, «Промпт портрета»). */
export const NAI_QUALITY = ['masterpiece', 'best quality', 'very aesthetic'];

/** Негатив NAI — из разбора, плюс подписи и рамки, которые портрету не нужны. */
export const NAI_NEGATIVE = [
  'lowres', 'bad anatomy', 'bad hands', 'extra digits', 'fewer digits', 'text', 'watermark',
  'signature', 'blurry', 'jpeg artifacts', 'multiple views', 'nsfw',
];

/**
 * Одежда и фон по id пресета: `student`, `teacher` — одежда; `studentF`,
 * `studentM` — если у формы есть пол (сейлор-фуку и гакуран); `bg` — фон,
 * размытый за плечами. Коротко: портрет — лицо, а не каталог одежды.
 */
export const SETTING_LOOKS = {
  'magic-academy': {
    student: { tags: ['academy robe', 'black robe', 'magic school uniform'], text: 'a black magic-academy robe' },
    teacher: { tags: ['wizard robe', 'ornate robe'], text: 'an ornate wizard robe' },
    bg: { tags: ['library', 'candlelight'], text: 'an old magic library with candlelight' },
  },
  'jp-highschool': {
    student: { tags: ['school uniform', 'blazer'], text: 'a Japanese school uniform with a blazer' },
    studentF: { tags: ['serafuku', 'sailor collar', 'school uniform'], text: 'a sailor-style school uniform (sailor fuku)' },
    studentM: { tags: ['gakuran', 'black school uniform'], text: 'a black gakuran school uniform' },
    teacher: { tags: ['suit', 'collared shirt'], text: 'a neat suit' },
    bg: { tags: ['classroom', 'window'], text: 'a Japanese classroom with sunlit windows' },
  },
  'cn-highschool': {
    student: { tags: ['school uniform', 'track jacket'], text: 'a Chinese high-school tracksuit uniform' },
    teacher: { tags: ['white shirt', 'cardigan'], text: 'a white shirt and a cardigan' },
    bg: { tags: ['classroom', 'chalkboard'], text: 'a classroom with a chalkboard' },
  },
  'space-academy': {
    student: { tags: ['cadet uniform', 'futuristic uniform', 'bodysuit'], text: 'a futuristic space-cadet uniform' },
    teacher: { tags: ['officer uniform', 'futuristic uniform', 'insignia'], text: 'a futuristic officer uniform with insignia' },
    bg: { tags: ['spaceship interior', 'stars'], text: 'a starship corridor with stars outside' },
  },
  'xianxia-sect': {
    student: { tags: ['hanfu', 'chinese clothes', 'white robe'], text: 'a flowing white hanfu of a sect disciple' },
    teacher: { tags: ['hanfu', 'flowing robes', 'hair ornament'], text: 'flowing elder robes (hanfu) and a hair ornament' },
    bg: { tags: ['misty mountains', 'east asian architecture'], text: 'misty mountains and a sect pavilion' },
  },
  'cadet-academy': {
    student: { tags: ['military uniform', 'cadet uniform', 'epaulettes'], text: 'a cadet military uniform with epaulettes' },
    teacher: { tags: ['military uniform', 'officer', 'medal'], text: 'an officer uniform with medals' },
    bg: { tags: ['indoors', 'flag'], text: 'an academy hall with banners' },
  },
  'dark-academia': {
    student: { tags: ['tweed blazer', 'turtleneck', 'sweater vest'], text: 'a tweed blazer over a turtleneck' },
    teacher: { tags: ['tweed jacket', 'waistcoat', 'necktie'], text: 'a tweed jacket and a waistcoat' },
    bg: { tags: ['library', 'bookshelf', 'dim lighting'], text: 'a dim old library with tall bookshelves' },
  },
  'hero-academy': {
    student: { tags: ['school uniform', 'hero costume'], text: 'a hero-academy uniform with costume details' },
    teacher: { tags: ['hero costume', 'cape'], text: 'a pro-hero costume with a cape' },
    bg: { tags: ['training ground', 'city'], text: 'a training ground with a city skyline' },
  },
  'ru-school': {
    student: { tags: ['school uniform', 'white shirt', 'vest'], text: 'a Russian school uniform with a white shirt' },
    studentF: { tags: ['school uniform', 'white blouse', 'pinafore dress'], text: 'a Russian school uniform with a white blouse' },
    studentM: { tags: ['school uniform', 'suit jacket', 'white shirt'], text: 'a dark school suit with a white shirt' },
    teacher: { tags: ['cardigan', 'collared shirt'], text: 'a cardigan over a collared shirt' },
    bg: { tags: ['classroom', 'chalkboard'], text: 'a school classroom with a chalkboard' },
  },
  'ru-university': {
    student: { tags: ['casual clothes', 'sweater'], text: 'casual student clothes and a sweater' },
    teacher: { tags: ['formal clothes', 'blazer'], text: 'a formal blazer' },
    bg: { tags: ['lecture hall'], text: 'a university lecture hall' },
  },
  'us-college': {
    student: { tags: ['hoodie', 'casual clothes'], text: 'a college hoodie' },
    teacher: { tags: ['blazer', 'collared shirt'], text: 'a blazer over a collared shirt' },
    bg: { tags: ['campus', 'trees'], text: 'a college campus with trees' },
  },
  'us-highschool': {
    student: { tags: ['letterman jacket', 'casual clothes'], text: 'a letterman jacket' },
    teacher: { tags: ['button-up shirt', 'cardigan'], text: 'a button-up shirt and a cardigan' },
    bg: { tags: ['school hallway', 'lockers'], text: 'a school hallway with lockers' },
  },
};

/** Пресет не из коробки — общая «академия». */
export const SETTING_FALLBACK = {
  student: { tags: ['school uniform'], text: 'an academy uniform' },
  teacher: { tags: ['formal clothes'], text: 'formal academic clothes' },
  bg: { tags: ['indoors', 'academy'], text: 'an academy hall' },
};

/*
 * Словари: русский корень → тег NAI и слова для фразы. Корни — без `\b`: он
 * в JS не видит кириллицы. Порядок важен: берётся первое совпадение там, где
 * нужно одно (выражение лица), и все — там, где их может быть несколько
 * (внешность), но не больше потолка.
 */

/** Предмет преподавателя: что он ведёт и что у него в руках. */
export const SUBJECT_WORDS = [
  { re: /зель|алхим/, text: 'potions', tags: ['holding potion', 'glass bottle'] },
  { re: /матем|алгебр|геометр|матан|анализ/, text: 'mathematics', tags: ['holding chalk'] },
  { re: /хими/, text: 'chemistry', tags: ['labcoat'] },
  { re: /физик(?!.*культ)/, text: 'physics', tags: [] },
  { re: /астроном|звёзд|звезд/, text: 'astronomy', tags: ['starry sky'] },
  { re: /истор/, text: 'history', tags: ['holding book'] },
  { re: /литератур|словесн|поэз/, text: 'literature', tags: ['holding book'] },
  { re: /язык|лингв|грамматик/, text: 'languages', tags: ['holding book'] },
  { re: /биолог|ботан|травол|гербол/, text: 'herbology and biology', tags: ['plant'] },
  { re: /рун/, text: 'runes', tags: ['glowing runes'] },
  { re: /заклин|чар|магия|магии|колдов|волшеб/, text: 'spellcasting', tags: ['magic', 'glowing hand'] },
  { re: /медицин|лекар|анатом|целител/, text: 'medicine', tags: ['labcoat'] },
  { re: /музык|пени|вокал/, text: 'music', tags: ['sheet music'] },
  { re: /рисова|живопис|изобраз|искусств/, text: 'art', tags: ['holding paintbrush'] },
  { re: /физкульт|физическ|спорт|фехтов|боев|единоборств|рукопаш/, text: 'physical training', tags: ['whistle'] },
  { re: /информат|программ|кибер/, text: 'computer science', tags: [] },
  { re: /философ/, text: 'philosophy', tags: [] },
  { re: /эконом|финанс/, text: 'economics', tags: [] },
  { re: /прав[оа]|юрис/, text: 'law', tags: [] },
  { re: /пилот|навигац|лётн|летн/, text: 'piloting', tags: [] },
  { re: /тактик|стратег|военн/, text: 'tactics', tags: [] },
  { re: /культивац|медитац|дао|ци\s|меча/, text: 'cultivation', tags: [] },
];

/** Должность: кем он выглядит. */
export const POST_WORDS = [
  { re: /ректор|директор|декан/, text: 'dean' },
  { re: /завуч|заведующ|заместител/, text: 'head of department' },
  { re: /старейш|патриарх|глава/, text: 'sect elder' },
  { re: /профессор/, text: 'professor' },
  { re: /доцент/, text: 'associate professor' },
  { re: /библиотек|архив/, text: 'librarian' },
  { re: /куратор|классн/, text: 'class supervisor' },
  { re: /тренер|инструктор/, text: 'instructor' },
  { re: /капитан|полковник|майор|генерал|офицер/, text: 'officer' },
  { re: /мастер|наставник/, text: 'mentor' },
];

/** «Любит» — предмет в руках или рядом. Один-два, не больше. */
export const LIKES_WORDS = [
  { re: /книг|чтени|читать/, text: 'a book', tags: ['holding book'] },
  { re: /кофе/, text: 'a cup of coffee', tags: ['coffee cup'] },
  { re: /чай|чаю/, text: 'a teacup', tags: ['teacup'] },
  { re: /вин[оау]|вине/, text: 'a glass of wine', tags: ['wine glass'] },
  { re: /кош|кот[аеиоуы]?(?:\s|,|$)|котик/, text: 'a cat', tags: ['cat'] },
  { re: /сов[аыуе]|птиц/, text: 'an owl', tags: ['owl'] },
  { re: /цвет[ыоа]|роз[ыа]?(?:\s|,|$)|сад|орхиде/, text: 'flowers', tags: ['flower'] },
  { re: /музык|скрипк|гитар|пианин|рояль/, text: 'music', tags: ['musical note'] },
  { re: /картин|живопис/, text: 'paintings', tags: ['painting (object)'] },
  { re: /шахмат/, text: 'chess', tags: ['chess piece'] },
  { re: /шоколад|конфет|сладк|пирож/, text: 'sweets', tags: ['candy'] },
  { re: /трубк|табак|сигар/, text: 'a smoking pipe', tags: ['smoking pipe'] },
  { re: /меч|клинк|оружи/, text: 'a sword', tags: ['sword'] },
  { re: /звёзд|звезд|астроном/, text: 'stars', tags: ['star (symbol)'] },
];

/** Кружок однокурсника — чем он занят. */
export const CLUB_WORDS = [
  { re: /театр|драм/, text: 'the drama club', tags: ['theater mask'] },
  { re: /шахмат/, text: 'the chess club', tags: ['chess piece'] },
  { re: /хор|музык|оркестр|групп|вокал/, text: 'the music club', tags: ['musical note'] },
  { re: /фото/, text: 'the photography club', tags: ['holding camera'] },
  { re: /художеств|рисова|арт|живопис/, text: 'the art club', tags: ['holding paintbrush'] },
  { re: /литерат|книж|поэз/, text: 'the literature club', tags: ['holding book'] },
  { re: /газет|журнал|пресс/, text: 'the school newspaper', tags: ['holding notebook'] },
  { re: /науч|робот|физик|хими|астроном/, text: 'the science club', tags: [] },
  { re: /танц|балет/, text: 'the dance club', tags: [] },
  { re: /кулинар|готов/, text: 'the cooking club', tags: [] },
  { re: /фехтов|кендо|меч/, text: 'the fencing club', tags: [] },
  { re: /спорт|футбол|волейбол|баскетбол|плаван|лёгк|легк|бег/, text: 'a sports club', tags: ['sportswear'] },
];

/** Черты характера → выражение лица. Берётся первое. */
export const TRAIT_WORDS = [
  { re: /строг|суров|требоват/, text: 'a stern expression', tags: ['serious'] },
  { re: /холодн|надменн|высокомер|равнодуш/, text: 'a cold, aloof expression', tags: ['expressionless'] },
  { re: /хмур|мрачн|угрюм|ворчлив/, text: 'a gloomy frown', tags: ['frown'] },
  { re: /лукав|хитр|насмеш|ирони|язвит|саркаст/, text: 'a sly smirk', tags: ['smirk'] },
  { re: /застенч|робк|стеснит/, text: 'a shy look', tags: ['shy', 'blush'] },
  { re: /весел|жизнерад|бодр|задор/, text: 'a cheerful smile', tags: ['smile', 'cheerful'] },
  { re: /добр|мягк|ласков|заботл|терпел/, text: 'a gentle smile', tags: ['gentle smile'] },
  { re: /устал|сонн/, text: 'a tired look', tags: ['tired'] },
  { re: /рассеян|мечтат/, text: 'a dreamy look', tags: ['half-closed eyes'] },
  { re: /уверен|гордел|горд/, text: 'a confident look', tags: ['confident'] },
  { re: /серьёз|серьез|сдержан/, text: 'a calm, serious expression', tags: ['closed mouth'] },
];

/** Внешность — из своего описания и из черт. Несколько, до потолка. */
export const LOOKS_WORDS = [
  { re: /рыж/, text: 'red hair', tags: ['red hair'] },
  { re: /блонд|светловолос|светл\S*\s+волос|золотист\S*\s+волос/, text: 'blonde hair', tags: ['blonde hair'] },
  { re: /брюнет|черноволос|ч[её]рн\S*\s+волос|т[её]мн\S*\s+волос/, text: 'black hair', tags: ['black hair'] },
  { re: /шатен|каштан|русы|русая|русые/, text: 'brown hair', tags: ['brown hair'] },
  { re: /сед[аоыи]|седин|серебрист\S*\s+волос/, text: 'grey hair', tags: ['grey hair'] },
  { re: /бел\S*\s+волос|беловолос/, text: 'white hair', tags: ['white hair'] },
  { re: /розов\S*\s+волос/, text: 'pink hair', tags: ['pink hair'] },
  { re: /(?:син|голуб)\S*\s+волос/, text: 'blue hair', tags: ['blue hair'] },
  { re: /коротк\S*\s+(?:волос|стрижк)|стрижк|каре/, text: 'short hair', tags: ['short hair'] },
  { re: /длинн\S*\s+(?:волос|кос)/, text: 'long hair', tags: ['long hair'] },
  { re: /косичк|кос(?:а|у|ы|ой|ами)(?:\s|,|$)/, text: 'a braid', tags: ['braid'] },
  { re: /хвост/, text: 'a ponytail', tags: ['ponytail'] },
  { re: /пуч[оке]/, text: 'a hair bun', tags: ['hair bun'] },
  { re: /кудр|локон/, text: 'curly hair', tags: ['curly hair'] },
  { re: /(?:голуб|син)\S*\s+глаз/, text: 'blue eyes', tags: ['blue eyes'] },
  { re: /зел[её]н\S*\s+глаз/, text: 'green eyes', tags: ['green eyes'] },
  { re: /кар\S*\s+глаз/, text: 'brown eyes', tags: ['brown eyes'] },
  { re: /сер\S*\s+глаз/, text: 'grey eyes', tags: ['grey eyes'] },
  { re: /янтарн|золот\S*\s+глаз/, text: 'amber eyes', tags: ['yellow eyes'] },
  { re: /(?:красн|ал)\S*\s+глаз/, text: 'red eyes', tags: ['red eyes'] },
  { re: /очк|пенсне|монокл/, text: 'glasses', tags: ['glasses'] },
  { re: /бород/, text: 'a beard', tags: ['beard'] },
  { re: /усы|усат/, text: 'a mustache', tags: ['mustache'] },
  { re: /веснуш/, text: 'freckles', tags: ['freckles'] },
  { re: /шрам/, text: 'a scar', tags: ['scar'] },
  { re: /серьг/, text: 'earrings', tags: ['earrings'] },
  { re: /родинк/, text: 'a beauty mark', tags: ['mole'] },
  { re: /татуир|тату/, text: 'a tattoo', tags: ['tattoo'] },
  { re: /повязк\S*\s+на\s+глаз/, text: 'an eyepatch', tags: ['eyepatch'] },
  { re: /пожил|стар(?:ый|ая|ик|уш)|в\s+возраст/, text: 'elderly', tags: ['old'] },
];

/** Пол по словам описания — если имя промолчало. */
const GENDER_WORDS = [
  { re: /девушк|женщин|девочк|дама|старушк/, g: 'f' },
  { re: /парен|мужчин|мальчик|юнош|старик|мужик/, g: 'm' },
  { re: /(?:^|[\s,])(?:girl|woman|female|1girl)(?:$|[\s,])/i, g: 'f' },
  { re: /(?:^|[\s,])(?:boy|man|male|1boy)(?:$|[\s,])/i, g: 'm' },
];

/** Сколько примет внешности и предметов брать — портрет, а не перечень. */
const LOOKS_CAP = 6;
const PROPS_CAP = 2;

const CYRILLIC = /[Ѐ-ӿ]/;

/** Есть ли в строке кириллица — тогда в теги NAI она не пойдёт. */
export function hasCyrillic(s) {
  return CYRILLIC.test(String(s || ''));
}

const low = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е');

/** Все совпадения словаря (без повторов, до `cap`). */
function matchAll(words, text, cap) {
  const s = low(text);
  const out = [];
  if (!s) return out;
  for (const w of words) {
    // Текст сверяется с «ё», заменённой на «е»: корни в словарях её допускают.
    if (w.re.test(s)) out.push(w);
    if (out.length >= cap) break;
  }
  return out;
}

const first = (words, text) => matchAll(words, text, 1)[0] || null;

/** Пол: 'f', 'm' или `null`. Явный `person.gender` — главнее. */
export function guessGender(person) {
  const p = person || {};
  if (p.gender === 'f' || p.gender === 'm') return p.gender;
  const looks = String(p.looks || '');
  for (const w of GENDER_WORDS) if (w.re.test(looks)) return w.g;
  return genderOfName(p.name) || null;
}

/** Своё описание латиницей — в теги, по запятым, без мусора. */
function latinTags(looks) {
  if (!looks || hasCyrillic(looks)) return [];
  return looks.split(/[,;]+/)
    .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9 ()'.-]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 12);
}

const uniq = (list) => {
  const seen = new Set();
  return list.filter((t) => {
    const k = String(t).toLowerCase();
    if (!t || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/**
 * Что известно о человеке для портрета — уже по-английски.
 *
 * @param {Object} person преподаватель или однокурсник из состояния
 * @param {Object} opts
 * @param {'teacher'|'classmate'} opts.kind
 * @param {string[]} [opts.subjects] названия предметов преподавателя
 * @param {string} [opts.presetId] id пресета заведения
 * @param {string} [opts.basedOn] основа своего пресета — её одежда и фон
 */
export function portraitFacts(person, opts = {}) {
  const p = person || {};
  const kind = opts.kind === 'teacher' ? 'teacher' : 'classmate';
  const gender = guessGender(p);
  const setting = SETTING_LOOKS[opts.presetId] || SETTING_LOOKS[opts.basedOn] || SETTING_FALLBACK;
  const outfit = kind === 'teacher'
    ? setting.teacher
    : ((gender === 'f' && setting.studentF) || (gender === 'm' && setting.studentM) || setting.student);
  const looksRaw = normalizeLooks(p.looks);
  const traits = (Array.isArray(p.traits) ? p.traits : []).map((t) => String(t || '').trim()).filter(Boolean);
  const traitsText = traits.join(', ');

  const subjects = (opts.subjects || []).map(String).filter(Boolean);
  const subject = kind === 'teacher' ? first(SUBJECT_WORDS, subjects.join(' ')) : null;
  const post = kind === 'teacher' ? first(POST_WORDS, p.post) : null;
  const club = kind === 'classmate' ? first(CLUB_WORDS, p.club) : null;
  const likes = matchAll(LIKES_WORDS, p.likes, PROPS_CAP);
  const expression = first(TRAIT_WORDS, `${traitsText} ${looksRaw}`);
  const looks = matchAll(LOOKS_WORDS, `${looksRaw}, ${traitsText}`, LOOKS_CAP);

  return {
    kind, gender, outfit, bg: setting.bg, subject, post, club, likes, expression, looks,
    looksRaw, looksLatin: latinTags(looksRaw), traitsText,
  };
}

/**
 * Теги NovelAI. Кириллицы в них нет никогда: только словари и своё описание,
 * если оно уже латиницей.
 *
 * @returns {{prompt: string, negative: string}}
 */
export function naiPrompt(facts, style = DEFAULT_DRAW_STYLE) {
  const f = facts;
  const st = DRAW_STYLES[style] || DRAW_STYLES[DEFAULT_DRAW_STYLE];
  const who = f.gender === 'f' ? ['1girl'] : f.gender === 'm' ? ['1boy'] : [];
  const age = f.kind === 'teacher'
    ? [f.gender === 'f' ? 'mature female' : f.gender === 'm' ? 'mature male' : 'adult']
    : [];
  const props = [
    ...(f.subject ? f.subject.tags : []),
    ...(f.club ? f.club.tags : []),
    ...f.likes.flatMap((w) => w.tags),
  ].slice(0, PROPS_CAP + 1);
  const tags = uniq([
    ...NAI_QUALITY,
    ...who, ...age,
    'solo', 'portrait', 'upper body', 'looking at viewer',
    ...f.looks.flatMap((w) => w.tags),
    ...f.looksLatin,
    ...(f.expression ? f.expression.tags : []),
    ...f.outfit.tags,
    ...props,
    ...st.tags,
    'blurry background', ...f.bg.tags,
  ]).filter((t) => !hasCyrillic(t));
  const negative = [...NAI_NEGATIVE, ...(style === 'realism' ? ['anime', 'cartoon'] : [])];
  return { prompt: tags.join(', '), negative: negative.join(', ') };
}

/** «a», «an» — по первой букве. */
const article = (word) => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

const listText = (items) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/** Кавычки внутри своего текста — ёлочками, чтобы не ломать фразу. */
const quoted = (s) => `"${String(s).replace(/"/g, '”')}"`;

/**
 * Фраза для GPT, Nano Banana и Imagen: одна-две фразы по-английски. Черты и
 * своё описание внешности по-русски — в кавычках как есть.
 *
 * @returns {string}
 */
export function phrasePrompt(facts, style = DEFAULT_DRAW_STYLE) {
  const f = facts;
  const st = DRAW_STYLES[style] || DRAW_STYLES[DEFAULT_DRAW_STYLE];
  let who;
  if (f.kind === 'teacher') {
    const noun = f.gender === 'f' ? 'woman' : f.gender === 'm' ? 'man' : 'person';
    const role = f.post ? f.post.text : 'teacher';
    who = `${article(`adult ${noun}`)}, ${article(role)}${f.subject ? ` who teaches ${f.subject.text}` : ''}`;
  } else {
    const noun = f.gender === 'f' ? 'young woman' : f.gender === 'm' ? 'young man' : 'young person';
    who = `${article(noun)}, a student${f.club ? ` from ${f.club.text}` : ''}`;
  }
  const parts = [`Head-and-shoulders portrait of ${who}`];
  const looks = [...f.looks.map((w) => w.text), ...(f.looksLatin.length && !hasCyrillic(f.looksRaw) ? [f.looksRaw] : [])];
  if (looks.length) parts.push(`with ${listText(looks)}`);
  parts.push(`wearing ${f.outfit.text}`);
  if (f.expression) parts.push(`with ${f.expression.text}`);
  const props = f.likes.map((w) => w.text);
  if (props.length) parts.push(`with ${listText(props)} nearby`);
  parts.push(`${f.bg.text} softly blurred in the background`);
  parts.push(`soft lighting, ${st.text}, no text, no watermark`);
  let out = `${parts.join(', ')}.`;
  const extra = [];
  if (f.looksRaw && hasCyrillic(f.looksRaw)) extra.push(`Appearance (in Russian): ${quoted(f.looksRaw)}`);
  if (f.traitsText && hasCyrillic(f.traitsText)) extra.push(`Character (in Russian): ${quoted(f.traitsText)}`);
  if (extra.length) out += ` ${extra.join('. ')}.`;
  return out;
}

/**
 * Обе формы сразу — их выбирает путь рисования.
 *
 * @param {Object} person
 * @param {{kind: 'teacher'|'classmate', subjects?: string[], presetId?: string, style?: string}} opts
 * @returns {{tags: string, negative: string, text: string, facts: Object}}
 */
export function buildPortraitPrompt(person, opts = {}) {
  const style = DRAW_STYLES[opts.style] ? opts.style : DEFAULT_DRAW_STYLE;
  const facts = portraitFacts(person, opts);
  const nai = naiPrompt(facts, style);
  return { tags: nai.prompt, negative: nai.negative, text: phrasePrompt(facts, style), facts };
}

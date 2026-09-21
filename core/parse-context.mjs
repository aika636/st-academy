// core/parse-context — распознавание времени в тексте поста (источник A из 3.2).
//
// Замер A (etap0-academy.md) показал, что время в постах есть почти всегда: 89%
// ответов модели, 95% в чатах с инфоблоком. Но носитель у него не тот, которого
// ждал план: ожидаемой формы «Время: 14:30» — 6.5%, а настоящий носитель это
// эмодзи-шапка `📅 Четверг, 19 октября 2023 | 🕰 20:45`. Весь словарь ниже взят
// из живых логов, ничего не выдумано.
//
// Модуль ничего не решает: он не двигает календарь, не додумывает год и не
// спорит с прошлым временем. Он отвечает на один вопрос — «что написано в этом
// посте» — и отдаёт находку вызывающему вместе с уверенностью в ней.

// --- снятие HTML -----------------------------------------------------------
// Требование 5 из «Что меняется в плане» замера A. Половина корпуса свёрстана
// HTML, время лежит ВНУТРИ тегов (`<b>Четверг, 19 октября 2023</b>`), а в
// атрибутах стоит инлайновый CSS — `line-height:1.3`, `padding:0.05`. Первая
// версия scan-time.mjs посчитала этот CSS за часы и показала фальшивые 47%
// сообщений с `HH:MM` вместо настоящих 42%. Отсюда порядок: сначала выбросить
// блоки размышления целиком, потом комментарии, потом снять теги вместе с
// атрибутами, оставив текст между ними.

/** Блоки размышления модели: в `mes` они есть, глазами их никто не читает. */
const THINK = /<(think|thinking|reasoning|CoD)\b[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * Тег вместе с атрибутами. Ограничение длины и запрет переноса строки внутри —
 * защита от «<» в прозе: незакрытая угловая скобка не должна съесть полпоста.
 * `<memo>` в списке выброшенных блоков нет намеренно: вопреки названию это
 * видимый подвал поста (38.9% сообщений), и часть инфоблоков живёт именно там.
 */
const TAG = /<\/?[a-zA-Z][^<>\n]{0,400}>/g;
const ENTITY = /&(?:nbsp|amp|lt|gt|quot|#\d{1,5}|[a-zA-Z]{2,8});/g;
/** HTML-комментарий: в нём живёт наша собственная метка, источник A её не читает. */
const COMMENT = /<!--[\s\S]*?-->/g;

/**
 * Только блоки размышления, без остального снятия. Нужно машинным тегам
 * соседей (`core/time-source.mjs`, источник A+): они живут в HTML-комментариях,
 * которые `cleanForScan` выбрасывает, поэтому читаются ДО него — но размышление
 * модели и там не в счёт: в `<think>` она охотно цитирует прошлый тег.
 */
export function dropThinking(mes) {
  if (typeof mes !== 'string' || !mes) return '';
  return mes.replace(THINK, ' ');
}

/** Снятие HTML перед разбором. Текст внутри тегов остаётся, атрибуты уходят. */
export function cleanForScan(mes) {
  if (typeof mes !== 'string' || !mes) return '';
  return mes
    .replace(THINK, ' ')
    .replace(COMMENT, ' ')
    .replace(TAG, ' ')
    .replace(ENTITY, ' ')
    .replace(/[⠀ ️]/g, ' ')   // ⠀, неразрывный пробел, селектор эмодзи
    .replace(/[ \t]+/g, ' ');
}

// --- словарь ---------------------------------------------------------------
// Про \w и \b: под флагом `u` в JS они остаются ASCII, поэтому «октября» после
// «октябр» не добирается, а `\b` на границе кириллицы не срабатывает вовсе.
// Везде вместо них — `\p{L}` и явные просмотры назад и вперёд.

const L = '\\p{L}\\p{M}';
const NOTL = `(?<![${L}])`;
const ENDL = `(?![${L}])`;

/**
 * Месяцы. Русские — по основам с явно перечисленными окончаниями, а не по
 * основе с любым хвостом: «мар» с открытым хвостом ловит «маршрутов», и
 * «15 маршрутов» превращается в 15 марта. Английские — полные имена и
 * общепринятые сокращения, тоже без открытого хвоста.
 */
const MONTHS = [
  { n: 1, re: 'январ[ьяем]|янв' },
  { n: 2, re: 'феврал[ьяем]|фев' },
  { n: 3, re: 'март[аеу]|март|мар' },
  { n: 4, re: 'апрел[ьяем]|апр' },
  { n: 5, re: 'ма[йяею]' },
  { n: 6, re: 'июн[ьяем]|июн' },
  { n: 7, re: 'июл[ьяем]|июл' },
  { n: 8, re: 'август[аеу]|август|авг' },
  { n: 9, re: 'сентябр[ьяем]|сент|сен' },
  { n: 10, re: 'октябр[ьяем]|окт' },
  { n: 11, re: 'ноябр[ьяем]|ноя' },
  { n: 12, re: 'декабр[ьяем]|дек' },
  { n: 1, re: 'january|jan' },
  { n: 2, re: 'february|feb' },
  { n: 3, re: 'march|mar' },
  { n: 4, re: 'april|apr' },
  { n: 5, re: 'may' },
  { n: 6, re: 'june|jun' },
  { n: 7, re: 'july|jul' },
  { n: 8, re: 'august|aug' },
  { n: 9, re: 'september|sept|sep' },
  { n: 10, re: 'october|oct' },
  { n: 11, re: 'november|nov' },
  { n: 12, re: 'december|dec' },
];

const MONTH_ALT = MONTHS.map((m) => m.re).join('|');

function monthNumber(word) {
  const w = word.toLowerCase().replace(/\.$/, '');
  for (const m of MONTHS) if (new RegExp(`^(?:${m.re})$`, 'iu').test(w)) return m.n;
  return null;
}

/**
 * Дни недели словом. «сред» без окончания ловит «среди», «среднего», «средних» —
 * это одна из трёх ловушек замера A, поэтому окончания перечислены явно.
 */
const WDAY_WORDS = [
  { n: 1, re: 'понедельник[аму]?|monday' },
  { n: 2, re: 'вторник[аму]?|tuesday' },
  { n: 3, re: 'сред[аыеу]|wednesday' },
  { n: 4, re: 'четверг[аому]?|thursday' },
  { n: 5, re: 'пятниц[аыеу]|friday' },
  { n: 6, re: 'суббот[аыеу]|saturday' },
  { n: 7, re: 'воскресень[еяю]|sunday' },
];
const WDAY_WORD_RE = new RegExp(
  `${NOTL}(${WDAY_WORDS.map((w) => w.re).join('|')})${ENDL}`, 'iu',
);

/**
 * Дни недели сокращением — 30.4% сообщений, чаще, чем словом. Ловятся **только
 * перед датой**: в замере A сокращение всегда стояло в форме `СБ, 18 мая`, а
 * «ср» и «вс» в свободном тексте — это предлог и обычные слова, брать их нельзя.
 */
const WDAY_ABBR = [
  { n: 1, w: ['пн', 'mon'] }, { n: 2, w: ['вт', 'tue', 'tues'] },
  { n: 3, w: ['ср', 'wed'] }, { n: 4, w: ['чт', 'thu', 'thur', 'thurs'] },
  { n: 5, w: ['пт', 'fri'] }, { n: 6, w: ['сб', 'sat'] },
  { n: 7, w: ['вс', 'sun'] },
];
const WDAY_ABBR_RE = new RegExp(
  `${NOTL}(${WDAY_ABBR.flatMap((w) => w.w).join('|')})\\.?\\s*,?\\s+(?=\\d)`, 'iu',
);

/**
 * Часть суток словом — самый частый шаблон вообще (60.3%), но календарь он не
 * двигает: «вечером» не говорит, какой сегодня день. Только уточняет `daypart`.
 * «закат» и «рассвет» — существительными с закрытым окончанием: «закатились» —
 * это уже глагол, вторая ловушка замера A.
 */
const DAYPARTS = [
  { part: 'night', re: `ноч[ьиью]${ENDL}|ночью|полночь|midnight|night${ENDL}|nightfall` },
  { part: 'morning', re: `утр[оаеуы]${ENDL}|утром|рассвет[аеуы]?${ENDL}|morning|dawn` },
  { part: 'day', re: `днём|днем|полдень|afternoon|noon${ENDL}|midday` },
  { part: 'evening', re: `вечер[аеуом]*${ENDL}|сумерк[аиеу]${ENDL}|закат[аеуы]?${ENDL}|evening|dusk` },
];
const DAYPART_RE = new RegExp(
  `${NOTL}(?:${DAYPARTS.map((d) => `(?<${d.part}>${d.re})`).join('|')})`, 'iu',
);

/** Календарные эмодзи из шапок — 44.2% сообщений и 100% из них ответы модели. */
const EMOJI_RE = /[\u{1F4C5}\u{1F4C6}\u{1F5D3}\u{1F550}-\u{1F55B}\u{1F570}\u{23F0}\u{231A}\u{23F3}]/u;

/** Метка «Время:» / «Дата:» — сама по себе редка, но внутри шапки обычна. */
const LABEL_RE = new RegExp(
  `${NOTL}(?:врем[${L}]{0,3}|time|дата|date|день недели|weekday|timezone)\\s*[:：]`, 'iu',
);

/**
 * Часы. Разделитель только двоеточие: в scan-time.mjs он был `[:.]`, потому что
 * там задачей было переписать всё похожее, а здесь точка стоит слишком дорого —
 * `12.09` это дата без года, а не 12 часов 9 минут.
 * Просмотры по краям отсекают числа внутри более длинных наборов цифр.
 */
// Справа запрещены цифра, «:цифра» и «.цифра» — это отсекает `12:30:45` и
// версии вида `1:30.5`, но оставляет живое `15:40,` и `08:40.` в конце фразы:
// запрет любой запятой и точки (как в scan-time.mjs, где задача была другая)
// съедал бы каждое второе время в прозе.
const CLOCK_RE = new RegExp(`(?<![\\d${L}.:])([01]?\\d|2[0-3]):([0-5]\\d)(?!\\d|:\\d|\\.\\d)`, 'u');
/** `8:42 AM`, `5 PM`. 11% сообщений; в шапках вида `⏰ 8:42 AM | 🗓️ Sat 15 Jun 2024`. */
const AMPM_RE = /(?<![\d:.])(\d{1,2})(?::([0-5]\d))?\s?([ap])\.?\s?m\.?(?![a-z])/i;

/**
 * `2024/10/19`, `2024-10-19` — год впереди. Так пишет Horae (`time: 2024/10/19
 * 20:45`, замер A, «Вывод по этапу 0»), и до этой правки из его строки
 * бралось только время: `DATE_NUM_RE` ждёт день первым, дата молча терялась и
 * календарь двигался по часам внутри одного и того же дня. Разделитель обязан
 * повторяться (`\2`): `2024/10-19` — это уже не дата, а что-то чужое.
 */
const DATE_YMD_RE = /(?<![\d.,:/-])(\d{4})([./-])(0?[1-9]|1[0-2])\2(0?[1-9]|[12]\d|3[01])(?![\d./-])/;
/** `20.01.2025` — единственный случай даты цифрами с годом на 355 сообщений. */
const DATE_NUM_RE = /(?<![\d.,:/])(0?[1-9]|[12]\d|3[01])[./](0?[1-9]|1[0-2])[./](\d{4}|\d{2})(?![\d.])/;
/** `12.09` без года — ненадёжно (1.7%), поэтому только в шапке или у метки. */
const DATE_SHORT_RE = /(?<![\d.,:/])(0?[1-9]|[12]\d|3[01])\.(0?[1-9]|1[0-2])(?![\d./])/;
/** `19 октября 2023`, `18 мая 2024`, `12 Окт 2024`, `15 Jun 2024`. */
const DATE_DMY_RE = new RegExp(
  `${NOTL}(\\d{1,2})\\s+(${MONTH_ALT})\\.?${ENDL}(?:\\s*,?\\s*(\\d{4}))?`, 'iu',
);
/** `Jun 15 2024`, `October 19, 2023` — английский порядок. */
const DATE_MDY_RE = new RegExp(
  `${NOTL}(${MONTH_ALT})\\.?${ENDL}\\s+(\\d{1,2})(?:\\s*,?\\s*(\\d{4}))?`, 'iu',
);

/**
 * Счётчик «День 3». В корпусе — **ноль вхождений на 355 сообщений**, поэтому
 * ровно три строчки по остаточному принципу и только в шапке: в прозе «день 3»
 * с гораздо большей вероятностью кусок фразы, чем счётчик.
 */
const DAYNUM_RE = new RegExp(`${NOTL}(?:день|day|сутки)\\s*[№#]?\\s*(\\d{1,3})(?![\\d:.])`, 'iu');

// --- относительные сдвиги (по галочке, выключено) --------------------------
// 19.7% сообщений, но это проза, а не переходы сцены: «через час», «через
// несколько минут», «через два года» стоят в середине повествования. Плюс к
// тому, переходов «время стоит» в замере ноль — двигать календарь словами не
// требуется вовсе. Отсюда `opts.relative` по умолчанию false (3.2).

const NUMWORDS = new Map(Object.entries({
  'один': 1, 'одну': 1, 'одного': 1, 'два': 2, 'две': 2, 'двух': 2, 'пару': 2,
  'три': 3, 'трёх': 3, 'трех': 3, 'четыре': 4, 'пять': 5, 'шесть': 6,
  'семь': 7, 'восемь': 8, 'девять': 9, 'десять': 10, 'несколько': 2, 'нескольких': 2,
}));

const REL_UNITS = [
  { unit: 'minute', re: 'минут[уыа]?|минуток' },
  { unit: 'hour', re: 'час[аов]?|часок' },
  { unit: 'day', re: 'дня|дней|день|сутки|суток' },
  { unit: 'week', re: 'недел[юяьи]|недель' },
  { unit: 'month', re: 'месяц[аев]?' },
  { unit: 'year', re: 'год[аеу]?|лет' },
];
const REL_UNIT_ALT = REL_UNITS.map((u) => u.re).join('|');

const RELATIVE = [
  // «через N единиц», «спустя N единиц», «прошло N единиц»
  {
    re: new RegExp(
      `${NOTL}(?:через|спустя|прошл[оаи])\\s+(?:(\\d{1,3}|[${L}]+)\\s+)?(${REL_UNIT_ALT})${ENDL}`, 'iu',
    ),
    take: (m) => ({ unit: relUnit(m[2]), n: relCount(m[1]) }),
  },
  // «на следующее утро», «наутро», «назавтра», «next morning»
  {
    re: new RegExp(
      `${NOTL}(?:наутро|назавтра|на следующ[${L}]+\\s+(?:утро|день|вечер|ночь)|next\\s+(?:morning|day)|later\\s+that\\s+(?:day|evening|night))${ENDL}`, 'iu',
    ),
    take: () => ({ unit: 'day', n: 1 }),
  },
  { re: new RegExp(`${NOTL}(?:на следующ[${L}]+\\s+недел[${L}]+|next\\s+week)${ENDL}`, 'iu'), take: () => ({ unit: 'week', n: 1 }) },
  // «после пар», «после уроков» — сдвиг на конец учебного дня, единица «пара»
  {
    re: new RegExp(`${NOTL}(?:после\\s+(?:пар|уроков|занятий|лекций)|after\\s+(?:school|class(?:es)?|lessons?))${ENDL}`, 'iu'),
    take: () => ({ unit: 'period', n: 1 }),
  },
];

function relUnit(word) {
  const w = word.toLowerCase();
  for (const u of REL_UNITS) if (new RegExp(`^(?:${u.re})$`, 'iu').test(w)) return u.unit;
  return null;
}

function relCount(word) {
  if (!word) return 1;
  if (/^\d+$/.test(word)) return Number(word);
  return NUMWORDS.get(word.toLowerCase()) ?? 1;
}

// --- двузначный год (9.1.5) ------------------------------------------------
// До этой правки `14.09.87` превращалось в 2087: разбор делал `2000 + YY`. Scene
// State из BB-UI-Regex-Pack пишет `DD.MM.YY` в КАЖДОМ ответе, в том числе в
// отыгрышах про 1980-е и в фэнтези, и охрана прыжка (`time.setAbsolute`)
// спрашивала «принять прыжок на сто лет?» на каждом посте.
//
// Век не выдумывается, а выбирается: из трёх кандидатов (прошлый, этот и
// следующий век опорного года) берётся ближайший к опорному. Опорный год даёт
// вызывающий — год календаря, а если его нет, эпоха анкеты (`time-source`).
// Правило «ближайший» симметрично и не знает про «наши дни»: для календаря в
// 1986 году `87` — это 1987; для 2024 тоже 1987 (37 лет против 63 у 2087), а
// `25` при 2024 — 2025. Для фэнтези-календаря в 1247 году `48` — 1248, а не
// 2048. Граница — полвека в обе стороны от опорного года.

/**
 * Полный год по двум цифрам и опорному году.
 *
 * @param {number} yy  0..99
 * @param {number} [ref] опорный год; без него — прежнее `2000 + YY`
 * @returns {{year: number, guessed: boolean}} `guessed` — век достроен вслепую,
 *   без опоры. Такой год нельзя выдавать за написанный в тексте: «2087» из
 *   `14.09.87` доказывает только то, что опоры не было.
 */
export function resolveTwoDigitYear(yy, ref) {
  if (!Number.isFinite(ref)) return { year: 2000 + yy, guessed: true };
  const base = Math.floor(ref / 100) * 100;
  let best = null;
  for (const c of [base - 100 + yy, base + yy, base + 100 + yy]) {
    if (c < 0) continue;
    // При равенстве остаётся первый, то есть более ранний век: запись без века
    // скорее про уже прожитое, чем про то, что будет через полвека.
    if (best === null || Math.abs(c - ref) < Math.abs(best - ref)) best = c;
  }
  return { year: best, guessed: false };
}

// --- разбор ----------------------------------------------------------------

/**
 * Что написано о времени в этом посте.
 *
 * Приоритет — правка 3.2 из замера A, сверху вниз, и это главное в модуле:
 *
 *   1. метка или эмодзи-шапка в первых трёх строках — берём всегда;
 *   2. дата и часы рядом в одной строке где угодно в посте — берём;
 *   3. одинокие часы в прозе — только если строка короткая (≤80) и стоит с краю;
 *   4. часть суток словом — календарь не двигает, уточняет `daypart`;
 *   5. относительные сдвиги — по галочке, выключено.
 *
 * @param {string} text  сообщение, можно сырое: HTML снимается внутри
 * @param {Object} [opts]
 * @param {boolean} [opts.relative=false] включить относительные сдвиги словами
 * @param {number}  [opts.year] год для дат без года
 * @param {number}  [opts.refYear] опорный год для двузначного года (`14.09.87`):
 *   век выбирается ближайший к нему (9.1.5). Без него берётся `opts.year` —
 *   это тот же год календаря, который вызывающий и так передаёт.
 * @param {boolean} [opts.clean=true] снимать HTML (false — текст уже чистый)
 * @returns {?{day: ?string, time: ?string, daypart: ?string, weekday: ?number,
 *             confidence: number, source: string, matched: string,
 *             dateParts: ?{year: ?number, month: number, day: number},
 *             yearFromText: boolean,
 *             dayIndex?: number, relative?: {unit: string, n: number}}}
 */
export function parseContext(text, opts = {}) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const clean = opts.clean === false ? text : cleanForScan(text);
  // Опорный год для двузначного — один на весь пост, поэтому он кладётся в
  // `ref` и едет в `scanLine` параметром, а не читается из `opts` по дороге.
  const refRaw = opts.refYear !== undefined ? opts.refYear : opts.year;
  const ref = typeof refRaw === 'number' && Number.isFinite(refRaw) ? refRaw : undefined;
  const lines = clean.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!lines.length) return null;

  const isEdge = (i) => i < 3 || i >= lines.length - 3;

  // (1) шапка: метка или эмодзи в первых трёх строках. Здесь разрешено всё,
  // включая дату цифрами без года и счётчик «День N»: контекст явный.
  for (let i = 0; i < Math.min(3, lines.length); i++) {
    if (!isHeader(lines[i])) continue;
    const r = scanLine(lines[i], true, ref);
    if (r) return build(r, 'header', 0.9, lines[i], opts);
  }

  // (2) дата и часы рядом в одной строке — где угодно в посте.
  for (const line of lines) {
    const r = scanLine(line, false, ref);
    if (r && r.date && r.time) return build(r, 'line', 0.8, line, opts);
  }

  // (2б) метка или эмодзи не в первых трёх строках: подвал поста, 5.3% случаев.
  // Формально это всё ещё «явный отправитель», просто стоит ниже.
  for (let i = 3; i < lines.length; i++) {
    if (!isHeader(lines[i])) continue;
    const r = scanLine(lines[i], true, ref);
    if (r && (r.date || r.time || r.dayIndex !== null)) return build(r, 'label', 0.7, lines[i], opts);
  }

  // (3) одинокие часы (или одинокая дата) в прозе — только короткая строка с
  // краю поста. Правило отрезает больше половины найденного, и это намеренно:
  // середина поста — самая ненадёжная часть корпуса.
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length > 80 || !isEdge(i)) continue;
    const r = scanLine(lines[i], false, ref);
    if (r && (r.time || r.date)) return build(r, 'edge', 0.5, lines[i], opts);
  }

  // (4) часть суток словом: календарь не двигается, заполняется только daypart.
  for (const line of lines) {
    const m = line.match(DAYPART_RE);
    if (!m) continue;
    return {
      day: null, time: null, daypart: daypartOf(m), weekday: null,
      confidence: 0.3, source: 'daypart', matched: m[0], dateParts: null,
    };
  }

  // (5) относительные сдвиги — только по явной галочке.
  if (opts.relative) {
    for (const line of lines) {
      for (const rule of RELATIVE) {
        const m = line.match(rule.re);
        if (!m) continue;
        const rel = rule.take(m);
        if (!rel.unit) continue;
        return {
          day: null, time: null, daypart: null, weekday: null,
          confidence: 0.2, source: 'relative', matched: m[0], dateParts: null,
          relative: rel,
        };
      }
    }
  }

  return null;
}

/** Строка похожа на шапку: календарный эмодзи или метка «Ключ:». */
function isHeader(line) {
  return EMOJI_RE.test(line) || LABEL_RE.test(line);
}

/**
 * Всё, что нашлось в одной строке. `loose` включает формы, которые в свободном
 * тексте брать нельзя: дату цифрами без года и счётчик «День N».
 */
function scanLine(line, loose, ref) {
  const time = scanTime(line);
  const date = scanDate(line, loose, ref);
  const dp = line.match(DAYPART_RE);
  const dayIndex = loose ? scanDayIndex(line) : null;
  // сокращение дня недели ищется только там, где дата действительно нашлась:
  // «Вс 15 человек ждали» датой не является, а `вс` в нём — обычное слово
  const weekday = scanWeekday(line, Boolean(date));

  if (!time && !date && !dp && dayIndex === null && weekday === null) return null;
  return { time, date, daypart: dp ? daypartOf(dp) : null, weekday, dayIndex };
}

/**
 * Часы. Сначала `HH:MM`, потом am/pm.
 *
 * `17:30 (5:30 PM)` — две записи одного времени в одной строке, берётся первая.
 * Суффикс am/pm проверяется вплотную за найденными часами: в шапке
 * `⏰ 8:42 AM` двоеточие есть, и без этой проверки утро превратилось бы в 08:42
 * только по счастливой случайности, а `8:42 PM` — в неверные 08:42.
 */
function scanTime(line) {
  const m = line.match(CLOCK_RE);
  if (m) {
    let h = Number(m[1]);
    const tail = line.slice(m.index + m[0].length, m.index + m[0].length + 5);
    const ap = tail.match(/^\s?([ap])\.?\s?m\.?/i);
    if (ap) h = to24(h, ap[1]);
    return hhmm(h, Number(m[2]));
  }
  const a = line.match(AMPM_RE);
  if (a) return hhmm(to24(Number(a[1]), a[3]), a[2] ? Number(a[2]) : 0);
  return null;
}

function to24(h, ap) {
  const pm = ap.toLowerCase() === 'p';
  if (pm) return h === 12 ? 12 : h + 12;
  return h === 12 ? 0 : h;
}

function hhmm(h, m) {
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Дата: цифрами с годом (в обоих порядках), словами в обоих порядках, и —
 * только в шапке — `12.09`. Двузначный год достраивается по `ref` (9.1.5);
 * `guessed` уезжает в `build` и снимает с года звание «написан в тексте».
 */
function scanDate(line, loose, ref) {
  let m = line.match(DATE_YMD_RE);
  if (m) return { year: Number(m[1]), month: Number(m[3]), day: Number(m[4]) };
  m = line.match(DATE_NUM_RE);
  if (m) {
    if (m[3].length === 2) {
      const y = resolveTwoDigitYear(Number(m[3]), ref);
      return { year: y.year, month: Number(m[2]), day: Number(m[1]), guessed: y.guessed };
    }
    return { year: Number(m[3]), month: Number(m[2]), day: Number(m[1]) };
  }
  m = line.match(DATE_DMY_RE);
  if (m) {
    const mon = monthNumber(m[2]);
    if (mon) return { year: m[3] ? Number(m[3]) : null, month: mon, day: Number(m[1]) };
  }
  m = line.match(DATE_MDY_RE);
  if (m) {
    const mon = monthNumber(m[1]);
    if (mon) return { year: m[3] ? Number(m[3]) : null, month: mon, day: Number(m[2]) };
  }
  if (loose) {
    m = line.match(DATE_SHORT_RE);
    if (m) return { year: null, month: Number(m[2]), day: Number(m[1]) };
  }
  return null;
}

/** День недели: словом где угодно, сокращением — только вплотную перед датой. */
function scanWeekday(line, hasDate) {
  const w = line.match(WDAY_WORD_RE);
  if (w) {
    const key = w[1].toLowerCase();
    for (const d of WDAY_WORDS) if (new RegExp(`^(?:${d.re})$`, 'iu').test(key)) return d.n;
  }
  if (!hasDate) return null;
  const a = line.match(WDAY_ABBR_RE);
  if (a) {
    const key = a[1].toLowerCase();
    for (const d of WDAY_ABBR) if (d.w.includes(key)) return d.n;
  }
  return null;
}

function scanDayIndex(line) {
  const m = line.match(DAYNUM_RE);
  return m ? Number(m[1]) : null;
}

/** Какая из именованных групп сработала — так daypart остаётся одним словом. */
function daypartOf(m) {
  if (!m.groups) return null;
  for (const [name, val] of Object.entries(m.groups)) if (val !== undefined) return name;
  return null;
}

/**
 * Сборка ответа. Год берётся из самой даты, иначе из `opts.year`; если года нет
 * ниоткуда — `day` остаётся null, а разобранные день и месяц уезжают в
 * `dateParts`, чтобы вызывающий подставил год сам. Додумывать год здесь нельзя:
 * расширение не имеет права выдумывать дату (3.2).
 */
function build(r, source, confidence, matched, opts) {
  const parts = r.date
    ? { year: r.date.year ?? (typeof opts.year === 'number' ? opts.year : null), month: r.date.month, day: r.date.day }
    : null;

  const out = {
    day: parts && parts.year !== null ? iso(parts) : null,
    time: r.time || null,
    daypart: r.daypart || null,
    weekday: r.weekday,
    confidence,
    source,
    matched,
    dateParts: parts,
    // Год написан в самом тексте или подставлен вызывающим из `opts.year`.
    // Различать обязательно: подставленный год вызывающий вправе поправить на
    // переходе через Новый год, написанный руками — не вправе никогда.
    //
    // Двузначный год без опоры (`guessed`) написанным не считается: век в нём
    // додуман, и `index.js:startDayHint`, который заводит семестр только по
    // году «из текста», не должен начинать отыгрыш про 1987-й в 2087-м.
    yearFromText: Boolean(r.date && r.date.year !== null && r.date.year !== undefined && !r.date.guessed),
  };
  if (r.dayIndex !== null && r.dayIndex !== undefined) out.dayIndex = r.dayIndex;
  return out;
}

function iso({ year, month, day }) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

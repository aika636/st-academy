// core/parse-marker — разбор служебной метки расширения (источник B из 3.2).
//
// Метка стоит отдельной строкой ответа модели (инструкция просит первую, см.
// `prompt.DEFAULT_PROMPTS`) и невидима в чате: DOMPurify
// выбрасывает HTML-комментарии из отображения, но оставляет их в `mes`
// (3.1 плана). Отсюда два следствия, которые здесь и реализованы:
//
//   * сообщение никогда не редактируется. `stripMarker` нужен только для чтения
//     (показать текст без метки, отдать текст источнику A), но не для записи
//     обратно в чат;
//   * разбор снисходительный. Метку пишет языковая модель, а не наш код: она
//     переставляет ключи, ставит пробелы вокруг «=», путает регистр, повторяет
//     ключ и время от времени выдумывает своё. Строгая грамматика здесь означала
//     бы «раз в десять постов теряем всё, что модель сказала».
//
// Четыре поправки замера B (etap0-academy.md, «Четыре поправки к формату»)
// учтены буквально — каждая помечена в коде ниже.

/**
 * Служебный блок целиком.
 *
 * Снисходительность к скобкам: канонический вид — `<!-- [ACADEMY …] -->`, но в
 * прогоне встречались и голые `[ACADEMY …]` без комментария (модель «помогла»
 * себе форматированием), и удвоенные скобки по аналогии с лорбуками. Поэтому
 * `\[{0,2}` внутри комментария и `\[{1,2}` без него: без комментария голое слово
 * ACADEMY брать нельзя, иначе меткой станет любое упоминание академии в прозе.
 *
 * Тело — ленивое `[\s\S]*?`: метка почти всегда однострочная, но перенос строки
 * внутри комментария не должен её ломать. Другого `<!--` в теле быть не может:
 * оборванная метка иначе дотянулась бы до чужого `-->` (тег соседнего
 * расширения) и утащила его в своё значение. Ограничитель `\]{0,2}\s*-->` съедает
 * закрывающие скобки, если они есть.
 */
import { impactWeight } from './relations.mjs';
import { stopList, stopHit, strictest, HARD_STOPS, STOP_USER, STOP_CHAR } from './stop-names.mjs';
import { sameName } from './classmates.mjs';
import { slugify } from './plan-gen.mjs';

export const MARKER_RE =
  /<!--\s*\[{0,2}\s*academy\b((?:(?!<!--)[\s\S])*?)\]{0,2}\s*-->|\[{1,2}\s*academy\b([^\]\n]*)\]{1,2}/gi;

// --- словарь ключей --------------------------------------------------------
// Русские имена в инструкции не предлагались, но модель к ним склонна, а стоят
// они три токена. Дешевле принять, чем потом разбирать жалобу «не считает».

const KEY_GROUPS = [
  { kind: 'time', names: ['t', 'time', 'время', 'врем'] },
  { kind: 'grade', names: ['grade', 'mark', 'оценка', 'оц'] },
  { kind: 'completion', names: ['completion'] },
  { kind: 'rel', names: ['rel', 'relation', 'отношение', 'отн'] },
  { kind: 'skip', names: ['skip', 'прогул', 'пропуск'] },
  { kind: 'late', names: ['late', 'опоздание', 'опоздал', 'опоздала'] },
  { kind: 'event', names: ['event', 'событие', 'праздник'] },
  // Курс (шаг 3, `nabrosok-odnokursniki.md` раздел 3): что секретарь увидел
  // в сцене про людей. Рассказчик эти ключи не пишет — его инструкция метки не
  // растёт, — но если напишет сам, разборщик их поймёт.
  { kind: 'met', names: ['met', 'был', 'была', 'встреча'] },
  { kind: 'clash', names: ['clash', 'стычка', 'ссора'] },
  { kind: 'rumor', names: ['rumor', 'слух'] },
  { kind: 'new', names: ['new', 'новый', 'новая', 'новенький', 'новенькая'] },
  { kind: 'deal', names: ['deal', 'дело', 'обещание'] },
  // Закрытое дело — тот же ключ с минусом, как у силы `minor-`: `deal-=…`.
  { kind: 'deal-', names: ['deal-', 'дело-', 'обещание-'] },
];

/** Как метка называет героиню в стычке, слухе и деле. Тот же знак, что у `tie.to` курса. */
export const HEROINE = '@heroine';

/**
 * Персонаж карточки как сторона факта (баг 79): `@card/Вандрел Харис`. Он не человек
 * академии — в «Люди» не попадает, id держит только имя, чтобы факт был о нём.
 */
export const CARD_PREFIX = '@card/';
export const isCardParty = (id) => String(id || '').startsWith(CARD_PREFIX);
export const cardPartyName = (id) => String(id || '').slice(CARD_PREFIX.length);

/**
 * Как назвать персонажа карточки в факте (баг 87). Имя карточки часто латиницей
 * («Vandrel Kharis»), а анкета русская: статисты коверкают («Вандрил»).
 *
 * 1. секретарь написал на языке анкеты — оставить его написание (оно уже
 *    совпало с алиасом, иначе стоп-лист его бы не узнал);
 * 2. иначе — первое написание того же человека на языке анкеты (`cast`:
 *    `[{name, aliases}]` из `settings.cardCasts`);
 * 3. иначе — имя карточки, как было.
 */
export function cardDisplayName(written, hitName, cast, lang) {
  const clean = (v) => String(v || '').replace(/[:=;]/g, ' ').replace(/\s+/g, ' ').trim();
  const cyr = /^(?:ru|uk|be|bg|sr|kk|mk)/i.test(String(lang || 'ru'));
  const fits = (v) => (cyr ? /[а-яё]/i.test(v) && !/[a-z]/i.test(v) : !/[а-яё]/i.test(v));
  const w = clean(written);
  if (w && fits(w)) return w;
  const h = clean(hitName);
  const key = (v) => clean(v).toLowerCase().replace(/ё/g, 'е');
  for (const person of Array.isArray(cast) ? cast : []) {
    const all = [person && person.name, ...((person && person.aliases) || [])].filter(Boolean);
    if (!all.some((n) => key(n) === key(h) || key(n) === key(w))) continue;
    const own = all.map(clean).find(fits);
    if (own) return own;
  }
  return h || w;
}

/** Слова, которыми модель зовёт героиню вместо знака. */
const HEROINE_WORDS = ['@heroine', 'heroine', '@hero', 'героиня', '@героиня', 'герой', '@герой'];

/** Потолки свободного текста курса: подпись, а не пересказ. */
export const SOCIAL_TEXT_MAX = { reason: 60, rumor: 100, deal: 60, name: 60 };

/** Пометки закрытого дела последним полем: `deal=a:b:конспект:закрыто`. */
const DEAL_CLOSED = /^(?:закрыт[оа]?|закрыли|вернул[аи]?|выполнен[оа]?|done|closed?|-)$/iu;

/**
 * Насколько далеко вперёд метка вправе заводить событие (`event=`): дальше
 * двух недель — уже не «скоро», а календарь, и в планы такое не пишется.
 */
export const EVENT_HORIZON = 13;

/** Потолок длины названия события — тот же, что у своего события чата. */
const EVENT_NAME_MAX = 80;

const KIND_BY_NAME = new Map();
for (const g of KEY_GROUPS) for (const n of g.names) KIND_BY_NAME.set(n, g.kind);

/**
 * Позиции ключей внутри блока — любых, а не только известных.
 *
 * **Поправка 1 замера B.** Разбивать блок по пробелам нельзя: модель пишет
 * `grade=аналитическая химия:4` — предмет из двух слов, и «пары через пробел»
 * разваливаются (4 испорченных значения из 11). Поэтому границы значения задаёт
 * не пробел, а позиция следующего ключа.
 *
 * Ключ здесь любой `слово=`, а не только знакомый: если границей считать только
 * известные имена, то выдуманный моделью `mood=веселье` уедет внутрь значения
 * предыдущего ключа и утащит его в rejected. По 3.1 неизвестный ключ
 * игнорируется молча — значит, чужое значение он обрывает, но событий не даёт.
 * Значение с «=» внутри формат метки не предполагает.
 *
 * `\b` под флагом `u` остаётся ASCII и на кириллице не работает — слева стоит
 * явный просмотр назад «не буква, не цифра, не подчёркивание».
 */
const KEY_RE = new RegExp(
  `(?<![\\p{L}\\p{M}\\d_])([\\p{L}\\d_-]{1,24})\\s*=\\s*`,
  'giu',
);

// --- сила отношения словом (9.3.4) ------------------------------------------
// `rel=петрова:minor-`, `rel=петрова:+major`, `rel=петрова:сильно-`. Вес слова —
// из пресета (`relations.impact`, см. `relations.impactWeight`), здесь только
// лексика. Словарь нарочно короткий: инструкция метки называет два английских
// слова, а русские синонимы — то, что модель пишет «от себя» в русской сцене.
// «Очень» сюда не взято: без знака оно встречалось как оценка отношения, а не
// сила, и должно по-прежнему уходить в rejected.
const IMPACT_WORDS = {
  minor: ['minor', 'small', 'слегка', 'чуть', 'немного'],
  major: ['major', 'big', 'сильно', 'крупно'],
};

const IMPACT_BY_WORD = new Map();
for (const [level, words] of Object.entries(IMPACT_WORDS)) for (const w of words) IMPACT_BY_WORD.set(w, level);

// --- единицы времени -------------------------------------------------------
// Хвост `[а-яё]*` намеренно короткий и привязан к основе: «+2 пары», «+день»,
// «+недели» пишутся моделью как попало, а вот выдуманное `+night` не должно
// случайно попасть ни в одну основу (поправка 4).
const TIME_UNITS = [
  { unit: 'week', re: /^(?:w|week|weeks|нед|недел[яиьюе]|недель)$/i },
  { unit: 'day', re: /^(?:d|day|days|д|день|дня|дней|сутки|суток)$/i },
  { unit: 'period', re: /^(?:p|period|periods|lesson|lessons|пара|пары|пар|урок|урока|уроков)$/i },
];

/**
 * Разбор служебной метки.
 *
 * Второй аргумент — источник лексики. Формально это пресет (шкала оценок), но
 * предметы и преподаватели живут в состоянии, а не в пресете, поэтому функция
 * принимает и то и другое: годится сам пресет, само состояние или склейка
 * `{...preset, subjects, teachers}`. Ищутся поля `grades`, `subjects`,
 * `teachers` — сначала в переданном объекте, потом в его `preset`.
 *
 * @param {string} text  сообщение целиком, как оно лежит в `mes`
 * @param {Object} preset пресет и/или состояние (см. выше)
 * @returns {{events: Array, rejected: Array<{raw: string, reason: string}>, found: boolean}}
 */
export function parseMarker(text, preset) {
  const events = [];
  const rejected = [];
  let found = false;

  if (typeof text !== 'string' || !text) return { events, rejected, found };

  const ctx = buildContext(preset);

  for (const m of text.matchAll(MARKER_RE)) {
    const body = m[1] !== undefined ? m[1] : m[2];
    if (body === undefined) continue;
    found = true;
    parseBody(body, ctx, events, rejected);
  }

  return { events, rejected, found };
}

/**
 * Текст без служебного блока: для показа в отладке и как вход источника A.
 * В чат этот текст не возвращается никогда — сообщение не редактируется.
 */
export function stripMarker(text) {
  if (typeof text !== 'string' || !text) return '';
  return text
    .replace(MARKER_RE, '')
    // после снятия метки остаётся пустая последняя строка и хвост пробелов
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '');
}

/**
 * Метки ответа, в которых оставлены только ключи нужных видов (`'time'`,
 * `'grade'`…), а прочие вычеркнуты. Нужна секретарю (`core/analysis`): когда
 * ответ разобран отдельным запросом, оценки и отношения берутся из разбора, а
 * из метки самой модели — только время, иначе одна пятёрка легла бы дважды.
 * Неизвестные ключи вычёркиваются тоже: разбор их всё равно не читает.
 */
export function keepMarkerKinds(text, kinds) {
  if (typeof text !== 'string' || !text) return '';
  const keep = new Set(kinds || []);
  return text.replace(MARKER_RE, (_, inComment, bare) => {
    const body = inComment !== undefined ? inComment : (bare || '');
    const kept = markerPairs(body).filter((p) => keep.has(p.kind)).map((p) => p.raw);
    return `<!-- [ACADEMY${kept.length ? ` ${kept.join(' ')}` : ''}] -->`;
  });
}

/**
 * Оборванная метка: `<!-- [ACADEMY …` без `-->`. Так выглядит ответ, у которого
 * кончился бюджет токенов (думающая модель тратит его на размышление): живой
 * прогон 10.10 — `<!-- [ACADEMY new=Гэвин … deal=@heroine:` и обрыв, а чужой
 * `<!-- NI … -->` строкой выше.
 *
 * Метка читается до конца ответа, до следующего `<!--` или до строки второго
 * блока («Что сочинено», `loud=`, `react=`, «Кратко»). Если конца у ответа нет —
 * последняя пара могла оборваться на середине значения, и её отбрасывают;
 * целые пары до неё остаются. Если за меткой идёт следующий блок, значит, не
 * хватило лишь `-->`: пары целые, ничего не отбрасывается.
 *
 * @param {string} text
 * @returns {?{marker: string, start: number, end: number, partial: boolean}}
 *   `marker` — каноническая метка из спасённых пар, `start..end` — что она
 *   заменяет в тексте, `partial` — последняя пара отброшена как оборванная
 */
export function salvageMarker(text) {
  if (typeof text !== 'string' || !text) return null;
  const closed = new Set([...text.matchAll(MARKER_RE)].map((m) => m.index));
  const open = /<!--\s*\[{0,2}\s*academy\b/gi;
  for (const m of text.matchAll(open)) {
    if (closed.has(m.index)) continue;
    const from = m.index + m[0].length;
    const rest = text.slice(from);
    const stops = [rest.search(/<!--/), rest.search(/\n[ \t]*(?:что сочинено|кратко|loud|react|reply)(?![\p{L}\d_])/iu)].filter((i) => i >= 0);
    const cut = stops.length ? Math.min(...stops) : -1;
    const body = (cut >= 0 ? rest.slice(0, cut) : rest).replace(/\]{1,2}\s*$/, '');
    const pairs = markerKeys(`<!-- [ACADEMY ${body}] -->`);
    const partial = cut < 0 && pairs.length > 0;
    if (partial) pairs.pop();
    const kept = pairs.filter((p) => p.value).map((p) => p.raw);
    return {
      marker: `<!-- [ACADEMY${kept.length ? ` ${kept.join(' ')}` : ''}] -->`,
      start: m.index,
      end: cut >= 0 ? from + cut : text.length,
      partial,
    };
  }
  return null;
}

/**
 * Все пары `ключ=значение` всех меток текста по порядку — и знакомые, и
 * выдуманные (`kind: null`). Нужна секретарю (`core/analysis`): реакция
 * ссылается на факт его номером в метке, а номер модель считает по тому, что
 * написала, — вместе с ключами, которых разборщик не знает.
 * @returns {Array<{name: string, kind: ?string, value: string, raw: string}>}
 */
export function markerKeys(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const m of text.matchAll(MARKER_RE)) {
    const body = m[1] !== undefined ? m[1] : m[2];
    if (body === undefined) continue;
    const keys = [...body.matchAll(KEY_RE)].map((k) => ({ name: k[1].toLowerCase(), at: k.index, valueAt: k.index + k[0].length }));
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const end = i + 1 < keys.length ? keys[i + 1].at : body.length;
      const value = body.slice(k.valueAt, end).replace(/[,;]\s*$/, '').trim();
      out.push({ name: k.name, kind: KIND_BY_NAME.get(k.name) || null, value, raw: `${k.name}=${value}` });
    }
  }
  return out;
}

/** Пары `ключ=значение` блока — те же границы, что у `parseBody`. */
function markerPairs(body) {
  const keys = [...String(body).matchAll(KEY_RE)].map((k) => ({
    name: k[1].toLowerCase(),
    at: k.index,
    valueAt: k.index + k[0].length,
  }));
  const out = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const end = i + 1 < keys.length ? keys[i + 1].at : body.length;
    const value = body.slice(k.valueAt, end).replace(/[,;]s*$/, '').trim();
    const kind = KIND_BY_NAME.get(k.name);
    if (kind && value) out.push({ kind, raw: `${k.name}=${value}` });
  }
  return out;
}

// --- разбор одного блока ---------------------------------------------------

function parseBody(body, ctx, events, rejected) {
  const keys = [...body.matchAll(KEY_RE)].map((k) => ({
    name: k[1].toLowerCase(),
    at: k.index,
    valueAt: k.index + k[0].length,
  }));

  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const end = i + 1 < keys.length ? keys[i + 1].at : body.length;
    // хвостовая пунктуация: модель ставит запятые и точки с запятой между парами
    const value = body.slice(k.valueAt, end).replace(/[,;]\s*$/, '').trim();
    const raw = `${k.name}=${value}`;
    const kind = KIND_BY_NAME.get(k.name);

    // неизвестные ключи молча игнорируются (3.1) — и в отладку тоже не идут
    if (!kind) continue;

    if (!value) {
      rejected.push({ raw, reason: 'пустое значение' });
      continue;
    }

    switch (kind) {
      case 'time': parseTime(value, raw, events, rejected); break;
      case 'grade': parseGrade(value, raw, ctx, events, rejected); break;
      case 'completion': {
        const at = value.lastIndexOf(':');
        const rawScope = value.slice(0, at).trim();
        const scope = ['all', 'debts'].includes(rawScope) ? rawScope : ctx.findSubject(rawScope);
        const grade = at >= 0 ? ctx.findGrade(value.slice(at + 1)) : null;
        if (!scope || grade === null) rejected.push({ raw, reason: 'ожидается completion=all|debts|предмет:оценка из шкалы' });
        else events.push({ kind: 'completion', scope, value: grade });
        break;
      }
      case 'rel': parseRel(value, raw, ctx, events, rejected); break;
      case 'skip':
      case 'late': parseAttendance(value, raw, kind, ctx, events, rejected); break;
      case 'event': parseEvent(value, raw, events, rejected); break;
      case 'met': parseMet(value, raw, ctx, events, rejected); break;
      case 'clash': parseClash(value, raw, ctx, events, rejected); break;
      case 'rumor': parseRumor(value, raw, ctx, events, rejected); break;
      case 'new': parseNew(value, raw, ctx, events, rejected); break;
      case 'deal':
      case 'deal-': parseDeal(value, raw, kind === 'deal-', ctx, events, rejected); break;
      // default не нужен: незнакомый ключ отсеян выше
    }
  }
}

/**
 * `t=+1`, `t=+day`, `t=+2 пары`, `t=+0`.
 *
 * **Поправка 3 замера B.** `+0` — законное «сцена продолжается» (8 из 30 ответов
 * в полном варианте), а не мусор: замер A показал 0% переходов «время стоит», и
 * этот сигнал был единственным, чего не хватало. Возвращается обычным событием с
 * `n: 0`; двигать календарь на ноль пар — не то же самое, что не двигать вовсе,
 * потому что индикатору простоя важно, что источник сработал.
 *
 * **Поправка 4 замера B.** `t=+night` — выдуманная единица, единственный
 * неразобранный случай из шестидесяти. Уходит в `rejected` и не применяется;
 * остальные события того же блока остаются в силе.
 */
function parseTime(value, raw, events, rejected) {
  const v = value.replace(/\s+/g, ' ').trim();

  // чистое число: пары, они же единица по умолчанию
  const num = v.match(/^([+-]?)(\d{1,3})$/);
  if (num) {
    events.push({ kind: 'time', unit: 'period', n: signed(num[1], num[2]) });
    return;
  }

  // число (необязательное) и единица словом: `+day`, `+2 пары`, `+1нед`
  const m = v.match(/^([+-]?)(\d{0,3})\s*([\p{L}]+)\.?$/u);
  if (m) {
    const word = m[3].toLowerCase();
    for (const u of TIME_UNITS) {
      if (u.re.test(word)) {
        const n = m[2] === '' ? 1 : Number(m[2]);
        events.push({ kind: 'time', unit: u.unit, n: m[1] === '-' ? -n : n });
        return;
      }
    }
    rejected.push({ raw, reason: `неизвестная единица времени: «${v}»` });
    return;
  }

  rejected.push({ raw, reason: `не разбирается как сдвиг времени: «${v}»` });
}

/**
 * `grade=предмет:оценка`.
 *
 * **Поправка 2 замера B.** Оценка — не число из диапазона, а значение из списка
 * `preset.grades.values` плюс `preset.grades.aliases`: модель писала `автомат`,
 * `зачёт`, и это естественно для сеттинга. Неизвестное значение — в отладку, не
 * в зачётку.
 *
 * Двоеточие ищется последнее: предмет из двух слов встречался, предмет с
 * двоеточием — нет, а вот `grade=химия:зачёт` разобрать надо всегда.
 */
function parseGrade(value, raw, ctx, events, rejected) {
  const at = value.lastIndexOf(':');
  if (at < 0) {
    rejected.push({ raw, reason: 'нет двоеточия: ожидается «предмет:оценка»' });
    return;
  }
  const subjectId = ctx.findSubject(value.slice(0, at));
  if (!subjectId) {
    rejected.push({ raw, reason: `неизвестный предмет: «${value.slice(0, at).trim()}»` });
    return;
  }
  const graded = ctx.findGrade(value.slice(at + 1));
  if (graded === null) {
    rejected.push({ raw, reason: `неизвестная оценка: «${value.slice(at + 1).trim()}»` });
    return;
  }
  events.push({ kind: 'grade', subjectId, value: graded });
}

/**
 * `rel=препод:дельта`, где дельта — число (`-1`) или слово силы со знаком
 * (`minor-`, `+major`, `сильно-`, 9.3.4). Зажим — не здесь, а в relations.mjs
 * (3.1); гашение повторов — там же (9.3.5), ему нужна история ответов.
 *
 * Стоп-лист имён (9.3.6, `core/stop-names`) проверяется и по тому, что
 * написала модель, и по имени найденного преподавателя: `rel=voronova` при
 * героине «Алиса Воронова» ловится по второму. Героиня, заведение и служебные
 * слова пресета запрещены всегда; карточка (`name2`) — только когда такого
 * преподавателя в таблице нет: карточка-преподавательница остаётся живой.
 */
function parseRel(value, raw, ctx, events, rejected) {
  const at = value.lastIndexOf(':');
  if (at < 0) {
    rejected.push({ raw, reason: 'нет двоеточия: ожидается «преподаватель:дельта»' });
    return;
  }
  // Повод третьим полем (9.7B): `rel=petrova:major-:сорван зачёт`. Ищется
  // справа налево первое поле, которое читается как дельта, — всё правее него
  // повод. Так старый вид (`petrova:-1`) разбирается ровно как раньше: последнее
  // поле и есть дельта, повода нет.
  const split = splitReason(value, ctx);
  if (split) {
    parseRelCore(split.head, raw, ctx, events, rejected, split.reason);
    return;
  }
  parseRelCore(value, raw, ctx, events, rejected, '');
}

/** Потолок длины повода: это подпись к сдвигу, а не пересказ сцены. */
const REASON_MAX = 60;

/**
 * `кто:дельта:повод` → `{head: 'кто:дельта', reason}`; `null` — повода нет.
 * Скобки вокруг повода и дельты снимаются: инструкция пишет «:повод» в
 * скобках, и модель может скопировать их буквально.
 */
function splitReason(value, ctx) {
  const parts = value.split(':');
  for (let k = parts.length - 2; k >= 1; k -= 1) {
    const word = parts[k].replace(/[[\]()]/g, '').trim();
    if (!/^[+-]?\d{1,2}$/.test(word) && !parseImpact(word, ctx)) continue;
    const reason = parts.slice(k + 1).join(':')
      .replace(/[[\]()]/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
      .slice(0, REASON_MAX);
    return { head: `${parts.slice(0, k).join(':')}:${word}`, reason };
  }
  return null;
}

function parseRelCore(value, raw, ctx, events, rejected, reason) {
  const at = value.lastIndexOf(':');
  const who = value.slice(0, at).trim();
  // Человек — преподаватель или однокурсник (шаг 2): у метки одно
  // пространство id на всех, ключ события по-прежнему `teacherId`.
  const teacherId = ctx.findPerson(who);
  const hit = strictest([
    ctx.stopHit(who),
    teacherId ? ctx.stopHit(ctx.teacherName(teacherId)) : null,
    teacherId ? ctx.stopHit(teacherId) : null,
  ]);
  if (hit && (HARD_STOPS.includes(hit.kind) || !teacherId)) {
    rejected.push({ raw, reason: `стоп-лист (${STOP_WORDS[hit.kind] || hit.kind}): «${who}» — не преподаватель` });
    return;
  }
  if (!teacherId) {
    rejected.push({ raw, reason: `неизвестный преподаватель: «${who}»` });
    return;
  }
  const word = value.slice(at + 1).trim();
  const why = reason ? { reason } : {};
  const d = word.match(/^([+-]?\d{1,2})$/);
  if (d) {
    events.push({ kind: 'rel', teacherId, delta: Number(d[1]), ...why });
    return;
  }
  const w = parseImpact(word, ctx);
  if (!w) {
    rejected.push({ raw, reason: `дельта отношения не число и не слово силы: «${word}»` });
    return;
  }
  events.push({ kind: 'rel', teacherId, delta: w.delta, impact: w.level, ...why });
}

/** Подписи видов стоп-листа для отладки. */
const STOP_WORDS = {
  [STOP_USER]: 'героиня',
  institution: 'заведение',
  preset: 'служебное слово',
  [STOP_CHAR]: 'карточка',
};

/**
 * Слово силы со знаком: `minor-`, `-minor`, `major+`, `+ major`. Знак
 * обязателен и ровно один: слово без знака не говорит, в какую сторону, а
 * угадывать направление по тону — ровно то, чего метка должна избавлять.
 * Типографский минус и тире модель ставит сама — они приравнены к «-».
 */
function parseImpact(word, ctx) {
  const v = String(word).replace(/[−‒–—―]/g, '-').replace(/\s+/g, '').toLowerCase();
  const m = v.match(/^([+-]?)([\p{L}]+)([+-]?)$/u);
  if (!m) return null;
  const sign = m[1] || m[3];
  if (!sign || (m[1] && m[3])) return null;
  const level = IMPACT_BY_WORD.get(m[2].replace(/ё/g, 'е'));
  if (!level) return null;
  const weight = ctx.impactWeight(level);
  if (!weight) return null;
  return { level, delta: sign === '-' ? -weight : weight };
}

/**
 * `event=+3:бал у Миражи`, `event=+5..+6:ярмарка` — событие в планы, через
 * сколько дней от дня сцены (0 — сегодня). Диапазон — через `..` или тире.
 * Дальше `EVENT_HORIZON` дней — в `rejected`: такое в планы не пишется.
 */
function parseEvent(value, raw, events, rejected) {
  const v = value.replace(/[−‒–—―]/g, '-');
  const m = v.match(/^\+?\s*(\d{1,3})\s*(?:(?:\.\.|-)\s*\+?\s*(\d{1,3}))?\s*(?:дн[а-яё]*|d|days?)?\s*:\s*([\s\S]+)$/iu);
  if (!m) {
    rejected.push({ raw, reason: 'ожидается event=+дни:название' });
    return;
  }
  const days = Number(m[1]);
  const until = m[2] === undefined ? days : Number(m[2]);
  const name = m[3].replace(/[[\]<>]/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().slice(0, EVENT_NAME_MAX);
  if (!name) {
    rejected.push({ raw, reason: 'у события нет названия' });
    return;
  }
  if (until < days) {
    rejected.push({ raw, reason: 'конец события раньше начала' });
    return;
  }
  if (days > EVENT_HORIZON) {
    rejected.push({ raw, reason: `событие дальше двух недель (+${days}) — в планы не пишется` });
    return;
  }
  events.push({ kind: 'event', days, until: Math.min(until, days + 31), name });
}

// --- курс: кто был, стычки, слухи, новые имена, дела (шаг 3) -----------------
//
// Стороны стычки и дела — id человека (однокурсник или преподаватель) или
// героиня (`@heroine`). Героиню модель нередко зовёт по имени — имя из
// стоп-листа здесь не отказ, а она сама. Карточка (бот) стороной не бывает,
// если такого человека нет в списках: «Рассказчик поссорился» — шум.

/**
 * Сторона: `{id}` или `{error}`. С `opts.card` персонаж карточки, которого нет в
 * списках, — сторона факта (`@card/имя`): стычка, слух и дело о нём бывают, а
 * сокурсником, встречей и автором он не становится.
 */
function parseParty(raw, ctx, opts = {}) {
  const v = String(raw || '').replace(/[[\]()]/g, '').trim();
  if (!v) return { error: 'пустая сторона' };
  if (HEROINE_WORDS.includes(norm(v))) return { id: HEROINE };
  // Канонический токен (`clash=@heroine:@card/Имя`) читается обратно при пересчёте,
  // когда имён карточки у разбора может не быть.
  if (opts.card && isCardParty(v) && cardPartyName(v).trim()) return { id: v, card: true };
  const said = ctx.stopHit(v);
  if (said && said.kind === STOP_USER) return { id: HEROINE };
  const id = ctx.findPerson(v);
  const hit = strictest([said, id ? ctx.stopHit(ctx.teacherName(id)) : null]);
  if (opts.card && !id && hit && hit.kind === STOP_CHAR) {
    return { id: `${CARD_PREFIX}${ctx.cardName ? ctx.cardName(v, hit.name) : hit.name}`, card: true };
  }
  if (hit && (HARD_STOPS.includes(hit.kind) || !id)) {
    return { error: `стоп-лист (${STOP_WORDS[hit.kind] || hit.kind}): «${v}»` };
  }
  if (!id) return { error: `неизвестный человек: «${v}»` };
  return { id };
}

/**
 * Человек по слову модели — тем же правилом, что сторона стычки: id из
 * списков, `@heroine` или `{error}`. Нужна секретарю для автора реакции.
 */
export function partyOf(raw, lexicon) {
  return parseParty(raw, buildContext(lexicon));
}

/** Свободный хвост: без скобок и подчёркиваний, в одну строку, с потолком. */
function freeText(parts, max) {
  return parts.join(':')
    .replace(/-->|[=[\]<>]/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, max)
    .trim();
}

/** `met=sokolova`, `met=sokolova, petrova` — кто был в сцене. Героиня — не «встреча». */
function parseMet(value, raw, ctx, events, rejected) {
  for (const part of value.split(/[,;]/)) {
    if (!part.trim()) continue;
    const who = parseParty(part, ctx);
    if (who.error) rejected.push({ raw, reason: who.error });
    else if (who.id === HEROINE) rejected.push({ raw, reason: 'героиня и так в сцене — met не нужен' });
    else events.push({ kind: 'met', personId: who.id });
  }
}

/** Две стороны в начале значения: стычка и дело. */
function parsePair(parts, raw, ctx, rejected) {
  const a = parseParty(parts[0], ctx, { card: true });
  const b = parseParty(parts[1], ctx, { card: true });
  const bad = a.error || b.error || (a.card && b.card ? 'обе стороны — персонажи карточки' : '');
  if (bad) {
    rejected.push({ raw, reason: bad });
    return null;
  }
  if (a.id === b.id) {
    rejected.push({ raw, reason: 'обе стороны — один человек' });
    return null;
  }
  return { a: a.id, b: b.id };
}

/** `clash=a:b:повод` — стычка двоих; повод необязателен. */
function parseClash(value, raw, ctx, events, rejected) {
  const parts = value.split(':');
  if (parts.length < 2) {
    rejected.push({ raw, reason: 'ожидается clash=кто:с кем:повод' });
    return;
  }
  const pair = parsePair(parts, raw, ctx, rejected);
  if (!pair) return;
  const reason = freeText(parts.slice(2), SOCIAL_TEXT_MAX.reason);
  events.push({ kind: 'clash', ...pair, ...(reason ? { reason } : {}) });
}

/**
 * `rumor=о_ком:что` — в сцене прозвучал слух. Факт здесь — то, что его
 * пустили, а не то, что он правда.
 */
function parseRumor(value, raw, ctx, events, rejected) {
  const at = value.indexOf(':');
  if (at < 0) {
    rejected.push({ raw, reason: 'ожидается rumor=о ком:что говорят' });
    return;
  }
  const about = parseParty(value.slice(0, at), ctx, { card: true });
  if (about.error) {
    rejected.push({ raw, reason: about.error });
    return;
  }
  const text = freeText([value.slice(at + 1)], SOCIAL_TEXT_MAX.rumor);
  if (!text) {
    rejected.push({ raw, reason: 'у слуха нет содержания' });
    return;
  }
  events.push({ kind: 'rumor', about: about.id, text });
}

/**
 * `new=Глеб Орлов` — незнакомое имя, будущий кандидат в курс. Уже знакомый
 * однокурсник — это просто «был в сцене»; преподаватель, героиня, бот и
 * заведение — отказ.
 */
function parseNew(value, raw, ctx, events, rejected) {
  const name = freeText([value], SOCIAL_TEXT_MAX.name).replace(/[:;,.!?]+$/, '').trim();
  const words = name.split(' ').filter(Boolean);
  if (!name || !/\p{L}{2}/u.test(name) || words.length > 4 || /\d/.test(name)) {
    rejected.push({ raw, reason: `не похоже на имя: «${value.trim()}»` });
    return;
  }
  const hit = ctx.stopHit(name);
  if (hit) {
    rejected.push({ raw, reason: `стоп-лист (${STOP_WORDS[hit.kind] || hit.kind}): «${name}»` });
    return;
  }
  const classmate = ctx.findClassmate(name);
  if (classmate) {
    events.push({ kind: 'met', personId: classmate });
    return;
  }
  if (ctx.findPerson(name)) {
    rejected.push({ raw, reason: `«${name}» уже есть среди людей академии` });
    return;
  }
  events.push({ kind: 'new', name });
}

/**
 * `deal=sokolova:@heroine:конспект` — между двумя открыто дело: обещание,
 * долг, общий проект. Закрыто — `deal-=…` или последним полем `:закрыто`.
 * Порядок сторон — кто кому: первая обещала второй.
 */
function parseDeal(value, raw, closedKey, ctx, events, rejected) {
  const parts = value.split(':');
  let closed = closedKey;
  if (parts.length > 3 && DEAL_CLOSED.test(parts[parts.length - 1].trim())) {
    closed = true;
    parts.pop();
  }
  if (parts.length < 3) {
    rejected.push({ raw, reason: 'ожидается deal=кто:кому:что' });
    return;
  }
  const pair = parsePair(parts, raw, ctx, rejected);
  if (!pair) return;
  const what = freeText(parts.slice(2), SOCIAL_TEXT_MAX.deal);
  if (!what) {
    rejected.push({ raw, reason: 'у дела нет содержания' });
    return;
  }
  events.push({ kind: 'deal', ...pair, what, closed });
}

/** `skip=предмет`, `late=предмет` — ключи посещаемости из 3.4. */
function parseAttendance(value, raw, kind, ctx, events, rejected) {
  const subjectId = ctx.findSubject(value);
  if (!subjectId) {
    rejected.push({ raw, reason: `неизвестный предмет: «${value.trim()}»` });
    return;
  }
  events.push({ kind: 'attendance', subjectId, status: kind });
}

// --- нестрогое сопоставление имён ------------------------------------------

/**
 * Ключ сравнения: регистр не важен, «ё» равна «е», пробел равен подчёркиванию.
 * Последнее — прямо из прогона: одна и та же модель в соседних ответах писала
 * `аналитическая химия` и `аналитическая_химия`.
 */
function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[_\s]+/g, ' ')
    .replace(/[.,;:!?]+$/, '')
    .trim();
}

function buildContext(preset) {
  const p = preset && typeof preset === 'object' ? preset : {};
  const inner = p.preset && typeof p.preset === 'object' ? p.preset : {};

  const subjects = pick(p.subjects, inner.subjects);
  const teachers = pick(p.teachers, inner.teachers);
  // Курс (шаг 2): движок кладёт однокурсников прямо в `teachers`
  // (`classmates.markerPeople`), секретарь — отдельным списком. Люди — оба
  // списка без повторов id.
  const classmates = pick(p.classmates, inner.classmates).filter((c) => c && c.id);
  const people = [...teachers];
  for (const c of classmates) if (!people.some((x) => x && x.id === c.id)) people.push(c);
  const grades = (p.grades && p.grades.values ? p.grades : inner.grades) || {};

  const graded = new Map();
  for (const g of grades.values || []) {
    const v = typeof g === 'string' ? g : g.value;
    if (v !== undefined && v !== null) graded.set(norm(v), String(v));
    if (g && typeof g === 'object' && g.label && v !== undefined && v !== null) graded.set(norm(g.label), String(v));
  }
  for (const [alias, target] of Object.entries(grades.aliases || {})) {
    const canon = graded.get(norm(target)) ?? String(target);
    graded.set(norm(alias), canon);
  }

  // Вес слова силы — из шкалы пресета: склейка `{...preset, …}` несёт
  // `relations` сверху, голое состояние — внутри `preset`.
  const scaleOwner = p.relations ? p : inner;

  // Стоп-лист (9.3.6): готовый список (`stop`) или его вход (`names` из
  // вызывающего — `name1`/`name2` знает только `index.js`). Название заведения
  // и служебные слова пресета берутся всегда, даже когда имён не передали.
  const stop = Array.isArray(p.stop) ? p.stop : stopList({
    ...((p.names && typeof p.names === 'object') ? p.names : {}),
    preset: p.displayName || p.stopNames ? p : inner,
    survey: p.survey || inner.survey,
  });

  return {
    findSubject: (raw) => byIdOrName(subjects, raw),
    findTeacher: (raw) => byIdOrName(teachers, raw),
    // Людей модель зовёт как придётся: «sokolova» при id `vera-sokolova`,
    // «Соколовой», «В. Соколова». Точное — первым, мягкое — если точного нет.
    findPerson: (raw) => byIdOrName(people, raw) || softPerson(people, raw),
    findClassmate: (raw) => byIdOrName(classmates, raw),
    teacherName: (id) => {
      const t = people.find((x) => x && x.id === id);
      return t ? (t.name || t.id) : '';
    },
    impactWeight: (level) => impactWeight(scaleOwner, level),
    stopHit: (raw) => stopHit(raw, stop),
    // Написание персонажа карточки для факта: по-русски, а не имя карточки (баг 87).
    cardName: (written, hitName) => cardDisplayName(
      written, hitName,
      p.names && p.names.cast,
      (p.survey || inner.survey || {}).lang || p.lang || inner.lang,
    ),
    findGrade: (raw) => {
      const key = norm(raw);
      return graded.has(key) ? graded.get(key) : null;
    },
  };
}

function pick(a, b) {
  return Array.isArray(a) ? a : (Array.isArray(b) ? b : []);
}

/**
 * Поиск по id, потом по имени. Точное совпадение id важнее: короткий id из
 * пресета — то, чем метка должна пользоваться в идеале, а имя — то, чем она
 * пользуется на самом деле.
 */
function byIdOrName(list, raw) {
  const key = norm(raw);
  if (!key) return null;
  for (const it of list) if (norm(it.id) === key) return it.id;
  for (const it of list) if (norm(it.name) === key) return it.id;
  // Короткое имя: «химия» для «аналитической химии», «Петрова» для «Петровой
  // Анны Сергеевны». Берётся, только если слово (или несколько слов подряд)
  // целиком входит в имя ровно одного — двусмысленное по-прежнему отвергается.
  const words = key.split(' ');
  const hits = list.filter((it) => {
    const name = norm(it.name || '').split(' ');
    for (let i = 0; i + words.length <= name.length; i++) {
      if (words.every((w, k) => name[i + k] === w)) return true;
    }
    return false;
  });
  return hits.length === 1 ? hits[0].id : null;
}

/**
 * Мягкий поиск человека — когда ни id, ни имя целиком не совпали. По
 * порядку: часть id («sokolova» → `vera-sokolova`), латиница по имени
 * («sokolova» → «Соколова»), инициалы и часть имени (`classmates.sameName`),
 * падеж («Соколовой», «Веры» → «Вера Соколова»). На каждом шаге — только если
 * подходит ровно один человек: двусмысленное по-прежнему отвергается, и
 * секретарь видит это на плашке строкой «Не разобрано».
 */
function softPerson(list, raw) {
  const key = norm(raw);
  if (!key) return null;
  const words = key.split(/[\s-]+/).filter(Boolean);
  if (!words.length) return null;
  const unique = (test) => {
    const hits = list.filter((it) => it && it.id && test(it));
    return hits.length === 1 ? hits[0].id : null;
  };
  const byId = unique((it) => contiguous(words, norm(it.id).split(/[\s-]+/)));
  if (byId) return byId;
  if (/^[a-z0-9\s-]+$/.test(key)) {
    const byLatin = unique((it) => contiguous(words, slugify(it.name || '').split('-')));
    if (byLatin) return byLatin;
  }
  const byName = unique((it) => sameName(it.name, raw));
  if (byName) return byName;
  return unique((it) => {
    const name = norm(it.name || '').split(' ');
    return words.every((w) => name.some((n) => sameStem(w, n)));
  });
}

/** Слова `words` идут подряд где-то в `parts`. */
function contiguous(words, parts) {
  for (let i = 0; i + words.length <= parts.length; i++) {
    if (words.every((w, k) => parts[i + k] === w)) return true;
  }
  return false;
}

/** Одно слово в другом падеже: «Соколовой» и «Соколова», «Веры» и «Вера». */
function sameStem(a, b) {
  if (a === b) return true;
  if (!/^[а-я]{3,}$/.test(a) || !/^[а-я]{3,}$/.test(b)) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n >= Math.max(3, Math.min(a.length, b.length) - 2);
}

function signed(sign, digits) {
  const n = Number(digits);
  return sign === '-' ? -n : n;
}

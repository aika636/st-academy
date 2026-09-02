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
 * внутри комментария не должен её ломать. Ограничитель `\]{0,2}\s*-->` съедает
 * закрывающие скобки, если они есть.
 */
export const MARKER_RE =
  /<!--\s*\[{0,2}\s*academy\b([\s\S]*?)\]{0,2}\s*-->|\[{1,2}\s*academy\b([^\]\n]*)\]{1,2}/gi;

// --- словарь ключей --------------------------------------------------------
// Русские имена в инструкции не предлагались, но модель к ним склонна, а стоят
// они три токена. Дешевле принять, чем потом разбирать жалобу «не считает».

const KEY_GROUPS = [
  { kind: 'time', names: ['t', 'time', 'время', 'врем'] },
  { kind: 'grade', names: ['grade', 'mark', 'оценка', 'оц'] },
  { kind: 'rel', names: ['rel', 'relation', 'отношение', 'отн'] },
  { kind: 'skip', names: ['skip', 'прогул', 'пропуск'] },
  { kind: 'late', names: ['late', 'опоздание', 'опоздал', 'опоздала'] },
];

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
      case 'rel': parseRel(value, raw, ctx, events, rejected); break;
      case 'skip':
      case 'late': parseAttendance(value, raw, kind, ctx, events, rejected); break;
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

/** `rel=препод:дельта`. Зажим по модулю — не здесь, а в relations.mjs (3.1). */
function parseRel(value, raw, ctx, events, rejected) {
  const at = value.lastIndexOf(':');
  if (at < 0) {
    rejected.push({ raw, reason: 'нет двоеточия: ожидается «преподаватель:дельта»' });
    return;
  }
  const teacherId = ctx.findTeacher(value.slice(0, at));
  if (!teacherId) {
    rejected.push({ raw, reason: `неизвестный преподаватель: «${value.slice(0, at).trim()}»` });
    return;
  }
  const d = value.slice(at + 1).trim().match(/^([+-]?\d{1,2})$/);
  if (!d) {
    rejected.push({ raw, reason: `дельта отношения не число: «${value.slice(at + 1).trim()}»` });
    return;
  }
  events.push({ kind: 'rel', teacherId, delta: Number(d[1]) });
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
  const grades = (p.grades && p.grades.values ? p.grades : inner.grades) || {};

  const graded = new Map();
  for (const g of grades.values || []) {
    const v = typeof g === 'string' ? g : g.value;
    if (v !== undefined && v !== null) graded.set(norm(v), String(v));
  }
  for (const [alias, target] of Object.entries(grades.aliases || {})) {
    const canon = graded.get(norm(target)) ?? String(target);
    graded.set(norm(alias), canon);
  }

  return {
    findSubject: (raw) => byIdOrName(subjects, raw),
    findTeacher: (raw) => byIdOrName(teachers, raw),
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
  return null;
}

function signed(sign, digits) {
  const n = Number(digits);
  return sign === '-' ? -n : n;
}

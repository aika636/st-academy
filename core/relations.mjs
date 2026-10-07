// core/relations — личные отношения с преподавателями.
//
// Шкала одна на преподавателя, число живёт внутри состояния и наружу не выходит
// никогда: в промпт уходит ярлык словом (3.3). Причина не косметическая — «неприязнь»
// модель отыгрывает, `-3` не отыгрывает вовсе, и каждое число в строке состояния
// съедает одну позицию из шести.
//
// Отношения намеренно отделены от репутации (3.4): Петрова тебя невзлюбила — это
// личное и бьёт по одному предмету; что о тебе думает заведение — это reputation.mjs.
// Если склеить обе шкалы, вторая перестаёт быть нужна.
//
// Единственное, что здесь считается сверх сложения, — **переход через границу ярлыка**.
// Он возвращается в `crossed`, потому что это и есть значимое событие: пока Петрова
// остаётся «недовольна», писать об этом в хронику и дёргать одноразовый инжект незачем,
// а вот превращение «недовольна» → «неприязнь» стоит и записи, и отдельной сцены.
//
// Ещё две вещи — про то, что приходит из метки, а не из механики: вес слова силы
// (`rel=петрова:major-`, 9.3.4) и гашение штампованных повторов (9.3.5). Обе
// описаны у своих функций ниже.

import { cloneState, findTeacher, pushJournal, labelFor, clamp, teacherOfSubject, findSubject } from './state.mjs';
import { classmateLabels } from './classmates.mjs';

// --- однокурсники (раздел «Сейчас», шаг 2) ---------------------------------------
//
// Однокурсник держит отношение к героине на той же шкале и с той же
// антиинфляцией, что преподаватель (ответ владелицы 07.10). Поэтому всё ниже
// работает с «человеком» по id: сначала среди преподавателей, потом среди
// однокурсников (`state.classmates`). Ключ события и журнала по-прежнему
// `teacherId` — это id человека, кем бы он ни был: так журнал, память «за что»
// и разбор метки не заводят второго поля. Id у обоих списков в одном
// пространстве (`classmates.classmateIdOf` обходит занятые).
//
// Разница одна — слова. Шкала та же (`relations.min/max`), а ярлыки у
// однокурсника свои (`classmates.labels` пресета): «любимица» — про учителя.

/** Человек по id: преподаватель или однокурсник; `null` — никого. */
export function findPerson(state, id) {
  const t = findTeacher(state, id);
  if (t) return t;
  return ((state && state.classmates) || []).find((c) => c && c.id === id) || null;
}

/** Однокурсник ли это (а не преподаватель и не пустое место). */
export function isClassmate(state, id) {
  if (findTeacher(state, id)) return false;
  return ((state && state.classmates) || []).some((c) => c && c.id === id);
}

/** Таблица ярлыков для этого человека: у однокурсника своя, у преподавателя — шкалы. */
export function labelsOf(state, id, preset) {
  if (isClassmate(state, id)) return classmateLabels(preset);
  return (preset && preset.relations && preset.relations.labels) || [];
}

// --- сила словом (9.3.4) ------------------------------------------------------
//
// `rel=петрова:major-` вместо `rel=петрова:-2`. Модели калибруют слова лучше
// чисел (так делает VNE, `friendship_impact`): «слегка» и «сильно» модель
// различает устойчиво, а между `-1` и `-2` выбирает почти наугад — и на шкале
// −5…+5 это разница между «недоволен» и «неприязнью».
//
// Здесь только ВЕС слова: на какой шаг шкалы оно тянет. Сами слова (и русские
// синонимы) — лексика метки и живут в `parse-marker`. Вес — свойство шкалы, а
// шкала принадлежит пресету: у магической академии она −3…+3, и «сильно» там
// весит столько же шагов, но значит больше. Пресет без блока `relations.impact`
// получает умолчания ниже.

/** Уровни силы. Два, а не три: третий («умеренно») модель путает с обоими. */
export const IMPACT_LEVELS = ['minor', 'major'];

/** Вес по умолчанию: «слегка» — шаг, «сильно» — два. */
export const DEFAULT_IMPACT = { minor: 1, major: 2 };

/**
 * Вес уровня силы по пресету. Мусор в пресете (ноль, отрицательное, строка)
 * молча заменяется умолчанием: знак несёт метка, а вес без знака, равный нулю,
 * превращал бы слово в пустое место без единой строки в отладке.
 *
 * @param {Object} preset
 * @param {'minor'|'major'} level
 * @returns {number} положительный вес; 0 — уровень неизвестен
 */
export function impactWeight(preset, level) {
  if (!IMPACT_LEVELS.includes(level)) return 0;
  const own = preset && preset.relations && preset.relations.impact;
  const v = own && Number(own[level]);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_IMPACT[level];
}

// --- антиинфляция (9.3.5) -------------------------------------------------------
//
// Болезнь, от которой это лечит: в долгой мирной сцене модель пишет
// `rel=петрова:+1` в каждом ответе — не потому, что что-то случилось, а потому
// что в прошлых ответах метка была такой (она видит свои метки в контексте, 3.1).
// Десять ответов светской беседы — и Петрова «любимица» без единого события.
//
// Правило: одна и та же дельта к одному наставнику в `repeatLimit` ответах
// подряд применяется, следующая такая же — гасится, пока не случится новое
// событие. Счёт ведётся в `state.relStreak` — `{[teacherId]: {delta, count, day}}`.
//
// **Что такое «подряд».** Буквально: соседние ответы. Ответ, в метке которого
// про этого наставника ничего нет, серию обрывает — модель, которая пишет
// `+1` через раз, уже не штампует, а реагирует. Другая дельта (`+2` после `+1`,
// `-1` после `+1`) — тоже обрыв: сменилась оценка происходящего.
//
// **Что такое «новое событие».** То, что оставляет след в механике, а не в
// прозе, — иначе «событие» пришлось бы угадывать по тексту:
//   * новый день календаря — это новая сцена, а не продолжение беседы;
//   * оценка, прогул или опоздание (из метки или выведенные календарём) по
//     предмету ЭТОГО наставника в том же ответе — ровно тот повод, от которого
//     отношение и должно двигаться. `grade=chemistry:5 rel=petrova:+1` три раза
//     подряд — три пятёрки, а не инфляция.
// Смена пары внутри дня событием не считается: `t=+1` модель тоже пишет
// механически, и тогда серия не гасилась бы никогда.
//
// Гасится только метка. Эффекты посещаемости (прогул → минус) — сами события,
// их не трогает ни это правило, ни стоп-лист.

/** Сколько одинаковых ответов подряд применяются, если пресет молчит. */
export const DEFAULT_REPEAT_LIMIT = 2;

/** `preset.relations.repeatLimit`; 0 или мусор — умолчание, правило не выключается. */
export function repeatLimit(preset) {
  const v = Number(preset && preset.relations && preset.relations.repeatLimit);
  return Number.isInteger(v) && v >= 1 ? v : DEFAULT_REPEAT_LIMIT;
}

/**
 * Наставники, у которых в этом ответе было «новое событие» по их предмету.
 *
 * @param {Object} state
 * @param {string[]} subjectIds предметы с оценкой/отметкой/выведенным прогулом
 * @returns {string[]} id наставников
 */
export function teachersOfSubjects(state, subjectIds) {
  const out = [];
  for (const id of subjectIds || []) {
    const t = teacherOfSubject(state, id);
    if (t && !out.includes(t.id)) out.push(t.id);
  }
  return out;
}

/**
 * Отсеять штампованные сдвиги из метки одного ответа.
 *
 * Вызывается РОВНО ОДИН РАЗ на ответ — и тогда, когда `rel=` в метке нет: пустой
 * ответ обрывает все серии, и без вызова серия пережила бы паузу.
 *
 * Несколько `rel=` к одному наставнику в одном ответе сравниваются суммой:
 * `rel=petrova:+1 rel=petrova:+1` — это «+2 в этом ответе», а не две серии.
 * Гасится ответ целиком — все события этого наставника.
 *
 * @param {Object} state
 * @param {Array<{teacherId: string, delta: number}>} events `rel` из метки
 * @param {Object} preset
 * @param {Object} [ctx]
 * @param {string[]} [ctx.fresh] у кого в этом ответе было новое событие
 * @param {string} [ctx.day] день, к которому относится ответ (по умолчанию —
 *   день календаря)
 * @returns {{state: Object, events: Array, damped: Array<{teacherId: string, delta: number, count: number}>}}
 */
export function dampRepeats(state, events, preset, ctx = {}) {
  const next = cloneState(state);
  const day = ctx.day || (next.calendar && next.calendar.day) || '';
  const fresh = new Set(ctx.fresh || []);
  const limit = repeatLimit(preset);
  const prev = next.relStreak && typeof next.relStreak === 'object' ? next.relStreak : {};

  const sums = new Map();
  for (const ev of events || []) {
    const d = Number(ev && ev.delta);
    if (!ev || !ev.teacherId || !Number.isFinite(d)) continue;
    sums.set(ev.teacherId, (sums.get(ev.teacherId) || 0) + d);
  }

  const streak = {};
  const muted = new Set();
  const damped = [];
  for (const [teacherId, delta] of sums) {
    // Нулевая сумма — «ничего не сдвинулось»; такая «серия» инфляции не делает.
    if (delta === 0) continue;
    const p = prev[teacherId];
    const same = p && p.delta === delta && p.day === day && !fresh.has(teacherId);
    const count = same ? p.count + 1 : 1;
    streak[teacherId] = { delta, count, day };
    if (count > limit) {
      muted.add(teacherId);
      damped.push({ teacherId, delta, count });
      pushJournal(next, {
        kind: 'rel',
        text: `relation damped ${teacherId} ${delta > 0 ? '+' : ''}${delta} x${count}`,
        // Без `from`/`to`: вкладка «Люди» и хроника лорбука читают из журнала
        // только переходы ярлыка, и погашенный сдвиг им не попадётся.
        data: { teacherId, delta, damped: true, count, limit },
      }, preset);
    }
  }
  next.relStreak = streak;

  const kept = (events || []).filter((ev) => !(ev && muted.has(ev.teacherId)));
  return { state: next, events: kept, damped };
}

// --- повод сдвига (9.7B) --------------------------------------------------------
//
// Журнал хранил только дельту: «petrova −2». Мосту отношений, хронике лорбука и
// будущей «кристаллизации черт» наставника нужно другое — ПОЧЕМУ: «сорван зачёт
// 12 октября». Повод — объект, а не строка, чтобы его читали и код, и человек:
//
//   {kind, subjectId?, value?, examId?, count?, text?}
//
// - `kind` — что случилось: `grade` (оценка в том же ответе), `exam` (сегодняшнее
//   контрольное по предмету наставника), `skip`/`late`/`present` (отметка — из
//   метки или выведенная календарём), `marker` (повод написала модель, а
//   механика ничего не нашла);
// - `text` — повод словами из метки (`rel=petrova:major-:сорван зачёт`), если
//   модель его написала. Слова модели — не замена механике: при оценке в том же
//   ответе в поводе будут и `kind: 'grade'`, и `text`.
//
// День повода не хранится отдельно: запись журнала и так несёт свой `day`.

/** Фразы повода по умолчанию; пресет перекрывает их `phrases.relationReason`. */
export const REASON_PHRASES = {
  grade: 'оценка {value}: {subject}',
  exam: 'испытание: {subject} — {value}',
  skip: 'прогул: {subject}',
  skipMany: 'прогулы: {subject} ×{count}',
  late: 'опоздание: {subject}',
  present: 'присутствие: {subject}',
  marker: '{text}',
  withText: '{base} ({text})',
};

/**
 * Повод словами — для отладки (`ui.describeApplied`) и хроники. Пусто, если
 * повода нет или сказать нечего.
 *
 * @param {?Object} reason
 * @param {Object} state
 * @param {Object} preset
 * @returns {string}
 */
export function reasonText(reason, state, preset) {
  if (!reason || typeof reason !== 'object') return typeof reason === 'string' ? reason : '';
  const ph = { ...REASON_PHRASES, ...((preset && preset.phrases && preset.phrases.relationReason) || {}) };
  const subject = reason.subjectId ? findSubject(state || {}, reason.subjectId) : null;
  const vars = {
    subject: (subject && subject.name) || reason.subjectId || '',
    value: reason.value == null ? '' : String(reason.value),
    count: String(reason.count || ''),
    text: reason.text || '',
  };
  const key = reason.kind === 'skip' && reason.count > 1 ? 'skipMany' : reason.kind;
  const base = key && key !== 'marker' && ph[key] ? fillReason(ph[key], vars) : '';
  if (base && vars.text) return fillReason(ph.withText, { base, text: vars.text });
  return base || vars.text;
}

/** Сколько последних сдвигов помнит преподаватель: карточка «Люди» и лорбук. */
export const MEMORY_SIZE = 3;

/**
 * Память «за что»: последние сдвиги отношения преподавателя, свежим вперёд.
 *
 * Источник — журнал (`kind: 'rel'`, `data.from`/`data.to`/`data.reason`), и в
 * память идут ВСЕ сдвиги, а не только переходы ярлыка: «−1 за прогул химии»
 * внутри одного «недоволен» и есть то, что преподаватель держит в голове.
 * Не идёт только сдвиг, который ничего не сдвинул (зажим на краю шкалы,
 * погашенный повтор): помнить там нечего.
 *
 * Журнал кольцевой — память заканчивается там же, где он; это не потеря, а
 * естественная забывчивость: три последних повода важнее сентябрьских.
 *
 * @returns {Array<{day: string, delta: number, reason: string,
 *   from: number, to: number, crossed: ?{from: string, to: string}}>}
 */
export function relationMemory(state, teacherId, preset, limit = MEMORY_SIZE) {
  const labels = labelsOf(state, teacherId, preset);
  const out = [];
  const journal = (state && state.journal) || [];
  for (let i = journal.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const e = journal[i];
    if (!e || e.kind !== 'rel' || !e.data || e.data.teacherId !== teacherId) continue;
    const { from, to } = e.data;
    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) continue;
    const a = labelFor(labels, from);
    const b = labelFor(labels, to);
    out.push({
      day: e.day || '',
      delta: to - from,
      reason: reasonText(e.data.reason, state, preset).replace(/\s+/g, ' ').trim(),
      from,
      to,
      crossed: a && b && a !== b ? { from: a, to: b } : null,
    });
  }
  return out;
}

function fillReason(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * Свести сдвиги по наставникам: одна дельта на наставника вместо пачки.
 *
 * Для развёртки прыжка (`engine.sweepAttendance`, 9.4.4): неделя, перепрыгнутая
 * без героини, — это двадцать прогулов, и по одной записи журнала на каждый
 * вытесняли бы из кольцевого журнала (200 строк) экзамены прошлого месяца, по
 * которым пишется хроника. Сумма вместо пачки меняет итог только на краю шкалы
 * при РАЗНЫХ знаках (зажим по дороге); у эффектов посещаемости знак один —
 * прогул и опоздание тянут вниз, — и итог тот же.
 *
 * Повод сводный: `{kind, subjectId, count}`, если все сдвиги наставника одного
 * рода и по одному предмету, иначе `{kind: 'skip', count}` без предмета.
 *
 * @param {Array<{teacherId: string, delta: number, reason?: Object}>} list
 * @returns {Array<{teacherId: string, delta: number, reason: Object}>}
 */
export function mergeDeltas(list) {
  const by = new Map();
  for (const ev of list || []) {
    const d = Number(ev && ev.delta);
    if (!ev || !ev.teacherId || !Number.isFinite(d)) continue;
    const acc = by.get(ev.teacherId) || { teacherId: ev.teacherId, delta: 0, reasons: [] };
    acc.delta += d;
    acc.reasons.push((ev.reason && typeof ev.reason === 'object') ? ev.reason : {});
    by.set(ev.teacherId, acc);
  }
  const out = [];
  for (const acc of by.values()) {
    if (acc.delta === 0) continue;
    const kinds = new Set(acc.reasons.map((r) => r.kind || 'skip'));
    const subjects = new Set(acc.reasons.map((r) => r.subjectId || ''));
    const kind = kinds.size === 1 ? [...kinds][0] : 'skip';
    const reason = { kind, count: acc.reasons.length };
    if (subjects.size === 1 && [...subjects][0]) reason.subjectId = [...subjects][0];
    out.push({ teacherId: acc.teacherId, delta: acc.delta, reason });
  }
  return out;
}

/**
 * Число отношения. Наружу, в промпт, оно не уходит — только в отладку и в расчёты
 * (исход экзамена в exams.mjs). Незнакомый преподаватель — ноль как отсутствие
 * отношения, а не как правило пресета.
 */
export function relationOf(state, teacherId) {
  const t = findPerson(state, teacherId);
  return t && Number.isFinite(t.relation) ? t.relation : 0;
}

/**
 * Ярлык словом по таблице пресета (`relations.labels`, у однокурсника —
 * `classmates.labels`). Это всё, что видит модель.
 */
export function relationLabel(state, teacherId, preset) {
  return labelFor(labelsOf(state, teacherId, preset), relationOf(state, teacherId));
}

/**
 * Сдвинуть отношение преподавателя или однокурсника (`teacherId` — id
 * человека, см. шапку раздела «однокурсники»).
 *
 * @param {Object} state
 * @param {{teacherId: string, delta: number, reason?: string}} ev
 * @param {Object} preset
 * @returns {{state: Object, applied: boolean, crossed: ?{from: string, to: string}}}
 */
export function changeRelation(state, ev, preset) {
  const next = cloneState(state);
  const teacherId = ev && ev.teacherId;
  const teacher = findPerson(next, teacherId);

  if (!teacher) {
    pushJournal(next, {
      kind: 'rel',
      text: `relation rejected: unknown teacher ${teacherId}`,
      data: { teacherId, delta: ev && ev.delta },
    }, preset);
    return { state: next, applied: false, crossed: null };
  }

  const scale = (preset && preset.relations) || {};
  const delta = Number(ev.delta);
  if (!Number.isFinite(delta)) return { state: next, applied: false, crossed: null };

  const before = teacher.relation;
  const labelBefore = relationLabel(next, teacherId, preset);

  // Зажим на границах пресета. Без него благосклонность копится бесконечно и
  // «любимица» перестаёт быть потолком, до которого надо дойти.
  teacher.relation = clamp(before + delta, scale.min, scale.max);

  const labelAfter = relationLabel(next, teacherId, preset);
  const applied = teacher.relation !== before;
  const crossed = labelAfter !== labelBefore ? { from: labelBefore, to: labelAfter } : null;

  pushJournal(next, {
    kind: 'rel',
    text: `relation ${teacher.id} ${labelBefore}->${labelAfter}`,
    data: { teacherId: teacher.id, delta, from: before, to: teacher.relation, reason: ev.reason || null },
  }, preset);

  return { state: next, applied, crossed };
}

/**
 * Применить сразу несколько сдвигов — так приходят эффекты из attendance.mjs.
 * Отдельная функция нужна, чтобы вызывающему не тащить состояние по цепочке руками.
 *
 * @param {Object} state
 * @param {Array<{teacherId: string, delta: number, reason?: string}>} list
 * @returns {{state: Object, crossed: Array<{teacherId: string, from: string, to: string}>}}
 */
export function applyRelationDeltas(state, list, preset) {
  let acc = state;
  const crossed = [];
  for (const ev of list || []) {
    const res = changeRelation(acc, ev, preset);
    acc = res.state;
    if (res.crossed) crossed.push({ teacherId: ev.teacherId, ...res.crossed });
  }
  return { state: acc, crossed };
}

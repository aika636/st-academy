// core/milestones — вехи студента: значимые моменты семестра, посчитанные по
// состоянию (план 9.4.2).
//
// Вехи — не «ачивки» и так не называются нигде: рядом может стоять Collection
// Vault со своими достижениями по маркеру модели, и два слова про одно в одном
// чате путали бы человека. У Academy события точные — оценки, посещаемость,
// исходы сессии лежат в состоянии, — поэтому вехи считаются по ним, а не
// спрашиваются у модели.
//
// Три решения, из которых вытекает модуль.
//
// 1. **Чистый пересчёт, никакого хранения.** `milestones(state, preset)` —
//    функция от состояния, и ничего в состояние не пишет. Отзыв вехи поэтому
//    бесплатен: свайп возвращает снимок (9.1.1) — пересчёт по нему вехи не
//    найдёт; человек стёр оценку в панели — то же самое. Collection Vault
//    так же пересчитывает и отзывает. Храни мы «полученные вехи» списком, у
//    каждой правки состояния появилась бы обязанность этот список чинить.
//
// 2. **Источник — долговечная часть состояния.** Журнал кольцевой
//    (`limits.journalSize`) и за семестр забывает начало, поэтому вехи, которые
//    должны жить вечно, считаются по тому, что из состояния не удаляется:
//    `subject.grades`, `attendance.records`, `exams.items` (с историей бросков
//    `rolls`), флаг `reputation.warned`. Журнал спрашивается только о ДАТЕ
//    вехи, у которой другого источника даты нет (порог отношения, порог
//    репутации); забыл журнал — веха остаётся, дата становится `null`.
//
// 3. **Ни одного слова в коде, кроме запасных названий.** Названия — фразы
//    пресета `phrases.milestones`; `DEFAULT_NAMES` ниже — запасной русский
//    вуз, как `DEFAULT_PHRASES` в `exams.mjs`. Пороги — из шкал пресета
//    (ярлыки отношения, предупреждение репутации, высшая оценка), своих чисел
//    у модуля нет.
//
// Вехи — это ещё и ответ на вопрос 8.5 («что писать в хронику лорбука»):
// значимое событие = веха. Какие именно из них уходят в хронику, решает
// `lorebook.mjs` (`CHRONICLE_MILESTONES`) — там же объяснено, почему не все.

import { findSubject, findTeacher } from './state.mjs';
import { addDays, diffDays, mondayOf } from './time.mjs';
import { dayPlan } from './schedule.mjs';
import { countsAttendance } from './attendance.mjs';
import { gradeInfo, isDatedExam, fill } from './exams.mjs';

/**
 * Виды вех. Порядок — порядок в списке при одинаковой дате. Ключ вида — он же
 * ключ названия в `phrases.milestones`; у вех «на человека» или «на период»
 * к id приписывается `:<id наставника>` / `:<номер периода>`.
 */
export const KINDS = [
  'firstTop', 'cleanWeek', 'debtCleared', 'cleanSession', 'autoPass', 'brilliant',
  'retakeWin', 'favorite', 'nemesis', 'onTheEdge', 'firstSkip', 'ghost', 'critFail',
];

/**
 * Тайные вехи: пока не получена, в каталоге видно только «???». Это вехи, о
 * которых смешнее узнать по факту, — первый прогул, провал века, — и те, что
 * звучат как подсказка «сделай плохо».
 */
export const SECRET_KINDS = ['nemesis', 'onTheEdge', 'firstSkip', 'ghost', 'critFail'];

/** Сколько прогулов делают героиню «призраком аудитории». */
export const GHOST_SKIPS = 10;

/**
 * Запасные названия — словами русского вуза, как умолчания фраз в `exams.mjs`.
 * Пресет перекрывает их блоком `phrases.milestones`; три встроенных пресета
 * пишут все ключи (это проверяет тест), так что умолчание видит только чужой
 * пресет, не дописавший словарь.
 *
 * Подстановки: `{subject}`, `{teacher}`, `{value}` (название оценки), `{n}`
 * (номер периода с единицы), плюс вся лексика `preset.vocab` — `{term}` там
 * слово периода («семестр», «триместр»).
 */
export const DEFAULT_NAMES = {
  firstTop: 'Первая высшая оценка: {subject}',
  cleanWeek: 'Неделя без прогулов',
  debtCleared: 'Хвост закрыт: {subject}',
  cleanSession: 'Сессия без пересдач',
  autoPass: 'Автомат: {subject}',
  brilliant: 'Блестящая сдача: {subject}',
  favorite: 'Любимица: {teacher}',
  nemesis: '{teacher} её не выносит',
  onTheEdge: 'На волоске от отчисления',
  retakeWin: 'Со второй попытки: {subject}',
  firstSkip: 'Первый прогул: {subject}',
  ghost: 'Призрак аудитории',
  critFail: 'Провал века: {subject}',
};

/**
 * Название вехи без подробностей — для каталога и для счёта «во всех
 * историях», где предмета и наставника нет. Пресет перекрывает блоком
 * `phrases.milestoneTitles`.
 */
export const DEFAULT_TITLES = {
  firstTop: 'Первая высшая оценка',
  cleanWeek: 'Неделя без прогулов',
  debtCleared: 'Хвост закрыт',
  cleanSession: 'Сессия без пересдач',
  autoPass: 'Автомат',
  brilliant: 'Блестящая сдача',
  retakeWin: 'Со второй попытки',
  favorite: 'Любимица преподавателя',
  nemesis: 'Заклятый враг',
  onTheEdge: 'На волоске от отчисления',
  firstSkip: 'Первый прогул',
  ghost: 'Призрак аудитории',
  critFail: 'Провал века',
};

/**
 * Как получить — подсказка в каталоге под неполученной вехой. У тайных
 * подсказка видна только после получения. Пресет перекрывает блоком
 * `phrases.milestoneHints`.
 */
export const DEFAULT_HINTS = {
  firstTop: 'Получить высшую оценку по любому предмету.',
  cleanWeek: 'Проучиться целую неделю без единого прогула.',
  debtCleared: 'Пересдать то, что было завалено.',
  cleanSession: 'Сдать всю сессию с первой попытки.',
  autoPass: 'Получить оценку автоматом, без экзамена.',
  brilliant: 'Сдать экзамен с огромным запасом: кубик лёг лучше некуда.',
  retakeWin: 'Завалить экзамен, а потом всё-таки сдать его.',
  favorite: 'Заслужить самое тёплое отношение преподавателя.',
  nemesis: 'Довести преподавателя до того, что он тебя не выносит.',
  onTheEdge: 'Получить предупреждение об отчислении.',
  firstSkip: 'Не прийти на занятие без уважительной причины.',
  ghost: 'Набрать десять прогулов.',
  critFail: 'Провалить экзамен с треском: кубик лёг хуже некуда.',
};

/**
 * @typedef {Object} Milestone
 * @property {string}  id    стабильный: по нему UI узнаёт «новая» и «отозвана»,
 *                           а лорбук — свою запись хроники
 * @property {string}  kind  один из `KINDS`
 * @property {?string} when  день вехи `ГГГГ-ММ-ДД`; `null` — веха есть, а дня
 *                           её состояние уже не помнит (см. решение 2)
 * @property {string}  [subjectId]
 * @property {string}  [teacherId]
 * @property {number}  [term]
 */

/**
 * Все вехи, какие есть в состоянии, от ранней к поздней. Вехи без даты — в
 * конце, в порядке `KINDS`.
 *
 * @param {Object} state
 * @param {Object} preset
 * @returns {Milestone[]}
 */
export function milestones(state, preset) {
  if (!state || typeof state !== 'object') return [];
  const out = [
    firstTop(state, preset),
    cleanWeek(state, preset),
    debtCleared(state, preset),
    ...cleanSessions(state, preset),
    fromRolls(state, 'autoPass', (r) => r.tier === 'auto'),
    fromRolls(state, 'brilliant', (r) => r.tier === 'critSuccess'),
    retakeWin(state, preset),
    ...relationZones(state, preset),
    onTheEdge(state, preset),
    firstSkip(state),
    ghost(state),
    fromRolls(state, 'critFail', (r) => r.tier === 'critFail'),
  ].filter(Boolean);

  const rank = (m) => KINDS.indexOf(m.kind);
  return out
    .map((m, i) => ({ m, i }))
    .sort((a, b) => {
      if (a.m.when && b.m.when && a.m.when !== b.m.when) return a.m.when < b.m.when ? -1 : 1;
      if (Boolean(a.m.when) !== Boolean(b.m.when)) return a.m.when ? -1 : 1;
      return (rank(a.m) - rank(b.m)) || (a.i - b.i);
    })
    .map((x) => x.m);
}

/**
 * Что появилось и что отозвано между двумя пересчётами — для тоста и для
 * вкладки. Сравнение по id: дата у вехи может уточниться (журнал вспомнил),
 * и это не новая веха.
 *
 * @returns {{added: Milestone[], removed: Milestone[]}}
 */
export function diffMilestones(before, after) {
  const was = new Set((before || []).map((m) => m.id));
  const now = new Set((after || []).map((m) => m.id));
  return {
    added: (after || []).filter((m) => !was.has(m.id)),
    removed: (before || []).filter((m) => !now.has(m.id)),
  };
}

/** Название вехи словами пресета. */
export function milestoneName(m, state, preset) {
  if (!m) return '';
  const own = (preset && preset.phrases && preset.phrases.milestones) || {};
  const template = own[m.kind] || DEFAULT_NAMES[m.kind] || m.kind;
  const vocab = (preset && preset.vocab) || {};
  const subject = m.subjectId ? findSubject(state, m.subjectId) : null;
  const teacher = m.teacherId ? findTeacher(state, m.teacherId) : null;
  const info = m.value !== undefined ? gradeInfo(preset, m.value) : null;
  return fill(template, {
    ...vocab,
    subject: (subject && subject.name) || m.subjectId || '',
    teacher: (teacher && teacher.name) || m.teacherId || '',
    value: (info && info.label) || (m.value !== undefined ? String(m.value) : ''),
    n: Number.isFinite(m.term) ? String(m.term + 1) : '',
  }).trim();
}

/** Название вехи без подробностей (каталог, счёт «во всех историях»). */
export function milestoneTitle(kind, preset) {
  const own = (preset && preset.phrases && preset.phrases.milestoneTitles) || {};
  return fill(own[kind] || DEFAULT_TITLES[kind] || kind, (preset && preset.vocab) || {}).trim();
}

/** Подсказка «как получить». */
export function milestoneHint(kind, preset) {
  const own = (preset && preset.phrases && preset.phrases.milestoneHints) || {};
  return fill(own[kind] || DEFAULT_HINTS[kind] || '', (preset && preset.vocab) || {}).trim();
}

/** Тайная ли веха. */
export const isSecretKind = (kind) => SECRET_KINDS.includes(kind);

/**
 * Каталог (страница достижений): каждый вид — полученный или нет, тайный или
 * нет, со всеми полученными экземплярами (у «любимицы» их может быть несколько
 * — по наставнику). Сначала полученные, потом остальные; внутри — порядок
 * `KINDS`: открытое человек ищет глазами первым.
 *
 * @param {Milestone[]} earned  то, что вернул `milestones()`
 * @returns {{kind: string, secret: boolean, earned: Milestone[]}[]}
 */
export function milestoneCatalog(earned) {
  const list = Array.isArray(earned) ? earned : [];
  const all = KINDS.map((kind) => ({
    kind,
    secret: isSecretKind(kind),
    earned: list.filter((m) => m && m.kind === kind),
  }));
  return [...all.filter((c) => c.earned.length), ...all.filter((c) => !c.earned.length)];
}

/** Сколько чатов помнит счёт «во всех историях» на одну веху. */
export const TALLY_CHATS_MAX = 200;

/**
 * Счёт «во всех историях»: в скольких чатах веха получена хоть раз.
 *
 * Живёт в настройках расширения (общих для всех чатов), а не в состоянии чата:
 * `{ [kind]: { chats: [ключ чата], first: 'ГГГГ-ММ-ДД' } }`. Функция чистая —
 * возвращает новый счёт или тот же объект, если записывать нечего, чтобы
 * вызывающий сохранял настройки только при деле.
 *
 * Отзыва здесь нет, и это сознательно: свайп, забравший веху у чата, не
 * отменяет того, что в этой истории она уже случалась. Счёт — память игрока, а
 * не состояние героини.
 *
 * @param {Object} tally   прежний счёт
 * @param {string} chatKey ключ чата; пустой — ничего не пишется
 * @param {Milestone[]} list вехи чата
 * @param {string} today   настоящая дата `ГГГГ-ММ-ДД` (не игровая)
 * @returns {Object}
 */
export function recordTally(tally, chatKey, list, today) {
  const base = tally && typeof tally === 'object' && !Array.isArray(tally) ? tally : {};
  if (!chatKey || !Array.isArray(list) || !list.length) return base;
  let out = base;
  for (const kind of new Set(list.map((m) => m && m.kind).filter((k) => KINDS.includes(k)))) {
    const cur = base[kind] && Array.isArray(base[kind].chats) ? base[kind] : { chats: [], first: null };
    if (cur.chats.includes(chatKey)) continue;
    if (out === base) out = { ...base };
    out[kind] = {
      chats: [...cur.chats, chatKey].slice(-TALLY_CHATS_MAX),
      first: cur.first || today || null,
    };
  }
  return out;
}

// --- вехи по одной ----------------------------------------------------------

/**
 * Первая высшая оценка шкалы — по баллам, а не по строке: у русского пресета
 * «автомат» стоит теми же пятью баллами, что и «5», и тоже высшая. Оценки
 * шкалы «зачёт/незачёт» баллов не имеют и вехой не считаются: «первый зачёт»
 * — не событие.
 */
function firstTop(state, preset) {
  const points = ((preset && preset.grades && preset.grades.values) || [])
    .filter((v) => typeof v.points === 'number' && Number.isFinite(v.points))
    .map((v) => v.points);
  if (!points.length) return null;
  const top = Math.max(...points);

  let best = null;
  for (const subject of state.subjects || []) {
    for (const g of subject.grades || []) {
      const info = gradeInfo(preset, g.value);
      if (!info || info.points !== top) continue;
      const day = g.day || null;
      if (!best || (day && (!best.when || day < best.when))) {
        best = { id: 'firstTop', kind: 'firstTop', when: day, subjectId: subject.id, value: String(info.value) };
      }
    }
  }
  return best;
}

/**
 * Первая неделя без прогулов.
 *
 * Неделя — календарная, с понедельника (`time.mondayOf`), и засчитывается,
 * только когда **кончилась**: календарь уже в следующей. Засчитывается она,
 * если в каждом её дне с парами (`schedule.dayPlan`) есть хоть одна отметка
 * ведомости и ни одной отметки «прогул». Опоздание и уважительная причина —
 * не прогул.
 *
 * Требование «в каждом дне есть отметка» — не придирка. Неделю, которую
 * календарь перепрыгнул за горизонтом вывода (`attendance.shouldInfer`), ведомость
 * не заполняет вовсе: о ней неизвестно ничего, и объявить её «чистой» значило
 * бы наградить за прыжок. День заведения семестра не считается
 * (`attendance.countsAttendance`) — ровно как не считается ведомостью.
 */
function cleanWeek(state, preset) {
  const records = (state.attendance && state.attendance.records) || [];
  const today = state.calendar && state.calendar.day;
  if (!records.length || !today) return null;

  const weeks = [...new Set(records.map((r) => r.day).filter(Boolean).map(mondayOf))].sort();
  const thisWeek = mondayOf(today);
  for (const monday of weeks) {
    if (diffDays(monday, thisWeek) <= 0) break; // эта неделя ещё не кончилась
    const mine = records.filter((r) => r.day && mondayOf(r.day) === monday);
    if (mine.some((r) => r.status === 'skip')) continue;

    let last = null;
    let ok = true;
    for (let d = 0; d < 7; d += 1) {
      const day = addDays(monday, d);
      if (!countsAttendance(state, day)) continue;
      if (!dayPlan(state, preset, day).length) continue;
      if (!mine.some((r) => r.day === day)) { ok = false; break; }
      last = day;
    }
    if (ok && last) return { id: 'cleanWeek', kind: 'cleanWeek', when: last };
  }
  return null;
}

/**
 * Первый закрытый хвост.
 *
 * Хвост по правилу зачётки (`gradebook.addGrade`) ставит любая непроходная
 * оценка и снимает любая проходная — «пересдача — это просто ещё одна запись в
 * зачётке». Значит, закрытый хвост виден в самой зачётке: непроходная оценка,
 * а после неё проходная. Это касается и сессии: заваленный экзамен и сданная
 * пересдача — в разговорном смысле тоже «закрыла хвост».
 *
 * Второй источник хвоста — прогулы (`attendance.debtAfterSkips`), и его в
 * зачётке не видно. День, когда он встал, восстанавливается по ведомости: день,
 * в который набралось пороговое число прогулов (с опозданиями по
 * `lateEqualsSkip`). Проходная оценка **после** этого дня хвост закрывает — по
 * нынешнему правилу, которое вопрос 8.7 оставил как есть.
 *
 * Хвост «несевшего» (`closeExamSession`) дня не имеет — закрытие сессии
 * случается на смене периода, а не в день; веху он даёт, если после дня
 * события по предмету пришла проходная оценка.
 */
function debtCleared(state, preset) {
  let best = null;
  for (const subject of state.subjects || []) {
    const debtDays = [skipDebtDay(state, subject.id, preset), missedDebtDay(state, subject.id)]
      .filter(Boolean)
      .sort();
    let inDebt = false;
    let pendingIdx = 0;
    for (const g of subject.grades || []) {
      while (pendingIdx < debtDays.length && g.day && debtDays[pendingIdx] < g.day) {
        inDebt = true;
        pendingIdx += 1;
      }
      const info = gradeInfo(preset, g.value);
      if (!info) continue;
      if (!info.pass) { inDebt = true; continue; }
      if (inDebt) {
        const when = g.day || null;
        if (!best || (when && (!best.when || when < best.when))) {
          best = { id: 'debtCleared', kind: 'debtCleared', when, subjectId: subject.id };
        }
        break; // нужен первый закрытый хвост предмета, дальше искать незачем
      }
    }
  }
  return best;
}

/** День, когда прогулы по предмету перешли порог хвоста; `null` — не переходили. */
function skipDebtDay(state, subjectId, preset) {
  const att = (preset && preset.attendance) || {};
  const threshold = att.debtAfterSkips;
  if (typeof threshold !== 'number') return null;
  const per = typeof att.lateEqualsSkip === 'number' && att.lateEqualsSkip > 0 ? att.lateEqualsSkip : null;
  const mine = ((state.attendance && state.attendance.records) || [])
    .filter((r) => r.subjectId === subjectId && r.day)
    .slice()
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  let skips = 0;
  let lates = 0;
  for (const r of mine) {
    if (r.status === 'skip') skips += 1;
    else if (r.status === 'late') lates += 1;
    else continue;
    if (skips + (per ? Math.floor(lates / per) : 0) >= threshold) return r.day;
  }
  return null;
}

/** День события, которое так и не сдали и которое стало хвостом при закрытии сессии. */
function missedDebtDay(state, subjectId) {
  const items = ((state.exams && state.exams.items) || []).filter((i) => i.subjectId === subjectId && i.missed && i.day);
  return items.length ? items.map((i) => i.day).sort()[0] : null;
}

/**
 * Сессия без пересдач — по одной вехе на период.
 *
 * Считаются события самой сессии: у видов со своим окном в календаре
 * (японская середина триместра, `atWeek`) свой ритм, и «сессией» их не зовёт
 * никто. Веха есть, когда ВСЕ события сессии периода сданы проходно с первой
 * попытки, и ни одно не стало хвостом несевшего. Пока хоть одно не сдано —
 * вехи ещё нет (и это не отзыв: её просто рано давать).
 *
 * Версия модели (`modelOverride`) учитывается как есть: состояние — то, что
 * случилось в сцене, а не то, что бросил кубик.
 */
function cleanSessions(state, preset) {
  const items = ((state.exams && state.exams.items) || []).filter((i) => !isDatedExam(preset, i));
  const terms = [...new Set(items.map((i) => (Number.isFinite(i.term) ? i.term : 0)))].sort((a, b) => a - b);
  const out = [];
  for (const term of terms) {
    const mine = items.filter((i) => (Number.isFinite(i.term) ? i.term : 0) === term);
    if (!mine.length) continue;
    const clean = mine.every((i) => !i.missed
      && i.outcome !== null && i.outcome !== undefined && i.outcome !== ''
      && Number(i.attempts) === 1
      && Boolean(gradeInfo(preset, i.outcome) && gradeInfo(preset, i.outcome).pass));
    if (!clean) continue;
    const days = mine.map((i) => i.day).filter(Boolean).sort();
    out.push({ id: `cleanSession:${term}`, kind: 'cleanSession', when: days.length ? days[days.length - 1] : null, term });
  }
  return out;
}

/**
 * Первая строка истории бросков (`item.rolls`, `exams.rollRecord`), подходящая
 * под условие. История есть только у бросков, сделанных после её появления:
 * у старого состояния этих вех нет — выдумывать, был ли тот исход автоматом,
 * не по чему.
 *
 * Крит, переписанный версией модели, вехой не считается: если модель отыграла
 * тройку, «блестящей сдачи» в сцене не было, как бы ни лёг кубик.
 */
function fromRolls(state, kind, test) {
  let best = null;
  for (const item of (state.exams && state.exams.items) || []) {
    const rolls = Array.isArray(item.rolls) ? item.rolls : [];
    rolls.forEach((r, idx) => {
      if (!r || !test(r)) return;
      const lastOverridden = idx === rolls.length - 1 && item.modelOverride && String(item.outcome) !== String(r.value);
      if (lastOverridden) return;
      const when = r.day || null;
      if (!best || (when && (!best.when || when < best.when))) {
        best = { id: kind, kind, when, subjectId: item.subjectId, value: String(r.value) };
      }
    });
  }
  return best;
}

/**
 * Отношение через порог: наставник в крайнем ярлыке шкалы — верхнем
 * («любимица») или нижнем («ненавидит»). По одной вехе на наставника.
 *
 * Порог — это ярлыки пресета, а не число: веха меряется так же, как значимость
 * в хронике (`lorebook.isSignificant`), словом, которое видит модель.
 *
 * Веха держится, пока держится отношение: наставник остыл — веха отозвана.
 * Это прямое следствие «пересчёта без хранения» (решение 1): чтобы помнить
 * «была любимицей», нужна история отношения, а она живёт только в кольцевом
 * журнале. Дата — последний переход в зону по журналу, если он его помнит.
 */
function relationZones(state, preset) {
  const labels = (preset && preset.relations && preset.relations.labels) || [];
  if (labels.length < 2) return [];
  const topFrom = labels[labels.length - 2].upTo; // выше этого — верхний ярлык
  const bottomTo = labels[0].upTo; // не выше этого — нижний
  const inTop = (v) => typeof v === 'number' && v > topFrom;
  const inBottom = (v) => typeof v === 'number' && v <= bottomTo;

  const out = [];
  for (const t of state.teachers || []) {
    for (const [kind, inside] of [['favorite', inTop], ['nemesis', inBottom]]) {
      if (!inside(t.relation)) continue;
      const when = lastJournalDay(state, (e) => e.kind === 'rel' && e.data
        && e.data.teacherId === t.id && !inside(e.data.from) && inside(e.data.to));
      out.push({ id: `${kind}:${t.id}`, kind, when, teacherId: t.id });
    }
  }
  return out;
}

/**
 * «На волоске» — было предупреждение по репутации. Флаг `reputation.warned`
 * ставится один раз и не снимается (`reputation.changeReputation`), поэтому и
 * веха вечная: вызов к начальству был, даже если потом репутацию отмыли.
 * Дата — первый переход порога предупреждения по журналу.
 */
function onTheEdge(state, preset) {
  if (!(state.reputation && state.reputation.warned)) return null;
  const warnAt = preset && preset.reputation && preset.reputation.warnAt;
  const when = typeof warnAt === 'number'
    ? firstJournalDay(state, (e) => e.kind === 'reputation' && e.data
      && typeof e.data.from === 'number' && typeof e.data.to === 'number'
      && e.data.from > warnAt && e.data.to <= warnAt)
    : null;
  return { id: 'onTheEdge', kind: 'onTheEdge', when };
}

/**
 * Со второй попытки — первое событие контрольной, сданное проходно, когда
 * попыток было больше одной. Версия модели учитывается как есть: состояние —
 * то, что случилось в сцене.
 */
function retakeWin(state, preset) {
  let best = null;
  for (const item of (state.exams && state.exams.items) || []) {
    if (!(Number(item.attempts) > 1)) continue;
    const info = item.outcome !== null && item.outcome !== undefined && item.outcome !== ''
      ? gradeInfo(preset, item.outcome) : null;
    if (!info || !info.pass) continue;
    const rolls = Array.isArray(item.rolls) ? item.rolls : [];
    const last = rolls.length ? rolls[rolls.length - 1] : null;
    const when = (last && last.day) || item.day || null;
    if (!best || (when && (!best.when || when < best.when))) {
      best = { id: 'retakeWin', kind: 'retakeWin', when, subjectId: item.subjectId };
    }
  }
  return best;
}

/** Прогулы ведомости по порядку дней. */
function skipsInOrder(state) {
  return ((state.attendance && state.attendance.records) || [])
    .filter((r) => r && r.status === 'skip' && r.day)
    .slice()
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

/** Первый прогул — по ведомости, которая из состояния не удаляется. */
function firstSkip(state) {
  const first = skipsInOrder(state)[0];
  return first ? { id: 'firstSkip', kind: 'firstSkip', when: first.day, subjectId: first.subjectId } : null;
}

/** Призрак аудитории — `GHOST_SKIPS` прогулов за всё время; дата — день последнего из них. */
function ghost(state) {
  const list = skipsInOrder(state);
  return list.length >= GHOST_SKIPS ? { id: 'ghost', kind: 'ghost', when: list[GHOST_SKIPS - 1].day } : null;
}

// --- мелочи -----------------------------------------------------------------

function firstJournalDay(state, test) {
  const hit = (state.journal || []).find((e) => e && test(e));
  return (hit && hit.day) || null;
}

function lastJournalDay(state, test) {
  const list = state.journal || [];
  for (let i = list.length - 1; i >= 0; i -= 1) if (list[i] && test(list[i])) return list[i].day || null;
  return null;
}

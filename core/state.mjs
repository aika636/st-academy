// core/state — форма состояния семестра, конструктор и валидация.
//
// Это контракт, на который опираются все остальные модули ядра: календарь,
// расписание, зачётка, посещаемость, репутация, отношения, сессия и парсеры.
// Модуль ничего не считает и ничего не решает — он только описывает форму,
// создаёт пустой семестр и проверяет чужой объект на пригодность.
//
// Три требования, из которых вытекает всё остальное.
//
// 1. **Сериализуемость без потерь.** Состояние живёт в `chat_metadata` таверны и
//    уезжает в JSON при каждом сохранении (3.8 плана). Поэтому здесь нет ни
//    `Date`, ни `Map`, ни `Set`, ни функций: даты — строки `ГГГГ-ММ-ДД`, время —
//    `ЧЧ:ММ`, всё остальное — числа, строки, массивы и простые объекты.
// 2. **Версия с первого дня.** `schemaVersion` пишется всегда, `migrate()`
//    существует до того, как появилась первая миграция. Расширение, теряющее
//    чужой семестр после обновления, теряет вместе с ним и репутацию.
// 3. **Пресет не копируется внутрь состояния.** В состоянии лежит только `presetId`
//    и то, что игрок правил руками. Пресет — это лексика и правила, он приходит
//    отдельным аргументом в каждую функцию, которой нужен. Иначе правка пресета
//    никогда не доедет до уже начатого семестра.

import { normalizeClassmates, normalizeCandidates, classmateErrors } from './classmates.mjs';
import { isPortrait, normalizePortrait, normalizeLooks, looksOk } from './portraits.mjs';

/**
 * Версия схемы состояния. Растёт при любой несовместимой правке формы.
 *
 * 2 — у сессии появился номер учебного периода (`exams.term`, `ExamItem.term`),
 *     а id события стало `период:предмет:вид`. Подъём — в `migrate()`.
 * 3 — у героини появился курс: `classmates` и `classmateCandidates`
 *     (`core/classmates.mjs`). Подъём — пустые списки, остальное не трогается.
 */
export const SCHEMA_VERSION = 3;

/** Ключ, под которым состояние лежит в `chat_metadata`. */
export const METADATA_KEY = 'academy';

/**
 * @typedef {Object} Calendar
 * @property {string}  day        текущая дата, `ГГГГ-ММ-ДД`
 * @property {?string} time       часы `ЧЧ:ММ`, либо null, если известен только день
 * @property {'datetime'|'date'} precision  какая точность у календаря сейчас
 * @property {?string} daypart    часть суток словом: morning|day|evening|night
 * @property {?number} periodIndex какая пара идёт по счёту (с нуля), когда часов нет
 * @property {string}  termStart  дата начала семестра, `ГГГГ-ММ-ДД`
 * @property {number}  moved      сколько раз календарь двигался за семестр
 * @property {number}  idle       сколько ответов подряд ни один источник не сработал
 * @property {?('A+'|'A'|'B'|'manual')} source кто двинул время в последний раз ('A+' — тег соседа)
 * @property {?HeldJump} heldJump прыжок вперёд, отвергнутый по потолку и ждущий
 *                                слова человека. Поля может не быть вовсе.
 */

/**
 * @typedef {Object} HeldJump
 * @property {string}  day   куда прыгает источник, `ГГГГ-ММ-ДД`
 * @property {?string} time  часы оттуда же, если были названы
 * @property {?string} daypart
 * @property {number}  jump  на сколько суток вперёд
 * @property {string}  from  откуда прыгает: день календаря на момент отказа
 */

/**
 * @typedef {Object} Subject
 * @property {string}  id         короткий идентификатор: `chemistry`. Именно он
 *                                стоит в метке `grade=chemistry:4` — поправка 1
 *                                замера B: длинные имена с пробелами модель ломает.
 * @property {string}  name       как называется по-человечески: «аналитическая химия»
 * @property {?string} teacherId  ссылка на `Teacher.id`
 * @property {Array<{value: string, day: string}>} grades выставленные оценки
 * @property {boolean} debt       хвост: есть несданное, что должно быть сдано
 * @property {?string} examKind   вид контрольного события для этого предмета
 *                                (id из `preset.exams.kinds`). Задаётся планом или
 *                                руками; если пусто — вид раздаёт `exams.mjs`.
 * @property {string[]} [examKinds] несколько видов по одному предмету: середина и
 *                                конец, теория и практика. Старшее правило, чем
 *                                `examKind`; поля может не быть вовсе.
 * @property {string}  [building] корпус, где идёт предмет (9.7A п.11): «главный»,
 *                                «Б». Свободный текст человека, до `PLACE_MAX`
 *                                символов. Мест как сущности в состоянии нет, поэтому
 *                                поле живёт у предмета: карта кампуса (9.4.7) потом
 *                                строится из данных, а не переписывается.
 * @property {string}  [room]     аудитория того же предмета: «214», «Большой зал».
 *                                Оба поля необязательны, пустых ключей нет.
 */

/**
 * @typedef {Object} Teacher
 * @property {string}   id
 * @property {string}   name      «Петрова Анна Сергеевна»
 * @property {string[]} traits    одна-две черты: «злопамятна», «придирается к опозданиям»
 * @property {number}   relation  число внутри, наружу уходит ярлык из пресета
 * @property {string}   [portrait] портрет (9.7A п.15): путь от корня таверны
 *                                (`characters/…/x.png`, `/img/…`) или ссылка
 *                                `http(s)://`. Без генерации — только адрес, который
 *                                дал человек. Форма — `isPortrait`.
 * @property {string}   [post]    должность в заведении помимо предмета: «директор»,
 *                                «заведующая кафедрой» (до `TEACHER_TEXT_MAX.post`)
 * @property {string}   [likes]   что любит — зацепка для сцены: «белое вино и
 *                                дорогие картины»
 * @property {string}   [secret]  тайна, которой героиня не знает; в лорбук уходит
 *                                с пометкой «только намёками». Все три поля
 *                                необязательны: пустое — ключа нет.
 */

/**
 * @typedef {Object} AttendanceRecord
 * @property {string}  day
 * @property {string}  subjectId
 * @property {'present'|'skip'|'late'|'excused'} status
 * @property {?number} periodIndex
 * @property {number}  [cost]      сколько репутации снял этот прогул (положительное
 *                                 число); отработка возвращает ровно столько
 * @property {string}  [workedOff] день, когда прогул отработан (`attendance.workOff`);
 *                                 записи остаются в истории, но не висят открытыми
 */

/**
 * @typedef {Object} ExamItem
 * @property {string}  id         `период:предмет:вид` — событие различается всеми
 *                                тремя: у японского пресета три триместра, и в
 *                                каждом сдаются те же предметы теми же видами
 * @property {number}  term       номер учебного периода с нуля (`time.termsOf`)
 * @property {string}  subjectId
 * @property {string}  kind       id вида из `preset.exams.kinds`
 * @property {?string} day        когда назначено, `ГГГГ-ММ-ДД`
 * @property {?string} outcome    значение из шкалы оценок; пока не сдано — null
 * @property {number}  attempts   сколько попыток потрачено
 * @property {boolean} [modelOverride] исход, который отыграла модель, разошёлся с
 *                                посчитанным, и принята версия модели (3.5).
 *                                Расхождение при этом лежит в журнале.
 * @property {RollRecord[]} [rolls] история бросков по попыткам (9.4.1,
 *                                `exams.rollRecord`). Поля может не быть: у
 *                                событий, сданных до проверки против DC, и у
 *                                исходов, выставленных руками.
 * @property {boolean} [announced] объявлен ли итог последней попытки (9.4.3,
 *                                «знает расширение / знает мир»). `false` —
 *                                посчитан, но мир его ещё не знает; поля нет или
 *                                `true` — объявлен (старые события — объявлены).
 * @property {string}  [announceOn] день объявления, `ГГГГ-ММ-ДД`; есть, пока и
 *                                после того, как итог ждал объявления
 */

/**
 * @typedef {Object} RollRecord
 * Одна попытка сдачи — компактно, потому что живёт в `chat_metadata` вечно.
 * Слагаемые DC сюда не входят: они в журнале (`data.check`).
 * @property {string}  day
 * @property {'critFail'|'fail'|'success'|'critSuccess'|'auto'} tier ступень
 *                     проверки; `auto` — автомат, броска не было
 * @property {number}  [roll]  d20; у автомата нет
 * @property {number}  [dc]    сложность; у автомата нет
 * @property {string}  value   посчитанное значение шкалы (версия модели, если
 *                             разошлась, — в `ExamItem.outcome`)
 * @property {true}    [saved] сработала страховка балла: провал засчитан
 *                             низшей проходной ступенью
 * @property {true}    [capped] сработал потолок балла: крит ниже проходного
 *                             балла засчитан лучшим обычным успехом
 */

/**
 * @typedef {Object} JournalEntry
 * @property {string} day
 * @property {string} kind  'time'|'grade'|'rel'|'attendance'|'reputation'|'exam'|'debug'
 * @property {string} text  человекочитаемо, для режима отладки
 * @property {*}      [data]
 */

/**
 * @typedef {Object} PendingInject
 * Одноразовый инжект: посчитанный расширением факт, который модель обязана учесть
 * в следующем ответе (3.5). Снимается по MESSAGE_RECEIVED и MESSAGE_SWIPED.
 * @property {string} id
 * @property {string} text
 * @property {string} kind
 */

/**
 * @typedef {Object} State
 * @property {number}    schemaVersion
 * @property {string}    presetId
 * @property {string}    lang
 * @property {boolean}   started   семестр начат явно кнопкой; до этого расширение молчит
 * @property {Object}    survey    анкета из 3.6, как её заполнил человек
 * @property {Calendar}  calendar
 * @property {Subject[]} subjects
 * @property {Teacher[]} teachers
 * @property {Object<string, string[]>} schedule день недели (1–7) → id предметов по порядку
 * @property {{records: AttendanceRecord[]}} attendance
 * @property {{value: number, warned: boolean, expelled: boolean}} reputation
 * @property {{active: boolean, term: ?number, items: ExamItem[]}} exams
 *   `term` — номер периода, чья сессия открыта (или была открыта последней).
 *   Сессия принадлежит учебному периоду, а не году: без номера флаг `active`,
 *   поднятый в первом триместре, навсегда запирал вход во второй.
 * @property {JournalEntry[]}  journal
 * @property {PendingInject[]} pending
 * @property {Object<string, {delta: number, count: number, day: string}>} [relStreak]
 *   серии одинаковых сдвигов отношения по наставникам и однокурсникам —
 *   антиинфляция 9.3.5, `core/relations.mjs`. Поля может не быть: пустая серия.
 * @property {Object[]} classmates  курс героини — форма `Classmate` в шапке
 *   `core/classmates.mjs`: имя, желание, связь, проблема, кружок, отношение
 * @property {Object[]} classmateCandidates  предложенные, но не подтверждённые
 *   человеком однокурсники (из сцены, лорбука, карточки)
 */

/**
 * Пустая анкета: шесть полей из таблицы 3.6, все строками. Седьмое, `gender`
 * (`'f'` / `'m'`, обращение к герою, `core/gender`), в пустую анкету не входит: его
 * нет, пока человек не выбрал, и тогда род берётся по имени героя.
 */
export function emptySurvey() {
  return { era: '', country: '', institution: '', faculty: '', year: '', lang: 'ru' };
}

/**
 * Новый семестр. Всё, кроме `preset`, необязательно: расписание, предметы и
 * преподаватели приходят позже — из генерации по анкете или из ручного ввода.
 *
 * @param {Object} preset
 * @param {Object} [opts]
 * @param {string} [opts.startDay] дата первого учебного дня, `ГГГГ-ММ-ДД`
 * @param {Object} [opts.survey]
 * @param {Subject[]} [opts.subjects]
 * @param {Teacher[]} [opts.teachers]
 * @param {Object<string, string[]>} [opts.schedule]
 * @param {Object[]} [opts.classmates]
 * @returns {State}
 */
export function createState(preset, opts = {}) {
  if (!preset || typeof preset !== 'object') throw new TypeError('createState: нужен пресет');

  const startDay = opts.startDay || defaultStartDay(preset);

  return {
    schemaVersion: SCHEMA_VERSION,
    presetId: preset.id,
    lang: preset.lang || 'ru',
    started: false,
    survey: { ...emptySurvey(), ...(opts.survey || {}) },
    calendar: {
      day: startDay,
      time: null,
      precision: 'date',
      daypart: null,
      periodIndex: null,
      termStart: startDay,
      moved: 0,
      idle: 0,
      source: null,
      // Придержанный прыжок вперёд (`time.setAbsolute`, `limits.maxForwardJump`).
      // Пусто у нового семестра и почти всегда — поле живёт от появления
      // прыжка до ответа человека.
      heldJump: null,
    },
    subjects: (opts.subjects || []).map(normalizeSubject),
    teachers: (opts.teachers || []).map((t) => normalizeTeacher(t, preset)),
    schedule: { ...(opts.schedule || {}) },
    attendance: { records: [] },
    reputation: { value: numberOr(preset.reputation && preset.reputation.start, 50), warned: false, expelled: false },
    exams: { active: false, term: null, items: [] },
    journal: [],
    pending: [],
    classmates: normalizeClassmates(opts.classmates, preset),
    classmateCandidates: [],
  };
}

/**
 * Дата первого дня семестра (`ММ-ДД` из пресета) в текущем году.
 *
 * Начало берётся из `calendar.termStart`, а если пресет описал учебный год
 * списком периодов — из начала первого. Обе формы живут одновременно: список
 * появился позже, и пресеты на трёх скалярах ломать нельзя (см. `time.termsOf`).
 */
export function defaultStartDay(preset, today = new Date()) {
  const cal = (preset && preset.calendar) || {};
  const terms = Array.isArray(cal.terms) ? cal.terms : [];
  const md = cal.termStart || (terms[0] && terms[0].start) || '09-01';
  return `${today.getFullYear()}-${md}`;
}

/** Приводит предмет к форме `Subject`, не выдумывая недостающего. */
export function normalizeSubject(raw) {
  return {
    id: String(raw.id || '').trim(),
    name: String(raw.name || raw.id || '').trim(),
    teacherId: raw.teacherId ? String(raw.teacherId) : null,
    // Вид контрольного события переживает нормализацию: он приходит из
    // сгенерированного плана или из ручной правки задолго до сессии, и потерять
    // его здесь значит раздать всем предметам вид по умолчанию.
    examKind: raw.examKind ? String(raw.examKind) : null,
    // Несколько видов по одному предмету («середина» и «конец»). Поле
    // необязательное: пусто — вид раздаёт `exams.kindsForSubject`, и пресеты,
    // где на предмет приходится одно контрольное, его не пишут вовсе.
    ...(Array.isArray(raw.examKinds) && raw.examKinds.length
      ? { examKinds: raw.examKinds.map(String) }
      : {}),
    grades: Array.isArray(raw.grades)
      ? raw.grades.map((g) => ({ value: String(g.value), day: String(g.day || '') }))
      : [],
    debt: Boolean(raw.debt),
    // Причина хвоста (`gradebook.DEBT_*`). Поле необязательное и пишется только
    // при поднятом флаге: у предмета без хвоста причины нет, а у хвоста,
    // поставленного до её появления, — не выдумывается. Форма предмета без
    // хвоста от этого не меняется ни на ключ.
    ...(raw.debt && raw.debtReason ? { debtReason: String(raw.debtReason) } : {}),
    // Корпус и аудитория (9.7A п.11) — необязательны и, как причина хвоста,
    // пишутся только непустыми: форма старых предметов не меняется ни на ключ.
    ...placeField('building', raw.building),
    ...placeField('room', raw.room),
  };
}

/** Потолок длины корпуса и аудитории: это подпись в карточке, а не абзац. */
export const PLACE_MAX = 60;

/** `{[key]: строка}` для непустого места или `{}` — пустых ключей не бывает. */
function placeField(key, raw) {
  return textField(key, raw, PLACE_MAX);
}

/** Строка в одну строку до `max` символов под ключом `key`, либо `{}`. */
function textField(key, raw, max) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return {};
  const v = String(raw).replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return v ? { [key]: v } : {};
}

/**
 * Потолки «души» преподавателя: должность, что любит, тайна. Это подписи в
 * карточке и одна фраза в лорбуке, а не биография — длинное режется.
 */
export const TEACHER_TEXT_MAX = { post: 60, likes: 120, secret: 160 };

/**
 * `{post?, likes?, secret?}` из чего угодно: строка в одну строку, обрезанная до
 * потолка; пустое и не-строка — ключа нет. Одна нормализация на состояние,
 * разбор плана и правку с вкладки «Люди».
 */
export function teacherDetails(raw) {
  const out = {};
  for (const [key, max] of Object.entries(TEACHER_TEXT_MAX)) {
    Object.assign(out, textField(key, raw && raw[key], max));
  }
  return out;
}

// Портрет: проверка адреса живёт в `core/portraits.mjs` рядом с остальным
// чистым про картинки; отсюда — та же функция, по старому адресу.
export { PORTRAIT_MAX, isPortrait, normalizePortrait } from './portraits.mjs';

/** Приводит преподавателя к форме `Teacher`. Отношение — из пресета, если не задано. */
export function normalizeTeacher(raw, preset) {
  const start = preset && preset.relations ? preset.relations.start : 0;
  return {
    id: String(raw.id || '').trim(),
    name: String(raw.name || raw.id || '').trim(),
    traits: Array.isArray(raw.traits) ? raw.traits.map(String) : [],
    relation: numberOr(raw.relation, numberOr(start, 0)),
    // Портрет (9.7A п.15) необязателен: нет адреса или он не годится — нет ключа.
    // Дня рождения у наставника больше нет: старое поле `birthday` здесь отпадает.
    ...(normalizePortrait(raw.portrait) ? { portrait: normalizePortrait(raw.portrait) } : {}),
    // Должность, «любит» и тайна — тоже необязательны и без пустых ключей:
    // преподаватель старого семестра не меняется ни на ключ.
    ...teacherDetails(raw),
    // Своё описание внешности (шаг 4, «Нарисовать») — для промпта рисования.
    ...(normalizeLooks(raw.looks) ? { looks: normalizeLooks(raw.looks) } : {}),
  };
}

/**
 * Проверка чужого объекта: пришёл из метаданных чата, из импорта или из теста.
 * Не чинит и не бросает — возвращает список претензий. Чинит `migrate()`.
 *
 * @param {*} state
 * @param {Object} [preset] если передан, проверяются и лимиты пресета
 * @returns {{ok: boolean, errors: string[]}}
 */
export function validateState(state, preset) {
  const errors = [];
  const bad = (m) => errors.push(m);

  if (!state || typeof state !== 'object') return { ok: false, errors: ['состояние не объект'] };

  // Перекрёстные проверки ниже ходят по спискам предметов и преподавателей, и
  // ходить им надо по массивам. `state.subjects || []` от строки не спасает:
  // у строки нет `some`, и проверка целостности падала бы ровно на том
  // состоянии, ради которого она написана.
  const subjectList = Array.isArray(state.subjects) ? state.subjects : [];
  const teacherList = Array.isArray(state.teachers) ? state.teachers : [];
  if (state.schemaVersion !== SCHEMA_VERSION) {
    bad(`версия схемы ${state.schemaVersion}, ожидается ${SCHEMA_VERSION}`);
  }
  if (!state.presetId) bad('нет presetId');

  const c = state.calendar;
  if (!c || typeof c !== 'object') {
    bad('нет календаря');
  } else {
    if (!isDay(c.day)) bad(`календарь: день «${c.day}» не в форме ГГГГ-ММ-ДД`);
    if (c.time !== null && !isTime(c.time)) bad(`календарь: время «${c.time}» не в форме ЧЧ:ММ`);
    if (c.precision !== 'date' && c.precision !== 'datetime') bad(`календарь: точность «${c.precision}»`);
    if (c.precision === 'datetime' && c.time === null) bad('календарь: точность datetime без часов');
    if (!isDay(c.termStart)) bad('календарь: нет начала семестра');
  }

  if (!Array.isArray(state.subjects)) {
    bad('subjects не массив');
  } else {
    const seen = new Set();
    for (const s of state.subjects) {
      if (!s.id) bad('предмет без id');
      else if (seen.has(s.id)) bad(`предмет ${s.id} повторяется`);
      seen.add(s.id);
      if (s.teacherId && !teacherList.some((t) => t.id === s.teacherId)) {
        bad(`предмет ${s.id} ссылается на неизвестного преподавателя ${s.teacherId}`);
      }
      // Корпус и аудитория необязательны, но если есть — это короткая строка:
      // панель печатает их в карточку «Сегодня», а карта кампуса будет их
      // сравнивать.
      for (const key of ['building', 'room']) {
        if (s[key] === undefined || s[key] === null) continue;
        if (typeof s[key] !== 'string' || !s[key].trim() || s[key].length > PLACE_MAX) {
          bad(`предмет ${s.id}: ${key === 'building' ? 'корпус' : 'аудитория'} — не строка до ${PLACE_MAX} символов`);
        }
      }
    }
    const max = preset && preset.limits && preset.limits.maxSubjects;
    if (max && state.subjects.length > max) bad(`предметов ${state.subjects.length}, потолок ${max}`);
  }

  if (!Array.isArray(state.teachers)) {
    bad('teachers не массив');
  } else {
    const seen = new Set();
    for (const t of state.teachers) {
      if (!t.id) bad('преподаватель без id');
      else if (seen.has(t.id)) bad(`преподаватель ${t.id} повторяется`);
      seen.add(t.id);
      // Портрет уходит в `<img src>` панели: строка другой формы — это либо
      // мусор, либо схема, которую открывать нельзя (`isPortrait`).
      if (t.portrait !== undefined && t.portrait !== null && !isPortrait(t.portrait)) {
        bad(`преподаватель ${t.id}: портрет — не путь от корня таверны и не ссылка http(s)`);
      }
      // Должность, «любит», тайна: необязательны, но если есть — непустая
      // строка до потолка. Панель и лорбук печатают их как есть.
      for (const [key, max] of Object.entries(TEACHER_TEXT_MAX)) {
        if (t[key] === undefined || t[key] === null) continue;
        if (typeof t[key] !== 'string' || !t[key].trim() || t[key].length > max) {
          bad(`преподаватель ${t.id}: поле ${key} — не строка до ${max} символов`);
        }
      }
      if (!looksOk(t.looks)) bad(`преподаватель ${t.id}: описание внешности — не строка до потолка`);
    }
  }

  if (!state.schedule || typeof state.schedule !== 'object') {
    bad('нет расписания');
  } else {
    for (const [dow, list] of Object.entries(state.schedule)) {
      if (!/^[1-7]$/.test(dow)) bad(`расписание: день недели «${dow}» вне 1–7`);
      if (!Array.isArray(list)) {
        bad(`расписание: день ${dow} не массив`);
        continue;
      }
      for (const id of list) {
        if (id !== null && !subjectList.some((s) => s.id === id)) {
          bad(`расписание: день ${dow} ссылается на неизвестный предмет ${id}`);
        }
      }
    }
  }

  if (!state.attendance || !Array.isArray(state.attendance.records)) bad('нет посещаемости');
  if (!state.reputation || typeof state.reputation.value !== 'number') bad('нет репутации');
  if (!state.exams || !Array.isArray(state.exams.items)) {
    bad('нет сессии');
  } else if (state.exams.term !== null && state.exams.term !== undefined
      && !Number.isFinite(state.exams.term)) {
    // Номер периода — либо число, либо «сессии ещё не было». Строка «0» отсюда
    // уехала бы в id события и разошлась бы с тем, что пишет `scheduleExams`.
    bad(`сессия: номер периода «${state.exams.term}» не число`);
  } else {
    // История бросков необязательна, но если есть — это список: вехи
    // (`milestones.mjs`) и отладка ходят по ней как по массиву.
    for (const item of state.exams.items) {
      if (item && item.rolls !== undefined && !Array.isArray(item.rolls)) {
        bad(`сессия: история бросков события ${item.id} не список`);
      }
      // Дата объявления итога (9.4.3) — день календаря: её сравнивают с
      // `calendar.day`, и строка другой формы не объявила бы итог никогда.
      if (item && item.announced === false && !isDay(item.announceOn)) {
        bad(`сессия: итог события ${item.id} ждёт объявления без даты`);
      }
    }
  }
  if (!Array.isArray(state.journal)) bad('нет журнала');
  if (!Array.isArray(state.pending)) bad('нет очереди одноразовых инжектов');

  // Свои события чата (`core/holidays.mjs`) и память о прозвучавших поводах
  // необязательны: у старого состояния их нет. Но если есть — форма строгая,
  // панель и промпт печатают их как есть.
  if (state.events !== undefined) {
    if (!Array.isArray(state.events)) bad('свои события — не список');
    else {
      for (const e of state.events) {
        if (!e || typeof e !== 'object' || typeof e.name !== 'string' || !e.name.trim()) bad('своё событие без названия');
        else if (!isDay(e.from)) bad(`событие «${e.name}»: день «${e.from}» не в форме ГГГГ-ММ-ДД`);
        else if (e.to !== undefined && e.to !== null && (!isDay(e.to) || e.to < e.from)) bad(`событие «${e.name}»: конец раньше начала`);
        else if (e.off !== undefined && typeof e.off !== 'boolean') bad(`событие «${e.name}»: «занятий нет» — не да/нет`);
        else if (e.open !== undefined && typeof e.open !== 'boolean') bad(`событие «${e.name}»: «до отмены» — не да/нет`);
        else if (e.pause !== undefined && typeof e.pause !== 'boolean') bad(`событие «${e.name}»: «приостановка» — не да/нет`);
      }
    }
  }
  if (state.holidayHooks !== undefined && !Array.isArray(state.holidayHooks)) bad('поводы праздников — не список');

  // Курс (`core/classmates.mjs`): форма, потолки, id не совпадает с
  // преподавательским — у метки `rel=` одно пространство id на всех людей.
  for (const m of classmateErrors(state)) bad(m);

  return { ok: errors.length === 0, errors };
}

/**
 * Приведение состояния прошлых версий к текущей: шаги по возрастанию версии, а
 * следом — добивка недостающих полей. Чужое состояние могло уехать в метаданные
 * из версии, где поля ещё не было, и падать на этом нельзя.
 *
 * @param {*} state
 * @param {Object} preset
 * @returns {State}
 */
export function migrate(state, preset) {
  if (!state || typeof state !== 'object') return createState(preset);
  let out = { ...state };

  if (numberOr(out.schemaVersion, 0) < 2) out = examTermsV2(out);

  out.schemaVersion = SCHEMA_VERSION;
  out.presetId = out.presetId || preset.id;
  out.lang = out.lang || preset.lang || 'ru';
  out.started = Boolean(out.started);
  out.survey = { ...emptySurvey(), ...(out.survey || {}) };
  out.calendar = { ...createState(preset).calendar, ...(out.calendar || {}) };
  out.subjects = Array.isArray(out.subjects) ? out.subjects.map(normalizeSubject) : [];
  out.teachers = Array.isArray(out.teachers) ? out.teachers.map((t) => normalizeTeacher(t, preset)) : [];
  out.schedule = out.schedule && typeof out.schedule === 'object' ? out.schedule : {};
  out.attendance = { records: Array.isArray(out.attendance && out.attendance.records) ? out.attendance.records : [] };
  out.reputation = {
    value: numberOr(out.reputation && out.reputation.value, numberOr(preset.reputation && preset.reputation.start, 50)),
    warned: Boolean(out.reputation && out.reputation.warned),
    expelled: Boolean(out.reputation && out.reputation.expelled),
  };
  out.exams = {
    active: Boolean(out.exams && out.exams.active),
    // Номер периода — не число только у семестра, в котором сессии ещё не было.
    term: Number.isFinite(out.exams && out.exams.term) ? out.exams.term : null,
    items: Array.isArray(out.exams && out.exams.items) ? out.exams.items : [],
  };
  out.journal = Array.isArray(out.journal) ? out.journal : [];
  out.pending = Array.isArray(out.pending) ? out.pending : [];
  // Схема 3: курса у старого семестра нет — пустые списки, и это не догадка:
  // однокурсников до этой схемы расширение не знало вовсе. Своего шага
  // подъёма не нужно — добивка ниже его и делает, и чинит битые записи.
  out.classmates = normalizeClassmates(out.classmates, preset, { taken: out.teachers.map((t) => t.id) });
  out.classmateCandidates = normalizeCandidates(out.classmateCandidates, preset);
  return out;
}

/**
 * Схема 1 → 2: сессия привязывается к учебному периоду.
 *
 * В первой схеме период был ровно один — календарь другого и не умел, — поэтому
 * всё, что уже лежит в состоянии, честно относится к нулевому: это не догадка, а
 * единственное, чем оно могло быть. Отсюда `term: 0` у событий и у самой сессии.
 *
 * **Id события переписывается, и вместе с ним — все ссылки на него.** Новый id
 * (`период:предмет:вид`) обязателен: `applyOutcome` ищет событие по id, и без
 * номера события второго триместра были бы неотличимы от событий первого.
 * Но на id ссылаются журнал (`data.examId`, по нему `lorebook` находит предмет
 * записи) и очередь одноразовых инжектов (`exam:<id>:<попытка>`), поэтому здесь
 * переписываются и они: миграция, теряющая летопись первого семестра, — это
 * ровно та потеря чужого семестра, против которой написан пункт 3.8 плана.
 *
 * Зачётки правка не касается вовсе: оценки лежат в `subject.grades` и на id
 * события не ссылаются. Это и есть причина, по которой подъём безопасен.
 */
function examTermsV2(state) {
  const out = { ...state };
  const exams = out.exams && typeof out.exams === 'object' ? out.exams : {};
  const items = Array.isArray(exams.items) ? exams.items : [];

  const renamed = new Map();
  const migrated = items.map((raw) => {
    const item = { ...raw };
    if (Number.isFinite(item.term)) return item;
    item.term = 0;
    const old = String(item.id == null ? '' : item.id);
    if (old) {
      item.id = `0:${old}`;
      renamed.set(old, item.id);
    }
    return item;
  });

  out.exams = {
    ...exams,
    items: migrated,
    // Пустая сессия остаётся без номера: приписать ей нулевой период значило бы
    // сказать, что первая сессия уже была, и запереть вход в неё.
    term: Number.isFinite(exams.term) ? exams.term : (migrated.length ? 0 : null),
  };

  out.journal = (Array.isArray(out.journal) ? out.journal : []).map((entry) => {
    const id = entry && entry.data ? entry.data.examId : null;
    if (id == null || !renamed.has(String(id))) return entry;
    return { ...entry, data: { ...entry.data, examId: renamed.get(String(id)) } };
  });

  out.pending = (Array.isArray(out.pending) ? out.pending : []).map((inject) => {
    const m = /^exam:(.+):(\d+)$/.exec(String((inject && inject.id) || ''));
    if (!m || !renamed.has(m[1])) return inject;
    return { ...inject, id: `exam:${renamed.get(m[1])}:${m[2]}` };
  });

  out.schemaVersion = 2;
  return out;
}

// --- мелочи, нужные всем модулям -------------------------------------------

/**
 * Копия состояния без общих ссылок. Ядро чистое: функции возвращают новое
 * состояние, а не правят чужое.
 */
export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export const findSubject = (state, id) => (state.subjects || []).find((s) => s.id === id) || null;
export const findTeacher = (state, id) => (state.teachers || []).find((t) => t.id === id) || null;

/** Преподаватель предмета, если он назначен. */
export function teacherOfSubject(state, subjectId) {
  const s = findSubject(state, subjectId);
  return s && s.teacherId ? findTeacher(state, s.teacherId) : null;
}

/**
 * Дописать строчку в журнал отладки. Журнал кольцевой: без потолка он за семестр
 * раздувает метаданные чата.
 */
export function pushJournal(state, entry, preset) {
  const cap = (preset && preset.limits && preset.limits.journalSize) || 200;
  state.journal.push({ day: (state.calendar && state.calendar.day) || '', ...entry });
  if (state.journal.length > cap) state.journal.splice(0, state.journal.length - cap);
  return state;
}

/** Поставить одноразовый инжект в очередь (3.5). Повтор с тем же id не дублируется. */
export function pushPending(state, inject) {
  if (!state.pending.some((p) => p.id === inject.id)) state.pending.push(inject);
  return state;
}

/** Забрать и очистить очередь одноразовых инжектов. */
export function takePending(state) {
  const out = state.pending;
  state.pending = [];
  return out;
}

/** Ярлык словом по числу: таблицы `labels` пресета отсортированы по `upTo` вверх. */
export function labelFor(labels, value) {
  if (!Array.isArray(labels) || !labels.length) return '';
  for (const l of labels) if (value <= l.upTo) return l.label;
  return labels[labels.length - 1].label;
}

/**
 * Склейка готовых кусков в предложения: «Идёт круг» + «состояние собрано с
 * пресетом…» → «Идёт круг. Состояние собрано с пресетом…».
 *
 * Заведена не ради красоты. Куски приходят из разных мест — слово периода из
 * `preset.vocab`, объяснение из `storage.js`, приглашение подтвердить из
 * вызывающего, — и каждый из них написан как **фрагмент списка**, то есть со
 * строчной буквы: в перечислении «Загрузка перезапишет: …; …» это правильно.
 * Стоило тому же фрагменту встать после точки, и получалось «Идёт круг.
 * состояние собрано…». Склеек таких несколько, и чинить их поштучно значит
 * ждать, пока появится следующая.
 *
 * Заглавная ставится **со второго куска**: первый начинает строку, и его
 * регистр принадлежит тому, кто его дал (это может быть слово пресета, нарочно
 * строчное), а вот всё, что мы сами ставим после точки, — уже наша забота.
 * Кусок, который уже кончается знаком конца фразы, второй точкой не обрастает.
 * Пустые и повторы выброшены: повтор здесь означал бы «Идёт круг. Идёт круг.».
 */
export function joinSentences(parts) {
  const seen = [];
  for (const p of (parts || [])) {
    const s = String(p == null ? '' : p).trim();
    if (s && !seen.includes(s)) seen.push(s);
  }
  return seen
    .map((s, i) => (i === 0 ? s : s.charAt(0).toLocaleUpperCase('ru') + s.slice(1)))
    .map((s) => (/[.!?…:]$/.test(s) ? s : `${s}.`))
    .join(' ');
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const isTime = (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);

function numberOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

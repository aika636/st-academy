// ui/settings.js — вкладка «Настройки»: что показать (`settingsView`, анкета,
// таблица предметов и её проверка `validateSubjectRows`) и сама вкладка.
// Блоки, которые живут ещё и в меню расширений, — в `ui/settings-blocks.js`.

import { emptySurvey, PLACE_MAX } from '../core/state.mjs';
import { examRule } from '../core/exams.mjs';
import { slugify } from '../core/plan-gen.mjs';
// Единственный импорт мимо `core/`: чистое правило «куда уйдёт запрос». Панель
// обязана показывать ровно ту развилку, по которой потом пойдёт `api.js`, —
// вторая копия этого правила рано или поздно разъехалась бы с первой. Ни одного
// похода в сеть этот импорт с собой не приносит.
import { resolveSource } from '../api.js';
import {
  uiLabels, fill, PRESET_TEXT, str, extraLabels, mounted, el, clear, runAction, setStatus, field,
  section, setSectionScope, call, safe, renderPanel,
} from './common.js';
import {
  renderApiBlock, renderAnalysisBlock, renderModeBlock, renderPresetBlock, renderLorebookBlock,
  renderTransferBlock, renderSoundBlock, renderFeedBlock, renderDrawBlock, renderDebugBlock,
} from './settings-blocks.js';

/** Шесть полей анкеты (3.6). Порядок — как в таблице плана. */
export const SURVEY_FIELDS = [
  { key: 'era', label: 'Эпоха / сеттинг', hint: 'современность, фэнтези, киберпанк, 1980-е' },
  { key: 'country', label: 'Страна / традиция', hint: 'Россия, Япония, Британия, выдуманная' },
  { key: 'institution', label: 'Тип заведения', hint: 'школа, колледж, вуз, магическая академия' },
  { key: 'faculty', label: 'Направление / факультет', hint: 'медицинский, филфак, боевая магия' },
  { key: 'year', label: 'Курс / год', hint: '2-й' },
  { key: 'lang', label: 'Язык названий и имён', hint: 'русский' },
];

/** Три положения источника времени (3.2). */
export const TIME_MODES = [
  { id: 'auto', label: 'Авто', hint: 'сначала контекст, при неудаче — метка' },
  { id: 'context', label: 'Из контекста', hint: 'время уже печатается в постах, инжекта нет' },
  { id: 'marker', label: 'Своя метка', hint: 'чистые посты, всё идёт служебным блоком' },
];

/** Кто решает исход контрольного в этом чате (`exams.examRule`). */
export const EXAM_RULE_VIEW = [
  { id: 'story', label: 'Сюжет', hint: 'исход тот, что случился в сцене; не сыгранное к концу сессии — хвост' },
  { id: 'dice', label: 'Кубик', hint: 'бросок против сложности, если сцена исход не назвала' },
];

/**
 * Строки редактируемой таблицы из состояния (3.6). Таблица доступна всегда, а
 * не только при сбое генерации, поэтому источник строк один — состояние, а не
 * ответ модели.
 */
export function rowsFromState(state) {
  return {
    subjects: ((state && state.subjects) || []).map((s) => ({
      id: s.id, name: s.name, teacherId: s.teacherId || '',
      building: s.building || '', room: s.room || '',
    })),
    teachers: ((state && state.teachers) || []).map((t) => ({
      id: t.id, name: t.name, traits: (t.traits || []).join(', '),
    })),
  };
}

/**
 * Проверка руками правленной таблицы предметов и преподавателей.
 *
 * Отличие от `validatePlan` в `core/plan-gen.mjs` намеренное: там проверяется
 * ответ модели и претензии кодируются машинно (`subject-no-teacher:chemistry`),
 * здесь текст читает человек, который прямо сейчас держит палец на поле. Плюс
 * отсутствие черт характера тут — замечание, а не брак: вписать свой предмет и
 * дописать характер позже — законный сценарий.
 *
 * @returns {{ok: boolean, errors: Array<{scope: 'subject'|'teacher'|'form',
 *   index: number, field: string, text: string}>, notes: string[],
 *   subjects: Array, teachers: Array}}
 */
export function validateSubjectRows(rows, preset) {
  const limits = (preset && preset.limits) || {};
  const U = uiLabels(preset);
  const maxSubjects = limits.maxSubjects || 8;
  const maxTeachers = limits.maxTeachers || 8;
  const maxId = limits.maxIdLength || 24;

  const errors = [];
  const notes = [];
  const bad = (scope, index, field, text) => errors.push({ scope, index, field, text });

  const inSubjects = Array.isArray(rows && rows.subjects) ? rows.subjects : [];
  const inTeachers = Array.isArray(rows && rows.teachers) ? rows.teachers : [];

  const teachers = [];
  const teacherIds = new Set();
  inTeachers.forEach((raw, i) => {
    const name = str(raw && raw.name);
    if (!name) { bad('teacher', i, 'name', U.errTeacherName); return; }
    const id = (str(raw && raw.id) || slugify(name, { maxLength: maxId })).slice(0, maxId);
    if (teacherIds.has(id)) { bad('teacher', i, 'id', fill(U.errTeacherDup, { id })); return; }
    teacherIds.add(id);
    const traits = String((raw && raw.traits) || '').split(',').map((t) => t.trim()).filter(Boolean);
    if (!traits.length) notes.push(fill(U.noteNoTraits, { name }));
    teachers.push({ id, name, traits });
  });
  if (teachers.length > maxTeachers) {
    bad('form', -1, 'teachers', fill(U.errManyTeachers, { count: teachers.length, max: maxTeachers }));
  }

  const subjects = [];
  const subjectIds = new Set();
  inSubjects.forEach((raw, i) => {
    const name = str(raw && raw.name);
    if (!name) { bad('subject', i, 'name', U.errSubjectName); return; }
    const id = (str(raw && raw.id) || slugify(name, { maxLength: maxId })).slice(0, maxId);
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
      bad('subject', i, 'id', fill(U.errSubjectId, { id }));
      return;
    }
    if (subjectIds.has(id)) { bad('subject', i, 'id', fill(U.errSubjectDup, { id })); return; }
    subjectIds.add(id);

    let teacherId = str(raw && raw.teacherId);
    if (teacherId && !teacherIds.has(teacherId)) {
      bad('subject', i, 'teacherId', fill(U.errSubjectTeacher, { name, teacherId }));
      teacherId = '';
    }
    if (!teacherId) notes.push(fill(U.noteNoTeacher, { name }));
    // Корпус и аудитория необязательны (9.7A п.11). Ключи есть всегда, пустая
    // строка — «стёрто»: `index.js: setSubjects` сливает строку таблицы с
    // предметом из состояния, и без ключа стёртый корпус вернулся бы из
    // старого. В состояние пустые не попадут — их выбросит `normalizeSubject`.
    // Длинные режутся тем же потолком, что держит `validateState`.
    const place = {};
    for (const key of ['building', 'room']) {
      place[key] = str(raw && raw[key]).replace(/\s+/g, ' ').slice(0, PLACE_MAX);
    }
    subjects.push({ id, name, teacherId: teacherId || null, ...place });
  });
  if (subjects.length > maxSubjects) {
    bad('form', -1, 'subjects', fill(U.errManySubjects, { count: subjects.length, max: maxSubjects }));
  }
  if (!subjects.length) {
    bad('form', -1, 'subjects', U.errNoSubjects);
  }

  return { ok: errors.length === 0, errors, notes, subjects, teachers };
}

/** Анкета из состояния или из настроек-черновика. Всегда шесть полей. */
export function surveyOf(state, settings) {
  const draft = (settings && settings.ui && settings.ui.surveyDraft) || null;
  return { ...emptySurvey(), ...(draft || {}), ...((state && state.survey) || {}) };
}

/**
 * Вкладка «Настройки» (3.6, 3.2, 3.7, 3.8). Возвращает всё, что нужно
 * отрисовать, и — отдельно — почему кнопка «начать семестр» недоступна: пустая
 * недоступная кнопка без объяснения хуже, чем её отсутствие.
 *
 * Четвёртый аргумент — то, чего в состоянии и настройках нет: отчёт лорбука и
 * список пресетов. Оба приходят от `index.js` (`host.getLorebook()`,
 * `host.getPresets()`), потому что первый лежит в World Info, а второй — в
 * папке расширения, и панель ни того ни другого не знает. Вызов без него
 * обязан вести себя как «лорбука нет, пресет один» — так зовут `settingsView`
 * старые тесты и `commands.js`.
 */
/**
 * Графа «откуда генерировать». До неё выбор был невидимым: пустые поля молча
 * значили «через подключение таверны». Теперь источник назван вслух, а
 * `routed` — то, куда запрос уйдёт на самом деле, посчитанное тем же правилом,
 * что и в `api.js`.
 */
function apiView(raw, connections) {
  const api = raw || {};
  const source = ['auto', 'tavern', 'own'].includes(String(api.source)) ? String(api.source) : 'auto';
  const c = connections || {};
  const profiles = Array.isArray(c.profiles)
    ? c.profiles.filter((p) => p && p.id).map((p) => ({
      id: String(p.id), name: String(p.name || p.id), model: String(p.model || ''),
    }))
    : [];
  const profile = String(api.profile || '');
  return {
    endpoint: String(api.endpoint || ''),
    key: String(api.key || ''),
    model: String(api.model || ''),
    source,
    // Куда уйдёт запрос прямо сейчас: 'tavern' или 'endpoint'.
    routed: resolveSource({ ...api, source }),
    profile,
    profiles,
    // Профиль мог быть удалён или переименован в самой таверне — молчать об
    // этом нельзя: генерация уедет не туда, куда человек выбирал.
    profileMissing: Boolean(profile) && profiles.length > 0 && !profiles.some((p) => p.id === profile),
    connectionAvailable: c.available !== false,
    // Старое поле: «полей нет, пойдём через таверну». Оставлено, чтобы вью
    // читался и теми, кто про новую графу ещё не знает.
    fallback: !String(api.endpoint || '').trim(),
  };
}

export function settingsView(state, settings, preset, extra = {}) {
  const s = settings || {};
  const api = s.api || {};
  const rows = rowsFromState(state);
  const check = validateSubjectRows(rows, preset);
  const started = Boolean(state && state.started);

  const U = uiLabels(preset);
  const blockers = [];
  if (!rows.subjects.length) blockers.push(U.blockNoSubjects);
  if (!check.ok) blockers.push(U.blockBadTable);
  if (started) blockers.push(U.blockStarted);

  return {
    survey: SURVEY_FIELDS.map((f) => ({ ...f, value: String(surveyOf(state, settings)[f.key] || '') })),
    subjects: rows.subjects,
    teachers: rows.teachers,
    validation: check,
    api: apiView(api, extra.connections),
    mode: TIME_MODES.some((m) => m.id === s.mode) ? s.mode : 'auto',
    modes: TIME_MODES.map((m) => ({ ...m, active: m.id === (s.mode || 'auto') })),
    // Секретарь (`core/analysis`) — настройка общая; правило экзаменов — своё
    // у каждого чата и есть только у заведённого семестра.
    examRules: state ? EXAM_RULE_VIEW.map((r) => ({ ...r, active: r.id === examRule(state) })) : [],
    // В режиме «из контекста» инжект инструкции не имеет смысла (3.2).
    injectMarker: s.mode === 'context' ? false : s.injectMarker !== false,
    injectMarkerLocked: s.mode === 'context',
    // Предупреждать есть смысл только там, где метка вообще идёт в промпт:
    // в режиме «из контекста» её нет, и видеть в тексте нечего.
    markerRisk: Boolean(extra.markerRisk) && s.mode !== 'context',
    relativeWords: Boolean(s.relativeWords),
    // Строка состояния через макрос `{{academy}}` (9.3.1): автоинжект гаснет.
    statusViaMacro: s.statusViaMacro === true,
    debug: s.debug === true,
    started,
    canStart: blockers.length === 0,
    startBlockers: blockers,
    lorebook: lorebookView(extra.lorebook, s, U),
    presets: presetsView(extra.presets, state, preset, U),
    // Слова настроек едут вместе с видом: отрисовке пресет второй раз не нужен.
    labels: U,
  };
}

/**
 * Лорбук на экране (3.7). Главное здесь — последняя ветка: **пустого экрана не
 * бывает**. Лорбука может не быть по четырём разным причинам, и каждая
 * называется вслух, потому что «галочка стоит, а записей нет» без объяснения —
 * это молчаливая поломка, в которой человеку некуда пойти.
 *
 * Осиротевшие показываются только вместе с кнопкой уборки: список того, что
 * «лишнее в вашем World Info», без единого способа это убрать, пугает и ничего
 * не даёт.
 */
function lorebookView(raw, settings, U) {
  const l = raw || {};
  // Галочка — из самих настроек, отчёт лорбука — только про то, что вышло.
  // Отчёт обновляется после похода в World Info, и пока он не пришёл, строка
  // «Лорбук выключен.» висела под только что поставленной галочкой.
  const own = settings && settings.lorebook && typeof settings.lorebook.enabled === 'boolean' ? settings.lorebook.enabled : null;
  const enabled = own === null ? l.enabled === true : own;
  const measure = l.measure && typeof l.measure === 'object' ? l.measure : null;
  const explain = (() => {
    if (!enabled) return '';
    if (l.error) return fill(U.lorebookError, { error: String(l.error) });
    if (l.reason === 'no-world-info') return U.lorebookNoWorldInfo;
    if (l.reason === 'no-chat') return U.lorebookNoChat;
    if (l.reason === 'no-state' || l.reason === 'off') return U.lorebookNoState;
    if (l.reason) return fill(U.lorebookError, { error: String(l.reason) });
    return '';
  })();

  return {
    enabled,
    book: String((settings.lorebook && settings.lorebook.book) || ''),
    name: String(l.name || ''),
    // Строка привязки: имя лорбука и то, что он именно этого чата, — 3.7 требует
    // сказать это рядом с галочкой, иначе человек не поймёт, куда пошли записи.
    boundLine: l.name ? fill(U.lorebookBound, { name: String(l.name) }) : (enabled && !explain ? U.lorebookNoName : ''),
    explain,
    measure,
    // «Примерно»: замер считает символы делением на среднюю длину токена, а не
    // токенизатором таверны, и выдавать прикидку за точное число нельзя.
    //
    // `cap` — потолок **числа записей** (`core/lorebook.mjs: entryCap`, параметр
    // пресета `maxLorebookEntries`), а не токенов. Стоять он обязан рядом с
    // `entries`: пока фраза читалась «примерно 479 токенов из 50», человек видел
    // превышение впятеро там, где записей было 8 из 50.
    measureLine: measure
      ? fill(U.lorebookMeasure, {
        entries: Number(measure.entries) || 0,
        tokens: Number(measure.tokens) || 0,
        cap: Number(measure.cap) || 0,
      })
      : '',
    overCap: Boolean(measure && measure.withinCap === false),
    overCapLine: measure && measure.withinCap === false ? U.lorebookOverCap : '',
    // Имя предложения — первый ключ записи: именно по нему она сработает в
    // сцене, и показывать вместо него служебный `uid` значило бы показать не то,
    // что человек согласовывает.
    suggest: (Array.isArray(l.suggest) ? l.suggest : []).map((e) => ({
      uid: String((e && e.uid) || ''),
      name: String((e && Array.isArray(e.keys) && e.keys[0]) || (e && e.uid) || ''),
      text: String((e && e.content) || ''),
    })),
    orphans: (Array.isArray(l.orphans) ? l.orphans : []).map((o) => ({
      uid: String((o && o.uid) || o || ''),
    })),
  };
}

/**
 * Выбор пресета. `drift` — то, о чём панель обязана сказать вслух: чат заведён
 * одним пресетом, а активен другой. Молча это не расходится ни в одной
 * проверке — `validateState` про `presetId` знает только то, что он непустой, —
 * а на экране от этого перестаёт считаться средний балл.
 */
function presetsView(raw, state, preset, U) {
  const activeId = String((preset && preset.id) || (raw && raw.active) || '');
  const hasList = Boolean(raw && Array.isArray(raw.list) && raw.list.length);
  const list = hasList
    ? raw.list
    : (activeId ? [{ id: activeId, name: String(preset.displayName || preset.name || activeId) }] : []);
  const stateId = String((state && state.presetId) || '');
  const activeItem = list.find((p) => String(p.id) === activeId);
  const activeName = activeItem ? String(activeItem.name || activeId) : activeId;
  return {
    active: activeId,
    activeUser: Boolean(activeItem && activeItem.user === true),
    list: list.map((p) => ({
      id: String(p.id),
      name: String(p.name || p.id),
      broken: p.broken === true,
      active: String(p.id) === activeId,
      // Свой пресет человека (9.3.2): его можно удалить, встроенный — нет.
      user: p.user === true,
    })),
    started: Boolean(state && state.started),
    drift: stateId && activeId && stateId !== activeId
      ? fill(U.presetDrift, { stateId, activeId })
      : '',
    // Чат заведён пресетом, которого нет в списке вовсе (удалён). Судится
    // только по настоящему списку хоста: запасной список из одного активного
    // пресета объявил бы пропавшими все остальные.
    gone: hasList && stateId && stateId !== activeId && !list.some((p) => String(p.id) === stateId)
      ? fill(PRESET_TEXT.stateGone, { id: stateId, active: activeName })
      : '',
    notice: String((raw && raw.notice) || ''),
  };
}

// --- вкладка «Настройки» ----------------------------------------------------

export function renderSettings(host) {
  setSectionScope('panel');
  const state = safe(() => host.getState(), null);
  const preset = safe(() => host.getPreset(), {}) || {};
  const settings = safe(() => host.getSettings(), {}) || {};
  const view = settingsView(state, settings, preset, hostExtra(host));
  const U = view.labels;
  // Пока семестр не начат, раскрыты блоки пути «завести семестр с нуля»
  // (см. комментарий у `section`); после старта — ни одного.
  const setup = !view.started;

  const box = el('div', { class: 'academy-settings' });

  // --- анкета -------------------------------------------------------------
  const inputs = {};
  const surveyBox = el('div', { class: 'academy-survey' }, view.survey.map((f) => {
    const input = el('input', { type: 'text', class: 'text_pole academy-input', value: f.value, placeholder: f.hint });
    input.addEventListener('change', () => saveDraft(host, collect(inputs)));
    inputs[f.key] = input;
    return el('label', { class: 'academy-field' }, [el('span', { text: f.label }), input]);
  }));

  // Автозаполнение анкеты (3.6): кнопка НЕОБЯЗАТЕЛЬНАЯ и ничего не сохраняет.
  // Результат кладётся прямо в поля выше — человек смотрит и правит, — и уходит
  // в черновик анкеты тем же путём, что и всё, набранное руками.
  const guessStatus = el('div', { class: 'academy-status' });
  const guessBtn = el('div', {
    class: 'menu_button academy-btn academy-btn-small',
    text: U.surveyGuess,
    onclick: async (e) => {
      const res = await runAction(e.currentTarget, guessStatus,
        () => call(host, 'guessSurvey'), U.surveyGuessOk);
      if (!res || res.ok === false || !res.survey) return;
      for (const [key, node] of Object.entries(inputs)) {
        const value = str(res.survey[key]);
        // Пустое предположение не стирает набранное руками: человек мог
        // заполнить поле сам, а модель про него промолчать.
        if (value) node.value = value;
      }
      await saveDraft(host, collect(inputs));
      const filled = (res.filled || []).length;
      setStatus(guessStatus, filled ? 'ok' : 'error',
        filled ? fill(U.surveyGuessPartly, { count: filled }) : U.surveyGuessEmpty);
    },
  });

  const planStatus = el('div', { class: 'academy-status' });
  const genBtn = el('div', {
    class: 'menu_button academy-btn academy-btn-main',
    text: U.planGenerate,
    onclick: async (e) => {
      const survey = collect(inputs);
      await saveDraft(host, survey);
      const res = await runAction(e.currentTarget, planStatus,
        () => call(host, 'generatePlan', survey), U.planGenerateOk);
      // При сбое таблица не прячется: она та же самая, только пустая, и текст
      // ошибки стоит рядом с ней (3.6).
      renderPanel(host);
      if (res && res.ok === false) setStatus(lastPlanStatus(), 'error', String(res.error || 'Генерация не удалась.'));
      // План лёг, но в нём есть имя из стоп-листа (героиня, карточка,
      // заведение, 9.3.6): выбросить его нельзя — на него ссылаются предметы, —
      // поэтому человеку говорится, кого переименовать в таблице.
      else if (res && res.ok && Array.isArray(res.warnings) && res.warnings.length) {
        setStatus(lastPlanStatus(), 'error', res.warnings.join(' '));
      }
    },
  });

  box.append(section(U.surveySection, [
    el('p', { class: 'academy-note', text: U.surveyNote }),
    surveyBox,
    el('div', { class: 'academy-row academy-row-buttons' }, [guessBtn]),
    el('p', { class: 'academy-note', text: U.surveyGuessNote }),
    guessStatus,
    el('div', { class: 'academy-row academy-row-buttons' }, [genBtn]),
    planStatus,
  ], setup));
  mounted.planStatus = planStatus;

  // --- таблица предметов и преподавателей ---------------------------------
  box.append(renderPlanTable(host, view, preset, setup));

  // --- пресет заведения ---------------------------------------------------
  box.append(renderPresetBlock(host, view));

  // --- API ----------------------------------------------------------------
  box.append(renderApiBlock(host, view));

  // --- источник времени и галочки -----------------------------------------
  box.append(renderModeBlock(host, view));
  box.append(renderAnalysisBlock(host, view));

  // --- лорбук академии (3.7) ----------------------------------------------
  box.append(renderLorebookBlock(host, view));

  // --- выгрузка и загрузка состояния (3.8) --------------------------------
  box.append(renderTransferBlock(host, view));

  // --- вехи и звук (9.4.2) ------------------------------------------------
  box.append(renderSoundBlock(host, preset, settings));

  // --- поток курса: поводы в сюжет (шаг 4) --------------------------------
  box.append(renderFeedBlock(host, preset, settings));

  // --- портреты: «Нарисовать» через провайдеров таверны (аватарки, шаг 4) ---
  const drawBlock = renderDrawBlock(host, preset, settings);
  if (drawBlock) box.append(drawBlock);

  // --- отладка ------------------------------------------------------------
  box.append(renderDebugBlock(host, view));

  // --- начать семестр -----------------------------------------------------
  const startStatus = el('div', { class: 'academy-status' });
  // Год календаря — решение, а не умолчание: до этой правки его молча ставили
  // системные часы, и в чате, где время печатает кто-то другой, расширение
  // заводило семестр в чужом году (`voprosy-vladelitse.md`, пункт 6).
  const hint = safe(() => (host.getStartHint ? host.getStartHint() : null), null) || {};
  const startDay = el('input', {
    type: 'date',
    class: 'text_pole academy-input',
    value: hint.day || '',
  });
  // Атрибут задаёт начальное значение, свойство — то, что прочитает кнопка.
  // У `<input type="date">` они расходятся ровно в том случае, который здесь и
  // важен: поле не трогали руками, а дату из него всё равно надо отдать.
  startDay.value = hint.day || '';
  const startBtn = el('div', {
    class: 'menu_button academy-btn academy-btn-main',
    text: view.started ? U.startedButton : U.startButton,
    onclick: async (e) => {
      if (!view.canStart) return;
      await runAction(
        e.currentTarget, startStatus,
        () => call(host, 'startTerm', collect(inputs), { startDay: startDay.value }),
        U.startedOk,
      );
      mounted.tab = 'today';
      renderPanel(host);
    },
  });
  if (!view.canStart) startBtn.classList.add('academy-btn-off');

  box.append(section(U.startSection, [
    view.startBlockers.length
      ? el('p', { class: 'academy-note', text: `Пока нельзя: ${view.startBlockers.join('; ')}.` })
      : el('p', { class: 'academy-note', text: U.startNote }),
    view.started ? null : el('div', { class: 'academy-row' }, [
      el('label', { class: 'academy-field' }, [
        el('span', { text: U.startDayField }),
        startDay,
      ]),
    ]),
    view.started ? null : el('p', {
      class: 'academy-note',
      text: hint.from === 'chat'
        ? fill(U.startDayFromChat, { matched: String(hint.matched || '').trim() })
        : U.startDayFromPreset,
    }),
    el('div', { class: 'academy-row academy-row-buttons' }, [startBtn]),
    startStatus,
  ], setup));

  return box;
}

/**
 * То, чего нет ни в состоянии, ни в настройках: отчёт лорбука и список
 * пресетов. Оба вызова переживают отсутствие геттера — `index.js` и `ui.js`
 * писались порознь, и панель, падающая от недостающего геттера, — это ровно тот
 * шов, ради которого весь файл держится на `safe` и `call`.
 */
export function hostExtra(host) {
  return {
    lorebook: safe(() => (host.getLorebook ? host.getLorebook() : null), null),
    presets: safe(() => (host.getPresets ? host.getPresets() : null), null),
    // `encode_tags` таверны: при нём служебная метка перестаёт быть невидимой.
    // Хост это умеет посчитать (`index.js`, `markerVisibleRisk`), панель — нет.
    markerRisk: safe(() => (host.markerVisibleRisk ? host.markerVisibleRisk() : false), false),
    // Профили подключения таверны. Хост постарше их не отдаёт — тогда графа
    // «актуальный API» остаётся, но без списка профилей.
    connections: safe(() => (host.getConnections ? host.getConnections() : null), null),
  };
}

const lastPlanStatus = () => mounted.planStatus;

function renderPlanTable(host, view, preset, open = false) {
  const U = view.labels;
  const X = extraLabels(preset);
  const status = el('div', { class: 'academy-status' });
  // Рабочая копия: правки живут здесь до нажатия «сохранить», чтобы
  // недописанная строка не роняла состояние. Она переживает перерисовку
  // вкладки, пока списки в состоянии те же: правка анкеты выше сохраняет
  // черновик и перерисовывает панель, и добавленный, но ещё не сохранённый
  // наставник или предмет раньше молча пропадал (третий прогон 08.10).
  const base = JSON.stringify({ subjects: view.subjects, teachers: view.teachers });
  const kept = mounted.planDraft && mounted.planDraft.base === base ? mounted.planDraft.draft : null;
  const draft = kept || {
    subjects: view.subjects.map((s) => ({ ...s })),
    teachers: view.teachers.map((t) => ({ ...t })),
  };
  mounted.planDraft = { base, draft };

  const body = el('div', { class: 'academy-plan-table' });

  // Выпадашки живут дольше одной перерисовки строки: список наставников в них
  // обновляется на месте, как только человек дописал имя выше. Раньше опции
  // собирались один раз на `redraw()`, а `redraw()` случался только на
  // «добавить» и «удалить» — поэтому наставник, вписанный в верхний блок,
  // появлялся в нижнем лишь после «Сохранить таблицу», и порядок действий не
  // совпадал с порядком чтения формы.
  const selects = [];

  // Тот же id, что посчитает `validateSubjectRows` при сохранении, включая
  // обрезку по длине: разойдись они — и выпадашка предложила бы наставника,
  // которого проверка потом «не нашла».
  const maxId = ((preset && preset.limits) || {}).maxIdLength || 24;
  const teacherIdOf = (t) => (str(t.id) || slugify(t.name, { maxLength: maxId })).slice(0, maxId);

  const teacherOptions = (s) => [
    el('option', { value: '', text: U.teacherNone, selected: !s.teacherId }),
    ...draft.teachers
      .filter((t) => str(t.name))
      .map((t) => {
        const id = teacherIdOf(t);
        return el('option', { value: id, text: t.name, selected: s.teacherId === id });
      }),
  ];

  const teacherSelect = (s) => {
    const sel = el('select', {
      class: 'text_pole academy-input',
      onchange: (e) => { s.teacherId = e.currentTarget.value; },
    }, teacherOptions(s));
    selects.push({ sel, subject: s });
    return sel;
  };

  // Каким id строка наставников звалась на прошлой сборке списков. У строки без
  // явного `id` он считается от имени, то есть меняется на каждой правке имени;
  // без этого снимка выбранный наставник отваливался бы от дисциплины ровно
  // тогда, когда его имя дописывают. Строка та же — переносим выбор на её новый id.
  let lastIds = draft.teachers.map(teacherIdOf);

  /** Пересобрать списки во всех выпадашках, сохранив уже сделанный выбор. */
  const refreshTeacherOptions = () => {
    const ids = draft.teachers.map(teacherIdOf);
    const moved = new Map();
    lastIds.forEach((was, i) => { if (was && ids[i] && was !== ids[i]) moved.set(was, ids[i]); });
    const known = new Set(draft.teachers.filter((t) => str(t.name)).map(teacherIdOf));

    for (const { sel, subject } of selects) {
      if (subject.teacherId && moved.has(subject.teacherId)) subject.teacherId = moved.get(subject.teacherId);
      // Наставника удалили или стёрли ему имя: выбор честно сбрасывается в
      // «— не назначен —», а не остаётся ссылкой в пустоту.
      if (subject.teacherId && !known.has(subject.teacherId)) subject.teacherId = '';
      clear(sel);
      for (const opt of teacherOptions(subject)) sel.append(opt);
    }
    lastIds = ids;
  };

  const redraw = () => {
    clear(body);
    selects.length = 0;
    lastIds = draft.teachers.map(teacherIdOf);
    const check = validateSubjectRows(draft, preset);

    body.append(el('div', { class: 'academy-card-title', text: U.teachersTitle }));
    body.append(el('div', { class: 'academy-table academy-table-teachers' },
      draft.teachers.length
        ? draft.teachers.map((t, i) => el('div', { class: 'academy-tr' }, [
          field('Имя', t.name, (v) => { t.name = v; }, U.teacherNameHint, refreshTeacherOptions),
          field('Черты', t.traits, (v) => { t.traits = v; }, U.traitsHint),
          el('div', { class: 'academy-td academy-td-actions' }, [
            el('div', {
              class: 'menu_button academy-btn academy-btn-small',
              text: 'Удалить',
              onclick: () => { draft.teachers.splice(i, 1); redraw(); },
            }),
          ]),
        ]))
        : [el('div', { class: 'academy-silent', text: U.noTeachersRow })]));
    body.append(el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: U.addTeacher,
        onclick: () => { draft.teachers.push({ id: '', name: '', traits: '' }); redraw(); },
      }),
    ]));

    body.append(el('div', { class: 'academy-card-title', text: U.subjectsTitle }));
    body.append(el('div', { class: 'academy-table academy-table-subjects' },
      draft.subjects.length
        ? draft.subjects.map((s, i) => el('div', { class: 'academy-tr' }, [
          field('Название', s.name, (v) => { s.name = v; }, U.subjectNameHint),
          el('div', { class: 'academy-td' }, [
            el('label', { class: 'academy-field' }, [
              el('span', { text: U.teacherField }),
              teacherSelect(s),
            ]),
          ]),
          // Корпус и аудитория (9.7A п.11) — необязательные, одной ячейкой на
          // двоих: на телефоне таблица становится карточкой, и два коротких
          // поля рядом занимают одну строку, а не две.
          el('div', { class: 'academy-td academy-td-place' }, [
            field(X.buildingField, s.building, (v) => { s.building = v; }, X.buildingHint),
            field(X.roomField, s.room, (v) => { s.room = v; }, X.roomHint),
          ]),
          el('div', { class: 'academy-td academy-td-actions' }, [
            el('div', {
              class: 'menu_button academy-btn academy-btn-small',
              text: 'Удалить',
              onclick: () => { draft.subjects.splice(i, 1); redraw(); },
            }),
          ]),
        ]))
        : [el('div', { class: 'academy-silent', text: U.noSubjectsRow })]));
    body.append(el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: U.addSubject,
        onclick: () => { draft.subjects.push({ id: '', name: '', teacherId: '', building: '', room: '' }); redraw(); },
      }),
      el('div', {
        class: 'menu_button academy-btn',
        text: 'Сохранить таблицу',
        onclick: async (e) => {
          const res = validateSubjectRows(draft, preset);
          if (!res.ok) {
            setStatus(status, 'error', res.errors.map((x) => x.text).join(' '));
            return;
          }
          const saved = await runAction(e.currentTarget, status,
            () => call(host, 'setSubjects', { subjects: res.subjects, teachers: res.teachers }),
            'Таблица сохранена.');
          // Сохранено — рабочая копия своё отслужила: дальше таблица идёт от состояния.
          if (saved && saved.ok !== false) mounted.planDraft = null;
          renderPanel(host);
        },
      }),
    ]));

    if (check.errors.length) {
      body.append(el('ul', { class: 'academy-errors' },
        check.errors.map((x) => el('li', { text: x.text }))));
    }
    if (check.notes.length) {
      body.append(el('ul', { class: 'academy-notes' },
        check.notes.map((t) => el('li', { text: t }))));
    }
  };
  redraw();

  return section(U.planSection, [
    el('p', { class: 'academy-note', text: U.planNote }),
    body,
    status,
  ], open);
}

function collect(inputs) {
  const out = {};
  for (const [k, node] of Object.entries(inputs)) out[k] = node.value.trim();
  return out;
}

/** Черновик анкеты до старта семестра живёт в настройках, а не в состоянии. */
function saveDraft(host, survey) {
  try {
    const res = host.setSettings({ ui: { surveyDraft: survey } });
    return Promise.resolve(res);
  } catch (err) {
    return Promise.resolve({ ok: false, error: err });
  }
}

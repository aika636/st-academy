import { emptySurvey, PLACE_MAX, CANON_MAX, cleanProfile } from '../core/state.mjs';
import { examRule } from '../core/exams.mjs';
import { paceOf, PACES, PACE_WORDS } from '../core/relations.mjs';
import { bullyingView } from '../core/bullying.mjs';
import { pickStatusWords } from '../core/bully-pick.mjs';
import { slugify } from '../core/plan-gen.mjs';
import { plural } from '../core/plural.mjs';
import { statusView } from '../core/lore-status.mjs';
import { resolveSource } from '../api.js';
import {
  uiLabels, fill, PRESET_TEXT, str, extraLabels, mounted, el, clear, runAction, setStatus, field,
  section, setSectionScope, call, safe, renderPanel, memoDetails, svgIcon, sectionOpen,
} from './common.js';
import {
  renderApiBlock, renderAnalysisBlock, renderPaceBlock, renderBullyingBlock, renderModeBlock, renderPresetBlock, renderLorebookBlock,
  renderTransferBlock, renderSoundBlock, renderFeedBlock, renderDrawBlock, renderDebugBlock, renderCardCastBlock, renderLookBlock,
  LOOK_TEXT, lookSummary,
} from './settings-blocks.js';
import { renderCastParts } from './cast.js';

export const SURVEY_FIELDS = [
  { key: 'era', label: 'Эпоха / сеттинг', hint: 'современность, фэнтези, киберпанк, 1980-е' },
  { key: 'country', label: 'Страна / традиция', hint: 'Россия, Япония, Британия, выдуманная' },
  { key: 'institution', label: 'Тип заведения', hint: 'школа, колледж, вуз, магическая академия' },
  { key: 'faculty', label: 'Направление / факультет', hint: 'медицинский, филфак, боевая магия' },
  { key: 'year', label: 'Курс / год', hint: '2-й' },
  { key: 'canon', label: 'Фандом', hint: 'Гордость и предубеждение', help: 'Мир известного произведения, если играете по нему. Пусто — свой мир.', maxlength: CANON_MAX },
  { key: 'lang', label: 'Язык названий и имён', hint: 'русский' },
];

const LANG_WORDS = { ru: 'русский', en: 'английский', ja: 'японский', zh: 'китайский', de: 'немецкий', fr: 'французский', es: 'испанский' };
export const langWord = (code) => LANG_WORDS[String(code || '').trim().toLowerCase()] || String(code || '');

export const TIME_MODES = [
  { id: 'auto', label: 'Авто', hint: 'сначала контекст, при неудаче — метка' },
  { id: 'context', label: 'Из контекста', hint: 'время уже печатается в постах, инжекта нет' },
  { id: 'marker', label: 'Своя метка', hint: 'чистые посты, всё идёт служебным блоком' },
];

const PACE_HINTS = {
  slow: 'вверх — на шаг за раз и за день; вниз свободнее',
  normal: 'вверх — шаг за раз, два за день',
  fast: 'вверх — два шага за раз, три за день',
};

export const PROFILE_VIEW = [
  { id: '', label: 'обычный' },
  { id: 'strong', label: 'сильный' },
  { id: 'hard', label: 'трудный' },
];

export const EXAM_RULE_VIEW = [
  { id: 'story', label: 'Сюжет', hint: 'исход тот, что случился в сцене; не сыгранное к концу сессии — остаётся долгом' },
  { id: 'dice', label: 'Кубик', hint: 'бросок против сложности, если сцена исход не назвала' },
];

export function rowsFromState(state) {
  return {
    subjects: ((state && state.subjects) || []).map((s) => ({
      id: s.id, name: s.name, teacherId: s.teacherId || '',
      building: s.building || '', room: s.room || '', profile: s.profile || '',
    })),
    teachers: ((state && state.teachers) || []).map((t) => ({
      id: t.id, name: t.name, traits: (t.traits || []).join(', '),
      ...(t.canon === true ? { canon: true } : {}),
    })),
  };
}

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
    if (teacherIds.has(id)) { bad('teacher', i, 'id', fill(U.errTeacherDup, { name })); return; }
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
      bad('subject', i, 'id', fill(U.errSubjectId, { name }));
      return;
    }
    if (subjectIds.has(id)) { bad('subject', i, 'id', fill(U.errSubjectDup, { name })); return; }
    subjectIds.add(id);

    let teacherId = str(raw && raw.teacherId);
    if (teacherId && !teacherIds.has(teacherId)) {
      bad('subject', i, 'teacherId', fill(U.errSubjectTeacher, { name }));
      teacherId = '';
    }
    if (!teacherId) notes.push(fill(U.noteNoTeacher, { name }));
    const place = {};
    for (const key of ['building', 'room']) {
      place[key] = str(raw && raw[key]).replace(/\s+/g, ' ').slice(0, PLACE_MAX);
    }
    subjects.push({ id, name, teacherId: teacherId || null, ...place, profile: cleanProfile(raw && raw.profile) || '' });
  });
  if (subjects.length > maxSubjects) {
    bad('form', -1, 'subjects', fill(U.errManySubjects, { count: subjects.length, max: maxSubjects }));
  }
  if (!subjects.length) {
    bad('form', -1, 'subjects', U.errNoSubjects);
  }

  return { ok: errors.length === 0, errors, notes, subjects, teachers };
}

export function surveyOf(state, settings, chatId = '') {
  const raw = (settings && settings.ui && settings.ui.surveyDraft) || null;
  const mine = raw && typeof raw.chatId === 'string' && raw.chatId === String(chatId || '');
  const draft = {};
  if (mine) for (const key of [...Object.keys(emptySurvey()), 'gender']) if (typeof raw[key] === 'string') draft[key] = raw[key];
  const own = Object.fromEntries(Object.entries((state && state.survey) || {}).filter(([, v]) => v !== '' && v != null));
  return { ...emptySurvey(), ...draft, ...own };
}

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
    routed: resolveSource({ ...api, source }),
    profile,
    profiles,
    profileMissing: Boolean(profile) && profiles.length > 0 && !profiles.some((p) => p.id === profile),
    connectionAvailable: c.available !== false,
    fallback: !String(api.endpoint || '').trim(),
  };
}

export function canonWords(state, baseVocab) {
  const cv = state && state.canonVocab;
  if (!cv || !baseVocab || !state.survey || !state.survey.canon) return [];
  return Object.keys(cv)
    .filter((k) => !/Inject$/.test(k) && typeof baseVocab[k] === 'string' && baseVocab[k] !== cv[k])
    .map((k) => [baseVocab[k], cv[k]]);
}

export function settingsView(state, settings, preset, extra = {}) {
  const s = settings || {};
  const api = s.api || {};
  const rows = rowsFromState(state);
  const check = validateSubjectRows(rows, preset);
  const started = Boolean(state && state.started);

  const U = { ...extraLabels(preset), ...uiLabels(preset) };
  const blockers = [];
  if (!rows.subjects.length) blockers.push(U.blockNoSubjects);
  if (!check.ok) blockers.push(U.blockBadTable);
  if (started) blockers.push(U.blockStarted);

  return {
    survey: SURVEY_FIELDS.map((f) => {
      const raw = String(surveyOf(state, settings, extra.chatId)[f.key] || '');
      const cap = f.key.charAt(0).toUpperCase() + f.key.slice(1);
      return {
        ...f,
        label: U[`survey${cap}Label`] || f.label,
        hint: U[`survey${cap}Hint`] || f.hint,
        value: f.key === 'lang' ? langWord(raw) : raw,
      };
    }),
    subjects: rows.subjects,
    teachers: rows.teachers,
    canonWords: canonWords(state, extra.baseVocab),
    canonRefresh: Boolean(state && state.survey && String(state.survey.canon || '').trim()),
    validation: check,
    api: apiView(api, extra.connections),
    mode: TIME_MODES.some((m) => m.id === s.mode) ? s.mode : 'auto',
    modes: TIME_MODES.map((m) => ({ ...m, active: m.id === (s.mode || 'auto') })),
    secretaryAuto: s.secretaryAuto !== false,
    examRules: state
      ? EXAM_RULE_VIEW.map((r) => ({ ...r, hint: r.id === 'story' ? U.examRuleStoryHint : r.hint, active: r.id === examRule(state) }))
      : [],
    paces: state ? PACES.map((id) => ({ id, label: PACE_WORDS[id], hint: PACE_HINTS[id], active: id === paceOf(state) })) : [],
    bullying: state ? { ...bullyingView(state, preset), status: pickStatusWords(state) } : null,
    injectMarker: s.mode === 'context' ? false : s.injectMarker !== false,
    injectMarkerLocked: s.mode === 'context',
    markerRisk: Boolean(extra.markerRisk) && s.mode !== 'context',
    relativeWords: Boolean(s.relativeWords),
    statusViaMacro: s.statusViaMacro === true,
    debug: s.debug === true,
    started,
    canStart: blockers.length === 0,
    startBlockers: blockers,
    lorebook: lorebookView(extra.lorebook, s, U),
    presets: presetsView(extra.presets, state, preset, U),
    cardBooks: Array.isArray(extra.cardBooks) ? extra.cardBooks.map(str).filter(Boolean) : [],
    labels: U,
  };
}

function lorebookView(raw, settings, U) {
  const l = raw || {};
  const own = settings && settings.lorebook && typeof settings.lorebook.enabled === 'boolean' ? settings.lorebook.enabled : null;
  const enabled = own === null ? l.enabled === true : own;
  const measure = l.measure && typeof l.measure === 'object' ? l.measure : null;
  const explain = (() => {
    if (!enabled) return '';
    if (l.error && !(l.status && l.status.phase === 'error')) return fill(U.lorebookError, { error: String(l.error) });
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
    boundLine: l.name ? fill(U.lorebookBound, { name: String(l.name) }) : (enabled && !explain ? U.lorebookNoName : ''),
    explain,
    state: statusView(l.status, U, (at) => new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), Array.isArray(l.orphans) ? l.orphans : []),
    measure,
    measureLine: measure
      ? fill(U.lorebookMeasure, {
        entries: Number(measure.entries) || 0,
        tokens: Number(measure.tokens) || 0,
        cap: Number(measure.cap) || 0,
      })
      : '',
    overCap: Boolean(measure && measure.withinCap === false),
    overCapLine: measure && measure.withinCap === false ? U.lorebookOverCap : '',
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

function presetsView(raw, state, preset, U) {
  const activeId = String((preset && preset.id) || (raw && raw.active) || '');
  const hasList = Boolean(raw && Array.isArray(raw.list) && raw.list.length);
  const list = hasList
    ? raw.list
    : (activeId ? [{ id: activeId, name: String(preset.displayName || preset.name || activeId) }] : []);
  const stateId = String((state && state.presetId) || '');
  const activeItem = list.find((p) => String(p.id) === activeId);
  const activeName = activeItem ? String(activeItem.name || activeId) : activeId;
  const nameOf = (id) => {
    const hit = list.find((p) => String(p.id) === id);
    return hit ? String(hit.name || id) : id;
  };
  return {
    active: activeId,
    activeUser: Boolean(activeItem && activeItem.user === true),
    list: list.map((p) => ({
      id: String(p.id),
      name: String(p.name || p.id),
      broken: p.broken === true,
      active: String(p.id) === activeId,
      user: p.user === true,
    })),
    started: Boolean(state && state.started),
    viewing: Boolean(raw && raw.viewing),
    drift: stateId && activeId && stateId !== activeId
      ? fill(U.presetDrift, { stateId: nameOf(stateId), activeId: nameOf(activeId) })
      : '',
    gone: hasList && stateId && stateId !== activeId && !list.some((p) => String(p.id) === stateId)
      ? fill(PRESET_TEXT.stateGone, { id: stateId, active: activeName })
      : '',
    notice: String((raw && raw.notice) || ''),
  };
}

export function renderSettings(host) {
  setSectionScope('panel');
  const state = safe(() => host.getState(), null);
  const preset = safe(() => host.getPreset(), {}) || {};
  const settings = safe(() => host.getSettings(), {}) || {};
  const view = settingsView(state, settings, preset, hostExtra(host));
  const U = view.labels;
  const academy = [];
  const work = [];
  const look = [];
  const data = [];

  const inputs = {};
  const surveyBox = el('div', { class: 'academy-survey' }, view.survey.map((f) => {
    const input = el('textarea', { rows: '1', class: 'text_pole academy-input academy-input-wrap', placeholder: f.hint, ...(f.maxlength ? { maxlength: f.maxlength } : {}) });
    input.value = f.value;
    const fit = () => {
      if (!input.scrollHeight) return;
      input.style.height = 'auto';
      input.style.height = `${input.scrollHeight}px`;
    };
    input.addEventListener('input', fit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    setTimeout(fit, 0);
    input.addEventListener('change', () => saveDraft(host, collect(inputs)));
    inputs[f.key] = input;
    const field = el('label', { class: 'academy-field' }, [el('span', { text: f.label }), input, f.help ? el('span', { class: 'academy-note', text: f.help }) : null]);
    if (f.key !== 'canon' || !view.cardBooks.length) return field;
    return el('div', { class: 'academy-card-books' }, [
      field,
      el('span', { class: 'academy-note', text: extraLabels(preset).canonBooks }),
      el('div', { class: 'academy-row academy-row-buttons' }, view.cardBooks.map((name) => el('div', {
        class: 'menu_button academy-btn academy-btn-small', text: name, title: name,
        onclick: () => { input.value = name.slice(0, CANON_MAX); fit(); saveDraft(host, collect(inputs)); },
      }))),
    ]);
  }));

  const surveyNow = surveyOf(state, settings, safe(() => (host.getChatId ? String(host.getChatId() || '') : ''), ''));
  const genderNow = ['f', 'm'].includes(surveyNow.gender) ? surveyNow.gender : safe(() => host.getHeroGender(), 'f');
  const genderX = extraLabels(preset);
  const genderSelect = el('select', { class: 'text_pole academy-input' }, [
    el('option', { value: 'f', text: genderX.surveyGenderF }),
    el('option', { value: 'm', text: genderX.surveyGenderM }),
  ]);
  genderSelect.value = genderNow === 'm' ? 'm' : 'f';
  genderSelect.addEventListener('change', async () => {
    await saveDraft(host, collect(inputs));
    await call(host, 'setGender', genderSelect.value);
  });
  inputs.gender = genderSelect;
  surveyBox.append(el('label', { class: 'academy-field' }, [
    el('span', { text: genderX.surveyGender }),
    genderSelect,
    el('span', { class: 'academy-note', text: genderX.surveyGenderHint }),
  ]));

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
      renderPanel(host);
      if (res && res.ok !== false && str(survey.canon)) refreshCanonLayer(host);
      if (res && res.ok === false) setStatus(lastPlanStatus(), 'error', String(res.error || 'Генерация не удалась.'));
      else if (res && res.ok && Array.isArray(res.warnings) && res.warnings.length) {
        setStatus(lastPlanStatus(), 'error', [res.notice, res.warnings.join(' ')].filter(Boolean).join(' '));
      } else if (res && res.ok && res.partial && res.notice) {
        setStatus(lastPlanStatus(), 'error', String(res.notice));
      }
    },
  });

  const surveyOpen = mounted.focusSurvey === true;
  mounted.focusSurvey = false;
  academy.push(section(U.surveySection, [
    el('p', { class: 'academy-note', text: U.surveyNote }),
    surveyBox,
    el('div', { class: 'academy-row academy-row-buttons' }, [guessBtn]),
    el('p', { class: 'academy-note', text: U.surveyGuessNote }),
    guessStatus,
    el('div', { class: 'academy-row academy-row-buttons' }, [genBtn]),
    planStatus,
  ], surveyOpen ? 'focus' : false));
  mounted.planStatus = planStatus;
  if (mounted.canonBusy) setStatus(planStatus, 'busy', extraLabels(null).canonBusy);

  academy.push(renderPlanTable(host, view, preset));

  work.push(renderModeBlock(host, view));
  work.push(renderAnalysisBlock(host, view));
  work.push(renderPaceBlock(host, view));
  work.push(renderBullyingBlock(host, view));
  work.push(renderApiBlock(host, view));
  work.push(renderLorebookBlock(host, view));
  work.push(renderCardCastBlock(host, preset));
  const drawBlock = renderDrawBlock(host, preset, settings);
  if (drawBlock) work.push(drawBlock);

  look.push(...renderLookBlock(host, preset, settings));
  look.push(bare(renderSoundBlock(host, preset, settings), true));

  data.push(renderPresetBlock(host, view));
  data.push(renderTransferBlock(host, view));
  data.push(renderDebugBlock(host, view));

  const startStatus = el('div', { class: 'academy-status' });
  const hint = safe(() => (host.getStartHint ? host.getStartHint() : null), null) || {};
  const chatId = safe(() => (host.getChatId ? String(host.getChatId() || '') : ''), '');
  const savedDay = settings && settings.ui && settings.ui.startDayDraft;
  const draftDay = savedDay && savedDay.chatId === chatId && /^\d{4}-\d{2}-\d{2}$/.test(savedDay.day) ? savedDay.day : '';
  const startDay = el('input', {
    type: 'date',
    class: 'text_pole academy-input',
    value: draftDay || hint.day || '',
  });
  startDay.value = draftDay || hint.day || '';
  startDay.addEventListener('change', () => {
    safe(() => host.setSettings({ ui: { startDayDraft: { chatId, day: startDay.value } } }), null);
  });
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

  const startOpen = mounted.focusStart === true;
  mounted.focusStart = false;
  academy.push(section(U.startSection, [
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
        : hint.from === 'survey' ? fill(U.startDayFromSurvey, { matched: String(hint.matched || '').trim() }) : U.startDayFromPreset,
    }),
    el('div', { class: 'academy-row academy-row-buttons' }, [startBtn]),
    startStatus,
  ], startOpen ? 'focus' : false));

  const feed = [bare(renderFeedBlock(host, preset, settings, renderCastParts(host, preset)))];

  if (surveyOpen || startOpen) sectionOpen.set('panel::set:academy', true);

  const X = extraLabels(preset);
  const f = settings.feed || {};
  const modeNow = (view.modes.find((m) => m.active) || {}).label;
  const ruleNow = (view.examRules.find((r) => r.active) || {}).label;
  const feedCur = [
    f.hooks === false ? X.setHooksOff : X.setHooksOn,
    f.molvaManual === true ? X.setFeedManual : fill(X.setFeedEvery, { n: Number.isInteger(f.molvaEvery) && f.molvaEvery >= 1 ? f.molvaEvery : 3 }),
  ].join(' · ');
  const accordions = [
    accordion('academy', X.setAcademy, view.started ? U.startedButton : U.notStartedTitle, academy),
    accordion('work', X.setWork, [modeNow, ruleNow, view.api.routed === 'endpoint' ? X.setApiOwn : ''].filter(Boolean).join(' · '), work),
    accordion('feed', U.tabFeed, feedCur, feed),
    accordion('look', LOOK_TEXT.section, lookSummary(settings, preset), look),
    accordion('data', X.setData, `«${(view.presets.list.find((p) => p.active) || {}).name || view.presets.active}»`, data),
  ];
  return { l: el('div', { class: 'ad-acc-list' }, accordions), cls: 'ad-plain ad-full', single: true };
}

function accordion(id, title, cur, body) {
  return memoDetails(`set:${id}`, {
    cls: 'ad-acc',
    summary: [el('h3', { text: title }), el('span', { class: 'ad-cur', text: cur }), svgIcon('chev', 'ad-chev')],
    body: el('div', { class: 'ad-acc-body' }, body),
  });
}

function bare(block, titled = false) {
  const parts = [...block.children].slice(1);
  const title = block.children[0] ? block.children[0].textContent : '';
  return el('div', { class: 'ad-set-sub' }, [titled ? el('h4', { text: title }) : null, ...parts]);
}

export function hostExtra(host) {
  return {
    lorebook: safe(() => (host.getLorebook ? host.getLorebook() : null), null),
    presets: safe(() => (host.getPresets ? host.getPresets() : null), null),
    cardBooks: safe(() => (host.getCardBooks ? host.getCardBooks() : []), []),
    baseVocab: safe(() => (host.getBaseVocab ? host.getBaseVocab() : null), null),
    markerRisk: safe(() => (host.markerVisibleRisk ? host.markerVisibleRisk() : false), false),
    connections: safe(() => (host.getConnections ? host.getConnections() : null), null),
    chatId: safe(() => (host.getChatId ? String(host.getChatId() || '') : ''), ''),
  };
}

const lastPlanStatus = () => mounted.planStatus;

export function canonDoneText(X, r) {
  const n = Number((r && r.count) || 0);
  const h = Number((r && r.holidays) || 0);
  return fill(X.canonDone, {
    strings: `${n} ${plural(n, 'строка', 'строки', 'строк')}`,
    holidays: `${h} ${plural(h, 'праздник', 'праздника', 'праздников')}`,
  });
}

function refreshCanonLayer(host) {
  const X = extraLabels(null);
  mounted.canonBusy = true;
  setStatus(lastPlanStatus(), 'busy', X.canonBusy);
  Promise.resolve().then(() => call(host, 'generateCanonLayer')).then((r) => {
    mounted.canonBusy = false;
    if (r && r.ok !== false) {
      try { renderPanel(host); } catch {}
      setStatus(lastPlanStatus(), 'ok', canonDoneText(X, r));
    } else setStatus(lastPlanStatus(), 'error', `Подписи мира не обновились: ${(r && r.error) || 'запрос не удался'}`);
  }).catch((err) => {
    mounted.canonBusy = false;
    setStatus(lastPlanStatus(), 'error', `Подписи мира не обновились: ${(err && err.message) || 'запрос не удался'}`);
  });
}

function renderPlanTable(host, view, preset) {
  const U = view.labels;
  const X = extraLabels(preset);
  const status = el('div', { class: 'academy-status' });
  const base = JSON.stringify({ subjects: view.subjects, teachers: view.teachers });
  const kept = mounted.planDraft && mounted.planDraft.base === base ? mounted.planDraft.draft : null;
  const draft = kept || {
    subjects: view.subjects.map((s) => ({ ...s })),
    teachers: view.teachers.map((t) => ({ ...t })),
  };
  mounted.planDraft = { base, draft };

  const body = el('div', { class: 'academy-plan-table' });

  const selects = [];

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

  let lastIds = draft.teachers.map(teacherIdOf);

  const refreshTeacherOptions = () => {
    const ids = draft.teachers.map(teacherIdOf);
    const moved = new Map();
    lastIds.forEach((was, i) => { if (was && ids[i] && was !== ids[i]) moved.set(was, ids[i]); });
    const known = new Set(draft.teachers.filter((t) => str(t.name)).map(teacherIdOf));

    for (const { sel, subject } of selects) {
      if (subject.teacherId && moved.has(subject.teacherId)) subject.teacherId = moved.get(subject.teacherId);
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
    if (view.canonRefresh) {
      body.append(el('div', { class: 'academy-row academy-row-buttons' }, [
        el('div', {
          class: 'menu_button academy-btn academy-btn-small',
          text: X.canonRefresh,
          onclick: async (e) => {
            const res = await runAction(e.currentTarget, status, () => {
              setStatus(status, 'busy', X.canonBusy);
              return call(host, 'generateCanonLayer');
            }, (r) => canonDoneText(X, r));
            renderPanel(host);
            if (res && res.ok !== false) setStatus(lastPlanStatus(), 'ok', canonDoneText(X, res));
          },
        }),
      ]));
    }
    if (view.canonWords && view.canonWords.length) {
      body.append(el('p', {
        class: 'academy-note academy-canon-words',
        text: fill(X.canonWordsLine, { words: view.canonWords.map(([a, b]) => `${a} → ${b}`).join(', ') }),
      }));
    }
    body.append(el('div', { class: 'academy-table academy-table-teachers' },
      draft.teachers.length
        ? draft.teachers.map((t, i) => el('div', { class: 'academy-tr' }, [
          canonStamped(field('Имя', t.name, (v) => { t.name = v; }, U.teacherNameHint, refreshTeacherOptions), t.canon === true, X.canonBadge),
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
      draft.teachers.length ? el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: X.planClear,
        onclick: () => {
          draft.teachers.length = 0;
          for (const s of draft.subjects) s.teacherId = '';
          redraw();
        },
      }) : null,
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
          el('div', { class: 'academy-td' }, [
            el('label', { class: 'academy-field' }, [
              el('span', { text: 'Как даётся' }),
              el('select', {
                class: 'text_pole academy-input',
                onchange: (e) => { s.profile = e.currentTarget.value; },
              }, PROFILE_VIEW.map((o) => el('option', { value: o.id, text: o.label, selected: (s.profile || '') === o.id }))),
            ]),
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
        onclick: () => { draft.subjects.push({ id: '', name: '', teacherId: '', building: '', room: '', profile: '' }); redraw(); },
      }),
      draft.subjects.length ? el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: X.planClear,
        onclick: () => { draft.subjects.length = 0; redraw(); },
      }) : null,
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
  ]);
}

function collect(inputs) {
  const out = {};
  for (const [k, node] of Object.entries(inputs)) out[k] = node.value.trim();
  return out;
}

function saveDraft(host, survey) {
  try {
    const chatId = safe(() => (host.getChatId ? String(host.getChatId() || '') : ''), '');
    const res = host.setSettings({ ui: { surveyDraft: { ...survey, chatId } } });
    return Promise.resolve(res);
  } catch (err) {
    return Promise.resolve({ ok: false, error: err });
  }
}

function canonStamped(cell, canon, label) {
  if (canon) cell.append(el('span', { class: 'academy-canon ad-stamp-canon', text: label }));
  return cell;
}

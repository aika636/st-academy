import { METADATA_KEY, SCHEMA_VERSION, migrate, validateState } from './core/state.mjs';
import { normalizePlot } from './core/plot.mjs';
import { MARKS_MAX } from './core/feed.mjs';
import { readDeltas } from './core/molva.mjs';
import { tidyTally } from './core/feats.mjs';
import { fill, uiLabels } from './ui.js';

export const KEY = METADATA_KEY;

export const DEFAULT_SETTINGS = {
  mode: 'auto',
  prep: true,
  injectMarker: true,
  relativeWords: false,
  injectDepth: 1,
  statusViaMacro: false,
  debug: false,
  milestoneSound: false,
  achievements: true,
  secretaryAuto: true,
  achievementTally: {},
  api: {
    source: 'auto',
    profile: '',
    endpoint: '',
    model: '',
  },
  preset: 'ru-university',
  presets: {},
  feed: {
    hooks: true,
    auto: false,
    background: true,
    molvaEvery: 3,
    molvaManual: false,
    swear: 'mild',
  },
  draw: {
    route: '',
    models: {},
    style: 'anime',
    styleText: '',
    naiSize: 'portrait',
    custom: { mode: 'openai', endpoint: '', model: '' },
  },
  lorebook: {
    enabled: false,
    book: '',
  },
  ui: {},
  cardCasts: {},
};

let contextProvider = () => (globalThis.SillyTavern && globalThis.SillyTavern.getContext
  ? globalThis.SillyTavern.getContext()
  : null);

export function setContextProvider(fn) {
  contextProvider = typeof fn === 'function' ? fn : () => null;
}

export function context(ctx) {
  const c = ctx || contextProvider();
  if (!c) throw new Error('academy/storage: контекст SillyTavern недоступен');
  return c;
}

export function resolveArgs(a, b) {
  if (looksLikeContext(a)) return { ctx: a, preset: b };
  if (a && !looksLikeContext(a)) return { ctx: looksLikeContext(b) ? b : undefined, preset: a };
  return { ctx: a, preset: b };
}

function looksLikeContext(v) {
  return Boolean(v && typeof v === 'object'
    && ('chatMetadata' in v || 'saveMetadataDebounced' in v || 'extensionSettings' in v));
}

export function migrationPlan(raw) {
  if (raw === undefined || raw === null) return { action: 'empty' };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { action: 'invalid', reason: 'состояние в метаданных не объект' };
  }
  const v = raw.schemaVersion;
  if (typeof v !== 'number' || !Number.isFinite(v)) return { action: 'migrate', from: 0 };
  if (v > SCHEMA_VERSION) return { action: 'refuse', from: v };
  if (v < SCHEMA_VERSION) return { action: 'migrate', from: v };
  return { action: 'load', from: v };
}

export function readState(raw, preset) {
  const plan = migrationPlan(raw);

  if (plan.action === 'empty') return { status: 'empty', state: null, errors: [] };
  if (plan.action === 'invalid') return { status: 'invalid', state: null, errors: [plan.reason] };
  if (plan.action === 'refuse') {
    return {
      status: 'future',
      state: null,
      from: plan.from,
      errors: [`состояние записано схемой версии ${plan.from}, расширение понимает ${SCHEMA_VERSION};`
        + ' обновите расширение — состояние не тронуто'],
    };
  }

  let migrated;
  try {
    migrated = migrate(raw, preset);
  } catch (err) {
    return { status: 'invalid', state: null, errors: [`миграция не прошла: ${err && err.message}`] };
  }

  const checked = validateState(migrated, preset);
  if (!checked.ok) {
    return { status: 'invalid', state: migrated, errors: checked.errors, from: plan.from };
  }
  return {
    status: plan.action === 'migrate' ? 'migrated' : 'ok',
    state: migrated,
    errors: [],
    from: plan.from,
  };
}

export function loadStateReport(ctx, preset) {
  const args = resolveArgs(ctx, preset);
  const c = context(args.ctx);
  const md = c.chatMetadata || {};
  return readState(md[KEY], args.preset);
}

export function loadState(ctx, preset) {
  const report = loadStateReport(ctx, preset);
  return report.status === 'ok' || report.status === 'migrated' ? report.state : null;
}

export function saveState(ctx, state) {
  const c = context(looksLikeContext(ctx) ? ctx : undefined);
  const target = looksLikeContext(ctx) ? state : ctx;
  const md = c.chatMetadata;
  if (!md) throw new Error('academy/storage: у чата нет метаданных');
  md[KEY] = stripSecrets(target);
  c.saveMetadataDebounced();
  return target;
}

export async function flushState(ctx, state) {
  const c = context(looksLikeContext(ctx) ? ctx : undefined);
  const target = looksLikeContext(ctx) ? state : ctx;
  const md = c.chatMetadata;
  if (!md) throw new Error('academy/storage: у чата нет метаданных');
  if (target !== undefined) md[KEY] = stripSecrets(target);
  await c.saveMetadata();
  return target;
}

export function clearState(ctx) {
  const c = context(ctx);
  const md = c.chatMetadata;
  if (md) {
    delete md[KEY];
    delete md[TURNS_KEY];
  }
  c.saveMetadataDebounced();
}

export const TURNS_KEY = `${KEY}_turns`;

export const TURNS_FORMAT = 1;

export const TURN_HISTORY = 5;

export function readTurns(raw, preset) {
  if (!raw || typeof raw !== 'object' || raw.v !== TURNS_FORMAT || !Array.isArray(raw.list)) return [];
  const out = [];
  for (const t of raw.list) {
    if (!t || typeof t !== 'object' || !Number.isInteger(t.mesId) || t.mesId < 0) continue;
    const report = readState(t.before, preset);
    if (report.status !== 'ok' && report.status !== 'migrated') continue;
    out.push({
      mesId: t.mesId,
      stamp: typeof t.stamp === 'string' ? t.stamp : null,
      before: report.state,
      oneShotBefore: typeof t.oneShotBefore === 'string' ? t.oneShotBefore : '',
      oneShot: typeof t.oneShot === 'string' ? t.oneShot : '',
      analysis: typeof t.analysis === 'string' ? t.analysis : null,
      marks: readMarks(t.marks),
      molva: readDeltas(t.molva),
      ...jumpAnswerOf(t.jumpAnswer),
    });
  }
  return out.slice(-TURN_HISTORY);
}

function jumpAnswerOf(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.stamp !== 'string' || typeof raw.day !== 'string') return {};
  return { jumpAnswer: { stamp: raw.stamp, day: raw.day, accept: raw.accept !== false } };
}

export function readMarks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((m) => m && typeof m.id === 'string' && m.id).slice(-MARKS_MAX).map((m) => ({
    id: m.id,
    read: m.read === true,
    mine: typeof m.mine === 'string' ? m.mine : '',
    status: typeof m.status === 'string' ? m.status : 'new',
    playedSrc: typeof m.playedSrc === 'string' ? m.playedSrc : '',
  }));
}

export function loadTurns(ctx, preset) {
  const c = context(ctx);
  const md = c.chatMetadata || {};
  return readTurns(md[TURNS_KEY], preset);
}

export function saveTurns(ctx, list) {
  const c = context(ctx);
  const md = c.chatMetadata;
  if (!md) throw new Error('academy/storage: у чата нет метаданных');
  const turns = (Array.isArray(list) ? list : []).slice(-TURN_HISTORY).map((t) => ({
    mesId: t.mesId,
    stamp: t.stamp,
    before: stripSecrets(t.before),
    oneShotBefore: t.oneShotBefore || '',
    oneShot: t.oneShot || '',
    analysis: typeof t.analysis === 'string' ? t.analysis : null,
    marks: readMarks(t.marks),
    molva: readDeltas(t.molva),
    ...jumpAnswerOf(t.jumpAnswer),
  }));
  md[TURNS_KEY] = { v: TURNS_FORMAT, list: turns };
  c.saveMetadataDebounced();
  return turns;
}

export const LEDGER_KEY = `${KEY}_ledger`;

export const LEDGER_FORMAT = 1;

export const LEDGER_SIZE = 100;

export function readLedger(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== LEDGER_FORMAT || !Array.isArray(raw.list)) return [];
  const out = [];
  for (const e of raw.list) {
    if (!e || typeof e !== 'object' || typeof e.stamp !== 'string' || !e.stamp) continue;
    out.push({
      stamp: e.stamp,
      rows: Array.isArray(e.rows) ? e.rows.filter((r) => typeof r === 'string' && r) : [],
      day: typeof e.day === 'string' ? e.day : '',
      time: typeof e.time === 'string' ? e.time : '',
      tokens: Array.isArray(e.tokens) ? e.tokens.filter((t) => typeof t === 'string' && t) : null,
      marker: e.marker === true,
      at: Number.isFinite(e.at) ? e.at : 0,
      mode: e.mode === 'late' ? 'late' : 'live',
      receipts: Array.isArray(e.receipts) ? e.receipts.map((r) => (r && typeof r === 'object' ? r : null)) : null,
      summary: typeof e.summary === 'string' ? e.summary.slice(0, 300) : '',
      unparsed: unparsedList(e.unparsed),
      draft: e.draft && Array.isArray(e.draft.tokens) ? {
        tokens: e.draft.tokens.filter((t) => typeof t === 'string' && t),
        summary: typeof e.draft.summary === 'string' ? e.draft.summary.slice(0, 300) : '',
        unparsed: unparsedList(e.draft.unparsed),
      } : null,
      previousAnalysis: e.previousAnalysis && typeof e.previousAnalysis === 'object'
        && (e.previousAnalysis.tokens === null || Array.isArray(e.previousAnalysis.tokens)) ? {
          tokens: Array.isArray(e.previousAnalysis.tokens)
            ? e.previousAnalysis.tokens.filter((t) => typeof t === 'string' && t) : null,
          summary: typeof e.previousAnalysis.summary === 'string' ? e.previousAnalysis.summary.slice(0, 300) : '',
        } : null,
    });
  }
  return out.slice(-LEDGER_SIZE);
}

function unparsedList(v) {
  return (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim().slice(0, 80)).slice(0, 6);
}

export function loadLedger(ctx) {
  const c = context(ctx);
  const md = c.chatMetadata || {};
  return readLedger(md[LEDGER_KEY]);
}

export function saveLedger(ctx, list) {
  const c = context(ctx);
  const md = c.chatMetadata;
  if (!md) throw new Error('academy/storage: у чата нет метаданных');
  const ledger = readLedger({ v: LEDGER_FORMAT, list: Array.isArray(list) ? list : [] });
  md[LEDGER_KEY] = { v: LEDGER_FORMAT, list: ledger };
  c.saveMetadataDebounced();
  return ledger;
}

export const PLOT_KEY = `${KEY}_plot`;

export function loadPlot(ctx) {
  const c = context(ctx);
  const md = c.chatMetadata || {};
  return normalizePlot(md[PLOT_KEY]);
}

export function savePlot(ctx, plot) {
  const c = context(ctx);
  const md = c.chatMetadata;
  if (!md) throw new Error('academy/storage: у чата нет метаданных');
  const clean = normalizePlot(plot);
  md[PLOT_KEY] = clean;
  c.saveMetadataDebounced();
  return clean;
}

export function stripSecrets(state) {
  if (!state || typeof state !== 'object') return state;
  if (state.api || state.settings) {
    const out = { ...state };
    delete out.api;
    delete out.settings;
    return out;
  }
  return state;
}

export const EXPORT_FORMAT = 'academy-state';

export const EXPORT_FORMAT_VERSION = 1;

export const EXTENSION_VERSION = 'unknown';

function jsonClone(v) {
  return JSON.parse(JSON.stringify(v));
}

export function buildExport(state, preset, opts = {}) {
  const clean = jsonClone(stripSecrets(state));
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt: (opts.now ? new Date(opts.now) : new Date()).toISOString(),
    extensionVersion: String(opts.extensionVersion || EXTENSION_VERSION),
    presetId: String((clean && clean.presetId) || (preset && preset.id) || ''),
    presetName: (preset && String(preset.id || '') === String((clean && clean.presetId) || (preset && preset.id) || ''))
      ? String(preset.displayName || preset.name || '') : '',
    schemaVersion: clean && clean.schemaVersion,
    state: clean,
  };
}

export function exportFilename(envelope) {
  const id = String((envelope && envelope.presetId) || 'academy') || 'academy';
  const day = String((envelope && envelope.exportedAt) || '').slice(0, 10) || 'no-date';
  return `academy-${id}-${day}.json`;
}

export function exportState(ctx, preset, opts = {}) {
  const args = resolveArgs(ctx, preset);
  const report = loadStateReport(args.ctx, args.preset);

  if (report.status === 'empty') {
    return { ok: false, code: 'empty', message: 'Семестр в этом чате не начат — выгружать нечего.', errors: [] };
  }
  if (report.status === 'future') {
    return {
      ok: false,
      code: 'future',
      message: `Состояние в этом чате новее расширения (${report.errors[0]}). Выгрузка не делается:`
        + ' переписав его своей рукой, расширение возьмёт на себя чужую форму.',
      errors: report.errors,
    };
  }
  if (!report.state) {
    return { ok: false, code: 'invalid', message: `Состояние не читается: ${report.errors.join('; ')}.`, errors: report.errors };
  }

  const data = buildExport(report.state, args.preset, opts);
  return {
    ok: true,
    data,
    json: JSON.stringify(data, null, 2),
    filename: exportFilename(data),
    warnings: report.errors.slice(),
  };
}

function looksLikeBareState(v) {
  return Boolean(v && typeof v === 'object' && !Array.isArray(v)
    && ('calendar' in v || 'subjects' in v) && ('presetId' in v || 'schemaVersion' in v));
}

export function readExport(source, preset) {
  const fail = (code, message, errors = []) => ({ ok: false, code, message, errors });

  let data = source;
  if (typeof source === 'string') {
    const text = source.trim();
    if (!text) return fail('not-json', 'Файл пуст: в нём нет ни состояния, ни чего-либо ещё.');
    try {
      data = JSON.parse(text);
    } catch (err) {
      return fail('not-json', `Это не JSON: ${(err && err.message) || 'разбор не удался'}.`
        + ' Нужен файл, скачанный кнопкой «Скачать состояние».', [String(err && err.message)]);
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return fail('not-object', 'В файле JSON, но не объект: ожидался объект выгрузки академии.');
  }

  const warnings = [];
  let envelope = data;
  if (data.format === 'academy-preset') {
    return fail('preset-file', 'Это пресет заведения, а не состояние семестра. Его загружают в блоке «Пресет заведения».');
  }
  if (data.format !== EXPORT_FORMAT) {
    if (looksLikeBareState(data)) {
      warnings.push('состояние без конверта: ни даты выгрузки, ни версии расширения в файле нет');
      envelope = { format: EXPORT_FORMAT, formatVersion: EXPORT_FORMAT_VERSION, state: data, presetId: data.presetId };
    } else {
      return fail('foreign', data.format
        ? `Это выгрузка чего-то другого: format = «${String(data.format)}», ожидалось «${EXPORT_FORMAT}».`
        : 'Это не выгрузка академии: в объекте нет поля format. Возможно, выбран не тот файл.');
    }
  }

  const fv = envelope.formatVersion;
  if (typeof fv === 'number' && Number.isFinite(fv) && fv > EXPORT_FORMAT_VERSION) {
    return fail('format-future', `Файл выгружен форматом версии ${fv}, расширение понимает ${EXPORT_FORMAT_VERSION}.`
      + ' Обновите расширение — файл не тронут.');
  }

  const raw = envelope.state;
  if (raw === undefined || raw === null) {
    return fail('no-state', 'В выгрузке нет поля state: файл нашей формы, но состояния в нём нет.');
  }

  const report = readState(raw, preset);
  if (report.status === 'empty') return fail('no-state', 'В выгрузке нет состояния.');
  if (report.status === 'future') {
    return fail('future', `Состояние в файле записано схемой версии ${report.from},`
      + ` расширение понимает ${SCHEMA_VERSION}. Обновите расширение — файл не тронут.`, report.errors);
  }
  if (report.status === 'invalid') {
    return fail('invalid', `Состояние в файле не проходит проверку: ${report.errors.join('; ')}.`
      + ' Скорее всего, оно собрано другой версией расширения или правлено вручную.', report.errors);
  }

  if (report.status === 'migrated') {
    warnings.push(`состояние собрано схемой версии ${report.from}, поднято до ${SCHEMA_VERSION}`);
  }

  const presetId = String(report.state.presetId || envelope.presetId || '');
  const activeId = String((preset && preset.id) || '');
  const presetMatches = !activeId || !presetId || presetId === activeId;
  if (!presetMatches) {
    warnings.push(presetMismatchNote(presetId, activeId, preset, String(envelope.presetName || '')));
  }

  return {
    ok: true,
    status: report.status,
    state: report.state,
    from: report.from,
    envelope,
    presetId,
    presetName: String(envelope.presetName || ''),
    presetMatches,
    warnings,
  };
}

export function presetMismatchNote(presetId, activeId, preset = null, fromName = '') {
  const toName = String((preset && (preset.displayName || preset.name)) || '') || activeId;
  return fill(uiLabels(preset).presetMismatch, { from: fromName || presetId, to: toName });
}

export function stateSummary(state) {
  if (!state || typeof state !== 'object') return null;
  return {
    presetId: String(state.presetId || ''),
    day: (state.calendar && state.calendar.day) || null,
    termStart: (state.calendar && state.calendar.termStart) || null,
    started: Boolean(state.started),
    subjects: Array.isArray(state.subjects) ? state.subjects.length : 0,
    teachers: Array.isArray(state.teachers) ? state.teachers.length : 0,
    grades: Array.isArray(state.subjects)
      ? state.subjects.reduce((n, s) => n + ((s && Array.isArray(s.grades)) ? s.grades.length : 0), 0)
      : 0,
    schemaVersion: state.schemaVersion,
  };
}

export async function importState(ctx, source, preset, opts = {}) {
  const parsed = readExport(source, preset);
  if (!parsed.ok) return parsed;

  const current = loadStateReport(ctx, preset);
  const occupied = current.status !== 'empty';

  const reasons = [];
  if (occupied) {
    const s = stateSummary(current.state);
    const U = uiLabels(preset);
    reasons.push(s && s.started
      ? fill(U.importOccupiedStarted, { subjects: s.subjects, day: s.day })
      : U.importOccupiedEmpty);
  }
  if (!parsed.presetMatches) reasons.push(presetMismatchNote(parsed.presetId, String((preset && preset.id) || ''), preset, parsed.presetName));

  if (reasons.length && opts.confirm !== true) {
    return {
      ok: false,
      code: 'needs-confirm',
      message: `Загрузка перезапишет то, что есть: ${reasons.join('; ')}. Подтвердите замену.`,
      errors: [],
      needsConfirm: true,
      reasons,
      current: stateSummary(current.state),
      incoming: stateSummary(parsed.state),
      warnings: parsed.warnings,
    };
  }

  const md = context(ctx).chatMetadata;
  if (md) delete md[TURNS_KEY];
  await flushState(ctx, parsed.state);
  return { ok: true, state: parsed.state, status: parsed.status, warnings: parsed.warnings, replaced: occupied };
}

export function mergeDefaults(defaults, stored) {
  const out = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  for (const [k, def] of Object.entries(defaults)) {
    if (Array.isArray(def)) {
      if (!Array.isArray(out[k])) out[k] = def.slice();
    } else if (def && typeof def === 'object') {
      out[k] = mergeDefaults(def, out[k]);
    } else if (!(k in out) || out[k] === null || typeof out[k] !== typeof def) {
      out[k] = def;
    }
  }
  return out;
}

export const KEYS_STORE = 'academy_keys';

const memoryKeys = {};

function keyStore() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function readKeys() {
  const ls = keyStore();
  if (!ls) return { ...memoryKeys };
  try {
    const raw = JSON.parse(ls.getItem(KEYS_STORE) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function readKey(name) {
  const v = readKeys()[name];
  return typeof v === 'string' ? v : '';
}

export function writeKey(name, value) {
  const keys = readKeys();
  const v = String(value == null ? '' : value);
  if (v) keys[name] = v;
  else delete keys[name];
  const ls = keyStore();
  if (!ls) { memoryKeys[name] = v; return; }
  try { ls.setItem(KEYS_STORE, JSON.stringify(keys)); } catch { memoryKeys[name] = v; }
}

const KEY_SLOTS = [
  { name: 'api', get: (s) => s.api },
  { name: 'draw', get: (s) => s.draw && s.draw.custom },
];

function takeKeys(target, clear = false) {
  let moved = false;
  for (const slot of KEY_SLOTS) {
    const box = target && slot.get(target);
    if (!box || typeof box !== 'object' || !('key' in box)) continue;
    if (typeof box.key === 'string' && (box.key || clear)) writeKey(slot.name, box.key);
    delete box.key;
    moved = true;
  }
  return moved;
}

export function loadSettings(ctx) {
  const c = context(ctx);
  const all = c.extensionSettings;
  if (!all || typeof all !== 'object') throw new Error('academy/storage: нет extension_settings');
  if (!all[KEY] || typeof all[KEY] !== 'object') all[KEY] = {};
  const live = mergeDefaults(DEFAULT_SETTINGS, all[KEY]);
  const moved = takeKeys(live);
  const tidied = !tidyDone && tidySettings(live);
  tidyDone = true;
  if ((moved || tidied) && typeof c.saveSettingsDebounced === 'function') c.saveSettingsDebounced();
  return live;
}

export const CARD_CASTS_MAX = 100;

let tidyDone = false;

export function tidySettings(s) {
  const before = JSON.stringify([s.achievementTally, s.cardCasts]);
  s.achievementTally = tidyTally(s.achievementTally);
  const casts = s.cardCasts && typeof s.cardCasts === 'object' && !Array.isArray(s.cardCasts) ? s.cardCasts : {};
  const kept = Object.entries(casts).filter(([, v]) => v && typeof v === 'object' && (v.checked || v.source !== 'auto'));
  s.cardCasts = Object.fromEntries(kept.slice(-CARD_CASTS_MAX));
  return JSON.stringify([s.achievementTally, s.cardCasts]) !== before;
}

export function putCardCast(ctx, avatar, cast) {
  const c = context(ctx);
  const s = loadSettings(c);
  const all = s.cardCasts;
  delete all[avatar];
  all[avatar] = cast;
  const names = Object.keys(all);
  for (const name of names.slice(0, Math.max(0, names.length - CARD_CASTS_MAX))) delete all[name];
  c.saveSettingsDebounced();
  return cast;
}

export function pruneCardCasts(ctx, avatars) {
  const c = context(ctx);
  const s = loadSettings(c);
  const alive = new Set(avatars);
  const gone = Object.keys(s.cardCasts).filter((a) => !alive.has(a));
  for (const a of gone) delete s.cardCasts[a];
  if (gone.length) c.saveSettingsDebounced();
  return gone.length;
}

export function dropDrafts(ctx, chatId) {
  const c = context(ctx);
  const s = loadSettings(c);
  let dropped = false;
  for (const name of ['surveyDraft', 'startDayDraft']) {
    const d = s.ui && s.ui[name];
    if (d && chatId && d.chatId === chatId) { delete s.ui[name]; dropped = true; }
  }
  if (dropped) c.saveSettingsDebounced();
  return dropped;
}

export function saveSettings(settings, ctx) {
  const c = context(looksLikeContext(settings) ? settings : ctx);
  const raw = looksLikeContext(settings) ? ctx : settings;
  const live = loadSettings(c);
  if (raw && raw !== live && typeof raw === 'object') {
    const patch = JSON.parse(JSON.stringify(raw));
    takeKeys(patch, true);
    deepAssign(live, patch);
  }
  takeKeys(live);
  c.saveSettingsDebounced();
  return live;
}

export function drawSettings(ctx) {
  const d = loadSettings(ctx).draw;
  return { ...d, custom: { ...d.custom, key: readKey('draw') } };
}

export function settingsWithKeys(ctx) {
  const s = loadSettings(ctx);
  return { ...s, api: { ...s.api, key: readKey('api') }, draw: drawSettings(ctx) };
}

export function deepAssign(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (!target[k] || typeof target[k] !== 'object' || Array.isArray(target[k])) target[k] = {};
      deepAssign(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

export function userPresetMap(ctx) {
  const s = loadSettings(ctx);
  if (!s.presets || typeof s.presets !== 'object' || Array.isArray(s.presets)) s.presets = {};
  return s.presets;
}

export function listUserPresets(ctx) {
  return Object.entries(userPresetMap(ctx))
    .filter(([, p]) => p && typeof p === 'object')
    .map(([id, p]) => ({ id, name: String(p.displayName || p.name || id), basedOn: String(p.basedOn || '') }));
}

export function getUserPreset(ctx, id) {
  const p = userPresetMap(ctx)[String(id || '')];
  return p && typeof p === 'object' ? p : null;
}

export function putUserPreset(ctx, preset) {
  const c = context(ctx);
  const map = userPresetMap(c);
  map[String(preset.id)] = preset;
  c.saveSettingsDebounced();
  return preset;
}

export function removeUserPreset(ctx, id) {
  const c = context(ctx);
  const map = userPresetMap(c);
  const key = String(id || '');
  if (!(key in map)) return false;
  delete map[key];
  c.saveSettingsDebounced();
  return true;
}

export function apiSettings(ctx) {
  const s = loadSettings(ctx);
  return { ...s.api, key: readKey('api') };
}

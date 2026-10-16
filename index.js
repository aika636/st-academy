import { applyResponse, sitExam, sceneExamId, timeSkipWarning } from './core/engine.mjs';
import { buildPrompt, statusLine } from './prompt.mjs';
import {
  awaitingAnnouncement, gradeInfo, isPassing, kindOf, publicView, sittableExams, EXAM_RULES, examRule,
} from './core/exams.mjs';
import { PACES, PACE_WORDS } from './core/relations.mjs';
import {
  buildAnalysisPrompt, parseAnalysis, effectiveText, tokenText, tokenEvent, tokenOf,
  dropTokenAt, factRef, reactionsOf, reactionOf, isFactToken, isReactToken, isPlayedToken, isBullyToken, isPrepToken, playedOf, loudOf, privateRefs,
  unparsedNames, unparsedLeft, repliesOf, replyOf, isReplyToken, tokenAbout, talkParts,
} from './core/analysis.mjs';
import { heroGender, heroWords, resolvePreset, GENDERS } from './core/gender.mjs';
import { withCanonVocab, cleanCanonVocab } from './core/canon-vocab.mjs';
import { withCanonLayer } from './core/canon-layer.mjs';
import { applyEventFame } from './core/fame.mjs';
import { applySceneEvents, applyNotableFacts, applyLoudScene, applyReactions, localMet, revertSceneSource, SCENE_KINDS } from './core/scene.mjs';
import {
  reactionCap, carryFeedMarks, rememberFeedMarks, markRead, markPlayed, setLoudness, toggleReact, postByRef, retimeSource,
  feedItems as feedItemsOf,
} from './core/feed.mjs';
import {
  tickMolva, molvaDue, issueWorth, everyOf, swearOf, planIssue, buildMolvaPrompt, parseIssue, loversOf, applyIssue, replayMolva, DELTAS_KEPT,
  newFacts,
} from './core/molva.mjs';
import {
  emptyPlot, takeHook, dropHook, draftHook, hookPrompt, onGeneration, onPlayerSent, onReply, expireHooks,
  secretaryHooks, knownHooks, playedRefs, autoPick, isMuted, quietScene, HOLIDAY_KIND, dropStale,
  syncInviteHook, hookById, INVITE_KIND, syncBullyHook, bullyHookPrompt,
} from './core/plot.mjs';
import { stepPrep, prepList } from './core/prep.mjs';
import { stepBullying, bullyHookWords, bullyingOn, carryBullying, setBullyingOptions, setBullyRole, resetBullyPick } from './core/bullying.mjs';
import { pickWanted, pickKeyOf, applyPick } from './core/bully-pick.mjs';
import { stepInvites, inviteHookWords, inviteCard, answerInvite, dropInvite, invitesOf, settleInvite, unsettleInvite,
  askPromises, promiseCards, answerPromise, settlePromise, replayPromises, doneLines } from './core/invites.mjs';
import { applyCorrection, revertCorrection, receiptOf, completionReceipt } from './core/corrections.mjs';
import { MARKER_RE, stripMarker, parseMarker, splitNewRole, isWhoParty, whoPartyName } from './core/parse-marker.mjs';
import {
  cloneState, createState, normalizeCanon, defaultStartDay, isDay, normalizePortrait,
  normalizeSubject, normalizeTeacher, normalizeBullying, TEACHER_TEXT_MAX, teacherDetails, LORE_FOUND_MAX, normalizeLoreSkipped,
} from './core/state.mjs';
import { readTime, surveyYear } from './core/time-source.mjs';
import { readDiceRoll, readTimeSkip, readPhoneTurn } from './core/cues.mjs';
import { diffMilestones } from './core/milestones.mjs';
import { earnedFeats, recordTally, tickFeats, syncFeats, featsKnow, RARITIES } from './core/feats.mjs';
import { stopList, filterPeople, stopHit, normName } from './core/stop-names.mjs';
import { loreDigest, mergeIntoCanon, bindToRoster } from './core/lore-people.mjs';
import { normalizeCast, castNames, guessCastLocal, withCyrillicForms } from './core/card-cast.mjs';
import { addClassmate, updateClassmate, removeClassmate, classmateIdOf, takeLoreFound, loreFields, toHeroRelation } from './core/classmates.mjs';
import { castOf as feedCastOf, setCast as setFeedCast, updateMember as updateFeedMember, carryCast, worldRealities, calendarNames, rumorAuthors, castAttempt, castResult } from './core/feed-cast.mjs';
import { markerPeople, confirmCandidate, listCandidates, findClassmate, sameName, isPerson, normalizeAliases, carryRoster, carryNotes, setPersonNote, classmateSize } from './core/classmates.mjs';
import { buildSchedule } from './core/schedule.mjs';
import { manualTime, resolveHeldJump, skipToDayEnd } from './core/engine.mjs';
import { alignToGrid, weekdayShiftOf, shiftYears } from './core/time.mjs';
import { addEvent, removeEvent, updateEventDates, armHolidayHooks, alreadyPlanned, carryEvents } from './core/holidays.mjs';
import {
  BUILTIN_PRESETS, aliasPresetId, DEFAULT_BASE, USER_PRESETS_MAX, freeId, freeName, normalizePreset,
  presetEnvelope, presetFilename, presetSummary, presetSwitchPlan, keepsPresetView, readPresetFile,
} from './core/preset.mjs';
import {
  extraLabels, fill, formatDate, formatDateOn, setDateShift, gradebookView, hookJournal, hookNow, hookSummary, hookToday, playChime,
  promptDoctorView, todayView, PRESET_TEXT, uiLabels, heldWaiting,
} from './ui.js';
import { renderMessagePanels, clearMessagePanels, rowText, PANEL_TEXT } from './mes-panel.js';
import { ensureLook } from './ui/look.js';
import { authorAvatar } from './core/masks.mjs';
import { savePortraitImage } from './portraits.js';
import { drawImage, drawInfo, drawForm, loadTavernModules, loadCustomModels } from './draw.js';
import { buildPortraitPrompt, hasCyrillic, looksTagsPrompt, parseLooksTags, inventLooksPrompt, parseInventedLooks } from './core/draw-prompt.mjs';
import { normalizeLooks } from './core/portraits.mjs';
import * as storage from './storage.js';
import * as api from './api.js';
import * as lorebook from './lorebook.js';
import { PHASE_OK as LORE_OK, PHASE_WAIT as LORE_WAIT, PHASE_ERROR as LORE_ERROR } from './core/lore-status.mjs';

const EXT_NAME = (() => {
  const m = /\/scripts\/extensions\/(.+)\/index\.js/.exec(import.meta.url);
  return m ? m[1] : 'third-party/academy';
})();

const MODULE = 'academy';

const PRESET_IDS = BUILTIN_PRESETS;

const INJECT = {
  status: 'academy_status',
  marker: 'academy_marker',
  oneShot: 'academy_oneshot',
};

const ctx = () => SillyTavern.getContext();

const live = {
  rawPreset: null,
  view: null,
  resolved: null,
  get preset() {
    const raw = this.rawPreset;
    if (!raw) return null;
    let name = '';
    try { name = String((ctx() || {}).name1 || ''); } catch {}
    const gender = heroGender(this.state, name);
    const st = this.state;
    const cv = (st && st.canonVocab) || null;
    const cl = (st && st.canonLayer) || null;
    const canon = (st && st.survey && st.survey.canon) || '';
    const hit = this.resolved;
    if (hit && hit.raw === raw && hit.gender === gender && hit.cv === cv && hit.cl === cl && hit.canon === canon) return hit.value;
    const value = withCanonLayer(withCanonVocab(resolvePreset(raw, gender), st), st);
    this.resolved = { raw, gender, cv, cl, canon, value };
    return value;
  },
  set preset(next) {
    this.rawPreset = next;
    this.resolved = null;
  },
  state: null,
  report: null,
  turns: [],
  ledger: [],
  analyzing: new Set(),
  analysisErrors: new Map(),
  oneShot: '',
  plot: emptyPlot(),
  quiet: false,
  generating: null,
  skipWarning: '',
  undoneAt: -1,
  epoch: 0,
  panel: null,
  lastRun: null,
  molvaDebug: null,
  loreKeyPool: [],
  castFails: { n: 0, skipped: 0 },
  lorebook: { signature: null, report: null, error: null, suggested: [], status: null, restartedFor: null },
  presets: [],
  builtins: {},
  presetNotice: '',
  version: '',
  macro: null,
  shownMilestones: new Set(),
  hookQueue: [],
  examRng: null,
  chime: playChime,
};

async function loadBuiltin(id) {
  if (live.builtins[id]) return live.builtins[id];
  const url = `/scripts/extensions/${EXT_NAME}/presets/${id}.json`;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`пресет ${id} не читается: HTTP ${res.status}`);
  const p = await res.json();
  live.builtins[id] = p;
  return p;
}

async function ensureBuiltins() {
  for (const id of PRESET_IDS) {
    if (live.builtins[id]) continue;
    try {
      await loadBuiltin(id);
    } catch (err) {
      console.warn(`[${MODULE}] пресет ${id} не прочитан:`, err);
    }
  }
  return live.builtins;
}

const PRESET_PROBES = [
  function statusLine(state, preset) { buildPrompt(state, preset, { injects: [], withMarker: true }); },
  function today(state, preset) { todayView(state, preset); },
  function gradebook(state, preset) { gradebookView(state, preset); },
];

function missingPreset(id) {
  const err = new Error(`пресета «${id}» нет ни среди встроенных, ни среди своих`);
  err.code = 'missing';
  return err;
}

async function loadPreset(id = DEFAULT_BASE) {
  if (PRESET_IDS.includes(id)) return loadBuiltin(id);
  const raw = storage.getUserPreset(ctx(), id);
  if (!raw) throw missingPreset(id);
  const builtins = await ensureBuiltins();
  const res = normalizePreset(raw, { builtins, basedOn: raw.basedOn, probe: PRESET_PROBES });
  if (!res.ok) throw new Error(res.message);
  return { ...res.preset, id };
}

async function loadPresetList(active) {
  const out = [];
  for (const id of PRESET_IDS) {
    if (active && active.id === id) {
      out.push({ id, name: String(active.displayName || active.name || id) });
      continue;
    }
    try {
      const p = await loadBuiltin(id);
      out.push({ id, name: String((p && (p.displayName || p.name)) || id) });
    } catch (err) {
      console.warn(`[${MODULE}] пресет ${id} не прочитан для списка:`, err);
      out.push({ id, name: id, broken: true });
    }
  }
  let own = [];
  try {
    own = storage.listUserPresets(ctx());
  } catch (err) {
    console.warn(`[${MODULE}] свои пресеты не прочитаны:`, err);
  }
  for (const p of own) {
    if (PRESET_IDS.includes(p.id)) continue;
    out.push({ id: p.id, name: p.name, user: true, basedOn: p.basedOn });
  }
  return out;
}

function toast(kind, text, title = 'Academy') {
  try {
    if (globalThis.toastr && typeof globalThis.toastr[kind] === 'function') globalThis.toastr[kind](text, title);
  } catch {}
}

function safeUserPreset(c, id) {
  try { return storage.getUserPreset(c, id); } catch { return null; }
}

function presetName(id) {
  const hit = live.presets.find((p) => p.id === id);
  if (hit) return hit.name;
  const b = live.builtins[id];
  return String((b && (b.displayName || b.name)) || id);
}

function announce(text) {
  live.presetNotice = text;
  toast('warning', text);
}

function checkStatePreset() {
  const id = String((live.state && live.state.presetId) || '');
  if (!id || !live.preset || id === live.preset.id) return false;
  if (live.presets.some((p) => p.id === id)) return false;
  toast('warning', fill(PRESET_TEXT.stateGone, { id, active: presetName(live.preset.id) }));
  return true;
}

async function adoptChatPreset() {
  const wanted = aliasPresetId(String((live.state && live.state.presetId) || storage.loadSettings(ctx()).preset || DEFAULT_BASE));
  if (!live.preset || wanted === live.preset.id) return false;
  if (!PRESET_IDS.includes(wanted) && !safeUserPreset(ctx(), wanted)) return false;
  const epoch = live.epoch;
  let next;
  try {
    next = await loadPreset(wanted);
  } catch (err) {
    console.warn(`[${MODULE}] пресет чата ${wanted} не загружен:`, err);
    return false;
  }
  if (epoch !== live.epoch) return false;
  live.preset = next;
  live.presets = await loadPresetList(next);
  reloadState();
  return true;
}

async function readAndNormalize(source) {
  const file = readPresetFile(source);
  if (!file.ok) return { ok: false, code: file.code, error: file.message, errors: file.errors };
  const builtins = await ensureBuiltins();
  const res = normalizePreset(file.raw, { builtins, basedOn: file.basedOn, probe: PRESET_PROBES });
  const warnings = [...file.warnings, ...(res.warnings || [])];
  if (!res.ok) return { ok: false, code: res.code, error: res.message, errors: res.errors, warnings };
  const own = storage.listUserPresets(ctx());
  const id = freeId(res.preset.id, [...PRESET_IDS, ...own.map((p) => p.id)]);
  const takenNames = [...PRESET_IDS.map((b) => presetName(b)), ...own.map((p) => p.name)];
  const name = freeName(res.preset.displayName, takenNames);
  return { ok: true, preset: res.preset, id, name, renamed: id !== res.preset.id, warnings };
}

function endPresetView() {
  if (!live.view) return false;
  live.preset = live.view.raw;
  live.presets = live.view.presets;
  live.view = null;
  refreshPanel();
  return true;
}

async function switchPreset(wanted, next) {
  storage.saveSettings({ preset: wanted }, ctx());
  live.preset = next;
  if (live.state && live.state.presetId !== wanted) {
    const aligned = alignToGrid({ ...live.state, presetId: wanted }, next);
    forgetTurns();
    await commit(aligned.state, { flush: true });
  }
  live.presets = await loadPresetList(next);
  reloadState();
  setInjects({ oneShot: '' });
  live.lorebook.signature = null;
  await syncLorebook();
  refreshPanel();
}

async function loadVersion() {
  try {
    const res = await fetch(`/scripts/extensions/${EXT_NAME}/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return '';
    const m = await res.json();
    return String((m && m.version) || '');
  } catch (err) {
    console.warn(`[${MODULE}] манифест не прочитан, версия в выгрузке будет неизвестной:`, err);
    return '';
  }
}

function reloadState() {
  if (!live.preset) return null;
  const report = storage.loadStateReport(ctx(), live.preset);
  live.report = report;
  live.state = report.state;
  if (live.state && aliasPresetId(live.state.presetId) !== live.state.presetId) {
    live.state = { ...live.state, presetId: aliasPresetId(live.state.presetId) };
  }
  live.turns = storage.loadTurns(ctx(), live.preset);
  live.ledger = storage.loadLedger(ctx());
  live.plot = storage.loadPlot(ctx());
  if (live.state) live.plot = syncBullyHook(live.plot, ...bullyHookArgs(live.state));
  live.analysisErrors.clear();
  primeCardCast();
  if (live.state) dropCastCandidates().catch((err) => console.warn(`[${MODULE}] кандидаты не почищены:`, err));
  primeMilestones();
  return report;
}

function primeMilestones() {
  const list = worldMilestones(live.state);
  live.shownMilestones = new Set(list.map(shownKey));
  tallyMilestones(list);
}

function tallyMilestones(list) {
  if (!list || !list.length) return;
  try {
    const chat = currentChatId();
    if (!chat) return;
    const settings = storage.loadSettings(ctx());
    const before = settings.achievementTally;
    const today = new Date().toISOString().slice(0, 10);
    const after = recordTally(before, chat, list, today);
    if (after !== before) storage.saveSettings({ achievementTally: after }, ctx());
  } catch (err) {
    console.warn(`[${MODULE}] счёт достижений не записан:`, err);
  }
}

function featsOn() {
  try { return storage.loadSettings(ctx()).achievements !== false; } catch { return true; }
}

function charName() {
  try {
    const c = ctx();
    return castMainNames(c)[0] || String((c && c.name2) || '');
  } catch { return ''; }
}

function worldMilestones(state) {
  if (!state || !live.preset) return [];
  try {
    return earnedFeats(publicView(state, live.preset), live.preset, { char: charName() });
  } catch (err) {
    console.warn(`[${MODULE}] вехи не посчитаны:`, err);
    return [];
  }
}

async function commit(state, { flush = false } = {}) {
  live.state = state;
  const c = ctx();
  storage.saveTurns(c, live.turns);
  if (flush) return storage.flushState(c, state);
  return storage.saveState(c, state);
}

function forgetTurns() {
  live.turns = [];
  live.oneShot = '';
  live.ledger = [];
  live.analysisErrors.clear();
  try {
    storage.saveLedger(ctx(), live.ledger);
  } catch (err) {
    console.warn(`[${MODULE}] протокол ответов не очищен:`, err);
  }
  live.plot = emptyPlot();
  savePlot();
}

let bullyPicking = null;

async function ensureBullyPick({ force = false } = {}) {
  if (!live.state || !live.state.started || !live.preset) return { ok: false, error: 'семестра в этом чате нет' };
  if (bullyPicking) return bullyPicking;
  if (force) await commit(resetBullyPick(live.state));
  else if (!pickWanted(live.state)) return { ok: true, skipped: true };
  const exclude = force ? ((live.state.bullying && live.state.bullying.past) || []) : [];
  const c = ctx();
  const op = captureOperation();
  const at = live.state;
  bullyPicking = (async () => {
    try {
      const res = await api.generateBullyPick(at, live.preset, storage.apiSettings(c), c, { char: castMainNames(c), heroine: String((c && c.name1) || ''), exclude });
      if (!isCurrent(op)) return chatChanged('подбирался зачинщик');
      const next = applyPick(live.state, live.preset, res, { key: pickKeyOf(at), stop: classmateStop() });
      await commit(next);
      live.plot = syncBullyHook(live.plot, ...bullyHookArgs(next));
      savePlot();
      setInjects({});
      await syncLorebook();
      refreshPanel();
      return res.status === 'failed' ? { ok: false, status: 'failed', error: res.error || 'запрос не удался' } : { ok: true, status: res.status };
    } catch (err) {
      console.error(`[${MODULE}] зачинщик не подобран:`, err);
      return { ok: false, error: `Подбор не удался: ${(err && err.message) || err}` };
    } finally {
      bullyPicking = null;
    }
  })();
  return bullyPicking;
}

function bullyHookArgs(state, resolved = '') {
  const pending = state && state.bullying && state.bullying.pending;
  const words = pending ? bullyHookWords(state, live.preset, { heroine: safeHeroName() }) : null;
  return [words, { hookId: pending ? pending.hookId : '', resolved }];
}

function savePlot() {
  try {
    live.plot = storage.savePlot(ctx(), live.plot);
  } catch (err) {
    console.warn(`[${MODULE}] очередь поводов не записана:`, err);
  }
}

function plotSettings() {
  const f = storage.loadSettings(ctx()).feed || {};
  return { enabled: f.hooks !== false, auto: f.hooks !== false && f.auto === true, background: f.background !== false };
}

function holidaySounding() {
  const armed = String(live.oneShot || '');
  if (!armed) return false;
  return live.turns.some((t) => Array.isArray(t.holidayLines) && t.holidayLines.some((line) => line && armed.includes(line)));
}

function holidayLinesOf(injects) {
  return (Array.isArray(injects) ? injects : []).filter((i) => i && i.kind === HOLIDAY_KIND && i.text).map((i) => String(i.text));
}

function lastUserText() {
  const chat = chatOf();
  for (let i = chat.length - 1; i >= 0; i -= 1) {
    const m = chat[i];
    if (m && m.is_user && !m.is_system) return String(m.mes || '');
  }
  return '';
}

function feedMuted() {
  const said = lastUserText();
  return isMuted(said) || quietScene(said);
}

function currentChatId() {
  try {
    const c = ctx();
    return typeof c.getCurrentChatId === 'function' ? String(c.getCurrentChatId() ?? '') : '';
  } catch {
    return '';
  }
}

function captureOperation() {
  return { epoch: live.epoch, chatId: currentChatId() };
}

function isCurrent(op) {
  return Boolean(op) && op.epoch === live.epoch && op.chatId === currentChatId();
}

function chatChanged(what) {
  const error = `Пока ${what}, открылся другой чат. Результат не записан ни туда, ни сюда:`
    + ' вернитесь в тот чат и повторите.';
  try {
    if (globalThis.toastr && typeof globalThis.toastr.warning === 'function') {
      globalThis.toastr.warning(error, 'Academy');
    }
  } catch {}
  return { ok: false, code: 'chat-changed', error };
}

function setInjects({ oneShot = null } = {}) {
  if (oneShot !== null) live.oneShot = String(oneShot || '');
  if (live.quiet) return;
  writeInjects();
}

function writeInjects({ blank = false } = {}) {
  const c = ctx();
  const settings = storage.loadSettings(c);
  const types = c.extension_prompt_types || { IN_CHAT: 1 };
  const roles = c.extension_prompt_roles || { SYSTEM: 0 };
  const depth = Number.isFinite(settings.injectDepth) ? settings.injectDepth : 1;

  const started = !blank && Boolean(live.state && live.state.started);
  const withMarker = Boolean(settings.injectMarker) && settings.mode !== 'context';
  const muted = started && feedMuted();
  const plotOpts = plotSettings();
  const built = started
    ? buildPrompt(live.state, live.preset, { injects: [], withMarker, feed: { quiet: muted || !plotOpts.background, muted }, heroine: c.name1 })
    : { status: '', instruction: '', oneShot: '' };
  const hook = started && !muted && plotOpts.enabled && !holidaySounding() ? hookPrompt(live.plot) : '';
  const status = settings.statusViaMacro === true ? '' : built.status;
  const bully = started && !muted && bullyingOn(live.state) ? bullyHookPrompt(live.plot) : '';
  const oneShot = started ? [live.oneShot, hook, bully, live.skipWarning].filter(Boolean).join(' ') : '';

  c.setExtensionPrompt(INJECT.status, status, types.IN_CHAT, depth, false, roles.SYSTEM);
  c.setExtensionPrompt(INJECT.marker, built.instruction, types.IN_CHAT, depth + 1, false, roles.SYSTEM);
  c.setExtensionPrompt(INJECT.oneShot, oneShot, types.IN_CHAT, 0, false, roles.SYSTEM);
}

function armedOneShot() {
  const latest = live.turns[live.turns.length - 1];
  if (!latest) return live.oneShot;
  return latest.stamp === null ? latest.oneShotBefore : latest.oneShot;
}

function handleGenerationStarted(type, _params, dryRun) {
  if (dryRun !== true) endPresetView();
  if (!live.preset || dryRun === true) return;
  if (type === 'quiet') {
    live.quiet = true;
    writeInjects({ blank: true });
    return;
  }
  live.quiet = false;
  flushHooks();
  live.oneShot = armedOneShot();
  if (type === 'swipe' || type === 'regenerate' || type === 'continue') {
    const chat = chatOf();
    const latest = live.turns[live.turns.length - 1];
    if (latest && sameTurn(latest, chat.length - 1, chat)) live.oneShot = latest.oneShotBefore;
  }
  live.generating = String(type || 'normal');
  refreshSkipWarning();
  if (type !== 'impersonate' && live.state && live.state.started) {
    live.plot = onGeneration(live.plot, { enabled: plotSettings().enabled, muted: feedMuted(), yielded: holidaySounding() });
    savePlot();
  }
  writeInjects();
}

async function handlePlayerSent(mesId) {
  endPresetView();
  if (!live.preset || !live.state || !live.state.started) return 'семестр не начат';
  const message = chatOf()[mesId];
  if (!message || !message.is_user) return 'не реплика игрока';
  const muted = isMuted(message.mes) || quietScene(message.mes);
  const opts = plotSettings();
  const yielded = holidaySounding();
  let { plot } = onPlayerSent(live.plot, { enabled: opts.enabled, muted, yielded });
  if (opts.auto && !muted) {
    const picked = autoPick(plot, live.state, { enabled: true, muted, yielded, heroine: ctx().name1, preset: live.preset });
    plot = picked.plot;
    if (picked.id) await commit(picked.state);
  }
  live.plot = plot;
  savePlot();
  setInjects({});
  refreshPanel();
  return muted ? 'без поводов' : 'принята';
}

function refreshSkipWarning() {
  live.skipWarning = '';
  const type = live.generating;
  if (!type || type === 'impersonate' || !live.state || !live.state.started) return;
  const chat = chatOf();
  const last = chat.length - 1;
  const again = type === 'swipe' || type === 'regenerate' || type === 'continue';
  const at = again && last >= 0 && eligible(chat[last]) ? last : chat.length;
  const said = userTextBefore(chat, at);
  if (readPhoneTurn(said)) return;
  live.skipWarning = timeSkipWarning(live.state, live.preset, readTimeSkip(said));
}

function handleGenerationEnded() {
  if (!live.preset) return;
  live.quiet = false;
  flushHooks();
  live.generating = null;
  live.skipWarning = '';
  live.oneShot = armedOneShot();
  writeInjects();
}

async function syncLorebook({ force = false, immediately = false } = {}) {
  const c = ctx();
  const settings = storage.loadSettings(c);
  const s = lorebook.settingsOf(settings);

  if (!s.enabled) {
    live.lorebook.signature = null;
    live.lorebook.report = null;
    live.lorebook.error = null;
    live.lorebook.status = null;
    return null;
  }

  const names = loreNames(c);
  const retry = live.lorebook.retryAt && Date.now() >= live.lorebook.retryAt ? '|retry' : '';
  const base = lorebook.planSignature(live.state, live.preset, { cache: lorebook.loreMeta(c).en, names });
  const signature = base ? base + retry : base;
  if (!force && signature && signature === live.lorebook.signature) return live.lorebook.report;

  const op = captureOperation();
  const genKey = () => lorebook.planSignature(live.state, live.preset, { names });
  const gen = genKey();
  setLoreStatus({ phase: LORE_WAIT });
  try {
    const report = await lorebook.syncLorebook(c, live.state, live.preset, {
      settings,
      npcs: live.lorebook.suggested.filter((x) => x.kind !== 'places'),
      places: live.lorebook.suggested.filter((x) => x.kind === 'places'),
      immediately,
      names,
      chatText: loreChatText(c, 20000),
      translate: (items, extra) => translateLore(c, items, names, extra),
      guard: () => isCurrent(op) && genKey() === gen,
      chatGuard: () => isCurrent(op),
    });
    if (!isCurrent(op)) return null;
    if (genKey() !== gen) {
      const next = genKey();
      if (live.lorebook.restartedFor === next) return null;
      live.lorebook.restartedFor = next;
      return syncLorebook({ force: true, immediately });
    }
    live.lorebook.report = report;
    live.lorebook.error = null;
    if (report && report.ok && (!report.untranslated || live.lorebook.retryAt)) live.lorebook.signature = signature;
    if (report && report.ok) {
      setLoreStatus({ phase: report.untranslated ? LORE_WAIT : LORE_OK, changes: report.changes });
    } else if (report && ['no-state', 'off', 'no-chat', 'no-world-info'].includes(report.reason)) live.lorebook.status = null;
    else setLoreStatus({ phase: LORE_ERROR, error: report && report.reason });
    return report;
  } catch (err) {
    if (!isCurrent(op)) return null;
    console.error(`[${MODULE}] лорбук не обновлён:`, err);
    live.lorebook.error = String((err && err.message) || err);
    setLoreStatus({ phase: LORE_ERROR, error: live.lorebook.error });
    return null;
  }
}

function setLoreStatus({ phase, error = '', changes }) {
  const prev = live.lorebook.status || {};
  const fresh = Array.isArray(changes) && changes.length;
  live.lorebook.status = {
    phase,
    error: String(error || ''),
    changes: fresh ? changes : (prev.changes || []),
    at: phase === LORE_OK ? Date.now() : (prev.at || 0),
  };
}

function loreNames(c) {
  const char = [...new Set([...castMainNames(c), String((c && c.name2) || '')].map((n) => n.trim()).filter(Boolean))];
  return { user: [String((c && c.name1) || '').trim()].filter(Boolean), char, essence: [personaText(c), cardText(c)].filter(Boolean).join(' ') };
}

function loreChatText(c, max) {
  const chat = Array.isArray(c && c.chat) ? c.chat : [];
  let out = '';
  for (let i = chat.length - 1; i >= 0 && out.length < max; i -= 1) {
    const m = chat[i];
    if (!m || m.is_system || typeof m.mes !== 'string') continue;
    out = `${m.mes.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')}\n${out}`;
  }
  return out.slice(-max);
}

async function translateLore(c, items, names, extra = {}) {
  if (Date.now() < (live.lorebook.retryAt || 0)) return null;
  live.lorebook.retryAt = 0;
  try {
    const res = await api.generateLoreEnglish(items, storage.apiSettings(c), c, {
      userName: names.user[0] || '', charNames: names.char, chat: loreChatText(c, 2500), spellings: extra.spellings,
    });
    if (res.failed.length) live.lorebook.retryAt = Date.now() + 120000;
    return res;
  } catch {
    live.lorebook.retryAt = Date.now() + 120000;
    return null;
  }
}

const HOOK_EVENTS = Object.freeze([
  'academy:day', 'academy:period', 'academy:phase', 'academy:exam', 'academy:milestone', 'academy:rollback',
]);

function emitHook(name, detail = {}) {
  let payload;
  try {
    payload = JSON.parse(JSON.stringify({ ...detail, chatId: currentChatId() }));
  } catch {
    return;
  }
  if (live.quiet) {
    live.hookQueue.push([name, payload]);
    return;
  }
  fireHook(name, payload);
}

function fireHook(name, payload) {
  try {
    const doc = globalThis.document;
    if (doc && typeof doc.dispatchEvent === 'function' && typeof globalThis.CustomEvent === 'function') {
      doc.dispatchEvent(new globalThis.CustomEvent(name, { detail: payload }));
    }
  } catch (err) {
    console.warn(`[${MODULE}] событие ${name} не ушло в document:`, err);
  }
  try {
    const ev = ctx().eventSource;
    if (ev && typeof ev.emit === 'function') {
      Promise.resolve(ev.emit(name, payload)).catch((err) => console.warn(`[${MODULE}] подписчик ${name} упал:`, err));
    }
  } catch (err) {
    console.warn(`[${MODULE}] событие ${name} не ушло в eventSource:`, err);
  }
}

function flushHooks() {
  if (live.quiet || !live.hookQueue.length) return;
  const queue = live.hookQueue;
  live.hookQueue = [];
  for (const [name, payload] of queue) fireHook(name, payload);
}

function safeToday(state) {
  try { return hookToday(state, live.preset); } catch { return null; }
}

function noticeChanges(before, after, meta = {}) {
  if (!before || !after || !after.started || !live.preset) return;
  noticeMilestones(before, after);

  const a = safeToday(before);
  const b = safeToday(after);
  if (a && b) {
    if (a.day !== b.day) {
      emitHook('academy:day', { day: b.day, from: a.day, weekday: b.weekday, phase: b.phase, ...meta });
    }
    if (a.phase !== b.phase) {
      emitHook('academy:phase', { phase: b.phase, from: a.phase, label: b.phaseLabel, day: b.day, ...meta });
    }
    const key = (t) => (t.period && t.period.status === 'now' ? `${t.day}:${t.period.ordinal}` : '');
    if (key(b) && key(b) !== key(a)) {
      emitHook('academy:period', { day: b.day, ...b.period, ...meta });
    }
  }

  const was = new Map(((before.exams && before.exams.items) || []).map((i) => [i.id, i]));
  for (const item of (after.exams && after.exams.items) || []) {
    if (item.outcome === null || item.outcome === undefined || awaitingAnnouncement(item)) continue;
    const prev = was.get(item.id);
    const known = prev && prev.outcome !== null && prev.outcome !== undefined && !awaitingAnnouncement(prev)
      && String(prev.outcome) === String(item.outcome) && prev.attempts === item.attempts;
    if (known) continue;
    emitHook('academy:exam', examDetail(after, item, meta));
  }
}

function examDetail(state, item, meta) {
  const subject = (state.subjects || []).find((s) => s.id === item.subjectId);
  const kind = kindOf(live.preset, item.kind);
  const info = gradeInfo(live.preset, item.outcome);
  const rolls = Array.isArray(item.rolls) ? item.rolls : [];
  const last = rolls[rolls.length - 1] || null;
  return {
    examId: item.id,
    subjectId: item.subjectId,
    subject: (subject && subject.name) || item.subjectId,
    kind: item.kind,
    kindName: (kind && kind.name) || String(item.kind || ''),
    value: String(item.outcome),
    label: (info && info.label) || String(item.outcome),
    passed: isPassing(live.preset, item.outcome),
    attempt: item.attempts || 1,
    day: item.day || state.calendar.day,
    ...(item.announceOn ? { announced: true, announceOn: item.announceOn } : {}),
    ...(item.modelOverride ? { modelOverride: true } : {}),
    ...(last && last.tier ? { tier: last.tier } : {}),
    ...(last && Number.isFinite(last.roll) ? { roll: last.roll, dc: last.dc } : {}),
    ...meta,
  };
}

const looksTagCache = new Map();

async function looksToTags(looks, signal) {
  const text = String(looks || '').trim();
  if (!text || !hasCyrillic(text)) return [];
  if (looksTagCache.has(text)) return looksTagCache.get(text);
  try {
    const c = ctx();
    const { system, user } = looksTagsPrompt(text);
    const res = await api.complete(storage.apiSettings(c), { system, user, ctx: c, signal, maxTokens: api.TOKEN_BUDGETS.looks });
    const tags = res.ok ? parseLooksTags(res.text) : [];
    if (tags.length) looksTagCache.set(text, tags);
    return tags;
  } catch {
    return [];
  }
}

async function inventLooks(person, opts, signal) {
  try {
    const c = ctx();
    const { system, user } = inventLooksPrompt(person, opts);
    const res = await api.complete(storage.apiSettings(c), { system, user, ctx: c, signal, maxTokens: api.TOKEN_BUDGETS.looks });
    return res.ok ? parseInventedLooks(res.text) : '';
  } catch {
    return '';
  }
}

const shownKey = (m) => (m.src ? `${m.id}@${m.src}` : m.id);

function noticeMilestones(before, after) {
  const added = diffMilestones(worldMilestones(before), worldMilestones(after)).added
    .filter((m) => !live.shownMilestones.has(shownKey(m)));
  if (!added.length) return;
  tallyMilestones(added);
  const X = extraLabels(live.preset);
  const on = featsOn();
  const best = added.reduce((a, m) => (RARITIES.indexOf(m.rarity) > RARITIES.indexOf(a.rarity) ? m : a), added[0]);
  for (const m of added) {
    live.shownMilestones.add(shownKey(m));
    if (!on) continue;
    if (m === best) toast('success', `${m.emoji} ${m.name} — ${m.desc}`, X.milestoneToastTitle);
    emitHook('academy:milestone', {
      id: m.id, kind: m.feat || 'moment', name: m.name, desc: m.desc, emoji: m.emoji, rarity: m.rarity, when: m.when || null,
      ...(m.subjectId ? { subjectId: m.subjectId } : {}),
      ...(m.teacherId ? { teacherId: m.teacherId } : {}),
    });
  }
  if (on && storage.loadSettings(ctx()).milestoneSound === true) {
    try { live.chime(); } catch {}
  }
}

function noticeJump(jump) {
  if (!jump || !jump.periods) return;
  toast('info', fill(extraLabels(live.preset).jumpToast, { periods: jump.periods }));
}

function armPending(state) {
  const pending = Array.isArray(state && state.pending) ? state.pending : [];
  if (!pending.length) return state;
  const latest = live.turns[live.turns.length - 1];
  if (latest && latest.stamp === null) return state;
  const joined = [armedOneShot(), ...pending.map((i) => i && i.text)].filter(Boolean).join(' ');
  if (latest) {
    latest.oneShot = joined;
    const lines = holidayLinesOf(pending);
    if (lines.length) latest.holidayLines = [...(latest.holidayLines || []), ...lines].slice(-6);
  }
  live.oneShot = joined;
  return { ...state, pending: [] };
}

function examSeedBase(state) {
  const term = (state && state.calendar && state.calendar.termStart) || '';
  return `${currentChatId()}|${term}`;
}

function stamp(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return `${text.length}:${h}`;
}

function eligible(message) {
  if (!message || message.is_user || message.is_system) return false;
  const from = message.extra && message.extra.from;
  return !(typeof from === 'string' && from.trim() !== '');
}

function matchesTurn(message, turn) {
  if (!eligible(message) || !turn.stamp) return false;
  if (stamp(String(message.mes ?? '')) === turn.stamp) return true;
  return Array.isArray(message.swipes) && message.swipes.some((s) => stamp(String(s ?? '')) === turn.stamp);
}

function sameTurn(turn, mesId, chat) {
  const message = chat[mesId];
  if (!eligible(message)) return false;
  if (turn.mesId === mesId) return true;
  return matchesTurn(message, turn) && !matchesTurn(chat[turn.mesId], turn);
}

function findTurn(chat, turn, floor = -1) {
  const n = chat.length;
  const at = turn.mesId;
  if (turn.stamp === null) return at > floor && at < n && eligible(chat[at]) ? at : -1;
  if (at > floor && at < n && matchesTurn(chat[at], turn)) return at;
  for (let d = 1; d < n; d += 1) {
    const lo = at - d;
    const hi = at + d;
    if (lo > floor && lo < n && matchesTurn(chat[lo], turn)) return lo;
    if (hi > floor && hi < n && matchesTurn(chat[hi], turn)) return hi;
    if (lo <= floor && hi >= n) break;
  }
  return -1;
}

function locateTurns(chat) {
  let floor = -1;
  return live.turns.map((turn) => {
    const at = findTurn(chat, turn, floor);
    if (at >= 0) floor = at;
    return at;
  });
}

const chatOf = () => {
  const c = ctx();
  return Array.isArray(c && c.chat) ? c.chat : [];
};

function userTextBefore(chat, at) {
  for (let i = Math.min(at, chat.length) - 1; i >= 0; i -= 1) {
    const m = chat[i];
    if (!m || m.is_system) continue;
    if (m.is_user) return String(m.mes || '');
    if (eligible(m)) return '';
  }
  return '';
}

function sceneNames(c) {
  const user = c && c.name1;
  let char = c && c.name2;
  try {
    if (c && c.groupId !== undefined && c.groupId !== null && Array.isArray(c.groups)) {
      const group = c.groups.find((g) => g && String(g.id) === String(c.groupId));
      const chars = Array.isArray(c.characters) ? c.characters : [];
      const names = (group && Array.isArray(group.members) ? group.members : [])
        .map((avatar) => (chars.find((ch) => ch && ch.avatar === avatar) || {}).name)
        .filter((n) => typeof n === 'string' && n.trim());
      if (names.length) char = names;
    }
  } catch {}
  const cast = castMainNames(c);
  if (cast.length) char = [...[].concat(char == null ? [] : char), ...cast];
  const castAliases = castAvatars(c).flatMap((a) => (castOf(a) || { people: [] }).people)
    .filter((p) => p.role === 'main').flatMap((p) => p.aliases || []);
  if (castAliases.length) char = [...[].concat(char == null ? [] : char), ...castAliases];
  const people = withCyrillicForms(
    castAvatars(c).flatMap((a) => (castOf(a) || { people: [] }).people).filter((p) => p.role === 'main'),
    [...((live.state && [...(live.state.classmates || []), ...(live.state.teachers || []), ...(live.state.classmateCandidates || [])]) || []), ...(live.loreKeyPool || [])],
  );
  return { user, char, cast: people.map((p) => ({ name: p.name, aliases: p.aliases })) };
}

function castAvatars(c) {
  try {
    if (c && c.groupId !== undefined && c.groupId !== null && Array.isArray(c.groups)) {
      const group = c.groups.find((g) => g && String(g.id) === String(c.groupId));
      return (group && Array.isArray(group.members) ? group.members : []).map(String).filter(Boolean);
    }
    const chars = Array.isArray(c && c.characters) ? c.characters : [];
    const ch = c && c.characterId !== undefined && c.characterId !== null ? chars[c.characterId] : null;
    return ch && ch.avatar ? [String(ch.avatar)] : [];
  } catch {
    return [];
  }
}

function castOf(avatar) {
  try {
    const all = storage.loadSettings(ctx()).cardCasts || {};
    return all[avatar] ? normalizeCast(all[avatar]) : null;
  } catch {
    return null;
  }
}

function castMainNames(c) {
  return castAvatars(c).flatMap((a) => castNames(castOf(a)));
}

function saveCast(avatar, cast) {
  const clean = normalizeCast(cast);
  const all = storage.loadSettings(ctx()).cardCasts || {};
  all[avatar] = clean;
  storage.saveSettings({}, ctx());
  return clean;
}

function primeCardCast() {
  try {
    const c = ctx();
    const avatars = castAvatars(c);
    if (avatars.length !== 1 || castOf(avatars[0])) return;
    const read = api.readCharacterCard(c);
    if (!read.ok) return;
    saveCast(avatars[0], guessCastLocal(read.card));
  } catch (err) {
    console.warn(`[${MODULE}] персонаж карточки не угадан:`, err);
  }
}

function castStop(c) {
  const names = castMainNames(c);
  return names.length ? stopList({ char: names }) : [];
}

function castClassmateHits() {
  const stop = castStop(ctx());
  if (!stop.length || !live.state) return [];
  return (live.state.classmates || []).filter((p) => p && stopHit(p.name, stop)).map((p) => p.id);
}

async function dropCastCandidates() {
  const stop = castStop(ctx());
  if (!stop.length || !live.state) return;
  const list = live.state.classmateCandidates || [];
  if (!list.some((p) => p && stopHit(p.name, stop))) return;
  const next = cloneState(live.state);
  next.classmateCandidates = list.filter((p) => !(p && stopHit(p.name, stop)));
  await commit(next);
  refreshPanel();
  renderPanels();
}

function lastEligible(chat) {
  for (let i = chat.length - 1; i >= 0; i -= 1) if (eligible(chat[i])) return i;
  return -1;
}

function latestFor(mesId, chat, { edited = false } = {}) {
  const latest = live.turns[live.turns.length - 1];
  if (!latest) return null;
  if (sameTurn(latest, mesId, chat)) return latest;
  if (edited && mesId > latest.mesId && mesId === lastEligible(chat) && findTurn(chat, latest) === -1) {
    return latest;
  }
  return null;
}

async function rollbackLatest(turn, mesId, reason = 'swipe') {
  const was = turn.stamp;
  turn.mesId = mesId;
  turn.stamp = null;
  live.oneShot = turn.oneShotBefore;
  turn.before = carryManual(live.state, turn.before);
  if (turn.inviteKey) { unsettleInvite(turn.before, turn.inviteKey); turn.inviteKey = ''; }
  turn.marks = rememberFeedMarks(turn.marks, live.state);
  await commit(carryFeedMarks(live.state, turn.before, was || ''));
  live.plot = syncBullyHook(syncInviteHook(live.plot, live.state, inviteHookWords(live.state, live.preset)), ...bullyHookArgs(live.state));
  savePlot();
  announceRollback(reason, mesId);
}

function announceRollback(reason, mesId) {
  const day = live.state && live.state.calendar ? live.state.calendar.day : null;
  emitHook('academy:rollback', { reason, day, ...(Number.isInteger(mesId) ? { mesId } : {}) });
}

const START_HINT_SCAN = 20;

function startDayHint() {
  const fallback = { day: defaultStartDay(live.preset), from: 'preset', matched: '' };
  if (!live.preset) return fallback;

  const c = ctx();
  const chat = Array.isArray(c && c.chat) ? c.chat : [];
  for (let i = chat.length - 1, seen = 0; i >= 0 && seen < START_HINT_SCAN; i -= 1, seen += 1) {
    const m = chat[i];
    if (!m || m.is_system) continue;
    const hit = readTime(String(m.mes || ''), { mode: 'context' }).context;
    if (hit && hit.day && hit.yearFromText) {
      return { day: hit.day, from: 'chat', matched: hit.matched };
    }
  }
  const settings = storage.loadSettings(c);
  const own = Object.fromEntries(Object.entries((live.state && live.state.survey) || {}).filter(([, v]) => v));
  const draft = settings.ui && settings.ui.surveyDraft;
  const year = surveyYear({ ...(draft && draft.chatId === String(currentChatId() || '') ? draft : {}), ...own });
  if (year) return { day: defaultStartDay(live.preset, undefined, year), from: 'survey', matched: String(year) };
  return fallback;
}

function replayJumpAnswer(state, turn, mark) {
  const answer = turn && turn.jumpAnswer;
  if (!answer) return state;
  if (answer.stamp !== mark) {
    delete turn.jumpAnswer;
    return state;
  }
  const held = state.calendar && state.calendar.heldJump;
  if (!held || held.day !== answer.day) return state;
  const res = resolveHeldJump(state, live.preset, answer.accept);
  return answer.accept && res.applied ? armPending(res.state) : res.state;
}

async function handleMessage(mesId, { source = 'received' } = {}) {
  endPresetView();
  if (!live.preset || !live.state || !live.state.started) return 'семестр не начат';
  const c = ctx();
  const chat = chatOf();
  const message = chat[mesId];
  if (!eligible(message)) return 'не ответ модели';

  const text = String(message.mes || '');
  const mark = stamp(text);
  const note = ledgerEntry(mark);
  const tokens = note && Array.isArray(note.tokens) ? note.tokens : null;
  const analysisKey = tokens ? tokens.join(' ') : null;

  let turn = latestFor(mesId, chat);
  const fresh = !turn;
  if (turn) {
    if (turn.stamp === mark && (turn.analysis ?? null) === analysisKey) return 'уже посчитан';
  } else {
    const latest = live.turns[live.turns.length - 1];
    if (latest && mesId <= latest.mesId) return `раньше последнего хода #${latest.mesId}`;
    if (latest && latest.stamp === null) live.turns.pop();
    turn = {
      mesId,
      stamp: null,
      before: cloneState(live.state),
      oneShotBefore: armedOneShot(),
      oneShot: '',
    };
    live.turns.push(turn);
    live.undoneAt = -1;
    if (live.turns.length > storage.TURN_HISTORY) live.turns.splice(0, live.turns.length - storage.TURN_HISTORY);
  }
  if (!fresh) turn.before = carryManual(live.state, turn.before);
  const before = turn.before;

  const settings = storage.loadSettings(c);
  const said = userTextBefore(chat, mesId);
  const phoneTurn = Boolean(readPhoneTurn(said));
  const dice = phoneTurn ? null : readDiceRoll(said);
  const run = applyResponse(before, effectiveText(text, tokens), live.preset, {
    mode: settings.mode,
    relativeWords: settings.relativeWords,
    sitsExam: true,
    names: sceneNames(c),
    phoneTurn,
    timeSkip: phoneTurn ? null : readTimeSkip(said),
  });

  let state = run.state;
  state = replayJumpAnswer(state, turn, mark);
  state = askPromises(state, before.calendar.day, state.calendar.day, mark);
  state = replayPromises(state, live.preset, turn.promiseAnswers, mark, ctx().name1);
  if (turn.promiseAnswers) turn.promiseAnswers = turn.promiseAnswers.filter((a) => a.stamp === mark);
  const injects = [...run.injects];
  let permission = '';

  const exam = maybeSitExam(state, run.modelSaid, dice, `${said}
${text}`);
  if (exam) {
    state = exam.state;
    injects.push(...exam.injects);
    permission = exam.permission;
    run.exam = exam.exam;
    run.divergence = exam.divergence || run.divergence;
  }

  const featsActive = featsOn();
  if (featsActive) state = tickFeats(state);
  state = sceneOfTurn(state, text, tokens, mark, c);
  state = replayMolva(tickMolva(state), turn.molva, mark);
  state = carryFeedMarks(live.state, state, mark, fresh ? [] : turn.marks);
  if (source === 'received') live.plot = onReply(live.plot, { fresh });
  const prepped = stepPrep(state, live.preset, {
    tokens, seed: examSeedBase(state), heroine: c.name1, open: storage.loadSettings(c).prep !== false,
  });
  state = prepped.state;
  live.plot = dropStale(live.plot, state);
  const expired = expireHooks(live.plot, state);
  live.plot = expired.plot;
  state = expired.state;
  state = stepInvites(state, live.preset, {
    text: stripMarker(text), playedIds: Array.isArray(tokens) ? playedOf(tokens) : [], mark, enabled: plotSettings().enabled,
  }).state;
  live.plot = syncInviteHook(live.plot, state, inviteHookWords(state, live.preset));
  const bullied = stepBullying(state, live.preset, {
    tokens, playedIds: Array.isArray(tokens) ? playedOf(tokens) : [], seed: examSeedBase(state), heroine: c.name1,
    sounded: !feedMuted(), voices: !feedMuted() && !molvaSettings().manual, text: stripMarker(text), said,
  });
  state = bullied.state;
  live.plot = syncBullyHook(live.plot, ...bullyHookArgs(state, bullied.resolved));
  savePlot();
  if (featsActive) state = syncFeats(state, { src: mark });

  const oneShot = [permission, ...injects.map((i) => i.text)].filter(Boolean).join(' ');
  turn.mesId = mesId;
  turn.stamp = mark;
  turn.analysis = analysisKey;
  turn.oneShot = oneShot;
  turn.holidayLines = holidayLinesOf(injects);
  live.lastRun = { ...run, injects, permission, source, mesId };
  live.skipWarning = '';
  await commit(state);

  setInjects({ oneShot });
  noticeChanges(before, state, { source, mesId });
  noticeJump(run.jump);
  recordLedger(mark, before, state, { marker: hasOwnMarker(text), exam: run.exam });
  await syncLorebook();
  refreshPanel();
  if (source === 'received' && text.trim()) {
    (secretaryAuto() ? autoAnalyze(mesId, mark) : autoMolva(mesId, mark)).catch((err) => console.error(`[${MODULE}] слухи не выпущены:`, err));
    ensureBullyPick().catch((err) => console.warn(`[${MODULE}] зачинщик не подобран:`, err));
  }
  return 'посчитан';
}

async function traced(event, mesId, run) {
  const row = { event, mesId, result: '…' };
  live.trace = [...(live.trace || []), row].slice(-6);
  try {
    const result = await run();
    row.result = typeof result === 'string' ? result : 'готово';
  } catch (err) {
    row.result = `ошибка: ${(err && err.message) || err}`;
    console.error(`[${MODULE}] ${event} #${mesId} упал:`, err);
  }
}

function ledgerEntry(mark) {
  for (let i = live.ledger.length - 1; i >= 0; i -= 1) if (live.ledger[i].stamp === mark) return live.ledger[i];
  return null;
}

function putLedger(entry) {
  live.ledger = [...live.ledger.filter((e) => e.stamp !== entry.stamp), entry];
  try {
    live.ledger = storage.saveLedger(ctx(), live.ledger);
  } catch (err) {
    console.warn(`[${MODULE}] протокол ответов не записан:`, err);
  }
}

function hasOwnMarker(text) {
  return new RegExp(MARKER_RE.source, 'i').test(String(text || ''));
}

function turnRows(before, after, exam) {
  const old = (before && before.journal) || [];
  const all = (after && after.journal) || [];
  let from = 0;
  if (old.length) {
    const last = JSON.stringify(old[old.length - 1]);
    from = all.length;
    for (let i = all.length - 1; i >= 0; i -= 1) {
      if (JSON.stringify(all[i]) === last) { from = i + 1; break; }
    }
  }
  const fresh = all.slice(from);
  const logRows = hookJournal({ ...after, journal: fresh }, live.preset, 50);
  const rows = [];
  if (exam && exam.announceOn) {
    const subject = ((after.subjects || []).find((s) => s.id === exam.subjectId) || {}).name || exam.subjectId;
    rows.push(`${subject}: ${heroGender(after, safeHeroName()) === 'm' ? 'сдавал' : 'сдавала'}, итог объявят ${formatDateOn(exam.announceOn) || exam.announceOn}`);
  }
  const taken = new Set();
  const extra = [];
  for (const e of fresh) {
    const d = e && e.kind === 'rel' && e.data;
    if (!d || !d.capped) continue;
    const direction = d.delta > 0 ? 'up' : 'down';
    const pace = PACE_WORDS[d.pace] || d.pace;
    const own = logRows.find((r) => r.kind === 'relation' && r.teacherId === d.teacherId && r.direction === direction && !taken.has(r));
    if (own) { own.capped = pace; taken.add(own); continue; }
    const who = [...(after.teachers || []), ...(after.classmates || [])].find((t) => t && t.id === d.teacherId);
    extra.push({ kind: 'relation-capped', teacher: (who && who.name) || d.teacherId, direction, pace });
  }
  const text = (r) => rowText(r, rowWords());
  const study = logRows.filter((r) => r.kind === 'grade' && r.bg).map((r) => `${r.subject} — ${r.label}`);
  if (study.length) extra.push({ kind: 'study', list: study.join('; ') });
  return [...new Set([...logRows.map(text), ...rows, ...extra.map(text)].filter(Boolean))];
}

function recordLedger(mark, before, after, { marker = false, exam = null } = {}) {
  const prev = ledgerEntry(mark);
  const tokens = prev && Array.isArray(prev.tokens) ? prev.tokens : null;
  const oldLast = (before.journal || []).at(-1);
  const journal = after.journal || [];
  const boundary = oldLast ? journal.findLastIndex((row) => JSON.stringify(row) === JSON.stringify(oldLast)) : -1;
  const relations = journal.slice(boundary + 1).filter((row) => row.kind === 'rel' && Number.isFinite(row.data?.from) && Number.isFinite(row.data?.to));
  const applied = (live.lastRun?.debug?.applied || []).filter((ev) => ev.kind === 'rel');
  const planned = (live.lastRun?.debug?.applied || []).filter((ev) => ev.kind === 'event' || ev.kind === 'event-known');
  const refused = live.lastRun?.debug?.refused || [];
  const pauses = (live.lastRun?.debug?.applied || []).filter((ev) => ev.kind === 'pause' || ev.kind === 'pause-known');
  const receipts = tokens && tokens.map((token) => {
    const ev = tokenEvent(token, lexiconOf(before, ctx()));
    if (ev?.kind === 'event') {
      const at = planned.findIndex((item) => item.name === ev.name);
      const info = at >= 0 ? planned.splice(at, 1)[0] : null;
      if (info?.kind === 'event-known') return { kind: 'event', known: true, name: ev.name };
      if (info) return { kind: 'event', id: info.id, name: info.name, from: info.from };
    }
    if (ev?.kind === 'pause') {
      const info = pauses.shift();
      if (info?.receipt) return { kind: 'pause', ...info.receipt };
      return { kind: 'pause', known: true };
    }
    if (ev?.kind === 'rel') {
      const at = applied.findIndex((item) => item.teacherId === ev.teacherId && item.delta === ev.delta);
      const info = at >= 0 ? applied.splice(at, 1)[0] : null;
      if (info?.damped) return { kind: 'rel', teacherId: ev.teacherId, applied: 0, damped: true };
      const index = relations.findIndex((row) => row.data.teacherId === ev.teacherId && (info?.capped || row.data.delta === ev.delta));
      const row = index >= 0 ? relations.splice(index, 1)[0] : null;
      return { kind: 'rel', teacherId: ev.teacherId, applied: row ? row.data.to - row.data.from : 0 };
    }
    if (ev?.kind === 'completion') {
      const row = journal.slice(boundary + 1).find((item) => item.data?.completion === ev.scope && item.data?.value === ev.value);
      const ids = row?.data?.subjectIds || [];
      return completionReceipt(before, after, ids);
    }
    if (ev?.kind === 'grade') {
      const no = refused.find((r) => r.subjectId === ev.subjectId);
      if (no) return { ...receiptOf(ev, after.calendar?.day || ''), refused: no.reason };
    }
    return receiptOf(ev, after.calendar?.day || '');
  });
  putLedger({
    ...(prev || {}),
    stamp: mark,
    rows: turnRows(before, after, exam),
    day: (after.calendar && after.calendar.day) || '',
    time: (after.calendar && after.calendar.time) || '',
    tokens,
    mode: 'live',
    receipts,
    marker,
    at: Date.now(),
  });
}

function lexiconOf(state, c) {
  return {
    ...live.preset,
    subjects: state.subjects,
    teachers: markerPeople(state),
    classmates: Array.isArray(state.classmates) ? state.classmates : [],
    candidates: Array.isArray(state.classmateCandidates) ? state.classmateCandidates : [],
    survey: state.survey,
    names: sceneNames(c),
    hooks: knownHooks(live.plot),
    preps: prepList(state, c && c.name1),
  };
}

function safeHeroName() {
  try { return String((ctx() || {}).name1 || ''); } catch { return ''; }
}

function sceneStop(state, c) {
  return stopList({ ...sceneNames(c), preset: live.preset, survey: state.survey });
}

function sceneOfTurn(state, text, tokens, mark, c) {
  const day = (state.calendar && state.calendar.day) || '';
  const time = (state.calendar && state.calendar.time) || '';
  const stop = sceneStop(state, c);
  let next = localMet(state, stripMarker(text), { stop, day, time }).state;
  const lexicon = lexiconOf(next, c);
  const source = Array.isArray(tokens) ? tokens.filter(isFactToken) : null;
  const items = source
    ? source.map((token) => ({ token, ev: tokenEvent(token, lexicon) }))
    : parseMarker(text, lexicon).events.map((ev) => ({ ev, token: tokenOf(ev) })).filter((x) => x.token);
  const featsActive = featsOn();
  const scene = items.filter((x) => x.ev && SCENE_KINDS.includes(x.ev.kind) && (featsActive || x.ev.kind !== 'feat'));
  const privateSet = Array.isArray(tokens) ? privateRefs(tokens) : null;
  if (scene.length) next = applySceneEvents(next, scene, live.preset, { src: mark, day, time, stop, heroine: c && c.name1, privateRefs: privateSet, loud: Array.isArray(tokens) ? loudOf(tokens) : null });
  next = applyNotableFacts(next, items, live.preset, {
    src: mark, day, time, heroine: c && c.name1, loud: Array.isArray(tokens) ? loudOf(tokens) : null,
  });
  const loud = Array.isArray(tokens) ? loudOf(tokens) : null;
  next = applyEventFame(next, items, live.preset, { loud, isPrivate: (x) => Boolean(privateSet && x.token && privateSet.has(factRef(x.token))) });
  next = applyLoudScene(next, items, live.preset, { src: mark, day, time, heroine: c && c.name1, loud });
  const reactions = Array.isArray(tokens) ? reactionsWithFacts(tokens, lexicon) : [];
  const replies = Array.isArray(tokens) ? repliesOf(tokens) : [];
  if (reactions.length || replies.length) {
    const facts = new Map(items.filter((x) => x.ev).map((x) => [x.token, x.ev]));
    next = applyReactions(next, mark, reactions, facts, { day, time, cap: reactionCap(live.preset), loud, replies });
  }
  if (loud !== null && next.feed) {
    next = cloneState(next);
    setLoudness(next, mark, loud);
  }
  const played = Array.isArray(tokens) ? playedRefs(live.plot, playedOf(tokens)) : [];
  if (played.length) {
    next = cloneState(next);
    markPlayed(next, mark, played);
  }
  return next;
}

function reactionsWithFacts(tokens, lexicon) {
  return reactionsOf(tokens).map((r) => ({ ...r, factText: tokenAbout(r.fact, lexicon) }));
}

function liveTurnOf(mesId, chat) {
  const turn = latestFor(mesId, chat);
  return turn && turn.before ? turn : null;
}

function entryOf(mark, turn) {
  return ledgerEntry(mark) || (turn && turn.stamp ? ledgerEntry(turn.stamp) : null);
}

function retimeLatestEntry() {
  const cal = live.state && live.state.calendar;
  if (!cal || !cal.day) return;
  const chat = chatOf();
  for (let i = chat.length - 1; i >= 0; i -= 1) {
    if (!eligible(chat[i])) continue;
    const entry = entryOf(stamp(String(chat[i].mes || '')), liveTurnOf(i, chat));
    if (entry && entry.stamp && (entry.day !== cal.day || (cal.time && entry.time !== cal.time))) {
      putLedger({ ...entry, day: cal.day, time: cal.time || entry.time });
    }
    return;
  }
}

const DAMPED_NOTE = '(повтор за день — не засчитано)';

function panelView(mesId) {
  if (!live.preset || !live.state || !live.state.started) return null;
  const chat = chatOf();
  const message = chat[mesId];
  if (!eligible(message)) return null;
  const mark = stamp(String(message.mes || ''));
  const turn = liveTurnOf(mesId, chat);
  const entry = entryOf(mark, turn);
  const uncounted = !entry && !turn && countable(mesId, chat);
  setDateShift(weekdayShiftOf(live.state));
  const lexicon = lexiconOf(live.state, ctx());
  const tokens = entry && Array.isArray(entry.tokens) ? entry.tokens : null;
  const draft = entry && entry.draft;
  return {
    date: entry ? formatDate(entry.day) : '',
    waiting: live.state.calendar && live.state.calendar.heldJump && (turn || uncounted) ? heldWaiting(live.state, live.preset) : '',
    time: entry ? entry.time : '',
    rows: entry ? entry.rows : [],
    analyzed: Boolean(tokens),
    draft: Boolean(draft),
    summary: (draft ? draft.summary : entry && entry.summary) || '',
    tokens: panelTokens((draft ? draft.tokens : tokens) || [], lexicon, entry, Boolean(draft)),
    marker: entry ? entry.marker : null,
    live: Boolean(turn) || uncounted,
    correction: Boolean(entry && entry.mode === 'late'),
    known: Boolean(entry),
    uncounted,
    busy: live.analyzing.has(mark),
    error: live.analysisErrors.get(mark) || '',
    unparsed: unparsedLeft((draft ? draft.unparsed : tokens && entry.unparsed) || [], (draft ? draft.tokens : tokens) || [],
      [...(live.state.teachers || []), ...(live.state.classmates || []), ...listCandidates(live.state)]),
    partial: Boolean(draft && draft.partial),
    labels: panelLabels(),
    invite: inviteCard(live.state, live.preset, mark),
    decisions: doneLines(live.state, live.preset, mark),
    promises: promiseCards(live.state, live.preset, mark, ctx().name1),
    heldJump: Boolean(live.state.calendar && live.state.calendar.heldJump && (turn || uncounted)),
    canUndo: Boolean(turn && turn.stamp && live.turns[live.turns.length - 1] === turn && live.undoneAt !== live.turns.length),
  };
}

function examsScheduledWords() {
  const sch = (((live.preset && live.preset.phrases) || {}).exams || {}).scheduled;
  const period = String((live.preset && live.preset.vocab && live.preset.vocab.examPeriod) || '').trim();
  if (typeof sch !== 'string' || !sch.includes('{count}') || !period) return {};
  return { rowExamsScheduled: sch.replace('{examPeriod}', period).replace(/[.\s]+$/, '').replace(/^./u, (c) => c.toUpperCase()) };
}

function rowWords() {
  const U = uiLabels(live.preset);
  return {
    rowDebt: U.rowDebt,
    rowDebtClosed: U.rowDebtClosed,
    rowJump: U.rowJump,
    rowExamMissed: U.rowExamMissed,
    ...examsScheduledWords(),
    rowReputation: U.rowReputation,
  };
}

function panelLabels() {
  const U = uiLabels(live.preset);
  return {
    course: U.classmatesTitle,
    rel: U.mesRelSection,
    pause: extraLabels(live.preset).mesPauseSection,
    feedTab: U.tabFeed,
    crowdIn: String((live.preset && live.preset.vocab && live.preset.vocab.crowdIn) || '').trim() || 'на курсе',
    heroIns: heroWords(heroGender(live.state, safeHeroName())).heroIns,
  };
}

function tokenAvatar(author) {
  const c = ctx();
  return authorAvatar(live.state, author, { heroine: c && c.name1 });
}

function panelTokens(list, lexicon, entry, isDraft) {
  const when = {
    day: (entry && entry.day) || (live.state && live.state.calendar && live.state.calendar.day) || '',
    today: (live.state && live.state.calendar && live.state.calendar.day) || '',
  };
  return list.map((t, i) => {
    if (isReactToken(t)) {
      const r = reactionOf(t, list);
      const fact = r && r.fact ? list.indexOf(r.fact) : -1;
      return {
        text: tokenText(t, lexicon), brief: '', kind: 'react', nick: Boolean(r && r.nick),
        parts: talkParts(t, lexicon),
        avatar: r ? tokenAvatar(r) : null,
        ...(fact >= 0 ? { fact, about: tokenAbout(list[fact], lexicon) } : {}),
      };
    }
    if (isReplyToken(t)) {
      const a = replyOf(t, list);
      const post = a && a.post ? list.indexOf(a.post) : -1;
      const old = a && a.feed && live.state ? postByRef(live.state, a.feed) : null;
      return {
        text: tokenText(t, lexicon), brief: '', kind: 'reply', nick: Boolean(a && a.nick),
        parts: talkParts(t, lexicon),
        avatar: a ? tokenAvatar(a) : null,
        ...(post >= 0 ? { post } : {}),
        ...(old ? { onPost: old.text } : {}),
      };
    }
    if (isPlayedToken(t) || isBullyToken(t) || isPrepToken(t)) return { text: tokenText(t, lexicon), brief: tokenText(t, lexicon), kind: 'course' };
    if (!isFactToken(t)) return { text: tokenText(t, lexicon), brief: '', kind: 'loud' };
    if (t.startsWith('new=')) return newNameToken(splitNewRole(t.slice(4)).name, isDraft);
    const ev = tokenEvent(t, lexicon);
    const known = ev?.kind === 'event' && eventKnown(ev, entry, isDraft ? null : i);
    const refused = !isDraft && ev && ev.kind === 'grade' ? entry?.receipts?.[i]?.refused : '';
    const damped = !isDraft && ev && ev.kind === 'rel' && Boolean(entry && entry.receipts && entry.receipts[i] && entry.receipts[i].damped);
    const kind = ev ? (ev.kind === 'completion' || ev.kind === 'fame' ? 'grade' : SCENE_KINDS.includes(ev.kind) ? 'course' : ev.kind) : 'other';
    const note = damped ? ` ${DAMPED_NOTE}` : refused ? ` — не записано: ${refused}` : '';
    return {
      text: tokenText(t, lexicon, { known, ...when }) + note,
      brief: tokenText(t, lexicon, { known, brief: true, ...when }) + note,
      kind,
    };
  });
}

function newNameToken(name, isDraft) {
  const head = `новое лицо: ${name}`;
  const U = uiLabels(live.preset);
  const part = U.classmatesTitle;
  if (findClassmate(live.state, name)) return { text: `${head} — уже в разделе «${part}»`, brief: head, kind: 'course' };
  if ((live.state.teachers || []).some((t) => t && isPerson(t, name))) {
    return { text: `${head} — уже в разделе «${U.teachersTitle}»`, brief: head, kind: 'course' };
  }
  const cand = listCandidates(live.state).find((c) => c && isPerson(c, name));
  if (cand) {
    if (part && U.teachersTitle) {
      const word = (s) => String(s).toLowerCase();
      const asClassmate = { as: 'classmate', label: `В ${word(part)}`, hint: part };
      const asTeacher = { as: 'teacher', label: `В ${word(U.teachersTitle)}`, hint: U.teachersTitle };
      return {
        text: `${head} — добавить?`, brief: head, kind: 'course', candidate: cand.id,
        targets: [asTeacher, asClassmate],
      };
    }
    return { text: `${head} — добавить в раздел «${part}»?`, brief: head, kind: 'course', candidate: cand.id };
  }
  return { text: isDraft ? `${head} — добавить можно после сохранения` : head, brief: head, kind: 'course' };
}

function enrichFromFound(state, id) {
  const cand = listCandidates(state).find((c) => c && c.id === id);
  if (!cand) return;
  const found = takeLoreFound(state, cand);
  if (!found) return;
  const { post: _post, lorebook: _ref, ...f } = loreFields(state, found, cand);
  Object.assign(cand, f, { source: found.source === 'canon' ? 'generated' : 'lorebook' });
}

async function confirmSceneCandidate(id, as = 'classmate') {
  if (!live.state) return { ok: false };
  const cand = listCandidates(live.state).find((c) => c && c.id === id);
  if (!cand) return { ok: false };
  if (as === 'teacher') return confirmCandidateAsTeacher(cand);
  const stop = sceneStop(live.state, ctx());
  const next = cloneState(live.state);
  enrichFromFound(next, id);
  const toHero = (listCandidates(next).find((c) => c && c.id === id) || {}).toHero || '';
  const made = confirmCandidate(next, id, live.preset, { stop });
  if (!made) return { ok: false };
  for (const t of live.turns) {
    if (!t.before) continue;
    if (findClassmate(t.before, made.name)) continue;
    const twin = listCandidates(t.before).find((c) => c && sameName(c.name, made.name));
    if (twin) { enrichFromFound(t.before, twin.id); confirmCandidate(t.before, twin.id, live.preset, { stop }); }
    else if (t === live.turns[live.turns.length - 1]) {
      const { id: _id, relation: _rel, ...fields } = made;
      addClassmate(t.before, { ...fields, ...(toHero ? { toHero } : {}), locked: false }, live.preset, { stop });
    }
  }
  await commit(next);
  await syncLorebook();
  refreshPanel();
  renderPanels();
  fillCanonPerson(made.id).catch((err) => console.warn(`[${MODULE}] канон для «${made.name}» не подобран:`, err));
  return { ok: true, id: made.id };
}

async function fillCanonPerson(id) {
  const c = ctx();
  if (!live.state || !String((live.state.survey && live.state.survey.canon) || '').trim()) return;
  const mate = (live.state.classmates || []).find((x) => x && x.id === id);
  if (!mate || mate.manner) return;
  const op = captureOperation();
  const names = sceneNames(c);
  const res = await api.findCanonCourse(live.state, live.preset, storage.apiSettings(c), c, {
    count: 1, names: [mate.name], heroName: String((c && c.name1) || ''), card: [].concat(names.char == null ? [] : names.char),
  });
  if (!isCurrent(op) || !res.ok) return;
  const p = res.people.find((x) => [x.name, ...(x.aliases || [])].some((n) => sameName(n, mate.name))) || (res.people.length === 1 ? res.people[0] : null);
  if (!p) return;
  const next = cloneState(live.state);
  const now = (next.classmates || []).find((x) => x && x.id === id);
  if (!now) return;
  const patch = {};
  for (const k of ['desire', 'problem', 'manner', 'looks']) if (!now[k] && p[k]) patch[k] = p[k];
  if (!Object.keys(patch).length) return;
  if (!updateClassmate(next, id, patch, live.preset, { locked: now.locked === true }).ok) return;
  await commit(next);
  await syncLorebook();
  refreshPanel();
  renderPanels();
}

function moveCandidateToTeachers(state, cand) {
  const list = state.classmateCandidates || [];
  const at = list.findIndex((c) => c && (c.id === cand.id || sameName(c.name, cand.name)));
  if (at >= 0) list.splice(at, 1);
  if ((state.teachers || []).some((t) => t && isPerson(t, cand.name))) return null;
  const f = loreFields(state, takeLoreFound(state, cand), cand);
  const taken = [...(state.classmates || []), ...list, ...(state.teachers || [])].map((x) => x && x.id).filter(Boolean);
  const teacher = normalizeTeacher({
    id: classmateIdOf(cand.name, taken), name: cand.name, traits: [],
    canon: f.canon ?? cand.canon, aliases: f.aliases ?? cand.aliases, post: f.post, looks: f.looks ?? cand.looks, relation: toHeroRelation(f.toHero, live.preset, true)?.relation,
    ...(f.lorebook ? { source: 'lorebook', lorebook: f.lorebook } : {}),
  }, live.preset);
  if (!Array.isArray(state.teachers)) state.teachers = [];
  state.teachers.push(teacher);
  return teacher;
}

async function confirmCandidateAsTeacher(cand) {
  const next = cloneState(live.state);
  const made = moveCandidateToTeachers(next, cand);
  if (!made) return { ok: false };
  for (const t of live.turns) {
    if (t.before && (t === live.turns[live.turns.length - 1] || listCandidates(t.before).some((c) => c && sameName(c.name, cand.name)))) {
      moveCandidateToTeachers(t.before, cand);
    }
  }
  await commit(next);
  await syncLorebook();
  refreshPanel();
  renderPanels();
  return { ok: true, id: made.id };
}

function eventKnown(ev, entry, index) {
  const receipts = (entry && Array.isArray(entry.receipts)) ? entry.receipts : [];
  if (index !== null) return Boolean(receipts[index] && receipts[index].known);
  const day = (entry && entry.day) || (live.state.calendar && live.state.calendar.day);
  const own = receipts.filter((r) => r && r.kind === 'event' && r.id).map((r) => r.id);
  return alreadyPlanned(live.state, live.preset, ev, day, own);
}

async function analyzeMessage(mesId) {
  const c = ctx();
  const chat = chatOf();
  const message = chat[mesId];
  if (!live.state || !live.state.started || !eligible(message)) return { ok: false, error: 'Здесь нечего разбирать.' };
  const text = String(message.mes || '');
  const mark = stamp(text);
  const turn = liveTurnOf(mesId, chat);
  if (live.analyzing.has(mark)) return { ok: false, error: PANEL_TEXT.analyzing };

  const epoch = live.epoch;
  const fail = (error) => {
    live.analysisErrors.set(mark, error);
    return { ok: false, error };
  };
  live.analyzing.add(mark);
  live.analysisErrors.delete(mark);
  renderPanels();
  try {
    const entry = entryOf(mark, turn);
    if (turn) turn.before = carryManual(live.state, turn.before);
    const base = turn ? turn.before : live.state;
    const prompt = buildAnalysisPrompt(base, live.preset, {
      reply: stripMarker(text),
      userText: userTextBefore(chat, mesId),
      statusLine: turn
        ? statusLine(base, live.preset)
        : [entry ? formatDate(entry.day) : '', entry ? entry.time : ''].filter(Boolean).join(', '),
      heroine: c.name1,
      cardNames: [].concat(sceneNames(c).char || []),
      exams: Boolean(turn),
      posts: Boolean(turn),
      hooks: secretaryHooks(live.plot, live.state),
      preps: prepList(base, c.name1),
      feats: featsOn() ? { ahead: turn ? 1 : 0 } : false,
    });
    const ask = () => api.complete(storage.apiSettings(c), {
      system: prompt.system,
      user: prompt.user,
      ctx: c,
      temperature: 0.2,
      maxTokens: api.TOKEN_BUDGETS.analysis,
    });
    const read = (r) => parseAnalysis(r.text, { ...lexiconOf(base, c), featsKnow: { ...featsKnow(base, turn ? 1 : 0), off: !featsOn() } }, { posts: live.legacyPosts === true });
    let res = await ask();
    let parsed = res.ok ? read(res) : null;
    if (res.ok && !parsed.found && !res.truncated && live.epoch === epoch) {
      console.warn(`[${MODULE}] секретарь ответил без метки, повтор:`, res.text);
      res = await ask();
      parsed = res.ok ? read(res) : null;
    }
    if (live.epoch !== epoch) return { ok: false, error: 'Чат сменился, пока шёл разбор.' };
    if (res.code === 'gateway') return fail('Шлюз модели не ответил. Нажмите «Разобрать» ещё раз.');
    if (!res.ok) return fail(`Разбор не удался: ${res.message || res.code}`);
    if (!parsed.found) {
      console.warn(`[${MODULE}] секретарь ответил без метки:`, res.text);
      return fail(res.truncated
        ? 'Секретарь не договорил: ответ оборвался раньше метки. Попробуйте ещё раз.'
        : 'Секретарь ответил не так, как нужно. Попробуйте ещё раз.');
    }
    const now = chatOf()[mesId];
    if (!now || stamp(String(now.mes || '')) !== mark) return { ok: false, error: 'Ответ сменился, пока шёл разбор.' };
    for (const r of parsed.rejected) console.info(`[${MODULE}] секретарь: отвергнуто: ${r.reason} | ${clip(r.raw, 120)}`);
    putLedger({
      ...(entryOf(mark, liveTurnOf(mesId, chatOf())) || { rows: [], day: '', time: '', tokens: null, marker: false }),
      stamp: mark,
      draft: { tokens: parsed.tokens, summary: parsed.summary, unparsed: unparsedNames(parsed.rejected), partial: parsed.partial === true },
      at: Date.now(),
    });
    return { ok: true, tokens: parsed.tokens, rejected: parsed.rejected };
  } catch (err) {
    console.error(`[${MODULE}] разбор ответа упал:`, err);
    return fail(`Разбор не удался: ${(err && err.message) || err}`);
  } finally {
    live.analyzing.delete(mark);
    renderPanels();
  }
}

async function writeAnalysis(mesId, tokens, summary, { molva = true } = {}) {
  const chat = chatOf();
  const message = chat[mesId];
  if (!eligible(message)) return { ok: false };
  const mark = stamp(String(message.mes || ''));
  const turn = liveTurnOf(mesId, chat);
  const prev = entryOf(mark, turn);
  const list = Array.isArray(tokens) ? [...tokens] : null;
  const words = summary === undefined ? (prev && prev.summary) || '' : summary;

  if (turn) {
    if (prev && prev.mode === 'late') await commitCorrections(mesId, undoCorrections(prev));
    putLedger({
      ...(prev || { rows: [], day: '', time: '', marker: false }),
      stamp: mark, tokens: list, mode: 'live', receipts: null, summary: list ? words : '', at: Date.now(),
    });
    await handleMessage(mesId, { source: 'analysis' });
    renderPanels();
    if (molva) molvaAfterAnalysis(mesId, mark).catch((err) => console.error(`[${MODULE}] слухи после разбора не выпущены:`, err));
    return { ok: true };
  }

  const day = (prev && prev.day) || (live.state.calendar && live.state.calendar.day) || '';
  const steps = prev ? undoCorrections(prev) : [];
  const lexicon = lexiconOf(live.state, ctx());
  const stop = sceneStop(live.state, ctx());
  const receipts = [];
  const privateSet = list ? privateRefs(list) : null;
  for (const t of list || []) {
    const ev = tokenEvent(t, lexicon);
    const step = (s) => applyCorrection(s, ev, live.preset, { day, src: mark, token: t, stop, heroine: ctx().name1, privateRefs: privateSet, loud: list ? loudOf(list) : null });
    steps.push(step);
    receipts.push(null);
  }
  let state = live.state;
  let k = 0;
  const undoCount = steps.length - (list || []).length;
  steps.forEach((fn, i) => {
    const out = fn(state);
    if (i < undoCount) state = out;
    else {
      state = out.state;
      receipts[k] = out.receipt;
      k += 1;
    }
  });
  historyApply(mesId, steps, undoCount);
  const reactions = list ? reactionsWithFacts(list, lexicon) : [];
  const replies = list ? repliesOf(list) : [];
  if (reactions.length || replies.length) {
    const facts = new Map(list.filter(isFactToken).map((t) => [t, tokenEvent(t, lexicon)]));
    const loud = loudOf(list);
    const feedStep = (s) => applyReactions(s, mark, reactions, facts, {
      day, time: (prev && prev.time) || '', cap: reactionCap(live.preset), loud, replies,
    });
    state = feedStep(state);
    historyApply(mesId, [feedStep], 1);
  }
  const played = list ? playedRefs(live.plot, playedOf(list)) : [];
  if (played.length) {
    const playStep = (s) => {
      const n = cloneState(s);
      markPlayed(n, mark, played);
      return n;
    };
    state = playStep(state);
    historyApply(mesId, [playStep], 1);
  }
  await commit(state);
  putLedger({
    ...(prev || { rows: [], time: '', marker: false }),
    stamp: mark, day, tokens: list, mode: 'late', receipts: list ? receipts : null,
    summary: list ? words : '', at: Date.now(),
  });
  setInjects({});
  await syncLorebook();
  refreshPanel();
  return { ok: true };
}

async function saveAnalysis(mesId, opts = {}) {
  const chat = chatOf();
  const message = chat[mesId];
  if (!eligible(message)) return { ok: false };
  const mark = stamp(String(message.mes || ''));
  const entry = ledgerEntry(mark);
  if (!entry || !entry.draft || live.analyzing.has(mark)) return { ok: false };
  const { tokens, summary } = entry.draft;
  const previousAnalysis = { tokens: entry.tokens || null, summary: entry.summary || '' };
  const epoch = live.epoch;
  live.analyzing.add(mark);
  renderPanels();
  try {
    if (!latestFor(mesId, chat) && countable(mesId, chat)) await handleMessage(mesId, { source: 'manual' });
    if (live.epoch !== epoch || stamp(String(chatOf()[mesId]?.mes || '')) !== mark) return { ok: false };
    const result = await writeAnalysis(mesId, tokens, summary, opts);
    if (result.ok && live.epoch === epoch) {
      putLedger({ ...ledgerEntry(mark), draft: null, previousAnalysis, unparsed: entry.draft.unparsed || [] });
    }
    return result;
  } finally {
    live.analyzing.delete(mark);
    renderPanels();
  }
}

function discardAnalysis(mesId) {
  const message = chatOf()[mesId];
  if (!eligible(message)) return { ok: false };
  const mark = stamp(String(message.mes || ''));
  const entry = ledgerEntry(mark);
  if (entry && !live.analyzing.has(mark)) putLedger({ ...entry, draft: null });
  renderPanels();
  return { ok: true };
}

async function undoAnalysis(mesId) {
  const message = chatOf()[mesId];
  if (!eligible(message)) return { ok: false };
  const mark = stamp(String(message.mes || ''));
  if (live.analyzing.has(mark)) return { ok: false };
  const entry = entryOf(mark, liveTurnOf(mesId, chatOf()));
  if (entry && entry.draft) return discardAnalysis(mesId);
  const previous = entry && entry.previousAnalysis;
  const result = await writeAnalysis(mesId, previous ? previous.tokens : null, previous ? previous.summary : '');
  if (result.ok) putLedger({ ...ledgerEntry(mark), previousAnalysis: null });
  renderPanels();
  return result;
}

function undoCorrections(entry) {
  if (!entry || !Array.isArray(entry.tokens)) return [];
  const lexicon = lexiconOf(live.state, ctx());
  const steps = [];
  for (let i = entry.tokens.length - 1; i >= 0; i -= 1) {
    const receipt = Array.isArray(entry.receipts) && entry.receipts[i]
      ? entry.receipts[i]
      : receiptOf(tokenEvent(entry.tokens[i], lexicon), entry.day);
    if (receipt) steps.push((s) => revertCorrection(s, receipt, live.preset));
  }
  const social = entry.tokens.some((t) => !isFactToken(t) || /^(?:met|clash|act|rumor|new|looks|deal-?|ach)=/.test(t));
  if (social) {
    const receipted = Array.isArray(entry.receipts) && entry.receipts.some(Boolean);
    const names = receipted ? [] : [
      ...entry.tokens.filter((t) => t.startsWith('new=')).map((t) => splitNewRole(t.slice(4)).name),
      ...entry.tokens.filter((t) => t.startsWith('act=')).flatMap((t) => { const ev = tokenEvent(t, lexicon); return ev && ev.kind === 'act' ? [ev.a, ev.b].filter(isWhoParty).map(whoPartyName) : []; }),
    ];
    const looks = receipted ? [] : entry.tokens.map((t) => tokenEvent(t, lexicon)).filter((ev) => ev && ev.kind === 'looks')
      .map((ev) => ({ ...(ev.personId ? { id: ev.personId } : { name: ev.name }), text: ev.text }));
    steps.push((s) => revertSceneSource(s, entry.stamp, names, looks));
  }
  return steps;
}

async function commitCorrections(mesId, steps) {
  if (!steps.length) return;
  let state = live.state;
  for (const fn of steps) state = fn(state);
  historyApply(mesId, steps, steps.length);
  await commit(state);
}

function historyApply(mesId, steps, undoCount) {
  for (const t of live.turns) {
    if (!t.before || !(t.mesId > mesId)) continue;
    let s = t.before;
    steps.forEach((fn, i) => {
      const out = fn(s);
      s = i < undoCount ? out : out.state;
    });
    t.before = s;
  }
}

async function editAnalysis(mesId, change) {
  const chat = chatOf();
  const message = chat[mesId];
  if (!eligible(message)) return { ok: false };
  const mark = stamp(String(message.mes || ''));
  const entry = entryOf(mark, liveTurnOf(mesId, chat));
  live.analysisErrors.delete(mark);
  if (entry && entry.draft) {
    const tokens = change([...entry.draft.tokens]);
    putLedger({ ...entry, draft: tokens === null ? null : { ...entry.draft, tokens } });
    renderPanels();
    return { ok: true };
  }
  return writeAnalysis(mesId, change(entry && Array.isArray(entry.tokens) ? entry.tokens : null));
}

function countable(mesId, chat) {
  if (mesId !== lastEligible(chat)) return false;
  const latest = live.turns[live.turns.length - 1];
  return !latest || mesId > latest.mesId;
}

function panelDiagnosis() {
  if (!live.state) return 'Плашки: семестра в этом чате нет.';
  if (!live.state.started) return 'Плашки: семестр не начат.';
  const chat = chatOf();
  const last = lastEligible(chat);
  const turn = live.turns[live.turns.length - 1];
  const parts = [`последний ответ в чате — #${last}`];
  if (!turn) parts.push('ходов Академия не помнит (ответов после обновления ещё не было)');
  else {
    const same = chat[turn.mesId] ? stamp(String(chat[turn.mesId].mes || '')) === turn.stamp : false;
    parts.push(`последний ход — #${turn.mesId}, текст ${same ? 'совпадает' : 'изменён после подсчёта'}`);
  }
  parts.push(`записей протокола: ${live.ledger.length}`);
  const trace = (live.trace || []).map((r) => `${r.event} #${r.mesId} — ${r.result}`);
  parts.push(trace.length ? `последние события: ${trace.join(', ')}` : 'событий об ответах с запуска не было');
  if (typeof document !== 'undefined') {
    parts.push(`сообщений на странице: ${document.querySelectorAll('#chat .mes[mesid]').length}`);
    parts.push(`плашек на странице: ${document.querySelectorAll('.ad-mpanel').length}`);
  }
  return `Плашки: ${parts.join('; ')}.`;
}

async function answerInviteNow(answer) {
  if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
  const pending = invitesOf(live.state).pending;
  const res = answerInvite(live.state, answer);
  if (!res.ok) return { ok: false, error: res.error };
  const last = live.turns[live.turns.length - 1];
  for (const t of live.turns) {
    if (t.before && settleInvite(t.before, pending, answer, t === last)) t.inviteKey = pending.key;
  }
  live.plot = syncInviteHook(live.plot, res.state, null);
  savePlot();
  await commit(res.state);
  setInjects({});
  refreshPanel();
  return { ok: true, answer };
}

async function answerPromiseNow(key, came) {
  if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
  const asked = invitesOf(live.state).asked.find((a) => a.key === key);
  const res = answerPromise(live.state, live.preset, key, came === true, ctx().name1);
  if (!res.ok) return { ok: false, error: res.error };
  for (const t of live.turns) {
    if (t.stamp && asked && t.stamp === asked.mark) t.promiseAnswers = [...(t.promiseAnswers || []).filter((a) => a.key !== key), { stamp: t.stamp, key, came: came === true }];
    const settled = t.before && settlePromise(t.before, live.preset, key, came === true, ctx().name1);
    if (settled) t.before = settled;
  }
  await commit(res.state);
  setInjects({});
  refreshPanel();
  return { ok: true, came: came === true };
}

const panelHost = {
  panelFor: (mesId) => panelView(mesId),
  lookFor: () => ensureLook(storage.loadSettings(ctx()), live.preset),
  analyze: (mesId) => analyzeMessage(mesId),
  saveAnalysis: (mesId) => saveAnalysis(mesId),
  discardAnalysis: (mesId) => discardAnalysis(mesId),
  dropToken: (mesId, index) => editAnalysis(mesId, (list) => dropTokenAt(list || [], index)),
  confirmCandidate: (mesId, id, as) => confirmSceneCandidate(id, as),
  answerInvite: (mesId, answer) => answerInviteNow(answer),
  answerPromise: (mesId, key, came) => answerPromiseNow(key, came),
  clearAnalysis: (mesId) => undoAnalysis(mesId),
  undoReply: async () => {
    const res = await undoLastReply();
    toast(res.ok ? 'success' : 'warning', res.ok ? res.text : res.error);
    return res;
  },
};

let panelTimer = null;

function panelsMissing() {
  if (typeof document === 'undefined' || !live.state || !live.state.started) return false;
  const chat = document.getElementById('chat');
  if (!chat) return false;
  const mes = chatOf();
  for (const node of chat.querySelectorAll('.mes[mesid]')) {
    if (node.querySelector('.ad-mpanel')) continue;
    const id = Number(node.getAttribute('mesid'));
    if (Number.isInteger(id) && eligible(mes[id]) && node.querySelector('.mes_text')) return true;
  }
  return false;
}

function renderPanels(attempt = 0) {
  if (typeof document === 'undefined') return;
  if (panelTimer) clearTimeout(panelTimer);
  panelTimer = setTimeout(() => {
    panelTimer = null;
    try {
      if (live.state && live.state.started) renderMessagePanels(panelHost);
      else clearMessagePanels();
    } catch (err) {
      console.warn(`[${MODULE}] плашки не нарисованы:`, err);
    }
    if (attempt < PANEL_RETRIES.length && panelsMissing()) {
      panelTimer = setTimeout(() => { panelTimer = null; renderPanels(attempt + 1); }, PANEL_RETRIES[attempt]);
    }
  }, attempt ? 0 : 60);
}

const PANEL_RETRIES = [400, 1500, 4000];

function watchPanels() {
  if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
  const chat = document.getElementById('chat');
  if (!chat) return;
  let timer = null;
  let misses = 0;
  new MutationObserver(() => {
    if (timer || panelTimer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        if (!panelsMissing()) misses = 0;
        else if (misses < 3) { misses += 1; renderPanels(PANEL_RETRIES.length); }
      } catch {}
    }, 500);
  }).observe(chat, { childList: true, subtree: true });
}

function maybeSitExam(state, modelSaid, dice = null, sceneText = '') {
  if (!sittableExams(state, live.preset, state.calendar.day).length) return null;
  const takenToday = state.exams.items.some((i) => i.outcome && i.day === state.calendar.day);
  if (takenToday) return null;

  const examId = modelSaid ? modelSaid.examId : sceneExamId(state, live.preset, sceneText);
  if (!examId) return null;
  const res = sitExam(state, live.preset, {
    examId,
    ...(modelSaid ? { modelSaid: modelSaid.value } : {}),
    ...(dice ? { dice } : {}),
    seed: examSeedBase(state),
    ...(typeof live.examRng === 'function' ? { rng: live.examRng } : {}),
  });
  if (!res.applied) return null;
  const injects = [...(res.state.pending || [])];
  const next = { ...res.state, pending: [] };
  return {
    state: next, injects, exam: res.exam, permission: res.permission, divergence: res.divergence,
  };
}

async function handleSwipe(mesId) {
  if (!live.preset || !live.state) return;
  const chat = chatOf();
  const message = chat[mesId];
  const turn = latestFor(mesId, chat);
  if (turn) await rollbackLatest(turn, mesId);
  const fresh = Boolean(message) && Array.isArray(message.swipes)
    && Number.isInteger(message.swipe_id) && message.swipe_id >= message.swipes.length;
  if (fresh) {
    setInjects({});
    refreshPanel();
    return;
  }
  await handleMessage(mesId, { source: 'swipe' });
}

async function undoLastReply() {
  if (!live.preset || !live.state || !live.state.started) return { ok: false, error: 'Отменять нечего: семестр не начат.' };
  const turn = live.turns[live.turns.length - 1];
  if (!turn || turn.stamp === null || live.undoneAt === live.turns.length) {
    return { ok: false, error: 'Отменять нечего: последний ответ не посчитан или уже отменён.' };
  }
  const dayOf = (s) => (s && s.calendar ? s.calendar.day : '');
  const rows = turnRows(turn.before, live.state, null);
  const [from, to] = [dayOf(live.state), dayOf(turn.before)];
  const was = turn.stamp;
  live.turns.pop();
  live.oneShot = turn.oneShotBefore;
  const before = carryManual(live.state, turn.before);
  if (turn.inviteKey) unsettleInvite(before, turn.inviteKey);
  live.lastRun = null;
  live.skipWarning = '';
  await commit(carryFeedMarks(live.state, before, was));
  live.plot = syncBullyHook(syncInviteHook(live.plot, live.state, inviteHookWords(live.state, live.preset)), ...bullyHookArgs(live.state));
  savePlot();
  live.undoneAt = live.turns.length;
  announceRollback('undo', turn.mesId);
  setInjects({});
  refreshPanel();
  renderPanels();
  const parts = rows.slice(0, 3);
  if (rows.length > 3) parts.push(`ещё ${rows.length - 3}`);
  if (from && to && from !== to) parts.push(`дата: ${formatDateOn(from) || from} → ${formatDateOn(to) || to}`);
  return { ok: true, text: `Отменено: ${parts.length ? parts.join('; ') : 'ответ без записанных перемен'}.` };
}

async function handleEdited(mesId) {
  if (!live.preset || !live.state) return;
  const chat = chatOf();
  const message = chat[mesId];
  if (!eligible(message)) return;
  const mark = stamp(String(message.mes || ''));

  const turn = latestFor(mesId, chat, { edited: true });
  if (turn) {
    if (turn.stamp === mark) return;
    await rollbackLatest(turn, mesId, 'edit');
    await handleMessage(mesId, { source: 'edited' });
    return;
  }
  const older = live.turns.find((t) => t.mesId === mesId);
  if (older && older.stamp !== mark) {
    older.stamp = mark;
    storage.saveTurns(ctx(), live.turns);
  }
}

async function handleDeleted() {
  if (!live.preset || !live.state || !live.turns.length) return;
  const chat = chatOf();
  const at = locateTurns(chat);
  const last = at.length - 1;

  if (at[last] >= 0) {
    const kept = [];
    live.turns.forEach((turn, i) => {
      if (at[i] < 0) return;
      turn.mesId = at[i];
      kept.push(turn);
    });
    live.turns = kept;
    storage.saveTurns(ctx(), live.turns);
    return;
  }

  let k = last;
  while (k > 0 && at[k - 1] < 0) k -= 1;
  const target = live.turns[k];
  const kept = [];
  for (let i = 0; i < k; i += 1) {
    if (at[i] < 0) continue;
    live.turns[i].mesId = at[i];
    kept.push(live.turns[i]);
  }
  live.turns = kept;
  live.oneShot = target.oneShotBefore;
  if (target.inviteKey) { unsettleInvite(target.before, target.inviteKey); target.inviteKey = ''; }
  await commit(carryManual(live.state, target.before));
  announceRollback('delete');
  if (live.generating) refreshSkipWarning();
  setInjects({});
  refreshPanel();
}

async function handleChatChanged() {
  const epoch = ++live.epoch;
  live.quiet = false;
  live.hookQueue = [];
  live.generating = null;
  live.skipWarning = '';
  live.lastRun = null;
  live.molvaDebug = null;
  live.loreKeyPool = [];
  live.castFails = { n: 0, skipped: 0 };
  live.lorebook = { signature: null, report: null, error: null, suggested: [], status: null, restartedFor: null };
  live.oneShot = '';
  live.undoneAt = -1;
  live.view = null;
  reloadState();
  await adoptChatPreset();
  if (live.epoch !== epoch) return;
  checkStatePreset();
  setInjects({ oneShot: armedOneShot() });
  await syncLorebook();
  refreshPanel();
}

function carryManual(live, before) {
  return carryBullying(live, carryEvents(live, carryCast(live, carryNotes(live, carryRoster(live, before)))));
}

function cardText(c) {
  try {
    const r = api.readCharacterCard(c);
    const k = r && r.ok ? r.card : null;
    return k ? [k.description, k.personality, k.scenario].filter(Boolean).join('\n').replace(/\s+/g, ' ').trim().slice(0, 1500) : '';
  } catch {
    return '';
  }
}

function personaText(c) {
  try {
    return String((c && c.powerUserSettings && c.powerUserSettings.persona_description) || '').trim().slice(0, 1500);
  } catch {
    return '';
  }
}

function feedCastInput() {
  const c = ctx();
  const state = live.state;
  return {
    preset: live.preset,
    realities: worldRealities(state, live.preset),
    calendar: calendarNames(state, live.preset),
    heroine: String((c && c.name1) || ''),
    mainNames: castMainNames(c),
    classmates: (state.classmates || []).map((p) => p && p.name).filter(Boolean),
    stop: classmateStop(),
    canon: String((state.survey && state.survey.canon) || ''),
    persona: personaText(c),
    card: cardText(c),
    charName: String((c && c.name2) || ''),
  };
}

async function ensureHeroineTemper(op) {
  const c = ctx();
  if (!live.state) return;
  const feed = live.state.feed || {};
  const persona = feed.heroineTemper ? '' : personaText(c);
  const card = feed.charRole ? '' : cardText(c);
  if (!persona && !card) return;
  try {
    const got = await api.generateCastProfile({ persona, card, heroine: String((c && c.name1) || ''), charName: String((c && c.name2) || ''), mainNames: castMainNames(c), preset: live.preset }, storage.apiSettings(c), c);
    if ((!got.temper && !got.role) || !isCurrent(op) || !live.state) return;
    const next = cloneState(live.state);
    if (got.temper) next.feed.heroineTemper = got.temper;
    if (got.role) next.feed.charRole = got.role;
    await commit(next);
  } catch (err) {
    console.warn(`[${MODULE}] нрав героини не получен:`, err);
  }
}

let castBuilding = null;

async function ensureFeedCast({ force = false, auto = false } = {}) {
  if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
  const have = feedCastOf(live.state);
  if (have.length && !force) return { ok: true, cast: have, created: false, warnings: [] };
  if (castBuilding) return castBuilding;
  const step = castAttempt(live.castFails, { manual: force || !auto });
  live.castFails = step.fails;
  if (!step.go) {
    const error = 'сборка каста приостановлена после неудач; повтор — «Пересобрать каст» или позже само';
    live.molvaDebug = { at: new Date().toISOString(), ok: false, skipped: `каст не собран: ${error}`, raw: '' };
    return { ok: false, error, code: 'paused' };
  }
  const c = ctx();
  const op = captureOperation();
  castBuilding = (async () => {
    try {
      const res = await api.generateFeedCast(feedCastInput(), storage.apiSettings(c), c);
      if (!isCurrent(op)) return chatChanged('собирался каст слухов');
      live.castFails = castResult(live.castFails, res.ok);
      if (!res.ok) {
        const raw = String(res.raw == null ? '' : res.raw).slice(0, 4000);
        const details = Array.isArray(res.details) ? res.details : [];
        console.warn(`[${MODULE}] каст не собран (${res.code || '?'}): ${res.error || ''}${details.length ? ` | ${details.join(' | ')}` : ''}${raw ? ` | ${clip(raw, 300)}` : ''}`);
        live.molvaDebug = { at: new Date().toISOString(), ok: false, skipped: `каст не собран: ${res.error || res.code || 'запрос не удался'}`, details, raw };
        return { ok: false, error: `${res.error || 'запрос не удался'}${have.length ? ' Прежний каст оставлен.' : ''}`, code: res.code, raw: res.raw };
      }
      const next = cloneState(live.state);
      const cast = setFeedCast(next, res.members);
      if (res.temper) next.feed.heroineTemper = res.temper;
      if (res.role) next.feed.charRole = res.role;
      await commit(next);
      refreshPanel();
      if (Array.isArray(res.details) && res.details.length) console.info(`[${MODULE}] каст поставлен, правки кодом: ${res.details.join(' | ')}`);
      return { ok: true, cast, created: true, warnings: res.warnings || [] };
    } catch (err) {
      if (isCurrent(op)) live.castFails = castResult(live.castFails, false);
      console.error(`[${MODULE}] каст слухов не собран:`, err);
      return { ok: false, error: `Каст не собран: ${(err && err.message) || err}` };
    } finally {
      castBuilding = null;
    }
  })();
  return castBuilding;
}

function molvaSettings() {
  const f = storage.loadSettings(ctx()).feed || {};
  return { every: everyOf(f.molvaEvery), manual: f.molvaManual === true, swear: swearOf(f.swear) };
}

const MOLVA_RAW_MAX = 12000;

const clip = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

let molvaRunning = null;

async function autoMolva(mesId, mark) {
  if (!live.state || !live.state.started || feedMuted()) return;
  if (!molvaDue(live.state, molvaSettings())) return;
  const turn = live.turns[live.turns.length - 1];
  if (!turn || turn.mesId !== mesId || turn.stamp !== mark) return;
  if ((turn.molva || []).some((d) => d.stamp === mark)) return;
  const res = await runMolva({ auto: true, mark });
  if (!res.ok) console.warn(`[${MODULE}] слухи: ${res.error}`);
}

function secretaryAuto() {
  try { return storage.loadSettings(ctx()).secretaryAuto !== false; } catch { return false; }
}

async function autoAnalyze(mesId, mark) {
  const same = () => {
    const turn = live.turns[live.turns.length - 1];
    return Boolean(turn && turn.mesId === mesId && turn.stamp === mark);
  };
  try {
    const res = await analyzeMessage(mesId);
    if (res.ok && same()) await saveAnalysis(mesId, { molva: false });
  } finally {
    if (same()) await autoMolva(mesId, mark);
  }
}

async function molvaAfterAnalysis(mesId, mark) {
  if (!live.state || !live.state.started || feedMuted() || molvaSettings().manual) return;
  if (molvaRunning) await molvaRunning.catch(() => null);
  const turn = live.turns[live.turns.length - 1];
  if (!turn || turn.mesId !== mesId || turn.stamp !== mark) return;
  const due = molvaDue(live.state, molvaSettings()) || (turn.molva || []).some((d) => d.stamp === mark);
  if (!due || !newFacts(live.state).all.length) return;
  const res = await runMolva({ auto: true, mark });
  if (!res.ok) console.warn(`[${MODULE}] слухи после разбора: ${res.error}`);
}

async function runMolva({ auto = false, mark = '' } = {}) {
  if (!live.state || !live.state.started || !live.preset) return { ok: false, error: 'семестра в этом чате нет' };
  if (molvaRunning) return { ok: false, error: 'Слухи уже обновляются — подождите немного.' };
  if (auto) {
    const worth = issueWorth(live.state, live.preset);
    if (!worth.go) {
      let occasions = [];
      try {
        occasions = planIssue(live.state, live.preset, { stop: classmateStop(), every: molvaSettings().every, auto: true }).agenda.occasions
          .map((o) => ({ id: o.id, kind: o.kind, text: clip(o.text || o.topic || o.author || '', 160) }));
      } catch { occasions = []; }
      live.molvaDebug = { at: new Date().toISOString(), auto: true, ok: true, skipped: worth.why, occasions };
      return { ok: true, posts: 0, replies: 0, quiet: true };
    }
  }
  const c = ctx();
  const op = captureOperation();
  molvaRunning = (async () => {
    try {
      const cast = await ensureFeedCast({ auto });
      if (!cast.ok) return { ok: false, error: `Каст слухов не собран: ${cast.error}` };
      if (!isCurrent(op)) return auto ? { ok: false, error: 'чат сменился' } : chatChanged('обновлялись слухи');
      await ensureHeroineTemper(op);
      if (!isCurrent(op)) return auto ? { ok: false, error: 'чат сменился' } : chatChanged('обновлялись слухи');

      const last = live.turns[live.turns.length - 1];
      const turn = last && last.stamp && (!mark || last.stamp === mark) ? last : null;
      if (auto && !turn) return { ok: false, error: 'Ответ сменился, пока собирался каст.' };
      const stamp = turn ? turn.stamp : '';

      const stop = classmateStop();
      const { work, agenda } = planIssue(live.state, live.preset, { stop, every: auto ? molvaSettings().every : 0, auto });
      if (!agenda.pool.length || !agenda.occasions.length) return { ok: false, error: 'Писать некому: в касте нет подходящих статистов.' };
      const prompt = buildMolvaPrompt(work, live.preset, agenda, { statusLine: statusLine(live.state, live.preset), swear: molvaSettings().swear, mains: { hero: c.name1, card: castMainNames(c).length ? castMainNames(c) : [].concat(c.name2 || []) } });
      const res = await api.generateMolva(prompt, storage.apiSettings(c), c);
      if (!isCurrent(op)) return auto ? { ok: false, error: 'чат сменился' } : chatChanged('обновлялись слухи');
      if (!res.ok) return { ok: false, error: `Слухи не обновились: ${res.error}` };
      if (turn && live.turns[live.turns.length - 1] !== turn) return { ok: false, error: 'Ответ сменился, пока писались слухи.' };
      if (turn && turn.stamp !== stamp) return { ok: false, error: 'Ответ сменился, пока писались слухи.' };

      const parsed = parseIssue(res.text, agenda, {
        pool: rumorAuthors(work, { stop }),
        stop,
        lovers: loversOf(work, { hero: c.name1, card: castMainNames(c).length ? castMainNames(c) : [].concat(c.name2 || []) }),
        canon: Boolean(String((live.state.survey && live.state.survey.canon) || '').trim()),
        truncated: res.truncated === true && res.endMissing !== true,
        existing: feedItemsOf(live.state).slice(-40).map((x) => x.text),
        history: feedItemsOf(live.state),
        preset: live.preset,
      });
      const cal = live.state.calendar || {};
      const out = applyIssue(work, parsed, agenda, { stamp, resetOnFail: auto, day: cal.day, time: cal.time, preset: live.preset, stop });
      for (const r of parsed.rejected) console.info(`[${MODULE}] слухи: отброшено${r.line ? ` (строка ${r.line})` : ''}: ${r.reason} | ${clip(r.raw, 120)}`);
      for (const r of parsed.warned) console.info(`[${MODULE}] слухи: замечание${r.line ? ` (строка ${r.line})` : ''}: ${r.reason} | ${clip(r.raw, 120)}`);
      live.molvaDebug = {
        at: new Date().toISOString(), auto, ok: out.ok, truncated: res.truncated === true, complete: parsed.complete,
        rows: parsed.rows, posts: out.posts, replies: out.replies,
        raw: String(res.text == null ? '' : res.text).slice(0, MOLVA_RAW_MAX),
        rejected: parsed.rejected.map((r) => ({ line: r.line || 0, reason: r.reason, raw: clip(r.raw, 160) })),
        occasions: agenda.occasions.map((o) => ({ id: o.id, kind: o.kind, text: clip(o.text || o.topic || o.author || '', 160) })),
        memory: parsed.memory.map((m) => ({ thread: m.thread, member: m.memberId, change: m.change })),
        warned: parsed.warned.map((r) => ({ line: r.line || 0, reason: r.reason, raw: clip(r.raw, 160) })),
      };
      if (!out.ok) {
        if (out.delta && turn) {
          turn.molva = [...(turn.molva || []), out.delta].slice(-DELTAS_KEPT);
          await commit(replayMolva(live.state, [out.delta]));
        }
        const why = parsed.rejected.slice(0, 2).map((r) => r.reason).join('; ');
        return { ok: false, error: res.truncated
          ? 'Модель оборвалась на середине — слухи не обновились. Попробуйте ещё раз.'
          : `Модель ответила не по форме — ни одна реплика не прошла проверку${why ? ` (${why})` : ''}. Попробуйте ещё раз; разбор — во вкладке «Отладка».` };
      }
      const before = live.state;
      const next = featsOn() ? syncFeats(replayMolva(live.state, [out.delta]), { src: stamp }) : replayMolva(live.state, [out.delta]);
      if (turn) turn.molva = [...(turn.molva || []), out.delta].slice(-DELTAS_KEPT);
      await commit(next);
      noticeMilestones(before, next);
      refreshPanel();
      return { ok: true, posts: out.posts, replies: out.replies, skipped: parsed.rejected.length, quiet: out.quiet === true };
    } catch (err) {
      console.error(`[${MODULE}] слухи не обновились:`, err);
      return { ok: false, error: `Слухи не обновились: ${(err && err.message) || err}` };
    } finally {
      molvaRunning = null;
    }
  })();
  return molvaRunning;
}

async function planLoreDigest(c) {
  try {
    const { entries } = await api.loadLoreEntries(c, (name) => lorebook.loadBook(c, name));
    live.loreKeyPool = entries.map((e) => ({ name: e.title, aliases: e.keys }));
    if (!entries.length) return '';
    const found = ((live.state && live.state.loreFound) || []).filter((p) => p.role === 'teacher');
    return loreDigest(entries, found, { people: !found.length, stop: classmateStop(), preset: live.preset });
  } catch { return ''; }
}

function classmateStop() {
  return stopList({
    ...sceneNames(ctx()),
    preset: live.preset,
    survey: (live.state && live.state.survey) || {},
  });
}

const STOP_WHO = {
  user: 'вашего персонажа',
  institution: 'заведения',
  preset: 'служебного слова пресета',
};

function stopWarnings(teachers, c, survey) {
  const stop = stopList({
    ...sceneNames(c),
    preset: live.preset,
    survey: { ...((live.state && live.state.survey) || {}), ...(survey && typeof survey === 'object' ? survey : {}) },
  });
  const { dropped } = filterPeople(teachers, stop);
  const word = (live.preset && live.preset.vocab && live.preset.vocab.teacher) || 'преподаватель';
  return dropped.map(({ item, hit }) => {
    const name = String((item && (item.name || item.id)) || '');
    if (hit.kind === 'char') {
      return `«${name}» (${word}) совпадает с карточкой «${hit.name}». Если карточка и есть этот ${word} — оставьте; если это рассказчик — переименуйте в таблице.`;
    }
    return `«${name}» (${word}) совпадает с именем ${STOP_WHO[hit.kind] || hit.kind} «${hit.name}» — переименуйте в таблице.`;
  });
}

const MACRO = 'academy';

function macroText() {
  if (live.quiet) return '';
  if (!live.preset || !live.state || !live.state.started) return '';
  try {
    return buildPrompt(live.state, live.preset, { injects: [], withMarker: false, feed: { quiet: feedMuted() || !plotSettings().background } }).status || '';
  } catch (err) {
    console.error(`[${MODULE}] {{${MACRO}}} не собран:`, err);
    return '';
  }
}

function registerMacro(c) {
  const description = 'Academy: строка состояния учёбы — день, текущее занятие, долги, балл.';
  const handler = () => macroText();
  try {
    const power = (c && c.powerUserSettings) || {};
    if (power.experimental_macro_engine && c.macros && typeof c.macros.register === 'function') {
      const category = (c.macros.category && c.macros.category.MISC) || 'misc';
      c.macros.register(MACRO, { category, description, handler });
      return 'engine';
    }
    if (c && typeof c.registerMacro === 'function') {
      c.registerMacro(MACRO, handler, description);
      return 'legacy';
    }
  } catch (err) {
    console.error(`[${MODULE}] макрос {{${MACRO}}} не зарегистрирован:`, err);
  }
  return null;
}

const host = {
  getState: () => live.state,
  panelDiagnosis: () => panelDiagnosis(),
  getReport: () => live.report,
  getPreset: () => live.preset,
  getBaseVocab: () => (live.rawPreset ? resolvePreset(live.rawPreset, heroGender(live.state, safeHeroName())).vocab : null),
  getHeroGender: () => heroGender(live.state, safeHeroName()),
  getPresets: () => ({
    active: String((live.preset && live.preset.id) || ''),
    list: live.presets.map((p) => ({ ...p })),
    notice: live.presetNotice,
    max: USER_PRESETS_MAX,
    viewing: Boolean(live.view),
  }),
  getPresetView: () => (live.view && live.preset ? { id: live.preset.id, name: presetName(live.preset.id) } : null),
  getSettings: () => storage.loadSettings(ctx()),
  getChatId: () => currentChatId(),
  getCardCast: () => {
    const c = ctx();
    const avatars = castAvatars(c);
    const group = Boolean(c && c.groupId !== undefined && c.groupId !== null);
    return {
      group,
      available: avatars.length === 1 && !group,
      title: String((c && c.name2) || ''),
      cast: avatars.length === 1 ? (castOf(avatars[0]) || null) : null,
    };
  },
  getCardCastHits: () => castClassmateHits(),
  getStartHint: () => startDayHint(),
  getConnections: () => {
    const c = ctx();
    const cm = (c && c.extensionSettings && c.extensionSettings.connectionManager) || null;
    const profiles = Array.isArray(cm && cm.profiles) ? cm.profiles : [];
    return {
      available: Boolean(c && (typeof c.generateRaw === 'function' || profiles.length)),
      service: Boolean(c && c.ConnectionManagerRequestService
        && typeof c.ConnectionManagerRequestService.sendRequest === 'function'),
      selected: String((cm && cm.selectedProfile) || ''),
      profiles: profiles
        .filter((p) => p && p.id)
        .map((p) => ({ id: String(p.id), name: String(p.name || p.id), model: String(p.model || '') })),
    };
  },
  setSettings: (patch, opts = {}) => {
    storage.saveSettings(patch, ctx());
    setInjects({});
    if (opts && opts.quiet === true) return;
    syncLorebook().then(refreshPanel).catch(() => {});
    refreshPanel();
  },
  getDebug: () => live.lastRun,
  getMolvaDebug: () => live.molvaDebug,
  getPlot: () => live.plot,
  getHeroine: () => String((ctx() && ctx().name1) || ''),
  getCharName: () => charName(),
  getFeedDraft: (ref) => (live.state ? draftHook(live.state, ref, { heroine: ctx().name1, preset: live.preset }) : null),
  markerVisibleRisk,
  getPromptDoctor: () => {
    const c = ctx();
    const settings = storage.loadSettings(c);
    const run = live.lastRun;
    const chat = chatOf();
    const last = lastEligible(chat);
    return promptDoctorView({
      prompts: c && c.extensionPrompts,
      own: Object.values(INJECT),
      markerKey: INJECT.marker,
      markerWanted: Boolean(settings.injectMarker) && settings.mode !== 'context',
      markerSeen: run ? Boolean(run.debug && run.debug.marker) : null,
      lastText: last >= 0 ? String(chat[last].mes || '') : '',
      encodeTags: markerVisibleRisk(),
    });
  },

  getDraw: () => ({ ...drawInfo(ctx(), storage.loadSettings(ctx()).draw), chat: currentChatId() }),

  getCardBooks: () => api.extraBookNames(ctx()),

  getLorebook: () => {
    const s = lorebook.settingsOf(storage.loadSettings(ctx()));
    const report = live.lorebook.report;
    return {
      enabled: s.enabled,
      name: (report && report.name) || '',
      reason: report && !report.ok ? report.reason : null,
      measure: (report && report.measure) || null,
      suggest: (report && report.plan && report.plan.suggest) || [],
      orphans: (report && report.orphans) || [],
      error: live.lorebook.error,
      status: live.lorebook.status,
    };
  },

  actions: {
    async saveCardCast(people) {
      const avatars = castAvatars(ctx());
      if (avatars.length !== 1) return { ok: false, error: 'карточка не выбрана' };
      const cast = saveCast(avatars[0], { people, source: 'manual', checked: true });
      await dropCastCandidates();
      refreshPanel();
      return { ok: true, cast };
    },

    async guessCardCast() {
      const c = ctx();
      const avatars = castAvatars(c);
      if (avatars.length !== 1) return { ok: false, error: 'карточка не выбрана' };
      const op = captureOperation();
      const res = await api.guessCardCast(live.preset, storage.apiSettings(c), c);
      if (!isCurrent(op)) return chatChanged('карточка читалась');
      if (!res.ok) return { ok: false, error: res.error || 'запрос не удался', code: res.code, raw: res.raw };
      const cast = saveCast(avatars[0], res.cast);
      await dropCastCandidates();
      refreshPanel();
      return { ok: true, cast };
    },

    async findLorePeople() {
      if (!live.state) return { ok: false, error: 'состояние не загружено' };
      const c = ctx();
      const op = captureOperation();
      const res = await api.findLorePeople(live.preset, storage.apiSettings(c), c, {
        loadBook: (name) => lorebook.loadBook(c, name),
        stop: classmateStop(),
        survey: live.state.survey,
        heroName: String((c && c.name1) || ''),
      });
      if (!isCurrent(op)) return chatChanged('читались лорбуки');
      if (!res.ok) return { ok: false, error: res.error || 'запрос не удался', code: res.code };
      const known = new Set(live.state.loreSkipped || []);
      for (const p of [...(live.state.teachers || []), ...(live.state.classmates || [])]) {
        for (const n of [p && p.name, ...((p && p.aliases) || [])]) if (n) known.add(normName(n));
      }
      const rank = { teacher: 0, peer: 1, other: 2 };
      const roster = [...(live.state.teachers || []), ...(live.state.classmates || [])].filter(Boolean);
      const bound = bindToRoster(roster, res.people);
      const people = bound.rest.filter((p) => ![p.name, ...p.aliases].some((n) => known.has(normName(n)) || roster.some((t) => isPerson(t, n))))
        .sort((a, b) => (rank[a.role] ?? 2) - (rank[b.role] ?? 2)).slice(0, 40);
      const next = cloneState(live.state);
      for (const b of bound.links) {
        const person = [...(next.teachers || []), ...(next.classmates || [])].find((x) => x && x.id === b.id);
        if (!person) continue;
        person.loreLink = b.link;
        const aliases = normalizeAliases([...(person.aliases || []), ...b.aliases], person.name);
        if (aliases.length) person.aliases = aliases;
      }
      const fromCanon = (live.state.loreFound || []).filter((p) => p.source === 'canon');
      const merged = mergeIntoCanon(fromCanon, people);
      next.loreFound = [...merged.canon, ...merged.rest].slice(0, LORE_FOUND_MAX);
      await commit(next);
      if (bound.links.length) await syncLorebook();
      refreshPanel();
      return { ok: true, count: merged.rest.length, linked: bound.links.length, books: res.books };
    },

    async unlinkLorePerson(id) {
      if (!live.state) return { ok: false, error: 'состояние не загружено' };
      const next = cloneState(live.state);
      const person = [...(next.teachers || []), ...(next.classmates || [])].find((x) => x && x.id === id);
      if (!person || !person.loreLink) return { ok: false, error: 'связи нет' };
      delete person.loreLink;
      await commit(next);
      await syncLorebook();
      refreshPanel();
      return { ok: true };
    },

    async findCanonCourse() {
      if (!live.state) return { ok: false, error: 'состояние не загружено' };
      const c = ctx();
      const names = sceneNames(c);
      const stop = classmateStop();
      const known = [];
      for (const p of [...(live.state.teachers || []), ...(live.state.classmates || []), ...listCandidates(live.state), ...(live.state.loreFound || [])]) {
        known.push(...[p && p.name, ...((p && p.aliases) || [])].filter(Boolean));
      }
      known.push(...[].concat(names.char == null ? [] : names.char));
      const count = classmateSize(live.preset);
      const op = captureOperation();
      const res = await api.findCanonCourse(live.state, live.preset, storage.apiSettings(c), c, {
        count, heroName: String((c && c.name1) || ''), known, card: [].concat(names.char == null ? [] : names.char),
      });
      if (!isCurrent(op)) return chatChanged('звали однокурсников');
      if (!res.ok) return { ok: false, error: res.error || 'запрос не удался', code: res.code };
      const seen = new Set([...known.map(normName), ...(live.state.loreSkipped || [])]);
      const people = [];
      for (const p of res.people) {
        const all = [p.name, ...p.aliases];
        if (all.some((n) => seen.has(normName(n)) || stopHit(n, stop))) continue;
        all.forEach((n) => seen.add(normName(n)));
        people.push({ ...p, role: 'peer', source: 'canon' });
      }
      const next = cloneState(live.state);
      next.loreFound = [...(live.state.loreFound || []), ...people].slice(0, LORE_FOUND_MAX);
      await commit(next);
      refreshPanel();
      return { ok: true, count: people.length };
    },

    async applyLorePeople(choices) {
      if (!live.state) return { ok: false, error: 'состояние не загружено' };
      const next = cloneState(live.state);
      const found = Array.isArray(next.loreFound) ? next.loreFound : [];
      const out = { ok: true, teachers: 0, classmates: 0, skipped: 0, errors: [], rejected: [] };
      const reject = (index, name, reason) => { out.errors.push(`${name}: ${reason}`); out.rejected.push({ index, name, reason }); };
      const done = new Set();
      const cap = Number(live.preset && live.preset.limits && live.preset.limits.maxTeachers) || 8;
      const stop = classmateStop();
      for (const ch of Array.isArray(choices) ? choices : []) {
        const p = found[ch && ch.index];
        if (!p || done.has(ch.index)) continue;
        if (ch.as === 'skip') {
          next.loreSkipped = normalizeLoreSkipped([...(next.loreSkipped || []), p.name, ...(p.aliases || [])]);
          out.skipped += 1; done.add(ch.index); continue;
        }
        if (ch.as === 'teacher') {
          if (!Array.isArray(next.teachers)) next.teachers = [];
          if (next.teachers.some((t) => sameName(t.name, p.name))) { reject(ch.index, p.name, 'уже наставник'); done.add(ch.index); continue; }
          if (next.teachers.length >= cap) { reject(ch.index, p.name, `наставников уже ${cap}, больше не помещается`); continue; }
          const taken = [...(next.classmates || []), ...next.teachers].map((x) => x && x.id).filter(Boolean);
          next.teachers.push(normalizeTeacher({
            id: classmateIdOf(p.name, taken), name: p.name, aliases: p.aliases, post: p.post, looks: p.looks, traits: [], relation: toHeroRelation(p.toHero, live.preset, true)?.relation,
            ...(p.source === 'canon' ? { canon: true, ...(p.lorebook ? { source: 'lorebook', lorebook: p.lorebook } : {}) } : { source: 'lorebook', lorebook: p.lorebook, canon: Boolean(next.survey && next.survey.canon) }),
          }, live.preset));
          out.teachers += 1; done.add(ch.index);
        } else if (ch.as === 'classmate') {
          const fromCanon = p.source === 'canon';
          const r = addClassmate(next, {
            name: p.name, aliases: p.aliases, desire: p.desire, problem: p.problem, looks: p.looks, manner: p.manner, toHero: p.toHero, canonHero: p.canonHero,
            ...(fromCanon ? { club: p.club, source: 'generated', canon: true } : { source: 'lorebook', canon: Boolean(next.survey && next.survey.canon) }),
          }, live.preset, { stop });
          if (r.ok) { out.classmates += 1; done.add(ch.index); } else { reject(ch.index, p.name, r.error || r.code); }
        }
      }
      next.loreFound = found.filter((_, i) => !done.has(i));
      await commit(next);
      await syncLorebook();
      refreshPanel();
      renderPanels();
      ensureBullyPick().catch((err) => console.warn(`[${MODULE}] зачинщик не подобран:`, err));
      return out;
    },

    async startTerm(survey, opts = {}) {
      const prev = live.state || {};
      const subjects = prev.subjects || [];
      const teachers = prev.teachers || [];
      const state = createState(live.preset, {
        survey,
        subjects,
        teachers,
        canonVocab: normalizeCanon(survey && survey.canon) && normalizeCanon(survey.canon) === normalizeCanon(prev.survey && prev.survey.canon)
          ? prev.canonVocab : undefined,
        canonLayer: normalizeCanon(survey && survey.canon) && normalizeCanon(survey.canon) === normalizeCanon(prev.survey && prev.survey.canon)
          ? prev.canonLayer : undefined,
        startDay: isDay(opts.startDay) ? opts.startDay : undefined,
        schedule: (prev.schedule && Object.keys(prev.schedule).length)
          ? prev.schedule
          : buildSchedule(subjects, live.preset),
      });
      state.started = true;
      state.examBy = EXAM_RULES.includes(prev.examBy) ? prev.examBy : 'story';
      if (PACES.includes(prev.relPace)) state.relPace = prev.relPace;
      if (prev.bullying) {
        const { on, taboo, mode, npcOk, skip } = prev.bullying;
        state.bullying = normalizeBullying({ on, taboo, mode, npcOk, skip });
      }
      forgetTurns();
      await commit(state, { flush: true });
      setInjects({ oneShot: '' });
      await syncLorebook();
      refreshPanel();
      ensureBullyPick().catch((err) => console.warn(`[${MODULE}] зачинщик не подобран:`, err));
      return { ok: true };
    },

    async generatePlan(survey) {
      const c = ctx();
      const op = captureOperation();
      const planPreset = live.rawPreset ? resolvePreset(live.rawPreset, heroGender({ survey }, c && c.name1)) : live.preset;
      const res = await api.generatePlan(survey, planPreset, storage.apiSettings(c), c, { lore: await planLoreDigest(c) });
      if (!isCurrent(op)) return chatChanged('генерировался план');
      if (!res.ok) return { ok: false, error: res.message || res.error || 'запрос не удался', raw: res.raw };
      const put = await host.actions.setSubjects(res.plan, { survey });
      if (!put.ok) return put;
      const warnings = [...(put.warnings || []), ...stopWarnings((res.plan && res.plan.teachers) || [], c, survey)];
      const partial = res.partial ? { partial: true, notice: res.notice } : {};
      if (!warnings.length) return { ok: true, ...partial };
      try {
        if (globalThis.toastr && typeof globalThis.toastr.warning === 'function') {
          globalThis.toastr.warning(warnings.join(' '), 'Academy');
        }
      } catch {}
      return { ok: true, warnings, ...partial };
    },

    async generateCanonLayer() {
      if (!live.state || !live.rawPreset) return { ok: false, error: 'состояние не загружено' };
      const canon = normalizeCanon(live.state.survey && live.state.survey.canon);
      if (!canon) return { ok: false, error: 'В анкете не указан фандом: нечего переписывать.' };
      const c = ctx();
      const op = captureOperation();
      const male = heroGender(live.state, safeHeroName()) === 'm';
      const res = await api.generateCanonLayer(live.rawPreset, live.state, storage.apiSettings(c), c, { male, timeout: 120000 });
      if (!isCurrent(op)) return chatChanged('переписывали слова мира');
      if (!res.ok) return { ok: false, error: res.error || 'запрос не удался', code: res.code };
      if (normalizeCanon(live.state.survey && live.state.survey.canon) !== canon) return { ok: false, error: 'фандом сменился — слой не применён' };
      const next = cloneState(live.state);
      next.canonLayer = res.layer;
      await commit(next, { flush: true });
      refreshPanel();
      return { ok: true, count: res.count, holidays: (res.layer.holidays || []).length, vacations: (res.layer.vacations || []).length };
    },

    async setSubjects(plan, opts = {}) {
      const prevSubjects = new Map(((live.state && live.state.subjects) || []).map((s) => [s.id, s]));
      const prevTeachers = new Map(((live.state && live.state.teachers) || []).map((t) => [t.id, t]));
      const subjects = (plan.subjects || []).map((raw) => {
        const old = prevSubjects.get(String((raw && raw.id) || '').trim());
        return normalizeSubject(old ? { ...old, ...raw } : raw);
      });
      const teachers = (plan.teachers || []).map((raw) => {
        const old = prevTeachers.get(String((raw && raw.id) || '').trim());
        return normalizeTeacher(old ? { ...old, ...raw, ...(old.looks ? { looks: old.looks } : {}) } : raw, live.preset);
      });
      const dropped = [];
      if (opts.survey) {
        const cap = Number(live.preset && live.preset.limits && live.preset.limits.maxTeachers) || 8;
        for (const old of prevTeachers.values()) {
          if (old.source !== 'lorebook') continue;
          if (teachers.some((t) => t.id === old.id || sameName(t.name, old.name))) continue;
          if (teachers.length >= cap) { dropped.push(old.name); continue; }
          teachers.push(old);
        }
      }
      const state = {
        ...live.state,
        subjects,
        teachers,
        schedule: plan.schedule || buildSchedule(subjects, live.preset),
      };
      if (opts.survey) {
        const canon = normalizeCanon(opts.survey.canon);
        state.survey = { ...(state.survey || {}), canon };
        const changed = canon !== normalizeCanon(live.state && live.state.survey && live.state.survey.canon);
        if (!canon) state.canonVocab = {};
        else if (plan.vocab) state.canonVocab = cleanCanonVocab(plan.vocab);
        else if (changed) state.canonVocab = {};
        if (!canon || changed) state.canonLayer = {};
      }
      await commit(state, { flush: true });
      setInjects({});
      await syncLorebook();
      refreshPanel();
      return dropped.length
        ? { ok: true, warnings: [`Не поместились в потолок наставников (${dropped.length}) и убраны: ${dropped.join(', ')}.`] }
        : { ok: true };
    },

    async setGender(gender) {
      if (!GENDERS.includes(gender)) return { ok: false, error: `неизвестный род «${gender}»` };
      if (!live.state) return { ok: true, gender };
      if (live.state.survey && live.state.survey.gender === gender) return { ok: true, gender };
      const next = cloneState(live.state);
      next.survey = { ...(next.survey || {}), gender };
      await commit(next);
      refreshPanel();
      return { ok: true, gender };
    },

    async setExamRule(rule) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      if (!EXAM_RULES.includes(rule)) return { ok: false, error: `неизвестное правило «${rule}»` };
      if (examRule(live.state) === rule) return { ok: true, rule };
      const next = cloneState(live.state);
      next.examBy = rule;
      await commit(next);
      refreshPanel();
      return { ok: true, rule };
    },

    async setRelPace(pace) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      if (!PACES.includes(pace)) return { ok: false, error: `неизвестный темп «${pace}»` };
      if ((live.state.relPace || 'normal') === pace) return { ok: true, pace };
      const next = cloneState(live.state);
      next.relPace = pace;
      await commit(next);
      refreshPanel();
      return { ok: true, pace };
    },

    async setBullying(patch = {}) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const next = setBullyingOptions(live.state, patch);
      await commit(next);
      live.plot = syncBullyHook(live.plot, ...bullyHookArgs(next));
      savePlot();
      setInjects({});
      refreshPanel();
      ensureBullyPick().catch((err) => console.warn(`[${MODULE}] зачинщик не подобран:`, err));
      return { ok: true };
    },

    async rePickBully() {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const res = await ensureBullyPick({ force: true });
      return res.ok ? { ok: true, status: res.status } : res;
    },

    async setBullyRole(personId, role) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const res = setBullyRole(live.state, personId, role);
      if (!res.ok) return res;
      await commit(res.state);
      live.plot = syncBullyHook(live.plot, ...bullyHookArgs(res.state));
      savePlot();
      setInjects({});
      refreshPanel();
      return { ok: true };
    },

    async analyzeMessage(mesId) {
      return analyzeMessage(Number.isInteger(mesId) ? mesId : lastEligible(chatOf()));
    },

    async setTeacherDetails(teacherId, patch = {}) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const next = cloneState(live.state);
      const teacher = (next.teachers || []).find((t) => t.id === teacherId);
      if (!teacher) return { ok: false, error: `наставника «${teacherId}» нет в списке` };
      const X = extraLabels(live.preset);
      const p = patch && typeof patch === 'object' ? patch : {};
      for (const key of Object.keys(TEACHER_TEXT_MAX)) {
        if (!(key in p)) continue;
        const value = teacherDetails({ [key]: p[key] })[key];
        if (value) teacher[key] = value;
        else delete teacher[key];
      }
      if ('traits' in p) {
        const list = Array.isArray(p.traits) ? p.traits : String(p.traits == null ? '' : p.traits).split(',');
        teacher.traits = list.map((x) => String(x == null ? '' : x).replace(/\s+/g, ' ').trim()).filter(Boolean);
      }
      if ('portrait' in p) {
        const raw = String(patch.portrait == null ? '' : patch.portrait).trim();
        if (!raw) delete teacher.portrait;
        else {
          const portrait = normalizePortrait(raw);
          if (!portrait) return { ok: false, code: 'bad-portrait', error: X.portraitBad };
          teacher.portrait = portrait;
        }
      }
      await commit(next);
      await syncLorebook();
      refreshPanel();
      return {
        ok: true,
        portrait: teacher.portrait || '',
        post: teacher.post || '',
        likes: teacher.likes || '',
        secret: teacher.secret || '',
        traits: [...(teacher.traits || [])],
      };
    },

    ensureFeedCast: () => ensureFeedCast(),

    refreshMolva: () => runMolva({}),

    rebuildFeedCast: () => ensureFeedCast({ force: true }),

    async updateFeedMember(id, patch = {}) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const next = cloneState(live.state);
      const res = updateFeedMember(next, id, patch);
      if (!res.ok) return res;
      await commit(next);
      refreshPanel();
      return res;
    },

    async addClassmate(raw = {}) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const next = cloneState(live.state);
      const res = addClassmate(next, { ...(raw && typeof raw === 'object' ? raw : {}), source: 'manual' },
        live.preset, { stop: classmateStop() });
      if (!res.ok) return res;
      await commit(next);
      await syncLorebook();
      refreshPanel();
      return res;
    },

    undoReply: () => undoLastReply(),

    async setPersonNote(id, text = '') {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const next = cloneState(live.state);
      const res = setPersonNote(next, id, text);
      if (!res.ok) return res;
      await commit(next);
      return res;
    },

    async updateClassmate(id, patch = {}) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const next = cloneState(live.state);
      const res = updateClassmate(next, id, patch, live.preset, { stop: classmateStop() });
      if (!res.ok) return res;
      await commit(next);
      await syncLorebook();
      refreshPanel();
      return res;
    },

    async setPortrait(personId, value = '') {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const X = extraLabels(live.preset);
      const raw = String(value == null ? '' : value).trim();
      const portrait = raw ? normalizePortrait(raw) : '';
      if (raw && !portrait) return { ok: false, code: 'bad-portrait', error: X.portraitBad };
      const next = cloneState(live.state);
      const person = [...(next.teachers || []), ...(next.classmates || [])].find((x) => x && x.id === personId);
      if (!person) return { ok: false, error: `человека «${personId}» нет ни среди преподавателей, ни на курсе` };
      if (portrait) person.portrait = portrait;
      else delete person.portrait;
      await commit(next);
      refreshPanel();
      return { ok: true, portrait: portrait || '' };
    },

    async uploadPortrait(personId, file) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const known = [...(live.state.teachers || []), ...(live.state.classmates || [])].some((x) => x && x.id === personId);
      if (!known) return { ok: false, error: `человека «${personId}» нет ни среди преподавателей, ни на курсе` };
      const saved = await savePortraitImage(file, { personId });
      if (!saved.ok) return saved;
      const res = await host.actions.setPortrait(personId, saved.path);
      return res.ok ? { ...res, path: saved.path } : res;
    },

    async drawPortrait(personId, opts = {}) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const teacher = (live.state.teachers || []).find((x) => x && x.id === personId);
      const classmate = teacher ? null : (live.state.classmates || []).find((x) => x && x.id === personId);
      let person = teacher || classmate;
      if (!person) return { ok: false, error: `человека «${personId}» нет ни среди преподавателей, ни на курсе` };
      const settings = storage.loadSettings(ctx());
      const subjects = teacher
        ? (live.state.subjects || []).filter((s) => s && s.teacherId === teacher.id).map((s) => String(s.name || s.id || ''))
        : [];
      await loadTavernModules();
      const op0 = captureOperation();
      if (!normalizeLooks(person.looks)) {
        const invented = await inventLooks(person, { kind: teacher ? 'teacher' : 'classmate', subjects }, opts.signal);
        if (invented && isCurrent(op0)) {
          const saved = await host.actions.setLooks(personId, invented);
          if (saved.ok && saved.looks) person = { ...person, looks: saved.looks };
        }
        if (!isCurrent(op0)) return chatChanged('рисовался портрет');
      }
      const looksTags = drawForm(ctx(), settings.draw) === 'tags' ? await looksToTags(person.looks, opts.signal) : [];
      const prompt = buildPortraitPrompt(person, {
        looksTags,
        kind: teacher ? 'teacher' : 'classmate',
        subjects,
        presetId: String((live.preset && live.preset.id) || live.state.presetId || ''),
        basedOn: String((live.preset && live.preset.basedOn) || ''),
        style: settings.draw && settings.draw.style,
        styleText: settings.draw && settings.draw.styleText,
      });
      const op = captureOperation();
      const res = await drawImage(ctx(), settings.draw, prompt, { personId, signal: opts.signal });
      if (!res.ok) return res;
      if (!isCurrent(op)) return chatChanged('рисовался портрет');
      return { ok: true, path: res.path, route: res.route };
    },

    async setLooks(personId, value = '') {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const next = cloneState(live.state);
      const person = [...(next.teachers || []), ...(next.classmates || [])].find((x) => x && x.id === personId);
      if (!person) return { ok: false, error: `человека «${personId}» нет ни среди преподавателей, ни на курсе` };
      const looks = normalizeLooks(String(value == null ? '' : value));
      if (looks) person.looks = looks;
      else delete person.looks;
      await commit(next);
      await syncLorebook();
      refreshPanel();
      return { ok: true, looks };
    },

    async removeClassmate(id) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const next = cloneState(live.state);
      const res = removeClassmate(next, id);
      if (!res.ok) return res;
      const op = captureOperation();
      await commit(next);
      await syncLorebook();
      if (isCurrent(op)) {
        try {
          await lorebook.forgetClassmate(ctx(), id, {
            settings: storage.loadSettings(ctx()),
            guard: () => isCurrent(op),
          });
          await syncLorebook({ force: true });
        } catch (err) {
          console.warn(`[${MODULE}] запись однокурсника не убрана из лорбука:`, err);
        }
      }
      refreshPanel();
      return { ok: true };
    },

    async clearClassmates() {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const next = cloneState(live.state);
      const ids = (next.classmates || []).map((c) => c.id);
      for (const id of ids) removeClassmate(next, id);
      const op = captureOperation();
      await commit(next);
      await syncLorebook();
      if (isCurrent(op) && ids.length) {
        try {
          for (const id of ids) {
            await lorebook.forgetClassmate(ctx(), id, { settings: storage.loadSettings(ctx()), guard: () => isCurrent(op) });
          }
          await syncLorebook({ force: true });
        } catch (err) {
          console.warn(`[${MODULE}] записи однокурсников не убраны из лорбука:`, err);
        }
      }
      refreshPanel();
      return { ok: true, count: ids.length };
    },

    async clearLoreFound() {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const next = cloneState(live.state);
      next.loreFound = [];
      await commit(next);
      refreshPanel();
      return { ok: true };
    },

    async addEvent(raw = {}) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const res = addEvent(cloneState(live.state), raw);
      if (!res.ok) return res;
      await commit(res.state);
      setInjects({});
      refreshPanel();
      return { ok: true, id: res.event.id };
    },

    async feedReact(id, emoji) {
      if (!live.state || !live.state.feed) return { ok: false, error: 'ленты в этом чате нет' };
      const next = cloneState(live.state);
      const mine = toggleReact(next, id, emoji);
      if (mine === null) return { ok: false, error: 'этой записи больше нет' };
      await commit(next);
      refreshPanel();
      return { ok: true, mine };
    },

    async feedRead(ids = null) {
      if (!live.state || !live.state.feed) return { ok: true, n: 0 };
      const next = cloneState(live.state);
      const n = markRead(next, ids);
      if (!n) return { ok: true, n: 0 };
      await commit(next);
      setInjects({});
      refreshPanel();
      return { ok: true, n };
    },

    async takeHook(ref, text = '') {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      if (!plotSettings().enabled) return { ok: false, error: 'поводы выключены в настройках' };
      const res = takeHook(live.plot, live.state, { ref, text, heroine: ctx().name1, preset: live.preset });
      if (!res.ok) return res;
      live.plot = res.plot;
      savePlot();
      if (res.state !== live.state) await commit(res.state);
      setInjects({});
      refreshPanel();
      return { ok: true, id: res.id };
    },

    async answerInvite(answer) {
      return answerInviteNow(answer);
    },

    async answerPromise(key, came) {
      return answerPromiseNow(key, came);
    },

    async dropHook(id) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const was = hookById(live.plot, id);
      const res = dropHook(live.plot, live.state, id);
      if (!res.ok) return { ok: false, error: 'такого повода в очереди нет' };
      live.plot = res.plot;
      savePlot();
      const next = was && was.kind === INVITE_KIND ? dropInvite(res.state) : res.state;
      if (next !== live.state) await commit(next);
      setInjects({});
      refreshPanel();
      return { ok: true };
    },

    async removeEvent(id) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const res = removeEvent(cloneState(live.state), id);
      if (!res.ok) return res;
      await commit(res.state);
      setInjects({});
      refreshPanel();
      return { ok: true };
    },

    async updateEvent(id, patch = {}) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const res = updateEventDates(cloneState(live.state), id, patch);
      if (!res.ok) return res;
      await commit(res.state);
      setInjects({});
      refreshPanel();
      return { ok: true };
    },

    async manualTime(patch = {}) {
      const shift = patch.shift && typeof patch.shift === 'object'
        ? (Number.isFinite(patch.shift.days)
          ? { unit: 'day', n: patch.shift.days }
          : { unit: 'period', n: patch.shift.periods })
        : patch.shift;
      const was = (live.state && live.state.reputation && live.state.reputation.value) || 0;
      const res = manualTime(
        live.state,
        { day: patch.day, time: patch.time, shift, count: patch.count === true },
        live.preset,
      );
      if (!res.applied) return { ok: false, error: res.reason || 'календарь не сдвинулся' };
      const before = live.state;
      const lastTurn = live.turns[live.turns.length - 1];
      const moved = cloneState(askPromises(res.state, before.calendar.day, res.state.calendar.day, (lastTurn && lastTurn.stamp) || ''));
      armHolidayHooks(moved, live.preset);
      await commit(armPending(moved));
      setInjects({});
      noticeChanges(before, live.state, { source: 'manual' });
      refreshPanel();
      const now = (res.state.reputation && res.state.reputation.value) || 0;
      const cal = live.state.calendar || {};
      return {
        ok: true,
        to: {
          day: cal.day,
          time: cal.precision === 'datetime' ? cal.time : null,
          ordinal: cal.precision === 'datetime' && Number.isInteger(cal.periodIndex) ? cal.periodIndex + 1 : null,
        },
        counted: res.counted,
        wouldCount: res.wouldCount,
        reputation: now === was ? null : { from: was, to: now },
      };
    },

    async skipToDayEnd() {
      const was = (live.state && live.state.reputation && live.state.reputation.value) || 0;
      const res = skipToDayEnd(live.state, live.preset);
      if (!res.applied) return { ok: false, error: res.reason };
      const before = live.state;
      const moved = cloneState(res.state);
      armHolidayHooks(moved, live.preset);
      await commit(armPending(moved));
      setInjects({});
      noticeChanges(before, live.state, { source: 'manual' });
      refreshPanel();
      const now = (res.state.reputation && res.state.reputation.value) || 0;
      const cal = live.state.calendar || {};
      return {
        ok: true,
        to: { day: cal.day, time: cal.time || null, ordinal: null },
        counted: res.counted,
        wouldCount: 0,
        reputation: now === was ? null : { from: was, to: now },
      };
    },

    async resolveJump(accept = true) {
      const before = live.state;
      const held = before.calendar && before.calendar.heldJump;
      const res = resolveHeldJump(live.state, live.preset, accept !== false);
      const last = live.turns[live.turns.length - 1];
      if (held && last && last.stamp && (accept === false || res.applied)) {
        last.jumpAnswer = { stamp: last.stamp, day: held.day, accept: accept !== false };
      }
      const fromDay = held && held.era ? shiftYears(before.calendar.day, held.era) : before.calendar.day;
      const asked = accept !== false && res.applied && last && last.stamp
        ? askPromises(res.state, fromDay, res.state.calendar.day, last.stamp) : res.state;
      if (accept !== false && res.applied && last && last.stamp) {
        const { day, time } = res.state.calendar;
        retimeSource(asked, last.stamp, day, time);
        for (const d of last.molva || []) if (d.stamp === last.stamp) for (const x of d.items || []) x.at = { day, time: time || (x.at && x.at.time) || '' };
      }
      await commit(armPending(asked));
      if (accept !== false && !res.applied) {
        return { ok: false, error: res.reason || 'прыжок не применился' };
      }
      setInjects({});
      if (accept !== false) retimeLatestEntry();
      noticeChanges(before, live.state, { source: 'manual' });
      refreshPanel();
      return { ok: true, counted: res.counted };
    },

    async testApi() {
      const res = await api.testConnection(storage.apiSettings(ctx()), { ctx: ctx() });
      return res.ok ? { ok: true, message: res.message } : { ok: false, error: res.message, code: res.code };
    },

    async listModels() {
      const res = await api.listModels(storage.apiSettings(ctx()));
      return res.ok
        ? { ok: true, models: res.models, via: res.via || 'browser' }
        : { ok: false, models: [], error: res.message, code: res.code };
    },

    loadDrawModels: () => loadCustomModels(storage.loadSettings(ctx()).draw),

    async syncLorebook() {
      const report = await syncLorebook({ force: true, immediately: true });
      refreshPanel();
      if (!report) return { ok: false, error: live.lorebook.error || 'книга мира выключена' };
      return report.ok ? { ok: true, name: report.name, wrote: report.wrote } : { ok: false, error: report.reason };
    },

    async suggestLorebookEntry(raw = {}) {
      if (!raw.name) return { ok: false, error: 'предложению нужно имя' };
      live.lorebook.suggested = [
        ...live.lorebook.suggested.filter((x) => x.id !== (raw.id || raw.name)),
        { id: String(raw.id || raw.name), name: String(raw.name), note: String(raw.note || ''), kind: raw.kind === 'places' ? 'places' : 'people' },
      ];
      await syncLorebook({ force: true });
      refreshPanel();
      return { ok: true };
    },

    async acceptLorebookSuggestion(uid) {
      const report = live.lorebook.report;
      const entry = ((report && report.plan && report.plan.suggest) || []).find((e) => e.uid === uid);
      if (!entry) return { ok: false, error: 'такого предложения нет' };
      const op = captureOperation();
      const res = await lorebook.acceptSuggestion(ctx(), entry, {
        settings: storage.loadSettings(ctx()),
        guard: () => isCurrent(op),
      });
      if (res.reason === lorebook.CHAT_CHANGED) return chatChanged('принималась запись лорбука');
      if (!res.ok) return { ok: false, error: res.reason };
      live.lorebook.suggested = live.lorebook.suggested.filter((x) => !uid.endsWith(`:${x.id}`));
      await syncLorebook({ force: true });
      refreshPanel();
      return { ok: true };
    },

    async pruneLorebook() {
      const orphans = (live.lorebook.report && live.lorebook.report.orphans) || [];
      if (!orphans.length) return { ok: true, removed: 0 };
      const op = captureOperation();
      const res = await lorebook.pruneOrphans(ctx(), orphans, {
        settings: storage.loadSettings(ctx()),
        guard: () => isCurrent(op),
      });
      if (res.reason === lorebook.CHAT_CHANGED) return chatChanged('чистился лорбук');
      if (!res.ok) return { ok: false, error: res.reason };
      await syncLorebook({ force: true });
      refreshPanel();
      return { ok: true, removed: res.removed };
    },

    async guessSurvey() {
      const c = ctx();
      const op = captureOperation();
      const res = await api.guessSurvey(live.preset, storage.apiSettings(c), c);
      if (!isCurrent(op)) return chatChanged('анкета заполнялась по карточке');
      if (!res.ok) return { ok: false, error: res.error || res.message || 'запрос не удался', code: res.code, raw: res.raw };
      return {
        ok: true,
        survey: res.survey,
        filled: res.filled,
        errors: res.errors,
        warnings: res.warnings,
        card: res.card,
      };
    },

    async exportState() {
      const res = storage.exportState(ctx(), live.preset, { extensionVersion: live.version || undefined });
      if (!res.ok) return { ok: false, error: res.message, code: res.code, errors: res.errors };
      return { ok: true, json: res.json, filename: res.filename, warnings: res.warnings, data: res.data };
    },

    async importState(source, opts = {}) {
      const res = await storage.importState(ctx(), source, live.preset, opts);
      if (!res.ok) {
        return {
          ok: false,
          error: res.message,
          code: res.code,
          errors: res.errors,
          needsConfirm: Boolean(res.needsConfirm),
          reasons: res.reasons || [],
          current: res.current || null,
          incoming: res.incoming || null,
          warnings: res.warnings || [],
        };
      }
      forgetTurns();
      reloadState();
      live.lastRun = null;
      live.lorebook.signature = null;
      setInjects({ oneShot: '' });
      await syncLorebook();
      refreshPanel();
      return { ok: true, replaced: res.replaced, warnings: res.warnings, status: res.status };
    },

    async setPreset(id, opts = {}) {
      const wanted = String(id || '').trim();
      if (!wanted) return { ok: false, error: 'не сказано, какой пресет ставить' };
      const active = String((live.preset && live.preset.id) || '');
      const started = Boolean(live.state && live.state.started);
      const plan = presetSwitchPlan({
        started, confirm: opts.confirm === true, viewOnly: opts.viewOnly === true, wanted, active,
        chatId: String((live.state && live.state.presetId) || ''), viewing: Boolean(live.view),
      });
      if (plan === 'same') return { ok: true, changed: false };
      if (plan === 'end-view') { endPresetView(); return { ok: true, changed: true, preset: wanted, viewOnly: false }; }
      if (plan === 'view') {
        const op = captureOperation();
        let next;
        try {
          next = await loadPreset(wanted);
        } catch (err) {
          return { ok: false, error: `пресет ${wanted} не загрузился: ${(err && err.message) || err}` };
        }
        if (!isCurrent(op)) return chatChanged('загружался пресет');
        if (!live.view) live.view = { raw: live.rawPreset, presets: live.presets };
        live.preset = next;
        live.presets = await loadPresetList(next);
        refreshPanel();
        return { ok: true, changed: true, preset: wanted, viewOnly: true };
      }
      if (plan === 'ask') {
        const vocab = (live.preset && live.preset.vocab) || {};
        const question = {
          title: fill(PRESET_TEXT.switchTitle, { to: presetName(wanted) }),
          note: fill(PRESET_TEXT.switchNote, { teachers: vocab.teacherPlural || 'преподаватели' }),
        };
        return {
          ok: false,
          code: 'needs-confirm',
          needsConfirm: true,
          canView: true,
          question,
          error: `${question.title} ${question.note}`,
          reasons: [question.note],
          current: storage.stateSummary(live.state),
          incoming: null,
        };
      }

      const op = captureOperation();
      let next;
      try {
        next = await loadPreset(wanted);
      } catch (err) {
        return { ok: false, error: `пресет ${wanted} не загрузился: ${(err && err.message) || err}` };
      }
      if (!isCurrent(op)) return chatChanged('загружался пресет');

      live.presetNotice = '';
      live.view = null;
      await switchPreset(wanted, next);
      return { ok: true, changed: true, preset: wanted };
    },

    async exportPreset(id) {
      const wanted = String(id || (live.preset && live.preset.id) || '');
      let preset;
      try {
        preset = await loadPreset(wanted);
      } catch (err) {
        return { ok: false, error: `пресет ${wanted} не выгрузился: ${(err && err.message) || err}` };
      }
      const envelope = presetEnvelope(preset, { extensionVersion: live.version || undefined });
      return { ok: true, json: JSON.stringify(envelope, null, 2), filename: presetFilename(preset) };
    },

    async previewPreset(source) {
      const res = await readAndNormalize(source);
      if (!res.ok) return res;
      return {
        ok: true,
        summary: { ...presetSummary(res.preset), id: res.id, name: res.name },
        renamed: res.renamed,
        warnings: res.warnings,
        full: storage.listUserPresets(ctx()).length >= USER_PRESETS_MAX,
        max: USER_PRESETS_MAX,
      };
    },

    async importPreset(source, opts = {}) {
      const res = await readAndNormalize(source);
      if (!res.ok) return res;
      const c = ctx();
      if (storage.listUserPresets(c).length >= USER_PRESETS_MAX) {
        return { ok: false, code: 'full', error: fill(PRESET_TEXT.full, { max: USER_PRESETS_MAX }) };
      }
      storage.putUserPreset(c, { ...res.preset, id: res.id, displayName: res.name });
      live.presets = await loadPresetList(live.preset);
      if (opts.apply !== true) {
        refreshPanel();
        return { ok: true, added: res.id, name: res.name, warnings: res.warnings };
      }
      const applied = await host.actions.setPreset(res.id, { confirm: opts.confirm === true });
      return { ...applied, added: res.id, name: res.name, warnings: res.warnings };
    },

    async deletePreset(id, opts = {}) {
      const wanted = String(id || '').trim();
      if (!wanted) return { ok: false, error: 'не сказано, какой пресет удалять' };
      if (PRESET_IDS.includes(wanted)) return { ok: false, code: 'builtin', error: PRESET_TEXT.deleteBuiltin };
      const c = ctx();
      const raw = storage.getUserPreset(c, wanted);
      if (!raw) return { ok: false, code: 'missing', error: fill(PRESET_TEXT.deleteMissing, { id: wanted }) };

      const active = String((live.preset && live.preset.id) || '');
      const fallback = PRESET_IDS.includes(raw.basedOn) ? raw.basedOn : DEFAULT_BASE;
      const started = Boolean(live.state && live.state.started);
      if (wanted === active && started && opts.confirm !== true) {
        const text = fill(PRESET_TEXT.deleteActive, { name: presetName(wanted), fallback: presetName(fallback) });
        return {
          ok: false,
          code: 'needs-confirm',
          needsConfirm: true,
          error: text,
          reasons: [text],
          current: storage.stateSummary(live.state),
          incoming: null,
        };
      }

      const name = presetName(wanted);
      storage.removeUserPreset(c, wanted);
      live.presets = await loadPresetList(wanted === active ? null : live.preset);
      if (wanted !== active) {
        refreshPanel();
        return { ok: true, removed: wanted };
      }
      const op = captureOperation();
      let next;
      try {
        next = await loadPreset(fallback);
      } catch (err) {
        return { ok: false, error: `пресет удалён, но ${fallback} не загрузился: ${(err && err.message) || err}` };
      }
      if (!isCurrent(op)) return chatChanged('загружался пресет');
      await switchPreset(fallback, next);
      announce(fill(PRESET_TEXT.deletedFallback, { name, fallback: presetName(fallback) }));
      refreshPanel();
      return { ok: true, removed: wanted, fallback };
    },

    async refresh() { reloadState(); refreshPanel(); },

    async endPresetView() { endPresetView(); return { ok: true }; },
  },
};

for (const [name, fn] of Object.entries(host.actions)) {
  if (typeof fn !== 'function' || keepsPresetView(name)) continue;
  host.actions[name] = (...args) => { endPresetView(); return fn(...args); };
}

function refreshPanel() {
  if (live.panel && typeof live.panel.render === 'function') live.panel.render();
  renderPanels();
}

function markerVisibleRisk() {
  const power = ctx().powerUserSettings || {};
  return Boolean(power.encode_tags);
}

async function init() {
  api.warmCharLore();
  const c = ctx();
  loadTavernModules().catch(() => {});
  const settings = storage.loadSettings(c);
  const wanted = aliasPresetId(String(settings.preset || DEFAULT_BASE));
  if (wanted !== settings.preset && settings.preset) storage.saveSettings({ preset: wanted }, c);

  try {
    live.preset = await loadPreset(wanted);
  } catch (err) {
    console.error(`[${MODULE}] пресет ${wanted} не загружен:`, err);
    if (wanted === DEFAULT_BASE) {
      console.error(`[${MODULE}] расширение молчит целиком`);
      return;
    }
    const raw = safeUserPreset(c, wanted);
    const fallback = raw && PRESET_IDS.includes(raw.basedOn) ? raw.basedOn : DEFAULT_BASE;
    try {
      live.preset = await loadPreset(fallback);
      storage.saveSettings({ preset: fallback }, c);
    } catch (err2) {
      console.error(`[${MODULE}] пресет не загружен, расширение молчит:`, err2);
      return;
    }
    const why = err && err.code === 'missing' ? PRESET_TEXT.whyMissing : fill(PRESET_TEXT.whyBroken, { error: (err && err.message) || err });
    announce(fill(PRESET_TEXT.startFallback, { id: wanted, why, fallback: presetName(fallback) }));
  }

  live.version = await loadVersion();
  live.presets = await loadPresetList(live.preset);
  reloadState();
  await adoptChatPreset();
  if (!live.presetNotice) checkStatePreset();

  try {
    const ui = await import('./ui.js');
    live.panel = ui.mountPanel(host);
    ui.mountButton(host);
    ui.mountSettings(host);
  } catch (err) {
    console.error(`[${MODULE}] панель не смонтирована:`, err);
  }

  try {
    const cmd = await import('./commands.js');
    const names = cmd.registerCommands(host, c);
    if (names.length) console.log(`[${MODULE}] команды: ${names.map((n) => `/${n}`).join(', ')}`);
  } catch (err) {
    console.error(`[${MODULE}] слэш-команды не зарегистрированы:`, err);
  }

  const ev = c.eventSource;
  const t = c.event_types;
  ev.on(t.MESSAGE_RECEIVED, (mesId, type) => traced(`ответ${type ? ` (${type})` : ''}`, mesId, () => handleMessage(mesId)));
  ev.on(t.MESSAGE_SWIPED, (mesId) => traced('свайп', mesId, () => handleSwipe(mesId)));
  ev.on(t.MESSAGE_EDITED, (mesId) => traced('правка', mesId, () => handleEdited(mesId)));
  ev.on(t.MESSAGE_UPDATED, (mesId) => traced('обновление', mesId, () => handleEdited(mesId)));
  ev.on(t.MESSAGE_DELETED, () => handleDeleted());
  ev.on(t.CHAT_CHANGED, () => handleChatChanged());
  for (const name of ['CHARACTER_MESSAGE_RENDERED', 'MESSAGE_RECEIVED', 'GENERATION_ENDED', 'MORE_MESSAGES_LOADED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'CHAT_CHANGED']) {
    if (t[name]) ev.on(t[name], () => renderPanels());
  }
  watchPanels();
  if (t.GENERATION_STARTED) ev.on(t.GENERATION_STARTED, (type, params, dryRun) => handleGenerationStarted(type, params, dryRun));
  if (t.MESSAGE_SENT) {
    ev.on(t.MESSAGE_SENT, (mesId) => handlePlayerSent(mesId).catch((err) => {
      console.error(`[${MODULE}] реплика #${mesId}: поводы не обновлены:`, err);
    }));
  }
  if (t.GENERATION_ENDED) ev.on(t.GENERATION_ENDED, () => handleGenerationEnded());
  if (t.GENERATION_STOPPED) ev.on(t.GENERATION_STOPPED, () => handleGenerationEnded());

  live.macro = registerMacro(c);

  setInjects({ oneShot: armedOneShot() });
  refreshPanel();
  console.log(`[${MODULE}] готово, папка ${EXT_NAME}`);
}

const API_VERSION = 1;

function apiSafe(fn, fallback = null) {
  try {
    if (!live.preset) return fallback;
    const out = fn();
    return out === undefined ? fallback : out;
  } catch (err) {
    console.warn(`[${MODULE}] AcademyAPI:`, err);
    return fallback;
  }
}

const AcademyAPI = Object.freeze({
  apiVersion: API_VERSION,
  events: HOOK_EVENTS,
  get version() { return live.version || ''; },
  now: () => apiSafe(() => hookNow(live.state)),
  today: () => apiSafe(() => hookToday(live.state, live.preset)),
  summary: () => apiSafe(() => hookSummary(live.state, live.preset), ''),
  journal: (n = 10) => apiSafe(() => hookJournal(live.state, live.preset, n), []),
  milestones: () => apiSafe(() => (live.state && live.state.started
    ? worldMilestones(live.state).map((m) => ({
      id: m.id, kind: m.feat || 'moment', name: m.name, desc: m.desc, emoji: m.emoji, rarity: m.rarity, when: m.when || null,
    }))
    : []), []),
});

try {
  globalThis.AcademyAPI = AcademyAPI;
} catch (err) {
  console.warn(`[${MODULE}] AcademyAPI не повешен на window:`, err);
}

const ready = init();

export const __seam = { host, live, ready, api: AcademyAPI, examSeedBase, panel: panelHost };

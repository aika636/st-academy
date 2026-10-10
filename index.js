/**
 * academy — интеграция с SillyTavern.
 *
 * Здесь нет ни одного правила игры: календарь, зачётка, посещаемость и сессия
 * живут в `core/`, строка состояния — в `prompt.mjs`, хранение — в `storage.js`,
 * запросы — в `api.js`, отрисовка — в `ui.js`. Этот файл только сшивает их с
 * событиями таверны и следит за тем, чтобы один ответ модели был посчитан ровно
 * один раз.
 *
 * Всё, что известно про таверну 1.18.0, проверено по исходнику и записано в
 * `etap2-st-facts.md`; здесь на эти факты только ссылки.
 */

import { applyResponse, sitExam, timeSkipWarning } from './core/engine.mjs';
import { buildPrompt, statusLine } from './prompt.mjs';
import {
  awaitingAnnouncement, gradeInfo, isPassing, kindOf, publicView, sittableExams, EXAM_RULES, examRule,
} from './core/exams.mjs';
import {
  buildAnalysisPrompt, parseAnalysis, effectiveText, tokenText, tokenEvent, tokenOf,
  dropTokenAt, reactionsOf, reactionOf, isFactToken, isReactToken, isPlayedToken, playedOf, loudOf, privateRefs,
  unparsedNames, repliesOf, replyOf, isReplyToken, tokenAbout, talkParts,
} from './core/analysis.mjs';
import { applySceneEvents, applyNotableFacts, applyLoudScene, applyReactions, localMet, revertSceneSource, SCENE_KINDS } from './core/scene.mjs';
import {
  reactionCap, carryFeedMarks, rememberFeedMarks, markRead, markPlayed, setLoudness, toggleReact, postByRef,
  feedItems as feedItemsOf,
} from './core/feed.mjs';
import {
  tickMolva, molvaDue, everyOf, planIssue, buildMolvaPrompt, parseIssue, applyIssue, replayMolva, DELTAS_KEPT,
} from './core/molva.mjs';
import {
  emptyPlot, takeHook, dropHook, draftHook, hookPrompt, onGeneration, onPlayerSent, onReply, expireHooks,
  secretaryHooks, knownHooks, playedRefs, autoPick, isMuted, quietScene, HOLIDAY_KIND,
} from './core/plot.mjs';
import { applyCorrection, revertCorrection, receiptOf, completionReceipt } from './core/corrections.mjs';
import { MARKER_RE, stripMarker, parseMarker } from './core/parse-marker.mjs';
import {
  cloneState, createState, defaultStartDay, isDay, normalizePortrait,
  normalizeSubject, normalizeTeacher, TEACHER_TEXT_MAX, teacherDetails,
} from './core/state.mjs';
import { readTime } from './core/time-source.mjs';
import { readDiceRoll, readTimeSkip, readPhoneTurn } from './core/cues.mjs';
import { diffMilestones, milestoneName, milestones, recordTally } from './core/milestones.mjs';
import { stopList, filterPeople, stopHit } from './core/stop-names.mjs';
import { normalizeCast, castNames, guessCastLocal } from './core/card-cast.mjs';
import { addClassmate, updateClassmate, removeClassmate } from './core/classmates.mjs';
import { castOf as feedCastOf, setCast as setFeedCast, updateMember as updateFeedMember, carryCast, worldRealities, calendarNames, rumorAuthors } from './core/feed-cast.mjs';
import { markerPeople, confirmCandidate, listCandidates, findClassmate, sameName, carryRoster } from './core/classmates.mjs';
import { buildSchedule } from './core/schedule.mjs';
import { manualTime, resolveHeldJump } from './core/engine.mjs';
import { alignToGrid } from './core/time.mjs';
import { addEvent, removeEvent, armHolidayHooks, alreadyPlanned } from './core/holidays.mjs';
import {
  BUILTIN_PRESETS, DEFAULT_BASE, USER_PRESETS_MAX, freeId, freeName, normalizePreset,
  presetEnvelope, presetFilename, presetSummary, readPresetFile,
} from './core/preset.mjs';
// Вью панели — для пробного прогона чужого пресета (`PRESET_PROBES`). `ui.js`
// и так уже загружен статически через `storage.js`, так что ни риска, ни цены
// этот импорт не добавляет; монтирование панели по-прежнему ленивое.
import {
  extraLabels, fill, formatDate, gradebookView, hookJournal, hookNow, hookSummary, hookToday, playChime,
  promptDoctorView, todayView, PRESET_TEXT, uiLabels,
} from './ui.js';
import { renderMessagePanels, clearMessagePanels, rowText, PANEL_TEXT } from './mes-panel.js';
import { authorAvatar } from './core/masks.mjs';
import { savePortraitImage } from './portraits.js';
import { drawImage, drawInfo, loadTavernModules } from './draw.js';
import { buildPortraitPrompt } from './core/draw-prompt.mjs';
import { normalizeLooks } from './core/portraits.mjs';
import * as storage from './storage.js';
import * as api from './api.js';
import * as lorebook from './lorebook.js';

/** Имя папки расширения. Не хардкодится: папку переименовывают при установке. */
const EXT_NAME = (() => {
  const m = /\/scripts\/extensions\/(.+)\/index\.js/.exec(import.meta.url);
  return m ? m[1] : 'third-party/academy';
})();

const MODULE = 'academy';

/**
 * Пресеты, лежащие в папке. Список живёт в `core/preset.mjs` (по нему же
 * решается, чей `id` занят при загрузке своего пресета), здесь — только
 * псевдоним: панель про файлы ничего не знает, а `id` — это имя файла.
 * Отображаемые имена берутся из самих пресетов (`displayName`) — слова
 * заведения в код не едут.
 */
const PRESET_IDS = BUILTIN_PRESETS;

/** Ключи инжектов. Три разных: постоянный, инструкция и одноразовый (3.3, 3.5). */
const INJECT = {
  status: 'academy_status',
  marker: 'academy_marker',
  oneShot: 'academy_oneshot',
};

const ctx = () => SillyTavern.getContext();

/** Живое состояние вкладки: пресет, семестр и история ходов. */
const live = {
  preset: null,
  state: null,
  report: null,
  /**
   * История последних посчитанных ходов (ремонт 9.1.1): `{mesId, stamp, before,
   * oneShotBefore, oneShot}`. Зеркало `chat_metadata.academy_turns` — пишется
   * вместе с состоянием при каждом `commit`, поэтому переживает F5. Раньше здесь
   * были `snapshots: Map` по голому индексу и `applied` в памяти: после
   * перезагрузки откатывать было не к чему, а удаление сообщения из середины
   * сдвигало индексы и откатывало ход, которого никто не трогал (9.1.6).
   * Как ход находит своё сообщение — см. `findTurn`.
   */
  turns: [],
  /**
   * Протокол ответов (`storage.js`, «протокол ответов»): что записано из
   * каждого ответа и выводы секретаря — по отпечатку текста сообщения.
   */
  ledger: [],
  /** Отпечатки ответов, которые секретарь читает прямо сейчас. */
  analyzing: new Set(),
  /** Отказ последнего разбора по отпечатку ответа — словами для плашки. */
  analysisErrors: new Map(),
  /**
   * Одноразовый факт, взведённый для СЛЕДУЮЩЕЙ генерации ответа (3.5, ремонт
   * 9.1.2). Держится отдельно от того, что сейчас лежит в `setExtensionPrompt`:
   * на время фоновой генерации инжекты гасятся, а взведённое остаётся (9.1.3).
   */
  oneShot: '',
  /**
   * Очередь поводов «Взять в сюжет» (шаг 4, `core/plot.mjs`). Живёт рядом с
   * состоянием, в `chat_metadata.academy_plot`, и снимком хода не
   * откатывается: свайп повод не тратит и не теряет.
   */
  plot: emptyPlot(),
  /** Идёт фоновая (`quiet`) генерация соседа: инжекты погашены (ремонт 9.1.3). */
  quiet: false,
  /**
   * Тип идущей обычной генерации (`GENERATION_STARTED`) или `null`. Нужен
   * одному месту: регенерация срезает ответ ПОСЛЕ старта (ремонт, факт 2), и
   * предупреждение промотки пересчитывается по откаченному состоянию уже в
   * `handleDeleted` — но только если генерация действительно идёт.
   */
  generating: null,
  /**
   * Одноразовая строка к идущей генерации после промотки времени (9.2):
   * «промотка не может перешагнуть контрольное DD.MM». Отдельно от `oneShot`:
   * тот — функция истории ходов и переживает F5, а эта — функция реплики
   * человека и живёт ровно одну генерацию.
   */
  skipWarning: '',
  /**
   * Счётчик смен чата (ремонт 9.1.4). Долгие `await` (генерация плана,
   * автоанкета, лорбук) сверяют его до и после: ответ, пришедший в другой чат,
   * не применяется. См. `captureOperation`.
   */
  epoch: 0,
  panel: null,
  lastRun: null,
  /** Последний выпуск молвы: сырой ответ модели и причины отброса — для вкладки «Отладка». */
  molvaDebug: null,
  /**
   * Лорбук (3.7). `signature` — отпечаток того, чем лорбук должен быть; пока он
   * не изменился, в World Info не ходят вовсе. `suggested` — предложения про
   * NPC и места: они живут в памяти вкладки и в лорбук сами не попадают.
   */
  lorebook: { signature: null, report: null, error: null, suggested: [] },
  /** Список пресетов для выбора в панели: `[{id, name, user?, broken?}]`. */
  presets: [],
  /**
   * Прочитанные встроенные пресеты по `id`. Нужны не только для выбора: свой
   * пресет человека ложится поверх встроенного (`core/preset.mjs`, решение 2),
   * и основа должна быть под рукой без похода за файлом на каждую нормализацию.
   */
  builtins: {},
  /**
   * Что случилось с пресетом, о чём человек должен узнать из панели, а не из
   * консоли: «пресет удалён — включён встроенный» (9.3.2). Живёт до следующей
   * смены пресета.
   */
  presetNotice: '',
  /** Версия из `manifest.json` — единственная правда о ней (см. `storage.js`). */
  version: '',
  /** Куда зарегистрирован `{{academy}}`: `'engine'`, `'legacy'` или `null` (9.3.1). */
  macro: null,
  /**
   * Вехи, о которых человеку уже сказали тостом (9.4.2). В памяти вкладки, а
   * не в состоянии: вехи — чистый пересчёт (`core/milestones.mjs`, решение 1),
   * и хранить «показанное» в чате значило бы чинить его на каждом свайпе.
   * Отозванная веха отсюда НЕ вычёркивается нарочно: отношение, колеблющееся
   * у порога «любимицы», иначе давало бы тост на каждый второй ответ. Заново
   * засевается при смене чата и замене состояния (`primeMilestones`).
   */
  shownMilestones: new Set(),
  /**
   * События `academy:*`, отложенные на время фоновой генерации соседа (9.1.3):
   * во время `quiet` наружу не уходит ничего, после — всё по порядку.
   */
  hookQueue: [],
  /**
   * Шов для прогона: подставной источник случайности броска экзамена. В
   * таверне всегда `null` — бросок идёт от seed (`examSeedBase`). Тестам,
   * которым нужен «зажатый» бросок, раньше хватало подмены `Math.random`; с
   * seed она больше ни на что не влияет, и нужен явный вход.
   */
  examRng: null,
  /** Звук вехи. Шов: прогон подменяет его счётчиком — WebAudio в Node нет. */
  chime: playChime,
};

// --- пресет -----------------------------------------------------------------

/**
 * Встроенный пресет читается файлом из папки расширения. Своих правил у
 * `index.js` нет: если пресет не читается, расширение молчит целиком, а не
 * играет умолчаниями.
 */
async function loadBuiltin(id) {
  if (live.builtins[id]) return live.builtins[id];
  const url = `/scripts/extensions/${EXT_NAME}/presets/${id}.json`;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`пресет ${id} не читается: HTTP ${res.status}`);
  const p = await res.json();
  live.builtins[id] = p;
  return p;
}

/** Все встроенные, какие читаются. Промах одного — не повод терять остальные. */
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

/**
 * Дополнительные шаги пробного прогона чужого пресета (`core/preset.mjs:
 * probePreset`): строка состояния и два главных экрана панели. Ядро про них
 * не знает, а упасть на пресете они могут ровно так же — и лучше при загрузке
 * файла, чем посреди игры.
 */
const PRESET_PROBES = [
  function statusLine(state, preset) { buildPrompt(state, preset, { injects: [], withMarker: true }); },
  function today(state, preset) { todayView(state, preset); },
  function gradebook(state, preset) { gradebookView(state, preset); },
];

/** Отказ «такого пресета нет» — отдельным кодом: на нём держится откат (9.3.2). */
function missingPreset(id) {
  const err = new Error(`пресета «${id}» нет ни среди встроенных, ни среди своих`);
  err.code = 'missing';
  return err;
}

/**
 * Пресет по `id`: встроенный — файлом, свой — из настроек через
 * `normalizePreset`. Нормализация идёт при каждой загрузке, а не только при
 * импорте (`core/preset.mjs`, решение 2): пресет в настройках — снимок, и
 * ключи, которые встроенные пресеты получили после его сохранения, доезжают
 * до него только так.
 */
async function loadPreset(id = DEFAULT_BASE) {
  if (PRESET_IDS.includes(id)) return loadBuiltin(id);
  const raw = storage.getUserPreset(ctx(), id);
  if (!raw) throw missingPreset(id);
  const builtins = await ensureBuiltins();
  const res = normalizePreset(raw, { builtins, basedOn: raw.basedOn, probe: PRESET_PROBES });
  if (!res.ok) throw new Error(res.message);
  // `id` — ключ, под которым пресет лежит: на него ссылаются чаты.
  return { ...res.preset, id };
}

/**
 * Имена пресетов для выбора в панели: встроенные, потом свои.
 *
 * По одному отдельному промаху не роняется: встроенный пресет, файл которого
 * не прочитался, в списке остаётся под своим `id`. Выбрать его всё равно
 * можно — и тогда отказ придёт в ответ на выбор, текстом рядом с кнопкой, а не
 * пустым списком, из которого не видно, что вообще случилось. Свои пресеты
 * здесь не нормализуются (это пробный прогон на каждый) — только имена.
 */
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
    if (PRESET_IDS.includes(p.id)) continue; // встроенный не подменяется своим никогда
    out.push({ id: p.id, name: p.name, user: true, basedOn: p.basedOn });
  }
  return out;
}

/** Всплывашка таверны. Вежливость, а не условие: без `toastr` всё работает. */
function toast(kind, text, title = 'Academy') {
  try {
    if (globalThis.toastr && typeof globalThis.toastr[kind] === 'function') globalThis.toastr[kind](text, title);
  } catch { /* не условие работы */ }
}

/** Свой пресет из настроек или `null` — без исключений (запуск, откат). */
function safeUserPreset(c, id) {
  try { return storage.getUserPreset(c, id); } catch { return null; }
}

/** Отображаемое имя пресета по `id` — из списка, иначе сам `id`. */
function presetName(id) {
  const hit = live.presets.find((p) => p.id === id);
  if (hit) return hit.name;
  const b = live.builtins[id];
  return String((b && (b.displayName || b.name)) || id);
}

/**
 * Пресет, на который ссылается чат, исчез (9.3.2: «удалённый пресет → откат на
 * встроенный с сообщением»). Сообщение уходит и всплывашкой, и строкой в
 * панель: всплывашку легко проморгать, а панель человек откроет, когда
 * заметит, что слова стали другими.
 */
function announce(text) {
  live.presetNotice = text;
  toast('warning', text);
}

/**
 * Чат заведён пресетом, которого больше нет ни среди встроенных, ни среди
 * своих. Состояние не переписывается: пресет могли удалить по ошибке и
 * загрузить обратно тем же файлом — тогда всё встанет как было. Играет чат
 * активным пресетом, и человек должен это знать: всплывашкой при открытии
 * чата, а строка в панели считается самой панелью (`ui.js: presetsView`) —
 * она про этот чат, а не про пресет, и хранить её в `live` значило бы
 * протащить её в следующий чат.
 */
function checkStatePreset() {
  const id = String((live.state && live.state.presetId) || '');
  if (!id || !live.preset || id === live.preset.id) return false;
  if (live.presets.some((p) => p.id === id)) return false;
  toast('warning', fill(PRESET_TEXT.stateGone, { id, active: presetName(live.preset.id) }));
  return true;
}

/**
 * Разобрать файл пресета и подготовить его к добавлению: формат, нормализация
 * поверх основы, пробный прогон, свободные `id` и имя. Общая половина превью
 * и загрузки — чтобы превью не обещало того, от чего загрузка откажется.
 */
async function readAndNormalize(source) {
  const file = readPresetFile(source);
  if (!file.ok) return { ok: false, code: file.code, error: file.message, errors: file.errors };
  const builtins = await ensureBuiltins();
  const res = normalizePreset(file.raw, { builtins, basedOn: file.basedOn, probe: PRESET_PROBES });
  const warnings = [...file.warnings, ...(res.warnings || [])];
  if (!res.ok) return { ok: false, code: res.code, error: res.message, errors: res.errors, warnings };
  // Новые `id` при коллизии (9.3.2): занятый встроенным или своим пресетом
  // получает хвост. Заменять молча нельзя — на старый могут ссылаться чаты.
  const own = storage.listUserPresets(ctx());
  const id = freeId(res.preset.id, [...PRESET_IDS, ...own.map((p) => p.id)]);
  const takenNames = [...PRESET_IDS.map((b) => presetName(b)), ...own.map((p) => p.name)];
  const name = freeName(res.preset.displayName, takenNames);
  return { ok: true, preset: res.preset, id, name, renamed: id !== res.preset.id, warnings };
}

/**
 * Поставить пресет активным — общая половина ручной смены и отката после
 * удаления. Вопросов не задаёт: к этому месту они уже заданы.
 */
async function switchPreset(wanted, next) {
  storage.saveSettings({ preset: wanted }, ctx());
  live.preset = next;
  if (live.state && live.state.presetId !== wanted) {
    // Часы привязываются к сетке звонков нового пресета. Состояние смену
    // переживает, а сетка берётся из активного пресета — и без этой правки
    // панель показывала две соседние строки с разным временем: в шапке
    // старые 15:00, а в «Сейчас» 14:05, начало той пары, в которую они
    // попадают по новой сетке. Поймано на живой таверне.
    const aligned = alignToGrid({ ...live.state, presetId: wanted }, next);
    // Снимки собраны под старый пресет и старую сетку звонков: свайп
    // вернул бы старый `presetId` в состояние (9.1.1).
    forgetTurns();
    await commit(aligned.state, { flush: true });
  }
  live.presets = await loadPresetList(next);
  reloadState();
  setInjects({ oneShot: '' });
  // Лорбук говорит словами пресета: тексты записей после смены другие.
  live.lorebook.signature = null;
  await syncLorebook();
  refreshPanel();
}

/** Версия расширения из манифеста. Не константа-копия: копия разъедется (см. `storage.js`). */
async function loadVersion() {
  try {
    const res = await fetch(`/scripts/extensions/${EXT_NAME}/manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return '';
    const m = await res.json();
    return String((m && m.version) || '');
  } catch (err) {
    // Версия — справочное поле конверта выгрузки, а не условие работы.
    console.warn(`[${MODULE}] манифест не прочитан, версия в выгрузке будет неизвестной:`, err);
    return '';
  }
}

// --- состояние --------------------------------------------------------------

function reloadState() {
  if (!live.preset) return null;
  const report = storage.loadStateReport(ctx(), live.preset);
  live.report = report;
  live.state = report.state;
  // История ходов читается тем же походом: она живёт рядом с состоянием и
  // без него не значит ничего (storage.js, «история ходов»).
  live.turns = storage.loadTurns(ctx(), live.preset);
  live.ledger = storage.loadLedger(ctx());
  live.plot = storage.loadPlot(ctx());
  live.analysisErrors.clear();
  primeCardCast();
  if (live.state) dropCastCandidates().catch((err) => console.warn(`[${MODULE}] кандидаты не почищены:`, err));
  primeMilestones();
  return report;
}

/**
 * Засеять «уже показанные» вехи тем, что есть в состоянии сейчас (9.4.2).
 * Зовётся при каждой замене состояния целиком — смена чата, F5, загрузка,
 * смена пресета: вехи, заработанные раньше, — не новость, и тост о них при
 * открытии чата был бы шумом.
 */
function primeMilestones() {
  const list = worldMilestones(live.state);
  live.shownMilestones = new Set(list.map((m) => m.id));
  // Чат, открытый впервые после появления счёта «во всех историях», приносит
  // туда то, что заработал раньше.
  tallyMilestones(list);
}

/**
 * Счёт «во всех историях» (вкладка «Достижения»): в скольких чатах вид вехи
 * получен хоть раз. Живёт в настройках расширения — они общие для всех чатов.
 * Пишется только при деле: `recordTally` возвращает тот же объект, если нового
 * нет, а таверна переписывает `settings.json` целиком при каждом сохранении.
 */
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

/**
 * Вехи «по миру» (9.4.3): итог, который ещё не объявлен, веху не даёт —
 * иначе тост «Блестящая сдача» прозвучал бы в день сдачи, раньше ведомости.
 * Панель («знает расширение») показывает полный список сама (`ui.js`).
 */
function worldMilestones(state) {
  if (!state || !live.preset) return [];
  try {
    return milestones(publicView(state, live.preset), live.preset);
  } catch (err) {
    console.warn(`[${MODULE}] вехи не посчитаны:`, err);
    return [];
  }
}

/**
 * Записать состояние — всегда вместе с историей ходов. Порознь их писать
 * нельзя: состояние без своей истории после F5 откатило бы свайп к снимку,
 * который к нему уже не относится.
 */
async function commit(state, { flush = false } = {}) {
  live.state = state;
  const c = ctx();
  storage.saveTurns(c, live.turns);
  if (flush) return storage.flushState(c, state);
  return storage.saveState(c, state);
}

/** Забыть историю ходов: состояние заменено целиком, откатывать к старому нельзя. */
function forgetTurns() {
  live.turns = [];
  live.oneShot = '';
  // Протокол — про ответы старого состояния: его плашки врали бы.
  live.ledger = [];
  live.analysisErrors.clear();
  try {
    storage.saveLedger(ctx(), live.ledger);
  } catch (err) {
    console.warn(`[${MODULE}] протокол ответов не очищен:`, err);
  }
  // Поводы ссылаются на ленту старого состояния — им больше не на что.
  live.plot = emptyPlot();
  savePlot();
}

/** Записать очередь поводов; сбой записи — не повод ронять ход. */
function savePlot() {
  try {
    live.plot = storage.savePlot(ctx(), live.plot);
  } catch (err) {
    console.warn(`[${MODULE}] очередь поводов не записана:`, err);
  }
}

/** Рубильник слоя 3, авто-режим и фон в сцене (`settings.feed`). */
function plotSettings() {
  const f = storage.loadSettings(ctx()).feed || {};
  return { enabled: f.hooks !== false, auto: f.hooks !== false && f.auto === true, background: f.background !== false };
}

/**
 * Звучит ли в этот ответ разовый повод праздника или события (решение
 * владелицы Р5): тогда повод игрока уступает и ждёт следующего хода
 * (`plot.onGeneration`, `yielded`). Узнаётся по взведённому одноразовому
 * тексту: ход помнит, какие строки праздников он взвёл (`holidayLines`), а
 * взведённое для этого ответа — `live.oneShot` (свайп получает
 * `oneShotBefore`, и праздник прошлого хода узнаётся так же).
 */
function holidaySounding() {
  const armed = String(live.oneShot || '');
  if (!armed) return false;
  return live.turns.some((t) => Array.isArray(t.holidayLines) && t.holidayLines.some((line) => line && armed.includes(line)));
}

/** Строки праздничных поводов среди одноразовых инжектов — в ход, который их взвёл. */
function holidayLinesOf(injects) {
  return (Array.isArray(injects) ? injects : []).filter((i) => i && i.kind === HOLIDAY_KIND && i.text).map((i) => String(i.text));
}

/** Последняя реплика игрока в чате — для «(без сплетен)». */
function lastUserText() {
  const chat = chatOf();
  for (let i = chat.length - 1; i >= 0; i -= 1) {
    const m = chat[i];
    if (m && m.is_user && !m.is_system) return String(m.mes || '');
  }
  return '';
}

/**
 * Молчат ли поток и поводы на этот ход: игрок написал «(без сплетен)» (приём
 * 11) или сцена тихая (`plot.quietScene` — пока заглушка, приём 9).
 */
function feedMuted() {
  const said = lastUserText();
  return isMuted(said) || quietScene(said);
}

// --- операции, переживающие смену чата (ремонт 9.1.4) ------------------------

/**
 * Генерация плана ждёт ответа 20–60 секунд, и за это время человек успевает
 * уйти в другой чат. Всё, что пишет в состояние после долгого `await`, сперва
 * спрашивает: «я ещё там, откуда уходил?»
 *
 * Сверяются две вещи, и обе нужны. `epoch` растёт на каждом `CHAT_CHANGED`, но
 * таверна шлёт это событие ПОСЛЕ того, как переприсвоила `chat_metadata`
 * (`script.js:7598` → `:7641`), а между ними у неё свои `await`: ответ,
 * вернувшийся в этот зазор, по одному счётчику прошёл бы. Id чата меняется
 * раньше события — его и сверяем вторым. (Образец — `captureOperation` у
 * BB-Enhance-Gen; сравнение массива `chat` оттуда не взято: таверна чистит
 * массив на месте, и ссылка на него не меняется.)
 */
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

/**
 * Отказ «пока ждали — чат сменился». Текстом для панели и всплывашкой таверны:
 * панель к этому времени уже перерисована под новый чат, и человек, который
 * ушёл из вкладки анкеты, иначе не узнал бы, куда делся план.
 */
function chatChanged(what) {
  const error = `Пока ${what}, открылся другой чат. Результат не записан ни туда, ни сюда:`
    + ' вернитесь в тот чат и повторите.';
  try {
    if (globalThis.toastr && typeof globalThis.toastr.warning === 'function') {
      globalThis.toastr.warning(error, 'Academy');
    }
  } catch { /* всплывашка — вежливость, не условие */ }
  return { ok: false, code: 'chat-changed', error };
}

// --- инжекты ----------------------------------------------------------------

/**
 * Что уходит в промпт. Три куска, и разделены они не для красоты:
 *
 * - строка состояния постоянна и пассивна, глубина 1–2 (3.3);
 * - инструкция про метку отключается галочкой и не инжектится вовсе в режиме
 *   «из контекста» — там метку никто не просит (таблица 3.2);
 * - одноразовый факт повелителен и живёт ровно одну генерацию (3.5). Положить
 *   его в постоянный инжект значило бы приказывать отыграть отчисление весь
 *   оставшийся семестр.
 */
function setInjects({ oneShot = null } = {}) {
  if (oneShot !== null) live.oneShot = String(oneShot || '');
  // Во время фоновой генерации соседа инжекты погашены (9.1.3): новое значение
  // запомнено выше и уйдёт в промпт, когда фоновая генерация кончится.
  if (live.quiet) return;
  writeInjects();
}

/**
 * Записать инжекты в таверну. `blank` — погасить все три, ничего не забывая:
 * взведённый одноразовый факт остаётся в `live.oneShot`.
 */
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
  // Фон в сцене — отдельной галочкой (`feed.background`): рубильник поводов
  // его не гасит, и наоборот.
  const built = started
    ? buildPrompt(live.state, live.preset, { injects: [], withMarker, feed: { quiet: muted || !plotOpts.background } })
    : { status: '', instruction: '', oneShot: '' };
  // Повод «Взять в сюжет» (слой 3) — один, взведённый, к одноразовому факту.
  // Рубильник выключен, игрок попросил тишины или звучит повод праздника — не идёт.
  const hook = started && !muted && plotOpts.enabled && !holidaySounding() ? hookPrompt(live.plot) : '';
  // Строку ставит сам человек макросом `{{academy}}` (9.3.1) — автоинжект
  // молчит, иначе строка ушла бы в промпт дважды. Гаснет только строка:
  // инструкции метки место важно (она просит ПЕРВУЮ строку ответа), а
  // одноразовый факт повелителен и обязан стоять у самого хвоста.
  const status = settings.statusViaMacro === true ? '' : built.status;
  const oneShot = started ? [live.oneShot, hook, live.skipWarning].filter(Boolean).join(' ') : '';

  // Порядок аргументов — (key, value, position, depth, scan, role, filter).
  // JSDoc над `setExtensionPrompt` (script.js:8866) переставляет scan и role
  // местами и врёт; сверено с телом функции.
  c.setExtensionPrompt(INJECT.status, status, types.IN_CHAT, depth, false, roles.SYSTEM);
  c.setExtensionPrompt(INJECT.marker, built.instruction, types.IN_CHAT, depth + 1, false, roles.SYSTEM);
  c.setExtensionPrompt(INJECT.oneShot, oneShot, types.IN_CHAT, 0, false, roles.SYSTEM);
}

// --- генерации (ремонт 9.1.2, 9.1.3) ------------------------------------------

/**
 * Какой одноразовый факт взведён для следующего ответа, по истории ходов.
 *
 * Факт, посчитанный на ходе N, нужен ответу N+1 — и всем его перегенерациям.
 * Поэтому у хода два поля: `oneShot` — что он взвёл для следующего,
 * `oneShotBefore` — что было взведено для него самого. Ход, откатанный под
 * свайп и ещё не получивший нового текста (`stamp === null`), снова ждёт
 * своего факта — значит, взведено то, что было до него.
 *
 * Это и есть правило плана «снимать по новому user-сообщению» в точной форме:
 * после нового хода факт прошлого хода заменяется фактом нового (часто пустым)
 * и в следующий ответ на реплику человека не попадает, а свайп, регенерация,
 * продолжение и фоновые генерации его не тратят.
 */
function armedOneShot() {
  const latest = live.turns[live.turns.length - 1];
  if (!latest) return live.oneShot;
  return latest.stamp === null ? latest.oneShotBefore : latest.oneShot;
}

/**
 * `GENERATION_STARTED(type, params, dryRun)` — сигнатура с `script.js:4240`.
 * Событие приходит до сборки промпта (и до того, как регенерация срежет
 * последний ответ), поэтому здесь ещё можно поправить, что в него попадёт.
 *
 * - `dryRun` — таверна собирает промпт ради подсчёта токенов или просмотра.
 *   Ничего не генерируется, и трогать нечего: ни гасить, ни взводить.
 * - `quiet` — фоновая генерация соседа (телефон, суммаризатор, карта, комикс
 *   через `generateQuietPrompt`). Строка состояния, просьба про метку и — хуже
 *   всего — вердикт экзамена ей не нужны: вердикт бы в ней и сгорел. Инжекты
 *   гасятся до `GENERATION_ENDED`/`GENERATION_STOPPED` (образец — chaos-events:
 *   без этого событие прокалывалось в каждую СМС телефона).
 * - `swipe`, `regenerate`, `continue` последнего посчитанного ответа — это
 *   тот же ход заново: взводится факт, который был действителен ДЛЯ него.
 * - всё остальное — обычный ход: взводится то, что взвёл последний ход.
 */
function handleGenerationStarted(type, _params, dryRun) {
  if (!live.preset || dryRun === true) return;
  if (type === 'quiet') {
    live.quiet = true;
    writeInjects({ blank: true });
    return;
  }
  // Любая обычная генерация снимает «погашено», даже если конец фоновой так и
  // не пришёл: `GENERATION_ENDED` таверна шлёт из `hideStopButton` и только
  // когда кнопка «стоп» видна (script.js:3473), то есть не всегда. Лучше
  // рано распечатать, чем навсегда оставить чат без инжектов.
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
  // Повод взводится к генерации ответа: голова очереди, если ещё ничего не
  // взведено. Реплика игрока, если она есть, придёт следом (`MESSAGE_SENT`
  // таверна шлёт после этого события) и решит окончательно.
  if (type !== 'impersonate' && live.state && live.state.started) {
    live.plot = onGeneration(live.plot, { enabled: plotSettings().enabled, muted: feedMuted(), yielded: holidaySounding() });
    savePlot();
  }
  writeInjects();
}

/**
 * Реплика игрока ушла (`MESSAGE_SENT`). Таверна шлёт её после
 * `GENERATION_STARTED`, но до сборки промпта (`script.js:4240` → `:5851`),
 * так что здесь ещё можно поменять, что уйдёт в этот ответ (образец —
 * nell-witchcraft). Повод, отданный прошлому ответу, уходит в журнал;
 * «(без сплетен)» гасит поводы, авто-режим и фон на этот ход; авто-режим,
 * если включён, подкидывает один повод.
 */
async function handlePlayerSent(mesId) {
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

/**
 * Предупреждение промотки для идущей генерации (9.2): если реплика человека,
 * на которую сейчас отвечают, несёт cue Time Skip, а в пределах промотки
 * впереди контрольное, — одноразовая строка «останови сцену накануне».
 * Анализатор Enhance-Gen календаря Academy не видит и сам этого не скажет.
 *
 * Чья реплика: у обычной генерации — последняя в чате; у свайпа, регенерации и
 * продолжения — та, что стоит перед перегенерируемым ответом (Enhance-Gen без
 * текста в поле ввода дописывает cue в прошлую реплику и жмёт «свайп вправо»,
 * `BB-Enhance-Gen/index.js`, `executeSkip`). `impersonate` пишет за человека —
 * ему промотка не адресована.
 */
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

/** Конец любой генерации: распечатать погашенное и взвести то, что положено. */
function handleGenerationEnded() {
  if (!live.preset) return;
  live.quiet = false;
  // События, придержанные на время фоновой генерации, — наружу сейчас.
  flushHooks();
  live.generating = null;
  live.skipWarning = '';
  // После `continue` без нового текста ход остался прежним — вернуть его факт.
  live.oneShot = armedOneShot();
  writeInjects();
}

// --- лорбук (3.7) -----------------------------------------------------------

/**
 * Когда обновляется лорбук — и почему именно так.
 *
 * Зовётся после каждого применённого ответа, но **работает почти никогда**:
 * первым делом считается `planSignature` — отпечаток того, чем лорбук должен
 * быть, посчитанный из состояния, без единого обращения к таверне. Совпал с
 * прошлым разом — выход, ни чтения файла лорбука, ни сохранения. Меняется он
 * ровно тогда, когда ядро порождает или переписывает запись: сдан экзамен,
 * пробит порог репутации, отношение перешло в другой ярлык, поправлена таблица
 * преподавателей. По обычному ответу «она пошла по коридору» не меняется ничто.
 *
 * Кнопка «обновить лорбук» тоже нужна (`force`), но как основной способ она
 * плоха: человек не обязан помнить, что после экзамена надо куда-то нажать.
 *
 * **Свайпы, правки и удаление сообщений лорбук не откатывают, и это осознанно.**
 * Состояние откатывается (поправка 3 этапа 2), отпечаток после отката меняется,
 * и следующая синхронизация приводит тексты записей в соответствие с новым
 * состоянием — это происходит само. Не происходит другого: запись хроники про
 * событие, которого в отменённом свайпе больше нет, из лорбука не исчезает. Так
 * и задумано. Молча удалять записи расширение не будет — 3.7 говорит, что
 * лорбук «правится и удаляется средствами таверны», и расширение, которое
 * стирает записи в ответ на свайп, однажды сотрёт то, что человек дописал
 * руками. Такие записи опознаются (`report.orphans`) и сносятся одной кнопкой,
 * но только по решению человека. Цена ошибки несимметрична: лишняя строчка в
 * лорбуке — это шум, потерянная — это потеря.
 */
async function syncLorebook({ force = false, immediately = false } = {}) {
  const c = ctx();
  const settings = storage.loadSettings(c);
  const s = lorebook.settingsOf(settings);

  if (!s.enabled) {
    // Галочка выключена — в World Info не ходим вовсе (3.7, :476), и старый
    // отчёт забываем: показывать его в панели было бы враньём.
    live.lorebook.signature = null;
    live.lorebook.report = null;
    live.lorebook.error = null;
    return null;
  }

  const signature = lorebook.planSignature(live.state, live.preset);
  if (!force && signature && signature === live.lorebook.signature) return live.lorebook.report;

  const op = captureOperation();
  try {
    const report = await lorebook.syncLorebook(c, live.state, live.preset, {
      settings,
      npcs: live.lorebook.suggested.filter((x) => x.kind !== 'places'),
      places: live.lorebook.suggested.filter((x) => x.kind === 'places'),
      immediately,
      // Та же дыра, что 9.1.4: между чтением лорбука и записью человек успевает
      // уйти в другой чат. Сторож спрашивается внутри `lorebook.js` перед
      // каждой записью — отбросить отчёт здесь, как раньше, мало: запись в World
      // Info и привязка к чату к этому времени уже случились бы.
      guard: () => isCurrent(op),
    });
    // Отчёт про лорбук прошлого чата в панели нового был бы враньём, а его
    // отпечаток запер бы синхронизацию нового чата (9.1.4).
    if (!isCurrent(op)) return null;
    live.lorebook.report = report;
    live.lorebook.error = null;
    // Отпечаток запоминается только после удачного похода: иначе одна неудача
    // (сеть, старая сборка) заперла бы лорбук до конца сессии.
    if (report && report.ok) live.lorebook.signature = signature;
    return report;
  } catch (err) {
    if (!isCurrent(op)) return null;
    // Лорбук — необязательная часть (3.7). Уронить им обработку ответа, то есть
    // зачётку и календарь, нельзя ни при каких условиях.
    console.error(`[${MODULE}] лорбук не обновлён:`, err);
    live.lorebook.error = String((err && err.message) || err);
    return null;
  }
}

// --- крючки для соседей: события `academy:*` (9.4.8, 9.7B) --------------------
//
// Academy — опора для соседей (музыка на звонок, соседка-наблюдатель,
// «Подслушано», даты сессии в календарь телефона), и отдаёт им две вещи:
// `window.AcademyAPI` (ниже, у запуска) и события. Три решения.
//
// 1. **Канала два, событие одно.** `document` — `CustomEvent` с `detail`: его
//    ловит любой скрипт страницы без знания таверны. И `eventSource` таверны —
//    так подписываются расширения (`eventSource.on('academy:day', …)`).
//    Отправка в `eventSource` не ждётся: таверна ждёт каждого подписчика по
//    очереди, и медленный сосед иначе задерживал бы подсчёт нашего ответа.
// 2. **Мир, а не расширение.** События говорят то, что знает мир (9.4.3):
//    `academy:exam` приходит, когда итог ОБЪЯВЛЕН, а не когда посчитан, вехи —
//    по `publicView`. Сосед-«Подслушано» не должен разболтать оценку раньше
//    ведомости.
// 3. **Откат — отдельным событием, а не молчанием.** Свайп, правка последнего
//    ответа и удаление откатывают состояние к снимку (9.1.1). Тогда приходит
//    `academy:rollback` с днём, на который откатились, а пересчёт нового
//    варианта даёт свои события заново — от снимка. Сосед, которому важна
//    точность, на `rollback` перечитывает `AcademyAPI.today()`. Молчать было бы
//    хуже: сосед, уже сыгравший звонок на пару, которой больше нет, не узнал бы,
//    что её отменили.
//
// Во время фоновой генерации соседа (`quiet`, 9.1.3) наружу не уходит ничего:
// события копятся в `live.hookQueue` и уходят после её конца.

/** Имена событий — они же список в `AcademyAPI.events` и в README. */
const HOOK_EVENTS = Object.freeze([
  'academy:day', 'academy:period', 'academy:phase', 'academy:exam', 'academy:milestone', 'academy:rollback',
]);

/**
 * Отправить событие. `detail` уходит копией через JSON — ни одной ссылки на
 * живое состояние: сосед, поправивший `detail` у себя, не правит семестр.
 */
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

/** Отдать накопленное за фоновую генерацию — по порядку. */
function flushHooks() {
  if (live.quiet || !live.hookQueue.length) return;
  const queue = live.hookQueue;
  live.hookQueue = [];
  for (const [name, payload] of queue) fireHook(name, payload);
}

/** Сегодняшний день «для соседа» — без исключений: крючки не роняют подсчёт. */
function safeToday(state) {
  try { return hookToday(state, live.preset); } catch { return null; }
}

/**
 * Что изменилось между двумя состояниями — для тостов вех и событий соседям.
 * Зовётся после каждого применённого ответа и после ручных действий, которые
 * двигают календарь (`manualTime`, `resolveJump`).
 *
 * @param {Object} before состояние ДО (у ответа — снимок хода)
 * @param {Object} after состояние ПОСЛЕ
 * @param {Object} [meta] `{source, mesId}` — что сдвинуло
 */
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
    // «Пара началась»: текущее занятие со статусом `now` сменилось на другое
    // (другой номер или другой день). Перемена и «до первой пары» — не начало.
    const key = (t) => (t.period && t.period.status === 'now' ? `${t.day}:${t.period.ordinal}` : '');
    if (key(b) && key(b) !== key(a)) {
      emitHook('academy:period', { day: b.day, ...b.period, ...meta });
    }
  }

  // Итог, который узнал мир: новый исход с объявлением сразу — или объявление
  // исхода, посчитанного раньше (9.4.3). Попытка входит в сравнение: пересдача
  // с тем же значением — это новый итог.
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

/** Что сосед узнаёт об итоге: предмет, вид, значение словом пресета и бросок. */
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

/**
 * Тост о новой вехе (9.4.2): название словами пресета, заголовок «Веха»,
 * звук — если человек включил его в настройках. Считается «по миру»
 * (`worldMilestones`) и только для тех, о которых ещё не говорили.
 */
function noticeMilestones(before, after) {
  const added = diffMilestones(worldMilestones(before), worldMilestones(after)).added
    .filter((m) => !live.shownMilestones.has(m.id));
  if (!added.length) return;
  tallyMilestones(added);
  const X = extraLabels(live.preset);
  for (const m of added) {
    live.shownMilestones.add(m.id);
    const name = milestoneName(m, after, live.preset);
    toast('success', name, X.milestoneToastTitle);
    emitHook('academy:milestone', {
      id: m.id, kind: m.kind, name, when: m.when || null,
      ...(m.subjectId ? { subjectId: m.subjectId } : {}),
      ...(m.teacherId ? { teacherId: m.teacherId } : {}),
    });
  }
  // Один звук на ответ, сколько бы вех ни пришло сразу: два «колокольчика»
  // подряд звучат как ошибка, а не как праздник.
  if (storage.loadSettings(ctx()).milestoneSound === true) {
    try { live.chime(); } catch { /* звук — вежливость */ }
  }
}

/**
 * Один тост на прыжок через дни (9.4.4): «Прошло занятий: 12, засчитаны
 * как посещённые» — вместо молчания и вместо пачки по прогулу. `run.jump`
 * приходит из ядра только у прыжков через дни (`engine.sweepAttendance`).
 */
function noticeJump(jump) {
  if (!jump || !jump.periods) return;
  toast('info', fill(extraLabels(live.preset).jumpToast, { periods: jump.periods }));
}

/**
 * Одноразовые факты, которые ручное действие положило в `state.pending`
 * (объявление итогов после «принять прыжок», 9.4.3), — сразу во взведённый
 * факт следующего ответа. Иначе они ждали бы следующего `applyResponse` и
 * ушли бы в промпт на ход позже, чем случились.
 *
 * Взводится через историю ходов (`latest.oneShot`), а не только в
 * `live.oneShot`: `GENERATION_STARTED` пересобирает взведённое из истории
 * (`armedOneShot`), и запись мимо неё стёрлась бы до первой генерации. Если
 * последний ход откачен и ждёт текста (`stamp === null`) — очередь остаётся в
 * состоянии, как было: её заберёт ответ.
 */
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

/**
 * Seed броска экзамена (9.3.9): id чата + начало семестра. Свайп ответа в день
 * экзамена считается от того же снимка — событие, попытка и день совпадают
 * (`exams.examSeed` добавляет их сам), и выпадает то же число; после F5 — тоже,
 * id чата тот же.
 *
 * Зачем начало семестра, если полный день и так в seed: id события —
 * «период·предмет·вид», без года, и новый семестр в том же чате с другим
 * началом, но с экзаменом, выпавшим на ту же дату, повторил бы бросок
 * прошлого. Перезапуск семестра с ТЕМ ЖЕ началом повторит броски — и это
 * честно: тот же чат, тот же календарь, те же события. Чата нет (не сохранён)
 * — остаётся начало семестра: бросок воспроизводим и так.
 */
function examSeedBase(state) {
  const term = (state && state.calendar && state.calendar.termStart) || '';
  return `${currentChatId()}|${term}`;
}

// --- обработка ответа модели ------------------------------------------------

/** Отпечаток текста: по нему видно, что тот же самый ответ уже посчитан. */
function stamp(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return `${text.length}:${h}`;
}

// --- ход и его сообщение (ремонт 9.1.1, 9.1.6) ---------------------------------
//
// Ход — это посчитанный ответ модели и снимок состояния до него. Раньше снимок
// искался по голому индексу сообщения, и это ломалось двумя путями, которые
// разбор соседей нашёл живьём: телефон дописывает журнал соцсетей в середину
// `chat` без событий (индексы едут вверх) и удаляет его штатным
// `deleteMessage` (индексы едут вниз, `MESSAGE_DELETED` приносит только новую
// длину). Правило «снимки с id >= length — удалены» откатывало тогда последний
// ход, которого никто не трогал.
//
// Теперь ход узнаёт своё сообщение по отпечатку текста (`stamp`), а индекс —
// только подсказка, откуда начинать искать. Текст свайпнутого сообщения
// меняется, но старый лежит в `swipes`, и по нему сообщение тоже узнаётся.
//
// И второе правило, общее для правки и удаления: **откатывается только
// последний ход** (и хвост подряд удалённых). Правка ответа из середины его
// не пересчитывает: откатить к снимку до него значило бы выбросить всё, что
// посчитано после, а пересчитать всё заново нельзя — экзамены бросаются
// случаем, и повторный прогон дал бы другие исходы. Удаление сообщения из
// середины не откатывает ничего.

/** Сообщение, которое вообще может быть ходом: ответ модели, не служебное, не чужое. */
function eligible(message) {
  if (!message || message.is_user || message.is_system) return false;
  // Сообщения, вставленные расширениями, помечены `extra.from` (Comic Forge —
  // `'BB-Comic-Forge'`). Сама таверна 1.18.0 это поле не пишет нигде — сверено
  // поиском по `public/`. Реплики в пузырях комикса — не ответ модели, и метки
  // или даты в них посчитаны быть не должны (9.1.6).
  const from = message.extra && message.extra.from;
  return !(typeof from === 'string' && from.trim() !== '');
}

/** Узнаёт ли ход это сообщение по тексту — текущему или одному из свайпов. */
function matchesTurn(message, turn) {
  if (!eligible(message) || !turn.stamp) return false;
  if (stamp(String(message.mes ?? '')) === turn.stamp) return true;
  return Array.isArray(message.swipes) && message.swipes.some((s) => stamp(String(s ?? '')) === turn.stamp);
}

/**
 * Относится ли ход к сообщению `mesId`: индекс совпал (и там всё ещё ответ
 * модели) либо сообщение узнаётся по тексту. Первое нужно правке — текст после
 * неё другой, — второе ловит сдвиг индексов вставкой без событий.
 */
function sameTurn(turn, mesId, chat) {
  const message = chat[mesId];
  if (!eligible(message)) return false;
  if (turn.mesId === mesId) return true;
  // По тексту — только если на старом месте хода его сообщения больше нет.
  // Иначе два одинаковых ответа подряд («...», «Она кивнула.») слились бы в
  // один ход, и второй не был бы посчитан вовсе.
  return matchesTurn(message, turn) && !matchesTurn(chat[turn.mesId], turn);
}

/**
 * Где сейчас сообщение хода. Ищется правее `floor` (ходы идут по порядку, и
 * два хода не могут указывать на одно сообщение), начиная с запомненного
 * индекса и расходясь в обе стороны — ближайшее совпадение побеждает. Ход,
 * ещё ждущий нового текста после отката (`stamp === null`), узнаётся только по
 * индексу. `-1` — сообщения больше нет.
 */
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

/** Где сейчас каждый ход: индексы по порядку, `-1` — удалён. */
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

/**
 * Реплика человека, на которую отвечает сообщение `at` (или ответ, который
 * ещё только встанет на место `at`), — текстом; `''`, если её нет.
 *
 * Идём назад: служебные сообщения и вставленные соседями (`extra.from`)
 * пропускаются, первая реплика человека — она. Если раньше неё встретился
 * другой ответ модели, реплика адресована ему, а не этому: cue промотки
 * разрешает один прыжок, а не все до следующей реплики (9.2).
 */
function userTextBefore(chat, at) {
  for (let i = Math.min(at, chat.length) - 1; i >= 0; i -= 1) {
    const m = chat[i];
    if (!m || m.is_system) continue;
    if (m.is_user) return String(m.mes || '');
    if (eligible(m)) return '';
  }
  return '';
}

/**
 * Имена сцены для стоп-листа (9.3.6): `name1` — героиня, `name2` — карточка.
 * В групповом чате карточек несколько, и рассказчиком бывает любая: тогда
 * `char` — имена всех участников (`groups[].members` — аватары, имена — из
 * `characters`; `groupId` — `st-context.js:123`). Не вышло — остаётся
 * `name2`: стоп-лист на одной карточке хуже полного, но лучше пустого.
 */
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
  } catch { /* имена — страховка, не условие разбора */ }
  // Персонаж бота по имени (`core/card-cast.mjs`): название карточки — не
  // всегда имя («Your Himbo Roommate» — это Джаспер Мираж).
  const cast = castMainNames(c);
  if (cast.length) char = [...[].concat(char == null ? [] : char), ...cast];
  return { user, char };
}

// --- персонаж карточки (core/card-cast.mjs) -----------------------------------
//
// Список «кто в карточке» живёт по карточке, а не по чату: в настройках
// расширения под аватаром (`settings.cardCasts[avatar]`). Персонаж тот же во
// всех чатах с ней — спрашивать о нём заново в каждом чате незачем.

/** Аватары карточек этого чата: одна карточка или все участники группы. */
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

/** Список карточки или `null`, если её ещё не смотрели. */
function castOf(avatar) {
  try {
    const all = storage.loadSettings(ctx()).cardCasts || {};
    return all[avatar] ? normalizeCast(all[avatar]) : null;
  } catch {
    return null;
  }
}

/** Все написания персонажей бота во всех карточках чата. */
function castMainNames(c) {
  return castAvatars(c).flatMap((a) => castNames(castOf(a)));
}

function saveCast(avatar, cast) {
  const clean = normalizeCast(cast);
  // Присвоением, а не слиянием: убранный человек не должен пережить сохранение.
  const all = storage.loadSettings(ctx()).cardCasts || {};
  all[avatar] = clean;
  storage.saveSettings({}, ctx());
  return clean;
}

/**
 * Догадка без модели при открытии чата: карточку ещё не смотрели — самое
 * частое имя в её тексте (`guessCastLocal`). Записывается и пустая догадка:
 * иначе каждый заход в чат перечитывал бы карточку. Групповой чат не
 * угадывается — там имена участников и так в стоп-листе.
 */
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

/** Стоп-лист из одних персонажей бота — для кандидатов и пометки в «Людях». */
function castStop(c) {
  const names = castMainNames(c);
  return names.length ? stopList({ char: names }) : [];
}

/** Однокурсники, похожие на персонажа бота: панель предлагает их убрать. */
function castClassmateHits() {
  const stop = castStop(ctx());
  if (!stop.length || !live.state) return [];
  return (live.state.classmates || []).filter((p) => p && stopHit(p.name, stop)).map((p) => p.id);
}

/** Персонаж бота среди кандидатов в курс — ошибка разбора: убрать молча. */
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

/** Индекс последнего сообщения, которое может быть ходом, либо `-1`. */
function lastEligible(chat) {
  for (let i = chat.length - 1; i >= 0; i -= 1) if (eligible(chat[i])) return i;
  return -1;
}

/**
 * Последний ход, если событие пришло про его сообщение.
 *
 * Запасной случай — только для правки (`edited`): сообщение последнего хода
 * поправлено (текст не узнаётся) И сдвинуто вставкой без событий (индекс не
 * совпадает). Ход тогда не находится нигде, а правка пришла про последний
 * ответ в чате — это он и есть. Для нового ответа так рассуждать нельзя: там
 * «ход не нашёлся» значило бы «пересчитать новый ответ вместо старого» и
 * молча выбросить старый.
 */
function latestFor(mesId, chat, { edited = false } = {}) {
  const latest = live.turns[live.turns.length - 1];
  if (!latest) return null;
  if (sameTurn(latest, mesId, chat)) return latest;
  if (edited && mesId > latest.mesId && mesId === lastEligible(chat) && findTurn(chat, latest) === -1) {
    return latest;
  }
  return null;
}

/**
 * Откатить последний ход к снимку «до него» и взвести факт, который был
 * действителен для него самого (9.1.2). Ход остаётся в истории и ждёт нового
 * текста: `stamp = null` — «ещё не посчитан».
 */
async function rollbackLatest(turn, mesId, reason = 'swipe') {
  const was = turn.stamp;
  turn.mesId = mesId;
  turn.stamp = null;
  live.oneShot = turn.oneShotBefore;
  // Люди, добавленные и поправленные руками после ответа, — решение игрока,
  // а не событие ответа: откат их не отменяет (`classmates.carryRoster`).
  turn.before = carryManual(live.state, turn.before);
  // Отметки игрока на уходящем варианте ответа («своё», «прочитано»,
  // «взято») запоминаются ходом: вернётся игрок на этот свайп — вернутся и
  // они (`feed.rememberFeedMarks`, решение владелицы 08.10).
  turn.marks = rememberFeedMarks(turn.marks, live.state);
  // «Прочитано» и жизнь поводов ставились после снимка — переносятся с собой
  // (`feed.carryFeedMarks`); «сыграно» от откатываемого ответа снимается.
  await commit(carryFeedMarks(live.state, turn.before, was || ''));
  announceRollback(reason, mesId);
}

/**
 * `academy:rollback` (см. шапку раздела крючков, решение 3): состояние
 * вернулось к снимку. `day` — день, на котором календарь стоит теперь.
 */
function announceRollback(reason, mesId) {
  const day = live.state && live.state.calendar ? live.state.calendar.day : null;
  emitHook('academy:rollback', { reason, day, ...(Number.isInteger(mesId) ? { mesId } : {}) });
}

/**
 * С какого дня предложить начать семестр.
 *
 * До этой правки год не выбирал никто: `state.defaultStartDay` приклеивал к
 * `ММ-ДД` пресета год **системных часов компьютера**, и человека про дату не
 * спрашивали вовсе. В чате, где время уже печатает кто-то другой — соседнее
 * расширение или сама модель, — это значит, что расширение молча заводит свой
 * календарь в чужом году, а потом весь семестр спорит с текстом постов.
 *
 * Правило простое и в одну сторону: **если год уже написан в чате, идём за
 * ним.** Ищется он источниками A+ и A (`readTime`) по последним сообщениям, и
 * берётся только тот, что стоит в тексте буквально (`yearFromText`), — год,
 * который источник достроил бы сам, здесь ничего не доказывает. Не нашлось —
 * остаётся прежнее умолчание, но теперь оно показано человеку в поле, а не
 * подставлено молча.
 *
 * @returns {{day: string, from: 'chat'|'preset', matched: string}}
 */
const START_HINT_SCAN = 20;

function startDayHint() {
  const fallback = { day: defaultStartDay(live.preset), from: 'preset', matched: '' };
  if (!live.preset) return fallback;

  const c = ctx();
  const chat = Array.isArray(c && c.chat) ? c.chat : [];
  for (let i = chat.length - 1, seen = 0; i >= 0 && seen < START_HINT_SCAN; i -= 1, seen += 1) {
    const m = chat[i];
    if (!m || m.is_system) continue;
    // Через общий вход чтения времени, а не голым `parseContext`: самые
    // надёжные годы в чате — в машинных тегах соседей (`tel:time`, `RP_DATE`,
    // источник A+), а они живут в HTML-комментариях, которые проза не видит
    // (etap-time-a-plus.md). Режим `context` — чтобы метка B не участвовала:
    // года в ней нет.
    const hit = readTime(String(m.mes || ''), { mode: 'context' }).context;
    if (hit && hit.day && hit.yearFromText) {
      return { day: hit.day, from: 'chat', matched: hit.matched };
    }
  }
  return fallback;
}

/**
 * Один ответ модели, посчитанный ровно один раз.
 *
 * Свайпы и правки — главная ловушка этого файла. При свайпе с новой генерацией
 * таверна шлёт MESSAGE_SWIPED, а следом ещё раз MESSAGE_RECEIVED
 * (script.js:6610-6632); при переключении на уже сгенерированный свайп
 * MESSAGE_RECEIVED не приходит вовсе (script.js:10232). Поэтому состояние
 * откатывается к снимку «до этого сообщения» и считается заново — иначе прогулы
 * и оценки удваиваются на каждом свайпе.
 *
 * Снимок — это ход в `live.turns`, и он пишется в метаданные чата (9.1.1):
 * после F5 свайп откатывает так же, как до него, а тот же ответ, досланный
 * соседом ещё раз, отсекается сохранённым отпечатком.
 */
async function handleMessage(mesId, { source = 'received' } = {}) {
  if (!live.preset || !live.state || !live.state.started) return 'семестр не начат';
  const c = ctx();
  const chat = chatOf();
  const message = chat[mesId];
  if (!eligible(message)) return 'не ответ модели';

  const text = String(message.mes || '');
  const mark = stamp(text);
  // Выводы секретаря (`core/analysis`) к этому тексту: есть — оценки,
  // прогулы и отношения берутся из них, а из метки рассказчика только время.
  const note = ledgerEntry(mark);
  const tokens = note && Array.isArray(note.tokens) ? note.tokens : null;
  const analysisKey = tokens ? tokens.join(' ') : null;

  let turn = latestFor(mesId, chat);
  const fresh = !turn;
  if (turn) {
    // Тот же ход: свайп, продолжение, правка. Уже посчитан этим текстом и этим
    // разбором — выход; иначе считается заново от снимка «до него».
    if (turn.stamp === mark && (turn.analysis ?? null) === analysisKey) return 'уже посчитан';
  } else {
    const latest = live.turns[live.turns.length - 1];
    // Сообщение раньше последнего хода: либо уже посчитанный старый ход (его
    // не пересчитываем, см. правило выше), либо сообщение, которое никогда не
    // было ходом. Считать его сейчас — значит вклеить прошлое поверх
    // настоящего не по порядку.
    if (latest && mesId <= latest.mesId) return `раньше последнего хода #${latest.mesId}`;
    // Откаченный под свайп ход, так и не получивший нового текста (генерацию
    // остановили, человек написал своё): вклада в состояние у него нет.
    if (latest && latest.stamp === null) live.turns.pop();
    turn = {
      mesId,
      stamp: null,
      // Копия, а не ссылка: снимок уезжает в метаданные и обязан остаться тем,
      // чем был, что бы ни случилось с живым состоянием.
      before: cloneState(live.state),
      oneShotBefore: armedOneShot(),
      oneShot: '',
    };
    live.turns.push(turn);
    if (live.turns.length > storage.TURN_HISTORY) live.turns.splice(0, live.turns.length - storage.TURN_HISTORY);
  }
  // Пересчёт идёт от снимка, но курс в нём — нынешний: человека, которого
  // добавили руками после ответа, пересчёт не стирает (`carryRoster`).
  if (!fresh) turn.before = carryManual(live.state, turn.before);
  const before = turn.before;

  const settings = storage.loadSettings(c);
  // Что человек сказал о времени репликой перед этим ответом (9.2): ход в
  // телефоне ставит сцену на паузу, cue промотки Enhance-Gen разрешает прыжок
  // без вопроса. Ищется на каждом пересчёте — свайп и правка того же ответа
  // отвечают на ту же реплику и получают то же разрешение.
  const said = userTextBefore(chat, mesId);
  const phoneTurn = Boolean(readPhoneTurn(said));
  // Кубик соседа (Enhance-Gen, 9.4.1/9.7B) в реплике перед ответом решает исход
  // сегодняшнего контрольного через тот же `resolveConflict`. Телефонный ход —
  // пауза сцены, экзамен в нём не сдают.
  const dice = phoneTurn ? null : readDiceRoll(said);
  const run = applyResponse(before, effectiveText(text, tokens), live.preset, {
    mode: settings.mode,
    relativeWords: settings.relativeWords,
    // Обещание движку: за сегодняшнее контрольное сажает этот файл (ниже), и
    // оценку модели по нему он заберёт сам (8.1).
    sitsExam: true,
    // Стоп-лист `rel=` (9.3.6): героиня, карточка (в группе — все карточки).
    names: sceneNames(c),
    phoneTurn,
    timeSkip: phoneTurn ? null : readTimeSkip(said),
  });

  let state = run.state;
  const injects = [...run.injects];
  let permission = '';

  // Сессия: исход считается до того, как модель его опишет, и не чаще раза в
  // день — иначе лента из четырёх контрольных сгорела бы за четыре ответа.
  // Оценка, которую модель выставила за сегодняшнее контрольное, придержана
  // движком и не ушла в зачётку второй записью (8.1): её забирает бросок.
  const exam = maybeSitExam(state, run.modelSaid, dice);
  if (exam) {
    state = exam.state;
    injects.push(...exam.injects);
    permission = exam.permission;
    run.exam = exam.exam;
    run.divergence = exam.divergence || run.divergence;
  }

  state = sceneOfTurn(state, text, tokens, mark, c);
  // Молва (шаг 2): ещё один ответ бота в счёт выпусков; выпуск этого же варианта
  // ответа, если он уже был (пересчёт, правка, возврат на свайп), ложится заново.
  // Считается от снимка «до ответа», поэтому свайп откатывает и счёт, и выпуск.
  state = replayMolva(tickMolva(state), turn.molva, mark);
  // Пересчёт идёт от снимка «до ответа»: отметки ленты, поставленные после
  // него (прочитано, взято, истекло), переносятся с прошлой версии.
  // Память свайпов хода — то, что игрок отметил на этом же варианте до ухода
  // с него.
  state = carryFeedMarks(live.state, state, mark, fresh ? [] : turn.marks);
  // Поводы (шаг 4): пришедший ответ получил взведённый повод; новый ответ —
  // ещё один шаг к истечению неотыгранного.
  if (source === 'received') live.plot = onReply(live.plot, { fresh });
  const expired = expireHooks(live.plot, state);
  live.plot = expired.plot;
  state = expired.state;
  savePlot();

  const oneShot = [permission, ...injects.map((i) => i.text)].filter(Boolean).join(' ');
  turn.mesId = mesId;
  turn.stamp = mark;
  turn.analysis = analysisKey;
  turn.oneShot = oneShot;
  turn.holidayLines = holidayLinesOf(injects);
  live.lastRun = { ...run, injects, permission, source, mesId };
  // Ответ пришёл — предупреждение промотки своё отработало.
  live.skipWarning = '';
  await commit(state);

  setInjects({ oneShot });
  // Вехи, события соседям и сводка прыжка — от снимка «до ответа»: свайп,
  // пересчитанный от того же снимка, узнаёт те же перемены, а тост вехи
  // второй раз не звучит (`live.shownMilestones`).
  noticeChanges(before, state, { source, mesId });
  noticeJump(run.jump);
  recordLedger(mark, before, state, { marker: hasOwnMarker(text), exam: run.exam });
  await syncLorebook();
  refreshPanel();
  // Молва выпускается отдельным вызовом и без секретаря; ответ бота не ждёт её.
  if (source === 'received') {
    autoMolva(mesId, mark).catch((err) => console.error(`[${MODULE}] молва не выпущена:`, err));
  }
  return 'посчитан';
}

/**
 * Журнал событий ответа: что пришло от таверны и что Академия с ним сделала.
 * Ответ, который она пропустила, иначе не виден ничем, а на телефоне нет
 * консоли — журнал показывает «Вернуть кнопку» в меню расширений
 * (`panelDiagnosis`). Ошибка обработчика сюда тоже попадает: раньше она тонула
 * в `eventSource` молча, и ответ просто оставался непосчитанным.
 */
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

// --- секретарь и плашка под ответом -----------------------------------------
//
// Секретарь (`core/analysis`) — отдельный запрос, который читает ответ модели
// и записывает оценки, прогулы и отношения. Зовётся только кнопкой на плашке:
// разбор после каждого свайпа стоил бы запроса на каждый вариант ответа.
//
// Разобрать можно любой ответ, но ложатся выводы по-разному.
//
// - **Последний ответ** — пересчётом: его выводы лежат в протоколе по
//   отпечатку текста и подмешиваются к ответу при каждом его пересчёте
//   (`handleMessage`), поэтому свайп и правка обходятся с ними так же, как с
//   меткой: откат к снимку и пересчёт, без удвоений.
// - **Старый ответ** — поправкой (`core/corrections`): снимка «до него» нет,
//   после него прошли другие ходы. Найденное дописывается в нынешнее состояние
//   датой того ответа, с квитанцией на каждый вывод, чтобы его можно было снять.
//   Та же поправка вносится в снимки истории ходов новее этого ответа — иначе
//   свайп последнего ответа откатил бы состояние к снимку без неё.

/** Запись протокола по отпечатку текста, свежие — с конца. */
function ledgerEntry(mark) {
  for (let i = live.ledger.length - 1; i >= 0; i -= 1) if (live.ledger[i].stamp === mark) return live.ledger[i];
  return null;
}

/** Записать протокол: изменённая запись переезжает в конец (она свежая). */
function putLedger(entry) {
  live.ledger = [...live.ledger.filter((e) => e.stamp !== entry.stamp), entry];
  try {
    live.ledger = storage.saveLedger(ctx(), live.ledger);
  } catch (err) {
    console.warn(`[${MODULE}] протокол ответов не записан:`, err);
  }
}

/** Есть ли в тексте метка самого рассказчика. */
function hasOwnMarker(text) {
  return new RegExp(MARKER_RE.source, 'i').test(String(text || ''));
}

/**
 * Что ответ сделал с миром — строками для плашки. Новые записи журнала —
 * те, что легли после последней записи снимка «до»; журнал режется с головы
 * (`limits.journalSize`), поэтому граница ищется по содержимому, а не по длине.
 */
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
  const rows = hookJournal({ ...after, journal: fresh }, live.preset, 50).map((r) => rowText(r, rowWords())).filter(Boolean);
  // Итог, который мир узнает позже (9.4.3): журнал наружу его прячет, но что
  // контрольное сдавали, видно сразу — без оценки.
  if (exam && exam.announceOn) {
    const subject = ((after.subjects || []).find((s) => s.id === exam.subjectId) || {}).name || exam.subjectId;
    rows.push(`${subject}: сдавала, итог объявят ${formatDate(exam.announceOn) || exam.announceOn}`);
  }
  return [...new Set(rows)];
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
  const receipts = tokens && tokens.map((token) => {
    const ev = tokenEvent(token, lexiconOf(before, ctx()));
    // Событие: записано — квитанция с id; было в планах — `known`, чтобы
    // плашка не выдавала его за записанное, а снятие не убрало чужую запись.
    if (ev?.kind === 'event') {
      const at = planned.findIndex((item) => item.name === ev.name);
      const info = at >= 0 ? planned.splice(at, 1)[0] : null;
      if (info?.kind === 'event-known') return { kind: 'event', known: true, name: ev.name };
      if (info) return { kind: 'event', id: info.id, name: info.name, from: info.from };
    }
    if (ev?.kind === 'rel') {
      const at = applied.findIndex((item) => item.teacherId === ev.teacherId && item.delta === ev.delta);
      const info = at >= 0 ? applied.splice(at, 1)[0] : null;
      if (info?.damped) return { kind: 'rel', teacherId: ev.teacherId, applied: 0 };
      const index = relations.findIndex((row) => row.data.teacherId === ev.teacherId && row.data.delta === ev.delta);
      const row = index >= 0 ? relations.splice(index, 1)[0] : null;
      return { kind: 'rel', teacherId: ev.teacherId, applied: row ? row.data.to - row.data.from : 0 };
    }
    if (ev?.kind === 'completion') {
      const row = journal.slice(boundary + 1).find((item) => item.data?.completion === ev.scope && item.data?.value === ev.value);
      const ids = row?.data?.subjectIds || [];
      return completionReceipt(before, after, ids);
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

/** Словарь разборщика: пресет, списки состояния и имена сцены для стоп-листа. */
function lexiconOf(state, c) {
  return {
    ...live.preset,
    subjects: state.subjects,
    // `rel=` двигает и однокурсников: люди — преподаватели и курс (шаг 2).
    teachers: markerPeople(state),
    classmates: Array.isArray(state.classmates) ? state.classmates : [],
    survey: state.survey,
    names: sceneNames(c),
    // Поводы «Взять в сюжет»: секретарь отмечает сыгранные `played=id`.
    hooks: knownHooks(live.plot),
  };
}

/** Стоп-лист сцены для кандидатов в курс: героиня, карточка, заведение. */
function sceneStop(state, c) {
  return stopList({ ...sceneNames(c), preset: live.preset, survey: state.survey });
}

/**
 * Курс в пересчёте ответа (шаг 3), поверх того, что посчитал движок:
 *
 * - встречи по имени (`razbor-inject.md`, приём 10): однокурсник, названный в
 *   ответе, — «был в сцене», без запроса;
 * - факты курса из разбора секретаря (`met/clash/rumor/new/deal`), а без
 *   разбора — из метки самого рассказчика, если он их написал;
 * - реакции сохранённого разбора — в ленту, каждая при своём факте.
 *
 * Всё ложится от снимка «до ответа» тем же пересчётом, что оценки: свайп и
 * правка не удваивают ленту, снятие разбора её чистит.
 */
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
  const scene = items.filter((x) => x.ev && SCENE_KINDS.includes(x.ev.kind));
  const privateSet = Array.isArray(tokens) ? privateRefs(tokens) : null;
  if (scene.length) next = applySceneEvents(next, scene, live.preset, { src: mark, day, time, stop, heroine: c && c.name1, privateRefs: privateSet });
  // Прогул, опоздание, провал и громкая оценка героини — публичные темы слота «Главные» молвы.
  next = applyNotableFacts(next, items, live.preset, {
    src: mark, day, time, heroine: c && c.name1, loud: Array.isArray(tokens) ? loudOf(tokens) : null,
  });
  const loud = Array.isArray(tokens) ? loudOf(tokens) : null;
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
  // «Повод сыгран» (шаг 4): секретарь видел его в сцене.
  const played = Array.isArray(tokens) ? playedRefs(live.plot, playedOf(tokens)) : [];
  if (played.length) {
    next = cloneState(next);
    markPlayed(next, mark, played);
  }
  return next;
}

/** Реакции разбора с подписью «к какому факту» — для вкладки «Поток» и фона. */
function reactionsWithFacts(tokens, lexicon) {
  // Подпись «о чём» — фразой факта, без «по поводу» (`analysis.tokenAbout`).
  return reactionsOf(tokens).map((r) => ({ ...r, factText: tokenAbout(r.fact, lexicon) }));
}

/**
 * Ход, которым ответ `mesId` посчитан, если это последний ход: его можно
 * пересчитать. Узнаётся и по номеру сообщения — соседи (трекеры, Horae)
 * бывает дописывают текст ответа молча, без события, и отпечаток расходится.
 */
function liveTurnOf(mesId, chat) {
  const turn = latestFor(mesId, chat);
  return turn && turn.before ? turn : null;
}

/** Запись протокола ответа: по нынешнему тексту или по тексту, с которым считался ход. */
function entryOf(mark, turn) {
  return ledgerEntry(mark) || (turn && turn.stamp ? ledgerEntry(turn.stamp) : null);
}

/**
 * После принятого прыжка плашка последнего ответа переезжает на новую дату.
 * Запись протокола несёт день и время, на которые ответ был посчитан, — то есть
 * день до придержанного прыжка; без этого плашка показывала «21 сентября» при
 * шапке «14 октября» до следующего ответа (живой прогон 10.10). Прыжок
 * придержан именно ответом, который сейчас последний, — его запись и правится.
 */
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

/** Вид плашки для ответа `mesId`; `null` — не ответ модели или семестра нет. */
function panelView(mesId) {
  if (!live.preset || !live.state || !live.state.started) return null;
  const chat = chatOf();
  const message = chat[mesId];
  if (!eligible(message)) return null;
  const mark = stamp(String(message.mes || ''));
  const turn = liveTurnOf(mesId, chat);
  const entry = entryOf(mark, turn);
  // Последний ответ чата, которого Академия не считала вовсе (событие не
  // пришло или обработчик упал): разбор его сперва досчитает.
  const uncounted = !entry && !turn && countable(mesId, chat);
  const lexicon = lexiconOf(live.state, ctx());
  const tokens = entry && Array.isArray(entry.tokens) ? entry.tokens : null;
  const draft = entry && entry.draft;
  return {
    date: entry ? formatDate(entry.day) : '',
    time: entry ? entry.time : '',
    rows: entry ? entry.rows : [],
    analyzed: Boolean(tokens),
    draft: Boolean(draft),
    summary: (draft ? draft.summary : entry && entry.summary) || '',
    tokens: panelTokens((draft ? draft.tokens : tokens) || [], lexicon, entry, Boolean(draft)),
    marker: entry ? entry.marker : null,
    // Как лягут выводы: пересчётом последнего ответа или поправкой к старому.
    live: Boolean(turn) || uncounted,
    correction: Boolean(entry && entry.mode === 'late'),
    known: Boolean(entry),
    uncounted,
    busy: live.analyzing.has(mark),
    error: live.analysisErrors.get(mark) || '',
    // Кого секретарь назвал, а в списках нет, — словами на плашке.
    unparsed: ((draft ? draft.unparsed : tokens && entry.unparsed) || []).slice(),
    // Метка секретаря оборвалась: часть выводов потеряна, и плашка так и говорит.
    partial: Boolean(draft && draft.partial),
    // Слова заведения для разделов плашки: «Класс», «Отношение учителей».
    labels: panelLabels(),
    // Прыжок времени ждёт решения (карточка на «Сегодня»): строка «без перемен»
    // об этом ответе молчала бы о главном.
    heldJump: Boolean(live.state.calendar && live.state.calendar.heldJump && (turn || uncounted)),
  };
}

/** Слова заведения для строк плашки: «долг» школы, «хвост» вуза, «прореха» магов. */
function rowWords() {
  const U = uiLabels(live.preset);
  return {
    rowDebt: U.rowDebt,
    rowDebtClosed: U.rowDebtClosed,
    rowJump: U.rowJump,
    rowExamMissed: U.rowExamMissed,
    rowReputation: U.rowReputation,
  };
}

/** Слова пресета для плашки: подвкладка «Люди», учителя, вкладка ленты. */
function panelLabels() {
  const U = uiLabels(live.preset);
  return {
    course: U.classmatesTitle,
    rel: U.mesRelSection,
    feedTab: U.tabFeed,
    crowdIn: String((live.preset && live.preset.vocab && live.preset.vocab.crowdIn) || '').trim() || 'на курсе',
  };
}

/**
 * Кружок автора реакции или ответа на плашке — тот же, что в ленте
 * (`masks.authorAvatar`): маска — значок, человек — фото или инициалы.
 */
function tokenAvatar(author) {
  const c = ctx();
  return authorAvatar(live.state, author, { heroine: c && c.name1 });
}

/**
 * Строки разбора для плашки. Факты курса — разделом «Курс», реакции —
 * разделом «Что говорят» при своём факте (`fact` — номер строки факта),
 * новое лицо — с кнопкой «в курс», пока кандидат ждёт галочки.
 */
function panelTokens(list, lexicon, entry, isDraft) {
  return list.map((t, i) => {
    if (isReactToken(t)) {
      const r = reactionOf(t, list);
      const fact = r && r.fact ? list.indexOf(r.fact) : -1;
      return {
        text: tokenText(t, lexicon), brief: '', kind: 'react', nick: Boolean(r && r.nick),
        // Автор и реплика порознь: имя человека — жирным, маска — серым курсивом.
        parts: talkParts(t, lexicon),
        avatar: r ? tokenAvatar(r) : null,
        ...(fact >= 0 ? { fact, about: tokenAbout(list[fact], lexicon) } : {}),
      };
    }
    // Ответ в ветке: под своим постом этого разбора (`post` — номер строки)
    // или под постом ленты — тогда подпись, к чему он.
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
    if (isPlayedToken(t)) return { text: tokenText(t, lexicon), brief: tokenText(t, lexicon), kind: 'course' };
    if (!isFactToken(t)) return { text: tokenText(t, lexicon), brief: '', kind: 'loud' };
    if (t.startsWith('new=')) return newNameToken(t.slice(4), isDraft);
    const ev = tokenEvent(t, lexicon);
    const known = ev?.kind === 'event' && eventKnown(ev, entry, isDraft ? null : i);
    const kind = ev ? (ev.kind === 'completion' ? 'grade' : SCENE_KINDS.includes(ev.kind) ? 'course' : ev.kind) : 'other';
    return {
      text: tokenText(t, lexicon, { known }),
      brief: tokenText(t, lexicon, { known, brief: true }),
      kind,
    };
  });
}

/**
 * «новое лицо: Глеб Орлов — добавить?» и что с ним сейчас. Раздел — словом
 * пресета (`classmatesTitle`: «Класс», «Взвод»), в кавычках: склонять подпись
 * вкладки нельзя, а «в раздел «Класс»» читается при любом слове.
 */
function newNameToken(name, isDraft) {
  const head = `новое лицо: ${name}`;
  const part = uiLabels(live.preset).classmatesTitle;
  if (findClassmate(live.state, name)) return { text: `${head} — уже в разделе «${part}»`, brief: head, kind: 'course' };
  const cand = listCandidates(live.state).find((c) => c && sameName(c.name, name));
  if (cand) return { text: `${head} — добавить в раздел «${part}»?`, brief: head, kind: 'course', candidate: cand.id };
  return { text: isDraft ? `${head} — после сохранения его можно будет добавить` : head, brief: head, kind: 'course' };
}

/**
 * Галочка с плашки: кандидат из сцены становится однокурсником — в нынешнем
 * состоянии и в снимках ходов, где он ждёт. В снимок последнего хода он
 * ложится однокурсником и там, где кандидата ещё нет: пересчёт того же ответа
 * (повторный разбор, правка) иначе вернул бы его в кандидаты и забыл галочку.
 */
async function confirmSceneCandidate(id) {
  if (!live.state) return { ok: false };
  const cand = listCandidates(live.state).find((c) => c && c.id === id);
  if (!cand) return { ok: false };
  const stop = sceneStop(live.state, ctx());
  const next = cloneState(live.state);
  const made = confirmCandidate(next, id, live.preset, { stop });
  if (!made) return { ok: false };
  for (const t of live.turns) {
    if (!t.before) continue;
    if (findClassmate(t.before, made.name)) continue;
    const twin = listCandidates(t.before).find((c) => c && sameName(c.name, made.name));
    if (twin) confirmCandidate(t.before, twin.id, live.preset, { stop });
    else if (t === live.turns[live.turns.length - 1]) {
      const { id: _id, relation: _rel, ...fields } = made;
      addClassmate(t.before, { ...fields, locked: false }, live.preset, { stop });
    }
  }
  await commit(next);
  await syncLorebook();
  refreshPanel();
  renderPanels();
  return { ok: true, id: made.id };
}

/**
 * Событие из разбора уже было в планах и не записано. Сохранённый разбор
 * знает это по квитанции; черновик — сверкой с нынешними планами, без своих
 * же событий прошлого сохранения (`holidays.alreadyPlanned`).
 * @param {?number} index номер токена в сохранённом разборе; `null` — черновик
 */
function eventKnown(ev, entry, index) {
  const receipts = (entry && Array.isArray(entry.receipts)) ? entry.receipts : [];
  if (index !== null) return Boolean(receipts[index] && receipts[index].known);
  const day = (entry && entry.day) || (live.state.calendar && live.state.calendar.day);
  const own = receipts.filter((r) => r && r.kind === 'event' && r.id).map((r) => r.id);
  return alreadyPlanned(live.state, live.preset, ev, day, own);
}

/**
 * Разобрать ответ `mesId` секретарём. Последний ответ пересчитывается с
 * выводами, старый получает поправку (см. шапку раздела).
 * @returns {Promise<{ok: boolean, error?: string, tokens?: string[], rejected?: Array}>}
 */
async function analyzeMessage(mesId) {
  const c = ctx();
  const chat = chatOf();
  const message = chat[mesId];
  if (!live.state || !live.state.started || !eligible(message)) return { ok: false, error: 'Здесь нечего разбирать.' };
  const text = String(message.mes || '');
  const mark = stamp(text);
  // Разбор только готовит черновик: даже непосчитанный ответ не меняет мир.
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
    // Последний ответ читается против состояния «до него» — тем, что видел
    // рассказчик; старый — против нынешнего списка предметов и людей.
    //
    // Курс — нынешний и для последнего ответа: снимок получает людей,
    // добавленных руками после ответа (`carryRoster`), — иначе секретарь их не
    // видит, а «Разобрать заново» не находит. Это безопасно для отката: те же
    // люди переживут и пересчёт этого ответа, и свайп.
    if (turn) turn.before = carryManual(live.state, turn.before);
    const base = turn ? turn.before : live.state;
    const prompt = buildAnalysisPrompt(base, live.preset, {
      reply: stripMarker(text),
      userText: userTextBefore(chat, mesId),
      statusLine: turn
        ? statusLine(base, live.preset)
        : [entry ? formatDate(entry.day) : '', entry ? entry.time : ''].filter(Boolean).join(', '),
      heroine: c.name1,
      exams: Boolean(turn),
      posts: Boolean(turn),
      // Статус повода — по живой ленте: «взято» ставится после снимка.
      hooks: secretaryHooks(live.plot, live.state),
    });
    const res = await api.complete(storage.apiSettings(c), {
      system: prompt.system,
      user: prompt.user,
      ctx: c,
      temperature: 0.2,
      maxTokens: api.TOKEN_BUDGETS.analysis,
    });
    if (live.epoch !== epoch) return { ok: false, error: 'Чат сменился, пока шёл разбор.' };
    if (res.code === 'gateway') return fail('Шлюз модели не ответил. Нажмите «Разобрать» ещё раз.');
    if (!res.ok) return fail(`Разбор не удался: ${res.message || res.code}`);
    // Недавние посты ленты — те же, что видел секретарь (`buildAnalysisPrompt`):
    // по ним проверяется `reply=f2:…`. У поправки старого ответа их нет.
    // Посты ленты секретарь не пишет (шаг 3 «Молвы»): строки react=/reply= не принимаются.
    // `live.legacyPosts` — только для прогонов старых тестов ленты, наружу не настраивается.
    const parsed = parseAnalysis(res.text, lexiconOf(base, c), { posts: live.legacyPosts === true });
    if (!parsed.found) {
      console.warn(`[${MODULE}] секретарь ответил без метки:`, res.text);
      return fail(res.truncated
        ? 'Секретарь не договорил: ответ оборвался раньше метки. Попробуйте ещё раз.'
        : 'Секретарь ответил не так, как нужно. Попробуйте ещё раз.');
    }
    // Пока шёл запрос, ответ могли свайпнуть или поправить: выводы — про
    // прежний текст, и к новому их не приложить.
    const now = chatOf()[mesId];
    if (!now || stamp(String(now.mes || '')) !== mark) return { ok: false, error: 'Ответ сменился, пока шёл разбор.' };
    // Причины строками, как у молвы: «[Object, Object]» в консоли ничего не говорило (баг 83).
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

/**
 * Записать выводы ответа `mesId` (`null` — снять разбор). Последний ответ —
 * пересчётом, старый — поправкой: прежние выводы снимаются, новые ложатся.
 */
async function writeAnalysis(mesId, tokens, summary) {
  const chat = chatOf();
  const message = chat[mesId];
  if (!eligible(message)) return { ok: false };
  const mark = stamp(String(message.mes || ''));
  const turn = liveTurnOf(mesId, chat);
  const prev = entryOf(mark, turn);
  const list = Array.isArray(tokens) ? [...tokens] : null;
  const words = summary === undefined ? (prev && prev.summary) || '' : summary;

  if (turn) {
    // Выводы, которые когда-то легли поправкой (ответ был старым, потом новые
    // ответы удалили), сперва снимаются: дальше их несёт пересчёт.
    if (prev && prev.mode === 'late') await commitCorrections(mesId, undoCorrections(prev));
    putLedger({
      ...(prev || { rows: [], day: '', time: '', marker: false }),
      stamp: mark, tokens: list, mode: 'live', receipts: null, summary: list ? words : '', at: Date.now(),
    });
    await handleMessage(mesId, { source: 'analysis' });
    renderPanels();
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
    const step = (s) => applyCorrection(s, ev, live.preset, { day, src: mark, token: t, stop, heroine: ctx().name1, privateRefs: privateSet });
    steps.push(step);
    receipts.push(null);
  }
  // Квитанции снимаются с нынешнего состояния; снимки истории правятся теми же
  // шагами, а их квитанции не нужны — снимать будем по квитанциям нынешнего.
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
  // Реакции — блок «что сочинено»: квитанций у них нет, лента кладёт их
  // заново целиком (`feed.putReactions` идемпотентна), а снимает — снятие
  // источника в `undoCorrections`.
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
  // «Повод сыгран» старым ответом — тоже шагом: снимается вместе с разбором
  // (`scene.revertSceneSource` снимает отметки этого ответа).
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

/** Применение происходит только по явной кнопке, к текущему тексту ответа. */
async function saveAnalysis(mesId) {
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
    const result = await writeAnalysis(mesId, tokens, summary);
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

/** Шаги снятия прежних выводов записи: по квитанциям, а без них — по токенам. */
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
  // Курс и лента (шаг 3): реакции квитанций не имеют, а выводы, легшие
  // пересчётом, — и факты тоже. Снимается всё, что лежит от этого ответа;
  // кандидатов по имени — только без квитанций (с ними их снял `revertCorrection`).
  const social = entry.tokens.some((t) => !isFactToken(t) || /^(?:met|clash|rumor|new|deal-?)=/.test(t));
  if (social) {
    const receipted = Array.isArray(entry.receipts) && entry.receipts.some(Boolean);
    const names = receipted ? [] : entry.tokens.filter((t) => t.startsWith('new=')).map((t) => t.slice(4));
    steps.push((s) => revertSceneSource(s, entry.stamp, names));
  }
  return steps;
}

/** Применить шаги снятия к нынешнему состоянию и снимкам истории. */
async function commitCorrections(mesId, steps) {
  if (!steps.length) return;
  let state = live.state;
  for (const fn of steps) state = fn(state);
  historyApply(mesId, steps, steps.length);
  await commit(state);
}

/**
 * Те же шаги — в снимки ходов новее ответа `mesId`: они должны знать о
 * поправке, иначе откат свайпом вернул бы состояние без неё. Первые
 * `undoCount` шагов возвращают состояние, остальные — `{state, receipt}`.
 */
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

/** Правка выводов с плашки: вычеркнуть один или снять все. */
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

/** Последний ответ чата, который новее последнего хода, — его ещё можно посчитать. */
function countable(mesId, chat) {
  if (mesId !== lastEligible(chat)) return false;
  const latest = live.turns[live.turns.length - 1];
  return !latest || mesId > latest.mesId;
}

/**
 * Почему у ответов нет плашки — словами, для меню расширений (на телефоне
 * консоли нет). Каждая часть проверяемая.
 */
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
    parts.push(`плашек на странице: ${document.querySelectorAll('.academy-mes-panel').length}`);
  }
  return `Плашки: ${parts.join('; ')}.`;
}

const panelHost = {
  panelFor: (mesId) => panelView(mesId),
  analyze: (mesId) => analyzeMessage(mesId),
  saveAnalysis: (mesId) => saveAnalysis(mesId),
  discardAnalysis: (mesId) => discardAnalysis(mesId),
  // Вычеркнутый факт уносит свои реакции (решение 3 владелицы).
  dropToken: (mesId, index) => editAnalysis(mesId, (list) => dropTokenAt(list || [], index)),
  confirmCandidate: (mesId, id) => confirmSceneCandidate(id),
  clearAnalysis: (mesId) => undoAnalysis(mesId),
};

let panelTimer = null;

/** Перерисовать плашки — с короткой задержкой: события таверны идут пачками. */
function renderPanels() {
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
  }, 60);
}

/**
 * Ближайшее несданное контрольное на сегодня — не больше одного за день (3.5).
 *
 * `modelSaid` — исход, который модель уже отыграла меткой в этом же ответе
 * (`applyResponse` его придержал, см. 8.1). Он не отменяет бросок: бросок
 * считается как обычно, а `resolveConflict` внутри `sitExam` переписывает
 * запись на версию модели и кладёт расхождение в журнал. Спорить с написанным
 * текстом расширение не умеет — и не должно.
 */
function maybeSitExam(state, modelSaid, dice = null) {
  // Ворота дня спрашиваются у ядра одной функцией (`exams.sittableExams`), а не
  // складываются здесь из фазы и флага сессии: контрольное бывает двух родов —
  // событие открытой сессии и событие вида со своим окном в календаре, которое
  // случается посреди учебных недель, когда сессии нет. Прежняя проверка на фазу
  // `exams` второго рода не пропускала вовсе: середина периода была бы заведена,
  // но несдаваема.
  if (!sittableExams(state, live.preset, state.calendar.day).length) return null;
  // «Не больше одного за день» считается по КАЛЕНДАРНОМУ дню, а не по сессии, и
  // поэтому переживает несколько учебных периодов без единой правки: `day` —
  // полная дата, и событие прошлого триместра совпасть с сегодняшним не может.
  // Сузить проверку до событий текущей сессии было бы даже неверно: два
  // контрольных в один день — это два контрольных в один день, чьи бы они ни
  // были.
  const takenToday = state.exams.items.some((i) => i.outcome && i.day === state.calendar.day);
  if (takenToday) return null;

  // Событие называется явно, а не «ближайшее»: движок выбирал его тем же
  // правилом (`todaysExam`), но придержанная оценка относится именно к нему, и
  // подразумевать совпадение двух выборов не стоит.
  // Бросок воспроизводим (9.3.9): seed — чат и начало семестра, а событие,
  // попытку и день ядро добавит само (`exams.examSeed`). Без seed ядро брало
  // `Math.random`, и свайп ответа в день экзамена выбивал другой исход — при
  // том что вердикт прошлого варианта модель уже видела.
  //
  // `dice` — кубик соседа; старшинство «модель > кубик > свой бросок» решает
  // ядро (`engine.sitExam`), здесь только передаётся.
  const res = sitExam(state, live.preset, {
    ...(modelSaid ? { examId: modelSaid.examId, modelSaid: modelSaid.value } : {}),
    ...(dice ? { dice } : {}),
    seed: examSeedBase(state),
    // Шов прогона (см. `live.examRng`): в таверне его нет, и решает seed.
    ...(typeof live.examRng === 'function' ? { rng: live.examRng } : {}),
  });
  if (!res.applied) return null;
  const injects = [...(res.state.pending || [])];
  const next = { ...res.state, pending: [] };
  return {
    state: next, injects, exam: res.exam, permission: res.permission, divergence: res.divergence,
  };
}

/**
 * Свайп: откат к снимку.
 *
 * Два случая, и таверна различает их не событием, а слотом свайпа.
 *
 * - **Новая генерация.** `MESSAGE_SWIPED` приходит, пока в `mes` ещё СТАРЫЙ
 *   текст, а `swipe_id` уже смотрит в пустой слот за концом `swipes`
 *   (`script.js`, `swipe`: `newSwipeId = swipes.length`, событие — из
 *   `animateSwipe`, :10255). Здесь только откат и взвод факта «для этого
 *   хода» (9.1.2) — до сборки промпта; новый текст посчитает
 *   `MESSAGE_RECEIVED`. Раньше отсюда же звался пересчёт, и он считал СТАРЫЙ
 *   текст заново — со свежим броском экзамена — и взводил его факт вместо
 *   нужного, а сразу следом `clearOneShot()` стирал и его: перегенерируемый
 *   ответ оставался без вердикта.
 * - **Переключение на готовый свайп.** `MESSAGE_RECEIVED` не придёт
 *   (`script.js:10232`), поэтому текст считается прямо отсюда.
 */
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

/**
 * Правка сообщения руками (и `MESSAGE_UPDATED` от соседей).
 *
 * Последний ход — откат и пересчёт. Но только если текст действительно другой:
 * соседи шлют `MESSAGE_UPDATED`, дописав в `extra` картинку или перевод, и
 * пересчёт того же текста бросил бы экзамен заново.
 *
 * Ход из середины не пересчитывается (правило — в шапке раздела «ход и его
 * сообщение»), но его отпечаток
 * обновляется: иначе после правки ход перестал бы узнавать своё сообщение, и
 * следующее удаление посчитало бы его удалённым.
 */
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

/**
 * Удаление сообщения. Аргументом приходит длина чата, а не индекс
 * (`MESSAGE_DELETED`, etap2-st-facts.md), — поэтому удалённое узнаётся не по
 * длине, а поиском: каждый ход ищет своё сообщение (`locateTurns`).
 *
 * - Последний ход на месте — удалено что-то другое (реплика человека, журнал
 *   телефона, старый ответ). Ничего не откатывается; ходы из середины, чьих
 *   сообщений больше нет, просто забываются.
 * - Последнего хода нет — откат к снимку до самого раннего из подряд
 *   удалённых последних ходов. Это и регенерация: таверна срезает ответ и шлёт
 *   это событие (`script.js`, `Generate`, ветка `regenerate`), и взводится
 *   факт, который был действителен для срезанного ответа (9.1.2).
 */
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
  await commit(carryManual(live.state, target.before));
  announceRollback('delete');
  // Регенерация: старт пришёл раньше среза (ремонт, факт 2), и предупреждение
  // промотки тогда считалось от дня ПОСЛЕ срезанного ответа. Теперь день верный.
  if (live.generating) refreshSkipWarning();
  setInjects({});
  refreshPanel();
}

async function handleChatChanged() {
  // Первым делом: всё, что ждёт ответа из прошлого чата, должно это увидеть.
  live.epoch += 1;
  live.quiet = false;
  // События прошлого чата, придержанные под фоновую генерацию, новому чату
  // ни к чему: сосед получил бы «день сменился» про чужой семестр.
  live.hookQueue = [];
  live.generating = null;
  live.skipWarning = '';
  live.lastRun = null;
  live.molvaDebug = null;
  // Лорбук у каждого чата свой: и отпечаток, и предложения — из прошлого чата,
  // и переносить их в новый значило бы дописать чужому чату чужие записи.
  live.lorebook = { signature: null, report: null, error: null, suggested: [] };
  live.oneShot = '';
  reloadState();
  // Чат мог быть заведён пресетом, который с тех пор удалили (9.3.2).
  checkStatePreset();
  // История ходов приехала из метаданных нового чата — и вместе с ней факт,
  // взведённый последним ходом: вердикт экзамена переживает и смену чата
  // туда-обратно, и F5 (9.1.2).
  setInjects({ oneShot: armedOneShot() });
  // Первая синхронизация в чате нужна и без нового события: в лорбуке может не
  // быть ничего (галочку включили в прошлом чате), а отпечаток сброшен выше.
  await syncLorebook();
  refreshPanel();
}

/** Живое состояние → снимок хода: руками сделанное (курс, каст молвы) откатом не отменяется. */
function carryManual(live, before) {
  return carryCast(live, carryRoster(live, before));
}

// --- каст молвы (шаг 1 плана «Молва») ------------------------------------------------
//
// Восемь постоянных статистов ленты. Собирается одним запросом при первой
// надобности (каст пуст) и по кнопке «Пересобрать каст»; точка входа для выпуска
// молвы (шаг 2) — `ensureFeedCast`: «убедись, что каст есть, и дай его».
// Каст — решение человека и сборки, а не событие ответа: свайп его не откатывает
// (`carryManual`), а сюжетики откатывает вместе с остальной лентой.

/** Что нужно сборке каста от мира: пресет, реалии, имена, которых нельзя занимать. */
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
  };
}

/** Идёт ли сборка каста — вторая кнопка и выпуск не запускают вторую. */
let castBuilding = null;

/**
 * Убедиться, что каст есть. Пуст — собрать (один запрос и точечные замены);
 * `force` — собрать заново (кнопка «Пересобрать каст»: id статистов новые,
 * сюжетики прежнего каста уходят). Результат пишется в состояние только если
 * чат тот же.
 *
 * @param {{force?: boolean}} [opts]
 * @returns {Promise<{ok: true, cast: Object[], created: boolean, warnings: string[]} | {ok: false, error: string}>}
 */
async function ensureFeedCast({ force = false } = {}) {
  if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
  const have = feedCastOf(live.state);
  if (have.length && !force) return { ok: true, cast: have, created: false, warnings: [] };
  if (castBuilding) return castBuilding;
  const c = ctx();
  const op = captureOperation();
  castBuilding = (async () => {
    try {
      const res = await api.generateFeedCast(feedCastInput(), storage.apiSettings(c), c);
      if (!isCurrent(op)) return chatChanged('собирался каст молвы');
      if (!res.ok) return { ok: false, error: res.error || 'запрос не удался', code: res.code, raw: res.raw };
      const next = cloneState(live.state);
      const cast = setFeedCast(next, res.members);
      await commit(next);
      refreshPanel();
      return { ok: true, cast, created: true, warnings: res.warnings || [] };
    } catch (err) {
      console.error(`[${MODULE}] каст молвы не собран:`, err);
      return { ok: false, error: `Каст не собран: ${(err && err.message) || err}` };
    } finally {
      castBuilding = null;
    }
  })();
  return castBuilding;
}

// --- выпуск молвы (шаг 2 плана «Молва») ------------------------------------------------
//
// Отдельный вызов модели, а не хвост секретаря: повестку (слоты, авторы,
// отвечающие, квота на главных) собирает код, модель пишет реплики
// (`core/molva.mjs`). Работает и без секретаря — счёт идёт по ответам бота
// (`handleMessage`). Выпуск привязан к ответу, после которого он вышел: дельта
// лежит в ходе (`turn.molva`), свайп откатывает её вместе со всей лентой, а
// пересчёт того же ответа кладёт обратно. Пропущенные выпуски не догоняются.

/** Настройки молвы: раз в сколько ответов и «только по кнопке». */
function molvaSettings() {
  const f = storage.loadSettings(ctx()).feed || {};
  return { every: everyOf(f.molvaEvery), manual: f.molvaManual === true };
}

/** Сколько знаков сырого ответа молвы хранит отладка. */
const MOLVA_RAW_MAX = 12000;

/** Одна строка до `max` знаков — для журнала. */
const clip = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);

/** Идёт ли выпуск — второй не запускается. */
let molvaRunning = null;

/** Автомат: пора выпускать — выпускаем, тихо; сбой — в консоль, ответ бота уже обработан. */
async function autoMolva(mesId, mark) {
  if (!live.state || !live.state.started || feedMuted()) return;
  if (!molvaDue(live.state, molvaSettings())) return;
  const turn = live.turns[live.turns.length - 1];
  if (!turn || turn.mesId !== mesId || turn.stamp !== mark) return;
  if ((turn.molva || []).some((d) => d.stamp === mark)) return;
  const res = await runMolva({ auto: true, mark });
  if (!res.ok) console.warn(`[${MODULE}] молва: ${res.error}`);
}

/**
 * Выпустить молву: каст (нет — соберётся), повестка, запрос, проверки, запись.
 *
 * @param {{auto?: boolean, mark?: string}} [opts] `auto` — по счёту ответов: тихо и со сбросом счёта при неудаче
 * @returns {Promise<{ok: true, posts: number, replies: number, skipped: number} | {ok: false, error: string}>}
 */
async function runMolva({ auto = false, mark = '' } = {}) {
  if (!live.state || !live.state.started || !live.preset) return { ok: false, error: 'семестра в этом чате нет' };
  if (molvaRunning) return { ok: false, error: 'Молва уже обновляется — подождите немного.' };
  const c = ctx();
  const op = captureOperation();
  molvaRunning = (async () => {
    try {
      const cast = await ensureFeedCast();
      if (!cast.ok) return { ok: false, error: `Каст молвы не собран: ${cast.error}` };
      if (!isCurrent(op)) return auto ? { ok: false, error: 'чат сменился' } : chatChanged('обновлялась молва');

      // К какому ответу привязан выпуск: к тому, после которого он вышел
      // (автомат), или к последнему посчитанному (кнопка). Нет хода — без привязки.
      const last = live.turns[live.turns.length - 1];
      const turn = last && last.stamp && (!mark || last.stamp === mark) ? last : null;
      if (auto && !turn) return { ok: false, error: 'Ответ сменился, пока собирался каст.' };
      const stamp = turn ? turn.stamp : '';

      const stop = classmateStop();
      const { work, agenda } = planIssue(live.state, live.preset, { stop, every: auto ? molvaSettings().every : 0 });
      if (!agenda.slots.length) return { ok: false, error: 'Писать некому: в касте нет подходящих статистов.' };
      const prompt = buildMolvaPrompt(work, live.preset, agenda, { statusLine: statusLine(live.state, live.preset) });
      const res = await api.generateMolva(prompt, storage.apiSettings(c), c);
      if (!isCurrent(op)) return auto ? { ok: false, error: 'чат сменился' } : chatChanged('обновлялась молва');
      if (!res.ok) return { ok: false, error: `Молва не обновилась: ${res.error}` };
      // Пока шёл запрос, ответ могли свайпнуть: выпуск про прежний вариант не нужен.
      if (turn && live.turns[live.turns.length - 1] !== turn) return { ok: false, error: 'Ответ сменился, пока писалась молва.' };
      if (turn && turn.stamp !== stamp) return { ok: false, error: 'Ответ сменился, пока писалась молва.' };

      const parsed = parseIssue(res.text, agenda, {
        pool: rumorAuthors(work, { stop }),
        stop,
        truncated: res.truncated === true,
        existing: feedItemsOf(live.state).slice(-40).map((x) => x.text),
        history: feedItemsOf(live.state),
      });
      // Дата записей — день выпуска, по живому календарю (после скачка времени — новый, не прежний).
      const cal = live.state.calendar || {};
      const out = applyIssue(work, parsed, agenda, { stamp, resetOnFail: auto, day: cal.day, time: cal.time, preset: live.preset });
      // Что отброшено и почему — строками, а не «[Object]»; сырой ответ — в отладку.
      for (const r of parsed.rejected) console.info(`[${MODULE}] молва: отброшено${r.line ? ` (строка ${r.line})` : ''}: ${r.reason} | ${clip(r.raw, 120)}`);
      for (const r of parsed.reassigned) console.info(`[${MODULE}] молва: строка ${r.line}, слот ${r.n}: написал «${r.to}» вместо «${r.from}» — принято`);
      live.molvaDebug = {
        at: new Date().toISOString(), auto, ok: out.ok, truncated: res.truncated === true, complete: parsed.complete,
        rows: parsed.rows, posts: out.posts, replies: out.replies,
        raw: String(res.text == null ? '' : res.text).slice(0, MOLVA_RAW_MAX),
        rejected: parsed.rejected.map((r) => ({ line: r.line || 0, reason: r.reason, raw: clip(r.raw, 160) })),
        reassigned: parsed.reassigned,
      };
      if (!out.ok) {
        // Автомат не бьёт по запросам после каждого ответа: счёт сбрасывается, дельта-пустышка
        // держит его и при пересчёте этого ответа.
        if (out.delta && turn) {
          turn.molva = [...(turn.molva || []), out.delta].slice(-DELTAS_KEPT);
          await commit(replayMolva(live.state, [out.delta]));
        }
        const why = parsed.rejected.slice(0, 2).map((r) => r.reason).join('; ');
        return { ok: false, error: res.truncated
          ? 'Модель оборвалась на середине — молва не обновилась. Попробуйте ещё раз.'
          : `Модель ответила не по форме — ни одна реплика не прошла проверку${why ? ` (${why})` : ''}. Попробуйте ещё раз; разбор — во вкладке «Отладка».` };
      }
      const next = replayMolva(live.state, [out.delta]);
      if (turn) turn.molva = [...(turn.molva || []), out.delta].slice(-DELTAS_KEPT);
      await commit(next);
      refreshPanel();
      return { ok: true, posts: out.posts, replies: out.replies, skipped: parsed.rejected.length };
    } catch (err) {
      console.error(`[${MODULE}] молва не обновилась:`, err);
      return { ok: false, error: `Молва не обновилась: ${(err && err.message) || err}` };
    } finally {
      molvaRunning = null;
    }
  })();
  return molvaRunning;
}

// --- стоп-лист имён в плане (9.3.6) -----------------------------------------

/** Чьё имя совпало — словами для человека. Слова механизма, не заведения. */
/** Стоп-лист для курса: героиня, карточка, заведение и слова пресета (шаг 2). */
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

/**
 * Предупреждения о преподавателях плана, чьё имя попало в стоп-лист. Пусто —
 * всё чисто. Карточка — мягкий стоп (`core/stop-names.mjs`): чат «один на один
 * с преподавательницей» бывает нарочно, поэтому про неё фраза другая.
 */
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

// --- макрос {{academy}} (9.3.1) ----------------------------------------------

/** Имя макроса. Без скобок: `registerMacro` скобки в ключе отвергает (macros.js). */
const MACRO = 'academy';

/**
 * Что подставляет `{{academy}}`: строка состояния, та же, что уходит
 * автоинжектом (`buildPrompt(...).status`), — и ничего больше. Инструкция
 * метки и одноразовый факт остаются инжектами при любой галочке: инструкция
 * просит ПЕРВУЮ строку ответа и обязана стоять у хвоста, а факт повелителен
 * ровно одну генерацию, и прятать его в постоянное место промпта нельзя.
 *
 * **Макрос работает всегда, а не только при галочке.** Галочка гасит
 * автоинжект, чтобы строка не ушла дважды; сам макрос — как `{{summary}}` у
 * штатного суммаризатора: поставил — получил. Иначе человек, вписавший макрос
 * и забывший галочку, видел бы пустоту и не понимал почему.
 *
 * **В фоновой генерации (`quiet`) — пусто.** Ремонт 9.1.3 гасит все три
 * инжекта на время `generateQuietPrompt` соседа (телефон, суммаризатор,
 * карта): строка состояния им не нужна и сбивает их. Макрос, поставленный в
 * системный промпт, попадает и в их промпт тоже — и обязан гаснуть так же,
 * иначе галочка «через макрос» молча отменяла бы ремонт. Таверна подставляет
 * макросы при сборке промпта, то есть после `GENERATION_STARTED('quiet')`, так
 * что `live.quiet` к этому времени уже поднят.
 */
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

/**
 * Регистрация макроса — по образцу штатного суммаризатора таверны 1.18.0
 * (`extensions/memory/index.js`, `summary`): при включённом новом движке
 * макросов (`power_user.experimental_macro_engine`, в 1.18.0 по умолчанию
 * включён, `power-user.js:302`) — `macros.register(name, {handler, ...})`
 * (`st-context.js:244`, `macros/macro-system.js`); иначе — старый
 * `registerMacro(key, fn, description)` (`st-context.js:179`, помечен
 * `@deprecated`, но в старом движке другого пути нет). Сборка без обоих — не
 * повод молчать целиком: строка тогда остаётся только автоинжектом.
 *
 * @returns {'engine'|'legacy'|null} куда зарегистрирован
 */
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

// --- хост для панели --------------------------------------------------------

/**
 * Всё, что панель знает о внешнем мире. Ни `fetch`, ни `chat_metadata`, ни
 * события таверны в `ui.js` не попадают — иначе интерфейс нельзя проверить
 * ничем, кроме живого браузера.
 */
const host = {
  getState: () => live.state,
  /** Почему нет плашек под ответами — для меню расширений. */
  panelDiagnosis: () => panelDiagnosis(),
  getReport: () => live.report,
  getPreset: () => live.preset,
  /** Из чего выбирать пресет и что выбрано сейчас. Имена — из самих пресетов. */
  getPresets: () => ({
    active: String((live.preset && live.preset.id) || ''),
    list: live.presets.map((p) => ({ ...p })),
    // «Пресет удалён — включён встроенный» (9.3.2): панель показывает строкой.
    notice: live.presetNotice,
    max: USER_PRESETS_MAX,
  }),
  getSettings: () => storage.loadSettings(ctx()),
  /** Id текущего чата — к нему привязан черновик анкеты. */
  getChatId: () => currentChatId(),
  /**
   * Персонаж карточки для «Настроек»: название карточки, список и можно ли его
   * править (в групповом чате — нет: там стоп-лист и так знает всех участников).
   */
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
  /** id однокурсников, похожих на персонажа бота (пометка в «Людях»). */
  getCardCastHits: () => castClassmateHits(),
  /**
   * С какого дня предложить начать семестр и откуда эта дата взялась. Панель
   * показывает её в поле, а не подставляет молча: год календаря — решение,
   * которое до сих пор принимали системные часы (см. `startDayHint`).
   */
  getStartHint: () => startDayHint(),
  /**
   * Чем таверна отвечает прямо сейчас — для графы «актуальный API».
   *
   * Профили лежат в `extensionSettings.connectionManager.profiles`, а
   * `selectedProfile` — id того, что выбран в самой таверне (пусто значит
   * «подключение как есть, без профиля»). Сборка без менеджера подключений —
   * не беда: тогда список пуст, и остаётся ровно один пункт «текущее
   * подключение», который ходит через `generateRaw`.
   */
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
  /**
   * @param {Object} patch кусок настроек
   * @param {{quiet?: boolean}} [opts] `quiet` — сохранить, но НЕ перерисовывать
   *   панель. Нужен полям, которые не меняют ни одного другого экрана (адрес,
   *   ключ и модель API): перерисовка отцепляет от документа узел статуса, в
   *   который пишут «Проверить связь» и «Список моделей», и ответ — включая
   *   текст отказа — пропадал вместе с ним. Умолчание прежнее: перерисовать.
   */
  setSettings: (patch, opts = {}) => {
    storage.saveSettings(patch, ctx());
    setInjects({});
    if (opts && opts.quiet === true) return;
    // Галочка лорбука живёт в тех же настройках, и включают её ради того, чтобы
    // лорбук появился, а не после следующего экзамена. Отдельным обещанием,
    // потому что `setSettings` синхронный, а поход в World Info — нет.
    syncLorebook().then(refreshPanel).catch(() => {});
    refreshPanel();
  },
  getDebug: () => live.lastRun,
  /** Последний выпуск молвы: сырой ответ модели, строки отброса и их причины. */
  getMolvaDebug: () => live.molvaDebug,
  /** Очередь поводов «Взять в сюжет» — для вкладки «Поток». */
  getPlot: () => live.plot,
  /** Имя героини — для подписей ленты. */
  getHeroine: () => String((ctx() && ctx().name1) || ''),
  /** Формулировка повода по умолчанию — для превью перед отправкой (приём 7). */
  getFeedDraft: (ref) => (live.state ? draftHook(live.state, ref, { heroine: ctx().name1, preset: live.preset }) : null),
  markerVisibleRisk,
  /**
   * Сырьё «Доктора промпта» (9.7A п.4) и его разбор. Инжекты берутся у
   * таверны на каждый показ: `getContext()` отдаёт живую ссылку на
   * `extension_prompts` (`script.js:625`, `st-context.js:151`), а `clearChat`
   * переприсваивает этот объект при смене чата (`script.js:1588`) — ссылка,
   * запомненная раньше, смотрела бы на мёртвый.
   */
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

  /**
   * Всё про лорбук одним куском (3.7). `suggest` здесь — предложения, которые
   * ждут решения человека: сами в лорбук они не уйдут никогда.
   */
  /**
   * «Нарисовать портрет» (шаг 4): чем таверна может рисовать прямо сейчас и
   * что выбрано в настройках. `chat` — id чата: панель держит незаконченное
   * рисование у себя и показывает его только в том чате, где его начали.
   */
  getDraw: () => ({ ...drawInfo(ctx(), storage.loadSettings(ctx()).draw), chat: currentChatId() }),

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
    };
  },

  // Каждое действие отвечает панели одинаково — `{ok}` либо `{ok: false, error}`.
  // Панель показывает текст ошибки рядом с кнопкой и не блокируется: пустой
  // экран вместо объяснения — худшее, что может случиться с анкетой (3.6).
  actions: {
    /** Сохранить персонажей карточки руками: `people` — `[{name, aliases, role}]`. */
    async saveCardCast(people) {
      const avatars = castAvatars(ctx());
      if (avatars.length !== 1) return { ok: false, error: 'карточка не выбрана' };
      const cast = saveCast(avatars[0], { people, source: 'manual', checked: true });
      await dropCastCandidates();
      refreshPanel();
      return { ok: true, cast };
    },

    /** Найти персонажей карточки моделью и записать как догадку на проверку. */
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

    async startTerm(survey, opts = {}) {
      // Таблица предметов и преподавателей набирается ДО старта — генерацией
      // или руками — и ложится в состояние отдельным действием (`setSubjects`).
      // Стартовать надо из неё, а не с чистого листа: пустые списки здесь
      // молча выбрасывали всё, что человек только что сохранил, и семестр
      // начинался с пустым расписанием. Поймано на живой таверне: кнопка
      // «начать семестр» была доступна (панель видела три предмета), а после
      // нажатия «Сегодня» говорила «на сегодня расписание пустое».
      const prev = live.state || {};
      const subjects = prev.subjects || [];
      const teachers = prev.teachers || [];
      const state = createState(live.preset, {
        survey,
        subjects,
        teachers,
        // Первый учебный день приходит из панели — там он показан человеку и
        // им же поправлен. Пусто — `createState` возьмёт своё умолчание.
        startDay: isDay(opts.startDay) ? opts.startDay : undefined,
        // Расписание к этому моменту уже собрано `setSubjects`; пересобираем
        // только если его почему-то нет, а предметы есть.
        schedule: (prev.schedule && Object.keys(prev.schedule).length)
          ? prev.schedule
          : buildSchedule(subjects, live.preset),
      });
      state.started = true;
      // Кто решает исход контрольного (`exams.examRule`): выбор прошлого
      // семестра этого чата переживает новый, а новый чат начинает с сюжета.
      state.examBy = EXAM_RULES.includes(prev.examBy) ? prev.examBy : 'story';
      // Новый семестр — новая история: снимок «до последнего ответа» из
      // времени до старта откатил бы свайп в семестр, которого не было.
      forgetTurns();
      await commit(state, { flush: true });
      setInjects({ oneShot: '' });
      await syncLorebook();
      refreshPanel();
      return { ok: true };
    },

    async generatePlan(survey) {
      const c = ctx();
      // Ответ идёт 20–60 секунд (ремонт 9.1.4): план, пришедший после смены
      // чата, в новый чат не ложится. Отказ — даже при неудаче запроса: текст
      // ошибки про чужой чат человеку тоже ни к чему.
      const op = captureOperation();
      const res = await api.generatePlan(survey, live.preset, storage.apiSettings(c), c);
      if (!isCurrent(op)) return chatChanged('генерировался план');
      if (!res.ok) return { ok: false, error: res.message || res.error || 'запрос не удался', raw: res.raw };
      const put = await host.actions.setSubjects(res.plan);
      if (!put.ok) return put;
      // Стоп-лист имён (9.3.6): генерация по анкете охотно называет
      // преподавателя именем героини или карточки. Выбросить такого нельзя —
      // предметы ссылаются на него по `teacherId`, и состояние перестало бы
      // проходить `validateState`, — поэтому план ложится целиком, а человеку
      // говорится, кого переименовать.
      const warnings = stopWarnings((res.plan && res.plan.teachers) || [], c, survey);
      // Оборванный план, который удалось спасти, ложится, но с пометкой: панель
      // подписывает таблицу честно («вот что успела»).
      const partial = res.partial ? { partial: true, notice: res.notice } : {};
      if (!warnings.length) return { ok: true, ...partial };
      try {
        if (globalThis.toastr && typeof globalThis.toastr.warning === 'function') {
          globalThis.toastr.warning(warnings.join(' '), 'Academy');
        }
      } catch { /* всплывашка — вежливость, не условие */ }
      return { ok: true, warnings, ...partial };
    },

    /** Правка таблицы предметов руками — тот же путь, что у генерации (3.6). */
    async setSubjects(plan) {
      // Таблица приносит только свои поля: имя, преподаватель, корпус и
      // аудитория у предмета; имя и черты у преподавателя. Всё прочее —
      // оценки, хвост, вид контрольного, отношение, портрет —
      // живёт в состоянии и сохраняется по `id`. Раньше строки нормализовались
      // с нуля, и «Сохранить таблицу» на идущем семестре молча стирало
      // зачётку и сбрасывало отношения к стартовым (поймано тестом проводки).
      // Поля таблицы авторитетны и пустыми: таблица шлёт `building: ''`, и
      // стёртый корпус — это «корпуса нет» (`ui.validateSubjectRows`). План из
      // генерации этих ключей не несёт — и корпус, вписанный руками, переживает
      // перегенерацию предмета с тем же `id`.
      const prevSubjects = new Map(((live.state && live.state.subjects) || []).map((s) => [s.id, s]));
      const prevTeachers = new Map(((live.state && live.state.teachers) || []).map((t) => [t.id, t]));
      const subjects = (plan.subjects || []).map((raw) => {
        const old = prevSubjects.get(String((raw && raw.id) || '').trim());
        return normalizeSubject(old ? { ...old, ...raw } : raw);
      });
      const teachers = (plan.teachers || []).map((raw) => {
        const old = prevTeachers.get(String((raw && raw.id) || '').trim());
        return normalizeTeacher(old ? { ...old, ...raw } : raw, live.preset);
      });
      // Расписание пересобирается здесь: панель шлёт только списки, а состояние
      // со ссылками на удалённый предмет не пройдёт `validateState` и уведёт её
      // в ветку «состояние повреждено».
      const state = {
        ...live.state,
        subjects,
        teachers,
        schedule: plan.schedule || buildSchedule(subjects, live.preset),
      };
      await commit(state, { flush: true });
      setInjects({});
      // Преподаватели — половина лорбука (3.7); правка таблицы меняет отпечаток,
      // и запись про каждого обновится тем же путём, что и после экзамена.
      await syncLorebook();
      refreshPanel();
      return { ok: true };
    },

    /**
     * Кто решает исход контрольного в этом чате: `'story'` или `'dice'`
     * (`exams.examRule`). Менять можно посреди семестра: правило действует на
     * контрольные, за которые ещё не садились, а посчитанный исход остаётся.
     */
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

    /** Разбор ответа секретарём — то же, что кнопка на плашке. */
    async analyzeMessage(mesId) {
      return analyzeMessage(Number.isInteger(mesId) ? mesId : lastEligible(chatOf()));
    },

    /**
     * Детали наставника — с вкладки «Люди»: портрет (9.7A п.15), должность,
     * «любит», тайна и черты. Отдельным действием, а не через `setSubjects`:
     * детали не меняют расписания, и пересобирать его ради них незачем.
     *
     * Ключа, которого в `patch` нет, не трогаем; пустая строка — убрать.
     * Нормализация та же, что держит состояние (`teacherDetails`: одна
     * строка, потолок длины). Черты — строкой через запятую или списком.
     * Негодный адрес портрета — отказ словами, состояние не пишется вовсе.
     * Лорбук пересобирается: запись про наставника несёт должность и тайну.
     */
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

    /** Убедиться, что каст молвы есть; нет — собрать (шаг 2 зовёт это перед выпуском). */
    ensureFeedCast: () => ensureFeedCast(),

    /** Кнопка «Обновить молву»: выпуск сейчас, независимо от счёта ответов. */
    refreshMolva: () => runMolva({}),

    /** Кнопка «Пересобрать каст»: статисты новые, сюжетики прежнего каста закрываются. */
    rebuildFeedCast: () => ensureFeedCast({ force: true }),

    /** Правка статиста руками: ник, типаж, интерес, цель, манера. */
    async updateFeedMember(id, patch = {}) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const next = cloneState(live.state);
      const res = updateFeedMember(next, id, patch);
      if (!res.ok) return res;
      await commit(next);
      refreshPanel();
      return res;
    },

    /**
     * Однокурсники — с части «Курс» вкладки «Люди» (шаг 2). Ручное добавление,
     * правка и удаление; кандидаты из сцены и лорбука — шаги 3 и 5. Стоп-лист
     * тот же, что у метки: героиня, карточка, заведение, слова пресета.
     * Лорбук пересобирается: у человека одна живая запись по имени.
     */
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

    /**
     * Портрет человека из состава — преподавателя или однокурсника — по id.
     * `value` — путь от корня таверны или ссылка http(s); пусто — убрать.
     * Это последний шаг единого пути картинки: файл с телефона
     * (`uploadPortrait`) и нарисованное генерацией сперва сохраняются в
     * таверну `portraits.savePortraitImage`, а сюда приходит только путь.
     * Лорбук не трогается: фото в нём нет.
     */
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

    /**
     * «Выбрать фото» на карточке: файл уменьшается в браузере, ложится в
     * `user/images/academy/` таверны, путь — в портрет (`setPortrait`).
     * Отказ на любом шаге — строкой под кнопкой, состояние не трогается.
     */
    async uploadPortrait(personId, file) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const known = [...(live.state.teachers || []), ...(live.state.classmates || [])].some((x) => x && x.id === personId);
      if (!known) return { ok: false, error: `человека «${personId}» нет ни среди преподавателей, ни на курсе` };
      const saved = await savePortraitImage(file, { personId });
      if (!saved.ok) return saved;
      const res = await host.actions.setPortrait(personId, saved.path);
      return res.ok ? { ...res, path: saved.path } : res;
    },

    /**
     * «Нарисовать» на карточке: промпт шаблоном из полей человека, картинка —
     * через провайдера таверны (`draw.js`), файл — в `user/images/academy/`
     * (или куда положила генерация таверны). Портрет НЕ ставится: сперва
     * превью, ставит его «Оставить» (`setPortrait`). Чат сменился, пока
     * рисовалось, — результат никуда не кладётся.
     *
     * @param {string} personId
     * @param {{signal?: AbortSignal}} [opts]
     */
    async drawPortrait(personId, opts = {}) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const teacher = (live.state.teachers || []).find((x) => x && x.id === personId);
      const classmate = teacher ? null : (live.state.classmates || []).find((x) => x && x.id === personId);
      const person = teacher || classmate;
      if (!person) return { ok: false, error: `человека «${personId}» нет ни среди преподавателей, ни на курсе` };
      const settings = storage.loadSettings(ctx());
      const subjects = teacher
        ? (live.state.subjects || []).filter((s) => s && s.teacherId === teacher.id).map((s) => String(s.name || s.id || ''))
        : [];
      const prompt = buildPortraitPrompt(person, {
        kind: teacher ? 'teacher' : 'classmate',
        subjects,
        presetId: String((live.preset && live.preset.id) || live.state.presetId || ''),
        basedOn: String((live.preset && live.preset.basedOn) || ''),
        style: settings.draw && settings.draw.style,
      });
      const op = captureOperation();
      const res = await drawImage(ctx(), settings.draw, prompt, { personId, signal: opts.signal });
      if (!res.ok) return res;
      if (!isCurrent(op)) return chatChanged('рисовался портрет');
      return { ok: true, path: res.path, route: res.route };
    },

    /**
     * Своё описание внешности человека (шаг 4): коротко, для промпта
     * рисования. Пусто — убрать. Лорбук и промпт чата его не видят.
     */
    async setLooks(personId, value = '') {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const next = cloneState(live.state);
      const person = [...(next.teachers || []), ...(next.classmates || [])].find((x) => x && x.id === personId);
      if (!person) return { ok: false, error: `человека «${personId}» нет ни среди преподавателей, ни на курсе` };
      const looks = normalizeLooks(String(value == null ? '' : value));
      if (looks) person.looks = looks;
      else delete person.looks;
      await commit(next);
      refreshPanel();
      return { ok: true, looks };
    },

    /**
     * Удалить однокурсника. Его запись в лорбуке уходит вместе с ним — это
     * нажатие кнопки, то есть явное действие (решение 6 в `lorebook.js`), и
     * правленую руками запись `pruneOrphans` всё равно не тронет.
     */
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

    /**
     * Своё событие чата (`core/holidays.mjs`): «вечеринка у Миражи в субботу».
     * Живёт в состоянии, поэтому откатывается вместе с ним; фон и разовый повод
     * у него те же, что у праздников пресета.
     */
    async addEvent(raw = {}) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const res = addEvent(cloneState(live.state), raw);
      if (!res.ok) return res;
      await commit(res.state);
      setInjects({});
      refreshPanel();
      return { ok: true, id: res.event.id };
    },

    /**
     * Свой значок под постом — переключатель. Украшение: состояние семестра,
     * отношения и промпт он не трогает; живёт в записи ленты и откатывается с
     * ней.
     */
    async feedReact(id, emoji) {
      if (!live.state || !live.state.feed) return { ok: false, error: 'ленты в этом чате нет' };
      const next = cloneState(live.state);
      const mine = toggleReact(next, id, emoji);
      if (mine === null) return { ok: false, error: 'этой записи больше нет' };
      await commit(next);
      refreshPanel();
      return { ok: true, mine };
    },

    /**
     * Поток (шаг 4). Открытый канал помечается прочитанным; новое знание
     * героини — прочитанные чужие стычки — уходит в фон строки состояния.
     */
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

    /**
     * «Взять в сюжет»: повод — в очередь, разово в следующую генерацию.
     * `text` — формулировка из превью (правленая); пусто — по умолчанию.
     */
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

    async dropHook(id) {
      if (!live.state) return { ok: false, error: 'семестра в этом чате нет' };
      const res = dropHook(live.plot, live.state, id);
      if (!res.ok) return { ok: false, error: 'такого повода в очереди нет' };
      live.plot = res.plot;
      savePlot();
      if (res.state !== live.state) await commit(res.state);
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

    /**
     * Ручной ремонт календаря. Панель говорит по-человечески — «на пару вперёд»,
     * «на день назад», — а `engine.manualTime` понимает `{unit, n}`; перевод
     * живёт здесь, чтобы ни ядро, ни панель не знали чужого словаря.
     */
    async manualTime(patch = {}) {
      const shift = patch.shift && typeof patch.shift === 'object'
        ? (Number.isFinite(patch.shift.days)
          ? { unit: 'day', n: patch.shift.days }
          : { unit: 'period', n: patch.shift.periods })
        : patch.shift;
      // Репутация снимается до и после: посчитать её разницу может только тот,
      // кто держит оба состояния, а сказать о ней надо человеку — прогулы,
      // зачтённые по его же просьбе, не должны всплыть потом сами собой.
      const was = (live.state && live.state.reputation && live.state.reputation.value) || 0;
      const res = manualTime(
        live.state,
        { day: patch.day, time: patch.time, shift, count: patch.count === true },
        live.preset,
      );
      if (!res.applied) return { ok: false, error: res.reason || 'календарь не сдвинулся' };
      const before = live.state;
      // Объявление итогов, до которого дошёл сдвиг, — сразу в факт следующего
      // ответа (9.4.3), а не ходом позже. Туда же — разовый повод праздника,
      // в день которого привёл ремонт.
      const moved = cloneState(res.state);
      armHolidayHooks(moved, live.preset);
      await commit(armPending(moved));
      setInjects({});
      noticeChanges(before, live.state, { source: 'manual' });
      refreshPanel();
      const now = (res.state.reputation && res.state.reputation.value) || 0;
      // Куда встали часы: панель после действия строится заново и без этих слов
      // не скажет человеку, перешагнул сдвиг пару или остановился на ней.
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

    /**
     * Ответ на придержанный прыжок времени вперёд. Панель спрашивает одной
     * кнопкой, ядро решает, что с ним делать (`engine.resolveHeldJump`).
     */
    async resolveJump(accept = true) {
      const before = live.state;
      const res = resolveHeldJump(live.state, live.preset, accept !== false);
      // Отклонение календарь не двигает, но состояние меняет: прыжка в нём
      // больше нет, и сохранить это надо так же, как принятие.
      //
      // Принятый прыжок может дойти до дня объявления итогов (9.4.3): факт
      // «итоги объявлены» ложится в `state.pending` и без `armPending` ушёл бы
      // в промпт только со следующим подсчитанным ответом — на ход позже.
      await commit(armPending(res.state));
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
      // Контекст нужен ради актуального API: проверка идёт тем же путём, каким
      // потом пойдёт генерация, — через подключение самой таверны.
      const res = await api.testConnection(storage.apiSettings(ctx()), { ctx: ctx() });
      return res.ok ? { ok: true, message: res.message } : { ok: false, error: res.message, code: res.code };
    },

    async listModels() {
      const res = await api.listModels(storage.apiSettings(ctx()));
      // `code` доезжает до панели: у «списка нет и быть не может» и у «сервер
      // не ответил» одинаковый `ok: false`, а показывать их надо по-разному.
      // `via: 'tavern-backend'` — список спросил сервер таверны, потому что
      // адрес не пускает запросы из браузера (9.1.7). Панель говорит об этом
      // строкой: ключ в этом случае прошёл через сервер таверны.
      return res.ok
        ? { ok: true, models: res.models, via: res.via || 'browser' }
        : { ok: false, models: [], error: res.message, code: res.code };
    },

    /** Кнопка «обновить лорбук»: та же синхронизация, но мимо сторожа отпечатка. */
    async syncLorebook() {
      const report = await syncLorebook({ force: true, immediately: true });
      refreshPanel();
      if (!report) return { ok: false, error: live.lorebook.error || 'лорбук выключен' };
      return report.ok ? { ok: true, name: report.name, wrote: report.wrote } : { ok: false, error: report.reason };
    },

    /**
     * Предложить запись про NPC или место. Расширение о них ничего не знает —
     * «может только предложить запись, а не сочинить её само» (3.7), — поэтому
     * содержание приходит от человека, а не из механики, и попадает не в
     * лорбук, а в список предложений.
     */
    async suggestLorebookEntry(raw = {}) {
      if (!raw.name) return { ok: false, error: 'предложению нужно имя' };
      live.lorebook.suggested = [
        ...live.lorebook.suggested.filter((x) => x.id !== (raw.id || raw.name)),
        { id: String(raw.id || raw.name), name: String(raw.name), note: String(raw.note || ''), kind: raw.kind === 'places' ? 'places' : 'people' },
      ];
      // Список предложений в отпечаток не входит: он считается из состояния, а
      // предложения в состоянии не живут. Поэтому отчёт пересобирается силой —
      // ничего не записав, потому что предложения ядро в `create` не кладёт.
      await syncLorebook({ force: true });
      refreshPanel();
      return { ok: true };
    },

    /** Принять предложение — единственный путь предложенной записи в лорбук. */
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

    /** Убрать осиротевшие записи. Только руками — см. комментарий у syncLorebook. */
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

    /**
     * Автозаполнение анкеты по карточке персонажа (3.6).
     *
     * **Состояние не пишется, и это главное свойство действия.** Наружу уходят
     * шесть полей, их место — поля формы, где человек их видит и правит.
     * Незаполненные поля ошибкой не считаются: `errors` вроде `no-country`
     * приезжают вместе с `ok: true`, потому что пустое поле человек допишет, а
     * тихо угаданный факультет он не заметит.
     */
    async guessSurvey() {
      const c = ctx();
      // Карточка — прошлого чата: её поля в анкете нового были бы чужими (9.1.4).
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

    /**
     * Выгрузка состояния (3.8). Файла здесь не появляется: действие отдаёт
     * готовый текст и имя, а Blob и скачивание живут в `ui.js` — это
     * единственное место, где нужен настоящий DOM. Так выгрузку можно прогнать
     * в Node целиком, кроме самого нажатия «сохранить как».
     */
    async exportState() {
      const res = storage.exportState(ctx(), live.preset, { extensionVersion: live.version || undefined });
      if (!res.ok) return { ok: false, error: res.message, code: res.code, errors: res.errors };
      return { ok: true, json: res.json, filename: res.filename, warnings: res.warnings, data: res.data };
    },

    /**
     * Загрузка состояния.
     *
     * Половина контракта из решения 4 в `storage.js`: без `opts.confirm` при
     * непустом чате или чужом пресете возвращается отказ `needs-confirm` со
     * сводками «что сейчас» и «что приедет», и только второй вызов пишет.
     * Отдельного действия «только разобрать» здесь нет намеренно: эти же
     * сводки приезжают с первым отказом, и второе действие с той же работой
     * было бы вторым местом, где эти сводки собираются.
     */
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
      // История ходов снята в `storage.importState`; здесь забывается взведённый
      // факт заменённого семестра.
      forgetTurns();
      reloadState();
      live.lastRun = null;
      // Приехало чужое состояние — прежний отпечаток лорбука про него ничего не
      // знает, и без сброса лорбук остался бы от заменённого семестра.
      live.lorebook.signature = null;
      setInjects({ oneShot: '' });
      await syncLorebook();
      refreshPanel();
      return { ok: true, replaced: res.replaced, warnings: res.warnings, status: res.status };
    },

    /**
     * Сменить пресет.
     *
     * Смена пресета на **уже начатом** семестре — опасное действие: слова, шкала
     * оценок и виды контрольных поменяются под живым состоянием, и «триумф» из
     * магической академии под русской шкалой перестанет считаться в средний
     * балл, оставшись при этом на экране. Поэтому здесь тот же двухшаговый
     * контракт, что у загрузки: без `opts.confirm` при начатом семестре
     * возвращается `needs-confirm` с теми же словами (`presetMismatchNote`),
     * которые человек читает при импорте чужого состояния. Запрет был бы проще,
     * но неверен: состояние переживает смену пресета целиком — предметы,
     * преподаватели, оценки и журнал лежат внутри него, — и человеку, который
     * завёл семестр не тем пресетом, некуда деваться.
     *
     * После подтверждения `state.presetId` переписывается на новый. Иначе
     * состояние и активный пресет расходились бы молча: выгрузка унесла бы
     * чужой `presetId`, и обратная загрузка ругалась бы на несовпадение,
     * которого нет.
     */
    async setPreset(id, opts = {}) {
      const wanted = String(id || '').trim();
      if (!wanted) return { ok: false, error: 'не сказано, какой пресет ставить' };
      const active = String((live.preset && live.preset.id) || '');
      if (wanted === active) return { ok: true, changed: false };

      const started = Boolean(live.state && live.state.started);
      if (started && opts.confirm !== true) {
        // Слово периода — из пресета: «семестр» тут был бы русским вузом,
        // прописанным в общем коде, ровно как «пропущено пар» в `commands.js`.
        const vocab = (live.preset && live.preset.vocab) || {};
        // Пресеты — названиями, а не id: «jp-highschool» человеку ничего не
        // говорит. Остаётся то, что лежит в состоянии (предметы, люди, оценки,
        // журнал); из нового пресета — слова, шкала, контрольные и звонки.
        // Про часы говорим заранее: после смены они встанут по звонкам нового
        // пресета (`alignToGrid` ниже), и человек, не знающий об этом, читает
        // сдвиг как поломку. Слова — активного пресета: новый ещё и не
        // загружен (`loadPreset` ниже, после подтверждения).
        const question = {
          title: fill(PRESET_TEXT.switchTitle, { to: presetName(wanted) }),
          note: fill(PRESET_TEXT.switchNote, { teachers: vocab.teacherPlural || 'преподаватели' }),
        };
        return {
          ok: false,
          code: 'needs-confirm',
          needsConfirm: true,
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
      // Подтверждение давалось про состояние прошлого чата (9.1.4).
      if (!isCurrent(op)) return chatChanged('загружался пресет');

      live.presetNotice = '';
      await switchPreset(wanted, next);
      return { ok: true, changed: true, preset: wanted };
    },

    /**
     * Выгрузить пресет файлом (9.3.2) — свой или встроенный. Встроенный — как
     * основу для своего: конверт помнит его `basedOn`, и копия, которую
     * человек правит и загружает обратно, недостающее возьмёт из него же.
     * Файла, как и у выгрузки состояния, здесь не появляется: Blob — в `ui.js`.
     */
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

    /**
     * Превью перед загрузкой (9.3.2): что это за заведение и под каким `id` оно
     * ляжет. Ничего не пишет. Проверка — та же, что при загрузке, целиком,
     * включая пробный прогон: превью, которое обещает то, от чего загрузка
     * потом откажется, хуже отсутствия превью.
     */
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

    /**
     * Загрузить пресет (9.3.2). `opts.apply` — «добавить и применить»: сразу
     * после добавления идёт обычная смена пресета со всеми её вопросами
     * (идущий семестр — `needs-confirm`). Пресет к этому моменту уже добавлен,
     * и отказ от смены его не отменяет — об этом говорит `added` в ответе.
     */
    async importPreset(source, opts = {}) {
      const res = await readAndNormalize(source);
      if (!res.ok) return res;
      const c = ctx();
      if (storage.listUserPresets(c).length >= USER_PRESETS_MAX) {
        return { ok: false, code: 'full', error: fill(PRESET_TEXT.full, { max: USER_PRESETS_MAX }) };
      }
      // Хранится уже нормализованный пресет: полный, с ключами основы. Так
      // файл, выгруженный из настроек, самодостаточен и у того, у кого основа
      // другой версии.
      storage.putUserPreset(c, { ...res.preset, id: res.id, displayName: res.name });
      live.presets = await loadPresetList(live.preset);
      if (opts.apply !== true) {
        refreshPanel();
        return { ok: true, added: res.id, name: res.name, warnings: res.warnings };
      }
      const applied = await host.actions.setPreset(res.id, { confirm: opts.confirm === true });
      return { ...applied, added: res.id, name: res.name, warnings: res.warnings };
    },

    /**
     * Удалить свой пресет. Встроенные не удаляются: это файлы расширения.
     *
     * Удаляемый пресет может быть активным — тогда откат на встроенный
     * (9.3.2): на ту основу, поверх которой он лежал, иначе на русский вуз, с
     * сообщением. На идущем семестре это та же смена пресета, что и руками, и
     * спрашивается так же (`needs-confirm`). Чаты, заведённые этим пресетом,
     * не переписываются: их проверяет `checkStatePreset` при открытии.
     */
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
  },
};

function refreshPanel() {
  if (live.panel && typeof live.panel.render === 'function') live.panel.render();
  renderPanels();
}

// --- запуск -----------------------------------------------------------------

/**
 * Предупреждение про `encode_tags`.
 *
 * Единственная штатная настройка таверны, при которой служебная метка перестаёт
 * быть невидимой: `<` экранируется до showdown (script.js:1821), и комментарий
 * становится видимым текстом. Молча ломаться нельзя — про это должна знать
 * пользовательница, а не только отладка.
 */
function markerVisibleRisk() {
  const power = ctx().powerUserSettings || {};
  return Boolean(power.encode_tags);
}

async function init() {
  const c = ctx();
  // Ключи и генерация картинок таверны — для «Нарисовать» (`draw.js`).
  // Не ждём: панели они нужны не сразу, а промах значит лишь «рисовать нечем».
  loadTavernModules().catch(() => {});
  // Настройки читаются ПЕРВЫМИ: в них лежит выбранный пресет, и загружать
  // русский вуз, чтобы следом заменить его магической академией, значило бы
  // показать человеку чужую панель на полсекунды при каждой загрузке страницы.
  const settings = storage.loadSettings(c);
  const wanted = String(settings.preset || DEFAULT_BASE);

  try {
    live.preset = await loadPreset(wanted);
  } catch (err) {
    console.error(`[${MODULE}] пресет ${wanted} не загружен:`, err);
    if (wanted === DEFAULT_BASE) {
      console.error(`[${MODULE}] расширение молчит целиком`);
      return;
    }
    // Выбранный пресет исчез (папку почистили, свой пресет удалили на другом
    // устройстве, файл перестал проходить проверку) — это не повод оставить
    // человека без панели вовсе: возврат к тому, что точно есть, и сообщение
    // (9.3.2). Основа своего пресета, если он ещё лежит в настройках, лучше
    // русского вуза: слова у неё ближе к тем, к которым человек привык.
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
  // Откат выше уже сказал про пропавший пресет — вторая всплывашка о нём же
  // была бы шумом.
  if (!live.presetNotice) checkStatePreset();

  try {
    const ui = await import('./ui.js');
    live.panel = ui.mountPanel(host);
    ui.mountButton(host);
    ui.mountSettings(host);
  } catch (err) {
    console.error(`[${MODULE}] панель не смонтирована:`, err);
  }

  // Слэш-команды — приятная добавка, а не условие работы: в сборке без
  // `SlashCommandParser` (или если модуль команд не загрузился) расширение
  // обязано остаться живым, поэтому здесь свой try/catch, а не общий.
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
  // Плашки под ответами: таверна перерисовывает сообщения сама (новый ответ,
  // свайп, подгрузка истории), и плашку надо вернуть на место.
  for (const name of ['CHARACTER_MESSAGE_RENDERED', 'MORE_MESSAGES_LOADED', 'MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'CHAT_CHANGED']) {
    if (t[name]) ev.on(t[name], () => renderPanels());
  }
  // Генерации (ремонт 9.1.2, 9.1.3). Сборка без этих событий — не повод молчать
  // целиком: тогда просто нет гашения под фоновые генерации.
  if (t.GENERATION_STARTED) ev.on(t.GENERATION_STARTED, (type, params, dryRun) => handleGenerationStarted(type, params, dryRun));
  // Реплика игрока: снимает отданный повод и решает «(без сплетен)» (шаг 4).
  // Мимо журнала `traced`: он про ответы модели и держит последние шесть.
  if (t.MESSAGE_SENT) {
    ev.on(t.MESSAGE_SENT, (mesId) => handlePlayerSent(mesId).catch((err) => {
      console.error(`[${MODULE}] реплика #${mesId}: поводы не обновлены:`, err);
    }));
  }
  if (t.GENERATION_ENDED) ev.on(t.GENERATION_ENDED, () => handleGenerationEnded());
  if (t.GENERATION_STOPPED) ev.on(t.GENERATION_STOPPED, () => handleGenerationEnded());

  // Макрос `{{academy}}` (9.3.1). Регистрируется всегда: галочка «через макрос»
  // гасит только автоинжект, а сам макрос работает при любой галочке.
  live.macro = registerMacro(c);

  // Факт, взведённый последним ходом до F5, доходит до следующего ответа (9.1.2).
  setInjects({ oneShot: armedOneShot() });
  refreshPanel();
  console.log(`[${MODULE}] готово, папка ${EXT_NAME}`);
}

// --- window.AcademyAPI (9.4.8, 9.7B) ------------------------------------------

/**
 * Версия формы API — отдельно от версии расширения: соседу важно, какие
 * методы есть, а не какой сейчас релиз. Растёт, только если что-то убрано
 * или поменяло смысл; новые методы и поля её не двигают.
 */
const API_VERSION = 1;

/** Ответ API без исключений: сосед, позвавший нас в неудачный момент, получает `null`. */
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

/**
 * Публичный вход для соседей. Всё только на чтение, всё возвращает новые
 * объекты (копии): правка ответа у соседа состояние семестра не трогает.
 * Слова — пресета, числа отношений и репутации наружу не идут (3.3), итог,
 * который мир ещё не знает, — тоже (9.4.3).
 *
 * - `now()` — `{started, day, time, precision, weekday}` или `null`;
 * - `today()` — день, неделя, фаза, текущее и следующее занятие;
 * - `summary()` — «второй триместр, среда, 3-й урок, красные баллы: 1»;
 * - `journal(n)` — последние `n` событий (до 50) полями, без технического
 *   текста внутреннего журнала;
 * - `milestones()` — вехи по миру: `[{id, kind, name, when}]`;
 * - `version` — версия расширения из манифеста, `apiVersion` — форма API;
 * - `events` — имена событий `academy:*`.
 *
 * Вешается на `window` при загрузке модуля, до чтения пресета: сосед,
 * загрузившийся следом, находит объект сразу, а методы до готовности
 * отвечают `null`.
 */
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
      id: m.id, kind: m.kind, name: milestoneName(m, live.state, live.preset), when: m.when || null,
    }))
    : []), []),
});

try {
  globalThis.AcademyAPI = AcademyAPI;
} catch (err) {
  console.warn(`[${MODULE}] AcademyAPI не повешен на window:`, err);
}

/**
 * Запуск. Обещание держится наружу (`__seam.ready`), потому что запуск стал
 * асинхронным по-настоящему: пресет, манифест и список пресетов — четыре
 * похода за файлами. Прогон, который ждал их фиксированной паузой, был бы
 * зелёным ровно до первого медленного диска.
 */
const ready = init();

/**
 * Шов с панелью, открытый для прогона.
 *
 * `ui.js` и `index.js` писались порознь по общему контракту, а швы этапа 1
 * научили, что расхождения между такими половинами находятся исполнением, а не
 * чтением. Браузера в прогоне нет, панель не монтируется — значит действия надо
 * звать напрямую. Ничего, кроме тестов, сюда ходить не должно.
 */
export const __seam = { host, live, ready, api: AcademyAPI, examSeedBase, panel: panelHost };

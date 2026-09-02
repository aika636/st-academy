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

import { applyResponse, sitExam } from './core/engine.mjs';
import { buildPrompt } from './prompt.mjs';
import { sittableExams } from './core/exams.mjs';
import {
  createState, defaultStartDay, isDay, joinSentences, normalizeSubject, normalizeTeacher,
} from './core/state.mjs';
import { parseContext } from './core/parse-context.mjs';
import { buildSchedule } from './core/schedule.mjs';
import { manualTime, resolveHeldJump } from './core/engine.mjs';
import { alignToGrid } from './core/time.mjs';
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
 * Пресеты, лежащие в папке. Список именно здесь, а не в панели: панель про
 * файлы ничего не знает, а `id` — это имя файла, то есть факт раскладки папки.
 * Отображаемые имена берутся из самих пресетов (`displayName`) — слова
 * заведения в код не едут.
 */
const PRESET_IDS = ['ru-university', 'jp-highschool', 'magic-academy'];

/** Ключи инжектов. Три разных: постоянный, инструкция и одноразовый (3.3, 3.5). */
const INJECT = {
  status: 'academy_status',
  marker: 'academy_marker',
  oneShot: 'academy_oneshot',
};

const ctx = () => SillyTavern.getContext();

/** Живое состояние вкладки: пресет, семестр и снимки «до ответа». */
const live = {
  preset: null,
  state: null,
  report: null,
  /** Снимок до применённого ответа: свайп и правка обязаны откатывать (см. ниже). */
  snapshots: new Map(),
  /** Какой ответ уже посчитан: id сообщения и отпечаток текста. */
  applied: { mesId: null, stamp: null },
  panel: null,
  lastRun: null,
  /**
   * Лорбук (3.7). `signature` — отпечаток того, чем лорбук должен быть; пока он
   * не изменился, в World Info не ходят вовсе. `suggested` — предложения про
   * NPC и места: они живут в памяти вкладки и в лорбук сами не попадают.
   */
  lorebook: { signature: null, report: null, error: null, suggested: [] },
  /** Список пресетов для выбора в панели: `[{id, name}]`. */
  presets: [],
  /** Версия из `manifest.json` — единственная правда о ней (см. `storage.js`). */
  version: '',
};

// --- пресет -----------------------------------------------------------------

/**
 * Пресет читается файлом из папки расширения. Своих правил у `index.js` нет:
 * если пресет не читается, расширение молчит целиком, а не играет умолчаниями.
 */
async function loadPreset(id = 'ru-university') {
  const url = `/scripts/extensions/${EXT_NAME}/presets/${id}.json`;
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`пресет ${id} не читается: HTTP ${res.status}`);
  return res.json();
}

/**
 * Имена пресетов для выбора в панели.
 *
 * Читается один раз при запуске и по одному отдельному промаху не роняется:
 * пресет, файл которого не прочитался, в списке остаётся под своим `id`.
 * Выбрать его всё равно можно — и тогда отказ придёт в ответ на выбор, текстом
 * рядом с кнопкой, а не пустым списком, из которого не видно, что вообще
 * случилось.
 */
async function loadPresetList(active) {
  const out = [];
  for (const id of PRESET_IDS) {
    if (active && active.id === id) {
      out.push({ id, name: String(active.displayName || active.name || id) });
      continue;
    }
    try {
      const p = await loadPreset(id);
      out.push({ id, name: String((p && (p.displayName || p.name)) || id) });
    } catch (err) {
      console.warn(`[${MODULE}] пресет ${id} не прочитан для списка:`, err);
      out.push({ id, name: id, broken: true });
    }
  }
  return out;
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
  return report;
}

async function commit(state, { flush = false } = {}) {
  live.state = state;
  if (flush) return storage.flushState(ctx(), state);
  return storage.saveState(ctx(), state);
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
  const c = ctx();
  const settings = storage.loadSettings(c);
  const types = c.extension_prompt_types || { IN_CHAT: 1 };
  const roles = c.extension_prompt_roles || { SYSTEM: 0 };
  const depth = Number.isFinite(settings.injectDepth) ? settings.injectDepth : 1;

  const started = Boolean(live.state && live.state.started);
  const withMarker = Boolean(settings.injectMarker) && settings.mode !== 'context';
  const built = started
    ? buildPrompt(live.state, live.preset, { injects: [], withMarker })
    : { status: '', instruction: '', oneShot: '' };

  // Порядок аргументов — (key, value, position, depth, scan, role, filter).
  // JSDoc над `setExtensionPrompt` (script.js:8866) переставляет scan и role
  // местами и врёт; сверено с телом функции.
  c.setExtensionPrompt(INJECT.status, built.status, types.IN_CHAT, depth, false, roles.SYSTEM);
  c.setExtensionPrompt(INJECT.marker, built.instruction, types.IN_CHAT, depth + 1, false, roles.SYSTEM);
  if (oneShot !== null) {
    c.setExtensionPrompt(INJECT.oneShot, oneShot, types.IN_CHAT, 0, false, roles.SYSTEM);
  }
}

/** Снять одноразовый инжект: он уже отработал свою генерацию. */
function clearOneShot() {
  const c = ctx();
  const types = c.extension_prompt_types || { IN_CHAT: 1 };
  const roles = c.extension_prompt_roles || { SYSTEM: 0 };
  c.setExtensionPrompt(INJECT.oneShot, '', types.IN_CHAT, 0, false, roles.SYSTEM);
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

  try {
    const report = await lorebook.syncLorebook(c, live.state, live.preset, {
      settings,
      npcs: live.lorebook.suggested.filter((x) => x.kind !== 'places'),
      places: live.lorebook.suggested.filter((x) => x.kind === 'places'),
      immediately,
    });
    live.lorebook.report = report;
    live.lorebook.error = null;
    // Отпечаток запоминается только после удачного похода: иначе одна неудача
    // (сеть, старая сборка) заперла бы лорбук до конца сессии.
    if (report && report.ok) live.lorebook.signature = signature;
    return report;
  } catch (err) {
    // Лорбук — необязательная часть (3.7). Уронить им обработку ответа, то есть
    // зачётку и календарь, нельзя ни при каких условиях.
    console.error(`[${MODULE}] лорбук не обновлён:`, err);
    live.lorebook.error = String((err && err.message) || err);
    return null;
  }
}

// --- обработка ответа модели ------------------------------------------------

/** Отпечаток текста: по нему видно, что тот же самый ответ уже посчитан. */
function stamp(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return `${text.length}:${h}`;
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
 * ним.** Ищется он источником A (`parseContext`) по последним сообщениям, и
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
    const hit = parseContext(String(m.mes || ''));
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
 */
async function handleMessage(mesId, { source = 'received' } = {}) {
  if (!live.preset || !live.state || !live.state.started) return;
  const c = ctx();
  const message = c.chat && c.chat[mesId];
  if (!message || message.is_user || message.is_system) return;

  const text = String(message.mes || '');
  const mark = stamp(text);
  if (live.applied.mesId === mesId && live.applied.stamp === mark) return;

  const before = live.snapshots.has(mesId) ? live.snapshots.get(mesId) : live.state;
  live.snapshots.set(mesId, before);

  const settings = storage.loadSettings(c);
  const run = applyResponse(before, text, live.preset, {
    mode: settings.mode,
    relativeWords: settings.relativeWords,
    // Обещание движку: за сегодняшнее контрольное сажает этот файл (ниже), и
    // оценку модели по нему он заберёт сам (8.1).
    sitsExam: true,
  });

  let state = run.state;
  const injects = [...run.injects];
  let permission = '';

  // Сессия: исход считается до того, как модель его опишет, и не чаще раза в
  // день — иначе лента из четырёх контрольных сгорела бы за четыре ответа.
  // Оценка, которую модель выставила за сегодняшнее контрольное, придержана
  // движком и не ушла в зачётку второй записью (8.1): её забирает бросок.
  const exam = maybeSitExam(state, run.modelSaid);
  if (exam) {
    state = exam.state;
    injects.push(...exam.injects);
    permission = exam.permission;
    run.exam = exam.exam;
    run.divergence = exam.divergence || run.divergence;
  }

  live.applied = { mesId, stamp: mark };
  live.lastRun = { ...run, injects, permission, source, mesId };
  await commit(state);

  const oneShot = [permission, ...injects.map((i) => i.text)].filter(Boolean).join(' ');
  setInjects({ oneShot });
  await syncLorebook();
  refreshPanel();
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
function maybeSitExam(state, modelSaid) {
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
  const res = sitExam(state, live.preset, modelSaid
    ? { examId: modelSaid.examId, modelSaid: modelSaid.value }
    : {});
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
 * Работает на оба случая. Новая генерация — состояние откатывается здесь, а
 * MESSAGE_RECEIVED следом считает новый текст. Переключение на готовый свайп —
 * MESSAGE_RECEIVED не придёт, поэтому текст считается прямо отсюда.
 */
async function handleSwipe(mesId) {
  if (!live.preset || !live.state) return;
  if (live.snapshots.has(mesId)) {
    live.applied = { mesId: null, stamp: null };
    await commit(live.snapshots.get(mesId));
    clearOneShot();
  }
  await handleMessage(mesId, { source: 'swipe' });
}

/** Правка сообщения руками: тот же откат и пересчёт. */
async function handleEdited(mesId) {
  if (!live.snapshots.has(mesId)) return;
  live.applied = { mesId: null, stamp: null };
  await commit(live.snapshots.get(mesId));
  await handleMessage(mesId, { source: 'edited' });
}

/**
 * Удаление сообщения. Аргументом приходит длина чата, а не индекс
 * (script.js:1609 и соседи) — по ней и считается, какие снимки больше не нужны.
 */
async function handleDeleted(length) {
  const gone = [...live.snapshots.keys()].filter((id) => id >= length);
  if (!gone.length) return;
  const earliest = Math.min(...gone);
  const before = live.snapshots.get(earliest);
  for (const id of gone) live.snapshots.delete(id);
  if (!before) return;
  live.applied = { mesId: null, stamp: null };
  await commit(before);
  clearOneShot();
  refreshPanel();
}

async function handleChatChanged() {
  live.snapshots.clear();
  live.applied = { mesId: null, stamp: null };
  live.lastRun = null;
  // Лорбук у каждого чата свой: и отпечаток, и предложения — из прошлого чата,
  // и переносить их в новый значило бы дописать чужому чату чужие записи.
  live.lorebook = { signature: null, report: null, error: null, suggested: [] };
  reloadState();
  setInjects({ oneShot: '' });
  // Первая синхронизация в чате нужна и без нового события: в лорбуке может не
  // быть ничего (галочку включили в прошлом чате), а отпечаток сброшен выше.
  await syncLorebook();
  refreshPanel();
}

// --- хост для панели --------------------------------------------------------

/**
 * Всё, что панель знает о внешнем мире. Ни `fetch`, ни `chat_metadata`, ни
 * события таверны в `ui.js` не попадают — иначе интерфейс нельзя проверить
 * ничем, кроме живого браузера.
 */
const host = {
  getState: () => live.state,
  getReport: () => live.report,
  getPreset: () => live.preset,
  /** Из чего выбирать пресет и что выбрано сейчас. Имена — из самих пресетов. */
  getPresets: () => ({
    active: String((live.preset && live.preset.id) || ''),
    list: live.presets.map((p) => ({ ...p })),
  }),
  getSettings: () => storage.loadSettings(ctx()),
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
  markerVisibleRisk,

  /**
   * Всё про лорбук одним куском (3.7). `suggest` здесь — предложения, которые
   * ждут решения человека: сами в лорбук они не уйдут никогда.
   */
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
      await commit(state, { flush: true });
      setInjects({ oneShot: '' });
      await syncLorebook();
      refreshPanel();
      return { ok: true };
    },

    async generatePlan(survey) {
      const c = ctx();
      const res = await api.generatePlan(survey, live.preset, storage.apiSettings(c), c);
      if (!res.ok) return { ok: false, error: res.message || res.error || 'запрос не удался', raw: res.raw };
      const put = await host.actions.setSubjects(res.plan);
      return put.ok ? { ok: true } : put;
    },

    /** Правка таблицы предметов руками — тот же путь, что у генерации (3.6). */
    async setSubjects(plan) {
      const subjects = (plan.subjects || []).map(normalizeSubject);
      const teachers = (plan.teachers || []).map((t) => normalizeTeacher(t, live.preset));
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
      await commit(res.state);
      setInjects({});
      refreshPanel();
      const now = (res.state.reputation && res.state.reputation.value) || 0;
      return {
        ok: true,
        missed: res.missed.length,
        wouldMiss: res.wouldMiss,
        reputation: now === was ? null : { from: was, to: now },
      };
    },

    /**
     * Ответ на придержанный прыжок времени вперёд. Панель спрашивает одной
     * кнопкой, ядро решает, что с ним делать (`engine.resolveHeldJump`).
     */
    async resolveJump(accept = true) {
      const res = resolveHeldJump(live.state, live.preset, accept !== false);
      // Отклонение календарь не двигает, но состояние меняет: прыжка в нём
      // больше нет, и сохранить это надо так же, как принятие.
      await commit(res.state);
      if (accept !== false && !res.applied) {
        return { ok: false, error: res.reason || 'прыжок не применился' };
      }
      setInjects({});
      refreshPanel();
      return { ok: true, missed: res.missed.length };
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
      return res.ok ? { ok: true, models: res.models } : { ok: false, models: [], error: res.message, code: res.code };
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
      const res = await lorebook.acceptSuggestion(ctx(), entry, { settings: storage.loadSettings(ctx()) });
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
      const res = await lorebook.pruneOrphans(ctx(), orphans, { settings: storage.loadSettings(ctx()) });
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
      const res = await api.guessSurvey(live.preset, storage.apiSettings(c), c);
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
      reloadState();
      live.snapshots.clear();
      live.applied = { mesId: null, stamp: null };
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
        const term = (live.preset && live.preset.vocab && live.preset.vocab.term) || 'учёба';
        return {
          ok: false,
          code: 'needs-confirm',
          needsConfirm: true,
          // Склейка — через `joinSentences`, а не через шаблон: `presetMismatchNote`
          // написан как фрагмент списка, со строчной буквы, и в шаблоне давал
          // «Идёт круг. состояние собрано с пресетом…».
          // Слова — активного пресета: человек читает это предупреждение в
          // панели, которая прямо сейчас говорит именно ими; новый пресет ещё
          // и не загружен (`loadPreset` ниже, после подтверждения).
          error: joinSentences([
            `Идёт ${term}`,
            storage.presetMismatchNote(active, wanted, live.preset),
            // Про часы говорим заранее: после смены они встанут по звонкам
            // нового пресета (`alignToGrid` ниже), и человек, не знающий об
            // этом, читает сдвиг как поломку.
            'часы календаря встанут по звонкам нового пресета',
            'Подтвердите смену',
          ]),
          reasons: [storage.presetMismatchNote(active, wanted, live.preset)],
          current: storage.stateSummary(live.state),
          incoming: null,
        };
      }

      let next;
      try {
        next = await loadPreset(wanted);
      } catch (err) {
        return { ok: false, error: `пресет ${wanted} не загрузился: ${(err && err.message) || err}` };
      }

      storage.saveSettings({ preset: wanted }, ctx());
      live.preset = next;
      if (live.state && live.state.presetId !== wanted) {
        // Часы привязываются к сетке звонков нового пресета. Состояние смену
        // переживает, а сетка берётся из активного пресета — и без этой правки
        // панель показывала две соседние строки с разным временем: в шапке
        // старые 15:00, а в «Сейчас» 14:05, начало той пары, в которую они
        // попадают по новой сетке. Поймано на живой таверне.
        const aligned = alignToGrid({ ...live.state, presetId: wanted }, next);
        await commit(aligned.state, { flush: true });
      }
      reloadState();
      setInjects({ oneShot: '' });
      // Лорбук говорит словами пресета: тексты записей после смены другие.
      live.lorebook.signature = null;
      await syncLorebook();
      refreshPanel();
      return { ok: true, changed: true, preset: wanted };
    },

    async refresh() { reloadState(); refreshPanel(); },
  },
};

function refreshPanel() {
  if (live.panel && typeof live.panel.render === 'function') live.panel.render();
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
  // Настройки читаются ПЕРВЫМИ: в них лежит выбранный пресет, и загружать
  // русский вуз, чтобы следом заменить его магической академией, значило бы
  // показать человеку чужую панель на полсекунды при каждой загрузке страницы.
  const settings = storage.loadSettings(c);
  const wanted = String(settings.preset || 'ru-university');

  try {
    live.preset = await loadPreset(wanted);
  } catch (err) {
    console.error(`[${MODULE}] пресет ${wanted} не загружен:`, err);
    if (wanted === 'ru-university') {
      console.error(`[${MODULE}] расширение молчит целиком`);
      return;
    }
    // Выбранный пресет исчез (папку почистили, файл переименовали) — это не
    // повод оставить человека без панели вовсе: возврат к тому, что точно есть.
    try {
      live.preset = await loadPreset('ru-university');
      storage.saveSettings({ preset: 'ru-university' }, c);
    } catch (err2) {
      console.error(`[${MODULE}] пресет не загружен, расширение молчит:`, err2);
      return;
    }
  }

  live.version = await loadVersion();
  live.presets = await loadPresetList(live.preset);
  reloadState();

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
  ev.on(t.MESSAGE_RECEIVED, (mesId) => handleMessage(mesId));
  ev.on(t.MESSAGE_SWIPED, (mesId) => handleSwipe(mesId));
  ev.on(t.MESSAGE_EDITED, (mesId) => handleEdited(mesId));
  ev.on(t.MESSAGE_UPDATED, (mesId) => handleEdited(mesId));
  ev.on(t.MESSAGE_DELETED, (length) => handleDeleted(length));
  ev.on(t.CHAT_CHANGED, () => handleChatChanged());

  setInjects({ oneShot: '' });
  refreshPanel();
  console.log(`[${MODULE}] готово, папка ${EXT_NAME}`);
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
export const __seam = { host, live, ready };

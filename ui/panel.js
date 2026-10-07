// ui/panel.js — оболочки: панель с вкладками, перетаскиваемая кнопка вызова
// и блок в меню расширений. Единственный файл, который знает все вкладки.

import {
  bindRedraw, uiLabels, formatDate, mounted, el, clear, sectionOpen, setSectionScope, safe,
} from './common.js';
import { achievementsView, renderAchievements } from './achievements.js';
import { peopleView, renderPeople } from './people.js';
import { feedView, renderFeed } from './feed.js';
import { unreadCount } from '../core/feed.mjs';
import { gradebookView, renderGradebook } from './gradebook.js';
import { todayView, renderToday } from './today.js';
import { debugView, renderDebug } from './debug.js';
import {
  renderApiBlock, renderModeBlock, renderPresetBlock, renderDebugBlock,
} from './settings-blocks.js';
import { settingsView, renderSettings, hostExtra } from './settings.js';

/**
 * Вкладки плана (3.9) и «Достижения» — страница вех, которые раньше жили
 * мелким блоком под зачёткой и тостом, а потом терялись.
 */
export const TABS = [
  { id: 'today', label: 'Сегодня' },
  { id: 'gradebook', label: 'Зачётка' },
  { id: 'people', label: 'Люди' },
  // Лента курса (шаг 4): чат курса, анонимка и «Взять в сюжет».
  { id: 'feed', label: 'Поток' },
  { id: 'achievements', label: 'Достижения' },
  { id: 'settings', label: 'Настройки' },
];

/**
 * Пятая вкладка появляется только при включённой галочке отладки, и слова у неё
 * технические — в пресеты они не едут (см. `DEBUG_TEXT`). Отдельной константой,
 * а не пунктом `TABS`, ровно потому, что она условная: «при выключенной отладке
 * ничего лишнего на экране» здесь понимается буквально — вкладки нет.
 */
export const DEBUG_TAB = { id: 'debug', label: 'Отладка' };

/** Иконки вкладок (Font Awesome 6 из таверны) — по id, ярлыки остаются пресету. */
export const TAB_ICONS = {
  today: 'fa-sun', gradebook: 'fa-book-open', people: 'fa-users', feed: 'fa-comments', achievements: 'fa-trophy',
  settings: 'fa-gear', debug: 'fa-bug',
};

/**
 * Ярлыки вкладок — из пресета: «Зачётка» у магической академии своя.
 *
 * Настройки — второй, необязательный аргумент: без них вкладок ровно четыре, с
 * включённой отладкой добавляется пятая. Вызов без настроек (а таких в коде и в
 * тестах хватает) обязан вести себя как «отладка выключена».
 */
export function tabsFor(preset, settings) {
  const U = uiLabels(preset);
  const label = {
    today: U.tabToday,
    gradebook: U.tabGradebook,
    people: U.tabPeople,
    feed: U.tabFeed,
    achievements: U.tabAchievements,
    settings: U.tabSettings,
  };
  const tabs = TABS.map((t) => ({ ...t, label: label[t.id] || t.label }));
  return settings && settings.debug === true ? [...tabs, { ...DEBUG_TAB }] : tabs;
}

const ID = {
  panel: 'academy_panel',
  button: 'academy_button',
  settings: 'academy_settings_block',
};

/** Порог, за которым жест считается перетаскиванием, а не тапом (3.9). */
const DRAG_THRESHOLD = 6;

/* --- панель --------------------------------------------------------------- */

/**
 * Смонтировать панель. Хост — единственный канал наружу.
 *
 * @param {Object} host
 * @param {() => (Object|null)} host.getState
 * @param {() => Object} host.getPreset
 * @param {() => Object} host.getSettings
 * @param {(patch: Object) => void} host.setSettings глубокое слияние
 * @param {Object} host.actions см. `call()` — все асинхронные, все могут отказать
 * @returns {{open: Function, close: Function, toggle: Function, render: Function, destroy: Function}}
 */
export function mountPanel(host) {
  mounted.host = host;
  if (mounted.panel && mounted.panel.isConnected) {
    renderPanel(host);
    return panelApi(host);
  }

  const panel = el('div', { id: ID.panel, class: 'academy-panel draggable', role: 'dialog', 'aria-label': 'Академия' }, [
    el('div', { class: 'academy-bar panelControlBar' }, [
      el('div', { class: 'academy-grab drag-grabber fa-solid fa-grip-vertical', title: 'Перетащить' }),
      el('div', { class: 'academy-logo' }, [el('i', { class: 'fa-solid fa-graduation-cap', 'aria-hidden': 'true' })]),
      el('div', { class: 'academy-titles' }, [
        el('div', { class: 'academy-title', text: 'Академия' }),
        el('div', { class: 'academy-subtitle' }),
      ]),
      el('div', {
        class: 'academy-close dragClose fa-solid fa-xmark',
        title: 'Закрыть',
        onclick: () => closePanel(),
      }),
    ]),
    // Полоса вкладок наполняется в `renderPanel`, а не здесь: набор вкладок
    // теперь зависит от настроек (пятая появляется с галочкой отладки), а
    // ярлыки — от пресета, который тоже может смениться после монтирования.
    el('div', { class: 'academy-tabs' }),
    el('div', { class: 'academy-body' }),
  ]);

  const holder = document.getElementById('movingDivs') || document.body;
  holder.append(panel);
  mounted.panel = panel;

  // Панель помнит, куда её перетащили. На узком экране — не помнит: там она
  // прибита к верху, и восстановленные координаты увели бы её за экран.
  const saved = safe(() => (host.getSettings() || {}).ui, {}) || {};
  if (Number.isFinite(saved.panelX) && Number.isFinite(saved.panelY) && window.innerWidth > 600) {
    panel.style.left = `${saved.panelX}px`;
    panel.style.top = `${saved.panelY}px`;
    panel.style.right = 'auto';
  }

  dragBy(panel.querySelector('.academy-grab'), panel, host, 'panel');
  swipeToClose(panel);
  outsideToClose(panel);

  renderPanel(host);
  return panelApi(host);
}

function panelApi(host) {
  return {
    open: () => openPanel(host),
    close: closePanel,
    toggle: () => (mounted.panel && mounted.panel.classList.contains('academy-open') ? closePanel() : openPanel(host)),
    render: () => renderPanel(host),
    destroy: () => {
      if (mounted.panel) mounted.panel.remove();
      if (mounted.button) mounted.button.remove();
      mounted.panel = null;
      mounted.button = null;
      // Панель снята со страницы — помнить, что в ней было раскрыто, больше не
      // о чем. Копия в меню расширений живёт отдельно и своей памяти не теряет.
      for (const k of [...sectionOpen.keys()]) if (k.startsWith('panel::')) sectionOpen.delete(k);
      mounted.planDraft = null;
    },
  };
}

/** Длина самого длинного слова ярлыка (не меньше 4: короткие не раздуваются). */
export function longestWord(label) {
  return Math.max(4, ...String(label || '').split(/\s+/).map((w) => w.length));
}

function openPanel(host) {
  if (!mounted.panel) return;
  mounted.panel.classList.add('academy-open');
  renderPanel(host || mounted.host);
  fitPanel();
  watchViewport(host || mounted.host);
}

/** Ширина, до которой панель — на весь экран (как `@media (max-width: 600px)`). */
const FULLSCREEN_MAX = 600;

/**
 * На телефоне панель — ровно видимая часть экрана. CSS здесь мало: `100dvh`
 * понимают не все браузеры телефона, а `100vh` на Android считает и полосу
 * адреса — низ панели уезжал за экран, и до него было не долистать. Высота
 * берётся у `visualViewport` (без клавиатуры и полос), место — с поправкой на
 * начало координат fixed-узла (`fixedOrigin`: у владелицы тема сдвигает его).
 * Значения ставятся с `important`, чтобы перебить правила медиазапроса.
 */
function fitPanel() {
  const panel = mounted.panel;
  if (!panel || typeof window === 'undefined') return;
  const props = ['top', 'left', 'height', 'width'];
  if (!panel.classList.contains('academy-open') || window.innerWidth > FULLSCREEN_MAX) {
    for (const p of props) panel.style.removeProperty(p);
    return;
  }
  for (const p of props) panel.style.removeProperty(p);
  const vv = window.visualViewport;
  const h = Math.round((vv && vv.height) || window.innerHeight);
  const w = Math.round((vv && vv.width) || window.innerWidth);
  const o = fixedOrigin(panel);
  panel.style.setProperty('top', `${Math.round(-o.y + ((vv && vv.offsetTop) || 0))}px`, 'important');
  panel.style.setProperty('left', `${Math.round(-o.x)}px`, 'important');
  panel.style.setProperty('height', `${h}px`, 'important');
  panel.style.setProperty('width', `${w}px`, 'important');
}

function closePanel() {
  if (mounted.panel) mounted.panel.classList.remove('academy-open');
}

/**
 * Перерисовка. Вызывается и из index.js по событиям таверны, и изнутри после
 * любого действия. Падение отрисовки не должно оставлять пустую панель, поэтому
 * всё дерево строится в try и при ошибке заменяется текстом ошибки.
 */
export function renderPanel(host) {
  const h = host || mounted.host;
  if (!mounted.panel || !h) return;

  const preset = safe(() => h.getPreset(), null) || {};
  const settings = safe(() => h.getSettings(), null) || {};

  // Полоса вкладок собирается заново: набор зависит от галочки отладки, а
  // выбранная вкладка могла из этого набора исчезнуть — тогда возврат на
  // «Сегодня», иначе панель показывала бы разбор при выключенной отладке.
  const list = tabsFor(preset, settings);
  if (!list.some((t) => t.id === mounted.tab)) mounted.tab = 'today';
  const tabsBox = clear(mounted.panel.querySelector('.academy-tabs'));
  // Счётчик непрочитанного — на ярлыке «Потока»: лента живёт и тогда, когда
  // вкладка закрыта, и новое должно быть видно снаружи.
  const unread = safe(() => unreadCount(h.getState()), 0);
  for (const t of list) {
    tabsBox.append(el('div', {
      class: t.id === mounted.tab ? 'academy-tab academy-tab-on' : 'academy-tab',
      dataset: { tab: t.id },
      // Длинный ярлык пресета на телефоне обрезается многоточием — целиком он
      // виден подсказкой.
      title: t.label,
      onclick: () => {
        // Ушла с «Потока» — выделение прочитанного и раскрытое превью гаснут.
        if (t.id !== mounted.tab) {
          mounted.feedFresh.clear();
          mounted.feedPreview = null;
          mounted.feedOpen.clear();
        }
        mounted.tab = t.id;
        renderPanel(h);
      },
    }, [
      el('i', { class: `fa-solid ${TAB_ICONS[t.id] || 'fa-circle'} academy-tab-icon`, 'aria-hidden': 'true' }),
      // Самое длинное слово ярлыка — для шрифта на телефоне (style.css): ярлык
      // ужимается под ширину вкладки, а не обрезается («Достиже…»).
      el('span', { class: 'academy-tab-label', text: t.label, style: `--academy-tab-chars: ${longestWord(t.label)}` }),
      t.id === 'feed' && unread > 0 ? el('span', { class: 'academy-tab-badge', text: unread > 99 ? '99+' : String(unread) }) : null,
    ]));
  }

  // Подзаголовок шапки — где сюжет в календаре: «вторник, 8 декабря · 21:20».
  const sub = mounted.panel.querySelector('.academy-subtitle');
  if (sub) {
    const st = safe(() => h.getState(), null);
    const cal = st && st.started && st.calendar;
    sub.textContent = cal ? [formatDate(cal.day), cal.time].filter(Boolean).join(' · ') : '';
  }

  const body = clear(mounted.panel.querySelector('.academy-body'));
  try {
    const state = safe(() => h.getState(), null);
    if (mounted.tab === 'gradebook') body.append(renderGradebook(h, gradebookView(state, preset), preset));
    else if (mounted.tab === 'people') body.append(renderPeople(h, peopleView(state, preset), preset));
    else if (mounted.tab === 'feed') {
      body.append(renderFeed(h, feedView(state, preset, {
        plot: safe(() => h.getPlot(), null),
        settings,
        chan: mounted.feedChan,
        heroine: safe(() => h.getHeroine(), ''),
        fresh: mounted.feedFresh,
        open: mounted.feedOpen,
      }), preset));
    }
    else if (mounted.tab === 'achievements') {
      body.append(renderAchievements(h, achievementsView(state, preset, settings.achievementTally), preset));
    }
    else if (mounted.tab === 'debug') {
      body.append(renderDebug(h, debugView(safe(() => h.getDebug(), null), state, preset, settings)));
    } else if (mounted.tab === 'settings') body.append(renderSettings(h));
    else body.append(renderToday(h, todayView(state, preset), preset));
  } catch (err) {
    body.append(el('div', { class: 'academy-empty' }, [
      el('div', { class: 'academy-empty-title', text: 'Панель не смогла отрисоваться' }),
      el('p', { class: 'academy-note', text: (err && err.message) ? err.message : String(err) }),
      el('div', {
        class: 'menu_button academy-btn',
        text: 'Открыть настройки',
        onclick: () => { mounted.tab = 'settings'; renderPanel(h); },
      }),
    ]));
  }
}

/* --- кнопка вызова -------------------------------------------------------- */

/**
 * Перетаскиваемая кнопка вызова (3.9). Порог `DRAG_THRESHOLD` отличает жест от
 * нажатия: без него кнопка срабатывает при каждой попытке пролистать чат.
 * Слушатели касаний пассивные; от прокрутки во время перетаскивания спасает
 * `touch-action: none` в `style.css`, а не `preventDefault`, который как раз и
 * потребовал бы активного слушателя.
 */
export function mountButton(host) {
  mounted.host = host;
  if (mounted.button && mounted.button.isConnected) return mounted.button;

  const button = el('div', {
    id: ID.button,
    class: 'academy-launcher',
    title: 'Академия',
    role: 'button',
    tabindex: '0',
  }, [el('span', { class: 'academy-launcher-mark', text: 'А' })]);

  // Сохранённые координаты зажимаются в текущее окно. Панель на узком экране
  // свои просто не восстанавливает (`window.innerWidth > 600`), а кнопке так
  // нельзя: она — единственный вход в панель, и точка, сохранённая на широком
  // мониторе, увела бы её за экран телефона насовсем — вернуть невидимую
  // кнопку нечем. Поймано стендом tools/preview: buttonX=1800 при окне 360.
  // 42 — ширина кнопки из style.css; спрашивать DOM до вставки в документ
  // бессмысленно, а ошибка в пару пикселей тут ничего не решает.
  //
  // Зажимать мало один раз при запуске: на телефоне окно в этот момент бывает
  // ещё не своего размера (вкладка грузилась в фоне, адресная строка, поворот),
  // и кнопка оказывалась за краем или под верхней панелью таверны. Тогда её не
  // видно на экране и её не находит STFolder — он собирает только видимые
  // кнопки, — то есть её нет нигде. Поэтому место пересчитывается при каждой
  // смене размера окна (`placeLauncher`, `watchViewport`).
  document.body.append(button);
  mounted.button = button;
  placeLauncher(host);
  watchViewport(host);

  dragBy(button, button, host, 'button', () => {
    if (!mounted.panel) mountPanel(host);
    mounted.panel.classList.contains('academy-open') ? closePanel() : openPanel(host);
  });
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { if (!mounted.panel) mountPanel(host); openPanel(host); }
  });
  return button;
}

/** Ширина кнопки из style.css. */
const LAUNCHER_SIZE = 42;

/** Высота, которую сверху занимает панель таверны (`#top-bar`); на телефоне ~50. */
function topReserve() {
  const bar = typeof document !== 'undefined' && document.getElementById('top-settings-holder');
  const h = bar && bar.getBoundingClientRect ? bar.getBoundingClientRect().bottom : 0;
  return Number.isFinite(h) && h > 0 && h < window.innerHeight / 3 ? Math.round(h) : 0;
}

/**
 * Поставить кнопку по сохранённым координатам, зажатым в окно. Окно нулевого
 * размера (вкладка ещё не показана) — не повод что-то решать: кнопка остаётся на
 * месте по умолчанию из style.css, а пересчёт придёт с первым `resize`.
 */
function placeLauncher(host) {
  const button = mounted.button;
  if (!button) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!(w > LAUNCHER_SIZE && h > LAUNCHER_SIZE)) return;
  const pos = safe(() => (host.getSettings() || {}).ui, {}) || {};
  const saved = Number.isFinite(pos.buttonX) && Number.isFinite(pos.buttonY);
  // Угол по умолчанию — те же отступы, что в style.css (`right: 12px`,
  // `bottom: 120px`, на узком экране 140px), но числами от верха и слева:
  // см. `moveFixed`, почему не `bottom`.
  const x = saved ? pos.buttonX : w - LAUNCHER_SIZE - 12;
  const y = saved ? pos.buttonY : h - LAUNCHER_SIZE - (w <= 600 ? 140 : 120);
  const minTop = topReserve();
  moveFixed(button, Math.min(Math.max(0, x), w - LAUNCHER_SIZE), Math.min(Math.max(minTop, y), h - LAUNCHER_SIZE));
}

/**
 * Начало координат `position: fixed` для узла — в координатах экрана.
 *
 * Обычно это угол окна, (0, 0). Но если тема или соседнее расширение ставят на
 * `body` (или `html`) `transform`, `filter`, `contain` или `will-change`,
 * fixed-узлы отсчитываются от `body`, а не от окна. На телефоне владелицы так и
 * было: `bottom: 140px` считался от низа `body` нулевой высоты, и кнопка
 * стояла на -182 по вертикали — за верхним краем, где её не видно и где её не
 * находит STFolder. Замер честный: место узла на экране минус его же
 * вычисленные `left`/`top`.
 */
function fixedOrigin(node) {
  // Без замера (не браузер, узел не на странице) — обычный случай: угол окна.
  if (typeof getComputedStyle !== 'function' || !node.isConnected || typeof node.getBoundingClientRect !== 'function') {
    return { x: 0, y: 0 };
  }
  const cs = getComputedStyle(node);
  const r = node.getBoundingClientRect();
  const x = r.left - parseFloat(cs.left);
  const y = r.top - parseFloat(cs.top);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

/** Поставить fixed-узел так, чтобы на экране его угол оказался в (`left`, `top`). */
function moveFixed(node, left, top, origin = fixedOrigin(node)) {
  node.style.left = `${Math.round(left - origin.x)}px`;
  node.style.top = `${Math.round(top - origin.y)}px`;
  node.style.right = 'auto';
  node.style.bottom = 'auto';
}

let viewportWatched = false;

function watchViewport(host) {
  if (viewportWatched || typeof window === 'undefined' || !window.addEventListener) return;
  viewportWatched = true;
  let timer = null;
  const again = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; placeLauncher(mounted.host || host); fitPanel(); }, 150);
  };
  window.addEventListener('resize', again);
  window.addEventListener('orientationchange', again);
  if (window.visualViewport && window.visualViewport.addEventListener) window.visualViewport.addEventListener('resize', again);
  // Первый пересчёт — когда страница уже разложена.
  setTimeout(again, 1000);
}

/**
 * Где кнопка и почему её может быть не видно — словами для меню расширений.
 * Каждый пункт проверяемый: человек на телефоне консоли не откроет.
 */
export function launcherDiagnosis() {
  const b = mounted.button;
  if (!b || !b.isConnected) return 'Кнопки нет на странице — панель её не создала.';
  const parts = [];
  if (b.classList.contains('stf-hidden') || b.classList.contains('stf-docked')) parts.push('её забрал STFolder — она в его папке');
  const style = getComputedStyle(b);
  const r = b.getBoundingClientRect();
  const off = r.right <= 0 || r.bottom <= 0 || r.left >= window.innerWidth || r.top >= window.innerHeight;
  if (style.display === 'none' && !parts.length) parts.push('она скрыта стилем (display: none)');
  if (off) parts.push('она за краем экрана');
  const o = fixedOrigin(b);
  if (Math.abs(o.x) > 1 || Math.abs(o.y) > 1) parts.push(`тема или расширение сдвинули систему координат (${Math.round(o.x)}, ${Math.round(o.y)}) — Академия это учитывает`);
  parts.push(`место: ${Math.round(r.left)}, ${Math.round(r.top)}; окно ${window.innerWidth}×${window.innerHeight}`);
  return `Кнопка на странице: ${parts.join('; ')}.`;
}

/** Забыть сохранённое место и поставить кнопку в угол по умолчанию; создать, если её нет. */
export function resetLauncher(host) {
  safe(() => host.setSettings({ ui: { buttonX: null, buttonY: null } }, { quiet: true }), null);
  if (!mounted.button || !mounted.button.isConnected) {
    mounted.button = null;
    mountButton(host);
  }
  placeLauncher(host);
  return launcherDiagnosis();
}

/**
 * Общий перетаскиватель для кнопки и для панели. `onTap` вызывается, только
 * если палец сместился меньше чем на `DRAG_THRESHOLD` пикселей.
 */
function dragBy(handle, target, host, kind, onTap) {
  if (!handle || !target) return;
  let start = null;

  const point = (e) => (e.touches && e.touches[0]) || e;

  const begin = (e) => {
    const p = point(e);
    const rect = target.getBoundingClientRect();
    start = { x: p.clientX, y: p.clientY, left: rect.left, top: rect.top, origin: fixedOrigin(target), moved: false };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
  };

  const move = (e) => {
    if (!start) return;
    const p = point(e);
    const dx = p.clientX - start.x;
    const dy = p.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    start.moved = true;
    target.classList.add('academy-dragging');
    const w = target.offsetWidth;
    const h = target.offsetHeight;
    const left = Math.min(Math.max(0, start.left + dx), Math.max(0, window.innerWidth - w));
    const top = Math.min(Math.max(0, start.top + dy), Math.max(0, window.innerHeight - h));
    moveFixed(target, left, top, start.origin);
  };

  const end = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', end);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', end);
    document.removeEventListener('touchcancel', end);
    if (!start) return;
    target.classList.remove('academy-dragging');
    if (start.moved) {
      const rect = target.getBoundingClientRect();
      const patch = kind === 'button'
        ? { ui: { buttonX: Math.round(rect.left), buttonY: Math.round(rect.top) } }
        : { ui: { panelX: Math.round(rect.left), panelY: Math.round(rect.top) } };
      safe(() => host.setSettings(patch), null);
    } else if (typeof onTap === 'function') {
      onTap();
    }
    start = null;
  };

  handle.addEventListener('mousedown', begin);
  handle.addEventListener('touchstart', begin, { passive: true });
}

/** Свайп в сторону от панели закрывает её (3.9). Слушатели пассивные. */
function swipeToClose(panel) {
  let from = null;
  panel.addEventListener('touchstart', (e) => {
    // Только за шапку и полосу вкладок: на весь экран панель листается
    // пальцем, и короткое содержимое закрывалось бы от любого жеста вверх.
    if (!(e.target && e.target.closest && e.target.closest('.academy-bar, .academy-tabs'))) {
      from = null;
      return;
    }
    const t = e.touches[0];
    from = { x: t.clientX, y: t.clientY, top: panel.scrollTop };
  }, { passive: true });
  panel.addEventListener('touchend', (e) => {
    if (!from) return;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    const body = panel.querySelector('.academy-body');
    const scrolled = body ? body.scrollTop : 0;
    if (t && scrolled <= 0 && from.y - t.clientY > 60 && Math.abs(t.clientX - from.x) < 40) closePanel();
    from = null;
  }, { passive: true });
}

/** Тап мимо панели закрывает её — но не тап по кнопке вызова (3.9). */
function outsideToClose(panel) {
  document.addEventListener('pointerdown', (e) => {
    if (!panel.classList.contains('academy-open')) return;
    if (panel.contains(e.target)) return;
    if (mounted.button && mounted.button.contains(e.target)) return;
    closePanel();
  });
}

/* --- блок в меню расширений ----------------------------------------------- */

/**
 * Блок в меню расширений: API, режим источника времени, галочки и кнопка,
 * открывающая панель. Полноценные настройки живут во вкладке панели — здесь
 * только то, что человек ищет в привычном месте.
 */
export function mountSettings(host) {
  mounted.host = host;
  const holder = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
  if (!holder) return null;
  if (mounted.settings && mounted.settings.isConnected) { renderSettingsBlock(host); return mounted.settings; }

  const block = el('div', { id: ID.settings, class: 'academy-ext-block' }, [
    el('div', { class: 'inline-drawer' }, [
      el('div', { class: 'inline-drawer-toggle inline-drawer-header' }, [
        el('b', { text: 'Академия' }),
        el('div', { class: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' }),
      ]),
      el('div', { class: 'inline-drawer-content academy-ext-content' }),
    ]),
  ]);
  holder.append(block);
  mounted.settings = block;

  // Раскрытие блока — штатное: таверна ловит клики по .inline-drawer-toggle
  // делегированно на document, так что наш узел подхватывается и без своего
  // обработчика. Свой второй обработчик отменял бы штатный: блок раскрывался
  // и тут же сворачивался обратно. Закрытым блок стартует, как штатные:
  // через style="display:none" на содержимом.
  block.querySelector('.inline-drawer-content').style.display = 'none';

  renderSettingsBlock(host);
  return block;
}

function renderSettingsBlock(host) {
  if (!mounted.settings) return;
  setSectionScope('drawer');
  const content = clear(mounted.settings.querySelector('.inline-drawer-content'));
  const state = safe(() => host.getState(), null);
  const preset = safe(() => host.getPreset(), {}) || {};
  const settings = safe(() => host.getSettings(), {}) || {};
  const view = settingsView(state, settings, preset, hostExtra(host));

  const launcherNote = el('p', { class: 'academy-note' });
  content.append(el('div', { class: 'academy-row academy-row-buttons' }, [
    el('div', {
      class: 'menu_button academy-btn academy-btn-main',
      text: 'Открыть панель',
      onclick: () => { if (!mounted.panel) mountPanel(host); openPanel(host); },
    }),
    // Плавающая кнопка пропала (за краем экрана, под панелью таверны,
    // в папке STFolder) — вернуть её в угол и сказать, где она была.
    el('div', {
      class: 'menu_button academy-btn',
      text: 'Вернуть кнопку',
      onclick: () => {
        const panels = safe(() => (typeof host.panelDiagnosis === 'function' ? host.panelDiagnosis() : ''), '') || '';
        launcherNote.textContent = `${launcherDiagnosis()} Возвращаю в угол… ${resetLauncher(host)} ${panels}`;
      },
    }),
  ]), launcherNote);
  // Пресет — настройка общая для всех чатов, и человек ищет такие в меню
  // расширений, а не в панели одного чата. Лорбук и выгрузка остались только в
  // панели: они про этот чат, а не про расширение.
  content.append(renderPresetBlock(host, view));
  content.append(renderApiBlock(host, view));
  content.append(renderModeBlock(host, view));
  content.append(renderDebugBlock(host, view));
}

bindRedraw(renderPanel, renderSettingsBlock);

export default { mountPanel, renderPanel, mountButton, mountSettings };

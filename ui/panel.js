import {
  bindRedraw, uiLabels, formatDate, setDateShift, mounted, el, clear, sectionOpen, setSectionScope, safe,
  hintIcon, expelledPhrase, call, fill, PRESET_TEXT,
} from './common.js';
import { achievementsView, renderAchievements } from './achievements.js';
import { peopleView, renderPeople } from './people.js';
import { feedView, renderFeed } from './feed.js';
import { unreadCount } from '../core/feed.mjs';
import { weekdayShiftOf } from '../core/time.mjs';
import { gradebookView, renderGradebook } from './gradebook.js';
import { todayView, renderToday } from './today.js';
import { debugView, renderDebug } from './debug.js';
import {
  renderApiBlock, renderModeBlock, renderPresetBlock, renderDebugBlock,
} from './settings-blocks.js';
import { settingsView, renderSettings, hostExtra } from './settings.js';
import { applyLook } from './look.js';
import { LAUNCHER_ICONS, launcherIconOf } from './icons.js';
import { emblemSvg, emblemKeyOf } from './emblems.js';
import { buildSpread } from './spread.js';

export const TABS = [
  { id: 'today', label: 'Сегодня' },
  { id: 'gradebook', label: 'Зачётка' },
  { id: 'people', label: 'Люди' },
  { id: 'feed', label: 'Слухи' },
  { id: 'achievements', label: 'Достижения' },
  { id: 'settings', label: 'Настройки' },
];

export const DEBUG_TAB = { id: 'debug', label: 'Отладка' };

export const TAB_ICONS = {
  today: 'fa-sun', gradebook: 'fa-book-open', people: 'fa-users', feed: 'fa-comments', achievements: 'fa-trophy',
  settings: 'fa-gear', debug: 'fa-bug',
};

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

const DRAG_THRESHOLD = 6;

const DRAG_IGNORE = 'button, a, input, select, textarea, .academy-close';

export function mountPanel(host) {
  mounted.host = host;
  if (mounted.panel && mounted.panel.isConnected) {
    renderPanel(host);
    return panelApi(host);
  }

  const panel = el('div', {
    id: ID.panel, class: 'academy-panel ad-diary draggable', role: 'dialog', 'aria-label': 'Академия',
    lang: 'ru',
  }, [
    el('div', { class: 'ad-resize', title: 'Потянуть, чтобы изменить ширину' }),
    el('div', { class: 'academy-bar ad-head panelControlBar', title: 'Перетащить · двойной щелчок — в центр' }, [
      el('div', { class: 'academy-grab drag-grabber fa-solid fa-grip-vertical', title: 'Перетащить · двойной щелчок — в центр' }),
      el('span', { class: 'ad-emblem-box', html: emblemSvg(null) }),
      el('div', { class: 'academy-titles ad-head-text' }, [
        el('div', { class: 'academy-title ad-head-title', text: 'Академия' }),
        el('div', { class: 'academy-subtitle ad-head-sub' }),
      ]),
      el('div', {
        class: 'academy-close dragClose fa-solid fa-xmark',
        title: 'Закрыть',
        onclick: () => closePanel(),
      }),
    ]),
    el('div', { class: 'academy-body ad-body' }),
    el('nav', { class: 'ad-tabs', 'aria-label': 'Разделы' }),
  ]);

  const holder = document.getElementById('movingDivs') || document.body;
  holder.append(panel);
  mounted.panel = panel;

  restoreGeometry(panel, host);

  const bar = panel.querySelector('.academy-bar');
  dragBy(bar, panel, host, 'panel');
  recenterOnDblClick(bar, panel, host);
  resizeBy(panel.querySelector('.ad-resize'), panel, host);
  watchSpread(panel);
  swipeToClose(panel);
  outsideToClose(panel);

  renderPanel(host);
  return panelApi(host);
}

export const SPREAD_MIN = 760;

const WIDE_WINDOW = 1100;
const PANEL_WIDE = 880;
const PANEL_NARROW = 440;
const PANEL_MIN = 320;

export function defaultPanelWidth(viewport) {
  return viewport >= WIDE_WINDOW ? Math.min(PANEL_WIDE, Math.round(viewport * 0.9)) : PANEL_NARROW;
}

export function clampPanelWidth(width, viewport) {
  const w = Number.isFinite(width) ? width : defaultPanelWidth(viewport);
  return Math.round(Math.min(Math.max(w, PANEL_MIN), Math.max(PANEL_MIN, viewport - 24)));
}

const PANEL_TOP_VH = 0.08;
const PANEL_KEEP_VISIBLE = 60;

export function panelPlace(saved, width, viewport) {
  const maxLeft = Math.max(0, viewport.w - width);
  const has = saved && Number.isFinite(saved.panelX) && Number.isFinite(saved.panelY);
  const left = has ? saved.panelX : maxLeft / 2;
  const top = has ? saved.panelY : viewport.h * PANEL_TOP_VH;
  return {
    left: Math.round(Math.min(Math.max(0, left), maxLeft)),
    top: Math.round(Math.min(Math.max(0, top), Math.max(0, viewport.h - PANEL_KEEP_VISIBLE))),
  };
}

function restoreGeometry(panel, host) {
  if (!panel || !host || typeof window === 'undefined' || window.innerWidth <= FULLSCREEN_MAX) return;
  const saved = safe(() => (host.getSettings() || {}).ui, {}) || {};
  placePanel(panel, saved);
}

function placePanel(panel, saved) {
  const vw = window.innerWidth;
  const width = clampPanelWidth(saved.panelWidth, vw);
  const { left, top } = panelPlace(saved, width, { w: vw, h: window.innerHeight });
  panel.style.width = `${width}px`;
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
  panel.style.right = 'auto';
}

function recenterOnDblClick(bar, panel, host) {
  if (!bar) return;
  bar.addEventListener('dblclick', (e) => {
    if (window.innerWidth <= FULLSCREEN_MAX || (e.target.closest && e.target.closest(DRAG_IGNORE))) return;
    const saved = safe(() => (host.getSettings() || {}).ui, {}) || {};
    placePanel(panel, { panelWidth: saved.panelWidth });
    safe(() => host.setSettings({ ui: { panelX: null, panelY: null } }, { quiet: true }), null);
  });
}

function watchSpread(panel) {
  if (typeof ResizeObserver !== 'function') return;
  const ro = new ResizeObserver((entries) => {
    const last = entries[entries.length - 1];
    const w = last && last.contentRect ? last.contentRect.width : 0;
    if (w <= 0) return;
    const on = w >= SPREAD_MIN;
    if (on !== mounted.spread) {
      mounted.spread = on;
      if (on) panel.dataset.spread = '1'; else delete panel.dataset.spread;
      if (panel.classList.contains('academy-open')) renderPanel(mounted.host);
    }
    fitTabs(panel);
  });
  ro.observe(panel);
  mounted.spreadObserver = ro;
}

function fitTabs(panel) {
  const tabs = panel && panel.querySelector ? panel.querySelector('.ad-tabs') : null;
  if (!tabs || typeof tabs.querySelectorAll !== 'function' || typeof getComputedStyle !== 'function') return;
  tabs.removeAttribute('data-wrap');
  if (mounted.spread) { tabs.style.removeProperty('--ad-tab-fs'); return; }
  const max = parseFloat(getComputedStyle(tabs).getPropertyValue('--ad-tab-fs-max')) || 13.5;
  const min = 11;
  const labels = [...tabs.querySelectorAll('.ad-tab')];
  const over = () => labels.some((b) => {
    const l = b.querySelector('.ad-lab');
    if (!l) return false;
    let tw = l.scrollWidth;
    if (typeof document.createRange === 'function') {
      const r = document.createRange();
      r.selectNodeContents(l);
      const rects = [...r.getClientRects()];
      if (rects.length) tw = Math.max(...rects.map((x) => x.width));
    }
    const cs = getComputedStyle(b);
    const inner = b.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    return tw > inner - 1;
  });
  const shrink = (from) => {
    let size = from;
    tabs.style.setProperty('--ad-tab-fs', `${size}px`);
    while (over() && size > min) { size -= 0.25; tabs.style.setProperty('--ad-tab-fs', `${size}px`); }
  };
  shrink(max);
  if (over()) {
    tabs.setAttribute('data-wrap', '1');
    shrink(Math.min(max, 12.5));
  }
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
      if (mounted.spreadObserver) mounted.spreadObserver.disconnect();
      mounted.spreadObserver = null;
      mounted.spread = false;
      mounted.panel = null;
      mounted.button = null;
      for (const k of [...sectionOpen.keys()]) if (k.startsWith('panel::')) sectionOpen.delete(k);
      mounted.planDraft = null;
    },
  };
}

export function longestWord(label) {
  return Math.max(4, ...String(label || '').split(/\s+/).map((w) => w.length));
}

function openPanel(host) {
  if (!mounted.panel) return;
  mounted.panel.classList.add('academy-open');
  if (mounted.button) mounted.button.classList.add('academy-under-panel');
  renderPanel(host || mounted.host);
  fitPanel();
  watchViewport(host || mounted.host);
}

const FULLSCREEN_MAX = 600;

function fitPanel() {
  const panel = mounted.panel;
  if (!panel || typeof window === 'undefined') return;
  const props = ['top', 'left', 'height', 'width'];
  if (!panel.classList.contains('academy-open') || window.innerWidth > FULLSCREEN_MAX) {
    for (const p of props) panel.style.removeProperty(p);
    restoreGeometry(panel, mounted.host);
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
  if (mounted.button) mounted.button.classList.remove('academy-under-panel');
}

export function renderPanel(host) {
  const h = host || mounted.host;
  if (!mounted.panel || !h) return;

  const preset = safe(() => h.getPreset(), null) || {};
  const settings = safe(() => h.getSettings(), null) || {};

  const list = tabsFor(preset, settings);
  if (!list.some((t) => t.id === mounted.tab)) mounted.tab = 'today';
  applyLook(mounted.panel, settings, preset);
  if (mounted.button) setLauncherIcon(mounted.button, settings.ui);

  const tabsBox = clear(mounted.panel.querySelector('.ad-tabs'));
  const unread = safe(() => unreadCount(h.getState()), 0);
  for (const t of list) {
    const on = t.id === mounted.tab;
    const go = () => {
      if (t.id !== mounted.tab) {
        mounted.feedFresh.clear();
        mounted.feedPreview = null;
        mounted.feedOpen.clear();
        mounted.feedPal.clear();
      }
      mounted.tab = t.id;
      renderPanel(h);
    };
    const tab = el('div', {
      class: 'ad-tab',
      dataset: { tab: t.id },
      role: 'tab',
      tabindex: '0',
      'aria-current': on ? 'page' : null,
      'aria-selected': on ? 'true' : 'false',
      title: t.label,
      onclick: go,
    }, [
      el('i', { class: `fa-solid ${TAB_ICONS[t.id] || 'fa-circle'} ad-tab-icon`, 'aria-hidden': 'true' }),
      el('span', { class: 'ad-lab', text: t.label }),
      hintIcon(preset, t.label),
      t.id === 'feed' && unread > 0 ? el('span', { class: 'ad-badge ad-tab-badge', text: unread > 99 ? '99+' : String(unread) }) : null,
    ]);
    tab.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
    });
    tabsBox.append(tab);
  }

  const embBox = mounted.panel.querySelector('.ad-emblem-box');
  const embKey = emblemKeyOf(preset);
  if (embBox && embBox.dataset.emblem !== embKey) { embBox.innerHTML = emblemSvg(preset); embBox.dataset.emblem = embKey; }
  const title = mounted.panel.querySelector('.academy-title');
  if (title) title.textContent = (preset && preset.displayName) || 'Академия';
  const sub = mounted.panel.querySelector('.academy-subtitle');
  if (sub) {
    const st = safe(() => h.getState(), null);
    const cal = st && st.started && st.calendar;
    sub.textContent = cal ? [formatDate(cal.day, 'full', weekdayShiftOf(st)), cal.time, expelledPhrase(st, preset, safe(() => h.getHeroine(), ''))].filter(Boolean).join(' · ') : '';
  }

  const spreadBox = clear(mounted.panel.querySelector('.academy-body'));
  const viewing = safe(() => (h.getPresetView ? h.getPresetView() : null), null);
  let bar = mounted.panel.querySelector('.ad-viewbar');
  if (!bar && viewing && spreadBox.parentNode) {
    bar = el('div', { class: 'ad-viewbar' });
    spreadBox.parentNode.insertBefore(bar, spreadBox);
  }
  if (bar) {
    clear(bar);
    bar.hidden = !viewing;
    if (viewing) {
      bar.append(
        el('span', { class: 'ad-viewbar-text', text: fill(PRESET_TEXT.viewBar, { to: viewing.name }) }),
        el('div', {
          class: 'menu_button academy-btn academy-btn-main',
          text: PRESET_TEXT.viewBack,
          tabindex: '0',
          role: 'button',
          onclick: async () => { await call(h, 'endPresetView'); renderPanel(h); renderSettingsBlock(h); },
        }),
      );
    }
  }
  const tabLabel = (list.find((t) => t.id === mounted.tab) || {}).label || '';
  let out;
  try {
    const state = safe(() => h.getState(), null);
    setDateShift(weekdayShiftOf(state));
    if (mounted.tab === 'gradebook') out = renderGradebook(h, gradebookView(state, preset), preset);
    else if (mounted.tab === 'people') out = renderPeople(h, peopleView(state, preset, { heroine: safe(() => h.getHeroine(), '') }), preset);
    else if (mounted.tab === 'feed') {
      out = renderFeed(h, feedView(state, preset, {
        plot: safe(() => h.getPlot(), null),
        settings,
        chan: mounted.feedChan,
        heroine: safe(() => h.getHeroine(), ''),
        fresh: mounted.feedFresh,
        open: mounted.feedOpen,
        palOpen: mounted.feedPal,
      }), preset);
    }
    else if (mounted.tab === 'achievements') {
      out = renderAchievements(h, achievementsView(state, preset, settings.achievementTally, {
        char: safe(() => h.getCharName(), ''), enabled: settings.achievements !== false,
      }), preset);
    }
    else if (mounted.tab === 'debug') {
      out = renderDebug(h, debugView(safe(() => h.getDebug(), null), state, preset, settings));
    } else if (mounted.tab === 'settings') out = renderSettings(h);
    else out = renderToday(h, todayView(state, preset, { heroine: safe(() => h.getHeroine(), '') }), preset);
  } catch (err) {
    out = el('div', { class: 'academy-empty' }, [
      el('div', { class: 'academy-empty-title', text: 'Панель не смогла отрисоваться' }),
      el('p', { class: 'academy-note', text: (err && err.message) ? err.message : String(err) }),
      el('div', {
        class: 'menu_button academy-btn',
        text: 'Открыть настройки',
        onclick: () => { mounted.tab = 'settings'; renderPanel(h); },
      }),
    ]);
  }
  spreadBox.append(buildSpread(mounted.tab, tabLabel, out));
  fitTabs(mounted.panel);
}

export function mountButton(host) {
  mounted.host = host;
  if (mounted.button && mounted.button.isConnected) return mounted.button;

  const button = el('div', {
    id: ID.button,
    class: 'academy-launcher',
    title: 'Академия',
    role: 'button',
    tabindex: '0',
  }, [el('span', { class: 'academy-launcher-mark' })]);
  setLauncherIcon(button, safe(() => (host.getSettings() || {}).ui, {}));

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

function setLauncherIcon(button, ui) {
  const id = launcherIconOf(ui);
  const mark = button.firstChild;
  if (!mark || mark.dataset.icon === id) return;
  mark.dataset.icon = id;
  mark.innerHTML = LAUNCHER_ICONS[id].svg;
}

const LAUNCHER_SIZE = 42;

function topReserve() {
  const bar = typeof document !== 'undefined' && document.getElementById('top-settings-holder');
  const h = bar && bar.getBoundingClientRect ? bar.getBoundingClientRect().bottom : 0;
  return Number.isFinite(h) && h > 0 && h < window.innerHeight / 3 ? Math.round(h) : 0;
}

function placeLauncher(host) {
  const button = mounted.button;
  if (!button) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (!(w > LAUNCHER_SIZE && h > LAUNCHER_SIZE)) return;
  const pos = safe(() => (host.getSettings() || {}).ui, {}) || {};
  const saved = Number.isFinite(pos.buttonX) && Number.isFinite(pos.buttonY);
  const x = saved ? pos.buttonX : w - LAUNCHER_SIZE - 12;
  const y = saved ? pos.buttonY : h - LAUNCHER_SIZE - (w <= 600 ? 140 : 120);
  const minTop = topReserve();
  moveFixed(button, Math.min(Math.max(0, x), w - LAUNCHER_SIZE), Math.min(Math.max(minTop, y), h - LAUNCHER_SIZE));
}

function fixedOrigin(node) {
  if (typeof getComputedStyle !== 'function' || !node.isConnected || typeof node.getBoundingClientRect !== 'function') {
    return { x: 0, y: 0 };
  }
  const cs = getComputedStyle(node);
  const r = node.getBoundingClientRect();
  const x = r.left - parseFloat(cs.left);
  const y = r.top - parseFloat(cs.top);
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

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
  setTimeout(again, 1000);
}

export function launcherDiagnosis() {
  const b = mounted.button;
  if (!b || !b.isConnected) return 'Кнопки нет на странице — панель её не создала.';
  const parts = [];
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

export function resetLauncher(host) {
  safe(() => host.setSettings({ ui: { buttonX: null, buttonY: null } }, { quiet: true }), null);
  if (!mounted.button || !mounted.button.isConnected) {
    mounted.button = null;
    mountButton(host);
  }
  placeLauncher(host);
  return launcherDiagnosis();
}

function dragBy(handle, target, host, kind, onTap) {
  if (!handle || !target) return;
  let start = null;

  const point = (e) => (e.touches && e.touches[0]) || e;

  const begin = (e) => {
    if (kind === 'panel' && e.target.closest && e.target.closest(DRAG_IGNORE)) return;
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

function resizeBy(handle, panel, host) {
  if (!handle || !panel) return;
  let start = null;
  const point = (e) => (e.touches && e.touches[0]) || e;

  const move = (e) => {
    if (!start) return;
    const w = clampPanelWidth(start.right - point(e).clientX, window.innerWidth);
    panel.style.width = `${w}px`;
    moveFixed(panel, start.right - w, start.top, start.origin);
  };
  const end = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', end);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', end);
    document.removeEventListener('touchcancel', end);
    if (!start) return;
    panel.classList.remove('academy-dragging');
    const rect = panel.getBoundingClientRect();
    safe(() => host.setSettings({
      ui: { panelWidth: Math.round(rect.width), panelX: Math.round(rect.left), panelY: Math.round(rect.top) },
    }, { quiet: true }), null);
    start = null;
  };
  const begin = (e) => {
    const rect = panel.getBoundingClientRect();
    start = { right: rect.right, top: rect.top, origin: fixedOrigin(panel) };
    panel.classList.add('academy-dragging');
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
    if (e && e.preventDefault && e.type === 'mousedown') e.preventDefault();
  };
  handle.addEventListener('mousedown', begin);
  handle.addEventListener('touchstart', begin, { passive: true });
}

function swipeToClose(panel) {
  let from = null;
  panel.addEventListener('touchstart', (e) => {
    if (!(e.target && e.target.closest && e.target.closest('.academy-bar, .ad-tabs'))) {
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

function outsideToClose(panel) {
  document.addEventListener('pointerdown', (e) => {
    if (!panel.classList.contains('academy-open')) return;
    if (panel.contains(e.target)) return;
    if (mounted.button && mounted.button.contains(e.target)) return;
    if (e.target && (e.target.isConnected === false || (e.target.closest && e.target.closest('dialog, .popup, #toast-container, .academy-portrait-overlay, .academy-hint-pop')))) return;
    closePanel();
  });
}

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
    el('div', {
      class: 'menu_button academy-btn',
      text: 'Вернуть кнопку',
      onclick: () => {
        const panels = safe(() => (typeof host.panelDiagnosis === 'function' ? host.panelDiagnosis() : ''), '') || '';
        launcherNote.textContent = `${launcherDiagnosis()} Возвращаю в угол… ${resetLauncher(host)} ${panels}`;
      },
    }),
  ]), launcherNote);
  content.append(renderPresetBlock(host, view));
  content.append(renderApiBlock(host, view));
  content.append(renderModeBlock(host, view));
  content.append(renderDebugBlock(host, view));
}

bindRedraw(renderPanel, renderSettingsBlock);

export default { mountPanel, renderPanel, mountButton, mountSettings };

import { el, clear, runAction, call, safe, fill, setStatus, renderPanel, avatarNode } from './common.js';
import { ROUTE_LABELS } from '../core/draw.mjs';
import { LOOKS_MAX } from '../core/portraits.mjs';

const jobs = new Map();

const views = new Map();

const jobKey = (info, id) => `${(info && info.chat) || ''}::${id}`;

export function drawPending(personId) {
  for (const [key, job] of jobs) {
    if (key.endsWith(`::${personId}`) && (job.state === 'busy' || job.state === 'preview')) return true;
  }
  return false;
}

const opened = new Set();

export function keptOpen(key, personId) {
  return {
    open: opened.has(key) || drawPending(personId),
    ontoggle: (e) => { if (e.currentTarget.open) opened.add(key); else opened.delete(key); },
  };
}

export function resetDrawJobs() {
  for (const job of jobs.values()) if (job.ctrl) safe(() => job.ctrl.abort(), null);
  jobs.clear();
  views.clear();
  opened.clear();
}

const btn = (text, onclick, extra = '') => el('div', {
  class: `menu_button academy-btn academy-btn-small${extra ? ` ${extra}` : ''}`,
  role: 'button',
  text,
  onclick,
});

function repaint(key) {
  const view = views.get(key);
  if (view) paint(view, key);
}

async function start(view, key) {
  const cur = jobs.get(key);
  if (cur && cur.state === 'busy') return;
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  jobs.set(key, { state: 'busy', ctrl, route: view.info.route });
  repaint(key);
  let res;
  try {
    res = await call(view.host, 'drawPortrait', view.p.id, { signal: ctrl ? ctrl.signal : undefined });
  } catch (err) {
    res = { ok: false, error: String((err && err.message) || err) };
  }
  const now = jobs.get(key);
  if (!now || now.ctrl !== ctrl) return;
  if (res && res.ok && res.path) jobs.set(key, { state: 'preview', path: res.path });
  else if (res && res.code === 'aborted') jobs.set(key, { state: 'note', kind: 'note', text: String(res.error || '') });
  else jobs.set(key, { state: 'note', kind: 'error', text: String((res && res.error) || 'Не получилось нарисовать.') });
  repaint(key);
}

function cancel(key, X) {
  const job = jobs.get(key);
  if (job && job.ctrl) safe(() => job.ctrl.abort(), null);
  jobs.set(key, { state: 'note', kind: 'note', text: X.drawCancelled });
  repaint(key);
}

function paint(view, key) {
  const { slot, box, info, X } = view;
  clear(slot);
  clear(box);
  if (!info.available || !info.available.length) {
    box.append(el('p', { class: 'academy-note academy-photo-draw-hint', text: info.hint || X.drawNoRoute }));
    return;
  }
  const job = jobs.get(key);
  if (job && job.state === 'busy') {
    const busy = btn(X.drawBusy, null, 'academy-busy academy-photo-draw-busy');
    busy.disabled = true;
    busy.setAttribute('aria-disabled', 'true');
    slot.append(busy, btn(X.drawCancel, () => cancel(key, X), 'academy-photo-draw-cancel'));
    box.append(el('p', {
      class: 'academy-note',
      text: fill(X.drawBusyNote, { route: ROUTE_LABELS[job.route] || ROUTE_LABELS[info.route] || '' }),
    }));
    return;
  }
  slot.append(btn(X.drawButton, () => start(view, key), 'academy-photo-draw-go'));
  if (!job) return;
  if (job.state === 'note') {
    const status = el('div', { class: 'academy-status' });
    setStatus(status, job.kind === 'error' ? 'error' : 'note', job.text);
    box.append(status);
    return;
  }
  const status = el('div', { class: 'academy-status' });
  const keep = btn(X.drawKeep, async (e) => {
    const res = await runAction(e.currentTarget, status, () => call(view.host, 'setPortrait', view.p.id, job.path), X.drawKept);
    if (res && res.ok !== false) {
      jobs.set(key, { state: 'note', kind: 'ok', text: X.drawKept });
      renderPanel(view.host);
    }
  }, 'academy-btn-main academy-photo-draw-keep');
  const again = btn(X.drawAgain, () => start(view, key), 'academy-photo-draw-again');
  const drop = btn(X.drawDrop, () => {
    jobs.set(key, { state: 'note', kind: 'note', text: X.drawDropped });
    repaint(key);
  }, 'academy-photo-draw-drop');
  box.append(
    el('img', { class: 'academy-photo-preview', src: job.path, alt: view.p.name || '' }),
    el('p', { class: 'academy-note', text: X.drawPreviewNote }),
    el('div', { class: 'academy-row academy-row-buttons academy-photo-buttons' }, [keep, again, drop]),
    status,
  );
}

function looksEditor(host, p, X) {
  const status = el('div', { class: 'academy-status' });
  const input = el('textarea', {
    rows: '3', class: 'text_pole academy-input academy-looks-input',
    placeholder: X.looksHint, maxlength: String(LOOKS_MAX),
  });
  input.value = p.looks || '';
  const save = btn(X.looksSave, async (e) => {
    const value = String(input.value || '').trim();
    await runAction(e.currentTarget, status, () => call(host, 'setLooks', p.id, value), value ? X.looksSaved : X.looksCleared);
  });
  return el('div', { class: 'academy-photo-looks' }, [
    el('label', { class: 'academy-field' }, [el('span', { text: X.looksField }), input]),
    el('div', { class: 'academy-row academy-row-buttons' }, [save]),
    status,
  ]);
}

export function photoEditor(host, p, X, link = null) {
  const status = el('div', { class: 'academy-status' });
  const input = el('input', { type: 'file', accept: 'image/*', class: 'academy-photo-input', tabindex: '-1', 'aria-hidden': 'true' });
  const pick = el('div', {
    class: 'menu_button academy-btn academy-btn-small academy-photo-pick',
    role: 'button',
    text: X.photoPick,
    onclick: () => { input.value = ''; input.click(); },
  });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const res = await runAction(pick, status, () => call(host, 'uploadPortrait', p.id, file), X.photoSaved);
    if (res && res.ok !== false) renderPanel(host);
  });
  const remove = p.portrait ? el('div', {
    class: 'menu_button academy-btn academy-btn-small academy-photo-remove',
    role: 'button',
    text: X.photoRemove,
    onclick: async (e) => {
      const res = await runAction(e.currentTarget, status, () => call(host, 'setPortrait', p.id, ''), X.photoRemoved);
      if (res && res.ok !== false) renderPanel(host);
    },
  }) : null;

  const slot = el('span', { class: 'academy-photo-slot', dataset: { slot: 'draw', person: p.id } });
  const box = el('div', { class: 'academy-photo-draw' });
  const info = host && typeof host.getDraw === 'function' ? safe(() => host.getDraw(), null) : null;
  if (info) {
    const key = jobKey(info, p.id);
    const view = { slot, box, info, X, host, p };
    views.set(key, view);
    paint(view, key);
  }
  const canDraw = Boolean(info && info.available && info.available.length);

  const more = canDraw || link;
  return el('div', { class: 'academy-photo' }, [
    el('div', { class: 'academy-photo-head' }, [
      avatarNode(p.avatar, { size: 'card' }),
      el('div', { class: 'academy-photo-caption' }, [
        el('span', { class: 'academy-card-title', text: X.photoTitle }),
        p.portrait ? null : el('span', { class: 'academy-note', text: X.photoNone }),
      ]),
      el('div', { class: 'academy-row academy-row-buttons academy-photo-buttons' }, [pick, remove]),
    ]),
    input,
    status,
    el('p', { class: 'academy-note academy-photo-note', text: X.photoNote }),
    more ? el('details', { class: 'academy-photo-more', ...keptOpen(`more::${p.id}`, p.id) }, [
      el('summary', { text: X.photoMore }),
      el('div', { class: 'academy-row academy-row-buttons academy-photo-buttons' }, [slot]),
      box,
      canDraw ? looksEditor(host, p, X) : null,
      link ? el('details', { class: 'academy-photo-link' }, [
        el('summary', { text: X.photoLink }),
        link,
      ]) : null,
    ]) : null,
  ]);
}

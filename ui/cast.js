import { plural } from '../core/plural.mjs';
import { normalizeFeed, nickWord, THREADS_MAX } from '../core/feed.mjs';
import { extraLabels, fill, el, runAction, setStatus, section, call, safe, renderPanel, renderSettingsBlock } from './common.js';

export const CAST_FIELDS = [
  ['nick', 'mobNick'], ['type', 'mobType'], ['interest', 'mobInterest'], ['goal', 'mobGoal'], ['manner', 'mobManner'],
];

export function molvaDoneText(X, res) {
  const posts = Number(res && res.posts) || 0;
  const replies = Number(res && res.replies) || 0;
  if (!posts && !replies && res && res.quiet) return X.molvaQuiet;
  return fill(X.molvaDone, {
    posts, replies,
    postsWord: plural(posts, ...X.molvaPostForms),
    repliesWord: plural(replies, ...X.molvaReplyForms),
  }) + (res && res.skipped ? X.molvaDoneSkipped : '');
}

export function castView(state, preset) {
  const X = extraLabels(preset);
  const feed = normalizeFeed(state && state.feed);
  const nick = new Map(feed.cast.map((m) => [m.id, nickWord(m.nick)]));
  const members = feed.cast.map((m) => ({
    id: m.id,
    title: [nickWord(m.nick), m.type].filter(Boolean).join(' — '),
    nick: m.nick,
    type: m.type,
    interest: m.interest,
    goal: m.goal,
    manner: m.manner,
    relations: [
      m.ally && nick.has(m.ally) ? fill(X.mobFriend, { name: nick.get(m.ally) }) : '',
      m.rival && nick.has(m.rival) ? fill(X.mobFoe, { name: nick.get(m.rival) }) : '',
    ].filter(Boolean),
  }));
  const mates = new Map(((state && state.classmates) || []).filter((c) => c && c.id && c.name).map((c) => [c.id, c.name]));
  const live = feed.threads.filter((t) => t.state !== 'archived');
  const threads = live.map((t) => ({
    id: t.id,
    topic: t.topic,
    want: t.want ? fill(X.mobThreadWant, { text: t.want }) : '',
    last: t.last ? fill(X.mobThreadLast, { text: t.last }) : '',
    paused: t.state === 'paused',
    source: (X.mobThreadSource && X.mobThreadSource[t.source]) || '',
    who: fill(X.mobThreadWho, { names: t.members.map((id) => nick.get(id) || mates.get(id) || '').filter(Boolean).join(', ') }),
  }));
  return { members, threads, room: fill(X.mobThreadRoom, { n: live.filter((t) => t.state === 'active').length, max: THREADS_MAX }) };
}

let castWarn = '';

let molvaNote = { kind: '', text: '' };

export const MOLVA_NOTE_MS = 10000;

let molvaTimer = null;
const molvaStatuses = new Set();

export function clearMolvaNote() {
  if (molvaTimer) clearTimeout(molvaTimer);
  molvaTimer = null;
  molvaNote = { kind: '', text: '' };
  for (const node of molvaStatuses) {
    if (node.isConnected) setStatus(node, '', '');
    else molvaStatuses.delete(node);
  }
}

export function molvaNoteView() {
  return { ...molvaNote };
}

export function trackMolvaStatus(node) {
  molvaStatuses.add(node);
}

export function keepMolvaNote(note) {
  molvaNote = note;
  if (molvaTimer) clearTimeout(molvaTimer);
  molvaTimer = setTimeout(clearMolvaNote, MOLVA_NOTE_MS);
}

export function molvaRefresh(host, preset) {
  const X = extraLabels(preset);
  const status = el('div', { class: 'academy-status' });
  trackMolvaStatus(status);
  if (molvaNote.text) setStatus(status, molvaNote.kind, molvaNote.text);
  const button = el('div', {
    class: 'menu_button academy-btn academy-btn-small academy-molva-refresh',
    text: X.molvaButton,
    onclick: async (e) => {
      clearMolvaNote();
      const res = await runAction(e.currentTarget, status, () => call(host, 'refreshMolva'), X.molvaDone);
      if (res && res.ok !== false) {
        keepMolvaNote({
          kind: 'ok',
          text: molvaDoneText(X, res),
        });
        renderPanel(host);
      } else if (res) {
        keepMolvaNote({ kind: 'error', text: String(res.error || 'Не получилось.') });
      }
    },
  });
  return el('div', { class: 'academy-molva-refresh-box' }, [
    el('div', { class: 'academy-row academy-row-buttons' }, [button]),
    status,
  ]);
}

export function renderCastBlock(host, preset) {
  const parts = renderCastParts(host, preset);
  return parts ? section(extraLabels(preset).mobSection, parts) : null;
}

export function renderCastParts(host, preset) {
  const state = safe(() => host.getState(), null);
  if (!state || !state.started) return null;
  const X = extraLabels(preset);
  const view = castView(state, preset);
  const status = el('div', { class: 'academy-status' });

  const members = view.members.map((m) => {
    const inputs = CAST_FIELDS.map(([key, label]) => {
      const long = key === 'manner';
      const input = long
        ? el('textarea', { class: 'text_pole academy-input', rows: '2', placeholder: X.mobMannerHint })
        : el('input', { type: 'text', class: 'text_pole academy-input', value: m[key] || '' });
      if (long) input.value = m[key] || '';
      input.addEventListener('change', async () => {
        clearMolvaNote();
        const res = await call(host, 'updateFeedMember', m.id, { [key]: input.value });
        if (res && res.ok === false) {
          setStatus(status, 'error', String(res.error || 'Не сохранилось.'));
          input.value = m[key] || '';
        } else {
          setStatus(status, 'ok', X.mobSaved);
        }
      });
      return el('label', { class: `academy-field academy-mob-field${long ? ' academy-mob-wide' : ''}` }, [el('span', { text: X[label] }), input]);
    });
    return el('div', { class: 'academy-mob-member' }, [
      el('div', { class: 'academy-mob-title', text: m.title }),
      el('div', { class: 'academy-mob-fields' }, inputs),
      m.relations.length ? el('div', { class: 'academy-note', text: m.relations.join(' · ') }) : null,
    ]);
  });

  const threads = view.threads.map((t) => el('div', { class: 'academy-mob-thread' }, [
    el('div', { class: 'academy-mob-title', text: t.topic }),
    el('div', { class: 'academy-note', text: [t.paused ? X.mobThreadPaused : '', t.source].filter(Boolean).join(' · ') }),
    t.want ? el('div', { text: t.want }) : null,
    t.last ? el('div', { text: t.last }) : null,
    el('div', { class: 'academy-note', text: t.who }),
  ]));

  return [
    el('div', { class: 'academy-mob-title academy-mob-heading', text: X.mobSection }),
    el('p', { class: 'academy-note', text: X.mobNote }),
    castWarn ? el('p', { class: 'academy-note academy-note-warn', text: fill(X.mobWarn, { text: castWarn }) }) : null,
    members.length ? el('div', { class: 'academy-mob-list' }, members) : el('p', { class: 'academy-note', text: X.mobEmpty }),
    el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: X.mobRebuild,
        onclick: async (e) => {
          clearMolvaNote();
          const res = await runAction(e.currentTarget, status, () => call(host, 'rebuildFeedCast'), X.mobBuilt);
          if (res && res.ok !== false) {
            castWarn = Array.isArray(res.warnings) ? res.warnings.join(' ') : '';
            renderPanel(host);
            renderSettingsBlock(host);
          }
        },
      }),
    ]),
    el('p', { class: 'academy-note', text: X.mobRebuildNote }),
    status,
    el('div', { class: 'academy-mob-title', text: X.mobThreadsTitle }),
    threads.length ? el('div', { class: 'academy-mob-list' }, threads) : el('p', { class: 'academy-note', text: X.mobThreadsNone }),
    el('p', { class: 'academy-note', text: view.room }),
  ];
}

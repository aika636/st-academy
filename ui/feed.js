import {
  CHANNELS, unreadCount, hiddenFact, openDeals, normalizeFeed, reactCounts, reactSet, feedReactions, nickWord,
} from '../core/feed.mjs';
import { normalizePlot } from '../core/plot.mjs';
import { loreSilent } from '../core/classmates.mjs';
import { authorAvatar } from '../core/masks.mjs';
import { HEROINE } from '../core/parse-marker.mjs';
import { dealText, shortName } from '../core/scene.mjs';
import { heroGender, heroWords } from '../core/gender.mjs';
import {
  extraLabels, uiLabels, fill, formatDate, el, runAction, setStatus, call, renderPanel, mounted, safe, avatarNode,
} from './common.js';
import { molvaRefresh } from './cast.js';

export const FEED_SHOWN = 40;

export const REPLIES_SHOWN = 2;

export function repliesWord(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  const word = a > 10 && a < 20 ? 'ответов' : b === 1 ? 'ответ' : b > 1 && b < 5 ? 'ответа' : 'ответов';
  return `${n} ${word}`;
}

function nameOf(id, state, X, heroine) {
  if (id === HEROINE) return heroine || heroWords(heroGender(state, heroine)).hero;
  if (!id || id === 'someone') return X.feedSomeone;
  const teachers = (state && state.teachers) || [];
  const people = [...teachers, ...((state && state.classmates) || [])];
  const p = people.find((x) => x && x.id === id);
  if (!p) return X.feedSomeone;
  return shortName(p.name || p.id, { teacher: teachers.includes(p) }) || p.id;
}

export function feedVisible({ open = false, tab = '', hidden = false } = {}) {
  return open === true && tab === 'feed' && hidden !== true;
}

export function statusText(item, X) {
  if (item.status === 'taken') return X.feedStatusTaken;
  if (item.status === 'played') return X.feedStatusPlayed;
  if (item.status === 'expired') return item.rumor ? X.feedStatusBurst : X.feedStatusExpired;
  return '';
}

export function feedView(state, preset, opts = {}) {
  const X = extraLabels(preset);
  const chan = CHANNELS.includes(opts.chan) ? opts.chan : 'chat';
  const plot = normalizePlot(opts.plot);
  const settings = opts.settings || {};
  const hooksOn = !(settings.feed && settings.feed.hooks === false);
  const queued = new Set(plot.queue.map((h) => h.ref));
  const fresh = opts.fresh instanceof Set ? opts.fresh : new Set();
  const feed = normalizeFeed(state && state.feed);

  const open = opts.open instanceof Set ? opts.open : new Set();
  const palOpened = opts.palOpen instanceof Set ? opts.palOpen : new Set();
  const author = (x) => {
    if (x.nick) return { who: nickWord(x.nick), nick: true };
    if (x.chan === 'anon') return { who: X.feedAnonWho, nick: false, anon: true };
    return { who: nameOf(x.who, state, X, opts.heroine), nick: false };
  };
  const tones = new Map(feedReactions(preset).map((p) => [p.emoji, p.tone]));
  const reactsOf = (x, replies = 0) => {
    const counts = reactCounts(x, replies);
    if (Array.isArray(x.reacts)) return counts.map((c) => ({ ...c, tone: tones.get(c.emoji) || '' }));
    return reactSet(x).map((emoji) => counts.find((c) => c.emoji === emoji) || { emoji, n: 0, mine: false });
  };
  const paletteOf = (x) => (Array.isArray(x.pal) ? x.pal.map((emoji) => ({ emoji, tone: tones.get(emoji) || '', mine: x.mine === emoji })) : null);
  const items = feed.items
    .filter((x) => x.chan === chan && !x.parent && !x.minor && !hiddenFact(x, feed.items))
    .slice(-FEED_SHOWN)
    .reverse()
    .map((x) => {
      const fact = x.kind === 'fact';
      const anon = x.chan === 'anon';
      const tag = fact ? (x.rumor ? '' : X.feedFactTag) : anon ? X.feedRumorTag : (x.factText ? X.feedTalkTag : '');
      const thread = feed.items.filter((y) => y.parent === x.id);
      const unfolded = open.has(x.id) || thread.length <= REPLIES_SHOWN;
      const who = fact ? { who: X.feedFromScene, nick: false } : author(x);
      return {
        id: x.id,
        who: who.who,
        nick: who.nick,
        anon: who.anon === true,
        scene: fact,
        avatar: fact ? null : authorAvatar(state, x, { heroine: opts.heroine }),
        text: x.text,
        tag,
        rumor: x.rumor,
        about: !fact && x.factText ? fill(X.feedAbout, { fact: x.factText }) : '',
        dayLine: formatDate(x.at.day),
        status: x.status,
        statusText: statusText(x, X),
        unread: !x.read || fresh.has(x.id),
        canTake: hooksOn && x.status === 'new' && !queued.has(x.id),
        reacts: reactsOf(x, thread.length),
        palette: paletteOf(x),
        palOpen: palOpened.has(x.id),
        replies: (unfolded ? thread : thread.slice(0, REPLIES_SHOWN)).map((y) => ({
          id: y.id,
          ...author(y),
          avatar: authorAvatar(state, y, { heroine: opts.heroine }),
          text: y.text,
          unread: !y.read || fresh.has(y.id),
          reacts: reactsOf(y),
          palette: paletteOf(y),
          palOpen: palOpened.has(y.id),
        })),
        repliesTotal: thread.length,
        more: unfolded ? 0 : thread.length - REPLIES_SHOWN,
        moreText: unfolded ? '' : fill(X.feedMoreReplies, { n: repliesWord(thread.length - REPLIES_SHOWN) }),
        unfolded: open.has(x.id) && thread.length > REPLIES_SHOWN,
      };
    });

  const people = [...((state && state.teachers) || []), ...((state && state.classmates) || [])];
  const deals = chan !== 'chat' ? [] : openDeals(state).map((d) => ({
    id: d.id,
    text: dealText({ ...d, closed: false }, people, opts.heroine, heroGender(state, opts.heroine)),
    canTake: hooksOn && !queued.has(d.id),
  }));

  const armedAt = plot.queue.findIndex((h) => h.armed);
  const queue = plot.queue.map((h, i) => ({
    id: h.id,
    text: h.core || h.text,
    auto: h.auto,
    stateText: h.kind === 'invite' ? X.feedQueueNext : h.delivered ? X.feedQueueSent
      : (i === (armedAt >= 0 ? armedAt : 0) ? X.feedQueueNext : X.feedQueueLater),
  }));

  const total = feed.items.length;
  return {
    chan,
    channels: CHANNELS.map((id) => ({
      id,
      label: id === 'anon' ? X.feedAnon : X.feedChat,
      unread: unreadCount(state, id),
      on: id === chan,
    })),
    items,
    unreadIds: feed.items.filter((x) => x.chan === chan && !x.read && !hiddenFact(x, feed.items)).map((x) => x.id),
    empty: total === 0,
    emptyText: X.feedEmpty,
    chanEmptyText: chan === 'anon' ? X.feedEmptyAnon : X.feedEmptyChat,
    deals,
    queue,
    hooksOn,
    note: hooksOn ? X.feedMuteHint : X.feedHooksOff,
    loreHint: loreHint(state, preset, X),
  };
}

export function loreHint(state, preset, X = extraLabels(preset)) {
  const names = loreSilent(state);
  if (!names.length) return '';
  const U = uiLabels(preset);
  const list = names.length > 3 ? `${names.slice(0, 3).join(', ')} ${fill(X.feedLoreMore, { n: names.length - 3 })}` : names.join(', ');
  return fill(X.feedLoreHint, { names: list, course: U.classmatesTitle, people: U.tabPeople });
}

export function feedMentions(state, preset, opts = {}) {
  const X = extraLabels(preset);
  const shown = new Map();
  for (const chan of CHANNELS) {
    for (const it of feedView(state, preset, { chan, heroine: opts.heroine }).items) shown.set(it.id, it);
  }
  const feed = normalizeFeed(state && state.feed);
  const out = {};
  for (let i = feed.items.length - 1; i >= 0; i -= 1) {
    const x = feed.items[i];
    const it = shown.get(x.id);
    if (!it) continue;
    for (const id of x.about) {
      (out[id] = out[id] || []).push({
        id: it.id,
        chan: x.chan,
        chanLabel: x.chan === 'anon' ? X.feedAnon : X.feedChat,
        who: it.who,
        nick: it.nick,
        text: it.text,
        dayLine: it.dayLine,
        rumor: Boolean(it.rumor),
      });
    }
  }
  return out;
}

export function renderFeed(host, view, preset) {
  const X = extraLabels(preset);
  const U = uiLabels(preset);
  const desk = mounted.spread === true;

  const visible = feedVisible({
    open: Boolean(mounted.panel && mounted.panel.classList && mounted.panel.classList.contains('academy-open')),
    tab: mounted.tab,
    hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
  });
  if (visible && view.unreadIds.length) {
    for (const id of view.unreadIds) mounted.feedFresh.add(id);
    safe(() => call(host, 'feedRead', view.unreadIds), null);
  }

  const title = el('div', { class: 'ad-p-title' }, [el('h2', { text: U.tabFeed })]);
  const queue = view.queue.length ? queueBlock(host, view, X) : null;
  const refresh = molvaRefresh(host, preset);

  const chans = el('div', { class: 'ad-chans', role: 'tablist' }, view.channels.map((c) => el('button', {
    type: 'button',
    role: 'tab',
    'aria-selected': c.on ? 'true' : 'false',
    dataset: { chan: c.id },
    onclick: () => { mounted.feedChan = c.id; mounted.feedPreview = null; renderPanel(host); },
  }, [
    el('span', { text: c.label }),
    c.unread ? el('span', { class: 'ad-badge', text: String(c.unread) }) : null,
  ])));

  let posts;
  if (view.empty) posts = el('div', { class: 'ad-silent', text: view.emptyText });
  else if (!view.items.length) posts = el('div', { class: 'ad-silent', text: view.chanEmptyText });
  else posts = el('div', { class: 'ad-feed-list' }, view.items.map((it) => feedCard(host, it, X)));

  const deals = view.deals.length ? [
    el('h3', { class: 'ad-sec-h', text: X.feedDealsTitle }),
    ...view.deals.map((d) => el('div', { class: 'ad-post ad-deal-row', dataset: { deal: d.id } }, [
      el('div', { class: 'ad-post-text', text: d.text }),
      d.canTake ? takeButton(host, d.id, X) : null,
      previewFor(host, d.id, X),
    ])),
  ] : [];
  const note = el('p', { class: 'ad-hint-note', text: view.note });
  const lore = view.loreHint ? el('p', { class: 'ad-hint-note ad-lore-hint', text: view.loreHint }) : null;
  focusPost(view);

  if (desk) return { l: [title, chans, posts], r: el('div', { class: 'ad-side' }, [queue, refresh, ...deals, lore, note]) };
  return { l: [title, queue, chans, posts, ...deals, refresh, lore, note], r: null, blankRight: true };
}

function whoNode(it, X) {
  if (it.nick) return el('span', { class: 'ad-nick', text: it.who, title: X.feedNickHint });
  if (it.anon || it.scene) return el('span', { class: 'ad-anon-who', text: it.who });
  return el('span', { class: 'ad-who', text: it.who });
}

function feedCard(host, it, X) {
  return el('article', { class: it.unread ? 'ad-post ad-unread' : 'ad-post', dataset: { id: it.id } }, [
    it.unread ? el('i', { class: 'ad-marker', dataset: { kind: 'feed' } }) : null,
    el('div', { class: 'ad-post-head' }, [
      it.avatar ? avatarNode(it.avatar, { size: 'feed' }) : null,
      whoNode(it, X),
      it.tag ? el('span', { class: it.rumor ? 'ad-ptag ad-rumor' : 'ad-ptag', text: it.tag }) : null,
      it.dayLine ? el('span', { class: 'ad-pday', text: it.dayLine }) : null,
    ]),
    el('div', { class: 'ad-post-text', text: it.text }),
    it.about ? el('details', { class: 'ad-post-about' }, [
      el('summary', { text: X.feedAboutSummary }),
      el('div', { class: 'ad-post-about-text', text: it.about }),
    ]) : null,
    it.statusText ? el('div', { class: `ad-post-status${it.status === 'taken' ? ' ad-taken' : ''}`, dataset: { status: it.status }, text: it.statusText }) : null,
    reactRow(host, it, X),
    threadBlock(host, it, X),
    it.canTake ? takeButton(host, it.id, X) : null,
    previewFor(host, it.id, X),
  ]);
}

function reactRow(host, it, X, small = false) {
  const pal = it.palette && it.palette.length ? it.palette : null;
  if ((!it.reacts || !it.reacts.length) && !pal) return null;
  const status = el('div', { class: 'academy-status' });
  const button = (r, extra = {}) => el('button', {
    type: 'button',
    class: r.n === 0 ? 'ad-zero' : null,
    'aria-pressed': r.mine ? 'true' : 'false',
    ...(r.tone ? { 'aria-label': r.tone, title: r.tone } : {}),
    dataset: { emoji: r.emoji },
    onclick: async () => {
      const res = await call(host, 'feedReact', it.id, r.emoji).catch((err) => ({ ok: false, error: String((err && err.message) || err) }));
      if (res && res.ok === false) setStatus(status, 'error', res.error || 'Не получилось.');
      else renderPanel(host);
    },
    ...extra,
  }, [
    el('span', { class: 'ad-e', text: r.emoji }),
    r.n ? String(r.n) : null,
  ]);
  const more = pal ? el('button', {
    type: 'button',
    class: 'ad-react-more',
    'aria-expanded': it.palOpen ? 'true' : 'false',
    'aria-label': X.feedReactMore,
    title: X.feedReactMore,
    text: it.palOpen ? '−' : '+',
    onclick: () => {
      if (it.palOpen) mounted.feedPal.delete(it.id);
      else mounted.feedPal.add(it.id);
      renderPanel(host);
    },
  }) : null;
  return el('div', { class: small ? 'ad-reacts ad-small' : 'ad-reacts', title: X.feedReactHint }, [
    ...(it.reacts || []).map((r) => button(r)),
    more,
    status,
    ...(pal && it.palOpen ? [el('div', { class: 'ad-react-pal' }, pal.map((r) => button({ ...r, n: null })))] : []),
  ]);
}

function focusPost(view) {
  const id = mounted.feedFocus;
  mounted.feedFocus = null;
  if (!id || !view.items.some((it) => it.id === id)) return;
  setTimeout(() => safe(() => {
    const node = [...mounted.panel.querySelectorAll('.ad-post')].find((n) => n.dataset.id === id);
    if (!node) return;
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node.classList.add('ad-focus');
    setTimeout(() => node.classList.remove('ad-focus'), 2400);
  }, null), 0);
}

function threadBlock(host, it, X) {
  if (!it.repliesTotal) return null;
  const toggle = (on) => () => {
    if (on) mounted.feedOpen.add(it.id);
    else mounted.feedOpen.delete(it.id);
    renderPanel(host);
  };
  return el('div', { class: 'ad-thread', role: 'list', 'aria-label': X.feedRepliesLabel }, [
    ...it.replies.map((a) => el('div', {
      class: a.unread ? 'ad-reply ad-unread' : 'ad-reply',
      role: 'listitem',
      dataset: { id: a.id },
    }, [
      el('div', { class: 'ad-reply-line' }, [
        a.avatar ? avatarNode(a.avatar, { size: 'reply' }) : null,
        el('div', { class: 'ad-reply-body' }, [
          whoNode(a, X),
          el('span', { text: a.text }),
        ]),
      ]),
      reactRow(host, a, X, true),
    ])),
    it.more ? el('button', { type: 'button', class: 'ad-link ad-feed-more', text: it.moreText, onclick: toggle(true) }) : null,
    it.unfolded ? el('button', { type: 'button', class: 'ad-link ad-feed-more', text: X.feedFoldReplies, onclick: toggle(false) }) : null,
  ]);
}

function takeButton(host, ref, X) {
  if (mounted.feedPreview && mounted.feedPreview.ref === ref) return null;
  return el('div', { class: 'ad-take-row' }, [el('button', {
    type: 'button',
    class: 'ad-take',
    text: X.feedTake,
    onclick: () => {
      const draft = safe(() => host.getFeedDraft(ref), null);
      mounted.feedPreview = { ref, text: (draft && draft.text) || '' };
      renderPanel(host);
    },
  })]);
}

function previewFor(host, ref, X) {
  const pv = mounted.feedPreview;
  if (!pv || pv.ref !== ref) return null;
  const status = el('div', { class: 'academy-status' });
  const area = el('textarea', { rows: '4', 'aria-label': X.feedPreviewTitle });
  area.value = pv.text;
  area.addEventListener('input', () => { pv.text = area.value; });
  return el('div', { class: 'ad-preview', role: 'group', 'aria-label': X.feedPreviewTitle }, [
    el('div', { class: 'ad-pv-title', text: X.feedPreviewTitle }),
    area,
    el('p', { class: 'ad-pv-note', text: X.feedPreviewNote }),
    el('div', { class: 'ad-pv-btns' }, [
      el('button', {
        type: 'button',
        class: 'ad-btn ad-main ad-tiny',
        text: X.feedSend,
        onclick: async (e) => {
          const res = await runAction(e.currentTarget, status, () => call(host, 'takeHook', ref, String(area.value || '')), X.feedSent);
          if (res && res.ok !== false) {
            mounted.feedPreview = null;
            renderPanel(host);
          }
        },
      }),
      el('button', {
        type: 'button',
        class: 'ad-btn ad-quiet ad-tiny',
        text: X.feedCancel,
        onclick: () => { mounted.feedPreview = null; renderPanel(host); },
      }),
    ]),
    status,
  ]);
}

function queueBlock(host, view, X) {
  const status = el('div', { class: 'academy-status' });
  return el('div', { class: 'ad-queue' }, [
    el('h3', { class: 'ad-sec-h', text: X.feedQueueTitle }),
    ...view.queue.map((q) => el('div', { class: 'ad-queue-item' }, [
      el('div', { text: q.text }),
      el('div', { class: 'ad-q-state', text: [q.stateText, q.auto ? X.feedQueueAuto : ''].filter(Boolean).join(' · ') }),
      el('div', {}, [el('button', {
        type: 'button',
        class: 'ad-btn ad-quiet ad-tiny',
        text: X.feedDrop,
        onclick: async (e) => {
          const res = await runAction(e.currentTarget, status, () => call(host, 'dropHook', q.id), X.feedDropped);
          if (res && res.ok !== false) renderPanel(host);
        },
      })]),
    ])),
    status,
  ]);
}

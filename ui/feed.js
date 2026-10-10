// ui/feed.js — вкладка «Поток» (шаг 4): лента курса в два канала и кнопка
// «Взять в сюжет».
//
// Лента — чтение для игрока и меню поводов (9.11): в промпт целиком она не
// идёт. Здесь видно, что говорят, к какому факту, в какой день и что с поводом
// стало («взято в сюжет / сыграно / лопнуло / истекло» — `razbor-inject.md`,
// приём 12). «Чат курса» — факты и их обсуждение, автор виден; «Анонимка» —
// слухи, автор — «без подписи», пометка «слух» всегда.
//
// Прочитанным помечается только то, что человек видит: панель открыта, на
// экране вкладка «Поток», страница не спрятана (`feedVisible`). Перерисовка
// закрытой панели — по новому ответу, по любому событию таверны — ленту не
// читает.
//
// «Взять в сюжет» не отправляет сразу: сначала превью формулировки с правкой
// (приём 7), потом «Отправить в следующий ответ» или «Отмена». Очередь —
// здесь же, с кнопкой «Убрать».
//
// Пост и под ним ветка (решение 08.10): ответы с отступом, после двух —
// «ещё 3 ответа». Человек из состава — кружок с фото или инициалами и имя
// жирным; маска — кружок со значком по смыслу ника (😈 у «школьного беса»,
// `core/masks.mjs`) и «@ник» курсивом: ник не человек, портрета у него нет.
// Строка значков (😂 12) — у поста и, поменьше, у ответа: счёт считает код,
// нажатие ставит свой значок; это украшение, на сюжет оно не влияет.
//
// Что показать (`feedView`) — без DOM, проверяется в Node; чем показать
// (`renderFeed`) — ниже.

import {
  CHANNELS, unreadCount, openDeals, normalizeFeed, reactCounts, reactSet, nickWord,
} from '../core/feed.mjs';
import { normalizePlot } from '../core/plot.mjs';
import { authorAvatar } from '../core/masks.mjs';
import { HEROINE } from '../core/parse-marker.mjs';
import { dealText, shortName } from '../core/scene.mjs';
import {
  extraLabels, fill, formatDate, el, runAction, setStatus, call, renderPanel, mounted, safe, avatarNode,
} from './common.js';
import { molvaRefresh } from './cast.js';

/** Сколько записей канала показывать: лента длинная, телефон — нет. */
export const FEED_SHOWN = 40;

/** Сколько ответов ветки видно сразу; остальные — «ещё 3 ответа». */
export const REPLIES_SHOWN = 2;

/** «1 ответ», «3 ответа», «5 ответов». */
export function repliesWord(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  const word = a > 10 && a < 20 ? 'ответов' : b === 1 ? 'ответ' : b > 1 && b < 5 ? 'ответа' : 'ответов';
  return `${n} ${word}`;
}

/** Человек словом для ленты. */
function nameOf(id, state, X, heroine) {
  if (id === HEROINE) return heroine || 'героиня';
  if (!id || id === 'someone') return X.feedSomeone;
  const teachers = (state && state.teachers) || [];
  const people = [...teachers, ...((state && state.classmates) || [])];
  const p = people.find((x) => x && x.id === id);
  if (!p) return X.feedSomeone;
  // В чате — коротко, как подписываются: преподаватель фамилией, однокурсник
  // без отчества (`scene.shortName`, третий прогон 08.10).
  return shortName(p.name || p.id, { teacher: teachers.includes(p) }) || p.id;
}

/**
 * Видит ли человек ленту прямо сейчас: панель открыта, выбрана вкладка
 * «Поток», страница не в фоне. Только тогда открытый канал — прочитан.
 *
 * @param {{open?: boolean, tab?: string, hidden?: boolean}} where
 */
export function feedVisible({ open = false, tab = '', hidden = false } = {}) {
  return open === true && tab === 'feed' && hidden !== true;
}

/** Жизнь повода словами; у истёкшего слуха — «лопнуло». */
export function statusText(item, X) {
  if (item.status === 'taken') return X.feedStatusTaken;
  if (item.status === 'played') return X.feedStatusPlayed;
  if (item.status === 'expired') return item.rumor ? X.feedStatusBurst : X.feedStatusExpired;
  return '';
}

/**
 * Что показать на вкладке. Без DOM.
 *
 * @param {Object} state
 * @param {Object} preset
 * @param {{plot?: Object, settings?: Object, chan?: string, heroine?: string, fresh?: Set<string>}} [opts]
 */
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
  // Кто пишет: маска — «@ник» (и в анонимке: она и есть подпись), человек —
  // имя, анонимка без маски — «без подписи».
  const author = (x) => {
    if (x.nick) return { who: nickWord(x.nick), nick: true };
    if (x.chan === 'anon') return { who: X.feedAnonWho, nick: false, anon: true };
    return { who: nameOf(x.who, state, X, opts.heroine), nick: false };
  };
  // Значки записи — все из набора, со счётом; ноль показывается значком без
  // числа, чтобы его можно было нажать.
  const reactsOf = (x, replies = 0) => {
    const counts = reactCounts(x, replies);
    return reactSet(x).map((emoji) => counts.find((c) => c.emoji === emoji) || { emoji, n: 0, mine: false });
  };
  const items = feed.items
    .filter((x) => x.chan === chan && !x.parent)
    .slice(-FEED_SHOWN)
    .reverse()
    .map((x) => {
      const fact = x.kind === 'fact';
      const anon = x.chan === 'anon';
      // Пометка одна и не повторяет текст: у факта-слуха «слух: …» уже в
      // самом тексте; реплика чата — «обсуждают» (и про слух тоже: она
      // обсуждение, а не слух); анонимка — «слух».
      const tag = fact ? (x.rumor ? '' : X.feedFactTag) : anon ? X.feedRumorTag : X.feedTalkTag;
      const thread = feed.items.filter((y) => y.parent === x.id);
      // Ветка свёрнута после двух ответов, пока её не раскрыли.
      const unfolded = open.has(x.id) || thread.length <= REPLIES_SHOWN;
      const who = fact ? { who: X.feedFromScene, nick: false } : author(x);
      return {
        id: x.id,
        who: who.who,
        nick: who.nick,
        anon: who.anon === true,
        // Кружок автора: у факта из сцены автора нет — и кружка нет.
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
        replies: (unfolded ? thread : thread.slice(0, REPLIES_SHOWN)).map((y) => ({
          id: y.id,
          ...author(y),
          avatar: authorAvatar(state, y, { heroine: opts.heroine }),
          text: y.text,
          unread: !y.read || fresh.has(y.id),
          // У ответа значков меньше (`feed.REPLY_REACTS`), свой — тоже можно.
          reacts: reactsOf(y),
        })),
        repliesTotal: thread.length,
        more: unfolded ? 0 : thread.length - REPLIES_SHOWN,
        moreText: unfolded ? '' : fill(X.feedMoreReplies, { n: repliesWord(thread.length - REPLIES_SHOWN) }),
        unfolded: open.has(x.id) && thread.length > REPLIES_SHOWN,
      };
    });

  const people = [...((state && state.teachers) || []), ...((state && state.classmates) || [])];
  const deals = openDeals(state).map((d) => ({
    id: d.id,
    // «Мила должна Вере: вернуть тетрадь» (`scene.dealText`).
    text: dealText({ ...d, closed: false }, people, opts.heroine),
    canTake: hooksOn && !queued.has(d.id),
  }));

  const armedAt = plot.queue.findIndex((h) => h.armed);
  const queue = plot.queue.map((h, i) => ({
    id: h.id,
    text: h.core || h.text,
    auto: h.auto,
    stateText: h.delivered ? X.feedQueueSent
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
    unreadIds: feed.items.filter((x) => x.chan === chan && !x.read).map((x) => x.id),
    empty: total === 0,
    emptyText: X.feedEmpty,
    chanEmptyText: chan === 'anon' ? X.feedEmptyAnon : X.feedEmptyChat,
    deals,
    queue,
    hooksOn,
    note: hooksOn ? X.feedMuteHint : X.feedHooksOff,
  };
}

// --- отрисовка -----------------------------------------------------------------

/**
 * Вкладка «Поток». Открытый канал помечается прочитанным сразу, но
 * выделение держится, пока вкладка открыта (`mounted.feedFresh`): иначе
 * новое гасло бы раньше, чем его увидели.
 */
export function renderFeed(host, view, preset) {
  const X = extraLabels(preset);
  const box = el('div', { class: 'academy-feed' });

  const visible = feedVisible({
    open: Boolean(mounted.panel && mounted.panel.classList && mounted.panel.classList.contains('academy-open')),
    tab: mounted.tab,
    hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
  });
  if (visible && view.unreadIds.length) {
    for (const id of view.unreadIds) mounted.feedFresh.add(id);
    safe(() => call(host, 'feedRead', view.unreadIds), null);
  }

  if (view.queue.length) box.append(queueBlock(host, view, X));

  // «Обновить молву» есть всегда, и при пустой ленте тоже: автомат мог быть выключен.
  box.append(molvaRefresh(host, preset));

  box.append(el('div', { class: 'academy-feed-chans', role: 'tablist' }, view.channels.map((c) => el('div', {
    class: c.on ? 'menu_button academy-btn academy-feed-chan academy-feed-chan-on' : 'menu_button academy-btn academy-feed-chan',
    role: 'tab',
    'aria-selected': c.on ? 'true' : 'false',
    dataset: { chan: c.id },
    onclick: () => { mounted.feedChan = c.id; mounted.feedPreview = null; renderPanel(host); },
  }, [
    el('span', { text: c.label }),
    c.unread ? el('span', { class: 'academy-feed-badge', text: String(c.unread) }) : null,
  ]))));

  if (view.empty) {
    box.append(el('div', { class: 'academy-silent', text: view.emptyText }));
  } else if (!view.items.length) {
    box.append(el('div', { class: 'academy-silent', text: view.chanEmptyText }));
  } else {
    box.append(el('div', { class: 'academy-feed-list' }, view.items.map((it) => feedCard(host, it, X))));
  }

  if (view.deals.length) {
    box.append(el('div', { class: 'academy-feed-deals' }, [
      el('div', { class: 'academy-card-title', text: X.feedDealsTitle }),
      ...view.deals.map((d) => el('div', { class: 'academy-feed-item academy-feed-deal' }, [
        el('div', { class: 'academy-feed-text', text: d.text }),
        d.canTake ? takeButton(host, d.id, X) : null,
        previewFor(host, d.id, X),
      ])),
    ]));
  }

  box.append(el('p', { class: 'academy-note', text: view.note }));
  return box;
}

/** Автор: человек — имя жирным, маска — «@ник» курсивом, с подсказкой. */
function whoNode(it, X) {
  if (it.nick) return el('span', { class: 'academy-feed-who academy-feed-nick', text: it.who, title: X.feedNickHint });
  // «Без подписи» — не имя: серым курсивом, как маска, а не жирным, как человек.
  if (it.anon) return el('span', { class: 'academy-feed-who academy-feed-nick academy-feed-anon', text: it.who });
  return el('span', { class: 'academy-feed-who', text: it.who });
}

function feedCard(host, it, X) {
  return el('div', { class: it.unread ? 'academy-feed-item academy-feed-unread' : 'academy-feed-item', dataset: { id: it.id } }, [
    el('div', { class: 'academy-feed-head' }, [
      it.avatar ? avatarNode(it.avatar, { size: 'feed' }) : null,
      whoNode(it, X),
      it.tag ? el('span', { class: it.rumor ? 'academy-feed-tag academy-feed-tag-rumor' : 'academy-feed-tag', text: it.tag }) : null,
      it.dayLine ? el('span', { class: 'academy-feed-day', text: it.dayLine }) : null,
    ]),
    el('div', { class: 'academy-feed-text', text: it.text }),
    it.about ? el('div', { class: 'academy-feed-about', text: it.about }) : null,
    it.statusText ? el('div', { class: `academy-feed-status academy-feed-status-${it.status}`, text: it.statusText }) : null,
    reactRow(host, it, X),
    threadBlock(host, it, X),
    it.canTake ? takeButton(host, it.id, X) : null,
    previewFor(host, it.id, X),
  ]);
}

/**
 * Строка значков под постом или ответом: счёт считает код, нажатие — свой
 * значок. У ответа строка компактнее (`small`).
 */
function reactRow(host, it, X, small = false) {
  if (!it.reacts || !it.reacts.length) return null;
  const status = el('div', { class: 'academy-status' });
  return el('div', { class: small ? 'academy-feed-reacts academy-feed-reacts-small' : 'academy-feed-reacts', title: X.feedReactHint }, [
    ...it.reacts.map((r) => el('div', {
      class: r.mine ? 'menu_button academy-feed-react academy-feed-react-mine' : 'menu_button academy-feed-react',
      role: 'button',
      'aria-pressed': r.mine ? 'true' : 'false',
      dataset: { emoji: r.emoji },
      // Без «Идёт запрос…» на кнопке: значок мгновенный, а надпись затёрла бы
      // сам значок. Отказ — строкой под рядом.
      onclick: async () => {
        const res = await call(host, 'feedReact', it.id, r.emoji).catch((err) => ({ ok: false, error: String((err && err.message) || err) }));
        if (res && res.ok === false) setStatus(status, 'error', res.error || 'Не получилось.');
        else renderPanel(host);
      },
    }, [
      el('span', { class: 'academy-feed-react-emoji', text: r.emoji }),
      r.n ? el('span', { class: 'academy-feed-react-n', text: String(r.n) }) : null,
    ])),
    status,
  ]);
}

/** Ветка ответов под постом: с отступом, свёрнута после двух. */
function threadBlock(host, it, X) {
  if (!it.repliesTotal) return null;
  const toggle = (on) => () => {
    if (on) mounted.feedOpen.add(it.id);
    else mounted.feedOpen.delete(it.id);
    renderPanel(host);
  };
  return el('div', { class: 'academy-feed-thread', role: 'list', 'aria-label': X.feedRepliesLabel }, [
    ...it.replies.map((a) => el('div', {
      class: a.unread ? 'academy-feed-reply academy-feed-unread' : 'academy-feed-reply',
      role: 'listitem',
      dataset: { id: a.id },
    }, [
      el('div', { class: 'academy-feed-reply-line' }, [
        a.avatar ? avatarNode(a.avatar, { size: 'reply' }) : null,
        el('div', { class: 'academy-feed-reply-body' }, [
          whoNode(a, X),
          el('span', { class: 'academy-feed-text', text: a.text }),
        ]),
      ]),
      reactRow(host, a, X, true),
    ])),
    it.more ? el('div', { class: 'menu_button academy-btn academy-btn-small academy-feed-more', text: it.moreText, onclick: toggle(true) }) : null,
    it.unfolded ? el('div', { class: 'menu_button academy-btn academy-btn-small academy-feed-more', text: X.feedFoldReplies, onclick: toggle(false) }) : null,
  ]);
}

function takeButton(host, ref, X) {
  if (mounted.feedPreview && mounted.feedPreview.ref === ref) return null;
  return el('div', {
    class: 'menu_button academy-btn academy-feed-take',
    text: X.feedTake,
    onclick: () => {
      const draft = safe(() => host.getFeedDraft(ref), null);
      mounted.feedPreview = { ref, text: (draft && draft.text) || '' };
      renderPanel(host);
    },
  });
}

/** Превью формулировки с правкой — под той записью, у которой нажали. */
function previewFor(host, ref, X) {
  const pv = mounted.feedPreview;
  if (!pv || pv.ref !== ref) return null;
  const status = el('div', { class: 'academy-status' });
  const area = el('textarea', { class: 'text_pole academy-input academy-feed-edit', rows: '5' });
  area.value = pv.text;
  area.addEventListener('input', () => { pv.text = area.value; });
  return el('div', { class: 'academy-feed-preview' }, [
    // Не заголовок раздела, а подпись к полю — без капса (`style.css`).
    el('div', { class: 'academy-feed-preview-title', text: X.feedPreviewTitle }),
    area,
    el('p', { class: 'academy-note', text: X.feedPreviewNote }),
    el('div', { class: 'academy-row academy-row-buttons academy-feed-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn academy-btn-main',
        text: X.feedSend,
        onclick: async (e) => {
          const res = await runAction(e.currentTarget, status, () => call(host, 'takeHook', ref, String(area.value || '')), X.feedSent);
          if (res && res.ok !== false) {
            mounted.feedPreview = null;
            renderPanel(host);
          }
        },
      }),
      el('div', {
        class: 'menu_button academy-btn',
        text: X.feedCancel,
        onclick: () => { mounted.feedPreview = null; renderPanel(host); },
      }),
    ]),
    status,
  ]);
}

function queueBlock(host, view, X) {
  const status = el('div', { class: 'academy-status' });
  return el('div', { class: 'academy-feed-queue' }, [
    el('div', { class: 'academy-card-title', text: X.feedQueueTitle }),
    ...view.queue.map((q) => el('div', { class: 'academy-feed-item academy-feed-queued' }, [
      el('div', { class: 'academy-feed-text', text: q.text }),
      el('div', { class: 'academy-feed-status', text: [q.stateText, q.auto ? X.feedQueueAuto : ''].filter(Boolean).join(' · ') }),
      el('div', {
        class: 'menu_button academy-btn academy-btn-small academy-feed-drop',
        text: X.feedDrop,
        onclick: async (e) => {
          const res = await runAction(e.currentTarget, status, () => call(host, 'dropHook', q.id), X.feedDropped);
          if (res && res.ok !== false) renderPanel(host);
        },
      }),
    ])),
    status,
  ]);
}

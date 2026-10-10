// ui/cast.js — «Статисты и сюжетики» (шаг 1 плана «Молва»): постоянные ученики
// ленты с ручной правкой, кнопка «Пересобрать каст» и открытые сюжетики массовки.
//
// Каст и сюжетики лежат в `state.feed` и принадлежат чату; блок рисуется в
// «Настройках» рядом с блоком ленты. Слова — людские: «дружит с», «враждует с»,
// без `id` и `ally`. Что показать (`castView`) — без DOM, проверяется в Node;
// чем показать (`renderCastBlock`) — ниже.

import { normalizeFeed, nickWord, THREADS_MAX } from '../core/feed.mjs';
import { extraLabels, fill, el, runAction, setStatus, section, call, safe, renderPanel } from './common.js';

/** Поля, что правятся руками, в порядке показа: ключ статиста, ключ подписи. */
export const CAST_FIELDS = [
  ['nick', 'mobNick'], ['type', 'mobType'], ['interest', 'mobInterest'], ['goal', 'mobGoal'], ['manner', 'mobManner'],
];

/**
 * Что показать. Без DOM.
 *
 * @param {Object} state
 * @param {Object} preset
 * @returns {{members: Array<{id: string, title: string, nick: string, type: string, interest: string,
 *   goal: string, manner: string, relations: string[]}>,
 *   threads: Array<{id: string, topic: string, dispute: string, stage: string, source: string, who: string}>,
 *   room: string}}
 */
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
  const threads = feed.threads.map((t) => ({
    id: t.id,
    topic: t.topic,
    dispute: t.dispute,
    stage: fill(X.mobThreadStage, { stage: t.stage }),
    source: (X.mobThreadSource && X.mobThreadSource[t.source]) || '',
    who: fill(X.mobThreadWho, { names: t.members.map((id) => nick.get(id) || '').filter(Boolean).join(', ') }),
  }));
  return { members, threads, room: fill(X.mobThreadRoom, { n: threads.length, max: THREADS_MAX }) };
}

/** Замечания последней сборки: панель перерисовывается, а они должны дожить до показа. */
let castWarn = '';

/** Блок «Статисты и сюжетики» для вкладки «Настройки». Нет семестра — блока нет. */
export function renderCastBlock(host, preset) {
  const state = safe(() => host.getState(), null);
  if (!state || !state.started) return null;
  const X = extraLabels(preset);
  const view = castView(state, preset);
  const status = el('div', { class: 'academy-status' });

  const members = view.members.map((m) => {
    const inputs = CAST_FIELDS.map(([key, label]) => {
      const input = el('input', { type: 'text', class: 'text_pole academy-input', value: m[key] || '' });
      input.addEventListener('change', async () => {
        const res = await call(host, 'updateFeedMember', m.id, { [key]: input.value });
        if (res && res.ok === false) {
          setStatus(status, 'error', String(res.error || 'Не сохранилось.'));
          // Отказ (ник занят, ник короче двух букв) — поле возвращается к прежнему.
          input.value = m[key] || '';
        } else {
          setStatus(status, 'ok', X.mobSaved);
        }
      });
      return el('label', { class: 'academy-field academy-mob-field' }, [el('span', { text: X[label] }), input]);
    });
    return el('div', { class: 'academy-mob-member' }, [
      el('div', { class: 'academy-mob-title', text: m.title }),
      el('div', { class: 'academy-mob-fields' }, inputs),
      m.relations.length ? el('div', { class: 'academy-note', text: m.relations.join(' · ') }) : null,
    ]);
  });

  const threads = view.threads.map((t) => el('div', { class: 'academy-mob-thread' }, [
    el('div', { class: 'academy-mob-title', text: t.topic }),
    el('div', { class: 'academy-note', text: [t.stage, t.source].filter(Boolean).join(' · ') }),
    t.dispute ? el('div', { text: t.dispute }) : null,
    el('div', { class: 'academy-note', text: t.who }),
  ]));

  return section(X.mobSection, [
    el('p', { class: 'academy-note', text: X.mobNote }),
    castWarn ? el('p', { class: 'academy-note academy-note-warn', text: fill(X.mobWarn, { text: castWarn }) }) : null,
    members.length ? el('div', { class: 'academy-mob-list' }, members) : el('p', { class: 'academy-note', text: X.mobEmpty }),
    el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: X.mobRebuild,
        onclick: async (e) => {
          const res = await runAction(e.currentTarget, status, () => call(host, 'rebuildFeedCast'), X.mobBuilt);
          if (res && res.ok !== false) {
            castWarn = Array.isArray(res.warnings) ? res.warnings.join(' ') : '';
            renderPanel(host);
          }
        },
      }),
    ]),
    el('p', { class: 'academy-note', text: X.mobRebuildNote }),
    status,
    el('div', { class: 'academy-mob-title', text: X.mobThreadsTitle }),
    threads.length ? el('div', { class: 'academy-mob-list' }, threads) : el('p', { class: 'academy-note', text: X.mobThreadsNone }),
    el('p', { class: 'academy-note', text: view.room }),
  ]);
}

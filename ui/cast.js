// ui/cast.js — «Статисты и сюжетики» (шаг 1 плана «Молва»): постоянные ученики
// ленты с ручной правкой, кнопка «Пересобрать каст» и открытые сюжетики массовки.
//
// Каст и сюжетики лежат в `state.feed` и принадлежат чату; блок рисуется в
// «Настройках» рядом с блоком ленты. Слова — людские: «дружит с», «враждует с»,
// без `id` и `ally`. Что показать (`castView`) — без DOM, проверяется в Node;
// чем показать (`renderCastBlock`) — ниже.

import { normalizeFeed, nickWord, THREADS_MAX } from '../core/feed.mjs';
import { extraLabels, fill, el, runAction, setStatus, section, call, safe, renderPanel, renderSettingsBlock } from './common.js';

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

/** Что сказала последняя кнопка «Обновить молву»: перерисовка панели её не стирает. */
let molvaNote = { kind: '', text: '' };

/** Через сколько итог выпуска гаснет сам (баг 76). */
export const MOLVA_NOTE_MS = 10000;

let molvaTimer = null;
/** Строки итога, что сейчас на экране: гаснут вместе с заметкой. */
const molvaStatuses = new Set();

/** Забыть итог выпуска и стереть его с экрана; зовут таймер и любое следующее действие. */
export function clearMolvaNote() {
  if (molvaTimer) clearTimeout(molvaTimer);
  molvaTimer = null;
  molvaNote = { kind: '', text: '' };
  for (const node of molvaStatuses) {
    if (node.isConnected) setStatus(node, '', '');
    else molvaStatuses.delete(node);
  }
}

/** Итог, что сейчас держится (для проверки в тестах). */
export function molvaNoteView() {
  return { ...molvaNote };
}

/** Взять строку итога под присмотр: она погаснет вместе с заметкой. */
export function trackMolvaStatus(node) {
  molvaStatuses.add(node);
}

/** Запомнить итог выпуска на `MOLVA_NOTE_MS`. */
export function keepMolvaNote(note) {
  molvaNote = note;
  if (molvaTimer) clearTimeout(molvaTimer);
  molvaTimer = setTimeout(clearMolvaNote, MOLVA_NOTE_MS);
}

/**
 * Кнопка «Обновить молву» со строкой итога под ней. Есть всегда — и на вкладке
 * ленты, и в настройках: автомат у кого-то выключен, а у кого-то редкий.
 * Итог живёт в модуле, потому что после выпуска панель перерисовывается.
 */
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
          text: fill(X.molvaDone, { posts: res.posts || 0, replies: res.replies || 0 }) + (res.skipped ? X.molvaDoneSkipped : ''),
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

/** Блок «Статисты и сюжетики» целиком — секцией, если нужен отдельно. */
export function renderCastBlock(host, preset) {
  const parts = renderCastParts(host, preset);
  return parts ? section(extraLabels(preset).mobSection, parts) : null;
}

/**
 * Статисты и сюжетики — узлами, без секции: они входят в общий блок «Молва»
 * настроек (баг 30), под подзаголовком. Нет семестра — `null`.
 */
export function renderCastParts(host, preset) {
  const state = safe(() => host.getState(), null);
  if (!state || !state.started) return null;
  const X = extraLabels(preset);
  const view = castView(state, preset);
  const status = el('div', { class: 'academy-status' });

  const members = view.members.map((m) => {
    const inputs = CAST_FIELDS.map(([key, label]) => {
      const input = el('input', { type: 'text', class: 'text_pole academy-input', value: m[key] || '' });
      input.addEventListener('change', async () => {
        clearMolvaNote();
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

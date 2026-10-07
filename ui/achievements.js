// ui/achievements.js — вкладка «Достижения»: вехи (`milestonesView`, им же
// пользуется зачётка), каталог достижений и его отрисовка.

import {
  KINDS, isSecretKind, milestoneCatalog, milestoneHint, milestoneName, milestoneTitle, milestones,
} from '../core/milestones.mjs';
import { fill, stateHealth, formatDate, extraLabels, el } from './common.js';

/**
 * Вехи для блока «Вехи» в зачётке (9.4.2). Пересчёт по состоянию, как и в
 * ядре: ничего не хранится, отозванная свайпом веха исчезает из списка сама.
 * Дата — `formatDate(when)` или «—», если состояние её уже не помнит.
 */
export function milestonesView(state, preset) {
  const X = extraLabels(preset);
  let list = [];
  try {
    list = milestones(state, preset);
  } catch {
    // Вехи — украшение зачётки. Уронить из-за них всю вкладку нельзя.
    list = [];
  }
  return list.map((m) => ({
    id: m.id,
    kind: m.kind,
    name: milestoneName(m, state, preset),
    when: m.when || null,
    whenLine: m.when ? formatDate(m.when) : X.milestoneNoDate,
  }));
}

/**
 * Вкладка «Достижения»: три части.
 *
 * - **В этой истории** — вехи героини этого чата с датой (то, что раньше было
 *   блоком «Вехи» в зачётке);
 * - **Все достижения** — каталог всех видов: полученные отмечены, неполученные
 *   с подсказкой «как получить», тайные — «???», пока не случились;
 * - **Во всех историях** — счёт из настроек расширения (`core/milestones.recordTally`):
 *   в скольких чатах вид получен хоть раз.
 *
 * @param {Object} state
 * @param {Object} preset
 * @param {Object} [tally]  `settings.achievementTally`
 */
export function achievementsView(state, preset, tally = {}) {
  const X = extraLabels(preset);
  const health = stateHealth(state, preset);
  const earned = health.kind === 'ok' ? milestonesView(state, preset) : [];
  const catalog = milestoneCatalog(earned).map((c) => {
    const got = c.earned.length > 0;
    const hidden = c.secret && !got;
    return {
      kind: c.kind,
      secret: c.secret,
      got,
      count: c.earned.length,
      title: hidden ? X.achSecretName : milestoneTitle(c.kind, preset),
      hint: hidden ? X.achSecretHint : milestoneHint(c.kind, preset),
      // Дата полученного — второй строкой под названием, как в «В этой истории».
      whenLine: got ? (c.earned[0].whenLine || '') : '',
    };
  });
  const t = tally && typeof tally === 'object' ? tally : {};
  const global = KINDS
    .map((kind) => ({ kind, n: Array.isArray(t[kind] && t[kind].chats) ? t[kind].chats.length : 0 }))
    .filter((g) => g.n > 0)
    .sort((a, b) => b.n - a.n || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind))
    .map((g) => ({ ...g, title: milestoneTitle(g.kind, preset), line: fill(X.achGlobalLine, { n: g.n }) }));
  return {
    kind: 'ok',
    started: health.kind === 'ok',
    earned: earned.map((m) => ({ ...m, secret: isSecretKind(m.kind) })),
    countLine: fill(X.achEarnedCount, { got: catalog.filter((c) => c.got).length, total: catalog.length }),
    catalog,
    global,
  };
}

// --- вкладка «Достижения» ---------------------------------------------------

export function renderAchievements(host, view, preset) {
  const X = extraLabels(preset);
  const box = el('div', { class: 'academy-achievements' });

  box.append(el('div', { class: 'academy-milestones' }, [
    el('div', { class: 'academy-card-title', text: X.achEarnedTitle }),
    el('div', { class: 'academy-note', text: view.countLine }),
    view.earned.length
      ? el('ul', { class: 'academy-milestone-list' }, view.earned.map((m) => el('li', {
        class: m.secret ? 'academy-milestone academy-milestone-secret' : 'academy-milestone',
        dataset: { milestone: m.id },
      }, [
        // Столбиком: дата всегда второй строкой, а не то справа, то под
        // названием — смотря по его длине.
        el('span', { class: 'academy-ach-text' }, [
          el('span', { class: 'academy-milestone-name', text: m.name }),
          el('span', { class: 'academy-shift-day', text: m.whenLine }),
        ]),
      ])))
      : el('div', { class: 'academy-teacher', text: X.achEarnedNone }),
  ]));

  box.append(el('div', { class: 'academy-milestones academy-ach-catalog' }, [
    el('div', { class: 'academy-card-title', text: X.achCatalogTitle }),
    el('ul', { class: 'academy-milestone-list' }, view.catalog.map((c) => el('li', {
      class: ['academy-ach', c.got ? 'academy-ach-got' : 'academy-ach-locked', c.secret ? 'academy-ach-secret' : '']
        .filter(Boolean).join(' '),
      dataset: { kind: c.kind },
    }, [
      el('i', {
        class: `fa-solid ${c.got ? 'fa-trophy' : (c.secret ? 'fa-question' : 'fa-lock')} academy-ach-icon`,
        'aria-hidden': 'true',
      }),
      el('span', { class: 'academy-ach-text' }, [
        el('span', { class: 'academy-milestone-name', text: c.title }),
        c.whenLine ? el('span', { class: 'academy-shift-day', text: c.whenLine }) : null,
        el('span', { class: 'academy-ach-hint', text: c.hint }),
      ]),
      c.secret && c.got ? el('span', { class: 'academy-shift-day', text: X.achSecretMark }) : null,
    ]))),
  ]));

  box.append(el('div', { class: 'academy-milestones academy-ach-global' }, [
    el('div', { class: 'academy-card-title', text: X.achGlobalTitle }),
    view.global.length
      ? el('ul', { class: 'academy-milestone-list' }, view.global.map((g) => el('li', {
        class: 'academy-milestone', dataset: { kind: g.kind },
      }, [
        el('span', { class: 'academy-milestone-name', text: g.title }),
        el('span', { class: 'academy-shift-day', text: g.line }),
      ])))
      : el('div', { class: 'academy-teacher', text: X.achGlobalNone }),
    el('div', { class: 'academy-note', text: X.achGlobalNote }),
  ]));
  return box;
}

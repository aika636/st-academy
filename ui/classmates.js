// ui/classmates.js — часть «Курс» вкладки «Люди»: однокурсники героини
// (раздел «Сейчас», шаг 2). Что показать (`classmatesView`) и чем показать
// (`renderClassmates`): карточка человека, форма добавления, правка и
// удаление с подтверждением прямо в панели.
//
// Роль-зерно (`seed`) здесь не показывается: это подсказка генерации, а не
// характер (решение 3 от 06.10). Отношение — словом и числом, как у
// преподавателей: «косится · −1». Наружу, в промпт и лорбук, — только слово.

import { CLASSMATE_TEXT_MAX, HEROINE, tieTarget } from '../core/classmates.mjs';
import { MEMORY_SIZE, relationLabel, relationMemory, relationOf } from '../core/relations.mjs';
import { personAvatar } from '../core/masks.mjs';
import { isPortrait } from '../core/portraits.mjs';
import {
  uiLabels, extraLabels, fill, formatDate, str, el, runAction, setStatus, call, renderPanel, avatarNode, safe,
} from './common.js';
import { photoEditor, drawPending } from './photo.js';

/** «+2», «−3», «0» — число отношения со знаком; типографский минус, не дефис. */
export function scoreText(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0';
}

/**
 * Что показать в части «Курс». Без DOM — проверяется в Node.
 *
 * @param {Object} state  уже проверенное состояние (`peopleView` смотрит здоровье)
 * @param {Object} preset
 * @returns {{title: string, none: string, people: Array, tieOptions: Array, count: number}}
 */
export function classmatesView(state, preset) {
  const U = uiLabels(preset);
  const X = extraLabels(preset);
  const list = (state && Array.isArray(state.classmates)) ? state.classmates : [];

  const people = list.map((c) => {
    let tieText = '';
    let tieWho = '';
    if (c.tie) {
      const target = tieTarget(state, c.tie.to);
      tieWho = target.kind === 'heroine' ? X.cmHeroine
        : target.kind === 'unknown' ? X.cmTieUnknown
          : target.name;
      // На карточке «С кем связан: с героиней — делит парту»: после подписи
      // с двоеточием второе двоеточие читалось анкетой.
      const shown = target.kind === 'heroine' ? X.cmTieHeroine : tieWho;
      const what = str(c.tie.what);
      tieText = shown && what ? fill(X.cmTieLine, { who: shown, what }) : (shown || what);
    }
    const memory = relationMemory(state, c.id, preset, MEMORY_SIZE).map((m) => {
      const sign = scoreText(m.delta);
      return {
        day: m.day,
        dateLine: formatDate(m.day),
        delta: m.delta,
        sign,
        reason: m.reason,
        text: m.reason ? fill(X.memoryLine, { sign, reason: m.reason }) : sign,
        shift: m.crossed ? fill(U.relationShift, m.crossed) : '',
      };
    });
    const relation = relationLabel(state, c.id, preset);
    const score = scoreText(relationOf(state, c.id));
    return {
      id: c.id,
      name: c.name,
      club: c.club || '',
      desire: c.desire || '',
      problem: c.problem || '',
      tieTo: c.tie ? (c.tie.to || '') : '',
      tieWhat: c.tie ? (c.tie.what || '') : '',
      tieWho,
      tieText,
      relation,
      score,
      relationText: score ? `${relation} · ${score}` : relation,
      memory,
      memoryText: memory.length ? '' : U.relationNoHistory,
      source: c.source || 'manual',
      // Фото — как у преподавателя: только годный адрес; кружок без фото —
      // инициалы на цвете от id.
      portrait: isPortrait(c.portrait) ? c.portrait : '',
      looks: typeof c.looks === 'string' ? c.looks : '',
      avatar: personAvatar(c),
    };
  });

  // Выбор «с кем связан»: героиня, однокурсники, преподаватели. Себя карточка
  // из списка уберёт сама — у формы добавления «себя» ещё нет.
  const tieOptions = [
    { value: '', label: X.cmTieNone },
    { value: HEROINE, label: X.cmHeroine },
    ...list.map((c) => ({ value: c.id, label: c.name })),
    ...((state && state.teachers) || []).map((t) => ({ value: t.id, label: t.name || t.id })),
  ];

  return {
    title: U.classmatesTitle,
    none: U.classmatesNone,
    historyTitle: U.relationHistoryTitle,
    people,
    tieOptions,
    count: people.length,
  };
}

// --- отрисовка -----------------------------------------------------------------

/** Часть «Курс»: карточки и форма добавления под ними. */
export function renderClassmates(host, view, preset) {
  const X = extraLabels(preset);
  const box = el('div', { class: 'academy-classmates' });
  if (!view.people.length) box.append(el('div', { class: 'academy-silent', text: view.none }));
  // Похожие на персонажа бота (`core/card-cast.mjs`): попали сюда до того, как
  // расширение узнало его имя. Молча не удаляются — человек мог держать их нарочно.
  const hits = new Set(safe(() => (host.getCardCastHits ? host.getCardCastHits() : []), []) || []);
  const course = uiLabels(preset).classmatesTitle;
  for (const p of view.people) box.append(classmateCard(host, p, view, X, hits.has(p.id) ? course : ''));
  box.append(classmateForm(host, null, view, X));
  return box;
}

function castWarning(host, p, X, course) {
  const status = el('div', { class: 'academy-status' });
  return el('div', { class: 'academy-cast-hit' }, [
    el('span', { class: 'academy-note academy-note-warn', text: fill(X.castHit, { course }) }),
    el('div', {
      class: 'menu_button academy-btn academy-btn-small',
      text: X.castHitRemove,
      onclick: async (e) => {
        const res = await runAction(e.currentTarget, status, () => call(host, 'removeClassmate', p.id), X.cmRemoved);
        if (res && res.ok !== false) renderPanel(host);
      },
    }),
    status,
  ]);
}

function classmateCard(host, p, view, X, castCourse = '') {
  const line = (label, text) => (text
    ? el('div', { class: 'academy-cm-line' }, [
      el('span', { class: 'academy-cm-label', text: `${label}: ` }),
      el('span', { text }),
    ])
    : null);
  return el('div', { class: 'academy-cm-card' }, [
    el('div', { class: 'academy-cm-head' }, [
      avatarNode(p.avatar, { size: 'card' }),
      el('span', { class: 'academy-subject', text: p.name }),
      el('span', { class: 'academy-relation', text: p.relationText }),
      p.club ? el('span', { class: 'academy-post', text: p.club }) : null,
    ]),
    castCourse ? castWarning(host, p, X, castCourse) : null,
    line(X.cmDesire, p.desire),
    line(X.cmTie, p.tieText),
    line(X.cmProblem, p.problem),
    // «Запомнилось» — только когда есть что: у нового человека без истории
    // заголовок с «ещё не менялось» был пустым местом на карточке.
    p.memory.length ? el('div', { class: 'academy-cm-memory' }, [
      el('span', { class: 'academy-card-title', text: view.historyTitle }),
      el('ul', { class: 'academy-shifts' }, p.memory.map((m) => el('li', {}, [
        el('span', { class: 'academy-shift', text: m.text }),
        (m.shift || m.dateLine)
          ? el('span', { class: 'academy-shift-day', text: [m.shift, m.dateLine].filter(Boolean).join(' · ') })
          : null,
      ]))),
    ]) : null,
    classmateForm(host, p, view, X),
  ]);
}

/**
 * Форма однокурсника: пустая — добавить, с человеком — править и удалить.
 * Свёрнута в `<details>`: на телефоне шесть полей под каждой карточкой были
 * бы простынёй. Удаление спрашивает тут же, в панели (браузерный `confirm()`
 * в таверне не используется, см. `renderTransferBlock`).
 */
function classmateForm(host, p, view, X) {
  const status = el('div', { class: 'academy-status' });
  const input = (label, value, hint, max) => {
    const node = el('input', {
      type: 'text', class: 'text_pole academy-input', value: value || '', placeholder: hint || '',
      ...(max ? { maxlength: String(max) } : {}),
    });
    node.value = value || '';
    return { node, wrap: el('label', { class: 'academy-field' }, [el('span', { text: label }), node]) };
  };
  const name = input(X.cmName, p && p.name, X.cmNameHint, CLASSMATE_TEXT_MAX.name);
  const club = input(X.cmClub, p && p.club, X.cmClubHint, CLASSMATE_TEXT_MAX.club);
  const desire = input(X.cmDesire, p && p.desire, X.cmDesireHint, CLASSMATE_TEXT_MAX.desire);
  const problem = input(X.cmProblem, p && p.problem, X.cmProblemHint, CLASSMATE_TEXT_MAX.problem);
  const tieWhat = input(X.cmTieWhat, p && p.tieWhat, X.cmTieWhatHint, CLASSMATE_TEXT_MAX.tie);
  const tieTo = el('select', { class: 'text_pole academy-input' },
    view.tieOptions
      .filter((o) => !p || o.value !== p.id)
      .map((o) => el('option', { value: o.value, text: o.label })));
  tieTo.value = (p && p.tieTo) || '';
  const tieWrap = el('label', { class: 'academy-field' }, [el('span', { text: X.cmTie }), tieTo]);
  // Ссылка на фото — только у того, кто уже есть: файлу нужен id человека.
  const portrait = p ? input(X.portraitField, p.portrait, X.portraitHint, 0) : null;

  const fields = () => ({
    name: String(name.node.value || ''),
    club: String(club.node.value || ''),
    desire: String(desire.node.value || ''),
    problem: String(problem.node.value || ''),
    tie: { to: String(tieTo.value || ''), what: String(tieWhat.node.value || '') },
    ...(portrait ? { portrait: String(portrait.node.value || '').trim() } : {}),
  });

  const save = el('div', {
    class: 'menu_button academy-btn academy-btn-small',
    text: p ? X.cmSave : X.cmAdd,
    onclick: async (e) => {
      const f = fields();
      if (!f.name.trim()) { setStatus(status, 'error', X.cmNameMissing); return; }
      if (f.portrait && !isPortrait(f.portrait)) { setStatus(status, 'error', X.portraitBad); return; }
      const res = await runAction(e.currentTarget, status,
        () => (p ? call(host, 'updateClassmate', p.id, f) : call(host, 'addClassmate', f)),
        p ? X.cmSaved : X.cmAdded);
      if (res && res.ok !== false) renderPanel(host);
    },
  });

  const ask = el('div', { class: 'academy-confirm', hidden: true });
  ask.hidden = true;
  const remove = p ? el('div', {
    class: 'menu_button academy-btn academy-btn-small',
    text: X.cmRemove,
    onclick: () => {
      ask.hidden = false;
      // Вопрос стоит под кнопками, у нижнего края панели: без прокрутки он
      // оказывался за краем, и «Да, удалить» не было видно (живой прогон 10.10).
      if (typeof ask.scrollIntoView === 'function') ask.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
  }) : null;
  if (p) {
    ask.append(
      el('div', { class: 'academy-confirm-title', text: fill(X.cmRemoveAsk, { name: p.name }) }),
      el('div', { class: 'academy-row academy-row-buttons' }, [
        el('div', {
          class: 'menu_button academy-btn academy-btn-main',
          text: X.cmRemoveYes,
          onclick: async (e) => {
            const res = await runAction(e.currentTarget, status, () => call(host, 'removeClassmate', p.id), X.cmRemoved);
            ask.hidden = true;
            if (res && res.ok !== false) renderPanel(host);
          },
        }),
        el('div', {
          class: 'menu_button academy-btn academy-btn-small',
          text: X.cmRemoveNo,
          onclick: () => { ask.hidden = true; },
        }),
      ]),
    );
  }

  return el('details', { class: 'academy-repair academy-cm-form', open: Boolean(p) && drawPending(p.id) }, [
    el('summary', { text: p ? X.cmEdit : X.cmAddTitle }),
    el('div', { class: 'academy-repair-body' }, [
      name.wrap, club.wrap, desire.wrap, tieWrap, tieWhat.wrap, problem.wrap,
      p ? photoEditor(host, p, X, portrait.wrap) : null,
      el('div', { class: 'academy-row academy-row-buttons' }, [save, remove]),
      ask,
      status,
    ]),
  ]);
}

// mes-panel.js — плашка Академии под ответом модели.
//
// По образцу плашки Horae: одна строка-сводка под текстом сообщения, по нажатию
// раскрываются подробности, справа кнопка «разобрать» — секретарь
// (`core/analysis`) читает ответ отдельным запросом и записывает, что в нём
// случилось.
//
// Три правила раскладки — чтобы плашки соседей не наслаивались.
//
// 1. **Поток, а не слой.** Плашка — обычный блок в потоке `.mes_block`: ни
//    `position`, ни `z-index`. Чужая плашка не может оказаться под нашей или
//    поверх неё, только выше или ниже.
// 2. **Место — сразу после текста или после плашки Horae**, если она есть.
//    Horae вставляет свою прямо за `.mes_text` с задержкой, поэтому, придя
//    позже нас, она встанет между текстом и нашей — порядок тот же. Каждая
//    перерисовка проверяет место и переставляет плашку, если сосед вклинился.
// 3. **`order` больше, чем у Horae** (у неё 9999): если тема сделает
//    `.mes_block` флексом, порядок сохранится.
//
// Модуль не знает ни состояния, ни таверны: виды плашек отдаёт хост
// (`index.js`), он же выполняет действия.

/** Слова плашки — механизма, не заведения (как `DEBUG_TEXT` в ui.js). */
export const PANEL_TEXT = {
  analyze: 'Разобрать ответ',
  reanalyze: 'Разобрать заново',
  analyzing: 'Секретарь читает ответ…',
  undoAll: 'Вернуть метку рассказчика',
  drop: 'Вычеркнуть',
  nothing: 'без перемен',
  analyzed: 'разобрано',
  noMarker: 'метки рассказчика не было',
  byAnalysis: 'Записал секретарь',
  byAnalysisEmpty: 'Секретарь ничего не нашёл.',
  events: 'Что изменилось',
  onlyLast: 'Разбирать можно только последний ответ: более ранние уже легли в основу следующих.',
  more: 'ещё {n}',
};

const ATTENDANCE = { skip: 'прогул', late: 'опоздание', excused: 'уважительная' };

/**
 * Строка события (`ui.hookJournal`) словами. Отметка «был на паре» —
 * не событие для плашки: промотка ставит их пачками, и сводка утонула бы.
 * @returns {string} пустая — не показывать
 */
export function rowText(row) {
  if (!row || typeof row !== 'object') return '';
  switch (row.kind) {
    case 'grade': {
      const label = row.label && row.label !== row.value ? ` (${row.label})` : '';
      return `${row.subject}: ${row.value}${label}`;
    }
    case 'debt': return row.debt ? `хвост: ${row.subject}` : `хвост закрыт: ${row.subject}`;
    case 'attendance': return ATTENDANCE[row.status] ? `${ATTENDANCE[row.status]}: ${row.subject}` : '';
    case 'attendance-jump':
      return row.missed ? `промотка: пропущено пар — ${row.missed}` : '';
    case 'relation': {
      const how = row.changed ? `${row.from} → ${row.to}` : (row.direction === 'up' ? 'теплее' : row.direction === 'down' ? 'холоднее' : '');
      if (!how) return '';
      return `${row.teacher}: ${how}${row.reason ? ` — ${row.reason}` : ''}`;
    }
    case 'reputation':
      return row.from && row.to && row.from !== row.to ? `репутация: ${row.from} → ${row.to}` : '';
    case 'exam': {
      const label = row.label && row.label !== row.value ? ` (${row.label})` : '';
      return `${row.subject}: ${row.value}${label}${row.passed ? ' — сдано' : ' — не сдано'}`;
    }
    case 'exam-missed': return `не сдано к концу сессии: ${row.subject}`;
    case 'exam-conflict': return `${row.subject}: по сцене — ${row.said}`;
    case 'exams-scheduled': return `назначено контрольных: ${row.count}`;
    default: return '';
  }
}

/**
 * Сводка одной строкой: когда и что. «вторник, 3 сентября · 10:15 | химия: 5 ·
 * Петрова: теплее · ещё 2».
 */
export function summaryText(view) {
  const when = [view.date, view.time].filter(Boolean).join(' · ');
  const lines = (view.rows || []).filter(Boolean);
  const head = lines.slice(0, 2);
  const rest = lines.length - head.length;
  const what = lines.length
    ? `${head.join(' · ')}${rest > 0 ? ` · ${PANEL_TEXT.more.replace('{n}', rest)}` : ''}`
    : PANEL_TEXT.nothing;
  return when ? `${when} | ${what}` : what;
}

// --- DOM ------------------------------------------------------------------------

const PANEL_CLASS = 'academy-mes-panel';
const HORAE_CLASS = 'horae-message-panel';

/** Какие плашки раскрыты — по индексу сообщения, на время жизни страницы. */
const open = new Set();

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

function icon(name) {
  return el('i', { class: `fa-solid ${name}`, 'aria-hidden': 'true' });
}

/**
 * Перерисовать плашки всех ответов, что сейчас в DOM чата.
 *
 * @param {Object} host
 * @param {(mesId: number) => ?Object} host.panelFor вид плашки или `null` — плашки не нужно
 * @param {(mesId: number) => Promise} host.analyze
 * @param {(mesId: number, index: number) => Promise} host.dropToken
 * @param {(mesId: number) => Promise} host.clearAnalysis
 * @param {?Element} [root] где искать сообщения; по умолчанию `#chat`
 */
export function renderMessagePanels(host, root = null) {
  if (typeof document === 'undefined') return;
  const chat = root || document.getElementById('chat');
  if (!chat) return;
  for (const mes of chat.querySelectorAll('.mes[mesid]')) {
    const mesId = Number(mes.getAttribute('mesid'));
    if (!Number.isInteger(mesId)) continue;
    let view = null;
    try {
      view = host.panelFor(mesId);
    } catch (err) {
      console.warn('[academy] плашка не собрана:', err);
    }
    const old = mes.querySelector(`.${PANEL_CLASS}`);
    if (!view) {
      if (old) old.remove();
      continue;
    }
    const panel = buildPanel(host, mesId, view);
    if (old) old.replaceWith(panel);
    if (!place(mes, panel) && panel.isConnected) panel.remove();
  }
}

/** Убрать все плашки — расширение выключено или чат закрыт. */
export function clearMessagePanels(root = null) {
  if (typeof document === 'undefined') return;
  const chat = root || document.getElementById('chat');
  if (!chat) return;
  for (const p of chat.querySelectorAll(`.${PANEL_CLASS}`)) p.remove();
}

/** Сразу за текстом сообщения или за плашкой Horae (правило 2). */
function place(mes, panel) {
  const text = mes.querySelector('.mes_text');
  if (!text || !text.parentElement) return false;
  const parent = text.parentElement;
  const horae = [...parent.children].filter((c) => c.classList && c.classList.contains(HORAE_CLASS)).pop();
  const anchor = horae || text;
  if (panel.previousElementSibling !== anchor) anchor.after(panel);
  return true;
}

function buildPanel(host, mesId, view) {
  const isOpen = open.has(mesId);
  const content = el('div', { class: 'academy-mes-content' });
  if (!isOpen) content.hidden = true;

  const busy = Boolean(view.busy);
  const analyzeBtn = view.canAnalyze
    ? el('button', {
      type: 'button',
      class: 'academy-mes-action',
      title: view.analyzed ? PANEL_TEXT.reanalyze : PANEL_TEXT.analyze,
      'aria-label': view.analyzed ? PANEL_TEXT.reanalyze : PANEL_TEXT.analyze,
      disabled: busy,
      onclick: (e) => {
        e.stopPropagation();
        run(host.analyze(mesId));
      },
    }, [icon(busy ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles')])
    : null;

  const badges = [
    view.analyzed ? el('span', { class: 'academy-mes-badge', text: PANEL_TEXT.analyzed }) : null,
  ];

  const toggle = el('div', {
    class: 'academy-mes-toggle',
    role: 'button',
    tabindex: '0',
    'aria-expanded': isOpen ? 'true' : 'false',
    onclick: () => {
      if (open.has(mesId)) open.delete(mesId);
      else open.add(mesId);
      content.hidden = !open.has(mesId);
      toggle.setAttribute('aria-expanded', open.has(mesId) ? 'true' : 'false');
    },
  }, [
    el('span', { class: 'academy-mes-icon' }, [icon('fa-graduation-cap')]),
    el('span', { class: 'academy-mes-summary', text: busy ? PANEL_TEXT.analyzing : summaryText(view) }),
    ...badges,
    analyzeBtn,
  ]);

  // --- подробности ---
  const rows = (view.rows || []).filter(Boolean);
  content.append(
    el('div', { class: 'academy-mes-title', text: PANEL_TEXT.events }),
    rows.length
      ? el('ul', { class: 'academy-mes-list' }, rows.map((r) => el('li', { text: r })))
      : el('div', { class: 'academy-mes-note', text: PANEL_TEXT.nothing }),
  );

  if (view.analyzed) {
    const tokens = view.tokens || [];
    content.append(el('div', { class: 'academy-mes-title', text: PANEL_TEXT.byAnalysis }));
    content.append(tokens.length
      ? el('ul', { class: 'academy-mes-list academy-mes-tokens' }, tokens.map((t, i) => el('li', {}, [
        el('span', { text: t }),
        view.canAnalyze
          ? el('button', {
            type: 'button',
            class: 'academy-mes-drop',
            title: PANEL_TEXT.drop,
            'aria-label': PANEL_TEXT.drop,
            disabled: busy,
            onclick: () => run(host.dropToken(mesId, i)),
          }, [icon('fa-xmark')])
          : null,
      ])))
      : el('div', { class: 'academy-mes-note', text: PANEL_TEXT.byAnalysisEmpty }));
  } else if (view.marker === false) {
    content.append(el('div', { class: 'academy-mes-note', text: PANEL_TEXT.noMarker }));
  }

  if (view.error) content.append(el('div', { class: 'academy-mes-error', text: view.error }));

  if (view.canAnalyze) {
    content.append(el('div', { class: 'academy-mes-buttons' }, [
      el('button', {
        type: 'button',
        class: 'menu_button academy-mes-btn',
        disabled: busy,
        onclick: () => run(host.analyze(mesId)),
      }, [icon('fa-wand-magic-sparkles'), el('span', { text: view.analyzed ? PANEL_TEXT.reanalyze : PANEL_TEXT.analyze })]),
      view.analyzed
        ? el('button', {
          type: 'button',
          class: 'menu_button academy-mes-btn',
          disabled: busy,
          onclick: () => run(host.clearAnalysis(mesId)),
        }, [icon('fa-rotate-left'), el('span', { text: PANEL_TEXT.undoAll })])
        : null,
    ]));
  } else {
    content.append(el('div', { class: 'academy-mes-note', text: PANEL_TEXT.onlyLast }));
  }

  return el('div', { class: PANEL_CLASS, 'data-mesid': String(mesId) }, [toggle, content]);
}

/** Действие с кнопки: отказ хоста не должен ронять обработчик клика. */
function run(promise) {
  Promise.resolve(promise).catch((err) => console.warn('[academy] действие плашки не удалось:', err));
}

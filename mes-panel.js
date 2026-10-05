// mes-panel.js — плашка Академии под ответом модели.
//
// По образцу плашки Horae: одна строка-сводка под текстом каждого ответа, по
// нажатию раскрываются подробности, справа кнопка «разобрать» — секретарь
// (`core/analysis`) читает ответ отдельным запросом и записывает, что в нём
// случилось. Только по кнопке: разбор после каждого свайпа стоил бы запроса на
// каждый вариант.
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
// 3. **Поля по бокам** (style.css): стрелки свайпа таверны висят у краёв
//    последнего сообщения, и плашка во всю ширину залезала под них.
//
// Модуль не знает ни состояния, ни таверны: виды плашек отдаёт хост
// (`index.js`), он же выполняет действия.

/** Слова плашки — механизма, не заведения (как `DEBUG_TEXT` в ui.js). */
export const PANEL_TEXT = {
  analyze: 'Разобрать',
  reanalyze: 'Разобрать заново',
  analyzing: 'Секретарь читает ответ…',
  undoAll: 'Отменить разбор',
  undoAllHint: 'Снять всё, что записал секретарь. У последнего ответа снова будет действовать скрытая метка, которую рассказчик сам ставит в начале ответа (если она там есть).',
  drop: 'Вычеркнуть',
  nothing: 'без перемен',
  notAnalyzed: 'не разобрано',
  analyzed: 'разобрано',
  correction: 'поправка',
  summary: 'Кратко',
  lookingFor: 'Что ищет секретарь',
  lookingForHint: 'Секретарь читает этот ответ и реплику перед ним и записывает только то, что случилось с героиней. Время не трогает.',
  events: 'Изменилось в Академии',
  empty: '—',
  correctionNote: 'Это не последний ответ: выводы лягут поправкой — датой этого ответа, поверх нынешнего состояния.',
  liveNote: 'Последний ответ: выводы лягут пересчётом, как будто рассказчик сам их отметил.',
  notCounted: 'ответ ещё не посчитан',
  uncounted: 'Академия этот ответ ещё не считала. Разбор сначала посчитает его, потом позовёт секретаря.',
  onlyLast: 'Этот ответ сейчас не разобрать.',
  more: 'ещё {n}',
};

/** Что ищет секретарь — разделы плашки, по виду вывода (`tokenEvent().kind`). */
export const SECTIONS = [
  { kind: 'grade', icon: 'fa-star', label: 'Оценки, зачёты, экзамены', tone: 'gold' },
  { kind: 'attendance', icon: 'fa-person-walking', label: 'Прогулы и опоздания', tone: 'red' },
  { kind: 'rel', icon: 'fa-heart', label: 'Отношение преподавателей', tone: 'pink' },
];

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
 * Петрова: теплее · ещё 2». Ответ, о котором Академия ничего не знает, — «не
 * разобрано».
 */
export function summaryText(view) {
  if (view.uncounted) return PANEL_TEXT.notCounted;
  const when = [view.date, view.time].filter(Boolean).join(' · ');
  const lines = [...(view.rows || []), ...(view.analyzed && view.correction ? (view.tokens || []).map((t) => t.text || t) : [])]
    .filter(Boolean);
  const head = lines.slice(0, 2);
  const rest = lines.length - head.length;
  if (!when && !lines.length) return view.analyzed ? PANEL_TEXT.nothing : PANEL_TEXT.notAnalyzed;
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
  const busy = Boolean(view.busy);
  const content = el('div', { class: 'academy-mes-content' });
  if (!isOpen) content.hidden = true;

  const analyze = (e) => {
    if (e) e.stopPropagation();
    run(host.analyze(mesId));
  };

  const state = view.analyzed
    ? el('span', { class: `academy-mes-badge${view.correction ? ' academy-mes-badge-late' : ''}`, title: view.correction ? PANEL_TEXT.correction : PANEL_TEXT.analyzed }, [
      icon(view.correction ? 'fa-pen-to-square' : 'fa-check'),
    ])
    : null;

  const toggle = el('div', {
    class: 'academy-mes-toggle',
    role: 'button',
    tabindex: '0',
    'aria-expanded': isOpen ? 'true' : 'false',
    onclick: () => {
      if (open.has(mesId)) open.delete(mesId);
      else open.add(mesId);
      content.hidden = !open.has(mesId);
      panelNode.classList.toggle('academy-mes-open', open.has(mesId));
      toggle.setAttribute('aria-expanded', open.has(mesId) ? 'true' : 'false');
    },
  }, [
    el('span', { class: 'academy-mes-icon' }, [icon('fa-graduation-cap')]),
    el('span', { class: 'academy-mes-summary', text: busy ? PANEL_TEXT.analyzing : summaryText(view) }),
    state,
    el('button', {
      type: 'button',
      class: 'academy-mes-action',
      title: view.analyzed ? PANEL_TEXT.reanalyze : PANEL_TEXT.analyze,
      'aria-label': view.analyzed ? PANEL_TEXT.reanalyze : PANEL_TEXT.analyze,
      disabled: busy,
      onclick: analyze,
    }, [icon(busy ? 'fa-spinner fa-spin' : 'fa-wand-magic-sparkles')]),
  ]);

  // --- подробности ---
  if (view.summary) {
    content.append(el('div', { class: 'academy-mes-quote' }, [
      icon('fa-feather-pointed'),
      el('span', { text: view.summary }),
    ]));
  }

  content.append(el('div', { class: 'academy-mes-title' }, [icon('fa-magnifying-glass'), el('span', { text: PANEL_TEXT.lookingFor })]));
  if (!view.analyzed) content.append(el('div', { class: 'academy-mes-note', text: PANEL_TEXT.lookingForHint }));

  const tokens = (view.tokens || []).map((t, index) => ({ ...(typeof t === 'string' ? { text: t, kind: 'other' } : t), index }));
  for (const s of SECTIONS) {
    const mine = tokens.filter((t) => t.kind === s.kind);
    content.append(el('div', { class: `academy-mes-section academy-tone-${s.tone}` }, [
      el('div', { class: 'academy-mes-section-head' }, [icon(s.icon), el('span', { text: s.label })]),
      mine.length
        ? el('ul', { class: 'academy-mes-tokens' }, mine.map((t) => el('li', {}, [
          el('span', { text: t.text }),
          el('button', {
            type: 'button',
            class: 'academy-mes-drop',
            title: PANEL_TEXT.drop,
            'aria-label': PANEL_TEXT.drop,
            disabled: busy,
            onclick: () => run(host.dropToken(mesId, t.index)),
          }, [icon('fa-xmark')]),
        ])))
        : el('div', { class: 'academy-mes-none', text: view.analyzed ? PANEL_TEXT.empty : '' }),
    ]));
  }

  const rows = (view.rows || []).filter(Boolean);
  if (rows.length) {
    content.append(
      el('div', { class: 'academy-mes-title' }, [icon('fa-scroll'), el('span', { text: PANEL_TEXT.events })]),
      el('ul', { class: 'academy-mes-list' }, rows.map((r) => el('li', { text: r }))),
    );
  }

  if (view.uncounted) content.append(el('div', { class: 'academy-mes-note', text: PANEL_TEXT.uncounted }));
  else content.append(el('div', { class: 'academy-mes-note', text: view.live ? PANEL_TEXT.liveNote : PANEL_TEXT.correctionNote }));

  if (view.error) content.append(el('div', { class: 'academy-mes-error', text: view.error }));

  content.append(el('div', { class: 'academy-mes-buttons' }, [
    el('button', {
      type: 'button',
      class: 'menu_button academy-mes-btn academy-mes-btn-main',
      disabled: busy,
      onclick: analyze,
    }, [icon('fa-wand-magic-sparkles'), el('span', { text: view.analyzed ? PANEL_TEXT.reanalyze : PANEL_TEXT.analyze })]),
    view.analyzed
      ? el('button', {
        type: 'button',
        class: 'menu_button academy-mes-btn',
        title: PANEL_TEXT.undoAllHint,
        disabled: busy,
        onclick: () => run(host.clearAnalysis(mesId)),
      }, [icon('fa-rotate-left'), el('span', { text: PANEL_TEXT.undoAll })])
      : null,
  ]));
  if (view.analyzed) content.append(el('div', { class: 'academy-mes-note academy-mes-small', text: PANEL_TEXT.undoAllHint }));

  const panelNode = el('div', {
    class: `${PANEL_CLASS}${isOpen ? ' academy-mes-open' : ''}${view.analyzed ? ' academy-mes-done' : ''}`,
    'data-mesid': String(mesId),
  }, [toggle, content]);
  return panelNode;
}

/** Действие с кнопки: отказ хоста не должен ронять обработчик клика. */
function run(promise) {
  Promise.resolve(promise).catch((err) => console.warn('[academy] действие плашки не удалось:', err));
}

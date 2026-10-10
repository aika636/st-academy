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
  undoAll: 'Отменить сохранение',
  undoAllHint: 'Вернуть предыдущий сохранённый разбор этого ответа. Если его не было — снять выводы секретаря.',
  draft: 'Черновик — ещё не сохранён',
  save: 'Сохранить',
  discard: 'Не сохранять',
  drop: 'Вычеркнуть',
  nothing: 'без перемен',
  // Время прыгнуло, и ядро ждёт слова человека: «без перемен» тут было бы неправдой.
  jumpHeld: 'время прыгнуло — принять или оставить как было? Кнопки на «Сегодня»',
  notAnalyzed: 'не разобрано',
  analyzed: 'разобрано',
  correction: 'поправка',
  summary: 'Кратко',
  lookingFor: 'Что ищет секретарь',
  lookingForHint: 'Секретарь читает этот ответ и реплику перед ним и записывает то, что случилось с героиней и людьми вокруг неё, а праздники и события на две недели вперёд — в планы. Время не трогает.',
  events: 'Изменилось в Академии',
  empty: '—',
  correctionNote: 'Это не последний ответ: выводы запишутся поправкой задним числом, поверх нынешнего состояния.',
  liveNote: 'Это последний ответ: после сохранения выводы сразу попадут в текущее состояние.',
  notCounted: 'ответ ещё не посчитан',
  uncounted: 'Академия этот ответ ещё не считала. Разбор подготовит черновик; изменения применятся после сохранения.',
  onlyLast: 'Этот ответ сейчас не разобрать.',
  more: 'ещё {n}',
  talk: 'Что говорят',
  // `{crowdIn}` и `{tab}` — слова пресета: «в классе», «Молва».
  talkHint: 'Что говорят {crowdIn} о том, что было. Ничего не меняет — появится во вкладке «{tab}». Вычеркнутый факт уносит свои реакции, вычеркнутый пост — свои ответы.',
  // После «Сохранить» — уже не «появится»: записи легли (третий прогон 08.10).
  talkHintSaved: 'Что говорят {crowdIn} о том, что было. Ничего не меняет — уже во вкладке «{tab}». Вычеркнутый факт уносит свои реакции, вычеркнутый пост — свои ответы.',
  // Ответ под постом ленты, которого в этом разборе нет.
  inThread: 'ответ на «{post}»',
  nickHint: 'ник-маска: это не человек из списка',
  talkNone: 'никто не обсуждает',
  toCourse: 'Добавить',
  toCourseHint: 'Добавить этого человека в раздел «{course}» вкладки «Люди».',
  // «О чём» пост — фразой факта, без «по поводу» (`analysis.tokenAbout`).
  onFact: '{fact}',
  // Сырой id секретаря («petrov-igor») — человеческой формой («Petrov Igor»).
  unparsed: 'Не разобрано: кто-то по имени {names} — такого человека нет в списках. Добавьте человека или поправьте имя и разберите заново.',
  partial: 'Ответ секретаря оборвался: прочитано только то, что дошло целым. Проверьте список и, если нужно, разберите заново.',
  unparsedMany: 'Не разобрано: {names} — таких людей нет в списках. Добавьте их или поправьте имена и разберите заново.',
};

/** Слова заведения по умолчанию — если хост их не передал (`view.labels`). */
const LABELS = { course: 'Курс', rel: 'Отношение преподавателей', feedTab: 'Поток', crowdIn: 'на курсе' };

const fillText = (t, vars) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

/**
 * Что ищет секретарь — разделы плашки, по виду вывода (`tokenEvent().kind`).
 * `label` с `{…}` — слово заведения из `view.labels`: у школы «Отношение
 * учителей» и «Класс: кто был…», у кадетов — «Взвод: …».
 */
export const SECTIONS = [
  { kind: 'grade', icon: 'fa-star', label: 'Оценки, зачёты, экзамены', tone: 'gold' },
  { kind: 'attendance', icon: 'fa-person-walking', label: 'Прогулы и опоздания', tone: 'red' },
  { kind: 'rel', icon: 'fa-heart', label: '{rel}', tone: 'pink' },
  { kind: 'event', icon: 'fa-calendar-day', label: 'В планы: праздники и события', tone: 'blue' },
  { kind: 'course', icon: 'fa-user-group', label: '{course}: кто был, стычки, слухи, дела', tone: 'green' },
];

/** Подпись раздела словами заведения. */
export function sectionLabel(section, labels = {}) {
  return fillText(section.label, { ...LABELS, ...labels });
}

const ATTENDANCE = { skip: 'прогул', late: 'опоздание', excused: 'уважительный пропуск', worked: 'прогул отработан' };

/**
 * Слова строк по умолчанию — если хост их не передал. У каждого заведения свои
 * («хвост» вуза, «долг» школы, «прореха» магов): слова приходят из `ui` пресета
 * (`index.js: rowWords`), здесь только запасной вариант.
 */
const ROW_WORDS = {
  rowDebt: 'Долг по предмету: {subject}',
  rowDebtClosed: 'Долг закрыт: {subject}',
  rowJump: 'Пропущено занятий: {count}',
  rowExamMissed: 'Не сдано к концу сессии: {subject}',
  rowReputation: 'Репутация: {from} → {to}',
};

/**
 * Строка события (`ui.hookJournal`) словами. Отметка «был на паре» —
 * не событие для плашки: промотка ставит их пачками, и сводка утонула бы.
 * @param {Object} row
 * @param {Object} [words] слова заведения (`ROW_WORDS`)
 * @returns {string} пустая — не показывать
 */
export function rowText(row, words = {}) {
  if (!row || typeof row !== 'object') return '';
  const W = { ...ROW_WORDS, ...words };
  switch (row.kind) {
    case 'grade': {
      const label = row.label && row.label !== row.value ? ` (${row.label})` : '';
      return `${row.subject}: ${row.value}${label}`;
    }
    case 'debt': return fillText(row.debt ? W.rowDebt : W.rowDebtClosed, { subject: row.subject });
    case 'attendance': return ATTENDANCE[row.status] ? `${ATTENDANCE[row.status]}: ${row.subject}` : '';
    case 'attendance-jump':
      return row.missed ? fillText(W.rowJump, { count: row.missed }) : '';
    case 'relation': {
      const how = row.changed ? `${row.from} → ${row.to}` : (row.direction === 'up' ? 'теплее' : row.direction === 'down' ? 'холоднее' : '');
      if (!how) return '';
      return `${row.teacher}: ${how}${row.reason ? ` — ${row.reason}` : ''}`;
    }
    case 'reputation':
      return row.from && row.to && row.from !== row.to ? fillText(W.rowReputation, { from: row.from, to: row.to }) : '';
    case 'exam': {
      const label = row.label && row.label !== row.value ? ` (${row.label})` : '';
      return `${row.subject}: ${row.value}${label}${row.passed ? ' — сдано' : ' — не сдано'}`;
    }
    case 'exam-missed': return fillText(W.rowExamMissed, { subject: row.subject });
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
  if (view.draft) return PANEL_TEXT.draft;
  if (view.uncounted) return PANEL_TEXT.notCounted;
  const when = [view.date, view.time].filter(Boolean).join(' · ');
  const lines = [...(view.rows || []), ...(view.analyzed && view.correction ? (view.tokens || []).map((t) => t.brief || t.text || t) : [])]
    .filter(Boolean);
  const head = lines.slice(0, 2);
  const rest = lines.length - head.length;
  // Прыжок времени ждёт решения: «без перемен» об этом ответе молчало бы о главном.
  const quiet = view.heldJump ? PANEL_TEXT.jumpHeld : PANEL_TEXT.nothing;
  if (!when && !lines.length) return view.analyzed ? quiet : PANEL_TEXT.notAnalyzed;
  const what = lines.length
    ? `${head.join(' · ')}${rest > 0 ? ` · ${PANEL_TEXT.more.replace('{n}', rest)}` : ''}`
    : quiet;
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
 * Маленький кружок автора рядом с именем в «Что говорят» — описание даёт хост
 * (`masks.authorAvatar`): маска — значок, человек — фото или инициалы. Те же
 * классы, что во вкладке «Поток», размер — `mes`.
 */
export function miniAvatar(av) {
  if (!av) return null;
  if (av.kind !== 'person') {
    return el('span', { class: 'academy-ava academy-ava-mes academy-ava-mask', 'aria-hidden': 'true', text: av.icon || '👤' });
  }
  const node = el('span', {
    class: 'academy-ava academy-ava-mes academy-ava-person',
    style: `background-color: ${av.color}`,
    'aria-hidden': 'true',
  }, [el('span', { class: 'academy-ava-initials', text: av.initials || '?' })]);
  if (av.portrait) {
    const img = el('img', { class: 'academy-ava-img', src: av.portrait, alt: '', loading: 'lazy' });
    img.addEventListener('error', () => { img.hidden = true; });
    node.append(img);
  }
  return node;
}

/**
 * Перерисовать плашки всех ответов, что сейчас в DOM чата.
 *
 * @param {Object} host
 * @param {(mesId: number) => ?Object} host.panelFor вид плашки или `null` — плашки не нужно
 * @param {(mesId: number) => Promise} host.analyze
 * @param {(mesId: number, index: number) => Promise} host.dropToken вычеркнуть строку (факт — с его реакциями)
 * @param {(mesId: number, candidateId: string) => Promise} [host.confirmCandidate] новое имя — в курс
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
  // Черновик и ошибка разбора раскрывают плашку сами и держат её раскрытой:
  // иначе после неудачи человек не видит, что случилось, пока не нажмёт.
  const isOpen = open.has(mesId) || Boolean(view.draft) || Boolean(view.error);
  if (view.draft || view.error) open.add(mesId);
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
    // Шеврон: строка раскрывается нажатием, и «ещё 7» без него читалось тупиком.
    el('span', { class: 'academy-mes-chevron', 'aria-hidden': 'true' }, [icon('fa-chevron-down')]),
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
  // «Черновик — ещё не сохранён» уже сказан в строке-сводке над подробностями:
  // второй раз подряд он читался как сбой.
  if (view.summary) {
    content.append(el('div', { class: 'academy-mes-quote' }, [
      icon('fa-feather-pointed'),
      el('span', { text: view.summary }),
    ]));
  }

  const labels = { ...LABELS, ...(view.labels || {}) };
  // «Что ищет секретарь» с пояснением — только до первого разбора: у готового
  // черновика и сохранённого разбора разделы говорят сами за себя.
  if (!view.analyzed && !view.draft) {
    content.append(el('div', { class: 'academy-mes-title' }, [icon('fa-magnifying-glass'), el('span', { text: PANEL_TEXT.lookingFor })]));
    content.append(el('div', { class: 'academy-mes-note', text: PANEL_TEXT.lookingForHint }));
  }

  const tokens = (view.tokens || []).map((t, index) => ({ ...(typeof t === 'string' ? { text: t, kind: 'other' } : t), index }));
  // Строка плашки (третий прогон 08.10): кружок, автор и текст — одним
  // переносимым блоком, под ним мелким серым «о чём»; кнопки — своей колонкой
  // справа, ✕ всегда в правом верхнем углу строки. Ничего не вылезает: длинное
  // слово и ник в 32 знака переносятся внутри блока (style.css).
  const textNode = (t) => {
    const p = t.parts;
    if (!p) return el('span', { class: 'academy-mes-text', text: t.text });
    const who = el('span', {
      class: `academy-mes-who${p.style === 'person' ? '' : ' academy-mes-who-mask'}`,
      text: p.who,
      ...(p.style === 'mask' ? { title: PANEL_TEXT.nickHint } : {}),
    });
    return el('span', { class: 'academy-mes-text' }, [who, `: «${p.say}»`]);
  };
  const tokenRow = (t) => el('li', t.nick ? { class: 'academy-mes-nick', title: PANEL_TEXT.nickHint } : {}, [
    el('div', { class: 'academy-mes-line' }, [
      t.avatar ? miniAvatar(t.avatar) : null,
      el('div', { class: 'academy-mes-body' }, [
        textNode(t),
        t.about ? el('div', { class: 'academy-mes-about academy-mes-on', text: fillText(PANEL_TEXT.onFact, { fact: t.about }) }) : null,
      ]),
      el('div', { class: 'academy-mes-acts' }, [
        t.candidate && host.confirmCandidate ? el('button', {
          type: 'button',
          class: 'menu_button academy-mes-btn academy-mes-confirm',
          title: fillText(PANEL_TEXT.toCourseHint, labels),
          disabled: busy,
          onclick: () => run(host.confirmCandidate(mesId, t.candidate)),
        }, [icon('fa-user-plus'), el('span', { text: PANEL_TEXT.toCourse })]) : null,
        el('button', {
          type: 'button',
          class: 'academy-mes-drop',
          title: PANEL_TEXT.drop,
          'aria-label': PANEL_TEXT.drop,
          disabled: busy,
          onclick: () => run(host.dropToken(mesId, t.index)),
        }, [icon('fa-xmark')]),
      ]),
    ]),
  ]);
  for (const s of SECTIONS) {
    const mine = tokens.filter((t) => t.kind === s.kind);
    content.append(el('div', { class: `academy-mes-section academy-tone-${s.tone}` }, [
      el('div', { class: 'academy-mes-section-head' }, [icon(s.icon), el('span', { text: sectionLabel(s, labels) })]),
      mine.length
        ? el('ul', { class: 'academy-mes-tokens' }, mine.map(tokenRow))
        : el('div', { class: 'academy-mes-none', text: view.analyzed ? PANEL_TEXT.empty : '' }),
    ]));
  }

  // «Что сочинено» — отдельно и под фактами: реакции ничего не меняют, а
  // держатся каждая за свой факт. Громкость — подписью к разделу.
  const loud = tokens.find((t) => t.kind === 'loud');
  // Ответы — под своим постом, с отступом; ответы к постам ленты (старая
  // ветка) — после, с подписью, к чему (`talkGroups`).
  const { posts: talk, elsewhere, replies } = talkGroups(tokens);
  const postRow = (t) => {
    const row = tokenRow(t);
    if (t.replies.length) {
      row.className = `${row.className ? `${row.className} ` : ''}academy-mes-has-thread`;
      row.append(el('ul', { class: 'academy-mes-tokens academy-mes-thread' }, t.replies.map(tokenRow)));
    }
    return row;
  };
  if (talk.length || replies.length || view.analyzed || view.draft) {
    content.append(el('div', { class: 'academy-mes-section academy-mes-talk academy-tone-violet' }, [
      el('div', { class: 'academy-mes-section-head' }, [
        icon('fa-comments'), el('span', { text: PANEL_TEXT.talk }),
        loud ? el('span', { class: 'academy-mes-about', text: loud.text }) : null,
      ]),
      talk.length || elsewhere.length
        ? el('ul', { class: 'academy-mes-tokens' }, [...talk.map(postRow), ...elsewhere.map(tokenRow)])
        : el('div', { class: 'academy-mes-none', text: PANEL_TEXT.talkNone }),
      talk.length || elsewhere.length ? el('div', {
        class: 'academy-mes-note academy-mes-small',
        text: fillText(view.analyzed && !view.draft ? PANEL_TEXT.talkHintSaved : PANEL_TEXT.talkHint, { crowdIn: labels.crowdIn, tab: labels.feedTab }),
      }) : null,
    ]));
  }

  // Кого секретарь назвал, а найти не удалось даже мягко, — не тишина в
  // консоли, а строка: человек может добавить его и разобрать заново.
  if (view.partial) content.append(el('div', { class: 'academy-mes-note academy-mes-unparsed', text: PANEL_TEXT.partial }));
  const unparsed = (view.unparsed || []).filter(Boolean);
  if (unparsed.length) {
    content.append(el('div', { class: 'academy-mes-note academy-mes-unparsed', text: unparsedText(unparsed) }));
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
    view.draft ? el('button', {
      type: 'button', class: 'menu_button academy-mes-btn academy-mes-btn-main', disabled: busy,
      onclick: () => run(host.saveAnalysis(mesId)),
    }, [icon('fa-floppy-disk'), el('span', { text: PANEL_TEXT.save })]) : null,
    view.draft ? el('button', {
      type: 'button', class: 'menu_button academy-mes-btn', disabled: busy,
      onclick: () => run(host.discardAnalysis(mesId)),
    }, [icon('fa-xmark'), el('span', { text: PANEL_TEXT.discard })]) : null,
    el('button', {
      type: 'button',
      class: 'menu_button academy-mes-btn academy-mes-btn-main',
      disabled: busy,
      onclick: analyze,
    }, [icon('fa-wand-magic-sparkles'), el('span', { text: view.analyzed || view.draft ? PANEL_TEXT.reanalyze : PANEL_TEXT.analyze })]),
    view.analyzed && !view.draft
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

/**
 * «Что говорят» деревом: посты (реакции) с ответами под каждым и ответы к
 * постам ленты, которых в этом разборе нет, — отдельно, с подписью «в ветке
 * «…»». Строки — те же, что пришли (`index` — номер строки для вычёркивания).
 *
 * @param {Array<{kind: string, index: number, post?: number, onPost?: string}>} tokens
 * @returns {{posts: Object[], elsewhere: Object[], replies: Object[]}}
 */
export function talkGroups(tokens) {
  const list = Array.isArray(tokens) ? tokens : [];
  const replies = list.filter((t) => t && t.kind === 'reply');
  const reacts = list.filter((t) => t && t.kind === 'react');
  const posts = reacts.map((t) => ({ ...t, replies: replies.filter((a) => a.post === t.index) }));
  const elsewhere = replies.filter((a) => !reacts.some((t) => t.index === a.post)).map((a) => ({
    ...a, about: a.onPost ? fillText(PANEL_TEXT.inThread, { post: a.onPost }) : '',
  }));
  return { posts, elsewhere, replies };
}

/**
 * «Не разобрано: кто-то по имени «Petrov Igor» — такого человека нет в
 * списках…». Id латиницей через дефис или подчёркивание — словами с большой
 * буквы: «petrov-igor» → «Petrov Igor»; одинаковые после этого — один раз.
 */
export function unparsedText(names) {
  const list = [...new Set((names || []).filter(Boolean).map(humanName).filter(Boolean))];
  if (!list.length) return '';
  return fillText(list.length > 1 ? PANEL_TEXT.unparsedMany : PANEL_TEXT.unparsed, { names: list.map((n) => `«${n}»`).join(', ') });
}

/** Сырой id латиницей — человеческой формой; прочее — как есть. */
export function humanName(raw) {
  const s = String(raw || '').trim();
  if (!/^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/.test(s)) return s;
  return s.split(/[-_.]+/).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** Действие с кнопки: отказ хоста не должен ронять обработчик клика. */
function run(promise) {
  Promise.resolve(promise).catch((err) => console.warn('[academy] действие плашки не удалось:', err));
}

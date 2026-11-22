import { svgIcon } from './ui/common.js';
import { plural } from './core/plural.mjs';
import { relPhrase } from './core/scene.mjs';
import { TAVERN_ID } from './materials/index.mjs';

const DEFAULT_MAT = TAVERN_ID;

export const PANEL_TEXT = {
  analyze: 'Разобрать',
  reanalyze: 'Разобрать заново',
  analyzing: 'Секретарь читает ответ…',
  retrying: 'Не удалось прочитать разбор. Пробую ещё раз…',
  cancel: 'Отменить',
  cancelled: 'Разбор отменён.',
  cancelledTavern: 'Разбор отменён. Модель может дописать, ответ отбросится.',
  failCut: 'Ответ секретаря оборвался. Повторите разбор.',
  failRefused: 'Не удалось прочитать разбор. Попробуйте ещё раз.',
  failRefusedMany: 'Не удалось прочитать разбор за {n} {tries}.',
  slow: 'Разбор затянулся. Можно нажать «Отменить».',
  afterMolva: 'Слухи ещё пишутся. Разбор может ждать очереди.',
  saving: 'Сохраняю разбор…',
  savingBtn: 'Сохраняю…',
  sure: 'Нажмите ещё раз',
  waitGen: 'Секретарь начнёт, когда рассказчик допишет ответ.',
  waitStart: 'Секретарь скоро начнёт разбор.',
  waitLost: 'Авторазбор не завершён. Нажмите «Разобрать».',
  undoAll: 'Отменить разбор',
  undoReply: 'Откатить ход',
  helpTitle: 'Что делают кнопки',
  undoReplyHint: 'Нажмите дважды за 4 секунды, чтобы вернуть дату, время и изменения последнего хода. Текст ответа, ручные записи и настройки останутся. Кнопки для возврата хода нет.',
  undoAllHint: 'Нажмите дважды за 4 секунды. Черновик будет отброшен. Если разбор сохранён, его изменения будут отменены или вернётся предыдущий разбор. Дата и время останутся.',
  draft: 'Черновик — ещё не сохранён',
  save: 'Сохранить',
  discard: 'Отбросить черновик',
  drop: 'Вычеркнуть',
  nothing: 'без перемен',
  jumpHeld: 'скачок времени ждёт подтверждения',
  jumpAsk: 'Скачок времени {waiting}. Подтвердите или отклоните его здесь или во вкладке «{tab}».',
  notAnalyzed: 'не разобрано',
  analyzed: 'Разбор сохранён',
  correction: 'Поправка задним числом',
  lookingFor: 'Что ищет секретарь',
  lookingForHint: 'Секретарь читает этот ответ и вашу реплику перед ним, если она есть. Он ищет изменения, связанные с {heroIns} и окружающими, и события на ближайшие две недели. Дата и время от разбора не меняются.',
  events: 'Изменилось в Академии',
  correctionNote: 'При сохранении или правке разбора Академия пересчитает изменения по этому ходу задним числом.',
  liveNote: 'Это последний ход. Академия учитывает изменения из сохранённого разбора.',
  uncounted: 'Академия ещё не учла этот ответ как ход. Секретарь подготовит черновик, а изменения применятся после нажатия «Сохранить».',
  more: 'ещё {n}',
  talk: 'Что говорят',
  heard: 'Слышно {crowdIn}',
  saved: 'Сохранено',
  heardHint: 'Громкость показывает, насколько заметно событие. Посты для вкладки «{tab}» создаются отдельно.',
  talkHint: 'Реплики появятся во вкладке «{tab}» после сохранения. Если вычеркнуть факт, его реакции тоже исчезнут из черновика.',
  talkHintSaved: 'Реплики уже во вкладке «{tab}». Если вычеркнуть факт, Академия пересчитает разбор, а реакции на этот факт исчезнут из ленты.',
  inThread: 'ответ на пост «{post}»',
  nickHint: 'Анонимный ник без карточки человека.',
  toCourse: 'Добавить',
  toCourseHint: 'Добавить человека в раздел «{course}».',
  onFact: '{fact}',
  unparsed: 'Сведения о человеке с именем {names} пропущены. Добавьте человека в список или исправьте его имя либо прозвище в карточке, затем повторите разбор.',
  partial: 'Ответ секретаря оборвался. Проверьте, всё ли нужное есть в черновике, или повторите разбор.',
  unparsedMany: 'Сведения об этих людях пропущены: {names}. Добавьте их в список или исправьте имена либо прозвища в карточках, затем повторите разбор.',
};

const LABELS = { course: 'Однокурсники', rel: 'Отношения', feedTab: 'Поток', crowdIn: 'на курсе', pause: 'Перерывы в занятиях' };

const fillText = (t, vars) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

export const SECTIONS = [
  { kind: 'grade', icon: 'fa-star', label: 'Оценки, зачёты, экзамены', tone: 'gold' },
  { kind: 'attendance', icon: 'fa-person-walking', label: 'Посещаемость', tone: 'red' },
  { kind: 'rel', icon: 'fa-heart', label: '{rel}', tone: 'pink' },
  { kind: 'event', icon: 'fa-calendar-day', label: 'В планы: праздники и события', tone: 'blue' },
  { kind: 'pause', icon: 'fa-calendar-xmark', label: '{pause}', tone: 'blue' },
  { kind: 'course', icon: 'fa-user-group', label: '{course}', tone: 'green' },
];

export function sectionLabel(section, labels = {}) {
  return fillText(section.label, { ...LABELS, ...labels });
}

const ATTENDANCE = { skip: 'прогул', late: 'опоздание', excused: 'пропуск по уважительной причине', worked: 'прогул отработан' };

const ROW_WORDS = {
  rowDebt: 'Долг по предмету: {subject}',
  rowDebtClosed: 'Долг закрыт: {subject}',
  rowJump: 'Пропущено занятий: {count}',
  rowExamMissed: 'Экзамен не сдан к концу сессии: {subject}',
  rowExamsScheduled: 'Назначено экзаменов: {count}',
  rowReputation: 'Репутация: {from} → {to}',
  rowFame: 'Слава: {how}',
  rowStudy: 'Учёба за день: {list}',
  rowRelCapped: '{teacher}: {how} — изменение не засчитано, достигнут лимит темпа «{pace}»',
  rowRelCappedStep: '(темп «{pace}»: засчитан один шаг)',
};

export function rowText(row, words = {}) {
  if (!row || typeof row !== 'object') return '';
  const W = { ...ROW_WORDS, ...words };
  switch (row.kind) {
    case 'grade': {
      if (row.bg) return '';
      const label = row.label && row.label !== row.value ? ` (${row.label})` : '';
      return `${row.subject}: ${row.value}${label}`;
    }
    case 'study': return fillText(W.rowStudy, { list: row.list });
    case 'debt': return fillText(row.debt ? W.rowDebt : W.rowDebtClosed, { subject: row.subject });
    case 'attendance': return ATTENDANCE[row.status] ? `${ATTENDANCE[row.status]}: ${row.subject}` : '';
    case 'attendance-jump':
      return row.missed ? fillText(W.rowJump, { count: row.missed }) : '';
    case 'relation': {
      const up = row.direction === 'up';
      if (row.direction !== 'up' && row.direction !== 'down') return row.changed ? `${row.teacher}: ${row.from} → ${row.to}` : '';
      const now = row.changed && row.to ? ` (теперь ${row.to})` : '';
      const cap = row.capped ? ` ${fillText(W.rowRelCappedStep, { pace: row.capped })}` : '';
      const head = relPhrase(row.teacher, up);
      return `${head}${now}${row.reason ? `${head.includes(': ') ? ' —' : ':'} ${row.reason}` : ''}${cap}`;
    }
    case 'relation-capped':
      return fillText(W.rowRelCapped, { teacher: row.teacher, how: row.direction === 'down' ? 'холоднее' : 'теплее', pace: row.pace });
    case 'reputation':
      if (row.fame) return fillText(W.rowFame, { how: row.fame === 'down' ? 'ниже' : 'выше' }) + (row.why ? ` — ${row.why}` : '');
      return row.from && row.to && row.from !== row.to ? fillText(W.rowReputation, { from: row.from, to: row.to }) : '';
    case 'exam': {
      const label = row.label && row.label !== row.value ? ` (${row.label})` : '';
      return `${row.subject}: ${row.value}${label}${row.passed ? ' — сдано' : ' — не сдано'}`;
    }
    case 'exam-missed': return fillText(W.rowExamMissed, { subject: row.subject });
    case 'exam-conflict': return `${row.subject}: в сцене — ${row.said}. У Академии другой результат.`;
    case 'exams-scheduled': return fillText(W.rowExamsScheduled, { count: row.count });
    default: return '';
  }
}

export const CHANGE_WORDS = ['изменение', 'изменения', 'изменений'];

const TALK_KINDS = new Set(['loud', 'react', 'reply', 'other']);

export function changeCount(view) {
  return ((view && view.tokens) || []).filter((t) => t && (typeof t === 'string' || !TALK_KINDS.has(t.kind))).length;
}

export function draftLabel(view) {
  const n = changeCount(view);
  return n ? `${PANEL_TEXT.draft} · ${n} ${plural(n, ...CHANGE_WORDS)}` : PANEL_TEXT.draft;
}

export function briefLine(line) {
  let s = String(line);
  const at = s.indexOf(' — ');
  if (at > 0) {
    const tail = s.slice(at + 3);
    if (!/^(?:не )?сдано$/.test(tail) && !/: в сцене$/.test(s.slice(0, at))) s = s.slice(0, at);
  }
  if (s.length <= BRIEF_MAX) return s;
  const cut = s.slice(0, BRIEF_MAX - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > BRIEF_MAX * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

const BRIEF_MAX = 120;

const NEW_FACE = /^новое лицо: (.+)$/;

export function mergeNewFaces(lines) {
  const names = lines.map((l) => NEW_FACE.exec(String(l))).filter(Boolean).map((m) => m[1]);
  if (names.length < 2) return lines;
  let put = false;
  return lines.flatMap((l) => {
    if (!NEW_FACE.test(String(l))) return [l];
    if (put) return [];
    put = true;
    return [`новые лица: ${names.join(', ')}`];
  });
}

export function summaryParts(view) {
  if (view.draft) return { what: draftLabel(view), when: '' };
  if (view.uncounted) return { what: PANEL_TEXT.notAnalyzed, when: '' };
  const when = [view.date, view.time, view.waiting].filter(Boolean).join(' · ');
  const lines = [...(view.rows || []), ...(view.analyzed && view.correction ? (view.tokens || []).map((t) => t.brief || t.text || t) : [])]
    .filter(Boolean);
  if (!lines.length && view.analyzed && !view.draft) {
    const found = (view.tokens || []).filter((t) => t && ['course', 'event', 'pause'].includes(t.kind)).map((t) => t.brief || t.text).filter((s) => !/^в сцене:/.test(s));
    lines.push(...found, view.invite && view.invite.text, ...(view.decisions || []), ...(view.promises || []).map((p) => p && p.text));
    lines.splice(0, lines.length, ...lines.filter(Boolean));
  }
  lines.splice(0, lines.length, ...mergeNewFaces(lines));
  const head = lines.slice(0, 2).map(briefLine);
  const rest = lines.length - head.length;
  const quiet = view.heldJump && !view.waiting ? PANEL_TEXT.jumpHeld : PANEL_TEXT.nothing;
  const empty = view.analyzed ? quiet : PANEL_TEXT.notAnalyzed;
  if (!when && !lines.length) return { what: empty, when };
  const what = lines.length
    ? `${head.join(' · ')}${rest > 0 ? ` · ${PANEL_TEXT.more.replace('{n}', rest)}` : ''}`
    : empty;
  return { what, when };
}

export function summaryText(view) {
  const { what, when } = summaryParts(view);
  return when ? `${when} | ${what}` : what;
}

const PANEL_CLASS = 'dia-mpanel';

const open = new Set();
const saved = new Set();
const jumpErrors = new Map();

export function forgetPanelState() {
  open.clear();
  saved.clear();
  jumpErrors.clear();
  pendingSave.clear();
  lockUntil.clear();
  armed.clear();
}

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

const icon = (name, cls = '') => svgIcon(name, cls);

const SECTION_ICON = {
  grade: 'star', attendance: 'walk', rel: 'heart', event: 'cal', pause: 'pause', course: 'group',
};

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

export function renderMessagePanels(host, root = null) {
  if (typeof document === 'undefined') return;
  const chat = root || document.getElementById('chat');
  if (!chat) return;
  let look = null;
  try {
    look = host.lookFor ? host.lookFor() : null;
  } catch (err) {
    console.warn('[academy] оформление плашки не получено:', err);
  }
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
    const panel = buildPanel(host, mesId, view, look);
    if (old) old.replaceWith(panel);
    if (!place(mes, panel) && panel.isConnected) panel.remove();
  }
}

export function clearMessagePanels(root = null) {
  if (typeof document === 'undefined') return;
  const chat = root || document.getElementById('chat');
  if (!chat) return;
  for (const p of chat.querySelectorAll(`.${PANEL_CLASS}`)) p.remove();
}

function place(mes, panel) {
  const text = mes.querySelector('.mes_text');
  if (!text || !text.parentElement) return false;
  const parent = text.parentElement;
  if (panel.previousElementSibling !== text) text.after(panel);
  return true;
}

function buildPanel(host, mesId, view, look) {
  const isOpen = open.has(mesId) || Boolean(view.draft) || Boolean(view.error) || Boolean(view.invite) || Boolean(view.jumpAsk) || Boolean(view.promises && view.promises.length) || Boolean(view.decisions && view.decisions.length);
  if (view.draft || view.error) open.add(mesId);
  const pend = pendingSave.has(mesId);
  const busy = Boolean(view.busy) || pend;
  const locked = busy || Date.now() < (lockUntil.get(mesId) || 0);
  const content = el('div', { class: 'dia-mp-body' });
  if (!isOpen) content.hidden = true;
  const footer = el('div', { class: 'dia-mp-footer' });
  footer.hidden = !isOpen;

  const analyze = (e) => {
    if (e) e.stopPropagation();
    saved.delete(mesId);
    run(host.analyze(mesId));
  };

  const flip = () => {
    if (content.hidden) open.add(mesId);
    else open.delete(mesId);
    content.hidden = !open.has(mesId);
    footer.hidden = !open.has(mesId) || !footer.children.length;
    panelNode.classList.toggle('dia-open', open.has(mesId));
    toggle.setAttribute('aria-expanded', open.has(mesId) ? 'true' : 'false');
  };

  const stateKind = view.draft ? 'edit' : view.analyzed ? (view.correction ? 'pencil' : 'ok') : 'dash';
  const stateTitle = view.draft ? PANEL_TEXT.draft : view.analyzed ? (view.correction ? PANEL_TEXT.correction : PANEL_TEXT.analyzed) : PANEL_TEXT.notAnalyzed;
  const parts = summaryParts(view);
  const analyzedNow = view.analyzed || view.draft;

  const toggle = el('div', {
    class: 'dia-mp-top',
    role: 'button',
    tabindex: '0',
    'aria-expanded': isOpen ? 'true' : 'false',
    onclick: flip,
    onkeydown: (e) => {
      if (e.target !== toggle) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); }
    },
  }, [
    el('span', { class: 'dia-mp-st', title: stateTitle }, [icon(stateKind)]),
    el('span', { class: 'dia-mp-sum', title: [parts.what, parts.when].filter(Boolean).join(' · ') }, [
      busy ? (view.progress || (pend ? PANEL_TEXT.saving : PANEL_TEXT.analyzing)) : (view.error || view.cancelled || view.wait || parts.what),
    ]),
    el('span', { class: 'dia-mp-chev', 'aria-hidden': 'true' }, [icon('chev')]),
    busy && view.cancellable && host.cancelAnalysis ? el('button', {
      type: 'button',
      class: 'dia-mp-go dia-mp-cancel',
      title: PANEL_TEXT.cancel,
      'aria-label': PANEL_TEXT.cancel,
      onclick: (e) => { e.stopPropagation(); run(host.cancelAnalysis(mesId)); },
    }, [icon('x'), el('span', { text: PANEL_TEXT.cancel })]) : el('button', {
      type: 'button',
      class: 'dia-mp-go',
      title: analyzedNow ? PANEL_TEXT.reanalyze : PANEL_TEXT.analyze,
      'aria-label': analyzedNow ? PANEL_TEXT.reanalyze : PANEL_TEXT.analyze,
      disabled: locked,
      onclick: analyze,
    }, [
      icon(busy ? 'dash' : 'wand', busy ? 'dia-spin' : ''),
      !analyzedNow && !busy ? el('span', { text: PANEL_TEXT.analyze }) : null,
    ]),
  ]);

  if (parts.when) content.append(el('div', { class: 'dia-mp-meta', text: parts.when }));
  if (view.summary) content.append(el('div', { class: 'dia-mp-quote', text: view.summary }));

  const labels = { ...LABELS, ...(view.labels || {}) };
  if (!view.analyzed && !view.draft) {
    content.append(el('div', { class: 'dia-mp-sec' }, [
      el('h4', {}, [icon('search'), el('span', { text: PANEL_TEXT.lookingFor })]),
      el('p', { class: 'dia-mp-note', text: PANEL_TEXT.lookingForHint.replace('{heroIns}', labels.heroIns || 'героем') }),
    ]));
  }

  const tokens = (view.tokens || []).map((t, index) => ({ ...(typeof t === 'string' ? { text: t, kind: 'other' } : t), index }));
  const textNode = (t) => {
    const p = t.parts;
    if (!p) return [t.text];
    const who = p.style === 'person'
      ? el('b', { text: p.who })
      : el('span', { class: 'dia-mp-nick', text: p.who, ...(p.style === 'mask' ? { title: PANEL_TEXT.nickHint } : {}) });
    return [who, `: «${p.say}»`];
  };
  const candidateButtons = (t) => (Array.isArray(t.targets) && t.targets.length
    ? t.targets.map((g) => el('button', {
      type: 'button',
      class: 'dia-mp-add',
      title: fillText(PANEL_TEXT.toCourseHint, { course: g.hint || labels.course }),
      disabled: busy,
      onclick: () => run(host.confirmCandidate(mesId, t.candidate, g.as)),
    }, [el('span', { text: g.label })]))
    : [el('button', {
      type: 'button',
      class: 'dia-mp-add',
      title: fillText(PANEL_TEXT.toCourseHint, labels),
      disabled: busy,
      onclick: () => run(host.confirmCandidate(mesId, t.candidate)),
    }, [el('span', { text: PANEL_TEXT.toCourse })])]);
  const rowActions = (t, rest) => (t.candidate && host.confirmCandidate
    ? [el('div', { class: 'dia-mp-acts' }, [...candidateButtons(t), ...rest])]
    : rest);
  const tokenRow = (t) => {
    const li = el('li', t.nick ? { class: 'dia-nick', title: PANEL_TEXT.nickHint } : {}, [
      t.avatar ? miniAvatar(t.avatar) : null,
      el('span', { class: 'dia-t' }, [
        ...textNode(t),
        t.about ? el('span', { class: 'dia-mp-about', text: fillText(PANEL_TEXT.onFact, { fact: t.about }) }) : null,
      ]),
      ...rowActions(t, [
      el('button', {
        type: 'button',
        class: 'dia-mp-x',
        title: PANEL_TEXT.drop,
        'aria-label': PANEL_TEXT.drop,
        disabled: busy,
        onclick: () => {
          li.classList.add('dia-struck');
          Promise.resolve(host.dropToken(mesId, t.index)).then((res) => {
            if (res && res.ok === false) li.classList.remove('dia-struck');
          }).catch((err) => {
            li.classList.remove('dia-struck');
            console.warn('[academy] действие плашки не удалось:', err);
          });
        },
      }, [icon('x')]),
      ]),
    ]);
    return li;
  };
  if (view.invite && host.answerInvite) {
    const ask = (answer) => run(host.answerInvite(mesId, answer));
    content.append(el('div', { class: 'dia-mp-sec dia-mp-invite' }, [
      el('ul', {}, [el('li', { class: 'dia-mp-ask' }, [
        el('span', { class: 'dia-t', text: view.invite.text }),
        el('div', { class: 'dia-mp-ask-btns' }, [
          el('button', { type: 'button', class: 'dia-mp-add', disabled: busy, onclick: () => ask('yes') }, [el('span', { text: view.invite.go })]),
          el('button', { type: 'button', class: 'dia-mp-add', disabled: busy, onclick: () => ask('no') }, [el('span', { text: view.invite.decline })]),
        ]),
      ])]),
    ]));
  }
  if (view.jumpAsk && host.resolveJump) {
    const ask = (accept) => run(Promise.resolve(host.resolveJump(accept)).then((res) => {
      if (res && res.ok === false && res.error) {
        jumpErrors.set(mesId, res.error);
        open.add(mesId);
      } else jumpErrors.delete(mesId);
      renderMessagePanels(host);
    }));
    content.append(el('div', { class: 'dia-mp-sec dia-mp-invite' }, [
      el('ul', {}, [el('li', { class: 'dia-mp-ask' }, [
        el('span', { class: 'dia-t', text: view.jumpAsk.text }),
        el('div', { class: 'dia-mp-ask-btns' }, [
          el('button', { type: 'button', class: 'dia-mp-add', disabled: busy, onclick: () => ask(true) }, [el('span', { text: view.jumpAsk.go })]),
          el('button', { type: 'button', class: 'dia-mp-add', disabled: busy, onclick: () => ask(false) }, [el('span', { text: view.jumpAsk.decline })]),
        ]),
      ])]),
    ]));
  }
  if (view.promises && view.promises.length && host.answerPromise) {
    content.append(el('div', { class: 'dia-mp-sec dia-mp-invite' }, [
      el('ul', {}, view.promises.map((q) => el('li', { class: 'dia-mp-ask' }, [
        el('span', { class: 'dia-t', text: q.text }),
        el('div', { class: 'dia-mp-ask-btns' }, [
          el('button', { type: 'button', class: 'dia-mp-add', disabled: busy, onclick: () => run(host.answerPromise(mesId, q.key, true)) }, [el('span', { text: q.yes })]),
          el('button', { type: 'button', class: 'dia-mp-add', disabled: busy, onclick: () => run(host.answerPromise(mesId, q.key, false)) }, [el('span', { text: q.no })]),
        ]),
      ]))),
    ]));
  }
  if (view.decisions && view.decisions.length) {
    content.append(el('div', { class: 'dia-mp-sec dia-mp-invite' }, [
      el('ul', {}, view.decisions.map((t) => el('li', {}, [el('span', { class: 'dia-t', text: t })]))),
    ]));
  }
  const searching = !view.analyzed && !view.draft;
  for (const s of SECTIONS) {
    const mine = tokens.filter((t) => t.kind === s.kind);
    if (!mine.length && !searching) continue;
    content.append(el('div', { class: 'dia-mp-sec', 'data-kind': s.kind }, [
      el('h4', {}, [icon(SECTION_ICON[s.kind] || 'scroll'), el('span', { text: sectionLabel(s, labels) })]),
      mine.length ? el('ul', {}, mine.map(tokenRow)) : null,
    ]));
  }

  const loudRows = tokens.filter((t) => t.kind === 'loud');
  const alone = loudAlone(tokens);
  const loudText = alone || loudLine(tokens);
  const { posts: talk, elsewhere } = talkGroups(tokens);
  const postRows = (t) => {
    const row = tokenRow(t);
    if (!t.replies.length) return [row];
    return [row, el('li', { class: 'dia-thr' }, [el('ul', { class: 'dia-mp-thread' }, t.replies.map(tokenRow))])];
  };
  if (talk.length || elsewhere.length) {
    content.append(el('div', { class: 'dia-mp-sec dia-mp-talk' }, [
      el('h4', {}, [
        icon('chat'), el('span', {}, [PANEL_TEXT.talk, loudRows.length ? el('span', { class: 'dia-mp-about dia-mp-loud', text: ` · ${loudText}` }) : null]),
      ]),
      el('ul', {}, [...talk.flatMap(postRows), ...elsewhere.map(tokenRow)]),
      el('p', {
        class: 'dia-mp-note',
        text: fillText(view.analyzed && !view.draft ? PANEL_TEXT.talkHintSaved : PANEL_TEXT.talkHint, { crowdIn: labels.crowdIn, tab: labels.feedTab }),
      }),
    ]));
  } else if (loudRows.length) {
    content.append(el('div', { class: 'dia-mp-sec dia-mp-talk' }, [
      el('h4', {}, [
        icon('chat'), alone ? el('span', { class: 'dia-mp-about dia-mp-loud', text: alone }) : el('span', {}, [fillText(PANEL_TEXT.heard, { crowdIn: labels.crowdIn }), el('span', { class: 'dia-mp-about dia-mp-loud', text: ` · ${loudText}` })]),
      ]),
      alone ? null : el('p', { class: 'dia-mp-note', text: fillText(PANEL_TEXT.heardHint, { tab: labels.feedTab }) }),
    ]));
  }

  if (view.partial) content.append(el('p', { class: 'dia-mp-unparsed', text: PANEL_TEXT.partial }));
  const unparsed = (view.unparsed || []).filter(Boolean);
  if (unparsed.length) content.append(el('p', { class: 'dia-mp-unparsed', text: unparsedText(unparsed) }));

  const rows = (view.rows || []).filter(Boolean);
  if (rows.length) {
    content.append(el('div', { class: 'dia-mp-sec' }, [
      el('h4', {}, [icon('scroll'), el('span', { text: PANEL_TEXT.events })]),
      el('ul', {}, rows.map((r) => el('li', {}, [el('span', { class: 'dia-t', text: r })]))),
    ]));
  }

  const justSaved = saved.has(mesId) && view.analyzed && !view.draft && !view.error;
  if (view.uncounted) content.append(el('p', { class: 'dia-mp-note', text: PANEL_TEXT.uncounted }));
  else if (!justSaved) content.append(el('p', { class: 'dia-mp-note', text: view.live ? PANEL_TEXT.liveNote : PANEL_TEXT.correctionNote }));

  const problem = view.error || (view.jumpAsk && jumpErrors.get(mesId)) || '';
  if (problem) content.append(el('p', { class: 'dia-mp-error', text: problem }));
  if (view.cancelled) content.append(el('p', { class: 'dia-mp-note', text: view.cancelled }));
  if (justSaved) {
    content.append(el('p', { class: 'dia-mp-note dia-mp-saved' }, [icon('tick'), el('span', { text: PANEL_TEXT.saved })]));
  }

  const showUndoAll = view.analyzed && !view.draft;
  const showUndoReply = Boolean(view.canUndo && host.undoReply);
  const buttons = [
    view.draft ? el('button', {
      type: 'button', class: 'dia-mp-btn dia-main', disabled: busy,
      onclick: (e) => saveNow(host, mesId, e.currentTarget),
    }, [pend ? PANEL_TEXT.savingBtn : PANEL_TEXT.save]) : null,
    view.draft ? el('button', {
      type: 'button', class: 'dia-mp-btn', disabled: busy,
      onclick: () => { saved.delete(mesId); run(host.discardAnalysis(mesId)); },
    }, [PANEL_TEXT.discard]) : null,
    showUndoAll
      ? el('button', {
        type: 'button',
        class: 'dia-mp-btn',
        title: PANEL_TEXT.undoAllHint,
        disabled: locked,
        onclick: (e) => confirmTap(host, mesId, 'all', e.currentTarget, () => { saved.delete(mesId); run(host.clearAnalysis(mesId)); }),
      }, [armed.has(`${mesId}:all`) ? PANEL_TEXT.sure : PANEL_TEXT.undoAll])
      : null,
    showUndoReply
      ? el('button', {
        type: 'button', class: 'dia-mp-btn', title: PANEL_TEXT.undoReplyHint, disabled: locked,
        onclick: (e) => confirmTap(host, mesId, 'reply', e.currentTarget, () => run(host.undoReply())),
      }, [armed.has(`${mesId}:reply`) ? PANEL_TEXT.sure : PANEL_TEXT.undoReply])
      : null,
  ].filter(Boolean);
  if (buttons.length) {
    footer.append(el('div', { class: 'dia-mp-btns' }, buttons));
    const help = [
      showUndoAll ? `${PANEL_TEXT.undoAll}: ${PANEL_TEXT.undoAllHint}` : null,
      showUndoReply ? `${PANEL_TEXT.undoReply}: ${PANEL_TEXT.undoReplyHint}` : null,
    ].filter(Boolean);
    if (help.length) footer.append(el('details', { class: 'dia-mp-help' }, [
      el('summary', { text: PANEL_TEXT.helpTitle }),
      ...help.map((text) => el('p', { class: 'dia-mp-note', text })),
    ]));
  } else footer.hidden = true;

  const state = view.draft ? 'dia-draftp' : view.analyzed ? 'dia-done' : 'dia-undone';
  const mat = look && look.mat ? look.mat : DEFAULT_MAT;
  const panelNode = el('div', {
    class: `${PANEL_CLASS} dia-mat-scope ${state}${isOpen ? ' dia-open' : ''}`,
    lang: 'ru',
    'data-mat': mat,
    'data-look': look && look.look ? look.look : 'diary',
    'data-mesid': String(mesId),
  }, [el('i', { class: 'dia-bookmark', 'aria-hidden': 'true' }), toggle, content, footer]);
  return panelNode;
}

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

export function unparsedText(names) {
  const list = [...new Set((names || []).filter(Boolean).map(humanName).filter(Boolean))];
  if (!list.length) return '';
  return fillText(list.length > 1 ? PANEL_TEXT.unparsedMany : PANEL_TEXT.unparsed, { names: list.map((n) => `«${n}»`).join(', ') });
}

export function humanName(raw) {
  const s = String(raw || '').trim();
  if (!/^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/.test(s)) return s;
  return s.split(/[-_.]+/).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

const pendingSave = new Set();
const lockUntil = new Map();
const armed = new Map();
export const LOCK_MS = 1500;
export const ARM_MS = 4000;
const ARM_GUARD_MS = 500;

const later = (fn, ms) => { const t = setTimeout(fn, ms); if (t && t.unref) t.unref(); };

async function saveNow(host, mesId, btn) {
  if (pendingSave.has(mesId)) return;
  pendingSave.add(mesId);
  const panel = btn && btn.closest ? btn.closest(`.${PANEL_CLASS}`) : null;
  if (panel) for (const b of panel.querySelectorAll('button')) b.disabled = true;
  if (btn) btn.textContent = PANEL_TEXT.savingBtn;
  try {
    const res = await host.saveAnalysis(mesId);
    if (res && res.ok) {
      saved.add(mesId);
      open.add(mesId);
      lockUntil.set(mesId, Date.now() + LOCK_MS);
      later(() => renderMessagePanels(host), LOCK_MS + 50);
    }
  } catch (err) {
    console.warn('[academy] сохранение разбора не удалось:', err);
  } finally {
    pendingSave.delete(mesId);
    renderMessagePanels(host);
  }
}

function confirmTap(host, mesId, kind, btn, action) {
  const key = `${mesId}:${kind}`;
  const at = armed.get(key);
  if (at === undefined) {
    const now = Date.now();
    armed.set(key, now);
    if (btn) btn.textContent = PANEL_TEXT.sure;
    later(() => { if (armed.get(key) === now) { armed.delete(key); renderMessagePanels(host); } }, ARM_MS);
    return;
  }
  if (Date.now() - at < ARM_GUARD_MS) return;
  armed.delete(key);
  action();
}

function run(promise) {
  Promise.resolve(promise).catch((err) => console.warn('[academy] действие плашки не удалось:', err));
}

export function loudLine(tokens) {
  return [...new Set((tokens || []).filter((t) => t && t.kind === 'loud').map((t) => t.text))].join(', ');
}

export function loudAlone(tokens) {
  return (tokens || []).filter((t) => t && t.kind === 'loud').map((t) => String(t.text)).find((t) => /наедине/i.test(t)) || '';
}

// ui/today.js — вкладка «Сегодня»: день, пара, исход проверки, промотка
// времени и ручная установка часов.

import { currentPeriod, dayPlan, nextPeriod } from '../core/schedule.mjs';
import { isStalled, phaseOf, termAt, weekIndex } from '../core/time.mjs';
import { gradeInfo, isPassing } from '../core/exams.mjs';
import {
  uiLabels, fill, TIME_VIA, stateHealth, formatDate, formatWeek, termTitle, capNumbers, plural,
  extraLabels, whereText, slotText, mounted, el, runAction, setStatus, renderEmpty, call,
  renderPanel,
} from './common.js';
import { holidaysView, ownEventsView, ownEventsBlock, holidaysBlock } from './holidays.js';

/** Ночь: до первого звонка утра и после того, как заведение закрылось. */
const NIGHT_FROM = 22 * 60;
const NIGHT_TO = 6 * 60;

const minutes = (time) => {
  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const isNight = (time) => {
  const t = minutes(time);
  return t === null ? false : t >= NIGHT_FROM || t < NIGHT_TO;
};

/**
 * Вкладка «Сегодня» (3.2, 3.9). Главный экран: текущая пара, следующая, дата,
 * неделя, отметка про источник времени и, если время встало, — прямая жалоба.
 *
 * В выходной, на каникулах, ночью и после последней пары расписание молчит:
 * панель, которая в субботу бодро показывает «сейчас: химия», хуже панели,
 * которая молчит.
 */
export function todayView(state, preset) {
  const health = stateHealth(state, preset);
  if (health.kind !== 'ok') return { ...health, numbers: [], silent: true };

  const U = uiLabels(preset);
  const cal = state.calendar;
  const phase = phaseOf(preset, state, cal.day);
  // Пресет обязателен: без него счёт недель идёт сквозной от начала года, и
  // панель во втором триместре сказала бы «20-я неделя» там, где строка
  // состояния в промпте (`prompt.mjs`, тот же `weekIndex` с пресетом) говорит
  // «3-я неделя триместра». Экран и промпт обязаны говорить одно и то же.
  const at = termAt(preset, state, cal.day);
  const week = weekIndex(state, cal.day, preset);
  const plan = dayPlan(state, preset, cal.day);
  const hasClock = cal.precision === 'datetime' && cal.time;
  const night = hasClock && isNight(cal.time);

  const cur = plan.length && !night ? currentPeriod(state, preset) : null;
  const nxt = nextPeriod(state, preset);

  const nameOf = (id) => {
    const s = (state.subjects || []).find((x) => x.id === id);
    return (s && s.name) || id || '';
  };
  const teacherOf = (id) => {
    const s = (state.subjects || []).find((x) => x.id === id);
    const t = s && s.teacherId ? (state.teachers || []).find((x) => x.id === s.teacherId) : null;
    return t ? t.name : '';
  };
  // Корпус и аудитория (9.7A п.11): слово, а не число — в счёт чисел не идут.
  const whereOf = (id) => whereText((state.subjects || []).find((x) => x.id === id));
  const slot = (index) => plan.find((p) => p.index === index) || null;

  // Почему расписание молчит. Порядок — от самого информативного слова.
  let silent = false;
  let silentReason = '';
  if (phase === 'vacation') { silent = true; silentReason = U.silentVacation; }
  // Промежуток между периодами — своя причина, а не каникулы и не выходной:
  // без этой ветки панель бодро показывала бы пары, которых нет.
  else if (phase === 'break') { silent = true; silentReason = U.silentBreak; }
  else if (phase === 'weekend') { silent = true; silentReason = U.silentWeekend; }
  else if (phase === 'exams') { silent = true; silentReason = U.silentExams; }
  else if (night) { silent = true; silentReason = U.silentNight; }
  else if (!plan.length) { silent = true; silentReason = U.silentEmpty; }
  else if (cur && cur.status === 'after') { silent = true; silentReason = U.silentOver; }

  let now = null;
  if (cur && !silent) {
    const s = slot(cur.index);
    const ordinal = cur.index + 1;
    now = {
      status: cur.status, // now | break | before
      title: cur.status === 'now' ? U.nowTitle : cur.status === 'break' ? U.breakTitle : U.beforeTitle,
      subjectId: cur.subjectId,
      name: nameOf(cur.subjectId),
      teacher: teacherOf(cur.subjectId),
      where: whereOf(cur.subjectId),
      ordinal,
      start: s ? s.start : null,
      end: s ? s.end : null,
      // Номер периода словами пресета: «1-я пара», «1-й урок», «1-е занятие».
      slotText: s && s.start && s.end
        ? fill(U.slotTime, { ordinal, start: s.start, end: s.end })
        : fill(U.slot, { ordinal }),
    };
  }

  let next = null;
  // «Сегодня начнём с» (или «Перемена, дальше») и «Дальше» про одну и ту же пару — две карточки подряд
  // читались как повтор: следующую прячем, пока она и есть та, с которой начнём.
  const nextIsNow = Boolean(nxt && now && now.status !== 'now' && nxt.day === cal.day && nxt.subjectId === now.subjectId
    && nxt.index === cur.index);
  if (nxt && !nextIsNow) {
    const sameDay = nxt.day === cal.day;
    const nextSlot = dayPlan(state, preset, nxt.day).find((p) => p.index === nxt.index) || null;
    next = {
      subjectId: nxt.subjectId,
      name: nameOf(nxt.subjectId),
      teacher: teacherOf(nxt.subjectId),
      where: whereOf(nxt.subjectId),
      day: nxt.day,
      sameDay,
      when: sameDay
        ? (nextSlot && nextSlot.start ? fill(U.nextToday, { start: nextSlot.start }) : U.nextSoon)
        : fill(nextSlot && nextSlot.start ? U.nextDay : U.nextDayNoTime,
          { date: formatDate(nxt.day), start: nextSlot && nextSlot.start }),
    };
  }

  const stalled = isStalled(state, preset);
  const idle = Number(cal.idle) || 0;
  const timeMark = stalled
    ? 'Время стоит, проверьте источник.'
    : cal.source
      ? (idle === 0
        ? `Время сдвинулось в последнем ответе (${TIME_VIA[cal.source] || cal.source}).`
        : `Время сдвинулось ${idle} ${plural(idle, 'ответ', 'ответа', 'ответов')} назад (${TIME_VIA[cal.source] || cal.source}).`)
      : 'Время в чате ещё не сдвигалось.';

  // Имя периода на экране: только когда периодов в году больше одного. У
  // пресета с одним периодом называть нечего — «семестр» и так один, и лишняя
  // строка была бы шумом (заодно панель печатает ровно то же, что печатала).
  const manyTerms = at.terms.length > 1;
  const termLine = manyTerms ? termTitle(at.term, U) : '';
  // Имя периода — слово и в счёт чисел не идёт, как фаза и как ярлык отношения.
  // А вот безымянный период превращается в порядковый номер, и это уже число:
  // такое считаем наравне с остальными (3.3).
  const termIsWord = Boolean(at.term && at.term.name);

  // Сводные числа по убыванию важности. Слова (фаза, преподаватель) не в счёт.
  const raw = [
    { key: 'date', text: formatDate(cal.day) },
    hasClock ? { key: 'time', text: cal.time } : null,
    { key: 'week', text: formatWeek(week, preset, at.scope) },
    termLine && !termIsWord ? { key: 'term', text: termLine } : null,
    now ? { key: 'ordinal', text: fill(U.slot, { ordinal: now.ordinal }) } : null,
    next ? { key: 'next', text: next.when } : null,
    stalled ? { key: 'idle', text: `${idle} ${plural(idle, 'ответ', 'ответа', 'ответов')} без движения` } : null,
  ].filter(Boolean);
  const capped = capNumbers(raw, preset);

  return {
    kind: 'ok',
    title: '',
    text: '',
    action: null,
    errors: [],
    day: cal.day,
    dateLine: formatDate(cal.day),
    weekLine: formatWeek(week, preset, at.scope),
    week,
    // Период: имя на экране, номер и охват — для тех, кто решает сам.
    termLine,
    termName: at.term ? at.term.name : '',
    termIndex: at.index,
    termsCount: at.terms.length,
    termScope: at.scope,
    phase,
    phaseLabel: U.phases[phase] || phase,
    precision: cal.precision,
    time: hasClock ? cal.time : null,
    silent,
    silentReason,
    now,
    next,
    nextIsNow,
    plan: plan.map((p) => ({
      index: p.index,
      ordinal: p.index + 1,
      subjectId: p.subjectId,
      name: p.name,
      teacher: teacherOf(p.subjectId),
      where: whereOf(p.subjectId),
      start: p.start,
      end: p.end,
      current: Boolean(now && now.subjectId === p.subjectId && now.ordinal === p.index + 1),
    })),
    stalled,
    idle,
    timeMark,
    // Прыжок вперёд, придержанный ядром до слова человека (`time.setAbsolute`).
    // Панель отдаёт его как есть: числа считает вью, слова — отрисовка.
    heldJump: cal.heldJump
      ? {
        day: cal.heldJump.day,
        dateLine: formatDate(cal.heldJump.day),
        fromLine: formatDate(cal.heldJump.from || cal.day),
        time: cal.heldJump.time || null,
        days: Number(cal.heldJump.jump) || 0,
        matched: String(cal.heldJump.matched || '').trim(),
      }
      : null,
    // Исход проверки, брошенной сегодня (9.4.1): d20 против DC одной строкой.
    // Число броска и DC в счёт шести чисел не идут — это сама запись события,
    // как оценки в зачётке, а не сводная метрика.
    exams: examResultsToday(state, preset),
    holidays: holidaysView(state, preset),
    ownEvents: ownEventsView(state),
    numbers: capped.shown,
    droppedNumbers: capped.dropped,
  };
}

/**
 * Исходы проверок, брошенных СЕГОДНЯ (9.4.1, «видимая проверка»), — для
 * «Сегодня». Источник — история бросков события (`item.rolls`), а не журнал и
 * не последний прогон: журнал кольцевой, прогон живёт в памяти вкладки, а
 * строка обязана пережить F5 и смену чата туда-обратно.
 *
 * Почему только сегодняшние: строка — новость дня. Вчерашний исход уже лежит
 * в зачётке оценкой, и держать его на главном экране значило бы копить там
 * историю.
 *
 * Итог, который мир ещё не знает (9.4.3, `announced: false`), показывается —
 * панель смотрит человек, а не персонаж, — но с пометкой «мир узнает …»:
 * иначе человек удивился бы, почему модель про оценку молчит.
 */
export function examResultsToday(state, preset) {
  const day = state && state.calendar && state.calendar.day;
  if (!day) return [];
  const X = extraLabels(preset);
  const kinds = (preset && preset.exams && preset.exams.kinds) || [];
  const out = [];
  for (const item of (state.exams && state.exams.items) || []) {
    const rolls = Array.isArray(item && item.rolls) ? item.rolls : [];
    const last = rolls[rolls.length - 1];
    if (!last || last.day !== day) continue;
    const subject = (state.subjects || []).find((s) => s.id === item.subjectId);
    const kind = kinds.find((k) => k.id === item.kind);
    // Что записано в итоге: версия модели, если она победила (8.1), иначе
    // посчитанное броском.
    const shown = item.modelOverride && item.outcome ? item.outcome : last.value;
    const info = gradeInfo(preset, shown);
    const auto = last.tier === 'auto';
    const tierText = (X.checkTiers && X.checkTiers[last.tier]) || String(last.tier || '');
    const notes = [];
    if (last.saved) notes.push(X.checkSaved);
    if (last.capped) notes.push(X.checkCapped);
    if (item.modelOverride && item.outcome) notes.push(fill(X.checkOverride, { said: (info && info.label) || item.outcome }));
    const pending = item.announced === false;
    if (pending && item.announceOn) notes.push(fill(X.checkPending, { date: formatDate(item.announceOn) }));
    out.push({
      id: item.id,
      // Ключ для анимации «свежего» броска: попытка + день. Перерисовка панели
      // бывает на каждое действие, и без ключа кубик «выпадал» бы заново.
      key: `${item.id}:${rolls.length}:${day}`,
      subjectId: item.subjectId,
      subject: (subject && subject.name) || item.subjectId || '',
      kind: (kind && kind.name) || String(item.kind || ''),
      value: String(shown),
      valueLabel: (info && info.label) || String(shown),
      passed: isPassing(preset, shown),
      auto,
      roll: auto ? null : last.roll,
      dc: auto ? null : last.dc,
      tier: last.tier,
      tierText,
      pending,
      head: fill(X.checkLine, {
        kind: String((kind && kind.name) || item.kind || '').toLowerCase(),
        subject: (subject && subject.name) || item.subjectId || '',
        value: String(shown),
      }),
      rollText: auto ? X.checkAuto : fill(X.checkRoll, { roll: last.roll, dc: last.dc, tier: tierText }),
      notes,
    });
  }
  return out;
}

// --- итог действия на «Сегодня» ---------------------------------------------

/** Сколько живёт слово о результате: дольше — уже не новость, а мусор на экране. */
const NOTE_TTL = 60 * 1000;

function setTodayNote(text, repair = false) {
  mounted.todayNote = text ? { text, repair, at: Date.now() } : null;
}

/** Итог последнего действия, пока он свеж; иначе `null`. */
function todayNoteOf() {
  const n = mounted.todayNote;
  if (!n) return null;
  if (Date.now() - n.at > NOTE_TTL) { mounted.todayNote = null; return null; }
  return n;
}

// --- вкладка «Сегодня» ------------------------------------------------------

export function renderToday(host, view, preset) {
  if (view.kind !== 'ok') return renderEmpty(host, view);

  const U = uiLabels(preset);
  const box = el('div', { class: 'academy-today' });

  box.append(el('div', { class: 'academy-head' }, [
    el('div', { class: 'academy-date', text: view.dateLine }),
    el('div', { class: 'academy-week' }, [
      view.weekLine,
      // Имя периода стоит рядом с фазой той же «таблеткой»: строка `academy-week`
      // и так переносится по словам, поэтому на телефоне она уедет вниз, а не
      // растянет панель (3.9). Своего класса в `style.css` не заводим — вид у
      // неё тот же, что у фазы.
      view.termLine ? el('span', { class: 'academy-phase academy-term', text: view.termLine }) : null,
      el('span', { class: 'academy-phase', text: view.phaseLabel }),
      view.time ? el('span', { class: 'academy-clock', text: view.time }) : null,
    ]),
  ]));

  // Вопрос про прыжок времени — самым первым: внизу под расписанием его не
  // замечали, а пока он висит, календарь стоит на месте.
  if (view.heldJump) box.append(heldJumpBlock(host, view, U));

  const X0 = extraLabels(preset);
  if (X0.weekHint) box.append(el('div', { class: 'academy-note academy-week-hint', text: X0.weekHint }));

  const note = todayNoteOf();
  if (note) box.append(el('div', { class: 'academy-status academy-status-ok academy-today-note', text: note.text }));

  // Исход сегодняшней проверки (9.4.1) — выше расписания: в день экзамена это
  // главная новость, а пар в этот день обычно и нет («сессия — лекций нет»).
  for (const r of view.exams || []) box.append(examResultLine(r));

  if (view.silent) {
    box.append(el('div', { class: 'academy-silent', text: view.silentReason }));
  } else if (view.now) {
    box.append(el('div', { class: 'academy-card academy-now' }, [
      el('div', { class: 'academy-card-title', text: view.now.title }),
      el('div', { class: 'academy-subject', text: view.now.name }),
      view.now.teacher ? el('div', { class: 'academy-teacher', text: view.now.teacher }) : null,
      view.now.where ? el('div', { class: 'academy-where', text: view.now.where }) : null,
      el('div', { class: 'academy-slot', text: view.now.slotText }),
    ]));
  }

  if (view.next) {
    box.append(el('div', { class: 'academy-card academy-next' }, [
      el('div', { class: 'academy-card-title', text: U.nextCardTitle }),
      el('div', { class: 'academy-subject', text: view.next.name }),
      view.next.teacher ? el('div', { class: 'academy-teacher', text: view.next.teacher }) : null,
      view.next.where ? el('div', { class: 'academy-where', text: view.next.where }) : null,
      el('div', { class: 'academy-slot', text: view.next.when }),
    ]));
  } else if (!view.silent && !view.nextIsNow) {
    box.append(el('div', { class: 'academy-silent', text: U.noNext }));
  }

  if (view.plan.length && !view.silent) {
    box.append(el('div', { class: 'academy-plan' }, [
      el('div', { class: 'academy-card-title', text: U.dayTitle }),
      el('ol', { class: 'academy-plan-list' }, view.plan.map((p) => el('li', {
        class: p.current ? 'academy-plan-item academy-plan-current' : 'academy-plan-item',
      }, [
        el('span', { class: 'academy-plan-time', text: p.start ? `${p.start}` : `${p.ordinal}` }),
        el('span', { class: 'academy-plan-name', text: p.name }),
        p.teacher ? el('span', { class: 'academy-plan-teacher', text: p.teacher }) : null,
        p.where ? el('span', { class: 'academy-plan-where', text: p.where }) : null,
      ]))),
    ]));
  }

  box.append(el('div', {
    class: view.stalled ? 'academy-timemark academy-timemark-stalled' : 'academy-timemark',
    text: view.timeMark,
  }));

  const X = extraLabels(preset);
  const holidays = holidaysBlock(view.holidays, X);
  if (holidays) box.append(holidays);
  box.append(ownEventsBlock(host, view, X));

  // Ремонтный инструмент, а не главная кнопка (3.2): спрятан в свёрнутый блок.
  box.append(manualTimeBlock(host, view, U));
  return box;
}

/**
 * Строка исхода проверки (9.4.1): «Экзамен, химия: 4» и под ней «бросок 15
 * против DC 7 — успех».
 *
 * Анимация — одна и минимальная: число броска «выпадает» (масштаб и
 * прозрачность за 0,4 с, `style.css: academy-roll-fresh`), и только в первый
 * показ этого броска. Перерисовка панели случается на каждое действие, и
 * кубик, который прыгает при каждом нажатии, раздражал бы; поэтому показанные
 * броски помнятся по ключу (`mounted.seenRolls`, память вкладки — после F5
 * число просто стоит). При `prefers-reduced-motion` анимации нет вовсе.
 * Счётчика-«рулетки» нет нарочно: исход уже посчитан, и изображать случай,
 * который ещё только решается, было бы враньём.
 */
function examResultLine(r) {
  const fresh = !mounted.seenRolls.has(r.key);
  mounted.seenRolls.add(r.key);
  const kind = r.auto ? 'auto' : r.passed ? 'pass' : 'fail';
  return el('div', { class: `academy-card academy-verdict academy-verdict-${kind}` }, [
    el('div', { class: 'academy-verdict-head' }, [
      r.auto ? null : el('span', {
        class: fresh ? 'academy-roll academy-roll-fresh' : 'academy-roll',
        text: String(r.roll),
        title: `d20 = ${r.roll}, DC ${r.dc}`,
      }),
      el('span', { class: 'academy-subject', text: r.head }),
    ]),
    // Бросок и пометки — по раскрытию: на экране остаётся «Алгебра: контрольная — 4».
    el('details', { class: 'academy-verdict-more' }, [
      el('summary', { text: 'Подробности' }),
      el('div', { class: 'academy-slot', text: r.rollText }),
      ...(r.notes || []).map((n) => el('div', { class: 'academy-note', text: n })),
    ]),
  ]);
}

/**
 * Придержанный прыжок времени вперёд: единственное место, где панель что-то
 * спрашивает у человека сама.
 *
 * Стоит на «Сегодня» и не спрятан в свёрнутый блок — в отличие от ручного
 * ремонта: ремонт человек ищет сам, а этот вопрос задаём мы, и не заданный
 * вовремя он превращается в застывший календарь без объяснения.
 */
function heldJumpBlock(host, view, U) {
  const j = view.heldJump;
  const status = el('div', { class: 'academy-status' });
  const days = j.days;

  const answer = (accept, btn) => runAction(
    btn, status,
    () => call(host, 'resolveJump', accept),
    accept ? U.jumpAccepted : U.jumpDismissed,
  ).then((res) => {
    // Число пропущенных занятий известно только после ответа ядра, а перерисовка
    // унесёт этот узел, — поэтому итог уходит в память вкладки (`todayNote`).
    if (res && res.ok) {
      setTodayNote(accept && res.missed
        ? fill(U.jumpAcceptedMissed, { count: res.missed })
        : (accept ? U.jumpAccepted : U.jumpDismissed));
    }
    renderPanel(host);
  });

  return el('div', { class: 'academy-card academy-jump' }, [
    el('div', { class: 'academy-card-title', text: U.jumpTitle }),
    el('p', {
      text: fill(U.jumpLine, {
        date: j.time ? `${j.dateLine}, ${j.time}` : j.dateLine,
        days,
        plural: plural(days, 'день', 'дня', 'дней'),
        from: j.fromLine,
      }),
    }),
    j.matched ? el('p', { class: 'academy-silent', text: fill(U.jumpMatched, { matched: j.matched }) }) : null,
    el('p', { class: 'academy-note', text: U.jumpNote }),
    el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn',
        text: U.jumpAccept,
        onclick: (e) => answer(true, e.currentTarget),
      }),
      el('div', {
        class: 'menu_button academy-btn',
        text: U.jumpDismiss,
        onclick: (e) => answer(false, e.currentTarget),
      }),
    ]),
    status,
  ]);
}

function manualTimeBlock(host, view, U) {
  const status = el('div', { class: 'academy-status' });
  const day = el('input', { type: 'date', class: 'text_pole academy-input', value: view.day || '' });
  const time = el('input', { type: 'time', class: 'text_pole academy-input', value: view.time || '' });
  // Выключена по умолчанию — то же решение, что у ключа `count=yes` в команде.
  const count = el('input', { type: 'checkbox' });

  const send = (patch, btn) => runAction(
    btn, status,
    () => call(host, 'manualTime', { ...patch, count: Boolean(count.checked) }),
    'Календарь поправлен.',
  ).then((res) => {
    // Куда ушли часы и что стало с ведомостью, надо сказать до перерисовки:
    // она унесёт узел, поэтому слова ложатся в память вкладки (`todayNote`) и
    // блок остаётся раскрытым — раньше он схлопывался молча.
    if (res && res.ok) {
      const parts = [];
      if (res.to && res.to.day) {
        const slot = Number.isInteger(res.to.ordinal) ? ` (${fill(U.slot, { ordinal: res.to.ordinal })})` : '';
        parts.push(fill(U.shiftedTo, { when: `${formatDate(res.to.day)}${res.to.time ? `, ${res.to.time}` : ''}${slot}` }));
      }
      if (res.missed) parts.push(fill(U.repairCounted, { count: res.missed }));
      else if (res.wouldMiss) parts.push(fill(U.repairNotCounted, { count: res.wouldMiss }));
      if (parts.length) setTodayNote(parts.join(' '), true);
    }
    renderPanel(host);
  });

  const note = todayNoteOf();
  const details = el('details', { class: 'academy-repair', open: Boolean(note && note.repair) }, [
    el('summary', { text: 'Поправить время вручную' }),
    el('div', { class: 'academy-repair-body' }, [
      el('p', {
        class: 'academy-note',
        text: 'Ремонтный инструмент. Основной канал — источник времени из настроек; '
          + 'если сдвигать приходится часто, дело в источнике, а не здесь.',
      }),
      el('div', { class: 'academy-row' }, [
        el('label', { class: 'academy-field' }, [el('span', { text: 'День' }), day]),
        el('label', { class: 'academy-field' }, [el('span', { text: 'Время' }), time]),
      ]),
      el('label', { class: 'academy-check' }, [count, el('span', { text: U.repairCount })]),
      el('p', { class: 'academy-note', text: U.repairCountNote }),
      el('div', { class: 'academy-row academy-row-buttons' }, [
        el('div', {
          class: 'menu_button academy-btn',
          text: 'Применить',
          onclick: (e) => send({ day: day.value || null, time: time.value || null }, e.currentTarget),
        }),
        el('div', {
          class: 'menu_button academy-btn',
          text: U.shiftPeriod,
          onclick: (e) => send({ shift: { periods: 1 } }, e.currentTarget),
        }),
        el('div', {
          class: 'menu_button academy-btn',
          text: '+1 день',
          onclick: (e) => send({ shift: { days: 1 } }, e.currentTarget),
        }),
      ]),
      status,
    ]),
  ]);
  return details;
}

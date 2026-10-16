import { currentPeriod, dayEndInfo, dayPlan, nextPeriod } from '../core/schedule.mjs';
import { dayOfWeek, isStalled, phaseOf, preExamWeek, termAt, weekdayShiftOf, weekIndex } from '../core/time.mjs';
import { gradeInfo, isPassing } from '../core/exams.mjs';
import { eventsInJump } from '../core/skipped.mjs';
import {
  uiLabels, fill, TIME_VIA_LAST, stateHealth, formatDate, setDateShift, formatWeek, termTitle, capNumbers, plural,
  extraLabels, whereText, slotText, mounted, el, runAction, setStatus, renderEmpty, call,
  renderPanel, hintIcon, memoDetails, svgIcon, safe, expelledPhrase,
} from './common.js';
import { feedView } from './feed.js';
import { openExamList } from './gradebook.js';
import { activePause } from '../core/holidays.mjs';
import { bullyToday } from '../core/bullying.mjs';
import { holidaysView, ownEventsView, ownEventsBlock, pauseView, pauseBlock } from './holidays.js';

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

function yearTail(day, other) {
  const y = String(day || '').slice(0, 4);
  return y && y !== String(other || '').slice(0, 4) ? ` ${y}` : '';
}

export function heldWaiting(state, preset) {
  const held = state && state.calendar && state.calendar.heldJump;
  if (!held || !preset) return '';
  const shift = weekdayShiftOf(state);
  const heldShift = held.weekday && !shift ? (((held.weekday - dayOfWeek(held.day)) % 7) + 7) % 7 : shift;
  const date = formatDate(held.day, 'full', heldShift).split(', ').slice(1).join(', ') + yearTail(held.day, held.from || state.calendar.day);
  return fill(uiLabels(preset).jumpWaiting, { date });
}

function skippedLine(state, preset, U, held, shift) {
  const from = held.from || state.calendar.day;
  const list = eventsInJump(state, preset, from, held.day);
  if (!list.length) return '';
  const period = String((preset.vocab && preset.vocab.examPeriod) || '').trim();
  const text = (e) => {
    const date = formatDate(e.day, 'full', shift).split(', ').slice(1).join(', ') + yearTail(e.day, from);
    const what = e.type === 'exam' ? fill(U.jumpSkipExam, { kind: e.name || 'экзамен', subject: e.subject })
      : e.type === 'session' ? fill(U.jumpSkipSession, { examPeriod: period || 'сессия' })
        : e.name;
    return `${what} (${date})`;
  };
  const shown = list.slice(0, 3).map(text);
  if (list.length > 3) shown.push(fill(U.jumpSkipMore, { n: list.length - 3 }));
  return fill(U.jumpSkipped, { list: shown.join(', ') });
}

export function todayView(state, preset, opts = {}) {
  const health = stateHealth(state, preset);
  if (health.kind !== 'ok') return { ...health, numbers: [], silent: true };

  const U = uiLabels(preset);
  const cal = state.calendar;
  const shift = weekdayShiftOf(state);
  setDateShift(shift);
  const heldShift = cal.heldJump && cal.heldJump.weekday && !shift
    ? (((cal.heldJump.weekday - dayOfWeek(cal.heldJump.day)) % 7) + 7) % 7
    : shift;
  const phase = phaseOf(preset, state, cal.day);
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
  const whereOf = (id) => whereText((state.subjects || []).find((x) => x.id === id));
  const slot = (index) => plan.find((p) => p.index === index) || null;

  let silent = false;
  let silentReason = '';
  const pause = phase === 'vacation' ? activePause(state, cal.day) : null;
  const pauseName = pause ? (String(pause.name || '').trim() || extraLabels(preset).pauseTitle) : '';
  if (phase === 'vacation') { silent = true; silentReason = pauseName ? `${pauseName} — ${extraLabels(preset).holidayOffMark}.` : U.silentVacation; }
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
      status: cur.status,
      title: cur.status === 'now' ? U.nowTitle : cur.status === 'break' ? U.breakTitle : U.beforeTitle,
      subjectId: cur.subjectId,
      name: nameOf(cur.subjectId),
      teacher: teacherOf(cur.subjectId),
      where: whereOf(cur.subjectId),
      ordinal,
      start: s ? s.start : null,
      end: s ? s.end : null,
      slotText: s && s.start && s.end
        ? fill(U.slotTime, { ordinal, start: s.start, end: s.end })
        : fill(U.slot, { ordinal }),
    };
  }

  let next = null;
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
          { date: formatDate(nxt.day, 'full', shift), start: nextSlot && nextSlot.start }),
    };
  }

  const stalled = isStalled(state, preset);
  const idle = Number(cal.idle) || 0;
  const timeMark = stalled
    ? 'Время в чате давно не двигалось: проверьте, печатается ли дата в ответах.'
    : cal.dismissedJump || cal.heldJump
      ? ''
      : cal.source
        ? (cal.source === 'manual'
          ? (idle === 0
            ? 'Время в последнем ответе поправлено вручную.'
            : `Время поправлено вручную ${idle} ${plural(idle, 'ответ', 'ответа', 'ответов')} назад.`)
          : idle === 0
            ? (TIME_VIA_LAST[cal.source] || 'Время взято из последнего ответа.')
            : '')
        : 'Время в чате пока не менялось.';

  const manyTerms = at.terms.length > 1;
  const termLine = manyTerms ? termTitle(at.term, U) : '';
  const termIsWord = Boolean(at.term && at.term.name);

  const raw = [
    { key: 'date', text: formatDate(cal.day, 'full', shift) },
    hasClock ? { key: 'time', text: cal.time } : null,
    { key: 'week', text: formatWeek(week, preset, at.scope) },
    termLine && !termIsWord ? { key: 'term', text: termLine } : null,
    now ? { key: 'ordinal', text: fill(U.slot, { ordinal: now.ordinal }) } : null,
    next ? { key: 'next', text: next.when } : null,
    stalled ? { key: 'idle', text: `${idle} ${plural(idle, 'ответ', 'ответа', 'ответов')} без движения` } : null,
  ].filter(Boolean);
  const capped = capNumbers(raw, preset);

  const holidays = holidaysView(state, preset);
  const X = extraLabels(preset);
  const examList = phase === 'exams' && silent ? openExamList(state, preset).map((e) => `${e.subject} (${e.kind})`) : [];
  const forms = Array.isArray(X.holidayDayForms) ? X.holidayDayForms : [];
  const dateParts = /^(.*?),\s*(\d+)\s+(.+)$/.exec(formatDate(cal.day, 'full', shift)) || [];
  const upcoming = holidays.find((h) => h.days > 0);
  const countdown = silent && upcoming
    ? { n: String(upcoming.days), label: `${plural(upcoming.days, forms[0], forms[1], forms[2])} · ${upcoming.name}`, id: upcoming.id }
    : null;
  const lead = feedLead(state, preset, opts);

  return {
    kind: 'ok',
    title: '',
    text: '',
    action: null,
    errors: [],
    day: cal.day,
    dayNumber: dateParts[2] || '',
    weekday: dateParts[1] || '',
    monthName: dateParts[3] || '',
    marginDate: cal.day.slice(8, 10) + '.' + cal.day.slice(5, 7),
    dateLine: formatDate(cal.day, 'full', shift),
    weekLine: formatWeek(week, preset, at.scope),
    week,
    termLine,
    termName: at.term ? at.term.name : '',
    termIndex: at.index,
    termsCount: at.terms.length,
    termScope: at.scope,
    phase,
    phaseLabel: pauseName || (phase === 'study' && preExamWeek(preset, state, cal.day) && U.phases.preExams) || U.phases[phase] || phase,
    precision: cal.precision,
    time: hasClock ? cal.time : null,
    canSkipToEnd: dayEndInfo(state, preset).available,
    silent,
    silentReason,
    examList,
    expelled: expelledPhrase(state, preset, opts.heroine),
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
      done: Boolean(cur && !silent && p.index < cur.index),
    })),
    stalled,
    idle,
    timeMark,
    heldJump: cal.heldJump
      ? {
        day: cal.heldJump.day,
        dateLine: formatDate(cal.heldJump.day, 'full', heldShift) + yearTail(cal.heldJump.day, cal.heldJump.from || cal.day),
        dayShort: formatDate(cal.heldJump.day, 'full', heldShift).split(', ').slice(1).join(', ') + yearTail(cal.heldJump.day, cal.heldJump.from || cal.day),
        waiting: heldWaiting(state, preset),
        skipLine: cal.heldJump.era || !(Number(cal.heldJump.jump) > 0) ? '' : skippedLine(state, preset, U, cal.heldJump, shift),
        fromLine: formatDate(cal.heldJump.from || cal.day, 'full', shift) + yearTail(cal.heldJump.from || cal.day, cal.heldJump.day),
        time: cal.heldJump.time || null,
        days: Number(cal.heldJump.jump) || 0,
        matched: humanMatched(cal.heldJump.matched),
        ...(cal.heldJump.era ? { era: { year: String(cal.heldJump.day).slice(0, 4), from: String(cal.heldJump.from || cal.day).slice(0, 4) } } : {}),
      }
      : null,
    exams: examResultsToday(state, preset),
    holidays,
    countdown,
    rumor: lead.rumor,
    deal: lead.deal,
    bully: safe(() => bullyToday(state, preset, { heroine: opts.heroine }), null),
    ownEvents: ownEventsView(state, preset),
    pause: pauseView(state, preset),
    numbers: capped.shown,
    droppedNumbers: capped.dropped,
  };
}

function feedLead(state, preset, opts = {}) {
  const X = extraLabels(preset);
  const make = (chan) => safe(() => feedView(state, preset, { chan, heroine: opts.heroine }), null);
  const anon = make('anon');
  const chat = make('chat');
  const pick = (v, label) => {
    const item = v && v.items.find((x) => x.unread && (x.rumor || x.anon));
    return item ? { id: item.id, text: item.text, tag: X.feedRumorTag, src: `${label} · ${item.dayLine}` } : null;
  };
  const rumor = pick(anon, X.feedAnon) || pick(chat, X.feedChat);
  const deal = chat && chat.deals.length ? { id: chat.deals[0].id, text: chat.deals[0].text } : null;
  return { rumor, deal };
}

export function humanMatched(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/<!--|-->/g, ' ');
  s = s.replace(/\[\[([^\]]*)\]\]/g, (m, inner) => {
    const parts = inner.split('|').map((p) => p.trim()).filter((p) => p && !/^[A-Z][A-Z0-9_:]*$/.test(p));
    const dated = parts.filter((p) => /\d/.test(p));
    return (dated.length ? dated : parts).join(', ');
  });
  s = s.replace(/^\s*\[?\s*[A-Za-z_][\w-]*(?::[A-Za-z_][\w-]*)*\s*:\s*(?=\d)/, '');
  s = s.replace(/[[\]|]+/g, ' ').replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
  return s;
}

const sameWord = (a, b) => Boolean(a) && String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

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
      key: `${item.id}:${rolls.length}:${day}`,
      subjectId: item.subjectId,
      subject: (subject && subject.name) || item.subjectId || '',
      kind: (kind && kind.name) || String(item.kind || ''),
      value: String(shown),
      valueLabel: (info && info.label) || String(shown),
      passed: isPassing(preset, shown),
      stamp: !pending && info && info.label ? String(info.label) : '',
      auto,
      roll: auto ? null : last.roll,
      dc: auto ? null : last.dc,
      tier: last.tier,
      tierText,
      pending,
      head: fill(sameWord(kind && kind.name, shown) ? X.checkLineSame : X.checkLine, {
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

const NOTE_TTL = 60 * 1000;

function calKey(host) {
  const c = (safeState(host) || {}).calendar || {};
  return `${c.day || ''}|${c.time || ''}`;
}

function safeState(host) {
  try { return host.getState(); } catch { return null; }
}

function setTodayNote(text, repair = false, host = null) {
  mounted.todayNote = text ? { text, repair, at: Date.now(), cal: host ? calKey(host) : null } : null;
}

function todayNoteOf(host = null) {
  const n = mounted.todayNote;
  if (!n) return null;
  if (Date.now() - n.at > NOTE_TTL || (n.cal && host && n.cal !== calKey(host))) { mounted.todayNote = null; return null; }
  return n;
}

export function renderToday(host, view, preset) {
  if (view.kind !== 'ok') return { l: renderEmpty(host, view), blankRight: true };

  const U = uiLabels(preset);
  const X = extraLabels(preset);
  const spread = mounted.spread === true;

  const chips = [
    view.termLine ? el('span', { class: 'ad-chip' }, [view.termLine, hintIcon(preset, view.termLine)]) : null,
    el('span', { class: 'ad-chip' }, [view.phaseLabel, hintIcon(preset, view.phaseLabel)]),
    view.time ? el('span', { class: 'ad-chip ad-clock', text: view.time }) : null,
    view.expelled ? el('span', { class: 'ad-chip', text: view.expelled }) : null,
  ];
  const heroine = String(safe(() => host.getHeroine(), '') || '').trim();
  const head = [
    heroine ? el('div', { class: 'ad-from', text: `Из записей: ${heroine}` }) : null,
    el('div', { class: 'ad-date' }, view.dayNumber
      ? [
        el('div', { class: 'ad-date-day', text: view.dayNumber }),
        el('div', { class: 'ad-date-rest' }, [
          el('div', { class: 'ad-date-week', text: view.monthName }),
          el('div', { class: 'ad-date-wd', text: view.weekday }),
        ]),
        el('div', { class: 'ad-chips' }, chips),
      ]
      : [el('div', { class: 'ad-date-rest' }, [el('div', { class: 'ad-date-week', text: view.dateLine }), el('div', { class: 'ad-chips' }, chips)])]),
    view.heldJump ? el('div', { class: 'ad-weekline ad-jump-wait', text: view.heldJump.waiting }) : null,
    view.weekLine ? el('div', { class: 'ad-weekline' }, [view.weekLine, hintIcon(preset, view.weekLine)]) : null,
    view.countdown ? el('div', { class: 'ad-countdown', dataset: { holiday: view.countdown.id } }, [
      el('span', { class: 'ad-cd-n', text: view.countdown.n }),
      el('span', { class: 'ad-cd-l', text: view.countdown.label }),
    ]) : null,
  ];

  const asks = [];
  if (view.heldJump) asks.push(heldJumpBlock(host, view, U));
  if (view.pause) asks.push(pauseBlock(host, view.pause, X));
  const note = todayNoteOf(host);
  if (note) asks.push(el('div', { class: 'academy-status academy-status-ok academy-today-note', text: note.text }));

  const main = (view.exams || []).map(verdictCard);
  if (view.silent) {
    main.push(el('div', { class: 'ad-quiet-note' }, [
      el('div', { class: 'ad-q-main', text: view.silentReason }),
      view.examList.length ? el('div', { class: 'ad-small ad-soft', text: view.examList.join(', ') }) : null,
    ]));
  } else if (view.now) {
    const n = view.now;
    main.push(el('section', { class: 'ad-now', 'aria-label': n.title }, [
      el('div', { class: 'ad-now-label', text: n.title }),
      el('div', { class: 'ad-now-subject', text: n.name }),
      el('div', { class: 'ad-now-slot', text: n.slotText }),
      n.teacher ? el('div', { class: 'ad-now-meta', text: n.teacher }) : null,
      n.where ? el('div', { class: 'ad-now-meta', text: n.where }) : null,
    ]));
  }
  if (view.next) {
    const x = view.next;
    main.push(el('div', { class: 'ad-next-card' }, [
      el('div', { class: 'ad-nx-title', text: U.nextCardTitle }),
      el('div', { class: 'ad-nx-subject', text: x.name }),
      el('div', { class: 'ad-nx-meta', text: x.when }),
      x.teacher ? el('div', { class: 'ad-nx-meta', text: x.teacher }) : null,
      x.where ? el('div', { class: 'ad-nx-meta', text: x.where }) : null,
    ]));
  } else if (!view.silent && !view.nextIsNow) {
    main.push(el('div', { class: 'ad-silent', text: U.noNext }));
  }

  let plan = [];
  if (view.plan.length && !view.silent) {
    const hasN = view.plan.some((p) => p.start);
    const list = el('ol', { class: 'ad-sched', dataset: hasN ? { n: '1' } : {} }, view.plan.map((p) => {
      const state = p.done ? ' ad-done' : p.current ? ' ad-cur' : '';
      const where = [p.teacher, p.where].filter(Boolean).join(' · ');
      return el('li', { class: `ad-sched-row${state}`, dataset: { index: String(p.index) } }, [
        hasN ? el('span', { class: 'ad-n', text: String(p.ordinal) }) : null,
        el('span', { class: 'ad-t', text: p.start ? `${p.start}${p.end ? `–${p.end}` : ''}` : String(p.ordinal) }),
        el('span', { class: 'ad-s' }, [
          el('b', { text: p.name }),
          where ? el('small', { text: where }) : null,
          p.done ? el('span', { class: 'ad-mk-label', text: X.planPassed }) : null,
        ]),
        p.done ? svgIcon('tick', 'ad-mk') : el('span'),
      ]);
    }));
    plan = spread
      ? [el('h3', { class: 'ad-sec-h', text: U.dayTitle }), list]
      : [memoDetails('today:plan', {
        cls: 'ad-sched-wrap',
        summary: [el('span', { text: U.dayTitle }), svgIcon('chev', 'ad-chev')],
        body: list,
      })];
  }

  const timeMark = view.timeMark
    ? el('div', { class: view.stalled ? 'ad-timemark ad-stalled' : 'ad-timemark', text: view.timeMark })
    : null;
  const more = [X.weekHint ? el('div', { class: 'ad-small ad-soft academy-week-hint', text: X.weekHint }) : null, timeMark];

  const events = [];
  const stickers = holidaySheet(view.holidays, X, preset);
  if (stickers) events.push(stickers);
  if (view.rumor) {
    events.push(el('div', { class: 'ad-margin-note', dataset: { post: view.rumor.id } }, [
      el('small', { text: view.rumor.tag }),
      view.rumor.text,
      el('span', { class: 'ad-mn-src', text: view.rumor.src }),
    ]));
  }
  if (view.bully) {
    events.push(el('div', { class: 'ad-margin-note ad-bully', dataset: { bully: view.bully.id } }, [
      el('small', { text: view.bully.hidden ? `${X.bullyTodayTitle} · ${X.bullyHiddenMark}` : X.bullyTodayTitle }),
      view.bully.text,
    ]));
  }
  if (view.deal) {
    events.push(el('h3', { class: 'ad-sec-h ad-deal-h', text: X.feedDealsTitle }));
    events.push(el('div', { class: 'ad-deal', dataset: { deal: view.deal.id } }, [
      el('i', { class: 'ad-mk-sq' }),
      el('span', { text: view.deal.text }),
    ]));
  }

  const tools = [ownEventsBlock(host, view, X), manualTimeBlock(host, view, U)];

  const common = { marginDate: view.marginDate };
  if (spread) {
    return { ...common, l: [...head, ...asks, ...main], r: [...plan, ...events, ...more, ...tools] };
  }
  return { ...common, l: [...head, ...asks, ...main, ...events, ...plan, ...more, ...tools], r: null, blankRight: true };
}

function holidaySheet(list, X, preset) {
  if (!list || !list.length) return null;
  return el('div', { class: 'ad-stickers' }, list.map((h) => el('aside', {
    class: h.days === 0 ? 'ad-sticker ad-sticker-now' : 'ad-sticker',
    'aria-label': X.holidaysTitle,
    dataset: { holiday: h.id },
  }, [
    el('i', { class: 'ad-attach', dataset: { for: 'sticker' } }),
    el('div', { class: 'ad-st-when', text: h.whenLine }),
    el('div', { class: 'ad-st-what' }, [
      h.name,
      hintIcon(preset, h.name),
      h.own ? el('span', { class: 'academy-holiday-own', title: X.holidayOwnTitle, 'aria-label': X.holidayOwnTitle, text: X.holidayOwnMark }) : null,
    ]),
    h.note ? el('div', { class: 'ad-st-buzz', text: h.note }) : (h.about ? el('div', { class: 'ad-st-about', text: h.about }) : null),
    h.offLine ? el('div', { class: 'ad-st-off', text: h.offLine }) : null,
    h.going ? el('div', { class: 'ad-st-going', text: h.going }) : null,
  ])));
}

function verdictCard(r) {
  const fresh = !mounted.seenRolls.has(r.key);
  mounted.seenRolls.add(r.key);
  return el('details', { class: r.passed ? 'ad-verdict' : 'ad-verdict ad-fail', dataset: { exam: r.id } }, [
    el('summary', {}, [
      el('span', { class: 'ad-v-head' }, [
        r.auto ? null : el('span', {
          class: fresh ? 'academy-roll academy-roll-fresh' : 'academy-roll',
          text: String(r.roll),
          title: `d20 = ${r.roll}, DC ${r.dc}`,
        }),
        el('span', { text: r.head }),
      ]),
      r.stamp ? el('span', { class: 'ad-stamp', 'aria-hidden': 'true', text: r.stamp }) : null,
      el('span', { class: 'ad-more-t', text: 'Подробности' }),
    ]),
    el('div', { class: 'ad-v-roll' }, [
      el('div', { text: r.rollText }),
      ...(r.notes || []).map((n) => el('div', { text: n })),
    ]),
  ]);
}

export function jumpSummary(U, days, counted) {
  const dayWord = plural(days, 'день', 'дня', 'дней');
  if (!counted) return fill(U.jumpAcceptedNone, { days, plural: dayWord });
  const forms = (str) => String(str || '').split('|');
  const [u1, u2, u5] = forms(U.jumpUnits);
  const [d1, d2] = forms(U.jumpDone);
  const one = counted % 10 === 1 && counted % 100 !== 11;
  return fill(U.jumpAcceptedMissed, {
    days,
    plural: dayWord,
    count: counted,
    unit: plural(counted, u1, u2 || u1, u5 || u2 || u1),
    done: one ? d1 : (d2 || d1),
  });
}

function heldJumpBlock(host, view, U) {
  const j = view.heldJump;
  const status = el('div', { class: 'academy-status' });
  const days = j.days;

  const era = j.era;
  const accepted = era ? U.eraAccepted : U.jumpAccepted;
  const answer = (accept, btn) => runAction(
    btn, status,
    () => call(host, 'resolveJump', accept),
    accept ? accepted : U.jumpDismissed,
  ).then((res) => {
    if (res && res.ok) {
      setTodayNote(accept && days > 0 && !era
        ? jumpSummary(U, days, res.counted)
        : (accept ? accepted : U.jumpDismissed), false, host);
    }
    renderPanel(host);
  });

  return el('div', { class: 'academy-card academy-jump' }, [
    el('div', { class: 'academy-card-title', text: era ? U.eraTitle : U.jumpTitle }),
    el('p', {
      text: era ? fill(U.eraLine, era) : fill(U.jumpLine, {
        date: j.time ? `${j.dateLine}, ${j.time}` : j.dateLine,
        days: Math.abs(days),
        plural: plural(Math.abs(days), 'день', 'дня', 'дней'),
        from: j.fromLine,
      }),
    }),
    j.skipLine ? el('p', { class: 'academy-note academy-jump-skip', text: j.skipLine }) : null,
    era ? el('p', { class: 'academy-note', text: U.eraNote }) : days >= 0 ? el('p', { class: 'academy-note', text: U.jumpNote }) : null,
    el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn',
        text: era ? fill(U.eraAccept, era) : j.dayShort ? fill(U.jumpAccept, { date: j.dayShort }) : U.jumpAcceptNoDate,
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
  const count = el('input', { type: 'checkbox' });
  count.checked = Boolean(mounted.repairCount);
  count.addEventListener('change', () => { mounted.repairCount = Boolean(count.checked); });

  const send = (patch, btn, action = 'manualTime') => runAction(
    btn, status,
    () => (action === 'manualTime'
      ? call(host, action, { ...patch, count: Boolean(count.checked) })
      : call(host, action)),
    'Календарь поправлен.',
  ).then((res) => {
    if (res && res.ok) {
      const parts = [];
      if (res.to && res.to.day) {
        const slot = Number.isInteger(res.to.ordinal) ? ` (${fill(U.slot, { ordinal: res.to.ordinal })})` : '';
        parts.push(fill(U.shiftedTo, { when: `${formatDate(res.to.day)}${res.to.time ? `, ${res.to.time}` : ''}${slot}` }));
      }
      if (res.counted) parts.push(fill(U.repairCounted, { count: res.counted }));
      else if (res.wouldCount) parts.push(fill(U.repairNotCounted, { count: res.wouldCount }));
      if (parts.length) setTodayNote(parts.join(' '), true, host);
    }
    renderPanel(host);
  });

  const note = todayNoteOf(host);
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
        view.canSkipToEnd ? el('div', {
          class: 'menu_button academy-btn',
          text: U.skipToEnd,
          title: 'Промотать время; оставшиеся занятия считаются посещёнными',
          onclick: (e) => send({}, e.currentTarget, 'skipToDayEnd'),
        }) : null,
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

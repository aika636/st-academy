import {
  EVENT_TEXT_MAX, activePause, buzzFor, eventsOf, holidayEnd, holidaysAhead, holidaysOn, occurrenceKey,
} from '../core/holidays.mjs';
import { goingWith, goingLine } from '../core/invites.mjs';
import { isDay } from '../core/state.mjs';
import {
  fill, formatDate, plural, extraLabels, el, runAction, call, renderPanel,
} from './common.js';

export function holidaysView(state, preset) {
  const X = extraLabels(preset);
  const day = state && state.calendar && state.calendar.day;
  if (!day) return [];
  const forms = Array.isArray(X.holidayDayForms) ? X.holidayDayForms : [];
  const now = holidaysOn(preset, day, state).map((h) => ({
    id: h.id,
    name: h.name,
    about: h.about,
    note: h.today || '',
    whenLine: X.holidayNowLine,
    offLine: h.off ? (h.open ? fill(X.pauseOpen, { from: dayMonth(h.from) }) : fill(X.holidayOffUntil, { date: formatDate(holidayEnd(h, day), 'gen') })) : '',
    days: 0,
    own: h.dated,
    off: h.off,
    going: goingOf(state, preset, h, day),
  }));
  const ahead = holidaysAhead(preset, day, 14, state).map((a) => ({
    id: a.holiday.id,
    name: a.holiday.name,
    about: a.holiday.about,
    note: a.days <= a.holiday.lead ? buzzFor(a.holiday, a.days) : '',
    whenLine: a.days === 1 ? X.holidayTomorrow : fill(X.holidayInDays, {
      n: a.days, days: plural(a.days, forms[0], forms[1], forms[2]), date: formatDate(a.day, 'short'),
    }),
    offLine: a.holiday.off ? X.holidayOffMark : '',
    days: a.days,
    own: a.holiday.dated,
    off: a.holiday.off,
    going: goingOf(state, preset, a.holiday, a.day),
  }));
  return [...now, ...ahead].slice(0, 3);
}

function goingOf(state, preset, h, day) {
  const who = goingWith(state, occurrenceKey(h, day));
  return who ? goingLine(preset, who) : '';
}

export function ownEventsView(state, preset = null) {
  return eventsOf(state)
    .slice()
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    .map((e) => ({
      id: e.id,
      name: e.name,
      dateLine: e.open ? fill(extraLabels(preset).pauseOpen, { from: dayMonth(e.from) })
        : e.to !== e.from ? `${formatDate(e.from)} — ${formatDate(e.to)}` : formatDate(e.from),
      hook: e.hook,
      off: e.off,
      auto: e.auto === true,
      past: Boolean(state && state.calendar && state.calendar.day > e.to),
    }));
}

function dayMonth(day) {
  return formatDate(day).replace(/^[^,]*,\s*/, '');
}

function pauseRange(e, X) {
  if (e.open) return fill(X.pauseOpen, { from: dayMonth(e.from) });
  const a = dayMonth(e.from);
  if (e.to === e.from) return a;
  const b = dayMonth(e.to);
  const [d1, month1] = a.split(' ');
  const month2 = b.split(' ').slice(1).join(' ');
  return month1 === month2 ? `${d1}–${b}` : `${a} – ${b}`;
}

export function pauseView(state, preset) {
  const day = state && state.calendar && state.calendar.day;
  const cur = activePause(state, day);
  if (!cur) return null;
  const open = cur.open === true && !isDay(cur.to);
  const e = { from: cur.from, to: isDay(cur.to) ? cur.to : cur.from, open };
  const X = extraLabels(preset);
  return {
    id: cur.id,
    name: cur.name,
    line: `${X.pauseTitle}: ${pauseRange(e, X)}`,
    from: cur.from,
    to: open ? '' : e.to,
    open,
  };
}

export function pauseBlock(host, pause, X) {
  const status = el('div', { class: 'academy-status' });
  const from = el('input', { type: 'date', class: 'text_pole academy-input', value: pause.from });
  const to = el('input', { type: 'date', class: 'text_pole academy-input', value: pause.to || '' });
  const open = el('input', { type: 'checkbox' });
  open.checked = pause.open;
  const editor = el('div', { class: 'academy-repair-body', style: 'display: none' }, [
    el('div', { class: 'academy-row' }, [
      el('label', { class: 'academy-field' }, [el('span', { text: X.eventFrom }), from]),
      el('label', { class: 'academy-field' }, [el('span', { text: X.eventTo }), to]),
    ]),
    el('label', { class: 'academy-check' }, [open, el('span', { text: X.pauseUntilCancelled })]),
    el('div', {
      class: 'menu_button academy-btn',
      text: X.pauseSave,
      onclick: (ev) => runAction(ev.currentTarget, status, () => call(host, 'updateEvent', pause.id, {
        from: from.value || undefined,
        to: to.value || undefined,
        open: Boolean(open.checked),
      }), X.pauseSaved).then((res) => { if (res && res.ok) renderPanel(host); }),
    }),
  ]);
  return el('div', { class: 'academy-card academy-pause', dataset: { pause: pause.id } }, [
    el('div', { class: 'academy-card-title', text: pause.line }),
    pause.name ? el('p', { class: 'academy-note', text: pause.name }) : null,
    el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn',
        text: X.pauseCancel,
        onclick: (ev) => runAction(ev.currentTarget, status, () => call(host, 'removeEvent', pause.id), X.pauseCancelled)
          .then(() => renderPanel(host)),
      }),
      el('div', {
        class: 'menu_button academy-btn',
        text: X.pauseEdit,
        onclick: () => { editor.style.display = editor.style.display === 'none' ? '' : 'none'; },
      }),
    ]),
    editor,
    status,
  ]);
}

export function ownEventsBlock(host, view, X) {
  const status = el('div', { class: 'academy-status' });
  const max = EVENT_TEXT_MAX;
  const name = el('input', { type: 'text', class: 'text_pole academy-input', maxlength: String(max.name), placeholder: X.eventNamePlaceholder });
  const from = el('input', { type: 'date', class: 'text_pole academy-input', value: view.day || '' });
  const to = el('input', { type: 'date', class: 'text_pole academy-input' });
  const buzz = el('input', { type: 'text', class: 'text_pole academy-input', maxlength: String(max.buzz), placeholder: X.eventBuzzPlaceholder });
  const buzzNear = el('input', { type: 'text', class: 'text_pole academy-input', maxlength: String(max.buzzNear), placeholder: X.eventBuzzNearPlaceholder });
  const hook = el('textarea', { class: 'text_pole academy-input', rows: '2', maxlength: String(max.hook), placeholder: X.eventHookPlaceholder });
  const off = el('input', { type: 'checkbox' });

  const list = view.ownEvents || [];
  const items = list.length
    ? el('div', { class: 'academy-own-events' }, [
      el('div', { class: 'academy-card-title', text: X.eventsListTitle }),
      el('ul', { class: 'academy-milestone-list' }, list.map((e) => el('li', {
        class: e.past ? 'academy-holiday academy-event-past' : 'academy-holiday',
        dataset: { event: e.id },
      }, [
        el('span', { class: 'academy-ach-text' }, [
          el('span', { class: 'academy-milestone-name', text: e.name }),
          el('span', {
            class: 'academy-ach-hint',
            text: [e.dateLine, e.off ? X.holidayOffMark : '', e.auto ? X.eventAuto : '', e.past ? X.eventPast : ''].filter(Boolean).join(' · '),
          }),
        ]),
        el('div', {
          class: 'menu_button academy-btn',
          text: X.eventRemove,
          onclick: (ev) => runAction(ev.currentTarget, status, () => call(host, 'removeEvent', e.id), X.eventRemoved)
            .then(() => renderPanel(host)),
        }),
      ]))),
    ])
    : null;

  return el('details', { class: 'academy-repair academy-events-form' }, [
    el('summary', { text: X.eventsSummary }),
    el('div', { class: 'academy-repair-body' }, [
      el('p', { class: 'academy-note', text: X.eventsNote }),
      items,
      el('label', { class: 'academy-field' }, [el('span', { text: X.eventName }), name]),
      el('div', { class: 'academy-row' }, [
        el('label', { class: 'academy-field' }, [el('span', { text: X.eventFrom }), from]),
        el('label', { class: 'academy-field' }, [el('span', { text: X.eventTo }), to]),
      ]),
      el('label', { class: 'academy-field' }, [el('span', { text: X.eventBuzz }), buzz]),
      el('label', { class: 'academy-field' }, [el('span', { text: X.eventBuzzNear }), buzzNear]),
      el('label', { class: 'academy-field' }, [el('span', { text: X.eventHook }), hook]),
      el('label', { class: 'academy-check' }, [off, el('span', { text: X.eventOff })]),
      el('div', { class: 'academy-row academy-row-buttons' }, [
        el('div', {
          class: 'menu_button academy-btn',
          text: X.eventAdd,
          onclick: (ev) => runAction(ev.currentTarget, status, () => call(host, 'addEvent', {
            name: name.value,
            from: from.value,
            to: to.value || undefined,
            buzz: buzz.value,
            buzzNear: buzzNear.value,
            hook: hook.value,
            off: Boolean(off.checked),
          }), X.eventAdded).then((res) => { if (res && res.ok) renderPanel(host); }),
        }),
      ]),
      status,
    ]),
  ]);
}

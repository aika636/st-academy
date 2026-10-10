// ui/holidays.js — праздники и свои события: что показать (`holidaysView`,
// `ownEventsView`) и чем показать (блоки на вкладке «Сегодня»).

import {
  EVENT_TEXT_MAX, eventsOf, holidayEnd, holidaysAhead, holidaysOn,
} from '../core/holidays.mjs';
import {
  fill, formatDate, plural, extraLabels, el, runAction, call, renderPanel, hintIcon,
} from './common.js';

/**
 * Праздники для «Сегодня»: что идёт сегодня и что впереди в пределах двух
 * недель, не больше трёх строк. В промпт уходит меньше (`prompt.mjs`,
 * `holidaySegment`): там фон по `lead` праздника, здесь — календарь для глаз.
 */
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
    // Каникулы сегодня — когда кончатся: «занятий нет до среды, 6 мая».
    offLine: h.off ? fill(X.holidayOffUntil, { date: formatDate(holidayEnd(h, day), 'gen') }) : '',
    days: 0,
    own: h.dated,
    off: h.off,
  }));
  const ahead = holidaysAhead(preset, day, 14, state).map((a) => ({
    id: a.holiday.id,
    name: a.holiday.name,
    about: a.holiday.about,
    note: a.days <= a.holiday.lead ? a.holiday.buzz : '',
    whenLine: a.days === 1 ? X.holidayTomorrow : fill(X.holidayInDays, {
      n: a.days, days: plural(a.days, forms[0], forms[1], forms[2]), date: formatDate(a.day, 'short'),
    }),
    offLine: a.holiday.off ? X.holidayOffMark : '',
    days: a.days,
    own: a.holiday.dated,
    off: a.holiday.off,
  }));
  return [...now, ...ahead].slice(0, 3);
}

/**
 * Свои события чата для списка под блоком праздников: все, какие есть, от
 * ближних к дальним, с датой словами — чтобы их можно было и увидеть, и убрать,
 * даже если до них больше двух недель.
 */
export function ownEventsView(state) {
  return eventsOf(state)
    .slice()
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))
    .map((e) => ({
      id: e.id,
      name: e.name,
      dateLine: e.to !== e.from ? `${formatDate(e.from)} — ${formatDate(e.to)}` : formatDate(e.from),
      hook: e.hook,
      off: e.off,
      past: Boolean(state && state.calendar && state.calendar.day > e.to),
    }));
}

/**
 * Свои события чата: список с кнопкой «убрать» и форма добавления, свёрнутые
 * в один блок — на «Сегодня» главное расписание, а не форма.
 */
export function ownEventsBlock(host, view, X) {
  const status = el('div', { class: 'academy-status' });
  const max = EVENT_TEXT_MAX;
  const name = el('input', { type: 'text', class: 'text_pole academy-input', maxlength: String(max.name), placeholder: X.eventNamePlaceholder });
  const from = el('input', { type: 'date', class: 'text_pole academy-input', value: view.day || '' });
  const to = el('input', { type: 'date', class: 'text_pole academy-input' });
  const buzz = el('input', { type: 'text', class: 'text_pole academy-input', maxlength: String(max.buzz), placeholder: X.eventBuzzPlaceholder });
  const hook = el('textarea', { class: 'text_pole academy-input', rows: '2', maxlength: String(max.hook), placeholder: X.eventHookPlaceholder });
  const off = el('input', { type: 'checkbox' });

  const list = view.ownEvents || [];
  const items = list.length
    ? el('div', { class: 'academy-own-events' }, [
      el('div', { class: 'academy-card-title', text: X.eventsListTitle }),
      el('ul', { class: 'academy-milestone-list' }, list.map((e) => el('li', {
        class: e.past ? 'academy-holiday academy-ach-locked' : 'academy-holiday',
        dataset: { event: e.id },
      }, [
        el('span', { class: 'academy-ach-text' }, [
          el('span', { class: 'academy-milestone-name', text: e.name }),
          el('span', {
            class: 'academy-ach-hint',
            text: [e.dateLine, e.off ? X.holidayOffMark : '', e.past ? X.eventPast : ''].filter(Boolean).join(' · '),
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
            hook: hook.value,
            off: Boolean(off.checked),
          }), X.eventAdded).then((res) => { if (res && res.ok) renderPanel(host); }),
        }),
      ]),
      status,
    ]),
  ]);
}

/**
 * Блок «Праздники и события» на «Сегодня»: пусто — блока нет. Строка — столбик:
 * название (своё событие — со значком ✎), под ним когда, «занятий нет» и фон.
 * Справа от названия дата не стоит: на 390 пикселях длинная дата сжимала
 * название до буквы в строку.
 */
export function holidaysBlock(list, X, preset = null) {
  if (!list || !list.length) return null;
  return el('div', { class: 'academy-holidays' }, [
    el('div', { class: 'academy-card-title', text: X.holidaysTitle }),
    el('ul', { class: 'academy-milestone-list' }, list.map((h) => el('li', {
      class: h.days === 0 ? 'academy-holiday academy-holiday-now' : 'academy-holiday',
      dataset: { holiday: h.id },
    }, [
      el('span', { class: 'academy-ach-text' }, [
        el('span', { class: 'academy-holiday-head' }, [
          el('span', { class: 'academy-milestone-name', text: h.name }),
          hintIcon(preset, h.name),
          h.own ? el('span', { class: 'academy-holiday-own', title: X.holidayOwnTitle, 'aria-label': X.holidayOwnTitle, text: X.holidayOwnMark }) : null,
        ]),
        el('span', { class: 'academy-shift-day', text: h.whenLine }),
        h.offLine ? el('span', { class: 'academy-shift-day', text: h.offLine }) : null,
        h.note || h.about ? el('span', { class: 'academy-ach-hint', text: h.note || h.about }) : null,
      ]),
    ]))),
  ]);
}

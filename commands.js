import { DEBUG_TEXT, debugView, fill, gradebookView, stateHealth, todayView, uiLabels } from './ui.js';
import { stripSecrets } from './storage.js';
import { joinSentences } from './core/state.mjs';

const ctx = () => SillyTavern.getContext();

const served = new WeakSet();

function blocked(host) {
  const preset = host.getPreset();
  if (!preset) return 'Академия не поднялась: пресет не загружен, расширение молчит.';
  const health = stateHealth(host.getState(), preset);
  if (health.kind === 'ok') return null;
  const tail = health.errors && health.errors.length ? `\n${health.errors.map((e) => `— ${e}`).join('\n')}` : '';
  return `${joinSentences([health.title, health.text])}${tail}`;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export function showResult(context, title, text) {
  const out = String(text || '').trim();
  if (!out) return false;
  try {
    if (context && typeof context.callGenericPopup === 'function') {
      const html = `<h3>${escapeHtml(title)}</h3><div style="white-space: pre-wrap; text-align: left;">${escapeHtml(out)}</div>`;
      const type = context.POPUP_TYPE ? context.POPUP_TYPE.TEXT : 1;
      Promise.resolve(context.callGenericPopup(html, type, '', { wide: true, allowVerticalScrolling: true }))
        .catch((err) => console.warn('[academy] окошко команды не показалось:', err));
      return true;
    }
    if (typeof toastr !== 'undefined' && toastr && typeof toastr.info === 'function') {
      toastr.info(escapeHtml(out).replace(/\n/g, '<br>'), title, { escapeHtml: false, timeOut: 20000, extendedTimeOut: 20000 });
      return true;
    }
  } catch (err) {
    console.warn('[academy] результат команды не показан:', err);
  }
  return false;
}

function guard(name, fn, context, title) {
  return async (namedArgs, unnamedArg) => {
    const args = namedArgs || {};
    let out;
    try {
      const res = await fn(args, unnamedArg);
      out = typeof res === 'string' ? res : String(res ?? '');
    } catch (err) {
      console.error(`[academy] /${name} сорвалась:`, err);
      out = `/${name}: команда сорвалась — ${(err && err.message) || err}`;
    }
    if (!yes(args.quiet)) showResult(context, title || `/${name}`, out);
    return out;
  };
}

const lines = (list) => list.filter((s) => s !== null && s !== undefined && s !== '').join('\n');

export function statusText(host) {
  const stop = blocked(host);
  if (stop) return stop;

  const preset = host.getPreset();
  const state = host.getState();
  const U = uiLabels(preset);
  const today = todayView(state, preset);
  const book = gradebookView(state, preset);

  const head = [today.dateLine, today.time, today.weekLine, today.termLine, today.phaseLabel]
    .filter(Boolean).join(' · ');

  const now = today.silent
    ? today.silentReason
    : (today.now ? `${today.now.title}: ${today.now.name}${today.now.teacher ? ` (${today.now.teacher})` : ''}`
      + `${today.now.start ? `, ${today.now.start}` : ''}` : null);

  const plan = today.plan.length
    ? [U.cmdPlanTitle, ...today.plan.map((p) => `  ${p.ordinal}. ${p.name}`
      + `${p.start ? ` — ${p.start}${p.end ? `–${p.end}` : ''}` : ''}`
      + `${p.teacher ? `, ${p.teacher}` : ''}${p.current ? '  ←' : ''}`)].join('\n')
    : U.cmdNoPlan;

  return lines([
    head,
    now,
    today.next && (today.silent || !today.next.sameDay)
      ? fill(U.cmdNext, { name: today.next.name, when: today.next.when }) : null,
    plan,
    book.kind === 'ok' && Number.isFinite(book.overall) ? `${book.scoreName}: ${book.overallText}` : null,
    book.kind === 'ok' && book.debts.length ? `${U.debtsTitle}: ${book.debts.join(', ')}` : null,
    today.timeMark,
  ]);
}

export function gradesText(host) {
  const stop = blocked(host);
  if (stop) return stop;

  const preset = host.getPreset();
  const U = uiLabels(preset);
  const view = gradebookView(host.getState(), preset);
  if (view.kind !== 'ok') return joinSentences([view.title, view.text]);

  const rows = view.subjects.length
    ? view.subjects.map((s) => {
      const marks = s.grades.length ? s.grades.join(' ') : '—';
      const extra = [
        s.averageText && s.grades.length ? fill(U.cmdAverage, { value: s.averageText }) : null,
        s.debt ? [U.debtTag, s.debtReason].filter(Boolean).join(': ') : null,
        s.passed ? U.passedTag : null,
        s.teacher ? `${s.teacher}${s.relation ? `, ${s.relation}` : ''}` : null,
      ].filter(Boolean).join('; ');
      return `${s.name}: ${marks}${extra ? ` (${extra})` : ''}`;
    })
    : [U.cmdNoSubjects];

  return lines([
    Number.isFinite(view.overall) ? `${view.scoreName}: ${view.overallText}` : U.scoreNoneLine,
    `${U.reputationTitle}: ${view.reputation}`,
    view.expelled ? U.expelledLine : (view.warned ? U.warnedLine : null),
    '',
    ...rows,
    view.debts.length ? `\n${U.debtsTitle}: ${view.debts.join(', ')}` : null,
    view.openExams.length
      ? `${U.openExamsTitle}${view.examsTermLine ? ` (${view.examsTermLine})` : ''}: `
        + view.openExams.map((e) => `${e.subject} (${e.kind}${e.day ? `, ${e.day}` : ''})`).join(', ')
      : null,
  ]);
}

export async function timeText(host, args = {}) {
  const stop = blocked(host);
  if (stop) return stop;

  const day = str(args.day);
  const time = str(args.time);
  const days = num(args.days);
  const periods = num(args.periods);
  const count = yes(args.count);

  if (args.days !== undefined && args.days !== '' && days === null) return '/academy-time: days — целое число.';
  if (args.periods !== undefined && args.periods !== '' && periods === null) return '/academy-time: periods — целое число.';
  if (days !== null && periods !== null) return uiLabels(host.getPreset()).cmdBothUnits;

  const patch = {};
  if (day) patch.day = day;
  if (time) patch.time = time;
  if (days !== null) patch.shift = { days };
  else if (periods !== null) patch.shift = { periods };
  if (count) patch.count = true;

  if (!Object.keys(patch).length) {
    const day = (host.getState() && host.getState().calendar && host.getState().calendar.day) || 'ГГГГ-ММ-ДД';
    const U = uiLabels(host.getPreset());
    return lines([
      whenText(host),
      'Как двигать календарь:',
      `  day=${day} — перейти на эту дату`,
      '  time=10:30 — поставить это время',
      '  days=1 — сдвинуть на столько дней (назад — со знаком минус)',
      `  periods=-2 — ${U.cmdShiftPeriods}`,
      `  count=yes — ${U.cmdCountArg || 'зачесть пропущенное прогулами'}`,
    ]);
  }

  const res = await host.actions.manualTime(patch);
  if (!res || !res.ok) return `Календарь не сдвинулся: ${(res && res.error) || 'причина не названа'}.`;

  const U = uiLabels(host.getPreset());
  return lines([
    whenText(host),
    res.counted ? fill(U.cmdCounted, { count: res.counted }) : null,
    res.wouldCount ? fill(U.cmdNotCounted, { count: res.wouldCount }) : null,
    res.reputation ? fill(U.cmdReputationMoved, { from: res.reputation.from, to: res.reputation.to }) : null,
  ]);
}

function whenText(host) {
  const view = todayView(host.getState(), host.getPreset());
  if (view.kind !== 'ok') return joinSentences([view.title, view.text]);
  return [view.dateLine, view.time, view.weekLine, view.termLine, view.phaseLabel]
    .filter(Boolean).join(' · ');
}

export function stateJson(host) {
  const state = host.getState();
  if (!state || typeof state !== 'object') {
    const report = host.getReport && host.getReport();
    if (report && report.errors && report.errors.length) {
      return JSON.stringify({ started: false, status: report.status, errors: report.errors }, null, 2);
    }
    return JSON.stringify({ started: false, status: (report && report.status) || 'empty' }, null, 2);
  }
  try {
    return JSON.stringify(stripSecrets(state), null, 2);
  } catch (err) {
    return `/academy-state: состояние не сериализуется — ${(err && err.message) || err}`;
  }
}

export function debugText(host) {
  const run = host.getDebug && host.getDebug();
  if (!run) return DEBUG_TEXT.noRun;

  const preset = (host.getPreset && host.getPreset()) || {};
  const state = host.getState ? host.getState() : null;
  const T = DEBUG_TEXT;
  const view = debugView(run, state, preset, { debug: true });
  const block = (title, items) => (items.length ? [`${title}:`, ...items.map((s) => `  — ${s}`)].join('\n') : null);

  return lines([
    view.head,
    [view.source, view.stalled].filter(Boolean).join(' '),
    view.marker,
    view.applied.length ? block(T.appliedTitle, view.applied) : T.noApplied,
    block(T.rejectedTitle, view.rejected),
    block(T.notesTitle, view.notes),
    view.permission ? `${T.permissionTitle}: ${view.permission}` : null,
    view.injects.length ? block(T.injectsTitle, view.injects) : T.noInjects,
    block(T.divergenceTitle, view.divergences.map((d) => d.text)),
  ]);
}

export async function undoText(host) {
  const stop = blocked(host);
  if (stop) return stop;
  const res = await host.actions.undoReply();
  return res && res.ok ? res.text : `Не отменено: ${(res && res.error) || 'причина не названа'}`;
}

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

const yes = (v) => ['yes', 'y', 'true', '1', 'да'].includes(str(v).toLowerCase());

function num(v) {
  const s = str(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function liveWords(cmd, words, labels) {
  const bind = (target, field, key) => {
    try {
      Object.defineProperty(target, field, { configurable: true, enumerable: true, get: () => labels()[key] });
    } catch {}
  };
  for (const [name, key] of Object.entries(words)) {
    if (name === 'helpString' || name === 'returns') bind(cmd, name, key);
    else bind((cmd.namedArgumentList || []).find((a) => a && a.name === name) || {}, 'description', key);
  }
}

export function registerCommands(host, context) {
  const c = context || (typeof SillyTavern !== 'undefined' ? ctx() : null);
  const P = c && c.SlashCommandParser;
  const SC = c && c.SlashCommand;
  if (!P || typeof P.addCommandObject !== 'function' || !SC || typeof SC.fromProps !== 'function') return [];
  if (served.has(P)) return [];
  served.add(P);

  const labels = () => uiLabels(typeof host.getPreset === 'function' ? host.getPreset() : null);
  const U = labels();
  const NA = c.SlashCommandNamedArgument;
  const T = c.ARGUMENT_TYPE || { STRING: 'string', NUMBER: 'number' };

  const named = (name, description, typeList) => (NA && typeof NA.fromProps === 'function'
    ? NA.fromProps({ name, description, typeList, isRequired: false })
    : null);

  const quiet = () => named('quiet', 'yes — не показывать окошко, только вернуть текст в пайп', [T.STRING]);
  const defs = [
    {
      name: 'academy',
      aliases: ['academy-status'],
      returns: U.cmdStatusReturns,
      helpString: U.cmdStatusHelp,
      words: { helpString: 'cmdStatusHelp', returns: 'cmdStatusReturns' },
      namedArgumentList: [quiet()].filter(Boolean),
      callback: guard('academy', () => statusText(host), c, '/academy'),
    },
    {
      name: 'academy-grades',
      returns: U.cmdGradesReturns,
      helpString: U.cmdGradesHelp,
      words: { helpString: 'cmdGradesHelp', returns: 'cmdGradesReturns' },
      namedArgumentList: [quiet()].filter(Boolean),
      callback: guard('academy-grades', () => gradesText(host), c, '/academy-grades'),
    },
    {
      name: 'academy-time',
      returns: 'новая точка календаря или причина отказа',
      helpString: U.cmdTimeHelp,
      words: { helpString: 'cmdTimeHelp', periods: 'cmdShiftPeriods', count: 'cmdCountArg' },
      namedArgumentList: [
        named('day', 'абсолютная дата, ГГГГ-ММ-ДД', [T.STRING]),
        named('time', 'абсолютное время, ЧЧ:ММ', [T.STRING]),
        named('days', 'сдвиг в днях, можно отрицательный', [T.NUMBER]),
        named('periods', U.cmdShiftPeriods, [T.NUMBER]),
        named('count', U.cmdCountArg, [T.STRING]),
        quiet(),
      ].filter(Boolean),
      callback: guard('academy-time', (args) => timeText(host, args), c, '/academy-time'),
    },
    {
      name: 'academy-state',
      returns: U.cmdStateReturns,
      helpString: U.cmdStateHelp,
      words: { helpString: 'cmdStateHelp', returns: 'cmdStateReturns' },
      namedArgumentList: [quiet()].filter(Boolean),
      callback: guard('academy-state', () => stateJson(host), c, '/academy-state'),
    },
    {
      name: 'academy-undo',
      returns: 'что отменено или причина отказа',
      helpString: 'Отменить последний ответ модели: состояние Академии вернётся к тому, что было до него. Заметки, роли и настройки не трогаются. Один шаг.',
      namedArgumentList: [quiet()].filter(Boolean),
      callback: guard('academy-undo', () => undoText(host), c, '/academy-undo'),
    },
    {
      name: 'academy-debug',
      returns: 'разбор последнего ответа модели',
      helpString: 'Последний разбор: что разобрано, из какого источника взято время и что ушло в инжекты.',
      namedArgumentList: [quiet()].filter(Boolean),
      callback: guard('academy-debug', () => debugText(host), c, '/academy-debug'),
    },
  ];

  const done = [];
  for (const def of defs) {
    try {
      const { words, ...props } = def;
      const cmd = SC.fromProps(props);
      P.addCommandObject(cmd);
      if (words) liveWords(cmd, words, labels);
      done.push(def.name);
    } catch (err) {
      console.error(`[academy] команда /${def.name} не зарегистрирована:`, err);
    }
  }
  return done;
}

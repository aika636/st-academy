// commands.js — слэш-команды академии.
//
// Четыре решения, из которых вытекает файл.
//
// 1. **Свои числа, свои склонения и свои слова здесь не считаются.** Всё, что
//    уходит в чат, берётся из чистых вью `ui.js` (`todayView`, `gradebookView`,
//    `stateHealth`), а лексика заведения — из `uiLabels(preset)`, того же
//    словаря, которым говорит панель: иначе панель и команда рано или поздно
//    назовут разные даты — или, хуже, «пары» там, где в игре «уроки». Эти вью
//    DOM не трогают, поэтому импортируются прямо, а не через `mountPanel`.
//
// 2. **Ни одна команда не бросает исключение.** Слэш-команда исполняется внутри
//    конвейера таверны: брошенное отсюда исключение рвёт весь скрипт
//    пользовательницы, а не только нашу строчку. Нет семестра, нет пресета,
//    состояние повреждено — это внятная строка, и она же ответ команды.
//
// 3. **Ключ API наружу не идёт ни при каких условиях.** `/academy-state` печатает
//    состояние тем же срезом, каким `storage.saveState` пишет в метаданные
//    (`stripSecrets`), а `/academy-debug` печатает разбор по полям и никогда —
//    состояние или настройки целиком. Вывод команды попадает в чат, то есть в
//    файл чата и в промпт; это опаснее метаданных, а не безопаснее.
//
// 4. **Регистрация обязана случиться ровно один раз за загрузку страницы.**
//    `SlashCommandParser.addCommandObjectUnsafe` на повторе пишет
//    `console.trace('WARN: Duplicate slash command registered!')`
//    (`slash-commands/SlashCommandParser.js:79-81`). Сторож привязан к самому
//    парсеру (`WeakSet`), а не к модулю: модуль может быть загружен дважды
//    (cache-busting в прогонах, две копии расширения), парсер в живой таверне —
//    один.
//
// Всё берётся из `getContext()` (`st-context.js:164-169`): статический импорт
// `../../../slash-commands/*` завязывает файл на путь установки и не резолвится
// вне браузера.

import { DEBUG_TEXT, describeApplied, fill, gradebookView, stateHealth, todayView, uiLabels } from './ui.js';
import { stripSecrets } from './storage.js';
import { joinSentences } from './core/state.mjs';

const ctx = () => SillyTavern.getContext();

/** Откуда пришло время в последнем разборе. Те же слова, что в панели. */
const SOURCE_LABEL = { A: 'из контекста', B: 'метка', manual: 'вручную' };

/** Парсеры, которым команды уже отданы. Не модуль-флаг: см. решение 4 в шапке. */
const served = new WeakSet();

/* ========================================================================== *
 *  Общее
 * ========================================================================== */

/**
 * Ворота в начало каждой команды: строка-объяснение вместо семестра, либо
 * `null`, если показывать есть что. Текст и здесь чужой — тот же, что панель
 * показывает на пустом экране.
 */
function blocked(host) {
  const preset = host.getPreset();
  if (!preset) return 'Академия не поднялась: пресет не загружен, расширение молчит.';
  const health = stateHealth(host.getState(), preset);
  if (health.kind === 'ok') return null;
  const tail = health.errors && health.errors.length ? `\n${health.errors.map((e) => `— ${e}`).join('\n')}` : '';
  // Та же склейка, что в `index.js`: кусок после точки может прийти со
  // строчной буквы, и шаблон это молча пропускал.
  return `${joinSentences([health.title, health.text])}${tail}`;
}

/**
 * Обёртка вокруг тела команды. Исключение отсюда порвало бы конвейер таверны
 * целиком (решение 2), поэтому наружу уходит только строка.
 */
function guard(name, fn) {
  return async (namedArgs, unnamedArg) => {
    try {
      const out = await fn(namedArgs || {}, unnamedArg);
      return typeof out === 'string' ? out : String(out ?? '');
    } catch (err) {
      console.error(`[academy] /${name} сорвалась:`, err);
      return `/${name}: команда сорвалась — ${(err && err.message) || err}`;
    }
  };
}

const lines = (list) => list.filter((s) => s !== null && s !== undefined && s !== '').join('\n');

/* ========================================================================== *
 *  Тела команд. Чистые относительно таверны: только хост и вью.
 * ========================================================================== */

/** `/academy` — сводка «сегодня»: дата, неделя, пары дня, балл. */
export function statusText(host) {
  const stop = blocked(host);
  if (stop) return stop;

  const preset = host.getPreset();
  const state = host.getState();
  const U = uiLabels(preset);
  const today = todayView(state, preset);
  const book = gradebookView(state, preset);

  // Имя учебного периода стоит рядом с неделей по той же причине, что и на
  // вкладке «Сегодня»: без него непонятно, почему счёт недель пошёл заново. У
  // пресета с одним периодом строка пустая и в сводку не попадает.
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
    // «Дальше» опускается ровно тогда, когда строка выше уже про ту же пару:
    // `todayView` в этом случае сама подписывает её «Перемена, дальше».
    today.next && (today.silent || !today.next.sameDay)
      ? fill(U.cmdNext, { name: today.next.name, when: today.next.when }) : null,
    plan,
    book.kind === 'ok' ? `${book.scoreName}: ${book.overallText}` : null,
    book.kind === 'ok' && book.debts.length ? `${U.debtsTitle}: ${book.debts.join(', ')}` : null,
    today.timeMark,
  ]);
}

/** `/academy-grades` — зачётка текстом. */
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
        s.debt ? U.debtTag : null,
        s.passed ? U.passedTag : null,
        s.teacher ? `${s.teacher}${s.relation ? `, ${s.relation}` : ''}` : null,
      ].filter(Boolean).join('; ');
      return `${s.name}: ${marks}${extra ? ` (${extra})` : ''}`;
    })
    : [U.cmdNoSubjects];

  return lines([
    `${view.scoreName}: ${view.overallText}`,
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

/**
 * `/academy-time` — ручной сдвиг календаря.
 *
 * Словарь здесь человеческий (`days`, `periods`), а перевод в `{unit, n}` живёт
 * в `index.js` — тот самый шов, на котором этап 2 один раз разошёлся, поэтому
 * форма списана с `host.actions.manualTime`, а не придумана заново.
 */
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
    // День в примере — сегодняшний день **календаря**, а не выдуманный и не
    // системный: выдуманный уводил в чужой год (живьём — 2024-й при календаре
    // 2026-го), а откат назад расширение блокирует правилом 3.2, и человек
    // получал отказ, причина которого из подсказки не видна. Сюда мы попадаем
    // только на начатом семестре — `blocked()` выше не пускает дальше ни
    // пустое, ни битое состояние, — поэтому день есть. Пустая форма остаётся
    // страховкой на случай состояния без даты: соврать она не может.
    const day = (host.getState() && host.getState().calendar && host.getState().calendar.day) || 'ГГГГ-ММ-ДД';
    return `${whenText(host)}\nЧто двигать: day=${day}, time=10:30, days=1, periods=-2, count=yes.`;
  }

  const res = await host.actions.manualTime(patch);
  if (!res || !res.ok) return `Календарь не сдвинулся: ${(res && res.error) || 'причина не названа'}.`;

  // Про посещаемость говорим всегда, а не только когда её попросили считать:
  // молчание здесь и было дефектом — человек двигал время и не догадывался, что
  // прогулы, репутация и отношения при этом не наступают вовсе.
  const U = uiLabels(host.getPreset());
  return lines([
    whenText(host),
    res.missed ? fill(U.cmdCounted, { count: res.missed }) : null,
    res.wouldMiss ? fill(U.cmdNotCounted, { count: res.wouldMiss }) : null,
    res.reputation ? fill(U.cmdReputationMoved, { from: res.reputation.from, to: res.reputation.to }) : null,
  ]);
}

/** Где сейчас календарь — одной строкой, словами панели. */
function whenText(host) {
  const view = todayView(host.getState(), host.getPreset());
  if (view.kind !== 'ok') return joinSentences([view.title, view.text]);
  return [view.dateLine, view.time, view.weekLine, view.termLine, view.phaseLabel]
    .filter(Boolean).join(' · ');
}

/**
 * `/academy-state` — состояние семестра как JSON, для авторов карточек и
 * JS-Slash-Runner.
 *
 * Срез — тот же `stripSecrets`, через который состояние проходит перед каждой
 * записью в метаданные (`storage.js`). Ключ API лежит в `extension_settings` и в
 * состоянии оказаться не должен вовсе; срез здесь — не украшение, а второй
 * замок: вывод команды уходит в чат, а чаты пересылают.
 */
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

/**
 * `/academy-debug` — последний прогон человекочитаемо.
 *
 * Печатаются только поля разбора. Состояние и настройки сюда не попадают
 * намеренно: отладка не повод отправить в чат содержимое `extension_settings`.
 */
export function debugText(host) {
  const run = host.getDebug && host.getDebug();
  if (!run) return 'Разбора ещё не было: ни одного ответа модели в этом чате расширение не считало.';

  const d = run.debug || {};
  // Словарь заведения — из пресета, тем же вызовом, что у вкладки «Отладка»:
  // своя копия здесь печатала «пропущено пар» и «назначена сессия», то есть
  // слова русского вуза в общем коде (см. `ui.js:describeApplied`).
  const vocab = ((host.getPreset && host.getPreset()) || {}).vocab || {};
  const applied = (d.applied || []).map((i) => describeApplied(i, vocab)).filter(Boolean);
  const rejected = (d.rejected || []).map((r) => (typeof r === 'string' ? r : `${r.raw || r.kind || 'кусок'}${r.reason ? ` — ${r.reason}` : ''}`));
  const notes = d.notes || run.notes || [];
  const injects = (run.injects || []).map((i) => (typeof i === 'string' ? i : i.text)).filter(Boolean);

  return lines([
    `Сообщение #${run.mesId} (${run.source || 'received'}), режим времени: ${d.mode || '—'}.`,
    `Источник времени: ${d.source ? (SOURCE_LABEL[d.source] || d.source) : 'не сработал ни один'}`
      + `, время ${d.moved ? 'сдвинулось' : 'осталось на месте'}`
      + `${d.stalled ? `, стоит уже ${d.idle} ответ(ов)` : ''}.`,
    d.marker ? `Метка: ${d.marker}` : 'Метки в ответе не было.',
    applied.length ? ['Применено:', ...applied.map((s) => `  — ${s}`)].join('\n') : 'Применять было нечего.',
    rejected.length ? ['Отвергнуто:', ...rejected.map((s) => `  — ${s}`)].join('\n') : null,
    notes.length ? ['Замечания:', ...notes.map((s) => `  — ${s}`)].join('\n') : null,
    // Заголовок — из словаря отладки, а не своей копией: копия говорила
    // «сессия» и в магической академии (тот же класс бага, что в `describeApplied`).
    run.permission ? `${DEBUG_TEXT.permissionTitle}: ${run.permission}` : null,
    injects.length ? ['В одноразовый инжект ушло:', ...injects.map((s) => `  — ${s}`)].join('\n') : 'Одноразовых инжектов не было.',
  ]);
}

const str = (v) => (v === undefined || v === null ? '' : String(v).trim());

/**
 * Согласие в аргументе команды. Слов пять, и все живые: `yes`, `true`, `1`,
 * `да`, `y`. Всё остальное — «нет», в том числе пустое: ключ, который человек
 * написал, но не заполнил, включать посещаемость не должен.
 */
const yes = (v) => ['yes', 'y', 'true', '1', 'да'].includes(str(v).toLowerCase());

/** Целое из строки аргумента. `null` — «не число», а не «ноль»: ноль осмыслен. */
function num(v) {
  const s = str(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/* ========================================================================== *
 *  Регистрация
 * ========================================================================== */

/**
 * Отдать команды таверне.
 *
 * @param {Object} host — тот же хост, что получает панель (`index.js`).
 * @param {Object} [context] — контекст таверны; по умолчанию `getContext()`.
 * @returns {string[]} имена зарегистрированных команд; пустой массив, если
 *   команд в этой сборке таверны нет или парсер уже обслужен.
 */
export function registerCommands(host, context) {
  const c = context || (typeof SillyTavern !== 'undefined' ? ctx() : null);
  const P = c && c.SlashCommandParser;
  const SC = c && c.SlashCommand;
  // Старая таверна без слэш-команд — не авария: расширение обязано работать и
  // без них, поэтому здесь тихий выход, а не исключение.
  if (!P || typeof P.addCommandObject !== 'function' || !SC || typeof SC.fromProps !== 'function') return [];
  if (served.has(P)) return [];
  served.add(P);

  // Слова справки — тоже лексика заведения: «сдвиг в парах» в магической
  // академии читается как чужой текст. Пресет к моменту регистрации уже загружен
  // (`index.js` регистрирует команды последним), но `uiLabels` переживёт и его
  // отсутствие — тогда возьмутся умолчания.
  const U = uiLabels(typeof host.getPreset === 'function' ? host.getPreset() : null);
  const NA = c.SlashCommandNamedArgument;
  const T = c.ARGUMENT_TYPE || { STRING: 'string', NUMBER: 'number' };

  const named = (name, description, typeList) => (NA && typeof NA.fromProps === 'function'
    ? NA.fromProps({ name, description, typeList, isRequired: false })
    : null);

  const defs = [
    {
      name: 'academy',
      aliases: ['academy-status'],
      returns: U.cmdStatusReturns,
      helpString: U.cmdStatusHelp,
      callback: guard('academy', () => statusText(host)),
    },
    {
      name: 'academy-grades',
      returns: U.cmdGradesReturns,
      helpString: U.cmdGradesHelp,
      callback: guard('academy-grades', () => gradesText(host)),
    },
    {
      name: 'academy-time',
      returns: 'новая точка календаря или причина отказа',
      helpString: U.cmdTimeHelp,
      namedArgumentList: [
        named('day', 'абсолютная дата, ГГГГ-ММ-ДД', [T.STRING]),
        named('time', 'абсолютное время, ЧЧ:ММ', [T.STRING]),
        named('days', 'сдвиг в днях, можно отрицательный', [T.NUMBER]),
        named('periods', U.cmdShiftPeriods, [T.NUMBER]),
        named('count', U.cmdCountArg, [T.STRING]),
      ].filter(Boolean),
      callback: guard('academy-time', (args) => timeText(host, args)),
    },
    {
      name: 'academy-state',
      returns: U.cmdStateReturns,
      helpString: U.cmdStateHelp,
      callback: guard('academy-state', () => stateJson(host)),
    },
    {
      name: 'academy-debug',
      returns: 'разбор последнего ответа модели',
      helpString: 'Последний прогон: что разобрано, из какого источника взято время и что ушло в инжекты.',
      callback: guard('academy-debug', () => debugText(host)),
    },
  ];

  const done = [];
  for (const def of defs) {
    try {
      P.addCommandObject(SC.fromProps(def));
      done.push(def.name);
    } catch (err) {
      console.error(`[academy] команда /${def.name} не зарегистрирована:`, err);
    }
  }
  return done;
}

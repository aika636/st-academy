// prompt — всё, что расширение говорит модели: строка состояния, инструкция про
// метку и одноразовые факты (3.1, 3.3, 3.5).
//
// Модуль чистый: ни DOM, ни таверны, ни состояния внутри себя. На входе —
// состояние и пресет, на выходе — строки. Куда и на какой глубине их вставлять,
// решает `index.js`.
//
// Четыре решения, из которых вытекает файл.
//
// 1. **Строка состояния одна и короткая.** Длинные таблицы модель игнорирует
//    (3.3), поэтому здесь не сводка, а то, что влияет на сцену прямо сейчас:
//    день, текущая пара, хвосты, балл, отношение того преподавателя, который в
//    кадре. Не весь журнал.
//
// 2. **Не больше `preset.limits.maxNumbersInPrompt` чисел.** Это прямое
//    ограничение из build-list — защита от превращения игры в бухгалтерию.
//    Считаются настоящие числа в готовой строке, а не «поля»: `10:15` и `3.4` —
//    по одному числу каждое. Лишнее срезается по приоритету значимости, и
//    порядок здесь же задаёт порядок слов: текущая пара важнее среднего балла.
//
// 3. **Отношения и репутация уходят словом.** «Неприязнь» модель отыгрывает,
//    `-3` — нет (3.3, 3.4). Числа этих шкал наружу не выходят вообще, поэтому в
//    лимит они и не попадают.
//
// 4. **Ни одного русского слова в логике.** Дни недели, шаблоны и связки лежат
//    отдельным блоком данных `DEFAULT_LABELS` и перекрываются `preset.labels`;
//    слова сеттинга («хвосты», «сессия», «средний балл») берутся из
//    `preset.vocab`. Хогвартс меняет пресет, а не этот файл.

import { labelFor } from './core/state.mjs';
import { plural } from './core/plural.mjs';
import { weekIndex, phaseOf, dayOfWeek, termAt } from './core/time.mjs';
import { dayPlan, currentPeriod } from './core/schedule.mjs';
import { debts, overallScore } from './core/gradebook.mjs';
import { relationLabel } from './core/relations.mjs';
import { reputationLabel } from './core/reputation.mjs';
import { examMode, publicView } from './core/exams.mjs';
import { upcomingEvents } from './core/upcoming.mjs';
import { holidayBackground, bare } from './core/holidays.mjs';
import { feedBackground, BACKGROUND_MAX } from './core/feed.mjs';
import { unsaid } from './core/plot.mjs';

/**
 * Слова и шаблоны по умолчанию — ДАННЫЕ, а не логика: каждое поле перекрывается
 * блоком `preset.labels`. Плейсхолдеры `{имя}` подставляются из состояния и из
 * `preset.vocab`, поэтому чужой пресет меняет и лексику, и порядок слов внутри
 * сегмента, не трогая код.
 */
export const DEFAULT_LABELS = {
  /** Дни недели, с понедельника: `time.dayOfWeek` возвращает 1–7. */
  weekdays: ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'],
  /**
   * Фазы семестра, которыми `time.phaseOf` отвечает про день. `break` —
   * промежуток между учебными периодами: у пресета с одним периодом он не
   * возникает никогда, поэтому слово по умолчанию то же, что у каникул.
   */
  phases: {
    study: '', weekend: 'выходной', vacation: 'каникулы', break: 'каникулы', exams: '',
  },

  day: '{weekday}, {week}-я неделя',
  dayOutside: '{weekday}, {phase}',
  dayPhase: '{weekday}, {week}-я неделя, {phase}',

  now: 'сейчас: {subject}{teacher}',
  next: 'скоро: {subject}{teacher}',
  today: 'сегодня: {list}',
  nowMark: '{subject} (сейчас)',
  teacherOf: ' ({teacher})',

  debts: '{debtPlural}: {list}',
  score: '{scoreName}: {value}',
  exams: '{examPeriod}: не сдано {count}, до конца — {days} {daysWord}',
  examsNoDays: '{examPeriod}: не сдано {count}',
  relation: '{teacher}: {label}',
  /** Репутация — с названием шкалы: голое «На грани исключения.» читалось обрывком. */
  reputation: 'репутация: {label}',

  /** Чем сегменты сшиваются в одну строку. */
  glue: '. ',
  end: '.',
  listGlue: ', ',

  /**
   * Ближние события (9.4.4, `core/upcoming.mjs`). «Когда» — словом, без чисел:
   * сегодня, завтра, дальше — день недели с предлогом. Слово дня недели
   * съедало бы позицию из шести, если бы было датой.
   */
  nearToday: 'сегодня',
  nearTomorrow: 'завтра',
  weekdaysOn: ['в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу', 'в воскресенье'],
  nearExam: '{when} — {what}',
  nearExamSubject: '{when} — {what}: {subject}',
  nearAnnounce: '{when} объявят итог: {subject}',
  nearGlue: '; ',

  /**
   * Праздники и мероприятия (`core/holidays.mjs`): фон, а не задание. Когда —
   * словом, как у ближних событий; дальше недели — «скоро». Второй праздник
   * того же дня пристёгивается через «и», без повторного «сегодня».
   */
  holidayNow: 'сегодня {name} — {note}',
  holidayNowBare: 'сегодня {name}',
  holidayAhead: '{when} {name} — {note}',
  holidayAheadBare: '{when} {name}',
  holidayAlso: 'и {name} — {note}',
  holidayAlsoBare: 'и {name}',
  holidaySoon: 'скоро',

  /**
   * Фон потока курса (шаг 4, слой 1): одна короткая фраза, только когда есть
   * свежее. Пометка «факт / слух» обязательна — иначе модель примет сплетню за
   * правду (`nabrosok-odnokursniki.md`, раздел 5).
   */
  // `{crowdIn}` — слово пресета (`vocab.crowdIn`): «на курсе», «в классе»,
  // «во взводе». Слух анонимки — без второго «говорят» и без «Говорят,» в
  // начале самой реплики (`plot.unsaid`).
  feed: '{crowdIn} говорят: {list}',
  feedFact: '{text} (факт)',
  feedRumor: '{text} (слух)',
  feedTalk: '{text} — обсуждают (факт)',
  feedTalkQuote: 'обсуждают: «{text}» (факт)',
  feedGossip: '«{text}» (слух — правда ли, неизвестно)',
  feedGlue: '; ',
};

/** Потолок длины фона потока: строка состояния — не сводка. */
export const FEED_LINE_MAX = 220;

/**
 * Инструкция про метку (3.1). Тоже данные: пресет волен написать свою.
 *
 * **Метка просится первой строкой, а не последней** — вопреки первоначальному
 * тексту 3.1. Причина живая (`etap-live3.md`): конец ответа у человека может
 * быть уже занят соседним расширением-трекером, которое требует своего блока в
 * конце, и модель пишет в конце ровно один блок — чужой. С включённым Horae
 * метка не появилась ни разу за девять ответов, с выключенным — две из трёх.
 * Начало ответа обычно свободно, а невидимость держится на HTML-комментарии, а
 * не на месте в тексте: `parse-marker.MARKER_RE` ищет метку где угодно, поэтому
 * разбор от переезда не меняется. Замер трёх моделей (`tools/probe-marker.mjs`,
 * вариант `first`, 24 ответа) дал 100% попаданий с валидным `t=`.
 *
 * **Отношение просится словом силы, а не числом** (9.3.4): «minor+ или major-»
 * вместо «дельта». Модели калибруют два слова устойчивее, чем числа, и слово
 * дешевле объяснять: знак при нём и так читается как направление. Число
 * `parse-marker` по-прежнему принимает — старые метки в контексте и модели,
 * которые упрямо пишут `-1`, не ломаются. Русские синонимы («сильно-»)
 * принимаются молча и в инструкцию не идут: каждое слово здесь — токены на
 * каждом запросе.
 *
 * **«Первой» — после чужого блока состояния сцены, а не до него** (9.2). Scene
 * State и радио BB просятся первым блоком; метка, поставленная *внутрь* такого
 * блока, ломает его разбор у соседа, а нам позиция не важна (`MARKER_RE`
 * не якорный). Оговорка дешевле, чем спор двух инструкций за первую строку.
 *
 * **Повод у отношения — три слова, а не абзац** (9.7B): «(:повод)»
 * (`rel=petrova:major-:сорван зачёт`; скобки, если модель их скопирует,
 * разбор снимает). Повод механика и так видит по событиям
 * того же ответа (оценка, прогул, экзамен — `engine.relReason`); слова модели
 * нужны там, где механика слепа: помогла с опытом, нагрубила в коридоре.
 * Потолок инструкции — 400 знаков, и он держится тестом.
 */
export const DEFAULT_PROMPTS = {
  marker: 'Первой строкой ответа (если он открыт блоком состояния сцены — сразу после него) добавь метку: <!-- [ACADEMY t=+1] -->. Ключи: t= сдвиг времени (+1 — {period}, +1 day, +1 week); grade=предмет:оценка; rel={teacher}:minor+ или major- (:повод); skip=предмет; late=предмет. Только то, что случилось в ответе.',
  markerIds: 'Предметы: {subjects}.',
  markerTeachers: '{teacherPlural}: {teachers}.',
};

const vocabOf = (preset) => (preset && preset.vocab) || {};
const labelsOf = (preset) => ({ ...DEFAULT_LABELS, ...((preset && preset.labels) || {}) });
const promptsOf = (preset) => ({ ...DEFAULT_PROMPTS, ...((preset && preset.prompts) || {}) });

// --- строка состояния -------------------------------------------------------

/**
 * Одна строка состояния (3.3).
 *
 * Пустая, пока семестр не начат явно: до этого расширение молчит и в промпт не
 * лезет вовсе — чужая игра не обязана знать, что оно установлено.
 *
 * @param {Object} state
 * @param {Object} preset
 * @returns {string}
 */
export function statusLine(state, preset, opts = {}) {
  if (!state || state.started !== true || !state.calendar) return '';

  const L = labelsOf(preset);
  // Строка — знание МИРА, а не расширения (9.4.3): итог, который посчитан, но
  // ещё не объявлен, в балл и хвосты строки не входит — иначе «Хвосты: химия»
  // объявил бы провал раньше ведомости. См. `exams.publicView`.
  const segments = segmentsOf(publicView(state, preset), preset, L);
  // Фон потока — только по просьбе (`opts.feed`): строку состояния видит и
  // секретарь («где мы в календаре»), а сплетни ему не нужны.
  if (opts.feed) {
    const holiday = segments.some((s) => (s.id === 'holiday' || s.id === 'holidayAhead') && s.text);
    const crowdIn = String(vocabOf(preset).crowdIn || '').trim() || 'на курсе';
    segments.push({ id: 'feed', text: feedSegment(state, L, { quiet: opts.feed.quiet === true, holiday, crowdIn }) });
  }

  // Отбор по потолку чисел. Сегменты идут в порядке значимости, поэтому первый
  // же не поместившийся просто пропускается, а следующие — беcчисленные —
  // остаются: терять «хвосты: физика» из-за того, что перед ними стоял остаток
  // дней сессии, было бы обменом важного на второстепенное.
  const limit = numberOr(preset && preset.limits && preset.limits.maxNumbersInPrompt, Infinity);
  const kept = [];
  let used = 0;
  for (const seg of segments) {
    if (!seg.text) continue;
    const n = countNumbers(seg.text);
    if (used + n > limit) continue;
    used += n;
    // Конечная точка — дело склейки: тексты пресета («сегодня бал — суета.»)
    // иначе давали «суета.. Сегодня».
    kept.push(cap(seg.text.replace(/[\s.;,]+$/u, '')));
  }
  if (!kept.length) return '';
  return kept.join(L.glue) + L.end;
}

/**
 * Сегменты строки в порядке значимости — он же порядок слов.
 *
 * 1. день и неделя — без них всё остальное висит в воздухе;
 * 1½. праздник — фон дня: «сегодня Зимний бал», и отдельной фразой — «в
 *    пятницу ярмарка — все ищут пару» (`core/holidays.mjs`). Сразу за днём,
 *    потому что окрашивает весь день; чисел в нём нет;
 * 2. что идёт сейчас — то, что модель отыгрывает прямо в этом ответе;
 * 3. сессия — остаток и несданное, тон меняется целиком (3.5);
 * 4. хвосты — то, что висит и требует действий;
 * 4½. ближние события — «завтра — сессия; в пятницу объявят итог по химии»
 *    (9.4.4). После хвостов: хвост уже висит, событие только впереди. Чисел в
 *    сегменте нет, так что потолок из шести он не съедает;
 * 5. балл — фон, а не событие;
 * 6. отношение преподавателя, который в кадре, — словом;
 * 7. репутация — словом, и только когда ей есть что сказать.
 */
function segmentsOf(state, preset, L) {
  const vocab = vocabOf(preset);
  const mode = examMode(state, preset);
  const out = [];

  out.push({ id: 'day', text: daySegment(state, preset, L) });
  out.push({ id: 'holiday', text: holidaySegment(state, preset, L, 'now') });
  out.push({ id: 'holidayAhead', text: holidaySegment(state, preset, L, 'ahead') });
  out.push({ id: 'schedule', text: mode.active ? '' : scheduleSegment(state, preset, L) });

  if (mode.active) {
    const count = mode.pending.length;
    const days = mode.daysLeft;
    out.push({
      id: 'exams',
      text: fill(days === null ? L.examsNoDays : L.exams, {
        examPeriod: vocab.examPeriod || '',
        count: String(count),
        days: String(days),
        daysWord: plural(days, 'день', 'дня', 'дней'),
      }),
    });
  }

  const list = debts(state).map((s) => s.name || s.id);
  out.push({
    id: 'debts',
    text: list.length ? fill(L.debts, { debtPlural: vocab.debtPlural || vocab.debt || '', list: list.join(L.listGlue) }) : '',
  });

  out.push({ id: 'near', text: nearSegment(state, preset, L) });

  const score = overallScore(state, preset);
  out.push({
    id: 'score',
    text: score === null ? '' : fill(L.score, { scoreName: vocab.score || '', value: roundScore(score) }),
  });

  out.push({ id: 'relation', text: relationSegment(state, preset, L, mode) });

  out.push({ id: 'reputation', text: reputationSegment(state, preset, L) });
  return out;
}

/** «Вторник, 3-я неделя» — плюс слово фазы, когда день не учебный. */
function daySegment(state, preset, L) {
  const day = state.calendar.day;
  const weekday = (L.weekdays || [])[dayOfWeek(day) - 1] || '';
  // Номер недели — внутри своего учебного периода: во втором триместре человек
  // читает «3-я неделя триместра», а не «20-я». Поэтому пресет передаётся.
  const week = weekIndex(state, day, preset);
  const phase = phaseOf(preset, state, day);
  const word = (L.phases || {})[phase] || '';

  // Пресет, не объявивший длину периода, границ не имеет: тогда «в семестре» —
  // это просто «не раньше его начала».
  const at = termAt(preset, state, day);
  const declared = at.term ? at.term.declared : {};
  const span = numberOr(declared.studyWeeks, 0) + numberOr(declared.examWeeks, 0);
  const inTerm = week >= 1 && (!span || at.inside);

  // Пустое слово фазы («учебный день», «сессия» у части пресетов) — не повод для висячей запятой.
  if (!inTerm) return word ? fill(L.dayOutside, { weekday, phase: word }) : weekday;
  if (!word) return fill(L.day, { weekday, week: String(week) });
  return fill(L.dayPhase, { weekday, week: String(week), phase: word });
}

/**
 * Что идёт сейчас.
 *
 * Молчит в выходной, на каникулах, ночью и после последней пары (3.2): «сейчас:
 * химия» в субботу — ровно та ошибка, ради которой календарь вообще знает про
 * дни без занятий.
 *
 * Точность решает форму. Часы известны — говорится про одну пару, ту самую.
 * Известен только день — сетка звонков бесполезна, перечисляются предметы дня
 * (каждый один раз) с пометкой, какой идёт сейчас.
 */
function scheduleSegment(state, preset, L) {
  if (state.calendar.daypart === 'night') return '';
  const plan = dayPlan(state, preset);
  if (!plan.length) return '';

  const cur = currentPeriod(state, preset);
  if (!cur || cur.status === 'after') return '';

  if (state.calendar.precision === 'datetime') {
    const item = plan.find((p) => p.index === cur.index);
    if (!item) return '';
    return fill(cur.status === 'now' ? L.now : L.next, {
      subject: item.name,
      teacher: teacherTail(state, item.teacherId, L),
    });
  }

  // Предмет, который стоит в дне дважды, называется один раз: «Математика,
  // Японский, Физкультура, Математика, …» модель читает как шум, а не как
  // расписание. Пометка «сейчас» — у того места, где предмет назван.
  const nowName = cur.status === 'now' ? (plan.find((p) => p.index === cur.index) || {}).name : null;
  const names = [...new Set(plan.map((p) => p.name))];
  const list = names.map((name) => (name === nowName ? fill(L.nowMark, { subject: name }) : name));
  return fill(L.today, { list: list.join(L.listGlue) });
}

/**
 * Отношение преподавателя, который в кадре, — словом (3.3). Ровное отношение в
 * строку не идёт: «Иванов: ровно» отыгрывать нечего, а место в шести позициях
 * оно занимает.
 */
function relationSegment(state, preset, L, mode) {
  const teacher = teacherInFrame(state, preset, mode);
  if (!teacher) return '';
  const scale = (preset && preset.relations) || {};
  const label = relationLabel(state, teacher.id, preset);
  if (!label || label === labelFor(scale.labels || [], numberOr(scale.start, 0))) return '';
  return fill(L.relation, { teacher: teacher.name || teacher.id, label });
}

/**
 * Ближние события одним сегментом (9.4.4). Что и сколько — решает
 * `core/upcoming.mjs` по пресету; здесь только слова.
 */
function nearSegment(state, preset, L) {
  const list = upcomingEvents(state, preset);
  if (!list.length) return '';
  const parts = [];
  for (const ev of list) {
    const when = nearWhen(ev, L);
    if (!when) continue;
    if (ev.kind === 'exam') {
      const subject = ev.subjectId ? subjectName(state, ev.subjectId) : '';
      parts.push(fill(subject ? L.nearExamSubject : L.nearExam, { when, what: ev.what || '', subject }));
    } else if (ev.kind === 'announce') {
      parts.push(fill(L.nearAnnounce, { when, subject: subjectName(state, ev.subjectId) }));
    }
  }
  return parts.join(L.nearGlue);
}

/**
 * Фон праздника: «сегодня Зимний бал — вечером бал, днём суета» (`part:
 * 'now'`) или «в пятницу Зимний бал — все ищут пару» (`'ahead'`). Два
 * праздника одного дня — одной фразой через «и». Что и когда — решает
 * `core/holidays.mjs`; конечная пунктуация текстов пресета снимается.
 */
function holidaySegment(state, preset, L, part) {
  const day = state.calendar && state.calendar.day;
  if (!day) return '';
  const bg = holidayBackground(preset, day, state);
  if (part === 'now') return holidayPhrase(bg.now.map((h) => ({ h, note: bare(h.today) })), L, L.holidayNow, L.holidayNowBare, {});
  const first = bg.aheadAll[0];
  if (!first) return '';
  const when = first.days > 6 ? L.holidaySoon : nearWhen({ days: first.days, day: first.day }, L);
  if (!when) return '';
  return holidayPhrase(bg.aheadAll.map((a) => ({ h: a.holiday, note: bare(a.holiday.buzz) })), L, L.holidayAhead, L.holidayAheadBare, { when });
}

/**
 * Фон курса (шаг 4, слой 1): «на курсе говорят: прогул: история —
 * обсуждают (факт); «…» (слух — правда ли, неизвестно)». Что
 * попадает — решает `feed.feedBackground` (свежее, что героиня может знать,
 * не больше двух пунктов); здесь только слова и потолок длины. Рядом с фоном
 * праздника — один пункт: общий потолок фона, строка не должна разрастаться.
 * Нечего сказать — пусто, и сегмента нет.
 */
function feedSegment(state, L, { quiet = false, holiday = false, crowdIn = 'на курсе' } = {}) {
  if (quiet) return '';
  const points = feedBackground(state, { max: holiday ? 1 : BACKGROUND_MAX });
  if (!points.length) return '';
  const word = (p) => {
    if (p.kind === 'fact') return fill(L.feedFact, { text: p.text });
    if (p.kind === 'rumor') return fill(L.feedRumor, { text: p.text });
    if (p.kind === 'gossip') return fill(L.feedGossip, { text: unsaid(p.text) });
    return fill(p.quoted ? L.feedTalkQuote : L.feedTalk, { text: p.text });
  };
  const parts = [];
  for (const p of points) {
    const next = [...parts, word(p)];
    const line = fill(L.feed, { crowdIn, list: next.join(L.feedGlue) });
    if (line.length > FEED_LINE_MAX && parts.length) break;
    parts.push(word(p));
  }
  return fill(L.feed, { crowdIn, list: parts.join(L.feedGlue) });
}

/** «сегодня A — x, и B — y» / «в пятницу A и B». */
function holidayPhrase(items, L, full, short, vars) {
  let out = '';
  items.forEach(({ h, note }, i) => {
    const text = i === 0
      ? fill(note ? full : short, { ...vars, name: h.name, note })
      : fill(note ? L.holidayAlso : L.holidayAlsoBare, { name: h.name, note });
    // После пояснения с тире — запятая, иначе «A — суета и B» сливается.
    out = i === 0 ? text : `${out}${items[i - 1].note ? ', ' : ' '}${text}`;
  });
  return out;
}

/** «сегодня» / «завтра» / «в пятницу». */
function nearWhen(ev, L) {
  if (ev.days === 0) return L.nearToday;
  if (ev.days === 1) return L.nearTomorrow;
  return (L.weekdaysOn || [])[dayOfWeek(ev.day) - 1] || '';
}

function subjectName(state, id) {
  const s = (state.subjects || []).find((x) => x.id === id);
  return (s && (s.name || s.id)) || String(id || '');
}

/** Репутация словом — и только когда она съехала со стартовой (3.4). */
function reputationSegment(state, preset, L) {
  const scale = (preset && preset.reputation) || {};
  const label = reputationLabel(state, preset);
  if (!label) return '';
  const start = labelFor(scale.labels || [], numberOr(scale.start, state.reputation.value));
  if (label === start) return '';
  return fill(L.reputation, { label });
}

/**
 * Преподаватель «в кадре»: чьё занятие идёт сейчас, а в сессию — чьё контрольное
 * ближайшее. Отношения всех остальных в строку не идут: их там четверо, и это
 * снова таблица, которую модель пролистает.
 */
function teacherInFrame(state, preset, mode) {
  const subjectId = mode.active
    ? (mode.pending[0] && mode.pending[0].subjectId)
    : currentSubjectId(state, preset);
  if (!subjectId) return null;
  const subject = (state.subjects || []).find((s) => s.id === subjectId);
  if (!subject || !subject.teacherId) return null;
  return (state.teachers || []).find((t) => t.id === subject.teacherId) || null;
}

function currentSubjectId(state, preset) {
  if (state.calendar.daypart === 'night') return null;
  if (!dayPlan(state, preset).length) return null;
  const cur = currentPeriod(state, preset);
  return cur && cur.status !== 'after' ? cur.subjectId : null;
}

function teacherTail(state, teacherId, L) {
  const t = (state.teachers || []).find((x) => x.id === teacherId);
  return t ? fill(L.teacherOf, { teacher: t.name || t.id }) : '';
}

// --- инструкция про метку ---------------------------------------------------

/**
 * Инструкция модели про формат метки (3.1). Целевой размер — до ~60 токенов:
 * на тяжёлых пресетах сцены за место в контексте идёт война, и эта инструкция
 * отключается галочкой целиком.
 *
 * Предметы и преподаватели перечисляются **идентификаторами**, а не названиями:
 * поправка 1 замера B — длинные имена с пробелами модель ломает, короткий
 * латинский id она повторяет точно.
 */
export function markerInstruction(state, preset) {
  const P = promptsOf(preset);
  const vocab = vocabOf(preset);
  const parts = [fill(P.marker, {
    period: vocab.period || '',
    teacher: firstId(state && state.teachers) || vocab.teacher || '',
  })];

  const subjects = idsOf(state && state.subjects);
  if (subjects.length) parts.push(fill(P.markerIds, { subjects: subjects.join(', ') }));

  const teachers = idsOf(state && state.teachers);
  if (teachers.length) {
    parts.push(fill(P.markerTeachers, {
      teacherPlural: cap(vocab.teacherPlural || vocab.teacher || ''),
      teachers: teachers.join(', '),
    }));
  }
  return parts.filter(Boolean).join('\n');
}

// --- одноразовые факты ------------------------------------------------------

/**
 * Одноразовые факты одним куском (3.5): не справка, а уже случившееся, что
 * модель обязана отыграть. Тексты приходят из ядра готовыми формулировками —
 * склеивать их здесь во что-то новое нельзя, иначе повелительное наклонение
 * снова превратится в сводку.
 *
 * @param {Array<{id: string, text: string}>} injects
 * @returns {string}
 */
export function injectBlock(injects) {
  if (!Array.isArray(injects) || !injects.length) return '';
  const seen = new Set();
  const lines = [];
  for (const item of injects) {
    if (!item || !item.text) continue;
    const id = item.id === undefined ? item.text : item.id;
    if (seen.has(id)) continue;
    seen.add(id);
    lines.push(String(item.text).trim());
  }
  return lines.join('\n');
}

/**
 * Что уходит в промпт целиком — для режима отладки (3.2) и для `index.js`,
 * который решает, куда и на какой глубине это вставлять.
 *
 * `feed` — дописать к строке фон потока курса (слой 1); `{quiet: true}` —
 * игрок попросил тишины на этот ход, фон молчит.
 *
 * @returns {{status: string, instruction: string, oneShot: string}}
 */
export function buildPrompt(state, preset, { injects = [], withMarker = true, feed = null } = {}) {
  return {
    status: statusLine(state, preset, { feed }),
    instruction: withMarker ? markerInstruction(state, preset) : '',
    oneShot: injectBlock(injects),
  };
}

// --- мелочи -----------------------------------------------------------------

/**
 * Сколько чисел в строке. Число — цельная запись, а не цифра: `10:15`, `3.4` и
 * `3-я` считаются по одному, иначе потолок из шести выбирался бы часами.
 */
export function countNumbers(text) {
  return (String(text || '').match(/\d+(?:[.,:]\d+)*/g) || []).length;
}

/** Подстановка `{ключ}`. Неизвестные ключи остаются как есть: их видно в отладке. */
export function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/** Балл с одним знаком: `3.4`, а не `3.4000000000000004`. */
function roundScore(value) {
  const r = Math.round(value * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function idsOf(list) {
  return (Array.isArray(list) ? list : []).map((x) => x && x.id).filter(Boolean);
}

const firstId = (list) => idsOf(list)[0] || '';

/** Заглавная первая буква. Регистр — не лексика: работает на любом алфавите. */
function cap(text) {
  const s = String(text || '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function numberOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

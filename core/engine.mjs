// core/engine — сшивка ядра: один ответ модели, прогнанный по всей цепочке.
//
// Это то, что до сих пор жило руками в `post()` из `test/semester.test.mjs`, а на
// втором этапе понадобилось в двух местах сразу: в обработчике `MESSAGE_RECEIVED`
// (`index.js`) и в тестах. Модуль чистый: ни DOM, ни таверны, ни `Date.now()` —
// всё, что нужно, приходит аргументом.
//
// Четыре решения, из которых вытекает остальной файл.
//
// 1. **Порядок шагов не произволен** и повторяет 3.2–3.5:
//    посещаемость из метки отмечается ДО сдвига времени (`skip=chemistry`
//    относится к паре, которая идёт сейчас, а не к той, куда мы уедем);
//    время двигается; пройденные пары разносятся по ведомости; оценки и
//    отношения из метки применяются после; эффекты посещаемости — одним пакетом
//    в конце, чтобы пороги репутации пробивались один раз, а не по разу на
//    каждую отметку.
//
// 2. **Источник времени выбирается режимом (3.2), и в «авто» первым спрашивается
//    А — проза.** Это расхождение с черновиком `post()`, где метка была первой.
//    План 3.2 требует обратного: «если модель напечатала время в шапке, оно и
//    берётся, а метка служит подстраховкой… расходиться с видимым текстом
//    расширение не имеет права». Календарь, показывающий вторник, когда в посте
//    написано «четверг», хуже календаря, отставшего на пару.
//
// 3. **Метка — единственный канал для оценок, прогулов и отношений** (3.2), и
//    режим «из контекста» её тоже разбирает. Он отключает метку только как
//    источник ВРЕМЕНИ и инжект инструкции (это уже забота `index.js`), но не как
//    канал событий: иначе режим «время уже печатается в постах» отнимал бы заодно
//    зачётку.
//
// 4. **Своих правил у сшивки нет.** Горизонт вывода прогулов, потолок сдвига,
//    запрет отката, пороги репутации, зажим отношений — всё это живёт в ядре и
//    спрашивается у него. Здесь нет ни одного правила-числа и ни одного слова
//    сеттинга: единственные строки в файле — ключи отладки, латиницей.

import {
  cloneState, pushJournal, takePending, teacherOfSubject,
} from './state.mjs';
import {
  advance, setAbsolute, noteIdle, phaseOf, isStudyDay, isStalled, addDays, parseDay,
} from './time.mjs';
import { dayPlan } from './schedule.mjs';
import { parseMarker, MARKER_RE } from './parse-marker.mjs';
import { readTime } from './time-source.mjs';
import { addGrade, setDebt, REJECT_UNKNOWN_VALUE } from './gradebook.mjs';
import { mark, inferMissed, shouldInfer, countsAttendance } from './attendance.mjs';
import { applyAcademicCompletion } from './academic-completion.mjs';
import { applyRelationDeltas, dampRepeats, teachersOfSubjects, mergeDeltas } from './relations.mjs';
import { changeReputation } from './reputation.mjs';
import { armHolidayHooks, planEvent } from './holidays.mjs';
import { markerPeople } from './classmates.mjs';
import {
  scheduleExams, examMode, rollOutcome, applyOutcome, resolveConflict, permissionLine,
  examTermIndex, examSessionEnded, closeExamSession, isPassing, examScore,
  scheduleDatedExams, datedExams, sittableExams, isDatedExam, kindOf, seededRng, examSeed,
  announceResults, awaitingAnnouncement, externalValue, examRule,
} from './exams.mjs';

/** Режимы источника времени из таблицы 3.2. */
export const MODES = ['auto', 'context', 'marker'];

/**
 * Как считать посещаемость за дни, перешагнутые промоткой времени (9.2, 3.4):
 *
 * - `attend` — умолчание: человек промотал учёбу, а не прогулял её. По духу
 *   README («ремонт не наказывает»): кнопка «через неделю» в Enhance-Gen — это
 *   монтаж, и платить за монтаж отчислением было бы наказанием за сюжет;
 * - `absent` — как любой прыжок датой: всё, что стояло в пропущенных днях,
 *   прошло без неё (прежнее поведение, для строгих заведений);
 * - `ask` — зарезервировано под вопрос человеку. Спросить можно только
 *   после ответа, а придержать ведомость до ответа значит завести в состоянии
 *   ещё одно ожидание рядом с `heldJump` (схема и панель — не этот шаг). Пока
 *   `ask` ведёт себя как `attend` и оставляет строчку в отладке.
 */
export const SKIP_POLICIES = ['attend', 'absent', 'ask'];

/** Политика пресета (`attendance.skipPolicy`); чего нет или не знаем — `attend`. */
export function skipPolicyOf(preset) {
  const raw = preset && preset.attendance && preset.attendance.skipPolicy;
  return SKIP_POLICIES.includes(raw) ? raw : 'attend';
}

/** С какого прыжка датой (в днях) пропущенное — монтаж, а не прогул. */
export const MONTAGE_DAYS = 2;

/**
 * Политика ведомости для прыжка без явной промотки. Ход внутри дня и переход
 * на следующий — сцена: пара, которая прошла без героини, — прогул. Прыжок
 * через два дня и дальше — монтаж: пропущенное считается по политике пресета
 * (`skipPolicyOf`), как при явной промотке.
 */
export function jumpPolicyOf(preset, fromDay, toDay) {
  const days = isDayStr(fromDay) && isDayStr(toDay) ? dayDiff(fromDay, toDay) : 0;
  return days >= MONTAGE_DAYS ? skipPolicyOf(preset) : 'absent';
}

/** Обычный потолок прыжка датой — тот же, что у `time.setAbsolute`. */
function jumpCapOf(preset) {
  const v = Number(preset && preset.limits && preset.limits.maxForwardJump);
  return Number.isFinite(v) ? v : 1;
}

/**
 * Потолок прыжка в ответе после промотки (9.2).
 *
 * План предлагает «например, 2×`maxForwardJump`» — при умолчании в сутки это
 * двое суток, а анализатор Enhance-Gen нарочно предлагает и «длинную» главу
 * («недели», его промпт `ts_analyzer`). Промотка на неделю с потолком в двое
 * суток снова спросила бы человека «принять?» о том, что он только что выбрал.
 * Поэтому: заказанная длина плюс сутки запаса («неделя спустя, в понедельник
 * утром» — это и 7, и 8 суток), но не меньше 2×`maxForwardJump`. Сверху —
 * `limits.maxTimeShift`, общий потолок одного сдвига у метки: промотка не
 * должна уметь больше, чем умеет `t=`.
 *
 * @param {Object} preset
 * @param {?number} days сколько суток заказано (`cues.skipDays`), `null` — неизвестно
 * @returns {number}
 */
export function timeSkipCap(preset, days = null) {
  const base = jumpCapOf(preset);
  let cap = 2 * base;
  if (Number.isFinite(days) && days >= 0) cap = Math.max(cap, Math.ceil(days) + 1);
  const limit = Number(preset && preset.limits && preset.limits.maxTimeShift);
  if (Number.isFinite(limit)) cap = Math.min(cap, Math.max(limit, base));
  return cap;
}

/**
 * Ближайший день после сегодняшнего, в который можно сесть за контрольное, — в
 * пределах `horizon` суток; `null` — такого нет.
 *
 * Анализатор промотки календаря Academy не видит, и модель, получившая «через
 * две недели», спокойно перешагнёт сессию — а несевшее при закрытии сессии
 * становится хвостом (`exams.closeExamSession`). Поэтому день ищется тем же
 * путём, каким его нашёл бы календарь, дойдя туда сам: пробное состояние на
 * этот день, `calendarEvents` (откроет сессию, заведёт событие своей недели),
 * `sittableExams`. Сегодняшний день не считается: «останови сцену накануне»
 * про сегодня сказать нельзя.
 *
 * @returns {?{day: string, days: number, what: string}}
 */
export function examAhead(state, preset, horizon) {
  const today = state && state.calendar && state.calendar.day;
  const n = Math.floor(Number(horizon));
  if (!today || !Number.isFinite(n) || n < 1) return null;
  for (let k = 1; k <= n; k += 1) {
    const day = addDays(today, k);
    const probe = cloneState(state);
    probe.calendar.day = day;
    const s = calendarEvents(probe, preset).state;
    const due = sittableExams(s, preset, day);
    if (!due.length) continue;
    const item = due.find((i) => !i.outcome) || due[0];
    const vocab = (preset && preset.vocab) || {};
    // Слово — из пресета: событие своей недели называется своим видом
    // («промежуточная аттестация»), всё остальное — периодом сессии.
    const dated = isDatedExam(preset, item);
    const what = dated
      ? String((kindOf(preset, item.kind) || {}).name || item.kind || '')
      : String(vocab.examPeriod || item.kind || '');
    // `subjectId` и `count` — для ближних событий строки (9.4.4): одно событие
    // называется по предмету, пачка («середина по всем предметам») — видом.
    return { day, days: k, what, subjectId: item.subjectId, count: due.length, dated };
  }
  return null;
}

/**
 * Промотка для этого ответа: потолок, политика, контрольное впереди — либо
 * `null`, если cue нет. Потолок не перешагивает контрольное: прыжок дальше дня
 * контрольного снова придерживается до слова человека (обычный «принять?»),
 * но и ниже обычного потолка не опускается — без промотки такой прыжок прошёл
 * бы и так.
 */
function timeSkipOf(state, preset, cue) {
  if (!cue) return null;
  const days = cue && typeof cue === 'object' && Number.isFinite(cue.days) ? cue.days : null;
  let cap = timeSkipCap(preset, days);
  const exam = examAhead(state, preset, cap);
  if (exam) cap = Math.max(jumpCapOf(preset), Math.min(cap, exam.days));
  return {
    days,
    cap,
    policy: skipPolicyOf(preset),
    exam,
    // Поднятый потолок уходит в `setAbsolute` копией пресета: `time.mjs` про
    // промотку не знает и знать не должен — у него один потолок, и он его
    // спрашивает у пресета.
    preset: { ...preset, limits: { ...((preset && preset.limits) || {}), maxForwardJump: cap } },
  };
}

/** Фраза по умолчанию; пресет перекрывает её `phrases.timeSkip.examAhead`. */
export const TIME_SKIP_PHRASES = {
  examAhead: 'Промотка времени не может перешагнуть {date}: в этот день — {what}. Останови сцену накануне.',
};

/**
 * Одноразовая строка к генерации после промотки (9.2): «пропуск не может
 * перешагнуть контрольное DD.MM — останови сцену накануне». Пусто, если cue нет
 * или контрольного в пределах промотки нет.
 *
 * @param {Object} state
 * @param {Object} preset
 * @param {?Object} cue `cues.readTimeSkip(...)`
 * @returns {string}
 */
export function timeSkipWarning(state, preset, cue) {
  if (!cue || !state || !state.started) return '';
  const days = typeof cue === 'object' && Number.isFinite(cue.days) ? cue.days : null;
  const exam = examAhead(state, preset, timeSkipCap(preset, days));
  if (!exam) return '';
  const p = parseDay(exam.day);
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${pad(p.d)}.${pad(p.m)}`;
  const phrases = (preset && preset.phrases && preset.phrases.timeSkip) || {};
  const tpl = typeof phrases.examAhead === 'string' && phrases.examAhead ? phrases.examAhead : TIME_SKIP_PHRASES.examAhead;
  return tpl.replace(/\{date\}/g, date).replace(/\{what\}/g, exam.what);
}

/** Позиция в дне при точности «только день»: счётчик пар, а не часы. */
const posOf = (state) => (Number.isFinite(state.calendar.periodIndex) ? state.calendar.periodIndex : 0);

// Год календаря, эпоха анкеты и переход через Новый год для дат без года жили
// здесь (`yearOf`, `rollYear`) и переехали в `core/time-source.mjs`: это часть
// чтения времени, а не его движения (9.7, «Часы сюжета»).

/**
 * Один ответ модели, прогнанный по всей цепочке.
 *
 * @param {Object} state
 * @param {string} text  сырой текст сообщения модели, вместе с меткой
 * @param {Object} preset
 * @param {Object} [opts]
 * @param {'auto'|'context'|'marker'} [opts.mode='auto'] откуда брать время (3.2)
 * @param {boolean} [opts.relativeWords=false] относительные сдвиги словами в источнике A
 * @param {boolean} [opts.exam=false] посадить студентку за ближайшее контрольное (3.5)
 * @param {boolean} [opts.sitsExam=false] вызывающая сторона сажает за контрольное
 *   сама и забирает `out.modelSaid` (так делает `index.js`) — 8.1
 * @param {string}  [opts.examId] какое именно контрольное, если не ближайшее
 * @param {string}  [opts.modelSaid] исход, который модель уже отыграла в этом ответе
 * @param {?{days: ?number}} [opts.timeSkip] промотка времени, выбранная человеком в
 *   реплике перед этим ответом (`cues.readTimeSkip`, 9.2): поднятый потолок прыжка
 *   и политика посещаемости `skipPolicy` за перешагнутые дни
 * @param {boolean} [opts.phoneTurn=false] реплика перед ответом — ход в телефоне
 *   (`cues.readPhoneTurn`, 9.2): время из метки не проводится, прогулы не выводятся
 * @param {() => number} [opts.rng=Math.random]
 * @param {string} [opts.seed] строка чата для воспроизводимого броска (9.3.9);
 *   `opts.rng` сильнее её — см. `sitExam`
 * @param {{user?: string|string[], char?: string|string[]}} [opts.names] имена
 *   героини (`name1`) и карточки (`name2`) для стоп-листа `rel=` (9.3.6). Без
 *   них стоп-лист держится только на названии заведения и словах пресета.
 * @param {?{tier: string, roll: ?number, dc: ?number}} [opts.dice] кубик
 *   Enhance-Gen в реплике человека перед этим ответом (`cues.readDiceRoll`,
 *   9.4.1): при `opts.exam` уходит в `sitExam` — см. там
 * @returns {{state: Object, injects: Array, rejected: Array, missed: Array,
 *   notes: string[], exam: ?Object, permission: string, divergence: ?Object,
 *   modelSaid: ?{examId: string, subjectId: string, value: string},
 *   jump: ?{fromDay: string, toDay: string, days: number, periods: number, missed: number, present: number},
 *   debug: {mode: string, source: ?('A+'|'A'|'B'), via: ?string, moved: boolean, marker: ?string,
 *     applied: Array, rejected: Array, notes: string[], stalled: boolean, idle: number}}}
 */
export function applyResponse(state, text, preset, opts = {}) {
  const mode = MODES.includes(opts.mode) ? opts.mode : 'auto';
  const src = typeof text === 'string' ? text : '';

  const out = {
    state: null,
    injects: [],
    rejected: [],
    missed: [],
    notes: [],
    exam: null,
    permission: '',
    divergence: null,
    // Исход, который модель отыграла меткой, а бросить его ещё предстоит: его
    // забирает тот, кто сажает за контрольное (8.1, см. цикл оценок ниже).
    modelSaid: null,
    // Прыжок вперёд, придержанный до слова человека (`time.setAbsolute`).
    heldJump: null,
    // Сводка прыжка через дни (9.4.4): одно «+N пар» для тоста вместо пачки.
    jump: null,
    debug: {
      mode,
      source: null,
      // Что именно сработало внутри источника: имя машинного тега соседа
      // (`tel:time`, `RP_DATE`…), шаг разбора прозы (`header`, `line`…) или
      // `marker`. «Какой источник сработал» — первый вопрос отладки (3.2).
      via: null,
      moved: false,
      marker: markerText(src),
      applied: [],
      rejected: [],
      notes: [],
      stalled: false,
      idle: 0,
    },
  };

  // Копия делается на входе, а не по дороге: ядро возвращает новое состояние на
  // каждом шаге, но пустой ответ мог бы не пройти ни через один такой шаг и
  // вернуть чужой объект наружу.
  let s = cloneState(state);

  // Метка разбирается всегда, даже в режиме «из контекста»: время из неё там
  // брать запрещено, а оценки, прогулы и отношения из прозы не вытащить ничем.
  const lexicon = {
    ...preset,
    subjects: s.subjects,
    // `rel=` двигает и однокурсников (шаг 2): разборщик ищет id и имя по
    // преподавателям, за ними — по курсу.
    teachers: markerPeople(s),
    survey: s.survey,
    names: opts.names && typeof opts.names === 'object' ? opts.names : null,
  };
  const parsed = parseMarker(src, lexicon);
  out.rejected = parsed.rejected;
  out.debug.rejected = parsed.rejected;

  // --- (3) посещаемость по метке: до сдвига времени -------------------------
  const effects = { relation: [], reputation: 0, debt: [] };
  const plan = dayPlan(s, preset);
  for (const ev of parsed.events.filter((e) => e.kind === 'attendance')) {
    const slot = plan.find((p) => p.subjectId === ev.subjectId);
    const res = mark(s, {
      subjectId: ev.subjectId,
      status: ev.status,
      day: s.calendar.day,
      periodIndex: slot ? slot.index : posOf(s),
    }, preset);
    s = res.state;
    absorb(effects, res.effects);
    out.debug.applied.push({ kind: 'attendance', subjectId: ev.subjectId, status: ev.status });
  }

  // --- (1,2,4) время --------------------------------------------------------
  // Что человек сказал о времени своей репликой (9.2, `core/cues.mjs`): ход в
  // телефоне ставит сцену на паузу, промотка Enhance-Gen — это прыжок, который
  // человек уже выбрал сам. Решает ядро, найти реплику — дело `index.js`.
  const skip = opts.phoneTurn ? null : timeSkipOf(s, preset, opts.timeSkip);
  if (opts.phoneTurn) out.debug.applied.push({ kind: 'phone-turn' });
  if (skip) {
    out.debug.applied.push({
      kind: 'time-skip', days: skip.days, cap: skip.cap, policy: skip.policy,
      examDay: skip.exam ? skip.exam.day : null,
    });
  }
  const fromDay = s.calendar.day;
  const fromPos = posOf(s);
  const moveRes = applyTime(s, src, parsed, mode, preset, { ...opts, skip, phoneTurn: Boolean(opts.phoneTurn) });
  s = moveRes.state;
  out.notes.push(...moveRes.notes);
  out.debug.source = moveRes.source;
  out.debug.via = moveRes.via;
  out.debug.moved = moveRes.moved;
  out.heldJump = s.calendar.heldJump || null;
  out.debug.applied.push(...moveRes.applied);

  // --- (4) что стало с парами, которые прошли -------------------------------
  // Телефонный ход ведомость не трогает вовсе: ни выведенных прогулов, ни
  // выведенного присутствия. Переписка — пауза, а не пара (9.2). Явные `skip=`
  // из метки выше при этом остались: их модель сказала словами, а не временем.
  // Промотка обходит ведомость по политике пресета (`skipPolicy`, 3.4) — и
  // явная (cue Enhance-Gen), и молчаливая: прыжок датой через несколько дней
  // («минувшие четыре дня пронеслись») — монтаж, а не прогул (`jumpPolicyOf`).
  const sweep = sweepAttendance(
    s, fromDay, fromPos, opts.phoneTurn ? null : moveRes.unit, preset,
    { policy: skip ? skip.policy : jumpPolicyOf(preset, fromDay, s.calendar.day) },
  );
  s = sweep.state;
  out.missed = sweep.missed;
  out.jump = sweep.summary || null;
  absorb(effects, sweep.effects);
  if (sweep.missed.length) out.debug.applied.push({ kind: 'missed', count: sweep.missed.length });

  // --- отношения из метки ---------------------------------------------------
  // Штампованный повтор гасится до применения (9.3.5). «Новое событие» —
  // оценка, отметка или выведенный прогул по предмету наставника в этом же
  // ответе; смену дня `dampRepeats` видит сам. Вызов — на каждый ответ, и без
  // `rel=` тоже: пустой ответ обрывает серию.
  const relEvents = parsed.events.filter((e) => e.kind === 'rel');
  const touched = [
    ...parsed.events.filter((e) => e.kind === 'grade' || e.kind === 'attendance').map((e) => e.subjectId),
    ...sweep.missed,
  ];
  const damp = dampRepeats(s, relEvents, preset, { fresh: teachersOfSubjects(s, touched) });
  s = damp.state;
  // Повод сдвига (9.7B): из того, что механика видит в этом же ответе, плюс
  // слова модели из метки, если она их написала (`rel=petrova:major-:…`).
  const reasons = new Map(relEvents.map((ev) => [ev, relReason(s, ev, parsed.events, sweep.missed)]));
  s = applyRelationDeltas(s, damp.events.map((ev) => ({ ...ev, reason: reasons.get(ev) })), preset).state;
  for (const ev of relEvents) {
    const reason = reasons.get(ev);
    out.debug.applied.push({
      kind: 'rel',
      teacherId: ev.teacherId,
      delta: ev.delta,
      ...(ev.impact ? { impact: ev.impact } : {}),
      ...(reason ? { reason } : {}),
      ...(damp.events.includes(ev) ? {} : { damped: true }),
    });
  }

  // --- (5) эффекты посещаемости одним пакетом -------------------------------
  s = applyRelationDeltas(s, effects.relation, preset).state;
  for (const id of effects.debt) s = setDebt(s, id, true, preset);
  if (effects.reputation) {
    s = changeReputation(s, { delta: effects.reputation, reason: 'attendance' }, preset).state;
  }

  // --- сессия ---------------------------------------------------------------
  // Вход в период — событие календаря, а не отдельная кнопка: `scheduleExams`
  // дубликатов не плодит, но лишний вызов на каждом ответе всё равно писал бы в
  // журнал, поэтому сторож остаётся. Сторожит он теперь не «активна ли сессия
  // вообще», а «открыта ли сессия ИМЕННО этого периода»: у японского пресета
  // три триместра, и на голом `active` флаг, поднятый в первом, запирал вход во
  // второй и в третий — сессия была ровно одна за год.
  //
  // Закрытие — там же и по тому же календарю: сессия, оставшаяся включённой на
  // каникулах, прячет расписание из строки состояния и обещает отрицательный
  // остаток дней. Закрывается она по окну своего периода, а не по фазе: суббота
  // посреди экзаменационной недели — `weekend`, но сессия в неё не кончается.
  if (moveRes.moved) {
    const cal = calendarEvents(s, preset);
    s = cal.state;
    out.debug.applied.push(...cal.applied);
  }

  // --- зачётка из метки: обычная оценка или исход контрольного (8.1) --------
  //
  // Цикл стоит здесь, после блока сессии, а не рядом с отношениями, и это не
  // вкусовщина: события сессии заводит `scheduleExams` парой строк выше, и
  // оценка, разобранная до него, в первый же день сессии не нашла бы
  // контрольного, за которое её выставили.
  //
  // Развилка ровно одна и проходит по `todaysExam`: `grade=` по предмету
  // сегодняшнего контрольного — это исход этого контрольного, а не вторая
  // оценка рядом с брошенным. Дальше две ветки.
  //
  //  - Бросок сегодня УЖЕ был (`sat`) — например, в прошлом ответе того же дня.
  //    Оценка от него в зачётке стоит, `addGrade` положил бы вторую; поэтому
  //    сюда идёт `resolveConflict`: он переписывает ту же запись, а не добавляет
  //    новую, и пишет расхождение в журнал.
  //  - Броска ещё не было — он случится в этом же проходе, ниже (`opts.exam`)
  //    или у вызывающей стороны (`index.js:maybeSitExam`). Спорить не с чем:
  //    значение придерживается в `out.modelSaid` и уходит в `sitExam`, а тот
  //    отдаёт его тому же `resolveConflict` уже после броска. Оценка в зачётке
  //    появляется один раз — её пишет `applyOutcome` через `gradebook`.
  //
  // Вторая ветка работает только по обещанию вызывающей стороны (`opts.exam`
  // или `opts.sitsExam`), и это не перестраховка: придержанное значение обязан
  // забрать тот, кто сажает за контрольное, а кто не сажает — тот молча потерял
  // бы оценку. Умолчание поэтому обычное: `addGrade`, как было до шва.
  const todays = todaysExam(s, preset);
  const sits = Boolean(opts.exam || opts.sitsExam);
  let routed = false;
  for (const ev of parsed.events.filter((e) => e.kind === 'grade')) {
    // `routed` — про вторую подряд оценку по тому же предмету в одном ответе:
    // контрольное сегодня одно, и «пятёрка и четвёрка за один экзамен» значения
    // не имеет. Первая — исход, остальные — обычные оценки.
    const mine = Boolean(todays) && !routed && todays.item.subjectId === ev.subjectId
      && (todays.sat || sits);
    if (mine && todays.sat) {
      const conflict = resolveConflict(s, { examId: todays.item.id, modelSaid: ev.value }, preset);
      s = conflict.state;
      routed = true;
      if (conflict.divergence && !conflict.divergence.applied) {
        // Значения нет в шкале: посчитанный исход остался стоять, и второй
        // оценки в зачётке не появилось. Причина — та же, что у `addGrade`.
        //
        // Отсюда эта ветка недостижима, и это проверено тестом: значение вне
        // шкалы бракует `parse-marker` раньше движка, до `grade=` дело не
        // доходит. Ветка оставлена не на всякий случай, а потому что
        // `resolveConflict` её умеет, и маршрут обязан вести себя одинаково,
        // откуда бы значение ни пришло — из метки или из будущей команды.
        out.notes.push(REJECT_UNKNOWN_VALUE);
      } else {
        out.divergence = conflict.divergence || out.divergence;
        out.debug.applied.push({ kind: 'grade', subjectId: ev.subjectId, value: ev.value });
      }
      continue;
    }
    if (mine) {
      out.modelSaid = { examId: todays.item.id, subjectId: ev.subjectId, value: String(ev.value) };
      routed = true;
      continue;
    }
    const r = addGrade(s, { subjectId: ev.subjectId, value: ev.value }, preset);
    s = r.state;
    if (r.applied) out.debug.applied.push({ kind: 'grade', subjectId: ev.subjectId, value: ev.value });
    else out.notes.push(r.reason);
  }

  for (const event of parsed.events.filter((entry) => entry.kind === 'completion')) {
    const completed = applyAcademicCompletion(s, event, preset);
    s = completed.state;
    if (completed.applied) out.debug.applied.push({ ...event, subjectIds: completed.subjectIds });
  }

  if (opts.exam) {
    // Явно переданный `opts.modelSaid` сильнее придержанного: вызывающая
    // сторона, назвавшая исход руками, знает больше метки. Придержанное идёт в
    // ход, только если садимся именно за то контрольное, к которому оно
    // относится.
    const held = out.modelSaid && (!opts.examId || opts.examId === out.modelSaid.examId)
      ? out.modelSaid.value
      : undefined;
    const said = opts.modelSaid === undefined || opts.modelSaid === null || opts.modelSaid === ''
      ? held
      : opts.modelSaid;
    const sat = sitExam(s, preset, {
      rng: opts.rng, seed: opts.seed, examId: opts.examId, modelSaid: said, dice: opts.dice,
    });
    s = sat.state;
    out.exam = sat.exam;
    out.permission = sat.permission;
    out.divergence = sat.divergence;
    if (sat.applied) out.debug.applied.push({ kind: 'exam', ...sat.exam });
  }

  // --- события в планы (`event=`, разбор секретаря) --------------------------
  // День считается от дня сцены — после сдвига времени: «через три дня бал» в
  // ответе, где наступило утро, — три дня от этого утра. Уже известное событие
  // не дублируется (`holidays.planEvent`).
  for (const ev of parsed.events.filter((e) => e.kind === 'event')) {
    const planned = planEvent(s, preset, ev);
    if (planned.ok) {
      s = planned.state;
      out.debug.applied.push({ kind: 'event', id: planned.event.id, name: planned.event.name, from: planned.event.from });
    } else if (planned.duplicate) {
      out.debug.applied.push({ kind: 'event-known', name: ev.name });
    }
  }

  // --- (6) одноразовые инжекты ---------------------------------------------
  // Праздник, который идёт сегодня, взводит свой разовый повод — один раз за
  // наступление (`holidays.armHolidayHooks`). Здесь, а не на смене дня: день
  // мог смениться ручным ремонтом или промоткой, и повод прозвучит со
  // следующим ответом, а не потеряется.
  armHolidayHooks(s, preset);
  out.injects = takePending(s);
  out.state = s;
  out.debug.notes = out.notes;
  out.debug.idle = s.calendar.idle;
  out.debug.stalled = isStalled(s, preset);
  return out;
}

/**
 * Развёртка ведомости за сдвиг плюс всё, что из неё следует: отношения, хвосты,
 * репутация. Ровно те же пять шагов, что в `applyResponse`, но одним вызовом —
 * их повторяют и принятый прыжок, и ручной сдвиг со счётом посещаемости.
 */
function sweepAndSettle(state, fromDay, fromPos, unit, preset, opts = {}) {
  const sweep = sweepAttendance(state, fromDay, fromPos, unit, preset, opts);
  let s = sweep.state;
  s = applyRelationDeltas(s, sweep.effects.relation, preset).state;
  for (const id of sweep.effects.debt) s = setDebt(s, id, true, preset);
  if (sweep.effects.reputation) {
    s = changeReputation(s, { delta: sweep.effects.reputation, reason: 'attendance' }, preset).state;
  }
  return { state: s, missed: sweep.missed };
}

/**
 * Что заводит сам календарь, когда время сдвинулось: закрытие отжившей сессии,
 * события со своей неделей, вход в сессию нового периода.
 *
 * Вынесено из `applyResponse` не ради красоты: тем же путём идёт принятый
 * человеком прыжок (`resolveHeldJump`), и оставь мы блок внутри — «принять»
 * переводило бы календарь в декабрь, не открывая сессию, а расписание молчало
 * бы без причины.
 */
function calendarEvents(state, preset) {
  let s = state;
  const applied = [];

  if (examSessionEnded(s, preset, s.calendar.day)) {
    const was = s.exams.term;
    s = closeExamSession(s, preset);
    applied.push({ kind: 'exams-closed', term: was });
  }
  // Виды со своей неделей заводятся здесь же, но по календарю, а не по фазе, и
  // раньше блока сессии: если рывком времени перескочили сразу в
  // экзаменационную неделю, событие середины появится первым и тем же ключом,
  // а вход в сессию его уже не заведёт вторым. Сессию этот вызов не открывает
  // — см. `exams.scheduleDatedExams`.
  const dated = scheduleDatedExams(s, preset, s.calendar.day);
  if (dated.added) {
    s = dated.state;
    applied.push({ kind: 'exams-dated', day: s.calendar.day, added: dated.added });
  }
  if (phaseOf(preset, s, s.calendar.day) === 'exams') {
    const term = examTermIndex(preset, s, s.calendar.day);
    if (!s.exams.active || s.exams.term !== term) {
      s = scheduleExams(s, preset, { day: s.calendar.day, term });
      applied.push({ kind: 'exams-scheduled', day: s.calendar.day, term });
    }
  }
  // Объявление итогов (9.4.3) — тоже событие календаря: «ведомость вывесят в
  // пятницу» случается, когда наступила пятница, чем бы время ни двинулось —
  // меткой, прозой, промоткой или принятым прыжком. Стоит последним: пересдача,
  // которую объявление открывает, сядется уже вызывающим (`sitExam`).
  const told = announceResults(s, preset, s.calendar.day);
  if (told.announced.length) {
    s = told.state;
    applied.push({ kind: 'announced', examIds: told.announced });
  }
  return { state: s, applied };
}

/**
 * Ответ человека на придержанный прыжок вперёд (`time.setAbsolute`,
 * `limits.maxForwardJump`).
 *
 * Прыжок дальше потолка календарь не двигает сам: источник A читает и чужие
 * инфоблоки соседних расширений, а за прыжком едут прогулы, репутация и
 * отношения. Но и выбросить его нельзя — расходиться с видимым текстом поста
 * расширение не вправе (3.2). Поэтому решение остаётся за человеком, и оно
 * приходит сюда.
 *
 * `accept = true` применяет прыжок ровно тем же путём, каким его применил бы
 * ответ модели: `setAbsolute` силой, а следом — та же развёртка ведомости, что
 * в `applyResponse`. Без развёртки принятый прыжок отличался бы от обычного
 * движения времени тем, что пары в пропущенных днях не значатся ни прогулом, ни
 * присутствием, и решение «принять» тихо стирало бы половину недели из зачётки.
 *
 * `accept = false` просто забывает прыжок: календарь остаётся там, где стоял.
 *
 * @returns {{state: Object, applied: boolean, reason: string, missed: Array}}
 */
export function resolveHeldJump(state, preset, accept = true) {
  const held = state && state.calendar && state.calendar.heldJump;
  if (!held) return { state, applied: false, reason: 'придержанного прыжка нет', missed: [] };

  if (!accept) {
    const s = cloneState(state);
    s.calendar.heldJump = null;
    return { state: s, applied: false, reason: `прыжок на ${held.day} отклонён`, missed: [] };
  }

  const fromDay = state.calendar.day;
  const fromPos = posOf(state);
  // Подпись источника — та, что придержала прыжок: A+ остаётся A+ и после
  // «принять». Старые прыжки, придержанные до правки, подписи не несут — это A.
  const r = setAbsolute(state, { day: held.day, time: held.time, daypart: held.daypart }, held.source || 'A', preset, { force: true });
  let s = cloneState(r.state);
  s.calendar.heldJump = null;
  if (!r.applied) return { state: s, applied: false, reason: r.reason, missed: [] };

  // Прыжок, придержанный из промотки (он вышел за её потолок или перешагнул
  // контрольное), после «принять» обходит ведомость по той же политике, что
  // и промотка в потолке: человек выбирал промотку, а не прогул (9.2, 3.4).
  const policy = held.skipPolicy && SKIP_POLICIES.includes(held.skipPolicy) ? held.skipPolicy : skipPolicyOf(preset);
  const swept = sweepAndSettle(s, fromDay, fromPos, 'absolute', preset, { policy });
  // И то, что календарь заводит сам: сессия, закрытая или открытая прыжком.
  s = calendarEvents(swept.state, preset).state;
  return { state: s, applied: true, reason: r.reason, missed: swept.missed };
}

/**
 * Ручной сдвиг календаря из панели — ремонтный инструмент, а не основной канал
 * (3.2). Единственное место во всём расширении, где движение назад разрешено:
 * человек, чинящий календарь руками, знает, что делает, а источник B — нет.
 *
 * Принимает либо абсолютную точку (`day`, `time`), либо относительный сдвиг
 * (`shift`: `{unit, n}` или просто число пар). Если заданы оба, сначала
 * применяется абсолютная точка: она полнее.
 *
 * **Посещаемость по умолчанию не считается** — ремонт календаря не должен
 * наказывать за день, которого не играли. Но и молчать об этом нельзя: человек,
 * двигающий время руками, не обязан догадываться, что половина игры при этом не
 * наступает. Поэтому счёт включается ключом `count`, а `wouldMiss` считается
 * всегда — это то, что зачлось бы, и вызывающий об этом скажет.
 *
 * @param {{day?: string, time?: string, shift?: Object|number, count?: boolean}} patch
 * @returns {{state: Object, applied: boolean, reason: string,
 *   missed: Array, wouldMiss: number}}
 */
export function manualTime(state, { day, time, shift, count = false } = {}, preset) {
  let s = cloneState(state);
  const reasons = [];
  let applied = false;
  const fromDay = s.calendar.day;
  const fromPos = posOf(s);
  let unit = null;

  if (day !== undefined || time !== undefined) {
    const at = {};
    if (day !== undefined) at.day = day;
    if (time !== undefined) at.time = time;
    // `setAbsolute` называет ту же несимметричную защиту `force`, а не
    // `allowBack`: имя разное, правило одно.
    const r = setAbsolute(s, at, 'manual', preset, { force: true });
    s = r.state;
    reasons.push(r.reason);
    applied = applied || r.applied;
    if (r.applied) unit = 'absolute';
  }

  if (shift !== undefined && shift !== null) {
    const ev = typeof shift === 'number' ? { unit: 'period', n: shift } : shift;
    const r = advance(s, ev, preset, { allowBack: true });
    s = r.state;
    reasons.push(r.reason);
    applied = applied || r.applied;
    if (r.applied) unit = ev.unit;
  }

  if (applied) s.calendar.source = 'manual';

  // Развёртка считается всегда, а применяется по просьбе. Считать «вхолостую»
  // дешевле, чем объяснять человеку задним числом, почему прогулов нет: ядро
  // чистое, лишняя копия состояния никуда не уезжает.
  let missed = [];
  let wouldMiss = 0;
  if (applied && unit) {
    const swept = sweepAndSettle(s, fromDay, fromPos, unit, preset);
    wouldMiss = swept.missed.length;
    if (count) {
      s = calendarEvents(swept.state, preset).state;
      missed = swept.missed;
      wouldMiss = 0;
    }
  }

  return { state: s, applied, reason: reasons.filter(Boolean).join('; '), missed, wouldMiss };
}

/**
 * Контрольное «сегодня» — то самое событие, к которому относится `grade=` из
 * ответа (8.1).
 *
 * Отвечает на один вопрос: если модель в этом ответе выставила оценку, за какое
 * контрольное она её выставила и брошен ли он уже. Нет сегодня контрольного —
 * `null`, и `grade=` тогда обычная оценка: ничего особенного в ней нет.
 *
 * «Сегодня контрольное» — это теперь два случая, а не один: день открытой
 * сессии, как было, **или** день события с собственным окном в календаре
 * (`exams.sittableExams`). Второй случай приходится на учебную неделю, где
 * сессии нет вовсе, и держать здесь прежнюю проверку на фазу значило бы, что
 * `grade=` в день середины уходит мимо контрольного второй оценкой в зачётку.
 *
 * Событие выбирается ровно так же, как его выбирает `sitExam`: сперва то, за чем
 * ещё не садились, потом пересдачи. Иначе оценка уходила бы в конфликт по одному
 * контрольному, а бросок случался бы по другому.
 *
 * @returns {?{item: Object, sat: boolean}} `sat` — бросок сегодня уже был
 */
export function todaysExam(state, preset) {
  const day = (state && state.calendar && state.calendar.day) || '';
  if (!day) return null;
  const inSession = phaseOf(preset, state, day) === 'exams' && examMode(state, preset).active;
  // «Сегодня уже бросали» ищется по всем событиям, а не по очереди пересдач:
  // сданное сегодня из `pending` уже ушло, а спорить модель будет именно с ним.
  // Считается оно контрольным сегодняшнего дня на тех же двух основаниях, что и
  // несданное: сессия или собственное окно вида.
  const sat = ((state.exams && state.exams.items) || [])
    .find((i) => i.outcome && i.day === day);
  if (sat && (inSession || isDatedExam(preset, sat))) return { item: sat, sat: true };
  const queue = sittableExams(state, preset, day);
  const next = queue.find((i) => !i.outcome) || queue[0];
  return next ? { item: next, sat: false } : null;
}

/**
 * Одно контрольное событие сессии: балл + отношение + зажатый случай (3.5).
 *
 * Считается ДО того, как модель опишет сцену, и уходит одноразовым инжектом.
 * Если модель всё-таки отыграла свой исход (`opts.modelSaid`), принимается её
 * версия — `exams.resolveConflict`, расхождение в журнал.
 *
 * @param {Object} state
 * @param {Object} preset
 * `opts.dice` — кубик Enhance-Gen из реплики человека (`cues.readDiceRoll`):
 * бросок соседа уже велел модели отыграть «провал» или «успех», и спорить с
 * ним посчитанный исход не может. Свой бросок всё равно делается (в журнале и
 * в истории бросков видно, что дала бы Academy), а исход переписывается
 * значением по ступени кубика через тот же `resolveConflict` с
 * `source: 'dice'` (9.7B: вход для чужих исходов один). Версия модели
 * (`modelSaid`) сильнее кубика: она написана после него, ответом на него.
 *
 * @param {{rng?: () => number, seed?: string, examId?: string, modelSaid?: string,
 *   dice?: ?{tier: string, roll: ?number, dc: ?number}}} [opts]
 * @returns {{state: Object, exam: ?Object, permission: string,
 *   divergence: ?Object, applied: boolean}}
 */
export function sitExam(state, preset, opts = {}) {
  // Источник случайности, по старшинству (9.3.9):
  // 1. `opts.rng` — подставной, для тестов и для того, кто знает лучше;
  // 2. `opts.seed` — воспроизводимый бросок: строка чата (id чата из
  //    `index.js`) плюс событие, попытка и день (`exams.examSeed`). Свайп
  //    пересчитывает ответ из того же снимка — и выпадает то же число;
  // 3. иначе `Math.random`, как было: вызывающий, не передавший ни того ни
  //    другого, получает прежнее поведение, а не тихо сменившийся бросок.
  const rng = typeof opts.rng === 'function'
    ? opts.rng
    : (opts.seed !== undefined && opts.seed !== null && opts.seed !== '' ? null : Math.random);
  const mode = examMode(state, preset);
  // Порядок очереди: сперва то, за чем ещё не садились, и только потом
  // пересдачи. Иначе первый же незачёт запирал бы сессию — расширение сажало
  // бы за него каждый день, пока не сдастся, а до остальных трёх контрольных
  // дело не доходило бы вовсе.
  //
  // Очередь — не только события сессии: у вида может быть собственное окно в
  // календаре, и такое событие сдаётся посреди учебных недель, когда сессии нет
  // (`exams.datedExams`). Оно идёт первым: его окно кончается вместе с периодом,
  // а событие сессии сдавать всё равно только в сессию. Фазу здесь не
  // спрашивают — ворота дня стоят у вызывающего (`index.js:maybeSitExam`,
  // `todaysExam`), и это правило старше нынешней правки.
  const dated = datedExams(state, preset, state.calendar && state.calendar.day);
  // Итог, ещё не объявленный (9.4.3), пересдавать рано — см. `exams.sittableExams`.
  const queue = [...dated, ...mode.pending.filter((i) => !dated.some((d) => d.id === i.id)
    && !awaitingAnnouncement(i))];
  const item = opts.examId
    ? queue.find((i) => i.id === opts.examId)
    : (queue.find((i) => !i.outcome) || queue[0]);
  if (!item) {
    return { state: cloneState(state), exam: null, permission: '', divergence: null, applied: false };
  }
  const said = opts.modelSaid !== undefined && opts.modelSaid !== null && opts.modelSaid !== '';
  if (examRule(state) === 'story') return sitByStory(state, preset, item, said ? String(opts.modelSaid) : '', opts.dice);

  // Балл, по которому судят на сессии, считается ВНУТРИ учебного периода
  // события, а не за весь год: иначе сильный первый триместр подпирал бы исходы
  // третьего. Периодность живёт в `exams.examScore` — здесь только вызов.
  const score = examScore(state, preset, item);
  const teacher = teacherOfSubject(state, item.subjectId);
  const permission = permissionLine(state, preset, { subjectId: item.subjectId, score, kind: item.kind });

  // Репутация входит в сложность (9.4.1, вопрос 8.8): «дают ли поблажку на
  // пересдаче» — это она. Берётся ДО сдачи: исход меняет репутацию ниже, и
  // судить попытку по репутации, которую она сама же и сдвинет, нельзя.
  const roll = rollOutcome(
    {
      score,
      relation: teacher ? teacher.relation : 0,
      reputation: state.reputation ? state.reputation.value : undefined,
      kind: item.kind,
    },
    preset,
    rng || seededRng(examSeed(opts.seed, item, state.calendar && state.calendar.day)),
  );
  let s = applyOutcome(
    state,
    { examId: item.id, value: roll.value, day: state.calendar.day, reason: roll.reason, check: roll.check },
    preset,
  ).state;

  // Расхождение с текстом модели: спорить с уже написанным нельзя (3.5).
  let divergence = null;
  let external = null;
  if (opts.modelSaid !== undefined && opts.modelSaid !== null && opts.modelSaid !== '') {
    const conflict = resolveConflict(s, { examId: item.id, modelSaid: opts.modelSaid }, preset);
    s = conflict.state;
    divergence = conflict.divergence;
  } else if (opts.dice && roll.reason !== 'auto') {
    // Автомат кубиком не переигрывается: его ставят без испытания, и бросок
    // соседа в этот день — про что-то другое.
    const value = externalValue(preset, item.kind, opts.dice);
    if (value) {
      const conflict = resolveConflict(s, { examId: item.id, modelSaid: value, source: 'dice' }, preset);
      s = conflict.state;
      divergence = conflict.divergence;
      external = { source: 'dice', tier: opts.dice.tier, roll: opts.dice.roll ?? null, dc: opts.dice.dc ?? null, value };
    }
  }

  const done = s.exams.items.find((i) => i.id === item.id) || item;

  // Репутация считается по исходу ЭТОЙ попытки, а не по флагу предмета.
  // `subjectScore().passed` отвечает на другой вопрос — «нет хвоста и когда-то
  // была проходная оценка», — и на сессии это расходилось с тем, что уходило в
  // игру: провал с оставшимися пересдачами хвоста не ставит, а тройка за
  // сентябрь никуда не девается, и заваленный экзамен поднимал репутацию на
  // +2, пока инжект в том же ответе говорил «отправлена на пересдачу».
  // Версия модели (`resolveConflict`) здесь уже учтена: `done.outcome` — то,
  // что в итоге записано, а не то, что посчитал бросок.
  const delta = (preset.reputation && preset.reputation.delta) || {};
  s = changeReputation(s, {
    delta: isPassing(preset, done.outcome) ? delta.examPassed : delta.examFailed,
    reason: 'exam',
  }, preset).state;
  return {
    state: s,
    // `check` — вся проверка (DC, слагаемые, бросок, ступень): её печатает
    // отладка (`ui.describeApplied`) и её же покажет анимация броска. У
    // автомата проверки нет — `null`.
    exam: {
      examId: item.id, subjectId: item.subjectId, value: done.outcome, reason: roll.reason, check: roll.check,
      ...(external ? { external } : {}),
      // Итог посчитан, но ещё не объявлен (9.4.3) — дата объявления.
      ...(awaitingAnnouncement(done) ? { announceOn: done.announceOn } : {}),
    },
    permission,
    divergence,
    applied: true,
  };
}

/**
 * Контрольное по правилу «решает сюжет» (`exams.examRule`). Броска нет:
 * исход — то, что сцена сказала меткой рассказчика или разбором секретаря, а
 * кубик соседа в реплике человека — тоже часть сцены, её бросил сам человек.
 * Сцена промолчала — сегодня никто не садился: контрольное ждёт следующего
 * ответа, а не сыгранное до конца сессии станет хвостом.
 *
 * Хвост вызова — тот же, что у броска: строка допуска, репутация по исходу
 * этой попытки, объявление итога по правилу пресета.
 */
function sitByStory(state, preset, item, said, dice) {
  let value = said;
  let external = null;
  if (!value && dice) {
    value = externalValue(preset, item.kind, dice);
    if (value) external = { source: 'dice', tier: dice.tier, roll: dice.roll ?? null, dc: dice.dc ?? null, value };
  }
  if (!value) return { state: cloneState(state), exam: null, permission: '', divergence: null, applied: false };

  const score = examScore(state, preset, item);
  const permission = permissionLine(state, preset, { subjectId: item.subjectId, score, kind: item.kind });
  let s = applyOutcome(state, { examId: item.id, value, day: state.calendar.day, reason: 'story', check: null }, preset).state;
  const done = s.exams.items.find((i) => i.id === item.id) || item;
  const delta = (preset.reputation && preset.reputation.delta) || {};
  s = changeReputation(s, {
    delta: isPassing(preset, done.outcome) ? delta.examPassed : delta.examFailed,
    reason: 'exam',
  }, preset).state;
  return {
    state: s,
    exam: {
      examId: item.id, subjectId: item.subjectId, value: done.outcome, reason: 'story', check: null,
      ...(external ? { external } : {}),
      ...(awaitingAnnouncement(done) ? { announceOn: done.announceOn } : {}),
    },
    permission,
    divergence: null,
    applied: true,
  };
}

// --- время ------------------------------------------------------------------

/**
 * Кто двигает календарь в этом ответе.
 *
 * Таблица 3.2, слева направо, плюс машинные теги соседей (9.2):
 *
 * | режим     | A+ (теги) | A (проза) | B (метка) |
 * |-----------|-----------|-----------|-----------|
 * | context   | первым    | да        | нет       |
 * | marker    | нет       | нет       | да        |
 * | auto      | первым    | вторым    | подстраховкой |
 *
 * Кого спрашивать и в каком порядке, решает `time-source.readTime` — здесь
 * только применение. A+ и A применяются ОДНИМ путём (`fromContext`): тот же
 * `setAbsolute`, та же защита от отката, тот же потолок прыжка с
 * придерживанием. Доверие к тегу даёт ему место в очереди, но не право мимо
 * защиты: чужое расширение тоже может завести свой календарь в чужом году.
 *
 * «Первым» — то самое расхождение с черновиком `post()`, где метка спрашивалась
 * раньше прозы. Подстраховка вступает в дело только тогда, когда источник A
 * промолчал: если A назвал время и календарь его отверг (откат назад), это не
 * молчание, а ошибка источника, и подставлять вместо неё метку значило бы снова
 * разъехаться с видимым текстом.
 */
function applyTime(state, text, parsed, mode, preset, opts) {
  let s = state;
  const notes = [];
  const applied = [];
  let held = null;

  let moved = false;
  let unit = null;
  let source = null;
  let via = null;

  // Время читается один раз на ответ и в одном месте: `readTime` сам
  // расставляет очередь источников (A+ → A → B) и сам достраивает год — год
  // календаря для дат без года, опорный год для двузначного (9.1.5), переход
  // через Новый год. Второго мнения у сшивки нет.
  //
  // История, которую здесь хранил комментарий: год в прозу когда-то никто не
  // подставлял, и «Среда, 2 сентября» в шапке двигала часы и не двигала дату —
  // календарь навсегда застревал в одном дне. Поймано на живой таверне 1.18.0;
  // теперь это делает `time-source`.
  const read = readTime(text, {
    mode,
    state: s,
    relative: Boolean(opts.relativeWords),
    markerEvents: parsed.events,
  });
  const hit = read.context;
  // Телефонный ход (9.2): сцена на паузе, пока героиня переписывается, и
  // `t=+1` из метки за такой ход не проводится — иначе пара, которую
  // «пересидела» переписка, становилась прогулом. Проза и теги соседей
  // остаются: их время видно в тексте, и спорить с ним нельзя (3.2); а часы
  // телефона (`tel:time`) на паузе стоят и сами никуда не уводят.
  const timeEvents = read.marker && !opts.phoneTurn ? read.marker.events : [];
  if (opts.phoneTurn && read.marker && read.marker.events.length) {
    applied.push({ kind: 'time-dropped', reason: 'phone-turn', events: read.marker.events.length });
  }
  // Промотка, которую выбрал человек (9.2): потолок прыжка поднят для этого
  // ответа, и только для прыжка датой. Защита от отката остаётся на месте —
  // «промотать назад» кнопка Enhance-Gen не умеет, а модель умеет ошибиться.
  const jumpPreset = opts.skip ? opts.skip.preset : preset;

  // Часть суток словом календарь не двигает (3.2), она только уточняет `daypart`
  // — и потому не считается высказыванием источника: «она проснулась утром» не
  // обязано отнимать у метки право сдвинуть время в том же ответе.
  if (hit && hit.daypart && !hit.day && !hit.time && !hit.relative) {
    s = cloneState(s);
    s.calendar.daypart = hit.daypart;
    applied.push({ kind: 'daypart', source: 'A', daypart: hit.daypart });
  }

  const fromContext = () => {
    if (!hit) return false;

    // Относительный сдвиг словами: та же арифметика, что у метки, но источник
    // другой. `advance` не знает единиц «час» и «месяц» и отвергает их сам —
    // додумывать за него, сколько дней в месяце, сшивка не вправе.
    if (hit.relative) {
      const r = advance(s, hit.relative, preset);
      s = r.state;
      source = 'A';
      via = hit.via || null;
      if (r.applied) {
        moved = true;
        unit = hit.relative.unit;
        s.calendar.source = 'A'; // `advance` подписывается меткой; здесь двигала проза
        applied.push({ kind: 'time', source: 'A', unit: hit.relative.unit, n: hit.relative.n, matched: hit.matched });
      } else notes.push(r.reason);
      return true;
    }

    if (!(hit.day || hit.time)) return false;
    // A+ и A — одна ветка и один вызов: различаются они только подписью.
    const who = hit.source === 'A+' ? 'A+' : 'A';
    const r = setAbsolute(s, { day: hit.day, time: hit.time, daypart: hit.daypart }, who, jumpPreset);
    s = r.state;
    source = who;
    via = hit.via || null;
    if (r.applied) {
      moved = true;
      unit = 'absolute';
      applied.push({ kind: 'time', source: who, via, day: hit.day, time: hit.time, matched: hit.matched });
    } else {
      notes.push(r.reason);
      // Прыжок вперёд дальше потолка календарь не двигает, но и не забывает:
      // источник A читает в том числе чужие инфоблоки соседних расширений, а
      // спорить с видимым текстом поста расширение не вправе (3.2). Поэтому
      // прыжок придерживается со строкой, из которой он вычитан, и человек
      // отвечает «принять» или «не надо» одной кнопкой в панели.
      if (r.held) {
        s = cloneState(s);
        // Подпись источника едет вместе с прыжком: панель скажет, чей это тег,
        // а «принять» применит его под той же подписью (`resolveHeldJump`).
        s.calendar.heldJump = { ...r.held, matched: hit.matched, source: who, via };
        // Придержанный из промотки прыжок помнит её политику посещаемости:
        // «принять» обойдёт ведомость так же, как обошла бы промотка в потолке.
        s.calendar.heldJump.skipPolicy = opts.skip ? opts.skip.policy : skipPolicyOf(preset);
        held = s.calendar.heldJump;
        applied.push({ kind: 'time-held', source: who, via, day: r.held.day, jump: r.held.jump });
      }
    }
    return true; // источник высказался — молчанием это уже не считается
  };

  const fromMarker = () => {
    if (!timeEvents.length) return false;
    for (const ev of timeEvents) {
      // `allowBack` не передаётся: метка модели правом двигать календарь назад
      // не обладает, и отказ приходит из `time.advance` — сшивка ему доверяет,
      // своей защиты у неё нет. Ручной ремонт идёт через `manualTime`.
      const r = advance(s, ev, preset);
      s = r.state;
      if (r.applied) {
        moved = true;
        unit = ev.unit;
        source = 'B';
        via = 'marker';
        applied.push({ kind: 'time', source: 'B', unit: ev.unit, n: ev.n });
      } else {
        source = source || 'B';
        via = via || 'marker';
        notes.push(r.reason);
      }
    }
    return true;
  };

  let spoke = false;
  if (mode === 'marker') spoke = fromMarker();
  else if (mode === 'context') spoke = fromContext();
  else spoke = fromContext() || fromMarker();

  // Телефонный ход без единого источника — не простой: сцена стоит на паузе
  // нарочно, и индикатор «время стоит» (3.2) не должен копить переписку.
  if (!spoke && !opts.phoneTurn) s = noteIdle(s);

  // Время всё-таки пошло — придержанный прыжок протух: он был про «отсюда
  // туда», а «отсюда» уже другое. Держать его дальше значит однажды предложить
  // человеку прыгнуть из позапрошлого дня.
  if (moved && s.calendar.heldJump && s.calendar.heldJump !== held) {
    s = cloneState(s);
    s.calendar.heldJump = null;
  }
  return { state: s, moved, unit, source, via, notes, applied, held };
}

// --- ведомость --------------------------------------------------------------

/**
 * Пары, оставшиеся позади, разносятся по ведомости.
 *
 * Правило прямо из 3.4: «если пара прошла, а сцена всё это время была в другом
 * месте, она считается пропущенной». Отличить одно от другого можно по тому, чем
 * двигалось время: `t=+1` — сцена идёт по учебному дню, пара за парой, значит
 * студентка на месте; `t=+1 day` и прыжок датой из прозы — день перескочили
 * целиком, и всё, что в нём стояло, прошло без неё.
 *
 * Перелив через полночь считается сдвигом по парам, а не прыжком: четвёртое
 * подряд `t=+1` в дне из четырёх пар уводит календарь в следующий учебный день
 * (`time.advancePeriods`), и последняя пара дня обязана остаться посещённой, а
 * не превратиться в прогул на ровном месте.
 *
 * Записи, которые уже есть (`skip=` из метки), ни одна ветка не трогает:
 * `inferMissed` их пропускает, `present` ставится только на пустой слот.
 *
 * `opts.policy` — как считать дни, перешагнутые промоткой (`skipPolicyOf`):
 * `absent` — как любой прыжок, прогулом; `attend`/`ask` — присутствием.
 *
 * **Прыжок через дни — одна сводка, а не пачка (9.4.4).** Неделя без героини —
 * двадцать отметок, и по строке журнала на каждую (плюс строка сдвига
 * отношения на каждый прогул) выедали кольцевой журнал: двести строк, из
 * которых хроника лорбука и вехи берут даты экзаменов и переходов отношения.
 * Поэтому при прыжке через дни отметки пишутся без журнала, сдвиги отношения
 * сводятся по наставникам (`relations.mergeDeltas`), а в журнал ложится одна
 * строка `jump` со счётом. Та же сводка возвращается `summary` — из неё панель
 * делает один тост «+N пар» вместо пачки. Ход по парам (`t=+1`) — не прыжок:
 * там отметок одна-две, и журнал остаётся прежним.
 */
export function sweepAttendance(state, fromDay, fromPos, unit, preset, opts = {}) {
  let s = state;
  const policy = SKIP_POLICIES.includes(opts.policy) ? opts.policy : 'absent';
  const missed = [];
  const effects = { relation: [], reputation: 0, debt: [] };
  if (!unit) return { state: s, missed, effects, summary: null };
  const quiet = unit !== 'period';
  const markOpts = quiet ? { journal: false } : {};
  let presentCount = 0;

  const present = (acc, day, from, to) => {
    // Сутки заведения семестра ведомостью не обсчитываются вовсе, ни в одну
    // сторону: ни выведенных прогулов, ни выведенного присутствия
    // (`attendance.countsAttendance`).
    if (!countsAttendance(acc, day)) return acc;
    for (const item of dayPlan(acc, preset, day)) {
      if (item.index < from || item.index >= to) continue;
      const taken = acc.attendance.records.some(
        (r) => r.day === day && r.subjectId === item.subjectId && r.periodIndex === item.index,
      );
      if (taken) continue;
      const res = mark(acc, { subjectId: item.subjectId, status: 'present', day, periodIndex: item.index }, preset, markOpts);
      acc = res.state;
      presentCount += 1;
      absorb(effects, res.effects);
    }
    return acc;
  };

  if (unit === 'period') {
    if (s.calendar.day === fromDay) return { state: present(s, fromDay, fromPos, posOf(s)), missed, effects, summary: null };
    s = present(s, fromDay, fromPos, Infinity);
    return { state: present(s, s.calendar.day, 0, posOf(s)), missed, effects, summary: null };
  }

  // Сводка прыжка — одна на вызов, чем бы он ни кончился.
  const finish = (acc) => {
    const days = isDayStr(fromDay) && isDayStr(acc.calendar.day) ? Math.max(0, dayDiff(fromDay, acc.calendar.day)) : 0;
    const summary = {
      fromDay, toDay: acc.calendar.day, days,
      periods: missed.length + presentCount, missed: missed.length, present: presentCount, policy,
    };
    effects.relation = mergeDeltas(effects.relation);
    if (summary.periods) {
      acc = pushJournal(cloneState(acc), {
        kind: 'attendance',
        text: `jump ${fromDay} -> ${acc.calendar.day}: +${summary.periods} (skip ${summary.missed}, present ${summary.present})`,
        data: { jump: true, ...summary },
      }, preset);
    }
    // Прыжок внутри тех же суток без единой пары — не о чем и тостить.
    return { state: acc, missed, effects, summary: summary.days || summary.periods ? summary : null };
  };

  // Решение «дозаполнять ли ведомость за этот прыжок» принимает ядро, и ровно
  // один раз на прыжок: горизонта в сшивке нет ни константой, ни условием.
  if (!shouldInfer(fromDay, s.calendar.day, preset)) {
    s = pushJournal(cloneState(s), {
      kind: 'attendance',
      text: `attendance skipped: ${fromDay} -> ${s.calendar.day}`,
      data: { fromDay, toDay: s.calendar.day },
    }, preset);
    return finish(s);
  }

  // Промотка с политикой «была на парах» (`skipPolicy: attend`, 9.2): те же
  // дни, тот же горизонт, но вместо прогула — присутствие. Человек промотал
  // скучную неделю, а не прогулял её; «ремонт не наказывает» (README). `ask`
  // пока ведёт себя как `attend` — см. `skipPolicyOf`.
  if (policy !== 'absent') {
    for (let day = fromDay; day < s.calendar.day; day = addDays(day, 1)) {
      if (!isStudyDay(preset, day, s)) continue;
      s = present(s, day, day === fromDay ? fromPos : 0, Infinity);
    }
    return finish(s);
  }

  // День сменился прыжком: всё, что стояло в пройденных учебных днях, прошло мимо.
  for (let day = fromDay; day < s.calendar.day; day = addDays(day, 1)) {
    if (!isStudyDay(preset, day, s)) continue;
    const expected = dayPlan(s, preset, day).map((p) => ({ subjectId: p.subjectId, periodIndex: p.index }));
    if (!expected.length) continue; // сессия и каникулы: лекций нет, прогуливать нечего
    const res = inferMissed(s, { day, expected }, preset, markOpts);
    s = res.state;
    missed.push(...res.missed);
    absorb(effects, res.effects);
  }
  return finish(s);
}

// --- повод сдвига отношения (9.7B) -----------------------------------------

/**
 * Повод одного `rel=` из метки — по тому, что механика видит в этом же ответе.
 *
 * Порядок — от самого точного к самому общему: оценка по предмету наставника
 * в этой же метке; контрольное по его предмету, сданное сегодня (сцена
 * экзамена — самый частый повод «сорван зачёт»); отметка из метки (`skip=`,
 * `late=`); прогул, выведенный календарём. Ничего не нашлось — повод из слов
 * модели (`kind: 'marker'`), а нет и их — `null`. Слова модели, если есть,
 * едут с любым найденным поводом полем `text`.
 */
function relReason(state, ev, events, missed) {
  const subjects = (state.subjects || [])
    .filter((x) => x.teacherId === ev.teacherId)
    .map((x) => x.id);
  const mine = (id) => subjects.includes(id);
  const text = ev.reason ? { text: ev.reason } : {};

  const grade = events.find((x) => x.kind === 'grade' && mine(x.subjectId));
  if (grade) return { kind: 'grade', subjectId: grade.subjectId, value: String(grade.value), ...text };

  const day = state.calendar && state.calendar.day;
  const exam = ((state.exams && state.exams.items) || [])
    .find((i) => i.outcome && i.day === day && mine(i.subjectId));
  if (exam) return { kind: 'exam', subjectId: exam.subjectId, examId: exam.id, value: String(exam.outcome), ...text };

  const mark = events.find((x) => x.kind === 'attendance' && mine(x.subjectId));
  if (mark) return { kind: mark.status, subjectId: mark.subjectId, ...text };

  const skipped = (missed || []).filter(mine);
  if (skipped.length) return { kind: 'skip', subjectId: skipped[0], count: skipped.length, ...text };

  return ev.reason ? { kind: 'marker', text: ev.reason } : null;
}

// --- мелочи -----------------------------------------------------------------

const isDayStr = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

function absorb(acc, effects) {
  acc.relation.push(...effects.relation);
  acc.reputation += effects.reputation;
  acc.debt.push(...effects.debt.filter((id) => !acc.debt.includes(id)));
}

/** Сырая метка целиком — режим отладки показывает «что пришло» (3.2). */
function markerText(text) {
  if (typeof text !== 'string' || !text) return null;
  const hits = [...text.matchAll(MARKER_RE)];
  return hits.length ? hits[hits.length - 1][0].trim() : null;
}

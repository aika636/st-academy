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
  advance, setAbsolute, noteIdle, phaseOf, isStudyDay, isStalled, addDays,
} from './time.mjs';
import { dayPlan } from './schedule.mjs';
import { parseMarker, stripMarker, MARKER_RE } from './parse-marker.mjs';
import { parseContext } from './parse-context.mjs';
import { addGrade, setDebt, REJECT_UNKNOWN_VALUE } from './gradebook.mjs';
import { mark, inferMissed, shouldInfer, countsAttendance } from './attendance.mjs';
import { applyRelationDeltas } from './relations.mjs';
import { changeReputation } from './reputation.mjs';
import {
  scheduleExams, examMode, rollOutcome, applyOutcome, resolveConflict, permissionLine,
  examTermIndex, examSessionEnded, closeExamSession, isPassing, examScore,
  scheduleDatedExams, datedExams, sittableExams, isDatedExam,
} from './exams.mjs';

/** Режимы источника времени из таблицы 3.2. */
export const MODES = ['auto', 'context', 'marker'];

/** Позиция в дне при точности «только день»: счётчик пар, а не часы. */
const posOf = (state) => (Number.isFinite(state.calendar.periodIndex) ? state.calendar.periodIndex : 0);

/** Год, в котором сейчас живёт календарь: им достраиваются даты без года. */
function yearOf(state) {
  const day = state && state.calendar && state.calendar.day;
  const year = typeof day === 'string' ? Number(day.slice(0, 4)) : NaN;
  return Number.isFinite(year) ? year : undefined;
}

/**
 * Переход через Новый год для даты, у которой год подставили мы.
 *
 * «3 января» в конце декабря с подставленным текущим годом уезжает на одиннадцать
 * месяцев назад, и `setAbsolute` отвергнет это как откат. Учебный год через
 * январь переваливает у всех трёх пресетов, так что случай обычный, а не
 * краевой. Правим только там, где год подставлен нами (`yearFromText === false`)
 * и промах больше полугода: настоящий флешбэк с написанным годом не трогаем
 * никогда, а обычный сдвиг вперёд на день-два под условие не попадает.
 */
const ROLLOVER_DAYS = 180;

function rollYear(hit, state) {
  if (!hit || !hit.day || hit.yearFromText) return hit;
  const from = state && state.calendar && state.calendar.day;
  if (typeof from !== 'string') return hit;

  const gapDays = (Date.parse(from) - Date.parse(hit.day)) / 86400000;
  if (!Number.isFinite(gapDays) || gapDays <= ROLLOVER_DAYS) return hit;

  const parts = hit.dateParts;
  if (!parts || typeof parts.year !== 'number') return hit;
  const bumped = { ...parts, year: parts.year + 1 };
  const day = `${String(bumped.year).padStart(4, '0')}-${String(bumped.month).padStart(2, '0')}-${String(bumped.day).padStart(2, '0')}`;
  return { ...hit, day, dateParts: bumped };
}

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
 * @param {() => number} [opts.rng=Math.random]
 * @returns {{state: Object, injects: Array, rejected: Array, missed: Array,
 *   notes: string[], exam: ?Object, permission: string, divergence: ?Object,
 *   modelSaid: ?{examId: string, subjectId: string, value: string},
 *   debug: {mode: string, source: ?('A'|'B'), moved: boolean, marker: ?string,
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
    debug: {
      mode,
      source: null,
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
  const lexicon = { ...preset, subjects: s.subjects, teachers: s.teachers };
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
  const fromDay = s.calendar.day;
  const fromPos = posOf(s);
  const moveRes = applyTime(s, src, parsed, mode, preset, opts);
  s = moveRes.state;
  out.notes.push(...moveRes.notes);
  out.debug.source = moveRes.source;
  out.debug.moved = moveRes.moved;
  out.heldJump = s.calendar.heldJump || null;
  out.debug.applied.push(...moveRes.applied);

  // --- (4) что стало с парами, которые прошли -------------------------------
  const sweep = sweepAttendance(s, fromDay, fromPos, moveRes.unit, preset);
  s = sweep.state;
  out.missed = sweep.missed;
  absorb(effects, sweep.effects);
  if (sweep.missed.length) out.debug.applied.push({ kind: 'missed', count: sweep.missed.length });

  // --- отношения из метки ---------------------------------------------------
  const relEvents = parsed.events.filter((e) => e.kind === 'rel');
  s = applyRelationDeltas(s, relEvents, preset).state;
  for (const ev of relEvents) out.debug.applied.push({ kind: 'rel', teacherId: ev.teacherId, delta: ev.delta });

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
    const sat = sitExam(s, preset, { rng: opts.rng, examId: opts.examId, modelSaid: said });
    s = sat.state;
    out.exam = sat.exam;
    out.permission = sat.permission;
    out.divergence = sat.divergence;
    if (sat.applied) out.debug.applied.push({ kind: 'exam', ...sat.exam });
  }

  // --- (6) одноразовые инжекты ---------------------------------------------
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
function sweepAndSettle(state, fromDay, fromPos, unit, preset) {
  const sweep = sweepAttendance(state, fromDay, fromPos, unit, preset);
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
  const r = setAbsolute(state, { day: held.day, time: held.time, daypart: held.daypart }, 'A', preset, { force: true });
  let s = cloneState(r.state);
  s.calendar.heldJump = null;
  if (!r.applied) return { state: s, applied: false, reason: r.reason, missed: [] };

  const swept = sweepAndSettle(s, fromDay, fromPos, 'absolute', preset);
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
 * @param {{rng?: () => number, examId?: string, modelSaid?: string}} [opts]
 * @returns {{state: Object, exam: ?Object, permission: string,
 *   divergence: ?Object, applied: boolean}}
 */
export function sitExam(state, preset, opts = {}) {
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
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
  const queue = [...dated, ...mode.pending.filter((i) => !dated.some((d) => d.id === i.id))];
  const item = opts.examId
    ? queue.find((i) => i.id === opts.examId)
    : (queue.find((i) => !i.outcome) || queue[0]);
  if (!item) {
    return { state: cloneState(state), exam: null, permission: '', divergence: null, applied: false };
  }

  // Балл, по которому судят на сессии, считается ВНУТРИ учебного периода
  // события, а не за весь год: иначе сильный первый триместр подпирал бы исходы
  // третьего. Периодность живёт в `exams.examScore` — здесь только вызов.
  const score = examScore(state, preset, item);
  const teacher = teacherOfSubject(state, item.subjectId);
  const permission = permissionLine(state, preset, { subjectId: item.subjectId, score, kind: item.kind });

  const roll = rollOutcome(
    { score, relation: teacher ? teacher.relation : 0, kind: item.kind },
    preset,
    rng,
  );
  let s = applyOutcome(
    state,
    { examId: item.id, value: roll.value, day: state.calendar.day, reason: roll.reason },
    preset,
  ).state;

  // Расхождение с текстом модели: спорить с уже написанным нельзя (3.5).
  let divergence = null;
  if (opts.modelSaid !== undefined && opts.modelSaid !== null && opts.modelSaid !== '') {
    const conflict = resolveConflict(s, { examId: item.id, modelSaid: opts.modelSaid }, preset);
    s = conflict.state;
    divergence = conflict.divergence;
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
    exam: { examId: item.id, subjectId: item.subjectId, value: done.outcome, reason: roll.reason },
    permission,
    divergence,
    applied: true,
  };
}

// --- время ------------------------------------------------------------------

/**
 * Кто двигает календарь в этом ответе.
 *
 * Таблица 3.2, слева направо:
 *
 * | режим     | A (проза) | B (метка) |
 * |-----------|-----------|-----------|
 * | context   | да        | нет       |
 * | marker    | нет       | да        |
 * | auto      | первым    | подстраховкой |
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
  const timeEvents = mode === 'context' ? [] : parsed.events.filter((e) => e.kind === 'time');

  let moved = false;
  let unit = null;
  let source = null;

  // Проза читается один раз на ответ: `parseContext` сам расставляет приоритеты
  // внутри поста, второго мнения у сшивки нет.
  const rawHit = mode === 'marker'
    ? null
    : parseContext(stripMarker(text), {
      relative: Boolean(opts.relativeWords),
      // Год из текущего календаря. `parseContext` умышленно не додумывает его
      // сам (см. `build`): без года `day` остаётся null, а день с месяцем
      // уезжают в `dateParts` — «чтобы вызывающий подставил год сам».
      // Вызывающий — здесь, и до сих пор он этого не делал: «Среда,
      // 2 сентября» в шапке двигала часы и не двигала дату, потому что год в
      // отыгрыше почти никогда не пишут. Календарь при этом навсегда застревал
      // в одном дне — том самом «время не идёт», ради которого писалась
      // отладка. Поймано на живой таверне 1.18.0.
      year: yearOf(s),
    });
  const hit = rollYear(rawHit, s);

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
      if (r.applied) {
        moved = true;
        unit = hit.relative.unit;
        s.calendar.source = 'A'; // `advance` подписывается меткой; здесь двигала проза
        applied.push({ kind: 'time', source: 'A', unit: hit.relative.unit, n: hit.relative.n, matched: hit.matched });
      } else notes.push(r.reason);
      return true;
    }

    if (!(hit.day || hit.time)) return false;
    const r = setAbsolute(s, { day: hit.day, time: hit.time, daypart: hit.daypart }, 'A', preset);
    s = r.state;
    source = 'A';
    if (r.applied) {
      moved = true;
      unit = 'absolute';
      applied.push({ kind: 'time', source: 'A', day: hit.day, time: hit.time, matched: hit.matched });
    } else {
      notes.push(r.reason);
      // Прыжок вперёд дальше потолка календарь не двигает, но и не забывает:
      // источник A читает в том числе чужие инфоблоки соседних расширений, а
      // спорить с видимым текстом поста расширение не вправе (3.2). Поэтому
      // прыжок придерживается со строкой, из которой он вычитан, и человек
      // отвечает «принять» или «не надо» одной кнопкой в панели.
      if (r.held) {
        s = cloneState(s);
        s.calendar.heldJump = { ...r.held, matched: hit.matched };
        held = s.calendar.heldJump;
        applied.push({ kind: 'time-held', source: 'A', day: r.held.day, jump: r.held.jump });
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
        applied.push({ kind: 'time', source: 'B', unit: ev.unit, n: ev.n });
      } else {
        source = source || 'B';
        notes.push(r.reason);
      }
    }
    return true;
  };

  let spoke = false;
  if (mode === 'marker') spoke = fromMarker();
  else if (mode === 'context') spoke = fromContext();
  else spoke = fromContext() || fromMarker();

  if (!spoke) s = noteIdle(s);

  // Время всё-таки пошло — придержанный прыжок протух: он был про «отсюда
  // туда», а «отсюда» уже другое. Держать его дальше значит однажды предложить
  // человеку прыгнуть из позапрошлого дня.
  if (moved && s.calendar.heldJump && s.calendar.heldJump !== held) {
    s = cloneState(s);
    s.calendar.heldJump = null;
  }
  return { state: s, moved, unit, source, notes, applied, held };
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
 */
export function sweepAttendance(state, fromDay, fromPos, unit, preset) {
  let s = state;
  const missed = [];
  const effects = { relation: [], reputation: 0, debt: [] };
  if (!unit) return { state: s, missed, effects };

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
      const res = mark(acc, { subjectId: item.subjectId, status: 'present', day, periodIndex: item.index }, preset);
      acc = res.state;
      absorb(effects, res.effects);
    }
    return acc;
  };

  if (unit === 'period') {
    if (s.calendar.day === fromDay) return { state: present(s, fromDay, fromPos, posOf(s)), missed, effects };
    s = present(s, fromDay, fromPos, Infinity);
    return { state: present(s, s.calendar.day, 0, posOf(s)), missed, effects };
  }

  // Решение «дозаполнять ли ведомость за этот прыжок» принимает ядро, и ровно
  // один раз на прыжок: горизонта в сшивке нет ни константой, ни условием.
  if (!shouldInfer(fromDay, s.calendar.day, preset)) {
    s = pushJournal(cloneState(s), {
      kind: 'attendance',
      text: `attendance skipped: ${fromDay} -> ${s.calendar.day}`,
      data: { fromDay, toDay: s.calendar.day },
    }, preset);
    return { state: s, missed, effects };
  }

  // День сменился прыжком: всё, что стояло в пройденных учебных днях, прошло мимо.
  for (let day = fromDay; day < s.calendar.day; day = addDays(day, 1)) {
    if (!isStudyDay(preset, day)) continue;
    const expected = dayPlan(s, preset, day).map((p) => ({ subjectId: p.subjectId, periodIndex: p.index }));
    if (!expected.length) continue; // сессия и каникулы: лекций нет, прогуливать нечего
    const res = inferMissed(s, { day, expected }, preset);
    s = res.state;
    missed.push(...res.missed);
    absorb(effects, res.effects);
  }
  return { state: s, missed, effects };
}

// --- мелочи -----------------------------------------------------------------

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

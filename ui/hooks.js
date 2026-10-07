// ui/hooks.js — вид для соседей: то, что `index.js` отдаёт наружу через
// `window.AcademyAPI`. DOM не трогает.

import { labelFor } from '../core/state.mjs';
import { debts } from '../core/gradebook.mjs';
import { reasonText } from '../core/relations.mjs';
import { dayOfWeek } from '../core/time.mjs';
import { awaitingAnnouncement, gradeInfo, isPassing, publicView } from '../core/exams.mjs';
import { WEEKDAYS, uiLabels, fill, whereText } from './common.js';
import { todayView } from './today.js';

// --- вид для соседей: `window.AcademyAPI` (9.4.8, 9.7B) -----------------------
//
// Три функции ниже — то, что `index.js` отдаёт наружу через `AcademyAPI`. Они
// здесь, а не в `index.js`, по тому же правилу, что остальные вью: чистые,
// проверяются `node --test` без таверны. Выход — простые объекты и строки,
// каждый раз новые: сосед, поправивший ответ у себя, не должен поправить
// состояние семестра.

/**
 * Где календарь: `{started, day, time, precision}`. Без семестра — `null`:
 * соседу честнее узнать «Academy не ведёт учёбу в этом чате», чем получить
 * день, которого нет.
 */
export function hookNow(state) {
  if (!state || !state.started || !state.calendar) return null;
  const c = state.calendar;
  return {
    started: true,
    day: c.day,
    time: c.precision === 'datetime' && c.time ? c.time : null,
    precision: c.precision,
    weekday: WEEKDAYS[dayOfWeek(c.day)] || '',
  };
}

/**
 * Учебный день для соседа: день, неделя, фаза, текущее и следующее занятие.
 * Собирается из `todayView` — того же вью, что рисует «Сегодня», — чтобы
 * сосед и панель не расходились ни в одном слове. Числа отношений сюда не
 * попадают: их нет и в `todayView`.
 */
export function hookToday(state, preset) {
  if (!state || !state.started) return null;
  const v = todayView(state, preset);
  if (v.kind !== 'ok') return null;
  const where = (id) => whereText((state.subjects || []).find((s) => s.id === id));
  const period = v.now ? {
    status: v.now.status,
    ordinal: v.now.ordinal,
    subjectId: v.now.subjectId,
    subject: v.now.name,
    teacher: v.now.teacher,
    start: v.now.start,
    end: v.now.end,
    where: where(v.now.subjectId),
    text: v.now.slotText,
  } : null;
  const next = v.next ? {
    subjectId: v.next.subjectId,
    subject: v.next.name,
    teacher: v.next.teacher,
    day: v.next.day,
    when: v.next.when,
    where: where(v.next.subjectId),
  } : null;
  return {
    day: v.day,
    dateLine: v.dateLine,
    weekday: WEEKDAYS[dayOfWeek(v.day)] || '',
    time: v.time,
    week: v.week,
    weekLine: v.weekLine,
    term: { index: v.termIndex, name: v.termLine || v.termName || '', count: v.termsCount },
    phase: v.phase,
    phaseLabel: v.phaseLabel,
    silent: v.silent,
    silentReason: v.silentReason,
    period,
    next,
  };
}

/**
 * Короткая строка «где героиня в учёбе» — для соседей и для библиотек сейвов
 * (9.7B): «второй триместр, среда, 3-й урок, красные баллы: 1».
 *
 * Все слова — пресета: номер занятия — `ui.slot`, счётчик долгов —
 * `ui.debtsLine` с `vocab.debtPlural`, фаза — `ui.phases`. Имя периода
 * называется, только когда периодов в году больше одного (как на «Сегодня»):
 * у вуза с одним семестром «1-й семестр» — шум, а номера курса в состоянии нет.
 * Вне занятий вместо номера — фаза («каникулы», «сессия»), а не пустота.
 */
export function hookSummary(state, preset) {
  if (!state || !state.started) return '';
  const v = todayView(state, preset);
  if (v.kind !== 'ok') return '';
  const U = uiLabels(preset);
  const vocab = (preset && preset.vocab) || {};
  const parts = [];
  if (v.termLine) parts.push(v.termLine);
  parts.push(WEEKDAYS[dayOfWeek(v.day)] || v.dateLine);
  if (v.now && v.now.status === 'now') parts.push(fill(U.slot, { ordinal: v.now.ordinal }));
  else if (v.phase && v.phase !== 'study') parts.push(v.phaseLabel);
  // Долги — по миру (9.4.3): хвост от необъявленного итога сосед узнать не
  // должен, как не знает его строка состояния (`prompt.mjs` берёт тот же вид).
  const tails = debts(publicView(state, preset)).length;
  if (tails) parts.push(fill(U.debtsLine, { debtPlural: vocab.debtPlural || 'хвосты', count: tails }));
  return parts.filter(Boolean).join(', ');
}

/** Потолок `journal(n)`: журнал кольцевой, но отдавать его целиком незачем. */
export const HOOK_JOURNAL_MAX = 50;

/**
 * Журнал наружу (9.7B): «что случилось» — прогул, оценка, сдвиг отношения,
 * исход сессии, — чтобы соцсеть мира и режиссёр по состоянию не противоречили
 * зачётке.
 *
 * Не копия внутреннего журнала, а перевод по белому списку, и вот почему:
 *
 * - **итог, который мир ещё не знает** (9.4.3, `data.private`), наружу не
 *   идёт — сосед-«Подслушано» разболтал бы оценку раньше ведомости;
 * - **числа отношения и репутации наружу не идут** (3.3): вместо `from/to`
 *   — ярлыки шкалы пресета, как на вкладке «Люди»;
 * - **служебное** (`debug`, отвергнутые куски метки, погашенные повторы) —
 *   это разбор механизма, а не события мира;
 * - `text` внутреннего журнала — технический («grade chem=4») и наружу не
 *   отдаётся: сосед получает поля, а слова подберёт сам.
 *
 * @returns {Array<{day: string, kind: string}>} от ранних к поздним, не больше `n`
 */
export function hookJournal(state, preset, n = 10) {
  if (!state || !Array.isArray(state.journal)) return [];
  const limit = Math.max(0, Math.min(HOOK_JOURNAL_MAX, Number.isFinite(Number(n)) ? Math.floor(Number(n)) : 10));
  if (!limit) return [];
  const subjectName = (id) => (((state.subjects || []).find((s) => s.id === id)) || {}).name || id || '';
  const teacherName = (id) => (((state.teachers || []).find((t) => t.id === id)) || {}).name || id || '';
  const relLabels = (preset && preset.relations && preset.relations.labels) || [];
  const repLabels = (preset && preset.reputation && preset.reputation.labels) || [];
  const items = (state.exams && state.exams.items) || [];
  // Итоги, которые мир ещё не знает (9.4.3). Их оценка лежит в зачётке уже в
  // день сдачи, и строка журнала `grade` про неё выдала бы то же, что прячет
  // `data.private` у записи сдачи. Узнаётся по предмету и дню сдачи — теми же
  // признаками, по которым `exams.publicView` вынимает её из зачётки.
  const hidden = items.filter(awaitingAnnouncement);
  const secret = (subjectId, day) => hidden.some((i) => i.subjectId === subjectId && (!i.day || i.day === day));
  // Повод сдвига (9.7B) словами; про необъявленный итог — без значения оценки.
  const why = (reason) => {
    if (!reason) return '';
    if (typeof reason === 'object' && reason.subjectId && secret(reason.subjectId, reason.day || '')
      && reason.value !== undefined) {
      return '';
    }
    return reasonText(reason, state, preset);
  };
  const out = [];
  for (const e of state.journal) {
    const d = e && e.data;
    if (!e || !d || typeof d !== 'object') continue;
    const day = String(e.day || '');
    let row = null;
    switch (e.kind) {
      case 'grade':
        if (d.reason && d.debt === undefined) break; // отвергнутая оценка
        if (!d.subjectId || secret(d.subjectId, day)) break;
        if (d.debt !== undefined) {
          row = { kind: 'debt', subjectId: d.subjectId, subject: subjectName(d.subjectId), debt: Boolean(d.debt) };
        } else if (d.value !== undefined) {
          const info = gradeInfo(preset, d.value);
          row = {
            kind: 'grade', subjectId: d.subjectId, subject: subjectName(d.subjectId),
            value: String(d.value), label: (info && info.label) || String(d.value), passed: isPassing(preset, d.value),
          };
        }
        break;
      case 'attendance':
        if (d.jump) {
          row = { kind: 'attendance-jump', periods: d.periods || 0, missed: d.missed || 0, present: d.present || 0 };
        } else if (d.subjectId && d.status && d.periodIndex !== undefined) {
          row = { kind: 'attendance', subjectId: d.subjectId, subject: subjectName(d.subjectId), status: String(d.status) };
        }
        break;
      case 'rel': {
        if (d.damped || !Number.isFinite(d.from) || !Number.isFinite(d.to)) break;
        const from = labelFor(relLabels, d.from);
        const to = labelFor(relLabels, d.to);
        row = {
          kind: 'relation', teacherId: d.teacherId, teacher: teacherName(d.teacherId),
          from: from || '', to: to || '', changed: Boolean(from && to && from !== to),
          direction: d.to > d.from ? 'up' : d.to < d.from ? 'down' : 'same',
          ...(why(d.reason) ? { reason: why(d.reason) } : {}),
        };
        break;
      }
      case 'reputation': {
        if (!Number.isFinite(d.from) || !Number.isFinite(d.to)) break;
        row = {
          kind: 'reputation',
          from: labelFor(repLabels, d.from) || '', to: labelFor(repLabels, d.to) || '',
          direction: d.to > d.from ? 'up' : d.to < d.from ? 'down' : 'same',
          // У репутации повод — строка механизма («exam», «skip»), а не объект.
          ...(typeof d.reason === 'string' && d.reason ? { reason: d.reason } : {}),
        };
        break;
      }
      case 'exam': {
        if (d.private) break; // мир ещё не знает (9.4.3)
        const item = items.find((i) => i.id === d.examId);
        const subjectId = d.subjectId || (item && item.subjectId) || '';
        if (d.missed) {
          row = { kind: 'exam-missed', examId: d.examId, subjectId, subject: subjectName(subjectId) };
        } else if (d.modelSaid !== undefined) {
          // Итог, ещё не объявленный миру, не выдаётся и через расхождение.
          if (item && item.announced === false) break;
          row = { kind: 'exam-conflict', examId: d.examId, subjectId, subject: subjectName(subjectId), said: String(d.modelSaid), applied: d.applied !== false };
        } else if (d.value !== undefined && d.examId) {
          const info = gradeInfo(preset, d.value);
          row = {
            kind: 'exam', examId: d.examId, subjectId, subject: subjectName(subjectId),
            value: String(d.value), label: (info && info.label) || String(d.value), passed: Boolean(d.passed),
            ...(d.announced ? { announced: true } : {}),
          };
        } else if (d.added) {
          row = { kind: 'exams-scheduled', count: d.added, ...(d.kind ? { examKind: String(d.kind) } : {}) };
        }
        break;
      }
      default:
        break; // `time`, `debug` и всё незнакомое — не события мира
    }
    if (row) out.push({ day, ...row });
  }
  return out.slice(-limit);
}

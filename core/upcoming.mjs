// core/upcoming — ближние события для строки состояния (9.4.4).
//
// «Через 2 дня — зачёт по химии; в пятницу день рождения Петровой». Приём —
// `birthdayBlock` у Pregnancy: не календарь на месяц вперёд, а одно-два
// события в пределах пары дней, коротко. Строка состояния дорогая (3.3: одна
// строка, не больше шести чисел), поэтому здесь три ограничения, и все —
// параметры пресета с умолчанием:
//
// 1. **Горизонт** — `limits.nearHorizon`, по умолчанию 3 дня. Дальше модели
//    знать незачем: сцену через неделю она всё равно не играет, а событие,
//    объявленное за десять дней, превращается в фон, который модель
//    пересказывает в каждом ответе.
// 2. **Не больше `limits.nearEvents` событий**, по умолчанию 2. Ближайшие —
//    первыми; при равенстве дня контрольное важнее объявления итога, а то —
//    дня рождения.
// 3. **Без чисел.** Когда — словом («сегодня», «завтра», «в пятницу»): слово
//    дня недели не съедает ни одной из шести позиций строки. Слова — в
//    `prompt.mjs` (`DEFAULT_LABELS`), здесь только данные.
//
// Какие события бывают:
//
// - `exam` — ближайший день, в который можно сесть за контрольное, если
//   сессия ещё НЕ идёт (в сессию строка и так говорит «не сдано N, дней
//   осталось M»). День ищется тем же путём, что у промотки (`engine.examAhead`):
//   календарь, дошедший туда сам, завёл бы то же самое;
// - `announce` — объявление итога, который посчитан, но мир его ещё не знает
//   (9.4.3): «в пятницу вывесят ведомость по химии». Значения здесь нет — это
//   знание мира, а не закрытое знание симуляции;
// - `birthday` — день рождения наставника (`Teacher.birthday`, `ММ-ДД`).
//
// Модуль чистый: состояние и пресет на входе, список на выходе.

import { addDays, dayOfWeek } from './time.mjs';
import { examMode, awaitingAnnouncement } from './exams.mjs';
import { examAhead } from './engine.mjs';

/** Горизонт по умолчанию, дней. План 9.4.4: «≤3 дня». */
export const DEFAULT_HORIZON = 3;

/** Сколько событий в строке по умолчанию. План 9.4.4: «не больше 1–2». */
export const DEFAULT_LIMIT = 2;

/** Потолок горизонта из пресета: неделя — уже не «ближнее». */
const MAX_HORIZON = 7;

/** Порядок при равном дне: что важнее сцене. */
const PRIORITY = { exam: 0, announce: 1, birthday: 2 };

/** Горизонт пресета (`limits.nearHorizon`), 0 — ближние события выключены. */
export function nearHorizon(preset) {
  const v = Number(preset && preset.limits && preset.limits.nearHorizon);
  if (!Number.isInteger(v) || v < 0) return DEFAULT_HORIZON;
  return Math.min(v, MAX_HORIZON);
}

/** Сколько событий в строке (`limits.nearEvents`), 0 — выключено. */
export function nearLimit(preset) {
  const v = Number(preset && preset.limits && preset.limits.nearEvents);
  return Number.isInteger(v) && v >= 0 ? v : DEFAULT_LIMIT;
}

/**
 * Ближние события — отсортированы и обрезаны по пресету.
 *
 * @param {Object} state
 * @param {Object} preset
 * @param {{horizon?: number, limit?: number}} [opts] перекрыть пресет (тесты, панель)
 * @returns {Array<{kind: 'exam'|'announce'|'birthday', day: string, days: number,
 *   subjectId?: ?string, teacherId?: string, what?: string, count?: number}>}
 */
export function upcomingEvents(state, preset, opts = {}) {
  const today = state && state.calendar && state.calendar.day;
  if (!today) return [];
  const horizon = Number.isInteger(opts.horizon) ? opts.horizon : nearHorizon(preset);
  const limit = Number.isInteger(opts.limit) ? opts.limit : nearLimit(preset);
  if (horizon < 0 || limit <= 0) return [];

  const out = [];

  // Контрольное — только вне идущей сессии: в сессию оно каждый день.
  if (horizon >= 1 && !examMode(state, preset).active) {
    const ahead = examAhead(state, preset, horizon);
    if (ahead) {
      out.push({
        kind: 'exam',
        day: ahead.day,
        days: ahead.days,
        what: ahead.what,
        // Одно событие называется предметом; пачка («середина по всем
        // предметам», вход в сессию) — только видом.
        subjectId: ahead.count === 1 ? ahead.subjectId : null,
        count: ahead.count,
      });
    }
  }

  for (const item of (state.exams && state.exams.items) || []) {
    if (!awaitingAnnouncement(item) || !item.announceOn) continue;
    const days = daysUntil(today, item.announceOn, horizon);
    if (days === null) continue;
    out.push({ kind: 'announce', day: item.announceOn, days, subjectId: item.subjectId });
  }

  for (const t of state.teachers || []) {
    if (!t || typeof t.birthday !== 'string') continue;
    for (let k = 0; k <= horizon; k += 1) {
      const day = addDays(today, k);
      if (!birthdayOn(t.birthday, day)) continue;
      out.push({ kind: 'birthday', day, days: k, teacherId: t.id });
      break;
    }
  }

  return out
    .sort((a, b) => (a.days - b.days) || (PRIORITY[a.kind] - PRIORITY[b.kind]))
    .slice(0, limit);
}

/**
 * День рождения `ММ-ДД` приходится на `day`. 29 февраля в невисокосный год
 * празднуют 28-го: иначе у такого наставника дня рождения три года из четырёх
 * не было бы вовсе.
 */
export function birthdayOn(birthday, day) {
  const md = String(day).slice(5);
  if (md === birthday) return true;
  if (birthday === '02-29' && md === '02-28') {
    return addDays(day, 1).slice(5) !== '02-29';
  }
  return false;
}

/** Слово дня недели нужно `prompt.mjs`; день недели — отсюда же, чтобы не считать дважды. */
export const weekdayOf = (day) => dayOfWeek(day);

function daysUntil(today, day, horizon) {
  for (let k = 0; k <= horizon; k += 1) if (addDays(today, k) === day) return k;
  return null;
}

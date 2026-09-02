// core/relations — личные отношения с преподавателями.
//
// Шкала одна на преподавателя, число живёт внутри состояния и наружу не выходит
// никогда: в промпт уходит ярлык словом (3.3). Причина не косметическая — «неприязнь»
// модель отыгрывает, `-3` не отыгрывает вовсе, и каждое число в строке состояния
// съедает одну позицию из шести.
//
// Отношения намеренно отделены от репутации (3.4): Петрова тебя невзлюбила — это
// личное и бьёт по одному предмету; что о тебе думает заведение — это reputation.mjs.
// Если склеить обе шкалы, вторая перестаёт быть нужна.
//
// Единственное, что здесь считается сверх сложения, — **переход через границу ярлыка**.
// Он возвращается в `crossed`, потому что это и есть значимое событие: пока Петрова
// остаётся «недовольна», писать об этом в хронику и дёргать одноразовый инжект незачем,
// а вот превращение «недовольна» → «неприязнь» стоит и записи, и отдельной сцены.

import { cloneState, findTeacher, pushJournal, labelFor, clamp } from './state.mjs';

/**
 * Число отношения. Наружу, в промпт, оно не уходит — только в отладку и в расчёты
 * (исход экзамена в exams.mjs). Незнакомый преподаватель — ноль как отсутствие
 * отношения, а не как правило пресета.
 */
export function relationOf(state, teacherId) {
  const t = findTeacher(state, teacherId);
  return t ? t.relation : 0;
}

/** Ярлык словом по таблице `preset.relations.labels`. Это всё, что видит модель. */
export function relationLabel(state, teacherId, preset) {
  const labels = (preset && preset.relations && preset.relations.labels) || [];
  return labelFor(labels, relationOf(state, teacherId));
}

/**
 * Сдвинуть отношение.
 *
 * @param {Object} state
 * @param {{teacherId: string, delta: number, reason?: string}} ev
 * @param {Object} preset
 * @returns {{state: Object, applied: boolean, crossed: ?{from: string, to: string}}}
 */
export function changeRelation(state, ev, preset) {
  const next = cloneState(state);
  const teacherId = ev && ev.teacherId;
  const teacher = findTeacher(next, teacherId);

  if (!teacher) {
    pushJournal(next, {
      kind: 'rel',
      text: `relation rejected: unknown teacher ${teacherId}`,
      data: { teacherId, delta: ev && ev.delta },
    }, preset);
    return { state: next, applied: false, crossed: null };
  }

  const scale = (preset && preset.relations) || {};
  const delta = Number(ev.delta);
  if (!Number.isFinite(delta)) return { state: next, applied: false, crossed: null };

  const before = teacher.relation;
  const labelBefore = relationLabel(next, teacherId, preset);

  // Зажим на границах пресета. Без него благосклонность копится бесконечно и
  // «любимица» перестаёт быть потолком, до которого надо дойти.
  teacher.relation = clamp(before + delta, scale.min, scale.max);

  const labelAfter = relationLabel(next, teacherId, preset);
  const applied = teacher.relation !== before;
  const crossed = labelAfter !== labelBefore ? { from: labelBefore, to: labelAfter } : null;

  pushJournal(next, {
    kind: 'rel',
    text: `relation ${teacher.id} ${labelBefore}->${labelAfter}`,
    data: { teacherId: teacher.id, delta, from: before, to: teacher.relation, reason: ev.reason || null },
  }, preset);

  return { state: next, applied, crossed };
}

/**
 * Применить сразу несколько сдвигов — так приходят эффекты из attendance.mjs.
 * Отдельная функция нужна, чтобы вызывающему не тащить состояние по цепочке руками.
 *
 * @param {Object} state
 * @param {Array<{teacherId: string, delta: number, reason?: string}>} list
 * @returns {{state: Object, crossed: Array<{teacherId: string, from: string, to: string}>}}
 */
export function applyRelationDeltas(state, list, preset) {
  let acc = state;
  const crossed = [];
  for (const ev of list || []) {
    const res = changeRelation(acc, ev, preset);
    acc = res.state;
    if (res.crossed) crossed.push({ teacherId: ev.teacherId, ...res.crossed });
  }
  return { state: acc, crossed };
}

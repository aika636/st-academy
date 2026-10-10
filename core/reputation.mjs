// core/reputation — публичная репутация: что о тебе думает заведение в целом.
//
// Вторая шкала, намеренно отдельная от отношений с преподавателями (3.4). Отношения
// личные — Петрова невзлюбила; репутация публичная — влияет на незнакомых NPC, на то,
// верят ли на слово и дают ли поблажку на пересдаче. Склей их — и вторая шкала
// начинает дублировать средний балл, то есть не нужна.
//
// Ради чего шкала существует: **нижний порог — отчисление**. У прогулов должна быть
// цена страшнее, чем «минус балл»; в зачётке пропуск не виден, в учительской — виден.
// Перед порогом идёт предупреждение, последний шанс. Оба порога и то, как называется
// вылет, задаёт пресет.
//
// Наружу уходит слово, не число (3.3): «под угрозой отчисления» модель отыгрывает,
// `18` — нет, и каждое число съедает одну позицию из шести.
//
// Пробитый порог подаётся **одноразовым инжектом** (3.5) — не справкой, а уже
// случившимся фактом, который модель обязана учесть в следующем ответе. Одноразовость
// держится на двух замках: флаг в состоянии (`warned`, `expelled`) не даёт пороху
// сработать дважды, а стабильный `id` инжекта не даёт продублировать его внутри
// одной очереди. Без первого замка инжект вставал бы заново на каждое сообщение,
// пока репутация лежит ниже порога, — и повелительный тон обесценился бы за три хода.
//
// Репутация может и подняться: сданное по предмету «отрабатывает» прогул, и снятое
// за него возвращается (`attendance.workOff`, `engine.settleWorkOff`). Ярлык при
// этом читается по значению и следует за ним вверх. А флаги `warned`/`expelled` —
// история, а не состояние: однажды прозвучавшее предупреждение не стирается, и
// веха «на волоске» тоже вечна. Повторного предупреждения при новом падении нет по
// той же причине, по которой его нет без отработки: инжект одноразовый.
//
// Текст инжекта собирается из лексики пресета. Ни одного слова языка в коде: в
// японской школе или в Хогвартсе то же самое событие называется своими словами, и
// правок в `core/` это требовать не должно.

import { cloneState, pushJournal, pushPending, labelFor, clamp } from './state.mjs';

/** Идентификаторы одноразовых инжектов. Стабильные — на них держится дедупликация. */
export const INJECT_WARN = 'reputation-warn';
export const INJECT_EXPEL = 'reputation-expel';

/** Ярлык словом. Это всё, что видит модель. */
export function reputationLabel(state, preset) {
  const labels = (preset && preset.reputation && preset.reputation.labels) || [];
  return labelFor(labels, state.reputation.value);
}

/**
 * Сдвинуть репутацию.
 *
 * @param {Object} state
 * @param {{delta: number, reason?: string}} ev
 * @param {Object} preset
 * @returns {{state: Object, applied: boolean, crossedWarn: boolean, expelled: boolean}}
 */
export function changeReputation(state, ev, preset) {
  const next = cloneState(state);
  const scale = (preset && preset.reputation) || {};
  const delta = Number(ev && ev.delta);

  if (!Number.isFinite(delta)) {
    return { state: next, applied: false, crossedWarn: false, expelled: false };
  }

  const before = next.reputation.value;
  next.reputation.value = clamp(before + delta, scale.min, scale.max);
  const applied = next.reputation.value !== before;
  const value = next.reputation.value;

  const wasExpelled = Boolean(next.reputation.expelled);
  const expelled = typeof scale.expelAt === 'number' && value <= scale.expelAt;
  const crossedWarn = typeof scale.warnAt === 'number' && value <= scale.warnAt && !next.reputation.warned;

  pushJournal(next, {
    kind: 'reputation',
    text: `reputation ${before}->${value}`,
    data: { delta, from: before, to: value, reason: (ev && ev.reason) || null },
  }, preset);

  if (crossedWarn) next.reputation.warned = true;
  if (expelled) next.reputation.expelled = true;

  // Отчисление старше предупреждения: если один удар пробил оба порога, звать
  // к начальству «на последний шанс» уже поздно — шанса нет.
  if (expelled && !wasExpelled) {
    pushPending(next, { id: INJECT_EXPEL, kind: 'reputation', text: expelText(preset) });
  } else if (crossedWarn && !expelled) {
    pushPending(next, { id: INJECT_WARN, kind: 'reputation', text: warnText(preset, next) });
  }

  return { state: next, applied, crossedWarn, expelled };
}

/** Текст предупреждения: вызов к начальству плюс нынешний ярлык. */
export function warnText(preset, state) {
  const vocab = (preset && preset.vocab) || {};
  if (vocab.warnInject) return String(vocab.warnInject);
  return sentences([vocab.warning, state ? reputationLabel(state, preset) : null]);
}

/** Текст отчисления. */
export function expelText(preset) {
  const vocab = (preset && preset.vocab) || {};
  if (vocab.expelInject) return String(vocab.expelInject);
  return sentences([vocab.expulsion, vocab.expelled]);
}

/** Склейка кусочков лексики в предложения. Повторы выбрасываются. */
function sentences(parts) {
  const seen = [];
  for (const p of parts) {
    const s = String(p == null ? '' : p).trim();
    if (s && !seen.includes(s)) seen.push(s);
  }
  return seen.map((s) => `${s}.`).join(' ');
}

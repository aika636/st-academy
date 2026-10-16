import { cloneState, pushJournal, pushPending, labelFor, clamp } from './state.mjs';

export const INJECT_WARN = 'reputation-warn';
export const INJECT_EXPEL = 'reputation-expel';

export function reputationLabel(state, preset) {
  const labels = (preset && preset.reputation && preset.reputation.labels) || [];
  return labelFor(labels, state.reputation.value);
}

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
    data: { delta, from: before, to: value, reason: (ev && ev.reason) || null, ...(ev && ev.why ? { why: String(ev.why) } : {}) },
  }, preset);

  if (crossedWarn) next.reputation.warned = true;
  if (expelled) next.reputation.expelled = true;

  if (expelled && !wasExpelled) {
    pushPending(next, { id: INJECT_EXPEL, kind: 'reputation', text: expelText(preset) });
  } else if (crossedWarn && !expelled) {
    pushPending(next, { id: INJECT_WARN, kind: 'reputation', text: warnText(preset, next) });
  }

  return { state: next, applied, crossedWarn, expelled };
}

export const FAME_CAP = { grade: 3, event: 5 };

export function shiftFame(state, ev, preset) {
  const day = (state.calendar && state.calendar.day) || '';
  const prev = state.reputation.fame;
  const sum = prev && prev.day === day ? { ...prev } : { day, g: 0, e: 0 };
  const delta = Number(ev && ev.delta) || 0;
  let applied;
  if (ev.kind === 'event') {
    applied = Math.sign(delta) * Math.max(0, Math.min(Math.abs(delta), FAME_CAP.event - sum.e));
    sum.e += Math.abs(applied);
  } else {
    applied = clamp(sum.g + delta, -FAME_CAP.grade, FAME_CAP.grade) - sum.g;
    sum.g += applied;
  }
  if (!applied) return { state: cloneState(state), applied: 0 };
  const res = changeReputation(state, { delta: applied, reason: ev.reason, why: ev.why }, preset);
  res.state.reputation.fame = sum;
  return { state: res.state, applied };
}

export function unshiftFame(state, delta, day, preset) {
  if (!delta) return state;
  const res = changeReputation(state, { delta: -delta, reason: 'grade-undo' }, preset);
  const fame = res.state.reputation.fame;
  if (fame && fame.day === day) fame.g -= delta;
  return res.state;
}

export function warnText(preset, state) {
  const vocab = (preset && preset.vocab) || {};
  if (vocab.warnInject) return String(vocab.warnInject);
  return sentences([vocab.warning, state ? reputationLabel(state, preset) : null]);
}

export function expelText(preset) {
  const vocab = (preset && preset.vocab) || {};
  if (vocab.expelInject) return String(vocab.expelInject);
  return sentences([vocab.expulsion, vocab.expelled]);
}

function sentences(parts) {
  const seen = [];
  for (const p of parts) {
    const s = String(p == null ? '' : p).trim();
    if (s && !seen.includes(s)) seen.push(s);
  }
  return seen.map((s) => `${s}.`).join(' ');
}

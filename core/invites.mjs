import { cloneState, normalizeInvites } from './state.mjs';
import { relationOf, capRelation, applyRelationDeltas, impactWeight, paceOf, findPerson } from './relations.mjs';
import { holidaysAhead, holidaysOn, occurrenceKey } from './holidays.mjs';
import { addDays, diffDays, parseDay, weekdayIn } from './time.mjs';
import { plural } from './plural.mjs';
import { shortName } from './scene.mjs';
import { heroWords, presetGender } from './gender.mjs';

export const INVITE_BASE = 55;
export const INVITE_EVERY = 8;
export const INVITE_TRIES = 3;
export const INVITE_COOL = 10;
export const INVITE_WINDOW = 14;
export const INVITE_KEEP_DAYS = 30;

export const INVITE_PHRASES = {
  core: '{who} зовёт {heroAcc} с собой: {event} ({when})',
  hook: 'В этом ответе {who} зовёт {heroAcc} с собой: {event} ({when}) — репликой в сцене, коротко, к месту. Решение — за {heroIns}; не решай за {heroAcc}. Если {who} сейчас не в сцене, пусть приглашение дойдёт через кого-то, запиской или при встрече.',
  heard: 'приглашение прозвучало: {event}',
  goDone: 'Решено: идёте вместе — {event}, {who}',
  declineDone: 'Отказ: {event}',
  cameDone: 'Отмечено: {was}',
  missedDone: 'Отмечено: не {arrived}',
  card: '{who} зовёт с собой: {event}, {when}',
  go: 'Пойти',
  decline: 'Отказаться',
  going: 'вместе с тобой идёт {who}',
  weekdaysOn: ['в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу', 'в воскресенье'],
  tomorrow: 'завтра',
  inWeek: 'через неделю',
  inTwoWeeks: 'через две недели',
  inDays: 'через {n} {days}',
  dayForms: ['день', 'дня', 'дней'],
  ask: 'Пропущено {n} {days}. {when} — {event}; {hero} и {who} договаривались пойти вместе. Получилось?',
  yes: 'Да',
  no: 'Нет',
  yesterday: 'вчера',
  months: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
  memCame: '{event} — вместе с {heroIns}',
  memMissed: '{event}: {hero} не {arrived}',
};

const phrasesOf = (preset) => ({ ...INVITE_PHRASES, ...((preset && preset.phrases && preset.phrases.invites) || {}) });
const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));

export const invitesOf = (state) => normalizeInvites(state && state.invites);

export function hash32(s) {
  let h = 2166136261;
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export const inviteSeed = (text, turn) => `${hash32(text).toString(36)}:${turn}`;

export function inviteThreshold(preset) {
  const r = (preset && preset.relations) || {};
  const min = Number.isFinite(r.min) ? r.min : -3;
  const max = Number.isFinite(r.max) ? r.max : 3;
  return Math.ceil(max - (max - min) / 3);
}

export const urgency = (days) => (days <= 3 ? 1 : days <= 7 ? 0.6 : 0.3);

export function closeness(rel, preset) {
  const thr = inviteThreshold(preset);
  const max = Number.isFinite(preset && preset.relations && preset.relations.max) ? preset.relations.max : 3;
  if (max <= thr) return 1;
  return 0.5 + 0.5 * Math.min(Math.max((rel - thr) / (max - thr), 0), 1);
}

export function whenWord(state, preset, days, day) {
  const P = phrasesOf(preset);
  const L = (preset && preset.labels) || {};
  if (days <= 1) return L.nearTomorrow || P.tomorrow;
  if (days <= 6) {
    const week = Array.isArray(L.weekdaysOn) ? L.weekdaysOn : P.weekdaysOn;
    return week[weekdayIn(state, day) - 1] || fill(P.inDays, { n: days, days: plural(days, ...P.dayForms) });
  }
  if (days === 7) return P.inWeek;
  if (days === 14) return P.inTwoWeeks;
  return fill(P.inDays, { n: days, days: plural(days, ...P.dayForms) });
}

export function inviteCandidates(state, preset, day, turn = invitesOf(state).n) {
  const inv = invitesOf(state);
  if (!state || !day) return [];
  const thr = inviteThreshold(preset);
  const people = (state.classmates || []).filter((p) => p && p.id && relationOf(state, p.id) >= thr);
  if (!people.length) return [];
  const events = holidaysAhead(preset, day, INVITE_WINDOW, state)
    .filter((a) => !a.holiday.off && !a.holiday.pause && !a.holiday.open)
    .map((a) => ({ a, key: occurrenceKey(a.holiday, a.day) }))
    .filter((e) => e.key && !inv.decided[e.key]);
  const out = [];
  for (const p of people) {
    if ((inv.cool[p.id] || 0) > turn) continue;
    for (const { a, key } of events) {
      if ((inv.cool[key] || 0) > turn) continue;
      out.push({
        personId: p.id, name: p.name || p.id, key, eventName: a.holiday.name, day: a.day, days: a.days,
        chance: INVITE_BASE * urgency(a.days) * closeness(relationOf(state, p.id), preset),
      });
    }
  }
  return out.sort((x, y) => (y.chance - x.chance) || (x.days - y.days) || (x.personId < y.personId ? -1 : 1));
}

export function rollInvite(state, preset, { day, turn, seed = '' } = {}) {
  const inv = invitesOf(state);
  const at = Number.isInteger(turn) ? turn : inv.n;
  const today = day || (state && state.calendar && state.calendar.day) || '';
  if (inv.pending) return null;
  if (inv.last !== null && at - inv.last < INVITE_EVERY) return null;
  for (const c of inviteCandidates(state, preset, today, at)) {
    if (hash32(`${seed}|${c.personId}|${c.key}`) % 100 < c.chance) return c;
  }
  return null;
}

function prune(inv, day) {
  const old = addDays(day, -INVITE_KEEP_DAYS);
  const stale = (key) => { const at = String(key).split('@')[1]; return Boolean(at) && at < old; };
  for (const k of Object.keys(inv.decided)) if (stale(k)) delete inv.decided[k];
  inv.going = inv.going.filter((g) => g.day >= old);
  inv.asked = inv.asked.filter((a) => a.day >= old);
}

export function stepInvites(state, preset, { text = '', playedIds = [], mark = '', enabled = true } = {}) {
  const next = cloneState(state);
  const inv = invitesOf(next);
  inv.n += 1;
  const day = (next.calendar && next.calendar.day) || '';
  if (day) prune(inv, day);
  let expired = null;
  const p = inv.pending;
  if (p) {
    if (!p.played && playedIds.includes(p.hookId)) {
      p.played = true;
      p.mark = String(mark || '');
      p.tries = 0;
    } else {
      p.tries += 1;
      if (p.tries >= INVITE_TRIES) {
        if (p.played) inv.decided[p.key] = 'skip';
        else inv.cool[p.personId] = inv.n + INVITE_COOL;
        expired = p;
        inv.pending = null;
      }
    }
  }
  next.invites = inv;
  let rolled = null;
  if (!inv.pending && enabled && day) {
    rolled = rollInvite(next, preset, { day, turn: inv.n, seed: inviteSeed(text, inv.n) });
    if (rolled) {
      inv.pending = {
        key: rolled.key, personId: rolled.personId, eventName: rolled.eventName, day: rolled.day,
        when: whenWord(next, preset, rolled.days, rolled.day), hookId: `inv${inv.n}`, tries: 0, played: false, mark: '',
      };
      inv.last = inv.n;
    }
  }
  next.invites = normalizeInvites(inv);
  return { state: next, rolled, expired };
}

function pushDone(inv, d) {
  inv.done = [...inv.done.filter((x) => !(x.mark === d.mark && x.key === d.key)), d];
}

const personOf = (state, id) => (state.classmates || []).find((c) => c && c.id === id) || null;

export function inviteHookWords(state, preset, pending) {
  const P = phrasesOf(preset);
  const p = pending || invitesOf(state).pending;
  if (!p) return null;
  const person = personOf(state, p.personId);
  const W = heroWords(presetGender(preset));
  const v = { who: shortName((person && person.name) || p.personId), heroAcc: W.heroAcc, heroIns: W.heroIns, event: p.eventName, when: p.when };
  return { core: fill(P.core, v), text: fill(P.hook, v), plate: fill(P.heard, v) };
}

export function inviteCard(state, preset, mark) {
  const p = invitesOf(state).pending;
  if (!p || !p.played || !p.mark || p.mark !== mark) return null;
  const P = phrasesOf(preset);
  const person = personOf(state, p.personId);
  return {
    text: fill(P.card, { who: shortName((person && person.name) || p.personId), event: p.eventName, when: p.when }),
    go: P.go,
    decline: P.decline,
  };
}

export function doneLines(state, preset, mark) {
  const P = phrasesOf(preset);
  const gender = presetGender(preset);
  return invitesOf(state).done.filter((d) => d.mark && d.mark === mark).map((d) => {
    const person = personOf(state, d.withId);
    const v = {
      event: d.eventName, who: shortName((person && person.name) || d.withId),
      was: gender === 'm' ? 'был' : 'была', arrived: gender === 'm' ? 'пришёл' : 'пришла',
    };
    return fill({ go: P.goDone, decline: P.declineDone, came: P.cameDone, missed: P.missedDone }[d.kind], v);
  });
}

export function answerInvite(state, answer) {
  const inv = invitesOf(state);
  const p = inv.pending;
  if (!p || !p.played) return { ok: false, state, error: 'приглашения нет' };
  if (answer !== 'yes' && answer !== 'no') return { ok: false, state, error: 'ответ — «да» или «нет»' };
  const next = cloneState(state);
  const out = invitesOf(next);
  out.decided[p.key] = answer;
  if (answer === 'yes') out.going = [...out.going, { key: p.key, eventName: p.eventName, day: p.day, withId: p.personId }];
  pushDone(out, { mark: p.mark, kind: answer === 'yes' ? 'go' : 'decline', key: p.key, eventName: p.eventName, withId: p.personId });
  out.pending = null;
  next.invites = normalizeInvites(out);
  return { ok: true, state: next };
}

export function settleInvite(snapshot, pending, answer, always = false) {
  if (!snapshot || !pending || (answer !== 'yes' && answer !== 'no')) return false;
  const inv = invitesOf(snapshot);
  const waits = Boolean(inv.pending) && inv.pending.hookId === pending.hookId;
  if (!waits && !always) return false;
  inv.decided[pending.key] = answer;
  inv.going = inv.going.filter((g) => g.key !== pending.key);
  if (answer === 'yes') inv.going.push({ key: pending.key, eventName: pending.eventName, day: pending.day, withId: pending.personId });
  if (pending.mark) pushDone(inv, { mark: pending.mark, kind: answer === 'yes' ? 'go' : 'decline', key: pending.key, eventName: pending.eventName, withId: pending.personId });
  if (waits) inv.pending = null;
  snapshot.invites = normalizeInvites(inv);
  return true;
}

export function unsettleInvite(snapshot, key) {
  if (!snapshot || !key) return false;
  const inv = invitesOf(snapshot);
  if (!(key in inv.decided) && !inv.going.some((g) => g.key === key)) return false;
  delete inv.decided[key];
  inv.going = inv.going.filter((g) => g.key !== key);
  inv.done = inv.done.filter((d) => d.key !== key);
  snapshot.invites = normalizeInvites(inv);
  return true;
}

export function dropInvite(state) {
  const inv = invitesOf(state);
  if (!inv.pending) return state;
  const next = cloneState(state);
  const out = invitesOf(next);
  out.cool[out.pending.personId] = out.n + INVITE_COOL;
  out.pending = null;
  next.invites = normalizeInvites(out);
  return next;
}

export function goingToday(state, preset) {
  const day = state && state.calendar && state.calendar.day;
  const inv = invitesOf(state);
  if (!day || !inv.going.length) return [];
  const out = [];
  for (const h of holidaysOn(preset, day, state)) {
    const key = occurrenceKey(h, day);
    const g = key && inv.going.find((x) => x.key === key);
    const person = g && personOf(state, g.withId);
    if (person) out.push({ key, eventName: h.name, who: shortName(person.name), withId: g.withId });
  }
  return out;
}

export function goingWith(state, key) {
  const g = invitesOf(state).going.find((x) => x.key === key);
  const person = g && personOf(state, g.withId);
  return person ? shortName(person.name) : '';
}

export const goingLine = (preset, who) => fill(phrasesOf(preset).going, { who });

export const ASK_MIN_JUMP = 2;

const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);

export function missedPromises(state, fromDay, toDay) {
  if (!state || !fromDay || !toDay || diffDays(fromDay, toDay) < ASK_MIN_JUMP) return [];
  const inv = invitesOf(state);
  return inv.going
    .filter((g) => g.came === undefined && g.day >= fromDay && g.day < toDay && !inv.asked.some((a) => a.key === g.key))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

export function askPromises(state, fromDay, toDay, mark = '') {
  if (!state || !fromDay || !toDay || diffDays(fromDay, toDay) < ASK_MIN_JUMP) return state;
  const missed = missedPromises(state, fromDay, toDay);
  if (!missed.length && !invitesOf(state).asked.length) return state;
  const next = cloneState(state);
  const inv = invitesOf(next);
  for (const a of inv.asked) {
    const g = inv.going.find((x) => x.key === a.key);
    if (g && g.came === undefined) g.came = null;
  }
  inv.asked = missed.map((g) => ({ key: g.key, withId: g.withId, eventName: g.eventName, day: g.day, from: fromDay, to: toDay, mark: String(mark || '') }));
  next.invites = normalizeInvites(inv);
  return next;
}

export function pastWord(state, preset, day, to) {
  const P = phrasesOf(preset);
  const L = (preset && preset.labels) || {};
  const ago = diffDays(day, to);
  if (ago <= 1) return P.yesterday;
  if (ago <= 6) {
    const week = Array.isArray(L.weekdaysOn) ? L.weekdaysOn : P.weekdaysOn;
    if (week[weekdayIn(state, day) - 1]) return week[weekdayIn(state, day) - 1];
  }
  const { m, d } = parseDay(day);
  return `${d} ${P.months[m - 1]}`;
}

export function promiseCards(state, preset, mark, heroName = '') {
  const P = phrasesOf(preset);
  const W = heroWords(presetGender(preset));
  const hero = String(heroName || '').trim() || W.hero;
  return invitesOf(state).asked.filter((a) => a.mark && a.mark === mark).map((a) => {
    const n = diffDays(a.from, a.to);
    const person = personOf(state, a.withId);
    return {
      key: a.key,
      text: fill(P.ask, {
        n, days: plural(n, ...P.dayForms), when: capital(pastWord(state, preset, a.day, a.to)), event: a.eventName,
        hero, who: shortName((person && person.name) || a.withId),
      }),
      yes: P.yes,
      no: P.no,
    };
  });
}

export function answerPromise(state, preset, key, came, heroName = '') {
  const a = invitesOf(state).asked.find((x) => x.key === key);
  if (!a) return { ok: false, state, error: 'вопроса нет' };
  if (typeof came !== 'boolean') return { ok: false, state, error: 'ответ — «да» или «нет»' };
  let next = cloneState(state);
  const out = invitesOf(next);
  out.asked = out.asked.filter((x) => x.key !== key);
  const g = out.going.find((x) => x.key === key);
  if (g) g.came = came;
  if (a.mark) pushDone(out, { mark: a.mark, kind: came ? 'came' : 'missed', key, eventName: a.eventName, withId: a.withId });
  next.invites = normalizeInvites(out);
  let delta = 0;
  if (findPerson(next, a.withId)) {
    const P = phrasesOf(preset);
    const gender = presetGender(preset);
    const W = heroWords(gender);
    const text = fill(came ? P.memCame : P.memMissed, {
      heroIns: W.heroIns, hero: String(heroName || '').trim() || W.hero, arrived: gender === 'm' ? 'пришёл' : 'пришла', event: a.eventName,
    });
    const w = impactWeight(preset, 'minor');
    const cap = capRelation(next, [{ teacherId: a.withId, delta: came ? w : -w }], preset, { pace: paceOf(next) });
    next = applyRelationDeltas(cap.state, cap.events.map((ev) => ({ ...ev, reason: { kind: 'promise', text } })), preset).state;
    delta = cap.events.reduce((x, ev) => x + ev.delta, 0);
  }
  return { ok: true, state: next, delta };
}

export function settlePromise(snapshot, preset, key, came, heroName = '') {
  if (!snapshot || !invitesOf(snapshot).asked.some((a) => a.key === key)) return null;
  const res = answerPromise(snapshot, preset, key, came, heroName);
  return res.ok ? res.state : null;
}

export function replayPromises(state, preset, answers, mark, heroName = '') {
  let s = state;
  for (const a of answers || []) {
    if (a.stamp !== mark) continue;
    const res = answerPromise(s, preset, a.key, a.came, heroName);
    if (res.ok) s = res.state;
  }
  return s;
}

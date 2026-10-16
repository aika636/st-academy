import { cloneState, findSubject, teacherOfSubject } from './state.mjs';
import { HEROINE } from './parse-marker.mjs';
import { seededRng, kindOf, retakeList, examMode } from './exams.mjs';
import { examsAhead } from './engine.mjs';
import { holidaysAhead, holidaysOn, occurrenceKey, holidayEnd, MAX_LEAD } from './holidays.mjs';
import { relationOf } from './relations.mjs';
import { addDays, diffDays } from './time.mjs';
import { shortName, dealText, peopleOf } from './scene.mjs';
import { heroGender } from './gender.mjs';
import {
  ensureFeed, openDeals, openDeal, finishDeal, addFeedItem, setStatus, lastSeen, hash,
} from './feed.mjs';

export const PREP_INTENTS = 3;
export const PREP_EXAM_LEAD = 5;

export const PREP_SECRETARY = 3;

export const PREP_TYPES = {
  company: { ev: 'holiday', who: ['classmate'], hero: true, until: 'end' },
  help: { ev: 'holiday', who: ['classmate'], hero: true, until: 'before' },
  recruit: { ev: 'holiday', who: ['classmate', 'teacher'], hero: true, until: 'before' },
  perform: { ev: 'holiday', who: ['classmate'], hero: false, until: 'start' },
  obtain: { ev: 'holiday', who: ['classmate'], hero: false, until: 'before' },
  avoid: { ev: 'holiday', who: ['classmate'], hero: false, until: 'start' },
  studyHelp: { ev: 'exam', who: ['classmate'], hero: true, until: 'before' },
  studyTogether: { ev: 'exam', who: ['classmate'], hero: true, until: 'before' },
  materials: { ev: 'exam', who: ['classmate'], hero: false, until: 'before' },
  hardTopic: { ev: 'exam', who: ['classmate'], hero: false, until: 'before' },
  consult: { ev: 'exam', who: ['teacher'], hero: false, until: 'before' },
  drill: { ev: 'exam', who: ['teacher'], hero: false, until: 'before' },
};

export const DEFAULT_PREP_PHRASES = {
  company: { deal: 'ищет, с кем пойти: {event}', post: '{who} ищет, с кем пойти: {event}' },
  help: { deal: 'просит помочь с подготовкой: {event}', post: '{who} ищет помощников для подготовки: {event}' },
  recruit: { deal: 'набирает участников: {event}', post: '{who} зовёт всех участвовать: {event}' },
  perform: { deal: 'готовит выступление: {event}', post: '{who} репетирует выступление: {event}' },
  obtain: { deal: 'достаёт всё нужное: {event}', post: '{who} бегает в поисках нужного: {event}' },
  avoid: { deal: 'ищет, как не участвовать: {event}', post: '{who} пытается увильнуть: {event}' },
  studyHelp: { deal: 'ищет, кто поможет с подготовкой: {subject}', post: '{who} просит помочь с подготовкой: {subject}' },
  studyTogether: { deal: 'зовёт готовиться вместе: {subject}', post: '{who} предлагает готовиться вместе: {subject}' },
  materials: { deal: 'ищет конспекты и материалы: {subject}', post: '{who} ищет конспекты: {subject}' },
  hardTopic: { deal: 'разбирает трудную тему: {subject}', post: '{who} бьётся над трудной темой: {subject}' },
  consult: { deal: 'зовёт на консультацию: {subject}', post: '{who} проводит консультацию: {subject}' },
  drill: { deal: 'гоняет по билетам: {subject}', post: '{who} гоняет группу по билетам: {subject}' },
};

const TRAITS = {
  perform: /сцен|пет[ьь]|пою|поёт|танц|выступ|концерт|театр|музык|stage|sing|danc|perform|music|theat/iu,
  company: /одинок|пар[аую](?![а-яё])|любов|влюб|свидан|романт|lonely|love|crush|date|partner|romanc/iu,
  obtain: /деньг|долг|купит|достат|money|debt|afford|borrow/iu,
  avoid: /стесн|застенч|тревож|толп|shy|anxious|crowd|avoid/iu,
  recruit: /клуб|кружок|команд|староста|председ|организ|club|team|captain|organi[sz]/iu,
  help: /не успева|не справ|помо|behind|overwhelm|help/iu,
  studyHelp: /оценк|учёб|учеб|диплом|отличн|стипенд|grade|study|degree|scholar/iu,
  hardTopic: /оценк|учёб|учеб|диплом|отличн|grade|study|degree/iu,
  materials: /конспект|пропуст|прогул|ленив|notes|missed|lazy/iu,
  studyTogether: /друж|вместе|компани|friend|together/iu,
};
const STRICT = /строг|требоват|жёстк|суров|дисциплин|strict|demanding|harsh|discipline/iu;

const num = (v, fallback, lo, hi) => (Number.isInteger(v) ? Math.min(Math.max(v, lo), hi) : fallback);
const limitsOf = (preset) => {
  const l = (preset && preset.limits) || {};
  return { cap: num(l.prepIntents, PREP_INTENTS, 0, 6), lead: num(l.prepExamLead, PREP_EXAM_LEAD, 1, 14) };
};

const fill = (tpl, vars) => String(tpl || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const upFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function wordsOf(preset, type) {
  const own = (preset && preset.phrases && preset.phrases.prep && preset.phrases.prep[type]) || {};
  const base = DEFAULT_PREP_PHRASES[type];
  return { deal: typeof own.deal === 'string' && own.deal.trim() ? own.deal : base.deal, post: typeof own.post === 'string' && own.post.trim() ? own.post : base.post };
}

function eventsOf(state, preset, today, lead) {
  const out = [];
  for (const a of holidaysAhead(preset, today, MAX_LEAD, state)) {
    const h = a.holiday;
    if (h.off || a.days > h.lead) continue;
    const on = occurrenceKey(h, a.day);
    if (on) out.push({ kind: 'holiday', on, day: a.day, days: a.days, name: h.name, end: holidayEnd(h, a.day) });
  }
  let ahead = null;
  try {
    ahead = examMode(state, preset).active ? null : examsAhead(state, preset, lead);
  } catch {
    ahead = null;
  }
  for (const item of (ahead && ahead.items) || []) {
    const subject = findSubject(state, item.subjectId);
    const kind = kindOf(preset, item.kind);
    out.push({
      kind: 'exam', on: item.id, day: ahead.day, days: ahead.days, subjectId: item.subjectId,
      subject: (subject && subject.name) || item.subjectId, what: String((kind && kind.name) || '').toLowerCase(),
    });
  }
  return out;
}

function eventAlive(state, preset, deal, today) {
  if (/@\d{4}-\d{2}-\d{2}$/.test(deal.on)) {
    const at = deal.on.lastIndexOf('@');
    const id = deal.on.slice(0, at);
    const start = deal.on.slice(at + 1);
    if (start <= today) return holidaysOn(preset, today, state).some((h) => h.id === id && occurrenceKey(h, today) === deal.on);
    const horizon = Math.min(diffDays(today, start) + 1, 366);
    return holidaysAhead(preset, today, horizon, state).some((a) => a.holiday.id === id && a.day === start);
  }
  const item = ((state.exams && state.exams.items) || []).find((i) => i.id === deal.on);
  return Boolean(item) && !item.missed && !item.outcome;
}

const dealWithHero = (state, id) => openDeals(state, id).some((d) => d.a === HEROINE || d.b === HEROINE);

function linked(state, p, teacher) {
  const tie = !teacher && p.tie && p.tie.to === HEROINE;
  return Boolean(tie) || dealWithHero(state, p.id) || relationOf(state, p.id) > 0;
}

function stakeIn(state, preset, ev) {
  const subject = findSubject(state, ev.subjectId);
  const teacher = teacherOfSubject(state, ev.subjectId);
  return Boolean(subject && subject.debt)
    || retakeList(state, preset).some((r) => r.subjectId === ev.subjectId)
    || Boolean(teacher && relationOf(state, teacher.id) < 0);
}

function allowedTypes(state, preset, ev, p, teacher) {
  const stake = ev.kind === 'exam' && stakeIn(state, preset, ev);
  const owner = ev.kind === 'exam' ? teacherOfSubject(state, ev.subjectId) : null;
  return Object.keys(PREP_TYPES).filter((t) => {
    const spec = PREP_TYPES[t];
    if (spec.ev !== ev.kind || !spec.who.includes(teacher ? 'teacher' : 'classmate')) return false;
    if (teacher && ev.kind === 'exam' && !(owner && owner.id === p.id)) return false;
    if (!spec.hero) return true;
    if (ev.kind === 'exam') return stake || dealWithHero(state, p.id);
    return linked(state, p, teacher);
  });
}

function traitText(p, teacher) {
  return (teacher ? [p.post, p.likes] : [p.desire, p.problem, p.club, p.likes]).filter((x) => typeof x === 'string').join(' ');
}

function pickType(allowed, text, rng) {
  const hit = allowed.find((t) => TRAITS[t] && TRAITS[t].test(text));
  return hit || allowed[Math.floor(rng() * allowed.length)];
}

function choose(state, preset, ev, seed, busy) {
  const rng = seededRng(`${seed}|prep|${ev.on}`);
  const pool = [
    ...(state.classmates || []).filter((p) => p && p.id).map((p) => ({ p, teacher: false })),
    ...(state.teachers || []).filter((p) => p && p.id).map((p) => ({ p, teacher: true })),
  ];
  const ranked = [];
  for (const { p, teacher } of pool) {
    if (busy.has(p.id)) continue;
    const allowed = allowedTypes(state, preset, ev, p, teacher);
    if (!allowed.length) continue;
    const seen = lastSeen(state, p.id);
    ranked.push({
      p, teacher, allowed,
      link: linked(state, p, teacher) ? 0 : 1,
      seen: seen ? `${seen.day} ${seen.time}` : '',
      roll: seededRng(`${seed}|prep|${ev.on}|${p.id}`)(),
    });
  }
  ranked.sort((x, y) => (x.link - y.link) || (x.seen < y.seen ? -1 : x.seen > y.seen ? 1 : 0) || (x.roll - y.roll));
  const top = ranked[0];
  if (!top) return null;
  const text = traitText(top.p, top.teacher);
  const cold = top.teacher && ev.kind === 'exam' && relationOf(state, top.p.id) < 0;
  const type = top.allowed.includes('consult') && top.allowed.includes('drill')
    ? (cold || STRICT.test(text) || rng() < 0.25 ? 'drill' : 'consult')
    : pickType(top.allowed, text, rng);
  return { person: top.p, teacher: top.teacher, type };
}

export const isPrepToken = (token) => /^prep=/.test(String(token || ''));

export const prepTokenOf = (id, result) => `prep=${id}:${result === 'failed' ? 'failed' : 'done'}`;

export function prepTokens(tokens) {
  const out = [];
  for (const t of Array.isArray(tokens) ? tokens : []) {
    const m = /^prep=([^:]+):(done|failed)$/.exec(String(t || ''));
    if (m) out.push({ id: m[1], result: m[2] });
  }
  return out;
}

export function prepList(state, heroine = '') {
  const people = peopleOf(state);
  const gender = heroGender(state, heroine);
  return openDeals(state)
    .filter((d) => d.intent)
    .sort((x, y) => String(x.until || '9').localeCompare(String(y.until || '9')) || String(x.since).localeCompare(String(y.since)))
    .slice(0, PREP_SECRETARY)
    .map((d) => ({ id: hash(d.id), text: dealText({ ...d, closed: false }, people, heroine, gender) }));
}

export function prepTokenText(token, list = []) {
  const e = prepTokens([token])[0];
  if (!e) return String(token);
  const row = (Array.isArray(list) ? list : []).find((x) => x && x.id === e.id);
  return `${e.result === 'failed' ? 'Сорвалось' : 'Сбылось'}${row ? `: ${row.text}` : ''}`;
}

function closeDeal(next, d, why, result, today) {
  if (!finishDeal(next, d.id, { why, result, day: today })) return false;
  const post = ensureFeed(next).items.find((x) => x.factRef === `prep=${d.id}`);
  if (post && post.status !== 'played') setStatus(next, post.id, 'expired');
  return true;
}

export function stepPrep(state, preset, opts = {}) {
  const none = { state, opened: [], closed: [] };
  const today = state && state.calendar && state.calendar.day;
  if (!state || !state.started || !today) return none;
  const next = cloneState(state);
  const feed = ensureFeed(next);
  const told = prepTokens(opts.tokens);
  const closed = [];
  const opened = [];

  for (const d of feed.deals.filter((x) => x.open && x.intent)) {
    const said = told.find((t) => t.id === hash(d.id));
    const why = said ? said.result : d.until && today > d.until ? 'late' : d.on && !eventAlive(next, preset, d, today) ? 'gone' : '';
    if (why && closeDeal(next, d, why, said ? said.result : '', today)) closed.push({ id: d.id, why, result: said ? said.result : '' });
  }

  const { cap, lead } = limitsOf(preset);
  const active = openDeals(next).filter((d) => d.intent);
  if (opts.open !== false && active.length < cap) {
    const seed = String(opts.seed || '');
    const had = new Set(feed.deals.filter((d) => d.on).map((d) => d.on));
    const busy = new Set(active.map((d) => d.a));
    const events = eventsOf(next, preset, today, lead).filter((e) => !had.has(e.on))
      .map((e) => ({ e, roll: seededRng(`${seed}|prep|${e.on}`)() }))
      .sort((x, y) => (x.e.days - y.e.days) || (x.roll - y.roll))
      .map((x) => x.e);
    for (const ev of events) {
      if (active.length + opened.length >= cap) break;
      const pick = choose(next, preset, ev, seed, busy);
      if (!pick) continue;
      const id = open(next, preset, ev, pick, today);
      if (id) {
        opened.push(id);
        busy.add(pick.person.id);
      }
    }
  }
  return closed.length || opened.length ? { state: next, opened, closed } : none;
}

function open(next, preset, ev, pick, today) {
  const spec = PREP_TYPES[pick.type];
  const P = wordsOf(preset, pick.type);
  const vars = {
    who: shortName(pick.person.name || pick.person.id, { teacher: pick.teacher }),
    event: ev.name || '', subject: ev.subject || '', examWhat: ev.what || '',
  };
  const until = spec.until === 'end' ? ev.end : spec.until === 'start' ? ev.day : addDays(ev.day, -1);
  const src = `prep:${ev.on}`;
  const made = openDeal(next, {
    a: pick.person.id, b: '', what: fill(P.deal, vars).trim(), src, day: today, on: ev.on, onDay: ev.day, intent: pick.type, until,
  });
  if (!made.id) return '';
  addFeedItem(next, {
    id: `prep~${made.id}`, src, at: { day: today, time: '' }, factRef: `prep=${made.id}`, kind: 'fact', chan: 'chat',
    who: pick.person.id, text: upFirst(fill(P.post, vars).trim()), gist: upFirst(`${vars.who} ${fill(P.deal, vars)}`.trim()),
    rumor: false, truth: null, about: spec.hero ? [pick.person.id, HEROINE] : [pick.person.id], heroine: spec.hero,
    loud: spec.hero ? 1 : 0,
  });
  return made.id;
}

import { labelFor } from './core/state.mjs';
import { addDays, weekIndex, phaseOf, weekdayIn, termAt, preExamWeek, PRE_EXAMS_DEFAULT } from './core/time.mjs';
import { dayPlan, currentPeriod } from './core/schedule.mjs';
import { debts, overallScore, DEBT_RETAKE } from './core/gradebook.mjs';
import { relationLabel } from './core/relations.mjs';
import { reputationLabel } from './core/reputation.mjs';
import { notableGrade } from './core/fame.mjs';
import { examMode, publicView, retakeList, weekAheadKinds } from './core/exams.mjs';
import { upcomingEvents } from './core/upcoming.mjs';
import { holidayBackground, bare, buzzFor, dropName } from './core/holidays.mjs';
import { feedBackground, BACKGROUND_MAX } from './core/feed.mjs';
import { unsaid } from './core/plot.mjs';
import { goingToday } from './core/invites.mjs';
import { bullyStatus } from './core/bullying.mjs';
import { heroWords, presetGender } from './core/gender.mjs';
import { subjectVars, upFirst, periodWord } from './core/words.mjs';

export const DEFAULT_LABELS = {
  weekdays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  phases: {
    study: '', weekend: 'weekend', vacation: 'vacation', break: 'vacation', exams: '',
    preExams: PRE_EXAMS_DEFAULT,
    preExamsEn: 'the last week before exams',
  },

  day: '{weekday}, week {week}',
  dayOutside: '{weekday}, {phase}',
  dayPhase: '{weekday}, week {week}, {phase}',

  now: 'now: {subject}{teacher}',
  next: 'next: {subject}{teacher}',
  today: 'today: {list}',
  nowMark: '{subject} (now)',
  teacherOf: ' ({teacher})',

  debts: 'debts: {list}',
  retakes: 'retake: {list}',
  lastTry: '{subject} (last attempt)',
  expelled: '{hero} is expelled: {paths}',
  expelPaths: 'appeal, reinstatement or transfer to another institution remain; the scene decides which',
  score: 'average grade: {value}',
  exams: '{examPeriod}: {count} not passed, {days} {daysWord} left',
  examsNoDays: '{examPeriod}: {count} not passed',
  relation: '{teacher} toward {hero}: {label}',
  reputation: 'reputation: {label}',
  study: 'notable grades: {list}',
  studyItem: '{subject} — {grade} ({when})',
  studyToday: 'today',
  studyYesterday: 'yesterday',

  glue: '. ',
  end: '.',
  listGlue: ', ',

  nearToday: 'today',
  nearTomorrow: 'tomorrow',
  weekdaysOn: ['on Monday', 'on Tuesday', 'on Wednesday', 'on Thursday', 'on Friday', 'on Saturday', 'on Sunday'],
  nearExam: '{when} — {what}',
  nearExamSubject: '{when} — {what}: {subject}',
  nearAnnounce: 'results announced {when}: {subject}',
  nearGlue: '; ',
  weekAhead: 'in a week — {what}: {subjects}',
  weekAheadAll: 'in a week — {what}',

  holidayNow: 'today is {name} — {note}',
  holidayNowBare: 'today is {name}',
  holidayAhead: '{when} {name} — {note}',
  holidayAheadBare: '{when} {name}',
  holidayAlso: 'and {name} — {note}',
  holidayAlsoBare: 'and {name}',
  holidaySoon: 'soon',
  holidayGoing: '{hero} and {who} agreed to go together: {name}',

  feed: 'Talk in {crowdIn}: {list}',
  feedFact: '{text} (fact)',
  feedRumor: '{text} (rumor)',
  feedTalk: '{text} — being discussed (fact)',
  feedTalkQuote: 'being discussed: «{text}» (fact)',
  feedGossip: '«{text}» (rumor — unknown if true)',
  feedGlue: '; ',
};

export const FEED_LINE_MAX = 220;

export const DEFAULT_PROMPTS = {
  marker: 'Start the reply (right after the scene-state block, if any) with a marker: <!-- [ACADEMY t=+1] -->. Keys: t= time shift (+1 = one {period}, +1 day, +1 week); grade=subject:grade; rel={teacher}:minor+/minor-/major+/major- (:reason); skip=subject; late=subject. Only what happened in the reply.',
  markerIds: 'Subject ids: {subjects}.',
  markerTeachers: 'Teacher ids: {teachers}.',
};

const vocabOf = (preset) => (preset && preset.vocab) || {};
const labelsOf = (preset) => ({ ...DEFAULT_LABELS, ...((preset && preset.labels) || {}) });
const promptsOf = (preset) => ({ ...DEFAULT_PROMPTS, ...((preset && preset.prompts) || {}) });

export function statusLine(state, preset, opts = {}) {
  if (!state || state.started !== true || !state.calendar) return '';

  const L = labelsOf(preset);
  const segments = segmentsOf(publicView(state, preset), preset, L);
  if (opts.feed) {
    if (opts.feed.muted !== true) segments.push({ id: 'bullying', text: bullyStatus(state, preset, { heroine: opts.heroine }) });
    const holiday = segments.some((s) => (s.id === 'holiday' || s.id === 'holidayAhead') && s.text);
    const crowdIn = String(vocabOf(preset).crowdInEn || '').trim() || 'class';
    segments.push({ id: 'feed', text: feedSegment(state, L, { quiet: opts.feed.quiet === true, holiday, crowdIn }) });
  }

  const limit = numberOr(preset && preset.limits && preset.limits.maxNumbersInPrompt, Infinity);
  const kept = [];
  let used = 0;
  for (const seg of segments) {
    if (!seg.text) continue;
    const n = countNumbers(seg.text);
    if (used + n > limit) continue;
    used += n;
    kept.push(cap(seg.text.replace(/[\s.;,]+$/u, '')));
  }
  if (!kept.length) return '';
  return kept.join(L.glue) + L.end;
}

function segmentsOf(state, preset, L) {
  const vocab = vocabOf(preset);
  const mode = examMode(state, preset);
  const out = [];

  out.push({ id: 'day', text: daySegment(state, preset, L) });
  out.push({ id: 'holiday', text: holidaySegment(state, preset, L, 'now') });
  out.push({ id: 'going', text: goingSegment(state, preset, L) });
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
        daysWord: days === 1 ? 'day' : 'days',
      }),
    });
  }

  const list = debts(state).filter((s) => s.debtSkips || s.debtReason !== DEBT_RETAKE).map((s) => s.name || s.id);
  out.push({
    id: 'debts',
    text: list.length ? fill(L.debts, { debtPlural: vocab.debtPlural || vocab.debt || '', list: list.join(L.listGlue) }) : '',
  });
  const again = retakeList(state, preset).map((r) => (r.left === 1 ? fill(L.lastTry, { subject: r.name }) : r.name));
  out.push({ id: 'retakes', text: again.length ? fill(L.retakes, { list: again.join(L.listGlue) }) : '' });
  out.push({ id: 'expelled', text: expelledSegment(state, preset, L) });

  out.push({ id: 'near', text: nearSegment(state, preset, L) });
  out.push({ id: 'weekAhead', text: weekAheadSegment(state, preset, L) });

  const score = overallScore(state, preset);
  out.push({
    id: 'score',
    text: score === null ? '' : fill(L.score, { scoreName: vocab.score || '', value: roundScore(score) }),
  });

  out.push({ id: 'relation', text: relationSegment(state, preset, L, mode) });

  out.push({ id: 'reputation', text: reputationSegment(state, preset, L) });
  out.push({ id: 'study', text: studySegment(state, preset, L) });
  return out;
}

function studySegment(state, preset, L) {
  const today = state.calendar.day;
  const yesterday = addDays(today, -1);
  const items = [];
  for (const subject of state.subjects || []) {
    for (const g of subject.grades || []) {
      if ((g.day !== today && g.day !== yesterday) || !notableGrade(preset, g.value)) continue;
      items.push(fill(L.studyItem, {
        subject: subject.name || subject.id, grade: g.value, when: g.day === today ? L.studyToday : L.studyYesterday,
      }));
    }
  }
  return items.length ? fill(L.study, { list: items.slice(-4).join(L.listGlue) }) : '';
}

function daySegment(state, preset, L) {
  const day = state.calendar.day;
  const weekday = (L.weekdays || [])[weekdayIn(state, day) - 1] || '';
  const week = weekIndex(state, day, preset);
  const phase = phaseOf(preset, state, day);
  const phases = L.phases || {};
  const word = (phase === 'study' && preExamWeek(preset, state, day) ? (phases.preExamsEn || DEFAULT_LABELS.phases.preExamsEn) : phases[phase]) || '';

  const at = termAt(preset, state, day);
  const declared = at.term ? at.term.declared : {};
  const span = numberOr(declared.studyWeeks, 0) + numberOr(declared.examWeeks, 0);
  const inTerm = week >= 1 && (!span || at.inside);

  if (!inTerm) return word ? fill(L.dayOutside, { weekday, phase: word }) : weekday;
  if (!word) return fill(L.day, { weekday, week: String(week) });
  return fill(L.dayPhase, { weekday, week: String(week), phase: word });
}

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
      subject: timed(item, cur.status === 'now'),
      teacher: teacherTail(state, item.teacherId, L),
    });
  }

  const nowItem = cur.status === 'now' ? plan.find((p) => p.index === cur.index) : null;
  const names = [...new Set(plan.map((p) => p.name))];
  const list = names.map((name) => (nowItem && name === nowItem.name ? fill(L.nowMark, { subject: timed(nowItem, true) }) : name));
  return fill(L.today, { list: list.join(L.listGlue) });
}

function timed(item, whole) {
  if (!item.start) return item.name;
  return `${whole && item.end ? `${item.start}–${item.end}` : item.start} ${item.name}`;
}

function relationSegment(state, preset, L, mode) {
  const teacher = teacherInFrame(state, preset, mode);
  if (!teacher) return '';
  const scale = (preset && preset.relations) || {};
  const label = relationLabel(state, teacher.id, preset);
  if (!label || label === labelFor(scale.labels || [], numberOr(scale.start, 0))) return '';
  return fill(L.relation, { teacher: teacher.name || teacher.id, hero: heroWords(presetGender(preset)).heroEn, label });
}

function nearSegment(state, preset, L) {
  const list = upcomingEvents(state, preset);
  if (!list.length) return '';
  const parts = [];
  for (const ev of list) {
    const when = nearWhen(ev, L, state);
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

function holidaySegment(state, preset, L, part) {
  const day = state.calendar && state.calendar.day;
  if (!day) return '';
  const bg = holidayBackground(preset, day, state);
  if (part === 'now') return holidayPhrase(bg.now.map((h) => ({ h, note: bare(h.today) })), L, L.holidayNow, L.holidayNowBare, {});
  const first = bg.aheadAll[0];
  if (!first) return '';
  const when = first.days > 6 ? L.holidaySoon : nearWhen({ days: first.days, day: first.day }, L, state);
  if (!when) return '';
  return holidayPhrase(bg.aheadAll.map((a) => ({ h: a.holiday, note: bare(buzzFor(a.holiday, a.days)) })), L, L.holidayAhead, L.holidayAheadBare, { when });
}

function feedSegment(state, L, { quiet = false, holiday = false, crowdIn = 'class' } = {}) {
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

function goingSegment(state, preset, L) {
  const gender = presetGender(preset);
  return goingToday(state, preset)
    .map((g) => cap(fill(L.holidayGoing, { hero: heroWords(gender).heroEn, name: g.eventName, who: g.who })))
    .join(L.glue);
}

function holidayPhrase(items, L, full, short, vars) {
  let out = '';
  items.forEach(({ h, note: raw }, i) => {
    const note = dropName(raw, h.name);
    const text = i === 0
      ? fill(note ? full : short, { ...vars, name: h.name, note })
      : fill(note ? L.holidayAlso : L.holidayAlsoBare, { name: h.name, note });
    out = i === 0 ? text : `${out}${items[i - 1].note ? ', ' : ' '}${text}`;
  });
  return out;
}

function nearWhen(ev, L, state) {
  if (ev.days === 0) return L.nearToday;
  if (ev.days === 1) return L.nearTomorrow;
  return (L.weekdaysOn || [])[weekdayIn(state, ev.day) - 1] || '';
}

function subjectName(state, id) {
  const s = (state.subjects || []).find((x) => x.id === id);
  return (s && (s.name || s.id)) || String(id || '');
}

function weekAheadSegment(state, preset, L) {
  if (!state.exams || state.exams.active) return '';
  return weekAheadKinds(state, preset).map((k) => (k.subjects.length > 3
    ? fill(L.weekAheadAll, { what: k.name })
    : fill(L.weekAhead, { what: k.name, subjects: k.subjects.join(L.listGlue) }))).join(L.nearGlue);
}

function expelledSegment(state, preset, L) {
  if (!(state.reputation && state.reputation.expelled)) return '';
  const vocab = vocabOf(preset);
  return fill(L.expelled, { hero: heroWords(presetGender(preset)).heroEn, paths: (typeof vocab.expelPaths === 'string' && vocab.expelPaths.trim()) || L.expelPaths });
}

function reputationSegment(state, preset, L) {
  const scale = (preset && preset.reputation) || {};
  const label = reputationLabel(state, preset);
  if (!label) return '';
  const start = labelFor(scale.labels || [], numberOr(scale.start, state.reputation.value));
  if (label === start) return '';
  const en = (((preset && preset.phrases) || {}).lorebook || {}).reputationEn;
  const found = (scale.labels || []).findIndex((l) => state.reputation.value <= l.upTo);
  const at = found < 0 ? (scale.labels || []).length - 1 : found;
  return fill(L.reputation, { label: (Array.isArray(en) && typeof en[at] === 'string' && en[at]) || label });
}

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

export function markerInstruction(state, preset) {
  const P = promptsOf(preset);
  const vocab = vocabOf(preset);
  const parts = [fill(P.marker, {
    period: periodWord(preset),
    teacher: firstId(state && state.teachers) || vocab.teacher || '',
    ...subjectVars(preset),
  })];

  const subjects = idsOf(state && state.subjects);
  if (subjects.length) parts.push(fill(P.markerIds, { subjects: subjects.join(', '), subjectsTitle: upFirst(subjectVars(preset).subjectPlural) }));

  const teachers = idsOf(state && state.teachers);
  if (teachers.length) {
    parts.push(fill(P.markerTeachers, {
      teacherPlural: cap(vocab.teacherPlural || vocab.teacher || ''),
      teachers: teachers.join(', '),
    }));
  }
  return parts.filter(Boolean).join('\n');
}

export function injectBlock(injects) {
  if (!Array.isArray(injects) || !injects.length) return '';
  const seen = new Set();
  const lines = [];
  for (const item of injects) {
    const text = item && item.text ? String(item.text).trim() : '';
    if (!text) continue;
    const id = item.id === undefined ? item.text : item.id;
    if (seen.has(id)) continue;
    seen.add(id);
    lines.push(text);
  }
  return lines.join('\n');
}

export function buildPrompt(state, preset, { injects = [], withMarker = true, feed = null, heroine = '' } = {}) {
  return {
    status: statusLine(state, preset, { feed, heroine }),
    instruction: withMarker ? markerInstruction(state, preset) : '',
    oneShot: injectBlock(injects),
  };
}

export function countNumbers(text) {
  const bare = String(text || '').replace(/\b\d{1,2}:\d{2}(?:–\d{1,2}:\d{2})?\b/g, '');
  return (bare.match(/\d+(?:[.,:]\d+)*/g) || []).length;
}

export function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function roundScore(value) {
  const r = Math.round(value * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function idsOf(list) {
  return (Array.isArray(list) ? list : []).map((x) => x && x.id).filter(Boolean);
}

const firstId = (list) => idsOf(list)[0] || '';

function cap(text) {
  const s = String(text || '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function numberOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

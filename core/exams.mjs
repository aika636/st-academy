import { presetGender } from './gender.mjs';
import {
  cloneState, pushJournal, pushPending, findSubject, teacherOfSubject, clamp, isDay,
} from './state.mjs';
import { addDays, diffDays, mondayOf, termAt, termsOf, phaseOf, dayOfWeek } from './time.mjs';
import { addGrade, subjectScore, stampDebt, debtReasons, DEBT_EXAM, DEBT_MISSED, DEBT_RETAKE, DEBT_SKIPS, DEBT_GRADE } from './gradebook.mjs';

export const DEFAULTS = {
  retakes: 1,
  dc: { base: 8, score: 24, relation: 6, reputation: 6, critMargin: 10 },
};

export const DIE = 20;

export const TIERS = ['critFail', 'fail', 'success', 'critSuccess'];

export const DEFAULT_PHRASES = {
  auto: 'Свершилось: {subject} — {value} без испытания ({teacher}). Отыграй это как уже случившееся.',
  passed: 'Свершилось: {subject} — {value} ({teacher}). Отыграй это как уже случившееся.',
  failed: 'Свершилось: {subject} — {value} ({teacher}). Отправлена на пересдачу, попыток осталось: {left}. Отыграй это как уже случившееся.',
  exhausted: 'Свершилось: {subject} — {value} ({teacher}). Попытки исчерпаны, {debt} остаётся. Отыграй это как уже случившееся.',
  permissionAuto: '{examPeriod}: {subject} — {scoreName} {score}, {auto} возможен. Провал на ровном месте отыгрывать запрещено.',
  permissionNoAuto: '{examPeriod}: {subject} — {scoreName} {score}, {auto} невозможен; {teacher} принимает на общих основаниях. Блестящую сдачу без испытания отыгрывать запрещено.',
  permissionRisk: '{examPeriod}: {subject} — {scoreName} {score}, сдача под вопросом; {teacher} вправе отправить на пересдачу. Успешный исход отыгрывать запрещено, его считает система.',
  divergence: 'Расхождение по {subject}: посчитано {computed}, отыграно {said}. Принята версия модели.',
  scheduled: '{examPeriod}: назначено {count}.',
  scheduledKind: '{kind}: назначено {count}.',
  missed: '{examPeriod} закончена: {subject} — не сдано, {debt} остаётся.',
  tail: '{examPeriod} закончена: {subject} — не сдано, {debt}; {due}.',
  debtSkips: 'прогулы',
  debtGrade: 'оценка ниже проходной',
  debtExam: 'попытки исчерпаны',
  debtMissed: 'не сдано до конца периода',
  debtRetake: 'пересдача в начале следующего периода',
  announceLater: 'Свершилось: {subject} — сдача позади ({teacher}). Закрытые сведения симуляции, не знание персонажей: {result}. Итог объявят {date}; до того оценку в сцене не знает никто, включая героиню. Отыграй саму сдачу как уже случившееся.',
  announced: 'Итоги объявлены: {subject} — {result} ({teacher}). Теперь это знают все; отыграй, как героиня узнаёт итог.',
  resultPassed: '{value}',
  resultFailed: '{value}, пересдача (попыток осталось: {left})',
  resultExhausted: '{value}, попытки исчерпаны, {debt} остаётся',
};

export const DEFAULT_SCENE_GUARD = 'Если сцена сейчас интимная или для этого неподходящая — не обрывай её: отложи это до первой уместной минуты.';

const examsOf = (preset) => (preset && preset.exams) || {};
const gradesOf = (preset) => (preset && preset.grades) || {};
const vocabOf = (preset) => (preset && preset.vocab) || {};
export const MALE_PHRASES = {
  failed: 'Свершилось: {subject} — {value} ({teacher}). Отправлен на пересдачу, попыток осталось: {left}. Отыграй это как уже случившееся.',
  announceLater: 'Свершилось: {subject} — сдача позади ({teacher}). Закрытые сведения симуляции, не знание персонажей: {result}. Итог объявят {date}; до того оценку в сцене не знает никто, включая героя. Отыграй саму сдачу как уже случившееся.',
  announced: 'Итоги объявлены: {subject} — {result} ({teacher}). Теперь это знают все; отыграй, как герой узнаёт итог.',
};

const phrasesOf = (preset) => ({
  ...DEFAULT_PHRASES,
  ...(presetGender(preset) === 'm' ? MALE_PHRASES : {}),
  ...((preset && preset.phrases && preset.phrases.exams) || {}),
});

export const EXAM_RULES = ['story', 'dice'];

export const examRule = (state) => (state && state.examBy === 'story' ? 'story' : 'dice');

export const examKinds = (preset) => examsOf(preset).kinds || [];

export function kindOf(preset, kindId) {
  const kinds = examKinds(preset);
  return kinds.find((k) => k.id === kindId) || kinds[0] || null;
}

const exactKind = (preset, kindId) => examKinds(preset).find((k) => k.id === kindId) || null;

export const kindWeek = (kind, periodIndex = 0) => {
  const raw = kind && (Array.isArray(kind.atWeek) ? kind.atWeek[periodIndex] : kind.atWeek);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : null;
};

export const isDatedExam = (preset, item) => {
  const count = termsOf(preset).length || 1;
  const period = item && Number.isFinite(item.term) ? ((item.term % count) + count) % count : 0;
  return kindWeek(exactKind(preset, item && item.kind), period) !== null;
};

export function weekAheadKinds(state, preset) {
  const at = termAt(preset, state, state.calendar && state.calendar.day);
  if (!at.term || !at.inside) return [];
  const term = at.index >= 0 ? at.serial : 0;
  const items = (state.exams && state.exams.items) || [];
  return examKinds(preset).filter((k) => {
    const week = kindWeek(k, at.index);
    return week !== null && at.week === week - 1;
  }).map((k) => ({
    kind: k.id,
    name: String(k.name || k.id),
    subjects: (state.subjects || [])
      .filter((s, pos) => kindsForSubject(preset, s, pos).some((x) => x.id === k.id) && !items.some((i) => i.id === `${term}:${s.id}:${k.id}`))
      .map((s) => s.name || s.id),
  })).filter((x) => x.subjects.length);
}

const isPassScale = (v) => v.points === null || v.points === undefined;
const isPointScale = (v) => typeof v.points === 'number' && Number.isFinite(v.points);

const rankKey = (v) => [v.pass === false ? 0 : 1, isPointScale(v) ? v.points : 0];
const rankCmp = (a, b) => (rankKey(b)[0] - rankKey(a)[0]) || (rankKey(b)[1] - rankKey(a)[1]);
const rankId = (v) => rankKey(v).join(':');

export function outcomeLadder(preset, kindId) {
  const kind = kindOf(preset, kindId);
  const scale = kind && kind.scale;
  const all = (gradesOf(preset).values || []).filter(scale === 'pass' ? isPassScale : isPointScale);
  const sorted = all
    .map((v, i) => ({ v, i }))
    .sort((a, b) => rankCmp(a.v, b.v) || a.i - b.i);

  const rungs = [];
  const seen = new Set();
  for (const { v } of sorted) {
    const key = rankId(v);
    if (seen.has(key)) continue;
    seen.add(key);
    rungs.push(v);
  }
  return rungs;
}

export function autoValue(preset, kindId) {
  if (examsOf(preset).autoValue) return String(examsOf(preset).autoValue);
  const kind = kindOf(preset, kindId);
  const all = (gradesOf(preset).values || []).filter(kind && kind.scale === 'pass' ? isPassScale : isPointScale);
  if (!all.length) return '';
  const best = all.slice().sort(rankCmp)[0];
  const same = all.filter((v) => rankId(v) === rankId(best));
  return String(same[same.length - 1].value);
}

export function gradeInfo(preset, value) {
  const g = gradesOf(preset);
  const raw = String(value == null ? '' : value).trim();
  const canonical = (g.aliases && g.aliases[raw.toLowerCase()]) || raw;
  return (g.values || []).find((v) => String(v.value) === String(canonical)) || null;
}

export const isPassing = (preset, value) => Boolean(gradeInfo(preset, value) && gradeInfo(preset, value).pass);

export const attemptsAllowed = (preset) => 1 + numberOr(examsOf(preset).retakes, DEFAULTS.retakes);

export const retakesLeft = (preset, item) => Math.max(0, attemptsAllowed(preset) - numberOr(item && item.attempts, 0));

export function kindsForSubject(preset, subject, rr = 0) {
  const kinds = examKinds(preset);
  if (!kinds.length) return [];

  const listed = Array.isArray(subject && subject.examKinds) ? subject.examKinds : [];
  const picked = listed.map((id) => kinds.find((k) => k.id === id)).filter(Boolean);
  if (picked.length) return picked;

  const one = subject && subject.examKind ? kinds.find((k) => k.id === subject.examKind) : null;
  if (one) return [one];

  const every = kinds.filter((k) => k.everySubject === true);
  if (every.length) return every;

  return [kinds[((rr % kinds.length) + kinds.length) % kinds.length]];
}

export function examTermIndex(preset, state, day) {
  const when = isDay(day) ? day : (state.calendar && state.calendar.day);
  const at = termAt(preset, state, when);
  return at.index >= 0 ? at.serial : 0;
}

export function examScore(state, preset, item) {
  const subjectId = item && item.subjectId;
  const term = Number.isFinite(item && item.term)
    ? item.term
    : examTermIndex(preset, state, item && item.day);
  const average = subjectScore(state, subjectId, preset, { term }).average;
  return average ?? (preset && preset.grades && preset.grades.startScore);
}

export function examSessionEnded(state, preset, day = state.calendar && state.calendar.day) {
  const exams = (state && state.exams) || {};
  if (!exams.active) return false;
  if (!Number.isFinite(exams.term)) return false;
  const at = termAt(preset, state, day);
  if (!at.term) return false;
  if (at.serial !== exams.term) return true;
  return !(at.inside && at.week > at.term.studyWeeks);
}

export function closeExamSession(state, preset) {
  const next = cloneState(state);
  if (!next.exams.active) return next;
  next.exams.active = false;

  const term = next.exams.term;
  const ph = phrasesOf(preset);
  const missed = [];
  for (const item of next.exams.items || []) {
    if (Number.isFinite(term) && Number.isFinite(item.term) && item.term !== term) continue;
    if (item.outcome && !item.tail && !isPassing(preset, item.outcome) && retakesLeft(preset, item) > 0) {
      item.tail = true;
      const owner = findSubject(next, item.subjectId);
      if (owner && owner.debtReason !== DEBT_EXAM && owner.debtReason !== DEBT_MISSED) stampDebt(owner, DEBT_RETAKE);
      pushJournal(next, {
        kind: 'exam',
        text: fill(ph.tail, {
          subject: (owner && owner.name) || item.subjectId,
          debt: vocabOf(preset).debt || '',
          examPeriod: vocabOf(preset).examPeriod || '',
          due: ph.debtRetake,
        }),
        data: { examId: item.id, subjectId: item.subjectId, tail: true, term },
      }, preset);
      continue;
    }
    if (!(item.outcome === null || item.outcome === undefined || item.outcome === '')) continue;
    if (item.missed) continue;
    item.missed = true;
    missed.push(item);

    const subject = findSubject(next, item.subjectId);
    if (subject && !subject.debtReason) stampDebt(subject, DEBT_MISSED);
    const kind = kindOf(preset, item.kind);
    pushJournal(next, {
      kind: 'exam',
      text: fill(ph.missed, {
        subject: (subject && subject.name) || item.subjectId,
        kind: (kind && kind.name) || String(item.kind || ''),
        debt: vocabOf(preset).debt || '',
        examPeriod: vocabOf(preset).examPeriod || '',
      }),
      data: { examId: item.id, subjectId: item.subjectId, missed: true, term },
    }, preset);
  }

  pushJournal(next, { kind: 'debug', text: '', data: { examsClosed: term, missed: missed.length } }, preset);
  return next;
}

function sessionItems(state) {
  const exams = (state && state.exams) || {};
  const items = exams.items || [];
  if (!Number.isFinite(exams.term)) return items;
  return items.filter((i) => !Number.isFinite(i.term) || i.term === exams.term);
}

export function scheduleExams(state, preset, opts = {}) {
  const next = cloneState(state);
  const day = isDay(opts.day) ? opts.day : null;
  const term = Number.isFinite(opts.term) ? opts.term : examTermIndex(preset, next, day);
  const only = Array.isArray(opts.kinds) ? new Set(opts.kinds) : null;
  const session = opts.session !== false;
  const items = next.exams.items;
  const had = new Set(items.map((i) => i.id));

  let added = 0;
  const byKind = new Map();
  for (let pos = 0; pos < next.subjects.length; pos += 1) {
    const subject = next.subjects[pos];
    if (!subject.id) continue;
    for (const kind of kindsForSubject(preset, subject, pos)) {
      if (only && !only.has(kind.id)) continue;
      const id = `${term}:${subject.id}:${kind.id}`;
      if (had.has(id)) continue;
      had.add(id);
      byKind.set(kind.id, (byKind.get(kind.id) || 0) + 1);
      items.push({
        id,
        term,
        subjectId: subject.id,
        kind: kind.id,
        day,
        outcome: null,
        attempts: 0,
      });
      added += 1;
    }
  }

  if (session) {
    next.exams.active = true;
    next.exams.term = term;
  }
  if (added && session) {
    pushJournal(next, {
      kind: 'exam',
      text: fill(phrasesOf(preset).scheduled, { examPeriod: vocabOf(preset).examPeriod || '', count: String(added) }),
      data: { added, day },
    }, preset);
  }
  if (added && !session) {
    for (const [kindId, count] of byKind) {
      pushJournal(next, {
        kind: 'exam',
        text: fill(phrasesOf(preset).scheduledKind, {
          kind: (exactKind(preset, kindId) || {}).name || kindId,
          count: String(count),
        }),
        data: { added: count, day, kind: kindId, term },
      }, preset);
    }
  }
  return next;
}

export function scheduleDatedExams(state, preset, day = state && state.calendar && state.calendar.day) {
  const at = termAt(preset, state, day);
  if (!at.term || !at.inside) return { state, added: 0 };
  const due = examKinds(preset).filter((k) => {
    const week = kindWeek(k, at.index);
    return week !== null && at.week >= week;
  });
  if (!due.length) return { state, added: 0 };

  const before = ((state.exams && state.exams.items) || []).length;
  const next = scheduleExams(state, preset, {
    day,
    term: at.index >= 0 ? at.serial : 0,
    kinds: due.map((k) => k.id),
    session: false,
  });
  return { state: next, added: next.exams.items.length - before };
}

export function datedExams(state, preset, day = state && state.calendar && state.calendar.day) {
  const items = (state && state.exams && state.exams.items) || [];
  const at = termAt(preset, state, day);
  if (!at.inside) return [];
  const term = at.index >= 0 ? at.serial : 0;
  return items.filter((i) => isDatedExam(preset, i)
    && (!Number.isFinite(i.term) || i.term === term)
    && !i.missed
    && unfinished(preset, i)
    && !awaitingAnnouncement(i)
    && (!isDay(i.day) || diffDays(i.day, day) >= 0));
}

export function sittableExams(state, preset, day = state && state.calendar && state.calendar.day) {
  const phase = phaseOf(preset, state, day);
  const out = [];
  if (phase === 'study' || phase === 'exams') out.push(...datedExams(state, preset, day));
  const mode = examMode(state, preset);
  if (phase === 'exams' && mode.active) {
    for (const item of mode.pending) {
      if (awaitingAnnouncement(item) || fromPastTerm(preset, state, item)) continue;
      if (!out.some((x) => x.id === item.id)) out.push(item);
    }
  }
  return out;
}

export function examMode(state, preset) {
  const active = Boolean(state && state.exams && state.exams.active);
  return {
    active,
    pending: sessionItems(state).filter((i) => unfinished(preset, i)),
    daysLeft: active ? daysLeftOf(state, preset) : null,
  };
}

function unfinished(preset, item) {
  if (!item) return false;
  if (item.outcome === null || item.outcome === undefined || item.outcome === '') return true;
  return !isPassing(preset, item.outcome) && retakesLeft(preset, item) > 0;
}

function examDebtReason(state, preset, item, passed) {
  const waiting = (state.exams.items || []).some((i) => i.id !== item.id && i.subjectId === item.subjectId
    && i.tail && i.outcome && !isPassing(preset, i.outcome) && retakesLeft(preset, i) > 0);
  if (passed) return waiting ? DEBT_RETAKE : null;
  if (retakesLeft(preset, item) <= 0) return DEBT_EXAM;
  return item.tail || waiting ? DEBT_RETAKE : null;
}

export function retakeList(state, preset) {
  const out = new Map();
  for (const item of (state && state.exams && state.exams.items) || []) {
    if (!item.outcome || isPassing(preset, item.outcome) || awaitingAnnouncement(item) || retakesLeft(preset, item) <= 0) continue;
    const subject = findSubject(state, item.subjectId);
    out.set(item.subjectId, { subjectId: item.subjectId, name: (subject && subject.name) || item.subjectId, left: retakesLeft(preset, item) });
  }
  return [...out.values()];
}

export function debtReasonText(preset, subject) {
  const ph = phrasesOf(preset);
  const key = { [DEBT_SKIPS]: 'debtSkips', [DEBT_GRADE]: 'debtGrade', [DEBT_EXAM]: 'debtExam', [DEBT_MISSED]: 'debtMissed', [DEBT_RETAKE]: 'debtRetake' };
  return debtReasons(subject).map((code) => (key[code] ? fill(ph[key[code]], { examPeriod: vocabOf(preset).examPeriod || '' }) : '')).filter(Boolean).join('; ');
}

export function fromPastTerm(preset, state, item) {
  if (item.outcome || !isDay(item.day) || !state.calendar) return false;
  const was = termAt(preset, state, item.day);
  const now = termAt(preset, state, state.calendar.day);
  return was.inside && now.inside && was.serial !== now.serial;
}

function daysLeftOf(state, preset) {
  const start = state.calendar && state.calendar.termStart;
  const today = state.calendar && state.calendar.day;
  if (!isDay(start) || !isDay(today)) return null;
  const at = termAt(preset, state, today);
  const term = at.term;
  if (!term || !Number.isFinite(term.declared.studyWeeks) || !Number.isFinite(term.declared.examWeeks)) return null;
  const lastDay = addDays(mondayOf(term.start), term.span * 7 - 1);
  const left = diffDays(today, lastDay);
  return left < 0 ? null : left;
}

export function normalizeScore(preset, score) {
  const points = (gradesOf(preset).values || []).filter(isPointScale).map((v) => v.points);
  if (points.length < 2) return clamp(numberOr(score, 0), 0, 1);
  const min = Math.min(...points);
  const max = Math.max(...points);
  return clamp((numberOr(score, min) - min) / (max - min), 0, 1);
}

export function normalizeRelation(preset, relation) {
  const r = (preset && preset.relations) || {};
  const min = numberOr(r.min, 0);
  const max = numberOr(r.max, 0);
  if (max <= min) return clamp(numberOr(relation, 0), 0, 1);
  return clamp((numberOr(relation, numberOr(r.start, min)) - min) / (max - min), 0, 1);
}

export function dcParams(preset) {
  const own = (examsOf(preset).dc && typeof examsOf(preset).dc === 'object') ? examsOf(preset).dc : {};
  const pick = (key, min = 0) => {
    const v = own[key];
    return typeof v === 'number' && Number.isFinite(v) && v >= min ? v : DEFAULTS.dc[key];
  };
  const pass = numberOr(gradesOf(preset).passMark, null);
  const auto = numberOr(examsOf(preset).autoPassScore, null);
  const guessed = pass !== null && auto !== null ? (pass + auto) / 2 : Infinity;
  return {
    base: pick('base', -Infinity),
    score: pick('score'),
    relation: pick('relation'),
    reputation: pick('reputation'),
    critMargin: Math.max(1, pick('critMargin', 1)),
    safeScore: numberOr(own.safeScore, guessed),
  };
}

function kindBase(preset, kindId) {
  const kind = kindOf(preset, kindId);
  const own = kind && kind.dc;
  return typeof own === 'number' && Number.isFinite(own) ? own : dcParams(preset).base;
}

export function examDC({ score, relation, reputation, kind } = {}, preset) {
  const p = dcParams(preset);
  const base = kindBase(preset, kind);

  const points = (gradesOf(preset).values || []).filter(isPointScale).map((v) => v.points);
  const span = points.length >= 2 ? Math.max(...points) - Math.min(...points) : 0;
  const pass = numberOr(gradesOf(preset).passMark, null);
  const scoreMod = span > 0 && pass !== null && typeof score === 'number' && Number.isFinite(score)
    ? round(p.score * (score - pass) / span)
    : 0;

  const r = (preset && preset.relations) || {};
  const relSpan = numberOr(r.max, 0) - numberOr(r.min, 0);
  const relationMod = relSpan > 0 && typeof relation === 'number' && Number.isFinite(relation)
    ? round(p.relation * (relation - numberOr(r.start, 0)) / relSpan)
    : 0;

  const rep = (preset && preset.reputation) || {};
  const repSpan = numberOr(rep.max, 0) - numberOr(rep.min, 0);
  const reputationMod = repSpan > 0 && typeof reputation === 'number' && Number.isFinite(reputation)
    ? round(p.reputation * (reputation - numberOr(rep.start, numberOr(rep.min, 0))) / repSpan)
    : 0;

  const mods = { score: scoreMod, relation: relationMod, reputation: reputationMod };
  return { dc: base - scoreMod - relationMod - reputationMod, base, mods };
}

export function checkTier(roll, dc, preset) {
  const { critMargin } = dcParams(preset);
  const margin = roll - dc;
  if (margin >= critMargin) return 'critSuccess';
  if (margin >= 0) return 'success';
  if (margin > -critMargin) return 'fail';
  return 'critFail';
}

export function rollDie(rng) {
  const x = clamp(numberOr(typeof rng === 'function' ? rng() : NaN, 0.5), 0, 0.999999);
  return 1 + Math.floor(x * DIE);
}

function valueForTier(ladder, tier, margin, preset) {
  const passing = ladder.filter((v) => v.pass !== false);
  const failing = ladder.filter((v) => v.pass === false);
  const { critMargin } = dcParams(preset);

  if (tier === 'critSuccess' && passing.length) return passing[0];
  if ((tier === 'success' || tier === 'critSuccess') && passing.length) {
    const rungs = passing.length > 1 ? passing.slice(1) : passing;
    const n = rungs.length;
    const up = clamp(Math.floor((Math.max(0, margin) * n) / critMargin), 0, n - 1);
    return rungs[n - 1 - up];
  }
  if (!failing.length) return passing[passing.length - 1] || ladder[ladder.length - 1];
  return tier === 'critFail' ? failing[failing.length - 1] : failing[0];
}

export function rollOutcome({ score, relation, reputation, kind }, preset, rng = Math.random) {
  const auto = numberOr(examsOf(preset).autoPassScore, Infinity);
  if (numberOr(score, -Infinity) >= auto) {
    return { value: autoValue(preset, kind), roll: null, reason: 'auto', check: null };
  }

  const { dc, base, mods } = examDC({ score, relation, reputation, kind }, preset);
  const roll = rollDie(rng);
  const margin = roll - dc;
  const tier = checkTier(roll, dc, preset);
  const check = { dc, base, mods, roll, margin, tier, saved: false, capped: false };

  const ladder = outcomeLadder(preset, kind);
  if (!ladder.length) return { value: '', roll, reason: 'noScale', check };

  let picked = valueForTier(ladder, tier, margin, preset);
  const passing = ladder.filter((v) => v.pass !== false);
  const failed = tier === 'fail' || tier === 'critFail';
  if (failed && numberOr(score, -Infinity) >= dcParams(preset).safeScore && passing.length) {
    picked = passing[passing.length - 1];
    check.saved = true;
  }
  const pass = numberOr(gradesOf(preset).passMark, null);
  if (tier === 'critSuccess' && pass !== null && numberOr(score, Infinity) < pass && passing.length > 1) {
    picked = passing[1];
    check.capped = true;
  }
  return { value: String(picked.value), roll, reason: 'roll', check };
}

export function fnv1a(text) {
  let h = 0x811c9dc5;
  const s = String(text == null ? '' : text);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function seededRng(seed) {
  let a = fnv1a(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function examSeed(chatSeed, item, day) {
  const attempt = numberOr(item && item.attempts, 0) + 1;
  return [String(chatSeed == null ? '' : chatSeed), (item && item.id) || '', attempt, day || ''].join('|');
}

export function applyOutcome(state, { examId, value, day, reason, check }, preset) {
  let next = cloneState(state);
  let item = next.exams.items.find((i) => i.id === examId);
  if (!item) return { state: next, pending: null };

  const when = isDay(day) ? day : (next.calendar && next.calendar.day) || '';
  const passed = isPassing(preset, value);
  item.outcome = String(value);
  item.attempts = numberOr(item.attempts, 0) + 1;
  if (when) item.day = when;
  const announceOn = reason === 'auto' ? null : announceDay(preset, item.kind, when);
  delete item.announced;
  delete item.announceOn;
  if (announceOn) {
    item.announced = false;
    item.announceOn = announceOn;
  }
  const record = rollRecord({ day: when, value, reason, check });
  if (record) item.rolls = [...(Array.isArray(item.rolls) ? item.rolls : []), record];

  const graded = addGrade(next, { subjectId: item.subjectId, value, day: when }, preset);
  if (graded.applied) {
    next = graded.state;
    item = next.exams.items.find((i) => i.id === examId);
  }

  const subject = findSubject(next, item.subjectId);
  if (subject) {
    if (!graded.applied) subject.grades.push({ value: String(value), day: when });
    stampDebt(subject, examDebtReason(next, preset, item, passed));
  }

  const left = retakesLeft(preset, item);
  const verdict = verdictText(next, preset, item, value, reason);
  const inject = { id: `exam:${item.id}:${item.attempts}`, kind: 'exam', text: withSceneGuard(verdict, preset) };
  pushPending(next, inject);
  pushJournal(next, {
    kind: 'exam',
    text: verdict,
    data: {
      examId, value: String(value), passed, left, ...(check ? { check } : {}),
      ...(announceOn ? { private: true, announceOn } : {}),
    },
  }, preset);

  return { state: next, pending: inject };
}

export function verdictText(state, preset, item, value, reason) {
  const ph = phrasesOf(preset);
  const vars = verdictVars(state, preset, item, value);
  if (awaitingAnnouncement(item)) {
    return fill(ph.announceLater, { ...vars, result: resultText(preset, item, value, vars), date: shortDate(item.announceOn) });
  }
  const passed = isPassing(preset, value);
  const wasAuto = reason === 'auto'
    || (String(value) === autoValue(preset, item.kind)
        && !outcomeLadder(preset, item.kind).some((v) => String(v.value) === String(value)));
  const template = passed
    ? (wasAuto ? ph.auto : ph.passed)
    : (retakesLeft(preset, item) > 0 ? ph.failed : ph.exhausted);
  return fill(template, vars);
}

function verdictVars(state, preset, item, value) {
  const subject = findSubject(state, item.subjectId);
  const teacher = teacherOfSubject(state, item.subjectId);
  const info = gradeInfo(preset, value);
  return {
    subject: (subject && subject.name) || item.subjectId,
    value: (info && info.label) || String(value),
    teacher: (teacher && teacher.name) || vocabOf(preset).teacher || '',
    left: String(retakesLeft(preset, item)),
    debt: vocabOf(preset).debt || '',
    examPeriod: vocabOf(preset).examPeriod || '',
  };
}

function resultText(preset, item, value, vars) {
  const ph = phrasesOf(preset);
  const template = isPassing(preset, value)
    ? ph.resultPassed
    : (retakesLeft(preset, item) > 0 ? ph.resultFailed : ph.resultExhausted);
  return fill(template, vars);
}

function shortDate(day) {
  if (!isDay(day)) return '';
  const [, m, d] = day.split('-');
  return `${d}.${m}`;
}

const MAX_ANNOUNCE_DAYS = 14;

export function announceRule(preset, kindId) {
  const kind = exactKind(preset, kindId);
  const raw = kind && kind.announce !== undefined ? kind.announce : examsOf(preset).announce;
  const rule = typeof raw === 'number' ? { studyDays: raw } : raw;
  if (!rule || typeof rule !== 'object') return null;
  const n = Number(rule.studyDays);
  if (Number.isInteger(n) && n >= 1) return { studyDays: Math.min(n, MAX_ANNOUNCE_DAYS) };
  const w = Number(rule.weekday);
  if (Number.isInteger(w) && w >= 1 && w <= 7) return { weekday: w };
  return null;
}

export function announceDay(preset, kindId, day) {
  const rule = announceRule(preset, kindId);
  if (!rule || !isDay(day)) return null;
  if (rule.weekday) {
    for (let k = 1; k <= 7; k += 1) {
      const d = addDays(day, k);
      if (dayOfWeek(d) === rule.weekday) return d;
    }
    return null;
  }
  const study = (preset && preset.week && Array.isArray(preset.week.studyDays) && preset.week.studyDays.length)
    ? preset.week.studyDays
    : [1, 2, 3, 4, 5];
  let left = rule.studyDays;
  let d = day;
  for (let guard = 0; left > 0 && guard < MAX_ANNOUNCE_DAYS * 7; guard += 1) {
    d = addDays(d, 1);
    if (study.includes(dayOfWeek(d))) left -= 1;
  }
  return left > 0 ? addDays(day, rule.studyDays) : d;
}

export const awaitingAnnouncement = (item) => Boolean(item) && item.announced === false;

export function announceResults(state, preset, day = state && state.calendar && state.calendar.day) {
  const items = (state && state.exams && state.exams.items) || [];
  const due = items.filter((i) => awaitingAnnouncement(i) && isDay(i.announceOn) && isDay(day)
    && diffDays(i.announceOn, day) >= 0);
  if (!due.length) return { state, announced: [] };

  const next = cloneState(state);
  const ph = phrasesOf(preset);
  const announced = [];
  for (const raw of due) {
    const item = next.exams.items.find((i) => i.id === raw.id);
    item.announced = true;
    const value = item.outcome;
    const vars = verdictVars(next, preset, item, value);
    const text = fill(ph.announced, { ...vars, result: resultText(preset, item, value, vars) });
    pushPending(next, {
      id: `announce:${item.id}:${numberOr(item.attempts, 0)}`, kind: 'announce', text: withSceneGuard(text, preset),
    });
    pushJournal(next, {
      kind: 'exam',
      text,
      data: {
        examId: item.id, value: String(value), passed: isPassing(preset, value),
        left: retakesLeft(preset, item), announced: true,
      },
    }, preset);
    announced.push(item.id);
  }
  return { state: next, announced };
}

export function publicView(state, preset) {
  const hidden = ((state && state.exams && state.exams.items) || []).filter(awaitingAnnouncement);
  if (!hidden.length) return state;
  const next = cloneState(state);
  for (const item of hidden) {
    const subject = findSubject(next, item.subjectId);
    if (!subject) continue;
    const grades = subject.grades || [];
    for (let i = grades.length - 1; i >= 0; i -= 1) {
      if (String(grades[i].value) === String(item.outcome) && (!item.day || grades[i].day === item.day)) {
        grades.splice(i, 1);
        break;
      }
    }
    if (subject.debtReason === DEBT_EXAM || subject.debtReason === DEBT_RETAKE) stampDebt(subject, null);
    const own = next.exams.items.find((i) => i.id === item.id);
    if (own && Array.isArray(own.rolls) && own.rolls.length) own.rolls = own.rolls.slice(0, -1);
  }
  return next;
}

export function sceneGuard(preset) {
  const own = preset && preset.prompts && preset.prompts.sceneGuard;
  return typeof own === 'string' ? own.trim() : DEFAULT_SCENE_GUARD;
}

export function withSceneGuard(text, preset) {
  const guard = sceneGuard(preset);
  return guard ? `${text} ${guard}` : text;
}

export function externalValue(preset, kindId, dice) {
  if (!dice || !TIERS.includes(dice.tier)) return '';
  const ladder = outcomeLadder(preset, kindId);
  if (!ladder.length) return '';
  const { critMargin } = dcParams(preset);
  const margin = Number.isFinite(dice.roll) && Number.isFinite(dice.dc)
    ? dice.roll - dice.dc
    : ({ critSuccess: critMargin, success: 0, fail: -1, critFail: -critMargin })[dice.tier];
  const picked = valueForTier(ladder, dice.tier, margin, preset);
  return picked ? String(picked.value) : '';
}

export function rollRecord({ day, value, reason, check }) {
  if (reason === 'auto') return { day: day || '', tier: 'auto', value: String(value) };
  if (!check || typeof check !== 'object' || !TIERS.includes(check.tier)) return null;
  return {
    day: day || '',
    roll: check.roll,
    dc: check.dc,
    tier: check.tier,
    value: String(value),
    ...(check.saved ? { saved: true } : {}),
    ...(check.capped ? { capped: true } : {}),
  };
}

export function resolveConflict(state, { examId, modelSaid, source }, preset) {
  const next = cloneState(state);
  const from = typeof source === 'string' && source ? { source } : {};
  const item = next.exams.items.find((i) => i.id === examId);
  if (!item) return { state: next, divergence: null };

  const info = gradeInfo(preset, modelSaid);
  if (!info) {
    const divergence = { examId, subjectId: item.subjectId, computed: item.outcome, modelSaid: String(modelSaid), applied: false, ...from };
    pushJournal(next, { kind: 'exam', text: '', data: divergence }, preset);
    return { state: next, divergence };
  }

  const said = String(info.value);
  if (item.outcome !== null && item.outcome !== undefined && String(item.outcome) === said) {
    return { state: next, divergence: null };
  }

  const computed = item.outcome === undefined ? null : item.outcome;
  item.outcome = said;
  item.modelOverride = true;

  const subject = findSubject(next, item.subjectId);
  if (subject) {
    const last = subject.grades.length ? subject.grades[subject.grades.length - 1] : null;
    if (last && computed !== null && String(last.value) === String(computed)) last.value = said;
    else subject.grades.push({ value: said, day: (next.calendar && next.calendar.day) || '' });
    stampDebt(subject, examDebtReason(next, preset, item, info.pass));
  }

  next.pending = next.pending.filter((p) => !String(p.id).startsWith(`exam:${item.id}:`));
  if (from.source === 'dice') {
    pushPending(next, {
      id: `exam:${item.id}:${numberOr(item.attempts, 0)}`,
      kind: 'exam',
      text: withSceneGuard(verdictText(next, preset, item, said, 'dice'), preset),
    });
  }

  const divergence = { examId, subjectId: item.subjectId, computed, modelSaid: said, applied: true, ...from };
  const text = fill(phrasesOf(preset).divergence, {
    subject: (subject && subject.name) || item.subjectId,
    computed: computed === null ? '' : String(computed),
    said,
  });
  pushJournal(next, { kind: 'exam', text, data: divergence }, preset);
  return { state: next, divergence };
}

export function permissionLine(state, preset, { subjectId, score, kind }) {
  const ph = phrasesOf(preset);
  const subject = findSubject(state, subjectId);
  const teacher = teacherOfSubject(state, subjectId);
  const items = sessionItems(state);
  const item = (kind ? items.find((i) => i.subjectId === subjectId && i.kind === kind) : null)
    || items.find((i) => i.subjectId === subjectId);
  const auto = numberOr(examsOf(preset).autoPassScore, Infinity);
  const pass = numberOr(gradesOf(preset).passMark, -Infinity);
  const value = numberOr(score, 0);

  const template = value >= auto ? ph.permissionAuto : (value >= pass ? ph.permissionNoAuto : ph.permissionRisk);
  return fill(template, {
    examPeriod: vocabOf(preset).examPeriod || '',
    subject: (subject && subject.name) || String(subjectId),
    teacher: (teacher && teacher.name) || vocabOf(preset).teacher || '',
    scoreName: vocabOf(preset).score || '',
    score: String(value),
    auto: autoValue(preset, kind || (item && item.kind)),
  });
}

export function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function numberOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function round(v) {
  return Math.round(v) + 0;
}

import { cleanCanonVocab } from './canon-vocab.mjs';
import { cleanCanonLayer } from './canon-layer.mjs';
import { runningTermStart } from './time.mjs';
import { cutWords, CLASSMATE_TEXT_MAX, normalizeClassmates, normalizeCandidates, classmateErrors, normalizeAliases, normalizeNote, normalizeToHero, normalizeLoreLink } from './classmates.mjs';
import { normName } from './stop-names.mjs';
import { subjectWord } from './words.mjs';

export { normalizeAliases, ALIASES_MAX, ALIAS_LEN_MAX } from './classmates.mjs';
import { isPortrait, normalizePortrait, normalizeLooks, looksOk } from './portraits.mjs';

export const SCHEMA_VERSION = 3;

export const METADATA_KEY = 'academy';

export const CANON_MAX = 120;

export function emptySurvey() {
  return { era: '', country: '', institution: '', faculty: '', year: '', canon: '', lang: 'ru' };
}

export function normalizeCanon(v) {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length > CANON_MAX ? s.slice(0, CANON_MAX).trim() : s;
}

function surveyWith(raw) {
  const out = { ...emptySurvey(), ...(raw && typeof raw === 'object' ? raw : {}) };
  out.canon = normalizeCanon(out.canon);
  return out;
}

export function createState(preset, opts = {}) {
  if (!preset || typeof preset !== 'object') throw new TypeError('createState: нужен пресет');

  const startDay = opts.startDay || defaultStartDay(preset);

  return {
    schemaVersion: SCHEMA_VERSION,
    presetId: preset.id,
    lang: preset.lang || 'ru',
    started: false,
    survey: surveyWith(opts.survey),
    canonVocab: cleanCanonVocab(opts.canonVocab),
    canonLayer: cleanCanonLayer(opts.canonLayer),
    calendar: {
      day: startDay,
      time: null,
      precision: 'date',
      daypart: null,
      periodIndex: null,
      termStart: startDay,
      moved: 0,
      idle: 0,
      source: null,
      heldJump: null,
    },
    subjects: (opts.subjects || []).map(normalizeSubject),
    teachers: (opts.teachers || []).map((t) => normalizeTeacher(t, preset)),
    schedule: { ...(opts.schedule || {}) },
    attendance: { records: [] },
    reputation: { value: numberOr(preset.reputation && preset.reputation.start, 50), warned: false, expelled: false },
    exams: { active: false, term: null, items: [] },
    journal: [],
    pending: [],
    classmates: normalizeClassmates(opts.classmates, preset),
    classmateCandidates: [],
  };
}

export function defaultStartDay(preset, today = new Date(), year) {
  if (Number.isInteger(year) && year > 0) today = new Date(year, today.getMonth(), today.getDate());
  const cal = (preset && preset.calendar) || {};
  const terms = Array.isArray(cal.terms) ? cal.terms : [];
  const todayDay = `${String(today.getFullYear()).padStart(4, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const running = cal.termStart ? '' : runningTermStart(preset, todayDay);
  if (running) return running;
  const md = cal.termStart || (terms[0] && terms[0].start) || '09-01';
  return `${today.getFullYear()}-${md}`;
}

export function normalizeSubject(raw) {
  return {
    id: String(raw.id || '').trim(),
    name: String(raw.name || raw.id || '').trim(),
    teacherId: raw.teacherId ? String(raw.teacherId) : null,
    examKind: raw.examKind ? String(raw.examKind) : null,
    ...(Array.isArray(raw.examKinds) && raw.examKinds.length
      ? { examKinds: raw.examKinds.map(String) }
      : {}),
    grades: Array.isArray(raw.grades)
      ? raw.grades.map((g) => ({
        value: String(g.value),
        day: String(g.day || ''),
        ...(g.bg ? { bg: true } : {}),
        ...(g.bg && Number.isFinite(g.fame) && g.fame ? { fame: g.fame } : {}),
      }))
      : [],
    ...(cleanProfile(raw.profile) ? { profile: cleanProfile(raw.profile) } : {}),
    ...(Number.isFinite(raw.bg) && raw.bg > 0 ? { bg: Math.floor(raw.bg) } : {}),
    debt: Boolean(raw.debt),
    ...(raw.debt && raw.debtReason && raw.debtReason !== 'skips' ? { debtReason: String(raw.debtReason) } : {}),
    ...(raw.debt && (raw.debtSkips || raw.debtReason === 'skips' || !raw.debtReason) ? { debtSkips: true } : {}),
    ...placeField('building', raw.building),
    ...placeField('room', raw.room),
  };
}

export function cleanProfile(v) {
  const w = String(v == null ? '' : v).trim().toLowerCase().replace(/ё/g, 'е');
  if (/^(strong|сильн|любим)/.test(w)) return 'strong';
  if (/^(hard|труд|тяжел|слаб)/.test(w)) return 'hard';
  return null;
}

export const PLACE_MAX = 60;

function placeField(key, raw) {
  return textField(key, raw, PLACE_MAX);
}

function textField(key, raw, max) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return {};
  const v = cutWords(raw, max);
  return v ? { [key]: v } : {};
}

export const TEACHER_TEXT_MAX = { post: 60, likes: 120, secret: 160 };

export function teacherDetails(raw) {
  const out = {};
  for (const [key, max] of Object.entries(TEACHER_TEXT_MAX)) {
    Object.assign(out, textField(key, raw && raw[key], max));
  }
  if (raw && raw.canon === true) out.canon = true;
  const aliases = normalizeAliases(raw && raw.aliases, raw && raw.name);
  if (aliases.length) out.aliases = aliases;
  const ref = loreRef(raw && raw.lorebook);
  if (raw && raw.source === 'lorebook' && ref) { out.source = 'lorebook'; out.lorebook = ref; }
  const link = normalizeLoreLink(raw && raw.loreLink);
  if (link) out.loreLink = link;
  return out;
}

export function loreRef(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const book = typeof raw.book === 'string' ? raw.book.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  const uid = typeof raw.uid === 'string' ? raw.uid.trim().slice(0, 60) : (Number.isFinite(raw.uid) ? raw.uid : '');
  return book && uid !== '' ? { book, uid } : null;
}

export const LORE_FOUND_MAX = 40;
export function normalizeLoreFound(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    const ref = loreRef(r && r.lorebook);
    const name = r && typeof r.name === 'string' ? r.name.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    const canon = r && r.source === 'canon';
    if ((!ref && !canon) || !name) continue;
    const role = ['teacher', 'peer', 'other'].includes(r.role) ? r.role : 'other';
    const c = { name, aliases: normalizeAliases(r.aliases, name), role, ...(canon ? { source: 'canon', ...(ref ? { lorebook: ref } : {}) } : { source: 'lorebook', lorebook: ref }) };
    for (const k of ['subject', 'post', 'desire', 'problem']) Object.assign(c, textField(k, r[k], 160));
    if (normalizeLooks(r.looks)) c.looks = normalizeLooks(r.looks);
    Object.assign(c, textField('manner', r.manner, CLASSMATE_TEXT_MAX.manner));
    if (normalizeToHero(r.toHero)) c.toHero = normalizeToHero(r.toHero);
    if (normalizeToHero(r.canonHero)) c.canonHero = normalizeToHero(r.canonHero);
    if (canon) Object.assign(c, textField('club', r.club, 60));
    out.push(c);
    if (out.length >= LORE_FOUND_MAX) break;
  }
  return out;
}

export const INVITES_MAX = { decided: 60, cool: 30, going: 20, asked: 10, done: 12 };

export function normalizeInvites(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const str = (v, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const int = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const p = src.pending && typeof src.pending === 'object' ? src.pending : null;
  const pending = p && str(p.key) && str(p.personId) && str(p.hookId) && isDay(p.day) ? {
    key: str(p.key), personId: str(p.personId), eventName: str(p.eventName, 80), day: p.day,
    when: str(p.when, 40), hookId: str(p.hookId, 24), tries: int(p.tries), played: p.played === true,
    mark: p.played === true ? str(p.mark, 40) : '',
  } : null;
  const decided = {};
  for (const [k, v] of Object.entries(src.decided && typeof src.decided === 'object' ? src.decided : {}).slice(-INVITES_MAX.decided)) {
    if (str(k) && ['yes', 'no', 'skip'].includes(v)) decided[k] = v;
  }
  const cool = {};
  for (const [k, v] of Object.entries(src.cool && typeof src.cool === 'object' ? src.cool : {}).slice(-INVITES_MAX.cool)) {
    if (str(k) && Number.isInteger(v) && v >= 0) cool[k] = v;
  }
  const going = (Array.isArray(src.going) ? src.going : []).map((g) => (g && typeof g === 'object' && str(g.key) && str(g.withId) && isDay(g.day)
    ? { key: str(g.key), eventName: str(g.eventName, 80), day: g.day, withId: str(g.withId), ...(typeof g.came === 'boolean' || g.came === null ? { came: g.came } : {}) } : null)).filter(Boolean).slice(-INVITES_MAX.going);
  const asked = (Array.isArray(src.asked) ? src.asked : []).map((a) => (a && typeof a === 'object' && str(a.key) && str(a.withId) && isDay(a.day) && isDay(a.from) && isDay(a.to)
    ? { key: str(a.key), withId: str(a.withId), eventName: str(a.eventName, 80), day: a.day, from: a.from, to: a.to, mark: str(a.mark, 40) } : null)).filter(Boolean).slice(-INVITES_MAX.asked);
  const done = (Array.isArray(src.done) ? src.done : []).map((d) => (d && typeof d === 'object' && str(d.mark, 40) && ['go', 'decline', 'came', 'missed'].includes(d.kind) && str(d.key)
    ? { mark: str(d.mark, 40), kind: d.kind, key: str(d.key), eventName: str(d.eventName, 80), withId: str(d.withId) } : null)).filter(Boolean).slice(-INVITES_MAX.done);
  return { n: int(src.n), last: Number.isInteger(src.last) && src.last >= 0 ? src.last : null, pending, decided, cool, going, asked, done };
}

export const FEATS_MAX = { items: 160, moments: 40, why: 120, name: 60, desc: 200 };

export function normalizeFeats(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const str = (v, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const int = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  const seen = new Set();
  const items = [];
  for (const it of Array.isArray(src.items) ? src.items : []) {
    if (!it || typeof it !== 'object' || !str(it.id, 60) || seen.has(str(it.id, 60))) continue;
    const m = it.moment && typeof it.moment === 'object' ? it.moment : null;
    const moment = m && str(m.name, FEATS_MAX.name) && str(m.emoji, 16) && str(m.desc, FEATS_MAX.desc) && ['common', 'rare', 'epic'].includes(m.rarity)
      ? { emoji: str(m.emoji, 16), name: str(m.name, FEATS_MAX.name), desc: str(m.desc, FEATS_MAX.desc), rarity: m.rarity } : null;
    if (m && !moment) continue;
    seen.add(str(it.id, 60));
    items.push({ id: str(it.id, 60), src: str(it.src, 40), when: isDay(it.when) ? it.when : '', why: str(it.why, FEATS_MAX.why), n: int(it.n), ...(moment ? { moment } : {}) });
  }
  const moments = items.filter((i) => i.moment).slice(-FEATS_MAX.moments);
  const keep = new Set(moments);
  return { items: items.filter((i) => !i.moment || keep.has(i)).slice(-FEATS_MAX.items), n: int(src.n) };
}

export const BULLYING_MAX = { acts: 30, moves: 12, taboo: 240, text: 300, crew: 2, heat: 4, skip: 240 };

export const BULLY_MOVES = ['fightback', 'complain', 'ally', 'ignore', 'revenge', 'peace', 'backoff'];

export const PICK_SOURCES = ['scene', 'lore', 'canon', 'guess', 'npc'];
export const PICK_STATES = ['found', 'none', 'denied', 'failed'];

export function normalizePick(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const str = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const list = (v, n, max) => (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, n);
  const id = str(raw.id, 40);
  const motive = str(raw.motive, 200);
  if (!id || !motive) return null;
  return {
    id, source: PICK_SOURCES.includes(raw.source) ? raw.source : 'guess', motive, access: str(raw.access, 160),
    methods: list(raw.methods, 4, 120), limits: list(raw.limits, 3, 100), ties: str(raw.ties, 200),
    confidence: ['high', 'mid', 'low'].includes(raw.confidence) ? raw.confidence : 'mid',
    allies: list(raw.allies, 4, 40),
    responseStyle: str(raw.responseStyle, 160),
    ...(raw.fresh === true ? { fresh: true } : {}),
  };
}

export function normalizeBullying(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const str = (v, max = 120) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const int = (v, max = Infinity) => (Number.isInteger(v) && v >= 0 ? Math.min(v, max) : 0);
  const day = (v) => (isDay(v) ? v : '');
  const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map((x) => str(x, 40)).filter(Boolean))].slice(0, BULLYING_MAX.crew);
  const p = src.pending && typeof src.pending === 'object' ? src.pending : null;
  const pending = p && str(p.by, 40) && str(p.text, BULLYING_MAX.text) && str(p.hookId, 24) && isDay(p.day) ? {
    id: str(p.id, 24) || str(p.hookId, 24), hookId: str(p.hookId, 24), day: p.day, level: int(p.level, BULLYING_MAX.heat),
    by: str(p.by, 40), crew: ids(p.crew), text: str(p.text, BULLYING_MAX.text), trace: str(p.trace, 80), kind: str(p.kind, 8),
    tries: int(p.tries), hidden: p.hidden === true, afterPeace: p.afterPeace === true, ...(p.rev === true ? { rev: true } : {}),
    ...(p.att === true ? { att: true } : {}), ...(str(p.act, 200) ? { act: str(p.act, 200) } : {}),
  } : null;
  const acts = (Array.isArray(src.acts) ? src.acts : []).map((a) => (a && typeof a === 'object' && str(a.by, 40) && str(a.text, BULLYING_MAX.text) && isDay(a.day)
    ? { id: str(a.id, 24), day: a.day, level: int(a.level, BULLYING_MAX.heat), by: str(a.by, 40), text: str(a.text, BULLYING_MAX.text), trace: str(a.trace, 80), kind: str(a.kind, 8), ...(a.assumed === true ? { assumed: true } : {}) } : null)).filter(Boolean).slice(-BULLYING_MAX.acts);
  const moves = (Array.isArray(src.moves) ? src.moves : []).map((m) => (m && typeof m === 'object' && BULLY_MOVES.includes(m.kind) && isDay(m.day)
    ? { day: m.day, kind: m.kind, with: str(m.with, 40) } : null)).filter(Boolean).slice(-BULLYING_MAX.moves);
  const heat = Number.isInteger(src.heat) && src.heat >= 0 ? Math.min(src.heat, BULLYING_MAX.heat) : 1;
  const e = src.ep && typeof src.ep === 'object' ? src.ep : null;
  const ep = e && isDay(e.day) ? { day: e.day, tried: e.tried === true, max: int(e.max, BULLYING_MAX.heat), backed: e.backed === true } : null;
  const c = src.change && typeof src.change === 'object' ? src.change : null;
  const change = c && isDay(c.day) && ['press', 'backoff', 'truce'].includes(c.why)
    ? { day: c.day, from: int(c.from, BULLYING_MAX.heat), to: int(c.to, BULLYING_MAX.heat), why: c.why } : null;
  return {
    on: src.on !== false,
    taboo: str(src.taboo, BULLYING_MAX.taboo),
    mode: src.mode === 'self' ? 'self' : 'auto',
    npcOk: src.npcOk !== false,
    skip: str(src.skip, BULLYING_MAX.skip),
    pick: normalizePick(src.pick),
    pickState: PICK_STATES.includes(src.pickState) ? src.pickState : '',
    pickKey: str(src.pickKey, 80),
    pickDay: day(src.pickDay),
    past: [...new Set((Array.isArray(src.past) ? src.past : []).map((x) => str(x, 40)).filter(Boolean))].slice(-6),
    lead: str(src.lead, 40),
    crew: ids(src.crew),
    manual: src.manual === true,
    heat,
    peak: Math.max(int(src.peak, BULLYING_MAX.heat), heat),
    press: int(src.press, 1),
    back: int(src.back, 1),
    ep,
    change,
    rev: src.rev === true,
    n: int(src.n),
    last: day(src.last),
    asked: day(src.asked),
    hidden: day(src.hidden),
    truce: day(src.truce),
    afterPeace: src.afterPeace === true,
    fought: day(src.fought),
    ally: str(src.ally, 40),
    acts,
    moves,
    pending,
  };
}

export const LORE_SKIPPED_MAX = 400;
export function normalizeLoreSkipped(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    const n = typeof r === 'string' ? normName(r) : '';
    if (n && !out.includes(n)) out.push(n);
  }
  return out.slice(-LORE_SKIPPED_MAX);
}

export { PORTRAIT_MAX, isPortrait, normalizePortrait } from './portraits.mjs';

export function normalizeTeacher(raw, preset) {
  const start = preset && preset.relations ? preset.relations.start : 0;
  return {
    id: String(raw.id || '').trim(),
    name: String(raw.name || raw.id || '').trim(),
    traits: Array.isArray(raw.traits) ? raw.traits.map(String) : [],
    relation: numberOr(raw.relation, numberOr(start, 0)),
    ...(normalizePortrait(raw.portrait) ? { portrait: normalizePortrait(raw.portrait) } : {}),
    ...teacherDetails(raw),
    ...(normalizeLooks(raw.looks) ? { looks: normalizeLooks(raw.looks) } : {}),
    ...(normalizeNote(raw.note) ? { note: normalizeNote(raw.note) } : {}),
  };
}

export function validateState(state, preset) {
  const errors = [];
  const bad = (m) => errors.push(m);
  const sbj = subjectWord(preset);

  if (!state || typeof state !== 'object') return { ok: false, errors: ['состояние не объект'] };

  const subjectList = Array.isArray(state.subjects) ? state.subjects : [];
  const teacherList = Array.isArray(state.teachers) ? state.teachers : [];
  if (state.schemaVersion !== SCHEMA_VERSION) {
    bad(`версия схемы ${state.schemaVersion}, ожидается ${SCHEMA_VERSION}`);
  }
  if (!state.presetId) bad('нет presetId');
  if (state.canonVocab !== undefined && (!state.canonVocab || typeof state.canonVocab !== 'object' || Array.isArray(state.canonVocab))) {
    bad('canonVocab не объект');
  }
  if (state.canonLayer !== undefined && (!state.canonLayer || typeof state.canonLayer !== 'object' || Array.isArray(state.canonLayer))) {
    bad('canonLayer не объект');
  }

  const c = state.calendar;
  if (!c || typeof c !== 'object') {
    bad('нет календаря');
  } else {
    if (!isDay(c.day)) bad(`календарь: день «${c.day}» не в форме ГГГГ-ММ-ДД`);
    if (c.time !== null && !isTime(c.time)) bad(`календарь: время «${c.time}» не в форме ЧЧ:ММ`);
    if (c.precision !== 'date' && c.precision !== 'datetime') bad(`календарь: точность «${c.precision}»`);
    if (c.precision === 'datetime' && c.time === null) bad('календарь: точность datetime без часов');
    if (!isDay(c.termStart)) bad('календарь: нет начала семестра');
  }

  if (!Array.isArray(state.subjects)) {
    bad('subjects не массив');
  } else {
    const seen = new Set();
    for (const s of state.subjects) {
      if (!s.id) bad(`${sbj} без id`);
      else if (seen.has(s.id)) bad(`${sbj} ${s.id} повторяется`);
      seen.add(s.id);
      if (s.teacherId && !teacherList.some((t) => t.id === s.teacherId)) {
        bad(`${sbj} ${s.id} ссылается на неизвестного преподавателя ${s.teacherId}`);
      }
      for (const key of ['building', 'room']) {
        if (s[key] === undefined || s[key] === null) continue;
        if (typeof s[key] !== 'string' || !s[key].trim() || s[key].length > PLACE_MAX) {
          bad(`${sbj} ${s.id}: ${key === 'building' ? 'корпус' : 'аудитория'} — не строка до ${PLACE_MAX} символов`);
        }
      }
    }
    const max = preset && preset.limits && preset.limits.maxSubjects;
    if (max && state.subjects.length > max) bad(`${subjectWord(preset, 'genMany')} ${state.subjects.length}, потолок ${max}`);
  }

  if (!Array.isArray(state.teachers)) {
    bad('teachers не массив');
  } else {
    const seen = new Set();
    for (const t of state.teachers) {
      if (!t.id) bad('преподаватель без id');
      else if (seen.has(t.id)) bad(`преподаватель ${t.id} повторяется`);
      seen.add(t.id);
      if (t.portrait !== undefined && t.portrait !== null && !isPortrait(t.portrait)) {
        bad(`преподаватель ${t.id}: портрет — не путь от корня таверны и не ссылка http(s)`);
      }
      for (const [key, max] of Object.entries(TEACHER_TEXT_MAX)) {
        if (t[key] === undefined || t[key] === null) continue;
        if (typeof t[key] !== 'string' || !t[key].trim() || t[key].length > max) {
          bad(`преподаватель ${t.id}: поле ${key} — не строка до ${max} символов`);
        }
      }
      if (!looksOk(t.looks)) bad(`преподаватель ${t.id}: описание внешности — не строка до потолка`);
    }
  }

  if (!state.schedule || typeof state.schedule !== 'object') {
    bad('нет расписания');
  } else {
    for (const [dow, list] of Object.entries(state.schedule)) {
      if (!/^[1-7]$/.test(dow)) bad(`расписание: день недели «${dow}» вне 1–7`);
      if (!Array.isArray(list)) {
        bad(`расписание: день ${dow} не массив`);
        continue;
      }
      for (const id of list) {
        if (id !== null && !subjectList.some((s) => s.id === id)) {
          bad(`расписание: день ${dow} — нет в списке ${subjectWord(preset, 'genMany')}: ${id}`);
        }
      }
    }
  }

  if (!state.attendance || !Array.isArray(state.attendance.records)) bad('нет посещаемости');
  if (!state.reputation || typeof state.reputation.value !== 'number') bad('нет репутации');
  if (!state.exams || !Array.isArray(state.exams.items)) {
    bad('нет сессии');
  } else if (state.exams.term !== null && state.exams.term !== undefined
      && !Number.isFinite(state.exams.term)) {
    bad(`сессия: номер периода «${state.exams.term}» не число`);
  } else {
    for (const item of state.exams.items) {
      if (item && item.rolls !== undefined && !Array.isArray(item.rolls)) {
        bad(`сессия: история бросков события ${item.id} не список`);
      }
      if (item && item.announced === false && !isDay(item.announceOn)) {
        bad(`сессия: итог события ${item.id} ждёт объявления без даты`);
      }
    }
  }
  if (!Array.isArray(state.journal)) bad('нет журнала');
  if (!Array.isArray(state.pending)) bad('нет очереди одноразовых инжектов');

  if (state.events !== undefined) {
    if (!Array.isArray(state.events)) bad('свои события — не список');
    else {
      for (const e of state.events) {
        if (!e || typeof e !== 'object' || typeof e.name !== 'string' || !e.name.trim()) bad('своё событие без названия');
        else if (!isDay(e.from)) bad(`событие «${e.name}»: день «${e.from}» не в форме ГГГГ-ММ-ДД`);
        else if (e.to !== undefined && e.to !== null && (!isDay(e.to) || e.to < e.from)) bad(`событие «${e.name}»: конец раньше начала`);
        else if (e.off !== undefined && typeof e.off !== 'boolean') bad(`событие «${e.name}»: «занятий нет» — не да/нет`);
        else if (e.open !== undefined && typeof e.open !== 'boolean') bad(`событие «${e.name}»: «до отмены» — не да/нет`);
        else if (e.pause !== undefined && typeof e.pause !== 'boolean') bad(`событие «${e.name}»: «приостановка» — не да/нет`);
      }
    }
  }
  if (state.holidayHooks !== undefined && !Array.isArray(state.holidayHooks)) bad('поводы праздников — не список');
  if (state.invites !== undefined && (!state.invites || typeof state.invites !== 'object' || Array.isArray(state.invites))) bad('приглашения — не объект');
  if (state.feats !== undefined && (!state.feats || typeof state.feats !== 'object' || Array.isArray(state.feats))) bad('ачивки — не объект');
  if (state.bullying !== undefined && (!state.bullying || typeof state.bullying !== 'object' || Array.isArray(state.bullying))) bad('травля — не объект');

  for (const m of classmateErrors(state)) bad(m);

  return { ok: errors.length === 0, errors };
}

export function migrate(state, preset) {
  if (!state || typeof state !== 'object') return createState(preset);
  let out = { ...state };

  if (numberOr(out.schemaVersion, 0) < 2) out = examTermsV2(out);

  out.schemaVersion = SCHEMA_VERSION;
  out.presetId = out.presetId || preset.id;
  out.lang = out.lang || preset.lang || 'ru';
  out.started = Boolean(out.started);
  out.survey = surveyWith(out.survey);
  out.canonVocab = cleanCanonVocab(out.canonVocab);
  out.canonLayer = cleanCanonLayer(out.canonLayer);
  out.calendar = { ...createState(preset).calendar, ...(out.calendar || {}) };
  out.subjects = Array.isArray(out.subjects) ? out.subjects.map(normalizeSubject) : [];
  out.teachers = Array.isArray(out.teachers) ? out.teachers.map((t) => normalizeTeacher(t, preset)) : [];
  out.schedule = out.schedule && typeof out.schedule === 'object' ? out.schedule : {};
  out.attendance = { records: Array.isArray(out.attendance && out.attendance.records) ? out.attendance.records : [] };
  out.reputation = {
    value: numberOr(out.reputation && out.reputation.value, numberOr(preset.reputation && preset.reputation.start, 50)),
    warned: Boolean(out.reputation && out.reputation.warned),
    expelled: Boolean(out.reputation && out.reputation.expelled),
    ...(out.reputation && out.reputation.fame && isDay(out.reputation.fame.day)
      ? { fame: { day: out.reputation.fame.day, g: numberOr(out.reputation.fame.g, 0), e: numberOr(out.reputation.fame.e, 0) } }
      : {}),
  };
  out.exams = {
    active: Boolean(out.exams && out.exams.active),
    term: Number.isFinite(out.exams && out.exams.term) ? out.exams.term : null,
    items: Array.isArray(out.exams && out.exams.items) ? out.exams.items : [],
  };
  out.journal = Array.isArray(out.journal) ? out.journal : [];
  out.pending = Array.isArray(out.pending) ? out.pending : [];
  out.classmates = normalizeClassmates(out.classmates, preset, { taken: out.teachers.map((t) => t.id) });
  out.classmateCandidates = normalizeCandidates(out.classmateCandidates, preset);
  if (!String(out.survey.canon || '').trim()) {
    const own = (p) => { if (p.canon !== true) return p; const { canon, ...rest } = p; return rest; };
    out.teachers = out.teachers.map(own);
    out.classmates = out.classmates.map(own);
  }
  if (out.loreFound !== undefined) out.loreFound = normalizeLoreFound(out.loreFound);
  if (out.loreSkipped !== undefined) out.loreSkipped = normalizeLoreSkipped(out.loreSkipped);
  if (out.invites !== undefined) out.invites = normalizeInvites(out.invites);
  if (out.bullying !== undefined) out.bullying = normalizeBullying(out.bullying);
  const pick = out.bullying && out.bullying.pick;
  if (pick && pick.motive) {
    out.classmates = out.classmates.map((c) => {
      const head = String(c.desire || '').replace(/…$/u, '');
      if (c.id !== pick.id || !head || head === pick.motive || !pick.motive.startsWith(head)) return c;
      return { ...c, desire: cutWords(pick.motive, CLASSMATE_TEXT_MAX.desire) };
    });
  }
  if (out.feats !== undefined) out.feats = normalizeFeats(out.feats);
  return out;
}

function examTermsV2(state) {
  const out = { ...state };
  const exams = out.exams && typeof out.exams === 'object' ? out.exams : {};
  const items = Array.isArray(exams.items) ? exams.items : [];

  const renamed = new Map();
  const migrated = items.map((raw) => {
    const item = { ...raw };
    if (Number.isFinite(item.term)) return item;
    item.term = 0;
    const old = String(item.id == null ? '' : item.id);
    if (old) {
      item.id = `0:${old}`;
      renamed.set(old, item.id);
    }
    return item;
  });

  out.exams = {
    ...exams,
    items: migrated,
    term: Number.isFinite(exams.term) ? exams.term : (migrated.length ? 0 : null),
  };

  out.journal = (Array.isArray(out.journal) ? out.journal : []).map((entry) => {
    const id = entry && entry.data ? entry.data.examId : null;
    if (id == null || !renamed.has(String(id))) return entry;
    return { ...entry, data: { ...entry.data, examId: renamed.get(String(id)) } };
  });

  out.pending = (Array.isArray(out.pending) ? out.pending : []).map((inject) => {
    const m = /^exam:(.+):(\d+)$/.exec(String((inject && inject.id) || ''));
    if (!m || !renamed.has(m[1])) return inject;
    return { ...inject, id: `exam:${renamed.get(m[1])}:${m[2]}` };
  });

  out.schemaVersion = 2;
  return out;
}

export function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

export const findSubject = (state, id) => (state.subjects || []).find((s) => s.id === id) || null;
export const findTeacher = (state, id) => (state.teachers || []).find((t) => t.id === id) || null;

export function teacherOfSubject(state, subjectId) {
  const s = findSubject(state, subjectId);
  return s && s.teacherId ? findTeacher(state, s.teacherId) : null;
}

export function pushJournal(state, entry, preset) {
  const cap = (preset && preset.limits && preset.limits.journalSize) || 200;
  state.journal.push({ day: (state.calendar && state.calendar.day) || '', ...entry });
  if (state.journal.length > cap) state.journal.splice(0, state.journal.length - cap);
  return state;
}

export function pushPending(state, inject) {
  if (!state.pending.some((p) => p.id === inject.id)) state.pending.push(inject);
  return state;
}

export function takePending(state) {
  const out = state.pending;
  state.pending = [];
  return out;
}

export function labelFor(labels, value) {
  if (!Array.isArray(labels) || !labels.length) return '';
  for (const l of labels) if (value <= l.upTo) return l.label;
  return labels[labels.length - 1].label;
}

export function joinSentences(parts) {
  const seen = [];
  for (const p of (parts || [])) {
    const s = String(p == null ? '' : p).trim();
    if (s && !seen.includes(s)) seen.push(s);
  }
  return seen
    .map((s, i) => (i === 0 ? s : s.charAt(0).toLocaleUpperCase('ru') + s.slice(1)))
    .map((s) => (/[.!?…:]$/.test(s) ? s : `${s}.`))
    .join(' ');
}

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

export const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const isTime = (v) => typeof v === 'string' && /^\d{2}:\d{2}$/.test(v);

function numberOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

import { cloneState } from './state.mjs';
import * as course from './classmates.mjs';
import { HEROINE, isCardParty, cardPartyName, isWhoParty, whoPartyName } from './parse-marker.mjs';
import { normName, stopHit } from './stop-names.mjs';
import { gradeInfo } from './exams.mjs';
import { genderOfName, firstWord, heroGender, heroWords } from './gender.mjs';
import { normalizeLooks } from './portraits.mjs';
import { placeFeat, revertFeat, revertFeatSource } from './feats.mjs';

export { genderOfName };
import {
  ensureFeed, addFeedItem, removeFeedItem, markSeen, restoreSeen,
  openDeal, closeDeal, revertDeal, putReactions, unmarkPlayed, hash, postByRef,
} from './feed.mjs';

export const SCENE_KINDS = ['met', 'clash', 'act', 'rumor', 'new', 'deal', 'feat', 'looks'];

export function peopleOf(state) {
  return [
    ...((state && state.teachers) || []).map((t) => ({ ...t, teacher: true })),
    ...((state && state.classmates) || []),
  ].filter((p) => p && p.id);
}

export function personWord(id, people, heroine = '', gender = 'f') {
  if (id === HEROINE) return heroine || heroWords(gender).hero;
  if (isCardParty(id)) return cardPartyName(id);
  if (isWhoParty(id)) return whoPartyName(id);
  const p = (people || []).find((x) => x && x.id === id);
  return (p && (p.name || p.id)) || String(id || 'кто-то');
}

export const GONE_PERSON = { nom: 'тот, кого уже нет в списке', dat: 'тому, кого уже нет в списке' };

const ACT_ROLE = { близость: 'с кем', конфликт: 'против', помощь: 'кому', отказ: 'кому', достижение: 'против', провал: 'при ком', уход: 'от кого', появление: 'к кому' };
const actRole = (ev, people) => {
  const teacher = (people || []).some((p) => p && p.id === ev.b && p.teacher);
  return teacher && (ev.type === 'достижение' || ev.type === 'провал') ? 'у кого' : ACT_ROLE[ev.type] || 'с кем';
};
const actWith = (ev, who, people) => (ev.b ? ` (${actRole(ev, people)}: ${who(ev.b)})` : '');

export function sceneText(ev, people, heroine = '', gender = 'f') {
  const who = (id) => String(personWord(id, people, heroine, gender)).trim();
  if (!ev) return '';
  if (ev.kind === 'met') return `в сцене: ${who(ev.personId)}`;
  if (ev.kind === 'clash') return `стычка: ${who(ev.a)} и ${who(ev.b)}${ev.reason ? ` — ${ev.reason}` : ''}`;
  if (ev.kind === 'act') return `${who(ev.a)}: ${ev.what}${actWith(ev, who, people)}`;
  if (ev.kind === 'rumor') return `слух: ${who(ev.about)} — ${ev.text}`;
  if (ev.kind === 'new') return `новое лицо: ${ev.name}`;
  if (ev.kind === 'looks') return `внешность: ${ev.personId ? who(ev.personId) : ev.name} — ${ev.text}`;
  if (ev.kind === 'deal') return dealText(ev, people, heroine, gender);
  if (ev.kind === 'feat') return `ачивка: ${ev.moment ? ev.moment.name : ev.id}${ev.why ? ` — ${ev.why}` : ''}`;
  return '';
}

const PATRONYMIC = /^[А-ЯЁ][а-яё]+(?:овна|евна|ична|инична|ович|евич|ич)$/u;

const SURNAME = /^[А-ЯЁ][а-яё-]+(?:ова|ева|ёва|ина|ына|ов|ев|ёв|ин|ын|ский|ская|цкий|цкая|ской|ых|их|ко|ук|юк|ец)$/u;

export function shortName(name, { teacher = false } = {}) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words.join(' ');
  const pat = words.findIndex((w, i) => i > 0 && PATRONYMIC.test(w));
  const rest = pat >= 0 ? words.filter((_, i) => i !== pat) : words.slice();
  let surname = '';
  if (pat === 1 && words.length >= 3) surname = words[2];
  else if (pat === 2) surname = words[0];
  else if (rest.length === 2) surname = rest.find((w) => SURNAME.test(w)) || '';
  if (teacher) return surname || words.join(' ');
  if (rest.length === 2) return rest.join(' ');
  return words.join(' ');
}

const REASON_LEAD = /^(?:из-за|из|за|по|в|во|на|о|об|обо|при|после|у|с|со|насчёт|насчет|ради)\s/iu;

export function sceneAbout(ev, people, heroine = '', gender = 'f') {
  const who = (id) => String(personWord(id, people, heroine, gender)).trim();
  if (!ev) return '';
  if (ev.kind === 'clash') {
    const reason = String(ev.reason || '').trim();
    const why = !reason ? '' : REASON_LEAD.test(reason) ? ` ${reason}` : `: ${reason}`;
    return `${who(ev.a)} и ${who(ev.b)} — стычка${why}`;
  }
  if (ev.kind === 'act') return `${who(ev.a)} — ${ev.what}${ev.b ? ` · ${who(ev.b)}` : ''}`;
  if (ev.kind === 'met') {
    const name = who(ev.personId);
    const g = ev.personId === HEROINE ? gender : genderOfName(name);
    return g === 'f' ? `${name} была в сцене` : g === 'm' ? `${name} был в сцене` : `в сцене — ${name}`;
  }
  if (ev.kind === 'rumor') return `${who(ev.about)} — ${ev.text} (слух)`;
  if (ev.kind === 'deal') return dealText(ev, people, heroine, gender);
  return sceneText(ev, people, heroine, gender);
}

export function sceneGist(ev, people, heroine = '', gender = 'f') {
  const who = (id) => String(personWord(id, people, heroine, gender)).trim();
  if (!ev) return '';
  if (ev.kind === 'rumor') return `${who(ev.about)} ${ev.text}`;
  if (ev.kind === 'clash') return `${who(ev.a)} и ${who(ev.b)} поссорились${ev.reason ? ` (${ev.reason})` : ''}`;
  if (ev.kind === 'act') return `${who(ev.a)} ${ev.what}${actWith(ev, who, people)}`;
  return '';
}

const PENALTY_WORDS = /отработк|отрабат|наказани|наказан|взыскани|штраф|нарядов?(?![а-яё])|работ[аыуе](?![а-яё])|явк[аиу](?![а-яё])|явитьс|явиться|уборк|убор(?:ка|ки|ку)(?![а-яё])|дежурств|дежурит/i;

const DATIVE_SPECIAL = { лев: 'Льву', павел: 'Павлу', петр: 'Петру' };

export function dativeName(name) {
  const w = firstWord(name);
  if (!w) return null;
  if (/^[A-Za-z][A-Za-z'-]*$/.test(w)) return w;
  if (!/^[А-ЯЁ][а-яё-]*$/.test(w)) return null;
  const low = w.toLowerCase().replace(/ё/g, 'е');
  if (DATIVE_SPECIAL[low]) return DATIVE_SPECIAL[low];
  if (/[оеиуюэы]$/.test(low)) return w;
  if (low.length > 4 && /(?:ова|ева)$/.test(low)) return `${w.slice(0, -1)}ой`;
  if (/(?:ская|цкая)$/.test(low)) return `${w.slice(0, -2)}ой`;
  if (/ия$/.test(low)) return `${w.slice(0, -1)}и`;
  if (/[ая]$/.test(low)) return `${w.slice(0, -1)}е`;
  if (/(?:ский|цкий)$/.test(low)) return `${w.slice(0, -2)}ому`;
  if (/[ий]$/.test(low) && /[еаи]й$/.test(low)) return `${w.slice(0, -1)}ю`;
  if (/ий$/.test(low)) return `${w.slice(0, -1)}ю`;
  if (/ь$/.test(low)) return null;
  if (/[бвгджзклмнпрстфхцчшщ]$/.test(low)) return `${w}у`;
  return null;
}

export function dealText(ev, people, heroine = '', gender = 'f') {
  if (!ev) return '';
  if (!ev.closed && ev.b === HEROINE && ev.a !== HEROINE && PENALTY_WORDS.test(String(ev.what || ''))) {
    return dealText({ ...ev, a: ev.b, b: ev.a }, people, heroine, gender);
  }
  const known = (id) => id === HEROINE || isCardParty(id) || (people || []).some((x) => x && x.id === id);
  const nom = (id) => (known(id) ? personWord(id, people, heroine, gender) : GONE_PERSON.nom);
  const a = nom(ev.a);
  if (!ev.b) {
    if (ev.closed) return `закрыто: ${a} — ${ev.what}`;
    const alone = `${a} ${ev.what}`;
    return alone[0].toUpperCase() + alone.slice(1);
  }
  const b = nom(ev.b);
  if (ev.closed) return `закрыто: ${a} и ${b} — ${ev.what}`;
  const dat = known(ev.b) ? (ev.b === HEROINE && !heroine ? heroWords(gender).heroDat : dativeName(b)) : GONE_PERSON.dat;
  const g = known(ev.a) ? (ev.a === HEROINE ? gender : genderOfName(a)) : 'm';
  if (!dat) return `${a} и ${b}: ${ev.what}`;
  const verb = g === 'f' ? 'должна' : g === 'm' ? 'должен' : 'обещает';
  const line = `${known(ev.a) ? a : `${a},`} ${verb} ${dat}: ${ev.what}`;
  return line[0].toUpperCase() + line.slice(1);
}

function aboutOf(ev) {
  if (!ev) return [];
  if (ev.kind === 'clash' || ev.kind === 'deal') return [ev.a, ev.b];
  if (ev.kind === 'act') return [ev.a, ev.b].filter((id) => id && !isWhoParty(id));
  if (ev.kind === 'rumor') return [ev.about];
  if (ev.kind === 'met') return [ev.personId];
  if (ev.kind === 'rel') return [ev.teacherId, HEROINE];
  return [HEROINE];
}

function factId(src, token) {
  return `${src}@${hash(token)}`;
}

export function applySceneEvent(state, ev, preset, opts = {}) {
  if (!ev || !SCENE_KINDS.includes(ev.kind)) return { state, receipt: null };
  const next = cloneState(state);
  const receipt = placeEvent(next, ev, preset, opts);
  return { state: next, receipt };
}

export function applySceneEvents(state, items, preset, opts = {}) {
  const list = (items || []).filter((x) => x && x.ev && SCENE_KINDS.includes(x.ev.kind))
    .sort((a, b) => (a.ev.kind === 'looks') - (b.ev.kind === 'looks'));
  if (!list.length) return state;
  const next = cloneState(state);
  for (const { ev, token } of list) placeEvent(next, ev, preset, { ...opts, token });
  return next;
}

export function actLoud(ev, loud = null) {
  const base = ev.reach === 'многие' ? 2 : 1;
  return base === 2 && (ev.type === 'близость' || ev.type === 'конфликт') && loud === 3 ? 3 : base;
}

function placeEvent(next, ev, preset, opts) {
  const src = opts.src || '';
  const token = opts.token || '';
  const at = { day: opts.day || (next.calendar && next.calendar.day) || '', time: opts.time || '' };

  if (ev.kind === 'met') {
    const prev = markSeen(next, ev.personId, at);
    return { kind: 'met', personId: ev.personId, prev };
  }

  if (ev.kind === 'clash' || ev.kind === 'rumor' || ev.kind === 'act') {
    const about = aboutOf(ev);
    const marked = Boolean(opts.privateRefs && opts.privateRefs.has(hash(token)));
    const act = ev.kind === 'act' ? ev : ev.kind === 'clash' ? { type: 'конфликт', access: 'на людях', reach: 'несколько' } : null;
    const overheard = act && act.access === 'подслушали';
    const id = addFeedItem(next, {
      id: factId(src, token),
      src,
      at,
      factRef: token,
      kind: 'fact',
      who: (ev.kind === 'clash' || ev.kind === 'act') && !isCardParty(ev.a) && !isWhoParty(ev.a) ? ev.a : '',
      chan: 'chat',
      text: sceneText(ev, peopleOf(next), opts.heroine, heroGender(next, opts.heroine)),
      gist: sceneGist(ev, peopleOf(next), opts.heroine, heroGender(next, opts.heroine)),
      rumor: ev.kind === 'rumor' || overheard === true,
      truth: null,
      about,
      heroine: about.includes(HEROINE),
      private: !overheard && Boolean(marked || (act && act.access === 'наедине')),
      ...(ev.kind === 'act' ? { loud: actLoud(ev, opts.loud ?? null) } : {}),
      ...(act ? { act: { kind: act.type, access: act.access, reach: act.reach, say: act.say || '' } } : {}),
    });
    const cands = ev.kind === 'act' && typeof course.addCandidate === 'function'
      ? [ev.a, ev.b].filter(isWhoParty).map((p) => {
        const had = new Set((next.classmateCandidates || []).map((c) => c && c.id));
        const cid = course.addCandidate(next, { name: whoPartyName(p), source: 'scene' }, { stop: opts.stop, preset });
        return cid && !had.has(cid) ? cid : null;
      }).filter(Boolean)
      : [];
    return id ? { kind: 'feed', id, ...(cands.length ? { cands } : {}) } : null;
  }

  if (ev.kind === 'new') {
    if (typeof course.addCandidate !== 'function') return null;
    const had = new Set((next.classmateCandidates || []).map((c) => c && c.id));
    const id = course.addCandidate(next, { name: ev.name, source: 'scene', ...(ev.role ? { role: ev.role } : {}), ...(ev.canon ? { canon: true } : {}) }, { stop: opts.stop, preset });
    if (!id) return null;
    return { kind: 'candidate', id, created: !had.has(id) };
  }

  if (ev.kind === 'feat') return placeFeat(next, ev, { src, day: at.day });

  if (ev.kind === 'looks') {
    const person = looksTarget(next, ev);
    const looks = normalizeLooks(ev.text);
    if (!person || person.looks || !looks) return null;
    person.looks = looks;
    return { kind: 'looks', id: person.id, text: looks };
  }

  if (ev.kind === 'deal') {
    const fields = { a: ev.a, b: ev.b, what: ev.what, src, day: at.day };
    const r = ev.closed ? closeDeal(next, fields) : openDeal(next, fields);
    if (!r.id) return null;
    return { kind: 'deal', ...r };
  }
  return null;
}

export const NOTABLE_KINDS = ['attendance', 'grade', 'fame'];

export function notableFact(ev, state, preset, opts = {}) {
  if (!ev || !NOTABLE_KINDS.includes(ev.kind)) return null;
  const H = String(opts.heroine || '').trim() || heroWords(heroGender(state)).hero;
  const loud = Number.isInteger(opts.loud) ? opts.loud : null;
  if (ev.kind === 'fame') {
    const why = String(ev.why || '').trim();
    return why ? { text: why, gist: `${H} — ${ev.sign < 0 ? 'провал' : 'триумф'}: ${why}`, loud: Math.max(2, Math.min(3, loud ?? 2)) } : null;
  }
  const subject = (((state && state.subjects) || []).find((s) => s && s.id === ev.subjectId) || {}).name || ev.subjectId || '';
  const tail = subject ? `: ${subject}` : '';
  let gist = '';
  let level = loud === null ? 1 : loud;
  if (ev.kind === 'attendance') {
    if (ev.status === 'late') gist = `опоздание${tail}`;
    else {
      gist = `прогул${tail}`;
      level = Math.max(level, 2);
    }
  } else {
    const info = gradeInfo(preset, ev.value);
    const points = (((preset && preset.grades && preset.grades.values) || []).map((v) => v && v.points)).filter((p) => typeof p === 'number');
    const fail = Boolean(info) && info.pass === false;
    const triumph = Boolean(info) && !fail && typeof info.points === 'number' && points.length > 0 && info.points >= Math.max(...points);
    const mark = String(ev.value);
    if (fail) gist = `провал${tail} (${mark})`;
    else if (triumph) gist = `триумф${tail} (${mark})`;
    else if (loud !== null && loud >= 2) gist = `оценка ${mark}${tail}`;
    if (fail || triumph) level = Math.max(level, 2);
  }
  return gist ? { text: gist, gist: `${H} — ${gist}`, loud: Math.max(0, Math.min(3, level)) } : null;
}

export function applyLoudScene(state, items, preset, opts = {}) {
  const loud = Number.isInteger(opts.loud) ? opts.loud : null;
  if (loud === null || loud < 2) return state;
  const list = items || [];
  if (list.some((x) => x && x.ev && (['clash', 'act', 'rumor', 'deal', 'new'].includes(x.ev.kind) || notableFact(x.ev, state, preset, opts)))) return state;
  const H = String(opts.heroine || '').trim() || 'героиня';
  const text = `громкая сцена при всех: ${H} в центре внимания`;
  const next = cloneState(state);
  const at = { day: opts.day || (next.calendar && next.calendar.day) || '', time: opts.time || '' };
  addFeedItem(next, {
    id: factId(opts.src || '', `loud=${loud}`),
    src: opts.src || '',
    at,
    factRef: `loud=${loud}`,
    kind: 'fact',
    chan: 'chat',
    text,
    gist: text,
    rumor: false,
    truth: null,
    about: [HEROINE],
    heroine: true,
    loud,
    read: true,
  });
  return next;
}

export function applyNotableFacts(state, items, preset, opts = {}) {
  const acted = (items || []).some((x) => x && x.ev && (x.ev.kind === 'act' || x.ev.kind === 'clash') && [x.ev.a, x.ev.b].includes(HEROINE));
  const list = (items || [])
    .filter((x) => x && x.ev && NOTABLE_KINDS.includes(x.ev.kind) && x.token && !(x.ev.kind === 'fame' && acted))
    .map((x) => ({ token: x.token, fact: notableFact(x.ev, state, preset, opts) }))
    .filter((x) => x.fact);
  if (!list.length) return state;
  const next = cloneState(state);
  const at = { day: opts.day || (next.calendar && next.calendar.day) || '', time: opts.time || '' };
  for (const { token, fact } of list) {
    addFeedItem(next, {
      id: factId(opts.src || '', token),
      src: opts.src || '',
      at,
      factRef: token,
      kind: 'fact',
      chan: 'chat',
      text: fact.text,
      gist: fact.gist,
      rumor: false,
      truth: null,
      about: [HEROINE],
      heroine: true,
      loud: fact.loud,
      read: true,
      minor: true,
    });
  }
  return next;
}

function looksTarget(state, ev) {
  const lists = [state.teachers, state.classmates, state.classmateCandidates].map((l) => (Array.isArray(l) ? l.filter(Boolean) : []));
  if (ev.personId) return lists.flat().find((p) => p.id === ev.personId) || null;
  return lists.flat().find((p) => course.isPerson(p, ev.name)) || null;
}

export function revertSceneEvent(state, receipt) {
  const next = cloneState(state);
  if (!receipt || typeof receipt !== 'object') return next;
  if (receipt.kind === 'met') restoreSeen(next, receipt.personId, receipt.prev);
  else if (receipt.kind === 'feed') {
    removeFeedItem(next, receipt.id);
    if (typeof course.dropCandidate === 'function') for (const c of receipt.cands || []) course.dropCandidate(next, c);
  }
  else if (receipt.kind === 'deal') revertDeal(next, receipt);
  else if (receipt.kind === 'feat') return revertFeat(next, receipt);
  else if (receipt.kind === 'looks') unsetLooks(next, { id: receipt.id }, receipt.text);
  else if (receipt.kind === 'candidate') {
    if (receipt.created && typeof course.dropCandidate === 'function') course.dropCandidate(next, receipt.id);
  }
  return next;
}

export function revertSceneSource(state, src, names = [], looks = []) {
  const next = cloneState(state);
  if (!src) return next;
  if (next.feats) next.feats = revertFeatSource(next, src).feats;
  if (next.feed) {
    const feed = ensureFeed(next);
    feed.items = feed.items.filter((x) => x.src !== src);
    feed.deals = feed.deals.filter((d) => d.src !== src);
    unmarkPlayed(next, src);
  }
  for (const l of looks) unsetLooks(next, l.id ? { personId: l.id } : { name: l.name }, l.text);
  if (names.length && Array.isArray(next.classmateCandidates) && typeof course.sameName === 'function') {
    next.classmateCandidates = next.classmateCandidates.filter((c) => !(c && c.source === 'scene' && names.some((n) => course.sameName(c.name, n))));
  }
  return next;
}

export const SCENE_RECEIPTS = ['met', 'feed', 'candidate', 'deal', 'feat', 'looks'];

function unsetLooks(state, who, text) {
  const person = looksTarget(state, who.id ? { personId: who.id } : who);
  if (person && person.looks && person.looks === normalizeLooks(text)) delete person.looks;
}

export function applyReactions(state, src, reactions, facts, opts = {}) {
  const next = cloneState(state);
  const list = (reactions || []).filter((r) => r && facts.has(r.fact)).map((r) => {
    const ev = facts.get(r.fact);
    const about = aboutOf(ev);
    return { ...r, about, heroine: about.includes(HEROINE), rumor: r.chan === 'anon' };
  });
  const replies = (opts.replies || []).map((a) => {
    if (!a || !a.parent) return null;
    if (a.parent.token) return a;
    const post = a.parent.ref ? postByRef(next, a.parent.ref) : null;
    return post ? { ...a, parent: { feed: post.id } } : null;
  }).filter(Boolean);
  putReactions(next, src, list, { ...opts, replies });
  return next;
}

const F_ENDINGS = ['а', 'я', 'ы', 'и', 'е', 'у', 'ю', 'ой', 'ей', 'ою', 'ею'];
const ADJ_ENDINGS = ['ий', 'ый', 'ой', 'ая', 'яя', 'ого', 'его', 'ому', 'ему', 'ым', 'им', 'ом', 'ую', 'юю', 'ей'];
const SOFT_ENDINGS = ['ь', 'й', 'я', 'ю', 'е', 'ем', 'ём', 'ей', 'и'];
const HARD_ENDINGS = ['', 'а', 'у', 'ом', 'ым', 'е', 'ой', 'ы'];
const CYR = /[а-яё]/;

function stemOf(word) {
  const w = word.toLowerCase().replace(/ё/g, 'е');
  if (!CYR.test(w)) return { base: w, endings: ['', "'s", 's'] };
  if (/(?:ий|ый|ой|ая|яя)$/.test(w) && w.length >= 5) return { base: w.slice(0, -2), endings: ADJ_ENDINGS };
  if (/[ая]$/.test(w)) return { base: w.slice(0, -1), endings: F_ENDINGS };
  if (/[ьй]$/.test(w)) return { base: w.slice(0, -1), endings: SOFT_ENDINGS };
  if (/[оеиуэы]$/.test(w)) return { base: w, endings: [''] };
  return { base: w, endings: HARD_ENDINGS };
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function mentionedPeople(text, people, stop = null) {
  const src = String(text || '').replace(/<!--[\s\S]*?-->/g, ' ');
  if (!src.trim()) return [];
  const list = (people || []).filter((p) => p && p.id && p.name);
  const owners = new Map();
  for (const p of list) {
    const parts = normName(p.name).split(' ').filter((w) => w.replace(/[^\p{L}]/gu, '').length >= 3);
    for (const w of new Set(parts)) {
      if (stop && stopHit(w, stop)) continue;
      owners.set(w, owners.has(w) && owners.get(w) !== p.id ? null : p.id);
    }
  }
  const found = new Set();
  for (const [part, id] of owners) {
    if (!id || found.has(id)) continue;
    const { base, endings } = stemOf(part);
    if (base.length < 3) continue;
    const alt = [...new Set(endings)].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
    const re = new RegExp(`(?<![\\p{L}\\p{M}\\d_])${escapeRe(base).replace(/е/g, '[её]')}(?:${alt})(?![\\p{L}\\p{M}\\d_])`, 'giu');
    for (const m of src.matchAll(re)) {
      const first = m[0][0];
      if (first !== first.toUpperCase() || first === first.toLowerCase()) continue;
      found.add(id);
      break;
    }
  }
  return list.map((p) => p.id).filter((id) => found.has(id));
}

export function localMet(state, text, opts = {}) {
  const people = (state && Array.isArray(state.classmates)) ? state.classmates : [];
  if (!people.length) return { state, met: [] };
  const met = mentionedPeople(text, people, opts.stop);
  if (!met.length) return { state, met };
  const next = cloneState(state);
  ensureFeed(next);
  const at = { day: opts.day || (next.calendar && next.calendar.day) || '', time: opts.time || (next.calendar && next.calendar.time) || '' };
  for (const id of met) markSeen(next, id, at, { local: true });
  return { state: next, met };
}

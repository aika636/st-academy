import { normalizeFeed } from './feed.mjs';
import { stopHit, normName } from './stop-names.mjs';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const clip = (v, max) => Array.from(str(v).replace(/\s+/g, ' ')).slice(0, max).join('').trim();

export const LOVE_RE = /влюбл|люб(?:ит|ов|ви)|симпат|нравит|ухажив|роман|невест|жених|помолв|поцел|взаимност|crush/iu;

export const SCENE_MAX = 2;

function namedIn(name, text) {
  const stems = normName(name).split(' ').filter((t) => t.length >= 4).map((t) => t.slice(0, 5));
  const hay = String(text == null ? '' : text).replace(/ё/g, 'е').replace(/Ё/g, 'Е');
  return stems.some((s) => new RegExp(`(?<![\\p{L}])${s[0].toUpperCase()}${s.slice(1)}`, 'u').test(hay));
}

export function loveOf(mate, mains) {
  const tie = mate && mate.tie && typeof mate.tie === 'object' ? mate.tie.what : mate && mate.tie;
  const text = [mate && mate.desire, mate && mate.problem, tie, mate && mate.club].map(str).join(' ');
  if (!text || !LOVE_RE.test(text)) return null;
  const words = normName(text).split(' ').filter(Boolean);
  const named = (names) => names.some((n) => normName(n).split(' ').some((t) => t.length >= 3 && words.some((w) => w.startsWith(t.slice(0, Math.min(t.length, 5))))));
  const hero = str(mains && mains.hero);
  const card = ((mains && mains.card) || []).map(str).filter(Boolean);
  if (hero && named([hero])) return { to: hero, rival: card.join(', ') };
  if (card.length && named(card)) return { to: card.join(', '), rival: hero };
  return null;
}

export function loversOf(state, mains) {
  return new Set(((state && state.classmates) || []).filter((c) => c && c.id && loveOf(c, mains)).map((c) => c.id));
}

export function mainsOfStop(stop) {
  const list = Array.isArray(stop) ? stop : [];
  return { hero: str((list.find((s) => s.kind === 'user') || {}).name), card: list.filter((s) => s.kind === 'char').map((s) => str(s.name)).filter(Boolean) };
}

const HOSTILE_RE = /напал|ударил|толкнул|оскорбил|унизил|избил|травил|давил|давит|пригрозил|обвинил|подставил|высмеял|облил|порвал|шантаж|донос/iu;
const FRIEND_RE = /заступил|защитил|помог|поддержал|выручил|утешил|прикрыл/iu;

const toAbout = (f) => (f.about || []).some((id) => id === '@heroine' || /^@card\//.test(id));
const sameName = (a, b) => {
  const x = normName(a).split(' ').filter(Boolean);
  const y = normName(b).split(' ').filter(Boolean);
  if (!x.length || !y.length) return false;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.every((w) => l.includes(w));
};

const journalTexts = (state) => (Array.isArray(state && state.journal) ? state.journal : [])
  .map((j) => [j && j.text, j && j.data && j.data.why, j && j.data && j.data.line].filter((t) => typeof t === 'string').join(' '))
  .filter(Boolean);

export function sceneFolk(state, opts = {}) {
  const s = state || {};
  const known = [
    ...(Array.isArray(s.classmates) ? s.classmates : []).map((c) => c && c.name),
    ...(Array.isArray(s.teachers) ? s.teachers : []).map((t) => t && t.name),
    ...normalizeFeed(s.feed).cast.map((m) => m.nick),
  ].filter(Boolean);
  const facts = normalizeFeed(s.feed).items
    .filter((x) => x.kind === 'fact' && x.status !== 'expired' && toAbout(x) && (x.rumor || !x.private));
  const journal = journalTexts(s);
  const out = [];
  for (const c of Array.isArray(s.classmateCandidates) ? s.classmateCandidates : []) {
    const name = str(c && c.name);
    if (!name || c.source !== 'scene' || stopHit(name, opts.stop) || known.some((k) => sameName(k, name))) continue;
    const hit = facts.filter((f) => namedIn(name, f.gist || f.text));
    const rows = journal.filter((t) => namedIn(name, t));
    const loud = hit.some((f) => (f.loud ?? 1) >= 2);
    const score = hit.length + rows.length;
    if (score < 2 && !(score >= 1 && loud)) continue;
    const act = hit.find((f) => namedIn(name, String(f.gist || f.text).split(/\s+/).slice(0, 2).join(' ')));
    const role = act ? (HOSTILE_RE.test(act.gist || act.text) ? 'hostile' : FRIEND_RE.test(act.gist || act.text) ? 'friend' : '') : '';
    const best = act || hit.sort((a, b) => (b.loud ?? 1) - (a.loud ?? 1))[0];
    out.push({ id: `scene-${str(c.id) || normName(name).replace(/ /g, '-')}`, name, role, note: best ? clip(best.gist || best.text, 90) : clip(rows[0], 90), score: score + (loud ? 1 : 0) });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function castLovesCard(member, mains, role = '') {
  if (!member || !str(member.jealousy)) return false;
  const text = [member.goal, member.type, member.interest].map(str).join(' ');
  if (LOVE_RE.test(text)) return (loveOf({ desire: text }, mains) || {}).to !== mains.hero;
  const words = normName(text).split(' ');
  const has = (w) => words.some((x) => x.startsWith(w.slice(0, 5)));
  if ((mains.card || []).some((n) => normName(n).split(' ').some((t) => t.length >= 4 && has(t)))) return true;
  return normName(role).split(' ').filter((w) => w.length >= 6).filter(has).length >= 2;
}

export function pickCardLover(people) {
  const list = Array.isArray(people) ? people : [];
  const pick = list.find((a) => a.scene && a.role === 'hostile')
    || list.find((a) => !a.scene && a.jealousy && !a.fan)
    || list.find((a) => !a.scene && !a.fan)
    || list.find((a) => a.scene);
  return pick ? pick.id : null;
}

import { impactWeight } from './relations.mjs';
import { stopList, stopHit, strictest, HARD_STOPS, STOP_USER, STOP_CHAR } from './stop-names.mjs';
import { namesOf, isPerson } from './classmates.mjs';
import { slugify } from './plan-gen.mjs';
import { subjectWord } from './words.mjs';
import { stableLooks } from './portraits.mjs';
import { achIdOf, rarityOf, momentId, MOMENT_WORDS } from './feats.mjs';

export const MARKER_RE =
  /<!--\s*\[{0,2}\s*academy\b((?:(?!<!--)[\s\S])*?)\]{0,2}\s*-->|\[{1,2}\s*academy\b([^\]\n]*)\]{1,2}/gi;

const KEY_GROUPS = [
  { kind: 'time', names: ['t', 'time', 'время', 'врем'] },
  { kind: 'grade', names: ['grade', 'mark', 'оценка', 'оц'] },
  { kind: 'completion', names: ['completion'] },
  { kind: 'rel', names: ['rel', 'relation', 'отношение', 'отн'] },
  { kind: 'skip', names: ['skip', 'прогул', 'пропуск'] },
  { kind: 'late', names: ['late', 'опоздание', 'опоздал', 'опоздала'] },
  { kind: 'event', names: ['event', 'событие', 'праздник'] },
  { kind: 'pause', names: ['pause', 'пауза', 'каникулы', 'закрытие'] },
  { kind: 'met', names: ['met', 'был', 'была', 'встреча'] },
  { kind: 'clash', names: ['clash', 'стычка', 'ссора'] },
  { kind: 'act', names: ['act', 'действие'] },
  { kind: 'say', names: ['say', 'цитата'] },
  { kind: 'rumor', names: ['rumor', 'слух'] },
  { kind: 'new', names: ['new', 'новый', 'новая', 'новенький', 'новенькая'] },
  { kind: 'looks', names: ['looks', 'внешность'] },
  { kind: 'deal', names: ['deal', 'дело', 'обещание'] },
  { kind: 'deal-', names: ['deal-', 'дело-', 'обещание-'] },
  { kind: 'feat', names: ['ach', 'ачивка'] },
  { kind: 'fame', names: ['fame', 'слава'] },
];

export const HEROINE = '@heroine';

export const CARD_PREFIX = '@card/';
export const isCardParty = (id) => String(id || '').startsWith(CARD_PREFIX);
export const cardPartyName = (id) => String(id || '').slice(CARD_PREFIX.length);

export const WHO_PREFIX = '@who/';
export const isWhoParty = (id) => String(id || '').startsWith(WHO_PREFIX);
export const whoPartyName = (id) => String(id || '').slice(WHO_PREFIX.length);

const NOT_A_NAME = /^(?:кто[-\s]?(?:то|нибудь|либо)|некто|никто|все|всех|он|она|они|оно|я|мы|ты|вы|рассказчик|narrator|someone|somebody|everyone|nobody|he|she|they|толпа|народ|люди|незнакомец|незнакомка|неизвестн\p{L}*|студент\p{L}*|ученик\p{L}*|однокурсник\p{L}*|кто)$/iu;

export function looksLikePersonName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  const words = name.split(' ');
  return /^\p{Lu}\p{L}/u.test(name) && words.length <= 4 && name.length <= 60 && !/[\d@/:;=<>[\]()]/.test(name)
    && !words.some((w, i) => i === 0 && NOT_A_NAME.test(w)) && !NOT_A_NAME.test(name);
}

export function cardDisplayName(written, hitName, cast, lang) {
  const clean = (v) => String(v || '').replace(/[:=;]/g, ' ').replace(/\s+/g, ' ').trim();
  const l = String(lang || 'ru');
  const cyr = /^(?:ru|uk|be|bg|sr|kk|mk)/i.test(l) || /[а-яё]/i.test(l);
  const fits = (v) => (cyr ? /[а-яё]/i.test(v) && !/[a-z]/i.test(v) : !/[а-яё]/i.test(v));
  const w = clean(written);
  if (w && fits(w)) return w;
  const h = clean(hitName);
  const key = (v) => clean(v).toLowerCase().replace(/ё/g, 'е');
  for (const person of Array.isArray(cast) ? cast : []) {
    const all = [person && person.name, ...((person && person.aliases) || [])].filter(Boolean);
    if (!all.some((n) => key(n) === key(h) || key(n) === key(w))) continue;
    const own = all.map(clean).find(fits);
    if (own) return own;
  }
  return h || w;
}

const HEROINE_WORDS = ['@heroine', 'heroine', '@hero', 'героиня', '@героиня', 'герой', '@герой'];

export const SOCIAL_TEXT_MAX = { reason: 60, rumor: 100, deal: 60, name: 60, act: 80, say: 100, why: 100, momentName: 50, momentDesc: 160, looks: 160 };

const DEAL_CLOSED = /^(?:закрыт[оа]?|закрыли|вернул[аи]?|выполнен[оа]?|done|closed?|-)$/iu;

export const EVENT_HORIZON = 13;

export const PAUSE_MAX_DAYS = 366;

const EVENT_NAME_MAX = 80;

const KIND_BY_NAME = new Map();
for (const g of KEY_GROUPS) for (const n of g.names) KIND_BY_NAME.set(n, g.kind);

const KEY_RE = new RegExp(
  `(?<![\\p{L}\\p{M}\\d_])([\\p{L}\\d_-]{1,24})\\s*=\\s*`,
  'giu',
);

const IMPACT_WORDS = {
  minor: ['minor', 'small', 'слегка', 'чуть', 'немного'],
  major: ['major', 'big', 'сильно', 'крупно'],
};

const IMPACT_BY_WORD = new Map();
for (const [level, words] of Object.entries(IMPACT_WORDS)) for (const w of words) IMPACT_BY_WORD.set(w, level);

const TIME_UNITS = [
  { unit: 'week', re: /^(?:w|week|weeks|нед|недел[яиьюе]|недель)$/i },
  { unit: 'day', re: /^(?:d|day|days|д|день|дня|дней|сутки|суток)$/i },
  { unit: 'period', re: /^(?:p|period|periods|lesson|lessons|пара|пары|пар|урок|урока|уроков)$/i },
];

export function parseMarker(text, preset) {
  const events = [];
  const rejected = [];
  let found = false;

  if (typeof text !== 'string' || !text) return { events, rejected, found };

  const ctx = buildContext(preset);

  for (const m of text.matchAll(MARKER_RE)) {
    const body = m[1] !== undefined ? m[1] : m[2];
    if (body === undefined) continue;
    found = true;
    parseBody(body, ctx, events, rejected);
  }

  return { events, rejected, found };
}

export function stripMarker(text) {
  if (typeof text !== 'string' || !text) return '';
  return text
    .replace(MARKER_RE, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/, '');
}

export function keepMarkerKinds(text, kinds) {
  if (typeof text !== 'string' || !text) return '';
  const keep = new Set(kinds || []);
  return text.replace(MARKER_RE, (_, inComment, bare) => {
    const body = inComment !== undefined ? inComment : (bare || '');
    const kept = markerPairs(body).filter((p) => keep.has(p.kind)).map((p) => p.raw);
    return `<!-- [ACADEMY${kept.length ? ` ${kept.join(' ')}` : ''}] -->`;
  });
}

export function salvageMarker(text) {
  if (typeof text !== 'string' || !text) return null;
  const closed = new Set([...text.matchAll(MARKER_RE)].map((m) => m.index));
  const open = /<!--\s*\[{0,2}\s*academy\b/gi;
  for (const m of text.matchAll(open)) {
    if (closed.has(m.index)) continue;
    const from = m.index + m[0].length;
    const rest = text.slice(from);
    const stops = [rest.search(/<!--/), rest.search(/\n[ \t]*(?:что сочинено|кратко|loud|react|reply)(?![\p{L}\d_])/iu)].filter((i) => i >= 0);
    const cut = stops.length ? Math.min(...stops) : -1;
    const body = (cut >= 0 ? rest.slice(0, cut) : rest).replace(/\]{1,2}\s*$/, '');
    const pairs = markerKeys(`<!-- [ACADEMY ${body}] -->`);
    const partial = cut < 0 && pairs.length > 0;
    if (partial) pairs.pop();
    const kept = pairs.filter((p) => p.value).map((p) => p.raw);
    return {
      marker: `<!-- [ACADEMY${kept.length ? ` ${kept.join(' ')}` : ''}] -->`,
      start: m.index,
      end: cut >= 0 ? from + cut : text.length,
      partial,
    };
  }
  return null;
}

export function markerKeys(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const m of text.matchAll(MARKER_RE)) {
    const body = m[1] !== undefined ? m[1] : m[2];
    if (body === undefined) continue;
    out.push(...mergeSay(bodyKeys(body)));
  }
  return out;
}

function bodyKeys(body) {
  const keys = [...body.matchAll(KEY_RE)].map((k) => ({ name: k[1].toLowerCase(), at: k.index, valueAt: k.index + k[0].length }));
  return keys.map((k, i) => {
    const end = i + 1 < keys.length ? keys[i + 1].at : body.length;
    const value = body.slice(k.valueAt, end).replace(/[,;]\s*$/, '').trim();
    return { name: k.name, kind: KIND_BY_NAME.get(k.name) || null, value, raw: `${k.name}=${value}` };
  });
}

function mergeSay(list) {
  const out = [];
  let act = null;
  for (const k of list) {
    if (k.kind === 'act') act = k;
    if (k.kind === 'say' && act && k.value && !SAY_AT.test(act.value)) {
      act.value = `${act.value}:"${k.value.replace(/^["«“„']+|["»”“']+$/g, '').trim()}"`;
      act.raw = `${act.name}=${act.value}`;
      continue;
    }
    out.push(k);
  }
  return out;
}

const SAY_AT = /:\s*["«“„]/;

function markerPairs(body) {
  const keys = [...String(body).matchAll(KEY_RE)].map((k) => ({
    name: k[1].toLowerCase(),
    at: k.index,
    valueAt: k.index + k[0].length,
  }));
  const out = [];
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const end = i + 1 < keys.length ? keys[i + 1].at : body.length;
    const value = body.slice(k.valueAt, end).replace(/[,;]\s*$/, '').trim();
    const kind = KIND_BY_NAME.get(k.name);
    if (kind && value) out.push({ kind, raw: `${k.name}=${value}` });
  }
  return out;
}

function parseBody(body, ctx, events, rejected) {
  for (const k of mergeSay(bodyKeys(body))) {
    const { value, raw, kind } = k;

    if (!kind || kind === 'say') continue;

    if (!value) {
      rejected.push({ raw, reason: 'пустое значение' });
      continue;
    }

    switch (kind) {
      case 'time': parseTime(value, raw, events, rejected); break;
      case 'grade': parseGrade(value, raw, ctx, events, rejected); break;
      case 'completion': {
        const at = value.lastIndexOf(':');
        const rawScope = value.slice(0, at).trim();
        const scope = ['all', 'debts'].includes(rawScope) ? rawScope : ctx.findSubject(rawScope);
        const grade = at >= 0 ? ctx.findGrade(value.slice(at + 1)) : null;
        if (!scope || grade === null) rejected.push({ raw, reason: `ожидается completion=all|debts|${ctx.words.subject}:оценка из шкалы` });
        else events.push({ kind: 'completion', scope, value: grade });
        break;
      }
      case 'rel': parseRel(value, raw, ctx, events, rejected); break;
      case 'skip':
      case 'late': parseAttendance(value, raw, kind, ctx, events, rejected); break;
      case 'event': parseEvent(value, raw, events, rejected); break;
      case 'pause': parsePause(value, raw, events, rejected); break;
      case 'met': parseMet(value, raw, ctx, events, rejected); break;
      case 'clash': parseClash(value, raw, ctx, events, rejected); break;
      case 'act': parseAct(value, raw, ctx, events, rejected); break;
      case 'rumor': parseRumor(value, raw, ctx, events, rejected); break;
      case 'feat': parseFeat(value, raw, ctx, events, rejected); break;
      case 'fame': parseFame(value, raw, events, rejected); break;
      case 'new': parseNew(value, raw, ctx, events, rejected); break;
      case 'looks': parseLooks(value, raw, ctx, events, rejected); break;
      case 'deal':
      case 'deal-': parseDeal(value, raw, kind === 'deal-', ctx, events, rejected); break;
    }
  }
}

function parseTime(value, raw, events, rejected) {
  const v = value.replace(/\s+/g, ' ').trim();

  const num = v.match(/^([+-]?)(\d{1,3})$/);
  if (num) {
    events.push({ kind: 'time', unit: 'period', n: signed(num[1], num[2]) });
    return;
  }

  const m = v.match(/^([+-]?)(\d{0,3})\s*([\p{L}]+)\.?$/u);
  if (m) {
    const word = m[3].toLowerCase();
    for (const u of TIME_UNITS) {
      if (u.re.test(word)) {
        const n = m[2] === '' ? 1 : Number(m[2]);
        events.push({ kind: 'time', unit: u.unit, n: m[1] === '-' ? -n : n });
        return;
      }
    }
    rejected.push({ raw, reason: `неизвестная единица времени: «${v}»` });
    return;
  }

  rejected.push({ raw, reason: `не разбирается как сдвиг времени: «${v}»` });
}

function parseGrade(value, raw, ctx, events, rejected) {
  const at = value.lastIndexOf(':');
  if (at < 0) {
    rejected.push({ raw, reason: `нет двоеточия: ожидается «${ctx.words.subject}:оценка»` });
    return;
  }
  const subjectId = ctx.findSubject(value.slice(0, at));
  if (!subjectId) {
    rejected.push({ raw, reason: `нет в списке ${ctx.words.genMany}: «${value.slice(0, at).trim()}»` });
    return;
  }
  const graded = ctx.findGrade(value.slice(at + 1));
  if (graded === null) {
    rejected.push({ raw, reason: `неизвестная оценка: «${value.slice(at + 1).trim()}»` });
    return;
  }
  events.push({ kind: 'grade', subjectId, value: graded });
}

function parseRel(value, raw, ctx, events, rejected) {
  const at = value.lastIndexOf(':');
  if (at < 0) {
    rejected.push({ raw, reason: 'нет двоеточия: ожидается «преподаватель:дельта»' });
    return;
  }
  const split = splitReason(value, ctx);
  if (split) {
    parseRelCore(split.head, raw, ctx, events, rejected, split.reason);
    return;
  }
  parseRelCore(value, raw, ctx, events, rejected, '');
}

const REASON_MAX = 60;

function splitReason(value, ctx) {
  const parts = value.split(':');
  for (let k = parts.length - 2; k >= 1; k -= 1) {
    const word = parts[k].replace(/[[\]()]/g, '').trim();
    if (!/^[+-]?\d{1,2}$/.test(word) && !parseImpact(word, ctx)) continue;
    const reason = parts.slice(k + 1).join(':')
      .replace(/[[\]()]/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
      .slice(0, REASON_MAX);
    return { head: `${parts.slice(0, k).join(':')}:${word}`, reason };
  }
  return null;
}

function parseRelCore(value, raw, ctx, events, rejected, reason) {
  const at = value.lastIndexOf(':');
  const written = value.slice(0, at).trim();
  const who = isCardParty(written) ? cardPartyName(written).trim() : written;
  const teacherId = ctx.findPerson(who);
  const hit = strictest([
    ctx.stopHit(who),
    teacherId ? ctx.stopHit(ctx.teacherName(teacherId)) : null,
    teacherId ? ctx.stopHit(teacherId) : null,
  ]);
  if (hit && (HARD_STOPS.includes(hit.kind) || !teacherId)) {
    rejected.push({ raw, reason: `стоп-лист (${STOP_WORDS[hit.kind] || hit.kind}): «${who}» — не преподаватель` });
    return;
  }
  if (!teacherId) {
    rejected.push({ raw, reason: `неизвестный преподаватель: «${who}»` });
    return;
  }
  const word = value.slice(at + 1).trim();
  const why = reason ? { reason } : {};
  const d = word.match(/^([+-]?\d{1,2})$/);
  if (d) {
    events.push({ kind: 'rel', teacherId, delta: Number(d[1]), ...why });
    return;
  }
  const w = parseImpact(word, ctx);
  if (!w) {
    rejected.push({ raw, reason: `дельта отношения не число и не слово силы: «${word}»` });
    return;
  }
  events.push({ kind: 'rel', teacherId, delta: w.delta, impact: w.level, ...why });
}

const STOP_WORDS = {
  [STOP_USER]: 'героиня',
  institution: 'заведение',
  preset: 'служебное слово',
  [STOP_CHAR]: 'карточка',
};

function parseImpact(word, ctx) {
  const v = String(word).replace(/[−‒–—―]/g, '-').replace(/\s+/g, '').toLowerCase();
  const m = v.match(/^([+-]?)([\p{L}]+)([+-]?)$/u);
  if (!m) return null;
  const sign = m[1] || m[3];
  if (!sign || (m[1] && m[3])) return null;
  const level = IMPACT_BY_WORD.get(m[2].replace(/ё/g, 'е'));
  if (!level) return null;
  const weight = ctx.impactWeight(level);
  if (!weight) return null;
  return { level, delta: sign === '-' ? -weight : weight };
}

function parseEvent(value, raw, events, rejected) {
  const v = value.replace(/[−‒–—―]/g, '-');
  const m = v.match(/^\+?\s*(\d{1,3})\s*(?:(?:\.\.|-)\s*\+?\s*(\d{1,3}))?\s*(?:дн[а-яё]*|d|days?)?\s*:\s*([\s\S]+)$/iu);
  if (!m) {
    rejected.push({ raw, reason: 'ожидается event=+дни:название' });
    return;
  }
  const days = Number(m[1]);
  const until = m[2] === undefined ? days : Number(m[2]);
  const name = m[3].replace(/[[\]<>]/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().slice(0, EVENT_NAME_MAX);
  if (!name) {
    rejected.push({ raw, reason: 'у события нет названия' });
    return;
  }
  if (until < days) {
    rejected.push({ raw, reason: 'конец события раньше начала' });
    return;
  }
  if (days > EVENT_HORIZON) {
    rejected.push({ raw, reason: `событие дальше двух недель (+${days}) — в планы не пишется` });
    return;
  }
  events.push({ kind: 'event', days, until: Math.min(until, days + 31), name });
}

function parsePause(value, raw, events, rejected) {
  const m = value.match(/^(?:(end|конец|возобновлен[а-яё]*|отмен[а-яё]*)|(open|до\s+отмены|бессрочно)|\+?\s*(\d{1,4})\s*(?:дн[а-яё]*|d|days?)?)\s*(?::\s*([\s\S]*))?$/iu);
  if (!m) {
    rejected.push({ raw, reason: 'ожидается pause=дни:название, pause=open:название или pause=end' });
    return;
  }
  const name = (m[4] || '').replace(/[[\]<>]/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().slice(0, EVENT_NAME_MAX);
  if (m[1]) {
    events.push({ kind: 'pause', end: true });
    return;
  }
  if (m[2]) {
    events.push({ kind: 'pause', days: null, name });
    return;
  }
  const days = Number(m[3]);
  if (days < 1 || days > PAUSE_MAX_DAYS) {
    rejected.push({ raw, reason: `срок приостановки — от 1 до ${PAUSE_MAX_DAYS} дней` });
    return;
  }
  events.push({ kind: 'pause', days, name });
}

function parseParty(raw, ctx, opts = {}) {
  let v = String(raw || '').replace(/[[\]()]/g, '').trim();
  if (!v) return { error: 'пустая сторона' };
  if (isWhoParty(v)) v = whoPartyName(v).trim();
  if (!v) return { error: 'пустая сторона' };
  const wasCard = isCardParty(v);
  if (wasCard) {
    const name = cardPartyName(v).trim();
    const hit = name ? ctx.stopHit(name) : null;
    if (name && opts.card && !(hit && hit.kind === STOP_USER)) {
      return { id: `${CARD_PREFIX}${ctx.cardName ? ctx.cardName(name, hit ? hit.name : name) : name}`, card: true };
    }
    v = name;
    if (!v) return { error: 'пустая сторона' };
  }
  if (HEROINE_WORDS.includes(norm(v))) return { id: HEROINE };
  const said = ctx.stopHit(v);
  if (said && said.kind === STOP_USER) return { id: HEROINE };
  const id = ctx.findPerson(v);
  const hit = strictest([said, id ? ctx.stopHit(ctx.teacherName(id)) : null]);
  if (opts.card && !id && hit && hit.kind === STOP_CHAR) {
    return { id: `${CARD_PREFIX}${ctx.cardName ? ctx.cardName(v, hit.name) : hit.name}`, card: true };
  }
  if (hit && (HARD_STOPS.includes(hit.kind) || !id)) {
    return { error: `стоп-лист (${STOP_WORDS[hit.kind] || hit.kind}): «${v}»` };
  }
  if (!id && wasCard) return { error: `персонаж карточки здесь не участвует: «${v}»` };
  if (!id && opts.who && looksLikePersonName(v)) return { id: `${WHO_PREFIX}${v.replace(/\s+/g, ' ')}`, who: true };
  if (!id) return { error: `неизвестный человек: «${v}»` };
  return { id };
}

export function partyOf(raw, lexicon) {
  return parseParty(raw, buildContext(lexicon));
}

function freeText(parts, max) {
  return parts.join(':')
    .replace(/-->|[=[\]<>]/g, ' ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
    .slice(0, max)
    .trim();
}

function parseMet(value, raw, ctx, events, rejected) {
  for (const part of value.split(/[,;]/)) {
    if (!part.trim()) continue;
    const who = parseParty(part, ctx);
    if (who.error) rejected.push({ raw, reason: who.error });
    else if (who.id === HEROINE) rejected.push({ raw, reason: 'героиня и так в сцене — met не нужен' });
    else events.push({ kind: 'met', personId: who.id });
  }
}

function parsePair(parts, raw, ctx, rejected) {
  const a = parseParty(parts[0], ctx, { card: true });
  const b = parseParty(parts[1], ctx, { card: true });
  const bad = a.error || b.error || (a.card && b.card ? 'обе стороны — персонажи карточки' : '');
  if (bad) {
    rejected.push({ raw, reason: bad });
    return null;
  }
  if (a.id === b.id) {
    rejected.push({ raw, reason: 'обе стороны — один человек' });
    return null;
  }
  return { a: a.id, b: b.id };
}

function parseClash(value, raw, ctx, events, rejected) {
  const parts = value.split(':');
  if (parts.length < 2) {
    rejected.push({ raw, reason: 'ожидается clash=кто:с кем:повод' });
    return;
  }
  const pair = parsePair(parts, raw, ctx, rejected);
  if (!pair) return;
  const reason = freeText(parts.slice(2), SOCIAL_TEXT_MAX.reason);
  events.push({ kind: 'clash', ...pair, ...(reason ? { reason } : {}) });
}

export const ACT_TYPES = {
  близость: ['близость', 'close', 'closeness', 'intimacy'],
  конфликт: ['конфликт', 'conflict'],
  помощь: ['помощь', 'help'],
  отказ: ['отказ', 'refuse', 'refusal'],
  достижение: ['достижение', 'win', 'achievement'],
  провал: ['провал', 'fail', 'failure'],
  уход: ['уход', 'leave'],
  появление: ['появление', 'arrive', 'arrival'],
};
export const ACT_ACCESS = {
  'на людях': ['на людях', 'при всех', 'public'],
  наедине: ['наедине', 'private'],
  подслушали: ['подслушали', 'подслушано', 'overheard'],
};
export const ACT_REACH = {
  многие: ['многие', 'many'],
  несколько: ['несколько', 'few'],
  неизвестно: ['неизвестно', 'unknown'],
};

const canonOf = (table, word) => {
  const w = String(word || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  return Object.keys(table).find((k) => table[k].some((x) => x.replace(/ё/g, 'е') === w)) || '';
};
export const actTypeOf = (w) => canonOf(ACT_TYPES, w);

function parseAct(value, raw, ctx, events, rejected) {
  const q = SAY_AT.exec(value);
  const head = q ? value.slice(0, q.index) : value;
  const say = q ? freeText([value.slice(q.index + 1).replace(/^\s*["«“„]|["»”“"]\s*$/g, '')], SOCIAL_TEXT_MAX.say).replace(/["«»“”„]/g, '') : '';
  const parts = head.split(':').map((x) => x.trim());
  if (parts.length < 4) {
    rejected.push({ raw, reason: 'ожидается act=кто:что:с кем:вид:доступность:охват' });
    return;
  }
  const [who, what, withWho, kindWord, accessWord = '', reachWord = ''] = parts;
  const type = actTypeOf(kindWord);
  if (!type) {
    rejected.push({ raw, reason: `неизвестный вид действия «${kindWord}» (близость, конфликт, помощь, отказ, достижение, провал, уход, появление)` });
    return;
  }
  const access = accessWord ? canonOf(ACT_ACCESS, accessWord) : 'на людях';
  if (!access) {
    rejected.push({ raw, reason: `неизвестная доступность «${accessWord}» (на людях, наедине, подслушали)` });
    return;
  }
  const reach = reachWord ? canonOf(ACT_REACH, reachWord) : 'неизвестно';
  if (!reach) {
    rejected.push({ raw, reason: `неизвестный охват «${reachWord}» (многие, несколько, неизвестно)` });
    return;
  }
  const text = freeText([what], SOCIAL_TEXT_MAX.act);
  if (!text) {
    rejected.push({ raw, reason: 'у действия нет содержания' });
    return;
  }
  const a = parseParty(who, ctx, { card: true, who: true });
  const alone = !withWho || withWho === '-';
  const b = alone ? null : parseParty(withWho, ctx, { card: true, who: true });
  const main = (p) => p.id === HEROINE || p.card;
  const stray = b && ((a.who && !main(b)) || (b.who && !main(a)))
    ? `неизвестный человек: «${whoPartyName((a.who && !main(b) ? a : b).id)}»` : '';
  const bad = a.error || (b && b.error) || stray || (b && a.id === b.id ? 'обе стороны — один человек' : '') || (b && a.card && b.card ? 'обе стороны — персонажи карточки' : '');
  if (bad) {
    rejected.push({ raw, reason: bad });
    return;
  }
  events.push({ kind: 'act', a: a.id, b: b ? b.id : '', what: text, type, access, reach, ...(say ? { say } : {}) });
}

function parseFame(value, raw, events, rejected) {
  const m = /^\s*(\+|-|−|плюс|минус|up|down)\s*(?::([\s\S]*))?$/i.exec(value);
  if (!m) {
    rejected.push({ raw, reason: 'ожидается fame=+:основание или fame=-:основание' });
    return;
  }
  const sign = /^(-|−|минус|down)$/i.test(m[1]) ? -1 : 1;
  events.push({ kind: 'fame', sign, why: freeText([m[2] || ''], SOCIAL_TEXT_MAX.why) });
}

function parseFeat(value, raw, ctx, events, rejected) {
  const know = ctx.feats;
  if (know && know.off) {
    rejected.push({ raw, reason: 'ачивки выключены' });
    return;
  }
  const at = value.indexOf(':');
  const head = (at < 0 ? value : value.slice(0, at)).trim();
  const rest = at < 0 ? '' : value.slice(at + 1);
  if (MOMENT_WORDS.includes(norm(head))) {
    const parts = rest.split(':');
    if (parts.length < 4) {
      rejected.push({ raw, reason: 'ожидается ach=момент:эмодзи:Название:Описание:редкость' });
      return;
    }
    const emoji = parts.shift().trim();
    const word = parts.pop().trim();
    const name = freeText([parts.shift()], SOCIAL_TEXT_MAX.momentName);
    const desc = freeText(parts, SOCIAL_TEXT_MAX.momentDesc);
    const rarity = rarityOf(word);
    const words = name.split(' ').filter(Boolean).length;
    const bad = !/^\p{Extended_Pictographic}/u.test(emoji) || emoji.length > 16 ? 'у момента нет эмодзи'
      : !rarity ? `плохая редкость «${word}» (common или rare)`
        : rarity === 'legendary' ? 'легендарным свободный момент быть не может'
          : words < 2 || words > 6 ? 'название момента — от двух до шести слов'
            : !desc ? 'у момента нет описания'
              : know && know.moments.includes(norm(name)) ? 'момент с таким названием уже был'
                : know && know.momentOk === false ? 'со свободного момента прошло слишком мало ответов' : '';
    if (bad) rejected.push({ raw, reason: bad });
    else events.push({ kind: 'feat', id: momentId(name), moment: { emoji, name, desc, rarity } });
    return;
  }
  const id = achIdOf(head);
  const why = freeText([rest], SOCIAL_TEXT_MAX.why);
  if (!id) rejected.push({ raw, reason: `неизвестная ачивка «${head}»` });
  else if (know && know.owned.includes(id)) rejected.push({ raw, reason: `ачивка ${id} уже получена` });
  else if (!why) rejected.push({ raw, reason: 'у ачивки нет основания' });
  else events.push({ kind: 'feat', id, why });
}

function parseRumor(value, raw, ctx, events, rejected) {
  const at = value.indexOf(':');
  if (at < 0) {
    rejected.push({ raw, reason: 'ожидается rumor=о ком:что говорят' });
    return;
  }
  const about = parseParty(value.slice(0, at), ctx, { card: true });
  if (about.error) {
    rejected.push({ raw, reason: about.error });
    return;
  }
  const text = freeText([value.slice(at + 1)], SOCIAL_TEXT_MAX.rumor);
  if (!text) {
    rejected.push({ raw, reason: 'у слуха нет содержания' });
    return;
  }
  events.push({ kind: 'rumor', about: about.id, text });
}

const NEW_ROLE_TEACHER = /^(?:teacher|mentor|staff|professor|наставник|преподаватель|учитель|профессор)$/iu;

const NEW_ROLE_CANON = /^(?:canon|канон)$/iu;

export function splitNewRole(value) {
  const text = String(value == null ? '' : value);
  const at = text.indexOf(':');
  if (at < 0) return { name: text.trim(), role: '' };
  const words = text.slice(at + 1).split(',').map((w) => w.trim());
  return {
    name: text.slice(0, at).trim(),
    role: words.some((w) => NEW_ROLE_TEACHER.test(w)) ? 'teacher' : '',
    ...(words.some((w) => NEW_ROLE_CANON.test(w)) ? { canon: true } : {}),
  };
}

function parseNew(value, raw, ctx, events, rejected) {
  const { name: head, role, canon } = splitNewRole(value);
  const name = freeText([head], SOCIAL_TEXT_MAX.name).replace(/[:;,.!?]+$/, '').trim();
  const words = name.split(' ').filter(Boolean);
  if (!name || !/\p{L}{2}/u.test(name) || words.length > 4 || /\d/.test(name)) {
    rejected.push({ raw, reason: `не похоже на имя: «${value.trim()}»` });
    return;
  }
  const hit = ctx.stopHit(name);
  if (hit) {
    rejected.push({ raw, reason: `стоп-лист (${STOP_WORDS[hit.kind] || hit.kind}): «${name}»` });
    return;
  }
  const classmate = ctx.findClassmate(name);
  if (classmate) {
    events.push({ kind: 'met', personId: classmate });
    return;
  }
  if (ctx.findPerson(name)) {
    rejected.push({ raw, reason: `«${name}» уже есть среди людей академии` });
    return;
  }
  events.push({ kind: 'new', name, ...(role ? { role } : {}), ...(canon ? { canon: true } : {}) });
}

function parseLooks(value, raw, ctx, events, rejected) {
  const at = value.indexOf(':');
  const said = at < 0 ? '' : freeText([value.slice(at + 1)], SOCIAL_TEXT_MAX.looks);
  if (!said) {
    rejected.push({ raw, reason: 'ожидается looks=кто:внешность' });
    return;
  }
  const text = stableLooks(said);
  if (!text) {
    rejected.push({ raw, reason: 'это сиюминутное состояние, а не внешность' });
    return;
  }
  const who = value.slice(0, at).replace(/[[\]()]/g, '').trim();
  const name = freeText([who], SOCIAL_TEXT_MAX.name);
  if (!name) {
    rejected.push({ raw, reason: 'не сказано, чья внешность' });
    return;
  }
  if (isCardParty(who) || HEROINE_WORDS.includes(norm(who))) {
    rejected.push({ raw, reason: 'героине и персонажу карточки внешность не пишется' });
    return;
  }
  const id = ctx.findPerson(who);
  const hit = ctx.stopHit(who);
  if (hit && (!id || HARD_STOPS.includes(hit.kind))) {
    rejected.push({ raw, reason: `стоп-лист (${STOP_WORDS[hit.kind] || hit.kind}): «${name}»` });
    return;
  }
  events.push({ kind: 'looks', ...(id ? { personId: id } : { name }), text });
}

function parseDeal(value, raw, closedKey, ctx, events, rejected) {
  const parts = value.split(':');
  let closed = closedKey;
  if (parts.length > 3 && DEAL_CLOSED.test(parts[parts.length - 1].trim())) {
    closed = true;
    parts.pop();
  }
  if (parts.length < 3) {
    rejected.push({ raw, reason: 'ожидается deal=кто:кому:что' });
    return;
  }
  const pair = parsePair(parts, raw, ctx, rejected);
  if (!pair) return;
  const what = freeText(parts.slice(2), SOCIAL_TEXT_MAX.deal);
  if (!what) {
    rejected.push({ raw, reason: 'у дела нет содержания' });
    return;
  }
  events.push({ kind: 'deal', ...pair, what, closed });
}

function parseAttendance(value, raw, kind, ctx, events, rejected) {
  const subjectId = ctx.findSubject(value);
  if (!subjectId) {
    rejected.push({ raw, reason: `нет в списке ${ctx.words.genMany}: «${value.trim()}»` });
    return;
  }
  events.push({ kind: 'attendance', subjectId, status: kind });
}

function norm(s) {
  return String(s)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[_\s]+/g, ' ')
    .replace(/[.,;:!?]+$/, '')
    .trim();
}

function buildContext(preset) {
  const p = preset && typeof preset === 'object' ? preset : {};
  const inner = p.preset && typeof p.preset === 'object' ? p.preset : {};

  const subjects = pick(p.subjects, inner.subjects);
  const teachers = pick(p.teachers, inner.teachers);
  const classmates = pick(p.classmates, inner.classmates).filter((c) => c && c.id);
  const people = [...teachers];
  for (const c of classmates) if (!people.some((x) => x && x.id === c.id)) people.push(c);
  const grades = (p.grades && p.grades.values ? p.grades : inner.grades) || {};

  const graded = new Map();
  for (const g of grades.values || []) {
    const v = typeof g === 'string' ? g : g.value;
    if (v !== undefined && v !== null) graded.set(norm(v), String(v));
    if (g && typeof g === 'object' && g.label && v !== undefined && v !== null) graded.set(norm(g.label), String(v));
  }
  for (const [alias, target] of Object.entries(grades.aliases || {})) {
    const canon = graded.get(norm(target)) ?? String(target);
    graded.set(norm(alias), canon);
  }

  const scaleOwner = p.relations ? p : inner;

  const stop = Array.isArray(p.stop) ? p.stop : stopList({
    ...((p.names && typeof p.names === 'object') ? p.names : {}),
    preset: p.displayName || p.stopNames ? p : inner,
    survey: p.survey || inner.survey,
  });

  const wordsOf = p.vocab ? p : inner;
  return {
    feats: p.featsKnow || inner.featsKnow || null,
    words: { subject: subjectWord(wordsOf), genMany: subjectWord(wordsOf, 'genMany') },
    findSubject: (raw) => byIdOrName(subjects, raw),
    findTeacher: (raw) => byIdOrName(teachers, raw),
    findPerson: (raw) => byIdOrName(people, raw) || softPerson(people, raw),
    findClassmate: (raw) => byIdOrName(classmates, raw),
    teacherName: (id) => {
      const t = people.find((x) => x && x.id === id);
      return t ? (t.name || t.id) : '';
    },
    impactWeight: (level) => impactWeight(scaleOwner, level),
    stopHit: (raw) => stopHit(raw, stop),
    cardName: (written, hitName) => cardDisplayName(
      written, hitName,
      p.names && p.names.cast,
      (p.survey || inner.survey || {}).lang || p.lang || inner.lang,
    ),
    findGrade: (raw) => {
      const key = norm(raw);
      return graded.has(key) ? graded.get(key) : null;
    },
  };
}

function pick(a, b) {
  return Array.isArray(a) ? a : (Array.isArray(b) ? b : []);
}

function byIdOrName(list, raw) {
  const key = norm(raw);
  if (!key) return null;
  for (const it of list) if (norm(it.id) === key) return it.id;
  for (const it of list) if (norm(it.name) === key || namesOf(it).some((n) => norm(n) === key)) return it.id;
  const words = key.split(' ');
  const hits = list.filter((it) => namesOf(it).some((n) => {
    const name = norm(n).split(' ');
    for (let i = 0; i + words.length <= name.length; i++) {
      if (words.every((w, k) => name[i + k] === w)) return true;
    }
    return false;
  }));
  return hits.length === 1 ? hits[0].id : null;
}

function softPerson(list, raw) {
  const key = norm(raw);
  if (!key) return null;
  const words = key.split(/[\s-]+/).filter(Boolean);
  if (!words.length) return null;
  const unique = (test) => {
    const hits = list.filter((it) => it && it.id && test(it));
    return hits.length === 1 ? hits[0].id : null;
  };
  const byId = unique((it) => contiguous(words, norm(it.id).split(/[\s-]+/)));
  if (byId) return byId;
  if (/^[a-z0-9\s-]+$/.test(key)) {
    const byLatin = unique((it) => contiguous(words, slugify(it.name || '').split('-')));
    if (byLatin) return byLatin;
  }
  const byName = unique((it) => isPerson(it, raw));
  if (byName) return byName;
  return unique((it) => namesOf(it).some((n) => {
    const name = norm(n).split(' ');
    return words.every((w) => name.some((x) => sameStem(w, x)));
  }));
}

function contiguous(words, parts) {
  for (let i = 0; i + words.length <= parts.length; i++) {
    if (words.every((w, k) => parts[i + k] === w)) return true;
  }
  return false;
}

function sameStem(a, b) {
  if (a === b) return true;
  if (!/^[а-я]{3,}$/.test(a) || !/^[а-я]{3,}$/.test(b)) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n >= Math.max(3, Math.min(a.length, b.length) - 2);
}

function signed(sign, digits) {
  const n = Number(digits);
  return sign === '-' ? -n : n;
}

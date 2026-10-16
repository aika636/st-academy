import { cloneState, normalizeBullying, pushJournal, BULLY_MOVES, BULLYING_MAX } from './state.mjs';
import { seededRng } from './exams.mjs';
import { dayPlan } from './schedule.mjs';
import { addDays, diffDays } from './time.mjs';
import { relationOf } from './relations.mjs';
import { classmateStart, normalizeToHero } from './classmates.mjs';
import { shortName } from './scene.mjs';
import { heroGender, heroWords, genderOfName } from './gender.mjs';
import { addFeedItem, openDeal, ensureFeed } from './feed.mjs';
import { normName } from './stop-names.mjs';
import { BULLY_HOOK_MAX } from './plot.mjs';

const HEROINE = '@heroine';
const BULLY = '@bully';

export const BULLY_TRIES = 3;

export const BULLY_CHANCE = [60, 70, 80, 90, 95];

export const BULLY_MIX = [
  [70, 30, 0, 0, 0],
  [30, 50, 20, 0, 0],
  [10, 25, 45, 20, 0],
  [0, 10, 30, 40, 20],
  [0, 0, 15, 35, 50],
];

const HOOK_MAX = BULLY_HOOK_MAX;

export const BULLY_HIDE_DAYS = 6;
export const BULLY_TRUCE_DAYS = 5;

export const BULLY_GROW_DAYS = 2;
export const BULLY_BACK_DAYS = 2;

export const bullyFloor = (peak) => (peak >= 3 ? 2 : Math.max(0, peak - 2));

export const BULLY_TRACE_DAYS = 3;

const SEED_STRONG = /задир|хулиган|завист|тиран|bully/iu;
const SEED_WEAK = /соперни|вспыльч|нарушител|королев|заводил|сплетн|карьерист|наследник|спортсмен/iu;

export const BULLY_PHRASES = {
  acts: {
    0: [
      '{by} в который раз называет {heroAcc} обидным прозвищем — громко, чтобы слышали все',
      '{by} за спиной {heroGen} передразнивает {heroAcc}, и вокруг фыркают',
      '{by} хихикает и перешёптывается с остальными, пока {heroNom} отвечает у доски',
      '{by} пускает по рядам злую карикатуру на {heroAcc}',
      '{by} при всех обсуждает, как выглядит {heroNom}, и ждёт, что {heroDat} станет неловко',
    ],
    1: [
      '{by} оскорбляет {heroAcc} в лицо, не стесняясь свидетелей',
      '{by} объявляет {heroDat} бойкот: никто из компании не отвечает {heroDat} и не садится рядом',
      '{by} демонстративно занимает место {heroGen}: «занято» — и никто не возражает',
      '{by} вышвыривает {heroAcc} из общего чата и ржёт над этим в группе',
      '{by} захлопывает дверь перед носом {heroGen} и бросает вслед грязное слово',
    ],
    2: [
      { text: '{by} портит конспекты {heroGen}: страницы залиты чернилами, часть вырвана', trace: 'испорченные конспекты' },
      { text: '{by} прячет вещь {heroGen} и смотрит, как {heroNom} её ищет', trace: 'пропавшая вещь' },
      { text: '{by} подставляет {heroAcc} перед наставником: подбрасывает чужую работу, чтобы {heroDat} влетело', trace: 'подстава перед наставником' },
      { text: '{by} унижает {heroAcc} при всех, выставляя напоказ самое больное', trace: 'публичное унижение' },
      { text: '{by} запускает про {heroAcc} грязный слух и следит, как он расходится', trace: 'грязный слух' },
      { text: '{by} травит {heroAcc} в переписке: десятки злых сообщений, скриншоты, голосовые с издёвками', trace: 'травля в переписке' },
    ],
    3: [
      { text: '{by} толкает {heroAcc} в коридоре так, что {heroNom} едва удерживается на ногах', trace: 'ушиб после толчка' },
      { text: '{by} ставит подножку на лестнице, и {heroNom} с грохотом падает на глазах у всех', trace: 'ссадины после падения' },
      { text: '{by} зажимает {heroAcc} в углу, не давая уйти: толчки, пинки, шипение в лицо', trace: 'синяки после угла' },
      { text: '{by} запирает {heroAcc} снаружи в подсобке, и {heroNom} долго колотит в дверь', trace: 'час взаперти' },
      { text: '{by} отбирает вещь {heroGen} силой, выкручивая {heroDat} руку', trace: 'выкрученная рука' },
    ],
    4: [
      { text: '{by} бьёт {heroAcc} — коротко, зло, в живот и по лицу, пока никто не вмешался', trace: 'синяк на скуле и разбитая губа' },
      { text: '{by} избивает {heroAcc} за зданием: ногами, пока {heroNom} не перестаёт сопротивляться', trace: 'ушибы по всему телу' },
      { text: '{by} с размаху бьёт {heroAcc} головой о стену', trace: 'ссадина на лбу и головная боль' },
      { text: '{by} подводит {heroAcc} под отчисление: обвинение серьёзное, а доказательства подложены', trace: 'обвинение с угрозой отчисления' },
    ],
  },
  attempt: 'Сегодня {by} попытается надавить на {heroAcc}. {pressure}',
  attemptEx: 'Сегодня {by} попытается надавить на {heroAcc}. {pressure} Для духа, не дословно: «{act}»',
  pressure: {
    0: 'Давление лёгкое: насмешка, прозвище, шёпот за спиной.',
    1: 'Давление открытое: грубость и оскорбления в лицо, бойкот, выставить из компании.',
    2: 'Давление серьёзное: порча или кража вещей, подстава перед наставником, публичное унижение, слух, травля в переписке.',
    3: 'Давление с рукоприкладством: толчки, подножки, зажать в углу, запереть, отобрать вещь силой.',
    4: 'Давление самое тяжёлое: для одного это избиение, для другого — подстава с угрозой отчисления; выбери то, что в духе зачинщика.',
  },
  assumedAct: '{by} давит на {heroAcc}',
  hook: 'Обязательно в этом ответе (заметка режиссёра, не цитируй её). {attempt}{motive}{methods}{limits}{response}{revenge}{avoid}{fresh}{crew} Выбери форму сам, по месту и по тому, кто рядом. Покажи попытку прямо и подробностями, а не пересказом в одну фразу: если {by} и {hero} рядом — в сцене, если нет — коротким эпизодом, сообщением или рассказом свидетелей. Если зачинщику сейчас не быть рядом (наказание, изолятор, отъезд), пусть это сделают подручные или случится позже. Удастся попытка или сорвётся, решают обстоятельства, вмешательство других и ответ {heroGen}; слова и решения {heroGen} оставь игроку.{trace}{extra}',
  motive: ' Мотив: {motive}.',
  methods: ' Способы (выбери подходящий, не все сразу): {methods}.',
  limits: ' Чего не сделает: {limits}.',
  avoid: ' Не повторяй прошлые: {avoid}.',
  fresh: ' {by} — новый для {heroGen} человек: введи как незнакомое лицо, а не давнее знакомство.',
  crew: ' Подручные ({crew}) и безымянные приятели зачинщика могут действовать по наводке.',
  crewNone: ' Подручные и безымянные приятели зачинщика могут действовать по наводке.',
  trace: ' Последствия прошлых актов остаются и помнятся дальше: {trace}.',
  hidden: ' Всё происходит втихую, вне глаз взрослых.',
  afterPeace: ' Перемирие не в счёт: {by} возвращается к старому.',
  response: ' Первый отпор {heroGen} давление не прекращает: {by} продолжает в своём стиле{style}. Отступить {by} может лишь вынужденно: проиграл стычку, испугался последствий, вмешались другие.',
  revenge: ' После мести {heroGen} эта попытка не слабее прежнего накала, в стиле {by}.',
  taboo: ' Не использовать: {taboo}.',
  core: 'травля: {by} — {act}',
  plate: 'травля: {by} — {act}',
  status: {
    0: '{by} задирает {heroAcc}: прозвища, насмешки за спиной',
    1: '{by} травит {heroAcc}: оскорбления, бойкот',
    2: '{by} травит {heroAcc} всерьёз: портит вещи, подставляет, пускает слухи',
    3: '{by} травит {heroAcc} с рукоприкладством: толчки, подножки, запертые двери, вещи силой',
    4: '{by} избивает {heroAcc} и подводит под отчисление',
  },
  statusCrew: 'подпевают {crew}',
  statusAlly: 'за {heroAcc} заступается {ally}',
  statusTrace: 'ещё заметно: {trace}',
  statusHidden: 'теперь втихую, вне глаз взрослых',
  statusTruce: 'затишье после перемирия',
  debt: 'ответить за случившееся — {trace}',
  complainDebt: 'разобраться с травлей',
  talk: {
    low: [
      '{by} снова за своё. Сколько можно.',
      'Видели, что опять было? {by} и {hero}, снова. Жалко смотреть.',
      'Держись, {hero}. {by} просто развлекается.',
    ],
    mid: [
      'Все видели, что опять было? {hero}, ты как? Это уже не шутки.',
      '{hero} — опять {by}. Хоть кто-нибудь это остановит?',
      'Это перебор, {by}. {hero}, держись.',
    ],
    high: [
      'Вы видели, что творится? {hero}, ты в порядке? Там серьёзно.',
      'Да сделайте уже что-нибудь! {by} за чертой. {hero}, это уже не шутки.',
      'Дальше так нельзя. {by} уже за чертой, {hero}, мы с тобой.',
    ],
    defend: [
      'Хватит, {by}. Не стыдно?',
      '{by}, хватит. Я всё видел{a}, и молчать не буду.',
    ],
    hidden: ['Говорят, там опять что-то было: {by} и {hero}. Подробностей никто не знает.'],
    echo: [
      'Подтверждаю, я был{a} рядом. Это уже за гранью.',
      '{hero}, держись. Мы всё видели.',
      'Я тоже видел{a}. Почему все молчат?',
    ],
  },
};

export const BULLY_MOVE_WORDS = {
  f: {
    fightback: '{hero} дала отпор: {by}', ignore: '{hero} сделала вид, что не замечает травли', complain: '{hero} пожаловалась наставнику',
    ally: '{hero} нашла союзника: {with}', revenge: '{hero} отомстила: {by}', peace: '{hero} заключила перемирие: {by}', backoff: '{by} вынужденно отступил',
  },
  m: {
    fightback: '{hero} дал отпор: {by}', ignore: '{hero} сделал вид, что не замечает травли', complain: '{hero} пожаловался наставнику',
    ally: '{hero} нашёл союзника: {with}', revenge: '{hero} отомстил: {by}', peace: '{hero} заключил перемирие: {by}', backoff: '{by} вынужденно отступил',
  },
};

export const BULLY_LEVEL_WORDS = ['насмешки', 'оскорбления', 'порча и подставы', 'рукоприкладство', 'избиение'];

export const BULLY_MOVE_ALIASES = {
  fightback: 'fightback', отпор: 'fightback', complain: 'complain', жалоба: 'complain', ally: 'ally', союзник: 'ally',
  ignore: 'ignore', игнор: 'ignore', revenge: 'revenge', месть: 'revenge', peace: 'peace', truce: 'peace', мир: 'peace', перемирие: 'peace',
  примирение: 'peace', backoff: 'backoff', отступление: 'backoff', отступил: 'backoff',
};

export const BULLY_MOVE_LABELS = {
  fightback: 'отпор', complain: 'жалоба наставнику', ally: 'союзник', ignore: 'игнор', revenge: 'месть', peace: 'перемирие', backoff: 'задира отступил',
};

export const BULLY_HEAT_HELP = [
  'Накал показывает, насколько далеко зашла травля, а не исход отдельной стычки.',
  'Каждые два учебных дня с давлением без серьёзного отступления повышают его на один.',
  'Отпор сам по себе число не меняет: важно, удалось ли действительно остановить задиру.',
  'Два подтверждённых отступления подряд снижают накал на один.',
  'После перехода к дракам накал не падает ниже 2, пока не наступит перемирие.',
];

export const BULLY_LEVEL_HINTS = [
  '0 — прозвище, насмешки за спиной, смешки при ответе',
  '1 — оскорбления в лицо, бойкот, «место занято», вышвырнули из чата',
  '2 — испорченные или украденные вещи, подстава перед наставником, публичное унижение, грязный слух, травля в переписке',
  '3 — толчки, подножки, зажали в углу, заперли, отобрали вещь силой',
  '4 — избиение, серьёзная подстава с угрозой отчисления',
];

const fill = (t, v) => String(t || '').replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k]) : m));
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const phrasesOf = (preset) => {
  const raw = preset && preset.phrases && preset.phrases.bullying;
  const own = isObj(raw) ? raw : {};
  const acts = { ...BULLY_PHRASES.acts };
  for (const [k, v] of Object.entries(isObj(own.acts) ? own.acts : {})) if (Array.isArray(v) && v.length) acts[k] = v;
  const talk = { ...BULLY_PHRASES.talk };
  for (const [k, v] of Object.entries(isObj(own.talk) ? own.talk : {})) if (Array.isArray(v) && v.every((x) => typeof x === 'string')) talk[k] = v;
  return { ...BULLY_PHRASES, ...own, acts, status: { ...BULLY_PHRASES.status, ...(isObj(own.status) ? own.status : {}) }, pressure: { ...BULLY_PHRASES.pressure, ...(isObj(own.pressure) ? own.pressure : {}) }, talk };
};
const trim = (s) => String(s || '').replace(/[\s.;,]+$/u, '');
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export const bullyingOf = (state) => normalizeBullying(state && state.bullying);

export const bullyingOn = (state) => bullyingOf(state).on;

const people = (state) => (Array.isArray(state && state.classmates) ? state.classmates : []).filter((c) => c && c.id);
const personById = (state, id) => people(state).find((c) => c.id === id) || null;
const nameOf = (state, id) => { const p = personById(state, id); return p ? shortName(p.name || p.id) : id; };

function varsOf(state, opts = {}, extra = {}) {
  const W = heroWords(heroGender(state, opts.heroine));
  return {
    hero: String(opts.heroine || '').trim() || W.hero, heroNom: W.hero, heroAcc: W.heroAcc, heroDat: W.heroDat, heroGen: W.heroGen, heroIns: W.heroIns, her: W.her,
    ...extra,
  };
}

const genderA = (state, id) => {
  const p = personById(state, id);
  return genderOfName(p && p.name) === 'f' ? 'а' : '';
};

function seedWeight(person, preset) {
  const seed = String((person && person.seed) || '');
  if (!seed) return 0;
  const own = (((preset && preset.phrases) || {}).bullying || {}).seeds;
  if (Array.isArray(own) && own.some((s) => typeof s === 'string' && s && seed.toLowerCase().includes(s.toLowerCase()))) return 3;
  return SEED_STRONG.test(seed) ? 3 : SEED_WEAK.test(seed) ? 1 : 0;
}

export function skipIds(state) {
  const words = String(bullyingOf(state).skip || '').split(/[,;\n]+/).map((w) => normName(w)).filter(Boolean);
  if (!words.length) return [];
  const all = people(state);
  const parts = (c) => normName(c.name).split(' ').filter((t) => t.length > 2);
  return all.filter((c) => words.some((w) => [c.id, c.name, shortName(c.name), ...(c.aliases || [])].some((n) => normName(n) === w)
    || (!w.includes(' ') && parts(c).includes(w) && all.filter((o) => parts(o).includes(w)).length === 1))).map((c) => c.id);
}

function ranked(state, preset, exclude = [], prefer = []) {
  const start = classmateStart(preset);
  const skip = skipIds(state);
  const all = people(state)
    .filter((c) => !exclude.includes(c.id) && !skip.includes(c.id))
    .map((c) => ({ c, w: seedWeight(c, preset), r: relationOf(state, c.id), p: prefer.includes(c.id) ? 1 : 0 }))
    .filter(({ r }) => r <= start);
  const strong = all.filter(({ w, r, p }) => w > 0 || r < start || p);
  return (strong.length ? strong : all)
    .sort((x, y) => (y.p - x.p) || (y.w - x.w) || (x.r - y.r) || (x.c.id < y.c.id ? -1 : 1))
    .map(({ c }) => c.id);
}

export function crewEligible(state, preset, c, allies = []) {
  if (!c) return false;
  const r = relationOf(state, c.id), start = classmateStart(preset);
  if (r < start) return true;
  if (r > start) return false;
  return ['недолюбливает', 'враг', 'задира'].includes(normalizeToHero(c.toHero)) || seedWeight(c, preset) > 0 || c.source === 'npc' || allies.includes(c.id);
}

const crewSize = (heat) => (heat >= 2 ? 2 : heat >= 1 ? 1 : 0);

const pickLead = (next, b) => (b.pick && personById(next, b.pick.id) ? b.pick.id : '');

function settleRoles(next, b, preset) {
  const ids = new Set(people(next).map((c) => c.id));
  if (b.pick && !ids.has(b.pick.id)) {
    Object.assign(b, { pick: null, pickState: '', pickKey: '', pickDay: '' });
    if (!b.manual) b.lead = '';
  }
  if (b.lead && !ids.has(b.lead)) { b.lead = ''; b.manual = false; }
  const allies = b.pick && b.pick.id === b.lead ? b.pick.allies.map((w) => resolveBully(next, w)).filter(Boolean) : [];
  b.crew = b.crew.filter((id) => ids.has(id) && id !== b.lead && id !== b.ally
    && (b.manual || crewEligible(next, preset, personById(next, id), allies)));
  if (!b.manual) {
    const picked = pickLead(next, b);
    if (picked) b.lead = picked;
    else if (b.mode === 'self' || b.pickState === 'none' || b.pickState === 'denied') b.lead = '';
    else if (!b.lead) b.lead = ranked(next, preset, b.crew)[0] || '';
  }
  if (b.lead && !b.manual) {
    const want = crewSize(b.heat);
    for (const id of ranked(next, preset, [b.lead, b.ally, ...b.crew], allies)) {
      if (!crewEligible(next, preset, personById(next, id), allies)) continue;
      if (b.crew.length >= want) break;
      b.crew.push(id);
    }
  }
  if (b.pending && b.pending.by !== b.lead) b.pending = null;
}

export function bullyRole(state, id) {
  const b = bullyingOf(state);
  return b.lead === id ? 'lead' : b.crew.includes(id) ? 'crew' : '';
}

function unpick(state, b, personId) {
  if (!b.pick || b.pick.id !== personId) return;
  const name = nameOf(state, personId);
  if (!skipIds({ ...state, bullying: b }).includes(personId)) b.skip = [b.skip, name].filter(Boolean).join(', ').slice(0, BULLYING_MAX.skip);
  dropPick(b);
}

export function setBullyRole(state, personId, role) {
  if (!personById(state, personId)) return { ok: false, state, error: 'такого человека нет' };
  if (!['lead', 'crew', ''].includes(role)) return { ok: false, state, error: 'роль — зачинщик, подпевала или снять' };
  const next = cloneState(state);
  const b = bullyingOf(next);
  if (role === 'lead') {
    b.crew = b.crew.filter((id) => id !== personId);
    if (b.lead && b.lead !== personId) b.crew = [b.lead, ...b.crew].slice(0, BULLYING_MAX.crew);
    b.lead = personId;
    b.manual = true;
  } else if (role === 'crew') {
    if (b.lead === personId) { b.lead = ''; unpick(next, b, personId); }
    b.crew = [...b.crew.filter((id) => id !== personId), personId].slice(-BULLYING_MAX.crew);
    b.manual = true;
  } else {
    if (b.lead === personId) { b.lead = ''; b.manual = false; unpick(next, b, personId); }
    b.crew = b.crew.filter((id) => id !== personId);
  }
  b.pending = b.pending && b.lead === b.pending.by ? b.pending : null;
  next.bullying = normalizeBullying(b);
  return { ok: true, state: next };
}

function dropPick(b) {
  Object.assign(b, { pick: null, pickState: '', pickKey: '', pickDay: '' });
  if (!b.manual) { b.lead = ''; b.crew = []; b.pending = null; }
}

export function setBullyingOptions(state, { on, taboo, mode, npcOk, skip } = {}) {
  const next = cloneState(state);
  const b = bullyingOf(next);
  if (typeof on === 'boolean') {
    b.on = on;
    if (!on) b.pending = null;
  }
  if (typeof taboo === 'string') b.taboo = taboo;
  if ((mode === 'auto' || mode === 'self') && mode !== b.mode) {
    b.mode = mode;
    b.pickState = '';
    b.pickKey = '';
    if (mode === 'self' && !b.manual) Object.assign(b, { lead: '', crew: [], pending: null });
  }
  if (typeof npcOk === 'boolean' && npcOk !== b.npcOk) {
    b.npcOk = npcOk;
    if (b.pickState === 'denied' || (b.pickState === 'none' && npcOk)) { b.pickState = ''; b.pickKey = ''; }
  }
  if (typeof skip === 'string' && skip.trim() !== b.skip) {
    b.skip = skip;
    next.bullying = normalizeBullying(b);
    if (b.pick && skipIds(next).includes(b.pick.id)) dropPick(b);
    else { b.pickKey = ''; if (b.pickState === 'none' || b.pickState === 'denied') b.pickState = ''; }
  }
  next.bullying = normalizeBullying(b);
  return next;
}

export function resetBullyPick(state) {
  const next = cloneState(state);
  const b = bullyingOf(next);
  b.past = [...(b.past || []), b.pick && b.pick.id, !b.manual && b.lead].filter(Boolean);
  dropPick(b);
  next.bullying = normalizeBullying(b);
  return next;
}

export function bullyTabooLine(state) {
  const t = bullyingOf(state).taboo;
  return t ? `Не использовать: ${trim(t)}.` : '';
}

export function carryBullying(live, before) {
  if (!before || typeof before !== 'object' || !live || live.bullying === undefined) return before;
  const mine = bullyingOf(live);
  const was = bullyingOf(before);
  const next = {
    ...was, on: mine.on, taboo: mine.taboo, mode: mine.mode, npcOk: mine.npcOk, skip: mine.skip,
    pick: mine.pick, pickState: mine.pickState, pickKey: mine.pickKey, pickDay: mine.pickDay,
  };
  if (!mine.manual && !was.manual) next.lead = mine.lead;
  if (mine.manual) Object.assign(next, { lead: mine.lead, crew: mine.crew, manual: true });
  else if (was.manual) Object.assign(next, { manual: false });
  if (JSON.stringify(next) === JSON.stringify(was) && before.bullying !== undefined) return before;
  return { ...before, bullying: normalizeBullying(next) };
}

function actVariants(preset, level) {
  const list = phrasesOf(preset).acts[level] || [];
  return list.map((a, i) => (typeof a === 'string' ? { text: a, trace: '', kind: `${level}.${i}` } : { text: String((a && a.text) || ''), trace: String((a && a.trace) || ''), kind: `${level}.${i}` })).filter((a) => a.text);
}

function studyDaysBetween(state, preset, from, to) {
  let n = 0;
  for (let d = addDays(from, 1), i = 0; d < to && i < 14; d = addDays(d, 1), i += 1) if (dayPlan(state, preset, d).length) n += 1;
  return n;
}

function levelFor(heat, r) {
  const row = BULLY_MIX[Math.min(Math.max(heat, 0), 4)];
  let acc = 0;
  const total = row.reduce((s, x) => s + x, 0);
  for (let i = 0; i < row.length; i += 1) {
    acc += row[i];
    if (r * total < acc) return i;
  }
  return row.length - 1;
}

function rollAct(state, preset, b, day, seed) {
  if (!b.lead || b.last === day || b.asked === day || (b.truce && day <= b.truce)) return null;
  if (!dayPlan(state, preset, day).length) return null;
  const rng = seededRng(`${seed}|bully|${day}`);
  const forced = !b.last || studyDaysBetween(state, preset, b.last, day) >= 1;
  if (!forced && rng() * 100 >= BULLY_CHANCE[b.heat]) return null;
  const level = Math.max(levelFor(b.heat, rng()), b.rev ? b.heat : 0);
  if (b.pick && b.pick.id === b.lead) return { level, kind: 'pick', trace: '', example: '' };
  const list = actVariants(preset, level);
  if (!list.length) return null;
  const recent = b.acts.slice(-3);
  const pool = list.filter((a) => !recent.some((r) => r.kind === a.kind || r.text === a.text));
  const from = pool.length ? pool : list.filter((a) => a.kind !== (recent.length ? recent[recent.length - 1].kind : ''));
  const chosen = (from.length ? from : list)[Math.floor(rng() * (from.length || list.length))];
  return { level, ...chosen, example: chosen.text };
}

const tryWord = (preset, level) => {
  const own = (((preset && preset.phrases) || {}).bullying || {}).levelWords;
  return `попытка, ${(Array.isArray(own) && own[level]) || BULLY_LEVEL_WORDS[level] || ''}`;
};

function actWords(state, preset, roll, by, opts) {
  const P = phrasesOf(preset);
  const v = varsOf(state, opts, { by: nameOf(state, by) });
  const pressure = (P.pressure && P.pressure[roll.level]) || '';
  return trim(fill(roll.example ? P.attemptEx : P.attempt, { ...v, pressure, act: trim(fill(roll.example, v)) })).slice(0, BULLYING_MAX.text);
}

const nameSaid = (text, names) => {
  const t = String(text || '').toLowerCase();
  if (!t) return false;
  const words = names.flatMap((n) => String(n || '').toLowerCase().split(/[\s.,-]+/u)).filter((w) => w.length >= 4);
  return words.some((w) => t.includes(w.length > 5 ? w.slice(0, -2) : w));
};

const namesOf = (state, id) => { const p = personById(state, id); return p ? [p.name, shortName(p.name || p.id)].filter(Boolean) : [id]; };

export function clauseOf(text, names) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const hit = [...names].sort((x, y) => y.length - x.length).find((n) => n && t.toLowerCase().startsWith(n.toLowerCase()));
  return hit ? t.slice(hit.length).replace(/^\s*[:—–,-]\s*/u, '').trim() : t;
}

export function deedOf(text, names) {
  const clause = clauseOf(text, names);
  if (!clause) return '';
  const who = names[names.length - 1] || '';
  const plural = /^[а-яё]{4,}ли(?:сь)?(?![а-яё])/iu.test(clause);
  return `${who}${plural && who ? ' с подручными' : ''} ${clause}`.trim();
}

export function bullyHookWords(state, preset, opts = {}) {
  const b = bullyingOf(state);
  const p = b.pending;
  if (!p) return null;
  const P = phrasesOf(preset);
  const v = varsOf(state, opts, { by: nameOf(state, p.by) });
  const pressure = (P.pressure && P.pressure[p.level]) || '';
  const attempt = p.att ? trim(fill(p.text, v)) : trim(fill(P.attemptEx, { ...v, pressure, act: trim(fill(p.text, v)) }));
  const pick = b.pick && b.pick.id === p.by ? b.pick : null;
  const names = namesOf(state, p.by);
  const avoid = [...new Set(b.acts.slice(-3).map((a) => clauseOf(fill(a.text, v), names).slice(0, 90)).filter(Boolean))];
  const list = (xs) => xs.map(trim).filter(Boolean).join('; ');
  const crew = p.crew.map((id) => nameOf(state, id));
  const extra = (p.hidden ? P.hidden : '') + (p.afterPeace ? fill(P.afterPeace, v) : '');
  const style = pick && pick.responseStyle ? `: ${trim(pick.responseStyle)}` : '';
  const taboo = b.taboo ? fill(P.taboo, { taboo: trim(b.taboo) }) : '';
  const body = fill(P.hook, {
    ...v, attempt: `${attempt}.`,
    motive: pick ? fill(P.motive, { motive: trim(pick.motive) }) : '',
    methods: pick && pick.methods.length ? fill(P.methods, { methods: list(pick.methods) }) : '',
    limits: pick && pick.limits.length ? fill(P.limits, { limits: list(pick.limits) }) : '',
    response: fill(P.response, { ...v, style }),
    revenge: p.rev ? fill(P.revenge, v) : '',
    avoid: avoid.length ? fill(P.avoid, { avoid: avoid.join('; ') }) : '',
    fresh: pick && pick.fresh ? fill(P.fresh, v) : '',
    crew: crew.length ? fill(P.crew, { ...v, crew: crew.join(', ') }) : fill(P.crewNone, v),
    trace: p.trace ? fill(P.trace, { trace: p.trace }) : '', extra,
  }).replace(/\s+/g, ' ').trim();
  const text = body.slice(0, Math.max(0, HOOK_MAX - taboo.length)).trim() + taboo;
  return {
    core: fill(P.core, { ...v, act: tryWord(preset, p.level) }).slice(0, 320),
    text,
    plate: fill(P.plate, { ...v, act: tryWord(preset, p.level) }).slice(0, 320),
  };
}

export function bullyTokens(tokens) {
  const out = [];
  for (const t of Array.isArray(tokens) ? tokens : []) {
    const e = parseBullyToken(t);
    if (e) out.push(e);
  }
  return out;
}

export const isBullyToken = (token) => /^bully=/.test(String(token || ''));

export function parseBullyToken(token) {
  if (!isBullyToken(token)) return null;
  const parts = String(token).slice(6).split(':');
  const who = (parts[0] || '').trim();
  if (!who) return null;
  if (who === HEROINE || who === BULLY) {
    const kind = (parts[1] || '').trim();
    return BULLY_MOVES.includes(kind) && (kind === 'backoff') === (who === BULLY) ? { type: 'move', kind, with: (parts[2] || '').trim() } : null;
  }
  const level = Number(parts[1]);
  if (!Number.isInteger(level) || level < 0 || level > BULLYING_MAX.heat) return null;
  return { type: 'act', by: who, level, text: parts.slice(2).join(':').trim() };
}

export function bullyTokenOf(e) {
  if (!e) return null;
  if (e.type === 'move') return `bully=${e.kind === 'backoff' ? BULLY : HEROINE}:${e.kind}${e.with ? `:${e.with}` : ''}`;
  const text = String(e.text || '').replace(/-->|[=[\]<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  return `bully=${e.by}:${e.level}${text ? `:${text}` : ''}`;
}

export function bullyTokenText(token, people, heroine, gender, preset) {
  const e = parseBullyToken(token);
  if (!e) return String(token);
  const own = (preset && preset.phrases && preset.phrases.bullying) || {};
  const nameIn = (id) => {
    const p = (people || []).find((x) => x && x.id === id);
    return p ? shortName(p.name || p.id) : id;
  };
  if (e.type === 'move') {
    const label = (own.moveLabels && own.moveLabels[e.kind]) || BULLY_MOVE_LABELS[e.kind];
    return `травля, ход ${heroine || heroWords(gender).hero}: ${label}${e.with ? ` (${nameIn(e.with)})` : ''}`;
  }
  const word = (Array.isArray(own.levelWords) && own.levelWords[e.level]) || BULLY_LEVEL_WORDS[e.level];
  return `травля, ${word}: ${nameIn(e.by)}${e.text ? ` — ${e.text}` : ''}`;
}

function logMove(next, b, preset, move, day, opts, by) {
  if (b.moves.some((m) => m.day === day && m.kind === move.kind)) return;
  b.moves = [...b.moves, { day, kind: move.kind, with: move.with || '' }].slice(-BULLYING_MAX.moves);
  const P = phrasesOf(preset);
  const g = heroGender(next, opts.heroine);
  const words = ((P.moves && P.moves[move.kind]) || BULLY_MOVE_WORDS[g][move.kind] || '');
  const line = fill(words, varsOf(next, opts, { by: nameOf(next, by), with: nameOf(next, move.with) }));
  pushJournal(next, { kind: 'bully', text: `bully move ${move.kind}`, data: { move: move.kind, by, with: move.with || '', line: cap(trim(line)) } }, preset);
}

function setHeat(b, to, day, why) {
  const heat = Math.min(BULLYING_MAX.heat, Math.max(bullyFloor(b.peak), to));
  b.change = { day, from: b.heat, to: heat, why };
  b.heat = heat;
  b.peak = Math.max(b.peak, heat);
  b.press = 0;
  b.back = 0;
}

function episodeOf(b, day) {
  if (!b.ep || b.ep.day !== day) b.ep = { day, tried: false, max: 0, backed: false };
  return b.ep;
}

function closeEpisode(b, day) {
  const e = b.ep;
  if (!e || e.day >= day) return;
  b.ep = null;
  if (!e.tried) return;
  if (e.backed) {
    if (e.max < b.heat) return;
    b.back += 1;
    if (b.back >= BULLY_BACK_DAYS) setHeat(b, b.heat - 1, e.day, 'backoff');
    return;
  }
  b.back = 0;
  b.press += 1;
  if (b.press >= BULLY_GROW_DAYS) setHeat(b, b.heat + 1, e.day, 'press');
}

function applyMove(next, b, preset, move, day, opts) {
  const by = b.lead;
  let withId = '';
  if (move.kind === 'fightback') {
    if (!b.fought) b.fought = day;
  } else if (move.kind === 'complain') {
    b.hidden = addDays(day, BULLY_HIDE_DAYS);
    const teacher = (next.teachers || []).find((t) => t && t.id === move.with);
    if (teacher && by) {
      withId = teacher.id;
      openDeal(next, { a: teacher.id, b: HEROINE, what: phrasesOf(preset).complainDebt, src: `bully:${b.n}`, day });
    }
  } else if (move.kind === 'ally') {
    const friend = personById(next, move.with);
    if (friend && friend.id !== by) {
      withId = friend.id;
      b.ally = friend.id;
      postDefender(next, b, preset, day, opts);
    }
  } else if (move.kind === 'revenge') {
    b.rev = true;
  } else if (move.kind === 'peace') {
    setHeat(b, b.heat - 2, day, 'truce');
    b.ep = null;
    b.rev = false;
    b.truce = addDays(day, BULLY_TRUCE_DAYS);
    b.afterPeace = true;
    b.pending = null;
  } else if (move.kind === 'backoff') {
    episodeOf(b, day).backed = true;
    b.rev = false;
  }
  logMove(next, b, preset, { ...move, with: withId || move.with }, day, opts, by);
}

const hashOf = (s) => Math.floor(seededRng(s)() * 1e9);

function witnesses(state, b, preset, act, line, seedKey, max) {
  const skip = new Set([b.lead, ...b.crew, act.by]);
  const low = String(line || '').toLowerCase();
  const start = classmateStart(preset);
  const hostile = (c) => relationOf(state, c.id) < start || ['недолюбливает', 'враг', 'задира'].includes(normalizeToHero(c.toHero));
  const named = (c) => [c.name, shortName(c.name || '')].some((n) => n && n.length > 2 && low.includes(n.toLowerCase()));
  return people(state).filter((c) => !skip.has(c.id) && !hostile(c) && !named(c)).sort((x, y) => hashOf(`${seedKey}|${x.id}`) - hashOf(`${seedKey}|${y.id}`)).slice(0, max);
}

function postDefender(next, b, preset, day, opts) {
  const ally = personById(next, b.ally);
  if (!ally || !b.lead || opts.voices) return;
  const P = phrasesOf(preset);
  const list = P.talk.defend || [];
  if (!list.length) return;
  const text = fill(list[hashOf(`${b.ally}|${b.n}`) % list.length], varsOf(next, opts, { by: nameOf(next, b.lead), a: genderA(next, ally.id) }));
  addFeedItem(next, {
    id: `bully-ally-${b.n}`, src: `bully:ally${b.n}`, at: { day, time: '' }, kind: 'reaction', who: ally.id, chan: 'chat',
    text, about: [b.lead, HEROINE], heroine: true, loud: 1, status: 'played', read: false,
  });
}

const textKey = (t) => String(t || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function freshLine(pool, seed, vars, taken) {
  const start = hashOf(seed) % pool.length;
  for (let k = 0; k < pool.length; k += 1) {
    const text = fill(pool[(start + k) % pool.length], vars);
    const key = textKey(text);
    if (key && !taken.some((t) => t === key || (Math.min(t.length, key.length) >= 24 && (t.includes(key) || key.includes(t))))) {
      taken.push(key);
      return text;
    }
  }
  return '';
}

function placeAct(next, b, preset, act, opts) {
  const day = act.day;
  const P = phrasesOf(preset);
  const v = varsOf(next, opts, { by: nameOf(next, act.by) });
  const names = namesOf(next, act.by);
  const line = trim(deedOf(fill(act.text, v), names));
  const loud = act.level >= 3 ? 3 : act.level >= 2 ? 2 : 1;
  const src = `bully:${act.id}`;
  const factId = `bully-${act.id}`;
  const taken = ensureFeed(next).items.map((x) => textKey(x.text));
  addFeedItem(next, {
    id: factId, src, at: { day, time: '' }, factRef: `bully=${act.by}:${act.level}`, kind: 'fact', chan: 'chat',
    text: cap(line), gist: line, rumor: false, truth: null, about: [act.by, HEROINE], heroine: true, loud,
    status: 'played', ...(act.hidden ? { private: true } : {}),
  });
  const tier = act.level >= 3 ? 'high' : act.level >= 2 ? 'mid' : 'low';
  const trace = act.trace || clauseOf(line, names).slice(0, 80);
  const deed = cap(line);
  if (act.hidden) {
    const hid = P.talk.hidden || [];
    if (hid.length) {
      addFeedItem(next, {
        id: `${factId}#1`, src, at: { day, time: '' }, factRef: `bully=${act.by}:${act.level}`, kind: 'reaction', chan: 'anon',
        text: fill(hid[0], { ...v, deed }), about: [act.by, HEROINE], heroine: true, loud: 1, factText: line,
      });
    }
  } else if (!opts.voices) {
    const pool = P.talk[tier] || [];
    const crowd = witnesses(next, b, preset, act, line, factId, tier === 'high' ? 3 : 1);
    const echo = P.talk.echo || [];
    let n = 0;
    crowd.forEach((w) => {
      const list = n ? echo : pool;
      if (!list.length) return;
      const text = freshLine(list, `${factId}|${w.id}`, { ...v, trace, deed, a: genderA(next, w.id) }, taken);
      if (!text) return;
      n += 1;
      addFeedItem(next, {
        id: `${factId}#${n}`, src, at: { day, time: '' }, factRef: `bully=${act.by}:${act.level}`, kind: 'reaction', who: w.id, chan: 'chat',
        text, about: [act.by, HEROINE], heroine: true, loud, factText: line, ...(n > 1 ? { parent: `${factId}#1` } : {}),
      });
    });
    const defend = P.talk.defend || [];
    const reply = n && defend.length && b.ally && personById(next, b.ally) && act.level >= 1
      ? freshLine(defend, `${factId}|d`, { ...v, a: genderA(next, b.ally) }, taken) : '';
    if (reply) {
      addFeedItem(next, {
        id: `${factId}^1`, src, at: { day, time: '' }, factRef: `bully=${act.by}:${act.level}`, kind: 'reaction', parent: `${factId}#1`,
        who: b.ally, chan: 'chat', text: reply, about: [act.by, HEROINE], heroine: true, loud, factText: line,
      });
    }
  }
  if (act.level >= 2 && act.trace) {
    openDeal(next, { a: act.by, b: HEROINE, what: fill(P.debt, { trace: act.trace }), src, day });
  }
  if (act.level >= 2) {
    pushJournal(next, { kind: 'bully', text: `bully L${act.level}`, data: { level: act.level, by: act.by, line: cap(line), trace: act.trace || '' } }, preset);
  }
}

function playAct(next, b, preset, act, opts) {
  b.acts = [...b.acts, {
    id: act.id, day: act.day, level: act.level, by: act.by, text: act.text, trace: act.trace || '', kind: act.kind || '',
    ...(act.assumed ? { assumed: true } : {}),
  }].slice(-BULLYING_MAX.acts);
  b.last = act.day;
  if (b.pick && b.pick.fresh && b.pick.id === act.by) delete b.pick.fresh;
  const ep = episodeOf(b, act.day);
  ep.tried = true;
  ep.max = Math.max(ep.max, act.level);
  b.afterPeace = false;
  if (!act.assumed) placeAct(next, b, preset, act, opts);
}

export function stepBullying(state, preset, opts = {}) {
  const none = { state, played: [], resolved: '', planned: null };
  const had = state && state.bullying !== undefined;
  const existing = bullyingOf(state);
  if (!state || !state.started || !existing.on) return none;
  if (!had && !people(state).length) return none;
  const next = cloneState(state);
  const b = bullyingOf(next);
  const day = next.calendar && next.calendar.day;
  if (!day) return none;
  const seed = String(opts.seed || '');
  const tokens = Array.isArray(opts.tokens) ? opts.tokens : null;
  const played = [];
  let resolved = '';
  b.n += 1;
  settleRoles(next, b, preset);
  const parsed = bullyTokens(tokens);

  closeEpisode(b, day);
  if (b.hidden && day > b.hidden) b.hidden = '';
  if (b.truce && day > b.truce) b.truce = '';

  const p = b.pending;
  let acts = parsed.filter((e) => e.type === 'act');
  const fragment = tokens === null ? '' : `${opts.said || ''}
${opts.text || ''}`.trim();
  const inScene = (id) => !fragment || nameSaid(fragment, namesOf(next, id));
  const present = Boolean(p) && [p.by, ...p.crew].some(inScene);
  const matches = (e) => present && (e.by === p.by || resolveBully(next, e.by) === p.by || p.crew.includes(resolveBully(next, e.by)));
  if (p) {
    const said = present && ((Array.isArray(opts.playedIds) && opts.playedIds.includes(p.hookId)) || acts.some(matches));
    const gone = diffDays(p.day, day) >= 2;
    if (said || (tokens === null && opts.sounded !== false)) {
      const told = acts.find((e) => matches(e) && e.text);
      const v = varsOf(next, opts, { by: nameOf(next, p.by) });
      const names = namesOf(next, p.by);
      const level = told ? told.level : p.level;
      const text = told ? deedOf(told.text, names) : p.att ? (p.act || trim(fill(phrasesOf(preset).assumedAct, v))) : p.text;
      const trace = p.trace || (told && level >= 2 ? clauseOf(told.text, names).slice(0, 80) : '');
      const named = !said && tokens === null && nameSaid(opts.text, names);
      const act = { id: p.id, day: p.day, level, by: p.by, text, trace, kind: p.kind, hidden: p.hidden, assumed: !said && !named };
      playAct(next, b, preset, act, opts);
      played.push(act);
      resolved = p.hookId;
      b.pending = null;
      acts = acts.filter((e) => !matches(e));
    } else if (gone || p.tries + 1 >= BULLY_TRIES) {
      resolved = p.hookId;
      b.pending = null;
    } else if (tokens !== null) {
      p.tries += 1;
    }
  }

  for (const e of acts) {
    const by = resolveBully(next, e.by);
    if (!by || !e.text || !inScene(by) || b.acts.some((a) => a.day === day && a.by === by && a.level === e.level)) continue;
    const act = { id: `bu${b.n}x${played.length}`, day, level: e.level, by, text: deedOf(e.text, namesOf(next, by)), trace: '', kind: '', hidden: Boolean(b.hidden) && day <= b.hidden };
    playAct(next, b, preset, act, opts);
    played.push(act);
  }

  for (const m of parsed.filter((e) => e.type === 'move')) applyMove(next, b, preset, m, day, opts);

  let planned = null;
  if (!b.pending) {
    settleRoles(next, b, preset);
    const roll = rollAct(next, preset, b, day, seed);
    if (roll && b.lead) {
      b.pending = {
        id: `bu${b.n}`, hookId: `bul${b.n}`, day, level: roll.level, by: b.lead, crew: [...b.crew],
        text: actWords(next, preset, roll, b.lead, opts), att: true, act: roll.example ? trim(fill(roll.example, varsOf(next, opts, { by: nameOf(next, b.lead) }))) : '',
        trace: roll.trace, kind: roll.kind, tries: 0,
        hidden: Boolean(b.hidden) && day <= b.hidden, afterPeace: b.afterPeace, ...(b.rev ? { rev: true } : {}),
      };
      b.asked = day;
      b.rev = false;
      planned = b.pending;
    }
  }
  next.bullying = normalizeBullying(b);
  return { state: next, played, resolved, planned };
}

export function bullyStatus(state, preset, opts = {}) {
  const b = bullyingOf(state);
  const day = state && state.calendar && state.calendar.day;
  if (!b.on || !b.lead || !(b.acts.length || b.pending)) return '';
  const P = phrasesOf(preset);
  const v = varsOf(state, opts, { by: nameOf(state, b.lead) });
  const parts = [fill(P.status[Math.min(b.heat, 4)] || P.status[0], v)];
  const crew = b.crew.filter((id) => personById(state, id)).map((id) => nameOf(state, id));
  if (crew.length) parts.push(fill(P.statusCrew, { crew: crew.join(' и ') }));
  if (b.ally && personById(state, b.ally)) parts.push(fill(P.statusAlly, { ...v, ally: nameOf(state, b.ally) }));
  if (b.hidden && day && day <= b.hidden) parts.push(P.statusHidden);
  if (b.truce && day && day <= b.truce) parts.push(P.statusTruce);
  const traces = b.acts.filter((a) => a.trace && day && diffDays(a.day, day) >= 0 && diffDays(a.day, day) <= BULLY_TRACE_DAYS).map((a) => a.trace);
  const uniq = [...new Set(traces)].slice(-3);
  if (uniq.length) parts.push(fill(P.statusTrace, { trace: uniq.join('; ') }));
  return parts.join('; ');
}

export function bullyToday(state, preset, opts = {}) {
  const b = bullyingOf(state);
  const day = state && state.calendar && state.calendar.day;
  if (!b.on || !day) return null;
  const a = [...b.acts].reverse().find((x) => x.day === day && !x.assumed);
  if (!a) return null;
  const v = varsOf(state, opts, { by: nameOf(state, a.by) });
  return { id: a.id, level: a.level, who: nameOf(state, a.by), text: cap(trim(deedOf(fill(a.text, v), namesOf(state, a.by)))), hidden: Boolean(b.hidden && day <= b.hidden) };
}

const PICK_SOURCE_WORDS = { scene: 'из сцены', lore: 'из книги мира', canon: 'по канону', guess: 'предположение', npc: 'новый ученик' };

export function bullyingView(state, preset, opts = {}) {
  const b = bullyingOf(state);
  const day = state && state.calendar && state.calendar.day;
  const last = [...b.acts].reverse().find((a) => !a.assumed) || null;
  const lastAny = b.acts.length ? b.acts[b.acts.length - 1] : null;
  const v = varsOf(state, opts);
  const pick = b.pick && b.pick.id === b.lead ? b.pick : null;
  const word = (BULLY_LEVEL_WORDS[b.heat] || '');
  const ep = b.ep && b.ep.day === day ? b.ep : null;
  const fought = Boolean(day) && b.moves.some((m) => m.day === day && m.kind === 'fightback');
  const today = ep && ep.tried && ep.backed ? (ep.max >= b.heat ? 'backed' : 'weak') : fought ? 'fought' : '';
  return {
    on: b.on,
    taboo: b.taboo,
    mode: b.mode,
    npcOk: b.npcOk,
    skip: b.skip,
    available: Boolean(state && state.started),
    lead: b.lead ? nameOf(state, b.lead) : '',
    crew: b.crew.map((id) => nameOf(state, id)),
    manual: b.manual,
    why: pick ? { motive: pick.motive, source: PICK_SOURCE_WORDS[pick.source] || '', access: pick.access } : null,
    waiting: !b.lead && b.on && (b.mode === 'self' ? 'self' : b.pickState === 'none' || b.pickState === 'denied' ? 'none' : ''),
    heat: b.heat,
    heatWord: word,
    floor: bullyFloor(b.peak),
    grow: { have: b.press, need: BULLY_GROW_DAYS },
    shrink: { have: b.back + (today === 'backed' ? 1 : 0), need: BULLY_BACK_DAYS },
    today,
    change: b.change ? { ...b.change } : null,
    assumed: Boolean(lastAny && lastAny.assumed),
    help: BULLY_HEAT_HELP,
    hiddenUntil: b.hidden && day && day <= b.hidden ? b.hidden : '',
    truceUntil: b.truce && day && day <= b.truce ? b.truce : '',
    last: last ? { day: last.day, level: last.level, levelWord: BULLY_LEVEL_WORDS[last.level] || '', text: cap(trim(deedOf(fill(last.text, v), namesOf(state, last.by)))) } : null,
    pending: b.pending ? { day: b.pending.day, level: b.pending.level, text: b.pending.text } : null,
  };
}

export function bullyAnalysisActive(state) {
  const b = bullyingOf(state);
  return Boolean(state && b.on && people(state).length);
}

export function resolveBully(state, written) {
  const w = String(written || '').trim();
  if (!w) return '';
  const exact = people(state).find((c) => c.id === w || c.id.toLowerCase() === w.toLowerCase());
  if (exact) return exact.id;
  const key = normName(w);
  const byName = people(state).find((c) => normName(c.name) === key || normName(shortName(c.name)) === key);
  return byName ? byName.id : '';
}

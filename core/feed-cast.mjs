import { heroWords, presetGender } from './gender.mjs';
import {
  CAST_MAX, CAST_TEXT_MAX, TEMPER_MAX, ROLE_MAX, normalizeCastList, normalizeThreads, normalizeFeed, ensureFeed,
  feedExtras, feedManners, feedNickExamples, cleanNick, plain, cutWords,
} from './feed.mjs';
import { stopList, stopHit, normName } from './stop-names.mjs';
import { holidaysOf, eventsOf } from './holidays.mjs';
import { HEROINE } from './classmates.mjs';
import { subjectWord } from './words.mjs';
import { lastBlock, unlabel } from './leak.mjs';
import { SCENE_MAX, sceneFolk, mainsOfStop, loveOf, castLovesCard, pickCardLover, LOVE_RE } from './scene-folk.mjs';

export const CAST_PAUSE = { fails: 3, issues: 6 };

export function castAttempt(fails, { manual = false, pause = CAST_PAUSE } = {}) {
  const f = { n: Number(fails && fails.n) || 0, skipped: Number(fails && fails.skipped) || 0 };
  if (manual || f.n < pause.fails) return { go: true, fails: f };
  if (f.skipped + 1 >= pause.issues) return { go: true, fails: { n: f.n, skipped: 0 } };
  return { go: false, fails: { n: f.n, skipped: f.skipped + 1 } };
}

export const castResult = (fails, ok) => (ok ? { n: 0, skipped: 0 } : { n: ((fails && fails.n) || 0) + 1, skipped: 0 });

export const END_MARK = 'КОНЕЦ';

export const DIVERSE_FIELDS = ['type', 'interest', 'manner'];

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const oneLine = (v, max) => str(v).replace(/\s+/g, ' ').slice(0, max).trim();

export function castOf(state) {
  return normalizeFeed(state && state.feed).cast;
}

export function memberOf(state, id) {
  return castOf(state).find((m) => m.id === id) || null;
}

export function setCast(state, members, { keepThreads = false } = {}) {
  const feed = ensureFeed(state);
  feed.cast = normalizeCastList(members);
  feed.threads = keepThreads ? normalizeThreads(feed.threads, feed.cast) : [];
  return feed.cast;
}

export const EDITABLE = ['nick', 'type', 'interest', 'goal', 'manner', 'jealousy'];

export function updateMember(state, id, patch) {
  const feed = ensureFeed(state);
  const m = feed.cast.find((x) => x.id === id);
  if (!m) return { ok: false, error: 'Такого статиста в касте нет.' };
  const p = patch && typeof patch === 'object' ? patch : {};
  if (p.nick !== undefined) {
    const nick = cleanNick(p.nick);
    if (!nick) return { ok: false, error: 'Ник — хотя бы две буквы.' };
    if (feed.cast.some((x) => x.id !== id && normName(x.nick) === normName(nick))) {
      return { ok: false, error: `Ник «${nick}» уже занят в касте.` };
    }
    m.nick = nick;
  }
  for (const key of EDITABLE.slice(1)) if (p[key] !== undefined) m[key] = plain(p[key], CAST_TEXT_MAX[key]);
  return { ok: true, member: { ...m } };
}

export function carryCast(live, before) {
  if (!before || typeof before !== 'object' || !live || !live.feed) return before;
  const { cast, heroineTemper = '', charRole = '' } = normalizeFeed(live.feed);
  if (!cast.length) return before;
  const was = normalizeFeed(before.feed);
  if (JSON.stringify(was.cast) === JSON.stringify(cast) && (was.heroineTemper || '') === heroineTemper && (was.charRole || '') === charRole) return before;
  return { ...before, feed: { ...was, cast, ...(heroineTemper ? { heroineTemper } : {}), ...(charRole ? { charRole } : {}), threads: normalizeThreads(was.threads, cast) } };
}

export function textKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const FOREIGN_SPELLS = [
  'люмос', 'lumos', 'обливиэйт', 'обливиэйшн', 'obliviate', 'экспеллиармус', 'expelliarmus', 'экспекто патронум',
  'expecto patronum', 'авада кедавра', 'avada kedavra', 'круцио', 'crucio', 'империо', 'imperio', 'протего', 'protego',
  'акцио', 'accio', 'вингардиум', 'wingardium', 'левиоса', 'риддикулус', 'riddikulus', 'петрификус', 'petrificus',
  'алохомора', 'alohomora', 'остолбеней', 'stupefy', 'легилименс', 'legilimens', 'сектумсемпра', 'sectumsempra',
  'инсендио', 'incendio', 'силенцио', 'silencio', 'репаро', 'reparo', 'эпискей', 'episkey', 'редукто', 'reducto',
  'морсмордре', 'morsmordre', 'империус', 'фините инкантатем', 'finite incantatem', 'ступефай', 'экспульсо',
  'фулгури', 'патронум',
];

const SPELL_RE = new RegExp(`(?<![\\p{L}])(?:${FOREIGN_SPELLS.map((w) => w.replace(' ', '\\s+')).join('|')})`, 'iu');

export function foreignSpell(text) {
  const m = SPELL_RE.exec(String(text == null ? '' : text).replace(/ё/gi, 'е'));
  return m ? m[0] : '';
}

function stems(s) {
  return new Set(textKey(s).split(' ').filter((w) => w.length >= 4).map((w) => w.slice(0, 5)));
}

export function similar(a, b) {
  const x = textKey(a);
  const y = textKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x))) return true;
  const sa = stems(a);
  const sb = stems(b);
  if (!sa.size || !sb.size) return false;
  let common = 0;
  for (const w of sa) if (sb.has(w)) common += 1;
  return common / (sa.size + sb.size - common) >= 0.5;
}

const FIELD_WORD = { nick: 'ник', goal: 'цель', type: 'типаж', interest: 'интерес', manner: 'приметы письма', jealousy: 'ревность' };

const BROKEN_MANNER = new RegExp([
  '(?:внутр\\p{L}*|в\\s+середин\\p{L}*|посредине|посреди)\\s+(?:\\p{L}+\\s+)?(?:слов|слог|букв)',
  'вставля\\p{L}*\\s+(?:\\p{L}+\\s+){0,3}(?:слог|звук|букв|слов\\p{L}*\\s+внутр)',
  'заика\\p{L}*|заикан\\p{L}*|шепеляв\\p{L}*|картав\\p{L}*|коверка\\p{L}*',
  'искаж\\p{L}*\\s+(?:\\p{L}+\\s+)?(?:слов|букв|орфограф|написан|речь)',
  '(?:повторя|растягива|тянет|удлиня)\\p{L}*\\s+(?:\\p{L}+\\s+){0,2}(?:слог|букв|звук)',
  'ломает\\s+(?:\\p{L}+\\s+)?(?:слов|орфограф)',
  'пишет\\s+с\\s+ошибк',
].join('|'), 'iu');

export function brokenManner(manner) {
  return BROKEN_MANNER.test(String(manner == null ? '' : manner));
}

export function mixedAlphabet(text) {
  return Array.from(String(text == null ? '' : text).matchAll(/\p{L}+/gu))
    .some(([w]) => /\p{Script=Cyrillic}/u.test(w) && /\p{Script=Latin}/u.test(w));
}

const NO_JEALOUSY = /^(?:нет|нету|не ревнует|без ревности|ревности нет|пусто|отсутствует|никакая|none|n a|na)$/u;

const wordsOf = (v) => textKey(v).split(' ').filter(Boolean);

export function hasJealousy(v) {
  const k = textKey(v);
  return Boolean(k) && !NO_JEALOUSY.test(k);
}

export const concreteJealousy = (v) => hasJealousy(v) && wordsOf(v).length >= 4;

export const profileManner = (v) => wordsOf(v).length >= 4;

function sameManner(a, b) {
  const x = textKey(a);
  const y = textKey(b);
  if (x || y) return x === y;
  return String(a).trim() === String(b).trim();
}

export function checkDiversity(members, opts = {}) {
  const list = normalizeCastList(members);
  const folks = (Array.isArray(opts.classmates) ? opts.classmates : [])
    .map((c) => (typeof c === 'string' ? c : c && c.name)).filter(Boolean);
  const folk = folks.length ? stopList({ char: folks }) : [];
  const problems = [];
  const add = (m, field, hard, other, text) => problems.push({ id: m.id, field, hard, with: other, text });

  list.forEach((m, i) => {
    const hit = stopHit(m.nick, opts.stop);
    if (hit) {
      add(m, 'nick', true, '', hit.kind === 'user' ? `ник «${m.nick}» — имя персонажа игрока` : `ник «${m.nick}» совпадает с «${hit.name}»`);
    } else if (stopHit(m.nick, folk)) {
      add(m, 'nick', true, '', `ник «${m.nick}» — имя живого сокурсника`);
    }
    const twin = list.slice(0, i).find((o) => normName(o.nick) === normName(m.nick));
    if (twin) add(m, 'nick', true, twin.id, `ник «${m.nick}» уже есть у «${twin.nick}»`);
    if (brokenManner(m.manner)) add(m, 'manner', false, '', `манера речи «${m.manner}» искажает написание слов`);
    for (const field of EDITABLE) {
      if (mixedAlphabet(m[field])) add(m, field, false, '', `${FIELD_WORD[field]} «${m[field]}»: буквы двух алфавитов внутри слова`);
    }
    for (const field of DIVERSE_FIELDS) {
      if (!m[field]) continue;
      const same = field === 'manner' ? sameManner : similar;
      const other = list.slice(0, i).find((o) => o[field] && same(o[field], m[field]));
      if (other) add(m, field, false, other.id, `${FIELD_WORD[field]} «${m[field]}» повторяет «${other[field]}» (${other.nick})`);
    }
  });
  return { problems, redo: [...new Set(problems.map((p) => p.id))] };
}

export function assignRelations(members) {
  const list = normalizeCastList(members).map((m) => ({ ...m }));
  const n = list.length;
  if (n < 2) return list.map((m) => ({ ...m, ally: '', rival: '' }));
  const byId = new Map(list.map((m) => [m.id, m]));
  const around = (i, from) => Array.from({ length: n - 1 }, (_, k) => list[(i + from + k) % n]).filter((m) => m !== list[i]);

  list.forEach((m, i) => {
    if (m.ally) return;
    const pick = around(i, 1).find((c) => c.id !== m.rival && (!c.ally || c.ally === m.id))
      || around(i, 1).find((c) => c.id !== m.rival);
    if (!pick) return;
    m.ally = pick.id;
    if (!pick.ally && pick.rival !== m.id) pick.ally = m.id;
  });
  list.forEach((m, i) => {
    if (m.rival) return;
    const pick = around(i, Math.floor(n / 2)).find((c) => c.id !== m.ally && (!c.rival || c.rival === m.id))
      || around(i, Math.floor(n / 2)).find((c) => c.id !== m.ally);
    if (!pick) return;
    m.rival = pick.id;
    if (!pick.rival && pick.ally !== m.id) pick.rival = m.id;
  });
  return normalizeCastList(list.map((m) => ({
    ...m, ally: byId.has(m.ally) ? m.ally : '', rival: byId.has(m.rival) ? m.rival : '',
  })));
}

export function worldPreset(state, preset) {
  if (!preset || typeof preset !== 'object' || !state || !state.survey || !str(state.survey.canon)) return preset;
  const cv = state.canonVocab || {};
  const layered = state.canonLayer && Array.isArray(state.canonLayer.holidays) && state.canonLayer.holidays.length;
  return {
    ...preset,
    vocab: Object.fromEntries(Object.entries(cv).filter(([, v]) => typeof v === 'string' && v.trim())),
    ...(layered ? {} : { holidays: [] }),
  };
}

export function worldRealities(state, preset) {
  const p = worldPreset(state, preset && typeof preset === 'object' ? preset : {});
  const survey = (state && state.survey) || {};
  const vocab = p.vocab || {};
  const out = [];
  const place = [p.displayName, str(survey.institution), str(survey.faculty)].filter(Boolean)
    .filter((x, i, all) => all.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
  if (place.length) out.push(`заведение: ${place.join(', ')}`);
  const where = [str(survey.country), str(survey.era)].filter(Boolean)
    .filter((x, i, all) => !all.some((y, j) => j !== i && (y.toLowerCase().includes(x.toLowerCase()) && (y.length > x.length || j < i))));
  if (where.length) out.push(`где и когда: ${where.join(', ')}`);
  const words = [['teacher', 'преподаватель'], ['period', 'занятие'], ['term', 'семестр'], ['examPeriod', 'сессия']]
    .map(([k, w]) => (vocab[k] ? `${w} — «${vocab[k]}»` : '')).filter(Boolean);
  if (words.length) out.push(`здесь это называется так: ${words.join('; ')}`);
  const subjects = ((state && state.subjects) || []).map((s) => s && s.name).filter(Boolean).slice(0, 6);
  if (subjects.length) out.push(`${subjectWord(p, 'many')}: ${subjects.join(', ')}`);
  const days = [...holidaysOf(p), ...eventsOf(state)].map((h) => h.name).filter(Boolean).slice(0, 6);
  if (days.length) out.push(`праздники и события: ${[...new Set(days)].join(', ')}`);
  return out;
}

export function calendarNames(state, preset) {
  const out = [];
  for (const h of [...holidaysOf(worldPreset(state, preset)), ...eventsOf(state)]) {
    const name = h && str(h.name);
    if (name && !out.includes(name)) out.push(name);
  }
  return out.slice(0, 20);
}

const systemOf = (preset) => 'Ты придумываешь постоянных второстепенных учеников для школьного чата со слухами в ролевой игре. Все ученики совершеннолетние (18+).'
  + ` Это массовка: у каждого свои дела, ${heroWords(presetGender(preset)).heroAcc} они знают понаслышке.`
  + ' Отвечай только строками списка, без пояснений, вступлений и markdown.';

function worldBlock(input) {
  const i = input || {};
  const lines = [];
  const real = (Array.isArray(i.realities) ? i.realities : []).filter(Boolean);
  if (real.length) lines.push('Реалии заведения (опирайся на них, не на школьные штампы):', ...real.map((r) => `— ${r}`));
  if (Array.isArray(i.calendar)) {
    lines.push(i.calendar.length
      ? `Праздники и события — только эти: ${i.calendar.join('; ')}. Других не выдумывай.`
      : 'В календаре нет ни праздников, ни событий: никаких не упоминай.');
  }
  const types = i.types && i.types.length ? i.types : feedExtras(i.preset);
  lines.push(`Типажи этого мира, чтобы понять, какими бывают ученики (ярлыки не копируй): ${types.slice(0, 8).join('; ')}.`);
  lines.push(str(i.canon)
    ? 'Заклинания, термины и реалии — канонические.'
    : 'Только заклинания и термины этого мира и пресета, ничего из известных книг и фильмов.');
  return lines;
}

function avoidBlock(input) {
  const i = input || {};
  const names = [...new Set([i.heroine, ...(i.mainNames || []), ...(i.classmates || [])]
    .map((n) => (typeof n === 'string' ? n : n && n.name)).map(str).filter(Boolean))];
  return names.length
    ? [`Эти имена и их части в ${str(i.canon) ? 'именах' : 'никах'} не использовать: ${names.join(', ')}.`]
    : [];
}

const SWEAR_SHARES = [
  [1, 'часто ругается в эмоциональных ситуациях'],
  [2, 'иногда крепко'],
  [3, 'иногда мягко'],
  [2, 'обычно без ругани'],
];

export function swearSpread(count) {
  const quota = SWEAR_SHARES.map(([k]) => (count * k) / 8);
  const got = quota.map(Math.floor);
  const order = quota.map((q, i) => [q - got[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let left = count - got.reduce((x, y) => x + y, 0), k = 0; left > 0; left -= 1, k += 1) got[order[k][1]] += 1;
  return SWEAR_SHARES.map(([, text], i) => [got[i], text]).filter(([n]) => n > 0);
}

const JEALOUSY_KINDS = 'холодная, обидчивая, насмешливая, собственническая, соревновательная, страдающая, защитная';

const MANNER_SAMPLE = 'коротко, строчными без точек, эмодзи не ставит, на «ты», обычно огрызается, но может скупо похвалить удачный выпад';

export function buildCastPrompt(input) {
  const i = input || {};
  const count = Math.max(2, Math.min(CAST_MAX, Math.trunc(Number(i.count)) || CAST_MAX));
  const nicks = feedNickExamples(i.preset);
  const w = heroWords(presetGender(i.preset));
  const persona = personaOf(i.persona);
  const card = personaOf(i.card);
  const charName = charNameOf(i);
  const canon = str(i.canon);
  const enough = Boolean(canon) && (Array.isArray(i.classmates) ? i.classmates : []).filter((c) => str(typeof c === 'string' ? c : c && c.name)).length >= 8;
  const named = Boolean(canon) && !enough;
  const mains = [...new Set((i.mainNames || []).map(str).filter(Boolean))].join(', ');
  const mainsDat = mains ? `персонажу карточки (${mains})` : 'персонажу карточки';
  const mainsAcc = mains ? `персонажа карточки (${mains})` : 'персонажа карточки';
  const manner = feedManners(i.preset)[0];
  const heroName = str(i.heroine) || w.heroAcc;
  const cardName = str(i.mainNames && i.mainNames[0]) || charName;
  const user = [
    enough
      ? `Придумай ${count} статистов — обычных учеников этого мира, пишущих в общий чат (канон: ${canon}); канонических не повторяй.`
      : canon
      ? `Назови ${count} статистов — канонических второстепенных учеников этого заведения и года (канон: ${canon}), пишущих в общий чат. Не бери ${w.heroAcc}, персонажа карточки и сокурсников ${w.heroGen}; где канон кончился, дополни выдуманными. Канонные отношения сохраняй: влюблённость канонному человеку против канона не приписывай, недостающих влюблённых сделай выдуманными.`
      : `Придумай ${count} статистов — учеников этого мира, пишущих в общий чат.`,
    '',
    ...worldBlock(i),
    ...avoidBlock(i),
    '',
    'Один статист — одна строка, поля через « | »:',
    `${named ? 'имя' : 'ник'} | кто | интерес | цель | как пишет | ревность | фанат | к главным`,
    named
      ? '— имя: настоящее имя канонического ученика, как в каноне; выдуманный ник — только где канон кончился;'
      : `— ник: как назвался бы ученик в чате, не имя и не фамилия. Образцы: ${nicks.map((n) => n.replace(/\s*\(.*\)$/, '')).join('; ')};`,
    '— кто: положение в заведении и круг общения, 1–3 слова;',
    `— интерес: чем живёт кроме ${w.heroGen}, конкретно;`,
    '— цель: чего хочет в ближайшие недели, одна фраза;',
    `— как пишет: 4–8 примет через запятую: длина реплик, заглавные и точки, эмодзи, отношение к собеседнику, как нападает и защищается, как ругается (из ${count}: ${swearSpread(count).map(([n, t]) => `${n} — ${t}`).join('; ')}). Любимых ругательств не закрепляй. Слова пишутся правильно. Например: «${MANNER_SAMPLE}»${manner ? `; «${manner}»` : ''};`,
    `— ревность: «вид: к кому и из-за чего, чего боится лишиться», до 200 знаков, только у 2–3 статистов, у остальных «нет». Обязательно: один влюблён в ${mainsAcc} и ревнует к ${w.heroDat}, другой влюблён в ${w.heroAcc} и ревнует к ${mainsDat}; оба названы по имени в цели или ревности; ревность видна поступком в чате (колкость, «случайно» слитый слух, игнорирование). У каждого свой вид: ${JEALOUSY_KINDS};`,
    `— фанат: у одного — открытый поклонник ${w.heroGen}, слово «фанат» (девушке «фанатка»), у остальных «нет»;`,
    `— к главным: к кому из главных неравнодушен, по имени: «влюблён(а) в» ${heroName} или ${cardName}, «фанат ${w.heroGen}» либо «нет»; у влюблённых совпадает с ревностью.`,
    '',
    `Все ${count} разные: типаж, интерес, приметы письма. Живые и пристрастные, равнодушных нет; холодных и язвительных не больше двоих.`,
    `После ${count} строк: ${[persona && 'строка «НРАВ: …»', card && 'строка «РОЛЬ: …»', `строка «${END_MARK}»`].filter(Boolean).join(', ')}. Без пояснений и markdown.`,
    ...(persona ? ['', ...temperBlock(i, w, persona)] : []),
    ...(card ? ['', ...roleBlock(i, card)] : []),
  ].join('\n');
  return { system: systemOf(i.preset), user };
}

export const PERSONA_MAX = 1500;

function temperBlock(i, w, persona) {
  const name = str(i.heroine);
  return [
    `Описание ${w.heroGen}${name ? ` (${name})` : ''}:`,
    persona,
    `НРАВ: одна-две фразы своими словами, каков нрав ${w.heroGen} в глазах курса и как с ней обращаются. Только по описанию.`,
  ];
}

const charNameOf = (i) => str(i && i.charName) || str(i && i.mainNames && i.mainNames[0]) || 'персонаж';

function roleBlock(i, card) {
  return [
    `Описание персонажа карточки (${charNameOf(i)}):`,
    card,
    'РОЛЬ: кто он в заведении, 2–6 слов (должность или положение), строго по описанию.',
  ];
}

const personaOf = (v) => oneLine(v, PERSONA_MAX);

export function buildTemperPrompt(input) {
  const i = input || {};
  const w = heroWords(presetGender(i.preset));
  const persona = personaOf(i.persona);
  const card = personaOf(i.card);
  return {
    system: 'Ты помогаешь вести общий школьный чат массовки в ролевой игре; все участники — совершеннолетние (18+). Отвечай короткими строками, без пояснений и markdown.',
    user: [...(persona ? temperBlock(i, w, persona) : []), ...(card ? ['', ...roleBlock(i, card)] : []), '',
      `Ответ — ${persona && card ? 'две строки «НРАВ: …» и «РОЛЬ: …»' : persona ? 'строка «НРАВ: …»' : 'строка «РОЛЬ: …»'}, затем строка «${END_MARK}».`].join('\n'),
  };
}

const BULLET = /^\s*(?:[-–—*•]|\d+[.)])\s*/;

const MARKED = /^[\s*_#>`-]*(нрав|роль)(?:\s*\([^)]*\))?\s*[:—–]\s*(.+)$/iu;

const LABEL_ECHO = /(?:^|[\s,;(])(?:нрав|роль)\s*(?:[:«»]|$)/iu;

const leadOff = (v) => String(v).replace(/^\s*(?:нрав|роль|характер)\s*[:—–-]\s*/iu, '');

export function goodProfile(v, { min = 3, max = TEMPER_MAX } = {}) {
  const raw = leadOff(oneLine(String(v == null ? '' : v).replace(/[*`]+/g, ''), 4000));
  if (raw.length < min || raw.includes(END_MARK) || /["„“”|]/.test(raw) || LABEL_ECHO.test(raw) || mixedAlphabet(raw)) return '';
  const count = (re) => (raw.match(re) || []).length;
  if (count(/\p{Script=Latin}/gu) > count(/\p{Script=Cyrillic}/gu)) return '';
  return cutWords(raw, max);
}

const goodTemper = (v) => goodProfile(v, { min: 8, max: TEMPER_MAX });
const goodRole = (v) => goodProfile(v, { min: 3, max: ROLE_MAX });

function cleanedReply(text) {
  return String(text == null ? '' : text).replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '').replace(/\r/g, '');
}

export function parseTemperReply(text, opts = {}) {
  let temper = '';
  let role = '';
  for (const line of lastBlock(cleanedReply(text), { mark: END_MARK }).split('\n')) {
    const body = line.replace(BULLET, '').replace(/[*`]+/g, '').trim();
    if (!body || new RegExp(`^${END_MARK}`, 'iu').test(body)) continue;
    const marked = MARKED.exec(body);
    if (marked) {
      if (marked[1].toLowerCase() === 'роль') role = role || goodRole(marked[2]);
      else temper = temper || goodTemper(marked[2]);
      continue;
    }
    const f = body.split('|').map((x) => x.trim());
    const kind = f.length > 1 ? rowKind(f, opts) : '';
    if (kind === 'role') role = role || goodRole(f.slice(1).join(', '));
    else if (kind === 'temper') temper = temper || goodTemper(f.slice(1).join(', '));
    else if (f.length === 1 && !temper) temper = goodTemper(body);
  }
  return { temper, role };
}

export const parseTemper = (text, opts) => parseTemperReply(text, opts).temper;

const TEMPER_KEY = /^(?:героиня|герой|нрав)$/u;

function sameName(a, b) {
  const x = textKey(a).split(' ').filter(Boolean);
  const y = textKey(b).split(' ').filter(Boolean);
  if (!x.length || !y.length) return false;
  const [s, l] = x.length <= y.length ? [x, y] : [y, x];
  return s.every((w) => l.includes(w));
}

function rowKind(f, opts = {}) {
  const key = textKey(f[0]);
  const val = textKey(f[1] || '');
  const names = [].concat(opts.charNames || []).filter(Boolean);
  if (key === 'роль' || /^роль(?: |$)/u.test(val) || names.some((n) => sameName(f[0], n))) return 'role';
  if (TEMPER_KEY.test(key) || /^нрав(?: |$)/u.test(val) || (opts.heroine && sameName(f[0], opts.heroine))) return 'temper';
  return '';
}

const FAN_MARK = /^(?:да|\+|фанат|поклонни)/iu;
const FAN_GUESS = /фанат|поклонни|восхища|восторга/iu;
const HEADERS = new Set(['ник', 'имя', 'кто', 'типаж', 'интерес', 'цель', 'как пишет', 'ревность', 'союзник', 'соперник']);
const FAN_CELL = /^(?:нет|да|\+|-|—|–|фанат\p{L}*|поклонни\p{L}*)$/iu;

const scrub = (v) => {
  const t = String(v == null ? '' : v).replace(new RegExp(END_MARK, 'g'), ' ').replace(/\s+/g, ' ').trim().replace(/[\s,;:|—–-]+$/u, '');
  return HEADERS.has(textKey(t)) ? '' : t;
};

export function parseCastResponse(text, opts = {}) {
  const raw = cleanedReply(text);
  const complete = /КОНЕЦ(?![\p{L}])/u.test(raw) && opts.truncated !== true;
  const max = Math.max(1, Math.min(CAST_MAX, Math.trunc(Number(opts.max)) || CAST_MAX));
  const rejected = [];
  const rows = [];
  let temper = '';
  let role = '';
  for (const line of lastBlock(raw, { mark: END_MARK, max }).split('\n')) {
    const body = line.replace(BULLET, '').trim().replace(/^\|+|\|+$/g, '');
    const marked = MARKED.exec(body);
    if (marked && !marked[2].includes('|')) {
      if (marked[1].toLowerCase() === 'роль') role = role || goodRole(marked[2]);
      else temper = temper || goodTemper(marked[2]);
      continue;
    }
    if (!body || !body.includes('|')) continue;
    const f = body.split('|').map((x) => unlabel(x.trim().replace(/^[*`_]+|[*`_]+$/g, '').trim()));
    if (['ник', 'имя'].includes(textKey(f[0])) && /(?:типаж|кто)/i.test(f[1] || '')) continue;
    if (f.every((x) => /^:?-{2,}:?$/.test(x))) continue;
    const kind = f.length < 5 ? rowKind(f, opts) : '';
    if (kind === 'temper') temper = temper || goodTemper(f.slice(1).join(', '));
    else if (kind === 'role') role = role || goodRole(f.slice(1).join(', '));
    else rows.push(f);
  }
  const whole = [];
  rows.forEach((f, i) => {
    const last = i === rows.length - 1;
    if (f.length < 5 || !scrub(f[0])) rejected.push(`строка ${i + 1}: меньше пяти полей`);
    else if (last && !complete && f.length < 7) rejected.push(`строка ${i + 1}: ответ оборван`);
    else whole.push(f.map(scrub));
  });

  const members = [];
  const rels = new Map();
  const names = new Map();
  for (const f of whole) {
    if (members.length >= max) {
      rejected.push(`«${f[0]}»: сверх ${max}`);
      continue;
    }
    const nick = cleanNick(f[0]);
    if (!nick) {
      rejected.push(`«${f[0]}»: ник не годится`);
      continue;
    }
    if (names.has(normName(nick))) {
      rejected.push(`«${nick}»: повторный ник`);
      continue;
    }
    const id = `cast${members.length + 1}`;
    names.set(normName(nick), id);
    const long = f.length >= 9 || (f.length === 8 && !FAN_CELL.test(f[6] || ''));
    const withRel = !long && f.length >= 8;
    members.push({
      id, nick, type: f[1], interest: f[2], goal: f[3], manner: f[4],
      allyNick: long ? f[5] || '' : '', rivalNick: long ? f[6] || '' : '', jealousy: (long ? f[7] : f[5]) || '',
      fan: FAN_MARK.test((long ? f[8] : f[6]) || ''),
    });
    if (withRel && f[7] && !NO_JEALOUSY.test(textKey(f[7]))) rels.set(id, f[7]);
  }
  if (!members.some((m) => m.fan)) {
    const guess = members.find((m) => FAN_GUESS.test(`${m.type} ${m.goal}`));
    if (guess) guess.fan = true;
  }
  const resolved = members.map(({ allyNick, rivalNick, ...m }) => ({
    ...m,
    fan: m.fan === true,
    ally: names.get(normName(allyNick.replace(/^[~@\s]+/, ''))) || '',
    rival: names.get(normName(rivalNick.replace(/^[~@\s]+/, ''))) || '',
  }));
  return { members: normalizeCastList(resolved), rejected, complete, temper, role, rels: Object.fromEntries(rels) };
}

const stemOf = (t) => t.slice(0, t.length <= 4 ? t.length - 1 : Math.min(5, t.length - 2));

function nameStems(names) {
  return [...new Set((names || []).flatMap((n) => textKey(n).split(' ')).filter((t) => t.length >= 3).map(stemOf))];
}

export function loveTarget(text, hero, card) {
  const words = textKey(text).split(' ').filter(Boolean);
  const love = words.findIndex((w) => LOVE_RE.test(w));
  if (love < 0) return '';
  const kind = (w) => (hero.some((s) => w.startsWith(s)) ? 'hero' : card.some((s) => w.startsWith(s)) ? 'card' : '');
  for (let k = love + 1; k < words.length; k += 1) if (kind(words[k])) return kind(words[k]);
  for (let k = love - 1; k >= 0; k -= 1) if (kind(words[k])) return kind(words[k]);
  return '';
}

export function repairCast(members, { manners = [] } = {}) {
  const list = normalizeCastList(members).map((m) => ({ ...m }));
  const notes = [];
  const sound = (m) => profileManner(m.manner) && !brokenManner(m.manner) && !mixedAlphabet(m.manner);
  const held = new Set();
  const bad = [];
  for (const m of list) {
    const key = textKey(m.manner);
    if (sound(m) && !held.has(key)) held.add(key);
    else bad.push(m);
  }
  const pool = manners.filter((x) => !held.has(textKey(x)));
  bad.forEach((m, k) => {
    const sample = pool.length ? pool[k % pool.length] : manners[k % Math.max(manners.length, 1)] || '';
    if (sample) {
      notes.push(`«${m.nick}»: приметы письма «${m.manner}» заменены образцом`);
      m.manner = sample;
    }
  });
  for (const m of list) {
    if (m.jealousy && (!concreteJealousy(m.jealousy) || mixedAlphabet(m.jealousy))) {
      if (hasJealousy(m.jealousy)) notes.push(`«${m.nick}»: ревность «${m.jealousy}» не конкретна, снята`);
      m.jealousy = '';
    }
  }
  return { members: list, notes };
}

const mainKind = (words, hero, card) => {
  for (const w of words) {
    if (w.startsWith('героин')) return 'hero';
    if (w.startsWith('персонаж')) return 'card';
    if (hero.some((s) => w.startsWith(s))) return 'hero';
    if (card.some((s) => w.startsWith(s))) return 'card';
  }
  return '';
};

function relKind(rel, hero, card) {
  const t = textKey(rel);
  if (!t) return '';
  if (!LOVE_RE.test(t) && /фанат|поклонни/u.test(t)) return '';
  return loveTarget(t, hero, card) || mainKind(t.split(' '), hero, card);
}

function jealousKind(m, hero, card) {
  const words = textKey(m.jealousy).split(' ');
  const at = words.findIndex((w, k) => (w === 'к' || w === 'ко') && mainKind(words.slice(k + 1, k + 4), hero, card));
  if (at < 0) return '';
  const to = mainKind(words.slice(at + 1, at + 4), hero, card);
  const seen = new Set(textKey([m.goal, m.interest, m.jealousy].join(' ')).split(' ').map((w) => mainKind([w], hero, card)).filter(Boolean));
  seen.delete(to);
  return [...seen][0] || '';
}

export function loveKind(m, { hero, card, rel = '' }) {
  return relKind(rel, hero, card)
    || loveTarget([m.goal, m.interest, m.type, m.jealousy].join(' '), hero, card)
    || jealousKind(m, hero, card);
}

export function castGaps(members, input, rels = {}) {
  const hero = nameStems([input.heroine]);
  const card = nameStems([input.charName, ...(input.mainNames || [])]);
  if (!hero.length || !card.length) return { gaps: [], missing: [] };
  const kinds = members.filter((m) => concreteJealousy(m.jealousy)).map((m) => loveKind(m, { hero, card, rel: rels[m.id] }));
  const gaps = [];
  const missing = [];
  if (!kinds.includes('card')) { gaps.push('нет влюблённого в персонажа карточки, ревнующего к героине'); missing.push(str(input.mainNames && input.mainNames[0]) || str(input.charName) || 'персонажа карточки'); }
  if (!kinds.includes('hero')) { gaps.push('нет влюблённого в героиню, ревнующего к персонажу карточки'); missing.push(str(input.heroine) || 'героиню'); }
  return { gaps, missing };
}

const castCount = (i) => Math.max(2, Math.min(CAST_MAX, Math.trunc(Number(i.count)) || CAST_MAX));

export async function assembleCast(input, ask) {
  const i = input || {};
  const want = castCount(i);
  const manners = i.manners && i.manners.length ? i.manners : feedManners(i.preset);
  const parseOpts = (r) => ({ truncated: r.truncated === true, heroine: i.heroine, charNames: [i.charName, ...(i.mainNames || [])].filter(Boolean) });
  let calls = 0;
  const run = async (again) => {
    const res = await ask(buildCastPrompt(i), again ? { again: true } : {});
    calls += 1;
    if (!res.ok) return { res };
    const parsed = parseCastResponse(res.text, parseOpts(res));
    const fixed = repairCast(parsed.members, { manners });
    const details = [...fixed.notes];
    const { problems } = checkDiversity(fixed.members, { stop: i.stop, classmates: i.classmates });
    const bad = new Set(problems.filter((p) => p.hard).map((p) => p.id));
    for (const p of problems.filter((x) => x.hard)) details.push(`убран: ${p.text}`);
    const members = fixed.members.filter((m) => !bad.has(m.id));
    return { res, parsed, fixed, details, members, ...castGaps(members, i, parsed.rels) };
  };
  const better = (a, b) => (b.members.length !== a.members.length ? b.members.length > a.members.length : b.gaps.length < a.gaps.length);

  let cur = await run(false);
  if (!cur.res.ok) return { ok: false, code: cur.res.code || 'api', error: cur.res.message || 'запрос не удался', calls };
  const sparse = (c) => c.parsed.members.length < 2 || (!c.parsed.complete && c.members.length * 2 < want);
  if (sparse(cur)) {
    const next = await run(true);
    if (next.res.ok && better(cur, next)) cur = next;
  }
  if (cur.parsed.members.length < 2) {
    return {
      ok: false,
      code: cur.res.truncated ? 'truncated' : 'parse',
      error: cur.res.truncated
        ? 'Каст не собран: модель оборвалась. Попробуйте ещё раз или выберите модель посвободнее.'
        : 'Каст не собран: ответ модели не разобрался.',
      raw: cur.res.text,
      calls,
    };
  }
  if (cur.members.length * 2 >= want && cur.gaps.length) {
    const next = await run(true);
    if (next.res.ok && next.members.length * 2 >= want && better(cur, next)) cur = next;
  }
  if (cur.members.length * 2 < want) {
    const gaps = [`модель дала ${cur.members.length} годных статистов из ${want}`, ...cur.gaps];
    return {
      ok: false,
      code: 'quality',
      error: `Каст не поставлен: ${gaps.join('; ')}.`,
      details: [...gaps, ...cur.details, ...cur.parsed.rejected],
      raw: cur.res.text,
      calls,
    };
  }
  const members = assignRelations(cur.members);
  const warnings = cur.fixed.notes.length ? [`У ${cur.fixed.notes.length} статистов приметы доправлены кодом.`] : [];
  if (cur.missing.length) warnings.push(`Нет влюблённого в ${cur.missing.join(' и в ')}: пересоберите каст или впишите ревность руками.`);
  const { parsed } = cur;
  return { ok: true, members, warnings, details: cur.details, calls, ...(parsed.temper ? { temper: parsed.temper } : {}), ...(parsed.role ? { role: parsed.role } : {}) };
}

const ASSIGNED_JEALOUSY = 'ревность поступком: колкость, «случайно» слитый слух, демонстративное игнорирование';

export function rumorAuthors(state, opts = {}) {
  const feed = normalizeFeed(state && state.feed);
  const mains = mainsOfStop(opts.stop);
  const scene = sceneFolk(state, { stop: opts.stop }).slice(0, SCENE_MAX);
  let cast = feed.cast.filter((m) => !stopHit(m.nick, opts.stop)).map((m) => (hasJealousy(m.jealousy) ? m : { ...m, jealousy: '' }));
  const over = cast.length + scene.length - CAST_MAX;
  if (over > 0) {
    const busy = new Set(feed.threads.flatMap((t) => t.members || []));
    const lastAt = (m) => feed.items.reduce((at, x, i) => (x.nick && normName(x.nick) === normName(m.nick) ? i : at), -1);
    const gone = cast.filter((m) => !m.fan && !str(m.jealousy) && !busy.has(m.id)).map((m) => ({ m, at: lastAt(m) }))
      .sort((x, y) => x.at - y.at).slice(0, over).map(({ m }) => m.id);
    cast = cast.filter((m) => !gone.includes(m.id));
  }
  const card = mains.card.join(', ');
  const out = cast.map((m) => ({
    id: m.id, kind: 'cast', name: m.nick, masked: true, type: m.type, interest: m.interest, goal: m.goal, manner: m.manner, jealousy: m.jealousy,
    ...(m.fan ? { fan: true } : {}), ...(card && mains.hero && castLovesCard(m, mains, feed.charRole) ? { love: { to: card, rival: mains.hero } } : {}),
  }));
  for (const f of scene) out.push({ id: f.id, kind: 'cast', name: f.name, masked: true, type: 'из сцен', interest: '', goal: '', manner: '', jealousy: '', scene: true, role: f.role, note: f.note });
  const folks = Array.isArray(state && state.classmates) ? state.classmates : [];
  const lovesCard = folks.some((c) => c && c.id && (loveOf(c, mains) || {}).to === card);
  if (card && mains.hero && !lovesCard && !out.some((a) => a.love)) {
    const chosen = out.find((a) => a.id === pickCardLover(out));
    if (chosen) Object.assign(chosen, { love: { to: card, rival: mains.hero }, jealousy: chosen.jealousy || ASSIGNED_JEALOUSY });
  }
  for (const c of folks) {
    if (!c || !c.id || c.id === HEROINE || !str(c.name)) continue;
    if (stopHit(c.name, opts.stop)) continue;
    out.push({ id: c.id, kind: 'classmate', name: c.name, masked: false, desire: c.desire || '', problem: c.problem || '' });
  }
  return out;
}

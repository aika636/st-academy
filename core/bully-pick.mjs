import { extractJson } from './plan-gen.mjs';
import { classmateStart, addClassmate } from './classmates.mjs';
import { relationLabel, relationMemory } from './relations.mjs';
import { shortName } from './scene.mjs';
import { heroGender, heroWords } from './gender.mjs';
import { cloneState, normalizeBullying, normalizePick } from './state.mjs';
import { normName } from './stop-names.mjs';
import { bullyingOf, resolveBully, skipIds } from './bullying.mjs';

export const PICK_PEOPLE_MAX = 40;

export const PICK_CANDIDATES_MAX = 3;

const str = (v, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');
const list = (v, n, max) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(/[;\n]+/) : []).map((x) => str(x, max)).filter(Boolean).slice(0, n);
const pickOf = (src, names) => { for (const n of names) if (src[n] !== undefined && src[n] !== null) return src[n]; return undefined; };

const SOURCE_WORDS = { scene: 'сцена', lorebook: 'книга мира', card: 'карточка', generated: 'сгенерирован', manual: 'вручную', npc: 'свой NPC' };

function personLine(state, preset, c) {
  const src = c.canon === true ? 'канон' : SOURCE_WORDS[c.source] || 'сцена';
  const bits = [
    c.desire && `хочет: ${c.desire}`, c.problem && `проблема: ${c.problem}`, c.club && `кружок: ${c.club}`, c.seed && `роль: ${c.seed}`,
    c.tie && c.tie.what && `связь: ${c.tie.what}`,
  ].filter(Boolean).join('; ');
  const guess = c.canonHero ? `; по канону, предположение: ${c.canonHero}` : '';
  const past = relationMemory(state, c.id, preset, 2).map((m) => str(m.reason, 80)).filter(Boolean);
  return `- ${c.id} | ${c.name} | ${src} | к героине: ${relationLabel(state, c.id, preset) || 'нет'}${past.length ? ` (было: ${past.join('; ')})` : ''}${guess}${bits ? ` | ${bits}` : ''}`;
}

function context(state, preset, { char = [], heroine = '', exclude = [] } = {}) {
  const names = [...new Set([].concat(exclude).map((id) => { const p = people(state).find((c) => c.id === id); return p ? p.name : ''; }).filter(Boolean))];
  const s = (state && state.survey) || {};
  const W = heroWords(heroGender(state, heroine));
  const world = [
    s.canon && `канон: ${str(s.canon, 120)}`, s.institution && `заведение: ${str(s.institution, 80)}`, s.faculty && `факультет, класс: ${str(s.faculty, 80)}`,
    s.year && `курс: ${str(s.year, 40)}`, s.era && `эпоха: ${str(s.era, 80)}`, (preset && preset.name) && `сеттинг: ${str(preset.name, 80)}`,
  ].filter(Boolean).join('; ');
  const chars = [...new Set([].concat(char).map((n) => str(n, 80)).filter(Boolean))];
  const crowd = (Array.isArray(state && state.classmates) ? state.classmates : []).filter((c) => c && c.id).slice(0, PICK_PEOPLE_MAX);
  const skip = str(bullyingOf(state).skip, 240);
  return {
    W,
    lines: [
      `Мир: ${world || 'не описан'}.`,
      `${W.hero[0].toUpperCase()}${W.hero.slice(1)}${heroine ? ` — ${str(heroine, 80)}` : ''}. Персонаж карточки (Char): ${chars.length ? chars.join(', ') : 'не назван'}.`,
      'Однокурсники и другие ученики, уже известные истории (id | имя | откуда известен | отношение к героине | описание):',
      ...(crowd.length ? crowd.map((c) => personLine(state, preset, c)) : ['- пока никого']),
      skip ? `Игрок просит: точно не травят — ${skip}.` : '',
      names.length ? `Уже подбирали и не подошли — другого: ${names.join(', ')}.` : '',
    ].filter(Boolean),
  };
}

const HERO_FORMS = { героиня: 'hero', героиню: 'heroAcc', героини: 'heroGen', героине: 'heroDat', героиней: 'heroIns' };
const HERO_RE = /героин(?:я|ю|и|е|ей)(?![а-яё])/giu;

const FRIENDLY = 'Отношение к героине выше нейтрального — друг, не кандидат.';

export function buildPickPrompt(state, preset, opts = {}) {
  const { W, lines } = context(state, preset, opts);
  return {
    system: 'Ты помощник ведущего ролевой игры. Отвечаешь одним JSON-объектом и ничем больше: без пояснений, без markdown.',
    user: [
      ...lines,
      '',
      `Вопрос: кто из доступных людей способен систематически преследовать ${W.heroAcc}, не противореча своей характеристике? Укажи мотив, доступ к ${W.heroDat} и источник основания. Не назначай врагом только из-за принадлежности к группе, нейтральность — не основание. Если уверенного кандидата нет, верни пустой список: заполнять роль любой ценой нельзя.`,
      `Мотив — из настоящего: соперничество факультетов и групп, статус, ревность, поведение ${W.heroGen} в уже сыгранных сценах. Общая история ${W.heroGen} с кандидатом («в прошлом году», «давняя обида») допустима, только если она установлена в чате, карточке, персоне или книгах мира; иначе её не выдумывай.`,
      'Порядок поиска: 1) те, кто уже конфликтовал с героиней в сыгранных сценах (отношение «враг» или «недолюбливает», строки «было»); 2) люди из списка — плана, каста, книг игрока; 3) в каноне (поле «канон») — канонические ученики того же курса или факультета с подтверждённым мотивом, даже если их нет в списке: назови их по имени; 4) выдуманного человека не предлагай — для него есть отдельный запрос, когда подходящих нет. Это ученики или ровесники, не наставники и не взрослый персонал. Не только один курс или факультет: другой факультет годится при общих занятиях, коридорах, соревнованиях; другое заведение — только при установленном контакте (обмен, общее событие, визит, конфликт между заведениями). Без доступа ежедневная травля невозможна.',
      `Друзья ${W.heroGen}: ${FRIENDLY} Связи Char: как дружба или вражда этого человека с Char влияет на отношение к ${W.heroDat} в текущей истории? Отдели известное от предположения. Дружба с Char не доказывает ни вражды, ни поддержки; друг Char годится только при отдельном, названном мотиве (недоверие, соперничество, собственный конфликт, ревность). Не сочиняй мотив ради заполнения роли.`,
      'У каждого кандидата: who — id из списка (канонический ученик, которого в списке нет, — его имя); source — scene (проявился в истории), lore (из книги мира), canon (по канону), guess (догадка); motive — почему преследует, своими словами; access — где и при каких условиях встречается с героиней; reach — course (тот же курс), faculty (другой факультет, но общие занятия), other (другое заведение); contact — для reach=other чем подтверждён контакт, иначе пусто; methods — 2–4 способа давления именно этого человека, разного уровня (насмешки, бойкот, порча вещей, подстава, угрозы, нападение — только подходящие ему); limits — чего он не сделает по характеру; responseStyle — как именно он отвечает на отпор героини (не отступает сразу: давит иначе, зовёт своих, мстит исподтишка, жалуется, затаивается — по характеру, одной фразой); ties — связи с Char и героиней (известное отдельно от догадки); charFriend — true, если он друг Char; allies — id или имена тех, кто пошёл бы за ним; confidence — high, mid или low.',
      'Формат: {"candidates":[{"who":"","source":"","motive":"","access":"","reach":"","contact":"","methods":[],"limits":[],"responseStyle":"","ties":"","charFriend":false,"allies":[],"confidence":""}]}',
    ].join('\n').replace(HERO_RE, (w) => W[HERO_FORMS[w.toLowerCase()]] || w),
  };
}

export function buildNpcPrompt(state, preset, opts = {}) {
  const { W, lines } = context(state, preset, opts);
  return {
    system: 'Ты помощник ведущего ролевой игры. Отвечаешь одним JSON-объектом и ничем больше: без пояснений, без markdown.',
    user: [
      ...lines,
      '',
      `Среди известных людей нет подходящего, кто стал бы систематически травить ${W.heroAcc}. Придумай одного нового ученика того же курса, который мог бы это делать.`,
      `name — имя и фамилия в духе этого мира, не совпадающие с уже названными людьми, ${W.heroIns} и Char; post — его положение: ученик того же курса или факультета, без выдуманных должностей, титулов, родства с известными персонажами и влияния; motive — понятная причина травить именно ${W.heroAcc} из настоящего (соперничество групп, статус, ревность, поведение ${W.heroGen} в сыгранных сценах), без выдуманного прошлого с ${W.heroIns} и с Char («в прошлом году», «давняя обида»); access — где он встречается с ${W.heroIns} каждый день;` + ' methods — 2–4 способа давления разного уровня, в его характере; limits — чего он не сделает; responseStyle — как он отвечает на отпор героини (не отступает сразу: давит иначе, зовёт своих, мстит исподтишка — по характеру, одной фразой); looks — внешность для портрета: кто это и сколько лет (совершеннолетний), волосы, лицо, одежда, приметы, до 160 символов; manner — как он пишет в чате курса: длина реплик, грамотность и регистр, словарь, прямота или грубость, юмор (приметы письма, не характер; до 140 символов).',
      'Формат: {"name":"","post":"","motive":"","access":"","methods":[],"limits":[],"responseStyle":"","looks":"","manner":""}',
    ].join('\n').replace(HERO_RE, (w) => W[HERO_FORMS[w.toLowerCase()]] || w),
  };
}

const SOURCE_MAP = [[/^(?:scene|сцен|истор)/, 'scene'], [/^(?:lore|книг|лорбук)/, 'lore'], [/^(?:canon|канон)/, 'canon'], [/^(?:guess|догад|предпол)/, 'guess']];
const REACH_MAP = [[/^(?:course|курс)/, 'course'], [/^(?:faculty|факульт)/, 'faculty'], [/^(?:other|друг|иное)/, 'other']];
const oneOf = (map, v, fallback) => { const t = str(v, 40).toLowerCase(); const hit = t && map.find(([re]) => re.test(t)); return hit ? hit[1] : fallback; };
const truthy = (v) => v === true || (typeof v === 'string' && /^(?:true|да|yes)$/i.test(v.trim()));

export function parsePick(text) {
  const data = typeof text === 'string' ? extractJson(text) : text;
  if (data === undefined || data === null || typeof data !== 'object') return null;
  const rows = Array.isArray(data) ? data : ['candidates', 'people', 'result'].map((k) => data[k]).find((v) => Array.isArray(v));
  if (!rows) return data.none === true || data.candidate === null ? { candidates: [] } : null;
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const who = str(pickOf(r, ['who', 'id', 'name', 'кто']), 80);
    if (!who) continue;
    const conf = str(pickOf(r, ['confidence', 'уверенность']), 20).toLowerCase();
    out.push({
      who,
      source: oneOf(SOURCE_MAP, pickOf(r, ['source', 'источник']), 'guess'),
      motive: str(pickOf(r, ['motive', 'мотив']), 200),
      access: str(pickOf(r, ['access', 'доступ']), 160),
      reach: oneOf(REACH_MAP, pickOf(r, ['reach', 'охват']), 'course'),
      contact: str(pickOf(r, ['contact', 'контакт']), 160),
      methods: list(pickOf(r, ['methods', 'способы']), 4, 120),
      limits: list(pickOf(r, ['limits', 'пределы']), 3, 100),
      responseStyle: str(pickOf(r, ['responseStyle', 'response_style', 'ответ на отпор', 'реакция на отпор']), 160),
      ties: str(pickOf(r, ['ties', 'связи']), 200),
      charFriend: truthy(pickOf(r, ['charFriend', 'char_friend'])),
      allies: list(pickOf(r, ['allies', 'союзники']), 4, 60),
      confidence: /^(?:low|низк|слаб)/.test(conf) ? 'low' : /^(?:high|высок)/.test(conf) ? 'high' : 'mid',
    });
    if (out.length >= PICK_CANDIDATES_MAX) break;
  }
  return { candidates: out };
}

export function parseNpc(text) {
  const data = typeof text === 'string' ? extractJson(text) : text;
  const r = Array.isArray(data) ? data[0] : data && (data.npc || data.student || data.character || data);
  if (!r || typeof r !== 'object') return null;
  const name = str(pickOf(r, ['name', 'имя']), 80);
  const motive = str(pickOf(r, ['motive', 'мотив']), 200);
  if (!name || !motive) return null;
  return {
    name, post: str(pickOf(r, ['post', 'position', 'положение']), 60), motive, access: str(pickOf(r, ['access', 'доступ']), 160),
    methods: list(pickOf(r, ['methods', 'способы']), 4, 120), limits: list(pickOf(r, ['limits', 'пределы']), 3, 100),
    responseStyle: str(pickOf(r, ['responseStyle', 'response_style', 'ответ на отпор', 'реакция на отпор']), 160),
    looks: str(pickOf(r, ['looks', 'appearance', 'внешность']), 200),
    manner: str(pickOf(r, ['manner', 'как пишет']), 140),
  };
}

const FRIEND_RE = /друж|(?<![а-яё])друг(?:а|у|ом|е|и|ья|ей|ьям|ьями)?(?![а-яё])|приятел|товарищ|из-за (?:char|него|неё|нее|его)/iu;
const CONFLICT_RE = /конфликт|соперн|ревн|недовер|враж|обид|зависть|завист|месть|мстит|предал|подозре|не доверя|спор о|поссор/iu;
const ADULT_RE = /преподав|учител|профессор|наставник|директор|декан|куратор|завуч/iu;

const people = (state) => (Array.isArray(state && state.classmates) ? state.classmates : []).filter((c) => c && c.id);

function findPerson(state, written) {
  const id = resolveBully(state, written);
  if (id) return people(state).find((c) => c.id === id);
  const key = normName(written);
  return people(state).find((c) => (c.aliases || []).some((a) => normName(a) === key)) || null;
}

const isTeacher = (state, written) => {
  const key = normName(written);
  return Boolean(key) && (Array.isArray(state && state.teachers) ? state.teachers : []).some((t) => t && [t.name, shortName(t.name || ''), ...(t.aliases || [])].some((n) => normName(n) === key));
};

export function rejectReason(state, preset, c, opts = {}) {
  const b = bullyingOf(state);
  const person = findPerson(state, c.who);
  if (isTeacher(state, c.who)) return 'наставник, а не ученик';
  const canon = Boolean(str(state && state.survey && state.survey.canon));
  if (!person) {
    if (c.source !== 'canon' || (c.reach === 'course' && !canon)) return 'нет такого человека среди известных';
    if (opts.outsiders === false) return 'нет такого человека среди известных';
  } else {
    if ([].concat(opts.exclude || []).includes(person.id)) return 'уже подбирали: нужен другой';
    if (b.ally && person.id === b.ally) return 'союзник героини';
    if (skipIds(state).includes(person.id)) return 'игрок назвал: не травит';
    if (Number(person.relation) > classmateStart(preset)) return 'друг героини';
    if (ADULT_RE.test([person.seed, person.club, person.desire, person.problem].filter(Boolean).join(' '))) return 'по описанию взрослый';
  }
  if (!c.motive) return 'нет мотива';
  if (!c.access || /^(?:нет|нету|none|-|—|n\/a)\.?$/iu.test(c.access)) return 'нет доступа к героине';
  if (c.reach === 'other' && !c.contact) return 'другое заведение без установленного контакта';
  if (c.confidence === 'low') return 'основание слабое';
  const chars = [].concat(opts.char || []).map((n) => normName(n)).filter(Boolean);
  const mentionsChar = chars.some((n) => normName(c.motive).includes(n));
  if (c.charFriend && (FRIEND_RE.test(c.motive) || mentionsChar) && !CONFLICT_RE.test(c.motive)) return 'друг Char без собственного конфликта';
  return '';
}

export function choosePick(state, preset, parsed, opts = {}) {
  const rejected = [];
  for (const c of (parsed && parsed.candidates) || []) {
    const why = rejectReason(state, preset, c, opts);
    if (why) { rejected.push({ who: c.who, why }); continue; }
    const person = findPerson(state, c.who);
    const source = person && c.source === 'lore' && person.source !== 'lorebook' ? (person.source === 'npc' ? 'npc' : 'guess') : c.source;
    const allies = c.allies.map((w) => { const p = findPerson(state, w); return p ? p.id : ''; }).filter((id) => id && (!person || id !== person.id));
    const pick = normalizePick({
      id: person ? person.id : '?', source, motive: c.motive, access: c.access, methods: c.methods, limits: c.limits, responseStyle: c.responseStyle, ties: c.ties,
      confidence: c.confidence, allies,
    });
    if (pick) return { pick, newcomer: person ? '' : c.who, rejected };
    rejected.push({ who: c.who, why: 'нет мотива' });
  }
  return { pick: null, newcomer: '', rejected };
}

export async function pickBully(state, preset, ask, opts = {}) {
  const out = { status: 'failed', pick: null, newcomer: '', npc: null, rejected: [], calls: 0 };
  const run = async (prompt, parse) => {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      out.calls += 1;
      const res = await ask(attempt === 1 ? prompt : { ...prompt, user: `${prompt.user}\n\nПредыдущий ответ не разобрался. Верни только JSON.` });
      if (!res || !res.ok) return { error: (res && (res.message || res.error)) || 'запрос не удался' };
      const got = parse(res.text);
      if (got) return { got };
      if (res.truncated) break;
    }
    return { error: 'ответ модели не разобрался' };
  };
  const first = await run(buildPickPrompt(state, preset, opts), parsePick);
  if (!first.got) return { ...out, error: first.error };
  const chosen = choosePick(state, preset, first.got, opts);
  out.rejected = chosen.rejected;
  if (chosen.pick) return { ...out, status: 'found', pick: chosen.pick, newcomer: chosen.newcomer };
  if (!bullyingOf(state).npcOk) return { ...out, status: 'denied' };
  const second = await run(buildNpcPrompt(state, preset, opts), parseNpc);
  if (!second.got) return { ...out, error: second.error };
  return { ...out, status: 'found', npc: second.got };
}

export function pickKeyOf(state) {
  const b = bullyingOf(state);
  return [people(state).map((c) => c.id).sort().join(','), normName(b.skip), b.npcOk ? 'n' : '-'].join('|').slice(0, 80);
}

export function pickWanted(state) {
  if (!state || !state.started) return false;
  const b = bullyingOf(state);
  if (!b.on || b.mode !== 'auto' || b.manual || b.pick || !people(state).length) return false;
  if (b.pickState === 'failed') return b.pickDay !== (state.calendar && state.calendar.day);
  return b.pickKey !== pickKeyOf(state);
}

export function applyPick(state, preset, result, opts = {}) {
  const next = cloneState(state);
  const b = bullyingOf(next);
  const day = (next.calendar && next.calendar.day) || '';
  b.pickKey = opts.key || pickKeyOf(next);
  b.pickDay = day;
  b.pickState = ['found', 'none', 'denied', 'failed'].includes(result.status) ? result.status : 'failed';
  if (result.status === 'found') {
    let pick = result.pick;
    const start = classmateStart(preset);
    if (result.npc) {
      const n = result.npc;
      const made = addClassmate(next, {
        name: n.name, source: 'npc', seed: 'задира', desire: n.motive, club: n.post, looks: n.looks || undefined, manner: n.manner || undefined, relation: start, locked: false,
      }, preset, { stop: opts.stop });
      if (made.ok) pick = normalizePick({ id: made.id, source: 'npc', motive: n.motive, access: n.access, methods: n.methods, limits: n.limits, responseStyle: n.responseStyle, ties: '', confidence: 'mid', fresh: true });
      else b.pickState = 'failed';
    } else if (pick && result.newcomer) {
      const made = addClassmate(next, { name: result.newcomer, source: 'generated', ...(str(next.survey && next.survey.canon) ? { canon: true } : {}), relation: start, locked: false }, preset, { stop: opts.stop });
      const known = made.ok ? made.id : made.code === 'known' ? made.id : '';
      pick = known ? { ...pick, id: known } : null;
      if (!pick) b.pickState = 'failed';
    }
    if (pick && b.pickState === 'found') {
      b.pick = pick;
      if (!b.manual) {
        if (b.lead !== pick.id) Object.assign(b, { lead: pick.id, crew: [], pending: null });
      }
    }
  }
  if (b.pickState === 'none' || b.pickState === 'denied') {
    if (!b.manual) Object.assign(b, { lead: '', crew: [], pending: null });
  }
  next.bullying = normalizeBullying(b);
  return next;
}

export function pickStatusWords(state) {
  const b = bullyingOf(state);
  if (!b.on) return '';
  if (b.manual) return '';
  if (b.mode === 'self') return b.lead ? '' : 'Зачинщик не выбран: назначьте его во вкладке «Люди».';
  if (b.pickState === 'denied' || b.pickState === 'none') return 'Подходящий участник пока не найден.';
  if (b.pickState === 'failed') return 'Подбор не удался, пока работает запасной выбор. Нажмите «Подобрать заново».';
  if (!b.pick) return 'Подбор ещё не проводился.';
  return '';
}

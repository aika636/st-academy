// core/scene — что секретарь увидел в сцене про людей (шаг 3): кто был,
// кто с кем сцепился, какой слух пустили, какое имя мелькнуло впервые, что
// кому обещано.
//
// Это блок «что было» ответа секретаря: факты сцены. Только они меняют
// состояние (решение 1 владелицы): «был в сцене» и дела — в `state.feed`,
// стычка и прозвучавший слух — фактом в ленту, новое имя — кандидатом в курс
// (`classmates.addCandidate`, галочку ставит человек). Отношение однокурсника
// (`rel=`) сюда не входит: его двигает движок той же функцией, что у
// преподавателей (`relations.changeRelation`).
//
// Блок «что сочинено» — реакции — состояния не меняет и ничего не
// подтверждает; в ленту он ложится отдельно (`applyReactions`), и каждая
// реакция держится за свой факт.
//
// Плюс «встречи без секретаря» (`razbor-inject.md`, приём 10): имя
// однокурсника, мелькнувшее в ответе, — отметка «был в сцене» без запроса.
// Секретарь потом уточняет.
//
// Две формы на каждое событие: `applySceneEvent` с квитанцией (поправка к
// старому ответу, `core/corrections`) и `applySceneEvents` пачкой (пересчёт
// последнего ответа: квитанции не нужны, ход откатывается снимком).

import { cloneState } from './state.mjs';
import * as course from './classmates.mjs';
import { HEROINE, isCardParty, cardPartyName } from './parse-marker.mjs';
import { normName, stopHit } from './stop-names.mjs';
import { gradeInfo } from './exams.mjs';
import {
  ensureFeed, addFeedItem, removeFeedItem, markSeen, restoreSeen,
  openDeal, closeDeal, revertDeal, putReactions, unmarkPlayed, hash, postByRef,
} from './feed.mjs';

/** Виды фактов курса — ключи метки, которые ложатся сюда. */
export const SCENE_KINDS = ['met', 'clash', 'rumor', 'new', 'deal'];

/** Люди состояния для слов и поиска: преподаватели и курс. */
export function peopleOf(state) {
  return [
    ...((state && state.teachers) || []),
    ...((state && state.classmates) || []),
  ].filter((p) => p && p.id);
}

/** Человек словом: имя, «героиня» (или её имя), а незнакомый id — как есть. */
export function personWord(id, people, heroine = '') {
  if (id === HEROINE) return heroine || 'героиня';
  if (isCardParty(id)) return cardPartyName(id);
  const p = (people || []).find((x) => x && x.id === id);
  return (p && (p.name || p.id)) || String(id || 'кто-то');
}

/**
 * Сторона дела, которой больше нет в списках (человека удалили): не голый
 * id и не «кто-то с курса» — дело помнит, что человек был.
 */
export const GONE_PERSON = { nom: 'тот, кого уже нет в списке', dat: 'тому, кого уже нет в списке' };

/**
 * Факт словами — для плашки и для записи ленты: «в сцене: Вера Соколова»,
 * «стычка: Вера Соколова и Светлана Петрова — из-за конспекта», «слух: Вера
 * Соколова — списала контрольную». Имя в слухе — в именительном: склонять
 * фамилию надёжно нельзя, а «слух о Вера Соколова» хуже, чем без падежа.
 */
export function sceneText(ev, people, heroine = '') {
  const who = (id) => personWord(id, people, heroine);
  if (!ev) return '';
  if (ev.kind === 'met') return `в сцене: ${who(ev.personId)}`;
  if (ev.kind === 'clash') return `стычка: ${who(ev.a)} и ${who(ev.b)}${ev.reason ? ` — ${ev.reason}` : ''}`;
  if (ev.kind === 'rumor') return `слух: ${who(ev.about)} — ${ev.text}`;
  if (ev.kind === 'new') return `новое лицо: ${ev.name}`;
  if (ev.kind === 'deal') return dealText(ev, people, heroine);
  return '';
}

/** Отчество: «Сергеевна», «Ильич», «Петрович». */
const PATRONYMIC = /^[А-ЯЁ][а-яё]+(?:овна|евна|ична|инична|ович|евич|ич)$/u;

/** Русская фамилия по окончанию: «Орлова», «Громов», «Вяземский». */
const SURNAME = /^[А-ЯЁ][а-яё-]+(?:ова|ева|ёва|ина|ына|ов|ев|ёв|ин|ын|ский|ская|цкий|цкая|ской|ых|их|ко|ук|юк|ец)$/u;

/**
 * Короткое имя для слов рассказчику и ленты (третий прогон 08.10): полное
 * ФИО в каждом поводе читалось как ведомость. Преподаватель — фамилией
 * («Орлова Марина Сергеевна» → «Орлова», «Марина Сергеевна Орлова» →
 * «Орлова»); однокурсник — имя и фамилия без отчества. Не узнали, где
 * фамилия, — имя как есть: лучше длинно, чем чужим словом.
 *
 * @param {string} name
 * @param {{teacher?: boolean}} [opts]
 */
export function shortName(name, { teacher = false } = {}) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return words.join(' ');
  const pat = words.findIndex((w, i) => i > 0 && PATRONYMIC.test(w));
  // Без отчества: «Имя Фамилия» или «Фамилия Имя».
  const rest = pat >= 0 ? words.filter((_, i) => i !== pat) : words.slice();
  let surname = '';
  if (pat === 1 && words.length >= 3) surname = words[2];
  else if (pat === 2) surname = words[0];
  else if (rest.length === 2) surname = rest.find((w) => SURNAME.test(w)) || '';
  if (teacher) return surname || words.join(' ');
  if (rest.length === 2) return rest.join(' ');
  return words.join(' ');
}

/** Причина стычки, которая сама начинается предлогом: «из-за конспекта». */
const REASON_LEAD = /^(?:из-за|из|за|по|в|во|на|о|об|обо|при|после|у|с|со|насчёт|насчет|ради)\s/iu;

/**
 * «О чём» под постом ленты — мелкой серой строкой на плашке и во вкладке:
 * «Вера Соколова и Ренее — стычка из-за конспекта», «Никита Громов был в
 * сцене», «Вера Соколова — списала контрольную (слух)». Без «по поводу» и
 * без второго двоеточия: подпись поста — не строка протокола (третий прогон
 * 08.10).
 */
export function sceneAbout(ev, people, heroine = '') {
  const who = (id) => personWord(id, people, heroine);
  if (!ev) return '';
  if (ev.kind === 'clash') {
    const reason = String(ev.reason || '').trim();
    const why = !reason ? '' : REASON_LEAD.test(reason) ? ` ${reason}` : `: ${reason}`;
    return `${who(ev.a)} и ${who(ev.b)} — стычка${why}`;
  }
  if (ev.kind === 'met') {
    const name = who(ev.personId);
    const g = ev.personId === HEROINE ? 'f' : genderOfName(name);
    return g === 'f' ? `${name} была в сцене` : g === 'm' ? `${name} был в сцене` : `в сцене — ${name}`;
  }
  if (ev.kind === 'rumor') return `${who(ev.about)} — ${ev.text} (слух)`;
  if (ev.kind === 'deal') return dealText(ev, people, heroine);
  return sceneText(ev, people, heroine);
}

/**
 * Суть факта одной фразой — для записи лорбука и фона: «Вера Соколова
 * списала контрольную», «Мила Орлова и Вера Соколова поссорились (из-за
 * тетради)». Ложится после «говорят, что…»: секретарь пишет «что» слуха
 * продолжением этой фразы (`analysis.buildAnalysisPrompt`). Пусто — у факта
 * нет сути для пересказа.
 */
export function sceneGist(ev, people, heroine = '') {
  const who = (id) => personWord(id, people, heroine);
  if (!ev) return '';
  if (ev.kind === 'rumor') return `${who(ev.about)} ${ev.text}`;
  if (ev.kind === 'clash') return `${who(ev.a)} и ${who(ev.b)} поссорились${ev.reason ? ` (${ev.reason})` : ''}`;
  return '';
}

// --- дело словами: «Мила должна Вере: вернуть тетрадь» ---------------------------
//
// Стрелка «Мила → Вера» читалась схемой, а не жизнью. Фраза с падежом
// нужна в одном месте — кому должны, — и склоняется только то, что
// склоняется надёжно: первое слово имени русского вида. Чего не знаем
// (иностранное имя на согласную, «-ь»), то не склоняем, а говорим без
// направления: «Мила и Мэй: вернуть тетрадь».

/**
 * Что накладывают на человека, а не должны ему: отработка, взыскание, штраф, и то,
 * что ему поручают: работа, явка, уборка, дежурство (баг 88).
 */
const PENALTY_WORDS = /отработк|отрабат|наказани|наказан|взыскани|штраф|нарядов?(?![а-яё])|работ[аыуе](?![а-яё])|явк[аиу](?![а-яё])|явитьс|явиться|уборк|убор(?:ка|ки|ку)(?![а-яё])|дежурств|дежурит/i;

/** Мужские имена на -а/-я: «Никита должен», а не «должна». */
const MALE_A = new Set(['никита', 'илья', 'миша', 'гоша', 'леша', 'паша', 'дима', 'ваня', 'петя', 'коля', 'вася',
  'сережа', 'митя', 'костя', 'толя', 'юра', 'федя', 'гриша', 'кузьма', 'фома', 'савва', 'лука', 'данила',
  'гаврила', 'тема', 'вова', 'сеня', 'боря', 'лева', 'гена', 'жора', 'степа', 'валера', 'рома', 'кеша', 'яша', 'алеша']);

/** Общие имена: пол по имени не сказать. */
const BOTH_A = new Set(['саша', 'женя', 'слава', 'валя', 'шура', 'тоша', 'сима']);

/** Беглая гласная: «Лев» → «Льву». */
const DATIVE_SPECIAL = { лев: 'Льву', павел: 'Павлу', петр: 'Петру' };

function firstWord(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

/**
 * Первое слово имени в дательном падеже: «Вера» → «Вере», «Глеб» → «Глебу»,
 * «Соколова» → «Соколовой», «Мария» → «Марии». Несклоняемое на гласную
 * («Юки», «Ли») и латиница — как есть. Не знаем — `null`.
 */
export function dativeName(name) {
  const w = firstWord(name);
  if (!w) return null;
  if (/^[A-Za-z][A-Za-z'-]*$/.test(w)) return w;
  if (!/^[А-ЯЁ][а-яё-]*$/.test(w)) return null;
  const low = w.toLowerCase().replace(/ё/g, 'е');
  if (DATIVE_SPECIAL[low]) return DATIVE_SPECIAL[low];
  if (/[оеиуюэы]$/.test(low)) return w;
  // Фамилия на -ова/-ева, -ская: «Соколовой». На -ина — нет: так кончаются и
  // имена (Марина, Ирина), а первое слово чаще имя.
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

/** Пол по первому слову имени: 'f', 'm' или `null` — не знаем. */
export function genderOfName(name) {
  const low = firstWord(name).toLowerCase().replace(/ё/g, 'е');
  if (!/^[а-я-]+$/.test(low)) return null;
  if (BOTH_A.has(low)) return null;
  if (/[ая]$/.test(low)) return MALE_A.has(low) ? 'm' : 'f';
  if (/(?:[бвгджзклмнпрстфхцчшщ]|[еаиоу]й)$/.test(low)) return 'm';
  return null;
}

/**
 * Дело словами: «Мила должна Вере: вернуть тетрадь»; закрытое — «закрыто:
 * Мила и Вера — вернуть тетрадь». Удалённая сторона — «тот, кого уже нет в
 * списке»; кому должны, не склоняется — «Мила и Мэй: вернуть тетрадь».
 */
export function dealText(ev, people, heroine = '') {
  if (!ev) return '';
  // Наказание и отработку несёт тот, на кого их наложили: «Магистр должен
  // Ренее: две секции отработки» — перепутанное направление (живой прогон
  // 10.10). Разборщик записывает «кто назначил → кому», а читать надо наоборот.
  if (!ev.closed && ev.b === HEROINE && ev.a !== HEROINE && PENALTY_WORDS.test(String(ev.what || ''))) {
    return dealText({ ...ev, a: ev.b, b: ev.a }, people, heroine);
  }
  const known = (id) => id === HEROINE || isCardParty(id) || (people || []).some((x) => x && x.id === id);
  const nom = (id) => (known(id) ? personWord(id, people, heroine) : GONE_PERSON.nom);
  const a = nom(ev.a);
  const b = nom(ev.b);
  if (ev.closed) return `закрыто: ${a} и ${b} — ${ev.what}`;
  const dat = known(ev.b) ? (ev.b === HEROINE && !heroine ? 'героине' : dativeName(b)) : GONE_PERSON.dat;
  // Род героини — по её имени; не определился (латиница, «Ренее», «Саша») — женский.
  const g = known(ev.a) ? (ev.a === HEROINE ? (genderOfName(a) || 'f') : genderOfName(a)) : 'm';
  if (!dat) return `${a} и ${b}: ${ev.what}`;
  const verb = g === 'f' ? 'должна' : g === 'm' ? 'должен' : 'обещает';
  // «Тот, кого уже нет в списке, должен…» — придаточное закрывается запятой.
  const line = `${known(ev.a) ? a : `${a},`} ${verb} ${dat}: ${ev.what}`;
  return line[0].toUpperCase() + line.slice(1);
}

/** Касается ли факт героини — для мягкого знания ленты. */
function aboutOf(ev) {
  if (!ev) return [];
  if (ev.kind === 'clash' || ev.kind === 'deal') return [ev.a, ev.b];
  if (ev.kind === 'rumor') return [ev.about];
  if (ev.kind === 'met') return [ev.personId];
  if (ev.kind === 'rel') return [ev.teacherId, HEROINE];
  // Оценки, прогулы, события — героини.
  return [HEROINE];
}

/** Id записи ленты для факта: один и тот же при пересчёте того же ответа. */
function factId(src, token) {
  return `${src}@${hash(token)}`;
}

/**
 * Применить один факт курса. Правит копию.
 *
 * @param {Object} state
 * @param {Object} ev событие разборщика (`met`/`clash`/`rumor`/`new`/`deal`)
 * @param {Object} preset
 * @param {{src?: string, token?: string, day?: string, time?: string, stop?: *, heroine?: string}} [opts]
 * @returns {{state: Object, receipt: ?Object}}
 */
export function applySceneEvent(state, ev, preset, opts = {}) {
  if (!ev || !SCENE_KINDS.includes(ev.kind)) return { state, receipt: null };
  const next = cloneState(state);
  const receipt = placeEvent(next, ev, preset, opts);
  return { state: next, receipt };
}

/** Пачка фактов одного ответа — на месте пересчёта, без квитанций. */
export function applySceneEvents(state, items, preset, opts = {}) {
  const list = (items || []).filter((x) => x && x.ev && SCENE_KINDS.includes(x.ev.kind));
  if (!list.length) return state;
  const next = cloneState(state);
  for (const { ev, token } of list) placeEvent(next, ev, preset, { ...opts, token });
  return next;
}

function placeEvent(next, ev, preset, opts) {
  const src = opts.src || '';
  const token = opts.token || '';
  const at = { day: opts.day || (next.calendar && next.calendar.day) || '', time: opts.time || '' };

  if (ev.kind === 'met') {
    const prev = markSeen(next, ev.personId, at);
    return { kind: 'met', personId: ev.personId, prev };
  }

  if (ev.kind === 'clash' || ev.kind === 'rumor') {
    const about = aboutOf(ev);
    const id = addFeedItem(next, {
      id: factId(src, token),
      src,
      at,
      factRef: token,
      kind: 'fact',
      who: ev.kind === 'clash' && !isCardParty(ev.a) ? ev.a : '',
      chan: 'chat',
      text: sceneText(ev, peopleOf(next), opts.heroine),
      gist: sceneGist(ev, peopleOf(next), opts.heroine),
      rumor: ev.kind === 'rumor',
      truth: null,
      about,
      heroine: about.includes(HEROINE),
      // Сцена без свидетелей (`analysis` `private=`): в молву идёт только слухом.
      private: Boolean(opts.privateRefs && opts.privateRefs.has(hash(token))),
    });
    return id ? { kind: 'feed', id } : null;
  }

  if (ev.kind === 'new') {
    if (typeof course.addCandidate !== 'function') return null;
    const had = new Set((next.classmateCandidates || []).map((c) => c && c.id));
    const id = course.addCandidate(next, { name: ev.name, source: 'scene' }, { stop: opts.stop, preset });
    if (!id) return null;
    return { kind: 'candidate', id, created: !had.has(id) };
  }

  if (ev.kind === 'deal') {
    const fields = { a: ev.a, b: ev.b, what: ev.what, src, day: at.day };
    const r = ev.closed ? closeDeal(next, fields) : openDeal(next, fields);
    if (!r.id) return null;
    return { kind: 'deal', ...r };
  }
  return null;
}

// --- заметные факты о героине (баг 77) -----------------------------------------------------
//
// Прогул, опоздание, провал или триумф на контрольной, громкая оценка — курс это
// видит, а молва о таком молчала: в факты шли только стычка и слух. Такой факт
// публичный (прогул наедине не бывает) и ложится в ленту с пометкой `minor`: тема
// слота «Главные» с низким приоритетом (после стычек и слухов, в квоте трети), но не
// пункт ленты, не повод рассказчику и не фон сцены — героиня и так про себя знает.

/** Что в разборе считается заметным (ключ — вид события разборщика). */
export const NOTABLE_KINDS = ['attendance', 'grade'];

/** Подпись по роду имени: «прогуляла» / «прогулял» / безличная форма. */
function byGender(g, f, m, n) {
  return g === 'f' ? f : g === 'm' ? m : n;
}

/**
 * Заметный факт из события разбора: `{text, gist, loud}` либо `null`, если событие
 * ничем не примечательно (обычная оценка при тихом разборе).
 *
 * @param {Object} ev событие разборщика (`attendance` или `grade`)
 * @param {Object} state
 * @param {Object} preset
 * @param {{heroine?: string, loud?: ?number}} [opts] имя героини и громкость разбора
 */
export function notableFact(ev, state, preset, opts = {}) {
  if (!ev || !NOTABLE_KINDS.includes(ev.kind)) return null;
  const H = String(opts.heroine || '').trim() || 'героиня';
  const g = genderOfName(H);
  const loud = Number.isInteger(opts.loud) ? opts.loud : null;
  const subject = (((state && state.subjects) || []).find((s) => s && s.id === ev.subjectId) || {}).name || ev.subjectId || '';
  const subj = subject ? ` «${subject}»` : '';
  let gist = '';
  let level = loud === null ? 1 : loud;
  if (ev.kind === 'attendance') {
    if (ev.status === 'late') gist = byGender(g, `${H} опоздала на${subj}`, `${H} опоздал на${subj}`, `у ${H} опоздание —${subj}`);
    else {
      gist = byGender(g, `${H} прогуляла${subj}`, `${H} прогулял${subj}`, `у ${H} прогул —${subj}`);
      level = Math.max(level, 2);
    }
  } else {
    const info = gradeInfo(preset, ev.value);
    // Триумф — лучший балл шкалы пресета; у шкалы «зачёт/незачёт» баллов нет, и триумфа тоже.
    const points = (((preset && preset.grades && preset.grades.values) || []).map((v) => v && v.points)).filter((p) => typeof p === 'number');
    const fail = Boolean(info) && info.pass === false;
    const triumph = Boolean(info) && !fail && typeof info.points === 'number' && points.length > 0 && info.points >= Math.max(...points);
    const mark = String(ev.value);
    if (fail) gist = byGender(g, `${H} провалила${subj} (${mark})`, `${H} провалил${subj} (${mark})`, `у ${H} провал —${subj} (${mark})`);
    else if (triumph) gist = byGender(g, `${H} блеснула на${subj} (${mark})`, `${H} блеснул на${subj} (${mark})`, `у ${H} триумф —${subj} (${mark})`);
    else if (loud !== null && loud >= 2) gist = byGender(g, `${H} получила ${mark} по${subj}`, `${H} получил ${mark} по${subj}`, `у ${H} оценка ${mark} по${subj}`);
    if (fail || triumph) level = Math.max(level, 2);
  }
  return gist ? { text: gist, gist, loud: Math.max(0, Math.min(3, level)) } : null;
}

/**
 * Громкая сцена без своего факта (баг 79): секретарь поставил `loud=2+`, а факт отвергнут
 * или его не было. Сцена при всех всё равно случилась с героиней — это повод слота
 * «Главные». Если в ответе есть стычка, слух, дело, новое лицо или заметный факт, он и несёт громкость.
 * Идемпотентно (id от отпечатка ответа). Возвращается копия или то же состояние.
 *
 * @param {Object} state
 * @param {Array<{ev: Object, token: string}>} items события разбора
 * @param {Object} preset
 * @param {{src?: string, day?: string, time?: string, heroine?: string, loud?: ?number}} [opts]
 */
export function applyLoudScene(state, items, preset, opts = {}) {
  const loud = Number.isInteger(opts.loud) ? opts.loud : null;
  if (loud === null || loud < 2) return state;
  const list = items || [];
  if (list.some((x) => x && x.ev && (['clash', 'rumor', 'deal', 'new'].includes(x.ev.kind) || notableFact(x.ev, state, preset, opts)))) return state;
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

/**
 * Заметные факты пачки событий ответа — в ленту: публичные (не «наедине»), про
 * героиню, прочитанные, с пометкой `minor`. Идемпотентно: id от отпечатка ответа и
 * токена. Состояние не правится — возвращается копия (или оно же, если нечего класть).
 *
 * @param {Object} state
 * @param {Array<{ev: Object, token: string}>} items события разбора
 * @param {Object} preset
 * @param {{src?: string, day?: string, time?: string, heroine?: string, loud?: ?number}} [opts]
 */
export function applyNotableFacts(state, items, preset, opts = {}) {
  const list = (items || [])
    .filter((x) => x && x.ev && NOTABLE_KINDS.includes(x.ev.kind) && x.token)
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

/** Снять факт курса по квитанции. Возвращает копию. */
export function revertSceneEvent(state, receipt) {
  const next = cloneState(state);
  if (!receipt || typeof receipt !== 'object') return next;
  if (receipt.kind === 'met') restoreSeen(next, receipt.personId, receipt.prev);
  else if (receipt.kind === 'feed') removeFeedItem(next, receipt.id);
  else if (receipt.kind === 'deal') revertDeal(next, receipt);
  else if (receipt.kind === 'candidate') {
    // Кандидата, которого человек уже взял в курс, снятие разбора не трогает:
    // галочка — его решение, а не вывод секретаря.
    if (receipt.created && typeof course.dropCandidate === 'function') course.dropCandidate(next, receipt.id);
  }
  return next;
}

/**
 * Снять всё курсовое, что лежит от ответа `src`, без квитанций — по самому
 * отпечатку (как `corrections.receiptOf` для выводов, легших пересчётом):
 * записи ленты и дела этого ответа уходят, кандидаты с именами из `names`
 * — если ещё ждут галочки. Отметки «был в сцене» остаются: они не вред, а
 * следующий ответ их всё равно обновит. «Повод сыгран», поставленный этим
 * ответом (шаг 4), снимается: повод снова «взят».
 */
export function revertSceneSource(state, src, names = []) {
  const next = cloneState(state);
  if (!src) return next;
  if (next.feed) {
    const feed = ensureFeed(next);
    feed.items = feed.items.filter((x) => x.src !== src);
    feed.deals = feed.deals.filter((d) => d.src !== src);
    unmarkPlayed(next, src);
  }
  if (names.length && Array.isArray(next.classmateCandidates) && typeof course.sameName === 'function') {
    next.classmateCandidates = next.classmateCandidates.filter((c) => !(c && c.source === 'scene' && names.some((n) => course.sameName(c.name, n))));
  }
  return next;
}

/** Виды квитанций этого модуля — чтобы `corrections` знал, кому отдать снятие. */
export const SCENE_RECEIPTS = ['met', 'feed', 'candidate', 'deal'];

/**
 * Реакции сохранённого разбора — в ленту, с привязкой к фактам. Реакция,
 * чей факт вычеркнут (его нет среди `facts`), не ложится: ссылку проверяет
 * код, а не просьба к модели. Идемпотентно: прежние реакции ответа уходят.
 *
 * @param {Object} state
 * @param {string} src отпечаток ответа
 * @param {Array<{fact: string, who: string, chan: string, text: string}>} reactions
 * @param {Map<string, Object>} facts токен факта → его событие
 * @param {{day?: string, time?: string, cap?: number}} [opts]
 * @returns {Object} копия состояния
 */
export function applyReactions(state, src, reactions, facts, opts = {}) {
  const next = cloneState(state);
  const list = (reactions || []).filter((r) => r && facts.has(r.fact)).map((r) => {
    const ev = facts.get(r.fact);
    const about = aboutOf(ev);
    // Слух — только анонимка: реплика в чате про слух («Это неправда!») —
    // обсуждение, а не слух сама.
    return { ...r, about, heroine: about.includes(HEROINE), rumor: r.chan === 'anon' };
  });
  // Ответы в ветках (`analysis.repliesOf`): к посту ленты — по отпечатку его
  // id, который ищется здесь, в состоянии; поста уже нет — ответ не ложится.
  // Ник остаётся ником: ни «был в сцене», ни кандидатом он не становится.
  const replies = (opts.replies || []).map((a) => {
    if (!a || !a.parent) return null;
    if (a.parent.token) return a;
    const post = a.parent.ref ? postByRef(next, a.parent.ref) : null;
    return post ? { ...a, parent: { feed: post.id } } : null;
  }).filter(Boolean);
  putReactions(next, src, list, { ...opts, replies });
  return next;
}

// --- встречи без секретаря (приём 10) ------------------------------------------------
//
// Имя однокурсника в тексте ответа — «был в сцене». Бесплатно, без запроса,
// поэтому осторожно: целое слово с заглавной буквы, падежные окончания от
// основы (Соколова → Соколовой, Соколову; Глеб → Глебом), часть имени,
// общая для двух людей, или совпавшая с героиней и ботом, не считается.

const F_ENDINGS = ['а', 'я', 'ы', 'и', 'е', 'у', 'ю', 'ой', 'ей', 'ою', 'ею'];
const ADJ_ENDINGS = ['ий', 'ый', 'ой', 'ая', 'яя', 'ого', 'его', 'ому', 'ему', 'ым', 'им', 'ом', 'ую', 'юю', 'ей'];
const SOFT_ENDINGS = ['ь', 'й', 'я', 'ю', 'е', 'ем', 'ём', 'ей', 'и'];
const HARD_ENDINGS = ['', 'а', 'у', 'ом', 'ым', 'е', 'ой', 'ы'];
const CYR = /[а-яё]/;

/** Основа слова имени и окончания, которые она принимает. */
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

/**
 * Кого из людей называет текст.
 *
 * @param {string} text ответ без метки
 * @param {Array<{id: string, name: string}>} people кого искать (курс)
 * @param {*} [stop] стоп-лист: части, совпавшие с героиней и ботом, не ищутся
 * @returns {string[]} id найденных, по порядку списка
 */
export function mentionedPeople(text, people, stop = null) {
  const src = String(text || '').replace(/<!--[\s\S]*?-->/g, ' ');
  if (!src.trim()) return [];
  const list = (people || []).filter((p) => p && p.id && p.name);
  // Часть имени → чьё она. Общая для двоих — ничья.
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
      // С заглавной: «Вера» — имя, «вера» — слово.
      if (first !== first.toUpperCase() || first === first.toLowerCase()) continue;
      found.add(id);
      break;
    }
  }
  return list.map((p) => p.id).filter((id) => found.has(id));
}

/**
 * Отметить «был в сцене» всех однокурсников, названных в ответе. Отметка
 * локальная: секретарь того же дня важнее.
 *
 * @returns {{state: Object, met: string[]}}
 */
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

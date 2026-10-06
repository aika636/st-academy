// core/lorebook — что должно лежать в лорбуке академии и что изменилось с прошлого раза.
//
// Раздел 3.7 плана. Черты преподавателей («злопамятен, придирается к опозданиям»)
// в постоянном инжекте держать дорого — они съедают лимит из 3.3. Их место —
// World Info, где запись подгружается по ключу, только когда человек в сцене.
//
// Модуль решает **что** должно лежать в лорбуке, и ничего не относит в таверну:
// `createNewWorldInfo`, `saveWorldInfo` и `chat_metadata['world_info']` живут в
// слое расширения. Здесь — чистый план записей, который можно прогнать в Node.
//
// Четыре правила, ради которых модуль вообще существует.
//
// 1. **Правленую руками запись расширение больше не трогает** (3.7). Поэтому на
//    входе — снимок того, что уже лежит в лорбуке, а на выходе три исхода на
//    запись: создать, обновить, оставить как есть. «Оставить» — не отсутствие
//    действия, а решение, и оно называется вслух: по нему видно, почему запись
//    не обновилась.
// 2. **Хроника — только по значимым событиям.** Значимость здесь — предикат в
//    коде (`isSignificant`), а не вкус вызывающего: иначе за семестр набежит
//    двести записей и лорбук вытеснит из контекста всё остальное (риски, :598).
// 3. **Потолок числа записей — параметр пресета**, `limits.maxLorebookEntries`.
//    Уже существующие записи потолок не выселяет: удалять чужое из лорбука —
//    не наше дело, потолок только перестаёт добавлять новое.
// 4. **Ни одного слова языка в коде.** Тексты собираются из `preset.vocab` и
//    `preset.phrases.lorebook`; запасные шаблоны ниже — чистая склейка
//    подстановок и знаков препинания, без единого доменного слова. В японской
//    школе и в Хогвартсе те же записи должны получаться своими словами, и
//    правок в `core/` это требовать не должно (раздел 1 плана).
//
// Отдельно — **различие «сочинил» и «предложил»** (3.7). Преподаватели, устав и
// хроника берутся из механики: они точные и не врут, их расширение пишет само.
// Одногруппники, случайные NPC и места в состоянии не живут — про них расширение
// «может только предложить запись, а не сочинить её само», поэтому они уходят не
// в `create`, а в отдельный `suggest`, и без решения человека в лорбук не попадают.

import { labelFor, findSubject, findTeacher, teacherOfSubject } from './state.mjs';
import { milestones, milestoneName } from './milestones.mjs';
import { relationMemory } from './relations.mjs';

/** Категории записей из 3.7. Порядок — приоритет при потолке: устав важнее хроники. */
export const CATEGORIES = ['charter', 'people', 'places', 'chronicle'];

/** Причины, по которым запись оставлена как есть. Различимы: по ним видно поведение. */
export const KEEP_EDITED = 'edited';
export const KEEP_UNCHANGED = 'unchanged';
export const KEEP_FOREIGN = 'foreign';

/** Причины, по которым запись не создана. */
export const SKIP_CAP = 'cap';

/** Запасные значения на случай молчащего пресета. */
export const DEFAULTS = {
  maxEntries: 60,
  // Грубый делитель «символы → токены». Честно: это не токенизатор, а прикидка;
  // для кириллицы БПЕ-токен выходит короче латинского, отсюда 3, а не 4.
  charsPerToken: 3,
};

/**
 * Запасные шаблоны. Ни одного доменного слова — только подстановки и пунктуация,
 * иначе первый же чужой сеттинг получил бы русскую «пару» внутри английской записи.
 *
 * Исключение — фразы души наставника (`teacherPost` … `teacherSecret`): это
 * слова про человека, а не про заведение («любит», «тайна»), и сеттинга в них
 * нет. Каждая — отдельная фраза, которая дописывается к `teacher`, только если
 * поле не пустое: висящих «Любит: .» в лорбуке не бывает. Пресет перекрывает
 * любую из них тем же блоком `phrases.lorebook`.
 */
export const DEFAULT_TEMPLATES = {
  teacher: '{name} — {teacher}, {subject}. {traits}. {relation}.',
  teacherPost: 'Должность: {post}.',
  teacherLikes: 'Любит: {likes}.',
  teacherMemory: 'Помнит: {memory}.',
  // Тайна — для модели, а не для героини: без оговорки модель выложила бы её
  // в первой же сцене, и зацепка сгорела бы.
  teacherSecret: 'Тайна (героиня не знает; проявлять только намёками, прямо не раскрывать): {secret}.',
  charter: '{institution}. {term}, {period}, {examPeriod}. {gradebook}, {debtPlural}. {warning} → {expulsion}. {reputation}.',
  chronicleExam: '{day} — {subject}: {value} ({teacher}).',
  chronicleWarn: '{day} — {warning}: {reputation}.',
  chronicleExpel: '{day} — {expulsion}: {expelled}.',
  chronicleRelation: '{day} — {teacher}: {from} → {to}.',
  chronicleMilestone: '{day} — {milestone}.',
  place: '{name}. {note}',
  npc: '{name}. {note}',
};

// --- форма записи -----------------------------------------------------------

/**
 * @typedef {Object} Entry
 * @property {string}   uid       стабильный идентификатор: по нему запись узнаётся
 *                                в снимке следующего прогона. Не меняется никогда —
 *                                на нём держится всё различение «создать/обновить».
 * @property {string}   category  одна из `CATEGORIES`
 * @property {string[]} keys      ключи World Info; у постоянной записи пуст
 * @property {string}   content   текст записи
 * @property {boolean}  constant  постоянно активная (устав — единственная такая)
 * @property {number}   order     чем больше, тем раньше в контексте
 * @property {'own'|'suggested'} origin  сочинено механикой или только предложено
 * @property {string}   fingerprint отпечаток текста; ложится рядом с записью в
 *                                лорбуке и на следующем прогоне отвечает на
 *                                вопрос «правил ли это человек»
 */

/**
 * @typedef {Object} SnapshotEntry
 * @property {string}  uid
 * @property {string}  content
 * @property {string}  [fingerprint] отпечаток, который расширение записало, когда
 *                                   создавало запись
 * @property {boolean} [edited]      явный признак правки руками, если слой таверны
 *                                   умеет узнать это надёжнее отпечатка
 */

// --- отпечаток и замер ------------------------------------------------------

/**
 * Короткий стабильный отпечаток текста.
 *
 * Он и есть весь механизм правила «правленую руками запись не трогаем». У штатной
 * записи World Info нет поля «правил человек», спрашивать пользовательницу неоткуда,
 * поэтому расширение кладёт рядом с записью отпечаток того, что записало само. Если
 * на следующем прогоне отпечаток текста разошёлся с записанным — текст правили, и
 * запись больше не наша.
 *
 * Не криптография: задача — заметить правку, а не пережить подделку.
 */
export function fingerprint(text) {
  const s = String(text == null ? '' : text);
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c + i, 2654435761) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 12);
}

/**
 * Грубая оценка объёма в токенах.
 *
 * Именно оценка, а не подсчёт: настоящего токенизатора у ядра нет и быть не должно
 * (он тянет за собой словарь модели), а план требует измеримой проверки «сколько
 * токенов лорбук занимает к концу семестра» (:601). Делитель — параметр пресета:
 * у кириллицы и латиницы он разный.
 */
export function estimateTokens(text, preset) {
  return tokensOfChars(String(text == null ? '' : text).length, preset);
}

/** То же приближение, но по уже посчитанной длине: замеру строка целиком не нужна. */
function tokensOfChars(chars, preset) {
  const per = numberOr(limitsOf(preset).lorebookCharsPerToken, DEFAULTS.charsPerToken);
  return chars === 0 ? 0 : Math.ceil(chars / Math.max(1, per));
}

/**
 * Замер набора записей. `tokens` — приближение (см. `estimateTokens`), и называть
 * его точным числом нельзя ни в отчёте, ни в интерфейсе.
 *
 * @returns {{entries: number, chars: number, tokens: number}}
 */
export function measure(entries, preset) {
  const list = entries || [];
  // Ключи уезжают в контекст вместе с текстом — считать только `content` значит
  // занизить замер тем сильнее, чем больше в лорбуке коротких записей хроники.
  const chars = list.reduce((n, e) => n + String(e.content || '').length + (e.keys || []).join(',').length, 0);
  return { entries: list.length, chars, tokens: tokensOfChars(chars, preset) };
}

/** Потолок числа записей: параметр пресета, не константа кода (риски, :598). */
export function entryCap(preset, opts = {}) {
  return numberOr(opts.maxEntries, numberOr(limitsOf(preset).maxLorebookEntries, DEFAULTS.maxEntries));
}

// --- собственные записи: люди, устав, хроника -------------------------------

/**
 * Запись про преподавателя: предмет, характер, за что цепляется (3.7).
 * Ключ — имя и фамилия, поэтому в ключи идут и полное имя, и его части: в сцене
 * Петрову назовут то «Анна Сергеевна», то просто «Петрова».
 */
export function teacherEntry(state, teacherId, preset) {
  const teacher = findTeacher(state, teacherId);
  if (!teacher) return null;

  const subject = (state.subjects || []).find((s) => s.teacherId === teacher.id);
  const base = fill(templateOf(preset, 'teacher'), {
    ...vocabVars(preset),
    name: teacher.name,
    subject: (subject && subject.name) || '',
    traits: (teacher.traits || []).join(', '),
    relation: labelFor(relationLabels(preset), teacher.relation),
  });

  // Душа наставника — фразами вслед за основной, и только непустыми. Память —
  // те же последние сдвиги, что видит карточка «Люди», но поводами словами и
  // без чисел: число модели ни о чём не говорит (3.3), а «прогул: химия» —
  // зацепка. Сдвиг без повода сказать нечего — он выпадает.
  const memory = relationMemory(state, teacher.id, preset).map((m) => m.reason).filter(Boolean);
  const soul = [
    ['teacherPost', 'post', teacher.post],
    ['teacherLikes', 'likes', teacher.likes],
    ['teacherMemory', 'memory', memory.map(bare).join('; ')],
    ['teacherSecret', 'secret', teacher.secret],
  ]
    .map(([tpl, key, value]) => (bare(value) ? fill(templateOf(preset, tpl), { ...vocabVars(preset), [key]: bare(value) }) : ''))
    .filter(Boolean);
  const content = [base, ...soul].join(' ');

  return entry({
    uid: `academy:teacher:${teacher.id}`,
    category: 'people',
    keys: nameKeys(teacher.name),
    content,
    order: 50,
  });
}

/**
 * Устав: одна запись, постоянно активная. Она же объясняет модели, почему
 * репутация вообще чего-то стоит (3.7), — поэтому в ней и нынешний ярлык
 * репутации, а не только правила заведения.
 */
export function charterEntry(state, preset) {
  const content = fill(templateOf(preset, 'charter'), {
    ...vocabVars(preset),
    institution: (state.survey && state.survey.institution) || '',
    reputation: labelFor(reputationLabels(preset), state.reputation ? state.reputation.value : 0),
  });

  return entry({
    uid: 'academy:charter',
    category: 'charter',
    keys: [],
    constant: true,
    content,
    order: 100,
  });
}

// --- значимость события -----------------------------------------------------

/**
 * Значимо ли событие журнала настолько, чтобы завести под него запись хроники.
 *
 * Правило, а не вкус. Значимы ровно три вещи из плана (:471): контрольное
 * событие, отчисление на волоске и смена отношения через порог ярлыка. Оценка за
 * ответ у доски, отмеченное присутствие и любой ход календаря — не значимы: по
 * ним за семестр набегают те самые двести записей.
 *
 * Смена отношения меряется **ярлыком, а не числом**: `-1 → -2` внутри «недоволен»
 * ничего не изменило в сцене, а переход «недоволен» → «неприязнь» изменил.
 */
export function isSignificant(record, state, preset) {
  if (!record || typeof record !== 'object') return false;

  if (record.kind === 'exam') {
    // В журнал `exam` попадает и назначение сессии, и исход. Запись хроники
    // заслуживает только исход: у него есть выставленное значение.
    //
    // Исход, который ещё не объявлен (`data.private`, 9.4.3), — нет: запись
    // World Info подгрузится в промпт по имени предмета и выдаст оценку миру
    // раньше ведомости. В хронику он попадёт записью объявления — у неё тоже
    // есть значение, и дата у неё та, когда мир узнал.
    if (record.data && record.data.private) return false;
    return Boolean(record.data && record.data.value);
  }

  if (record.kind === 'reputation') {
    const scale = (preset && preset.reputation) || {};
    const from = numberOr(record.data && record.data.from, null);
    const to = numberOr(record.data && record.data.to, null);
    if (from === null || to === null) return false;
    const crossed = (threshold) => typeof threshold === 'number' && from > threshold && to <= threshold;
    return crossed(scale.expelAt) || crossed(scale.warnAt);
  }

  if (record.kind === 'rel') {
    const labels = relationLabels(preset);
    const from = numberOr(record.data && record.data.from, null);
    const to = numberOr(record.data && record.data.to, null);
    if (from === null || to === null) return false;
    return labelFor(labels, from) !== labelFor(labels, to);
  }

  return false;
}

/**
 * Какие вехи студента (`core/milestones.mjs`) уходят в хронику — ответ на
 * вопрос 8.5 «что ещё писать в лорбук».
 *
 * Не все, и по двум разным причинам:
 *
 * - `favorite`, `nemesis`, `onTheEdge` — это смена ярлыка отношения и порог
 *   репутации, которые хроника пишет и так (`isSignificant`). Второй записи о
 *   том же событии лорбук не заслуживает;
 * - `cleanWeek` — у недели без прогулов нет участника: ни предмета, ни
 *   наставника, ни места. Ключа World Info у записи не нашлось бы, а запись
 *   без ключа не подгрузится никогда — это мусор, которого 3.7 и боится.
 *
 * Остальные — первая высшая оценка, закрытый хвост, сессия без пересдач,
 * автомат, блестящая сдача — меняют то, как на героиню смотрят в сцене, и у
 * каждой есть ключ: предмет, наставник или слово сессии.
 */
export const CHRONICLE_MILESTONES = ['firstTop', 'debtCleared', 'cleanSession', 'autoPass', 'brilliant'];

/**
 * Значимые события семестра — из журнала механики, а не из пересказа чата.
 * Тем хроника и полезнее мемори-бука: события точные и не врут (3.7).
 *
 * С вехами (9.4.2) источников два: журнал и пересчёт вех по состоянию. Веха
 * без даты в хронику не идёт — «когда» у записи хроники обязательно, а
 * выдумывать его нельзя. uid вехи дату НЕ содержит: дата у вехи может
 * уточниться, а запись в лорбуке от этого сиротеть не должна. События обоих
 * источников сливаются по дню, чтобы потолок (`buildEntries`) вытеснял старое,
 * а не всё, что пришло вторым источником.
 *
 * @returns {Array<{uid: string, kind: string, day: string, record: Object}>}
 */
export function significantEvents(state, preset) {
  const fromJournal = journalEvents(state, preset);
  // Веха по предмету, чей итог ещё не объявлен (9.4.3), ждёт объявления: «первая
  // пятёрка по химии» в лорбуке — та же утечка оценки, что и запись исхода.
  const secret = new Set(((state.exams && state.exams.items) || [])
    .filter((i) => i && i.announced === false)
    .map((i) => i.subjectId));
  const fromMilestones = milestones(state, preset)
    .filter((m) => m.when && CHRONICLE_MILESTONES.includes(m.kind))
    .filter((m) => !(m.subjectId && secret.has(m.subjectId)))
    .map((m) => ({
      uid: `academy:chronicle:milestone:${m.id}`,
      kind: 'milestone',
      day: m.when,
      record: { kind: 'milestone', day: m.when, data: m },
    }));
  // Сортировка устойчивая: в пределах дня журнал идёт первым и в своём порядке.
  return [...fromJournal, ...fromMilestones]
    .map((ev, i) => ({ ev, i }))
    .sort((a, b) => (a.ev.day < b.ev.day ? -1 : a.ev.day > b.ev.day ? 1 : a.i - b.i))
    .map((x) => x.ev);
}

/** Значимые записи журнала — прежний и единственный до вех источник хроники. */
function journalEvents(state, preset) {
  const seen = new Map();
  const out = [];

  for (const record of state.journal || []) {
    if (!isSignificant(record, state, preset)) continue;

    const base = `academy:chronicle:${record.kind}:${record.day || ''}:${subjectOfRecord(state, record) || (record.data && record.data.teacherId) || ''}`;
    // Суффикс приписывается только со второго совпадения: иначе единственное
    // событие дня меняло бы uid, стоило появиться второму такому же, — и запись
    // прошлого прогона осиротела бы, а рядом легла её копия.
    const n = seen.get(base) || 0;
    seen.set(base, n + 1);

    out.push({ uid: n === 0 ? base : `${base}#${n}`, kind: record.kind, day: record.day || '', record });
  }

  return out;
}

/** Запись хроники по одному значимому событию. Ключ — участники (3.7). */
export function chronicleEntry(event, state, preset) {
  const { record } = event;
  const vars = { ...vocabVars(preset), day: record.day || '' };
  let template = '';
  let keys = [];

  if (record.kind === 'exam') {
    const subjectId = subjectOfRecord(state, record);
    const subject = findSubject(state, subjectId);
    const teacher = teacherOfSubject(state, subjectId);
    template = templateOf(preset, 'chronicleExam');
    Object.assign(vars, {
      subject: (subject && subject.name) || subjectId || '',
      value: gradeLabel(preset, record.data && record.data.value),
      teacher: (teacher && teacher.name) || '',
    });
    keys = [...(subject ? [subject.name] : []), ...nameKeys(teacher && teacher.name)];
  } else if (record.kind === 'reputation') {
    const scale = (preset && preset.reputation) || {};
    const to = numberOr(record.data && record.data.to, 0);
    const expelled = typeof scale.expelAt === 'number' && to <= scale.expelAt;
    template = templateOf(preset, expelled ? 'chronicleExpel' : 'chronicleWarn');
    vars.reputation = labelFor(reputationLabels(preset), to);
    // У публичного события участник один — заведение; ключом идёт то слово,
    // которым пресет называет вылет, оно же всплывёт в сцене.
    keys = [vars.expulsion, vars.warning].filter(Boolean);
  } else if (record.kind === 'rel') {
    const teacher = findTeacher(state, record.data && record.data.teacherId);
    const labels = relationLabels(preset);
    template = templateOf(preset, 'chronicleRelation');
    Object.assign(vars, {
      teacher: (teacher && teacher.name) || (record.data && record.data.teacherId) || '',
      from: labelFor(labels, numberOr(record.data && record.data.from, 0)),
      to: labelFor(labels, numberOr(record.data && record.data.to, 0)),
    });
    keys = nameKeys(teacher && teacher.name);
  } else if (record.kind === 'milestone') {
    const m = record.data || {};
    const subject = m.subjectId ? findSubject(state, m.subjectId) : null;
    const teacher = m.teacherId
      ? findTeacher(state, m.teacherId)
      : (m.subjectId ? teacherOfSubject(state, m.subjectId) : null);
    template = templateOf(preset, 'chronicleMilestone');
    vars.milestone = milestoneName(m, state, preset);
    // Участники вехи: предмет и его наставник. У сессии без пересдач
    // участника-человека нет — ключом служит слово сессии из пресета, оно и
    // всплывёт в сцене, когда о ней заговорят.
    keys = [
      ...(subject ? [subject.name] : []),
      ...nameKeys(teacher && teacher.name),
      ...(m.kind === 'cleanSession' && vars.examPeriod ? [vars.examPeriod] : []),
    ];
  } else {
    return null;
  }

  return entry({
    uid: event.uid,
    category: 'chronicle',
    keys,
    content: fill(template, vars),
    order: 10,
    // День рождения записи нужен потолку: когда мест не хватает, вытесняется
    // старое, а не то, что случилось вчера и ещё живо в сцене.
    day: event.day,
  });
}

// --- предложенные записи: NPC и места ---------------------------------------

/**
 * Предложение записи, а не запись. Про одногруппников, случайных NPC и места
 * механика ничего не знает: их нет в состоянии, и сочинять их про себя означало бы
 * выдумывать факты. План говорит прямо — расширение «может только предложить
 * запись» (3.7), поэтому такие записи получают `origin: 'suggested'` и уходят
 * отдельным списком, мимо `create`.
 *
 * @param {{id: string, name: string, note?: string, kind?: 'places'|'people'}} raw
 */
export function suggestedEntry(raw, preset) {
  if (!raw || !raw.name) return null;
  const place = raw.kind === 'places';
  const id = String(raw.id || raw.name).trim();

  return entry({
    uid: `academy:${place ? 'place' : 'npc'}:${id}`,
    category: place ? 'places' : 'people',
    keys: place ? [String(raw.name)] : nameKeys(raw.name),
    content: fill(templateOf(preset, place ? 'place' : 'npc'), {
      ...vocabVars(preset),
      name: String(raw.name),
      note: String(raw.note || ''),
    }).trim(),
    order: place ? 40 : 45,
    origin: 'suggested',
  });
}

// --- сборка и сравнение со снимком ------------------------------------------

/**
 * Полный набор собственных записей, каким лорбук должен быть сейчас.
 * Порядок — приоритетный: устав, преподаватели, хроника от свежего к старому.
 * Этот же порядок работает потолком, поэтому он часть контракта, а не косметика.
 */
export function buildEntries(state, preset) {
  const people = (state.teachers || [])
    .map((t) => teacherEntry(state, t.id, preset))
    .filter(Boolean);

  const chronicle = significantEvents(state, preset)
    .map((ev) => chronicleEntry(ev, state, preset))
    .filter(Boolean)
    .reverse();

  return [charterEntry(state, preset), ...people, ...chronicle];
}

/**
 * Что изменилось с прошлого раза.
 *
 * Три исхода на запись, и «оставить как есть» — такой же исход, как остальные два.
 * Правленое руками не обновляется никогда: это единственное правило 3.7, нарушение
 * которого пользовательница заметит не сразу и не простит.
 *
 * @param {Entry[]} entries  каким лорбук должен быть
 * @param {SnapshotEntry[]} snapshot  что лежит в лорбуке сейчас
 * @param {Object} preset
 * @param {{maxEntries?: number}} [opts]
 * @returns {{create: Entry[], update: Entry[], keep: Array, skipped: Array}}
 */
export function diffEntries(entries, snapshot, preset, opts = {}) {
  const have = new Map((snapshot || []).map((s) => [s.uid, s]));
  const cap = entryCap(preset, opts);
  const create = [];
  const update = [];
  const keep = [];
  const skipped = [];

  // Уже лежащие записи потолок не выселяет: удалять из чужого лорбука — не наше
  // дело (3.7: «видно, правится и удаляется средствами таверны»). Поэтому они
  // съедают бюджет первыми, а потолок только перестаёт добавлять новое.
  let budget = cap - have.size;

  for (const e of entries || []) {
    const was = have.get(e.uid);

    if (!was) {
      if (budget > 0) {
        create.push(e);
        budget -= 1;
      } else {
        skipped.push({ uid: e.uid, category: e.category, reason: SKIP_CAP });
      }
      continue;
    }

    if (isHandEdited(was)) {
      keep.push({ uid: e.uid, reason: KEEP_EDITED, entry: e });
    } else if (String(was.content) === e.content) {
      keep.push({ uid: e.uid, reason: KEEP_UNCHANGED, entry: e });
    } else {
      update.push(e);
    }
    have.delete(e.uid);
  }

  // Осталось то, чего расширение больше не порождает: запись прошлой версии,
  // чужая запись из того же лорбука, запись про NPC, принятую человеком. Ни одну
  // из них мы не трогаем — только называем вслух, чтобы было видно в отладке.
  for (const s of have.values()) keep.push({ uid: s.uid, reason: KEEP_FOREIGN });

  return { create, update, keep, skipped };
}

/**
 * Правленую руками запись узнаём по отпечатку: он лёг рядом с записью, когда её
 * писало расширение. Явный флаг `edited` старше — слой таверны может знать
 * надёжнее. Записи без отпечатка и без флага считаются нетронутыми: отпечатка нет
 * у всего, что расширение записало до появления этого правила, и объявлять их
 * правленными значит перестать обновлять весь старый лорбук разом.
 */
export function isHandEdited(snapshotEntry) {
  if (!snapshotEntry) return false;
  if (snapshotEntry.edited === true) return true;
  if (!snapshotEntry.fingerprint) return false;
  return fingerprint(snapshotEntry.content) !== String(snapshotEntry.fingerprint);
}

/**
 * План лорбука целиком — то, что понесут в таверну.
 *
 * @param {Object} state
 * @param {Object} preset
 * @param {Object} [opts]
 * @param {SnapshotEntry[]} [opts.snapshot] что уже лежит в лорбуке
 * @param {Array} [opts.npcs]   одногруппники и прочие NPC, замеченные в сцене
 * @param {Array} [opts.places] места, замеченные в сцене
 * @param {number} [opts.maxEntries] потолок, если надо перебить пресет
 * @returns {{create: Entry[], update: Entry[], keep: Array, suggest: Entry[],
 *            skipped: Array, entries: Entry[], measure: Object}}
 */
export function buildLorebook(state, preset, opts = {}) {
  const entries = buildEntries(state, preset);
  const diff = diffEntries(entries, opts.snapshot, preset, opts);

  const suggest = [
    ...(opts.places || []).map((p) => suggestedEntry({ ...p, kind: 'places' }, preset)),
    ...(opts.npcs || []).map((n) => suggestedEntry({ ...n, kind: 'people' }, preset)),
  ].filter(Boolean).filter((e) => !(opts.snapshot || []).some((s) => s.uid === e.uid));

  // Замер считается по тому, чем лорбук станет: созданное, обновлённое и всё,
  // что осталось лежать. Предложения в него не входят — без решения человека они
  // в лорбук не попадут и контекст не съедят.
  const kept = diff.keep.map((k) => k.entry || snapshotAsEntry(opts.snapshot, k.uid)).filter(Boolean);
  const after = [...diff.create, ...diff.update, ...kept];
  const cap = entryCap(preset, opts);
  const m = measure(after, preset);

  return {
    ...diff,
    suggest,
    entries,
    measure: { ...m, cap, withinCap: m.entries <= cap },
  };
}

// --- мелочи -----------------------------------------------------------------

/** Подстановка `{ключ}`. Неизвестные ключи остаются как есть: их видно в отладке. */
export function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * Ключи по имени: полное имя плюс каждая его часть. Ключ — имя и фамилия (3.7),
 * а в сцене одного и того же человека зовут то по фамилии, то по имени-отчеству.
 * Части короче трёх букв отброшены: инициал «А.» цеплялся бы за половину текста.
 */
export function nameKeys(name) {
  const full = String(name || '').trim();
  if (!full) return [];
  // Считаются именно буквы и цифры: `\w` знает только латиницу, и на «Петровой»
  // отбрасывалось бы вообще всё.
  const parts = full.split(/\s+/).filter((p) => p.replace(/[^\p{L}\p{N}]/gu, '').length >= 3);
  return [full, ...parts.filter((p) => p !== full)];
}

/** Собирает запись, дописывая отпечаток: без него следующий прогон слеп к правкам. */
function entry(raw) {
  const content = String(raw.content || '').trim();
  return {
    uid: raw.uid,
    category: raw.category,
    keys: (raw.keys || []).filter((k) => String(k || '').trim()).map(String),
    content,
    constant: Boolean(raw.constant),
    order: numberOr(raw.order, 0),
    origin: raw.origin || 'own',
    fingerprint: fingerprint(content),
    ...(raw.day ? { day: raw.day } : {}),
  };
}

/**
 * Значение без хвостовой точки и пробелов: шаблон ставит точку сам, и
 * «картины.» из анкеты иначе дало бы «картины..».
 */
function bare(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().replace(/[\s.;,]+$/, '');
}

/** Шаблон из `preset.phrases.lorebook`, иначе запасной — без доменных слов. */
function templateOf(preset, name) {
  const ph = (preset && preset.phrases && preset.phrases.lorebook) || {};
  return ph[name] || DEFAULT_TEMPLATES[name] || '';
}

/** Вся лексика пресета сразу: подстановки, которых нет в шаблоне, просто не сработают. */
function vocabVars(preset) {
  const v = (preset && preset.vocab) || {};
  const out = {};
  for (const [k, value] of Object.entries(v)) out[k] = String(value == null ? '' : value);
  return out;
}

const limitsOf = (preset) => (preset && preset.limits) || {};
const relationLabels = (preset) => (preset && preset.relations && preset.relations.labels) || [];
const reputationLabels = (preset) => (preset && preset.reputation && preset.reputation.labels) || [];

/** Человеческое название оценки из пресета; своего словаря оценок у ядра нет. */
function gradeLabel(preset, value) {
  const values = (preset && preset.grades && preset.grades.values) || [];
  const found = values.find((g) => String(g.value) === String(value));
  return (found && found.label) || String(value == null ? '' : value);
}

/** Предмет по записи журнала: у исхода сессии в данных лежит id события, не предмета. */
function subjectOfRecord(state, record) {
  const examId = record.data && record.data.examId;
  if (!examId) return record.data && record.data.subjectId ? String(record.data.subjectId) : null;
  const item = ((state.exams && state.exams.items) || []).find((i) => i.id === examId);
  return item ? item.subjectId : null;
}

/** Запись снимка в форме `Entry` — для замера того, что осталось лежать. */
function snapshotAsEntry(snapshot, uid) {
  const s = (snapshot || []).find((x) => x.uid === uid);
  return s ? { uid: s.uid, category: 'chronicle', keys: [], content: String(s.content || '') } : null;
}

function numberOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

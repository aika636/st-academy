// Прогон 10.10, третий (баги 69–73, 76–78): терпимый разбор выпуска и лог причин отброса,
// манера речи без искажения слов, темы-открытия и календарь при частых выпусках, сюжетики
// движутся каждый выпуск, заметные факты героини в «Главные», итог «Молва обновилась»
// гаснет, «Слышно» без дублей.

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  planIssue, buildAgenda, buildMolvaPrompt, parseIssue, applyIssue, replayMolva, newFacts, brokenWords, IDLE_MAX,
} from '../core/molva.mjs';
import { addFeedItem, normalizeFeed, feedItems, feedBackground, DEFAULT_MANNERS, feedManners, STAGES, THREADS_MAX } from '../core/feed.mjs';
import {
  setCast, rumorAuthors, brokenManner, checkDiversity, assembleCast, buildCastPrompt, END_MARK, similar,
} from '../core/feed-cast.mjs';
import { startThread, openThreads } from '../core/feed-threads.mjs';
import { applyNotableFacts, notableFact } from '../core/scene.mjs';
import { stopList } from '../core/stop-names.mjs';
import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { loudLine } from '../mes-panel.js';
import { molvaDebugView } from '../ui/debug.js';
import { keepMolvaNote, clearMolvaNote, molvaNoteView, trackMolvaStatus, MOLVA_NOTE_MS } from '../ui/cast.js';

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const preset = JSON.parse(read('../presets/ru-university.json'));
const SUBJECTS = [{ id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' }];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }];
const COURSE = [
  { id: 'sokolova', name: 'Вера Соколова', relation: 0, desire: 'попасть в оргкомитет бала', problem: '' },
];
const DAY = '2026-12-20';
const STOP = stopList({ user: 'Аня Кравцова', char: 'Мирон Князев', preset });

const CAST = [
  { id: 'cast1', nick: 'всё-видел', type: 'сплетник', interest: 'чужие тайны', goal: 'узнать, кто пустил слух', manner: 'начинает с «только никому»', ally: 'cast2', rival: 'cast3' },
  { id: 'cast2', nick: 'вечно второй', type: 'ботан', interest: 'олимпиады', goal: 'обойти Лиса на зачёте', manner: 'отвечает вопросом на вопрос', ally: 'cast1', rival: 'cast4' },
  { id: 'cast3', nick: 'крыса в углу', type: 'тихоня', interest: 'шахматы', goal: 'попасть в оргкомитет', manner: 'пишет коротко', ally: 'cast4', rival: 'cast1' },
  { id: 'cast4', nick: 'сердцеед', type: 'сердцеед', interest: 'танцы', goal: 'позвать всех на бал', manner: 'хвалит и поддевает', ally: 'cast3', rival: 'cast2' },
  { id: 'cast5', nick: 'староста-тень', type: 'зубрила', interest: 'расписание', goal: 'сдать журнал', manner: 'цитирует устав', ally: 'cast6', rival: 'cast1' },
  { id: 'cast6', nick: 'шут с галёрки', type: 'шутник', interest: 'розыгрыши', goal: 'сорвать пару', manner: 'шутит там, где ругаются', ally: 'cast5', rival: 'cast2' },
];

/** Три сюжетика не из календаря: новый заводиться не должен, пока кто-то не закроется. */
function semester({ threads = 0, day = DAY } = {}) {
  const s = createState(preset, {
    startDay: '2026-09-01', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset), classmates: COURSE,
  });
  s.started = true;
  s.calendar.day = day;
  s.classmates = COURSE.map((c) => ({ ...c }));
  setCast(s, CAST);
  const specs = [
    { topic: 'шахматный турнир', members: ['cast3', 'cast1'], dispute: 'спорят о турнире' },
    { topic: 'конспекты по химии', members: ['cast2', 'cast4'], dispute: 'ботан и сердцеед спорят о конспектах' },
    { topic: 'дежурство по этажу', members: ['cast5', 'cast6'], dispute: 'чья очередь мыть' },
  ];
  for (const t of specs.slice(0, threads)) startThread(s, { ...t, source: 'cast', day });
  return s;
}

const opts = (extra = {}) => ({ stop: STOP, every: 1, ...extra });

// --- п. 70: терпимый разбор --------------------------------------------------------------

function twoSlots() {
  const author = (id, name) => ({ id, kind: 'cast', name, masked: true, type: '', interest: '', goal: '', manner: '' });
  const [A, B, C, D] = [author('cast1', 'всё-видел'), author('cast2', 'вечно второй'), author('cast3', 'крыса в углу'), author('cast4', 'сердцеед')];
  const slots = [
    { n: 1, kind: 'crowd', mode: 'post', author: A, replier: B, maxReplies: 2, heroine: false, rumor: false, loud: 1, topic: 'помолвка', advance: true, threadId: 't1' },
    { n: 2, kind: 'world', mode: 'post', author: C, replier: D, maxReplies: 2, heroine: false, rumor: false, loud: 1, topic: 'турнир' },
  ];
  return { agenda: { issue: 5, slots, lastKey: '' }, pool: [A, B, C, D] };
}

const parse = (text, extra = {}) => {
  const { agenda, pool } = twoSlots();
  return parseIssue(text, agenda, { pool, stop: STOP, ...extra });
};

const P1 = 'Говорят, помолвка уже назначена, только никому!';
const R1 = 'А кто сказал, что она вообще согласилась?';
const P2 = 'На турнир по шахматам записалось всего трое.';

test('п. 70: разборщик терпим к живым вариантам формата', () => {
  const variants = {
    'markdown жирным': [`**П1** | всё-видел | ${P1}`, `**О1** | вечно второй | ${R1}`, `**П2** | крыса в углу | ${P2}`, 'КОНЕЦ'],
    'звёздочки внутри': [`**П1:** всё-видел | ${P1}`, `**О1:** вечно второй | ${R1}`, `**П2:** крыса в углу | ${P2}`, '**КОНЕЦ**'],
    'маркеры списка и заголовки': [`- П1 | всё-видел | ${P1}`, `* О1 | вечно второй | ${R1}`, `# П2 | крыса в углу | ${P2}`, 'КОНЕЦ'],
    'нумерация': [`1. П1 | всё-видел | ${P1}`, `2) О1 | вечно второй | ${R1}`, `3. П2 | крыса в углу | ${P2}`, 'КОНЕЦ'],
    '«П1:» вместо «|»': [`П1: всё-видел | ${P1}`, `О1: вечно второй: ${R1}`, `П2 — крыса в углу — ${P2}`, 'КОНЕЦ'],
    'латинские P и O': [`P1 | всё-видел | ${P1}`, `o1 | вечно второй | ${R1}`, `p2 | крыса в углу | ${P2}`, 'КОНЕЦ'],
    'пост и ответ словами': [`Пост 1 | всё-видел | ${P1}`, `Ответ 1 | вечно второй | ${R1}`, `Post 2 | крыса в углу | ${P2}`, 'КОНЕЦ'],
    'ники с @, в скобках и квадратных': [`П1 | @всё-видел | ${P1}`, `О1 | вечно второй (ботан) | ${R1}`, `П2 | [крыса в углу] | ${P2}`, 'КОНЕЦ'],
    'ники в кавычках и регистр': [`П1 | «Всё-Видел» | ${P1}`, `О1 | "Вечно Второй" | ${R1}`, `П2 | @КРЫСА В УГЛУ | ${P2}`, 'КОНЕЦ'],
    'кавычки вокруг текста': [`П1 | всё-видел | «${P1}»`, `О1 | вечно второй | "${R1}"`, `П2 | крыса в углу | “${P2}”`, 'КОНЕЦ'],
    'таблица с краевыми «|»': [`| П1 | всё-видел | ${P1} |`, `| О1 | вечно второй | ${R1} |`, `| П2 | крыса в углу | ${P2} |`, 'КОНЕЦ'],
    'пустые строки и пояснения': ['Вот выпуск молвы:', '', `П1 | всё-видел | ${P1}`, '', '', `О1 | вечно второй | ${R1}`, '', `П2 | крыса в углу | ${P2}`, '', 'КОНЕЦ', '', 'Надеюсь, подойдёт!'],
    'без КОНЕЦ': [`П1 | всё-видел | ${P1}`, `О1 | вечно второй | ${R1}`, `П2 | крыса в углу | ${P2}`],
    'КОНЕЦ в кавычках и со знаком': [`П1 | всё-видел | ${P1}`, `О1 | вечно второй | ${R1}`, `П2 | крыса в углу | ${P2}`, '`КОНЕЦ`'],
    'после слова КОНЕЦ — пояснение': [`П1 | всё-видел | ${P1}`, `О1 | вечно второй | ${R1}`, `П2 | крыса в углу | ${P2}`, 'КОНЕЦ', 'Если нужно, могу переписать.'],
  };
  for (const [name, rows] of Object.entries(variants)) {
    const r = parse(rows.join('\n'));
    assert.deepEqual(r.lines.map((l) => `${l.kind}${l.n}`), ['post1', 'reply1', 'post2'], name);
    assert.deepEqual(r.rejected, [], name);
    assert.deepEqual(r.lines.map((l) => l.text), [P1, R1, P2], name);
    assert.equal(r.rows, 3, name);
  }
});

test('п. 70: без КОНЕЦ, но упёрлось в потолок или обрывок — последняя строка вон', () => {
  const cut = parse([`П1 | всё-видел | ${P1}`, 'П2 | крыса в углу | На турнир записалось всего трое, а'].join('\n'));
  assert.deepEqual(cut.lines.map((l) => l.n), [1]);
  const capped = parse([`П1 | всё-видел | ${P1}`, `П2 | крыса в углу | ${P2}`].join('\n'), { truncated: true });
  assert.deepEqual(capped.lines.map((l) => l.n), [1]);
  assert.match(capped.rejected[0].reason, /оборван/);
});

test('п. 70: написал не назначенный, но существующий статист — принимается и переназначается', () => {
  const r = parse([
    `П1 | вечно второй | ${P1}`,
    `О1 | сердцеед | ${R1}`,
    `П2 | крыса в углу | ${P2}`,
    'КОНЕЦ',
  ].join('\n'));
  assert.deepEqual(r.lines.map((l) => `${l.kind}${l.n}:${l.author.name}`), ['post1:вечно второй', 'reply1:сердцеед', 'post2:крыса в углу']);
  assert.deepEqual(r.rejected, []);
  assert.deepEqual(r.reassigned.map((x) => [x.n, x.from, x.to]), [[1, 'всё-видел', 'вечно второй'], [1, 'вечно второй', 'сердцеед']]);
  // Но по-настоящему плохое всё равно вон: чужак, героиня, самоответ.
  const bad = parse([
    'П1 | Незнакомец | Говорят, помолвка уже назначена, только никому!',
    'П2 | Аня Кравцова | Я тут ни при чём, это всё враньё.',
    'КОНЕЦ',
  ].join('\n'));
  assert.equal(bad.lines.length, 0);
  assert.equal(bad.rejected.length, 2);
});

test('п. 70: причины отброса — строкой с номером строки ответа и самой строкой', () => {
  const r = parse(['Вот выпуск:', `П1 | Незнакомец | ${P1}`, `П2 | крыса в углу | да`, 'КОНЕЦ'].join('\n'));
  assert.deepEqual(r.rejected.map((x) => x.line), [2, 3]);
  assert.match(r.rejected[0].reason, /не из каста/);
  assert.match(r.rejected[0].raw, /Незнакомец/);
  assert.match(r.rejected[1].reason, /пустая/);
  const none = parse('Извините, не могу написать молву.');
  assert.equal(none.lines.length, 0);
  assert.equal(none.rows, 0);
  assert.match(none.rejected[0].reason, /нет ни одной строки формата/);
  assert.match(none.rejected[0].raw, /Извините/);
  assert.match(parse('').rejected[0].reason, /пустой ответ/);
});

test('п. 70: отладка показывает сырой ответ, причины и замены автора строками', () => {
  const d = molvaDebugView({
    at: '2026-10-10T10:00:00Z', rows: 3, posts: 1, replies: 0, truncated: false, complete: false, raw: 'П1 | кто-то | текст',
    rejected: [{ line: 2, reason: 'автор «кто-то» не из каста', raw: 'П1 | кто-то | текст' }],
    reassigned: [{ line: 4, n: 1, from: 'а', to: 'б' }],
  });
  assert.match(d.head, /Строк нужного вида в ответе: 3; легло постов 1, ответов 0 \(без строки КОНЕЦ\)/);
  assert.deepEqual(d.rejected, ['строка 2: автор «кто-то» не из каста — П1 | кто-то | текст']);
  assert.deepEqual(d.moved, ['строка 4: слот 1, написал «б» вместо «а»']);
  assert.equal(d.raw, 'П1 | кто-то | текст');
  assert.equal(molvaDebugView(null), null);
});

// --- п. 71: манера не ломает слова ---------------------------------------------------------

test('п. 71: манера, искажающая написание, узнаётся; обычные и стандартные — нет', () => {
  for (const m of ['вставляет «люмо» внутрь слов', 'заикается и повторяет слоги', 'коверкает слова', 'картавит', 'пишет с ошибками на каждом шагу', 'вставляет слог «мяу» в середину слова']) {
    assert.equal(brokenManner(m), true, m);
  }
  for (const m of ['хвалит и тут же поддевает', 'оговаривается и сам же поправляет', 'отвечает вопросом на вопрос', 'пишет коротко, без знаков препинания', '']) {
    assert.equal(brokenManner(m), false, m);
  }
  const all = [...DEFAULT_MANNERS];
  for (const id of ['ru-university', 'magic-academy', 'dark-academia', 'space-academy', 'xianxia-sect']) {
    all.push(...feedManners(JSON.parse(read(`../presets/${id}.json`))));
  }
  assert.ok(all.length > 8);
  for (const m of all) assert.equal(brokenManner(m), false, `манера пресета: ${m}`);
});

test('п. 71: реплика со вставленным внутрь слов куском отбрасывается', () => {
  const manner = 'вставляет «люмо» внутрь слов';
  assert.equal(brokenWords('Клюмостёл снлюмосва', manner), 'люмо', 'по манере — хватает двух слов');
  assert.equal(brokenWords('Все знают, что клюмостёл снлюмосва, плюмоатформа тоже'), 'люмо', 'без манеры — по повтору в трёх словах');
  const natural = [
    'Говорят, расписание опять поменяли, а староста даже не предупредила никого из группы про это.',
    'Возможности, готовности и радостные ожидания — вот что всех объединяет перед зимним балом.',
    'Преподаватель обещал рассказать о контрольной подробнее, но потом отменил занятие без объяснений.',
    'Профессор сказал, что оценивание будет справедливым, а настроение у всех поднялось.',
    'Расписание описывают как непостоянное, зато записались почти все, кто хотел.',
    'Общежитие закрыли на ремонт, поэтому дежурства по этажу отменили до понедельника.',
  ];
  for (const t of natural) assert.equal(brokenWords(t), '', t);
  assert.equal(brokenWords('Всё нормально, пишу как обычно.', manner), '');

  const { agenda } = twoSlots();
  const pool = [{ id: 'cast1', kind: 'cast', name: 'всё-видел', masked: true, manner }, ...twoSlots().pool.slice(1)];
  const r = parseIssue(`П1 | всё-видел | Клюмостёл снлюмосва стоит у входа и ждёт.\nП2 | крыса в углу | ${P2}\nКОНЕЦ`, agenda, { pool, stop: STOP });
  assert.deepEqual(r.lines.map((l) => l.n), [2]);
  assert.match(r.rejected[0].reason, /кусок «люмо»/);
});

test('п. 71: каст — манера с искажением перегенерируется, а не перегенерировалась — стирается', async () => {
  const row = (nick, type, interest, goal, manner) => [nick, type, interest, goal, manner, '', ''].join(' | ');
  const base = [
    row('Бессонница', 'отличник', 'олимпиады', 'сдать всё досрочно', 'отвечает вопросом на вопрос'),
    row('Дежурный', 'староста', 'расписание', 'сдать журнал', 'цитирует устав'),
    row('Заноза', 'задира', 'значки', 'сорвать пару', 'вставляет «люмо» внутрь слов'),
    row('Тишина', 'тихоня', 'шахматы', 'попасть в оргкомитет', 'пишет коротко'),
  ];
  assert.deepEqual(checkDiversity([{ id: 'cast1', nick: 'Заноза', manner: 'вставляет «люмо» внутрь слов' }, { id: 'cast2', nick: 'Тишина', manner: 'пишет коротко' }]).redo, ['cast1']);

  const prompts = [];
  const fixed = await assembleCast({ preset }, async (p) => {
    prompts.push(p);
    return { ok: true, text: `${prompts.length === 1 ? base.join('\n') : row('Метроном', 'хронометрист', 'точные часы', 'быть вовремя', 'считает секунды вслух')}\n${END_MARK}` };
  });
  assert.equal(fixed.ok, true);
  assert.equal(fixed.calls, 2, 'один общий запрос и одна замена');
  assert.match(prompts[1].user, /искажает написание слов/);
  assert.ok(fixed.members.every((m) => !brokenManner(m.manner)));

  let n = 0;
  const stuck = await assembleCast({ preset }, async () => {
    n += 1;
    return { ok: true, text: `${n === 1 ? base.join('\n') : base[2]}\n${END_MARK}` };
  });
  assert.equal(stuck.ok, true);
  const zanoza = stuck.members.find((m) => m.nick === 'Заноза');
  assert.equal(zanoza.manner, '', 'манера, что не удалось заменить, стёрта');
  assert.match(stuck.warnings.join(' '), /Заноза.*убрана манера/);

  const ask = buildCastPrompt({ preset }).user;
  assert.match(ask, /никаких вставок внутрь слов, заикания/);
  assert.match(ask, /словарь, интонация, привычные фразы/);
});

test('п. 71: промпт молвы просит писать слова правильно и не передаёт искажающих манер', () => {
  const s = semester({ threads: 2 });
  s.feed.cast[0].manner = 'вставляет «люмо» внутрь слов';
  const { work, agenda } = planIssue(s, preset, opts());
  const prompt = buildMolvaPrompt(work, preset, agenda, {});
  assert.match(prompt.user, /Слова пишутся правильно: без вставок внутрь слов, заикания/);
  assert.doesNotMatch(prompt.user, /люмо/);
});

// --- серии выпусков -------------------------------------------------------------------------

/** Ответ модели по повестке: каждый слот — пост и ответ, тексты разные в каждом выпуске. */
const answer = (agenda, i) => [
  ...agenda.slots.flatMap((s) => [
    `П${s.n} | ${s.author.name} | Выпуск ${i}, слот ${s.n}: ${s.topic.slice(0, 18)} — пост, и история на этом не кончится.`,
    ...(s.replier && s.maxReplies ? [`О${s.n} | ${s.replier.name} | Выпуск ${i}, слот ${s.n}: ответ, с которым я совершенно не согласен.`] : []),
  ]),
  'КОНЕЦ',
].join('\n');

/** Прогнать `n` выпусков подряд по частоте `every`: что шло в каждом. */
function runIssues(s0, n, every = 1) {
  let s = s0;
  const log = [];
  for (let i = 1; i <= n; i += 1) {
    const before = openThreads(s).map((t) => ({ id: t.id, stage: t.stage, idle: t.idle }));
    const { work, agenda } = planIssue(s, preset, opts({ every }));
    const result = parseIssue(answer(agenda, i), agenda, {
      pool: rumorAuthors(work, { stop: STOP }), stop: STOP, existing: feedItems(s).map((x) => x.text),
    });
    const res = applyIssue(work, result, agenda, { stamp: `m-${i}`, preset });
    assert.equal(res.ok, true, `выпуск ${i} лёг`);
    s = replayMolva(s, [res.delta]);
    log.push({
      i, agenda, before, after: openThreads(s).map((t) => ({ id: t.id, stage: t.stage, idle: t.idle })),
      opener: agenda.slots[0].topic, calendar: agenda.slots.filter((x) => x.kind === 'calendar').map((x) => x.topic),
    });
  }
  return { state: s, log };
}

test('п. 72: шесть выпусков подряд при N=1 — тема-открытие не повторяется три выпуска, календарь не каждый раз', () => {
  const { log } = runIssues(semester({ threads: 3 }), 6, 1);
  log.forEach((x, k) => {
    for (const prev of log.slice(Math.max(0, k - 3), k)) {
      assert.equal(similar(x.opener, prev.opener), false, `выпуск ${x.i} открывает «${x.opener}», как выпуск ${prev.i}`);
    }
  });
  const withCalendar = log.filter((x) => x.calendar.length).map((x) => x.i);
  assert.ok(withCalendar.length >= 1, 'календарь всё же звучит');
  for (let k = 1; k < withCalendar.length; k += 1) {
    assert.ok(withCalendar[k] - withCalendar[k - 1] >= 3, `слот календаря в выпусках ${withCalendar.join(', ')}: не чаще раза в три`);
  }
});

test('п. 72: событие, о котором уже идёт слот календаря, не возвращается в ближайшие два выпуска', () => {
  const s = semester({ threads: 3 });
  const first = buildAgenda(s, preset, opts({ issue: 1, every: 3 }));
  const second = buildAgenda({ ...s, feed: { ...s.feed, molva: { ...normalizeFeed(s.feed).molva, issue: 1, cal: [{ topic: 'Новый год', issue: 1 }] } } }, preset, opts({ issue: 2, every: 3 }));
  assert.ok(first.slots.some((x) => x.kind === 'calendar'), 'в первом выпуске календарь есть');
  assert.equal(second.slots.some((x) => x.kind === 'calendar'), false, 'через выпуск — нет');
  const later = buildAgenda({ ...s, feed: { ...s.feed, molva: { ...normalizeFeed(s.feed).molva, issue: 3, cal: [{ topic: 'Новый год', issue: 1 }] } } }, preset, opts({ issue: 4, every: 3 }));
  assert.ok(later.slots.some((x) => x.kind === 'calendar'), 'через три выпуска — снова можно');
});

test('п. 73: каждый выпуск двигает сюжетик, простоев больше двух выпусков нет, место не пустует', () => {
  const { log } = runIssues(semester({ threads: 2 }), 8, 1);
  for (const x of log) {
    const moved = x.after.filter((a) => {
      const b = x.before.find((t) => t.id === a.id);
      return !b || b.stage !== a.stage;
    }).length + x.before.filter((b) => !x.after.some((a) => a.id === b.id)).length;
    assert.ok(moved >= 1, `выпуск ${x.i}: ни один сюжетик не сдвинулся`);
    assert.equal(x.after.length, THREADS_MAX, `выпуск ${x.i}: открыто ${x.after.length} из ${THREADS_MAX}`);
    for (const t of x.after) assert.ok((t.idle || 0) < IDLE_MAX, `выпуск ${x.i}: ${t.id} стоит ${t.idle}`);
  }
});

test('п. 73: сюжетик без движения три выпуска сам идёт на следующую стадию; закрытый уступает место новому', () => {
  const s = semester({ threads: 3 });
  const [t1, t2] = openThreads(s);
  s.feed.threads[1].idle = IDLE_MAX - 1;
  const author = (id, name) => ({ id, kind: 'cast', name, masked: true, type: '', interest: '', goal: '', manner: '' });
  const A = author('cast3', 'крыса в углу');
  const agenda = {
    issue: 1,
    slots: [{ n: 1, kind: 'crowd', mode: 'post', author: A, replier: null, maxReplies: 0, heroine: false, rumor: false, loud: 1, topic: t1.topic, stage: t1.stage, threadId: t1.id, advance: true }],
  };
  const work = JSON.parse(JSON.stringify(s));
  const res = applyIssue(work, { lines: [{ kind: 'post', n: 1, slotKind: 'crowd', author: A, text: 'Выпуск один: турнир всё ближе, и никто не готов.' }] }, agenda, { preset });
  assert.equal(res.ok, true);
  const after = openThreads(work);
  assert.equal(after.find((t) => t.id === t1.id).stage, STAGES[1], 'продвинутый слотом');
  assert.equal(after.find((t) => t.id === t2.id).stage, STAGES[1], 'простоявший три выпуска — вперёд сам');
  assert.equal(after.find((t) => t.id === t2.id).idle, 0);

  // Развязка закрывает сюжетик, и в том же выпуске заводится новый.
  const end = semester({ threads: 2 });
  end.feed.threads[0].stage = STAGES[STAGES.length - 1];
  const w2 = JSON.parse(JSON.stringify(end));
  const t0 = openThreads(end)[0];
  const ag2 = { issue: 1, slots: [{ ...agenda.slots[0], topic: t0.topic, threadId: t0.id }] };
  const r2 = applyIssue(w2, { lines: [{ kind: 'post', n: 1, slotKind: 'crowd', author: A, text: 'Выпуск один: турнир всё ближе, и никто не готов.' }] }, ag2, { preset });
  assert.equal(r2.ok, true);
  assert.equal(openThreads(w2).some((t) => t.topic === t0.topic), false, 'закрыт');
  assert.equal(openThreads(w2).length, THREADS_MAX, 'место не пустует: заведены новые');
});

// --- п. 77: заметные факты героини ----------------------------------------------------------

const attend = (status, subjectId = 'chemistry') => ({ ev: { kind: 'attendance', subjectId, status }, token: `${status}=${subjectId}` });
const gradeOf = (value) => ({ ev: { kind: 'grade', subjectId: 'chemistry', value }, token: `grade=chemistry:${value}` });

test('п. 77: прогул, опоздание, провал и триумф ложатся публичными фактами «Главных»; обычная оценка — нет', () => {
  const s = semester({ threads: 2 });
  const o = { src: 'turn1', day: DAY, time: '10:00', heroine: 'Аня Кравцова' };
  const quiet = applyNotableFacts(s, [gradeOf('4')], preset, { ...o, loud: 0 });
  assert.equal(feedItems(quiet).length, 0, 'обычная четвёрка при тихом разборе — не факт');
  assert.equal(notableFact(gradeOf('4').ev, s, preset, { heroine: 'Аня', loud: 2 }).gist, 'Аня получила 4 по «аналитическая химия»', 'громкая оценка — факт');

  const next = applyNotableFacts(s, [attend('skip'), attend('late'), gradeOf('2'), gradeOf('5')], preset, o);
  const facts = feedItems(next).filter((x) => x.kind === 'fact');
  assert.equal(facts.length, 4);
  for (const f of facts) {
    assert.equal(f.minor, true);
    assert.equal(f.heroine, true);
    assert.equal(Boolean(f.private), false, 'наедине не бывает');
    assert.equal(f.rumor, false);
    assert.equal(f.read, true);
  }
  assert.deepEqual(facts.map((f) => f.gist), [
    'Аня Кравцова прогуляла «аналитическая химия»',
    'Аня Кравцова опоздала на «аналитическая химия»',
    'Аня Кравцова провалила «аналитическая химия» (2)',
    'Аня Кравцова блеснула на «аналитическая химия» (5)',
  ]);
  // Идемпотентно: повтор того же ответа не плодит записей.
  assert.equal(feedItems(applyNotableFacts(next, [attend('skip')], preset, o)).length, 4);

  const open = newFacts(next).open;
  assert.equal(open.length, 4);
  const agenda = buildAgenda(next, preset, opts({ issue: 1 }));
  assert.ok(agenda.slots.some((x) => x.kind === 'main' && /прогуляла|провалила|опоздала|блеснула/.test(x.topic)), 'слот «Главные» из факта разбора');
});

test('п. 77: заметные факты — после стычки и слуха; квота трети держится; в ленте, фоне и поводах их нет', () => {
  const s = semester({ threads: 2 });
  addFeedItem(s, { id: 'clash1', src: 'x', at: { day: DAY }, factRef: 'clash=1', kind: 'fact', text: 'стычка: Аня и Вера', gist: 'Аня и Вера поссорились', about: ['@heroine'], heroine: true, loud: 2 });
  const withMinor = applyNotableFacts(s, [attend('skip')], preset, { src: 'turn2', day: DAY, heroine: 'Аня' });
  assert.equal(newFacts(withMinor).open[0].id, 'clash1', 'стычка идёт первой, прогул — после неё');
  assert.equal(feedBackground(withMinor, { day: DAY }).some((p) => /прогуляла/.test(p.text)), false, 'в фон сцены не идёт');

  // Окно забито постами о героине — квота не пускает и заметный факт.
  const full = applyNotableFacts(semester({ threads: 2 }), [attend('skip')], preset, { src: 'turn3', day: DAY, heroine: 'Аня' });
  for (let i = 0; i < 8; i += 1) addFeedItem(full, { id: `rh${i}`, src: 'old', at: { day: DAY }, kind: 'reaction', nick: `ник${i}`, text: `старый пост ${i}`, heroine: true });
  const denied = buildAgenda(full, preset, opts({ issue: 1 }));
  assert.equal(denied.slots.some((x) => x.kind === 'main'), false);
  assert.equal(denied.mainDenied, true);
});

// --- п. 69, 76, 78 --------------------------------------------------------------------------

test('п. 69: «наедине, без свидетелей» в подписи «Слышно» одно', () => {
  const tokens = [
    { kind: 'loud', text: 'шумно' }, { kind: 'loud', text: 'наедине, без свидетелей' }, { kind: 'loud', text: 'наедине, без свидетелей' },
    { kind: 'event', text: 'другое' },
  ];
  assert.equal(loudLine(tokens), 'шумно, наедине, без свидетелей');
  assert.equal(loudLine([]), '');
});

test('п. 76: итог «Молва обновилась» гаснет через десять секунд или при следующем действии', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const node = { isConnected: true, className: '', textContent: '' };
    trackMolvaStatus(node);
    keepMolvaNote({ kind: 'ok', text: 'Молва обновилась: постов 2, ответов 1.' });
    assert.equal(molvaNoteView().text, 'Молва обновилась: постов 2, ответов 1.');
    mock.timers.tick(MOLVA_NOTE_MS - 1);
    assert.equal(molvaNoteView().text.length > 0, true, 'ещё висит');
    mock.timers.tick(1);
    assert.equal(molvaNoteView().text, '', 'погас по таймеру');
    assert.equal(node.textContent, '', 'и с экрана тоже');

    node.textContent = 'висит';
    keepMolvaNote({ kind: 'ok', text: 'Молва обновилась: постов 1, ответов 0.' });
    clearMolvaNote();
    assert.equal(molvaNoteView().text, '', 'следующее действие гасит сразу');
    assert.equal(node.textContent, '');
    mock.timers.tick(MOLVA_NOTE_MS * 2);
  } finally {
    mock.timers.reset();
  }
});

test('п. 78: галочка блока — в строку с подписью', () => {
  const css = read('../style.css');
  const rule = /\.academy-check\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule && /display:\s*flex/.test(rule[1]), 'у .academy-check есть display: flex');
});

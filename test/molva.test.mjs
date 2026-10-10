// Выпуск молвы (`core/molva`, шаг 2 плана «Молва»): размер по частоте, повестка
// кодом (слоты, авторы, квота на главных, слух), промпт, разбор и проверки
// (привязка ответа к слоту — баг 55, обрывки — баг 56), запись, откат и повтор.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  issueSize, everyOf, tickMolva, molvaDue, newFacts, mainShare, mainRoom, buildAgenda, planIssue, buildMolvaPrompt,
  parseIssue, applyIssue, replayMolva, readDeltas, isCutOff, mentionsStop, resolveAuthor, WINDOW,
} from '../core/molva.mjs';
import { addFeedItem, normalizeFeed, ensureFeed, feedItems, STAGES, THREADS_MAX } from '../core/feed.mjs';
import { setCast, rumorAuthors, calendarNames, buildCastPrompt } from '../core/feed-cast.mjs';
import { startThread, openThreads } from '../core/feed-threads.mjs';
import { stopList } from '../core/stop-names.mjs';
import { createState } from '../core/state.mjs';
import { generateMolva, TOKEN_BUDGETS } from '../api.js';
import { buildSchedule } from '../core/schedule.mjs';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));
const SUBJECTS = [{ id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' }];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }];
const COURSE = [
  { id: 'sokolova', name: 'Вера Соколова', relation: 0, desire: 'попасть в оргкомитет бала', problem: '' },
  { id: 'orlova', name: 'Мила Орлова', relation: 0, desire: '', problem: 'не сдала лабораторную' },
];
const DAY = '2026-10-08';
const STOP = stopList({ user: 'Аня Кравцова', char: 'Мирон Князев', preset });

const CAST = [
  { id: 'cast1', nick: 'всё-видел', type: 'сплетник', interest: 'чужие тайны', goal: 'узнать, кто пустил слух', manner: 'начинает с «только никому»', ally: 'cast2', rival: 'cast3' },
  { id: 'cast2', nick: 'вечно второй', type: 'ботан', interest: 'олимпиады', goal: 'обойти Лиса на зачёте', manner: 'отвечает вопросом на вопрос', ally: 'cast1', rival: 'cast4' },
  { id: 'cast3', nick: 'крыса в углу', type: 'тихоня', interest: 'шахматы', goal: 'попасть в оргкомитет', manner: 'пишет коротко', ally: 'cast4', rival: 'cast1' },
  { id: 'cast4', nick: 'сердцеед', type: 'сердцеед', interest: 'танцы', goal: 'позвать всех на бал', manner: 'хвалит и поддевает', ally: 'cast3', rival: 'cast2' },
  { id: 'cast5', nick: 'староста-тень', type: 'зубрила', interest: 'расписание', goal: 'сдать журнал', manner: 'цитирует устав', ally: 'cast6', rival: 'cast1' },
  { id: 'cast6', nick: 'шут с галёрки', type: 'шутник', interest: 'розыгрыши', goal: 'сорвать пару', manner: 'шутит там, где ругаются', ally: 'cast5', rival: 'cast2' },
];

function semester({ cast = true, threads = 0 } = {}) {
  const s = createState(preset, {
    startDay: '2026-09-01', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
    classmates: COURSE,
  });
  s.started = true;
  s.calendar.day = DAY;
  s.classmates = COURSE.map((c) => ({ ...c }));
  if (cast) setCast(s, CAST);
  if (threads >= 1) startThread(s, { topic: 'бесплатный вход на бал', members: ['cast3', 'cast1'], dispute: 'всё-видел хочет вход для оргкомитета', source: 'calendar', day: DAY });
  if (threads >= 2) startThread(s, { topic: 'зачёт по химии', members: ['cast2', 'cast4'], dispute: 'ботан и сердцеед спорят о конспектах', source: 'study', day: DAY });
  return s;
}

const opts = (extra = {}) => ({ stop: STOP, every: 3, ...extra });

function fact(s, id, extra = {}) {
  addFeedItem(s, {
    id, src: 'x1', at: { day: DAY, time: '10:00' }, factRef: `clash=${id}`, kind: 'fact', text: `Аня и Вера поссорились (${id})`,
    gist: `Аня и Вера поссорились при всех (${id})`, about: ['@heroine'], heroine: true, loud: 2, ...extra,
  });
}

function rootPosts(s, n, heroine) {
  for (let i = 0; i < n; i += 1) {
    addFeedItem(s, { id: `r${heroine ? 'h' : 'n'}${i}`, src: 'old', at: { day: DAY }, kind: 'reaction', nick: `ник${i}${heroine ? 'h' : 'n'}`, text: `старый пост ${i} ${heroine}`, heroine });
  }
}

// --- размер и счёт ---------------------------------------------------------------------

test('размер выпуска зависит от частоты: раз в ответ мало, редко и по кнопке — полно', () => {
  assert.deepEqual(issueSize(1), { min: 1, max: 2 });
  assert.deepEqual(issueSize(2), { min: 2, max: 3 });
  assert.deepEqual(issueSize(3), { min: 3, max: 4 });
  assert.deepEqual(issueSize(10), { min: 3, max: 4 });
  assert.deepEqual(issueSize(0), { min: 3, max: 4 });
  assert.equal(everyOf('7'), 7);
  assert.equal(everyOf(0), 3);
  assert.equal(everyOf('мусор'), 3);
});

test('счёт ответов: пора раз в N, «только по кнопке» не срабатывает никогда', () => {
  let s = semester();
  assert.equal(molvaDue(s, { every: 3 }), false);
  s = tickMolva(tickMolva(s));
  assert.equal(molvaDue(s, { every: 3 }), false);
  s = tickMolva(s);
  assert.equal(molvaDue(s, { every: 3 }), true);
  assert.equal(molvaDue(s, { every: 3, manual: true }), false, 'только по кнопке');
  assert.equal(molvaDue(s, { every: 1 }), true);
  assert.equal(normalizeFeed(s.feed).molva.since, 3);
});

// --- повестка --------------------------------------------------------------------------------

test('повестка: без нового публичного факта слота «Главные» нет, массовка и мир есть', () => {
  const s = semester({ threads: 2 });
  const { slots } = buildAgenda(s, preset, opts());
  const kinds = slots.map((x) => x.kind);
  assert.ok(kinds.includes('crowd'));
  assert.ok(!kinds.includes('main'), 'слот главных уходит фону');
  assert.ok(slots.length >= 3 && slots.length <= 4, `слотов ${slots.length}`);
  assert.ok(kinds.includes('world') || kinds.includes('calendar'));
  for (const slot of slots) {
    assert.ok(slot.author && slot.author.name, 'автор назначен заранее');
    assert.ok(slot.dispute, `разногласие назначено: ${slot.kind}`);
  }
});

test('повестка: авторы только из каста и «Людей», героиня и персонаж карточки не пишут', () => {
  const s = semester({ threads: 2 });
  // Кто-то из статистов назван как героиня: стоп-лист его не пускает в авторы.
  setCast(s, [...CAST.slice(0, 5), { id: 'cast6', nick: 'Мирон Князев', type: 'x', interest: 'y', manner: 'z' }]);
  const names = rumorAuthors(s, { stop: STOP }).map((a) => a.name);
  assert.ok(!names.includes('Мирон Князев'));
  const { slots } = buildAgenda(s, preset, opts());
  const ok = new Set(names);
  for (const slot of slots) {
    assert.ok(ok.has(slot.author.name), slot.author.name);
    if (slot.replier) assert.ok(ok.has(slot.replier.name), slot.replier.name);
  }
});

test('повестка: один автор не открывает два слота подряд и не повторяет автора последнего поста', () => {
  const s = semester({ threads: 2 });
  addFeedItem(s, { id: 'last', src: 'old', at: { day: DAY }, kind: 'reaction', nick: 'крыса в углу', text: 'последний пост ленты' });
  for (let issue = 1; issue <= 8; issue += 1) {
    const { slots } = buildAgenda(s, preset, opts({ issue }));
    assert.notEqual(slots[0].author.name, 'крыса в углу', `выпуск ${issue}: первый автор не повторяет последнего`);
    slots.slice(1).forEach((slot, i) => assert.notEqual(slot.author.name, slots[i].author.name, `выпуск ${issue}`));
  }
});

test('повестка: публичный факт даёт слот «Главные» с фактом, подслушанное — реже и слухом в анонимку', () => {
  const s = semester({ threads: 2 });
  fact(s, 'f1');
  const a = buildAgenda(s, preset, opts());
  const main = a.slots.find((x) => x.kind === 'main');
  assert.ok(main, 'публичный факт — слот главных');
  assert.equal(main.heroine, true);
  assert.match(main.facts[0].text, /поссорились/);

  const t = semester({ threads: 2 });
  fact(t, 'p1', { rumor: true, text: 'Говорят, они вместе', gist: 'Аня и Мирон вместе' });
  const odd = buildAgenda(t, preset, opts({ issue: 1 }));
  const even = buildAgenda(t, preset, opts({ issue: 2 }));
  assert.ok(!odd.slots.some((x) => x.kind === 'rumor'), 'слух через выпуск: нечётный без слуха');
  const rumor = even.slots.find((x) => x.kind === 'rumor');
  assert.ok(rumor, 'чётный — со слухом');
  assert.equal(rumor.author.kind, 'cast', 'подслушал конкретный статист каста');
  assert.equal(rumor.rumor, true);
});

test('квота: о главных не больше трети окна — при переполнении слот уходит фону', () => {
  const s = semester({ threads: 2 });
  rootPosts(s, 12, false);
  rootPosts(s, 8, true);
  assert.deepEqual(mainShare(s), { main: 8, total: WINDOW });
  fact(s, 'f1');
  assert.equal(mainRoom(s, 1, 4), false);
  const a = buildAgenda(s, preset, opts());
  assert.ok(!a.slots.some((x) => x.kind === 'main'));
  assert.equal(a.mainDenied, true);

  const fresh = semester({ threads: 2 });
  rootPosts(fresh, 17, false);
  rootPosts(fresh, 3, true);
  fact(fresh, 'f1');
  assert.equal(mainRoom(fresh, 1, 4), true, '3 из 20 — есть место');
  assert.ok(buildAgenda(fresh, preset, opts()).slots.some((x) => x.kind === 'main'));
});

test('повестка при N=1 маленькая, сюжетик продвигается не каждый выпуск', () => {
  const s = semester({ threads: 2 });
  fact(s, 'f1');
  const first = buildAgenda(s, preset, opts({ every: 1, issue: 1 }));
  assert.ok(first.slots.length <= 2 && first.slots.length >= 1);
  const crowd = (issue) => buildAgenda(s, preset, opts({ every: 1, issue })).slots.find((x) => x.kind === 'crowd');
  assert.equal(crowd(2).advance, true);
  assert.equal(crowd(1).advance, false, 'нечётный: без шага вперёд');
});

test('календарь: событие в пределах 14 дней даёт слот, дальше горизонта — нет', () => {
  const s = semester({ threads: 0 });
  s.events = [{ id: 'e1', name: 'Бал выпускников', from: '2026-10-15' }];
  assert.ok(calendarNames(s, preset).includes('Бал выпускников'), 'своё событие чата — в календаре');
  const near = buildAgenda(s, preset, opts()).slots.find((x) => x.kind === 'calendar');
  assert.ok(near, 'через 7 дней — слот есть');
  assert.equal(near.topic, 'Бал выпускников');
  assert.equal(near.event.days, 7);

  s.events = [{ id: 'e1', name: 'Бал выпускников', from: '2026-12-30' }];
  const far = buildAgenda(s, preset, opts()).slots.find((x) => x.kind === 'calendar' && x.topic === 'Бал выпускников');
  assert.equal(far, undefined, 'через два с лишним месяца — рано');
});

test('календарь: тема сюжетика не дублируется слотом календаря', () => {
  const s = semester({ threads: 0 });
  startThread(s, { topic: 'Бал выпускников', members: ['cast3', 'cast1'], dispute: 'спорят о билетах', source: 'calendar', day: DAY });
  s.events = [{ id: 'e1', name: 'Бал выпускников', from: '2026-10-15' }];
  const slots = buildAgenda(s, preset, opts()).slots;
  assert.ok(slots.some((x) => x.kind === 'crowd'));
  assert.equal(slots.filter((x) => x.topic === 'Бал выпускников' && x.kind === 'calendar').length, 0);
});

// --- промпт ---------------------------------------------------------------------------------

test('промпт: мир, календарь, каст, повестка, ветки «израсходованы», формат и правила', () => {
  const s = semester({ threads: 2 });
  addFeedItem(s, { id: 'old1', src: 'old', at: { day: DAY }, kind: 'reaction', nick: 'сердцеед', text: 'Бал будет жарким, билеты уже разбирают', heroine: false });
  const { work, agenda } = planIssue(s, preset, opts());
  const prompt = buildMolvaPrompt(work, preset, agenda);
  assert.match(prompt.user, /Календарь мира/);
  assert.match(prompt.user, /израсходованы/);
  assert.match(prompt.user, /Бал будет жарким/);
  assert.match(prompt.user, /Повестка выпуска/);
  assert.match(prompt.user, /П<номер слота> \|/);
  assert.match(prompt.user, /КОНЕЦ/);
  assert.match(prompt.user, /Свершившиеся события/);
  for (const slot of agenda.slots) assert.ok(prompt.user.includes(slot.author.name), 'автор слота назван в промпте');
  assert.ok(prompt.user.length < 6000, `короткий: ${prompt.user.length}`);
});

test('баг 57: промпт каста даёт список событий календаря и просит ссылаться только на них', () => {
  const s = semester();
  const cal = calendarNames(s, preset);
  assert.ok(cal.length > 0);
  const p = buildCastPrompt({ preset, calendar: cal, heroine: 'Аня' });
  assert.match(p.user, /только эти/);
  for (const name of cal.slice(0, 3)) assert.ok(p.user.includes(name));
  const none = buildCastPrompt({ preset, calendar: [] });
  assert.match(none.user, /нет ни праздников/);
});

// --- разбор и проверки ---------------------------------------------------------------------

/** Повестка на двух слотах с известными авторами — разбор не зависит от случая. */
function twoSlots() {
  const author = (id, name) => ({ id, kind: 'cast', name, masked: true, type: '', interest: '', goal: '', manner: '' });
  const A = author('cast1', 'всё-видел');
  const B = author('cast2', 'вечно второй');
  const C = author('cast3', 'крыса в углу');
  const D = author('cast4', 'сердцеед');
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

test('разбор: посты и ответы по номерам слотов, конец помечен', () => {
  const r = parse([
    'П1 | всё-видел | Говорят, помолвка уже назначена, только никому!',
    'О1 | вечно второй | А кто сказал, что она вообще согласилась?',
    'П2 | крыса в углу | На турнир по шахматам записалось всего трое.',
    'О2 | сердцеед | Так давайте позовём всех с танцев, будет весело.',
    'КОНЕЦ',
  ].join('\n'));
  assert.equal(r.complete, true);
  assert.deepEqual(r.rejected, []);
  assert.deepEqual(r.lines.map((l) => `${l.kind}${l.n}`), ['post1', 'reply1', 'post2', 'reply2']);
});

test('баг 55: ответ привязан номером слота — про турнир не попадает под помолвку, даже если строки перепутаны', () => {
  const r = parse([
    'П1 | всё-видел | Говорят, помолвка уже назначена, только никому!',
    'П2 | крыса в углу | На турнир по шахматам записалось всего трое.',
    'О2 | сердцеед | Так давайте позовём всех с танцев, будет весело.',
    'О1 | вечно второй | А кто сказал, что она вообще согласилась?',
    'КОНЕЦ',
  ].join('\n'));
  const under = (n) => r.lines.filter((l) => l.kind === 'reply' && l.n === n).map((l) => l.text);
  assert.match(under(2)[0], /танцев/);
  assert.match(under(1)[0], /согласилась/);
  // Строки сгруппированы: ответ идёт сразу за постом своего слота.
  assert.deepEqual(r.lines.map((l) => `${l.kind}${l.n}`), ['post1', 'reply1', 'post2', 'reply2']);
});

test('ответ без поста слота не привязывается к чужому', () => {
  const r = parse([
    'П2 | крыса в углу | На турнир по шахматам записалось всего трое.',
    'О1 | вечно второй | А кто сказал, что она вообще согласилась?',
    'КОНЕЦ',
  ].join('\n'));
  assert.deepEqual(r.lines.map((l) => `${l.kind}${l.n}`), ['post2']);
  assert.match(r.rejected[0].reason, /поста этого слота нет/);
});

test('баг 56: обрывок поста и последняя строка без конца отбрасываются', () => {
  assert.equal(isCutOff('Говорят, она ляпнула про'), true);
  assert.equal(isCutOff('Говорят, она ляпнула про…'), true);
  assert.equal(isCutOff('Так, а я хотел бы, чтобы'), true);
  assert.equal(isCutOff('Он сказал: «давай'), true);
  assert.equal(isCutOff('Ждём бал,'), true);
  assert.equal(isCutOff('Что?'), false);
  assert.equal(isCutOff('Говорят, она ляпнула такое, что все ахнули.'), false);
  assert.equal(isCutOff('пишу коротко без точки'), false);

  const cut = parse([
    'П1 | всё-видел | Говорят, помолвка уже назначена, только никому!',
    'П2 | крыса в углу | Говорят, она ляпнула про',
    'КОНЕЦ',
  ].join('\n'));
  assert.deepEqual(cut.lines.map((l) => l.n), [1]);
  assert.match(cut.rejected[0].reason, /на полуслове/);

  const noEnd = parse([
    'П1 | всё-видел | Говорят, помолвка уже назначена, только никому!',
    'П2 | крыса в углу | На турнир по шахматам записалось всего трое.',
  ].join('\n'), { truncated: true });
  assert.equal(noEnd.complete, false);
  assert.deepEqual(noEnd.lines.map((l) => l.n), [1], 'ответ упёрся в потолок: последняя строка вон');
  assert.match(noEnd.rejected[0].reason, /оборван/);

  const calm = parse([
    'П1 | всё-видел | Говорят, помолвка уже назначена, только никому!',
    'П2 | крыса в углу | На турнир по шахматам записалось всего трое.',
  ].join('\n'));
  assert.deepEqual(calm.lines.map((l) => l.n), [1, 2], 'нет метки, но строка законченная и потолка не было');
});

test('самоответ до чужого ответа и два подряд от одного — вон; возвращение после чужого — можно', () => {
  const self = parse([
    'П1 | всё-видел | Говорят, помолвка уже назначена, только никому!',
    'О1 | всё-видел | Да-да, и я об этом тоже слышал.',
    'КОНЕЦ',
  ].join('\n'));
  assert.deepEqual(self.lines.map((l) => l.kind), ['post']);
  assert.match(self.rejected[0].reason, /самому себе|не тот/);

  const back = parse([
    'П1 | всё-видел | Говорят, помолвка уже назначена, только никому!',
    'О1 | вечно второй | А кто сказал, что она вообще согласилась?',
    'О1 | всё-видел | Мои источники не ошибаются.',
    'КОНЕЦ',
  ].join('\n'));
  assert.deepEqual(back.lines.map((l) => l.kind), ['post', 'reply', 'reply']);

  const twice = parse([
    'П1 | всё-видел | Говорят, помолвка уже назначена, только никому!',
    'О1 | вечно второй | А кто сказал, что она вообще согласилась?',
    'О1 | вечно второй | И вообще, мне это не нравится.',
    'КОНЕЦ',
  ].join('\n'));
  assert.deepEqual(twice.lines.map((l) => l.kind), ['post', 'reply']);
  assert.match(twice.rejected[0].reason, /подряд/);
});

test('два поста подряд одного автора — второй вон; автор последнего поста ленты не открывает выпуск', () => {
  const { agenda, pool } = twoSlots();
  agenda.slots[1].author = agenda.slots[0].author;
  const r = parseIssue([
    'П1 | всё-видел | Говорят, помолвка уже назначена, только никому!',
    'П2 | всё-видел | И ещё я слышал про турнир, но это секрет.',
    'КОНЕЦ',
  ].join('\n'), agenda, { pool, stop: STOP });
  assert.deepEqual(r.lines.map((l) => l.n), [1]);
  assert.match(r.rejected[0].reason, /тот же автор/);

  const t = twoSlots();
  const g = parseIssue('П1 | всё-видел | Говорят, помолвка уже назначена!\nКОНЕЦ', { ...t.agenda, lastKey: 'n:все видел' }, { pool: t.pool, stop: STOP });
  assert.equal(g.lines.length, 0);
});

test('автор: не из каста, не назначенный, героиня и персонаж карточки — вон', () => {
  const r = parse([
    'П1 | Новый Незнакомец | Говорят, помолвка уже назначена, только никому!',
    'П1 | вечно второй | Кто-то должен был это сказать вслух.',
    'П1 | всё-видел | Говорят, помолвка уже назначена, только никому!',
    'П2 | Аня Кравцова | Я тут ни при чём, это всё враньё.',
    'П2 | Мирон Князев | Я не люблю такие разговоры.',
    'КОНЕЦ',
  ].join('\n'));
  assert.deepEqual(r.lines.map((l) => l.n), [1]);
  assert.deepEqual(r.rejected.map((x) => x.reason.replace(/«.*?»/, '«»')), [
    'автор «» не из каста и не из «Людей»',
    'пишет не тот, кого назначила повестка',
    'автор «» не из каста и не из «Людей»',
    'автор «» не из каста и не из «Людей»',
  ]);
});

test('речь о героине вне слота главных — вон (квота держится кодом, не просьбой)', () => {
  assert.equal(mentionsStop('Аня опять опоздала на пару', STOP), true);
  assert.equal(mentionsStop('Мирона снова не видно', STOP), true);
  assert.equal(mentionsStop('Бал будет шикарным', STOP), false);
  const r = parse([
    'П1 | всё-видел | Говорят, Аня вчера опять опоздала на пару, а все смотрят.',
    'П2 | крыса в углу | На турнир по шахматам записалось всего трое.',
    'КОНЕЦ',
  ].join('\n'));
  assert.deepEqual(r.lines.map((l) => l.n), [2]);
  assert.match(r.rejected[0].reason, /героине/);
});

test('длина и повторы: длинное режется по предложению или вон, пустое и повтор вон', () => {
  const long = 'Это первое предложение, оно вполне годится как реплика. ' + 'А дальше идёт очень длинный хвост без конца и края, '.repeat(6);
  const r = parse([`П1 | всё-видел | ${long}`, 'П2 | крыса в углу | да', 'КОНЕЦ'].join('\n'));
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0].text, 'Это первое предложение, оно вполне годится как реплика.');
  assert.match(r.rejected[0].reason, /пустая/);

  const nolong = parse([`П1 | всё-видел | ${'Очень длинное слово '.repeat(12)}`, 'КОНЕЦ'].join('\n'));
  assert.equal(nolong.lines.length, 0);
  assert.match(nolong.rejected[0].reason, /длиннее/);

  const dup = parse([
    'П1 | всё-видел | Говорят, помолвка уже назначена, только никому!',
    'П2 | крыса в углу | Говорят, помолвка уже назначена, только никому!',
    'КОНЕЦ',
  ].join('\n'));
  assert.deepEqual(dup.lines.map((l) => l.n), [1]);
  assert.match(dup.rejected[0].reason, /повтор/);

  const old = parse('П1 | всё-видел | Бал будет жарким, билеты уже разбирают!\nКОНЕЦ', { existing: ['Бал будет жарким, билеты уже разбирают'] });
  assert.equal(old.lines.length, 0);
});

test('имена сокурсников узнаются полным именем, именем и фамилией', () => {
  const pool = rumorAuthors(semester(), { stop: STOP });
  assert.equal(resolveAuthor('Вера Соколова', pool).id, 'sokolova');
  assert.equal(resolveAuthor('Вера', pool).id, 'sokolova');
  assert.equal(resolveAuthor('Орлова', pool).id, 'orlova');
  assert.equal(resolveAuthor('@всё-видел (сплетник)', pool).id, 'cast1');
  assert.equal(resolveAuthor('Кто-то', pool), null);
});

test('формат терпит маркеры списка, латинские буквы и «Пост 1»', () => {
  const r = parse([
    '1. П1 | всё-видел | Говорят, помолвка уже назначена, только никому!',
    '- O1 | вечно второй | А кто сказал, что она вообще согласилась?',
    '**P2** | крыса в углу | На турнир по шахматам записалось всего трое.',
    'КОНЕЦ',
  ].join('\n'));
  assert.deepEqual(r.lines.map((l) => `${l.kind}${l.n}`), ['post1', 'reply1', 'post2']);
});

// --- запись, откат, повтор ------------------------------------------------------------------

function issueOn(s, text, extra = {}) {
  const { work, agenda } = planIssue(s, preset, opts());
  const result = parseIssue(text(agenda), agenda, { pool: rumorAuthors(work, { stop: STOP }), stop: STOP });
  const res = applyIssue(work, result, agenda, { stamp: 'm-1', ...extra });
  return { work, agenda, result, res };
}

/** Ответ модели по повестке: каждый слот — пост назначенного автора и ответ назначенного отвечающего. */
const answer = (agenda) => [
  ...agenda.slots.flatMap((s, i) => [
    `П${s.n} | ${s.author.name} | Пост номер ${i + 1}: про ${s.topic.slice(0, 20)}, и это не конец истории.`,
    ...(s.replier && s.maxReplies ? [`О${s.n} | ${s.replier.name} | Ответ номер ${i + 1}: не согласен, давайте по-честному!`] : []),
  ]),
  'КОНЕЦ',
].join('\n');

test('выпуск ложится в ленту: посты, ответы к своим постам, сюжетик на шаг вперёд, счёт обнулён', () => {
  const s = tickMolva(tickMolva(tickMolva(semester({ threads: 2 }))));
  const before = openThreads(s).map((t) => `${t.id}:${t.stage}`);
  const { work, agenda, res, result } = issueOn(s, answer);
  assert.equal(res.ok, true);
  assert.ok(res.posts >= 3 && res.replies >= 2, `${res.posts} постов, ${res.replies} ответов: ${JSON.stringify(result.rejected)} ${JSON.stringify(agenda.slots.map((x) => [x.kind, x.mode, x.author.name]))}`);
  const items = feedItems(work);
  const posts = items.filter((x) => !x.parent);
  assert.equal(posts.length, res.posts);
  for (const r of items.filter((x) => x.parent)) {
    const post = posts.find((p) => p.id === r.parent);
    assert.ok(post, 'ответ привязан к существующему посту');
    assert.notEqual(post.nick, r.nick, 'не самоответ');
  }
  for (const p of posts) assert.ok(p.nick, 'под ником каста');
  const crowd = agenda.slots.find((x) => x.kind === 'crowd');
  if (crowd.advance) {
    const now = openThreads(work).find((t) => t.id === crowd.threadId);
    const was = before.find((x) => x.startsWith(`${crowd.threadId}:`)).split(':')[1];
    assert.equal(now.stage, STAGES[STAGES.indexOf(was) + 1], 'стадия сдвинулась');
  }
  const molva = normalizeFeed(work.feed).molva;
  assert.equal(molva.issue, agenda.issue);
  assert.equal(molva.since, 0);
});

test('главный факт становится темой один раз, слух ложится в анонимку с пометкой слуха', () => {
  const s = semester({ threads: 2 });
  fact(s, 'f1');
  fact(s, 'p1', { rumor: true, gist: 'Аня и Мирон вместе', text: 'слух' });
  const { work, agenda, res } = (() => {
    const plan = planIssue(s, preset, opts({ issue: 2 }));
    const result = parseIssue(answer(plan.agenda), plan.agenda, { pool: rumorAuthors(plan.work, { stop: STOP }), stop: STOP });
    return { ...plan, result, res: applyIssue(plan.work, result, plan.agenda, { stamp: 'm-2' }) };
  })();
  assert.equal(res.ok, true);
  const main = agenda.slots.find((x) => x.kind === 'main');
  assert.ok(main);
  const posts = feedItems(work).filter((x) => x.src.startsWith('molva-') && !x.parent);
  assert.ok(posts.some((x) => x.heroine && x.chan === 'chat'), 'пост о главных — в чате');
  const used = normalizeFeed(work.feed).molva.facts;
  assert.ok(used.includes('f1'));
  assert.equal(newFacts(work).open.length, 0, 'факт больше не новый');
  const rumor = agenda.slots.find((x) => x.kind === 'rumor');
  if (rumor) assert.ok(posts.some((x) => x.chan === 'anon' && x.rumor), 'слух — в анонимке, со слухом');
});

test('пустой выпуск ничего не пишет; при сбое автомата счёт обнуляется, по кнопке — нет', () => {
  let s = tickMolva(tickMolva(tickMolva(semester({ threads: 2 }))));
  const { work, agenda, result } = issueOn(s, () => 'просто болтовня без формата\nКОНЕЦ');
  const manual = applyIssue(work, result, agenda, {});
  assert.equal(manual.ok, false);
  assert.equal(manual.delta, null);
  assert.equal(normalizeFeed(work.feed).molva.since, 3, 'по кнопке счёт не трогаем');
  const auto = applyIssue(work, result, agenda, { resetOnFail: true });
  assert.equal(auto.ok, false);
  assert.equal(normalizeFeed(work.feed).molva.since, 0, 'автомат не догоняет пропущенное');
  assert.equal(feedItems(work).length, 0);
});

test('выпуск откатывается вместе с ответом и возвращается повтором дельты', () => {
  const s0 = semester({ threads: 2 });
  const ticked = tickMolva(s0);
  const { res } = issueOn(ticked, answer);
  const delta = res.delta;
  assert.equal(delta.stamp, 'm-1');
  // Откат: состояние «до ответа» не знает о выпуске.
  assert.equal(feedItems(s0).length, 0);
  // Пересчёт того же ответа: тик, затем повтор дельты — те же записи, счёт ноль.
  const again = replayMolva(tickMolva(s0), [delta], 'm-1');
  assert.deepEqual(feedItems(again).map((x) => x.id), delta.items.map((x) => x.id));
  assert.equal(normalizeFeed(again.feed).molva.since, 0);
  assert.equal(normalizeFeed(again.feed).molva.issue, delta.molva.issue);
  assert.deepEqual(openThreads(again), delta.threads.map((t) => ({ ...t })));
  // Другой вариант ответа (иной отпечаток) дельту не получает.
  const other = replayMolva(tickMolva(s0), [delta], 'm-2');
  assert.equal(feedItems(other).length, 0);
  assert.equal(normalizeFeed(other.feed).molva.since, 1);
  // Дельта переживает хранилище.
  const read = readDeltas(JSON.parse(JSON.stringify([delta])));
  assert.equal(read.length, 1);
  assert.equal(read[0].items.length, delta.items.length);
  assert.deepEqual(readDeltas('мусор'), []);
});

test('состояние старого семестра без счёта выпусков читается как пустой счёт', () => {
  const s = semester();
  delete s.feed.molva;
  assert.deepEqual(normalizeFeed(s.feed).molva, { issue: 0, since: 0, facts: [], at: { day: '', time: '' } });
  assert.equal(THREADS_MAX, 3);
  assert.equal(ensureFeed({}).molva.issue, 0);
});

test('generateMolva: текст и признак обрыва отдаются как есть, сбой — с причиной', async () => {
  const prompt = { system: 's', user: 'u' };
  const ok = await generateMolva(prompt, {}, null, { ask: async (p) => ({ ok: true, text: 'П1 | а | б', truncated: true, seen: p }) });
  assert.deepEqual(ok, { ok: true, text: 'П1 | а | б', truncated: true });
  const bad = await generateMolva(prompt, {}, null, { ask: async () => ({ ok: false, code: 'rate', message: 'слишком часто' }) });
  assert.deepEqual(bad, { ok: false, code: 'rate', error: 'слишком часто' });
  assert.ok(TOKEN_BUDGETS.molva >= 2048, 'бюджет с запасом на размышление');
});

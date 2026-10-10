// Прогон 10.10, пятый (баги 87–94): персонаж карточки по-русски, дела героини, подпись
// скачка, календарь слухов с датами, чужие заклинания, «Оставить как было», повод
// «говорят о», повтор оборотов автора.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseAnalysis, isFactToken, tokenEvent, tokenText } from '../core/analysis.mjs';
import { cardDisplayName } from '../core/parse-marker.mjs';
import { dealText } from '../core/scene.mjs';
import { stopList } from '../core/stop-names.mjs';
import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { setCast, foreignSpell, buildCastPrompt } from '../core/feed-cast.mjs';
import { openDeal, addFeedItem } from '../core/feed.mjs';
import { addEvent } from '../core/holidays.mjs';
import { hookCore } from '../core/plot.mjs';
import {
  planIssue, buildMolvaPrompt, parseIssue, calendarTimeline, repeatedPhrase,
} from '../core/molva.mjs';
import { feedView } from '../ui/feed.js';
import { todayView } from '../ui/today.js';
import { resolveHeldJump } from '../core/engine.mjs';

const load = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));
const preset = load('ru-university');
const SUBJECTS = [{ id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' }];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }];
const DAY = '2026-10-08';
const CAST = [
  { id: 'cast1', nick: 'всёвидел', type: 'сплетник', interest: 'чужие тайны', goal: 'узнать', manner: 'a', ally: 'cast2', rival: 'cast3' },
  { id: 'cast2', nick: 'вечновторой', type: 'ботан', interest: 'олимпиады', goal: 'обойти', manner: 'b', ally: 'cast1', rival: 'cast4' },
  { id: 'cast3', nick: 'крысаугол', type: 'тихоня', interest: 'шахматы', goal: 'попасть', manner: 'c', ally: 'cast4', rival: 'cast1' },
  { id: 'cast4', nick: 'сердцеед', type: 'сердцеед', interest: 'танцы', goal: 'позвать', manner: 'd', ally: 'cast3', rival: 'cast2' },
];
const PEOPLE = [{ name: 'Vandrel Kharis', aliases: ['Вандрел Харис', 'Вандрел'] }];
const NAMES = { user: 'Ренее де Лакруа', char: ['Vandrel Kharis', 'Вандрел Харис', 'Вандрел'], cast: PEOPLE };

function semester(day = DAY) {
  const s = createState(preset, {
    startDay: '2026-09-01', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
    classmates: [{ id: 'sokolova', name: 'Вера Соколова', relation: 0, desire: '', problem: '' }],
  });
  s.started = true;
  s.calendar.day = day;
  setCast(s, CAST);
  return s;
}
const lexicon = (s, names = NAMES) => ({ ...preset, subjects: s.subjects, teachers: s.teachers, classmates: s.classmates, names });
const withEvents = (s, list) => list.reduce((acc, [name, from]) => addEvent(acc, { name, from }).state, s);
const cardOf = (raw, names) => {
  const s = semester();
  const res = parseAnalysis(`<!-- [ACADEMY clash=@heroine:${raw}:списки] -->`, lexicon(s, names), { posts: false });
  const ev = tokenEvent(res.tokens.find(isFactToken), lexicon(s, names));
  return ev && ev.b;
};

// --- 87 -------------------------------------------------------------------------------------

test('87: персонаж карточки хранится по-русски — как написал секретарь', () => {
  assert.equal(cardOf('Вандрел Харис'), '@card/Вандрел Харис');
});

test('87: секретарь написал латиницей — берётся русское написание из алиасов', () => {
  assert.equal(cardOf('Vandrel Kharis'), '@card/Вандрел Харис');
});

test('87: русского написания нет — имя карточки, как было', () => {
  const names = { user: 'Ренее', char: ['Vandrel Kharis'], cast: [{ name: 'Vandrel Kharis', aliases: [] }] };
  assert.equal(cardOf('Vandrel Kharis', names), '@card/Vandrel Kharis');
});

test('87: cardDisplayName — язык анкеты выбирает написание', () => {
  assert.equal(cardDisplayName('Vandrel Kharis', 'Vandrel Kharis', PEOPLE, 'ru'), 'Вандрел Харис');
  assert.equal(cardDisplayName('Вандрел Харис', 'Vandrel Kharis', PEOPLE, 'en'), 'Vandrel Kharis');
  assert.equal(cardDisplayName('Вандрел', 'Vandrel Kharis', [], 'ru'), 'Вандрел');
});

// --- 88 -------------------------------------------------------------------------------------

test('88: обязанность героине — «{героиня} должна {кому}», а не «обещает»', () => {
  const a = { kind: 'deal', a: '@heroine', b: '@card/Вандрел Харис', what: 'работа в паре' };
  assert.equal(dealText(a, [], 'Ренее'), 'Ренее должна Вандрелу: работа в паре');
  // Записано наоборот: Вандрел → героине. Работа — на героине, направление выправляется.
  assert.equal(dealText({ ...a, a: '@card/Вандрел Харис', b: '@heroine' }, [], 'Ренее'), 'Ренее должна Вандрелу: работа в паре');
  for (const what of ['явка в деканат', 'уборка аудитории', 'отработка в архиве', 'ночное дежурство', 'наказание: переписать устав']) {
    assert.match(dealText({ ...a, a: '@card/Вандрел Харис', b: '@heroine', what }, [], 'Ренее'), /^Ренее должна Вандрелу: /, what);
  }
  // Не обязанность — направление как записано.
  assert.equal(dealText({ kind: 'deal', a: '@card/Вандрел Харис', b: '@heroine', what: 'вернуть книгу' }, [], 'Ренее'), 'Вандрел Харис должен Ренее: вернуть книгу');
});

test('88: «Незакрытые дела» — только в основном канале, не в «Анонимке»', () => {
  const s = semester();
  openDeal(s, { a: '@heroine', b: '@card/Вандрел Харис', what: 'работа в паре', src: 'm', day: DAY });
  addFeedItem(s, { id: 'f1', src: 'm', at: { day: DAY }, kind: 'fact', text: 'x', gist: 'x', about: ['@heroine'], heroine: true });
  assert.equal(feedView(s, preset, { chan: 'chat', heroine: 'Ренее' }).deals.length, 1);
  assert.equal(feedView(s, preset, { chan: 'anon', heroine: 'Ренее' }).deals.length, 0);
});

// --- 89 -------------------------------------------------------------------------------------

test('89: плашка скачка — «в календаре — {дата}», без падежной ошибки, во всех пресетах', () => {
  const ids = readdirSync(fileURLToPath(new URL('../presets/', import.meta.url))).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  assert.equal(ids.length, 12);
  for (const id of ids) {
    const line = load(id).ui.jumpLine;
    assert.equal(line, 'В ответе — {date}, в календаре — {from}. Принять новую дату?', id);
    assert.ok(!/стоит на/.test(line), id);
  }
});

// --- 90 -------------------------------------------------------------------------------------

test('90: календарь в промпте слухов — прошедшее и будущее с числом дней и запретом', () => {
  const s = withEvents(semester('2026-10-08'), [['Мабон', '2026-10-05'], ['Осенний бал', '2026-10-12']]);
  const line = calendarTimeline(s, preset);
  assert.deepEqual(line.filter((e) => e.name === 'Мабон').map((e) => [e.state, e.days]), [['past', 3]]);
  assert.deepEqual(line.filter((e) => e.name === 'Осенний бал').map((e) => [e.state, e.days]), [['ahead', 4]]);
  const stop = stopList({ user: 'Ренее де Лакруа', preset });
  const { work, agenda } = planIssue(s, preset, { stop, every: 3 });
  const p = buildMolvaPrompt(work, preset, agenda, {}).user;
  assert.match(p, /Мабон — уже прошло, 3 дня назад/);
  assert.match(p, /Осенний бал — ещё не наступило, будет через 4 дня/);
  assert.match(p, /о прошедшем нельзя говорить как о будущем/);
  assert.deepEqual(agenda.past.map((e) => e.name), ['Мабон']);
});

test('90: реплика с прошедшим событием в будущем смысле — замечание, не отброс', () => {
  const s = withEvents(semester('2026-10-08'), [['Мабон', '2026-10-05']]);
  const stop = stopList({ user: 'Ренее де Лакруа', preset });
  const { work, agenda } = planIssue(s, preset, { stop, every: 3 });
  const slot = agenda.slots[0];
  const text = `П${slot.n} | ${slot.author.name} | Все готовятся к Мабону, как будто он ещё впереди.\nКОНЕЦ`;
  const r = parseIssue(text, agenda, { pool: [slot.author, ...(slot.replier ? [slot.replier] : [])], stop });
  assert.equal(r.lines.length, 1, 'реплика принята');
  assert.equal(r.warned.length, 1);
  assert.match(r.warned[0].reason, /Мабон.*уже прошло/);
  // Прошедшее в прошедшем смысле — без замечаний.
  const ok = parseIssue(`П${slot.n} | ${slot.author.name} | Хорошо вспоминать, как отплясывали на Мабоне вчера.\nКОНЕЦ`.replace('на Мабоне', 'тогда'), agenda, { pool: [slot.author], stop });
  assert.equal(ok.warned.length, 0);
  assert.ok(work);
});

test('90: событие из разбора получает конкретную дату от дня сцены и уходит в прошедшие', () => {
  const t = tokenText('event=+1:Бал', { ...preset }, { day: '2026-10-08', today: '2026-10-08' });
  assert.match(t, /Бал — завтра, 9 октября/);
  const later = tokenText('event=+1:Бал', { ...preset }, { day: '2026-10-08', today: '2026-10-15' });
  assert.match(later, /9 октября — уже прошло/);
  assert.equal(tokenText('event=+1:Бал', { ...preset }), 'Бал — завтра', 'без дня сцены — как раньше');
});

// --- 91 -------------------------------------------------------------------------------------

test('91: в промптах нет названий чужих заклинаний; код отбрасывает реплику с ними', () => {
  const cast = buildCastPrompt({ preset, heroine: 'Аня' });
  const s = semester();
  const stop = stopList({ user: 'Ренее де Лакруа', preset });
  const { work, agenda } = planIssue(s, preset, { stop, every: 3 });
  const p = buildMolvaPrompt(work, preset, agenda, {});
  for (const txt of [`${cast.system}\n${cast.user}`, p.user]) {
    assert.doesNotMatch(txt, /Люмос|Обливиэйт|Экспеллиармус/i);
    assert.match(txt, /Только заклинания и термины этого мира и пресета, ничего из известных книг и фильмов/);
  }
  assert.ok(foreignSpell('Я бы сказал «Экспеллиармус!» и всё'));
  assert.ok(foreignSpell('люмос максима, и свет'));
  assert.ok(foreignSpell('Avada Kedavra'));
  assert.equal(foreignSpell('Огонь вспыхнул над кафедрой, зажги свет.'), '');
  const slot = agenda.slots[0];
  const r = parseIssue(`П${slot.n} | ${slot.author.name} | Он шепнул Люмос, и в аудитории стало светло, представляете.\nКОНЕЦ`, agenda, { pool: [slot.author], stop });
  assert.equal(r.lines.length, 0);
  assert.match(r.rejected[0].reason, /заклинание из чужого произведения/);
});

// --- 92 -------------------------------------------------------------------------------------

test('92: после «Оставить как было» строка «Время сдвинулось» не показывается', () => {
  const s = semester('2026-10-08');
  s.calendar.source = 'A';
  s.calendar.idle = 0;
  assert.match(todayView(s, preset).timeMark, /Время сдвинулось в последнем ответе/);
  s.calendar.heldJump = { day: '2026-11-20', from: DAY, jump: 43, source: 'A' };
  const declined = resolveHeldJump(s, preset, false).state;
  assert.ok(declined.calendar.dismissedJump);
  assert.equal(todayView(declined, preset).timeMark, '');
});

// --- 93 -------------------------------------------------------------------------------------

test('93: повод по посту о публичном факте — «говорят о …», слово «слух» только у слухов', () => {
  const s = semester();
  addFeedItem(s, {
    id: 'molva-1#1', src: 'molva-1', at: { day: DAY }, kind: 'reaction', chan: 'chat', nick: 'всёвидел', text: 'Опять они за своё.',
    factText: 'Ренее и Вандрел Харис — стычка из-за списков', rumor: false, status: 'new',
  });
  const core = hookCore(s, 'molva-1#1', { preset, heroine: 'Ренее' });
  assert.match(core.core, /^говорят о Ренее и Вандрел Харис — стычка из-за списков: «Опять они за своё» \(@всёвидел\)$/);
  assert.equal(core.rumor, false);
  addFeedItem(s, {
    id: 'molva-1#2', src: 'molva-1', at: { day: DAY }, kind: 'reaction', chan: 'anon', nick: 'крысаугол', text: 'Слышала, они наедине ругались.',
    factText: 'разговор наедине', rumor: true, status: 'new',
  });
  const rumor = hookCore(s, 'molva-1#2', { preset, heroine: 'Ренее' });
  assert.match(rumor.core, /^пишут без подписи/);
  assert.equal(rumor.rumor, true);
});

// --- 94 -------------------------------------------------------------------------------------

test('94: оборот и начало автора в последних трёх репликах — повтор', () => {
  const author = { id: 'cast1', kind: 'cast', name: 'всёвидел', manner: '' };
  const mine = (text) => ({ kind: 'reaction', who: '', nick: 'всёвидел', text });
  const history = [
    mine('Клянусь Основателями, это был последний раз.'),
    mine('Я бы так не подставился, честное слово.'),
    mine('Ну да, если не боишься вылететь с круга, пиши.'),
  ];
  assert.ok(repeatedPhrase('Клянусь Основателями, они опять опоздали.', author, history, new Map()), 'начало');
  assert.ok(repeatedPhrase('Нет, я бы так не подставился никогда.', author, history, new Map()), 'оборот в середине');
  assert.ok(repeatedPhrase('Лучше молчи, если не боишься вылететь с круга.', author, history, new Map()), 'хвост');
  assert.equal(repeatedPhrase('В буфете сегодня снова пирожки.', author, history, new Map()), '');
  assert.equal(repeatedPhrase('Не знаю, я не знаю.', author, [mine('Я не знаю.')], new Map()), '', 'короткое «я не знаю» — не оборот');
  // Чужие реплики не в счёт; реплика из этого же выпуска — в счёт.
  assert.equal(repeatedPhrase('Клянусь Основателями, да.', author, [{ kind: 'reaction', nick: 'другой', text: 'Клянусь Основателями, нет.' }], new Map()), '');
  assert.ok(repeatedPhrase('Клянусь Основателями, да.', author, [], new Map([['n:всевидел', ['Клянусь Основателями, нет.']]])));
});

test('94: в промпте автору показаны его последние реплики с пометкой «не повторяй»', () => {
  const s = semester();
  addFeedItem(s, { id: 'molva-1#1', src: 'molva-1', at: { day: DAY }, kind: 'reaction', chan: 'chat', nick: 'всёвидел', text: 'Клянусь Основателями, это было жестоко.', status: 'new' });
  const stop = stopList({ user: 'Ренее де Лакруа', preset });
  const { work, agenda } = planIssue(s, preset, { stop, every: 3 });
  const p = buildMolvaPrompt(work, preset, agenda, {}).user;
  if (agenda.slots.some((x) => [x.author, x.replier].some((a) => a && a.name === 'всёвидел'))) {
    assert.match(p, /недавние реплики \(обороты и начала не повторяй\): «Клянусь Основателями/);
  }
  assert.match(p, /Свои обороты автор не повторяет/);
});

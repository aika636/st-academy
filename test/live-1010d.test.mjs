// Прогон 10.10, четвёртый (баги 79–86): персонаж карточки как участник факта, громкость без
// факта, переезд календаря сдвигает даты, тема сюжетика без обрезков, день недели при
// придержанном скачке, подписи.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseAnalysis, isFactToken, tokenEvent } from '../core/analysis.mjs';
import { applySceneEvents, applyLoudScene, sceneText } from '../core/scene.mjs';
import { dropTokenAt } from '../core/analysis.mjs';
import { setCast, rumorAuthors } from '../core/feed-cast.mjs';
import { startThread, openThreads, settleThreads } from '../core/feed-threads.mjs';
import { buildAgenda, newFacts } from '../core/molva.mjs';
import { addFeedItem } from '../core/feed.mjs';
import { setAbsolute, weekdayShiftOf, shiftStateDates } from '../core/time.mjs';
import { stopList } from '../core/stop-names.mjs';
import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';

const load = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));
const preset = load('ru-university');
const SUBJECTS = [{ id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' }];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }];
const COURSE = [{ id: 'sokolova', name: 'Вера Соколова', relation: 0, desire: '', problem: '' }];
const DAY = '2026-10-08';
const NAMES = { user: 'Аня Кравцова', char: 'Вандрел Харис' };
const STOP = stopList({ ...NAMES, preset });
const CAST = [
  { id: 'cast1', nick: 'всёвидел', type: 'сплетник', interest: 'чужие тайны', goal: 'узнать', manner: 'a', ally: 'cast2', rival: 'cast3' },
  { id: 'cast2', nick: 'вечновторой', type: 'ботан', interest: 'олимпиады', goal: 'обойти', manner: 'b', ally: 'cast1', rival: 'cast4' },
  { id: 'cast3', nick: 'крысаугол', type: 'тихоня', interest: 'шахматы', goal: 'попасть', manner: 'c', ally: 'cast4', rival: 'cast1' },
  { id: 'cast4', nick: 'сердцеед', type: 'сердцеед', interest: 'танцы', goal: 'позвать', manner: 'd', ally: 'cast3', rival: 'cast2' },
];

function semester(day = DAY) {
  const s = createState(preset, {
    startDay: '2026-09-01', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset), classmates: COURSE,
  });
  s.started = true;
  s.calendar.day = day;
  setCast(s, CAST);
  return s;
}
const lexicon = (s) => ({ ...preset, subjects: s.subjects, teachers: s.teachers, classmates: s.classmates, names: NAMES });
const itemsOf = (res, s) => res.tokens.filter(isFactToken).map((token) => ({ token, ev: tokenEvent(token, lexicon(s)) }));

// --- 79 -------------------------------------------------------------------------------------

test('79: стычка героини с персонажем карточки принимается и идёт в «Главные»', () => {
  const s = semester();
  const res = parseAnalysis('<!-- [ACADEMY clash=@heroine:Вандрел Харис:списки пар на бал] -->\nloud=2', lexicon(s), { posts: false });
  assert.deepEqual(res.rejected, []);
  assert.equal(res.tokens.filter(isFactToken).length, 1);
  assert.ok(res.tokens.includes('loud=2'));
  const next = applySceneEvents(s, itemsOf(res, s), preset, { src: 'm', day: DAY, heroine: 'Аня', stop: STOP });
  const fact = next.feed.items.find((x) => x.kind === 'fact');
  assert.match(fact.text, /Аня и Вандрел Харис/);
  assert.equal(fact.heroine, true);
  assert.equal(newFacts(next).open.length, 1);
  const agenda = buildAgenda(next, preset, { stop: STOP, issue: 2, every: 3 });
  assert.ok(agenda.slots.some((x) => x.kind === 'main'), 'слот «Главные» в повестке');
  assert.equal(next.classmateCandidates.length, 0, 'в «Люди» не попал');
  assert.equal(next.classmates.length, 1);
});

test('79: персонаж карточки по-прежнему не новое лицо, не сокурсник и не автор', () => {
  const s = semester();
  const res = parseAnalysis('<!-- [ACADEMY new=Вандрел Харис met=Вандрел Харис] -->', lexicon(s), { posts: false });
  assert.equal(res.tokens.filter(isFactToken).length, 0);
  assert.equal(res.rejected.length, 2);
  assert.ok(res.rejected.every((r) => /стоп-лист \(карточка\)/.test(r.reason)), JSON.stringify(res.rejected));
  assert.ok(!rumorAuthors(s, { stop: STOP }).some((a) => /Вандрел/.test(a.name || '')));
  // Стычка двух карточек без человека — не факт о главных.
  const two = parseAnalysis('<!-- [ACADEMY clash=Вандрел Харис:Вандрел Харис:спор] -->', lexicon(s), { posts: false });
  assert.equal(two.tokens.filter(isFactToken).length, 0);
  // Слух о карточке и дело с ней — принимаются.
  const ok = parseAnalysis('<!-- [ACADEMY rumor=Вандрел Харис:ведёт тайные списки deal=@heroine:Вандрел Харис:списки] -->', lexicon(s), { posts: false });
  assert.deepEqual(ok.rejected, []);
  assert.equal(ok.tokens.filter(isFactToken).length, 2);
});

test('79: громкость остаётся и при отвергнутом факте, и без факта; громкая сцена — повод для «Главные»', () => {
  const s = semester();
  const bad = parseAnalysis('<!-- [ACADEMY new=Вандрел Харис] -->\nloud=3', lexicon(s), { posts: false });
  assert.ok(bad.tokens.includes('loud=3'), bad.tokens.join(' | '));
  const bare = parseAnalysis('Ничего особенного.\nloud=2', lexicon(s), { posts: false });
  assert.ok(bare.tokens.includes('loud=2'));
  assert.equal(parseAnalysis('Тихо.\nloud=1', lexicon(s), { posts: false }).tokens.includes('loud=1'), false, 'тихая голая громкость — шум');

  const next = applyLoudScene(s, [], preset, { src: 'm', day: DAY, heroine: 'Аня', loud: 3 });
  const open = newFacts(next).open;
  assert.equal(open.length, 1);
  assert.match(open[0].text, /громкая сцена/);
  assert.equal(open[0].heroine, true);
  assert.equal(applyLoudScene(s, [], preset, { src: 'm', day: DAY, loud: 1 }), s, 'тихая сцена повода не даёт');
  // Идемпотентность и «факт уже есть».
  assert.equal(newFacts(applyLoudScene(next, [], preset, { src: 'm', day: DAY, heroine: 'Аня', loud: 3 })).open.length, 1);
  const withClash = parseAnalysis('<!-- [ACADEMY clash=sokolova:@heroine:спор] -->\nloud=3', lexicon(s), { posts: false });
  assert.equal(applyLoudScene(s, itemsOf(withClash, s), preset, { src: 'm', day: DAY, loud: 3 }), s);
  // Вычеркнули единственный факт — громкость ушла вместе с ним.
  const dropped = dropTokenAt(withClash.tokens, withClash.tokens.findIndex((t) => t.startsWith('clash=')));
  assert.equal(dropped.some((t) => t.startsWith('loud=')), false);
});

test('79: текст стычки с карточкой — имя как есть', () => {
  const ev = { kind: 'clash', a: '@heroine', b: '@card/Вандрел Харис', reason: 'списки' };
  assert.equal(sceneText(ev, [], 'Аня'), 'стычка: Аня и Вандрел Харис — списки');
});

// --- 80 -------------------------------------------------------------------------------------

test('80: переезд календаря на год сюжета сдвигает ленту, сюжетики и журнал', () => {
  let s = semester('2026-10-12');
  startThread(s, { topic: 'Мабон', members: ['cast1', 'cast2'], dispute: 'спорят', source: 'calendar', day: '2026-09-18', on: '2026-09-21' });
  addFeedItem(s, { id: 'f1', src: 'm', at: { day: '2026-10-10' }, kind: 'fact', text: 'стычка', gist: 'стычка', about: ['@heroine'], heroine: true });
  s.journal.push({ day: '2026-10-11', kind: 'time', text: 'x' });
  s.calendar.moved = 3;
  s = setAbsolute(s, { day: '1248-10-18' }, 'A', preset).state;
  s = setAbsolute(s, { day: '1248-10-18' }, 'A', preset).state;
  assert.equal(s.calendar.day, '1248-10-12', 'якорь переехал, прыжок на 6 дней придержан');
  assert.equal(s.feed.items[0].at.day, '1248-10-10');
  assert.equal(s.feed.threads[0].since, '1248-09-18');
  assert.equal(s.feed.threads[0].on, '1248-09-21');
  assert.equal(s.journal[0].day, '1248-10-11');
  // «Мабон» давно позади — сюжетик подводит итог или закрыт.
  settleThreads(s, s.calendar.day);
  const left = openThreads(s).find((t) => t.topic === 'Мабон');
  assert.ok(!left || left.stage === 'развязка', JSON.stringify(left));
});

test('80: shiftStateDates сдвигает только даты и не трогает числа', () => {
  const s = { feed: { molva: { since: 5, at: { day: '2026-01-02' } }, items: [{ at: { day: '2026-02-03' }, text: '2026-02-03' }] }, calendar: { day: '2026-01-01' } };
  assert.equal(shiftStateDates(s, -778), 2);
  assert.equal(s.feed.molva.since, 5);
  assert.equal(s.feed.molva.at.day, '1248-01-02');
  assert.equal(s.feed.items[0].text, '2026-02-03');
  assert.equal(s.calendar.day, '2026-01-01', 'календарь сдвигает вызывающий');
});

// --- 85 -------------------------------------------------------------------------------------

test('85: день недели метки учитывается, пока скачок придержан', () => {
  let s = semester('1248-10-12');
  s.calendar.moved = 1;
  const r1 = setAbsolute(s, { day: '1248-12-24', weekday: 2 }, 'A', preset);
  assert.ok(r1.held, 'скачок придержан');
  assert.equal(r1.state.calendar.day, '1248-10-12');
  const r2 = setAbsolute(r1.state, { day: '1248-12-24', weekday: 2 }, 'A', preset);
  assert.ok(r2.held);
  assert.notEqual(weekdayShiftOf(r2.state), 0, 'сдвиг поставлен по двум придержанным ответам');
});

// --- 81 -------------------------------------------------------------------------------------

test('81: тема сюжетика обрезается по слову, а не посреди слова', () => {
  const s = semester();
  const topic = 'задание по предмету «аналитическая химия и неорганический синтез в условиях большой лаборатории второго этажа»';
  const r = startThread(s, { topic, members: ['cast1', 'cast2'], dispute: 'спорят', source: 'cast', day: DAY });
  assert.ok(r.ok);
  assert.ok(r.thread.topic.length <= 90);
  assert.ok(r.thread.topic.endsWith('…'), r.thread.topic);
  const head = r.thread.topic.slice(0, -1);
  assert.ok(topic.startsWith(head), 'префикс исходной темы');
  assert.match(topic[head.length] || ' ', /\s/, 'резали на границе слова');
});

test('81: темы пар не склеены «или»', async () => {
  const { spawnThread } = await import('../core/feed-threads.mjs');
  const s = semester();
  for (let i = 0; i < 3; i += 1) spawnThread(s, preset, { day: DAY });
  assert.ok(s.feed.threads.length > 0);
  for (const t of s.feed.threads) assert.ok(!/ или /.test(t.topic), t.topic);
});

// --- 84 -------------------------------------------------------------------------------------

test('84: присказка автора в третьей реплике подряд отбрасывается', async () => {
  const { overusedCatchphrase, catchphrases } = await import('../core/molva.mjs');
  const author = { id: 'cast1', kind: 'cast', name: 'всёвидел', manner: 'начинает с «только никому»' };
  assert.deepEqual(catchphrases(author.manner), ['только никому']);
  const mine = (text) => ({ kind: 'reaction', nick: 'всёвидел', text });
  const history = [mine('Только никому, Вера списала.'), mine('Ну, только никому: декан злой.')];
  assert.equal(overusedCatchphrase('Только никому, буфет закроют', author, history, new Map()), 'только никому');
  assert.equal(overusedCatchphrase('Буфет закроют, говорят.', author, history, new Map()), '', 'без присказки — можно');
  assert.equal(overusedCatchphrase('Только никому', author, history.slice(1), new Map()), '', 'в одной из двух — не тик');
});

test('84/91: в промптах каста и молвы чужие заклинания запрещены общими словами, без названий и присказка в каждой реплике', async () => {
  const { buildCastPrompt } = await import('../core/feed-cast.mjs');
  const { buildMolvaPrompt, planIssue } = await import('../core/molva.mjs');
  const cast = buildCastPrompt({ preset, heroine: 'Аня' });
  assert.match(`${cast.system}\n${cast.user}`, /ничего из известных книг и фильмов/);
  const s = semester();
  const { work, agenda } = planIssue(s, preset, { stop: STOP, every: 3 });
  const p = buildMolvaPrompt(work, preset, agenda, {});
  assert.match(p.user, /ничего из известных книг и фильмов/);
  assert.match(p.user, /не чаще одной реплики из трёх/);
});

// --- 86 -------------------------------------------------------------------------------------

test('86: «Оставить как было» — тот же день из следующих ответов не переспрашивается', async () => {
  const { applyResponse, resolveHeldJump } = await import('../core/engine.mjs');
  const magic = load('magic-academy');
  const subjects = [{ id: 'a', name: 'Алхимия', teacherId: 't' }];
  const st = createState(magic, {
    startDay: '2026-10-12', survey: {}, subjects, teachers: [{ id: 't', name: 'Магистр Т', traits: ['строг'] }], schedule: buildSchedule(subjects, magic),
  });
  st.started = true;
  st.calendar.moved = 1;
  const say = (x) => applyResponse(x, 'Прошёл месяц.\n[Date: 18/11/2026]', magic, { mode: 'auto' });
  let r = say(st);
  assert.ok(r.state.calendar.heldJump, 'скачок придержан');
  const s = resolveHeldJump(r.state, magic, false).state;
  assert.equal(s.calendar.heldJump, null);
  r = say(s);
  assert.equal(r.state.calendar.heldJump, null, 'вопрос не задан повторно');
  assert.ok(r.debug.notes.some((n) => /расходится с календарём/.test(n)), r.debug.notes.join('; '));
});

test('86: подписи скачка во всех пресетах — «Бот пишет … Принять новую дату?» и «Перескочили …»', () => {
  for (const f of ['cadet-academy', 'cn-highschool', 'dark-academia', 'hero-academy', 'jp-highschool', 'magic-academy', 'ru-school', 'ru-university', 'space-academy', 'us-college', 'us-highschool', 'xianxia-sect']) {
    const ui = load(f).ui;
    assert.match(ui.jumpLine, /^Бот пишет \{date\}, в календаре — \{from\}\. Принять новую дату\?$/, f);
    assert.match(ui.jumpAcceptedMissed, /^Перескочили \{days\} \{plural\}: \S+ засчитано как посещённые — \{count\}\.$/, f);
  }
});

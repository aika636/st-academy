// Поток курса (шаг 4) в ядре и вью: перенос отметок при пересчёте, фон
// строки состояния (слой 1), слух в лорбуке однокурсника (слой 2), «сыграно»
// от секретаря, потолок реакций пресета и вид вкладки «Поток».

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  addFeedItem, carryFeedMarks, feedBackground, rumorFor, markRead, markPlayed, setStatus, feedItem, unreadCount,
  putReactions, setLoudness, BACKGROUND_MAX, normalizeFeed,
} from '../core/feed.mjs';
import { revertSceneSource } from '../core/scene.mjs';
import { statusLine, buildPrompt, FEED_LINE_MAX } from '../prompt.mjs';
import { classmateEntry } from '../core/lorebook.mjs';
import { normalizePreset, normalizeFeedBlock } from '../core/preset.mjs';
import { parseAnalysis, buildAnalysisPrompt, isFactToken, isPlayedToken, playedOf, effectiveText, tokenText } from '../core/analysis.mjs';
import { markerPeople } from '../core/classmates.mjs';
import { createState, cloneState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { feedView, feedStatusText, extraLabels } from '../ui.js';
import { emptyPlot, takeHook, onGeneration } from '../core/plot.mjs';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));
const SUBJECTS = [{ id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' }];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }];
const COURSE = [
  { id: 'sokolova', name: 'Вера Соколова', desire: 'попасть в тройку лучших' },
  { id: 'orlova', name: 'Мила Орлова' },
  { id: 'gleb', name: 'Глеб Морозов' },
];
const DAY = '2026-10-07';

function semester(day = DAY) {
  const s = createState(preset, {
    startDay: '2026-09-01', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
    classmates: COURSE,
  });
  s.started = true;
  s.calendar.day = day;
  if (!s.classmates || !s.classmates.length) s.classmates = COURSE.map((c) => ({ ...c }));
  return s;
}

function withFeed(day = DAY) {
  const s = semester(day);
  // О героине — прогул, вчера; обсуждают в чате.
  addFeedItem(s, {
    id: 'a#1', src: 'a', at: { day: '2026-10-06' }, kind: 'reaction', chan: 'chat', who: 'orlova',
    text: 'А где Аня была на химии?', factRef: 'skip=chemistry', factText: 'прогул: аналитическая химия',
    heroine: true, about: ['@heroine'], loud: 1,
  });
  // Чужая стычка — сегодня, не прочитана.
  addFeedItem(s, {
    id: 'b@x', src: 'b', at: { day: DAY }, kind: 'fact', chan: 'chat', who: 'sokolova',
    text: 'стычка: Вера Соколова и Мила Орлова — из-за конспекта', factRef: 'clash=sokolova:orlova',
    about: ['sokolova', 'orlova'], loud: 2,
  });
  // Слух о героине в анонимке — сегодня.
  addFeedItem(s, {
    id: 'b#2', src: 'b', at: { day: DAY }, kind: 'reaction', chan: 'anon', who: 'someone',
    text: 'Аню видели с Петровым', factRef: 'met=sokolova', heroine: true, about: ['@heroine'], loud: 2,
  });
  // Старое — неделю назад.
  addFeedItem(s, {
    id: 'old', src: 'c', at: { day: '2026-09-30' }, kind: 'reaction', chan: 'chat', who: 'gleb',
    text: 'давняя история', heroine: true, factRef: 'grade=chemistry:5',
  });
  return s;
}

// --- перенос отметок при пересчёте (хвост шага 3) ---------------------------------------

test('пересчёт последнего ответа: «прочитано», «взято», «истекло» переносятся по id записи', () => {
  const before = semester();
  addFeedItem(before, { id: 'old#1', src: 'old', at: { day: DAY }, text: 'прошлый ответ' });
  // Живое состояние после ответа «m»: его записи и отметки, поставленные потом.
  const live = cloneState(before);
  putReactions(live, 'm', [{ fact: 'clash=a:b', who: 'orlova', chan: 'chat', text: 'опять она' }], { day: DAY });
  markRead(live);
  setStatus(live, 'old#1', 'taken');
  // Пересчёт от снимка «до»: записи те же, отметок нет.
  const again = cloneState(before);
  putReactions(again, 'm', [{ fact: 'clash=a:b', who: 'orlova', chan: 'chat', text: 'опять она' }], { day: DAY });
  assert.equal(feedItem(again, 'm#1').read, false);
  const carried = carryFeedMarks(live, again, 'm');
  assert.equal(feedItem(carried, 'm#1').read, true);
  assert.equal(feedItem(carried, 'old#1').read, true);
  assert.equal(feedItem(carried, 'old#1').status, 'taken');
  assert.equal(feedItem(again, 'old#1').status, 'new', 'вход не тронут');
  assert.equal(carryFeedMarks(semester(), again, 'm'), again, 'переносить нечего — тот же объект');
});

test('пересчёт: «сыграно» от самого ответа решает новый разбор, чужое «сыграно» переносится', () => {
  const live = semester();
  addFeedItem(live, { id: 'x', src: 'old', at: { day: DAY }, text: 'повод' });
  addFeedItem(live, { id: 'y', src: 'old', at: { day: DAY }, text: 'другой' });
  markPlayed(live, 'm', ['x']);
  markPlayed(live, 'earlier', ['y']);
  const again = semester();
  addFeedItem(again, { id: 'x', src: 'old', at: { day: DAY }, text: 'повод' });
  addFeedItem(again, { id: 'y', src: 'old', at: { day: DAY }, text: 'другой' });
  const carried = carryFeedMarks(live, again, 'm');
  assert.equal(feedItem(carried, 'x').status, 'taken', 'разбор ответа m без played — отметка снята');
  assert.equal(feedItem(carried, 'y').status, 'played', 'отметка другого ответа держится');
  markPlayed(again, 'm', ['x']);
  assert.equal(feedItem(carryFeedMarks(live, again, 'm'), 'x').playedSrc, 'm');
  // Снятие разбора по источнику снимает и его «сыграно».
  const undone = revertSceneSource(live, 'm');
  assert.equal(feedItem(undone, 'x').status, 'taken');
  assert.equal(feedItem(undone, 'y').status, 'played');
});

// --- фон строки состояния (слой 1) -------------------------------------------------------

test('фон: героиню знает всегда, чужое — только прочитанное; не больше двух; слух помечен', () => {
  const s = withFeed();
  let points = feedBackground(s);
  assert.deepEqual(points.map((p) => p.id), ['b#2', 'a#1'], 'о героине; громкое первым; старое и чужое непрочитанное — нет');
  assert.equal(points[0].kind, 'gossip');
  markRead(s, 'b@x');
  points = feedBackground(s);
  assert.equal(points.length, BACKGROUND_MAX);
  assert.ok(feedBackground(s, { max: 3 }).some((p) => p.id === 'b@x'), 'прочитанная стычка — знание героини');

  const line = statusLine(s, preset, { feed: {} });
  assert.match(line, /На курсе говорят: «Аню видели с Петровым» \(слух — правда ли, неизвестно\); прогул: аналитическая химия — обсуждают \(факт\)\.$/);
  assert.ok(line.split('На курсе говорят')[1].length <= FEED_LINE_MAX);
  assert.doesNotMatch(statusLine(s, preset), /говорят/, 'без просьбы — ни слова: секретарю сплетни не нужны');
  assert.doesNotMatch(statusLine(s, preset, { feed: { quiet: true } }), /говорят/, '«(без сплетен)» гасит фон');
  assert.match(buildPrompt(s, preset, { feed: {} }).status, /На курсе говорят/);
});

test('фон: слово пресета — «в классе говорят», «во взводе говорят»; «Говорят,» в реплике не двоится', () => {
  const load = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));
  const s = semester();
  addFeedItem(s, {
    id: 'g#1', src: 'g', at: { day: DAY }, kind: 'reaction', chan: 'anon', who: 'someone',
    text: 'Говорят, Аня списала контрольную', factRef: 'met=sokolova', heroine: true, about: ['@heroine'],
  });
  const school = statusLine(s, load('ru-school'), { feed: {} });
  assert.match(school, /В классе говорят: «Аня списала контрольную» \(слух — правда ли, неизвестно\)/);
  assert.doesNotMatch(school, /говорят: «Говорят/i, 'второго «говорят» нет');
  assert.doesNotMatch(school, /в потоке|на курсе/i, 'у школы — не слова вуза');
  assert.match(statusLine(s, load('cadet-academy'), { feed: {} }), /Во взводе говорят:/);
  assert.match(statusLine(s, load('space-academy'), { feed: {} }), /В экипаже говорят:/);
  assert.match(statusLine(s, load('xianxia-sect'), { feed: {} }), /Среди учеников говорят:/);
});

test('фон: пусто — ничего; чужое непрочитанное, истёкшее и праздники не звучат', () => {
  const s = semester();
  assert.doesNotMatch(statusLine(s, preset, { feed: {} }), /говорят/);
  addFeedItem(s, { id: 'e', src: 'e', at: { day: DAY }, kind: 'reaction', heroine: true, text: 'идём на бал?', factRef: 'event=+2:Бал' });
  addFeedItem(s, { id: 'z', src: 'z', at: { day: DAY }, kind: 'reaction', heroine: true, text: 'лопнуло', rumor: true });
  setStatus(s, 'z', 'expired');
  addFeedItem(s, { id: 'f', src: 'f', at: { day: DAY }, kind: 'fact', text: 'стычка чужих' });
  assert.deepEqual(feedBackground(s), []);
  assert.doesNotMatch(statusLine(s, preset, { feed: {} }), /говорят/);
  // Факт из сцены (прочитан) — с пометкой «факт».
  markRead(s, 'f');
  assert.match(statusLine(s, preset, { feed: {} }), /стычка чужих \(факт\)/);
});

test('фон: один пункт на факт, длина пункта ограничена', () => {
  const s = semester();
  for (let i = 1; i <= 3; i += 1) {
    addFeedItem(s, {
      id: `m#${i}`, src: 'm', at: { day: DAY }, kind: 'reaction', chan: 'chat', heroine: true,
      text: `реплика ${i}`, factRef: 'skip=chemistry', factText: 'прогул: аналитическая химия',
    });
  }
  addFeedItem(s, { id: 'long', src: 'n', at: { day: DAY }, kind: 'reaction', chan: 'anon', heroine: true, text: 'слово '.repeat(60) });
  const points = feedBackground(s);
  assert.equal(points.filter((p) => p.text.startsWith('прогул')).length, 1);
  assert.ok(points.every((p) => p.text.length <= 91));
});

// --- слух в лорбуке однокурсника (слой 2) -------------------------------------------------

test('слух в лорбуке: о нём, от него, или он был в сцене в тот день; чужого не слышал — нет', () => {
  const s = withFeed();
  // Соколова — сторона стычки: о ней свежее — анонимка того же ответа она не писала,
  // но стычка о ней.
  const vera = rumorFor(s, 'sokolova');
  assert.equal(vera.id, 'b@x');
  // Старая запись без сути одной фразой — «обсуждают: …».
  assert.match(classmateEntry(s, 'sokolova', preset).content, /На курсе обсуждают: стычка: Вера Соколова и Мила Орлова/);
  // С сутью — «говорят, что…».
  s.feed.items.find((x) => x.id === 'b@x').gist = 'Вера Соколова и Мила Орлова поссорились (из-за конспекта)';
  assert.match(classmateEntry(s, 'sokolova', preset).content, /На курсе говорят, что Вера Соколова и Мила Орлова поссорились \(из-за конспекта\)\./);
  // Глеб нигде не участвовал и в сцене не был — пусто (давнее не в счёт).
  assert.equal(rumorFor(s, 'gleb'), null);
  assert.doesNotMatch(classmateEntry(s, 'gleb', preset).content, /говорят/i);
  // Был в сцене сегодня — слышал сегодняшний факт. Реплики ленты (анонимка
  // «Аню видели…») в лорбук не идут: туда — суть факта, а не реплика.
  s.feed.seen.gleb = { day: DAY, time: '12:00' };
  const heard = rumorFor(s, 'gleb');
  assert.equal(heard.id, 'b@x');
  const entry = classmateEntry(s, 'gleb', preset).content;
  assert.doesNotMatch(entry, /Аню видели/);
  assert.equal(rumorFor(s, '@heroine'), null, 'у героини записи нет');
});

test('слух в лорбуке: суть слуха, а не реплика-опровержение; о ком слух и кто откликнулся', () => {
  const s = semester();
  // Слух из сцены о Соколовой (`rumor=sokolova:списала контрольную`) и
  // реплика Орловой в чате: «Это неправда!».
  addFeedItem(s, {
    id: 'r@1', src: 'r', at: { day: DAY }, kind: 'fact', chan: 'chat', factRef: 'rumor=sokolova:списала контрольную',
    text: 'слух: Вера Соколова — списала контрольную', gist: 'Вера Соколова списала контрольную',
    rumor: true, about: ['sokolova'],
  });
  addFeedItem(s, {
    id: 'r#1', src: 'r', at: { day: DAY }, kind: 'reaction', chan: 'chat', who: 'orlova', factRef: 'rumor=sokolova:списала контрольную',
    text: 'Это неправда!', factText: 'слух: Вера Соколова — списала контрольную', about: ['sokolova'],
  });
  assert.equal(normalizeFeed(s.feed).items.find((x) => x.id === 'r#1').rumor, false, 'реплика в чате про слух — обсуждение, не слух');
  const vera = classmateEntry(s, 'sokolova', preset).content;
  assert.match(vera, /Говорят \(может быть неправдой\), что Вера Соколова списала контрольную\./);
  assert.doesNotMatch(vera, /Это неправда/);
  // Орлова откликнулась на слух — значит, слышала его: суть и у неё.
  const mila = classmateEntry(s, 'orlova', preset).content;
  assert.match(mila, /Говорят \(может быть неправдой\), что Вера Соколова списала контрольную\./);
  assert.doesNotMatch(mila, /Это неправда/);
  // Глеб ни при чём и в сцене не был.
  assert.doesNotMatch(classmateEntry(s, 'gleb', preset).content, /говорят/i);
});

// --- секретарь: «повод сыгран» ---------------------------------------------------------------

test('секретарь: поводы в промпте, played=id — только знакомый, в движок не едет', () => {
  const s = semester();
  const lex = {
    ...preset, subjects: s.subjects, teachers: markerPeople(s), classmates: s.classmates, names: { user: 'Аня' },
    hooks: [{ id: 'p1', text: 'ходит слух: «Аню видели с Петровым»' }],
  };
  const prompt = buildAnalysisPrompt(s, preset, { reply: 'Сцена.', hooks: lex.hooks });
  assert.match(prompt.user, /Поводы, которые игрок отдал рассказчику \(id — что\):\n- p1 — ходит слух/);
  assert.match(prompt.user, /played — повод из списка «Поводы»/);
  assert.doesNotMatch(buildAnalysisPrompt(s, preset, { reply: 'Сцена.' }).user, /played/, 'без поводов — ни слова');

  const parsed = parseAnalysis('<!-- [ACADEMY played=p1 played=p7 met=sokolova] -->\nЧто сочинено:\nloud=1\nreact=3:orlova:chat:Видела их у столовой\nКратко: x', lex);
  assert.deepEqual(parsed.tokens.filter(isPlayedToken), ['played=p1']);
  assert.ok(parsed.rejected.some((r) => r.raw === 'played=p7'));
  assert.equal(parsed.tokens.filter((t) => t.startsWith('react=')).length, 1, 'номер факта считает played ключом');
  assert.deepEqual(playedOf(parsed.tokens), ['p1']);
  assert.equal(isFactToken('played=p1'), false);
  assert.doesNotMatch(effectiveText('текст', parsed.tokens), /played/);
  assert.equal(tokenText('played=p1', lex), 'повод сыгран: ходит слух: «Аню видели с Петровым»');
});

// --- пресет: feed.reactionCap ---------------------------------------------------------------

test('пресет: feed.reactionCap проходит, зажимается в 1–12, мусор — 6, не объект — отказ', () => {
  const builtins = { 'ru-university': preset };
  const ok = normalizePreset({ id: 'mine', feed: { reactionCap: 4 } }, { builtins });
  assert.ok(ok.ok, ok.message);
  assert.equal(ok.preset.feed.reactionCap, 4);
  const big = normalizePreset({ id: 'big', feed: { reactionCap: 40 } }, { builtins });
  assert.equal(big.preset.feed.reactionCap, 12);
  assert.ok(big.warnings.some((w) => w.includes('feed.reactionCap')));
  const zero = normalizePreset({ id: 'zero', feed: { reactionCap: 0 } }, { builtins });
  assert.equal(zero.preset.feed.reactionCap, 1);
  const junk = { feed: { reactionCap: 'много' } };
  assert.equal(normalizeFeedBlock(junk).warnings.length, 1);
  assert.equal(junk.feed.reactionCap, 6);
  assert.equal(normalizePreset({ id: 'bad', feed: 'шесть' }, { builtins }).ok, false);
  assert.ok(normalizePreset({ id: 'none' }, { builtins }).ok, 'блок необязателен');
});

// --- вид вкладки «Поток» --------------------------------------------------------------------

test('вид «Потока»: два канала, автор анонимки скрыт, статусы словами, непрочитанное и кнопка', () => {
  const s = withFeed();
  const X = extraLabels(preset);
  let v = feedView(s, preset, { chan: 'chat', heroine: 'Аня' });
  assert.deepEqual(v.channels.map((c) => [c.label, c.unread]), [['Чат курса', 3], ['Анонимка', 1]]);
  assert.deepEqual(v.items.map((i) => i.id), ['old', 'b@x', 'a#1'], 'новые сверху');
  const talk = v.items.find((i) => i.id === 'a#1');
  assert.equal(talk.who, 'Мила Орлова');
  assert.equal(talk.about, 'прогул: аналитическая химия', 'о чём — без «по поводу»');
  assert.equal(talk.tag, 'обсуждают', 'реплика в чате — обсуждение, а не «факт»');
  assert.equal(v.items.find((i) => i.id === 'b@x').tag, 'факт');
  assert.equal(talk.dayLine.length > 0, true);
  assert.equal(talk.unread, true);
  assert.equal(talk.canTake, true);
  assert.equal(v.items.find((i) => i.id === 'b@x').who, X.feedFromScene);
  assert.deepEqual(v.unreadIds.sort(), ['a#1', 'b@x', 'old']);

  v = feedView(s, preset, { chan: 'anon' });
  assert.deepEqual(v.items.map((i) => [i.who, i.tag, i.rumor]), [['без подписи', 'слух', true]]);

  // Взято в сюжет — кнопки нет, статус словами, очередь видна.
  const taken = takeHook(emptyPlot(), s, { ref: 'b#2' });
  const plot = onGeneration(taken.plot);
  v = feedView(taken.state, preset, { chan: 'anon', plot });
  assert.equal(v.items[0].statusText, 'взято в сюжет');
  assert.equal(v.items[0].canTake, false);
  assert.equal(v.queue.length, 1);
  assert.equal(v.queue[0].stateText, X.feedQueueNext);

  // Рубильник выключен — кнопок нет, подсказка другая.
  v = feedView(s, preset, { settings: { feed: { hooks: false } } });
  assert.equal(v.items.some((i) => i.canTake), false);
  assert.equal(v.note, X.feedHooksOff);

  // Прочитано, но было новым при открытии — выделение держится.
  markRead(s);
  v = feedView(s, preset, { fresh: new Set(['b@x']) });
  assert.deepEqual(v.items.filter((i) => i.unread).map((i) => i.id), ['b@x']);
  assert.equal(unreadCount(s), 0);

  // Пусто — по-человечески.
  v = feedView(semester(), preset);
  assert.equal(v.empty, true);
  assert.equal(v.emptyText, 'Пока тихо. Здесь появится то, что говорят, — после сохранённого разбора секретаря.');

  // Лопнуло и истекло.
  assert.equal(feedStatusText({ status: 'expired', rumor: true }, X), 'лопнуло');
  assert.equal(feedStatusText({ status: 'expired', rumor: false }, X), 'истекло');
  assert.equal(feedStatusText({ status: 'played' }, X), 'сыграно');
});

test('громкость разбора ложится на все записи ответа, нормализуется', () => {
  const s = semester();
  addFeedItem(s, { id: 'f', src: 'm', at: { day: DAY }, kind: 'fact', text: 'стычка' });
  putReactions(s, 'm', [{ fact: 'clash=a:b', text: 'ну и ну' }], { day: DAY, loud: 3 });
  setLoudness(s, 'm', 3);
  assert.deepEqual(normalizeFeed(s.feed).items.map((x) => x.loud), [3, 3]);
  assert.equal(normalizeFeed({ items: [{ id: 'x', text: 't', loud: 9 }] }).items[0].loud, null);
});

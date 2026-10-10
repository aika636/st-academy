// Формат ленты (решение 08.10): ветки ответов под постами, ники-маски и
// значки под постами. Разбор `reply=` и `~ник` секретаря, проверка кодом
// (сирота, потолок, героиня), ник не человек (состав, кандидаты, встречи,
// лорбук), вычеркнутое уносит ветку, кольцо вытесняет ветку целиком, счёт
// значков детерминирован, значок игрока переносится и откатывается, вид
// вкладки и плашки.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  parseAnalysis, buildAnalysisPrompt, reactionsOf, repliesOf, replyOf, isFactToken, tokenEvent, tokenText,
  dropTokenAt, pruneReactions, replyCap, REPLY_LIMITS, effectiveText,
} from '../core/analysis.mjs';
import {
  addFeedItem, putReactions, dropByFact, removeBySource, carryFeedMarks, feedBackground, rumorFor,
  reactCounts, reactSet, toggleReact, threadOf, repliesOf as feedReplies, recentPosts, normalizeFeed,
  cleanNick, nickWord, FEED_MAX, NICK_MAX, REACT_SETS,
} from '../core/feed.mjs';
import { applySceneEvents, applyReactions, localMet } from '../core/scene.mjs';
import { buildCastPrompt } from '../core/feed-cast.mjs';
import { markerPeople, listCandidates } from '../core/classmates.mjs';
import { buildEntries } from '../core/lorebook.mjs';
import { hookCore, threadTone, autoPick, emptyPlot } from '../core/plot.mjs';
import { createState, cloneState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { feedView, extraLabels } from '../ui.js';
import { talkGroups } from '../mes-panel.js';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));
const SUBJECTS = [{ id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' }];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }];
const COURSE = [
  { id: 'sokolova', name: 'Вера Соколова', relation: 0 },
  { id: 'orlova', name: 'Мила Орлова', relation: 0 },
];
const DAY = '2026-10-08';
const NAMES = { user: 'Аня', char: 'Мирон Князев' };

function semester() {
  const s = createState(preset, {
    startDay: '2026-09-01', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
    classmates: COURSE,
  });
  s.started = true;
  s.calendar.day = DAY;
  if (!s.classmates || !s.classmates.length) s.classmates = COURSE.map((c) => ({ ...c }));
  return s;
}

const lexicon = (s, extra = {}) => ({
  ...preset, subjects: s.subjects, teachers: markerPeople(s), classmates: s.classmates, survey: s.survey, names: NAMES, ...extra,
});

/** Разбор целиком в ленту — так, как его кладёт пересчёт ответа. */
function applyAll(s, raw, src = 'm1', extra = {}) {
  const lex = lexicon(s, extra);
  const parsed = parseAnalysis(raw, lex);
  const items = parsed.tokens.filter(isFactToken).map((token) => ({ token, ev: tokenEvent(token, lex) }));
  let next = applySceneEvents(s, items, preset, { src, day: DAY, stop: NAMES });
  next = applyReactions(next, src, reactionsOf(parsed.tokens), new Map(items.map((x) => [x.token, x.ev])), {
    day: DAY, loud: 2, replies: repliesOf(parsed.tokens),
  });
  return { next, ...parsed };
}

const SCANDAL = [
  '<!-- [ACADEMY clash=sokolova:@heroine:из-за конспекта] -->',
  'Что сочинено:',
  'loud=2',
  'react=1:~школьный бес:chat:Опять Соколова орёт на всю аудиторию',
  'react=1:orlova:chat:Аня вообще-то права',
  'reply=1:sokolova:Это я-то ору?',
  'reply=1:~школьный бес:Ты, ты, кто же ещё',
  'reply=2:альфа футбольной команды:chat:Поддерживаю Милу',
  'Кратко: стычка из-за конспекта.',
].join('\n');

// --- разбор ------------------------------------------------------------------------

test('ник: «~» — маска, пробелы и дефисы держатся, двоеточий нет, потолок длины', () => {
  assert.equal(cleanNick('~школьный бес'), 'школьный бес');
  assert.equal(cleanNick('~я-люблю-никки-из-11-класса'), 'я-люблю-никки-из-11-класса');
  assert.equal(cleanNick('~школьный_бес'), 'школьный_бес');
  assert.equal(cleanNick('~а'), '', 'одна буква — не ник');
  assert.equal(cleanNick('~очень-очень-длинный-ник-который-не-влезет-никуда').length <= NICK_MAX, true);
  assert.equal(nickWord('школьный бес'), '@школьный бес');
});

test('секретарь: реакции под ником, ответы в ветках — канонические токены', () => {
  const s = semester();
  const res = parseAnalysis(SCANDAL, lexicon(s));
  const reacts = reactionsOf(res.tokens);
  assert.deepEqual(reacts.map((r) => [r.who, r.nick]), [['', 'школьный бес'], ['orlova', '']]);
  const replies = repliesOf(res.tokens);
  assert.deepEqual(replies.map((a) => [a.parent.token === reacts[0].token, a.who, a.nick, a.chan, a.text]), [
    [true, 'sokolova', '', 'chat', 'Это я-то ору?'],
    [true, '', 'школьный бес', 'chat', 'Ты, ты, кто же ещё'],
    [false, '', 'альфа футбольной команды', 'chat', 'Поддерживаю Милу'],
  ], 'ник без знака — тоже маска; лишний канал после автора пропущен');
  assert.equal(replies[2].parent.token, reacts[1].token);
  // Ответы и реакции движку не едут.
  assert.doesNotMatch(effectiveText('текст', res.tokens), /reply=|react=|школьный/);
  // Слова плашки — без служебного.
  const lex = lexicon(s);
  const words = res.tokens.filter((t) => !isFactToken(t)).map((t) => tokenText(t, lex));
  assert.deepEqual(words.slice(0, 4), [
    '@школьный бес: «Опять Соколова орёт на всю аудиторию»',
    'Мила Орлова: «Аня вообще-то права»',
    'Вера Соколова: «Это я-то ору?»',
    '@школьный бес: «Ты, ты, кто же ещё»',
  ]);
  for (const w of words) assert.doesNotMatch(w, /~|reply|react|r\.[0-9a-z]/);
});

test('секретарь: ответ без поста, к отвергнутой реакции и от героини — отброшены', () => {
  const s = semester();
  const res = parseAnalysis([
    '<!-- [ACADEMY clash=sokolova:@heroine:из-за конспекта] -->',
    'loud=3',
    'react=1:~бес:chat:Первый пост',
    'react=7:orlova:chat:Пост без факта',
    'reply=9:~кто-то:Ответ в никуда',
    'reply=2:orlova:Ответ к отвергнутому',
    'reply=f1:~сплетник:Старой ветки нет',
    'reply=1:Аня:Это я, героиня',
    'reply=1:~Аня:Под маской тоже нет',
    'reply=:~бес:Без ссылки',
  ].join('\n'), lexicon(s));
  assert.equal(repliesOf(res.tokens).length, 0);
  const why = res.rejected.map((r) => r.reason).join(' | ');
  assert.match(why, /нет поста номер 9/);
  assert.match(why, /пост номер 2 не записан/);
  assert.match(why, /нет поста «f1» в ленте/);
  assert.match(why, /героиня — не реакция/);
  assert.match(why, /ответ без поста/);
  assert.equal(res.rejected.filter((r) => /героиня/.test(r.reason)).length, 2);
});

test('секретарь: потолок ответов — до двух под постом, всего по громкости; тихо — можно ноль', () => {
  const s = semester();
  assert.deepEqual([0, 1, 2, 3].map(replyCap), [1, 2, 3, REPLY_LIMITS.total]);
  const many = (loud) => parseAnalysis([
    '<!-- [ACADEMY clash=sokolova:@heroine:из-за конспекта] -->',
    `loud=${loud}`,
    'react=1:~бес:chat:Первый пост',
    'react=1:orlova:chat:Второй пост',
    ...[1, 2, 3].map((n) => `reply=1:~голос ${n}:ответ номер ${n} первому`),
    ...[1, 2, 3].map((n) => `reply=2:~эхо ${n}:ответ номер ${n} второму`),
  ].join('\n'), lexicon(s));
  const loudOne = many(3);
  assert.equal(repliesOf(loudOne.tokens).length, 4, 'скандал — до четырёх');
  assert.ok(loudOne.rejected.some((r) => /под одним постом — до 2/.test(r.reason)));
  assert.equal(repliesOf(many(0).tokens).length, 1, 'тихо — не больше одного');
  const quiet = parseAnalysis('<!-- [ACADEMY grade=chemistry:5] -->\nloud=0\nКратко: пятёрка.', lexicon(s));
  assert.deepEqual(quiet.tokens, ['grade=chemistry:5', 'loud=0'], 'ни реакций, ни ответов — норма; громкость остаётся при факте');
});

test('секретарь: автор поста не отвечает сам себе — только после чужого ответа', () => {
  const s = semester();
  const res = parseAnalysis([
    '<!-- [ACADEMY clash=sokolova:@heroine:из-за конспекта] -->',
    'loud=3',
    'react=1:~альфа футбольной команды:chat:Он зачёты за минуты разнёс',
    'react=1:orlova:chat:Аня вообще-то права',
    'reply=1:~Альфа футбольной команды:Ещё бы, попробуй подойди',
    'reply=2:orlova:И ещё раз скажу',
    'reply=2:sokolova:Да кто тебя спрашивал',
    'reply=2:orlova:Ты и спрашивала',
  ].join('\n'), lexicon(s));
  assert.deepEqual(repliesOf(res.tokens).map((a) => [a.who, a.nick, a.text]), [
    ['sokolova', '', 'Да кто тебя спрашивал'],
    ['orlova', '', 'Ты и спрашивала'],
  ], 'ник сравнивается без регистра; после чужого ответа автор возвращается');
  assert.equal(res.rejected.filter((r) => /отвечает сам себе/.test(r.reason)).length, 2);
  // Два «кто-то с курса» — не один голос.
  const anon = parseAnalysis([
    '<!-- [ACADEMY clash=sokolova:@heroine:из-за конспекта] -->',
    'loud=2',
    'react=1:someone:anon:Говорят, опять поругались',
    'reply=1:someone:Да они каждый день',
  ].join('\n'), lexicon(s));
  assert.equal(repliesOf(anon.tokens).length, 1);
  // Старая ветка, где уже отвечали, — автору есть кому ответить.
  const posts = [{ ref: 'f1', id: 'm0#1', who: '', nick: 'школьный бес', chan: 'chat', text: 'Пост', replies: 0 }];
  const lone = parseAnalysis('<!-- [ACADEMY met=sokolova] -->\nloud=1\nreply=f1:~школьный бес:Я же говорил', lexicon(s, { feedPosts: posts }));
  assert.equal(repliesOf(lone.tokens).length, 0);
  const busy = parseAnalysis('<!-- [ACADEMY met=sokolova] -->\nloud=1\nreply=f1:~школьный бес:Я же говорил', lexicon(s, { feedPosts: [{ ...posts[0], replies: 1 }] }));
  assert.equal(repliesOf(busy.tokens).length, 1);
});

test('секретарь: недавние посты ленты в промпте, ответ продолжает старую ветку', () => {
  const s = semester();
  const old = applyAll(s, SCANDAL, 'm0').next;
  const posts = recentPosts(old);
  assert.deepEqual(posts.map((p) => p.ref), ['f1', 'f2']);
  assert.equal(posts[1].replies, 2);
  const { user } = buildAnalysisPrompt(old, preset, { reply: 'Соколова опять ворчит.', heroine: 'Аня' });
  // Шаг 3 «Слухов»: секретарь постов не пишет — ни ленты, ни реплик, ни ников в его промпте.
  assert.doesNotMatch(user, /Недавно в ленте|reply=куда|react=номер|смешными никами/);
  assert.match(user, /loud=0\.\.3/);
  assert.match(user, /private=номера ключей блока 1/);
  assert.match(user, /Реплик курса, ников, строк react= и reply= в ответе не нужно/);
  assert.doesNotMatch(user, /\b(EVERY|MUST|STRICTLY|CRITICAL|ОБЯЗАТЕЛЬНО)\b/);

  // Ответ в старую ветку — от другого ответа модели.
  const next = applyAll(old, [
    '<!-- [ACADEMY met=sokolova] -->', 'loud=1',
    'reply=f2:~школьный бес:Я же говорил',
  ].join('\n'), 'm1', { feedPosts: posts }).next;
  const thread = threadOf(next, posts[1].id);
  assert.deepEqual(thread.replies.map((a) => [a.src, a.nick, a.text]), [
    ['m0', '', 'Это я-то ору?'], ['m0', 'школьный бес', 'Ты, ты, кто же ещё'], ['m1', 'школьный бес', 'Я же говорил'],
  ].map(([src, nick, text]) => [src, nick, text]));
  // Снятие этого разбора уносит только его ответ.
  removeBySource(next, 'm1');
  assert.equal(feedReplies(next, posts[1].id).length, 2);
});

// --- ник не человек ------------------------------------------------------------------

test('ник не попадает в состав, кандидатов, встречи, отношения и лорбук', () => {
  const s = semester();
  const { next, tokens } = applyAll(s, SCANDAL);
  assert.deepEqual(next.classmates.map((c) => c.id), ['sokolova', 'orlova']);
  assert.equal(listCandidates(next).length, 0);
  assert.equal(tokens.some((t) => /^(?:new|met)=/.test(t) && /бес|альфа/.test(t)), false);
  const seen = Object.keys(next.feed.seen);
  assert.equal(seen.some((k) => /бес|альфа/.test(k)), false);
  assert.ok(next.feed.items.filter((x) => x.nick).every((x) => x.who === ''), 'у маски нет автора-человека');
  assert.equal(rumorFor(next, 'школьный бес'), null);
  const book = JSON.stringify(buildEntries(next, preset));
  assert.doesNotMatch(book, /школьный бес|альфа футбольной/);
  // Встречи по имени не видят ника, даже если он мелькнул в тексте.
  assert.deepEqual(localMet(next, 'Школьный Бес снова пишет', { day: DAY }).met, []);
  // Однокурсница, ответившая в ветке, слышала факт — для лорбука это «слышала».
  assert.ok(rumorFor(next, 'sokolova'));
});

// --- лента: ветки, вычёркивание, кольцо ----------------------------------------------

test('вычеркнутый факт уносит посты и их ответы; вычеркнутый пост — свою ветку', () => {
  const s = semester();
  const { tokens, next } = applyAll(s, SCANDAL);
  const clash = tokens.indexOf('clash=sokolova:@heroine:из-за конспекта');
  assert.deepEqual(dropTokenAt(tokens, clash), [], 'факт ушёл — ушло всё сочинённое');
  const firstPost = tokens.findIndex((t) => t.startsWith('react='));
  const left = dropTokenAt(tokens, firstPost);
  assert.deepEqual(repliesOf(left).map((a) => a.text), ['Поддерживаю Милу'], 'ветка первого поста ушла с ним');
  const oneReply = tokens.findIndex((t) => t.startsWith('reply='));
  assert.equal(repliesOf(dropTokenAt(tokens, oneReply)).length, 2, 'ответ вычёркивается и один');
  assert.deepEqual(pruneReactions(tokens), tokens);
  assert.equal(replyOf('reply=r.zzz:~бес:chat:сирота', tokens).post, null);

  // В ленте: факт вычеркнут — посты и ответы, и чужой ответ к ним тоже.
  const posts = recentPosts(next);
  const later = applyAll(next, '<!-- [ACADEMY met=orlova] -->\nreply=f1:~бес:из другого ответа', 'm2', { feedPosts: posts }).next;
  assert.equal(later.feed.items.filter((x) => x.parent).length, 4);
  dropByFact(later, 'm1', 'clash=sokolova:@heroine:из-за конспекта');
  assert.equal(later.feed.items.some((x) => x.kind === 'reaction'), false, 'сирот лента не держит');
});

test('кольцо вытесняет ветку целиком, а не обрывает её посередине', () => {
  const s = semester();
  addFeedItem(s, { id: 'p0', text: 'старый пост', kind: 'reaction' });
  for (let i = 0; i < 3; i += 1) addFeedItem(s, { id: `p0^${i}`, parent: 'p0', text: `ответ ${i}`, kind: 'reaction' });
  for (let i = 1; i < FEED_MAX - 3; i += 1) addFeedItem(s, { id: `p${i}`, text: `пост ${i}`, kind: 'reaction' });
  assert.equal(s.feed.items.length, FEED_MAX);
  addFeedItem(s, { id: 'new', text: 'свежий пост', kind: 'reaction' });
  assert.equal(s.feed.items.some((x) => x.id === 'p0' || x.parent === 'p0'), false, 'пост ушёл с ответами');
  assert.equal(s.feed.items.length, FEED_MAX - 3);
  assert.equal(addFeedItem(s, { id: 'orphan', parent: 'nope', text: 'ответ в никуда' }), null);
  // Нормализация тоже не держит сирот.
  assert.equal(normalizeFeed({ items: [{ id: 'x', parent: 'gone', text: 'сирота' }] }).items.length, 0);
});

// --- значки ------------------------------------------------------------------------

test('значки: счёт от id и громкости, без модели; пересчёт и перерисовка его не меняют', () => {
  const s = semester();
  const a = applyAll(s, SCANDAL).next;
  const b = applyAll(s, SCANDAL).next;
  const post = (st) => st.feed.items.find((x) => x.id === 'm1#1');
  const ra = reactCounts(post(a), feedReplies(a, 'm1#1').length);
  assert.deepEqual(ra, reactCounts(post(b), feedReplies(b, 'm1#1').length));
  assert.ok(ra.length >= 3 && ra.length <= 4);
  assert.deepEqual(ra.map((r) => r.emoji), REACT_SETS.drama.slice(0, ra.length), 'стычка — драма');
  // Громкий пост — больше значков, чем тихий.
  const sum = (x) => reactCounts(x).reduce((n, r) => n + r.n, 0);
  assert.ok(sum({ id: 'q', loud: 3 }) > sum({ id: 'q', loud: 0 }));
  assert.deepEqual(reactSet({ chan: 'anon' }), REACT_SETS.anon);
  assert.deepEqual(reactSet({ chan: 'chat', loud: 1 }), REACT_SETS.chat);
  // У ответа — два-три значка из набора поста, и скромнее.
  const reply = reactCounts({ id: 'r', parent: 'q', chan: 'chat', loud: 3 });
  assert.ok(reply.length >= 2 && reply.length <= 3, JSON.stringify(reply));
  assert.ok(sum({ id: 'r', parent: 'q', loud: 3 }) < sum({ id: 'r', loud: 3 }), 'ответ тише поста');
});

test('значок игрока: переключатель, +1 и подсветка; переносится пересчётом и откатывается с лентой', () => {
  const s = semester();
  const before = cloneState(s);
  const live = applyAll(s, SCANDAL).next;
  const id = 'm1#1';
  const plain = reactCounts(live.feed.items.find((x) => x.id === id));
  assert.equal(toggleReact(live, id, '😱'), '😱');
  const mine = reactCounts(live.feed.items.find((x) => x.id === id));
  assert.equal(mine.find((r) => r.emoji === '😱').n, plain.find((r) => r.emoji === '😱').n + 1);
  assert.equal(mine.find((r) => r.emoji === '😱').mine, true);
  assert.equal(toggleReact(live, id, '❤️'), null, 'не из набора поста');
  assert.equal(toggleReact(live, 'm1^1', '🍿'), '🍿', 'у ответа — свой значок тоже');
  // Пересчёт того же ответа от снимка «до него» — значок переносится по id.
  const again = carryFeedMarks(live, applyAll(before, SCANDAL).next, 'm1');
  assert.equal(again.feed.items.find((x) => x.id === id).mine, '😱');
  // Откат (свайп) — ленты этого ответа нет, нет и значка.
  const rolled = carryFeedMarks(live, before, 'm1');
  assert.equal((rolled.feed ? rolled.feed.items : []).length, 0);
  // Снять — тем же значком.
  assert.equal(toggleReact(live, id, '😱'), '');
  // Состояние семестра значок не трогает: отношения те же.
  assert.deepEqual(live.classmates.map((c) => c.relation), before.classmates.map((c) => c.relation));
});

// --- вид, повод, фон ---------------------------------------------------------------

test('вид «Потока»: пост, ветка свёрнута после двух, маска отличается от человека, значки', () => {
  const s = semester();
  const next = applyAll(s, SCANDAL).next;
  addFeedItem(next, { id: 'm1^9', src: 'm9', parent: 'm1#1', kind: 'reaction', nick: 'третий лишний', text: 'А я всё видел' });
  const X = extraLabels(preset);
  let v = feedView(next, preset, { chan: 'chat', heroine: 'Аня' });
  assert.deepEqual(v.items.map((i) => i.id), ['m1#2', 'm1#1', next.feed.items[0].id], 'ответы — не отдельными карточками');
  const post = v.items.find((i) => i.id === 'm1#1');
  assert.deepEqual([post.who, post.nick], ['@школьный бес', true]);
  assert.deepEqual(post.replies.map((a) => [a.who, a.nick]), [['Вера Соколова', false], ['@школьный бес', true]]);
  assert.equal(post.more, 1);
  assert.equal(post.moreText, 'ещё 1 ответ');
  assert.equal(post.reacts.length, 4);
  assert.ok(post.reacts.every((r) => typeof r.emoji === 'string'));
  const human = v.items.find((i) => i.id === 'm1#2');
  assert.deepEqual([human.who, human.nick], ['Мила Орлова', false]);
  v = feedView(next, preset, { chan: 'chat', open: new Set(['m1#1']) });
  const opened = v.items.find((i) => i.id === 'm1#1');
  assert.deepEqual([opened.replies.length, opened.more, opened.unfolded], [3, 0, true]);
  assert.ok(v.unreadIds.includes('m1^1'), 'ответы тоже читаются');
  for (const it of v.items) assert.doesNotMatch(`${it.who} ${it.text} ${it.moreText}`, /~|reply|react|m1/);
  assert.equal(X.feedFoldReplies, 'свернуть ветку');
});

test('повод от поста с веткой: суть плюс «в ветке спорят»; маска рассказчику — «кто-то с курса»', () => {
  const s = semester();
  const next = applyAll(s, SCANDAL).next;
  const c = hookCore(next, 'm1#1', { heroine: 'Аня', preset });
  assert.equal(c.core, 'кто-то с курса пишет в чате: «Опять Соколова орёт на всю аудиторию»; в ветке спорят');
  assert.doesNotMatch(c.core, /бес|@|~/);
  assert.equal(threadTone(['Да ладно, неправда', 'ерунда']), 'argue');
  assert.equal(threadTone(['Поддерживаю', 'точно']), 'back');
  assert.equal(threadTone(['хахаха', 'лол']), 'tease');
  assert.equal(threadTone([]), '');
  assert.match(hookCore(next, 'm1#2', { preset }).core, /в ветке поддерживают$/);
  // Авто-режим ответов не берёт: повод — пост.
  const auto = autoPick(emptyPlot(), next, { enabled: true });
  assert.ok(auto.id === null || !next.feed.items.find((x) => x.id === auto.plot.queue[0].ref).parent);
});

test('типаж под ником: в ленте ник, рассказчику и секретарю — типаж', () => {
  const s = semester();
  const res = applyAll(s, [
    '<!-- [ACADEMY clash=sokolova:@heroine:из-за конспекта] -->',
    'loud=2',
    'react=1:~альфа футбольной команды (футболист-альфа):chat:Ещё бы, попробуй подойди к ней',
    'reply=1:~королева коридоров (королева школы):Тоже мне героиня',
    'reply=1:Вера Соколова (староста):Отстаньте от неё',
  ].join('\n'));
  const [post, reply, vera] = res.next.feed.items.filter((x) => x.kind === 'reaction');
  assert.deepEqual([post.nick, post.type], ['альфа футбольной команды', 'футболист-альфа']);
  assert.deepEqual([reply.nick, reply.type], ['королева коридоров', 'королева школы']);
  assert.deepEqual([vera.who, vera.nick, vera.type], ['sokolova', '', ''], 'у человека из списков типажа нет');
  const c = hookCore(res.next, post.id, { heroine: 'Аня', preset });
  assert.match(c.core, /^футболист-альфа пишет в чате: «Ещё бы, попробуй подойди к ней»/);
  assert.doesNotMatch(c.core, /альфа футбольной|@|~/);
  // Секретарь ников больше не видит: посты пишет слухи.
  const posts = recentPosts(res.next);
  assert.equal(posts[0].type, 'футболист-альфа');
  const { user } = buildAnalysisPrompt(res.next, preset, { reply: '…', heroine: 'Аня' });
  assert.doesNotMatch(user, /~альфа футбольной команды/);
});

test('типажи и примеры ников — из своего сеттинга: в космосе нет чирлидерши', () => {
  const load = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));
  const s = semester();
  // Списки идут в каст слухов (`buildCastPrompt`), а не секретарю.
  const prompt = (p) => buildCastPrompt({ preset: p, heroine: 'Аня' }).user;
  const space = prompt(load('space-academy'));
  assert.match(space, /ворчун из техотсека/);
  assert.match(space, /из реакторного отсека/);
  assert.doesNotMatch(space, /чирлидер|футбол|никки|школьный бес|королева школы/);
  assert.match(prompt(load('us-highschool')), /чирлидерша|альфа футбольной команды/);
  // Пресет без своих списков — общие слова, без примет школы.
  const bare = { ...preset, feed: undefined };
  const plain = prompt(bare);
  assert.match(plain, /завистница/);
  assert.doesNotMatch(plain, /чирлидер|футбол|школ/);
  // У каждого пресета списки свои и годные.
  for (const id of ['cadet-academy', 'cn-highschool', 'dark-academia', 'hero-academy', 'jp-highschool', 'magic-academy',
    'ru-school', 'ru-university', 'space-academy', 'us-college', 'us-highschool', 'xianxia-sect']) {
    const p = load(id);
    assert.ok(p.feed.extras.length >= 8, id);
    assert.ok(p.feed.nickExamples.every((n) => /^[^():~]+ \([^()]+\)$/.test(n)), `${id}: ник (типаж)`);
  }
});

test('фон: ответы в ветках не звучат отдельно, ник в фон не идёт', () => {
  const s = semester();
  const next = applyAll(s, SCANDAL).next;
  const bg = feedBackground(next, { max: 5 });
  assert.equal(bg.some((p) => next.feed.items.find((x) => x.id === p.id).parent), false);
  assert.doesNotMatch(JSON.stringify(bg), /школьный бес|альфа/);
});

test('плашка: ответы под своим постом, к старой ветке — с подписью', () => {
  const groups = talkGroups([
    { kind: 'react', index: 1, text: 'пост' },
    { kind: 'reply', index: 2, post: 1, text: 'ответ' },
    { kind: 'reply', index: 3, onPost: 'старый пост', text: 'в старую ветку' },
    { kind: 'course', index: 0, text: 'факт' },
  ]);
  assert.deepEqual(groups.posts.map((p) => [p.index, p.replies.map((a) => a.index)]), [[1, [2]]]);
  assert.deepEqual(groups.elsewhere.map((a) => [a.index, a.about]), [[3, 'ответ на «старый пост»']]);
});

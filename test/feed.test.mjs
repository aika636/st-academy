// Лента курса (`core/feed`): ленивое поле, нормализация, кольцо, реакции по
// источнику и факту, статусы и «прочитано», «был в сцене», дела, потолок пресета.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ensureFeed, normalizeFeed, addFeedItem, putReactions, dropByFact, removeBySource, markRead, setStatus,
  knownToHeroine, markSeen, restoreSeen, lastSeen, openDeal, closeDeal, revertDeal, openDeals,
  reactionCap, loudCap, FEED_MAX, REACTION_CAP, emptyMolva,
} from '../core/feed.mjs';

const bare = () => ({ calendar: { day: '2026-10-05' } });

test('лента: поля нет — пустая, битое — нормализуется, не бросает', () => {
  const s = bare();
  assert.deepEqual(ensureFeed(s), { items: [], seen: {}, deals: [], cast: [], threads: [], molva: emptyMolva() });
  assert.deepEqual(s.feed, { items: [], seen: {}, deals: [], cast: [], threads: [], molva: emptyMolva() });
  const raw = { items: [null, { id: 'a', text: '  слух  ', chan: 'anon', status: 'вечно' }, { id: '', text: 'x' }], seen: 'мусор', deals: [{}] };
  const feed = normalizeFeed(raw);
  assert.equal(feed.items.length, 1);
  assert.deepEqual([feed.items[0].text, feed.items[0].rumor, feed.items[0].status, feed.items[0].read], ['слух', true, 'new', false]);
  assert.deepEqual(normalizeFeed('строка'), { items: [], seen: {}, deals: [], cast: [], threads: [], molva: emptyMolva() });
});

test('лента: кольцо держит последние FEED_MAX, тот же id заменяется на месте', () => {
  const s = bare();
  for (let i = 0; i < FEED_MAX + 15; i += 1) addFeedItem(s, { id: `x${i}`, text: `запись ${i}` });
  assert.equal(s.feed.items.length, FEED_MAX);
  assert.equal(s.feed.items[0].id, 'x15', 'старые ушли первыми');
  addFeedItem(s, { id: 'x20', text: 'исправлено' });
  assert.equal(s.feed.items.length, FEED_MAX);
  assert.equal(s.feed.items.find((x) => x.id === 'x20').text, 'исправлено');
});

test('лента: реакции ответа кладутся идемпотентно, потолок, снятие по факту и по источнику', () => {
  const s = bare();
  const list = [
    { fact: 'clash=a:b', who: 'a', chan: 'chat', text: 'опять она' },
    { fact: 'clash=a:b', who: '', chan: 'anon', text: 'говорят, подставила' },
    { fact: 'skip=chem', who: 'b', chan: 'chat', text: 'а где Аня?', heroine: true },
  ];
  putReactions(s, 'm1', list, { day: '2026-10-05' });
  putReactions(s, 'm1', list, { day: '2026-10-05' });
  putReactions(s, 'm2', list.slice(0, 1));
  assert.equal(s.feed.items.length, 4, 'повторная укладка не удваивает');
  assert.equal(s.feed.items.find((x) => x.chan === 'anon').rumor, true, 'анонимка — слух');
  assert.equal(putReactions(bare(), 'm', list, { cap: 2 }).length, 2, 'потолок');
  assert.equal(dropByFact(s, 'm1', 'clash=a:b'), 2, 'факт уносит свои реакции');
  assert.equal(s.feed.items.filter((x) => x.src === 'm2').length, 1, 'чужой ответ не тронут');
  removeBySource(s, 'm1');
  assert.deepEqual(s.feed.items.map((x) => x.src), ['m2']);
});

test('лента: статусы, прочитано и мягкое знание героини', () => {
  const s = bare();
  addFeedItem(s, { id: 'mine', text: 'про неё', heroine: true });
  addFeedItem(s, { id: 'other', text: 'чужая стычка' });
  assert.equal(setStatus(s, 'mine', 'taken'), true);
  assert.equal(setStatus(s, 'mine', 'забыто'), false);
  assert.equal(s.feed.items[0].status, 'taken');
  assert.deepEqual(s.feed.items.map(knownToHeroine), [true, false], 'чужое — только прочитанное');
  assert.equal(markRead(s, 'other'), 1);
  assert.equal(knownToHeroine(s.feed.items[1]), true);
  assert.equal(markRead(s), 1, 'без списка — всё непрочитанное');
});

test('был в сцене: локальная отметка не затирает секретаря того же дня, откат к прежней', () => {
  const s = bare();
  assert.equal(markSeen(s, '@heroine', { day: 'd' }), null, 'героиня не «встречается»');
  markSeen(s, 'sokolova', { day: '2026-10-05', time: '10:00' });
  markSeen(s, 'sokolova', { day: '2026-10-05', time: '12:00' }, { local: true });
  assert.deepEqual(lastSeen(s, 'sokolova'), { day: '2026-10-05', time: '10:00' });
  const prev = markSeen(s, 'sokolova', { day: '2026-10-06' }, { local: true });
  assert.equal(lastSeen(s, 'sokolova').local, true);
  restoreSeen(s, 'sokolova', prev);
  assert.equal(lastSeen(s, 'sokolova').day, '2026-10-05');
  restoreSeen(s, 'sokolova', null);
  assert.equal(lastSeen(s, 'sokolova'), null);
});

test('дела: открыть без дублей, закрыть похожее, снять по квитанции', () => {
  const s = bare();
  const a = openDeal(s, { a: 'sokolova', b: '@heroine', what: 'конспект по химии', src: 'm1', day: 'd1' });
  assert.equal(a.created, true);
  assert.equal(openDeal(s, { a: '@heroine', b: 'sokolova', what: 'Конспект по химии' }).created, false, 'стороны в любом порядке');
  assert.equal(openDeals(s, 'sokolova').length, 1);
  const c = closeDeal(s, { a: 'sokolova', b: '@heroine', what: 'конспекты', day: 'd2' });
  assert.deepEqual([c.id, c.wasOpen], [a.id, true], 'закрыто то самое дело по общему слову');
  assert.equal(openDeals(s).length, 0);
  revertDeal(s, c);
  assert.equal(openDeals(s).length, 1, 'снятие закрытия открывает снова');
  const lone = closeDeal(s, { a: 'petrova', b: '@heroine', what: 'вернуть зонт', day: 'd2' });
  assert.equal(lone.created, true, 'закрытое без открытого — ложится закрытым');
  revertDeal(s, lone);
  assert.equal(s.feed.deals.length, 1);
});

test('потолок реакций: пресет или 6; громкость режет', () => {
  assert.equal(reactionCap({}), REACTION_CAP);
  assert.equal(REACTION_CAP, 6);
  assert.equal(reactionCap({ feed: { reactionCap: 3 } }), 3);
  assert.equal(reactionCap({ feed: { reactionCap: 'много' } }), 6);
  assert.equal(reactionCap({ feed: { reactionCap: 99 } }), 12);
  assert.deepEqual([0, 1, 2, 3].map((l) => loudCap(l, 6)), [1, 2, 3, 6]);
  assert.equal(loudCap(3, 4), 4);
  assert.equal(loudCap(0, 0), 0, 'потолок 0 — лента выключена');
});

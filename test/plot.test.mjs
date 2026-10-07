// «Взять в сюжет» (`core/plot`, шаг 4): очередь поводов, один за раз,
// снятие на реплике игрока, жизнь через свайп, истечение и «сыграно»,
// авто-режим с паузой и громкостью, «(без сплетен)», мягкая формулировка.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyPlot, normalizePlot, takeHook, dropHook, draftHook, hookCore, hookWording, hookPrompt, armedHook,
  onGeneration, onPlayerSent, onReply, expireHooks, secretaryHooks, knownHooks, playedRefs, autoPick,
  isMuted, quietScene, PLOT_EXPIRE, AUTO_PAUSE, AUTO_PAUSE_LOUD, QUEUE_MAX, holidayIn, unsaid,
} from '../core/plot.mjs';
import { addFeedItem, openDeal, feedItem, markPlayed } from '../core/feed.mjs';

const DAY = '2026-10-05';

function world() {
  const s = {
    calendar: { day: DAY },
    teachers: [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }],
    classmates: [{ id: 'sokolova', name: 'Вера Соколова' }, { id: 'orlova', name: 'Мила Орлова' }],
  };
  addFeedItem(s, {
    id: 'm1@a', src: 'm1', at: { day: DAY }, kind: 'fact', chan: 'chat', factRef: 'clash=sokolova:orlova',
    text: 'стычка: Вера Соколова и Мила Орлова — из-за конспекта', loud: 2,
  });
  addFeedItem(s, {
    id: 'm1#1', src: 'm1', at: { day: DAY }, kind: 'reaction', chan: 'chat', who: 'orlova',
    text: 'Пусть сама пишет свои конспекты', factRef: 'clash=sokolova:orlova', loud: 2,
  });
  addFeedItem(s, {
    id: 'm1#2', src: 'm1', at: { day: DAY }, kind: 'reaction', chan: 'anon', who: 'someone',
    text: 'Говорят, Вера всё подстроила', factRef: 'clash=sokolova:orlova', loud: 2,
  });
  openDeal(s, { a: 'sokolova', b: '@heroine', what: 'конспект', src: 'm1', day: DAY });
  return s;
}

/** Один круг таверны: генерация, (реплика), ответ. */
function turn(plot, { sent = true, muted = false, fresh = true } = {}) {
  let p = onGeneration(plot, { muted });
  if (sent) p = onPlayerSent(p, { muted }).plot;
  return onReply(p, { fresh });
}

test('формулировка: мягкая рамка, слух помечен, у факта — без «слух», без капса', () => {
  const s = world();
  const gossip = draftHook(s, 'm1#2');
  assert.equal(gossip.rumor, true);
  // «ходит слух: «Говорят, Вера…»» читалось дважды — «Говорят,» снимается.
  assert.match(gossip.text, /^Если уместно, можно вплести в сцену \(необязательная находка, не приказ\): ходит слух: «Вера всё подстроила»\./);
  assert.match(gossip.text, /Это слух — правда ли, неизвестно\./);
  // Пол героя в настройках не задан — слова нейтральные.
  assert.match(gossip.text, /слова и решения персонажа игрока оставь игроку/);
  assert.doesNotMatch(gossip.text, /героини/);
  assert.equal(unsaid('Говорят, что Вера всё подстроила'), 'Вера всё подстроила');
  assert.equal(unsaid('Вера всё подстроила'), 'Вера всё подстроила');
  // Реплика в чате про слух — обсуждение: «Это слух…» к ней не дописывается.
  addFeedItem(s, {
    id: 'm1#3', src: 'm1', at: { day: DAY }, kind: 'reaction', chan: 'chat', who: 'orlova',
    text: 'Это неправда!', factRef: 'rumor=sokolova:всё подстроила', rumor: true,
  });
  assert.doesNotMatch(draftHook(s, 'm1#3').text, /Это слух/);
  // Факт-слух — «говорят, что…» по сути, а не подписью.
  addFeedItem(s, {
    id: 'm1@r', src: 'm1', at: { day: DAY }, kind: 'fact', chan: 'chat', factRef: 'rumor=sokolova:всё подстроила',
    text: 'слух: Вера Соколова — всё подстроила', gist: 'Вера Соколова всё подстроила', rumor: true,
  });
  assert.match(draftHook(s, 'm1@r').core, /^говорят, что Вера Соколова всё подстроила$/);
  const fact = draftHook(s, 'm1@a');
  assert.equal(fact.rumor, false);
  assert.doesNotMatch(fact.text, /слух/i);
  assert.match(draftHook(s, 'm1#1').core, /^Мила Орлова говорит: «Пусть сама пишет свои конспекты»$/);
  const deal = openDeal(s, { a: 'sokolova', b: '@heroine', what: 'конспект' });
  // Без стрелок и двойных тире: кто кому должен — словами.
  const dealCore = draftHook(s, deal.id, { heroine: 'Аня' }).core;
  assert.equal(dealCore, 'незакрытое дело — Вера Соколова должна Ане: конспект');
  assert.doesNotMatch(dealCore, /→/);
  // «Кто-то с курса» — словом пресета.
  const school = { vocab: { someone: 'кто-то из класса' } };
  addFeedItem(s, { id: 'm1#4', src: 'm1', at: { day: DAY }, kind: 'reaction', chan: 'chat', who: 'someone', text: 'Ну и дела' });
  assert.match(draftHook(s, 'm1#4', { preset: school }).core, /^кто-то из класса говорит/);
  for (const t of [gossip.text, fact.text]) {
    assert.doesNotMatch(t, /MUST|EVERY|STRICTLY|ОБЯЗАТЕЛЬНО/);
  }
  assert.match(hookWording({ core: 'x', rumor: false }, { notAgain: 'прошлое' }), /Не повторяй: прошлое\./);
  assert.equal(hookCore(s, 'нет-такой'), null);
});

test('взять в сюжет: запись становится «взято», дубль и переполнение — отказ, правка формулировки сохраняется', () => {
  const s = world();
  const res = takeHook(emptyPlot(), s, { ref: 'm1#2', text: 'Моя формулировка.' });
  assert.equal(res.ok, true);
  assert.equal(feedItem(res.state, 'm1#2').status, 'taken');
  assert.equal(feedItem(s, 'm1#2').status, 'new', 'исходное состояние не тронуто');
  assert.equal(res.plot.queue[0].text, 'Моя формулировка.');
  assert.equal(takeHook(res.plot, res.state, { ref: 'm1#2' }).ok, false, 'тот же повод дважды');
  let p = emptyPlot();
  for (let i = 0; i < QUEUE_MAX; i += 1) {
    addFeedItem(s, { id: `x${i}`, at: { day: DAY }, text: `запись ${i}` });
    p = takeHook(p, s, { ref: `x${i}` }).plot;
  }
  addFeedItem(s, { id: 'lishnee', at: { day: DAY }, text: 'лишнее' });
  assert.equal(takeHook(p, s, { ref: 'lishnee' }).ok, false);
});

test('в промпт за раз — один повод; снятие на следующей реплике игрока, а не на ответе', () => {
  const s = world();
  let p = takeHook(emptyPlot(), s, { ref: 'm1#2' }).plot;
  p = takeHook(p, s, { ref: 'm1@a' }).plot;
  assert.equal(hookPrompt(p), '', 'до генерации ничего не взведено');

  // Ход 1: генерация → реплика → ответ.
  p = onGeneration(p);
  assert.equal(armedHook(p).ref, 'm1#2');
  p = onPlayerSent(p).plot;
  assert.equal(armedHook(p).ref, 'm1#2', 'реплика этого хода не снимает только что взведённый');
  p = onReply(p, { fresh: true });
  assert.equal(p.queue.filter((h) => h.armed).length, 1, 'взведён ровно один');
  assert.match(hookPrompt(p), /Вера всё подстроила/);

  // Свайп: генерация без реплики — тот же повод.
  p = onGeneration(p);
  assert.match(hookPrompt(p), /Вера всё подстроила/, 'свайп повод не тратит');
  p = onReply(p, { fresh: false });
  assert.equal(p.replies, 1, 'свайп не новый ответ');

  // Ход 2: реплика уносит отданный, взводится следующий.
  p = onGeneration(p);
  const sent = onPlayerSent(p);
  p = sent.plot;
  assert.deepEqual(sent.sent.map((h) => h.ref), ['m1#2']);
  assert.equal(armedHook(p).ref, 'm1@a');
  assert.deepEqual(p.log.map((e) => e.ref), ['m1#2']);
});

test('«(без сплетен)»: взведённый, но не отданный, снова ждёт; рубильник гасит слой', () => {
  assert.equal(isMuted('Аня молчит. (без сплетен)'), true);
  assert.equal(isMuted('(Без поводов)'), true);
  assert.equal(isMuted('без сплетен, пожалуйста'), false, 'только в скобках — команда');
  assert.equal(quietScene('Поцелуй.'), false, 'тихая сцена пока не определяется');
  const s = world();
  let p = takeHook(emptyPlot(), s, { ref: 'm1#2' }).plot;
  p = onGeneration(p);
  p = onPlayerSent(p, { muted: true }).plot;
  assert.equal(armedHook(p), null);
  assert.equal(p.queue.length, 1, 'повод не потерян');
  p = onGeneration(p, { enabled: false });
  assert.equal(armedHook(p), null, 'рубильник выключен — не взводится');
  p = onGeneration(p);
  assert.ok(armedHook(p));
});

test('истечение: отданный и не сыгранный через PLOT_EXPIRE ответов — «истекло»; вечного «взято» нет', () => {
  const s0 = world();
  const taken = takeHook(emptyPlot(), s0, { ref: 'm1#2' });
  let p = turn(taken.plot);
  let s = taken.state;
  p = onGeneration(p);
  p = onPlayerSent(p).plot; // ушёл в журнал
  for (let i = 0; i < PLOT_EXPIRE - 1; i += 1) {
    p = onReply(p, { fresh: true });
    const e = expireHooks(p, s);
    p = e.plot;
    s = e.state;
  }
  assert.equal(feedItem(s, 'm1#2').status, 'taken', 'ещё ждёт');
  assert.equal(secretaryHooks(p, s).length, 1, 'секретарь его видит');
  p = onReply(p, { fresh: true });
  const done = expireHooks(p, s);
  assert.deepEqual(done.expired, ['m1#2']);
  assert.equal(feedItem(done.state, 'm1#2').status, 'expired');
  assert.equal(secretaryHooks(done.plot, done.state).length, 0);

  // Взятая запись без очереди и журнала (повод снят руками после отдачи и забыт).
  const lone = world();
  lone.feed.items[0].status = 'taken';
  assert.deepEqual(expireHooks(emptyPlot(), lone).expired, ['m1@a']);
});

test('сыграно: секретарь отмечает по id повода; снятие разбора возвращает «взято»', () => {
  const taken = takeHook(emptyPlot(), world(), { ref: 'm1#2' });
  const p = turn(taken.plot);
  const hooks = secretaryHooks(p, taken.state);
  assert.deepEqual(hooks.map((h) => h.id), ['p1']);
  assert.match(hooks[0].text, /ходит слух/);
  assert.deepEqual(knownHooks(p).map((h) => h.id), ['p1']);
  const refs = playedRefs(p, ['p1', 'p9']);
  assert.deepEqual(refs, ['m1#2'], 'незнакомый id — мимо');
  const s = taken.state;
  markPlayed(s, 'm2', refs);
  assert.equal(feedItem(s, 'm1#2').status, 'played');
  assert.equal(feedItem(s, 'm1#2').playedSrc, 'm2');
  assert.equal(expireHooks(onReply(p, { fresh: true }), s).expired.length, 0, 'сыгранное не истекает');
  assert.equal(secretaryHooks(p, s).length, 0, 'сыгранное секретарю больше не показывается');
});

test('убрать: не отданный — запись снова ждёт; отданный — в журнал', () => {
  const s = world();
  const a = takeHook(emptyPlot(), s, { ref: 'm1#2' });
  const dropped = dropHook(a.plot, a.state, 'p1');
  assert.equal(dropped.plot.queue.length, 0);
  assert.equal(feedItem(dropped.state, 'm1#2').status, 'new');
  const b = takeHook(emptyPlot(), s, { ref: 'm1#2' });
  const delivered = turn(b.plot);
  const gone = dropHook(delivered, b.state, 'p1');
  assert.deepEqual(gone.plot.log.map((e) => e.id), ['p1']);
  assert.equal(feedItem(gone.state, 'm1#2').status, 'taken');
});

test('авто-режим: самое громкое не взятое, пауза, громкое — через два, «(без сплетен)» и очередь игрока важнее', () => {
  const s = world();
  addFeedItem(s, { id: 'quiet', at: { day: DAY }, text: 'тихая оценка', loud: 0 });
  assert.equal(autoPick(emptyPlot(), s, { enabled: false }).id, null, 'выключен по умолчанию');
  assert.equal(autoPick(emptyPlot(), s, { enabled: true, muted: true }).id, null);
  const own = takeHook(emptyPlot(), s, { ref: 'quiet' });
  assert.equal(autoPick(own.plot, own.state, { enabled: true }).id, null, 'игрок уже выбрал — авто молчит');

  const first = autoPick(emptyPlot(), s, { enabled: true });
  assert.ok(first.id);
  const ref = first.plot.queue[0].ref;
  assert.ok(['m1@a', 'm1#1', 'm1#2'].includes(ref), 'громкое, а не тихое');
  assert.equal(first.plot.queue[0].auto, true);
  assert.equal(armedHook(first.plot).ref, ref, 'взведён сразу');
  assert.equal(feedItem(first.state, ref).status, 'taken');

  // Отдан и снят; громкое — пауза AUTO_PAUSE_LOUD.
  let p = onReply(first.plot, { fresh: true });
  p = onPlayerSent(p).plot;
  let st = first.state;
  assert.equal(autoPick(p, st, { enabled: true }).id, null, 'пауза ещё не прошла');
  for (let i = 1; i < AUTO_PAUSE_LOUD; i += 1) p = onReply(p, { fresh: true });
  const second = autoPick(p, st, { enabled: true });
  assert.ok(second.id, 'после громкого — через два ответа');
  assert.match(second.plot.queue[0].text, /Не повторяй: /, 'прошлая формулировка — «не повторяй»');

  // Тихое — обычная пауза.
  const calm = { calendar: { day: DAY } };
  addFeedItem(calm, { id: 'q1', at: { day: DAY }, text: 'раз', loud: 1 });
  addFeedItem(calm, { id: 'q2', at: { day: DAY }, text: 'два', loud: 1 });
  let c = autoPick(emptyPlot(), calm, { enabled: true });
  st = c.state;
  p = onPlayerSent(onReply(c.plot, { fresh: true })).plot;
  for (let i = 1; i < AUTO_PAUSE - 1; i += 1) p = onReply(p, { fresh: true });
  assert.equal(autoPick(p, st, { enabled: true }).id, null, `до ${AUTO_PAUSE} ответов — пауза`);
  p = onReply(p, { fresh: true });
  c = autoPick(p, st, { enabled: true });
  assert.ok(c.id);

  // Старое (дальше двух игровых дней) и праздник — не поводы авто-режима.
  const old = { calendar: { day: DAY } };
  addFeedItem(old, { id: 'o', at: { day: '2026-09-20' }, text: 'давно' });
  addFeedItem(old, { id: 'e', at: { day: DAY }, factRef: 'event=+3:Бал', text: 'бал' });
  assert.equal(autoPick(emptyPlot(), old, { enabled: true }).id, null);
});

/**
 * Ходы с авто-режимом подряд — как в таверне: генерация, реплика игрока
 * (на ней авто подкидывает), ответ. Возвращает номера ответов, которые унесли
 * повод.
 */
function autoRun(state, turns, { yieldAt = new Set(), manualAt = new Map() } = {}) {
  let p = emptyPlot();
  let s = state;
  const carried = [];
  for (let n = 1; n <= turns; n += 1) {
    const yielded = yieldAt.has(n);
    if (manualAt.has(n)) {
      const own = takeHook(p, s, { ref: manualAt.get(n) });
      p = own.plot;
      s = own.state;
    }
    p = onGeneration(p, { yielded });
    p = onPlayerSent(p, { yielded }).plot;
    const picked = autoPick(p, s, { enabled: true, yielded });
    p = picked.plot;
    s = picked.state;
    const armed = armedHook(p);
    p = onReply(p, { fresh: true });
    if (armed && !armed.delivered) carried.push(n);
    s = expireHooks(p, s).state;
  }
  return { carried, plot: p, state: s };
}

/** Свежих записей с запасом — у авто-режима всегда есть из чего выбрать. */
function plenty(loud, n = 30) {
  const s = { calendar: { day: DAY } };
  for (let i = 0; i < n; i += 1) addFeedItem(s, { id: `r${i}`, src: `r${i}`, at: { day: DAY }, text: `запись ${i}`, loud });
  return s;
}

test('авто-режим: повод не чаще раза в 6 ответов, после громкого — 2 (живой прогон: 3 подряд, потом тишина)', () => {
  // Обычные события: между поводами — пять ответов без повода.
  const calm = autoRun(plenty(1), 20).carried;
  assert.deepEqual(calm, [1, 7, 13, 19]);
  for (let i = 1; i < calm.length; i += 1) assert.equal(calm[i] - calm[i - 1], AUTO_PAUSE);
  // Громкие: через ответ, но не подряд.
  const loud = autoRun(plenty(2), 9).carried;
  assert.deepEqual(loud, [1, 3, 5, 7, 9]);
  for (let i = 1; i < loud.length; i += 1) assert.equal(loud[i] - loud[i - 1], AUTO_PAUSE_LOUD);
  // Повод игрока тоже сдвигает паузу: раньше авто считало только свои, и
  // после ручных поводов подкидывало сразу — выходило «три хода подряд».
  const mixed = autoRun(plenty(1), 14, { manualAt: new Map([[3, 'r0']]) }).carried;
  assert.deepEqual(mixed, [1, 3, 9]);
  // Заглушённый ход не тратит паузу: авто подкидывает, как только можно.
  const quiet = autoRun(plenty(1), 9, { yieldAt: new Set([7]) }).carried;
  assert.deepEqual(quiet, [1, 8]);
});

test('Р5: в день повода праздника повод игрока глушится и ждёт следующего хода', () => {
  assert.equal(holidayIn([{ kind: 'holiday', text: 'Сегодня бал.' }]), true);
  assert.equal(holidayIn([{ kind: 'exam', text: 'x' }]), false);
  assert.equal(holidayIn(null), false);

  const s = world();
  let p = takeHook(emptyPlot(), s, { ref: 'm1#2' }).plot;
  // Ход с праздником: генерация и реплика уступают — в промпт ничего.
  p = onGeneration(p, { yielded: true });
  assert.equal(hookPrompt(p), '', 'в этот ход уходит только повод праздника');
  p = onPlayerSent(p, { yielded: true }).plot;
  assert.equal(armedHook(p), null);
  p = onReply(p, { fresh: true });
  assert.equal(p.queue.length, 1, 'повод игрока остался в очереди');
  assert.equal(p.queue[0].delivered, false, 'и не считается отданным');
  assert.equal(p.log.length, 0);
  assert.equal(autoPick(emptyPlot(), s, { enabled: true, yielded: true }).id, null, 'авто в такой ход молчит');
  // Уже взведённый к генерации тоже уступает, если праздник выяснился позже.
  let q = onGeneration(takeHook(emptyPlot(), s, { ref: 'm1#2' }).plot);
  q = onPlayerSent(q, { yielded: true }).plot;
  assert.equal(hookPrompt(q), '');
  // Следующий ход — без праздника: повод уходит.
  p = onGeneration(p);
  p = onPlayerSent(p).plot;
  assert.match(hookPrompt(p), /Вера всё подстроила/);
  p = onReply(p, { fresh: true });
  assert.equal(p.queue[0].delivered, true);
});

test('очередь нормализуется: битое выброшено, взведённый — один', () => {
  const p = normalizePlot({
    queue: [
      { id: 'p1', ref: 'a', text: 'раз', armed: true, delivered: true },
      { id: 'p2', ref: 'b', text: 'два', armed: true },
      { id: '', ref: 'c', text: 'x' },
      null,
    ],
    log: [{ id: 'p0', ref: 'z', deliveredAt: 3 }, 'мусор'],
    replies: 'много',
  });
  assert.deepEqual(p.queue.map((h) => [h.id, h.armed]), [['p1', true], ['p2', false]]);
  assert.equal(p.log.length, 1);
  assert.equal(p.replies, 0);
  assert.deepEqual(normalizePlot('строка'), emptyPlot());
});

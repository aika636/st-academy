// Шаги 3–4 «Молвы» и баги 60–67 живого прогона 10.10: секретарь не пишет посты
// (громкость и «наедине»), свидетель, «взять в сюжет» с происхождением, обрезка
// по слову, сюжетики после события, разнообразие выпуска, короткие ответы, подписи.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildAnalysisPrompt, parseAnalysis, privateRefs, isFactToken, isPrivateToken, factRef, tokenText, pruneReactions, tokenEvent,
} from '../core/analysis.mjs';
import { applySceneEvents } from '../core/scene.mjs';
import { addFeedItem, clipText, normalizeFeed, feedWorldTopics, FEED_TEXT_MAX } from '../core/feed.mjs';
import { setCast, rumorAuthors } from '../core/feed-cast.mjs';
import { startThread, openThreads, settleThreads, threadOver } from '../core/feed-threads.mjs';
import { buildAgenda, planIssue, buildMolvaPrompt, parseIssue, applyIssue, replayMolva, newFacts, REPLY_MIN } from '../core/molva.mjs';
import { hookCore, hookWording } from '../core/plot.mjs';
import { stopList } from '../core/stop-names.mjs';
import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { extraLabels } from '../ui.js';

const load = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));
const preset = load('ru-university');
const SUBJECTS = [{ id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' }];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }];
const COURSE = [{ id: 'sokolova', name: 'Вера Соколова', relation: 0, desire: '', problem: '' }];
const DAY = '2026-10-08';
const STOP = stopList({ user: 'Аня Кравцова', char: 'Мирон Князев', preset });
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

const lexicon = (s) => ({ ...preset, subjects: s.subjects, teachers: s.teachers, classmates: s.classmates, names: { user: 'Аня' } });

// --- шаг 3: секретарь не пишет посты ---------------------------------------------------

test('секретарь: «наедине» — токен с отпечатком факта, громкость остаётся и без реплик', () => {
  const s = semester();
  const answer = [
    '<!-- [ACADEMY met=sokolova clash=sokolova:@heroine:из-за конспекта] -->',
    'Слышно:', 'loud=2', 'private=2', 'Кратко: стычка.',
  ].join('\n');
  const res = parseAnalysis(answer, lexicon(s), { posts: false });
  const clash = res.tokens.find((t) => t.startsWith('clash='));
  assert.ok(res.tokens.includes(`private=${factRef(clash)}`));
  assert.ok(res.tokens.includes('loud=2'));
  assert.deepEqual(res.tokens.filter(isFactToken), ['met=sokolova', clash], 'пометки фактами не считаются');
  assert.equal(privateRefs(res.tokens).has(factRef(clash)), true);
  assert.equal(tokenText(`private=${factRef(clash)}`, lexicon(s)), 'наедине, без свидетелей');
  const bad = parseAnalysis('<!-- [ACADEMY met=sokolova] -->\nloud=1\nprivate=7', lexicon(s));
  assert.ok(bad.rejected.some((r) => /нет факта номер 7/.test(r.reason)));
});

test('секретарь: с posts:false строки react= и reply= не принимаются', () => {
  const s = semester();
  const answer = ['<!-- [ACADEMY clash=sokolova:@heroine:спор] -->', 'loud=2', 'react=1:~бес:chat:Первый пост', 'reply=1:~эхо:ответ первому'].join('\n');
  assert.equal(parseAnalysis(answer, lexicon(s), { posts: false }).tokens.some((t) => /^re(act|ply)=/.test(t)), false);
  assert.equal(parseAnalysis(answer, lexicon(s)).tokens.some((t) => /^react=/.test(t)), true, 'старые ответы читаются по-прежнему');
});

test('секретарь: вычеркнутый факт уносит свою пометку «наедине»', () => {
  const s = semester();
  const res = parseAnalysis('<!-- [ACADEMY clash=sokolova:@heroine:спор] -->\nloud=2\nprivate=1', lexicon(s), { posts: false });
  const left = pruneReactions(res.tokens.filter((t) => !t.startsWith('clash=')));
  assert.equal(left.some(isPrivateToken), false);
});

test('секретарь: в промпте только громкость и «наедине»; направление дела объяснено', () => {
  const s = semester();
  const { user } = buildAnalysisPrompt(s, preset, { reply: 'Сцена.', heroine: 'Аня' });
  assert.match(user, /Блок 2\. Слышно/);
  assert.match(user, /private=номера ключей блока 1/);
  assert.doesNotMatch(user, /Недавно в ленте|react=номер|reply=куда/);
  assert.match(user, /«Кто» — тот, кто должен или кому назначены отработка, наказание, штраф; «кому» — перед кем он должен/);
});

// --- шаг 4: свидетель ----------------------------------------------------------------------

test('свидетель: факт наедине ложится с пометкой и идёт в молву только слухом', () => {
  const s = semester();
  const res = parseAnalysis('<!-- [ACADEMY clash=sokolova:@heroine:спор] -->\nloud=2\nprivate=1', lexicon(s), { posts: false });
  const items = res.tokens.filter(isFactToken).map((token) => ({ token, ev: tokenEvent(token, lexicon(s)) }));
  const next = applySceneEvents(s, items, preset, { src: 'm', day: DAY, heroine: 'Аня', privateRefs: privateRefs(res.tokens) });
  const fact = next.feed.items.find((x) => x.kind === 'fact');
  assert.equal(fact.private, true);
  const facts = newFacts(next);
  assert.equal(facts.open.length, 0, 'публичной темы нет');
  assert.equal(facts.overheard.length, 1);
  const agenda = buildAgenda(next, preset, { stop: STOP, issue: 2, every: 3 });
  const slot = agenda.slots.find((x) => x.kind === 'rumor');
  assert.ok(slot && slot.author.kind === 'cast');
  assert.equal(agenda.slots.some((x) => x.kind === 'main'), false);
});

test('взять в сюжет по посту молвы: происхождение, слух, не установленный факт', () => {
  const s = semester();
  addFeedItem(s, { id: 'molva-1#1', src: 'molva-1', at: { day: DAY }, kind: 'reaction', nick: 'всёвидел', type: 'сплетник', text: 'Говорят, декан закроет буфет' });
  const c = hookCore(s, 'molva-1#1', { heroine: 'Аня', preset });
  assert.match(c.core, /^слух от @всёвидел \(сплетник\): «Говорят, декан закроет буфет»/);
  assert.match(c.core, /не установленный факт/);
  assert.equal(c.rumor, true);
  // Баг 78: ни «в ветке отвечают», ни второго «слух» в рамке.
  addFeedItem(s, { id: 'molva-1^1', src: 'molva-1', at: { day: DAY }, kind: 'reaction', nick: 'вечно второй', parent: 'molva-1#1', text: 'А кто сказал, что он вообще закроет?' });
  const again = hookCore(s, 'molva-1#1', { heroine: 'Аня', preset });
  assert.doesNotMatch(again.core, /в ветке/);
  const wording = hookWording(again, { preset });
  assert.equal((wording.match(/слух/giu) || []).length, 1, wording);
  assert.doesNotMatch(wording, /Это слух/);
});

// --- п. 60 ------------------------------------------------------------------------------

test('п. 60: длинный текст ленты режется по предложению или по слову, с «…»', () => {
  const words = 'очень длинная реплика про зимний бал и билеты '.repeat(8);
  const cut = clipText(words, FEED_TEXT_MAX);
  assert.ok(cut.length <= FEED_TEXT_MAX);
  assert.match(cut, /…$/);
  assert.equal(clipText('Коротко.', 50), 'Коротко.');
  const sentences = `${'Первое предложение довольно длинное и понятное. '.repeat(4)}Хвост который не влезет в предел, и он длинный и скучный и так далее и тому подобное.`;
  assert.match(clipText(sentences, 150), /\.$/);
  const s = semester();
  addFeedItem(s, { id: 'x1', src: 'x', at: { day: DAY }, kind: 'reaction', nick: 'всёвидел', text: words });
  const t = normalizeFeed(s.feed).items[0].text;
  assert.match(t, /…$/);
  assert.ok(t.length <= FEED_TEXT_MAX);
});

// --- п. 64 ------------------------------------------------------------------------------

test('п. 64: сюжетик события после даты подводит итог и закрывается; повестка не берёт прошедшее', () => {
  const s = semester('2026-10-12');
  startThread(s, { topic: 'Мабон', members: ['cast3', 'cast1'], dispute: 'спорят о костре', source: 'calendar', day: '2026-10-08', on: '2026-10-10' });
  startThread(s, { topic: 'зачёт по химии', members: ['cast2', 'cast4'], dispute: 'конспекты', source: 'study', day: '2026-10-08', on: '2026-10-20' });
  assert.equal(threadOver(openThreads(s)[0], '2026-10-12'), true);
  const id = openThreads(s)[0].id;
  const settled = settleThreads(s, '2026-10-12');
  assert.deepEqual(settled.settled, [id], 'два дня после — переведён на развязку');
  assert.equal(openThreads(s)[0].stage, 'развязка');
  const agenda = buildAgenda(s, preset, { stop: STOP, issue: 1, every: 3 });
  const crowd = agenda.slots.find((x) => x.kind === 'crowd');
  assert.equal(crowd.topic, 'Мабон');
  assert.equal(crowd.over, true);
  assert.match(crowd.stageHint, /событие уже прошло/);
  assert.equal(crowd.advance, true, 'следующий шаг закроет сюжетик');
  const late = settleThreads(s, '2026-10-14');
  assert.deepEqual(late.closed, [id]);
  assert.equal(openThreads(s).length, 1);
  s.events = [{ id: 'e1', name: 'Старый бал', from: '2026-10-01' }];
  assert.equal(buildAgenda(s, preset, { stop: STOP, issue: 2, every: 3 }).slots.some((x) => x.topic === 'Старый бал'), false);
});

test('п. 64: планирование выпуска убирает устаревший сюжетик сразу', () => {
  const s = semester('2026-10-20');
  startThread(s, { topic: 'Мабон', members: ['cast3', 'cast1'], dispute: 'x', source: 'calendar', day: '2026-10-08', on: '2026-10-10' });
  const { work } = planIssue(s, preset, { stop: STOP, every: 3 });
  assert.equal(openThreads(work).some((t) => t.topic === 'Мабон'), false);
});

// --- п. 65 ------------------------------------------------------------------------------

test('п. 65: тема прошлого выпуска не открывает следующий, если не сдвинулась', () => {
  let s = semester();
  startThread(s, { topic: 'бесплатный вход на бал', members: ['cast3', 'cast1'], dispute: 'x', source: 'calendar', day: DAY });
  startThread(s, { topic: 'зачёт по химии', members: ['cast2', 'cast4'], dispute: 'y', source: 'study', day: DAY });
  const first = planIssue(s, preset, { stop: STOP, every: 3 });
  const lead1 = first.agenda.slots[0];
  const lines = first.agenda.slots.map((sl) => `П${sl.n} | ${sl.author.name} | Реплика про тему номер ${sl.n}, довольно подробная.`).join('\n');
  const parsed = parseIssue(`${lines}\nКОНЕЦ`, first.agenda, { pool: rumorAuthors(first.work, { stop: STOP }), stop: STOP });
  const out = applyIssue(first.work, parsed, first.agenda, { stamp: 'a' });
  assert.equal(out.ok, true);
  s = replayMolva(s, [out.delta]);
  assert.equal(normalizeFeed(s.feed).molva.lead.topic, lead1.topic);
  const second = buildAgenda(s, preset, { stop: STOP, every: 3 });
  assert.notEqual(second.slots[0].topic, lead1.topic, 'открывает другая тема');
  assert.ok(normalizeFeed(s.feed).molva.topics.length >= 3, 'темы выпуска запомнены');
});

test('п. 65: «Мир» — бытовые темы пресета, запасные тоже; у всех двенадцати пресетов они есть', () => {
  const ids = readdirSync(fileURLToPath(new URL('../presets/', import.meta.url))).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));
  assert.equal(ids.length, 12);
  for (const id of ids) {
    const p = load(id);
    assert.ok(Array.isArray(p.feed.worldTopics) && p.feed.worldTopics.length >= 5, `${id}: feed.worldTopics`);
    assert.deepEqual(feedWorldTopics(p), p.feed.worldTopics);
  }
  assert.ok(feedWorldTopics({}).length >= 3, 'пресет без списка — общие бытовые темы');
  const s = semester();
  const world = buildAgenda(s, preset, { stop: STOP, every: 3 }).slots.find((x) => x.kind === 'world');
  assert.ok(feedWorldTopics(preset).includes(world.topic), 'в слоте мира — тема пресета');
});

test('п. 65: сюжетики заводятся и без календаря и учёбы; промпт просит разнообразия', () => {
  const s = semester();
  s.subjects = [];
  const { work, agenda } = planIssue(s, preset, { stop: STOP, every: 3 });
  assert.ok(openThreads(work).length >= 2);
  const { user } = buildMolvaPrompt(work, preset, agenda);
  assert.match(user, /«я… а ты…»/);
  assert.match(user, /Длина разная/);
});

// --- п. 66 ------------------------------------------------------------------------------

test('п. 66: в промпте у ответа назван пост-родитель и разногласие; короткий ответ отбрасывается', () => {
  const s = semester();
  startThread(s, { topic: 'бесплатный вход на бал', members: ['cast3', 'cast1'], dispute: 'крысаугол хочет вход для оргкомитета', source: 'calendar', day: DAY });
  const { work, agenda } = planIssue(s, preset, { stop: STOP, every: 3 });
  const { user } = buildMolvaPrompt(work, preset, agenda);
  assert.match(user, /по сути поста П\d/);
  assert.match(user, /Разногласие:/);
  const slot = agenda.slots.find((x) => x.replier && x.mode === 'post');
  const post = `П${slot.n} | ${slot.author.name} | Я считаю, что билеты на бал должны быть бесплатными для оргкомитета.`;
  const shortReply = `О${slot.n} | ${slot.replier.name} | Грубый выпад.`;
  const okReply = `О${slot.n} | ${slot.replier.name} | Бесплатными для оргкомитета? А кто тогда оплатит оркестр?`;
  const pool = rumorAuthors(work, { stop: STOP });
  const bad = parseIssue(`${post}\n${shortReply}\nКОНЕЦ`, { ...agenda, slots: [slot] }, { pool, stop: STOP });
  assert.ok(bad.rejected.some((r) => new RegExp(`короче ${REPLY_MIN}`).test(r.reason)));
  assert.equal(bad.lines.filter((l) => l.kind === 'reply').length, 0);
  const good = parseIssue(`${post}\n${okReply}\nКОНЕЦ`, { ...agenda, slots: [slot] }, { pool, stop: STOP });
  assert.equal(good.lines.filter((l) => l.kind === 'reply').length, 1);
});

// --- подписи ---------------------------------------------------------------------------

test('подписи: молва и настройки читаются без склеек', () => {
  const X = extraLabels(preset);
  assert.equal(X.molvaDoneSkipped, ' Часть реплик не прошла проверку и пропущена.');
  assert.doesNotMatch(X.molvaPrice, /раз в 1 ответ/);
  assert.match(X.molvaPrice, /Каждый ответ/);
  for (const k of ['feedHooksNote', 'feedBackgroundNote', 'feedAutoNote', 'feedMuteNote', 'molvaManualNote']) assert.ok(X[k], k);
  assert.equal(X.feedSettingsNote, undefined, 'длинный абзац разбит по галочкам');
});

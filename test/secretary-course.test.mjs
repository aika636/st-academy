// Секретарь видит курс (шаг 3): ключи met/clash/rumor/new/deal и rel по
// однокурснику, два блока ответа, реакции с привязкой к факту (отбрасываются
// кодом), вычёркивание, применение к состоянию, поправка и её снятие,
// встречи по имени без секретаря.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  buildAnalysisPrompt, parseAnalysis, effectiveText, tokenText, tokenEvent, dropTokenAt, reactionsOf,
  pruneReactions, isFactToken, loudOf,
} from '../core/analysis.mjs';
import { parseMarker } from '../core/parse-marker.mjs';
import { applyCorrection, revertCorrection } from '../core/corrections.mjs';
import { applySceneEvents, applyReactions, localMet, mentionedPeople, revertSceneSource } from '../core/scene.mjs';
import { lastSeen, openDeals } from '../core/feed.mjs';
import { applyResponse } from '../core/engine.mjs';
import { markerPeople, listCandidates } from '../core/classmates.mjs';
import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));

const SUBJECTS = [{ id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' }];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }];
const COURSE = [
  { id: 'sokolova', name: 'Вера Соколова', desire: 'попасть в тройку лучших', problem: 'долг по физике', relation: 0 },
  { id: 'petrova-s', name: 'Светлана Петрова', desire: 'удержать стипендию', relation: 0 },
];

function semester(day = '2026-10-05') {
  const s = createState(preset, {
    startDay: '2026-09-01', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
    classmates: COURSE,
  });
  s.started = true;
  s.calendar.day = day;
  // Фикстура не зависит от того, как нормализует курс шаг 2.
  if (!s.classmates || !s.classmates.length) s.classmates = COURSE.map((c) => ({ ...c }));
  return s;
}

const NAMES = { user: 'Аня', char: 'Мирон Князев' };
const lexicon = (s) => ({
  ...preset, subjects: s.subjects, teachers: markerPeople(s), classmates: s.classmates, survey: s.survey, names: NAMES,
});

// --- разбор ключей -------------------------------------------------------------------

test('метка: met/clash/rumor/new/deal словами модели, героиня по имени — @heroine', () => {
  const s = semester();
  const { events, rejected } = parseMarker([
    '<!-- [ACADEMY met=sokolova, Светлана Петрова clash=Соколова:Аня:из-за [конспекта] стычка=sokolova:sokolova',
    'rumor=героиня:встречается с преподом new=Глеб Орлов new=Мирон Князев new=Вера Соколова new=Петрова Анна Сергеевна',
    'deal=sokolova:@heroine:конспект deal-=sokolova:@heroine:конспект дело=petrova-s:Аня:зонт:вернула deal=x:y:что-то] -->',
  ].join(' '), lexicon(s));
  assert.deepEqual(events.map((e) => e.kind), ['met', 'met', 'clash', 'rumor', 'new', 'met', 'deal', 'deal', 'deal']);
  assert.deepEqual(events[2], { kind: 'clash', a: 'sokolova', b: '@heroine', reason: 'из-за конспекта' });
  assert.equal(events[3].about, '@heroine');
  assert.equal(events[4].name, 'Глеб Орлов');
  assert.equal(events[5].personId, 'sokolova', 'знакомое имя в new= — просто «был в сцене»');
  assert.deepEqual(events.slice(6).map((e) => e.closed), [false, true, true]);
  const why = rejected.map((r) => r.reason).join(' | ');
  assert.match(why, /один человек/);
  assert.match(why, /карточка/, 'бот — не кандидат');
  assert.match(why, /уже есть среди людей/, 'преподаватель — не новое имя');
  assert.match(why, /неизвестный человек/);
});

test('метка: rel= по id и имени однокурсника; героиня в rel — стоп-лист', () => {
  const s = semester();
  const { events, rejected } = parseMarker('<!-- [ACADEMY rel=sokolova:minor-:увидела мою пятёрку rel=Светлана Петрова:major+ rel=Аня:minor+] -->', lexicon(s));
  assert.deepEqual(events.map((e) => [e.teacherId, e.delta]), [['sokolova', -1], ['petrova-s', 2]]);
  assert.equal(rejected.length, 1);
});

// --- два блока, реакции ---------------------------------------------------------------

const ANSWER = [
  '<!-- [ACADEMY skip=chemistry met=sokolova clash=sokolova:petrova-s:из-за конспекта mood=злость] -->',
  'Что сочинено:',
  'loud=2',
  'react=3:petrova-s:chat:Ну и пусть сама теперь пишет конспекты',
  'react=3:кто-то:anon:Говорят, Соколова специально её подставила',
  'react=1:someone:chat:А где Аня была на химии?',
  'react=4:sokolova:chat:опора на выдуманный ключ',
  'react=9:sokolova:chat:нет такого факта',
  'react=2:Аня:chat:героиня не реагирует',
  'react=3:someone:chat:«Ну и пусть сама теперь пишет конспекты!»',
  'Кратко: Аня прогуляла химию, Соколова поссорилась с Петровой.',
].join('\n');

test('секретарь: факты и реакции; реакция без валидного факта отброшена кодом', () => {
  const s = semester();
  const res = parseAnalysis(ANSWER, lexicon(s));
  assert.equal(res.found, true);
  assert.deepEqual(res.tokens.filter(isFactToken), ['skip=chemistry', 'met=sokolova', 'clash=sokolova:petrova-s:из-за конспекта']);
  const reactions = reactionsOf(res.tokens);
  assert.deepEqual(reactions.map((r) => [r.fact, r.who, r.chan]), [
    ['clash=sokolova:petrova-s:из-за конспекта', 'petrova-s', 'chat'],
    ['clash=sokolova:petrova-s:из-за конспекта', 'someone', 'anon'],
    ['skip=chemistry', 'someone', 'chat'],
  ]);
  assert.equal(loudOf(res.tokens), 2);
  const why = res.rejected.map((r) => r.reason).join(' | ');
  assert.match(why, /номер 4 не записан/, 'выдуманный ключ считается в номер, но опорой не служит');
  assert.match(why, /нет факта номер 9/);
  assert.match(why, /героиня — не реакция/);
  assert.match(why, /повтор/);
  assert.match(res.summary, /прогуляла химию/);
});

test('секретарь: потолок по громкости и пресету; пустой блок «сочинено» — норма', () => {
  const s = semester();
  const many = ['<!-- [ACADEMY grade=chemistry:5] -->', 'loud=0',
    ...[1, 2, 3].map((n) => `react=1:someone:chat:реплика номер ${n}`)].join('\n');
  const quiet = parseAnalysis(many, lexicon(s));
  assert.equal(reactionsOf(quiet.tokens).length, 1, 'обычная оценка — тихо, одна реакция');
  const scandal = parseAnalysis(many.replace('loud=0', 'loud=3'), { ...lexicon(s), feed: { reactionCap: 2 } });
  assert.equal(reactionsOf(scandal.tokens).length, 2, 'потолок пресета');
  const empty = parseAnalysis('<!-- [ACADEMY grade=chemistry:5] -->\nЧто сочинено:\nКратко: пятёрка.', lexicon(s));
  assert.deepEqual(empty.tokens, ['grade=chemistry:5'], 'без реакций нет и громкости');
});

test('секретарь: лимиты курса на один ответ', () => {
  const s = semester();
  const res = parseAnalysis(`<!-- [ACADEMY ${['А', 'Б', 'В', 'Г'].map((x) => `new=Глеб ${x}ов`).join(' ')}] -->`, lexicon(s));
  assert.equal(res.tokens.length, 3);
  assert.ok(res.rejected.some((r) => /больше 3/.test(r.reason)));
});

test('черновик: вычеркнутый факт уносит свои реакции, громкость — с последней', () => {
  const s = semester();
  const { tokens } = parseAnalysis(ANSWER, lexicon(s));
  const clash = tokens.indexOf('clash=sokolova:petrova-s:из-за конспекта');
  const left = dropTokenAt(tokens, clash);
  assert.deepEqual(reactionsOf(left).map((r) => r.fact), ['skip=chemistry']);
  const bare = dropTokenAt(left, left.indexOf('skip=chemistry'));
  assert.ok(!bare.some((t) => !isFactToken(t)), 'реакций нет — громкость ушла');
  const oneReaction = tokens.findIndex((t) => t.startsWith('react='));
  assert.equal(reactionsOf(dropTokenAt(tokens, oneReaction)).length, 2, 'реакцию можно вычеркнуть отдельно');
  assert.deepEqual(pruneReactions(tokens), tokens);
});

test('слова плашки: факты курса и реакции — живым русским, без ключей', () => {
  const s = semester();
  const lex = lexicon(s);
  const say = (t) => tokenText(t, lex);
  assert.equal(say('met=sokolova'), 'в сцене: Вера Соколова');
  assert.equal(say('clash=sokolova:@heroine:из-за конспекта'), 'стычка: Вера Соколова и Аня — из-за конспекта');
  // Без падежа: «слух о Аня» хуже, чем «слух: Аня — …».
  assert.equal(say('rumor=@heroine:встречается с преподом'), 'слух: Аня — встречается с преподом');
  assert.equal(say('rumor=sokolova:списала контрольную'), 'слух: Вера Соколова — списала контрольную');
  assert.equal(say('new=Глеб Орлов'), 'новое лицо: Глеб Орлов');
  // Дело — кто кому должен, словами, без стрелок.
  assert.equal(say('deal=sokolova:@heroine:конспект'), 'Вера Соколова должна Ане: конспект');
  assert.equal(say('deal-=sokolova:@heroine:конспект'), 'закрыто: Вера Соколова и Аня — конспект');
  assert.equal(say('rel=sokolova:minor-:увидела пятёрку'), 'Вера Соколова: холоднее (немного) — увидела пятёрку');
  const { tokens } = parseAnalysis(ANSWER, lex);
  const words = tokens.filter((t) => !isFactToken(t)).map(say);
  assert.deepEqual(words, [
    'Светлана Петрова: «Ну и пусть сама теперь пишет конспекты»',
    'без подписи: «Говорят, Соколова специально её подставила»',
    'кто-то с курса: «А где Аня была на химии?»',
    'шумно',
  ]);
  for (const w of words) assert.ok(!/react=|loud=|@heroine/.test(w));
});

test('промпт: курс списком, два блока, мягкие слова без капса', () => {
  const s = semester();
  const { system, user } = buildAnalysisPrompt(s, preset, { reply: 'Соколова ругается с Петровой.', heroine: 'Аня' });
  assert.match(user, /Курс героини \(id — имя — о человеке\):\n- sokolova — Вера Соколова — хочет попасть в тройку лучших; долг по физике/);
  assert.match(user, /Блок 1\. Что было/);
  assert.match(user, /Блок 2\. Что сочинено/);
  assert.match(user, /react=номер факта:кто:chat\|anon:/);
  assert.match(user, /Пустой блок «Что сочинено» — нормально/);
  assert.match(user, /Не выдумывай событий, которых не было в сцене, — только реакции на них/);
  assert.match(user, /а не новое событие/);
  assert.match(user, /до 6/, 'потолок пресета по умолчанию');
  assert.match(system, /двумя блоками/);
  assert.doesNotMatch(user + system, /\b(EVERY|MUST|STRICTLY|CRITICAL|ОБЯЗАТЕЛЬНО)\b/);
  const none = buildAnalysisPrompt({ ...s, classmates: [] }, preset, { reply: '…' });
  assert.match(none.user, /Курс героини[^\n]*\n- пока никого/);
});

test('движок: реакции и громкость в метку движку не едут', () => {
  const { tokens } = parseAnalysis(ANSWER, lexicon(semester()));
  const text = effectiveText('Сцена.', tokens);
  assert.ok(!/react=|loud=/.test(text));
  assert.match(text, /clash=sokolova:petrova-s/);
});

test('движок: rel= однокурсника из разбора двигает его отношение', () => {
  const s = semester();
  const run = applyResponse(s, effectiveText('Сцена.', ['rel=sokolova:minor-:увидела пятёрку']), preset, { names: NAMES });
  assert.equal(run.state.classmates.find((c) => c.id === 'sokolova').relation, -1);
});

// --- применение к состоянию -------------------------------------------------------------

function applyAll(s, raw) {
  const lex = lexicon(s);
  const { tokens } = parseAnalysis(raw, lex);
  const items = tokens.filter(isFactToken).map((token) => ({ token, ev: tokenEvent(token, lex) }));
  let next = applySceneEvents(s, items, preset, { src: 'm1', day: s.calendar.day, stop: NAMES });
  next = applyReactions(next, 'm1', reactionsOf(tokens), new Map(items.map((x) => [x.token, x.ev])), { day: s.calendar.day });
  return { next, tokens };
}

test('применение: met, clash, rumor, new, deal ложатся; реакции — в ленту при своих фактах', () => {
  const s = semester();
  const { next } = applyAll(s, [
    '<!-- [ACADEMY met=sokolova clash=sokolova:@heroine:из-за конспекта rumor=@heroine:встречается с преподом new=Глеб Орлов deal=sokolova:@heroine:конспект] -->',
    'loud=3',
    'react=2:petrova-s:chat:Опять Вера скандалит',
    'react=3:someone:anon:А я слышала, что это правда',
  ].join('\n'));
  assert.equal(lastSeen(next, 'sokolova').day, '2026-10-05');
  const facts = next.feed.items.filter((x) => x.kind === 'fact');
  assert.deepEqual(facts.map((x) => [x.text, x.rumor, x.heroine]), [
    ['стычка: Вера Соколова и героиня — из-за конспекта', false, true],
    ['слух: героиня — встречается с преподом', true, true],
  ]);
  const reactions = next.feed.items.filter((x) => x.kind === 'reaction');
  assert.deepEqual(reactions.map((x) => [x.who, x.chan, x.rumor, x.truth, x.status, x.read]), [
    ['petrova-s', 'chat', false, null, 'new', false],
    ['someone', 'anon', true, null, 'new', false],
  ]);
  assert.ok(reactions.every((x) => x.factRef && x.src === 'm1'));
  assert.deepEqual(listCandidates(next).map((c) => [c.name, c.source]), [['Глеб Орлов', 'scene']]);
  assert.deepEqual(openDeals(next, 'sokolova').map((d) => d.what), ['конспект']);
  assert.equal(s.feed, undefined, 'исходное состояние не тронуто');
  // Закрытие тем же ключом с минусом.
  const closed = applyAll(next, '<!-- [ACADEMY deal-=sokolova:@heroine:конспект] -->').next;
  assert.equal(openDeals(closed).length, 0);
  // Снятие всего от ответа.
  const undone = revertSceneSource(next, 'm1', ['Глеб Орлов']);
  assert.equal(undone.feed.items.length, 0);
  assert.equal(undone.feed.deals.length, 0);
  assert.equal(listCandidates(undone).length, 0);
});

test('поправка к старому ответу: факт курса с квитанцией, снятие возвращает как было', () => {
  const s = semester();
  const lex = lexicon(s);
  let state = s;
  const receipts = [];
  for (const token of ['met=sokolova', 'clash=sokolova:petrova-s', 'new=Глеб Орлов', 'deal=petrova-s:@heroine:зонт']) {
    const out = applyCorrection(state, tokenEvent(token, lex), preset, { day: '2026-10-01', src: 'old', token, stop: NAMES });
    assert.ok(out.receipt, token);
    state = out.state;
    receipts.push(out.receipt);
  }
  assert.equal(lastSeen(state, 'sokolova').day, '2026-10-01', 'датой того ответа');
  assert.equal(state.feed.items.length, 1);
  assert.equal(listCandidates(state).length, 1);
  for (const r of receipts.reverse()) state = revertCorrection(state, r, preset);
  assert.equal(lastSeen(state, 'sokolova'), null);
  assert.equal(state.feed.items.length, 0);
  assert.equal(state.feed.deals.length, 0);
  assert.equal(listCandidates(state).length, 0);
  const rel = applyCorrection(s, tokenEvent('rel=sokolova:major+', lex), preset, { day: '2026-10-01' });
  assert.equal(rel.state.classmates.find((c) => c.id === 'sokolova').relation, 2, 'rel поправкой — и однокурснику');
  assert.equal(revertCorrection(rel.state, rel.receipt, preset).classmates.find((c) => c.id === 'sokolova').relation, 0);
});

// --- встречи по имени без секретаря ------------------------------------------------------

test('встречи по имени: падежи, целое слово, заглавная, общая часть имени не считается', () => {
  const people = [
    { id: 'sokolova', name: 'Вера Соколова' },
    { id: 'gleb', name: 'Глеб Орлов' },
    { id: 'petrova-s', name: 'Светлана Петрова' },
    { id: 'petrova-a', name: 'Алина Петрова' },
  ];
  const hit = (text, stop) => mentionedPeople(text, people, stop);
  assert.deepEqual(hit('Я встретила Соколову у входа.'), ['sokolova']);
  assert.deepEqual(hit('С Глебом мы не говорили, Орлова я не видела.'), ['gleb']);
  assert.deepEqual(hit('Вера Соколова кивнула.'), ['sokolova']);
  assert.deepEqual(hit('Соколовская улица, соколова не было.'), [], 'не целое слово и строчная');
  assert.deepEqual(hit('Петрова опять опоздала.'), [], 'две Петровы — фамилия ничья');
  assert.deepEqual(hit('Светлана Петрова пришла.'), ['petrova-s']);
  assert.deepEqual(hit('Вере надо верить.'), ['sokolova']);
  assert.deepEqual(hit('надо верить в себя'), []);
  assert.deepEqual(hit('Вера кивнула.', { user: 'Вера Иванова' }), [], 'имя героини — не однокурсница');
});

test('встречи по имени: локальная отметка в ленте, без имени — состояние то же', () => {
  const s = semester();
  const same = localMet(s, 'Пустой коридор.');
  assert.equal(same.state, s);
  const { state, met } = localMet(s, 'Соколова помахала мне.', { stop: NAMES });
  assert.deepEqual(met, ['sokolova']);
  assert.equal(lastSeen(state, 'sokolova').local, true);
});

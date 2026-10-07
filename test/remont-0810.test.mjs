// test/remont-0810 — починка после второго живого прогона (8 октября):
// однокурсники, секретарь, лента и «Взять в сюжет». Поводы (Р5, авто-режим)
// и лорбук слуха — в `plot.test.mjs` и `feed-flow.test.mjs`; здесь то, что
// сквозь них не видно: мягкое сопоставление людей секретаря, «Не разобрано»,
// состав вне времени хода, дело словами, ключи лорбука, имя чат-лорбука,
// здоровье неполного состояния и свои слова пресетов.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseMarker } from '../core/parse-marker.mjs';
import { parseAnalysis, unparsedNames, tokenText, reactionsOf, isFactToken, tokenEvent, someoneWord } from '../core/analysis.mjs';
import { carryRoster } from '../core/classmates.mjs';
import {
  dealText, dativeName, genderOfName, sceneText, sceneGist, applySceneEvents, applyReactions, GONE_PERSON,
} from '../core/scene.mjs';
import { nameKeys } from '../core/lorebook.mjs';
import { bookName } from '../lorebook.js';
import { stateHealth, feedVisible, PRESET_UI_WORDS, uiLabels, extraLabels, feedView } from '../ui.js';
import { sectionLabel, SECTIONS, unparsedText, PANEL_TEXT } from '../mes-panel.js';
import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';

const load = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));
const preset = load('ru-university');
const PRESET_IDS = [
  'ru-university', 'ru-school', 'jp-highschool', 'magic-academy', 'us-college', 'us-highschool',
  'dark-academia', 'cadet-academy', 'space-academy', 'hero-academy', 'xianxia-sect', 'cn-highschool',
];

const COURSE = [
  { id: 'vera-sokolova', name: 'Вера Соколова', relation: 0 },
  { id: 'mila', name: 'Мила Орлова', relation: 0 },
];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }];

function lexicon(classmates = COURSE) {
  return { ...preset, subjects: [], teachers: TEACHERS, classmates, names: { user: 'Аня' } };
}

// --- В: мягкое сопоставление и «Не разобрано» -----------------------------------------

test('В: секретарь пишет id как придётся — sokolova, «Соколовой», «В. Соколова» находят vera-sokolova', () => {
  const lex = lexicon();
  const r = parseMarker('<!-- [ACADEMY met=sokolova clash=orlova:@heroine:тетрадь deal=Соколовой:Мила:вернуть тетрадь] -->', lex);
  assert.deepEqual(r.rejected, []);
  assert.deepEqual(r.events.map((e) => e.kind), ['met', 'clash', 'deal']);
  assert.equal(r.events[0].personId, 'vera-sokolova');
  assert.equal(r.events[1].a, 'mila', 'латиница фамилии — по имени');
  assert.deepEqual([r.events[2].a, r.events[2].b], ['vera-sokolova', 'mila'], 'падеж и имя без фамилии');
  assert.equal(parseMarker('<!-- [ACADEMY met=В. Соколова] -->', lex).events[0].personId, 'vera-sokolova');
  // Двусмысленное — по-прежнему никто.
  const twins = lexicon([...COURSE, { id: 'vera-belova', name: 'Вера Белова', relation: 0 }]);
  const amb = parseMarker('<!-- [ACADEMY met=vera] -->', twins);
  assert.equal(amb.events.length, 0);
  assert.match(amb.rejected[0].reason, /неизвестный человек/);
});

test('В: автор реакции сопоставляется мягко — «кто-то с курса» реже; незнакомое — строкой «Не разобрано»', () => {
  const lex = lexicon();
  const parsed = parseAnalysis([
    '<!-- [ACADEMY met=sokolova met=glebov clash=petrov:@heroine:спор] -->',
    'Что сочинено:',
    'loud=2',
    'react=1:Соколова:chat:Ну и денёк',
    'react=1:Незнакомец:chat:А кто это?',
    'Кратко: x',
  ].join('\n'), lex);
  const reactions = reactionsOf(parsed.tokens);
  assert.equal(reactions[0].who, 'vera-sokolova', 'автор узнан по фамилии');
  assert.equal(reactions[1].who, 'someone', 'незнакомое имя автора — «кто-то с курса»');
  assert.equal(tokenText(parsed.tokens.find((t) => t.includes('А кто это')), lex), 'кто-то с курса: «А кто это?»');
  const names = unparsedNames(parsed.rejected);
  assert.deepEqual(names, ['glebov', 'petrov']);
  assert.equal(unparsedText(names), 'Не разобрано: «glebov», «petrov» — таких людей нет в списках. Добавьте человека или поправьте имя и разберите заново.');
  assert.equal(unparsedText([]), '');
  assert.deepEqual(unparsedNames([{ raw: 'x', reason: 'пустое значение' }]), []);
});

test('В: человек, добавленный руками после ответа, переживает пересчёт и виден разбору заново', () => {
  const before = { classmates: [{ id: 'mila', name: 'Мила Орлова', relation: -1 }], feed: { items: [] } };
  const live = {
    classmates: [
      { id: 'mila', name: 'Мила Орлова', relation: 2, desire: 'удержать стипендию' },
      { id: 'gleb', name: 'Глеб Морозов', relation: 0 },
    ],
  };
  const carried = carryRoster(live, before);
  assert.notEqual(carried, before, 'снимок не правится на месте');
  assert.deepEqual(carried.classmates.map((c) => c.id), ['mila', 'gleb']);
  assert.equal(carried.classmates[0].relation, -1, 'отношение — из снимка: его двигает сам ответ');
  assert.equal(carried.classmates[0].desire, 'удержать стипендию', 'слова о человеке — нынешние');
  assert.equal(carried.feed, before.feed, 'остальное снимка не тронуто');
  // Убранный руками не воскресает при откате.
  assert.deepEqual(carryRoster({ classmates: [] }, before).classmates, []);
  // Менять нечего — тот же снимок.
  assert.equal(carryRoster({ classmates: [{ id: 'mila', name: 'Мила Орлова', relation: 5 }] }, before), before);
  assert.equal(carryRoster(null, before), before);
});

// --- Г, подписи: слова ленты и плашки ------------------------------------------------

test('дело словами: «Мила должна Вере: вернуть тетрадь», без стрелок; удалённая сторона — словами', () => {
  const people = [{ id: 'mila', name: 'Мила Орлова' }, { id: 'vera', name: 'Вера Соколова' }, { id: 'gleb', name: 'Глеб Морозов' }];
  const deal = (a, b, closed = false) => dealText({ kind: 'deal', a, b, what: 'вернуть тетрадь', closed }, people, 'Аня');
  assert.equal(deal('mila', 'vera'), 'Мила Орлова должна Вере: вернуть тетрадь');
  assert.equal(deal('gleb', '@heroine'), 'Глеб Морозов должен Ане: вернуть тетрадь');
  assert.equal(deal('mila', 'gone'), `Мила Орлова должна ${GONE_PERSON.dat}: вернуть тетрадь`);
  assert.equal(deal('gone', 'vera'), 'Тот, кого уже нет в списке, должен Вере: вернуть тетрадь');
  assert.equal(deal('mila', 'vera', true), 'закрыто: Мила Орлова и Вера Соколова — вернуть тетрадь');
  for (const t of [deal('mila', 'vera'), deal('mila', 'vera', true)]) {
    assert.doesNotMatch(t, /→|кто-то с потока/);
    assert.ok((t.match(/ — /g) || []).length <= 1, 'без двойных тире');
  }
  // Склонять не берёмся — без направления, но и без ошибки.
  assert.equal(dealText({ kind: 'deal', a: 'mila', b: 'igor', what: 'конспект' }, [...people, { id: 'igor', name: 'Игорь' }]), 'Мила Орлова и Игорь: конспект');
  assert.equal(dativeName('Мария'), 'Марии');
  assert.equal(dativeName('Марина'), 'Марине', 'имя на -ина — не фамилия');
  assert.equal(dativeName('Соколова'), 'Соколовой');
  assert.equal(dativeName('Лев'), 'Льву');
  assert.equal(dativeName('Юки'), 'Юки', 'несклоняемое — как есть');
  assert.equal(genderOfName('Никита'), 'm');
  assert.equal(genderOfName('Саша'), null);
});

test('слух и стычка словами: без «слух о Вера Соколова»; суть — после «говорят, что…»', () => {
  const people = [{ id: 'vera', name: 'Вера Соколова' }, { id: 'mila', name: 'Мила Орлова' }];
  const rumor = { kind: 'rumor', about: 'vera', text: 'списала контрольную' };
  assert.equal(sceneText(rumor, people), 'слух: Вера Соколова — списала контрольную');
  assert.equal(sceneGist(rumor, people), 'Вера Соколова списала контрольную');
  const clash = { kind: 'clash', a: 'vera', b: 'mila', reason: 'из-за тетради' };
  assert.equal(sceneGist(clash, people), 'Вера Соколова и Мила Орлова поссорились (из-за тетради)');
  assert.equal(sceneGist({ kind: 'met', personId: 'vera' }, people), '');
});

test('реакция в чате про слух — «обсуждают», а не «слух»; слух — у анонимки и факта-слуха', () => {
  const s = createState(preset, { startDay: '2026-09-01', subjects: [], teachers: TEACHERS, classmates: COURSE });
  s.started = true;
  s.calendar.day = '2026-10-07';
  const lex = lexicon(s.classmates);
  const { tokens } = parseAnalysis([
    '<!-- [ACADEMY rumor=sokolova:списала контрольную] -->',
    'Что сочинено:', 'loud=2',
    'react=1:mila:chat:Это неправда!',
    'react=1:someone:anon:Ещё и шпаргалку прятала',
    'Кратко: x',
  ].join('\n'), lex);
  const items = tokens.filter(isFactToken).map((token) => ({ token, ev: tokenEvent(token, lex) }));
  let next = applySceneEvents(s, items, preset, { src: 'm', day: s.calendar.day, heroine: 'Аня' });
  next = applyReactions(next, 'm', reactionsOf(tokens), new Map(items.map((x) => [x.token, x.ev])), { day: s.calendar.day });
  const fact = next.feed.items.find((x) => x.kind === 'fact');
  assert.equal(fact.text, 'слух: Вера Соколова — списала контрольную');
  assert.equal(fact.gist, 'Вера Соколова списала контрольную');
  assert.equal(fact.rumor, true);
  const [talk, anon] = next.feed.items.filter((x) => x.kind === 'reaction');
  assert.equal(talk.rumor, false, 'опровержение в чате — обсуждение');
  assert.equal(anon.rumor, true);
  const v = feedView(next, preset, { chan: 'chat' });
  const tags = Object.fromEntries(v.items.map((i) => [i.text, i.tag]));
  assert.equal(tags['Это неправда!'], 'обсуждают');
  assert.equal(tags['слух: Вера Соколова — списала контрольную'], '', 'у факта-слуха «слух» уже в тексте — второй пометки нет');
});

test('плашка: громкость без слова «громкость»; разделы — словами заведения', () => {
  const lex = lexicon();
  assert.equal(tokenText('loud=2', lex), 'шумно');
  assert.equal(tokenText('loud=3', lex), 'скандал');
  assert.equal(tokenText('loud=0', lex), 'почти не заметили');
  assert.equal(PANEL_TEXT.talkNone, 'никто не обсуждает');
  assert.doesNotMatch(PANEL_TEXT.talkHint, /в Академии|в ленту/);
  const rel = SECTIONS.find((s) => s.kind === 'rel');
  const course = SECTIONS.find((s) => s.kind === 'course');
  const school = uiLabels(load('ru-school'));
  assert.equal(sectionLabel(rel, { rel: school.mesRelSection }), 'Отношение учителей');
  assert.equal(sectionLabel(course, { course: school.classmatesTitle }), 'Класс: кто был, стычки, слухи, дела');
  assert.equal(sectionLabel(rel), 'Отношение преподавателей', 'без слов хоста — умолчание вуза');
});

// --- Р6: свои слова у каждого из двенадцати --------------------------------------------

test('Р6: у всех двенадцати свои слова фона, «кто-то с курса», раздела плашки', () => {
  for (const id of PRESET_IDS) {
    const p = load(id);
    for (const k of PRESET_UI_WORDS) assert.ok(typeof p.ui[k] === 'string' && p.ui[k].trim(), `${id}: ui.${k}`);
    assert.ok(p.vocab.crowdIn && p.vocab.someone, `${id}: vocab.crowdIn / vocab.someone`);
    assert.doesNotMatch(p.ui.classmatesNone, /позже секретарь/, `${id}: секретарь уже предлагает`);
    assert.match(p.ui.classmatesNone, /секретарь предложит, кого заметит в сцене/);
    assert.equal(extraLabels(p).feedSomeone, p.vocab.someone, `${id}: «кто-то с курса» — одно слово`);
    assert.equal(someoneWord(p), p.vocab.someone);
  }
  assert.equal(load('ru-school').vocab.crowdIn, 'в классе');
  assert.equal(load('cadet-academy').vocab.someone, 'кто-то из взвода');
  assert.equal(load('ru-school').ui.mesRelSection, 'Отношение учителей');
  assert.match(load('ru-school').ui.lorebookNote, /одноклассников/, 'лорбук упоминает людей класса');
});

// --- З: ключи лорбука и имя чат-лорбука ---------------------------------------------------

test('З: часть имени из общего слова ключом не становится; полное имя — всегда', () => {
  assert.deepEqual(nameKeys('Лишний Человек'), ['Лишний Человек']);
  assert.deepEqual(nameKeys('Мастер Ли'), ['Мастер Ли'], 'короткое «Ли» и «Мастер» — не ключи');
  assert.deepEqual(nameKeys('Вера Соколова'), ['Вера Соколова', 'Вера', 'Соколова']);
});

test('З: имя чат-лорбука сохраняет кириллицу, запрещённые в имени файла знаки — «_»', () => {
  const ctx = (chatId) => ({ chatMetadata: {}, getCurrentChatId: () => chatId });
  assert.equal(bookName(ctx('Вера - 2026-10-07@12h30m')), 'Academy Вера - 2026-10-07_12h30m');
  assert.equal(bookName(ctx('a/b:c')), 'Academy a_b_c');
});

// --- А, Д: здоровье неполного состояния, прочитанное только на виду -------------------------

test('А: таблица, сохранённая до «Начать», — «не начат», а не «состояние повреждено»', () => {
  const subjects = [{ id: 'chem', name: 'химия', teacherId: 'petrova' }];
  const partial = { subjects, teachers: TEACHERS, schedule: buildSchedule(subjects, preset) };
  const h = stateHealth(partial, preset);
  assert.equal(h.kind, 'not-started');
  assert.deepEqual(h.errors, []);
  assert.equal(h.text, uiLabels(preset).notStartedWithPlan);
  assert.equal(stateHealth({ started: false }, preset).kind, 'not-started');
  // Начатое и битое — по-прежнему «повреждено».
  assert.equal(stateHealth({ started: true, subjects: 'нет' }, preset).kind, 'broken');
});

test('Д: прочитанным лента становится, только когда её видно', () => {
  assert.equal(feedVisible({ open: true, tab: 'feed' }), true);
  assert.equal(feedVisible({ open: false, tab: 'feed' }), false, 'панель закрыта — последний открытый канал не читается');
  assert.equal(feedVisible({ open: true, tab: 'today' }), false);
  assert.equal(feedVisible({ open: true, tab: 'feed', hidden: true }), false, 'страница в фоне');
  assert.equal(feedVisible(), false);
});

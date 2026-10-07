// Починка после третьего живого прогона 08.10 (лента с ветками): значок игрока
// возвращается со свайпом, анкета не стирает людей, тон ветки «спорят»,
// подписи «по поводу», фон по сути факта, имя чат-лорбука, «Не разобрано».

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  parseAnalysis, reactionsOf, repliesOf, isFactToken, tokenEvent, tokenAbout, tokenText, talkParts,
} from '../core/analysis.mjs';
import {
  carryFeedMarks, rememberFeedMarks, toggleReact, markRead, feedBackground, MARKS_MAX,
} from '../core/feed.mjs';
import { applySceneEvents, applyReactions, sceneAbout, shortName } from '../core/scene.mjs';
import { threadTone, hookCore } from '../core/plot.mjs';
import { unparsedText, humanName } from '../mes-panel.js';
import { longestWord } from '../ui/panel.js';
import { markerPeople } from '../core/classmates.mjs';
import { createState, cloneState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { readMarks } from '../storage.js';
import { bookName, syncLorebook } from '../lorebook.js';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));
const SUBJECTS = [{ id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' }];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна' }];
const COURSE = [
  { id: 'sokolova', name: 'Вера Соколова', relation: 0 },
  { id: 'orlova', name: 'Мила Орлова', relation: 0 },
];
const DAY = '2026-10-08';
const LF = '\n';
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

const lexicon = (s) => ({
  ...preset, subjects: s.subjects, teachers: markerPeople(s), classmates: s.classmates, survey: s.survey, names: NAMES,
});

/** Разбор целиком в ленту — так, как его кладёт пересчёт ответа. */
function applyAll(s, raw, src) {
  const lex = lexicon(s);
  const parsed = parseAnalysis(raw, lex);
  const items = parsed.tokens.filter(isFactToken).map((token) => ({ token, ev: tokenEvent(token, lex) }));
  const next = applySceneEvents(s, items, preset, { src, day: DAY, stop: NAMES });
  return applyReactions(next, src, reactionsOf(parsed.tokens), new Map(items.map((x) => [x.token, x.ev])), {
    day: DAY, loud: 2, replies: repliesOf(parsed.tokens),
  });
}

const VARIANT_A = [
  '<!-- [ACADEMY clash=sokolova:@heroine:из-за конспекта] -->',
  'loud=2',
  'react=1:~школьный бес:chat:Опять Соколова орёт на всю аудиторию',
  'reply=1:orlova:Аня вообще-то права',
].join('\n');

const VARIANT_B = [
  '<!-- [ACADEMY clash=orlova:@heroine:из-за места у окна] -->',
  'loud=1',
  'react=1:~кто-то из столовой:chat:Орлова опять с Аней шепчется',
].join('\n');

// --- свайп и значок игрока (решение владелицы 08.10) -----------------------------

test('свайп: свой значок уходит с вариантом и возвращается вместе с ним', () => {
  const before = semester();
  // Вариант A посчитан, игрок поставил значок посту и ответу, прочитал ленту.
  let live = applyAll(cloneState(before), VARIANT_A, 'mA');
  const post = live.feed.items.find((x) => !x.parent && x.kind === 'reaction');
  const reply = live.feed.items.find((x) => x.parent);
  assert.ok(post && reply);
  assert.equal(toggleReact(live, post.id, '😱'), '😱');
  assert.ok(toggleReact(live, reply.id, live.feed.items.find((x) => x.id === reply.id) ? '😂' : ''));
  markRead(live);
  const replyMine = live.feed.items.find((x) => x.id === reply.id).mine;

  // Свайп на B: ход запоминает отметки, лента откатывается к снимку.
  let marks = rememberFeedMarks([], live);
  live = carryFeedMarks(live, cloneState(before), 'mA', marks);
  assert.equal((live.feed ? live.feed.items : []).length, 0, 'откат — записей A нет');
  live = carryFeedMarks(live, applyAll(cloneState(before), VARIANT_B, 'mB'), 'mB', marks);
  assert.ok(live.feed.items.length);
  for (const x of live.feed.items) assert.equal(x.mine, '', 'к чужому варианту значок не прилипает');

  // Возврат на A: снова откат (память дополняется B) и пересчёт A.
  marks = rememberFeedMarks(marks, live);
  live = carryFeedMarks(live, cloneState(before), 'mB', marks);
  live = carryFeedMarks(live, applyAll(cloneState(before), VARIANT_A, 'mA'), 'mA', marks);
  const back = live.feed.items.find((x) => x.id === post.id);
  assert.equal(back.mine, '😱', 'значок поста вернулся');
  assert.equal(back.read, true, '«прочитано» вернулось');
  assert.equal(live.feed.items.find((x) => x.id === reply.id).mine, replyMine, 'значок ответа вернулся');
});

test('свайп: снятый на варианте значок не воскресает из памяти', () => {
  const before = semester();
  let live = applyAll(cloneState(before), VARIANT_A, 'mA');
  const post = live.feed.items.find((x) => !x.parent && x.kind === 'reaction');
  toggleReact(live, post.id, '😱');
  const marks = rememberFeedMarks([], live);
  // Пересчёт того же варианта: игрок снял значок — живая лента важнее памяти.
  toggleReact(live, post.id, '😱');
  live = carryFeedMarks(live, applyAll(cloneState(before), VARIANT_A, 'mA'), 'mA', marks);
  assert.equal(live.feed.items.find((x) => x.id === post.id).mine, '');
});

test('память отметок: с потолком, переживает запись в метаданные', () => {
  const many = Array.from({ length: MARKS_MAX + 30 }, (_, i) => ({ id: `x${i}`, mine: '😂' }));
  const kept = rememberFeedMarks(many, null);
  assert.equal(kept.length, MARKS_MAX);
  assert.equal(kept[kept.length - 1].id, `x${MARKS_MAX + 29}`, 'старые уходят первыми');
  assert.deepEqual(readMarks([{ id: 'a', mine: '😱', read: true, status: 'taken' }, null, { mine: 'x' }]), [
    { id: 'a', read: true, mine: '😱', status: 'taken', playedSrc: '' },
  ]);
  assert.deepEqual(readMarks('мусор'), []);
});

// --- имя чат-лорбука ---------------------------------------------------------------

/** Поддельная таверна с World Info. */
function tavern({ worlds = new Map(), chatId = 'Тест Героиня - 2026-10-08@01h13m03s201ms', metadata = {} } = {}) {
  const t = {
    worlds,
    chatMetadata: metadata,
    name2: 'Мирон',
    getCurrentChatId: () => chatId,
    async saveMetadata() {},
    async loadWorldInfo(name) { return worlds.get(name) || null; },
    async saveWorldInfo(name, data) { worlds.set(name, structuredClone(data)); },
    async updateWorldInfoList() {},
    getWorldInfoNames: () => [...worlds.keys()],
  };
  return t;
}
const LORE_ON = { lorebook: { enabled: true } };

test('чат-лорбук: «Академия — имя чата» без отметки времени; старые чаты находят свой', async () => {
  const t = tavern();
  assert.equal(bookName(t), 'Академия — Тест Героиня');
  const res = await syncLorebook(t, semester(), preset, { settings: LORE_ON });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.name, 'Академия — Тест Героиня');
  assert.equal(t.chatMetadata.world_info, 'Академия — Тест Героиня');
  assert.equal(t.worlds.get('Академия — Тест Героиня').academy_chat, 'Тест Героиня - 2026-10-08@01h13m03s201ms');

  // Старый чат: лорбук заведён под прежним именем, привязка не дошла до диска —
  // находится он, второй не заводится.
  const legacy = 'Academy Тест Героиня - 2026-10-08_01h13m03s201ms';
  const old = tavern({ worlds: new Map([[legacy, { entries: {} }]]) });
  assert.equal(bookName(old), legacy);
  const again = await syncLorebook(old, semester(), preset, { settings: LORE_ON });
  assert.equal(again.name, legacy);
  assert.equal(again.created, false);
  assert.deepEqual([...old.worlds.keys()], [legacy]);
});

test('чат-лорбук: имя занято другим чатом — короткий номер; своё незапривязанное — берётся', async () => {
  const other = { entries: { 0: { uid: 0, content: 'чужое' } }, academy_chat: 'Тест Героиня - 2026-09-01@10h00m00s' };
  const t = tavern({ worlds: new Map([['Академия — Тест Героиня', other]]) });
  const res = await syncLorebook(t, semester(), preset, { settings: LORE_ON });
  assert.equal(res.name, 'Академия — Тест Героиня 2');
  assert.equal(t.worlds.get('Академия — Тест Героиня').entries[0].content, 'чужое', 'чужой лорбук не тронут');

  // Свой файл есть, а привязки нет: тот же лорбук, без второго.
  const mine = { entries: {}, academy_chat: 'Тест Героиня - 2026-10-08@01h13m03s201ms' };
  const lost = tavern({ worlds: new Map([['Академия — Тест Героиня', other], ['Академия — Тест Героиня 2', mine]]) });
  const back = await syncLorebook(lost, semester(), preset, { settings: LORE_ON });
  assert.equal(back.name, 'Академия — Тест Героиня 2');
  assert.equal(lost.worlds.size, 2);
});

// --- подписи ---------------------------------------------------------------------

test('«о чём» пост: без «по поводу» и второго двоеточия', () => {
  const people = [...COURSE, { id: 'gromov', name: 'Никита Громов' }];
  assert.equal(sceneAbout({ kind: 'clash', a: 'sokolova', b: '@heroine', reason: 'из-за конспекта' }, people, 'Ренее'),
    'Вера Соколова и Ренее — стычка из-за конспекта');
  assert.equal(sceneAbout({ kind: 'clash', a: 'sokolova', b: 'orlova', reason: 'место у окна' }, people), 'Вера Соколова и Мила Орлова — стычка: место у окна');
  assert.equal(sceneAbout({ kind: 'met', personId: 'gromov' }, people), 'Никита Громов был в сцене');
  assert.equal(sceneAbout({ kind: 'met', personId: 'sokolova' }, people), 'Вера Соколова была в сцене');
  assert.equal(sceneAbout({ kind: 'rumor', about: '@heroine', text: 'встречается с преподом' }, people, 'Ренее'),
    'Ренее — встречается с преподом (слух)');
  const lex = lexicon(semester());
  assert.equal(tokenAbout('clash=sokolova:@heroine:из-за конспекта', lex), 'Вера Соколова и Аня — стычка из-за конспекта');
  for (const t of ['clash=sokolova:@heroine:из-за конспекта', 'met=orlova']) assert.doesNotMatch(tokenAbout(t, lex), /по поводу|: .*:/);
});

test('анонимка везде «без подписи», серым, как маска', () => {
  const s = semester();
  const res = parseAnalysis([
    '<!-- [ACADEMY clash=sokolova:@heroine:из-за конспекта] -->',
    'loud=3',
    'react=1:someone:anon:Говорят, она всё подстроила',
    'react=1:~школьный бес:anon:Я всё видел',
    'react=1:orlova:chat:Аня права',
  ].join(LF), lexicon(s));
  const reacts = res.tokens.filter((t) => t.startsWith('react='));
  assert.equal(tokenText(reacts[0], lexicon(s)), 'без подписи: «Говорят, она всё подстроила»');
  assert.deepEqual(reacts.map((t) => talkParts(t, lexicon(s)).style), ['anon', 'mask', 'person']);
  assert.equal(talkParts(reacts[0], lexicon(s)).who, 'без подписи');
});

test('тон ветки: типичные реплики спора — «спорят»', () => {
  for (const t of ['да ладно', 'Ты что, она не виновата', 'Неправда!', 'враньё', 'сама такая', 'бред', 'Это я-то ору?', 'Не ври', 'ничего подобного']) {
    assert.equal(threadTone([t]), 'argue', t);
  }
  assert.equal(threadTone(['Аня вообще-то права']), 'back');
  assert.equal(threadTone(['спросить чего-нибудь']), 'talk');
});

test('короткое имя: преподаватель — фамилией, однокурсник — без отчества', () => {
  assert.equal(shortName('Орлова Марина Сергеевна', { teacher: true }), 'Орлова');
  assert.equal(shortName('Марина Сергеевна Орлова', { teacher: true }), 'Орлова');
  assert.equal(shortName('Анна Петрова', { teacher: true }), 'Петрова');
  assert.equal(shortName('Вера Соколова'), 'Вера Соколова');
  assert.equal(shortName('Громов Никита Ильич'), 'Громов Никита');
  assert.equal(shortName('Мастер Ли', { teacher: true }), 'Мастер Ли', 'не узнали фамилию — как есть');
});

test('повод: преподаватель коротко и «пишет в чате»; анонимка — «пишут без подписи»', () => {
  const s = semester();
  s.teachers = [{ id: 'petrova', name: 'Орлова Марина Сергеевна' }];
  const next = applyAll(s, [
    '<!-- [ACADEMY clash=sokolova:@heroine:из-за конспекта] -->',
    'react=1:petrova:chat:Девочки, тише',
    'react=1:someone:anon:Говорят, её отчислят',
    'reply=1:orlova:Да ладно, неправда',
  ].join(LF), 'm1');
  const posts = next.feed.items.filter((x) => x.kind === 'reaction' && !x.parent);
  const said = hookCore(next, posts[0].id, { heroine: 'Аня', preset }).core;
  assert.equal(said, 'Орлова пишет в чате: «Девочки, тише»; в ветке спорят');
  assert.match(hookCore(next, posts[1].id, { preset }).core, /^пишут без подписи: «Её отчислят»/);
});

test('фон: реплика без антецедента не идёт — идёт суть факта', () => {
  const s = semester();
  const next = applyAll(s, [
    '<!-- [ACADEMY rumor=@heroine:встречается с преподом] -->',
    'react=1:someone:anon:У неё роман с физруком',
  ].join(LF), 'm1');
  // Факт сам пусть уйдёт из фона, останется только реплика к нему.
  next.feed.items = next.feed.items.filter((x) => x.kind === 'reaction').concat(next.feed.items.filter((x) => x.kind === 'fact').map((x) => ({ ...x, status: 'expired' })));
  const bg = feedBackground(next);
  assert.equal(bg.length, 1);
  assert.equal(bg[0].kind, 'rumor');
  assert.match(bg[0].text, /встречается с преподом/);
  assert.doesNotMatch(bg[0].text, /физрук/);
});

test('«Не разобрано»: сырой id — человеческой формой', () => {
  assert.equal(humanName('petrov-igor'), 'Petrov Igor');
  assert.equal(humanName('Глеб'), 'Глеб');
  assert.equal(unparsedText(['petrov-igor']),
    'Не разобрано: кто-то по имени «Petrov Igor» — такого человека нет в списках. Добавьте человека или поправьте имя и разберите заново.');
  assert.doesNotMatch(unparsedText(['petrov-igor']), /petrov-igor/);
});

test('ярлык вкладки: длина самого длинного слова — для шрифта на телефоне', () => {
  assert.equal(longestWord('Достижения'), 10);
  assert.equal(longestWord('Нефритовая табличка'), 10);
  assert.equal(longestWord('Люди'), 4);
});

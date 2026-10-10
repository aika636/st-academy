// Каст и сюжетики молвы (шаг 1 плана «Молва»): форма в `state.feed`, пресеты,
// промпт и разбор ответа, проверка разнообразия, расстановка связей, сборка
// с точечными заменами и жизнь сюжетиков.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  normalizeFeed, ensureFeed, normalizeCastList, normalizeThreads, feedManners, feedExtras, DEFAULT_MANNERS,
  CAST_MAX, THREADS_MAX, STAGES,
} from '../core/feed.mjs';
import {
  castOf, setCast, updateMember, carryCast, similar, checkDiversity, assignRelations, buildCastPrompt,
  buildReplacePrompt, parseCastResponse, assembleCast, rumorAuthors, worldRealities, END_MARK, FIX_ATTEMPTS,
} from '../core/feed-cast.mjs';
import {
  startThread, advanceThread, closeThread, spawnThread, openThreads, threadRoom, hasTopic,
} from '../core/feed-threads.mjs';
import { normalizePreset, normalizeFeedBlock } from '../core/preset.mjs';
import { stopList } from '../core/stop-names.mjs';
import { createState, cloneState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { castView } from '../ui.js';

const PRESETS_DIR = new URL('../presets/', import.meta.url);
const load = (id) => JSON.parse(readFileSync(new URL(`${id}.json`, PRESETS_DIR), 'utf8'));
const presetIds = () => readdirSync(fileURLToPath(PRESETS_DIR)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));

const member = (n, extra = {}) => ({
  id: `cast${n}`, nick: `ученик ${'абвгдежз'[n - 1]}${'иклмнопр'[n - 1]}`, type: `типаж ${'ЯБЧГДЖЗК'[n - 1]}фыв${n}`,
  interest: `интерес ${n}`, goal: `цель ${n}`, manner: `манера ${n}`, ally: '', rival: '', ...extra,
});

/** Каст из восьми заведомо разных статистов, с настоящими словами. */
const WORDS = [
  ['Бессонница', 'отличник строевой', 'шахматы и дроны', 'выбиться в командиры взвода', 'докладывает по форме'],
  ['Дежурный', 'нарушитель режима', 'ночные вылазки на кухню', 'не попасть в наряд', 'сыплет присказками про устав'],
  ['Старшина', 'карьерист', 'парады и награды', 'получить нашивку первым', 'пишет приказным тоном'],
  ['Тишина', 'тихоня', 'коллекция старых карт', 'дожить до выпуска без замечаний', 'отвечает односложно'],
  ['Радио', 'сплетник', 'подслушивание в казарме', 'узнать, кто пишет рапорты', 'шепчет после отбоя'],
  ['Гвоздь', 'силач', 'гири и спарринги', 'победить на смотре борьбы', 'считает всё в подходах'],
  ['Лисичка', 'завистник', 'рисование карикатур', 'занять чужое место в списке', 'хвалит и тут же поддевает'],
  ['Сынок', 'генеральский сынок', 'коллекционные ножи', 'скрыть, чей он сын', 'намекает на связи отца'],
];
const wordMember = (i, extra = {}) => ({
  id: `cast${i + 1}`, nick: WORDS[i][0], type: WORDS[i][1], interest: WORDS[i][2], goal: WORDS[i][3], manner: WORDS[i][4],
  ally: '', rival: '', ...extra,
});
const wordCast = () => WORDS.map((_, i) => wordMember(i));
const lines = (list) => list.map((m) => [m.nick, m.type, m.interest, m.goal, m.manner, m.allyNick || '', m.rivalNick || ''].join(' | ')).join('\n');

const preset = load('cadet-academy');
const SUBJECTS = [{ id: 'tactics', name: 'тактика', teacherId: 'ivanov' }, { id: 'topo', name: 'топография', teacherId: 'ivanov' }];
const TEACHERS = [{ id: 'ivanov', name: 'Иванов Пётр Сергеевич' }];

function semester(extra = {}) {
  const s = createState(preset, {
    startDay: '2026-09-01', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
    classmates: [], ...extra,
  });
  s.started = true;
  s.calendar.day = '2026-10-09';
  return s;
}

// --- форма --------------------------------------------------------------------------------

test('каст: битые записи отбрасываются, ally/rival на несуществующего обнуляются, потолок 8', () => {
  const raw = [
    null, 'строка', { id: 'a', nick: '' }, { id: 'b', nick: 'я' },
    { id: 'x1', nick: 'Лиса', type: ' завистница ', ally: 'x2', rival: 'нет-такого' },
    { id: 'x2', nick: 'Волк|стая', interest: 'охота', ally: 'x2', rival: 'x1' },
    { id: 'x1', nick: 'Двойник id' },
    { nick: 'Без идентификатора' },
  ];
  const cast = normalizeCastList(raw);
  assert.deepEqual(cast.map((m) => m.nick), ['Лиса', 'Волк стая', 'Без идентификатора']);
  assert.equal(cast[0].type, 'завистница');
  assert.equal(cast[0].ally, 'x2');
  assert.equal(cast[0].rival, '', 'соперник, которого нет, обнулён');
  assert.equal(cast[1].ally, '', 'сам себе не союзник');
  assert.equal(cast[1].rival, 'x1');
  assert.match(cast[2].id, /^cast\d+$/, 'запись без id получила свой');
  assert.equal(new Set(cast.map((m) => m.id)).size, 3);

  const many = normalizeCastList(Array.from({ length: 20 }, (_, i) => ({ nick: `ник номер ${i}` })));
  assert.equal(many.length, CAST_MAX);
  assert.equal(CAST_MAX, 8);
});

test('каст: союзник и соперник не один и тот же человек', () => {
  const cast = normalizeCastList([
    { id: 'a', nick: 'Альфа', ally: 'b', rival: 'b' },
    { id: 'b', nick: 'Браво' },
  ]);
  assert.equal(cast[0].ally, 'b');
  assert.equal(cast[0].rival, '');
});

test('лента: каст и сюжетики проходят нормализацию, сюжетик без участников каста уходит', () => {
  const feed = normalizeFeed({
    cast: [member(1), member(2), member(3)],
    threads: [
      { id: 't1', topic: 'Зимний бал', members: ['cast1', 'cast2', 'cast9'], dispute: 'о билетах', stage: 'спор', source: 'calendar' },
      { id: 't2', topic: 'ушёл', members: ['cast1', 'cast9'] },
      { id: 't3', topic: 'без стадии', members: ['cast2', 'cast3'], stage: 'бред', source: 'бред' },
      { id: 't3', topic: 'повтор id', members: ['cast2', 'cast3'] },
      { id: 't4', topic: '', members: ['cast1', 'cast2'] },
    ],
  });
  assert.deepEqual(feed.threads.map((t) => t.id), ['t1', 't3']);
  assert.deepEqual(feed.threads[0].members, ['cast1', 'cast2']);
  assert.equal(feed.threads[0].stage, 'спор');
  assert.equal(feed.threads[1].stage, 'завязка', 'бредовая стадия — завязка');
  assert.equal(feed.threads[1].source, 'cast');
  // Статист ушёл из каста — сюжетик без него теряет участника, а с одним — закрывается.
  const cut = normalizeFeed({ ...feed, cast: feed.cast.slice(1) });
  assert.deepEqual(cut.threads.map((t) => [t.id, t.members]), [['t3', ['cast2', 'cast3']]]);
});

test('сюжетики: потолок три, жёсткий', () => {
  const cast = normalizeCastList(Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, nick: `ник номер ${i}` })));
  const threads = normalizeThreads(Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, topic: `тема ${i}`, members: ['c0', 'c1'] })), cast);
  assert.equal(threads.length, THREADS_MAX);
  assert.equal(THREADS_MAX, 3);
});

test('старое состояние без каста — пустой каст, не поломка', () => {
  const s = { calendar: { day: '2026-10-09' }, feed: { items: [] } };
  assert.deepEqual(castOf(s), []);
  assert.deepEqual(ensureFeed(s).threads, []);
});

// --- пресеты ------------------------------------------------------------------------------

test('пресеты: у всех двенадцати свои манеры речи, короткие и без повторов', () => {
  const ids = presetIds();
  assert.equal(ids.length, 12);
  const seen = new Map();
  for (const id of ids) {
    const p = normalizePreset(load(id));
    const own = load(id).feed.manners;
    assert.ok(Array.isArray(own) && own.length >= 8 && own.length <= 12, `${id}: 8–12 манер, а их ${own && own.length}`);
    assert.equal(new Set(own).size, own.length, `${id}: повторы`);
    assert.ok(own.every((m) => m.length >= 12 && m.length <= 120), `${id}: длина манеры`);
    assert.deepEqual(feedManners(load(id)), own, `${id}: манеры доходят до ленты как есть`);
    for (const m of own) seen.set(m, [...(seen.get(m) || []), id]);
  }
  for (const [m, where] of seen) assert.equal(where.length, 1, `манера «${m}» общая у ${where}`);
});

test('пресеты: манеры по сеттингу, а не общие', () => {
  assert.match(feedManners(load('space-academy')).join(' | '), /мостик|колони|вахт/);
  assert.match(feedManners(load('xianxia-sect')).join(' | '), /Дао|культивац|брат/);
  assert.doesNotMatch(feedManners(load('space-academy')).join(' | '), /классн|лаб[аы]|устав/);
});

test('пресет: манеры — список строк; мусор не отвергает пресет, лента берёт общие', () => {
  const bad = { feed: { manners: ['', 5] } };
  const res = normalizeFeedBlock(bad);
  assert.deepEqual(res.errors, []);
  assert.match(res.warnings.join(' '), /feed\.manners/);
  assert.equal(bad.feed.manners, undefined);
  assert.deepEqual(feedManners(bad), DEFAULT_MANNERS);
  assert.deepEqual(feedManners(null), DEFAULT_MANNERS);
  const ok = { feed: { manners: ['говорит шёпотом', 'говорит шёпотом', '  пишет капсом  '] } };
  assert.deepEqual(normalizeFeedBlock(ok).warnings, []);
  assert.deepEqual(feedManners(ok), ['говорит шёпотом', 'пишет капсом']);
});

// --- промпты ------------------------------------------------------------------------------

test('промпт каста: типажи, манеры и реалии именно этого мира, имена героини — под запретом', () => {
  const space = load('space-academy');
  const s = semester();
  const input = {
    preset: space, realities: worldRealities(s, space), heroine: 'Алиса Воронова', mainNames: ['Джаспер Мираж'], classmates: ['Вера Соколова'],
  };
  const { system, user } = buildCastPrompt(input);
  assert.match(system, /строками списка/);
  for (const t of feedExtras(space)) assert.ok(user.includes(t), `типаж «${t}»`);
  for (const m of feedManners(space)) assert.ok(user.includes(m), `манера «${m}»`);
  assert.match(user, /Алиса Воронова/);
  assert.match(user, /Джаспер Мираж/);
  assert.match(user, /Вера Соколова/);
  assert.match(user, /ник \| типаж \| интерес \| цель \| манера речи \| ник союзника \| ник соперника/);
  assert.ok(user.includes(END_MARK));
  assert.doesNotMatch(user, /чирлидер|футбол/);
  assert.match(user, /ровно 8 строк/);
});

test('реалии: заведение, предметы, праздники', () => {
  const p = { displayName: 'Школа космоса', holidays: [{ name: 'День запуска', from: '04-12' }], vocab: { teacher: 'инструктор' } };
  const s = semester();
  const real = worldRealities(s, p).join('\n');
  assert.match(real, /Школа космоса/);
  assert.match(real, /тактика, топография/);
  assert.match(real, /День запуска/);
  assert.match(real, /инструктор/);
});

test('промпт замены: остальные известны, причина названа', () => {
  const cast = wordCast();
  const { user } = buildReplacePrompt({ preset }, cast, 'cast3', ['типаж «тихоня» повторяет «тихоня» (Тишина)']);
  assert.match(user, /Радио \| сплетник/);
  assert.doesNotMatch(user, /Старшина \| карьерист/, 'заменяемый среди «остальных» не значится');
  assert.match(user, /Не подошёл: «Старшина»/);
  assert.match(user, /повторяет/);
});

// --- разбор -------------------------------------------------------------------------------

test('разбор: строки, номера и маркеры, шапка, союзник и соперник — ники → id', () => {
  const text = [
    'Вот список:',
    'ник | типаж | интерес | цель | манера речи | ник союзника | ник соперника',
    '1. Радио | сплетник | подслушивание | узнать всё | шепчет | Гвоздь | Лисичка',
    '- Гвоздь | силач | гири | победить | считает подходы | Радио | Сынок',
    '* ~Лисичка | завистник | карикатуры | занять место | хвалит и поддевает | Сынок | Радио',
    '| Сынок | генеральский сынок | ножи | скрыть отца | намекает | Лисичка | Гвоздь |',
    END_MARK,
  ].join('\n');
  const r = parseCastResponse(text);
  assert.equal(r.complete, true);
  assert.deepEqual(r.members.map((m) => m.nick), ['Радио', 'Гвоздь', 'Лисичка', 'Сынок']);
  const by = Object.fromEntries(r.members.map((m) => [m.nick, m]));
  assert.equal(by.Радио.ally, by.Гвоздь.id);
  assert.equal(by.Радио.rival, by.Лисичка.id);
  assert.equal(by.Сынок.rival, by.Гвоздь.id);
  assert.equal(by.Лисичка.type, 'завистник');
});

test('разбор: обрыв — берётся последняя целая строка', () => {
  const full = lines(WORDS.slice(0, 3).map(([nick, type, interest, goal, manner], i) => ({
    nick, type, interest, goal, manner, allyNick: WORDS[(i + 1) % 3][0], rivalNick: WORDS[(i + 2) % 3][0],
  })));
  // Конец оборван посреди четвёртой строки: пять полей, а «КОНЕЦ» нет.
  const cut = `${full}\nТишина | тихоня | старые карты | дожить | отвечает одно`;
  const r = parseCastResponse(cut);
  assert.equal(r.complete, false);
  assert.deepEqual(r.members.map((m) => m.nick), ['Бессонница', 'Дежурный', 'Старшина'], 'оборванная строка не принята');
  assert.ok(r.rejected.some((x) => /оборван/.test(x)));
  // Оборвано на середине поля — строка не дошла до пятого поля.
  assert.equal(parseCastResponse(`${full}\nТишина | тихоня | стар`).members.length, 3);
  // Строка из семи полей и без «КОНЕЦ» целая — последняя остаётся.
  assert.equal(parseCastResponse(`${full}\nТишина | тихоня | карты | дожить | молчит | Радио | Гвоздь`).members.length, 4);
  // С «КОНЕЦ» последняя строка принимается и с пятью полями (связи расставит код).
  assert.equal(parseCastResponse(`${full}\nТишина | тихоня | карты | дожить | молчит\n${END_MARK}`).members.length, 4);
  // Явная пометка обрыва от транспорта сильнее маркера.
  assert.equal(parseCastResponse(`${full}\nТишина | тихоня | карты | дожить | молчит\n${END_MARK}`, { truncated: true }).members.length, 3);
});

test('разбор: повторный ник, лишние сверх потолка, ерунда вместо ответа', () => {
  const rows = Array.from({ length: 12 }, (_, i) => `Ник номер ${i} | тип ${i} | инт ${i} | цель ${i} | манера ${i} | | `).join('\n');
  assert.equal(parseCastResponse(`${rows}\n${END_MARK}`).members.length, 8);
  const twin = parseCastResponse('Радио | сплетник | а | б | в\nрадио | другой | г | д | е\nКОНЕЦ');
  assert.equal(twin.members.length, 1);
  assert.ok(twin.rejected.some((x) => /повторн/.test(x)));
  assert.deepEqual(parseCastResponse('Извините, не могу.').members, []);
  assert.deepEqual(parseCastResponse('').members, []);
  assert.deepEqual(parseCastResponse(null).members, []);
});

// --- разнообразие -------------------------------------------------------------------------

test('сравнение: грубые совпадения ловятся, разное — нет', () => {
  assert.equal(similar('Сплетница', 'сплетница'), true);
  assert.equal(similar('завистница', 'завистник'), true);
  assert.equal(similar('сплетница', 'сплетница с мостика'), true);
  assert.equal(similar('шепчет после отбоя', 'шепчет в казарме после отбоя'), true);
  assert.equal(similar('ёлка', 'елка'), true);
  assert.equal(similar('шепчет после отбоя', 'пишет приказным тоном'), false);
  assert.equal(similar('сплетник', 'силач'), false);
  assert.equal(similar('', ''), false);
  assert.equal(similar('гот', 'готовый'), false);
});

test('разнообразие: чистый каст проходит, повторы типажа, интереса и манеры — нарушители', () => {
  assert.deepEqual(checkDiversity(wordCast()), { problems: [], redo: [] });
  const cast = wordCast();
  cast[3].type = 'карьерист!'; // как у cast3
  cast[4].interest = 'Шахматы и дроны'; // как у cast1
  cast[5].manner = 'пишет приказным тоном, коротко'; // как у cast3
  const r = checkDiversity(cast);
  assert.deepEqual(r.redo, ['cast4', 'cast5', 'cast6'], 'виноват всегда тот, кто стоит позже');
  assert.ok(r.problems.some((p) => p.id === 'cast4' && p.field === 'type' && p.with === 'cast3' && !p.hard));
  assert.ok(r.problems.some((p) => p.id === 'cast5' && p.field === 'interest' && p.with === 'cast1'));
  assert.ok(r.problems.some((p) => p.id === 'cast6' && p.field === 'manner' && p.with === 'cast3'));
  assert.ok(r.problems.every((p) => p.text));
});

test('разнообразие: пустое поле не считается повтором', () => {
  const cast = wordCast();
  cast[1].interest = '';
  cast[2].interest = '';
  assert.deepEqual(checkDiversity(cast).redo, []);
});

test('ник: стоп-лист (героиня, персонаж карточки), сокурсники, двойник', () => {
  const stop = stopList({ user: 'Алиса Воронова', char: ['Джаспер Мираж'] });
  const cast = wordCast();
  cast[0].nick = 'Алиса';
  cast[1].nick = 'Джаспер';
  cast[2].nick = 'Вера Соколова';
  cast[3].nick = 'Радио'; // двойник cast5
  cast[4].nick = 'радио';
  const r = checkDiversity(cast, { stop, classmates: [{ name: 'Вера Соколова' }, 'Глеб Морозов'] });
  const hard = r.problems.filter((p) => p.hard);
  assert.deepEqual(hard.map((p) => [p.id, p.field]), [
    ['cast1', 'nick'], ['cast2', 'nick'], ['cast3', 'nick'], ['cast5', 'nick'],
  ]);
  assert.match(hard[0].text, /персонажа игрока/);
  assert.match(hard[1].text, /совпадает с «Джаспер Мираж»/);
  assert.match(hard[2].text, /сокурсник/);
  assert.match(hard[3].text, /уже есть/);
  assert.deepEqual(r.redo, ['cast1', 'cast2', 'cast3', 'cast5']);
  // Без стоп-листа и сокурсников ник чист.
  assert.deepEqual(checkDiversity([wordMember(0, { nick: 'Алиса' })]).redo, []);
});

// --- связи --------------------------------------------------------------------------------

test('связи: код расставляет недостающих, не трогает верных, не путает союзника с соперником', () => {
  const bare = assignRelations(wordCast());
  assert.equal(bare.length, 8);
  for (const m of bare) {
    assert.ok(m.ally && m.rival, `${m.nick}: обе связи`);
    assert.notEqual(m.ally, m.id);
    assert.notEqual(m.rival, m.id);
    assert.notEqual(m.ally, m.rival);
  }
  assert.deepEqual(assignRelations(wordCast()), bare, 'расстановка детерминирована');
  const ids = new Set(bare.map((m) => m.id));
  assert.ok(bare.every((m) => ids.has(m.ally) && ids.has(m.rival)));

  const half = wordCast();
  half[0].ally = 'cast7';
  half[1].rival = 'cast8';
  half[2].ally = 'ушёл'; // битая — заменится
  const fixed = assignRelations(half);
  assert.equal(fixed[0].ally, 'cast7');
  assert.equal(fixed[1].rival, 'cast8');
  assert.notEqual(fixed[2].ally, 'ушёл');
  assert.ok(ids.has(fixed[2].ally));
  // Двое — тоже пара; один — без связей.
  const two = assignRelations(wordCast().slice(0, 2));
  assert.deepEqual([two[0].ally, two[0].rival], ['cast2', '']);
  assert.deepEqual(assignRelations(wordCast().slice(0, 1)).map((m) => [m.ally, m.rival]), [['', '']]);
});

// --- сборка с заменой ---------------------------------------------------------------------

/** Ответ модели: каст из `WORDS` с подменёнными строками. */
function castReply(patch = {}) {
  const rows = WORDS.map(([nick, type, interest, goal, manner], i) => ({
    nick, type, interest, goal, manner, allyNick: WORDS[(i + 1) % 8][0], rivalNick: WORDS[(i + 4) % 8][0], ...(patch[i] || {}),
  }));
  return `${lines(rows)}\n${END_MARK}`;
}

test('сборка: чистый ответ — один запрос, восемь статистов, связи на месте', async () => {
  const asked = [];
  const res = await assembleCast({ preset }, async (p) => {
    asked.push(p);
    return { ok: true, text: castReply() };
  });
  assert.equal(res.ok, true);
  assert.equal(res.calls, 1);
  assert.equal(res.members.length, 8);
  assert.deepEqual(res.warnings, []);
  assert.equal(res.members[0].ally, 'cast2');
  assert.equal(res.members[0].rival, 'cast5');
  assert.deepEqual(checkDiversity(res.members).redo, []);
});

test('сборка: повтор типажа и манеры — перегенерируется только виновный, прочие не трогаются', async () => {
  const calls = [];
  const res = await assembleCast({ preset }, async (p) => {
    calls.push(p);
    if (calls.length === 1) {
      return { ok: true, text: castReply({ 4: { type: 'Тихоня' }, 5: { manner: 'докладывает по форме' } }) };
    }
    // Замена: каждый раз новая строка из пяти полей.
    return { ok: true, text: `${calls.length === 2 ? 'Заноза | задира | коллекция значков | сдать нормативы | огрызается шуткой' : 'Метроном | хронометрист | точные часы | быть вовремя | считает секунды вслух'}\n${END_MARK}` };
  });
  assert.equal(res.ok, true);
  assert.equal(res.calls, 3, 'один общий запрос и две точечные замены');
  assert.match(calls[1].user, /Не подошёл: «Радио»/);
  assert.match(calls[2].user, /Не подошёл: «Гвоздь»/);
  assert.match(calls[1].user, /Старшина \| карьерист/, 'остальные названы');
  const nicks = res.members.map((m) => m.nick);
  assert.deepEqual(nicks, ['Бессонница', 'Дежурный', 'Старшина', 'Тишина', 'Заноза', 'Метроном', 'Лисичка', 'Сынок']);
  assert.deepEqual(res.members.map((m) => m.id), WORDS.map((_, i) => `cast${i + 1}`), 'id прежние');
  // Связи заменённого — прежние: на него ссылаются по id.
  assert.equal(res.members[4].ally, 'cast6');
  assert.deepEqual(checkDiversity(res.members).redo, []);
  assert.deepEqual(res.warnings, []);
});

test('сборка: ник героини убирается, если замена не помогла; сходство остаётся с пометкой', async () => {
  const stop = stopList({ user: 'Алиса Воронова' });
  let n = 0;
  const res = await assembleCast({ preset, stop }, async () => {
    n += 1;
    if (n === 1) return { ok: true, text: castReply({ 1: { nick: 'Алиса' }, 6: { type: 'Силач' } }) };
    return { ok: true, text: `Алиса Воронова | силач | гири | цель | манера\n${END_MARK}` };
  });
  assert.equal(res.ok, true);
  assert.ok(res.calls <= 1 + FIX_ATTEMPTS, 'число замен ограничено');
  assert.ok(!res.members.some((m) => /алис/i.test(m.nick)), 'героини в касте нет');
  assert.ok(res.warnings.some((w) => /Убран «Алиса/.test(w)));
  assert.ok(res.members.every((m) => m.ally !== '' || res.members.length < 2));
  const ids = new Set(res.members.map((m) => m.id));
  assert.ok(res.members.every((m) => ids.has(m.ally) && ids.has(m.rival)), 'связи не висят на убранном');
});

test('сборка: отказ запроса, обрыв, мусор, отказ на замене', async () => {
  const down = await assembleCast({ preset }, async () => ({ ok: false, code: 'timeout', message: 'нет ответа' }));
  assert.deepEqual([down.ok, down.code, down.error], [false, 'timeout', 'нет ответа']);
  const junk = await assembleCast({ preset }, async () => ({ ok: true, text: 'не могу' }));
  assert.equal(junk.ok, false);
  assert.equal(junk.code, 'parse');
  const cut = await assembleCast({ preset }, async () => ({ ok: true, text: 'Радио | сплетник | подсл', truncated: true }));
  assert.equal(cut.code, 'truncated');
  assert.match(cut.error, /оборвалась/);
  // Первый запрос прошёл, замена упала — каст остаётся, причина названа.
  let n = 0;
  const half = await assembleCast({ preset }, async () => {
    n += 1;
    return n === 1 ? { ok: true, text: castReply({ 3: { type: 'Сплетник' } }) } : { ok: false, message: 'перегруз' };
  });
  assert.equal(half.ok, true);
  assert.equal(half.members.length, 8);
  assert.ok(half.warnings.some((w) => /не вышло: перегруз/.test(w)));
  assert.ok(half.warnings.some((w) => /типаж/.test(w)), 'сходство осталось и названо');
});

test('сборка: обрыв посреди списка — берутся целые строки, остальных не выдумываем', async () => {
  const text = castReply().split('\n').slice(0, 5).join('\n');
  const res = await assembleCast({ preset }, async () => ({ ok: true, text, truncated: true }));
  assert.equal(res.ok, true);
  assert.ok(res.members.length >= 4 && res.members.length <= 5);
  assert.ok(res.warnings.some((w) => /Собрано \d из 8/.test(w)));
});

// --- состояние ----------------------------------------------------------------------------

test('setCast: каст ложится в state.feed, сюжетики прежнего уходят; правка руками', () => {
  const s = semester();
  setCast(s, assignRelations(wordCast()));
  assert.equal(s.feed.cast.length, 8);
  assert.ok(startThread(s, { topic: 'Зимний бал', members: ['cast1', 'cast2'] }).ok);
  // Замена одного: id прежние, сюжетики остаются.
  setCast(s, s.feed.cast.map((m) => (m.id === 'cast1' ? { ...m, nick: 'Новичок' } : m)), { keepThreads: true });
  assert.equal(openThreads(s).length, 1);
  // Пересборка: id новые — прежних сюжетиков нет.
  setCast(s, assignRelations(wordCast()));
  assert.equal(openThreads(s).length, 0);

  assert.equal(updateMember(s, 'cast2', { goal: 'новая цель', interest: '' }).ok, true);
  assert.equal(castOf(s)[1].goal, 'новая цель');
  assert.equal(castOf(s)[1].interest, '', 'поле можно стереть');
  assert.equal(updateMember(s, 'cast2', { nick: 'Я' }).ok, false, 'ник — от двух букв');
  assert.equal(updateMember(s, 'cast2', { nick: 'радио' }).ok, false, 'ник занят');
  assert.match(updateMember(s, 'cast2', { nick: 'радио' }).error, /занят/);
  assert.equal(updateMember(s, 'нет', { goal: 'x' }).ok, false);
  assert.equal(updateMember(s, 'cast2', { nick: '@~Тихий омут' }).member.nick, 'Тихий омут');
  assert.equal(updateMember(s, 'cast2', { goal: 'а|б' }).member.goal, 'а/б', 'разделитель формата не живёт в поле');
});

test('откат: каст и сюжетики — в state и проходят снимок хода; каст свайп не отменяет, сюжетики — да', () => {
  const live = semester();
  const before = cloneState(live); // снимок «до ответа»: каста ещё нет
  setCast(live, assignRelations(wordCast()));
  startThread(live, { topic: 'Зимний бал', members: ['cast1', 'cast2'] });
  const snap = cloneState(live);
  assert.deepEqual(snap.feed.cast, live.feed.cast, 'каст переживает клонирование состояния');
  assert.deepEqual(snap.feed.threads, live.feed.threads);

  const carried = carryCast(live, before);
  assert.equal(carried.feed.cast.length, 8, 'после свайпа каст остался');
  assert.deepEqual(carried.feed.threads, [], 'сюжетик, заведённый ответом, откатился');
  assert.equal(before.feed, undefined, 'исходный снимок не тронут');
  // Тот же каст в снимке — сам снимок.
  assert.equal(carryCast(live, snap), snap);
  // Снимок с сюжетиком «до ответа» хранит его при живом касте.
  const earlier = cloneState(snap);
  earlier.feed.threads[0].stage = 'завязка';
  live.feed.threads[0].stage = 'торг';
  earlier.feed.cast[0].nick = 'Старый ник';
  const back = carryCast(live, earlier);
  assert.equal(back.feed.cast[0].nick, live.feed.cast[0].nick, 'каст — живой');
  assert.equal(back.feed.threads[0].stage, 'завязка', 'стадия — как «до ответа»');
});

test('авторы молвы: каст и сокурсники с желанием или проблемой; героини и персонажа карточки нет', () => {
  const s = semester({
    classmates: [
      { id: 'vera', name: 'Вера Соколова', desire: 'попасть в тройку лучших' },
      { id: 'gleb', name: 'Глеб Морозов' }, // без желания и проблемы — не автор
      { id: 'jasper', name: 'Джаспер Мираж', problem: 'долги' }, // персонаж карточки
      { id: 'alisa', name: 'Алиса Воронова', desire: 'сама' }, // героиня
      { id: 'lena', name: 'Лена Орлова', problem: 'не успевает' },
    ],
  });
  setCast(s, assignRelations(wordCast()));
  s.feed.cast[7].nick = 'Джаспер';
  const stop = stopList({ user: 'Алиса Воронова', char: ['Джаспер Мираж'] });
  const authors = rumorAuthors(s, { stop });
  assert.deepEqual(authors.map((a) => a.id), ['cast1', 'cast2', 'cast3', 'cast4', 'cast5', 'cast6', 'cast7', 'vera', 'lena']);
  assert.deepEqual(authors.filter((a) => a.kind === 'classmate').map((a) => [a.name, a.masked]), [['Вера Соколова', false], ['Лена Орлова', false]]);
  assert.equal(authors[0].masked, true);
  assert.equal(rumorAuthors(semester()).length, 0);
});

// --- сюжетики -----------------------------------------------------------------------------

test('сюжетик: завязка → спор → торг → развязка, потом закрывается и освобождает место', () => {
  const s = semester();
  setCast(s, assignRelations(wordCast()));
  const made = startThread(s, { topic: 'Зимний бал', members: ['cast1', 'cast2', 'cast3'], dispute: 'о билетах', source: 'calendar', day: '2026-10-09' });
  assert.equal(made.ok, true);
  assert.deepEqual([made.thread.stage, made.thread.source, made.thread.since], ['завязка', 'calendar', '2026-10-09']);
  const id = made.thread.id;
  const seen = [];
  for (let i = 0; i < 3; i += 1) seen.push(advanceThread(s, id));
  assert.deepEqual(seen.map((x) => [x.stage, x.closed]), [['спор', false], ['торг', false], ['развязка', false]]);
  assert.deepEqual(STAGES, ['завязка', 'спор', 'торг', 'развязка']);
  assert.equal(threadRoom(s), 2);
  const end = advanceThread(s, id);
  assert.deepEqual([end.closed, end.stage], [true, 'развязка']);
  assert.equal(openThreads(s).length, 0);
  assert.equal(threadRoom(s), 3);
  assert.equal(advanceThread(s, id), null, 'закрытого нет');
  assert.equal(closeThread(s, id), false);
});

test('сюжетик: лимит три, дубль темы, участники только из каста', () => {
  const s = semester();
  setCast(s, assignRelations(wordCast()));
  assert.equal(startThread(s, { topic: 'Зимний бал', members: ['cast1', 'cast2'] }).ok, true);
  assert.deepEqual(startThread(s, { topic: 'зимний БАЛ', members: ['cast3', 'cast4'] }), { ok: false, reason: 'duplicate' });
  assert.deepEqual(startThread(s, { topic: 'Зимний бал: билеты', members: ['cast3', 'cast4'] }), { ok: false, reason: 'duplicate' });
  assert.equal(hasTopic(s, 'Зимний бал'), true);
  assert.deepEqual(startThread(s, { topic: 'Что-то', members: ['cast1', 'чужой'] }), { ok: false, reason: 'bad' });
  assert.deepEqual(startThread(s, { topic: 'Что-то', members: ['cast1'] }), { ok: false, reason: 'bad' });
  assert.equal(startThread(s, { topic: 'Зачёт по тактике', members: ['cast3', 'cast4'] }).ok, true);
  assert.equal(startThread(s, { topic: 'Столовая', members: ['cast5', 'cast6', 'cast7', 'cast8'] }).thread.members.length, 3, 'не больше трёх участников');
  assert.deepEqual(startThread(s, { topic: 'Четвёртый', members: ['cast1', 'cast2'] }), { ok: false, reason: 'full' });
  assert.equal(openThreads(s).length, 3);
});

test('заведение кодом: из календаря — ближайшее событие не дальше 14 дней', () => {
  const p = { ...preset, holidays: [
    { name: 'Выпускной смотр', from: '11-20' }, // слишком далеко
    { name: 'Зимний бал', from: '10-16' }, // через 7 дней
    { name: 'Присяга', from: '10-12' }, // через 3 дня — ближайшая
  ] };
  const s = semester();
  setCast(s, assignRelations(wordCast()));
  const res = spawnThread(s, p, { source: 'calendar' });
  assert.equal(res.ok, true);
  assert.equal(res.thread.topic, 'Присяга');
  assert.equal(res.thread.source, 'calendar');
  assert.ok(res.thread.members.length >= 2 && res.thread.members.length <= 3);
  assert.ok(res.thread.dispute.length > 10);
  const next = spawnThread(s, p, { source: 'calendar' });
  assert.equal(next.thread.topic, 'Зимний бал', 'открытая тема не заводится дважды');
  const none = spawnThread(s, p, { source: 'calendar' });
  assert.deepEqual([none.ok, none.reason], [false, 'no-topic'], 'дальше 14 дней — не тема');
  assert.equal(openThreads(s).length, 2);
});

test('заведение кодом: из учёбы и из пары «союзник/соперник»', () => {
  const s = semester();
  setCast(s, assignRelations(wordCast()));
  const study = spawnThread(s, { ...preset, holidays: [] }, { source: 'study' });
  assert.equal(study.ok, true);
  assert.equal(study.thread.source, 'study');
  assert.match(study.thread.topic, /тактик|топографи|контрольн|сесси/);
  const pair = spawnThread(s, { ...preset, holidays: [] }, { source: 'cast' });
  assert.equal(pair.ok, true);
  assert.equal(pair.thread.source, 'cast');
  const [a, b] = pair.thread.members.map((id) => s.feed.cast.find((m) => m.id === id));
  assert.equal(a.rival, b.id, 'в сюжетике соперники');
  assert.match(pair.thread.topic, new RegExp(`${a.interest}|${b.interest}`));
});

test('заведение кодом без источника: берёт наименее занятый, лимит и пустой каст', () => {
  const s = semester();
  const p = { ...preset, holidays: [{ name: 'Присяга', from: '10-12' }] };
  assert.deepEqual(spawnThread(s, p), { ok: false, reason: 'no-cast' });
  setCast(s, assignRelations(wordCast()));
  const got = [spawnThread(s, p), spawnThread(s, p), spawnThread(s, p)];
  assert.ok(got.every((r) => r.ok), JSON.stringify(got.map((r) => r.reason)));
  assert.deepEqual(got.map((r) => r.thread.source).sort(), ['calendar', 'cast', 'study']);
  assert.equal(new Set(got.map((r) => r.thread.topic)).size, 3, 'темы не повторяются');
  assert.deepEqual(spawnThread(s, p), { ok: false, reason: 'full' });
  // Сюжетик закрылся — место снова есть, но ту же тему заново не заводим, пока она открыта.
  advanceThread(s, got[0].thread.id);
  for (let i = 0; i < 3; i += 1) advanceThread(s, got[0].thread.id);
  assert.equal(threadRoom(s), 1);
});

// --- вид ----------------------------------------------------------------------------------

test('вид панели: человеческие слова, без id и ally', () => {
  const s = semester();
  assert.deepEqual(castView(s, preset).members, []);
  setCast(s, assignRelations(wordCast()));
  startThread(s, { topic: 'Зимний бал', members: ['cast1', 'cast2'], dispute: 'о билетах', source: 'calendar' });
  const v = castView(s, preset);
  assert.equal(v.members.length, 8);
  assert.equal(v.members[0].title, '@Бессонница — отличник строевой');
  assert.deepEqual(v.members[0].relations, ['дружит с @Дежурный', 'враждует с @Радио']);
  assert.equal(v.threads[0].topic, 'Зимний бал');
  assert.equal(v.threads[0].stage, 'стадия: завязка');
  assert.equal(v.threads[0].source, 'из календаря');
  assert.equal(v.threads[0].who, 'участвуют: @Бессонница, @Дежурный');
  assert.equal(v.room, 'Открыто 1 из 3.');
  assert.doesNotMatch(JSON.stringify([v.members.map((m) => m.relations), v.threads.map((t) => [t.stage, t.source, t.who])]), /cast\d|ally|rival/);
});

test('разбор каста: чужие HTML-комментарии с «|» не сходят за строки статистов, в том числе оборванные', () => {
  const body = [
    'Радио | сплетник | подслушивает | узнать всё | пересказывает с придыханием | Тень | Бунт',
    'Тень | тихоня | карты | дожить | молчит и смотрит | Радио | Бунт',
  ].join('\n');
  const noisy = `<!-- NI t=+2m | Ренее: stress=minor:давление | Вандрел: slept=6h -->\n${body}\n${END_MARK}\n<!-- NN time=11:00 | tp=1 | bot_ate=каша (1):300 | x=1`;
  const res = parseCastResponse(noisy);
  assert.equal(res.members.length, 2);
  assert.deepEqual(res.members.map((m) => m.nick), ['Радио', 'Тень']);
  assert.equal(res.complete, true);
});

// test/card-cast — персонаж карточки ≠ NPC (etap-molva.md, шаг 0).
//
// Случай владелицы 09.10: карточка «Your Himbo Roommate», персонаж в ней —
// Джаспер Мираж. Стоп-лист знал только название карточки, и «Джаспер Мираж» из
// сцены пришёл кандидатом в сокурсники.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeCast, castNames, personFromLine, personLine, frequentNames, guessCastLocal, castFromModel,
  buildCastPrompt, emptyCast, titleNames,
} from '../core/card-cast.mjs';
import { stopList, stopHit, nameSkeleton, filterPeople } from '../core/stop-names.mjs';

// Как в живой карточке: имя в заголовке раздела, дальше — «Jasper» одним словом.
const HIMBO = {
  name: 'Your Himbo Roommate',
  description: "Setting:\n- World Details: Orwell's Magic Academy (OMA) is a prestigious school.\n\nJasper Mirage\n\n"
    + 'Overview:\nJasper is a powerful wizard attending Orwell Magic Academy, however he pretends to be a himbo. '
    + 'Every student knows him. His best friend is Leo Hart.',
  personality: 'Sweet, loud, a himbo.',
  scenario: 'Jasper is a powerful mage pretending to be a himbo just to get close to {{user}}',
  firstMessage: 'Jasper sprawled out lazily on the couch. The smell was something Jasper had grown accustomed to. '
    + 'Still, he yawned. *Man, I really should clean up,* Jasper thought, still lazy.',
};

test('догадка без модели: персонаж бота — Jasper Mirage, короткое имя — написанием', () => {
  const cast = guessCastLocal(HIMBO);
  assert.deepEqual(cast.people.map((p) => [p.name, p.aliases, p.role]), [['Jasper Mirage', ['Jasper'], 'main']]);
  assert.equal(cast.source, 'auto');
  assert.equal(cast.checked, false);
});

test('догадка без модели молчит, когда уверенности нет', () => {
  assert.deepEqual(guessCastLocal({ name: 'The school where girls learn', description: '{{char}} is your roommate.' }), emptyCast());
});

test('frequentNames: начало фразы и слово, которое бывает строчным, — не имя', () => {
  const names = frequentNames(`${HIMBO.description}\n${HIMBO.firstMessage}`).map((n) => n.name);
  assert.equal(names[0], 'Jasper');
  for (const w of ['Every', 'Still', 'Overview', 'Academy', 'Setting']) assert.ok(!names.includes(w), w);
});

test('имя из названия карточки: украшения отрезаются, «and» — два персонажа', () => {
  assert.deepEqual(titleNames('Bastien ◇ Childhood Friend'), ['Bastien']);
  assert.deepEqual(titleNames('HOMESTEAD ☀︎ Brock Hollister'), ['Brock Hollister']);
  assert.deepEqual(titleNames('Liam  Steptember'), ['Liam']);
  assert.deepEqual(titleNames('Brad and Kyle  School Bus Trip'), ['Brad', 'Kyle']);
  assert.deepEqual(titleNames('Your Himbo Roommate'), []);
  assert.deepEqual(titleNames('Declan  Your ex-boyfriend'), ['Declan'], '«clan» внутри имени — не клан');
  const cast = guessCastLocal({
    name: 'Bastien ◇ Childhood Friend',
    description: 'Bastien Elias is kind. Then Bastien Elias smiles at Diana.',
  });
  assert.deepEqual(cast.people.map((p) => p.name), ['Bastien Elias']);
});

test('ответ модели: роли, написания, разные формы ответа', () => {
  const cast = castFromModel({
    people: [
      { name: 'Jasper Mirage', aliases: ['Джаспер Мираж', 'Джаспер', 'Jasper Mirage'], role: 'main' },
      { name: 'Лео Харт', role: 'side' },
    ],
  });
  assert.equal(cast.source, 'model');
  assert.deepEqual(cast.people[0].aliases, ['Джаспер Мираж', 'Джаспер']);
  assert.equal(cast.people[1].role, 'npc');
  assert.deepEqual(castNames(cast), ['Jasper Mirage', 'Джаспер Мираж', 'Джаспер']);
  assert.deepEqual(castNames(cast, 'npc'), ['Лео Харт']);
  assert.deepEqual(castFromModel({ main: 'Джаспер', npc: ['Лео'] }).people.map((p) => p.role), ['main', 'npc']);
  assert.equal(castFromModel([{ name: '{{char}}' }]).people.length, 0);
});

test('поле панели: «имя, написания» туда и обратно', () => {
  const p = personFromLine('Джаспер Мираж, Jasper Mirage; Джас', 'main');
  assert.deepEqual(p, { name: 'Джаспер Мираж', aliases: ['Jasper Mirage', 'Джас'], role: 'main' });
  assert.equal(personLine(p), 'Джаспер Мираж, Jasper Mirage, Джас');
  assert.equal(personFromLine('  ,  '), null);
});

test('битый список нормализуется, а не роняет', () => {
  assert.deepEqual(normalizeCast(null), emptyCast());
  assert.deepEqual(normalizeCast({ people: 'ерунда', source: 'чужое' }), emptyCast());
  const many = normalizeCast({ people: Array.from({ length: 30 }, (_, i) => ({ name: `Имя${i}` })) });
  assert.equal(many.people.length, 12);
});

test('скелет имени сводит латиницу и кириллицу', () => {
  assert.equal(nameSkeleton('Джаспер'), nameSkeleton('Jasper'));
  assert.equal(nameSkeleton('Мираж'), nameSkeleton('Mirage'));
  assert.equal(nameSkeleton('Лукас'), nameSkeleton('Lucas'));
  assert.equal(nameSkeleton('Гарри'), 'gr');
  assert.notEqual(nameSkeleton('Джаспер'), nameSkeleton('Мираж'));
});

test('стоп-лист: персонаж карточки ловится полным именем, частью, сквозь алфавит', () => {
  const stop = stopList({ char: ['Your Himbo Roommate', 'Jasper Mirage', 'Jasper'] });
  for (const name of ['Джаспер Мираж', 'Джаспер', 'Мираж', 'Jasper', 'jasper mirage']) {
    assert.equal(stopHit(name, stop) && stopHit(name, stop).kind, 'char', name);
  }
  for (const name of ['Вера Соколова', 'Ваша Соседка', 'Мира Дубова']) assert.equal(stopHit(name, stop), null, name);
});

test('карточка короче имени из сцены: лишнее слово — фамилия, а не другой человек', () => {
  const stop = stopList({ char: 'Джаспер' });
  assert.equal(stopHit('Джаспер Мираж', stop).kind, 'char');
});

test('для героини обратное по-прежнему запрещено: «Анна» не выбивает «Анну Петрову»', () => {
  const stop = stopList({ user: 'Анна' });
  assert.equal(stopHit('Анна Петрова', stop), null);
  assert.equal(stopHit('Анна', stop).kind, 'user');
});

test('подтверждённый наставник-карточка остаётся: карточка — мягкий стоп', () => {
  const stop = stopList({ char: ['Jasper Mirage'] });
  const { kept, dropped } = filterPeople(
    [{ id: 'mirage', name: 'Джаспер Мираж' }, { id: 'new', name: 'Джаспер Мираж' }], stop, { keep: ['mirage'] },
  );
  assert.deepEqual(kept.map((x) => x.id), ['mirage']);
  assert.deepEqual(dropped.map((x) => x.item.id), ['new']);
});

test('промпт «кто в карточке» просит написания на языке чата и не просит игрока', () => {
  const { user } = buildCastPrompt('Описание: Jasper Mirage…', { title: 'Your Himbo Roommate', lang: 'ru' });
  assert.match(user, /Your Himbo Roommate/);
  assert.match(user, /«ru»/);
  assert.match(user, /\{\{user\}\}/);
  assert.match(user, /"role":"main"/);
});

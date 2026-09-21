// test/rel-marker — три правила про `rel=` из 9.3: сила словом (9.3.4),
// гашение штампованных повторов (9.3.5) и стоп-лист имён в метке (9.3.6).
//
// Порядок тот же, что у пути метки: разбор (`parse-marker`) → вес и серия
// (`relations`) → сшивка (`engine`). Сам стоп-лист как функция проверен в
// `test/stop-names.test.mjs`; здесь — только то, как он защищает `rel=`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseMarker } from '../core/parse-marker.mjs';
import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import {
  impactWeight, DEFAULT_IMPACT, repeatLimit, DEFAULT_REPEAT_LIMIT, dampRepeats, relationOf,
  teachersOfSubjects,
} from '../core/relations.mjs';
import { applyResponse } from '../core/engine.mjs';
import { describeApplied } from '../ui.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../presets/${f}`, import.meta.url), 'utf8'));
const preset = load('ru-university.json');
const magic = load('magic-academy.json');

const TEACHERS = [
  { id: 'petrova', name: 'Петрова Анна Сергеевна' },
  { id: 'grinev', name: 'Гринёв' },
];
const SUBJECTS = [
  { id: 'chemistry', name: 'химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'grinev' },
];
const ctx = { ...preset, subjects: SUBJECTS, teachers: TEACHERS };
const rel = (value, lexicon = ctx) => parseMarker(`<!-- [ACADEMY rel=${value}] -->`, lexicon);

// --- 9.3.4: сила словом --------------------------------------------------------

test('слово силы со знаком: minor и major в обе стороны, знак до или после', () => {
  const w = preset.relations.impact;
  const cases = [
    ['petrova:minor+', w.minor, 'minor'],
    ['petrova:minor-', -w.minor, 'minor'],
    ['petrova:major-', -w.major, 'major'],
    ['petrova:+major', w.major, 'major'],
    ['petrova:- minor', -w.minor, 'minor'],
    ['petrova:MAJOR+', w.major, 'major'],
  ];
  for (const [value, delta, impact] of cases) {
    const r = rel(value);
    assert.deepEqual(r.events, [{ kind: 'rel', teacherId: 'petrova', delta, impact }], value);
    assert.deepEqual(r.rejected, [], value);
  }
});

test('русские синонимы и типографский минус принимаются', () => {
  assert.equal(rel('petrova:сильно-').events[0].delta, -preset.relations.impact.major);
  assert.equal(rel('petrova:слегка+').events[0].delta, preset.relations.impact.minor);
  assert.equal(rel('petrova:чуть−').events[0].delta, -preset.relations.impact.minor);
  assert.equal(rel('petrova:major–').events[0].delta, -preset.relations.impact.major);
});

test('число по-прежнему принимается и слова силы не несёт', () => {
  assert.deepEqual(rel('petrova:-1').events, [{ kind: 'rel', teacherId: 'petrova', delta: -1 }]);
  assert.deepEqual(rel('petrova:+3').events, [{ kind: 'rel', teacherId: 'petrova', delta: 3 }]);
});

test('слово без знака, с двумя знаками или незнакомое — в rejected, соседи живы', () => {
  for (const bad of ['petrova:major', 'petrova:+major-', 'petrova:huge+', 'petrova:очень']) {
    const r = parseMarker(`<!-- [ACADEMY t=+1 rel=${bad}] -->`, ctx);
    assert.deepEqual(r.events, [{ kind: 'time', unit: 'period', n: 1 }], bad);
    assert.equal(r.rejected.length, 1, bad);
    assert.match(r.rejected[0].reason, /дельта отношения не число/, bad);
  }
});

test('вес слова берётся из пресета', () => {
  const heavy = { ...ctx, relations: { ...preset.relations, impact: { minor: 2, major: 4 } } };
  assert.equal(rel('petrova:major-', heavy).events[0].delta, -4);
  assert.equal(rel('petrova:minor+', heavy).events[0].delta, 2);
});

test('пресет без блока или с мусором в нём — умолчания из кода', () => {
  const bare = { ...ctx, relations: { min: -5, max: 5, start: 0, labels: preset.relations.labels } };
  assert.equal(rel('petrova:major+', bare).events[0].delta, DEFAULT_IMPACT.major);

  assert.equal(impactWeight(null, 'minor'), DEFAULT_IMPACT.minor);
  assert.equal(impactWeight({ relations: { impact: { minor: 0, major: 'x' } } }, 'minor'), DEFAULT_IMPACT.minor);
  assert.equal(impactWeight({ relations: { impact: { major: -3 } } }, 'major'), DEFAULT_IMPACT.major);
  assert.equal(impactWeight(preset, 'huge'), 0, 'незнакомый уровень веса не имеет');
});

test('вес слова читается и из голого состояния, где пресет лежит внутри', () => {
  const heavy = { relations: { ...preset.relations, impact: { minor: 3, major: 5 } } };
  const lexicon = { subjects: SUBJECTS, teachers: TEACHERS, preset: heavy };
  assert.equal(rel('petrova:minor-', lexicon).events[0].delta, -3);
});

test('у всех трёх пресетов вес «сильно» больше веса «слегка» и влезает в шкалу', () => {
  for (const p of [preset, load('jp-highschool.json'), magic]) {
    const { minor, major } = p.relations.impact;
    assert.ok(minor > 0 && major > minor, `${p.id}: minor ${minor}, major ${major}`);
    assert.ok(major < p.relations.max - p.relations.min, `${p.id}: одно «сильно» проходит всю шкалу`);
  }
});

// --- 9.3.6: стоп-лист в rel= -------------------------------------------------

test('rel= к героине отклоняется — и по имени, и по id двойника в таблице', () => {
  const lex = { ...ctx, names: { user: 'Алиса Воронова' } };
  const r = rel('алиса:+1', lex);
  assert.deepEqual(r.events, []);
  assert.match(r.rejected[0].reason, /стоп-лист \(героиня\)/);

  // Генерация плана сочинила преподавательницу из анкеты — двойника героини.
  const twin = {
    ...lex,
    teachers: [...TEACHERS, { id: 'voronova', name: 'Алиса Воронова' }],
  };
  const t = rel('voronova:minor+', twin);
  assert.deepEqual(t.events, []);
  assert.match(t.rejected[0].reason, /героиня/);
});

test('rel= к рассказчику и к заведению отклоняется с причиной, а не «неизвестный»', () => {
  const lex = { ...ctx, names: { char: 'Narrator' }, survey: { institution: 'Академия Звёздного Света' } };
  assert.match(rel('narrator:+1', lex).rejected[0].reason, /стоп-лист/);
  assert.match(rel('академия:-1', lex).rejected[0].reason, /стоп-лист \(заведение\)/);
  assert.match(rel('деканат:-1', lex).rejected[0].reason, /стоп-лист \(служебное слово\)/);
});

test('карточка-преподавательница из таблицы остаётся живой', () => {
  // Чат один на один с Петровой: name2 — она сама.
  const lex = { ...ctx, names: { user: 'Алиса', char: 'Петрова Анна Сергеевна' } };
  assert.deepEqual(rel('petrova:major+', lex).events, [
    { kind: 'rel', teacherId: 'petrova', delta: preset.relations.impact.major, impact: 'major' },
  ]);
  // А карточка, которой нет в таблице («Смирнова»), — по-прежнему стоп.
  const other = { ...lex, names: { char: 'Смирнова' } };
  assert.match(rel('смирнова:+1', other).rejected[0].reason, /стоп-лист \(карточка\)/);
});

test('без имён стоп-лист держится на заведении и словах пресета, остальное как было', () => {
  assert.match(rel('рассказчик:+1').rejected[0].reason, /стоп-лист/);
  assert.deepEqual(rel('petrova:+1').events, [{ kind: 'rel', teacherId: 'petrova', delta: 1 }]);
  assert.match(rel('сидоров:+1').rejected[0].reason, /неизвестный преподаватель/);
});

test('готовый стоп-лист можно передать вместо имён', () => {
  const lex = { ...ctx, stop: [{ name: 'Гринёв', norm: 'гринев', tokens: ['гринев'], kind: 'user' }] };
  assert.match(rel('grinev:+1', lex).rejected[0].reason, /героиня/);
});

// --- 9.3.5: антиинфляция, модуль ----------------------------------------------

const base = (day = '2024-09-03') => {
  const s = createState(preset, { startDay: '2024-09-02', teachers: TEACHERS, subjects: SUBJECTS });
  s.calendar.day = day;
  return s;
};

/** Серия ответов с одной и той же меткой; возвращает, что погашено на каждом. */
function streak(state, list, p = preset, ctxOf = () => ({})) {
  let s = state;
  const damped = [];
  list.forEach((events, i) => {
    const r = dampRepeats(s, events, p, ctxOf(i));
    s = r.state;
    damped.push(r.damped.map((d) => d.teacherId));
  });
  return { state: s, damped };
}

const up = [{ teacherId: 'petrova', delta: 1 }];

test('repeatLimit из пресета, мусор и ноль — умолчание', () => {
  assert.equal(repeatLimit(preset), preset.relations.repeatLimit);
  assert.equal(repeatLimit(null), DEFAULT_REPEAT_LIMIT);
  assert.equal(repeatLimit({ relations: { repeatLimit: 0 } }), DEFAULT_REPEAT_LIMIT);
  assert.equal(repeatLimit({ relations: { repeatLimit: 1.5 } }), DEFAULT_REPEAT_LIMIT);
});

test('одинаковая дельта сверх лимита подряд гасится, пока длится серия', () => {
  const limit = repeatLimit(preset);
  const n = limit + 3;
  const { damped } = streak(base(), Array.from({ length: n }, () => up));
  const expected = Array.from({ length: n }, (_, i) => (i < limit ? [] : ['petrova']));
  assert.deepEqual(damped, expected);
});

test('ответ без rel= к наставнику обрывает серию', () => {
  const limit = repeatLimit(preset);
  const list = [...Array.from({ length: limit }, () => up), [], up];
  const { damped } = streak(base(), list);
  assert.deepEqual(damped.at(-1), [], 'после паузы +1 снова применяется');
});

test('другая дельта обрывает серию; противоположный знак — тоже', () => {
  const limit = repeatLimit(preset);
  const same = Array.from({ length: limit }, () => up);
  assert.deepEqual(streak(base(), [...same, [{ teacherId: 'petrova', delta: 2 }]]).damped.at(-1), []);
  assert.deepEqual(streak(base(), [...same, [{ teacherId: 'petrova', delta: -1 }]]).damped.at(-1), []);
});

test('новый день — новое событие: серия начинается заново', () => {
  const limit = repeatLimit(preset);
  let s = streak(base('2024-09-03'), Array.from({ length: limit }, () => up)).state;
  s.calendar.day = '2024-09-04';
  const r = dampRepeats(s, up, preset);
  assert.deepEqual(r.damped, []);
  assert.equal(r.state.relStreak.petrova.count, 1);
});

test('событие по предмету наставника в том же ответе серию не гасит', () => {
  const limit = repeatLimit(preset);
  const n = limit + 2;
  const { damped } = streak(base(), Array.from({ length: n }, () => up), preset, () => ({ fresh: ['petrova'] }));
  assert.ok(damped.every((d) => d.length === 0), 'три пятёрки подряд — не инфляция');
});

test('событие по ЧУЖОМУ предмету серию не обрывает', () => {
  const limit = repeatLimit(preset);
  const { damped } = streak(base(), Array.from({ length: limit + 1 }, () => up), preset, () => ({ fresh: ['grinev'] }));
  assert.deepEqual(damped.at(-1), ['petrova']);
});

test('серии разных наставников независимы', () => {
  const limit = repeatLimit(preset);
  const both = [{ teacherId: 'petrova', delta: 1 }, { teacherId: 'grinev', delta: -1 }];
  const { damped } = streak(base(), Array.from({ length: limit + 1 }, () => both));
  assert.deepEqual(damped.at(-1).sort(), ['grinev', 'petrova']);
});

test('два rel= к одному наставнику в ответе — одна сумма, гасится целиком', () => {
  const limit = repeatLimit(preset);
  const twice = [{ teacherId: 'petrova', delta: 1 }, { teacherId: 'petrova', delta: 1 }];
  let s = base();
  let last;
  for (let i = 0; i <= limit; i += 1) {
    last = dampRepeats(s, twice, preset);
    s = last.state;
  }
  assert.equal(s.relStreak.petrova.delta, 2);
  assert.deepEqual(last.events, [], 'оба события ответа погашены');
});

test('гашение пишется в журнал без from/to — «Люди» и хроника его не видят', () => {
  const limit = repeatLimit(preset);
  const { state } = streak(base(), Array.from({ length: limit + 1 }, () => up));
  const e = state.journal.filter((x) => x.kind === 'rel' && x.data && x.data.damped);
  assert.equal(e.length, 1);
  assert.equal(e[0].data.from, undefined);
  assert.equal(e[0].data.to, undefined);
});

test('пресет с лимитом 1 гасит уже второй одинаковый ответ', () => {
  assert.equal(magic.relations.repeatLimit, 1);
  const { damped } = streak(base(), [up, up], magic);
  assert.deepEqual(damped, [[], ['petrova']]);
});

test('teachersOfSubjects: предметы → наставники без повторов и без пустот', () => {
  const s = base();
  assert.deepEqual(teachersOfSubjects(s, ['chemistry', 'physics', 'chemistry', 'nope']), ['petrova', 'grinev']);
});

// --- 9.3.5: сквозь движок -----------------------------------------------------

function semester() {
  const s = createState(preset, {
    startDay: '2024-09-02',
    subjects: SUBJECTS,
    teachers: TEACHERS,
    schedule: buildSchedule(SUBJECTS, preset),
  });
  s.started = true;
  return s;
}

const say = (s, body, opts) => applyResponse(s, `Сцена.\n<!-- [ACADEMY ${body}] -->`, preset, opts);

test('движок: светская беседа с одной и той же меткой не раскачивает отношение', () => {
  const limit = repeatLimit(preset);
  let s = semester();
  let out;
  for (let i = 0; i < limit + 4; i += 1) {
    out = say(s, 't=+0 rel=petrova:minor+');
    s = out.state;
  }
  assert.equal(relationOf(s, 'petrova'), limit * preset.relations.impact.minor);
  const last = out.debug.applied.find((a) => a.kind === 'rel');
  assert.equal(last.damped, true);
  assert.equal(last.impact, 'minor');
  assert.match(describeApplied(last, preset.vocab), /погашено/);
  assert.match(describeApplied(last, preset.vocab), /\(minor\)/);
});

test('движок: оценка по предмету наставника делает повтор законным', () => {
  const limit = repeatLimit(preset);
  let s = semester();
  for (let i = 0; i < limit + 2; i += 1) s = say(s, 't=+0 grade=chemistry:5 rel=petrova:+1').state;
  assert.equal(relationOf(s, 'petrova'), limit + 2);
});

test('движок: ответ без метки про наставника обрывает серию', () => {
  const limit = repeatLimit(preset);
  let s = semester();
  for (let i = 0; i < limit; i += 1) s = say(s, 't=+0 rel=petrova:+1').state;
  s = say(s, 't=+0').state;
  s = say(s, 't=+0 rel=petrova:+1').state;
  assert.equal(relationOf(s, 'petrova'), limit + 1);
});

test('движок: стоп-лист из opts.names доходит до разбора метки', () => {
  const out = say(semester(), 't=+0 rel=alice:+1 rel=petrova:+1', { names: { user: 'Alice', char: 'Narrator' } });
  assert.equal(relationOf(out.state, 'petrova'), 1);
  assert.equal(out.rejected.length, 1);
  assert.match(out.rejected[0].reason, /героиня/);
});

test('движок: название заведения из анкеты попадает в стоп-лист без opts.names', () => {
  const s = semester();
  s.survey.institution = 'Хогвартс';
  const out = say(s, 't=+0 rel=хогвартс:-1');
  assert.match(out.rejected[0].reason, /заведение/);
});

// test/gender — род героя/героини (пункт O1): пары в пресетах, резолвер, анкета,
// сцена и промпты в мужском роде.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  heroGender, heroWords, resolveGendered, resolvePreset, presetGender, checkGendered, isGenderedPair, femaleForms,
} from '../core/gender.mjs';
import { normalizePreset, BUILTIN_PRESETS } from '../core/preset.mjs';
import { createState } from '../core/state.mjs';
import { notableFact, dealText, sceneAbout } from '../core/scene.mjs';
import { buildAnalysisPrompt } from '../core/analysis.mjs';
import { milestoneName, milestoneTitle, KINDS } from '../core/milestones.mjs';
import { parsePreset } from './preset-file.mjs';

const read = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));
const RAW = Object.fromEntries(BUILTIN_PRESETS.map((id) => [id, read(id)]));

const pair = { female: 'она вернулась', male: 'он вернулся' };

test('heroGender: анкета главнее имени, имя главнее умолчания', () => {
  assert.equal(heroGender({ survey: { gender: 'm' } }, 'Анна'), 'm');
  assert.equal(heroGender({ survey: { gender: 'f' } }, 'Никита'), 'f');
  assert.equal(heroGender({ survey: { gender: '' } }, 'Никита'), 'm');
  assert.equal(heroGender({ survey: {} }, 'Анна'), 'f');
  assert.equal(heroGender(null, 'Саша'), 'f', 'имя не сказало — женский, как до поддержки рода');
  assert.equal(heroGender(undefined), 'f');
});

test('resolveGendered: пара выбирается по роду, строки и числа не трогаются, исходник цел', () => {
  const tree = { a: pair, b: 'ровно', n: 3, list: [pair, 'x'], deep: { c: pair } };
  const f = resolveGendered(tree, 'f');
  const m = resolveGendered(tree, 'm');
  assert.deepEqual(f, { a: 'она вернулась', b: 'ровно', n: 3, list: ['она вернулась', 'x'], deep: { c: 'она вернулась' } });
  assert.deepEqual(m, { a: 'он вернулся', b: 'ровно', n: 3, list: ['он вернулся', 'x'], deep: { c: 'он вернулся' } });
  assert.deepEqual(tree.a, pair, 'исходный объект не изменён');
  assert.equal(resolveGendered({ a: { female: 'только она' } }, 'm').a, 'только она', 'нет мужской половины — берётся другая');
  assert.equal(isGenderedPair({ female: 'a', male: 'b', other: 1 }), false);
});

test('resolvePreset помечает род, presetGender его читает', () => {
  assert.equal(presetGender(resolvePreset({ a: pair }, 'm')), 'm');
  assert.equal(presetGender(resolvePreset({ a: pair }, 'f')), 'f');
  assert.equal(presetGender({}), 'f');
  assert.equal(presetGender(null), 'f');
  assert.equal(heroWords('m').hero, 'герой');
  assert.equal(heroWords('f').herDat, 'ей');
});

test('checkGendered: нет мужской половины, пустая строка и разные плейсхолдеры — претензии', () => {
  assert.deepEqual(checkGendered({ a: pair }), []);
  assert.equal(checkGendered({ v: { x: { female: 'она' } } }).length, 1);
  assert.equal(checkGendered({ x: { female: 'она', male: '  ' } }).length, 1);
  assert.equal(checkGendered({ x: { female: 'у {teacher}', male: 'у {subject}' } }).length, 1);
  assert.deepEqual(checkGendered({ x: { female: 'у {teacher} она', male: 'у {teacher} он' } }), []);
});

test('normalizePreset: пара без male отвергается, с обеими половинами проходит', () => {
  const builtins = RAW;
  const bad = structuredClone(RAW['ru-school']);
  bad.id = 'custom-bad';
  bad.vocab.expelled = { female: 'исключена' };
  const res = normalizePreset(bad, { builtins, basedOn: 'ru-school' });
  assert.equal(res.ok, false);
  assert.match(res.message, /vocab\.expelled/);
  const good = structuredClone(RAW['ru-school']);
  good.id = 'custom-good';
  good.vocab.expelled = { female: 'исключена', male: 'исключён' };
  const ok = normalizePreset(good, { builtins, basedOn: 'ru-school' });
  assert.equal(ok.ok, true, ok.message);
  assert.deepEqual(ok.preset.vocab.expelled, { female: 'исключена', male: 'исключён' }, 'пресет хранит пару, разрешает index.js');
});

test('каждый встроенный пресет: пары есть, структура у обоих разрешений одна, плейсхолдеры сходятся', () => {
  for (const id of BUILTIN_PRESETS) {
    const raw = RAW[id];
    assert.deepEqual(checkGendered(raw), [], id);
    const f = resolveGendered(raw, 'f');
    const m = resolveGendered(raw, 'm');
    assert.deepEqual(Object.keys(f.vocab), Object.keys(m.vocab), id);
    assert.deepEqual(Object.keys(f.ui), Object.keys(m.ui), id);
    assert.ok(JSON.stringify(raw).includes('"male"'), `${id}: нет ни одной пары`);
    assert.notDeepEqual(f.vocab.expelled, m.vocab.expelled, `${id}: expelled`);
    assert.equal(JSON.stringify(f).includes('"female"'), false, id);
  }
});

test('пресет в мужском роде: в ключевых текстах нет женских форм', () => {
  const keys = [
    (p) => p.vocab.expelled,
    (p) => p.vocab.warnInject,
    (p) => p.reputation.labels[0].label,
    (p) => p.ui.expelledTag,
    (p) => p.ui.expelledLine,
    (p) => p.phrases.milestones.favorite,
    (p) => p.phrases.milestoneTitles.favorite,
    (p) => p.phrases.milestoneHints.nemesis,
    (p) => p.phrases.lorebook.teacher,
    (p) => p.relations.labels[p.relations.labels.length - 1].label,
  ];
  for (const id of BUILTIN_PRESETS) {
    const m = resolvePreset(RAW[id], 'm');
    for (const get of keys) {
      const text = get(m);
      assert.equal(typeof text, 'string', id);
      assert.deepEqual(femaleForms(text), [], `${id}: «${text}»`);
    }
    for (const kind of KINDS) {
      assert.deepEqual(femaleForms(milestoneTitle(kind, m)), [], `${id}: веха ${kind}`);
    }
  }
});

test('вехи: «Любимица» в женском роде, «Любимец» в мужском, у каждого пресета свои слова', () => {
  const f = parsePreset(JSON.stringify(RAW['ru-university']));
  const m = resolvePreset(RAW['ru-university'], 'm');
  assert.equal(milestoneTitle('favorite', f), 'Любимица кафедры');
  assert.equal(milestoneTitle('favorite', m), 'Любимец кафедры');
  const st = createState(m, { startDay: '2026-09-01' });
  assert.match(milestoneName({ kind: 'favorite', teacherId: 'x' }, st, m), /^Любимец:/);
});

test('сцена в мужском роде: прогул, дело и «был в сцене» без женских окончаний', () => {
  const preset = resolvePreset(RAW['ru-university'], 'm');
  const state = createState(preset, { startDay: '2026-09-01', survey: { gender: 'm' } });
  const absent = { kind: 'attendance', status: 'absent', subjectId: 'math' };
  assert.equal(notableFact(absent, state, preset, { heroine: 'Аня' }).gist, 'Аня прогулял «math»', 'род — из анкеты, а не из имени');
  assert.equal(notableFact(absent, state, preset, {}).gist.startsWith('герой '), true);
  const people = [{ id: 'vera', name: 'Вера Соколова' }];
  const deal = { kind: 'deal', a: '@heroine', b: 'vera', what: 'вернуть тетрадь' };
  assert.match(dealText(deal, people, 'Игорь', 'm'), /^Игорь должен Вере/);
  assert.match(dealText(deal, people, 'Игорь', 'f'), /^Игорь должна Вере/);
  assert.equal(sceneAbout({ kind: 'met', personId: '@heroine' }, people, 'Аня', 'm'), 'Аня был в сцене');
  const sf = createState(preset, { startDay: '2026-09-01' });
  assert.equal(notableFact(absent, sf, preset, { heroine: 'Аня' }).gist, 'Аня прогуляла «math»', 'женское имя без выбора — женский род');
});

test('промпт секретаря: «героиня/сдала» у героини, «герой/сдал» у героя', () => {
  const f = resolvePreset(RAW['ru-school'], 'f');
  const m = resolvePreset(RAW['ru-school'], 'm');
  const sf = createState(f, { startDay: '2026-09-01' });
  const sm = createState(m, { startDay: '2026-09-01', survey: { gender: 'm' } });
  const pf = buildAnalysisPrompt(sf, f, { reply: 'Ответ.' });
  const pm = buildAnalysisPrompt(sm, m, { reply: 'Ответ.' });
  assert.match(pf.system, /студентку/);
  assert.match(pm.system, /студента/);
  assert.match(pf.user, /героини|героиня/);
  assert.equal(/героин/.test(pm.user + pm.system), false, 'в мужском промпте нет «героиня»');
  assert.match(pm.user, /прогулял пару; late — опоздал/);
  assert.match(pf.user, /прогуляла пару; late — опоздала/);
  assert.deepEqual(femaleForms(pm.user.replace(/Ответ рассказчика[\s\S]*$/, '')).filter((w) => !['она'].includes(w)), []);
});

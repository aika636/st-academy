// tools/gender-scan — где в пресете ещё женский род героини.
//
//   node tools/gender-scan.mjs presets/us-college.json
//
// Три списка:
//   1. «ошибки» — в мужской половине пары остались женские формы (она, её,
//      героиня, сдала, отчислена…): это недоделанный перевод;
//   2. «кандидаты» — обычные строки (не пары) с женскими формами. Часть из них
//      про преподавателей и сокурсниц — их род не меняется; остальные про героя и
//      должны стать парами `{female, male}`;
//   3. «одинаковые пары» — female совпадает с male: пара не нужна.
//
// Эвристика грубая (`core/gender.femaleForms`): прилагательные и «любимая ученица»
// она не видит, их ищут глазами.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { femaleForms, isGenderedPair } from '../core/gender.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/gender-scan.mjs presets/<id>.json');
  process.exit(2);
}
const preset = JSON.parse(readFileSync(resolve(file), 'utf8'));

const errors = [];
const candidates = [];
const same = [];
let pairs = 0;

const walk = (v, path) => {
  if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`)); return; }
  if (typeof v === 'string') {
    const f = femaleForms(v);
    if (f.length) candidates.push(`${path}: ${[...new Set(f)].join(', ')}\n      ${v.slice(0, 220)}`);
    return;
  }
  if (!v || typeof v !== 'object') return;
  if (isGenderedPair(v)) {
    pairs += 1;
    const f = femaleForms(v.male);
    if (f.length) errors.push(`${path}.male: ${[...new Set(f)].join(', ')}\n      ${String(v.male).slice(0, 220)}`);
    if (v.female === v.male) same.push(path);
    return;
  }
  for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
};
walk(preset, '');

console.log(`${file}: пар ${pairs}`);
console.log(`\nошибки (женское в male): ${errors.length}`);
for (const e of errors) console.log(`  - ${e}`);
console.log(`\nодинаковые пары: ${same.length}`);
for (const e of same) console.log(`  - ${e}`);
console.log(`\nкандидаты (обычные строки с женскими формами): ${candidates.length}`);
for (const e of candidates) console.log(`  - ${e}`);
process.exit(errors.length || same.length ? 1 : 0);

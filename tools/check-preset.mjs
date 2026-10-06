// tools/check-preset — проверка пресета перед тем, как он станет встроенным.
//
//   node tools/check-preset.mjs presets/us-college.json
//
// Пресет проходит настоящую нормализацию ядра (с пробным прогоном), а сверх
// неё — полноту словарей: всё, что тесты требуют от встроенных пресетов, плюс
// праздники. Образец полноты — русский вуз: ключ, который есть у него, должен
// быть и у нового пресета, иначе панель заговорит словами вуза.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { normalizePreset } from '../core/preset.mjs';
import { KINDS } from '../core/milestones.mjs';
import { holidaysOf } from '../core/holidays.mjs';
import { DEFAULT_UI } from '../ui.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/check-preset.mjs presets/<id>.json');
  process.exit(2);
}

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const ru = read(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)));
let raw;
try {
  raw = read(resolve(file));
} catch (err) {
  console.error(`не читается как JSON: ${err.message}`);
  process.exit(1);
}

const problems = [];
const need = (cond, msg) => { if (!cond) problems.push(msg); };
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

// Верхние ключи и словари — не меньше, чем у образца.
for (const k of Object.keys(ru)) need(k in raw, `нет верхнего ключа «${k}»`);
for (const section of ['vocab', 'labels', 'prompts']) {
  for (const k of Object.keys(ru[section] || {})) {
    need(raw[section] && k in raw[section], `${section}: нет ключа «${k}»`);
  }
}
for (const k of Object.keys(DEFAULT_UI)) need(raw.ui && k in raw.ui, `ui: нет ключа «${k}»`);
for (const k of Object.keys((ru.ui && ru.ui.phases) || {})) {
  need(raw.ui && raw.ui.phases && k in raw.ui.phases, `ui.phases: нет ключа «${k}»`);
}
for (const k of Object.keys(ru.phrases || {})) {
  for (const kk of Object.keys(ru.phrases[k] || {})) {
    need(raw.phrases && raw.phrases[k] && kk in raw.phrases[k], `phrases.${k}: нет ключа «${kk}»`);
  }
}
for (const dict of ['milestones', 'milestoneTitles', 'milestoneHints']) {
  for (const kind of KINDS) {
    need(raw.phrases && raw.phrases[dict] && isStr(raw.phrases[dict][kind]), `phrases.${dict}: нет «${kind}»`);
  }
}

// Праздники.
const holidays = holidaysOf(raw);
need(Array.isArray(raw.holidays), 'holidays: нужен список');
need(holidays.length >= 8, `holidays: праздников ${holidays.length}, нужно хотя бы 8`);
need(holidays.length === (raw.holidays || []).length, 'holidays: часть записей битая (нет name или from в виде ММ-ДД)');
const ids = new Set();
for (const h of raw.holidays || []) {
  need(isStr(h.id), `holidays: у «${h.name}» нет id`);
  need(!ids.has(h.id), `holidays: id «${h.id}» повторяется`);
  ids.add(h.id);
  for (const f of ['about', 'buzz', 'today']) need(isStr(h[f]), `holidays: у «${h.name}» нет ${f}`);
  if (isStr(h.buzz)) need(!/\d/.test(h.buzz), `holidays: в buzz «${h.name}» цифры — строка состояния бережёт числа`);
  if (isStr(h.today)) need(!/\d/.test(h.today), `holidays: в today «${h.name}» цифры — строка состояния бережёт числа`);
}

// Настоящая нормализация с пробным прогоном ядра.
const res = normalizePreset(raw, { builtins: { 'ru-university': ru } });
if (!res.ok) problems.push(`нормализация: ${res.message}`);

if (problems.length) {
  console.log(`✖ ${file}: ${problems.length} замечаний`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log(`✔ ${file}: пресет «${raw.displayName}» в порядке, праздников ${holidays.length}`);
if (res.warnings.length) console.log(`  предупреждения: ${res.warnings.join('; ')}`);

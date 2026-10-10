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
import { resolveGendered, checkGendered, isGenderedPair, femaleForms } from '../core/gender.mjs';
import { KINDS } from '../core/milestones.mjs';
import { holidaysOf, vacationsOf, mergeVacations } from '../core/holidays.mjs';
import { DEFAULT_UI, PRESET_UI_WORDS } from '../ui.js';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/check-preset.mjs presets/<id>.json');
  process.exit(2);
}

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const ruSrc = read(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)));
// Полнота словарей сверяется на женском разрешении: пара — это одна строка.
const ru = resolveGendered(ruSrc, 'f');
let src;
let raw;
try {
  src = read(resolve(file));
  raw = resolveGendered(src, 'f');
} catch (err) {
  console.error(`не читается как JSON: ${err.message}`);
  process.exit(1);
}

const problems = [];
const need = (cond, msg) => { if (!cond) problems.push(msg); };

// Пары рода (`core/gender`): обе половины непустые, плейсхолдеры те же, в мужской
// половине нет женских форм.
problems.push(...checkGendered(src));
const maleNotes = [];
const maleWalk = (v, path) => {
  if (Array.isArray(v)) { v.forEach((x, i) => maleWalk(x, `${path}[${i}]`)); return; }
  if (!v || typeof v !== 'object') return;
  if (isGenderedPair(v)) {
    const f = femaleForms(v.male);
    // Эвристика грубая («приняла комиссия» — не про героя), поэтому только к сведению.
    if (f.length) maleNotes.push(`${path}.male: похоже на женские формы (${[...new Set(f)].join(', ')})`);
    return;
  }
  for (const [k, x] of Object.entries(v)) maleWalk(x, path ? `${path}.${k}` : k);
};
maleWalk(src, '');
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

// Верхние ключи и словари — не меньше, чем у образца.
for (const k of Object.keys(ru)) need(k in raw, `нет верхнего ключа «${k}»`);
for (const section of ['vocab', 'labels', 'prompts']) {
  for (const k of Object.keys(ru[section] || {})) {
    need(raw[section] && k in raw[section], `${section}: нет ключа «${k}»`);
  }
}
for (const k of Object.keys(DEFAULT_UI)) need(raw.ui && k in raw.ui, `ui: нет ключа «${k}»`);
// Свои слова ленты, плашки и фона (решение владелицы Р6): без них сеттинг
// заговорил бы «на курсе» и «кто-то с курса» вуза. `vocab.crowdIn` и
// `vocab.someone` проверяет сверка словарей выше — они есть у образца.
for (const k of PRESET_UI_WORDS) need(raw.ui && isStr(raw.ui[k]), `ui: нет своего слова «${k}»`);
for (const k of ['crowdIn', 'someone']) need(raw.vocab && isStr(raw.vocab[k]), `vocab: нет своего слова «${k}»`);
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

// Курс (шаг 2): размер и роли-зёрна по смыслу сеттинга, ярлыки отношения
// однокурсника к героине на той же шкале, что у преподавателей.
const course = raw.classmates || {};
need(Number.isInteger(course.size) && course.size >= 1 && course.size <= 12, 'classmates.size: целое от 1 до 12');
const seeds = Array.isArray(course.seeds) ? course.seeds : [];
need(seeds.length >= 6 && seeds.length <= 8, `classmates.seeds: ролей ${seeds.length}, нужно 6–8`);
need(seeds.every(isStr) && new Set(seeds).size === seeds.length, 'classmates.seeds: пустые роли или повторы');
need(seeds.every((s) => typeof s === 'string' && s.length <= 40), 'classmates.seeds: роль длиннее 40 символов');
const labels = Array.isArray(course.labels) ? course.labels : [];
const scale = raw.relations || {};
need(labels.length > 0 && labels.every((l) => l && typeof l.upTo === 'number' && isStr(l.label)), 'classmates.labels: нужен список {upTo, label}');
if (labels.length) {
  need(labels.every((l, i) => i === 0 || l.upTo > labels[i - 1].upTo), 'classmates.labels: upTo по возрастанию');
  need(labels[labels.length - 1].upTo >= scale.max, 'classmates.labels: последняя ступень не покрывает верх шкалы relations');
}

// Лента (шаг 3): потолок реакций на разбор — необязательный, но если задан,
// то целое 1–12 (умолчание ядра — 6).
if (raw.feed !== undefined) {
  const cap = raw.feed && raw.feed.reactionCap;
  need(raw.feed && typeof raw.feed === 'object' && !Array.isArray(raw.feed), 'feed: нужен объект {reactionCap}');
  if (cap !== undefined) need(Number.isInteger(cap) && cap >= 1 && cap <= 12, `feed.reactionCap: ${cap} — нужно целое от 1 до 12`);
}

// Праздник и каникулы с тем же именем в те же дни ядро показывает одним
// событием (`holidays.mergeVacations`). Это не ошибка, но автору пресета
// стоит знать, что вторая запись не видна сама по себе, — и что сроки, если
// они расходятся, сольются в общий.
const notes = [];
for (const { holiday, vacation } of mergeVacations(holidays, vacationsOf(raw)).pairs) {
  const same = holiday.from === vacation.from && holiday.to === vacation.to;
  notes.push(`праздник «${holiday.name}» и каникулы «${vacation.name}» — одно событие`
    + (same ? '' : ` (сроки ${holiday.from}…${holiday.to} и ${vacation.from}…${vacation.to} сольются в общий)`));
}

// Подсказки ⓘ (`glossary`): слово должно быть видно в интерфейсе, иначе
// подсказка не покажется. Проверка грубая — слово ищется в тексте пресета вне
// самого словаря; не нашлось — не ошибка, а повод перечитать (слово могли
// переименовать).
if (raw.glossary !== undefined) {
  const { glossary, ...rest } = raw;
  const text = JSON.stringify(rest).toLowerCase().replace(/ё/g, 'е');
  for (const word of Object.keys(glossary || {})) {
    if (!text.includes(word.toLowerCase().replace(/ё/g, 'е'))) notes.push(`glossary: слова «${word}» нет в тексте пресета — подсказка не покажется`);
  }
}

// Настоящая нормализация с пробным прогоном ядра.
const res = normalizePreset(src, { builtins: { 'ru-university': ruSrc } });
if (!res.ok) problems.push(`нормализация: ${res.message}`);

if (problems.length) {
  console.log(`✖ ${file}: ${problems.length} замечаний`);
  for (const p of problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log(`✔ ${file}: пресет «${raw.displayName}» в порядке, праздников ${holidays.length}`);
if (res.warnings.length) console.log(`  предупреждения: ${res.warnings.join('; ')}`);
for (const n of notes) console.log(`  к сведению: ${n}`);
for (const n of maleNotes) console.log(`  к сведению: ${n}`);

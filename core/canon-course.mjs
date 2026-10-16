import { extractJson, fill } from './plan-gen.mjs';
import { presetGender } from './gender.mjs';
import { CLASSMATE_TEXT_MAX, normalizeAliases, normalizeToHero } from './classmates.mjs';
import { normName } from './stop-names.mjs';
import { LOOKS_MAX } from './portraits.mjs';

const one = (v, max) => (typeof v === 'string' || typeof v === 'number'
  ? String(v).replace(/\s+/g, ' ').trim().slice(0, max).trim() : '');

function pickOf(src, names) {
  for (const n of names) {
    const v = Array.isArray(src[n]) ? src[n].join(', ') : src[n];
    if (typeof v === 'string' || typeof v === 'number') return v;
  }
  return '';
}

export function buildCanonCoursePrompt(state, preset, opts = {}) {
  const s = (state && state.survey) || {};
  const male = presetGender(preset) === 'm';
  const count = Number.isInteger(opts.count) && opts.count > 0 ? opts.count : 6;
  const known = [...new Set((opts.known || []).map((n) => one(n, 80)).filter(Boolean))];
  const named = [...new Set((opts.names || []).map((n) => one(n, 80)).filter(Boolean))];
  const card = [].concat(opts.card || []).map((n) => one(n, 80)).filter(Boolean).join(', ');
  const vars = {
    canon: one(s.canon, 120), count,
    institution: one(s.institution, 80), faculty: one(s.faculty, 80), year: one(s.year, 40), era: one(s.era, 80),
    hero: male ? 'героя' : 'героини', heroName: one(opts.heroName, 80),
  };
  return {
    system: 'Ты знаток известных произведений и составляешь списки их персонажей. Отвечай одним JSON-массивом и ничем больше: без пояснений, без markdown.',
    user: [
      fill('Мир игры — канон: {canon}. Заведение: {institution}; направление, факультет или класс: {faculty}; курс: {year}; эпоха: {era}.', vars),
      named.length
        ? `Опиши по канону этих людей, ровно на этот учебный год: ${named.join(', ')}. Кого не знаешь по канону — пропусти, не выдумывай.`
        : `Назови до ${count} канонических ровесников ${vars.hero}${vars.heroName ? ` (${vars.heroName})` : ''} — учеников того же курса, ровно на этот учебный год: не только своего факультета или класса, но и других — соперников, недоброжелателей и тех, кто близок к ${card || 'главным героям канона'}.`,
      'Только люди из канона; не знаешь канон хорошо — называй меньше людей, но не выдумывай. Не преподаватели и не персонал, не сама героиня. В этой игре все они совершеннолетние (18+), даже если по канону младше: в looks возраст — не меньше 18.',
      `Если по канону человек влюблён, встречается или помолвлен с кем-то из главных${card ? ` (${card})` : ''}, начни desire с этого: «влюблена в <имя>…».`,
      'name — имя в том русском переводе, каким ты его обычно пишешь; aliases — другие написания (второй перевод, оригинал латиницей); desire и problem — одна короткая строка каждая, по канону; club — кружок, команда или отряд, если есть, иначе пустая строка; looks — внешность для портрета по канону: начни с того, кто это и сколько лет («девушка 20 лет», «юноша 19 лет»), дальше волосы, лицо, одежда, приметы, до 160 символов; manner — как пишет в чате курса, по канону: длина реплик, грамотность и регистр, словарь, прямота или грубость, юмор (Крэбб — коротко, грубо, простыми словами), до 140 символов, приметы письма, а не характер; toHero — предположение, как он по характеру и положению в каноне отнёсся бы к новой героине (канон о ней молчит), одно слово: близкий, друг, влюблён, нейтрально, недолюбливает, враг, задира (склонен травить таких); не уверен — пусто.',
      known.length && !named.length ? `Уже есть, их не повторяй: ${known.join(', ')}.` : '',
      'Формат: [{"name":"","aliases":[],"desire":"","problem":"","club":"","looks":"","manner":"","toHero":""}]',
    ].filter(Boolean).join('\n'),
  };
}

export function parseCanonCourse(text) {
  const data = typeof text === 'string' ? extractJson(text) : text;
  if (data === undefined || data === null) return null;
  const rows = Array.isArray(data) ? data
    : ['people', 'classmates', 'students', 'characters', 'peers'].map((k) => data[k]).find(Array.isArray);
  if (!rows) return null;
  const out = [];
  const seen = new Set();
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const name = one(pickOf(r, ['name', 'fullName', 'имя']), CLASSMATE_TEXT_MAX.name);
    const key = normName(name);
    if (!name || seen.has(key)) continue;
    seen.add(key);
    const p = { name, aliases: normalizeAliases(pickOf(r, ['aliases', 'alias', 'altNames', 'otherNames']), name) };
    for (const [field, names] of [['desire', ['desire', 'wants', 'goal', 'желание']], ['problem', ['problem', 'trouble', 'проблема']], ['club', ['club', 'team', 'кружок']]]) {
      p[field] = one(pickOf(r, names), CLASSMATE_TEXT_MAX[field]);
    }
    const looks = one(pickOf(r, ['looks', 'appearance', 'look', 'внешность']), LOOKS_MAX);
    if (looks) p.looks = looks;
    const manner = one(pickOf(r, ['manner', 'writing', 'style', 'как пишет']), CLASSMATE_TEXT_MAX.manner);
    if (manner) p.manner = manner;
    const canonHero = normalizeToHero(pickOf(r, ['toHero', 'to_hero', 'attitude', 'canonHero']));
    if (canonHero) p.canonHero = canonHero;
    out.push(p);
  }
  return out;
}

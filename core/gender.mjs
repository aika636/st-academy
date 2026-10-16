const MALE_A = new Set(['никита', 'илья', 'миша', 'гоша', 'леша', 'паша', 'дима', 'ваня', 'петя', 'коля', 'вася',
  'сережа', 'митя', 'костя', 'толя', 'юра', 'федя', 'гриша', 'кузьма', 'фома', 'савва', 'лука', 'данила',
  'гаврила', 'тема', 'вова', 'сеня', 'боря', 'лева', 'гена', 'жора', 'степа', 'валера', 'рома', 'кеша', 'яша', 'алеша']);

const BOTH_A = new Set(['саша', 'женя', 'слава', 'валя', 'шура', 'тоша', 'сима']);

export function firstWord(name) {
  return String(name || '').trim().split(/\s+/)[0] || '';
}

export function genderOfName(name) {
  const low = firstWord(name).toLowerCase().replace(/ё/g, 'е');
  if (!/^[а-я-]+$/.test(low)) return null;
  if (BOTH_A.has(low)) return null;
  if (/[ая]$/.test(low)) return MALE_A.has(low) ? 'm' : 'f';
  if (/(?:[бвгджзклмнпрстфхцчшщ]|[еаиоу]й)$/.test(low)) return 'm';
  return null;
}

export const GENDERS = ['f', 'm'];

export function heroGender(state, name = '') {
  const chosen = state && state.survey && state.survey.gender;
  if (GENDERS.includes(chosen)) return chosen;
  return genderOfName(name) || 'f';
}

const WORDS = {
  f: { hero: 'героиня', heroAcc: 'героиню', heroGen: 'героини', heroDat: 'героине', heroIns: 'героиней',
    she: 'она', her: 'её', herDat: 'ей', herAcc: 'её', herIns: 'ею', herPrep: 'ней' },
  m: { hero: 'герой', heroAcc: 'героя', heroGen: 'героя', heroDat: 'герою', heroIns: 'героем',
    she: 'он', her: 'его', herDat: 'ему', herAcc: 'его', herIns: 'им', herPrep: 'нём' },
};

export function heroWords(gender = 'f') {
  return WORDS[gender === 'm' ? 'm' : 'f'];
}

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

export function isGenderedPair(v) {
  if (!isPlain(v)) return false;
  const keys = Object.keys(v);
  return keys.length > 0 && keys.length <= 2 && keys.every((k) => k === 'female' || k === 'male');
}

export function resolveGendered(tree, gender = 'f') {
  const pick = gender === 'm' ? 'male' : 'female';
  const other = gender === 'm' ? 'female' : 'male';
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (!isPlain(v)) return v;
    if (isGenderedPair(v)) {
      const s = typeof v[pick] === 'string' && v[pick] ? v[pick] : v[other];
      return typeof s === 'string' ? s : '';
    }
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = walk(x);
    return out;
  };
  return walk(tree);
}

export function resolvePreset(preset, gender = 'f') {
  const g = gender === 'm' ? 'm' : 'f';
  const out = resolveGendered(preset, g);
  if (isPlain(out)) out.heroGender = g;
  return out;
}

export function presetGender(preset) {
  return preset && preset.heroGender === 'm' ? 'm' : 'f';
}

function placeholders(s) {
  return [...String(s).matchAll(/\{([A-Za-z_]\w*)\}/g)].map((m) => m[1]).sort().join(',');
}

export function checkGendered(tree) {
  const errors = [];
  const walk = (v, path) => {
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i + 1}]`)); return; }
    if (!isPlain(v)) return;
    const keys = Object.keys(v);
    if (keys.includes('female') || keys.includes('male')) {
      if (!isGenderedPair(v) || typeof v.female !== 'string' || typeof v.male !== 'string'
        || !v.female.trim() || !v.male.trim()) {
        errors.push(`${path}: пара рода — объект с непустыми строками female и male`);
      } else if (placeholders(v.female) !== placeholders(v.male)) {
        errors.push(`${path}: плейсхолдеры {…} в female и male различаются`);
      }
      return;
    }
    for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(tree, '');
  return errors;
}

const NOT_FEMALE_FORM = new Set([
  'дела', 'школа', 'скала', 'стрела', 'мгла', 'игла', 'пила', 'могила', 'села', 'зала', 'хвала', 'хула',
  'мела', 'сила', 'мила', 'людмила', 'лила', 'мыла', 'жила', 'орла', 'угла', 'числа', 'весла', 'стекла',
  'ремесла', 'крыла', 'тела', 'мала', 'гала', 'кабала', 'ла', 'ула', 'нила', 'кала', 'шила', 'гула', 'вала',
  'чучела', 'генерала', 'шкала', 'файла', 'начала', 'правила', 'крыла', 'котла', 'метала', 'зеркала', 'устройства',
  'удалась', 'записывалась', 'масла', 'горла', 'бокала', 'портала', 'капитала',
  'вокзала', 'финала', 'предела', 'балла', 'прогула', 'цикла', 'зубрила', 'приказала-бы', 'сигнала', 'канала', 'университета', 'лимитированная', 'пола', 'села', 'ковра', 'прикола',
]);

const FEMALE_WORDS = new Set([
  'она', 'её', 'ее', 'ей', 'ею', 'неё', 'нее', 'ней', 'нею', 'сама', 'самой', 'саму',
  'героиня', 'героиню', 'героине', 'героини', 'героиней',
  'студентка', 'студентку', 'студентке', 'студентки', 'студенткой',
  'ученица', 'ученицу', 'ученице', 'ученицы', 'ученицей',
  'любимица', 'любимицу', 'любимице', 'любимицы', 'избранница', 'избранницу', 'избраннице', 'избранницы',
]);

const FEMALE_SHORT = /^(?:отчисл|исключ|изгн|списан|освобожд|отстранен|лишен|наказан|предупрежд|допущен|оставлен|переведен|принят|зачислен|назначен|признан|отправлен|вызван|замечен|уличен|уволен|разжалован|снят|отозван|пойман|задержан|повышен|понижен|обязан|готов|уверен|довольн|занят|рада|вынужден|прощен|спасен|отпущен)(?:а|ена|ана|яна)?$/;
const FEMALE_SHORT_END = /(?:а)$/;

export function femaleForms(text) {
  const words = String(text || '').toLowerCase().match(/[а-яё]+/g) || [];
  const found = [];
  for (const w of words) {
    if (FEMALE_WORDS.has(w)) found.push(w);
    else if (w.length > 3 && /(?:ла|лась)$/.test(w) && !NOT_FEMALE_FORM.has(w)) found.push(w);
    else if (FEMALE_SHORT.test(w) && FEMALE_SHORT_END.test(w)) found.push(w);
  }
  return found;
}

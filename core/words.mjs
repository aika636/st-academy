const FORMS = {
  one: ['subject', 'предмет'], gen: ['subjectGen', 'предмета'], dat: ['subjectDat', 'предмету'],
  acc: ['subjectAcc', 'предмет'], many: ['subjectPlural', 'предметы'], genMany: ['subjectGenPlural', 'предметов'],
};

export function subjectWord(preset, form = 'one') {
  const vocab = (preset && preset.vocab) || {};
  const [key, fallback] = FORMS[form] || FORMS.one;
  const own = (k) => (typeof vocab[k] === 'string' ? vocab[k].trim() : '');
  return own(key) || (own('subject') ? own('subject') : fallback);
}

export function subjectVars(preset) {
  const out = {};
  for (const form of Object.keys(FORMS)) out[FORMS[form][0]] = subjectWord(preset, form);
  return out;
}

export const upFirst = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

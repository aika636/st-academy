export const CANON_VOCAB_KEYS = [
  'period', 'periodPlural', 'term', 'teacher', 'teacherPlural', 'gradebook', 'debt', 'debtPlural',
  'examPeriod', 'expulsion', 'warning', 'score', 'crowdIn', 'someone', 'expelled', 'warnInject', 'expelInject',
];
const VOCAB_WORD_MAX = 60;
const VOCAB_PHRASE_MAX = 240;

const NOT_AVERAGE = /(?:балл|очк|points?).{0,12}(?:факультет|дом[аеу]?(?![а-яё])|house)|house\s+points?/i;

export function cleanCanonVocab(v) {
  const out = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const k of CANON_VOCAB_KEYS) {
    const s = typeof v[k] === 'string' ? v[k].replace(/\s+/g, ' ').trim() : '';
    if (k === 'score' && NOT_AVERAGE.test(s)) continue;
    if (s) out[k] = s.slice(0, /Inject$/.test(k) ? VOCAB_PHRASE_MAX : VOCAB_WORD_MAX).trim();
  }
  return out;
}

export function withCanonVocab(preset, state) {
  const cv = state && state.canonVocab;
  if (!preset || !cv || typeof cv !== 'object' || !Object.keys(cv).length) return preset;
  if (!state.survey || !String(state.survey.canon || '').trim()) return preset;
  return { ...preset, vocab: { ...(preset.vocab || {}), ...cv } };
}

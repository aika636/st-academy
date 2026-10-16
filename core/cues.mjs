const HIDDEN_SPAN_RE = /<span\s+style\s*=\s*["']?\s*display\s*:\s*none\s*;?\s*["']?\s*>([\s\S]*?)(?:<\/span>|$)/gi;

const SKIP_WORD_RE = /TIME[\s_-]*SKIP/i;

const VISIBLE_RE = /^[ \t]*>[ \t]*⏩️?[^\n]*$/m;

export function readTimeSkip(text) {
  const src = typeof text === 'string' ? text : '';
  if (!src) return null;

  let note = null;
  for (const m of src.matchAll(HIDDEN_SPAN_RE)) {
    if (SKIP_WORD_RE.test(m[1])) note = m;
  }
  const visible = VISIBLE_RE.exec(src);
  if (!note && !visible) return null;

  const hay = [note ? note[1] : '', visible ? visible[0] : ''].join('\n');
  const time = durationText(hay);
  return {
    days: time ? skipDays(time) : null,
    time: time || '',
    matched: (visible ? visible[0] : note[0]).trim().slice(0, 200),
  };
}

function durationText(hay) {
  const by = /forward\s+by\s+([^\n<]+?)(?:\.\s|\.$|\n|<|$)/i.exec(hay);
  if (by && by[1].trim()) return by[1].trim();
  const passed = /Time\s+passed\s*:\s*([^\n<]+?)(?:\.\s|\.$|\n|<|$)/i.exec(hay);
  if (passed && passed[1].trim()) return passed[1].trim();
  const glass = /⏳️?\s*\(([^)\n]+)\)/.exec(hay);
  if (glass && glass[1].trim()) return glass[1].trim();
  return '';
}

const NUMBER_WORDS = {
  один: 1, одна: 1, одну: 1, одни: 1, одно: 1,
  два: 2, две: 2, пару: 2, пара: 2,
  три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  несколько: 3,
  a: 1, an: 1, one: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, few: 3, several: 3,
};

const UNITS = [
  { re: /^(?:мин|minute|min)/, days: 1 / 1440 },
  { re: /^(?:час|hour|hr)/, days: 1 / 24 },
  { re: /^(?:сут|день|дня|дней|дн|day)/, days: 1 },
  { re: /^(?:выходн|weekend)/, days: 2 },
  { re: /^(?:недел|week)/, days: 7 },
  { re: /^(?:месяц|мес\.?$|month)/, days: 30 },
  { re: /^(?:год|лет$|year)/, days: 365 },
];

const PHRASES = [
  { re: /послезавтра|day\s+after\s+tomorrow/i, days: 2 },
  { re: /завтра|tomorrow|следующ\S*\s+(?:утр|д[е]?н|вечер|ноч)|next\s+(?:morning|day|evening|night)/i, days: 1 },
  { re: /полчаса|half\s+an?\s+hour/i, days: 0 },
];

export function skipDays(str) {
  const s = String(str || '').toLowerCase().replace(/ё/g, 'е');
  if (!s.trim()) return null;

  let total = 0;
  let found = false;
  const tokens = s.split(/[^0-9a-zа-я.,]+/i).filter(Boolean);
  for (let i = 0; i < tokens.length; i += 1) {
    const unit = UNITS.find((u) => u.re.test(tokens[i]));
    if (!unit) continue;
    const prev = tokens[i - 1];
    let n = 1;
    if (prev !== undefined) {
      const num = Number(prev.replace(',', '.'));
      if (Number.isFinite(num)) n = num;
      else if (NUMBER_WORDS[prev] !== undefined) n = NUMBER_WORDS[prev];
      const prev2 = tokens[i - 2];
      if (prev === 'of' && prev2 && NUMBER_WORDS[prev2] !== undefined) n = NUMBER_WORDS[prev2];
    }
    total += n * unit.days;
    found = true;
  }
  if (!found) {
    const phrase = PHRASES.find((p) => p.re.test(s));
    if (!phrase) return null;
    return phrase.days;
  }
  const phrase = PHRASES.find((p) => p.re.test(s));
  if (phrase && phrase.days > total) total = phrase.days;
  return Math.ceil(total - 1e-9);
}

const DICE_TIERS = [
  { re: /CRITICAL\s+SUCCESS|КРИТИЧЕСК\S*\s+УСПЕХ/i, tier: 'critSuccess' },
  { re: /CRITICAL\s+FAIL(?:URE)?|КРИТИЧЕСК\S*\s+ПРОВАЛ/i, tier: 'critFail' },
  { re: /\bSUCCESS\b|УСПЕХ/i, tier: 'success' },
  { re: /\bFAIL(?:URE)?\b|ПРОВАЛ|НЕУДАЧ/i, tier: 'fail' },
];

const DICE_NOTE_RE = /DICE\s+OF\s+FATE\s*[—–-]\s*([A-Z ]+?)\s*\(([^)\n]*)\)/i;

const DICE_LINE_RE = /^[ \t]*>?[ \t]*🎲[^\n]*$/m;

export function readDiceRoll(text) {
  const src = typeof text === 'string' ? text : '';
  if (!src) return null;

  const note = DICE_NOTE_RE.exec(src);
  const line = DICE_LINE_RE.exec(src);
  const bold = line ? /\*\*([^*\n]+)\*\*/.exec(line[0]) : null;
  const words = [note ? note[1] : '', bold ? bold[1] : (line ? line[0] : '')].join('\n');
  const hit = DICE_TIERS.find((t) => t.re.test(words));
  if (!hit) return null;

  const nums = diceNumbers(note ? note[2] : '') || diceNumbers(line ? lineParens(line[0]) : '');
  let roll = nums ? nums.roll : null;
  const dc = nums ? nums.dc : null;
  if (roll === null && hit.tier === 'critSuccess') roll = 20;
  if (roll === null && hit.tier === 'critFail') roll = 1;

  const q = line ? /\|\s*\*([^*\n]+)\*/.exec(line[0]) : null;
  return {
    tier: hit.tier,
    roll,
    dc,
    question: q ? q[1].trim() : '',
    matched: (line ? line[0] : note[0]).replace(/<span[\s\S]*$/i, '').trim().slice(0, 200),
  };
}

function lineParens(line) {
  const m = /\(([^)\n]*\d[^)\n]*)\)/.exec(line);
  return m ? m[1] : '';
}

function diceNumbers(inner) {
  const s = String(inner || '');
  if (!s.trim()) return null;
  const rollM = /Roll(?:ed)?\s*:?\s*(\d{1,2})/i.exec(s);
  const dcM = /DC\s*:?\s*(\d{1,2})/i.exec(s);
  let roll = rollM ? Number(rollM[1]) : null;
  let dc = dcM ? Number(dcM[1]) : null;
  if (roll === null || dc === null) {
    const pair = /(\d{1,2})\s*(?:из|of|\/|vs\.?)\s*(?:DC\s*:?\s*)?(\d{1,2})/i.exec(s);
    if (pair) {
      if (roll === null) roll = Number(pair[1]);
      if (dc === null) dc = Number(pair[2]);
    } else if (roll === null) {
      const one = /^\s*(\d{1,2})\s*!?\s*$/.exec(s);
      if (one) roll = Number(one[1]);
    }
  }
  if (roll !== null && (roll < 1 || roll > 20)) roll = null;
  if (dc !== null && (dc < 1 || dc > 30)) dc = null;
  return roll === null && dc === null ? null : { roll, dc };
}

export function readPhoneTurn(text) {
  const src = typeof text === 'string' ? text : '';
  const m = /^\s*\[\s*(смс|sms|голосовое(?:\s+сообщение)?|voice(?:\s+message)?|звонок|call)\s*(?:→|->|—>|–>|=>|➔|➡️?)\s*([^\]\n]+?)\s*\]/i.exec(src);
  if (!m) return null;
  return { channel: m[1].toLowerCase(), to: m[2].trim() };
}

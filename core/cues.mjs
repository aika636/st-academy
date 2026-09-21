// core/cues — что человек сказал о времени своей репликой (9.2).
//
// Два соседа кладут в user-сообщение знак, который меняет смысл следующего
// ответа модели для календаря, — и оба раньше проходили мимо Academy.
//
// 1. **Промотка времени BB-Enhance-Gen (Time Skip).** Человек сам выбрал главу
//    «через неделю» в окне Enhance-Gen, и тот дописал в его реплику cue
//    (`BB-Enhance-Gen/index.js`, `BOT_CUES.ts_specific`, сверено по исходнику):
//
//      > ⏩ **ПРОМОТКА ВРЕМЕНИ:** *{title}* ⏳ ({time}) <span style="display:none;">
//      <system_note>
//      TIME SKIP EVENT: Execute a logical TIME SKIP forward by {time}. New Chapter: …
//      </system_note>
//      </span>
//
//    Прыжок в ответе после такой реплики — не чужой инфоблок, который надо
//    придержать до слова человека (`time.setAbsolute`, `maxForwardJump`), а
//    слово человека и есть. Спрашивать «принять?» — переспрашивать то, на что
//    уже ответили.
//
//    Разбор терпимый, потому что cue — чужой формат, который автор меняет от
//    версии к версии: в разборе соседей (план 9.2) записан вариант с
//    `Time passed: X`, в исходнике 1.18.0-стенда — `forward by X` и `⏳ (X)`.
//    Узнаём любой из трёх, а сам cue — по любому из двух признаков: скрытый
//    `<span style="display:none">`, внутри которого стоит `TIME SKIP`, или
//    строка-цитата, начинающаяся с `⏩`. Голое «time skip» в тексте реплики
//    cue не считается: так человек может и спросить, и пошутить, а прыжок без
//    вопроса — это доверие, выданное только явной кнопке.
//
// 2. **Телефонный ход Phone-ST.** Реплика `[СМС → Лиза] …` или
//    `[Голосовое → Лиза] …` — переписка, пока сцена стоит на паузе (так считает
//    и сам телефон, `phoneTurnState`). Если модель на такой ход поставит
//    `t=+1`, календарь уедет на пару, а пара, которую «переписка» пересидела,
//    станет прогулом. Исходника Phone-ST на стенде нет, поэтому шаблон — по
//    формату из разбора: квадратные скобки в самом начале реплики, внутри слово
//    канала (СМС/SMS/Голосовое/Voice), стрелка и адресат.
//
// 3. **Кубик Enhance-Gen (Action Roll).** Человек бросил d20 кнопкой 🎲, и
//    Enhance-Gen дописал в реплику исход с приказом модели отыграть его
//    (9.4.1). В день контрольного это исход сдачи, и посчитанный Academy
//    спорить с ним не может — см. `exams.externalValue` и `engine.sitExam`.
//
// Модуль чистый: только разбор строк. Что с этим делать — решают движок
// (`engine.applyResponse`, `opts.timeSkip`/`opts.phoneTurn`/`opts.dice`) и
// `index.js`, который находит «реплику человека перед этим ответом».

// --- промотка времени -------------------------------------------------------

/** Скрытый блок cue: `<span style="display:none;">…</span>`, кавычки и `;` — любые. */
const HIDDEN_SPAN_RE = /<span\s+style\s*=\s*["']?\s*display\s*:\s*none\s*;?\s*["']?\s*>([\s\S]*?)(?:<\/span>|$)/gi;

/** Слова «промотка» внутри скрытого блока. `TIME SKIP`, `TIME-SKIP`, `TIMESKIP`. */
const SKIP_WORD_RE = /TIME[\s_-]*SKIP/i;

/** Видимая строка cue: цитата, начинающаяся с ⏩ (с вариантом эмодзи или без). */
const VISIBLE_RE = /^[ \t]*>[ \t]*⏩️?[^\n]*$/m;

/**
 * Промотка времени в тексте реплики человека — либо `null`.
 *
 * `days` — сколько суток человек заказал, если это удалось прочесть из подписи
 * (`skipDays`), иначе `null`. `null` не отменяет промотку: cue на месте, просто
 * длина неизвестна, и потолок остаётся базовым (см. `engine.timeSkipCap`).
 *
 * @param {string} text
 * @returns {?{days: ?number, time: string, matched: string}}
 */
export function readTimeSkip(text) {
  const src = typeof text === 'string' ? text : '';
  if (!src) return null;

  // Скрытый блок с «TIME SKIP» внутри. Берётся последний: `removeExtensionCues`
  // у Enhance-Gen снимает старый cue перед тем, как дописать новый, но реплику
  // человек мог и склеить руками.
  let note = null;
  for (const m of src.matchAll(HIDDEN_SPAN_RE)) {
    if (SKIP_WORD_RE.test(m[1])) note = m;
  }
  // Fast Travel того же расширения тоже пишет `⏳ (X)` и `Time passed: X`, но
  // это переход в другое место, а не промотка — и визуально он начинается с
  // 📍/⚡, а не с ⏩. Поэтому видимая строка засчитывается только с ⏩.
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

/**
 * Подпись длительности из cue: «forward by X», «Time passed: X», «⏳ (X)».
 * Первое, что нашлось, в этом порядке: в скрытой заметке подпись длиннее и
 * полнее, чем в видимой строке.
 */
function durationText(hay) {
  const by = /forward\s+by\s+([^\n<]+?)(?:\.\s|\.$|\n|<|$)/i.exec(hay);
  if (by && by[1].trim()) return by[1].trim();
  const passed = /Time\s+passed\s*:\s*([^\n<]+?)(?:\.\s|\.$|\n|<|$)/i.exec(hay);
  if (passed && passed[1].trim()) return passed[1].trim();
  const glass = /⏳️?\s*\(([^)\n]+)\)/.exec(hay);
  if (glass && glass[1].trim()) return glass[1].trim();
  return '';
}

// --- длительность словами ---------------------------------------------------

/** Числа словами — то, что модель анализатора Enhance-Gen пишет в `time`. */
const NUMBER_WORDS = {
  один: 1, одна: 1, одну: 1, одни: 1, одно: 1,
  два: 2, две: 2, пару: 2, пара: 2,
  три: 3, четыре: 4, пять: 5, шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10,
  несколько: 3,
  a: 1, an: 1, one: 1, two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, few: 3, several: 3,
};

/**
 * Единицы → сутки. Часы и минуты — доли суток: «восемь часов» из вечера — это
 * уже утро следующего дня, но потолок считается с запасом (+1 сутки, см.
 * `engine.timeSkipCap`), так что точнее не нужно.
 */
const UNITS = [
  { re: /^(?:мин|minute|min)/, days: 1 / 1440 },
  { re: /^(?:час|hour|hr)/, days: 1 / 24 },
  { re: /^(?:сут|день|дня|дней|дн|day)/, days: 1 },
  { re: /^(?:выходн|weekend)/, days: 2 },
  { re: /^(?:недел|week)/, days: 7 },
  { re: /^(?:месяц|мес\.?$|month)/, days: 30 },
  { re: /^(?:год|лет$|year)/, days: 365 },
];

/** Слова, которые сами называют длительность без числа. */
const PHRASES = [
  { re: /послезавтра|day\s+after\s+tomorrow/i, days: 2 },
  { re: /завтра|tomorrow|следующ\S*\s+(?:утр|д[е]?н|вечер|ноч)|next\s+(?:morning|day|evening|night)/i, days: 1 },
  { re: /полчаса|half\s+an?\s+hour/i, days: 0 },
];

/**
 * Сколько суток в подписи промотки, округлённо вверх; `null` — не прочлось.
 *
 * «2 дня», «неделя спустя», «Завтра утром», «пару недель», «a few days», «3
 * hours» — всё, что анализатор Enhance-Gen кладёт в поле `time` (его промпт
 * просит три типа: часы/следующий день, дни/выходные, недели). Несколько
 * количеств складываются: «неделя и два дня» — девять суток.
 *
 * @param {string} str
 * @returns {?number}
 */
export function skipDays(str) {
  const s = String(str || '').toLowerCase().replace(/ё/g, 'е');
  if (!s.trim()) return null;

  let total = 0;
  let found = false;
  // «число-или-слово единица»: «2 дня», «две недели», «a week». Единица без
  // числа («неделя спустя», «через месяц») — одна штука.
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
      // «a couple of weeks»: слово-число через «of».
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
  // «Завтра, спустя 8 часов» — фраза сильнее мелкой единицы.
  const phrase = PHRASES.find((p) => p.re.test(s));
  if (phrase && phrase.days > total) total = phrase.days;
  return Math.ceil(total - 1e-9);
}

// --- кубик Enhance-Gen (Action Roll) -------------------------------------------
//
// Формат сверен по исходнику на стенде (`BB-Enhance-Gen/index.js`, `BOT_CUES`,
// `roll_*`). Видимая строка-цитата и скрытая заметка:
//
//   > 🎲 **УСПЕХ (14 из 12)** | *вопрос* <span style="display:none;">
//   <system_note>
//   DICE OF FATE — SUCCESS (Roll: 14 vs DC: 12). …
//   </system_note></span>
//
// Четыре исхода: `КРИТИЧЕСКИЙ УСПЕХ (20)` / `CRITICAL SUCCESS (Rolled 20!)` —
// DC у крита сосед не пишет; `УСПЕХ (N из M)`; `ПРОВАЛ (N из M)`;
// `КРИТИЧЕСКИЙ ПРОВАЛ (1)`. Крит у соседа — натуральные 20 и 1, не запас над DC,
// как у Academy (`exams.checkTier`); переводит ступень в оценку
// `exams.externalValue`. План (9.4.1) записал cue как `🎲 … (N / DC M)` —
// такая форма тоже принимается: её пишут другие версии и «Roll: N / DC: M».

/** Ступень по слову соседа. Сначала длинные: «критический провал» содержит «провал». */
const DICE_TIERS = [
  { re: /CRITICAL\s+SUCCESS|КРИТИЧЕСК\S*\s+УСПЕХ/i, tier: 'critSuccess' },
  { re: /CRITICAL\s+FAIL(?:URE)?|КРИТИЧЕСК\S*\s+ПРОВАЛ/i, tier: 'critFail' },
  { re: /\bSUCCESS\b|УСПЕХ/i, tier: 'success' },
  { re: /\bFAIL(?:URE)?\b|ПРОВАЛ|НЕУДАЧ/i, tier: 'fail' },
];

/** Скрытая заметка: `DICE OF FATE — ИСХОД (Roll: N vs DC: M)` или `(Rolled 20!)`. */
const DICE_NOTE_RE = /DICE\s+OF\s+FATE\s*[—–-]\s*([A-Z ]+?)\s*\(([^)\n]*)\)/i;

/** Видимая строка: цитата, начинающаяся с 🎲; скобка с числами — первая после слова исхода. */
const DICE_LINE_RE = /^[ \t]*>?[ \t]*🎲[^\n]*$/m;

/**
 * Кубик Enhance-Gen в реплике человека — либо `null`.
 *
 * Узнаётся по скрытой заметке `DICE OF FATE` или по строке с 🎲, где есть
 * слово исхода. Голое «🎲» или «бросаю кубик» в тексте — не cue: исход должен
 * быть назван, иначе переписывать им оценку нечем.
 *
 * @param {string} text
 * @returns {?{tier: 'critSuccess'|'success'|'fail'|'critFail', roll: ?number,
 *   dc: ?number, question: string, matched: string}}
 */
export function readDiceRoll(text) {
  const src = typeof text === 'string' ? text : '';
  if (!src) return null;

  const note = DICE_NOTE_RE.exec(src);
  const line = DICE_LINE_RE.exec(src);
  // Слово исхода — из заметки и из жирной части строки: вопрос в строке
  // («удастся ли избежать провала?») исходом не является.
  const bold = line ? /\*\*([^*\n]+)\*\*/.exec(line[0]) : null;
  const words = [note ? note[1] : '', bold ? bold[1] : (line ? line[0] : '')].join('\n');
  const hit = DICE_TIERS.find((t) => t.re.test(words));
  if (!hit) return null;

  // Числа: заметка точнее строки (в ней подписаны Roll и DC), строка — запас.
  const nums = diceNumbers(note ? note[2] : '') || diceNumbers(line ? lineParens(line[0]) : '');
  let roll = nums ? nums.roll : null;
  const dc = nums ? nums.dc : null;
  // Крит у соседа — натуральная грань: число может не стоять, но оно известно.
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

/** Содержимое первой скобки с числом в видимой строке: «(14 из 12)», «(20)». */
function lineParens(line) {
  const m = /\(([^)\n]*\d[^)\n]*)\)/.exec(line);
  return m ? m[1] : '';
}

/**
 * Бросок и DC из подписи в скобках. Понимает «Roll: 14 vs DC: 12», «14 из 12»,
 * «14 / DC 12», «14/12», «Rolled 20!», «20». Грань вне 1–20 — не бросок d20.
 */
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

// --- телефонный ход ---------------------------------------------------------

/**
 * Реплика — ход в телефоне: `[СМС → Лиза]`, `[Голосовое → Лиза]` в самом начале.
 *
 * Терпимо к тому, что меняется от версии к версии и от раскладки клавиатуры:
 * регистр, «SMS»/«СМС», «Голосовое сообщение», «Voice (message)», стрелка
 * `→`, `->`, `—>`, `=>`, `➔`, `➡`. Нетерпимо к месту: скобка обязана стоять
 * первой. «Вечером я отправила [СМС → Лизе]» внутри описания сцены — это
 * сцена, а не пауза.
 *
 * @param {string} text
 * @returns {?{channel: string, to: string}}
 */
export function readPhoneTurn(text) {
  const src = typeof text === 'string' ? text : '';
  const m = /^\s*\[\s*(смс|sms|голосовое(?:\s+сообщение)?|voice(?:\s+message)?)\s*(?:→|->|—>|–>|=>|➔|➡️?)\s*([^\]\n]+?)\s*\]/i.exec(src);
  if (!m) return null;
  return { channel: m[1].toLowerCase(), to: m[2].trim() };
}

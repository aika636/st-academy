// ui/doctor.js — доктор промпта: кто ещё стоит в инжектах таверны и чей
// текст просит у модели начало или конец ответа. Чистые функции; блок на
// экране рисует вкладка «Отладка» (`ui/debug.js`).

import { fill, slotText } from './common.js';

// --- доктор промпта (9.7A п.4) ------------------------------------------------
//
// README давно описывает симптом «в посте чужой блок в начале есть, нашей
// метки нет». Доктор показывает причину, а не заставляет гадать: кто ещё
// стоит в инжектах таверны (`getContext().extensionPrompts` — живая ссылка на
// `extension_prompts` в `script.js:625`; таверна переприсваивает объект в
// `clearChat`, поэтому брать его надо на каждый показ, а не запоминать), на
// какой глубине и с какой ролью, и чей текст просит у модели начало или
// конец ответа.

/** Слова доктора — механизма, не заведения (как `DEBUG_TEXT`). */
export const DOCTOR_TEXT = {
  title: 'Доктор промпта',
  note: 'Кто ещё кладёт текст в промпт через setExtensionPrompt, куда и сколько. Если метка пропадает из ответов — причина обычно здесь.',
  unavailable: 'Таверна не отдаёт список инжектов (getContext().extensionPrompts) — показать нечего.',
  empty: 'Инжектов нет ни у кого.',
  ours: 'Academy',
  own: 'наш',
  chars: '{n} симв.',
  asksStart: 'просит начало ответа',
  asksEnd: 'просит конец ответа',
  mandatory: 'настаивает (MANDATORY)',
  sameSlot: 'на той же глубине и с той же ролью, что {ours}: таверна склеит их по алфавиту ключей',
  reasonsTitle: 'Почему метка может пропадать',
  noReasons: 'Причин не видно: никто из соседей не просит начало ответа.',
  markerSeen: 'Метка в последнем ответе была.',
  markerMissing: 'В последнем ответе метки не было.',
  markerOff: 'Метку сейчас не просим: режим «из контекста» или галочка инструкции выключена.',
  markerNoInstruction: 'Инструкции про метку в промпте сейчас нет (учёба в чате не начата, идёт фоновая генерация или галочка выключена).',
  reasonStart: '«{owner}» просит начало ответа ({where}): модель ставит первым его блок и теряет нашу метку.',
  reasonStartCloser: '«{owner}» просит начало ответа и стоит ближе к концу промпта, чем инструкция метки ({where}) — его просьба для модели свежее нашей.',
  reasonForeignHead: 'Ответ открывается чужим блоком: «{line}». Инструкция просит ставить метку сразу после такого блока, но поручиться за это нельзя.',
  reasonEncode: 'В настройках таверны включён «Encode tags»: метка станет видимым текстом.',
  reasonEnd: 'Конец ответа заняли: {owners}. Это не мешает — метка просится в начало, — но показывает, что в конце ответа тесно.',
  positions: { '-1': 'выключен', 0: 'после описания', 1: 'в чате, глубина {depth}', 2: 'до промпта' },
  roles: { 0: 'system', 1: 'user', 2: 'assistant' },
};

/**
 * Известные ключи самой таверны (`script.js`, `constants.js: inject_ids`,
 * `scripts/openai.js:1429`) — чтобы в таблице стояло «Заметка автора», а не
 * `2_floating_prompt`. Префиксы — у ключей с хвостом (глубина, роль, имя).
 */
const TAVERN_KEYS = [
  ['1_memory', 'Сводка (Summarize)'],
  ['2_floating_prompt', 'Заметка автора'],
  ['3_vectors', 'Векторы чата'],
  ['4_vectors_data_bank', 'Векторы Data Bank'],
  ['chromadb', 'Smart Context'],
  ['QUIET_PROMPT', 'Фоновая генерация'],
  ['DEPTH_PROMPT', 'Заметка персонажа (depth prompt)', true],
  ['customDepthWI', 'World Info на глубине', true],
  ['customWIOutlet_', 'World Info (outlet)', true],
];

/** Кто владелец ключа — словами, если это таверна; иначе сам ключ (обычно имя расширения). */
export function promptOwner(key) {
  const k = String(key || '');
  for (const [id, name, prefix] of TAVERN_KEYS) {
    if (prefix ? k.startsWith(id) : k === id) return name;
  }
  return k;
}

// Эвристика просьб — по словам, а не по разбору смысла: сосед пишет свою
// инструкцию как хочет, и узнаётся она только по устойчивым оборотам. Ложное
// срабатывание здесь дёшево (строка в отладке), пропуск — дорого (человек
// гадает). Отсюда широкие списки, а в панели — кусок текста вокруг совпадения,
// чтобы человек проверил глазами.
const ASK_START = /\b(?:first line|first thing in (?:your|the|each) (?:response|reply|message)|at the (?:very )?(?:start|beginning|top) of (?:your|the|each|every)|(?:begin|start|open) (?:your|the|each|every) (?:response|reply|message|answer))|в (?:самом )?начале (?:ответа|каждого|сообщения|поста)|перв(?:ой|ую) строк|начни (?:ответ|каждый|сообщение)|начинай (?:ответ|каждый|сообщение)/i;
const ASK_END = /\b(?:at the (?:very )?end of (?:your|the|each|every)|last line|(?:end|finish|close) (?:your|the|each|every) (?:response|reply|message|answer) with|append (?:to|at) the end)|в (?:самом )?конце (?:ответа|каждого|сообщения|поста)|последн(?:ей|юю) строк|заверш(?:и|ай|ите) (?:ответ|каждый|сообщение)/i;
const MANDATORY = /\bMANDATORY\b|\bREQUIRED\b|\bCRITICAL\b|ОБЯЗАТЕЛЬН/;

/** Кусок текста вокруг совпадения — чтобы человек проверил глазами. */
function around(text, re) {
  const m = re.exec(text);
  if (!m) return '';
  const from = Math.max(0, m.index - 30);
  const to = Math.min(text.length, m.index + m[0].length + 30);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${to < text.length ? '…' : ''}`;
}

/**
 * Первая непустая строка ответа — если это чужой служебный блок. Узнаётся по
 * форме, а не по имени: HTML-тег (не комментарий), кодовый блок, строка
 * таблицы, `[СКОБКИ]`, строка эмодзи-шапки инфоблока. Наша метка —
 * HTML-комментарий `<!-- [ACADEMY …] -->` и сюда не попадает.
 */
export function foreignHead(text) {
  const line = String(text || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  if (!line || /ACADEMY/i.test(line)) return '';
  if (/^<!--/.test(line)) return '';
  const looks = /^(?:<[a-z][\w-]*[\s>]|```|\||\[[^\]]{2,}\]|[📅🕰⏰🗓📍🌡⌚☀🌙])/iu.test(line);
  return looks ? (line.length > 80 ? `${line.slice(0, 77)}…` : line) : '';
}

/**
 * Разбор инжектов таверны для вкладки «Отладка».
 *
 * @param {Object} input
 * @param {?Object} input.prompts `getContext().extensionPrompts` — `{ключ: {value, position, depth, role}}`
 * @param {string[]} input.own ключи Academy (`academy_status` и соседи)
 * @param {string} [input.markerKey] ключ инструкции метки — с ним сравнивается глубина соседей
 * @param {boolean} [input.markerWanted] просим ли метку вообще (режим и галочка)
 * @param {?boolean} [input.markerSeen] была ли метка в последнем разобранном ответе; `null` — ответа не было
 * @param {string} [input.lastText] текст последнего ответа модели
 * @param {boolean} [input.encodeTags] `power_user.encode_tags`
 */
export function promptDoctorView(input = {}) {
  const T = DOCTOR_TEXT;
  const prompts = input.prompts;
  if (!prompts || typeof prompts !== 'object') {
    return { available: false, rows: [], reasons: [], status: T.unavailable, note: T.note };
  }
  const own = new Set(input.own || []);
  const rows = Object.keys(prompts).sort().map((key) => {
    const p = prompts[key] || {};
    const value = String(p.value == null ? '' : p.value);
    const ours = own.has(key);
    const wantsStart = !ours && ASK_START.test(value);
    const wantsEnd = !ours && ASK_END.test(value);
    const mandatory = !ours && MANDATORY.test(value);
    return {
      key,
      owner: ours ? T.ours : promptOwner(key),
      ours,
      position: Number(p.position),
      depth: Number(p.depth),
      role: Number(p.role),
      size: value.length,
      where: slotText({ position: Number(p.position), depth: Number(p.depth), role: Number(p.role) }, T),
      sizeText: fill(T.chars, { n: value.length }),
      empty: !value.trim(),
      wantsStart,
      wantsEnd,
      mandatory,
      startHint: wantsStart ? around(value, ASK_START) : '',
      endHint: wantsEnd ? around(value, ASK_END) : '',
      flags: [wantsStart ? T.asksStart : '', wantsEnd ? T.asksEnd : '', mandatory ? T.mandatory : ''].filter(Boolean),
    };
  });

  // Пустые инжекты — это погашенные слоты (наши под quiet, чужие между
  // генерациями): в промпт они не попадают (`getExtensionPrompt` берёт только
  // `x.value`), и в таблице они шум.
  const live = rows.filter((r) => !r.empty);
  const marker = rows.find((r) => r.key === input.markerKey && !r.empty) || null;
  // Одна глубина и одна роль с нашим инжектом: таверна склеивает такие по
  // алфавиту ключей (`getExtensionPrompt`: `Object.keys(...).sort()`).
  const ourSlots = live.filter((r) => r.ours && r.position === 1);
  for (const r of live) {
    if (r.ours || r.position !== 1) continue;
    const mate = ourSlots.find((o) => o.depth === r.depth && o.role === r.role);
    if (mate) r.flags.push(fill(T.sameSlot, { ours: T.ours }));
  }

  const reasons = [];
  const wanted = input.markerWanted !== false;
  let status;
  if (!wanted) status = T.markerOff;
  else if (!marker) status = T.markerNoInstruction;
  else if (input.markerSeen === true) status = T.markerSeen;
  else if (input.markerSeen === false) status = T.markerMissing;
  else status = '';

  if (wanted) {
    for (const r of live.filter((x) => x.wantsStart)) {
      // Ближе к концу промпта = меньше глубина при позиции «в чате». Такой
      // сосед говорит модели последним, и его «первой строкой» свежее нашего.
      const closer = marker && r.position === 1 && marker.position === 1 && r.depth < marker.depth;
      reasons.push(fill(closer ? T.reasonStartCloser : T.reasonStart, { owner: r.owner, where: r.where }));
    }
    const head = input.markerSeen === false ? foreignHead(input.lastText) : '';
    if (head) reasons.push(fill(T.reasonForeignHead, { line: head }));
    if (input.encodeTags) reasons.push(T.reasonEncode);
  }
  const enders = live.filter((x) => x.wantsEnd).map((x) => x.owner);
  const notes = enders.length ? [fill(T.reasonEnd, { owners: [...new Set(enders)].join(', ') })] : [];

  return {
    available: true,
    note: T.note,
    status,
    rows: live,
    hidden: rows.length - live.length,
    reasons,
    notes,
    noReasons: wanted && !reasons.length ? T.noReasons : '',
    emptyText: live.length ? '' : T.empty,
  };
}

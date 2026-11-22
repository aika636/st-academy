import { fill, slotText } from './common.js';

export const DOCTOR_TEXT = {
  title: 'Проверка промпта',
  note: 'Здесь видно, какие тексты добавлены в запрос к рассказчику, где они стоят и сколько места занимают. Это помогает выяснить, почему в ответах пропадает метка времени.',
  unavailable: 'Таверна не передала список дополнительных текстов запроса. Проверка недоступна.',
  empty: 'В списке нет дополнительных текстов.',
  ours: 'Академия',
  chars: '{n} симв.',
  asksStart: 'просит разместить текст в начале ответа',
  asksEnd: 'просит разместить текст в конце ответа',
  mandatory: 'помечает указание как обязательное',
  sameSlot: 'То же положение и роль, что у «{ours}». Таверна объединит тексты по алфавиту их служебных названий.',
  reasonsTitle: 'Почему метка времени пропадает',
  noReasons: 'Других инструкций, которые просят занять начало ответа, не найдено.',
  markerSeen: 'Метка времени найдена в последнем ответе.',
  markerMissing: 'В последнем ответе нет метки времени.',
  markerOff: 'Академия сейчас не просит метку времени: выбран режим «из контекста» или выключена инструкция.',
  markerNoInstruction: 'В запросе нет инструкции о метке времени. Возможные причины: учёба в чате не начата, идёт фоновая генерация или инструкция выключена.',
  reasonStart: '«{owner}» просит разместить свой текст в начале ответа ({where}). Из-за этого рассказчик может пропустить метку времени.',
  reasonStartCloser: '«{owner}» просит разместить свой текст в начале ответа ({where}). Эта просьба стоит ближе к концу запроса, чем инструкция о метке времени.',
  reasonForeignHead: 'Ответ начинается с блока «{line}». Рассказчик может пропустить метку времени, хотя инструкция просит поставить её сразу после блока.',
  reasonEncode: 'В настройках таверны включён «Encode tags»: метка времени будет видна как обычный текст.',
  reasonEnd: 'Разместить текст в конце ответа просят: {owners}. Метка времени ставится в начале, поэтому эти просьбы ей не мешают.',
  positions: { '-1': 'выключен', 0: 'после описания', 1: 'в чате, глубина {depth}', 2: 'до промпта' },
  roles: { 0: 'system', 1: 'user', 2: 'assistant' },
};

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

export function promptOwner(key) {
  const k = String(key || '');
  for (const [id, name, prefix] of TAVERN_KEYS) {
    if (prefix ? k.startsWith(id) : k === id) return name;
  }
  return k;
}

const ASK_START = /\b(?:first line|first thing in (?:your|the|each) (?:response|reply|message)|at the (?:very )?(?:start|beginning|top) of (?:your|the|each|every)|(?:begin|start|open) (?:your|the|each|every) (?:response|reply|message|answer))|в (?:самом )?начале (?:ответа|каждого|сообщения|поста)|перв(?:ой|ую) строк|начни (?:ответ|каждый|сообщение)|начинай (?:ответ|каждый|сообщение)/i;
const ASK_END = /\b(?:at the (?:very )?end of (?:your|the|each|every)|last line|(?:end|finish|close) (?:your|the|each|every) (?:response|reply|message|answer) with|append (?:to|at) the end)|в (?:самом )?конце (?:ответа|каждого|сообщения|поста)|последн(?:ей|юю) строк|заверш(?:и|ай|ите) (?:ответ|каждый|сообщение)/i;
const MANDATORY = /\bMANDATORY\b|\bREQUIRED\b|\bCRITICAL\b|ОБЯЗАТЕЛЬН/;

function around(text, re) {
  const m = re.exec(text);
  if (!m) return '';
  const from = Math.max(0, m.index - 30);
  const to = Math.min(text.length, m.index + m[0].length + 30);
  return `${from > 0 ? '…' : ''}${text.slice(from, to).replace(/\s+/g, ' ').trim()}${to < text.length ? '…' : ''}`;
}

export function foreignHead(text) {
  const line = String(text || '').split('\n').map((s) => s.trim()).find(Boolean) || '';
  if (!line || /ACADEMY/i.test(line)) return '';
  if (/^<!--/.test(line)) return '';
  const looks = /^(?:<[a-z][\w-]*[\s>]|```|\||\[[^\]]{2,}\]|[📅🕰⏰🗓📍🌡⌚☀🌙])/iu.test(line);
  return looks ? (line.length > 80 ? `${line.slice(0, 77)}…` : line) : '';
}

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

  const live = rows.filter((r) => !r.empty);
  const marker = rows.find((r) => r.key === input.markerKey && !r.empty) || null;
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

// core/analysis — секретарь: отдельный запрос читает готовый ответ рассказчика
// и записывает, что в нём случилось.
//
// Зачем. Оценки, прогулы и отношения приходят только меткой, а метку пишет та
// же модель, что ведёт сцену: в длинном красивом ответе она про `grade=` и
// `rel=` забывает, а рядом с трекерами соседей не ставит метку вовсе. Зачёт,
// сыгранный в прозе, тогда в зачётку не попадает. Секретарь снимает с
// рассказчика бухгалтерию: он читает только этот ответ (и реплику перед ним) и
// возвращает одну строку в формате той же метки.
//
// Четыре решения.
//
// 1. **Ответ секретаря — наша метка, а не JSON.** Её разборщик уже
//    снисходителен к тому, как пишут модели (порядок ключей, имена вместо id,
//    русские ключи, стоп-лист имён героини), и всё, что он отверг, видно в
//    отладке. Второй формат значил бы второй разборщик со своими дырами.
// 2. **Время секретарь не пишет.** Время уже идёт из прозы и метки рассказчика
//    (3.2); второй источник сдвига удвоил бы пары. Ключи `t=` из его ответа
//    отбрасываются, даже если он их поставил.
// 3. **Выводы хранятся каноническими токенами** (`grade=chemistry:5`): по id, а
//    не по именам. Так их можно показать по одному, вычеркнуть один и прогнать
//    ответ заново — набор токенов и есть «что записано из этого ответа».
// 4. **Разбор главнее метки рассказчика.** Когда разбор есть, из метки модели
//    остаётся только время (`keepMarkerKinds`): иначе пятёрка, которую увидели
//    оба, легла бы в зачётку дважды.
//
// Модуль чистый: состояние, пресет и тексты на входе, строки на выходе.

import { parseMarker, keepMarkerKinds } from './parse-marker.mjs';
import { sittableExams, kindOf } from './exams.mjs';
import { teacherOfSubject } from './state.mjs';
import { holidaysAhead, holidaysOn } from './holidays.mjs';
import { EVENT_HORIZON } from './parse-marker.mjs';

/** Что секретарь вправе записать. Время — нет (решение 2). */
export const ANALYSIS_KINDS = ['grade', 'completion', 'rel', 'attendance', 'event'];

/** Сколько текста ответа и реплики уезжает в запрос. Длинное режется с конца. */
export const ANALYSIS_LIMITS = { reply: 6000, user: 1500, reason: 60 };

const SYSTEM = [
  'Ты — секретарь учебной части. Тебе дают фрагмент ролевой истории про студентку и списки предметов и преподавателей.',
  'Ты записываешь в ведомость только то, что в этом фрагменте действительно случилось с героиней. Ничего не додумываешь.',
  'Отвечаешь строкой служебной метки, затем строкой «Кратко:» с объяснением.',
].join(' ');

/**
 * Промпт секретаря.
 *
 * @param {Object} state
 * @param {Object} preset
 * @param {{reply: string, userText?: string, statusLine?: string, heroine?: string}} input
 *   `statusLine` — строка состояния, которую видел рассказчик (`prompt.statusLine`):
 *   день, пара, хвосты словами пресета. Её собирает вызывающий — ядро не знает
 *   про `prompt.mjs`.
 * @returns {{system: string, user: string}}
 */
export function buildAnalysisPrompt(state, preset, input = {}) {
  const heroine = str(input.heroine) || 'героиня';
  const subjects = (state.subjects || []).map((s) => {
    const t = teacherOfSubject(state, s.id);
    return `- ${s.id} — ${s.name || s.id}${t ? ` — ${t.name || t.id} (${t.id})` : ''}`;
  });
  const teachers = (state.teachers || []).map((t) => `- ${t.id} — ${t.name || t.id}`);
  const values = ((preset.grades && preset.grades.values) || []).map((g) => g.value);

  const lines = [];
  if (input.statusLine) lines.push(`Где мы в календаре: ${input.statusLine}`);
  lines.push('Предметы (id — название — преподаватель):', ...subjects);
  lines.push('Преподаватели (id — имя):', ...teachers);
  if (values.length) lines.push(`Оценки пишутся одним из значений: ${values.join(', ')}.`);
  const debts = (state.subjects || []).filter((subject) => subject.debt);
  lines.push(`Текущие хвосты: ${debts.length ? debts.map((subject) => subject.id).join(', ') : 'нет'}.`);
  // Старый ответ разбирается поправкой (`core/corrections`): сегодняшнее
  // контрольное к нему не относится.
  const exams = input.exams === false ? [] : todaysExamLines(state, preset);
  if (exams.length) {
    lines.push(`Сегодня по расписанию: ${exams.join('; ')}. Если во фрагменте его сдали или провалили — запиши исход как grade по этому предмету.`);
  }
  const known = knownEventLines(state, preset);
  lines.push(`Уже в планах (не повторяй): ${known.length ? known.join('; ') : 'ничего'}.`);
  lines.push('');
  const said = clip(input.userText, ANALYSIS_LIMITS.user);
  if (said) lines.push('Реплика игрока перед ответом:', '"""', said, '"""', '');
  lines.push('Ответ рассказчика:', '"""', clipAnalysisReply(input.reply), '"""', '');
  lines.push(
    'Запиши, что случилось, одной строкой вида:',
    '<!-- [ACADEMY grade=предмет:оценка rel=преподаватель:minor+:повод skip=предмет late=предмет event=+3:название] -->',
    'Правила:',
    `- grade — только если ${heroine} получила оценку, сдала или не сдала зачёт или экзамен. Оценки другим людям не пишутся.`,
    '- Прочитай весь фрагмент: учебный итог может быть фоном, воспоминанием о прошедших днях или репликой собеседника, даже если главная сцена бытовая или романтическая.',
    '- Явный итог «все экзамены/зачёты сданы» записывай completion=all:оценка; «все хвосты закрыты» — completion=debts:оценка; сдан конкретный предмет — completion=id:оценка. Обычная оценка за ответ у доски остаётся grade. Не дублируй completion обычными grade по тем же предметам.',
    '- «Ты все зачёты на отлично сдала», «все хвосты были сданы на высший балл», «сдала все хвосты до единого; в зачётке отметки отлично» — состоявшийся учебный итог, а не отсутствие событий. Для «отлично»/«высший балл» возьми высшую оценку из шкалы. Без точной оценки используй проходное «зачёт», если оно есть в шкале; не выдумывай числовой балл.',
    '- completion=all допустим только при явно сказанном «все» об экзаменах/зачётах героини. Желание, будущий план, отрицание («ещё не сдала все») или достижения другого персонажа не означают завершение. Не угадывай предмет по неназванному преподавателю; не добавляй оценки остальным предметам за один удачный ответ.',
    `- rel — если отношение преподавателя к ${heroine} заметно изменилось: minor+ или minor- (немного), major+ или major- (сильно); после второго двоеточия — повод в двух-трёх словах.`,
    `- skip — ${heroine} прогуляла пару; late — опоздала на пару.`,
    '- skip/late только при прямом факте пропуска/опоздания героини. Переход даты, «прошло четыре дня», выходной, конец зачётной недели, отсутствие описания занятий или домашняя сцена не доказывают прогул. Не выводи прогулы из календаря.',
    `- event — праздник, вечеринка, бал, концерт, поход, свидание или другое событие, о котором во фрагменте сказано, что оно будет: event=+дни:название, где дни — через сколько дней от момента сцены (0 — сегодня, 1 — завтра). Несколько дней подряд — event=+5..+6:название. Событий несколько — несколько ключей event. Дальше ${EVENT_HORIZON} дней, без понятного срока, прошедшее и уже записанное в планах — не пиши.`,
    '- Время и дату не пиши (кроме дней до события в event).',
    '- Пиши id из списков выше. Каждый ключ — отдельно, ключи можно повторять.',
    '- Если ничего из этого не случилось — пустая метка <!-- [ACADEMY] -->.',
    '',
    'Второй строкой напиши «Кратко:» и одно предложение: что в этом фрагменте было с учёбой героини (пары, оценки, преподаватели, прогулы) — или «к учёбе не относится».',
  );
  return { system: SYSTEM, user: lines.join('\n') };
}

/**
 * Что уже стоит в календаре на ближайшие две недели: праздники пресета,
 * каникулы и свои события — «Зимний бал (+3)». Секретарь их не повторяет.
 */
function knownEventLines(state, preset) {
  const day = state && state.calendar && state.calendar.day;
  if (!day) return [];
  try {
    const now = holidaysOn(preset, day, state).map((h) => `${h.name} (идёт сейчас)`);
    const ahead = holidaysAhead(preset, day, EVENT_HORIZON + 1, state).map((a) => `${a.holiday.name} (+${a.days})`);
    return [...now, ...ahead].slice(0, 12);
  } catch {
    return [];
  }
}

/** «зачёт: аналитическая химия» по каждому контрольному, за которое можно сесть сегодня. */
function todaysExamLines(state, preset) {
  let items = [];
  try {
    items = sittableExams(state, preset);
  } catch {
    return [];
  }
  return items.map((item) => {
    const kind = kindOf(preset, item.kind);
    const subject = (state.subjects || []).find((s) => s.id === item.subjectId);
    return `${(kind && kind.name) || item.kind}: ${(subject && subject.name) || item.subjectId} (${item.subjectId})`;
  });
}

/**
 * Ответ секретаря → канонические токены.
 *
 * Рассуждения думающих моделей (`<think>…</think>`) срезаются: в них модель
 * перебирает варианты меткой, и разборщик подобрал бы черновик. Ответ без
 * единой метки — `found: false`: это сбой, а не «ничего не случилось»
 * (на «ничего» есть пустая метка).
 *
 * @param {string} raw ответ модели
 * @param {Object} lexicon то же, что `parseMarker`: пресет со списками состояния и `names`
 * @returns {{found: boolean, tokens: string[], summary: string, rejected: Array<{raw: string, reason: string}>}}
 */
export function parseAnalysis(raw, lexicon) {
  const text = String(raw || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  const parsed = parseMarker(text, lexicon);
  const tokens = [];
  for (const ev of parsed.events) {
    const t = tokenOf(ev);
    if (t && !tokens.includes(t)) tokens.push(t);
  }
  // «Кратко: …» — что секретарь вычитал словами; показывается на плашке, в
  // состояние не идёт.
  const m = /кратко\s*[:：]\s*(.+)/i.exec(text);
  const summary = m ? m[1].replace(/<!--[\s\S]*?-->/g, '').trim().slice(0, 300) : '';
  return { found: parsed.found, tokens, summary, rejected: parsed.rejected };
}

/** Событие разборщика → канонический токен; время и прочее — `null`. */
export function tokenOf(ev) {
  if (!ev || !ANALYSIS_KINDS.includes(ev.kind)) return null;
  if (ev.kind === 'grade') return `grade=${ev.subjectId}:${ev.value}`;
  if (ev.kind === 'completion') return `completion=${ev.scope}:${ev.value}`;
  if (ev.kind === 'attendance') return `${ev.status === 'late' ? 'late' : 'skip'}=${ev.subjectId}`;
  if (ev.kind === 'event') {
    const name = cleanReason(ev.name).replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
    if (!name) return null;
    return `event=+${ev.days}${ev.until > ev.days ? `..+${ev.until}` : ''}:${name}`;
  }
  const sign = ev.delta < 0 ? '-' : '+';
  const strength = ev.impact ? `${ev.impact}${sign}` : `${sign}${Math.abs(ev.delta)}`;
  const reason = cleanReason(ev.reason);
  return `rel=${ev.teacherId}:${strength}${reason ? `:${reason}` : ''}`;
}

/**
 * Повод — свободный текст внутри метки. Вычищается всё, что разборщик принял
 * бы за границу: `=` начинает новый ключ, скобки и `-->` закрывают метку.
 */
function cleanReason(reason) {
  return str(reason)
    .replace(/-->|[=[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ANALYSIS_LIMITS.reason);
}

/** Токены одной меткой — так их читает движок. */
export function analysisMarker(tokens) {
  const list = (tokens || []).filter(Boolean);
  return `<!-- [ACADEMY${list.length ? ` ${list.join(' ')}` : ''}] -->`;
}

/**
 * Текст, который считает движок (решение 4). Нет разбора (`null`) — ответ как
 * есть. Есть — из меток рассказчика остаётся время, а события приходят меткой
 * разбора в конце; пустой разбор значит «секретарь ничего не нашёл», и
 * оценка из метки рассказчика тогда тоже не ложится.
 */
export function effectiveText(text, tokens) {
  const src = String(text || '');
  if (!Array.isArray(tokens)) return src;
  return `${keepMarkerKinds(src, ['time'])}\n${analysisMarker(tokens)}`;
}

/**
 * Токен словами — для плашки под сообщением: «оценка: аналитическая химия — 5»,
 * «Петрова: теплее (немного) — помогла с опытом», «прогул: история».
 * Имена — из состояния; токен, который больше не читается (предмет удалили), —
 * как есть.
 */
export function tokenText(token, lexicon) {
  const ev = tokenEvent(token, lexicon);
  if (!ev) return String(token);
  const subject = (id) => {
    const s = (lexicon.subjects || []).find((x) => x.id === id);
    return (s && s.name) || id;
  };
  if (ev.kind === 'grade') return `оценка: ${subject(ev.subjectId)} — ${ev.value}`;
  if (ev.kind === 'completion') return `Сданы ${ev.scope === 'all' ? 'все зачёты и экзамены' : ev.scope === 'debts' ? 'все текущие хвосты' : subject(ev.scope)}: ${ev.value}`;
  if (ev.kind === 'attendance') return `${ev.status === 'late' ? 'опоздание' : 'прогул'}: ${subject(ev.subjectId)}`;
  if (ev.kind === 'event') return `в планы: ${ev.name} — ${daysText(ev.days)}${ev.until > ev.days ? ` (на ${ev.until - ev.days + 1} дн.)` : ''}`;
  if (ev.kind === 'rel') {
    const t = (lexicon.teachers || []).find((x) => x.id === ev.teacherId);
    const who = (t && t.name) || ev.teacherId;
    const dir = ev.delta > 0 ? 'теплее' : 'холоднее';
    const how = ev.impact === 'major' ? 'заметно' : ev.impact === 'minor' ? 'немного' : '';
    return `${who}: ${dir}${how ? ` (${how})` : ''}${ev.reason ? ` — ${ev.reason}` : ''}`;
  }
  return String(token);
}

/** «сегодня», «завтра», «через 3 дн.» — от дня сцены. */
function daysText(n) {
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  if (n === 2) return 'послезавтра';
  return `через ${n} дн.`;
}

/** Токен обратно в событие разборщика; не читается — `null`. */
export function tokenEvent(token, lexicon) {
  return parseMarker(analysisMarker([token]), lexicon).events[0] || null;
}

function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}

/** Держим начало и финал длинного поста, а учебные абзацы — с любого места.
 * Это выбор текста для модели, не автоматическое присвоение оценок по словам.
 */
export function clipAnalysisReply(text, limit = ANALYSIS_LIMITS.reply) {
  const source = str(text);
  if (source.length <= limit) return source;
  const separator = '\n[… часть текста опущена …]\n';
  const budget = Math.max(0, limit - separator.length * 3);
  const edge = Math.floor(budget / 4);
  const middle = source.slice(edge, source.length - edge);
  const relevant = middle.split(/\n\s*\n|(?<=[.!?])\s+/u)
    .filter((part) => /экзамен|зач[её]т|хвост|оценк|отметк|профессор|преподавател|прогул|опозда|сдал|сдан|сдач|праздн|(?<![а-яё])бал(?!л)|вечеринк|концерт|ярмарк|фестивал|турнир|поход|свидани|через .{0,12}(дн|недел)|завтра|послезавтра|в (понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)|exam|grade|passed/iu.test(part))
    .join('\n');
  return [source.slice(0, edge), relevant.slice(0, budget - edge * 2), source.slice(-edge)]
    .filter(Boolean).join(separator);
}

/** Длинный текст режется с начала: конец ответа — то, чем сцена кончилась. */
function clip(text, limit) {
  const s = str(text);
  return s.length > limit ? `…${s.slice(s.length - limit)}` : s;
}

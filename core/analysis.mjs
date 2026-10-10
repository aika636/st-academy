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

import { parseMarker, keepMarkerKinds, markerKeys, partyOf, salvageMarker, cardDisplayName, MARKER_RE, HEROINE } from './parse-marker.mjs';
import { sittableExams, kindOf } from './exams.mjs';
import { teacherOfSubject } from './state.mjs';
import { holidaysAhead, holidaysOn } from './holidays.mjs';
import { addDays } from './time.mjs';
import { EVENT_HORIZON } from './parse-marker.mjs';
import { SCENE_KINDS, sceneText, sceneAbout, personWord } from './scene.mjs';
import { heroGender, heroWords } from './gender.mjs';
import { reactionCap, loudCap, LOUDNESS, hash, cleanNick, cleanType, nickWord, postRef } from './feed.mjs';

/** Что секретарь вправе записать. Время — нет (решение 2). */
export const ANALYSIS_KINDS = ['grade', 'completion', 'rel', 'attendance', 'event', 'pause', ...SCENE_KINDS];

/** Сколько текста ответа и реплики уезжает в запрос. Длинное режется с конца. */
export const ANALYSIS_LIMITS = { reply: 6000, user: 1500, reason: 60 };

/** Системная часть промпта секретаря: слова про героя — по роду (`core/gender`). */
const systemOf = (gender) => {
  const w = heroWords(gender);
  return [
  `Ты — секретарь учебной части. Тебе дают фрагмент ролевой истории про ${gender === 'm' ? 'студента' : 'студентку'}, списки предметов, преподавателей и ${w.her} курса.`,
  `Ты записываешь в ведомость только то, что в этом фрагменте действительно случилось — с ${w.heroIns} и людьми вокруг ${gender === 'm' ? 'него' : 'неё'}. Ничего не додумываешь.`,
  'Отвечаешь двумя блоками: «Что было» — строка служебной метки, «Слышно» — насколько громко это и было ли это при людях; затем строка «Кратко:».',
  'Постов, реплик и ников курса ты не пишешь: сплетни сочиняет отдельный вызов.',
  ].join(' ');
};

/** Потолки разбора курса на один ответ: больше — шум, а не сцена. */
export const SOCIAL_LIMITS = { met: 8, clash: 4, rumor: 3, new: 3, deal: 4 };

/** Реакция: длина реплики и сколько курс держит в промпте секретаря. */
export const REACTION_LIMITS = { text: 200, minLetters: 3 };

/** Кто реагирует, если не из состава: «кто-то с курса» словом пресета. */
export const SOMEONE = 'someone';

/**
 * Ответы в ветках (решение 08.10). Потолок свой, а не общий с реакциями:
 * ответ — короткая реплика под постом, и съедай он место реакций, громкое
 * событие давало бы либо посты без веток, либо ветки без постов. Но растёт он
 * той же громкостью (`loudCap`): тихо — самое большее один, скандал — до
 * `total`. Под одним постом — до `perPost`: третья реплика в ветке за один
 * ответ — уже перепалка, которую стоит играть, а не сочинять.
 */
export const REPLY_LIMITS = { perPost: 2, total: 4 };

/** Сколько ответов допускает громкость разбора. */
export function replyCap(loud) {
  return loudCap(Number.isInteger(loud) ? loud : 1, REPLY_LIMITS.total);
}

/** Знак ника в ответе секретаря: `~школьный бес`. */
export const NICK_MARK = '~';

/** «Кто-то с курса» словами пресета (`vocab.someone`: «кто-то из класса», «кто-то из взвода»). */
export function someoneWord(preset) {
  const own = preset && preset.vocab && preset.vocab.someone;
  return typeof own === 'string' && own.trim() ? own.trim() : 'кто-то с курса';
}

/**
 * Промпт секретаря.
 *
 * @param {Object} state
 * @param {Object} preset
 * @param {{reply: string, userText?: string, statusLine?: string, heroine?: string}} input
 *   `statusLine` — строка состояния, которую видел рассказчик (`prompt.statusLine`):
 *   день, пара, хвосты словами пресета. Её собирает вызывающий — ядро не знает
 *   про `prompt.mjs`. `hooks` — поводы, отданные рассказчику кнопкой «Взять в
 *   сюжет» (`plot.secretaryHooks`): секретарь отмечает сыгранные `played=id`.
 * @returns {{system: string, user: string}}
 */
export function buildAnalysisPrompt(state, preset, input = {}) {
  const gender = heroGender(state, input.heroine);
  const w = heroWords(gender);
  // Прошедшее время героя: «сдала» / «сдал».
  const g = (f, m) => (gender === 'm' ? m : f);
  const heroine = str(input.heroine) || w.hero;
  const subjects = (state.subjects || []).map((s) => {
    const t = teacherOfSubject(state, s.id);
    return `- ${s.id} — ${s.name || s.id}${t ? ` — ${t.name || t.id} (${t.id})` : ''}`;
  });
  const teachers = (state.teachers || []).map((t) => `- ${t.id} — ${t.name || t.id}`);
  // Курс — так же, как преподаватели: id, имя и одна строка о человеке.
  // Роль-зерно из пресета сюда не идёт (решение 3 от 06.10).
  const course = (Array.isArray(state.classmates) ? state.classmates : []).filter((c) => c && c.id).map((c) => {
    const about = classmateLine(c);
    return `- ${c.id} — ${c.name || c.id}${about ? ` — ${about}` : ''}`;
  });
  const values = ((preset.grades && preset.grades.values) || []).map((g) => g.value);

  const lines = [];
  if (input.statusLine) lines.push(`Где мы в календаре: ${input.statusLine}`);
  lines.push('Предметы (id — название — преподаватель):', ...subjects);
  lines.push('Преподаватели (id — имя):', ...teachers);
  lines.push(`Курс ${w.heroGen} (id — имя — о человеке):`, ...(course.length ? course : ['- пока никого']));
  if (values.length) lines.push(`Оценки пишутся одним из значений: ${values.join(', ')}.`);
  const debts = (state.subjects || []).filter((subject) => subject.debt);
  lines.push(`Текущие хвосты: ${debts.length ? debts.map((subject) => subject.id).join(', ') : 'нет'}.`);
  // Старый ответ разбирается поправкой (`core/corrections`): сегодняшнее
  // контрольное к нему не относится.
  const exams = input.exams === false ? [] : todaysExamLines(state, preset);
  if (exams.length) {
    lines.push(`Сегодня по расписанию: ${exams.join('; ')}. Если во фрагменте его сдали или провалили — запиши исход как grade по этому предмету.`);
  }
  const hooks = (Array.isArray(input.hooks) ? input.hooks : []).filter((h) => h && h.id && h.text).slice(0, 3);
  if (hooks.length) lines.push('Поводы, которые игрок отдал рассказчику (id — что):', ...hooks.map((h) => `- ${h.id} — ${clip(h.text, 200)}`));
  const known = knownEventLines(state, preset);
  lines.push(`Уже в планах (не повторяй): ${known.length ? known.join('; ') : 'ничего'}.`);
  lines.push('');
  const said = clip(input.userText, ANALYSIS_LIMITS.user);
  if (said) lines.push('Реплика игрока перед ответом:', '"""', said, '"""', '');
  lines.push('Ответ рассказчика:', '"""', clipAnalysisReply(stripForeignMarkup(input.reply)), '"""', '');
  lines.push(
    'Блок 1. Что было — одной строкой служебной метки:',
    '<!-- [ACADEMY grade=предмет:оценка rel=человек:minor+:повод skip=предмет late=предмет event=+3:название met=однокурсник clash=кто:с кем:повод rumor=о ком:что говорят new=Имя Фамилия deal=кто:кому:что] -->',
    'Правила блока 1:',
    `- grade — только если ${heroine} ${g('получила оценку, сдала или не сдала', 'получил оценку, сдал или не сдал')} зачёт или экзамен. Оценки другим людям не пишутся.`,
    '- Прочитай весь фрагмент: учебный итог может быть фоном, воспоминанием о прошедших днях или репликой собеседника, даже если главная сцена бытовая или романтическая.',
    '- Явный итог «все экзамены/зачёты сданы» записывай completion=all:оценка; «все хвосты закрыты» — completion=debts:оценка; сдан конкретный предмет — completion=id:оценка. Обычная оценка за ответ у доски остаётся grade. Не дублируй completion обычными grade по тем же предметам.',
    `- «Ты все зачёты на отлично ${g('сдала', 'сдал')}», «все хвосты были сданы на высший балл», «${g('сдала', 'сдал')} все хвосты до единого; в зачётке отметки отлично» — состоявшийся учебный итог, а не отсутствие событий. Для «отлично»/«высший балл» возьми высшую оценку из шкалы. Без точной оценки используй проходное «зачёт», если оно есть в шкале; не выдумывай числовой балл.`,
    `- completion=all допустим только при явно сказанном «все» об экзаменах/зачётах ${w.heroGen}. Желание, будущий план, отрицание («ещё не ${g('сдала', 'сдал')} все») или достижения другого персонажа не означают завершение. Не угадывай предмет по неназванному преподавателю; не добавляй оценки остальным предметам за один удачный ответ.`,
    `- rel — если отношение преподавателя или однокурсника к ${heroine} заметно изменилось: minor+ или minor- (немного), major+ или major- (сильно); после второго двоеточия — повод в двух-трёх словах.`,
    `- skip — ${heroine} ${g('прогуляла', 'прогулял')} пару; late — ${g('опоздала', 'опоздал')} на пару.`,
    `- Не усиливай сказанное: пиши то, что произошло в тексте, а не его возможные последствия. ${w.hero[0].toUpperCase()}${w.hero.slice(1)} ${g('извинилась', 'извинился')} — это не «помирились», кто-то нахмурился — не «поссорились». Нет слов о примирении, ссоре, обещании — нет и факта.`,
    `- skip/late только при прямом факте пропуска/опоздания ${w.heroGen}. Переход даты, «прошло четыре дня», выходной, конец зачётной недели, отсутствие описания занятий или домашняя сцена не доказывают прогул. Не выводи прогулы из календаря.`,
    `- event — праздник, вечеринка, бал, концерт, поход, свидание или другое событие, о котором во фрагменте сказано, что оно будет: event=+дни:название, где дни — через сколько дней от момента сцены (0 — сегодня, 1 — завтра). Несколько дней подряд — event=+5..+6:название. Событий несколько — несколько ключей event. Дальше ${EVENT_HORIZON} дней, без понятного срока, прошедшее и уже записанное в планах — не пиши.`,
    ...pauseRules(state),
    '- met — кто из курса был в сцене: id из списка курса, несколько — через запятую.',
    `- clash — стычка, ссора или перепалка двоих: clash=кто:с кем:повод в двух-трёх словах. ${heroine} пишется @heroine.`,
    '- rumor — кто-то в сцене пустил или пересказал слух: rumor=о ком:что говорят. Только если слух прозвучал во фрагменте; о ком — id или @heroine. «Что» продолжает фразу «говорят, что <он/она> …»: rumor=sokolova:списала контрольную.',
    `- new — в сцене появился человек по имени, которого нет ни среди преподавателей, ни в курсе: new=имя, как в тексте. ${heroine}, рассказчика и тех, кто уже в списках, не пиши.`,
    `- deal — между людьми открылось дело: обещание, долг, общий проект, вещь, которую надо вернуть: deal=кто:кому:что. «Кто» — тот, кто должен или кому назначены отработка, наказание, штраф; «кому» — перед кем он должен. Отработку назначили ${w.heroDat} — кто=@heroine, кому=тот, кто назначил. Дело закрыли (вернули, выполнили) — deal-=кто:кому:что.`,
    ...(hooks.length ? ['- played — повод из списка «Поводы» во фрагменте действительно прозвучал: played=id. Не прозвучал — не пиши.'] : []),
    '- Время и дату не пиши (кроме дней до события в event).',
    '- Пиши id из списков выше. Каждый ключ — отдельно, ключи можно повторять.',
    '- Если ничего из этого не случилось — пустая метка <!-- [ACADEMY] -->.',
    '',
    'Блок 2. Слышно — насколько громко это дойдёт до курса и было ли при людях. Этот блок ничего в ведомости не меняет. Постов, реплик и ников курса здесь нет: сплетни пишет отдельный вызов. Строками:',
    'Слышно:',
    'loud=0..3',
    'private=номера ключей блока 1',
    'Правила блока 2:',
    '- loud — насколько громко то, что было: 0 — тихо (обычная оценка, разговор), курс почти не замечает; 1 — заметно; 2 — громко (прогул при всех, ссора); 3 — скандал.',
    '- private — только если было наедине, без свидетелей: разговор вдвоём за закрытой дверью, шёпот, тайная встреча. Номера — порядковые номера ключей метки блока 1, считая с 1, через запятую: private=2,3. Что случилось при людях, не отмечай; нет таких — строку не пиши. «Наедине» не значит «навсегда в тайне»: подслушать могут, но это решит не секретарь.',
    '- Реплик курса, ников, строк react= и reply= в ответе не нужно.',
    '',
    `Последней строкой напиши «Кратко:» и одно предложение: что в этом фрагменте было с учёбой ${w.heroGen} и людьми вокруг (пары, оценки, преподаватели, прогулы, курс) — или «к учёбе не относится».`,
  );
  return { system: systemOf(gender), user: lines.join('\n') };
}

/** Теги, которые живут в тексте сцены: разметка самого ответа, не служебные блоки. */
const TEXT_TAGS = 'b|i|u|s|em|strong|del|ins|sub|sup|small|big|mark|span|p|br|hr|div|font|center|blockquote|q|code|pre|a|ul|ol|li|details|summary|h[1-6]';

/** Тег `<img …>` целиком: в кавычках атрибутов (JSON подсказки картинке) бывает `>`. */
const IMG_RE = /<img(?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>/gi;

/** Парный блок с неизвестным тегом: `<rp_plan>…</rp_plan>`, `<think>…</think>`. */
const FOREIGN_BLOCK_RE = new RegExp(`<(?!(?:${TEXT_TAGS})[\\s>/])([a-z][\\w-]*)(?:\\s[^>]*)?>[\\s\\S]*?</\\1\\s*>`, 'gi');

/**
 * Ответ рассказчика для секретаря без чужой служебной разметки: картинки
 * (`<div><img data-iig-instruction='{…}'></div>` — сотни токенов подсказки для
 * генератора картинок) и блоки соседних расширений. Живой прогон 10.10. Текст
 * сцены и обычная разметка (`<i>`, `<b>`, `<br>`) остаются; метки Академии
 * снимает `stripMarker` раньше.
 */
export function stripForeignMarkup(text) {
  if (typeof text !== 'string' || !text) return '';
  return text
    .replace(IMG_RE, '')
    .replace(FOREIGN_BLOCK_RE, '')
    // обёртка, оставшаяся без картинки
    .replace(/<(div|p|span|center)\b[^>]*>\s*<\/\1>/gi, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Одна строка о человеке курса: желание, проблема — что есть. */
function classmateLine(c) {
  const parts = [];
  if (str(c.desire)) parts.push(`хочет ${str(c.desire)}`);
  if (str(c.problem)) parts.push(str(c.problem));
  return parts.join('; ').slice(0, 140);
}

/**
 * Правило `pause=`: занятия уже прекратились — каникулы, закрытие, карантин.
 * Только состоявшийся факт: желание, воспоминание, план без решения и слух
 * календарь не меняют. Секретарю даётся день сцены — сроки он считает сам.
 */
function pauseRules(state) {
  const day = state && state.calendar && state.calendar.day;
  const today = /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? ` День сцены: ${day} (ГГГГ-ММ-ДД).` : '';
  return [
    `- pause — занятия ПРЕКРАТИЛИСЬ: во фрагменте прямо сказано, что каникулы уже начались, заведение закрыли или занятий больше нет (карантин, закрытие, отмена всех пар). pause=дни:название, где дни — сколько дней занятий не будет, считая день сцены (на неделю — 7; до 20-го — число дней от дня сцены до 20-го включительно; до конца месяца — так же). Срок не назван — pause=open:название («до отмены»). Занятия возобновились, каникулы кончились — pause=end.${today}`,
    '- pause: только прямой состоявшийся факт. Желание («хорошо бы каникулы»), предположение («наверное, закроют»), слух, воспоминание о прошлых каникулах и план без решения («обсуждают, не закрыть ли») — не пиши. Отменили одну пару или один день — это не pause. Пример да: «С сегодняшнего дня занятий нет до весны» — pause=open:каникулы до весны, а «Академию закрыли на неделю из-за потопа» — pause=7:закрытие из-за потопа. Пример нет: «Скорее бы каникулы», «Прошлой зимой каникулы были долгими», «Говорят, на карантин закроют».',
    '- pause: пиши в тот ответ, где это объявили, а не при каждом упоминании. Идущий период из «Уже в планах» не повторяй; только если срок изменили или продлили — пиши новый.',
  ];
}

/**
 * Что уже стоит в календаре на ближайшие две недели: праздники пресета,
 * каникулы и свои события — «Зимний бал (+3)». Секретарь их не повторяет.
 */
function knownEventLines(state, preset) {
  const day = state && state.calendar && state.calendar.day;
  if (!day) return [];
  try {
    const now = holidaysOn(preset, day, state).map((h) => `${h.name} (идёт сейчас${h.open ? ', до отмены' : h.pause ? `, до ${dayWord(h.to)}` : ''})`);
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
 * Ответ — два блока (решение 1 владелицы, шаг 3). «Что было» — метка: её
 * ключи становятся токенами фактов. «Что сочинено» — строки `react=` и
 * `loud=`: реакции становятся токенами `react=…` в том же списке, после
 * фактов, и держатся за свой факт отпечатком его токена (`factRef`).
 * Список один, потому что протокол ответа хранит одно — «что записано из
 * этого ответа», и вычеркнуть с плашки можно любую строку.
 *
 * Реакция проверяется кодом, а не просьбой к модели (`razbor-inject.md`,
 * приём 1): ссылка на факт, которого нет или который отвергнут, — реакция
 * отброшена; сверх громкости и потолка пресета — отброшена; героиня автором
 * — отброшена; повтор — отброшен. Всё отброшенное — в `rejected`, как и
 * отвергнутые ключи метки.
 *
 * Ответ в ветке (`reply=`, решение 08.10) — так же: родитель — реакция этого
 * блока по номеру строки или недавний пост ленты (`lexicon.feedPosts`, `f2`);
 * родителя нет или реакция отвергнута — ответ отброшен; потолок — свой
 * (`REPLY_LIMITS`, `replyCap`). Автор реакции и ответа — человек из списков или
 * ник-маска `~школьный бес`: ник в состав, кандидаты и встречи не идёт.
 *
 * Посты ленты секретарь больше не пишет (шаг 3 «Слухов»): его блок 2 — громкость
 * `loud=` и пометка `private=` у фактов, что случились наедине. Строки `react=`
 * и `reply=` разбираются по-прежнему (старые ответы, ручные правки), но с
 * `opts.posts === false` — как в живом разборе — пропускаются.
 *
 * @param {string} raw ответ модели
 * @param {Object} lexicon то же, что `parseMarker`: пресет со списками состояния и `names`
 * @param {{posts?: boolean}} [opts] `posts: false` — реплик не принимать
 * @returns {{found: boolean, partial: boolean, tokens: string[], summary: string, rejected: Array<{raw: string, reason: string}>}}
 */
export function parseAnalysis(raw, lexicon, opts = {}) {
  const postsOn = !opts || opts.posts !== false;
  let text = String(raw || '').replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '');
  let found = new RegExp(MARKER_RE.source, 'i').test(text);
  // Метка без закрытия (ответ оборвался на бюджете токенов) — не «метки нет»:
  // целые пары спасаются, `partial` честно говорит, что хвост потерян.
  let partial = false;
  if (!found) {
    const saved = salvageMarker(text);
    if (saved) {
      text = text.slice(0, saved.start) + saved.marker + text.slice(saved.end);
      found = true;
      partial = saved.partial;
    }
  }
  const tokens = [];
  const rejected = [];
  // Номер факта — его место в метке, как его видит модель: считаются все
  // ключи блока «что было», и выдуманные тоже, кроме самих реакций.
  const byNumber = [];
  const counts = {};
  const hookIds = new Set((Array.isArray(lexicon && lexicon.hooks) ? lexicon.hooks : []).map((h) => h && h.id).filter(Boolean));
  for (const k of markerKeys(text)) {
    if (COMPOSED_KEYS.includes(k.name)) continue;
    // «Повод сыгран» — факт блока «что было», но состояние семестра он не
    // меняет: движку не едет, реакции к нему не цепляются. Номер он занимает —
    // модель считает его ключом метки.
    if (PLAYED_KEYS.includes(k.name)) {
      byNumber.push(null);
      for (const id of String(k.value || '').split(/[,\s]+/).map((v) => v.replace(/[[\]()«»"]/g, '').trim().toLowerCase()).filter(Boolean)) {
        const t = `played=${id}`;
        if (!hookIds.has(id)) rejected.push({ raw: t, reason: 'такого повода секретарю не давали' });
        else if (!tokens.includes(t)) tokens.push(t);
      }
      continue;
    }
    if (!k.kind) {
      byNumber.push(null);
      continue;
    }
    if (!k.value) {
      rejected.push({ raw: k.raw, reason: 'пустое значение' });
      byNumber.push(null);
      continue;
    }
    const parsed = parseMarker(analysisMarker([k.raw]), lexicon);
    rejected.push(...parsed.rejected);
    let first = null;
    for (const ev of parsed.events) {
      const t = tokenOf(ev);
      if (!t) continue;
      const limit = SOCIAL_LIMITS[ev.kind];
      if (!tokens.includes(t)) {
        if (limit !== undefined && (counts[ev.kind] || 0) >= limit) {
          rejected.push({ raw: k.raw, reason: `больше ${limit} ключей ${ev.kind} на один ответ` });
          continue;
        }
        counts[ev.kind] = (counts[ev.kind] || 0) + 1;
        tokens.push(t);
      }
      first = first || t;
    }
    byNumber.push(first);
  }

  const loudMatch = /(?<![\p{L}\d_])(?:loud|громкость)\s*[=:]\s*([0-3])/iu.exec(text);
  const loud = loudMatch ? Number(loudMatch[1]) : null;
  const cap = loudCap(loud === null ? 1 : loud, reactionCap(lexicon));
  const reactions = [];
  const seenText = new Set();
  // Номер поста для `reply=` — место строки `react=` в блоке, как его видит
  // модель: отвергнутая реакция номер занимает, но ветку не держит.
  const slots = [];
  for (const value of postsOn ? reactionValues(text) : []) {
    const r = readReaction(value, tokens, byNumber, lexicon);
    const raw = `react=${value}`;
    slots.push(null);
    if (r.error) {
      rejected.push({ raw, reason: r.error });
      continue;
    }
    const key = textKey(r.text);
    if (seenText.has(key)) {
      rejected.push({ raw, reason: 'повтор реакции' });
      continue;
    }
    if (reactions.length >= cap) {
      rejected.push({ raw, reason: `реакций больше, чем стоит событие (до ${cap})` });
      continue;
    }
    seenText.add(key);
    const t = reactionToken(r);
    reactions.push(t);
    slots[slots.length - 1] = t;
  }

  // Ответы в ветках: родитель — реакция этого блока или недавний пост ленты.
  const replies = [];
  const perPost = new Map();
  // Кто уже ответил под постом в этом блоке: автор возвращается в свою ветку
  // только после чужого ответа — иначе он отвечает сам себе.
  const voices = new Map();
  const replyMax = replyCap(loud === null ? 1 : loud);
  for (const value of postsOn ? reactionValues(text, REPLY_WORDS) : []) {
    const raw = `reply=${value}`;
    const a = readReply(value, slots, lexicon);
    if (a.error) {
      rejected.push({ raw, reason: a.error });
      continue;
    }
    const key = textKey(a.text);
    if (seenText.has(key)) {
      rejected.push({ raw, reason: 'повтор реплики' });
      continue;
    }
    if (replies.length >= replyMax) {
      rejected.push({ raw, reason: `ответов больше, чем стоит событие (до ${replyMax})` });
      continue;
    }
    if ((perPost.get(a.parent) || 0) >= REPLY_LIMITS.perPost) {
      rejected.push({ raw, reason: `под одним постом — до ${REPLY_LIMITS.perPost} ответов` });
      continue;
    }
    const me = voiceOf(a.who, a.nick);
    const heard = voices.get(a.parent) || [];
    if (me && me === a.parentVoice && !a.answered && !heard.some((v) => v !== me)) {
      rejected.push({ raw, reason: 'автор поста отвечает сам себе' });
      continue;
    }
    seenText.add(key);
    perPost.set(a.parent, (perPost.get(a.parent) || 0) + 1);
    voices.set(a.parent, [...heard, me]);
    replies.push(replyToken(a));
  }
  // Наедине: номера ключей блока 1 → отпечатки их токенов (не съезжают, когда список правят).
  const privates = [];
  for (const value of reactionValues(text, PRIVATE_WORDS)) {
    for (const ref of value.split(/[\s,;]+/).map((v) => v.replace(/[#№[\]()]/g, '').trim()).filter(Boolean)) {
      const n = /^\d{1,2}$/.test(ref) ? Number(ref) : 0;
      const fact = n >= 1 && n <= byNumber.length ? byNumber[n - 1] : null;
      const t = fact ? `private=${factRef(fact)}` : '';
      if (!t) rejected.push({ raw: `private=${ref}`, reason: `нет факта номер ${ref} — нечему быть наедине` });
      else if (!privates.includes(t)) privates.push(t);
    }
  }
  const posted = reactions.length > 0 || replies.length > 0;
  if (posted) tokens.push(...reactions, ...replies);
  tokens.push(...privates);
  // Громкость нужна, когда есть что озвучивать: факт, реплика, отвергнутый факт (сцена
  // всё равно была громкой) или громкая сцена сама по себе (2+, баг 79). Голая тихая
  // `loud=` без них — шум.
  if (posted || (loud !== null && (loud >= 2 || rejected.length > 0 || tokens.some(isFactToken)))) tokens.push(`loud=${loud === null ? 1 : loud}`);

  // «Кратко: …» — что секретарь вычитал словами; показывается на плашке, в
  // состояние не идёт.
  const m = /кратко\s*[:：]\s*(.+)/i.exec(text);
  const summary = m ? tidySummary(m[1].replace(/<!--[\s\S]*?-->/g, ''), lexicon) : '';
  return { found, partial, tokens, summary, rejected };
}

/**
 * «Кратко» для показа: служебное «к учёбе не относится» в начале — не часть
 * сводки (остаётся то, что секретарь сказал дальше), а имена персонажей карточки
 * латиницей заменены написанием на языке анкеты, как в ленте (`cardDisplayName`).
 */
export function tidySummary(text, lexicon) {
  let out = String(text || '').trim();
  out = out.replace(/^(?:к\s+учёбе\s+не\s+относится[\s:.,;—–-]*)+/i, '').trim();
  const names = (lexicon && lexicon.names) || {};
  const lang = ((lexicon && lexicon.survey) || {}).lang || (lexicon && lexicon.lang);
  for (const person of Array.isArray(names.cast) ? names.cast : []) {
    const all = [person && person.name, ...((person && person.aliases) || [])].filter((n) => typeof n === 'string' && n.trim());
    const own = cardDisplayName('', all[0], [person], lang);
    if (!own) continue;
    for (const n of all) {
      if (n === own || /[а-яё]/i.test(n) === /[а-яё]/i.test(own)) continue;
      const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'giu'), () => own);
    }
  }
  return out.slice(0, 300);
}

// --- реакции: блок «что сочинено» -------------------------------------------------

/** Ключи блока «что сочинено» — в номер факта не считаются. */
const COMPOSED_KEYS = ['react', 'реакция', 'reply', 'ответ', 'loud', 'громкость', 'private', 'наедине'];

/** «Наедине» — словами модели. */
const PRIVATE_WORDS = ['private', 'наедине'];

/** Ключи реакции и ответа в ветке — словами модели. */
const REACT_WORDS = ['react', 'реакция'];
const REPLY_WORDS = ['reply', 'ответ'];

/** Ключ сравнения реплик: повтор — тот же текст без знаков. */
function textKey(text) {
  return String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** «Повод сыгран» (шаг 4) — словами модели. */
const PLAYED_KEYS = ['played', 'сыграно', 'сыгран'];

/** Каналы реакции и слова, которыми модель их называет. */
const CHANNEL_WORDS = {
  chat: ['chat', 'чат', 'чат курса', 'course', 'факт'],
  anon: ['anon', 'анон', 'анонимка', 'аноним', 'слух', 'rumor'],
};

/** «Кто-то с потока» — словами модели. */
const SOMEONE_WORDS = ['someone', 'кто-то', 'кто то', 'кто-то с потока', 'кто то с потока', 'кто-то с курса', 'anyone', 'somebody'];

function channelOf(word) {
  const w = String(word || '').toLowerCase().replace(/ё/g, 'е').replace(/[[\]()«»"]/g, '').trim();
  for (const [chan, words] of Object.entries(CHANNEL_WORDS)) if (words.includes(w)) return chan;
  return null;
}

/**
 * Значения `react=` по порядку: строками блока «что сочинено», а если модель
 * вписала их в метку — до следующего ключа или конца метки.
 */
function reactionValues(text, words = REACT_WORDS) {
  const out = [];
  const re = new RegExp(`(?<![\\p{L}\\d_])(?:${words.join('|')})\\s*=\\s*([^\\n]*)`, 'giu');
  for (const m of text.matchAll(re)) {
    let v = m[1];
    const stop = v.search(/-->|\s[\p{L}\d_-]{1,24}\s*=/u);
    if (stop >= 0) v = v.slice(0, stop);
    v = v.replace(/\]{1,2}\s*$/, '').trim();
    if (v) out.push(v);
  }
  return out;
}

/** Одна реакция: `номер:кто:канал:текст` → поля или `{error}`. */
function readReaction(value, tokens, byNumber, lexicon) {
  const fields = value.split(':');
  const ref = fields[0].replace(/[#№[\]()]/g, '').trim().toLowerCase();
  let fact = null;
  if (/^\d{1,2}$/.test(ref)) {
    const n = Number(ref);
    if (n < 1 || n > byNumber.length) return { error: `нет факта номер ${n}` };
    fact = byNumber[n - 1];
    if (!fact) return { error: `факт номер ${n} не записан — реакция без опоры` };
  } else if (ref) {
    fact = tokens.find((t) => t.startsWith(`${ref}=`) && isFactToken(t)) || null;
    if (!fact) return { error: `нет факта «${ref}»` };
  } else {
    return { error: 'реакция без ссылки на факт' };
  }
  // Кто и канал: `кто:канал:текст`, но модель бывает пропускает «кто».
  let who = '';
  let chan = 'chat';
  let rest;
  if (channelOf(fields[1])) {
    chan = channelOf(fields[1]);
    rest = fields.slice(2);
  } else if (channelOf(fields[2])) {
    who = fields[1];
    chan = channelOf(fields[2]);
    rest = fields.slice(3);
  } else {
    who = fields[1];
    rest = fields.slice(2);
  }
  const author = authorOf(who, lexicon);
  if (author.error) return { error: author.error };
  const text = reactionText(rest.join(':'));
  if ((text.match(/\p{L}/gu) || []).length < REACTION_LIMITS.minLetters) return { error: 'у реакции нет текста' };
  return { fact, who: author.id, nick: author.nick, type: author.type, chan, text };
}

/**
 * Ответ в ветке: `куда:кто:текст` → поля или `{error}`. Куда — номер строки
 * `react=` этого блока (`slots`: токен или `null`, если реакция отвергнута)
 * или ссылка `f2` на недавний пост ленты (`lexicon.feedPosts`). Канал — как у
 * поста: ветка не переходит из анонимки в чат.
 */
function readReply(value, slots, lexicon) {
  const fields = value.split(':');
  const ref = fields[0].replace(/[#№[\]()«»"]/g, '').trim().toLowerCase();
  let parent;
  let chan;
  let parentVoice;
  let answered = false;
  const own = /^(?:r|р|реакция\s*)?(\d{1,2})$/u.exec(ref);
  const old = /^(?:f|ф)\s*(\d{1,2})$/u.exec(ref);
  if (own) {
    const n = Number(own[1]);
    if (n < 1 || n > slots.length) return { error: `нет поста номер ${n} — ответ без ветки` };
    const post = slots[n - 1];
    if (!post) return { error: `пост номер ${n} не записан — ответ без ветки` };
    parent = `r.${hash(post)}`;
    const r = reactionOf(post);
    chan = r.chan;
    parentVoice = voiceOf(r.who, r.nick);
  } else if (old) {
    const post = arr(lexicon && lexicon.feedPosts).find((p) => p && p.ref === `f${Number(old[1])}`);
    if (!post) return { error: `нет поста «${ref}» в ленте — ответ без ветки` };
    parent = `f.${postRef(post.id)}`;
    chan = post.chan === 'anon' ? 'anon' : 'chat';
    parentVoice = voiceOf(post.who, post.nick);
    // В старой ветке уже кто-то отвечал — автору есть кому ответить.
    answered = Number(post.replies) > 0;
  } else {
    return { error: 'ответ без поста' };
  }
  // `кто:текст`; без автора — `текст`; лишний канал после автора пропускается.
  let rest = fields.slice(1);
  let who = '';
  if (rest.length > 1) {
    who = rest[0];
    rest = rest.slice(1);
    if (rest.length > 1 && channelOf(rest[0])) rest = rest.slice(1);
  }
  const author = authorOf(who, lexicon);
  if (author.error) return { error: author.error };
  const text = reactionText(rest.join(':'));
  if ((text.match(/\p{L}/gu) || []).length < REACTION_LIMITS.minLetters) return { error: 'у ответа нет текста' };
  return { parent, who: author.id, nick: author.nick, type: author.type, chan, text, parentVoice, answered };
}

/**
 * Голос автора для сравнения: id или `~ник` без регистра. «Кто-то с курса» и
 * без подписи — не голос: два анонима не обязательно один человек.
 */
function voiceOf(who, nick) {
  const n = cleanNick(nick);
  if (n) return `${NICK_MARK}${n.toLowerCase().replace(/ё/g, 'е')}`;
  return who && who !== SOMEONE ? who : '';
}

/**
 * Автор реакции и ответа: id из списков (и мягко — `parse-marker.softPerson`),
 * ник-маска, «кто-то с курса» или отказ (героиня).
 *
 * Ник — `~школьный бес`. Без знака ником считается и незнакомое, что
 * написано со строчной кириллицей или в несколько слов («альфа футбольной
 * команды»): имя человека модель пишет с заглавной, а латинское слово
 * похоже на id, которого нет, — это «кто-то с курса», как раньше. Ник,
 * который оказывается героиней, — отказ, как и сама героиня.
 *
 * @returns {{id: string, nick: string} | {error: string}}
 */
function authorOf(raw, lexicon) {
  // Типаж — в скобках после ника: «~альфа (футболист-альфа)». Человеку из
  // списков он не нужен и теряется.
  const typed = /^([^()]*)\(([^()]*)\)\s*$/.exec(String(raw || ''));
  const type = typed ? cleanType(typed[2]) : '';
  const w = String(typed ? typed[1] : raw || '').replace(/[[\]()«»"]/g, '').trim();
  const low = w.toLowerCase().replace(/ё/g, 'е');
  if (!w || SOMEONE_WORDS.includes(low) || low === someoneWord(lexicon).toLowerCase().replace(/ё/g, 'е')) return { id: SOMEONE, nick: '' };
  if (w.startsWith(NICK_MARK) || w.startsWith('～')) {
    const nick = cleanNick(w);
    if (!nick) return { id: SOMEONE, nick: '' };
    if (partyOf(nick, lexicon).id === HEROINE) return { error: 'героиня — не реакция курса' };
    return { id: '', nick, type };
  }
  const party = partyOf(w, lexicon);
  if (party.id === HEROINE) return { error: 'героиня — не реакция курса' };
  if (party.id) return { id: party.id, nick: '' };
  // Незнакомое имя — не новый человек: в ленте это «кто-то с курса» или маска.
  const masky = /^[а-яё]/.test(w) || (/\s/.test(w) && !/^[A-ZА-ЯЁ]/.test(w));
  const nick = masky ? cleanNick(w) : '';
  return nick ? { id: '', nick, type } : { id: SOMEONE, nick: '' };
}

/** Реплика: одна строка, без кавычек и знаков метки, с потолком по слову. */
function reactionText(raw) {
  let t = String(raw || '')
    .replace(/-->|[=[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[«"“„']+|[»"”']+$/g, '')
    .trim();
  if (t.length > REACTION_LIMITS.text) {
    const cut = t.slice(0, REACTION_LIMITS.text);
    const at = cut.lastIndexOf(' ');
    t = `${(at > REACTION_LIMITS.text / 2 ? cut.slice(0, at) : cut).trim()}…`;
  }
  return t;
}

/**
 * Кого секретарь назвал, а в списках нет: имена и id из отвергнутого
 * («неизвестный человек: «sokolova»»), без повторов. Мягкое сопоставление
 * уже пробовано (`parse-marker.softPerson`); что не нашлось и так — плашка
 * показывает строкой «Не разобрано», а не прячет в консоль.
 *
 * @param {Array<{raw: string, reason: string}>} rejected
 * @returns {string[]}
 */
export function unparsedNames(rejected) {
  const out = [];
  for (const r of Array.isArray(rejected) ? rejected : []) {
    const m = /неизвестный (?:человек|преподаватель):\s*«([^»]+)»/u.exec(String((r && r.reason) || ''));
    const name = m ? m[1].trim() : '';
    if (name && !out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out.slice(0, 6);
}

/** Ссылка реакции на факт — отпечаток его токена: не съезжает, когда список правят. */
export function factRef(token) {
  return hash(String(token || ''));
}

/** Автор в токене: id, `~ник`, `~ник(типаж)` или `someone`. */
function authorField(who, nick, type) {
  const n = cleanNick(nick);
  const t = n ? cleanType(type) : '';
  return n ? `${NICK_MARK}${n}${t ? `(${t})` : ''}` : (who || SOMEONE);
}

/** Автор из токена: `{who, nick}`. */
function authorFrom(field) {
  const f = String(field || '');
  if (f.startsWith(NICK_MARK)) {
    const typed = /^([^()]*)\(([^()]*)\)$/.exec(f);
    const nick = cleanNick(typed ? typed[1] : f);
    if (nick) return { who: '', nick, type: typed ? cleanType(typed[2]) : '' };
  }
  return { who: f || SOMEONE, nick: '', type: '' };
}

/** Реакция → канонический токен `react=отпечаток факта:кто:канал:текст`; кто — id или `~ник`. */
export function reactionToken({ fact, who, nick, type, chan, text }) {
  return `react=${factRef(fact)}:${authorField(who, nick, type)}:${chan === 'anon' ? 'anon' : 'chat'}:${reactionText(text)}`;
}

/**
 * Ответ → канонический токен `reply=пост:кто:канал:текст`. Пост — `r.<отпечаток
 * токена реакции>` (реакция этого же разбора) или `f.<отпечаток id записи>`
 * (пост ленты: в id есть двоеточия, `feed.postRef`).
 */
export function replyToken({ parent, who, nick, type, chan, text }) {
  return `reply=${parent}:${authorField(who, nick, type)}:${chan === 'anon' ? 'anon' : 'chat'}:${reactionText(text)}`;
}

export function isReactToken(token) {
  return /^react=/.test(String(token || ''));
}

export function isReplyToken(token) {
  return /^reply=/.test(String(token || ''));
}

/**
 * Ответ из токена. `post` — токен реакции-родителя в списке (`null` — её
 * вычеркнули, ответ сирота) или ссылка на пост ленты `feed`.
 * @returns {?{parent: string, who: string, nick: string, chan: string, text: string, post: ?string, feed: string}}
 */
export function replyOf(token, tokens = []) {
  const m = /^reply=([rf]\.[0-9a-z]+):([^:]*):(chat|anon):([\s\S]+)$/.exec(String(token || ''));
  if (!m) return null;
  const own = m[1].startsWith('r.');
  const post = own ? (tokens || []).find((t) => isReactToken(t) && hash(t) === m[1].slice(2)) || null : null;
  return { parent: m[1], ...authorFrom(m[2]), chan: m[3], text: m[4], post, feed: own ? '' : m[1].slice(2) };
}

/**
 * Ответы списка с их родителями — для ленты (`scene.applyReactions`):
 * `{parent: {token}}` — к реакции этого разбора, `{parent: {ref}}` — к посту
 * ленты по отпечатку id. Сироты не идут.
 */
export function repliesOf(tokens) {
  const list = Array.isArray(tokens) ? tokens : [];
  return list.filter(isReplyToken).map((t) => replyOf(t, list)).filter((a) => a && (a.post || a.feed)).map((a) => ({
    parent: a.post ? { token: a.post } : { ref: a.feed },
    who: a.nick ? '' : a.who, nick: a.nick, type: a.type, chan: a.chan, text: a.text,
  }));
}

export function isLoudToken(token) {
  return /^loud=/.test(String(token || ''));
}

/** «Наедине»: `private=<отпечаток факта>` — сцена без свидетелей, в слухи идёт только слухом. */
export function isPrivateToken(token) {
  return /^private=/.test(String(token || ''));
}

/** Отпечатки фактов, помеченных наедине: `factRef(токен факта)`. */
export function privateRefs(tokens) {
  return new Set((Array.isArray(tokens) ? tokens : []).filter(isPrivateToken).map((t) => t.slice(8)).filter(Boolean));
}

/** «Повод сыгран»: `played=p3`. */
export function isPlayedToken(token) {
  return /^played=/.test(String(token || ''));
}

/** Id поводов, отмеченных сыгранными. */
export function playedOf(tokens) {
  return (Array.isArray(tokens) ? tokens : []).filter(isPlayedToken).map((t) => t.slice(7)).filter(Boolean);
}

/**
 * Токен факта — то, что меняет состояние семестра: всё, кроме блока «что
 * сочинено» и отметки «повод сыгран» (она правит только ленту).
 */
export function isFactToken(token) {
  return Boolean(token) && !isReactToken(token) && !isReplyToken(token) && !isLoudToken(token) && !isPlayedToken(token) && !isPrivateToken(token);
}

/**
 * Реакция из токена; `fact` — токен её факта в списке или `null`
 * (факт вычеркнут — реакция сирота). У маски `who` пустой, ник — в `nick`.
 * @returns {?{ref: string, who: string, nick: string, chan: string, text: string, fact: ?string, token: string}}
 */
export function reactionOf(token, tokens = []) {
  const m = /^react=([^:]+):([^:]*):(chat|anon):([\s\S]+)$/.exec(String(token || ''));
  if (!m) return null;
  const fact = (tokens || []).find((t) => isFactToken(t) && factRef(t) === m[1]) || null;
  return { ref: m[1], ...authorFrom(m[2]), chan: m[3], text: m[4], fact, token: String(token) };
}

/** Реакции списка с их фактами — для ленты (`scene.applyReactions`). */
export function reactionsOf(tokens) {
  const list = Array.isArray(tokens) ? tokens : [];
  return list.filter(isReactToken).map((t) => reactionOf(t, list)).filter((r) => r && r.fact);
}

/** Громкость разбора; `null` — реакций нет. */
export function loudOf(tokens) {
  const t = (tokens || []).find(isLoudToken);
  const n = t ? Number(t.slice(5)) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 3 ? n : null;
}

/**
 * Без реакций-сирот: реакция, чьего факта больше нет, уходит; громкость без
 * факта и реакции — тоже. Решение 3 владелицы: вычеркнула факт — его реакции
 * уходят вместе с ним.
 */
export function pruneReactions(tokens) {
  if (!Array.isArray(tokens)) return tokens;
  const refs = new Set(tokens.filter(isFactToken).map(factRef));
  const withReacts = tokens.filter((t) => {
    if (!isReactToken(t)) return true;
    const r = reactionOf(t);
    return Boolean(r && refs.has(r.ref));
  });
  // Реакция ушла — её ветка тоже. Ответ к посту ленты держится за ленту.
  const posts = new Set(withReacts.filter(isReactToken).map((t) => hash(t)));
  const kept = withReacts.filter((t) => {
    if (!isReplyToken(t)) return true;
    const a = replyOf(t);
    return Boolean(a && (a.feed || posts.has(a.parent.slice(2))));
  });
  // «Наедине» держится за свой факт: факт ушёл — пометка тоже.
  const left = kept.filter((t) => !isPrivateToken(t) || refs.has(t.slice(8)));
  // Громкость нужна, пока есть что озвучивать: факт или реплика.
  return left.some((t) => isReactToken(t) || isReplyToken(t) || isFactToken(t)) ? left : left.filter((t) => !isLoudToken(t));
}

/** Вычеркнуть строку с плашки: факт уносит свои реакции, реакция — свою ветку. */
export function dropTokenAt(tokens, index) {
  if (!Array.isArray(tokens)) return tokens;
  const left = tokens.filter((_, i) => i !== index);
  // Вычеркнут последний факт — человек сказал «этого не было»: громкость уходит с ним,
  // иначе она сама стала бы поводом «громкая сцена» (баг 79).
  if (isFactToken(tokens[index]) && !left.some(isFactToken)) return pruneReactions(left.filter((t) => !isLoudToken(t)));
  return pruneReactions(left);
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
  if (ev.kind === 'pause') {
    if (ev.end) return 'pause=end';
    const name = cleanReason(ev.name).replace(/:/g, ' ').replace(/\s+/g, ' ').trim();
    return `pause=${ev.days ? ev.days : 'open'}${name ? `:${name}` : ''}`;
  }
  if (ev.kind === 'met') return `met=${ev.personId}`;
  if (ev.kind === 'clash') {
    const reason = cleanReason(ev.reason);
    return `clash=${ev.a}:${ev.b}${reason ? `:${reason}` : ''}`;
  }
  if (ev.kind === 'rumor') {
    const what = cleanReason(ev.text, 100);
    return what ? `rumor=${ev.about}:${what}` : null;
  }
  if (ev.kind === 'new') {
    const name = cleanReason(ev.name).replace(/:/g, ' ').trim();
    return name ? `new=${name}` : null;
  }
  if (ev.kind === 'deal') {
    const what = cleanReason(ev.what);
    return what ? `deal${ev.closed ? '-' : ''}=${ev.a}:${ev.b}:${what}` : null;
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
function cleanReason(reason, max = ANALYSIS_LIMITS.reason) {
  return str(reason)
    .replace(/-->|[=[\]<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
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
  // Реакции и громкость — блок «что сочинено»: в метку движку не едут.
  return `${keepMarkerKinds(src, ['time'])}\n${analysisMarker(tokens.filter(isFactToken))}`;
}

/** Подпись анонимки без маски — одна на плашку, ленту и ответы. */
export const ANON_WHO = 'без подписи';

/**
 * Токен словами — для плашки под сообщением: «оценка: аналитическая химия — 5»,
 * «Петрова: теплее (немного) — помогла с опытом», «прогул: история».
 * Имена — из состояния; токен, который больше не читается (предмет удалили), —
 * как есть.
 *
 * Событие — без «в планы:»: оно и так стоит в разделе «В планы» плашки.
 * `known` — событие уже было в планах и не записано: тогда «уже в планах: …»,
 * а не как записанное. `brief` — для свёрнутой сводки, где раздела не видно:
 * там «в планы:» нужно.
 *
 * `day` — день сцены этого ответа: событие получает конкретную дату от него, а не
 * вечное «завтра» (баг 90); `today` — день календаря сейчас: событие позади помечается.
 *
 * @param {{known?: boolean, brief?: boolean, day?: string, today?: string}} [opts]
 */
export function tokenText(token, lexicon, { known = false, brief = false, day = '', today = '' } = {}) {
  // У пресета `classmates` — настройки курса, не список: берутся только массивы.
  const people = [...arr(lexicon.teachers), ...arr(lexicon.classmates)];
  const heroine = lexicon.names && typeof lexicon.names.user === 'string' ? lexicon.names.user.trim() : '';
  const gender = heroGender(lexicon, heroine);
  if (isReactToken(token)) {
    const r = reactionOf(token);
    if (!r) return String(token);
    // Анонимка без автора — и на плашке: кто пустил слух, курс не знает.
    // Маска видна и там: она и есть подпись анонимки.
    if (r.chan === 'anon') return r.nick ? `${nickWord(r.nick)}: «${r.text}»` : `${ANON_WHO}: «${r.text}»`;
    return `${authorWord(r, people, heroine, lexicon, gender)}: «${r.text}»`;
  }
  if (isReplyToken(token)) {
    const a = replyOf(token);
    if (!a) return String(token);
    const who = a.chan === 'anon' && !a.nick ? ANON_WHO : authorWord(a, people, heroine, lexicon, gender);
    return `${who}: «${a.text}»`;
  }
  if (isLoudToken(token)) {
    const row = LOUDNESS.find((l) => l.level === loudOf([token]));
    return row ? row.word : String(token);
  }
  if (isPrivateToken(token)) return 'наедине, без свидетелей';
  if (isPlayedToken(token)) {
    const hook = arr(lexicon.hooks).find((h) => h && h.id === token.slice(7));
    return hook ? `повод сыгран: ${hook.text}` : 'повод сыгран';
  }
  const ev = tokenEvent(token, lexicon);
  if (!ev) return String(token);
  if (SCENE_KINDS.includes(ev.kind)) return sceneText(ev, people, heroine, gender);
  const subject = (id) => {
    const s = (lexicon.subjects || []).find((x) => x.id === id);
    return (s && s.name) || id;
  };
  if (ev.kind === 'grade') return `оценка: ${subject(ev.subjectId)} — ${ev.value}`;
  if (ev.kind === 'completion') return `Сданы ${ev.scope === 'all' ? 'все зачёты и экзамены' : ev.scope === 'debts' ? 'все текущие хвосты' : subject(ev.scope)}: ${ev.value}`;
  if (ev.kind === 'attendance') return `${ev.status === 'late' ? 'опоздание' : 'прогул'}: ${subject(ev.subjectId)}`;
  if (ev.kind === 'event') {
    const span = ev.until > ev.days ? ` (${daysWord(ev.until - ev.days + 1)})` : '';
    const head = known ? 'уже в планах: ' : brief ? 'в планы: ' : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      const from = addDays(day, ev.days);
      const last = addDays(day, Math.max(ev.until, ev.days));
      const past = /^\d{4}-\d{2}-\d{2}$/.test(today) && today > last ? ' — уже прошло' : '';
      return `${head}${ev.name} — ${daysText(ev.days)}, ${dayWord(from)}${span}${past}`;
    }
    return `${head}${ev.name} — ${daysText(ev.days)}${span}`;
  }
  if (ev.kind === 'pause') {
    if (ev.end) return 'занятия возобновились';
    const name = ev.name ? `${ev.name} — ` : '';
    return `${name}занятий нет ${ev.days ? daysWord(ev.days) : 'до отмены'}`;
  }
  if (ev.kind === 'rel') {
    const t = people.find((x) => x.id === ev.teacherId);
    const who = (t && t.name) || ev.teacherId;
    const dir = ev.delta > 0 ? 'теплее' : 'холоднее';
    const how = ev.impact === 'major' ? 'заметно' : ev.impact === 'minor' ? 'немного' : '';
    return `${who}: ${dir}${how ? ` (${how})` : ''}${ev.reason ? ` — ${ev.reason}` : ''}`;
  }
  return String(token);
}

/**
 * Реакция или ответ в ветке по частям — для плашки, где автор и реплика
 * стоят разными узлами: человек — имя жирным, маска и «без подписи» — серым
 * курсивом (`style`: 'person' | 'mask' | 'anon'). Не реплика — `null`.
 */
export function talkParts(token, lexicon) {
  const people = [...arr(lexicon.teachers), ...arr(lexicon.classmates)];
  const heroine = lexicon.names && typeof lexicon.names.user === 'string' ? lexicon.names.user.trim() : '';
  const gender = heroGender(lexicon, heroine);
  const r = isReactToken(token) ? reactionOf(token) : isReplyToken(token) ? replyOf(token) : null;
  if (!r) return null;
  if (r.nick) return { who: nickWord(r.nick), say: r.text, style: 'mask' };
  if (r.chan === 'anon') return { who: ANON_WHO, say: r.text, style: 'anon' };
  const who = authorWord(r, people, heroine, lexicon, gender);
  return { who, say: r.text, style: r.who === SOMEONE || !r.who ? 'anon' : 'person' };
}

/**
 * «О чём» пост — подпись под реакцией на плашке и во вкладке ленты: факт
 * курса своей фразой (`scene.sceneAbout`), прочее — краткой строкой разбора.
 */
export function tokenAbout(token, lexicon) {
  const ev = tokenEvent(token, lexicon);
  if (ev && SCENE_KINDS.includes(ev.kind)) {
    const people = [...arr(lexicon.teachers), ...arr(lexicon.classmates)];
    const heroine = lexicon.names && typeof lexicon.names.user === 'string' ? lexicon.names.user.trim() : '';
  const gender = heroGender(lexicon, heroine);
    return sceneAbout(ev, people, heroine, gender);
  }
  return tokenText(token, lexicon, { brief: true });
}

/** Автор реплики словами: маска — «@школьный бес», человек — имя, иначе «кто-то с курса». */
function authorWord(r, people, heroine, lexicon, gender = 'f') {
  if (r.nick) return nickWord(r.nick);
  return r.who === SOMEONE || !r.who ? someoneWord(lexicon) : personWord(r.who, people, heroine, gender);
}

/** «сегодня», «завтра», «через 3 дня» — от дня сцены. */
function daysText(n) {
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  if (n === 2) return 'послезавтра';
  return `через ${daysWord(n)}`;
}

const MONTHS_GEN = ['', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «22 октября» из «2026-10-22». */
function dayWord(day) {
  const [, m, d] = String(day).split('-').map(Number);
  return `${d} ${MONTHS_GEN[m] || ''}`.trim();
}

/** «1 день», «3 дня», «5 дней». */
function daysWord(n) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  const word = a > 10 && a < 20 ? 'дней' : b === 1 ? 'день' : b > 1 && b < 5 ? 'дня' : 'дней';
  return `${n} ${word}`;
}

/** Токен обратно в событие разборщика; не читается — `null`. */
export function tokenEvent(token, lexicon) {
  return parseMarker(analysisMarker([token]), lexicon).events[0] || null;
}

function arr(v) {
  return Array.isArray(v) ? v : [];
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
    .filter((part) => /экзамен|зач[её]т|хвост|оценк|отметк|профессор|преподавател|прогул|опозда|сдал|сдан|сдач|праздн|(?<![а-яё])бал(?!л)|вечеринк|концерт|ярмарк|фестивал|турнир|поход|свидани|через .{0,12}(дн|недел)|завтра|послезавтра|в (понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)|ссор|ругал|скандал|слух|сплетн|говорят|обещал|одолжил|верн[её]т|конспект|exam|grade|passed/iu.test(part))
    .join('\n');
  return [source.slice(0, edge), relevant.slice(0, budget - edge * 2), source.slice(-edge)]
    .filter(Boolean).join(separator);
}

/** Длинный текст режется с начала: конец ответа — то, чем сцена кончилась. */
function clip(text, limit) {
  const s = str(text);
  return s.length > limit ? `…${s.slice(s.length - limit)}` : s;
}

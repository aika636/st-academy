// core/exams — сессия как режим и исход контрольного события.
//
// Здесь живёт ядро ценности расширения (3.5): момент, когда злопамятная Петрова
// решает судьбу семестра. Четыре решения, из которых вытекает весь модуль.
//
// 1. **Исход считает расширение, а не модель.** Модель исход отыгрывает, но не
//    выдумывает: иначе накопленный балл, прогулы и отношения не значат ничего.
//    Формула — накопленный балл + отношение преподавателя + случайность.
//
// 2. **Случайность зажата.** Прямое требование 3.5: отличница не должна
//    заваливаться на ровном месте. Зажим устроен не «переброс, если не нравится»,
//    а долей в взвешенной сумме: вклад случая ограничен сверху (`exams.maxLuck`),
//    поэтому у сильного балла нижняя граница результата лежит выше проходной.
//    Это проверяемое свойство, а не обещание — см. тест на тысячу прогонов.
//    `rng` инжектится аргументом ровно ради воспроизводимости тестов.
//
// 3. **Считает расширение, но не задним числом.** Если модель уже написала свой
//    исход, `resolveConflict` принимает версию модели и пишет расхождение в
//    журнал. Спорить с написанным текстом и гонять человека по свайпам — худшее,
//    что тут можно сделать, поэтому такой ветки в коде просто нет.
//
// 4. **Посчитанный факт подаётся одноразовым повелительным инжектом** (приём из
//    `childgenderdice`): не справка «балл 3.4», а «зачёт не сдан, отыграй это»,
//    и снимается он первым же `takePending`.
//
// Ни одного числа и ни одного слова сеттинга в логике: шкала оценок, виды
// контрольных, пересдачи, автомат, веса и фразы — всё приходит из пресета.
// Хогвартс меняет пресет, а не этот файл.

import {
  cloneState, pushJournal, pushPending, findSubject, teacherOfSubject, clamp, isDay,
} from './state.mjs';
// Календарь считает `time.mjs`, зачётку — `gradebook.mjs`. Здесь только исход и
// его подача: своя арифметика дат и своя запись оценки означали бы два ответа на
// один вопрос — см. правки швов ниже по файлу.
import { addDays, diffDays, mondayOf, termAt, phaseOf } from './time.mjs';
import { addGrade, subjectScore, stampDebt, DEBT_EXAM, DEBT_MISSED } from './gradebook.mjs';

/**
 * Значения по умолчанию — ДАННЫЕ, а не логика: каждое перекрывается пресетом.
 * Лежат здесь одним блоком, чтобы ниже в коде не было ни одной голой константы.
 */
export const DEFAULTS = {
  /** Веса слагаемых исхода. Нормируются по сумме, так что пресет волен писать любые числа. */
  weights: { score: 0.6, relation: 0.2, luck: 0.2 },
  /** Потолок доли случая после нормировки. Тот самый зажим из 3.5. */
  maxLuck: 0.25,
  /** Сколько пересдач сверх первой попытки, если пресет молчит. */
  retakes: 1,
};

/**
 * Фразы по умолчанию. Это тоже данные: пресет перекрывает их блоком
 * `preset.phrases.exams`, и никакой другой русский текст в модуле не встречается.
 * Плейсхолдеры `{имя}` подставляются из словаря пресета и состояния.
 */
export const DEFAULT_PHRASES = {
  auto: 'Свершилось: {subject} — {value} без испытания ({teacher}). Отыграй это как уже случившееся.',
  passed: 'Свершилось: {subject} — {value} ({teacher}). Отыграй это как уже случившееся.',
  failed: 'Свершилось: {subject} — {value} ({teacher}). Отправлена на пересдачу, попыток осталось: {left}. Отыграй это как уже случившееся.',
  exhausted: 'Свершилось: {subject} — {value} ({teacher}). Попытки исчерпаны, {debt} остаётся. Отыграй это как уже случившееся.',
  permissionAuto: '{examPeriod}: {subject} — {scoreName} {score}, {auto} возможен. Провал на ровном месте отыгрывать запрещено.',
  permissionNoAuto: '{examPeriod}: {subject} — {scoreName} {score}, {auto} невозможен; {teacher} принимает на общих основаниях. Блестящую сдачу без испытания отыгрывать запрещено.',
  permissionRisk: '{examPeriod}: {subject} — {scoreName} {score}, сдача под вопросом; {teacher} вправе отправить на пересдачу. Успешный исход отыгрывать запрещено, его считает система.',
  divergence: 'Расхождение по {subject}: посчитано {computed}, отыграно {said}. Принята версия модели.',
  scheduled: '{examPeriod}: назначено {count}.',
  // Отдельная фраза у видов с собственной неделей: сессии в этот день нет, и
  // говорить «сессия: назначено 5» посреди учебных недель значило бы обещать
  // режим, которого не будет. Названием тут служит сам вид из пресета.
  scheduledKind: '{kind}: назначено {count}.',
  missed: '{examPeriod} закончена: {subject} — не сдано, {debt} остаётся.',
};

// --- чтение пресета ---------------------------------------------------------

const examsOf = (preset) => (preset && preset.exams) || {};
const gradesOf = (preset) => (preset && preset.grades) || {};
const vocabOf = (preset) => (preset && preset.vocab) || {};
const phrasesOf = (preset) => ({ ...DEFAULT_PHRASES, ...((preset && preset.phrases && preset.phrases.exams) || {}) });

/** Виды контрольных событий: `preset.exams.kinds`. */
export const examKinds = (preset) => examsOf(preset).kinds || [];

/** Вид по id; неизвестный id — первый вид пресета, иначе решать нечем. */
export function kindOf(preset, kindId) {
  const kinds = examKinds(preset);
  return kinds.find((k) => k.id === kindId) || kinds[0] || null;
}

/**
 * Вид по id **строго**, без подстановки первого вида. `kindOf` подставляет его
 * нарочно — исход нельзя посчитать «ни по какому виду», — но вопрос «есть ли у
 * этого вида своё окно в календаре» подстановки не терпит: неизвестный id
 * получил бы чужое окно и завёл бы события, которых пресет не просил.
 */
const exactKind = (preset, kindId) => examKinds(preset).find((k) => k.id === kindId) || null;

/**
 * Неделя учебного периода, на которой вид заводит свои события, — поле `atWeek`
 * в пресете. `null` значит «своего окна нет»: такой вид заводится входом в
 * экзаменационную фазу, ровно как заводились все виды до появления поля.
 *
 * В коде это число и только число. «Середина периода» — знание сеттинга, и
 * назвать её словом здесь значило бы поселить в движке учебный термин: японский
 * пресет пишет `atWeek: 7` у 中間考査 и молчит у 期末考査, а вуз и академия магии
 * не пишут его вовсе и не отличают этот файл от прежнего.
 */
export const kindWeek = (kind) => (
  kind && Number.isFinite(kind.atWeek) && kind.atWeek >= 1 ? Math.floor(kind.atWeek) : null
);

/** Есть ли у события собственное окно в календаре — по виду, а не по самому событию. */
export const isDatedExam = (preset, item) => kindWeek(exactKind(preset, item && item.kind)) !== null;

const isPassScale = (v) => v.points === null || v.points === undefined;
const isPointScale = (v) => typeof v.points === 'number' && Number.isFinite(v.points);

/**
 * Ключ желательности значения: сперва проходное, потом больше баллов. Пара
 * чисел, а не одно составное: сложение «флаг × огромное число + баллы» теряет
 * младший разряд на больших множителях и путает соседние оценки.
 */
const rankKey = (v) => [v.pass === false ? 0 : 1, isPointScale(v) ? v.points : 0];
const rankCmp = (a, b) => (rankKey(b)[0] - rankKey(a)[0]) || (rankKey(b)[1] - rankKey(a)[1]);
const rankId = (v) => rankKey(v).join(':');

/**
 * Лестница значений, подходящих виду события, от лучшего к худшему.
 *
 * Дубли по «весу» схлопываются, и это не мелочь: в русском пресете `автомат`
 * стоит теми же пятью баллами, что и `5`. Правило — среди одинаковых по весу
 * значений первое в пресете считается обычной оценкой (она в лестнице), а
 * последнее — тем, что ставят в обход испытания (см. `autoValue`). Пресет,
 * которому такое угадывание не нравится, пишет `exams.autoValue` явно.
 */
export function outcomeLadder(preset, kindId) {
  const kind = kindOf(preset, kindId);
  const scale = kind && kind.scale;
  const all = (gradesOf(preset).values || []).filter(scale === 'pass' ? isPassScale : isPointScale);
  const sorted = all
    .map((v, i) => ({ v, i }))
    .sort((a, b) => rankCmp(a.v, b.v) || a.i - b.i);

  const rungs = [];
  const seen = new Set();
  for (const { v } of sorted) {
    const key = rankId(v);
    if (seen.has(key)) continue;
    seen.add(key);
    rungs.push(v);
  }
  return rungs;
}

/** Значение, которое ставят без испытания (автомат). */
export function autoValue(preset, kindId) {
  if (examsOf(preset).autoValue) return String(examsOf(preset).autoValue);
  const kind = kindOf(preset, kindId);
  const all = (gradesOf(preset).values || []).filter(kind && kind.scale === 'pass' ? isPassScale : isPointScale);
  if (!all.length) return '';
  const best = all.slice().sort(rankCmp)[0];
  const same = all.filter((v) => rankId(v) === rankId(best));
  return String(same[same.length - 1].value);
}

/** Описание значения шкалы по его строке, с учётом синонимов пресета. */
export function gradeInfo(preset, value) {
  const g = gradesOf(preset);
  const raw = String(value == null ? '' : value).trim();
  const canonical = (g.aliases && g.aliases[raw.toLowerCase()]) || raw;
  return (g.values || []).find((v) => String(v.value) === String(canonical)) || null;
}

/** Проходное ли значение. Неизвестное значение проходным не считается. */
export const isPassing = (preset, value) => Boolean(gradeInfo(preset, value) && gradeInfo(preset, value).pass);

/** Сколько попыток всего даёт пресет: первая плюс пересдачи. */
export const attemptsAllowed = (preset) => 1 + numberOr(examsOf(preset).retakes, DEFAULTS.retakes);

/** Сколько попыток осталось у события. */
export const retakesLeft = (preset, item) => Math.max(0, attemptsAllowed(preset) - numberOr(item && item.attempts, 0));

// --- назначение сессии ------------------------------------------------------

/**
 * Какие виды контрольных положены предмету. Порядок проверок — от частного к
 * общему, первое сработавшее правило и решает.
 *
 * 1. `subject.examKinds` — список видов, заданный планом или руками. Самое
 *    частное: у одного предмета может быть теория и практика, у соседнего нет.
 * 2. `subject.examKind` — один вид, старое поле; оно осталось в состоянии и в
 *    сгенерированных планах, поэтому продолжает работать.
 * 3. Виды с `everySubject: true` в пресете — «это сдают все». Так живут
 *    японские 中間考査 и 期末考査: середина и конец по каждому предмету.
 * 4. Иначе виды раздаются по кругу — детерминированно, без броска: пересборка
 *    состояния должна давать ту же сессию.
 *
 * Пресет, не написавший ни одного флага, попадает в четвёртый пункт и получает
 * ровно то же поведение, что и до появления видов: одно событие на предмет.
 *
 * @param {Object} preset
 * @param {Object} subject
 * @param {number} rr номер для раздачи по кругу
 * @returns {Object[]} виды из `preset.exams.kinds`
 */
export function kindsForSubject(preset, subject, rr = 0) {
  const kinds = examKinds(preset);
  if (!kinds.length) return [];

  const listed = Array.isArray(subject && subject.examKinds) ? subject.examKinds : [];
  const picked = listed.map((id) => kinds.find((k) => k.id === id)).filter(Boolean);
  if (picked.length) return picked;

  const one = subject && subject.examKind ? kinds.find((k) => k.id === subject.examKind) : null;
  if (one) return [one];

  const every = kinds.filter((k) => k.everySubject === true);
  if (every.length) return every;

  return [kinds[((rr % kinds.length) + kinds.length) % kinds.length]];
}

/**
 * Номер учебного периода, которому принадлежит сессия этого дня.
 *
 * Своей арифметики нет: период дню назначает `time.termAt`, здесь только выбор
 * умолчания. Пресет без дат периодов не описывает вовсе (`termAt` возвращает
 * −1), и такая сессия считается нулевой — одной на всю игру. Это ровно то, чем
 * сессия была до появления `calendar.terms`, поэтому пресеты на трёх скалярах
 * ничего не замечают.
 */
export function examTermIndex(preset, state, day) {
  const when = isDay(day) ? day : (state.calendar && state.calendar.day);
  const at = termAt(preset, state, when);
  return at.index >= 0 ? at.index : 0;
}

/**
 * Балл, по которому судят на сессии: средний **внутри того периода**, к которому
 * приписано событие, а не за всю игру.
 *
 * Почему не годовой. Годовой балл делает триместры декорацией: отучившись первый
 * на пятёрки, можно прогулять третий целиком — среднее всё равно держится выше
 * `autoPassScore`, и итоговая аттестация третьего триместра выдаётся автоматом.
 * Тот же балл сравнивается с порогом автомата и уходит в фразу разрешения, так
 * что периодным он обязан стать во всех трёх местах разом — потому и считается
 * здесь, одной функцией, а не тремя выражениями у вызывающего.
 *
 * У пресета с одним периодом («год» и «период» — одно и то же) фильтр
 * тождественный, и балл остаётся ровно прежним; это проверено тестом, а не
 * обещано. Балл зачётки на экране остаётся годовым нарочно — см. `subjectScore`.
 *
 * Пустой период — не ноль и не провал: балла ещё нет, и берётся стартовый из
 * пресета, ровно как при пустой зачётке до появления периодов.
 *
 * @param {Object} state
 * @param {Object} preset
 * @param {{subjectId: string, term?: number, day?: string}} item контрольное событие
 * @returns {number}
 */
export function examScore(state, preset, item) {
  const subjectId = item && item.subjectId;
  const term = Number.isFinite(item && item.term)
    ? item.term
    : examTermIndex(preset, state, item && item.day);
  const average = subjectScore(state, subjectId, preset, { term }).average;
  return average ?? (preset && preset.grades && preset.grades.startScore);
}

/**
 * Кончилась ли открытая сессия — то есть ушёл ли день из экзаменационных недель
 * ТОГО периода, чью сессию завели.
 *
 * Отдельный вопрос от `phaseOf`: суббота посреди экзаменационной недели — это
 * `weekend`, но сессия в эту субботу не кончается, иначе она закрывалась бы
 * каждые выходные и открывалась заново в понедельник. Поэтому здесь спрашивают
 * не фазу, а окно периода.
 *
 * Пресет без объявленных периодов судить не даёт: окна нет, и закрывать сессию
 * по догадке хуже, чем оставить её открытой (её всё равно закроет человек или
 * конец игры). Состояние старой схемы, где номера периода ещё нет, тоже
 * не трогается — но такого после `state.migrate` уже не бывает.
 */
export function examSessionEnded(state, preset, day = state.calendar && state.calendar.day) {
  const exams = (state && state.exams) || {};
  if (!exams.active) return false;
  if (!Number.isFinite(exams.term)) return false;
  const at = termAt(preset, state, day);
  if (!at.term) return false;
  if (at.index !== exams.term) return true;
  return !(at.inside && at.week > at.term.studyWeeks);
}

/**
 * Закрыть сессию, не трогая её результаты.
 *
 * Гаснет только флаг режима: сданные контрольные остаются в `items` навсегда —
 * из них складывается зачётка, и стирать их между триместрами значило бы терять
 * год по частям. Номер периода тоже остаётся: по нему видно, чья сессия была
 * последней, и по нему же `applyResponse` понимает, что следующая — уже другая.
 *
 * **Несевшее становится хвостом.** Событие, за которое так и не сели
 * (`outcome === null`), после закрытия сессии не имеет ни одного пути к исходу:
 * `sitExam` берёт кандидатов только из открытой сессии, а панель — только из
 * событий текущего периода, так что при открытии следующей сессии оно исчезало
 * с экрана молча — без хвоста, без строки в журнале, навсегда. Тихая потеря
 * запрещена (3.8), поэтому закрытие переводит несевшее в хвост по предмету и
 * пишет об этом фразой пресета. Отметка `missed` на событии нужна, чтобы второе
 * закрытие того же периода не считало его заново.
 *
 * Заваленное с оставшимися пересдачами закрытие **не трогает**: хвост ему
 * ставит только исчерпание попыток, и менять это правило здесь значило бы
 * решать вопрос пересдач мимоходом (см. `etap-terms.md`).
 */
export function closeExamSession(state, preset) {
  const next = cloneState(state);
  if (!next.exams.active) return next;
  next.exams.active = false;

  const term = next.exams.term;
  const ph = phrasesOf(preset);
  const missed = [];
  for (const item of next.exams.items || []) {
    if (Number.isFinite(term) && Number.isFinite(item.term) && item.term !== term) continue;
    if (!(item.outcome === null || item.outcome === undefined || item.outcome === '')) continue;
    if (item.missed) continue;
    item.missed = true;
    missed.push(item);

    const subject = findSubject(next, item.subjectId);
    if (subject && !subject.debt) {
      subject.debt = true;
      stampDebt(subject, DEBT_MISSED);
    }
    const kind = kindOf(preset, item.kind);
    pushJournal(next, {
      kind: 'exam',
      text: fill(ph.missed, {
        subject: (subject && subject.name) || item.subjectId,
        kind: (kind && kind.name) || String(item.kind || ''),
        debt: vocabOf(preset).debt || '',
        examPeriod: vocabOf(preset).examPeriod || '',
      }),
      // `value` тут нет нарочно: в хронику лорбука попадает исход, а несостоявшееся
      // испытание исходом не является (`lorebook.isSignificant`).
      data: { examId: item.id, subjectId: item.subjectId, missed: true, term },
    }, preset);
  }

  // У самого закрытия фразы по-прежнему нет: «сессия кончилась» — это не событие
  // сюжета, а смена режима, и придумывать под неё лексический ключ в трёх
  // пресетах значит брать плату за механику, которой человек не видит. В
  // отладку — видно.
  pushJournal(next, { kind: 'debug', text: '', data: { examsClosed: term, missed: missed.length } }, preset);
  return next;
}

/**
 * События сессии того периода, что открыт сейчас.
 *
 * Событие прошлого триместра не «несдано», а «сдано и в прошлом»: показывать его
 * в остатке текущей сессии и подсовывать `sitExam` значило бы пересдавать
 * январь в июне. Событию без номера периода (состояние, не прошедшее миграцию,
 * или собранное руками в тесте) верят на слово — оно считается своим, потому что
 * до появления периодов вся сессия была одна.
 */
function sessionItems(state) {
  const exams = (state && state.exams) || {};
  const items = exams.items || [];
  if (!Number.isFinite(exams.term)) return items;
  return items.filter((i) => !Number.isFinite(i.term) || i.term === exams.term);
}

/**
 * Завести контрольные события на каждый предмет при входе в сессию.
 *
 * **Ключ отсева — период ПЛЮС предмет ПЛЮС вид.** Раньше на предмет приходилось
 * ровно одно событие, потом добавился вид («середина» и «конец» по одной
 * дисциплине), теперь — период: у японского пресета три триместра, и у каждого
 * своя сессия по тем же предметам и тем же видам. Без номера периода в ключе
 * события первого триместра навсегда занимали бы места событий второго, а без
 * номера в id два события разных триместров были бы неразличимы для
 * `applyOutcome`, который ищет событие по id. Поэтому номер стоит и в ключе
 * отсева, и в самом id (`период:предмет:вид`), а не в одном из двух мест.
 *
 * Повторный вызов внутри одного периода по-прежнему ничего не плодит — это
 * важно, потому что «вход в период» календарь может сообщить не один раз.
 *
 * **Виды можно завести не все сразу.** `opts.kinds` — список id: он нужен видам
 * с собственной неделей (`atWeek`), которые заводятся посреди учебных недель, а
 * не входом в сессию. `opts.session: false` при этом означает «событий добавили,
 * а режим не включали»: флаг `active` и номер сессии остаются как были, потому
 * что сессия — это режим экрана и промпта, а не список событий (см.
 * `scheduleDatedExams`).
 *
 * @param {Object} state
 * @param {Object} preset
 * @param {{day?: string, term?: number, kinds?: string[], session?: boolean}} [opts]
 *   день назначения и номер периода (номер не задан — берётся из календаря по
 *   этому дню); `kinds` — только эти виды; `session: false` — не включать режим
 * @returns {Object} новое состояние
 */
export function scheduleExams(state, preset, opts = {}) {
  const next = cloneState(state);
  const day = isDay(opts.day) ? opts.day : null;
  const term = Number.isFinite(opts.term) ? opts.term : examTermIndex(preset, next, day);
  const only = Array.isArray(opts.kinds) ? new Set(opts.kinds) : null;
  const session = opts.session !== false;
  const items = next.exams.items;
  const had = new Set(items.map((i) => i.id));

  // Номер для раздачи по кругу — позиция предмета в списке, а не счётчик
  // добавленных. Счётчик менялся от вызова к вызову, и повторный вызов раздавал
  // тем же предметам другие виды: отсев по паре «предмет + вид» пропускал их как
  // новые и плодил вторые события. Позиция же не зависит от того, что уже
  // заведено, поэтому повтор идемпотентен по-настоящему.
  let added = 0;
  const byKind = new Map();
  for (let pos = 0; pos < next.subjects.length; pos += 1) {
    const subject = next.subjects[pos];
    if (!subject.id) continue;
    for (const kind of kindsForSubject(preset, subject, pos)) {
      if (only && !only.has(kind.id)) continue;
      const id = `${term}:${subject.id}:${kind.id}`;
      if (had.has(id)) continue;
      had.add(id);
      byKind.set(kind.id, (byKind.get(kind.id) || 0) + 1);
      items.push({
        id,
        term,
        subjectId: subject.id,
        kind: kind.id,
        day,
        outcome: null,
        attempts: 0,
      });
      added += 1;
    }
  }

  if (session) {
    next.exams.active = true;
    next.exams.term = term;
  }
  if (added && session) {
    pushJournal(next, {
      kind: 'exam',
      text: fill(phrasesOf(preset).scheduled, { examPeriod: vocabOf(preset).examPeriod || '', count: String(added) }),
      data: { added, day },
    }, preset);
  }
  if (added && !session) {
    // Строка на каждый вид, а не одна на всех: вид со своим окном — это то, что
    // человек и модель видят по имени («промежуточная аттестация назначена»), и
    // склеивать два вида в одно число значило бы отобрать у записи её имя.
    for (const [kindId, count] of byKind) {
      pushJournal(next, {
        kind: 'exam',
        text: fill(phrasesOf(preset).scheduledKind, {
          kind: (exactKind(preset, kindId) || {}).name || kindId,
          count: String(count),
        }),
        data: { added: count, day, kind: kindId, term },
      }, preset);
    }
  }
  return next;
}

/**
 * Завести события видов, у которых есть собственная неделя, когда календарь до
 * этой недели дошёл.
 *
 * **Свой сторож от повторного заведения, и он другой.** У входа в сессию
 * сторожем стоит «открыта ли сессия ИМЕННО этого периода» (`engine.mjs`), и
 * здесь он не годится вовсе: событие с собственной неделей живёт посреди
 * учебных недель, когда сессии нет, и поднимать ради него флаг режима значило
 * бы врать панели, промпту и расписанию. Сторожит поэтому ключ события
 * `период:предмет:вид`, по которому отсеивает `scheduleExams`: сколько бы раз
 * календарь ни сообщил «неделя семь», второго события с тем же ключом не
 * появится, потому что первое из состояния не исчезает никогда — ни закрытие
 * сессии, ни переход в следующий период его не стирают. У сессии сторож нужен
 * был ещё и от лишней строки в журнале на каждом ответе; здесь ту же работу
 * делает счётчик добавленного: не добавилось — не записано.
 *
 * **Неделя — «эта и дальше», а не «ровно эта».** Календарь ходит рывками:
 * одна метка умеет двинуть время на две недели, и проверка на равенство молча
 * теряла бы событие целиком (3.8). Пропущенное рывком заводится с опозданием —
 * сдать его ещё можно, а не сдадут, так оно станет хвостом при закрытии сессии,
 * как любое несевшее.
 *
 * @returns {{state: Object, added: number}}
 */
export function scheduleDatedExams(state, preset, day = state && state.calendar && state.calendar.day) {
  const at = termAt(preset, state, day);
  if (!at.term || !at.inside) return { state, added: 0 };
  const due = examKinds(preset).filter((k) => {
    const week = kindWeek(k);
    return week !== null && at.week >= week;
  });
  if (!due.length) return { state, added: 0 };

  const before = ((state.exams && state.exams.items) || []).length;
  const next = scheduleExams(state, preset, {
    day,
    term: at.index >= 0 ? at.index : 0,
    kinds: due.map((k) => k.id),
    session: false,
  });
  return { state: next, added: next.exams.items.length - before };
}

/**
 * События с собственным окном, за которые ещё можно сесть в этот день: своего
 * периода, назначенные не позже дня, не закрытые и не ставшие хвостом.
 *
 * Период берётся у ДНЯ, а не у `exams.term`: до первой сессии периода номер в
 * состоянии всё ещё от прошлой сессии, и фильтр `sessionItems` выбросил бы
 * событие середины как «чужое». В этом и состоит разница между «событием
 * периода» и «сессией»: сессия — режим, у неё свой номер и свои ворота, а
 * событие со своим окном принадлежит календарю.
 */
export function datedExams(state, preset, day = state && state.calendar && state.calendar.day) {
  const items = (state && state.exams && state.exams.items) || [];
  const at = termAt(preset, state, day);
  if (!at.inside) return [];
  const term = at.index >= 0 ? at.index : 0;
  return items.filter((i) => isDatedExam(preset, i)
    && (!Number.isFinite(i.term) || i.term === term)
    && !i.missed
    && unfinished(preset, i)
    && (!isDay(i.day) || diffDays(i.day, day) >= 0));
}

/**
 * За что можно сесть сегодня — единственное место, где сходятся два канала:
 * открытая сессия и события со своим окном.
 *
 * Фаза спрашивается здесь, а не у `sitExam`: садит за контрольное вызывающая
 * сторона (`index.js`, панель, тест), и запрещать ей это ядром значило бы
 * менять давнее правило заодно с новым. События со своим окном требуют учебного
 * дня внутри периода (`study` — уроки в этот день идут, контрольная случается на
 * одном из них), сессия — экзаменационного, как и раньше; в воскресенье не
 * бывает ни того, ни другого.
 */
export function sittableExams(state, preset, day = state && state.calendar && state.calendar.day) {
  const phase = phaseOf(preset, state, day);
  const out = [];
  if (phase === 'study' || phase === 'exams') out.push(...datedExams(state, preset, day));
  const mode = examMode(state, preset);
  if (phase === 'exams' && mode.active) {
    for (const item of mode.pending) if (!out.some((x) => x.id === item.id)) out.push(item);
  }
  return out;
}

/**
 * Режим сессии: активна ли, что не сдано, сколько дней осталось.
 *
 * Несданное считается по событиям **открытой** сессии, а не по всем, что лежат в
 * состоянии: см. `sessionItems`.
 *
 * Остаток считается по длине **того** учебного периода, в котором мы сейчас
 * (`time.termAt`), и равен `null`, если пресет о длине молчит. Свой календарь
 * модуль не заводит: датами ведает `time.mjs`, здесь только вычитание.
 */
export function examMode(state, preset) {
  const active = Boolean(state && state.exams && state.exams.active);
  return {
    active,
    pending: sessionItems(state).filter((i) => unfinished(preset, i)),
    daysLeft: active ? daysLeftOf(state, preset) : null,
  };
}

/**
 * Закрыто ли контрольное событие.
 *
 * Не закрыто оно в двух случаях: его ещё не сдавали или сдали непроходно, а
 * пересдача осталась. Раньше здесь стояло только первое, и пересдача была
 * механикой, до которой нельзя было дотянуться: `engine.sitExam` берёт
 * кандидата ровно отсюда, а после первой же попытки `outcome` переставал быть
 * пустым — событие выпадало из списка вместе с обещанием «отправлена на
 * пересдачу, попыток осталось: 2». Панель при этом говорила «несдано: 0» по
 * предмету, который не сдан и хвостом ещё не стал.
 *
 * Исчерпавшее попытки событие из списка выпадает по-прежнему: там уже не
 * пересдача, а хвост, и говорить о нём — дело зачётки.
 */
function unfinished(preset, item) {
  if (!item) return false;
  if (item.outcome === null || item.outcome === undefined || item.outcome === '') return true;
  return !isPassing(preset, item.outcome) && retakesLeft(preset, item) > 0;
}

/**
 * Остаток дней сессии.
 *
 * Шов с `time.mjs`: конец периода обязан совпадать с тем, где `phaseOf` перестаёт
 * говорить `exams`, а `phaseOf` считает недели от **понедельника** недели
 * `termStart` (`weekIndex`), а не от самой даты начала. Прежняя арифметика
 * (`termStart + N×7 суток`) при семестре, начавшемся не в понедельник, уезжала
 * на целую неделю: 1 сентября 2024 — воскресенье, и в последний день сессии
 * модуль обещал ещё девять дней вместо двух. Поэтому здесь тот же `mondayOf` и
 * то же вычитание дней, что и в календаре, а не свои `Date.parse` и `DAY_MS`.
 *
 * С появлением нескольких периодов шов тот же, только период берётся не первый,
 * а текущий: во втором триместре «дней осталось» обязано считаться до конца
 * второго, иначе на экране висит отрицательное число.
 */
function daysLeftOf(state, preset) {
  const start = state.calendar && state.calendar.termStart;
  const today = state.calendar && state.calendar.day;
  if (!isDay(start) || !isDay(today)) return null;
  const at = termAt(preset, state, today);
  const term = at.term;
  // Длина должна быть объявлена пресетом целиком: подставленное умолчание — это
  // не знание о календаре, а догадка, и врать числом хуже, чем промолчать.
  if (!term || !Number.isFinite(term.declared.studyWeeks) || !Number.isFinite(term.declared.examWeeks)) return null;
  const lastDay = addDays(mondayOf(term.start), term.span * 7 - 1);
  return diffDays(today, lastDay);
}

// --- исход ------------------------------------------------------------------

/**
 * Веса после нормировки и зажима случая. Пресет может написать любые числа —
 * сумма приводится к единице, а доля случая обрезается потолком `maxLuck`, и
 * отнятое уходит в балл. Без этой обрезки пресет с «весом случая 10» вернул бы
 * лотерею и сломал бы требование 3.5 из чужого файла настроек.
 */
export function outcomeWeights(preset) {
  const w = { ...DEFAULTS.weights, ...(examsOf(preset).weights || {}) };
  const score = Math.max(0, numberOr(w.score, 0));
  const relation = Math.max(0, numberOr(w.relation, 0));
  const luckRaw = Math.max(0, numberOr(w.luck, 0));
  const sum = score + relation + luckRaw;
  if (!sum) return { score: 1, relation: 0, luck: 0 };
  const cap = clamp(numberOr(examsOf(preset).maxLuck, DEFAULTS.maxLuck), 0, 1);
  const luck = Math.min(luckRaw / sum, cap);
  const rest = 1 - luck;
  const other = score + relation;
  return other
    ? { score: (score / other) * rest, relation: (relation / other) * rest, luck }
    : { score: rest, relation: 0, luck };
}

/** Накопленный балл в долю 0..1 по размаху числовой шкалы пресета. */
export function normalizeScore(preset, score) {
  const points = (gradesOf(preset).values || []).filter(isPointScale).map((v) => v.points);
  if (points.length < 2) return clamp(numberOr(score, 0), 0, 1);
  const min = Math.min(...points);
  const max = Math.max(...points);
  return clamp((numberOr(score, min) - min) / (max - min), 0, 1);
}

/** Отношение преподавателя в долю 0..1 по размаху `preset.relations`. */
export function normalizeRelation(preset, relation) {
  const r = (preset && preset.relations) || {};
  const min = numberOr(r.min, 0);
  const max = numberOr(r.max, 0);
  if (max <= min) return clamp(numberOr(relation, 0), 0, 1);
  return clamp((numberOr(relation, numberOr(r.start, min)) - min) / (max - min), 0, 1);
}

/**
 * Исход контрольного события.
 *
 * @param {{score: number, relation: number, kind: string}} input
 * @param {Object} preset
 * @param {() => number} [rng] инжектится ради воспроизводимости тестов
 * @returns {{value: string, roll: number, reason: string, parts: Object}}
 */
export function rollOutcome({ score, relation, kind }, preset, rng = Math.random) {
  const w = outcomeWeights(preset);
  const s = normalizeScore(preset, score);
  const r = normalizeRelation(preset, relation);
  const luck = clamp(numberOr(rng(), 0), 0, 1);
  const roll = w.score * s + w.relation * r + w.luck * luck;
  const parts = { score: s, relation: r, luck, weights: w };

  const auto = numberOr(examsOf(preset).autoPassScore, Infinity);
  if (numberOr(score, -Infinity) >= auto) {
    return { value: autoValue(preset, kind), roll, reason: 'auto', parts };
  }

  const ladder = outcomeLadder(preset, kind);
  if (!ladder.length) return { value: '', roll, reason: 'noScale', parts };
  const idx = clamp(Math.floor((1 - roll) * ladder.length), 0, ladder.length - 1);
  return { value: String(ladder[idx].value), roll, reason: 'roll', parts };
}

// --- запись исхода ----------------------------------------------------------

/**
 * Записать исход и поставить одноразовый повелительный инжект.
 *
 * Инжект — не справка, а уже случившийся факт: модель обязана его отыграть в
 * следующем ответе, а `takePending` снимет его сразу после. Текст собирается из
 * фраз пресета, id инжекта включает номер попытки — пересдача должна инжектиться
 * заново, а не считаться дублем.
 *
 * @returns {{state: Object, pending: ?Object}}
 */
export function applyOutcome(state, { examId, value, day, reason }, preset) {
  let next = cloneState(state);
  let item = next.exams.items.find((i) => i.id === examId);
  if (!item) return { state: next, pending: null };

  const when = isDay(day) ? day : (next.calendar && next.calendar.day) || '';
  const passed = isPassing(preset, value);
  item.outcome = String(value);
  item.attempts = numberOr(item.attempts, 0) + 1;
  if (when) item.day = when;

  // Шов с `gradebook.mjs`: оценку в зачётку пишет он, а не мы. Своя запись
  // `subject.grades.push` рядом с `addGrade` означала бы два места, где оценка
  // появляется в зачётке, — и первый же вызывающий, сшивший метку с сессией,
  // записал бы её дважды. Хвост после `addGrade` переставляется: по обычной
  // оценке хвост даёт любой непроходной балл, а на сессии — только исчерпание
  // попыток, пересдача хвостом ещё не считается.
  const graded = addGrade(next, { subjectId: item.subjectId, value, day: when }, preset);
  if (graded.applied) {
    next = graded.state;
    item = next.exams.items.find((i) => i.id === examId);
  }

  const subject = findSubject(next, item.subjectId);
  const teacher = teacherOfSubject(next, item.subjectId);
  if (subject) {
    if (!graded.applied) subject.grades.push({ value: String(value), day: when });
    subject.debt = !passed && retakesLeft(preset, item) <= 0;
    // Причина переставляется вместе с флагом: `addGrade` выше уже назвал хвост
    // «за оценку», но на сессии он ставится по другому правилу и называться
    // должен по нему же. Что проходной исход снимает при этом хвост, поставленный
    // за прогулы, — известное столкновение источников: правило не меняется здесь,
    // теперь только видно, чей хвост исчез (`etap-terms.md`).
    stampDebt(subject, DEBT_EXAM);
  }

  const left = retakesLeft(preset, item);
  const ph = phrasesOf(preset);
  const info = gradeInfo(preset, value);
  const vars = {
    subject: (subject && subject.name) || item.subjectId,
    value: (info && info.label) || String(value),
    teacher: (teacher && teacher.name) || vocabOf(preset).teacher || '',
    left: String(left),
    debt: vocabOf(preset).debt || '',
    examPeriod: vocabOf(preset).examPeriod || '',
  };
  // «Без испытания» узнаётся по причине исхода, а не по значению: в шкале
  // «зачёт/незачёт» автомат и обычная сдача — одно и то же слово, и сравнение
  // значений объявило бы автоматом каждый сданный зачёт.
  const wasAuto = reason === 'auto'
    || (String(value) === autoValue(preset, item.kind)
        && !outcomeLadder(preset, item.kind).some((v) => String(v.value) === String(value)));
  const template = passed
    ? (wasAuto ? ph.auto : ph.passed)
    : (left > 0 ? ph.failed : ph.exhausted);

  const inject = { id: `exam:${item.id}:${item.attempts}`, kind: 'exam', text: fill(template, vars) };
  pushPending(next, inject);
  pushJournal(next, { kind: 'exam', text: inject.text, data: { examId, value: String(value), passed, left } }, preset);

  return { state: next, pending: inject };
}

/**
 * Модель отыграла свой исход — принимаем её версию.
 *
 * Ключевое правило 3.5: считает расширение, но не задним числом. Здесь нет ни
 * одной ветки, которая бы отменяла написанный текст: расхождение только
 * записывается в журнал и видно в отладке. Заодно снимается ставший ложью
 * одноразовый инжект по этому событию — иначе модель получила бы приказ отыграть
 * то, что она уже отыграла иначе.
 *
 * @returns {{state: Object, divergence: ?Object}}
 */
export function resolveConflict(state, { examId, modelSaid }, preset) {
  const next = cloneState(state);
  const item = next.exams.items.find((i) => i.id === examId);
  if (!item) return { state: next, divergence: null };

  const info = gradeInfo(preset, modelSaid);
  if (!info) {
    // Обе ветки расхождения пишутся под одним `kind`, и это не деталь.
    // Раньше неразобранное значение уходило под `kind: 'debug'`, а принятое —
    // под `'exam'`, то есть один и тот же по смыслу факт («модель отыграла свой
    // исход не так, как посчитано») лежал в журнале под двумя именами. Ни один
    // читатель журнала на этом различии не держался: `ui.js:journalDivergences`
    // ищет обе ветки по `data.modelSaid` и `kind` не смотрит вовсе, а
    // `core/lorebook.mjs:isSignificant` для `kind: 'exam'` требует `data.value`
    // — у записи расхождения его нет ни в одной ветке, так что в хронику она не
    // попадает и теперь. `kind` отвечает на вопрос «о чём событие», а не «удалось
    // ли его применить»: применённость лежит рядом, полем `applied`.
    const divergence = { examId, subjectId: item.subjectId, computed: item.outcome, modelSaid: String(modelSaid), applied: false };
    pushJournal(next, { kind: 'exam', text: '', data: divergence }, preset);
    return { state: next, divergence };
  }

  const said = String(info.value);
  if (item.outcome !== null && item.outcome !== undefined && String(item.outcome) === said) {
    return { state: next, divergence: null };
  }

  const computed = item.outcome === undefined ? null : item.outcome;
  item.outcome = said;
  item.modelOverride = true;

  const subject = findSubject(next, item.subjectId);
  if (subject) {
    const last = subject.grades.length ? subject.grades[subject.grades.length - 1] : null;
    if (last && computed !== null && String(last.value) === String(computed)) last.value = said;
    else subject.grades.push({ value: said, day: (next.calendar && next.calendar.day) || '' });
    subject.debt = !info.pass && retakesLeft(preset, item) <= 0;
    stampDebt(subject, DEBT_EXAM);
  }

  next.pending = next.pending.filter((p) => !String(p.id).startsWith(`exam:${item.id}:`));

  const divergence = { examId, subjectId: item.subjectId, computed, modelSaid: said, applied: true };
  const text = fill(phrasesOf(preset).divergence, {
    subject: (subject && subject.name) || item.subjectId,
    computed: computed === null ? '' : String(computed),
    said,
  });
  pushJournal(next, { kind: 'exam', text, data: divergence }, preset);
  return { state: next, divergence };
}

/**
 * Фраза о том, что модели разрешено и что запрещено отыгрывать по накопленному
 * баллу (анти-чит из `nell-witchcraft`). Не «у тебя 2 балла», а «на таком балле
 * автомат невозможен» — информирование модель игнорирует, разрешение и запрет
 * держатся заметно лучше.
 */
export function permissionLine(state, preset, { subjectId, score, kind }) {
  const ph = phrasesOf(preset);
  const subject = findSubject(state, subjectId);
  const teacher = teacherOfSubject(state, subjectId);
  // Вид передаётся явно, если вызывающий знает, какое именно событие сдаётся: у
  // предмета их теперь может быть два, и «автомат» у зачёта и у экзамена
  // называется разными словами. Без подсказки берётся первое событие предмета —
  // так вело себя разрешение до появления двух видов. Ищется оно среди событий
  // открытой сессии: разрешение выдаётся на то, что сдаётся сейчас, а не на
  // прошлогоднее событие с тем же предметом.
  const items = sessionItems(state);
  const item = (kind ? items.find((i) => i.subjectId === subjectId && i.kind === kind) : null)
    || items.find((i) => i.subjectId === subjectId);
  const auto = numberOr(examsOf(preset).autoPassScore, Infinity);
  const pass = numberOr(gradesOf(preset).passMark, -Infinity);
  const value = numberOr(score, 0);

  const template = value >= auto ? ph.permissionAuto : (value >= pass ? ph.permissionNoAuto : ph.permissionRisk);
  return fill(template, {
    examPeriod: vocabOf(preset).examPeriod || '',
    subject: (subject && subject.name) || String(subjectId),
    teacher: (teacher && teacher.name) || vocabOf(preset).teacher || '',
    scoreName: vocabOf(preset).score || '',
    score: String(value),
    // Названный вид сильнее найденного события: у события со своим окном сессии
    // может не быть вовсе, и в `sessionItems` его тогда нет — а «автомат» у
    // разных видов называется разными словами.
    auto: autoValue(preset, kind || (item && item.kind)),
  });
}

// --- мелочи -----------------------------------------------------------------

/** Подстановка `{ключ}`. Неизвестные ключи остаются как есть: их видно в отладке. */
export function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

function numberOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

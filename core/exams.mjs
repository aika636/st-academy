// core/exams — сессия как режим и исход контрольного события.
//
// Здесь живёт ядро ценности расширения (3.5): момент, когда злопамятная Петрова
// решает судьбу семестра. Четыре решения, из которых вытекает весь модуль.
//
// 1. **Исход считает расширение, а не модель.** Модель исход отыгрывает, но не
//    выдумывает: иначе накопленный балл, прогулы и отношения не значат ничего.
//    Форма — видимая проверка d20 против сложности (9.4.1):
//    `DC = база вида − f(балл) − f(отношение) − f(репутация)`, запас броска над
//    DC раскладывается по ступеням шкалы пресета. Почему d20, а не прежняя
//    взвешенная сумма, — у `rollOutcome`.
//
// 2. **Случайность зажата.** Прямое требование 3.5: отличница не должна
//    заваливаться на ровном месте. У d20 размах фиксирован, и зажим поэтому не
//    вес, а правило — **страховка балла** (`exams.dc.safeScore`): на балле не
//    ниже порога проваленный бросок засчитывается низшей проходной ступенью, и
//    в отладке это видно словом, а не спрятано в сумме. Проверяемое свойство,
//    а не обещание — см. тест на тысячу прогонов. `rng` инжектится аргументом,
//    а без него бросок можно сделать воспроизводимым от seed (`seededRng`) —
//    свайп тогда не «выбивает» исход (9.3.9).
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
import { addDays, diffDays, mondayOf, termAt, phaseOf, dayOfWeek } from './time.mjs';
import { addGrade, subjectScore, stampDebt, DEBT_EXAM, DEBT_MISSED } from './gradebook.mjs';

/**
 * Значения по умолчанию — ДАННЫЕ, а не логика: каждое перекрывается пресетом.
 * Лежат здесь одним блоком, чтобы ниже в коде не было ни одной голой константы.
 */
export const DEFAULTS = {
  /** Сколько пересдач сверх первой попытки, если пресет молчит. */
  retakes: 1,
  /**
   * Проверка против сложности (9.4.1), блок `preset.exams.dc`. Каждое число —
   * «сколько пунктов DC стоит полный размах шкалы», а не множитель в вакууме:
   * так их можно читать и сравнивать между пресетами с разными шкалами.
   *
   * - `base` — сложность вида при среднем всём; вид перекрывает её своим `dc`.
   * - `score` — балл: от худшей до лучшей оценки шкалы. Отсчёт от проходного
   *   балла, а не от середины: на проходном балле поправки нет, выше — легче.
   * - `relation` — отношение наставника: от «ненавидит» до «любимица».
   *   Отсчёт от стартового отношения пресета: нейтральный наставник не мешает.
   * - `reputation` — репутация: от отчисления до «гордости». Отсчёт от
   *   стартовой репутации. Это и есть закрытие вопроса 8.8: вес виден числом.
   * - `critMargin` — запас (или недобор), с которого исход считается
   *   блестящим (крит-успех) или позорным (крит-провал).
   *
   * `safeScore` умолчания здесь не имеет: оно считается от шкалы пресета —
   * середина между проходным баллом и автоматом (`dcParams`).
   */
  dc: { base: 8, score: 24, relation: 6, reputation: 6, critMargin: 10 },
};

/** Грани кубика. Не параметр пресета: «d20» — это и есть понятность формы. */
export const DIE = 20;

/**
 * Ступени проверки. Ключи, а не слова: названия живут в отладке (`ui.js`) и в
 * фразах пресета, ядро их не знает.
 */
export const TIERS = ['critFail', 'fail', 'success', 'critSuccess'];

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
  // «Знает расширение / знает мир» (9.4.3). Итог посчитан, но объявят его
  // позже: модель получает его как закрытое знание симуляции, а персонажи —
  // нет. Формулировка повелительная, как у остальных вердиктов: не справка
  // «оценка 3», а запрет на неё в сцене до даты.
  announceLater: 'Свершилось: {subject} — сдача позади ({teacher}). Закрытые сведения симуляции, не знание персонажей: {result}. Итог объявят {date}; до того оценку в сцене не знает никто, включая героиню. Отыграй саму сдачу как уже случившееся.',
  announced: 'Итоги объявлены: {subject} — {result} ({teacher}). Теперь это знают все; отыграй, как героиня узнаёт итог.',
  // Итог словами — одна вставка `{result}` на обе фразы выше, по исходу попытки.
  resultPassed: '{value}',
  resultFailed: '{value}, пересдача (попыток осталось: {left})',
  resultExhausted: '{value}, попытки исчерпаны, {debt} остаётся',
};

/**
 * Оговорка «сцена не для пары» (9.4.9, `intimateSceneGuard` у chaos-events):
 * одноразовый вердикт повелителен, и без оговорки модель оборвёт интимную или
 * просто неподходящую сцену ради зачёта. Текст — `preset.prompts.sceneGuard`;
 * пустая строка в пресете выключает оговорку.
 */
export const DEFAULT_SCENE_GUARD = 'Если сцена сейчас интимная или для этого неподходящая — не обрывай её: отложи это до первой уместной минуты.';



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
    && !awaitingAnnouncement(i)
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
    for (const item of mode.pending) {
      // Пересдача — только после объявления итога (9.4.3): садить героиню
      // пересдавать то, о провале чего она ещё не знает, значит объявить
      // провал самим фактом пересдачи.
      if (awaitingAnnouncement(item)) continue;
      if (!out.some((x) => x.id === item.id)) out.push(item);
    }
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
 * Параметры проверки: блок `preset.exams.dc` поверх умолчаний.
 *
 * Мусор в пресете (строка, отрицательный вес) не ломает исход, а тихо уступает
 * умолчанию: пресет — чужой файл, и падать на нём посреди сессии нельзя.
 *
 * `safeScore` — порог страховки балла. Пресет пишет его явно; молчит — берётся
 * середина между проходным баллом и автоматом. Середина, а не сам проходной:
 * на проходном балле ученица сдаёт «как повезёт», и страховать её там значило
 * бы убрать провал из игры вовсе. Нет ни проходного, ни автомата — страховки
 * нет (`Infinity`), и это честно: судить о «сильном балле» не по чему.
 */
export function dcParams(preset) {
  const own = (examsOf(preset).dc && typeof examsOf(preset).dc === 'object') ? examsOf(preset).dc : {};
  const pick = (key, min = 0) => {
    const v = own[key];
    return typeof v === 'number' && Number.isFinite(v) && v >= min ? v : DEFAULTS.dc[key];
  };
  const pass = numberOr(gradesOf(preset).passMark, null);
  const auto = numberOr(examsOf(preset).autoPassScore, null);
  const guessed = pass !== null && auto !== null ? (pass + auto) / 2 : Infinity;
  return {
    base: pick('base', -Infinity),
    score: pick('score'),
    relation: pick('relation'),
    reputation: pick('reputation'),
    critMargin: Math.max(1, pick('critMargin', 1)),
    safeScore: numberOr(own.safeScore, guessed),
  };
}

/** Сложность вида: собственный `dc` вида, иначе общая база пресета. */
function kindBase(preset, kindId) {
  const kind = kindOf(preset, kindId);
  const own = kind && kind.dc;
  return typeof own === 'number' && Number.isFinite(own) ? own : dcParams(preset).base;
}

/**
 * Сложность проверки и из чего она сложилась.
 *
 * Каждое слагаемое округляется **отдельно**, а не сумма целиком: иначе в
 * отладке «12 = 14 − 1 − 1 + 0» арифметика не сходилась бы на глаз, и вопрос
 * «почему так вышло» упирался бы в невидимые дроби.
 *
 * Знак у поправок — «сколько снято со сложности»: плюс помогает, минус мешает.
 * Отсчёт у каждой от своего «нейтрального» значения:
 *
 * - балл — от проходного (`grades.passMark`): ниже проходного экзамен труднее
 *   базы, выше — легче;
 * - отношение — от стартового (`relations.start`), репутация — от стартовой
 *   (`reputation.start`): новичок, которого никто ещё не знает, сдаёт по базе.
 *
 * Не заданное значение (нет наставника, нет репутации в вызове) даёт ноль, а не
 * штраф: отсутствие сведений — не повод валить.
 *
 * @param {{score?: number, relation?: number, reputation?: number, kind?: string}} input
 * @param {Object} preset
 * @returns {{dc: number, base: number, mods: {score: number, relation: number, reputation: number}}}
 */
export function examDC({ score, relation, reputation, kind } = {}, preset) {
  const p = dcParams(preset);
  const base = kindBase(preset, kind);

  // Балл: доля размаха шкалы над проходным баллом.
  const points = (gradesOf(preset).values || []).filter(isPointScale).map((v) => v.points);
  const span = points.length >= 2 ? Math.max(...points) - Math.min(...points) : 0;
  const pass = numberOr(gradesOf(preset).passMark, null);
  const scoreMod = span > 0 && pass !== null && typeof score === 'number' && Number.isFinite(score)
    ? round(p.score * (score - pass) / span)
    : 0;

  const r = (preset && preset.relations) || {};
  const relSpan = numberOr(r.max, 0) - numberOr(r.min, 0);
  const relationMod = relSpan > 0 && typeof relation === 'number' && Number.isFinite(relation)
    ? round(p.relation * (relation - numberOr(r.start, 0)) / relSpan)
    : 0;

  const rep = (preset && preset.reputation) || {};
  const repSpan = numberOr(rep.max, 0) - numberOr(rep.min, 0);
  const reputationMod = repSpan > 0 && typeof reputation === 'number' && Number.isFinite(reputation)
    ? round(p.reputation * (reputation - numberOr(rep.start, numberOr(rep.min, 0))) / repSpan)
    : 0;

  const mods = { score: scoreMod, relation: relationMod, reputation: reputationMod };
  return { dc: base - scoreMod - relationMod - reputationMod, base, mods };
}

/**
 * Ступень по запасу броска над сложностью.
 *
 * Крит считается **по запасу, а не по натуральным 1 и 20.** В Enhance-Gen и в
 * настольных играх «натуралка» решает сама, но у Academy два требования 3.5
 * сразу: отличница не заваливается на ровном месте, а двоечница не получает
 * высшую оценку «потому что выпало 20». Натуральная единица дала бы первой 5%
 * провала при любом балле, натуральная двадцатка — второй 5% пятёрок. Запас же
 * зависит от DC, то есть от состояния: блестяще сдаёт тот, кому и было легко.
 * Сама натуралка видна в отладке числом броска — анимации есть что показать.
 */
export function checkTier(roll, dc, preset) {
  const { critMargin } = dcParams(preset);
  const margin = roll - dc;
  if (margin >= critMargin) return 'critSuccess';
  if (margin >= 0) return 'success';
  if (margin > -critMargin) return 'fail';
  return 'critFail';
}

/** d20 из rng в [0, 1). Мусор из rng — середина, а не падение. */
export function rollDie(rng) {
  const x = clamp(numberOr(typeof rng === 'function' ? rng() : NaN, 0.5), 0, 0.999999);
  return 1 + Math.floor(x * DIE);
}

/**
 * Ступень → значение шкалы пресета.
 *
 * Лестница делится чертой «сдал / не сдал» (`pass` у значения):
 *
 * - крит-успех — высшая ступень;
 * - успех — проходные ступени **кроме высшей**, по запасу: каждые
 *   `critMargin / n` пунктов запаса — ступенью выше. Высшая оценка зарезервирована
 *   за блестящей сдачей — иначе она выпадала бы на обычном успехе с запасом 9,
 *   и крит ничего бы не значил. Проходная ступень одна («зачёт») — она и есть
 *   ответ и на успех, и на крит;
 * - провал — лучшая из непроходных, крит-провал — худшая.
 *
 * Шкала без непроходных ступеней (не бывает, но пресет чужой) — провал даёт
 * низшую проходную; без проходных — худшую из того, что есть.
 */
function valueForTier(ladder, tier, margin, preset) {
  const passing = ladder.filter((v) => v.pass !== false);
  const failing = ladder.filter((v) => v.pass === false);
  const { critMargin } = dcParams(preset);

  if (tier === 'critSuccess' && passing.length) return passing[0];
  if ((tier === 'success' || tier === 'critSuccess') && passing.length) {
    const rungs = passing.length > 1 ? passing.slice(1) : passing; // от лучшей к худшей
    const n = rungs.length;
    const up = clamp(Math.floor((Math.max(0, margin) * n) / critMargin), 0, n - 1);
    return rungs[n - 1 - up];
  }
  if (!failing.length) return passing[passing.length - 1] || ladder[ladder.length - 1];
  return tier === 'critFail' ? failing[failing.length - 1] : failing[0];
}

/**
 * Исход контрольного события — видимая проверка d20 против сложности (9.4.1).
 *
 * **Почему d20, а не прежняя взвешенная сумма.** Сумма «0.6·балл + 0.2·отношение
 * + 0.2·случай» была честной, но непрозрачной: на вопрос «почему тройка»
 * ответом была дробь 0.47, которую не проверишь в голове, а вес репутации в неё
 * было не вставить так, чтобы его стало видно. d20 против DC — форма, которую
 * игроки уже читают (Enhance-Gen, настолки): «DC 12 = 14 − 1 − 1 + 0; выпало 15
 * → успех». Каждое слагаемое — целое число с именем, и репутация — одно из них
 * (вопрос 8.8 закрыт весом, а не формулировкой).
 *
 * Два ограничения 3.5 выполнены правилами, а не весами:
 *
 * - **страховка балла**: балл не ниже `dc.safeScore` — проваленная проверка
 *   засчитывается низшей проходной ступенью (`check.saved`);
 * - **высшая оценка — только за крит**, а крит — по запасу над DC, не по
 *   натуральной 20 (`checkTier`); и **потолок балла**: ниже проходного балла
 *   крит даёт лучший обычный успех, а не высшую (`check.capped`). Без потолка
 *   двоечница, у которой наставник в любимицах и репутация под потолком,
 *   добирала бы запас крита на двадцатке.
 *
 * Автомат — по-прежнему порог балла и не бросок: `check` у него нет.
 *
 * @param {{score: number, relation?: number, reputation?: number, kind: string}} input
 *   `reputation` — число `state.reputation.value`; не передано — поправки нет
 * @param {Object} preset
 * @param {() => number} [rng] источник случайности в [0, 1)
 * @returns {{value: string, roll: ?number, reason: 'auto'|'roll'|'noScale', check: ?Object}}
 *   `check`: `{dc, base, mods, roll, margin, tier, saved, capped}` — всё, что нужно
 *   отладке, чтобы ответить «почему так вышло»
 */
export function rollOutcome({ score, relation, reputation, kind }, preset, rng = Math.random) {
  const auto = numberOr(examsOf(preset).autoPassScore, Infinity);
  if (numberOr(score, -Infinity) >= auto) {
    return { value: autoValue(preset, kind), roll: null, reason: 'auto', check: null };
  }

  const { dc, base, mods } = examDC({ score, relation, reputation, kind }, preset);
  const roll = rollDie(rng);
  const margin = roll - dc;
  const tier = checkTier(roll, dc, preset);
  const check = { dc, base, mods, roll, margin, tier, saved: false, capped: false };

  const ladder = outcomeLadder(preset, kind);
  if (!ladder.length) return { value: '', roll, reason: 'noScale', check };

  let picked = valueForTier(ladder, tier, margin, preset);
  const passing = ladder.filter((v) => v.pass !== false);
  const failed = tier === 'fail' || tier === 'critFail';
  if (failed && numberOr(score, -Infinity) >= dcParams(preset).safeScore && passing.length) {
    picked = passing[passing.length - 1];
    check.saved = true;
  }
  // Потолок балла — зеркало страховки. Ниже проходного балла крит засчитывается
  // лучшим обычным успехом, а не высшей оценкой: любимица наставника с
  // гордостью факультета за спиной может вытянуть на двадцатке блестящий
  // ответ, но пятёрку двоечнице не ставят — ставят четвёрку и удивляются.
  const pass = numberOr(gradesOf(preset).passMark, null);
  if (tier === 'critSuccess' && pass !== null && numberOr(score, Infinity) < pass && passing.length > 1) {
    picked = passing[1];
    check.capped = true;
  }
  return { value: String(picked.value), roll, reason: 'roll', check };
}

// --- воспроизводимый бросок (9.3.9) ------------------------------------------

/**
 * FNV-1a, 32 бита. Хеш строки seed в число — первый шаг воспроизводимого
 * броска. Выбран за то, что пишется в пять строк без зависимостей и одинаково
 * считается в Node и в браузере (`Math.imul` вместо переполнения умножения).
 */
export function fnv1a(text) {
  let h = 0x811c9dc5;
  const s = String(text == null ? '' : text);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Генератор в [0, 1) от строки seed: FNV-1a даёт зерно, mulberry32 — поток.
 * Хеш сам по себе плохо размазан по старшим битам на похожих строках
 * («…:1» и «…:2»), а mulberry32 перемешивает их до равномерного броска.
 */
export function seededRng(seed) {
  let a = fnv1a(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Строка seed одной попытки: чат + событие + номер попытки + день.
 *
 * Состав выбран так, чтобы **свайп не выбивал исход**, а всё остальное — да:
 * свайп пересчитывает тот же ответ из того же снимка, и все четыре части
 * совпадают; пересдача — другая попытка, другой день — другой бросок, другой
 * чат — другой. id события уже содержит период, предмет и вид.
 */
export function examSeed(chatSeed, item, day) {
  const attempt = numberOr(item && item.attempts, 0) + 1;
  return [String(chatSeed == null ? '' : chatSeed), (item && item.id) || '', attempt, day || ''].join('|');
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
 * `check` — проверка из `rollOutcome`, если исход брошен (9.4.1). Она уходит
 * в две стороны: полностью — в запись журнала (`data.check`, отладка отвечает
 * по ней на «почему так вышло»), и сжатой строкой — в историю бросков события
 * (`item.rolls`, см. `rollRecord`). Журнал кольцевой и за семестр забывает
 * начало, история бросков — нет: событие из состояния не удаляется никогда.
 *
 * @returns {{state: Object, pending: ?Object}}
 */
export function applyOutcome(state, { examId, value, day, reason, check }, preset) {
  let next = cloneState(state);
  let item = next.exams.items.find((i) => i.id === examId);
  if (!item) return { state: next, pending: null };

  const when = isDay(day) ? day : (next.calendar && next.calendar.day) || '';
  const passed = isPassing(preset, value);
  item.outcome = String(value);
  item.attempts = numberOr(item.attempts, 0) + 1;
  if (when) item.day = when;
  // Объявление итога (9.4.3). Автомат объявлять нечего: он известен до сдачи,
  // сдачи и не было. Иначе — по правилу пресета; «сразу» (нет правила) не
  // оставляет на событии ни одного поля, и состояние выглядит как до правки.
  const announceOn = reason === 'auto' ? null : announceDay(preset, item.kind, when);
  delete item.announced;
  delete item.announceOn;
  if (announceOn) {
    item.announced = false;
    item.announceOn = announceOn;
  }
  const record = rollRecord({ day: when, value, reason, check });
  if (record) item.rolls = [...(Array.isArray(item.rolls) ? item.rolls : []), record];

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
  const verdict = verdictText(next, preset, item, value, reason);
  const inject = { id: `exam:${item.id}:${item.attempts}`, kind: 'exam', text: withSceneGuard(verdict, preset) };
  pushPending(next, inject);
  pushJournal(next, {
    kind: 'exam',
    text: verdict,
    // `private` — итог ещё не объявлен (9.4.3): хроника лорбука такую запись не
    // берёт (`lorebook.isSignificant`), иначе World Info выдал бы оценку миру
    // раньше ведомости. В хронику итог попадёт записью объявления.
    data: {
      examId, value: String(value), passed, left, ...(check ? { check } : {}),
      ...(announceOn ? { private: true, announceOn } : {}),
    },
  }, preset);

  return { state: next, pending: inject };
}

/**
 * Текст вердикта по событию (без оговорки `withSceneGuard`) — одна функция на два места: исход броска
 * (`applyOutcome`) и исход кубика соседа (`resolveConflict` с `source: 'dice'`).
 *
 * Итог ещё не объявлен (`item.announced === false`) — фраза `announceLater`:
 * модель знает исход, персонажи нет. Иначе — прежние четыре фразы.
 */
export function verdictText(state, preset, item, value, reason) {
  const ph = phrasesOf(preset);
  const vars = verdictVars(state, preset, item, value);
  if (awaitingAnnouncement(item)) {
    return fill(ph.announceLater, { ...vars, result: resultText(preset, item, value, vars), date: shortDate(item.announceOn) });
  }
  const passed = isPassing(preset, value);
  // «Без испытания» узнаётся по причине исхода, а не по значению: в шкале
  // «зачёт/незачёт» автомат и обычная сдача — одно и то же слово, и сравнение
  // значений объявило бы автоматом каждый сданный зачёт.
  const wasAuto = reason === 'auto'
    || (String(value) === autoValue(preset, item.kind)
        && !outcomeLadder(preset, item.kind).some((v) => String(v.value) === String(value)));
  const template = passed
    ? (wasAuto ? ph.auto : ph.passed)
    : (retakesLeft(preset, item) > 0 ? ph.failed : ph.exhausted);
  return fill(template, vars);
}

function verdictVars(state, preset, item, value) {
  const subject = findSubject(state, item.subjectId);
  const teacher = teacherOfSubject(state, item.subjectId);
  const info = gradeInfo(preset, value);
  return {
    subject: (subject && subject.name) || item.subjectId,
    value: (info && info.label) || String(value),
    teacher: (teacher && teacher.name) || vocabOf(preset).teacher || '',
    left: String(retakesLeft(preset, item)),
    debt: vocabOf(preset).debt || '',
    examPeriod: vocabOf(preset).examPeriod || '',
  };
}

/** `{result}` фраз объявления: оценка и что из неё следует. */
function resultText(preset, item, value, vars) {
  const ph = phrasesOf(preset);
  const template = isPassing(preset, value)
    ? ph.resultPassed
    : (retakesLeft(preset, item) > 0 ? ph.resultFailed : ph.resultExhausted);
  return fill(template, vars);
}

/** `ДД.ММ` — дата объявления в тексте вердикта. Формат дат промпта, как у промотки. */
function shortDate(day) {
  if (!isDay(day)) return '';
  const [, m, d] = day.split('-');
  return `${d}.${m}`;
}

// --- «знает расширение / знает мир» (9.4.3) ---------------------------------
//
// Исход контрольного считается сразу (3.5: «до того, как модель начнёт его
// описывать»), а объявляется — по правилу пресета: «ведомость вывесят в
// пятницу». Между сдачей и объявлением итог знает расширение (зачётка в панели,
// вехи, отладка) и модель — одноразовой пометкой «закрытые сведения симуляции,
// не знание персонажей». Мир не знает: строка состояния, хроника лорбука и
// пересдача ждут объявления. Приём — у Pregnancy («трекер знает о
// беременности» против «героиня узнала»).
//
// Что НЕ меняется, и это нарочно: сама сдача по-прежнему отыгрывается сразу
// одноразовым вердиктом (9.1.2 держит его через свайп и F5 — тот же `pending`,
// тот же id `exam:<событие>:<попытка>`). Объявление касается только итоговой
// оценки. `resolveConflict` (модель отыграла свою оценку) объявления не трогает:
// оценка меняется, дата — нет.
//
// Правило задержки — `exams.announce` пресета или `announce` у вида (вид
// сильнее): `{studyDays: n}` — n-й учебный день после сдачи (учебный — по дням
// недели `week.studyDays`, каникулы НЕ пропускаются: ведомость вывешивают и в
// январе); `{weekday: 1–7}` — ближайший такой день недели строго после сдачи
// («в ближайшую пятницу»; сдача в пятницу — через неделю); число `n` —
// сокращение `{studyDays: n}`. Пресет молчит или пишет 0 — объявлено сразу, как
// было до правки.

/** Потолок `studyDays`: «через месяц» — это не ведомость, а опечатка в пресете. */
const MAX_ANNOUNCE_DAYS = 14;

/**
 * Правило объявления для вида; `null` — сразу.
 *
 * @returns {?({studyDays: number}|{weekday: number})}
 */
export function announceRule(preset, kindId) {
  const kind = exactKind(preset, kindId);
  const raw = kind && kind.announce !== undefined ? kind.announce : examsOf(preset).announce;
  const rule = typeof raw === 'number' ? { studyDays: raw } : raw;
  if (!rule || typeof rule !== 'object') return null;
  const n = Number(rule.studyDays);
  if (Number.isInteger(n) && n >= 1) return { studyDays: Math.min(n, MAX_ANNOUNCE_DAYS) };
  const w = Number(rule.weekday);
  if (Number.isInteger(w) && w >= 1 && w <= 7) return { weekday: w };
  return null;
}

/**
 * День объявления итога сдачи в `day`; `null` — объявлено сразу.
 *
 * @param {Object} preset
 * @param {string} kindId вид события
 * @param {string} day день сдачи, `ГГГГ-ММ-ДД`
 * @returns {?string}
 */
export function announceDay(preset, kindId, day) {
  const rule = announceRule(preset, kindId);
  if (!rule || !isDay(day)) return null;
  if (rule.weekday) {
    for (let k = 1; k <= 7; k += 1) {
      const d = addDays(day, k);
      if (dayOfWeek(d) === rule.weekday) return d;
    }
    return null;
  }
  const study = (preset && preset.week && Array.isArray(preset.week.studyDays) && preset.week.studyDays.length)
    ? preset.week.studyDays
    : [1, 2, 3, 4, 5];
  let left = rule.studyDays;
  let d = day;
  // Неделя без единого учебного дня (мусор в пресете) не зациклит: потолок
  // обхода конечен, дальше — просто календарные дни.
  for (let guard = 0; left > 0 && guard < MAX_ANNOUNCE_DAYS * 7; guard += 1) {
    d = addDays(d, 1);
    if (study.includes(dayOfWeek(d))) left -= 1;
  }
  return left > 0 ? addDays(day, rule.studyDays) : d;
}

/** Итог попытки посчитан, но ещё не объявлен. Старые события без поля — объявлены. */
export const awaitingAnnouncement = (item) => Boolean(item) && item.announced === false;

/**
 * Объявить всё, чей день пришёл: событие получает `announced: true`, в очередь
 * — одноразовое «итоги объявлены: …» (id `announce:<событие>:<попытка>`), в
 * журнал — запись с `data.value` (её и возьмёт хроника лорбука, датой
 * объявления). Зовётся календарём (`engine.calendarEvents`) — объявление
 * случается, когда до него дошло время, а не по кнопке.
 *
 * @returns {{state: Object, announced: string[]}} id объявленных событий
 */
export function announceResults(state, preset, day = state && state.calendar && state.calendar.day) {
  const items = (state && state.exams && state.exams.items) || [];
  const due = items.filter((i) => awaitingAnnouncement(i) && isDay(i.announceOn) && isDay(day)
    && diffDays(i.announceOn, day) >= 0);
  if (!due.length) return { state, announced: [] };

  const next = cloneState(state);
  const ph = phrasesOf(preset);
  const announced = [];
  for (const raw of due) {
    const item = next.exams.items.find((i) => i.id === raw.id);
    item.announced = true;
    const value = item.outcome;
    const vars = verdictVars(next, preset, item, value);
    const text = fill(ph.announced, { ...vars, result: resultText(preset, item, value, vars) });
    pushPending(next, {
      id: `announce:${item.id}:${numberOr(item.attempts, 0)}`, kind: 'announce', text: withSceneGuard(text, preset),
    });
    pushJournal(next, {
      kind: 'exam',
      text,
      data: {
        examId: item.id, value: String(value), passed: isPassing(preset, value),
        left: retakesLeft(preset, item), announced: true,
      },
    }, preset);
    announced.push(item.id);
  }
  return { state: next, announced };
}

/**
 * Что знает мир: состояние, из которого вычтены необъявленные итоги (9.4.3).
 *
 * Для строки состояния (`prompt.statusLine`): оценка за сданное, но не
 * объявленное, из зачётки убирается, а хвост, поставленный этим исходом, —
 * гасится. Иначе «Балл: 3.1. Хвосты: химия» в строке объявили бы провал
 * раньше ведомости. Последняя строка истории бросков тоже прячется: по ней
 * считаются вехи «блестящая сдача» и «автомат» (`milestones.mjs`), и
 * `milestones(publicView(s))` — это вехи, которые мир уже видел (для тоста в
 * панели: он прозвучит в день объявления, а не в день сдачи). Состояние не
 * меняется — возвращается копия; нечего прятать — возвращается сам объект.
 *
 * Чего НЕ прячет: репутацию (исход её уже сдвинул — наставник, поставивший
 * оценку, её знает, и заведение вместе с ним) и счёт несданного в сессию.
 */
export function publicView(state, preset) {
  const hidden = ((state && state.exams && state.exams.items) || []).filter(awaitingAnnouncement);
  if (!hidden.length) return state;
  const next = cloneState(state);
  for (const item of hidden) {
    const subject = findSubject(next, item.subjectId);
    if (!subject) continue;
    const grades = subject.grades || [];
    for (let i = grades.length - 1; i >= 0; i -= 1) {
      if (String(grades[i].value) === String(item.outcome) && (!item.day || grades[i].day === item.day)) {
        grades.splice(i, 1);
        break;
      }
    }
    if (subject.debt && subject.debtReason === DEBT_EXAM) {
      subject.debt = false;
      delete subject.debtReason;
    }
    const own = next.exams.items.find((i) => i.id === item.id);
    if (own && Array.isArray(own.rolls) && own.rolls.length) own.rolls = own.rolls.slice(0, -1);
  }
  return next;
}

// --- оговорка «сцена не для пары» (9.4.9) -----------------------------------

/** Текст оговорки: `preset.prompts.sceneGuard`, иначе умолчание; `''` — выключено. */
export function sceneGuard(preset) {
  const own = preset && preset.prompts && preset.prompts.sceneGuard;
  return typeof own === 'string' ? own.trim() : DEFAULT_SCENE_GUARD;
}

/**
 * Вердикт с оговоркой — одной строкой, хвостом того же инжекта.
 *
 * Хвостом, а не отдельным инжектом, нарочно: «один вердикт — один инжект»
 * держат и отладка, и снятие ставшего ложью вердикта (`resolveConflict` снимает
 * по id события), и оговорка, пережившая свой вердикт, осталась бы приказом
 * «отложи» ни о чём. В журнал оговорка не идёт — это наставление модели, а не
 * событие.
 */
export function withSceneGuard(text, preset) {
  const guard = sceneGuard(preset);
  return guard ? `${text} ${guard}` : text;
}

// --- исход соседа: кубик Enhance-Gen (9.4.1, 9.7B) --------------------------

/**
 * Значение шкалы по исходу чужого броска (`cues.readDiceRoll`).
 *
 * Кубик Enhance-Gen в реплике человека уже велел модели отыграть «фиаско» или
 * «триумф» (его `system_note`), поэтому посчитанный нами исход с ним спорить
 * не может — тот же случай, что `resolveConflict` с версией модели (3.5).
 * Ступень берётся у соседа, а значение — с НАШЕЙ лестницы тем же правилом,
 * что у своего броска (`valueForTier`): запас = бросок − DC соседа; у крита DC
 * сосед не пишет, и запасом считается ровно `critMargin`.
 *
 * @param {Object} preset
 * @param {string} kindId
 * @param {?{tier: string, roll: ?number, dc: ?number}} dice
 * @returns {string} значение шкалы; `''` — перевести не во что
 */
export function externalValue(preset, kindId, dice) {
  if (!dice || !TIERS.includes(dice.tier)) return '';
  const ladder = outcomeLadder(preset, kindId);
  if (!ladder.length) return '';
  const { critMargin } = dcParams(preset);
  const margin = Number.isFinite(dice.roll) && Number.isFinite(dice.dc)
    ? dice.roll - dice.dc
    : ({ critSuccess: critMargin, success: 0, fail: -1, critFail: -critMargin })[dice.tier];
  const picked = valueForTier(ladder, dice.tier, margin, preset);
  return picked ? String(picked.value) : '';
}

/**
 * Одна строка истории бросков события — компактно, потому что живёт в
 * `chat_metadata` вечно: день, бросок, DC, ступень, посчитанное значение, и
 * флаги страховки и потолка, только если они сработали. Слагаемые DC сюда не входят —
 * они в журнале; история отвечает на «что выпадало», а не на «из чего».
 *
 * Автомат — тоже строка истории, без броска: вехе «автомат» (`milestones.mjs`)
 * нужно знать, что исход был автоматом, а по одному значению этого не понять
 * (в шкале «зачёт/незачёт» автомат и сдача — одно слово). Исход без проверки
 * и без автомата (вызов руками, старый код) строки не оставляет: выдумывать
 * бросок, которого не было, нельзя.
 *
 * @returns {?{day: string, roll?: number, dc?: number, tier: string, value: string, saved?: true, capped?: true}}
 */
export function rollRecord({ day, value, reason, check }) {
  if (reason === 'auto') return { day: day || '', tier: 'auto', value: String(value) };
  if (!check || typeof check !== 'object' || !TIERS.includes(check.tier)) return null;
  return {
    day: day || '',
    roll: check.roll,
    dc: check.dc,
    tier: check.tier,
    value: String(value),
    ...(check.saved ? { saved: true } : {}),
    ...(check.capped ? { capped: true } : {}),
  };
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
export function resolveConflict(state, { examId, modelSaid, source }, preset) {
  const next = cloneState(state);
  // `source` — чей это исход, если не модели: `'dice'` — кубик соседа
  // (`externalValue`). Вход один на всех (9.7B «приём внешнего исхода»): чужой
  // исход не появляется мимо журнала и отладки.
  const from = typeof source === 'string' && source ? { source } : {};
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
    const divergence = { examId, subjectId: item.subjectId, computed: item.outcome, modelSaid: String(modelSaid), applied: false, ...from };
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
  if (from.source === 'dice') {
    // Кубик соседа велел отыграть ступень («провал»), но не оценку: вердикт с
    // оценкой модели всё ещё нужен, и он ставится заново — уже с итогом кубика.
    // Версия модели (без `source`) — другое дело: оценку она уже написала сама.
    pushPending(next, {
      id: `exam:${item.id}:${numberOr(item.attempts, 0)}`,
      kind: 'exam',
      text: withSceneGuard(verdictText(next, preset, item, said, 'dice'), preset),
    });
  }

  const divergence = { examId, subjectId: item.subjectId, computed, modelSaid: said, applied: true, ...from };
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

/**
 * Округление слагаемого DC. `Math.round(-0.4)` даёт `-0`, и в отладке строка
 * «− -0 репутация» читалась бы как ошибка; `+ 0` сводит минус-ноль к нулю.
 */
function round(v) {
  return Math.round(v) + 0;
}

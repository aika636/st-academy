// ui.js — панель академии: «Сегодня», «Зачётка», «Люди», «Настройки» и — только
// при включённой галочке — «Отладка»; плюс блок в меню расширений и
// перетаскиваемая кнопка вызова.
//
// Четыре решения, из которых вытекает форма файла.
//
// 1. **Модуль не знает ни таверны, ни хранилища.** Ни `chat_metadata`, ни
//    `fetch`, ни `eventSource`. Всё приходит объектом-хостом, который собирает
//    `index.js` (см. `HOST` в шапке `mountPanel`). Значит панель можно
//    подменить, а хост — подделать в тесте.
// 2. **Отрисовка разведена на «что показать» и «чем показать».** Первая
//    половина файла — чистые функции: `todayView`, `gradebookView`,
//    `peopleView`, `debugView`, `settingsView`, `validateSubjectRows`. Они не
//    трогают DOM, возвращают
//    простые объекты и проверяются `test/ui.test.mjs` без браузера. Вторая
//    половина превращает эти объекты в узлы. Причина не в эстетике: браузера
//    для проверки нет, и всё, что нельзя прогнать `node --test`, остаётся
//    непроверенным до первого запуска у живого человека.
// 3. **Шести чисел на экране — это про сводные числа** (3.3). Оценки в
//    зачётке из счёта исключены сознательно: это сама запись, а не метрика, и
//    зачётка без оценок бессмысленна. Всё остальное — дата, время, неделя,
//    номер пары, средний балл, счётчик хвостов — считается и режется по
//    приоритету функцией `capNumbers`. Отношения и репутация наружу идут
//    словом из пресета и в счёт чисел не входят вовсе.
// 4. **Телефон — ограничение, а не адаптация под конец** (3.9). Поэтому
//    «Сегодня» — колонка, таблица предметов на узком экране — карточки (это
//    делает `style.css` одним и тем же разметочным деревом, без второй
//    вёрстки), панель анкерится сверху и не лезет под поле ввода, слушатели
//    касаний пассивные, а от прокрутки кнопку спасает `touch-action: none`, а
//    не `preventDefault` — второе как раз и требует активного слушателя.
//
// 5. **Ни одного слова заведения в логике.** Всё, что панель выводит на экран
//    словами предметной области — «пара», «хвост», «неделя», «сессия», ярлык
//    вкладки, — лежит данными в `DEFAULT_UI` и перекрывается блоком `preset.ui`
//    (тот же приём, что `DEFAULT_LABELS` в `prompt.mjs`). Согласование — род,
//    падеж, число — задаётся ГОТОВОЙ фразой с подстановкой, а не таблицей
//    окончаний: см. комментарий над `DEFAULT_UI`. Календарь русского языка
//    (`WEEKDAYS`, `MONTHS`) — исключение: это язык, а не лексика заведения.
//
// Своих цветов в файле нет: палитра — переменные таверны, см. `style.css`.

import { emptySurvey, isPortrait, labelFor, PLACE_MAX, validateState } from './core/state.mjs';
import { currentPeriod, dayPlan, nextPeriod } from './core/schedule.mjs';
import { debts, overallScore, subjectScore } from './core/gradebook.mjs';
import { reasonText, relationLabel } from './core/relations.mjs';
import { reputationLabel } from './core/reputation.mjs';
import { dayOfWeek, isStalled, parseDay, phaseOf, termAt, termsOf, weekIndex } from './core/time.mjs';
import {
  awaitingAnnouncement, examMode, datedExams, gradeInfo, isPassing, publicView,
} from './core/exams.mjs';
import { milestones, milestoneName } from './core/milestones.mjs';
import { slugify } from './core/plan-gen.mjs';
import { PRESET_MAX_BYTES } from './core/preset.mjs';
// Единственный импорт мимо `core/`: чистое правило «куда уйдёт запрос». Панель
// обязана показывать ровно ту развилку, по которой потом пойдёт `api.js`, —
// вторая копия этого правила рано или поздно разъехалась бы с первой. Ни одного
// похода в сеть этот импорт с собой не приносит.
import { resolveSource } from './api.js';

/* ========================================================================== *
 *  ЧАСТЬ 1. Чистые функции: что показывать. Без DOM, без хоста, тестируемо.
 * ========================================================================== */

/** Потолок сводных чисел на экране (3.3). Пресет вправе задать свой. */
export const DEFAULT_MAX_NUMBERS = 6;

/** Шесть полей анкеты (3.6). Порядок — как в таблице плана. */
export const SURVEY_FIELDS = [
  { key: 'era', label: 'Эпоха / сеттинг', hint: 'современность, фэнтези, киберпанк, 1980-е' },
  { key: 'country', label: 'Страна / традиция', hint: 'Россия, Япония, Британия, выдуманная' },
  { key: 'institution', label: 'Тип заведения', hint: 'школа, колледж, вуз, магическая академия' },
  { key: 'faculty', label: 'Направление / факультет', hint: 'медицинский, филфак, боевая магия' },
  { key: 'year', label: 'Курс / год', hint: '2-й' },
  { key: 'lang', label: 'Язык названий и имён', hint: 'русский' },
];

/** Три положения источника времени (3.2). */
export const TIME_MODES = [
  { id: 'auto', label: 'Авто', hint: 'сначала контекст, при неудаче — метка' },
  { id: 'context', label: 'Из контекста', hint: 'время уже печатается в постах, инжекта нет' },
  { id: 'marker', label: 'Своя метка', hint: 'чистые посты, всё идёт служебным блоком' },
];

/** Четыре вкладки плана (3.9). Порядок — как в перечислении там же. */
export const TABS = [
  { id: 'today', label: 'Сегодня' },
  { id: 'gradebook', label: 'Зачётка' },
  { id: 'people', label: 'Люди' },
  { id: 'settings', label: 'Настройки' },
];

/**
 * Пятая вкладка появляется только при включённой галочке отладки, и слова у неё
 * технические — в пресеты они не едут (см. `DEBUG_TEXT`). Отдельной константой,
 * а не пунктом `TABS`, ровно потому, что она условная: «при выключенной отладке
 * ничего лишнего на экране» здесь понимается буквально — вкладки нет.
 */
export const DEBUG_TAB = { id: 'debug', label: 'Отладка' };

/** Сколько переходов ярлыка показывать по одному преподавателю (3.9: телефон). */
export const PEOPLE_HISTORY = 3;

/** Сколько последних строк журнала показывать в отладке. */
export const DEBUG_JOURNAL = 12;

const WEEKDAYS = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const MONTHS = ['', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/**
 * Лексика панели — ДАННЫЕ, а не логика (та же развилка, что `DEFAULT_LABELS` в
 * `prompt.mjs`, и решается она так же).
 *
 * Согласование задаётся **готовой фразой с подстановкой**, а не грамматическим
 * родом в словаре. Причина в одном: род — это ещё не согласование. Русское
 * «3-я пара», «3-й урок», «3-е занятие» требует не только рода, но и падежа
 * («несдано в сессию», а не «в сессия»), и числа («2 пары» / «5 пар»). Таблица
 * окончаний в коде означала бы, что движок знает русскую морфологию, — а по
 * правилу раздела 1 плана он не знает ни одного слова заведения. Пресет пишет
 * фразу целиком, код подставляет числа и имена — и тогда японская школа со
 * своими «уроками», а завтра английский пресет со своим `{ordinal}th lesson`
 * обходятся без строчки кода.
 *
 * Умолчания — ровно тот текст, который панель печатала до появления блока
 * `preset.ui`: пресет без него не меняет ни символа.
 */
export const DEFAULT_UI = {
  // --- «Сегодня» ------------------------------------------------------------
  week: '{n}-я неделя',
  weekBefore: 'семестр ещё не начался',
  // Промежуток между двумя учебными периодами — не «до начала» и не «после
  // конца»: год идёт, впереди ещё период, и номер недели прошлого периода тут
  // ничего не значит. Пресет с одним периодом сюда не попадает никогда.
  weekBreak: 'перерыв между семестрами',
  // Имя периода и его номер: японские триместры называются, у русского вуза
  // период один и на экран не выходит вовсе.
  termLine: '{name}',
  termNumber: '{n}-й семестр',
  phases: {
    study: 'учебный день', weekend: 'выходной', vacation: 'каникулы',
    break: 'между семестрами', exams: 'сессия',
  },
  silentVacation: 'Каникулы — занятий нет.',
  silentBreak: 'Между семестрами — занятий нет.',
  silentWeekend: 'Выходной — занятий нет.',
  silentExams: 'Сессия — лекций нет, идут контрольные.',
  silentNight: 'Ночь — занятий нет.',
  silentEmpty: 'На сегодня расписание пустое.',
  silentOver: 'Занятия на сегодня кончились.',
  nowTitle: 'Сейчас',
  breakTitle: 'Перемена, дальше',
  beforeTitle: 'Сегодня начнём с',
  nextCardTitle: 'Дальше',
  slot: '{ordinal}-я пара',
  slotTime: '{ordinal}-я пара, {start}–{end}',
  nextSoon: 'сегодня, следующей парой',
  nextToday: 'сегодня, {start}',
  nextDay: '{date}, {start}',
  nextDayNoTime: '{date}',
  noNext: 'Следующей пары в ближайшие две недели нет.',
  dayTitle: 'День целиком',
  shiftPeriod: '+1 пара',

  // --- придержанный прыжок времени -----------------------------------------
  // Слова нейтральные: расширение не знает, чей это был текст — отыгрыша или
  // соседнего расширения, — и решать это человеку, а не панели.
  jumpTitle: 'Время прыгнуло вперёд',
  jumpLine: 'В ответе прочитано {date} — это на {days} {plural} вперёд. Календарь пока стоит на {from}.',
  jumpMatched: 'Прочитано в строке: {matched}',
  jumpNote: 'Так бывает и в отыгрыше (сон, отъезд), и по ошибке — когда время печатает соседнее расширение. Пропущенные пары зачтутся, только если прыжок принять.',
  jumpAccept: 'Принять',
  jumpDismiss: 'Не надо',
  jumpAccepted: 'Время переведено.',
  jumpAcceptedMissed: 'Время переведено, пропущено пар: {count}.',
  jumpDismissed: 'Прыжок отклонён, календарь на месте.',

  // --- «Зачётка» ------------------------------------------------------------
  scoreLine: '{scoreName}: {value}',
  debtsLine: '{debtPlural}: {count}',
  subjectsLine: 'предметов: {count}',
  examsLine: 'несдано в {examPeriod}: {count}',
  // Чья именно сессия идёт: при нескольких периодах в году без этого не понять,
  // что за контрольные висят в списке.
  examsTerm: 'сессия: {name}',
  debtsTitle: 'Хвосты',
  openExamsTitle: 'Не сдано',
  debtTag: 'хвост',
  passedTag: 'сдано',
  expelledTag: 'отчислена',
  warnedTag: 'предупреждение',
  reputationTitle: 'Репутация',
  expelledLine: 'Отчислена.',
  warnedLine: 'Есть предупреждение.',
  noSubjects: 'Предметов нет. Заполните таблицу в настройках.',

  // --- здоровье состояния ---------------------------------------------------
  notStartedTitle: 'Семестр не начат',
  noStateText: 'Заполните анкету из шести полей и нажмите «начать семестр».',
  notStartedWithPlan: 'Учебный план уже есть. Осталось нажать «начать семестр».',
  notStartedNoPlan: 'Заполните анкету из шести полей и сгенерируйте учебный план.',
  brokenTitle: 'Состояние повреждено',
  brokenText: 'Расширение не берётся показывать семестр, который не сходится сам с собой. '
    + 'Проверьте список ниже; таблицу предметов можно поправить руками в настройках.',

  // --- «Люди» ---------------------------------------------------------------
  // Отношение выходит наружу словом (3.3, `:296-297`), поэтому здесь нет ни
  // одного шаблона с числом отношения: `{from}`/`{to}` — это ярлыки, а не
  // границы шкалы, и подставляются они `labelFor` из той же таблицы пресета.
  peopleCountLine: 'преподавателей: {count}',
  peopleNone: 'Преподавателей нет. Добавьте их в настройках.',
  traitsNone: 'черты не заданы',
  subjectsNone: 'предметов не ведёт',
  relationTitle: 'Отношение',
  relationHistoryTitle: 'Как менялось',
  relationNoHistory: 'отношение ещё не менялось',
  relationShift: '{from} → {to}',
  orphanSubjectsTitle: 'Предметы без преподавателя',

  // --- вкладки --------------------------------------------------------------
  tabToday: 'Сегодня',
  tabGradebook: 'Зачётка',
  tabPeople: 'Люди',
  tabSettings: 'Настройки',

  // --- настройки: учебный план ----------------------------------------------
  planSection: 'Учебный план',
  planNote: 'Таблица правится всегда, а не только когда генерация не удалась: '
    + 'вписать свой предмет, свести преподавателя с персонажем из карточки, переименовать под свой сеттинг.',
  planGenerate: 'Сгенерировать учебный план',
  planGenerateOk: 'План получен. Проверьте таблицу ниже.',
  teachersTitle: 'Преподаватели',
  subjectsTitle: 'Предметы',
  addTeacher: 'Добавить преподавателя',
  addSubject: 'Добавить предмет',
  noTeachersRow: 'Преподавателей нет.',
  noSubjectsRow: 'Предметов нет. Добавьте свои или сгенерируйте план.',
  teacherField: 'Преподаватель',
  teacherNone: '— не назначен —',
  teacherNameHint: 'Петрова Анна Сергеевна',
  traitsHint: 'злопамятна, придирается к опозданиям',
  subjectNameHint: 'аналитическая химия',
  startSection: 'Начало семестра',
  startButton: 'Начать семестр',
  startedButton: 'Семестр идёт',
  startedOk: 'Семестр начат.',
  startNote: 'Расписание соберётся из таблицы выше по правилам пресета.',
  startDayField: 'Первый учебный день',
  // --- ручной сдвиг и посещаемость ------------------------------------------
  repairCount: 'Зачесть пропущенные пары',
  repairCountNote: 'По умолчанию ручной сдвиг посещаемость не трогает: ремонт календаря не наказывает за день, которого не играли. С галочкой пропущенные пары зачтутся прогулами, как при обычном движении времени.',
  repairCounted: 'Календарь поправлен, прогулов зачтено: {count}.',
  repairNotCounted: 'Календарь поправлен. Посещаемость не считалась: пропущено пар — {count}.',
  cmdCounted: 'Прогулов зачтено: {count}.',
  cmdNotCounted: 'Посещаемость не считалась: пропущено пар — {count}. Нужно зачесть — добавьте count=yes.',
  cmdReputationMoved: 'Репутация: {from} → {to}.',
  startDayFromChat: 'Дата взята из чата: в нём уже написан год ({matched}). Так календарь не разойдётся с тем, что печатают соседние расширения.',
  startDayFromPreset: 'Дата — начало учебного года из пресета в нынешнем году по часам компьютера. Если отыгрыш идёт в другом году, поправьте здесь: потом расширение год не переспросит.',
  blockNoSubjects: 'нет ни одного предмета',
  blockBadTable: 'таблица предметов не сходится',
  blockStarted: 'семестр уже начат',

  // --- проверка таблицы руками ----------------------------------------------
  errTeacherName: 'У преподавателя нет имени.',
  errTeacherDup: 'Идентификатор «{id}» уже занят другим преподавателем.',
  errSubjectName: 'У предмета нет названия.',
  errSubjectId: 'Идентификатор «{id}»: нужны латиница, цифры, дефис и подчёркивание.',
  errSubjectDup: 'Идентификатор «{id}» уже занят другим предметом.',
  errSubjectTeacher: 'Предмет «{name}» ссылается на преподавателя «{teacherId}», которого нет в списке.',
  errManyTeachers: 'Преподавателей {count}, потолок {max}.',
  errManySubjects: 'Предметов {count}, потолок {max}.',
  errNoSubjects: 'Ни одного предмета: семестр начать не из чего.',
  noteNoTraits: 'У {name} не задано ни одной черты характера — из чего расти конфликту.',
  noteNoTeacher: 'У предмета «{name}» нет преподавателя — отношения по нему считать не с кем.',

  // --- настройки: анкета и автозаполнение (3.6) -----------------------------
  surveySection: 'Анкета',
  surveyNote: 'Шесть полей, заполняются один раз. Анкета — источник истины, модель только заполняет пробелы.',
  surveyGuess: 'Заполнить по карточке персонажа',
  surveyGuessNote: 'Модель прочитает карточку и первое сообщение и предположит, где учится героиня. '
    + 'Предположение попадёт в поля выше — посмотрите и поправьте. В игру само не уйдёт ничего.',
  surveyGuessOk: 'Поля заполнены предположением. Проверьте их.',
  surveyGuessEmpty: 'Заполнить не удалось ничего: в карточке не нашлось ни одной подсказки. Впишите руками.',
  surveyGuessPartly: 'Заполнено полей: {count}. Пустые — не ошибка, впишите их руками.',

  // --- настройки: пресет ----------------------------------------------------
  presetSection: 'Пресет заведения',
  presetNote: 'Слова, шкала оценок и виды контрольных берутся отсюда. Предметы, преподаватели и оценки от пресета не зависят: они лежат в состоянии семестра.',
  presetChange: 'Сменить пресет',
  presetChanged: 'Пресет сменён.',
  presetSameNote: 'Этот пресет уже выбран.',
  // Строка про расхождение состояния и пресета: чат заведён одним, активен другой.
  presetDrift: 'Семестр в этом чате собран пресетом «{stateId}», а сейчас активен «{activeId}».',

  // --- настройки: выгрузка и загрузка (3.8) ---------------------------------
  transferSection: 'Выгрузка и загрузка',
  transferNote: 'Состояние семестра одним файлом: перенести в другой чат, сохранить до починки, отдать другому человеку. Ключ API в файл не попадает.',
  exportButton: 'Выгрузить состояние',
  exportOk: 'Файл {filename} отдан браузеру.',
  importPick: 'Выберите файл',
  importOk: 'Состояние загружено.',
  importConfirmTitle: 'Заменить то, что есть?',
  importConfirmYes: 'Да, заменить',
  importConfirmNo: 'Отмена',
  importCancelled: 'Отменено, ничего не тронуто.',
  summaryCurrent: 'Сейчас в чате',
  summaryIncoming: 'Приедет из файла',
  summaryNothing: 'пусто',
  summaryLine: 'пресет {presetId}, день {day}, предметов {subjects}, оценок {grades}',
  summaryNotStarted: 'не начат',

  // --- вопросы перед заменой состояния (`storage.js`, `index.js: setPreset`) --
  //
  // Эти три фразы человек читает ровно в ту секунду, когда решает, стирать ли
  // начатую учёбу. Раньше они были зашиты в `storage.js` и говорили «семестр» и
  // «предметов» под любым пресетом: строкой выше панель писала «дисциплин 7», а
  // предупреждение рядом — «7 предметов». Собираются как фрагменты списка, со
  // строчной буквы: они уходят в перечисление через «; ». Заглавную, когда
  // фрагмент встаёт после точки, ставит `core/state.mjs: joinSentences`.
  importOccupiedStarted: 'в этом чате уже идёт семестр ({subjects} предметов, день {day}) — он пропадёт без следа',
  importOccupiedEmpty: 'в этом чате уже есть состояние вуза — оно будет заменено',
  presetMismatch: 'состояние собрано с пресетом «{from}», сейчас активен «{to}».'
    + ' Предметы, преподаватели и оценки приедут как есть — они лежат в состоянии;'
    + ' а названия периодов, шкала оценок и виды контрольных возьмутся из активного пресета,'
    + ' поэтому знакомые вещи могут называться иначе',

  // --- настройки: лорбук (3.7) ----------------------------------------------
  lorebookSection: 'Лорбук академии',
  lorebookToggle: 'Вести лорбук академии',
  lorebookNote: 'Черты преподавателей, места и хроника уходят в World Info, где запись подгружается по ключу, а не висит в промпте постоянно. Выключено по умолчанию: чужой лорбук расширение своими записями не засоряет.',
  lorebookBound: 'Лорбук «{name}» привязан к этому чату.',
  lorebookNoName: 'Лорбук ещё не заведён: он появится с первым ответом модели.',
  lorebookBookField: 'Имя лорбука',
  lorebookBookHint: 'пусто — по имени чата',
  lorebookMeasure: 'Записей {entries} из {cap}, примерно {tokens} токенов.',
  lorebookOverCap: 'Записей больше потолка: лорбук начнёт вытеснять из контекста всё остальное. Уберите лишние средствами таверны.',
  lorebookRefresh: 'Обновить лорбук',
  lorebookRefreshOk: 'Лорбук обновлён.',
  lorebookSuggestTitle: 'Предложенные записи',
  lorebookSuggestNote: 'Расширение может только предложить запись про человека или место, а не сочинить её само. В лорбук она уйдёт по нажатию.',
  lorebookAccept: 'Добавить',
  lorebookAcceptOk: 'Запись добавлена в лорбук.',
  lorebookNoSuggest: 'Предложений нет.',
  lorebookNewTitle: 'Предложить запись',
  lorebookNewName: 'Имя или название',
  lorebookNewNote: 'Заметка',
  lorebookNewNameHint: 'Маша Лебедева',
  lorebookNewNoteHint: 'соседка по комнате, рисует комиксы',
  lorebookKindPeople: 'человек',
  lorebookKindPlaces: 'место',
  lorebookNewButton: 'Предложить',
  lorebookNewOk: 'Предложено. В лорбук уйдёт по кнопке «Добавить».',
  lorebookOrphansTitle: 'Осиротевшие после свайпов',
  lorebookOrphansNote: 'Записи про то, чего в нынешнем состоянии больше нет. Расширение их не стирает само: своё вы бы потеряли вместе с ними.',
  lorebookPrune: 'Убрать осиротевшие ({count})',
  lorebookPruned: 'Убрано записей: {count}.',
  lorebookOff: 'Лорбук выключен.',
  lorebookNoWorldInfo: 'Эта сборка таверны не отдаёт World Info расширениям, поэтому лорбука не будет. Всё остальное работает.',
  lorebookNoChat: 'Лорбук привязывается к чату, а чат ещё не сохранён. Он заведётся с первым сообщением.',
  lorebookNoState: 'Лорбук заведётся, когда начнётся семестр.',
  lorebookError: 'Лорбук не обновился: {error}',

  // --- слэш-команды (`commands.js` берёт слова отсюда же) --------------------
  cmdPlanTitle: 'Пары дня:',
  cmdNoPlan: 'Пар сегодня нет.',
  cmdNext: 'Дальше: {name} — {when}',
  cmdNoSubjects: 'Предметов в плане нет.',
  cmdAverage: 'среднее {value}',
  cmdShiftPeriods: 'сдвиг в парах, можно отрицательный',
  // Дата в справке — пустая форма, а не пример: справка регистрируется один раз
  // за загрузку страницы (см. решение 4 в шапке `commands.js`), то есть раньше
  // любого семестра и навсегда. Любое конкретное число здесь уже к вечеру звало
  // бы двигать календарь в чужой год, а откаты назад расширение блокирует
  // (правило 3.2) — и человек получил бы отказ на текст, который сам же
  // расширению и подсказало. Живой пример с сегодняшним днём даёт
  // `commands.js: timeText`, которому календарь виден.
  cmdTimeHelp: 'Ручной ремонт календаря. <code>/academy-time day=ГГГГ-ММ-ДД</code>, '
    + '<code>/academy-time days=1</code>, <code>/academy-time periods=-2</code>. '
    + '<code>/academy-time days=1 count=yes</code> — зачесть пропущенное прогулами. '
    + 'Без аргументов показывает, где календарь стоит сейчас.',
  cmdBothUnits: '/academy-time: за один раз двигаем либо днями, либо парами, но не тем и другим.',
  cmdStatusHelp: 'Сводка «сегодня»: дата, неделя, пары дня и средний балл — то же, что на вкладке «Сегодня».',
  cmdGradesHelp: 'Зачётка: предметы, оценки, средний балл, хвосты, репутация словом.',
  cmdStatusReturns: 'сводка учебного дня',
  cmdGradesReturns: 'зачётка текстом',
  cmdStateReturns: 'состояние семестра в JSON',
  cmdStateHelp: 'Состояние семестра как JSON — для карточек и скриптов. '
    + 'Ключи API вырезаны тем же срезом, что и при записи в метаданные чата.',
};

/**
 * Слова панели для этого пресета. `phases` сливается по ключам, а не целиком:
 * пресет вправе переименовать одни каникулы и не трогать остальные фазы.
 */
export function uiLabels(preset) {
  const own = (preset && preset.ui) || {};
  return { ...DEFAULT_UI, ...own, phases: { ...DEFAULT_UI.phases, ...(own.phases || {}) } };
}

/** Подстановка `{ключ}` — та же, что в `prompt.mjs` и `core/lorebook.mjs`. */
export function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * Ярлыки вкладок — из пресета: «Зачётка» у магической академии своя.
 *
 * Настройки — второй, необязательный аргумент: без них вкладок ровно четыре, с
 * включённой отладкой добавляется пятая. Вызов без настроек (а таких в коде и в
 * тестах хватает) обязан вести себя как «отладка выключена».
 */
export function tabsFor(preset, settings) {
  const U = uiLabels(preset);
  const label = {
    today: U.tabToday, gradebook: U.tabGradebook, people: U.tabPeople, settings: U.tabSettings,
  };
  const tabs = TABS.map((t) => ({ ...t, label: label[t.id] || t.label }));
  return settings && settings.debug === true ? [...tabs, { ...DEBUG_TAB }] : tabs;
}

// `A+` — машинный тег времени соседнего расширения (`core/time-source.mjs`,
// план 9.2): Phone-ST, RP_DATE, дневник, Horae, BB-телефон. Какой именно —
// в строке «Применено» (`describeApplied`, поле `via`).
const SOURCE_LABEL = { 'A+': 'тег соседнего расширения', A: 'из контекста', B: 'метка', manual: 'вручную' };

/** Ночь: до первого звонка утра и после того, как заведение закрылось. */
const NIGHT_FROM = 22 * 60;
const NIGHT_TO = 6 * 60;

/**
 * Здоровье состояния — одна точка, через которую проходят все три вкладки.
 * Пустого экрана не бывает: у каждой ветки есть текст и предложенное действие.
 *
 * @returns {{kind: 'no-state'|'not-started'|'broken'|'ok', title: string,
 *   text: string, action: ?{id: string, label: string}, errors: string[]}}
 */
export function stateHealth(state, preset) {
  const U = uiLabels(preset);
  if (!state || typeof state !== 'object') {
    return {
      kind: 'no-state',
      title: U.notStartedTitle,
      text: U.noStateText,
      action: { id: 'open-settings', label: 'Открыть анкету' },
      errors: [],
    };
  }

  // `validateState` сама по себе не бронированная: на состоянии, где
  // `subjects` — строка, она падает внутри проверки расписания
  // (`core/state.mjs`, `(state.subjects || []).some`). Панель обязана пережить
  // и это: исключение при валидации — тоже «состояние повреждено».
  let check;
  try {
    check = validateState(state, preset);
  } catch (err) {
    check = { ok: false, errors: [`проверка состояния сорвалась: ${(err && err.message) || err}`] };
  }
  if (!check.ok) {
    return {
      kind: 'broken',
      title: U.brokenTitle,
      text: U.brokenText,
      action: { id: 'open-settings', label: 'Открыть настройки' },
      errors: check.errors,
    };
  }

  if (!state.started) {
    return {
      kind: 'not-started',
      title: U.notStartedTitle,
      text: state.subjects && state.subjects.length ? U.notStartedWithPlan : U.notStartedNoPlan,
      action: { id: 'open-settings', label: 'Открыть анкету' },
      errors: [],
    };
  }

  return { kind: 'ok', title: '', text: '', action: null, errors: [] };
}

/** «понедельник, 2 сентября». Без года: год на экране — лишнее число. */
export function formatDate(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const { m, d } = parseDay(day);
  return `${WEEKDAYS[dayOfWeek(day)]}, ${d} ${MONTHS[m] || ''}`.trim();
}

/**
 * «3-я неделя». Отрицательные и нулевые номера — «семестр ещё не начался».
 * Обе фразы целиком из пресета: у магической академии это «3-я седмица», и
 * согласование числительного пишет она, а не код.
 *
 * `scope` — ответ `time.termAt` про день (`before`/`in`/`between`/`after`).
 * Нужен он ровно из-за нескольких периодов в году: в промежутке между ними
 * `weekIndex` честно возвращает номер недели ПРОШЛОГО периода (шестнадцатая
 * неделя триместра, который кончился на пятнадцатой), и печатать его — врать.
 * Ноль и минус по-прежнему значат «ещё не начался», но теперь это проверенное
 * утверждение, а не догадка по знаку числа: до первого периода `termAt` говорит
 * `before` сама. Вызывающий без `scope` получает ровно прежнее поведение.
 */
export function formatWeek(n, preset, scope) {
  const U = uiLabels(preset);
  if (scope === 'between') return U.weekBreak;
  if (!Number.isFinite(n)) return '';
  return n < 1 ? U.weekBefore : fill(U.week, { n });
}

/**
 * Как назвать учебный период на экране: именем из пресета, а если имени нет —
 * порядковым номером его же словами.
 */
function termTitle(term, U) {
  if (!term) return '';
  return term.name ? fill(U.termLine, { name: term.name }) : fill(U.termNumber, { n: term.index + 1 });
}

/** Средний балл строкой: одна цифра после запятой, «—» вместо выдуманного нуля. */
export function formatScore(value) {
  return Number.isFinite(value) ? value.toFixed(1).replace('.', ',') : '—';
}

const minutes = (time) => {
  if (typeof time !== 'string' || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const isNight = (time) => {
  const t = minutes(time);
  return t === null ? false : t >= NIGHT_FROM || t < NIGHT_TO;
};

/**
 * Обрезать список сводных чисел до потолка (3.3). Список приходит уже
 * упорядоченным по важности, режется хвост — то, чем на экране можно
 * пожертвовать первым.
 */
export function capNumbers(list, preset) {
  const max = (preset && preset.limits && preset.limits.maxNumbersInPrompt) || DEFAULT_MAX_NUMBERS;
  const out = (list || []).filter((n) => n && n.text);
  return { shown: out.slice(0, max), dropped: out.slice(max), max };
}

/** Сколько сводных чисел вышло на экран. Для теста и для отладки. */
export const countNumbers = (view) => (view && view.numbers ? view.numbers.length : 0);

/**
 * Вкладка «Сегодня» (3.2, 3.9). Главный экран: текущая пара, следующая, дата,
 * неделя, отметка про источник времени и, если время встало, — прямая жалоба.
 *
 * В выходной, на каникулах, ночью и после последней пары расписание молчит:
 * панель, которая в субботу бодро показывает «сейчас: химия», хуже панели,
 * которая молчит.
 */
export function todayView(state, preset) {
  const health = stateHealth(state, preset);
  if (health.kind !== 'ok') return { ...health, numbers: [], silent: true };

  const U = uiLabels(preset);
  const cal = state.calendar;
  const phase = phaseOf(preset, state, cal.day);
  // Пресет обязателен: без него счёт недель идёт сквозной от начала года, и
  // панель во втором триместре сказала бы «20-я неделя» там, где строка
  // состояния в промпте (`prompt.mjs`, тот же `weekIndex` с пресетом) говорит
  // «3-я неделя триместра». Экран и промпт обязаны говорить одно и то же.
  const at = termAt(preset, state, cal.day);
  const week = weekIndex(state, cal.day, preset);
  const plan = dayPlan(state, preset, cal.day);
  const hasClock = cal.precision === 'datetime' && cal.time;
  const night = hasClock && isNight(cal.time);

  const cur = plan.length && !night ? currentPeriod(state, preset) : null;
  const nxt = nextPeriod(state, preset);

  const nameOf = (id) => {
    const s = (state.subjects || []).find((x) => x.id === id);
    return (s && s.name) || id || '';
  };
  const teacherOf = (id) => {
    const s = (state.subjects || []).find((x) => x.id === id);
    const t = s && s.teacherId ? (state.teachers || []).find((x) => x.id === s.teacherId) : null;
    return t ? t.name : '';
  };
  // Корпус и аудитория (9.7A п.11): слово, а не число — в счёт чисел не идут.
  const whereOf = (id) => whereText((state.subjects || []).find((x) => x.id === id));
  const slot = (index) => plan.find((p) => p.index === index) || null;

  // Почему расписание молчит. Порядок — от самого информативного слова.
  let silent = false;
  let silentReason = '';
  if (phase === 'vacation') { silent = true; silentReason = U.silentVacation; }
  // Промежуток между периодами — своя причина, а не каникулы и не выходной:
  // без этой ветки панель бодро показывала бы пары, которых нет.
  else if (phase === 'break') { silent = true; silentReason = U.silentBreak; }
  else if (phase === 'weekend') { silent = true; silentReason = U.silentWeekend; }
  else if (phase === 'exams') { silent = true; silentReason = U.silentExams; }
  else if (night) { silent = true; silentReason = U.silentNight; }
  else if (!plan.length) { silent = true; silentReason = U.silentEmpty; }
  else if (cur && cur.status === 'after') { silent = true; silentReason = U.silentOver; }

  let now = null;
  if (cur && !silent) {
    const s = slot(cur.index);
    const ordinal = cur.index + 1;
    now = {
      status: cur.status, // now | break | before
      title: cur.status === 'now' ? U.nowTitle : cur.status === 'break' ? U.breakTitle : U.beforeTitle,
      subjectId: cur.subjectId,
      name: nameOf(cur.subjectId),
      teacher: teacherOf(cur.subjectId),
      where: whereOf(cur.subjectId),
      ordinal,
      start: s ? s.start : null,
      end: s ? s.end : null,
      // Номер периода словами пресета: «1-я пара», «1-й урок», «1-е занятие».
      slotText: s && s.start && s.end
        ? fill(U.slotTime, { ordinal, start: s.start, end: s.end })
        : fill(U.slot, { ordinal }),
    };
  }

  let next = null;
  if (nxt) {
    const sameDay = nxt.day === cal.day;
    const nextSlot = dayPlan(state, preset, nxt.day).find((p) => p.index === nxt.index) || null;
    next = {
      subjectId: nxt.subjectId,
      name: nameOf(nxt.subjectId),
      teacher: teacherOf(nxt.subjectId),
      where: whereOf(nxt.subjectId),
      day: nxt.day,
      sameDay,
      when: sameDay
        ? (nextSlot && nextSlot.start ? fill(U.nextToday, { start: nextSlot.start }) : U.nextSoon)
        : fill(nextSlot && nextSlot.start ? U.nextDay : U.nextDayNoTime,
          { date: formatDate(nxt.day), start: nextSlot && nextSlot.start }),
    };
  }

  const stalled = isStalled(state, preset);
  const idle = Number(cal.idle) || 0;
  const timeMark = stalled
    ? 'Время стоит, проверьте источник.'
    : cal.source
      ? (idle === 0
        ? `Время двигалось в последнем ответе (${SOURCE_LABEL[cal.source] || cal.source}).`
        : `Время двигалось ${idle} ${plural(idle, 'ответ', 'ответа', 'ответов')} назад (${SOURCE_LABEL[cal.source] || cal.source}).`)
      : 'Время ещё ни разу не двигалось.';

  // Имя периода на экране: только когда периодов в году больше одного. У
  // пресета с одним периодом называть нечего — «семестр» и так один, и лишняя
  // строка была бы шумом (заодно панель печатает ровно то же, что печатала).
  const manyTerms = at.terms.length > 1;
  const termLine = manyTerms ? termTitle(at.term, U) : '';
  // Имя периода — слово и в счёт чисел не идёт, как фаза и как ярлык отношения.
  // А вот безымянный период превращается в порядковый номер, и это уже число:
  // такое считаем наравне с остальными (3.3).
  const termIsWord = Boolean(at.term && at.term.name);

  // Сводные числа по убыванию важности. Слова (фаза, преподаватель) не в счёт.
  const raw = [
    { key: 'date', text: formatDate(cal.day) },
    hasClock ? { key: 'time', text: cal.time } : null,
    { key: 'week', text: formatWeek(week, preset, at.scope) },
    termLine && !termIsWord ? { key: 'term', text: termLine } : null,
    now ? { key: 'ordinal', text: fill(U.slot, { ordinal: now.ordinal }) } : null,
    next ? { key: 'next', text: next.when } : null,
    stalled ? { key: 'idle', text: `${idle} ${plural(idle, 'ответ', 'ответа', 'ответов')} без движения` } : null,
  ].filter(Boolean);
  const capped = capNumbers(raw, preset);

  return {
    kind: 'ok',
    title: '',
    text: '',
    action: null,
    errors: [],
    day: cal.day,
    dateLine: formatDate(cal.day),
    weekLine: formatWeek(week, preset, at.scope),
    week,
    // Период: имя на экране, номер и охват — для тех, кто решает сам.
    termLine,
    termName: at.term ? at.term.name : '',
    termIndex: at.index,
    termsCount: at.terms.length,
    termScope: at.scope,
    phase,
    phaseLabel: U.phases[phase] || phase,
    precision: cal.precision,
    time: hasClock ? cal.time : null,
    silent,
    silentReason,
    now,
    next,
    plan: plan.map((p) => ({
      index: p.index,
      ordinal: p.index + 1,
      subjectId: p.subjectId,
      name: p.name,
      teacher: teacherOf(p.subjectId),
      where: whereOf(p.subjectId),
      start: p.start,
      end: p.end,
      current: Boolean(now && now.subjectId === p.subjectId && now.ordinal === p.index + 1),
    })),
    stalled,
    idle,
    timeMark,
    // Прыжок вперёд, придержанный ядром до слова человека (`time.setAbsolute`).
    // Панель отдаёт его как есть: числа считает вью, слова — отрисовка.
    heldJump: cal.heldJump
      ? {
        day: cal.heldJump.day,
        dateLine: formatDate(cal.heldJump.day),
        fromLine: formatDate(cal.heldJump.from || cal.day),
        time: cal.heldJump.time || null,
        days: Number(cal.heldJump.jump) || 0,
        matched: String(cal.heldJump.matched || '').trim(),
      }
      : null,
    // Исход проверки, брошенной сегодня (9.4.1): d20 против DC одной строкой.
    // Число броска и DC в счёт шести чисел не идут — это сама запись события,
    // как оценки в зачётке, а не сводная метрика.
    exams: examResultsToday(state, preset),
    numbers: capped.shown,
    droppedNumbers: capped.dropped,
  };
}

/**
 * Вкладка «Зачётка» (3.3, 3.4). Предметы, оценки, хвосты, средний балл,
 * репутация словом. Отношение преподавателя — **словом из пресета**: числа
 * наружу не идут, ни в промпт, ни на экран.
 */
export function gradebookView(state, preset) {
  const health = stateHealth(state, preset);
  if (health.kind !== 'ok') return { ...health, subjects: [], numbers: [] };

  const subjects = (state.subjects || []).map((s) => {
    const score = subjectScore(state, s.id, preset);
    const teacher = s.teacherId ? (state.teachers || []).find((t) => t.id === s.teacherId) : null;
    return {
      id: s.id,
      name: s.name,
      teacher: teacher ? teacher.name : '',
      teacherId: teacher ? teacher.id : null,
      // Ярлык, не число: `relationLabel` берёт таблицу из пресета.
      relation: teacher ? relationLabel(state, teacher.id, preset) : '',
      grades: (score.grades || []).map((g) => g.value),
      average: score.average,
      averageText: formatScore(score.average),
      passed: score.passed,
      debt: score.debt,
    };
  });

  const tails = debts(state).map((s) => s.name || s.id);
  const overall = overallScore(state, preset);
  // Несданное считает ядро, а не панель: `examMode.pending` берёт события ТОЙ
  // сессии, что открыта сейчас. Свой фильтр по `!outcome` тянул в «несдано»
  // события прошлых периодов — контрольная первого триместра висела бы в панели
  // весь год, хотя пересдать её уже негде.
  //
  // К событиям сессии добавлены события видов со своим окном в календаре
  // (`datedExams`): они заводятся посреди учебных недель, когда сессии нет, и
  // номер `exams.term` от прошлой сессии выбросил бы их из `mode.pending` как
  // чужие. Показывать их обязаны: назначенная и несданная контрольная, которой
  // нет ни на одном экране, — это тихая потеря (3.8).
  const mode = examMode(state, preset);
  const dated = datedExams(state, preset, state.calendar && state.calendar.day);
  const openExams = [...dated, ...mode.pending.filter((i) => !dated.some((d) => d.id === i.id))]
    .map((e) => {
      const s = (state.subjects || []).find((x) => x.id === e.subjectId);
      const kind = ((preset.exams && preset.exams.kinds) || []).find((k) => k.id === e.kind);
      return { id: e.id, subject: (s && s.name) || e.subjectId, kind: (kind && kind.name) || e.kind, day: e.day };
    });

  const vocab = preset.vocab || {};
  const U = uiLabels(preset);
  const raw = [
    { key: 'overall', text: fill(U.scoreLine, { scoreName: vocab.score || 'средний балл', value: formatScore(overall) }) },
    tails.length ? { key: 'debts', text: fill(U.debtsLine, { debtPlural: vocab.debtPlural || 'хвосты', count: tails.length }) } : null,
    { key: 'subjects', text: fill(U.subjectsLine, { count: subjects.length }) },
    // Падеж — забота пресета: «несдано в сессию», «не пройдено к испытаниям».
    openExams.length ? { key: 'exams', text: fill(U.examsLine, { examPeriod: vocab.examPeriod || 'сессию', count: openExams.length }) } : null,
  ].filter(Boolean);
  const capped = capNumbers(raw, preset);

  return {
    kind: 'ok',
    title: '',
    text: '',
    action: null,
    errors: [],
    subjects,
    debts: tails,
    overall,
    overallText: formatScore(overall),
    scoreName: capitalize(vocab.score || 'средний балл'),
    // Репутация — слово. Число остаётся внутри (3.4).
    reputation: reputationLabel(state, preset),
    expelled: Boolean(state.reputation && state.reputation.expelled),
    warned: Boolean(state.reputation && state.reputation.warned),
    examsActive: mode.active,
    // Чья сессия идёт. Пока период в году один, называть его незачем, и строки
    // нет вовсе; закрытая сессия не называется тем более — флаг `active` теперь
    // честно гаснет между периодами, и говорить «идёт сессия» после него значило
    // бы держать на экране прошлогоднюю новость до конца игры.
    examsTermLine: examsTermLine(state, preset, mode, U),
    openExams,
    // Вехи (9.4.2) — список, а не число: в счёт шести чисел не идут.
    milestones: milestonesView(state, preset),
    // Итоги, посчитанные, но ещё не объявленные миру (9.4.3). Панель — «знает
    // расширение»: оценка уже стоит в таблице выше, и человек должен видеть,
    // почему модель про неё молчит.
    awaiting: awaitingView(state, preset),
    numbers: capped.shown,
    droppedNumbers: capped.dropped,
  };
}

/**
 * «Сессия: второй триместр» — какого периода контрольные висят в списке.
 * Пустая строка, если сессия закрыта или период в году всего один.
 */
function examsTermLine(state, preset, mode, U) {
  if (!mode.active) return '';
  const terms = termsOf(preset, state);
  if (terms.length < 2) return '';
  const index = state.exams && Number.isFinite(state.exams.term) ? state.exams.term : -1;
  const term = terms[index];
  if (!term) return '';
  return fill(U.examsTerm, { name: termTitle(term, U) });
}

/**
 * Вкладка «Люди» (3.9, 3.4). Преподаватели, их предмет, черты и отношение к
 * студентке; ниже — репутация заведения и предметы, у которых преподавателя нет.
 *
 * Жёсткое правило плана (`:296-297`, `:322`): **отношение выходит наружу словом**.
 * Поэтому здесь нет `relationOf` — модуль числа отношения не запрашивает вовсе,
 * и просочиться ему неоткуда: ни в текст, ни в подсказку, ни в data-атрибут.
 * История сдвигов — по той же причине не «−1 за опоздание», а переход ярлыка
 * «ровно → недоволен»: она восстанавливается из журнала (`kind: 'rel'`, поля
 * `data.from`/`data.to`) той же таблицей `preset.relations.labels`, которой
 * пользуется `relationLabel`. Записи, где ярлык не менялся, отбрасываются: это
 * и есть значимое событие по `core/relations.mjs`, остальное — шум.
 *
 * Счёт сводных чисел (3.3): на вкладке ровно одно — сколько преподавателей.
 * Даты в истории в счёт не идут по тому же основанию, что оценки в зачётке:
 * это сама запись, а не метрика, и история без дат бесполезна.
 */
export function peopleView(state, preset) {
  const health = stateHealth(state, preset);
  if (health.kind !== 'ok') {
    return { ...health, teachers: [], orphans: [], reputation: '', numbers: [], droppedNumbers: [] };
  }

  const U = uiLabels(preset);
  const relLabels = (preset && preset.relations && preset.relations.labels) || [];
  const subjects = state.subjects || [];
  const list = state.teachers || [];

  // Журнал разбирается один раз на всех: он кольцевой и до `journalSize` длинный,
  // а перебирать его по разу на преподавателя — квадрат на ровном месте.
  const history = new Map();
  for (const e of state.journal || []) {
    if (!e || e.kind !== 'rel' || !e.data) continue;
    const id = e.data.teacherId;
    if (!id || !Number.isFinite(e.data.from) || !Number.isFinite(e.data.to)) continue;
    const from = labelFor(relLabels, e.data.from);
    const to = labelFor(relLabels, e.data.to);
    if (!from || !to || from === to) continue;
    const got = history.get(id) || [];
    got.push({ day: e.day || '', dateLine: formatDate(e.day || ''), from, to, text: fill(U.relationShift, { from, to }) });
    history.set(id, got);
  }

  const teachers = list.map((t) => {
    const traits = (t.traits || []).map(str).filter(Boolean);
    const own = subjects.filter((s) => s.teacherId === t.id).map((s) => s.name || s.id);
    // Хвост журнала, свежим вперёд: на телефоне видна последняя перемена, а не
    // первая, и список не растёт вместе с семестром.
    const shifts = (history.get(t.id) || []).slice(-PEOPLE_HISTORY).reverse();
    return {
      id: t.id,
      name: t.name || t.id,
      traits,
      traitsText: traits.length ? traits.join(', ') : U.traitsNone,
      hasTraits: traits.length > 0,
      subjects: own,
      subjectsText: own.length ? own.join(', ') : U.subjectsNone,
      relation: relationLabel(state, t.id, preset),
      history: shifts,
      historyText: shifts.length ? '' : U.relationNoHistory,
      // Портрет (9.7A п.15): адрес, который дал человек, и только годный —
      // в `<img src>` не уходит ничего, что не прошло `isPortrait`.
      portrait: isPortrait(t.portrait) ? t.portrait : '',
      // День рождения (9.4.4, 9.7A п.9): `ММ-ДД` для поля и словами для карточки.
      birthday: typeof t.birthday === 'string' ? t.birthday : '',
      birthdayText: birthdayText(t.birthday)
        ? fill(extraLabels(preset).birthdayLine, { date: birthdayText(t.birthday) }) : '',
    };
  });

  // Предмет без преподавателя и предмет со ссылкой на выбывшего — одна и та же
  // дыра для этой вкладки: отношения по нему считать не с кем.
  const orphans = subjects
    .filter((s) => !s.teacherId || !list.some((t) => t.id === s.teacherId))
    .map((s) => s.name || s.id);

  const capped = capNumbers([
    { key: 'teachers', text: fill(U.peopleCountLine, { count: teachers.length }) },
  ], preset);

  return {
    kind: 'ok',
    title: '',
    text: '',
    action: null,
    errors: [],
    teachers,
    orphans,
    // Репутация здесь уместна: отношения личные, репутация — то же самое, но со
    // стороны заведения (3.4). Слово, как и отношение; число остаётся внутри.
    reputation: reputationLabel(state, preset),
    expelled: Boolean(state.reputation && state.reputation.expelled),
    warned: Boolean(state.reputation && state.reputation.warned),
    numbers: capped.shown,
    droppedNumbers: capped.dropped,
  };
}

/**
 * Строки редактируемой таблицы из состояния (3.6). Таблица доступна всегда, а
 * не только при сбое генерации, поэтому источник строк один — состояние, а не
 * ответ модели.
 */
export function rowsFromState(state) {
  return {
    subjects: ((state && state.subjects) || []).map((s) => ({
      id: s.id, name: s.name, teacherId: s.teacherId || '',
      building: s.building || '', room: s.room || '',
    })),
    teachers: ((state && state.teachers) || []).map((t) => ({
      id: t.id, name: t.name, traits: (t.traits || []).join(', '),
    })),
  };
}

/**
 * Проверка руками правленной таблицы предметов и преподавателей.
 *
 * Отличие от `validatePlan` в `core/plan-gen.mjs` намеренное: там проверяется
 * ответ модели и претензии кодируются машинно (`subject-no-teacher:chemistry`),
 * здесь текст читает человек, который прямо сейчас держит палец на поле. Плюс
 * отсутствие черт характера тут — замечание, а не брак: вписать свой предмет и
 * дописать характер позже — законный сценарий.
 *
 * @returns {{ok: boolean, errors: Array<{scope: 'subject'|'teacher'|'form',
 *   index: number, field: string, text: string}>, notes: string[],
 *   subjects: Array, teachers: Array}}
 */
export function validateSubjectRows(rows, preset) {
  const limits = (preset && preset.limits) || {};
  const U = uiLabels(preset);
  const maxSubjects = limits.maxSubjects || 8;
  const maxTeachers = limits.maxTeachers || 8;
  const maxId = limits.maxIdLength || 24;

  const errors = [];
  const notes = [];
  const bad = (scope, index, field, text) => errors.push({ scope, index, field, text });

  const inSubjects = Array.isArray(rows && rows.subjects) ? rows.subjects : [];
  const inTeachers = Array.isArray(rows && rows.teachers) ? rows.teachers : [];

  const teachers = [];
  const teacherIds = new Set();
  inTeachers.forEach((raw, i) => {
    const name = str(raw && raw.name);
    if (!name) { bad('teacher', i, 'name', U.errTeacherName); return; }
    const id = (str(raw && raw.id) || slugify(name, { maxLength: maxId })).slice(0, maxId);
    if (teacherIds.has(id)) { bad('teacher', i, 'id', fill(U.errTeacherDup, { id })); return; }
    teacherIds.add(id);
    const traits = String((raw && raw.traits) || '').split(',').map((t) => t.trim()).filter(Boolean);
    if (!traits.length) notes.push(fill(U.noteNoTraits, { name }));
    teachers.push({ id, name, traits });
  });
  if (teachers.length > maxTeachers) {
    bad('form', -1, 'teachers', fill(U.errManyTeachers, { count: teachers.length, max: maxTeachers }));
  }

  const subjects = [];
  const subjectIds = new Set();
  inSubjects.forEach((raw, i) => {
    const name = str(raw && raw.name);
    if (!name) { bad('subject', i, 'name', U.errSubjectName); return; }
    const id = (str(raw && raw.id) || slugify(name, { maxLength: maxId })).slice(0, maxId);
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
      bad('subject', i, 'id', fill(U.errSubjectId, { id }));
      return;
    }
    if (subjectIds.has(id)) { bad('subject', i, 'id', fill(U.errSubjectDup, { id })); return; }
    subjectIds.add(id);

    let teacherId = str(raw && raw.teacherId);
    if (teacherId && !teacherIds.has(teacherId)) {
      bad('subject', i, 'teacherId', fill(U.errSubjectTeacher, { name, teacherId }));
      teacherId = '';
    }
    if (!teacherId) notes.push(fill(U.noteNoTeacher, { name }));
    // Корпус и аудитория необязательны (9.7A п.11). Ключи есть всегда, пустая
    // строка — «стёрто»: `index.js: setSubjects` сливает строку таблицы с
    // предметом из состояния, и без ключа стёртый корпус вернулся бы из
    // старого. В состояние пустые не попадут — их выбросит `normalizeSubject`.
    // Длинные режутся тем же потолком, что держит `validateState`.
    const place = {};
    for (const key of ['building', 'room']) {
      place[key] = str(raw && raw[key]).replace(/\s+/g, ' ').slice(0, PLACE_MAX);
    }
    subjects.push({ id, name, teacherId: teacherId || null, ...place });
  });
  if (subjects.length > maxSubjects) {
    bad('form', -1, 'subjects', fill(U.errManySubjects, { count: subjects.length, max: maxSubjects }));
  }
  if (!subjects.length) {
    bad('form', -1, 'subjects', U.errNoSubjects);
  }

  return { ok: errors.length === 0, errors, notes, subjects, teachers };
}

/** Анкета из состояния или из настроек-черновика. Всегда шесть полей. */
export function surveyOf(state, settings) {
  const draft = (settings && settings.ui && settings.ui.surveyDraft) || null;
  return { ...emptySurvey(), ...(draft || {}), ...((state && state.survey) || {}) };
}

/**
 * Вкладка «Настройки» (3.6, 3.2, 3.7, 3.8). Возвращает всё, что нужно
 * отрисовать, и — отдельно — почему кнопка «начать семестр» недоступна: пустая
 * недоступная кнопка без объяснения хуже, чем её отсутствие.
 *
 * Четвёртый аргумент — то, чего в состоянии и настройках нет: отчёт лорбука и
 * список пресетов. Оба приходят от `index.js` (`host.getLorebook()`,
 * `host.getPresets()`), потому что первый лежит в World Info, а второй — в
 * папке расширения, и панель ни того ни другого не знает. Вызов без него
 * обязан вести себя как «лорбука нет, пресет один» — так зовут `settingsView`
 * старые тесты и `commands.js`.
 */
/**
 * Графа «откуда генерировать». До неё выбор был невидимым: пустые поля молча
 * значили «через подключение таверны». Теперь источник назван вслух, а
 * `routed` — то, куда запрос уйдёт на самом деле, посчитанное тем же правилом,
 * что и в `api.js`.
 */
function apiView(raw, connections) {
  const api = raw || {};
  const source = ['auto', 'tavern', 'own'].includes(String(api.source)) ? String(api.source) : 'auto';
  const c = connections || {};
  const profiles = Array.isArray(c.profiles)
    ? c.profiles.filter((p) => p && p.id).map((p) => ({
      id: String(p.id), name: String(p.name || p.id), model: String(p.model || ''),
    }))
    : [];
  const profile = String(api.profile || '');
  return {
    endpoint: String(api.endpoint || ''),
    key: String(api.key || ''),
    model: String(api.model || ''),
    source,
    // Куда уйдёт запрос прямо сейчас: 'tavern' или 'endpoint'.
    routed: resolveSource({ ...api, source }),
    profile,
    profiles,
    // Профиль мог быть удалён или переименован в самой таверне — молчать об
    // этом нельзя: генерация уедет не туда, куда человек выбирал.
    profileMissing: Boolean(profile) && profiles.length > 0 && !profiles.some((p) => p.id === profile),
    connectionAvailable: c.available !== false,
    // Старое поле: «полей нет, пойдём через таверну». Оставлено, чтобы вью
    // читался и теми, кто про новую графу ещё не знает.
    fallback: !String(api.endpoint || '').trim(),
  };
}

export function settingsView(state, settings, preset, extra = {}) {
  const s = settings || {};
  const api = s.api || {};
  const rows = rowsFromState(state);
  const check = validateSubjectRows(rows, preset);
  const started = Boolean(state && state.started);

  const U = uiLabels(preset);
  const blockers = [];
  if (!rows.subjects.length) blockers.push(U.blockNoSubjects);
  if (!check.ok) blockers.push(U.blockBadTable);
  if (started) blockers.push(U.blockStarted);

  return {
    survey: SURVEY_FIELDS.map((f) => ({ ...f, value: String(surveyOf(state, settings)[f.key] || '') })),
    subjects: rows.subjects,
    teachers: rows.teachers,
    validation: check,
    api: apiView(api, extra.connections),
    mode: TIME_MODES.some((m) => m.id === s.mode) ? s.mode : 'auto',
    modes: TIME_MODES.map((m) => ({ ...m, active: m.id === (s.mode || 'auto') })),
    // В режиме «из контекста» инжект инструкции не имеет смысла (3.2).
    injectMarker: s.mode === 'context' ? false : s.injectMarker !== false,
    injectMarkerLocked: s.mode === 'context',
    // Предупреждать есть смысл только там, где метка вообще идёт в промпт:
    // в режиме «из контекста» её нет, и видеть в тексте нечего.
    markerRisk: Boolean(extra.markerRisk) && s.mode !== 'context',
    relativeWords: Boolean(s.relativeWords),
    // Строка состояния через макрос `{{academy}}` (9.3.1): автоинжект гаснет.
    statusViaMacro: s.statusViaMacro === true,
    debug: s.debug === true,
    started,
    canStart: blockers.length === 0,
    startBlockers: blockers,
    lorebook: lorebookView(extra.lorebook, s, U),
    presets: presetsView(extra.presets, state, preset, U),
    // Слова настроек едут вместе с видом: отрисовке пресет второй раз не нужен.
    labels: U,
  };
}

/**
 * Лорбук на экране (3.7). Главное здесь — последняя ветка: **пустого экрана не
 * бывает**. Лорбука может не быть по четырём разным причинам, и каждая
 * называется вслух, потому что «галочка стоит, а записей нет» без объяснения —
 * это молчаливая поломка, в которой человеку некуда пойти.
 *
 * Осиротевшие показываются только вместе с кнопкой уборки: список того, что
 * «лишнее в вашем World Info», без единого способа это убрать, пугает и ничего
 * не даёт.
 */
function lorebookView(raw, settings, U) {
  const l = raw || {};
  const enabled = l.enabled === true;
  const measure = l.measure && typeof l.measure === 'object' ? l.measure : null;
  const explain = (() => {
    if (!enabled) return '';
    if (l.error) return fill(U.lorebookError, { error: String(l.error) });
    if (l.reason === 'no-world-info') return U.lorebookNoWorldInfo;
    if (l.reason === 'no-chat') return U.lorebookNoChat;
    if (l.reason === 'no-state' || l.reason === 'off') return U.lorebookNoState;
    if (l.reason) return fill(U.lorebookError, { error: String(l.reason) });
    return '';
  })();

  return {
    enabled,
    book: String((settings.lorebook && settings.lorebook.book) || ''),
    name: String(l.name || ''),
    // Строка привязки: имя лорбука и то, что он именно этого чата, — 3.7 требует
    // сказать это рядом с галочкой, иначе человек не поймёт, куда пошли записи.
    boundLine: l.name ? fill(U.lorebookBound, { name: String(l.name) }) : (enabled && !explain ? U.lorebookNoName : ''),
    explain,
    measure,
    // «Примерно»: замер считает символы делением на среднюю длину токена, а не
    // токенизатором таверны, и выдавать прикидку за точное число нельзя.
    //
    // `cap` — потолок **числа записей** (`core/lorebook.mjs: entryCap`, параметр
    // пресета `maxLorebookEntries`), а не токенов. Стоять он обязан рядом с
    // `entries`: пока фраза читалась «примерно 479 токенов из 50», человек видел
    // превышение впятеро там, где записей было 8 из 50.
    measureLine: measure
      ? fill(U.lorebookMeasure, {
        entries: Number(measure.entries) || 0,
        tokens: Number(measure.tokens) || 0,
        cap: Number(measure.cap) || 0,
      })
      : '',
    overCap: Boolean(measure && measure.withinCap === false),
    overCapLine: measure && measure.withinCap === false ? U.lorebookOverCap : '',
    // Имя предложения — первый ключ записи: именно по нему она сработает в
    // сцене, и показывать вместо него служебный `uid` значило бы показать не то,
    // что человек согласовывает.
    suggest: (Array.isArray(l.suggest) ? l.suggest : []).map((e) => ({
      uid: String((e && e.uid) || ''),
      name: String((e && Array.isArray(e.keys) && e.keys[0]) || (e && e.uid) || ''),
      text: String((e && e.content) || ''),
    })),
    orphans: (Array.isArray(l.orphans) ? l.orphans : []).map((o) => ({
      uid: String((o && o.uid) || o || ''),
    })),
  };
}

/**
 * Выбор пресета. `drift` — то, о чём панель обязана сказать вслух: чат заведён
 * одним пресетом, а активен другой. Молча это не расходится ни в одной
 * проверке — `validateState` про `presetId` знает только то, что он непустой, —
 * а на экране от этого перестаёт считаться средний балл.
 */
function presetsView(raw, state, preset, U) {
  const activeId = String((preset && preset.id) || (raw && raw.active) || '');
  const hasList = Boolean(raw && Array.isArray(raw.list) && raw.list.length);
  const list = hasList
    ? raw.list
    : (activeId ? [{ id: activeId, name: String(preset.displayName || preset.name || activeId) }] : []);
  const stateId = String((state && state.presetId) || '');
  const activeItem = list.find((p) => String(p.id) === activeId);
  const activeName = activeItem ? String(activeItem.name || activeId) : activeId;
  return {
    active: activeId,
    activeUser: Boolean(activeItem && activeItem.user === true),
    list: list.map((p) => ({
      id: String(p.id),
      name: String(p.name || p.id),
      broken: p.broken === true,
      active: String(p.id) === activeId,
      // Свой пресет человека (9.3.2): его можно удалить, встроенный — нет.
      user: p.user === true,
    })),
    started: Boolean(state && state.started),
    drift: stateId && activeId && stateId !== activeId
      ? fill(U.presetDrift, { stateId, activeId })
      : '',
    // Чат заведён пресетом, которого нет в списке вовсе (удалён). Судится
    // только по настоящему списку хоста: запасной список из одного активного
    // пресета объявил бы пропавшими все остальные.
    gone: hasList && stateId && stateId !== activeId && !list.some((p) => String(p.id) === stateId)
      ? fill(PRESET_TEXT.stateGone, { id: stateId, active: activeName })
      : '',
    notice: String((raw && raw.notice) || ''),
  };
}

/**
 * Слова переносимых пресетов (9.3.2). В `DEFAULT_UI` их нет и в пресеты они
 * не едут — по той же причине, что слова отладки: «файл», «JSON», «встроенный
 * пресет», «1 МБ» — это слова механизма, а не заведения, и японской школе
 * переводить их незачем. Есть и вторая причина, своя: эти строки говорят
 * ПРО пресеты — в том числе про пресет, который только что удалён или ещё не
 * загружен, — и брать их из активного пресета значило бы спрашивать у
 * заведения, как назвать его собственное исчезновение.
 *
 * Слова заведения здесь всё-таки звучат — в превью, и они берутся из самого
 * загружаемого пресета (`core/preset.mjs: presetSummary`).
 */
export const PRESET_TEXT = {
  exportButton: 'Выгрузить пресет',
  exportOk: 'Файл {filename} отдан браузеру.',
  exportNote: 'Встроенный пресет выгружается как основа для своего: поправьте файл и загрузите обратно — он ляжет рядом, а не вместо.',
  importPick: 'Загрузить пресет из файла',
  importNote: 'Пресет — JSON до 1 МБ. Перед добавлением покажется, что это за заведение.',
  previewTitle: 'Пресет из файла',
  previewRenamed: 'Такой id уже занят — пресет ляжет как «{id}».',
  previewWarnings: 'Замечания',
  add: 'Добавить',
  addApply: 'Добавить и применить',
  cancel: 'Отмена',
  cancelled: 'Отменено, ничего не добавлено.',
  added: 'Пресет «{name}» добавлен.',
  addedApplied: 'Пресет «{name}» добавлен и включён.',
  addedNotApplied: 'Пресет «{name}» добавлен, но не включён: смену отменили.',
  tooBig: 'Файл больше 1 МБ: пресет столько не весит.',
  readFailed: 'Файл не прочитался: {error}',
  full: 'Своих пресетов уже {max} — удалите ненужный, чтобы добавить новый.',
  deleteButton: 'Удалить пресет',
  deleteNote: 'Удаляется только свой пресет. Чаты, заведённые им, останутся — они будут играть активным пресетом.',
  deleteConfirm: 'Удалить «{name}»? Выгрузите его перед этим, если он ещё пригодится.',
  deleteYes: 'Да, удалить',
  deleted: 'Пресет удалён.',
  deleteBuiltin: 'Встроенный пресет удалить нельзя: это файл расширения.',
  deleteMissing: 'Пресета «{id}» среди своих нет.',
  deleteActive: 'Пресет «{name}» сейчас активен, и учёба в этом чате идёт по нему. После удаления включится встроенный «{fallback}»: часы встанут по его звонкам, слова и шкала станут его',
  deletedFallback: 'Пресет «{name}» удалён — включён встроенный «{fallback}».',
  startFallback: 'Выбранный пресет «{id}» {why} — включён встроенный «{fallback}».',
  whyMissing: 'больше не найден',
  whyBroken: 'не прошёл проверку ({error})',
  stateGone: 'Этот чат заведён пресетом «{id}», которого больше нет. Играет активный «{active}»; загрузите тот пресет обратно, если он сохранился файлом.',
  userMark: 'свой',
};

/* -------------------------------------------------------------------------- *
 *  Режим отладки (3.2 `:277-279`, 3.5 `:342`, README `:632-633`).
 * -------------------------------------------------------------------------- */

/**
 * Слова отладки. В `DEFAULT_UI` их нет и в пресеты они не едут сознательно:
 * «источник», «инжект», «отброшено», номер сообщения — это слова механизма, а не
 * заведения. Японская школа и магическая академия называют по-своему пару и
 * зачётку, но не `MESSAGE_RECEIVED`; тащить такое в три пресета значило бы
 * заставить переводчика переводить то, что переводу не подлежит.
 *
 * Названия учебного периода здесь всё-таки нет ни одного: там, где ядро назвало
 * бы «сессию», отладка берёт `preset.vocab.examPeriod` — ключ давно есть.
 */
export const DEBUG_TEXT = {
  section: 'Отладка',
  toggle: 'Режим отладки: разбор последнего ответа отдельной вкладкой',
  hint: 'Если время не идёт — включите и посмотрите, какой источник сработал '
    + 'и что расширение отбросило. Состояние и ключи API на вкладку не выводятся.',
  noRun: 'Разбора ещё не было: ни одного ответа модели в этом чате расширение не считало.',
  head: 'Сообщение #{mesId} ({source}), режим времени: {mode}.',
  sourceOn: 'Источник времени: {source}, время {moved}.',
  sourceOff: 'Источник времени: не сработал ни один, время {moved}.',
  stalled: 'Стоит уже {idle} {plural}.',
  moved: 'сдвинулось',
  notMoved: 'осталось на месте',
  marker: 'Метка: {marker}',
  noMarker: 'Метки в ответе не было.',
  appliedTitle: 'Применено',
  noApplied: 'Применять было нечего.',
  rejectedTitle: 'Отброшено',
  notesTitle: 'Замечания',
  // Без слова заведения: строка под этим заголовком приходит из
  // `core/exams.mjs: permissionLine` и уже начинается названием периода из
  // пресета («испытания: …»). «Разрешение сессии» тут повторяло его же —
  // словами русского вуза, вопреки обещанию в шапке `DEBUG_TEXT`.
  permissionTitle: 'Разрешение',
  injectsTitle: 'В промпт ушло одноразовым инжектом',
  noInjects: 'Одноразовых инжектов не было.',
  divergenceTitle: 'Расхождения с моделью',
  divergence: '{subject}: посчитано {computed}, модель написала {said}.',
  divergenceUnread: '{subject}: модель написала {said}, разобрать не удалось — посчитанное осталось.',
  // Кубик соседа (Enhance-Gen, 9.4.1/9.7B) приходит тем же `resolveConflict`,
  // но это не «модель написала»: подпись по `divergence.source`.
  divergenceDice: '{subject}: посчитано {computed}, кубик соседа решил {said}.',
  divergenceDiceUnread: '{subject}: кубик соседа дал {said}, в шкалу не легло — посчитанное осталось.',
  noDivergence: 'Расхождений посчитанного с версией модели не было.',
  journalTitle: 'Журнал, последние записи',
  noJournal: 'Журнал пуст.',
};

/**
 * Разбор последнего прогона (`host.getDebug()` — это `live.lastRun` из
 * `index.js`) плюс журнал расхождений из состояния.
 *
 * Слова взяты у `commands.js:debugText` — расходиться с `/academy-debug` в
 * названиях полей нельзя, человек читает то одно, то другое. Логика не
 * скопирована: там результат склеивается в одну строку для чата, здесь —
 * структура, из которой вкладка делает блоки, а тест читает поля.
 *
 * Первое, что делает функция, — смотрит на галочку. При выключенной отладке
 * наружу не уходит ничего: ни разбора, ни журнала, ни признака «был прогон».
 */
export function debugView(run, state, preset, settings) {
  const enabled = Boolean(settings && settings.debug === true);
  const empty = {
    enabled: false,
    hasRun: false,
    head: '', source: '', stalled: '', marker: '',
    applied: [], rejected: [], notes: [], injects: [], permission: '',
    divergences: [], journal: [], noRun: '',
  };
  if (!enabled) return empty;

  const vocab = (preset && preset.vocab) || {};
  const T = DEBUG_TEXT;
  const divergences = journalDivergences(state, preset, T);
  const journal = ((state && state.journal) || []).slice(-DEBUG_JOURNAL).reverse()
    .map((e) => ({
      day: e.day || '',
      kind: e.kind || '',
      text: str(e.text) || shortData(e.data),
    }))
    .filter((e) => e.text || e.kind);

  if (!run) {
    // Прогонов не было, а журнал мог остаться от прошлой сессии игры: показать
    // его всё равно надо — расхождение экзамена живёт именно там, а не в прогоне.
    return { ...empty, enabled: true, noRun: T.noRun, divergences, journal };
  }

  const d = run.debug || {};
  const idle = Number(d.idle) || 0;
  return {
    enabled: true,
    hasRun: true,
    noRun: '',
    head: fill(T.head, { mesId: run.mesId, source: run.source || 'received', mode: d.mode || '—' }),
    source: d.source
      ? fill(T.sourceOn, { source: SOURCE_LABEL[d.source] || d.source, moved: d.moved ? T.moved : T.notMoved })
      : fill(T.sourceOff, { moved: d.moved ? T.moved : T.notMoved }),
    stalled: d.stalled
      ? fill(T.stalled, { idle, plural: plural(idle, 'ответ', 'ответа', 'ответов') })
      : '',
    marker: d.marker ? fill(T.marker, { marker: d.marker }) : T.noMarker,
    applied: (d.applied || []).map((i) => describeApplied(i, vocab, { state, preset })).filter(Boolean),
    rejected: (d.rejected || []).map(describeRejected).filter(Boolean),
    notes: (d.notes || run.notes || []).map(str).filter(Boolean),
    permission: str(run.permission),
    injects: (run.injects || []).map((i) => (typeof i === 'string' ? i : (i && i.text))).filter(Boolean),
    divergences,
    journal,
  };
}

/**
 * Расхождения посчитанного исхода с версией модели (3.5 `:342`). Пишет их
 * `core/exams.mjs:resolveConflict` в журнал полем `data.modelSaid`; ветка
 * `applied: false` — «модель написала что-то, чего в шкале пресета нет», и
 * посчитанный исход остался стоять. Обе ветки на экране разные, потому что и
 * последствия у них разные.
 */
function journalDivergences(state, preset, T) {
  const out = [];
  for (const e of (state && state.journal) || []) {
    const d = e && e.data;
    if (!d || d.modelSaid === undefined || d.examId === undefined) continue;
    const subject = (((state.subjects || []).find((s) => s.id === d.subjectId)) || {}).name || d.subjectId || '';
    const computed = d.computed === null || d.computed === undefined ? '—' : String(d.computed);
    const dice = d.source === 'dice';
    const template = dice
      ? (d.applied === false ? T.divergenceDiceUnread : T.divergenceDice)
      : (d.applied === false ? T.divergenceUnread : T.divergence);
    out.push({
      examId: d.examId,
      subject,
      computed,
      said: String(d.modelSaid),
      applied: d.applied !== false,
      source: dice ? 'dice' : 'model',
      day: e.day || '',
      text: fill(template, { subject, computed, said: String(d.modelSaid) }),
    });
  }
  return out;
}

/**
 * Одна применённая правка словами. Формы — из `core/engine.mjs`, `out.debug.applied`.
 *
 * Раньше своя копия этой функции жила в `commands.js` и печатала «пропущено
 * пар» и «назначена сессия на …» — слова русского вуза в общем коде, из-за
 * которых `/academy-debug` в магической академии врал, хотя вкладка «Отладка»
 * говорила правильно. Копий больше нет: `commands.js` зовёт эту, а название
 * периода берётся из `vocab.examPeriod`. Расхождение слов между командой и
 * панелью — это расхождение, которое читает человек: он смотрит то одно, то
 * другое.
 */
export function describeApplied(item, vocab, ctx = {}) {
  if (!item || typeof item !== 'object') return str(item);
  // `ctx` — `{state, preset}`, необязательный: повод сдвига отношения (9.7B)
  // словами собирает `relations.reasonText`, и ему нужны имя предмета и
  // фразы пресета. Старый вызов с двумя аргументами печатает то же, что раньше.
  const { state = null, preset = null } = ctx || {};
  vocab = vocab || {};
  switch (item.kind) {
    case 'attendance': return `посещаемость: ${item.subjectId} — ${item.status}`;
    case 'missed': return `пропущено по расписанию: ${item.count}`;
    case 'grade': return `оценка: ${item.subjectId} — ${item.value}`;
    // Число отношения тут законно: отладка — единственное место, куда оно
    // выходит (`core/relations.mjs`), и вкладка «Люди» его по-прежнему не знает.
    // Слово силы (9.3.4) печатается рядом с числом: «major» в метке и «+2» в
    // шкале — одно и то же, и видеть надо оба. Погашенный повтор (9.3.5) стоит
    // в «применено» с пометкой, а не молча исчезает: иначе «модель пишет +1, а
    // отношение стоит» выглядело бы поломкой.
    case 'rel': {
      const impact = item.impact ? ` (${item.impact})` : '';
      const damped = item.damped ? ' — погашено: тот же сдвиг подряд' : '';
      // Повод (9.7B): «за что» — первое, что спрашивают про сдвиг отношения.
      const why = item.reason ? reasonText(item.reason, state, preset) : '';
      return `отношение: ${item.teacherId} ${item.delta > 0 ? '+' : ''}${item.delta}${impact}${damped}${why ? `; повод: ${why}` : ''}`;
    }
    // Объявление итогов (9.4.3): мир узнал оценку, посчитанную раньше.
    case 'announced': return `объявлены итоги: ${(item.examIds || []).join(', ')}`;
    case 'exams-scheduled': return `назначено: ${vocab.examPeriod || 'сессия'} — ${item.day}`;
    case 'exams-closed': return `закрыто: ${vocab.examPeriod || 'сессия'}`;
    // Исход лежит в `value`: так его кладёт `engine.mjs:487`
    // (`exam: { examId, subjectId, value, reason }`). Читать `outcome` — как было
    // до этой правки — значило печатать «контрольное: алхимия —» без самого
    // исхода: поля с таким именем в объекте нет. `outcome` оставлен запасным
    // именем, потому что так поле зовётся в самом событии сессии.
    case 'exam': {
      const head = `контрольное: ${item.subjectId || ''} — ${item.value || item.outcome || ''}`.trim();
      // Итог, который мир узнает позже (9.4.3), и исход кубика соседа (9.4.1):
      // оба хвостом строки, чтобы «почему оценка не в строке состояния» и
      // «почему не мой бросок» читались там же, где сам исход.
      const later = item.announceOn ? `; объявят ${item.announceOn}` : '';
      const ext = item.external && typeof item.external === 'object'
        ? `; кубик соседа: ${TIER_TEXT[item.external.tier] || item.external.tier || '?'}`
          + `${Number.isFinite(item.external.roll) ? ` ${item.external.roll}` : ''}`
          + `${Number.isFinite(item.external.dc) ? ` из ${item.external.dc}` : ''}`
          + `${item.external.value ? ` → ${item.external.value}` : ''}`
        : '';
      if (item.reason === 'auto') return `${head}; без броска: балл не ниже порога автомата${later}`;
      const why = describeCheck(item.check);
      return `${why ? `${head}; ${why}` : head}${ext}${later}`;
    }
    // У перехода три формы, и все три должны быть читаемы. Абсолютный несёт
    // день и часы (`unit` и `reason` у него пустые — до этой правки строка так
    // и печаталась голым «время:»), сдвиг несёт единицу с числом, а «сцена
    // продолжается» — готовую причину словами.
    case 'time': {
      if (item.reason) return `время: ${item.reason}`;
      const absolute = [item.day, item.time].filter(Boolean).join(' ');
      // Для тега соседа — чей тег: при жалобе «время прыгнуло» это первое, что
      // надо знать. У прозы `via` — шаг разбора, человеку он ничего не скажет.
      const tag = item.source === 'A+' && item.via ? ` (${item.via})` : '';
      if (absolute) return `время: ${absolute}${tag}`;
      if (item.unit) {
        const n = Number.isFinite(item.n) ? `${item.n > 0 ? '+' : ''}${item.n} ` : '';
        return `время: ${n}${item.unit}`;
      }
      return 'время: сдвинулось';
    }
    // Реплика человека перед ответом (9.2, `core/cues.mjs`). Слова — механизма,
    // не заведения: «присутствие» и «прогул» есть в любом пресете.
    case 'time-skip': {
      const policy = { attend: 'присутствие', absent: 'прогул', ask: 'спросить (пока — присутствие)' }[item.policy] || item.policy;
      const asked = Number.isFinite(item.days) ? `заказано ${item.days} дн., ` : '';
      const exam = item.examDay ? `, не дальше ${item.examDay} (контрольное)` : '';
      return `промотка времени: ${asked}потолок ${item.cap} дн., пропущенное — ${policy}${exam}`;
    }
    case 'phone-turn': return 'ход в телефоне: сцена на паузе, прогулы не выводятся';
    case 'time-dropped': return `время из метки не проведено (${item.reason === 'phone-turn' ? 'ход в телефоне' : item.reason})`;
    // Три вида, которые движок кладёт давно, а отладка печатала сырым именем
    // («daypart», «time-held») — и вкладка, и `/academy-debug`, который
    // теперь печатает этот же вью. Слова механизма.
    case 'daypart': return `время суток: ${item.daypart}`;
    case 'time-held': return `прыжок придержан до решения: ${item.day}${item.jump ? ` (+${item.jump} дн.)` : ''}${item.via ? ` (${item.via})` : ''}`;
    case 'exams-dated': return `назначено по календарю: ${item.added} — ${item.day}`;
    default: return `${item.kind}${item.subjectId ? `: ${item.subjectId}` : ''}`;
  }
}

/** Ступени проверки словами отладки (ключи — `core/exams.mjs: TIERS`). */
const TIER_TEXT = { critSuccess: 'крит-успех', success: 'успех', fail: 'провал', critFail: 'крит-провал' };

/**
 * Проверка против сложности словами (9.4.1) — ответ на «почему так вышло»:
 * «DC 12 = 14 база − 1 балл − 1 отношение + 0 репутация; бросок 15 → успех».
 *
 * Знак у слагаемого — как оно действует на DC, а не как лежит в данных: в
 * `check.mods` плюс значит «помогло» (снято со сложности), а в строке
 * помогающее слагаемое стоит с минусом — иначе арифметика не сходилась бы на
 * глаз. Слова механизма, не заведения, — потому здесь, а не в пресете.
 */
export function describeCheck(check) {
  if (!check || typeof check !== 'object' || !Number.isFinite(check.dc)) return '';
  const mods = check.mods || {};
  const term = (n, word) => {
    const v = -(Number(mods[n]) || 0);
    return `${v < 0 ? '−' : '+'} ${Math.abs(v)} ${word}`;
  };
  const sum = `DC ${check.dc} = ${check.base} база ${term('score', 'балл')} ${term('relation', 'отношение')} ${term('reputation', 'репутация')}`;
  const tier = TIER_TEXT[check.tier] || String(check.tier || '');
  const saved = check.saved ? ', страховка балла: засчитано низшей проходной' : '';
  const capped = check.capped ? ', потолок балла: ниже проходного высшую не ставят' : '';
  return `${sum}; бросок ${check.roll} → ${tier}${saved}${capped}`;
}

/** Отброшенный кусок и причина. Формы — те же, что у `/academy-debug`. */
function describeRejected(r) {
  if (typeof r === 'string') return r;
  if (!r || typeof r !== 'object') return '';
  return `${r.raw || r.kind || 'кусок'}${r.reason ? ` — ${r.reason}` : ''}`;
}

/** Короткая запись `data` для строк журнала, у которых нет текста. */
function shortData(data) {
  if (!data || typeof data !== 'object') return '';
  try {
    const s = JSON.stringify(data);
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch {
    return '';
  }
}

/** «1 ответ / 2 ответа / 5 ответов». */
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

const str = (v) => (v == null ? '' : String(v)).trim();

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

/* ========================================================================== *
 *  ЧАСТЬ 1½. Проводка 9.4.1–9.4.2 и крючки 9.7: вехи, исход проверки на
 *  «Сегодня», портрет и место занятия, вид для соседей, доктор промпта.
 *  Тоже чистые функции — DOM ниже.
 * ========================================================================== */

/**
 * Слова этого блока — в коде, а не в `DEFAULT_UI`, и причина одна:
 * `ui.test.mjs` («словарь панели полон») требует, чтобы каждый ключ
 * `DEFAULT_UI` был переведён во всех трёх пресетах, а `presets/*.json` в этой
 * правке не мои (их ведёт параллельная работа). Ключи здесь тем не менее
 * **перекрываются** блоком `preset.ui` так же, как `DEFAULT_UI` (`extraLabels`):
 * пресет, который хочет «зал» вместо «аудитории», допишет ключ `roomField` — и
 * ни строчки кода. Какие ключи стоит дописать в пресеты — в `etap-provodka.md`.
 *
 * Слов конкретного заведения («пара», «хвост», «семестр», «сессия») здесь нет
 * ни одного — это проверяет тест тем же запретным словарём, что и
 * `DEBUG_TEXT`. «Аудитория» и «корпус» — исключение сознательное: так зовутся
 * места и в школе, и в вузе, а магической академии — перекрыть.
 */
export const EXTRA_UI = {
  // --- вехи (9.4.2) -----------------------------------------------------------
  // «Вехи», а не «ачивки»: рядом может стоять Collection Vault со своими
  // достижениями (план 9.4.2), и два слова про одно путали бы человека.
  milestonesTitle: 'Вехи',
  milestonesNone: 'Вех пока нет.',
  milestoneNoDate: '—',
  milestoneToastTitle: 'Веха',
  soundSection: 'Вехи',
  soundToggle: 'Короткий звук, когда появляется новая веха',
  soundNote: 'Звук синтезируется браузером, без файлов. Выключено по умолчанию: расширение не шумит, пока его об этом не попросили. Всплывашка с названием вехи приходит и без звука.',
  soundTry: 'Послушать',
  soundTried: 'Если звука не было — браузер ещё не разрешил странице звук: нажмите в чате что-нибудь и попробуйте снова.',

  // --- исход проверки на «Сегодня» (9.4.1) ------------------------------------
  // Строка короткая и одна на событие: полное «DC = база − балл − …» живёт в
  // отладке (`describeCheck`), здесь — только то, что видно глазом.
  checkLine: '{kind}, {subject}: {value}',
  checkRoll: 'бросок {roll} против DC {dc} — {tier}',
  checkAuto: 'без броска: балл не ниже порога',
  checkSaved: 'спасла страховка балла',
  checkCapped: 'высшую ниже проходного балла не ставят',
  checkOverride: 'в тексте ответа — {said}, принята версия ответа',
  checkPending: 'мир узнает {date}',
  checkTiers: { critSuccess: 'блестяще', success: 'успех', fail: 'провал', critFail: 'полный провал' },

  // --- место занятия и портрет (9.7A п.11, п.15) ------------------------------
  buildingField: 'Корпус',
  roomField: 'Аудитория',
  buildingHint: 'главный',
  roomHint: '214',
  portraitTitle: 'Портрет',
  portraitField: 'Путь или ссылка на картинку',
  portraitHint: 'characters/Имя/портрет.png или https://…',
  portraitSave: 'Сохранить портрет',
  portraitSaved: 'Портрет сохранён.',
  portraitCleared: 'Портрет убран.',
  portraitBad: 'Не годится: нужен путь от корня таверны (characters/…, /user/images/…) или ссылка http(s).',
  portraitOpen: 'Открыть портрет',
  portraitClose: 'Закрыть',
  portraitBroken: 'картинка не открылась — проверьте путь',
  // Карточка наставника целиком: портрет и день рождения правятся в одном
  // свёрнутом блоке на вкладке «Люди».
  detailsTitle: 'Портрет и день рождения',
  detailsSave: 'Сохранить',
  detailsSaved: 'Сохранено.',
  birthdayField: 'День рождения (ММ-ДД или Д.М)',
  birthdayHint: '03-08',
  birthdayBad: 'День рождения не читается: нужно ММ-ДД (03-08) или день.месяц (8.3).',
  birthdayLine: 'день рождения: {date}',

  // --- итог, который мир ещё не знает (9.4.3) --------------------------------
  awaitingTitle: 'Ждут объявления',
  awaitingLine: '{subject}: итог объявят {date}',

  // --- сводка прыжка (9.4.4): один тост вместо пачки --------------------------
  jumpToast: 'Прошло занятий: {periods}, из них пропущено: {missed}.',
};

/** Слова блока для этого пресета: `preset.ui` перекрывает любой ключ `EXTRA_UI`. */
export function extraLabels(preset) {
  const own = (preset && preset.ui) || {};
  const out = { ...EXTRA_UI };
  for (const k of Object.keys(EXTRA_UI)) {
    if (own[k] === undefined) continue;
    out[k] = k === 'checkTiers' ? { ...EXTRA_UI.checkTiers, ...own[k] } : own[k];
  }
  return out;
}

/** «главный · 214» — место занятия одной строкой; пусто, если места нет. */
export function whereText(subject) {
  if (!subject) return '';
  return [subject.building, subject.room].map(str).filter(Boolean).join(' · ');
}

/**
 * Исходы проверок, брошенных СЕГОДНЯ (9.4.1, «видимая проверка»), — для
 * «Сегодня». Источник — история бросков события (`item.rolls`), а не журнал и
 * не последний прогон: журнал кольцевой, прогон живёт в памяти вкладки, а
 * строка обязана пережить F5 и смену чата туда-обратно.
 *
 * Почему только сегодняшние: строка — новость дня. Вчерашний исход уже лежит
 * в зачётке оценкой, и держать его на главном экране значило бы копить там
 * историю.
 *
 * Итог, который мир ещё не знает (9.4.3, `announced: false`), показывается —
 * панель смотрит человек, а не персонаж, — но с пометкой «мир узнает …»:
 * иначе человек удивился бы, почему модель про оценку молчит.
 */
export function examResultsToday(state, preset) {
  const day = state && state.calendar && state.calendar.day;
  if (!day) return [];
  const X = extraLabels(preset);
  const kinds = (preset && preset.exams && preset.exams.kinds) || [];
  const out = [];
  for (const item of (state.exams && state.exams.items) || []) {
    const rolls = Array.isArray(item && item.rolls) ? item.rolls : [];
    const last = rolls[rolls.length - 1];
    if (!last || last.day !== day) continue;
    const subject = (state.subjects || []).find((s) => s.id === item.subjectId);
    const kind = kinds.find((k) => k.id === item.kind);
    // Что записано в итоге: версия модели, если она победила (8.1), иначе
    // посчитанное броском.
    const shown = item.modelOverride && item.outcome ? item.outcome : last.value;
    const info = gradeInfo(preset, shown);
    const auto = last.tier === 'auto';
    const tierText = (X.checkTiers && X.checkTiers[last.tier]) || String(last.tier || '');
    const notes = [];
    if (last.saved) notes.push(X.checkSaved);
    if (last.capped) notes.push(X.checkCapped);
    if (item.modelOverride && item.outcome) notes.push(fill(X.checkOverride, { said: (info && info.label) || item.outcome }));
    const pending = item.announced === false;
    if (pending && item.announceOn) notes.push(fill(X.checkPending, { date: formatDate(item.announceOn) }));
    out.push({
      id: item.id,
      // Ключ для анимации «свежего» броска: попытка + день. Перерисовка панели
      // бывает на каждое действие, и без ключа кубик «выпадал» бы заново.
      key: `${item.id}:${rolls.length}:${day}`,
      subjectId: item.subjectId,
      subject: (subject && subject.name) || item.subjectId || '',
      kind: (kind && kind.name) || String(item.kind || ''),
      value: String(shown),
      valueLabel: (info && info.label) || String(shown),
      passed: isPassing(preset, shown),
      auto,
      roll: auto ? null : last.roll,
      dc: auto ? null : last.dc,
      tier: last.tier,
      tierText,
      pending,
      head: fill(X.checkLine, {
        kind: (kind && kind.name) || String(item.kind || ''),
        subject: (subject && subject.name) || item.subjectId || '',
        value: (info && info.label) || String(shown),
      }),
      rollText: auto ? X.checkAuto : fill(X.checkRoll, { roll: last.roll, dc: last.dc, tier: tierText }),
      notes,
    });
  }
  return out;
}

/** «физика: итог объявят вторник, 24 декабря» — по событиям с `announced: false`. */
export function awaitingView(state, preset) {
  const X = extraLabels(preset);
  return ((state && state.exams && state.exams.items) || [])
    .filter((i) => awaitingAnnouncement(i))
    .map((i) => {
      const s = (state.subjects || []).find((x) => x.id === i.subjectId);
      const subject = (s && s.name) || i.subjectId || '';
      return {
        id: i.id, subject, day: i.announceOn,
        text: fill(X.awaitingLine, { subject, date: formatDate(i.announceOn) || i.announceOn }),
      };
    });
}

/** «8 марта» из `ММ-ДД` — без дня недели: у дня рождения года нет. */
export function birthdayText(mmdd) {
  const m = typeof mmdd === 'string' && /^(\d{2})-(\d{2})$/.exec(mmdd);
  if (!m) return '';
  return `${Number(m[2])} ${MONTHS[Number(m[1])] || ''}`.trim();
}

/**
 * Вехи для блока «Вехи» в зачётке (9.4.2). Пересчёт по состоянию, как и в
 * ядре: ничего не хранится, отозванная свайпом веха исчезает из списка сама.
 * Дата — `formatDate(when)` или «—», если состояние её уже не помнит.
 */
export function milestonesView(state, preset) {
  const X = extraLabels(preset);
  let list = [];
  try {
    list = milestones(state, preset);
  } catch {
    // Вехи — украшение зачётки. Уронить из-за них всю вкладку нельзя.
    list = [];
  }
  return list.map((m) => ({
    id: m.id,
    kind: m.kind,
    name: milestoneName(m, state, preset),
    when: m.when || null,
    whenLine: m.when ? formatDate(m.when) : X.milestoneNoDate,
  }));
}

// --- вид для соседей: `window.AcademyAPI` (9.4.8, 9.7B) -----------------------
//
// Три функции ниже — то, что `index.js` отдаёт наружу через `AcademyAPI`. Они
// здесь, а не в `index.js`, по тому же правилу, что остальные вью: чистые,
// проверяются `node --test` без таверны. Выход — простые объекты и строки,
// каждый раз новые: сосед, поправивший ответ у себя, не должен поправить
// состояние семестра.

/**
 * Где календарь: `{started, day, time, precision}`. Без семестра — `null`:
 * соседу честнее узнать «Academy не ведёт учёбу в этом чате», чем получить
 * день, которого нет.
 */
export function hookNow(state) {
  if (!state || !state.started || !state.calendar) return null;
  const c = state.calendar;
  return {
    started: true,
    day: c.day,
    time: c.precision === 'datetime' && c.time ? c.time : null,
    precision: c.precision,
    weekday: WEEKDAYS[dayOfWeek(c.day)] || '',
  };
}

/**
 * Учебный день для соседа: день, неделя, фаза, текущее и следующее занятие.
 * Собирается из `todayView` — того же вью, что рисует «Сегодня», — чтобы
 * сосед и панель не расходились ни в одном слове. Числа отношений сюда не
 * попадают: их нет и в `todayView`.
 */
export function hookToday(state, preset) {
  if (!state || !state.started) return null;
  const v = todayView(state, preset);
  if (v.kind !== 'ok') return null;
  const where = (id) => whereText((state.subjects || []).find((s) => s.id === id));
  const period = v.now ? {
    status: v.now.status,
    ordinal: v.now.ordinal,
    subjectId: v.now.subjectId,
    subject: v.now.name,
    teacher: v.now.teacher,
    start: v.now.start,
    end: v.now.end,
    where: where(v.now.subjectId),
    text: v.now.slotText,
  } : null;
  const next = v.next ? {
    subjectId: v.next.subjectId,
    subject: v.next.name,
    teacher: v.next.teacher,
    day: v.next.day,
    when: v.next.when,
    where: where(v.next.subjectId),
  } : null;
  return {
    day: v.day,
    dateLine: v.dateLine,
    weekday: WEEKDAYS[dayOfWeek(v.day)] || '',
    time: v.time,
    week: v.week,
    weekLine: v.weekLine,
    term: { index: v.termIndex, name: v.termLine || v.termName || '', count: v.termsCount },
    phase: v.phase,
    phaseLabel: v.phaseLabel,
    silent: v.silent,
    silentReason: v.silentReason,
    period,
    next,
  };
}

/**
 * Короткая строка «где героиня в учёбе» — для соседей и для библиотек сейвов
 * (9.7B): «второй триместр, среда, 3-й урок, красные баллы: 1».
 *
 * Все слова — пресета: номер занятия — `ui.slot`, счётчик долгов —
 * `ui.debtsLine` с `vocab.debtPlural`, фаза — `ui.phases`. Имя периода
 * называется, только когда периодов в году больше одного (как на «Сегодня»):
 * у вуза с одним семестром «1-й семестр» — шум, а номера курса в состоянии нет.
 * Вне занятий вместо номера — фаза («каникулы», «сессия»), а не пустота.
 */
export function hookSummary(state, preset) {
  if (!state || !state.started) return '';
  const v = todayView(state, preset);
  if (v.kind !== 'ok') return '';
  const U = uiLabels(preset);
  const vocab = (preset && preset.vocab) || {};
  const parts = [];
  if (v.termLine) parts.push(v.termLine);
  parts.push(WEEKDAYS[dayOfWeek(v.day)] || v.dateLine);
  if (v.now && v.now.status === 'now') parts.push(fill(U.slot, { ordinal: v.now.ordinal }));
  else if (v.phase && v.phase !== 'study') parts.push(v.phaseLabel);
  // Долги — по миру (9.4.3): хвост от необъявленного итога сосед узнать не
  // должен, как не знает его строка состояния (`prompt.mjs` берёт тот же вид).
  const tails = debts(publicView(state, preset)).length;
  if (tails) parts.push(fill(U.debtsLine, { debtPlural: vocab.debtPlural || 'хвосты', count: tails }));
  return parts.filter(Boolean).join(', ');
}

/** Потолок `journal(n)`: журнал кольцевой, но отдавать его целиком незачем. */
export const HOOK_JOURNAL_MAX = 50;

/**
 * Журнал наружу (9.7B): «что случилось» — прогул, оценка, сдвиг отношения,
 * исход сессии, — чтобы соцсеть мира и режиссёр по состоянию не противоречили
 * зачётке.
 *
 * Не копия внутреннего журнала, а перевод по белому списку, и вот почему:
 *
 * - **итог, который мир ещё не знает** (9.4.3, `data.private`), наружу не
 *   идёт — сосед-«Подслушано» разболтал бы оценку раньше ведомости;
 * - **числа отношения и репутации наружу не идут** (3.3): вместо `from/to`
 *   — ярлыки шкалы пресета, как на вкладке «Люди»;
 * - **служебное** (`debug`, отвергнутые куски метки, погашенные повторы) —
 *   это разбор механизма, а не события мира;
 * - `text` внутреннего журнала — технический («grade chem=4») и наружу не
 *   отдаётся: сосед получает поля, а слова подберёт сам.
 *
 * @returns {Array<{day: string, kind: string}>} от ранних к поздним, не больше `n`
 */
export function hookJournal(state, preset, n = 10) {
  if (!state || !Array.isArray(state.journal)) return [];
  const limit = Math.max(0, Math.min(HOOK_JOURNAL_MAX, Number.isFinite(Number(n)) ? Math.floor(Number(n)) : 10));
  if (!limit) return [];
  const subjectName = (id) => (((state.subjects || []).find((s) => s.id === id)) || {}).name || id || '';
  const teacherName = (id) => (((state.teachers || []).find((t) => t.id === id)) || {}).name || id || '';
  const relLabels = (preset && preset.relations && preset.relations.labels) || [];
  const repLabels = (preset && preset.reputation && preset.reputation.labels) || [];
  const items = (state.exams && state.exams.items) || [];
  // Итоги, которые мир ещё не знает (9.4.3). Их оценка лежит в зачётке уже в
  // день сдачи, и строка журнала `grade` про неё выдала бы то же, что прячет
  // `data.private` у записи сдачи. Узнаётся по предмету и дню сдачи — теми же
  // признаками, по которым `exams.publicView` вынимает её из зачётки.
  const hidden = items.filter(awaitingAnnouncement);
  const secret = (subjectId, day) => hidden.some((i) => i.subjectId === subjectId && (!i.day || i.day === day));
  // Повод сдвига (9.7B) словами; про необъявленный итог — без значения оценки.
  const why = (reason) => {
    if (!reason) return '';
    if (typeof reason === 'object' && reason.subjectId && secret(reason.subjectId, reason.day || '')
      && reason.value !== undefined) {
      return '';
    }
    return reasonText(reason, state, preset);
  };
  const out = [];
  for (const e of state.journal) {
    const d = e && e.data;
    if (!e || !d || typeof d !== 'object') continue;
    const day = String(e.day || '');
    let row = null;
    switch (e.kind) {
      case 'grade':
        if (d.reason && d.debt === undefined) break; // отвергнутая оценка
        if (!d.subjectId || secret(d.subjectId, day)) break;
        if (d.debt !== undefined) {
          row = { kind: 'debt', subjectId: d.subjectId, subject: subjectName(d.subjectId), debt: Boolean(d.debt) };
        } else if (d.value !== undefined) {
          const info = gradeInfo(preset, d.value);
          row = {
            kind: 'grade', subjectId: d.subjectId, subject: subjectName(d.subjectId),
            value: String(d.value), label: (info && info.label) || String(d.value), passed: isPassing(preset, d.value),
          };
        }
        break;
      case 'attendance':
        if (d.jump) {
          row = { kind: 'attendance-jump', periods: d.periods || 0, missed: d.missed || 0, present: d.present || 0 };
        } else if (d.subjectId && d.status && d.periodIndex !== undefined) {
          row = { kind: 'attendance', subjectId: d.subjectId, subject: subjectName(d.subjectId), status: String(d.status) };
        }
        break;
      case 'rel': {
        if (d.damped || !Number.isFinite(d.from) || !Number.isFinite(d.to)) break;
        const from = labelFor(relLabels, d.from);
        const to = labelFor(relLabels, d.to);
        row = {
          kind: 'relation', teacherId: d.teacherId, teacher: teacherName(d.teacherId),
          from: from || '', to: to || '', changed: Boolean(from && to && from !== to),
          direction: d.to > d.from ? 'up' : d.to < d.from ? 'down' : 'same',
          ...(why(d.reason) ? { reason: why(d.reason) } : {}),
        };
        break;
      }
      case 'reputation': {
        if (!Number.isFinite(d.from) || !Number.isFinite(d.to)) break;
        row = {
          kind: 'reputation',
          from: labelFor(repLabels, d.from) || '', to: labelFor(repLabels, d.to) || '',
          direction: d.to > d.from ? 'up' : d.to < d.from ? 'down' : 'same',
          // У репутации повод — строка механизма («exam», «skip»), а не объект.
          ...(typeof d.reason === 'string' && d.reason ? { reason: d.reason } : {}),
        };
        break;
      }
      case 'exam': {
        if (d.private) break; // мир ещё не знает (9.4.3)
        const item = items.find((i) => i.id === d.examId);
        const subjectId = d.subjectId || (item && item.subjectId) || '';
        if (d.missed) {
          row = { kind: 'exam-missed', examId: d.examId, subjectId, subject: subjectName(subjectId) };
        } else if (d.modelSaid !== undefined) {
          // Итог, ещё не объявленный миру, не выдаётся и через расхождение.
          if (item && item.announced === false) break;
          row = { kind: 'exam-conflict', examId: d.examId, subjectId, subject: subjectName(subjectId), said: String(d.modelSaid), applied: d.applied !== false };
        } else if (d.value !== undefined && d.examId) {
          const info = gradeInfo(preset, d.value);
          row = {
            kind: 'exam', examId: d.examId, subjectId, subject: subjectName(subjectId),
            value: String(d.value), label: (info && info.label) || String(d.value), passed: Boolean(d.passed),
            ...(d.announced ? { announced: true } : {}),
          };
        } else if (d.added) {
          row = { kind: 'exams-scheduled', count: d.added, ...(d.kind ? { examKind: String(d.kind) } : {}) };
        }
        break;
      }
      default:
        break; // `time`, `debug` и всё незнакомое — не события мира
    }
    if (row) out.push({ day, ...row });
  }
  return out.slice(-limit);
}

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

/** Где стоит инжект — словами: «в чате, глубина 1 · system». */
function slotText(p, T) {
  const pos = T.positions[String(p.position)] || `позиция ${p.position}`;
  const role = T.roles[String(p.role)] || String(p.role);
  return `${fill(pos, { depth: p.depth })} · ${role}`;
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

/* ========================================================================== *
 *  ЧАСТЬ 2. DOM. Всё ниже трогает документ и в тестах не участвует.
 * ========================================================================== */

const ID = {
  panel: 'academy_panel',
  button: 'academy_button',
  settings: 'academy_settings_block',
};

/** Порог, за которым жест считается перетаскиванием, а не тапом (3.9). */
const DRAG_THRESHOLD = 6;

/**
 * Живые узлы. Модуль монтируется один раз на страницу. `seenRolls` — какие
 * броски уже «выпадали» анимацией (см. `examResultLine`).
 */
const mounted = { panel: null, button: null, settings: null, host: null, tab: 'today', seenRolls: new Set() };

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = dv;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of [].concat(children || [])) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' || typeof c === 'number' ? String(c) : c);
  }
  return node;
}

const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

/**
 * Обёртка над асинхронным действием хоста. Три состояния, которые обязаны быть
 * видны: «идёт запрос», «ошибка, вот текст», «готово». Интерфейс при этом не
 * блокируется целиком — гаснет одна кнопка.
 */
async function runAction(button, status, fn, okText) {
  if (typeof fn !== 'function') {
    setStatus(status, 'error', 'Действие недоступно: index.js его не передал.');
    return { ok: false, error: 'no-action' };
  }
  const label = button ? button.textContent : '';
  if (button) { button.disabled = true; button.classList.add('academy-busy'); button.textContent = 'Идёт запрос…'; }
  setStatus(status, 'busy', 'Идёт запрос…');
  try {
    const res = await fn();
    if (res && res.ok === false) {
      setStatus(status, 'error', res.error ? String(res.error) : 'Не получилось. Ответа с объяснением не пришло.');
      return res;
    }
    setStatus(status, 'ok', okText || 'Готово.');
    return res === undefined ? { ok: true } : res;
  } catch (err) {
    setStatus(status, 'error', (err && err.message) ? err.message : String(err));
    return { ok: false, error: err };
  } finally {
    if (button) { button.disabled = false; button.classList.remove('academy-busy'); button.textContent = label; }
  }
}

function setStatus(node, kind, text) {
  if (!node) return;
  node.className = `academy-status academy-status-${kind}`;
  node.textContent = text || '';
}

// --- вкладка «Сегодня» ------------------------------------------------------

function renderToday(host, view, preset) {
  if (view.kind !== 'ok') return renderEmpty(host, view);

  const U = uiLabels(preset);
  const box = el('div', { class: 'academy-today' });

  box.append(el('div', { class: 'academy-head' }, [
    el('div', { class: 'academy-date', text: view.dateLine }),
    el('div', { class: 'academy-week' }, [
      view.weekLine,
      // Имя периода стоит рядом с фазой той же «таблеткой»: строка `academy-week`
      // и так переносится по словам, поэтому на телефоне она уедет вниз, а не
      // растянет панель (3.9). Своего класса в `style.css` не заводим — вид у
      // неё тот же, что у фазы.
      view.termLine ? el('span', { class: 'academy-phase academy-term', text: view.termLine }) : null,
      el('span', { class: 'academy-phase', text: view.phaseLabel }),
      view.time ? el('span', { class: 'academy-clock', text: view.time }) : null,
    ]),
  ]));

  // Исход сегодняшней проверки (9.4.1) — выше расписания: в день экзамена это
  // главная новость, а пар в этот день обычно и нет («сессия — лекций нет»).
  for (const r of view.exams || []) box.append(examResultLine(r));

  if (view.silent) {
    box.append(el('div', { class: 'academy-silent', text: view.silentReason }));
  } else if (view.now) {
    box.append(el('div', { class: 'academy-card academy-now' }, [
      el('div', { class: 'academy-card-title', text: view.now.title }),
      el('div', { class: 'academy-subject', text: view.now.name }),
      view.now.teacher ? el('div', { class: 'academy-teacher', text: view.now.teacher }) : null,
      view.now.where ? el('div', { class: 'academy-where', text: view.now.where }) : null,
      el('div', { class: 'academy-slot', text: view.now.slotText }),
    ]));
  }

  if (view.next) {
    box.append(el('div', { class: 'academy-card academy-next' }, [
      el('div', { class: 'academy-card-title', text: U.nextCardTitle }),
      el('div', { class: 'academy-subject', text: view.next.name }),
      view.next.teacher ? el('div', { class: 'academy-teacher', text: view.next.teacher }) : null,
      view.next.where ? el('div', { class: 'academy-where', text: view.next.where }) : null,
      el('div', { class: 'academy-slot', text: view.next.when }),
    ]));
  } else if (!view.silent) {
    box.append(el('div', { class: 'academy-silent', text: U.noNext }));
  }

  if (view.plan.length && !view.silent) {
    box.append(el('div', { class: 'academy-plan' }, [
      el('div', { class: 'academy-card-title', text: U.dayTitle }),
      el('ol', { class: 'academy-plan-list' }, view.plan.map((p) => el('li', {
        class: p.current ? 'academy-plan-item academy-plan-current' : 'academy-plan-item',
      }, [
        el('span', { class: 'academy-plan-time', text: p.start ? `${p.start}` : `${p.ordinal}` }),
        el('span', { class: 'academy-plan-name', text: p.name }),
        p.teacher ? el('span', { class: 'academy-plan-teacher', text: p.teacher }) : null,
        p.where ? el('span', { class: 'academy-plan-where', text: p.where }) : null,
      ]))),
    ]));
  }

  box.append(el('div', {
    class: view.stalled ? 'academy-timemark academy-timemark-stalled' : 'academy-timemark',
    text: view.timeMark,
  }));

  if (view.heldJump) box.append(heldJumpBlock(host, view, U));

  // Ремонтный инструмент, а не главная кнопка (3.2): спрятан в свёрнутый блок.
  box.append(manualTimeBlock(host, view, U));
  return box;
}

/**
 * Строка исхода проверки (9.4.1): «Экзамен, химия: 4» и под ней «бросок 15
 * против DC 7 — успех».
 *
 * Анимация — одна и минимальная: число броска «выпадает» (масштаб и
 * прозрачность за 0,4 с, `style.css: academy-roll-fresh`), и только в первый
 * показ этого броска. Перерисовка панели случается на каждое действие, и
 * кубик, который прыгает при каждом нажатии, раздражал бы; поэтому показанные
 * броски помнятся по ключу (`mounted.seenRolls`, память вкладки — после F5
 * число просто стоит). При `prefers-reduced-motion` анимации нет вовсе.
 * Счётчика-«рулетки» нет нарочно: исход уже посчитан, и изображать случай,
 * который ещё только решается, было бы враньём.
 */
function examResultLine(r) {
  const fresh = !mounted.seenRolls.has(r.key);
  mounted.seenRolls.add(r.key);
  const kind = r.auto ? 'auto' : r.passed ? 'pass' : 'fail';
  return el('div', { class: `academy-card academy-verdict academy-verdict-${kind}` }, [
    el('div', { class: 'academy-verdict-head' }, [
      r.auto ? null : el('span', {
        class: fresh ? 'academy-roll academy-roll-fresh' : 'academy-roll',
        text: String(r.roll),
        title: `d20 = ${r.roll}, DC ${r.dc}`,
      }),
      el('span', { class: 'academy-subject', text: r.head }),
    ]),
    el('div', { class: 'academy-slot', text: r.rollText }),
    ...(r.notes || []).map((n) => el('div', { class: 'academy-note', text: n })),
  ]);
}

/**
 * Придержанный прыжок времени вперёд: единственное место, где панель что-то
 * спрашивает у человека сама.
 *
 * Стоит на «Сегодня» и не спрятан в свёрнутый блок — в отличие от ручного
 * ремонта: ремонт человек ищет сам, а этот вопрос задаём мы, и не заданный
 * вовремя он превращается в застывший календарь без объяснения.
 */
function heldJumpBlock(host, view, U) {
  const j = view.heldJump;
  const status = el('div', { class: 'academy-status' });
  const days = j.days;

  const answer = (accept, btn) => runAction(
    btn, status,
    () => call(host, 'resolveJump', accept),
    accept ? U.jumpAccepted : U.jumpDismissed,
  ).then((res) => {
    // Число пропущенных занятий известно только после ответа ядра, и сказать
    // его надо до перерисовки — она этот узел унесёт.
    if (accept && res && res.ok && res.missed) {
      setStatus(status, 'ok', fill(U.jumpAcceptedMissed, { count: res.missed }));
    }
    renderPanel(host);
  });

  return el('div', { class: 'academy-card academy-jump' }, [
    el('div', { class: 'academy-card-title', text: U.jumpTitle }),
    el('p', {
      text: fill(U.jumpLine, {
        date: j.time ? `${j.dateLine}, ${j.time}` : j.dateLine,
        days,
        plural: plural(days, 'день', 'дня', 'дней'),
        from: j.fromLine,
      }),
    }),
    j.matched ? el('p', { class: 'academy-silent', text: fill(U.jumpMatched, { matched: j.matched }) }) : null,
    el('p', { class: 'academy-note', text: U.jumpNote }),
    el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn',
        text: U.jumpAccept,
        onclick: (e) => answer(true, e.currentTarget),
      }),
      el('div', {
        class: 'menu_button academy-btn',
        text: U.jumpDismiss,
        onclick: (e) => answer(false, e.currentTarget),
      }),
    ]),
    status,
  ]);
}

function manualTimeBlock(host, view, U) {
  const status = el('div', { class: 'academy-status' });
  const day = el('input', { type: 'date', class: 'text_pole academy-input', value: view.day || '' });
  const time = el('input', { type: 'time', class: 'text_pole academy-input', value: view.time || '' });
  // Выключена по умолчанию — то же решение, что у ключа `count=yes` в команде.
  const count = el('input', { type: 'checkbox' });

  const send = (patch, btn) => runAction(
    btn, status,
    () => call(host, 'manualTime', { ...patch, count: Boolean(count.checked) }),
    'Календарь поправлен.',
  ).then((res) => {
    // Что стало с ведомостью, надо сказать до перерисовки: она унесёт узел.
    if (res && res.ok && res.missed) setStatus(status, 'ok', fill(U.repairCounted, { count: res.missed }));
    else if (res && res.ok && res.wouldMiss) setStatus(status, 'ok', fill(U.repairNotCounted, { count: res.wouldMiss }));
    renderPanel(host);
  });

  const details = el('details', { class: 'academy-repair' }, [
    el('summary', { text: 'Поправить время вручную' }),
    el('div', { class: 'academy-repair-body' }, [
      el('p', {
        class: 'academy-note',
        text: 'Ремонтный инструмент. Основной канал — источник времени из настроек; '
          + 'если сдвигать приходится часто, дело в источнике, а не здесь.',
      }),
      el('div', { class: 'academy-row' }, [
        el('label', { class: 'academy-field' }, [el('span', { text: 'День' }), day]),
        el('label', { class: 'academy-field' }, [el('span', { text: 'Время' }), time]),
      ]),
      el('label', { class: 'academy-check' }, [count, el('span', { text: U.repairCount })]),
      el('p', { class: 'academy-note', text: U.repairCountNote }),
      el('div', { class: 'academy-row academy-row-buttons' }, [
        el('div', {
          class: 'menu_button academy-btn',
          text: 'Применить',
          onclick: (e) => send({ day: day.value || null, time: time.value || null }, e.currentTarget),
        }),
        el('div', {
          class: 'menu_button academy-btn',
          text: U.shiftPeriod,
          onclick: (e) => send({ shift: { periods: 1 } }, e.currentTarget),
        }),
        el('div', {
          class: 'menu_button academy-btn',
          text: '+1 день',
          onclick: (e) => send({ shift: { days: 1 } }, e.currentTarget),
        }),
      ]),
      status,
    ]),
  ]);
  return details;
}

// --- вкладка «Зачётка» ------------------------------------------------------

function renderGradebook(host, view, preset) {
  if (view.kind !== 'ok') return renderEmpty(host, view);

  const U = uiLabels(preset);
  const box = el('div', { class: 'academy-gradebook' });

  box.append(el('div', { class: 'academy-head' }, [
    el('div', { class: 'academy-date', text: `${view.scoreName}: ${view.overallText}` }),
    el('div', { class: 'academy-week' }, [
      el('span', { class: 'academy-phase', text: view.reputation }),
      view.expelled ? el('span', { class: 'academy-alarm', text: U.expelledTag })
        : view.warned ? el('span', { class: 'academy-alarm', text: U.warnedTag }) : null,
    ]),
  ]));

  if (view.debts.length) {
    box.append(el('div', { class: 'academy-debts' }, [
      el('span', { class: 'academy-card-title', text: U.debtsTitle }),
      el('span', { text: view.debts.join(', ') }),
    ]));
  }

  if (view.openExams.length) {
    box.append(el('div', { class: 'academy-debts' }, [
      el('span', { class: 'academy-card-title', text: U.openExamsTitle }),
      view.examsTermLine ? el('span', { class: 'academy-phase academy-term', text: view.examsTermLine }) : null,
      el('span', { text: view.openExams.map((e) => `${e.subject} (${e.kind})`).join(', ') }),
    ]));
  }

  if (!view.subjects.length) {
    box.append(el('div', { class: 'academy-silent', text: U.noSubjects }));
    return box;
  }

  // Одно и то же дерево: на широком экране `style.css` кладёт его строками
  // таблицы, на узком — карточками. Второй вёрстки нет (3.9).
  box.append(el('div', { class: 'academy-table academy-table-grades' },
    view.subjects.map((s) => el('div', { class: s.debt ? 'academy-tr academy-tr-debt' : 'academy-tr' }, [
      el('div', { class: 'academy-td academy-td-name' }, [
        el('span', { class: 'academy-subject', text: s.name }),
        s.debt ? el('span', { class: 'academy-tag academy-tag-debt', text: U.debtTag }) : null,
        s.passed ? el('span', { class: 'academy-tag', text: U.passedTag }) : null,
      ]),
      el('div', { class: 'academy-td academy-td-teacher' }, [
        el('span', { text: s.teacher || '—' }),
        // Отношение — словом из пресета. Числа наружу не идут (3.3).
        s.relation ? el('span', { class: 'academy-relation', text: s.relation }) : null,
      ]),
      el('div', { class: 'academy-td academy-td-grades' }, [
        el('span', { class: 'academy-grades', text: s.grades.length ? s.grades.join(' ') : '—' }),
        el('span', { class: 'academy-avg', text: s.averageText }),
      ]),
    ]))));

  const X = extraLabels(preset);
  if ((view.awaiting || []).length) {
    box.append(el('div', { class: 'academy-debts academy-awaiting' }, [
      el('span', { class: 'academy-card-title', text: X.awaitingTitle }),
      el('span', { text: view.awaiting.map((a) => a.text).join('; ') }),
    ]));
  }
  box.append(milestonesBlock(view.milestones || [], X));
  return box;
}

/**
 * Блок «Вехи» (9.4.2) в зачётке: название словами пресета и дата. Стоит под
 * таблицей предметов, а не отдельной вкладкой: вех за семестр — единицы, и
 * шестая вкладка на телефоне стоила бы дороже, чем они весят (3.9).
 */
function milestonesBlock(list, X) {
  return el('div', { class: 'academy-milestones' }, [
    el('div', { class: 'academy-card-title', text: X.milestonesTitle }),
    list.length
      ? el('ul', { class: 'academy-milestone-list' }, list.map((m) => el('li', {
        class: 'academy-milestone', dataset: { milestone: m.id },
      }, [
        el('span', { class: 'academy-milestone-name', text: m.name }),
        el('span', { class: 'academy-shift-day', text: m.whenLine }),
      ])))
      : el('div', { class: 'academy-teacher', text: X.milestonesNone }),
  ]);
}

// --- вкладка «Люди» ---------------------------------------------------------

function renderPeople(host, view, preset) {
  if (view.kind !== 'ok') return renderEmpty(host, view);

  const U = uiLabels(preset);
  const X = extraLabels(preset);
  const box = el('div', { class: 'academy-people' });

  // Шапка та же по форме, что у «Зачётки»: репутация словом плюс тревожная
  // метка. Одинаковая шапка на двух вкладках — не экономия, а узнаваемость.
  box.append(el('div', { class: 'academy-head' }, [
    el('div', { class: 'academy-date', text: U.reputationTitle }),
    el('div', { class: 'academy-week' }, [
      el('span', { class: 'academy-phase', text: view.reputation }),
      view.expelled ? el('span', { class: 'academy-alarm', text: U.expelledTag })
        : view.warned ? el('span', { class: 'academy-alarm', text: U.warnedTag }) : null,
    ]),
  ]));

  if (!view.teachers.length) {
    box.append(el('div', { class: 'academy-silent', text: U.peopleNone }));
  }

  // Одно и то же дерево: на широком экране — строка таблицы, на узком —
  // карточка. Классы взяты те же, что у зачётки, второй вёрстки нет (3.9).
  if (view.teachers.length) {
    box.append(el('div', { class: 'academy-table academy-table-people' },
      view.teachers.map((t) => el('div', { class: 'academy-tr academy-tr-person' }, [
        el('div', { class: 'academy-td academy-td-name' }, [
          t.portrait ? portraitThumb(t, X) : null,
          el('span', { class: 'academy-subject', text: t.name }),
          // Ярлык, не число: `peopleView` числа отношения не знает вовсе.
          el('span', { class: 'academy-relation', text: t.relation }),
          portraitEditor(host, t, X),
        ]),
        el('div', { class: 'academy-td academy-td-person' }, [
          el('span', { class: 'academy-teacher', text: t.subjectsText }),
          el('span', {
            class: t.hasTraits ? 'academy-traits' : 'academy-traits academy-traits-none',
            text: t.traitsText,
          }),
          t.birthdayText ? el('span', { class: 'academy-teacher academy-birthday', text: t.birthdayText }) : null,
        ]),
        el('div', { class: 'academy-td academy-td-history' }, [
          el('span', { class: 'academy-card-title', text: U.relationHistoryTitle }),
          t.history.length
            ? el('ul', { class: 'academy-shifts' }, t.history.map((h) => el('li', {}, [
              el('span', { class: 'academy-shift', text: h.text }),
              h.dateLine ? el('span', { class: 'academy-shift-day', text: h.dateLine }) : null,
            ])))
            : el('span', { class: 'academy-teacher', text: t.historyText }),
        ]),
      ]))));
  }

  if (view.orphans.length) {
    box.append(el('div', { class: 'academy-debts' }, [
      el('span', { class: 'academy-card-title', text: U.orphanSubjectsTitle }),
      el('span', { text: view.orphans.join(', ') }),
    ]));
  }

  return box;
}

/**
 * Маленький портрет в карточке наставника (9.7A п.15). Нажатие открывает его
 * плавающим окном поверх панели (`openPortrait`), а не новой вкладкой браузера:
 * на телефоне вкладка — это уход из таверны.
 *
 * Не открылась картинка (опечатка в пути, ссылка умерла) — рамка не остаётся
 * пустой загадкой: миниатюра прячется, рядом встаёт строка «проверьте путь».
 * `loading="lazy"` — у восьми наставников восемь картинок, и тянуть их, пока
 * вкладку «Люди» не открыли, незачем.
 */
function portraitThumb(t, X) {
  const img = el('img', {
    class: 'academy-portrait-thumb',
    src: t.portrait,
    alt: `${X.portraitTitle}: ${t.name}`,
    loading: 'lazy',
    title: X.portraitOpen,
    onclick: () => openPortrait(t, X),
  });
  const broken = el('span', { class: 'academy-note academy-portrait-broken', text: X.portraitBroken });
  broken.hidden = true;
  img.addEventListener('error', () => { img.hidden = true; broken.hidden = false; });
  return el('span', { class: 'academy-portrait' }, [img, broken]);
}

/**
 * Плавающее окно с портретом. Одно на страницу: второе нажатие заменяет
 * картинку, а не плодит окна. Закрывается кнопкой, тапом по фону и Esc.
 */
function openPortrait(t, X) {
  if (mounted.portrait) mounted.portrait.remove();
  const close = () => {
    if (mounted.portrait) mounted.portrait.remove();
    mounted.portrait = null;
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e && e.key === 'Escape') close(); };
  const box = el('div', {
    class: 'academy-portrait-overlay',
    role: 'dialog',
    'aria-label': `${X.portraitTitle}: ${t.name}`,
    onclick: (e) => { if (e && e.target === e.currentTarget) close(); },
  }, [
    el('figure', { class: 'academy-portrait-frame' }, [
      el('img', { class: 'academy-portrait-full', src: t.portrait, alt: t.name }),
      el('figcaption', { text: t.name }),
      el('div', { class: 'menu_button academy-btn academy-btn-small', text: X.portraitClose, onclick: close }),
    ]),
  ]);
  document.addEventListener('keydown', onKey);
  (document.getElementById('movingDivs') || document.body).append(box);
  mounted.portrait = box;
  return box;
}

/**
 * Портрет и день рождения прямо в карточке наставника — свёрнутым блоком:
 * вкладка «Люди» — про людей, и эти поля правятся там же, где видны.
 * Сохранение — отдельным действием `setTeacherDetails`, а не через таблицу
 * плана: ни портрет, ни день рождения не меняют расписания и не должны его
 * пересобирать. Пустое поле убирает значение.
 *
 * Проверка формы — те же правила, что держат состояние (`isPortrait`,
 * `normalizeBirthday` в `index.js`): отказ портрета приходит ещё до похода в
 * хост, день рождения разбирает хост (он принимает и `8.3`, и `03-08`).
 */
function portraitEditor(host, t, X) {
  const status = el('div', { class: 'academy-status' });
  const input = el('input', {
    type: 'text', class: 'text_pole academy-input', value: t.portrait || '', placeholder: X.portraitHint,
  });
  input.value = t.portrait || '';
  const birthday = el('input', {
    type: 'text', class: 'text_pole academy-input', value: t.birthday || '', placeholder: X.birthdayHint,
  });
  birthday.value = t.birthday || '';
  const save = el('div', {
    class: 'menu_button academy-btn academy-btn-small',
    text: X.detailsSave,
    onclick: async (e) => {
      const value = String(input.value || '').trim();
      if (value && !isPortrait(value)) { setStatus(status, 'error', X.portraitBad); return; }
      const res = await runAction(e.currentTarget, status,
        () => call(host, 'setTeacherDetails', t.id, { portrait: value, birthday: String(birthday.value || '').trim() }),
        X.detailsSaved);
      if (res && res.ok !== false) renderPanel(host);
    },
  });
  return el('details', { class: 'academy-repair academy-portrait-edit' }, [
    el('summary', { text: X.detailsTitle }),
    el('div', { class: 'academy-repair-body' }, [
      el('label', { class: 'academy-field' }, [el('span', { text: X.portraitField }), input]),
      el('label', { class: 'academy-field' }, [el('span', { text: X.birthdayField }), birthday]),
      el('div', { class: 'academy-row academy-row-buttons' }, [save]),
      status,
    ]),
  ]);
}

// --- вкладка «Отладка» ------------------------------------------------------

/**
 * Разбор последнего ответа. Вкладка существует, только когда галочка включена
 * (`tabsFor`), поэтому проверка `enabled` здесь — не «а вдруг», а страховка от
 * прямого вызова: пустой блок лучше, чем разбор в выключенном режиме.
 */
function renderDebug(host, view) {
  const T = DEBUG_TEXT;
  const box = el('div', { class: 'academy-debug' });
  if (!view.enabled) return box;
  // `debugList` возвращает null для пустого блока без запасной фразы, а
  // `Node.append(null)` вставил бы в панель слово «null».
  const add = (node) => { if (node) box.append(node); };

  box.append(el('p', { class: 'academy-note', text: T.hint }));

  if (view.hasRun) {
    box.append(el('div', { class: 'academy-card' }, [
      el('div', { class: 'academy-debug-line', text: view.head }),
      el('div', { class: 'academy-debug-line', text: view.source }),
      view.stalled ? el('div', { class: 'academy-debug-line academy-timemark-stalled', text: view.stalled }) : null,
      el('div', { class: 'academy-debug-line', text: view.marker }),
    ]));
    add(debugList(T.appliedTitle, view.applied, T.noApplied));
    add(debugList(T.rejectedTitle, view.rejected, ''));
    add(debugList(T.notesTitle, view.notes, ''));
    if (view.permission) add(debugList(T.permissionTitle, [view.permission], ''));
    add(debugList(T.injectsTitle, view.injects, T.noInjects));
  } else {
    box.append(el('div', { class: 'academy-silent', text: view.noRun }));
  }

  // Расхождение исхода экзамена — отдельным блоком и выше журнала: план требует
  // именно его (`:342`), а в общем хвосте журнала оно тонет между сдвигами дня.
  add(debugList(T.divergenceTitle, view.divergences.map((d) => d.text), T.noDivergence));

  // Доктор промпта (9.7A п.4). Хост собирает сырьё (инжекты таверны, текст
  // последнего ответа), вью разбирает. Хост постарше геттера не знает — блока
  // просто нет.
  const doctor = safe(() => (host.getPromptDoctor ? host.getPromptDoctor() : null), null);
  if (doctor) add(doctorBlock(doctor));

  box.append(el('details', { class: 'academy-repair' }, [
    el('summary', { text: T.journalTitle }),
    el('div', { class: 'academy-repair-body' }, [
      view.journal.length
        ? el('ul', { class: 'academy-journal' }, view.journal.map((e) => el('li', {}, [
          el('span', { class: 'academy-shift-day', text: `${e.day} · ${e.kind}` }),
          el('span', { text: e.text }),
        ])))
        : el('div', { class: 'academy-silent', text: T.noJournal }),
    ]),
  ]));

  return box;
}

/**
 * Блок «Доктор промпта». Сначала вывод (есть ли метка, почему может не быть),
 * потом таблица инжектов — свёрнутой: на телефоне в ней десятки строк, а
 * причина нужна сразу. Таблица — тем же деревом `academy-table`, что зачётка:
 * на узком экране строки становятся карточками без второй вёрстки (3.9).
 */
function doctorBlock(d) {
  const T = DOCTOR_TEXT;
  if (!d.available) {
    return el('div', { class: 'academy-debug-block academy-doctor' }, [
      el('div', { class: 'academy-card-title', text: T.title }),
      el('div', { class: 'academy-teacher', text: d.status }),
    ]);
  }
  const reasons = d.reasons.length ? d.reasons : (d.noReasons ? [d.noReasons] : []);
  return el('div', { class: 'academy-debug-block academy-doctor' }, [
    el('div', { class: 'academy-card-title', text: T.title }),
    el('p', { class: 'academy-note', text: d.note }),
    d.status ? el('div', { class: 'academy-debug-line', text: d.status }) : null,
    reasons.length ? el('div', { class: 'academy-card-title', text: T.reasonsTitle }) : null,
    reasons.length ? el('ul', { class: 'academy-notes' }, reasons.map((r) => el('li', { text: r }))) : null,
    ...(d.notes || []).map((n) => el('p', { class: 'academy-note', text: n })),
    el('details', { class: 'academy-repair' }, [
      el('summary', { text: `${T.title}: ${d.rows.length}` }),
      el('div', { class: 'academy-repair-body' }, [
        d.rows.length
          ? el('div', { class: 'academy-table academy-table-doctor' }, d.rows.map((r) => el('div', {
            class: r.ours ? 'academy-tr academy-doctor-ours' : (r.wantsStart ? 'academy-tr academy-doctor-start' : 'academy-tr'),
          }, [
            el('div', { class: 'academy-td academy-td-name' }, [
              el('span', { class: 'academy-subject', text: r.owner }),
              r.owner !== r.key ? el('code', { class: 'academy-doctor-key', text: r.key }) : null,
            ]),
            el('div', { class: 'academy-td' }, [
              el('span', { class: 'academy-teacher', text: `${r.where} · ${r.sizeText}` }),
              ...r.flags.map((f) => el('span', { class: 'academy-tag', text: f })),
            ]),
            r.startHint || r.endHint
              ? el('div', { class: 'academy-td academy-doctor-hint', text: r.startHint || r.endHint })
              : null,
          ])))
          : el('div', { class: 'academy-silent', text: d.emptyText }),
      ]),
    ]),
  ]);
}

/** Заголовок и список строк; при пустом списке — запасная фраза или ничего. */
function debugList(title, items, emptyText) {
  if (!items.length && !emptyText) return null;
  return el('div', { class: 'academy-debug-block' }, [
    el('div', { class: 'academy-card-title', text: title }),
    items.length
      ? el('ul', { class: 'academy-notes' }, items.map((s) => el('li', { text: String(s) })))
      : el('div', { class: 'academy-teacher', text: emptyText }),
  ]);
}

// --- вкладка «Настройки» ----------------------------------------------------

function renderSettings(host) {
  sectionScope = 'panel';
  const state = safe(() => host.getState(), null);
  const preset = safe(() => host.getPreset(), {}) || {};
  const settings = safe(() => host.getSettings(), {}) || {};
  const view = settingsView(state, settings, preset, hostExtra(host));
  const U = view.labels;
  // Пока семестр не начат, раскрыты блоки пути «завести семестр с нуля»
  // (см. комментарий у `section`); после старта — ни одного.
  const setup = !view.started;

  const box = el('div', { class: 'academy-settings' });

  // --- анкета -------------------------------------------------------------
  const inputs = {};
  const surveyBox = el('div', { class: 'academy-survey' }, view.survey.map((f) => {
    const input = el('input', { type: 'text', class: 'text_pole academy-input', value: f.value, placeholder: f.hint });
    input.addEventListener('change', () => saveDraft(host, collect(inputs)));
    inputs[f.key] = input;
    return el('label', { class: 'academy-field' }, [el('span', { text: f.label }), input]);
  }));

  // Автозаполнение анкеты (3.6): кнопка НЕОБЯЗАТЕЛЬНАЯ и ничего не сохраняет.
  // Результат кладётся прямо в поля выше — человек смотрит и правит, — и уходит
  // в черновик анкеты тем же путём, что и всё, набранное руками.
  const guessStatus = el('div', { class: 'academy-status' });
  const guessBtn = el('div', {
    class: 'menu_button academy-btn academy-btn-small',
    text: U.surveyGuess,
    onclick: async (e) => {
      const res = await runAction(e.currentTarget, guessStatus,
        () => call(host, 'guessSurvey'), U.surveyGuessOk);
      if (!res || res.ok === false || !res.survey) return;
      for (const [key, node] of Object.entries(inputs)) {
        const value = str(res.survey[key]);
        // Пустое предположение не стирает набранное руками: человек мог
        // заполнить поле сам, а модель про него промолчать.
        if (value) node.value = value;
      }
      await saveDraft(host, collect(inputs));
      const filled = (res.filled || []).length;
      setStatus(guessStatus, filled ? 'ok' : 'error',
        filled ? fill(U.surveyGuessPartly, { count: filled }) : U.surveyGuessEmpty);
    },
  });

  const planStatus = el('div', { class: 'academy-status' });
  const genBtn = el('div', {
    class: 'menu_button academy-btn academy-btn-main',
    text: U.planGenerate,
    onclick: async (e) => {
      const survey = collect(inputs);
      await saveDraft(host, survey);
      const res = await runAction(e.currentTarget, planStatus,
        () => call(host, 'generatePlan', survey), U.planGenerateOk);
      // При сбое таблица не прячется: она та же самая, только пустая, и текст
      // ошибки стоит рядом с ней (3.6).
      renderPanel(host);
      if (res && res.ok === false) setStatus(lastPlanStatus(), 'error', String(res.error || 'Генерация не удалась.'));
      // План лёг, но в нём есть имя из стоп-листа (героиня, карточка,
      // заведение, 9.3.6): выбросить его нельзя — на него ссылаются предметы, —
      // поэтому человеку говорится, кого переименовать в таблице.
      else if (res && res.ok && Array.isArray(res.warnings) && res.warnings.length) {
        setStatus(lastPlanStatus(), 'error', res.warnings.join(' '));
      }
    },
  });

  box.append(section(U.surveySection, [
    el('p', { class: 'academy-note', text: U.surveyNote }),
    surveyBox,
    el('div', { class: 'academy-row academy-row-buttons' }, [guessBtn]),
    el('p', { class: 'academy-note', text: U.surveyGuessNote }),
    guessStatus,
    el('div', { class: 'academy-row academy-row-buttons' }, [genBtn]),
    planStatus,
  ], setup));
  mounted.planStatus = planStatus;

  // --- таблица предметов и преподавателей ---------------------------------
  box.append(renderPlanTable(host, view, preset, setup));

  // --- пресет заведения ---------------------------------------------------
  box.append(renderPresetBlock(host, view));

  // --- API ----------------------------------------------------------------
  box.append(renderApiBlock(host, view));

  // --- источник времени и галочки -----------------------------------------
  box.append(renderModeBlock(host, view));

  // --- лорбук академии (3.7) ----------------------------------------------
  box.append(renderLorebookBlock(host, view));

  // --- выгрузка и загрузка состояния (3.8) --------------------------------
  box.append(renderTransferBlock(host, view));

  // --- вехи и звук (9.4.2) ------------------------------------------------
  box.append(renderSoundBlock(host, preset, settings));

  // --- отладка ------------------------------------------------------------
  box.append(renderDebugBlock(host, view));

  // --- начать семестр -----------------------------------------------------
  const startStatus = el('div', { class: 'academy-status' });
  // Год календаря — решение, а не умолчание: до этой правки его молча ставили
  // системные часы, и в чате, где время печатает кто-то другой, расширение
  // заводило семестр в чужом году (`voprosy-vladelitse.md`, пункт 6).
  const hint = safe(() => (host.getStartHint ? host.getStartHint() : null), null) || {};
  const startDay = el('input', {
    type: 'date',
    class: 'text_pole academy-input',
    value: hint.day || '',
  });
  // Атрибут задаёт начальное значение, свойство — то, что прочитает кнопка.
  // У `<input type="date">` они расходятся ровно в том случае, который здесь и
  // важен: поле не трогали руками, а дату из него всё равно надо отдать.
  startDay.value = hint.day || '';
  const startBtn = el('div', {
    class: 'menu_button academy-btn academy-btn-main',
    text: view.started ? U.startedButton : U.startButton,
    onclick: async (e) => {
      if (!view.canStart) return;
      await runAction(
        e.currentTarget, startStatus,
        () => call(host, 'startTerm', collect(inputs), { startDay: startDay.value }),
        U.startedOk,
      );
      mounted.tab = 'today';
      renderPanel(host);
    },
  });
  if (!view.canStart) startBtn.classList.add('academy-btn-off');

  box.append(section(U.startSection, [
    view.startBlockers.length
      ? el('p', { class: 'academy-note', text: `Пока нельзя: ${view.startBlockers.join('; ')}.` })
      : el('p', { class: 'academy-note', text: U.startNote }),
    view.started ? null : el('div', { class: 'academy-row' }, [
      el('label', { class: 'academy-field' }, [
        el('span', { text: U.startDayField }),
        startDay,
      ]),
    ]),
    view.started ? null : el('p', {
      class: 'academy-note',
      text: hint.from === 'chat'
        ? fill(U.startDayFromChat, { matched: String(hint.matched || '').trim() })
        : U.startDayFromPreset,
    }),
    el('div', { class: 'academy-row academy-row-buttons' }, [startBtn]),
    startStatus,
  ], setup));

  return box;
}

/**
 * То, чего нет ни в состоянии, ни в настройках: отчёт лорбука и список
 * пресетов. Оба вызова переживают отсутствие геттера — `index.js` и `ui.js`
 * писались порознь, и панель, падающая от недостающего геттера, — это ровно тот
 * шов, ради которого весь файл держится на `safe` и `call`.
 */
function hostExtra(host) {
  return {
    lorebook: safe(() => (host.getLorebook ? host.getLorebook() : null), null),
    presets: safe(() => (host.getPresets ? host.getPresets() : null), null),
    // `encode_tags` таверны: при нём служебная метка перестаёт быть невидимой.
    // Хост это умеет посчитать (`index.js`, `markerVisibleRisk`), панель — нет.
    markerRisk: safe(() => (host.markerVisibleRisk ? host.markerVisibleRisk() : false), false),
    // Профили подключения таверны. Хост постарше их не отдаёт — тогда графа
    // «актуальный API» остаётся, но без списка профилей.
    connections: safe(() => (host.getConnections ? host.getConnections() : null), null),
  };
}

const lastPlanStatus = () => mounted.planStatus;

function renderPlanTable(host, view, preset, open = false) {
  const U = view.labels;
  const X = extraLabels(preset);
  const status = el('div', { class: 'academy-status' });
  // Рабочая копия: правки живут здесь до нажатия «сохранить», чтобы
  // недописанная строка не роняла состояние.
  const draft = {
    subjects: view.subjects.map((s) => ({ ...s })),
    teachers: view.teachers.map((t) => ({ ...t })),
  };

  const body = el('div', { class: 'academy-plan-table' });

  // Выпадашки живут дольше одной перерисовки строки: список наставников в них
  // обновляется на месте, как только человек дописал имя выше. Раньше опции
  // собирались один раз на `redraw()`, а `redraw()` случался только на
  // «добавить» и «удалить» — поэтому наставник, вписанный в верхний блок,
  // появлялся в нижнем лишь после «Сохранить таблицу», и порядок действий не
  // совпадал с порядком чтения формы.
  const selects = [];

  // Тот же id, что посчитает `validateSubjectRows` при сохранении, включая
  // обрезку по длине: разойдись они — и выпадашка предложила бы наставника,
  // которого проверка потом «не нашла».
  const maxId = ((preset && preset.limits) || {}).maxIdLength || 24;
  const teacherIdOf = (t) => (str(t.id) || slugify(t.name, { maxLength: maxId })).slice(0, maxId);

  const teacherOptions = (s) => [
    el('option', { value: '', text: U.teacherNone, selected: !s.teacherId }),
    ...draft.teachers
      .filter((t) => str(t.name))
      .map((t) => {
        const id = teacherIdOf(t);
        return el('option', { value: id, text: t.name, selected: s.teacherId === id });
      }),
  ];

  const teacherSelect = (s) => {
    const sel = el('select', {
      class: 'text_pole academy-input',
      onchange: (e) => { s.teacherId = e.currentTarget.value; },
    }, teacherOptions(s));
    selects.push({ sel, subject: s });
    return sel;
  };

  // Каким id строка наставников звалась на прошлой сборке списков. У строки без
  // явного `id` он считается от имени, то есть меняется на каждой правке имени;
  // без этого снимка выбранный наставник отваливался бы от дисциплины ровно
  // тогда, когда его имя дописывают. Строка та же — переносим выбор на её новый id.
  let lastIds = draft.teachers.map(teacherIdOf);

  /** Пересобрать списки во всех выпадашках, сохранив уже сделанный выбор. */
  const refreshTeacherOptions = () => {
    const ids = draft.teachers.map(teacherIdOf);
    const moved = new Map();
    lastIds.forEach((was, i) => { if (was && ids[i] && was !== ids[i]) moved.set(was, ids[i]); });
    const known = new Set(draft.teachers.filter((t) => str(t.name)).map(teacherIdOf));

    for (const { sel, subject } of selects) {
      if (subject.teacherId && moved.has(subject.teacherId)) subject.teacherId = moved.get(subject.teacherId);
      // Наставника удалили или стёрли ему имя: выбор честно сбрасывается в
      // «— не назначен —», а не остаётся ссылкой в пустоту.
      if (subject.teacherId && !known.has(subject.teacherId)) subject.teacherId = '';
      clear(sel);
      for (const opt of teacherOptions(subject)) sel.append(opt);
    }
    lastIds = ids;
  };

  const redraw = () => {
    clear(body);
    selects.length = 0;
    lastIds = draft.teachers.map(teacherIdOf);
    const check = validateSubjectRows(draft, preset);

    body.append(el('div', { class: 'academy-card-title', text: U.teachersTitle }));
    body.append(el('div', { class: 'academy-table academy-table-teachers' },
      draft.teachers.length
        ? draft.teachers.map((t, i) => el('div', { class: 'academy-tr' }, [
          field('Имя', t.name, (v) => { t.name = v; }, U.teacherNameHint, refreshTeacherOptions),
          field('Черты', t.traits, (v) => { t.traits = v; }, U.traitsHint),
          el('div', { class: 'academy-td academy-td-actions' }, [
            el('div', {
              class: 'menu_button academy-btn academy-btn-small',
              text: 'Удалить',
              onclick: () => { draft.teachers.splice(i, 1); redraw(); },
            }),
          ]),
        ]))
        : [el('div', { class: 'academy-silent', text: U.noTeachersRow })]));
    body.append(el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: U.addTeacher,
        onclick: () => { draft.teachers.push({ id: '', name: '', traits: '' }); redraw(); },
      }),
    ]));

    body.append(el('div', { class: 'academy-card-title', text: U.subjectsTitle }));
    body.append(el('div', { class: 'academy-table academy-table-subjects' },
      draft.subjects.length
        ? draft.subjects.map((s, i) => el('div', { class: 'academy-tr' }, [
          field('Название', s.name, (v) => { s.name = v; }, U.subjectNameHint),
          el('div', { class: 'academy-td' }, [
            el('label', { class: 'academy-field' }, [
              el('span', { text: U.teacherField }),
              teacherSelect(s),
            ]),
          ]),
          // Корпус и аудитория (9.7A п.11) — необязательные, одной ячейкой на
          // двоих: на телефоне таблица становится карточкой, и два коротких
          // поля рядом занимают одну строку, а не две.
          el('div', { class: 'academy-td academy-td-place' }, [
            field(X.buildingField, s.building, (v) => { s.building = v; }, X.buildingHint),
            field(X.roomField, s.room, (v) => { s.room = v; }, X.roomHint),
          ]),
          el('div', { class: 'academy-td academy-td-actions' }, [
            el('div', {
              class: 'menu_button academy-btn academy-btn-small',
              text: 'Удалить',
              onclick: () => { draft.subjects.splice(i, 1); redraw(); },
            }),
          ]),
        ]))
        : [el('div', { class: 'academy-silent', text: U.noSubjectsRow })]));
    body.append(el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: U.addSubject,
        onclick: () => { draft.subjects.push({ id: '', name: '', teacherId: '', building: '', room: '' }); redraw(); },
      }),
      el('div', {
        class: 'menu_button academy-btn',
        text: 'Сохранить таблицу',
        onclick: async (e) => {
          const res = validateSubjectRows(draft, preset);
          if (!res.ok) {
            setStatus(status, 'error', res.errors.map((x) => x.text).join(' '));
            return;
          }
          await runAction(e.currentTarget, status,
            () => call(host, 'setSubjects', { subjects: res.subjects, teachers: res.teachers }),
            'Таблица сохранена.');
          renderPanel(host);
        },
      }),
    ]));

    if (check.errors.length) {
      body.append(el('ul', { class: 'academy-errors' },
        check.errors.map((x) => el('li', { text: x.text }))));
    }
    if (check.notes.length) {
      body.append(el('ul', { class: 'academy-notes' },
        check.notes.map((t) => el('li', { text: t }))));
    }
  };
  redraw();

  return section(U.planSection, [
    el('p', { class: 'academy-note', text: U.planNote }),
    body,
    status,
  ], open);
}

/**
 * Ячейка с полем ввода.
 *
 * `onCommit` — необязательный второй обработчик, и висит он на `change`, а не на
 * `input`: `change` у текстового поля срабатывает при уходе фокуса, то есть
 * ровно тогда, когда человек дописал значение и перешёл дальше. Так выпадашки
 * наставников успевают обновиться до того, как до них доберутся, и при этом не
 * дёргаются на каждой букве.
 */
function field(label, value, onInput, placeholder, onCommit) {
  const input = el('input', { type: 'text', class: 'text_pole academy-input', value: value || '', placeholder: placeholder || '' });
  input.addEventListener('input', () => onInput(input.value));
  if (onCommit) input.addEventListener('change', () => onCommit(input.value));
  return el('div', { class: 'academy-td' }, [
    el('label', { class: 'academy-field' }, [el('span', { text: label }), input]),
  ]);
}

/** Уникальные id и имена: блок настроек живёт на странице в двух копиях. */
let uid = 0;
const nextId = (prefix) => `${prefix}_${(uid += 1)}`;

function renderApiBlock(host, view) {
  const a = view.api;
  const status = el('div', { class: 'academy-status' });
  const listId = nextId('academy_models');
  const group = nextId('academy_api_source');
  const own = a.routed === 'endpoint';

  const endpoint = el('input', { type: 'text', class: 'text_pole academy-input', value: a.endpoint, placeholder: 'https://api.example.com' });
  const key = el('input', { type: 'password', class: 'text_pole academy-input', value: a.key, placeholder: 'ключ' });
  const model = el('input', { type: 'text', class: 'text_pole academy-input', value: a.model, placeholder: 'имя модели', list: listId });
  const models = el('datalist', { id: listId });

  // `quiet` — не украшение, а условие работоспособности кнопок ниже. Обычный
  // `setSettings` заканчивается перерисовкой всей вкладки; она отцепляет от
  // документа тот самый узел `status`, в который `runAction` пишет ответ, и
  // результат — «Связь есть» или текст отказа — не видит никто. Поля API не
  // влияют ни на один другой экран, поэтому перерисовывать ради них нечего.
  const push = () => safe(() => host.setSettings({
    api: { endpoint: endpoint.value.trim(), key: key.value, model: model.value.trim() },
  }, { quiet: true }), null);
  for (const input of [endpoint, key, model]) input.addEventListener('change', push);

  // Источник — единственная настройка блока, которая меняет сам блок: при
  // «актуальном API» полям адреса и ключа делать нечего. Поэтому она — и только
  // она — сохраняется с перерисовкой, а раскрытым блок остаётся сам (`section`).
  const chooseSource = (id) => {
    safe(() => host.setSettings({ api: { source: id } }), null);
    renderPanel(host);
    renderSettingsBlock(host);
  };

  const SOURCES = [
    {
      id: 'tavern',
      label: 'Актуальный API таверны',
      hint: 'То, чем таверна отвечает прямо сейчас. Ключ вводить не нужно — расширение ничего не отправляет само.',
    },
    {
      id: 'own',
      label: 'Свой адрес с ключом',
      hint: 'Отдельное подключение — нужно, если генерацию хочется пустить на дешёвую модель.',
    },
  ];
  const sourceBox = el('div', { class: 'academy-modes' }, SOURCES.map((m) => {
    const active = m.id === (own ? 'own' : 'tavern');
    const radio = el('input', { type: 'radio', name: group, value: m.id, checked: active });
    radio.addEventListener('change', () => chooseSource(m.id));
    return el('label', { class: active ? 'academy-mode academy-mode-on' : 'academy-mode' }, [
      radio,
      el('span', { class: 'academy-mode-label', text: m.label }),
      el('span', { class: 'academy-note', text: m.hint }),
    ]);
  }));

  // Профили подключения. Их может не быть вовсе (сборка без менеджера
  // подключений или ни одного заведённого) — тогда пункт ровно один, и
  // выпадашка не нужна: «текущее подключение» и так единственное.
  let profileRow = null;
  if (!own && a.profiles.length) {
    const select = el('select', { class: 'text_pole academy-input' }, [
      el('option', { value: '', text: 'Текущее подключение таверны', selected: !a.profile }),
      ...a.profiles.map((p) => el('option', {
        value: p.id,
        text: p.model ? `${p.name} (${p.model})` : p.name,
        selected: p.id === a.profile,
      })),
    ]);
    select.value = a.profile;
    select.addEventListener('change', () => {
      safe(() => host.setSettings({ api: { profile: select.value } }, { quiet: true }), null);
      setStatus(status, 'note', select.value
        ? 'Профиль выбран. Проверьте связь — запрос пойдёт через него.'
        : 'Выбрано текущее подключение таверны.');
    });
    profileRow = el('label', { class: 'academy-field' }, [el('span', { text: 'Профиль подключения' }), select]);
  }

  const modelsBtn = own ? el('div', {
    class: 'menu_button academy-btn academy-btn-small',
    text: 'Список моделей',
    onclick: async (e) => {
      push();
      const res = await runAction(e.currentTarget, status, () => call(host, 'listModels'), 'Список получен.');
      const list = (res && res.models) || [];
      clear(models);
      for (const m of list) models.append(el('option', { value: String(m) }));
      // Список пришёл через сервер таверны (9.1.7, `api.js: listModels`) —
      // сказать об этом одной строкой: ключ в этот раз прошёл через сервер
      // самой таверны, и человек, у которого браузер «не видит» адрес, должен
      // понимать, почему список всё-таки есть.
      const via = res && res.via === 'tavern-backend' ? ' Адрес не пускает запросы из браузера, поэтому список спросил сервер таверны — тем же адресом и ключом.' : '';
      if (list.length) setStatus(status, 'ok', `Моделей: ${list.length}. Список раскрывается в поле «Модель».${via}`);
    },
  }) : null;

  return section('API для генерации', [
    el('p', {
      class: 'academy-note',
      text: own
        // Про сервер таверны сказано прямо (9.1.7): если адрес не пускает
        // браузер (CORS), список моделей запрашивает сервер таверны — ключ
        // проходит через него, хотя дальше указанного адреса не уходит.
        ? 'Ключ лежит в настройках таверны открытым текстом и попадает в их экспорт. Никуда, кроме указанного адреса, он не уходит;'
          + ' если адрес не пускает запросы из браузера, список моделей за вас спросит сервер самой таверны — тем же адресом и ключом.'
        : 'Генерация пойдёт тем же подключением, которым таверна отвечает в чате. Ключ здесь вводить не нужно и никуда он не уезжает: запрос делает сама таверна.',
    }),
    sourceBox,
    !own && a.connectionAvailable === false
      ? el('p', { class: 'academy-warn', text: 'Таверна сейчас не отдаёт ни одного подключения: расширению генерировать нечем. Впишите свой адрес либо настройте подключение в самой таверне.' })
      : null,
    a.profileMissing
      ? el('p', { class: 'academy-warn', text: 'Выбранный профиль подключения в таверне больше не найден — выберите его заново.' })
      : null,
    profileRow,
    own ? el('label', { class: 'academy-field' }, [el('span', { text: 'Адрес' }), endpoint]) : null,
    own ? el('label', { class: 'academy-field' }, [el('span', { text: 'Ключ' }), key]) : null,
    own ? el('label', { class: 'academy-field' }, [el('span', { text: 'Модель' }), model, models]) : null,
    // Списка моделей у подключения таверны нет и быть не может: модель там
    // выбирает сама таверна. Кнопку в этом случае не рисуем вовсе — нажатие,
    // которое всегда отвечает «списка нет», хуже честной строки.
    !own ? el('p', { class: 'academy-note', text: 'Своего списка моделей у подключения таверны нет: модель задаёт сама таверна (или пресет выбранного профиля).' }) : null,
    el('div', { class: 'academy-row academy-row-buttons' }, [
      modelsBtn,
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: 'Проверить связь',
        onclick: async (e) => {
          push();
          await runAction(e.currentTarget, status, () => call(host, 'testApi'), 'Связь есть.');
        },
      }),
    ]),
    status,
  ]);
}

function renderModeBlock(host, view) {
  const group = nextId('academy_mode');
  const modeBox = el('div', { class: 'academy-modes' }, view.modes.map((m) => {
    const radio = el('input', { type: 'radio', name: group, value: m.id, checked: m.active });
    radio.addEventListener('change', () => {
      safe(() => host.setSettings({ mode: m.id }), null);
      renderPanel(host);
      renderSettingsBlock(host);
    });
    return el('label', { class: m.active ? 'academy-mode academy-mode-on' : 'academy-mode' }, [
      radio,
      el('span', { class: 'academy-mode-label', text: m.label }),
      el('span', { class: 'academy-note', text: m.hint }),
    ]);
  }));

  const marker = el('input', { type: 'checkbox', checked: view.injectMarker, disabled: view.injectMarkerLocked });
  marker.addEventListener('change', () => host.setSettings({ injectMarker: marker.checked }));

  const words = el('input', { type: 'checkbox', checked: view.relativeWords });
  words.addEventListener('change', () => host.setSettings({ relativeWords: words.checked }));

  const viaMacro = el('input', { type: 'checkbox', checked: view.statusViaMacro === true });
  viaMacro.addEventListener('change', () => host.setSettings({ statusViaMacro: viaMacro.checked }));

  return section('Источник времени', [
    // Слова технические и в пресеты не едут — как и всё в этом блоке.
    view.markerRisk
      ? el('p', {
        class: 'academy-warn',
        text: 'В настройках таверны включён «Encode tags» — служебная метка станет видна прямо в тексте ответа. Выключите его в настройках пользователя либо перейдите на режим «из контекста».',
      })
      : null,
    modeBox,
    el('label', { class: 'academy-check' }, [
      marker,
      el('span', {
        text: view.injectMarkerLocked
          ? 'Инжектить инструкцию про метку (в режиме «из контекста» не нужна)'
          : 'Инжектить инструкцию про метку',
      }),
    ]),
    el('label', { class: 'academy-check' }, [
      words,
      el('span', { text: 'Понимать относительные сдвиги словами («на следующее утро», «через неделю») — самая ненадёжная часть' }),
    ]),
    // 9.3.1: хвост промпта тесный (9.5), и место строки решает человек.
    // Инструкция метки и одноразовый факт остаются инжектами — их место важно.
    el('label', { class: 'academy-check' }, [
      viaMacro,
      el('span', {
        text: 'Вставлять строку состояния через макрос {{academy}} — сами поставьте его в системный промпт, заметку автора или карточку; автоинжект строки выключится',
      }),
    ]),
  ]);
}

/* --- пресет заведения ------------------------------------------------------ */

/**
 * Выбор пресета.
 *
 * Смена пресета на уже начатом семестре — опасное действие, и подтверждение
 * рисуется здесь же в панели, а не браузерным `confirm()`: модальные окна
 * браузера в таверне запрещены, а собственный попап тут не нужен — вопрос
 * помещается в две строки под селектом. Двухшаговый контракт держит `index.js`
 * (`actions.setPreset`), панель только показывает то, что он вернул: сначала
 * `needs-confirm` со словами про расхождение, потом — второй вызов с `confirm`.
 */
function renderPresetBlock(host, view) {
  const U = view.labels;
  const p = view.presets;
  const status = el('div', { class: 'academy-status' });
  const confirmBox = el('div', { class: 'academy-confirm', hidden: true });

  const select = el('select', { class: 'text_pole academy-input' },
    p.list.map((item) => el('option', {
      value: item.id,
      selected: item.active,
      // Свой пресет помечен: встроенный и его копия-основа иначе неотличимы
      // до первого нажатия «Удалить».
      text: item.broken ? `${item.name} (файл не прочитан)` : (item.user ? `${item.name} (${PRESET_TEXT.userMark})` : item.name),
    })));

  const apply = async (button, confirm) => {
    const id = select.value;
    if (id === p.active) { setStatus(status, 'ok', U.presetSameNote); return; }
    const res = await runAction(button, status, () => call(host, 'setPreset', id, { confirm }), U.presetChanged);
    if (res && res.needsConfirm) {
      askConfirm(confirmBox, U, {
        reasons: res.reasons || [],
        current: res.current,
        incoming: null,
        onYes: (btn) => apply(btn, true),
        onNo: () => { select.value = p.active; setStatus(status, 'ok', U.importCancelled); },
      });
      return;
    }
    if (res && res.ok !== false) {
      // Смена пресета меняет ярлыки вкладок, слова панели и шкалу оценок —
      // перерисовывается всё дерево целиком, а не одна секция. Тот же промах
      // уже чинили однажды на сшивке вкладок, и повторять его негде.
      renderPanel(host);
      renderSettingsBlock(host);
    }
  };

  // --- переносимые пресеты (9.3.2) ------------------------------------------
  //
  // Выгрузка и удаление действуют на то, что выбрано в выпадашке, а не на
  // активный пресет: «выгрузить японскую школу как основу для своей» не
  // должно требовать сперва включить её в идущем чате.
  const T = PRESET_TEXT;
  const isUser = (id) => p.list.some((item) => item.id === id && item.user);
  const nameOf = (id) => ((p.list.find((item) => item.id === id) || {}).name || id);

  const exportPreset = async (e) => {
    const res = await runAction(e.currentTarget, status, () => call(host, 'exportPreset', select.value), '');
    if (!res || res.ok === false) return;
    if (saveFile(res.json, res.filename, status)) setStatus(status, 'ok', fill(T.exportOk, { filename: res.filename }));
  };

  const deleteBox = el('div', { class: 'academy-confirm', hidden: true });
  const remove = async (button, confirm) => {
    const id = select.value;
    const res = await runAction(button, status, () => call(host, 'deletePreset', id, { confirm }), T.deleted);
    if (res && res.needsConfirm) {
      askConfirm(confirmBox, U, {
        reasons: res.reasons || [],
        current: res.current,
        incoming: null,
        onYes: (btn) => remove(btn, true),
        onNo: () => setStatus(status, 'ok', U.importCancelled),
      });
      return;
    }
    if (res && res.ok !== false) { renderPanel(host); renderSettingsBlock(host); }
  };
  // Удаление — в два нажатия всегда, даже когда пресет не активен: вернуть
  // его можно только файлом, а файла у человека может и не быть.
  const askDelete = () => {
    clear(deleteBox);
    deleteBox.hidden = false;
    deleteBox.append(
      el('div', { class: 'academy-confirm-title', text: fill(T.deleteConfirm, { name: nameOf(select.value) }) }),
      el('div', { class: 'academy-row academy-row-buttons' }, [
        el('div', {
          class: 'menu_button academy-btn academy-btn-main',
          text: T.deleteYes,
          onclick: (e) => { deleteBox.hidden = true; remove(e.currentTarget, false); },
        }),
        el('div', {
          class: 'menu_button academy-btn academy-btn-small',
          text: T.cancel,
          onclick: () => { deleteBox.hidden = true; setStatus(status, 'ok', U.importCancelled); },
        }),
      ]),
    );
  };
  const deleteBtn = el('div', {
    class: 'menu_button academy-btn academy-btn-small academy-btn-danger',
    text: T.deleteButton,
    onclick: askDelete,
  });
  // Кнопка удаления есть только у своего пресета. Выпадашка перерисовки не
  // вызывает, поэтому видимость правится на месте.
  const syncDelete = () => { deleteBtn.hidden = !isUser(select.value); deleteBox.hidden = true; };
  select.addEventListener('change', syncDelete);
  syncDelete();

  // Узел статуса — на свою копию блока: блок рисуется и в панели, и в меню
  // расширений, и итог загрузки после перерисовки ищет СВОЙ новый узел.
  const scope = sectionScope;
  mounted.presetStatus = { ...(mounted.presetStatus || {}), [scope]: status };
  const importBlock = renderPresetImport(host, U, status, confirmBox, scope);

  return section(U.presetSection, [
    el('p', { class: 'academy-note', text: U.presetNote }),
    p.notice ? el('p', { class: 'academy-warn', text: p.notice }) : null,
    el('label', { class: 'academy-field' }, [el('span', { text: U.presetSection }), select]),
    p.drift ? el('p', { class: 'academy-warn', text: p.drift }) : null,
    p.gone ? el('p', { class: 'academy-warn', text: p.gone }) : null,
    el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: U.presetChange,
        onclick: (e) => apply(e.currentTarget, false),
      }),
      el('div', { class: 'menu_button academy-btn academy-btn-small', text: T.exportButton, onclick: exportPreset }),
      deleteBtn,
    ]),
    deleteBox,
    el('p', { class: 'academy-note', text: T.exportNote }),
    importBlock,
    confirmBox,
    status,
  ]);
}

/**
 * Отдать текст браузеру файлом. Тот же приём, что у выгрузки состояния:
 * `Blob` + временная ссылка, живущая ровно один клик.
 * @returns {boolean} получилось ли
 */
function saveFile(text, filename, status) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    setStatus(status, 'error', `Файл не отдался браузеру: ${(err && err.message) || err}`);
    return false;
  }
}

/**
 * Загрузка пресета из файла (9.3.2): выбрать файл → превью → «добавить» или
 * «добавить и применить».
 *
 * Разбор и запись — два разных вызова, как у загрузки состояния (решение 8
 * этапа 3): человек видит, что за заведение приедет, ДО того, как оно легло в
 * настройки. Текст файла держится в замыкании между превью и кнопкой — второй
 * раз файл не читается, а превью и запись проверяют одно и то же.
 */
function renderPresetImport(host, U, status, confirmBox, scope) {
  const T = PRESET_TEXT;
  const preview = el('div', { class: 'academy-confirm academy-preset-preview', hidden: true });
  const file = el('input', { type: 'file', accept: 'application/json,.json', class: 'academy-file' });

  const reset = () => { preview.hidden = true; clear(preview); file.value = ''; };
  const statusAfter = () => ((mounted.presetStatus && mounted.presetStatus[scope]) || status);

  const done = (res, apply) => {
    const name = String(res.name || res.added || '');
    reset();
    renderPanel(host);
    renderSettingsBlock(host);
    // Перерисовка отцепила старый узел статуса — итог пишется в новый.
    const target = statusAfter();
    setStatus(target, 'ok', fill(apply ? T.addedApplied : T.added, { name }));
  };

  const add = async (button, text, apply) => {
    const res = await runAction(button, status, () => call(host, 'importPreset', text, { apply }), '');
    if (!res) return;
    if (res.needsConfirm && res.added) {
      // Пресет уже добавлен; вопрос — только про смену на идущем семестре.
      reset();
      askConfirm(confirmBox, U, {
        reasons: res.reasons || [],
        current: res.current,
        incoming: null,
        onYes: async (btn) => {
          const again = await runAction(btn, status, () => call(host, 'setPreset', res.added, { confirm: true }), U.presetChanged);
          if (again && again.ok !== false) done(res, true);
        },
        onNo: () => {
          renderPanel(host);
          renderSettingsBlock(host);
          setStatus(statusAfter(), 'ok', fill(T.addedNotApplied, { name: res.name || res.added }));
        },
      });
      return;
    }
    if (res.ok === false) return;
    done(res, apply);
  };

  const showPreview = (res, text) => {
    clear(preview);
    preview.hidden = false;
    const s = res.summary || {};
    // Через фильтр: штатный `append` превращает `null` в текст «null» — так
    // стенд на 360px и показал его под замечаниями.
    preview.append(...[
      el('div', { class: 'academy-confirm-title', text: T.previewTitle }),
      el('div', { class: 'academy-preset-name', text: s.name || s.id || '' }),
      s.line ? el('div', { class: 'academy-preset-line', text: s.line }) : null,
      res.renamed ? el('p', { class: 'academy-note', text: fill(T.previewRenamed, { id: s.id }) }) : null,
      res.warnings && res.warnings.length
        ? el('details', { class: 'academy-preset-warnings' }, [
          el('summary', { text: `${T.previewWarnings} (${res.warnings.length})` }),
          el('ul', { class: 'academy-errors' }, res.warnings.map((w) => el('li', { text: String(w) }))),
        ])
        : null,
      res.full ? el('p', { class: 'academy-warn', text: fill(T.full, { max: res.max || 20 }) }) : null,
      el('div', { class: 'academy-row academy-row-buttons' }, [
        el('div', { class: 'menu_button academy-btn academy-btn-main', text: T.addApply, onclick: (e) => add(e.currentTarget, text, true) }),
        el('div', { class: 'menu_button academy-btn academy-btn-small', text: T.add, onclick: (e) => add(e.currentTarget, text, false) }),
        el('div', { class: 'menu_button academy-btn academy-btn-small', text: T.cancel, onclick: () => { reset(); setStatus(status, 'ok', T.cancelled); } }),
      ]),
    ].filter(Boolean));
  };

  file.addEventListener('change', async () => {
    const picked = file.files && file.files[0];
    if (!picked) return;
    reset();
    // Размер — до чтения: на телефоне прочитать в память чужой гигабайт ради
    // отказа «слишком большой» — худший из вариантов.
    if (typeof picked.size === 'number' && picked.size > PRESET_MAX_BYTES) {
      setStatus(status, 'error', T.tooBig);
      return;
    }
    let text = '';
    try {
      text = await picked.text();
    } catch (err) {
      setStatus(status, 'error', fill(T.readFailed, { error: (err && err.message) || err }));
      return;
    }
    const res = await runAction(null, status, () => call(host, 'previewPreset', text), '');
    if (!res || res.ok === false) {
      // Причины отказа — списком: человек чинит файл руками, и одна причина
      // за раз — пять загрузок вместо одной (`core/preset.mjs`, решение 4).
      if (res && Array.isArray(res.errors) && res.errors.length > 1) {
        clear(preview);
        preview.hidden = false;
        preview.append(el('ul', { class: 'academy-errors' }, res.errors.map((x) => el('li', { text: String(x) }))));
      }
      file.value = '';
      return;
    }
    setStatus(status, 'ok', '');
    showPreview(res, text);
  });

  return el('div', { class: 'academy-preset-import' }, [
    el('label', { class: 'academy-field' }, [el('span', { text: T.importPick }), file]),
    el('p', { class: 'academy-note', text: T.importNote }),
    preview,
  ]);
}

/* --- лорбук академии (3.7) ------------------------------------------------- */

/**
 * Лорбук одной секцией.
 *
 * Два правила, из которых вытекает вся форма блока.
 *
 * 1. **Пустого экрана не бывает.** Галочка включена, а записей нет — у этого
 *    четыре разных причины (старая сборка без World Info, чат ещё не сохранён,
 *    семестр не начат, ошибка), и каждая называется вслух строкой из
 *    `view.lorebook.explain`. Молчание здесь хуже всего: человеку некуда пойти.
 * 2. **Осиротевшие показываются только вместе с кнопкой.** Список «лишнего в
 *    вашем World Info» без способа это убрать пугает и не даёт ничего, поэтому
 *    при пустом списке блока нет вовсе.
 */
function renderLorebookBlock(host, view) {
  const U = view.labels;
  const L = view.lorebook;
  const status = el('div', { class: 'academy-status' });

  const toggle = el('input', { type: 'checkbox', checked: L.enabled });
  toggle.addEventListener('change', () => {
    safe(() => host.setSettings({ lorebook: { enabled: toggle.checked } }), null);
    // Лорбук заводится не сразу: `setSettings` синхронный, а поход в World Info
    // нет. Перерисовку делает сам `index.js`, когда синхронизация кончится.
    renderPanel(host);
  });

  const book = el('input', {
    type: 'text', class: 'text_pole academy-input', value: L.book, placeholder: U.lorebookBookHint,
  });
  book.addEventListener('change', () => {
    safe(() => host.setSettings({ lorebook: { book: book.value.trim() } }), null);
  });

  // --- форма «предложить запись» -------------------------------------------
  const newName = el('input', { type: 'text', class: 'text_pole academy-input', placeholder: U.lorebookNewNameHint });
  const newNote = el('input', { type: 'text', class: 'text_pole academy-input', placeholder: U.lorebookNewNoteHint });
  const kindGroup = nextId('academy_lore_kind');
  const kindPeople = el('input', { type: 'radio', name: kindGroup, value: 'people', checked: true });
  const kindPlaces = el('input', { type: 'radio', name: kindGroup, value: 'places' });

  const suggestForm = el('div', { class: 'academy-lore-form' }, [
    el('p', { class: 'academy-note', text: U.lorebookSuggestNote }),
    el('label', { class: 'academy-field' }, [el('span', { text: U.lorebookNewName }), newName]),
    el('label', { class: 'academy-field' }, [el('span', { text: U.lorebookNewNote }), newNote]),
    el('div', { class: 'academy-modes' }, [
      el('label', { class: 'academy-mode' }, [kindPeople, el('span', { class: 'academy-mode-label', text: U.lorebookKindPeople })]),
      el('label', { class: 'academy-mode' }, [kindPlaces, el('span', { class: 'academy-mode-label', text: U.lorebookKindPlaces })]),
    ]),
    el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: U.lorebookNewButton,
        onclick: async (e) => {
          const res = await runAction(e.currentTarget, status, () => call(host, 'suggestLorebookEntry', {
            name: newName.value.trim(),
            note: newNote.value.trim(),
            kind: kindPlaces.checked ? 'places' : 'people',
          }), U.lorebookNewOk);
          if (res && res.ok !== false) { newName.value = ''; newNote.value = ''; }
        },
      }),
    ]),
  ]);

  // --- предложения, ждущие решения -----------------------------------------
  const suggestList = L.suggest.length
    ? el('ul', { class: 'academy-lore-list' }, L.suggest.map((e) => el('li', { class: 'academy-lore-item' }, [
      el('div', { class: 'academy-lore-name', text: e.name }),
      e.text ? el('div', { class: 'academy-note', text: e.text }) : null,
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: U.lorebookAccept,
        onclick: (ev) => runAction(ev.currentTarget, status,
          () => call(host, 'acceptLorebookSuggestion', e.uid), U.lorebookAcceptOk),
      }),
    ])))
    : el('p', { class: 'academy-note', text: U.lorebookNoSuggest });

  // --- осиротевшие: без кнопки не показываются вовсе ------------------------
  const orphans = L.orphans.length
    ? [
      el('h5', { class: 'academy-sub-title', text: U.lorebookOrphansTitle }),
      el('p', { class: 'academy-note', text: U.lorebookOrphansNote }),
      el('ul', { class: 'academy-lore-list' },
        L.orphans.map((o) => el('li', { class: 'academy-lore-item' }, [el('code', { text: o.uid })]))),
      el('div', { class: 'academy-row academy-row-buttons' }, [
        el('div', {
          class: 'menu_button academy-btn academy-btn-small',
          text: fill(U.lorebookPrune, { count: L.orphans.length }),
          onclick: async (e) => {
            const res = await runAction(e.currentTarget, status, () => call(host, 'pruneLorebook'), '');
            if (res && res.ok !== false) {
              setStatus(status, 'ok', fill(U.lorebookPruned, { count: Number(res.removed) || 0 }));
              renderPanel(host);
            }
          },
        }),
      ]),
    ]
    : [];

  return section(U.lorebookSection, [
    el('label', { class: 'academy-check' }, [toggle, el('span', { text: U.lorebookToggle })]),
    el('p', { class: 'academy-note', text: U.lorebookNote }),
    // Всё ниже галочки существует только при включённом лорбуке: выключенный
    // лорбук — это одна строка, а не свёрнутая наполовину секция.
    ...(L.enabled ? [
      L.boundLine ? el('p', { class: 'academy-note', text: L.boundLine }) : null,
      L.explain ? el('p', { class: 'academy-warn', text: L.explain }) : null,
      el('label', { class: 'academy-field' }, [el('span', { text: U.lorebookBookField }), book]),
      L.measureLine ? el('p', { class: 'academy-note', text: L.measureLine }) : null,
      L.overCapLine ? el('p', { class: 'academy-warn', text: L.overCapLine }) : null,
      el('div', { class: 'academy-row academy-row-buttons' }, [
        el('div', {
          class: 'menu_button academy-btn academy-btn-small',
          text: U.lorebookRefresh,
          onclick: async (e) => {
            const res = await runAction(e.currentTarget, status, () => call(host, 'syncLorebook'), U.lorebookRefreshOk);
            if (res && res.ok !== false) renderPanel(host);
          },
        }),
      ]),
      el('h5', { class: 'academy-sub-title', text: U.lorebookSuggestTitle }),
      suggestList,
      el('h5', { class: 'academy-sub-title', text: U.lorebookNewTitle }),
      suggestForm,
      ...orphans,
    ] : [el('p', { class: 'academy-note', text: U.lorebookOff })]),
    status,
  ]);
}

/* --- выгрузка и загрузка состояния (3.8) ----------------------------------- */

/**
 * Файл — единственное место панели, где нужен настоящий DOM API: `Blob`,
 * `URL.createObjectURL` и `<input type=file>` ничем не подменяются. Поэтому всё
 * остальное — разбор, сводки и решение о записи — живёт в `storage.js` и
 * приходит сюда готовым: в Node прогоняется вся выгрузка, кроме самого
 * нажатия «сохранить как».
 *
 * Подтверждение рисуется тут же, в панели. Браузерный `confirm()` в таверне
 * запрещён, а свои попапы таверны (`popup.js`) здесь ничего не добавляют:
 * вопрос со сводками «что сейчас» и «что приедет» — это четыре строки, и они
 * помещаются под кнопкой.
 */
function renderTransferBlock(host, view) {
  const U = view.labels;
  const status = el('div', { class: 'academy-status' });
  const confirmBox = el('div', { class: 'academy-confirm', hidden: true });

  const file = el('input', { type: 'file', accept: 'application/json,.json', class: 'academy-file' });

  const load = async (text, button, confirm) => {
    const res = await runAction(button, status, () => call(host, 'importState', text, { confirm }), U.importOk);
    if (res && res.needsConfirm) {
      askConfirm(confirmBox, U, {
        reasons: res.reasons || [],
        current: res.current,
        incoming: res.incoming,
        onYes: (btn) => load(text, btn, true),
        onNo: () => { file.value = ''; setStatus(status, 'ok', U.importCancelled); },
      });
      return;
    }
    if (res && res.ok !== false) {
      confirmBox.hidden = true;
      file.value = '';
      mounted.tab = 'today';
      renderPanel(host);
    }
  };

  file.addEventListener('change', async () => {
    const picked = file.files && file.files[0];
    if (!picked) return;
    confirmBox.hidden = true;
    let text = '';
    try {
      text = await picked.text();
    } catch (err) {
      setStatus(status, 'error', `Файл не прочитался: ${(err && err.message) || err}`);
      return;
    }
    await load(text, null, false);
  });

  const save = async (e) => {
    const res = await runAction(e.currentTarget, status, () => call(host, 'exportState'), '');
    if (!res || res.ok === false) return;
    try {
      // Скачивание: `Blob` + временная ссылка. Живёт ровно один клик — иначе
      // объектный URL держит копию состояния в памяти вкладки до перезагрузки.
      const url = URL.createObjectURL(new Blob([res.json], { type: 'application/json' }));
      const a = el('a', { href: url, download: res.filename });
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(status, 'ok', fill(U.exportOk, { filename: res.filename }));
    } catch (err) {
      setStatus(status, 'error', `Файл не отдался браузеру: ${(err && err.message) || err}`);
    }
  };

  return section(U.transferSection, [
    el('p', { class: 'academy-note', text: U.transferNote }),
    el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', { class: 'menu_button academy-btn academy-btn-small', text: U.exportButton, onclick: save }),
    ]),
    el('label', { class: 'academy-field' }, [el('span', { text: U.importPick }), file]),
    confirmBox,
    status,
  ]);
}

/** Сводка состояния одной строкой: пресет, день, предметы, оценки. */
function summaryLine(summary, U) {
  if (!summary) return U.summaryNothing;
  const tail = summary.started ? '' : ` (${U.summaryNotStarted})`;
  return fill(U.summaryLine, {
    presetId: summary.presetId || '—',
    day: summary.day || '—',
    subjects: summary.subjects,
    grades: summary.grades,
  }) + tail;
}

/**
 * Вопрос «заменить то, что есть?» прямо в панели.
 *
 * Обе сводки — «что сейчас» и «что приедет» — показываются ДО того, как
 * что-нибудь произошло: ради этого разбор и запись в `storage.js` разведены на
 * два вызова, и терять здесь эту возможность было бы бессмысленно.
 */
function askConfirm(box, U, { reasons, current, incoming, onYes, onNo }) {
  clear(box);
  box.hidden = false;
  box.append(el('div', { class: 'academy-confirm-title', text: U.importConfirmTitle }));
  if (reasons && reasons.length) {
    box.append(el('ul', { class: 'academy-errors' }, reasons.map((r) => el('li', { text: String(r) }))));
  }
  box.append(el('div', { class: 'academy-summary' }, [
    el('div', {}, [el('b', { text: `${U.summaryCurrent}: ` }), summaryLine(current, U)]),
    incoming ? el('div', {}, [el('b', { text: `${U.summaryIncoming}: ` }), summaryLine(incoming, U)]) : null,
  ]));
  box.append(el('div', { class: 'academy-row academy-row-buttons' }, [
    el('div', {
      class: 'menu_button academy-btn academy-btn-main',
      text: U.importConfirmYes,
      onclick: (e) => { box.hidden = true; onYes(e.currentTarget); },
    }),
    el('div', {
      class: 'menu_button academy-btn academy-btn-small',
      text: U.importConfirmNo,
      onclick: () => { box.hidden = true; onNo(); },
    }),
  ]));
}

/**
 * Галочка отладки. Живёт отдельной секцией и рисуется и в панели, и в блоке
 * меню расширений — рядом с источником времени, потому что README посылает сюда
 * ровно одним движением: «время не идёт — включите отладку и посмотрите
 * источник» (`:632-633`).
 *
 * Сам разбор сюда не выводится: он длинный, а «Настройки» на телефоне и без
 * него прокручиваются долго. Разбор — пятая вкладка, которой при выключенной
 * галочке не существует (`tabsFor`).
 */
/**
 * Звук вех (9.4.2). Галочка живёт в настройках расширения (`milestoneSound`,
 * умолчание — выкл.), а не в состоянии чата: это привычка человека, а не
 * факт семестра. Кнопка «Послушать» — не украшение: браузер пускает звук
 * только после жеста на странице, и человек, включивший галочку, должен иметь
 * способ убедиться, что звук вообще есть, не дожидаясь следующей вехи.
 */
function renderSoundBlock(host, preset, settings) {
  const X = extraLabels(preset);
  const status = el('div', { class: 'academy-status' });
  const box = el('input', { type: 'checkbox', checked: settings.milestoneSound === true });
  box.addEventListener('change', () => safe(() => host.setSettings({ milestoneSound: box.checked }, { quiet: true }), null));
  return section(X.soundSection, [
    el('label', { class: 'academy-check' }, [box, el('span', { text: X.soundToggle })]),
    el('p', { class: 'academy-note', text: X.soundNote }),
    el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: X.soundTry,
        onclick: () => { if (!playChime()) setStatus(status, 'note', X.soundTried); },
      }),
    ]),
    status,
  ]);
}

/** Один контекст на страницу: браузеры ограничивают их число. */
let chimeCtx = null;

/**
 * Короткий звук вехи на WebAudio, без файлов (9.4.2): две синусоиды квартой
 * вверх (ми → ля второй октавы), по ~0,35 с, с мягкой атакой и затуханием —
 * «колокольчик», а не сигнал ошибки. Громкость 0,08: звук не должен
 * перекрывать голос TTS и музыку соседей.
 *
 * Возвращает `true`, если звук поставлен в очередь. `false` — WebAudio нет
 * или браузер ещё не разрешил странице звук (контекст `suspended` до первого
 * жеста): тогда молча, без исключений — звук вежливость, а не условие.
 */
export function playChime() {
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (typeof AC !== 'function') return false;
    chimeCtx = chimeCtx || new AC();
    const ctx = chimeCtx;
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      Promise.resolve(ctx.resume()).catch(() => {});
    }
    const t0 = (Number(ctx.currentTime) || 0) + 0.02;
    for (const [freq, at] of [[659.25, 0], [880, 0.12]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.08, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.4);
    }
    return ctx.state !== 'suspended';
  } catch {
    return false;
  }
}

function renderDebugBlock(host, view) {
  const T = DEBUG_TEXT;
  const box = el('input', { type: 'checkbox', checked: view.debug });
  box.addEventListener('change', () => {
    safe(() => host.setSettings({ debug: box.checked }), null);
    // Вкладки собираются заново при каждой отрисовке, поэтому пятая появляется
    // и исчезает сразу, без перемонтирования панели.
    renderPanel(host);
    renderSettingsBlock(host);
  });
  return section(T.section, [
    el('label', { class: 'academy-check' }, [box, el('span', { text: T.toggle })]),
    el('p', { class: 'academy-note', text: T.hint }),
  ]);
}

// --- общее ------------------------------------------------------------------

/**
 * Блок настроек. `<details>`, а не `<section>`, и причина — телефон (3.9):
 * «Настройки» и до этапа 3 были самой длинной вкладкой, а теперь в них девять
 * блоков, и на экране в 360 пикселей прокрутка до кнопки «начать семестр»
 * занимала бы полминуты. Свёрнутый блок при этом остаётся видимым заголовком —
 * это не то же, что спрятать его за вторую вкладку.
 *
 * Раскрыты по умолчанию ровно те блоки, через которые лежит путь «завести
 * семестр с нуля»: анкета, таблица предметов и кнопка старта — и только пока
 * семестр не начат. После старта раскрывать нечего: человек приходит сюда за
 * одной конкретной вещью и открывает её сам.
 */
function section(title, children, open = false) {
  const key = `${sectionScope}::${title}`;
  const wasOpen = sectionOpen.has(key) ? sectionOpen.get(key) === true : open === true;
  const node = el('details', { class: 'academy-section', open: wasOpen }, [
    el('summary', { class: 'academy-section-title', text: title }),
    ...[].concat(children),
  ]);
  // Читаем `open` у самого узла, а не считаем нажатия: `<details>` умеет
  // раскрываться и мимо мыши (Ctrl+F по странице, клавиатура).
  node.addEventListener('toggle', () => { sectionOpen.set(key, node.open === true); });
  return node;
}

/**
 * Память о раскрытых блоках. Без неё любое сохранение настройки схлопывало на
 * вкладке всё: `host.setSettings` заканчивается `refreshPanel`, тот строит
 * `<details>` заново, и `open` терялся вместе со старым деревом.
 *
 * Ключ — «место + заголовок». Блок настроек живёт на странице в ДВУХ копиях
 * (панель и выпадашка в меню расширений — см. `nextId`), и копии здесь сделаны
 * НЕЗАВИСИМЫМИ намеренно: это два разных экрана, одновременно они не видны, и
 * человек, раскрывший «API для генерации» в меню расширений, не просил ничего
 * менять в панели. Синхронные копии дали бы обратное: тихую перестановку на
 * экране, которого человек в этот момент не видит.
 */
const sectionOpen = new Map();
let sectionScope = 'panel';

function renderEmpty(host, view) {
  return el('div', { class: 'academy-empty' }, [
    el('div', { class: 'academy-empty-title', text: view.title }),
    el('p', { class: 'academy-note', text: view.text }),
    view.errors && view.errors.length
      ? el('ul', { class: 'academy-errors' }, view.errors.map((e) => el('li', { text: String(e) })))
      : null,
    view.action
      ? el('div', {
        class: 'menu_button academy-btn academy-btn-main',
        text: view.action.label,
        onclick: () => { mounted.tab = 'settings'; renderPanel(host); },
      })
      : null,
  ]);
}

function collect(inputs) {
  const out = {};
  for (const [k, node] of Object.entries(inputs)) out[k] = node.value.trim();
  return out;
}

/** Черновик анкеты до старта семестра живёт в настройках, а не в состоянии. */
function saveDraft(host, survey) {
  try {
    const res = host.setSettings({ ui: { surveyDraft: survey } });
    return Promise.resolve(res);
  } catch (err) {
    return Promise.resolve({ ok: false, error: err });
  }
}

/** Вызов действия хоста, переживающий отсутствие действия. */
function call(host, name, ...args) {
  const fn = host && host.actions ? host.actions[name] : null;
  if (typeof fn !== 'function') return Promise.resolve({ ok: false, error: `index.js не передал actions.${name}` });
  return Promise.resolve(fn(...args));
}

function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

/* --- панель --------------------------------------------------------------- */

/**
 * Смонтировать панель. Хост — единственный канал наружу.
 *
 * @param {Object} host
 * @param {() => (Object|null)} host.getState
 * @param {() => Object} host.getPreset
 * @param {() => Object} host.getSettings
 * @param {(patch: Object) => void} host.setSettings глубокое слияние
 * @param {Object} host.actions см. `call()` — все асинхронные, все могут отказать
 * @returns {{open: Function, close: Function, toggle: Function, render: Function, destroy: Function}}
 */
export function mountPanel(host) {
  mounted.host = host;
  if (mounted.panel && mounted.panel.isConnected) {
    renderPanel(host);
    return panelApi(host);
  }

  const panel = el('div', { id: ID.panel, class: 'academy-panel draggable', role: 'dialog', 'aria-label': 'Академия' }, [
    el('div', { class: 'academy-bar panelControlBar' }, [
      el('div', { class: 'academy-grab drag-grabber fa-solid fa-grip', title: 'Перетащить' }),
      el('div', { class: 'academy-title', text: 'Академия' }),
      el('div', {
        class: 'academy-close dragClose fa-solid fa-circle-xmark',
        title: 'Закрыть',
        onclick: () => closePanel(),
      }),
    ]),
    // Полоса вкладок наполняется в `renderPanel`, а не здесь: набор вкладок
    // теперь зависит от настроек (пятая появляется с галочкой отладки), а
    // ярлыки — от пресета, который тоже может смениться после монтирования.
    el('div', { class: 'academy-tabs' }),
    el('div', { class: 'academy-body' }),
  ]);

  const holder = document.getElementById('movingDivs') || document.body;
  holder.append(panel);
  mounted.panel = panel;

  // Панель помнит, куда её перетащили. На узком экране — не помнит: там она
  // прибита к верху, и восстановленные координаты увели бы её за экран.
  const saved = safe(() => (host.getSettings() || {}).ui, {}) || {};
  if (Number.isFinite(saved.panelX) && Number.isFinite(saved.panelY) && window.innerWidth > 600) {
    panel.style.left = `${saved.panelX}px`;
    panel.style.top = `${saved.panelY}px`;
    panel.style.right = 'auto';
  }

  dragBy(panel.querySelector('.academy-grab'), panel, host, 'panel');
  swipeToClose(panel);
  outsideToClose(panel);

  renderPanel(host);
  return panelApi(host);
}

function panelApi(host) {
  return {
    open: () => openPanel(host),
    close: closePanel,
    toggle: () => (mounted.panel && mounted.panel.classList.contains('academy-open') ? closePanel() : openPanel(host)),
    render: () => renderPanel(host),
    destroy: () => {
      if (mounted.panel) mounted.panel.remove();
      if (mounted.button) mounted.button.remove();
      mounted.panel = null;
      mounted.button = null;
      // Панель снята со страницы — помнить, что в ней было раскрыто, больше не
      // о чем. Копия в меню расширений живёт отдельно и своей памяти не теряет.
      for (const k of [...sectionOpen.keys()]) if (k.startsWith('panel::')) sectionOpen.delete(k);
    },
  };
}

function openPanel(host) {
  if (!mounted.panel) return;
  mounted.panel.classList.add('academy-open');
  renderPanel(host || mounted.host);
}

function closePanel() {
  if (mounted.panel) mounted.panel.classList.remove('academy-open');
}

/**
 * Перерисовка. Вызывается и из index.js по событиям таверны, и изнутри после
 * любого действия. Падение отрисовки не должно оставлять пустую панель, поэтому
 * всё дерево строится в try и при ошибке заменяется текстом ошибки.
 */
export function renderPanel(host) {
  const h = host || mounted.host;
  if (!mounted.panel || !h) return;

  const preset = safe(() => h.getPreset(), null) || {};
  const settings = safe(() => h.getSettings(), null) || {};

  // Полоса вкладок собирается заново: набор зависит от галочки отладки, а
  // выбранная вкладка могла из этого набора исчезнуть — тогда возврат на
  // «Сегодня», иначе панель показывала бы разбор при выключенной отладке.
  const list = tabsFor(preset, settings);
  if (!list.some((t) => t.id === mounted.tab)) mounted.tab = 'today';
  const tabsBox = clear(mounted.panel.querySelector('.academy-tabs'));
  for (const t of list) {
    tabsBox.append(el('div', {
      class: t.id === mounted.tab ? 'academy-tab academy-tab-on' : 'academy-tab',
      dataset: { tab: t.id },
      text: t.label,
      onclick: () => { mounted.tab = t.id; renderPanel(h); },
    }));
  }

  const body = clear(mounted.panel.querySelector('.academy-body'));
  try {
    const state = safe(() => h.getState(), null);
    if (mounted.tab === 'gradebook') body.append(renderGradebook(h, gradebookView(state, preset), preset));
    else if (mounted.tab === 'people') body.append(renderPeople(h, peopleView(state, preset), preset));
    else if (mounted.tab === 'debug') {
      body.append(renderDebug(h, debugView(safe(() => h.getDebug(), null), state, preset, settings)));
    } else if (mounted.tab === 'settings') body.append(renderSettings(h));
    else body.append(renderToday(h, todayView(state, preset), preset));
  } catch (err) {
    body.append(el('div', { class: 'academy-empty' }, [
      el('div', { class: 'academy-empty-title', text: 'Панель не смогла отрисоваться' }),
      el('p', { class: 'academy-note', text: (err && err.message) ? err.message : String(err) }),
      el('div', {
        class: 'menu_button academy-btn',
        text: 'Открыть настройки',
        onclick: () => { mounted.tab = 'settings'; renderPanel(h); },
      }),
    ]));
  }
}

/* --- кнопка вызова -------------------------------------------------------- */

/**
 * Перетаскиваемая кнопка вызова (3.9). Порог `DRAG_THRESHOLD` отличает жест от
 * нажатия: без него кнопка срабатывает при каждой попытке пролистать чат.
 * Слушатели касаний пассивные; от прокрутки во время перетаскивания спасает
 * `touch-action: none` в `style.css`, а не `preventDefault`, который как раз и
 * потребовал бы активного слушателя.
 */
export function mountButton(host) {
  mounted.host = host;
  if (mounted.button && mounted.button.isConnected) return mounted.button;

  const button = el('div', {
    id: ID.button,
    class: 'academy-launcher',
    title: 'Академия',
    role: 'button',
    tabindex: '0',
  }, [el('span', { class: 'academy-launcher-mark', text: 'А' })]);

  // Сохранённые координаты зажимаются в текущее окно. Панель на узком экране
  // свои просто не восстанавливает (`window.innerWidth > 600`), а кнопке так
  // нельзя: она — единственный вход в панель, и точка, сохранённая на широком
  // мониторе, увела бы её за экран телефона насовсем — вернуть невидимую
  // кнопку нечем. Поймано стендом tools/preview: buttonX=1800 при окне 360.
  // 42 — ширина кнопки из style.css; спрашивать DOM до вставки в документ
  // бессмысленно, а ошибка в пару пикселей тут ничего не решает.
  const pos = safe(() => (host.getSettings() || {}).ui, {}) || {};
  if (Number.isFinite(pos.buttonX) && Number.isFinite(pos.buttonY)) {
    const size = 42;
    button.style.left = `${Math.min(Math.max(0, pos.buttonX), Math.max(0, window.innerWidth - size))}px`;
    button.style.top = `${Math.min(Math.max(0, pos.buttonY), Math.max(0, window.innerHeight - size))}px`;
    button.style.right = 'auto';
    button.style.bottom = 'auto';
  }

  document.body.append(button);
  mounted.button = button;

  dragBy(button, button, host, 'button', () => {
    if (!mounted.panel) mountPanel(host);
    mounted.panel.classList.contains('academy-open') ? closePanel() : openPanel(host);
  });
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { if (!mounted.panel) mountPanel(host); openPanel(host); }
  });
  return button;
}

/**
 * Общий перетаскиватель для кнопки и для панели. `onTap` вызывается, только
 * если палец сместился меньше чем на `DRAG_THRESHOLD` пикселей.
 */
function dragBy(handle, target, host, kind, onTap) {
  if (!handle || !target) return;
  let start = null;

  const point = (e) => (e.touches && e.touches[0]) || e;

  const begin = (e) => {
    const p = point(e);
    const rect = target.getBoundingClientRect();
    start = { x: p.clientX, y: p.clientY, left: rect.left, top: rect.top, moved: false };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', end, { passive: true });
    document.addEventListener('touchcancel', end, { passive: true });
  };

  const move = (e) => {
    if (!start) return;
    const p = point(e);
    const dx = p.clientX - start.x;
    const dy = p.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    start.moved = true;
    target.classList.add('academy-dragging');
    const w = target.offsetWidth;
    const h = target.offsetHeight;
    const left = Math.min(Math.max(0, start.left + dx), Math.max(0, window.innerWidth - w));
    const top = Math.min(Math.max(0, start.top + dy), Math.max(0, window.innerHeight - h));
    target.style.left = `${left}px`;
    target.style.top = `${top}px`;
    target.style.right = 'auto';
    target.style.bottom = 'auto';
  };

  const end = () => {
    document.removeEventListener('mousemove', move);
    document.removeEventListener('mouseup', end);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', end);
    document.removeEventListener('touchcancel', end);
    if (!start) return;
    target.classList.remove('academy-dragging');
    if (start.moved) {
      const rect = target.getBoundingClientRect();
      const patch = kind === 'button'
        ? { ui: { buttonX: Math.round(rect.left), buttonY: Math.round(rect.top) } }
        : { ui: { panelX: Math.round(rect.left), panelY: Math.round(rect.top) } };
      safe(() => host.setSettings(patch), null);
    } else if (typeof onTap === 'function') {
      onTap();
    }
    start = null;
  };

  handle.addEventListener('mousedown', begin);
  handle.addEventListener('touchstart', begin, { passive: true });
}

/** Свайп в сторону от панели закрывает её (3.9). Слушатели пассивные. */
function swipeToClose(panel) {
  let from = null;
  panel.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    from = { x: t.clientX, y: t.clientY, top: panel.scrollTop };
  }, { passive: true });
  panel.addEventListener('touchend', (e) => {
    if (!from) return;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    const body = panel.querySelector('.academy-body');
    const scrolled = body ? body.scrollTop : 0;
    if (t && scrolled <= 0 && from.y - t.clientY > 60 && Math.abs(t.clientX - from.x) < 40) closePanel();
    from = null;
  }, { passive: true });
}

/** Тап мимо панели закрывает её — но не тап по кнопке вызова (3.9). */
function outsideToClose(panel) {
  document.addEventListener('pointerdown', (e) => {
    if (!panel.classList.contains('academy-open')) return;
    if (panel.contains(e.target)) return;
    if (mounted.button && mounted.button.contains(e.target)) return;
    closePanel();
  });
}

/* --- блок в меню расширений ----------------------------------------------- */

/**
 * Блок в меню расширений: API, режим источника времени, галочки и кнопка,
 * открывающая панель. Полноценные настройки живут во вкладке панели — здесь
 * только то, что человек ищет в привычном месте.
 */
export function mountSettings(host) {
  mounted.host = host;
  const holder = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
  if (!holder) return null;
  if (mounted.settings && mounted.settings.isConnected) { renderSettingsBlock(host); return mounted.settings; }

  const block = el('div', { id: ID.settings, class: 'academy-ext-block' }, [
    el('div', { class: 'inline-drawer' }, [
      el('div', { class: 'inline-drawer-toggle inline-drawer-header' }, [
        el('b', { text: 'Академия' }),
        el('div', { class: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' }),
      ]),
      el('div', { class: 'inline-drawer-content academy-ext-content' }),
    ]),
  ]);
  holder.append(block);
  mounted.settings = block;

  // Раскрытие блока — штатное: таверна ловит клики по .inline-drawer-toggle
  // делегированно на document, так что наш узел подхватывается и без своего
  // обработчика. Свой второй обработчик отменял бы штатный: блок раскрывался
  // и тут же сворачивался обратно. Закрытым блок стартует, как штатные:
  // через style="display:none" на содержимом.
  block.querySelector('.inline-drawer-content').style.display = 'none';

  renderSettingsBlock(host);
  return block;
}

function renderSettingsBlock(host) {
  if (!mounted.settings) return;
  sectionScope = 'drawer';
  const content = clear(mounted.settings.querySelector('.inline-drawer-content'));
  const state = safe(() => host.getState(), null);
  const preset = safe(() => host.getPreset(), {}) || {};
  const settings = safe(() => host.getSettings(), {}) || {};
  const view = settingsView(state, settings, preset, hostExtra(host));

  content.append(el('div', { class: 'academy-row academy-row-buttons' }, [
    el('div', {
      class: 'menu_button academy-btn academy-btn-main',
      text: 'Открыть панель',
      onclick: () => { if (!mounted.panel) mountPanel(host); openPanel(host); },
    }),
  ]));
  // Пресет — настройка общая для всех чатов, и человек ищет такие в меню
  // расширений, а не в панели одного чата. Лорбук и выгрузка остались только в
  // панели: они про этот чат, а не про расширение.
  content.append(renderPresetBlock(host, view));
  content.append(renderApiBlock(host, view));
  content.append(renderModeBlock(host, view));
  content.append(renderDebugBlock(host, view));
}

export default { mountPanel, renderPanel, mountButton, mountSettings };

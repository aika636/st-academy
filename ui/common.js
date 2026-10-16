import { validateState } from '../core/state.mjs';
import { dayOfWeek, parseDay } from '../core/time.mjs';
import { plural } from '../core/plural.mjs';
import { presetGender } from '../core/gender.mjs';
import { CORE_LABELS } from '../core/core-labels.mjs';

export const DEFAULT_MAX_NUMBERS = 6;

const SECTION_ICONS = [
  [/анкет/i, 'fa-id-card'],
  [/дисциплин|предмет|учебн|расписан/i, 'fa-list-check'],
  [/пресет/i, 'fa-building-columns'],
  [/оформлен/i, 'fa-swatchbook'],
  [/api|генерац/i, 'fa-plug'],
  [/времен/i, 'fa-clock'],
  [/разбор|экзамен/i, 'fa-wand-magic-sparkles'],
  [/лорбук|книг[ауи]? мира/i, 'fa-book-atlas'],
  [/отладк|доктор/i, 'fa-bug'],
  [/выгруз|загруз|файл/i, 'fa-file-arrow-down'],
  [/вех|достижен|свершени|заслуг|нашивк|отличи|наград|значк|ежегодник/i, 'fa-trophy'],
  [/персонаж/i, 'fa-masks-theater'],
  [/травл/i, 'fa-user-injured'],
  [/звук/i, 'fa-bell'],
  [/ремонт|поправ/i, 'fa-screwdriver-wrench'],
  [/портрет/i, 'fa-palette'],
  [/начал|старт/i, 'fa-flag-checkered'],
  [/^(?:слух|поток|шёпот|шепот|пересуд|сплетн|болтов|эфир|кампус|казарм|лент)/i, 'fa-comments'],
  [/статист|сюжетик|дела массовки/i, 'fa-users'],
];

export function sectionIcon(title) {
  const hit = SECTION_ICONS.find(([re]) => re.test(String(title || '')));
  return hit ? hit[1] : 'fa-circle-dot';
}

export const WEEKDAYS = ['', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
const WEEKDAYS_SHORT = ['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const WEEKDAYS_GEN = ['', 'понедельника', 'вторника', 'среды', 'четверга', 'пятницы', 'субботы', 'воскресенья'];
const MONTHS = ['', 'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

export const DEFAULT_UI = {
  week: '{n}-я неделя',
  weekBefore: 'семестр ещё не начался',
  weekBreak: 'перерыв между семестрами',
  termLine: '{name}',
  termNumber: '{n}-й семестр',
  phases: {
    study: 'учебный день', weekend: 'выходной', vacation: 'каникулы',
    break: 'между семестрами', exams: 'сессия',
    preExams: 'последняя неделя перед экзаменами',
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
  beforeTitle: 'Первая пара',
  nextCardTitle: 'Дальше',
  slot: '{ordinal}-я пара',
  slotTime: '{ordinal}-я пара, {start}–{end}',
  nextSoon: 'сегодня, следующей парой',
  nextToday: 'сегодня, {start}',
  nextDay: '{date}, {start}',
  nextDayNoTime: '{date}',
  noNext: 'Следующей пары в расписании пока нет.',
  dayTitle: 'День целиком',
  shiftPeriod: '+1 пара',
  skipToEnd: 'До конца пар',

  jumpTitle: 'В ответе другая дата',
  jumpLine: 'В ответе — {date}, в календаре — {from}. Принять новую дату?',
  jumpNote: 'Так бывает и в отыгрыше (сон, отъезд), и по ошибке — когда время печатает соседнее расширение. Пропущенные за скачок занятия засчитаются как посещённые, если прыжок принять.',
  jumpAccept: 'Перейти на {date}',
  jumpAcceptNoDate: 'Перейти на этот день',
  jumpDismiss: 'Оставить как было',
  jumpWaiting: 'ждёт перехода на {date}',
  jumpSkipped: 'За эти дни: {list}.',
  jumpSkipMore: 'и ещё {n}',
  jumpSkipExam: '{kind} по {subject}',
  jumpSkipSession: '{examPeriod}',
  jumpAccepted: 'Время переведено.',
  jumpAcceptedMissed: 'Пропущено {days} {plural}: {count} {unit} {done}.',
  jumpAcceptedNone: 'Пропущено {days} {plural}: занятий не было.',
  jumpUnits: 'занятие|занятия|занятий',
  jumpDone: 'засчитано|засчитано|засчитано',
  jumpDismissed: 'Прыжок отклонён, календарь на месте.',
  eraTitle: 'В ответе другой год',
  eraLine: 'В ответе — {year} год, в календаре — {from} год. Перенести календарь?',
  eraNote: 'Даты в чате поедут на ту же разницу лет, число и месяц останутся. Если год попал в ответ по ошибке (чужой инфоблок), оставьте как было.',
  eraAccept: 'Перенести на {year} год',
  eraAccepted: 'Календарь перенесён.',

  scoreLine: '{scoreName}: {value}',
  scoreHint: 'Средний балл по всем предметам',
  debtsLine: '{debtPlural}: {count}',
  subjectsLine: 'предметов: {count}',
  examsLine: 'несдано в {examPeriod}: {count}',
  examsTerm: 'сессия: {name}',
  debtsTitle: 'Хвосты',
  rowDebt: 'Хвост по предмету: {subject}',
  rowDebtClosed: 'Хвост закрыт: {subject}',
  rowJump: 'Пропущено пар: {count}',
  rowExamMissed: 'Не сдано к концу сессии: {subject}',
  rowReputation: 'Репутация: {from} → {to}',
  examRuleStoryHint: 'исход тот, что случился в сцене; не сыгранное к концу сессии — остаётся долгом',
  openExamsTitle: 'Несданные контрольные',
  debtTag: 'хвост',
  passedTag: 'сдано',
  ongoingTag: 'идёт',
  expelledTag: 'отчислена',
  warnedTag: 'предупреждение',
  reputationTitle: 'Репутация',
  expelledLine: 'Отчислена.',
  warnedLine: 'Есть предупреждение.',
  noSubjects: 'Предметов нет. Заполните таблицу в настройках.',
  noGrades: 'оценок пока нет',
  scoreNoneLine: 'Среднего балла ещё нет',
  noGradesAll: 'Оценок ещё нет ни по одному предмету.',

  notStartedTitle: 'Семестр не начат',
  openSurvey: 'Открыть анкету',
  goToStart: 'Открыть «{section}»',
  openSettings: 'Открыть настройки',
  noStateText: 'Заполните анкету и нажмите «Начать семестр».',
  notStartedWithPlan: 'Учебный план уже есть. Осталось нажать «Начать семестр».',
  notStartedNoPlan: 'Заполните анкету и сгенерируйте учебный план.',
  brokenTitle: 'Состояние повреждено',
  brokenText: 'Расширение не берётся показывать семестр, который не сходится сам с собой. '
    + 'Проверьте список ниже; таблицу предметов можно поправить вручную в настройках.',

  peopleCountLine: 'преподавателей: {count}',
  peopleNone: 'Преподавателей нет. Добавьте их в настройках.',
  traitsNone: 'черты не заданы',
  subjectsNone: 'предметов не ведёт',
  relationTitle: 'Отношение',
  relationHistoryTitle: 'Запомнилось',
  relationHistoryCount: '{title}: {n} {word}',
  relationNoHistory: 'отношение ещё не менялось',
  relationShift: '{from} → {to}',
  orphanSubjectsTitle: 'Предметы без преподавателя',
  teachersTitle: 'Преподаватели',
  classmatesTitle: 'Курс',
  mesRelSection: 'Отношения',
  classmatesNone: 'Однокурсников пока нет. Добавьте человека руками — или расширение само предложит тех, кого заметит в сцене.',

  tabToday: 'Сегодня',
  tabGradebook: 'Зачётка',
  tabPeople: 'Люди',
  tabAchievements: 'Достижения',
  tabFeed: 'Слухи',
  tabSettings: 'Настройки',

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
  startNote: 'Расписание соберётся из списка выше по правилам пресета.',
  startDayField: 'Первый учебный день',
  repairCount: 'Записать пропущенные пары посещёнными',
  repairCountNote: 'По умолчанию ручной сдвиг посещаемость не трогает: ремонт календаря не наказывает за день, которого не играли. С галочкой пропущенные пары запишутся как посещённые, как при обычной промотке. Прогулом они не станут. Галочка действует и на кнопки «+1», и остаётся, пока открыта панель.',
  shiftedTo: 'Теперь: {when}.',
  repairCounted: 'Занятий засчитано посещёнными: {count}.',
  repairNotCounted: 'Посещаемость не записывалась: пар за сдвиг — {count}.',
  cmdCounted: 'Пар записано посещёнными: {count}.',
  cmdNotCounted: 'Посещаемость не записывалась: пар за сдвиг — {count}. Нужно записать — добавьте count=yes.',
  cmdReputationMoved: 'Репутация: {from} → {to}.',
  startDayFromChat: 'Дата взята из чата: в нём уже написан год ({matched}). Так календарь не разойдётся с тем, что печатают соседние расширения.',
  startDayFromPreset: 'Дата — начало учебного года из пресета в нынешнем году по часам компьютера. Если в сюжете называют дату из года, который отстоит от этого на два года и больше, календарь переедет в её год сам: сразу, пока в игре ничего не произошло, а позже — когда два ответа подряд назовут такой далёкий год. В остальных случаях год сам не меняется — поправьте его здесь.',
  blockNoSubjects: 'нет ни одного предмета',
  blockBadTable: 'таблица предметов не сходится',
  blockStarted: 'семестр уже начат',

  errTeacherName: 'У преподавателя нет имени.',
  errTeacherDup: '«{name}» слишком похоже на уже записанное имя: назовите иначе.',
  errSubjectName: 'У предмета нет названия.',
  errSubjectId: 'Название «{name}» не подходит: используйте буквы, цифры и дефис.',
  errSubjectDup: '«{name}» слишком похоже на уже записанное название: назовите иначе.',
  errSubjectTeacher: 'Предмет «{name}» ссылается на преподавателя, которого нет в списке.',
  errManyTeachers: 'Преподавателей {count}, потолок {max}.',
  errManySubjects: 'Предметов {count}, потолок {max}.',
  errNoSubjects: 'Ни одного предмета: семестр начать не из чего.',
  noteNoTraits: '{name}: не задано ни одной черты характера — из чего расти конфликту.',
  noteNoTeacher: 'У предмета «{name}» нет преподавателя — отношения по нему считать не с кем.',

  surveySection: 'Анкета',
  surveyFacultyLabel: 'Направление / факультет',
  surveyFacultyHint: 'медицинский, филфак, боевая магия',
  surveyYearLabel: 'Курс / год',
  surveyYearHint: '2-й',
  surveyNote: 'Поля заполняются один раз. Модель их не меняет — только дополняет пустые.',
  surveyGuess: 'Заполнить по карточке персонажа',
  surveyGuessNote: 'Модель прочитает карточку и первое сообщение и предположит, где учится героиня. '
    + 'Предположение попадёт в поля выше — посмотрите и поправьте. В игру само не уйдёт ничего.',
  surveyGuessOk: 'Поля заполнены предположением. Проверьте их.',
  surveyGuessEmpty: 'Заполнить не удалось ничего: в карточке не нашлось ни одной подсказки. Впишите вручную.',
  surveyGuessPartly: 'Заполнено полей: {count}. Пустые — не ошибка, впишите их вручную.',

  presetSection: 'Пресет заведения',
  presetNote: 'Слова, шкала оценок и виды контрольных берутся отсюда. Предметы, преподаватели и оценки от пресета не зависят: они хранятся в самом семестре.',
  presetChange: 'Сменить пресет',
  presetChanged: 'Пресет сменён.',
  presetSameNote: 'Этот пресет уже выбран.',
  presetDrift: 'Семестр в этом чате собран пресетом «{stateId}», а сейчас активен «{activeId}».',

  transferSection: 'Выгрузка и загрузка',
  transferNote: 'Состояние семестра одним файлом: перенести в другой чат, сохранить до починки, отдать другому человеку. Ключ API в файл не попадает.',
  exportButton: 'Скачать состояние',
  exportOk: 'Файл {filename} отдан браузеру.',
  importPick: 'Загрузить состояние из файла',
  importButton: 'Выбрать файл',
  importOk: 'Состояние загружено.',
  importConfirmTitle: 'Заменить то, что есть?',
  importConfirmYes: 'Да, заменить',
  importConfirmNo: 'Отмена',
  importCancelled: 'Отменено, ничего не тронуто.',
  summaryCurrent: 'Сейчас в чате',
  summaryIncoming: 'Приедет из файла',
  summaryNothing: 'пусто',
  summaryLine: 'день {day}, предметов {subjects}, оценок {grades}',
  summaryNotStarted: 'не начат',

  importOccupiedStarted: 'в этом чате уже идёт семестр ({subjects} предметов, день {day}) — он пропадёт без следа',
  importOccupiedEmpty: 'в этом чате уже есть состояние вуза — оно будет заменено',
  presetMismatch: 'состояние собрано с пресетом «{from}», сейчас активен «{to}».'
    + ' Предметы, преподаватели и оценки приедут как есть — они лежат в состоянии;'
    + ' а названия периодов, шкала оценок и виды контрольных возьмутся из активного пресета,'
    + ' поэтому знакомые вещи могут называться иначе',

  lorebookSection: 'Книга мира академии',
  lorebookToggle: 'Вести книгу мира академии',
  lorebookNote: 'Черты преподавателей и однокурсников, места и хроника уходят в книгу мира (World Info), где запись подгружается по ключу, а не висит в промпте постоянно. Выключено по умолчанию: чужую книгу мира расширение своими записями не засоряет.',
  lorebookBound: 'Книга мира «{name}» привязана к этому чату.',
  lorebookNoName: 'Книга мира ещё не заведена: она появится с первым ответом модели.',
  lorebookBookField: 'Имя книги мира',
  lorebookBookHint: 'пусто — по имени чата',
  lorebookMeasure: 'Записей {entries} из {cap}, примерно {tokens} токенов.',
  lorebookOverCap: 'Записей больше потолка: книга мира начнёт вытеснять из контекста всё остальное. Уберите лишние средствами таверны.',
  lorebookRefresh: 'Обновить книгу мира',
  lorebookRefreshOk: 'Книга мира обновлена.',
  lorebookSuggestTitle: 'Предложенные записи',
  lorebookSuggestNote: 'Расширение может только предложить запись про человека или место, а не сочинить её само. В книгу мира она уйдёт по нажатию.',
  lorebookAccept: 'Добавить',
  lorebookAcceptOk: 'Запись добавлена в книгу мира.',
  lorebookNoSuggest: 'Предложений нет.',
  lorebookNewTitle: 'Предложить запись',
  lorebookNewName: 'Имя или название',
  lorebookNewNote: 'Заметка',
  lorebookNewNameHint: 'Маша Лебедева',
  lorebookNewNoteHint: 'соседка по комнате, рисует комиксы',
  lorebookKindPeople: 'человек',
  lorebookKindPlaces: 'место',
  lorebookNewButton: 'Предложить',
  lorebookNewOk: 'Предложено. В книгу мира уйдёт по кнопке «Добавить».',
  lorebookOrphansTitle: 'Осиротевшие после свайпов',
  lorebookOrphansNote: 'Записи про то, чего в нынешнем состоянии больше нет. Расширение их не стирает само: своё вы бы потеряли вместе с ними.',
  lorebookPrune: 'Убрать осиротевшие ({count})',
  lorebookPruned: 'Убрано записей: {count}.',
  lorebookOff: 'Книга мира выключена.',
  lorebookNoWorldInfo: 'Эта сборка таверны не отдаёт книгу мира (World Info) расширениям, поэтому записей не будет. Всё остальное работает.',
  lorebookNoChat: 'Книга мира привязывается к чату, а чат ещё не сохранён. Она заведётся с первым сообщением.',
  lorebookNoState: 'Книга мира заведётся, когда начнётся семестр.',
  lorebookError: 'Книга мира не обновилась: {error}',

  cmdPlanTitle: 'Пары дня:',
  cmdNoPlan: 'Пар сегодня нет.',
  cmdNext: 'Дальше: {name} — {when}',
  cmdNoSubjects: 'Предметов в плане нет.',
  cmdAverage: 'среднее {value}',
  cmdShiftPeriods: 'сдвиг в парах, можно отрицательный',
  cmdTimeHelp: 'Ручной ремонт календаря. <code>/academy-time day=ГГГГ-ММ-ДД</code>, '
    + '<code>/academy-time days=1</code>, <code>/academy-time periods=-2</code>. '
    + '<code>/academy-time days=1 count=yes</code> — записать пропущенное посещённым. '
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

export function uiLabels(preset) {
  const own = (preset && preset.ui) || {};
  return { ...DEFAULT_UI, ...(presetGender(preset) === 'm' ? MALE_UI : {}), ...own, phases: { ...DEFAULT_UI.phases, ...(own.phases || {}) } };
}

export const MALE_UI = {
  surveyGuessNote: 'Модель прочитает карточку и первое сообщение и предположит, где учится герой. '
    + 'Предположение попадёт в поля выше — посмотрите и поправьте. В игру само не уйдёт ничего.',
};

export function expelledPhrase(state, preset, heroine = '') {
  if (!(state && state.reputation && state.reputation.expelled)) return '';
  const tag = String(uiLabels(preset).expelledTag || '').trim();
  const name = String(heroine || '').trim();
  return name ? `${name} ${tag}` : tag.charAt(0).toUpperCase() + tag.slice(1);
}

export function bookTitle(name) {
  const t = String(name || '').replace(/\.(?:json|png)$/i, '')
    .replace(/^(?:main|world|lore|book)[_-]/i, '')
    .replace(/[_-]?world[_ -]?inf[oо]$/i, '')
    .replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return t || String(name || '').trim();
}

export function loreLinkText(X, link) {
  if (!link) return '';
  const book = bookTitle(link.book);
  return link.name ? fill(X.loreLinkedEntry, { name: link.name, book }) : fill(X.loreLinked, { book });
}

export function fill(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export const SOURCE_LABEL = { 'A+': 'время из другого расширения', A: 'из контекста', B: 'метка', manual: 'вручную' };

export const TIME_VIA = { 'A+': 'время взято у другого расширения', A: 'время взято из текста ответа', B: 'по метке Академии', manual: 'вручную' };

export const TIME_VIA_LAST = {
  'A+': 'Время взято у другого расширения в последнем ответе.',
  A: 'Время взято из последнего ответа.',
  B: 'Время сдвинуто меткой Академии в последнем ответе.',
};

export function stateHealth(state, preset) {
  const U = uiLabels(preset);
  if (!state || typeof state !== 'object') {
    return {
      kind: 'no-state',
      title: U.notStartedTitle,
      text: U.noStateText,
      action: { id: 'open-settings', label: U.openSurvey },
      errors: [],
    };
  }

  if (state.started !== true) {
    const hasPlan = Array.isArray(state.subjects) && state.subjects.length > 0;
    return {
      kind: 'not-started',
      title: U.notStartedTitle,
      text: hasPlan ? U.notStartedWithPlan : U.notStartedNoPlan,
      action: hasPlan
        ? { id: 'open-start', label: fill(U.goToStart, { section: U.startSection }) }
        : { id: 'open-settings', label: U.openSurvey },
      errors: [],
    };
  }

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
      action: { id: 'open-settings', label: U.openSettings },
      errors: check.errors,
    };
  }

  return { kind: 'ok', title: '', text: '', action: null, errors: [] };
}

let dateShift = 0;
export function setDateShift(k) {
  dateShift = Number.isInteger(k) ? ((k % 7) + 7) % 7 : 0;
}

export function formatDate(day, form = 'full', shift = dateShift) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
  const { m, d } = parseDay(day);
  const names = form === 'short' ? WEEKDAYS_SHORT : form === 'gen' ? WEEKDAYS_GEN : WEEKDAYS;
  return `${names[dayOfWeek(day, shift)]}, ${d} ${MONTHS[m] || ''}`.trim();
}

export function formatDateOn(day, form = 'full', shift = dateShift) {
  const f = formatDate(day, form, shift);
  const on = { понедельник: 'в понедельник', вторник: 'во вторник', среда: 'в среду', четверг: 'в четверг', пятница: 'в пятницу', суббота: 'в субботу', воскресенье: 'в воскресенье' };
  const word = f.split(',')[0];
  return on[word] ? f.replace(word, on[word]) : f;
}

export function formatWeek(n, preset, scope) {
  const U = uiLabels(preset);
  if (scope === 'between' || scope === 'after') return U.weekBreak;
  if (!Number.isFinite(n)) return '';
  return n < 1 ? U.weekBefore : fill(U.week, { n });
}

export function termTitle(term, U) {
  if (!term) return '';
  return term.name ? fill(U.termLine, { name: term.name }) : fill(U.termNumber, { n: term.index + 1 });
}

export function formatScore(value) {
  return Number.isFinite(value) ? value.toFixed(1).replace('.', ',') : '—';
}

export function capNumbers(list, preset) {
  const max = (preset && preset.limits && preset.limits.maxNumbersInPrompt) || DEFAULT_MAX_NUMBERS;
  const out = (list || []).filter((n) => n && n.text);
  return { shown: out.slice(0, max), dropped: out.slice(max), max };
}

export const countNumbers = (view) => (view && view.numbers ? view.numbers.length : 0);

export const PRESET_TEXT = {
  pickField: 'Какой пресет включить',
  exportButton: 'Скачать пресет',
  exportOk: 'Файл {filename} отдан браузеру.',
  exportNote: 'Встроенный пресет выгружается как основа для своего: поправьте файл и загрузите обратно — он ляжет рядом, а не вместо.',
  importPick: 'Загрузить пресет из файла',
  importButton: 'Выбрать файл',
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
  switchTitle: 'Сменить пресет на «{to}»?',
  switchNote: 'Предметы, {teachers} и оценки останутся. Но слова, устав, шкала оценок, словарь, контрольные и звонки этого чата станут другими — из нового пресета, часы встанут по его сетке. Чтобы только поглядеть на оформление, выберите «Только посмотреть оформление»: чат останется на прежнем пресете.',
  switchYes: 'Сменить пресет этого чата',
  switchView: 'Только посмотреть оформление',
  viewBar: 'Просмотр оформления: {to}',
  viewBack: 'Вернуться',
  viewNote: 'Оформление «{to}» — только просмотр: чат остаётся на своём пресете и вернётся к нему со следующим ходом или при перезагрузке чата.',
  switchNo: 'Отмена',
  deleteMissing: 'Пресета «{id}» среди своих нет.',
  deleteActive: 'Пресет «{name}» сейчас активен, и учёба в этом чате идёт по нему. После удаления включится встроенный «{fallback}»: часы встанут по его звонкам, слова и шкала станут его',
  deletedFallback: 'Пресет «{name}» удалён — включён встроенный «{fallback}».',
  startFallback: 'Выбранный пресет «{id}» {why} — включён встроенный «{fallback}».',
  whyMissing: 'больше не найден',
  whyBroken: 'не прошёл проверку ({error})',
  stateGone: 'Этот чат заведён пресетом «{id}», которого больше нет. Играет активный «{active}»; загрузите тот пресет обратно, если он сохранился файлом.',
  userMark: 'свой',
};

export { plural };

const HISTORY_WORDS = ['случай', 'случая', 'случаев'];

export function historyCountText(U, n) {
  return fill(U.relationHistoryCount, { title: U.relationHistoryTitle, n, word: plural(n, ...HISTORY_WORDS) });
}

export const str = (v) => (v == null ? '' : String(v)).trim();

export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

export const EXTRA_UI = {
  startDayFromSurvey: 'Год ({matched}) взят из анкеты — эпохи или фандома, день и месяц — начало учебного периода из пресета. Поправьте дату, если сюжет начинается иначе.',
  ongoingHint: 'Оценки в порядке, но итог ещё не подведён.',
  lorebookStateOk: 'Книга мира обновлена',
  lorebookStateWait: 'Книга мира ждёт: идёт пересборка, перевод или повтор после сбоя.',
  lorebookStateError: 'Книга мира: ошибка последней записи — {error}',
  lorebookWasAdded: 'добавлено',
  lorebookWasUpdated: 'обновлены',
  lorebookWasRemoved: 'убрано',
  lorebookMore: 'и ещё {n}',
  lorebookChanges: 'Что изменилось',
  lorebookChangesNone: 'Записи с прошлой синхронизации не менялись.',
  lorebookRowAdded: 'добавлена',
  lorebookRowUpdated: 'обновлена',
  lorebookRowRemoved: 'удалена',
  lorebookRowOrphan: 'предложена к удалению',
  surveyGender: 'Обращение',
  surveyGenderHint: 'Определяет местоимения и окончания в текстах',
  surveyGenderF: 'Она',
  surveyGenderM: 'Он',
  milestonesTitle: 'Достижения',
  milestonesNone: 'Достижений пока нет.',
  milestoneNoDate: '—',
  milestoneToastTitle: 'Достижение',
  achEarnedTitle: 'В этой истории',
  achEarnedCount: 'получено {got} из {total}',
  achEarnedNone: 'Пока ничего — всё впереди.',
  achCatalogTitle: 'Все достижения',
  achSecretName: '???',
  achSecretHint: 'Скрыто: откроется, когда случится.',
  achSecretMark: 'тайное',
  achGlobalTitle: 'Во всех историях',
  achGlobalLine: 'историй: {n}',
  achGlobalNone: 'Ни в одной истории пока ничего не получено.',
  achGlobalNote: 'Счёт общий для всех чатов. Достижение, которое забрал свайп, здесь остаётся: в этой истории оно уже случалось.',
  achFamLove: 'Романтика',
  achFamChaos: 'Хаос и нарушения',
  achFamFame: 'Слава и слухи',
  achFamPeople: 'Дружба и вражда',
  achFamStudy: 'Учёба',
  achFamEvents: 'Праздники',
  achFamShame: 'Позор и тайны',
  achFamMoments: 'Моменты этой истории',
  achRarityCommon: 'обычная',
  achRarityRare: 'редкая',
  achRarityEpic: 'эпическая',
  achRarityLegendary: 'легендарная',
  achOff: 'Достижения выключены в настройках.',
  achShelfCount: '{got}/{total}',
  achGot: 'Получено',
  achSecretMore: 'Ещё {n} {word}',
  achSecretWordOne: 'тайное',
  achSecretWordMany: 'тайных',
  holidaysTitle: 'Праздники и события',
  holidayNowLine: 'сегодня',
  holidayInDays: 'через {n} {days} — {date}',
  holidayDayForms: ['день', 'дня', 'дней'],
  holidayTomorrow: 'завтра',
  holidayOwnMark: '✎',
  holidayOwnTitle: 'ваше событие',
  holidayOffUntil: CORE_LABELS.holidayOffUntil,
  holidayOffMark: CORE_LABELS.holidayOffMark,
  eventsSummary: 'Своё событие',
  eventsNote: 'Событие вне календаря: вечеринка, концерт, свидание. За несколько дней до него в сцене слышен фон, в сам день модель получает повод. «Занятий нет» делает его каникулами.',
  eventOff: CORE_LABELS.eventOff,
  mesPauseSection: CORE_LABELS.mesPauseSection,
  eventName: 'Название',
  eventNamePlaceholder: 'вечеринка в субботу',
  eventFrom: 'С какого дня',
  eventTo: 'По какой день',
  eventBuzz: 'Что говорят до события (необязательно)',
  eventBuzzPlaceholder: 'все спорят, кого позовут',
  eventBuzzNear: 'Накануне (необязательно)',
  eventBuzzNearPlaceholder: 'списки сверяют, всё почти готово',
  eventHook: 'Что подкинуть в сам день (необязательно)',
  eventHookPlaceholder: CORE_LABELS.eventHookPlaceholder,
  eventAdd: 'Добавить',
  eventAdded: 'Событие добавлено.',
  eventRemove: 'Убрать',
  eventRemoved: 'Событие убрано.',
  eventsListTitle: 'Свои события',
  eventPast: 'прошло',
  eventAuto: 'записано секретарём',
  soundSection: 'Достижения',
  achToggle: 'Искать достижения в сюжете: секретарь отмечает поступки героини, приходят всплывашки, работает вкладка',
  achToggleNote: 'Выключено — секретарь не ищет достижения, всплывашек нет, а вкладка показывает одну строку. Уже полученное остаётся в истории.',
  soundToggle: 'Короткий звук, когда появляется новое достижение',
  soundNote: 'Звук синтезируется браузером, без файлов. Выключено по умолчанию: расширение не шумит, пока его об этом не попросили. Всплывашка с названием достижения приходит и без звука.',
  soundTry: 'Послушать',
  soundTried: 'Если звука не было — браузер ещё не разрешил странице звук: нажмите в чате что-нибудь и попробуйте снова.',

  castSection: 'Персонаж карточки',
  castNote: 'Кого играет бот. Название карточки «{title}» — не всегда имя. Персонажа бота не предложат в «{course}» и не сделают статистом ленты.',
  castHint: 'Через запятую — другие написания того же имени: полное, на латинице, уменьшительное.',
  castAuto: 'Найдено в тексте карточки — проверьте и сохраните.',
  castModel: 'Нашла модель — проверьте и сохраните.',
  castEmpty: 'Имя персонажа не найдено. Впишите его или нажмите «Найти в карточке».',
  castGroup: 'Групповой чат: имена всех участников группы расширение знает и так.',
  castNone: 'Карточка не выбрана.',
  castRoleMain: 'персонаж бота',
  castRoleNpc: 'обычный человек',
  castNamePlaceholder: 'Имя, другие написания',
  castAdd: 'Добавить',
  castRemove: 'Убрать',
  castGuess: 'Найти в карточке',
  castGuessOk: 'Готово — проверьте список.',
  loreFind: 'Найти людей в книгах мира',
  loreNone: 'Людей в книгах мира не нашлось.',
  canonNone: 'Новых однокурсников из канона не нашлось.',
  loreFindOk: 'Готово.',
  loreLinkedDone: 'Привязано к записям книги игрока: {n}.',
  loreLinked: 'Связан с записью книги игрока «{book}»',
  loreLinkedEntry: 'Связан с записью «{name}» книги игрока «{book}»',
  loreUnlink: 'Отвязать',
  loreUnlinkHint: 'Снять привязку: в книге мира Академии снова будет полная запись этого человека.',
  canonFind: 'Найти однокурсников в каноне',
  canonFindOk: 'Готово.',
  loreFound: 'Нашлись: {n} {word}',
  loreWords: ['человек', 'человека', 'человек'],
  loreOther: 'вне заведения',
  loreInto: '→ {part}',
  loreSkip: 'Не надо',
  loreLater: 'Пока не решать',
  loreMarkAll: 'Отметить всех по ролям',
  loreApply: 'Применить',
  loreApplied: 'Готово.',
  loreNotApplied: 'Не применён: {reason}.',
  loreApplyPartly: 'Применено: {done}, не применено: {n} — причина под именем.',
  loreClear: 'Очистить найденных',
  cmClearAll: 'Убрать всех однокурсников',
  cmClearSure: 'Точно убрать всех? Нажмите ещё раз',
  cmCleared: 'Курс пуст — можно подбирать заново.',
  planClear: 'Очистить',
  castSave: 'Сохранить',
  castSaved: 'Сохранено.',
  castHit: 'Похоже, это персонаж карточки, а не человек из списка «{course}». Убрать?',
  castHitRemove: 'Убрать',

  molvaWhen: 'Когда обновлять слухи',
  molvaEvery: 'Ответов между обновлениями слухов:',
  molvaManual: 'Только по кнопке «Обновить слухи»',
  molvaPrice: 'Каждое обновление — отдельный запрос к модели после ответа. Каждый ответ — вдвое больше запросов, раз в 3–5 ответов заметно дешевле, а ветки выходят полнее.',
  molvaSwear: 'Ругань в чате:',
  molvaSwearOff: 'без мата',
  molvaSwearMild: 'мягко',
  molvaSwearFree: 'свободно',
  molvaManualNote: 'Пропущенные обновления потом не догоняются; кнопка работает всегда.',
  molvaButton: 'Обновить слухи',
  molvaDone: 'Новые слухи: {posts} {postsWord}, {replies} {repliesWord}.',
  molvaPostForms: ['пост', 'поста', 'постов'],
  molvaReplyForms: ['ответ', 'ответа', 'ответов'],
  molvaDoneSkipped: ' Часть реплик отброшена.',
  molvaQuiet: 'В чате тихо: никто ничего не написал.',
  molvaBusyText: 'Пишут…',

  mobSection: 'Статисты и дела массовки',
  mobNote: 'Постоянные ученики, которые пишут в ленту: у каждого свой интерес, цель и то, как пишет, у каждого есть друг и недруг среди своих же. Героиня им не указ — у них свои дела. Состав постоянный: новые статисты сами не появляются.',
  mobEmpty: 'Статистов пока нет — нажмите «Пересобрать каст», чтобы собрать их.',
  mobNick: 'Ник',
  mobType: 'Типаж',
  mobInterest: 'Интерес',
  mobGoal: 'Цель',
  mobManner: 'Как пишет',
  mobMannerHint: 'коротко, строчными, без точек; 💀 и 😭; на всех огрызается',
  mobFriend: 'дружит с {name}',
  mobFoe: 'враждует с {name}',
  mobRebuild: 'Пересобрать каст',
  mobBuilt: 'Каст собран.',
  mobRebuildNote: 'Пересборка соберёт статистов заново: ручные правки и дела прежнего каста пропадут.',
  mobSaved: 'Сохранено.',
  mobWarn: 'Проверьте: {text}',
  mobThreadsTitle: 'Дела массовки',
  mobThreadsNone: 'Дел пока нет — они заведутся сами, когда слухи пойдут.',
  mobThreadWant: 'хотят: {text}',
  mobThreadLast: 'последнее: {text}',
  mobThreadPaused: 'отложено',
  mobThreadSource: { calendar: 'из календаря', study: 'из учёбы', cast: 'из жизни статистов' },
  mobThreadWho: 'участвуют: {names}',
  mobThreadRoom: 'Идёт {n} из {max}.',

  weekHint: '',

  checkLine: '{subject}: {kind} — {value}',
  checkLineSame: '{subject}: {kind} сдан',
  checkRoll: 'бросок {roll} против порога {dc} — {tier}',
  checkAuto: 'без броска: балл не ниже порога',
  checkSaved: 'спасла страховка балла',
  checkCapped: 'высшую ниже проходного балла не ставят',
  checkOverride: 'в тексте ответа — {said}, принята версия ответа',
  checkPending: 'мир узнает {date}',
  checkTiers: { critSuccess: 'блестяще', success: 'успех', fail: 'провал', critFail: 'полный провал' },

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
  photoTitle: 'Фото',
  photoPick: 'Выбрать фото',
  photoRemove: 'Убрать фото',
  photoLink: 'или ссылка',
  photoMore: 'Ещё: нарисовать, ссылка',
  photoSaved: 'Фото на месте.',
  photoRemoved: 'Фото убрано.',
  photoNone: 'Пока без фото — в кружке инициалы.',
  photoNote: 'С телефона откроется галерея или камера. Фото уменьшится до 512 точек и ляжет в папку таверны.',
  drawButton: 'Нарисовать',
  drawBusy: 'Рисую…',
  drawCancel: 'Отмена',
  drawCancelled: 'Рисование отменено.',
  drawKeep: 'Оставить',
  drawAgain: 'Ещё раз',
  drawDrop: 'Не надо',
  drawKept: 'Портрет на месте.',
  drawDropped: 'Старое фото осталось как было.',
  drawPreviewNote: 'Вот что получилось. Старое фото останется, пока не нажмёте «Оставить».',
  drawBusyNote: 'Рисует {route}. Обычно 10–60 секунд.',
  drawNoRoute: 'Чтобы рисовать портреты, подключите генерацию картинок в таверне (NovelAI, OpenAI, Gemini или OpenRouter) или выберите «Свой адрес с ключом».',
  looksField: 'Своё описание внешности (необязательно)',
  looksHint: CORE_LABELS.looksHint,
  looksSave: 'Запомнить',
  looksSaved: 'Описание внешности запомнено — пойдёт в рисунок.',
  looksCleared: 'Описание внешности убрано.',
  drawSection: 'Портреты',
  drawRouteField: 'Чем рисовать',
  drawModelField: 'Модель',
  drawStyleField: 'Стиль',
  drawSizeField: 'Размер NovelAI',
  drawStyles: { anime: 'аниме', realism: 'реализм', watercolor: 'акварель', own: 'свой' },
  drawStyleTextField: 'Свой стиль',
  drawStyleTextHint: 'например: oil painting, dramatic lighting, 90s anime',
  drawStyleTextNote: 'Слова идут в описание картинки как есть. Для NovelAI — английскими тегами через запятую: русские слова он не поймёт и они отбросятся.',
  drawSizes: { portrait: 'портрет 832×1216', square: 'квадрат 1024×1024' },
  drawTavernNote: 'Источник, модель, префикс и негатив — из настроек «Генерация изображений» таверны. Академия их не меняет.',
  drawPrice: 'Цена: рисует только по кнопке; у GPT и Nano Banana каждая картинка платная у провайдера.',
  drawKeysNote: 'Ключи берутся из таверны (её подключения API) — в Академию их вводить не нужно, и с телефона тоже.',
  drawCustomMode: 'Режим',
  drawCustomEndpoint: 'Адрес',
  drawCustomEndpointHint: 'Пусто — адрес по умолчанию.',
  drawCustomKey: 'Ключ',
  drawCustomNaiKey: 'Токен NovelAI (Persistent API Token из настроек аккаунта NovelAI)',
  drawCustomModel: 'Модель',
  drawCustomLoad: 'Загрузить список моделей',
  drawCustomLoaded: 'Моделей: {n}. Выберите в подсказках под полем «Модель».',
  drawCustomNone: 'Подходящих моделей в списке нет — впишите имя модели руками.',
  drawCustomNote: 'Ключ лежит в настройках таверны открытым текстом и попадает в их экспорт. Никуда, кроме указанного адреса, он не уходит.',
  detailsTitle: 'Править',
  detailsSave: 'Сохранить',
  detailsSaved: 'Сохранено.',

  postField: 'Должность',
  postHint: 'чем занимается',
  likesField: 'Что любит',
  likesHint: 'что любит',
  secretField: 'Тайна',
  secretHint: 'то, чего героиня не знает',
  traitsField: 'Черты (через запятую)',
  likesLine: 'любит: {likes}',
  canonBadge: 'канон',
  canonWordsLine: 'Слова мира: {words}',
  canonRefresh: 'Обновить слова мира',
  canonBusy: 'Подбираю слова мира под канон…',
  canonDone: 'Слова мира подобраны: {strings}, {holidays}.',
  aliasesLine: 'Ещё пишут: {aliases}',
  secretTitle: 'Тайна',
  memoryLine: '{sign} — {reason}',

  cmName: 'Имя',
  noGradesRest: 'Ещё без оценок: {names}.',
  peopleSearch: 'Найти по имени',
  peopleSearchNone: 'Никого с таким именем.',
  peopleBuzzNone: 'Пока ни о ком не говорят.',
  peopleShow: 'Показать',
  peopleAll: 'Все',
  peopleBuzz: 'На слуху',
  peopleBack: '← {title}',
  peopleToFeed: 'к записи →',
  peopleFeedLine: '{feed}:',
  peopleSubjects: 'Ведёт',
  peopleTraits: 'Черты',
  peopleSaid: 'Что говорят',
  peopleLinks: 'Связи',
  peopleBlank: 'Пока ничего не записано.',
  canonBooks: 'К карточке привязаны книги мира. Нажмите на название, чтобы вписать его в «Фандом».',
  noteTitle: 'Мои заметки',
  noteSave: 'Сохранить заметку',
  noteHint: 'что вы помните или задумали об этом человеке',
  noteNote: 'Только для вас: модель этого не видит.',
  peoplePortraitAct: 'Портрет: заменить или нарисовать',
  cmNameHint: 'Имя и фамилия',
  cmClub: 'Кружок',
  cmClubHint: 'кружок или секция — если есть',
  cmDesire: 'Чего хочет',
  cmDesireHint: 'к чему стремится',
  cmManner: 'Как пишет',
  cmMannerHint: 'в чате курса: коротко, грубо, без точек (пусто — как придётся)',
  cmTie: 'С кем связан',
  cmTieWhat: 'Как связаны',
  cmTieWhatHint: 'что их связывает',
  cmTieNone: 'ни с кем',
  cmHeroine: 'героиня',
  cmTieHeroine: 'с героиней',
  cmTieUnknown: 'кто-то',
  cmTieLine: '{who} — {what}',
  cmProblem: 'Что не ладится',
  cmProblemHint: 'что не ладится или тревожит',
  cmRelation: 'К героине',
  cmAddTitle: 'Добавить человека',
  cmAdd: 'Добавить',
  cmAdded: 'Человек добавлен.',
  cmEdit: 'Править',
  cmSave: 'Сохранить',
  cmSaved: 'Сохранено.',
  cmRemove: 'Удалить',
  cmRemoveAsk: 'Удалить «{name}»? Запись в книге мира и память об отношении к этому человеку пропадут.',
  cmRemoveYes: 'Да, удалить',
  cmRemoveNo: 'Оставить',
  bullyLead: 'Зачинщик травли',
  bullyCrew: 'Подпевала травли',
  bullyRoleField: 'Травля',
  bullyRoleNone: 'не участвует',
  bullyRoleLead: 'зачинщик',
  bullyRoleCrew: 'подпевала',
  bullyRoleSaved: 'Роль записана.',
  bullyTodayTitle: 'Травля',
  bullyHiddenMark: 'втихую',
  cmRemoved: 'Удалён.',
  cmNameMissing: 'Нужно имя.',
  cmCountLine: 'на курсе: {count}',

  feedChat: 'Чат курса',
  feedAnon: 'Анонимка',
  feedEmpty: 'Пока тихо. Слухи появятся сами через несколько ответов — или нажмите «Обновить слухи».',
  feedEmptyChat: 'В чате пока тихо.',
  feedEmptyAnon: 'Пока тихо. Сюда попадают слухи о сценах без свидетелей.',
  feedFromScene: 'из сцены',
  feedSomeone: 'кто-то с курса',
  feedAnonWho: 'без подписи',
  feedRumorTag: 'слух',
  feedFactTag: 'факт',
  feedTalkTag: 'обсуждают',
  feedNickHint: 'ник-маска: кто под ним — неизвестно, это не человек из списка',
  feedMoreReplies: 'ещё {n}',
  feedFoldReplies: 'свернуть ветку',
  feedReactMore: 'Другие значки',
  feedReactHint: 'Ваш значок — просто отметка, на сюжет не влияет',
  feedRepliesLabel: 'ответы',
  feedAbout: '{fact}',
  feedAboutSummary: 'о чём',
  feedStatusTaken: 'взято в сюжет',
  feedStatusPlayed: 'сыграно',
  feedStatusExpired: 'истекло',
  feedStatusBurst: 'лопнуло',
  feedTake: 'Взять в сюжет',
  feedPreviewTitle: 'Так повод уйдёт рассказчику',
  feedPreviewNote: 'Один раз, в следующий ответ. Можно поправить слова. Модель вплетёт его, если к месту, — или пропустит.',
  feedSend: 'Отправить в следующий ответ',
  feedCancel: 'Отмена',
  feedSent: 'Повод ждёт следующего ответа.',
  feedQueueTitle: 'Ждут ответа',
  feedQueueNext: 'попадёт в следующий ответ',
  feedQueueLater: 'в очереди — по одному за ответ',
  feedQueueSent: 'уже в ответе — снимется с вашей следующей репликой',
  feedQueueAuto: 'подкинуто само',
  feedDrop: 'Убрать',
  feedDropped: 'Убрано.',
  feedDealsTitle: 'Незакрытые дела',
  feedHooksOff: 'Поводы выключены в настройках — здесь можно только читать.',
  feedLoreHint: 'Из книги мира в ленте молчат: {names}. Добавьте их в «{course}» ({people} → Нашлись).',
  feedLoreMore: 'и ещё {n}',
  feedMuteHint: 'Напишите в реплике «(без сплетен)» — на этот ход поводы и фон промолчат.',
  feedHooksToggle: 'Поводы в сюжет («Взять в сюжет»)',
  feedPrepToggle: 'Неписи готовятся к событиям',
  feedBackgroundToggle: 'Фон в сцене',
  feedAutoToggle: 'Подкидывать поводы автоматически',
  feedHooksNote: 'Повод уходит рассказчику один раз мягкой подсказкой, а не приказом.',
  feedPrepNote: 'Перед праздником и экзаменом у кого-то из курса появляется своё дело: ищет компанию, конспекты, помощь. Дело видно в ленте и в незакрытых.',
  feedBackgroundNote: 'Строка о том, что говорят сегодня-вчера; гаснет своей галочкой.',
  feedAutoNote: 'Выключено, пока вы не попросите. Включено: раз в шесть ответов (после громкого события — через два) подкинется самое громкое из свежего.',
  feedMuteNote: '«(без сплетен)» в реплике гасит всё на этот ход.',

  awaitingTitle: 'Результаты ещё не объявлены',
  awaitingLine: '{subject}: итог объявят {date}',

  jumpToast: 'Прошло занятий: {periods}, все засчитаны.',

  pauseTitle: 'Занятия приостановлены',
  pauseOpen: 'с {from}, до отмены',
  pauseCancel: 'Отменить',
  pauseEdit: 'Изменить',
  pauseSave: 'Сохранить',
  pauseUntilCancelled: 'До отмены',
  pauseCancelled: 'Период убран, занятия идут по расписанию.',
  pauseSaved: 'Даты обновлены.',

  planPassed: 'прошло',

  setWork: 'Работа помощника',
  setAcademy: 'Академия',
  setData: 'Данные',
  setHooksOn: 'поводы включены',
  setHooksOff: 'поводы выключены',
  setFeedManual: 'по кнопке',
  setFeedEvery: 'раз в {n}',
  setApiOwn: 'свой API',
};

export const PRESET_UI_WORDS = [
  'tabFeed', 'feedChat', 'classmatesTitle', 'classmatesNone', 'lorebookNote', 'mesRelSection',
];

export const MALE_EXTRA_UI = {
  eventHookPlaceholder: 'Староста при всех зовёт героя танцевать',
  mobNote: 'Постоянные ученики, которые пишут в ленту: у каждого свой интерес, цель и то, как пишет, у каждого есть друг и недруг среди своих же. Герой им не указ — у них свои дела. Состав постоянный: новые статисты сами не появляются.',
  secretHint: 'то, чего герой не знает',
  cmHeroine: 'герой',
  cmTieHeroine: 'с героем',
  cmRelation: 'К герою',
};

export function extraLabels(preset) {
  const own = (preset && preset.ui) || {};
  const out = { ...EXTRA_UI, ...(presetGender(preset) === 'm' ? MALE_EXTRA_UI : {}) };
  const someone = preset && preset.vocab && typeof preset.vocab.someone === 'string' ? preset.vocab.someone.trim() : '';
  if (someone) out.feedSomeone = someone;
  for (const k of Object.keys(EXTRA_UI)) {
    if (own[k] === undefined) continue;
    out[k] = k === 'checkTiers' ? { ...EXTRA_UI.checkTiers, ...own[k] } : own[k];
  }
  return out;
}

export function whereText(subject) {
  if (!subject) return '';
  return [subject.building, subject.room].map(str).filter(Boolean).join(' · ');
}

export function slotText(p, T) {
  const pos = T.positions[String(p.position)] || `позиция ${p.position}`;
  const role = T.roles[String(p.role)] || String(p.role);
  return `${fill(pos, { depth: p.depth })} · ${role}`;
}

export const mounted = {
  panel: null, button: null, settings: null, host: null, tab: 'today', seenRolls: new Set(),
  spread: false,
  spreadObserver: null,
  peoplePart: 'teachers',
  peoplePerson: '',
  peopleView: 'list',
  peopleFilter: 'all',
  peopleSearch: '',
  peopleHist: new Set(),
  feedChan: 'chat',
  feedFresh: new Set(),
  feedPreview: null,
  feedOpen: new Set(),
  feedPal: new Set(),
  feedFocus: null,
  planDraft: null,
  todayNote: null,
  repairCount: false,
  focusStart: false,
  focusSurvey: false,
};

export function el(tag, attrs, children) {
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

const ICONS = {
  tick: '<path d="M4 12.5l5 5L20 6.5"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  pencil: '<path d="M5 19h4l10-10-4-4L5 15z"/>',
  ok: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
  dash: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 3"/>',
  edit: '<circle cx="12" cy="12" r="9"/><path d="M8.5 15.5l.7-2.7 5.2-5.2 2 2-5.2 5.2z"/>',
  star: '<path d="M12 3l2.6 5.6 6 .7-4.4 4.1 1.2 6L12 16.5 6.6 19.4l1.2-6L3.4 9.3l6-.7z"/>',
  walk: '<circle cx="13" cy="5" r="2"/><path d="M12 9l-3 4 3 2v5M12 9l4 3M9 13l-2 4"/>',
  heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 10c0 5.6-7 10-7 10z"/>',
  cal: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 14h3"/>',
  pause: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M10 13v4M14 13v4"/>',
  group: '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 20c0-3.5 2.5-6 6-6s6 2.5 6 6M15.5 14.5c3 0 5.5 2 5.5 5"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  scroll: '<path d="M7 4h11v13a3 3 0 01-3 3H6a3 3 0 003-3V6a2 2 0 00-2-2z"/><path d="M10 9h5M10 13h5"/>',
  wand: '<path d="M5 19L15 9"/><path d="M15 4l.9 2.1L18 7l-2.1.9L15 10l-.9-2.1L12 7l2.1-.9zM19 12l.6 1.4L21 14l-1.4.6L19 16l-.6-1.4L17 14l1.4-.6z"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M16 16l4 4"/>',
};

export function svgIcon(name, cls = '') {
  if (typeof document.createElementNS !== 'function') return el('span', { class: cls, 'aria-hidden': 'true' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

const hintKey = (v) => String(v == null ? '' : v).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

export function hintBody(text) {
  const t = String(text == null ? '' : text);
  return /^[А-ЯЁA-Z][а-яёa-z]/.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}

export function glossaryHint(preset, ...texts) {
  const g = preset && preset.glossary && typeof preset.glossary === 'object' ? preset.glossary : null;
  if (!g) return null;
  const keys = Object.keys(g).filter((k) => typeof g[k] === 'string' && g[k].trim() && hintKey(k));
  for (const t of texts) {
    const x = hintKey(t);
    if (!x) continue;
    const hit = keys.filter((k) => x === hintKey(k) || x.includes(hintKey(k))).sort((a, b) => b.length - a.length)[0];
    if (hit) return { term: hit, text: g[hit].trim() };
  }
  return null;
}

let hintPop = null;
let hintOwner = null;

function closeHint() {
  if (hintPop) hintPop.hidden = true;
  if (hintOwner) hintOwner.setAttribute('aria-expanded', 'false');
  hintOwner = null;
}

function openHint(button, hint) {
  if (hintOwner === button) { closeHint(); return; }
  closeHint();
  if (!hintPop) {
    hintPop = el('div', { class: 'academy-hint-pop', role: 'tooltip' });
    document.body.append(hintPop);
    document.addEventListener('click', (ev) => {
      if (hintOwner && !hintOwner.contains(ev.target) && !hintPop.contains(ev.target)) closeHint();
    });
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeHint(); });
    window.addEventListener('scroll', closeHint, true);
    window.addEventListener('resize', closeHint);
  }
  clear(hintPop).append(el('b', { text: hint.term }), ' — ', hintBody(hint.text));
  hintPop.hidden = false;
  const r = button.getBoundingClientRect();
  const width = Math.min(280, window.innerWidth - 16);
  hintPop.style.width = `${width}px`;
  hintPop.style.left = `${Math.max(8, Math.min(r.left + r.width / 2 - width / 2, window.innerWidth - width - 8))}px`;
  hintPop.style.top = `${r.bottom + 6}px`;
  hintPop.id = hintPop.id || 'academy-hint-pop';
  button.setAttribute('aria-expanded', 'true');
  button.setAttribute('aria-describedby', hintPop.id);
  hintOwner = button;
}

export function hintIcon(preset, ...texts) {
  const hint = glossaryHint(preset, ...texts);
  if (!hint) return null;
  const label = `${hint.term}: ${hint.text}`;
  const button = el('span', {
    class: 'academy-hint',
    role: 'button',
    tabindex: '0',
    title: label,
    'aria-label': label,
    'aria-expanded': 'false',
  }, [el('i', { class: 'fa-solid fa-circle-info', 'aria-hidden': 'true' })]);
  const toggle = (ev) => { ev.preventDefault(); ev.stopPropagation(); openHint(button, hint); };
  button.addEventListener('click', toggle);
  button.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') toggle(ev); });
  return button;
}

export function avatarNode(av, opts = {}) {
  if (!av) return null;
  const size = opts.size || 'feed';
  if (av.kind !== 'person') {
    return el('span', {
      class: `academy-ava academy-ava-${size} academy-ava-mask`,
      'aria-hidden': 'true',
      text: av.icon || '👤',
    });
  }
  const node = el('span', {
    class: `academy-ava academy-ava-${size} academy-ava-person ad-av`,
    style: `background-color: ${av.color}; background-color: var(--ad-av-bg, ${av.color})`,
    title: opts.title || av.name || null,
    role: opts.onclick ? 'button' : null,
    onclick: opts.onclick || null,
  }, [el('span', { class: 'academy-ava-initials', 'aria-hidden': 'true', text: av.initials || '?' })]);
  if (av.portrait) {
    const img = el('img', { class: 'academy-ava-img', src: av.portrait, alt: av.name || '', loading: 'lazy' });
    img.addEventListener('error', () => { img.hidden = true; });
    node.append(img);
  }
  return node;
}

export async function runAction(button, status, fn, okText) {
  if (typeof fn !== 'function') {
    setStatus(status, 'error', 'Действие недоступно: index.js его не передал.');
    return { ok: false, error: 'no-action' };
  }
  const label = button ? button.textContent : '';
  if (button) { button.disabled = true; button.classList.add('academy-busy'); button.textContent = 'Идёт запрос…'; }
  setStatus(status, 'busy', button ? '' : 'Идёт запрос…');
  try {
    const res = await fn();
    if (res && res.ok === false) {
      setStatus(status, 'error', res.error ? String(res.error) : 'Не получилось. Ответа с объяснением не пришло.');
      return res;
    }
    setStatus(status, 'ok', (typeof okText === 'function' ? okText(res) : okText) || 'Готово.');
    return res === undefined ? { ok: true } : res;
  } catch (err) {
    setStatus(status, 'error', (err && err.message) ? err.message : String(err));
    return { ok: false, error: err };
  } finally {
    if (button) { button.disabled = false; button.classList.remove('academy-busy'); button.textContent = label; }
  }
}

export function setStatus(node, kind, text) {
  if (!node) return;
  node.className = `academy-status academy-status-${kind}`;
  node.textContent = text || '';
}

export function field(label, value, onInput, placeholder, onCommit) {
  const input = el('input', { type: 'text', class: 'text_pole academy-input', value: value || '', placeholder: placeholder || '' });
  input.addEventListener('input', () => onInput(input.value));
  if (onCommit) input.addEventListener('change', () => onCommit(input.value));
  return el('div', { class: 'academy-td' }, [
    el('label', { class: 'academy-field' }, [el('span', { text: label }), input]),
  ]);
}

export function section(title, children, open = false) {
  const key = `${sectionScope}::${title}`;
  if (open === 'focus') sectionOpen.set(key, true);
  const wasOpen = sectionOpen.has(key) ? sectionOpen.get(key) === true : open === true;
  const node = el('details', { class: 'academy-section', open: wasOpen }, [
    el('summary', { class: 'academy-section-title', text: title }, [
      el('i', { class: `fa-solid ${sectionIcon(title)} academy-section-icon`, 'aria-hidden': 'true' }),
      el('i', { class: 'fa-solid fa-chevron-right academy-section-chevron', 'aria-hidden': 'true' }),
    ]),
    ...[].concat(children),
  ]);
  node.addEventListener('toggle', () => { sectionOpen.set(key, node.open === true); });
  if (open === 'focus') {
    setTimeout(() => { try { node.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch {} }, 0);
  }
  return node;
}

export function memoDetails(id, { cls = '', summary, body, open = false }) {
  const key = `${sectionScope}::${id}`;
  const wasOpen = sectionOpen.has(key) ? sectionOpen.get(key) === true : open === true;
  const node = el('details', { class: cls, open: wasOpen }, [el('summary', {}, summary), ...[].concat(body)]);
  node.addEventListener('toggle', () => { sectionOpen.set(key, node.open === true); });
  return node;
}

export const sectionOpen = new Map();
export let sectionScope = 'panel';

export function setSectionScope(scope) {
  sectionScope = scope;
}

export function renderEmpty(host, view) {
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
        onclick: () => {
          mounted.tab = 'settings';
          if (view.action.id === 'open-start') mounted.focusStart = true;
          if (view.action.id === 'open-settings') mounted.focusSurvey = true;
          renderPanel(host);
        },
      })
      : null,
  ]);
}

export function call(host, name, ...args) {
  const fn = host && host.actions ? host.actions[name] : null;
  if (typeof fn !== 'function') return Promise.resolve({ ok: false, error: `index.js не передал actions.${name}` });
  return Promise.resolve(fn(...args));
}

export function safe(fn, fallback) {
  try { return fn(); } catch { return fallback; }
}

const redraw = { panel: null, block: null };

export function bindRedraw(panel, block) {
  redraw.panel = panel;
  redraw.block = block;
}

export const renderPanel = (...args) => redraw.panel(...args);
export const renderSettingsBlock = (...args) => redraw.block(...args);

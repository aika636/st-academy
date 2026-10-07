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
// 2. **Отрисовка разведена на «что показать» и «чем показать».** В каждом
//    файле `ui/` сначала чистые функции: `todayView`, `gradebookView`,
//    `peopleView`, `debugView`, `settingsView`, `validateSubjectRows`. Они не
//    трогают DOM, возвращают
//    простые объекты и проверяются `test/ui.test.mjs` без браузера. Ниже них
//    те же объекты превращаются в узлы. Причина не в эстетике: браузера
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
//
// Сам этот файл — только фасад: код разложен по вкладкам в папке `ui/`, а
// здесь собрано всё публичное, чтобы `index.js`, `commands.js`, `storage.js`,
// стенд и тесты по-прежнему брали панель одним импортом `./ui.js`.
//
//   ui/common.js          словари, `fill`/`plural`, даты, `el`, `section`, `mounted`
//   ui/today.js           «Сегодня»
//   ui/holidays.js        праздники и свои события (блоки «Сегодня»)
//   ui/gradebook.js       «Зачётка»
//   ui/people.js          «Люди»; ui/classmates.js — её часть «Курс»
//   ui/feed.js            «Поток»: лента курса и «Взять в сюжет»
//   ui/achievements.js    «Достижения» и вехи
//   ui/debug.js           «Отладка»; ui/doctor.js — доктор промпта
//   ui/settings.js        «Настройки»; ui/settings-blocks.js — их блоки,
//                         общие с меню расширений
//   ui/hooks.js           вид для соседей (`window.AcademyAPI`)
//   ui/panel.js           панель с вкладками, кнопка вызова, блок в меню
//
// Импорты идут только вниз: `common` не знает вкладок, вкладки не знают
// `panel`. Перерисовку панели вкладки зовут через переходник в `common`.

export {
  DEFAULT_MAX_NUMBERS, sectionIcon, DEFAULT_UI, uiLabels, fill, stateHealth, formatDate, formatWeek,
  formatScore, capNumbers, countNumbers, PRESET_TEXT, plural, EXTRA_UI, extraLabels, whereText, PRESET_UI_WORDS,
} from './ui/common.js';
export { holidaysView, ownEventsView } from './ui/holidays.js';
export { milestonesView, achievementsView } from './ui/achievements.js';
export { PEOPLE_HISTORY, PEOPLE_PARTS, relationScore, peopleView } from './ui/people.js';
export { classmatesView, scoreText } from './ui/classmates.js';
export { feedView, statusText as feedStatusText, FEED_SHOWN, feedVisible } from './ui/feed.js';
export { gradebookView, awaitingView } from './ui/gradebook.js';
export { todayView, examResultsToday } from './ui/today.js';
export { DOCTOR_TEXT, promptOwner, foreignHead, promptDoctorView } from './ui/doctor.js';
export {
  DEBUG_JOURNAL, DEBUG_TEXT, debugView, describeApplied, describeCheck,
} from './ui/debug.js';
export { hookNow, hookToday, hookSummary, HOOK_JOURNAL_MAX, hookJournal } from './ui/hooks.js';
export { isTouchScreen, playChime } from './ui/settings-blocks.js';
export {
  SURVEY_FIELDS, TIME_MODES, EXAM_RULE_VIEW, rowsFromState, validateSubjectRows, surveyOf,
  settingsView,
} from './ui/settings.js';
export {
  TABS, DEBUG_TAB, TAB_ICONS, tabsFor, mountPanel, renderPanel, mountButton, launcherDiagnosis,
  resetLauncher, mountSettings,
} from './ui/panel.js';

export { default } from './ui/panel.js';

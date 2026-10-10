// ui/gradebook.js — вкладка «Зачётка»: предметы, баллы, хвосты, сессия и
// ожидание объявленных результатов.

import { debts, overallScore, subjectScore } from '../core/gradebook.mjs';
import { relationLabel, relationMemory, relationOf } from '../core/relations.mjs';
import { stats as attendanceStats } from '../core/attendance.mjs';
import { reputationLabel } from '../core/reputation.mjs';
import { termsOf } from '../core/time.mjs';
import { awaitingAnnouncement, examMode, datedExams } from '../core/exams.mjs';
import { milestones } from '../core/milestones.mjs';
import {
  uiLabels, fill, stateHealth, formatDate, termTitle, formatScore, capNumbers, capitalize, plural,
  extraLabels, el, renderEmpty,
} from './common.js';
import { milestonesView } from './achievements.js';
import { relationScore } from './people.js';

/**
 * Вкладка «Зачётка» (3.3, 3.4). Предметы, оценки, хвосты, средний балл,
 * репутация словом. Отношение преподавателя — **словом из пресета**: числа
 * наружу не идут, ни в промпт, ни на экран.
 */
export function gradebookView(state, preset) {
  const health = stateHealth(state, preset);
  if (health.kind !== 'ok') return { ...health, subjects: [], numbers: [] };

  const X0 = extraLabels(preset);
  const subjects = (state.subjects || []).map((s) => {
    const score = subjectScore(state, s.id, preset);
    const teacher = s.teacherId ? (state.teachers || []).find((t) => t.id === s.teacherId) : null;
    // За что преподаватель так относится — последний повод из журнала: слово
    // «холодно» без причины читалось приговором (живой прогон 10.10).
    // Причина — только у предмета, к которому она относится («прогул химии»
    // не висит под физикой того же наставника). Повод без предмета (общий)
    // показывается у первого предмета наставника.
    const firstOfTeacher = teacher && (state.subjects || []).find((x) => x.teacherId === teacher.id);
    const last = teacher
      ? relationMemory(state, teacher.id, preset, 12).find((m) => (m.subjectId
        ? m.subjectId === s.id
        : Boolean(firstOfTeacher) && firstOfTeacher.id === s.id)) || null
      : null;
    const sign = last ? (last.delta > 0 ? `+${last.delta}` : `−${-last.delta}`) : '';
    const att = attendanceStats(state, s.id);
    // Наставник, с которым ничего не было: «ровно · 0» — шум (см. «Люди»).
    const quiet = Boolean(teacher) && !relationOf(state, teacher.id)
      && !relationMemory(state, teacher.id, preset, 1).length;
    return {
      id: s.id,
      name: s.name,
      teacher: teacher ? teacher.name : '',
      teacherId: teacher ? teacher.id : null,
      // Ярлык словом и число шкалы отдельно: «недоволен» и «−3».
      relation: teacher && !quiet ? relationLabel(state, teacher.id, preset) : '',
      score: teacher && !quiet ? relationScore(state, teacher.id) : '',
      reason: last && last.reason ? fill(X0.memoryLine, { sign, reason: last.reason }) : '',
      // Прогулы и опоздания по предмету: раньше их не было видно нигде, кроме
      // последствий. Нули не пишутся.
      // Отработанный прогул помечается: «1 прогул (отработан)», а не просто «1 прогул».
      attendanceText: [
        skipsText(att),
        att.lates ? `${att.lates} ${plural(att.lates, 'опоздание', 'опоздания', 'опозданий')}` : '',
      ].filter(Boolean).join(', '),
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

/** «1 прогул (отработан)» / «3 прогула, отработано 1»; пусто без прогулов. */
function skipsText(att) {
  if (!att.skips) return '';
  const base = `${att.skips} ${plural(att.skips, 'прогул', 'прогула', 'прогулов')}`;
  if (!att.worked) return base;
  if (att.worked >= att.skips) return att.skips === 1 ? `${base} (отработан)` : `${base} (все отработаны)`;
  return `${base}, отработано ${att.worked}`;
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

// --- вкладка «Зачётка» ------------------------------------------------------

export function renderGradebook(host, view, preset) {
  if (view.kind !== 'ok') return renderEmpty(host, view);

  const U = uiLabels(preset);
  const box = el('div', { class: 'academy-gradebook' });

  box.append(el('div', { class: 'academy-head' }, [
    el('div', { class: 'academy-date', text: `${view.scoreName}: ${Number.isFinite(view.overall) ? view.overallText : U.scoreNone}` }),
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

  // Ни одной оценки ни у одного предмета: одна строка вместо «оценок пока нет» в каждой.
  const noGradesAtAll = view.subjects.every((s) => !s.grades.length);
  if (noGradesAtAll) box.append(el('div', { class: 'academy-silent', text: U.noGradesAll }));

  // Одно и то же дерево: на широком экране `style.css` кладёт его строками
  // таблицы, на узком — карточками. Второй вёрстки нет (3.9).
  box.append(el('div', { class: 'academy-table academy-table-grades' },
    view.subjects.map((s) => el('div', { class: s.debt ? 'academy-tr academy-tr-debt' : 'academy-tr' }, [
      el('div', { class: 'academy-td academy-td-name' }, [
        el('span', { class: 'academy-subject', text: s.name }),
        s.debt ? el('span', { class: 'academy-tag academy-tag-debt', text: U.debtTag }) : null,
        s.passed ? el('span', { class: 'academy-tag', text: U.passedTag }) : null,
        s.attendanceText ? el('span', { class: 'academy-note academy-att', text: s.attendanceText }) : null,
      ]),
      el('div', { class: 'academy-td academy-td-teacher' }, [
        el('span', { text: s.teacher || '—' }),
        // Отношение — словом из пресета. Числа наружу не идут (3.3).
        s.relation ? el('span', { class: 'academy-relation', text: s.score ? `${s.relation} · ${s.score}` : s.relation }) : null,
        s.reason ? el('span', { class: 'academy-note academy-reason', text: s.reason }) : null,
      ]),
      el('div', { class: 'academy-td academy-td-grades' }, [
        // Без оценок — одна подпись, а не «— —» без заголовков столбцов; когда их
        // нет нигде, подпись одна на весь список (выше).
        s.grades.length
          ? el('span', { class: 'academy-grades', text: s.grades.join(' ') })
          : (noGradesAtAll ? null : el('span', { class: 'academy-grades academy-grades-none', text: U.noGrades })),
        s.grades.length ? el('span', { class: 'academy-avg', text: fill(U.cmdAverage, { value: s.averageText }) }) : null,
      ]),
    ]))));

  const X = extraLabels(preset);
  if ((view.awaiting || []).length) {
    box.append(el('div', { class: 'academy-debts academy-awaiting' }, [
      el('span', { class: 'academy-card-title', text: X.awaitingTitle }),
      el('span', { text: view.awaiting.map((a) => a.text).join('; ') }),
    ]));
  }
  return box;
}

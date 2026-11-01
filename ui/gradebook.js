import { debts, debtReasons, DEBT_GRADE, overallScore, subjectScore } from '../core/gradebook.mjs';
import { relationLabel, relationMemory, relationOf } from '../core/relations.mjs';
import { stats as attendanceStats } from '../core/attendance.mjs';
import { reputationLabel } from '../core/reputation.mjs';
import { termsOf } from '../core/time.mjs';
import { awaitingAnnouncement, examMode, datedExams, debtReasonText, isPassing } from '../core/exams.mjs';
import { milestones } from '../core/milestones.mjs';
import {
  uiLabels, fill, stateHealth, formatDate, formatDateOn, termTitle, formatScore, capNumbers, capitalize, plural,
  extraLabels, el, renderEmpty, svgIcon, mounted,
} from './common.js';
import { subjectWord, upFirst } from '../core/words.mjs';
import { milestonesView } from './achievements.js';
import { relationScore } from './people.js';

export function openExamList(state, preset) {
  const mode = examMode(state, preset);
  const dated = datedExams(state, preset, state.calendar && state.calendar.day);
  return [...dated, ...mode.pending.filter((i) => !dated.some((d) => d.id === i.id))]
    .map((e) => {
      const s = (state.subjects || []).find((x) => x.id === e.subjectId);
      const kind = ((preset.exams && preset.exams.kinds) || []).find((k) => k.id === e.kind);
      return { id: e.id, subject: (s && s.name) || e.subjectId, kind: (kind && kind.name) || e.kind, day: e.day };
    });
}

export function gradebookView(state, preset) {
  const health = stateHealth(state, preset);
  if (health.kind !== 'ok') return { ...health, subjects: [], numbers: [] };

  const X0 = extraLabels(preset);
  const scale = (preset.grades && Array.isArray(preset.grades.values)) ? preset.grades.values : [];
  const badMarks = scale.filter((v) => v && v.pass === false).map((v) => String(v.value));
  const legend = scale
    .filter((v) => v && v.label && String(v.label) !== String(v.value))
    .map((v) => `${v.value} — ${v.label}`)
    .join(', ');
  const subjects = (state.subjects || []).map((s) => {
    const score = subjectScore(state, s.id, preset);
    const teacher = s.teacherId ? (state.teachers || []).find((t) => t.id === s.teacherId) : null;
    const firstOfTeacher = teacher && (state.subjects || []).find((x) => x.teacherId === teacher.id);
    const last = teacher
      ? relationMemory(state, teacher.id, preset, 12).find((m) => (m.subjectId
        ? m.subjectId === s.id
        : Boolean(firstOfTeacher) && firstOfTeacher.id === s.id)) || null
      : null;
    const sign = last ? (last.delta > 0 ? `+${last.delta}` : `−${-last.delta}`) : '';
    const att = attendanceStats(state, s.id);
    const quiet = Boolean(teacher) && !relationOf(state, teacher.id)
      && !relationMemory(state, teacher.id, preset, 1).length;
    return {
      id: s.id,
      name: s.name,
      teacher: teacher ? teacher.name : '',
      teacherId: teacher ? teacher.id : null,
      relation: teacher && !quiet ? relationLabel(state, teacher.id, preset) : '',
      score: teacher && !quiet ? relationScore(state, teacher.id) : '',
      reason: last && last.reason ? (sign && sign === relationScore(state, teacher.id) ? last.reason : fill(X0.memoryLine, { sign, reason: last.reason })) : '',
      attendanceText: [
        skipsText(att),
        att.lates ? `${att.lates} ${plural(att.lates, 'опоздание', 'опоздания', 'опозданий')}` : '',
      ].filter(Boolean).join(', '),
      grades: (score.grades || []).map((g) => g.value),
      marks: (score.grades || []).map((g) => ({ value: g.value, bad: badMarks.includes(String(g.value)) })),
      average: score.average,
      averageText: formatScore(score.average),
      passed: score.passed && closedSubject(state, preset, s.id),
      going: score.passed && (score.grades || []).length > 0 && !closedSubject(state, preset, s.id),
      debt: score.debt,
      debtReason: score.debt && !(debtReasons(s).length === 1 && debtReasons(s)[0] === DEBT_GRADE) ? debtReasonText(preset, s) : '',
    };
  });

  const tails = debts(state).map((s) => s.name || s.id);
  const tailLines = debts(state).map((s) => [s.name || s.id, debtReasonText(preset, s)].filter(Boolean).join(': '));
  const overall = overallScore(state, preset);
  const mode = examMode(state, preset);
  const openExams = openExamList(state, preset);

  const vocab = preset.vocab || {};
  const U = uiLabels(preset);
  const raw = [
    { key: 'overall', text: fill(U.scoreLine, { scoreName: vocab.score || 'средний балл', value: formatScore(overall) }) },
    tails.length ? { key: 'debts', text: fill(U.debtsLine, { debtPlural: vocab.debtPlural || 'хвосты', count: tails.length }) } : null,
    { key: 'subjects', text: fill(U.subjectsLine, { count: subjects.length }) },
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
    seal: preset.displayName || '',
    strip: raw.filter((n) => n.key === 'debts' || n.key === 'exams').map((n) => n.text),
    legend,
    legendTitle: extraLabels(preset).gradeLegend,
    badMarks,
    marginDate: marginDateOf(state),
    debts: tails,
    debtLines: tailLines,
    overall,
    overallText: formatScore(overall),
    scoreName: capitalize(vocab.score || 'средний балл'),
    reputation: reputationLabel(state, preset),
    expelled: Boolean(state.reputation && state.reputation.expelled),
    warned: Boolean(state.reputation && state.reputation.warned),
    examsActive: mode.active,
    examsTermLine: examsTermLine(state, preset, mode, U),
    openExams,
    milestones: milestonesView(state, preset),
    awaiting: awaitingView(state, preset),
    numbers: capped.shown,
    droppedNumbers: capped.dropped,
  };
}

export function marginDateOf(state) {
  const day = state && state.calendar && state.calendar.day;
  return typeof day === 'string' && /^\d{4}-\d{2}-\d{2}/.test(day) ? `${day.slice(8, 10)}.${day.slice(5, 7)}` : '';
}

function examsTermLine(state, preset, mode, U) {
  if (!mode.active) return '';
  const terms = termsOf(preset, state);
  if (terms.length < 2) return '';
  const index = state.exams && Number.isFinite(state.exams.term) ? state.exams.term : -1;
  const term = terms[index % terms.length];
  if (!term || index < 0) return '';
  return fill(U.examsTerm, { name: termTitle(term, U) });
}

function skipsText(att) {
  if (!att.skips) return '';
  const base = `${att.skips} ${plural(att.skips, 'прогул', 'прогула', 'прогулов')}`;
  if (!att.worked) return base;
  if (att.worked >= att.skips) return att.skips === 1 ? `${base} (отработан)` : `${base} (все отработаны)`;
  return `${base}, отработано ${att.worked}`;
}

export function awaitingView(state, preset) {
  const X = extraLabels(preset);
  return ((state && state.exams && state.exams.items) || [])
    .filter((i) => awaitingAnnouncement(i))
    .map((i) => {
      const s = (state.subjects || []).find((x) => x.id === i.subjectId);
      const subject = (s && s.name) || i.subjectId || '';
      return {
        id: i.id, subject, day: i.announceOn,
        text: fill(X.awaitingLine, { subject, date: formatDateOn(i.announceOn) || i.announceOn }),
      };
    });
}

let sealSeq = 0;

function sealMark(text) {
  const mark = svgIcon('tick', 'dia-doc-mark');
  if (typeof document.createElementNS !== 'function') return mark;
  const name = String(text || '').trim().toUpperCase();
  const size = name.length > 18 ? Math.max(5, (9 * 18) / name.length) : 9;
  const id = `adSealArc${++sealSeq}`;
  mark.setAttribute('viewBox', '0 0 80 80');
  mark.setAttribute('stroke', 'none');
  mark.innerHTML = `<defs><path id="${id}" d="M40 40 m-27 0 a27 27 0 1 1 54 0 a27 27 0 1 1 -54 0"/></defs>`
    + '<circle cx="40" cy="40" r="37" fill="none" stroke="currentColor" stroke-width="2"/>'
    + '<circle cx="40" cy="40" r="19" fill="none" stroke="currentColor" stroke-width="1.2"/>'
    + `<text font-size="${size.toFixed(2)}" font-weight="700" letter-spacing="1.2" fill="currentColor" font-family="inherit">`
    + `<textPath href="#${id}" startOffset="2"></textPath></text>`
    + '<g fill="currentColor" stroke="none" transform="translate(25 25) scale(.75)">'
    + '<path d="M3 8h9.5c.8 0 1.5.6 1.5 1.4V28c-2-1.4-5-1.8-11-1.8zM29 8h-9.5c-.8 0-1.5.6-1.5 1.4V28c2-1.4 5-1.8 11-1.8z" opacity=".85"/></g>';
  const path = mark.querySelector('textPath');
  if (path) path.textContent = name;
  return mark;
}

function closedSubject(state, preset, subjectId) {
  return ((state && state.exams && state.exams.items) || []).some((i) => i && i.subjectId === subjectId && i.outcome && isPassing(preset, i.outcome));
}

function subjectRow(s, U, X, noGradesAtAll) {
  const tags = [
    s.debt ? el('span', { class: 'dia-st dia-debt', text: U.debtTag }) : null,
    s.passed ? el('span', { class: 'dia-st dia-ok', text: U.passedTag }) : null,
    s.going ? el('span', { class: 'dia-st dia-going', text: U.ongoingTag, title: X.ongoingHint }) : null,
  ];
  const marks = s.marks.length
    ? el('span', { class: 'dia-marks' }, s.marks.map((m) => el('span', {
      class: 'dia-mark', dataset: m.bad ? { bad: '1' } : {}, text: m.value,
    })))
    : (noGradesAtAll ? null : el('span', { class: 'dia-none', text: U.noGrades }));
  const rel = s.relation ? (s.score ? `${s.relation} · ${s.score}` : s.relation) : '';
  const extra = [
    s.attendanceText ? el('span', { class: 'dia-gr-att', text: s.attendanceText }) : null,
    s.reason ? el('span', { class: 'dia-gr-reason', text: s.reason }) : null,
    s.debtReason ? el('span', { class: 'dia-gr-reason', text: s.debtReason }) : null,
  ].filter(Boolean);
  return el('div', { class: s.debt ? 'dia-gr-row dia-gr-debt' : 'dia-gr-row', dataset: { subject: s.id } }, [
    el('div', { class: 'dia-gr-subj', text: s.name }),
    el('div', {
      class: 'dia-gr-avg',
      text: s.marks.length && s.average != null ? s.averageText : '',
      title: s.marks.length && s.average != null ? fill(U.cmdAverage, { value: s.averageText }) : null,
    }),
    el('div', { class: 'dia-gr-marks' }, [marks, ...tags]),
    el('div', { class: 'dia-gr-teacher' }, [
      el('span', { class: 'dia-t', text: s.teacher || '—' }),
      rel ? el('span', { class: 'dia-r', text: rel }) : null,
    ]),
    extra.length ? el('div', { class: 'dia-gr-extra' }, extra) : null,
  ]);
}

function warnBox(title, items, { info = false, sub = '', cls = '' } = {}) {
  return el('div', { class: `dia-box-warn${info ? ' dia-info' : ''}${cls ? ` ${cls}` : ''}` }, [
    el('div', { class: 'dia-bw-h', text: title }),
    sub ? el('div', { class: 'dia-small dia-soft', text: sub }) : null,
    el('ul', {}, items.map((t) => el('li', { text: t }))),
  ]);
}

export function renderGradebook(host, view, preset) {
  if (view.kind !== 'ok') return { l: renderEmpty(host, view), blankRight: true };

  const U = uiLabels(preset);
  const X = extraLabels(preset);
  const spread = mounted.spread === true;

  const noGradesAtAll = view.subjects.length > 0 && view.subjects.every((s) => !s.grades.length);
  const bare = (s) => !s.grades.length && !s.debt && !s.passed && !s.going && !s.attendanceText && !s.reason;
  const bareList = noGradesAtAll ? [] : view.subjects.filter(bare);
  const folded = bareList.length >= 2 ? new Set(bareList.map((s) => s.id)) : new Set();
  const rows = view.subjects.filter((s) => !folded.has(s.id));

  const body = [];
  if (!view.subjects.length) body.push(el('div', { class: 'dia-silent', text: U.noSubjects }));
  else {
    if (noGradesAtAll) body.push(el('div', { class: 'dia-silent', text: U.noGradesAll }));
    body.push(el('div', { class: 'dia-gr' }, [
      el('div', { class: 'dia-gr-head', 'aria-hidden': 'true' }, [el('span', { text: upFirst(subjectWord(preset)) }), el('span', { text: X.gradeColumn })]),
      ...rows.map((s) => subjectRow(s, U, X, noGradesAtAll)),
    ]));
    if (folded.size) {
      body.push(el('div', {
        class: 'dia-silent dia-gr-rest',
        text: fill(X.noGradesRest, { names: bareList.map((s) => s.name).join(', ') }),
      }));
    }
  }

  const alarm0 = view.expelled ? U.expelledTag : view.warned ? U.warnedTag : '';
  const alarm = alarm0 && !String(view.reputation || '').toLowerCase().includes(String(alarm0).toLowerCase()) ? alarm0 : '';
  const doc = el('div', { class: 'dia-doc', dataset: view.subjects.some((s) => s.grades.length) ? { graded: '1' } : {} }, [
    el('i', { class: 'dia-attach', dataset: { for: 'doc', pos: 'l' } }),
    el('i', { class: 'dia-attach', dataset: { for: 'doc', pos: 'r' } }),
    el('div', { class: 'dia-doc-head' }, [
      el('div', {}, [el('div', { class: 'dia-doc-title', text: U.tabGradebook })]),
      sealMark(view.seal),
    ]),
    el('div', { class: 'dia-doc-sum' }, [
      el('div', {
        class: Number.isFinite(view.overall) ? 'dia-big' : 'dia-big dia-big-none',
        title: Number.isFinite(view.overall) ? U.scoreHint : null,
        text: Number.isFinite(view.overall) ? view.overallText : '—',
      }),
      el('div', { class: 'dia-lab', title: Number.isFinite(view.overall) ? U.scoreHint : null, text: Number.isFinite(view.overall) ? view.scoreName : U.scoreNoneLine }),
      el('div', { class: 'dia-rep' }, [
        `${U.reputationTitle}: ${view.reputation}`,
        alarm ? ' ' : null,
        alarm ? el('span', { class: 'dia-alarm', text: alarm }) : null,
      ]),
    ]),
    ...body,
    view.legend ? el('details', { class: 'dia-doc-legend' }, [el('summary', { text: view.legendTitle }), el('div', { text: `${view.legend}.` })]) : null,
  ]);

  const boxes = [];
  if (view.debts.length) boxes.push(warnBox(U.debtsTitle, view.debtLines));
  if (view.openExams.length) {
    boxes.push(warnBox(U.openExamsTitle, view.openExams.map((e) => `${e.subject} (${e.kind})`), {
      info: true, sub: view.examsTermLine,
    }));
  }
  if ((view.awaiting || []).length) {
    boxes.push(warnBox(X.awaitingTitle, view.awaiting.map((a) => a.text), { info: true, cls: 'academy-awaiting' }));
  }

  const common = { marginDate: view.marginDate };
  if (spread) return { ...common, l: doc, r: boxes.length ? boxes : null, blankRight: !boxes.length };
  const strip = view.strip.length
    ? el('div', { class: 'dia-strip' }, view.strip.map((t) => el('span', { text: t })))
    : null;
  return { ...common, l: [strip, doc, ...boxes], r: null, blankRight: true };
}

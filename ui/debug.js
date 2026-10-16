import { reasonText } from '../core/relations.mjs';
import { fill, SOURCE_LABEL, plural, str, el, safe } from './common.js';
import { DOCTOR_TEXT } from './doctor.js';

export const DEBUG_JOURNAL = 12;

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
  noMarker: 'Метка времени в ответе не найдена.',
  appliedTitle: 'Применено',
  noApplied: 'Применять было нечего.',
  rejectedTitle: 'Что отброшено и почему',
  notesTitle: 'Замечания',
  permissionTitle: 'Разрешение',
  injectsTitle: 'В промпт ушло одноразовым инжектом',
  noInjects: 'Одноразовых инжектов не было.',
  divergenceTitle: 'Расхождения с моделью',
  divergence: '{subject}: посчитано {computed}, модель написала {said}.',
  divergenceUnread: '{subject}: модель написала {said}, разобрать не удалось — посчитанное осталось.',
  divergenceDice: '{subject}: посчитано {computed}, кубик соседа решил {said}.',
  divergenceDiceUnread: '{subject}: кубик соседа дал {said}, в шкалу не легло — посчитанное осталось.',
  noDivergence: 'Расхождений посчитанного с версией модели не было.',
  molvaTitle: 'Последний выпуск слухов',
  molvaHead: 'Строк нужного вида в ответе: {rows}; легло постов {posts}, ответов {replies}{tail}.',
  molvaSkipped: 'Выпуск пропущен: {why}',
  molvaTruncated: ' (ответ модели оборвался)',
  molvaNoEnd: ' (без строки КОНЕЦ)',
  molvaRejectedTitle: 'Что отброшено в слухах и почему',
  molvaOccasionsTitle: 'Поводы, которые получила модель',
  molvaMemoryTitle: 'Память о делах: принято',
  molvaWarnedTitle: 'Принято с замечанием',
  molvaRawSummary: 'Сырой ответ модели',
  molvaNoRaw: 'Модель ничего не ответила.',
  molvaLine: 'строка {line}: {reason} — {raw}',
  molvaNoLine: '{reason} — {raw}',
  molvaOccasion: '{id} — {text}',
  molvaMemory: '{thread}: {member} — {change}',
  journalTitle: 'Журнал, последние записи',
  noJournal: 'Журнал пуст.',
};

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

export function describeApplied(item, vocab, ctx = {}) {
  if (!item || typeof item !== 'object') return str(item);
  const { state = null, preset = null } = ctx || {};
  vocab = vocab || {};
  switch (item.kind) {
    case 'attendance': return `посещаемость: ${item.subjectId} — ${item.status}${item.derived ? ' (по приходу на пару)' : ''}`;
    case 'missed': return `пропущено по расписанию: ${item.count}`;
    case 'grade': return `оценка: ${item.subjectId} — ${item.value}`;
    case 'rel': {
      const impact = item.impact ? ` (${item.impact})` : '';
      const damped = item.damped ? ' — погашено: тот же сдвиг подряд' : item.capped ? ' — срезано темпом отношений' : '';
      const why = item.reason ? reasonText(item.reason, state, preset) : '';
      return `отношение: ${item.teacherId} ${item.delta > 0 ? '+' : ''}${item.delta}${impact}${damped}${why ? `; повод: ${why}` : ''}`;
    }
    case 'announced': return `объявлены итоги: ${(item.examIds || []).join(', ')}`;
    case 'exams-scheduled': return `назначено: ${vocab.examPeriod || 'сессия'} — ${item.day}`;
    case 'exams-closed': return `закрыто: ${vocab.examPeriod || 'сессия'}`;
    case 'exam': {
      const head = `контрольное: ${item.subjectId || ''} — ${item.value || item.outcome || ''}`.trim();
      const later = item.announceOn ? `; объявят ${item.announceOn}` : '';
      const ext = item.external && typeof item.external === 'object'
        ? `; кубик соседа: ${TIER_TEXT[item.external.tier] || item.external.tier || '?'}`
          + `${Number.isFinite(item.external.roll) ? ` ${item.external.roll}` : ''}`
          + `${Number.isFinite(item.external.dc) ? ` из ${item.external.dc}` : ''}`
          + `${item.external.value ? ` → ${item.external.value}` : ''}`
        : '';
      if (item.told) return `${head}; со слов рассказчика, без броска${later}`;
      if (item.reason === 'auto') return `${head}; без броска: балл не ниже порога автомата${later}`;
      const why = describeCheck(item.check);
      return `${why ? `${head}; ${why}` : head}${ext}${later}`;
    }
    case 'time': {
      if (item.reason) return `время: ${item.reason}`;
      const absolute = [item.day, item.time].filter(Boolean).join(' ');
      const tag = item.source === 'A+' && item.via ? ` (${item.via})` : '';
      if (absolute) return `время: ${absolute}${tag}`;
      if (item.unit) {
        const n = Number.isFinite(item.n) ? `${item.n > 0 ? '+' : ''}${item.n} ` : '';
        return `время: ${n}${item.unit}`;
      }
      return 'время: сдвинулось';
    }
    case 'time-skip': {
      const policy = { attend: 'присутствие' }[item.policy] || 'присутствие';
      const asked = Number.isFinite(item.days) ? `заказано ${item.days} дн., ` : '';
      const exam = item.examDay ? `, не дальше ${item.examDay} (контрольное)` : '';
      return `промотка времени: ${asked}потолок ${item.cap} дн., пропущенное — ${policy}${exam}`;
    }
    case 'phone-turn': return 'ход в телефоне: сцена на паузе, прогулы не выводятся';
    case 'time-dropped': return `время из метки не проведено (${item.reason === 'phone-turn' ? 'ход в телефоне' : item.reason})`;
    case 'daypart': return `время суток: ${item.daypart}`;
    case 'time-held': return `прыжок придержан до решения: ${item.day}${item.jump ? ` (${item.jump > 0 ? '+' : ''}${item.jump} дн.)` : ''}${item.via ? ` (${item.via})` : ''}`;
    case 'exams-dated': return `назначено по календарю: ${item.added} — ${item.day}`;
    case 'event': return `в планы: ${item.name} — ${item.from}`;
    case 'event-known': return `уже в планах: ${item.name}`;
    case 'pause': return `${item.action === 'close' ? 'занятия возобновились' : 'занятия приостановлены'}: ${item.name} — ${item.from}`;
    case 'pause-known': return 'приостановка уже в календаре';
    default: return `${item.kind}${item.subjectId ? `: ${item.subjectId}` : ''}`;
  }
}

const TIER_TEXT = { critSuccess: 'крит-успех', success: 'успех', fail: 'провал', critFail: 'крит-провал' };

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

function describeRejected(r) {
  if (typeof r === 'string') return r;
  if (!r || typeof r !== 'object') return '';
  return `${r.raw || r.kind || 'кусок'}${r.reason ? ` — ${r.reason}` : ''}`;
}

function shortData(data) {
  if (!data || typeof data !== 'object') return '';
  try {
    const s = JSON.stringify(data);
    return s.length > 120 ? `${s.slice(0, 117)}…` : s;
  } catch {
    return '';
  }
}

export function molvaDebugView(d) {
  if (!d || typeof d !== 'object') return null;
  const T = DEBUG_TEXT;
  const tail = (d.truncated ? T.molvaTruncated : '') + (!d.truncated && d.complete === false ? T.molvaNoEnd : '');
  return {
    head: d.skipped ? fill(T.molvaSkipped, { why: str(d.skipped) }) : fill(T.molvaHead, { rows: d.rows || 0, posts: d.posts || 0, replies: d.replies || 0, tail }),
    rejected: (d.rejected || []).map((r) => fill(r.line ? T.molvaLine : T.molvaNoLine, { line: r.line, reason: r.reason, raw: r.raw })),
    warned: (d.warned || []).map((r) => fill(r.line ? T.molvaLine : T.molvaNoLine, { line: r.line, reason: r.reason, raw: r.raw })),
    occasions: (d.occasions || []).map((o) => fill(T.molvaOccasion, { id: o.id, text: o.text })),
    memory: (d.memory || []).map((m) => fill(T.molvaMemory, { thread: m.thread, member: m.member, change: m.change })),
    raw: str(d.raw),
    at: str(d.at),
  };
}

export function renderDebug(host, view) {
  const T = DEBUG_TEXT;
  const box = el('div', { class: 'academy-debug' });
  if (!view.enabled) return box;
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

  const molva = molvaDebugView(safe(() => (host.getMolvaDebug ? host.getMolvaDebug() : null), null));
  if (molva) {
    box.append(el('div', { class: 'academy-debug-block' }, [
      el('div', { class: 'academy-card-title', text: T.molvaTitle }),
      el('div', { class: 'academy-debug-line', text: molva.head }),
    ]));
    add(debugList(T.molvaRejectedTitle, molva.rejected, ''));
    add(debugList(T.molvaOccasionsTitle, molva.occasions, ''));
    add(debugList(T.molvaMemoryTitle, molva.memory, ''));
    add(debugList(T.molvaWarnedTitle, molva.warned, ''));
    box.append(el('details', { class: 'academy-repair' }, [
      el('summary', { text: T.molvaRawSummary }),
      el('div', { class: 'academy-repair-body' }, [
        el('pre', { class: 'academy-debug-raw', text: molva.raw || T.molvaNoRaw }),
      ]),
    ]));
  }

  add(debugList(T.divergenceTitle, view.divergences.map((d) => d.text), T.noDivergence));

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

function debugList(title, items, emptyText) {
  if (!items.length && !emptyText) return null;
  return el('div', { class: 'academy-debug-block' }, [
    el('div', { class: 'academy-card-title', text: title }),
    items.length
      ? el('ul', { class: 'academy-notes' }, items.map((s) => el('li', { text: String(s) })))
      : el('div', { class: 'academy-teacher', text: emptyText }),
  ]);
}

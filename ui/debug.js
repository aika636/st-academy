// ui/debug.js — вкладка «Отладка»: прогон, журнал, разбор применённого и
// отброшенного (`describeApplied`, `describeCheck`) и блок доктора промпта.

import { reasonText } from '../core/relations.mjs';
import { fill, SOURCE_LABEL, plural, str, el, safe } from './common.js';
import { DOCTOR_TEXT } from './doctor.js';

/** Сколько последних строк журнала показывать в отладке. */
export const DEBUG_JOURNAL = 12;

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
  noMarker: 'Метка времени в ответе не найдена.',
  appliedTitle: 'Применено',
  noApplied: 'Применять было нечего.',
  rejectedTitle: 'Что отброшено и почему',
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
  // Выпуск молвы: что ответила модель и почему строки отброшены (баг 70).
  molvaTitle: 'Последний выпуск молвы',
  molvaHead: 'Строк нужного вида в ответе: {rows}; легло постов {posts}, ответов {replies}{tail}.',
  molvaTruncated: ' (ответ модели оборвался)',
  molvaNoEnd: ' (без строки КОНЕЦ)',
  molvaRejectedTitle: 'Что отброшено в молве и почему',
  molvaMovedTitle: 'Принято с заменой автора',
  molvaWarnedTitle: 'Принято с замечанием',
  molvaRawSummary: 'Сырой ответ модели',
  molvaNoRaw: 'Модель ничего не ответила.',
  molvaLine: 'строка {line}: {reason} — {raw}',
  molvaNoLine: '{reason} — {raw}',
  molvaMoved: 'строка {line}: слот {n}, написал «{to}» вместо «{from}»',
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
    case 'attendance': return `посещаемость: ${item.subjectId} — ${item.status}${item.derived ? ' (по приходу на пару)' : ''}`;
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
    case 'event': return `в планы: ${item.name} — ${item.from}`;
    case 'event-known': return `уже в планах: ${item.name}`;
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

/**
 * Последний выпуск молвы для вкладки: заголовок, отброшенные строки с причинами,
 * принятые с заменой автора и сырой ответ модели. Без DOM; `null` — выпусков не было.
 */
export function molvaDebugView(d) {
  if (!d || typeof d !== 'object') return null;
  const T = DEBUG_TEXT;
  const tail = (d.truncated ? T.molvaTruncated : '') + (!d.truncated && d.complete === false ? T.molvaNoEnd : '');
  return {
    head: fill(T.molvaHead, { rows: d.rows || 0, posts: d.posts || 0, replies: d.replies || 0, tail }),
    rejected: (d.rejected || []).map((r) => fill(r.line ? T.molvaLine : T.molvaNoLine, { line: r.line, reason: r.reason, raw: r.raw })),
    warned: (d.warned || []).map((r) => fill(r.line ? T.molvaLine : T.molvaNoLine, { line: r.line, reason: r.reason, raw: r.raw })),
    moved: (d.reassigned || []).map((r) => fill(T.molvaMoved, { line: r.line, n: r.n, to: r.to, from: r.from })),
    raw: str(d.raw),
    at: str(d.at),
  };
}

// --- вкладка «Отладка» ------------------------------------------------------

/**
 * Разбор последнего ответа. Вкладка существует, только когда галочка включена
 * (`tabsFor`), поэтому проверка `enabled` здесь — не «а вдруг», а страховка от
 * прямого вызова: пустой блок лучше, чем разбор в выключенном режиме.
 */
export function renderDebug(host, view) {
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

  // Выпуск молвы: сырой ответ модели и причины отброса — чтобы следующий прогон показал правду.
  const molva = molvaDebugView(safe(() => (host.getMolvaDebug ? host.getMolvaDebug() : null), null));
  if (molva) {
    box.append(el('div', { class: 'academy-debug-block' }, [
      el('div', { class: 'academy-card-title', text: T.molvaTitle }),
      el('div', { class: 'academy-debug-line', text: molva.head }),
    ]));
    add(debugList(T.molvaRejectedTitle, molva.rejected, ''));
    add(debugList(T.molvaMovedTitle, molva.moved, ''));
    add(debugList(T.molvaWarnedTitle, molva.warned, ''));
    box.append(el('details', { class: 'academy-repair' }, [
      el('summary', { text: T.molvaRawSummary }),
      el('div', { class: 'academy-repair-body' }, [
        el('pre', { class: 'academy-debug-raw', text: molva.raw || T.molvaNoRaw }),
      ]),
    ]));
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

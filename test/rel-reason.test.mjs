import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parseMarker } from '../core/parse-marker.mjs';
import { reasonText, mergeDeltas, REASON_PHRASES } from '../core/relations.mjs';
import { applyResponse } from '../core/engine.mjs';
import { scheduleExams, applyOutcome } from '../core/exams.mjs';
import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { markerInstruction } from '../prompt.mjs';

// 9.7B «Источник изменения в rel»: у сдвига отношения хранится не только
// дельта, но и повод — из событий того же ответа и из слов модели в метке.

const loadPreset = (id) => JSON.parse(readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'));
const preset = loadPreset('ru-university');

const SUBJECTS = [
  { id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' },
  { id: 'physics', name: 'физика', teacherId: 'ivanov' },
];
const TEACHERS = [
  { id: 'petrova', name: 'Петрова Анна Сергеевна' },
  { id: 'ivanov', name: 'Иванов Пётр Ильич' },
];

function semester(day = '2024-10-01') {
  const s = createState(preset, {
    startDay: '2024-09-02', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
  });
  s.started = true;
  s.calendar.day = day;
  return s;
}

const lexicon = (s) => ({ ...preset, subjects: s.subjects, teachers: s.teachers });
const relOf = (text, s = semester()) => parseMarker(`<!-- [ACADEMY ${text}] -->`, lexicon(s));
const lastRel = (state) => state.journal.filter((e) => e.kind === 'rel' && e.data && 'from' in e.data).at(-1);

// --- разбор метки ------------------------------------------------------------

test('9.7B повод третьим полем: слово силы и число, прежний вид — как раньше', () => {
  assert.deepEqual(relOf('rel=petrova:major-:сорван зачёт').events,
    [{ kind: 'rel', teacherId: 'petrova', delta: -2, impact: 'major', reason: 'сорван зачёт' }]);
  assert.deepEqual(relOf('rel=petrova:+1:помогла с опытом t=+1').events[0],
    { kind: 'rel', teacherId: 'petrova', delta: 1, reason: 'помогла с опытом' });
  assert.deepEqual(relOf('rel=petrova:-1').events, [{ kind: 'rel', teacherId: 'petrova', delta: -1 }],
    'без повода — ни одного нового поля');
  assert.deepEqual(relOf('rel=petrova:minor+').events, [{ kind: 'rel', teacherId: 'petrova', delta: 1, impact: 'minor' }]);
});

test('9.7B повод: скобки из инструкции и подчёркивания снимаются, длина ограничена', () => {
  assert.equal(relOf('rel=petrova:major- (:сорван зачёт)').events[0].reason, 'сорван зачёт');
  assert.equal(relOf('rel=petrova:minor+:[помогла_с_опытом]').events[0].reason, 'помогла с опытом');
  assert.ok(relOf(`rel=petrova:minor+:${'очень '.repeat(30)}`).events[0].reason.length <= 60);
  assert.equal(relOf('rel=petrova:major-:').events[0].reason, undefined, 'пустой повод — нет повода');
});

test('9.7B повод не спасает кривую дельту: слово без знака — в rejected, как раньше', () => {
  const r = relOf('rel=petrova:major:сорван зачёт');
  assert.deepEqual(r.events, []);
  assert.equal(r.rejected.length, 1);
});

test('9.7B инструкция говорит про повод и держит потолок 400 знаков', () => {
  const s = semester();
  const text = markerInstruction(s, preset);
  assert.ok(text.includes(':повод'), text);
  assert.ok(text.length <= 400, `${text.length}`);
  const magic = loadPreset('magic-academy');
  assert.ok(markerInstruction(s, magic).includes(':повод'));
});

// --- повод из механики ------------------------------------------------------

test('9.7B повод из оценки в том же ответе — в журнал и в отладку', () => {
  const run = applyResponse(semester(), '<!-- [ACADEMY t=+0 grade=chemistry:2 rel=petrova:minor-] -->', preset);
  const rec = lastRel(run.state);
  assert.deepEqual(rec.data.reason, { kind: 'grade', subjectId: 'chemistry', value: '2' });
  const dbg = run.debug.applied.find((a) => a.kind === 'rel');
  assert.deepEqual(dbg.reason, rec.data.reason);
  assert.equal(reasonText(rec.data.reason, run.state, preset), 'оценка 2: аналитическая химия');
});

test('9.7B повод из сегодняшнего контрольного: «сорван зачёт» — это сдача по его предмету', () => {
  let s = scheduleExams(semester('2024-12-23'), preset, { day: '2024-12-23', term: 0 });
  s = applyOutcome(s, { examId: '0:chemistry:credit', value: 'незачёт', day: '2024-12-23' }, preset).state;
  s.pending = [];
  const run = applyResponse(s, '<!-- [ACADEMY t=+0 rel=petrova:major-:сорван зачёт] -->', preset);
  const rec = lastRel(run.state);
  assert.deepEqual(rec.data.reason, {
    kind: 'exam', subjectId: 'chemistry', examId: '0:chemistry:credit', value: 'незачёт', text: 'сорван зачёт',
  });
  assert.equal(reasonText(rec.data.reason, run.state, preset), 'испытание: аналитическая химия — незачёт (сорван зачёт)');
});

test('9.7B повод из отметки в метке и из слов модели, когда механика слепа', () => {
  const skip = applyResponse(semester(), '<!-- [ACADEMY t=+0 skip=physics rel=ivanov:minor-] -->', preset);
  // Две записи: сдвиг из метки (первым) и эффект самого прогула (пакетом в конце).
  const [fromMarker, fromEffect] = skip.state.journal.filter((e) => e.kind === 'rel' && e.data.teacherId === 'ivanov');
  assert.deepEqual(fromMarker.data.reason, { kind: 'skip', subjectId: 'physics' });
  assert.deepEqual(fromEffect.data.reason, { kind: 'skip', subjectId: 'physics', day: '2024-10-01' });

  const words = applyResponse(semester(), '<!-- [ACADEMY t=+0 rel=ivanov:minor+:помогла донести приборы] -->', preset);
  assert.deepEqual(lastRel(words.state).data.reason, { kind: 'marker', text: 'помогла донести приборы' });
  assert.equal(reasonText(lastRel(words.state).data.reason, words.state, preset), 'помогла донести приборы');

  const none = applyResponse(semester(), '<!-- [ACADEMY t=+0 rel=ivanov:minor+] -->', preset);
  assert.equal(lastRel(none.state).data.reason, null, 'повода нет — null, как было');
});

test('9.7B повод у эффекта посещаемости: прогул, предмет и день', () => {
  const s = semester('2024-10-01');
  const run = applyResponse(s, '<!-- [ACADEMY t=+0 skip=chemistry] -->', preset);
  const rec = run.state.journal.filter((e) => e.kind === 'rel' && e.data.teacherId === 'petrova').at(-1);
  assert.deepEqual(rec.data.reason, { kind: 'skip', subjectId: 'chemistry', day: '2024-10-01' });
});

// --- мелочи -------------------------------------------------------------------

test('9.7B reasonText: пресет перекрывает фразы; строка и пустота — как есть', () => {
  const s = semester();
  const own = { ...preset, phrases: { ...preset.phrases, relationReason: { skip: 'SKIP {subject}' } } };
  assert.equal(reasonText({ kind: 'skip', subjectId: 'physics' }, s, own), 'SKIP физика');
  assert.equal(reasonText({ kind: 'skip', subjectId: 'physics', count: 3 }, s, preset), 'прогулы: физика ×3');
  assert.equal(reasonText('старый повод строкой', s, preset), 'старый повод строкой');
  assert.equal(reasonText(null, s, preset), '');
  assert.ok(REASON_PHRASES.grade.includes('{value}'));
});

test('9.7B mergeDeltas: одна дельта на наставника, сводный повод, ноль выпадает', () => {
  const merged = mergeDeltas([
    { teacherId: 'petrova', delta: -1, reason: { kind: 'skip', subjectId: 'chemistry', day: 'a' } },
    { teacherId: 'petrova', delta: -1, reason: { kind: 'skip', subjectId: 'chemistry', day: 'b' } },
    { teacherId: 'ivanov', delta: -1, reason: { kind: 'skip', subjectId: 'physics' } },
    { teacherId: 'ivanov', delta: -1, reason: { kind: 'late', subjectId: 'optics' } },
    { teacherId: 'zero', delta: 1 },
    { teacherId: 'zero', delta: -1 },
  ]);
  assert.deepEqual(merged, [
    { teacherId: 'petrova', delta: -2, reason: { kind: 'skip', count: 2, subjectId: 'chemistry' } },
    { teacherId: 'ivanov', delta: -2, reason: { kind: 'skip', count: 2 } },
  ]);
});

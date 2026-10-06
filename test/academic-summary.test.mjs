import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createState, validateState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { buildAnalysisPrompt, clipAnalysisReply, parseAnalysis, effectiveText, tokenText } from '../core/analysis.mjs';
import { applyAcademicCompletion } from '../core/academic-completion.mjs';
import { applyResponse, resolveHeldJump } from '../core/engine.mjs';

const preset = JSON.parse(readFileSync(new URL('../presets/ru-university.json', import.meta.url), 'utf8'));
const subjects = [{ id: 'necromancy', name: 'Некромантия' }, { id: 'potions', name: 'Зельеварение' }];
function semester() {
  const state = createState(preset, { startDay: '2024-09-02', subjects, schedule: buildSchedule(subjects, preset) });
  state.started = true;
  state.calendar.day = '2024-09-03';
  return state;
}
const lexicon = (state) => ({ ...preset, subjects: state.subjects });

test('длинная бытовая сцена сохраняет учебную сводку в начале, середине и реплике в конце', () => {
  const fragments = [
    'Ренее сдала все хвосты до единого; в её зачётной книжке красовались отметки «отлично».',
    'Зачётная неделя осталась позади: все хвосты были сданы на высший балл.',
    '«Ты все зачёты на отлично сдала», — сказал Джаспер.',
  ];
  const source = fragments.join(`\n\n${'Они отдыхали дома. '.repeat(500)}\n\n`);
  const clipped = clipAnalysisReply(source);
  for (const fragment of fragments) assert.ok(clipped.includes(fragment), fragment);
  assert.ok(clipped.length <= 6000);
  const prompt = buildAnalysisPrompt(semester(), preset, { reply: source });
  for (const fragment of fragments) assert.ok(prompt.user.includes(fragment));
});

test('сводка секретаря проходит через метку, канонические токены и текст предпросмотра', () => {
  const state = semester();
  const result = parseAnalysis('<!-- [ACADEMY completion=all:отлично] -->', lexicon(state));
  assert.deepEqual(result.tokens, ['completion=all:5']);
  assert.match(tokenText(result.tokens[0], lexicon(state)), /все зачёты и экзамены: 5/);
  const applied = applyResponse(state, effectiveText('Все зачёты сданы на отлично.', result.tokens), preset);
  assert.ok(applied.state.subjects.every((subject) => subject.grades.at(-1)?.value === '5'));
  assert.deepEqual(validateState(applied.state, preset).errors, []);
  assert.ok(state.subjects.every((subject) => subject.grades.length === 0), 'исходное состояние не мутирует');
});

test('закрытие хвостов не раздаёт оценки всем остальным предметам', () => {
  const state = semester();
  state.subjects[0].debt = true;
  state.subjects[0].debtReason = 'skips';
  const result = applyAcademicCompletion(state, { scope: 'debts', value: '5' }, preset);
  assert.deepEqual(result.subjectIds, ['necromancy']);
  assert.equal(result.state.subjects[0].debt, false);
  assert.equal(result.state.subjects[1].grades.length, 0);
});

test('сводка закрывает прошедшие контрольные, не сдаёт будущие и не дублируется при повторе', () => {
  const state = semester();
  state.exams.items = [
    { id: 'past', subjectId: 'necromancy', kind: 'exam', day: '2024-09-02', outcome: null, attempts: 0 },
    { id: 'future', subjectId: 'potions', kind: 'exam', day: '2024-12-23', outcome: null, attempts: 0 },
  ];
  const event = { scope: 'all', value: '5' };
  const result = applyAcademicCompletion(state, event, preset);
  assert.equal(result.state.exams.items[0].outcome, '5');
  assert.equal(result.state.exams.items[0].announced, true);
  assert.equal(result.state.exams.items[1].outcome, null);
  assert.equal(result.state.pending.length, 0);
  const repeat = applyAcademicCompletion(result.state, event, preset);
  assert.equal(repeat.applied, false);
  assert.deepEqual(repeat.state.subjects, result.state.subjects);
  assert.deepEqual(repeat.state.exams, result.state.exams);
});

test('непроходная оценка и неизвестный охват не могут закрыть учёбу', () => {
  const state = semester();
  assert.equal(applyAcademicCompletion(state, { scope: 'all', value: '2' }, preset).applied, false);
  const result = parseAnalysis('<!-- [ACADEMY completion=stranger:5 completion=all:nonsense] -->', lexicon(state));
  assert.equal(result.tokens.length, 0);
  assert.equal(result.rejected.length, 2);
});

test('смена даты без cue промотки не превращает неописанные занятия в прогулы', () => {
  const state = semester();
  const result = applyResponse(state, 'Минуло два дня. <!-- [ACADEMY t=+2 day] -->', preset);
  assert.deepEqual(result.missed, []);
  assert.ok(result.state.attendance.records.every((record) => record.status !== 'skip'));
  const explicit = applyResponse(state, '<!-- [ACADEMY t=+2 day skip=necromancy] -->', preset);
  assert.equal(explicit.state.attendance.records.filter((record) => record.status === 'skip').length, 1);
});

test('принятие далёкой даты сохраняет безопасную посещаемость', () => {
  const result = applyResponse(semester(), '📅 12 сентября 2024, 10:15', preset);
  assert.ok(result.heldJump);
  const accepted = resolveHeldJump(result.state, preset, true);
  assert.deepEqual(accepted.missed, []);
});

test('явно выбранная строгая политика посещаемости продолжает работать', () => {
  const strict = { ...preset, attendance: { ...preset.attendance, skipPolicy: 'absent' } };
  const result = applyResponse(semester(), '<!-- [ACADEMY t=+2 day] -->', strict);
  assert.ok(result.missed.length > 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readDiceRoll } from '../core/cues.mjs';
import { scheduleExams, externalValue, isPassing } from '../core/exams.mjs';
import { applyResponse, sitExam } from '../core/engine.mjs';
import { createState } from '../core/state.mjs';
import { buildSchedule } from '../core/schedule.mjs';

// 9.4.1 / 9.7B: кубик BB-Enhance-Gen (Action Roll) в реплике человека в день
// контрольного. Разбор — `core/cues.mjs` (чистый), маршрут — `engine.sitExam`
// через `opts.dice` в тот же `resolveConflict`, что и версия модели.

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

function inSession() {
  const s = createState(preset, {
    startDay: '2024-09-02', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
  });
  s.started = true;
  s.calendar.day = '2024-12-23';
  return scheduleExams(s, preset, { day: '2024-12-23', term: 0 });
}

/**
 * Cue ровно в том виде, в каком его пишет BB-Enhance-Gen (`BOT_CUES.roll_*`,
 * сверено по `index.js` на стенде): видимая цитата и скрытая заметка.
 */
const egCue = {
  success: (roll, dc, q = 'Удастся ли ответить на билет?') => `\n\n> 🎲 **УСПЕХ (${roll} из ${dc})** | *${q}* <span style="display:none;">\n<system_note>\nDICE OF FATE — SUCCESS (Roll: ${roll} vs DC: ${dc}). The user's action was successful. Describe how their plan worked perfectly. CRITICAL RULE: Ensure NPC reactions are logical and STRICTLY In-Character.\n</system_note>\n</span>`,
  failure: (roll, dc, q = 'Удастся ли ответить на билет?') => `\n\n> 🎲 **ПРОВАЛ (${roll} из ${dc})** | *${q}* <span style="display:none;">\n<system_note>\nDICE OF FATE — FAILURE (Roll: ${roll} vs DC: ${dc}). The user's action failed. Describe a fiasco (plan collapsed, weapon slipped).\n</system_note>\n</span>`,
  critSuccess: (q = 'Удастся ли ответить на билет?') => `\n\n> 🎲 **КРИТИЧЕСКИЙ УСПЕХ (20)** | *${q}* <span style="display:none;">\n<system_note>\nDICE OF FATE — CRITICAL SUCCESS (Rolled 20!). The user's action succeeded brilliantly.\n</system_note>\n</span>`,
  critFailure: (q = 'Удастся ли ответить на билет?') => `\n\n> 🎲 **КРИТИЧЕСКИЙ ПРОВАЛ (1)** | *${q}* <span style="display:none;">\n<system_note>\nDICE OF FATE — CRITICAL FAILURE (Rolled 1!). The user's action turned into an absolute catastrophe.\n</system_note>\n</span>`,
};

// --- разбор ------------------------------------------------------------------

test('кубик Enhance-Gen: четыре исхода в том виде, в каком их пишет расширение', () => {
  const s = readDiceRoll(`Беру билет.${egCue.success(14, 12)}`);
  assert.deepEqual({ tier: s.tier, roll: s.roll, dc: s.dc }, { tier: 'success', roll: 14, dc: 12 });
  assert.equal(s.question, 'Удастся ли ответить на билет?');
  assert.match(s.matched, /УСПЕХ \(14 из 12\)/);
  assert.equal(s.matched.includes('<span'), false, 'в отладку — видимая строка, без скрытой заметки');

  const f = readDiceRoll(egCue.failure(5, 16));
  assert.deepEqual({ tier: f.tier, roll: f.roll, dc: f.dc }, { tier: 'fail', roll: 5, dc: 16 });

  const cs = readDiceRoll(egCue.critSuccess());
  assert.deepEqual({ tier: cs.tier, roll: cs.roll, dc: cs.dc }, { tier: 'critSuccess', roll: 20, dc: null },
    'DC у крита сосед не пишет');
  const cf = readDiceRoll(egCue.critFailure());
  assert.deepEqual({ tier: cf.tier, roll: cf.roll, dc: cf.dc }, { tier: 'critFail', roll: 1, dc: null });
});

test('кубик: форма из плана «🎲 … (N / DC M)», только видимая строка, только скрытая заметка', () => {
  const plan = readDiceRoll('🎲 Проверка: провал (7 / DC 12)');
  assert.deepEqual({ tier: plan.tier, roll: plan.roll, dc: plan.dc }, { tier: 'fail', roll: 7, dc: 12 });

  const visible = readDiceRoll('> 🎲 **УСПЕХ (11 из 10)** | *q*');
  assert.deepEqual({ tier: visible.tier, roll: visible.roll, dc: visible.dc }, { tier: 'success', roll: 11, dc: 10 });

  const hidden = readDiceRoll('<span style="display:none;"><system_note>DICE OF FATE — FAILURE (Roll: 3 vs DC: 14). x</system_note></span>');
  assert.deepEqual({ tier: hidden.tier, roll: hidden.roll, dc: hidden.dc }, { tier: 'fail', roll: 3, dc: 14 });
});

test('кубик: слово в вопросе исходом не считается; без названного исхода — не cue', () => {
  const q = readDiceRoll('> 🎲 **ПРОВАЛ (4 из 12)** | *Ждёт ли её критический успех?*');
  assert.equal(q.tier, 'fail');
  assert.equal(readDiceRoll('Бросаю кубик 🎲 и надеюсь на лучшее'), null);
  assert.equal(readDiceRoll('Я сдала на УСПЕХ!'), null, 'без 🎲 и без заметки — просто слова');
  assert.equal(readDiceRoll(''), null);
  assert.equal(readDiceRoll(undefined), null);
});

test('кубик: грань вне d20 — не бросок', () => {
  const odd = readDiceRoll('🎲 успех (37 / DC 12)');
  assert.equal(odd.tier, 'success');
  assert.equal(odd.roll, null);
  assert.equal(odd.dc, 12);
});

// --- ступень → оценка --------------------------------------------------------

test('externalValue: ступень соседа — значение с НАШЕЙ лестницы', () => {
  // Экзамен вуза: 5/4/3 проходные, 2 — нет.
  assert.equal(externalValue(preset, 'exam', { tier: 'critSuccess', roll: 20, dc: null }), '5');
  assert.equal(externalValue(preset, 'exam', { tier: 'critFail', roll: 1, dc: null }), '2');
  assert.equal(externalValue(preset, 'exam', { tier: 'fail', roll: 5, dc: 12 }), '2');
  // Успех: запас над DC соседа тянет вверх, как у своего броска, но не до высшей.
  assert.equal(externalValue(preset, 'exam', { tier: 'success', roll: 12, dc: 12 }), '3');
  assert.equal(externalValue(preset, 'exam', { tier: 'success', roll: 19, dc: 10 }), '4');
  // Зачёт: одна проходная ступень.
  assert.equal(externalValue(preset, 'credit', { tier: 'success', roll: 12, dc: 12 }), 'зачёт');
  assert.equal(externalValue(preset, 'credit', { tier: 'fail', roll: 2, dc: 12 }), 'незачёт');
  assert.equal(externalValue(preset, 'exam', { tier: 'странное' }), '');
  assert.equal(externalValue(preset, 'exam', null), '');
});

// --- маршрут ----------------------------------------------------------------

test('sitExam с кубиком: исход — по ступени соседа, через resolveConflict с source: dice', () => {
  // Своя кость на максимуме — Academy дала бы сдачу; кубик соседа — провал.
  const res = sitExam(inSession(), preset, { examId: '0:physics:exam', rng: () => 0.99, dice: { tier: 'fail', roll: 4, dc: 12 } });
  assert.equal(res.exam.value, '2');
  assert.equal(isPassing(preset, res.exam.value), false);
  assert.equal(res.divergence.source, 'dice');
  assert.equal(res.divergence.applied, true);
  assert.deepEqual(res.exam.external, { source: 'dice', tier: 'fail', roll: 4, dc: 12, value: '2' });
  // Свой бросок не пропал: в истории видно, что дала бы Academy.
  const item = res.state.exams.items.find((i) => i.id === '0:physics:exam');
  assert.equal(item.rolls.length, 1);
  assert.notEqual(item.rolls[0].value, '2');
  // Вердикт снят как ложь и поставлен заново — уже с итогом кубика: кубик
  // велел модели отыграть «провал», а оценку ей всё ещё знать надо.
  const verdicts = res.state.pending.filter((p) => p.kind === 'exam');
  assert.equal(verdicts.length, 1);
  assert.match(verdicts[0].text, /неудовлетворительно/);
  // Журнал: расхождение с меткой источника.
  assert.ok(res.state.journal.some((e) => e.data && e.data.source === 'dice' && e.data.modelSaid === '2'));
});

test('sitExam: версия модели сильнее кубика — она написана ответом на него', () => {
  const res = sitExam(inSession(), preset, {
    examId: '0:physics:exam', rng: () => 0.5, modelSaid: '4', dice: { tier: 'fail', roll: 4, dc: 12 },
  });
  assert.equal(res.exam.value, '4');
  assert.equal(res.exam.external, undefined);
  assert.equal((res.divergence || {}).source, undefined);
});

test('sitExam: кубик совпал с посчитанным — расхождения нет, вердикт остаётся', () => {
  // Своя кость внизу — провал; кубик соседа тоже провал.
  const res = sitExam(inSession(), preset, { examId: '0:physics:exam', rng: () => 0, dice: { tier: 'critFail', roll: 1, dc: null } });
  assert.equal(res.exam.value, '2');
  assert.equal(res.divergence, null);
  assert.equal(res.state.pending.filter((p) => p.kind === 'exam').length, 1);
});

test('sitExam: автомат кубиком не переигрывается', () => {
  const s = inSession();
  s.subjects.find((x) => x.id === 'physics').grades = [{ value: '5', day: '2024-10-01' }, { value: '5', day: '2024-11-01' }];
  const res = sitExam(s, preset, { examId: '0:physics:exam', rng: () => 0.5, dice: { tier: 'critFail', roll: 1, dc: null } });
  assert.equal(res.exam.reason, 'auto');
  assert.equal(res.exam.value, 'автомат');
  assert.equal(res.exam.external, undefined);
});

test('applyResponse: opts.dice доезжает до sitExam при opts.exam', () => {
  const run = applyResponse(inSession(), 'Она вытянула билет.', preset, {
    exam: true, examId: '0:physics:exam', rng: () => 0.99, dice: readDiceRoll(egCue.critFailure()),
  });
  assert.equal(run.exam.value, '2');
  assert.equal(run.divergence.source, 'dice');
});

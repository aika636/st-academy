import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseMarker, stripMarker, MARKER_RE } from '../core/parse-marker.mjs';

const preset = JSON.parse(fs.readFileSync(new URL('../presets/ru-university.json', import.meta.url), 'utf8'));

// Предметы и преподаватели живут в состоянии, а не в пресете, поэтому парсеру
// приходит склейка. Имена — из прогона probe-marker.mjs: именно их модель и писала.
const ctx = {
  ...preset,
  subjects: [
    { id: 'chemistry', name: 'аналитическая химия' },
    { id: 'physics', name: 'физика' },
    { id: 'cs', name: 'информатика' },
  ],
  teachers: [
    { id: 'petrova', name: 'Петрова' },
    { id: 'grinev', name: 'Гринёв' },
  ],
};

const one = (text) => parseMarker(text, ctx);

test('канонический вид: t, grade, rel одним блоком', () => {
  const r = one('Пост.\n\n<!-- [ACADEMY t=+1 grade=physics:5 rel=petrova:-1] -->');
  assert.equal(r.found, true);
  assert.deepEqual(r.rejected, []);
  assert.deepEqual(r.events, [
    { kind: 'time', unit: 'period', n: 1 },
    { kind: 'grade', subjectId: 'physics', value: '5' },
    { kind: 'rel', teacherId: 'petrova', delta: -1 },
  ]);
});

test('метки нет — found=false, событий нет', () => {
  const r = one('Обычный пост без всякой метки. Академия, кстати, тоже упоминается.');
  assert.equal(r.found, false);
  assert.deepEqual(r.events, []);
});

test('снисходительность: регистр, пробелы вокруг =, порядок, повтор ключа', () => {
  const r = one('<!--   [[Academy   ОЦЕНКА = physics : 4 ,  T = +2 ,  t=+1]]  -->');
  assert.deepEqual(r.rejected, []);
  assert.deepEqual(r.events, [
    { kind: 'grade', subjectId: 'physics', value: '4' },
    { kind: 'time', unit: 'period', n: 2 },
    { kind: 'time', unit: 'period', n: 1 },
  ]);
});

test('одинарные скобки без HTML-комментария тоже разбираются', () => {
  const r = one('Текст.\n[ACADEMY t=+day]');
  assert.equal(r.found, true);
  assert.deepEqual(r.events, [{ kind: 'time', unit: 'day', n: 1 }]);
});

test('русские имена ключей', () => {
  const r = one('<!-- [ACADEMY время=+1 отношение=гринёв:+2 прогул=информатика] -->');
  assert.deepEqual(r.rejected, []);
  assert.deepEqual(r.events, [
    { kind: 'time', unit: 'period', n: 1 },
    { kind: 'rel', teacherId: 'grinev', delta: 2 },
    { kind: 'attendance', subjectId: 'cs', status: 'skip' },
  ]);
});

test('неизвестные ключи игнорируются молча, остальное применяется', () => {
  const r = one('<!-- [ACADEMY t=+1 mood=веселье xp=100] -->');
  assert.deepEqual(r.events, [{ kind: 'time', unit: 'period', n: 1 }]);
  assert.deepEqual(r.rejected, []);
});

// --- поправка 1 замера B: пробел внутри значения ---------------------------

test('поправка 1: предмет из двух слов через пробел', () => {
  // Живая строка прогона: grade=аналитическая химия:4. Разбиение блока по
  // пробелам сломало бы её и вместе с ней ещё 3 оценки из 11.
  const r = one('<!-- [ACADEMY t=+1 grade=аналитическая химия:4 rel=петрова:-2] -->');
  assert.deepEqual(r.rejected, []);
  assert.deepEqual(r.events, [
    { kind: 'time', unit: 'period', n: 1 },
    { kind: 'grade', subjectId: 'chemistry', value: '4' },
    { kind: 'rel', teacherId: 'petrova', delta: -2 },
  ]);
});

test('поправка 1: тот же предмет через подчёркивание — тот же id', () => {
  const r = one('<!-- [ACADEMY t=+1 grade=аналитическая_химия:зачёт rel=петрова:+1] -->');
  assert.deepEqual(r.rejected, []);
  assert.deepEqual(r.events, [
    { kind: 'time', unit: 'period', n: 1 },
    { kind: 'grade', subjectId: 'chemistry', value: 'зачёт' },
    { kind: 'rel', teacherId: 'petrova', delta: 1 },
  ]);
});

test('поправка 1: значение с пробелом стоит последним в блоке', () => {
  const r = one('<!-- [ACADEMY t=+1 late=аналитическая химия] -->');
  assert.deepEqual(r.events, [
    { kind: 'time', unit: 'period', n: 1 },
    { kind: 'attendance', subjectId: 'chemistry', status: 'late' },
  ]);
});

// --- поправка 2 замера B: оценка не числом ---------------------------------

test('поправка 2: «автомат» и «зачёт» — законные оценки из пресета', () => {
  const a = one('<!-- [ACADEMY t=+0 grade=физика:автомат rel=гринёв:+1] -->');
  assert.deepEqual(a.rejected, []);
  assert.deepEqual(a.events[1], { kind: 'grade', subjectId: 'physics', value: 'автомат' });

  const b = one('<!-- [ACADEMY t=+1 grade=физика:зачет] -->');   // алиас без «ё»
  assert.deepEqual(b.rejected, []);
  assert.deepEqual(b.events[1], { kind: 'grade', subjectId: 'physics', value: 'зачёт' });
});

test('поправка 2: неизвестная оценка уходит в rejected, а не в зачётку', () => {
  const r = one('<!-- [ACADEMY t=+1 grade=физика:отлично_с_плюсом] -->');
  assert.deepEqual(r.events, [{ kind: 'time', unit: 'period', n: 1 }]);
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /неизвестная оценка/);
  assert.match(r.rejected[0].raw, /отлично_с_плюсом/);
});

test('поправка 2: оценка вне шкалы пресета — не число из диапазона', () => {
  // «6» синтаксически похожа на оценку, но в списке значений её нет.
  const r = one('<!-- [ACADEMY grade=физика:6] -->');
  assert.deepEqual(r.events, []);
  assert.equal(r.rejected.length, 1);
});

// --- поправка 3 замера B: t=+0 ---------------------------------------------

test('поправка 3: t=+0 — законное «сцена продолжается»', () => {
  const r = one('<!-- [ACADEMY t=+0] -->');
  assert.deepEqual(r.rejected, []);
  assert.deepEqual(r.events, [{ kind: 'time', unit: 'period', n: 0 }]);
});

// --- поправка 4 замера B: выдуманная единица -------------------------------

test('поправка 4: t=+night не применяется и уходит в rejected', () => {
  const r = one('<!-- [ACADEMY t=+night] -->');
  assert.deepEqual(r.events, []);
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /неизвестная единица времени/);
});

test('поправка 4: мусор в одном значении не отменяет остальные события блока', () => {
  const r = one('<!-- [ACADEMY t=+night grade=физика:5 rel=петрова:+1 skip=астрология] -->');
  assert.deepEqual(r.events, [
    { kind: 'grade', subjectId: 'physics', value: '5' },
    { kind: 'rel', teacherId: 'petrova', delta: 1 },
  ]);
  assert.equal(r.rejected.length, 2);
  assert.match(r.rejected[1].reason, /неизвестный предмет/);
});

// --- единицы времени -------------------------------------------------------

test('единицы времени: день, неделя, пара, с числом и без', () => {
  const got = one('<!-- [ACADEMY t=+day] --><!-- [ACADEMY t=+week] --><!-- [ACADEMY t=+2 пары] -->'
    + '<!-- [ACADEMY t=3] --><!-- [ACADEMY t=+1 неделю] -->').events;
  assert.deepEqual(got, [
    { kind: 'time', unit: 'day', n: 1 },
    { kind: 'time', unit: 'week', n: 1 },
    { kind: 'time', unit: 'period', n: 2 },
    { kind: 'time', unit: 'period', n: 3 },
    { kind: 'time', unit: 'week', n: 1 },
  ]);
});

// --- нестрогое сопоставление имён ------------------------------------------

test('id, имя, регистр и ё сопоставляются нестрого', () => {
  const r = one('<!-- [ACADEMY rel=ГРИНЕВ:+1 grade=Физика:4 skip=cs] -->');
  assert.deepEqual(r.rejected, []);
  assert.deepEqual(r.events, [
    { kind: 'rel', teacherId: 'grinev', delta: 1 },
    { kind: 'grade', subjectId: 'physics', value: '4' },
    { kind: 'attendance', subjectId: 'cs', status: 'skip' },
  ]);
});

test('неизвестный преподаватель и битая дельта — в rejected', () => {
  const r = one('<!-- [ACADEMY rel=сидоров:+1 rel=петрова:очень] -->');
  assert.deepEqual(r.events, []);
  assert.equal(r.rejected.length, 2);
  assert.match(r.rejected[0].reason, /неизвестный преподаватель/);
  assert.match(r.rejected[1].reason, /дельта отношения не число/);
});

test('пустое значение не съедает следующий ключ', () => {
  const r = one('<!-- [ACADEMY grade= t=+1] -->');
  assert.deepEqual(r.events, [{ kind: 'time', unit: 'period', n: 1 }]);
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /пустое значение/);
});

// --- stripMarker -----------------------------------------------------------

test('stripMarker снимает блок и не трогает остальной текст', () => {
  const mes = 'Петрова подняла глаза.\n\n— Опоздали.\n\n<!-- [ACADEMY t=+1 late=физика] -->';
  assert.equal(stripMarker(mes), 'Петрова подняла глаза.\n\n— Опоздали.');
  // исходное сообщение не тронуто: расширение никогда не редактирует mes
  assert.match(mes, /ACADEMY/);
});

test('stripMarker снимает несколько блоков и переживает текст без метки', () => {
  assert.equal(stripMarker('a<!-- [ACADEMY t=+1] -->b<!-- [ACADEMY t=+0] -->'), 'ab');
  assert.equal(stripMarker('просто текст'), 'просто текст');
  assert.equal(stripMarker(''), '');
});

// --- живой материал прогона ------------------------------------------------

test('все метки из прогона probe-glm-5.1 разбираются без потерь', () => {
  const raw = fs.readFileSync(new URL('../tools/out/probe-glm-5.1-full.json', import.meta.url), 'utf8');
  const markers = raw.match(/<!--\s*\[ACADEMY[^>]*-->/gi) || [];
  assert.ok(markers.length >= 20, `меток в прогоне: ${markers.length}`);

  let withTime = 0;
  for (const m of markers) {
    const r = parseMarker(m, ctx);
    assert.equal(r.found, true, m);
    // единственный неразобранный случай из шестидесяти — t=+night, он в коротком
    // варианте прогона; в полном все значения обязаны разбираться
    assert.deepEqual(r.rejected, [], m);
    if (r.events.some((e) => e.kind === 'time')) withTime++;
  }
  assert.equal(withTime, markers.length, 't= есть в каждой метке прогона');
});

test('MARKER_RE экспортирован и находит метку', () => {
  const re = new RegExp(MARKER_RE.source, MARKER_RE.flags);
  assert.ok(re.test('<!-- [ACADEMY t=+1] -->'));
});

// test/holidays — праздники и мероприятия (`core/holidays.mjs`), их фон в строке
// состояния (`prompt.mjs`) и блок на «Сегодня» (`ui.holidaysView`).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  holidaysOf, holidaysOn, holidaysAhead, holidayBackground, holidayDayIndex, DEFAULT_LEAD,
  eventsOf, addEvent, removeEvent, armHolidayHooks, hookText, occurrenceKey, MAX_EVENTS,
  vacationsOf, mergeVacations,
} from '../core/holidays.mjs';
import { applyResponse } from '../core/engine.mjs';
import { validateState, cloneState } from '../core/state.mjs';
import { normalizePreset, BUILTIN_PRESETS } from '../core/preset.mjs';
import { createState } from '../core/state.mjs';
import { statusLine, countNumbers } from '../prompt.mjs';
import { holidaysView, ownEventsView } from '../ui.js';

const load = (id) => JSON.parse(
  readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'),
);
const ru = load('ru-university');

const P = {
  holidays: [
    { id: 'ball', name: 'Зимний бал', from: '12-27', lead: 5, buzz: 'все ищут пару', today: 'вечером бал' },
    { id: 'ny', name: 'Новый год', from: '12-31', to: '01-01' },
    { name: 'без даты' },
    { id: 'quiet', name: 'Тихий день', from: '03-01', lead: 0 },
  ],
};

test('holidaysOf: битые записи отброшены, умолчания доложены', () => {
  const list = holidaysOf(P);
  assert.deepEqual(list.map((h) => h.id), ['ball', 'ny', 'quiet']);
  const ny = list.find((h) => h.id === 'ny');
  assert.equal(ny.lead, DEFAULT_LEAD);
  assert.equal(ny.buzz, '');
  assert.equal(list.find((h) => h.id === 'ball').to, '12-27', 'однодневный: to = from');
  assert.deepEqual(holidaysOf({}), []);
  assert.deepEqual(holidaysOf(null), []);
});

test('holidaysOn: однодневный, многодневный и через Новый год', () => {
  assert.deepEqual(holidaysOn(P, '2026-12-27').map((h) => h.id), ['ball']);
  assert.deepEqual(holidaysOn(P, '2026-12-31').map((h) => h.id), ['ny']);
  assert.deepEqual(holidaysOn(P, '2027-01-01').map((h) => h.id), ['ny']);
  assert.deepEqual(holidaysOn(P, '2027-01-02'), []);
});

test('holidaysAhead: начала впереди, ближние первыми; идущий праздник не «впереди»', () => {
  const ahead = holidaysAhead(P, '2026-12-25', 14);
  assert.deepEqual(ahead.map((a) => [a.holiday.id, a.days]), [['ball', 2], ['ny', 6]]);
  assert.deepEqual(holidaysAhead(P, '2027-01-01', 3), []);
});

test('holidayBackground: впереди — только в пределах lead и только ближайший', () => {
  assert.equal(holidayBackground(P, '2026-12-20').ahead, null, 'за семь дней бал с lead 5 ещё не слышен');
  assert.equal(holidayBackground(P, '2026-12-23').ahead.holiday.id, 'ball');
  const bg = holidayBackground(P, '2026-12-28');
  assert.deepEqual(bg.now, []);
  assert.equal(bg.ahead.holiday.id, 'ny');
  assert.equal(holidayBackground(P, '2027-02-28').ahead, null, 'lead 0 — только в сам день');
});

test('holidayDayIndex: какой по счёту день праздника', () => {
  const ny = holidaysOf(P).find((h) => h.id === 'ny');
  assert.equal(holidayDayIndex(ny, '2026-12-31'), 0);
  assert.equal(holidayDayIndex(ny, '2027-01-01'), 1);
  assert.equal(holidayDayIndex(ny, '2027-01-05'), null);
});

test('пресет: битые праздники — претензия, а не молчаливый пропуск', () => {
  const builtins = { 'ru-university': ru };
  const bad = normalizePreset({ ...ru, id: 'x', holidays: [{ name: '', from: '13-01', lead: 30 }] }, { builtins });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => e.includes('holidays[1].name')));
  assert.ok(bad.errors.some((e) => e.includes('holidays[1].from')));
  assert.ok(bad.errors.some((e) => e.includes('holidays[1].lead')));
  assert.equal(normalizePreset({ ...ru, id: 'x', holidays: 'бал' }, { builtins }).ok, false);
  assert.equal(normalizePreset({ ...ru, id: 'x', holidays: [] }, { builtins }).ok, true);
});

test('каждый встроенный пресет приносит праздники, и они все годные', () => {
  for (const id of BUILTIN_PRESETS) {
    const p = load(id);
    assert.ok(Array.isArray(p.holidays) && p.holidays.length >= 8, `${id}: праздников мало`);
    assert.equal(holidaysOf(p).length, p.holidays.length, `${id}: часть праздников битая`);
    for (const h of p.holidays) {
      assert.equal(/\d/.test(`${h.buzz}${h.today}`), false, `${id}: цифры в фоне «${h.name}»`);
    }
  }
});

function stateOn(preset, day) {
  const subjects = [{ id: 'a', name: 'Алгебра', teacherId: 't' }];
  const s = createState(preset, { startDay: day, subjects, teachers: [{ id: 't', name: 'Т' }] });
  s.started = true;
  return s;
}

test('строка состояния: праздник сегодня и фон перед ним — словами, без чисел', () => {
  const preset = { ...ru, holidays: P.holidays };
  const today = statusLine(stateOn(preset, '2026-12-27'), preset);
  assert.match(today, /[Сс]егодня Зимний бал — вечером бал/);

  const before = statusLine(stateOn(preset, '2026-12-25'), preset);
  assert.match(before, /Зимний бал — все ищут пару/);
  assert.match(before, /[Вв] воскресенье Зимний бал/, before);

  const quiet = statusLine(stateOn(preset, '2026-12-10'), preset);
  assert.equal(/Зимний бал|Новый год/.test(quiet), false, quiet);

  const seg = before.split('. ').find((x) => x.includes('Зимний бал'));
  assert.equal(countNumbers(seg), 0);
});

test('«Сегодня»: блок праздников — сегодня и впереди, не больше трёх', () => {
  const preset = { ...ru, holidays: P.holidays };
  const list = holidaysView(stateOn(preset, '2026-12-27'), preset);
  assert.deepEqual(list.map((h) => h.id), ['ball', 'ny']);
  assert.equal(list[0].whenLine, 'сегодня');
  assert.equal(list[0].note, 'вечером бал');
  assert.equal(list[1].whenLine, 'через 4 дня — чт, 31 декабря');
  assert.deepEqual(holidaysView(null, preset), []);
});

// --- свои события чата и разовый повод ---------------------------------------

test('своё событие: заводится с id, проверяется и убирается', () => {
  const s0 = stateOn(ru, '2026-10-01');
  assert.equal(addEvent(s0, { name: '', from: '2026-10-03' }).ok, false);
  assert.equal(addEvent(s0, { name: 'Вечеринка', from: '3 октября' }).ok, false);
  assert.equal(addEvent(s0, { name: 'Вечеринка', from: '2026-10-05', to: '2026-10-04' }).ok, false);

  const a = addEvent(s0, { name: 'Вечеринка у Миражи', from: '2026-10-03', hook: 'Мираж зовёт танцевать', buzz: '' });
  assert.equal(a.ok, true);
  assert.equal(s0.events, undefined, 'исходное состояние не тронуто');
  assert.deepEqual(a.state.events[0], {
    id: a.event.id, name: 'Вечеринка у Миражи', from: '2026-10-03', hook: 'Мираж зовёт танцевать',
  });
  const b = addEvent(a.state, { name: 'Вечеринка у Миражи', from: '2026-10-03' });
  assert.notEqual(b.event.id, a.event.id, 'одинаковые события не сливаются');
  assert.equal(validateState(b.state, ru).ok, true);

  const r = removeEvent(b.state, a.event.id);
  assert.deepEqual(r.state.events.map((e) => e.id), [b.event.id]);
  assert.equal(removeEvent(r.state, 'нет-такого').ok, false);

  let full = s0;
  for (let i = 0; i < MAX_EVENTS; i += 1) full = addEvent(full, { name: `e${i}`, from: '2026-10-03' }).state;
  assert.equal(addEvent(full, { name: 'ещё', from: '2026-10-03' }).ok, false);
});

test('своё событие видно наравне с праздниками: фон, сегодня, впереди', () => {
  const s = addEvent(stateOn(ru, '2026-10-01'), {
    name: 'Вечеринка у Миражи', from: '2026-10-03', to: '2026-10-04', buzz: 'все спорят, кого позовут',
  }).state;
  assert.equal(eventsOf(s).length, 1);
  assert.equal(holidayBackground({}, '2026-10-01', s).ahead.holiday.name, 'Вечеринка у Миражи');
  assert.deepEqual(holidaysOn({}, '2026-10-04', s).map((h) => h.name), ['Вечеринка у Миражи']);
  assert.deepEqual(holidaysOn({}, '2027-10-03', s), [], 'своё событие — с годом и не повторяется');
  assert.match(statusLine(s, { ...ru, holidays: [] }), /Вечеринка у Миражи — все спорят/);

  const view = holidaysView(s, { ...ru, holidays: [] });
  assert.equal(view[0].own, true);
  assert.deepEqual(ownEventsView(s).map((e) => e.name), ['Вечеринка у Миражи']);
  s.calendar.day = '2026-10-10';
  assert.equal(ownEventsView(s)[0].past, true);
});

test('валидация: битые свои события и поводы ловятся', () => {
  const s = stateOn(ru, '2026-10-01');
  assert.equal(validateState({ ...s, events: 'x' }, ru).ok, false);
  assert.equal(validateState({ ...s, events: [{ name: 'a', from: 'вчера' }] }, ru).ok, false);
  assert.equal(validateState({ ...s, events: [{ name: 'a', from: '2026-10-05', to: '2026-10-01' }] }, ru).ok, false);
  assert.equal(validateState({ ...s, holidayHooks: 'x' }, ru).ok, false);
});

test('разовый повод: один раз за наступление, с поводом или фоном', () => {
  const preset = { ...ru, holidays: P.holidays };
  const ball = holidaysOf(preset).find((h) => h.id === 'ball');
  assert.match(hookText(ball, preset), /^Сегодня Зимний бал — вечером бал\. Если уместно/);
  assert.match(hookText({ ...ball, hook: 'соперница приходит в том же платье' }, preset),
    /Если уместно, можно вплести в сцену: соперница приходит в том же платье/);
  assert.match(hookText(ball, { ...preset, phrases: { holidays: { hookBare: 'Праздник: {name}.' } } }), /^Праздник: Зимний бал\.$/);

  const s = stateOn(preset, '2026-12-27');
  assert.deepEqual(armHolidayHooks(s, preset), ['ball@2026-12-27']);
  assert.equal(s.pending.length, 1);
  assert.equal(s.pending[0].kind, 'holiday');
  assert.deepEqual(armHolidayHooks(s, preset), [], 'второй раз в то же наступление — тишина');

  const ny = holidaysOf(preset).find((h) => h.id === 'ny');
  assert.equal(occurrenceKey(ny, '2027-01-01'), 'ny@2026-12-31', 'середина праздника — ключ его начала');
  assert.equal(occurrenceKey(ny, '2027-03-01'), null);

  const notStarted = stateOn(preset, '2026-12-27');
  notStarted.started = false;
  assert.deepEqual(armHolidayHooks(notStarted, preset), []);
});

test('движок: ответ в день праздника отдаёт повод одноразовым инжектом, следующий — нет', () => {
  const preset = { ...ru, holidays: P.holidays };
  const s = stateOn(preset, '2026-12-27');
  const first = applyResponse(s, 'Сцена.\n<!-- [ACADEMY t=+1] -->', preset, { mode: 'marker' });
  const hook = first.injects.find((i) => i.kind === 'holiday');
  assert.ok(hook, 'повод пришёл');
  assert.match(hook.text, /Зимний бал/);
  assert.deepEqual(first.state.holidayHooks, ['ball@2026-12-27']);

  const second = applyResponse(first.state, 'Ещё сцена.\n<!-- [ACADEMY t=+1] -->', preset, { mode: 'marker' });
  assert.equal(second.injects.some((i) => i.kind === 'holiday'), false);

  // Свайп — это снимок до хода: в нём повод ещё не звучал и прозвучит снова.
  const swiped = applyResponse(cloneState(s), 'Другая сцена.\n<!-- [ACADEMY t=+1] -->', preset, { mode: 'marker' });
  assert.ok(swiped.injects.some((i) => i.kind === 'holiday'));
});

// --- каникулы: `off: true` у праздника и своего события, каникулы пресета ----

test('каникулы: праздник и своё событие с off выключают пары, без off — нет', async () => {
  const { isVacation, isStudyDay, phaseOf } = await import('../core/time.mjs');
  const { dayPlan } = await import('../core/schedule.mjs');
  const preset = { ...ru, holidays: [{ id: 'founders', name: 'День основания', from: '10-06', off: true }, { id: 'fair', name: 'Ярмарка', from: '10-08' }] };
  const { buildSchedule } = await import('../core/schedule.mjs');
  const withSchedule = () => {
    const st = stateOn(preset, '2026-10-05');
    st.schedule = buildSchedule(st.subjects, preset);
    return st;
  };
  const s = addEvent(withSchedule(), { name: 'карантин', from: '2026-10-07', to: '2026-10-08', off: true }).state;
  assert.equal(s.events[0].off, true);

  assert.equal(isVacation(preset, '2026-10-06'), true, 'праздник пресета с off — каникулы и без состояния');
  assert.equal(isVacation(preset, '2026-10-07'), false, 'своё событие без состояния не видно');
  assert.equal(isVacation(preset, '2026-10-07', s), true);
  assert.equal(isStudyDay(preset, '2026-10-08', s), false, 'последний день карантина');
  assert.equal(phaseOf(preset, s, '2026-10-07'), 'vacation');
  assert.equal(phaseOf(preset, s, '2026-10-09'), 'study', 'после карантина — снова учёба');

  assert.ok(dayPlan(s, preset, '2026-10-05').length > 0, 'в понедельник пары есть');
  assert.deepEqual(dayPlan(s, preset, '2026-10-06'), []);
  assert.deepEqual(dayPlan(s, preset, '2026-10-07'), []);
  assert.ok(dayPlan(s, preset, '2026-10-09').length > 0);

  const plain = addEvent(withSchedule(), { name: 'вечеринка', from: '2026-10-07' }).state;
  assert.equal('off' in plain.events[0], false, 'без отметки поле не пишется');
  assert.ok(dayPlan(plain, preset, '2026-10-07').length > 0, 'обычное событие пары не отменяет');
});

test('каникулы пресета видны в блоке праздников и в строке состояния заранее', () => {
  const s = stateOn(ru, '2026-11-02');
  const ahead = holidaysView(s, ru).find((h) => h.name === 'Ноябрьские');
  assert.ok(ahead, 'ноябрьские впереди');
  assert.equal(ahead.off, true);
  assert.equal(ahead.offLine, 'занятий нет', 'пометка отдельной строкой, а не в склейке с датой');
  assert.match(statusLine(s, ru), /Ноябрьские/);

  const during = holidaysView(stateOn(ru, '2026-11-05'), ru).find((h) => h.name === 'Ноябрьские');
  assert.equal(during.days, 0);
  assert.equal(during.offLine, 'занятий нет до субботы, 7 ноября', 'день недели в родительном');
});

test('каникулы: повод без своего текста говорит «занятий нет», бал внутри каникул не вытеснен', () => {
  const v = { name: 'зимние каникулы', off: true, hook: '', today: '' };
  assert.match(hookText(v, {}), /зимние каникулы; занятий нет/);
  const preset = { ...ru, calendar: { ...ru.calendar, vacations: [{ name: 'зимние', from: '12-25', to: '01-08' }] }, holidays: P.holidays };
  assert.deepEqual(holidaysOn(preset, '2026-12-27').map((h) => h.id), ['ball', 'vacation-1']);
  const s = stateOn(preset, '2026-12-27');
  assert.deepEqual(armHolidayHooks(s, preset), ['ball@2026-12-27', 'vacation-1@2026-12-25']);
});

test('валидация: off — только да или нет', () => {
  const builtins = { 'ru-university': ru };
  const s = stateOn(ru, '2026-10-05');
  s.events = [{ id: 'x', name: 'x', from: '2026-10-07', off: 'да' }];
  assert.equal(validateState(s).ok, false);
  const res = normalizePreset({ ...ru, id: 'x', holidays: [{ name: 'x', from: '10-06', off: 'yes' }] }, { builtins });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes('.off')), res.errors.join('; '));
  assert.equal(normalizePreset({ ...ru, id: 'x', holidays: [{ name: 'x', from: '10-06', off: true }] }, { builtins }).ok, true);
});

// --- живой прогон 07.10: дубли, пунктуация, два события в день ---------------

test('праздник и каникулы с тем же именем и датами — одно событие с «занятий нет»', () => {
  const jp = load('jp-highschool');
  const on = holidaysOn(jp, '2026-05-03').filter((h) => /золотая неделя/i.test(h.name));
  assert.equal(on.length, 1, 'Золотая неделя одна');
  assert.equal(on[0].off, true);
  assert.equal(on[0].id, 'golden-week');
  assert.equal(holidaysOn(jp, '2026-05-06').some((h) => /золотая/i.test(h.name)), true, 'общий срок — до конца каникул');

  const line = statusLine(stateOn(jp, '2026-05-03'), jp);
  assert.equal(line.match(/золот/gi).length, 1, line);
  const s = stateOn(jp, '2026-04-29');
  assert.equal(armHolidayHooks(s, jp).filter((k) => /golden|vacation/.test(k)).length, 1, 'повод один');

  const us = load('us-highschool');
  assert.equal(holidaysOn(us, '2026-11-27').length, 1, 'День благодарения и его каникулы — одно');
  assert.equal(holidaysOn(us, '2026-11-27')[0].name, 'День благодарения');
});

test('во всех двенадцати пресетах каникулы-двойники праздников слиты', () => {
  for (const id of BUILTIN_PRESETS) {
    const p = load(id);
    const { pairs } = mergeVacations(holidaysOf(p), vacationsOf(p));
    for (let d = 0; d < 366; d += 1) {
      const day = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
      const names = holidaysOn(p, day).map((h) => h.name.toLowerCase());
      for (const { holiday, vacation } of pairs) {
        const twins = names.filter((n) => n === vacation.name.toLowerCase() || n === holiday.name.toLowerCase());
        assert.ok(twins.length <= 1, `${id} ${day}: «${holiday.name}» и «${vacation.name}» показаны дважды`);
      }
    }
  }
});

test('каникулы — с заглавной, как праздники', () => {
  assert.deepEqual(vacationsOf(ru).map((v) => v.name), ['Ноябрьские']);
  assert.equal(vacationsOf({ calendar: { vacations: [{ from: '01-01', to: '01-02' }] } })[0].name, 'Каникулы');
});

test('пунктуация: точка в конце buzz и today не удваивается', () => {
  const preset = { ...ru, holidays: [
    { id: 'a', name: 'Обед', from: '10-07', today: 'все едят бэнто.', buzz: 'ждут.' },
    { id: 'b', name: 'Танцы', from: '10-09', lead: 3, buzz: 'все держатся за руки.' },
  ] };
  const line = statusLine(stateOn(preset, '2026-10-07'), preset);
  assert.equal(/\.\.|\.;|\.,/.test(line), false, line);
  assert.match(line, /Сегодня Обед — все едят бэнто\. /, line);
  assert.match(line, /В пятницу Танцы — все держатся за руки\./, line);
  const hook = hookText(holidaysOf(preset)[0], preset);
  assert.equal(hook.includes('..'), false, hook);
  assert.match(hook, /^Сегодня Обед — все едят бэнто\. Если уместно/);
});

test('два события в один день: впереди оба, но не больше двух', () => {
  const preset = { ...ru, holidays: [
    { id: 'concert', name: 'Концерт', from: '10-09', buzz: 'репетируют' },
    { id: 'prom', name: 'Бал выпускников', from: '10-09', buzz: 'ищут пару' },
    { id: 'third', name: 'Ярмарка', from: '10-09' },
    { id: 'later', name: 'Поход', from: '10-10' },
  ] };
  const bg = holidayBackground(preset, '2026-10-07');
  assert.deepEqual(bg.aheadAll.map((a) => a.holiday.id), ['concert', 'prom']);
  assert.equal(bg.ahead.holiday.id, 'concert');
  const line = statusLine(stateOn(preset, '2026-10-07'), preset);
  assert.match(line, /В пятницу Концерт — репетируют, и Бал выпускников — ищут пару\./, line);
  assert.equal(/Ярмарка|Поход/.test(line), false, line);

  const today = { ...ru, holidays: [{ id: 'x', name: 'Концерт', from: '10-07' }, { id: 'y', name: 'Бал', from: '10-07' }] };
  assert.match(statusLine(stateOn(today, '2026-10-07'), today), /Сегодня Концерт и Бал\./);
});

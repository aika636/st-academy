// test/ui-dom — дымовая проверка ВТОРОЙ половины `ui.js`, той, что трогает DOM.
//
// Зачем этот файл вообще есть. Этап 2 закончился признанием: «половина `ui.js`,
// работающая с DOM, не исполнялась ни разу», — и это ровно тот класс кода, где
// опечатка в имени действия, забытый ключ словаря или вызов несуществующей
// функции не видны ни одному чистому тесту вью. Этап 3 дописал в эту половину
// ещё четыре блока (лорбук, выбор пресета, выгрузка, автозаполнение анкеты), и
// оставлять их неисполненными значило бы повторить главный урок проекта в
// третий раз: расхождения находит прогон, а не чтение.
//
// Три решения, из которых вытекает форма файла.
//
// 1. **Это дымовая проверка, а не проверка вёрстки.** Она отвечает на один
//    вопрос: «дерево строится и кнопки доходят до действий, не бросив
//    исключения». Ширину колонок, попадание пальцем и поведение темы таверны
//    так не проверить — они остаются за настоящим браузером, и об этом честно
//    написано в отчёте.
// 2. **`jsdom` не заводится.** У проекта нет ни одной зависимости, и заводить
//    первую ради дымовой проверки — плохая сделка. Заглушка ниже реализует
//    ровно те шесть методов, которыми `ui.js` пользуется; если он начнёт
//    пользоваться седьмым, тест упадёт, и это правильно — значит панель
//    полагается на что-то, чего никто не проверял.
// 3. **Ошибка отрисовки не должна быть зелёной.** `renderPanel` ловит
//    исключение и рисует вместо дерева текст ошибки — то есть панель, упавшая
//    внутри, снаружи выглядит как отрисованная. Поэтому проверка смотрит и на
//    то, что этого текста в дереве нет.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const load = (id) => JSON.parse(
  readFileSync(fileURLToPath(new URL(`../presets/${id}.json`, import.meta.url)), 'utf8'),
);
const preset = load('ru-university');

/* --- заглушка документа ---------------------------------------------------- */

function makeNode(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    attrs: {},
    listeners: {},
    files: [],
    value: '',
    checked: false,
    hidden: false,
    textContent: '',
    className: '',
    isConnected: true,
    classList: {
      set: new Set(),
      add(c) { this.set.add(c); },
      remove(c) { this.set.delete(c); },
      toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); },
      contains(c) { return this.set.has(c); },
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(k, fn) { (this.listeners[k] = this.listeners[k] || []).push(fn); },
    append(...cs) { for (const c of cs) this.children.push(c); },
    remove() {},
    click() {},
    get firstChild() { return this.children[0] || null; },
    removeChild(c) { this.children = this.children.filter((x) => x !== c); },
    /**
     * Кэш по селектору. `renderPanel` берёт `.academy-tabs` и `.academy-body`
     * отдельными вызовами и рассчитывает получить те же самые узлы — заглушка,
     * возвращающая каждый раз новый, молча теряла бы всё дерево вкладки.
     */
    querySelector(sel) {
      this.q = this.q || {};
      if (!this.q[sel]) this.q[sel] = makeNode('div');
      return this.q[sel];
    },
  };
}

globalThis.document = {
  createElement: makeNode,
  getElementById: () => null,
  addEventListener: () => {},
  removeEventListener: () => {},
  body: makeNode('body'),
};
globalThis.window = { addEventListener: () => {}, innerWidth: 360, innerHeight: 780 };
globalThis.URL.createObjectURL = () => 'blob:academy';
globalThis.URL.revokeObjectURL = () => {};

const ui = await import('../ui.js');
const { createState } = await import('../core/state.mjs');
const { buildSchedule } = await import('../core/schedule.mjs');

/* --- материал -------------------------------------------------------------- */

const SUBJECTS = [{ id: 'chem', name: 'аналитическая химия', teacherId: 'petrova' }];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна', traits: ['злопамятна'] }];
/** Подсказка поля «Имя» в таблице наставников — по ней оно и находится в дереве. */
const U_TEACHER_HINT = ui.uiLabels(preset).teacherNameHint;
const U_TEACHER_NONE = ui.uiLabels(preset).teacherNone;

const started = (() => {
  const s = createState(preset, {
    subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
  });
  s.started = true;
  return s;
})();

const LOREBOOK_FULL = {
  enabled: true,
  name: 'Academy chat-1',
  reason: null,
  error: null,
  measure: { entries: 5, chars: 900, tokens: 300, cap: 60, withinCap: true },
  suggest: [{ uid: 'academy:npc:masha', keys: ['Маша', 'Лебедева'], content: 'соседка по общежитию' }],
  orphans: [{ uid: 'academy:chronicle:exam:2024-12-22:chem' }],
};

function fakeHost(state, settings, lorebook, actions = {}) {
  return {
    getState: () => state,
    getReport: () => ({ status: state ? 'ok' : 'empty', state, errors: [] }),
    getPreset: () => preset,
    getSettings: () => settings,
    setSettings: () => {},
    getDebug: () => null,
    markerVisibleRisk: () => false,
    getLorebook: () => lorebook,
    getPresets: () => ({
      active: 'ru-university',
      list: [
        { id: 'ru-university', name: load('ru-university').displayName },
        { id: 'jp-highschool', name: load('jp-highschool').displayName },
        { id: 'magic-academy', name: load('magic-academy').displayName },
      ],
    }),
    actions,
  };
}

/* --- обход дерева ---------------------------------------------------------- */

const nodes = (n) => (n && n.children ? 1 + n.children.reduce((a, c) => a + nodes(c), 0) : 1);

function walk(n, fn) {
  if (!n || typeof n !== 'object' || !n.children) return;
  fn(n);
  for (const c of n.children) walk(c, fn);
}

function openTab(panel, id) {
  const tabs = panel.querySelector('.academy-tabs');
  const tab = tabs.children.find((t) => t.dataset && t.dataset.tab === id);
  assert.ok(tab, `вкладки ${id} нет в полосе`);
  for (const fn of tab.listeners.click || []) fn({ currentTarget: tab });
  return panel.querySelector('.academy-body');
}

/** Панель, смонтированная начисто: модуль держит узлы в одном месте на страницу. */
function mount(host) {
  const api = ui.mountPanel(host);
  api.destroy();
  const fresh = ui.mountPanel(host);
  fresh.render();
  return { api: fresh, node: document.body.children[document.body.children.length - 1] };
}

/* --- проверки -------------------------------------------------------------- */

const CASES = [
  ['семестра нет вовсе', null, {}, { enabled: false }],
  ['семестр идёт, лорбук на месте', started, { lorebook: { enabled: true, book: '' }, debug: true }, LOREBOOK_FULL],
  ['лорбук включён, а World Info в сборке нет', started, { lorebook: { enabled: true, book: 'Моя книга' } },
    { enabled: true, name: '', reason: 'no-world-info', measure: null, suggest: [], orphans: [], error: null }],
  ['лорбук перерос потолок и не обновился', started, { lorebook: { enabled: true } },
    {
      enabled: true,
      name: 'X',
      measure: { entries: 90, chars: 30000, tokens: 9000, cap: 60, withinCap: false },
      suggest: [],
      orphans: [],
      error: 'сеть отвалилась',
      reason: null,
    }],
];

for (const [name, state, settings, lorebook] of CASES) {
  test(`панель строится целиком: ${name}`, () => {
    const { api, node } = mount(fakeHost(state, settings, lorebook));
    for (const tab of ['today', 'gradebook', 'people', 'settings']) {
      const body = openTab(node, tab);
      assert.ok(nodes(body) >= 3, `вкладка ${tab} пуста: узлов ${nodes(body)}`);
      // Упавшая отрисовка снаружи выглядит как отрисованная — ловим её текст.
      let failed = false;
      walk(body, (n) => { if (n.textContent === 'Панель не смогла отрисоваться') failed = true; });
      assert.equal(failed, false, `вкладка ${tab} упала внутри try`);
    }
    api.destroy();
  });
}

test('вкладка настроек: каждый блок на месте и свёрнут', () => {
  const { api, node } = mount(fakeHost(started, { lorebook: { enabled: true } }, LOREBOOK_FULL));
  const body = openTab(node, 'settings');

  const titles = [];
  let details = 0;
  walk(body, (n) => {
    if (n.tagName === 'DETAILS') details += 1;
    if (n.className === 'academy-section-title') titles.push(n.textContent);
  });
  const U = ui.uiLabels(preset);
  for (const want of [U.surveySection, U.planSection, U.presetSection, U.lorebookSection,
    U.transferSection, U.startSection, 'API для генерации', 'Источник времени']) {
    assert.ok(titles.includes(want), `нет блока «${want}»: ${titles.join(' | ')}`);
  }
  // Телефон (3.9): блоки складываются, а не тянутся на два экрана. Семестр уже
  // идёт — значит раскрытых блоков нет ни одного.
  assert.equal(details, titles.length, 'каждый блок — свой <details>');
  let open = 0;
  walk(body, (n) => { if (n.tagName === 'DETAILS' && 'open' in n.attrs) open += 1; });
  assert.equal(open, 0, 'на идущем семестре раскрывать нечего');
  api.destroy();
});

test('вкладка настроек: до старта раскрыт путь «завести семестр»', () => {
  const { api, node } = mount(fakeHost(null, {}, { enabled: false }));
  const body = openTab(node, 'settings');
  const openTitles = [];
  walk(body, (n) => {
    if (n.tagName === 'DETAILS' && 'open' in n.attrs) {
      const head = n.children.find((c) => c.className === 'academy-section-title');
      openTitles.push(head ? head.textContent : '');
    }
  });
  const U = ui.uiLabels(preset);
  assert.deepEqual(openTitles, [U.surveySection, U.planSection, U.startSection],
    'раскрыты ровно анкета, таблица и кнопка старта — и ничего больше');
  api.destroy();
});

test('лорбук: осиротевшие показываются только вместе с кнопкой уборки', () => {
  const U = ui.uiLabels(preset);
  const texts = (lorebook) => {
    const { api, node } = mount(fakeHost(started, { lorebook: { enabled: true } }, lorebook));
    const out = [];
    walk(openTab(node, 'settings'), (n) => { if (n.textContent) out.push(n.textContent); });
    api.destroy();
    return out.join(' | ');
  };

  const withOrphans = texts(LOREBOOK_FULL);
  assert.ok(withOrphans.includes(U.lorebookOrphansTitle));
  assert.ok(withOrphans.includes('Убрать осиротевшие (1)'), 'кнопка названа числом, а не вообще');

  const without = texts({ ...LOREBOOK_FULL, orphans: [] });
  assert.equal(without.includes(U.lorebookOrphansTitle), false,
    'списка «лишнего в вашем World Info» без способа это убрать быть не должно');
});

test('лорбук: пустого экрана не бывает — причина названа словами', () => {
  const reasons = [
    ['no-world-info', /World Info/],
    ['no-chat', /чат/i],
    ['no-state', /заведётся/],
  ];
  for (const [reason, re] of reasons) {
    const view = ui.settingsView(started, { lorebook: { enabled: true } }, preset, {
      lorebook: { enabled: true, name: '', reason, measure: null, suggest: [], orphans: [], error: null },
    });
    assert.match(view.lorebook.explain, re, reason);
  }
});

test('кнопки настроек доходят до действий хоста, а не бросают исключение', async () => {
  const calls = [];
  const actions = {};
  const NAMES = ['exportState', 'importState', 'guessSurvey', 'setPreset', 'syncLorebook',
    'suggestLorebookEntry', 'acceptLorebookSuggestion', 'pruneLorebook', 'generatePlan',
    'setSubjects', 'manualTime', 'testApi', 'listModels'];
  for (const nm of NAMES) {
    actions[nm] = async () => {
      calls.push(nm);
      if (nm === 'exportState') return { ok: true, json: '{"state":{}}', filename: 'academy.json', warnings: [] };
      if (nm === 'listModels') return { ok: true, models: ['gpt'] };
      if (nm === 'pruneLorebook') return { ok: true, removed: 1 };
      return { ok: true };
    };
  }

  const { api, node } = mount(fakeHost(started, { lorebook: { enabled: true } }, LOREBOOK_FULL, actions));
  const body = openTab(node, 'settings');
  const buttons = [];
  walk(body, (n) => { if (n.listeners && n.listeners.click) buttons.push(n); });
  assert.ok(buttons.length >= 8, `кнопок на вкладке ${buttons.length} — слишком мало, дерево не то`);

  for (const b of buttons) await b.listeners.click[0]({ currentTarget: b });
  // Обещания внутри `setSettings` и `runAction` домалывают в микрозадачах.
  await new Promise((resolve) => { setTimeout(resolve, 0); });

  // Швы этапа 3 поимённо: имя действия у панели и у `index.js` должно совпадать,
  // а это ровно тот вид расхождения, который не виден ни одному модульному тесту.
  for (const want of ['exportState', 'guessSurvey', 'setPreset', 'syncLorebook',
    'suggestLorebookEntry', 'acceptLorebookSuggestion', 'pruneLorebook']) {
    assert.ok(calls.includes(want), `кнопка не дошла до actions.${want}: дошли ${calls.join(', ')}`);
  }
  api.destroy();
});

test('видимая метка: предупреждение доходит до экрана, а не остаётся в хосте', () => {
  // Шов, который однажды уже разъехался: `index.js` считал `markerVisibleRisk`,
  // отдавал его панели, а панель не спрашивала — предупреждения не было ни разу.
  const screen = (risk, settings) => {
    const host = fakeHost(started, settings, null);
    host.markerVisibleRisk = () => risk;
    const { api, node } = mount(host);
    const out = [];
    walk(openTab(node, 'settings'), (n) => { if (n.textContent) out.push(n.textContent); });
    api.destroy();
    return out.join(' | ');
  };

  assert.ok(screen(true, { mode: 'auto' }).includes('Encode tags'),
    'таверна экранирует теги, а панель об этом молчит');
  assert.equal(screen(false, { mode: 'auto' }).includes('Encode tags'), false,
    'пугать при выключенной настройке нечем');
  assert.equal(screen(true, { mode: 'context' }).includes('Encode tags'), false,
    'в режиме «из контекста» метка в промпт не идёт');
});

test('кнопка вызова: координаты с широкого монитора зажимаются в узкое окно', () => {
  // Дефект стенда tools/preview (этап 2, телефон): `mountButton` восстанавливал
  // сохранённую точку как есть, и кнопка, которую таскали на мониторе в 1920,
  // на экране в 360 оказывалась целиком за правым краем. Кнопка — единственный
  // вход в панель, и невидимую её не вернуть ничем, кроме правки настроек
  // руками. Окно заглушки — 360×780 (см. globalThis.window выше).
  const px = (v) => Number.parseFloat(String(v));
  const at = (x, y) => {
    const host = fakeHost(started, { ui: { buttonX: x, buttonY: y } }, null);
    const button = ui.mountButton(host);
    const got = { left: px(button.style.left), top: px(button.style.top) };
    button.remove();
    ui.mountPanel(host).destroy(); // сброс mounted.button между прогонами
    return got;
  };

  const far = at(1800, 2000);
  assert.ok(far.left <= 360 - 42, `кнопка за правым краем: left=${far.left}`);
  assert.ok(far.top <= 780 - 42, `кнопка ниже экрана: top=${far.top}`);

  const neg = at(-50, -50);
  assert.equal(neg.left, 0, 'слева кнопка прижимается к нулю, а не уходит в минус');
  assert.equal(neg.top, 0);

  // Точка, которая и так в окне, не трогается: зажим — не переезд.
  const sane = at(100, 200);
  assert.deepEqual(sane, { left: 100, top: 200 });
});

test('панель переживает хост, который не передал ни одного нового геттера', () => {
  // `index.js` и `ui.js` писались порознь; хост без `getLorebook`/`getPresets` —
  // это старая половина рядом с новой, и падать от этого панель не вправе.
  const host = fakeHost(started, {}, null);
  delete host.getLorebook;
  delete host.getPresets;
  const { api, node } = mount(host);
  const body = openTab(node, 'settings');
  let failed = false;
  walk(body, (n) => { if (n.textContent === 'Панель не смогла отрисоваться') failed = true; });
  assert.equal(failed, false);
  api.destroy();
});

/* --- раскрытые блоки и результат действия (правка про «API для генерации») --- */

/** Найти `<details>` по тексту заголовка. */
function findSection(root, title) {
  let found = null;
  walk(root, (n) => {
    if (n.tagName !== 'DETAILS') return;
    const head = n.children.find((c) => c.className === 'academy-section-title');
    if (head && head.textContent === title) found = n;
  });
  return found;
}

/** Раскрытие блока человеком: браузер меняет свойство и шлёт `toggle`. */
function openSection(node) {
  node.open = true;
  for (const fn of node.listeners.toggle || []) fn();
}

test('раскрытый блок настроек переживает перерисовку вкладки', () => {
  // Было так: любое сохранение настройки звало `refreshPanel`, тот строил
  // `<details>` заново с `open = false`, и все раскрытые блоки схлопывались.
  const { api, node } = mount(fakeHost(started, { lorebook: { enabled: true } }, LOREBOOK_FULL));
  const before = findSection(openTab(node, 'settings'), 'API для генерации');
  assert.ok(before, 'блока «API для генерации» на вкладке нет');
  assert.equal('open' in before.attrs, false, 'на идущем семестре блок начинается свёрнутым');

  openSection(before);
  api.render();

  const after = findSection(node.querySelector('.academy-body'), 'API для генерации');
  assert.ok(after && after !== before, 'перерисовка обязана построить новый узел');
  assert.ok('open' in after.attrs, 'блок схлопнулся при перерисовке');

  // Помнится ровно раскрытый блок, а не «раскрыть всё».
  const others = [];
  walk(node.querySelector('.academy-body'), (n) => {
    if (n.tagName === 'DETAILS' && 'open' in n.attrs) {
      const head = n.children.find((c) => c.className === 'academy-section-title');
      others.push(head ? head.textContent : '');
    }
  });
  assert.deepEqual(others, ['API для генерации'], `раскрытыми оказались: ${others.join(' | ')}`);
  api.destroy();
});

test('копии блока настроек раскрываются независимо друг от друга', () => {
  // Блок живёт на странице в двух экземплярах — в панели и в меню расширений.
  // Решение: копии независимы (см. комментарий у `sectionOpen` в `ui.js`).
  const host = fakeHost(started, { lorebook: { enabled: true } }, LOREBOOK_FULL);
  const { api, node } = mount(host);
  openSection(findSection(openTab(node, 'settings'), 'API для генерации'));

  const holder = makeNode('div');
  const prev = document.getElementById;
  document.getElementById = (id) => (id === 'extensions_settings2' ? holder : null);
  let block;
  try { block = ui.mountSettings(host); } finally { document.getElementById = prev; }
  assert.ok(block, 'блок в меню расширений не смонтировался');

  const drawer = findSection(block.querySelector('.inline-drawer-content'), 'API для генерации');
  assert.ok(drawer, 'в меню расширений блока «API для генерации» нет');
  assert.equal('open' in drawer.attrs, false,
    'раскрытие в панели не должно раскрывать блок на другом экране');
  api.destroy();
});

test('результат «Проверить связь» остаётся на экране, а не уезжает с перерисовкой', async () => {
  // Шов целиком: кнопка сначала сохраняет поля, и если сохранение перерисует
  // вкладку, узел статуса окажется отцеплённым от дерева — ни «Связь есть», ни
  // причина отказа не доедут до человека.
  const seen = [];
  const host = fakeHost(started, { lorebook: { enabled: true } }, LOREBOOK_FULL, {
    testApi: async () => ({ ok: false, error: 'сервер не ответил за 20 секунд' }),
  });
  // Поддельный `index.js`: без `quiet` сохранение настроек перерисовывает панель.
  host.setSettings = (patch, opts = {}) => {
    seen.push(opts);
    if (!(opts && opts.quiet === true)) ui.renderPanel(host);
    return { ok: true };
  };

  const { api, node } = mount(host);
  const body = openTab(node, 'settings');
  let button = null;
  walk(body, (n) => { if (n.textContent === 'Проверить связь') button = n; });
  assert.ok(button, 'кнопки «Проверить связь» на вкладке нет');
  await button.listeners.click[0]({ currentTarget: button });
  await new Promise((resolve) => { setTimeout(resolve, 0); });

  assert.ok(seen.some((o) => o && o.quiet === true), 'поля API сохраняются молча, без перерисовки');
  const texts = [];
  walk(node.querySelector('.academy-body'), (n) => { if (n.textContent) texts.push(n.textContent); });
  assert.ok(texts.includes('сервер не ответил за 20 секунд'),
    `причина отказа не дошла до экрана: ${texts.join(' | ')}`);
  api.destroy();
});

/* --- графа «актуальный API» ------------------------------------------------- */

/** Собрать блок «API для генерации» на вкладке настроек живой панели. */
function apiBlock(host) {
  const { api, node } = mount(host);
  const block = findSection(openTab(node, 'settings'), 'API для генерации');
  assert.ok(block, 'блока «API для генерации» на вкладке нет');
  const texts = [];
  const inputs = [];
  const buttons = [];
  walk(block, (n) => {
    if (n.textContent) texts.push(n.textContent);
    if (n.tagName === 'INPUT' || n.tagName === 'SELECT') inputs.push(n);
    if (n.listeners && n.listeners.click) buttons.push(n.textContent);
  });
  return { api, node, block, texts, inputs, buttons };
}

test('выбор API: актуальное подключение таверны — отдельная графа, а не пустые поля', () => {
  const host = fakeHost(started, { api: { source: 'tavern' } }, LOREBOOK_FULL);
  host.getConnections = () => ({
    available: true,
    service: true,
    selected: 'p-1',
    profiles: [{ id: 'p-1', name: 'Дешёвый', model: 'mini' }],
  });
  const { api, texts, inputs, buttons } = apiBlock(host);

  const radios = inputs.filter((n) => n.attrs.type === 'radio');
  assert.equal(radios.length, 2, 'графа выбора источника: два пункта');
  assert.ok(texts.includes('Актуальный API таверны'));
  assert.ok(texts.includes('Свой адрес с ключом'));
  assert.ok(texts.some((t) => /Ключ здесь вводить не нужно/.test(t)),
    `про ключ не сказано ни слова: ${texts.join(' | ')}`);

  // Ключа при выборе актуального API не спрашивают вовсе.
  assert.equal(inputs.some((n) => n.attrs.type === 'password'), false, 'поле ключа тут лишнее');
  // И списком моделей не притворяемся: кнопки нет, вместо неё — объяснение.
  assert.equal(buttons.includes('Список моделей'), false, 'списка моделей у таверны нет');
  assert.ok(buttons.includes('Проверить связь'), 'проверить связь можно и здесь');
  assert.ok(texts.some((t) => /Своего списка моделей/.test(t)));

  // Профили таверны — выпадашкой, с пунктом «как есть» первым.
  const select = inputs.find((n) => n.tagName === 'SELECT');
  assert.ok(select, 'профили таверны не показаны');
  assert.deepEqual(select.children.map((o) => o.attrs.value), ['', 'p-1']);
  api.destroy();
});

test('выбор API: свой адрес спрашивает ключ и умеет список моделей', () => {
  const host = fakeHost(started, { api: { source: 'own', endpoint: 'https://x.y', key: 'sk', model: 'm' } }, LOREBOOK_FULL);
  const { api, inputs, buttons } = apiBlock(host);
  assert.ok(inputs.some((n) => n.attrs.type === 'password'), 'ключ спрашивают только здесь');
  assert.ok(buttons.includes('Список моделей'));
  api.destroy();
});

test('список моделей раскрывается настоящей выпадашкой, даже когда модель уже вписана', async () => {
  // `<datalist>` фильтровал подсказки по вписанному имени и при выбранной
  // модели не раскрывался — человеку приходилось печатать имя руками.
  const saved = [];
  const host = fakeHost(started, { api: { source: 'own', endpoint: 'https://x.y', key: 'sk', model: 'm' } }, LOREBOOK_FULL, {
    listModels: () => ({ ok: true, models: ['gpt-mini', 'gpt-big'] }),
  });
  host.setSettings = (patch) => { saved.push(patch); return { ok: true }; };
  const { api, block } = apiBlock(host);
  let button = null;
  walk(block, (n) => { if (n.textContent === 'Список моделей' && n.listeners && n.listeners.click) button = n; });
  for (const fn of button.listeners.click) await fn({ currentTarget: button });
  await new Promise((resolve) => { setTimeout(resolve, 0); });

  let pick = null;
  walk(block, (n) => { if (n.tagName === 'SELECT' && n.children.some((o) => o.attrs.value === 'gpt-big')) pick = n; });
  assert.ok(pick, 'выпадашки со списком нет');
  assert.ok(!pick.attrs.hidden && !pick.hidden, 'выпадашка спрятана');
  pick.value = 'gpt-big';
  for (const fn of pick.listeners.change || []) fn();
  assert.ok(saved.some((p) => p.api && p.api.model === 'gpt-big'),
    `выбор из списка не сохранился: ${JSON.stringify(saved)}`);
  api.destroy();
});

test('на сенсорном экране список моделей — обычная выпадашка, без select2', async () => {
  // Поиск select2 на телефоне фокусирует поле, вылезает клавиатура, окно
  // меняет высоту, выпадашка пересчитывается — экран дёргается вверх. Таверна
  // по той же причине не ставит select2 на телефоне (`openai.js`, `isMobile`).
  const calls = [];
  const jq = () => ({ data: () => null, select2: (...a) => calls.push(a), off() {}, on() {} });
  jq.fn = { select2() {} };
  const prev = { jQuery: globalThis.jQuery, matchMedia: globalThis.matchMedia };
  globalThis.jQuery = jq;
  globalThis.matchMedia = (q) => ({ matches: q.includes('pointer: coarse') });
  try {
    const host = fakeHost(started, { api: { source: 'own', endpoint: 'https://x.y', key: 'sk', model: 'm' } }, LOREBOOK_FULL, {
      listModels: () => ({ ok: true, models: ['gpt-mini', 'gpt-big'] }),
    });
    const { api, block } = apiBlock(host);
    let button = null;
    walk(block, (n) => { if (n.textContent === 'Список моделей' && n.listeners && n.listeners.click) button = n; });
    for (const fn of button.listeners.click) await fn({ currentTarget: button });
    await new Promise((resolve) => { setTimeout(resolve, 0); });

    let pick = null;
    walk(block, (n) => { if (n.tagName === 'SELECT' && n.children.some((o) => o.attrs.value === 'gpt-big')) pick = n; });
    assert.ok(pick && !pick.hidden, 'выпадашки со списком нет');
    assert.equal(calls.length, 0, 'select2 поставлен на сенсорном экране');
    api.destroy();
  } finally {
    globalThis.jQuery = prev.jQuery;
    globalThis.matchMedia = prev.matchMedia;
  }
});

test('выбор API: старые настройки без графы показывают тот путь, по которому пойдёт запрос', () => {
  // Ничего не выбирали, адрес вписан — значит свой адрес, ровно как раньше.
  const own = apiBlock(fakeHost(started, { api: { endpoint: 'https://x.y', key: 'sk', model: 'm' } }, LOREBOOK_FULL));
  assert.ok(own.inputs.some((n) => n.attrs.type === 'password'), 'вписанный адрес — прежнее поведение');
  own.api.destroy();

  // Ничего не выбирали и адреса нет — значит подключение таверны.
  const tavern = apiBlock(fakeHost(started, {}, LOREBOOK_FULL));
  assert.equal(tavern.inputs.some((n) => n.attrs.type === 'password'), false);
  assert.ok(tavern.texts.some((t) => /Ключ здесь вводить не нужно/.test(t)));
  tavern.api.destroy();
});

test('выбор источника доезжает до настроек расширения', async () => {
  const saved = [];
  const host = fakeHost(started, { api: { source: 'tavern' } }, LOREBOOK_FULL);
  host.setSettings = (patch) => { saved.push(patch); return { ok: true }; };
  const { api, inputs } = apiBlock(host);
  const own = inputs.filter((n) => n.attrs.type === 'radio')[1];
  for (const fn of own.listeners.change || []) fn();
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.ok(saved.some((p) => p.api && p.api.source === 'own'),
    `выбор никуда не сохранился: ${JSON.stringify(saved)}`);
  api.destroy();
});

/* --- таблица предметов: выпадашка наставника -------------------------------- */

test('наставник попадает в выпадашку сразу, а не после «Сохранить таблицу»', () => {
  // Порядок чтения формы — сверху вниз: сперва наставники, потом дисциплины.
  // Раньше опции выпадашки собирались один раз за перерисовку, а перерисовка
  // случалась только на «добавить»/«удалить», и вписанное имя доезжало до
  // дисциплин лишь через сохранение (`voprosy-vladelitse.md`, пункт 3).
  const host = fakeHost(started, {}, LOREBOOK_FULL);
  const { api, node } = mount(host);
  const body = openTab(node, 'settings');

  // Заглушка `querySelector` выдумывает узел под любой селектор, поэтому
  // таблица ищется обходом, а не по классу.
  const find = (tag) => {
    const out = [];
    walk(body, (n) => { if (n.tagName === tag) out.push(n); });
    return out;
  };
  const teacherBox = () => find('SELECT')
    .find((s) => s.children.some((o) => o.textContent === U_TEACHER_NONE));
  assert.ok(teacherBox(), 'выпадашки наставника в таблице нет');

  const name = find('INPUT').find((n) => n.attrs.placeholder === U_TEACHER_HINT);
  assert.ok(name, 'поля «Имя» в таблице наставников нет');
  name.value = 'Зоя Ивановна';
  for (const fn of name.listeners.input || []) fn();
  for (const fn of name.listeners.change || []) fn();

  const opts = teacherBox().children.map((o) => o.textContent);
  assert.ok(opts.includes('Зоя Ивановна'),
    `имя не доехало до выпадашки без сохранения: ${opts.join(' | ')}`);
  api.destroy();
});

/* --- придержанный прыжок времени -------------------------------------------- */

test('прыжок вперёд панель показывает вопросом с двумя кнопками', async () => {
  // Единственное место, где панель спрашивает сама. Не спросить — значит
  // оставить человека с календарём, который встал без объяснения.
  const held = { ...started };
  held.calendar = {
    ...started.calendar,
    heldJump: {
      day: '2024-12-24', time: '09:00', daypart: null, jump: 113,
      from: started.calendar.day, matched: '📅 24 декабря 2024, 09:00',
    },
  };

  const asked = [];
  const host = fakeHost(held, {}, LOREBOOK_FULL, {
    resolveJump: async (accept) => { asked.push(accept); return { ok: true, missed: 0 }; },
  });
  const { api, node } = mount(host);
  const body = openTab(node, 'today');

  const texts = [];
  const buttons = [];
  walk(body, (n) => {
    if (n.textContent) texts.push(n.textContent);
    if (n.listeners && n.listeners.click) buttons.push(n);
  });
  assert.ok(texts.some((t) => /Время прыгнуло вперёд/.test(t)), 'вопроса на «Сегодня» нет');
  assert.ok(texts.some((t) => /24 декабря/.test(t)), `дата прыжка не показана: ${texts.join(' | ')}`);

  const accept = buttons.find((b) => b.textContent === 'Принять');
  const dismiss = buttons.find((b) => b.textContent === 'Не надо');
  assert.ok(accept && dismiss, 'кнопок ответа нет');

  await dismiss.listeners.click[0]({ currentTarget: dismiss });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.deepEqual(asked, [false], 'отказ до действия не доехал');
  api.destroy();
});

test('без придержанного прыжка вопроса на «Сегодня» нет', () => {
  const { api, node } = mount(fakeHost(started, {}, LOREBOOK_FULL));
  const texts = [];
  walk(openTab(node, 'today'), (n) => { if (n.textContent) texts.push(n.textContent); });
  assert.equal(texts.some((t) => /Время прыгнуло вперёд/.test(t)), false);
  api.destroy();
});

/* --- первый учебный день ----------------------------------------------------- */

test('дата старта показана в поле и уезжает в действие, а не подставляется молча', async () => {
  const sent = [];
  // Семестр ещё не начат, но таблица заполнена — иначе кнопка старта заперта.
  const ready = { ...started, started: false };
  const host = fakeHost(ready, {}, LOREBOOK_FULL, {
    startTerm: async (survey, opts) => { sent.push(opts); return { ok: true }; },
  });
  host.getStartHint = () => ({ day: '2023-10-19', from: 'chat', matched: '19 октября 2023' });

  const { api, node } = mount(host);
  const body = openTab(node, 'settings');

  const dates = [];
  const texts = [];
  let start = null;
  walk(body, (n) => {
    if (n.tagName === 'INPUT' && n.attrs.type === 'date') dates.push(n);
    if (n.textContent) texts.push(n.textContent);
    if (n.textContent === 'Начать семестр') start = n;
  });
  assert.ok(dates.some((n) => n.attrs.value === '2023-10-19'),
    `подсказанная дата в поле не попала: ${dates.map((n) => n.attrs.value).join(' | ')}`);
  assert.ok(texts.some((t) => /Дата взята из чата/.test(t)), 'откуда дата — не сказано');

  assert.ok(start, 'кнопки старта нет');
  await start.listeners.click[0]({ currentTarget: start });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.deepEqual(sent, [{ startDay: '2023-10-19' }], `дата до действия не доехала: ${JSON.stringify(sent)}`);
  api.destroy();
});

test('года в чате нет — панель честно говорит, что дата с часов компьютера', () => {
  const host = fakeHost({ ...started, started: false }, {}, LOREBOOK_FULL);
  host.getStartHint = () => ({ day: '2026-09-01', from: 'preset', matched: '' });
  const { api, node } = mount(host);
  const texts = [];
  walk(openTab(node, 'settings'), (n) => { if (n.textContent) texts.push(n.textContent); });
  assert.ok(texts.some((t) => /по часам компьютера/.test(t)), 'умолчание не объяснено');
  api.destroy();
});

/* --- ручной сдвиг и посещаемость --------------------------------------------- */

test('галочка «зачесть пропущенные» доезжает до действия, а по умолчанию выключена', async () => {
  const sent = [];
  const host = fakeHost(started, {}, LOREBOOK_FULL, {
    manualTime: async (patch) => { sent.push(patch); return { ok: true, missed: 4, wouldMiss: 0 }; },
  });
  const { api, node } = mount(host);
  const body = openTab(node, 'today');

  let button = null;
  let check = null;
  walk(body, (n) => {
    if (n.textContent === '+1 день') button = n;
    if (n.tagName === 'INPUT' && n.attrs.type === 'checkbox') check = n;
  });
  assert.ok(button, 'кнопки «+1 день» в ремонтном блоке нет');
  assert.ok(check, 'галочки про посещаемость нет');
  assert.equal(check.checked, false, 'по умолчанию ремонт ведомость не трогает');

  await button.listeners.click[0]({ currentTarget: button });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.deepEqual(sent[0], { shift: { days: 1 }, count: false });

  check.checked = true;
  await button.listeners.click[0]({ currentTarget: button });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
  assert.deepEqual(sent[1], { shift: { days: 1 }, count: true });
  api.destroy();
});

/* --- переносимые пресеты (9.3.2) --------------------------------------------- */

/** Блок «Пресет заведения» живой панели: узлы, кнопки по тексту, тексты. */
function presetBlock(host) {
  const { api, node } = mount(host);
  const block = findSection(openTab(node, 'settings'), ui.uiLabels(preset).presetSection);
  assert.ok(block, 'блока пресета на вкладке нет');
  const find = (pred) => { let hit = null; walk(block, (n) => { if (!hit && pred(n)) hit = n; }); return hit; };
  const button = (text) => find((n) => n.textContent === text && n.listeners && n.listeners.click);
  const texts = () => { const out = []; walk(block, (n) => { if (n.textContent) out.push(n.textContent); }); return out; };
  return { api, node, block, find, button, texts };
}

const click = async (n) => {
  await n.listeners.click[0]({ currentTarget: n });
  await new Promise((resolve) => { setTimeout(resolve, 0); });
};

/** Хост со своим пресетом в списке. */
function hostWithOwn(actions = {}, extra = {}) {
  const host = fakeHost(started, {}, LOREBOOK_FULL, actions);
  host.getPresets = () => ({
    active: 'ru-university',
    list: [
      { id: 'ru-university', name: 'Российский вуз' },
      { id: 'my-uni', name: 'Мой вуз', user: true },
    ],
    notice: '',
    ...extra,
  });
  return host;
}

test('пресет: выгрузка берёт выбранный в выпадашке и отдаёт файл браузеру', async () => {
  const asked = [];
  const host = hostWithOwn({
    exportPreset: async (id) => { asked.push(id); return { ok: true, json: '{}', filename: `academy-preset-${id}.json` }; },
  });
  const { api, find, button, texts } = presetBlock(host);
  const select = find((n) => n.tagName === 'SELECT');
  select.value = 'my-uni';
  await click(button(ui.PRESET_TEXT.exportButton));
  assert.deepEqual(asked, ['my-uni'], 'выгружается выбранный, а не активный');
  assert.ok(texts().some((t) => t.includes('academy-preset-my-uni.json')), texts().join(' | '));
  api.destroy();
});

test('пресет: «Удалить» есть только у своего и спрашивает перед удалением', async () => {
  const removed = [];
  const host = hostWithOwn({ deletePreset: async (id, opts) => { removed.push([id, opts]); return { ok: true }; } });
  const { api, find, button } = presetBlock(host);
  const select = find((n) => n.tagName === 'SELECT');
  const del = button(ui.PRESET_TEXT.deleteButton);
  assert.equal(del.hidden, true, 'у встроенного кнопки удаления нет');
  // Свой пресет в выпадашке помечен.
  assert.ok(select.children.some((o) => o.textContent === `Мой вуз (${ui.PRESET_TEXT.userMark})`));

  select.value = 'my-uni';
  for (const fn of select.listeners.change) fn();
  assert.equal(del.hidden, false, 'у своего — есть');

  await click(del);
  assert.equal(removed.length, 0, 'первое нажатие только спрашивает');
  const yes = button(ui.PRESET_TEXT.deleteYes);
  assert.ok(yes, 'вопроса «удалить?» нет');
  await click(yes);
  assert.deepEqual(removed, [['my-uni', { confirm: false }]]);
  api.destroy();
});

test('пресет: файл → превью «семестр · …» → «добавить и применить» доходит до действия', async () => {
  const calls = [];
  const host = hostWithOwn({
    previewPreset: async (text) => {
      calls.push(['preview', text]);
      return { ok: true, summary: { id: 'friend', name: 'Вуз подруги', line: 'семестр · пары в день: 4 · 2–5 · хвост после 3 прогулов' }, renamed: true, warnings: ['пресет без конверта'] };
    },
    importPreset: async (text, opts) => { calls.push(['import', text, opts]); return { ok: true, added: 'friend', name: 'Вуз подруги' }; },
  });
  const { api, find, button, texts } = presetBlock(host);
  // В блоке пресета — ровно один выбор файла, свой.
  const file = find((n) => n.tagName === 'INPUT' && n.attrs.type === 'file');
  file.files = [{ size: 100, text: async () => '{"format":"academy-preset"}' }];
  for (const fn of file.listeners.change) await fn();
  await new Promise((resolve) => { setTimeout(resolve, 0); });

  assert.deepEqual(calls[0], ['preview', '{"format":"academy-preset"}']);
  const shown = texts();
  assert.ok(shown.includes('Вуз подруги'));
  assert.ok(shown.includes('семестр · пары в день: 4 · 2–5 · хвост после 3 прогулов'));
  assert.ok(shown.some((t) => t.includes('«friend»')), 'про новый id сказано');
  assert.ok(button(ui.PRESET_TEXT.add), 'кнопки «Добавить» нет');

  await click(button(ui.PRESET_TEXT.addApply));
  assert.deepEqual(calls[1], ['import', '{"format":"academy-preset"}', { apply: true }]);
  api.destroy();
});

test('пресет: файл больше 1 МБ отвергается до чтения', async () => {
  let read = false;
  const host = hostWithOwn({ previewPreset: async () => ({ ok: true, summary: {} }) });
  const { api, find, texts } = presetBlock(host);
  const file = find((n) => n.tagName === 'INPUT' && n.attrs.type === 'file');
  file.files = [{ size: 5 * 1024 * 1024, text: async () => { read = true; return ''; } }];
  for (const fn of file.listeners.change) await fn();
  assert.equal(read, false, 'гигабайт на телефоне читать ради отказа нельзя');
  assert.ok(texts().includes(ui.PRESET_TEXT.tooBig));
  api.destroy();
});

test('пресет: откат после удаления виден строкой в блоке', () => {
  const host = hostWithOwn({}, { notice: 'Пресет «Мой вуз» удалён — включён встроенный «Российский вуз».' });
  const { api, texts } = presetBlock(host);
  assert.ok(texts().includes('Пресет «Мой вуз» удалён — включён встроенный «Российский вуз».'));
  api.destroy();
});

test('список моделей через сервер таверны — строкой в статусе', async () => {
  const host = fakeHost(started, { api: { source: 'own', endpoint: 'https://x.y', key: 'sk', model: '' } }, LOREBOOK_FULL, {
    listModels: async () => ({ ok: true, models: ['a', 'b'], via: 'tavern-backend' }),
  });
  const { api, block } = apiBlock(host);
  let btn = null;
  walk(block, (n) => { if (n.textContent === 'Список моделей') btn = n; });
  await click(btn);
  const texts = [];
  walk(block, (n) => { if (n.textContent) texts.push(n.textContent); });
  assert.ok(texts.some((t) => /Моделей: 2/.test(t) && /сервер таверны/.test(t)), texts.join(' | '));
  api.destroy();
});

/* --- проводка шага 4 и крючки 9.7 ---------------------------------------------- */

/** Все тексты дерева — одной строкой через « | ». */
const allTexts = (root) => {
  const out = [];
  walk(root, (n) => { if (n.textContent) out.push(n.textContent); });
  return out;
};
const findNode = (root, pred) => {
  let hit = null;
  walk(root, (n) => { if (!hit && pred(n)) hit = n; });
  return hit;
};

test('«Сегодня»: исход сегодняшней проверки — строкой с броском; кубик «выпадает» один раз', () => {
  const s = {
    ...started,
    calendar: { ...started.calendar, day: '2024-12-23' },
    exams: {
      ...started.exams,
      items: [{
        id: '0:chem:exam', subjectId: 'chem', kind: 'exam', day: '2024-12-23', outcome: '4', attempts: 1,
        rolls: [{ day: '2024-12-23', roll: 15, dc: 7, tier: 'success', value: '4' }],
      }],
    },
  };
  const { api, node } = mount(fakeHost(s, {}, LOREBOOK_FULL));
  let body = openTab(node, 'today');
  assert.ok(allTexts(body).includes('бросок 15 против DC 7 — успех'), allTexts(body).join(' | '));
  const roll = findNode(body, (n) => n.textContent === '15');
  assert.match(roll.className, /academy-roll-fresh/, 'первый показ — с анимацией');
  body = openTab(node, 'today');
  const again = findNode(body, (n) => n.textContent === '15');
  assert.doesNotMatch(again.className, /academy-roll-fresh/, 'перерисовка кубик заново не бросает');
  api.destroy();
});

test('«Люди»: портрет миниатюрой, нажатие открывает окно, правка доходит до действия', async () => {
  const s = { ...started, teachers: [{ ...started.teachers[0], portrait: 'characters/P/p.png' }] };
  const sent = [];
  const host = fakeHost(s, {}, LOREBOOK_FULL, {
    setTeacherDetails: async (id, patch) => { sent.push([id, patch]); return { ok: true }; },
  });
  const { api, node } = mount(host);
  const body = openTab(node, 'people');
  const img = findNode(body, (n) => n.tagName === 'IMG');
  assert.equal(img.attrs.src, 'characters/P/p.png');
  assert.ok(!allTexts(body).some((t) => /рожд/i.test(t)), 'дня рождения на вкладке нет');

  const before = document.body.children.length;
  await img.listeners.click[0]({ currentTarget: img });
  const overlay = document.body.children[document.body.children.length - 1];
  assert.equal(document.body.children.length, before + 1);
  assert.match(overlay.className, /academy-portrait-overlay/);

  const portrait = findNode(body, (n) => n.tagName === 'INPUT' && n.attrs.placeholder === ui.EXTRA_UI.portraitHint);
  portrait.value = 'javascript:alert(1)';
  const save = findNode(body, (n) => n.textContent === 'Сохранить' && n.listeners.click);
  await click(save);
  assert.deepEqual(sent, [], 'негодный портрет отвергнут до хоста');
  portrait.value = 'https://example.com/p.png';
  await click(save);
  // Одна кнопка несёт все детали: поля, которых не трогали, уходят как были.
  assert.deepEqual(sent, [['petrova', {
    post: '', likes: '', secret: '', traits: 'злопамятна', portrait: 'https://example.com/p.png',
  }]]);
  api.destroy();
});

test('«Люди»: должность под именем, «любит» строкой, тайна свёрнута; редактор шлёт все поля', async () => {
  const s = {
    ...started,
    teachers: [{
      ...started.teachers[0], post: 'заведующая кафедрой', likes: 'белое вино', secret: 'влюблена в декана',
    }],
  };
  const sent = [];
  const host = fakeHost(s, {}, LOREBOOK_FULL, {
    setTeacherDetails: async (id, patch) => { sent.push([id, patch]); return { ok: true }; },
  });
  const { api, node } = mount(host);
  const body = openTab(node, 'people');
  const texts = allTexts(body);
  assert.ok(texts.includes('заведующая кафедрой'), texts.join(' | '));
  assert.ok(texts.includes('любит: белое вино'), texts.join(' | '));
  const secret = findNode(body, (n) => n.tagName === 'DETAILS' && /academy-secret/.test(n.className));
  assert.ok(secret, 'тайна — в свёрнутом блоке');
  assert.equal(secret.attrs.open, undefined, 'и свёрнута, пока не нажали');
  assert.equal(secret.children[0].textContent, ui.EXTRA_UI.secretTitle);

  const byHint = (hint) => findNode(body, (n) => (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA')
    && n.attrs.placeholder === hint);
  assert.equal(byHint(ui.EXTRA_UI.postHint).value, 'заведующая кафедрой', 'редактор открывается с тем, что есть');
  assert.equal(byHint(ui.EXTRA_UI.secretHint).tagName, 'TEXTAREA');
  byHint(ui.EXTRA_UI.postHint).value = 'декан';
  byHint(ui.EXTRA_UI.likesHint).value = '';
  await click(findNode(body, (n) => n.textContent === 'Сохранить' && n.listeners.click));
  assert.deepEqual(sent, [['petrova', {
    post: 'декан', likes: '', secret: 'влюблена в декана', traits: 'злопамятна', portrait: '',
  }]]);
  api.destroy();
});

test('«Достижения»: полученное с датой, каталог с тайными и счёт во всех историях', () => {
  const s = {
    ...started,
    subjects: [{ ...started.subjects[0], grades: [{ value: '5', day: '2024-09-02' }] }],
  };
  const tally = { firstTop: { chats: ['a', 'b'], first: '2026-10-06' } };
  const { api, node } = mount(fakeHost(s, { achievementTally: tally }, LOREBOOK_FULL));
  const texts = allTexts(openTab(node, 'achievements'));
  assert.ok(texts.includes('В этой истории'));
  assert.ok(texts.includes('Первая пятёрка: аналитическая химия'), texts.join(' | '));
  assert.ok(texts.includes('понедельник, 2 сентября'));
  assert.ok(texts.includes('Все достижения'));
  assert.ok(texts.includes('???'), 'тайное неполученное не раскрыто');
  assert.ok(texts.includes('историй: 2'), texts.join(' | '));
  api.destroy();
});

test('«Отладка»: доктор промпта рисует причину и таблицу, если хост её отдаёт', () => {
  const host = fakeHost(started, { debug: true }, LOREBOOK_FULL);
  host.getPromptDoctor = () => ui.promptDoctorView({
    prompts: {
      academy_marker: { value: 'метка', position: 1, depth: 2, role: 0 },
      scene: { value: 'MANDATORY: first line of your response is the scene block', position: 1, depth: 0, role: 0 },
    },
    own: ['academy_marker'],
    markerKey: 'academy_marker',
    markerSeen: false,
  });
  const { api, node } = mount(host);
  const texts = allTexts(openTab(node, 'debug'));
  assert.ok(texts.includes(ui.DOCTOR_TEXT.title));
  assert.ok(texts.some((t) => t.includes('«scene» просит начало ответа')), texts.join(' | '));
  api.destroy();
});

test('настройки: блок «Вехи» — галочка звука уезжает в настройки, по умолчанию выключена', () => {
  const patches = [];
  const host = fakeHost(started, {}, LOREBOOK_FULL);
  host.setSettings = (patch) => { patches.push(patch); };
  const { api, node } = mount(host);
  const body = openTab(node, 'settings');
  // Галочка звука — соседка подписи в том же <label>.
  let sound = null;
  walk(body, (n) => {
    if (n.tagName === 'LABEL' && n.children.some((c) => c.textContent === ui.EXTRA_UI.soundToggle)) {
      sound = n.children.find((c) => c.tagName === 'INPUT');
    }
  });
  assert.ok(sound, 'галочки звука нет');
  assert.equal(sound.checked, false);
  sound.checked = true;
  for (const fn of sound.listeners.change) fn();
  assert.deepEqual(patches, [{ milestoneSound: true }]);
  api.destroy();
});

test('таблица плана: корпус и аудитория доходят до setSubjects', async () => {
  const saved = [];
  const host = fakeHost(started, {}, LOREBOOK_FULL, {
    setSubjects: async (plan) => { saved.push(plan); return { ok: true }; },
  });
  const { api, node } = mount(host);
  const body = openTab(node, 'settings');
  let building = null;
  walk(body, (n) => {
    if (n.tagName === 'INPUT' && n.attrs.placeholder === ui.EXTRA_UI.buildingHint && !building) building = n;
  });
  assert.ok(building, 'поля корпуса нет');
  building.value = 'Б';
  for (const fn of building.listeners.input) fn();
  const save = findNode(body, (n) => n.textContent === 'Сохранить таблицу');
  await click(save);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].subjects[0].building, 'Б');
  assert.equal(saved[0].subjects[0].room, '');
  api.destroy();
});

test('«Люди» → «Курс»: подсказка пустого курса, добавление, правка и удаление с вопросом', async () => {
  const sent = [];
  const empty = fakeHost(started, {}, LOREBOOK_FULL, {
    addClassmate: async (raw) => { sent.push(['add', raw]); return { ok: true, id: 'vera' }; },
  });
  let { api, node } = mount(empty);
  let body = openTab(node, 'people');
  const part = findNode(body, (n) => /academy-people-part/.test(n.className) && n.textContent.startsWith('Курс'));
  assert.ok(part, 'переключатель части «Курс»');
  await click(part);
  body = node.querySelector('.academy-body');
  assert.ok(allTexts(body).includes(ui.DEFAULT_UI.classmatesNone), allTexts(body).join(' | '));
  const byHint = (root, hint) => findNode(root, (n) => n.tagName === 'INPUT' && n.attrs.placeholder === hint);
  byHint(body, ui.EXTRA_UI.cmNameHint).value = 'Вера Соколова';
  byHint(body, ui.EXTRA_UI.cmDesireHint).value = 'стипендия';
  await click(findNode(body, (n) => n.textContent === ui.EXTRA_UI.cmAdd && n.listeners.click));
  assert.deepEqual(sent, [['add', {
    name: 'Вера Соколова', club: '', desire: 'стипендия', problem: '', tie: { to: '', what: '' },
  }]]);
  api.destroy();

  const s = { ...started, classmates: [{ id: 'vera', name: 'Вера Соколова', relation: -1, club: 'театр', source: 'manual', locked: true }] };
  const full = fakeHost(s, {}, LOREBOOK_FULL, {
    removeClassmate: async (id) => { sent.push(['remove', id]); return { ok: true }; },
    updateClassmate: async (id, patch) => { sent.push(['update', id, patch.name]); return { ok: true }; },
  });
  ({ api, node } = mount(full));
  body = node.querySelector('.academy-body');
  const texts = allTexts(body);
  assert.ok(texts.includes('Вера Соколова'), texts.join(' | '));
  assert.ok(texts.includes('косится · −1'), 'отношение словом и числом');
  await click(findNode(body, (n) => n.textContent === ui.EXTRA_UI.cmSave && n.listeners.click));
  assert.deepEqual(sent[1], ['update', 'vera', 'Вера Соколова']);
  const ask = findNode(body, (n) => /academy-confirm/.test(n.className));
  assert.equal(ask.hidden, true, 'вопрос спрятан, пока не нажали «Удалить»');
  await click(findNode(body, (n) => n.textContent === ui.EXTRA_UI.cmRemove && n.listeners.click));
  assert.equal(ask.hidden, false);
  assert.equal(sent.length, 2, 'одно нажатие ещё не удаляет');
  await click(findNode(body, (n) => n.textContent === ui.EXTRA_UI.cmRemoveYes && n.listeners.click));
  assert.deepEqual(sent[2], ['remove', 'vera']);
  api.destroy();
});

test('«Поток»: счётчик на ярлыке, два канала, «Взять в сюжет» — превью с правкой и отправка', async () => {
  const day = started.calendar.day;
  const s = {
    ...started,
    classmates: [{ id: 'vera', name: 'Вера Соколова', relation: 0, source: 'manual', locked: true }],
    feed: {
      items: [
        { id: 'm#1', src: 'm', at: { day }, kind: 'reaction', chan: 'chat', who: 'vera', text: 'Опять она', factText: 'прогул: химия' },
        { id: 'm#2', src: 'm', at: { day }, kind: 'reaction', chan: 'anon', who: 'someone', text: 'Говорят, подстроила' },
      ],
      seen: {},
      deals: [],
    },
  };
  const sent = [];
  const host = fakeHost(s, {}, LOREBOOK_FULL, {
    feedRead: async (ids) => { sent.push(['read', ids]); return { ok: true, n: 0 }; },
    takeHook: async (ref, text) => { sent.push(['take', ref, text]); return { ok: true }; },
  });
  host.getPlot = () => null;
  host.getHeroine = () => 'Аня';
  host.getFeedDraft = (ref) => ({ text: `Если уместно: ${ref}` });
  const { api, node } = mount(host);
  const tab = node.querySelector('.academy-tabs').children.find((t) => t.dataset.tab === 'feed');
  assert.ok(allTexts(tab).includes('2'), 'непрочитанное — числом на ярлыке');
  // Панель закрыта (последним был открыт «Чат курса»): перерисовка по новому
  // ответу ленту не читает — прочитанным становится только увиденное.
  let body = openTab(node, 'feed');
  assert.equal(sent.length, 0, 'закрытая панель ничего не помечает прочитанным');
  node.classList.add('academy-open');
  body = openTab(node, 'feed');
  const texts = allTexts(body);
  assert.ok(texts.includes('Вера Соколова'), texts.join(' | '));
  assert.ok(texts.includes('по поводу: прогул: химия'));
  assert.equal(texts.includes('Говорят, подстроила'), false, 'анонимка — своим каналом');
  assert.deepEqual(sent[0], ['read', ['m#1']], 'открытый канал помечается прочитанным');
  assert.ok(findNode(body, (n) => /academy-feed-unread/.test(n.className)), 'новое выделено');

  await findNode(body, (n) => n.textContent === ui.EXTRA_UI.feedTake && n.listeners.click).listeners.click[0]({});
  body = node.querySelector('.academy-body');
  const area = findNode(body, (n) => n.tagName === 'TEXTAREA');
  assert.ok(area, 'превью с правкой');
  assert.equal(area.value, 'Если уместно: m#1');
  area.value = 'Своими словами.';
  const send = findNode(body, (n) => n.textContent === ui.EXTRA_UI.feedSend && n.listeners.click);
  await send.listeners.click[0]({ currentTarget: send });
  assert.deepEqual(sent.find((x) => x[0] === 'take'), ['take', 'm#1', 'Своими словами.']);

  const anon = findNode(node.querySelector('.academy-body'), (n) => n.dataset && n.dataset.chan === 'anon');
  await anon.listeners.click[0]({});
  body = node.querySelector('.academy-body');
  assert.ok(allTexts(body).includes('Говорят, подстроила'));
  assert.ok(allTexts(body).includes('без подписи'), 'автор анонимки скрыт');
  api.destroy();

  const empty = mount(fakeHost(started, {}, LOREBOOK_FULL));
  const emptyBody = openTab(empty.node, 'feed');
  assert.ok(allTexts(emptyBody).includes(ui.EXTRA_UI.feedEmpty));
  empty.api.destroy();
});

test('«Поток»: ветка под постом свёрнута после двух, маска курсивом, значок — нажатием', async () => {
  const day = started.calendar.day;
  const s = {
    ...started,
    classmates: [{ id: 'vera', name: 'Вера Соколова', relation: 0, source: 'manual', locked: true }],
    feed: {
      items: [
        { id: 'm#1', src: 'm', at: { day }, kind: 'reaction', chan: 'chat', nick: 'школьный бес', text: 'Опять она', read: true, loud: 2 },
        { id: 'm^1', src: 'm', at: { day }, kind: 'reaction', chan: 'chat', parent: 'm#1', who: 'vera', text: 'Это я-то?', read: true },
        { id: 'm^2', src: 'm', at: { day }, kind: 'reaction', chan: 'chat', parent: 'm#1', nick: 'школьный бес', text: 'Ты, ты', read: true },
        { id: 'm^3', src: 'm', at: { day }, kind: 'reaction', chan: 'chat', parent: 'm#1', nick: 'альфа', text: 'Третий ответ', read: true },
      ],
      seen: {},
      deals: [],
    },
  };
  const sent = [];
  const host = fakeHost(s, {}, LOREBOOK_FULL, {
    feedRead: async () => ({ ok: true, n: 0 }),
    feedReact: async (id, emoji) => { sent.push([id, emoji]); return { ok: true, mine: emoji }; },
  });
  host.getPlot = () => null;
  const { api, node } = mount(host);
  node.classList.add('academy-open');
  let body = openTab(node, 'feed');
  // Канал помнится между монтированиями — открыть «Чат курса» явно.
  await click(findNode(body, (n) => n.dataset && n.dataset.chan === 'chat' && n.listeners.click));
  body = node.querySelector('.academy-body');
  const texts = allTexts(body);
  assert.ok(texts.includes('@школьный бес'), texts.join(' | '));
  assert.ok(texts.includes('Вера Соколова'));
  assert.ok(texts.includes('Ты, ты'));
  assert.equal(texts.includes('Третий ответ'), false, 'третий ответ свёрнут');
  assert.ok(findNode(body, (n) => /academy-feed-nick/.test(n.className)), 'маска выглядит иначе');
  assert.ok(findNode(body, (n) => /academy-feed-thread/.test(n.className)), 'ветка с отступом');
  for (const t of texts) assert.doesNotMatch(t, /~|reply|m\^/);

  await click(findNode(body, (n) => n.textContent === 'ещё 1 ответ' && n.listeners.click));
  body = node.querySelector('.academy-body');
  assert.ok(allTexts(body).includes('Третий ответ'), 'раскрыта целиком');
  assert.ok(allTexts(body).includes(ui.EXTRA_UI.feedFoldReplies));

  const react = findNode(body, (n) => /academy-feed-react\b/.test(n.className) && n.listeners.click);
  assert.ok(react, 'строка значков под постом');
  await click(react);
  assert.deepEqual(sent, [['m#1', react.dataset.emoji]]);
  api.destroy();
});

test('лорбук: галочка перерисовывает блок сразу, не дожидаясь отчёта World Info', () => {
  const settings = { lorebook: { enabled: false, book: '' } };
  const host = fakeHost(started, settings, null);
  host.setSettings = (patch) => { if (patch.lorebook) Object.assign(settings.lorebook, patch.lorebook); };
  // Отчёт лорбука ещё старый: синхронизация не кончилась.
  host.getLorebook = () => ({ enabled: false, name: '', reason: null, measure: null, suggest: [], orphans: [], error: null });
  const U = ui.uiLabels(preset);
  const { api, node } = mount(host);
  openTab(node, 'settings');
  const texts = () => allTexts(node.querySelector('.academy-body'));
  assert.ok(texts().includes(U.lorebookOff));
  let toggle = null;
  walk(node.querySelector('.academy-body'), (n) => {
    if (!toggle && n.tagName === 'LABEL' && n.children[1] && n.children[1].textContent === U.lorebookToggle) toggle = n.children[0];
  });
  assert.ok(toggle, 'галочка лорбука на месте');
  toggle.checked = true;
  for (const fn of toggle.listeners.change) fn({});
  assert.equal(texts().includes(U.lorebookOff), false, '«Лорбук выключен.» ушло сразу');
  assert.ok(texts().includes(U.lorebookRefresh), 'блок включённого лорбука на месте');
  api.destroy();
});

test('«Люди» и «Сегодня» до начала: таблица без календаря — «не начат», а не «повреждено»', () => {
  // «Сохранить таблицу» до «Начать»: в чате только предметы, люди и расписание.
  const partial = { subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset) };
  const U = ui.uiLabels(preset);
  const { api, node } = mount(fakeHost(partial, {}, LOREBOOK_FULL));
  for (const tab of ['people', 'today']) {
    const texts = allTexts(openTab(node, tab));
    assert.ok(texts.includes(U.notStartedTitle), `${tab}: ${texts.join(' | ')}`);
    assert.equal(texts.includes(U.brokenTitle), false, `${tab}: не «повреждено»`);
    assert.equal(texts.some((t) => /версия схемы|нет presetId/.test(t)), false);
  }
  api.destroy();
});

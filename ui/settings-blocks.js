// ui/settings-blocks.js — блоки настроек, общие для вкладки «Настройки» и
// блока в меню расширений: API, анализ, режим времени, пресет, лорбук,
// выгрузка, звук, отладка.

import { PRESET_MAX_BYTES } from '../core/preset.mjs';
import { personFromLine, personLine } from '../core/card-cast.mjs';
import {
  fill, PRESET_TEXT, extraLabels, uiLabels, mounted, el, clear, runAction, setStatus, section, sectionScope,
  call, safe, renderPanel, renderSettingsBlock,
} from './common.js';
import { DEBUG_TEXT } from './debug.js';

/** Уникальные id и имена: блок настроек живёт на странице в двух копиях. */
let uid = 0;
const nextId = (prefix) => `${prefix}_${(uid += 1)}`;

/** Списки моделей по адресу — на сессию страницы, в настройки не пишутся. */
const modelCache = new Map();

/**
 * Поиск в выпадашке через select2 — тот же, что у списка моделей таверны.
 * Только если таверна его загрузила; иначе остаётся обычный `<select>`.
 * Выбор select2 сообщает jQuery-событием, а не нативным, поэтому слушатель
 * вешается ещё и через jQuery. Инициализация ждёт, пока узел окажется в
 * документе: выпадающему окну нужен родитель внутри блока, а не `body`, где
 * его перекрыла бы панель.
 *
 * На сенсорном экране select2 не ставится вовсе — так же поступает сама
 * таверна (`openai.js`, `if (!isMobile())` перед каждым `.select2`). Его поле
 * поиска получает фокус, вылезает клавиатура, окно меняет высоту, select2
 * пересчитывает позицию выпадашки, панель прокручивается — и так по кругу:
 * экран дёргается вверх. Обычный `<select>` открывает системный список.
 */
function enhanceSelect(select, onPick, tries = 20) {
  if (isTouchScreen()) return;
  const $ = globalThis.jQuery;
  if (typeof $ !== 'function' || !$.fn || typeof $.fn.select2 !== 'function') return;
  if (!select.isConnected) {
    if (tries > 0) setTimeout(() => enhanceSelect(select, onPick, tries - 1), 50);
    return;
  }
  try {
    const $s = $(select);
    if ($s.data('select2')) $s.select2('destroy');
    $s.off('select2:select.academy');
    $s.select2({
      width: '100%',
      placeholder: 'выбрать из списка',
      dropdownParent: $(select.parentElement),
    });
    $s.on('select2:select.academy', () => onPick(select.value));
  } catch { /* без поиска — обычная выпадашка, тоже рабочая */ }
}

/**
 * Палец вместо мыши: телефон или планшет. Медиазапрос, а не user agent —
 * в тестах и на стенде его можно подменить через `matchMedia`.
 */
export function isTouchScreen() {
  try {
    return typeof globalThis.matchMedia === 'function'
      && globalThis.matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Снять select2, если он был: пустой список не должен оставлять видимую рамку. */
function dropEnhance(select) {
  const $ = globalThis.jQuery;
  try { if (typeof $ === 'function' && $(select).data('select2')) $(select).select2('destroy'); } catch { /* нечего снимать */ }
}

export function renderApiBlock(host, view) {
  const a = view.api;
  const status = el('div', { class: 'academy-status' });
  const group = nextId('academy_api_source');
  const own = a.routed === 'endpoint';

  const endpoint = el('input', { type: 'text', class: 'text_pole academy-input', value: a.endpoint, placeholder: 'https://api.example.com' });
  const key = el('input', { type: 'password', class: 'text_pole academy-input', value: a.key, placeholder: 'ключ' });
  const model = el('input', { type: 'text', class: 'text_pole academy-input', value: a.model, placeholder: 'имя модели' });
  // Выпадашка списка — настоящий `<select>`, как у таверны во вкладке API.
  // Раньше тут был `<datalist>` при поле: он фильтрует подсказки по уже
  // вписанному тексту, и при выбранной модели список не раскрывался вовсе.
  // Поле рядом остаётся — модель, которой нет в списке, вписывают руками.
  const models = el('select', { class: 'text_pole academy-input academy-model-pick', hidden: true });

  // `quiet` — не украшение, а условие работоспособности кнопок ниже. Обычный
  // `setSettings` заканчивается перерисовкой всей вкладки; она отцепляет от
  // документа тот самый узел `status`, в который `runAction` пишет ответ, и
  // результат — «Связь есть» или текст отказа — не видит никто. Поля API не
  // влияют ни на один другой экран, поэтому перерисовывать ради них нечего.
  const push = () => safe(() => host.setSettings({
    api: { endpoint: endpoint.value.trim(), key: key.value, model: model.value.trim() },
  }, { quiet: true }), null);
  for (const input of [endpoint, key, model]) input.addEventListener('change', push);

  const pickModel = (id) => {
    if (!id) return;
    model.value = id;
    push();
    setStatus(status, 'ok', `Модель: ${id}.`);
  };
  const fillModels = (list) => {
    clear(models);
    models.append(el('option', { value: '', text: `— выбрать из списка (${list.length}) —` }));
    const current = model.value.trim();
    for (const m of list) models.append(el('option', { value: m, text: m, selected: m === current }));
    models.value = list.includes(current) ? current : '';
    models.hidden = !list.length;
    if (list.length) enhanceSelect(models, pickModel);
    else dropEnhance(models);
  };
  models.addEventListener('change', () => pickModel(models.value));
  // Список, полученный раньше для этого же адреса, переживает перерисовку:
  // иначе он пропадал бы при каждом переключении вкладки.
  const cached = modelCache.get(String(a.endpoint || '').trim());
  if (own && cached && cached.length) fillModels(cached);

  // Источник — единственная настройка блока, которая меняет сам блок: при
  // «актуальном API» полям адреса и ключа делать нечего. Поэтому она — и только
  // она — сохраняется с перерисовкой, а раскрытым блок остаётся сам (`section`).
  const chooseSource = (id) => {
    safe(() => host.setSettings({ api: { source: id } }), null);
    renderPanel(host);
    renderSettingsBlock(host);
  };

  const SOURCES = [
    {
      id: 'tavern',
      label: 'Подключение таверны',
      hint: 'То, чем таверна отвечает прямо сейчас. Ключ вводить не нужно — расширение ничего не отправляет само.',
    },
    {
      id: 'own',
      label: 'Свой адрес с ключом',
      hint: 'Отдельное подключение — нужно, если генерацию хочется пустить на дешёвую модель.',
    },
  ];
  const sourceBox = el('div', { class: 'academy-modes' }, SOURCES.map((m) => {
    const active = m.id === (own ? 'own' : 'tavern');
    const radio = el('input', { type: 'radio', name: group, value: m.id, checked: active });
    radio.addEventListener('change', () => chooseSource(m.id));
    return el('label', { class: active ? 'academy-mode academy-mode-on' : 'academy-mode' }, [
      radio,
      el('span', { class: 'academy-mode-label', text: m.label }),
      el('span', { class: 'academy-note', text: m.hint }),
    ]);
  }));

  // Профили подключения. Их может не быть вовсе (сборка без менеджера
  // подключений или ни одного заведённого) — тогда пункт ровно один, и
  // выпадашка не нужна: «текущее подключение» и так единственное.
  let profileRow = null;
  if (!own && a.profiles.length) {
    const select = el('select', { class: 'text_pole academy-input' }, [
      el('option', { value: '', text: 'То, что выбрано в таверне сейчас', selected: !a.profile }),
      ...a.profiles.map((p) => el('option', {
        value: p.id,
        text: p.model ? `${p.name} (${p.model})` : p.name,
        selected: p.id === a.profile,
      })),
    ]);
    select.value = a.profile;
    select.addEventListener('change', () => {
      safe(() => host.setSettings({ api: { profile: select.value } }, { quiet: true }), null);
      setStatus(status, 'note', select.value
        ? 'Профиль выбран. Проверьте связь — запрос пойдёт через него.'
        : 'Выбрано то, что стоит в таверне сейчас.');
    });
    profileRow = el('label', { class: 'academy-field' }, [el('span', { text: 'Профиль подключения' }), select]);
  }

  const modelsBtn = own ? el('div', {
    class: 'menu_button academy-btn academy-btn-small',
    text: 'Список моделей',
    onclick: async (e) => {
      push();
      const res = await runAction(e.currentTarget, status, () => call(host, 'listModels'), 'Список получен.');
      const list = ((res && res.models) || []).map(String);
      if (list.length) modelCache.set(endpoint.value.trim(), list);
      fillModels(list);
      // Список пришёл через сервер таверны (9.1.7, `api.js: listModels`) —
      // сказать об этом одной строкой: ключ в этот раз прошёл через сервер
      // самой таверны, и человек, у которого браузер «не видит» адрес, должен
      // понимать, почему список всё-таки есть.
      const via = res && res.via === 'tavern-backend' ? ' Адрес не пускает запросы из браузера, поэтому список спросил сервер таверны — тем же адресом и ключом.' : '';
      if (list.length) setStatus(status, 'ok', `Моделей: ${list.length}. Выберите модель в выпадашке под полем «Модель».${via}`);
    },
  }) : null;

  return section('API для генерации', [
    el('p', {
      class: 'academy-note',
      text: own
        // Про сервер таверны сказано прямо (9.1.7): если адрес не пускает
        // браузер (CORS), список моделей запрашивает сервер таверны — ключ
        // проходит через него, хотя дальше указанного адреса не уходит.
        ? 'Ключ лежит в настройках таверны открытым текстом и попадает в их экспорт. Никуда, кроме указанного адреса, он не уходит;'
          + ' если адрес не пускает запросы из браузера, список моделей за вас спросит сервер самой таверны — тем же адресом и ключом.'
        : 'Генерация пойдёт тем же подключением, которым таверна отвечает в чате. Ключ здесь вводить не нужно и никуда он не уезжает: запрос делает сама таверна.',
    }),
    sourceBox,
    !own && a.connectionAvailable === false
      ? el('p', { class: 'academy-warn', text: 'Таверна сейчас не отдаёт ни одного подключения: расширению генерировать нечем. Впишите свой адрес либо настройте подключение в самой таверне.' })
      : null,
    a.profileMissing
      ? el('p', { class: 'academy-warn', text: 'Выбранный профиль подключения в таверне больше не найден — выберите его заново.' })
      : null,
    profileRow,
    own ? el('label', { class: 'academy-field' }, [el('span', { text: 'Адрес' }), endpoint]) : null,
    own ? el('label', { class: 'academy-field' }, [el('span', { text: 'Ключ' }), key]) : null,
    own ? el('label', { class: 'academy-field' }, [el('span', { text: 'Модель' }), model]) : null,
    own ? el('div', { class: 'academy-field' }, [models]) : null,
    // Списка моделей у подключения таверны нет и быть не может: модель там
    // выбирает сама таверна. Кнопку в этом случае не рисуем вовсе — нажатие,
    // которое всегда отвечает «списка нет», хуже честной строки.
    !own ? el('p', { class: 'academy-note', text: 'Своего списка моделей у подключения таверны нет: модель задаёт сама таверна (или пресет выбранного профиля).' }) : null,
    el('div', { class: 'academy-row academy-row-buttons' }, [
      modelsBtn,
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: 'Проверить связь',
        onclick: async (e) => {
          push();
          await runAction(e.currentTarget, status, () => call(host, 'testApi'), 'Связь есть.');
        },
      }),
    ]),
    status,
  ]);
}

/**
 * Секретарь и правило экзаменов. Секретарь — общая настройка расширения;
 * правило — своё у чата, поэтому без семестра его выбирать не из чего.
 */
export function renderAnalysisBlock(host, view) {
  const ruleGroup = nextId('academy_exam_rule');
  const status = el('div', { class: 'academy-status' });
  const rules = view.examRules.length
    ? el('div', { class: 'academy-modes' }, view.examRules.map((r) => {
      const radio = el('input', { type: 'radio', name: ruleGroup, value: r.id, checked: r.active });
      radio.addEventListener('change', async () => {
        const res = await call(host, 'setExamRule', r.id);
        if (res && res.ok === false) setStatus(status, 'error', res.error || 'Не вышло.');
        else renderPanel(host);
      });
      return el('label', { class: r.active ? 'academy-mode academy-mode-on' : 'academy-mode' }, [
        radio,
        el('span', { class: 'academy-mode-label', text: r.label }),
        el('span', { class: 'academy-note', text: r.hint }),
      ]);
    }))
    : el('p', { class: 'academy-note', text: 'Правило экзаменов выбирается, когда в чате заведён семестр.' });

  return section('Секретарь и правило экзаменов', [
    el('p', { class: 'academy-note', text: 'Секретарь — отдельный запрос через API Академии, только по кнопке на плашке под ответом: читает ответ модели и записывает оценки, прогулы, опоздания и перемены в отношении преподавателей. Последний ответ пересчитывается начисто, старый получает поправку датой того ответа. Каждый вывод можно вычеркнуть.' }),
    el('p', { class: 'academy-note', text: 'Кто решает исход контрольного в этом чате:' }),
    rules,
    status,
  ]);
}

export function renderModeBlock(host, view) {
  const group = nextId('academy_mode');
  const modeBox = el('div', { class: 'academy-modes' }, view.modes.map((m) => {
    const radio = el('input', { type: 'radio', name: group, value: m.id, checked: m.active });
    radio.addEventListener('change', () => {
      safe(() => host.setSettings({ mode: m.id }), null);
      renderPanel(host);
      renderSettingsBlock(host);
    });
    return el('label', { class: m.active ? 'academy-mode academy-mode-on' : 'academy-mode' }, [
      radio,
      el('span', { class: 'academy-mode-label', text: m.label }),
      el('span', { class: 'academy-note', text: m.hint }),
    ]);
  }));

  const marker = el('input', { type: 'checkbox', checked: view.injectMarker, disabled: view.injectMarkerLocked });
  marker.addEventListener('change', () => host.setSettings({ injectMarker: marker.checked }));

  const words = el('input', { type: 'checkbox', checked: view.relativeWords });
  words.addEventListener('change', () => host.setSettings({ relativeWords: words.checked }));

  const viaMacro = el('input', { type: 'checkbox', checked: view.statusViaMacro === true });
  viaMacro.addEventListener('change', () => host.setSettings({ statusViaMacro: viaMacro.checked }));

  return section('Источник времени', [
    // Слова технические и в пресеты не едут — как и всё в этом блоке.
    view.markerRisk
      ? el('p', {
        class: 'academy-warn',
        text: 'В настройках таверны включён «Encode tags» — служебная метка станет видна прямо в тексте ответа. Выключите его в настройках пользователя либо перейдите на режим «из контекста».',
      })
      : null,
    modeBox,
    el('label', { class: 'academy-check' }, [
      marker,
      el('span', {
        text: view.injectMarkerLocked
          ? 'Инжектить инструкцию про метку (в режиме «из контекста» не нужна)'
          : 'Инжектить инструкцию про метку',
      }),
    ]),
    el('label', { class: 'academy-check' }, [
      words,
      el('span', { text: 'Понимать относительные сдвиги словами («на следующее утро», «через неделю») — самая ненадёжная часть' }),
    ]),
    // 9.3.1: хвост промпта тесный (9.5), и место строки решает человек.
    // Инструкция метки и одноразовый факт остаются инжектами — их место важно.
    el('label', { class: 'academy-check' }, [
      viaMacro,
      el('span', {
        text: 'Вставлять строку состояния через макрос {{academy}} — сами поставьте его в системный промпт, заметку автора или карточку; автоинжект строки выключится',
      }),
    ]),
  ]);
}

/* --- пресет заведения ------------------------------------------------------ */

/**
 * Выбор пресета.
 *
 * Смена пресета на уже начатом семестре — опасное действие, и подтверждение
 * рисуется здесь же в панели, а не браузерным `confirm()`: модальные окна
 * браузера в таверне запрещены, а собственный попап тут не нужен — вопрос
 * помещается в две строки под селектом. Двухшаговый контракт держит `index.js`
 * (`actions.setPreset`), панель только показывает то, что он вернул: сначала
 * `needs-confirm` со словами про расхождение, потом — второй вызов с `confirm`.
 */
export function renderPresetBlock(host, view) {
  const U = view.labels;
  const p = view.presets;
  const status = el('div', { class: 'academy-status' });
  const confirmBox = el('div', { class: 'academy-confirm', hidden: true });

  const select = el('select', { class: 'text_pole academy-input' },
    p.list.map((item) => el('option', {
      value: item.id,
      selected: item.active,
      // Свой пресет помечен: встроенный и его копия-основа иначе неотличимы
      // до первого нажатия «Удалить».
      text: item.broken ? `${item.name} (файл не прочитан)` : (item.user ? `${item.name} (${PRESET_TEXT.userMark})` : item.name),
    })));

  const apply = async (button, confirm) => {
    const id = select.value;
    if (id === p.active) { setStatus(status, 'ok', U.presetSameNote); return; }
    const res = await runAction(button, status, () => call(host, 'setPreset', id, { confirm }), U.presetChanged);
    if (res && res.needsConfirm) {
      // Вопрос — не ошибка: красная строка статуса с тем же текстом под ним
      // читалась как отказ.
      setStatus(status, 'ok', '');
      askConfirm(confirmBox, U, {
        reasons: res.reasons || [],
        current: res.current,
        incoming: null,
        question: res.question || null,
        onYes: (btn) => apply(btn, true),
        onNo: () => { select.value = p.active; setStatus(status, 'ok', U.importCancelled); },
      });
      return;
    }
    if (res && res.ok !== false) {
      // Смена пресета меняет ярлыки вкладок, слова панели и шкалу оценок —
      // перерисовывается всё дерево целиком, а не одна секция. Тот же промах
      // уже чинили однажды на сшивке вкладок, и повторять его негде.
      renderPanel(host);
      renderSettingsBlock(host);
    }
  };

  // --- переносимые пресеты (9.3.2) ------------------------------------------
  //
  // Выгрузка и удаление действуют на то, что выбрано в выпадашке, а не на
  // активный пресет: «выгрузить японскую школу как основу для своей» не
  // должно требовать сперва включить её в идущем чате.
  const T = PRESET_TEXT;
  const isUser = (id) => p.list.some((item) => item.id === id && item.user);
  const nameOf = (id) => ((p.list.find((item) => item.id === id) || {}).name || id);

  const exportPreset = async (e) => {
    const res = await runAction(e.currentTarget, status, () => call(host, 'exportPreset', select.value), '');
    if (!res || res.ok === false) return;
    if (saveFile(res.json, res.filename, status)) setStatus(status, 'ok', fill(T.exportOk, { filename: res.filename }));
  };

  const deleteBox = el('div', { class: 'academy-confirm', hidden: true });
  const remove = async (button, confirm) => {
    const id = select.value;
    const res = await runAction(button, status, () => call(host, 'deletePreset', id, { confirm }), T.deleted);
    if (res && res.needsConfirm) {
      askConfirm(confirmBox, U, {
        reasons: res.reasons || [],
        current: res.current,
        incoming: null,
        onYes: (btn) => remove(btn, true),
        onNo: () => setStatus(status, 'ok', U.importCancelled),
      });
      return;
    }
    if (res && res.ok !== false) { renderPanel(host); renderSettingsBlock(host); }
  };
  // Удаление — в два нажатия всегда, даже когда пресет не активен: вернуть
  // его можно только файлом, а файла у человека может и не быть.
  const askDelete = () => {
    clear(deleteBox);
    deleteBox.hidden = false;
    deleteBox.append(
      el('div', { class: 'academy-confirm-title', text: fill(T.deleteConfirm, { name: nameOf(select.value) }) }),
      el('div', { class: 'academy-row academy-row-buttons' }, [
        el('div', {
          class: 'menu_button academy-btn academy-btn-main',
          text: T.deleteYes,
          onclick: (e) => { deleteBox.hidden = true; remove(e.currentTarget, false); },
        }),
        el('div', {
          class: 'menu_button academy-btn academy-btn-small',
          text: T.cancel,
          onclick: () => { deleteBox.hidden = true; setStatus(status, 'ok', U.importCancelled); },
        }),
      ]),
    );
  };
  const deleteBtn = el('div', {
    class: 'menu_button academy-btn academy-btn-small academy-btn-danger',
    text: T.deleteButton,
    onclick: askDelete,
  });
  // Кнопка удаления есть только у своего пресета. Выпадашка перерисовки не
  // вызывает, поэтому видимость правится на месте.
  const syncDelete = () => { deleteBtn.hidden = !isUser(select.value); deleteBox.hidden = true; };
  select.addEventListener('change', syncDelete);
  syncDelete();

  // Узел статуса — на свою копию блока: блок рисуется и в панели, и в меню
  // расширений, и итог загрузки после перерисовки ищет СВОЙ новый узел.
  const scope = sectionScope;
  mounted.presetStatus = { ...(mounted.presetStatus || {}), [scope]: status };
  const importBlock = renderPresetImport(host, U, status, confirmBox, scope);

  return section(U.presetSection, [
    el('p', { class: 'academy-note', text: U.presetNote }),
    p.notice ? el('p', { class: 'academy-warn', text: p.notice }) : null,
    el('label', { class: 'academy-field' }, [el('span', { text: T.pickField }), select]),
    p.drift ? el('p', { class: 'academy-warn', text: p.drift }) : null,
    p.gone ? el('p', { class: 'academy-warn', text: p.gone }) : null,
    el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: U.presetChange,
        onclick: (e) => apply(e.currentTarget, false),
      }),
      el('div', { class: 'menu_button academy-btn academy-btn-small', text: T.exportButton, onclick: exportPreset }),
      deleteBtn,
    ]),
    deleteBox,
    el('p', { class: 'academy-note', text: T.exportNote }),
    importBlock,
    confirmBox,
    status,
  ]);
}

/**
 * Отдать текст браузеру файлом. Тот же приём, что у выгрузки состояния:
 * `Blob` + временная ссылка, живущая ровно один клик.
 * @returns {boolean} получилось ли
 */
function saveFile(text, filename, status) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = el('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (err) {
    setStatus(status, 'error', `Файл не отдался браузеру: ${(err && err.message) || err}`);
    return false;
  }
}

/**
 * Загрузка пресета из файла (9.3.2): выбрать файл → превью → «добавить» или
 * «добавить и применить».
 *
 * Разбор и запись — два разных вызова, как у загрузки состояния (решение 8
 * этапа 3): человек видит, что за заведение приедет, ДО того, как оно легло в
 * настройки. Текст файла держится в замыкании между превью и кнопкой — второй
 * раз файл не читается, а превью и запись проверяют одно и то же.
 */
function renderPresetImport(host, U, status, confirmBox, scope) {
  const T = PRESET_TEXT;
  const preview = el('div', { class: 'academy-confirm academy-preset-preview', hidden: true });
  const file = el('input', { type: 'file', accept: 'application/json,.json', class: 'academy-file' });

  const reset = () => { preview.hidden = true; clear(preview); file.value = ''; };
  const statusAfter = () => ((mounted.presetStatus && mounted.presetStatus[scope]) || status);

  const done = (res, apply) => {
    const name = String(res.name || res.added || '');
    reset();
    renderPanel(host);
    renderSettingsBlock(host);
    // Перерисовка отцепила старый узел статуса — итог пишется в новый.
    const target = statusAfter();
    setStatus(target, 'ok', fill(apply ? T.addedApplied : T.added, { name }));
  };

  const add = async (button, text, apply) => {
    const res = await runAction(button, status, () => call(host, 'importPreset', text, { apply }), '');
    if (!res) return;
    if (res.needsConfirm && res.added) {
      // Пресет уже добавлен; вопрос — только про смену на идущем семестре.
      reset();
      setStatus(status, 'ok', '');
      askConfirm(confirmBox, U, {
        reasons: res.reasons || [],
        current: res.current,
        incoming: null,
        question: res.question || null,
        onYes: async (btn) => {
          const again = await runAction(btn, status, () => call(host, 'setPreset', res.added, { confirm: true }), U.presetChanged);
          if (again && again.ok !== false) done(res, true);
        },
        onNo: () => {
          renderPanel(host);
          renderSettingsBlock(host);
          setStatus(statusAfter(), 'ok', fill(T.addedNotApplied, { name: res.name || res.added }));
        },
      });
      return;
    }
    if (res.ok === false) return;
    done(res, apply);
  };

  const showPreview = (res, text) => {
    clear(preview);
    preview.hidden = false;
    const s = res.summary || {};
    // Через фильтр: штатный `append` превращает `null` в текст «null» — так
    // стенд на 360px и показал его под замечаниями.
    preview.append(...[
      el('div', { class: 'academy-confirm-title', text: T.previewTitle }),
      el('div', { class: 'academy-preset-name', text: s.name || s.id || '' }),
      s.line ? el('div', { class: 'academy-preset-line', text: s.line }) : null,
      res.renamed ? el('p', { class: 'academy-note', text: fill(T.previewRenamed, { id: s.id }) }) : null,
      res.warnings && res.warnings.length
        ? el('details', { class: 'academy-preset-warnings' }, [
          el('summary', { text: `${T.previewWarnings} (${res.warnings.length})` }),
          el('ul', { class: 'academy-errors' }, res.warnings.map((w) => el('li', { text: String(w) }))),
        ])
        : null,
      res.full ? el('p', { class: 'academy-warn', text: fill(T.full, { max: res.max || 20 }) }) : null,
      el('div', { class: 'academy-row academy-row-buttons' }, [
        el('div', { class: 'menu_button academy-btn academy-btn-main', text: T.addApply, onclick: (e) => add(e.currentTarget, text, true) }),
        el('div', { class: 'menu_button academy-btn academy-btn-small', text: T.add, onclick: (e) => add(e.currentTarget, text, false) }),
        el('div', { class: 'menu_button academy-btn academy-btn-small', text: T.cancel, onclick: () => { reset(); setStatus(status, 'ok', T.cancelled); } }),
      ]),
    ].filter(Boolean));
  };

  file.addEventListener('change', async () => {
    const picked = file.files && file.files[0];
    if (!picked) return;
    reset();
    // Размер — до чтения: на телефоне прочитать в память чужой гигабайт ради
    // отказа «слишком большой» — худший из вариантов.
    if (typeof picked.size === 'number' && picked.size > PRESET_MAX_BYTES) {
      setStatus(status, 'error', T.tooBig);
      return;
    }
    let text = '';
    try {
      text = await picked.text();
    } catch (err) {
      setStatus(status, 'error', fill(T.readFailed, { error: (err && err.message) || err }));
      return;
    }
    const res = await runAction(null, status, () => call(host, 'previewPreset', text), '');
    if (!res || res.ok === false) {
      // Причины отказа — списком: человек чинит файл руками, и одна причина
      // за раз — пять загрузок вместо одной (`core/preset.mjs`, решение 4).
      if (res && Array.isArray(res.errors) && res.errors.length > 1) {
        clear(preview);
        preview.hidden = false;
        preview.append(el('ul', { class: 'academy-errors' }, res.errors.map((x) => el('li', { text: String(x) }))));
      }
      file.value = '';
      return;
    }
    setStatus(status, 'ok', '');
    showPreview(res, text);
  });

  return el('div', { class: 'academy-preset-import' }, [
    el('label', { class: 'academy-field' }, [el('span', { text: T.importPick }), file]),
    el('p', { class: 'academy-note', text: T.importNote }),
    preview,
  ]);
}

/* --- лорбук академии (3.7) ------------------------------------------------- */

/**
 * Лорбук одной секцией.
 *
 * Два правила, из которых вытекает вся форма блока.
 *
 * 1. **Пустого экрана не бывает.** Галочка включена, а записей нет — у этого
 *    четыре разных причины (старая сборка без World Info, чат ещё не сохранён,
 *    семестр не начат, ошибка), и каждая называется вслух строкой из
 *    `view.lorebook.explain`. Молчание здесь хуже всего: человеку некуда пойти.
 * 2. **Осиротевшие показываются только вместе с кнопкой.** Список «лишнего в
 *    вашем World Info» без способа это убрать пугает и не даёт ничего, поэтому
 *    при пустом списке блока нет вовсе.
 */
export function renderLorebookBlock(host, view) {
  const U = view.labels;
  const L = view.lorebook;
  const status = el('div', { class: 'academy-status' });

  const toggle = el('input', { type: 'checkbox', checked: L.enabled });
  toggle.addEventListener('change', () => {
    safe(() => host.setSettings({ lorebook: { enabled: toggle.checked } }), null);
    // Лорбук заводится не сразу: `setSettings` синхронный, а поход в World Info
    // нет. Перерисовку делает сам `index.js`, когда синхронизация кончится.
    renderPanel(host);
  });

  const book = el('input', {
    type: 'text', class: 'text_pole academy-input', value: L.book, placeholder: U.lorebookBookHint,
  });
  book.addEventListener('change', () => {
    safe(() => host.setSettings({ lorebook: { book: book.value.trim() } }), null);
  });

  // --- форма «предложить запись» -------------------------------------------
  const newName = el('input', { type: 'text', class: 'text_pole academy-input', placeholder: U.lorebookNewNameHint });
  const newNote = el('input', { type: 'text', class: 'text_pole academy-input', placeholder: U.lorebookNewNoteHint });
  const kindGroup = nextId('academy_lore_kind');
  const kindPeople = el('input', { type: 'radio', name: kindGroup, value: 'people', checked: true });
  const kindPlaces = el('input', { type: 'radio', name: kindGroup, value: 'places' });

  const suggestForm = el('div', { class: 'academy-lore-form' }, [
    el('p', { class: 'academy-note', text: U.lorebookSuggestNote }),
    el('label', { class: 'academy-field' }, [el('span', { text: U.lorebookNewName }), newName]),
    el('label', { class: 'academy-field' }, [el('span', { text: U.lorebookNewNote }), newNote]),
    el('div', { class: 'academy-modes' }, [
      el('label', { class: 'academy-mode' }, [kindPeople, el('span', { class: 'academy-mode-label', text: U.lorebookKindPeople })]),
      el('label', { class: 'academy-mode' }, [kindPlaces, el('span', { class: 'academy-mode-label', text: U.lorebookKindPlaces })]),
    ]),
    el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: U.lorebookNewButton,
        onclick: async (e) => {
          const res = await runAction(e.currentTarget, status, () => call(host, 'suggestLorebookEntry', {
            name: newName.value.trim(),
            note: newNote.value.trim(),
            kind: kindPlaces.checked ? 'places' : 'people',
          }), U.lorebookNewOk);
          if (res && res.ok !== false) { newName.value = ''; newNote.value = ''; }
        },
      }),
    ]),
  ]);

  // --- предложения, ждущие решения -----------------------------------------
  const suggestList = L.suggest.length
    ? el('ul', { class: 'academy-lore-list' }, L.suggest.map((e) => el('li', { class: 'academy-lore-item' }, [
      el('div', { class: 'academy-lore-name', text: e.name }),
      e.text ? el('div', { class: 'academy-note', text: e.text }) : null,
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: U.lorebookAccept,
        onclick: (ev) => runAction(ev.currentTarget, status,
          () => call(host, 'acceptLorebookSuggestion', e.uid), U.lorebookAcceptOk),
      }),
    ])))
    : el('p', { class: 'academy-note', text: U.lorebookNoSuggest });

  // --- осиротевшие: без кнопки не показываются вовсе ------------------------
  const orphans = L.orphans.length
    ? [
      el('h5', { class: 'academy-sub-title', text: U.lorebookOrphansTitle }),
      el('p', { class: 'academy-note', text: U.lorebookOrphansNote }),
      el('ul', { class: 'academy-lore-list' },
        L.orphans.map((o) => el('li', { class: 'academy-lore-item' }, [el('code', { text: o.uid })]))),
      el('div', { class: 'academy-row academy-row-buttons' }, [
        el('div', {
          class: 'menu_button academy-btn academy-btn-small',
          text: fill(U.lorebookPrune, { count: L.orphans.length }),
          onclick: async (e) => {
            const res = await runAction(e.currentTarget, status, () => call(host, 'pruneLorebook'), '');
            if (res && res.ok !== false) {
              setStatus(status, 'ok', fill(U.lorebookPruned, { count: Number(res.removed) || 0 }));
              renderPanel(host);
            }
          },
        }),
      ]),
    ]
    : [];

  return section(U.lorebookSection, [
    el('label', { class: 'academy-check' }, [toggle, el('span', { text: U.lorebookToggle })]),
    el('p', { class: 'academy-note', text: U.lorebookNote }),
    // Всё ниже галочки существует только при включённом лорбуке: выключенный
    // лорбук — это одна строка, а не свёрнутая наполовину секция.
    ...(L.enabled ? [
      L.boundLine ? el('p', { class: 'academy-note', text: L.boundLine }) : null,
      L.explain ? el('p', { class: 'academy-warn', text: L.explain }) : null,
      el('label', { class: 'academy-field' }, [el('span', { text: U.lorebookBookField }), book]),
      L.measureLine ? el('p', { class: 'academy-note', text: L.measureLine }) : null,
      L.overCapLine ? el('p', { class: 'academy-warn', text: L.overCapLine }) : null,
      el('div', { class: 'academy-row academy-row-buttons' }, [
        el('div', {
          class: 'menu_button academy-btn academy-btn-small',
          text: U.lorebookRefresh,
          onclick: async (e) => {
            const res = await runAction(e.currentTarget, status, () => call(host, 'syncLorebook'), U.lorebookRefreshOk);
            if (res && res.ok !== false) renderPanel(host);
          },
        }),
      ]),
      el('h5', { class: 'academy-sub-title', text: U.lorebookSuggestTitle }),
      suggestList,
      el('h5', { class: 'academy-sub-title', text: U.lorebookNewTitle }),
      suggestForm,
      ...orphans,
    ] : [el('p', { class: 'academy-note', text: U.lorebookOff })]),
    status,
  ]);
}

/* --- выгрузка и загрузка состояния (3.8) ----------------------------------- */

/**
 * Файл — единственное место панели, где нужен настоящий DOM API: `Blob`,
 * `URL.createObjectURL` и `<input type=file>` ничем не подменяются. Поэтому всё
 * остальное — разбор, сводки и решение о записи — живёт в `storage.js` и
 * приходит сюда готовым: в Node прогоняется вся выгрузка, кроме самого
 * нажатия «сохранить как».
 *
 * Подтверждение рисуется тут же, в панели. Браузерный `confirm()` в таверне
 * запрещён, а свои попапы таверны (`popup.js`) здесь ничего не добавляют:
 * вопрос со сводками «что сейчас» и «что приедет» — это четыре строки, и они
 * помещаются под кнопкой.
 */
export function renderTransferBlock(host, view) {
  const U = view.labels;
  const status = el('div', { class: 'academy-status' });
  const confirmBox = el('div', { class: 'academy-confirm', hidden: true });

  const file = el('input', { type: 'file', accept: 'application/json,.json', class: 'academy-file' });

  const load = async (text, button, confirm) => {
    const res = await runAction(button, status, () => call(host, 'importState', text, { confirm }), U.importOk);
    if (res && res.needsConfirm) {
      askConfirm(confirmBox, U, {
        reasons: res.reasons || [],
        current: res.current,
        incoming: res.incoming,
        onYes: (btn) => load(text, btn, true),
        onNo: () => { file.value = ''; setStatus(status, 'ok', U.importCancelled); },
      });
      return;
    }
    if (res && res.ok !== false) {
      confirmBox.hidden = true;
      file.value = '';
      mounted.tab = 'today';
      renderPanel(host);
    }
  };

  file.addEventListener('change', async () => {
    const picked = file.files && file.files[0];
    if (!picked) return;
    confirmBox.hidden = true;
    let text = '';
    try {
      text = await picked.text();
    } catch (err) {
      setStatus(status, 'error', `Файл не прочитался: ${(err && err.message) || err}`);
      return;
    }
    await load(text, null, false);
  });

  const save = async (e) => {
    const res = await runAction(e.currentTarget, status, () => call(host, 'exportState'), '');
    if (!res || res.ok === false) return;
    try {
      // Скачивание: `Blob` + временная ссылка. Живёт ровно один клик — иначе
      // объектный URL держит копию состояния в памяти вкладки до перезагрузки.
      const url = URL.createObjectURL(new Blob([res.json], { type: 'application/json' }));
      const a = el('a', { href: url, download: res.filename });
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(status, 'ok', fill(U.exportOk, { filename: res.filename }));
    } catch (err) {
      setStatus(status, 'error', `Файл не отдался браузеру: ${(err && err.message) || err}`);
    }
  };

  return section(U.transferSection, [
    el('p', { class: 'academy-note', text: U.transferNote }),
    el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', { class: 'menu_button academy-btn academy-btn-small', text: U.exportButton, onclick: save }),
    ]),
    el('label', { class: 'academy-field' }, [el('span', { text: U.importPick }), file]),
    confirmBox,
    status,
  ]);
}

/** Сводка состояния одной строкой: пресет, день, предметы, оценки. */
function summaryLine(summary, U) {
  if (!summary) return U.summaryNothing;
  const tail = summary.started ? '' : ` (${U.summaryNotStarted})`;
  return fill(U.summaryLine, {
    presetId: summary.presetId || '—',
    day: summary.day || '—',
    subjects: summary.subjects,
    grades: summary.grades,
  }) + tail;
}

/**
 * Вопрос «заменить то, что есть?» прямо в панели.
 *
 * Обе сводки — «что сейчас» и «что приедет» — показываются ДО того, как
 * что-нибудь произошло: ради этого разбор и запись в `storage.js` разведены на
 * два вызова, и терять здесь эту возможность было бы бессмысленно.
 */
function askConfirm(box, U, { reasons, current, incoming, onYes, onNo, question = null }) {
  clear(box);
  box.hidden = false;
  // Смена пресета приходит своим вопросом (`question` из `setPreset`): это
  // выбор, а не ошибка, поэтому обычным текстом, без красного списка и без
  // сводки с id пресета.
  box.append(el('div', { class: 'academy-confirm-title', text: question ? question.title : U.importConfirmTitle }));
  if (question) {
    if (question.note) box.append(el('p', { class: 'academy-note', text: question.note }));
  } else {
    if (reasons && reasons.length) {
      box.append(el('ul', { class: 'academy-errors' }, reasons.map((r) => el('li', { text: String(r) }))));
    }
    box.append(el('div', { class: 'academy-summary' }, [
      el('div', {}, [el('b', { text: `${U.summaryCurrent}: ` }), summaryLine(current, U)]),
      incoming ? el('div', {}, [el('b', { text: `${U.summaryIncoming}: ` }), summaryLine(incoming, U)]) : null,
    ]));
  }
  box.append(el('div', { class: 'academy-row academy-row-buttons' }, [
    el('div', {
      class: 'menu_button academy-btn academy-btn-main',
      text: question ? PRESET_TEXT.switchYes : U.importConfirmYes,
      onclick: (e) => { box.hidden = true; onYes(e.currentTarget); },
    }),
    el('div', {
      class: 'menu_button academy-btn academy-btn-small',
      text: question ? PRESET_TEXT.switchNo : U.importConfirmNo,
      onclick: () => { box.hidden = true; onNo(); },
    }),
  ]));
}

/**
 * Галочка отладки. Живёт отдельной секцией и рисуется и в панели, и в блоке
 * меню расширений — рядом с источником времени, потому что README посылает сюда
 * ровно одним движением: «время не идёт — включите отладку и посмотрите
 * источник» (`:632-633`).
 *
 * Сам разбор сюда не выводится: он длинный, а «Настройки» на телефоне и без
 * него прокручиваются долго. Разбор — пятая вкладка, которой при выключенной
 * галочке не существует (`tabsFor`).
 */
/**
 * Звук вех (9.4.2). Галочка живёт в настройках расширения (`milestoneSound`,
 * умолчание — выкл.), а не в состоянии чата: это привычка человека, а не
 * факт семестра. Кнопка «Послушать» — не украшение: браузер пускает звук
 * только после жеста на странице, и человек, включивший галочку, должен иметь
 * способ убедиться, что звук вообще есть, не дожидаясь следующей вехи.
 */
/**
 * Персонаж карточки (`core/card-cast.mjs`): кого играет бот. Название карточки
 * в таверне — не всегда имя («Your Himbo Roommate»), и без имени персонаж бота
 * приходил кандидатом в сокурсники. Список — по карточке, не по чату. Раскрыт,
 * пока человек его не проверил.
 */
export function renderCardCastBlock(host, preset) {
  const X = extraLabels(preset);
  const U = uiLabels(preset);
  const info = safe(() => (host.getCardCast ? host.getCardCast() : null), null) || {};
  if (info.group) return section(X.castSection, [el('p', { class: 'academy-note', text: X.castGroup })]);
  if (!info.available) return section(X.castSection, [el('p', { class: 'academy-note', text: X.castNone })]);
  const cast = info.cast || { people: [], source: 'auto', checked: false };
  const status = el('div', { class: 'academy-status' });
  const rows = el('div', { class: 'academy-cast-rows' });

  const addRow = (person) => {
    const input = el('input', {
      type: 'text', class: 'text_pole academy-input', value: personLine(person) || '', placeholder: X.castNamePlaceholder,
    });
    const role = el('select', { class: 'text_pole academy-input academy-cast-role' }, [
      el('option', { value: 'main', text: X.castRoleMain }),
      el('option', { value: 'npc', text: X.castRoleNpc }),
    ]);
    role.value = person && person.role === 'npc' ? 'npc' : 'main';
    const row = el('div', { class: 'academy-row academy-cast-row' }, [input, role]);
    row.append(el('div', {
      class: 'menu_button academy-btn academy-btn-small',
      text: X.castRemove,
      onclick: () => row.remove(),
    }));
    row.read = () => personFromLine(input.value, role.value);
    rows.append(row);
  };
  for (const p of cast.people) addRow(p);
  if (!cast.people.length) addRow(null);

  let note = '';
  if (!cast.checked) {
    if (!cast.people.length) note = X.castEmpty;
    else note = cast.source === 'model' ? X.castModel : X.castAuto;
  }

  return section(X.castSection, [
    el('p', { class: 'academy-note', text: fill(X.castNote, { title: info.title || '—', course: U.classmatesTitle }) }),
    note ? el('p', { class: 'academy-note academy-note-warn', text: note }) : null,
    rows,
    el('p', { class: 'academy-note', text: X.castHint }),
    el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', { class: 'menu_button academy-btn academy-btn-small', text: X.castAdd, onclick: () => addRow(null) }),
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: X.castGuess,
        onclick: async (e) => {
          const res = await runAction(e.currentTarget, status, () => call(host, 'guessCardCast'), X.castGuessOk);
          if (res && res.ok !== false) renderPanel(host);
        },
      }),
      el('div', {
        class: 'menu_button academy-btn academy-btn-main',
        text: X.castSave,
        onclick: async (e) => {
          const people = [...rows.children].map((r) => (typeof r.read === 'function' ? r.read() : null)).filter(Boolean);
          const res = await runAction(e.currentTarget, status, () => call(host, 'saveCardCast', people), X.castSaved);
          if (res && res.ok !== false) renderPanel(host);
        },
      }),
    ]),
    status,
  ]);
}

export function renderSoundBlock(host, preset, settings) {
  const X = extraLabels(preset);
  const status = el('div', { class: 'academy-status' });
  const box = el('input', { type: 'checkbox', checked: settings.milestoneSound === true });
  box.addEventListener('change', () => safe(() => host.setSettings({ milestoneSound: box.checked }, { quiet: true }), null));
  return section(X.soundSection, [
    el('label', { class: 'academy-check' }, [box, el('span', { text: X.soundToggle })]),
    el('p', { class: 'academy-note', text: X.soundNote }),
    el('div', { class: 'academy-row academy-row-buttons' }, [
      el('div', {
        class: 'menu_button academy-btn academy-btn-small',
        text: X.soundTry,
        onclick: () => { if (!playChime()) setStatus(status, 'note', X.soundTried); },
      }),
    ]),
    status,
  ]);
}

/**
 * Лента (шаг 4): рубильник слоя 3, авто-режим и фон в сцене. Живут в
 * настройках расширения (`feed.hooks`, `feed.auto`, `feed.background`), как
 * звук: это привычка человека, а не факт семестра. Рубильник выключен —
 * кнопки «Взять в сюжет» нет, и ни один повод в промпт не уходит; авто-режим
 * без рубильника молчит тоже. Фон — своя галочка: поводы ему не указ.
 * Заголовок — слово вкладки пресета («Поток», «Молва»): одно слово на ленту.
 */
export function renderFeedBlock(host, preset, settings) {
  const X = extraLabels(preset);
  const U = uiLabels(preset);
  const feed = (settings && settings.feed) || {};
  const hooks = el('input', { type: 'checkbox', checked: feed.hooks !== false });
  const auto = el('input', { type: 'checkbox', checked: feed.auto === true, disabled: feed.hooks === false });
  const background = el('input', { type: 'checkbox', checked: feed.background !== false });
  hooks.addEventListener('change', () => safe(() => host.setSettings({ feed: { hooks: hooks.checked } }), null));
  auto.addEventListener('change', () => safe(() => host.setSettings({ feed: { auto: auto.checked } }), null));
  background.addEventListener('change', () => safe(() => host.setSettings({ feed: { background: background.checked } }), null));
  return section(U.tabFeed, [
    el('label', { class: 'academy-check' }, [hooks, el('span', { text: X.feedHooksToggle })]),
    el('label', { class: 'academy-check' }, [background, el('span', { text: X.feedBackgroundToggle })]),
    el('label', { class: 'academy-check' }, [auto, el('span', { text: X.feedAutoToggle })]),
    el('p', { class: 'academy-note', text: X.feedSettingsNote }),
  ]);
}

/** Один контекст на страницу: браузеры ограничивают их число. */
let chimeCtx = null;

/**
 * Короткий звук вехи на WebAudio, без файлов (9.4.2): две синусоиды квартой
 * вверх (ми → ля второй октавы), по ~0,35 с, с мягкой атакой и затуханием —
 * «колокольчик», а не сигнал ошибки. Громкость 0,08: звук не должен
 * перекрывать голос TTS и музыку соседей.
 *
 * Возвращает `true`, если звук поставлен в очередь. `false` — WebAudio нет
 * или браузер ещё не разрешил странице звук (контекст `suspended` до первого
 * жеста): тогда молча, без исключений — звук вежливость, а не условие.
 */
export function playChime() {
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (typeof AC !== 'function') return false;
    chimeCtx = chimeCtx || new AC();
    const ctx = chimeCtx;
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      Promise.resolve(ctx.resume()).catch(() => {});
    }
    const t0 = (Number(ctx.currentTime) || 0) + 0.02;
    for (const [freq, at] of [[659.25, 0], [880, 0.12]]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.08, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.4);
    }
    return ctx.state !== 'suspended';
  } catch {
    return false;
  }
}

export function renderDebugBlock(host, view) {
  const T = DEBUG_TEXT;
  const box = el('input', { type: 'checkbox', checked: view.debug });
  box.addEventListener('change', () => {
    safe(() => host.setSettings({ debug: box.checked }), null);
    // Вкладки собираются заново при каждой отрисовке, поэтому пятая появляется
    // и исчезает сразу, без перемонтирования панели.
    renderPanel(host);
    renderSettingsBlock(host);
  });
  return section(T.section, [
    el('label', { class: 'academy-check' }, [box, el('span', { text: T.toggle })]),
    el('p', { class: 'academy-note', text: T.hint }),
  ]);
}

/**
 * «Портреты» (аватарки, шаг 4): чем рисовать, модель, стиль. Живут в
 * настройках расширения (`draw`), как звук и лента: привычка человека, а не
 * факт семестра. В выборе — только пути, у которых в таверне есть ключ или
 * настроенная генерация (`core/draw.availableRoutes`); ключей тут нет, и
 * вводить их некуда — рисует сервер таверны её же ключами. Нечем рисовать —
 * подсказка, что подключить. Хост без `getDraw` — блока нет.
 */
export function renderDrawBlock(host, preset, settings) {
  const info = host && typeof host.getDraw === 'function' ? safe(() => host.getDraw(), null) : null;
  if (!info) return null;
  const X = extraLabels(preset);
  const draw = (settings && settings.draw) || {};
  const select = (label, options, value, onPick, cls) => {
    const node = el('select', { class: `text_pole academy-input ${cls}` },
      options.map((o) => el('option', { value: o.id, text: o.label, selected: o.id === value })));
    node.value = value;
    node.addEventListener('change', () => onPick(node.value));
    return el('label', { class: 'academy-field' }, [el('span', { text: label }), node]);
  };
  if (!info.available || !info.available.length) {
    return section(X.drawSection, [
      el('p', { class: 'academy-note academy-draw-none', text: info.hint || X.drawNoRoute }),
      el('p', { class: 'academy-note', text: X.drawKeysNote }),
    ]);
  }
  const children = [
    select(X.drawRouteField, info.available, info.route,
      (v) => safe(() => host.setSettings({ draw: { route: v } }), null), 'academy-draw-route'),
  ];
  if (info.route === 'tavern') {
    children.push(el('p', { class: 'academy-note', text: X.drawTavernNote }));
  } else if (info.models && info.models.length) {
    children.push(select(X.drawModelField, info.models, info.model,
      (v) => safe(() => host.setSettings({ draw: { models: { ...(draw.models || {}), [info.route]: v } } }), null),
      'academy-draw-model'));
  }
  children.push(select(X.drawStyleField,
    (info.styles || []).map((id) => ({ id, label: (X.drawStyles && X.drawStyles[id]) || id })), info.style,
    (v) => safe(() => host.setSettings({ draw: { style: v } }), null), 'academy-draw-style'));
  if (info.route === 'novel') {
    children.push(select(X.drawSizeField,
      (info.naiSizes || []).map((id) => ({ id, label: (X.drawSizes && X.drawSizes[id]) || id })), info.naiSize,
      (v) => safe(() => host.setSettings({ draw: { naiSize: v } }), null), 'academy-draw-size'));
  }
  children.push(
    el('p', { class: 'academy-note academy-draw-price', text: X.drawPrice }),
    el('p', { class: 'academy-note', text: X.drawKeysNote }),
  );
  return section(X.drawSection, children);
}

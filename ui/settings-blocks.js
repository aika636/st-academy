import { PRESET_MAX_BYTES } from '../core/preset.mjs';
import { personFromLine, personLine } from '../core/card-cast.mjs';
import {
  fill, PRESET_TEXT, extraLabels, uiLabels, mounted, el, clear, runAction, setStatus, section, sectionScope, sectionOpen, formatDate,
  call, safe, renderPanel, renderSettingsBlock,
} from './common.js';
import { DEBUG_TEXT } from './debug.js';
import { LAUNCHER_ICONS, LAUNCHER_ICON_IDS, launcherIconOf } from './icons.js';
import { molvaRefresh } from './cast.js';
import { AUTO, PICKABLE, lookOf, materialById, resolveMaterial } from '../materials/index.mjs';

let uid = 0;
const nextId = (prefix) => `${prefix}_${(uid += 1)}`;

const modelCache = new Map();

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
  } catch {}
}

export function isTouchScreen() {
  try {
    return typeof globalThis.matchMedia === 'function'
      && globalThis.matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch {
    return false;
  }
}

function dropEnhance(select) {
  const $ = globalThis.jQuery;
  try { if (typeof $ === 'function' && $(select).data('select2')) $(select).select2('destroy'); } catch {}
}

export function renderApiBlock(host, view) {
  const a = view.api;
  const status = el('div', { class: 'academy-status' });
  const group = nextId('academy_api_source');
  const own = a.routed === 'endpoint';

  const endpoint = el('input', { type: 'text', class: 'text_pole academy-input', value: a.endpoint, placeholder: 'https://api.example.com' });
  const key = el('input', { type: 'password', class: 'text_pole academy-input', value: a.key, placeholder: 'ключ' });
  const model = el('input', { type: 'text', class: 'text_pole academy-input', value: a.model, placeholder: 'имя модели' });
  const models = el('select', { class: 'text_pole academy-input academy-model-pick', hidden: true });

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
  const cached = modelCache.get(String(a.endpoint || '').trim());
  if (own && cached && cached.length) fillModels(cached);

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
      const via = res && res.via === 'tavern-backend' ? ' Адрес не пускает запросы из браузера, поэтому список спросил сервер таверны — тем же адресом и ключом.' : '';
      if (list.length) setStatus(status, 'ok', `Моделей: ${list.length}. Выберите модель в выпадашке под полем «Модель».${via}`);
    },
  }) : null;

  return section('API для генерации', [
    el('p', {
      class: 'academy-note',
      text: own
        ? 'Ключ хранится только в этом браузере: в настройки таверны и их экспорт он не попадает, на другом устройстве его нужно ввести заново.'
          + ' Надёжнее — «Подключение таверны» с профилем: там ключ держит сама таверна. Если адрес не пускает запросы из браузера, список моделей за вас спросит сервер самой таверны — тем же адресом и ключом.'
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

  const auto = el('input', { type: 'checkbox', checked: view.secretaryAuto !== false });
  auto.addEventListener('change', () => safe(() => host.setSettings({ secretaryAuto: auto.checked }, { quiet: true }), null));
  return section('Секретарь и правило экзаменов', [
    el('p', { class: 'academy-note', text: 'Секретарь — отдельный запрос через API Академии: читает реплику игрока и ответ модели и записывает оценки, прогулы, отношения, поступки и события для слухов. Последний ответ пересчитывается начисто, старый получает поправку датой того ответа. Каждый вывод можно вычеркнуть или разобрать заново кнопкой на плашке под ответом.' }),
    el('label', { class: 'academy-check' }, [auto, el('span', { text: 'Разбирать каждый новый ответ сам' })]),
    el('p', { class: 'academy-note', text: 'Выключено — только по кнопке «Разобрать». Включено — запрос на каждый ответ и каждый новый свайп; слухи выходят уже после разбора.' }),
    el('p', { class: 'academy-note', text: 'Кто решает исход контрольного в этом чате:' }),
    rules,
    status,
  ]);
}

export function renderPaceBlock(host, view) {
  const group = nextId('academy_pace');
  const status = el('div', { class: 'academy-status' });
  const paces = (view.paces || []).length
    ? el('div', { class: 'academy-modes' }, view.paces.map((p) => {
      const radio = el('input', { type: 'radio', name: group, value: p.id, checked: p.active });
      radio.addEventListener('change', async () => {
        const res = await call(host, 'setRelPace', p.id);
        if (res && res.ok === false) setStatus(status, 'error', res.error || 'Не вышло.');
        else renderPanel(host);
      });
      return el('label', { class: p.active ? 'academy-mode academy-mode-on' : 'academy-mode' }, [
        radio,
        el('span', { class: 'academy-mode-label', text: p.label }),
        el('span', { class: 'academy-note', text: p.hint }),
      ]);
    }))
    : el('p', { class: 'academy-note', text: 'Темп выбирается, когда в чате заведён семестр.' });
  return section('Темп отношений', [
    el('p', { class: 'academy-note', text: 'Насколько быстро люди меняют отношение к героине (герою). Ссора может быть резкой, дружба копится.' }),
    paces,
    status,
  ]);
}

export function bullyHeatFacts(b) {
  const facts = [`Накал: ${b.heat} из 4${b.heatWord ? ` — планка новых попыток: ${b.heatWord}` : ''}.`];
  if (b.grow) facts.push(`${b.grow.have} из ${b.grow.need} дней до роста.`);
  if (b.today === 'fought') facts.push('Сегодня отпор засчитан, задира не отступил.');
  else if (b.today === 'backed') facts.push(`Сегодня задира отступил (${b.shrink.have} из ${b.shrink.need}).`);
  else if (b.today === 'weak') facts.push('Сегодня задира отступил, но попытка была слабее накала — не в счёт.');
  else if (b.shrink && b.shrink.have) facts.push(`Задира отступал: ${b.shrink.have} из ${b.shrink.need} дней подряд.`);
  const c = b.change;
  if (c) {
    const when = formatDate(c.day);
    if (c.why === 'press') facts.push(`Накал вырос с ${c.from} до ${c.to} (${when}): два учебных дня давления без отступления задиры.`);
    else if (c.why === 'truce') facts.push(`Накал снизился с ${c.from} до ${c.to} (${when}): перемирие.`);
    else if (c.from === c.to) facts.push(`Давление сдержано (${when}); достигнут минимум этой кампании.`);
    else facts.push(`Накал снизился с ${c.from} до ${c.to} (${when}): два дня подряд задира вынужденно отступал.`);
  }
  if (b.floor > 0) facts.push(`Минимум кампании: накал не ниже ${b.floor}, пока не наступит перемирие.`);
  if (b.assumed) facts.push('Без секретаря: попытки учитываются автоматически; отступления не распознаются.');
  return facts;
}

export function renderBullyingBlock(host, view) {
  const b = view.bullying;
  const status = el('div', { class: 'academy-status' });
  if (!b || !b.available) {
    return section('Травля на курсе', [el('p', { class: 'academy-note', text: 'Травля настраивается, когда в чате заведён семестр.' })]);
  }
  const save = async (patch) => {
    const res = await call(host, 'setBullying', patch);
    if (res && res.ok === false) setStatus(status, 'error', res.error || 'Не вышло.');
    else renderPanel(host);
  };
  const on = el('input', { type: 'checkbox', checked: b.on });
  on.addEventListener('change', () => save({ on: on.checked }));
  const taboo = el('input', {
    type: 'text', class: 'text_pole academy-input', value: b.taboo || '', maxlength: '240', placeholder: 'через запятую; пусто — без ограничений',
  });
  taboo.value = b.taboo || '';
  taboo.addEventListener('change', () => save({ taboo: taboo.value.trim() }));
  const who = b.lead
    ? `Сейчас травит: ${b.lead}${b.crew.length ? `; подпевают: ${b.crew.join(', ')}` : ''}${b.manual ? ' (назначено вручную)' : ''}.`
    : (b.status || 'Пока некому: нужен курс (вкладка «Люди»).');
  const facts = [];
  if (b.lead && b.why) facts.push(`Основание: ${b.why.motive}${b.why.source ? ` (${b.why.source})` : ''}${b.why.access ? `. Встречаются: ${b.why.access}` : ''}.`);
  if (b.lead) {
    facts.push(...bullyHeatFacts(b));
    if (b.hiddenUntil) facts.push(`Форма: скрытая до ${formatDate(b.hiddenUntil)} — после жалобы всё идёт втихую.`);
    else if (b.truceUntil) facts.push(`Форма: тихо до ${formatDate(b.truceUntil)} — после перемирия.`);
    if (b.last) facts.push(`Последний сыгранный акт (${formatDate(b.last.day)}${b.last.levelWord ? `, ${b.last.levelWord}` : ''}): ${b.last.text}.`);
    if (b.pending) facts.push(`Ждёт своего ответа (${formatDate(b.pending.day)}): ${b.pending.text}`);
  }
  const mode = el('select', { class: 'text_pole academy-input' }, [
    el('option', { value: 'auto', text: 'подобрать автоматически', selected: b.mode !== 'self' }),
    el('option', { value: 'self', text: 'выбрать вручную', selected: b.mode === 'self' }),
  ]);
  mode.value = b.mode === 'self' ? 'self' : 'auto';
  mode.addEventListener('change', () => save({ mode: mode.value }));
  const npc = el('input', { type: 'checkbox', checked: b.npcOk });
  npc.addEventListener('change', () => save({ npcOk: npc.checked }));
  const skip = el('input', {
    type: 'text', class: 'text_pole academy-input', value: b.skip || '', maxlength: '240', placeholder: 'имена через запятую; пусто — без исключений',
  });
  skip.value = b.skip || '';
  skip.addEventListener('change', () => save({ skip: skip.value.trim() }));
  const again = el('div', {
    class: 'menu_button academy-btn academy-btn-small',
    text: 'Подобрать заново',
    onclick: async (ev) => {
      const res = await runAction(ev.currentTarget, status, () => call(host, 'rePickBully'), 'Подбор окончен.');
      if (res && res.ok !== false) renderPanel(host);
    },
  });
  return section('Травля на курсе', [
    el('label', { class: 'academy-check' }, [on, el('span', { text: 'Травля героини (героя) на курсе' })]),
    el('p', { class: 'academy-note', text: 'Зачинщик изводит героиню почти каждый учебный день — от насмешек до избиений; накал растёт, пока давление идёт без отступления задиры. Рассказчик получает попытку дня и сам выбирает форму; секретарь отмечает, что было на деле; последствия остаются в ленте, делах и хронике.' }),
    el('p', { class: 'academy-note', text: who }),
    ...facts.map((t) => el('p', { class: 'academy-note', text: t })),
    ...(b.lead && b.help ? [el('details', { class: 'academy-note' }, [el('summary', { text: 'Как устроен накал' }), ...b.help.map((t) => el('p', { text: t }))])] : []),
    el('label', { class: 'academy-field' }, [el('span', { text: 'Запретные темы (для рассказчика и секретаря)' }), taboo]),
    el('label', { class: 'academy-field' }, [el('span', { text: 'Задира' }), mode]),
    b.mode === 'self'
      ? el('p', { class: 'academy-note', text: 'Зачинщика и подпевал вы назначаете сами: в карточке человека, вкладка «Люди».' })
      : el('p', { class: 'academy-note', text: 'Подбирает модель по мотиву и доступу к героине; друзей героини и названных ниже она не берёт. Выбор держится, пока человек на курсе.' }),
    el('label', { class: 'academy-check' }, [npc, el('span', { text: 'Можно создавать своих NPC (если никто из известных не годится)' })]),
    el('label', { class: 'academy-field' }, [el('span', { text: 'Кто точно не травит' }), skip]),
    ...(b.mode === 'self' ? [] : [el('div', { class: 'academy-row academy-row-buttons' }, [again])]),
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
    el('label', { class: 'academy-check' }, [
      viaMacro,
      el('span', {
        text: 'Вставлять строку состояния через макрос {{academy}} — сами поставьте его в системный промпт, заметку автора или карточку; автоинжект строки выключится',
      }),
    ]),
  ]);
}

export function renderPresetBlock(host, view) {
  const U = view.labels;
  const p = view.presets;
  const status = el('div', { class: 'academy-status' });
  const confirmBox = el('div', { class: 'academy-confirm', hidden: true });
  const changeBox = el('div', { class: 'academy-confirm', hidden: true });

  const select = el('select', { class: 'text_pole academy-input' },
    p.list.map((item) => el('option', {
      value: item.id,
      selected: item.active,
      text: item.broken ? `${item.name} (файл не прочитан)` : (item.user ? `${item.name} (${PRESET_TEXT.userMark})` : item.name),
    })));

  const apply = async (button, confirm, viewOnly = false) => {
    const id = select.value;
    if (id === p.active && !p.viewing) { setStatus(status, 'ok', U.presetSameNote); return; }
    const res = await runAction(button, status, () => call(host, 'setPreset', id, { confirm, viewOnly }), viewOnly ? fill(PRESET_TEXT.viewNote, { to: nameOf(id) }) : U.presetChanged);
    if (res && res.needsConfirm) {
      setStatus(status, 'ok', '');
      askConfirm(changeBox, U, {
        reasons: res.reasons || [],
        current: res.current,
        incoming: null,
        question: res.question || null,
        onYes: (btn) => apply(btn, true),
        onView: res.canView ? (btn) => apply(btn, false, true) : null,
        onNo: () => { select.value = p.active; setStatus(status, 'ok', U.importCancelled); },
      });
      return;
    }
    if (res && res.ok !== false) {
      renderPanel(host);
      renderSettingsBlock(host);
    }
  };

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
      askConfirm(changeBox, U, {
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
  const syncDelete = () => { deleteBtn.hidden = !isUser(select.value); deleteBox.hidden = true; };
  select.addEventListener('change', syncDelete);
  syncDelete();

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
    changeBox,
    deleteBox,
    el('p', { class: 'academy-note', text: T.exportNote }),
    importBlock,
    confirmBox,
    status,
  ]);
}

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

function renderPresetImport(host, U, status, confirmBox, scope) {
  const T = PRESET_TEXT;
  const preview = el('div', { class: 'academy-confirm academy-preset-preview', hidden: true });
  const file = el('input', { type: 'file', accept: 'application/json,.json', class: 'academy-file', hidden: true });

  const reset = () => { preview.hidden = true; clear(preview); file.value = ''; };
  const statusAfter = () => ((mounted.presetStatus && mounted.presetStatus[scope]) || status);

  const done = (res, apply) => {
    const name = String(res.name || res.added || '');
    reset();
    renderPanel(host);
    renderSettingsBlock(host);
    const target = statusAfter();
    setStatus(target, 'ok', fill(apply ? T.addedApplied : T.added, { name }));
  };

  const add = async (button, text, apply) => {
    const res = await runAction(button, status, () => call(host, 'importPreset', text, { apply }), '');
    if (!res) return;
    if (res.needsConfirm && res.added) {
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
        onView: res.canView ? async (btn) => {
          const again = await runAction(btn, status, () => call(host, 'setPreset', res.added, { viewOnly: true }), '');
          if (!again || again.ok === false) return;
          renderPanel(host);
          renderSettingsBlock(host);
          setStatus(statusAfter(), 'ok', fill(T.viewNote, { to: res.name || res.added }));
        } : null,
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
    el('div', { class: 'academy-field' }, [
      el('span', { text: T.importPick }),
      el('div', { class: 'menu_button academy-btn academy-btn-small', text: T.importButton, onclick: () => file.click() }),
      file,
    ]),
    el('p', { class: 'academy-note', text: T.importNote }),
    preview,
  ]);
}

export function renderLorebookBlock(host, view) {
  const U = view.labels;
  const L = view.lorebook;
  const status = el('div', { class: 'academy-status' });

  const toggle = el('input', { type: 'checkbox', checked: L.enabled });
  toggle.addEventListener('change', () => {
    safe(() => host.setSettings({ lorebook: { enabled: toggle.checked } }), null);
    renderPanel(host);
  });

  const book = el('input', {
    type: 'text', class: 'text_pole academy-input', value: L.book, placeholder: U.lorebookBookHint,
  });
  book.addEventListener('change', () => {
    safe(() => host.setSettings({ lorebook: { book: book.value.trim() } }), null);
  });

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
    ...(L.enabled ? [
      L.boundLine ? el('p', { class: 'academy-note', text: L.boundLine }) : null,
      L.explain ? el('p', { class: 'academy-warn', text: L.explain }) : null,
      L.state ? el('p', { class: L.state.phase === 'error' ? 'academy-warn' : 'academy-note', text: L.state.line }) : null,
      L.state ? el('details', { class: 'academy-lore-changes' }, [
        el('summary', { text: U.lorebookChanges }),
        L.state.rows.length
          ? el('ul', { class: 'academy-lore-list' }, L.state.rows.map((r) => el('li', { class: 'academy-lore-item', text: `${r.label}: ${r.title}` })))
          : el('p', { class: 'academy-note', text: U.lorebookChangesNone }),
      ]) : null,
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

export function renderTransferBlock(host, view) {
  const U = view.labels;
  const status = el('div', { class: 'academy-status' });
  const confirmBox = el('div', { class: 'academy-confirm', hidden: true });

  const file = el('input', { type: 'file', accept: 'application/json,.json', class: 'academy-file', hidden: true });

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
    el('div', { class: 'academy-field' }, [
      el('span', { text: U.importPick }),
      el('div', { class: 'menu_button academy-btn academy-btn-small', text: U.importButton, onclick: () => file.click() }),
      file,
    ]),
    confirmBox,
    status,
  ]);
}

function summaryLine(summary, U) {
  if (!summary) return U.summaryNothing;
  const tail = summary.started ? '' : ` (${U.summaryNotStarted})`;
  return fill(U.summaryLine, {
    day: summary.day || '—',
    subjects: summary.subjects,
    grades: summary.grades,
  }) + tail;
}

function askConfirm(box, U, { reasons, current, incoming, onYes, onNo, onView = null, question = null }) {
  clear(box);
  box.hidden = false;
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
  const yes = el('div', {
    class: 'menu_button academy-btn academy-btn-main',
    text: question ? PRESET_TEXT.switchYes : U.importConfirmYes,
    tabindex: '0',
    role: 'button',
    onclick: (e) => { box.hidden = true; onYes(e.currentTarget); },
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); box.hidden = true; onYes(e.currentTarget); } },
  });
  box.append(el('div', { class: 'academy-row academy-row-buttons' }, [
    yes,
    onView ? el('div', {
      class: 'menu_button academy-btn academy-btn-main',
      text: PRESET_TEXT.switchView,
      tabindex: '0',
      role: 'button',
      onclick: (e) => { box.hidden = true; onView(e.currentTarget); },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); box.hidden = true; onView(e.currentTarget); } },
    }) : null,
    el('div', {
      class: 'menu_button academy-btn academy-btn-small',
      text: question ? PRESET_TEXT.switchNo : U.importConfirmNo,
      onclick: () => { box.hidden = true; onNo(); },
    }),
  ]));
  try {
    if (typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'nearest' });
    if (typeof yes.focus === 'function') yes.focus({ preventScroll: true });
  } catch {}
}

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
  const feats = el('input', { type: 'checkbox', checked: settings.achievements !== false });
  feats.addEventListener('change', () => safe(() => host.setSettings({ achievements: feats.checked }, { quiet: true }), null));
  return section(X.soundSection, [
    el('label', { class: 'academy-check' }, [feats, el('span', { text: X.achToggle })]),
    el('p', { class: 'academy-note', text: X.achToggleNote }),
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

export function renderFeedBlock(host, preset, settings, extra = null) {
  const X = extraLabels(preset);
  const U = uiLabels(preset);
  const feed = (settings && settings.feed) || {};
  const every = el('input', {
    type: 'number', min: '1', max: '99', step: '1', class: 'text_pole academy-input academy-molva-every',
    value: String(Number.isInteger(feed.molvaEvery) && feed.molvaEvery >= 1 ? feed.molvaEvery : 3),
    disabled: feed.molvaManual === true,
  });
  const manual = el('input', { type: 'checkbox', checked: feed.molvaManual === true });
  every.addEventListener('change', () => {
    const raw = Math.trunc(Number(every.value));
    const n = String(every.value).trim() === '' || !Number.isFinite(raw) ? 3 : Math.max(1, Math.min(99, raw));
    every.value = String(n);
    safe(() => host.setSettings({ feed: { molvaEvery: n } }, { quiet: true }), null);
  });
  manual.addEventListener('change', () => {
    every.disabled = manual.checked;
    safe(() => host.setSettings({ feed: { molvaManual: manual.checked } }, { quiet: true }), null);
  });
  const swear = el('select', { class: 'text_pole academy-input academy-molva-swear' },
    [['off', X.molvaSwearOff], ['mild', X.molvaSwearMild], ['free', X.molvaSwearFree]].map(([v, t]) => el('option', { value: v, text: t })));
  swear.value = ['off', 'free'].includes(feed.swear) ? feed.swear : 'mild';
  swear.addEventListener('change', () => safe(() => host.setSettings({ feed: { swear: swear.value } }, { quiet: true }), null));
  const hooks = el('input', { type: 'checkbox', checked: feed.hooks !== false });
  const auto = el('input', { type: 'checkbox', checked: feed.auto === true, disabled: feed.hooks === false });
  const background = el('input', { type: 'checkbox', checked: feed.background !== false });
  const prep = el('input', { type: 'checkbox', checked: !settings || settings.prep !== false });
  hooks.addEventListener('change', () => safe(() => host.setSettings({ feed: { hooks: hooks.checked } }), null));
  auto.addEventListener('change', () => safe(() => host.setSettings({ feed: { auto: auto.checked } }), null));
  background.addEventListener('change', () => safe(() => host.setSettings({ feed: { background: background.checked } }), null));
  prep.addEventListener('change', () => safe(() => host.setSettings({ prep: prep.checked }, { quiet: true }), null));
  return section(U.tabFeed, [
    el('label', { class: 'academy-check' }, [hooks, el('span', { text: X.feedHooksToggle })]),
    el('p', { class: 'academy-note', text: X.feedHooksNote }),
    el('label', { class: 'academy-check' }, [prep, el('span', { text: X.feedPrepToggle })]),
    el('p', { class: 'academy-note', text: X.feedPrepNote }),
    el('label', { class: 'academy-check' }, [background, el('span', { text: X.feedBackgroundToggle })]),
    el('p', { class: 'academy-note', text: X.feedBackgroundNote }),
    el('label', { class: 'academy-check' }, [auto, el('span', { text: X.feedAutoToggle })]),
    el('p', { class: 'academy-note', text: X.feedAutoNote }),
    el('p', { class: 'academy-note', text: X.feedMuteNote }),
    el('div', { class: 'academy-mob-title academy-mob-heading', text: X.molvaWhen }),
    el('label', { class: 'academy-field academy-field-inline' }, [el('span', { text: X.molvaEvery }), every]),
    el('p', { class: 'academy-note academy-molva-price', text: X.molvaPrice }),
    el('label', { class: 'academy-check' }, [manual, el('span', { text: X.molvaManual })]),
    el('p', { class: 'academy-note', text: X.molvaManualNote }),
    el('label', { class: 'academy-field academy-field-inline' }, [el('span', { text: X.molvaSwear }), swear]),
    molvaRefresh(host, preset),
    ...(Array.isArray(extra) ? extra : []),
  ]);
}

let chimeCtx = null;

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
    renderPanel(host);
    renderSettingsBlock(host);
  });
  return section(T.section, [
    el('label', { class: 'academy-check' }, [box, el('span', { text: T.toggle })]),
    el('p', { class: 'academy-note', text: T.hint }),
  ]);
}

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
  const custom = info.route === 'custom' && info.custom ? info.custom : null;
  const children = [
    select(X.drawRouteField, info.available, info.route,
      (v) => safe(() => host.setSettings({ draw: { route: v } }), null), 'academy-draw-route'),
  ];
  if (custom) {
    children.push(...renderCustomFields(host, X, custom, select));
  } else if (info.route === 'tavern') {
    children.push(el('p', { class: 'academy-note', text: X.drawTavernNote }));
  } else if (info.models && info.models.length) {
    children.push(select(X.drawModelField, info.models, info.model,
      (v) => safe(() => host.setSettings({ draw: { models: { ...(draw.models || {}), [info.route]: v } } }), null),
      'academy-draw-model'));
  }
  children.push(select(X.drawStyleField,
    (info.styles || []).map((id) => ({ id, label: (X.drawStyles && X.drawStyles[id]) || id })), info.style,
    (v) => safe(() => host.setSettings({ draw: { style: v } }), null), 'academy-draw-style'));
  if (info.style === 'own') {
    const own = el('input', {
      type: 'text', class: 'text_pole academy-input academy-draw-style-text',
      value: info.styleText || '', placeholder: X.drawStyleTextHint, maxlength: '1000',
    });
    own.value = info.styleText || '';
    own.addEventListener('change', () => safe(() => host.setSettings({ draw: { styleText: own.value.trim() } }, { quiet: true }), null));
    children.push(
      el('label', { class: 'academy-field' }, [el('span', { text: X.drawStyleTextField }), own]),
      el('p', { class: 'academy-note', text: X.drawStyleTextNote }),
    );
  }
  if (info.route === 'novel' || (custom && custom.mode === 'novelai')) {
    children.push(select(X.drawSizeField,
      (info.naiSizes || []).map((id) => ({ id, label: (X.drawSizes && X.drawSizes[id]) || id })), info.naiSize,
      (v) => safe(() => host.setSettings({ draw: { naiSize: v } }), null), 'academy-draw-size'));
  }
  children.push(
    el('p', { class: 'academy-note academy-draw-price', text: X.drawPrice }),
    el('p', { class: custom ? 'academy-note academy-draw-custom-note' : 'academy-note', text: custom ? X.drawCustomNote : X.drawKeysNote }),
  );
  return section(X.drawSection, children);
}

const drawModelCache = new Map();

function renderCustomFields(host, X, c, select) {
  const status = el('div', { class: 'academy-status' });
  const nai = c.mode === 'novelai';
  const listId = nextId('academy_draw_models');
  const endpoint = el('input', {
    type: 'text', class: 'text_pole academy-input academy-draw-endpoint', value: c.endpoint,
    placeholder: c.defaultEndpoint || 'https://api.example.com/v1',
  });
  const key = el('input', { type: 'password', class: 'text_pole academy-input academy-draw-key', value: c.key, placeholder: 'ключ' });
  const model = el('input', {
    type: 'text', class: 'text_pole academy-input academy-draw-custom-model', value: c.model,
    placeholder: (c.suggestions && c.suggestions[0]) || 'имя модели', list: listId,
  });
  const list = el('datalist', { id: listId });
  const cacheKey = () => `${c.mode}|${endpoint.value.trim()}`;
  const fillList = () => {
    clear(list);
    const ids = [...new Set([...(c.suggestions || []), ...(drawModelCache.get(cacheKey()) || [])])];
    for (const id of ids) list.append(el('option', { value: id, text: (c.suggestionLabels && c.suggestionLabels[id]) || '' }));
  };
  fillList();
  const push = () => safe(() => host.setSettings({
    draw: { custom: { endpoint: endpoint.value.trim(), key: key.value.trim(), model: model.value.trim() } },
  }, { quiet: true }), null);
  for (const input of [endpoint, key, model]) input.addEventListener('change', push);

  const loadBtn = nai ? null : el('div', {
    class: 'menu_button academy-btn academy-btn-small academy-draw-load',
    text: X.drawCustomLoad,
    onclick: async (e) => {
      push();
      const res = await runAction(e.currentTarget, status, () => call(host, 'loadDrawModels'),
        (r) => (r && r.models && r.models.length ? fill(X.drawCustomLoaded, { n: r.models.length }) : X.drawCustomNone));
      const models = ((res && res.models) || []).map(String);
      if (models.length) drawModelCache.set(cacheKey(), models);
      fillList();
    },
  });
  return [
    select(X.drawCustomMode, c.modes || [], c.mode,
      (v) => safe(() => host.setSettings({ draw: { custom: { mode: v } } }), null), 'academy-draw-mode'),
    el('label', { class: 'academy-field' }, [el('span', { text: X.drawCustomEndpoint }), endpoint]),
    c.needsEndpoint ? null : el('p', { class: 'academy-note', text: X.drawCustomEndpointHint }),
    el('label', { class: 'academy-field' }, [el('span', { text: nai ? X.drawCustomNaiKey : X.drawCustomKey }), key]),
    el('label', { class: 'academy-field' }, [el('span', { text: X.drawCustomModel }), model, list]),
    loadBtn ? el('div', { class: 'academy-row academy-row-buttons' }, [loadBtn]) : null,
    status,
  ];
}

export const LOOK_TEXT = {
  section: 'Оформление',
  look: 'Вид',
  lookDiary: 'Ежедневник',
  lookTavern: 'Цвета таверны',
  material: 'Материал ежедневника',
  materialAuto: 'Как у сеттинга',
  materialNow: 'сейчас — {name}',
  sample: 'Аа',
  change: 'Сменить',
  close: 'Закрыть',
  hint: '«Ежедневник» — страницы и обложка под сеттинг; «Цвета таверны» — те же страницы в красках темы SillyTavern.',
  tavernNote: 'Сейчас включены цвета таверны, материал не нужен.',
  icon: 'Значок кнопки',
  iconHint: 'Значок плавающей кнопки, которой открывается Академия.',
};

export function lookSummary(settings, preset) {
  const T = LOOK_TEXT;
  const ui = (settings && settings.ui) || {};
  if (lookOf(ui) === 'tavern') return T.lookTavern;
  const m = materialById(resolveMaterial(ui, preset));
  return `${m ? m.name : T.lookDiary} · ${T.lookDiary.toLowerCase()}`;
}

function matPrev(m) {
  return el('span', {
    class: 'ad-mat-prev',
    style: `--ad-mp-bg:${m.sw[1]};--ad-mp-ink:${m.ink || '#222'};--ad-mp-cover:${m.sw[0]}`,
  }, [el('b', { text: LOOK_TEXT.sample }), el('i'), el('i')]);
}

export function renderLookBlock(host, preset, settings) {
  const T = LOOK_TEXT;
  const ui = (settings && settings.ui) || {};
  const look = lookOf(ui);
  const own = typeof ui.material === 'string' && materialById(ui.material) ? ui.material : AUTO;
  const save = (patch) => safe(() => host.setSettings({ ui: patch }), null);
  const tavern = look === 'tavern';

  const seg = el('div', { class: 'ad-seg', role: 'group', 'aria-label': T.look }, [
    ['diary', T.lookDiary], ['tavern', T.lookTavern],
  ].map(([id, name]) => el('button', {
    type: 'button',
    'aria-pressed': String(look === id),
    dataset: { look: id },
    text: name,
    onclick: () => { if (look !== id) save({ look: id }); },
  })));

  const fromPreset = materialById(resolveMaterial({}, preset)) || PICKABLE[0];
  const items = [
    {
      id: AUTO, name: T.materialAuto, note: fill(T.materialNow, { name: fromPreset.name.toLowerCase() }),
      sw: fromPreset.sw, ink: fromPreset.ink,
    },
    ...PICKABLE,
  ];
  const cur = items.find((m) => m.id === own) || items[0];
  const row = (m) => [
    matPrev(m),
    el('div', {}, [el('div', { class: 'ad-pk-name', text: m.name }), el('div', { class: 'ad-pk-note', text: m.note })]),
  ];

  const key = `${sectionScope}::set:matopen`;
  const opened = sectionOpen.get(key) === true && !tavern;
  const list = el('div', { class: 'ad-pick-list', hidden: !opened },
    items.map((m) => el('button', {
      type: 'button',
      class: 'ad-pick',
      'aria-pressed': String(m.id === cur.id),
      dataset: { mat: m.id },
      disabled: tavern,
      onclick: () => save({ material: m.id }),
    }, row(m))));
  const toggle = el('button', {
    type: 'button',
    class: 'ad-btn ad-quiet ad-tiny',
    text: opened ? T.close : T.change,
    disabled: tavern,
    onclick: () => {
      const open = list.hidden;
      list.hidden = !open;
      toggle.textContent = open ? T.close : T.change;
      sectionOpen.set(key, open);
    },
  });

  const iconNow = launcherIconOf(ui);
  const icons = el('div', { class: 'ad-icon-pick', role: 'group', 'aria-label': T.icon },
    LAUNCHER_ICON_IDS.map((id) => el('button', {
      type: 'button',
      class: 'ad-pick ad-icon-opt',
      'aria-pressed': String(id === iconNow),
      dataset: { icon: id },
      onclick: () => { if (id !== iconNow) save({ launcherIcon: id }); },
    }, [
      el('span', { class: 'ad-icon-sample', html: LAUNCHER_ICONS[id].svg }),
      el('span', { class: 'ad-pk-name', text: LAUNCHER_ICONS[id].name }),
      el('span', { class: 'ad-pk-note', text: LAUNCHER_ICONS[id].note }),
    ])));

  return [
    el('div', { class: 'ad-set-sub' }, [el('h4', { text: T.look }), seg]),
    el('div', { class: 'ad-set-sub' }, [
      el('h4', { text: T.material }),
      el('div', { class: 'ad-pick' }, [...row(cur), toggle]),
      list,
      el('p', { text: tavern ? T.tavernNote : T.hint }),
    ]),
    el('div', { class: 'ad-set-sub' }, [el('h4', { text: T.icon }), icons, el('p', { text: T.iconHint })]),
  ];
}

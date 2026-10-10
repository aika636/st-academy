// ui/people.js — вкладка «Люди» в две части: «Преподаватели» (отношение числом
// и словом, память «за что», портрет и правка подробностей) и курс героини —
// однокурсники (`ui/classmates.js`). Подписи частей — из словаря пресета: у
// школы «Класс», у вуза «Курс», у кадетов «Взвод».

import { isPortrait, TEACHER_TEXT_MAX, teacherDetails } from '../core/state.mjs';
import { MEMORY_SIZE, relationLabel, relationMemory, relationOf } from '../core/relations.mjs';
import { reputationLabel } from '../core/reputation.mjs';
import {
  uiLabels, fill, stateHealth, formatDate, capNumbers, str, extraLabels, mounted, el, runAction,
  setStatus, field, renderEmpty, call, renderPanel,
} from './common.js';
import { classmatesView, renderClassmates, scoreText } from './classmates.js';
import { personAvatar } from '../core/masks.mjs';
import { avatarNode } from './common.js';
import { photoEditor, drawPending } from './photo.js';

/** Части вкладки. Какая открыта — `mounted.peoplePart`, по умолчанию преподаватели. */
export const PEOPLE_PARTS = ['teachers', 'classmates'];

/**
 * Сколько сдвигов отношения «помнит» карточка преподавателя (3.9: телефон).
 * То же число, что у лорбука (`relations.MEMORY_SIZE`): панель и модель
 * помнят одно и то же.
 */
export const PEOPLE_HISTORY = MEMORY_SIZE;

/**
 * Число отношения для панели строкой со знаком: «+2», «−3», «0». Владелица
 * попросила число открыть (06.10): слово одно на целый отрезок шкалы, и сдвиг
 * внутри него не видно. В промпт и лорбук по-прежнему уходит только слово.
 */
export function relationScore(state, teacherId) {
  return scoreText(relationOf(state, teacherId));
}

/**
 * Вкладка «Люди» (3.9, 3.4). Преподаватели, их предмет, черты и отношение к
 * студентке; ниже — репутация заведения и предметы, у которых преподавателя нет.
 *
 * Отношение — ярлык и число (`relationScore`); прежнее правило «только словом»
 * владелица сняла 06.10.
 *
 * Память «за что» (`memory`) — последние сдвиги отношения со знаком и поводом
 * словами: «+1 — спасла опыт», «−1 — прогул: химия». Источник —
 * `relations.relationMemory`, тот же, что у лорбука. Прежняя история ярлыков
 * («ровно → недоволен») в неё слита: сдвиг, перешедший границу ярлыка, несёт
 * переход полем `shift`, и второго списка в карточке нет — на телефоне два
 * списка про одно и то же были бы простынёй. Сдвиги внутри одного ярлыка
 * теперь тоже видны: «недоволен» за прогул и «недоволен» за сорванный опыт —
 * разные зацепки для сцены.
 *
 * Счёт сводных чисел (3.3): на вкладке ровно одно — сколько преподавателей.
 * Знак сдвига и даты в счёт не идут по тому же основанию, что оценки в
 * зачётке: это сама запись, а не метрика.
 */
export function peopleView(state, preset) {
  const health = stateHealth(state, preset);
  if (health.kind !== 'ok') {
    return { ...health, teachers: [], orphans: [], reputation: '', numbers: [], droppedNumbers: [], course: null };
  }

  const U = uiLabels(preset);
  const X = extraLabels(preset);
  const subjects = state.subjects || [];
  const list = state.teachers || [];

  const teachers = list.map((t) => {
    const traits = (t.traits || []).map(str).filter(Boolean);
    const own = subjects.filter((s) => s.teacherId === t.id).map((s) => s.name || s.id);
    // Хвост журнала, свежим вперёд: на телефоне видна последняя перемена, а не
    // первая, и список не растёт вместе с семестром. Журнал кольцевой и
    // короткий, а преподавателей — единицы: проход по нему на каждого дешевле,
    // чем общий словарь ради него.
    const memory = relationMemory(state, t.id, preset, PEOPLE_HISTORY).map((m) => {
      const sign = m.delta > 0 ? `+${m.delta}` : `−${-m.delta}`;
      const shift = m.crossed ? fill(U.relationShift, m.crossed) : '';
      return {
        day: m.day,
        dateLine: formatDate(m.day),
        delta: m.delta,
        sign,
        reason: m.reason,
        // Без повода — просто знак: «без повода» никто не пишет, тире не висит.
        text: m.reason ? fill(X.memoryLine, { sign, reason: m.reason }) : sign,
        shift,
      };
    });
    const quiet = !memory.length && !relationOf(state, t.id);
    const details = teacherDetails(t);
    return {
      id: t.id,
      name: t.name || t.id,
      traits,
      traitsText: traits.length ? traits.join(', ') : U.traitsNone,
      hasTraits: traits.length > 0,
      subjects: own,
      subjectsText: own.length ? own.join(', ') : U.subjectsNone,
      // Без записанной истории слова отношения нет (макет «Люди»): «ровно · 0»
      // у человека, с которым ещё ничего не было, — шум.
      relation: quiet ? '' : relationLabel(state, t.id, preset),
      score: quiet ? '' : relationScore(state, t.id),
      memory,
      memoryText: memory.length ? '' : U.relationNoHistory,
      // Душа преподавателя: пустые — пустые строки, панель их просто не рисует.
      post: details.post || '',
      likes: details.likes || '',
      likesText: details.likes ? fill(X.likesLine, { likes: details.likes }) : '',
      secret: details.secret || '',
      // Портрет (9.7A п.15): адрес, который дал человек, и только годный —
      // в `<img src>` не уходит ничего, что не прошло `isPortrait`.
      portrait: isPortrait(t.portrait) ? t.portrait : '',
      // Своё описание внешности — для «Нарисовать».
      looks: typeof t.looks === 'string' ? t.looks : '',
      // Кружок: фото, а без него — инициалы на цвете от id (`core/masks`).
      avatar: personAvatar(t),
    };
  });

  // Предмет без преподавателя и предмет со ссылкой на выбывшего — одна и та же
  // дыра для этой вкладки: отношения по нему считать не с кем.
  const orphans = subjects
    .filter((s) => !s.teacherId || !list.some((t) => t.id === s.teacherId))
    .map((s) => s.name || s.id);

  const capped = capNumbers([
    { key: 'teachers', text: fill(U.peopleCountLine, { count: teachers.length }) },
  ], preset);

  return {
    kind: 'ok',
    title: '',
    text: '',
    action: null,
    errors: [],
    teachers,
    orphans,
    // Две части вкладки: подписи из словаря пресета, курс — своим видом.
    teachersTitle: U.teachersTitle,
    course: classmatesView(state, preset),
    // Репутация здесь уместна: отношения личные, репутация — то же самое, но со
    // стороны заведения (3.4). Слово, как и отношение; число остаётся внутри.
    reputation: reputationLabel(state, preset),
    expelled: Boolean(state.reputation && state.reputation.expelled),
    warned: Boolean(state.reputation && state.reputation.warned),
    numbers: capped.shown,
    droppedNumbers: capped.dropped,
  };
}

// --- вкладка «Люди» ---------------------------------------------------------

export function renderPeople(host, view, preset) {
  if (view.kind !== 'ok') return renderEmpty(host, view);

  const U = uiLabels(preset);
  const X = extraLabels(preset);
  const box = el('div', { class: 'academy-people' });

  // Шапка та же по форме, что у «Зачётки»: репутация словом плюс тревожная
  // метка. Одинаковая шапка на двух вкладках — не экономия, а узнаваемость.
  box.append(el('div', { class: 'academy-head' }, [
    el('div', { class: 'academy-date', text: U.reputationTitle }),
    el('div', { class: 'academy-week' }, [
      el('span', { class: 'academy-phase', text: view.reputation }),
      view.expelled ? el('span', { class: 'academy-alarm', text: U.expelledTag })
        : view.warned ? el('span', { class: 'academy-alarm', text: U.warnedTag }) : null,
    ]),
  ]));

  // Переключатель частей: две кнопки, а не две простыни подряд — на телефоне
  // курс под восемью карточками наставников не нашёл бы никто.
  const part = PEOPLE_PARTS.includes(mounted.peoplePart) ? mounted.peoplePart : 'teachers';
  const course = view.course || { title: U.classmatesTitle, count: 0 };
  box.append(el('div', { class: 'academy-people-parts', role: 'tablist' }, [
    ['teachers', view.teachersTitle || U.teachersTitle, view.teachers.length],
    ['classmates', course.title, course.count],
  ].map(([id, title, count]) => el('div', {
    class: `menu_button academy-btn academy-btn-small academy-people-part${part === id ? ' academy-people-part-on' : ''}`,
    role: 'tab',
    'aria-selected': part === id ? 'true' : 'false',
    text: count ? `${title} · ${count}` : title,
    onclick: () => { mounted.peoplePart = id; renderPanel(host); },
  }))));

  if (part === 'classmates') {
    if (view.course) box.append(renderClassmates(host, view.course, preset));
    return box;
  }

  if (!view.teachers.length) {
    box.append(el('div', { class: 'academy-silent', text: U.peopleNone }));
  }

  // Одно и то же дерево: на широком экране — строка таблицы, на узком —
  // карточка. Классы взяты те же, что у зачётки, второй вёрстки нет (3.9).
  if (view.teachers.length) {
    box.append(el('div', { class: 'academy-table academy-table-people' },
      view.teachers.map((t) => el('div', { class: 'academy-tr academy-tr-person' }, [
        el('div', { class: 'academy-td academy-td-name' }, [
          t.portrait ? portraitThumb(t, X) : avatarNode(t.avatar, { size: 'card' }),
          el('span', { class: 'academy-subject', text: t.name }),
          // Ярлык, не число: `peopleView` числа отношения не знает вовсе.
          t.relation ? el('span', { class: 'academy-relation', text: t.score ? `${t.relation} · ${t.score}` : t.relation }) : null,
          // Должность — под именем, мелко: это роль в заведении, а не второй заголовок.
          t.post ? el('span', { class: 'academy-post', text: t.post }) : null,
          detailsEditor(host, t, X),
        ]),
        el('div', { class: 'academy-td academy-td-person' }, [
          el('span', { class: 'academy-teacher', text: t.subjectsText }),
          el('span', {
            class: t.hasTraits ? 'academy-traits' : 'academy-traits academy-traits-none',
            text: t.traitsText,
          }),
          t.likesText ? el('span', { class: 'academy-traits academy-likes', text: t.likesText }) : null,
          // Тайна свёрнута: героиня её не знает, и человеку, который не хочет
          // спойлера своей же истории, она не должна лезть в глаза.
          t.secret ? el('details', { class: 'academy-secret' }, [
            el('summary', { text: X.secretTitle }),
            el('span', { text: t.secret }),
          ]) : null,
        ]),
        el('div', { class: 'academy-td academy-td-history' }, [
          el('span', { class: 'academy-card-title', text: U.relationHistoryTitle }),
          t.memory.length
            ? el('ul', { class: 'academy-shifts' }, t.memory.map((m) => el('li', {}, [
              el('span', { class: 'academy-shift', text: m.text }),
              // Переход ярлыка и дата — одной приглушённой строкой: на 360
              // пикселях три строки на сдвиг превращали память в простыню.
              (m.shift || m.dateLine)
                ? el('span', { class: 'academy-shift-day', text: [m.shift, m.dateLine].filter(Boolean).join(' · ') })
                : null,
            ])))
            : el('span', { class: 'academy-teacher', text: t.memoryText }),
        ]),
      ]))));
  }

  if (view.orphans.length) {
    box.append(el('div', { class: 'academy-debts' }, [
      el('span', { class: 'academy-card-title', text: U.orphanSubjectsTitle }),
      el('span', { text: view.orphans.join(', ') }),
    ]));
  }

  return box;
}

/**
 * Маленький портрет в карточке наставника (9.7A п.15). Нажатие открывает его
 * плавающим окном поверх панели (`openPortrait`), а не новой вкладкой браузера:
 * на телефоне вкладка — это уход из таверны.
 *
 * Не открылась картинка (опечатка в пути, ссылка умерла) — рамка не остаётся
 * пустой загадкой: миниатюра прячется, рядом встаёт строка «проверьте путь».
 * `loading="lazy"` — у восьми наставников восемь картинок, и тянуть их, пока
 * вкладку «Люди» не открыли, незачем.
 */
function portraitThumb(t, X) {
  const img = el('img', {
    class: 'academy-portrait-thumb',
    src: t.portrait,
    alt: `${X.portraitTitle}: ${t.name}`,
    loading: 'lazy',
    title: X.portraitOpen,
    onclick: () => openPortrait(t, X),
  });
  const broken = el('span', { class: 'academy-note academy-portrait-broken', text: X.portraitBroken });
  broken.hidden = true;
  img.addEventListener('error', () => { img.hidden = true; broken.hidden = false; });
  return el('span', { class: 'academy-portrait' }, [img, broken]);
}

/**
 * Плавающее окно с портретом. Одно на страницу: второе нажатие заменяет
 * картинку, а не плодит окна. Закрывается кнопкой, тапом по фону и Esc.
 */
function openPortrait(t, X) {
  if (mounted.portrait) mounted.portrait.remove();
  const close = () => {
    if (mounted.portrait) mounted.portrait.remove();
    mounted.portrait = null;
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e && e.key === 'Escape') close(); };
  const box = el('div', {
    class: 'academy-portrait-overlay',
    role: 'dialog',
    'aria-label': `${X.portraitTitle}: ${t.name}`,
    onclick: (e) => { if (e && e.target === e.currentTarget) close(); },
  }, [
    el('figure', { class: 'academy-portrait-frame' }, [
      el('img', { class: 'academy-portrait-full', src: t.portrait, alt: t.name }),
      el('figcaption', { text: t.name }),
      el('div', { class: 'menu_button academy-btn academy-btn-small', text: X.portraitClose, onclick: close }),
    ]),
  ]);
  document.addEventListener('keydown', onKey);
  (document.getElementById('movingDivs') || document.body).append(box);
  mounted.portrait = box;
  return box;
}

/**
 * Детали наставника прямо в карточке — свёрнутым блоком: вкладка «Люди» —
 * про людей, и поля правятся там же, где видны. Должность, «любит», тайна,
 * черты и ссылка на портрет — одной кнопкой; своё фото — блоком «Фото»
 * (`ui/photo.js`), он сохраняет сразу, без этой кнопки. Сохранение — отдельным действием
 * `setTeacherDetails`, а не через таблицу плана: детали не меняют расписания и
 * не должны его пересобирать. Пустое поле убирает значение.
 *
 * Проверка портрета — та же, что держит состояние (`isPortrait`): отказ
 * приходит ещё до похода в хост. Длины режет `maxlength` поля, а за ним —
 * та же нормализация в хосте (`state.teacherDetails`).
 */
function detailsEditor(host, t, X) {
  const status = el('div', { class: 'academy-status' });
  const field = (label, value, hint, max, tag = 'input') => {
    const input = el(tag, {
      ...(tag === 'input' ? { type: 'text' } : { rows: '2' }),
      class: 'text_pole academy-input', value: value || '', placeholder: hint || '',
      ...(max ? { maxlength: String(max) } : {}),
    });
    input.value = value || '';
    return { input, node: el('label', { class: 'academy-field' }, [el('span', { text: label }), input]) };
  };
  const post = field(X.postField, t.post, X.postHint, TEACHER_TEXT_MAX.post);
  const likes = field(X.likesField, t.likes, X.likesHint, TEACHER_TEXT_MAX.likes);
  const secret = field(X.secretField, t.secret, X.secretHint, TEACHER_TEXT_MAX.secret, 'textarea');
  const traits = field(X.traitsField, (t.traits || []).join(', '), '', 0);
  const portrait = field(X.portraitField, t.portrait, X.portraitHint, 0);
  const save = el('div', {
    class: 'menu_button academy-btn academy-btn-small',
    text: X.detailsSave,
    onclick: async (e) => {
      const value = String(portrait.input.value || '').trim();
      if (value && !isPortrait(value)) { setStatus(status, 'error', X.portraitBad); return; }
      const patch = {
        post: String(post.input.value || ''),
        likes: String(likes.input.value || ''),
        secret: String(secret.input.value || ''),
        traits: String(traits.input.value || ''),
        portrait: value,
      };
      const res = await runAction(e.currentTarget, status,
        () => call(host, 'setTeacherDetails', t.id, patch),
        X.detailsSaved);
      if (res && res.ok !== false) renderPanel(host);
    },
  });
  // Рисование идёт или ждёт «Оставить» — блок раскрыт и после перерисовки.
  return el('details', { class: 'academy-repair academy-portrait-edit', open: drawPending(t.id) }, [
    el('summary', { text: X.detailsTitle }),
    el('div', { class: 'academy-repair-body' }, [
      post.node, likes.node, secret.node, traits.node,
      photoEditor(host, t, X, portrait.node),
      el('div', { class: 'academy-row academy-row-buttons' }, [save]),
      status,
    ]),
  ]);
}

// Аватарки и значки ответов (решения 08.10): значок маски по словам ника,
// инициалы человека на цвете от id, своё фото человека (имя файла, проверки,
// уменьшение, единый путь сохранения), фото однокурсника в состоянии, значки
// у ответов в ветке — счёт, свой значок, перенос и откат.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  maskIcon, initialsOf, personColor, authorAvatar, personAvatar, ANON_ICON, MASK_FALLBACK, MASK_STEMS,
} from '../core/masks.mjs';
import {
  portraitFileName, checkImageFile, fitSize, splitDataUrl, checkSavedImage, isPortrait,
  PORTRAIT_FOLDER, PORTRAIT_SIDE, PORTRAIT_INPUT_MAX, PORTRAIT_SAVED_MAX,
} from '../core/portraits.mjs';
import { isPortrait as statePortrait, createState, cloneState, validateState } from '../core/state.mjs';
import { normalizeClassmate, updateClassmate, classmateErrors } from '../core/classmates.mjs';
import {
  addFeedItem, reactCounts, reactSet, toggleReact, carryFeedMarks, normalizeFeed, REACT_SETS, REPLY_REACTS,
} from '../core/feed.mjs';
import { buildSchedule } from '../core/schedule.mjs';
import { feedView, classmatesView, peopleView } from '../ui.js';
import { savePortraitImage } from '../portraits.js';

const preset = JSON.parse(readFileSync(fileURLToPath(new URL('../presets/ru-university.json', import.meta.url)), 'utf8'));
const SUBJECTS = [{ id: 'chemistry', name: 'аналитическая химия', teacherId: 'petrova' }];
const TEACHERS = [{ id: 'petrova', name: 'Петрова Анна Сергеевна', portrait: '/user/images/academy/petrova_1.jpg' }];
const COURSE = [
  { id: 'sokolova', name: 'Вера Соколова', relation: 0 },
  { id: 'orlova', name: 'Мила Орлова', relation: 0 },
];

function semester() {
  const s = createState(preset, {
    startDay: '2026-09-01', subjects: SUBJECTS, teachers: TEACHERS, schedule: buildSchedule(SUBJECTS, preset),
    classmates: COURSE,
  });
  s.started = true;
  s.calendar.day = '2026-10-08';
  return s;
}

/** Пост и две реплики в ветке — без разбора, прямо в ленту. */
function withThread(s = semester()) {
  addFeedItem(s, { id: 'p1', src: 'm1', kind: 'reaction', nick: 'школьный бес', chan: 'chat', loud: 2, text: 'Опять Соколова орёт' });
  addFeedItem(s, { id: 'p1^1', src: 'm1', kind: 'reaction', parent: 'p1', who: 'sokolova', chan: 'chat', loud: 2, text: 'Это я-то ору?' });
  addFeedItem(s, { id: 'p1^2', src: 'm1', kind: 'reaction', parent: 'p1', nick: 'альфа футбольной команды', chan: 'chat', loud: 2, text: 'Поддерживаю' });
  return s;
}

// --- значок маски ------------------------------------------------------------------

test('маска: значок по основе слова ника, без модели', () => {
  assert.equal(maskIcon('школьный бес'), '😈');
  assert.equal(maskIcon('чёрт с задней парты'), '😈');
  assert.equal(maskIcon('альфа футбольной команды'), '⚽');
  assert.equal(maskIcon('я-люблю-никки-из-11-класса'), '💘');
  assert.equal(maskIcon('влюблённая в физрука'), '💘');
  assert.equal(maskIcon('кот учёный'), '🐱');
  assert.equal(maskIcon('кошкина мама'), '🐱');
  assert.equal(maskIcon('королева сплетен'), '👑', 'первое слово ника решает');
  assert.equal(maskIcon('сплетница с третьего'), '🤫');
  assert.equal(maskIcon('кофейный маньяк'), '☕');
  assert.equal(maskIcon('главный ботан'), '🤓');
  assert.equal(maskIcon('качок_из_спортзала'), '💪');
  assert.equal(maskIcon('тролль потока'), '🧌');
  assert.equal(maskIcon('призрак общаги'), '👻');
  assert.equal(maskIcon('звёздочка'), '⭐');
  assert.equal(maskIcon('❤ Миша'), '💘', 'сердце в нике — само себе значок');
});

test('маска: короткие основы не ловят чужие слова', () => {
  const stray = (nick, icon) => assert.notEqual(maskIcon(nick), icon, `«${nick}» поймал чужой значок ${icon}`);
  stray('бесстрашный', '😈');
  stray('бескорыстная', '😈');
  stray('пришёл поздно', '👽');
  stray('пришла первой', '👽');
  stray('чайка у окна', '🍵');
  stray('Розалия', '🌸');
  stray('мемуары', '😂');
  assert.equal(maskIcon('бес'), '😈');
  assert.equal(maskIcon('бесенок'), '😈');
  assert.equal(maskIcon('пришелец'), '👽');
  assert.equal(maskIcon('чай'), '🍵');
  assert.equal(maskIcon('чайная душа'), '🍵');
});

test('маска: сеттинги — магия, космос, сянься', () => {
  assert.equal(maskIcon('тёмный маг'), '✨');
  assert.equal(maskIcon('магия-это-я'), '✨');
  assert.equal(maskIcon('ведьмочка'), '🧙');
  assert.equal(maskIcon('космический кадет'), '🚀');
  assert.equal(maskIcon('пилот без лицензии'), '🚀');
  assert.equal(maskIcon('инопланетянин'), '👽');
  assert.equal(maskIcon('культиватор с пика'), '☯️');
  assert.equal(maskIcon('дракон секты'), '🐉');
  assert.equal(maskIcon('мастер пилюль'), '⚗️', 'первое подошедшее слово');
  assert.ok(MASK_STEMS.length >= 25 && MASK_STEMS.length <= 40, `основ ${MASK_STEMS.length}`);
});

test('маска: регистр и «ё» не мешают, целое слово не цепляет чужое', () => {
  assert.equal(maskIcon('ШКОЛЬНЫЙ БЕС'), '😈');
  assert.equal(maskIcon('Тёмная Тень'), '👻');
  assert.equal(maskIcon('темная тень'), '👻');
  assert.equal(maskIcon('ЗВЁЗДЫ'), '⭐');
  // «кот» — только целым словом: «который» — не кот.
  assert.notEqual(maskIcon('который тут'), '🐱');
});

test('маска: слова не нашлось — запасной значок по нику, всегда тот же', () => {
  const a = maskIcon('никто-никогда');
  assert.ok(MASK_FALLBACK.includes(a), a);
  assert.equal(maskIcon('никто-никогда'), a, 'детерминированно');
  assert.equal(maskIcon('НИКТО НИКОГДА'), a, 'регистр и знаки — тот же ник');
  const many = new Set(['абв', 'где', 'ёжз', 'иклм', 'нопр', 'стуф', 'хцчш', 'щыэю'].map(maskIcon));
  assert.ok(many.size >= 3, 'разные ники — не один значок на всех');
  assert.equal(maskIcon(''), ANON_ICON);
});

// --- кружок человека ------------------------------------------------------------------

test('человек: инициалы и цвет от id; с фото — фото, data: — никогда', () => {
  assert.equal(initialsOf('Петрова Анна Сергеевна'), 'ПА');
  assert.equal(initialsOf('вера'), 'В');
  assert.equal(initialsOf(''), '');
  assert.equal(personColor('sokolova'), personColor('sokolova'));
  assert.match(personColor('sokolova'), /^hsl\(\d+, 45%, 40%\)$/);
  assert.notEqual(personColor('sokolova'), personColor('orlova'));

  const s = semester();
  const teacher = authorAvatar(s, { who: 'petrova' });
  assert.deepEqual([teacher.kind, teacher.initials, teacher.portrait], ['person', 'ПА', '/user/images/academy/petrova_1.jpg']);
  const vera = authorAvatar(s, { who: 'sokolova' });
  assert.deepEqual([vera.kind, vera.initials, vera.portrait], ['person', 'ВС', '']);
  assert.equal(personAvatar({ id: 'x', name: 'Икс', portrait: 'data:image/png;base64,AAAA' }).portrait, '');
  assert.deepEqual(authorAvatar(s, { nick: 'школьный бес', who: 'sokolova' }), { kind: 'mask', icon: '😈' }, 'маска сильнее id');
  assert.deepEqual(authorAvatar(s, { chan: 'anon', who: '' }), { kind: 'anon', icon: '👤' }, 'без подписи — силуэт');
  assert.equal(authorAvatar(s, { who: 'someone' }).icon, '👤');
  assert.equal(authorAvatar(s, { who: '@heroine' }, { heroine: 'Аня Ким' }).initials, 'АК');
});

// --- своё фото: чистые части ----------------------------------------------------------

test('фото: имя файла — id латиницей и время, без точек', () => {
  assert.equal(portraitFileName('petrova', 1759912345678), 'petrova_1759912345678');
  assert.equal(portraitFileName('Вера Соколова', 5), 'vera-sokolova_5');
  assert.equal(portraitFileName('a.b/../c', 7), 'abc_7', 'ни точек, ни косых');
  assert.equal(portraitFileName('', 1), 'person_1');
  assert.ok(portraitFileName('x'.repeat(200), 1).length <= 45);
  assert.equal(PORTRAIT_FOLDER, 'academy');
});

test('фото: проверка файла, размера и уменьшения', () => {
  assert.equal(checkImageFile({ type: 'image/jpeg', size: 3e6 }).ok, true);
  assert.equal(checkImageFile({ type: '', size: 3e6 }).ok, true, 'HEIC без типа — решает декодер');
  assert.equal(checkImageFile({ type: 'video/mp4', size: 3e6 }).code, 'not-image');
  assert.equal(checkImageFile({ type: 'image/png', size: 0 }).code, 'empty');
  assert.equal(checkImageFile({ type: 'image/png', size: PORTRAIT_INPUT_MAX + 1 }).code, 'too-big');
  assert.equal(checkImageFile(null).code, 'no-file');

  assert.deepEqual(fitSize(4000, 3000), { width: PORTRAIT_SIDE, height: 384 });
  assert.deepEqual(fitSize(1000, 2000), { width: 256, height: 512 });
  assert.deepEqual(fitSize(200, 100), { width: 200, height: 100 }, 'маленькое не растягивается');

  assert.deepEqual(splitDataUrl('data:image/jpeg;base64,QUJD'), { mime: 'image/jpeg', ext: 'jpg', base64: 'QUJD' });
  assert.equal(splitDataUrl('data:text/html;base64,QUJD'), null);
  assert.equal(splitDataUrl('https://x/y.png'), null);
  assert.equal(checkSavedImage(`data:image/png;base64,${'A'.repeat(PORTRAIT_SAVED_MAX + 4)}`).code, 'too-big');
});

test('фото: путь, который вернула таверна, годится в портрет; data: — нет', () => {
  for (const p of ['/user/images/academy/petrova_1759912345678.jpg', 'user/images/academy/x_1.jpg']) {
    assert.equal(isPortrait(p), true, p);
    assert.equal(statePortrait(p), true, 'state.isPortrait — та же функция');
  }
  assert.equal(isPortrait('data:image/jpeg;base64,QUJD'), false);
});

// --- своё фото: единый путь сохранения ---------------------------------------------------

/** Холст и декодер браузера — ровно то, чем пользуется `portraits.js`. */
function fakeBrowser() {
  const drawn = {};
  globalThis.createImageBitmap = async () => ({ width: 3000, height: 1500, close() {} });
  globalThis.document = {
    createElement: () => {
      const canvas = {
        getContext: () => ({ fillRect() {}, drawImage() {}, set fillStyle(v) { drawn.fill = v; } }),
        toDataURL: (type, q) => { drawn.size = [canvas.width, canvas.height]; drawn.type = [type, q]; return 'data:image/jpeg;base64,QUJDRA=='; },
      };
      return canvas;
    },
  };
  return drawn;
}

test('фото: файл уменьшается до 512, JPEG 0.85, сохраняется в academy с именем по id', async () => {
  const drawn = fakeBrowser();
  const calls = [];
  const save = async (...args) => { calls.push(args); return '/user/images/academy/sokolova_42.jpg'; };
  const file = new Blob([new Uint8Array(10)], { type: 'image/jpeg' });
  const res = await savePortraitImage(file, { personId: 'sokolova', now: 42, save });
  assert.deepEqual(res, { ok: true, path: '/user/images/academy/sokolova_42.jpg' });
  assert.deepEqual(calls, [['QUJDRA==', 'academy', 'sokolova_42', 'jpg']]);
  assert.deepEqual(drawn.size, [512, 256]);
  assert.deepEqual(drawn.type, ['image/jpeg', 0.85]);
  assert.equal(drawn.fill, '#ffffff', 'прозрачное — на белом');
  delete globalThis.createImageBitmap;
});

test('фото: отказы словами — не картинка, нет функции таверны, таверна ответила ошибкой', async () => {
  fakeBrowser();
  const text = new Blob(['x'], { type: 'text/plain' });
  const notImage = await savePortraitImage(text, { personId: 'sokolova', save: async () => 'x' });
  assert.deepEqual([notImage.ok, notImage.code], [false, 'not-image']);
  const img = new Blob([new Uint8Array(10)], { type: 'image/png' });
  // Без своей замены — импорт таверны; в Node его нет, как в старой таверне.
  const old = await savePortraitImage(img, { personId: 'sokolova' });
  assert.equal(old.code, 'no-save');
  assert.match(old.error, /не удалось сохранить картинку в таверну/i);
  const fail = await savePortraitImage(img, { personId: 'sokolova', save: async () => { throw new Error('нет места'); } });
  assert.match(fail.error, /Не удалось сохранить картинку в таверну: нет места/);
  const odd = await savePortraitImage(img, { personId: 'sokolova', save: async () => 'javascript:1' });
  assert.equal(odd.code, 'bad-path');
  assert.equal((await savePortraitImage(img, {})).code, 'no-person');
  delete globalThis.createImageBitmap;
});

// --- фото однокурсника в состоянии -------------------------------------------------------

test('однокурсник: фото держится, негодное отвергнуто, пустое убирает', () => {
  assert.equal(normalizeClassmate({ name: 'Вера', portrait: '/user/images/academy/v_1.jpg' }).portrait, '/user/images/academy/v_1.jpg');
  assert.equal('portrait' in normalizeClassmate({ name: 'Вера', portrait: 'data:image/png;base64,AA' }), false);
  const s = semester();
  const bad = updateClassmate(s, 'sokolova', { portrait: 'javascript:alert(1)', club: 'театр' }, preset);
  assert.deepEqual([bad.ok, bad.code], [false, 'bad-portrait']);
  assert.equal(s.classmates.find((c) => c.id === 'sokolova').club, undefined, 'отказ ничего не правит');
  assert.equal(updateClassmate(s, 'sokolova', { portrait: 'https://example.com/v.png' }, preset).ok, true);
  assert.equal(s.classmates.find((c) => c.id === 'sokolova').portrait, 'https://example.com/v.png');
  assert.deepEqual(validateState(s, preset).errors, []);
  s.classmates[0].portrait = 'file:///C:/x.png';
  assert.ok(classmateErrors(s).some((e) => /портрет/.test(e)));
  s.classmates[0].portrait = 'https://example.com/v.png';
  updateClassmate(s, 'sokolova', { portrait: '' }, preset);
  assert.equal('portrait' in s.classmates[0], false);
});

// --- значки у ответов ---------------------------------------------------------------------

test('ответ: два-три значка из набора поста, скромнее поста, счёт от id', () => {
  const s = withThread();
  const post = s.feed.items.find((x) => x.id === 'p1');
  const reply = s.feed.items.find((x) => x.id === 'p1^1');
  assert.deepEqual(reactSet(reply), REACT_SETS.drama.slice(0, REPLY_REACTS));
  const r = reactCounts(reply);
  assert.ok(r.length >= 2 && r.length <= 3, JSON.stringify(r));
  assert.deepEqual(r, reactCounts(cloneState(s).feed.items.find((x) => x.id === 'p1^1')), 'пересчёт — те же числа');
  const sum = (x) => x.reduce((n, c) => n + c.n, 0);
  assert.ok(sum(r) < sum(reactCounts(post, 2)), 'ответ тише поста');
  // Разные ответы — разные числа (от своего id), но тот же набор.
  const other = reactCounts(s.feed.items.find((x) => x.id === 'p1^2'));
  assert.deepEqual(other.map((c) => c.emoji).slice(0, 2), r.map((c) => c.emoji).slice(0, 2));
  // Анонимка — набор анонимки.
  assert.deepEqual(reactSet({ parent: 'p', chan: 'anon' }), REACT_SETS.anon.slice(0, REPLY_REACTS));
});

test('ответ: свой значок — переключатель, переносится пересчётом, откатывается с лентой', () => {
  const before = semester();
  const s = withThread(cloneState(before));
  const plain = reactCounts(s.feed.items.find((x) => x.id === 'p1^1'));
  assert.equal(toggleReact(s, 'p1^1', '🍿'), '🍿');
  const mine = reactCounts(s.feed.items.find((x) => x.id === 'p1^1'));
  const was = plain.find((c) => c.emoji === '🍿');
  assert.equal(mine.find((c) => c.emoji === '🍿').n, (was ? was.n : 0) + 1);
  assert.equal(mine.find((c) => c.emoji === '🍿').mine, true);
  assert.equal(toggleReact(s, 'p1^1', '👀'), null, 'четвёртый значок поста у ответа не ставится');
  assert.equal(s.feed.items.find((x) => x.id === 'p1').mine, '', 'пост свой значок не получил');
  // Значок держится нормализацией и переносится пересчётом того же ответа.
  assert.equal(normalizeFeed(s.feed).items.find((x) => x.id === 'p1^1').mine, '🍿');
  const again = carryFeedMarks(s, withThread(cloneState(before)), 'm1');
  assert.equal(again.feed.items.find((x) => x.id === 'p1^1').mine, '🍿');
  // Откат: ответа в ленте нет — нет и значка.
  const rolled = carryFeedMarks(s, before, 'm1');
  assert.equal((rolled.feed ? rolled.feed.items : []).length, 0);
  // Снять тем же значком.
  assert.equal(toggleReact(s, 'p1^1', '🍿'), '');
  assert.deepEqual(s.classmates.map((c) => c.relation), before.classmates.map((c) => c.relation), 'семестр не тронут');
});

// --- вид ------------------------------------------------------------------------------------

test('вид «Потока»: маска — значок, человек — инициалы или фото, у ответов значки', () => {
  const s = withThread();
  addFeedItem(s, { id: 'p2', src: 'm2', kind: 'reaction', who: 'petrova', chan: 'chat', loud: 1, text: 'Тишина на паре' });
  addFeedItem(s, { id: 'p3', src: 'm3', kind: 'reaction', chan: 'anon', loud: 1, text: 'Говорят, всё куплено' });
  const v = feedView(s, preset, { chan: 'chat', heroine: 'Аня' });
  const p1 = v.items.find((i) => i.id === 'p1');
  assert.deepEqual(p1.avatar, { kind: 'mask', icon: '😈' });
  assert.equal(p1.who, '@школьный бес');
  const [vera, alpha] = p1.replies;
  assert.deepEqual([vera.avatar.kind, vera.avatar.initials, vera.who], ['person', 'ВС', 'Вера Соколова']);
  assert.deepEqual(alpha.avatar, { kind: 'mask', icon: '⚽' });
  assert.equal(vera.reacts.length, REPLY_REACTS, 'у ответа все три значка набора, ноль — без числа');
  assert.ok(vera.reacts.filter((r) => r.n > 0).length >= 2);
  const p2 = v.items.find((i) => i.id === 'p2');
  assert.equal(p2.avatar.portrait, '/user/images/academy/petrova_1.jpg');
  const anon = feedView(s, preset, { chan: 'anon' }).items.find((i) => i.id === 'p3');
  assert.deepEqual(anon.avatar, { kind: 'anon', icon: '👤' });
});

test('вид «Люди»: у преподавателя и однокурсника кружок — фото или инициалы', () => {
  const s = semester();
  s.classmates[1].portrait = '/user/images/academy/orlova_3.jpg';
  const course = classmatesView(s, preset);
  assert.deepEqual(course.people.map((p) => [p.avatar.initials, p.portrait]), [['ВС', ''], ['МО', '/user/images/academy/orlova_3.jpg']]);
  const t = peopleView(s, preset).teachers[0];
  assert.deepEqual([t.avatar.initials, t.avatar.portrait], ['ПА', '/user/images/academy/petrova_1.jpg']);
});

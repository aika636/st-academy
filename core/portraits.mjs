// core/portraits — портреты людей: какой адрес годится и что нужно, чтобы
// положить свою картинку в таверну (решение 08.10, аватарки шаг 2).
//
// Картинка хранится файлом в папке пользователя таверны
// (`user/images/academy/…`), а в состоянии — только путь к ней: состояние
// пишется в метаданные чата при каждом ответе, и base64 раздул бы их на сотни
// килобайт. Поэтому `data:` в портрет не принимается никогда (`isPortrait`).
//
// Здесь — только чистое: имя файла, проверка типа и размера, размер после
// уменьшения, разбор data URL. Холст и запрос в таверну — в браузерном
// `portraits.js` рядом с `index.js`; им же пользуется и генерация картинок.

/** Подпапка в `user/images` таверны, куда ложатся портреты Академии. */
export const PORTRAIT_FOLDER = 'academy';

/** Длинная сторона портрета после уменьшения, пикселей. */
export const PORTRAIT_SIDE = 512;

/** Качество JPEG после уменьшения. */
export const PORTRAIT_QUALITY = 0.85;

/**
 * Сколько может весить выбранный файл до уменьшения. Снимок с телефона —
 * 3–12 МБ; больше — скорее видео или панорама, и холст телефона на нём
 * задохнётся.
 */
export const PORTRAIT_INPUT_MAX = 25 * 1024 * 1024;

/**
 * Сколько может весить уже уменьшенная картинка (base64, символов). 512 px в
 * JPEG — 30–120 КБ; потолок с запасом на PNG от генерации.
 */
export const PORTRAIT_SAVED_MAX = 4 * 1024 * 1024;

/** Какие картинки таверна примет на сохранение, и с каким расширением. */
export const PORTRAIT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

/** Потолок длины адреса портрета. Картинка `data:` сюда не влезет — и не должна. */
export const PORTRAIT_MAX = 1000;

/**
 * Годится ли строка в портрет (9.7A п.15). Два вида адреса, и оба — то, что
 * браузер таверны откроет сам:
 *
 * - `http://` и `https://` — ссылка наружу;
 * - путь без схемы — от корня таверны (`characters/Анна/портрет.png`,
 *   `/user/images/x.png`): так лежат картинки, загруженные в саму таверну.
 *
 * Всё прочее со схемой отвергается: `javascript:` — очевидно, `data:` — потому
 * что картинка в base64 раздула бы метаданные чата (состояние пишется при
 * каждом ответе), `file:` и `C:\…` — браузер их из таверны не откроет, и
 * человек увидел бы пустую рамку без объяснения. Управляющие символы и
 * переводы строк — признак мусора, а не пути.
 */
export function isPortrait(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s || s.length > PORTRAIT_MAX || s !== v) return false;
  if (/[\u0000-\u001f\u007f]/.test(s)) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (!scheme) return !s.startsWith('\\');
  return /^https?$/i.test(scheme[1]) && /^https?:\/\/[^/\s]/i.test(s);
}

/** Адрес портрета к форме `isPortrait` или `null` (пусто, мусор, чужая схема). */
export function normalizePortrait(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return isPortrait(s) ? s : null;
}

// --- своя картинка ---------------------------------------------------------------

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

/**
 * Имя файла портрета без расширения: id человека латиницей и время —
 * `petrova_1759912345678`. Время — чтобы новая картинка не попала под кэш
 * браузера со старой и не затёрла её, пока состояние ещё ссылается на прежнюю
 * (свайп назад вернёт старый путь — файл должен быть на месте). Точек нет:
 * таверна всё равно заменила бы их подчёркиванием.
 *
 * @param {string} personId
 * @param {number} [now] метка времени, мс
 * @returns {string}
 */
export function portraitFileName(personId, now = Date.now()) {
  let slug = '';
  for (const ch of String(personId == null ? '' : personId).toLowerCase()) {
    if (/[a-z0-9]/.test(ch)) slug += ch;
    else if (TRANSLIT[ch] !== undefined) slug += TRANSLIT[ch];
    else if (/[\s\-_]/.test(ch)) slug += '-';
  }
  slug = slug.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-+$/, '');
  const t = Number.isFinite(Number(now)) ? Math.max(0, Math.trunc(Number(now))) : 0;
  return `${slug || 'person'}_${t}`;
}

/**
 * Годится ли выбранный файл: картинка и не огромная. Тип пустой — бывает у
 * снимков HEIC с некоторых телефонов: тогда решает декодер браузера, а не
 * эта проверка.
 *
 * @param {{type?: string, size?: number}} file
 * @returns {{ok: true} | {ok: false, code: string, error: string}}
 */
export function checkImageFile(file) {
  if (!file || typeof file !== 'object') return { ok: false, code: 'no-file', error: 'файл не выбран' };
  const type = String(file.type || '').toLowerCase();
  if (type && !type.startsWith('image/')) {
    return { ok: false, code: 'not-image', error: 'это не картинка — выберите фото или рисунок' };
  }
  const size = Number(file.size);
  if (Number.isFinite(size) && size <= 0) return { ok: false, code: 'empty', error: 'файл пустой' };
  if (Number.isFinite(size) && size > PORTRAIT_INPUT_MAX) {
    return { ok: false, code: 'too-big', error: `файл больше ${Math.round(PORTRAIT_INPUT_MAX / 1024 / 1024)} МБ — выберите поменьше` };
  }
  return { ok: true };
}

/**
 * Размер после уменьшения: длинная сторона — до `max`, пропорции те же.
 * Маленькая картинка не растягивается.
 *
 * @returns {{width: number, height: number}}
 */
export function fitSize(width, height, max = PORTRAIT_SIDE) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/**
 * Data URL картинки на части: тип, расширение для таверны и сам base64.
 * Не картинка, не base64 или тип, которого таверна не примет, — `null`.
 *
 * @param {string} dataUrl
 * @returns {?{mime: string, ext: string, base64: string}}
 */
export function splitDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = PORTRAIT_TYPES[mime];
  const base64 = m[2].replace(/\s+/g, '');
  return ext && base64 ? { mime, ext, base64 } : null;
}

/**
 * Готовую к сохранению картинку — последней проверкой: годный data URL и не
 * тяжелее `PORTRAIT_SAVED_MAX`.
 *
 * @returns {{ok: true, mime: string, ext: string, base64: string} | {ok: false, code: string, error: string}}
 */
export function checkSavedImage(dataUrl) {
  const parts = splitDataUrl(dataUrl);
  if (!parts) return { ok: false, code: 'bad-image', error: 'картинку не удалось прочитать' };
  if (parts.base64.length > PORTRAIT_SAVED_MAX) {
    return { ok: false, code: 'too-big', error: 'картинка слишком тяжёлая даже после уменьшения' };
  }
  return { ok: true, ...parts };
}

// --- своё описание внешности ---------------------------------------------------

/**
 * Потолок своего описания внешности, символов (шаг 4, «Нарисовать»): коротко,
 * одна-две приметы — «рыжая, в очках, шрам над бровью». Описание идёт в
 * промпт рисования как есть, в лорбук и в промпт чата — нет.
 */
export const LOOKS_MAX = 200;

/** Своё описание внешности к форме состояния: одна строка до `LOOKS_MAX`; пусто — ''. */
export function normalizeLooks(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LOOKS_MAX).trim();
}

/** Годится ли значение поля `looks` в состоянии: нет его или непустая строка до потолка. */
export function looksOk(v) {
  return v === undefined || v === null || (typeof v === 'string' && Boolean(v.trim()) && v.length <= LOOKS_MAX);
}

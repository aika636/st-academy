// portraits.js — единый путь сохранения картинки-портрета в таверну
// (решение 08.10, аватарки шаг 2; им же пользуется рисование, шаг 4).
//
// Что приходит: файл с телефона (`File`/`Blob` из `<input type="file">`),
// data URL или голый base64 (ответ генерации картинок). Что уходит: путь
// `/user/images/academy/<id>_<время>.jpg`, который годится в портрет
// (`core/portraits.isPortrait`) и кладётся в состояние. Сама картинка в
// состояние не попадает никогда.
//
// Картинка перед сохранением уменьшается в браузере: длинная сторона — до 512
// пикселей, JPEG 0.85 (`PORTRAIT_SIDE`, `PORTRAIT_QUALITY`). Снимок с телефона
// весит мегабайты, а в кружке и в окне портрета ему хватает сотни килобайт.
// Прозрачный фон (PNG генерации) заливается белым: в JPEG прозрачности нет, и
// без заливки он стал бы чёрным.
//
// Сохраняет таверна: `saveBase64AsFile` из `scripts/utils.js` — тот же путь,
// что у NOVA и Phone-ST. Импорт ленивый: в старой таверне функции нет, и тогда
// ответ — понятная строка, а не упавшее расширение.
//
// Чистые части (имя файла, проверки, размер) — в `core/portraits.mjs`, с
// тестами; здесь — холст и запрос.

import {
  PORTRAIT_FOLDER, PORTRAIT_SIDE, PORTRAIT_QUALITY,
  checkImageFile, checkSavedImage, fitSize, portraitFileName, isPortrait,
} from './core/portraits.mjs';

/** Слова отказов — живым русским, их видит человек под кнопкой. */
export const PORTRAIT_TEXT = {
  noSave: 'Не удалось сохранить картинку в таверну: эта версия таверны не умеет принимать картинки от расширений.',
  saveFailed: 'Не удалось сохранить картинку в таверну: {why}',
  badPath: 'Таверна сохранила картинку, но вернула странный путь — портрет не поставлен.',
  decode: 'Не получилось открыть картинку. Попробуйте другой файл — JPEG или PNG.',
  noCanvas: 'Браузер не дал уменьшить картинку.',
  noPerson: 'Не сказано, чей это портрет.',
};

const fill = (t, vars) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

/**
 * Сохранить картинку-портрет в таверну.
 *
 * @param {Blob|File|string} source файл, data URL или голый base64
 * @param {Object} opts
 * @param {string} opts.personId id человека — из него имя файла
 * @param {string} [opts.mime] тип голого base64 (по умолчанию `image/png`)
 * @param {number} [opts.now] метка времени для имени файла
 * @param {Function} [opts.save] замена `saveBase64AsFile` (тесты, стенд)
 * @returns {Promise<{ok: true, path: string} | {ok: false, code: string, error: string}>}
 */
export async function savePortraitImage(source, opts = {}) {
  const personId = String((opts && opts.personId) || '').trim();
  if (!personId) return { ok: false, code: 'no-person', error: PORTRAIT_TEXT.noPerson };

  let dataUrl;
  try {
    dataUrl = await shrink(source, opts);
  } catch (err) {
    return { ok: false, code: (err && err.code) || 'decode', error: (err && err.message) || PORTRAIT_TEXT.decode };
  }
  const img = checkSavedImage(dataUrl);
  if (!img.ok) return img;

  const save = typeof opts.save === 'function' ? opts.save : await tavernSave();
  if (!save) return { ok: false, code: 'no-save', error: PORTRAIT_TEXT.noSave };

  let path;
  try {
    path = await save(img.base64, PORTRAIT_FOLDER, portraitFileName(personId, opts.now), img.ext);
  } catch (err) {
    return { ok: false, code: 'save-failed', error: fill(PORTRAIT_TEXT.saveFailed, { why: (err && err.message) || String(err) }) };
  }
  const out = typeof path === 'string' ? path.trim() : '';
  if (!out || !isPortrait(out)) return { ok: false, code: 'bad-path', error: PORTRAIT_TEXT.badPath };
  return { ok: true, path: out };
}

/** `saveBase64AsFile` таверны или `null`, если её нет (старая версия, стенд). */
async function tavernSave() {
  try {
    const utils = await import('../../../utils.js');
    return typeof utils.saveBase64AsFile === 'function' ? utils.saveBase64AsFile : null;
  } catch {
    return null;
  }
}

/** Ошибка с кодом — чтобы отказ дошёл до человека своими словами. */
function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Источник → уменьшенный JPEG data URL. Файл проверяется до чтения (тип,
 * размер), data URL и base64 — после (`checkSavedImage`).
 */
async function shrink(source, opts) {
  let blob;
  if (typeof source === 'string') {
    const s = source.trim();
    const url = s.startsWith('data:') ? s : `data:${opts.mime || 'image/png'};base64,${s}`;
    blob = await (await fetch(url)).blob();
  } else if (source && typeof source === 'object' && typeof source.size === 'number') {
    const check = checkImageFile(source);
    if (!check.ok) throw fail(check.code, check.error);
    blob = source;
  } else {
    throw fail('no-file', 'файл не выбран');
  }

  const bitmap = await decode(blob);
  const { width, height } = fitSize(bitmap.width, bitmap.height, PORTRAIT_SIDE);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext && canvas.getContext('2d');
  if (!g) throw fail('no-canvas', PORTRAIT_TEXT.noCanvas);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, width, height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap.image, 0, 0, width, height);
  if (bitmap.close) bitmap.close();
  return canvas.toDataURL('image/jpeg', PORTRAIT_QUALITY);
}

/**
 * Картинка из Blob: `createImageBitmap` с поворотом по EXIF (снимок с
 * телефона иначе ложится набок), без него — через `<img>`.
 */
async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close && bmp.close() };
    } catch {
      // Старый браузер не знает опций или формата — пробуем через <img>.
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(fail('decode', PORTRAIT_TEXT.decode));
      i.src = url;
    });
    return { image: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, close: null };
  } finally {
    // Картинка уже разобрана в памяти: ссылка на Blob больше не нужна.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

import {
  PORTRAIT_FOLDER, PORTRAIT_SIDE, PORTRAIT_QUALITY,
  checkImageFile, checkSavedImage, fitSize, portraitFileName, isPortrait,
} from './core/portraits.mjs';

export const PORTRAIT_TEXT = {
  noSave: 'Не удалось сохранить картинку в таверну: эта версия таверны не умеет принимать картинки от расширений.',
  saveFailed: 'Не удалось сохранить картинку в таверну: {why}',
  badPath: 'Таверна сохранила картинку, но вернула странный путь — портрет не поставлен.',
  decode: 'Не получилось открыть картинку. Попробуйте другой файл — JPEG или PNG.',
  noCanvas: 'Браузер не дал уменьшить картинку.',
  noPerson: 'Не сказано, чей это портрет.',
};

const fill = (t, vars) => String(t).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));

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

async function tavernSave() {
  try {
    const utils = await import('../../../utils.js');
    return typeof utils.saveBase64AsFile === 'function' ? utils.saveBase64AsFile : null;
  } catch {
    return null;
  }
}

function fail(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

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

async function decode(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return { image: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close && bmp.close() };
    } catch {
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
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

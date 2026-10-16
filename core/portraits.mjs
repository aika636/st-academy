export const PORTRAIT_FOLDER = 'academy';

export const PORTRAIT_SIDE = 512;

export const PORTRAIT_QUALITY = 0.85;

export const PORTRAIT_INPUT_MAX = 25 * 1024 * 1024;

export const PORTRAIT_SAVED_MAX = 4 * 1024 * 1024;

export const PORTRAIT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export const PORTRAIT_MAX = 1000;

export function isPortrait(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s || s.length > PORTRAIT_MAX || s !== v) return false;
  if (/[\u0000-\u001f\u007f]/.test(s)) return false;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  if (!scheme) return !s.startsWith('\\');
  return /^https?$/i.test(scheme[1]) && /^https?:\/\/[^/\s]/i.test(s);
}

export function normalizePortrait(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  return isPortrait(s) ? s : null;
}

const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

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

export function fitSize(width, height, max = PORTRAIT_SIDE) {
  const w = Math.max(1, Math.round(Number(width) || 1));
  const h = Math.max(1, Math.round(Number(height) || 1));
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export function splitDataUrl(dataUrl) {
  const m = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const ext = PORTRAIT_TYPES[mime];
  const base64 = m[2].replace(/\s+/g, '');
  return ext && base64 ? { mime, ext, base64 } : null;
}

export function checkSavedImage(dataUrl) {
  const parts = splitDataUrl(dataUrl);
  if (!parts) return { ok: false, code: 'bad-image', error: 'картинку не удалось прочитать' };
  if (parts.base64.length > PORTRAIT_SAVED_MAX) {
    return { ok: false, code: 'too-big', error: 'картинка слишком тяжёлая даже после уменьшения' };
  }
  return { ok: true, ...parts };
}

export const LOOKS_MAX = 200;

export function normalizeLooks(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LOOKS_MAX).trim();
}

export function looksOk(v) {
  return v === undefined || v === null || (typeof v === 'string' && Boolean(v.trim()) && v.length <= LOOKS_MAX);
}

const TRANSIENT_LOOK = new RegExp(`(?<![а-яё])(?:след|пятн|гряз|грязн|испачкан|перепачкан|кров|окровавлен|синяк|ссадин|царапин|ушиб|помад|мят|растрёпан|растрепан|взъерошен|мокр|промок|запыхав|порван|разорван|расстёгнут|расстегнут|слёз|слез|заплакан|припух|покраснев|поза(?![а-яё])|позе(?![а-яё])|позу(?![а-яё])|стоит|стоя(?![а-яё])|сидит|сидя(?![а-яё])|лежит|опира|облокот|скрест|прислон|выражени|улыба|улыбк|ухмыл|усмеш|хмур|нахмур|смущ|сердит|дрожащ|сейчас|только что|в этот момент|сегодня)`, 'i');

export function stableLooks(text) {
  const parts = normalizeLooks(text).split(/\s*[,;]\s*/).filter(Boolean);
  return parts.filter((p) => !TRANSIENT_LOOK.test(p.toLowerCase())).join(', ');
}

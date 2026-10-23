export const EASTER_FIRST_YEAR = 1583;
export const EASTER_LAST_YEAR = 4099;

export function easterYearKnown(year) {
  return Number.isInteger(year) && year >= EASTER_FIRST_YEAR && year <= EASTER_LAST_YEAR;
}

// Православная Пасха по Меёсу (юлианский счёт) в григорианской дате: ГГГГ-ММ-ДД.
export function orthodoxEaster(year) {
  if (!easterYearKnown(year)) return null;
  const d = (19 * (year % 19) + 15) % 30;
  const e = (2 * (year % 4) + 4 * (year % 7) - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31);
  const day = ((d + e + 114) % 31) + 1;
  const gap = Math.floor(year / 100) - Math.floor(year / 400) - 2;
  const dt = new Date(Date.UTC(year, month - 1, day + gap));
  const p = (n) => String(n).padStart(2, '0');
  return `${String(dt.getUTCFullYear()).padStart(4, '0')}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

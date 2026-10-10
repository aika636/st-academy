/**
 * Склонение по числу: «1 ответ / 2 ответа / 5 ответов».
 * Живёт в core, чтобы им пользовались и экран, и текст для модели.
 */
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

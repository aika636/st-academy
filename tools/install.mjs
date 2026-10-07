/**
 * Ставит расширение в живую таверну: копирует то, что нужно браузеру, и ничего
 * больше — тесты, планы и сам инструментарий в таверне не нужны.
 *
 *   node tools/install.mjs <путь-к-SillyTavern>
 *
 * Путь можно не писать каждый раз: он берётся из переменной окружения
 * `SILLYTAVERN_PATH`. Проверено на 1.18.0.
 */

import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ST = process.env.SILLYTAVERN_PATH || '';

/** Что видит браузер. Список явный: лишнее в таверне — мусор, а не запас. */
const SHIP = [
  'manifest.json',
  'index.js',
  'style.css',
  'ui.js',
  'ui',
  'mes-panel.js',
  'storage.js',
  'lorebook.js',
  'commands.js',
  'api.js',
  'prompt.mjs',
  'core',
  'presets',
];

async function main() {
  const arg = process.argv[2] || DEFAULT_ST;
  if (!arg) {
    throw new Error('не сказано, куда ставить: node tools/install.mjs <путь-к-SillyTavern> '
      + '(или переменная окружения SILLYTAVERN_PATH)');
  }
  const st = resolve(arg);
  const dest = join(st, 'public/scripts/extensions/third-party/academy');

  try {
    await stat(join(st, 'public/script.js'));
  } catch {
    throw new Error(`не похоже на SillyTavern: ${st}`);
  }

  // Старое содержимое сносится целиком: переименованный или удалённый в исходнике
  // файл иначе остался бы в таверне и продолжил грузиться.
  await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });

  for (const name of SHIP) {
    await cp(join(ROOT, name), join(dest, name), { recursive: true });
  }

  console.log(`поставлено: ${dest}`);
  console.log('в таверне: обновить страницу (Ctrl+F5), расширение появится в меню.');
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});

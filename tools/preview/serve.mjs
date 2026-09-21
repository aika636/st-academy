// tools/preview/serve.mjs — статический сервер для стенда tools/preview.
//
// Нужен потому, что стенд грузит ui.js и core/*.mjs как ES-модули, а браузер
// по file:// их не отдаёт (CORS). Зависимостей нет — голый node:http.
//
//   node tools/preview/serve.mjs        # http://127.0.0.1:8123/tools/preview/
//
// Корень раздачи — корень расширения (на два уровня вверх), чтобы страница
// доставала ../../ui.js, ../../style.css и ../../presets/*.json как в проде.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PORT = Number(process.env.PORT) || 8123;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // Портрет-заглушка стенда (9.7A п.15): без типа `<img>` SVG не рисует.
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(normalize(ROOT))) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`preview: http://127.0.0.1:${PORT}/tools/preview/`);
});

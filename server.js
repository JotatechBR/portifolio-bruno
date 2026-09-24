// Servidor estático da versão de produção (dist/), sem dependências.
// Uso: npm run build  ->  node server   (porta: PORT, padrão 3000)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = resolve('dist');
const PORT = Number(process.env.PORT) || 3000;

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error('A pasta dist/ não existe. Rode primeiro: npm run build');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESS = new Set(['.html', '.js', '.css', '.svg', '.txt']);

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([\\/])+/, '');
    let file = join(ROOT, path);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    if (!existsSync(file) || (await stat(file)).isDirectory()) file = join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
      return;
    }
    const ext = extname(file);
    let body = await readFile(file);
    const headers = {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': file.includes(`${join(ROOT, 'assets')}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    if (COMPRESS.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = gzipSync(body);
      headers['Content-Encoding'] = 'gzip';
    }
    res.writeHead(200, headers).end(body);
  } catch (err) {
    res.writeHead(500).end();
    console.error(err);
  }
}).listen(PORT, () => {
  console.log(`Site rodando em http://localhost:${PORT}`);
});

// Servidor da versão de produção: API de pagamento/ativação em /api e site estático de dist/.
// Uso: npm run build  ->  node server   (porta: PORT, padrão 3000)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { loadEnvFile } from './backend/config.mjs';
import { createApiHandler } from './backend/app.mjs';

loadEnvFile();
const ROOT = resolve('dist');
const PORT = Number(process.env.PORT) || 3000;
const handleApi = createApiHandler();

// Sem dist/ (desenvolvimento com Vite na 5173), só a API funciona.
const hasSite = existsSync(join(ROOT, 'index.html'));
if (!hasSite) console.warn('A pasta dist/ não existe: servindo apenas /api. Para o site, rode: npm run build');

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
    // /api antes de qualquer arquivo estático (inclusive rotas desconhecidas: JSON 404)
    if (await handleApi(req, res)) return;

    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/acesso') {
      res.writeHead(301, { Location: '/acesso/' + url.search }).end();
      return;
    }
    if (!hasSite) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Site indisponível: rode npm run build.');
      return;
    }
    let path = normalize(decodeURIComponent(url.pathname)).replace(/^([\\/])+/, '');
    let file = join(ROOT, path);
    // só arquivos dentro de dist/ e nunca arquivos ocultos (.env etc.)
    if ((file !== ROOT && !file.startsWith(ROOT + sep)) || /(^|[\\/])\./.test(path)) {
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
    if (!res.headersSent) res.writeHead(500).end();
    console.error(err);
  }
}).listen(PORT, () => {
  console.log(`Site rodando em http://localhost:${PORT}`);
});

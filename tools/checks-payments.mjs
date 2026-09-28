// Verificação técnica do fluxo de compra/ativação (após npm run build).
// Uso: npm run check:payments
// Confere o HTML compilado, que dist/ não leva segredos nem módulos privados, as rotas do
// servidor e quais variáveis privadas estão presentes (nunca imprime valores).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { CAKTO_CHECKOUT_URL, ACCESS_PATH, CTA_POSITIONS } from '../src/content/site.js';
import { loadEnvFile, readConfig, missingFor } from '../backend/config.mjs';

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  ok ' : 'FALHA'}  ${msg}`);
  if (!cond) failures++;
};

// 1) HTML compilado
const PAGES = ['index.html', 'acesso/index.html', 'termos/index.html', 'privacidade/index.html', 'reembolso/index.html'];
ok(PAGES.every((f) => existsSync(join('dist', f))), `build gera ${PAGES.join(', ')}`);
if (existsSync('dist/index.html')) {
  const home = readFileSync('dist/index.html', 'utf8');
  const buy = [...home.matchAll(/<a [^>]*data-action-kind="purchase"[^>]*>/g)].map((m) => m[0]);
  ok(buy.length >= CTA_POSITIONS.length && buy.every((a) => a.includes(`href="${CAKTO_CHECKOUT_URL}"`)), `todos os ${buy.length} CTAs de compra apontam para ${CAKTO_CHECKOUT_URL}`);
  const pos = new Set(buy.map((a) => (/data-cta-position="([a-z_]+)"/.exec(a) || [])[1]));
  ok(CTA_POSITIONS.every((p) => pos.has(p)), `CTAs cobrem as posições ${CTA_POSITIONS.join(', ')}`);
  ok(!buy.some((a) => /aria-disabled/.test(a)), 'nenhum CTA de compra está desativado');
  ok((home.match(new RegExp(`href="${ACCESS_PATH}"[^>]*data-action-kind="access"`, 'g')) || []).length >= 2, 'links de ativação apontam para /acesso/');
  ok(['/termos/', '/privacidade/', '/reembolso/'].every((l) => home.includes(`href="${l}"`)), 'links legais visíveis na home');
  ok(/maiores de 18 anos/.test(home) && /Não existe promessa ou garantia de ganhos/.test(home), 'avisos 18+ e de ausência de garantia de ganhos presentes');
}
if (existsSync('dist/acesso/index.html')) {
  const page = readFileSync('dist/acesso/index.html', 'utf8');
  ok(/<noscript>[\s\S]*JavaScript[\s\S]*<\/noscript>/.test(page), '/acesso/ tem aviso noscript');
  ok(/noindex/.test(page), '/acesso/ tem robots noindex');
  const assets = [...page.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  const code = assets.map((a) => readFileSync(join('dist', a), 'utf8')).join('\n');
  ok(!/hero-scene|three|WebGLRenderer/i.test(page + code), '/acesso/ não referencia Three.js nem a cena 3D');
}

// 2) nada privado em dist/
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
if (existsSync('dist')) {
  const files = walk('dist');
  ok(!files.some((f) => /(^|[\\/])(\.env|backend|migrations)([\\/.]|$)/.test(f)), 'dist/ não contém .env, backend/ nem migrations/');
  const text = files.filter((f) => /\.(html|js|css|txt|json|svg)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  ok(!/CAKTO_WEBHOOK_SECRET|TELEGRAM_BOT_TOKEN|OTP_HASH_SECRET|CAKTO_CLIENT_SECRET|SMTP_PASS|DATABASE_URL/.test(text), 'dist/ não menciona variáveis privadas');
  ok(!/mysql2|nodemailer|createHmac/.test(text), 'dist/ não inclui módulos do backend');
  ok(!/(t\.me|telegram\.me)\/(\+|joinchat)/i.test(text), 'nenhum convite do grupo (t.me/+ ou joinchat) em dist/');
  loadEnvFile();
  const secrets = ['CAKTO_WEBHOOK_SECRET', 'CAKTO_CLIENT_SECRET', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET', 'SMTP_PASS', 'OTP_HASH_SECRET', 'DATABASE_URL', 'DB_PASSWORD']
    .map((k) => process.env[k])
    .filter((v) => v && v.length >= 8);
  ok(!secrets.some((v) => text.includes(v)), 'nenhum valor secreto do ambiente aparece em dist/');
}

// 3) rotas do servidor (processo próprio, encerrado pelo PID ao final)
if (existsSync('dist/index.html')) {
  const port = 3900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, ['server.js'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  try {
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 40; i++) {
      try {
        await fetch(base + '/');
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    const r404 = await fetch(`${base}/api/nao-existe`);
    ok(r404.status === 404 && (r404.headers.get('content-type') || '').includes('json'), '/api desconhecido responde JSON 404 (não a home)');
    const redir = await fetch(`${base}/acesso`, { redirect: 'manual' });
    ok(redir.status === 301 && redir.headers.get('location') === '/acesso/', '/acesso redireciona para /acesso/');
    const page = await fetch(`${base}/acesso/`);
    ok(page.status === 200 && (await page.text()).includes('Ative seu acesso'), '/acesso/ é servido');
    ok((await fetch(`${base}/.env`)).status !== 200, '.env não é servido');
    const wh = await fetch(`${base}/api/webhooks/cakto`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    ok([401, 503].includes(wh.status), `webhook sem assinatura é recusado (HTTP ${wh.status})`);
    const sp = await fetch(`${base}/api/social-proof/recent`);
    const spBody = sp.status === 200 ? await sp.json() : null;
    const allowed = (e) => Object.keys(e).sort().join() === 'timeLabel,type' && e.type === 'access_approved';
    ok(Array.isArray(spBody) && spBody.every(allowed), `/api/social-proof/recent responde só { type, timeLabel } (${Array.isArray(spBody) ? spBody.length : '?'} eventos)`);
    ok((await fetch(`${base}/termos/`)).status === 200, '/termos/ é servido');
  } finally {
    child.kill();
  }
}

// 4) configuração privada: só presença
const cfg = readConfig();
console.log('\nconfiguração (presença, sem valores):');
for (const part of ['db', 'api', 'cakto-webhook', 'cakto-api', 'policy', 'telegram', 'telegram-webhook', 'smtp', 'site']) {
  const m = missingFor(cfg, part);
  console.log(`  ${m.length ? 'pendente' : 'ok      '}  ${part}${m.length ? `: ${m.join(', ')}` : ''}`);
}

console.log(failures ? `\n${failures} verificação(ões) falharam.` : '\nTodas as verificações técnicas passaram.');
process.exitCode = failures ? 1 : 0;

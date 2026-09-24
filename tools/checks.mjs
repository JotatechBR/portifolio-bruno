// Verificações funcionais: menu, foco, sem JS, contraste e bytes transferidos.
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';

const server = await preview({ preview: { port: 4198, strictPort: true }, logLevel: 'error' });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  userDataDir: `${process.env.TEMP || '/tmp'}/bruno-checks-profile`,
  args: ['--no-first-run'],
});
const URL = 'http://localhost:4198/';

async function transfer(width, height, mobile, wait3d) {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const reqs = new Map();
  cdp.on('Network.responseReceived', (e) => reqs.set(e.requestId, { url: e.response.url, type: e.type }));
  let total = 0;
  const per = {};
  cdp.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId);
    if (!r) return;
    total += e.encodedDataLength;
    const key = r.url.replace(URL, '').replace(/\?.*/, '');
    per[key] = e.encodedDataLength;
  });
  await page.setViewport({ width, height, isMobile: mobile, hasTouch: mobile });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  if (wait3d) await page.waitForSelector('.hero__stage.is-3d', { timeout: 15000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1500));
  await page.close();
  return { total, per };
}

try {
  // 1) transferência (gzip do preview do Vite não comprime; ver nota no relatório)
  for (const [label, w, h, m, w3] of [['mobile 390', 390, 844, true, false], ['desktop 1440 + 3D', 1440, 900, false, true]]) {
    const { total, per } = await transfer(w, h, m, w3);
    console.log(`\n[transferência] ${label}: ${(total / 1024).toFixed(1)} KB`);
    for (const [k, v] of Object.entries(per).sort((a, b) => b[1] - a[1])) console.log(`   ${(v / 1024).toFixed(1).padStart(7)} KB  ${k}`);
  }

  // 2) menu móvel
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.focus('[data-menu-toggle]');
  await page.keyboard.press('Enter');
  const opened = await page.evaluate(() => ({
    open: document.querySelector('[data-menu]').open,
    expanded: document.querySelector('[data-menu-toggle]').getAttribute('aria-expanded'),
    focusInside: document.querySelector('[data-menu]').contains(document.activeElement),
  }));
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 100));
  const closed = await page.evaluate(() => ({
    open: document.querySelector('[data-menu]').open,
    focusOnToggle: document.activeElement === document.querySelector('[data-menu-toggle]'),
  }));
  console.log('\n[menu] aberto:', opened, ' após Esc:', closed);
  // link do menu leva à âncora sem esconder o título sob o cabeçalho
  await page.click('[data-menu-toggle]');
  await page.click('[data-menu-link][href="#cursos"]');
  await new Promise((r) => setTimeout(r, 1200));
  const anchor = await page.evaluate(() => {
    const h = document.querySelector('#cursos-titulo').getBoundingClientRect().top;
    const header = document.querySelector('[data-header]').getBoundingClientRect().bottom;
    return { tituloTop: Math.round(h), cabecalhoBottom: Math.round(header), focado: document.activeElement.id };
  });
  console.log('[âncora #cursos]', anchor);

  // 3) teclado: ordem de tabulação inicial e link de pular
  await page.goto(URL, { waitUntil: 'networkidle0' });
  const tabs = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    tabs.push(await page.evaluate(() => (document.activeElement.textContent || '').trim().slice(0, 32)));
  }
  console.log('[tab]', tabs.join(' → '));

  // 4) sem JavaScript
  const nojs = await browser.newPage();
  await nojs.setJavaScriptEnabled(false);
  await nojs.setViewport({ width: 390, height: 844 });
  await nojs.goto(URL, { waitUntil: 'networkidle0' });
  const nj = await nojs.evaluate(() => ({
    h1: document.querySelector('h1').textContent,
    hiddenReveals: [...document.querySelectorAll('.reveal')].filter((e) => getComputedStyle(e).opacity === '0').length,
    menuHref: document.querySelector('[data-menu-toggle]').getAttribute('href'),
    h2s: [...document.querySelectorAll('h2,h3')].map((h) => h.tagName + ':' + h.textContent.trim()).join(' | '),
    h1count: document.querySelectorAll('h1').length,
  }));
  console.log('[sem JS]', nj);
  await nojs.screenshot({ path: 'tools/renders/screens/nojs-390.png', fullPage: true });

  // 5) contraste das combinações implementadas
  const lum = (hex) => {
    const c = hex.match(/\w\w/g).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return ((x + 0.05) / (y + 0.05)).toFixed(2);
  };
  const pairs = [
    ['texto principal / fundo', 'f4f1f2', '080808'],
    ['texto secundário / fundo', 'b8b1b5', '080808'],
    ['texto secundário / grafite', 'b8b1b5', '131214'],
    ['branco / botão vermelho', 'ffffff', 'c9102d'],
    ['branco / botão hover', 'ffffff', 'b50e27'],
    ['vermelho luminoso / fundo (detalhes grandes)', 'ff4256', '080808'],
    ['vermelho luminoso / vinho (título grande)', 'ff4256', '3a0b19'],
    ['texto claro / vinho', 'f4f1f2', '3a0b19'],
    ['texto #e2d9dd / vinho', 'e2d9dd', '3a0b19'],
    ['botão vermelho / vinho (componente)', 'c9102d', '3a0b19'],
    ['botão vermelho / fundo (componente)', 'c9102d', '080808'],
  ];
  console.log('\n[contraste]');
  for (const [n, a, b] of pairs) console.log(`   ${ratio(a, b).padStart(5)}:1  ${n}`);
} finally {
  await browser.close();
  server.httpServer.close();
}

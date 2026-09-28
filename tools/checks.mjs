// Verificações funcionais: menu, foco, sem JS, compra/contato, contraste e bytes transferidos.
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { CAKTO_CHECKOUT_URL, ACCESS_PATH } from '../src/content/site.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await page.click('[data-menu-link][href="#conteudo"]');
  await sleep(1200);
  const anchor = await page.evaluate(() => {
    const h = document.querySelector('#conteudo-titulo').getBoundingClientRect().top;
    const header = document.querySelector('[data-header]').getBoundingClientRect().bottom;
    return { tituloTop: Math.round(h), cabecalhoBottom: Math.round(header), focado: document.activeElement.id };
  });
  console.log('[âncora #conteudo]', anchor, anchor.tituloTop >= anchor.cabecalhoBottom ? 'ok' : 'FALHA: título sob o cabeçalho');

  // FAQ: recolhido com JS, abre por teclado, setas movem o foco
  await page.goto(URL, { waitUntil: 'networkidle0' });
  const faq0 = await page.evaluate(() => [...new Set([...document.querySelectorAll('[data-faq-trigger]')].map((b) => b.getAttribute('aria-expanded')))]);
  await page.focus('[data-faq-trigger]');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  const faq1 = await page.evaluate(() => ({
    expanded: document.querySelector('[data-faq-trigger]').getAttribute('aria-expanded'),
    panelVisible: !document.getElementById('faq-a-1').hidden,
    focus: document.activeElement.id,
  }));
  const faqOk = faq0.join() === 'false' && faq1.expanded === 'true' && faq1.panelVisible && faq1.focus === 'faq-q-2';
  console.log('[faq] inicial:', faq0.join(), ' após Enter e ↓:', faq1, faqOk ? 'ok' : 'FALHA');

  // CTA fixo: oculto no hero, visível no conteúdo, oculto na oferta e no rodapé
  const stickyAt = async (sel) => {
    await page.evaluate((s) => (s ? document.querySelector(s).scrollIntoView({ behavior: 'instant', block: 'center' }) : scrollTo({ top: 0, behavior: 'instant' })), sel);
    await sleep(500);
    return page.evaluate(() => document.querySelector('[data-sticky-cta]').classList.contains('is-visible'));
  };
  const sticky = { hero: await stickyAt(null), conteudo: await stickyAt('#conteudo-titulo'), oferta: await stickyAt('#oferta-titulo'), rodape: await stickyAt('.site-footer__copy') };
  console.log('[cta fixo]', sticky, !sticky.hero && sticky.conteudo && !sticky.oferta && !sticky.rodape ? 'ok' : 'FALHA');

  // UTMs: só as cinco conhecidas seguem para o checkout
  await page.goto(URL + '?utm_source=ig&utm_campaign=lanc&gclid=abc&email=x%40y.com', { waitUntil: 'networkidle0' });
  const utmHref = await page.evaluate(() => document.querySelector('[data-cta-position="hero"]').href);
  console.log('[utm]', utmHref, utmHref === `${CAKTO_CHECKOUT_URL}?utm_source=ig&utm_campaign=lanc` ? 'ok' : 'FALHA');

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
    purchase: [...document.querySelectorAll('[data-action-kind="purchase"]')].map((a) => a.getAttribute('href')),
    access: [...document.querySelectorAll('[data-action-kind="access"]')].map((a) => a.getAttribute('href')),
    faqAbertas: [...document.querySelectorAll('[data-faq-panel]')].filter((p) => !p.hidden).length,
    stickyOculto: document.querySelector('[data-sticky-cta]').hidden,
  }));
  console.log('[sem JS]', { ...nj, purchase: nj.purchase.length });
  const buyOk = nj.purchase.length >= 6 && nj.purchase.every((h) => h === CAKTO_CHECKOUT_URL);
  const accessOk = nj.access.length >= 2 && nj.access.every((h) => h === ACCESS_PATH);
  console.log(`[links] compra=${buyOk ? 'ok' : 'FALHA'} ativação=${accessOk ? 'ok' : 'FALHA'} faq-aberto-sem-js=${nj.faqAbertas === 8 ? 'ok' : 'FALHA'} sticky-oculto=${nj.stickyOculto ? 'ok' : 'FALHA'}`);
  await nojs.screenshot({ path: 'tools/renders/screens/nojs-390.png', fullPage: true });

  // /acesso/ sem JS: aviso visível e nenhum asset 3D
  const nojsAccess = await browser.newPage();
  await nojsAccess.setJavaScriptEnabled(false);
  const accessReqs = [];
  nojsAccess.on('request', (r) => accessReqs.push(r.url()));
  await nojsAccess.goto(URL + 'acesso/', { waitUntil: 'networkidle0' });
  const acc = await nojsAccess.evaluate(() => ({
    h1: document.querySelector('h1')?.textContent,
    noscript: !!document.querySelector('noscript'),
  }));
  console.log('[acesso sem JS]', acc, ' 3D carregado:', accessReqs.some((u) => /hero-scene|\.glb/.test(u)));

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
    ['texto principal / fundo', 'f5f1f2', '070607'],
    ['texto secundário / fundo', 'aaa0a3', '070607'],
    ['texto secundário / fundo suave', 'aaa0a3', '0e0a0b'],
    ['texto secundário / superfície', 'aaa0a3', '151012'],
    ['branco / botão vermelho', 'ffffff', 'e11d32'],
    ['branco / botão hover', 'ffffff', 'e6203a'],
    ['vermelho de texto / fundo (índices, tags)', 'ff4d61', '070607'],
    ['texto / vinho profundo (oferta)', 'f5f1f2', '270a10'],
    ['microtexto #cfc3c7 / vinho profundo', 'cfc3c7', '270a10'],
    ['botão vermelho / vinho profundo (componente)', 'e11d32', '270a10'],
    ['botão vermelho / fundo (componente)', 'e11d32', '070607'],
  ];
  console.log('\n[contraste]');
  for (const [n, a, b] of pairs) console.log(`   ${ratio(a, b).padStart(5)}:1  ${n}`);
} finally {
  await browser.close();
  server.httpServer.close();
}

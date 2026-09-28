// Capturas de revisão: serve o build (dist) e fotografa larguras-alvo.
// Uso: npm run build && node tools/screenshots.mjs [larguras] [--full] [--path=/acesso/]
import { preview } from 'vite';
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const widths = (process.argv.find((a) => /^\d/.test(a)) || '360,390,768,1024,1440,1920').split(',').map(Number);
const FULL = process.argv.includes('--full');
// caminho opcional (padrão: home); prefixo no nome do arquivo para não sobrescrever as capturas da home
const PATH = (process.argv.find((a) => a.startsWith('--path=')) || '--path=/').slice(7);
if (!/^\/[a-z0-9\-/]*$/.test(PATH)) throw new Error(`--path inválido: ${PATH}`);
const PREFIX = PATH === '/' ? '' : PATH.replace(/^\/|\/$/g, '').replace(/\//g, '-') + '-';
const OUT = 'tools/renders/screens';
mkdirSync(OUT, { recursive: true });
const heights = { 320: 640, 360: 740, 390: 844, 768: 1024, 1024: 768, 1440: 900, 1920: 1080 };

const server = await preview({ preview: { port: 4199, strictPort: true }, logLevel: 'error' });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  userDataDir: `${process.env.TEMP || '/tmp'}/bruno-shots-profile`,
  args: ['--no-first-run', '--ignore-gpu-blocklist'],
});
try {
  for (const w of widths) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.setViewport({ width: w, height: heights[w] || 900, deviceScaleFactor: 1, isMobile: w < 900, hasTouch: w < 900 });
    await page.goto(`http://localhost:4199${PATH}`, { waitUntil: 'networkidle0' });
    await new Promise((r) => setTimeout(r, 2500));
    const info = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - innerWidth,
      is3d: !!document.querySelector('.hero__stage.is-3d'),
      h: document.documentElement.scrollHeight,
    }));
    await page.screenshot({ path: `${OUT}/${PREFIX}${w}-top.png` });
    if (FULL) {
      // força revelações antes da captura inteira
      // rola a página inteira para disparar lazy-load e revelações, como um visitante
      await page.evaluate(async () => {
        for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight / 2) {
          scrollTo({ top: y, behavior: 'instant' });
          await new Promise((r) => setTimeout(r, 120));
        }
        scrollTo({ top: 0, behavior: 'instant' });
      });
      await new Promise((r) => setTimeout(r, 800));
      await page.screenshot({ path: `${OUT}/${PREFIX}${w}-full.png`, fullPage: true });
    }
    console.log(`${w}px  overflowX=${info.overflow}  3D=${info.is3d}  altura=${info.h}  erros=${errors.length ? errors.join(' | ') : 0}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.httpServer.close();
}

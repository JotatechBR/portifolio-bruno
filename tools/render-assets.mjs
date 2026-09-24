// Pipeline de assets: exporta o monograma (GLB + meshopt), renderiza os stills
// da mesma cena em Chrome headless e gera AVIF/WebP responsivos.
// Uso: node tools/render-assets.mjs            (tudo)
//      node tools/render-assets.mjs --preview  (apenas PNGs rápidos em tools/renders/preview)
import { createServer } from 'vite';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { mkdirSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, dedup, prune, quantize, meshopt, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const PREVIEW = process.argv.includes('--preview');
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const CHROME =
  process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const RENDERS = 'tools/renders';
const OUT_IMG = 'public/img';
mkdirSync(RENDERS + '/preview', { recursive: true });
mkdirSync(OUT_IMG, { recursive: true });
mkdirSync('public/models', { recursive: true });

// nome, proporção (w/h), larguras finais, qualidade AVIF/WebP
const SHOTS = [
  { name: 'hero', aspect: 1, widths: [1600, 1000], q: { avif: 64, webp: 86 } },
  { name: 'mobile', aspect: 4 / 3, widths: [1170, 780], q: { avif: 62, webp: 84 } },
  { name: 'detail', aspect: 16 / 10, widths: [1600, 900], q: { avif: 62, webp: 84 } },
  { name: 'chips', aspect: 16 / 10, widths: [1600, 900], q: { avif: 62, webp: 84 } },
];

const kb = (p) => (statSync(p).size / 1024).toFixed(1) + ' KB';

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: 'error' });
await server.listen();
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  userDataDir: `${process.env.TEMP || '/tmp'}/bruno-studio-profile`,
  args: ['--no-first-run', '--ignore-gpu-blocklist'],
});

async function openStudio(query = '') {
  const page = await browser.newPage();
  page.on('console', (m) => console.log('[studio]', m.text()));
  page.on('pageerror', (e) => console.error('[studio error]', e.message));
  await page.goto(`http://localhost:5199/tools/studio/index.html${query}`, { waitUntil: 'networkidle0' });
  await page.evaluate(() => window.studio.ready);
  return page;
}

try {
  // 1) GLB
  const modelPath = 'public/models/monogram.glb';
  if (!PREVIEW || !existsSync(modelPath)) {
    const page = await openStudio();
    const b64 = await page.evaluate(() => window.studio.exportGLB());
    const raw = `${RENDERS}/monogram-raw.glb`;
    writeFileSync(raw, Buffer.from(b64, 'base64'));
    await MeshoptEncoder.ready;
    const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
      'meshopt.decoder': MeshoptDecoder,
    });
    const doc = await io.read(raw);
    await doc.transform(
      dedup(),
      weld(),
      prune(),
      textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 85 }),
      quantize(),
      meshopt({ encoder: MeshoptEncoder, level: 'medium' })
    );
    await io.write(modelPath, doc);
    console.log(`GLB bruto ${kb(raw)} -> otimizado ${kb(modelPath)}`);
    await page.close();
  }

  // 2) Stills a partir do GLB otimizado (mesmo arquivo que o site carrega)
  const page = await openStudio('?model=/models/monogram.glb');
  for (const s of SHOTS) {
    if (ONLY.length && !ONLY.includes(s.name)) continue;
    const w = PREVIEW ? 900 : Math.min(s.widths[0] * 2, 3200);
    const h = Math.round(w / s.aspect);
    const t0 = Date.now();
    const dataUrl = await page.evaluate((n, w, h) => window.studio.render(n, w, h), s.name, w, h);
    const png = Buffer.from(dataUrl.split(',')[1], 'base64');
    const master = PREVIEW ? `${RENDERS}/preview/${s.name}.png` : `${RENDERS}/${s.name}.png`;
    writeFileSync(master, png);
    console.log(`${s.name}: ${w}x${h} em ${Date.now() - t0} ms`);
    if (PREVIEW) continue;
    for (const width of s.widths) {
      const height = Math.round(width / s.aspect);
      const base = sharp(png).resize(width, height, { kernel: 'lanczos3' });
      const a = `${OUT_IMG}/${s.name}-${width}.avif`;
      const wb = `${OUT_IMG}/${s.name}-${width}.webp`;
      await base.clone().avif({ quality: s.q.avif, effort: 7, chromaSubsampling: '4:4:4' }).toFile(a);
      await base.clone().webp({ quality: s.q.webp, effort: 6 }).toFile(wb);
      console.log(`  ${width}w  avif ${kb(a)}  webp ${kb(wb)}`);
    }
  }

  // 3) Imagem Open Graph (cena + tipografia real, capturada como página)
  if (!PREVIEW && (!ONLY.length || ONLY.includes('og'))) {
    const dataUrl = await page.evaluate(() => window.studio.render('og', 2400, 1260));
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    await page.evaluate(async (src) => {
      document.querySelector('canvas').style.display = 'none';
      const og = document.getElementById('og');
      og.style.display = 'block';
      const img = og.querySelector('img');
      img.src = src;
      await img.decode();
      await document.fonts.ready;
    }, dataUrl);
    const el = await page.$('#og');
    const shot = await el.screenshot({ type: 'png' });
    await sharp(shot).jpeg({ quality: 84, mozjpeg: true }).toFile(`${OUT_IMG}/og-bruno.jpg`);
    console.log(`og: ${kb(`${OUT_IMG}/og-bruno.jpg`)}`);
  }
} finally {
  await browser.close();
  await server.close();
}

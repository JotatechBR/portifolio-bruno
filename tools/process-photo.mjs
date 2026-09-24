// Trata a foto de Bruno para a seção "Sobre": recorte 3:4, P&B editorial escurecido,
// bordas que se dissolvem no preto do site. Só cor/luz: a pessoa não é alterada.
// Uso: node tools/process-photo.mjs [caminho-da-foto]
import sharp from 'sharp';

const SRC = process.argv[2] || 'tools/source/bruno-original.jpeg';
const OUT = 'public/img';
// recorte (px da original 1200x1600): cabeça até a cintura, com braço e celular
const CROP = { left: 255, top: 150, width: 690, height: 920 };
const W = 900;
const H = 1200;

// vinheta: escurece bordas e base até o #080808 do fundo
const vignette = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <radialGradient id="r" cx="48%" cy="36%" r="62%">
      <stop offset="0.28" stop-color="#fff"/>
      <stop offset="0.7" stop-color="#6a6a6a"/>
      <stop offset="1" stop-color="#101010"/>
    </radialGradient>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0.55" stop-color="#fff"/>
      <stop offset="1" stop-color="#080808"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#r)"/>
  <rect width="100%" height="100%" fill="url(#b)" style="mix-blend-mode:multiply"/>
</svg>`);

const base = await sharp(SRC)
  .rotate()
  .extract(CROP)
  .resize(W, H)
  .grayscale()
  .linear(1.3, -68) // contraste: parede recua, camiseta e pele mantêm leitura
  .gamma(1.35)
  .composite([{ input: await sharp(vignette).png().toBuffer(), blend: 'multiply' }])
  .toColourspace('srgb')
  .toBuffer();

await sharp(base).png().toFile('tools/renders/bruno-graded.png');
for (const w of [900, 600]) {
  const img = sharp(base).resize(w, Math.round((w * 4) / 3), { kernel: 'lanczos3' });
  await img.clone().avif({ quality: 62, effort: 7 }).toFile(`${OUT}/bruno-${w}.avif`);
  await img.clone().webp({ quality: 82, effort: 6 }).toFile(`${OUT}/bruno-${w}.webp`);
}
console.log('foto tratada');

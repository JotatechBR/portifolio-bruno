// Copia os WOFF2 (subconjunto latin, cobre U+0000-00FF: todos os acentos do pt-BR)
// das dependências @fontsource para public/fonts. Licença: SIL OFL 1.1.
import { copyFileSync, mkdirSync } from 'node:fs';

const files = [
  ['barlow-condensed', 'barlow-condensed-latin-600-normal.woff2'],
  ['barlow-condensed', 'barlow-condensed-latin-700-normal.woff2'],
  ['manrope', 'manrope-latin-400-normal.woff2'],
  ['manrope', 'manrope-latin-600-normal.woff2'],
];
mkdirSync('public/fonts', { recursive: true });
for (const [pkg, file] of files) {
  copyFileSync(`node_modules/@fontsource/${pkg}/files/${file}`, `public/fonts/${file}`);
  copyFileSync(`node_modules/@fontsource/${pkg}/LICENSE`, `public/fonts/LICENSE-${pkg}.txt`);
}
console.log('fontes copiadas');

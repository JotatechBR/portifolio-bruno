# Bruno — Cursos de CPA Chinês e Bets

Página de apresentação com saída para o Telegram. Vite + HTML semântico + CSS + JS modular.
Three.js só é carregado (import dinâmico) pela cena 3D opcional do hero.

## Comandos

```bash
npm install
npm run dev        # desenvolvimento em http://localhost:5173
npm run build      # versão de produção em dist/
npm run preview    # serve dist/ localmente (Vite)
node server        # ou npm start: serve dist/ em http://localhost:3000 (PORT=xxxx para mudar)
npm run assets     # regenera GLB + renders (AVIF/WebP) + imagem Open Graph
npm run fonts      # recopia as fontes WOFF2 para public/fonts
node tools/screenshots.mjs 390,1440 --full   # capturas de revisão (após o build)
node tools/checks.mjs                        # menu, foco, sem JS, contraste, bytes
```

`assets`, `screenshots` e `checks` usam o Chrome instalado (`CHROME_PATH` para outro caminho).

## Alterar o Telegram e os cursos

Tudo fica em `src/content/site.js`:

- `TELEGRAM_URL`: endereço real, formato `https://t.me/usuario`. O build valida o formato e
  grava o link diretamente no HTML de todos os botões. Vazio = botões sem destino + aviso.
- `SITE_URL`: domínio definitivo; ativa `canonical` e URLs absolutas de Open Graph.
- `OFFERS`: nome, texto, CTA e (opcional) um `telegramUrl` próprio de cada curso.

Depois de editar, rode `npm run build`.

## Estrutura

```
index.html               conteúdo essencial (gerado com os dados de site.js no build)
vite.config.js           plugin que injeta Telegram, ofertas, ano e monograma SVG
src/content/site.js      configuração central
src/styles/tokens.css    cores, tipografia, espaço, raio, movimento
src/styles/main.css      layout e componentes
src/js/                  cabeçalho, menu (<dialog>), entradas, carregador do 3D
src/three/               palco compartilhado (luz, câmera, ambiente), desenho do B, cena do hero
tools/studio/            modelagem procedural + estúdio de render (Chrome headless)
tools/render-assets.mjs  pipeline de assets
public/                  fontes, modelo GLB, imagens, favicon
```

## Assets e licenças

- **Monograma B e fichas**: desenho e modelagem próprios deste projeto (`src/three/monogram-shape.js`,
  `tools/studio/build-models.js`). Geometria em polígonos com chanfros, sem fonte extrudada.
  Renders feitos com Three.js a partir do mesmo GLB que o site carrega. Iluminação por softboxes
  procedurais (sem HDR de terceiros). É uma proposta visual, não uma marca registrada de Bruno.
- **Barlow Condensed** (600, 700) e **Manrope** (400, 600): SIL Open Font License 1.1, via
  pacotes @fontsource; licenças em `public/fonts/LICENSE-*.txt`. Subconjunto latin (U+0000–00FF),
  cobre todos os acentos do português.
- **Three.js**: licença MIT.
- **Foto de Bruno**: fornecida pelo cliente. Original em `tools/source/bruno-original.jpeg`
  (fora de `public/`, não é publicado). Tratamento (recorte 3:4, P&B, vinheta) em
  `node tools/process-photo.mjs [foto]`, que gera `public/img/bruno-600/900.avif|webp`.
  Para trocar a foto, rode o script com o novo arquivo e ajuste `CROP` se o enquadramento mudar.

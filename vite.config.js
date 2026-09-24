import { defineConfig } from 'vite';
import { TELEGRAM_URL, SITE_URL, OFFERS } from './src/content/site.js';
import { monogramSvgPath } from './src/three/monogram-shape.js';

const TELEGRAM_PATTERN = /^https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+\-/]+$/;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function validateTelegram(url, label) {
  if (!url) return '';
  if (!TELEGRAM_PATTERN.test(url)) {
    throw new Error(`[site] ${label}: "${url}" não é um endereço válido do Telegram (use https://t.me/...)`);
  }
  return url;
}

// Atributos do link de contato: link real quando configurado; sem href quando pendente.
function telegramAttrs(url) {
  return url
    ? `href="${esc(url)}"`
    : `aria-disabled="true" data-telegram-pending title="Endereço do Telegram ainda não configurado"`;
}

const ICON_TELEGRAM =
  '<svg class="icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path fill="currentColor" d="M21.4 3.6 2.9 10.8c-1 .4-1 1.8.1 2.1l4.6 1.4 1.8 5.5c.3.8 1.3 1 1.9.4l2.6-2.5 4.6 3.4c.7.5 1.7.1 1.9-.7l3-15.2c.2-1-.9-1.9-1.9-1.6ZM9.6 14.3l-.5 3.6-1.2-3.9 9.6-6.2-7.9 6.5Z"/></svg>';

function picture({ base, alt }, sizes) {
  const set = (fmt) => `/img/${base}-900.${fmt} 900w, /img/${base}-1600.${fmt} 1600w`;
  return `<picture>
          <source type="image/avif" srcset="${set('avif')}" sizes="${sizes}">
          <source type="image/webp" srcset="${set('webp')}" sizes="${sizes}">
          <img src="/img/${base}-900.webp" width="1600" height="1000" loading="lazy" decoding="async" alt="${esc(alt)}">
        </picture>`;
}

function offersMarkup(mainUrl) {
  return OFFERS.map((o, i) => {
    const url = validateTelegram(o.telegramUrl, `telegramUrl da oferta ${o.id}`) || mainUrl;
    const titleId = `oferta-${o.id}-titulo`;
    return `<article class="offer offer--${i + 1}" id="${esc(o.id)}" aria-labelledby="${titleId}">
      <div class="offer__media reveal">
        ${picture(o.image, i === 0 ? '(min-width: 1024px) 58vw, 100vw' : '(min-width: 1024px) 52vw, 100vw')}
      </div>
      <div class="offer__body">
        <p class="offer__index" aria-hidden="true">${esc(o.index)}</p>
        <h3 class="offer__title" id="${titleId}">${esc(o.name)}</h3>
        <p class="offer__text">${esc(o.text)}</p>
        <a class="btn btn--primary" ${telegramAttrs(url)}>${ICON_TELEGRAM}<span>${esc(o.cta)}</span></a>
      </div>
    </article>`;
  }).join('\n    ');
}

function sitePlugin() {
  let isBuild = false;
  return {
    name: 'bruno-site-content',
    configResolved(c) {
      isBuild = c.command === 'build';
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        if (!ctx.filename.replace(/\\/g, '/').endsWith('/index.html') || ctx.filename.includes('tools')) return html;
        const url = validateTelegram(TELEGRAM_URL, 'TELEGRAM_URL');
        if (!url) {
          const msg =
            '\n[site] ATENÇÃO: TELEGRAM_URL não configurado em src/content/site.js.\n' +
            '       Os botões de contato estão sem destino. O site NÃO está pronto para publicação.\n';
          (isBuild ? console.warn : console.log)(msg);
        }
        const site = SITE_URL.replace(/\/$/, '');
        const pendingNote = url
          ? ''
          : '<p class="pending-note" role="note">Endereço do Telegram pendente de configuração.</p>';
        return html
          .replaceAll('{{telegram}}', telegramAttrs(url))
          .replaceAll('{{icon-telegram}}', ICON_TELEGRAM)
          .replaceAll('{{telegram-pending-note}}', pendingNote)
          .replace('{{offers}}', offersMarkup(url))
          .replaceAll('data-monogram d=""', `d="${monogramSvgPath()}" fill-rule="evenodd"`)
          .replaceAll('{{year}}', String(new Date().getFullYear()))
          .replace('{{canonical}}', site ? `<link rel="canonical" href="${esc(site)}/">` : '')
          .replace('{{og-url}}', site ? `<meta property="og:url" content="${esc(site)}/">` : '')
          .replaceAll('{{og-image}}', `${site}/img/og-bruno.jpg`);
      },
    },
  };
}

export default defineConfig({
  plugins: [sitePlugin()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    rollupOptions: { input: 'index.html' },
  },
  server: { port: 5173 },
});

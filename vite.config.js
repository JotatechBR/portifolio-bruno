import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import {
  CAKTO_CHECKOUT_URL,
  ACCESS_POLICY,
  PRICE_LABEL,
  PRICE_FALLBACK,
  ACCESS_PATH,
  TELEGRAM_URL,
  SITE_URL,
  GA4_MEASUREMENT_ID,
  CTA,
  CTA_POSITIONS,
  COPY,
  NAV,
  TICKER_MESSAGES,
  BENEFITS,
  FIT,
  STEPS,
  OFFER_INCLUDES,
  FAQ,
  TESTIMONIALS,
  LEGAL_LINKS,
} from './src/content/site.js';
import { monogramSvgPath, B_OUTER, B_COUNTERS, B_HEIGHT } from './src/three/monogram-shape.js';

const TELEGRAM_PATTERN = /^https:\/\/(t\.me|telegram\.me)\/[A-Za-z0-9_+\-/]+$/;
// convite de grupo (t.me/+..., joinchat): nunca pode ir para o site público
const INVITE_PATTERN = /(t\.me|telegram\.me)\/(\+|joinchat\/?)/i;
const CHECKOUT_HOST = 'pay.cakto.com.br';

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Texto com quebras intencionais: "\n" vira <br>.
const lines = (s) => esc(s).replace(/\n/g, '<br> ');

export function validateTelegram(url, label) {
  if (!url) return '';
  if (INVITE_PATTERN.test(url)) {
    throw new Error(`[site] ${label}: convites de grupo não podem ficar no site; use o contato pessoal (https://t.me/usuario)`);
  }
  if (!TELEGRAM_PATTERN.test(url)) {
    throw new Error(`[site] ${label}: "${url}" não é um endereço válido do Telegram (use https://t.me/...)`);
  }
  return url;
}

// Checkout: só HTTPS em pay.cakto.com.br, sem usuário/senha, porta, fragmento ou URL malformada.
export function validateCheckout(url, label = 'CAKTO_CHECKOUT_URL') {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`[site] ${label}: "${url}" não é uma URL válida`);
  }
  if (u.protocol !== 'https:' || u.hostname !== CHECKOUT_HOST || u.username || u.password || u.port || u.hash || u.search || u.href !== url) {
    throw new Error(`[site] ${label}: "${url}" precisa ser um checkout https://${CHECKOUT_HOST}/...`);
  }
  return url;
}

// Caminho interno: absoluto e sem host (bloqueia javascript:, //host etc.).
function validatePath(path, label = 'ACCESS_PATH') {
  if (!/^\/[a-z0-9\-/]*$/.test(path) || path.startsWith('//')) throw new Error(`[site] ${label} inválido: "${path}"`);
  return path;
}

// Atributos de todo CTA de compra: mesmo destino, marcado com a posição (evento checkout_click).
// O checkout é gravado direto no HTML e não depende de TELEGRAM_URL.
export function checkoutAttrs(position) {
  if (!CTA_POSITIONS.includes(position)) throw new Error(`[site] posição de CTA desconhecida: "${position}"`);
  return `href="${esc(validateCheckout(CAKTO_CHECKOUT_URL))}" data-action-kind="purchase" data-cta-position="${position}"`;
}

// Só depoimentos reais e autorizados chegam à página.
export function publishableTestimonials(list = TESTIMONIALS) {
  return list.filter(
    (t) => t && t.verified === true && t.authorized === true && typeof t.quote === 'string' && t.quote.trim() && typeof t.name === 'string' && t.name.trim()
  );
}

const ICON_ARROW =
  '<svg class="icon icon--arrow" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 10h11m0 0-4.5-4.5M15 10l-4.5 4.5" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ICON_LOCK =
  '<svg class="icon icon--lock" viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false"><rect x="4" y="9" width="12" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';
const ICON_PLUS =
  '<svg class="faq-item__icon" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><path d="M4 10h12" stroke="currentColor" stroke-width="1.6"/><path class="faq-item__icon-v" d="M10 4v12" stroke="currentColor" stroke-width="1.6"/></svg>';

// Monograma: corpo em cor do texto, contraformas em vermelho (mesmos dados do modelo 3D).
function markSvg() {
  const toPath = (pts) => 'M' + pts.map(([x, y]) => `${+x.toFixed(3)} ${+(B_HEIGHT - y).toFixed(3)}`).join('L') + 'Z';
  return `<svg class="mark" viewBox="0 0 1.4 2" width="21" height="30" aria-hidden="true" focusable="false"><path class="mark__body" d="${toPath(B_OUTER)}${B_COUNTERS.map(toPath).join('')}" fill-rule="evenodd"/><path class="mark__counter" d="${B_COUNTERS.map(toPath).join('')}"/></svg>`;
}

// ---------------------------------------------------------------- blocos gerados

const TEXT = { cta: CTA, ...COPY };
function text(path) {
  const v = path.split('.').reduce((o, k) => (o == null ? o : o[k]), TEXT);
  if (typeof v !== 'string') throw new Error(`[site] texto ausente em site.js: ${path}`);
  // "A • B": a quebra só acontece no separador, nunca dentro de um segmento
  if (v.includes(' • ')) return v.split(' • ').map((seg) => `<span class="nowrap">${lines(seg)}</span>`).join(' • ');
  return lines(v);
}

function tickerMarkup() {
  const items = (hidden) =>
    TICKER_MESSAGES.map((m) => `<li class="ticker__item">${esc(m)}</li>`).join('');
  return `<div class="ticker" role="region" aria-label="Avisos" data-ticker>
    <div class="ticker__viewport">
      <div class="ticker__track" data-ticker-track>
        <ul class="ticker__group" data-ticker-group>${items()}</ul>
        <ul class="ticker__group" aria-hidden="true" data-ticker-clone>${items(true)}</ul>
      </div>
    </div>
  </div>`;
}

const navItems = (attrs = '') => NAV.map((n) => `<li><a href="${esc(n.href)}"${attrs}>${esc(n.label)}</a></li>`).join('\n          ');

const benefitsMarkup = () =>
  BENEFITS.map(
    (b) => `<li class="benefit reveal">
            <span class="benefit__index" aria-hidden="true">${esc(b.index)}</span>
            <h3 class="benefit__title">${esc(b.title)}</h3>
            <p class="benefit__text">${esc(b.text)}</p>
          </li>`
  ).join('\n          ');

const listItems = (arr) => arr.map((s) => `<li>${esc(s)}</li>`).join('\n              ');

const stepsMarkup = () =>
  STEPS.map(
    (s, i) => `<li class="step reveal">
            <span class="step__num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
            <h3 class="step__title">${esc(s.title)}</h3>
            <p class="step__text">${esc(s.text)}</p>
          </li>`
  ).join('\n          ');

// Sem JS as respostas ficam abertas (aria-expanded="true"); o módulo faq.js recolhe.
const faqMarkup = () =>
  FAQ.map(
    (f, i) => `<div class="faq-item">
            <h3 class="faq-item__q">
              <button type="button" id="faq-q-${i + 1}" aria-expanded="true" aria-controls="faq-a-${i + 1}" data-faq-trigger>
                <span>${esc(f.q)}</span>${ICON_PLUS}
              </button>
            </h3>
            <div class="faq-item__a" id="faq-a-${i + 1}" role="region" aria-labelledby="faq-q-${i + 1}" data-faq-panel>
              <p>${esc(f.a)}</p>
            </div>
          </div>`
  ).join('\n          ');

function testimonialsMarkup() {
  const list = publishableTestimonials();
  if (!list.length) return '';
  const items = list
    .map(
      (t) => `<figure class="testimonial">
          <blockquote class="testimonial__quote"><p>${esc(t.quote)}</p></blockquote>
          <figcaption class="testimonial__author"><span>${esc(t.name)}</span>${t.context ? `<span class="testimonial__context">${esc(t.context)}</span>` : ''}</figcaption>
        </figure>`
    )
    .join('\n        ');
  return `<!-- DEPOIMENTOS (somente reais e autorizados) -->
    <section class="testimonials" aria-labelledby="depoimentos-titulo">
      <div class="container">
        <p class="eyebrow reveal">${text('testimonials.eyebrow')}</p>
        <h2 class="section-title reveal" id="depoimentos-titulo">${text('testimonials.title')}</h2>
        <div class="testimonials__track"${list.length > 1 ? ' tabindex="0" aria-label="Depoimentos: role para o lado para ver os demais"' : ''}>
        ${items}
        </div>
      </div>
    </section>`;
}

function priceMarkup() {
  return PRICE_LABEL
    ? `<p class="offer__price"><span class="offer__price-value">${esc(PRICE_LABEL)}</span><span class="offer__price-note">pagamento único</span></p>`
    : `<p class="offer__price offer__price--pending">${esc(PRICE_FALLBACK)}</p>`;
}

const legalLinks = () =>
  LEGAL_LINKS.map((l) => `<li><a class="text-link" href="${esc(validatePath(l.href, 'LEGAL_LINKS'))}">${esc(l.label)}</a></li>`).join('\n            ');

function contactMarkup(url) {
  return url ? `<li><a href="${esc(url)}" data-action-kind="contact" rel="noopener">Falar com o Bruno</a></li>` : '';
}

function ga4Markup() {
  if (!GA4_MEASUREMENT_ID) return '';
  if (!/^G-[A-Z0-9]{4,16}$/.test(GA4_MEASUREMENT_ID)) throw new Error(`[site] GA4_MEASUREMENT_ID inválido: ${GA4_MEASUREMENT_ID}`);
  const id = GA4_MEASUREMENT_ID;
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`;
}

// Monta qualquer página a partir dos marcadores {{...}}; marcador desconhecido interrompe o build.
export function renderPage(html) {
  const url = validateTelegram(TELEGRAM_URL, 'TELEGRAM_URL');
  if (ACCESS_POLICY !== 'lifetime') throw new Error('[site] a página anuncia acesso vitalício: ACCESS_POLICY precisa ser "lifetime"');
  const site = SITE_URL.replace(/\/$/, '');
  const mark = markSvg();
  const out = html
    .replace(/\{\{checkout:([a-z_]+)\}\}/g, (_, pos) => checkoutAttrs(pos))
    .replace(/\{\{t:([a-zA-Z.]+)\}\}/g, (_, p) => text(p))
    .replaceAll('{{meta-title}}', esc(COPY.meta.title))
    .replaceAll('{{meta-description}}', esc(COPY.meta.description))
    .replace('{{ga4}}', ga4Markup())
    .replace('{{ticker}}', tickerMarkup())
    .replaceAll('{{mark}}', mark)
    .replace('{{nav}}', navItems())
    .replace('{{nav-mobile}}', navItems(' data-menu-link'))
    .replace('{{nav-footer}}', navItems())
    .replace('{{tension-highlight}}', COPY.tension.highlight.map((s) => `<span>${esc(s)}</span>`).join(' '))
    .replace('{{benefits}}', benefitsMarkup())
    .replace('{{fit-yes}}', listItems(FIT.yes))
    .replace('{{fit-no}}', listItems(FIT.no))
    .replace('{{steps}}', stepsMarkup())
    .replace('{{testimonials}}', testimonialsMarkup())
    .replace('{{offer-includes}}', listItems(OFFER_INCLUDES))
    .replace('{{price}}', priceMarkup())
    .replace('{{faq}}', faqMarkup())
    .replaceAll('{{legal-links}}', legalLinks())
    .replace('{{contact}}', contactMarkup(url))
    .replaceAll('{{access-path}}', esc(validatePath(ACCESS_PATH)))
    .replaceAll('{{icon-arrow}}', ICON_ARROW)
    .replaceAll('{{icon-lock}}', ICON_LOCK)
    .replaceAll('data-monogram d=""', `d="${monogramSvgPath()}" fill-rule="evenodd"`)
    .replaceAll('{{year}}', String(new Date().getFullYear()))
    .replace('{{canonical}}', site ? `<link rel="canonical" href="${esc(site)}/">` : '')
    .replace('{{og-url}}', site ? `<meta property="og:url" content="${esc(site)}/">` : '')
    .replaceAll('{{og-image}}', `${site}/img/og-bruno.jpg`);
  const left = out.match(/\{\{[^}]*\}\}/);
  if (left) throw new Error(`[site] marcador não resolvido: ${left[0]}`);
  assertNoInvite(out, 'HTML');
  return out;
}

function assertNoInvite(source, label) {
  if (INVITE_PATTERN.test(source)) throw new Error(`[site] ${label} contém um convite de grupo do Telegram; remova-o`);
}

function sitePlugin() {
  return {
    name: 'bruno-site-content',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const file = ctx.filename.replace(/\\/g, '/');
        if (file.includes('/tools/')) return html;
        // página de ativação: só dados públicos (ano); sem conteúdo comercial
        if (file.endsWith('/acesso/index.html')) return html.replaceAll('{{year}}', String(new Date().getFullYear()));
        return renderPage(html);
      },
    },
    // Nada do bundle (JS, CSS, HTML) pode carregar um convite do grupo.
    generateBundle(_, bundle) {
      for (const item of Object.values(bundle)) {
        const src = item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : '';
        assertNoInvite(src, item.fileName);
      }
    },
  };
}

// Proxy local de /api para o servidor Node (server.js). O destino só muda pela variável local
// API_PORT e é sempre 127.0.0.1: nunca uma URL externa.
const apiPort = Number(process.env.API_PORT || 3000);
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) throw new Error(`API_PORT inválida: ${process.env.API_PORT}`);
const apiProxy = { '/api': { target: `http://127.0.0.1:${apiPort}` } };

const page = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [sitePlugin()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 0,
    // Vite 8 usa Rolldown: home, ativação e páginas institucionais
    rolldownOptions: {
      input: {
        main: page('./index.html'),
        acesso: page('./acesso/index.html'),
        termos: page('./termos/index.html'),
        privacidade: page('./privacidade/index.html'),
        reembolso: page('./reembolso/index.html'),
      },
    },
  },
  server: { port: 5173, proxy: apiProxy },
  preview: { proxy: apiProxy },
});

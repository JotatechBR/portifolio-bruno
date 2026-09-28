// CTAs de compra e ativação: preserva só utm_* da URL atual no checkout e registra eventos
// no GA4 quando ele estiver carregado. Sem JS, os links continuam indo direto ao checkout.

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
const MAX_UTM_LENGTH = 150;

// Métricas nunca bloqueiam a navegação: qualquer falha é ignorada.
export function track(name, params = {}) {
  try {
    if (typeof window.gtag === 'function') window.gtag('event', name, params);
  } catch {
    /* sem métricas */
  }
}

// Somente os cinco parâmetros UTM conhecidos, com valor de texto curto.
export function pickUtms(search) {
  const from = new URLSearchParams(search);
  const out = new URLSearchParams();
  for (const key of UTM_KEYS) {
    const value = from.get(key);
    if (value && value.length <= MAX_UTM_LENGTH) out.set(key, value);
  }
  return out;
}

export function withUtms(href, utms) {
  if (![...utms.keys()].length) return href;
  const url = new URL(href);
  for (const [k, v] of utms) url.searchParams.set(k, v);
  return url.toString();
}

export function initCheckout() {
  const utms = pickUtms(location.search);
  const links = document.querySelectorAll('a[data-action-kind="purchase"]');
  for (const a of links) {
    const base = a.getAttribute('href');
    if (!base || !base.startsWith('https://pay.cakto.com.br/')) continue;
    a.href = withUtms(base, utms);
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[data-action-kind]');
    if (!a) return;
    const kind = a.dataset.actionKind;
    if (kind === 'purchase') track('checkout_click', { cta_position: a.dataset.ctaPosition || 'unknown' });
    else if (kind === 'access') track('activation_click');
  });
}

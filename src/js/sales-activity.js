// Faixa superior. O HTML já traz as mensagens institucionais (funciona sem JS).
// Aqui: velocidade constante, pausa fora da tela e, se o backend devolver compras REAIS
// aprovadas (webhook da Cakto), acrescenta "Novo acesso confirmado • há X".
// Nada é inventado no navegador: sem eventos válidos, ficam só as mensagens fixas.

const ENDPOINT = '/api/social-proof/recent';
const SPEED_PX_S = 38;
const LABEL = /^há (\d{1,2} min|\d{1,2} h|1 dia|2 dias)$/;

export function parseEvents(data) {
  if (!Array.isArray(data)) return [];
  return data
    .slice(0, 5)
    .filter((e) => e && e.type === 'access_approved' && typeof e.timeLabel === 'string' && LABEL.test(e.timeLabel))
    .map((e) => `Novo acesso confirmado • ${e.timeLabel}`);
}

async function fetchEvents() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(ENDPOINT, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return [];
    return parseEvents(await res.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function initSalesActivity() {
  const root = document.querySelector('[data-ticker]');
  if (!root) return;
  const track = root.querySelector('[data-ticker-track]');
  const group = root.querySelector('[data-ticker-group]');
  const clone = root.querySelector('[data-ticker-clone]');

  // duração proporcional à largura: a velocidade não muda com o número de mensagens
  const pace = () => {
    const w = group.scrollWidth;
    if (w) track.style.setProperty('--ticker-duration', `${Math.round(w / SPEED_PX_S)}s`);
  };
  pace();
  new ResizeObserver(pace).observe(group);

  // pausa quando a faixa sai da tela ou a aba fica oculta
  let onScreen = true;
  const sync = () => root.classList.toggle('is-paused', !onScreen || document.hidden);
  new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    sync();
  }).observe(root);
  document.addEventListener('visibilitychange', sync);

  const load = async () => {
    const live = await fetchEvents();
    if (!live.length) return;
    const fixed = [...group.querySelectorAll('.ticker__item:not(.ticker__item--live)')].map((li) => li.textContent);
    const build = (ul) => {
      ul.replaceChildren(
        ...live.map((t) => item(t, true)),
        ...fixed.map((t) => item(t, false))
      );
    };
    build(group);
    build(clone);
    pace();
  };
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 800));
  idle(load, { timeout: 3000 });
}

function item(text, live) {
  const li = document.createElement('li');
  li.className = live ? 'ticker__item ticker__item--live' : 'ticker__item';
  li.textContent = text;
  return li;
}

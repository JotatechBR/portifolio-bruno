// Cabeçalho integrado ao hero: transparente no topo, fundo escuro discreto depois de rolar
// (quando a faixa superior sai da tela e o cabeçalho fica preso no topo).
export function initHeader() {
  const header = document.querySelector('[data-header]');
  if (!header) return;
  const sentinel = document.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:48px;pointer-events:none';
  document.body.prepend(sentinel);
  new IntersectionObserver(([entry]) => {
    header.classList.toggle('is-solid', !entry.isIntersecting);
  }).observe(sentinel);
}

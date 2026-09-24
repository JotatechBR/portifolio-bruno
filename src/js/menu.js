// Menu móvel em <dialog> modal: foco preso, fundo inerte, Esc fecha e o foco volta ao acionador.
// Sem JS, o acionador é um link comum para a navegação do rodapé.
export function initMenu() {
  const toggle = document.querySelector('[data-menu-toggle]');
  const dialog = document.querySelector('[data-menu]');
  if (!toggle || !dialog || typeof dialog.showModal !== 'function') return;

  toggle.setAttribute('role', 'button');
  toggle.setAttribute('aria-haspopup', 'dialog');
  toggle.setAttribute('aria-expanded', 'false');

  const open = () => {
    dialog.showModal();
    toggle.setAttribute('aria-expanded', 'true');
  };
  const close = () => dialog.close();

  toggle.addEventListener('click', (e) => {
    e.preventDefault();
    open();
  });
  toggle.addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      open();
    }
  });
  dialog.querySelector('[data-menu-close]')?.addEventListener('click', close);

  // clique fora do conteúdo (no backdrop) fecha
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) close();
    }
  });

  let pendingHash = null;
  dialog.querySelectorAll('[data-menu-link]').forEach((a) => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      pendingHash = a.getAttribute('href');
      close();
    });
  });

  dialog.addEventListener('close', () => {
    toggle.setAttribute('aria-expanded', 'false');
    if (pendingHash) {
      const target = document.querySelector(pendingHash);
      history.pushState(null, '', pendingHash);
      pendingHash = null;
      if (target) {
        target.scrollIntoView();
        const heading = target.querySelector('h2, h1');
        if (heading) {
          heading.setAttribute('tabindex', '-1');
          heading.focus({ preventScroll: true });
        }
      }
    } else {
      toggle.focus();
    }
  });

  // se a janela crescer para o layout de desktop com o menu aberto
  matchMedia('(min-width: 900px)').addEventListener('change', (e) => {
    if (e.matches && dialog.open) close();
  });
}

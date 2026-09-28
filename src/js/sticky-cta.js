// CTA fixo no mobile: aparece depois do hero e some quando outro CTA de compra ou o rodapé
// estão na tela (hero, oferta, CTA final e rodapé). Fora do mobile fica sempre oculto.
export function initStickyCta() {
  const bar = document.querySelector('[data-sticky-cta]');
  if (!bar || !('IntersectionObserver' in window)) return;
  const mobile = matchMedia('(max-width: 899px)');
  const blockers = ['[data-hero]', '[data-offer]', '.final', '#rodape']
    .map((s) => document.querySelector(s))
    .filter(Boolean);
  const visible = new Set();

  bar.hidden = false;
  const update = () => {
    const show = mobile.matches && visible.size === 0;
    bar.classList.toggle('is-visible', show);
    bar.inert = !show;
    document.body.classList.toggle('has-sticky-cta', mobile.matches);
  };

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting) visible.add(e.target);
      else visible.delete(e.target);
    }
    update();
  });
  blockers.forEach((el) => io.observe(el));
  mobile.addEventListener('change', update);
  update();
}

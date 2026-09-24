// Entradas discretas. O conteúdo é visível por padrão: a classe que esconde só é aplicada
// aqui, e somente em elementos que ainda estão fora da tela.
export function initReveal() {
  if (!('IntersectionObserver' in window)) return;
  const items = [...document.querySelectorAll('.reveal')];
  const vh = window.innerHeight;
  const below = items.filter((el) => el.getBoundingClientRect().top > vh * 0.92);
  items.filter((el) => !below.includes(el)).forEach((el) => el.classList.add('is-in'));
  if (!below.length) return;

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px' }
  );
  document.documentElement.classList.add('js-reveal');
  below.forEach((el) => io.observe(el));
}

// Melhoria progressiva: carrega a cena 3D do hero só quando a página já está utilizável,
// o hero está visível e o dispositivo permite. A imagem continua como base e como fallback.
export function initHero3D() {
  const stage = document.querySelector('[data-hero-stage]');
  if (!stage) return;

  const desktop = matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const conn = navigator.connection;
  const lowData = conn && (conn.saveData || /(^|-)2g$/.test(conn.effectiveType || ''));
  const lowMemory = navigator.deviceMemory && navigator.deviceMemory < 4;
  if (!desktop.matches || reduced.matches || lowData || lowMemory) return;

  const hasWebGL = (() => {
    try {
      const c = document.createElement('canvas');
      return !!c.getContext('webgl2');
    } catch {
      return false;
    }
  })();
  if (!hasWebGL) return;

  const start = () => {
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      import('../three/hero-scene.js')
        .then((m) => m.mountHeroScene(stage))
        .catch(() => {
          /* mantém a imagem */
        });
    });
    io.observe(stage);
  };

  const idle = () => ('requestIdleCallback' in window ? requestIdleCallback(start, { timeout: 2500 }) : setTimeout(start, 600));
  if (document.readyState === 'complete') idle();
  else addEventListener('load', idle, { once: true });
}

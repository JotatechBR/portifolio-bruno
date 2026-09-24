// Cena interativa do hero. Mesmo palco, câmera e modelo usados nos stills.
import { WebGLRenderer, MathUtils } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildStage, configureRenderer, makeCamera, HERO_POSE, fitContactShadow } from './stage.js';
import { prepareMonogram } from './prepare.js';

const MAX_TILT = MathUtils.degToRad(6);

export async function mountHeroScene(stageEl) {
  const canvas = document.createElement('canvas');
  canvas.className = 'hero__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('role', 'presentation');

  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  configureRenderer(renderer);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

  const stage = buildStage({ renderer, shadowMapSize: 1024 });
  const camera = makeCamera('hero');

  const gltf = await new GLTFLoader()
    .setMeshoptDecoder(MeshoptDecoder)
    .loadAsync(`${import.meta.env.BASE_URL}models/monogram.glb`);
  const model = prepareMonogram(gltf.scene);
  model.position.set(HERO_POSE.x, HERO_POSE.y, HERO_POSE.z);
  model.rotation.y = HERO_POSE.rotY;
  stage.scene.add(model);
  fitContactShadow(stage.contact, { width: 2.2, depth: 0.9, rotY: HERO_POSE.rotY });

  let disposed = false;
  let visible = true;
  let raf = 0;
  const target = { x: 0, y: 0 };
  const current = { x: 0, y: 0 };

  const resize = () => {
    const { width, height } = stageEl.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const draw = () => {
    model.rotation.y = HERO_POSE.rotY + current.y;
    model.rotation.x = current.x;
    renderer.render(stage.scene, camera);
  };

  const tick = () => {
    raf = 0;
    current.x += (target.x - current.x) * 0.08;
    current.y += (target.y - current.y) * 0.08;
    draw();
    const settled = Math.abs(target.x - current.x) < 1e-4 && Math.abs(target.y - current.y) < 1e-4;
    if (!settled && visible && !document.hidden) raf = requestAnimationFrame(tick);
  };
  const wake = () => {
    if (!raf && !disposed && visible && !document.hidden) raf = requestAnimationFrame(tick);
  };

  // Primeiro quadro: só troca a imagem depois de renderizar corretamente.
  resize();
  draw();
  const gl = renderer.getContext();
  if (gl.isContextLost()) return teardown();
  stageEl.appendChild(canvas);
  requestAnimationFrame(() => stageEl.classList.add('is-3d'));

  const onPointer = (e) => {
    const nx = (e.clientX / innerWidth) * 2 - 1;
    const ny = (e.clientY / innerHeight) * 2 - 1;
    target.y = nx * MAX_TILT;
    target.x = ny * MAX_TILT * 0.5;
    wake();
  };
  const onLeave = () => {
    target.x = target.y = 0;
    wake();
  };
  const hero = stageEl.closest('.hero') || document.body;
  hero.addEventListener('pointermove', onPointer, { passive: true });
  hero.addEventListener('pointerleave', onLeave);

  const ro = new ResizeObserver(() => {
    resize();
    draw();
  });
  ro.observe(stageEl);

  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) wake();
  });
  io.observe(stageEl);
  const onVis = () => !document.hidden && wake();
  document.addEventListener('visibilitychange', onVis);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const onReduced = () => reduced.matches && teardown();
  reduced.addEventListener('change', onReduced);

  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    teardown();
  });

  function teardown() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    stageEl.classList.remove('is-3d');
    hero.removeEventListener('pointermove', onPointer);
    hero.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('visibilitychange', onVis);
    reduced.removeEventListener('change', onReduced);
    ro.disconnect();
    io.disconnect();
    stage.scene.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        [].concat(o.material).forEach((m) => {
          for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
          m.dispose();
        });
      }
    });
    stage.envRT.dispose();
    renderer.dispose();
    setTimeout(() => canvas.remove(), 600);
  }
  return teardown;
}

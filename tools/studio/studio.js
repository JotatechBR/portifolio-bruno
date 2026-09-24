// Estúdio: monta a cena compartilhada, renderiza stills e exporta o GLB do monograma.
import { WebGLRenderer, Vector3, PerspectiveCamera, Box3 } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildStage, configureRenderer, makeCamera, HERO_POSE, fitContactShadow } from '../../src/three/stage.js';
import { prepareMonogram } from '../../src/three/prepare.js';
import { buildMonogram, buildChipComposition } from './build-models.js';

const params = new URLSearchParams(location.search);
const canvas = document.createElement('canvas');
document.body.prepend(canvas);
const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
configureRenderer(renderer);
renderer.setPixelRatio(1);

const stage = buildStage({ renderer, shadowMapSize: 4096 });
let monogram;
let chips;

async function loadMonogram() {
  const url = params.get('model');
  if (!url) return buildMonogram();
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(url);
  return gltf.scene;
}

function placeHero() {
  monogram.position.set(HERO_POSE.x, HERO_POSE.y, HERO_POSE.z);
  monogram.rotation.y = HERO_POSE.rotY;
  fitContactShadow(stage.contact, { width: 2.2, depth: 0.9, rotY: HERO_POSE.rotY });
}

const extraShots = {
  detail() {
    const target = monogram.localToWorld(new Vector3(0.3, 1.58, 0));
    const pos = monogram.localToWorld(new Vector3(1.6, 2.55, 2.05));
    return { aspect: 16 / 10, fov: 22, pos: pos.toArray(), target: target.toArray() };
  },
  chips: () => ({ aspect: 16 / 10, fov: 20, pos: [0.9, 2.3, 4.2], target: [0.42, 0.06, 0.12] }),
  og: () => ({ aspect: 1200 / 630, fov: 21, pos: [-1.55, 1.55, 8.2], target: [-1.95, 0.98, 0] }),
};

window.studio = {
  ready: (async () => {
    monogram = await loadMonogram();
    prepareMonogram(monogram);
    stage.scene.add(monogram);
    placeHero();
    chips = buildChipComposition();
  })(),

  async exportGLB() {
    const src = buildMonogram();
    const exporter = new GLTFExporter();
    const buf = await exporter.parseAsync(src, { binary: true });
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },

  render(shotName, width, height) {
    const isChips = shotName === 'chips';
    monogram.visible = !isChips;
    if (isChips) {
      stage.scene.add(chips);
      fitContactShadow(stage.contact, { x: 0.45, z: 0.15, width: 2.4, depth: 1.6 });
    } else {
      stage.scene.remove(chips);
      placeHero();
    }
    const shot = extraShots[shotName] ? extraShots[shotName]() : shotName;
    const cam = makeCamera(shot);
    renderer.setSize(width, height, false);
    cam.aspect = width / height;
    cam.updateProjectionMatrix();
    renderer.render(stage.scene, cam);
    return canvas.toDataURL('image/png');
  },
};

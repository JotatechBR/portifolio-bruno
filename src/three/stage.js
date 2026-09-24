// Palco compartilhado entre o estúdio de render (tools/studio) e o hero interativo.
// Mesma luz, ambiente, piso e câmeras: a imagem estática e a cena 3D batem quadro a quadro.
import {
  Scene,
  Color,
  PerspectiveCamera,
  Mesh,
  PlaneGeometry,
  BoxGeometry,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SpotLight,
  PMREMGenerator,
  CanvasTexture,
  SRGBColorSpace,
  NeutralToneMapping,
  PCFShadowMap,
  BackSide,
  Vector3,
  Fog,
} from 'three';

export const BG = 0x080808;

// Pose do monograma no palco (radianos / unidades de cena)
export const HERO_POSE = { x: 0, y: 0, z: 0, rotY: -0.46 };

// Câmeras: posição, alvo, fov vertical e proporção do quadro
export const SHOTS = {
  hero: { aspect: 1, fov: 21, pos: [0.35, 1.7, 8.2], target: [-0.05, 0.98, 0] },
  mobile: { aspect: 4 / 3, fov: 21, pos: [0.2, 1.55, 7.1], target: [-0.42, 0.95, 0] },
};

export function configureRenderer(renderer) {
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setClearColor(BG, 1);
}

// Estúdio virtual: caixa escura com softboxes emissivos, convertido em mapa PMREM.
// Os softboxes desenham os reflexos amplos no metal; nenhum arquivo HDR é baixado.
function buildEnvScene() {
  const env = new Scene();
  const room = new Mesh(
    new BoxGeometry(24, 14, 24),
    new MeshBasicMaterial({ color: new Color(0.012, 0.011, 0.012), side: BackSide })
  );
  room.position.y = 5;
  env.add(room);

  const panel = (w, h, color, k, pos, look = [0, 1, 0]) => {
    const m = new Mesh(
      new PlaneGeometry(w, h),
      new MeshBasicMaterial({ color: new Color(...color).multiplyScalar(k) })
    );
    m.position.set(...pos);
    m.lookAt(new Vector3(...look));
    env.add(m);
  };
  // softbox principal, frontal-esquerdo e alto
  panel(6, 3.4, [1, 0.97, 0.95], 3.2, [-5, 5.5, 5.5]);
  // softbox vertical na direção do reflexo da face frontal: desenha o gradiente no metal
  panel(4.2, 5.5, [1, 0.98, 0.97], 2.6, [-7.2, 3.6, 6.2]);
  // faixa superior difusa
  panel(9, 1.4, [1, 1, 1], 1.4, [0, 9, -1]);
  // recorte lateral vinho/vermelho, atrás à direita
  panel(1.4, 7, [0.7, 0.04, 0.1], 1.1, [7, 2.5, -4]);
  // contra-recorte vinho, à esquerda, mais fraco
  panel(1.0, 5, [0.55, 0.05, 0.11], 1.6, [-8, 2, -3]);
  // rebatedor frio e baixo à frente
  panel(8, 1.2, [0.85, 0.84, 0.86], 0.35, [0, 0.6, 9]);
  return env;
}

export function buildEnvironment(renderer) {
  const pmrem = new PMREMGenerator(renderer);
  const envScene = buildEnvScene();
  const rt = pmrem.fromScene(envScene, 0.03);
  envScene.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      o.material.dispose();
    }
  });
  pmrem.dispose();
  return rt;
}

// Sombra de contato: textura radial gerada em canvas, multiplicada sobre o piso.
function contactShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 8, 128, 128, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.9)');
  grd.addColorStop(0.35, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

export function buildStage({ renderer, shadowMapSize = 1024 }) {
  const scene = new Scene();
  scene.background = new Color(BG);
  // o piso se dissolve no fundo preto (sem linha de horizonte), como um fundo infinito de estúdio
  scene.fog = new Fog(BG, 10.5, 17);
  const envRT = buildEnvironment(renderer);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 1;

  // piso de grafite
  const floor = new Mesh(
    new PlaneGeometry(60, 60),
    new MeshStandardMaterial({ color: 0x18181b, roughness: 0.62, metalness: 0, envMapIntensity: 0.12 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // luz principal suave de estúdio (a única que projeta sombra)
  const key = new SpotLight(0xffffff, 650, 0, 0.42, 1, 2);
  key.position.set(-3.6, 6.2, 4.6);
  key.target.position.set(0.1, 0.4, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  key.shadow.camera.near = 4;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 6;
  scene.add(key, key.target);

  // recorte lateral vinho/vermelho
  const rim = new SpotLight(0xe0183a, 30, 0, 0.28, 0.8, 2);
  rim.position.set(4.2, 4.6, -3.8);
  rim.target.position.set(0, 1.5, 0);
  scene.add(rim, rim.target);

  const contact = new Mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({ map: contactShadowTexture(), transparent: true, depthWrite: false, toneMapped: false })
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = 0.002;
  contact.renderOrder = 1;
  scene.add(contact);

  return { scene, floor, key, rim, contact, envRT };
}

// Posiciona a sombra de contato sob um objeto de pegada retangular.
export function fitContactShadow(contact, { x = 0, z = 0, width, depth, rotY = 0 }) {
  contact.position.x = x;
  contact.position.z = z;
  contact.rotation.z = rotY;
  contact.scale.set(width, depth, 1);
}

export function makeCamera(shot) {
  const s = SHOTS[shot] || shot;
  const cam = new PerspectiveCamera(s.fov, s.aspect, 0.1, 80);
  cam.position.set(...s.pos);
  cam.lookAt(new Vector3(...s.target));
  return cam;
}

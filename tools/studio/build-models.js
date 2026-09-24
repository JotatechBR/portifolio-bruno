// Construção procedural dos modelos (somente no estúdio).
// O monograma é exportado em GLB; as fichas são usadas apenas nos renders.
import {
  Group,
  Mesh,
  Shape,
  Path,
  ExtrudeGeometry,
  LatheGeometry,
  CylinderGeometry,
  Vector2,
  MeshPhysicalMaterial,
  Color,
  CanvasTexture,
  RepeatWrapping,
  LinearMipmapLinearFilter,
  LinearFilter,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { B_OUTER, B_COUNTERS, B_WIDTH, insetPolygon } from '../../src/three/monogram-shape.js';

const shapeFrom = (pts, holes = []) => {
  const s = new Shape(pts.map(([x, y]) => new Vector2(x, y)));
  for (const h of holes) s.holes.push(new Path([...h].reverse().map(([x, y]) => new Vector2(x, y))));
  return s;
};

// Textura sutil de usinagem: linhas finas de fresagem em rugosidade (canal G do glTF).
function machiningTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rows = new Float32Array(size).map(() => rnd());
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const line = 0.5 + 0.5 * Math.sin((y / size) * Math.PI * 2 * 64);
      const v = 0.9 + 0.06 * line + 0.05 * (rows[y] - 0.5) + 0.03 * (rnd() - 0.5);
      data[i] = 255; // oclusão
      data[i + 1] = Math.max(0, Math.min(255, v * 255)); // rugosidade (multiplicador)
      data[i + 2] = 255; // metalicidade
      data[i + 3] = 255;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.buffer), size, size), 0, 0);
  const t = new CanvasTexture(canvas);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function monogramMaterials() {
  const machining = machiningTexture();
  machining.repeat.set(1, 1);
  return {
    // metal preto acetinado (faces)
    face: new MeshPhysicalMaterial({
      name: 'MetalPretoAcetinado',
      color: new Color(0x55525a),
      metalness: 1,
      roughness: 0.3,
      roughnessMap: machining,
    }),
    // laterais em grafite com reflexo mais definido
    side: new MeshPhysicalMaterial({
      name: 'GrafiteUsinado',
      color: new Color(0x7a767e),
      metalness: 1,
      roughness: 0.24,
      roughnessMap: machining,
    }),
    // esmalte vitrificado vermelho
    enamel: new MeshPhysicalMaterial({
      name: 'EsmalteVermelho',
      color: new Color(0x6e0717),
      metalness: 0,
      roughness: 0.42,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
    }),
  };
}

// Dimensões do monograma (unidades de cena)
const FRONT_DEPTH = 0.2;
const BACK_DEPTH = 0.12;
const BEVEL = 0.04;

export function buildMonogram() {
  const mats = monogramMaterials();
  const group = new Group();
  group.name = 'MonogramaB';

  const frontGeo = new ExtrudeGeometry(shapeFrom(B_OUTER, B_COUNTERS), {
    depth: FRONT_DEPTH,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 1,
    curveSegments: 1,
  });
  const backGeo = new ExtrudeGeometry(shapeFrom(B_OUTER), {
    depth: BACK_DEPTH,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 1,
    curveSegments: 1,
  });
  backGeo.translate(0, 0, -BEVEL - BACK_DEPTH - BEVEL);

  // esmalte: preenche as contraformas até 0,035 abaixo da face frontal
  const enamelTop = FRONT_DEPTH + BEVEL - 0.035;
  const enamelGeos = B_COUNTERS.map((c) => {
    const g = new ExtrudeGeometry(shapeFrom(insetPolygon(c, BEVEL + 0.001)), {
      depth: enamelTop + BEVEL - 0.01,
      bevelEnabled: false,
    });
    g.translate(0, 0, -BEVEL + 0.005);
    return g;
  });
  const enamelGeo = mergeGeometries(enamelGeos);

  const front = new Mesh(frontGeo, [mats.face, mats.side]);
  front.name = 'Corpo';
  const back = new Mesh(backGeo, [mats.face, mats.side]);
  back.name = 'Base';
  const enamel = new Mesh(enamelGeo, mats.enamel);
  enamel.name = 'Esmalte';

  // centraliza em x e na profundidade, apoiado no piso (y = 0)
  const zMin = -BEVEL - BACK_DEPTH - 2 * BEVEL;
  const zMax = FRONT_DEPTH + BEVEL;
  const cz = (zMin + zMax) / 2;
  for (const m of [front, back, enamel]) {
    m.geometry.translate(-B_WIDTH / 2, BEVEL, -cz);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  group.userData.depth = zMax - zMin + 2 * BEVEL;
  return group;
}

// ---------- Fichas ----------

// Perfil (raio, altura) da ficha; cada segmento vira uma lathe própria para manter arestas nítidas.
const CHIP_R = 0.5;
const CHIP_H = 0.1;
function chipProfile() {
  const h = CHIP_H / 2;
  return [
    [0, h - 0.008],
    [0.3, h - 0.008],
    [0.312, h],
    [0.415, h],
    [0.43, h - 0.004],
    [0.47, h - 0.004],
    [CHIP_R, h - 0.02],
    [CHIP_R, -h + 0.02],
    [0.47, -h + 0.004],
    [0.43, -h + 0.004],
    [0.415, -h],
    [0.312, -h],
    [0.3, -h + 0.008],
    [0, -h + 0.008],
  ];
}

function chipBodyGeometry() {
  const prof = chipProfile();
  const pieces = [];
  for (let i = 0; i < prof.length - 1; i++) {
    const a = prof[i];
    const b = prof[i + 1];
    // lathe gira em torno de Y; perfil de cima para baixo -> normais para fora
    const pts = [new Vector2(b[0], b[1]), new Vector2(a[0], a[1])];
    const g = new LatheGeometry(pts, 128);
    pieces.push(g);
  }
  return mergeGeometries(pieces.map((g) => g.toNonIndexed()));
}

export function buildChip({ body, accent, engrave }) {
  const g = new Group();
  const bodyMat = new MeshPhysicalMaterial({
    color: new Color(body),
    roughness: 0.42,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.3,
  });
  const accentMat = new MeshPhysicalMaterial({
    color: new Color(accent),
    roughness: 0.4,
    metalness: 0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.3,
  });
  const engraveMat = new MeshPhysicalMaterial({
    color: new Color(engrave),
    roughness: 0.3,
    metalness: 1,
  });

  const bodyMesh = new Mesh(chipBodyGeometry(), bodyMat);
  g.add(bodyMesh);

  // insertos na borda
  const inserts = [];
  for (let i = 0; i < 6; i++) {
    const t0 = (i / 6) * Math.PI * 2;
    const seg = new CylinderGeometry(CHIP_R + 0.0012, CHIP_R + 0.0012, CHIP_H - 0.046, 12, 1, true, t0, 0.3);
    inserts.push(seg);
  }
  g.add(new Mesh(mergeGeometries(inserts), accentMat));

  // anel fino entre a borda e o centro, no topo
  const ring = new Mesh(
    mergeGeometries([
      new LatheGeometry([new Vector2(0.41, CHIP_H / 2 + 0.0008), new Vector2(0.318, CHIP_H / 2 + 0.0008)], 128),
    ]),
    accentMat
  );
  g.add(ring);

  // B gravado em baixo-relevo metálico no centro
  const bShape = shapeFrom(B_OUTER, B_COUNTERS);
  const bGeo = new ExtrudeGeometry(bShape, { depth: 0.004, bevelEnabled: false });
  bGeo.translate(-B_WIDTH / 2, -1, 0);
  bGeo.scale(0.16, 0.16, 1);
  bGeo.rotateX(-Math.PI / 2);
  bGeo.translate(0, CHIP_H / 2 - 0.008, 0);
  g.add(new Mesh(bGeo, engraveMat));

  g.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  g.userData = { radius: CHIP_R, height: CHIP_H };
  return g;
}

export function buildChipComposition() {
  const group = new Group();
  const H = CHIP_H;
  const black = buildChip({ body: 0x121113, accent: 0xa80c24, engrave: 0x8a868c });
  const wine = buildChip({ body: 0x3a0b19, accent: 0x121113, engrave: 0x9a8f95 });
  const red = buildChip({ body: 0x8a0a1e, accent: 0x121113, engrave: 0x1a191b });

  // pilha: preta embaixo, vinho em cima, levemente deslocada e girada
  black.position.set(0, H / 2, 0);
  black.rotation.y = 0.3;
  wine.position.set(0.05, H * 1.5, -0.02);
  wine.rotation.y = 0.12;
  // vermelha deitada no piso, encostada na pilha
  red.position.set(0.95, H / 2, 0.31);
  red.rotation.y = -0.4;
  group.add(black, wine, red);
  return group;
}

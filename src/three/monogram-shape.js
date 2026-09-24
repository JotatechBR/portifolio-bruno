// Monograma B — desenho próprio, construído em polígonos com chanfros a 45°
// (linguagem de peça usinada). Unidades: altura 2.0, origem no canto inferior esquerdo.
// Os mesmos dados geram o modelo 3D (tools/studio) e o SVG usado na página.

export const B_OUTER = [
  [0, 0],
  [1.1, 0],
  [1.4, 0.3],
  [1.4, 0.78],
  [1.18, 1.0],
  [1.3, 1.12],
  [1.3, 1.72],
  [1.02, 2.0],
  [0, 2.0],
];

// Contraformas (preenchidas com esmalte vermelho no modelo)
export const B_COUNTERS = [
  [
    [0.4, 1.22],
    [0.84, 1.22],
    [0.92, 1.3],
    [0.92, 1.6],
    [0.84, 1.68],
    [0.4, 1.68],
  ],
  [
    [0.4, 0.32],
    [0.92, 0.32],
    [1.02, 0.42],
    [1.02, 0.78],
    [0.92, 0.88],
    [0.4, 0.88],
  ],
];

export const B_WIDTH = 1.4;
export const B_HEIGHT = 2.0;

// Recuo de um polígono convexo (anti-horário) por uma distância constante.
export function insetPolygon(points, d) {
  const n = points.length;
  const lines = points.map((p, i) => {
    const q = points[(i + 1) % n];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy);
    const nx = -dy / len; // normal interna para polígono anti-horário
    const ny = dx / len;
    return { p: [p[0] + nx * d, p[1] + ny * d], dir: [dx, dy] };
  });
  return lines.map((l, i) => {
    const prev = lines[(i - 1 + n) % n];
    // interseção de prev e l
    const [x1, y1] = prev.p;
    const [dx1, dy1] = prev.dir;
    const [x2, y2] = l.p;
    const [dx2, dy2] = l.dir;
    const den = dx1 * dy2 - dy1 * dx2;
    const t = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / den;
    return [x1 + dx1 * t, y1 + dy1 * t];
  });
}

// Path SVG (y invertido), viewBox "0 0 1.4 2"
export function monogramSvgPath() {
  const toPath = (pts) =>
    'M' + pts.map(([x, y]) => `${+x.toFixed(3)} ${+(B_HEIGHT - y).toFixed(3)}`).join('L') + 'Z';
  return [B_OUTER, ...B_COUNTERS].map(toPath).join('');
}

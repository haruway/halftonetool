/*
 * dots.js — formatos da retícula (a "forma" de cada ponto/traço).
 *
 * Cada formato é descrito por uma "função de distância com sinal" (SDF):
 *   sdf(u, v, s) -> distância até a borda da tinta, negativa dentro dela.
 *   (u, v) em unidades de célula (1 = altura da célula). A célula pode ser
 *   retangular: largura = aspect (ex.: traços usam células compridas).
 *   s = "tamanho" (0 a sMax).
 * Com a distância em pixels calculamos o anti-aliasing direto.
 *
 * Dois tipos:
 *  - 'cell'  (célula): cada célula tem um ponto de tamanho próprio, e o
 *            render olha os pontos das células vizinhas para eles poderem se
 *            fundir. (u, v) = posição relativa ao centro do PONTO.
 *            Ex.: pontos redondos. Pontos ficam inteiros e redondos.
 *  - 'field' (campo): padrão periódico (linhas, xadrez euclidiano...). O
 *            tamanho é interpolado suavemente entre as células, então uma
 *            linha engrossa e afina contínua, sem degraus. (u, v) = posição
 *            relativa ao centro da célula mais próxima (|u| ≤ aspect/2,
 *            |v| ≤ 0,5); o formato cuida da periodicidade.
 *  - 'solid' (chapada): sem retícula, a tinta é aplicada em tom contínuo.
 *
 * Calibração: o tom pedido é uma ÁREA de tinta. Medimos numericamente qual
 * tamanho s produz qual área (contando a fusão com vizinhos) e invertemos.
 * Assim 30% pedido = 30% impresso em qualquer formato.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.HT = root.HT || {}).dots = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SHAPES = {};
  function register(shape) {
    shape.kind = shape.kind || 'cell';
    shape.aspect = shape.aspect || 1;
    SHAPES[shape.id] = shape;
  }

  // --- Ponto redondo (tipo célula) ---------------------------------------
  // Círculo de raio s. Acima de s = 0,5 encosta nos vizinhos e se funde;
  // em s ≈ 0,707 a célula fica 100% coberta.
  register({
    id: 'round',
    kind: 'cell',
    sMax: 0.75,
    sdf(u, v, s) {
      return Math.sqrt(u * u + v * v) - s;
    },
    // Correção para pontos minúsculos: a borda suavizada "engorda" o
    // círculo em π/12 px²; encolhemos o raio para compensar e, abaixo de
    // ~0,2 px, reduzimos a intensidade. rPx = raio em px -> [raio px, ganho]
    pixelCorrection(rPx) {
      const r2 = rPx * rPx;
      if (r2 >= 1 / 3) return [Math.sqrt(r2 - 1 / 12), 1];
      const k = 3 * r2;
      if (k >= 0.125) return [Math.cbrt(k) - 0.5, 1];
      return [0, k / 0.125];
    },
  });

  // --- Euclidiano / "pontos de impressão" (tipo campo) --------------------
  // Clássico das gráficas: pontos redondos nas luzes, xadrez em 50% e furos
  // redondos nas sombras. Vem das curvas de nível de
  //   spot(u, v) = (cos 2πu + cos 2πv) / 2
  // A tinta ocupa onde spot > limite; s controla o limite.
  const TWO_PI = Math.PI * 2;
  register({
    id: 'euclid',
    kind: 'field',
    sMax: 1.1,
    sdf(u, v, s) {
      const t = 1 - 2 * s; // s=0 -> nada de tinta; s=1 -> tudo
      const cu = Math.cos(TWO_PI * u), cv = Math.cos(TWO_PI * v);
      const spot = (cu + cv) / 2;
      const su = Math.sin(TWO_PI * u), sv = Math.sin(TWO_PI * v);
      // distância ≈ diferença de nível / inclinação (com piso mínimo só para
      // não dividir por zero nos centros, onde a inclinação é zero; ali o
      // sinal — dentro/fora — continua certo)
      const g = Math.max(Math.PI * Math.sqrt(su * su + sv * sv), 0.05);
      return (t - spot) / g;
    },
  });

  // --- Linha (tipo campo) --------------------------------------------------
  // Faixa horizontal de espessura s centrada na célula.
  register({
    id: 'line',
    kind: 'field',
    sMax: 1.2,
    sdf(u, v, s) {
      return Math.abs(v) - s / 2;
    },
  });

  // --- Cruz / linhas cruzadas (tipo campo) ---------------------------------
  // Duas famílias de linhas perpendiculares; os furos são quadrados.
  register({
    id: 'cross',
    kind: 'field',
    sMax: 1.2,
    sdf(u, v, s) {
      return Math.min(Math.abs(u), Math.abs(v)) - s / 2;
    },
  });

  // --- Traço / linhas quebradas (tipo campo, célula comprida) --------------
  // Cápsula (traço de ponta redonda) deitada. Nos tons claros é um traço
  // curto e fino; conforme escurece ele alonga e engrossa até virar linha
  // contínua. Célula 2,5× mais larga que alta.
  const DASH_A = 2.5;
  function capsule(u, v, hl, r) {
    const dx = Math.max(Math.abs(u) - hl, 0);
    return Math.sqrt(dx * dx + v * v) - r;
  }
  register({
    id: 'dash',
    kind: 'field',
    aspect: DASH_A,
    sMax: 1.2,
    sdf(u, v, s) {
      const r = 0.5 * s;
      const hl = (DASH_A / 2) * Math.min(1.1, 0.12 + 1.15 * s);
      const au = Math.abs(u);
      // o traço desta célula e o da vizinha (para emendarem nos tons escuros)
      return Math.min(capsule(au, v, hl, r), capsule(DASH_A - au, v, hl, r));
    },
  });

  // --- Tinta chapada ---------------------------------------------------------
  register({ id: 'solid', kind: 'solid', sMax: 1, sdf() { return 0; } });

  // ---------------------------------------------------------------------
  // Calibração tamanho <-> área (feita uma vez por formato e guardada).

  const SIZE_STEPS = 256;
  const GRID = 160; // amostras por meia-célula na vertical
  const INV_SIZE = 4096;
  const cache = {};

  // Fração da célula coberta quando todas as células têm tamanho s. Integra
  // o quadrante [0, A/2]×[0, 1/2] (os formatos são simétricos).
  function coverageForSize(shape, s) {
    if (s <= 0) return 0;
    const A = shape.aspect;
    const ny = GRID, nx = Math.round(GRID * A);
    const h = 0.5 / ny; // passo (igual nos dois eixos)
    const hx = (A / 2) / nx;
    let sum = 0;
    for (let iy = 0; iy < ny; iy++) {
      const y = (iy + 0.5) * h;
      for (let ix = 0; ix < nx; ix++) {
        const x = (ix + 0.5) * hx;
        let d;
        if (shape.kind === 'cell') {
          d = Math.min(
            shape.sdf(x, y, s),
            shape.sdf(x - A, y, s),
            shape.sdf(x, y - 1, s),
            shape.sdf(x - A, y - 1, s)
          );
        } else {
          d = shape.sdf(x, y, s);
        }
        const c = 0.5 - d / h;
        sum += c <= 0 ? 0 : c >= 1 ? 1 : c;
      }
    }
    return sum / (nx * ny);
  }

  function getCalibration(shapeId) {
    if (cache[shapeId]) return cache[shapeId];
    const shape = SHAPES[shapeId];
    if (!shape) throw new Error('Formato desconhecido: ' + shapeId);

    if (shape.kind === 'solid') {
      cache[shapeId] = { shape, sizeFor: (a) => Math.max(0, Math.min(1, a)) };
      return cache[shapeId];
    }

    const area = new Float64Array(SIZE_STEPS + 1);
    for (let i = 0; i <= SIZE_STEPS; i++) area[i] = coverageForSize(shape, (shape.sMax * i) / SIZE_STEPS);
    for (let i = 1; i <= SIZE_STEPS; i++) if (area[i] < area[i - 1]) area[i] = area[i - 1];

    const sizeForArea = new Float32Array(INV_SIZE + 1);
    let j = 0;
    for (let k = 0; k <= INV_SIZE; k++) {
      const a = k / INV_SIZE;
      while (j < SIZE_STEPS && area[j + 1] < a) j++;
      if (j >= SIZE_STEPS) { sizeForArea[k] = shape.sMax; continue; }
      const a0 = area[j], a1 = area[j + 1];
      const t = a1 > a0 ? (a - a0) / (a1 - a0) : 0;
      sizeForArea[k] = (shape.sMax * (j + Math.max(0, Math.min(1, t)))) / SIZE_STEPS;
    }
    sizeForArea[0] = 0;
    sizeForArea[INV_SIZE] = shape.sMax;

    const cal = {
      shape,
      sizeFor(a) {
        if (a <= 0) return 0;
        if (a >= 1) return shape.sMax;
        const x = a * INV_SIZE, i = x | 0;
        return sizeForArea[i] + (sizeForArea[i + 1] - sizeForArea[i]) * (x - i);
      },
    };
    cache[shapeId] = cal;
    return cal;
  }

  return { register, getCalibration, SHAPES };
});

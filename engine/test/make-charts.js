// Gera cartelas sintéticas de teste em /test-images/charts.
//   node engine/test/make-charts.js
const path = require('path');
const { writePNG } = require('./png.js');
const { linearToSrgb } = require('../color.js');

const OUT = path.join(__dirname, '..', '..', 'test-images', 'charts');

function hsv(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
}

function make(name, w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x / (w - 1), y / (h - 1), x, y);
      const o = (y * w + x) * 4;
      d[o] = r * 255; d[o + 1] = g * 255; d[o + 2] = b * 255; d[o + 3] = 255;
    }
  }
  writePNG(path.join(OUT, name), w, h, d);
  console.log('ok', name);
}

// 1) Degradês: cinza, C, M, Y, vermelho, verde, azul, tom de pele, arco-íris.
const ramps = [
  (t) => [t, t, t],
  (t) => [t, 1, 1],
  (t) => [1, t, 1],
  (t) => [1, 1, t],
  (t) => [1, t, t],
  (t) => [t, 1, t],
  (t) => [t, t, 1],
  (t) => (t < 0.5 ? [1 - t * 2 * (1 - 0.87), 1 - t * 2 * (1 - 0.66), 1 - t * 2 * (1 - 0.55)] : [0.87 * (2 - 2 * t), 0.66 * (2 - 2 * t), 0.55 * (2 - 2 * t)]),
  (t) => hsv(t, 1, 1),
];
make('degrades.png', 1600, 900, (u, v) => ramps[Math.min(ramps.length - 1, Math.floor(v * ramps.length))](u));

// 2) Zone plate: anéis cada vez mais finos. Estressa moiré e aliasing.
make('zone-plate.png', 1200, 1200, (u, v, x, y) => {
  const dx = x - 600, dy = y - 600;
  const g = 0.5 + 0.5 * Math.cos((Math.PI * (dx * dx + dy * dy)) / 1200);
  return [g, g, g];
});

// 3) Matiz × luminosidade: todas as cores, do claro ao escuro.
make('cores.png', 1600, 900, (u, v) => {
  const [r, g, b] = hsv(u, v < 0.5 ? v * 2 : 1, v < 0.5 ? 1 : 2 - v * 2);
  return [r, g, b];
});

// 4) Degradê linear-em-luz (para checar suavidade nas sombras) + faixas.
make('sombras.png', 1600, 400, (u, v) => {
  const t = v < 0.5 ? linearToSrgb(u * u * 0.25) : u * 0.25; // só a faixa escura
  return [t, t, t];
});

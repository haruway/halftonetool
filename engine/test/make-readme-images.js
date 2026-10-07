// Gera as imagens do README em /docs usando só o motor (sem fotos de terceiros).
//   node engine/test/make-readme-images.js
const path = require('path');
const fs = require('fs');
const HT = require('..');
const presets = require('../presets.js');
const { writePNG } = require('./png.js');

const OUT = path.join(__dirname, '..', '..', 'docs');
fs.mkdirSync(OUT, { recursive: true });

// Amostra abstrata colorida (a mesma ideia das miniaturas de preset).
function sample(w, h) {
  const blobs = [
    [0.22, 0.25, 0.32, [255, 120, 40]], [0.85, 0.3, 0.35, [20, 150, 170]],
    [0.3, 0.88, 0.35, [230, 60, 130]], [0.62, 0.62, 0.22, [30, 20, 25]],
    [0.6, 0.12, 0.2, [255, 225, 90]], [0.95, 0.95, 0.3, [70, 40, 120]],
  ];
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      let r = 235 - 60 * v, g = 225 - 60 * v, b = 205 - 50 * v, ws = 1;
      for (const [bx, by, br, c] of blobs) {
        const k = Math.exp((-((u - bx) ** 2 + (v - by) ** 2) / (br * br)) * 2.2) * 3;
        r += c[0] * k; g += c[1] * k; b += c[2] * k; ws += k;
      }
      const i = (y * w + x) * 4;
      d[i] = r / ws; d[i + 1] = g / ws; d[i + 2] = b / ws; d[i + 3] = 255;
    }
  }
  return { width: w, height: h, data: d, channels: 4 };
}

// cola imagens RGBA lado a lado / em grade, com fundo e espaçamento
function grid(tiles, cols, tw, th, gap, bg) {
  const rows = Math.ceil(tiles.length / cols);
  const W = cols * tw + (cols + 1) * gap, H = rows * th + (rows + 1) * gap;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) { out[i * 4] = bg[0]; out[i * 4 + 1] = bg[1]; out[i * 4 + 2] = bg[2]; out[i * 4 + 3] = 255; }
  tiles.forEach((t, k) => {
    const ox = gap + (k % cols) * (tw + gap), oy = gap + Math.floor(k / cols) * (th + gap);
    for (let y = 0; y < th; y++) out.set(t.subarray(y * tw * 4, (y + 1) * tw * 4), ((oy + y) * W + ox) * 4);
  });
  return { W, H, out };
}

// 1) Os 12 padrões, cada um num degradê escuro -> claro, tinta escura em papel creme
const TW = 300, TH = 120;
const grad = new Uint8ClampedArray(TW * TH * 4);
for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
  const v = Math.round(255 * Math.pow(x / (TW - 1), 0.9)), i = (y * TW + x) * 4;
  grad[i] = grad[i + 1] = grad[i + 2] = v; grad[i + 3] = 255;
}
const pats = HT.patterns.LIST.map((p) => HT.render({ width: TW, height: TH, data: grad, channels: 4 }, {
  cellSize: 9, pattern: p.id, paper: '#EFE6D2', roughness: 0.35, distortion: 0.25, seed: 11,
  waves: { amplitude: 0.8, length: 7 }, fan: { x: -0.2, y: 1.8 },
  separation: { mode: 'solve' }, inks: [{ id: 'k', color: '#1E1B1A', angle: 30 }],
}).data);
let g = grid(pats, 3, TW, TH, 12, [36, 36, 36]);
writePNG(path.join(OUT, 'padroes.png'), g.W, g.H, g.out);
console.log('ok docs/padroes.png —', HT.patterns.LIST.map((p) => p.name).join(', '));

// 2) Três presets na mesma amostra
const S = 440;
const img = sample(S, S);
const ids = ['cartaz-misto', 'gravura-duo', 'riso-azul-rosa'];
const ex = ids.map((id) => {
  const pr = presets.LIST.find((p) => p.id === id);
  const st = Object.assign({}, pr, {
    cellSize: pr.cellSize * 0.85,
    inks: pr.inks.map((k, i) => Object.assign({ id: 'i' + i }, k)),
  });
  return HT.render(img, st).data;
});
g = grid(ex, 3, S, S, 12, [36, 36, 36]);
writePNG(path.join(OUT, 'exemplo-presets.png'), g.W, g.H, g.out);
console.log('ok docs/exemplo-presets.png —', ids.join(', '));

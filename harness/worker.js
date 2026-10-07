// Web Worker: roda o motor fora da thread da interface (a tela não trava
// enquanto renderiza). Mensagens:
//   { id, image, settings }        -> render
//   { id, thumbs: { w, h, cell, paper, ink } } -> miniaturas da galeria
importScripts(
  '../engine/color.js',
  '../engine/noise.js',
  '../engine/dots.js',
  '../engine/patterns.js',
  '../engine/separation.js',
  '../engine/raster.js',
  '../engine/aging.js',
  '../engine/halftone.js',
  '../engine/presets.js'
);

self.onmessage = (e) => {
  const { id } = e.data;
  try {
    if (e.data.thumbs) return thumbs(id, e.data.thumbs);
    if (e.data.presetThumbs) return presetThumbs(id, e.data.presetThumbs);
    const res = self.HT.halftone.render(e.data.image, e.data.settings);
    const transfer = [res.data.buffer];
    if (res.plates) res.plates.forEach((p) => transfer.push(p.data.buffer));
    self.postMessage({ id, ok: true, result: res }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.stack) || err) });
  }
};

// Miniatura de cada padrão sobre um degradê (escuro -> claro).
function thumbs(id, o) {
  const { w, h } = o;
  const grad = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.round(255 * Math.pow(x / (w - 1), 0.9));
      const i = (y * w + x) * 4;
      grad[i] = grad[i + 1] = grad[i + 2] = v;
      grad[i + 3] = 255;
    }
  }
  const out = self.HT.patterns.LIST.map((p) => {
    const res = self.HT.halftone.render({ width: w, height: h, data: grad, channels: 4 }, {
      cellSize: o.cell,
      pattern: p.id,
      paper: o.paper,
      roughness: o.roughness || 0,
      distortion: o.distortion || 0,
      seed: 11,
      waves: { amplitude: 0.8, length: 6 },
      fan: { x: -0.2, y: 1.6 },
      separation: { mode: 'solve' },
      inks: [{ id: 'k', color: o.ink, angle: 30 }],
    });
    return { id: p.id, name: p.name, data: res.data };
  });
  self.postMessage({ id, ok: true, result: out }, out.map((t) => t.data.buffer));
}

// Amostra abstrata e colorida para as miniaturas de preset: manchas suaves
// de cor (quente, fria, rosa, amarelo, escuro) sobre um degradê, para
// mostrar como o preset trata luzes, meios-tons, sombras e cores.
let sampleCache = null;
function sample(w, h) {
  if (sampleCache && sampleCache.w === w) return sampleCache.data;
  const blobs = [
    [0.22, 0.25, 0.32, [255, 120, 40]],
    [0.85, 0.3, 0.35, [20, 150, 170]],
    [0.3, 0.88, 0.35, [230, 60, 130]],
    [0.62, 0.62, 0.22, [30, 20, 25]],
    [0.6, 0.12, 0.2, [255, 225, 90]],
    [0.95, 0.95, 0.3, [70, 40, 120]],
  ];
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w, v = y / h;
      let r = 235 - 60 * v, g = 225 - 60 * v, b = 205 - 50 * v, wsum = 1;
      for (const [bx, by, br, c] of blobs) {
        const dd = ((u - bx) ** 2 + (v - by) ** 2) / (br * br);
        const k = Math.exp(-dd * 2.2) * 3;
        r += c[0] * k; g += c[1] * k; b += c[2] * k; wsum += k;
      }
      const i = (y * w + x) * 4;
      d[i] = r / wsum; d[i + 1] = g / wsum; d[i + 2] = b / wsum; d[i + 3] = 255;
    }
  }
  sampleCache = { w, data: d };
  return d;
}

// Miniaturas dos presets: cada um renderizado na amostra.
function presetThumbs(id, o) {
  const { size, list } = o;
  const img = sample(size, size);
  const out = list.map((pr) => {
    const st = Object.assign({}, pr, {
      cellSize: Math.max(3.5, (pr.cellSize || 10) * 0.55),
      scale: 1,
      inks: (pr.inks || []).map((k, i) => Object.assign({ id: 'i' + i, enabled: true }, k)),
    });
    const res = self.HT.halftone.render({ width: size, height: size, data: img, channels: 4 }, st);
    return { id: pr.id, data: res.data };
  });
  self.postMessage({ id, ok: true, result: out }, out.map((t) => t.data.buffer));
}

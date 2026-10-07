// Teste do motor em Node: mede precisão de tom e renderiza imagens.
//   node engine/test/run.js [pasta-de-saida]
// Variáveis: SKIP_TONE=1 (pula o tom), SKIP_IMAGES=1 (pula as imagens; a
// leitura de imagens usa o `sips` do macOS), ONLY=trecho-do-nome, CELL=10.
const path = require('path');
const fs = require('fs');
const HT = require('..');
const { writePNG, readImageMac } = require('./png.js');

const OUT = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// 1) Precisão de tom: campo de cinza liso renderizado deve ter a mesma luz
//    média (linear) que o original. Grade girada e janela grande (~90
//    células) para o viés de borda ficar desprezível. Roda para cada padrão.
function toneTest(pattern, cell, angle) {
  const W = Math.round(cell * 90), H = W;
  let worst = 0, at = 0;
  for (const g of [8, 15, 30, 45, 60, 90, 120, 150, 180, 210, 230, 248]) {
    const data = new Uint8ClampedArray(W * H * 4).fill(g);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    const res = HT.render({ width: W, height: H, data, channels: 4 }, {
      cellSize: cell,
      pattern,
      inks: [{ id: 'k', color: '#000000', angle }],
      separation: { mode: 'solve' },
    });
    let sum = 0, cnt = 0;
    const m = Math.round(W * 0.1);
    for (let y = m; y < H - m; y++) for (let x = m; x < W - m; x++) { sum += HT.color.srgbToLinear(res.data[(y * W + x) * 4] / 255); cnt++; }
    const e = Math.abs(HT.color.linearToSrgb(sum / cnt) * 255 - g);
    if (e > worst) { worst = e; at = g; }
  }
  return { worst, at };
}
if (!process.env.SKIP_TONE) {
  const pats = (process.env.PATTERNS || 'print,dots,dots-neg,lines,lines-broken,cross,solid').split(',');
  const cells = (process.env.CELLS || '3,4,6,10,24').split(',').map(Number);
  let fail = false;
  for (const pat of pats) {
    const row = cells.map((c) => { const r = toneTest(pat, c, 15); if (r.worst >= 2) fail = true; return `${c}px:${r.worst.toFixed(1)}${r.worst >= 2 ? '(cinza ' + r.at + ')' : ''}`; });
    console.log(`tom ${pat.padEnd(13)} ${row.join('  ')}`);
  }
  if (fail) { console.error('FALHOU: erro de tom acima da meta (2 níveis)'); process.exitCode = 1; }
}

// ---------------------------------------------------------------------------
// 2) Render das imagens de teste (só macOS: usa o `sips` para ler JPG/PNG).
const root = path.join(__dirname, '..', '..', 'test-images');
const files = [];
for (const dir of ['charts', 'personal', 'macos', '.']) {
  const d = path.join(root, dir);
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) if (/\.(png|jpe?g)$/i.test(f)) files.push(path.join(d, f));
}
const only = process.env.ONLY;
for (const f of process.env.SKIP_IMAGES ? [] : files) {
  if (only && !f.includes(only)) continue;
  const img = readImageMac(f);
  const cell = Number(process.env.CELL || 10);
  const res = HT.render(img, { cellSize: cell, plates: !!process.env.PLATES });
  const name = path.basename(f).replace(/\.\w+$/, '');
  writePNG(path.join(OUT, `${name}_c${cell}.png`), res.width, res.height, res.data);
  if (res.plates) res.plates.forEach((pl) => writePNG(path.join(OUT, `${name}_c${cell}_${pl.id}.png`), res.width, res.height, pl.data, 1));
  const s = res.stats;
  console.log(`${name} ${img.width}x${img.height}: ${s.totalMs.toFixed(0)} ms (sep ${s.separationMs.toFixed(0)}, grade ${s.gridsMs.toFixed(0)}, pixels ${s.pixelsMs.toFixed(0)})`);
}

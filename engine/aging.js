/*
 * aging.js — imperfeições analógicas ("envelhecimento").
 *
 * Tudo procedural (sem arquivos de textura) e com seed: mesmas
 * configurações = mesmo resultado. Todas as medidas são em células, então
 * o preview reduzido e o render final têm o mesmo aspecto.
 *
 *   paper    textura do papel: manchas suaves + grão fino, e a tinta não
 *            pega nos "poros" (pontinhos claros dentro das áreas de tinta)
 *   fibers   fibras/pelinhos do papel (fios claros e escuros)
 *   dust     poeira (pontinhos escuros), falhas (pontinhos claros) e
 *            arranhões (riscos claros longos)
 *   fade     desbotamento irregular da tinta (manchas onde a tinta é fraca)
 *   drift    desregistro: cada chapa sai levemente deslocada
 *   dotGain  ganho de ponto: a tinta espalha e os meios-tons escurecem
 *
 * Intensidade 0 em tudo = desligado (padrão).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./noise.js'));
  else (root.HT = root.HT || {}).aging = factory(root.HT.noise);
})(typeof self !== 'undefined' ? self : this, function (noise) {
  'use strict';

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /*
   * Prepara o envelhecimento de um render.
   *   cfg   = settings.aging
   *   W, H  = tamanho do render;  p = célula em px;  scale = escala do preview
   */
  function prepare(cfg, seed, W, H, p, scale) {
    cfg = cfg || {};
    const A = {
      paper: clamp01(cfg.paper || 0),
      fibers: clamp01(cfg.fibers || 0),
      dust: clamp01(cfg.dust || 0),
      fade: clamp01(cfg.fade || 0),
      drift: clamp01(cfg.drift || 0),
      dotGain: clamp01(cfg.dotGain || 0),
    };
    const base = noise.hash2(seed >>> 0, 777);
    const nPaper = noise.perlin(noise.hash2(base, 1));
    const nGrain = noise.perlin(noise.hash2(base, 2));
    const px = Math.max(0.5, scale); // 1 px do render final, em px deste render

    // --- ganho de ponto: a tinta espalha, sobretudo nos meios-tons ---------
    A.gainCurve = (a) => (A.dotGain > 0 ? clamp01(a + A.dotGain * 0.8 * a * (1 - a)) : a);

    // --- desregistro: deslocamento de cada chapa (em px deste render) ------
    A.driftFor = (k) => {
      if (A.drift <= 0) return [0, 0];
      const r = noise.rng(noise.hash2(base, 100 + k));
      const ang = r() * Math.PI * 2;
      const mag = A.drift * 0.6 * p * (0.4 + 0.6 * r());
      return [Math.cos(ang) * mag, Math.sin(ang) * mag];
    };

    // --- textura do papel, por linha --------------------------------------
    //   paperRow: multiplicador da cor (manchas + grão), ~0,85–1,1
    //   holdRow:  quanto a tinta "pega" (1 = toda; menor nos poros)
    A.rowPaper = (y, Wd, paperRow, holdRow) => {
      const fm1 = 1 / (22 * p), fm2 = 1 / (6 * p), fg = 1 / (1.3 * px), fh = 1 / (0.9 * px);
      for (let x = 0; x < Wd; x++) {
        const X = x + 0.5, Y = y + 0.5;
        const mottle = 0.65 * nPaper(X * fm1, Y * fm1) + 0.35 * nPaper(X * fm2 + 31.4, Y * fm2 + 7.7);
        const grain = nGrain(X * fg, Y * fg);
        paperRow[x] = 1 + A.paper * (0.09 * mottle + 0.06 * grain);
        const pore = nGrain(X * fh + 91.1, Y * fh + 13.3) + 0.25 * mottle;
        holdRow[x] = 1 - A.paper * 0.55 * clamp01((pore - 0.18) * 3);
      }
    };

    // --- desbotamento por tinta: força da tinta varia em manchas ----------
    const fadeNoise = [];
    A.rowFade = (k, y, Wd, out) => {
      if (!fadeNoise[k]) fadeNoise[k] = noise.perlin(noise.hash2(base, 200 + k));
      const n = fadeNoise[k];
      const f1 = 1 / (14 * p), f2 = 1 / (3.5 * p);
      for (let x = 0; x < Wd; x++) {
        const X = x + 0.5, Y = y + 0.5;
        const m = clamp01(0.5 + 0.9 * (0.7 * n(X * f1, Y * f1) + 0.3 * n(X * f2, Y * f2)));
        out[x] = 1 - A.fade * (0.12 + 0.62 * m);
      }
    };

    // --- fibras, poeira e arranhões: carimbados num buffer ----------------
    // valor > 0 clareia (rumo ao papel), < 0 escurece. Só existe se usado.
    A.overlay = null;
    if (A.fibers > 0 || A.dust > 0) A.overlay = buildOverlay(A, base, W, H, p, px);
    return A;
  }

  function buildOverlay(A, base, W, H, p, px) {
    const buf = new Int8Array(W * H);
    const r = noise.rng(noise.hash2(base, 300));
    const cells = (W * H) / (p * p);

    // soma com saturação (vários carimbos no mesmo lugar não estouram)
    function put(i, v) {
      const s = buf[i] + v;
      buf[i] = s > 127 ? 127 : s < -127 ? -127 : s;
    }

    // traço curvo: caminhada aleatória com curvatura suave
    function stroke(x, y, len, width, value, wobble) {
      let ang = r() * Math.PI * 2;
      const step = Math.max(0.6 * px, 0.35 * p);
      const n = Math.max(2, Math.round(len / step));
      let x0 = x, y0 = y;
      for (let i = 0; i < n; i++) {
        ang += (r() - 0.5) * wobble;
        const x1 = x0 + Math.cos(ang) * step, y1 = y0 + Math.sin(ang) * step;
        // afina nas pontas
        const t = i / (n - 1);
        segment(x0, y0, x1, y1, width * (0.35 + 0.65 * Math.sin(Math.PI * t)), value);
        x0 = x1; y0 = y1;
      }
    }

    // segmento com anti-aliasing (distância ao segmento)
    function segment(ax, ay, bx, by, w, value) {
      const hw = w / 2 + 1;
      const minX = Math.max(0, Math.floor(Math.min(ax, bx) - hw)), maxX = Math.min(W - 1, Math.ceil(Math.max(ax, bx) + hw));
      const minY = Math.max(0, Math.floor(Math.min(ay, by) - hw)), maxY = Math.min(H - 1, Math.ceil(Math.max(ay, by) + hw));
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-9;
      // intensidade cai quando o traço é mais fino que 1 px (preserva "peso")
      const k = Math.min(1, w);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const qx = x + 0.5 - ax, qy = y + 0.5 - ay;
          const t = Math.max(0, Math.min(1, (qx * dx + qy * dy) / L2));
          const ex = qx - t * dx, ey = qy - t * dy;
          const d = Math.sqrt(ex * ex + ey * ey) - Math.max(w, 1) / 2;
          const c = 0.5 - d;
          if (c > 0) put(y * W + x, Math.round(value * k * (c > 1 ? 1 : c) * 0.5));
        }
      }
    }

    // mancha irregular (poeira): círculo com borda ondulada
    function blob(x, y, rad, value) {
      const R = rad + 1;
      const ph = r() * 6.28, amp = 0.25 + r() * 0.3;
      for (let yy = Math.max(0, Math.floor(y - R)); yy <= Math.min(H - 1, Math.ceil(y + R)); yy++) {
        for (let xx = Math.max(0, Math.floor(x - R)); xx <= Math.min(W - 1, Math.ceil(x + R)); xx++) {
          const ex = xx + 0.5 - x, ey = yy + 0.5 - y;
          const a = Math.atan2(ey, ex);
          const rr = rad * (1 + amp * Math.sin(3 * a + ph) * 0.5);
          const c = 0.5 - (Math.sqrt(ex * ex + ey * ey) - rr);
          if (c > 0) put(yy * W + xx, Math.round(value * (c > 1 ? 1 : c)));
        }
      }
    }

    // fibras: fios curtos, 60% claros e 40% escuros, bem sutis
    if (A.fibers > 0) {
      const n = Math.round(A.fibers * cells * 0.05);
      for (let i = 0; i < n; i++) {
        const light = r() < 0.6;
        const len = p * (1.5 + 5 * r() * r());
        const w = px * (0.5 + 0.9 * r());
        const v = (light ? 1 : -1) * Math.round(127 * A.fibers * (0.25 + 0.35 * r()));
        stroke(r() * W, r() * H, len, w, v, 0.9);
      }
    }

    if (A.dust > 0) {
      // poeira escura
      const nd = Math.round(A.dust * cells * 0.012);
      for (let i = 0; i < nd; i++) {
        const rad = Math.max(0.35 * px, p * 0.35 * r() * r());
        blob(r() * W, r() * H, rad, -Math.round(127 * (0.45 + 0.5 * r())));
      }
      // falhas claras (tinta que não pegou)
      const nl = Math.round(A.dust * cells * 0.02);
      for (let i = 0; i < nl; i++) {
        const rad = Math.max(0.35 * px, p * 0.3 * r() * r());
        blob(r() * W, r() * H, rad, Math.round(127 * (0.5 + 0.5 * r())));
      }
      // arranhões: poucos e longos
      const ns = Math.round(A.dust * (1 + Math.sqrt(cells) / 18));
      for (let i = 0; i < ns; i++) {
        stroke(r() * W, r() * H, p * (8 + 35 * r()), px * (0.6 + 1.2 * r()), Math.round(127 * (0.5 + 0.45 * r())), 0.12);
      }
    }
    return buf;
  }

  return { prepare };
});

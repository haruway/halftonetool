/*
 * raster.js — desenho da retícula em pixels (com anti-aliasing) e
 * calibração de tom na escala do pixel.
 *
 * rasterRow: para uma linha de pixels, quanto de cada pixel está coberto
 * pela tinta de UMA grade (0 = papel, 1 = tinta cheia).
 *
 * makeSizer: converte "cobertura pedida" (0–1) em "tamanho do formato"
 * para um tamanho de célula específico. Em células pequenas (< 16 px)
 * pontos e buracos ficam do tamanho de um pixel e o anti-aliasing distorce
 * a área; então medimos o que o próprio rasterRow desenha e corrigimos.
 * Resultado: o tom médio é o mesmo no preview reduzido e no render final.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./dots.js'));
  else (root.HT = root.HT || {}).raster = factory(root.HT.dots);
})(typeof self !== 'undefined' ? self : this, function (dots) {
  'use strict';

  const LATTICE = { straight: 0, wave: 1, wave2: 2, fan: 3 };
  const KIND = { cell: 0, field: 1, solid: 2 };
  const SS = [-1 / 3, 0, 1 / 3]; // supersampling 3×3 (px)
  const PI = Math.PI;

  /*
   * G = grade de uma tinta (montada em halftone.js):
   *   lattice, kind, invert, A (largura da célula), sdf
   *   cos, sin         ângulo da grade
   *   ox, oy           origem (no leque: centro do leque), em px
   *   waveAmp, waveK   ondas: amplitude (células) e 2π/comprimento
   *   fanRef           leque: ângulo de referência
   *   iMin, jMin, gw, gh, size[], gain[]   tamanho por célula (−1 = vazia)
   *   warpAmp, warpFreq, warpNoise         distorção da grade (px)
   *   edgeAmp, edgeF1, edgeF2, edgeNoise   rugosidade da borda (px)
   *   grain            grão da tinta chapada
   *   driftX, driftY   desregistro da chapa (px)
   */
  function rasterRow(G, p, aa, y, W, cov) {
    const { lattice, kind, invert, A, sdf, cos, sin, ox, oy, iMin, jMin, gw, gh, size, gain } = G;
    const warp = G.warpAmp > 0, edge = G.edgeAmp > 0 || G.grain > 0;
    const nW = G.warpNoise, nE = G.edgeNoise;
    const dX = G.driftX || 0, dY = G.driftY || 0;

    // tamanho da célula (i, j), ou −1 se fora da grade
    function S(i, j) {
      const ci = i - iMin, cj = j - jMin;
      return ci < 0 || cj < 0 || ci >= gw || cj >= gh ? -1 : size[cj * gw + ci];
    }
    function Gn(i, j) {
      const ci = i - iMin, cj = j - jMin;
      return ci < 0 || cj < 0 || ci >= gw || cj >= gh ? 1 : gain[cj * gw + ci];
    }

    for (let x = 0; x < W; x++) {
      // desregistro: a chapa inteira sai deslocada (retícula e imagem juntas)
      let px = x + 0.5 - dX, py = y + 0.5 - dY;

      // --- orgânico: ruído na borda e distorção da grade -----------------
      let en = 0, raw = 0;
      if (edge) {
        raw = 0.7 * nE(px * G.edgeF1, py * G.edgeF1) + 0.3 * nE(px * G.edgeF2 + 71.3, py * G.edgeF2 + 19.1);
        en = G.edgeAmp * raw;
      }
      if (warp) {
        const wx = px * G.warpFreq, wy = py * G.warpFreq;
        const dx = nW(wx, wy), dy = nW(wx + 43.1, wy + 11.7);
        px += G.warpAmp * dx;
        py += G.warpAmp * dy;
      }

      // --- posição do pixel na grade (U ao longo da fileira, V entre elas)
      const X = px - ox, Y = py - oy;
      let U = 0, V, th = 0, metric = 1;
      let eux = cos, euy = sin, evx = -sin, evy = cos; // eixos locais
      if (lattice === 3) {
        // leque: fileiras são anéis em volta do centro; V = raio
        const r = Math.sqrt(X * X + Y * Y);
        V = r / p;
        th = Math.atan2(Y, X) - G.fanRef;
        if (th > PI) th -= 2 * PI; else if (th <= -PI) th += 2 * PI;
        const inv = r > 1e-9 ? 1 / r : 0;
        evx = X * inv; evy = Y * inv; eux = -evy; euy = evx;
      } else {
        U = (cos * X + sin * Y) / p;
        V = (-sin * X + cos * Y) / p;
        if (lattice === 1) {
          // onda: as fileiras sobem e descem numa senoide
          const ph = G.waveK * U;
          V -= G.waveAmp * Math.sin(ph);
          const sl = G.waveAmp * G.waveK * Math.cos(ph);
          metric = 1 / Math.sqrt(1 + sl * sl); // distância perpendicular à onda
        } else if (lattice === 2) {
          const pu = G.waveK * U, pv = G.waveK * V;
          const U2 = U - G.waveAmp * Math.sin(pv);
          V -= G.waveAmp * Math.sin(pu);
          U = U2;
          const a = G.waveAmp * G.waveK, cu = Math.cos(pu), cv = Math.cos(pv);
          metric = 1 / Math.sqrt(1 + a * a * 0.5 * (cu * cu + cv * cv));
        }
      }

      // duas fileiras em volta do pixel (j0 e j1) e, em cada uma, as duas
      // células em volta (i e i+1)
      const j0 = Math.floor(V - 0.5), j1 = j0 + 1;
      const fv = V - (j0 + 0.5); // 0..1 entre as fileiras
      let Ua = U, Ub = U, sca = 1, scb = 1;
      if (lattice === 3) {
        // no leque, cada anel tem sua própria coordenada ao longo do arco
        Ua = th * (j0 + 0.5); Ub = th * (j1 + 0.5);
        sca = j0 >= 0 ? V / (j0 + 0.5) : 1;
        scb = V / (j1 + 0.5);
      }
      const xa = Ua / A - 0.5, xb = Ub / A - 0.5;
      const ia = Math.floor(xa), ib = Math.floor(xb);
      const fua = xa - ia, fub = xb - ib; // 0..1 entre as células
      const rowA = !(lattice === 3 && j0 < 0);

      let c;
      if (kind === 0) {
        // ---------------- tipo célula: pontos inteiros que se fundem -------
        const sa0 = rowA ? S(ia, j0) : -1, sa1 = rowA ? S(ia + 1, j0) : -1;
        const sb0 = S(ib, j1), sb1 = S(ib + 1, j1);
        const ua0 = fua * A * sca, ua1 = (fua - 1) * A * sca;
        const ub0 = fub * A * scb, ub1 = (fub - 1) * A * scb;
        const va = fv, vb = fv - 1;
        const k = p * metric;
        let d1 = Infinity, d2 = Infinity, g1 = 1, d;
        if (sa0 >= 0) { d = sdf(ua0, va, sa0) * k; if (d < d1) { d2 = d1; d1 = d; g1 = Gn(ia, j0); } else if (d < d2) d2 = d; }
        if (sa1 >= 0) { d = sdf(ua1, va, sa1) * k; if (d < d1) { d2 = d1; d1 = d; g1 = Gn(ia + 1, j0); } else if (d < d2) d2 = d; }
        if (sb0 >= 0) { d = sdf(ub0, vb, sb0) * k; if (d < d1) { d2 = d1; d1 = d; g1 = Gn(ib, j1); } else if (d < d2) d2 = d; }
        if (sb1 >= 0) { d = sdf(ub1, vb, sb1) * k; if (d < d1) { d2 = d1; d1 = d; g1 = Gn(ib + 1, j1); } else if (d < d2) d2 = d; }
        d1 += en; d2 += en;

        if (!aa) c = d1 < 0 ? 1 : 0;
        else if (d1 >= 0.5) c = 0;
        else if (d1 <= -0.5) c = g1;
        else if (d2 < 1) {
          // dois pontos se encontrando no pixel: subamostra 3×3
          c = 0;
          for (let sy = 0; sy < 3; sy++) {
            for (let sx = 0; sx < 3; sx++) {
              const ou = (eux * SS[sx] + euy * SS[sy]) / p, ov = (evx * SS[sx] + evy * SS[sy]) / p;
              let dm = Infinity;
              if (sa0 >= 0) dm = Math.min(dm, sdf(ua0 + ou, va + ov, sa0));
              if (sa1 >= 0) dm = Math.min(dm, sdf(ua1 + ou, va + ov, sa1));
              if (sb0 >= 0) dm = Math.min(dm, sdf(ub0 + ou, vb + ov, sb0));
              if (sb1 >= 0) dm = Math.min(dm, sdf(ub1 + ou, vb + ov, sb1));
              const t = 0.5 - (dm * k + en) * 3; // rampa de 1/3 px
              c += t <= 0 ? 0 : t >= 1 ? 1 : t;
            }
          }
          c *= g1 / 9;
        } else c = (0.5 - d1) * g1;
      } else {
        // ---------------- tipo campo / chapada: tamanho interpolado --------
        const pa0 = rowA ? Math.max(0, S(ia, j0)) : 0, pa1 = rowA ? Math.max(0, S(ia + 1, j0)) : 0;
        const pb0 = Math.max(0, S(ib, j1)), pb1 = Math.max(0, S(ib + 1, j1));
        const sA = pa0 + (pa1 - pa0) * fua, sB = pb0 + (pb1 - pb0) * fub;
        const s = sA + (sB - sA) * fv;
        const ga0 = rowA ? Gn(ia, j0) : 1, ga1 = rowA ? Gn(ia + 1, j0) : 1;
        const gb0 = Gn(ib, j1), gb1 = Gn(ib + 1, j1);
        const gA = ga0 + (ga1 - ga0) * fua, gB = gb0 + (gb1 - gb0) * fub;
        const g = gA + (gB - gA) * fv;

        if (kind === 2) {
          // chapada: a tinta é o próprio tom, com grão opcional
          c = s + G.grain * raw * Math.min(s, 1 - s) * 2;
          c = c < 0 ? 0 : c > 1 ? 1 : c;
        } else if (s <= 1e-5) {
          c = 0;
        } else {
          // coordenadas locais na célula mais próxima (o formato é periódico)
          let ul, vl;
          if (fv < 0.5 && rowA) { ul = (fua < 0.5 ? fua : fua - 1) * A * sca; vl = fv; }
          else { ul = (fub < 0.5 ? fub : fub - 1) * A * scb; vl = fv - 1; }
          const k = p * metric;
          const d = sdf(ul, vl, s) * k + en;
          if (!aa) c = d < 0 ? 1 : 0;
          else if (d >= 0.5) c = 0;
          else if (d <= -0.5) c = g;
          else {
            // pixel de borda: subamostra 3×3 (uma linha quase fechada deixa
            // um vão mais fino que o pixel, com duas bordas dentro dele)
            c = 0;
            for (let sy = 0; sy < 3; sy++) {
              for (let sx = 0; sx < 3; sx++) {
                // subamostra pode cair na célula vizinha: dobra de volta
                // (o padrão é periódico: período A em u e 1 em v)
                let su = ul + (eux * SS[sx] + euy * SS[sy]) / p, sv = vl + (evx * SS[sx] + evy * SS[sy]) / p;
                su -= A * Math.round(su / A);
                sv -= Math.round(sv);
                const t = 0.5 - (sdf(su, sv, s) * k + en) * 3;
                c += t <= 0 ? 0 : t >= 1 ? 1 : t;
              }
            }
            c *= g / 9;
          }
        }
      }
      cov[x] = invert ? 1 - c : c;
    }
  }

  // ---------------------------------------------------------------------
  // Tamanho do formato por cobertura, para um tamanho de célula p.

  const INV = 1024;
  const sizerCache = new Map();

  /*
   * shapeId, p (px), aa, angleDeg = ângulo da grade (a medição é feita no
   * mesmo ângulo, porque o anti-aliasing de bordas retas depende dele).
   */
  function makeSizer(shapeId, p, aa, angleDeg) {
    // tamanhos parecidos compartilham a calibração (mais grosso nas células
    // grandes; acima de 40 px os erros de pixel já são desprezíveis e
    // reaproveitamos a de 40 px, que é bem mais rápida de medir)
    const pk = p < 16 ? Math.round(p * 4) / 4 : Math.min(40, Math.round(p));
    // ângulo: θ e 90°−θ são espelhos (mesma área), então dobramos para
    // 0–45° e agrupamos de 5 em 5 graus
    let af = (((angleDeg || 0) % 90) + 90) % 90;
    if (af > 45) af = 90 - af;
    const ak = Math.round(af / 5) * 5;
    const key = shapeId + '|' + pk + '|' + (aa ? 1 : 0) + '|' + ak;
    if (sizerCache.has(key)) return sizerCache.get(key);
    const base = dots.getCalibration(shapeId);
    const shape = base.shape;
    const pReal = p;
    p = pk;

    function baseSize(a, out) {
      if (shape.kind === 'solid') { out[0] = Math.max(0, Math.min(1, a)); out[1] = 1; return out; }
      if (a <= 1e-4) { out[0] = -1; out[1] = 1; return out; }
      let s = base.sizeFor(a), g = 1;
      if (shape.pixelCorrection && a < 0.999) {
        const corr = shape.pixelCorrection(s * pReal);
        s = corr[0] / pReal;
        g = corr[1];
      }
      out[0] = s; out[1] = g;
      return out;
    }

    let sizer;
    if (shape.kind === 'solid') {
      sizer = { sizeAndGain: baseSize };
    } else {
      // Mede a área realmente desenhada para M coberturas pedidas (mais
      // densas perto de 0 e de 1, onde pontos/vãos ficam subpixel).
      const M = 64;
      const req = new Float64Array(M + 1), got = new Float64Array(M + 1);
      const sArr = new Float64Array(M + 1), gArr = new Float64Array(M + 1);
      const tmp = [0, 0];
      const probe = makeProbe(shape, pk, aa, (ak * Math.PI) / 180);
      for (let m = 0; m <= M; m++) {
        const t = m / M;
        req[m] = t - Math.sin(2 * Math.PI * t) / (2 * Math.PI);
        baseSize(m === M ? 1 : req[m], tmp);
        sArr[m] = tmp[0]; gArr[m] = tmp[1];
        got[m] = m === 0 ? 0 : m === M ? 1 : probe(tmp[0], tmp[1]);
      }
      for (let m = 1; m <= M; m++) if (got[m] < got[m - 1]) got[m] = got[m - 1];

      // limites do que o pixel consegue desenhar: abaixo do menor ponto
      // visível (gotLo) ou acima do maior vão visível (gotHi), a tinta é
      // desenhada com intensidade proporcional — o tom médio segue exato
      let mLo = 1;
      while (mLo < M && got[mLo] <= 0) mLo++;
      const gotLo = got[mLo];
      let gotHi = 0;
      for (let m = 0; m < M; m++) if (got[m] < 1 - 0.004) gotHi = Math.max(gotHi, got[m]);

      // inverte direto para o TAMANHO medido (interpolar a cobertura pedida
      // falharia perto de 100%, onde o tamanho dá um salto)
      const invS = new Float32Array(INV + 1), invG = new Float32Array(INV + 1);
      let j = 0;
      for (let k = 0; k <= INV; k++) {
        const a = k / INV;
        while (j < M - 1 && got[j + 1] < a) j++;
        const g0 = got[j], g1 = got[j + 1];
        const t = g1 > g0 ? Math.max(0, Math.min(1, (a - g0) / (g1 - g0))) : 0;
        const s0 = sArr[j] < 0 ? sArr[j + 1] : sArr[j];
        invS[k] = s0 + (sArr[j + 1] - s0) * t;
        invG[k] = gArr[j] + (gArr[j + 1] - gArr[j]) * t;
      }
      const sMax = sArr[M];
      sizer = {
        sizeAndGain(a, out) {
          if (a <= 1e-4) { out[0] = -1; out[1] = 1; return out; }
          if (a < gotLo) { out[0] = sArr[mLo]; out[1] = gArr[mLo] * (a / gotLo); return out; }
          if (a > gotHi) { out[0] = sMax; out[1] = Math.min(1, a); return out; }
          const x = a * INV, i = x | 0, f = x - i;
          out[0] = invS[i] + (invS[Math.min(INV, i + 1)] - invS[i]) * f;
          out[1] = invG[i] + (invG[Math.min(INV, i + 1)] - invG[i]) * f;
          return out;
        },
      };
    }
    sizerCache.set(key, sizer);
    if (sizerCache.size > 96) sizerCache.delete(sizerCache.keys().next().value);
    return sizer;
  }

  /*
   * "Sonda" de medição: desenha um campo uniforme (todas as células com o
   * mesmo tamanho s) na grade girada e devolve a área média de tinta.
   * A média usa uma janela suave (Hann) sobre k×k células: como o padrão é
   * periódico, a média com janela suave converge rápido para o valor
   * exato, em qualquer ângulo e tamanho de célula.
   */
  function makeProbe(shape, p, aa, ang) {
    const A = shape.aspect;
    const kv = p < 16 ? Math.max(8, Math.ceil(64 / p)) : 4; // células na vertical
    const ku = Math.max(3, Math.ceil(kv / A)); // células na horizontal
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const LU = ku * A * p, LV = kv * p; // tamanho da janela em px
    // caixa da janela girada; origem da grade num ponto "torto" (fase subpixel)
    const xs = [0, LU * cos, -LV * sin, LU * cos - LV * sin];
    const ys = [0, LU * sin, LV * cos, LU * sin + LV * cos];
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const ox = -x0 + 0.37, oy = -y0 + 0.61;
    const W = Math.ceil(Math.max(...xs) - x0 + 1), H = Math.ceil(Math.max(...ys) - y0 + 1);
    const gw = ku + 8, gh = kv + 8;
    const size = new Float32Array(gw * gh), gain = new Float32Array(gw * gh);
    const G = {
      lattice: 0, kind: KIND[shape.kind], invert: false, A, sdf: shape.sdf,
      cos, sin, ox, oy, iMin: -4, jMin: -4, gw, gh, size, gain,
      warpAmp: 0, edgeAmp: 0, grain: 0,
    };
    // peso de cada pixel (só depende da geometria; calcula uma vez)
    const wts = new Float32Array(W * H);
    let wsum = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const X = x + 0.5 - ox, Y = y + 0.5 - oy;
        const tu = (cos * X + sin * Y) / LU, tv = (-sin * X + cos * Y) / LV;
        if (tu <= 0 || tu >= 1 || tv <= 0 || tv >= 1) continue;
        const w = Math.sin(Math.PI * tu) ** 2 * Math.sin(Math.PI * tv) ** 2;
        wts[y * W + x] = w;
        wsum += w;
      }
    }
    const cov = new Float32Array(W);
    return function (s, g) {
      size.fill(s);
      gain.fill(g);
      let sum = 0;
      for (let y = 0; y < H; y++) {
        rasterRow(G, p, aa, y, W, cov);
        const off = y * W;
        for (let x = 0; x < W; x++) sum += cov[x] * wts[off + x];
      }
      return sum / wsum;
    };
  }

  return { rasterRow, makeSizer, makeProbe, LATTICE, KIND };
});

/*
 * halftone.js — o render da retícula.
 *
 * Entrada: buffer RGB/RGBA 8 bits + configurações.
 * Saída:   buffer RGBA 8 bits composto (+ uma chapa por tinta, se pedido).
 * Sem canvas, sem DOM: roda igual no navegador, no Worker, no Node e no UXP.
 *
 * PASSO A PASSO
 *  1. Curva de entrada (brilho/contraste/gama) e conversão para luz linear.
 *  2. Redução da imagem por média de área (fator ≈ célula/4) + desfoque
 *     gaussiano proporcional à célula (σ = prefilter × célula). Cada ponto
 *     passa a representar a MÉDIA da sua região, não um pixel solto: detalhe
 *     mais fino que a retícula não vira moiré.
 *  3. Separação de cor (separation.js): RGB -> cobertura de cada tinta.
 *  4. Para cada tinta, uma grade (reta, ondulada ou em leque) no ângulo
 *     dela. Em cada célula guardamos o tamanho do formato que dá a
 *     cobertura pedida.
 *  5. Para cada pixel e cada tinta: fração do pixel coberta por tinta, com
 *     anti-aliasing analítico e o "orgânico" (raster.js).
 *  6. Composição: papel como base e cada tinta aplicada em ordem (filtra
 *     como tinta transparente ou cobre, se opaca), em luz linear.
 *  7. Envelhecimento (aging.js): textura do papel, desbotamento, fibras,
 *     poeira e arranhões; conversão final para sRGB.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./color.js'), require('./noise.js'), require('./dots.js'), require('./patterns.js'),
      require('./separation.js'), require('./raster.js'), require('./aging.js')
    );
  } else {
    const HT = root.HT;
    HT.halftone = factory(HT.color, HT.noise, HT.dots, HT.patterns, HT.separation, HT.raster, HT.aging);
  }
})(typeof self !== 'undefined' ? self : this, function (color, noise, dots, patterns, separation, raster, aging) {
  'use strict';

  const DEG = Math.PI / 180;

  // Tintas de processo (aproximações sRGB de tinta offset em papel couché)
  // e ângulos clássicos de retícula: C 15°, M 75°, Y 0°, K 45°.
  function defaultCMYKInks() {
    return [
      { id: 'c', name: 'Ciano', role: 'c', color: '#00AEEF', opacity: 1, hiding: 0, angle: 15, enabled: true },
      { id: 'm', name: 'Magenta', role: 'm', color: '#EC008C', opacity: 1, hiding: 0, angle: 75, enabled: true },
      { id: 'y', name: 'Amarelo', role: 'y', color: '#FFF200', opacity: 1, hiding: 0, angle: 0, enabled: true },
      { id: 'k', name: 'Preto', role: 'k', color: '#231F20', opacity: 1, hiding: 0, angle: 45, enabled: true },
    ];
  }

  function defaultSettings() {
    return {
      cellSize: 12, // tamanho da célula em pixels (na resolução original)
      scale: 1, // escala do render (preview reduzido = 0.5, 0.25...)
      antialias: true,
      prefilter: 0.4, // suavização do detalhe, em células (0 = mais nítido, mais moiré)
      pattern: 'print', // padrão global (patterns.js); cada tinta pode sobrescrever
      rotation: 0, // graus somados ao ângulo de todas as tintas
      roughness: 0, // 0–1: borda irregular do ponto (orgânico)
      distortion: 0, // 0–1: grade levemente torta (orgânico)
      seed: 1, // semente de toda aleatoriedade
      waves: { amplitude: 0.8, length: 8 }, // em células
      fan: { x: 0.5, y: 1.4 }, // centro do leque, relativo à imagem
      paper: '#FFFFFF',
      // envelhecimento (0 = desligado): ver aging.js
      aging: { paper: 0, fibers: 0, dust: 0, fade: 0, drift: 0, dotGain: 0 },
      separation: { mode: 'cmyk', gcr: 0.7, blackStart: 0.15 },
      input: { brightness: 0, contrast: 0, gamma: 1 },
      inks: defaultCMYKInks(),
      plates: false, // gerar chapas separadas
    };
  }

  // A tabela de separação leva ~0,1–0,3 s para montar; guardamos a última
  // para não refazer quando só o padrão, ângulo ou célula mudam.
  let sepCache = { key: null, value: null };
  function getSeparation(inks, sepSettings, paper) {
    const opaque = inks.some((i) => i.hiding > 0);
    const key = JSON.stringify({
      inks: inks.map((i) => [i.color, i.opacity, i.hiding || 0, i.role]),
      paper: opaque ? paper : null,
      mode: sepSettings.mode,
      gcr: sepSettings.gcr,
      blackStart: sepSettings.blackStart,
    });
    if (sepCache.key !== key) {
      sepCache = { key, value: separation.buildSeparation({ inks, paper, ...sepSettings }) };
    }
    return sepCache.value;
  }

  /*
   * Passos 1 e 2: imagem 8 bits -> imagem reduzida em luz linear (Float32,
   * RGB). Transparência é achatada sobre branco (= papel sem tinta).
   */
  function downsampleLinear(img, factor, inLUT) {
    const { width: W, height: H, data } = img;
    const ch = img.channels || 4;
    const w2 = Math.ceil(W / factor), h2 = Math.ceil(H / factor);
    const out = new Float32Array(w2 * h2 * 3);
    const count = new Float32Array(w2 * h2);
    const white = inLUT[255];
    for (let y = 0; y < H; y++) {
      const ry = ((y / factor) | 0) * w2;
      let p = y * W * ch;
      for (let x = 0; x < W; x++, p += ch) {
        const o = ry + ((x / factor) | 0);
        let r = inLUT[data[p]], g = inLUT[data[p + 1]], b = inLUT[data[p + 2]];
        if (ch === 4 && data[p + 3] !== 255) {
          const a = data[p + 3] / 255;
          r = r * a + white * (1 - a);
          g = g * a + white * (1 - a);
          b = b * a + white * (1 - a);
        }
        out[o * 3] += r;
        out[o * 3 + 1] += g;
        out[o * 3 + 2] += b;
        count[o] += 1;
      }
    }
    for (let i = 0; i < w2 * h2; i++) {
      const k = 1 / count[i];
      out[i * 3] *= k;
      out[i * 3 + 1] *= k;
      out[i * 3 + 2] *= k;
    }
    return { data: out, width: w2, height: h2, factor };
  }

  /*
   * Desfoque gaussiano aproximado por 3 passadas de média móvel (box blur),
   * separável (horizontal depois vertical). sigma em pixels da imagem
   * reduzida. Bordas repetem o último pixel.
   */
  function blurLinear(low, sigma) {
    if (!(sigma > 0.5)) return;
    // largura da caixa para 3 passadas somarem a variância sigma²
    const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
    const { width: w, height: h, data } = low;
    const line = new Float32Array(Math.max(w, h) * 3);
    const tmp = new Float32Array(Math.max(w, h) * 3);

    function boxPass(src, dst, len) {
      const inv = 1 / (2 * r + 1);
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let k = -r; k <= r; k++) acc += src[Math.min(len - 1, Math.max(0, k)) * 3 + c];
        for (let i = 0; i < len; i++) {
          dst[i * 3 + c] = acc * inv;
          acc += src[Math.min(len - 1, i + r + 1) * 3 + c] - src[Math.max(0, i - r) * 3 + c];
        }
      }
    }
    for (let y = 0; y < h; y++) {
      const off = y * w * 3;
      for (let i = 0; i < w * 3; i++) line[i] = data[off + i];
      boxPass(line, tmp, w); boxPass(tmp, line, w); boxPass(line, tmp, w);
      for (let i = 0; i < w * 3; i++) data[off + i] = tmp[i];
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        const o = (y * w + x) * 3;
        line[y * 3] = data[o]; line[y * 3 + 1] = data[o + 1]; line[y * 3 + 2] = data[o + 2];
      }
      boxPass(line, tmp, h); boxPass(tmp, line, h); boxPass(line, tmp, h);
      for (let y = 0; y < h; y++) {
        const o = (y * w + x) * 3;
        data[o] = tmp[y * 3]; data[o + 1] = tmp[y * 3 + 1]; data[o + 2] = tmp[y * 3 + 2];
      }
    }
  }

  // Leitura bilinear da imagem reduzida numa posição (x, y) em pixels da
  // imagem original. Fora da imagem repete a borda.
  function sampleLinear(low, x, y, out) {
    const lx = x / low.factor - 0.5, ly = y / low.factor - 0.5;
    const w = low.width, h = low.height, d = low.data;
    let x0 = Math.floor(lx), y0 = Math.floor(ly);
    let fx = lx - x0, fy = ly - y0;
    if (x0 < 0) { x0 = 0; fx = 0; }
    if (y0 < 0) { y0 = 0; fy = 0; }
    if (x0 >= w - 1) { x0 = Math.max(0, w - 2); fx = w > 1 ? 1 : 0; }
    if (y0 >= h - 1) { y0 = Math.max(0, h - 2); fy = h > 1 ? 1 : 0; }
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const i00 = (y0 * w + x0) * 3, i10 = (y0 * w + x1) * 3, i01 = (y1 * w + x0) * 3, i11 = (y1 * w + x1) * 3;
    for (let c = 0; c < 3; c++) {
      const a = d[i00 + c] + (d[i10 + c] - d[i00 + c]) * fx;
      const b = d[i01 + c] + (d[i11 + c] - d[i01 + c]) * fx;
      out[c] = a + (b - a) * fy;
    }
    return out;
  }

  /*
   * Passo 4: grade de uma tinta.
   * Coordenadas da grade em unidades de célula: U ao longo das fileiras
   * (período = largura da célula A), V entre fileiras (período 1).
   *   reta:  U = ( cos·X + sin·Y)/p,  V = (−sin·X + cos·Y)/p, origem no
   *          centro da imagem (todas as tintas compartilham -> roseta)
   *   onda:  a mesma, com as fileiras deslocadas por uma senoide
   *   leque: V = distância ao centro do leque, U = comprimento de arco
   * Aqui fazemos o caminho inverso: centro de cada célula -> posição na
   * imagem, onde amostramos a cor.
   */
  function buildInkGrid(ink, inkIndex, ctx) {
    const { W, H, p, low, sep, st } = ctx;
    const pat = patterns.get(ink.pattern || st.pattern || 'print');
    const shape = dots.SHAPES[pat.shape];
    const A = shape.aspect;
    const ang = ((ink.angle || 0) + (st.rotation || 0)) * DEG;
    const cos = Math.cos(ang), sin = Math.sin(ang);
    const lattice = raster.LATTICE[pat.lattice];
    const waves = st.waves || {};
    const waveAmp = lattice === 1 || lattice === 2 ? (waves.amplitude == null ? 0.8 : waves.amplitude) : 0;
    const waveK = (2 * Math.PI) / Math.max(1, waves.length || 8);

    // --- orgânico: cada tinta tem sua própria semente derivada da global
    const inkSeed = noise.hash2(st.seed >>> 0, inkIndex + 1);
    const rough = Math.max(0, st.roughness || 0), dist = Math.max(0, st.distortion || 0);
    const G = {
      lattice, kind: raster.KIND[shape.kind], invert: !!pat.invert, A, sdf: shape.sdf,
      cos, sin, ox: W / 2, oy: H / 2, waveAmp, waveK, fanRef: 0,
      // distorção: a grade escorrega até ~0,45 célula, em ondas de ~4,5 células
      warpAmp: dist * 0.45 * p,
      warpFreq: 1 / (4.5 * p),
      warpNoise: noise.perlin(noise.hash2(inkSeed, 1)),
      // rugosidade: a borda anda para dentro/fora até ~12% da célula (+0,6 px),
      // com detalhe grosso (~metade da célula) e fino (~1/7 da célula)
      edgeAmp: shape.kind === 'solid' ? 0 : rough * (0.12 * p + 0.6 * (st.scale || 1)),
      edgeF1: 1 / Math.max(2, 0.45 * p),
      edgeF2: 1 / Math.max(1.2, 0.14 * p),
      edgeNoise: noise.perlin(noise.hash2(inkSeed, 2)),
      grain: shape.kind === 'solid' ? rough * 0.8 : 0,
      driftX: 0, driftY: 0,
    };
    [G.driftX, G.driftY] = ctx.age.driftFor(inkIndex);
    const pad = 3 + Math.ceil(waveAmp) + Math.ceil(G.warpAmp / p) + (st.aging && st.aging.drift > 0 ? 1 : 0);

    // --- limites da grade que cobrem a imagem
    let iMin, iMax, jMin, jMax;
    let fanC = null;
    if (lattice === 3) {
      const fan = st.fan || {};
      const cx = (fan.x == null ? 0.5 : fan.x) * W, cy = (fan.y == null ? 1.4 : fan.y) * H;
      fanC = [cx, cy];
      G.ox = cx; G.oy = cy;
      // referência: direção do centro do leque para o centro da imagem,
      // girada pelo ângulo da tinta (cada tinta "gira" o leque)
      G.fanRef = Math.atan2(H / 2 - cy, W / 2 - cx) + ang;
      const inside = cx >= 0 && cx <= W && cy >= 0 && cy <= H;
      const dx = Math.max(0, -cx, cx - W), dy = Math.max(0, -cy, cy - H);
      const rMin = inside ? 0 : Math.sqrt(dx * dx + dy * dy);
      let rMax = 0, thMax = 0;
      for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
        rMax = Math.max(rMax, Math.hypot(x - cx, y - cy));
        let th = Math.atan2(y - cy, x - cx) - G.fanRef;
        th = Math.atan2(Math.sin(th), Math.cos(th));
        thMax = Math.max(thMax, Math.abs(th));
      }
      if (inside) thMax = Math.PI;
      jMin = Math.max(0, Math.floor(rMin / p) - pad);
      jMax = Math.ceil(rMax / p) + pad;
      thMax = Math.min(Math.PI, thMax + (pad + 1) / Math.max(1, rMin / p));
      const iSpan = Math.ceil((thMax * (jMax + 0.5)) / A) + pad;
      iMin = -iSpan; iMax = iSpan;
    } else {
      let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
      for (const X of [-W / 2, W / 2]) {
        for (const Y of [-H / 2, H / 2]) {
          const u = (cos * X + sin * Y) / p, v = (-sin * X + cos * Y) / p;
          uMin = Math.min(uMin, u); uMax = Math.max(uMax, u);
          vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
        }
      }
      iMin = Math.floor(uMin / A) - pad; iMax = Math.ceil(uMax / A) + pad;
      jMin = Math.floor(vMin) - pad; jMax = Math.ceil(vMax) + pad;
    }
    const gw = iMax - iMin + 1, gh = jMax - jMin + 1;
    const size = new Float32Array(gw * gh).fill(-1);
    const gain = new Float32Array(gw * gh).fill(1);

    const sizer = raster.makeSizer(pat.shape, p, ctx.aa, (ink.angle || 0) + (st.rotation || 0));
    const rgb = [0, 0, 0];
    const cov = new Float64Array(sep.n);
    const sg = [0, 0];
    const margin = 2 * p * Math.max(1, A) + G.warpAmp + Math.hypot(G.driftX, G.driftY);

    for (let gj = 0; gj < gh; gj++) {
      const j = jMin + gj;
      const Vc = j + 0.5;
      for (let gi = 0; gi < gw; gi++) {
        const Uc = (iMin + gi + 0.5) * A;
        // centro da célula na imagem
        let x, y;
        if (lattice === 3) {
          const th = Uc / Vc + G.fanRef, r = Vc * p;
          x = fanC[0] + r * Math.cos(th);
          y = fanC[1] + r * Math.sin(th);
        } else {
          let U = Uc, V = Vc;
          if (lattice === 1) V = Vc + waveAmp * Math.sin(waveK * Uc);
          else if (lattice === 2) {
            for (let it = 0; it < 4; it++) { U = Uc + waveAmp * Math.sin(waveK * V); V = Vc + waveAmp * Math.sin(waveK * U); }
          }
          x = W / 2 + p * (cos * U - sin * V);
          y = H / 2 + p * (sin * U + cos * V);
        }
        if (x < -margin || y < -margin || x > W + margin || y > H + margin) continue;
        sampleLinear(low, x, y, rgb);
        sep.lookup(rgb[0], rgb[1], rgb[2], cov);
        // ganho de ponto (0 = desligado) aplicado à cobertura pedida
        const a = ctx.age.gainCurve(Math.max(0, Math.min(1, cov[inkIndex])));
        // negativo: o formato desenha o FURO, então pede a área de papel
        sizer.sizeAndGain(G.invert ? 1 - a : a, sg);
        const idx = gj * gw + gi;
        size[idx] = sg[0];
        gain[idx] = sg[1];
      }
    }
    Object.assign(G, { iMin, jMin, gw, gh, size, gain });
    return G;
  }

  /*
   * Render principal.
   *   image    = { width, height, data: Uint8Array|Uint8ClampedArray, channels: 3|4 }
   *   settings = ver defaultSettings()
   * Devolve { width, height, data: Uint8ClampedArray RGBA, plates, stats }
   */
  function render(image, userSettings) {
    const t0 = now();
    const st = Object.assign(defaultSettings(), userSettings || {});
    const W = image.width, H = image.height;
    const scale = st.scale || 1;
    const p = Math.max(1.5, st.cellSize * scale); // célula em pixels deste render
    const aa = st.antialias !== false;
    const inks = (st.inks || []).filter((i) => i.enabled !== false);
    const n = inks.length;
    const paperHex = st.paper || '#FFFFFF';

    const inLUT = color.buildInputLUT(st.input);
    const sep = getSeparation(inks, st.separation || {}, paperHex);
    const t1 = now();

    // fator de redução ≈ célula/4; limite de memória para imagens enormes
    let factor = Math.max(1, Math.floor(p / 4));
    factor = Math.max(factor, Math.ceil(Math.sqrt((W * H) / 8e6)));
    const low = downsampleLinear(image, factor, inLUT);
    // desfoque que falta além do que a redução já fez (variâncias somam)
    const sigmaPx = (st.prefilter == null ? 0.4 : st.prefilter) * p;
    blurLinear(low, Math.sqrt(Math.max(0, sigmaPx * sigmaPx - (factor * factor) / 12)) / factor);
    const t2 = now();

    // a escala do preview também escala as distâncias do "orgânico"
    const age = aging.prepare(st.aging, st.seed >>> 0, W, H, p, scale);
    const ctx = { W, H, p, aa, low, sep, st, age };
    const grids = inks.map((ink, k) => buildInkGrid(ink, k, ctx));
    const t3 = now();

    const paper = color.hexToLinear(paperHex);
    const M = sep.M, Add = sep.Add;
    const out = new Uint8ClampedArray(W * H * 4);
    const plates = st.plates ? inks.map(() => new Uint8Array(W * H)) : null;
    const rel = new Float32Array(W * 3); // cor relativa ao papel (1 = papel limpo)
    const cov = new Float32Array(W);
    const usePaper = age.paper > 0, useFade = age.fade > 0, ov = age.overlay;
    const paperRow = usePaper ? new Float32Array(W) : null;
    const holdRow = usePaper ? new Float32Array(W) : null;
    const fadeRow = useFade ? new Float32Array(W) : null;

    for (let y = 0; y < H; y++) {
      rel.fill(1);
      if (usePaper) age.rowPaper(y, W, paperRow, holdRow);
      for (let k = 0; k < n; k++) {
        raster.rasterRow(grids[k], p, aa, y, W, cov);
        // tinta envelhecida: não pega nos poros do papel e desbota em manchas
        if (usePaper) for (let x = 0; x < W; x++) cov[x] *= holdRow[x];
        if (useFade) {
          age.rowFade(k, y, W, fadeRow);
          for (let x = 0; x < W; x++) cov[x] *= fadeRow[x];
        }
        // cada tinta, na ordem: cor ← cor × (1 − c·m) + c·(parte opaca)
        const m0 = M[k * 3], m1 = M[k * 3 + 1], m2 = M[k * 3 + 2];
        const a0 = Add[k * 3], a1 = Add[k * 3 + 1], a2 = Add[k * 3 + 2];
        for (let x = 0; x < W; x++) {
          const c = cov[x];
          if (c > 0) {
            const o = x * 3;
            rel[o] = rel[o] * (1 - c * m0) + c * a0;
            rel[o + 1] = rel[o + 1] * (1 - c * m1) + c * a1;
            rel[o + 2] = rel[o + 2] * (1 - c * m2) + c * a2;
          }
        }
        if (plates) {
          const plate = plates[k], off = y * W;
          for (let x = 0; x < W; x++) plate[off + x] = 255 - Math.round(cov[x] * 255);
        }
      }
      // papel × cor relativa (× textura) -> sRGB 8 bits
      let o = y * W * 4;
      const off = y * W;
      for (let x = 0; x < W; x++, o += 4) {
        let r = rel[x * 3], g = rel[x * 3 + 1], b = rel[x * 3 + 2];
        if (ov) {
          const v = ov[off + x];
          if (v > 0) {
            // fibra clara / falha / arranhão: puxa para a cor do papel
            const t = v / 127;
            r += (1 - r) * t; g += (1 - g) * t; b += (1 - b) * t;
          } else if (v < 0) {
            // fibra escura / poeira: escurece (multiplica)
            const t = 1 + (v / 127) * 0.75;
            r *= t; g *= t; b *= t;
          }
        }
        if (usePaper) { const f = paperRow[x]; r *= f; g *= f; b *= f; }
        out[o] = color.encode8(paper[0] * r);
        out[o + 1] = color.encode8(paper[1] * g);
        out[o + 2] = color.encode8(paper[2] * b);
        out[o + 3] = 255;
      }
    }
    const t4 = now();

    return {
      width: W,
      height: H,
      data: out,
      plates: plates ? plates.map((data, k) => ({ id: inks[k].id, name: inks[k].name, data })) : null,
      stats: {
        separationMs: t1 - t0,
        downsampleMs: t2 - t1,
        gridsMs: t3 - t2,
        pixelsMs: t4 - t3,
        totalMs: t4 - t0,
        cellPx: p,
      },
    };
  }

  function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  return { render, defaultSettings, defaultCMYKInks, patterns: patterns.LIST };
});

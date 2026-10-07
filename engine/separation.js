/*
 * separation.js — separação de cor: de RGB para cobertura de cada tinta.
 *
 * MODELO DE IMPRESSÃO (o mesmo usado na composição final):
 *   As tintas são impressas em ordem (a primeira fica embaixo). Cada tinta,
 *   na área que cobre, faz duas coisas com a cor que já estava lá:
 *     - filtra (tinta transparente): multiplica por T = cor da tinta pura
 *       impressa sobre branco, em luz linear;
 *     - cobre (tinta opaca, "hiding" h): substitui pela cor da tinta.
 *   Com cobertura a (0–1), na média, a cor depois da tinta k é:
 *
 *     cor ← cor × (1 − a·m) + a·h·Tinta      com  m = 1 − (1−h)(1 − s)
 *
 *   s = força × (1 − T) é a "absorção" da tinta em cada canal R, G, B.
 *   Com h = 0 (padrão) é o modelo subtrativo clássico (Murray-Davies /
 *   Neugebauer): amarelo sobre ciano = verde. Com h = 1 a tinta cobre o
 *   que está embaixo (ex.: tinta de fundo opaca, base branca).
 *
 * SEPARAÇÃO: para cada cor da imagem procuramos as coberturas a_i (entre 0
 * e 1) que fazem a fórmula acima chegar o mais perto possível da cor
 * original. É um ajuste de mínimos quadrados com limites (Levenberg-
 * Marquardt), com o erro medido em valores perceptuais (gama ~2,4), senão o
 * ajuste ligaria demais para os brilhos e de menos para as sombras.
 *
 * A imagem é relativa ao papel: branco da imagem = papel sem tinta.
 *
 * Resolver isso por pixel seria lento, então resolvemos numa grade 3D de
 * cores (33×33×33) e cada pixel interpola a tabela (trilinear), igual a
 * um perfil ICC.
 *
 * MODO CMYK: o preto (tinta com role 'k') é definido por uma regra de
 * "geração de preto" (GCR) e as outras tintas são resolvidas em cima dele.
 * MODO 'solve': todas as tintas livres (usado para N tintas na Fase 2).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./color.js'));
  else (root.HT = root.HT || {}).separation = factory(root.HT.color);
})(typeof self !== 'undefined' ? self : this, function (color) {
  'use strict';

  const GAMMA = 1 / 2.4; // espaço perceptual onde medimos o erro
  const LUM = [0.2126, 0.7152, 0.0722];
  const W_CHANNEL = 1; // peso do erro em cada canal R, G, B
  const W_LUM = 2; // peso extra na luminosidade (tom é o que o olho mais nota)
  const REG = 1e-4; // leve preferência por usar menos tinta (desempate)
  const MIN_T = 1e-4;

  /*
   * Coeficientes do modelo por tinta e canal, relativos ao papel:
   *   M[k*3+c]   = m (quanto a cor de baixo é "apagada" onde há tinta)
   *   Add[k*3+c] = h × cor da tinta / papel (quanto a tinta opaca acrescenta)
   */
  function inkModel(inks, paperHex) {
    const n = inks.length;
    const M = new Float64Array(n * 3), Add = new Float64Array(n * 3);
    const P = color.hexToLinear(paperHex || '#FFFFFF');
    inks.forEach((ink, k) => {
      const T = color.hexToLinear(ink.color);
      const op = ink.opacity == null ? 1 : Math.max(0, Math.min(1, ink.opacity));
      const h = Math.max(0, Math.min(1, ink.hiding || 0));
      for (let c = 0; c < 3; c++) {
        const sAbs = op * (1 - T[c]);
        M[k * 3 + c] = Math.min(0.9995, 1 - (1 - h) * (1 - sAbs));
        Add[k * 3 + c] = (h * op * T[c]) / Math.max(P[c], 1e-4);
      }
    });
    return { M, Add };
  }

  // ---------------------------------------------------------------------
  // Solver por cor (Levenberg-Marquardt com limites 0–1).

  function makeSolver(model, n) {
    const { M, Add } = model;
    const m = 4 + n; // resíduos: R, G, B, luminância, + regularização por tinta
    const r = new Float64Array(m);
    const J = new Float64Array(m * n);
    const A = new Float64Array(n * n);
    const g = new Float64Array(n);
    const delta = new Float64Array(n);
    const trial = new Float64Array(n);
    const P = new Float64Array(3);
    const tg = new Float64Array(4); // alvo no espaço perceptual
    const sqReg = Math.sqrt(REG);
    const outs = new Float64Array((n + 1) * 3); // cor antes de cada tinta
    const dP = new Float64Array(n * 3); // derivada da cor final por tinta
    const suffix = new Float64Array(3);

    // Aplica as tintas em ordem (modelo descrito no topo do arquivo).
    function predict(a) {
      P[0] = P[1] = P[2] = 1;
      for (let k = 0; k < n; k++) {
        for (let c = 0; c < 3; c++) {
          outs[k * 3 + c] = P[c];
          P[c] = P[c] * (1 - a[k] * M[k * 3 + c]) + a[k] * Add[k * 3 + c];
        }
      }
    }

    function cost(a) {
      predict(a);
      let e = 0;
      for (let c = 0; c < 3; c++) {
        const d = W_CHANNEL * (Math.pow(Math.max(P[c], MIN_T), GAMMA) - tg[c]);
        e += d * d;
      }
      const Y = LUM[0] * P[0] + LUM[1] * P[1] + LUM[2] * P[2];
      const dY = W_LUM * (Math.pow(Math.max(Y, MIN_T), GAMMA) - tg[3]);
      e += dY * dY;
      for (let i = 0; i < n; i++) e += REG * a[i] * a[i];
      return e;
    }

    // Monta resíduos e jacobiana no ponto a.
    function linearize(a) {
      predict(a);
      // dP_c/da_k = (−cor_antes·m + h·Tinta) × Π_{tintas depois de k} (1 − a·m)
      suffix[0] = suffix[1] = suffix[2] = 1;
      for (let k = n - 1; k >= 0; k--) {
        for (let c = 0; c < 3; c++) {
          dP[k * 3 + c] = (-outs[k * 3 + c] * M[k * 3 + c] + Add[k * 3 + c]) * suffix[c];
          suffix[c] *= 1 - a[k] * M[k * 3 + c];
        }
      }
      J.fill(0);
      const Pg = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const pc = Math.max(P[c], MIN_T);
        Pg[c] = Math.pow(pc, GAMMA);
        r[c] = W_CHANNEL * (Pg[c] - tg[c]);
      }
      const Y = Math.max(LUM[0] * P[0] + LUM[1] * P[1] + LUM[2] * P[2], MIN_T);
      const Yg = Math.pow(Y, GAMMA);
      r[3] = W_LUM * (Yg - tg[3]);
      for (let i = 0; i < n; i++) {
        let dY = 0;
        for (let c = 0; c < 3; c++) {
          const pc = Math.max(P[c], MIN_T);
          J[c * n + i] = W_CHANNEL * GAMMA * (Pg[c] / pc) * dP[i * 3 + c];
          dY += LUM[c] * dP[i * 3 + c];
        }
        J[3 * n + i] = W_LUM * GAMMA * (Yg / Y) * dY;
        r[4 + i] = sqReg * a[i];
        J[(4 + i) * n + i] = sqReg;
      }
    }

    // Resolve o sistema pequeno A·x = b só nas variáveis ativas (eliminação
    // de Gauss com pivô parcial).
    function solveActive(active, k, mu) {
      const M = new Float64Array(k * (k + 1));
      for (let p = 0; p < k; p++) {
        const i = active[p];
        for (let q = 0; q < k; q++) {
          const j = active[q];
          M[p * (k + 1) + q] = A[i * n + j] + (p === q ? mu * (A[i * n + i] + 1e-9) : 0);
        }
        M[p * (k + 1) + k] = -g[i];
      }
      for (let col = 0; col < k; col++) {
        let piv = col;
        for (let row = col + 1; row < k; row++) {
          if (Math.abs(M[row * (k + 1) + col]) > Math.abs(M[piv * (k + 1) + col])) piv = row;
        }
        if (piv !== col) {
          for (let x = 0; x <= k; x++) {
            const t = M[col * (k + 1) + x];
            M[col * (k + 1) + x] = M[piv * (k + 1) + x];
            M[piv * (k + 1) + x] = t;
          }
        }
        const d = M[col * (k + 1) + col];
        if (Math.abs(d) < 1e-14) continue;
        for (let row = 0; row < k; row++) {
          if (row === col) continue;
          const f = M[row * (k + 1) + col] / d;
          if (f === 0) continue;
          for (let x = col; x <= k; x++) M[row * (k + 1) + x] -= f * M[col * (k + 1) + x];
        }
      }
      delta.fill(0);
      for (let p = 0; p < k; p++) {
        const d = M[p * (k + 1) + p];
        delta[active[p]] = Math.abs(d) < 1e-14 ? 0 : M[p * (k + 1) + k] / d;
      }
    }

    /*
     * target: [r, g, b] linear (relativo ao papel)
     * free:   Uint8Array(n), 1 = tinta livre, 0 = fixa (mantém o valor de a)
     * a:      Float64Array(n) chute inicial -> resposta
     */
    return function solve(target, free, a) {
      for (let c = 0; c < 3; c++) tg[c] = Math.pow(Math.max(target[c], MIN_T), GAMMA);
      tg[3] = Math.pow(Math.max(LUM[0] * target[0] + LUM[1] * target[1] + LUM[2] * target[2], MIN_T), GAMMA);

      let mu = 1e-3;
      let current = cost(a);
      const active = new Int32Array(n);
      for (let iter = 0; iter < 40; iter++) {
        linearize(a);
        // gradiente g = Jᵀr e matriz aproximada A = JᵀJ
        for (let i = 0; i < n; i++) {
          let s = 0;
          for (let row = 0; row < m; row++) s += J[row * n + i] * r[row];
          g[i] = s;
          for (let j = 0; j < n; j++) {
            let t = 0;
            for (let row = 0; row < m; row++) t += J[row * n + i] * J[row * n + j];
            A[i * n + j] = t;
          }
        }
        // variáveis travadas no limite e empurrando para fora ficam paradas
        let k = 0;
        for (let i = 0; i < n; i++) {
          if (!free[i]) continue;
          if (a[i] <= 0 && g[i] > 0) continue;
          if (a[i] >= 1 && g[i] < 0) continue;
          active[k++] = i;
        }
        if (k === 0) break;

        let improved = false;
        for (let tries = 0; tries < 8; tries++) {
          solveActive(active, k, mu);
          let maxStep = 0;
          for (let i = 0; i < n; i++) {
            trial[i] = Math.max(0, Math.min(1, a[i] + delta[i]));
            maxStep = Math.max(maxStep, Math.abs(trial[i] - a[i]));
          }
          const c = cost(trial);
          if (c < current) {
            a.set(trial);
            current = c;
            mu = Math.max(mu / 3, 1e-7);
            improved = maxStep > 1e-6;
            break;
          }
          mu *= 4;
        }
        if (!improved) break;
      }
      return a;
    };
  }

  // ---------------------------------------------------------------------
  // Tabela 3D de separação.

  const GRID_N = 33;

  /*
   * config = {
   *   inks: [{ color: '#00AEEF', opacity: 1, hiding: 0, role: 'c'|'m'|'y'|'k'|undefined }],
   *   paper: '#FFFFFF'  (só importa para tintas opacas)
   *   mode: 'cmyk' | 'solve',
   *   gcr: 0–1          (quanto do cinza vai para o preto; só no modo cmyk)
   *   blackStart: 0–1   (a partir de que escurecimento o preto começa)
   * }
   */
  function buildSeparation(config) {
    const inks = config.inks;
    const n = inks.length;
    const model = inkModel(inks, config.paper);
    const solve = makeSolver(model, n);
    const N = GRID_N;
    const lut = new Float32Array(N * N * N * n);

    const kIndex = config.mode === 'cmyk' ? inks.findIndex((ink) => ink.role === 'k') : -1;
    const gcr = config.gcr == null ? 0.7 : config.gcr;
    const blackStart = config.blackStart == null ? 0.15 : config.blackStart;
    // absorção máxima do preto (para saber quanto preto "cabe" num cinza)
    const kMaxAbs = kIndex >= 0 ? Math.max(model.M[kIndex * 3], model.M[kIndex * 3 + 1], model.M[kIndex * 3 + 2]) : 1;

    const free = new Uint8Array(n).fill(1);
    if (kIndex >= 0) free[kIndex] = 0;

    const a = new Float64Array(n);
    const target = [0, 0, 0];
    const nodeLin = new Float64Array(N);
    for (let i = 0; i < N; i++) nodeLin[i] = color.srgbToLinear(i / (N - 1));

    for (let bi = 0; bi < N; bi++) {
      for (let gi = 0; gi < N; gi++) {
        for (let ri = 0; ri < N; ri++) {
          const node = (bi * N + gi) * N + ri;
          // chute inicial = solução do nó vizinho (deixa a tabela contínua,
          // sem saltos entre soluções — importante para degradês limpos)
          let prev = -1;
          if (ri > 0) prev = node - 1;
          else if (gi > 0) prev = node - N;
          else if (bi > 0) prev = node - N * N;
          if (prev >= 0) for (let i = 0; i < n; i++) a[i] = lut[prev * n + i];
          else a.fill(0);

          target[0] = nodeLin[ri];
          target[1] = nodeLin[gi];
          target[2] = nodeLin[bi];

          if (kIndex >= 0) {
            // Geração de preto (GCR): "g" é o quanto a cor é escura/acinzentada
            // (1 − canal mais claro). O preto entra a partir de blackStart e
            // cresce até o máximo que não escurece nenhum canal além do alvo.
            const maxT = Math.max(target[0], target[1], target[2]);
            const gray = 1 - Math.max(ri, gi, bi) / (N - 1);
            const ramp = blackStart >= 1 ? 0 : Math.max(0, Math.min(1, (gray - blackStart) / (1 - blackStart)));
            const kFull = Math.min(1, (1 - maxT) / kMaxAbs);
            a[kIndex] = gcr * ramp * kFull;
          }

          solve(target, free, a);
          for (let i = 0; i < n; i++) lut[node * n + i] = a[i];
        }
      }
    }

    // Consulta: RGB linear -> coberturas (escreve em out, tamanho n).
    function lookup(rLin, gLin, bLin, out) {
      const x = color.linearToSrgb(rLin) * (N - 1);
      const y = color.linearToSrgb(gLin) * (N - 1);
      const z = color.linearToSrgb(bLin) * (N - 1);
      const x0 = Math.min(N - 2, x | 0), y0 = Math.min(N - 2, y | 0), z0 = Math.min(N - 2, z | 0);
      const fx = x - x0, fy = y - y0, fz = z - z0;
      const base = ((z0 * N + y0) * N + x0) * n;
      const dx = n, dy = N * n, dz = N * N * n;
      for (let i = 0; i < n; i++) {
        const p = base + i;
        const c00 = lut[p] + (lut[p + dx] - lut[p]) * fx;
        const c10 = lut[p + dy] + (lut[p + dy + dx] - lut[p + dy]) * fx;
        const c01 = lut[p + dz] + (lut[p + dz + dx] - lut[p + dz]) * fx;
        const c11 = lut[p + dz + dy] + (lut[p + dz + dy + dx] - lut[p + dz + dy]) * fx;
        const c0 = c00 + (c10 - c00) * fy;
        const c1 = c01 + (c11 - c01) * fy;
        out[i] = c0 + (c1 - c0) * fz;
      }
      return out;
    }

    return { n, M: model.M, Add: model.Add, lookup, lut, gridN: N };
  }

  return { buildSeparation, inkModel };
});

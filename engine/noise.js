/*
 * noise.js — ruído suave com seed fixa (Perlin 2D).
 *
 * É a fonte de todo o "orgânico": borda irregular dos pontos, grade que
 * ondula levemente, grão. A seed garante que as mesmas configurações dão
 * sempre o mesmo resultado (exigência do projeto).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.HT = root.HT || {}).noise = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Gerador pseudoaleatório pequeno e rápido (mulberry32).
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Mistura dois inteiros num hash (para derivar seeds por tinta etc.).
  function hash2(a, b) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
    h ^= h >>> 13;
    h = Math.imul(h, 0x27d4eb2f);
    return (h ^ (h >>> 16)) >>> 0;
  }

  const cache = new Map();

  /*
   * Devolve uma função noise(x, y) ≈ −1..1, suave, com período grande.
   * Cada seed gera um campo diferente.
   */
  function perlin(seed) {
    seed = seed >>> 0;
    if (cache.has(seed)) return cache.get(seed);
    const r = rng(seed);
    const perm = new Uint8Array(512);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    // 8 direções de gradiente
    const GX = [1, -1, 1, -1, 1.4142, -1.4142, 0, 0];
    const GY = [1, 1, -1, -1, 0, 0, 1.4142, -1.4142];

    function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

    function noise(x, y) {
      const xf = Math.floor(x), yf = Math.floor(y);
      const X = xf & 255, Y = yf & 255;
      const fx = x - xf, fy = y - yf;
      const aa = perm[perm[X] + Y] & 7, ab = perm[perm[X] + Y + 1] & 7;
      const ba = perm[perm[X + 1] + Y] & 7, bb = perm[perm[X + 1] + Y + 1] & 7;
      const n00 = GX[aa] * fx + GY[aa] * fy;
      const n10 = GX[ba] * (fx - 1) + GY[ba] * fy;
      const n01 = GX[ab] * fx + GY[ab] * (fy - 1);
      const n11 = GX[bb] * (fx - 1) + GY[bb] * (fy - 1);
      const u = fade(fx), v = fade(fy);
      const nx0 = n00 + (n10 - n00) * u;
      const nx1 = n01 + (n11 - n01) * u;
      return (nx0 + (nx1 - nx0) * v) * 0.75;
    }
    cache.set(seed, noise);
    if (cache.size > 32) cache.delete(cache.keys().next().value);
    return noise;
  }

  return { rng, hash2, perlin };
});

/*
 * color.js — conversões de cor usadas pelo motor.
 *
 * Por que luz linear: tinta e papel se misturam multiplicando a luz refletida
 * (física), e o anti-aliasing mistura áreas (média de luz). As duas contas só
 * dão certo em valores LINEARES. Os valores sRGB da imagem (0–255) são
 * "codificados" com uma curva de gama; convertemos para linear, fazemos as
 * contas e codificamos de volta só no final.
 *
 * Formato UMD: funciona via <script> no navegador, importScripts no Worker
 * e require() no Node/UXP.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.HT = root.HT || {}).color = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Curva oficial do sRGB (IEC 61966-2-1).
  function srgbToLinear(v) {
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(v) {
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }

  // Tabela linear -> sRGB 8 bits. 16384 entradas deixam o erro abaixo de
  // 0,25 nível mesmo nas sombras (onde a curva é mais íngreme).
  const ENC_SIZE = 16384;
  const LINEAR_TO_SRGB8 = new Uint8Array(ENC_SIZE + 1);
  for (let i = 0; i <= ENC_SIZE; i++) {
    LINEAR_TO_SRGB8[i] = Math.round(linearToSrgb(i / ENC_SIZE) * 255);
  }
  function encode8(lin) {
    if (lin <= 0) return 0;
    if (lin >= 1) return 255;
    return LINEAR_TO_SRGB8[(lin * ENC_SIZE + 0.5) | 0];
  }

  // "#00AEEF" ou "00AEEF" -> [0, 174, 239]
  function parseHex(hex) {
    let h = String(hex).trim().replace(/^#/, '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    if (h.length !== 6 || Number.isNaN(n)) throw new Error('Cor inválida: ' + hex);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function toHex(rgb) {
    return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  // Cor hex -> [r, g, b] em luz linear (0–1).
  function hexToLinear(hex) {
    return parseHex(hex).map((v) => srgbToLinear(v / 255));
  }

  /*
   * Curva de entrada: brilho, contraste e gama aplicados na imagem ANTES da
   * separação, em valores sRGB (perceptuais, como os ajustes do Photoshop).
   * Devolve uma tabela de 256 posições que já converte direto para linear:
   * valor 8 bits da imagem -> luz linear pronta para o motor.
   *
   *   brightness: -1 a 1   (0 = neutro)
   *   contrast:   -1 a 1   (0 = neutro)
   *   gamma:      0.2 a 5  (1 = neutro; >1 clareia os meios-tons)
   */
  function buildInputLUT(input) {
    const b = (input && input.brightness) || 0;
    const c = (input && input.contrast) || 0;
    const g = (input && input.gamma) || 1;
    // Contraste em curva de potência simétrica em torno do cinza médio
    // (fica suave nos extremos, sem cortar sombras/luzes de forma seca).
    const k = c >= 0 ? 1 + c * 3 : 1 / (1 - c * 3);
    const lut = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      let v = i / 255;
      v = Math.max(0, Math.min(1, v + b));
      if (k !== 1) {
        v = v < 0.5 ? 0.5 * Math.pow(2 * v, k) : 1 - 0.5 * Math.pow(2 * (1 - v), k);
      }
      if (g !== 1) v = Math.pow(v, 1 / g);
      lut[i] = srgbToLinear(v);
    }
    return lut;
  }

  // Luminância relativa (Rec. 709) de um RGB linear.
  function luminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  return { srgbToLinear, linearToSrgb, encode8, parseHex, toHex, hexToLinear, buildInputLUT, luminance };
});

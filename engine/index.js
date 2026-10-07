/*
 * index.js — ponto de entrada do motor para Node e UXP:
 *   const HT = require('./engine');
 *   const result = HT.render({ width, height, data, channels: 4 }, settings);
 *
 * No navegador/Worker, carregue os arquivos na ordem
 *   color.js, noise.js, dots.js, patterns.js, separation.js, raster.js, aging.js, halftone.js
 * e use o objeto global HT (HT.halftone.render).
 */
const color = require('./color.js');
const noise = require('./noise.js');
const dots = require('./dots.js');
const patterns = require('./patterns.js');
const separation = require('./separation.js');
const raster = require('./raster.js');
const aging = require('./aging.js');
const halftone = require('./halftone.js');

module.exports = {
  color,
  noise,
  dots,
  patterns,
  separation,
  raster,
  aging,
  halftone,
  render: halftone.render,
  defaultSettings: halftone.defaultSettings,
};

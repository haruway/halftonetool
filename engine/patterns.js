/*
 * patterns.js — catálogo de padrões da retícula.
 *
 * Padrão = formato (dots.js) + grade + negativo:
 *   grade 'straight' — reta, girada no ângulo da tinta
 *   grade 'wave'     — linhas da grade onduladas (senoide)
 *   grade 'wave2'    — ondulada nas duas direções (para cruzados)
 *   grade 'fan'      — leque: fileiras em arcos concêntricos
 *   invert           — negativo: o formato vira o FURO e a tinta é o resto
 *
 * Para criar um padrão novo, basta combinar peças aqui.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.HT = root.HT || {}).patterns = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIST = [
    { id: 'print', name: 'Pontos de impressão', shape: 'euclid', lattice: 'straight' },
    { id: 'dots', name: 'Pontos positivos', shape: 'round', lattice: 'straight' },
    { id: 'dots-neg', name: 'Pontos negativos', shape: 'round', lattice: 'straight', invert: true },
    { id: 'lines', name: 'Linhas', shape: 'line', lattice: 'straight' },
    { id: 'lines-broken', name: 'Linhas quebradas', shape: 'dash', lattice: 'straight' },
    { id: 'cross', name: 'Linhas cruzadas', shape: 'cross', lattice: 'straight' },
    { id: 'waves', name: 'Ondas', shape: 'line', lattice: 'wave' },
    { id: 'waves-broken', name: 'Ondas quebradas', shape: 'dash', lattice: 'wave' },
    { id: 'waves-cross', name: 'Ondas cruzadas', shape: 'cross', lattice: 'wave2' },
    { id: 'fan', name: 'Leque', shape: 'round', lattice: 'fan' },
    { id: 'fan-neg', name: 'Leque negativo', shape: 'round', lattice: 'fan', invert: true },
    { id: 'solid', name: 'Tinta chapada', shape: 'solid', lattice: 'straight' },
  ];
  const BY_ID = {};
  LIST.forEach((p) => (BY_ID[p.id] = p));
  BY_ID.round = BY_ID.dots; // compatibilidade com a Fase 1

  function get(id) {
    const p = BY_ID[id];
    if (!p) throw new Error('Padrão desconhecido: ' + id);
    return p;
  }

  return { LIST, get };
});

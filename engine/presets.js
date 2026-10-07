/*
 * presets.js — presets de referência.
 *
 * Cada preset é um pedaço de configurações (o resto vem dos padrões do
 * motor). "cellSize" é a célula para uma imagem de 1200 px no lado menor;
 * quem aplica o preset escala para o tamanho real da imagem (use
 * presets.cellFor(preset, largura, altura)), assim o preset fica com a
 * mesma cara em qualquer resolução.
 *
 * Formato de um preset salvo pelo usuário (JSON): igual a estes objetos.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.HT = root.HT || {}).presets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const REF = 1200; // lado menor de referência

  // atalhos para montar tintas
  const ink = (name, color, angle, extra) => Object.assign({ name, color, angle }, extra || {});
  const CMYK = (pattern) => [
    ink('Ciano', '#00AEEF', 15, { role: 'c', pattern }),
    ink('Magenta', '#EC008C', 75, { role: 'm', pattern }),
    ink('Amarelo', '#FFF200', 0, { role: 'y', pattern }),
    ink('Preto', '#231F20', 45, { role: 'k', pattern }),
  ];
  const age = (paper, fibers, dust, fade, drift, dotGain) => ({ paper, fibers, dust, fade, drift, dotGain });
  const SOLVE = { mode: 'solve' };

  const LIST = [
    {
      id: 'pulp', name: 'Gibi Pulp', cellSize: 10, pattern: 'print', roughness: 0.45, distortion: 0.3,
      paper: '#E9DDC2', separation: SOLVE, aging: age(0.6, 0.4, 0.3, 0.3, 0.3, 0.3),
      inks: [ink('Amarelo', '#F2C230', 0), ink('Vermelho', '#D9452B', 75), ink('Ciano', '#2B8C9A', 15), ink('Preto', '#231E1C', 45)],
    },
    {
      id: 'cartaz-misto', name: 'Cartaz Misto', cellSize: 11, pattern: 'print', roughness: 0.45, distortion: 0.3,
      paper: '#ECDFC3', separation: SOLVE, aging: age(0.65, 0.5, 0.35, 0.35, 0.3, 0.25),
      inks: [
        ink('Amarelo', '#F2C744', 0, { pattern: 'solid' }),
        ink('Laranja', '#E2572C', 45, { pattern: 'lines' }),
        ink('Petróleo', '#1F7A80', 15, { pattern: 'dots' }),
        ink('Preto', '#1C1A19', 75, { pattern: 'print' }),
      ],
    },
    {
      id: 'retro4', name: 'Retrô 4 Cores', cellSize: 10, pattern: 'print', roughness: 0.4, distortion: 0.25,
      paper: '#EFE6D2', separation: SOLVE, aging: age(0.45, 0.3, 0.15, 0.2, 0.2, 0.2),
      inks: [ink('Ocre', '#D9A13B', 0), ink('Rosa', '#DD6A8C', 75), ink('Petróleo', '#2E7C83', 15), ink('Marrom', '#33261F', 45)],
    },
    {
      id: 'tritone-laranja', name: 'Tritone Laranja', cellSize: 9, pattern: 'print', roughness: 0.5, distortion: 0.35,
      paper: '#EFE6D2', separation: SOLVE, aging: age(0.4, 0.25, 0.1, 0.15, 0.15, 0.2),
      inks: [ink('Laranja', '#E8642C', 15), ink('Petróleo', '#1E6B73', 75), ink('Marrom', '#2A211D', 45)],
    },
    {
      id: 'gravura-duo', name: 'Gravura Duotone', cellSize: 8, pattern: 'lines', roughness: 0.5, distortion: 0.3,
      paper: '#F1E8D6', separation: SOLVE, aging: age(0.35, 0.3, 0.1, 0.1, 0.1, 0.15),
      inks: [ink('Vermelho', '#D9502F', 30), ink('Marinho', '#1D2B4A', -30)],
    },
    {
      id: 'ondas-psico', name: 'Ondas Psicodélicas', cellSize: 9, pattern: 'waves', roughness: 0.3, distortion: 0.2,
      waves: { amplitude: 1, length: 9 },
      paper: '#F4EDE0', separation: SOLVE, aging: age(0.3, 0.2, 0.05, 0.1, 0.25, 0.1),
      inks: [ink('Amarelo', '#F5C842', 0), ink('Rosa', '#E84A7F', 60), ink('Roxo', '#3B2A6B', 120)],
    },
    {
      id: 'jornal', name: 'Jornal Antigo', cellSize: 7, pattern: 'print', roughness: 0.55, distortion: 0.3,
      paper: '#E3DED2', separation: SOLVE, input: { contrast: 0.15 }, aging: age(0.8, 0.6, 0.5, 0.35, 0, 0.45),
      inks: [ink('Preto', '#1E1B1A', 45)],
    },
    {
      id: 'riso-azul-rosa', name: 'Riso Azul e Rosa', cellSize: 8, pattern: 'dots', roughness: 0.35, distortion: 0.2,
      paper: '#F6F3EC', separation: SOLVE, aging: age(0.4, 0.2, 0.15, 0.4, 0.5, 0.15),
      inks: [ink('Rosa flúor', '#FF48B0', 15), ink('Azul', '#0078BF', 75)],
    },
    {
      id: 'riso-verde-laranja', name: 'Riso Verde e Laranja', cellSize: 8, pattern: 'print', roughness: 0.35, distortion: 0.2,
      paper: '#F6F3EC', separation: SOLVE, aging: age(0.4, 0.2, 0.15, 0.4, 0.5, 0.15),
      inks: [ink('Laranja', '#FF6C2F', 15), ink('Verde', '#00A95C', 75)],
    },
    {
      id: 'leque-solar', name: 'Leque Solar', cellSize: 11, pattern: 'fan', roughness: 0.35, distortion: 0.2,
      fan: { x: 0.5, y: 1.35 },
      paper: '#F2E6CF', separation: SOLVE, aging: age(0.4, 0.3, 0.1, 0.15, 0.15, 0.2),
      inks: [ink('Amarelo', '#F4B738', 0), ink('Vermelho', '#C9332B', 20), ink('Marrom', '#3A1F1A', 40)],
    },
    {
      id: 'gravura-mono', name: 'Gravura Cruzada', cellSize: 7, pattern: 'cross', roughness: 0.45, distortion: 0.3,
      paper: '#F0E8D8', separation: SOLVE, input: { contrast: 0.1 }, aging: age(0.45, 0.35, 0.15, 0.1, 0, 0.2),
      inks: [ink('Sépia', '#2B211C', 30)],
    },
    {
      id: 'cmyk-limpo', name: 'CMYK Limpo', cellSize: 10, pattern: 'dots', roughness: 0, distortion: 0,
      paper: '#FFFFFF', separation: { mode: 'cmyk', gcr: 0.7, blackStart: 0.15 }, aging: age(0, 0, 0, 0, 0, 0),
      inks: CMYK(),
    },
    {
      id: 'cmyk-gasto', name: 'CMYK Gasto', cellSize: 10, pattern: 'print', roughness: 0.45, distortion: 0.3,
      paper: '#EDE3CC', separation: { mode: 'cmyk', gcr: 0.6, blackStart: 0.2 }, aging: age(0.6, 0.45, 0.35, 0.35, 0.4, 0.35),
      inks: CMYK(),
    },
    {
      id: 'noir', name: 'Noir Negativo', cellSize: 9, pattern: 'dots-neg', roughness: 0.4, distortion: 0.25,
      paper: '#EAE4D8', separation: SOLVE, input: { contrast: 0.2 }, aging: age(0.5, 0.35, 0.3, 0.2, 0, 0.2),
      inks: [ink('Preto', '#151414', 45)],
    },
    {
      id: 'ondas-cruzadas', name: 'Ondas Cruzadas', cellSize: 9, pattern: 'waves-cross', roughness: 0.35, distortion: 0.2,
      waves: { amplitude: 0.7, length: 10 },
      paper: '#F1EADB', separation: SOLVE, aging: age(0.35, 0.25, 0.1, 0.1, 0.1, 0.15),
      inks: [ink('Azul-marinho', '#1E2F55', 20), ink('Terracota', '#B8492F', 65)],
    },
    {
      id: 'surf', name: 'Surf Vintage', cellSize: 9, pattern: 'waves-broken', roughness: 0.45, distortion: 0.3,
      waves: { amplitude: 0.9, length: 8 },
      paper: '#EFE4CB', separation: SOLVE, aging: age(0.55, 0.4, 0.2, 0.3, 0.25, 0.2),
      inks: [ink('Areia', '#E3B26A', 0), ink('Coral', '#E86A4E', 30), ink('Petróleo', '#1F6F78', 60)],
    },
    {
      id: 'linhas-quebradas', name: 'Traço Quebrado', cellSize: 9, pattern: 'lines-broken', roughness: 0.4, distortion: 0.3,
      paper: '#F0E7D4', separation: SOLVE, aging: age(0.45, 0.3, 0.15, 0.2, 0.2, 0.2),
      inks: [ink('Vermelho', '#D2402E', 15), ink('Azul', '#25508A', 75), ink('Preto', '#1F1C1B', 45)],
    },
    {
      id: 'chapado', name: 'Chapado Granulado', cellSize: 10, pattern: 'solid', roughness: 0.6, distortion: 0,
      paper: '#ECE1C8', separation: SOLVE, aging: age(0.6, 0.5, 0.3, 0.45, 0.35, 0),
      inks: [ink('Mostarda', '#D9A43A', 0), ink('Vinho', '#8E2F3B', 0), ink('Petróleo', '#1E5A61', 0)],
    },
    {
      id: 'pop-art', name: 'Pop Art', cellSize: 14, pattern: 'dots', roughness: 0.2, distortion: 0.1,
      paper: '#FFF8EC', separation: SOLVE, input: { contrast: 0.25 }, aging: age(0.2, 0.1, 0.05, 0.1, 0.35, 0.1),
      inks: [ink('Amarelo', '#FFD400', 0), ink('Vermelho', '#E4202B', 75), ink('Azul', '#0067B1', 15), ink('Preto', '#141414', 45, { pattern: 'print' })],
    },
    {
      id: 'tigre', name: 'Gravura Tigre', cellSize: 7, pattern: 'lines', roughness: 0.5, distortion: 0.35,
      paper: '#EFE3C4', separation: SOLVE, aging: age(0.55, 0.4, 0.25, 0.25, 0.25, 0.25),
      inks: [
        ink('Amarelo', '#F0C24B', 0, { pattern: 'solid' }),
        ink('Laranja', '#E06A2C', 35),
        ink('Petróleo', '#257A7E', 105, { pattern: 'lines-broken' }),
        ink('Preto', '#1E1A18', 70),
      ],
    },
  ];

  // célula do preset para uma imagem W×H
  function cellFor(preset, W, H) {
    const c = (preset.cellSize || 10) * (Math.min(W, H) / REF);
    return Math.max(3, Math.round(c * 2) / 2);
  }

  return { LIST, REF, cellFor };
});

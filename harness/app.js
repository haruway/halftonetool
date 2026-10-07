/*
 * Harness de teste do motor de halftone (fase 2).
 * Carrega uma imagem, manda para o motor (num Web Worker) e mostra o
 * resultado. Preview em resolução reduzida (escala a célula junto) e
 * export sempre na resolução total.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const worker = new Worker('worker.js');

  // ---------------------------------------------------------------------
  // Catálogos

  const PATTERNS = [
    ['print', 'Pontos de impressão'], ['dots', 'Pontos positivos'], ['dots-neg', 'Pontos negativos'],
    ['lines', 'Linhas'], ['lines-broken', 'Linhas quebradas'], ['cross', 'Linhas cruzadas'],
    ['waves', 'Ondas'], ['waves-broken', 'Ondas quebradas'], ['waves-cross', 'Ondas cruzadas'],
    ['fan', 'Leque'], ['fan-neg', 'Leque negativo'], ['solid', 'Tinta chapada'],
  ];

  // Conjuntos de tintas prontos (ponto de partida; tudo é editável).
  const INK_SETS = {
    cmyk: {
      name: 'CMYK de processo', mode: 'cmyk', paper: '#FFFFFF',
      inks: [
        { name: 'Ciano', role: 'c', color: '#00AEEF', angle: 15 },
        { name: 'Magenta', role: 'm', color: '#EC008C', angle: 75 },
        { name: 'Amarelo', role: 'y', color: '#FFF200', angle: 0 },
        { name: 'Preto', role: 'k', color: '#231F20', angle: 45 },
      ],
    },
    retro4: {
      name: 'Retrô 4 cores', mode: 'solve', paper: '#EFE6D2',
      inks: [
        { name: 'Ocre', color: '#D9A13B', angle: 0 },
        { name: 'Rosa', color: '#DD6A8C', angle: 75 },
        { name: 'Petróleo', color: '#2E7C83', angle: 15 },
        { name: 'Marrom', color: '#33261F', angle: 45 },
      ],
    },
    tritone: {
      name: 'Tritone laranja/petróleo', mode: 'solve', paper: '#EFE6D2',
      inks: [
        { name: 'Laranja', color: '#E8642C', angle: 15 },
        { name: 'Petróleo', color: '#1E6B73', angle: 75 },
        { name: 'Marrom', color: '#2A211D', angle: 45 },
      ],
    },
    duotone: {
      name: 'Duotone vermelho/marinho', mode: 'solve', paper: '#F1E8D6',
      inks: [
        { name: 'Vermelho', color: '#D9502F', angle: 30 },
        { name: 'Marinho', color: '#1D2B4A', angle: -30 },
      ],
    },
    mono: {
      name: 'Mono (uma tinta)', mode: 'solve', paper: '#F3EEE3',
      inks: [{ name: 'Preto', color: '#1E1B1A', angle: 45 }],
    },
  };

  const PAPERS = [['Branco', '#FFFFFF'], ['Creme', '#EFE6D2'], ['Jornal', '#E3DED2'], ['Kraft', '#C8A57A']];

  // ---------------------------------------------------------------------
  // Estado

  let inkUid = 0;
  function makeInks(set) {
    return set.inks.map((i) => ({
      id: 'i' + ++inkUid, name: i.name, role: i.role, color: i.color, angle: i.angle,
      enabled: true, opacity: 1, hiding: 0, pattern: '',
    }));
  }

  const state = {
    full: null, preview: null, result: null,
    pattern: 'print',
    inks: makeInks(INK_SETS.cmyk),
    view: 'composite', zoom: 'fit',
  };

  // ---------------------------------------------------------------------
  // Sliders simples

  const sliders = {
    cellSize: (v) => v,
    roughness: (v) => Math.round(v * 100),
    distortion: (v) => Math.round(v * 100),
    rotation: (v) => v + '°',
    angleStep: (v) => v + '°',
    prefilter: (v) => (+v).toFixed(2),
    waveAmp: (v) => (+v).toFixed(2),
    waveLen: (v) => v,
    fanX: (v) => (+v).toFixed(2),
    fanY: (v) => (+v).toFixed(2),
    gcr: (v) => Math.round(v * 100) + '%',
    blackStart: (v) => Math.round(v * 100) + '%',
    brightness: (v) => (v > 0 ? '+' : '') + Math.round(v * 100),
    contrast: (v) => (v > 0 ? '+' : '') + Math.round(v * 100),
    gamma: (v) => (+v).toFixed(2),
    agePaper: (v) => Math.round(v * 100),
    ageFibers: (v) => Math.round(v * 100),
    ageDust: (v) => Math.round(v * 100),
    ageFade: (v) => Math.round(v * 100),
    ageDrift: (v) => Math.round(v * 100),
    ageGain: (v) => Math.round(v * 100),
  };
  const defaults = {};
  Object.keys(sliders).forEach((id) => {
    const el = $(id);
    defaults[id] = el.value;
    const out = document.querySelector(`output[for=${id}]`);
    const sync = () => (out.textContent = sliders[id](el.value));
    sync();
    el.addEventListener('input', () => {
      sync();
      if (id === 'angleStep') spreadAngles();
      schedule();
    });
  });
  ['antialias'].forEach((id) => $(id).addEventListener('change', schedule));
  $('seed').addEventListener('input', schedule);
  $('dice').addEventListener('click', () => { $('seed').value = Math.floor(Math.random() * 100000); schedule(); });
  $('sepMode').addEventListener('change', () => { syncGroups(); schedule(); });

  // Espaçamento de ângulo: redistribui os ângulos das tintas a partir da
  // primeira (como o "offset angles" de impressão retrô).
  function spreadAngles() {
    const step = +$('angleStep').value;
    const base = state.inks[0] ? state.inks[0].angle : 0;
    state.inks.forEach((ink, k) => (ink.angle = Math.round(((base + k * step) % 180) * 10) / 10));
    buildInkControls();
  }

  // ---------------------------------------------------------------------
  // Galeria de padrões (miniaturas renderizadas pelo próprio motor)

  let galleryBuilt = false;
  function buildGallery(onlyMark) {
    const box = $('gallery');
    if (onlyMark && galleryBuilt) {
      box.querySelectorAll('.tile').forEach((x) => x.classList.toggle('on', x.dataset.p === state.pattern));
      return;
    }
    galleryBuilt = true;
    box.innerHTML = '';
    PATTERNS.forEach(([id, name]) => {
      const t = document.createElement('div');
      t.className = 'tile' + (id === state.pattern ? ' on' : '');
      t.dataset.p = id;
      t.innerHTML = `<canvas width="132" height="44"></canvas><span>${name}</span>`;
      t.addEventListener('click', () => {
        state.pattern = id;
        box.querySelectorAll('.tile').forEach((x) => x.classList.toggle('on', x === t));
        syncGroups();
        schedule();
      });
      box.appendChild(t);
    });
    call({ thumbs: { w: 132, h: 44, cell: 7, paper: '#EFE6D2', ink: '#1E1B1A', roughness: 0.35, distortion: 0.25 } }).then((list) => {
      list.forEach((th) => {
        const c = box.querySelector(`.tile[data-p="${th.id}"] canvas`);
        if (c) c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(th.data), 132, 44), 0, 0);
      });
    });
  }

  // mostra controles de onda/leque/CMYK só quando fazem sentido
  function syncGroups() {
    const used = new Set([state.pattern, ...state.inks.filter((i) => i.enabled && i.pattern).map((i) => i.pattern)]);
    $('waveGroup').classList.toggle('show', [...used].some((p) => p.startsWith('waves')));
    $('fanGroup').classList.toggle('show', [...used].some((p) => p.startsWith('fan')));
    $('cmykGroup').classList.toggle('show', $('sepMode').value === 'cmyk');
  }

  // ---------------------------------------------------------------------
  // Tintas

  const setSel = $('inkSet');
  setSel.innerHTML = '<option value="">Conjuntos de tintas…</option>' +
    Object.entries(INK_SETS).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
  setSel.addEventListener('change', () => {
    const set = INK_SETS[setSel.value];
    setSel.value = '';
    if (!set) return;
    applyInkSet(set);
  });

  function applyInkSet(set) {
    state.inks = makeInks(set);
    $('sepMode').value = set.mode;
    setPaper(set.paper);
    buildInkControls();
    buildPlateButtons();
    syncGroups();
    schedule();
  }

  function buildInkControls() {
    const box = $('inks');
    box.innerHTML = '';
    const patOpts = '<option value="">Padrão global</option>' + PATTERNS.map(([id, n]) => `<option value="${id}">${n}</option>`).join('');
    state.inks.forEach((ink, idx) => {
      const card = document.createElement('div');
      card.className = 'inkcard' + (ink.enabled ? '' : ' off');
      card.innerHTML = `
        <div class="top">
          <input type="checkbox" class="en" ${ink.enabled ? 'checked' : ''} title="Usar esta tinta">
          <input type="color" class="col" value="${ink.color.toLowerCase()}" title="Cor da tinta">
          <input type="text" class="nm" value="${ink.name}" title="Nome">
          <input type="number" class="ang" min="-180" max="180" step="0.5" value="${ink.angle}" title="Ângulo da retícula (graus)">
          <div class="ops">
            <button class="up" title="Imprimir antes (mais embaixo)">▲</button>
            <button class="dn" title="Imprimir depois (mais em cima)">▼</button>
            <button class="rm" title="Remover">✕</button>
          </div>
        </div>
        <div class="bottom">
          <select class="pat" title="Padrão desta tinta">${patOpts}</select>
          <label title="Tinta opaca cobre o que está embaixo (ex.: base branca, tinta de fundo)"><input type="checkbox" class="op" ${ink.hiding > 0 ? 'checked' : ''}> Opaca</label>
        </div>
        <div class="str"><span>Força</span><input type="range" class="force" min="0.1" max="1" step="0.01" value="${ink.opacity}"><output>${Math.round(ink.opacity * 100)}%</output></div>`;
      const q = (s) => card.querySelector(s);
      q('.pat').value = ink.pattern || '';
      q('.en').addEventListener('change', (e) => { ink.enabled = e.target.checked; card.classList.toggle('off', !ink.enabled); buildPlateButtons(); syncGroups(); schedule(); });
      q('.col').addEventListener('input', (e) => { ink.color = e.target.value.toUpperCase(); schedule(); });
      q('.nm').addEventListener('change', (e) => { ink.name = e.target.value || 'Tinta'; buildPlateButtons(); });
      q('.ang').addEventListener('input', (e) => { ink.angle = +e.target.value || 0; schedule(); });
      q('.pat').addEventListener('change', (e) => { ink.pattern = e.target.value; syncGroups(); schedule(); });
      q('.op').addEventListener('change', (e) => { ink.hiding = e.target.checked ? 1 : 0; schedule(); });
      q('.force').addEventListener('input', (e) => { ink.opacity = +e.target.value; q('.str output').textContent = Math.round(ink.opacity * 100) + '%'; schedule(); });
      q('.up').addEventListener('click', () => moveInk(idx, -1));
      q('.dn').addEventListener('click', () => moveInk(idx, 1));
      q('.rm').addEventListener('click', () => {
        if (state.inks.length <= 1) return;
        state.inks.splice(idx, 1);
        afterInkListChange();
      });
      box.appendChild(card);
    });
  }

  function moveInk(idx, dir) {
    const j = idx + dir;
    if (j < 0 || j >= state.inks.length) return;
    [state.inks[idx], state.inks[j]] = [state.inks[j], state.inks[idx]];
    afterInkListChange();
  }
  function afterInkListChange() {
    // tinta nova/removida: CMYK com GCR só faz sentido com o preto marcado
    if (!state.inks.some((i) => i.role === 'k')) $('sepMode').value = 'solve';
    buildInkControls();
    buildPlateButtons();
    syncGroups();
    schedule();
  }

  $('addInk').addEventListener('click', () => {
    const last = state.inks[state.inks.length - 1];
    state.inks.push({
      id: 'i' + ++inkUid, name: 'Tinta ' + (state.inks.length + 1), color: '#2E7C83',
      angle: Math.round((((last ? last.angle : 0) + +$('angleStep').value) % 180) * 10) / 10,
      enabled: true, opacity: 1, hiding: 0, pattern: '',
    });
    $('sepMode').value = 'solve';
    afterInkListChange();
  });

  // Ordena da mais clara para a mais escura (ordem usual de impressão).
  $('sortInks').addEventListener('click', () => {
    const lum = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
    };
    state.inks.sort((a, b) => lum(b.color) - lum(a.color));
    afterInkListChange();
  });

  // ---------------------------------------------------------------------
  // Papel

  function setPaper(hex) {
    $('paper').value = hex.toLowerCase();
    $('paperHex').textContent = hex.toUpperCase();
  }
  $('paperSwatches').innerHTML = PAPERS.map(([n, c]) => `<button data-c="${c}"><i style="background:${c}"></i>${n}</button>`).join('');
  $('paperSwatches').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    setPaper(b.dataset.c);
    schedule();
  });
  $('paper').addEventListener('input', () => { $('paperHex').textContent = $('paper').value.toUpperCase(); schedule(); });

  // ---------------------------------------------------------------------
  // Vistas (composto / original / chapas) e zoom

  function buildPlateButtons() {
    const box = $('plateView');
    box.innerHTML = '';
    state.inks.filter((i) => i.enabled).forEach((ink) => {
      const b = document.createElement('button');
      b.textContent = ink.name;
      b.dataset.v = ink.id;
      box.appendChild(b);
    });
    if (isPlateView() && !state.inks.some((i) => i.enabled && i.id === state.view)) state.view = 'composite';
    markView();
  }
  function markView() {
    document.querySelectorAll('#view button, #plateView button').forEach((b) => b.classList.toggle('on', b.dataset.v === state.view));
  }
  function isPlateView() { return state.view !== 'composite' && state.view !== 'original'; }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('#view button, #plateView button');
    if (!b) return;
    state.view = b.dataset.v;
    markView();
    if (isPlateView() && !(state.result && state.result.plates)) schedule(0);
    else draw();
  });

  $('zoom').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.zoom = b.dataset.z;
    $('zoom').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    applyZoom();
  });
  window.addEventListener('resize', applyZoom);
  $('previewMax').addEventListener('change', () => { makePreview(); schedule(); });

  $('reset').addEventListener('click', () => {
    applySettings({ inks: INK_SETS.cmyk.inks, separation: { mode: 'cmyk' }, paper: '#FFFFFF' });
    markPreset(null);
  });

  /*
   * Aplica um objeto de configurações (completo ou parcial, ex.: preset) na
   * interface. O que não vier no objeto volta ao padrão.
   */
  function applySettings(s, opts) {
    opts = opts || {};
    const setV = (id, v) => {
      const el = $(id);
      el.value = v;
      const o = document.querySelector(`output[for=${id}]`);
      if (o && sliders[id]) o.textContent = sliders[id](el.value);
    };
    const pick = (v, d) => (v == null ? d : v);
    const sep = s.separation || {}, inp = s.input || {}, ag = s.aging || {}, wv = s.waves || {}, fn = s.fan || {};
    setV('cellSize', pick(opts.cellSize, pick(s.cellSize, defaults.cellSize)));
    setV('prefilter', pick(s.prefilter, defaults.prefilter));
    setV('rotation', pick(s.rotation, 0));
    setV('roughness', pick(s.roughness, 0));
    setV('distortion', pick(s.distortion, 0));
    setV('waveAmp', pick(wv.amplitude, defaults.waveAmp));
    setV('waveLen', pick(wv.length, defaults.waveLen));
    setV('fanX', pick(fn.x, defaults.fanX));
    setV('fanY', pick(fn.y, defaults.fanY));
    setV('gcr', pick(sep.gcr, defaults.gcr));
    setV('blackStart', pick(sep.blackStart, defaults.blackStart));
    $('sepMode').value = sep.mode || 'solve';
    setV('brightness', pick(inp.brightness, 0));
    setV('contrast', pick(inp.contrast, 0));
    setV('gamma', pick(inp.gamma, 1));
    setV('agePaper', pick(ag.paper, 0));
    setV('ageFibers', pick(ag.fibers, 0));
    setV('ageDust', pick(ag.dust, 0));
    setV('ageFade', pick(ag.fade, 0));
    setV('ageDrift', pick(ag.drift, 0));
    setV('ageGain', pick(ag.dotGain, 0));
    $('seed').value = pick(s.seed, 1);
    $('antialias').checked = s.antialias !== false;
    setPaper(s.paper || '#FFFFFF');
    state.pattern = s.pattern || 'print';
    if (Array.isArray(s.inks) && s.inks.length) {
      state.inks = s.inks.map((i) => ({
        id: 'i' + ++inkUid, name: i.name || 'Tinta', role: i.role, color: i.color || '#000000',
        angle: pick(i.angle, 0), enabled: i.enabled !== false, opacity: pick(i.opacity, 1),
        hiding: pick(i.hiding, 0), pattern: i.pattern || '',
      }));
    }
    if (!state.inks.some((i) => i.role === 'k')) $('sepMode').value = 'solve';
    buildGallery(true);
    buildInkControls();
    buildPlateButtons();
    syncGroups();
    schedule();
  }

  // ---------------------------------------------------------------------
  // Presets (referência + do usuário). Miniaturas renderizadas pelo motor
  // numa amostra colorida.

  const USER_KEY = 'halftone-user-presets';
  const BUILTIN = (self.HT && self.HT.presets && self.HT.presets.LIST) || [];
  let userPresets = [];
  try { userPresets = JSON.parse(localStorage.getItem(USER_KEY) || '[]'); } catch (_) { userPresets = []; }
  let currentPreset = null;
  const thumbCache = new Map();

  function allPresets() { return BUILTIN.concat(userPresets); }

  function buildPresets() {
    const box = $('presets');
    box.innerHTML = '';
    allPresets().forEach((pr) => {
      const el = document.createElement('div');
      el.className = 'preset' + (pr.id === currentPreset ? ' on' : '');
      el.dataset.id = pr.id;
      el.title = pr.name;
      el.innerHTML = `<canvas width="96" height="96"></canvas><span>${pr.name}</span>` + (pr.user ? '<button class="del" title="Apagar preset">✕</button>' : '');
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('del')) {
          userPresets = userPresets.filter((u) => u.id !== pr.id);
          saveUserPresets();
          buildPresets();
          return;
        }
        applyPreset(pr);
      });
      const cached = thumbCache.get(pr.id);
      if (cached) el.querySelector('canvas').getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(cached), 96, 96), 0, 0);
      box.appendChild(el);
    });
    const missing = allPresets().filter((pr) => !thumbCache.has(pr.id));
    if (missing.length) {
      call({ presetThumbs: { size: 96, list: missing } }).then((list) => {
        list.forEach((t) => {
          thumbCache.set(t.id, t.data);
          const c = box.querySelector(`.preset[data-id="${t.id}"] canvas`);
          if (c) c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(t.data), 96, 96), 0, 0);
        });
      });
    }
  }

  function markPreset(id) {
    currentPreset = id;
    document.querySelectorAll('.preset').forEach((x) => x.classList.toggle('on', x.dataset.id === id));
  }

  function applyPreset(pr) {
    const f = state.full;
    const cell = f && self.HT.presets ? self.HT.presets.cellFor(pr, f.width, f.height) : pr.cellSize;
    applySettings(pr, { cellSize: cell });
    markPreset(pr.id);
  }

  // configurações atuais no formato de preset (célula convertida para a
  // referência de 1200 px, para valer em qualquer resolução)
  function currentAsPreset(name) {
    const s = settings(1, false);
    delete s.scale; delete s.plates;
    const f = state.full;
    if (f) s.cellSize = Math.round(((s.cellSize * 1200) / Math.min(f.width, f.height)) * 10) / 10;
    s.inks = s.inks.map((i) => { const c = Object.assign({}, i); delete c.id; return c; });
    return Object.assign({ id: 'u' + Date.now(), name, user: true }, s);
  }

  function saveUserPresets() {
    try { localStorage.setItem(USER_KEY, JSON.stringify(userPresets)); } catch (_) { /* sem armazenamento */ }
  }

  $('savePreset').addEventListener('click', () => {
    const name = prompt('Nome do preset:', 'Meu preset');
    if (!name) return;
    const pr = currentAsPreset(name);
    userPresets.push(pr);
    saveUserPresets();
    currentPreset = pr.id;
    buildPresets();
  });

  $('exportPreset').addEventListener('click', () => {
    const pr = currentAsPreset((allPresets().find((x) => x.id === currentPreset) || {}).name || 'Preset halftone');
    delete pr.user;
    const blob = new Blob([JSON.stringify(pr, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = pr.name.replace(/[^\w\-]+/g, '_') + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  $('importPreset').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      const list = Array.isArray(data) ? data : [data];
      list.forEach((pr) => {
        if (!pr || !Array.isArray(pr.inks)) throw new Error('arquivo não parece um preset');
        pr.id = 'u' + Date.now() + Math.floor(Math.random() * 1000);
        pr.user = true;
        pr.name = pr.name || f.name.replace(/\.json$/i, '');
        userPresets.push(pr);
      });
      saveUserPresets();
      buildPresets();
      applyPreset(list[list.length - 1]);
    } catch (err) {
      setStatus('Preset inválido: ' + err.message);
    }
  });

  // ---------------------------------------------------------------------
  // Configurações enviadas ao motor

  function settings(scale, plates) {
    const enabledIds = state.inks.filter((i) => i.enabled).map((i) => i.id);
    return {
      cellSize: +$('cellSize').value,
      scale,
      prefilter: +$('prefilter').value,
      antialias: $('antialias').checked,
      pattern: state.pattern,
      rotation: +$('rotation').value,
      roughness: +$('roughness').value,
      distortion: +$('distortion').value,
      seed: +$('seed').value || 0,
      waves: { amplitude: +$('waveAmp').value, length: +$('waveLen').value },
      fan: { x: +$('fanX').value, y: +$('fanY').value },
      paper: $('paper').value.toUpperCase(),
      aging: {
        paper: +$('agePaper').value, fibers: +$('ageFibers').value, dust: +$('ageDust').value,
        fade: +$('ageFade').value, drift: +$('ageDrift').value, dotGain: +$('ageGain').value,
      },
      separation: { mode: $('sepMode').value, gcr: +$('gcr').value, blackStart: +$('blackStart').value },
      input: { brightness: +$('brightness').value, contrast: +$('contrast').value, gamma: +$('gamma').value },
      inks: state.inks.map((i) => ({
        id: i.id, name: i.name, role: i.role, color: i.color, angle: i.angle, enabled: i.enabled,
        opacity: i.opacity, hiding: i.hiding, pattern: i.pattern || undefined,
      })),
      plates: plates && enabledIds.length > 0,
    };
  }

  // ---------------------------------------------------------------------
  // Carregar imagem

  const drop = $('drop');
  $('file').addEventListener('change', (e) => e.target.files[0] && loadBlob(e.target.files[0], e.target.files[0].name));
  ['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  document.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) loadBlob(f, f.name);
  });

  $('testImages').addEventListener('change', async (e) => {
    if (!e.target.value) return;
    const r = await fetch(e.target.value);
    loadBlob(await r.blob(), e.target.value.split('/').pop());
  });

  // Lista as imagens de /test-images (usa a listagem de pasta do servidor local).
  async function listTestImages() {
    const sel = $('testImages');
    for (const dir of ['../test-images/', '../test-images/personal/', '../test-images/charts/', '../test-images/macos/']) {
      try {
        const html = await (await fetch(dir)).text();
        const names = [...html.matchAll(/href="([^"]+\.(?:png|jpe?g|webp|tiff?))"/gi)].map((m) => decodeURIComponent(m[1]));
        names.forEach((n) => {
          const o = document.createElement('option');
          o.value = dir + n;
          o.textContent = dir.replace('../test-images/', '') + n;
          sel.appendChild(o);
        });
      } catch (_) { /* pasta ausente */ }
    }
  }

  async function loadBlob(blob, name) {
    setStatus('Carregando…', true);
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const id = ctx.getImageData(0, 0, bmp.width, bmp.height);
    state.full = { width: bmp.width, height: bmp.height, data: id.data, channels: 4, bitmap: bmp };
    $('imgInfo').textContent = `${name} — ${bmp.width} × ${bmp.height}px`;
    makePreview();
    schedule(0);
  }

  // Preview: reduz a imagem para o limite escolhido. O motor recebe a escala
  // e diminui a célula junto, então o preview é o mesmo desenho em miniatura.
  function makePreview() {
    const f = state.full;
    if (!f) return;
    const max = +$('previewMax').value;
    const s = max && Math.max(f.width, f.height) > max ? max / Math.max(f.width, f.height) : 1;
    if (s === 1) {
      state.preview = { width: f.width, height: f.height, data: f.data, channels: 4, scale: 1 };
      return;
    }
    const w = Math.round(f.width * s), h = Math.round(f.height * s);
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(f.bitmap, 0, 0, w, h);
    state.preview = { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data, channels: 4, scale: w / f.width };
  }

  // ---------------------------------------------------------------------
  // Comunicação com o worker (com fila: se chegar pedido novo durante um
  // render, só o mais recente é executado depois)

  let timer = null, busy = false, pending = false, reqId = 0;
  const callbacks = new Map();
  worker.onmessage = (e) => {
    const cb = callbacks.get(e.data.id);
    callbacks.delete(e.data.id);
    if (cb) cb(e.data);
  };
  function call(msg, transfer) {
    return new Promise((resolve, reject) => {
      const id = ++reqId;
      callbacks.set(id, (m) => (m.ok ? resolve(m.result) : reject(new Error(m.error))));
      worker.postMessage({ id, ...msg }, transfer || []);
    });
  }
  function runEngine(image, st) {
    // copia os pixels: o original continua disponível para outros renders
    const copy = new Uint8ClampedArray(image.data);
    return call({ image: { width: image.width, height: image.height, data: copy, channels: 4 }, settings: st }, [copy.buffer]);
  }

  function schedule(delay = 60) {
    saveLocal();
    clearTimeout(timer);
    timer = setTimeout(renderPreview, delay);
  }

  async function renderPreview() {
    if (!state.preview) return;
    if (busy) { pending = true; return; }
    busy = true;
    setStatus('Renderizando…', true);
    try {
      const p = state.preview;
      const res = await runEngine(p, settings(p.scale, isPlateView()));
      state.result = res;
      const s = res.stats;
      setStatus(`${p.width}×${p.height}${p.scale < 1 ? ` (preview ${Math.round(p.scale * 100)}%)` : ''} · célula ${s.cellPx.toFixed(1)}px · ${Math.round(s.totalMs)} ms`);
      draw();
    } catch (err) {
      console.error(err);
      setStatus('Erro: ' + err.message);
    }
    busy = false;
    if (pending) { pending = false; renderPreview(); }
  }

  // ---------------------------------------------------------------------
  // Desenho na tela: "src" guarda os pixels do render; o canvas visível
  // mostra 100%+ pixel a pixel e, no modo Ajustar, uma redução em alta
  // qualidade (a redução simples do navegador cria moiré falso na tela).

  const canvas = $('view-canvas');
  const vctx = canvas.getContext('2d');
  const src = document.createElement('canvas');
  const sctx = src.getContext('2d');

  function draw() {
    const res = state.result, p = state.preview;
    if (!res || !p) return;
    let rgba;
    if (state.view === 'original') rgba = p.data;
    else if (isPlateView()) {
      const plate = res.plates && res.plates.find((x) => x.id === state.view);
      if (!plate) return;
      rgba = grayToRGBA(plate.data);
    } else rgba = res.data;
    src.width = p.width;
    src.height = p.height;
    sctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), p.width, p.height), 0, 0);
    applyZoom();
  }

  // 100% = 1 pixel da imagem por pixel físico da tela (considera Retina).
  function applyZoom() {
    const stage = $('stage');
    if (!src.width) return;
    const dpr = window.devicePixelRatio || 1;
    let cssW, cssH;
    if (state.zoom === 'fit') {
      const k = Math.min((stage.clientWidth - 24) / src.width, (stage.clientHeight - 24) / src.height, 1 / dpr);
      cssW = Math.floor(src.width * k); cssH = Math.floor(src.height * k);
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      vctx.imageSmoothingEnabled = true;
      vctx.imageSmoothingQuality = 'high';
      vctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    } else {
      const z = +state.zoom / dpr;
      canvas.width = src.width;
      canvas.height = src.height;
      vctx.drawImage(src, 0, 0);
      cssW = src.width * z; cssH = src.height * z;
    }
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    stage.classList.toggle('zoomed', state.zoom !== 'fit' && +state.zoom > 1);
  }

  function grayToRGBA(g) {
    const out = new Uint8ClampedArray(g.length * 4);
    for (let i = 0, o = 0; i < g.length; i++, o += 4) { out[o] = out[o + 1] = out[o + 2] = g[i]; out[o + 3] = 255; }
    return out;
  }

  // ---------------------------------------------------------------------
  // Export (resolução total)

  $('exportComposite').addEventListener('click', () => exportFull(false));
  $('exportPlates').addEventListener('click', () => exportFull(true));

  async function exportFull(plates) {
    if (!state.full) return;
    setStatus('Exportando em resolução total…', true);
    try {
      const f = state.full;
      const res = await runEngine(f, settings(1, plates));
      const base = ($('imgInfo').textContent.split(' — ')[0] || 'imagem').replace(/\.\w+$/, '');
      const tag = `halftone_${state.pattern}_c${$('cellSize').value}`;
      if (plates) {
        for (const pl of res.plates) await download(grayToRGBA(pl.data), f.width, f.height, `${base}_${tag}_chapa-${pl.name}.png`);
      } else {
        await download(res.data, f.width, f.height, `${base}_${tag}.png`);
      }
      setStatus(`Exportado ${f.width}×${f.height} em ${Math.round(res.stats.totalMs)} ms`);
    } catch (err) {
      console.error(err);
      setStatus('Erro no export: ' + err.message);
    }
  }

  async function download(rgba, w, h, name) {
    const c = new OffscreenCanvas(w, h);
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  // ---------------------------------------------------------------------
  // Lembrar os últimos ajustes neste navegador (conveniência; os presets
  // de verdade, em JSON, vêm na Fase 3)

  function saveLocal() {
    try {
      const s = settings(1, false);
      localStorage.setItem('halftone-harness', JSON.stringify({ s, inks: state.inks, pattern: state.pattern }));
    } catch (_) { /* sem armazenamento: tudo bem */ }
  }
  function loadLocal() {
    try {
      const raw = localStorage.getItem('halftone-harness');
      if (!raw) return false;
      const { s, inks, pattern } = JSON.parse(raw);
      applySettings(Object.assign({}, s, { inks, pattern }));
      return true;
    } catch (_) { return false; /* ignora estado inválido */ }
  }

  function setStatus(t, busyFlag) {
    const s = $('status');
    s.textContent = t;
    s.classList.toggle('busy', !!busyFlag);
  }

  // ---------------------------------------------------------------------

  buildGallery();
  if (!loadLocal()) { buildInkControls(); buildPlateButtons(); syncGroups(); }
  buildPresets();
  listTestImages().then(() => {
    // parâmetros na URL (úteis para testes automáticos):
    //   ?img=caminho&cell=12&zoom=1&pattern=lines&set=tritone&rough=0.5
    const q = new URLSearchParams(location.search);
    if (q.get('set') && INK_SETS[q.get('set')]) applyInkSet(INK_SETS[q.get('set')]);
    if (q.get('preset')) { const pr = allPresets().find((x) => x.id === q.get('preset')); if (pr) applySettings(pr, { cellSize: q.get('cell') || pr.cellSize }); }
    if (q.get('pattern')) { state.pattern = q.get('pattern'); buildGallery(); syncGroups(); }
    const setV = (id, v) => { $(id).value = v; $(id).dispatchEvent(new Event('input')); };
    if (q.get('cell')) setV('cellSize', q.get('cell'));
    if (q.get('rough')) setV('roughness', q.get('rough'));
    if (q.get('dist')) setV('distortion', q.get('dist'));
    if (q.get('zoom')) {
      state.zoom = q.get('zoom');
      $('zoom').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.z === state.zoom));
    }
    if (q.get('img')) fetch(q.get('img')).then((r) => r.blob()).then((b) => loadBlob(b, q.get('img').split('/').pop()));
  });
})();

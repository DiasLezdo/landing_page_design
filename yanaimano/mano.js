/* =============================================================================
   YanaiMano — Supermano
   -----------------------------------------------------------------------------
   A tiny side-scrolling platformer in one canvas. Supermano is the Yanai rig
   (bald dome, slab mustache, black tee, green pants, tea cup in hand) rendered
   from inline SVG poses. Two worlds x four levels:

     World 1 — Tea Gardens  (day: cream sky, tea bushes, garden soil)
     World 2 — Rock Quarry  (night: stars, moon, grey rock, shard spikes)

   Mechanics: run/jump with coyote time + jump buffering, stompable rocky
   enemies, floating tea cups (coins), crates that pop cups or a chai power-up
   (small -> big; big takes one free hit), breakable crates when big, spikes,
   pits, and a flag pole that ends each level at a tea-shop door.

   Levels are data (builder), physics is a fixed 120 Hz step, and everything
   renders flat-vector in the Kunnam ink-outline style. window.MANO exposes
   state for tests.
   ========================================================================== */

(() => {
  'use strict';

  const cv = document.getElementById('game');
  const cx = cv.getContext('2d');
  const W = 960, H = 540;
  const TILE = 48, ROWS = 11, OFFY = H - ROWS * TILE;   // 12px sky slack

  const INK = '#241812';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------------------------------------------------------------------------
     Input
     ------------------------------------------------------------------------ */

  const keys = { left: false, right: false, jump: false, fire: false, duck: false };
  let confirmTapped = false;   // Enter / tap, consumed per frame
  let jumpPressed = false;     // edge-triggered, consumed by buffer
  let firePressed = false;     // edge-triggered, consumed per step

  const KEYMAP = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ' ': 'jump', ArrowUp: 'jump', w: 'jump', W: 'jump',
    x: 'fire', X: 'fire', k: 'fire', K: 'fire',
    ArrowDown: 'duck', s: 'duck', S: 'duck',
  };

  addEventListener('keydown', e => {
    audioBoot();
    if (e.key === 'Enter') { confirmTapped = true; return; }
    if (e.key === 'm' || e.key === 'M') { muted = !muted; return; }
    const k = KEYMAP[e.key];
    if (!k) return;
    e.preventDefault();
    if (k === 'jump' && !keys.jump) jumpPressed = true;
    if (k === 'fire' && !keys.fire) firePressed = true;
    keys[k] = true;
  });
  addEventListener('keyup', e => {
    const k = KEYMAP[e.key];
    if (k) keys[k] = false;
  });

  // touch pads
  function bindPad(id, k) {
    const el = document.getElementById(id);
    if (!el) return;
    const on = e => { e.preventDefault(); audioBoot(); if (k === 'jump' && !keys.jump) jumpPressed = true; if (k === 'fire' && !keys.fire) firePressed = true; keys[k] = true; };
    const off = e => { e.preventDefault(); keys[k] = false; };
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointercancel', off);
    el.addEventListener('pointerleave', off);
  }
  bindPad('btnL', 'left');
  bindPad('btnR', 'right');
  bindPad('btnJ', 'jump');
  bindPad('btnF', 'fire');
  bindPad('btnD', 'duck');

  // canvas taps: confirm on menus, and level-select chips on the title
  cv.addEventListener('pointerdown', e => {
    audioBoot();
    const r = cv.getBoundingClientRect();
    const mx = (e.clientX - r.left) * (W / r.width);
    const my = (e.clientY - r.top) * (H / r.height);
    if (mode === 'title') {
      for (const c of chipRects) {
        if (mx >= c.x && mx <= c.x + c.w && my >= c.y && my <= c.y + c.h && c.i <= progress) {
          startLevel(c.i);
          return;
        }
      }
    }
    confirmTapped = true;
  });

  /* ---------------------------------------------------------------------------
     Bleeps (WebAudio, no assets)
     ------------------------------------------------------------------------ */

  let AC = null, muted = false;
  function audioBoot() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
    if (AC && AC.state === 'suspended') AC.resume();
  }
  function blip(f0, f1, dur, type = 'square', vol = 0.045) {
    if (!AC || muted) return;
    const t = AC.currentTime;
    const o = AC.createOscillator();
    const g = AC.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(AC.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  const sJump = () => blip(220, 520, 0.14);
  const sCup = () => { blip(920, 920, 0.05); setTimeout(() => blip(1230, 1230, 0.09), 55); };
  const sStomp = () => blip(300, 90, 0.12, 'sawtooth');
  const sPow = () => { blip(392, 392, 0.07); setTimeout(() => blip(494, 494, 0.07), 70); setTimeout(() => blip(659, 659, 0.12), 140); };
  const sHurt = () => blip(360, 110, 0.25, 'sawtooth');
  const sBreak = () => blip(180, 60, 0.14, 'sawtooth', 0.06);
  const sFlag = () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, f, 0.12), i * 110));
  const sDie = () => [660, 494, 392, 262].forEach((f, i) => setTimeout(() => blip(f, f, 0.14), i * 130));
  const sThrow = () => blip(680, 240, 0.1, 'sawtooth', 0.04);
  const sStar = () => [784, 988, 1175, 988].forEach((f, i) => setTimeout(() => blip(f, f, 0.08), i * 70));

  /* ---------------------------------------------------------------------------
     Supermano sprites — the Yanai rig as inline-SVG poses
     ------------------------------------------------------------------------ */

  const HEAD = `
    <path d="M24 3 Q45 4 46 22 Q47 34 38 39 Q31 43 24 43 Q17 43 10 39 Q1 34 2 22 Q3 4 24 3 Z"
          fill="#c06a3c" stroke="#241812" stroke-width="3"/>
    <path d="M12 60 L14 52" stroke="none"/>
    <path d="M8 16 Q13 12.5 19 14.5 L18.3 17.6 Q13.6 16.3 9.4 18.6 Z" fill="#241812"/>
    <path d="M40 16 Q35 12.5 29 14.5 L29.7 17.6 Q34.4 16.3 38.6 18.6 Z" fill="#241812"/>
    <circle cx="15" cy="21.5" r="4.2" fill="#f7f1e6" stroke="#241812" stroke-width="1.8"/>
    <circle cx="33" cy="21.5" r="4.2" fill="#f7f1e6" stroke="#241812" stroke-width="1.8"/>
    <circle cx="15.7" cy="22.2" r="1.9" fill="#241812"/>
    <circle cx="32.3" cy="22.2" r="1.9" fill="#241812"/>
    <rect x="20.4" y="22.5" width="7.2" height="6.4" rx="3.1" fill="#e79867" stroke="#241812" stroke-width="1.7"/>
    <path d="M10 31.5 Q8 33.5 9 36.5 Q10.4 39.4 14 39 Q17 41 20 39.3 Q24 41.6 28 39.3 Q31 41 34 39 Q37.6 39.4 39 36.5 Q40 33.5 38 31.5 Q24 26.5 10 31.5 Z"
          fill="#241812"/>`;

  const TEE = hot => `
    <path d="M12 43 L36 43 Q41 44 41 49 L41 56 Q33 59.5 24 59.5 Q15 59.5 7 56 L7 49 Q7 44 12 43 Z"
          fill="${hot ? '#a3402a' : '#262222'}" stroke="#241812" stroke-width="2.6"/>${hot ? '<path d="M12 46 L36 46" stroke="#e8b84b" stroke-width="2.4"/>' : ''}`;

  const CUP_ARM = (raise) => `
    <path d="M40 47 Q45 ${47 - raise * 8} 44 ${52 - raise * 14}" stroke="#c06a3c" stroke-width="6" stroke-linecap="round" fill="none"/>
    <path d="M40 ${50 - raise * 15} L48 ${50 - raise * 15} Q47.5 ${56 - raise * 15} 44 ${56 - raise * 15} Q40.5 ${56 - raise * 15} 40 ${50 - raise * 15} Z"
          fill="#f7f1e6" stroke="#241812" stroke-width="2"/>`;

  function manoSVG(pose, hot) {
    const duck = pose === 'duck';
    if (duck) pose = 'idle';
    let legs = '';
    if (pose === 'idle') legs = `
      <path d="M15 56 L13 63" stroke="#3e5a49" stroke-width="9" stroke-linecap="round"/>
      <path d="M33 56 L35 63" stroke="#3e5a49" stroke-width="9" stroke-linecap="round"/>
      <ellipse cx="12" cy="65.4" rx="7" ry="3.2" fill="#241812"/>
      <ellipse cx="36" cy="65.4" rx="7" ry="3.2" fill="#241812"/>`;
    if (pose === 'run1') legs = `
      <path d="M16 55 L7 62.5" stroke="#3e5a49" stroke-width="9" stroke-linecap="round"/>
      <path d="M31 55 L39 60" stroke="#3e5a49" stroke-width="9" stroke-linecap="round"/>
      <ellipse cx="6" cy="64.6" rx="6.6" ry="3.1" fill="#241812"/>
      <ellipse cx="41" cy="62.4" rx="6.6" ry="3.1" fill="#241812"/>`;
    if (pose === 'run2') legs = `
      <path d="M16 55 L9 60" stroke="#3e5a49" stroke-width="9" stroke-linecap="round"/>
      <path d="M31 55 L40 62.5" stroke="#3e5a49" stroke-width="9" stroke-linecap="round"/>
      <ellipse cx="8" cy="62.4" rx="6.6" ry="3.1" fill="#241812"/>
      <ellipse cx="42" cy="64.6" rx="6.6" ry="3.1" fill="#241812"/>`;
    if (pose === 'jump') legs = `
      <path d="M16 55 L12 59.5" stroke="#3e5a49" stroke-width="9" stroke-linecap="round"/>
      <path d="M32 55 L36 59.5" stroke="#3e5a49" stroke-width="9" stroke-linecap="round"/>
      <ellipse cx="11" cy="61.8" rx="6.6" ry="3.1" fill="#241812"/>
      <ellipse cx="37" cy="61.8" rx="6.6" ry="3.1" fill="#241812"/>`;
    const raise = pose === 'jump' ? 1 : 0;
    const inner = `${TEE(hot)}${legs}${CUP_ARM(raise)}${HEAD}`;
    if (duck) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 68"><g transform="translate(0 19) scale(1 0.72)">${inner}</g></svg>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 68">${inner}</svg>`;
  }

  const SPRITES = {}, HOTS = {};
  let spritesReady = 0;
  function mkSprite(setObj, p, hot) {
    const img = new Image();
    img.onload = () => spritesReady++;
    img.src = 'data:image/svg+xml,' + encodeURIComponent(manoSVG(p, hot));
    setObj[p] = img;
  }
  ['idle', 'run1', 'run2', 'jump', 'duck'].forEach(p => { mkSprite(SPRITES, p, false); mkSprite(HOTS, p, true); });

  /* ---------------------------------------------------------------------------
     Levels — built from compact data
     grid chars: '#' ground · '=' crate · '?' cup crate · '!' chai crate ·
                 'X' spent · 'T' urn · '^' spikes · 'o' cup · '-' empty
     ------------------------------------------------------------------------ */

  const DEFS = [
    { world: 1, name: 'Tea Garden Row', len: 150, flag: 142,
      pits: [[46, 3], [88, 4]],
      plats: [[18, 6, 1, '?'], [19, 6, 1, '='], [20, 6, 1, '!'], [21, 6, 1, '='], [22, 6, 1, '?'],
              [60, 6, 3, '='], [62, 6, 1, '?'], [95, 6, 1, '?'], [97, 6, 1, '?']],
      urns: [[40, 1], [120, 2]],
      foes: [[30, 'w'], [70, 'w'], [102, 'w'], [112, 'w']],
      cups: [[18, 4], [20, 4], [22, 4], [47, 5], [48, 4], [49, 5], [89, 5], [90, 4], [91, 4], [92, 5], [96, 4], [126, 7], [128, 7], [130, 7]] },

    { world: 1, name: 'Crate Alley', len: 160, flag: 152,
      pits: [[30, 3], [64, 4], [108, 5]],
      plats: [[40, 6, 1, '?'], [41, 6, 1, '!'], [42, 6, 1, '?'],
              [120, 8, 3, '='], [123, 7, 3, '='], [126, 6, 3, '=']],
      urns: [[55, 2], [90, 1]],
      foes: [[24, 'w'], [50, 'w'], [84, 'h'], [96, 'w'], [132, 'w'], [136, 'h']],
      cups: [[31, 6], [32, 5], [33, 6], [66, 5], [67, 4], [109, 6], [110, 5], [111, 5], [112, 6], [121, 6], [124, 5], [127, 4]] },

    { world: 1, name: 'High Terrace', len: 160, flag: 152,
      pits: [[32, 22], [120, 5]],
      plats: [[34, 7, 3, '='], [41, 6, 3, '='], [48, 7, 3, '='],
              [60, 6, 1, '!'], [100, 6, 4, '='], [102, 6, 1, '?'], [42, 4, 1, '*']],
      urns: [[80, 1], [113, 2]],
      foes: [[70, 'w'], [75, 'h'], [90, 'w'], [130, 'k']],
      cups: [[35, 5], [42, 4], [49, 5], [58, 4], [101, 4], [103, 4], [121, 6], [122, 5], [123, 5], [124, 6]] },

    { world: 1, name: 'The Tea Factory', len: 150, flag: 140,
      pits: [[40, 3], [110, 4]],
      plats: [[50, 6, 1, '?'], [51, 6, 1, '!'], [52, 6, 1, '?'], [53, 6, 1, '='], [54, 6, 1, '?'], [44, 7, 5, '=']],
      urns: [[20, 1], [24, 2], [28, 1], [66, 3], [82, 3], [98, 3], [120, 2], [124, 2]],
      foes: [[34, 'w'], [60, 'w'], [74, 'k'], [90, 'w'], [104, 'h'], [128, 'w']],
      cups: [[21, 6], [26, 5], [41, 5], [42, 5], [45, 8], [47, 8], [67, 4], [83, 4], [99, 4], [111, 5], [112, 5], [122, 5]] },

    { world: 2, name: 'Quarry Gate', len: 150, flag: 142,
      pits: [[58, 4]],
      spikes: [[36, 3], [74, 4]],
      plats: [[30, 6, 1, '?'], [31, 6, 1, '='], [32, 6, 1, '?'], [60, 7, 4, '='], [92, 6, 1, '!']],
      urns: [[50, 1], [104, 2]],
      foes: [[44, 'w'], [66, 'w'], [90, 'k'], [100, 'w'], [118, 'h']],
      cups: [[30, 4], [32, 4], [37, 6], [38, 6], [59, 5], [61, 5], [75, 6], [76, 6], [77, 6], [126, 7], [128, 7]] },

    { world: 2, name: 'Shard Fields', len: 160, flag: 152,
      pits: [[30, 4], [44, 4], [58, 5]],
      spikes: [[80, 6], [122, 3]],
      plats: [[32, 7, 2, '='], [46, 7, 2, '='], [60, 7, 3, '='],
              [116, 6, 1, '?'], [117, 6, 1, '!'], [118, 6, 1, '?'], [61, 5, 1, '*']],
      urns: [[100, 2]],
      foes: [[70, 'w'], [96, 'w'], [100, 'h'], [104, 'w'], [132, 'k'], [140, 'w']],
      cups: [[33, 5], [47, 5], [61, 5], [62, 5], [81, 4], [83, 4], [85, 4], [117, 4], [123, 6], [124, 6]] },

    { world: 2, name: 'Night Ledges', len: 160, flag: 150,
      pits: [[30, 40], [110, 5]],
      spikes: [[104, 4]],
      plats: [[32, 8, 3, '='], [38, 6, 3, '='], [44, 8, 3, '='], [50, 5, 3, '='], [56, 7, 3, '='], [62, 8, 3, '='],
              [90, 6, 1, '!'], [130, 8, 2, '='], [133, 7, 2, '='], [136, 6, 2, '=']],
      urns: [[80, 1]],
      foes: [[86, 'w'], [92, 'k'], [98, 'w'], [142, 'h']],
      cups: [[33, 6], [39, 4], [45, 6], [51, 3], [57, 5], [63, 6], [111, 6], [112, 5], [113, 6], [131, 6], [134, 5], [137, 4]] },

    { world: 2, name: 'The Deep Cut', len: 170, flag: 162,
      pits: [[34, 4], [80, 6], [148, 5]],
      spikes: [[26, 3], [72, 4], [116, 4], [142, 3]],
      plats: [[82, 7, 2, '='], [96, 6, 1, '?'], [97, 6, 1, '!'], [98, 6, 1, '?'], [97, 4, 1, '*'],
              [130, 8, 3, '='], [134, 7, 3, '='], [138, 6, 3, '='], [149, 6, 2, '='], [58, 7, 4, '=']],
      urns: [[66, 3], [108, 2]],
      foes: [[48, 'w'], [52, 'h'], [56, 'w'], [104, 'k'], [108, 'w'], [124, 'k'], [126, 'w']],
      cups: [[27, 6], [35, 5], [36, 5], [59, 8], [60, 8], [73, 6], [74, 6], [83, 5], [117, 6], [118, 6], [131, 6], [135, 5], [139, 4], [150, 4], [151, 4]] },
  ];

  function buildLevel(def) {
    const g = [];
    for (let r = 0; r < ROWS; r++) g.push(new Array(def.len).fill('-'));
    const inPit = x => (def.pits || []).some(([s, w]) => x >= s && x < s + w);
    for (let x = 0; x < def.len; x++) {
      if (!inPit(x)) { g[9][x] = '#'; g[10][x] = '#'; }
    }
    (def.plats || []).forEach(([x, y, w, ch]) => { for (let i = 0; i < w; i++) g[y][x + i] = ch; });
    (def.urns || []).forEach(([x, h]) => { for (let k = 0; k < h; k++) g[8 - k][x] = 'T'; });
    (def.spikes || []).forEach(([x, w]) => { for (let i = 0; i < w; i++) g[8][x + i] = '^'; });
    (def.cups || []).forEach(([x, y]) => { if (g[y][x] === '-') g[y][x] = 'o'; });
    return g;
  }

  const SOLID = { '#': 1, '=': 1, '?': 1, '!': 1, '*': 1, X: 1, T: 1 };

  /* ---------------------------------------------------------------------------
     Game state
     ------------------------------------------------------------------------ */

  const store = {
    get() { try { return +localStorage.getItem('yanaimano-progress') || 0; } catch (e) { return 0; } },
    set(v) { try { localStorage.setItem('yanaimano-progress', v); } catch (e) {} },
  };

  let mode = 'title';          // title | splash | play | flag | dead | gameover | victory
  let progress = store.get();  // highest unlocked level index
  let level = 0, def = DEFS[0], grid = buildLevel(DEFS[0]);
  let tea = 0, lives = 3;
  let splashT = 0, deadT = 0, flagPhase = 0, fadeT = 0;
  let time = 0;
  let chipRects = [];

  const player = { x: 0, y: 0, vx: 0, vy: 0, w: 30, h: 52, power: 0, starT: 0, duck: false, face: 1,
                   onGround: false, coyote: 0, buffer: 0, iframes: 0, runD: 0, jumpCut: false };
  let foes = [], items = [], shots = [], pops = [], bumps = {};
  let shotCd = 0, sparkT = 0;
  let camX = 0;

  function playerH() { return player.power >= 1 ? 68 : 52; }

  function startLevel(i) {
    level = i;
    def = DEFS[i];
    grid = buildLevel(def);
    foes = (def.foes || []).map(([x, ty]) => ({
      x: x * TILE + 6, y: 8 * TILE,
      vx: ty === 'h' ? 0 : (def.world === 2 ? -82 : -58),
      vy: 0, w: ty === 'h' ? 26 : 34, h: ty === 'h' ? 24 : 30,
      type: ty, hopT: 0, dead: 0 }));
    items = [];
    shots = [];
    shotCd = 0;
    pops = [];
    bumps = {};
    player.x = 2 * TILE;
    player.y = 9 * TILE - playerH();
    player.vx = 0; player.vy = 0; player.face = 1;
    player.onGround = false; player.iframes = 0; player.starT = 0; player.duck = false;
    camX = 0;
    splashT = 0;
    fadeT = 0;
    mode = 'splash';
  }

  function toTitle() {
    mode = 'title';
    tea = 0;
    lives = 3;
  }

  /* ---------------------------------------------------------------------------
     Physics helpers
     ------------------------------------------------------------------------ */

  const tileAt = (px, py) => {
    const cxi = Math.floor(px / TILE), cyi = Math.floor(py / TILE);
    if (cxi < 0 || cxi >= def.len || cyi < 0 || cyi >= ROWS) return cxi < 0 || cxi >= def.len ? '#' : '-';
    return grid[cyi][cxi];
  };

  function collideBox(b, onHead) {
    // X axis
    b.x += b.vx * DT;
    let hitWall = false;
    for (const ey of [b.y + 2, b.y + b.h / 2, b.y + b.h - 2]) {
      if (b.vx > 0 && SOLID[tileAt(b.x + b.w, ey)]) { b.x = Math.floor((b.x + b.w) / TILE) * TILE - b.w - 0.01; b.vx = 0; hitWall = true; }
      if (b.vx < 0 && SOLID[tileAt(b.x, ey)]) { b.x = Math.floor(b.x / TILE + 1) * TILE + 0.01; b.vx = 0; hitWall = true; }
    }
    // Y axis
    b.y += b.vy * DT;
    b.grounded = false;
    for (const ex of [b.x + 3, b.x + b.w - 3]) {
      if (b.vy >= 0 && SOLID[tileAt(ex, b.y + b.h)]) {
        b.y = Math.floor((b.y + b.h) / TILE) * TILE - b.h - 0.01;
        b.vy = 0;
        b.grounded = true;
      }
      if (b.vy < 0 && SOLID[tileAt(ex, b.y)]) {
        if (onHead) onHead(Math.floor(ex / TILE), Math.floor(b.y / TILE));
        b.y = Math.floor(b.y / TILE + 1) * TILE + 0.01;
        b.vy = 0;
      }
    }
    return hitWall;
  }

  function popCrate(cxi, cyi, ch) {
    bumps[cxi + ',' + cyi] = 0.001;
    if (ch === '?') {
      grid[cyi][cxi] = 'X';
      tea++;
      sCup();
      pops.push({ kind: 'cup', x: cxi * TILE + TILE / 2, y: cyi * TILE - 8, t: 0 });
    } else if (ch === '!') {
      grid[cyi][cxi] = 'X';
      sPow();
      const kind = player.power === 0 ? 'chai' : 'kettle';
      items.push({ kind, x: cxi * TILE + 7, y: (cyi - 1) * TILE + 12, vx: kind === 'chai' ? 88 : 0, vy: 0, w: 34, h: 32 });
    } else if (ch === '*') {
      grid[cyi][cxi] = 'X';
      sStar();
      items.push({ kind: 'star', x: cxi * TILE + 7, y: (cyi - 1) * TILE + 8, vx: 130, vy: -260, w: 34, h: 32 });
    } else if (ch === '=' && player.power >= 1) {
      grid[cyi][cxi] = '-';
      sBreak();
      for (let i = 0; i < 4; i++) pops.push({ kind: 'shard', x: cxi * TILE + TILE / 2, y: cyi * TILE + TILE / 2,
        vx: (i % 2 ? 1 : -1) * (60 + i * 30), vy: -260 - i * 40, t: 0 });
    }
  }

  function hurt() {
    if (player.iframes > 0 || player.starT > 0 || mode !== 'play') return;
    if (player.power > 0) {
      player.power--;
      player.iframes = 2;
      sHurt();
    } else {
      die();
    }
  }

  function killFoe(f) {
    f.dead = 0.001;
    sStomp();
    pops.push({ kind: 'star', x: f.x + f.w / 2, y: f.y, t: 0 });
  }

  function die() {
    if (mode !== 'play') return;
    mode = 'dead';
    deadT = 0;
    lives--;
    player.power = 0;
    player.starT = 0;
    player.vy = -640;
    sDie();
  }

  /* ---------------------------------------------------------------------------
     Step
     ------------------------------------------------------------------------ */

  const DT = 1 / 120;
  const GRAV = 2450, MOVE = 285, JUMPV = -935;

  function step() {
    time += DT;

    if (mode === 'splash') {
      splashT += DT;
      if (splashT > 1.1) mode = 'play';
      return;
    }

    if (mode === 'dead') {
      deadT += DT;
      player.vy += GRAV * DT;
      player.y += player.vy * DT;
      if (deadT > 1.6) {
        if (lives < 0) { mode = 'gameover'; }
        else startLevel(level);
      }
      return;
    }

    if (mode === 'flag') {
      const base = 9 * TILE - playerH();
      if (flagPhase === 0) {                       // slide the pole
        player.y = Math.min(player.y + 300 * DT, base);
        if (player.y >= base) flagPhase = 1;
      } else {                                     // walk to the door
        player.x += 150 * DT;
        player.runD += 150 * DT;
        if (player.x > (def.flag + 3.2) * TILE) {
          fadeT += DT;
          if (fadeT > 0.7) {
            const next = level + 1;
            if (next >= DEFS.length) { progress = DEFS.length - 1; store.set(progress); mode = 'victory'; }
            else {
              progress = Math.max(progress, next);
              store.set(progress);
              startLevel(next);
            }
          }
        }
      }
      return;
    }

    if (mode !== 'play') return;

    /* ---- player ---- */
    const p = player;
    /* crouch: squash into one-tile gaps; stand back up only with headroom */
    const standH = playerH();
    const duckH = p.power >= 1 ? 40 : 34;
    if (keys.duck && p.onGround && !p.duck) {
      p.duck = true;
      p.y += standH - duckH;
    } else if (!keys.duck && p.duck) {
      const ny = p.y + p.h - standH;
      let clear = true;
      for (const ex of [p.x + 3, p.x + p.w - 3]) {
        if (SOLID[tileAt(ex, ny + 3)] || SOLID[tileAt(ex, ny + (standH - duckH) * 0.6)]) clear = false;
      }
      if (clear) { p.duck = false; p.y = ny; }
    }
    p.h = p.duck ? duckH : standH;
    const want = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (want !== 0) { p.face = want; p.vx += want * 2300 * DT; }
    else p.vx *= Math.pow(0.0004, DT);            // friction
    p.vx = clamp(p.vx, -MOVE, MOVE);
    if (p.duck && p.onGround) p.vx = clamp(p.vx, -115, 115);
    if (Math.abs(p.vx) > 20 && p.onGround) p.runD += Math.abs(p.vx) * DT;

    p.vy += (p.vy < 0 && keys.jump ? GRAV * 0.52 : GRAV) * DT;
    p.vy = Math.min(p.vy, 1250);

    if (jumpPressed) { p.buffer = 0.12; jumpPressed = false; }
    else p.buffer = Math.max(0, p.buffer - DT);
    p.coyote = p.onGround ? 0.09 : Math.max(0, p.coyote - DT);
    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = JUMPV;
      p.buffer = 0; p.coyote = 0; p.onGround = false; p.jumpCut = false;
      sJump();
    }
    if (!keys.jump && p.vy < -250 && !p.jumpCut) { p.vy *= 0.55; p.jumpCut = true; }

    collideBox(p, (cxi, cyi) => {
      const ch = grid[cyi] && grid[cyi][cxi];
      if (ch === '?' || ch === '!' || ch === '*' || ch === '=') popCrate(cxi, cyi, ch);
    });
    p.onGround = p.grounded;
    if (p.iframes > 0) p.iframes -= DT;
    if (p.starT > 0) {
      p.starT -= DT;
      sparkT += DT;
      if (sparkT > 0.09) {
        sparkT = 0;
        pops.push({ kind: 'spark', x: p.x + p.w / 2 + (Math.random() - 0.5) * 40, y: p.y + Math.random() * p.h, t: 0 });
      }
    }

    // hot tea throw
    shotCd -= DT;
    if (firePressed) {
      firePressed = false;
      if (p.power === 2 && shots.length < 2 && shotCd <= 0) {
        shots.push({ x: p.x + p.w / 2 + p.face * 16, y: p.y + p.h * 0.4, vx: p.face * 430, vy: -90, t: 0 });
        shotCd = 0.3;
        sThrow();
      }
    }

    // world edges + pit
    p.x = clamp(p.x, 0, def.len * TILE - p.w);
    if (p.y > ROWS * TILE + 100) { lives--; if (lives < 0) mode = 'gameover'; else startLevel(level); return; }

    // tiles the body overlaps: cups + spikes
    for (const [ex, ey] of [[p.x + 4, p.y + 6], [p.x + p.w - 4, p.y + 6], [p.x + 4, p.y + p.h - 6], [p.x + p.w - 4, p.y + p.h - 6], [p.x + p.w / 2, p.y + p.h / 2]]) {
      const cxi = Math.floor(ex / TILE), cyi = Math.floor(ey / TILE);
      const ch = grid[cyi] && grid[cyi][cxi];
      if (ch === 'o') {
        grid[cyi][cxi] = '-';
        tea++;
        sCup();
        pops.push({ kind: 'cup', x: cxi * TILE + TILE / 2, y: cyi * TILE, t: 0 });
      } else if (ch === '^' && p.y + p.h > cyi * TILE + 18) {
        if (p.starT <= 0) hurt();
      }
    }

    // flag
    if (p.x + p.w / 2 >= def.flag * TILE + 10) {
      mode = 'flag';
      flagPhase = 0;
      fadeT = 0;
      p.x = def.flag * TILE + 10;
      p.vx = 0;
      p.duck = false;
      p.h = playerH();
      sFlag();
    }

    /* ---- enemies ---- */
    for (const f of foes) {
      if (f.dead > 0) { f.dead += DT; continue; }
      if (f.type === 'h') {                          // hopper: leaps toward Mano
        if (f.grounded) {
          f.vx = 0;
          f.hopT += DT;
          if (f.hopT > 1.2) {
            f.hopT = 0;
            f.vx = (p.x > f.x ? 1 : -1) * 135;
            f.vy = -600;
          }
        }
      }
      f.vy += GRAV * DT;
      const hitWall = collideBox(f);
      if (hitWall) f.vx = -f.vx;
      if (f.y > ROWS * TILE + 120) f.dead = 9;

      // player contact
      if (p.x < f.x + f.w && p.x + p.w > f.x && p.y < f.y + f.h && p.y + p.h > f.y) {
        if (p.starT > 0) {
          killFoe(f);
        } else if (p.vy > 120 && p.y + p.h - f.y < 22) {
          if (f.type === 'k') hurt();                // spiky: stomping is a mistake
          else { killFoe(f); p.vy = JUMPV * 0.55; }
        } else hurt();
      }
    }
    foes = foes.filter(f => f.dead === 0 || f.dead < 0.4);

    /* ---- power items ---- */
    for (const it of items) {
      it.vy += GRAV * DT;
      const hw = collideBox(it);
      if (hw) it.vx = -it.vx;
      if (it.kind === 'star' && it.grounded) it.vy = -520;   // the star bounces
      if (p.x < it.x + it.w && p.x + p.w > it.x && p.y < it.y + it.h && p.y + p.h > it.y) {
        it.got = true;
        if (it.kind === 'chai') {
          if (player.power < 1) { player.power = 1; player.y -= 16; }
          else tea += 5;
          sPow();
        } else if (it.kind === 'kettle') {
          if (player.power < 1) player.y -= 16;
          player.power = 2;
          sPow();
        } else if (it.kind === 'star') {
          player.starT = 8;
          sStar();
        }
      }
    }
    items = items.filter(it => !it.got && it.y < ROWS * TILE + 150);

    /* ---- hot tea shots ---- */
    for (const sh of shots) {
      sh.t += DT;
      sh.vy += GRAV * 0.82 * DT;
      sh.x += sh.vx * DT;
      sh.y += sh.vy * DT;
      if (sh.vy > 0 && SOLID[tileAt(sh.x, sh.y + 7)]) { sh.y = Math.floor((sh.y + 7) / TILE) * TILE - 7.01; sh.vy = -380; }
      if (SOLID[tileAt(sh.x + Math.sign(sh.vx) * 8, sh.y)]) sh.gone = true;
      if (sh.t > 2.3 || sh.x < camX - 60 || sh.x > camX + W + 60) sh.gone = true;
      for (const f of foes) {
        if (f.dead > 0) continue;
        if (sh.x > f.x - 6 && sh.x < f.x + f.w + 6 && sh.y > f.y - 6 && sh.y < f.y + f.h + 6) {
          killFoe(f);
          sh.gone = true;
        }
      }
    }
    shots = shots.filter(sh => !sh.gone);

    /* ---- particles + bumps ---- */
    for (const q of pops) {
      q.t += DT;
      if (q.kind === 'shard') { q.vy += GRAV * DT; q.x += q.vx * DT; q.y += q.vy * DT; }
    }
    pops = pops.filter(q => q.t < 0.6);
    for (const k in bumps) {
      bumps[k] += DT;
      if (bumps[k] > 0.24) delete bumps[k];
    }

    /* ---- camera ---- */
    camX = clamp(p.x - W * 0.38, 0, def.len * TILE - W);

    if (confirmTapped) confirmTapped = false;
  }

  /* ---------------------------------------------------------------------------
     Drawing — worlds
     ------------------------------------------------------------------------ */

  function drawSky(world) {
    if (world === 1) {
      const g = cx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#f2e2c0');
      g.addColorStop(1, '#f8eeda');
      cx.fillStyle = g;
      cx.fillRect(0, 0, W, H);
      // sun
      cx.fillStyle = '#e8b84b';
      cx.strokeStyle = INK;
      cx.lineWidth = 3;
      cx.beginPath(); cx.arc(W - 130, 86, 34, 0, Math.PI * 2); cx.fill(); cx.stroke();
      // clouds (parallax)
      cx.fillStyle = '#fffdf6';
      for (let i = 0; i < 5; i++) {
        const cxp = ((i * 420 + 100 - camX * 0.25) % (W + 300) + W + 300) % (W + 300) - 150;
        const cyp = 60 + (i % 3) * 46;
        cx.beginPath();
        cx.ellipse(cxp, cyp, 52, 17, 0, 0, Math.PI * 2);
        cx.ellipse(cxp + 34, cyp - 10, 34, 14, 0, 0, Math.PI * 2);
        cx.fill();
      }
      // hills
      cx.fillStyle = '#b7c98a';
      for (let i = 0; i < 6; i++) {
        const hx = ((i * 360 - camX * 0.45) % (W + 500) + W + 500) % (W + 500) - 250;
        cx.beginPath(); cx.ellipse(hx, H - 60, 190, 105, 0, Math.PI, 0); cx.fill();
      }
      cx.fillStyle = '#9ab36a';
      for (let i = 0; i < 5; i++) {
        const hx = ((i * 470 + 140 - camX * 0.6) % (W + 600) + W + 600) % (W + 600) - 300;
        cx.beginPath(); cx.ellipse(hx, H - 40, 150, 80, 0, Math.PI, 0); cx.fill();
      }
    } else {
      const g = cx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#1d2140');
      g.addColorStop(1, '#2b2b4a');
      cx.fillStyle = g;
      cx.fillRect(0, 0, W, H);
      // stars (fixed pattern)
      cx.fillStyle = 'rgba(240,240,255,.8)';
      for (let i = 0; i < 60; i++) {
        const sx = (i * 173.3) % W, sy = (i * 97.7) % (H * 0.6);
        const tw = 0.5 + 0.5 * Math.sin(time * 2 + i);
        cx.globalAlpha = 0.25 + 0.5 * tw;
        cx.fillRect(sx, sy, 2.4, 2.4);
      }
      cx.globalAlpha = 1;
      // moon
      cx.fillStyle = '#e9e6da';
      cx.strokeStyle = INK;
      cx.lineWidth = 3;
      cx.beginPath(); cx.arc(W - 140, 90, 30, 0, Math.PI * 2); cx.fill(); cx.stroke();
      cx.fillStyle = '#c9c5b8';
      cx.beginPath(); cx.arc(W - 148, 84, 7, 0, Math.PI * 2); cx.arc(W - 130, 100, 5, 0, Math.PI * 2); cx.fill();
      // quarry silhouettes
      cx.fillStyle = '#232645';
      for (let i = 0; i < 6; i++) {
        const qx = ((i * 380 - camX * 0.4) % (W + 500) + W + 500) % (W + 500) - 250;
        cx.beginPath();
        cx.moveTo(qx - 170, H);
        cx.lineTo(qx - 60, H - 190 - (i % 2) * 50);
        cx.lineTo(qx + 30, H - 120);
        cx.lineTo(qx + 150, H - 230 + (i % 3) * 30);
        cx.lineTo(qx + 260, H);
        cx.fill();
      }
    }
  }

  function rr(x, y, w, h, r) {
    cx.beginPath();
    cx.moveTo(x + r, y);
    cx.arcTo(x + w, y, x + w, y + h, r);
    cx.arcTo(x + w, y + h, x, y + h, r);
    cx.arcTo(x, y + h, x, y, r);
    cx.arcTo(x, y, x + w, y, r);
    cx.closePath();
  }

  function drawTile(ch, sx, sy, world, cxi, cyi) {
    cx.lineWidth = 3;
    cx.strokeStyle = INK;
    if (ch === '#') {
      const topOpen = cyi > 0 ? grid[cyi - 1][cxi] : '-';
      if (world === 1) {
        cx.fillStyle = '#a9714b';
        cx.fillRect(sx, sy, TILE, TILE);
        if (!SOLID[topOpen]) {
          cx.fillStyle = '#6f9a4d';
          cx.fillRect(sx, sy, TILE, 14);
          cx.fillStyle = '#5d8440';
          cx.fillRect(sx + 6, sy + 10, 8, 4);
          cx.fillRect(sx + 28, sy + 9, 9, 4);
        }
      } else {
        cx.fillStyle = '#63607a';
        cx.fillRect(sx, sy, TILE, TILE);
        if (!SOLID[topOpen]) {
          cx.fillStyle = '#8b8798';
          cx.fillRect(sx, sy, TILE, 12);
        }
        cx.strokeStyle = 'rgba(36,24,18,.35)';
        cx.strokeRect(sx + 10, sy + 22, 14, 10);
      }
      cx.strokeStyle = 'rgba(36,24,18,.5)';
      cx.strokeRect(sx + 0.5, sy + 0.5, TILE - 1, TILE - 1);
    } else if (ch === '=' || ch === '?' || ch === '!' || ch === '*' || ch === 'X') {
      const off = bumps[cxi + ',' + cyi] ? -Math.sin(Math.min(bumps[cxi + ',' + cyi] / 0.24, 1) * Math.PI) * 9 : 0;
      const y = sy + off;
      cx.fillStyle = ch === 'X' ? '#7a6a58' : ch === '*' ? '#e8b84b' : '#c99a5b';
      rr(sx + 2, y + 2, TILE - 4, TILE - 4, 7);
      cx.fill(); cx.stroke();
      cx.strokeStyle = 'rgba(36,24,18,.4)';
      cx.beginPath();
      cx.moveTo(sx + 6, y + TILE / 2); cx.lineTo(sx + TILE - 6, y + TILE / 2);
      cx.stroke();
      if (ch === '?' || ch === '!' || ch === '*') {
        cx.fillStyle = INK;
        cx.font = '800 22px "Baloo 2", sans-serif';
        cx.textAlign = 'center';
        cx.textBaseline = 'middle';
        cx.fillText(ch === '?' ? '?' : ch === '!' ? '!' : '\u2605', sx + TILE / 2, y + TILE / 2 + 1);
      }
    } else if (ch === 'T') {
      // tea urn block: copper body
      cx.fillStyle = world === 1 ? '#b05e30' : '#4d4a63';
      rr(sx + 4, sy + 2, TILE - 8, TILE - 2, 9);
      cx.fill(); cx.stroke();
      const above = cyi > 0 ? grid[cyi - 1][cxi] : '-';
      if (above !== 'T') {                                       // lid on top urn
        cx.fillStyle = world === 1 ? '#8a4a24' : '#3a3852';
        rr(sx + 1, sy - 4, TILE - 2, 12, 6);
        cx.fill(); cx.stroke();
        cx.beginPath(); cx.arc(sx + TILE / 2, sy - 4, 4, 0, Math.PI * 2);
        cx.fillStyle = INK; cx.fill();
      }
    } else if (ch === '^') {
      cx.fillStyle = world === 1 ? '#b9b2a4' : '#cfd2e0';
      cx.beginPath();
      for (let i = 0; i < 3; i++) {
        const bx = sx + i * (TILE / 3);
        cx.moveTo(bx, sy + TILE);
        cx.lineTo(bx + TILE / 6, sy + 10);
        cx.lineTo(bx + TILE / 3, sy + TILE);
      }
      cx.fill(); cx.stroke();
    } else if (ch === 'o') {
      const bob = Math.sin(time * 3 + cxi) * 4;
      const cyp = sy + TILE / 2 + bob;
      cx.fillStyle = '#f7f1e6';
      cx.beginPath();
      cx.moveTo(sx + 12, cyp - 6);
      cx.lineTo(sx + 36, cyp - 6);
      cx.quadraticCurveTo(sx + 35, cyp + 10, sx + 24, cyp + 10);
      cx.quadraticCurveTo(sx + 13, cyp + 10, sx + 12, cyp - 6);
      cx.closePath();
      cx.fill(); cx.stroke();
      cx.fillStyle = '#b06a2f';
      cx.beginPath(); cx.ellipse(sx + 24, cyp - 6, 12, 4, 0, 0, Math.PI * 2); cx.fill(); cx.stroke();
      cx.strokeStyle = 'rgba(36,24,18,.55)';
      cx.lineWidth = 2;
      cx.beginPath();
      cx.moveTo(sx + 20, cyp - 12); cx.quadraticCurveTo(sx + 17, cyp - 17, sx + 20, cyp - 21);
      cx.moveTo(sx + 28, cyp - 12); cx.quadraticCurveTo(sx + 31, cyp - 17, sx + 28, cyp - 21);
      cx.stroke();
    }
  }

  function drawFlagAndDoor(world) {
    const fx = def.flag * TILE - camX + TILE / 2;
    const groundY = OFFY + 9 * TILE;
    // pole
    cx.strokeStyle = INK;
    cx.lineWidth = 5;
    cx.beginPath(); cx.moveTo(fx, groundY); cx.lineTo(fx, groundY - 4.6 * TILE); cx.stroke();
    cx.fillStyle = '#e8b84b';
    cx.beginPath(); cx.arc(fx, groundY - 4.6 * TILE, 7, 0, Math.PI * 2); cx.fill();
    cx.strokeStyle = INK; cx.lineWidth = 3; cx.stroke();
    // cloth
    cx.fillStyle = '#3e5a49';
    cx.beginPath();
    cx.moveTo(fx, groundY - 4.35 * TILE);
    cx.lineTo(fx - 52, groundY - 4.0 * TILE);
    cx.lineTo(fx, groundY - 3.65 * TILE);
    cx.closePath();
    cx.fill(); cx.stroke();
    cx.fillStyle = '#f7f1e6';
    cx.beginPath(); cx.moveTo(fx - 36, groundY - 4.13 * TILE); cx.lineTo(fx - 22, groundY - 3.85 * TILE); cx.lineTo(fx - 36, groundY - 3.85 * TILE); cx.closePath();
    cx.fill();
    // tea shop door
    const dx = (def.flag + 2.6) * TILE - camX;
    cx.fillStyle = world === 1 ? '#b05e30' : '#3a3852';
    rr(dx, groundY - 2.4 * TILE, 2.4 * TILE, 2.4 * TILE, 8);
    cx.fill();
    cx.strokeStyle = INK; cx.lineWidth = 3; cx.stroke();
    // awning
    cx.fillStyle = world === 1 ? '#c0392b' : '#6b71f2';
    cx.beginPath();
    for (let i = 0; i < 3; i++) {
      const ax = dx - 8 + i * ((2.4 * TILE + 16) / 3);
      cx.rect(ax, groundY - 2.6 * TILE, (2.4 * TILE + 16) / 3 - 2, 16);
    }
    cx.fill(); cx.stroke();
    // door leaf + window
    cx.fillStyle = '#241812';
    rr(dx + 14, groundY - 1.6 * TILE, 34, 1.6 * TILE, 6);
    cx.fill();
    cx.fillStyle = world === 1 ? '#f7e9c9' : '#ffd98a';
    rr(dx + 62, groundY - 1.9 * TILE, 36, 30, 5);
    cx.fill(); cx.strokeStyle = INK; cx.lineWidth = 2.5; cx.stroke();
    cx.fillStyle = INK;
    cx.font = '800 13px "Baloo 2", sans-serif';
    cx.textAlign = 'center';
    cx.fillText('TEA', dx + 1.2 * TILE, groundY - 2.75 * TILE);
  }

  function drawMano() {
    const p = player;
    const SET = p.power === 2 ? HOTS : SPRITES;
    let img = SET.idle;
    if (mode === 'dead') img = SET.jump;
    else if (p.duck) img = SET.duck;
    else if (!p.onGround) img = SET.jump;
    else if (Math.abs(p.vx) > 24) img = (Math.floor(p.runD / 26) % 2) ? SET.run1 : SET.run2;
    if (p.starT <= 0 && p.iframes > 0 && Math.floor(p.iframes * 12) % 2) return;

    const big = p.power >= 1;
    const dw = 48 * (big ? 1.35 : 1.05);
    const dh = 68 * (big ? 1.35 : 1.05);
    const sx = p.x + p.w / 2 - camX;
    const sy = OFFY + p.y + p.h - dh + 2;

    if (p.starT > 0) {                       // star aura
      const hue = (time * 420) % 360;
      const rg = cx.createRadialGradient(sx, sy + dh / 2, 6, sx, sy + dh / 2, dh * 0.72);
      rg.addColorStop(0, `hsla(${hue}, 95%, 65%, .5)`);
      rg.addColorStop(1, 'hsla(0, 0%, 100%, 0)');
      cx.fillStyle = rg;
      cx.beginPath();
      cx.arc(sx, sy + dh / 2, dh * 0.72, 0, Math.PI * 2);
      cx.fill();
    }
    cx.save();
    cx.translate(sx, sy + dh / 2);
    if (p.face < 0) cx.scale(-1, 1);
    if (mode === 'dead') cx.scale(1, -1);
    if (spritesReady >= 10) cx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    cx.restore();
  }

  function drawFoe(f) {
    const sx = f.x - camX, sy = OFFY + f.y;
    const sq = f.dead > 0 ? Math.min(f.dead / 0.15, 1) : 0;
    const h = f.h * (1 - sq * 0.62);
    const roll = f.x / 14;
    cx.save();
    cx.translate(sx + f.w / 2, sy + f.h - h / 2);
    cx.fillStyle = f.type === 'k' ? '#6e6a7a' : f.type === 'h' ? '#a89d8a' : '#8d8577';
    cx.strokeStyle = INK;
    cx.lineWidth = 3;
    if (f.type === 'h') {
      cx.beginPath();
      cx.ellipse(0, 0, 13, h / 2, 0, 0, Math.PI * 2);
      cx.fill(); cx.stroke();
    } else {
      cx.beginPath();
      cx.moveTo(-16, h / 2);
      cx.lineTo(-18, -h * 0.15);
      cx.lineTo(-8, -h / 2);
      cx.lineTo(9, -h / 2 + 2);
      cx.lineTo(18, -h * 0.1);
      cx.lineTo(16, h / 2);
      cx.closePath();
      cx.fill(); cx.stroke();
    }
    if (f.type === 'k' && !sq) {                   // shard crown: do not stomp
      cx.fillStyle = '#cfd2e0';
      cx.beginPath();
      cx.moveTo(-14, -h / 2 + 2); cx.lineTo(-9, -h / 2 - 11); cx.lineTo(-4, -h / 2 + 1);
      cx.moveTo(-3, -h / 2 + 1); cx.lineTo(2, -h / 2 - 13); cx.lineTo(7, -h / 2 + 1);
      cx.moveTo(8, -h / 2 + 1); cx.lineTo(13, -h / 2 - 10); cx.lineTo(17, -h / 2 + 2);
      cx.fill(); cx.stroke();
    }
    if (!sq) {
      // angry little face
      cx.fillStyle = '#f7f1e6';
      cx.beginPath(); cx.arc(-6, -2, 4, 0, Math.PI * 2); cx.arc(6, -2, 4, 0, Math.PI * 2); cx.fill();
      cx.fillStyle = INK;
      cx.beginPath(); cx.arc(-5 + Math.sin(roll) * 1.2, -1, 1.8, 0, Math.PI * 2); cx.arc(7 + Math.sin(roll) * 1.2, -1, 1.8, 0, Math.PI * 2); cx.fill();
      cx.lineWidth = 2.4;
      cx.beginPath(); cx.moveTo(-10, -8); cx.lineTo(-3, -5.5); cx.moveTo(10, -8); cx.lineTo(3, -5.5); cx.stroke();
      cx.beginPath(); cx.moveTo(-4, 6); cx.quadraticCurveTo(0, 3.4, 4, 6); cx.stroke();
    }
    cx.restore();
  }

  function drawItem(it) {
    const sx = it.x - camX, sy = OFFY + it.y;
    if (it.kind === 'star') {
      const hue = (time * 300) % 360;
      cx.fillStyle = `hsl(${hue}, 85%, 62%)`;
      cx.strokeStyle = INK;
      cx.lineWidth = 3;
      cx.save();
      cx.translate(sx + it.w / 2, sy + it.h / 2);
      cx.rotate(Math.sin(time * 5) * 0.2);
      cx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = i * Math.PI / 5 - Math.PI / 2;
        const r = i % 2 ? 8 : 17;
        cx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      cx.closePath();
      cx.fill(); cx.stroke();
      cx.restore();
      return;
    }
    if (it.kind === 'kettle') {
      cx.fillStyle = '#a3402a';
      cx.strokeStyle = INK;
      cx.lineWidth = 3;
      rr(sx + 3, sy + 10, it.w - 8, it.h - 12, 10);
      cx.fill(); cx.stroke();
      cx.beginPath();                                       // spout
      cx.moveTo(sx + 3, sy + 16);
      cx.quadraticCurveTo(sx - 7, sy + 14, sx - 5, sy + 24);
      cx.lineTo(sx + 3, sy + 24);
      cx.closePath();
      cx.fill(); cx.stroke();
      cx.beginPath();                                       // handle
      cx.moveTo(sx + 8, sy + 10);
      cx.quadraticCurveTo(sx + it.w / 2 - 2, sy - 2, sx + it.w - 8, sy + 10);
      cx.lineWidth = 3.4; cx.stroke();
      cx.beginPath(); cx.arc(sx + it.w / 2 - 2, sy + 12, 3, 0, Math.PI * 2);
      cx.fillStyle = '#e8b84b'; cx.fill(); cx.lineWidth = 2.4; cx.stroke();
      cx.strokeStyle = 'rgba(36,24,18,.55)';
      cx.beginPath();
      cx.moveTo(sx - 3, sy + 8); cx.quadraticCurveTo(sx - 6, sy + 2, sx - 3, sy - 4);
      cx.stroke();
      return;
    }
    cx.fillStyle = '#f7f1e6';
    cx.strokeStyle = INK;
    cx.lineWidth = 3;
    rr(sx + 2, sy + 8, it.w - 10, it.h - 10, 7);
    cx.fill(); cx.stroke();
    cx.fillStyle = '#b06a2f';
    cx.beginPath(); cx.ellipse(sx + it.w / 2 - 3, sy + 9, (it.w - 12) / 2, 4.5, 0, 0, Math.PI * 2); cx.fill(); cx.stroke();
    cx.beginPath();
    cx.moveTo(sx + it.w - 8, sy + 12);
    cx.quadraticCurveTo(sx + it.w + 4, sy + 14, sx + it.w - 4, sy + 24);
    cx.strokeStyle = INK; cx.lineWidth = 2.6; cx.stroke();
    cx.strokeStyle = 'rgba(36,24,18,.55)';
    cx.beginPath();
    cx.moveTo(sx + 10, sy + 3); cx.quadraticCurveTo(sx + 7, sy - 3, sx + 10, sy - 8);
    cx.moveTo(sx + 18, sy + 3); cx.quadraticCurveTo(sx + 21, sy - 3, sx + 18, sy - 8);
    cx.stroke();
  }

  function drawPops() {
    for (const q of pops) {
      const sx = q.x - camX, sy = OFFY + q.y;
      if (q.kind === 'cup') {
        cx.globalAlpha = 1 - q.t / 0.6;
        cx.fillStyle = '#b06a2f';
        cx.font = '800 20px "Baloo 2", sans-serif';
        cx.textAlign = 'center';
        cx.fillText('+1', sx, sy - q.t * 70);
        cx.globalAlpha = 1;
      } else if (q.kind === 'star') {
        cx.globalAlpha = 1 - q.t / 0.5;
        cx.strokeStyle = INK;
        cx.lineWidth = 2.5;
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + 0.6;
          const d = 8 + q.t * 60;
          cx.beginPath();
          cx.moveTo(sx + Math.cos(a) * d, sy + Math.sin(a) * d);
          cx.lineTo(sx + Math.cos(a) * (d + 7), sy + Math.sin(a) * (d + 7));
          cx.stroke();
        }
        cx.globalAlpha = 1;
      } else if (q.kind === 'spark') {
        cx.globalAlpha = 1 - q.t / 0.4;
        cx.fillStyle = `hsl(${(q.t * 900) % 360}, 90%, 65%)`;
        const r = 3 + q.t * 8;
        cx.beginPath();
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + q.t * 6;
          cx.moveTo(sx, sy);
          cx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
        }
        cx.strokeStyle = cx.fillStyle;
        cx.lineWidth = 2;
        cx.stroke();
        cx.globalAlpha = 1;
      } else if (q.kind === 'shard') {
        cx.globalAlpha = 1 - q.t / 0.6;
        cx.fillStyle = '#c99a5b';
        cx.strokeStyle = INK;
        cx.lineWidth = 2;
        cx.fillRect(sx - 6, sy - 6, 12, 12);
        cx.strokeRect(sx - 6, sy - 6, 12, 12);
        cx.globalAlpha = 1;
      }
    }
  }

  /* ---------------------------------------------------------------------------
     Screens + HUD
     ------------------------------------------------------------------------ */

  function chipLabel(i) { return DEFS[i].world + '-' + (i % 4 + 1); }

  function drawHUD() {
    cx.font = '800 21px "Baloo 2", sans-serif';
    cx.textBaseline = 'middle';
    // tea chip
    cx.fillStyle = 'rgba(255,247,230,.92)';
    cx.strokeStyle = INK; cx.lineWidth = 3;
    rr(14, 12, 130, 36, 18); cx.fill(); cx.stroke();
    cx.fillStyle = INK; cx.textAlign = 'left';
    cx.fillText('TEA × ' + tea, 30, 31);
    // world chip
    rr(W / 2 - 110, 12, 220, 36, 18);
    cx.fillStyle = 'rgba(255,247,230,.92)'; cx.fill(); cx.stroke();
    cx.fillStyle = INK; cx.textAlign = 'center';
    cx.fillText(chipLabel(level) + ' · ' + def.name, W / 2, 31);
    // lives chip
    rr(W - 144, 12, 130, 36, 18);
    cx.fillStyle = 'rgba(255,247,230,.92)'; cx.fill(); cx.stroke();
    cx.fillStyle = INK;
    cx.fillText('MANO × ' + Math.max(lives, 0), W - 79, 31);
    if (muted) {
      cx.font = '800 14px "Baloo 2", sans-serif';
      cx.fillText('MUTED (M)', W - 79, 58);
    }
    if (player.starT > 0) {
      cx.font = '800 15px "Baloo 2", sans-serif';
      cx.fillStyle = `hsl(${(time * 420) % 360}, 80%, 40%)`;
      cx.textAlign = 'center';
      cx.fillText('\u2605 STAR ' + Math.ceil(player.starT), W / 2, 62);
    } else if (player.power === 2) {
      cx.font = '800 14px "Baloo 2", sans-serif';
      cx.fillStyle = '#a3402a';
      cx.textAlign = 'center';
      cx.fillText('HOT TEA \u00b7 X to throw', W / 2, 62);
    }
  }

  function panel(w, h) {
    cx.fillStyle = 'rgba(36,24,18,.55)';
    cx.fillRect(0, 0, W, H);
    cx.fillStyle = '#fff7e6';
    cx.strokeStyle = INK;
    cx.lineWidth = 4;
    rr(W / 2 - w / 2, H / 2 - h / 2, w, h, 20);
    cx.fill(); cx.stroke();
  }

  function drawTitle() {
    drawSky(1);
    // ground strip
    for (let i = 0; i < Math.ceil(W / TILE); i++) drawTile('#', i * TILE, OFFY + 9 * TILE, 1, i, 9);
    // big Supermano
    if (spritesReady >= 10) {
      cx.save();
      cx.translate(W / 2 + 296, OFFY + 9 * TILE - 92);
      cx.drawImage(SPRITES.idle, -62, -84, 129, 184);
      cx.restore();
    }
    cx.textAlign = 'center';
    cx.fillStyle = INK;
    cx.font = '800 74px "Baloo 2", sans-serif';
    cx.fillText('YANAIMANO', W / 2 - 60, 120);
    cx.font = '800 25px "Baloo 2", sans-serif';
    cx.fillStyle = '#b06a2f';
    cx.fillText('SUPERMANO — the platform uncle', W / 2 - 60, 165);
    cx.font = '700 16px Nunito, sans-serif';
    cx.fillStyle = '#5a4a3a';
    cx.fillText('Two worlds. Eight levels. Sixty cups of tea. Zero smiles.', W / 2 - 60, 196);

    // level chips
    chipRects = [];
    const cw = 92, ch2 = 54, gapx = 16, startX = W / 2 - (4 * cw + 3 * gapx) / 2 - 60;
    for (let i = 0; i < DEFS.length; i++) {
      const row = Math.floor(i / 4), col = i % 4;
      const x = startX + col * (cw + gapx), y = 240 + row * 72;
      const open = i <= progress;
      cx.fillStyle = open ? '#fff7e6' : 'rgba(255,247,230,.45)';
      cx.strokeStyle = INK;
      cx.lineWidth = 3;
      rr(x, y, cw, ch2, 12); cx.fill(); cx.stroke();
      cx.fillStyle = open ? INK : 'rgba(36,24,18,.4)';
      cx.font = '800 22px "Baloo 2", sans-serif';
      cx.fillText(chipLabel(i), x + cw / 2, y + 22);
      cx.font = '700 11px Nunito, sans-serif';
      cx.fillText(open ? DEFS[i].name : 'locked', x + cw / 2, y + 41);
      chipRects.push({ x, y, w: cw, h: ch2, i });
    }

    cx.fillStyle = INK;
    cx.font = '800 20px "Baloo 2", sans-serif';
    cx.fillText((0.5 + 0.5 * Math.sin(time * 4)) > 0.4 ? 'PRESS ENTER · OR TAP A LEVEL' : '', W / 2 - 60, 422);
    cx.font = '700 14px Nunito, sans-serif';
    cx.fillStyle = '#fff7e6';
    cx.fillText('World 1 · Tea Gardens        World 2 · Rock Quarry', W / 2 - 60, 476);
  }

  function drawSplash() {
    drawSky(def.world);
    panel(430, 190);
    cx.fillStyle = INK;
    cx.textAlign = 'center';
    cx.font = '800 52px "Baloo 2", sans-serif';
    cx.fillText('WORLD ' + chipLabel(level), W / 2, H / 2 - 22);
    cx.font = '800 23px "Baloo 2", sans-serif';
    cx.fillStyle = '#b06a2f';
    cx.fillText(def.name, W / 2, H / 2 + 20);
    cx.font = '700 15px Nunito, sans-serif';
    cx.fillStyle = '#5a4a3a';
    cx.fillText('MANO × ' + Math.max(lives, 0), W / 2, H / 2 + 54);
  }

  function drawEndScreen(title, sub, hint) {
    panel(560, 230);
    cx.fillStyle = INK;
    cx.textAlign = 'center';
    cx.font = '800 50px "Baloo 2", sans-serif';
    cx.fillText(title, W / 2, H / 2 - 40);
    cx.font = '800 21px "Baloo 2", sans-serif';
    cx.fillStyle = '#b06a2f';
    cx.fillText(sub, W / 2, H / 2 + 6);
    cx.font = '700 15px Nunito, sans-serif';
    cx.fillStyle = '#5a4a3a';
    cx.fillText(hint, W / 2, H / 2 + 66);
  }

  function drawGame() {
    drawSky(def.world);
    // tiles in view
    const c0 = Math.max(0, Math.floor(camX / TILE) - 1);
    const c1 = Math.min(def.len - 1, Math.ceil((camX + W) / TILE) + 1);
    drawFlagAndDoor(def.world);
    for (let r = 0; r < ROWS; r++) {
      for (let c = c0; c <= c1; c++) {
        const ch = grid[r][c];
        if (ch !== '-') drawTile(ch, c * TILE - camX, OFFY + r * TILE, def.world, c, r);
      }
    }
    for (const it of items) drawItem(it);
    for (const sh of shots) {
      const sxp = sh.x - camX, syp = OFFY + sh.y;
      cx.fillStyle = '#b06a2f';
      cx.strokeStyle = INK;
      cx.lineWidth = 2.4;
      cx.beginPath();
      cx.arc(sxp, syp, 7, 0, Math.PI * 2);
      cx.fill(); cx.stroke();
      cx.strokeStyle = 'rgba(247,241,230,.85)';
      cx.beginPath();
      cx.arc(sxp - sh.vx * 0.014, syp - 3, 4, 0, Math.PI * 1.4);
      cx.stroke();
    }
    for (const f of foes) if (f.dead < 0.4) drawFoe(f);
    drawMano();
    drawPops();
    drawHUD();
    if (mode === 'flag' && fadeT > 0) {
      cx.fillStyle = `rgba(36,24,18,${Math.min(fadeT / 0.7, 1)})`;
      cx.fillRect(0, 0, W, H);
    }
  }

  /* ---------------------------------------------------------------------------
     Main loop
     ------------------------------------------------------------------------ */

  let last = 0, acc = 0;

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    acc += dt;
    while (acc >= DT) { step(); acc -= DT; }

    if (mode === 'title') {
      time += dt;
      drawTitle();
      if (confirmTapped) { confirmTapped = false; startLevel(Math.min(progress, DEFS.length - 1)); }
    } else if (mode === 'splash') {
      drawSplash();
      confirmTapped = false;
    } else if (mode === 'play' || mode === 'flag' || mode === 'dead') {
      drawGame();
    } else if (mode === 'gameover') {
      drawGame();
      drawEndScreen('OUT OF MANOS', 'The kettle went cold. Tea collected: ' + tea, 'ENTER · back to the title');
      if (confirmTapped) { confirmTapped = false; toTitle(); }
    } else if (mode === 'victory') {
      drawSky(1);
      for (let i = 0; i < Math.ceil(W / TILE); i++) drawTile('#', i * TILE, OFFY + 9 * TILE, 1, i, 9);
      if (spritesReady >= 10) cx.drawImage(SPRITES.idle, W / 2 - 60, OFFY + 9 * TILE - 170, 120, 170);
      drawEndScreen('ALL WORLDS CLEAR', 'Tea collected: ' + tea + ' cups. Yanai almost smiled. Almost.', 'ENTER · back to the title');
      if (confirmTapped) { confirmTapped = false; toTitle(); }
    }

    requestAnimationFrame(frame);
  }

  document.fonts?.load('800 74px "Baloo 2"');
  document.fonts?.load('700 15px Nunito');
  requestAnimationFrame(now => { last = now; requestAnimationFrame(frame); });

  /* ---------------------------------------------------------------------------
     Test / debug hook
     ------------------------------------------------------------------------ */

  window.MANO = {
    get mode() { return mode; },
    get level() { return level; },
    get def() { return def; },
    get tea() { return tea; },
    get lives() { return lives; },
    get player() { return player; },
    get progress() { return progress; },
    get foesLeft() { return foes.filter(f => f.dead === 0).length; },
    get foe0() { const f = foes.find(q => q.dead === 0); return f ? { x: f.x, y: f.y, type: f.type } : null; },
    get foesInfo() { return foes.filter(f => f.dead === 0).map(f => ({ x: f.x, y: f.y, type: f.type })); },
    get power() { return player.power; },
    get starT() { return player.starT; },
    get shotsN() { return shots.length; },
    spawnItem(kind) { items.push({ kind, x: player.x + 4, y: player.y - 70, vx: 0, vy: 0, w: 34, h: 32 }); },
    gridAt(c, r) { return grid[r] && grid[r][c]; },
    get itemsN() { return items.length; },
    pressFire() { firePressed = true; },
    startLevel,
    toTitle,
    warp(x, y) { player.x = x; player.y = y; player.vy = 0; },
    skipSplash() { if (mode === 'splash') mode = 'play'; },
  };
})();

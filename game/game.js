/* =============================================================================
   ASCENT — page behaviour
   -----------------------------------------------------------------------------
   The page is a single climb: the canvas canyon advances with scroll, sections
   fly in from their own directions (and fly back out when you scroll up), the
   zones chapter-switcher rewinds, and the HUD rail tracks your "level".
   Everything is continuous and reversible — nothing is a one-shot fade.
   ========================================================================== */

(() => {
  'use strict';

  const clamp  = (v, a, b) => (v < a ? a : v > b ? b : v);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(pointer: fine)').matches;
  const $ = id => document.getElementById(id);

  // Z-mode: scroll flies the camera forward through a stack of slides
  // instead of moving a document down. Only on desktop-class setups —
  // phones and reduced-motion keep the classic vertical page, which is why
  // every .zmode style is additive and this class is the single switch.
  const ZMODE = finePointer && !reduce && innerWidth >= 900;
  if (ZMODE) document.documentElement.classList.add('zmode');

  /* ---------------------------------------------------------------------------
     Fly-in — continuous, bidirectional
     ------------------------------------------------------------------------ */

  const flyEls = [...document.querySelectorAll('[data-fly]')];
  const staggers = flyEls.map(el => parseFloat(el.style.getPropertyValue('--d')) || 0);

  const ARRIVE_AT = 0.72;   // element lands once its centre passes this line
  const STAGGER   = 0.07;

  function updateFly() {
    const vh = innerHeight;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
    const remaining = maxScroll - scrollY;

    for (let i = 0; i < flyEls.length; i++) {
      const el = flyEls[i];
      const r = el.getBoundingClientRect();
      const centre = r.top + r.height / 2;

      // The last elements on the page can never climb to the arrival line —
      // the scroll runs out first — so their line moves down to the highest
      // point they will actually reach. (max, because y grows downward.)
      const arriveY = Math.max(vh * ARRIVE_AT, centre - remaining);
      const span = Math.max(vh - arriveY, 1);

      const t = clamp((vh - centre) / span - staggers[i] * STAGGER, 0, 1);
      el.style.setProperty('--t', t.toFixed(3));
      // sin(t·π): zero at both ends, peaks mid-flight. The corner paths use
      // it to bow upward — a curve, not a straight diagonal slide.
      el.style.setProperty('--arc', Math.sin(t * Math.PI).toFixed(3));
    }
  }

  /* ---------------------------------------------------------------------------
     Zones — pinned chapter switcher
     ------------------------------------------------------------------------ */

  const zonesSec = document.querySelector('[data-zones]');
  const zoneStage = $('zoneStage');
  const zoneBar = $('zoneBar');
  const ZONE_COUNT = 3;

  function updateZones() {
    if (!zonesSec) return;
    const rect = zonesSec.getBoundingClientRect();
    const total = zonesSec.offsetHeight - innerHeight;
    const p = total > 0 ? clamp(-rect.top / total, 0, 1) : 0;

    // 0.999: at p exactly 1 the index would hit ZONE_COUNT and select nothing.
    const idx = Math.min(ZONE_COUNT - 1, Math.floor(p * 0.999 * ZONE_COUNT));
    if (zoneStage.dataset.active !== String(idx)) zoneStage.dataset.active = String(idx);
    if (zoneBar) zoneBar.style.width = (p * 100).toFixed(2) + '%';
  }

  /* ---------------------------------------------------------------------------
     HUD rail — level + altitude
     ------------------------------------------------------------------------ */

  const SUMMIT_M = 9700;
  const secs = [...document.querySelectorAll('[data-sec]')];
  const railDots = $('railDots');
  const railLv = $('railLv');
  const railAlt = $('railAlt');

  secs.forEach(() => {
    const li = document.createElement('li');
    railDots.append(li);
  });
  const dots = [...railDots.children];

  function updateRail() {
    // Active section: the last one whose top has crossed mid-screen.
    let active = 0;
    for (let i = 0; i < secs.length; i++) {
      if (secs[i].getBoundingClientRect().top < innerHeight * 0.5) active = i;
    }
    dots.forEach((d, i) => d.classList.toggle('is-on', i <= active));
    railLv.textContent = 'LV ' + String(active + 1).padStart(2, '0');

    // Altitude climbs with overall progress — scroll = ascent.
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    const alt = Math.round((scrollY / maxScroll) * SUMMIT_M);
    railAlt.textContent = alt.toLocaleString('en-IN') + ' m';
  }

  /* ---------------------------------------------------------------------------
     Scramble — headings decode on first approach
     ------------------------------------------------------------------------ */

  const GLYPHS = '!<>-_\\/[]{}=+*^?#01';
  const scrambles = [...document.querySelectorAll('[data-scramble]')];

  function runScramble(el) {
    const finalText = el.dataset.final;
    const n = finalText.length;
    const DUR = 900;
    let t0 = null;

    (function step(now) {
      if (t0 === null) t0 = now;
      const k = clamp((now - t0) / DUR, 0, 1);
      const settled = Math.floor(k * n);
      let out = finalText.slice(0, settled);
      for (let i = settled; i < n; i++) {
        out += finalText[i] === ' ' ? ' ' : GLYPHS[(Math.random() * GLYPHS.length) | 0];
      }
      el.textContent = out;
      if (k < 1) requestAnimationFrame(step);
    })(performance.now());
  }

  scrambles.forEach(el => { el.dataset.final = el.textContent.trim(); });

  function updateScrambles() {
    for (let i = scrambles.length - 1; i >= 0; i--) {
      const r = scrambles[i].getBoundingClientRect();
      if (r.top < innerHeight * 0.85 && r.bottom > 0) {
        runScramble(scrambles[i]);
        scrambles.splice(i, 1);        // decode once; rewinding shouldn't re-garble
      }
    }
  }

  /* ---------------------------------------------------------------------------
     Counters
     ------------------------------------------------------------------------ */

  const counters = [...document.querySelectorAll('[data-count]')];

  function runCounter(el) {
    const target = parseFloat(el.dataset.count);
    const dec = parseInt(el.dataset.decimals || '0', 10);
    const suffix = el.dataset.suffix || '';
    const render = v => { el.textContent = v.toFixed(dec) + suffix; };
    if (reduce) { render(target); return; }

    const DUR = 1100;
    let t0 = null;
    (function step(now) {
      if (t0 === null) t0 = now;
      const k = clamp((now - t0) / DUR, 0, 1);
      render(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    })(performance.now());
  }

  function updateCounters() {
    for (let i = counters.length - 1; i >= 0; i--) {
      const r = counters[i].getBoundingClientRect();
      if (r.top < innerHeight * 0.9 && r.bottom > 0) {
        runCounter(counters[i]);
        counters.splice(i, 1);
      }
    }
  }

  /* ---------------------------------------------------------------------------
     One scroll pump for everything above
     ------------------------------------------------------------------------ */

  function update() {
    if (!reduce) updateFly();
    updateZones();
    updateRail();
    updateScrambles();
    updateCounters();
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  }

  if (!ZMODE) {
    /* ------------------------- classic vertical page ------------------------- */
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);

    if (reduce) {
      flyEls.forEach(el => el.style.setProperty('--t', '1'));
      scrambles.length = 0;            // headings stay readable, no decode
      counters.forEach(runCounter);
      counters.length = 0;
    }

    update();
  } else {
    /* ---------------------------------------------------------------------------
       Z engine — the page as a stack of slides in depth
       -----------------------------------------------------------------------------
       Scroll maps to a camera position camU measured in slide-units. Each
       slide has a start on that timeline and a weight; weight above 1 is
       "hold" — extra scroll during which the slide stays at the front (the
       zones chapter-switcher spends its hold switching sectors). Ahead of
       its start a slide hangs BEHIND the front one, dim and small; past its
       hold it flies toward the camera, over your shoulder, and out.
       ------------------------------------------------------------------------ */

    const UNIT = 950;                  // px of scroll per slide-unit
    const DEPTH = 850;                 // px of translateZ per unit of distance

    const WEIGHT = { top: 1.4, story: 1.3, zones: 3.6, classes: 1.4,
                     features: 1.4, numbers: 1.1, editions: 1.4, cta: 1 };

    const slides = secs.map(el => ({ el, w: WEIGHT[el.id] ?? 1.2 }));
    let acc = 0;
    for (const s of slides) { s.start = acc; acc += s.w; }
    const TOTAL = slides[slides.length - 1].start;   // camU never passes the last slide

    for (const s of slides) {
      s.fly  = [...s.el.querySelectorAll('[data-fly]')].map(el => ({
        el, stag: parseFloat(el.style.getPropertyValue('--d')) || 0 }));
      s.scr  = scrambles.filter(el => s.el.contains(el));
      s.cnt  = counters.filter(el => s.el.contains(el));
      s.done = false;
    }

    // The fixed stage removes the document's height; the spacer restores it.
    const spacer = $('zspacer');
    const sizeSpacer = () => { spacer.style.height = (TOTAL * UNIT + innerHeight) + 'px'; };
    sizeSpacer();

    const zonesSlide = slides.find(s => s.el.id === 'zones');

    function zUpdate() {
      const camU = clamp(scrollY / UNIT, 0, TOTAL);

      for (let i = 0; i < slides.length; i++) {
        const s = slides[i];
        const hold = s.w - 1;
        let d;
        if (camU < s.start) d = s.start - camU;                       // waiting behind
        else if (camU <= s.start + hold || i === slides.length - 1) d = 0;  // at the front
        else d = (s.start + hold) - camU;                             // flying past

        // Far-behind and long-gone slides cost nothing. is-front is cleared
        // BEFORE the early-out: a programmatic jump (anchor click, test) can
        // hop a slide straight into "gone" without ever passing through the
        // in-between bands, and it would keep a stale front flag forever.
        const gone = d < -0.85 || d > 2.7;
        s.el.style.setProperty('--sv', gone ? 'hidden' : 'visible');
        s.el.classList.toggle('is-front', !gone && Math.abs(d) < 0.5);
        if (gone) continue;

        s.el.style.setProperty('--sz', (-d * DEPTH).toFixed(1));
        const so = d >= 0 ? clamp(1.12 - d * 0.42, 0, 1) : clamp(1 + d * 1.5, 0, 1);
        s.el.style.setProperty('--so', so.toFixed(3));

        // Children complete their compass flights as the slide surfaces.
        const st = clamp(1 - d, 0, 1);
        for (const f of s.fly) {
          const t = clamp(st * 1.3 - f.stag * 0.09, 0, 1);
          f.el.style.setProperty('--t', t.toFixed(3));
          f.el.style.setProperty('--arc', Math.sin(t * Math.PI).toFixed(3));
        }

        if (!s.done && d < 0.7) {
          s.done = true;
          s.scr.forEach(runScramble);
          s.cnt.forEach(runCounter);
        }
      }

      // zones switch sectors across their hold at the front
      if (zonesSlide && zoneStage) {
        const p = clamp((camU - zonesSlide.start) / (zonesSlide.w - 1), 0, 1);
        const idx = Math.min(ZONE_COUNT - 1, Math.floor(p * 0.999 * ZONE_COUNT));
        if (zoneStage.dataset.active !== String(idx)) zoneStage.dataset.active = String(idx);
        if (zoneBar) zoneBar.style.width = (p * 100).toFixed(2) + '%';
      }

      // HUD rail
      let active = 0;
      for (let i = 0; i < slides.length; i++) if (camU >= slides[i].start - 0.5) active = i;
      dots.forEach((el, i) => el.classList.toggle('is-on', i <= active));
      railLv.textContent = 'LV ' + String(active + 1).padStart(2, '0');
      railAlt.textContent = Math.round(camU / TOTAL * SUMMIT_M).toLocaleString('en-IN') + ' m';
    }

    let zTicking = false;
    addEventListener('scroll', () => {
      if (zTicking) return;
      zTicking = true;
      requestAnimationFrame(() => { zUpdate(); zTicking = false; });
    }, { passive: true });
    addEventListener('resize', () => { sizeSpacer(); zUpdate(); });

    // Anchors land on a slide's start position on the timeline — the
    // element's own document offset is meaningless inside a fixed stage.
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        const target = slides.find(s => s.el.id === a.getAttribute('href').slice(1));
        if (!target) return;
        e.preventDefault();
        scrollTo({ top: target.start * UNIT, behavior: 'smooth' });
      });
    });

    zUpdate();
  }

  /* ---------------------------------------------------------------------------
     Tilt cards — pointer-tracked 3D
     ------------------------------------------------------------------------ */

  if (finePointer && !reduce) {
    document.querySelectorAll('.tcard').forEach(card => {
      const inner = card.querySelector('.tcard__inner');
      const art = card.querySelector('.tcard__art');
      const MAX = 10;   // degrees

      // glare layer, created here so no-JS markup stays clean
      const glare = document.createElement('span');
      glare.className = 'tcard__glare';
      art.append(glare);

      card.addEventListener('pointermove', e => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;    // -0.5 .. 0.5
        const py = (e.clientY - r.top) / r.height - 0.5;
        inner.style.setProperty('--ry', (px * MAX * 2).toFixed(2) + 'deg');
        inner.style.setProperty('--rx', (-py * MAX * 2).toFixed(2) + 'deg');

        // glare tracks the pointer across the art, in the art's own space
        const a = art.getBoundingClientRect();
        glare.style.setProperty('--gx', (e.clientX - a.left).toFixed(1) + 'px');
        glare.style.setProperty('--gy', (e.clientY - a.top).toFixed(1) + 'px');
      });

      card.addEventListener('pointerleave', () => {
        inner.style.setProperty('--rx', '0deg');
        inner.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ---------------------------------------------------------------------------
     Hover layer — cursor, magnetic buttons, spotlights, bursts
     -----------------------------------------------------------------------------
     All of it gated on a fine pointer and full motion: touch devices keep
     their native behaviour and reduced-motion users never see any of it.
     ------------------------------------------------------------------------ */

  if (finePointer && !reduce) {

    /* ---- custom cursor with pickable skins ----
       Original neon designs in the page's own style — weapon archetypes
       (warhammer / dagger / energy gauntlet), drawn from scratch rather than
       any studio's branded art, which isn't ours to copy. */

    const SKIN_SVGS = {
      hammer: `<svg class="skin skin--hammer" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path d="M20 4 L44 9 L42 21 L18 16 Z" fill="#0d0722" stroke="#00f0ff" stroke-width="2" stroke-linejoin="round"/>
        <path d="M27 18 L12 44" stroke="#ff2ec4" stroke-width="4.5" stroke-linecap="round"/>
        <circle cx="12" cy="44" r="2.4" fill="#00f0ff"/>
      </svg>`,
      blade: `<svg class="skin skin--blade" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path d="M7 7 L29 15 L21 27 Z" fill="#0d0722" stroke="#00f0ff" stroke-width="2" stroke-linejoin="round"/>
        <path d="M23 20 L30 27" stroke="#8b5cff" stroke-width="5.5" stroke-linecap="round"/>
        <path d="M31 28 L40 39" stroke="#ff2ec4" stroke-width="4.5" stroke-linecap="round"/>
        <circle cx="41.5" cy="41" r="2.6" fill="#00f0ff"/>
      </svg>`,
      gauntlet: `<svg class="skin skin--gauntlet" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path d="M17 18 V8 M22.5 17 V5 M28 17 V6 M33.5 18 V9" stroke="#00f0ff" stroke-width="3.6" stroke-linecap="round"/>
        <rect x="13" y="17" width="24" height="18" rx="6" fill="#0d0722" stroke="#00f0ff" stroke-width="2"/>
        <path d="M13 27 L6 21" stroke="#00f0ff" stroke-width="3.6" stroke-linecap="round"/>
        <circle cx="25" cy="26" r="6" stroke="#ff2ec4" stroke-width="2"/>
        <circle cx="25" cy="26" r="3" fill="#fff"/>
      </svg>`,
    };

    const RETICLE_PREVIEW = `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <rect x="15" y="15" width="18" height="18" stroke="#00f0ff" stroke-width="2" transform="rotate(45 24 24)"/>
      <circle cx="24" cy="24" r="2.5" fill="#00f0ff"/>
    </svg>`;

    document.body.classList.add('has-cursor');
    const cur = document.createElement('div');
    cur.className = 'cur';
    cur.innerHTML = '<i class="cur__ring"></i><i class="cur__dot"></i>' +
                    SKIN_SVGS.hammer + SKIN_SVGS.blade + SKIN_SVGS.gauntlet;
    document.body.append(cur);

    const SKINS = ['reticle', 'hammer', 'blade', 'gauntlet'];
    const savedSkin = localStorage.getItem('ascent-cursor');
    cur.dataset.skin = SKINS.includes(savedSkin) ? savedSkin : 'reticle';

    // picker chips, bottom-left
    const pick = document.createElement('div');
    pick.className = 'curpick';
    pick.innerHTML = '<span class="curpick__label">Cursor</span>' +
      SKINS.map(k =>
        `<button type="button" data-skin="${k}" aria-label="${k} cursor">` +
        (k === 'reticle' ? RETICLE_PREVIEW : SKIN_SVGS[k].replace(/class="skin[^"]*"/, '')) +
        '</button>').join('');
    document.body.append(pick);

    const chips = [...pick.querySelectorAll('button')];
    const syncChips = () => chips.forEach(c =>
      c.classList.toggle('is-active', c.dataset.skin === cur.dataset.skin));
    syncChips();

    pick.addEventListener('click', e => {
      const chip = e.target.closest('button');
      if (!chip) return;
      cur.dataset.skin = chip.dataset.skin;
      localStorage.setItem('ascent-cursor', chip.dataset.skin);
      syncChips();
    });

    /* ---- click FX: shockwave + sparks + weapon strike + impact shake ---- */

    addEventListener('pointerdown', e => {
      // the equipped weapon swings/slashes/blasts
      cur.classList.remove('is-strike');
      void cur.offsetWidth;                       // restart mid-animation clicks
      cur.classList.add('is-strike');
      setTimeout(() => cur.classList.remove('is-strike'), 330);

      // shockwave ring + spark burst at the point of impact
      const fx = document.createElement('div');
      fx.className = 'fx';
      fx.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
      let inner = '<i class="fx__ring"></i>';
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 34 + Math.random() * 46;
        inner += `<i class="fx__spark" style="--dx:${(Math.cos(a) * r).toFixed(0)};` +
                 `--dy:${(Math.sin(a) * r).toFixed(0)}"></i>`;
      }
      fx.innerHTML = inner;
      document.body.append(fx);
      setTimeout(() => fx.remove(), 700);

      // a 1.5px stage kick sells the impact; Z-mode only, where the stage
      // is a transform root anyway
      if (ZMODE) {
        const stage = document.querySelector('main');
        stage.classList.remove('is-shake');
        void stage.offsetWidth;
        stage.classList.add('is-shake');
      }
    }, { passive: true });

    let mx = innerWidth / 2, my = innerHeight / 2;   // pointer
    let px = mx, py = my;                             // ring (lags behind)

    addEventListener('pointermove', e => { mx = e.clientX; my = e.clientY; }, { passive: true });

    const HOT = 'a, button, .tcard, .feats li, .ed, .zone__facts li';
    addEventListener('pointerover', e => {
      cur.classList.toggle('is-hot', !!e.target.closest(HOT));
    }, { passive: true });

    document.documentElement.addEventListener('pointerleave', () => { cur.style.opacity = '0'; });
    document.documentElement.addEventListener('pointerenter', () => { cur.style.opacity = '1'; });

    (function follow() {
      // ring trails the dot — the lag is what makes it feel physical
      px += (mx - px) * 0.22;
      py += (my - py) * 0.22;
      cur.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
      requestAnimationFrame(follow);
    })();

    /* ---- magnetic buttons ---- */

    document.querySelectorAll('.gbtn').forEach(btn => {
      const PULL = 0.3, MAXPX = 12;
      btn.addEventListener('pointermove', e => {
        const r = btn.getBoundingClientRect();
        const dx = clamp((e.clientX - r.left - r.width / 2) * PULL, -MAXPX, MAXPX);
        const dy = clamp((e.clientY - r.top - r.height / 2) * PULL, -MAXPX, MAXPX);
        btn.style.setProperty('--magx', dx.toFixed(1) + 'px');
        btn.style.setProperty('--magy', dy.toFixed(1) + 'px');
      });
      btn.addEventListener('pointerleave', () => {
        btn.style.setProperty('--magx', '0px');
        btn.style.setProperty('--magy', '0px');
      });
    });

    /* ---- spotlight follows the pointer inside cards ---- */

    document.querySelectorAll('.feats li, .ed').forEach(el => {
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - r.left).toFixed(1) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top).toFixed(1) + 'px');
      });
    });

    /* ---- nav links re-decode on hover ---- */

    document.querySelectorAll('.nav__links a').forEach(a => {
      const final = a.textContent;
      let running = false;
      a.addEventListener('pointerenter', () => {
        if (running) return;
        running = true;
        const DUR = 320;
        let t0 = null;
        (function step(now) {
          if (t0 === null) t0 = now;
          const k = clamp((now - t0) / DUR, 0, 1);
          const settled = Math.floor(k * final.length);
          let out = final.slice(0, settled);
          for (let i = settled; i < final.length; i++) {
            out += GLYPHS[(Math.random() * GLYPHS.length) | 0];
          }
          a.textContent = out;
          if (k < 1) return requestAnimationFrame(step);
          a.textContent = final;
          running = false;
        })(performance.now());
      });
    });

    /* ---- touching the title sets off a glitch burst ---- */

    document.querySelectorAll('.glitch').forEach(el => {
      let cooling = false;
      el.addEventListener('pointerenter', () => {
        if (cooling) return;
        cooling = true;
        el.classList.add('is-burst');
        setTimeout(() => {
          el.classList.remove('is-burst');
          // brief cooldown so waving across the title doesn't strobe it
          setTimeout(() => { cooling = false; }, 400);
        }, 550);
      });
    });
  }

  /* ---------------------------------------------------------------------------
     Ribbon — clone for the seamless -50% loop
     ------------------------------------------------------------------------ */

  const ribbon = $('ribbonTrack');
  if (ribbon) ribbon.innerHTML += ribbon.innerHTML;

  /* ---------------------------------------------------------------------------
     The canyon
     -----------------------------------------------------------------------------
     A synthwave wireframe valley, flown through by scroll. Height field is
     lattice value-noise whose amplitude grows away from the centre line, so
     the camera track stays low while walls rise on both sides. Scroll maps to
     camera Z — the page IS the route.
     ------------------------------------------------------------------------ */

  const cv = $('terrain');
  const ctx = cv?.getContext('2d');

  if (ctx) {
    const COLS = 46;          // vertices across
    const ROWS = 30;          // depth rows
    const XSPACE = 1.0;       // world units between columns
    const ZSTEP = 1.0;
    const CAM_Y = 2.3;
    const TRAVEL = 90;        // world units covered by a full page of scroll

    let W = 0, H = 0, cx = 0, horizon = 0, F = 0;
    let stars = [];

    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2;
      horizon = H * 0.40;
      F = H * 0.95;

      stars = [];
      for (let i = 0; i < 130; i++) {
        stars.push({ x: Math.random() * W, y: Math.random() * horizon * 0.94,
                     r: Math.random() * 1.3 + 0.4, p: Math.random() * Math.PI * 2 });
      }
    }
    resize();
    addEventListener('resize', resize);

    // Lattice value noise — deterministic, no Math.random at draw time.
    const hash = (x, z) => {
      let h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
      return h - Math.floor(h);
    };

    function noise(x, z) {
      const xi = Math.floor(x), zi = Math.floor(z);
      const xf = x - xi, zf = z - zi;
      const u = xf * xf * (3 - 2 * xf);
      const v = zf * zf * (3 - 2 * zf);
      const a = hash(xi, zi), b = hash(xi + 1, zi);
      const c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
    }

    // Valley profile: flat floor under the camera, walls climbing steeply
    // with |x|. The .35/.09 frequencies keep features several world units
    // wide, so rows morph smoothly instead of shimmering.
    function height(x, z) {
      const wall = 0.25 + Math.pow(Math.abs(x) / (COLS * XSPACE * 0.5), 1.7) * 9;
      return (noise(x * 0.35, z * 0.09) * 0.75 + noise(x * 0.12, z * 0.05) * 0.55) * wall;
    }

    const project = (wx, wy, dz) => {
      const k = F / dz;
      return [cx + wx * k, horizon + (CAM_Y - wy) * k];
    };

    function drawSun() {
      const r = Math.min(W, H) * 0.17;
      const sy = horizon - r * 0.25;
      const g = ctx.createLinearGradient(0, sy - r, 0, sy + r);
      g.addColorStop(0, '#ff9e3d');
      g.addColorStop(0.55, '#ff2ec4');
      g.addColorStop(1, '#8b5cff');
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, sy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, sy - r, r * 2, r * 2);
      // classic slice gaps across the lower half
      ctx.fillStyle = 'rgba(6, 2, 19, 0.9)';
      for (let i = 0; i < 6; i++) {
        const y = sy + (i / 6) * r;
        ctx.fillRect(cx - r, y, r * 2, 2 + i * 1.4);
      }
      ctx.restore();
    }

    // Pointer steering: the camera leans toward the cursor's side of the
    // screen, banking the whole canyon. Heavily damped on purpose — it
    // should feel like leaning, not aiming.
    let swayTarget = 0, sway = 0;
    if (finePointer && !reduce) {
      addEventListener('pointermove', e => {
        swayTarget = (e.clientX / innerWidth - 0.5) * 2;   // -1 .. 1
      }, { passive: true });
    }

    function frame(now) {
      const t = now / 1000;
      ctx.clearRect(0, 0, W, H);

      sway += (swayTarget * 2.2 - sway) * 0.045;

      // sky
      for (const s of stars) {
        ctx.globalAlpha = 0.35 + Math.sin(t * 0.8 + s.p) * 0.25;
        ctx.fillStyle = '#cfd8ff';
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }
      ctx.globalAlpha = 1;

      drawSun();

      // horizon glow line
      const hg = ctx.createLinearGradient(0, horizon - 20, 0, horizon + 30);
      hg.addColorStop(0, 'transparent');
      hg.addColorStop(0.5, 'rgba(255, 46, 196, 0.35)');
      hg.addColorStop(1, 'transparent');
      ctx.fillStyle = hg;
      ctx.fillRect(0, horizon - 20, W, 50);

      // camera advances with scroll, drifting slightly even at rest
      const maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
      const camZ = (scrollY / maxScroll) * TRAVEL + (reduce ? 0 : t * 0.55);

      // Terrain rows walk world-space integers ahead of the camera, so the
      // grid slides toward you rather than swimming in place.
      const z0 = Math.floor(camZ) + 1;
      const pts = [];      // pts[row][col] = [sx, sy] — reused for both passes

      for (let ri = 0; ri < ROWS; ri++) {
        const wz = z0 + ri;
        const dz = wz - camZ;
        const row = [];
        for (let ci = 0; ci <= COLS; ci++) {
          const wx = (ci - COLS / 2) * XSPACE;
          // camera slides by `sway`; terrain itself stays put in world space
          row.push(project(wx - sway, height(wx, wz), dz));
        }
        pts.push(row);
      }

      // depth fade: near rows cyan and solid, far rows pink and faint
      const rowStyle = ri => {
        const d = ri / ROWS;
        const r = Math.round(0   + d * 255);
        const g = Math.round(240 - d * 194);
        const b = Math.round(255 - d * 59);
        const a = (1 - d) * 0.5 + 0.06;
        return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
      };

      // cross lines
      for (let ri = 0; ri < ROWS; ri++) {
        ctx.strokeStyle = rowStyle(ri);
        ctx.lineWidth = ri < 6 ? 1.5 : 1;
        ctx.beginPath();
        const row = pts[ri];
        ctx.moveTo(row[0][0], row[0][1]);
        for (let ci = 1; ci <= COLS; ci++) ctx.lineTo(row[ci][0], row[ci][1]);
        ctx.stroke();
      }

      // longitudinal lines, sparser — every other column keeps the grid
      // readable without doubling the draw cost
      ctx.lineWidth = 1;
      for (let ci = 0; ci <= COLS; ci += 2) {
        ctx.strokeStyle = 'rgba(139, 92, 255, 0.20)';
        ctx.beginPath();
        ctx.moveTo(pts[0][ci][0], pts[0][ci][1]);
        for (let ri = 1; ri < ROWS; ri++) ctx.lineTo(pts[ri][ci][0], pts[ri][ci][1]);
        ctx.stroke();
      }

      if (!reduce) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
    // Reduced motion still paints one frame — a still vista, not a void.
  }
})();

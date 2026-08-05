/* =============================================================================
   Kunnam Fit — the Coach film
   -----------------------------------------------------------------------------
   One canvas, one particle cast, one scroll-scrubbed timeline:

     u 0.0–1.0   hero      starfield drifts, headline fades out
     u 1.0–2.4   converge  stars spiral inward into a dotted cylinder
     u 2.4–5.55  ring      the ring holds; centre words cycle (3 of them)
     u 4.7–6.5   letters   "All of Kunnam, on Coach." arrives from the front
                           as a MASK: outside the glyphs goes black, the ring
                           scene keeps playing inside the letterforms while
                           they recede along Z into the resting sentence
     u 6.5–7.1   settle    the sentence rests centred, dim
     u 7.1–8.3   final     headline docks up top; the card carousel arrives

   The ring words and the giant sentence are all drawn ON the canvas so the
   mask clips them exactly like the reference. Everything is a pure function
   of scrollY (plus a gentle time-based ring rotation), so the film rewinds
   perfectly. Reduced motion or no JS collapses into plain sections.
   ========================================================================== */

(() => {
  'use strict';

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.getElementById('space');
  const ctx = canvas ? canvas.getContext('2d') : null;

  // decorative links and forms go nowhere
  document.querySelectorAll('a[href="#"]').forEach(a =>
    a.addEventListener('click', e => e.preventDefault()));
  document.querySelectorAll('form.pill').forEach(f =>
    f.addEventListener('submit', e => e.preventDefault()));

  /* ---------------------------------------------------------------------------
     Carousel (works in static mode too)
     ------------------------------------------------------------------------ */

  const track = document.getElementById('cardTrack');
  const prevBtn = document.getElementById('prevBtn');
  const nextBtn = document.getElementById('nextBtn');
  const pageNum = document.getElementById('pageNum');
  const CARDS = track.children.length;
  let card = 0;

  function setCard(n) {
    card = Math.max(0, Math.min(CARDS - 1, n));
    const w = track.children[0].getBoundingClientRect().width + 26;
    track.style.translate = (-card * w) + 'px 0';
    pageNum.textContent = (card + 1) + ' / ' + CARDS;
    prevBtn.disabled = card === 0;
    nextBtn.disabled = card === CARDS - 1;
  }
  prevBtn.addEventListener('click', () => setCard(card - 1));
  nextBtn.addEventListener('click', () => setCard(card + 1));
  setCard(0);

  if (reduce || !ctx) {
    document.documentElement.classList.add('static');
    return;
  }

  /* ---------------------------------------------------------------------------
     Timeline + layers
     ------------------------------------------------------------------------ */

  const PH = { hero: 1.0, conv: 2.4, words: 5.55, zoom0: 4.7, zoom1: 6.5, settle: 7.1, total: 8.3 };
  const WORDS = ['Track workouts', 'Count reps', 'Plan meals'];
  const SENTENCE = 'All of Kunnam, on Coach.';

  const heroLay = document.getElementById('lay-hero');
  const chipLay = document.getElementById('lay-chip');
  const finalLay = document.getElementById('lay-final');
  const spacer = document.getElementById('spacer');

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const sm = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;

  let vw = 0, vh = 0, UNIT = 0, dpr = 1;

  // offscreen layer for the letter mask (black sheet with glyph holes)
  const maskC = document.createElement('canvas');
  const mctx = maskC.getContext('2d');

  const baseFont = () => Math.min(Math.max(30, vw * 0.044), 58);
  document.fonts?.load('300 58px Inter');
  document.fonts?.load('400 30px Inter');

  /* ---------------------------------------------------------------------------
     The cast
     ------------------------------------------------------------------------ */

  const ROWS = 9;
  let dots = [];

  function buildCast() {
    const per = vw < 700 ? 78 : 118;
    dots = [];
    for (let row = 0; row < ROWS; row++) {
      for (let k = 0; k < per; k++) {
        const bright = Math.random() < 0.05;
        dots.push({
          sx: Math.random() * vw,                     // sky position
          sy: Math.random() * vh * 1.55,
          ang: (k / per) * Math.PI * 2 + row * 0.09 + Math.random() * 0.05,
          row,
          jr: (Math.random() - 0.5) * 6,              // radial jitter
          jy: (Math.random() - 0.5) * 2.6,
          spin: 2.8 + Math.random() * 2.6,            // unwind during converge
          lead: Math.random() * 0.4,                  // staggered arrival
          bend: (Math.random() - 0.5) * 170,          // curved flight path
          r: bright ? 1.6 + Math.random() : 0.6 + Math.random() * 1.0,
          al: bright ? 0.9 : 0.3 + Math.random() * 0.45,
          tw: Math.random() * Math.PI * 2,            // twinkle phase
          stray: Math.random() < 0.06,                // never joins the ring
        });
      }
    }
  }

  /* ---------------------------------------------------------------------------
     Render
     ------------------------------------------------------------------------ */

  let u = 0;
  const dbgState = { words: [0, 0, 0], scale: 0, maskA: 0 };

  function render(now) {
    const t = now / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* ---- background: navy dusk deepening to near-black ---- */
    const dark = sm(u / 5.2);
    const g = ctx.createLinearGradient(0, 0, 0, vh);
    g.addColorStop(0, `rgb(${28 - 17 * dark | 0}, ${30 - 18 * dark | 0}, ${49 - 27 * dark | 0})`);
    g.addColorStop(1, `rgb(${19 - 9 * dark | 0}, ${21 - 10 * dark | 0}, ${40 - 20 * dark | 0})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, vw, vh);

    /* ---- phase scalars ---- */
    const convT = sm((u - PH.hero) / (PH.conv - PH.hero));            // 0..1 swirl
    const ringT = convT;                                              // formed-ness
    const ringFade = 1 - sm((u - 5.7) / 1.0);                         // recede late
    const heroPar = clamp(u, 0, 1.4);                                 // sky parallax

    const R = Math.min(vw * 0.34, 440) * (1 + 1.05 * (1 - ringT));
    const cx = vw * 0.5;
    const cy = vh * 0.52;
    const gap = clamp(vh * 0.052, 26, 50);
    const rot = t * 0.11 + u * 0.3;

    /* ---- floor arcs ---- */
    if (convT > 0.15 && ringFade > 0) {
      ctx.strokeStyle = `rgba(200, 204, 226, ${0.055 * convT * ringFade})`;
      ctx.lineWidth = 1;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.ellipse(vw * 0.38, vh * 1.06, vw * (0.5 + i * 0.3), vw * (0.16 + i * 0.1), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    /* ---- ring base glow ---- */
    const glow = ringT * ringFade;
    if (glow > 0.03) {
      const baseY = cy + (ROWS / 2 - 0.5) * gap;
      const rg = ctx.createRadialGradient(cx, baseY, R * 0.1, cx, baseY, R * 1.25);
      rg.addColorStop(0, `rgba(190, 196, 236, ${0.13 * glow})`);
      rg.addColorStop(1, 'rgba(190, 196, 236, 0)');
      ctx.save();
      ctx.translate(cx, baseY);
      ctx.scale(1, 0.32);
      ctx.translate(-cx, -baseY);
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(cx, baseY, R * 1.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // the bright bottom rim
      ctx.strokeStyle = `rgba(216, 220, 248, ${0.4 * glow})`;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(cx, baseY, R, R * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* ---- vertical connector threads (front half only) ---- */
    if (glow > 0.1) {
      ctx.lineWidth = 1;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + rot * 0.4;
        const z = Math.sin(a);
        if (z < 0.15) continue;
        const x = cx + Math.cos(a) * R;
        ctx.strokeStyle = `rgba(196, 202, 238, ${0.06 * glow * z})`;
        ctx.beginPath();
        ctx.moveTo(x, cy - (ROWS / 2 - 0.5) * gap + z * R * 0.3);
        ctx.lineTo(x, cy + (ROWS / 2 - 0.5) * gap + z * R * 0.3);
        ctx.stroke();
      }
    }

    /* ---- the cast ---- */
    for (const d of dots) {
      let x, y, a;

      const skyX = d.sx;
      const skyY = d.sy - heroPar * vh * 0.28;

      if (convT <= 0 || d.stray) {
        x = skyX; y = skyY;
        a = d.al * (0.55 + 0.45 * Math.sin(t * 1.7 + d.tw));
        if (d.stray) a *= clamp(1 - (u - 2) / 2, 0, 1);
      }

      if (!d.stray && convT > 0) {
        const rr = R + d.jr;
        const rowY = (d.row - (ROWS - 1) / 2) * gap + d.jy;

        // per-dot flight progress: leaders form the ring while others stream in
        const pos = pp => {
          const e = 1 - Math.pow(1 - pp, 2.4);   // radial: fast in, then orbit
          const ang = d.ang + rot + (1 - pp) * d.spin;
          const rx = cx + Math.cos(ang) * rr;
          const ry = cy + rowY + Math.sin(ang) * rr * 0.3;
          let px = lerp(skyX, rx, e);
          let py = lerp(skyY, ry, e);
          // arc the flight path so mid-flight reads as orbital flow
          const dx = rx - skyX, dy = ry - skyY;
          const len = Math.hypot(dx, dy) || 1;
          const arc = Math.sin(pp * Math.PI) * d.bend;
          px += (-dy / len) * arc;
          py += (dx / len) * arc;
          return [px, py, Math.sin(ang)];
        };
        const pp = clamp(convT * 1.4 - d.lead, 0, 1);
        const [fx, fy, sz] = pos(pp);
        x = fx; y = fy;
        const depth = (sz + 1) / 2;                     // 0 back → 1 front
        a = d.al * lerp(0.9, 0.35 + 0.75 * depth, sm(pp)) * ringFade;

        // short comet streaks while in flight
        if (pp > 0.03 && pp < 0.97) {
          const [px, py] = pos(Math.max(0, pp - 0.035));
          ctx.strokeStyle = `rgba(210, 214, 240, ${a * 0.4})`;
          ctx.lineWidth = d.r * 0.8;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(x, y);
          ctx.stroke();
        }
      }

      if (a <= 0.01) continue;
      ctx.fillStyle = `rgba(226, 229, 248, ${clamp(a, 0, 1)})`;
      ctx.beginPath();
      ctx.arc(x, y, d.r, 0, Math.PI * 2);
      ctx.fill();
    }

    /* ---- centre words, part of the scene so the letter mask clips them ---- */
    const seg = (u - PH.conv) / ((PH.words - PH.conv) / 3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 3; i++) {
      const local = seg - i;
      const op = clamp(Math.min(sm(local / 0.24), 1 - sm((local - 0.8) / 0.2)), 0, 1);
      dbgState.words[i] = op;
      if (op <= 0.01) continue;
      ctx.font = `400 ${Math.min(Math.max(22, vw * 0.024), 32)}px Inter, sans-serif`;
      ctx.fillStyle = `rgba(214, 216, 230, ${op})`;
      ctx.fillText(WORDS[i], vw * 0.5, cy);
    }

    /* ---- the letter mask: sentence arrives from the front as windows onto
            the scene — black outside the glyphs, ring visible inside ---- */
    const zt = (u - PH.zoom0) / (PH.zoom1 - PH.zoom0);
    const ft = sm((u - PH.settle) / 0.55);
    if (zt > 0 && ft < 1) {
      const z = clamp(zt, 0, 1);
      const scale = Math.pow(70, 1 - sm(z));
      const fpx = baseFont() * scale;
      const outA = sm(zt / 0.18);
      dbgState.scale = scale;
      dbgState.maskA = outA;

      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mctx.clearRect(0, 0, vw, vh);
      mctx.fillStyle = `rgba(9, 10, 18, ${outA})`;
      mctx.fillRect(0, 0, vw, vh);
      mctx.globalCompositeOperation = 'destination-out';
      mctx.font = `300 ${fpx}px Inter, sans-serif`;
      mctx.textAlign = 'center';
      mctx.textBaseline = 'middle';
      mctx.fillText(SENTENCE, vw * 0.5, vh * 0.5);
      mctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(maskC, 0, 0, maskC.width, maskC.height, 0, 0, vw, vh);

      // glyph body: faint at first (pure window), solid dim gray at rest
      const bodyA = clamp(lerp(0.08, 0.5, sm(z)) * (1 - ft * 1.6), 0, 1);
      if (bodyA > 0.005) {
        ctx.font = `300 ${fpx}px Inter, sans-serif`;
        ctx.fillStyle = `rgba(168, 172, 196, ${bodyA})`;
        ctx.fillText(SENTENCE, vw * 0.5, vh * 0.5);
      }
    } else {
      dbgState.scale = 0;
      dbgState.maskA = 0;
    }

    /* ---- DOM layers ---- */

    const heroOp = 1 - sm((u - 0.22) / 0.55);
    heroLay.style.opacity = heroOp;
    heroLay.style.translate = `0 ${-sm(u / 0.8) * 12}vh`;
    heroLay.style.pointerEvents = heroOp > 0.5 ? 'auto' : 'none';
    chipLay.style.opacity = 1 - sm(u / 0.35);

    finalLay.style.opacity = ft;
    finalLay.style.translate = `0 ${(1 - ft) * 7}vh`;
    finalLay.classList.toggle('is-on', ft > 0.6);
  }

  /* ---------------------------------------------------------------------------
     Loop + wiring
     ------------------------------------------------------------------------ */

  function onScroll() { u = scrollY / UNIT; }

  function resize() {
    vw = innerWidth;
    vh = innerHeight;
    dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = vw * dpr;
    canvas.height = vh * dpr;
    maskC.width = vw * dpr;
    maskC.height = vh * dpr;
    UNIT = vh * 0.85;
    spacer.style.height = (PH.total * UNIT + vh) + 'px';
    buildCast();
    onScroll();
  }

  addEventListener('resize', resize);
  addEventListener('scroll', onScroll, { passive: true });
  resize();

  (function loop(now) {
    render(now || 0);
    requestAnimationFrame(loop);
  })(0);

  // debug/test hook
  window.FIT = { u: () => u, PH, dbg: () => dbgState };
})();

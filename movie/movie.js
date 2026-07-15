/* =============================================================================
   Kunnam Pictures — page behaviour
   -----------------------------------------------------------------------------
   Same split as the Kunnam Pro Max page: JS measures and writes custom properties,
   CSS owns the motion. Only transforms, opacity and custom properties are
   touched per frame, so nothing here forces layout.
   ========================================================================== */

(() => {
  'use strict';

  const clamp  = (v, a, b) => (v < a ? a : v > b ? b : v);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------------------
     Split the mission statement into words
     ------------------------------------------------------------------------ */

  document.querySelectorAll('[data-reveal-text]').forEach(el => {
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    words.forEach((w, i) => {
      const s = document.createElement('span');
      s.textContent = w;
      s.style.setProperty('--i', i);
      el.append(s, document.createTextNode(' '));
    });
    el.style.setProperty('--n', words.length);
  });

  /* ---------------------------------------------------------------------------
     Scene scrub
     ------------------------------------------------------------------------ */

  const scenes = [...document.querySelectorAll('[data-scene]')];

  function updateScenes() {
    for (const el of scenes) {
      const rect  = el.getBoundingClientRect();
      const total = el.offsetHeight - innerHeight;
      // A scene shorter than the viewport has no scrub range — pin it at 0
      // rather than dividing by zero and writing NaN into the stylesheet.
      const p = total > 0 ? clamp(-rect.top / total, 0, 1) : 0;
      el.style.setProperty('--p', p.toFixed(4));
    }
  }

  /* ---------------------------------------------------------------------------
     Depth — elements fly in from the back
     ------------------------------------------------------------------------ */

  // Deliberately NOT an IntersectionObserver one-shot. An observer can only
  // say "it's on screen" — it can't say *how far* through the approach the
  // element is, and that continuous value is the whole effect. So this is a
  // scroll-driven measurement per element instead.
  const depthEls = [...document.querySelectorAll('[data-reveal]')];

  // How far up the screen an element has to travel before it has fully
  // arrived: 1 = the element's centre is at the bottom edge, 0 = at the top.
  const ARRIVE_AT = 0.45;   // fraction of viewport height
  const STAGGER   = 0.08;   // per --d step, as a fraction of the approach

  // Read --d once. Reading computed style every frame would force layout on
  // every element on every scroll tick.
  const staggers = depthEls.map(el =>
    parseFloat(el.style.getPropertyValue('--d')) || 0);

  function updateDepth() {
    const vh = innerHeight;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - vh);
    const remaining = maxScroll - scrollY;   // scroll left before the page ends

    for (let i = 0; i < depthEls.length; i++) {
      const el = depthEls[i];
      const r = el.getBoundingClientRect();
      const centre = r.top + r.height / 2;

      // Normally an element arrives once its centre reaches ARRIVE_AT up the
      // screen. But the last elements on the page can never get that high —
      // the scroll runs out first — so they'd sit forever half-blurred and
      // half-transparent. Where an element can't reach the line, arrive at
      // the highest point it will actually ever get to.
      // max, not min: y grows downward, so the LOWER of the two lines on
      // screen is the larger number, and that's the one an element short on
      // scroll will actually stop at.
      const highestReachable = centre - remaining;
      const arriveY = Math.max(vh * ARRIVE_AT, highestReachable);
      const span = Math.max(vh - arriveY, 1);   // never divide by zero

      const z = clamp((vh - centre) / span - staggers[i] * STAGGER, 0, 1);
      el.style.setProperty('--z', z.toFixed(3));
    }
  }

  /* ---------------------------------------------------------------------------
     Aim every perspective box at the centre of the viewport
     ------------------------------------------------------------------------ */

  // A CSS `perspective-origin: 50% 50%` is the centre of the *container*, so a
  // receding element converges on its own section's middle — i.e. it appears to
  // rise from wherever that section sits. Pointing the origin at the viewport
  // centre instead makes everything erupt out of the middle of the screen and
  // expand outward as it arrives, which is the effect the reference has.
  const persBoxes = [...document.querySelectorAll(
    '.numbers, .partners, .films, .press, .contact, .stats, .stack, .quotes')];

  function updateOrigins() {
    const cx = innerWidth / 2;
    const cy = innerHeight / 2;
    for (const box of persBoxes) {
      const r = box.getBoundingClientRect();
      // Skip boxes nowhere near the screen; their origin can't matter yet.
      if (r.bottom < -vhPad() || r.top > innerHeight + vhPad()) continue;
      box.style.perspectiveOrigin = `${(cx - r.left).toFixed(1)}px ${(cy - r.top).toFixed(1)}px`;
    }
  }

  const vhPad = () => innerHeight;

  function update() {
    updateScenes();
    if (!reduce) { updateOrigins(); updateDepth(); }
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  }

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);

  // Reduced motion: land everything immediately and never move it again.
  if (reduce) depthEls.forEach(el => el.style.setProperty('--z', '1'));

  /* ---------------------------------------------------------------------------
     Counters
     ------------------------------------------------------------------------ */

  const counters = document.querySelectorAll('[data-count]');

  function runCounter(el) {
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    if (reduce) { el.textContent = target + suffix; return; }

    const DUR = 1200;
    let t0 = null;
    (function step(now) {
      if (t0 === null) t0 = now;
      const k = clamp((now - t0) / DUR, 0, 1);
      el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))) + suffix;
      if (k < 1) requestAnimationFrame(step);
    })(performance.now());
  }

  if (counters.length) {
    if (reduce || !('IntersectionObserver' in window)) {
      counters.forEach(runCounter);
    } else {
      const cio = new IntersectionObserver((entries, obs) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          runCounter(e.target);
          obs.unobserve(e.target);
        }
      }, { threshold: 0.6 });
      counters.forEach(el => cio.observe(el));
    }
  }

  /* ---------------------------------------------------------------------------
     Marquee
     ------------------------------------------------------------------------ */

  // The CSS loop translates the track by exactly -50%, which only lands
  // seamlessly if the track is two identical runs. Clone here rather than
  // duplicating the names in the markup, so the two halves cannot drift apart.
  document.querySelectorAll('.marquee__track').forEach(track => {
    track.innerHTML += track.innerHTML;
  });

  /* ---------------------------------------------------------------------------
     Sound — synthesised, so there is no audio file to ship
     ------------------------------------------------------------------------ */

  const soundBtn = document.getElementById('sound');
  const label    = soundBtn?.querySelector('.sound__label');
  let audio = null;   // { ctx, master } — built lazily on first press

  // An ambient two-note drone with a slow tremolo. Built from oscillators
  // rather than a file: no asset, no download, no licence.
  function buildAudio() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;

    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 520;
    filter.Q.value = 0.7;
    filter.connect(master);

    // Detuned pair a fifth apart — cinematic, not musical enough to annoy.
    [55, 82.4, 110].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = i === 2 ? 'triangle' : 'sawtooth';
      osc.frequency.value = freq;
      osc.detune.value = (i - 1) * 6;
      const g = ctx.createGain();
      g.gain.value = i === 2 ? 0.10 : 0.18;
      osc.connect(g).connect(filter);
      osc.start();
    });

    // Slow breathing on the whole bed.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 160;
    lfo.connect(lfoGain).connect(filter.frequency);
    lfo.start();

    return { ctx, master };
  }

  function setSound(on) {
    soundBtn.setAttribute('aria-pressed', String(on));
    if (label) label.textContent = on ? 'Sound: On' : 'Sound: Off';
    if (!audio) return;
    // Ramp, never step — a gain jump on a drone is an audible click.
    const t = audio.ctx.currentTime;
    audio.master.gain.cancelScheduledValues(t);
    audio.master.gain.setValueAtTime(audio.master.gain.value, t);
    audio.master.gain.linearRampToValueAtTime(on ? 0.14 : 0, t + (on ? 1.6 : 0.5));
  }

  soundBtn?.addEventListener('click', async () => {
    const turningOn = soundBtn.getAttribute('aria-pressed') !== 'true';

    // Build on first press only. Constructing an AudioContext before a
    // gesture leaves it suspended and browsers log a warning about it.
    if (turningOn && !audio) audio = buildAudio();
    if (audio?.ctx.state === 'suspended') await audio.ctx.resume();

    setSound(turningOn);
  });

  // Don't drone on into a tab the reader has left.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && soundBtn?.getAttribute('aria-pressed') === 'true') setSound(false);
  });

  /* ---------------------------------------------------------------------------
     Warp field
     -----------------------------------------------------------------------------
     A real 3D starfield: points at (x, y, z), projected as x/z. Marching z
     toward the camera moves each star outward from the vanishing point and
     grows it, and drawing from its previous projection to its current one
     gives the streak for free. Scrolling adds speed, so the field stretches
     into lines exactly when you're "moving".
     ------------------------------------------------------------------------ */

  const canvas = document.getElementById('warp');
  const ctx = canvas?.getContext('2d');

  if (ctx && !reduce) {
    const COUNT     = 460;
    const FOCAL     = 320;    // projection scale
    const DRIFT     = 0.055;  // idle speed — the field is never quite still
    const SCROLL_K  = 0.0016; // how hard scrolling pushes it
    const MAX_SPEED = 2.6;

    let W = 0, H = 0, cx = 0, cy = 0, dpr = 1;
    const stars = [];

    // Spawn away from dead centre: a star at x=y=0 projects onto the
    // vanishing point and just sits there, never streaking.
    function spawn(s) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.12 + Math.random() * 0.88;
      s.x = Math.cos(a) * r;
      s.y = Math.sin(a) * r;
      s.z = 0.28 + Math.random() * 0.72;
      s.pz = s.z;
      return s;
    }
    for (let i = 0; i < COUNT; i++) stars.push(spawn({}));

    function resize() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      W = canvas.clientWidth; H = canvas.clientHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2; cy = H / 2;
    }
    resize();
    addEventListener('resize', resize);

    let lastY = scrollY, vel = 0, prev = performance.now();

    function frame(now) {
      const dt = Math.min((now - prev) / 1000, 0.05);
      prev = now;

      // Smoothed scroll speed, so the field eases in and out of warp instead
      // of snapping the moment the wheel stops.
      const y = scrollY;
      vel = vel * 0.86 + Math.abs(y - lastY) * 0.14;
      lastY = y;
      const speed = Math.min(DRIFT + vel * SCROLL_K, MAX_SPEED);

      // Translucent wipe rather than clear: leftover pixels become the tail.
      ctx.fillStyle = 'rgba(5, 7, 11, 0.34)';
      ctx.fillRect(0, 0, W, H);

      ctx.lineCap = 'round';

      for (const s of stars) {
        s.pz = s.z;
        s.z -= speed * dt;
        if (s.z < 0.04) { spawn(s); continue; }

        const x0 = cx + (s.x / s.pz) * FOCAL;
        const y0 = cy + (s.y / s.pz) * FOCAL;
        const x1 = cx + (s.x / s.z) * FOCAL;
        const y1 = cy + (s.y / s.z) * FOCAL;

        // Recycle once it leaves the frame, or the maths runs away as z→0.
        if (x1 < -60 || x1 > W + 60 || y1 < -60 || y1 > H + 60) { spawn(s); continue; }

        const k = 1 - s.z;              // nearer = brighter and fatter
        const a = Math.min(k * 1.25, 1);
        ctx.strokeStyle = `rgba(226, 240, 255, ${a.toFixed(3)})`;
        ctx.lineWidth = Math.max(0.5, k * 2.1);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }

      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  } else if (ctx) {
    // Reduced motion: a still field, so the page still reads as space.
    const paint = () => {
      const w = canvas.width = canvas.clientWidth;
      const h = canvas.height = canvas.clientHeight;
      ctx.fillStyle = '#05070b';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 220; i++) {
        const a = Math.random() * 0.7 + 0.15;
        ctx.fillStyle = `rgba(226,240,255,${a})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 1.4, 1.4);
      }
    };
    paint();
    addEventListener('resize', paint);
  }

  /* ---------------------------------------------------------------------------
     Go
     ------------------------------------------------------------------------ */

  update();
})();

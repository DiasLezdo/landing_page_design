/* =============================================================================
   Kunnam Travels — the fleet, in depth
   -----------------------------------------------------------------------------
   Z-scroll: scroll flies the camera forward through a stack of booking slides.
   Each vehicle drives IN as its slide surfaces, idles while the chit gets
   stamped, then accelerates OFF before the slide passes over your shoulder.
   The environment runs an altitude arc with global progress: dawn road →
   noon → rail dusk → open sky → stratosphere → space. All of it scrubs
   backwards — the rocket lands, the stamp lifts, the sun comes back.
   ========================================================================== */

(() => {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp  = (a, b, t) => a + (b - a) * t;
  const ease  = t => t * t * (3 - 2 * t);
  const seg   = (u, a, b) => clamp((u - a) / (b - a), 0, 1);

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { document.documentElement.classList.add('rm'); return; }

  /* ---------------------------------------------------------------------------
     Timeline
     ------------------------------------------------------------------------ */

  const UNIT = 900;
  const DEPTH = 850;

  const slides = [...document.querySelectorAll('[data-slide]')].map(el => ({
    el,
    hold: parseFloat(el.dataset.hold || '0.6'),
    zone: el.dataset.zone || 'dawn',
  }));

  let acc = 0;
  for (const s of slides) { s.start = acc; acc += 1 + s.hold; }
  const TOTAL = slides[slides.length - 1].start + 0.35;

  const spacer = document.getElementById('zspacer');
  const sizeSpacer = () => { spacer.style.height = (TOTAL * UNIT + innerHeight) + 'px'; };
  sizeSpacer();
  addEventListener('resize', sizeSpacer);

  /* ---------------------------------------------------------------------------
     Environment — the altitude arc
     ------------------------------------------------------------------------ */

  //            skyA       skyB      cloud star sun  floor type
  const ZONES = {
    dawn:    ['#ffe6b8', '#ffcd8f', 0,  0,   1,   1,  'road'],
    morning: ['#ffeecb', '#ffdf9a', 0,  0,   1,   1,  'road'],
    noon:    ['#d8f1ff', '#a8dcf4', .25, 0,  1,   1,  'road'],
    dusty:   ['#ffe6b3', '#e6c08a', 0,  0,   1,   1,  'road'],
    dusk:    ['#ffc9a0', '#d98ba6', 0,  0,   .9,  1,  'rail'],
    sky:     ['#cfeeff', '#8fd0f0', 1,  0,   1,   0,  'road'],
    strato:  ['#9cc4ec', '#4a76a8', .5, .3,  .8,  0,  'road'],
    space:   ['#2b3350', '#10142b', 0,  1,   .3,  0,  'road'],
  };

  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (h1, h2, t) => {
    const a = hex(h1), b = hex(h2);
    return `rgb(${Math.round(lerp(a[0], b[0], t))}, ${Math.round(lerp(a[1], b[1], t))}, ${Math.round(lerp(a[2], b[2], t))})`;
  };

  // one keypoint per slide, anchored to the middle of its hold
  const KEYS = slides.map(s => ({ at: s.start + s.hold / 2, z: ZONES[s.zone] }));

  const FLOORS = {
    road: { bg: '#caa06b', line: 'rgba(255, 242, 214, .85)' },
    rail: { bg: '#8a7a63', line: 'rgba(29, 34, 48, .8)' },
  };

  const root = document.documentElement;

  function paintEnv(camU) {
    let i = 0;
    while (i < KEYS.length - 1 && camU > KEYS[i + 1].at) i++;
    const a = KEYS[i], b = KEYS[Math.min(i + 1, KEYS.length - 1)];
    const t = a === b ? 0 : seg(camU, a.at, b.at);

    root.style.setProperty('--skyA', mix(a.z[0], b.z[0], t));
    root.style.setProperty('--skyB', mix(a.z[1], b.z[1], t));
    root.style.setProperty('--cloudop', lerp(a.z[2], b.z[2], t).toFixed(2));
    root.style.setProperty('--starop', lerp(a.z[3], b.z[3], t).toFixed(2));
    root.style.setProperty('--sunop', lerp(a.z[4], b.z[4], t).toFixed(2));
    root.style.setProperty('--floorop', lerp(a.z[5], b.z[5], t).toFixed(2));
    root.style.setProperty('--scrollf', (camU / TOTAL).toFixed(4));

    // floor flavor is discrete: whichever zone we're mostly in
    const f = FLOORS[(t < .5 ? a : b).z[6]];
    root.style.setProperty('--floorbg', f.bg);
    root.style.setProperty('--floorline', f.line);
  }

  /* ---------------------------------------------------------------------------
     Vehicle choreography — drive in, idle + stamp, blast off
     ------------------------------------------------------------------------ */

  const MODES = {
    v1: 'ground', v2: 'ground', v3: 'ground', v4: 'ground',
    v5: 'ground', v6: 'ground', v7: 'air', v8: 'air', v9: 'rise',
  };

  const set = (el, n, v) => el.style.setProperty(n, v);

  function choreo(s, u) {
    const el = s.el;
    el.classList.toggle('is-stamped', u > .45 && u < 1);

    const mode = MODES[el.id];
    if (!mode) return;

    const ein  = 1 - ease(seg(u, .04, .3));    // 1 → 0 while arriving
    const eout = ease(seg(u, .76, .96));       // 0 → 1 while leaving

    let vx = 0, vy = 0;
    if (mode === 'ground') { vx = -70 * ein + 85 * eout; }
    if (mode === 'air')    { vx = -80 * ein + 95 * eout; vy = -26 * ein - 30 * eout; }
    if (mode === 'rise')   { vy =  60 * ein - 130 * eout; }

    set(el, '--vx', vx.toFixed(2));
    set(el, '--vy', vy.toFixed(2));
    set(el, '--spin', (u * 2200).toFixed(0));
    set(el, '--rush', Math.max(1 - seg(u, .06, .3), seg(u, .74, .92)).toFixed(2));

    // the digger digs through its hold: boom down, bucket curl, rock up —
    // and sets it all back down on the way out
    if (el.id === 'v5') {
      const d = seg(u, .34, .72);
      set(el, '--scoop', Math.sin(d * Math.PI).toFixed(3));
    }
  }

  /* ---------------------------------------------------------------------------
     The camera
     ------------------------------------------------------------------------ */

  const needle = document.getElementById('needle');
  const speedo = document.querySelector('.speedo');
  const odo = document.getElementById('odo');
  const cue = document.getElementById('cue');

  function update() {
    const camU = clamp(scrollY / UNIT, 0, TOTAL);

    for (let i = 0; i < slides.length; i++) {
      const s = slides[i];
      let d;
      if (camU < s.start) d = s.start - camU;
      else if (camU <= s.start + s.hold || i === slides.length - 1) d = 0;
      else d = (s.start + s.hold) - camU;

      const gone = d > 2.6 || d < -0.85;
      set(s.el, '--sv', gone ? 'hidden' : 'visible');
      s.el.classList.toggle('is-front', !gone && Math.abs(d) < 0.5);
      if (gone) continue;

      set(s.el, '--sz', (-d * DEPTH).toFixed(1));
      const so = d >= 0 ? clamp(1.1 - d * 0.42, 0, 1) : clamp(1 + d * 1.5, 0, 1);
      set(s.el, '--so', so.toFixed(3));

      choreo(s, seg(camU, s.start - 0.65, s.start + s.hold + 0.6));
    }

    paintEnv(camU);

    const p = camU / TOTAL;
    speedo.style.setProperty('--p', p.toFixed(3));
    odo.textContent = Math.round(p * 1284).toLocaleString('en-IN') + ' km';
    cue.classList.toggle('is-gone', p > 0.05);
  }

  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  }, { passive: true });

  // both ride buttons floor it to the end
  for (const id of ['rideBtn', 'rideBtn2']) {
    document.getElementById(id)?.addEventListener('click', e => {
      e.preventDefault();
      scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    });
  }

  update();
})();

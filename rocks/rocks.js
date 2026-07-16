/* =============================================================================
   Kunnam Rocks — the night shift, scrubbed
   -----------------------------------------------------------------------------
   Z-scroll stack (the proven engine). One clock runs the whole page: sky,
   stars, moon and a rising sun interpolate continuously with progress, so
   night becomes morning becomes noon with no cuts. Every beat — the climb
   down, the plunger, the boom, the cracks, the spill, the fix, the dump —
   is a pure function of scroll, so scrolling backwards un-blasts the
   mountain and puts the spilled rocks back on the truck.
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
    zone: el.dataset.zone || 'night',
  }));

  let acc = 0;
  for (const s of slides) { s.start = acc; acc += 1 + s.hold; }
  const TOTAL = slides[slides.length - 1].start + 0.35;

  const spacer = document.getElementById('zspacer');
  const sizeSpacer = () => { spacer.style.height = (TOTAL * UNIT + innerHeight) + 'px'; };
  sizeSpacer();
  addEventListener('resize', sizeSpacer);

  /* ---------------------------------------------------------------------------
     The clock — night to noon, one interpolation
     ------------------------------------------------------------------------ */

  //           skyA       skyB      stars moon sun  sunrise range      floor      line
  const ZONES = {
    night:   ['#1c2440', '#0d1226', 1,   1,  0,   0,   '#10152b', '#3a3a40', 'rgba(255,247,227,.14)'],
    night2:  ['#232c4d', '#111731', 1,   .9, 0,   .02, '#141a33', '#3a3a40', 'rgba(255,247,227,.14)'],
    predawn: ['#3a3560', '#c96a4e', .45, .5, .6,  .1,  '#2b2140', '#4a4438', 'rgba(255,247,227,.16)'],
    morning: ['#ffd9a0', '#ffb36b', 0,   0,  1,   .5,  '#6b8556', '#8a8172', 'rgba(35,39,51,.35)'],
    day:     ['#cfeeff', '#8fd0f0', 0,   0,  1,   1,   '#6f9e60', '#9aa3ad', 'rgba(35,39,51,.3)'],
  };

  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (h1, h2, t) => {
    const a = hex(h1), b = hex(h2);
    return `rgb(${Math.round(lerp(a[0], b[0], t))}, ${Math.round(lerp(a[1], b[1], t))}, ${Math.round(lerp(a[2], b[2], t))})`;
  };

  const KEYS = slides.map(s => ({ at: s.start + s.hold / 2, z: ZONES[s.zone] }));
  const root = document.documentElement;

  function paintClock(camU) {
    let i = 0;
    while (i < KEYS.length - 1 && camU > KEYS[i + 1].at) i++;
    const a = KEYS[i], b = KEYS[Math.min(i + 1, KEYS.length - 1)];
    const t = a === b ? 0 : seg(camU, a.at, b.at);

    root.style.setProperty('--skyA', mix(a.z[0], b.z[0], t));
    root.style.setProperty('--skyB', mix(a.z[1], b.z[1], t));
    root.style.setProperty('--starop', lerp(a.z[2], b.z[2], t).toFixed(2));
    root.style.setProperty('--moonop', lerp(a.z[3], b.z[3], t).toFixed(2));
    root.style.setProperty('--sunop', lerp(a.z[4], b.z[4], t).toFixed(2));
    root.style.setProperty('--sunrise', lerp(a.z[5], b.z[5], t).toFixed(3));
    root.style.setProperty('--rangec', mix(a.z[6], b.z[6], t));
    root.style.setProperty('--floorbg', mix(a.z[7], b.z[7], t));
    root.style.setProperty('--floorline', (t < .5 ? a : b).z[8]);
    root.style.setProperty('--scrollf', (camU / TOTAL).toFixed(4));
  }

  /* ---------------------------------------------------------------------------
     Choreography — u sweeps 0..1 across each slide's whole visibility
     ------------------------------------------------------------------------ */

  const set = (el, n, v) => el.style.setProperty(n, v);
  const on  = (el, cls, cond) => el.classList.toggle(cls, cond);

  const CHOREO = {

    r1(el, u) {
      // climb down, push the plunger, and THEN the mountain lets go
      set(el, '--climb', ease(seg(u, .16, .34)).toFixed(3));
      set(el, '--plunge', ease(seg(u, .4, .47)).toFixed(3));

      const boom = seg(u, .48, .52);
      set(el, '--flash', (Math.sin(boom * Math.PI)).toFixed(3));       // spike and gone
      set(el, '--boomr', ease(seg(u, .48, .62)).toFixed(3));
      set(el, '--crack', ease(seg(u, .49, .58)).toFixed(3));
      set(el, '--sep', ease(seg(u, .53, .74)).toFixed(3));
      on(el, 'is-boomed', u > .5 && u < .95);
      on(el, 'is-done', u > .78 && u < .98);
    },

    r2(el, u) {
      // three strikes' worth of damage, then the split
      set(el, '--crk1', ease(seg(u, .22, .38)).toFixed(3));
      set(el, '--crk2', ease(seg(u, .4, .56)).toFixed(3));
      set(el, '--split', ease(seg(u, .58, .78)).toFixed(3));
      on(el, 'is-done', u > .8 && u < .98);
    },

    r3(el, u) {
      // three rocks arc into three trucks; each truck squats as it takes one
      const arcs = [['--f1', .2, .38], ['--f2', .38, .56], ['--f3', .56, .74]];
      arcs.forEach(([name, a, b], i) => {
        const t = seg(u, a, b);
        set(el, name, ease(t).toFixed(3));
        set(el, name + 'a', Math.sin(t * Math.PI).toFixed(3));   // the lob
        set(el, name + 'o', t > 0 && t < 1 ? '1' : '0');
        // the target truck fills the moment its rock lands
        const truck = el.querySelector('.fleet .t' + (i + 1));
        if (truck) truck.style.setProperty('--fill', t >= 1 ? '1' : '0');
      });
      on(el, 'is-done', u > .8 && u < .98);
    },

    r4(el, u) {
      // convoy in → the tip → run over → jack up → rocks back → roll on
      const drive = 1 - ease(seg(u, .04, .2));
      const leave = ease(seg(u, .82, .98));
      set(el, '--conv', (-56 * drive + 64 * leave).toFixed(2));
      set(el, '--roll', (u * 2400).toFixed(0));

      const tilt = ease(seg(u, .26, .34)) * (1 - ease(seg(u, .62, .72)));
      set(el, '--tilt', tilt.toFixed(3));
      set(el, '--bang', (Math.sin(seg(u, .26, .42) * Math.PI)).toFixed(3));

      const spill = ease(seg(u, .28, .38)) * (1 - ease(seg(u, .66, .76)));
      set(el, '--spill', spill.toFixed(3));
      set(el, '--spillo', u > .28 && u < .76 ? '1' : '0');

      set(el, '--fixo', u > .36 && u < .8 ? '1' : '0');
      set(el, '--run', ease(seg(u, .38, .5)).toFixed(3));
      on(el, 'is-running', u > .38 && u < .5);
      set(el, '--jacko', u > .48 && u < .78 ? '1' : '0');
      set(el, '--jack', ease(seg(u, .5, .62)).toFixed(3));

      on(el, 'is-done', u > .8 && u < .98);
    },

    r5(el, u) {
      set(el, '--arr', ease(seg(u, .08, .26)).toFixed(3));
      set(el, '--roll', (u * 1600).toFixed(0));

      // bed up, rocks tumble, the wall grows course by course
      const dump = ease(seg(u, .32, .48)) * (1 - ease(seg(u, .8, .92)));
      // the shared tipper symbol reads --dump from its wrapper
      el.querySelector('.dumper').style.setProperty('--dump', dump.toFixed(3));
      el.querySelector('.dumper').style.setProperty('--fill', (1 - seg(u, .4, .6)).toFixed(2));

      const drop = seg(u, .4, .6);
      set(el, '--drop', ease(drop).toFixed(3));
      set(el, '--dropo', drop > 0 && drop < 1 ? '1' : '0');
      set(el, '--wall', ease(seg(u, .48, .72)).toFixed(3));

      on(el, 'is-done', u > .76 && u < .98);
    },
  };

  /* ---------------------------------------------------------------------------
     The camera
     ------------------------------------------------------------------------ */

  const shift = document.querySelector('.shift');
  const shiftLabel = document.getElementById('shiftLabel');
  const cue = document.getElementById('cue');

  function shiftText(p) {
    // midnight → noon across the scroll
    const mins = Math.round(p * 12 * 60);
    const h = Math.floor(mins / 60), m = mins % 60;
    const label = p < .38 ? 'night shift' : p < .62 ? 'first light' : 'day shift';
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} · ${label}`;
  }

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
      const so = d >= 0 ? clamp(1.05 - d * 0.72, 0, 1) : clamp(1 + d * 1.5, 0, 1);
      set(s.el, '--so', so.toFixed(3));

      CHOREO[s.el.id]?.(s.el, seg(camU, s.start - 0.65, s.start + s.hold + 0.6));
    }

    paintClock(camU);

    const p = camU / TOTAL;
    shift.style.setProperty('--p', p.toFixed(3));
    shiftLabel.textContent = shiftText(p);
    cue.classList.toggle('is-gone', p > 0.04);
  }

  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  }, { passive: true });

  document.getElementById('orderBtn')?.addEventListener('click', e => {
    e.preventDefault();
    scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });

  update();
})();

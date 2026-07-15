/* =============================================================================
   Kunnam Store — the delivery, directed by scroll
   -----------------------------------------------------------------------------
   One camera value (camU, in scene-units) drives everything. Each scene owns a
   window on that timeline plus a zoom script: `from` is the scale it enters
   at, `to` is the scale it leaves at. from < 1 reads as the camera pushing
   forward INTO the world; from > 1 reads as pulling BACK to reveal; to > 1
   flies the scene past the viewer. Inside its window a scene gets --u (0..1)
   and hand-tuned choreography vars. Scrubbing backwards rewinds the story.
   ========================================================================== */

(() => {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp  = (a, b, t) => a + (b - a) * t;
  // smooth ends, linear middle — good default for scrub choreography
  const ease  = t => t * t * (3 - 2 * t);
  // sub-progress: where is u within [a, b]?
  const seg   = (u, a, b) => clamp((u - a) / (b - a), 0, 1);

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ZMODE = !reduce && innerWidth >= 860;
  if (ZMODE) document.documentElement.classList.add('zmode');

  /* ---------------------------------------------------------------------------
     The storyboard. len = scroll-units of screen time; overlap makes each
     handover a cross-zoom instead of a cut. from/to per the shot list:
     push-ins enter small, the doorstep reveal enters HUGE and settles.
     ------------------------------------------------------------------------ */

  const OVERLAP = 0.42;

  const SCENES = [
    { id: 's-order',   len: 2.0, from: 1.0,  to: 2.6 },   // push IN through the screen
    { id: 's-pack',    len: 1.7, from: 0.55, to: 1.5 },   // deeper into the system
    { id: 's-van',     len: 1.5, from: 0.65, to: 1.35 },
    { id: 's-hub',     len: 1.5, from: 0.7,  to: 1.4 },
    { id: 's-courier', len: 1.3, from: 0.7,  to: 3.0 },   // start of the big zoom-in…
    { id: 's-brand',   len: 1.2, from: 0.4,  to: 5.0 },   // …label fills the frame, flies past
    { id: 's-door',    len: 1.6, from: 2.6,  to: 1.6 },   // ZOOM OUT reveal at the door
    { id: 's-unbox',   len: 1.5, from: 0.6,  to: 1.8 },
    { id: 's-play',    len: 1.8, from: 0.55, to: 1 },     // settle and hold
  ];

  const UNIT = 900;          // px of scroll per unit
  const EDGE = 0.16;         // fraction of a window spent entering/leaving

  let acc = 0;
  for (const s of SCENES) {
    s.el = document.getElementById(s.id);
    s.a = acc;
    s.b = acc + s.len;
    acc = s.b - OVERLAP;
  }
  // Runway ends just shy of the last scene's window so its u can reach ~0.94
  // — the closing CTA keys off u > 0.45 and must actually get there. (An
  // earlier cap of b-1 stranded the finale at u 0.44: confetti but no CTA.)
  const TOTAL = SCENES[SCENES.length - 1].b - 0.1;

  /* ---------------------------------------------------------------------------
     Per-scene choreography — hand math from local u to vars/classes.
     Every toggle is state-from-u, never an event, so it rewinds for free.
     ------------------------------------------------------------------------ */

  const $1 = (sel, root) => root.querySelector(sel);

  const CHOREO = {

    's-order'(u, el) {
      const body = $1('.browser__body', el);
      const cart = $1('#btnCart', el);
      const buy  = $1('#btnBuy', el);
      const cur  = $1('.ghostcur', el);
      const n    = $1('#cartN', el);

      // cursor waypoints across the mock, in % of the body box
      const P = [ [62, 78], [56, 62], [56, 62], [67, 71], [67, 71], [55, 84] ];
      const K = [ 0, .22, .3, .5, .58, .8 ];   // times for each waypoint
      let x = P[P.length - 1][0], y = P[P.length - 1][1];
      for (let i = 0; i < K.length - 1; i++) {
        if (u <= K[i + 1]) {
          const t = ease(seg(u, K[i], K[i + 1]));
          x = lerp(P[i][0], P[i + 1][0], t);
          y = lerp(P[i][1], P[i + 1][1], t);
          break;
        }
      }
      const r = body.getBoundingClientRect();
      cur.style.setProperty('--cux', (r.width * x / 100).toFixed(1) + 'px');
      cur.style.setProperty('--cuy', (r.height * y / 100).toFixed(1) + 'px');

      cur.classList.toggle('is-click', (u > .3 && u < .38) || (u > .58 && u < .66));
      cart.classList.toggle('is-pressed', u > .3 && u < .4);
      buy.classList.toggle('is-pressed', u > .58 && u < .68);
      body.classList.toggle('is-carted', u > .32);
      body.classList.toggle('is-bought', u > .62);
      n.textContent = u > .32 ? '1' : '0';
    },

    's-pack'(u, el) {
      el.style.setProperty('--drop',  ease(seg(u, .05, .3)).toFixed(3));
      el.style.setProperty('--flap',  ease(seg(u, .34, .5)).toFixed(3));
      el.style.setProperty('--tape',  ease(seg(u, .5, .64)).toFixed(3));
      // stamp pops: overshoot then settle
      const st = seg(u, .64, .78);
      el.style.setProperty('--stamp', (st === 0 ? 0 : (1 + Math.sin(st * Math.PI) * .35)).toFixed(3));
      el.style.setProperty('--slide', ease(seg(u, .82, 1)).toFixed(3));
    },

    's-van'(u, el, t) {
      // world streams past; the van bobs on its suspension
      el.style.setProperty('--dash', (-u * 1900).toFixed(0) + 'px');
      el.style.setProperty('--mid',  (-u * 700).toFixed(0) + 'px');
      el.style.setProperty('--far',  (-u * 260).toFixed(0) + 'px');
      el.style.setProperty('--wheel', (u * 1600).toFixed(0) + 'deg');
      el.style.setProperty('--bob',  (Math.sin(u * 40) * 3).toFixed(1) + 'px');
      // drives in from the left, exits right
      const inX  = (1 - ease(seg(u, 0, .2))) * -60;
      const outX = ease(seg(u, .84, 1)) * 70;
      el.style.setProperty('--vanx', ((inX + outX) * innerWidth / 100).toFixed(1) + 'px');
    },

    's-hub'(u, el) {
      // our parcel rides the belt through the scanner
      const beltVw = lerp(-40, 46, ease(seg(u, .1, .8)));
      el.style.setProperty('--belt', (beltVw * innerWidth / 100).toFixed(1) + 'px');
      const scanOn = u > .42 && u < .58;
      el.style.setProperty('--scan', scanOn ? '1' : '0');
      $1('.hubworld', el).classList.toggle('is-scanned', u > .5);
    },

    's-courier'(u, el) {
      el.style.setProperty('--bgx', (-u * 900).toFixed(0) + 'px');
      el.style.setProperty('--scootx', `calc(${lerp(-34, 26, ease(u)).toFixed(1)} * 1vw)`);
      el.style.setProperty('--bob', (Math.sin(u * 34) * 2.5).toFixed(1) + 'px');
      el.style.setProperty('--wheel', (u * 1400).toFixed(0) + 'deg');
    },

    's-brand'(u, el) {
      el.style.setProperty('--shine', ease(seg(u, .25, .75)).toFixed(3));
    },

    's-door'(u, el) {
      el.style.setProperty('--door', (ease(seg(u, .18, .48)) * 78).toFixed(1));
      el.style.setProperty('--arms', ease(seg(u, .42, .62)).toFixed(3));

      const hand = ease(seg(u, .5, .8));
      el.style.setProperty('--hand', hand.toFixed(3));

      // The parcel arcs from the courier's outstretched hands to the
      // customer's — endpoints measured off the real porch box, so the
      // handoff stays glued to the figures at any viewport size.
      const porch = $1('.porch', el).getBoundingClientRect();
      const x0 = porch.width * 0.09 + 96;           // courier's hands
      const x1 = porch.width * 0.5 - 92;            // customer's forearms
      // box bottom rides at forearm height (~70px up the 250px figures),
      // with a shallow lob at the midpoint of the pass
      const y  = -70 - Math.sin(hand * Math.PI) * 26;
      el.style.setProperty('--handx', lerp(x0, x1, hand).toFixed(1) + 'px');
      el.style.setProperty('--handy', y.toFixed(1) + 'px');
    },

    's-unbox'(u, el) {
      el.style.setProperty('--flapo', ease(seg(u, .08, .34)).toFixed(3));
      el.style.setProperty('--rise',  ease(seg(u, .36, .68)).toFixed(3));
      el.style.setProperty('--glow',  ease(seg(u, .42, .8)).toFixed(3));
    },

    's-play'(u, el) {
      el.style.setProperty('--pulse', (0.5 + Math.sin(u * 26) * .5).toFixed(3));
      el.style.setProperty('--wiggle', (Math.sin(u * 60) * 8).toFixed(1));
      el.style.setProperty('--confetti', ease(seg(u, .05, .75)).toFixed(3));
      el.style.setProperty('--cta', ease(seg(u, .45, .7)).toFixed(3));
    },
  };

  /* ---------------------------------------------------------------------------
     Tracking strip
     ------------------------------------------------------------------------ */

  const chips = [...document.querySelectorAll('.track li')];
  const chipAt = chips.map(c => parseFloat(c.dataset.at));

  function paintTrack(camU) {
    let now = 0;
    for (let i = 0; i < chips.length; i++) if (camU >= chipAt[i]) now = i;
    chips.forEach((c, i) => {
      c.classList.toggle('is-done', i < now);
      c.classList.toggle('is-now', i === now);
    });
  }

  /* ---------------------------------------------------------------------------
     The camera
     ------------------------------------------------------------------------ */

  if (!ZMODE) {
    // Story panels: everything rests in its finished pose. --u defaults to 1
    // in CSS; run each scene's choreography once at u = 1 so JS-driven vars
    // (cursor, belt, door) land on their end state too.
    for (const s of SCENES) CHOREO[s.id]?.(1, s.el);
    document.querySelector('.browser__body')?.classList.add('is-carted', 'is-bought');
    chips.forEach(c => c.classList.add('is-done'));
    return;
  }

  const spacer = document.getElementById('zspacer');
  const sizeSpacer = () => { spacer.style.height = (TOTAL * UNIT + innerHeight) + 'px'; };
  sizeSpacer();

  function update() {
    const camU = clamp(scrollY / UNIT, 0, TOTAL);

    for (const s of SCENES) {
      const u = seg(camU, s.a, s.b);
      const off = camU < s.a - 0.05 || camU > s.b + 0.05;

      s.el.style.setProperty('--sv', off ? 'hidden' : 'visible');
      if (off) { s.el.classList.remove('is-front'); continue; }

      // camera zoom: enter from s.from, hold at 1, leave toward s.to
      let scale = 1, o = 1;
      if (u < EDGE) {
        const t = ease(u / EDGE);
        scale = lerp(s.from, 1, t);
        o = t;
      } else if (u > 1 - EDGE) {
        const t = ease((u - (1 - EDGE)) / EDGE);
        scale = lerp(1, s.to, t);
        o = 1 - t;
      }
      // the closing scene never leaves
      if (s === SCENES[SCENES.length - 1] && u > 1 - EDGE) { scale = 1; o = 1; }

      s.el.style.setProperty('--u', u.toFixed(4));
      s.el.style.setProperty('--s', scale.toFixed(4));
      s.el.style.setProperty('--o', o.toFixed(3));
      s.el.classList.toggle('is-front', o > 0.5);

      CHOREO[s.id]?.(u, s.el);
    }

    paintTrack(camU);
  }

  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  }, { passive: true });

  addEventListener('resize', () => { sizeSpacer(); update(); });

  // "Order yours" rewinds the whole film to the shop
  document.querySelectorAll('a[href^="#"]').forEach(a => {
    a.addEventListener('click', e => {
      const s = SCENES.find(x => x.id === a.getAttribute('href').slice(1));
      if (!s) return;
      e.preventDefault();
      scrollTo({ top: s.a * UNIT, behavior: 'smooth' });
    });
  });

  update();
})();

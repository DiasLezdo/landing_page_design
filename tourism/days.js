/* =============================================================================
   KUNNAM Days — the story engine
   -----------------------------------------------------------------------------
   Vertical scroll pans a horizontal world. Every [data-scene] gets --u (its
   own pass through the viewport, 0..1) and hand-tuned choreography vars; every
   toggle is computed FROM u each frame, never fired as an event, so scrolling
   backwards rewinds the whole film — the broom flies back into amma's hand.
   ========================================================================== */

(() => {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp  = (a, b, t) => a + (b - a) * t;
  const ease  = t => t * t * (3 - 2 * t);
  const seg   = (u, a, b) => clamp((u - a) / (b - a), 0, 1);

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) document.documentElement.classList.add('rm');

  /* ---------------------------------------------------------------------------
     The cast — provided face art mounted on CSS bodies.
     (character_second's file is spelled "charater" on disk; kept verbatim.)
     ------------------------------------------------------------------------ */

  const FACES = {
    c1: 'images/character_first.png',
    c2: 'images/charater_second.png',
    c3: 'images/character_third.png',
    c4: 'images/character_fourth.png',
    c5: 'images/character_fifth.png',
  };

  const POSE_CLASS = {
    sit:    'pose-sit',
    stand:  '',
    walk:   'is-walking',
    slouch: 'pose-slouch',
    bat:    'pose-bat',
    dance:  'is-dancing',
    relax:  'pose-relax',
    selfie: 'pose-selfie',
  };

  document.querySelectorAll('[data-char]').forEach(slot => {
    const id = slot.dataset.char;
    const el = document.createElement('div');
    el.className = `char char--${id} ${POSE_CLASS[slot.dataset.pose] || ''}`.trim();
    if ('flip' in slot.dataset) el.classList.add('is-flip');
    if ('talk' in slot.dataset) el.classList.add('is-talking');
    el.innerHTML =
      `<img class="char__head" src="${FACES[id]}" alt="">` +
      '<div class="char__torso"></div>' +
      '<div class="char__arm char__arm--l"></div><div class="char__arm char__arm--r"></div>' +
      '<div class="char__leg char__leg--l"></div><div class="char__leg char__leg--r"></div>';
    slot.append(el);
  });

  if (reduce) return;   // vertical storyboard: rigs mounted, loops frozen by CSS

  /* ---------------------------------------------------------------------------
     World geometry
     ------------------------------------------------------------------------ */

  const world = document.getElementById('world');
  const hills = document.getElementById('hills');
  const spacer = document.getElementById('spacer');
  const scenes = [...document.querySelectorAll('[data-scene]')];

  const SPEED = 0.92;   // px of world per px of scroll — slightly slow = weighty

  function vw(n) { return innerWidth * n / 100; }

  let offsets = [], widths = [], totalW = 0;

  function measure() {
    totalW = 0;
    scenes.forEach((s, i) => {
      const w = vw(parseFloat(s.dataset.w));
      s.style.width = w + 'px';
      offsets[i] = totalW;
      widths[i] = w;
      totalW += w;
    });
    spacer.style.height = ((totalW - innerWidth) / SPEED + innerHeight) + 'px';
  }
  measure();

  /* ---------------------------------------------------------------------------
     Per-scene choreography
     ------------------------------------------------------------------------ */

  const set = (el, name, val) => el.style.setProperty(name, val);
  const on  = (el, cls, cond) => el.classList.toggle(cls, cond);

  const CHOREO = {

    s1(u, el) {
      // chatter first, then the newspaper line
      on(el.querySelector('.bubble--s1a'), 'is-on', u > .3 && u < .8);
      on(el.querySelector('.bubble--s1b'), 'is-on', u > .5 && u < .9);
    },

    s2(u, el) {
      const c2 = el.querySelector('.slot--s2c2 .char');
      on(c2, 'is-cheering', u > .38);
      // the jump: two quick hops once he reads it
      set(el.querySelector('.slot--s2c2'), 'translate',
          `0 ${(-Math.abs(Math.sin(seg(u, .38, .75) * Math.PI * 2)) * 2.2).toFixed(2)}em`);
      on(el, 'sparks-on', u > .42);
      on(el.querySelector('.bubble--s2'), 'is-on', u > .45);
    },

    s3(u, el) {
      set(el, '--u', ease(u).toFixed(4));   // walkers translate rides --u
      on(el.querySelector('.bubble--s3'), 'is-on', u > .25 && u < .75);
    },

    s4(u, el) {
      // c3 gets dragged off the sofa, protesting
      set(el, '--out', ease(seg(u, .5, .78)).toFixed(3));
      const c3 = el.querySelector('.slot--s4c3 .char');
      on(c3, 'pose-slouch', u < .55);
      on(c3, 'is-walking', u > .62);

      // amma winds up, then the broom flies a full spinning arc
      set(el, '--wind', ease(seg(u, .55, .68)).toFixed(3));
      const b = ease(seg(u, .68, .95));
      set(el, '--bo', b > 0 ? '1' : '0');
      set(el, '--bx', (b * 26).toFixed(2));
      set(el, '--by', (-Math.sin(b * Math.PI) * 10).toFixed(2));
      set(el, '--br', (b * 720).toFixed(0));

      on(el.querySelector('.bubble--s4a'), 'is-on', u > .22 && u < .55);
      on(el.querySelector('.bubble--s4b'), 'is-on', u > .34 && u < .6);
      on(el.querySelector('.bubble--s4c'), 'is-on', u > .62 && u < .95);
    },

    s5(u, el) {
      on(el.querySelector('.bubble--s5a'), 'is-on', u > .2 && u < .55);

      // the swing, the ball, the SIX
      set(el, '--swing', ease(seg(u, .38, .5)).toFixed(3));
      const b = ease(seg(u, .46, .8));
      set(el, '--ballo', b > 0 && b < 1 ? '1' : '0');
      set(el, '--ballx', (b * 46).toFixed(2));
      set(el, '--bally', (-Math.sin(b * Math.PI) * 24).toFixed(2));
      on(el, 'six-on', u > .52 && u < .9);
      on(el.querySelector('.bubble--s5b'), 'is-on', u > .6 && u < .92);

      const c4 = el.querySelector('.slot--s5c4 .char');
      on(c4, 'pose-bat', u < .62);
      on(c4, 'is-cheering', u > .52 && u < .7);
    },

    s6(u, el) {
      set(el, '--carin', ease(seg(u, .12, .38)).toFixed(3));
      set(el, '--roll', (u * 900).toFixed(0));
      on(el.querySelector('.bubble--s6a'), 'is-on', u > .2 && u < .5);
      on(el.querySelector('.bubble--s6b'), 'is-on', u > .42 && u < .68);

      // c5 tips toward the car, vanishes, and his face pops up inside it
      set(el, '--pull', ease(seg(u, .52, .7)).toFixed(3));
      set(el, '--gone', u > .68 ? '1' : '0');
      set(el, '--carout', ease(seg(u, .74, 1)).toFixed(3));
      on(el, 'dust-on', u > .74);
    },

    s7(u, el) {
      set(el, '--u', ease(u).toFixed(4));     // the car crosses the valley
      set(el, '--roll', (u * 2600).toFixed(0));
      on(el.querySelector('.bubble--s7'), 'is-on', u > .3 && u < .75);
    },

    s8(u, el) {
      set(el, '--cta', ease(seg(u, .35, .6)).toFixed(3));
    },
  };

  /* ---------------------------------------------------------------------------
     The pan
     ------------------------------------------------------------------------ */

  const navCar = document.getElementById('navCar');
  const cue = document.getElementById('cue');
  const maxX = () => totalW - innerWidth;

  function update() {
    const x = clamp(scrollY * SPEED, 0, maxX());

    set(world, '--x', x.toFixed(1));
    set(hills, '--hx', (-x * 0.3).toFixed(1));

    for (let i = 0; i < scenes.length; i++) {
      // a scene's pass: right edge entering → left edge leaving
      const u = clamp((x + innerWidth - offsets[i]) / (widths[i] + innerWidth), 0, 1);
      if (u <= 0 || u >= 1) {
        // still run once at the boundary so states settle, then skip
        if (scenes[i]._settled === (u >= 1)) continue;
        scenes[i]._settled = u >= 1;
      } else {
        scenes[i]._settled = null;
      }
      set(scenes[i], '--u', u.toFixed(4));
      CHOREO[scenes[i].id]?.(u, scenes[i]);
    }

    navCar.style.setProperty('--p', (x / maxX() * 100).toFixed(2) + '%');
    cue.classList.toggle('is-gone', x > innerWidth * 0.3);
  }

  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  }, { passive: true });

  addEventListener('resize', () => { measure(); update(); });

  // Book now → drive to the beach
  document.getElementById('bookBtn').addEventListener('click', e => {
    e.preventDefault();
    scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  });

  update();
})();

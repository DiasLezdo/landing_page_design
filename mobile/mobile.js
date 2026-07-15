/* =============================================================================
   Kunnam Pro Max — scroll engine
   -----------------------------------------------------------------------------
   The rule here: JS measures, CSS animates. Every [data-scene] gets a --p
   custom property from 0 (scene entering the pin) to 1 (leaving it), and the
   stylesheet expresses the actual motion in calc() off that value. Nothing but
   custom properties, transforms and opacity are touched per frame, so none of
   this triggers layout.
   ========================================================================== */

(() => {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------------------------------------------------------------------
     Word splitting for the scroll-lit statement
     ------------------------------------------------------------------------ */

  document.querySelectorAll('[data-reveal-text]').forEach(el => {
    const words = el.textContent.trim().split(/\s+/);
    el.textContent = '';
    words.forEach((w, i) => {
      const span = document.createElement('span');
      span.textContent = w;
      span.style.setProperty('--i', i);
      el.append(span, document.createTextNode(' '));
    });
    el.style.setProperty('--n', words.length);
  });

  /* ---------------------------------------------------------------------------
     Scenes — write --p, let CSS do the rest
     ------------------------------------------------------------------------ */

  const scenes = [...document.querySelectorAll('[data-scene]')];
  const gallery = document.querySelector('.gallery');
  const track = document.getElementById('galleryTrack');
  const batteryScene = document.querySelector('.battery');
  const batteryOut = document.getElementById('batteryHours');
  const BATTERY_MAX = 40;

  // How far the gallery must travel: its own width minus what's on screen.
  // Measured rather than guessed, so the last card lands flush at --p = 1.
  function measure() {
    if (!gallery || !track) return;
    const shift = Math.max(0, track.scrollWidth - window.innerWidth);
    gallery.style.setProperty('--shift', shift);
  }

  let lastHours = -1;

  function update() {
    for (const el of scenes) {
      const rect = el.getBoundingClientRect();
      const total = el.offsetHeight - window.innerHeight;
      // A scene shorter than the viewport has no scrub range; pin it at 0
      // instead of dividing by zero and writing NaN into the stylesheet.
      const p = total > 0 ? clamp(-rect.top / total, 0, 1) : 0;
      el.style.setProperty('--p', p.toFixed(4));
    }

    if (batteryScene && batteryOut) {
      const p = parseFloat(batteryScene.style.getPropertyValue('--p')) || 0;
      const hours = reduce ? BATTERY_MAX : Math.round(p * BATTERY_MAX);
      if (hours !== lastHours) {
        batteryOut.textContent = hours;
        lastHours = hours;
      }
    }
  }

  // Coalesce scroll/resize into one write per frame.
  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { update(); ticking = false; });
  }

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', () => { measure(); onScroll(); });

  /* ---------------------------------------------------------------------------
     Reveal on view
     ------------------------------------------------------------------------ */

  const reveals = document.querySelectorAll('[data-reveal]');

  if (reduce || !('IntersectionObserver' in window)) {
    // No observer, or the user asked for less motion: show everything. Never
    // leave content parked at opacity 0 — that is a blank page, not a page
    // with less animation.
    reveals.forEach(el => el.classList.add('is-visible'));
  } else {
    const io = new IntersectionObserver((entries, obs) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('is-visible');
        obs.unobserve(e.target);          // one-shot; don't re-hide on scroll up
      }
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });

    reveals.forEach(el => io.observe(el));
  }

  /* ---------------------------------------------------------------------------
     Counters
     ------------------------------------------------------------------------ */

  const counters = document.querySelectorAll('[data-count]');

  function runCounter(el) {
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    if (reduce) { el.textContent = target + suffix; return; }

    const DURATION = 1100;
    let t0 = null;
    function step(now) {
      if (t0 === null) t0 = now;
      const k = clamp((now - t0) / DURATION, 0, 1);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (k < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
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
     Colour switcher
     ------------------------------------------------------------------------ */

  const back = document.getElementById('phoneBack');
  const colorName = document.getElementById('colorName');
  const dots = [...document.querySelectorAll('.dot')];

  // Paint each swatch from its own data, so the dot can never drift out of
  // sync with the finish it applies.
  dots.forEach(dot => {
    dot.style.setProperty('--a', dot.dataset.a);
    dot.style.setProperty('--b', dot.dataset.b);

    dot.addEventListener('click', () => {
      dots.forEach(d => {
        d.classList.toggle('is-active', d === dot);
        d.setAttribute('aria-checked', d === dot ? 'true' : 'false');
      });
      if (back) {
        back.style.setProperty('--shell', dot.dataset.a);
        back.style.setProperty('--shell-2', dot.dataset.b);
      }
      if (colorName) colorName.textContent = dot.dataset.name;
    });
  });

  /* ---------------------------------------------------------------------------
     Zoom / focal length switcher
     ------------------------------------------------------------------------ */

  const scene = document.getElementById('zoomScene');
  const badge = document.getElementById('zoomBadge');
  const mmOut = document.getElementById('zoomMm');
  const zoomBtns = [...document.querySelectorAll('.zoom__btn')];

  const LENS = {
    '0.5': 'Fusion Ultra Wide',
    '1':   'Fusion Main',
    '2':   'Fusion Main',
    '5':   'Fusion Telephoto',
    '10':  'Fusion Telephoto',
  };

  zoomBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const z = btn.dataset.z;
      zoomBtns.forEach(b => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-checked', b === btn ? 'true' : 'false');
      });
      // 0.5x has to zoom *out* from the 1x framing, not scale below 1 from
      // nothing — the scene is authored at 1x, so ultra-wide is 0.5 of it.
      if (scene) scene.style.setProperty('--z', z);
      if (badge) badge.textContent = z + 'x';
      if (mmOut) mmOut.textContent = `${btn.dataset.mm} · ${LENS[z] || ''}`;
    });
  });

  /* ---------------------------------------------------------------------------
     Go
     ------------------------------------------------------------------------ */

  measure();
  update();

  // Fonts land late and change the track's width; re-measure or the gallery
  // stops short of its last card.
  if (document.fonts?.ready) document.fonts.ready.then(() => { measure(); update(); });
})();

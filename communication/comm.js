/* =============================================================================
   Kunnam Relay — page behaviour
   -----------------------------------------------------------------------------
   The reference's trick is that its readouts are TRUE — real locale, real
   viewport, real clock. Faking them would be the one thing that breaks the
   spell, so everything on the telemetry rail is read from the live browser.
   ========================================================================== */

(() => {
  'use strict';

  const clamp  = (v, a, b) => (v < a ? a : v > b ? b : v);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = id => document.getElementById(id);

  /* ---------------------------------------------------------------------------
     Reveal — scan wipe
     -----------------------------------------------------------------------------
     Deliberately NOT an IntersectionObserver, and this is not a style choice.
     IO measures an element's *clipped* area, and the hidden state here is
     `clip-path: inset(0 100% 0 0)` — zero width. So the observer reports
     ratio 0 for an element sitting in plain view, never fires, never adds
     .is-in, and the element stays clipped forever: the hidden state prevents
     its own reveal. Plain geometry can't be fooled that way.
     ------------------------------------------------------------------------ */

  const reveals = [...document.querySelectorAll('[data-reveal]')];
  const counters = [...document.querySelectorAll('[data-count]')];

  // Generous line: anything that has entered the viewport at all is in. It has
  // to be reachable — a threshold the last elements on the page can never
  // cross would strand them invisible.
  const isOnScreen = el => {
    const r = el.getBoundingClientRect();
    return r.top < innerHeight * 0.9 && r.bottom > 0;
  };

  function runReveals() {
    for (let i = reveals.length - 1; i >= 0; i--) {
      if (!isOnScreen(reveals[i])) continue;
      reveals[i].classList.add('is-in');
      reveals.splice(i, 1);            // one-shot; drop it from the watch list
    }
  }

  /* ---------------------------------------------------------------------------
     Telemetry — real values only
     ------------------------------------------------------------------------ */

  const pad = n => String(n).padStart(2, '0');

  function stamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
           `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function paintTelemetry() {
    const langs = (navigator.languages || [navigator.language]).slice(0, 2).join(', ');
    $('tLocale').textContent = langs || navigator.language || 'unknown';
    $('tView').textContent   = `${innerWidth}×${innerHeight}px · dpr ${devicePixelRatio || 1}`;
    $('tOnline').textContent = `${navigator.onLine ? 'yes' : 'no'} · touch ${navigator.maxTouchPoints || 0}`;
    $('tClock').textContent  = stamp();
  }

  paintTelemetry();
  addEventListener('resize', paintTelemetry);
  setInterval(() => { $('tClock').textContent = stamp(); }, 1000);

  // Loop counter, purely a heartbeat — but a real one, ticking on a timer
  // rather than a hardcoded "00".
  let loop = 0;
  const loopEl = $('loop');
  setInterval(() => { loop = (loop + 1) % 100; loopEl.textContent = pad(loop); }, 4000);

  // Link state follows the actual connection.
  const dot = $('linkDot'), linkState = $('linkState');
  function paintLink() {
    const up = navigator.onLine;
    dot.classList.toggle('is-down', !up);
    linkState.textContent = up ? 'Link stable' : 'Link lost';
  }
  paintLink();
  addEventListener('online', paintLink);
  addEventListener('offline', paintLink);

  /* ---------------------------------------------------------------------------
     Boot log
     ------------------------------------------------------------------------ */

  const LINES = [
    { t: '[exec] handshake · verifying', tail: '_' },
    { t: '[ ok ] keypair generated · class:ori8' },
    { t: '[ ok ] channel 01 · sealed-sender' },
    { t: '[ ok ] relay route acquired · 38 ms' },
    { t: '[ ok ] link stable', live: true },
  ];

  const log = $('bootLog');

  function typeLine({ t, live }, done) {
    const li = document.createElement('li');
    li.className = 'typing';
    log.append(li);

    if (reduce) {                    // no theatre; just show the line
      li.textContent = t;
      li.classList.remove('typing');
      done();
      return;
    }

    let i = 0;
    (function tick() {
      li.textContent = t.slice(0, ++i);
      if (i < t.length) return setTimeout(tick, 16);
      li.classList.remove('typing');
      if (live) li.innerHTML = li.textContent.replace('[ ok ]', '<b>[ ok ]</b>');
      done();
    })();
  }

  (function runLog(i = 0) {
    if (i >= LINES.length) {
      // Leave the cursor alive on the final line so the page reads as a live
      // terminal rather than a finished screenshot.
      log.lastElementChild?.classList.add('typing');
      return;
    }
    typeLine(LINES[i], () => setTimeout(() => runLog(i + 1), reduce ? 0 : 220));
  })();

  /* ---------------------------------------------------------------------------
     Counters
     ------------------------------------------------------------------------ */

  // Counters share the same geometry check. They sit inside [data-reveal]
  // cells, so an observer would be defeated by the parent's clip just the same.
  function runCounter(el) {
    const target = parseFloat(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const render = v => { el.textContent = v + suffix; };
    if (reduce) { render(target); return; }

    const DUR = 1100;
    let t0 = null;
    (function step(now) {
      if (t0 === null) t0 = now;
      const k = clamp((now - t0) / DUR, 0, 1);
      render(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(step);
    })(performance.now());
  }

  function runCounters() {
    for (let i = counters.length - 1; i >= 0; i--) {
      if (!isOnScreen(counters[i])) continue;
      runCounter(counters[i]);
      counters.splice(i, 1);
    }
  }

  /* ---------------------------------------------------------------------------
     One scroll listener drives both
     ------------------------------------------------------------------------ */

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { runReveals(); runCounters(); ticking = false; });
  }

  if (reduce) {
    reveals.forEach(el => el.classList.add('is-in'));
    counters.forEach(runCounter);
  } else {
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    runReveals();
    runCounters();
  }

  /* ---------------------------------------------------------------------------
     The node — low-poly cluster + orbiting rings
     -----------------------------------------------------------------------------
     A real icosahedron, exploded along its face normals so it reads as a
     cluster of shards, plus two tilted rings of cubes. Everything is projected
     with an honest perspective divide and painted back to front, because a
     flat 2D fake never gets the parallax between the rings and the core right.
     ------------------------------------------------------------------------ */

  const cv = $('node');
  const ctx = cv?.getContext('2d');

  if (ctx) {
    const PHI = (1 + Math.sqrt(5)) / 2;

    // Icosahedron: 12 vertices, 20 faces.
    const RAW = [
      [-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0],
      [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI],
      [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1],
    ].map(v => { const L = Math.hypot(...v); return v.map(c => c / L); });

    const FACES = [
      [0,11,5],[0,5,1],[0,1,7],[0,7,10],[0,10,11],
      [1,5,9],[5,11,4],[11,10,2],[10,7,6],[7,1,8],
      [3,9,4],[3,4,2],[3,2,6],[3,6,8],[3,8,9],
      [4,9,5],[2,4,11],[6,2,10],[8,6,7],[9,8,1],
    ];

    // Push each face out along its own normal — that gap is what turns a
    // solid into a cluster of shards.
    const EXPLODE = 0.42;
    const shards = FACES.map(f => {
      const p = f.map(i => RAW[i]);
      const n = [0, 1, 2].map(k => (p[0][k] + p[1][k] + p[2][k]) / 3);
      const L = Math.hypot(...n);
      const nn = n.map(c => c / L);
      return { pts: p.map(v => v.map((c, k) => c + nn[k] * EXPLODE)), n: nn };
    });

    // Two tilted rings of cubes.
    const rings = [
      { r: 1.95, tilt: 0.42, count: 46, spin: 0.22, size: 0.052 },
      { r: 2.45, tilt: -0.85, count: 54, spin: -0.15, size: 0.044 },
    ];

    let W = 0, H = 0, cx = 0, cy = 0, R = 1;

    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = W / 2; cy = H / 2;
      R = Math.min(W, H) * 0.19;
    }
    resize();
    addEventListener('resize', resize);

    const FOCAL = 5.2;
    const rotY = (p, a) => {
      const c = Math.cos(a), s = Math.sin(a);
      return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
    };
    const rotX = (p, a) => {
      const c = Math.cos(a), s = Math.sin(a);
      return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
    };
    const project = p => {
      const k = FOCAL / (FOCAL + p[2]);
      return [cx + p[0] * R * k, cy + p[1] * R * k, k];
    };

    // Light comes from upper-left, matching the CSS grid's implied top light.
    const LIGHT = (() => { const v = [-0.5, -0.72, -0.48]; const L = Math.hypot(...v); return v.map(c => c / L); })();

    let t0 = performance.now();

    function frame(now) {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);

      const ay = t * 0.16;
      const ax = Math.sin(t * 0.11) * 0.26 + 0.18;

      const items = [];

      // shards
      for (const s of shards) {
        const p3 = s.pts.map(v => rotX(rotY(v, ay), ax));
        const pr = p3.map(project);
        const z = (p3[0][2] + p3[1][2] + p3[2][2]) / 3;
        const n = rotX(rotY(s.n, ay), ax);
        const lit = clamp(n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2], 0, 1);
        items.push({ z, kind: 'shard', pr, lit });
      }

      // ring cubes
      for (const ring of rings) {
        for (let i = 0; i < ring.count; i++) {
          const a = (i / ring.count) * Math.PI * 2 + t * ring.spin;
          let p = [Math.cos(a) * ring.r, 0, Math.sin(a) * ring.r];
          p = rotX(p, ring.tilt);
          p = rotX(rotY(p, ay), ax);
          const pr = project(p);
          items.push({ z: p[2], kind: 'cube', x: pr[0], y: pr[1], k: pr[2], size: ring.size });
        }
      }

      // Painter's algorithm — far first, so near geometry covers it.
      items.sort((a, b) => b.z - a.z);

      for (const it of items) {
        if (it.kind === 'shard') {
          const v = 214 + Math.round(it.lit * 41);            // #d6… → #ff…
          ctx.beginPath();
          ctx.moveTo(it.pr[0][0], it.pr[0][1]);
          ctx.lineTo(it.pr[1][0], it.pr[1][1]);
          ctx.lineTo(it.pr[2][0], it.pr[2][1]);
          ctx.closePath();
          ctx.fillStyle = `rgb(${v}, ${v + 1}, ${v + 3})`;
          ctx.fill();
          ctx.strokeStyle = 'rgba(120,128,136,0.16)';
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          const s = it.size * R * it.k;
          const g = clamp(it.k - 0.55, 0, 1);
          const v = 196 + Math.round(g * 52);
          ctx.fillStyle = `rgb(${v}, ${v + 1}, ${v + 3})`;
          ctx.strokeStyle = 'rgba(120,128,136,0.14)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.rect(it.x - s / 2, it.y - s / 2, s, s);
          ctx.fill();
          ctx.stroke();
        }
      }

      if (!reduce) requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
    // Reduced motion still gets one painted frame — a still object, not a hole.
  }
})();

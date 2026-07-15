/* =============================================================================
   DIAZ — interactive water surface
   -----------------------------------------------------------------------------
   Three GPU passes per frame:

     1. SIM       ping-pong float FBO running the wave equation. Ripples really
                  propagate here and reflect off the viewport edges. Pointer,
                  clicks and ambient drops all inject into this field.
     2. SCENE     procedural caustic background + the DIAZ logotype, drawn into
                  an offscreen RGBA8 texture at full resolution.
     3. COMPOSITE reads the sim's height gradient as a surface normal, refracts
                  the scene texture through it, splits R/G/B for chromatic
                  fringing, and adds specular so the rings are visible.

   Everything worth tuning lives in CONFIG.
   ========================================================================== */

(() => {
  'use strict';

  /* ---------------------------------------------------------------------------
     Tuning
     ------------------------------------------------------------------------ */

  const CONFIG = {
    MAX_DPR: 2,                    // cap device pixel ratio; 2 is plenty

    // -- simulation ----------------------------------------------------------
    // The wave equation assumes a fixed timestep — you cannot scale it by dt
    // without it going unstable — so the sim runs on its own fixed clock and
    // the frame loop just catches it up. Without this, ripples travel 2.4x
    // faster on a 144Hz monitor than on a 60Hz one.
    SIM_LONG_SIDE: 560,            // sim texture, long edge. ↑ = tighter rings
    SIM_HZ: 130,                   // sim ticks per second. ↑ = faster waves
    SIM_MAX_STEPS: 6,              // catch-up clamp; stops death-spiral on lag
    DAMPING: 0.9965,               // per step. 1.0 = never settles

    // -- pointer ("finger dipped in the surface") -----------------------------
    // Unlike a click, this is a *continuous* force, so it is specified per sim
    // tick and pointer speed is measured per second. Both have to be per-unit-
    // time or the wake gets deeper the higher your refresh rate is.
    POINTER_RADIUS: 0.028,         // in aspect-corrected uv
    POINTER_BASE_FORCE: 0.003,     // per tick — the dimple while resting
    POINTER_SPEED_GAIN: 0.014,     // per tick, per uv/second of pointer speed
    POINTER_MAX_FORCE: 0.028,      // per tick
    POINTER_EASE: 0.34,            // smooths jittery mouse deltas

    // -- click ---------------------------------------------------------------
    // Radius sets the wavelength, not just the size: a tight impulse rings at a
    // short wavelength and throws many dense circles, a wide one gives a couple
    // of fat slow swells.
    CLICK_RADIUS: 0.034,
    CLICK_FORCE: 0.80,

    // -- ambient drops (keep the surface alive when nobody touches it) -------
    DROP_INTERVAL: [0.85, 2.1],    // seconds, random in range
    DROP_RADIUS:   [0.05, 0.14],
    DROP_FORCE:    [0.05, 0.15],

    // -- optics --------------------------------------------------------------
    SIM_REFRACT: 0.19,             // how hard sim ripples bend the scene
    AMBIENT_REFRACT: 1.0,          // multiplier on the always-on liquid drift
    MAX_DISPLACE: 0.055,           // clamp, in uv, stops extreme smearing
    CHROMA: 6.5,                   // R/G/B separation, applied to |disp|².
                                   // Quadratic on purpose: linear saturates the
                                   // cap everywhere and fringes every edge
                                   // equally, which reads as 3D-glasses rather
                                   // than refraction. Squared keeps calm water
                                   // clean and only blooms where it's steep.
    CHROMA_MAX: 0.006,             // hard cap, in uv. Uncapped, steep water at
                                   // an impact turns into a rainbow vortex.
    SPECULAR: 0.20,                // keep low; the plate is nearly white already
    SHADING: 0.85,                 // slope -> light/dark banding on the rings
    NORMAL_STRENGTH: 24.0,
    GRAIN: 0.018,

    // -- logotype ------------------------------------------------------------
    WORD: 'DIAZ',
    FONT: `'Archivo Black', 'Arial Black', 'Helvetica Neue', Impact, sans-serif`,
    WORD_FILL: '#141414',
    WORD_WIDTH: 0.66,              // fraction of viewport width
    WORD_MAX_HEIGHT: 0.42,         // fraction of viewport height
  };

  /* ---------------------------------------------------------------------------
     Shaders
     ------------------------------------------------------------------------ */

  const VERT = `#version 300 es
  in vec2 aPos;
  out vec2 vUv;
  void main() {
    vUv = aPos * 0.5 + 0.5;
    gl_Position = vec4(aPos, 0.0, 1.0);
  }`;

  /* -- pass 1: wave equation ------------------------------------------------ */
  const SIM_FRAG = `#version 300 es
  precision highp float;

  in  vec2 vUv;
  out vec4 outColor;

  uniform sampler2D uPrev;      // .r = height(t), .g = height(t-1)
  uniform vec2  uTexel;
  uniform vec2  uAspect;        // (aspect, 1.0) — keeps injected shapes circular
  uniform float uDamping;

  uniform vec2  uPointerA;      // pointer last step
  uniform vec2  uPointerB;      // pointer this step
  uniform float uPointerForce;
  uniform float uPointerRadius;

  uniform vec3  uImpact;        // xy = position, z = force
  uniform float uImpactRadius;

  uniform vec4  uDrop;          // xy = position, z = force, w = radius

  // Distance to the segment A->B. Injecting along the segment (instead of at a
  // point) is what makes a fast drag leave a continuous wake rather than a
  // dotted line of separate splashes.
  float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a;
    vec2 ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
    return length(pa - ba * h);
  }

  void main() {
    vec2 uv = vUv;

    vec4  c     = texture(uPrev, uv);
    float h     = c.r;
    float hPrev = c.g;

    // CLAMP_TO_EDGE sampling gives us reflecting walls for free, so ripples
    // bounce off the edges of the viewport like water in a tray.
    float l = texture(uPrev, vec2(uv.x - uTexel.x, uv.y)).r;
    float r = texture(uPrev, vec2(uv.x + uTexel.x, uv.y)).r;
    float d = texture(uPrev, vec2(uv.x, uv.y - uTexel.y)).r;
    float u = texture(uPrev, vec2(uv.x, uv.y + uTexel.y)).r;

    float nh = (l + r + u + d) * 0.5 - hPrev;
    nh *= uDamping;

    vec2 p = uv * uAspect;

    // finger dip — negative, so the surface is pushed down
    float dp = segDist(p, uPointerA * uAspect, uPointerB * uAspect);
    nh -= uPointerForce * smoothstep(uPointerRadius, 0.0, dp);

    // click
    float di = distance(p, uImpact.xy * uAspect);
    nh -= uImpact.z * smoothstep(uImpactRadius, 0.0, di);

    // ambient drop
    float dd = distance(p, uDrop.xy * uAspect);
    nh -= uDrop.z * smoothstep(uDrop.w, 0.0, dd);

    outColor = vec4(nh, h, 0.0, 1.0);
  }`;

  /* -- pass 2: the artwork -------------------------------------------------- */
  const SCENE_FRAG = `#version 300 es
  precision highp float;

  in  vec2 vUv;
  out vec4 outColor;

  uniform sampler2D uLogo;
  uniform float uAspect;
  uniform float uTime;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      p = m * p;
      a *= 0.5;
    }
    return v;
  }

  // Fine concentric rings, decaying with distance from their source.
  float ripple(vec2 p, vec2 c, float t, float k) {
    float d = length(p - c);
    return sin(d * k - t) * exp(-d * 1.6);
  }

  void main() {
    vec2 uv = vUv;
    vec2 p  = uv * vec2(uAspect, 1.0);
    float t = uTime * 0.06;

    // Domain-warped fbm: soft blotches of light, slowly drifting. Kept
    // deliberately low-contrast — this plate is a calm cream, and every bit of
    // contrast here shows up as smoke rather than water.
    vec2 q = vec2(
      fbm(p * 1.3 + vec2(t, t * 0.7)),
      fbm(p * 1.3 + vec2(5.2 - t * 0.8, 1.3 + t * 0.5))
    );
    float f = fbm(p * 1.8 + q * 0.55 + vec2(-t * 0.5, t * 0.3));

    // Ridged noise reads as thin bright caustic veins. fbm sits near its mean
    // most of the time, so the ridge needs a steep exponent — anything gentle
    // and the "veins" bloom into broad white clouds instead of thin lines.
    float v     = fbm(p * 3.4 + q * 0.9 + vec2(t * 0.4, -t * 0.6));
    float veins = pow(1.0 - abs(v * 2.0 - 1.0), 22.0);

    // Standing ripple texture baked into the plate, the way the reference
    // photograph already has rings in it before anything interacts.
    float tt = uTime * 0.35;
    float rip = ripple(p, vec2(uAspect * 0.62, 0.66), tt,             62.0)
              + ripple(p, vec2(uAspect * 0.30, 0.28), tt * 0.8 + 2.0, 78.0)
              + ripple(p, vec2(uAspect * 0.86, 0.18), tt * 1.1 + 4.0, 54.0);

    vec3 dark = vec3(0.851, 0.841, 0.816);
    vec3 base = vec3(0.910, 0.900, 0.874);
    vec3 lite = vec3(0.957, 0.949, 0.930);

    vec3 col = mix(dark, base, smoothstep(0.25, 0.75, f));
    col = mix(col, lite, veins * 0.18);
    col += rip * 0.010;

    // gentle vignette, warm centre
    float vig = smoothstep(1.35, 0.25, length((uv - 0.5) * vec2(uAspect, 1.0)));
    col *= mix(0.94, 1.015, vig);

    vec4 logo = texture(uLogo, uv);
    col = mix(col, logo.rgb, logo.a);

    outColor = vec4(col, 1.0);
  }`;

  /* -- pass 3: refraction + chromatic aberration + specular ----------------- */
  const COMPOSITE_FRAG = `#version 300 es
  precision highp float;

  in  vec2 vUv;
  out vec4 outColor;

  uniform sampler2D uScene;
  uniform sampler2D uSim;
  uniform vec2  uSimTexel;
  uniform float uAspect;
  uniform float uTime;

  uniform float uSimRefract;
  uniform float uAmbient;
  uniform float uMaxDisplace;
  uniform float uChroma;
  uniform float uChromaMax;
  uniform float uSpecular;
  uniform float uShading;
  uniform float uNormalStrength;
  uniform float uGrain;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // Deliberately NOT a textbook fbm. The usual 0.5 gain halves amplitude every
  // octave, so by the time you reach the frequencies that are fine enough to
  // swing across a single letter stroke, they carry almost no amplitude and the
  // glyph just slides around intact. A flat gain keeps real energy in the high
  // octaves, and once amplitude exceeds the local wavelength the field folds —
  // which is what tears the letters into chunks instead of melting them.
  float turbulence(vec2 p) {
    float v = 0.0;
    float a = 1.0;
    float norm = 0.0;
    mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 4; i++) {
      v += a * vnoise(p);
      norm += a;
      p = m * p;
      a *= 0.78;
    }
    return v / norm;
  }

  // The liquid is never still: a slow rolling swell plus finer turbulence,
  // both drifting forever. This is what keeps chewing the logotype apart even
  // when the pointer is nowhere near it.
  vec2 ambientFlow(vec2 uv) {
    vec2 p = uv * vec2(uAspect, 1.0);
    float t = uTime;

    // large, slow swell
    vec2 swell = vec2(
      sin(p.y * 3.1 + t * 0.42) + sin(p.x * 2.2 - t * 0.31),
      cos(p.x * 2.7 - t * 0.37) + sin(p.y * 1.9 + t * 0.29)
    ) * 0.5;

    vec2 turb = vec2(
      turbulence(p * 5.0 + vec2(t * 0.11, -t * 0.08)),
      turbulence(p * 5.0 + vec2(9.7 - t * 0.09, 4.1 + t * 0.13))
    ) - 0.5;

    return swell * 0.014 + turb * 0.075;
  }

  void main() {
    vec2 uv = vUv;

    // Central difference on the height field -> surface slope.
    float hL = texture(uSim, uv - vec2(uSimTexel.x, 0.0)).r;
    float hR = texture(uSim, uv + vec2(uSimTexel.x, 0.0)).r;
    float hD = texture(uSim, uv - vec2(0.0, uSimTexel.y)).r;
    float hU = texture(uSim, uv + vec2(0.0, uSimTexel.y)).r;
    vec2  grad = vec2(hR - hL, hU - hD);

    vec2 amb  = ambientFlow(uv);
    vec2 disp = grad * uSimRefract + amb * uAmbient;
    disp = clamp(disp, -uMaxDisplace, uMaxDisplace);

    // Light off the *real* wave field, not the ambient turbulence. The ambient
    // field is a refraction cheat with no physical surface behind it — let it
    // drive the specular and the whole plate lights up in noise-shaped clouds.
    vec2 nDisp = grad * uSimRefract + amb * uAmbient * 0.16;
    vec3 n = normalize(vec3(-nDisp * uNormalStrength, 1.0));

    // Wavelength-dependent refraction: each channel bends by a slightly
    // different amount, which is exactly the red/cyan fringing on the letters.
    // Expressed as a capped absolute offset rather than a fraction of disp —
    // as a fraction it grows without bound exactly where disp is already
    // largest, and the steep water at an impact turns into a rainbow vortex.
    float dl = length(disp);
    vec2 caOff = (disp / max(dl, 1e-6)) * min(dl * dl * uChroma, uChromaMax);

    vec3 col;
    col.r = texture(uScene, uv + disp - caOff).r;
    col.g = texture(uScene, uv + disp).g;
    col.b = texture(uScene, uv + disp + caOff).b;

    // Specular picks out the ripple crests. Restrained on purpose: the plate is
    // already near-white, so anything generous blows straight out.
    vec3 L = normalize(vec3(-0.35, 0.55, 0.76));
    vec3 V = vec3(0.0, 0.0, 1.0);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(n, H), 0.0), 110.0) * uSpecular;
    col += vec3(spec) * vec3(1.0, 0.99, 0.96);

    // Directional shading from the slope — this, more than the specular, is
    // what makes the concentric rings readable on a flat background.
    col *= 1.0 + (grad.x * 0.6 + grad.y * 0.9) * uShading;

    // film grain keeps it photographic rather than plasticky
    float g = hash21(uv * 1024.0 + fract(uTime) * 91.7) - 0.5;
    col += g * uGrain;

    outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }`;

  /* ---------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */

  const canvas   = document.getElementById('water');
  const fallback = document.getElementById('fallback');

  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });

  if (!gl) return bail();

  // WebGL2 can always *sample* float textures, but rendering into one needs an
  // extension. Prefer full float: the wave equation subtracts two nearly equal
  // numbers, and half float can show banding in the smooth swells.
  let simInternal, simType;
  if (gl.getExtension('EXT_color_buffer_float')) {
    simInternal = gl.RGBA32F; simType = gl.FLOAT;
  } else if (gl.getExtension('EXT_color_buffer_half_float')) {
    simInternal = gl.RGBA16F; simType = gl.HALF_FLOAT;
  } else {
    return bail();
  }

  function bail() {
    canvas.remove();
    if (fallback) fallback.hidden = false;
  }

  /* ---------------------------------------------------------------------------
     GL helpers
     ------------------------------------------------------------------------ */

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src.replace(/^\s+/, ''));   // #version must be line 1
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    }
    return s;
  }

  function program(fragSrc) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragSrc));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p));
    }
    // Cache uniform locations up front so the frame loop stays allocation-free.
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) {
      const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }

  function texture(w, h, internal, format, type, filter) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function target(w, h, internal, format, type, filter) {
    const tex = texture(w, h, internal, format, type, filter);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbo, w, h };
  }

  function bindTarget(t) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null);
    if (t) gl.viewport(0, 0, t.w, t.h);
    else   gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function use(prog, tex0, tex1) {
    gl.useProgram(prog.p);
    if (tex0 !== undefined) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex0); }
    if (tex1 !== undefined) { gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex1); }
  }

  const draw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);

  /* ---------------------------------------------------------------------------
     Geometry — one oversized triangle covering the viewport
     ------------------------------------------------------------------------ */

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  let simProg, sceneProg, compProg;
  try {
    simProg   = program(SIM_FRAG);
    sceneProg = program(SCENE_FRAG);
    compProg  = program(COMPOSITE_FRAG);
  } catch (err) {
    console.error(err);
    return bail();
  }

  /* ---------------------------------------------------------------------------
     Logotype -> texture
     ------------------------------------------------------------------------ */

  const logoCanvas = document.createElement('canvas');
  const logoCtx    = logoCanvas.getContext('2d');
  const logoTex    = gl.createTexture();

  gl.bindTexture(gl.TEXTURE_2D, logoTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  function drawLogo(w, h) {
    logoCanvas.width  = w;
    logoCanvas.height = h;

    const ctx = logoCtx;
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle    = CONFIG.WORD_FILL;
    try { ctx.letterSpacing = '0.015em'; } catch (_) { /* older browsers */ }

    // Measure at a reference size, then solve for the size that hits our target
    // width. Survives whichever font actually loaded.
    const REF = 100;
    ctx.font = `400 ${REF}px ${CONFIG.FONT}`;
    const m = ctx.measureText(CONFIG.WORD);
    const byWidth  = (w * CONFIG.WORD_WIDTH) / Math.max(m.width, 1);
    const ascent   = m.actualBoundingBoxAscent  || REF * 0.72;
    const descent  = m.actualBoundingBoxDescent || REF * 0.05;
    const byHeight = (h * CONFIG.WORD_MAX_HEIGHT) / Math.max(ascent + descent, 1);
    const size     = REF * Math.min(byWidth, byHeight);

    ctx.font = `400 ${size}px ${CONFIG.FONT}`;

    // Centre on the glyphs' optical box, not the font's line box.
    const m2 = ctx.measureText(CONFIG.WORD);
    const a2 = m2.actualBoundingBoxAscent  || size * 0.72;
    const d2 = m2.actualBoundingBoxDescent || size * 0.05;
    ctx.fillText(CONFIG.WORD, w / 2, h / 2 + (a2 - d2) / 2);

    gl.bindTexture(gl.TEXTURE_2D, logoTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);   // canvas is y-down, GL is y-up
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, logoCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  /* ---------------------------------------------------------------------------
     Sizing
     ------------------------------------------------------------------------ */

  let sim = [null, null];
  let scene = null;
  let aspect = 1;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, CONFIG.MAX_DPR);
    const w = Math.max(1, Math.round(canvas.clientWidth  * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (w === canvas.width && h === canvas.height && scene) return;

    canvas.width  = w;
    canvas.height = h;
    aspect = w / h;

    // Match the sim texture's aspect to the screen's, so a step of one texel is
    // the same on-screen distance in x and y — otherwise ripples go elliptical.
    const long = CONFIG.SIM_LONG_SIDE;
    const sw = aspect >= 1 ? long : Math.round(long * aspect);
    const sh = aspect >= 1 ? Math.round(long / aspect) : long;

    sim.forEach(t => t && (gl.deleteTexture(t.tex), gl.deleteFramebuffer(t.fbo)));
    scene && (gl.deleteTexture(scene.tex), gl.deleteFramebuffer(scene.fbo));

    // NEAREST on the sim: we want exact texel neighbours, not blended ones.
    sim = [
      target(sw, sh, simInternal, gl.RGBA, simType, gl.NEAREST),
      target(sw, sh, simInternal, gl.RGBA, simType, gl.NEAREST),
    ];
    scene = target(w, h, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);

    // Clear both sim buffers to a flat surface.
    for (const t of sim) {
      bindTarget(t);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    bindTarget(null);

    drawLogo(w, h);
  }

  /* ---------------------------------------------------------------------------
     Input
     ------------------------------------------------------------------------ */

  // uv space, y-up, to match vUv and the sim.
  const pointer = {
    x: 0.5, y: 0.5,       // eased position, this frame
    px: 0.5, py: 0.5,     // eased position, last frame
    tx: 0.5, ty: 0.5,     // raw target from the last event
    inside: false,
    down: false,
    seeded: false,
  };

  let impact = { x: 0.5, y: 0.5, force: 0, radius: CONFIG.CLICK_RADIUS };

  function toUv(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) / r.width,
      y: 1 - (e.clientY - r.top) / r.height,
    };
  }

  canvas.addEventListener('pointermove', e => {
    const p = toUv(e);
    pointer.tx = p.x;
    pointer.ty = p.y;
    pointer.inside = true;
    // First sighting: teleport rather than easing in from wherever we were,
    // otherwise the cursor drags a wake across the page on entry.
    if (!pointer.seeded) {
      pointer.x = pointer.px = p.x;
      pointer.y = pointer.py = p.y;
      pointer.seeded = true;
    }
  }, { passive: true });

  canvas.addEventListener('pointerdown', e => {
    const p = toUv(e);
    pointer.tx = p.x; pointer.ty = p.y;
    pointer.inside = true;
    pointer.down = true;
    if (!pointer.seeded) {
      pointer.x = pointer.px = p.x;
      pointer.y = pointer.py = p.y;
      pointer.seeded = true;
    }
    impact = { x: p.x, y: p.y, force: CONFIG.CLICK_FORCE, radius: CONFIG.CLICK_RADIUS };
    canvas.setPointerCapture?.(e.pointerId);
  });

  const release = () => { pointer.down = false; };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  canvas.addEventListener('pointerleave', () => {
    pointer.inside = false;
    pointer.down = false;
    pointer.seeded = false;
  });

  // Clicking the nav should still ripple the water underneath it.
  document.querySelectorAll('.bar a, .mark').forEach(el => {
    el.addEventListener('pointerdown', e => {
      const p = toUv(e);
      impact = { x: p.x, y: p.y, force: CONFIG.CLICK_FORCE * 0.7, radius: CONFIG.CLICK_RADIUS };
    });

    // Swallow the click only for placeholder links, so a bare "#" doesn't
    // jump the page. Real hrefs must navigate — blanket-preventing every
    // click here silently breaks each section link as it gets wired up.
    el.addEventListener('click', e => {
      const href = el.getAttribute('href');
      if (!href || href === '#') e.preventDefault();
    });
  });

  /* ---------------------------------------------------------------------------
     Ambient drops
     ------------------------------------------------------------------------ */

  const rand  = (a, b) => a + Math.random() * (b - a);
  const drop  = { x: 0, y: 0, force: 0, radius: 0.1 };
  let nextDrop = 0.4;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Note: this never clears drop.force — the sim loop does that once a tick has
  // actually consumed the drop, so drops can't be lost on a zero-tick frame.
  function updateDrops(t) {
    if (reduceMotion) return;
    if (t < nextDrop) return;
    nextDrop = t + rand(...CONFIG.DROP_INTERVAL);
    drop.x = rand(0.05, 0.95);
    drop.y = rand(0.05, 0.95);
    drop.radius = rand(...CONFIG.DROP_RADIUS);
    drop.force  = rand(...CONFIG.DROP_FORCE);
  }

  /* ---------------------------------------------------------------------------
     Frame
     ------------------------------------------------------------------------ */

  let start = performance.now();
  let prevNow = start;
  let simIndex = 0;
  let accumulator = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    resize();

    const t = (now - start) / 1000;
    // Clamp dt: after a tab is backgrounded, `now` jumps by minutes and we'd
    // otherwise try to catch up thousands of ticks in one frame.
    const dt = Math.min((now - prevNow) / 1000, 0.25);
    prevNow = now;

    updateDrops(t);

    // Ease the pointer, then measure how far it moved this frame. Force scales
    // with speed: resting finger = small dimple, dragged finger = real wake.
    pointer.px = pointer.x;
    pointer.py = pointer.y;
    if (pointer.inside) {
      pointer.x += (pointer.tx - pointer.x) * CONFIG.POINTER_EASE;
      pointer.y += (pointer.ty - pointer.y) * CONFIG.POINTER_EASE;
    }

    // Speed per *second*, not per frame — a per-frame delta silently means
    // "how fast is your monitor" as much as "how fast is your hand".
    const speed = Math.hypot(
      (pointer.x - pointer.px) * aspect,
      pointer.y - pointer.py
    ) / Math.max(dt, 1e-4);

    let pForce = 0;
    if (pointer.inside) {
      pForce = Math.min(
        CONFIG.POINTER_BASE_FORCE + speed * CONFIG.POINTER_SPEED_GAIN,
        CONFIG.POINTER_MAX_FORCE
      );
      if (pointer.down) pForce *= 1.8;
    }

    /* -- pass 1: simulate -------------------------------------------------- */
    accumulator += dt;
    let steps = Math.floor(accumulator * CONFIG.SIM_HZ);
    if (steps > CONFIG.SIM_MAX_STEPS) steps = CONFIG.SIM_MAX_STEPS;
    accumulator -= steps / CONFIG.SIM_HZ;
    if (accumulator < 0) accumulator = 0;

    gl.bindVertexArray(vao);
    for (let i = 0; i < steps; i++) {
      const src = sim[simIndex];
      const dst = sim[1 - simIndex];

      bindTarget(dst);
      use(simProg, src.tex);
      const u = simProg.u;
      gl.uniform1i(u.uPrev, 0);
      gl.uniform2f(u.uTexel, 1 / src.w, 1 / src.h);
      gl.uniform2f(u.uAspect, aspect, 1);
      gl.uniform1f(u.uDamping, CONFIG.DAMPING);

      gl.uniform2f(u.uPointerA, pointer.px, pointer.py);
      gl.uniform2f(u.uPointerB, pointer.x,  pointer.y);
      // No division by `steps`: this is a rate, applied on every tick, so the
      // energy the finger puts in per second stays fixed no matter how many
      // ticks this particular frame happened to run.
      gl.uniform1f(u.uPointerForce, pForce);
      gl.uniform1f(u.uPointerRadius, CONFIG.POINTER_RADIUS);

      // One-shot impulses fire on one substep only, so a frame that happens to
      // run several catch-up ticks doesn't multiply their strength.
      const first = i === 0;
      gl.uniform3f(u.uImpact, impact.x, impact.y, first ? impact.force : 0);
      gl.uniform1f(u.uImpactRadius, impact.radius);
      gl.uniform4f(u.uDrop, drop.x, drop.y, first ? drop.force : 0, drop.radius);

      draw();
      simIndex = 1 - simIndex;
    }

    // Only clear the pending impulses once a tick has actually consumed them —
    // a frame can legitimately run zero ticks, and a click landing on one of
    // those frames must not be silently swallowed.
    if (steps > 0) {
      impact.force = 0;
      drop.force = 0;
    }

    /* -- pass 2: artwork --------------------------------------------------- */
    bindTarget(scene);
    use(sceneProg, logoTex);
    gl.uniform1i(sceneProg.u.uLogo, 0);
    gl.uniform1f(sceneProg.u.uAspect, aspect);
    gl.uniform1f(sceneProg.u.uTime, t);
    draw();

    /* -- pass 3: refract through the surface ------------------------------- */
    const cur = sim[simIndex];
    bindTarget(null);
    use(compProg, scene.tex, cur.tex);
    const c = compProg.u;
    gl.uniform1i(c.uScene, 0);
    gl.uniform1i(c.uSim, 1);
    gl.uniform2f(c.uSimTexel, 1 / cur.w, 1 / cur.h);
    gl.uniform1f(c.uAspect, aspect);
    gl.uniform1f(c.uTime, t);
    gl.uniform1f(c.uSimRefract, CONFIG.SIM_REFRACT);
    gl.uniform1f(c.uAmbient, reduceMotion ? 0.25 : CONFIG.AMBIENT_REFRACT);
    gl.uniform1f(c.uMaxDisplace, CONFIG.MAX_DISPLACE);
    gl.uniform1f(c.uChroma, CONFIG.CHROMA);
    gl.uniform1f(c.uChromaMax, CONFIG.CHROMA_MAX);
    gl.uniform1f(c.uSpecular, CONFIG.SPECULAR);
    gl.uniform1f(c.uShading, CONFIG.SHADING);
    gl.uniform1f(c.uNormalStrength, CONFIG.NORMAL_STRENGTH);
    gl.uniform1f(c.uGrain, CONFIG.GRAIN);
    draw();
  }

  /* ---------------------------------------------------------------------------
     Go
     ------------------------------------------------------------------------ */

  async function boot() {
    // Canvas text is drawn immediately with whatever font is resolved *now*, so
    // wait for the webfont or the logotype bakes in the fallback face.
    try {
      await document.fonts.load(`400 100px 'Archivo Black'`);
      await document.fonts.ready;
    } catch (_) { /* offline: the fallback stack is fine */ }

    resize();
    window.addEventListener('resize', resize);

    // A wide, soft swell on load so the page is already breathing before anyone
    // touches it. Wide on purpose — a tight one reads as a glass bubble.
    impact = { x: 0.5, y: 0.5, force: 0.32, radius: 0.42 };

    start = prevNow = performance.now();
    requestAnimationFrame(frame);
  }

  boot();
})();

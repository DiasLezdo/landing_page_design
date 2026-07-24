/* =============================================================================
   Yanai — one uncle, fully rigged
   -----------------------------------------------------------------------------
   The SVG is the whole show. This file gives him life:
   - his pupils track the cursor (clamped — he glares, he doesn't roll)
   - the section under the viewport's midline sets his mood class
   - clicks are routed by body part: mustache preens, eyes wink, ears earn an
     eye-roll, the nose is a mistake, the belly jiggles, the legs stomp,
     anywhere else demonstrates the sip
   - ignore him long enough and the foot starts tapping
   Everything degrades: no JS = a fine standing portrait, reduced motion =
   moods still switch but nothing loops.
   ========================================================================== */

(() => {
  'use strict';

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(pointer: fine)').matches;

  const rig = document.getElementById('rig');
  const moodChip = document.getElementById('moodChip');
  const quote = document.getElementById('quote');
  const cue = document.getElementById('cue');

  /* ---------------------------------------------------------------------------
     Moods from scroll — the section past the viewport midline owns him
     ------------------------------------------------------------------------ */

  const MOODS = ['m-grumpy', 'm-squint', 'm-tea', 'm-groom', 'm-verdict', 'm-smile'];
  const sections = [...document.querySelectorAll('[data-mood]')];
  let currentMood = '';

  function setMood(mood, chip) {
    if (mood === currentMood) return;
    currentMood = mood;
    rig.classList.remove(...MOODS);
    rig.classList.add('m-' + mood);
    moodChip.textContent = chip;

    // the historic mouth event: smile mood swaps the mouth path
    const want = mood === 'smile' ? 'mouth--smile' : mood === 'verdict' ? 'mouth--flat' : 'mouth--frown';
    document.querySelectorAll('.mouth').forEach(m =>
      m.classList.toggle('is-on', m.classList.contains(want)));
  }

  function updateMood() {
    let active = sections[0];
    for (const s of sections) {
      if (s.getBoundingClientRect().top < innerHeight * 0.55) active = s;
    }
    setMood(active.dataset.mood, active.dataset.chip);
    cue.classList.toggle('is-gone', scrollY > innerHeight * 0.5);
  }

  let ticking = false;
  addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { updateMood(); ticking = false; });
  }, { passive: true });

  updateMood();

  /* ---------------------------------------------------------------------------
     The stare — pupils track the cursor
     ------------------------------------------------------------------------ */

  if (finePointer && !reduce) {
    const pupils = [...rig.querySelectorAll('.pupil')];

    addEventListener('pointermove', e => {
      // he won't bother while drinking or with his eyes shut
      if (rig.classList.contains('is-sipping')) return;

      const r = rig.getBoundingClientRect();
      // face centre, roughly — upper third of the rig
      const fx = r.left + r.width * 0.5;
      const fy = r.top + r.height * 0.28;
      const dx = clamp((e.clientX - fx) / (r.width * 0.5), -1, 1);
      const dy = clamp((e.clientY - fy) / (r.height * 0.5), -1, 1);

      for (const p of pupils) {
        p.style.setProperty('--px', (dx * 7).toFixed(1));
        p.style.setProperty('--py', (dy * 5).toFixed(1));
      }
    }, { passive: true });
  }

  /* ---------------------------------------------------------------------------
     Speech — one bubble, short fuse
     ------------------------------------------------------------------------ */

  let sayT = 0;
  function say(text, hold = 1500) {
    quote.textContent = text;
    quote.classList.add('is-on');
    clearTimeout(sayT);
    sayT = setTimeout(() => quote.classList.remove('is-on'), hold);
  }

  // one-shot action classes; busy-flag stops overlapping poses
  let busy = false;
  function flash(cls, dur, line) {
    if (busy) return;
    busy = true;
    rig.classList.add(cls);
    if (line) say(line, dur + 500);
    setTimeout(() => { rig.classList.remove(cls); busy = false; }, dur);
  }

  /* ---------------------------------------------------------------------------
     The sip — the flagship demonstration
     ------------------------------------------------------------------------ */

  const VERDICTS = [
    '…hmph.',
    'Tea first. Talk later.',
    'No discount.',
    'Sit properly.',
    'Fine. ONE more cup.',
    'I was grumpy before it was a brand.',
  ];
  let verdictIx = 0;
  let sipping = false;

  function sip() {
    if (sipping || busy) return;
    sipping = true;

    rig.classList.add('is-sipping');
    setTimeout(() => {
      rig.classList.remove('is-sipping');

      say(VERDICTS[verdictIx % VERDICTS.length], 1600);
      verdictIx++;
      setTimeout(() => { sipping = false; }, 1600);
    }, reduce ? 60 : 1100);
  }

  /* ---------------------------------------------------------------------------
     Click routing — every part of him has an opinion
     ------------------------------------------------------------------------ */

  rig.addEventListener('click', e => {
    const hit = sel => !!(e.target.closest && e.target.closest(sel));

    // interrupting the sip is a mistake
    if (sipping) {
      if (!busy) { rig.classList.add('is-annoyed'); say('One. Cup. At a time.', 1200); setTimeout(() => rig.classList.remove('is-annoyed'), 700); }
      return;
    }

    if (hit('#g-stache')) return flash('is-preen', 1000, 'Respect the mustache.');
    if (hit('#g-eyeL') || hit('#g-eyeR')) return flash('is-wink', 900, '…that never happened.');
    if (hit('#g-nose')) return flash('is-fuming', 1000, 'ENOUGH.');
    if (hit('.ear')) return flash('is-eyeroll', 950);
    if (hit('#g-body')) return flash('is-jiggle', 750, 'Tea storage.');
    if (hit('#g-legs')) return flash('is-stomp', 600, 'Out of my shop.');
    sip(); // dome, cup, arm, anywhere else: the demonstration
  });

  /* ---------------------------------------------------------------------------
     Ignore him for 9 seconds and the foot starts
     ------------------------------------------------------------------------ */

  let idleT = 0;
  function armIdle() {
    rig.classList.remove('is-waiting');
    clearTimeout(idleT);
    idleT = setTimeout(() => rig.classList.add('is-waiting'), 9000);
  }
  ['scroll', 'pointermove', 'pointerdown', 'keydown', 'touchstart'].forEach(ev =>
    addEventListener(ev, armIdle, { passive: true }));
  armIdle();

  // nav tea button rides down to the visit section
  document.getElementById('teaBtn')?.addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('visit').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  });
})();

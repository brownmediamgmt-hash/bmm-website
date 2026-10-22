/* Brown Media Management — motion layer v5
   1) Intro: film-leader countdown, letterbox bars open (once per session)
   2) Smooth inertial scroll (Lenis) + eased anchor glides
   3) Typewriter: headings type themselves in when scrolled into view
   4) Hero parallax, live REC timecode, playhead progress line
   5) Cursor ring (PLAY over work), magnetic buttons, staggered reveals
   6) Mobile sticky CTA */
(function () {
  'use strict';
  // animations always on (owner preference); OS reduce-motion is logged but not applied
  const osReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  console.log('[BMM effects v5] loaded — intro, lenis, typewriter, parallax, cursor' + (osReduced ? ' (OS reduce-motion on)' : ''));
  const safe = fn => { try { fn(); } catch (e) { console.warn('[BMM effects]', e); } };
  const NAV_OFFSET = 72;
  let lenis = null;

  /* ============ 1. SMOOTH SCROLL ============ */
  safe(function smoothScroll() {
    if (typeof window.Lenis !== 'function') return; // CDN failed → native scroll, nothing breaks
    lenis = new window.Lenis({
      duration: 1.25,
      easing: t => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      wheelMultiplier: 0.9
    });
    window.bmmLenis = lenis;
    (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(performance.now());
  });

  /* ============ 2. INTRO ============ */
  const introDone = new Promise(resolve => {
    safe(function intro() {
      const el = document.getElementById('intro');
      if (!el) return resolve();
      let seen = false;
      try { seen = sessionStorage.getItem('bmm_intro') === '1'; } catch (e) {}
      if (seen) { el.classList.add('gone'); return resolve(); }
      try { sessionStorage.setItem('bmm_intro', '1'); } catch (e) {}

      if (lenis) lenis.stop();
      window.scrollTo(0, 0);
      const num = el.querySelector('.num'), sweep = el.querySelector('.sweep');
      const STEP = 520, COUNT = 3;
      let t0 = null, finished = false;

      function finish() {
        if (finished) return; finished = true;
        el.classList.add('open');
        el.style.pointerEvents = 'none';
        setTimeout(() => { el.classList.add('gone'); }, 1050);
        setTimeout(() => { if (lenis) lenis.start(); resolve(); }, 380);
      }
      (function tick(t) {
        if (finished) return;
        if (t0 === null) t0 = t;
        const e = t - t0, i = Math.floor(e / STEP);
        if (i >= COUNT) return finish();
        num.textContent = String(COUNT - i);
        sweep.style.setProperty('--a', ((e % STEP) / STEP * 360).toFixed(1) + 'deg');
        requestAnimationFrame(tick);
      })(performance.now());
      el.addEventListener('click', finish);
      setTimeout(finish, 3000); // safety net
    });
  });

  /* ============ 3. TYPEWRITER ON SCROLL ============ */
  safe(function typewriter() {
    const targets = document.querySelectorAll('.hero h1, section h2, .tc');
    if (!targets.length) return;

    function typeIn(el, duration) {
      // collect text nodes so HTML structure (amber spans, live timecode) is preserved
      const nodes = [];
      (function walk(n) {
        n.childNodes.forEach(c => {
          if (c.nodeType === 3) nodes.push({ node: c, text: c.nodeValue });
          else if (!(c.classList && c.classList.contains('live'))) walk(c);
        });
      })(el);
      const total = nodes.reduce((s, n) => s + n.text.length, 0);
      if (!total) { el.style.visibility = 'visible'; return; }

      el.style.minHeight = el.offsetHeight + 'px'; // no layout jump
      nodes.forEach(n => { n.node.nodeValue = ''; });
      el.style.visibility = 'visible';

      let start = null;
      function tick(t) {
        if (start === null) start = t;
        const k = Math.min((t - start) / duration, 1);
        let chars = Math.round(total * k);
        for (const n of nodes) {
          const take = Math.min(chars, n.text.length);
          n.node.nodeValue = n.text.slice(0, take);
          chars -= take;
        }
        if (k < 1) requestAnimationFrame(tick);
        else el.style.minHeight = '';
      }
      requestAnimationFrame(tick);
    }

    targets.forEach(el => { el.style.visibility = 'hidden'; });

    introDone.then(() => {
      const io = new IntersectionObserver(entries => {
        entries.forEach(e => {
          if (!e.isIntersecting) return;
          io.unobserve(e.target);
          const isH1 = e.target.matches('h1');
          const isTc = e.target.classList.contains('tc');
          typeIn(e.target, isH1 ? 900 : isTc ? 450 : 600);
        });
      }, { threshold: 0.3 });
      targets.forEach(el => io.observe(el));
    });
  });

  /* ============ 4. ANCHOR GLIDE ============ */
  safe(function smoothAnchors() {
    const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
    document.addEventListener('click', e => {
      const a = e.target.closest('a[href^="#"]');
      if (!a) return;
      const id = a.getAttribute('href');
      if (id.length < 2) return;
      const target = document.querySelector(id);
      if (!target) return;
      e.preventDefault();
      history.pushState(null, '', id);
      if (lenis) {
        lenis.scrollTo(target, { offset: -NAV_OFFSET, duration: 1.6, easing: ease });
        return;
      }
      const yTo = target.getBoundingClientRect().top + window.scrollY - NAV_OFFSET;
      const yFrom = window.scrollY, dist = yTo - yFrom;
      const dur = Math.min(1100, 450 + Math.abs(dist) * 0.2);
      const t0 = performance.now();
      (function step(t) {
        const k = Math.min((t - t0) / dur, 1);
        window.scrollTo(0, yFrom + dist * ease(k));
        if (k < 1) requestAnimationFrame(step);
      })(t0);
    });
  });

  /* ============ 5. SCROLL-LINKED: playhead, hero parallax, mobile CTA ============ */
  safe(function scrollLinked() {
    const playhead = document.getElementById('playhead');
    const hero = document.getElementById('top');
    const inner = hero && hero.querySelector('.hero-inner');
    const h1 = hero && hero.querySelector('h1');
    const mCta = document.getElementById('mCta');
    const booking = document.getElementById('booking');
    let pending = false;

    function update() {
      pending = false;
      const y = window.scrollY;
      const max = (document.documentElement.scrollHeight - window.innerHeight) || 1;
      if (playhead) playhead.style.transform = `scaleX(${Math.min(1, y / max).toFixed(4)})`;

      if (hero) {
        const hh = hero.offsetHeight || window.innerHeight;
        const k = Math.min(1, y / hh);
        if (k < 1 && inner) {
          // hero drifts down slower than the page and fades — classic parallax push-out
          inner.style.transform = `translate3d(0,${(y * 0.3).toFixed(1)}px,0)`;
          inner.style.opacity = Math.max(0, 1 - k * 1.3).toFixed(3);
          if (h1) { h1.style.transformOrigin = '0 100%'; h1.style.transform = `scale(${(1 - k * 0.05).toFixed(4)})`; }
        }
        if (mCta && booking) {
          const b = booking.getBoundingClientRect();
          const bookingInView = b.top < window.innerHeight && b.bottom > 0;
          mCta.classList.toggle('show', y > hh * 0.7 && !bookingInView);
        }
      }
    }
    window.addEventListener('scroll', () => { if (!pending) { pending = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  });

  /* ============ 6. LIVE REC TIMECODE (25 fps) ============ */
  safe(function liveTimecode() {
    const el = document.getElementById('liveTc');
    if (!el) return;
    const t0 = performance.now(), p = n => String(n).padStart(2, '0');
    let last = '';
    (function tick(t) {
      const f = Math.floor((t - t0) / 40); // 25 fps
      const s = `${p(Math.floor(f / 90000) % 24)}:${p(Math.floor(f / 1500) % 60)}:${p(Math.floor(f / 25) % 60)}:${p(f % 25)}`;
      if (s !== last) { el.textContent = s; last = s; }
      requestAnimationFrame(tick);
    })(t0);
  });

  /* ============ 7. CURSOR RING + MAGNETIC BUTTONS ============ */
  safe(function cursor() {
    if (!finePointer) return;
    const ring = document.querySelector('.cursor');
    if (!ring) return;
    let x = -100, y = -100, cx = -100, cy = -100;
    document.addEventListener('mousemove', e => {
      x = e.clientX; y = e.clientY;
      ring.classList.add('on');
      const t = e.target;
      const play = t.closest && t.closest('#workGrid .card .frame');
      const link = t.closest && t.closest('a, button, .lang-toggle, summary, label, input[type=range], .playbtn');
      ring.classList.toggle('play', !!play && !document.getElementById('lightbox').classList.contains('open'));
      ring.classList.toggle('link', !play && !!link);
    }, { passive: true });
    document.addEventListener('mouseleave', () => ring.classList.remove('on'));
    (function loop() {
      cx += (x - cx) * 0.2; cy += (y - cy) * 0.2;
      ring.style.transform = `translate3d(${cx.toFixed(1)}px,${cy.toFixed(1)}px,0)`;
      requestAnimationFrame(loop);
    })();

    document.querySelectorAll('.btn.solid, .nav-cta').forEach(btn => {
      btn.addEventListener('mousemove', e => {
        const r = btn.getBoundingClientRect();
        const dx = (e.clientX - r.left - r.width / 2) / r.width;
        const dy = (e.clientY - r.top - r.height / 2) / r.height;
        btn.style.transform = `translate(${(dx * 10).toFixed(1)}px,${(dy * 8 - 2).toFixed(1)}px)`;
      });
      btn.addEventListener('mouseleave', () => { btn.style.transform = ''; });
    });
  });

  /* ============ 8. STAGGERED REVEALS (services, process) ============ */
  safe(function stagger() {
    document.querySelectorAll('.svc-grid, .process').forEach(group => {
      group.querySelectorAll('.reveal').forEach((el, i) => el.style.setProperty('--d', (i * 0.12) + 's'));
    });
  });
})();

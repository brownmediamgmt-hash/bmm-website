/* Brown Media Management — motion layer
   1) Typewriter: headings type themselves in when scrolled into view
   2) Eased anchor scroll: nav clicks glide instead of jump */
(function () {
  'use strict';
  // v3 — animations always on (owner preference); OS reduce-motion is logged but not applied
  const reduced = false;
  const osReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  console.log('[BMM effects v4] loaded — flow background removed; typewriter + eased scroll active');
  const safe = fn => { try { fn(); } catch (e) { console.warn('[BMM effects]', e); } };

  /* ============ 2. TYPEWRITER ON SCROLL ============ */
  safe(function typewriter() {
    const targets = document.querySelectorAll('.hero h1, section h2, .tc');
    if (!targets.length) return;
    if (reduced) return; // text simply stays visible

    function typeIn(el, duration) {
      // collect text nodes so HTML structure (amber spans etc.) is preserved
      const nodes = [];
      (function walk(n) {
        n.childNodes.forEach(c => {
          if (c.nodeType === 3) nodes.push({ node: c, text: c.nodeValue });
          else walk(c);
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

  /* ============ 3. EASED ANCHOR SCROLL ============ */
  safe(function smoothAnchors() {
    const NAV_OFFSET = 72;
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      a.addEventListener('click', e => {
        const id = a.getAttribute('href');
        if (id.length < 2) return;
        const target = document.querySelector(id);
        if (!target) return;
        e.preventDefault();
        if (reduced) { target.scrollIntoView(); return; }

        const yTo = target.getBoundingClientRect().top + window.scrollY - NAV_OFFSET;
        const yFrom = window.scrollY;
        const dist = yTo - yFrom;
        const dur = Math.min(850, 350 + Math.abs(dist) * 0.18); // quick, scales with distance
        const ease = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
        const t0 = performance.now();
        (function step(t) {
          const k = Math.min((t - t0) / dur, 1);
          window.scrollTo(0, yFrom + dist * ease(k));
          if (k < 1) requestAnimationFrame(step);
        })(t0);
        history.pushState(null, '', id);
      });
    });
  });
})();

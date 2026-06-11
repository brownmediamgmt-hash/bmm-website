/* Brown Media Management — motion layer
   1) Flow field background: fine drifting lines, Antigravity-style, tuned to beige/amber
   2) Typewriter: headings type themselves in when scrolled into view
   3) Eased anchor scroll: nav clicks glide instead of jump
   All effects respect prefers-reduced-motion. */
(function () {
  'use strict';
  // v3 — animations always on (owner preference); OS reduce-motion is logged but not applied
  const reduced = false;
  const osReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  console.log('[BMM effects v3] loaded — OS reducedMotion:', osReduced, '(overridden: animations always on)');
  const safe = fn => { try { fn(); } catch (e) { console.warn('[BMM effects]', e); } };

  /* ============ 1. FLOW FIELD BACKGROUND ============ */
  safe(function flowField() {
    const canvas = document.getElementById('flow');
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    if (reduced) {
      // accessibility: no animation, but still a designed background — static strokes
      const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
      const W = canvas.width = Math.floor(innerWidth * DPR);
      const H = canvas.height = Math.floor(innerHeight * DPR);
      ctx.lineWidth = DPR * 0.8;
      for (let i = 0; i < 170; i++) {
        let x = Math.random() * W, y = Math.random() * H;
        ctx.strokeStyle = Math.random() < 0.3 ? 'rgba(185,124,46,0.10)' : 'rgba(111,103,89,0.07)';
        ctx.beginPath(); ctx.moveTo(x, y);
        for (let j = 0; j < 26; j++) {
          const a = (Math.sin(x * 0.0016) + Math.sin(y * 0.0021) + Math.sin((x + y) * 0.0009) * 0.7) * 1.35;
          x += Math.cos(a) * 4 * DPR; y += Math.sin(a) * 4 * DPR;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      return;
    }

    const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    let W, H, particles = [];
    const mouse = { x: -9999, y: -9999 };

    // layered sine "noise" — cheap, organic, loops forever
    function angle(x, y, t) {
      return (
        Math.sin(x * 0.0016 + t * 0.00018) +
        Math.sin(y * 0.0021 - t * 0.00013) +
        Math.sin((x + y) * 0.0009 + t * 0.0001) * 0.7
      ) * 1.35;
    }

    function resize() {
      W = canvas.width = Math.floor(innerWidth * DPR);
      H = canvas.height = Math.floor(innerHeight * DPR);
      const count = Math.min(520, Math.floor((innerWidth * innerHeight) / 3400));
      particles = Array.from({ length: count }, spawn);
      ctx.clearRect(0, 0, W, H);
    }
    function spawn() {
      return { x: Math.random() * W, y: Math.random() * H, life: 60 + Math.random() * 200, amber: Math.random() < 0.3 };
    }

    let last = performance.now();
    function frame(now) {
      const dt = Math.min(now - last, 50); last = now;

      // fade old trails (keeps canvas transparent)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = 'rgba(0,0,0,0.045)';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';

      ctx.lineWidth = DPR * 0.8;
      for (const p of particles) {
        const a = angle(p.x, p.y, now);
        let vx = Math.cos(a), vy = Math.sin(a);

        // gentle push away from cursor
        const dx = p.x - mouse.x, dy = p.y - mouse.y;
        const d2 = dx * dx + dy * dy, R = 130 * DPR;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) || 1, f = (1 - d / R) * 2.2;
          vx += (dx / d) * f; vy += (dy / d) * f;
        }

        const speed = 0.55 * DPR * (dt / 16.7);
        const nx = p.x + vx * speed, ny = p.y + vy * speed;

        ctx.strokeStyle = p.amber ? 'rgba(185,124,46,0.16)' : 'rgba(111,103,89,0.10)';
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); ctx.stroke();

        p.x = nx; p.y = ny;
        if (--p.life <= 0 || p.x < -10 || p.x > W + 10 || p.y < -10 || p.y > H + 10) Object.assign(p, spawn());
      }
      if (!document.hidden) requestAnimationFrame(frame);
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) { last = performance.now(); requestAnimationFrame(frame); }
    });
    window.addEventListener('pointermove', e => { mouse.x = e.clientX * DPR; mouse.y = e.clientY * DPR; }, { passive: true });
    window.addEventListener('pointerleave', () => { mouse.x = -9999; mouse.y = -9999; }, { passive: true });
    window.addEventListener('resize', resize, { passive: true });
    resize();
    requestAnimationFrame(frame);
  });

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

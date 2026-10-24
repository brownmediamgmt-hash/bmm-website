/* BMM admin panel — statistics, requests, client intakes, portfolio. Plain JS, hand-built SVG charts. */
(function () {
  'use strict';

  // ---------- basics ----------
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const INTAKE = window.BMM_INTAKE;
  const MAP = window.NL_PROVINCES;
  const PROV = Object.fromEntries(MAP.provinces.map(p => [p.code, p.name]));
  const C = { amber: '#C18434', teal: '#0D9298', clay: '#B4514C', grey: '#6E6658' };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  };
  let token = '';
  try { token = sessionStorage.getItem('bmm_token') || localStorage.getItem('bmm_token') || ''; } catch (e) {}

  async function api(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
    if (r.status === 401) { logout(); throw new Error('auth'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(data.error || 'Fout ' + r.status); e.status = r.status; e.data = data; throw e; }
    return data;
  }

  // ---------- formatting ----------
  const nf = new Intl.NumberFormat('nl-NL');
  const fmtN = n => nf.format(Math.round(n || 0));
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  const pad = n => String(n).padStart(2, '0');
  const plural = (n, one, more) => fmtN(n) + ' ' + (n === 1 ? one : more);
  function fmtDur(s) {
    s = Math.round(s || 0);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    return m < 60 ? m + 'm ' + pad(s % 60) + 's' : Math.floor(m / 60) + 'u ' + pad(m % 60) + 'm';
  }
  const regionNames = (() => { try { return new Intl.DisplayNames(['nl'], { type: 'region' }); } catch (e) { return null; } })();
  function countryName(c) {
    if (!c || c === '??') return 'Onbekend';
    try { return (regionNames && regionNames.of(c)) || c; } catch (e) { return c; }
  }
  function toDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return v;
    if (typeof v === 'number') return new Date(v);
    const s = String(v);
    if (/^\d{10,}$/.test(s)) return new Date(Number(s));
    // SQLite: "YYYY-MM-DD HH:MM:SS" in UTC
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return new Date(s.replace(' ', 'T') + 'Z');
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }
  const TZ = 'Europe/Amsterdam';
  const DTF = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ });
  const TF = new Intl.DateTimeFormat('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  const DAYF = new Intl.DateTimeFormat('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const SHORTF = new Intl.DateTimeFormat('nl-NL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dayDate = day => new Date(day + 'T12:00:00Z');
  const when = v => { const d = toDate(v); return d ? DTF.format(d) : ''; };
  function ago(v) {
    const d = toDate(v);
    if (!d) return '';
    const s = (Date.now() - d) / 1000;
    if (s < 60) return 'zojuist';
    if (s < 3600) return Math.floor(s / 60) + ' min geleden';
    if (s < 86400) return Math.floor(s / 3600) + ' uur geleden';
    if (s < 7 * 86400) { const n = Math.floor(s / 86400); return n === 1 ? 'gisteren' : n + ' dagen geleden'; }
    return DTF.format(d);
  }

  // ---------- labels ----------
  const SECTION = { top: 'Bovenaan (hero)', work: 'Werk', services: 'Diensten', process: 'Werkwijze', check: 'Video-check', pricing: 'Prijzen', booking: 'Contact', faq: 'FAQ', regio: 'Regio',
    nav: 'Menu', footer: 'Footer', zwevend: 'Zwevende knoppen', videospeler: 'Videospeler', overig: 'Overig' };
  const SECTION_ORDER = ['top', 'work', 'services', 'process', 'check', 'pricing', 'booking', 'faq', 'regio'];
  const secName = id => SECTION[id] || id || '—';
  const DEVICE = { mobile: 'Telefoon', desktop: 'Computer', tablet: 'Tablet' };
  const DEVICE_COLOR = { mobile: C.amber, desktop: C.teal, tablet: C.clay };
  const CONV = { lead_call: 'Gesprek aangevraagd', lead_question: 'Vraag gesteld', quiz_lead: 'Advies via video-check' };
  const QUIZ_STEPS = { step1: 'Type bedrijf', step2: 'Doel', step3: 'Hoe vaak video', step4: 'Wanneer starten', result: 'Advies gezien', lead: 'Advies aangevraagd' };
  const QUIZ_VALUES = { mkb: 'Bedrijf of MKB', personal: 'Personal brand', vastgoed: 'Vastgoed & interieur', horeca: 'Horeca & food', anders: 'Iets anders',
    leads: 'Meer aanvragen en klanten', zicht: 'Zichtbaar op social media', trust: 'Merk en vertrouwen', werving: 'Nieuw personeel vinden', verkoop: 'Woning of ruimte verkopen',
    once: 'Eén keer', few: 'Een paar keer per jaar', monthly: 'Elke maand', asap: 'Zo snel mogelijk', soon: 'Binnen 1–3 maanden', orient: 'Oriënteert zich nog' };
  const SERVICE = { business: 'Bedrijfsvideo', social: 'Social content', 'brand-film': 'Brand film', 'real-estate': 'Vastgoed', other: 'Anders' };
  const L_STATUS = { new: 'Nieuw', contacted: 'Contact gehad', won: 'Klant geworden', lost: 'Afgevallen' };
  const B_STATUS = { pending: 'Te bevestigen', confirmed: 'Bevestigd', declined: 'Afgewezen', done: 'Afgerond' };
  const IK_STATUS = { sent: 'Verstuurd', opened: 'Geopend', in_progress: 'Bezig', completed: 'Ingevuld' };
  const KIND = { gesprek: 'Gesprek', vraag: 'Vraag', check: 'Video-check' };
  function quizLabel(l) {
    const s = String(l || ''), i = s.indexOf(':');
    const st = i < 0 ? s : s.slice(0, i), v = i < 0 ? '' : s.slice(i + 1);
    if (st === 'result') return 'advies “' + v + '”';
    return (QUIZ_STEPS[st] || st) + ' → ' + (QUIZ_VALUES[v] || v);
  }
  function place(o) {
    if (!o || !o.country) return '';
    const reg = o.country === 'NL' ? (PROV[o.region] || '') : countryName(o.country);
    return [o.city, reg].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
  }

  // ---------- icons ----------
  const P = {
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5l8.5 6 8.5-6"/>',
    wa: '<path d="M4 20l1.3-4A8 8 0 1 1 8.4 19z"/><path d="M9.2 8.6c-.4 2.6 3.6 6.6 6.2 6.2l.6-1.6-1.8-.9-.9.8a5 5 0 0 1-2.4-2.4l.8-.9-.9-1.8z"/>',
    phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    print: '<path d="M7 9V3h10v6M7 18H4v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7h-3"/><rect x="7" y="14" width="10" height="7"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
    route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
    device: '<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  };
  const ic = n => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${P[n]}</svg>`;

  // ---------- tooltip, toast, copy, drawer ----------
  const tip = $('tip');
  function showTip(e, html) { tip.innerHTML = html; tip.classList.add('on'); moveTip(e); }
  function moveTip(e) {
    const r = tip.getBoundingClientRect(), g = 14;
    let x = e.clientX + g, y = e.clientY + g;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - g;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - g;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  }
  const hideTip = () => tip.classList.remove('on');
  document.addEventListener('pointerover', e => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t) showTip(e, t.dataset.tip); });
  document.addEventListener('pointermove', e => {
    if (!tip.classList.contains('on')) return;
    if (e.target.closest && (e.target.closest('[data-tip]') || e.target.closest('.chart-hit'))) moveTip(e); else hideTip();
  });
  document.addEventListener('scroll', hideTip, { passive: true, capture: true });
  const tipAttr = (title, line) => `data-tip="${esc(`<b>${esc(title)}</b><span>${esc(line)}</span>`)}"`;

  let toastT;
  function toast(msg, bad) {
    const t = $('toast');
    t.querySelector('span').textContent = msg;
    t.querySelector('i').style.background = bad ? 'var(--bad)' : 'var(--good)';
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('on'), 2600);
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e2) {}
      ta.remove();
    }
    toast('Gekopieerd');
  }
  function openDrawer(title, kicker, html) {
    $('drawerTitle').textContent = title;
    $('drawerKicker').textContent = kicker || '';
    $('drawerBody').innerHTML = html;
    $('drawerBody').scrollTop = 0;
    $('drawer').classList.add('on'); $('scrim').classList.add('on');
    setTimeout(() => $('drawerClose').focus({ preventScroll: true }), 60);
  }
  function closeDrawer() { $('drawer').classList.remove('on'); $('scrim').classList.remove('on'); hideTip(); }
  const drawerOpen = () => $('drawer').classList.contains('on');
  $('drawerClose').onclick = closeDrawer;
  $('scrim').onclick = closeDrawer;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && drawerOpen()) closeDrawer(); });

  // ---------- login ----------
  function showApp(on) {
    $('loginView').hidden = on;
    $('appView').hidden = !on;
    if (on) boot(); else setTimeout(() => $('pw').focus(), 50);
  }
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = $('loginForm').querySelector('button[type=submit]');
    $('loginErr').textContent = '';
    btn.disabled = true;
    try {
      const r = await fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $('pw').value }) });
      if (r.status === 429) throw new Error('Te veel pogingen. Wacht een minuut en probeer het opnieuw.');
      if (r.status === 503) throw new Error('De database is even niet bereikbaar. Probeer het zo opnieuw.');
      if (!r.ok) throw new Error('Onjuist wachtwoord.');
      token = (await r.json()).token;
      try { ($('remember').checked ? localStorage : sessionStorage).setItem('bmm_token', token); } catch (err) {}
      // your own visits to the site shouldn't count (can be switched off in Instellingen)
      if (store.get('bmm_notrack_pref', 'on') !== 'off') store.set('bmm_notrack', '1');
      $('pw').value = '';
      showApp(true);
    } catch (err) { $('loginErr').textContent = err.message; }
    finally { btn.disabled = false; }
  });
  function logout() {
    token = '';
    try { sessionStorage.removeItem('bmm_token'); localStorage.removeItem('bmm_token'); } catch (e) {}
    stopTimers(); closeDrawer();
    showApp(false);
  }
  $('logoutBtn').onclick = () => { api('/api/admin/logout', { method: 'POST' }).catch(() => {}).finally(logout); };

  // ---------- state & navigation ----------
  const PAGES = { overzicht: ['Overzicht', true], bezoekers: ['Bezoekers', true], gedrag: ['Gedrag', true], aanvragen: ['Aanvragen', false],
    intakes: ['Intakes', false], portfolio: ['Portfolio', false], instellingen: ['Instellingen', false] };
  const D = { an: null, live: { active: [], feed: [] }, leads: [], bookings: [], intakes: [], portfolio: null };
  let page = 'overzicht', ready = false;
  let days =[1, 7, 30, 90].includes(Number(store.get('bmm_days', 30))) ? Number(store.get('bmm_days', 30)) : 30;
  let metric = store.get('bmm_metric', 'visitors');
  let reqFilter = 'open', reqQuery = '', ikFilter = 'active';

  function go(p) {
    if (!PAGES[p]) p = 'overzicht';
    page = p;
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.page === p));
    document.querySelectorAll('.page').forEach(s => s.classList.toggle('on', s.id === 'pg-' + p));
    $('pageTitle').textContent = PAGES[p][0];
    $('period').hidden = !PAGES[p][1];
    if (location.hash !== '#' + p) history.replaceState(null, '', '#' + p);
    window.scrollTo(0, 0);
    render(p);
  }
  $('nav').addEventListener('click', e => { const b = e.target.closest('button[data-page]'); if (b) go(b.dataset.page); });
  function markPeriod() { document.querySelectorAll('#period button').forEach(b => b.classList.toggle('on', Number(b.dataset.days) === days)); }
  $('period').addEventListener('click', async e => {
    const b = e.target.closest('button[data-days]');
    if (!b) return;
    days = Number(b.dataset.days); store.set('bmm_days', days); markPeriod();
    try { await loadAnalytics(); render(page); } catch (err) { if (err.message !== 'auth') toast('Laden mislukt', true); }
  });

  async function loadAnalytics() { D.an = await api('/api/admin/analytics?days=' + days); }
  async function loadLive() { D.live = await api('/api/admin/live'); renderLivePill(); if (page === 'overzicht' && D.an) renderLive(); }
  async function loadRequests() { const [l, b] = await Promise.all([api('/api/admin/leads'), api('/api/admin/bookings')]); D.leads = l; D.bookings = b; updateCounts(); }
  async function loadIntakes() { D.intakes = await api('/api/admin/intakes'); updateCounts(); }
  async function loadPortfolio() { D.portfolio = await api('/api/admin/portfolio'); }

  let timers = [];
  function startTimers() {
    stopTimers();
    timers.push(setInterval(() => { if (!document.hidden) loadLive().catch(() => {}); }, 15000));
    timers.push(setInterval(() => { if (!document.hidden) refreshData(); }, 90000));
  }
  function stopTimers() { timers.forEach(clearInterval); timers = []; }
  const editing = () => { const a = document.activeElement; return a && a.closest && a.closest('.main') && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };
  async function refreshData() {
    try {
      await Promise.all([loadAnalytics(), loadRequests(), loadIntakes()]);
      if (['overzicht', 'bezoekers', 'gedrag', 'aanvragen', 'intakes'].includes(page) && !editing() && !drawerOpen()) render(page);
    } catch (e) {}
  }

  async function boot() {
    markPeriod();
    go((location.hash || '').slice(1) || 'overzicht');
    try {
      await Promise.all([loadAnalytics(), loadRequests(), loadIntakes(), loadLive()]);
    } catch (e) { if (e.message !== 'auth') toast('Niet alles kon laden: ' + e.message, true); }
    ready = true;
    if (token) { render(page); startTimers(); }
  }

  function render(p) {
    ({ overzicht: renderOverview, bezoekers: renderVisitors, gedrag: renderBehaviour, aanvragen: renderRequests,
      intakes: renderIntakes, portfolio: renderPortfolio, instellingen: renderSettings })[p]();
    setSub();
  }
  function setSub() {
    let t = '';
    if (PAGES[page][1]) t = days === 1 ? 'Vandaag vanaf 00:00 · vergelijking met de uren ervoor' : `Laatste ${days} dagen · vergelijking met de ${days} dagen ervoor`;
    if (page === 'aanvragen') { const r = requests(); t = `${r.filter(x => x.open).length} open · ${r.length} totaal`; }
    if (page === 'intakes') { const a = D.intakes.filter(i => !i.archived); t = `${a.filter(i => i.status !== 'completed').length} lopend · ${a.filter(i => i.status === 'completed').length} ingevuld`; }
    if (page === 'portfolio' && D.portfolio) t = `${D.portfolio.length} projecten · ${D.portfolio.filter(p => Number(p.published)).length} zichtbaar op de site`;
    if (page === 'instellingen') t = 'Statistieken, back-up en privacy';
    $('pageSub').textContent = t;
  }
  const seenIntakes = () => { try { return new Set(JSON.parse(store.get('bmm_seen_intakes', '[]'))); } catch (e) { return new Set(); } };
  function markSeen(id) { const s = seenIntakes(); s.add(id); store.set('bmm_seen_intakes', JSON.stringify([...s].slice(-500))); updateCounts(); }
  function updateCounts() {
    const setCount = (id, n) => { const el = $(id); el.hidden = !n; el.textContent = n > 99 ? '99+' : n; };
    setCount('cntReq', D.leads.filter(r => r.status === 'new').length + D.bookings.filter(r => r.status === 'pending').length);
    const seen = seenIntakes();
    setCount('cntIntake', D.intakes.filter(i => i.status === 'completed' && !i.archived && !seen.has(i.id)).length);
  }

  // ---------- chart helpers ----------
  function ramp(t) {
    t = Math.max(0, Math.min(1, t));
    const a = [0x3d, 0x32, 0x26], b = [0xe8, 0xb4, 0x6c], k = Math.pow(t, 0.75);
    return 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * k)).join(',') + ')';
  }
  function niceStep(maxVal) {
    const raw = Math.max(1, maxVal) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw);
    return Math.max(1, Math.round(step));
  }
  function bars(items, o = {}) {
    if (!items.length) return `<div class="empty">${o.empty || 'Nog geen data in deze periode.'}</div>`;
    const max = Math.max(1, ...items.map(i => i.v));
    const total = o.total != null ? o.total : items.reduce((a, i) => a + i.v, 0);
    const noun = o.noun || ['bezoek', 'bezoeken'];
    return '<div class="bars">' + items.map((it, k) => {
      const line = plural(it.v, noun[0], noun[1]) + (total && o.pct !== false ? ' · ' + pct(it.v, total) + '%' : '') + (it.extra ? ' · ' + it.extra : '');
      return `<div class="bar" ${tipAttr(it.name, line)}><i class="fill" style="width:${Math.max(1.5, it.v / max * 100).toFixed(1)}%;animation-delay:${Math.min(k, 12) * 28}ms"></i>` +
        `<span class="name">${it.pre || ''}${esc(it.name)}${it.sub ? '<small>' + esc(it.sub) + '</small>' : ''}</span>` +
        `<span class="val">${fmtN(it.v)}</span>${o.pct === false ? '' : `<span class="pct">${pct(it.v, total)}%</span>`}</div>`;
    }).join('') + '</div>';
  }
  function spark(vals) {
    if (!vals || !vals.length) return '';
    if (vals.length === 1) vals = [vals[0], vals[0]];
    const max = Math.max(1, ...vals), n = vals.length;
    const line = vals.map((v, i) => (i ? 'L' : 'M') + (i / (n - 1) * 100).toFixed(2) + ',' + (28 - v / max * 25).toFixed(2)).join('');
    return `<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><path d="${line}L100,30L0,30Z" fill="rgba(193,132,52,.13)"/><path d="${line}" fill="none" stroke="${C.amber}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }
  // line + area with a crosshair tooltip; pts = [{label, title, v}]
  function areaChart(el, pts, noun) {
    const W = Math.max(280, Math.round(el.clientWidth || 640)), H = W < 500 ? 200 : 240;
    const L = 34, R = 10, T = 12, B = 26, iw = W - L - R, ih = H - T - B, n = pts.length;
    const step = niceStep(Math.max(0, ...pts.map(p => p.v))), max = step * 4;
    const x = i => L + (n === 1 ? iw / 2 : i / (n - 1) * iw);
    const y = v => T + ih - v / max * ih;
    let g = '';
    for (let k = 0; k <= 4; k++) {
      const yy = y(step * k).toFixed(1);
      g += `<line class="gridline" x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}"/><text x="${L - 8}" y="${+yy + 3.5}" text-anchor="end">${fmtN(step * k)}</text>`;
    }
    const want = W < 500 ? 4 : 7;
    const idx = n <= want ? pts.map((_, i) => i) : Array.from({ length: want }, (_, k) => Math.round(k * (n - 1) / (want - 1)));
    const xl = [...new Set(idx)].map(i => `<text x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle'}">${esc(pts[i].label)}</text>`).join('');
    const line = pts.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(p.v).toFixed(1)).join('');
    const area = line + `L${x(n - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Grafiek">
      <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.amber}" stop-opacity=".28"/><stop offset="1" stop-color="${C.amber}" stop-opacity="0"/></linearGradient></defs>
      <g class="axis">${g}${xl}</g>
      <path d="${area}" fill="url(#ag)"/>
      <path d="${line}" fill="none" stroke="${C.amber}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${n === 1 ? `<circle cx="${x(0)}" cy="${y(pts[0].v)}" r="4" fill="${C.amber}"/>` : ''}
      <line class="xh" x1="0" x2="0" y1="${T}" y2="${T + ih}" stroke="#7D7465" stroke-dasharray="3 3" opacity="0"/>
      <circle class="xd" r="5" fill="${C.amber}" stroke="#1E1A15" stroke-width="2" opacity="0"/>
      <rect class="chart-hit" x="${L}" y="0" width="${iw}" height="${H - B}" fill="transparent"/>
    </svg>`;
    const svg = el.querySelector('svg'), hit = svg.querySelector('.chart-hit'), xh = svg.querySelector('.xh'), xd = svg.querySelector('.xd');
    const at = e => { const r = svg.getBoundingClientRect(); const mx = (e.clientX - r.left) / r.width * W; return Math.max(0, Math.min(n - 1, Math.round(n === 1 ? 0 : (mx - L) / iw * (n - 1)))); };
    hit.addEventListener('pointermove', e => {
      const i = at(e), cx = x(i), cy = y(pts[i].v);
      xh.setAttribute('x1', cx); xh.setAttribute('x2', cx); xh.setAttribute('opacity', 1);
      xd.setAttribute('cx', cx); xd.setAttribute('cy', cy); xd.setAttribute('opacity', 1);
      showTip(e, `<b>${esc(pts[i].title)}</b><span>${esc(plural(pts[i].v, noun[0], noun[1]))}</span>`);
    });
    hit.addEventListener('pointerleave', () => { xh.setAttribute('opacity', 0); xd.setAttribute('opacity', 0); hideTip(); });
  }
  function delta(cur, prev, mode) {
    if (!prev && !cur) return '<div class="k-d">geen data</div>';
    if (mode === 'pt') {
      const d = cur - prev;
      if (!d) return '<div class="k-d">= gelijk</div>';
      return `<div class="k-d ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)} pt <span style="color:var(--faint)">vs. ervoor</span></div>`;
    }
    if (!prev) return '<div class="k-d up">▲ nieuw <span style="color:var(--faint)">vs. ervoor</span></div>';
    const d = Math.round((cur - prev) / prev * 100);
    if (!d) return '<div class="k-d">= gelijk</div>';
    const txt = d >= 200 ? (cur / prev).toFixed(cur / prev >= 10 ? 0 : 1).replace('.', ',') + '×' : Math.abs(d) + '%';
    return `<div class="k-d ${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'} ${txt} <span style="color:var(--faint)">vs. ervoor</span></div>`;
  }
  const loading = '<div class="loading">Laden…</div>';

  // ---------- Overzicht ----------
  const METRICS = { visitors: ['Bezoekers', ['bezoeker', 'bezoekers']], sessions: ['Bezoeken', ['bezoek', 'bezoeken']], pageviews: ['Paginaweergaven', ['weergave', 'weergaven']], conversions: ['Aanvragen via site', ['aanvraag', 'aanvragen']] };
  if (!METRICS[metric]) metric = 'visitors';
  function renderOverview() {
    const an = D.an;
    if (!an) { $('kpis').innerHTML = loading; return; }
    const t = an.totals, p = an.prev || {};
    const ser = k => (an.hourly && days === 1 ? an.hourly : an.series).map(s => s[k] || 0);
    const tiles = [
      { id: 'visitors', label: 'Bezoekers', v: fmtN(t.visitors), d: delta(t.visitors, p.visitors), s: ser('visitors') },
      { id: 'pageviews', label: 'Paginaweergaven', v: fmtN(t.pageviews), d: delta(t.pageviews, p.pageviews), s: ser('pageviews') },
      { id: 'duration', label: 'Gem. tijd op site', v: fmtDur(t.avgDuration), d: delta(t.avgDuration, p.avgDuration) },
      { id: 'engaged', label: 'Betrokken bezoeken', v: t.engagedRate + '%', d: delta(t.engagedRate, p.engagedRate, 'pt'), tip: 'Bleef ≥10 seconden, klikte iets of bekeek 2+ secties' },
      { id: 'conversions', label: 'Aanvragen via site', v: fmtN(t.conversions), d: delta(t.conversions, p.conversions), s: ser('conversions') },
      { id: 'whatsapp', label: 'WhatsApp-klikken', v: fmtN(t.whatsapp), d: delta(t.whatsapp, p.whatsapp) },
    ];
    $('kpis').innerHTML = tiles.map(k => `<button class="card kpi${k.id === metric ? ' on' : ''}" ${METRICS[k.id] ? `data-metric="${k.id}"` : 'tabindex="-1" style="cursor:default"'} ${k.tip ? tipAttr(k.label, k.tip) : ''}>
      <div class="k-l">${esc(k.label)}</div><div class="k-v num">${k.v}</div>${k.d}${k.s ? spark(k.s) : '<svg class="spark" viewBox="0 0 100 30" aria-hidden="true"></svg>'}</button>`).join('');
    const m = METRICS[metric];
    $('mainChartTitle').textContent = m[0] + (days === 1 ? ' per uur (vandaag)' : ' per dag');
    const pts = days === 1 && an.hourly
      ? an.hourly.map(h => ({ label: pad(h.hour) + ':00', title: `${pad(h.hour)}:00 – ${pad((h.hour + 1) % 24)}:00`, v: h[metric] || 0 }))
      : an.series.map(s => ({ label: SHORTF.format(dayDate(s.day)), title: DAYF.format(dayDate(s.day)), v: s[metric] || 0 }));
    const total = metric === 'visitors' ? t.visitors : metric === 'sessions' ? t.sessions : pts.reduce((a, b) => a + b.v, 0);
    $('mainChartNote').textContent = 'totaal ' + fmtN(total);
    areaChart($('mainChart'), pts, m[1]);
    renderLive();
    const provs = an.provinces.filter(x => x.sessions);
    const nlTotal = provs.reduce((a, b) => a + b.sessions, 0);
    const abroad = an.countries.filter(c => c.code !== 'NL').reduce((a, b) => a + b.sessions, 0);
    $('ovProv').innerHTML = bars(provs.slice(0, 6).map(x => ({ name: x.name, v: x.sessions })), { total: nlTotal, empty: 'Nog geen bezoekers uit Nederland in deze periode.' }) +
      (abroad ? `<div class="sub-h" style="margin-top:12px">+ ${plural(abroad, 'bezoek', 'bezoeken')} uit het buitenland</div>` : '');
    $('ovSources').innerHTML = bars(an.sources.slice(0, 6).map(s => ({ name: s.name, v: s.sessions, extra: s.conversions ? plural(s.conversions, 'aanvraag', 'aanvragen') : '' })));
    $('ovClicks').innerHTML = bars(an.clicks.slice(0, 6).map(c => ({ name: c.label, sub: secName(c.section), v: c.count })), { noun: ['klik', 'klikken'], empty: 'Nog geen klikken in deze periode.' });
    const rq = requests().slice(0, 5);
    $('ovReq').innerHTML = rq.length ? rq.map(r => `<button class="row-link" data-go="aanvragen"><b>${esc(r.name)}</b><span class="status st-${esc(r.status)}">${esc(statusLabel(r))}</span><small>${KIND[r.kind]}${place(r) ? ' · ' + esc(place(r)) : ''}${r.traffic ? ' · via ' + esc(r.traffic) : ''}</small><small>${esc(ago(r.created_at))}</small></button>`).join('')
      : '<div class="empty">Nog geen aanvragen. Ze verschijnen hier zodra iemand het formulier of de video-check invult.</div>';
    const act = D.intakes.filter(i => !i.archived);
    const cnt = s => act.filter(i => i.status === s).length;
    $('ovIntakes').innerHTML = `<div class="ikcounts"><div><b>${cnt('sent')}</b><span>Verstuurd</span></div><div><b>${cnt('opened')}</b><span>Geopend</span></div><div><b>${cnt('in_progress')}</b><span>Bezig</span></div><div><b>${cnt('completed')}</b><span>Ingevuld</span></div></div>` +
      (act.slice(0, 3).map(i => `<button class="row-link" data-ik="${i.id}"><b>${esc(i.company || i.contact_name || 'Zonder naam')}</b><span class="status st-${esc(i.status)}">${IK_STATUS[i.status] || esc(i.status)}</span><small>${i.progress}% ingevuld</small><small>${esc(ago(i.updated_at || i.created_at))}</small></button>`).join('') ||
        '<div class="empty">Nog geen intakes. Maak er één aan op de pagina Intakes.</div>');
  }
  function renderLivePill() {
    const n = D.live.active.length;
    $('liveN').textContent = n;
    $('livePill').classList.toggle('zero', !n);
  }
  function evText(e) {
    switch (e.type) {
      case 'pv': return 'Opent de site';
      case 'sv': return 'Bekijkt <b>' + esc(secName(e.section)) + '</b>';
      case 'ck': return 'Klikt <b>' + esc(e.label || '—') + '</b>';
      case 'cv': return '<b style="color:var(--good)">' + esc(CONV[e.label] || e.label) + '</b>';
      case 'qz': return 'Video-check: ' + esc(quizLabel(e.label));
      case 'lv': { const [s, sc] = String(e.extra || '').split('|'); return 'Verlaat de site na ' + fmtDur(+s || 0) + (sc ? ' (scrolde ' + esc(sc) + '%)' : ''); }
      default: return esc(e.type);
    }
  }
  function renderLive() {
    const L = D.live;
    renderLivePill();
    $('liveList').innerHTML = L.active.length ? L.active.slice(0, 6).map(a => `<div class="who"><b>${esc(place(a) || 'Locatie onbekend')}</b><span class="chip">${esc(DEVICE[a.device] || a.device || '?')}</span>
      <small>bij ${esc(secName(a.section))} · via ${esc(a.src || 'Direct')}${a.clicks ? ' · ' + plural(a.clicks, 'klik', 'klikken') : ''}</small><small>${fmtDur((a.last - a.since) / 1000)}</small></div>`).join('')
      : '<div class="empty">Op dit moment niemand op de site. Dit ververst vanzelf.</div>';
    $('feed').innerHTML = L.feed.length ? L.feed.map(ev => `<div class="ev ${esc(ev.type)}"><time>${TF.format(new Date(ev.ts))}</time><span class="ic"></span><span class="tx">${evText(ev)}<small>${esc(place(ev))}</small></span></div>`).join('')
      : '<div class="empty">Nog geen activiteit in het afgelopen half uur.</div>';
  }
  document.addEventListener('click', e => {
    const k = e.target.closest('[data-metric]');
    if (k) { metric = k.dataset.metric; store.set('bmm_metric', metric); renderOverview(); }
  });

  // ---------- Bezoekers ----------
  function renderVisitors() {
    const an = D.an;
    if (!an) { $('nlMap').innerHTML = loading; return; }
    const prov = new Map(an.provinces.map(p => [p.code, p.sessions]));
    const nlTotal = an.provinces.reduce((a, p) => a + p.sessions, 0);
    const pmax = Math.max(1, ...an.provinces.map(p => p.sessions));
    const paths = MAP.provinces.map(p => {
      const v = prov.get(p.code) || 0;
      return `<path d="${p.d}" fill="${v ? ramp(v / pmax) : '#29231C'}" ${tipAttr(p.name, plural(v, 'bezoek', 'bezoeken') + (nlTotal ? ' · ' + pct(v, nlTotal) + '% van NL' : ''))}/>`;
    }).join('');
    const cities = an.cities.filter(c => c.country === 'NL' && c.lat != null).sort((a, b) => b.sessions - a.sessions);
    const cmax = Math.max(1, ...cities.map(c => c.sessions));
    const dots = cities.map(c => {
      const [x, y] = MAP.project(c.lat, c.lon);
      if (!(x > -5 && x < MAP.w + 5 && y > -5 && y < MAP.h + 5)) return '';
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(2.6 + Math.sqrt(c.sessions / cmax) * 6.4).toFixed(1)}" ${tipAttr(c.city, (c.regionName ? c.regionName + ' · ' : '') + plural(c.sessions, 'bezoek', 'bezoeken'))}/>`;
    }).join('');
    $('nlMap').innerHTML = `<svg viewBox="0 0 ${MAP.w} ${MAP.h}" role="img" aria-label="Kaart van Nederland: bezoeken per provincie">${paths}${dots}</svg>
      <div class="scale"><span>minder</span><i></i><span>meer</span><span style="margin-left:auto">● = stad</span></div>`;
    $('mapNote').textContent = nlTotal ? plural(nlTotal, 'bezoek', 'bezoeken') + ' uit Nederland' : '';
    $('cityList').innerHTML = bars(an.cities.slice(0, 12).map(c => ({ name: c.city, sub: c.country === 'NL' ? c.regionName : countryName(c.country), v: c.sessions })), { empty: 'Nog geen steden in deze periode.' });
    $('provList').innerHTML = bars(an.provinces.filter(p => p.sessions).map(p => ({ name: p.name, v: p.sessions })), { total: nlTotal, empty: 'Nog geen bezoekers uit Nederland.' });
    $('countryList').innerHTML = bars(an.countries.slice(0, 10).map(c => ({ name: c.name, pre: `<span class="cc">${esc(c.code === '??' ? '—' : c.code)}</span>`, v: c.sessions })));
    $('sourceList').innerHTML = bars(an.sources.map(s => ({ name: s.name, v: s.sessions, sub: s.conversions ? '· ' + plural(s.conversions, 'aanvraag', 'aanvragen') : '', extra: s.conversions ? plural(s.conversions, 'aanvraag', 'aanvragen') : '' })));
    // devices: colour follows the device (phone amber, computer teal, tablet clay)
    const devs = [...an.devices].sort((a, b) => (['mobile', 'desktop', 'tablet'].indexOf(a.name) + 9) % 9 - (['mobile', 'desktop', 'tablet'].indexOf(b.name) + 9) % 9);
    const dt = devs.reduce((a, d) => a + d.sessions, 0);
    $('deviceShare').innerHTML = dt ? `<div class="share">${devs.map(d => `<i style="width:${(d.sessions / dt * 100).toFixed(2)}%;background:${DEVICE_COLOR[d.name] || C.grey}" ${tipAttr(DEVICE[d.name] || d.name, plural(d.sessions, 'bezoek', 'bezoeken') + ' · ' + pct(d.sessions, dt) + '%')}></i>`).join('')}</div>
      <div class="legend">${devs.map(d => `<div><span class="sw" style="background:${DEVICE_COLOR[d.name] || C.grey}"></span>${esc(DEVICE[d.name] || d.name)}<span class="v">${fmtN(d.sessions)}</span><span class="p">${pct(d.sessions, dt)}%</span></div>`).join('')}</div>`
      : '<div class="empty">Nog geen data in deze periode.</div>';
    $('browserList').innerHTML = bars(an.browsers.slice(0, 8).map(b => ({ name: b.name, v: b.sessions })));
    $('osList').innerHTML = bars(an.oses.slice(0, 8).map(b => ({ name: b.name, v: b.sessions })));
    renderHeat();
  }
  function renderHeat() {
    const H = D.an.heat, max = Math.max(0, ...H.flat());
    const dn = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'], dl = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
    let html = '<div class="heat">';
    H.forEach((row, d) => {
      html += `<span class="rl">${dn[d]}</span>` + row.map((v, h) => `<span class="c" style="background:${v ? ramp(v / max) : '#221D17'}" ${tipAttr(dl[d] + ' ' + pad(h) + ':00–' + pad((h + 1) % 24) + ':00', plural(v, 'bezoek', 'bezoeken'))}></span>`).join('');
    });
    html += '<span></span>' + Array.from({ length: 24 }, (_, h) => `<span class="cl">${h % 3 === 0 ? pad(h) : ''}</span>`).join('') + '</div>';
    if (max) {
      let best = [0, 0];
      H.forEach((row, d) => row.forEach((v, h) => { if (v > H[best[0]][best[1]]) best = [d, h]; }));
      html += `<div class="scale" style="margin-top:12px"><span>minder</span><i></i><span>meer</span><span style="margin-left:auto">Drukste moment: ${dl[best[0]]} ${pad(best[1])}:00</span></div>`;
    } else html += '<div class="empty">Nog geen bezoeken in deze periode.</div>';
    $('heat').innerHTML = html;
  }

  // ---------- Gedrag ----------
  function renderBehaviour() {
    const an = D.an;
    if (!an) { $('reach').innerHTML = loading; return; }
    const conv = k => (an.conversions.find(c => c.label === k) || {}).count || 0;
    const ctas = an.clicks.filter(c => /whatsapp|plan|contact|instagram|formulier|video-check/i.test(c.label));
    $('ctaBox').innerHTML = `<div class="minis">
        <div class="mini"><b>${fmtN(an.totals.whatsapp)}</b><span>WhatsApp-klikken</span></div>
        <div class="mini"><b>${fmtN(conv('lead_call') + conv('lead_question'))}</b><span>Formulier verstuurd</span></div>
        <div class="mini"><b>${fmtN(conv('quiz_lead'))}</b><span>Advies via video-check</span></div>
      </div>` + bars(ctas.map(c => ({ name: c.label, sub: secName(c.section), v: c.count })), { noun: ['klik', 'klikken'], empty: 'Nog geen klikken op contactknoppen.' });
    const base = an.totals.sessions || 0;
    $('reach').innerHTML = base ? '<div class="steps">' + an.sections.map((s, i) => `<div class="stepr" ${tipAttr(secName(s.id), `${plural(s.reach, 'bezoek', 'bezoeken')} zag deze sectie (${pct(s.reach, base)}%) · ${plural(s.clicks, 'klik', 'klikken')}`)}>
        <span class="lab">${esc(secName(s.id))}<small>${plural(s.clicks, 'klik', 'klikken')}</small></span><span class="t"><i style="width:${Math.max(1, pct(s.reach, base))}%;animation-delay:${i * 40}ms"></i></span>
        <span class="n">${pct(s.reach, base)}%<small>${fmtN(s.reach)}</small></span></div>`).join('') + '</div>'
      : '<div class="empty">Nog geen bezoeken in deze periode.</div>';
    const totalClicks = an.clicks.reduce((a, c) => a + c.count, 0);
    $('clickList').innerHTML = bars(an.clicks.slice(0, 20).map(c => ({ name: c.label, sub: secName(c.section), v: c.count })), { noun: ['klik', 'klikken'], total: totalClicks, empty: 'Nog geen klikken in deze periode.' });
    const q0 = Math.max(1, ...an.quiz.map(q => q.sessions));
    $('quizFunnel').innerHTML = an.quiz.some(q => q.sessions) ? '<div class="steps">' + an.quiz.map((q, i) => `<div class="stepr"><span class="lab">${esc(QUIZ_STEPS[q.step] || q.step)}</span>
        <span class="t"><i style="width:${Math.max(1, q.sessions / q0 * 100).toFixed(1)}%;animation-delay:${i * 40}ms;${q.step === 'lead' ? 'background:var(--good)' : ''}"></i></span><span class="n">${fmtN(q.sessions)}<small>${pct(q.sessions, q0)}%</small></span></div>`).join('') + '</div>'
      : '<div class="empty">Nog niemand heeft de video-check gedaan in deze periode.</div>';
    const qa = an.quizAnswers || [];
    const groups = ['step1', 'step2', 'step3', 'step4', 'result'].map(st => [st, qa.filter(a => String(a.label).split(':')[0] === st)]).filter(g => g[1].length);
    $('quizAnswers').innerHTML = groups.length ? groups.map(([st, list]) => `<div class="sub-h">${esc(QUIZ_STEPS[st])}</div>` +
      bars(list.map(a => { const v = String(a.label).slice(st.length + 1); return { name: QUIZ_VALUES[v] || v, v: a.count }; }), { noun: ['keer', 'keer'] })).join('')
      : '<div class="empty">Nog geen antwoorden.</div>';
    const vids = new Map();
    an.clicks.filter(c => /^Video: /.test(c.label)).forEach(c => { const k = c.label.slice(7); vids.set(k, (vids.get(k) || 0) + c.count); });
    $('videoList').innerHTML = bars([...vids].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: k, v })), { noun: ['keer afgespeeld', 'keer afgespeeld'], empty: 'Nog geen video’s afgespeeld in deze periode.' });
    $('otherClicks').innerHTML = bars(an.clicks.filter(c => !SECTION_ORDER.includes(c.section)).map(c => ({ name: c.label, sub: secName(c.section), v: c.count })), { noun: ['klik', 'klikken'], empty: 'Nog geen klikken in het menu of op zwevende knoppen.' });
  }

  // ---------- Aanvragen ----------
  function requests() {
    const L = D.leads.map(r => ({ ...r, table: 'leads', kind: r.source === 'quiz' || /^VIDEO-CHECK/.test(r.message || '') ? 'check' : 'vraag', open: r.status === 'new' }));
    const B = D.bookings.map(r => ({ ...r, table: 'bookings', kind: 'gesprek', open: r.status === 'pending' }));
    return [...L, ...B].sort((a, b) => (toDate(b.created_at) || 0) - (toDate(a.created_at) || 0));
  }
  const statusLabel = r => (r.table === 'leads' ? L_STATUS : B_STATUS)[r.status] || r.status;
  function waNum(phone) {
    const raw = String(phone || '').trim();
    let d = raw.replace(/\D/g, '');
    if (/^00/.test(d)) d = d.slice(2);
    else if (!/^\+/.test(raw) && /^0\d{9}$/.test(d)) d = '31' + d.slice(1);   // Dutch number written as 06… / 050…
    return d.length >= 10 ? d : '';
  }
  function prettyDate(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return esc(ymd || '');
    const d = new Date(ymd + 'T12:00:00Z');
    const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()) + 'T12:00:00Z');
    const diff = Math.round((d - today) / 86400000);
    const rel = diff === 0 ? 'vandaag' : diff === 1 ? 'morgen' : diff === -1 ? 'gisteren' : diff > 0 ? 'over ' + diff + ' dagen' : Math.abs(diff) + ' dagen geleden';
    return `<span class="datebox">${esc(DAYF.format(d))}<small>${rel}</small></span>`;
  }
  function quizQA(msg) {
    const qa = []; let advice = '';
    String(msg || '').split('\n').slice(1).forEach(l => {
      if (!l.trim()) return;
      if (/^Advies:/.test(l)) { advice = l.replace(/^Advies:\s*/, ''); return; }
      const i = l.indexOf('? ');
      qa.push(i > 0 ? [l.slice(0, i + 1), l.slice(i + 2)] : ['', l]);
    });
    return { qa, advice };
  }
  let reqFirst = true;
  function renderRequests() {
    if (!ready) { $('reqList').innerHTML = loading; return; }
    const all = requests();
    if (reqFirst) { reqFirst = false; if (!all.some(r => r.open)) reqFilter = 'all'; }
    const F = [['open', 'Open', r => r.open], ['all', 'Alles', () => true], ['gesprek', 'Gesprekken', r => r.kind === 'gesprek'], ['vraag', 'Vragen', r => r.kind === 'vraag'],
      ['check', 'Video-check', r => r.kind === 'check'], ['closed', 'Afgehandeld', r => !r.open]];
    $('reqFilters').innerHTML = F.map(([id, label, fn]) => `<button data-rf="${id}" class="${reqFilter === id ? 'on' : ''}">${label}<span>${all.filter(fn).length}</span></button>`).join('');
    const fn = (F.find(f => f[0] === reqFilter) || F[1])[2];
    const q = reqQuery.toLowerCase();
    const list = all.filter(fn).filter(r => !q || [r.name, r.email, r.phone, r.company, r.message, r.details, r.location, r.note].join(' ').toLowerCase().includes(q));
    $('reqList').innerHTML = list.length ? list.map(reqCard).join('')
      : `<div class="card empty">${all.length ? 'Geen aanvragen in deze selectie.' : 'Nog geen aanvragen. Zodra iemand het formulier of de video-check invult, verschijnt die hier — met locatie, apparaat en hoe ze je vonden.'}</div>`;
  }
  function reqCard(r) {
    const statuses = r.table === 'leads' ? L_STATUS : B_STATUS;
    const wa = waNum(r.phone);
    let body = '';
    if (r.kind === 'check') {
      const { qa, advice } = quizQA(r.message);
      body = `<div class="qa">${qa.map(([qq, a]) => `<div><span>${esc(qq)}</span><b>${esc(a)}</b></div>`).join('')}</div>${advice ? `<div class="adv">Advies: ${esc(advice)}</div>` : ''}`;
    } else if (r.kind === 'gesprek') {
      body = `<div class="msg">${esc(r.details || '')}</div>`;
    } else body = `<div class="msg">${esc(r.message || '')}</div>`;
    const svc = r.service ? SERVICE[r.service] || r.service : '';
    return `<article class="rq${r.open ? ' is-new' : ''}" data-table="${r.table}" data-id="${Number(r.id)}">
      <div>
        <h3>${esc(r.name)} <span class="chip amber">${KIND[r.kind]}</span>${r.company ? `<span class="chip">${esc(r.company)}</span>` : ''}</h3>
        <div class="meta">
          ${r.kind === 'gesprek' ? `<span class="chip amber">${ic('cal')}${prettyDate(r.preferred_date)}</span>` : ''}
          ${svc ? `<span class="chip">${esc(svc)}</span>` : ''}
          ${r.location ? `<span class="chip">${ic('pin')}Opname: ${esc(r.location)}</span>` : ''}
          ${place(r) ? `<span class="chip">${ic('pin')}${esc(place(r))}</span>` : ''}
          ${r.device ? `<span class="chip">${ic('device')}${esc(DEVICE[r.device] || r.device)}</span>` : ''}
          ${r.traffic ? `<span class="chip">via ${esc(r.traffic)}</span>` : ''}
        </div>
        ${body}
        <div class="meta" style="margin:12px 0 0;color:var(--muted);font-size:13px">${esc(r.email)}${r.phone ? ' · ' + esc(r.phone) : ''}</div>
      </div>
      <div class="side-col">
        <div class="when">${esc(when(r.created_at))} · ${esc(ago(r.created_at))}</div>
        <select class="select" data-status aria-label="Status">${Object.entries(statuses).map(([k, v]) => `<option value="${k}"${k === r.status ? ' selected' : ''}>${v}</option>`).join('')}</select>
        <div class="actions">
          <a class="btn ghost sm" href="mailto:${esc(r.email)}?subject=${encodeURIComponent('Je aanvraag bij Brown Media')}">${ic('mail')}Mail</a>
          ${wa ? `<a class="btn ghost sm" href="https://wa.me/${wa}" target="_blank" rel="noopener">${ic('wa')}WhatsApp</a>` : ''}
          ${wa ? `<a class="btn ghost sm" href="tel:+${wa}">${ic('phone')}Bel</a>` : ''}
        </div>
        <textarea class="textarea" data-note placeholder="Notitie (alleen voor jou)" style="min-height:64px">${esc(r.note || '')}</textarea>
        <div class="actions">
          ${r.sid ? `<button class="btn ghost sm" data-journey="${esc(r.sid)}" data-name="${esc(r.name)}">${ic('route')}Bekijk bezoek</button>` : ''}
          <button class="btn danger sm" data-del-req>${ic('trash')}Verwijder</button>
        </div>
      </div>
    </article>`;
  }
  $('reqFilters').addEventListener('click', e => { const b = e.target.closest('[data-rf]'); if (b) { reqFilter = b.dataset.rf; renderRequests(); } });
  let searchT;
  $('reqSearch').addEventListener('input', e => { clearTimeout(searchT); searchT = setTimeout(() => { reqQuery = e.target.value.trim(); renderRequests(); }, 150); });
  const findReq = el => { const card = el.closest('.rq'); return card && { card, table: card.dataset.table, id: Number(card.dataset.id) }; };
  $('reqList').addEventListener('change', async e => {
    if (!e.target.matches('[data-status]')) return;
    const r = findReq(e.target);
    try {
      await api(`/api/admin/${r.table}/${r.id}`, { method: 'PATCH', body: JSON.stringify({ status: e.target.value }) });
      const row = (r.table === 'leads' ? D.leads : D.bookings).find(x => Number(x.id) === r.id);
      if (row) row.status = e.target.value;
      const open = r.table === 'leads' ? e.target.value === 'new' : e.target.value === 'pending';
      r.card.classList.toggle('is-new', open);
      updateCounts(); setSub(); toast('Status bijgewerkt');
    } catch (err) { toast('Opslaan mislukt', true); }
  });
  const noteTimers = new Map();
  async function saveNote(el) {
    const r = findReq(el);
    try {
      await api(`/api/admin/${r.table}/${r.id}`, { method: 'PATCH', body: JSON.stringify({ note: el.value }) });
      const row = (r.table === 'leads' ? D.leads : D.bookings).find(x => Number(x.id) === r.id);
      if (row) row.note = el.value;
    } catch (err) { toast('Notitie opslaan mislukt', true); }
  }
  $('reqList').addEventListener('input', e => {
    if (!e.target.matches('[data-note]')) return;
    clearTimeout(noteTimers.get(e.target));
    noteTimers.set(e.target, setTimeout(() => saveNote(e.target), 900));
  });
  $('reqList').addEventListener('focusout', e => {
    if (!e.target.matches('[data-note]')) return;
    clearTimeout(noteTimers.get(e.target));
    const r = findReq(e.target), row = (r.table === 'leads' ? D.leads : D.bookings).find(x => Number(x.id) === r.id);
    if (row && (row.note || '') !== e.target.value) saveNote(e.target).then(() => toast('Notitie opgeslagen'));
  });
  $('reqList').addEventListener('click', async e => {
    const j = e.target.closest('[data-journey]');
    if (j) return openJourney(j.dataset.journey, j.dataset.name);
    if (e.target.closest('[data-del-req]')) {
      const r = findReq(e.target);
      if (!confirm('Deze aanvraag definitief verwijderen?')) return;
      try { await api(`/api/admin/${r.table}/${r.id}`, { method: 'DELETE' }); await loadRequests(); renderRequests(); setSub(); toast('Verwijderd'); }
      catch (err) { toast('Verwijderen mislukt', true); }
    }
  });
  async function openJourney(sid, name) {
    openDrawer('Bezoek van ' + name, 'HOE ZE JE VONDEN', loading);
    try {
      const ev = await api('/api/admin/journey/' + encodeURIComponent(sid));
      if (!ev.length) { $('drawerBody').innerHTML = '<div class="empty">Geen bezoekgegevens gevonden — bijvoorbeeld omdat de bezoeker statistieken blokkeert, of omdat het jouw eigen (niet-gemeten) bezoek was.</div>'; return; }
      const f = ev[0], t0 = ev[0].ts, last = ev[ev.length - 1].ts;
      const lv = ev.filter(x => x.type === 'lv').pop();
      const dur = Math.max((last - t0) / 1000, lv ? +String(lv.extra).split('|')[0] || 0 : 0);
      $('drawerBody').innerHTML = `<div class="kv">
          <span>Bron</span><b>${esc(f.src || 'Direct')}</b>
          <span>Locatie</span><b>${esc(place({ ...f }) || 'Onbekend')}</b>
          <span>Apparaat</span><b>${esc([DEVICE[f.device] || f.device, f.browser, f.os].filter(Boolean).join(' · '))}</b>
          <span>Bezoek</span><b>${esc(when(t0))} · ${fmtDur(dur)} op de site</b>
        </div>
        <div class="timeline">${ev.map(x => `<div class="tl ${esc(x.type)}"><time>+${fmtDur((x.ts - t0) / 1000)}</time>${evText(x)}</div>`).join('')}</div>`;
    } catch (err) { $('drawerBody').innerHTML = '<div class="empty">Kon het bezoek niet laden.</div>'; }
  }

  // ---------- Intakes ----------
  const startUrl = tok => location.origin + '/start/' + tok;
  $('genericLink').textContent = location.origin.replace(/^https?:\/\//, '') + '/start';
  function renderIntakes() {
    if (!ready) { $('ikList').innerHTML = loading; return; }
    const F =[['active', 'Lopend', i => !i.archived && i.status !== 'completed'], ['done', 'Ingevuld', i => !i.archived && i.status === 'completed'],
      ['archived', 'Archief', i => !!i.archived], ['all', 'Alles', () => true]];
    $('ikFilters').innerHTML = F.map(([id, label, fn]) => `<button data-if="${id}" class="${ikFilter === id ? 'on' : ''}">${label}<span>${D.intakes.filter(fn).length}</span></button>`).join('');
    const seen = seenIntakes();
    const list = D.intakes.filter((F.find(f => f[0] === ikFilter) || F[3])[2]);
    $('ikList').innerHTML = list.length ? list.map(i => `<article class="ik" data-ik="${i.id}" tabindex="0">
        <div>
          <h3>${i.status === 'completed' && !seen.has(i.id) ? '<span class="dot-new" title="Nieuw ingevuld"></span> ' : ''}${esc(i.company || i.contact_name || 'Nog geen naam')}</h3>
          <div class="meta">${i.company && i.contact_name ? `<span>${esc(i.contact_name)}</span>` : ''}<span>${i.origin === 'link' ? 'via algemene link' : 'persoonlijke link'}</span>
            <span>aangemaakt ${esc(ago(i.created_at))}</span>${i.open_count ? `<span>${i.open_count}× geopend</span>` : '<span>nog niet geopend</span>'}
            ${i.status === 'completed' ? `<span>ingevuld ${esc(ago(i.completed_at))}</span>` : i.status === 'in_progress' ? `<span>laatst actief ${esc(ago(i.updated_at))}</span>` : ''}</div>
          <div class="progress"><i style="width:${Math.max(0, Math.min(100, i.progress))}%"></i></div>
        </div>
        <div style="text-align:right"><span class="status st-${esc(i.status)}">${IK_STATUS[i.status] || esc(i.status)}</span><div class="when" style="margin-top:8px">${i.progress}% ingevuld</div></div>
      </article>`).join('')
      : `<div class="card empty">${ikFilter === 'active' ? 'Geen lopende intakes. Klik op “Nieuwe intake-link” om een klant uit te nodigen.' : 'Niets in deze lijst.'}</div>`;
  }
  $('ikFilters').addEventListener('click', e => { const b = e.target.closest('[data-if]'); if (b) { ikFilter = b.dataset.if; renderIntakes(); } });
  document.addEventListener('click', e => {
    const card = e.target.closest('[data-ik]');
    if (card) openIntake(Number(card.dataset.ik));
  });
  $('ikList').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('[data-ik]')) openIntake(Number(e.target.dataset.ik)); });
  function shareText(it, url) {
    const first = String(it.contact_name || '').split(/\s+/)[0];
    return `Hoi${first ? ' ' + first : ''}! Hierbij de link voor de onboarding${it.company ? ' van ' + it.company : ''}: ${url}\n\nHet duurt ongeveer ${INTAKE.minutes} minuten. Je kunt tussendoor stoppen — alles wordt automatisch opgeslagen.\n\nGroet, Ruben — Brown Media`;
  }
  function shareBlock(it) {
    const url = startUrl(it.token), text = shareText(it, url);
    const mail = `mailto:${encodeURIComponent(it.email || '')}?subject=${encodeURIComponent('Onboarding Brown Media' + (it.company ? ' — ' + it.company : ''))}&body=${encodeURIComponent(text)}`;
    return `<div class="linkbox"><span>${esc(url)}</span><button class="btn ghost sm" data-copy="${esc(url)}">${ic('copy')}Kopieer</button></div>
      <div class="actions noprint" style="margin-top:10px">
        <a class="btn primary sm" href="https://wa.me/?text=${encodeURIComponent(text)}" target="_blank" rel="noopener">${ic('wa')}Stuur via WhatsApp</a>
        <a class="btn ghost sm" href="${esc(mail)}">${ic('mail')}Stuur per mail</a>
        <button class="btn ghost sm" data-copy="${esc(text)}">${ic('copy')}Kopieer bericht</button>
      </div>`;
  }
  $('newIntakeBtn').onclick = () => {
    openDrawer('Nieuwe intake-link', 'ONBOARDING', `<form id="ikForm" class="form-grid">
        <label class="lbl">Naam contactpersoon<input class="input" name="contact_name" autocomplete="off" required maxlength="160"></label>
        <label class="lbl">Bedrijf<input class="input" name="company" autocomplete="off" maxlength="160"></label>
        <label class="lbl full">E-mail (optioneel)<input class="input" type="email" name="email" autocomplete="off" maxlength="200"></label>
        <label class="lbl full">Persoonlijk bericht (optioneel)<textarea class="textarea" name="note" maxlength="1200" placeholder="Bijv. Leuk dat we gaan samenwerken! Wil je dit invullen vóór onze kick-off op donderdag?"></textarea></label>
        <div class="full" style="color:var(--faint);font-size:12.5px">Naam, bedrijf en e-mail staan alvast ingevuld voor de klant. Het bericht ziet de klant op het startscherm.</div>
        <div class="full"><button class="btn primary" type="submit">Maak link</button><div class="err" id="ikErr"></div></div>
      </form>`);
    setTimeout(() => { const f = $('drawerBody').querySelector('input'); if (f) f.focus(); }, 80);
  };
  $('drawerBody').addEventListener('submit', async e => {
    if (e.target.id === 'ikForm') {
      e.preventDefault();
      const fd = Object.fromEntries(new FormData(e.target));
      if (!fd.contact_name.trim() && !fd.company.trim()) { $('ikErr').textContent = 'Vul minstens een naam of bedrijf in.'; return; }
      const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
      try {
        const res = await api('/api/admin/intakes', { method: 'POST', body: JSON.stringify(fd) });
        await loadIntakes();
        if (page === 'intakes') renderIntakes();
        const it = D.intakes.find(i => i.id === res.id) || { ...fd, token: res.token, id: res.id };
        $('drawerTitle').textContent = 'Link staat klaar';
        $('drawerBody').innerHTML = `<p style="color:var(--muted);margin-bottom:14px">Stuur deze persoonlijke link naar ${esc(it.contact_name || it.company)}. Je ziet op de pagina Intakes wanneer de link geopend wordt en hoe ver ze zijn.</p>${shareBlock(it)}
          <div class="actions" style="margin-top:22px"><button class="btn ghost sm" data-ik="${it.id}">Bekijk intake</button></div>`;
      } catch (err) { $('ikErr').textContent = 'Aanmaken mislukt: ' + err.message; btn.disabled = false; }
    }
    if (e.target.id === 'ikEdit') {
      e.preventDefault();
      const id = Number(e.target.dataset.id);
      try { await api('/api/admin/intakes/' + id, { method: 'PATCH', body: JSON.stringify(Object.fromEntries(new FormData(e.target))) }); await loadIntakes(); if (page === 'intakes') renderIntakes(); toast('Opgeslagen'); }
      catch (err) { toast('Opslaan mislukt', true); }
    }
  });
  async function openIntake(id) {
    openDrawer('Intake', 'ONBOARDING', loading);
    let it;
    try { it = await api('/api/admin/intakes/' + id); } catch (err) { $('drawerBody').innerHTML = '<div class="empty">Kon deze intake niet laden.</div>'; return; }
    if (it.status === 'completed') markSeen(it.id);
    if (page === 'intakes') renderIntakes();
    $('drawerTitle').textContent = it.company || it.contact_name || 'Intake';
    const a = it.answers || {};
    const fileBtn = f => `<button data-file="${Number(f.id)}" data-fname="${esc(f.name)}">${ic('file')}${esc(f.name)}<small>${(f.size / 1024 / 1024).toFixed(1)} MB</small></button>`;
    const sections = INTAKE.sections.map(sec => `<div class="ans-sec"><h3>${esc(sec.title)}</h3><dl>` + sec.steps.flat().map(q => {
      if (q.type === 'file') {
        const fl = Array.isArray(a[q.id]) ? a[q.id] : [];
        return `<div class="ans"><dt>${esc(q.label)}</dt><dd>${fl.length ? `<div class="filelist">${fl.map(fileBtn).join('')}</div>` : '<span class="none">—</span>'}</dd></div>`;
      }
      const v = INTAKE.formatAnswer(q, a[q.id]);
      return `<div class="ans"><dt>${esc(q.label)}${q.required ? ' *' : ''}</dt><dd class="${v ? '' : 'none'}">${v ? esc(v) : '—'}</dd></div>`;
    }).join('') + '</dl></div>').join('');
    const linked = new Set(INTAKE.questions.filter(q => q.type === 'file').flatMap(q => (Array.isArray(a[q.id]) ? a[q.id] : []).map(f => Number(f.id))));
    const loose = (it.files || []).filter(f => !linked.has(Number(f.id)));
    $('drawerBody').innerHTML = `
      <div class="kv">
        <span>Status</span><b><span class="status st-${esc(it.status)}">${IK_STATUS[it.status] || esc(it.status)}</span> &nbsp;${it.progress}% ingevuld</b>
        <span>Contact</span><b>${esc(it.contact_name || '—')}${it.email ? ' · ' + esc(it.email) : ''}</b>
        <span>Aangemaakt</span><b>${esc(when(it.created_at))}${it.origin === 'link' ? ' · via algemene link' : ''}</b>
        <span>Geopend</span><b>${it.opened_at ? esc(when(it.opened_at)) + ' · ' + it.open_count + '×' : 'nog niet'}</b>
        ${it.completed_at ? `<span>Ingevuld</span><b>${esc(when(it.completed_at))}</b>` : it.updated_at && it.status === 'in_progress' ? `<span>Laatst actief</span><b>${esc(when(it.updated_at))}</b>` : ''}
      </div>
      ${it.status !== 'completed' ? `<div class="noprint" style="margin-bottom:22px">${shareBlock(it)}</div>` : ''}
      ${it.note ? `<div class="ans-sec"><h3>Jouw bericht aan de klant</h3><p style="white-space:pre-line">${esc(it.note)}</p></div>` : ''}
      ${sections}
      ${loose.length ? `<div class="ans-sec"><h3>Overige bestanden</h3><div class="filelist">${loose.map(fileBtn).join('')}</div></div>` : ''}
      <div class="actions noprint" style="margin:8px 0 24px">
        <button class="btn ghost sm" data-ik-act="print">${ic('print')}Print / PDF</button>
        ${it.status === 'completed' ? `<button class="btn ghost sm" data-ik-act="reopen" data-id="${it.id}">${ic('undo')}Heropenen voor aanpassingen</button>` : ''}
        <button class="btn ghost sm" data-ik-act="${it.archived ? 'unarchive' : 'archive'}" data-id="${it.id}">${ic('archive')}${it.archived ? 'Terug uit archief' : 'Archiveren'}</button>
        <button class="btn danger sm" data-ik-act="delete" data-id="${it.id}">${ic('trash')}Verwijderen</button>
      </div>
      <details class="noprint"><summary style="cursor:pointer;color:var(--muted);font-size:13px">Gegevens van de link bewerken</summary>
        <form id="ikEdit" data-id="${it.id}" class="form-grid" style="margin-top:12px">
          <label class="lbl">Naam<input class="input" name="contact_name" value="${esc(it.contact_name)}" maxlength="160"></label>
          <label class="lbl">Bedrijf<input class="input" name="company" value="${esc(it.company)}" maxlength="160"></label>
          <label class="lbl full">E-mail<input class="input" name="email" value="${esc(it.email)}" maxlength="200"></label>
          <label class="lbl full">Bericht aan de klant<textarea class="textarea" name="note" maxlength="1200">${esc(it.note)}</textarea></label>
          <div class="full"><button class="btn primary sm" type="submit">Opslaan</button></div>
        </form></details>`;
  }
  $('drawerBody').addEventListener('click', async e => {
    const f = e.target.closest('[data-file]');
    if (f) {
      try {
        const r = await fetch('/api/admin/intake-files/' + f.dataset.file, { headers: { Authorization: 'Bearer ' + token } });
        if (!r.ok) throw new Error();
        const url = URL.createObjectURL(await r.blob());
        const a = document.createElement('a'); a.href = url; a.download = f.dataset.fname || 'bestand';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch (err) { toast('Downloaden mislukt', true); }
      return;
    }
    const b = e.target.closest('[data-ik-act]');
    if (!b) return;
    const act = b.dataset.ikAct, id = Number(b.dataset.id);
    if (act === 'print') { window.print(); return; }
    try {
      if (act === 'delete') {
        if (!confirm('Deze intake met alle antwoorden en bestanden definitief verwijderen?')) return;
        await api('/api/admin/intakes/' + id, { method: 'DELETE' });
        closeDrawer(); toast('Intake verwijderd');
      } else if (act === 'reopen') {
        if (!confirm('Heropenen? De klant kan dan via dezelfde link antwoorden aanpassen en opnieuw versturen.')) return;
        await api('/api/admin/intakes/' + id, { method: 'PATCH', body: JSON.stringify({ reopen: true }) });
        toast('Heropend — de link werkt weer');
      } else {
        await api('/api/admin/intakes/' + id, { method: 'PATCH', body: JSON.stringify({ archived: act === 'archive' }) });
        toast(act === 'archive' ? 'Gearchiveerd' : 'Teruggezet');
      }
      await loadIntakes();
      if (page === 'intakes') renderIntakes();
      if (page === 'overzicht') renderOverview();
      if (act !== 'delete') openIntake(id);
    } catch (err) { toast('Dat lukte niet: ' + err.message, true); }
  });

  // ---------- global small actions ----------
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-go]');
    if (g) { go(g.dataset.go); return; }
    const c = e.target.closest('[data-copy]');
    if (c) { copy(c.dataset.copy); return; }
    if (e.target.closest('[data-copy-generic]')) copy(location.origin + '/start');
  });
  $('livePill').onclick = () => { go('overzicht'); setTimeout(() => $('liveCard').scrollIntoView({ behavior: 'smooth', block: 'center' }), 80); };

  // ---------- Portfolio ----------
  const CATS = { business: 'Bedrijfsvideo', social: 'Social content', 'brand-film': 'Brand film', 'real-estate': 'Vastgoed' };
  async function renderPortfolio() {
    if (!D.portfolio) {
      $('portfolioList').innerHTML = loading;
      try { await loadPortfolio(); } catch (e) { $('portfolioList').innerHTML = '<div class="empty">Kon het portfolio niet laden.</div>'; return; }
      setSub();
    }
    const rows = D.portfolio;
    $('pfCount').textContent = rows.length ? plural(rows.length, 'project', 'projecten') : '';
    $('portfolioList').innerHTML = rows.length ? rows.map(r => `<div class="pf${Number(r.published) ? '' : ' off'}" data-pid="${Number(r.id)}">
        <div>${r.thumb_url ? `<img class="poster${r.format === 'vertical' ? '' : ' h'}" src="${esc(r.thumb_url)}" alt="" loading="lazy">` : `<div class="poster${r.format === 'vertical' ? '' : ' h'}"></div>`}</div>
        <div>
          <div class="form-grid">
            <label class="lbl">Titel (NL)<input class="input" data-f="title_nl" value="${esc(r.title_nl)}"></label>
            <label class="lbl">Title (EN)<input class="input" data-f="title_en" value="${esc(r.title_en)}"></label>
            <label class="lbl">Categorie<select class="select" data-f="category">${Object.entries(CATS).map(([k, v]) => `<option value="${k}"${k === r.category ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
            <label class="lbl">Formaat<select class="select" data-f="format"><option value="horizontal"${r.format !== 'vertical' ? ' selected' : ''}>Horizontaal (16:9)</option><option value="vertical"${r.format === 'vertical' ? ' selected' : ''}>Verticaal (9:16)</option></select></label>
            <label class="lbl">Klant<input class="input" data-f="client" value="${esc(r.client || '')}"></label>
            <label class="lbl">Video-URL<input class="input" data-f="video_url" value="${esc(r.video_url || '')}"></label>
            <label class="lbl full">Thumbnail-URL<input class="input" data-f="thumb_url" value="${esc(r.thumb_url || '')}"></label>
            <label class="lbl">Beschrijving (NL)<textarea class="textarea" data-f="description_nl">${esc(r.description_nl || '')}</textarea></label>
            <label class="lbl">Description (EN)<textarea class="textarea" data-f="description_en">${esc(r.description_en || '')}</textarea></label>
            <label class="lbl">Volgorde<input class="input" type="number" data-f="sort_order" value="${Number(r.sort_order) || 0}"></label>
            <label class="lbl">Zichtbaar op de site<select class="select" data-f="published"><option value="1"${Number(r.published) ? ' selected' : ''}>Ja</option><option value="0"${Number(r.published) ? '' : ' selected'}>Nee (verborgen)</option></select></label>
          </div>
          <div class="actions" style="margin-top:12px">
            <button class="btn primary sm" data-pf-save>Opslaan</button>
            ${r.video_url ? `<a class="btn ghost sm" href="${esc(r.video_url)}" target="_blank" rel="noopener">${ic('ext')}Bekijk video</a>` : ''}
            <button class="btn danger sm" data-pf-del>${ic('trash')}Verwijderen</button>
          </div>
        </div>
      </div>`).join('') : '<div class="card empty">Nog geen projecten.</div>';
  }
  $('portfolioList').addEventListener('click', async e => {
    const card = e.target.closest('[data-pid]');
    if (!card) return;
    const id = card.dataset.pid;
    if (e.target.closest('[data-pf-save]')) {
      const btn = e.target.closest('[data-pf-save]'), body = {};
      card.querySelectorAll('[data-f]').forEach(el => { body[el.dataset.f] = el.dataset.f === 'published' || el.dataset.f === 'sort_order' ? Number(el.value) : el.value; });
      try { await api('/api/admin/portfolio/' + id, { method: 'PATCH', body: JSON.stringify(body) }); btn.textContent = 'Opgeslagen ✓'; setTimeout(() => { btn.textContent = 'Opslaan'; }, 1400); await loadPortfolio(); card.classList.toggle('off', !body.published); setSub(); }
      catch (err) { toast('Opslaan mislukt', true); }
    }
    if (e.target.closest('[data-pf-del]')) {
      if (!confirm('Dit project verwijderen van de site?')) return;
      try { await api('/api/admin/portfolio/' + id, { method: 'DELETE' }); await loadPortfolio(); renderPortfolio(); setSub(); toast('Project verwijderd'); }
      catch (err) { toast('Verwijderen mislukt', true); }
    }
  });
  $('addProject').onclick = async () => {
    $('addErr').textContent = '';
    const v = id => $(id).value.trim();
    const body = { title_en: v('np_title_en') || v('np_title_nl'), title_nl: v('np_title_nl') || v('np_title_en'), category: $('np_category').value, format: $('np_format').value,
      client: v('np_client'), video_url: v('np_video'), thumb_url: v('np_thumb'), description_en: v('np_desc_en'), description_nl: v('np_desc_nl') };
    if (!body.title_nl) { $('addErr').textContent = 'Geef het project een titel.'; return; }
    try {
      await api('/api/admin/portfolio', { method: 'POST', body: JSON.stringify(body) });
      ['np_title_en', 'np_title_nl', 'np_client', 'np_video', 'np_thumb', 'np_desc_en', 'np_desc_nl'].forEach(id => { $(id).value = ''; });
      await loadPortfolio(); renderPortfolio(); setSub(); toast('Project toegevoegd');
    } catch (err) { $('addErr').textContent = 'Toevoegen mislukt: ' + err.message; }
  };

  // reel uploads straight to R2 (signed URL), with an automatic still + format detection
  (function uploads() {
    const drop = $('upDrop'), input = $('upInput'), queue = $('upQueue');
    async function sign(kind, contentType) {
      const res = await fetch('/api/admin/uploads/sign', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ kind, contentType }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Serverfout ' + res.status);
      return res.json();
    }
    function grabThumb(file) {
      return new Promise((resolve, reject) => {
        const v = document.createElement('video'), url = URL.createObjectURL(file);
        let settled = false;
        const fail = m => { if (!settled) { settled = true; URL.revokeObjectURL(url); reject(new Error(m)); } };
        v.preload = 'metadata'; v.muted = true; v.playsInline = true; v.src = url;
        v.addEventListener('loadeddata', () => { v.currentTime = Math.min(1.2, (v.duration || 2) * 0.12); });
        v.addEventListener('seeked', () => {
          if (settled) return;
          try {
            const c = document.createElement('canvas');
            c.width = v.videoWidth; c.height = v.videoHeight;
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
            c.toBlob(blob => {
              settled = true; URL.revokeObjectURL(url);
              blob ? resolve({ blob, vertical: v.videoHeight >= v.videoWidth, width: v.videoWidth, height: v.videoHeight, duration: v.duration }) : reject(new Error('Kon geen still maken'));
            }, 'image/jpeg', 0.82);
          } catch (e) { fail('Kon geen still maken'); }
        });
        v.addEventListener('error', () => fail('Kan deze video niet lezen'));
        setTimeout(() => fail('Duurde te lang'), 30000);
      });
    }
    function put(url, blob, type, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url, true);
        xhr.setRequestHeader('Content-Type', type);
        xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload geweigerd (' + xhr.status + ')')));
        xhr.onerror = () => reject(new Error('Upload onderbroken'));
        xhr.send(blob);
      });
    }
    function addRow(name) {
      const el = document.createElement('div');
      el.style.cssText = 'border:1px solid var(--line-2);border-radius:8px;padding:10px 12px;font-size:13px';
      el.innerHTML = '<div style="display:flex;justify-content:space-between;gap:12px"><span class="nm" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></span><span class="st" style="font-family:var(--mono);font-size:11px;color:var(--muted)">wachten</span></div>' +
        '<div style="height:3px;background:var(--bg);border-radius:2px;margin-top:8px;overflow:hidden"><i style="display:block;height:100%;width:0;background:var(--amber);transition:width .2s"></i></div>';
      el.querySelector('.nm').textContent = name;
      queue.appendChild(el);
      return {
        state: t => { el.querySelector('.st').textContent = t; },
        progress: f => { el.querySelector('i').style.width = Math.round(f * 100) + '%'; },
        error: m => { el.style.borderColor = '#5a3330'; const s = el.querySelector('.st'); s.textContent = m; s.style.color = 'var(--bad)'; },
        done: () => setTimeout(() => el.remove(), 1500),
      };
    }
    async function uploadOne(file) {
      const row = addRow(file.name);
      try {
        row.state('still maken');
        const thumb = await grabThumb(file);
        // phones choke on 4K or very high bitrates (they stall or show a broken play icon)
        const mbps = thumb.duration ? file.size * 8 / thumb.duration / 1e6 : 0;
        const longSide = Math.max(thumb.width || 0, thumb.height || 0);
        if (longSide > 1920 || mbps > 16) {
          const ok = confirm(file.name + ' is te zwaar voor telefoons:\n' +
            '• ' + thumb.width + '×' + thumb.height + ', ' + Math.round(mbps) + ' Mbit/s, ' + Math.round(file.size / 1e6) + ' MB\n\n' +
            'Op mobiel laadt hij dan heel lang of speelt hij niet af.\n' +
            'Exporteer liever een webversie: 1080×1920 (of 1920×1080), H.264, 8–10 Mbit/s.\n\n' +
            'Toch deze versie uploaden?');
          if (!ok) throw new Error('Gestopt — upload een webversie (1080p, H.264, ±8 Mbit/s)');
        }
        row.state('uploaden');
        const vSlot = await sign('video', file.type || 'video/mp4');
        await put(vSlot.uploadUrl, file, vSlot.contentType, row.progress);
        row.state('still uploaden');
        const tSlot = await sign('thumb', 'image/jpeg');
        await put(tSlot.uploadUrl, thumb.blob, tSlot.contentType);
        row.state('opslaan');
        const title = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim() || 'Untitled';
        await api('/api/admin/portfolio', { method: 'POST', body: JSON.stringify({ title_en: title, title_nl: title, category: $('upCategory').value, client: $('upClient').value.trim(),
          video_url: vSlot.publicUrl, thumb_url: tSlot.publicUrl, format: thumb.vertical ? 'vertical' : 'horizontal' }) });
        row.state('klaar'); row.done();
        await loadPortfolio(); renderPortfolio(); setSub();
      } catch (err) { row.error(err.message); }
    }
    async function handleFiles(list) {
      for (const f of Array.from(list).filter(f => f.type.startsWith('video/'))) await uploadOne(f);
    }
    input.addEventListener('change', e => { handleFiles(e.target.files); input.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  })();

  // ---------- Instellingen ----------
  function renderSettings() { $('notrackToggle').classList.toggle('on', store.get('bmm_notrack', '') === '1'); }
  $('notrackToggle').onclick = () => {
    const on = store.get('bmm_notrack', '') !== '1';
    if (on) { store.set('bmm_notrack', '1'); store.set('bmm_notrack_pref', 'on'); }
    else { try { localStorage.removeItem('bmm_notrack'); } catch (e) {} store.set('bmm_notrack_pref', 'off'); }
    renderSettings();
    toast(on ? 'Je eigen bezoeken worden niet meer meegeteld' : 'Je eigen bezoeken tellen weer mee');
  };
  $('wipeBtn').onclick = async () => {
    if ($('wipeInput').value.trim() !== 'WISSEN') { toast('Typ eerst WISSEN', true); $('wipeInput').focus(); return; }
    try { await api('/api/admin/analytics', { method: 'DELETE', body: JSON.stringify({ confirm: 'WISSEN' }) }); $('wipeInput').value = ''; await loadAnalytics(); await loadLive(); toast('Statistieken gewist'); }
    catch (err) { toast('Wissen mislukt', true); }
  };
  const backupMsg = (t, bad) => { const el = $('backupMsg'); el.textContent = t; el.style.color = bad ? 'var(--bad)' : 'var(--amber-hi)'; };
  $('backupBtn').onclick = async () => {
    backupMsg('Bezig…');
    try {
      const data = await api('/api/admin/export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = `bmm-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      backupMsg(`Gedownload — ${(data.portfolio || []).length} projecten, ${(data.bookings || []).length} gesprekken, ${(data.leads || []).length} vragen, ${(data.intakes || []).length} intakes`);
    } catch (e) { backupMsg('Back-up mislukt', true); }
  };
  $('restoreBtn').onclick = () => $('restoreFile').click();
  $('restoreFile').onchange = async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    backupMsg('Bezig met terugzetten…');
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.portfolio)) { backupMsg('Geen portfolio in dit bestand', true); return; }
      const res = await api('/api/admin/restore', { method: 'POST', body: JSON.stringify({ portfolio: data.portfolio }) });
      backupMsg(`Teruggezet — ${res.added} toegevoegd, ${res.skipped} overgeslagen`);
      D.portfolio = null;
    } catch (err) { backupMsg('Terugzetten mislukt — is dit een geldig back-upbestand?', true); }
    finally { e.target.value = ''; }
  };

  // ---------- resize: redraw charts ----------
  let rzT, lastW = innerWidth;
  addEventListener('resize', () => {
    clearTimeout(rzT);
    rzT = setTimeout(() => { if (Math.abs(innerWidth - lastW) > 30 && PAGES[page][1] && D.an) { lastW = innerWidth; render(page); } }, 200);
  });

  // ---------- start ----------
  showApp(!!token);
})();

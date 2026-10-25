/* Brown Media — privacy-friendly site statistics.
   No cookies, nothing personal: which sections people see, what they click, how long they stay.
   Browsers that send Do Not Track or Global Privacy Control are not counted at all.
   A random id per browser tab (sessionStorage) ties one visit together. Your own visits can be
   excluded with ?notrack=1 (or automatically after logging in to the admin panel). */
(function () {
  'use strict';
  var w = window, d = document;
  var noop = function () {};
  w.bmmTrack = noop;
  try {
    if (/[?&]notrack=1/.test(location.search)) localStorage.setItem('bmm_notrack', '1');
    if (/[?&]notrack=0/.test(location.search)) localStorage.removeItem('bmm_notrack');
    if (localStorage.getItem('bmm_notrack') === '1') return;
  } catch (e) {}
  if (navigator.webdriver && !/[?&]bmmtest=1/.test(location.search)) return;   // automated browsers
  // the visitor's browser says "don't track me" (Global Privacy Control / Do Not Track): then we don't
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || w.doNotTrack === '1' || navigator.msDoNotTrack === '1') return;

  var sid;
  try { sid = sessionStorage.getItem('bmm_sid'); } catch (e) {}
  if (!sid || !/^[a-z0-9]{8,32}$/i.test(sid)) {
    sid = (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).slice(0, 20);
    try { sessionStorage.setItem('bmm_sid', sid); } catch (e) {}
  }
  w.bmmSid = sid;

  // utm parameters of the landing page stay with the visit
  var utm = {};
  try {
    var sp = new URLSearchParams(location.search);
    if (sp.get('utm_source')) {
      utm = { s: sp.get('utm_source'), m: sp.get('utm_medium') || '', c: sp.get('utm_campaign') || '' };
      sessionStorage.setItem('bmm_utm', JSON.stringify(utm));
    } else utm = JSON.parse(sessionStorage.getItem('bmm_utm') || '{}');
  } catch (e) {}
  var ref = '';
  try { ref = sessionStorage.getItem('bmm_ref'); if (ref === null) { ref = d.referrer || ''; sessionStorage.setItem('bmm_ref', ref); } } catch (e) { ref = d.referrer || ''; }

  var queue = [], t0 = Date.now(), maxScroll = 0, sent = 0;
  function send(beacon) {
    if (!queue.length || sent > 400) return;
    var events = queue.splice(0, 60);
    sent += events.length;
    var body = JSON.stringify({ v: 1, sid: sid, p: location.pathname, r: ref, w: screen.width, l: d.documentElement.lang || '', u: utm, e: events });
    try {
      if (beacon && navigator.sendBeacon && navigator.sendBeacon('/api/t', new Blob([body], { type: 'text/plain' }))) return;
      fetch('/api/t', { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(noop);
    } catch (e) {}
  }
  // clicks, video-check answers and conversions go out right away (batched over 300 ms),
  // so they aren't lost when someone leaves the page a moment later
  var soon = 0;
  function track(type, section, label, extra) {
    queue.push({ t: type, s: section || '', l: String(label || '').replace(/\s+/g, ' ').trim().slice(0, 90), x: extra == null ? '' : String(extra).slice(0, 150) });
    if (queue.length >= 25) send(false);
    else if ((type === 'ck' || type === 'cv' || type === 'qz') && !soon) soon = setTimeout(function () { soon = 0; send(false); }, 300);
  }
  w.bmmTrack = track;

  function sectionOf(el) {
    if (!el || !el.closest) return '';
    var s = el.closest('section[id]');
    if (s) return s.id;
    if (el.closest('nav')) return 'nav';
    if (el.closest('footer')) return 'footer';
    if (el.closest('.wa-float, #mCta')) return 'zwevend';
    if (el.closest('#lightbox')) return 'videospeler';
    return 'overig';
  }

  track('pv', '', d.title);

  // which sections are seen: crossing the middle band of the screen counts as "seen"
  var seen = {};
  if ('IntersectionObserver' in w) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting && !seen[en.target.id]) { seen[en.target.id] = 1; track('sv', en.target.id); }
      });
    }, { rootMargin: '-35% 0px -35% 0px', threshold: 0 });
    var watch = function () { d.querySelectorAll('section[id]').forEach(function (s) { io.observe(s); }); };
    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', watch); else watch();
  }

  // clicks on links/buttons (never anything typed in a form)
  d.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('[data-track], a, button, summary, [role="button"], .chips label, .intent label');
    if (!el || el.closest('[data-notrack]')) return;
    var label = el.getAttribute('data-track') || el.getAttribute('aria-label') || el.innerText || el.textContent || el.getAttribute('title') || '';
    var href = el.getAttribute('href') || '';
    var host = '';
    if (/^https?:/i.test(href)) { try { host = new URL(href).hostname.replace(/^www\./, ''); } catch (er) {} }
    else if (/^(mailto|tel):/i.test(href)) host = href.split(':')[0];
    track('ck', sectionOf(el), label, host);
    // a link that leaves this page in the same tab: send now, there is no "later"
    if (href && !/^#/.test(href) && el.getAttribute('target') !== '_blank') send(true);
  }, true);

  addEventListener('scroll', function () {
    var h = d.documentElement.scrollHeight - innerHeight;
    if (h > 0) maxScroll = Math.max(maxScroll, Math.round(scrollY / h * 100));
  }, { passive: true });

  setInterval(function () { send(false); }, 5000);
  var left = false;
  function leave() {
    if (left) return;
    left = true;
    track('lv', '', '', Math.round((Date.now() - t0) / 1000) + '|' + maxScroll);
    send(true);
  }
  addEventListener('pagehide', leave);
  d.addEventListener('visibilitychange', function () {
    if (d.visibilityState === 'hidden') { send(true); }
    else if (left) { left = false; }   // came back to the tab
  });
})();

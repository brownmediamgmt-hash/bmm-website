/* Brown Media — cookie consent + Meta pixel.
   The Meta pixel (advertising cookies) only loads after the visitor clicks "Accept".
   "Decline" is just as easy and is remembered too. Browsers that send Global Privacy Control
   count as "decline" and never see the banner. The choice lives in localStorage ("bmm_consent")
   and can be changed any time via window.bmmConsent.open() (footer link "Cookies"). */
(function () {
  'use strict';
  var w = window, d = document;
  var PIXEL_ID = '1810035896907327';
  var KEY = 'bmm_consent';
  var TXT = {
    nl: { text: 'Deze website gebruikt cookies om onze advertenties te verbeteren.',
          more: 'Meer info', yes: 'Accepteren', no: 'Weigeren', label: 'Cookies' },
    en: { text: 'This website uses cookies to improve our advertising.',
          more: 'More info', yes: 'Accept', no: 'Decline', label: 'Cookies' }
  };

  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) {} }
  function lang() { return (d.documentElement.lang || 'nl').slice(0, 2) === 'en' ? 'en' : 'nl'; }

  // ---------- Meta pixel (only after consent) ----------
  var loaded = false;
  function loadPixel() {
    if (loaded) return; loaded = true;
    /* official Meta base code */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(w,d,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    w.fbq('init', PIXEL_ID);
    w.fbq('track', 'PageView');
  }
  // events from the page (form sent, WhatsApp click): only reach Meta with consent
  w.bmmAd = function (event, params) { if (loaded && w.fbq) w.fbq('track', event, params || {}); };
  d.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href*="wa.me/"], .wa-link');
    if (a) w.bmmAd('Contact', { content_name: 'WhatsApp' });
    // any element with data-cookie-settings reopens the banner (footer link, privacy page button)
    var c = e.target.closest && e.target.closest('[data-cookie-settings]');
    if (c) { e.preventDefault(); open(); }
  }, true);

  // ---------- banner ----------
  var css = '#bmmCookie{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:560px;margin:0 auto;' +
    'background:var(--paper,#1A1712);color:var(--ink,#F4EFE5);border-radius:14px;padding:18px 20px;box-shadow:0 12px 40px rgba(0,0,0,.25);' +
    'font:14px/1.5 var(--body,system-ui,sans-serif)}' +
    '#bmmCookie p{margin:0 0 14px}#bmmCookie a{color:var(--amber-dim,#C9A468)}' +
    '#bmmCookie .row{display:flex;gap:10px}#bmmCookie button{flex:1;min-height:44px;border-radius:999px;cursor:pointer;' +
    'font:600 14px var(--body,system-ui,sans-serif);border:1.5px solid var(--amber,#B97C2E)}' +
    '#bmmCookie .y{background:var(--amber,#B97C2E);color:#fff}#bmmCookie .n{background:transparent;color:var(--ink,#F4EFE5)}' +
    '#bmmCookie button:focus-visible{outline:2px solid var(--amber-dim,#C9A468);outline-offset:2px}';
  var box = null;
  function render() {
    if (!box) return;
    var t = TXT[lang()];
    box.setAttribute('aria-label', t.label);
    box.innerHTML = '<p>' + t.text + ' <a href="/privacy#cookies">' + t.more + '</a></p>' +
      '<div class="row"><button type="button" class="n" data-c="no">' + t.no + '</button>' +
      '<button type="button" class="y" data-c="yes">' + t.yes + '</button></div>';
  }
  function close() { if (box) { box.remove(); box = null; } }
  function open() {
    if (box) return;
    if (!d.getElementById('bmmCookieCss')) { var s = d.createElement('style'); s.id = 'bmmCookieCss'; s.textContent = css; d.head.appendChild(s); }
    box = d.createElement('div'); box.id = 'bmmCookie'; box.setAttribute('role', 'dialog');
    render();
    box.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-c]'); if (!b) return;
      var v = b.getAttribute('data-c');
      var was = get();
      set(v); close();
      if (v === 'yes') loadPixel();
      else if (was === 'yes') location.reload();   // drop the pixel that is already running
    });
    d.body.appendChild(box);
  }
  w.bmmConsent = { open: open, get: get };

  // the banner follows the NL/EN switch
  if ('MutationObserver' in w) new MutationObserver(render).observe(d.documentElement, { attributes: true, attributeFilter: ['lang'] });

  var choice = get();
  if (choice === 'yes') loadPixel();
  else if (choice !== 'no' && navigator.globalPrivacyControl !== true) open();
})();

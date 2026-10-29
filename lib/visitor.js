// Visitor helpers: real client IP, offline geolocation, device/browser, traffic source.
// No IP address is ever stored — only the derived country / province / city.
const geoip = require('geoip-lite');

const NL_PROVINCES = {
  DR: 'Drenthe', FL: 'Flevoland', FR: 'Friesland', GE: 'Gelderland', GR: 'Groningen', LI: 'Limburg',
  NB: 'Noord-Brabant', NH: 'Noord-Holland', OV: 'Overijssel', UT: 'Utrecht', ZE: 'Zeeland', ZH: 'Zuid-Holland',
};

// Render sits behind Cloudflare: cf-connecting-ip is set by Cloudflare and can't be spoofed by the visitor.
function clientIp(req) {
  const h = req.headers;
  const ip = h['cf-connecting-ip'] || h['true-client-ip'] ||
    String(h['x-forwarded-for'] || '').split(',')[0] || (req.socket && req.socket.remoteAddress) || '';
  return String(ip).trim().replace(/^::ffff:/, '');
}

function locate(req) {
  const ip = clientIp(req);
  const r = ip ? geoip.lookup(ip) : null;
  const headerCountry = String(req.headers['cf-ipcountry'] || '').toUpperCase();
  if (!r) {
    return { country: /^[A-Z]{2}$/.test(headerCountry) && headerCountry !== 'XX' ? headerCountry : '', region: '', city: '', lat: null, lon: null };
  }
  const ll = Array.isArray(r.ll) ? r.ll : [];
  return {
    country: r.country || '',
    region: r.region || '',
    city: r.city || '',
    lat: typeof ll[0] === 'number' ? Math.round(ll[0] * 100) / 100 : null,
    lon: typeof ll[1] === 'number' ? Math.round(ll[1] * 100) / 100 : null,
  };
}

const BOT_RE = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python|go-http|axios|node-fetch|monitor|uptime|pingdom|semrush|ahrefs|bytespider|petalbot|gptbot|claudebot|ccbot/i;

function parseUA(ua) {
  ua = String(ua || '');
  const isBot = !ua || BOT_RE.test(ua);
  let device = 'desktop';
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) device = 'tablet';
  else if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(ua)) device = 'mobile';
  let browser = 'Anders';
  if (/Instagram/i.test(ua)) browser = 'Instagram (app)';
  else if (/FBAN|FBAV|FB_IAB/i.test(ua)) browser = 'Facebook (app)';
  else if (/LinkedInApp/i.test(ua)) browser = 'LinkedIn (app)';
  else if (/TikTok|BytedanceWebview|musical_ly/i.test(ua)) browser = 'TikTok (app)';
  else if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox|FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/Chrome|CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Safari/i.test(ua)) browser = 'Safari';
  let os = 'Anders';
  if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/Windows/i.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  return { isBot, device, browser, os };
}

// Where did the visit come from? Paid Meta clicks first (utm tags on the ads), then utm_source, the referrer, in-app browsers.
const META_RE = /^(meta|meta_ads|fb_ads|ig_ads|facebook_ads|instagram_ads)$/;
const PAID_RE = /^(paid|paid_social|paidsocial|cpc|ppc|ads?|cpm)$/;
const SOURCE_RULES = [
  [/(^|\.)instagram\.com$|^l\.instagram\.com$/, 'Instagram'],
  [/(^|\.)facebook\.com$|^fb\.me$|^l\.facebook\.com$|^lm\.facebook\.com$/, 'Facebook'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'LinkedIn'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'YouTube'],
  [/(^|\.)google\.[a-z.]+$/, 'Google'],
  [/(^|\.)bing\.com$/, 'Bing'],
  [/(^|\.)duckduckgo\.com$/, 'DuckDuckGo'],
  [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, 'ChatGPT'],
  [/(^|\.)perplexity\.ai$/, 'Perplexity'],
  [/(^|\.)claude\.ai$/, 'Claude'],
  [/(^|\.)whatsapp\.com$|^wa\.me$/, 'WhatsApp'],
  [/(^|\.)t\.co$|(^|\.)x\.com$|(^|\.)twitter\.com$/, 'X / Twitter'],
  [/(^|\.)trustoo\.nl$/, 'Trustoo'],
];
const OWN_HOST_RE = /(^|\.)brown-media\.nl$|^localhost$|^127\.0\.0\.1$|onrender\.com$/;

function trafficSource({ ref, utmSource, utmMedium, browser }) {
  const utm = String(utmSource || '').trim().toLowerCase();
  const medium = String(utmMedium || '').trim().toLowerCase();
  if (META_RE.test(utm) || (PAID_RE.test(medium) && /^(ig|fb|instagram|facebook|meta)/.test(utm))) return 'Meta Ads';
  if (utm) {
    for (const [re, name] of SOURCE_RULES) if (re.test(utm) || utm.includes(name.toLowerCase())) return name;
    if (utm === 'ig') return 'Instagram';
    if (utm === 'fb') return 'Facebook';
    return utm.slice(0, 40);
  }
  let host = '';
  try { host = new URL(ref).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { host = ''; }
  if (/^android-app:\/\/com\.instagram/i.test(ref)) return 'Instagram';
  if (host && !OWN_HOST_RE.test(host)) {
    for (const [re, name] of SOURCE_RULES) if (re.test(host)) return name;
    return host.slice(0, 60);
  }
  if (/\(app\)$/.test(browser || '')) return browser.replace(' (app)', '');
  return 'Direct';
}

const regionNames = (() => { try { return new Intl.DisplayNames(['nl'], { type: 'region' }); } catch (e) { return null; } })();
const countryName = code => { if (!code) return 'Onbekend'; try { return (regionNames && regionNames.of(code)) || code; } catch (e) { return code; } };

module.exports = { clientIp, locate, parseUA, trafficSource, countryName, NL_PROVINCES };

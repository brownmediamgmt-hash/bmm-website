// Brown Media Management — server
// Uses Postgres when DATABASE_URL is set (production on Render),
// otherwise falls back to local SQLite for development.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { clientIp, locate, parseUA, countryName, NL_PROVINCES } = require('./lib/visitor');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const USE_PG = !!process.env.DATABASE_URL;

// --- Email notifications (optional) ---
// Email notifications via Resend HTTP API (works on Render where SMTP is blocked).
// Set RESEND_API_KEY and NOTIFY_EMAIL env vars to enable.
// Every lead goes to NOTIFY_EMAIL plus NOTIFY_EMAIL_EXTRA (comma-separated; defaults to both inboxes).
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL;
const NOTIFY_EMAIL_EXTRA = process.env.NOTIFY_EMAIL_EXTRA ?? 'brownmediamgmt@gmail.com,info@brown-media.nl';
const NOTIFY_TO = [...new Set([NOTIFY_EMAIL, NOTIFY_EMAIL_EXTRA].filter(Boolean).join(',')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean))];
// Sender must be on a Resend-verified domain. brown-media.nl is verified.
const NOTIFY_FROM = process.env.NOTIFY_FROM || 'Brown Media Management <info@brown-media.nl>';

// replyTo = the lead's address, so hitting "reply" in your mail app answers the lead directly
async function notify(subject, lines, replyTo) {
  if (!RESEND_API_KEY || !NOTIFY_TO.length) return;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: NOTIFY_TO,
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject,
        text: lines.filter(l => l !== null && l !== undefined && l !== false).join('\n'),
      }),
    });
    if (res.ok) {
      console.log('Email notify sent:', subject);
    } else {
      const body = await res.text();
      console.error('Email notify failed:', res.status, body.slice(0, 300));
    }
  } catch (err) {
    console.error('Email notify failed:', err.message);
  }
}
const SERVICE_LABELS = { business: 'Bedrijfsvideo', social: 'Social content', 'brand-film': 'Brand films', 'real-estate': 'Vastgoed', other: 'Anders' };
const serviceLabel = (s) => SERVICE_LABELS[s] || s;
// Dutch mobile numbers (06…) → wa.me/316…
const waLink = (phone) => `https://wa.me/${String(phone).replace(/\D/g, '').replace(/^00/, '').replace(/^0(?=6)/, '31')}`;

// ============================================================
//  Database abstraction — same query(sql, params) interface
//  for Postgres (prod) and SQLite (local dev). Queries use
//  $1,$2 placeholders; translated to ? for SQLite.
// ============================================================
let db;

async function initDB() {
  if (USE_PG) {
    const { Pool } = require('pg');
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
    });
    db = {
      async query(sql, params = []) {
        const r = await pool.query(sql, params);
        return { rows: r.rows };
      },
    };
    console.log('Database: Postgres');
  } else {
    const { DatabaseSync } = require('node:sqlite');
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'bmm.db');
    require('fs').mkdirSync(path.dirname(DB_PATH), { recursive: true });
    const sq = new DatabaseSync(DB_PATH);
    const toQ = sql => sql.replace(/\$(\d+)/g, '?$1');   // numbered, so one parameter can be used twice
    db = {
      async query(sql, params = []) {
        const isSelect = /^\s*select/i.test(sql) || /returning/i.test(sql);
        const s = toQ(sql);
        if (isSelect) return { rows: sq.prepare(s).all(...params) };
        sq.prepare(s).run(...params);
        return { rows: [] };
      },
    };
    console.log('Database: SQLite (local dev)');
  }

  const idType = USE_PG ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const now = USE_PG ? 'NOW()' : "(datetime('now'))";

  await db.query(`CREATE TABLE IF NOT EXISTS leads (
    id ${idType}, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT, company TEXT,
    service TEXT, message TEXT, lang TEXT, status TEXT DEFAULT 'new',
    created_at TIMESTAMP DEFAULT ${now})`);
  await db.query(`CREATE TABLE IF NOT EXISTS bookings (
    id ${idType}, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT,
    service TEXT NOT NULL, preferred_date TEXT NOT NULL, location TEXT, details TEXT,
    lang TEXT, status TEXT DEFAULT 'pending', created_at TIMESTAMP DEFAULT ${now})`);
  await db.query(`CREATE TABLE IF NOT EXISTS portfolio (
    id ${idType}, title_en TEXT NOT NULL, title_nl TEXT NOT NULL, category TEXT NOT NULL,
    client TEXT, video_url TEXT, thumb_url TEXT, description_en TEXT, description_nl TEXT,
    sort_order INTEGER DEFAULT 0, published INTEGER DEFAULT 1, format TEXT DEFAULT 'horizontal',
    created_at TIMESTAMP DEFAULT ${now})`);
  await db.query(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, created_at TIMESTAMP DEFAULT ${now})`);

  try { await db.query("ALTER TABLE portfolio ADD COLUMN format TEXT DEFAULT 'horizontal'"); } catch (e) { /* exists */ }

  // visitor context on leads & bookings (which visit they came from, where from, which device) + your own notes
  const addCol = async (table, col, type) => {
    if (USE_PG) await db.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${col} ${type}`);
    else { try { await db.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch (e) { /* exists */ } }
  };
  for (const t of ['leads', 'bookings']) {
    for (const c of ['sid', 'source', 'traffic', 'country', 'region', 'city', 'device', 'note']) await addCol(t, c, 'TEXT');
  }
  await db.query('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');
  // admin logins stay valid for 30 days
  await db.query(USE_PG ? "DELETE FROM sessions WHERE created_at < NOW() - INTERVAL '30 days'" : "DELETE FROM sessions WHERE created_at < datetime('now','-30 days')");
  await analytics.init(db);
  await intake.init(db);
  await privacy.init(db);
  await meta.init(db);

  const { rows } = await db.query('SELECT COUNT(*) AS c FROM portfolio');
  if (Number(rows[0].c) === 0) {
    const seed = [
      ['Company Story — Local Business', 'Bedrijfsvideo — Lokale Onderneming', 'business', '', 'Corporate video built around one message: why customers choose them.', 'Bedrijfsvideo gebouwd rond één boodschap: waarom klanten voor hen kiezen.', 1],
      ['Monthly Content Pack — 12 Reels', 'Maandpakket Content — 12 Reels', 'social', '', 'Monthly social content production: hooks, captions, delivery.', 'Maandelijkse social content productie: hooks, captions, oplevering.', 2],
      ['Interior Reveal — LUXV Design Studio', 'Interieur Reveal — LUXV Design Studio', 'brand-film', 'LUXV Design Studio', 'Design-led interior film with motion-matched transitions.', 'Designgerichte interieurfilm met motion-matched overgangen.', 3],
      ['Canal-side Apartment — Groningen', 'Grachtenappartement — Groningen', 'real-estate', '', 'Cinematic walkthrough, 60s vertical + 90s horizontal cut.', 'Cinematische walkthrough, 60s verticaal + 90s horizontaal.', 4],
    ];
    for (const s of seed) {
      await db.query(
        `INSERT INTO portfolio (title_en,title_nl,category,client,description_en,description_nl,sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`, s);
    }
    console.log('Seeded placeholder portfolio items');
  }
}

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
// basic security headers (AVG art. 32: appropriate security)
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (/^\/(admin|api\/admin)/.test(req.path)) res.set('Cache-Control', 'no-store');
  next();
});
// backup files can be large — allow more only on the restore endpoint
app.use('/api/admin/restore', express.json({ limit: '8mb' }));
// intake file uploads (base64) are bigger than the global 200kb JSON limit
app.use(/^\/api\/intake\/[^/]+\/files$/, express.json({ limit: '15mb' }));
// Meta lead webhook: keep the raw body so its signature can be checked
app.use('/api/meta/webhook', express.raw({ type: () => true, limit: '1mb' }));
app.use(express.json({ limit: '200kb' }));
const createUploadsRouter = require('./r2-uploads-router');
app.use(createUploadsRouter({ requireAuth }));
app.use(express.static(path.join(__dirname, 'public')));

const clean = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const h = fn => (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'De database is tijdelijk niet beschikbaar. Probeer het later opnieuw of mail info@brown-media.nl.' });
  return fn(req, res).catch(err => { console.error(err); res.status(500).json({ error: 'server error' }); });
};

async function requireAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    const { rows } = await db.query('SELECT token FROM sessions WHERE token = $1', [token]);
    if (!rows.length) return res.status(401).json({ error: 'unauthorized' });
    next();
  } catch (err) { console.error(err); res.status(500).json({ error: 'server error' }); }
}

// Per visitor (real client IP behind Render/Cloudflare) and per kind of request.
// Proxy headers can be forged by someone calling the server directly, so sensitive
// buckets also get a cap for all visitors together (globalMax).
const hits = new Map();
function rateLimit(bucket, max, globalMax) {
  return (req, res, next) => {
    const now = Date.now();
    const keys = [bucket + '|' + (clientIp(req) || 'x')];
    if (globalMax) keys.push(bucket + '|*');
    const lists = keys.map(k => (hits.get(k) || []).filter(t => now - t < 60_000));
    if (lists[0].length >= max || (globalMax && lists[1].length >= globalMax)) return res.status(429).json({ error: 'too many requests' });
    keys.forEach((k, i) => { lists[i].push(now); hits.set(k, lists[i]); });
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, arr] of hits) if (!arr.some(t => now - t < 60_000)) hits.delete(k); }, 300_000).unref();

const getDb = () => db;
const settingsCache = new Map();
async function getSetting(key) {
  if (settingsCache.has(key)) return settingsCache.get(key);
  const { rows } = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
  let value = rows[0] && rows[0].value;
  if (!value && key === 'analytics_secret') {
    value = crypto.randomBytes(32).toString('hex');
    await db.query('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
  }
  settingsCache.set(key, value || '');
  return value || '';
}
async function setSetting(key, value) {
  await db.query('DELETE FROM settings WHERE key = $1', [key]);
  await db.query('INSERT INTO settings (key, value) VALUES ($1, $2)', [key, value]);
  settingsCache.set(key, value);
}
const analytics = require('./analytics')({ app, getDb, h, requireAuth, rateLimit, USE_PG, getSetting });
const intake = require('./intake')({ app, getDb, h, requireAuth, rateLimit, USE_PG, notify });
const privacy = require('./privacy')({ app, getDb, h, requireAuth, rateLimit, USE_PG });
const meta = require('./meta')({ app, getDb, h, requireAuth, rateLimit, USE_PG, notify, getSetting, setSetting, waLink, dayKey: analytics.dayKey });

// who is this lead? (location, device, and — via the visit — source and what they looked at)
async function visitorContext(req, sid) {
  const geo = locate(req);
  const ua = parseUA(req.headers['user-agent']);
  const visit = await analytics.sessionSummary(sid).catch(() => null);
  const place = geo.country === 'NL'
    ? [geo.city, NL_PROVINCES[geo.region]].filter(Boolean).join(', ')
    : [geo.city, countryName(geo.country)].filter(Boolean).join(', ');
  const deviceNl = { mobile: 'telefoon', tablet: 'tablet', desktop: 'computer' }[ua.device] || ua.device;
  const line = ['Bezoeker: ' + (place || 'locatie onbekend'), deviceNl, visit && visit.src ? 'via ' + visit.src : null].filter(Boolean).join(' · ');
  return { geo, ua, visit, line };
}
const sidOf = v => (typeof v === 'string' && /^[a-z0-9]{8,32}$/i.test(v) ? v : '');

// ---------- public API ----------
app.get('/api/portfolio', h(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM portfolio WHERE published = 1 ORDER BY sort_order, id DESC');
  res.json(rows);
}));

app.post('/api/contact', rateLimit('form', 10, 120), h(async (req, res) => {
  const { name, email, phone, company, service, message, lang } = req.body || {};
  const n = clean(name, 120), e = clean(email, 200);
  if (!n || !validEmail(e)) return res.status(400).json({ error: 'name and valid email required' });
  const sid = sidOf(req.body && req.body.sid);
  const source = /^VIDEO-CHECK/.test(clean(message)) ? 'quiz' : (clean(req.body && req.body.source, 20) || 'form');
  const ctx = await visitorContext(req, sid);
  await db.query(`INSERT INTO leads (name,email,phone,company,service,message,lang,sid,source,traffic,country,region,city,device)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [n, e, clean(phone, 40), clean(company, 160), clean(service, 60), clean(message), clean(lang, 5),
     sid, source, ctx.visit ? ctx.visit.src : '', ctx.geo.country, ctx.geo.region, ctx.geo.city, ctx.ua.device]);
  notify(source === 'quiz' ? `🎯 Video-check advies aangevraagd: ${n}` : `💬 Nieuwe vraag via de website: ${n}`, [
    `Naam: ${n}`, `E-mail: ${e}`, phone ? `Telefoon: ${clean(phone, 40)}` : null,
    phone ? `WhatsApp: ${waLink(phone)}` : null,
    company ? `Bedrijf: ${clean(company, 160)}` : null, service ? `Onderwerp: ${serviceLabel(service)}` : null,
    '', `Vraag:`, clean(message),
    '', ctx.line,
    '', 'Beantwoorden: klik op "Beantwoorden" in je mail, of open je admin panel → Aanvragen',
  ], e);
  res.json({ ok: true });
}));

app.post('/api/bookings', rateLimit('form', 10, 120), h(async (req, res) => {
  const { name, email, phone, service, preferred_date, location, details, lang } = req.body || {};
  const n = clean(name, 120), e = clean(email, 200), s = clean(service, 60), d = clean(preferred_date, 30);
  if (!n || !validEmail(e) || !s || !d) return res.status(400).json({ error: 'name, valid email, service and date required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  const sid = sidOf(req.body && req.body.sid);
  const ctx = await visitorContext(req, sid);
  await db.query(`INSERT INTO bookings (name,email,phone,service,preferred_date,location,details,lang,sid,source,traffic,country,region,city,device)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [n, e, clean(phone, 40), s, d, clean(location, 200), clean(details), clean(lang, 5),
     sid, 'form', ctx.visit ? ctx.visit.src : '', ctx.geo.country, ctx.geo.region, ctx.geo.city, ctx.ua.device]);
  notify(`🎬 Nieuwe gespreksaanvraag: ${n} — ${d}`, [
    `Naam: ${n}`, `E-mail: ${e}`, phone ? `Telefoon: ${clean(phone, 40)}` : null,
    phone ? `WhatsApp: ${waLink(phone)}` : null,
    `Dienst: ${serviceLabel(s)}`, `Voorkeursdatum: ${d}`, location ? `Locatie: ${clean(location, 200)}` : null,
    '', `Details:`, clean(details),
    '', ctx.line,
    '', 'Bevestigen of afwijzen: open je admin panel → Aanvragen',
  ], e);
  res.json({ ok: true });
}));

// ---------- admin auth ----------
app.post('/api/admin/login', rateLimit('login', 8, 40), h(async (req, res) => {
  const { password } = req.body || {};
  const ok = typeof password === 'string' &&
    password.length === ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(ADMIN_PASSWORD));
  if (!ok) return res.status(401).json({ error: 'wrong password' });
  const token = crypto.randomBytes(32).toString('hex');
  await db.query('INSERT INTO sessions (token) VALUES ($1)', [token]);
  res.json({ token });
}));

app.post('/api/admin/logout', requireAuth, h(async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  await db.query('DELETE FROM sessions WHERE token = $1', [token]);
  res.json({ ok: true });
}));

// ---------- admin: leads & bookings ----------
app.get('/api/admin/leads', requireAuth, h(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM leads ORDER BY id DESC');
  res.json(rows);
}));
app.patch('/api/admin/leads/:id', requireAuth, h(async (req, res) => {
  const b = req.body || {};
  if (b.status !== undefined) {
    const status = clean(b.status, 20);
    if (!['new', 'contacted', 'won', 'lost'].includes(status)) return res.status(400).json({ error: 'bad status' });
    await db.query('UPDATE leads SET status = $1 WHERE id = $2', [status, Number(req.params.id)]);
  }
  if (b.note !== undefined) await db.query('UPDATE leads SET note = $1 WHERE id = $2', [clean(b.note, 4000), Number(req.params.id)]);
  res.json({ ok: true });
}));
app.delete('/api/admin/leads/:id', requireAuth, h(async (req, res) => {
  await db.query('DELETE FROM leads WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
}));

app.get('/api/admin/bookings', requireAuth, h(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM bookings ORDER BY preferred_date ASC, id DESC');
  res.json(rows);
}));
app.patch('/api/admin/bookings/:id', requireAuth, h(async (req, res) => {
  const b = req.body || {};
  if (b.status !== undefined) {
    const status = clean(b.status, 20);
    if (!['pending', 'confirmed', 'declined', 'done'].includes(status)) return res.status(400).json({ error: 'bad status' });
    await db.query('UPDATE bookings SET status = $1 WHERE id = $2', [status, Number(req.params.id)]);
  }
  if (b.note !== undefined) await db.query('UPDATE bookings SET note = $1 WHERE id = $2', [clean(b.note, 4000), Number(req.params.id)]);
  res.json({ ok: true });
}));
app.delete('/api/admin/bookings/:id', requireAuth, h(async (req, res) => {
  await db.query('DELETE FROM bookings WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
}));

// ---------- admin: backup export / restore ----------
app.get('/api/admin/export', requireAuth, h(async (req, res) => {
  const [portfolio, bookings, leads, intakes] = await Promise.all([
    db.query('SELECT * FROM portfolio ORDER BY sort_order, id'),
    db.query('SELECT * FROM bookings ORDER BY id'),
    db.query('SELECT * FROM leads ORDER BY id'),
    db.query('SELECT id,token,contact_name,company,email,note,origin,status,answers,progress,created_at,opened_at,updated_at,completed_at FROM intakes ORDER BY id')
  ]);
  res.json({
    exported_at: new Date().toISOString(),
    version: 2,
    portfolio: portfolio.rows,
    bookings: bookings.rows,
    leads: leads.rows,
    intakes: intakes.rows
  });
}));

// Restore portfolio items from a backup file. Adds items; does not delete existing ones.
app.post('/api/admin/restore', requireAuth, h(async (req, res) => {
  const items = (req.body && Array.isArray(req.body.portfolio)) ? req.body.portfolio : null;
  if (!items) return res.status(400).json({ error: 'backup file must contain a "portfolio" array' });
  let added = 0, skipped = 0;
  for (const it of items) {
    const t_en = clean(it.title_en, 200), t_nl = clean(it.title_nl, 200), cat = clean(it.category, 40);
    if (!t_en || !t_nl || !cat) { skipped++; continue; }
    const { rows: dup } = await db.query('SELECT id FROM portfolio WHERE title_nl = $1 AND category = $2', [t_nl, cat]);
    if (dup.length) { skipped++; continue; }
    await db.query(
      `INSERT INTO portfolio (title_en,title_nl,category,client,video_url,thumb_url,description_en,description_nl,sort_order,published,format)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [t_en, t_nl, cat, clean(it.client, 120), clean(it.video_url, 500), clean(it.thumb_url, 500),
       clean(it.description_en, 1000), clean(it.description_nl, 1000),
       Number(it.sort_order) || 0, it.published === 0 ? 0 : 1,
       it.format === 'vertical' ? 'vertical' : 'horizontal']
    );
    added++;
  }
  res.json({ ok: true, added, skipped });
}));

// ---------- admin: portfolio CRUD ----------
app.get('/api/admin/portfolio', requireAuth, h(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM portfolio ORDER BY sort_order, id DESC');
  res.json(rows);
}));
app.post('/api/admin/portfolio', requireAuth, h(async (req, res) => {
  const b = req.body || {};
  const t_en = clean(b.title_en, 200), t_nl = clean(b.title_nl, 200), cat = clean(b.category, 40);
  if (!t_en || !t_nl || !cat) return res.status(400).json({ error: 'title_en, title_nl, category required' });
  const fmt = b.format === 'vertical' ? 'vertical' : 'horizontal';
  const { rows } = await db.query(`INSERT INTO portfolio
    (title_en,title_nl,category,client,video_url,thumb_url,description_en,description_nl,sort_order,published,format)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
    [t_en, t_nl, cat, clean(b.client, 160), clean(b.video_url, 500), clean(b.thumb_url, 500),
     clean(b.description_en), clean(b.description_nl), Number(b.sort_order) || 0, b.published === 0 ? 0 : 1, fmt]);
  res.json({ ok: true, id: rows[0] ? rows[0].id : null });
}));
app.patch('/api/admin/portfolio/:id', requireAuth, h(async (req, res) => {
  const id = Number(req.params.id);
  const { rows: curRows } = await db.query('SELECT * FROM portfolio WHERE id = $1', [id]);
  const cur = curRows[0];
  if (!cur) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  await db.query(`UPDATE portfolio SET
    title_en=$1, title_nl=$2, category=$3, client=$4, video_url=$5, thumb_url=$6,
    description_en=$7, description_nl=$8, sort_order=$9, published=$10, format=$11 WHERE id=$12`,
    [
      clean(b.title_en, 200) || cur.title_en,
      clean(b.title_nl, 200) || cur.title_nl,
      clean(b.category, 40) || cur.category,
      b.client !== undefined ? clean(b.client, 160) : cur.client,
      b.video_url !== undefined ? clean(b.video_url, 500) : cur.video_url,
      b.thumb_url !== undefined ? clean(b.thumb_url, 500) : cur.thumb_url,
      b.description_en !== undefined ? clean(b.description_en) : cur.description_en,
      b.description_nl !== undefined ? clean(b.description_nl) : cur.description_nl,
      b.sort_order !== undefined ? Number(b.sort_order) || 0 : cur.sort_order,
      b.published !== undefined ? (b.published ? 1 : 0) : cur.published,
      b.format === 'vertical' || b.format === 'horizontal' ? b.format : (cur.format || 'horizontal'),
      id,
    ]);
  res.json({ ok: true });
}));
app.delete('/api/admin/portfolio/:id', requireAuth, h(async (req, res) => {
  await db.query('DELETE FROM portfolio WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
}));

// malformed or oversized request bodies (bots, broken clients): a short answer instead of a stack trace in the logs
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.type === 'entity.parse.failed')) {
    return res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: err.type === 'entity.too.large' ? 'too large' : 'bad request' });
  }
  next(err);
});

// Start the web server FIRST so the site is always up, even if the DB is down.
// DB init runs alongside; if it fails we retry in the background and API routes
// return a clear error instead of the whole site being offline.
let dbReady = false;

function startServer() {
  app.listen(PORT, () => {
    console.log(`Brown Media Management site → http://localhost:${PORT}`);
    console.log(`Admin panel → http://localhost:${PORT}/admin.html`);
    if (ADMIN_PASSWORD === 'changeme') console.log('⚠ Set ADMIN_PASSWORD env var before going live.');
  });
}

async function tryInitDB(attempt = 1) {
  try {
    await initDB();
    dbReady = true;
    console.log('Database ready.');
  } catch (err) {
    console.error(`Database init failed (attempt ${attempt}):`, err.message || err);
    // retry with backoff, capped at 5 minutes — site stays up meanwhile
    const delay = Math.min(attempt * 30000, 300000);
    setTimeout(() => tryInitDB(attempt + 1), delay);
  }
}

startServer();
tryInitDB();

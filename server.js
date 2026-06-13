// Brown Media Management — server
// Uses Postgres when DATABASE_URL is set (production on Render),
// otherwise falls back to local SQLite for development.
const express = require('express');
const crypto = require('crypto');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const USE_PG = !!process.env.DATABASE_URL;

// --- Email notifications (optional) ---
let mailer = null;
if (process.env.SMTP_HOST && process.env.NOTIFY_EMAIL) {
  const nodemailer = require('nodemailer');
  mailer = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}
function notify(subject, lines) {
  if (!mailer) return;
  mailer.sendMail({
    from: `"BMM Website" <${process.env.SMTP_USER}>`,
    to: process.env.NOTIFY_EMAIL,
    subject,
    text: lines.filter(Boolean).join('\n'),
  }).catch(err => console.error('Email notify failed:', err.message));
}

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
      ssl: { rejectUnauthorized: false },
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
    const toQ = sql => sql.replace(/\$\d+/g, '?');
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
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const clean = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const h = fn => (req, res) => fn(req, res).catch(err => { console.error(err); res.status(500).json({ error: 'server error' }); });

async function requireAuth(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'unauthorized' });
    const { rows } = await db.query('SELECT token FROM sessions WHERE token = $1', [token]);
    if (!rows.length) return res.status(401).json({ error: 'unauthorized' });
    next();
  } catch (err) { console.error(err); res.status(500).json({ error: 'server error' }); }
}

const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || 'x';
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 60_000);
  if (arr.length >= 10) return res.status(429).json({ error: 'too many requests' });
  arr.push(now); hits.set(ip, arr);
  next();
}

// ---------- public API ----------
app.get('/api/portfolio', h(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM portfolio WHERE published = 1 ORDER BY sort_order, id DESC');
  res.json(rows);
}));

app.post('/api/contact', rateLimit, h(async (req, res) => {
  const { name, email, phone, company, service, message, lang } = req.body || {};
  const n = clean(name, 120), e = clean(email, 200);
  if (!n || !validEmail(e)) return res.status(400).json({ error: 'name and valid email required' });
  await db.query(`INSERT INTO leads (name,email,phone,company,service,message,lang)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [n, e, clean(phone, 40), clean(company, 160), clean(service, 60), clean(message), clean(lang, 5)]);
  notify(`📩 Nieuwe lead: ${n}`, [
    `Naam: ${n}`, `E-mail: ${e}`, phone ? `Telefoon: ${clean(phone, 40)}` : '',
    company ? `Bedrijf: ${clean(company, 160)}` : '', '', `Bericht:`, clean(message),
    '', 'Beheer: open je admin panel → Leads',
  ]);
  res.json({ ok: true });
}));

app.post('/api/bookings', rateLimit, h(async (req, res) => {
  const { name, email, phone, service, preferred_date, location, details, lang } = req.body || {};
  const n = clean(name, 120), e = clean(email, 200), s = clean(service, 60), d = clean(preferred_date, 30);
  if (!n || !validEmail(e) || !s || !d) return res.status(400).json({ error: 'name, valid email, service and date required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  await db.query(`INSERT INTO bookings (name,email,phone,service,preferred_date,location,details,lang)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [n, e, clean(phone, 40), s, d, clean(location, 200), clean(details), clean(lang, 5)]);
  notify(`🎬 Nieuwe boeking: ${n} — ${d}`, [
    `Naam: ${n}`, `E-mail: ${e}`, phone ? `Telefoon: ${clean(phone, 40)}` : '',
    `Dienst: ${s}`, `Voorkeursdatum: ${d}`, location ? `Locatie: ${clean(location, 200)}` : '',
    '', `Details:`, clean(details),
    '', 'Bevestigen of afwijzen: open je admin panel → Bookings',
  ]);
  res.json({ ok: true });
}));

// ---------- admin auth ----------
app.post('/api/admin/login', rateLimit, h(async (req, res) => {
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
  const status = clean(req.body && req.body.status, 20);
  if (!['new', 'contacted', 'won', 'lost'].includes(status)) return res.status(400).json({ error: 'bad status' });
  await db.query('UPDATE leads SET status = $1 WHERE id = $2', [status, Number(req.params.id)]);
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
  const status = clean(req.body && req.body.status, 20);
  if (!['pending', 'confirmed', 'declined', 'done'].includes(status)) return res.status(400).json({ error: 'bad status' });
  await db.query('UPDATE bookings SET status = $1 WHERE id = $2', [status, Number(req.params.id)]);
  res.json({ ok: true });
}));
app.delete('/api/admin/bookings/:id', requireAuth, h(async (req, res) => {
  await db.query('DELETE FROM bookings WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
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

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Brown Media Management site → http://localhost:${PORT}`);
    console.log(`Admin panel → http://localhost:${PORT}/admin.html`);
    if (ADMIN_PASSWORD === 'changeme') console.log('⚠ Set ADMIN_PASSWORD env var before going live.');
  });
}).catch(err => {
  console.error('Failed to start — database init error:', err);
  process.exit(1);
});

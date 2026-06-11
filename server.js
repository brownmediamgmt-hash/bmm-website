// Brown Media Management — server
// Node 22+ (uses built-in node:sqlite). Run: node server.js
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

// --- Email notifications (optional) ---
// Set these env vars to receive an email for every booking and lead:
//   NOTIFY_EMAIL  = where notifications go (your inbox)
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS = your mail provider
// Without them, the site still works — submissions just stay in the admin panel only.
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

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'bmm.db');

require('fs').mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS leads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    company TEXT,
    service TEXT,
    message TEXT,
    lang TEXT,
    status TEXT DEFAULT 'new',          -- new | contacted | won | lost
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,
    service TEXT NOT NULL,              -- real-estate | social | brand-film | other
    preferred_date TEXT NOT NULL,
    location TEXT,
    details TEXT,
    lang TEXT,
    status TEXT DEFAULT 'pending',      -- pending | confirmed | declined | done
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS portfolio (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title_en TEXT NOT NULL,
    title_nl TEXT NOT NULL,
    category TEXT NOT NULL,             -- real-estate | social | brand-film
    client TEXT,
    video_url TEXT,                     -- YouTube/Vimeo/Instagram embed URL
    thumb_url TEXT,
    description_en TEXT,
    description_nl TEXT,
    sort_order INTEGER DEFAULT 0,
    published INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Seed portfolio with placeholders on first run
const count = db.prepare('SELECT COUNT(*) AS c FROM portfolio').get().c;
if (count === 0) {
  const seed = db.prepare(`INSERT INTO portfolio
    (title_en, title_nl, category, client, video_url, thumb_url, description_en, description_nl, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  seed.run('Company Story — Local Business', 'Bedrijfsvideo — Lokale Onderneming', 'business', '', '', '', 'Corporate video built around one message: why customers choose them.', 'Bedrijfsvideo gebouwd rond één boodschap: waarom klanten voor hen kiezen.', 1);
  seed.run('Monthly Content Pack — 12 Reels', 'Maandpakket Content — 12 Reels', 'social', '', '', '', 'Monthly social content production: hooks, captions, delivery.', 'Maandelijkse social content productie: hooks, captions, oplevering.', 2);
  seed.run('Interior Reveal — LUXV Design Studio', 'Interieur Reveal — LUXV Design Studio', 'brand-film', 'LUXV Design Studio', '', '', 'Design-led interior film with motion-matched transitions.', 'Designgerichte interieurfilm met motion-matched overgangen.', 3);
  seed.run('Canal-side Apartment — Groningen', 'Grachtenappartement — Groningen', 'real-estate', '', '', '', 'Cinematic walkthrough, 60s vertical + 90s horizontal cut.', 'Cinematische walkthrough, 60s verticaal + 90s horizontaal.', 4);
}

const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const clean = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function requireAuth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'unauthorized' });
  const row = db.prepare('SELECT token FROM sessions WHERE token = ?').get(token);
  if (!row) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// Simple in-memory rate limit for public forms (per IP, 10/min)
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
app.get('/api/portfolio', (req, res) => {
  const rows = db.prepare('SELECT * FROM portfolio WHERE published = 1 ORDER BY sort_order, id DESC').all();
  res.json(rows);
});

app.post('/api/contact', rateLimit, (req, res) => {
  const { name, email, phone, company, service, message, lang } = req.body || {};
  const n = clean(name, 120), e = clean(email, 200);
  if (!n || !validEmail(e)) return res.status(400).json({ error: 'name and valid email required' });
  db.prepare(`INSERT INTO leads (name,email,phone,company,service,message,lang) VALUES (?,?,?,?,?,?,?)`)
    .run(n, e, clean(phone, 40), clean(company, 160), clean(service, 60), clean(message), clean(lang, 5));
  notify(`📩 Nieuwe lead: ${n}`, [
    `Naam: ${n}`, `E-mail: ${e}`, phone ? `Telefoon: ${clean(phone, 40)}` : '',
    company ? `Bedrijf: ${clean(company, 160)}` : '', '', `Bericht:`, clean(message),
    '', 'Beheer: open je admin panel → Leads',
  ]);
  res.json({ ok: true });
});

app.post('/api/bookings', rateLimit, (req, res) => {
  const { name, email, phone, service, preferred_date, location, details, lang } = req.body || {};
  const n = clean(name, 120), e = clean(email, 200), s = clean(service, 60), d = clean(preferred_date, 30);
  if (!n || !validEmail(e) || !s || !d) return res.status(400).json({ error: 'name, valid email, service and date required' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  db.prepare(`INSERT INTO bookings (name,email,phone,service,preferred_date,location,details,lang) VALUES (?,?,?,?,?,?,?,?)`)
    .run(n, e, clean(phone, 40), s, d, clean(location, 200), clean(details), clean(lang, 5));
  notify(`🎬 Nieuwe boeking: ${n} — ${d}`, [
    `Naam: ${n}`, `E-mail: ${e}`, phone ? `Telefoon: ${clean(phone, 40)}` : '',
    `Dienst: ${s}`, `Voorkeursdatum: ${d}`, location ? `Locatie: ${clean(location, 200)}` : '',
    '', `Details:`, clean(details),
    '', 'Bevestigen of afwijzen: open je admin panel → Bookings',
  ]);
  res.json({ ok: true });
});

// ---------- admin auth ----------
app.post('/api/admin/login', rateLimit, (req, res) => {
  const { password } = req.body || {};
  const ok = typeof password === 'string' &&
    password.length === ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(ADMIN_PASSWORD));
  if (!ok) return res.status(401).json({ error: 'wrong password' });
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token) VALUES (?)').run(token);
  res.json({ token });
});

app.post('/api/admin/logout', requireAuth, (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

// ---------- admin: leads & bookings ----------
app.get('/api/admin/leads', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM leads ORDER BY id DESC').all());
});
app.patch('/api/admin/leads/:id', requireAuth, (req, res) => {
  const status = clean(req.body?.status, 20);
  if (!['new', 'contacted', 'won', 'lost'].includes(status)) return res.status(400).json({ error: 'bad status' });
  db.prepare('UPDATE leads SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  res.json({ ok: true });
});
app.delete('/api/admin/leads/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM leads WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.get('/api/admin/bookings', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM bookings ORDER BY preferred_date ASC, id DESC').all());
});
app.patch('/api/admin/bookings/:id', requireAuth, (req, res) => {
  const status = clean(req.body?.status, 20);
  if (!['pending', 'confirmed', 'declined', 'done'].includes(status)) return res.status(400).json({ error: 'bad status' });
  db.prepare('UPDATE bookings SET status = ? WHERE id = ?').run(status, Number(req.params.id));
  res.json({ ok: true });
});
app.delete('/api/admin/bookings/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM bookings WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ---------- admin: portfolio CRUD ----------
app.get('/api/admin/portfolio', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM portfolio ORDER BY sort_order, id DESC').all());
});
app.post('/api/admin/portfolio', requireAuth, (req, res) => {
  const b = req.body || {};
  const t_en = clean(b.title_en, 200), t_nl = clean(b.title_nl, 200), cat = clean(b.category, 40);
  if (!t_en || !t_nl || !cat) return res.status(400).json({ error: 'title_en, title_nl, category required' });
  const r = db.prepare(`INSERT INTO portfolio
    (title_en,title_nl,category,client,video_url,thumb_url,description_en,description_nl,sort_order,published)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(t_en, t_nl, cat, clean(b.client, 160), clean(b.video_url, 500), clean(b.thumb_url, 500),
         clean(b.description_en), clean(b.description_nl), Number(b.sort_order) || 0, b.published === 0 ? 0 : 1);
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
});
app.patch('/api/admin/portfolio/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const cur = db.prepare('SELECT * FROM portfolio WHERE id = ?').get(id);
  if (!cur) return res.status(404).json({ error: 'not found' });
  const b = req.body || {};
  db.prepare(`UPDATE portfolio SET
    title_en=?, title_nl=?, category=?, client=?, video_url=?, thumb_url=?,
    description_en=?, description_nl=?, sort_order=?, published=? WHERE id=?`)
    .run(
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
      id
    );
  res.json({ ok: true });
});
app.delete('/api/admin/portfolio/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM portfolio WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Brown Media Management site → http://localhost:${PORT}`);
  console.log(`Admin panel → http://localhost:${PORT}/admin.html`);
  if (ADMIN_PASSWORD === 'changeme') console.log('⚠ Set ADMIN_PASSWORD env var before going live.');
});

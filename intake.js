// Client onboarding ("intake"): a personal link per client → multi-slide form → answers in the admin panel.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const INTAKE = require('./public/intake-questions.js');

const TOKEN_RE = /^[A-Za-z0-9_-]{16,40}$/;
const MAX_ANSWERS_BYTES = 120 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 8;
const FILE_TYPES = /^(image\/(png|jpe?g|gif|webp|svg\+xml|heic|heif|avif)|application\/(pdf|zip|x-zip-compressed|postscript|illustrator|vnd\.adobe\.illustrator|eps|octet-stream)|application\/x-(eps|zip))$/i;
const FILE_EXT = /\.(png|jpe?g|gif|webp|svg|heic|heif|avif|pdf|zip|ai|eps)$/i;
const STATUSES = ['sent', 'opened', 'in_progress', 'completed'];

const newToken = () => crypto.randomBytes(18).toString('base64url');
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = v => Number(v) || 0;

module.exports = function createIntake({ app, getDb, h, requireAuth, rateLimit, USE_PG, notify }) {
  async function init(db) {
    const id = USE_PG ? 'SERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    await db.query(`CREATE TABLE IF NOT EXISTS intakes (
      id ${id}, token TEXT UNIQUE NOT NULL, contact_name TEXT, company TEXT, email TEXT, note TEXT,
      origin TEXT DEFAULT 'invite', status TEXT DEFAULT 'sent', answers TEXT, step INTEGER DEFAULT 0, progress INTEGER DEFAULT 0,
      open_count INTEGER DEFAULT 0, archived INTEGER DEFAULT 0,
      created_at BIGINT, opened_at BIGINT, updated_at BIGINT, completed_at BIGINT)`);
    await db.query(`CREATE TABLE IF NOT EXISTS intake_files (
      id ${id}, intake_id INTEGER NOT NULL, name TEXT, type TEXT, size INTEGER, data ${USE_PG ? 'BYTEA' : 'BLOB'}, created_at BIGINT)`);
    await db.query('CREATE INDEX IF NOT EXISTS intake_files_intake ON intake_files (intake_id)');
  }

  const publicView = r => ({
    contact_name: r.contact_name || '', company: r.company || '', note: r.note || '', status: r.status,
    answers: safeJSON(r.answers), step: num(r.step), completed_at: r.completed_at ? num(r.completed_at) : null,
    updated_at: num(r.updated_at) || 0,
  });
  const adminView = r => ({
    id: num(r.id), token: r.token, contact_name: r.contact_name || '', company: r.company || '', email: r.email || '', note: r.note || '',
    origin: r.origin, status: r.status, step: num(r.step), progress: num(r.progress), open_count: num(r.open_count), archived: num(r.archived),
    created_at: num(r.created_at) || null, opened_at: num(r.opened_at) || null, updated_at: num(r.updated_at) || null, completed_at: num(r.completed_at) || null,
  });
  function safeJSON(s) { try { const v = JSON.parse(s || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch (e) { return {}; } }

  // keep only known question ids, with values of the right shape
  function sanitizeAnswers(input, existingFiles) {
    const out = {};
    if (!input || typeof input !== 'object') return out;
    for (const q of INTAKE.questions) {
      const v = input[q.id];
      if (v == null) continue;
      switch (q.type) {
        case 'name':
          if (typeof v === 'object') out[q.id] = { first: str(v.first, 80), last: str(v.last, 80) };
          break;
        case 'radio': {
          if (typeof v !== 'object') break;
          const value = q.options.includes(v.value) || (q.other && v.value === '__other') ? v.value : '';
          if (value) out[q.id] = { value, other: str(v.other, 300) };
          break;
        }
        case 'checkbox': {
          if (typeof v !== 'object' || !Array.isArray(v.values)) break;
          const values = [...new Set(v.values.filter(x => q.options.includes(x) || (q.other && x === '__other')))];
          out[q.id] = { values, other: str(v.other, 300) };
          break;
        }
        case 'file': {
          // only references to files that really belong to this intake
          if (!Array.isArray(v)) break;
          const ok = v.map(f => existingFiles.get(num(f && f.id))).filter(Boolean);
          out[q.id] = ok.map(f => ({ id: num(f.id), name: f.name, size: num(f.size), type: f.type }));
          break;
        }
        case 'textarea': if (typeof v === 'string') out[q.id] = v.slice(0, 5000); break;
        default: if (typeof v === 'string') out[q.id] = v.slice(0, 400);
      }
    }
    return out;
  }
  function progressOf(answers) {
    const total = INTAKE.questions.length;
    const done = INTAKE.questions.filter(q => INTAKE.isAnswered(q, answers[q.id])).length;
    return Math.round(done / total * 100);
  }
  async function filesOf(db, intakeId) {
    const { rows } = await db.query('SELECT id,name,type,size FROM intake_files WHERE intake_id = $1 ORDER BY id', [intakeId]);
    return new Map(rows.map(f => [num(f.id), f]));
  }
  async function byToken(db, token) {
    if (!TOKEN_RE.test(String(token || ''))) return null;
    const { rows } = await db.query('SELECT * FROM intakes WHERE token = $1', [token]);
    return rows[0] || null;
  }

  // ---------- the intake page itself ----------
  const page = path.join(__dirname, 'public', 'start.html');
  app.get(['/start', '/start/:token'], (req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(page);
  });

  // ---------- public API (the client) ----------
  // start without a personal link (e.g. a link in your bio): creates the intake on first save
  app.post('/api/intake', rateLimit('intake-new', 6, 60), h(async (req, res) => {
    const db = getDb();
    const token = newToken();
    const now = Date.now();
    await db.query(`INSERT INTO intakes (token, origin, status, answers, created_at, opened_at, updated_at, open_count)
      VALUES ($1,'link','in_progress','{}',$2,$2,$2,1)`, [token, now]);
    res.json({ token });
  }));

  app.get('/api/intake/:token', rateLimit('intake-read', 60), h(async (req, res) => {
    const db = getDb();
    const row = await byToken(db, req.params.token);
    if (!row) return res.status(404).json({ error: 'not found' });
    const now = Date.now();
    const status = row.status === 'sent' ? 'opened' : row.status;
    await db.query('UPDATE intakes SET open_count = open_count + 1, opened_at = COALESCE(opened_at, $1), status = $2 WHERE id = $3', [now, status, row.id]);
    const files = await filesOf(db, row.id);
    res.json({ ...publicView({ ...row, status }), files: [...files.values()].map(f => ({ id: num(f.id), name: f.name, size: num(f.size), type: f.type })) });
  }));

  // autosave (every step)
  app.put('/api/intake/:token', rateLimit('intake-save', 90), h(async (req, res) => {
    const db = getDb();
    const row = await byToken(db, req.params.token);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (row.status === 'completed') return res.status(409).json({ error: 'completed' });
    const b = req.body || {};
    if (JSON.stringify(b.answers || {}).length > MAX_ANSWERS_BYTES) return res.status(413).json({ error: 'too large' });
    const answers = sanitizeAnswers(b.answers, await filesOf(db, row.id));
    const step = Math.max(0, Math.min(200, parseInt(b.step, 10) || 0));
    const now = Date.now();
    // keep the admin's list readable: mirror the contact answers onto the row
    const name = answers.contact_name ? `${answers.contact_name.first} ${answers.contact_name.last}`.trim() : '';
    await db.query(`UPDATE intakes SET answers = $1, step = $2, progress = $3, status = 'in_progress', updated_at = $4,
      company = CASE WHEN $5 <> '' THEN $5 ELSE company END,
      contact_name = CASE WHEN $6 <> '' THEN $6 ELSE contact_name END,
      email = CASE WHEN $7 <> '' THEN $7 ELSE email END
      WHERE id = $8`,
      [JSON.stringify(answers), step, progressOf(answers), now, str(answers.company, 160), name.slice(0, 160), str(answers.email, 200), row.id]);
    res.json({ ok: true, saved_at: now, progress: progressOf(answers) });
  }));

  // upload a file (logo / brand guide), base64 JSON so it works without multipart parsing
  app.post('/api/intake/:token/files', express.json({ limit: '15mb' }), rateLimit('intake-file', 20), h(async (req, res) => {
    const db = getDb();
    const row = await byToken(db, req.params.token);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (row.status === 'completed') return res.status(409).json({ error: 'completed' });
    const b = req.body || {};
    const name = str(b.name, 160).replace(/[\\/:*?"<>|]+/g, '_') || 'bestand';
    const type = str(b.type, 100) || 'application/octet-stream';
    if (!FILE_TYPES.test(type) && !FILE_EXT.test(name)) return res.status(415).json({ error: 'type' });
    if (typeof b.data !== 'string') return res.status(400).json({ error: 'data' });
    const buf = Buffer.from(b.data, 'base64');
    if (!buf.length) return res.status(400).json({ error: 'empty' });
    if (buf.length > MAX_FILE_BYTES) return res.status(413).json({ error: 'size' });
    const { rows: cnt } = await db.query('SELECT COUNT(*) AS c FROM intake_files WHERE intake_id = $1', [row.id]);
    if (num(cnt[0].c) >= MAX_FILES) return res.status(409).json({ error: 'max' });
    const { rows } = await db.query('INSERT INTO intake_files (intake_id,name,type,size,data,created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [row.id, name, type, buf.length, buf, Date.now()]);
    res.json({ id: num(rows[0].id), name, type, size: buf.length });
  }));

  app.delete('/api/intake/:token/files/:id', rateLimit('intake-file', 20), h(async (req, res) => {
    const db = getDb();
    const row = await byToken(db, req.params.token);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (row.status === 'completed') return res.status(409).json({ error: 'completed' });
    await db.query('DELETE FROM intake_files WHERE id = $1 AND intake_id = $2', [num(req.params.id), row.id]);
    res.json({ ok: true });
  }));

  app.post('/api/intake/:token/submit', rateLimit('intake-save', 90), h(async (req, res) => {
    const db = getDb();
    const row = await byToken(db, req.params.token);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (row.status === 'completed') return res.json({ ok: true, already: true });
    const b = req.body || {};
    const files = await filesOf(db, row.id);
    const answers = sanitizeAnswers(b.answers || safeJSON(row.answers), files);
    const missing = INTAKE.questions.filter(q => q.required && !INTAKE.isAnswered(q, answers[q.id])).map(q => q.id);
    if (missing.length) return res.status(400).json({ error: 'missing', missing });
    const now = Date.now();
    const name = `${answers.contact_name.first} ${answers.contact_name.last}`.trim();
    await db.query(`UPDATE intakes SET answers = $1, progress = $2, status = 'completed', completed_at = $3, updated_at = $3,
      company = $4, contact_name = $5, email = $6 WHERE id = $7`,
      [JSON.stringify(answers), progressOf(answers), now, str(answers.company, 160), name.slice(0, 160), str(answers.email, 200), row.id]);

    // email with every answer, grouped per section
    const lines = [`Bedrijf: ${answers.company}`, `Contact: ${name}${answers.role ? ' — ' + answers.role : ''}`, `E-mail: ${answers.email}`, `Telefoon: ${answers.phone}`, ''];
    for (const sec of INTAKE.sections) {
      lines.push(`— ${sec.title.toUpperCase()} —`);
      sec.steps.flat().forEach(q => {
        const a = INTAKE.formatAnswer(q, answers[q.id]);
        if (a) lines.push(`${q.label}`, `→ ${a}`, '');
      });
    }
    if (files.size) lines.push(`Bestanden: ${files.size} (download ze in het admin-panel → Intakes)`);
    lines.push('', 'Bekijk alles overzichtelijk in je admin-panel → Intakes');
    notify(`📋 Intake ingevuld: ${answers.company} (${name})`, lines, answers.email);
    res.json({ ok: true });
  }));

  // ---------- admin ----------
  app.get('/api/admin/intakes', requireAuth, h(async (req, res) => {
    const { rows } = await getDb().query('SELECT * FROM intakes ORDER BY COALESCE(updated_at, created_at) DESC, id DESC');
    res.json(rows.map(adminView));
  }));
  app.post('/api/admin/intakes', requireAuth, h(async (req, res) => {
    const b = req.body || {};
    const contact = str(b.contact_name, 160), company = str(b.company, 160), email = str(b.email, 200), note = str(b.note, 1200);
    if (!contact && !company) return res.status(400).json({ error: 'name or company required' });
    const token = newToken();
    const now = Date.now();
    // prefill what we already know, so the client doesn't have to type it again
    const pre = {};
    if (company) pre.company = company;
    if (contact) { const parts = contact.split(/\s+/); pre.contact_name = { first: parts.shift() || '', last: parts.join(' ') }; }
    if (email) pre.email = email;
    const { rows } = await getDb().query(`INSERT INTO intakes (token, contact_name, company, email, note, origin, status, answers, progress, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,'invite','sent',$6,$7,$8,$8) RETURNING id`,
      [token, contact, company, email, note, JSON.stringify(pre), progressOf(pre), now]);
    res.json({ id: num(rows[0].id), token });
  }));
  app.get('/api/admin/intakes/:id', requireAuth, h(async (req, res) => {
    const db = getDb();
    const { rows } = await db.query('SELECT * FROM intakes WHERE id = $1', [num(req.params.id)]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    const files = await filesOf(db, rows[0].id);
    res.json({ ...adminView(rows[0]), answers: safeJSON(rows[0].answers),
      files: [...files.values()].map(f => ({ id: num(f.id), name: f.name, size: num(f.size), type: f.type })) });
  }));
  app.patch('/api/admin/intakes/:id', requireAuth, h(async (req, res) => {
    const db = getDb();
    const id = num(req.params.id);
    const { rows } = await db.query('SELECT * FROM intakes WHERE id = $1', [id]);
    const cur = rows[0];
    if (!cur) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    const status = b.reopen ? 'in_progress' : cur.status;
    await db.query('UPDATE intakes SET contact_name=$1, company=$2, email=$3, note=$4, archived=$5, status=$6, completed_at=$7 WHERE id=$8', [
      b.contact_name !== undefined ? str(b.contact_name, 160) : cur.contact_name,
      b.company !== undefined ? str(b.company, 160) : cur.company,
      b.email !== undefined ? str(b.email, 200) : cur.email,
      b.note !== undefined ? str(b.note, 1200) : cur.note,
      b.archived !== undefined ? (b.archived ? 1 : 0) : num(cur.archived),
      STATUSES.includes(status) ? status : cur.status,
      b.reopen ? null : cur.completed_at,
      id]);
    res.json({ ok: true });
  }));
  app.delete('/api/admin/intakes/:id', requireAuth, h(async (req, res) => {
    const db = getDb();
    const id = num(req.params.id);
    await db.query('DELETE FROM intake_files WHERE intake_id = $1', [id]);
    await db.query('DELETE FROM intakes WHERE id = $1', [id]);
    res.json({ ok: true });
  }));
  app.get('/api/admin/intake-files/:id', requireAuth, h(async (req, res) => {
    const { rows } = await getDb().query('SELECT name,type,data FROM intake_files WHERE id = $1', [num(req.params.id)]);
    if (!rows[0]) return res.status(404).json({ error: 'not found' });
    const f = rows[0];
    const buf = Buffer.from(f.data);
    res.set('Content-Type', FILE_TYPES.test(f.type) ? f.type : 'application/octet-stream');
    res.set('Content-Disposition', `attachment; filename="${encodeURIComponent(f.name)}"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(buf);
  }));

  return { init };
};

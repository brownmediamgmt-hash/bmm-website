// GDPR / AVG: privacy statement route, Vimeo thumbnails without contacting Vimeo from the visitor's browser,
// requests from people about their data (find, export, delete) and automatic deletion after the retention period.
const path = require('path');

// how long things are kept — the privacy statement (public/privacy.html) says the same, keep them in sync
const RETENTION_MONTHS = 24;                   // requests (calls, questions, video-check) and client intakes
const DAY_MS = 86400000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = function createPrivacy({ app, getDb, h, requireAuth, rateLimit, USE_PG }) {
  const num = v => Number(v) || 0;

  // ---------- the privacy statement ----------
  const page = path.join(__dirname, 'public', 'privacy.html');
  app.get(['/privacy', '/privacyverklaring', '/privacy-policy'], (req, res) => res.sendFile(page));

  // ---------- Vimeo thumbnails, fetched by the server ----------
  // The visitor's browser only talks to Vimeo once they play (or hover) a video.
  const thumbs = new Map();   // id → { buf, type, at }
  const THUMB_TTL = DAY_MS;
  app.get('/api/vthumb/:id', rateLimit('vthumb', 120), async (req, res) => {
    const id = String(req.params.id || '');
    const hash = /^[0-9a-f]{6,20}$/i.test(String(req.query.h || '')) ? String(req.query.h) : '';
    if (!/^\d{4,12}$/.test(id)) return res.status(404).end();
    const key = id + (hash ? ':' + hash : '');
    const hit = thumbs.get(key);
    const send = t => { res.set('Content-Type', t.type); res.set('Cache-Control', 'public, max-age=86400'); res.send(t.buf); };
    if (hit && Date.now() - hit.at < THUMB_TTL) return send(hit);
    try {
      const video = 'https://vimeo.com/' + id + (hash ? '/' + hash : '');
      const meta = await fetch('https://vimeo.com/api/oembed.json?width=960&url=' + encodeURIComponent(video), { signal: AbortSignal.timeout(6000) });
      if (!meta.ok) throw new Error('oembed ' + meta.status);
      const { thumbnail_url: src } = await meta.json();
      if (!src || !/^https:\/\/i\.vimeocdn\.com\//.test(src)) throw new Error('no thumbnail');
      const img = await fetch(src, { signal: AbortSignal.timeout(8000) });
      const type = img.headers.get('content-type') || '';
      if (!img.ok || !/^image\//.test(type)) throw new Error('image ' + img.status);
      const buf = Buffer.from(await img.arrayBuffer());
      if (buf.length > 3 * 1024 * 1024) throw new Error('too big');
      if (thumbs.size > 300) thumbs.delete(thumbs.keys().next().value);
      const t = { buf, type, at: Date.now() };
      thumbs.set(key, t);
      send(t);
    } catch (e) {
      if (hit) return send(hit);   // stale is better than nothing
      res.status(404).end();
    }
  });

  // YouTube thumbnails the same way (largest available, else the standard size)
  app.get('/api/ythumb/:id', rateLimit('vthumb', 120), async (req, res) => {
    const id = String(req.params.id || '');
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return res.status(404).end();
    const key = 'yt:' + id;
    const hit = thumbs.get(key);
    const send = t => { res.set('Content-Type', t.type); res.set('Cache-Control', 'public, max-age=86400'); res.send(t.buf); };
    if (hit && Date.now() - hit.at < THUMB_TTL) return send(hit);
    try {
      let img = null;
      for (const size of ['maxresdefault', 'hqdefault']) {
        const r = await fetch(`https://i.ytimg.com/vi/${id}/${size}.jpg`, { signal: AbortSignal.timeout(8000) });
        if (r.ok && /^image\//.test(r.headers.get('content-type') || '')) { img = r; break; }
      }
      if (!img) throw new Error('no thumbnail');
      const buf = Buffer.from(await img.arrayBuffer());
      if (buf.length > 3 * 1024 * 1024) throw new Error('too big');
      if (thumbs.size > 300) thumbs.delete(thumbs.keys().next().value);
      const t = { buf, type: img.headers.get('content-type'), at: Date.now() };
      thumbs.set(key, t);
      send(t);
    } catch (e) {
      if (hit) return send(hit);
      res.status(404).end();
    }
  });

  // ---------- someone asks about their data (access / erasure) ----------
  async function findByEmail(db, email) {
    const e = String(email || '').trim().toLowerCase();
    const [leads, bookings, intakes] = await Promise.all([
      db.query('SELECT * FROM leads WHERE LOWER(email) = $1 ORDER BY id', [e]),
      db.query('SELECT * FROM bookings WHERE LOWER(email) = $1 ORDER BY id', [e]),
      db.query('SELECT id,token,contact_name,company,email,note,origin,status,answers,progress,created_at,opened_at,updated_at,completed_at FROM intakes WHERE LOWER(email) = $1 ORDER BY id', [e]),
    ]);
    const ids = intakes.rows.map(r => num(r.id));
    const files = ids.length
      ? (await db.query(`SELECT id,intake_id,name,type,size,created_at FROM intake_files WHERE intake_id IN (${ids.map((_, i) => '$' + (i + 1)).join(',')}) ORDER BY id`, ids)).rows
      : [];
    // the website visits that led to these requests (linked through the visit id stored with the request)
    const sids = [...new Set([...leads.rows, ...bookings.rows].map(r => r.sid).filter(s => /^[a-z0-9]{8,32}$/i.test(String(s || ''))))];
    const events = sids.length
      ? (await db.query(`SELECT ts,type,section,label,src,country,region,city,device,browser,os FROM events WHERE sid IN (${sids.map((_, i) => '$' + (i + 1)).join(',')}) ORDER BY ts`, sids)).rows
      : [];
    return { email: e, leads: leads.rows, bookings: bookings.rows, intakes: intakes.rows.map(r => ({ ...r, answers: safeJSON(r.answers) })), files, visits: events.map(r => ({ ...r, ts: num(r.ts) })), sids, intakeIds: ids };
  }
  function safeJSON(s) { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } }

  app.get('/api/admin/privacy', requireAuth, h(async (req, res) => {
    const email = String(req.query.email || '').trim();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'email' });
    const f = await findByEmail(getDb(), email);
    res.json({
      email: f.email,
      counts: { leads: f.leads.length, bookings: f.bookings.length, intakes: f.intakes.length, files: f.files.length, visitEvents: f.visits.length },
      items: [
        ...f.leads.map(r => ({ kind: r.source === 'quiz' ? 'Video-check' : 'Vraag', id: num(r.id), name: r.name, created_at: r.created_at })),
        ...f.bookings.map(r => ({ kind: 'Gesprek', id: num(r.id), name: r.name, created_at: r.created_at })),
        ...f.intakes.map(r => ({ kind: 'Intake', id: num(r.id), name: r.company || r.contact_name, created_at: num(r.created_at) })),
      ],
    });
  }));

  // everything stored about one person, as a file they can be sent (right of access / portability)
  app.get('/api/admin/privacy/export', requireAuth, h(async (req, res) => {
    const email = String(req.query.email || '').trim();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'email' });
    const f = await findByEmail(getDb(), email);
    const strip = r => { const { token, ...rest } = r; return rest; };
    res.set('Content-Disposition', `attachment; filename="gegevens-${f.email.replace(/[^a-z0-9@._-]/g, '_')}.json"`);
    res.json({
      about: 'Alle gegevens die Brown Media Management via brown-media.nl over dit e-mailadres heeft opgeslagen.',
      exported_at: new Date().toISOString(),
      email: f.email,
      requests_question: f.leads.map(strip),
      requests_call: f.bookings.map(strip),
      intakes: f.intakes.map(strip),
      intake_files: f.files,
      website_visits: f.visits,
    });
  }));

  // delete everything for one person (right to erasure); asks for the confirm word like the other wipes
  app.delete('/api/admin/privacy', requireAuth, h(async (req, res) => {
    const b = req.body || {};
    const email = String(b.email || '').trim();
    if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'email' });
    if (b.confirm !== 'VERWIJDER') return res.status(400).json({ error: 'confirm' });
    const db = getDb();
    const f = await findByEmail(db, email);
    const inList = (col, vals) => `${col} IN (${vals.map((_, i) => '$' + (i + 1)).join(',')})`;
    if (f.sids.length) await db.query('DELETE FROM events WHERE ' + inList('sid', f.sids), f.sids);
    if (f.intakeIds.length) {
      await db.query('DELETE FROM intake_files WHERE ' + inList('intake_id', f.intakeIds), f.intakeIds);
      await db.query('DELETE FROM intakes WHERE ' + inList('id', f.intakeIds), f.intakeIds);
    }
    await db.query('DELETE FROM leads WHERE LOWER(email) = $1', [f.email]);
    await db.query('DELETE FROM bookings WHERE LOWER(email) = $1', [f.email]);
    res.json({ ok: true, deleted: { leads: f.leads.length, bookings: f.bookings.length, intakes: f.intakes.length, files: f.files.length, visitEvents: f.visits.length } });
  }));

  // ---------- retention: old requests and intakes are removed automatically ----------
  async function purge(db) {
    const cutoffMs = Date.now() - RETENTION_MONTHS * 30.44 * DAY_MS;
    const ago = USE_PG ? `NOW() - INTERVAL '${RETENTION_MONTHS} months'` : `datetime('now','-${RETENTION_MONTHS} months')`;
    await db.query(`DELETE FROM leads WHERE created_at < ${ago}`);
    await db.query(`DELETE FROM bookings WHERE created_at < ${ago}`);
    const { rows } = await db.query('SELECT id FROM intakes WHERE COALESCE(updated_at, created_at) < $1', [cutoffMs]);
    for (const r of rows) {
      await db.query('DELETE FROM intake_files WHERE intake_id = $1', [num(r.id)]);
      await db.query('DELETE FROM intakes WHERE id = $1', [num(r.id)]);
    }
    if (rows.length) console.log(`Retention: removed ${rows.length} intake(s) older than ${RETENTION_MONTHS} months`);
  }
  async function init(db) {
    await purge(db);
    setInterval(() => { try { purge(getDb()).catch(e => console.error('Retention purge failed:', e.message)); } catch (e) {} }, DAY_MS).unref();
  }

  return { init, purge, RETENTION_MONTHS };
};

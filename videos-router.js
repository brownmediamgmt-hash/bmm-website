// videos-router.js
// Portfolio video module for brown-media.nl
// Mount in server.js with:
//   const createVideosRouter = require('./videos-router');
//   app.use(createVideosRouter(pool));   // pool = your existing pg Pool

const express = require('express');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

module.exports = function createVideosRouter(pool) {
  const router = express.Router();

  const BUCKET = process.env.R2_BUCKET;
  const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, '');

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  // ---------------------------------------------------------------- schema

  async function ensureTable() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS videos (
        id            SERIAL PRIMARY KEY,
        title         TEXT NOT NULL DEFAULT '',
        client        TEXT NOT NULL DEFAULT '',
        category      TEXT NOT NULL DEFAULT '',
        video_key     TEXT NOT NULL,
        poster_key    TEXT NOT NULL,
        video_url     TEXT NOT NULL,
        poster_url    TEXT NOT NULL,
        width         INTEGER,
        height        INTEGER,
        duration      REAL,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        published     BOOLEAN NOT NULL DEFAULT TRUE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS videos_order_idx ON videos (sort_order, created_at DESC);
    `);
  }
  ensureTable().catch((err) => console.error('videos table init failed:', err.message));

  // ------------------------------------------------------------------ auth
  // If your existing admin routes use a different check, swap this body for it.

  function requireAdmin(req, res, next) {
    const supplied = req.get('x-admin-password') || (req.body && req.body.password);
    if (!process.env.ADMIN_PASSWORD || supplied !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Wachtwoord klopt niet' });
    }
    next();
  }

  // --------------------------------------------------------------- helpers

  function publicUrl(key) {
    return `${PUBLIC_BASE}/${key}`;
  }

  function rowToJson(r) {
    return {
      id: r.id,
      title: r.title,
      client: r.client,
      category: r.category,
      videoUrl: r.video_url,
      posterUrl: r.poster_url,
      width: r.width,
      height: r.height,
      duration: r.duration,
      sortOrder: r.sort_order,
      published: r.published,
      createdAt: r.created_at,
    };
  }

  // ---------------------------------------------------------------- public

  // Only published videos, in display order. This is what the site grid reads.
  router.get('/api/videos', async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM videos WHERE published = TRUE
         ORDER BY sort_order ASC, created_at DESC`
      );
      res.set('Cache-Control', 'public, max-age=60');
      res.json(rows.map(rowToJson));
    } catch (err) {
      console.error('GET /api/videos', err);
      res.status(500).json({ error: 'Kon videos niet laden' });
    }
  });

  // ----------------------------------------------------------------- admin

  router.get('/api/admin/videos', requireAdmin, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT * FROM videos ORDER BY sort_order ASC, created_at DESC`
      );
      res.json(rows.map(rowToJson));
    } catch (err) {
      console.error('GET /api/admin/videos', err);
      res.status(500).json({ error: 'Kon videos niet laden' });
    }
  });

  // Step 1 of an upload: hand the browser a short-lived URL it can PUT straight
  // to R2. The file never passes through Render, so size is not a problem.
  router.post('/api/admin/videos/upload-url', requireAdmin, async (req, res) => {
    try {
      const { kind, contentType } = req.body || {};
      if (!['video', 'poster'].includes(kind)) {
        return res.status(400).json({ error: 'kind moet video of poster zijn' });
      }
      const ext = kind === 'video' ? 'mp4' : 'jpg';
      const type = contentType || (kind === 'video' ? 'video/mp4' : 'image/jpeg');
      const key = `${kind === 'video' ? 'videos' : 'posters'}/${crypto.randomUUID()}.${ext}`;

      const uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: type }),
        { expiresIn: 900 }
      );

      res.json({ key, uploadUrl, contentType: type, publicUrl: publicUrl(key) });
    } catch (err) {
      console.error('POST upload-url', err);
      res.status(500).json({ error: 'Kon upload niet voorbereiden' });
    }
  });

  // Step 2: both files are in R2, save the record.
  router.post('/api/admin/videos', requireAdmin, async (req, res) => {
    try {
      const {
        title = '', client = '', category = '',
        videoKey, posterKey, width, height, duration,
      } = req.body || {};

      if (!videoKey || !posterKey) {
        return res.status(400).json({ error: 'videoKey en posterKey zijn verplicht' });
      }

      const { rows: maxRows } = await pool.query(
        `SELECT COALESCE(MAX(sort_order), 0) AS max FROM videos`
      );
      const nextOrder = Number(maxRows[0].max) + 1;

      const { rows } = await pool.query(
        `INSERT INTO videos
           (title, client, category, video_key, poster_key, video_url, poster_url,
            width, height, duration, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [
          title, client, category, videoKey, posterKey,
          publicUrl(videoKey), publicUrl(posterKey),
          width || null, height || null, duration || null, nextOrder,
        ]
      );
      res.status(201).json(rowToJson(rows[0]));
    } catch (err) {
      console.error('POST /api/admin/videos', err);
      res.status(500).json({ error: 'Opslaan mislukt' });
    }
  });

  router.patch('/api/admin/videos/:id', requireAdmin, async (req, res) => {
    const fields = ['title', 'client', 'category', 'published'];
    const updates = [];
    const values = [];

    fields.forEach((f) => {
      if (req.body && Object.prototype.hasOwnProperty.call(req.body, f)) {
        values.push(req.body[f]);
        updates.push(`${f} = $${values.length}`);
      }
    });

    if (!updates.length) return res.status(400).json({ error: 'Niets om te wijzigen' });
    values.push(req.params.id);

    try {
      const { rows } = await pool.query(
        `UPDATE videos SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
        values
      );
      if (!rows.length) return res.status(404).json({ error: 'Video niet gevonden' });
      res.json(rowToJson(rows[0]));
    } catch (err) {
      console.error('PATCH /api/admin/videos/:id', err);
      res.status(500).json({ error: 'Wijzigen mislukt' });
    }
  });

  // Full ordering in one call: body { order: [id, id, id, ...] }
  router.post('/api/admin/videos/reorder', requireAdmin, async (req, res) => {
    const order = (req.body && req.body.order) || [];
    if (!Array.isArray(order) || !order.length) {
      return res.status(400).json({ error: 'order ontbreekt' });
    }
    const conn = await pool.connect();
    try {
      await conn.query('BEGIN');
      for (let i = 0; i < order.length; i++) {
        await conn.query('UPDATE videos SET sort_order = $1 WHERE id = $2', [i + 1, order[i]]);
      }
      await conn.query('COMMIT');
      res.json({ ok: true });
    } catch (err) {
      await conn.query('ROLLBACK');
      console.error('POST reorder', err);
      res.status(500).json({ error: 'Volgorde opslaan mislukt' });
    } finally {
      conn.release();
    }
  });

  // Removes the record and both files from R2.
  router.delete('/api/admin/videos/:id', requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query('DELETE FROM videos WHERE id = $1 RETURNING *', [
        req.params.id,
      ]);
      if (!rows.length) return res.status(404).json({ error: 'Video niet gevonden' });

      const row = rows[0];
      await Promise.allSettled([
        s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: row.video_key })),
        s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: row.poster_key })),
      ]);

      res.json({ ok: true });
    } catch (err) {
      console.error('DELETE /api/admin/videos/:id', err);
      res.status(500).json({ error: 'Verwijderen mislukt' });
    }
  });

  return router;
};

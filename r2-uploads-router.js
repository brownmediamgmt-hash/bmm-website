// r2-uploads-router.js
const express = require('express');
const crypto = require('crypto');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

module.exports = function createUploadsRouter({ requireAuth }) {
  const router = express.Router();

  const BUCKET = process.env.R2_BUCKET;
  const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE || '').replace(/\/+$/, '');
  const configured = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID &&
                        process.env.R2_SECRET_ACCESS_KEY && BUCKET && PUBLIC_BASE);

  if (!configured) console.warn('R2 uploads disabled: one or more R2_* env vars are missing.');

  const s3 = configured ? new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  }) : null;

  // Uploads a tiny file straight from the server so R2's real error is visible.
  router.get('/api/admin/uploads/selftest', requireAuth, async (req, res) => {
    if (!configured) return res.json({ ok: false, reason: 'env vars missing' });
    try {
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: 'selftest.txt',
        Body: 'hello',
        ContentType: 'text/plain',
      }));
      res.json({ ok: true, message: 'Server kan naar R2 schrijven.' });
    } catch (err) {
      res.json({
        ok: false,
        name: err.name,
        message: err.message,
        code: err.$metadata && err.$metadata.httpStatusCode,
      });
    }
  });

  router.post('/api/admin/uploads/sign', requireAuth, async (req, res) => {
    if (!configured) return res.status(503).json({ error: 'Opslag is nog niet geconfigureerd.' });
    try {
      const { kind, contentType } = req.body || {};
      if (!['video', 'thumb'].includes(kind)) {
        return res.status(400).json({ error: 'kind moet video of thumb zijn' });
      }
      const isVideo = kind === 'video';
      const type = contentType || (isVideo ? 'video/mp4' : 'image/jpeg');
      if (isVideo && !/^video\//.test(type)) return res.status(400).json({ error: 'Alleen videobestanden' });
      if (!isVideo && !/^image\//.test(type)) return res.status(400).json({ error: 'Alleen afbeeldingen' });

      const key = `${isVideo ? 'videos' : 'thumbs'}/${crypto.randomUUID()}.${isVideo ? 'mp4' : 'jpg'}`;
      const uploadUrl = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: type }),
        { expiresIn: 900 }
      );
      res.json({ uploadUrl, publicUrl: `${PUBLIC_BASE}/${key}`, contentType: type });
    } catch (err) {
      console.error('sign upload failed:', err.message);
      res.status(500).json({ error: 'Kon upload niet voorbereiden' });
    }
  });

  return router;
};

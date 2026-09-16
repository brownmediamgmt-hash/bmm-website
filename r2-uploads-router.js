// r2-uploads-router.js
// Hands the browser short-lived permission to upload a file straight to R2.
// That is all it does. Saving portfolio items still goes through the
// existing /api/admin/portfolio routes and the existing portfolio table.
//
// Mount in server.js, after express.json():
//   const createUploadsRouter = require('./r2-uploads-router');
//   app.use(createUploadsRouter({ requireAuth }));

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

  if (!configured) {
    console.warn('R2 uploads disabled: one or more R2_* env vars are missing.');
  }

  const s3 = configured ? new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  }) : null;

  // Returns { uploadUrl, publicUrl, contentType }.
  // uploadUrl is valid for 15 minutes and only for this exact file.
  router.post('/api/admin/uploads/sign', requireAuth, async (req, res) => {
    if (!configured) {
      return res.status(503).json({ error: 'Opslag is nog niet geconfigureerd.' });
    }
    try {
      const { kind, contentType } = req.body || {};
      if (!['video', 'thumb'].includes(kind)) {
        return res.status(400).json({ error: 'kind moet video of thumb zijn' });
      }

      const isVideo = kind === 'video';
      const type = contentType || (isVideo ? 'video/mp4' : 'image/jpeg');

      if (isVideo && !/^video\//.test(type)) {
        return res.status(400).json({ error: 'Alleen videobestanden' });
      }
      if (!isVideo && !/^image\//.test(type)) {
        return res.status(400).json({ error: 'Alleen afbeeldingen' });
      }

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

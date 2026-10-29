// Meta (Facebook/Instagram) ads: leads from Instant Forms into the CRM, and ad results in the admin panel.
// Leads arrive two ways: a webhook (instant, needs a Meta app) and a sync every few minutes (works with just a token).
// Both write to the same `leads` table as the website forms, with source = 'meta'.
const crypto = require('crypto');

const V = process.env.META_GRAPH_VERSION || 'v25.0';
const GRAPH = (process.env.META_GRAPH_URL || 'https://graph.facebook.com') + '/' + V;   // override only for local tests
const PAGE_ID = process.env.META_PAGE_ID || '907973939059204';              // Facebook Page "Brown Media Management"
const AD_ACCOUNT = process.env.META_AD_ACCOUNT_ID || 'act_2455186328344049'; // ad account "Brown Media Management"
const APP_SECRET = process.env.META_APP_SECRET || '';
const SYNC_MS = 5 * 60000;
const CACHE_MS = 10 * 60000;
const DAY_MS = 86400000;
const LEAD_FIELDS = 'id,created_time,field_data,ad_id,ad_name,adset_name,campaign_id,campaign_name,form_id,platform,is_organic';
const PLATFORM = { ig: 'Instagram', fb: 'Facebook', msg: 'Messenger', wa: 'WhatsApp', an: 'Audience Network' };
// Meta reports leads under several action types; the first one present wins
const LEAD_ACTIONS = ['lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped', 'onsite_conversion.lead'];

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = v => Number(v) || 0;

module.exports = function createMeta({ app, getDb, h, requireAuth, rateLimit, USE_PG, notify, getSetting, setSetting, waLink, dayKey }) {
  const state = { lastSync: 0, lastOk: 0, lastError: '', lastAdded: 0, syncing: null, pageToken: '', pageTokenFor: '', pageName: '' };
  const cache = new Map();

  async function token() { return process.env.META_ACCESS_TOKEN || await getSetting('meta_token') || ''; }
  async function verifyToken() {
    let v = process.env.META_VERIFY_TOKEN || await getSetting('meta_verify_token');
    if (!v) { v = crypto.randomBytes(18).toString('hex'); await setSetting('meta_verify_token', v); }
    return v;
  }

  async function graph(path, params = {}, tok) {
    const qs = new URLSearchParams({ ...params, access_token: tok });
    if (APP_SECRET) qs.set('appsecret_proof', crypto.createHmac('sha256', APP_SECRET).update(tok).digest('hex'));
    const url = /^https:/.test(path) ? path : GRAPH + '/' + path.replace(/^\//, '') + '?' + qs;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      const e = data.error || {};
      const err = new Error(e.message || ('Meta API ' + res.status));
      err.code = e.code; err.sub = e.error_subcode;
      throw err;
    }
    return data;
  }
  // follow paging.next until done (capped so a bug can't loop forever)
  async function all(path, params, tok, max = 2000) {
    let page = await graph(path, params, tok);
    const out = [...(page.data || [])];
    let guard = 0;
    while (page.paging && page.paging.next && out.length < max && guard++ < 40) {
      const res = await fetch(page.paging.next, { signal: AbortSignal.timeout(20000) });
      page = await res.json();
      if (page.error) throw new Error(page.error.message);
      out.push(...(page.data || []));
    }
    return out;
  }

  // The lead endpoints want a Page token. A user or system-user token can fetch one; a Page token is used as is.
  async function pageToken() {
    const tok = await token();
    if (!tok) throw new Error('not_configured');
    if (state.pageToken && state.pageTokenFor === tok) return state.pageToken;
    try {
      const p = await graph(PAGE_ID, { fields: 'access_token,name' }, tok);
      state.pageToken = p.access_token || tok;
      state.pageName = p.name || '';
    } catch (e) {
      state.pageToken = tok;   // probably already a Page token
    }
    state.pageTokenFor = tok;
    return state.pageToken;
  }

  // ---------- leads ----------
  async function init(db) {
    const addCol = async (col, type) => {
      if (USE_PG) await db.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS ${col} ${type}`);
      else { try { await db.query(`ALTER TABLE leads ADD COLUMN ${col} ${type}`); } catch (e) { /* exists */ } }
    };
    for (const c of ['meta_id', 'campaign', 'adset', 'ad', 'form', 'platform']) await addCol(c, 'TEXT');
    await db.query('CREATE UNIQUE INDEX IF NOT EXISTS leads_meta_id ON leads (meta_id)');
    setTimeout(() => sync().catch(() => {}), 15000).unref();
    setInterval(() => sync().catch(() => {}), SYNC_MS).unref();
  }

  const pretty = v => {
    const s = String(v ?? '').trim();
    if (!s) return '';
    // Meta sends multiple-choice answers as keys ("autodealer_/_autoverkoop"); make them readable again
    const t = /\s/.test(s) || /@/.test(s) ? s : s.replace(/_/g, ' ').replace(/\s+/g, ' ');
    return t.charAt(0).toUpperCase() + t.slice(1);
  };
  const QUESTION = { 'wat_voor_bedrijf_heb_je?': 'Wat voor bedrijf heb je?', 'waar_heb_je_het_meeste_behoefte_aan?': 'Waar heb je het meeste behoefte aan?' };
  const STD = new Set(['email', 'work_email', 'full_name', 'first_name', 'last_name', 'phone_number', 'work_phone_number', 'company_name', 'job_title', 'city', 'zip_code', 'post_code']);

  function parseLead(l, formName) {
    const f = {};
    for (const d of l.field_data || []) f[d.name] = (d.values || []).join(', ');
    const name = f.full_name || [f.first_name, f.last_name].filter(Boolean).join(' ') || 'Onbekend (Meta)';
    const answers = (l.field_data || []).filter(d => !STD.has(d.name)).map(d => {
      const q = QUESTION[d.name] || pretty(d.name.replace(/\?$/, '')) + (/\?$/.test(d.name) ? '?' : '');
      return q + ' ' + (d.values || []).map(pretty).join(', ');
    });
    const extra = [f.job_title ? 'Functie: ' + f.job_title : '', f.city ? 'Plaats: ' + f.city : ''].filter(Boolean);
    return {
      meta_id: String(l.id),
      created: l.created_time ? new Date(l.created_time) : new Date(),
      name: str(name, 120), email: str(f.email || f.work_email || '', 200), phone: str(f.phone_number || f.work_phone_number || '', 40),
      company: str(f.company_name || '', 160),
      message: [...answers, ...extra].join('\n').slice(0, 2000),
      campaign: str(l.campaign_name || '', 200), adset: str(l.adset_name || '', 200), ad: str(l.ad_name || '', 200),
      form: str(formName || l.form_id || '', 200), platform: PLATFORM[l.platform] || str(l.platform || '', 40),
      organic: !!l.is_organic,
    };
  }

  async function saveLead(l, formName) {
    const db = getDb();
    const p = parseLead(l, formName);
    const { rows } = await db.query('SELECT id FROM leads WHERE meta_id = $1', [p.meta_id]);
    if (rows.length) return false;
    const ts = USE_PG ? p.created.toISOString() : p.created.toISOString().replace('T', ' ').slice(0, 19);
    try {
      await db.query(`INSERT INTO leads (name,email,phone,company,service,message,lang,source,traffic,country,meta_id,campaign,adset,ad,form,platform,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [p.name, p.email, p.phone, p.company, '', p.message, 'nl', 'meta', (p.platform || 'Meta') + (p.organic ? '' : '-advertentie'), 'NL',
         p.meta_id, p.campaign, p.adset, p.ad, p.form, p.platform, ts]);
    } catch (e) {
      if (/unique|constraint/i.test(e.message)) return false;   // the webhook and the sync raced: already saved
      throw e;
    }
    // only mail about fresh leads, not about the backlog pulled in on the first sync
    if (Date.now() - p.created.getTime() < 2 * DAY_MS) {
      notify(`📸 Nieuwe lead via ${p.platform || 'Meta'}-formulier: ${p.name}`, [
        `Naam: ${p.name}`, p.email ? `E-mail: ${p.email}` : null, p.phone ? `Telefoon: ${p.phone}` : null,
        p.phone ? `WhatsApp: ${waLink(p.phone)}` : null, p.company ? `Bedrijf: ${p.company}` : null,
        '', p.message,
        '', `Campagne: ${p.campaign || '—'}`, p.ad ? `Advertentie: ${p.ad}` : null, `Formulier: ${p.form || '—'}`,
        '', 'Beloofd: binnen 24 uur bellen. Open je admin panel → Aanvragen',
      ], p.email || undefined);
    }
    return true;
  }

  // pull every form's leads since the last sync (with a day of overlap; Meta keeps leads for 90 days)
  async function sync(force) {
    if (state.syncing) return state.syncing;
    if (!(await token())) return { ok: false, error: 'not_configured' };
    if (!force && Date.now() - state.lastSync < 60000) return { ok: true, added: 0 };
    state.syncing = (async () => {
      state.lastSync = Date.now();
      let added = 0;
      try {
        const tok = await pageToken();
        const last = num(await getSetting('meta_synced_until'));
        const since = Math.floor((last ? last - DAY_MS : Date.now() - 89 * DAY_MS) / 1000);
        const startedAt = Date.now();
        const forms = await all(PAGE_ID + '/leadgen_forms', { fields: 'id,name,status', limit: '100' }, tok, 500);
        for (const form of forms) {
          const leads = await all(form.id + '/leads', {
            fields: LEAD_FIELDS, limit: '100',
            filtering: JSON.stringify([{ field: 'time_created', operator: 'GREATER_THAN', value: since }]),
          }, tok);
          for (const l of leads) if (await saveLead(l, form.name)) added++;
        }
        await setSetting('meta_synced_until', String(startedAt));
        state.lastOk = Date.now(); state.lastError = ''; state.lastAdded = added;
        if (added) console.log(`Meta sync: ${added} new lead(s)`);
        return { ok: true, added, forms: forms.length };
      } catch (e) {
        state.lastError = e.message === 'not_configured' ? '' : e.message;
        if (e.code === 190) state.pageToken = '';   // token expired or revoked
        console.error('Meta sync failed:', e.message);
        return { ok: false, error: e.message, added };
      } finally { state.syncing = null; }
    })();
    return state.syncing;
  }

  // ---------- webhook (instant delivery) ----------
  // Meta app → Webhooks → Page → subscribe to "leadgen"; callback URL /api/meta/webhook, verify token from the admin panel.
  app.get('/api/meta/webhook', h(async (req, res) => {
    const q = req.query;
    if (q['hub.mode'] === 'subscribe' && q['hub.verify_token'] && q['hub.verify_token'] === await verifyToken()) {
      return res.type('text/plain').send(String(q['hub.challenge'] || ''));
    }
    res.status(403).end();
  }));
  // server.js reads this route's body raw (before the JSON parser), so the signature can be checked
  app.post('/api/meta/webhook', rateLimit('meta-hook', 120), h(async (req, res) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
    if (APP_SECRET) {
      const sig = String(req.headers['x-hub-signature-256'] || '');
      const want = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(raw).digest('hex');
      if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return res.status(401).end();
    }
    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch (e) { return res.status(400).end(); }
    res.status(200).send('EVENT_RECEIVED');   // answer fast; Meta retries slow webhooks
    const ids = [];
    for (const entry of body.entry || []) for (const ch of entry.changes || []) {
      if (ch.field === 'leadgen' && ch.value && ch.value.leadgen_id) ids.push(String(ch.value.leadgen_id));
    }
    if (!ids.length) return;
    try {
      const tok = await pageToken();
      for (const id of ids) {
        const l = await graph(id, { fields: LEAD_FIELDS }, tok);
        let formName = '';
        if (l.form_id) { try { formName = (await graph(l.form_id, { fields: 'name' }, tok)).name || ''; } catch (e) {} }
        await saveLead(l, formName);
      }
    } catch (e) {
      console.error('Meta webhook lead fetch failed:', e.message);
      sync(true).catch(() => {});   // fall back to a full pull
    }
  }));

  // ---------- ad results ----------
  const leadsOf = actions => {
    const a = actions || [];
    for (const t of LEAD_ACTIONS) { const x = a.find(y => y.action_type === t); if (x) return num(x.value); }
    return 0;
  };
  const row = r => ({
    spend: num(r.spend), impressions: num(r.impressions), reach: num(r.reach), clicks: num(r.clicks),
    linkClicks: num(r.inline_link_clicks), leads: leadsOf(r.actions),
  });
  async function insights(days) {
    const key = 'i' + days;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
    const tok = await token();
    const until = dayKey(Date.now()), since = dayKey(Date.now() - (days - 1) * DAY_MS);
    const base = { time_range: JSON.stringify({ since, until }), limit: '500' };
    const F = 'spend,impressions,reach,clicks,inline_link_clicks,actions';
    const [acct, tot, daily, camps, ads, plats] = await Promise.all([
      graph(AD_ACCOUNT, { fields: 'name,currency,account_status,timezone_name,amount_spent' }, tok),
      graph(AD_ACCOUNT + '/insights', { ...base, level: 'account', fields: F }, tok),
      all(AD_ACCOUNT + '/insights', { ...base, level: 'account', fields: F, time_increment: '1' }, tok),
      all(AD_ACCOUNT + '/insights', { ...base, level: 'campaign', fields: 'campaign_id,campaign_name,' + F }, tok),
      all(AD_ACCOUNT + '/insights', { ...base, level: 'ad', fields: 'ad_id,ad_name,campaign_name,' + F }, tok),
      all(AD_ACCOUNT + '/insights', { ...base, level: 'account', fields: F, breakdowns: 'publisher_platform' }, tok),
    ]);
    const t = row((tot.data || [])[0] || {});
    const byDay = new Map(daily.map(d => [d.date_start, row(d)]));
    const series = [];
    for (let i = days - 1; i >= 0; i--) { const d = dayKey(Date.now() - i * DAY_MS); if (!series.some(s => s.day === d)) series.push({ day: d, ...(byDay.get(d) || row({})) }); }
    const data = {
      account: { name: acct.name, currency: acct.currency || 'EUR', status: acct.account_status, timezone: acct.timezone_name },
      since, until, totals: t, series,
      campaigns: camps.map(c => ({ id: c.campaign_id, name: c.campaign_name, ...row(c) })).sort((a, b) => b.spend - a.spend),
      ads: ads.map(c => ({ id: c.ad_id, name: c.ad_name, campaign: c.campaign_name, ...row(c) })).sort((a, b) => b.spend - a.spend),
      platforms: plats.map(p => ({ name: ({ instagram: 'Instagram', facebook: 'Facebook', audience_network: 'Audience Network', messenger: 'Messenger', threads: 'Threads' })[p.publisher_platform] || p.publisher_platform, ...row(p) }))
        .sort((a, b) => b.impressions - a.impressions),
    };
    cache.set(key, { at: Date.now(), data });
    return data;
  }

  // what Meta-sourced leads became, and how many website visits came from ads
  async function crmStats(days) {
    const db = getDb();
    const sinceTs = Date.now() - days * DAY_MS;
    const sinceSql = USE_PG ? new Date(sinceTs).toISOString() : new Date(sinceTs).toISOString().replace('T', ' ').slice(0, 19);
    const [{ rows: leads }, { rows: visits }] = await Promise.all([
      db.query("SELECT id,name,company,phone,email,status,campaign,ad,platform,created_at FROM leads WHERE source = 'meta' AND created_at >= $1 ORDER BY id DESC", [sinceSql]),
      db.query(`SELECT src, COUNT(DISTINCT sid) AS visits, COUNT(DISTINCT CASE WHEN type = 'cv' THEN sid END) AS conv
        FROM events WHERE ts >= $1 AND src IN ('Meta Ads', 'Instagram', 'Facebook') GROUP BY src`, [sinceTs]),
    ]);
    const by = s => leads.filter(l => l.status === s).length;
    const v = Object.fromEntries(visits.map(r => [r.src, { visits: num(r.visits), conv: num(r.conv) }]));
    return {
      leads: leads.length, new: by('new'), contacted: by('contacted'), won: by('won'), lost: by('lost'),
      latest: leads.slice(0, 8),
      siteVisits: { ads: v['Meta Ads'] || { visits: 0, conv: 0 }, instagram: v.Instagram || { visits: 0, conv: 0 }, facebook: v.Facebook || { visits: 0, conv: 0 } },
    };
  }

  async function status() {
    const tok = await token();
    const hit = cache.get('status');
    if (hit && hit.tok === tok && Date.now() - hit.at < CACHE_MS) return { ...hit.data, lastSync: state.lastOk || null, lastError: state.lastError, lastAdded: state.lastAdded };
    const s = await freshStatus(tok);
    cache.set('status', { at: Date.now(), tok, data: s });
    return s;
  }
  async function freshStatus(tok) {
    const s = { configured: !!tok, source: process.env.META_ACCESS_TOKEN ? 'env' : (tok ? 'admin' : ''), pageId: PAGE_ID, adAccount: AD_ACCOUNT,
      lastSync: state.lastOk || null, lastError: state.lastError, lastAdded: state.lastAdded, webhookSigned: !!APP_SECRET,
      verifyToken: await verifyToken(), webhookPath: '/api/meta/webhook', graphVersion: V };
    if (!tok) return s;
    try {
      const me = await graph('me', { fields: 'id,name' }, tok);
      s.tokenName = me.name;
      try {
        const perms = await graph('me/permissions', {}, tok);
        s.permissions = (perms.data || []).filter(p => p.status === 'granted').map(p => p.permission);
      } catch (e) { s.permissions = null; }   // Page and system-user tokens don't list permissions
      try {
        const dbg = await graph('debug_token', { input_token: tok }, tok);
        const exp = dbg.data && num(dbg.data.expires_at);
        s.expiresAt = exp ? exp * 1000 : 0;   // 0 = never
      } catch (e) {}
      await pageToken();
      s.pageName = state.pageName;
    } catch (e) { s.tokenError = e.message; }
    return s;
  }

  // ---------- admin API ----------
  app.get('/api/admin/meta', requireAuth, h(async (req, res) => {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 30));
    const st = await status();
    const out = { status: st, crm: await crmStats(days), days };
    if (st.configured && !st.tokenError) {
      try { out.ads = await insights(days); } catch (e) { out.adsError = e.message; }
    }
    res.json(out);
  }));
  app.post('/api/admin/meta/sync', requireAuth, rateLimit('meta-sync', 6), h(async (req, res) => {
    const r = await sync(true);
    cache.clear();
    res.json(r);
  }));
  // paste a token in the admin panel instead of the Render dashboard (the env var wins when both are set)
  app.post('/api/admin/meta/token', requireAuth, rateLimit('meta-token', 10), h(async (req, res) => {
    const t = str((req.body || {}).token, 600).replace(/\s+/g, '');
    if (t && !/^[A-Za-z0-9|_-]{40,600}$/.test(t)) return res.status(400).json({ error: 'Dit lijkt geen geldige Meta-token.' });
    if (t) {
      try { await graph('me', { fields: 'id' }, t); }
      catch (e) { return res.status(400).json({ error: 'Meta accepteert deze token niet: ' + e.message }); }
    }
    await setSetting('meta_token', t);
    state.pageToken = ''; cache.clear();
    if (t) await setSetting('meta_synced_until', '');
    const r = t ? await sync(true) : { ok: true };
    res.json({ ok: true, sync: r });
  }));

  return { init, sync };
};

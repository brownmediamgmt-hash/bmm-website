// Privacy-friendly site analytics: no cookies, no stored IPs.
// A visitor is a daily-rotating hash (salt+IP+browser), so visits can't be linked across days.
const express = require('express');
const crypto = require('crypto');
const { clientIp, locate, parseUA, trafficSource, countryName, NL_PROVINCES } = require('./lib/visitor');

const EVENT_TYPES = new Set(['pv', 'sv', 'ck', 'cv', 'qz', 'lv']);
const SID_RE = /^[a-z0-9]{8,32}$/i;
const RETENTION_DAYS = 400;
const DAY_MS = 86400000;

const dayKey = ts => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
const AMS = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Amsterdam', hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
// Amsterdam wall-clock parts of a timestamp
function ams(ts) {
  const p = {}; for (const x of AMS.formatToParts(new Date(ts))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, hr: +p.hour % 24, mi: +p.minute, s: +p.second,
    wd: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday) };
}
// UTC timestamp of Amsterdam midnight for the day containing ts (DST-safe)
function amsMidnight(ts) {
  const a = ams(ts);
  const offset = Date.UTC(a.y, a.mo - 1, a.d, a.hr, a.mi, a.s) - Math.floor(ts / 1000) * 1000;
  return Date.UTC(a.y, a.mo - 1, a.d) - offset;
}
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
const num = v => Number(v) || 0;

// Page order of the site's sections (for the scroll-reach funnel)
const SECTION_ORDER = ['top', 'work', 'services', 'process', 'check', 'pricing', 'booking', 'faq', 'regio'];

module.exports = function createAnalytics({ app, getDb, h, requireAuth, rateLimit, USE_PG, getSetting }) {
  // ---------- schema ----------
  async function init(db) {
    await db.query(`CREATE TABLE IF NOT EXISTS events (
      id ${USE_PG ? 'BIGSERIAL PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT'},
      ts BIGINT NOT NULL, day TEXT, vid TEXT, sid TEXT, type TEXT, path TEXT, section TEXT, label TEXT, extra TEXT,
      src TEXT, country TEXT, region TEXT, city TEXT, lat REAL, lon REAL, device TEXT, browser TEXT, os TEXT, lang TEXT)`);
    await db.query('CREATE INDEX IF NOT EXISTS events_ts ON events (ts)');
    await db.query('CREATE INDEX IF NOT EXISTS events_sid ON events (sid)');
    await db.query('CREATE INDEX IF NOT EXISTS events_type_ts ON events (type, ts)');
    await purge(db);
  }
  async function purge(db) {
    await db.query('DELETE FROM events WHERE ts < $1', [Date.now() - RETENTION_DAYS * DAY_MS]);
  }

  // ---------- ingest ----------
  // sendBeacon posts text/plain (no CORS preflight); parse it ourselves.
  app.post('/api/t', express.text({ type: () => true, limit: '24kb' }), rateLimit('track', 240), h(async (req, res) => {
    let body;
    try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; } catch (e) { return res.status(400).end(); }
    if (!body || typeof body !== 'object') return res.status(400).end();
    const sid = str(body.sid, 32);
    if (!SID_RE.test(sid)) return res.status(400).end();
    const list = Array.isArray(body.e) ? body.e.slice(0, 60) : [];
    if (!list.length) return res.status(204).end();

    const ua = parseUA(req.headers['user-agent']);
    if (ua.isBot) return res.status(204).end();

    const db = getDb();
    const now = Date.now();
    const day = dayKey(now);
    const salt = crypto.createHmac('sha256', await getSetting('analytics_secret')).update(day).digest('hex');
    const vid = crypto.createHash('sha256').update(salt + '|' + clientIp(req) + '|' + (req.headers['user-agent'] || '')).digest('hex').slice(0, 20);
    const geo = locate(req);
    const utm = body.u && typeof body.u === 'object' ? body.u : {};
    const src = trafficSource({ ref: str(body.r, 500), utmSource: str(utm.s, 60), browser: ua.browser });
    const path = str(body.p, 120) || '/';
    const lang = str(body.l, 5);

    const rows = [];
    for (const ev of list) {
      if (!ev || !EVENT_TYPES.has(ev.t)) continue;
      // events carry their offset from page load; clamp to "now" so clocks can't fake the past/future
      rows.push([now, day, vid, sid, ev.t, path, str(ev.s, 40), str(ev.l, 100), str(String(ev.x ?? ''), 160),
        src, geo.country, geo.region, geo.city, geo.lat, geo.lon, ua.device, ua.browser, ua.os, lang]);
    }
    if (!rows.length) return res.status(204).end();
    const cols = 19;
    const values = rows.map((_, i) => '(' + Array.from({ length: cols }, (_, j) => '$' + (i * cols + j + 1)).join(',') + ')').join(',');
    await db.query(`INSERT INTO events (ts,day,vid,sid,type,path,section,label,extra,src,country,region,city,lat,lon,device,browser,os,lang) VALUES ${values}`, rows.flat());
    res.status(204).end();
  }));

  // ---------- reporting ----------
  // Live view + journeys read raw events (small time windows); period reports below are counted in SQL.
  async function loadEvents(db, since, until) {
    const { rows } = await db.query(
      `SELECT ts,day,vid,sid,type,section,label,extra,src,country,region,city,lat,lon,device,browser,os
       FROM events WHERE ts >= $1 AND ts < $2 ORDER BY ts`, [since, until]);
    return rows.map(r => ({ ...r, ts: num(r.ts), lat: r.lat == null ? null : Number(r.lat), lon: r.lon == null ? null : Number(r.lon) }));
  }

  function summarize(events) {
    const sessions = new Map();
    for (const e of events) {
      let s = sessions.get(e.sid);
      if (!s) {
        s = { sid: e.sid, vid: e.vid, start: e.ts, end: e.ts, pv: 0, clicks: 0, sections: new Set(), conv: new Set(), dur: 0,
          src: e.src, country: e.country, region: e.region, city: e.city, lat: e.lat, lon: e.lon, device: e.device, browser: e.browser, os: e.os, qz: new Set() };
        sessions.set(e.sid, s);
      }
      s.end = Math.max(s.end, e.ts);
      if (e.type === 'pv') s.pv++;
      else if (e.type === 'ck') s.clicks++;
      else if (e.type === 'sv' && e.section) s.sections.add(e.section);
      else if (e.type === 'cv') s.conv.add(e.label);
      else if (e.type === 'qz') s.qz.add(String(e.label).split(':')[0]);
      else if (e.type === 'lv') s.dur = Math.max(s.dur, num(String(e.extra).split('|')[0]) * 1000);
    }
    for (const s of sessions.values()) {
      s.duration = Math.min(Math.max(s.dur, s.end - s.start), 2 * 3600 * 1000);
      s.engaged = s.duration >= 10000 || s.clicks > 0 || s.sections.size >= 2 || s.conv.size > 0;
    }
    return sessions;
  }

  const countBy = (items, keyFn, valFn = () => 1) => {
    const m = new Map();
    for (const it of items) { const k = keyFn(it); if (k == null || k === '') continue; m.set(k, (m.get(k) || 0) + valFn(it)); }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };

  // ---- period reports: counted by the database (one row per visit, not per event), so memory stays flat however busy the site gets ----
  async function sessionsOf(db, since, until) {
    const [{ rows }, { rows: lv }] = await Promise.all([
      db.query(`SELECT sid, MIN(vid) AS vid, MIN(ts) AS start, MAX(ts) AS last,
          MAX(src) AS src, MAX(country) AS country, MAX(region) AS region, MAX(city) AS city, MAX(lat) AS lat, MAX(lon) AS lon,
          MAX(device) AS device, MAX(browser) AS browser, MAX(os) AS os,
          SUM(CASE WHEN type = 'pv' THEN 1 ELSE 0 END) AS pv,
          SUM(CASE WHEN type = 'ck' THEN 1 ELSE 0 END) AS clicks,
          SUM(CASE WHEN type = 'cv' THEN 1 ELSE 0 END) AS conv,
          COUNT(DISTINCT CASE WHEN type = 'sv' THEN section END) AS nsec
        FROM events WHERE ts >= $1 AND ts < $2 GROUP BY sid`, [since, until]),
      db.query("SELECT sid, extra FROM events WHERE type = 'lv' AND ts >= $1 AND ts < $2", [since, until]),
    ]);
    const lvMs = new Map();
    for (const r of lv) lvMs.set(r.sid, Math.max(lvMs.get(r.sid) || 0, num(String(r.extra).split('|')[0]) * 1000));
    return rows.map(r => {
      const s = { sid: r.sid, vid: r.vid, start: num(r.start), last: num(r.last), src: r.src, country: r.country, region: r.region, city: r.city,
        lat: r.lat == null ? null : Number(r.lat), lon: r.lon == null ? null : Number(r.lon), device: r.device, browser: r.browser, os: r.os,
        pv: num(r.pv), clicks: num(r.clicks), conv: num(r.conv), nsec: num(r.nsec) };
      s.duration = Math.min(Math.max(lvMs.get(s.sid) || 0, s.last - s.start), 2 * 3600 * 1000);
      s.engaged = s.duration >= 10000 || s.clicks > 0 || s.nsec >= 2 || s.conv > 0;
      return s;
    }).filter(s => s.pv > 0 || s.nsec > 0 || s.clicks > 0);
  }
  async function periodTotals(db, since, until) {
    const [list, { rows }] = await Promise.all([sessionsOf(db, since, until), db.query(`SELECT COUNT(DISTINCT vid) AS visitors,
        SUM(CASE WHEN type = 'pv' THEN 1 ELSE 0 END) AS pageviews,
        SUM(CASE WHEN type = 'cv' THEN 1 ELSE 0 END) AS conversions,
        SUM(CASE WHEN type = 'ck' AND LOWER(label) LIKE 'whatsapp%' THEN 1 ELSE 0 END) AS whatsapp
      FROM events WHERE ts >= $1 AND ts < $2`, [since, until])]);
    const c = rows[0] || {};
    const totals = {
      visitors: num(c.visitors), sessions: list.length, pageviews: num(c.pageviews), conversions: num(c.conversions), whatsapp: num(c.whatsapp),
      avgDuration: list.length ? Math.round(list.reduce((a, s) => a + s.duration, 0) / list.length / 1000) : 0,
      engagedRate: list.length ? Math.round(list.filter(s => s.engaged).length / list.length * 100) : 0,
    };
    return { list, totals };
  }

  app.get('/api/admin/analytics', requireAuth, h(async (req, res) => {
    const db = getDb();
    const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 30));
    const now = Date.now();
    // "today" = since Amsterdam midnight; otherwise the last N×24h
    const since = days === 1 ? amsMidnight(now) : now - days * DAY_MS;
    const span = now - since;
    const q = sql => db.query(sql, [since, now + 1]).then(r => r.rows);
    const RANGE = 'ts >= $1 AND ts < $2';

    const [cur, prev, dayRows, reachRows, secClickRows, clickRows, convRows, qzRows, quizLeadRows, todayRows] = await Promise.all([
      periodTotals(db, since, now + 1),
      periodTotals(db, since - span, since),
      q(`SELECT day, COUNT(DISTINCT vid) AS visitors, COUNT(DISTINCT sid) AS sessions,
          SUM(CASE WHEN type = 'pv' THEN 1 ELSE 0 END) AS pageviews, SUM(CASE WHEN type = 'cv' THEN 1 ELSE 0 END) AS conversions
        FROM events WHERE ${RANGE} GROUP BY day`),
      q(`SELECT section, COUNT(DISTINCT sid) AS n FROM events WHERE type = 'sv' AND ${RANGE} GROUP BY section`),
      q(`SELECT section, COUNT(*) AS n FROM events WHERE type = 'ck' AND ${RANGE} GROUP BY section`),
      q(`SELECT label, section, COUNT(*) AS n FROM events WHERE type = 'ck' AND ${RANGE} GROUP BY label, section ORDER BY n DESC LIMIT 60`),
      q(`SELECT label, COUNT(*) AS n FROM events WHERE type = 'cv' AND ${RANGE} GROUP BY label ORDER BY n DESC`),
      q(`SELECT sid, label, MAX(ts) AS t FROM events WHERE type = 'qz' AND ${RANGE} GROUP BY sid, label`),
      q(`SELECT COUNT(DISTINCT sid) AS n FROM events WHERE type = 'cv' AND label = 'quiz_lead' AND ${RANGE}`),
      days === 1 ? q(`SELECT ts, vid, sid, type FROM events WHERE ${RANGE}`) : Promise.resolve(null),
    ]);
    const sessList = cur.list;

    // daily series (fill gaps)
    const dayList = [];
    if (days === 1) dayList.push(dayKey(now));
    else for (let i = days - 1; i >= 0; i--) { const d = dayKey(now - i * DAY_MS); if (!dayList.includes(d)) dayList.push(d); }
    const byDay = new Map(dayRows.map(r => [r.day, r]));
    const series = dayList.map(d => { const r = byDay.get(d) || {}; return { day: d, visitors: num(r.visitors), sessions: num(r.sessions), pageviews: num(r.pageviews), conversions: num(r.conversions) }; });
    // hourly series for "today"
    let hourly = null;
    if (todayRows) {
      const hrs = Array.from({ length: 24 }, (_, hour) => ({ hour, v: new Set(), s: new Set(), pageviews: 0, conversions: 0 }));
      for (const e of todayRows) {
        const b = hrs[ams(num(e.ts)).hr];
        b.v.add(e.vid); b.s.add(e.sid);
        if (e.type === 'pv') b.pageviews++;
        if (e.type === 'cv') b.conversions++;
      }
      hourly = hrs.map(b => ({ hour: b.hour, visitors: b.v.size, sessions: b.s.size, pageviews: b.pageviews, conversions: b.conversions }));
    }

    // geography (per visit)
    const countries = countBy(sessList, s => s.country || '??').map(([code, n]) => ({ code, name: code === '??' ? 'Onbekend' : countryName(code), sessions: n }));
    const nlSess = sessList.filter(s => s.country === 'NL');
    const provinces = Object.entries(NL_PROVINCES).map(([code, name]) => ({ code, name, sessions: nlSess.filter(s => s.region === code).length }))
      .sort((a, b) => b.sessions - a.sessions);
    const cities = countBy(sessList.filter(s => s.city), s => s.city + '|' + s.region + '|' + s.country).slice(0, 25).map(([k, n]) => {
      const [city, region, country] = k.split('|');
      const any = sessList.find(s => s.city === city && s.country === country && s.lat != null);
      return { city, region, regionName: country === 'NL' ? (NL_PROVINCES[region] || region) : region, country, sessions: n, lat: any ? any.lat : null, lon: any ? any.lon : null };
    });

    // acquisition & tech
    const sources = countBy(sessList, s => s.src || 'Direct').map(([name, n]) => ({
      name, sessions: n, conversions: sessList.filter(s => (s.src || 'Direct') === name && s.conv > 0).length,
    }));
    const devices = countBy(sessList, s => s.device).map(([name, n]) => ({ name, sessions: n }));
    const browsers = countBy(sessList, s => s.browser).map(([name, n]) => ({ name, sessions: n }));
    const oses = countBy(sessList, s => s.os).map(([name, n]) => ({ name, sessions: n }));

    // behaviour: how far down the page people get, and what they click
    const reach = new Map(reachRows.map(r => [r.section, num(r.n)]));
    const secClicks = new Map(secClickRows.map(r => [r.section || 'overig', num(r.n)]));
    const sections = SECTION_ORDER.map(id => ({ id, reach: reach.get(id) || 0, clicks: secClicks.get(id) || 0 }));
    const otherClickSections = [...secClicks].filter(([id]) => !SECTION_ORDER.includes(id)).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, reach: null, clicks: n }));
    const clicks = clickRows.map(r => ({ label: r.label || '—', section: r.section || '', count: num(r.n) }));
    const conversions = convRows.map(r => ({ label: r.label, count: num(r.n) }));
    // video-check: visits per step, and the answer each visit ended up with per step
    const stepSids = new Map(), last = new Map();
    for (const r of qzRows) {
      const lbl = String(r.label || ''), step = lbl.split(':')[0];
      if (!stepSids.has(step)) stepSids.set(step, new Set());
      stepSids.get(step).add(r.sid);
      const k = r.sid + '|' + step, t = num(r.t);
      if (!last.has(k) || last.get(k).t < t) last.set(k, { label: lbl, t });
    }
    const quiz = ['step1', 'step2', 'step3', 'step4', 'result'].map(st => ({ step: st, sessions: (stepSids.get(st) || new Set()).size }))
      .concat([{ step: 'lead', sessions: num(quizLeadRows[0] && quizLeadRows[0].n) }]);
    const quizAnswers = countBy([...last.values()], a => a.label).map(([label, n]) => ({ label, count: n }));

    // when do people visit (weekday × hour, Amsterdam time)
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
    for (const s of sessList) { const a = ams(s.start); if (a.wd >= 0) heat[a.wd][a.hr]++; }

    res.json({
      days, since, until: now, totals: cur.totals, prev: prev.totals, series, hourly,
      countries, provinces, cities, sources, devices, browsers, oses,
      sections, otherClickSections, clicks, conversions, quiz, quizAnswers, heat,
    });
  }));

  // who's on the site right now (last 5 minutes)
  app.get('/api/admin/live', requireAuth, h(async (req, res) => {
    const db = getDb();
    const now = Date.now();
    const events = await loadEvents(db, now - 30 * 60000, now + 1);
    const sessions = summarize(events);
    const active = [...sessions.values()].filter(s => now - s.end < 5 * 60000 && !events.some(e => e.sid === s.sid && e.type === 'lv' && e.ts >= s.end))
      .sort((a, b) => b.end - a.end)
      .map(s => {
        const last = [...events].reverse().find(e => e.sid === s.sid && (e.type === 'sv' || e.type === 'ck'));
        return { sid: s.sid, city: s.city, region: s.region, country: s.country, device: s.device, browser: s.browser, src: s.src,
          since: s.start, last: s.end, section: last ? last.section : 'top', clicks: s.clicks };
      });
    const feed = events.filter(e => e.type !== 'lv').slice(-40).reverse()
      .map(e => ({ ts: e.ts, type: e.type, section: e.section, label: e.label, city: e.city, country: e.country, device: e.device, sid: e.sid }));
    res.json({ active, feed });
  }));

  // one visitor's journey (used to show how a lead found you)
  app.get('/api/admin/journey/:sid', requireAuth, h(async (req, res) => {
    const sid = String(req.params.sid || '');
    if (!SID_RE.test(sid)) return res.status(400).json({ error: 'bad sid' });
    const { rows } = await getDb().query('SELECT ts,type,section,label,extra,src,country,region,city,device,browser,os FROM events WHERE sid = $1 ORDER BY ts LIMIT 400', [sid]);
    res.json(rows.map(r => ({ ...r, ts: num(r.ts), regionName: r.country === 'NL' ? (NL_PROVINCES[r.region] || r.region) : r.region })));
  }));

  // wipe statistics (e.g. to remove test visits)
  app.delete('/api/admin/analytics', requireAuth, h(async (req, res) => {
    if (!req.body || req.body.confirm !== 'WISSEN') return res.status(400).json({ error: 'confirm' });
    await getDb().query('DELETE FROM events');
    res.json({ ok: true });
  }));

  // session summary for a lead/booking (source, location, device, what they did before contacting)
  async function sessionSummary(sid) {
    if (!SID_RE.test(String(sid || ''))) return null;
    const { rows } = await getDb().query('SELECT ts,type,section,label,src,country,region,city,device,browser FROM events WHERE sid = $1 ORDER BY ts LIMIT 400', [sid]);
    if (!rows.length) return null;
    const first = rows[0];
    const secs = [...new Set(rows.filter(r => r.type === 'sv').map(r => r.section))];
    return { src: first.src, country: first.country, region: first.region, city: first.city, device: first.device, browser: first.browser,
      sections: secs, clicks: rows.filter(r => r.type === 'ck').length, start: num(first.ts) };
  }

  setInterval(() => { try { purge(getDb()).catch(() => {}); } catch (e) {} }, DAY_MS).unref();

  return { init, sessionSummary, dayKey };
};

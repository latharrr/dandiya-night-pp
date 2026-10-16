'use strict';
/* Referral links: custom codes (dandiya.picapool.tech/<code>) with per-link analytics. The app already treats the first
   path segment as the ref; this only adds a link registry plus read-only analytics. */
module.exports = function install({ route, admin, q, bad }) {
  q('CREATE TABLE IF NOT EXISTS ref_links(code TEXT PRIMARY KEY, label TEXT, created_at INTEGER)').run();
  const J = s => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  const sp = url => (typeof url === 'string' ? new URL(url, 'http://x').searchParams : url.searchParams);
  const RESERVED = ['admin', 'api', 'photos', 'favicon.ico', 'new', 'static', 'public', 'index', 'index.html'];
  const one = (sql, ...a) => q(sql).get(...a) || {};

  function stats(code) {
    const v = one(`SELECT COUNT(DISTINCT session_id) visitors, COUNT(*) events, MIN(ts) first_ts, MAX(ts) last_ts FROM events WHERE ref=?`, code);
    const lv = one(`SELECT COUNT(*) n, COUNT(DISTINCT session_id) s FROM events WHERE ref=? AND event='landing_view'`, code);
    const u = one(`SELECT COUNT(*) started, SUM(completed_at IS NOT NULL) signed_up FROM users WHERE ref=?`, code);
    const o = one(`SELECT COUNT(DISTINCT session_id) n FROM events WHERE ref=? AND event='otp_sent'`, code);
    const sw = one(`SELECT COUNT(*) swipes, SUM(dir='right') likes FROM swipes WHERE from_id IN (SELECT id FROM users WHERE ref=?)`, code);
    const m = one(`SELECT COUNT(*) n FROM matches WHERE a IN (SELECT id FROM users WHERE ref=?) OR b IN (SELECT id FROM users WHERE ref=?)`, code, code);
    const act = one(`SELECT COUNT(DISTINCT user_id) n FROM events WHERE ref=? AND user_id IS NOT NULL AND event='swipe'`, code);
    return { visitors: v.visitors || 0, events: v.events || 0, first_ts: v.first_ts || null, last_ts: v.last_ts || null,
      landing_views: lv.n || 0, otp_requested: o.n || 0, accounts_started: u.started || 0, signed_up: u.signed_up || 0,
      swipers: act.n || 0, swipes: sw.swipes || 0, likes: sw.likes || 0, matches: m.n || 0 };
  }

  route('GET', '/api/admin/links', ({ req, url }) => {
    admin(req, url);
    const reg = new Map(q('SELECT code, label, created_at FROM ref_links').all().map(r => [r.code, r]));
    const codes = new Set(reg.keys());
    q(`SELECT DISTINCT ref FROM events WHERE ref IS NOT NULL AND ref<>''`).all().forEach(r => codes.add(r.ref));
    q(`SELECT DISTINCT ref FROM users WHERE ref IS NOT NULL AND ref<>''`).all().forEach(r => codes.add(r.ref));
    const links = [...codes].map(code => ({ code, label: reg.get(code)?.label || '', created_at: reg.get(code)?.created_at || null, custom: reg.has(code), ...stats(code) }));
    const nr = one(`SELECT COUNT(DISTINCT session_id) visitors FROM events WHERE (ref IS NULL OR ref='')`);
    const nu = one(`SELECT COUNT(*) started, SUM(completed_at IS NOT NULL) signed_up FROM users WHERE (ref IS NULL OR ref='')`);
    return { links, direct: { visitors: nr.visitors || 0, accounts_started: nu.started || 0, signed_up: nu.signed_up || 0 } };
  });

  route('POST', '/api/admin/links', ({ req, url, body }) => {
    admin(req, url);
    const code = String(body.code || '').trim().toLowerCase();
    const label = String(body.label || '').trim().slice(0, 80);
    if (!/^[a-z0-9][a-z0-9_-]{1,38}$/.test(code)) bad('Code must be 2 to 39 characters: letters, numbers, - or _.');
    if (RESERVED.includes(code)) bad('That code is reserved. Pick another.');
    const ex = q('SELECT 1 FROM ref_links WHERE code=?').get(code);
    if (ex) { q('UPDATE ref_links SET label=? WHERE code=?').run(label, code); return { ok: true, code, updated: true }; }
    q('INSERT INTO ref_links(code, label, created_at) VALUES(?,?,?)').run(code, label, Date.now());
    return { ok: true, code, created: true };
  });

  route('GET', '/api/admin/link', ({ req, url }) => {
    admin(req, url);
    const code = String(sp(url).get('ref') || '');
    if (!code) bad('ref required');
    const reg = q('SELECT code, label, created_at FROM ref_links WHERE code=?').get(code) || null;
    const funnel = q(`SELECT event, COUNT(DISTINCT session_id) sessions, COUNT(*) total FROM events WHERE ref=? GROUP BY event ORDER BY total DESC`).all(code);
    const days = q(`SELECT date(ts/1000,'unixepoch','+5 hours','+30 minutes') day, COUNT(DISTINCT session_id) visitors, COUNT(*) events FROM events WHERE ref=? GROUP BY 1 ORDER BY 1 DESC`).all(code);
    const users = q(`SELECT u.id, u.phone, u.first_name name, u.gender, u.college, u.created_at, u.completed_at,
      (SELECT MAX(ts) FROM events e WHERE e.user_id=u.id) last_seen,
      (SELECT COUNT(*) FROM events e WHERE e.user_id=u.id) events,
      (SELECT COUNT(*) FROM swipes s WHERE s.from_id=u.id AND s.dir='right') likes_given,
      (SELECT COUNT(*) FROM swipes s WHERE s.from_id=u.id AND s.dir='left') passes,
      (SELECT COUNT(*) FROM swipes s WHERE s.to_id=u.id AND s.dir='right') likes_received,
      (SELECT COUNT(*) FROM matches m WHERE m.a=u.id OR m.b=u.id) matches
      FROM users u WHERE u.ref=? ORDER BY u.created_at DESC`).all(code);
    const visitors = q(`SELECT e.session_id, MIN(e.ts) first_ts, MAX(e.ts) last_ts, COUNT(*) events,
      (SELECT x.user_id FROM events x WHERE x.session_id=e.session_id AND x.user_id IS NOT NULL LIMIT 1) user_id
      FROM events e WHERE e.ref=? AND e.session_id IS NOT NULL GROUP BY e.session_id ORDER BY first_ts DESC LIMIT 1000`).all(code);
    const nm = new Map(users.map(u => [u.id, u]));
    visitors.forEach(v => { const u = nm.get(v.user_id); v.name = u ? u.name : null; v.phone = u ? u.phone : null; });
    const events = q(`SELECT e.ts, e.event, e.session_id, e.data, e.user_id, u.first_name name, u.phone FROM events e LEFT JOIN users u ON u.id=e.user_id
      WHERE e.ref=? OR e.user_id IN (SELECT id FROM users WHERE ref=?) ORDER BY e.ts DESC LIMIT 600`).all(code, code)
      .map(e => ({ ...e, data: J(e.data) }));
    return { code, label: reg?.label || '', created_at: reg?.created_at || null, stats: stats(code), funnel, days, users, visitors, events };
  });
};

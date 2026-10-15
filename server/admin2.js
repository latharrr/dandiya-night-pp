'use strict';
/* Extra admin endpoints: people, per-user detail, analytics, feeds. Read-only. */
module.exports = function install({ route, admin, q, bad }) {
  const J = s => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  const sp = url => (typeof url === 'string' ? new URL(url, 'http://x').searchParams : url.searchParams);
  const lim = (v, d, m) => Math.max(1, Math.min(m, parseInt(v, 10) || d));
  const IST = "'+5 hours', '+30 minutes'";
  const prof = d => {
    const p = J(d) || {};
    return { photos: (p.photos || []).length, plans: p.plans || [], lookingFor: p.lookingFor, skill: p.skill, style: p.style, ride: p.ride, seats: p.seats, rideConsent: p.rideConsent, paused: !!p.paused, inBoard: p.inBoard, prompt: p.prompt, outfit: p.outfit, sticks: p.sticks, knuckle: p.knuckle };
  };

  route('GET', '/api/admin/people', ({ req, url }) => {
    admin(req, url);
    const rows = q(`SELECT u.id, u.phone, u.first_name name, u.gender, u.college, u.adult, u.ref, u.entry, u.created_at, u.completed_at, u.picapool_id, u.identity_conflict,
      (SELECT MAX(ts) FROM events e WHERE e.user_id=u.id) last_seen,
      (SELECT COUNT(*) FROM events e WHERE e.user_id=u.id) events,
      (SELECT COUNT(DISTINCT e.session_id) FROM events e WHERE e.user_id=u.id) visits,
      (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id) logins,
      (SELECT MAX(s.created_at) FROM sessions s WHERE s.user_id=u.id) last_login,
      (SELECT COUNT(*) FROM swipes w WHERE w.from_id=u.id AND w.dir='right') likes_given,
      (SELECT COUNT(*) FROM swipes w WHERE w.from_id=u.id AND w.dir='left') passes_given,
      (SELECT COUNT(*) FROM swipes w WHERE w.to_id=u.id AND w.dir='right') likes_received,
      (SELECT COUNT(*) FROM matches m WHERE m.a=u.id OR m.b=u.id) matches,
      p.data pdata, p.hidden, p.hide_source, p.edit_used, p.banned, p.in_board
      FROM users u LEFT JOIN profiles p ON p.user_id=u.id
      ORDER BY COALESCE((SELECT MAX(ts) FROM events e WHERE e.user_id=u.id), u.created_at) DESC`).all();
    return { people: rows.map(r => { const { pdata, ...rest } = r; return { ...rest, profile: prof(pdata) }; }) };
  });

  route('GET', '/api/admin/user', ({ req, url }) => {
    admin(req, url);
    const id = sp(url).get('id');
    if (!id) bad('id required');
    const u = q('SELECT * FROM users WHERE id=?').get(id);
    if (!u) bad('No such user.', 404);
    const p = q('SELECT * FROM profiles WHERE user_id=?').get(id);
    const out = q(`SELECT w.dir, w.day, w.at, w.retried, w.to_id id, x.first_name name, x.phone, x.college FROM swipes w LEFT JOIN users x ON x.id=w.to_id WHERE w.from_id=? ORDER BY w.at DESC LIMIT 500`).all(id);
    const inn = q(`SELECT w.dir, w.day, w.at, w.from_id id, x.first_name name, x.phone, x.college FROM swipes w LEFT JOIN users x ON x.id=w.from_id WHERE w.to_id=? ORDER BY w.at DESC LIMIT 500`).all(id);
    const matches = q(`SELECT m.id, m.created_at, m.chat_id, m.a_share, m.b_share, m.req_by, m.req_at,
        x.id other_id, x.first_name name, x.phone, x.college
      FROM matches m JOIN users x ON x.id = CASE WHEN m.a=? THEN m.b ELSE m.a END
      WHERE m.a=? OR m.b=? ORDER BY m.created_at DESC`).all(id, id, id);
    const events = q('SELECT ts, event, session_id, ref, data FROM events WHERE user_id=? ORDER BY ts DESC LIMIT 600').all(id)
      .map(e => ({ ...e, data: J(e.data) }));
    const logins = q('SELECT created_at FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 100').all(id);
    const ride = q('SELECT ride, seats, venue, saved_at FROM ride_intents WHERE user_id=?').all(id);
    const { identity_conflict, ...user } = u;
    return { user: { ...user, identity_conflict }, hidden: p ? p.hidden : null, in_board: p ? p.in_board : null, hide_source: p ? p.hide_source : null, banned: p ? p.banned : null, edit_used: p ? p.edit_used : null,
      profile: p ? prof(p.data) : null, profileRaw: p ? J(p.data) : null, swipesOut: out, swipesIn: inn, matches, events, logins, ride };
  });

  route('GET', '/api/admin/analytics', ({ req, url }) => {
    admin(req, url);
    const who = "COALESCE(session_id, user_id)";
    const funnel = q(`SELECT event, COUNT(*) total, COUNT(DISTINCT ${who}) uniq FROM events GROUP BY event ORDER BY total DESC`).all();
    const daily = q(`SELECT date(ts/1000,'unixepoch',${IST}) day, COUNT(*) events, COUNT(DISTINCT user_id) active_users, COUNT(DISTINCT ${who}) visitors FROM events GROUP BY day ORDER BY day`).all();
    const hourly = q(`SELECT CAST(strftime('%H', ts/1000,'unixepoch',${IST}) AS INTEGER) hour, COUNT(*) events FROM events GROUP BY hour ORDER BY hour`).all();
    const swipesDaily = q(`SELECT date(at/1000,'unixepoch',${IST}) day, SUM(dir='right') likes, SUM(dir='left') passes FROM swipes GROUP BY day ORDER BY day`).all();
    const signupsDaily = q(`SELECT date(completed_at/1000,'unixepoch',${IST}) day, COUNT(*) n FROM users WHERE completed_at IS NOT NULL GROUP BY day ORDER BY day`).all();
    const matchesDaily = q(`SELECT date(created_at/1000,'unixepoch',${IST}) day, COUNT(*) n FROM matches GROUP BY day ORDER BY day`).all();
    const colleges = q(`SELECT COALESCE(college,'(none)') college, COUNT(*) users FROM users WHERE completed_at IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 50`).all();
    const gender = q(`SELECT COALESCE(gender,'(none)') gender, COUNT(*) users FROM users WHERE completed_at IS NOT NULL GROUP BY 1`).all();
    const refs = q(`SELECT COALESCE(ref,'(none)') ref, COUNT(*) users FROM users WHERE completed_at IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 30`).all();
    const one = sql => q(sql).get();
    const totals = {
      users: one('SELECT COUNT(*) n FROM users').n,
      signedUp: one('SELECT COUNT(*) n FROM users WHERE completed_at IS NOT NULL').n,
      swipes: one('SELECT COUNT(*) n FROM swipes').n,
      likes: one("SELECT COUNT(*) n FROM swipes WHERE dir='right'").n,
      matches: one('SELECT COUNT(*) n FROM matches').n,
      events: one('SELECT COUNT(*) n FROM events').n,
      firstEvent: one('SELECT MIN(ts) t FROM events').t,
      lastEvent: one('SELECT MAX(ts) t FROM events').t,
      swipers: one('SELECT COUNT(DISTINCT from_id) n FROM swipes').n,
    };
    const onboard = onboardFunnel();
  return { totals, funnel, daily, hourly, swipesDaily, signupsDaily, matchesDaily, colleges, gender, refs, onboard };

function onboardFunnel() {
  const g = (sql) => q(sql).get().n;
  return {
    otp_sent: g('SELECT COUNT(*) n FROM otps'),
    verified: g('SELECT COUNT(*) n FROM users'),
    profile: g('SELECT COUNT(*) n FROM users WHERE completed_at IS NOT NULL'),
    first_swipe: g('SELECT COUNT(DISTINCT from_id) n FROM swipes'),
    first_match: g('SELECT COUNT(DISTINCT u) n FROM (SELECT a AS u FROM matches UNION SELECT b AS u FROM matches)'),
  };
}
  });

  route('GET', '/api/admin/feed', ({ req, url }) => {
    admin(req, url);
    const s = sp(url), ev = s.get('event'), n = lim(s.get('limit'), 300, 2000);
    const rows = q(`SELECT e.ts, e.event, e.session_id, e.ref, e.data, e.user_id, u.first_name name, u.phone
      FROM events e LEFT JOIN users u ON u.id=e.user_id ${ev ? 'WHERE e.event=?' : ''} ORDER BY e.ts DESC LIMIT ${n}`);
    return { events: (ev ? rows.all(ev) : rows.all()).map(e => ({ ...e, data: J(e.data) })) };
  });

  route('GET', '/api/admin/swipes', ({ req, url }) => {
    admin(req, url);
    const n = lim(sp(url).get('limit'), 1000, 5000);
    return { swipes: q(`SELECT w.at, w.day, w.dir, w.retried, w.from_id, a.first_name from_name, a.phone from_phone, a.college from_college,
      w.to_id, b.first_name to_name, b.phone to_phone, b.college to_college,
      EXISTS(SELECT 1 FROM matches m WHERE (m.a=w.from_id AND m.b=w.to_id) OR (m.a=w.to_id AND m.b=w.from_id)) matched
      FROM swipes w LEFT JOIN users a ON a.id=w.from_id LEFT JOIN users b ON b.id=w.to_id ORDER BY w.at DESC LIMIT ${n}`).all() };
  });

  route('GET', '/api/admin/matches', ({ req, url }) => {
    admin(req, url);
    return { matches: q(`SELECT m.id, m.created_at, m.chat_id, m.a_share, m.b_share, m.req_by, m.req_at,
      m.a a_id, a.first_name a_name, a.phone a_phone, a.college a_college, m.b b_id, b.first_name b_name, b.phone b_phone, b.college b_college
      FROM matches m LEFT JOIN users a ON a.id=m.a LEFT JOIN users b ON b.id=m.b ORDER BY m.created_at DESC LIMIT 2000`).all() };
  });
  require('./admin3.js')({ route, admin, q, bad });
};

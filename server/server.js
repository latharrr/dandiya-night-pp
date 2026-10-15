/*
 * Dandiya Nights (built on Stick Together) · Picapool Navratri app · reference backend
 * Zero dependencies. Node 22.13+ (uses built-in node:sqlite).
 * Serves the page (public/index.html), the API (/api/*), photos (/photos/*) and a small admin page (/admin).
 * Connect Picapool in integrations.js. Configure with env vars (see HANDOFF.md §3).
 */
'use strict';
const _emit = process.emitWarning;
process.emitWarning = (w, ...a) => (String(w && w.message || w).includes('SQLite') ? undefined : _emit.call(process, w, ...a));

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const integrations = require('./integrations');

/* ---------------- config ---------------- */
const ENV = process.env;
const PROD = ENV.NODE_ENV === 'production';
/* Dev shortcuts (fixed login code, default admin key) only work when NODE_ENV is explicitly 'development' or 'test'.
   A deployment that forgets NODE_ENV gets the safe behaviour: real codes only, no admin until ADMIN_KEY is set. */
const DEV_MODE = ['development', 'test'].includes(ENV.NODE_ENV);
const C = {
  PORT: +(ENV.PORT || 8080),
  DATA_DIR: path.resolve(ENV.DATA_DIR || path.join(__dirname, 'data')),
  ADMIN_KEY: ENV.ADMIN_KEY || (DEV_MODE ? 'dev-admin' : ''),
  DAILY_RIGHT_CAP: +(ENV.DAILY_RIGHT_CAP || 40),
  OTP_LENGTH: +(ENV.OTP_LENGTH || 4),
  OTP_TTL_MS: 10 * 60e3,
  DELETE_ON: ENV.DELETE_ON || '2026-10-20',
  DEEPLINK: ENV.DEEPLINK || 'picapool://chat/{chatId}',
  CORS_ORIGIN: ENV.CORS_ORIGIN || '', // empty = same-origin only (the page is served by this server). Set only if the page lives on another domain
  PUBLIC_URL: (ENV.PUBLIC_URL || '').replace(/\/$/, ''),
  REPORT_HIDE: +(ENV.REPORT_HIDE || 3),
  LB_REFRESH_MS: +(ENV.LB_REFRESH_MS ?? 15e3), // leaderboard is recomputed at most every 15 s; the page refreshes an open board every 15 s
  STATS_REFRESH_MS: +(ENV.STATS_REFRESH_MS || 5 * 60e3),
  PREVIEW_CACHE_MS: +(ENV.PREVIEW_CACHE_MS ?? 120e3), // the guest peek is recomputed at most this often
  TRUST_PROXY: ENV.TRUST_PROXY === '1',
  DEV_OTP: DEV_MODE ? (ENV.DEV_OTP || null) : null,
  SESSION_DAYS: +(ENV.SESSION_DAYS || 30),       // a login lasts this long, then the code is asked again
  OTP_PER_IP_HOUR: +(ENV.OTP_PER_IP_HOUR || 40), // codes one network can request per hour (stops bulk sending; a hostel shares one IP, so not too low)
  VERIFY_PER_IP_HOUR: +(ENV.VERIFY_PER_IP_HOUR || 120),
  PICAPOOL_WEBHOOK_SECRET: ENV.PICAPOOL_WEBHOOK_SECRET || '', // shared secret for Picapool's backend to push account changes (§4b of HANDOFF)
  MAX_PHOTOS: 5,        // keep equal to CONFIG.MAX_PHOTOS in the page
  MAX_PLANS: 5,         // events one person can add (name + dates + time); keep equal to CONFIG.MAX_PLANS
  BOARD_SIZE: 20,       // top N per board (Garba Queen / Garba King); keep equal to CONFIG.BOARD_SIZE
  PREVIEW_MAX: 5,       // guests peek at no more than this many people per request (the page also caps them at 5 in total)
  SAMPLE_PROFILES: ENV.SAMPLE_PROFILES !== '0', // fill the guest peek with labelled sample people (samples.json) while there are fewer than 5 real ones
  SHOW_COUNTS: ENV.SHOW_COUNTS !== '0',         // the page shows "184 girls from North Campus are going"; 0 = never send counts
  COUNT_MIN: +(ENV.COUNT_MIN || 20),            // below this many people the count is not sent (the page shows the line without a number)
};
// Women-only colleges: never accepted for a guy's account (the page doesn't offer them either)
const WOMEN_ONLY_COLLEGES = ['daulat ram college', 'daulat ram', 'indraprastha college for women', 'miranda house'];
if (PROD && !C.ADMIN_KEY) { console.error('Set ADMIN_KEY in production.'); process.exit(1); }
if (!PROD && !DEV_MODE) console.warn('[warn] NODE_ENV is not set. Running with production-safe defaults (no default admin key, no fixed login code). Use NODE_ENV=production on the server, NODE_ENV=development locally.');
if (C.ADMIN_KEY && C.ADMIN_KEY.length < 16 && !DEV_MODE) console.warn('[warn] ADMIN_KEY is short. Use a long random value.');
/* constant-time comparison for secrets (admin key, webhook secret, code hashes) */
const same = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
// Navratri 2026, 11–19 Oct (keep equal to CONFIG.NIGHTS in the page). The dates someone can say they're going to an event.
const DATES = Array.from({length: 9}, (_, i) => `2026-10-${String(11 + i).padStart(2, '0')}`);
const TIME_OK = /^([01]\d|2[0-3]):[0-5]\d$/;
const ENUMS = {
  gender: ['female','male'], lookingFor: ['one','every'], skill: ['learning','hold','main'], style: ['garba','dandiya','both'],
  sticks: ['have','spare','need'], outfit: ['night','own','match'], knuckle: ['tap','click','breaker'], ride: ['own','cab','metro','need'],
  prompt: ['anthem','teach','find','flag'],
};
const SKILL_LEVEL = {learning: 0, hold: 1, main: 2};
const PHOTO_DIR = path.join(C.DATA_DIR, 'photos');
/* Photos and the database live in DATA_DIR, so it must be a real, persistent disk. Serverless hosts (Vercel, Netlify) wipe it. */
if (ENV.VERCEL || ENV.NETLIFY || ENV.AWS_LAMBDA_FUNCTION_NAME) { console.error('This server needs a persistent disk for photos and the database. Run it on a VPS / Docker with a volume, not on serverless functions (HANDOFF §3).'); process.exit(1); }
fs.mkdirSync(PHOTO_DIR, {recursive: true});
const storageOk = () => { try { const f = path.join(PHOTO_DIR, '.write-test'); fs.writeFileSync(f, 'ok'); fs.rmSync(f); return true; } catch (e) { return false; } };
if (!storageOk()) { console.error(`Can't write to ${PHOTO_DIR}. Set DATA_DIR to a folder this process can write to.`); process.exit(1); }

/* ---------------- db ---------------- */
const db = new DatabaseSync(path.join(C.DATA_DIR, 'dandiya.db'));
db.exec(`
PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, phone TEXT UNIQUE NOT NULL, first_name TEXT, gender TEXT, college TEXT, adult INTEGER DEFAULT 0,
  picapool_id TEXT, ref TEXT, entry TEXT, session_id TEXT, created_at INTEGER, completed_at INTEGER);
CREATE TABLE IF NOT EXISTS otps(phone TEXT PRIMARY KEY, code_hash TEXT, expires_at INTEGER, attempts INTEGER DEFAULT 0, last_sent INTEGER, window_start INTEGER, window_count INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER);
CREATE TABLE IF NOT EXISTS profiles(user_id TEXT PRIMARY KEY, data TEXT NOT NULL, in_board INTEGER DEFAULT 0, hidden INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS swipes(from_id TEXT, to_id TEXT, dir TEXT, day TEXT, at INTEGER, retried INTEGER DEFAULT 0, PRIMARY KEY(from_id, to_id));
CREATE INDEX IF NOT EXISTS swipes_to ON swipes(to_id, dir, day);
CREATE INDEX IF NOT EXISTS swipes_from_day ON swipes(from_id, dir, day);
CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY, a TEXT, b TEXT, created_at INTEGER, chat_id TEXT, a_share INTEGER DEFAULT 0, b_share INTEGER DEFAULT 0, UNIQUE(a, b));
CREATE TABLE IF NOT EXISTS blocks(from_id TEXT, to_id TEXT, PRIMARY KEY(from_id, to_id));
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY AUTOINCREMENT, from_id TEXT, to_id TEXT, reason TEXT, at INTEGER, resolved INTEGER DEFAULT 0, UNIQUE(from_id, to_id));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, event TEXT, user_id TEXT, session_id TEXT, ref TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS age_blocks(at INTEGER, ref TEXT);
CREATE TABLE IF NOT EXISTS ride_intents(user_id TEXT PRIMARY KEY, ride TEXT, seats INTEGER, venue TEXT, saved_at INTEGER);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
`);
// build j: a match can hold one pending message request (sender has Picapool, the other person doesn't yet)
for (const col of ['req_by TEXT', 'req_opener TEXT', 'req_at INTEGER']) { try { db.exec(`ALTER TABLE matches ADD COLUMN ${col}`); } catch (e) { /* already there */ } }
// build k: identity sync with Picapool, and "Not for me" on likes you received
for (const col of ['identity_conflict TEXT', 'picapool_synced_at INTEGER']) { try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch (e) { /* already there */ } }
db.exec(`CREATE TABLE IF NOT EXISTS dismissed(from_id TEXT, to_id TEXT, at INTEGER, PRIMARY KEY(from_id, to_id))`);
// v2.1: indexes for the lookups that run on every poll (pairs by either side, reports per person, sessions per user)
db.exec(`CREATE INDEX IF NOT EXISTS matches_b ON matches(b);
CREATE INDEX IF NOT EXISTS reports_to ON reports(to_id, resolved);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS profiles_board ON profiles(in_board, hidden);`);
const q = sql => db.prepare(sql);
/* A card is visible to others when it isn't hidden by an admin, has at least one photo and isn't paused by its owner.
   v2: a card can exist without a photo (the photo is asked for after the first swipe); until then nobody sees it. */
const VISIBLE = a => `${a}.hidden=0 AND json_array_length(${a}.data,'$.photos')>0 AND COALESCE(json_extract(${a}.data,'$.paused'),0)=0`;
const visibleCard = p => !!p && (p.photos || []).length > 0 && !p.paused;
const tx = fn => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

/* ---------------- helpers ---------------- */
const now = () => Date.now();
const istDay = (t = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata'}).format(t);
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const rid = (p, n = 10) => p + crypto.randomBytes(n).toString('hex');
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m, s = 400) => { throw new HttpError(s, m); };
const hashStr = s => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rng = seed => { let a = hashStr(seed); return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
const shuffle = (arr, seed) => { const r = rng(seed), a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
// strip contact details from free text: long digit runs, @handles, links
const noContacts = s => s.replace(/(\+?\d[\d\s-]{5,}\d)/g, '').replace(/@\w+/g, '').replace(/https?:\/\/\S+|www\.\S+|\b\S+\.(com|in|me|io|link)\b/gi, '').replace(/\s+/g, ' ').trim();
const photoUrl = name => `${C.PUBLIC_URL}/photos/${name}`;
/* Where someone is going: up to MAX_PLANS events, each {name, dates: ['2026-10-16', …], time: '20:00'}.
   The event name is typed by the person (or picked from what others typed). Matching compares names loosely (case, spaces, punctuation). */
const eventKey = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function cleanPlans(list) {
  if (!Array.isArray(list)) return [];
  const out = [], seen = new Set();
  for (const x of list.slice(0, C.MAX_PLANS * 2)) {
    const name = noContacts(clean(x?.name, 40));
    if (name.length < 2) bad('Type the name of the event.');
    const k = eventKey(name); if (!k || seen.has(k)) continue; seen.add(k);
    const dates = [...new Set(Array.isArray(x.dates) ? x.dates : [])].filter(d => DATES.includes(d)).sort();
    if (!dates.length) bad(`Pick the date for ${name}.`);
    if (!TIME_OK.test(String(x.time || ''))) bad(`Pick a time for ${name}.`);
    out.push({name, dates, time: x.time});
  }
  if (out.length > C.MAX_PLANS) bad(`Up to ${C.MAX_PLANS} events.`);
  return out;
}
const plansOf = p => Array.isArray(p?.plans) ? p.plans : [];
const datesOf = p => [...new Set(plansOf(p).flatMap(x => x.dates))].sort();

function userJson(u) { return u ? {id: u.id, firstName: u.first_name || '', gender: u.gender || null, college: u.college || '', adult: !!u.adult, hasPicapool: !!u.picapool_id} : null; }
function profileOf(userId) { const r = q('SELECT data FROM profiles WHERE user_id=?').get(userId); return r ? JSON.parse(r.data) : null; }
function card(u, p) {
  return {id: u.id, name: u.first_name, college: u.college, photos: p.photos, plans: plansOf(p), lookingFor: p.lookingFor, skill: p.skill,
    style: p.style, sticks: p.sticks, outfit: p.outfit, knuckle: p.knuckle, prompt: p.prompt || null, ride: p.ride, seats: p.seats || 0};
}
const blockedPair = (a, b) => !!q('SELECT 1 FROM blocks WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)').get(a, b, b, a);

/* ---------------- request plumbing ---------------- */
function send(res, status, obj, headers = {}) {
  const body = obj === null ? '' : JSON.stringify(obj);
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers});
  res.end(body);
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'That upload is too big. Try smaller photos.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch (e) { reject(new HttpError(400, 'Bad request.')); } });
    req.on('error', reject);
  });
}
/* The client's IP. Behind nginx/Caddy (TRUST_PROXY=1) it's the LAST X-Forwarded-For entry: the one the proxy itself added.
   The first entries are whatever the client sent, so they can't be trusted for limits. */
const clientIp = req => (C.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',').map(x => x.trim()).filter(Boolean).pop()) || req.socket.remoteAddress || '?';
/* Rate limits. Signed-in requests count per session (a whole college on one Wi-Fi shares an IP, so per-IP limits would lock them out together);
   anonymous requests count per IP. Separate hourly limits per IP for asking for codes and for trying them. */
const hits = new Map();
function hit(key, windowMs, max, msg) {
  const t = now(), w = hits.get(key) || {start: t, n: 0, win: windowMs};
  if (t - w.start > windowMs) { w.start = t; w.n = 0; }
  w.n++; hits.set(key, w);
  if (w.n > max) bad(msg || 'Too many requests. Wait a few minutes.', 429);
}
function rateLimit(req) {
  const m = /^Bearer (.{20,})$/.exec(req.headers.authorization || '');
  if (m) hit('s:' + sha(m[1]).slice(0, 24), 5 * 60e3, 900);
  else hit('ip:' + clientIp(req), 5 * 60e3, 1500);
}
setInterval(() => { const t = now(); for (const [k, w] of hits) if (t - w.start > w.win * 2) hits.delete(k); }, 60e3).unref();
function authUser(req, required = true) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const s = m && q('SELECT user_id FROM sessions WHERE token_hash=? AND created_at>?').get(sha(m[1]), now() - C.SESSION_DAYS * 86400e3);
  const u = s && q('SELECT * FROM users WHERE id=?').get(s.user_id);
  if (!u && required) bad('Please log in again.', 401);
  return u || null;
}
const needComplete = u => { if (!u.first_name || !u.gender || !u.adult) bad('Finish your profile first.', 409); };
const needProfile = u => { needComplete(u); const p = profileOf(u.id); if (!p) bad('Make your Dandiya card first.', 409); return p; };

/* ---------------- caches ---------------- */
let lbCache = {}, statsCache = null;
const bustCaches = () => { lbCache = {}; statsCache = null; previewCache = {}; popCache = null; };

/* ---------------- routes ---------------- */
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, limit: opts.limit || 64e3});

route('GET', '/api/health', () => ({ok: true, day: istDay(), storage: storageOk(), otp: integrations.otpChannels()}));

route('GET', '/api/stats', ({req, url}) => {
  admin(req, url); // counts by college, date and event: for the team, not the public
  if (statsCache && now() - statsCache.at < C.STATS_REFRESH_MS) return statsCache.body;
  const rows = q(`SELECT u.college, p.data FROM profiles p JOIN users u ON u.id=p.user_id WHERE ${VISIBLE('p')}`).all();
  const byDate = {}, cc = {};
  for (const r of rows) { const d = JSON.parse(r.data); for (const x of datesOf(d)) byDate[x] = (byDate[x] || 0) + 1; cc[r.college] = (cc[r.college] || 0) + 1; }
  const topColleges = Object.entries(cc).filter(([n]) => n && n !== 'Not in college' && n !== 'Other DU college').sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({name, count}));
  const body = {total: rows.length, byDate, topEvents: popularEvents(10, 1), topColleges};
  statsCache = {at: now(), body};
  return body;
});

/* Guests peek before signing up: the day's top PREVIEW_MAX people of the other side, in Garba Queen/King order
   (tonight's board first, then the all-Navratri board, then everyone else in a daily shuffle).
   First name, college, the dates they're going, line and the main photo. Never phones, event names or hidden, paused or photo-less people.
   While there are fewer than PREVIEW_MAX real people, labelled sample people (samples.json) fill the gap: real people always come first.
   `count` is how many real people of that side have a visible card; null below COUNT_MIN or with SHOW_COUNTS=0. */
let previewCache = {};
const SAMPLES = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'samples.json'), 'utf8')); } catch (e) { return {female: [], male: []}; } })();
route('GET', '/api/preview', ({url}) => {
  const gender = url.searchParams.get('gender') === 'male' ? 'male' : 'female';
  const key = gender + ':' + istDay();
  const c = previewCache[key]; if (c && now() - c.at < C.PREVIEW_CACHE_MS) return c.body;
  const rows = q(`SELECT u.id, u.first_name, u.college, p.data FROM profiles p JOIN users u ON u.id=p.user_id WHERE ${VISIBLE('p')} AND u.adult=1 AND u.gender=?`).all(gender);
  const eligible = rows.map(r => ({r, p: JSON.parse(r.data)}));
  const order = [...rankBoard(gender, 'tonight'), ...rankBoard(gender, 'week')].map(x => x.id);
  const pos = id => { const i = order.indexOf(id); return i < 0 ? Infinity : i; };
  const rest = shuffle(eligible.filter(({r}) => pos(r.id) === Infinity), key);
  let list = [...eligible.filter(({r}) => pos(r.id) < Infinity).sort((a, b) => pos(a.r.id) - pos(b.r.id)), ...rest];
  list = list.slice(0, C.PREVIEW_MAX).map(({r, p}) => ({id: r.id, name: r.first_name, college: r.college, dates: datesOf(p), prompt: p.prompt || null, photo: p.photos[0]}));
  if (C.SAMPLE_PROFILES && list.length < C.PREVIEW_MAX) {
    const today = istDay(), upcoming = DATES.filter(d => d >= today);
    const fill = (SAMPLES[gender] || []).slice(0, C.PREVIEW_MAX - list.length).map((x, i) => {
      const ds = upcoming.filter((_, k) => (k + i) % 2 === 0).slice(0, 2);
      return {id: `sample-${gender[0]}${i + 1}`, name: x.name, college: x.college, dates: ds.length ? ds : upcoming.slice(0, 1), prompt: x.line ? {id: 'flag', text: x.line} : null, photo: x.photo, sample: true};
    });
    list = [...list, ...fill];
  }
  const count = C.SHOW_COUNTS && eligible.length >= C.COUNT_MIN ? eligible.length : null;
  const body = {profiles: list, count};
  previewCache = {[key]: {at: now(), body}, ...Object.fromEntries(Object.entries(previewCache).slice(0, 40))};
  return body;
});

route('POST', '/api/auth/otp', async ({req, body}) => {
  const phone = String(body.phone || '');
  if (!/^[6-9]\d{9}$/.test(phone)) bad('Enter your 10-digit WhatsApp number.');
  hit('otp:' + clientIp(req), 3600e3, C.OTP_PER_IP_HOUR, 'Too many codes from this network. Try again in a while.');
  const t = now(), o = q('SELECT * FROM otps WHERE phone=?').get(phone);
  if (o && t - o.last_sent < 30e3) bad('Wait 30 seconds before asking for another code.', 429);
  let windowStart = o ? o.window_start : t, count = o ? o.window_count : 0;
  if (t - windowStart > 3600e3) { windowStart = t; count = 0; }
  if (count >= 5) bad('Too many codes. Try again in an hour.', 429);
  const code = C.DEV_OTP || String(crypto.randomInt(0, 10 ** C.OTP_LENGTH)).padStart(C.OTP_LENGTH, '0');
  const prefer = ['sms', 'whatsapp'].includes(body.channel) ? body.channel : null;
  let via; try { via = await integrations.sendOtp(phone, code, prefer); } catch (e) { console.error('[otp] send failed', e.message); bad("Couldn't send the code. Try again in a minute.", 502); }
  q(`INSERT INTO otps(phone, code_hash, expires_at, attempts, last_sent, window_start, window_count) VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, last_sent=excluded.last_sent, window_start=excluded.window_start, window_count=excluded.window_count`)
    .run(phone, sha(phone + ':' + code), t + C.OTP_TTL_MS, 0, t, windowStart, count + 1);
  // `alt`: the other way the code can go, for a "Send by SMS instead" button
  return {ok: true, via: via || 'whatsapp', alt: integrations.otpChannels().find(c => c !== via) || null};
});

route('POST', '/api/auth/verify', async ({req, body}) => {
  const phone = String(body.phone || ''), code = String(body.code || '');
  hit('verify:' + clientIp(req), 3600e3, C.VERIFY_PER_IP_HOUR, 'Too many tries from this network. Try again in a while.');
  const o = q('SELECT * FROM otps WHERE phone=?').get(phone);
  if (!o || !o.code_hash || o.expires_at < now()) bad('That code expired. Tap "Resend code".');
  if (o.attempts >= 5) bad('Too many wrong tries. Tap "Resend code".', 429);
  if (!same(sha(phone + ':' + code), o.code_hash)) { q('UPDATE otps SET attempts=attempts+1 WHERE phone=?').run(phone); bad("That code isn't right. Check the message and try again."); }
  q('UPDATE otps SET code_hash=NULL, expires_at=0 WHERE phone=?').run(phone); // keep send-rate history
  let u = q('SELECT * FROM users WHERE phone=?').get(phone);
  if (!u) {
    const id = rid('u_');
    let pre = null; try { pre = await integrations.findPicapoolUser(phone); } catch (e) { console.error('[findPicapoolUser]', e.message); }
    q(`INSERT INTO users(id, phone, first_name, gender, college, picapool_id, ref, entry, session_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(id, phone, pre?.firstName ? clean(pre.firstName, 20) : null, ENUMS.gender.includes(pre?.gender) ? pre.gender : null, pre?.college ? clean(pre.college, 60) : null,
        pre?.picapoolId ? String(pre.picapoolId) : null, clean(body.ref, 40) || null, clean(body.entry, 200) || null, clean(body.sessionId, 40) || null, now());
    u = q('SELECT * FROM users WHERE id=?').get(id);
  } else if (!u.session_id && body.sessionId) q('UPDATE users SET session_id=? WHERE id=?').run(clean(body.sessionId, 40), u.id);
  const token = crypto.randomBytes(32).toString('base64url');
  q('INSERT INTO sessions(token_hash, user_id, created_at) VALUES(?,?,?)').run(sha(token), u.id, now());
  const known = u.first_name || u.picapool_id;
  return {token, user: known ? userJson(u) : null, profile: profileOf(u.id)};
});

/* Log out: this session stops working everywhere at once */
route('POST', '/api/auth/logout', ({req}) => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (m) q('DELETE FROM sessions WHERE token_hash=?').run(sha(m[1]));
  return {ok: true};
});

/* ---------- Picapool account sync ----------
   The phone number is the join key. Once linked, the Picapool account is the source of truth for first name and gender;
   the Dandiya card (photos, nights, line, college) stays Stick Together's own. Full rules and edge cases: HANDOFF §4b. */
const firstNameOf = n => { const w = clean(n, 40).split(' ')[0] || ''; return /^[\p{L}][\p{L}.'-]{1,19}$/u.test(w) ? w : null; };
function linkPicapool(u, pre) {
  const name = pre.firstName ? firstNameOf(pre.firstName) : null;
  const gender = ENUMS.gender.includes(pre.gender) ? pre.gender : null;
  const hasCard = !!profileOf(u.id);
  let nameChanged = false, conflict = u.identity_conflict || null;
  let first = u.first_name, gen = u.gender, college = u.college;
  if (name && name !== u.first_name) { nameChanged = !!u.first_name; first = name; }          // Picapool's first name wins, before and after the card exists
  if (gender && gender !== u.gender) {
    if (hasCard && u.gender) conflict = 'gender';                                            // never flip gender under an existing card: matches, likes and the board depend on it
    else gen = gender;                                                                        // no card yet: just use Picapool's
  } else if (conflict === 'gender' && gender === u.gender) conflict = null;                  // they fixed it in the app
  if (!college && pre.college) college = clean(pre.college, 60);                              // college stays whatever they chose here, if they chose one
  q('UPDATE users SET picapool_id=?, first_name=?, gender=?, college=?, identity_conflict=?, picapool_synced_at=? WHERE id=?')
    .run(String(pre.picapoolId), first, gen, college, conflict, now(), u.id);
  if (nameChanged) bustCaches();
  deliverRequests(u.id).catch(e => console.error('[deliverRequests]', e.message));
  return {nameChanged, conflict};
}
function unlinkPicapool(u) { q('UPDATE users SET picapool_id=NULL, picapool_synced_at=? WHERE id=?').run(now(), u.id); }
/* someone just joined Picapool: every message request waiting for them becomes a real chat with the sender's message in it */
async function deliverRequests(userId) {
  const me = q('SELECT * FROM users WHERE id=?').get(userId);
  if (!me?.picapool_id) return;
  for (const m of q(`SELECT * FROM matches WHERE (a=? OR b=?) AND chat_id IS NULL AND req_by IS NOT NULL AND req_by<>?`).all(userId, userId, userId)) {
    const from = q('SELECT * FROM users WHERE id=?').get(m.req_by);
    if (!from?.picapool_id || blockedPair(from.id, me.id)) continue;
    const chatId = String(await integrations.createChat(from, me, m.req_opener));
    q('UPDATE matches SET chat_id=?, req_by=NULL, req_opener=NULL, req_at=NULL WHERE id=? AND chat_id IS NULL').run(chatId, m.id);
  }
}
/* After OTP, on "I've signed up", and whenever the page comes back into view while not linked (and every few minutes while linked):
   'found' | 'not_found' | 'unavailable' (lookup not wired, or it failed). Nobody needs a Picapool account to make a card. */
route('POST', '/api/picapool/lookup', async ({req}) => {
  const u = authUser(req);
  if (!integrations.lookupWired) return u.picapool_id ? {status: 'found', user: userJson(u)} : {status: 'unavailable'};
  let pre;
  try { pre = await integrations.findPicapoolUser(u.phone); } catch (e) { console.error('[findPicapoolUser]', e.message); return u.picapool_id ? {status: 'found', user: userJson(u)} : {status: 'unavailable'}; }
  if (!pre || !pre.picapoolId) { if (u.picapool_id) unlinkPicapool(u); return {status: 'not_found', user: userJson(q('SELECT * FROM users WHERE id=?').get(u.id))}; }
  const synced = linkPicapool(u, pre);
  return {status: 'found', user: userJson(q('SELECT * FROM users WHERE id=?').get(u.id)), synced};
});
/* Picapool's backend pushes account changes here the moment they happen (account created, name/gender edited, account deleted),
   so a person who signs up in the app is linked in real time, even with the page closed.
   Header X-Picapool-Secret must equal PICAPOOL_WEBHOOK_SECRET. Body: {phone, picapoolId, firstName?, gender?, college?, deleted?} */
route('POST', '/api/integrations/picapool-user', ({req, body}) => {
  if (!C.PICAPOOL_WEBHOOK_SECRET || !same(req.headers['x-picapool-secret'], C.PICAPOOL_WEBHOOK_SECRET)) bad('Not allowed.', 403);
  const phone = String(body.phone || '').replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) bad('Bad phone.');
  const u = q('SELECT * FROM users WHERE phone=?').get(phone);
  if (!u) return {ok: true, linked: false}; // not on Stick Together (yet): the lookup links them when they log in
  if (body.deleted) { unlinkPicapool(u); return {ok: true, linked: false}; }
  if (!body.picapoolId) bad('picapoolId is required.');
  return {ok: true, linked: true, ...linkPicapool(u, body)};
});

route('POST', '/api/account', async ({req, body}) => {
  const u = authUser(req);
  let firstName = clean(body.firstName, 20), gender = body.gender;
  if (u.picapool_id && u.first_name) firstName = u.first_name;   // linked to Picapool: its name and gender win
  if (u.picapool_id && u.gender) gender = u.gender;
  if (!/^[\p{L}][\p{L} .'-]{1,19}$/u.test(firstName)) bad('Enter your first name (letters only).');
  if (!ENUMS.gender.includes(gender)) bad('Pick Girl or Guy.');
  const college = clean(body.college, 60); if (college.length < 2) bad('Pick your college.');
  if (gender === 'male' && WOMEN_ONLY_COLLEGES.includes(college.toLowerCase())) bad('Pick your college.');
  if (body.adult !== true) bad('This is for 18+ only.');
  let picapoolId = u.picapool_id;
  if (!picapoolId) { try { picapoolId = await integrations.createPicapoolAccount({phone: u.phone, firstName, gender, college, ref: u.ref}); } catch (e) { console.error('[createPicapoolAccount]', e.message); } }
  q('UPDATE users SET first_name=?, gender=?, college=?, adult=1, picapool_id=?, completed_at=COALESCE(completed_at, ?) WHERE id=?')
    .run(firstName, gender, college, picapoolId ? String(picapoolId) : null, now(), u.id);
  if (picapoolId && !u.picapool_id) deliverRequests(u.id).catch(e => console.error('[deliverRequests]', e.message));
  return {user: userJson(q('SELECT * FROM users WHERE id=?').get(u.id))};
});

route('POST', '/api/age-block', ({req}) => {
  const u = authUser(req);
  tx(() => {
    q('INSERT INTO age_blocks(at, ref) VALUES(?,?)').run(now(), u.ref);
    deleteDandiyaData(u.id);
    q('DELETE FROM sessions WHERE user_id=?').run(u.id);
    q('DELETE FROM users WHERE id=?').run(u.id); // nothing about an under-18 person is kept
  });
  return {ok: true};
});

/* A photo in a profile is either one already on this server (uploaded by this person, via POST /api/photos or an earlier save)
   or a new data: URL. Returns the stored file name. */
function savePhoto(userId, src, keep) {
  if (typeof src !== 'string') bad('Bad photo.');
  const own = C.PUBLIC_URL && src.startsWith(C.PUBLIC_URL) ? src.slice(C.PUBLIC_URL.length) : src;
  const m0 = /^\/photos\/([\w-]+\.(?:jpg|png|webp))$/.exec(own);
  if (m0) { if (!m0[1].startsWith(userId + '-') || (!keep.has(m0[1]) && !fs.existsSync(path.join(PHOTO_DIR, m0[1])))) bad('That photo is gone. Add it again.'); return m0[1]; }
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(src);
  if (!m) bad('Photos must be JPG or PNG.');
  if (m[2].length > 2.1e6) bad('That photo is too big.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 1.5e6) bad('That photo is too big.');
  // the real type comes from the file's first bytes, not from what the upload claims
  const ext = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff ? 'jpg'
    : buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a' ? 'png'
    : buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP' ? 'webp' : null;
  if (!ext) bad('Photos must be JPG or PNG.');
  const name = `${userId}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(PHOTO_DIR, name), buf);
  return name;
}
function photoNames(p) { return (p?.photos || []).map(u => (u.split('/photos/')[1] || '')).filter(Boolean); }
/* photos uploaded but never saved into a profile (closed the sheet, replaced them): removed after an hour */
function sweepPhotos(userId, keepNames) {
  const t = now();
  for (const f of fs.readdirSync(PHOTO_DIR)) {
    if (!f.startsWith(userId + '-') || keepNames.includes(f)) continue;
    try { if (t - fs.statSync(path.join(PHOTO_DIR, f)).mtimeMs > 3600e3) fs.rmSync(path.join(PHOTO_DIR, f)); } catch (e) {}
  }
}
/* One photo at a time, the moment it's picked: small requests (well under a proxy's 1 MB default) and nothing lost if the
   connection drops halfway through five photos. The photo only becomes visible once it's in the saved profile. */
route('POST', '/api/photos', ({req, body}) => {
  const u = authUser(req); needComplete(u);
  hit('photo:' + u.id, 3600e3, 60, 'Too many photos for now. Try again in a while.');
  const name = savePhoto(u.id, body.photo, new Set());
  return {url: photoUrl(name)};
}, {limit: 2.5e6});

route('PUT', '/api/profile', ({req, body}) => {
  const u = authUser(req); needComplete(u);
  const e = (k, v) => ENUMS[k].includes(v) ? v : bad('Please answer every question.');
  const opt = (k, v) => v === null || v === undefined || v === '' ? null : e(k, v); // filled in later from the Me tab
  const plans = cleanPlans(body.plans);
  if (!plans.length) bad('Add at least one event you’re going to.');
  let prompt = null;
  if (body.prompt && ENUMS.prompt.includes(body.prompt.id)) { const t = noContacts(clean(body.prompt.text, 60)); if (t.length >= 2) prompt = {id: body.prompt.id, text: t}; }
  const photosIn = Array.isArray(body.photos) ? body.photos : []; // a card may start without a photo; nobody sees it until it has one
  if (photosIn.length > C.MAX_PHOTOS) bad(`Up to ${C.MAX_PHOTOS} photos.`);
  const old = profileOf(u.id), keep = new Set(photoNames(old));
  const names = photosIn.map(src => savePhoto(u.id, src, keep));
  const ride = opt('ride', body.ride);
  // tiny blurred-preview thumbnail (≤18×22 JPEG): the only image guests ever receive
  const thumb = typeof body.thumb === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{20,3000}$/.test(body.thumb) ? body.thumb : (old?.thumb || null);
  const p = {photos: names.map(photoUrl), thumb, plans, lookingFor: opt('lookingFor', body.lookingFor), skill: opt('skill', body.skill), style: opt('style', body.style),
    sticks: opt('sticks', body.sticks), outfit: opt('outfit', body.outfit), knuckle: opt('knuckle', body.knuckle), prompt, ride,
    seats: ride === 'own' ? Math.max(1, Math.min(3, +body.seats || 1)) : 0, rideConsent: !!body.rideConsent,
    // new cards are in the Garba Queen/King race unless they say otherwise; an existing card keeps its stored choice unless it is sent
    inBoard: body.inBoard === undefined ? (old ? !!old.inBoard : true) : !!body.inBoard,
    paused: body.paused === undefined ? !!old?.paused : !!body.paused};
  const t = now();
  q(`INSERT INTO profiles(user_id, data, in_board, hidden, created_at, updated_at) VALUES(?,?,?,0,?,?)
     ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, in_board=excluded.in_board, updated_at=excluded.updated_at`).run(u.id, JSON.stringify(p), p.inBoard ? 1 : 0, t, t);
  for (const n of keep) if (!names.includes(n)) fs.rm(path.join(PHOTO_DIR, n), () => {});
  sweepPhotos(u.id, names);
  bustCaches();
  return {profile: p};
}, {limit: 12e6});

/* Event names other people are going to, most popular first, to pick from instead of typing.
   Only names at least `min` people chose (so a one-off typo or a bad name never shows to everyone). */
let popCache = null;
function popularEvents(limit = 12, min = 2) {
  if (min === 2 && popCache && now() - popCache.at < 60e3) return popCache.rows.slice(0, limit);
  const by = new Map();
  for (const r of q(`SELECT p.data FROM profiles p WHERE p.hidden=0`).all()) for (const x of plansOf(JSON.parse(r.data))) {
    const k = eventKey(x.name), e = by.get(k) || {n: 0, names: {}}; e.n++; e.names[x.name] = (e.names[x.name] || 0) + 1; by.set(k, e);
  }
  const rows = [...by.values()].filter(e => e.n >= min).sort((a, b) => b.n - a.n)
    .map(e => ({name: Object.entries(e.names).sort((a, b) => b[1] - a[1])[0][0], count: e.n}));
  if (min === 2) popCache = {at: now(), rows};
  return rows.slice(0, limit);
}
route('GET', '/api/events/popular', ({req}) => { authUser(req); return {events: popularEvents(12, 2).map(e => e.name)}; });

function rightsUsedToday(uid) { return q(`SELECT COUNT(*) n FROM swipes WHERE from_id=? AND dir='right' AND day=?`).get(uid, istDay()).n; }

route('GET', '/api/feed', ({req, url}) => {
  const u = authUser(req); const me = needProfile(u);
  const passed = url.searchParams.get('passed') === '1';
  const t = now();
  const swiped = new Map(q('SELECT to_id, dir, at, retried FROM swipes WHERE from_id=?').all(u.id).map(r => [r.to_id, r]));
  const blocked = new Set(q('SELECT to_id x FROM blocks WHERE from_id=? UNION SELECT from_id x FROM blocks WHERE to_id=?').all(u.id, u.id).map(r => r.x));
  const rows = q(`SELECT u.*, p.data FROM profiles p JOIN users u ON u.id=p.user_id WHERE ${VISIBLE('p')} AND u.gender=? AND u.adult=1 AND u.id<>?`).all(u.gender === 'female' ? 'male' : 'female', u.id);
  let list = [];
  for (const r of rows) {
    if (blocked.has(r.id)) continue;
    const s = swiped.get(r.id);
    if (passed) { if (!s || s.dir !== 'left') continue; }
    else if (s && !(s.dir === 'left' && !s.retried && t - s.at > 24 * 3600e3)) continue;
    list.push(card(r, JSON.parse(r.data)));
  }
  /* Everyone is in the feed; people going where and when you are come first:
     0 same event on the same date · 1 same event, or same date · 2 everyone else */
  const today = istDay(), mine = plansOf(me), myDates = new Set(datesOf(me).filter(d => d >= today)), myEv = new Map(mine.map(x => [eventKey(x.name), x.dates]));
  const tier = p => {
    let ev = false, day = false;
    for (const x of p.plans) {
      const ds = myEv.get(eventKey(x.name));
      if (ds) { ev = true; if (x.dates.some(d => d >= today && ds.includes(d))) return 0; }
      if (x.dates.some(d => myDates.has(d))) day = true;
    }
    return ev || day ? 1 : 2;
  };
  const tiers = [[], [], []]; list.forEach(p => tiers[tier(p)].push(p));
  list = tiers.flatMap((x, i) => shuffle(x, u.id + ':' + today + ':' + i)).slice(0, 100);
  return {profiles: list, rightsLeftToday: Math.max(0, C.DAILY_RIGHT_CAP - rightsUsedToday(u.id))};
});

function matchJson(m, meId) {
  const otherId = m.a === meId ? m.b : m.a;
  const o = q('SELECT * FROM users WHERE id=?').get(otherId), p = profileOf(otherId);
  if (!o || !p) return null;
  const mine = m.a === meId ? m.a_share : m.b_share, theirs = m.a === meId ? m.b_share : m.a_share;
  const chatRequest = !m.chat_id && m.req_by ? (m.req_by === meId ? 'sent' : 'received') : null;
  return {id: m.id, person: {...card(o, p), hasPicapool: !!o.picapool_id}, createdAt: m.created_at, chatId: m.chat_id || null, chatRequest,
    ...(chatRequest === 'sent' ? {requestMessage: m.req_opener || null} : {}),
    numberStatus: mine && theirs ? 'shared' : mine ? 'waiting' : 'none', ...(mine && theirs ? {phone: o.phone} : {})};
}

route('POST', '/api/swipe', async ({req, body}) => {
  const u = authUser(req); needProfile(u);
  const dir = body.dir === 'right' ? 'right' : body.dir === 'left' ? 'left' : bad('Bad swipe.');
  const target = q(`SELECT u.* FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=? AND ${VISIBLE('p')}`).get(String(body.targetId || ''));
  if (!target || target.id === u.id || target.gender === u.gender) bad('That profile is no longer available.', 404);
  if (blockedPair(u.id, target.id)) bad('That profile is no longer available.', 404);
  const prev = q('SELECT * FROM swipes WHERE from_id=? AND to_id=?').get(u.id, target.id);
  if (prev && prev.dir === 'right') return {match: null, rightsLeftToday: Math.max(0, C.DAILY_RIGHT_CAP - rightsUsedToday(u.id))};
  if (dir === 'right' && rightsUsedToday(u.id) >= C.DAILY_RIGHT_CAP) bad(`That's today's ${C.DAILY_RIGHT_CAP} right swipes. Back tomorrow!`, 429);
  const t = now(), day = istDay();
  let match = null, created = false;
  tx(() => {
    if (prev) q('UPDATE swipes SET dir=?, day=?, at=?, retried=1 WHERE from_id=? AND to_id=?').run(dir, day, t, u.id, target.id);
    else q('INSERT INTO swipes(from_id, to_id, dir, day, at) VALUES(?,?,?,?,?)').run(u.id, target.id, dir, day, t);
    if (dir === 'right' && q(`SELECT 1 FROM swipes WHERE from_id=? AND to_id=? AND dir='right'`).get(target.id, u.id)) {
      const [a, b] = [u.id, target.id].sort();
      let m = q('SELECT * FROM matches WHERE a=? AND b=?').get(a, b);
      if (!m) { q('INSERT INTO matches(id, a, b, created_at) VALUES(?,?,?,?)').run(rid('m_', 8), a, b, t); m = q('SELECT * FROM matches WHERE a=? AND b=?').get(a, b); created = true; }
      match = m;
    }
  });
  if (created) integrations.notifyMatch(target, u).catch(e => console.error('[notifyMatch]', e.message));
  return {match: match ? matchJson(match, u.id) : null, rightsLeftToday: Math.max(0, C.DAILY_RIGHT_CAP - rightsUsedToday(u.id))};
});

/* Likes you: people who liked me that I haven't liked back (or dismissed). "Like back" is a normal right swipe → match. */
route('GET', '/api/likes/received', ({req}) => {
  const u = authUser(req); needProfile(u);
  const rows = q(`SELECT s.from_id, s.at, u.*, p.data, mine.dir mydir FROM swipes s
     JOIN users u ON u.id=s.from_id JOIN profiles p ON p.user_id=s.from_id AND ${VISIBLE('p')}
     LEFT JOIN swipes mine ON mine.from_id=? AND mine.to_id=s.from_id
     WHERE s.to_id=? AND s.dir='right' AND (mine.dir IS NULL OR mine.dir<>'right')
       AND NOT EXISTS (SELECT 1 FROM dismissed d WHERE d.from_id=? AND d.to_id=s.from_id)
     ORDER BY s.at DESC`).all(u.id, u.id, u.id);
  return {received: rows.filter(r => !blockedPair(u.id, r.from_id)).map(r => ({person: card(r, JSON.parse(r.data)), at: r.at, passed: r.mydir === 'left'}))};
});
route('POST', '/api/likes/dismiss', ({req, body}) => {
  const u = authUser(req); needProfile(u);
  const to = String(body.targetId || ''); if (!to || to === u.id) bad('That profile is no longer available.', 404);
  q('INSERT OR IGNORE INTO dismissed(from_id, to_id, at) VALUES(?,?,?)').run(u.id, to, now());
  return {ok: true};
});

/* Sent: people I liked who haven't liked me back (yet) */
route('GET', '/api/likes/sent', ({req}) => {
  const u = authUser(req); needProfile(u);
  const rows = q(`SELECT s.to_id, s.at, u.*, p.data FROM swipes s JOIN users u ON u.id=s.to_id JOIN profiles p ON p.user_id=s.to_id AND ${VISIBLE('p')}
     WHERE s.from_id=? AND s.dir='right' ORDER BY s.at DESC`).all(u.id);
  const sent = rows.filter(r => !blockedPair(u.id, r.to_id) && !q('SELECT 1 FROM matches WHERE a=? AND b=?').get(...[u.id, r.to_id].sort()))
    .map(r => ({person: card(r, JSON.parse(r.data)), at: r.at}));
  return {sent};
});

route('GET', '/api/matches', ({req}) => {
  const u = authUser(req); needProfile(u);
  const ms = q('SELECT * FROM matches WHERE a=? OR b=? ORDER BY created_at DESC').all(u.id, u.id);
  return {matches: ms.filter(m => !blockedPair(m.a, m.b)).map(m => matchJson(m, u.id)).filter(Boolean)};
});

function myMatch(u, id) {
  const m = q('SELECT * FROM matches WHERE id=?').get(id);
  if (!m || (m.a !== u.id && m.b !== u.id) || blockedPair(m.a, m.b)) bad('That match is no longer available.', 404);
  return m;
}
/* Chat on Picapool.
   - You need a Picapool account first (409, code need_account): chats live in the app.
   - Both on Picapool → the chat is created (status 'created').
   - They aren't on Picapool yet → your message is kept as a request (status 'requested') and they're told via notifyMessageRequest.
     When they join and open the chat, it is created with your message in it. */
route('POST', '/api/matches/:id/chat', async ({req, body, params}) => {
  const u = authUser(req); needProfile(u);
  const m = myMatch(u, params.id);
  const done = id => ({status: 'created', chatId: id, deepLink: C.DEEPLINK.replace('{chatId}', encodeURIComponent(id))});
  if (m.chat_id) return done(m.chat_id);
  if (!u.picapool_id) throw Object.assign(new HttpError(409, 'Set up your Picapool account first, then your chats open there.'), {code: 'need_account'});
  const other = q('SELECT * FROM users WHERE id=?').get(m.a === u.id ? m.b : m.a);
  const opener = body.opener ? noContacts(clean(body.opener, 300)) || null : null;
  if (!other.picapool_id) {
    if (m.req_by !== u.id || opener) q('UPDATE matches SET req_by=?, req_opener=?, req_at=? WHERE id=?').run(u.id, opener, now(), m.id);
    integrations.notifyMessageRequest(other, u).catch(e => console.error('[notifyMessageRequest]', e.message));
    return {status: 'requested'};
  }
  // they asked first: open the chat with their waiting message; otherwise with mine
  const [from, to, first] = m.req_by && m.req_by !== u.id ? [other, u, m.req_opener] : [u, other, opener];
  let chatId;
  try { chatId = String(await integrations.createChat(from, to, first)); } catch (e) { console.error('[createChat]', e.message); bad("Couldn't open the chat right now. Try again in a minute.", 502); }
  q('UPDATE matches SET chat_id=?, req_by=NULL, req_opener=NULL, req_at=NULL WHERE id=?').run(chatId, m.id);
  return done(chatId);
});

route('POST', '/api/matches/:id/share-number', ({req, params}) => {
  const u = authUser(req); needProfile(u);
  const m = myMatch(u, params.id);
  q(`UPDATE matches SET ${m.a === u.id ? 'a_share' : 'b_share'}=1 WHERE id=?`).run(m.id);
  const j = matchJson(q('SELECT * FROM matches WHERE id=?').get(m.id), u.id);
  return j.numberStatus === 'shared' ? {status: 'shared', phone: j.phone} : {status: 'waiting'};
});

function rankBoard(gender, period) {
  const key = gender + ':' + period, c = lbCache[key];
  if (c && now() - c.at < C.LB_REFRESH_MS) return c.rows;
  const rows = q(`SELECT s.to_id id, COUNT(*) n FROM swipes s
      JOIN profiles pt ON pt.user_id=s.to_id AND pt.in_board=1 AND ${VISIBLE('pt')}
      JOIN users ut ON ut.id=s.to_id AND ut.gender=?
      JOIN profiles pf ON pf.user_id=s.from_id AND pf.hidden=0
      WHERE s.dir='right' ${period === 'tonight' ? 'AND s.day=?' : ''}
      GROUP BY s.to_id ORDER BY n DESC, MIN(s.at) ASC LIMIT ${C.BOARD_SIZE}`).all(...(period === 'tonight' ? [gender, istDay()] : [gender]));
  const out = rows.map(r => { const uu = q('SELECT * FROM users WHERE id=?').get(r.id), p = profileOf(r.id); return {id: r.id, name: uu.first_name, college: uu.college, photo: p.photos[0], count: r.n}; });
  /* v2: the board always shows up to BOARD_SIZE people a side. After the people picked tonight (or this Navratri) come the rest of the race,
     most-picked this Navratri first, then earliest pass. They have count 0: they never get a rank or a crown. */
  if (out.length < C.BOARD_SIZE) {
    const have = new Set(out.map(r => r.id));
    const rest = q(`SELECT u.id, u.first_name, u.college, p.data, p.created_at, (SELECT COUNT(*) FROM swipes s JOIN profiles pf ON pf.user_id=s.from_id AND pf.hidden=0 WHERE s.to_id=u.id AND s.dir='right') week
        FROM profiles p JOIN users u ON u.id=p.user_id WHERE p.in_board=1 AND ${VISIBLE('p')} AND u.gender=? ORDER BY week DESC, p.created_at ASC LIMIT ${C.BOARD_SIZE * 2}`).all(gender);
    for (const r of rest) { if (out.length >= C.BOARD_SIZE) break; if (have.has(r.id)) continue; out.push({id: r.id, name: r.first_name, college: r.college, photo: JSON.parse(r.data).photos[0], count: 0}); }
  }
  lbCache[key] = {at: now(), rows: out};
  return out;
}
route('GET', '/api/leaderboard', ({req, url}) => {
  const board = url.searchParams.get('board') === 'king' ? 'king' : 'queen';
  const period = url.searchParams.get('period') === 'week' ? 'week' : 'tonight';
  const gender = board === 'queen' ? 'female' : 'male';
  const u = authUser(req, false);
  const top = rankBoard(gender, period);
  let me = null;
  if (u && u.gender === gender) {
    const p = profileOf(u.id);
    if (p && p.inBoard) {
      const count = q(`SELECT COUNT(*) n FROM swipes s JOIN profiles pf ON pf.user_id=s.from_id AND pf.hidden=0 WHERE s.to_id=? AND s.dir='right' ${period === 'tonight' ? 'AND s.day=?' : ''}`)
        .get(...(period === 'tonight' ? [u.id, istDay()] : [u.id])).n;
      const i = top.findIndex(r => r.id === u.id);
      me = {count, rank: i >= 0 && top[i].count > 0 ? i + 1 : null}; // only people who were actually picked get a rank and a crown
    }
  }
  return {top: top.map(({count, ...r}) => ({...r, ...(u && r.id === u.id ? {isMe: true} : {})})), me};
});

route('POST', '/api/leaderboard/opt', ({req, body}) => {
  const u = authUser(req); const p = needProfile(u);
  p.inBoard = !!body.optIn;
  q('UPDATE profiles SET data=?, in_board=?, updated_at=? WHERE user_id=?').run(JSON.stringify(p), p.inBoard ? 1 : 0, now(), u.id);
  lbCache = {};
  return {ok: true};
});

/* Pause: the card leaves everyone's feed, the guest peek and the board; pairs, chats and picks stay. Unpause any time. */
route('POST', '/api/profile/pause', ({req, body}) => {
  const u = authUser(req); const p = needProfile(u);
  p.paused = !!body.paused;
  q('UPDATE profiles SET data=?, updated_at=? WHERE user_id=?').run(JSON.stringify(p), now(), u.id);
  bustCaches();
  return {ok: true, paused: p.paused};
});

route('POST', '/api/report', ({req, body}) => {
  const u = authUser(req);
  const to = String(body.targetId || ''); if (!q('SELECT 1 FROM users WHERE id=?').get(to) || to === u.id) bad('That profile is no longer available.', 404);
  tx(() => {
    q('INSERT OR IGNORE INTO reports(from_id, to_id, reason, at) VALUES(?,?,?,?)').run(u.id, to, clean(body.reason, 40) || 'Other', now());
    q('INSERT OR IGNORE INTO blocks(from_id, to_id) VALUES(?,?)').run(u.id, to);
    const n = q('SELECT COUNT(*) n FROM reports WHERE to_id=? AND resolved=0').get(to).n;
    if (n >= C.REPORT_HIDE) q('UPDATE profiles SET hidden=1 WHERE user_id=?').run(to);
  });
  bustCaches();
  return {ok: true};
});
route('POST', '/api/block', ({req, body}) => {
  const u = authUser(req);
  const to = String(body.targetId || ''); if (to && to !== u.id) q('INSERT OR IGNORE INTO blocks(from_id, to_id) VALUES(?,?)').run(u.id, to);
  return {ok: true};
});

function deleteDandiyaData(uid) {
  const p = profileOf(uid);
  for (const n of photoNames(p)) fs.rm(path.join(PHOTO_DIR, n), () => {});
  q('DELETE FROM profiles WHERE user_id=?').run(uid);
  q('DELETE FROM swipes WHERE from_id=? OR to_id=?').run(uid, uid);
  q('DELETE FROM matches WHERE a=? OR b=?').run(uid, uid);
  q('DELETE FROM dismissed WHERE from_id=? OR to_id=?').run(uid, uid);
}
route('DELETE', '/api/profile', ({req}) => {
  const u = authUser(req);
  tx(() => deleteDandiyaData(u.id));
  bustCaches();
  return {ok: true};
});

route('POST', '/api/events', ({req, body}) => {
  const ev = clean(body.event, 40); if (!/^[a-z_]{2,40}$/.test(ev)) return null;
  const s = clean(body.sessionId, 40);
  const u = s ? q('SELECT id FROM users WHERE session_id=?').get(s) : null;
  q('INSERT INTO events(ts, event, user_id, session_id, ref, data) VALUES(?,?,?,?,?,?)')
    .run(now(), ev, u ? u.id : null, s || null, clean(body.ref, 40) || null, JSON.stringify(body.data || {}).slice(0, 500));
  return null;
}, {limit: 4e3});

/* ---------------- admin ---------------- */
function admin(req, url) {
  // header only: a key in the URL ends up in logs and browser history
  if (!C.ADMIN_KEY || !same(req.headers['x-admin-key'], C.ADMIN_KEY)) bad('Wrong admin key.', 403);
}
route('GET', '/api/admin/summary', ({req, url}) => {
  admin(req, url);
  const n = sql => q(sql).get().n;
  const perDay = q(`SELECT date(completed_at/1000, 'unixepoch', '+5 hours', '+30 minutes') day, COUNT(*) n FROM users WHERE completed_at IS NOT NULL GROUP BY day ORDER BY day DESC LIMIT 14`).all();
  return {
    today: istDay(),
    accounts: {verifiedPhones: n('SELECT COUNT(*) n FROM users'), completed: n('SELECT COUNT(*) n FROM users WHERE completed_at IS NOT NULL'),
      linkedToPicapool: n('SELECT COUNT(*) n FROM users WHERE picapool_id IS NOT NULL'), perDay},
    profiles: {total: n('SELECT COUNT(*) n FROM profiles'), hidden: n('SELECT COUNT(*) n FROM profiles WHERE hidden=1'),
      byGender: q('SELECT u.gender, COUNT(*) n FROM profiles p JOIN users u ON u.id=p.user_id GROUP BY u.gender').all(),
      inBoard: n('SELECT COUNT(*) n FROM profiles WHERE in_board=1'),
      noPhoto: n(`SELECT COUNT(*) n FROM profiles WHERE json_array_length(data,'$.photos')=0`),
      paused: n(`SELECT COUNT(*) n FROM profiles WHERE COALESCE(json_extract(data,'$.paused'),0)=1`)},
    swipes: {total: n('SELECT COUNT(*) n FROM swipes'), right: n(`SELECT COUNT(*) n FROM swipes WHERE dir='right'`)},
    matches: {total: n('SELECT COUNT(*) n FROM matches'), chats: n('SELECT COUNT(*) n FROM matches WHERE chat_id IS NOT NULL'),
      numbersShared: n('SELECT COUNT(*) n FROM matches WHERE a_share=1 AND b_share=1')},
    rideIntent: q(`SELECT json_extract(data,'$.ride') ride, COUNT(*) n FROM profiles GROUP BY ride`).all(),
    topRefs: q(`SELECT COALESCE(ref,'(none)') ref, COUNT(*) n FROM users WHERE completed_at IS NOT NULL GROUP BY ref ORDER BY n DESC LIMIT 15`).all(),
    reportsPending: n('SELECT COUNT(DISTINCT to_id) n FROM reports WHERE resolved=0'),
    ageBlocks: n('SELECT COUNT(*) n FROM age_blocks'),
    identityConflicts: n('SELECT COUNT(*) n FROM users WHERE identity_conflict IS NOT NULL'),
    messageRequestsWaiting: n('SELECT COUNT(*) n FROM matches WHERE req_by IS NOT NULL AND chat_id IS NULL'),
  };
});
/* Everyone who signed up, as CSV: to import into Picapool while account creation isn't wired (the main KPI). */
route('GET', '/api/admin/export.csv', ({req, url, res}) => {
  admin(req, url);
  const rows = q(`SELECT u.*, p.data FROM users u LEFT JOIN profiles p ON p.user_id=u.id WHERE u.completed_at IS NOT NULL AND u.phone NOT LIKE '5%' ORDER BY u.completed_at`).all();
  const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; }; // no spreadsheet formulas
  const ist = t => t ? new Date(t + 330 * 60e3).toISOString().slice(0, 16).replace('T', ' ') : '';
  const lines = ['phone,first_name,gender,college,ref,signed_up_ist,has_pass,photos,events,picapool_id'];
  for (const r of rows) { const p = r.data ? JSON.parse(r.data) : null;
    lines.push([r.phone, r.first_name, r.gender, r.college, r.ref, ist(r.completed_at), p ? 'yes' : 'no', p ? (p.photos || []).length : 0,
      plansOf(p).map(x => `${x.name} (${x.dates.map(d => +d.slice(8)).join('/')} Oct ${x.time})`).join('; '), r.picapool_id].map(cell).join(',')); }
  res.writeHead(200, {'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="dandiya-signups-${istDay()}.csv"`, 'Cache-Control': 'no-store'});
  res.end('\ufeff' + lines.join('\n'));
  return undefined;
});
/* people whose Picapool gender differs from their Dandiya card: the card keeps working; a person decides (HANDOFF §4b) */
route('GET', '/api/admin/conflicts', ({req, url}) => {
  admin(req, url);
  return {rows: q(`SELECT id, phone, first_name, gender, college, picapool_id, identity_conflict FROM users WHERE identity_conflict IS NOT NULL`).all()
    .map(r => ({userId: r.id, phone: r.phone, name: r.first_name, gender: r.gender, college: r.college, picapoolId: r.picapool_id, conflict: r.identity_conflict}))};
});
route('GET', '/api/admin/top', ({req, url}) => {
  admin(req, url);
  const gender = url.searchParams.get('board') === 'king' ? 'male' : 'female';
  const period = url.searchParams.get('period') === 'week' ? 'week' : 'tonight';
  lbCache = {};
  return {rows: rankBoard(gender, period)};
});
route('GET', '/api/admin/reports', ({req, url}) => {
  admin(req, url);
  const rows = q(`SELECT to_id, COUNT(*) n, GROUP_CONCAT(reason, ' · ') reasons, MAX(at) last FROM reports WHERE resolved=0 GROUP BY to_id ORDER BY n DESC`).all();
  return {rows: rows.map(r => { const u = q('SELECT * FROM users WHERE id=?').get(r.to_id), p = profileOf(r.to_id), h = q('SELECT hidden FROM profiles WHERE user_id=?').get(r.to_id);
    return {userId: r.to_id, name: u?.first_name, college: u?.college, photo: p?.photos?.[0] || null, reports: r.n, reasons: r.reasons, hidden: !!h?.hidden}; })};
});
route('POST', '/api/admin/hide', ({req, url, body}) => {
  admin(req, url);
  const id = String(body.userId || ''), hidden = !!body.hidden;
  q('UPDATE profiles SET hidden=? WHERE user_id=?').run(hidden ? 1 : 0, id);
  if (!hidden) q('UPDATE reports SET resolved=1 WHERE to_id=?').run(id);
  bustCaches();
  return {ok: true};
});

/* ---------------- auto-delete after Navratri ---------------- */
function purgeIfDue() {
  if (istDay() < C.DELETE_ON) return;
  if (q(`SELECT v FROM meta WHERE k='purged'`).get()) return;
  tx(() => {
    for (const r of q('SELECT user_id, data FROM profiles').all()) {
      const p = JSON.parse(r.data);
      if (p.rideConsent) q('INSERT OR REPLACE INTO ride_intents(user_id, ride, seats, venue, saved_at) VALUES(?,?,?,?,?)').run(r.user_id, p.ride, p.seats || 0, plansOf(p)[0]?.name || null, now());
    }
    for (const t of ['profiles', 'swipes', 'matches', 'blocks', 'reports', 'dismissed']) db.exec(`DELETE FROM ${t}`);
    q(`INSERT INTO meta(k, v) VALUES('purged', ?)`).run(new Date().toISOString());
  });
  for (const f of fs.readdirSync(PHOTO_DIR)) fs.rm(path.join(PHOTO_DIR, f), () => {});
  bustCaches();
  console.log('[purge] Dandiya data deleted for', C.DELETE_ON);
}
purgeIfDue(); setInterval(purgeIfDue, 3600e3).unref();
setInterval(() => { q('DELETE FROM otps WHERE last_sent < ?').run(now() - 2 * 3600e3); }, 3600e3).unref();

/* ---------------- static ---------------- */
const PUBLIC = path.join(__dirname, 'public');
/* Browser security headers. The page is one file with inline script and styles; it loads images from this server, data:/blob: (photos being
   added, story images) and Unsplash (sample photos), and talks only to this server. Nothing may frame it (no clickjacking). */
const ORIGIN_EXTRA = C.PUBLIC_URL ? ' ' + C.PUBLIC_URL : '';
const PAGE_HEADERS = {
  'Content-Security-Policy': `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://images.unsplash.com${ORIGIN_EXTRA}; font-src 'self' data:; connect-src 'self'${ORIGIN_EXTRA}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`,
  'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  ...(PROD ? {'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'} : {}),
};
const PHOTO_HEADERS = {'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox", 'Cross-Origin-Resource-Policy': 'same-site'};
function serveFile(res, file, type, cache, extra = {}) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, {'Content-Type': 'text/plain'}); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', ...extra});
    res.end(buf);
  });
}
const TYPES = {jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml'};

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (C.CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', C.CORS_ORIGIN); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  try {
    if (p.startsWith('/api/')) {
      rateLimit(req);
      const r = routes.find(x => x.method === req.method && x.re.test(p));
      if (!r) bad('Not found.', 404);
      const params = p.match(r.re).groups || {};
      for (const k in params) params[k] = decodeURIComponent(params[k]);
      const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req, r.limit) : {};
      const out = await r.handler({req, res, url, body, params});
      if (out === undefined && res.headersSent) return; // the handler wrote the response itself (CSV export)
      return out === null ? (res.writeHead(204), res.end()) : send(res, 200, out);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') bad('Not found.', 404);
    if (p.startsWith('/photos/')) {
      const name = p.slice(8);
      if (!/^[\w-]+\.(jpg|png|webp|svg)$/.test(name)) bad('Not found.', 404);
      return serveFile(res, path.join(PHOTO_DIR, name), TYPES[name.split('.').pop()], 'public, max-age=86400', PHOTO_HEADERS);
    }
    if (p === '/admin') return serveFile(res, path.join(PUBLIC, 'admin.html'), 'text/html; charset=utf-8', 'no-store', {...PAGE_HEADERS, 'X-Robots-Tag': 'noindex'});
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    return serveFile(res, path.join(PUBLIC, 'index.html'), 'text/html; charset=utf-8', 'no-cache', PAGE_HEADERS);
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, {message: e.message, ...(e.code ? {code: e.code} : {})});
    console.error('[error]', req.method, p, e);
    return send(res, 500, {message: 'Something went wrong on our side. Try again.'});
  }
});
server.requestTimeout = 30e3; server.headersTimeout = 20e3; server.keepAliveTimeout = 5e3; // don't let slow or stuck connections pile up
setInterval(() => { q('DELETE FROM sessions WHERE created_at < ?').run(now() - C.SESSION_DAYS * 86400e3); }, 3600e3).unref();
if (require.main === module) server.listen(C.PORT, () => console.log(`Dandiya Nights running on :${C.PORT} (${PROD ? 'production' : 'dev'}) · data in ${C.DATA_DIR}`));
module.exports = {server, db, C};

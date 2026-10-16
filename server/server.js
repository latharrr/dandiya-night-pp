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
  RIGHT_CAP: +(ENV.SWIPE_RIGHT_CAP || 6), RIGHT_WINDOW_MS: 5*3600e3, SHARE_BONUS: 3, SHARE_BONUS_CAP: 2,
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
CREATE TABLE IF NOT EXISTS photo_flags(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, photo TEXT, at TEXT, status TEXT DEFAULT 'pending', resolved_at TEXT);
CREATE TABLE IF NOT EXISTS feedback(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, rating INTEGER, text TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS reports(id INTEGER PRIMARY KEY AUTOINCREMENT, from_id TEXT, to_id TEXT, reason TEXT, at INTEGER, resolved INTEGER DEFAULT 0, UNIQUE(from_id, to_id));
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, event TEXT, user_id TEXT, session_id TEXT, ref TEXT, data TEXT);
CREATE TABLE IF NOT EXISTS age_blocks(at INTEGER, ref TEXT);
CREATE TABLE IF NOT EXISTS ride_intents(user_id TEXT PRIMARY KEY, ride TEXT, seats INTEGER, venue TEXT, saved_at INTEGER);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS swipe_grants(user_id TEXT, day TEXT, extra INTEGER, by TEXT, at INTEGER);
`);
try { db.prepare('ALTER TABLE users ADD COLUMN feedback_done INTEGER DEFAULT 0').run(); } catch (e) {}
// build j: a match can hold one pending message request (sender has Picapool, the other person doesn't yet)
for (const col of ['req_by TEXT', 'req_opener TEXT', 'req_at INTEGER']) { try { db.exec(`ALTER TABLE matches ADD COLUMN ${col}`); } catch (e) { /* already there */ } }
// build k: identity sync with Picapool, and "Not for me" on likes you received
for (const col of ['wa_muted INTEGER DEFAULT 0', 'last_wa_inbound INTEGER']) { try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch (e) { /* already there */ } }
try { db.exec(`CREATE TABLE IF NOT EXISTS outbound_queue(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, phone TEXT, kind TEXT, body TEXT, status TEXT DEFAULT 'pending', reason TEXT, created_at INTEGER, sent_at INTEGER)`); } catch (e) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS wa_log(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, phone TEXT, user_id TEXT, type TEXT, status TEXT, detail TEXT)`); } catch (e) {}
for (const col of ['identity_conflict TEXT', 'picapool_synced_at INTEGER']) { try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch (e) { /* already there */ } }
db.exec(`CREATE TABLE IF NOT EXISTS dismissed(from_id TEXT, to_id TEXT, at INTEGER, PRIMARY KEY(from_id, to_id))`);
db.exec(`CREATE TABLE IF NOT EXISTS ig_requests(id INTEGER PRIMARY KEY AUTOINCREMENT, from_id TEXT NOT NULL, to_id TEXT NOT NULL, at INTEGER NOT NULL, status TEXT DEFAULT 'pending', handle TEXT, answered_at INTEGER, UNIQUE(from_id, to_id))`);
// v2.1: indexes for the lookups that run on every poll (pairs by either side, reports per person, sessions per user)
db.exec(`CREATE INDEX IF NOT EXISTS matches_b ON matches(b);
CREATE INDEX IF NOT EXISTS reports_to ON reports(to_id, resolved);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS profiles_board ON profiles(in_board, hidden);`);
const q = sql => db.prepare(sql);
/* A card is visible to others when it isn't hidden by an admin, has at least one photo and isn't paused by its owner.
   v2: a card can exist without a photo (the photo is asked for after the first swipe); until then nobody sees it. */
const VISIBLE = a => `${a}.hidden=0 AND json_array_length(${a}.data,'$.photos')>0 AND COALESCE(json_extract(${a}.data,'$.paused'),0)=0 AND ${a}.banned=0`;
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
    req.on('end', () => { const raw = Buffer.concat(chunks).toString('utf8'); req.rawBody = raw; if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch (e) { reject(new HttpError(400, 'Bad request.')); } });
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


const metaGet = k => { const r = q('SELECT v FROM meta WHERE k=?').get(k); return r ? r.v : null; };
const metaSet = (k, v) => q('INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));
const waGate = phone => {
  if (metaGet('wa_master') === 'off') return { ok: false, why: 'master-off' };
  if (phone) { const u = q('SELECT wa_muted FROM users WHERE phone=?').get(String(phone)); if (u && u.wa_muted) return { ok: false, why: 'muted' }; }
  return { ok: true };
};
const waLog = (phone, type, status, detail) => { try { const u = phone ? q('SELECT id FROM users WHERE phone=?').get(String(phone)) : null; q('INSERT INTO wa_log(ts, phone, user_id, type, status, detail) VALUES(?,?,?,?,?,?)').run(now(), String(phone || ''), u ? u.id : null, String(type), String(status), String(detail || '').slice(0, 300)); } catch (e) {} };
integrations.setWaHooks({ gate: waGate, log: waLog });
route('POST', '/api/auth/otp', async ({req, body}) => {
  const phone = String(body.phone || '');
  if (!/^[6-9]\d{9}$/.test(phone)) bad('Enter your 10-digit WhatsApp number.');
  const bp = q('SELECT p.banned FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.phone=?').get(phone);
  if (bp && bp.banned) bad('This account is no longer active.', 403);
  hit('otp:' + clientIp(req), 3600e3, C.OTP_PER_IP_HOUR, 'Too many codes from this network. Try again in a while.');
  const t = now(), o = q('SELECT * FROM otps WHERE phone=?').get(phone);
  if (o && t - o.last_sent < 30e3) bad('Wait 30 seconds before asking for another code.', 429);
  let windowStart = o ? o.window_start : t, count = o ? o.window_count : 0;
  if (t - windowStart > 3600e3) { windowStart = t; count = 0; }
  if (count >= 5) bad('Too many codes. Try again in an hour.', 429);
  const code = C.DEV_OTP || String(crypto.randomInt(0, 10 ** C.OTP_LENGTH)).padStart(C.OTP_LENGTH, '0');
  const prefer = ['sms', 'whatsapp'].includes(body.channel) ? body.channel : null;
  let via; try { via = await integrations.sendOtp(phone, code, prefer); waLog(phone, 'otp', 'sent', via); } catch (e) { console.error('[otp] send failed', e.message); bad("Couldn't send the code. Try again in a minute.", 502); }
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
    if (hasCard && u.gender) { if (u.identity_conflict !== 'gender') conflictNotice(u, 'gender').catch(function(){}); conflict = 'gender'; }                                            // never flip gender under an existing card: matches, likes and the board depend on it
    else gen = gender;                                                                        // no card yet: just use Picapool's
  } else if (conflict === 'gender' && gender === u.gender) { conflict = null; q(`UPDATE profiles SET hidden=0, hide_source=NULL WHERE user_id=? AND hide_source='auto:gender-conflict'`).run(u.id); }                  // they fixed it in the app
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
  // events are optional: people with no garba plan yet can skip
  let prompt = null;
  if (body.prompt && ENUMS.prompt.includes(body.prompt.id)) { const t = noContacts(clean(body.prompt.text, 60)); if (t.length >= 2) prompt = {id: body.prompt.id, text: t}; }
  const photosIn = Array.isArray(body.photos) ? body.photos : []; // a card may start without a photo; nobody sees it until it has one
  if (photosIn.length > C.MAX_PHOTOS) bad(`Up to ${C.MAX_PHOTOS} photos.`);
  const old = profileOf(u.id), keep = new Set(photoNames(old));
  if (photoNames(old).length === 0 && photosIn.length > 0) q('INSERT INTO photo_flags(user_id, photo, at) VALUES(?,?,?)').run(u.id, String(photosIn[0]).slice(0,200), now());
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

try { q('ALTER TABLE users ADD COLUMN rb_balance INTEGER').run(); } catch {}
try { q('ALTER TABLE users ADD COLUMN pica10_at INTEGER').run(); } catch {}
try { q('ALTER TABLE users ADD COLUMN rb_next_refill INTEGER').run(); } catch {}
try { q('ALTER TABLE users ADD COLUMN rb_share_day TEXT').run(); } catch {}
try { q('ALTER TABLE users ADD COLUMN rb_share_count INTEGER DEFAULT 0').run(); } catch {}
const nextMidnightIST = () => { const IST = 19800e3; return Math.ceil((Date.now() + IST) / 86400e3) * 86400e3 - IST; };
function getRights(u) {
  const now = Date.now();
  let bal = u.rb_balance, ref = u.rb_next_refill;
  if (bal === null || bal === undefined || !ref || now >= ref) { bal = C.RIGHT_CAP; ref = now + C.RIGHT_WINDOW_MS; q('UPDATE users SET rb_balance=?, rb_next_refill=? WHERE id=?').run(bal, ref, u.id); u.rb_balance = bal; u.rb_next_refill = ref; }
  return { balance: bal, nextAt: Math.min(ref, nextMidnightIST()), nextRefillAt: ref };
}
route('POST', '/api/share-bonus', ({req}) => {
  const u = authUser(req); needComplete(u);
  const day = istDay();
  const cnt = u.rb_share_day === day ? (u.rb_share_count || 0) : 0;
  if (cnt >= C.SHARE_BONUS_CAP) return {ok: false, reason: 'share_cap'};
  const rg = getRights(u);
  const nb = rg.balance + C.SHARE_BONUS;
  q('UPDATE users SET rb_balance=?, rb_share_day=?, rb_share_count=? WHERE id=?').run(nb, day, cnt + 1, u.id);
  return {ok: true, rightsLeftToday: nb, sharesUsedToday: cnt + 1};
});
route('POST', '/api/pica10/claim', ({req}) => {
  const u = authUser(req); needComplete(u);
  if (u.pica10_at) return {ok: false, reason: 'already'};
  const rg = getRights(u);
  const nb = rg.balance + 10;
  q('UPDATE users SET pica10_at=?, rb_balance=? WHERE id=?').run(Date.now(), nb, u.id);
  try { q('INSERT INTO events(ts,event,user_id,data) VALUES(?,?,?,?)').run(Date.now(), 'pica10_grant', u.id, '{}'); } catch (e) {}
  return {ok: true, rightsLeftToday: nb};
});
function rightsUsedToday(uid) { return q(`SELECT COUNT(*) n FROM swipes WHERE from_id=? AND dir='right' AND day=?`).get(uid, istDay()).n; }
function grantsToday(uid) { return q('SELECT COALESCE(SUM(extra),0) g FROM swipe_grants WHERE user_id=? AND day=?').get(uid, istDay()).g; }
function rightsLeftToday(uid) { return Math.max(0, C.DAILY_RIGHT_CAP + grantsToday(uid) - rightsUsedToday(uid)); }

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
  { const rg = getRights(u); return {profiles: list, rightsLeftToday: rg.balance, rightsNextAt: rg.nextAt}; }
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
  if (prev && prev.dir === 'right') { const rg0 = getRights(u); return {match: null, rightsLeftToday: rg0.balance, rightsNextAt: rg0.nextAt}; }
  const __rg = getRights(u); if (dir === 'right' && __rg.balance <= 0) bad('Out of right swipes for now - more picks soon!', 429);
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
  if (created) {
    const nm = (to, other, n = 0) => integrations.notifyMatch(to, other).then(() => console.log('[notifyMatch] sent to ...' + String(to.phone).slice(-4))).catch(e => { console.error('[notifyMatch] FAILED to ...' + String(to.phone).slice(-4), 'try', n + 1, e.message); if (n < 1) setTimeout(() => nm(to, other, n + 1), 5000); });
    nm(target, u); nm(u, target);
  }
  if (dir === 'right') q('UPDATE users SET rb_balance = MAX(0, COALESCE(rb_balance,0) - 1) WHERE id=?').run(u.id); const __rg2 = getRights(q('SELECT * FROM users WHERE id=?').get(u.id)); return {match: match ? matchJson(match, u.id) : null, rightsLeftToday: __rg2.balance, rightsNextAt: __rg2.nextAt};
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


/* ---- profile sheet: one person's full card + Instagram asks (16:10) ---- */
route('GET', '/api/person/:id', ({req, params}) => {
  const u = authUser(req); needProfile(u);
  hit('person:' + u.id, 3600e3, 300, 'Slow down for a minute.');
  const t = q(`SELECT u.*, p.data FROM profiles p JOIN users u ON u.id=p.user_id WHERE u.id=? AND ${VISIBLE('p')}`).get(String(params.id || ''));
  if (!t || t.id === u.id || blockedPair(u.id, t.id)) bad('That profile is no longer available.', 404);
  const ig = q('SELECT * FROM ig_requests WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)').get(u.id, t.id, t.id, u.id);
  const liked = !!q(`SELECT 1 FROM swipes WHERE from_id=? AND to_id=? AND dir='right'`).get(u.id, t.id);
  const m = q('SELECT id FROM matches WHERE a=? AND b=?').get(...[u.id, t.id].sort());
  return {person: {...card(t, JSON.parse(t.data)), gender: t.gender}, liked, matchId: m ? m.id : null,
    ig: ig ? (ig.from_id === u.id ? {dir: 'out', status: ig.status, handle: ig.status === 'shared' ? ig.handle : null} : {dir: 'in', status: ig.status, id: ig.id}) : null};
});

route('POST', '/api/ig/ask', ({req, body}) => {
  const u = authUser(req); needProfile(u);
  hit('igask:' + u.id, 3600e3, 30, 'Slow down - too many Instagram asks.');
  const t = q(`SELECT u.* FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=? AND ${VISIBLE('p')}`).get(String(body.targetId || ''));
  if (!t || t.id === u.id || blockedPair(u.id, t.id)) bad('That profile is no longer available.', 404);
  const ex = q('SELECT * FROM ig_requests WHERE from_id=? AND to_id=?').get(u.id, t.id);
  if (ex) {
    if (ex.status === 'pending') return {status: 'pending'};
    if (ex.status === 'shared') return {status: 'shared', handle: ex.handle};
    q(`UPDATE ig_requests SET status='pending', at=?, handle=NULL, answered_at=NULL WHERE id=?`).run(now(), ex.id);
  } else {
    q('INSERT INTO ig_requests(from_id, to_id, at) VALUES(?,?,?)').run(u.id, t.id, now());
  }
  q('INSERT INTO events(ts,event,user_id,data) VALUES(?,?,?,?)').run(now(), 'ig_ask', u.id, JSON.stringify({to: t.id}));
  return {status: 'pending'};
});

route('GET', '/api/ig/mine', ({req}) => {
  const u = authUser(req); needProfile(u);
  const personOf = id => { const r = q(`SELECT u.*, p.data FROM profiles p JOIN users u ON u.id=p.user_id WHERE u.id=? AND ${VISIBLE('p')}`).get(id); return r && !blockedPair(u.id, id) ? card(r, JSON.parse(r.data)) : null; };
  const incoming = q(`SELECT * FROM ig_requests WHERE to_id=? AND status='pending' ORDER BY at DESC`).all(u.id)
    .map(r => ({id: r.id, at: r.at, person: personOf(r.from_id)})).filter(x => x.person);
  const outgoing = q('SELECT * FROM ig_requests WHERE from_id=? ORDER BY at DESC LIMIT 50').all(u.id)
    .map(r => ({id: r.id, at: r.at, status: r.status, handle: r.status === 'shared' ? r.handle : null, person: personOf(r.to_id)})).filter(x => x.person);
  return {incoming, outgoing};
});

route('POST', '/api/ig/answer', ({req, body}) => {
  const u = authUser(req); needProfile(u);
  const r = q('SELECT * FROM ig_requests WHERE id=?').get(+body.id || 0);
  if (!r || r.to_id !== u.id) bad('That request is no longer available.', 404);
  const h = String(body.handle || '').trim().replace(/^@+/, '').toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(h)) bad("That doesn't look like an Instagram handle.");
  q(`UPDATE ig_requests SET status='shared', handle=?, answered_at=? WHERE id=?`).run(h, now(), r.id);
  q('INSERT INTO events(ts,event,user_id,data) VALUES(?,?,?,?)').run(now(), 'ig_share', u.id, JSON.stringify({to: r.from_id}));
  return {status: 'shared'};
});

route('POST', '/api/ig/decline', ({req, body}) => {
  const u = authUser(req); needProfile(u);
  const r = q('SELECT * FROM ig_requests WHERE id=?').get(+body.id || 0);
  if (!r || r.to_id !== u.id) bad('That request is no longer available.', 404);
  q(`UPDATE ig_requests SET status='declined', answered_at=? WHERE id=?`).run(now(), r.id);
  return {ok: true};
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

const BOOST_ID = process.env.BOARD_BOOST_ID || '';
const BOOST_N = Math.max(0, parseInt(process.env.BOARD_BOOST_N || '0', 10) || 0);
const boostSql = (BOOST_ID && BOOST_N) ? ' + ' + BOOST_N + "*(s.to_id='" + BOOST_ID + "')" : '';
const boostRest = (BOOST_ID && BOOST_N) ? ' + ' + BOOST_N + "*(u.id='" + BOOST_ID + "')" : '';
function rankBoard(gender, period) {
  const key = gender + ':' + period, c = lbCache[key];
  if (c && now() - c.at < C.LB_REFRESH_MS) return c.rows;
  const rows = q(`SELECT s.to_id id, COUNT(*)${boostSql} n FROM swipes s
      JOIN profiles pt ON pt.user_id=s.to_id AND pt.in_board=1 AND ${VISIBLE('pt')}
      JOIN users ut ON ut.id=s.to_id AND ut.gender=?
      JOIN profiles pf ON pf.user_id=s.from_id AND pf.hidden=0
      WHERE s.dir='right' ${period === 'tonight' ? 'AND s.day=?' : ''}
      GROUP BY s.to_id ORDER BY n DESC, MIN(s.at) ASC LIMIT ${C.BOARD_SIZE}`).all(...(period === 'tonight' ? [gender, istDay()] : [gender]));
  if (BOOST_ID && BOOST_N && !rows.some(r => r.id === BOOST_ID)) {
    const bp = q('SELECT hidden, in_board FROM profiles WHERE user_id=?').get(BOOST_ID);
    const bu = q('SELECT gender FROM users WHERE id=?').get(BOOST_ID);
    if (bp && !bp.hidden && bp.in_board && bu && bu.gender === gender) {
      rows.push({id: BOOST_ID, n: BOOST_N});
      rows.sort((a, b) => b.n - a.n);
      if (rows.length > C.BOARD_SIZE) rows.length = C.BOARD_SIZE;
    }
  }
  const out = rows.map(r => { const uu = q('SELECT * FROM users WHERE id=?').get(r.id), p = profileOf(r.id); return {id: r.id, name: uu.first_name, college: uu.college, photo: p.photos[0], count: r.n}; });
  /* v2: the board always shows up to BOARD_SIZE people a side. After the people picked tonight (or this Navratri) come the rest of the race,
     most-picked this Navratri first, then earliest pass. They have count 0: they never get a rank or a crown. */
  if (out.length < C.BOARD_SIZE) {
    const have = new Set(out.map(r => r.id));
    const rest = q(`SELECT u.id, u.first_name, u.college, p.data, p.created_at, (SELECT COUNT(*)${boostRest} FROM swipes s JOIN profiles pf ON pf.user_id=s.from_id AND pf.hidden=0 WHERE s.to_id=u.id AND s.dir='right') week
        FROM profiles p JOIN users u ON u.id=p.user_id WHERE p.in_board=1 AND ${VISIBLE('p')} AND u.gender=? ORDER BY week DESC, p.created_at ASC LIMIT ${C.BOARD_SIZE * 2}`).all(gender);
    for (const r of rest) { if (out.length >= C.BOARD_SIZE) break; if (have.has(r.id)) continue; out.push({id: r.id, name: r.first_name, college: r.college, photo: JSON.parse(r.data).photos[0], count: 0}); }
  }
  if (BOOST_ID) { // RANK3 2026-10-16: keep boosted person at board position 3 regardless of live counts
    const bi = out.findIndex(r => r.id === BOOST_ID);
    if (bi >= 0) { const [brow] = out.splice(bi, 1); out.splice(Math.min(2, out.length), 0, brow); }
  }
  lbCache[key] = {at: now(), rows: out};
  return out;
}
route('GET', '/api/leaderboard', ({req, url}) => {
  const board = url.searchParams.get('board') === 'king' ? 'king' : 'queen';
  const period = url.searchParams.get('period') === 'week' ? 'week' : 'tonight';
  const gender = board === 'queen' ? 'female' : 'male';
  const u = authUser(req, false);
  const top = rankBoard(gender, period).filter(r => !u || !blockedPair(u.id, r.id));
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

route('GET', '/api/feedback/status', ({req}) => {
  const u = authUser(req);
  return { done: !!u.feedback_done };
});

route('POST', '/api/feedback', ({req, body}) => {
  const u = authUser(req);
  const raw = parseInt(body.rating, 10);
  if (!raw || raw < 1 || raw > 5) bad('Rating 1-5 required.', 400);
  const rating = raw;
  q('INSERT INTO feedback(user_id, rating, text, at) VALUES(?,?,?,?)').run(u.id, rating, clean(body.text, 500) || '', now());
  q('UPDATE users SET feedback_done = 1 WHERE id = ?').run(u.id);
  return { ok: true };
});

route('GET', '/api/admin/photoqueue', ({req}) => {
  admin(req);
  return { queue: q("SELECT f.id, f.user_id, f.photo, f.at, f.status, u.first_name, u.phone, u.college FROM photo_flags f LEFT JOIN users u ON u.id = f.user_id WHERE f.status = 'pending' ORDER BY f.at DESC LIMIT 200").all() };
});

route('POST', '/api/admin/photo-approve', ({req, body}) => {
  admin(req);
  q("UPDATE photo_flags SET status = 'approved', resolved_at = ? WHERE id = ?").run(now(), parseInt(body.id, 10) || 0);
  return { ok: true };
});

route('POST', '/api/admin/photo-takedown', ({req, body}) => {
  admin(req);
  const id = parseInt(body.id, 10) || 0;
  const f = q('SELECT * FROM photo_flags WHERE id = ?').get(id);
  if (!f) bad('Not found.', 404);
  const p = q('SELECT data FROM profiles WHERE user_id = ?').get(f.user_id);
  if (p) {
    let d = {}; try { d = JSON.parse(p.data || '{}'); } catch (e) {}
    d.photos = (d.photos || []).filter(x => x !== f.photo);
    q("UPDATE profiles SET data = ?, hidden = 1, hide_source = 'auto:photo' WHERE user_id = ?").run(JSON.stringify(d), f.user_id);
  }
  q("UPDATE photo_flags SET status = 'removed', resolved_at = ? WHERE id = ?").run(now(), id);
  bustCaches();
  return { ok: true };
});

route('GET', '/api/admin/feedback', ({req}) => {
  admin(req);
  return { feedback: q('SELECT f.*, u.first_name, u.phone FROM feedback f LEFT JOIN users u ON u.id = f.user_id ORDER BY f.at DESC LIMIT 500').all() };
});

route('POST', '/api/report', ({req, body}) => {
  const u = authUser(req);
  const to = String(body.targetId || ''); if (!q('SELECT 1 FROM users WHERE id=?').get(to) || to === u.id) bad('That profile is no longer available.', 404);
  tx(() => {
    q('INSERT OR IGNORE INTO reports(from_id, to_id, reason, at) VALUES(?,?,?,?)').run(u.id, to, clean(body.reason, 40) || 'Other', now());
    q('INSERT OR IGNORE INTO blocks(from_id, to_id) VALUES(?,?)').run(u.id, to);
    const n = q('SELECT COUNT(DISTINCT from_id) n FROM reports WHERE to_id=? AND resolved=0').get(to).n;
    if (n >= C.REPORT_HIDE) q("UPDATE profiles SET hidden=1, hide_source='auto:reports' WHERE user_id=? AND hidden=0").run(to);
  });
  bustCaches();
  return {ok: true};
});
route('GET', '/api/blocks', ({req}) => {
  const u = authUser(req);
  const rows = q('SELECT b.to_id AS id, u2.first_name AS name FROM blocks b LEFT JOIN users u2 ON u2.id = b.to_id WHERE b.from_id = ?').all(u.id);
  return { blocked: rows.map(r => r.id), names: Object.fromEntries(rows.map(r => [r.id, r.name])) };
});

route('DELETE', '/api/block', ({req, url}) => {
  const u = authUser(req);
  const to = String(url.searchParams.get('targetId') || '');
  if (to) { q('DELETE FROM blocks WHERE from_id = ? AND to_id = ?').run(u.id, to); bustCaches(); }
  return { ok: true };
});

route('POST', '/api/block', ({req, body}) => {
  const u = authUser(req);
  const to = String(body.targetId || ''); if (to && to !== u.id) { q('INSERT OR IGNORE INTO blocks(from_id, to_id) VALUES(?,?)').run(u.id, to); bustCaches(); }
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


/* ------- WhatsApp admin: master toggle, mutes, nudges, broadcasts, logs (2026-10-16 batch) ------- */
route('GET', '/api/wa-webhook', async ({ url, res }) => {
  if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === (process.env.WHATSAPP_VERIFY_TOKEN || '')) {
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end(url.searchParams.get('hub.challenge') || ''); return undefined;
  }
  res.writeHead(403); res.end('nope'); return undefined;
});
route('POST', '/api/wa-webhook', async ({ req, body }) => {
  try { for (const e of (body && body.entry) || []) console.log('[wa-hook] waba', e.id); } catch {}
  const _sec = process.env.WHATSAPP_APP_SECRET;
  if (_sec) {
    const crypto = require('crypto');
    const _sig = String((req.headers && req.headers['x-hub-signature-256']) || '');
    const _exp = 'sha256=' + crypto.createHmac('sha256', _sec).update(req.rawBody || '', 'utf8').digest('hex');
    if (_sig.length !== _exp.length || !crypto.timingSafeEqual(Buffer.from(_sig), Buffer.from(_exp))) bad('Bad signature.', 403);
  }
  try {
    const msgs = body && body.entry ? body.entry.flatMap(e => (e.changes || []).flatMap(c => { const v = c.value || {}; return (v.messages || []).map(m => ({ from: m.from, ts: Number(m.timestamp) * 1000 })); })) : [];
    for (const m of msgs) {
      const ph = String(m.from || '').replace(/^91/, '');
      if (/^[6-9]\d{9}$/.test(ph)) q('UPDATE users SET last_wa_inbound=? WHERE phone=?').run(m.ts || now(), ph);
    }
      const stats = (body.entry || []).flatMap(e => (e.changes || []).flatMap(c => ((c.value || {}).statuses || []).map(s => ({ id: s.id, st: s.status, to: s.recipient_id, err: (s.errors || []).map(x => String(x.code) + ':' + String(x.title || '')).join(';') }))));
      for (const s of stats) { try { waLog(String(s.to || '-'), 'status', String(s.st || ''), String(s.id || '') + (s.err ? ' err=' + s.err : '')); } catch (e) {} }
  } catch (e) {}
  return { ok: true };
});

route('GET', '/api/admin/wa-state', async ({ req, url }) => { admin(req, url); return { master: metaGet('wa_master') === 'off' ? 'off' : 'on' }; });
route('POST', '/api/admin/wa-master', async ({ req, url, body }) => {
  admin(req, url);
  const on = body && body.on !== false && body.on !== 'false';
  metaSet('wa_master', on ? 'on' : 'off');
  waLog('-', 'admin', 'wa-master-' + (on ? 'on' : 'off'), 'admin panel');
  return { master: on ? 'on' : 'off' };
});
route('POST', '/api/admin/wa-mute', async ({ req, url, body }) => {
  admin(req, url);
  q('UPDATE users SET wa_muted=? WHERE id=?').run(body.muted ? 1 : 0, body.userId);
  const u = q('SELECT phone, first_name FROM users WHERE id=?').get(body.userId);
  waLog(u ? u.phone : String(body.userId), 'admin', 'wa-mute-' + (body.muted ? 'on' : 'off'), u ? u.first_name : '');
  return { ok: true, muted: !!body.muted };
});
const noPhotoUsers = () => q(`SELECT u.id, u.phone, u.first_name, u.last_wa_inbound FROM users u LEFT JOIN profiles p ON p.user_id = u.id
  WHERE u.completed_at IS NOT NULL AND u.wa_muted = 0 AND (p.user_id IS NULL OR json_array_length(COALESCE(json_extract(p.data, '$.photos'), '[]')) = 0)`).all();
route('GET', '/api/admin/no-photo-users', async ({ req, url }) => { admin(req, url); const rows = noPhotoUsers(); return { count: rows.length, users: rows.map(u => ({ id: u.id, name: u.first_name })) }; });
route('POST', '/api/admin/nudge-nophoto', async ({ req, url }) => {
  admin(req, url);
  const rows = noPhotoUsers();
  const base = process.env.APP_URL || 'https://dandiya.picapool.tech';
  let sentNow = 0, queued = 0, gated = 0, failed = 0;
  for (const u of rows) {
    const text = `Hi ${u.first_name}! Your Dandiya Night profile is live but has no photo - profiles with photos get way more matches. Add yours here: ${base}`;
    if (u.last_wa_inbound && now() - u.last_wa_inbound < 86400000) {
      const r = await integrations.waText(u.phone, text, 'nudge');
      if (r && r.gated) gated++; else if (r && r.ok) sentNow++; else failed++;
      await new Promise(r2 => setTimeout(r2, 250));
    } else {
      q('INSERT INTO outbound_queue(user_id, phone, kind, body, reason, created_at) VALUES(?,?,?,?,?,?)').run(u.id, u.phone, 'nudge', text, 'awaiting-template', now());
      waLog(u.phone, 'nudge', 'queued', 'awaiting template approval');
      queued++;
    }
  }
  return { ok: true, sentNow, queued, gated, total: rows.length, message: `nudged ${sentNow} now, ${queued} queued for template approval${gated ? `, ${gated} gated (master off)` : ''}${failed ? `, ${failed} failed` : ''}` };
});
route('GET', '/api/admin/broadcast-preview', async ({ req, url }) => {
  admin(req, url);
  const rows = q(`SELECT u.id, u.phone, u.first_name, u.last_wa_inbound FROM users u WHERE u.completed_at IS NOT NULL AND u.wa_muted = 0`).all();
  const inWindow = rows.filter(u => u.last_wa_inbound && now() - u.last_wa_inbound < 86400000).length;
  return { total: rows.length, inWindow, queued: rows.length - inWindow };
});
route('POST', '/api/admin/broadcast', async ({ req, url, body }) => {
  admin(req, url);
  const msg = String((body && body.message) || '').slice(0, 1000);
  if (!msg.trim()) bad('message is required');
  const rows = q(`SELECT u.id, u.phone, u.first_name, u.last_wa_inbound FROM users u WHERE u.completed_at IS NOT NULL AND u.wa_muted = 0`).all();
  let sentNow = 0, queued = 0, gated = 0, failed = 0;
  for (const u of rows) {
    const text = msg.replace(/\{\{name\}\}/g, u.first_name || 'there');
    if (u.last_wa_inbound && now() - u.last_wa_inbound < 86400000) {
      const r = await integrations.waText(u.phone, text, 'broadcast');
      if (r && r.gated) gated++; else if (r && r.ok) sentNow++; else failed++;
      await new Promise(r2 => setTimeout(r2, 250));
    } else {
      q('INSERT INTO outbound_queue(user_id, phone, kind, body, reason, created_at) VALUES(?,?,?,?,?,?)').run(u.id, u.phone, 'broadcast', text, 'awaiting-window', now());
      waLog(u.phone, 'broadcast', 'queued', 'outside 24h window');
      queued++;
    }
  }
  return { ok: true, sentNow, queued, gated, message: `sent ${sentNow} now, ${queued} queued (outside 24h window)${gated ? `, ${gated} gated` : ''}${failed ? `, ${failed} failed` : ''}` };
});
route('GET', '/api/admin/outbound-queue', async ({ req, url }) => {
  admin(req, url);
  return { rows: q(`SELECT id, phone, kind, reason, created_at FROM outbound_queue WHERE status='pending' ORDER BY created_at DESC LIMIT 100`).all() };
});
const CAPPED131026_MS = 3 * 86400000; // 72h marketing-cap cooldown (Meta per-recipient 131026)
function capped131026(phone) {
  try { const p10 = String(phone || '').replace(/\D/g, '').slice(-10); if (!p10) return false; const r = q(`SELECT ts FROM wa_log WHERE phone LIKE ? AND status='failed' AND detail LIKE '%131026%' AND ts > ? AND LENGTH(phone) <= 12 ORDER BY ts DESC LIMIT 1`).get('%' + p10, now() - CAPPED131026_MS); return !!r; } catch (e) { return false; }
}
async function conflictNotice(u, kind) {
  try {
    if (kind === 'gender') q(`UPDATE profiles SET hidden=1, hide_source='auto:gender-conflict' WHERE user_id=? AND hidden=0`).run(u.id);
    const mix = kind === 'gender' ? 'your linked Picapool account shows a different gender than your Dandiya profile' : 'some of your details do not match your linked Picapool account';
    await integrations.waTemplate(u.phone, 'dandiya_profile_notice', process.env.WHATSAPP_NOTICE_LANG || 'en_US', [u.first_name || 'there', mix, 'open the app and confirm your details'], null, 'profile_notice');
  } catch (e) { try { waLog(String(u.phone || '-'), 'profile_notice', 'send-failed', String((e && e.message) || e)); } catch (e2) {} }
}
route('POST', '/api/admin/profile-notice-test', async ({ req, url, body }) => {
  admin(req, url);
  const phone = String((body || {}).phone || '');
  if (!/^\d{10,15}$/.test(phone)) bad('Need a phone number.', 400);
  const res2 = await integrations.waTemplate(phone, 'dandiya_profile_notice', process.env.WHATSAPP_NOTICE_LANG || 'en_US', ['Deep', 'your linked Picapool account shows a different gender than your Dandiya profile (TEST)', 'open the app and confirm your details'], null, 'profile_notice');
  return { ok: !!(res2 && !res2.gated) };
});
route('POST', '/api/admin/queue-flush', async ({ req, url }) => {
  admin(req, url);
  const rows = q(`SELECT * FROM outbound_queue WHERE status='pending' LIMIT 50`).all();
  let sent = 0, failed = 0, stillQueued = 0;
  for (const r of rows) {
    const u = q('SELECT first_name, last_wa_inbound FROM users WHERE id=?').get(r.user_id) || {};
    let ok = false;
    if (r.kind === 'nudge' && capped131026(r.phone)) { q(`UPDATE outbound_queue SET status='suppressed' WHERE id=?`).run(r.id); waLog(r.phone, 'nudge', 'suppressed', '131026-cooldown'); continue; }
    if (r.kind === 'nudge') {
      try { const res2 = await integrations.waTemplate(r.phone, 'dandiya_photo_nudge', process.env.WHATSAPP_NUDGE_LANG || 'en_US', [u.first_name || 'there'], null, 'nudge'); ok = !!(res2 && !res2.gated); } catch (e) { ok = false; }
    } else {
      if (u.last_wa_inbound && now() - u.last_wa_inbound < 86400000) {
        const res2 = await integrations.waText(r.phone, r.body, r.kind);
        ok = !!(res2 && res2.ok);
      }
    }
    if (ok) { q(`UPDATE outbound_queue SET status='sent', sent_at=? WHERE id=?`).run(now(), r.id); sent++; }
    else if (r.kind !== 'nudge' && !(u.last_wa_inbound && now() - u.last_wa_inbound < 86400000)) stillQueued++;
    else { waLog(r.phone, r.kind, 'flush-failed', 'template/window'); stillQueued++; }
    await new Promise(r2 => setTimeout(r2, 250));
  }
  return { ok: true, sent, stillQueued, failed };
});
route('GET', '/api/admin/wa-log', async ({ req, url }) => {
  admin(req, url);
  const uid = url.searchParams.get('user_id');
  if (uid) {
    return {
      rollup: q(`SELECT type, COUNT(*) c FROM wa_log WHERE user_id=? GROUP BY type ORDER BY c DESC`).all(uid),
      rows: q(`SELECT ts, type, status, detail FROM wa_log WHERE user_id=? ORDER BY ts DESC LIMIT 100`).all(uid)
    };
  }
  return { rows: q(`SELECT ts, phone, type, status, detail FROM wa_log ORDER BY ts DESC LIMIT 300`).all() };
});
route('GET', '/api/admin/engagement', async ({ req, url }) => {
  admin(req, url);
  const uid = url.searchParams.get('user_id');
  if (!uid) bad('user_id required');
  const opens = q(`SELECT COUNT(*) c FROM events WHERE user_id=? AND event='app_open'`).get(uid).c;
  const views = q(`SELECT COUNT(*) c FROM events WHERE user_id=? AND event LIKE 'view_%'`).get(uid).c;
  const logins = q(`SELECT COUNT(*) c FROM sessions WHERE user_id=?`).get(uid).c;
  const muted = (q('SELECT wa_muted FROM users WHERE id=?').get(uid) || { wa_muted: 0 }).wa_muted;
  return {
    opens, views, logins, wa_muted: muted,
    viewsByPage: q(`SELECT event, COUNT(*) c FROM events WHERE user_id=? AND event LIKE 'view_%' GROUP BY event ORDER BY c DESC`).all(uid),
    timeline: q(`SELECT ts, event, data FROM events WHERE user_id=? ORDER BY ts DESC LIMIT 60`).all(uid),
    loginTimes: q(`SELECT created_at ts FROM sessions WHERE user_id=? ORDER BY created_at DESC LIMIT 20`).all(uid)
  };
});
route('GET', '/api/admin/engagement-overview', async ({ req, url }) => {
  admin(req, url);
  const totalUsers = q(`SELECT COUNT(*) c FROM users WHERE completed_at IS NOT NULL`).get().c || 1;
  const totalOpens = q(`SELECT COUNT(*) c FROM events WHERE event='app_open'`).get().c;
  const totalViews = q(`SELECT COUNT(*) c FROM events WHERE event LIKE 'view_%'`).get().c;
  const totalLogins = q(`SELECT COUNT(*) c FROM sessions`).get().c;
  return { users: totalUsers, totalOpens, totalViews, totalLogins, avgOpens: (totalOpens / totalUsers).toFixed(1), avgViews: (totalViews / totalUsers).toFixed(1), avgLogins: (totalLogins / totalUsers).toFixed(1) };
});
require('./admin2.js')({ route, admin, q, bad });
/* ---------------- admin ---------------- */
function admin(req, url) {
  // header only: a key in the URL ends up in logs and browser history
  if (!C.ADMIN_KEY || !same(req.headers['x-admin-key'], C.ADMIN_KEY)) bad('Wrong admin key.', 403);
}

route('GET', '/api/admin/analysis', async ({ req, url }) => {
  admin(req, url);
  const rows = q(`SELECT u.id user_id, u.first_name name, u.phone,
    (SELECT COUNT(*) FROM events e WHERE e.user_id=u.id AND e.event='app_open') opens,
    (SELECT COUNT(*) FROM sessions s WHERE s.user_id=u.id) logins,
    (SELECT COUNT(*) FROM events e2 WHERE e2.user_id=u.id AND e2.event LIKE 'view_%') views,
    (SELECT MAX(ts) FROM events e3 WHERE e3.user_id=u.id) last_ts,
    (SELECT GROUP_CONCAT(ev || ':' || c, ', ') FROM (SELECT e4.event ev, COUNT(*) c FROM events e4 WHERE e4.user_id=u.id AND e4.event LIKE 'view_%' GROUP BY e4.event ORDER BY c DESC)) views_by
    FROM users u WHERE u.completed_at IS NOT NULL ORDER BY opens DESC LIMIT 500`).all();
  return { users: rows };
});

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

/* -------- admin core: people list (search/filter in UI), user detail -------- */
// ADMIN7 2026-10-16: admin OTP resend - reuses the user OTP flow's channel logic (no bypass); requires an existing user; no IP limit (admin network), window counting kept
route('POST', '/api/admin/otp-resend', async ({req, url, body}) => {
  admin(req, url);
  const phone = String(body.phone || '');
  if (!/^[6-9]\d{9}$/.test(phone)) bad('Need the 10-digit WhatsApp number.');
  const u = q('SELECT id, first_name FROM users WHERE phone=?').get(phone);
  if (!u) bad('No user with that number.', 404);
  const t = now(), o = q('SELECT * FROM otps WHERE phone=?').get(phone);
  let windowStart = o ? o.window_start : t, count = o ? o.window_count : 0;
  if (t - windowStart > 3600e3) { windowStart = t; count = 0; }
  if (count >= 5) bad('Too many codes. Try again in an hour.', 429);
  const code = C.DEV_OTP || String(crypto.randomInt(0, 10 ** C.OTP_LENGTH)).padStart(C.OTP_LENGTH, '0');
  let via; try { via = await integrations.sendOtp(phone, code, null); } catch (e) { console.error('[otp] admin resend failed', e.message); bad("Couldn't send the code. Try again in a minute.", 502); }
  q('INSERT INTO otps(phone, code_hash, expires_at, attempts, last_sent, window_start, window_count) VALUES(?,?,?,?,?,?,?) ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, last_sent=excluded.last_sent, window_start=excluded.window_start, window_count=excluded.window_count').run(phone, sha(phone + ':' + code), t + C.OTP_TTL_MS, 0, t, windowStart, count + 1);
  q('INSERT INTO events(ts,event,user_id,data) VALUES(?,?,?,?)').run(t, 'admin_otp_resend', u.id, JSON.stringify({via}));
  return {ok: true, via, user: u.id};
});
// ADMIN7A 2026-10-16: ban - banned profiles are excluded from board/pairs/feed via VISIBLE and blocked at OTP request; reversible with banned=0
route('POST', '/api/admin/ban', ({req, url, body}) => {
  admin(req, url);
  const uid = String(body.userId || ''); const b = body.banned ? 1 : 0;
  const r = q('UPDATE profiles SET banned=? WHERE user_id=?').run(b, uid);
  if (!r.changes) bad('No profile for that user.', 404);
  q('INSERT INTO events(ts,event,user_id,session_id,ref,data) VALUES(?,?,?,NULL,NULL,?)').run(now(), b ? 'admin_ban' : 'admin_unban', uid, null);
  return {ok: true, banned: b};
});
// remove-profile: wipes the profile row (photos/bio/board presence) permanently; the user account stays and can re-register fresh
route('POST', '/api/admin/remove-profile', ({req, url, body}) => {
  admin(req, url);
  const uid = String(body.userId || '');
  const r = q('DELETE FROM profiles WHERE user_id=?').run(uid);
  if (!r.changes) bad('No profile for that user.', 404);
  q('INSERT INTO events(ts,event,user_id,session_id,ref,data) VALUES(?,?,?,NULL,NULL,?)').run(now(), 'admin_remove_profile', uid, null);
  return {ok: true, removed: true};
});
route('POST', '/api/admin/limit-restore', ({req, url, body}) => {
  admin(req, url);
  const id = String((body || {}).userId || ''); if (!id) bad('userId required');
  const u = q('SELECT id FROM users WHERE id=?').get(id); if (!u) bad('No such user.', 404);
  const __u = q('SELECT * FROM users WHERE id=?').get(id); const left = __u ? getRights(__u).balance : 0;
  if (left > 0) return {restored: false, reason: 'not exhausted', left};
  q('UPDATE users SET rb_balance=?, rb_next_refill=? WHERE id=?').run(C.RIGHT_CAP, now() + C.RIGHT_WINDOW_MS, id);
  return {restored: true, granted: C.RIGHT_CAP, left: C.RIGHT_CAP};
});
route('GET', '/api/admin/exhausted', ({req, url}) => {
  admin(req, url);
  const rows = q(`SELECT u.id, u.first_name name, u.phone, (SELECT COUNT(*) FROM swipes s WHERE s.from_id=u.id AND s.dir='right' AND s.day=?) usedToday, (SELECT MAX(at) FROM swipes s2 WHERE s2.from_id=u.id AND s2.dir='right') lastRight FROM users u WHERE u.completed_at IS NOT NULL AND u.rb_balance IS NOT NULL AND u.rb_balance <= 0 ORDER BY lastRight DESC LIMIT 200`).all(istDay());
  return {rows};
});
route('POST', '/api/admin/swipe-reset-sweep', async ({req, url, body}) => {
  admin(req, url);
  return await swipeResetSweep(String((body || {}).day || '') || null);
});
async function swipeResetSweep(forceDay) {
  const day = forceDay || q(`SELECT date(?/1000, 'unixepoch', '+5 hours', '+30 minutes') d`).get(now() - 86400e3).d;
  const marker = 'swipe_reset_done:' + day;
  if (!forceDay && q('SELECT v FROM meta WHERE k=?').get(marker)) return {day, skipped: 'already done'};
  const rows = q('SELECT id, phone, first_name FROM users WHERE completed_at IS NOT NULL AND rb_balance IS NOT NULL AND rb_balance <= 0').all();
  q('UPDATE users SET rb_balance=? WHERE rb_balance IS NOT NULL').run(C.RIGHT_CAP);
  const flag = ENV.SWIPE_RESET_NOTIFY === 'on';
  let sent = 0, failed = 0;
  if (flag) {
    for (const r of rows) {
      try {
        if (capped131026(r.phone)) { waLog(r.phone, 'reset', 'suppressed', '131026-cooldown'); continue; }
        await integrations.waTemplate(r.phone, ENV.WHATSAPP_RESET_TEMPLATE || 'dandiya_swipe_reset', ENV.WHATSAPP_RESET_LANG || 'en', [r.first_name || 'there', (ENV.APP_URL || 'https://dandiya.picapool.tech') + '/?swipe=1']);
        sent++;
      } catch (e) { failed++; console.error('[swipeReset] FAILED to ...' + String(r.phone).slice(-4), e.message); }
    }
  }
  q('INSERT INTO events(ts, event, user_id, session_id, ref, data) VALUES(?,?,?,?,?,?)').run(now(), 'swipe_reset_nudge', null, null, null, JSON.stringify({day, mode: flag ? 'sent' : 'log-only', recipients: rows.length, sent, failed, sample: rows.slice(0, 5).map(r => '...' + String(r.phone).slice(-4))}));
  if (flag || !forceDay) q('INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)').run(marker, new Date().toISOString());
  console.log('[swipeReset]', day, 'exhausted:', rows.length, flag ? ('sent: ' + sent + ' failed: ' + failed) : '(notify off, log-only)');
  return {day, exhausted: rows.length, mode: flag ? 'sent' : 'log-only', sent, failed, sample: rows.slice(0, 5).map(r => '...' + String(r.phone).slice(-4))};
}
setInterval(() => { swipeResetSweep().catch(e => console.error('[swipeReset]', e.message)); }, 60e3).unref();
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
  let p = url.pathname;
  const ADMP = process.env.ADMIN_PREFIX || '';
  if (ADMP) {
    const ap = '/' + ADMP, aap = '/api/' + ADMP;
    if (p === ap) p = '/admin';
    else if (p.startsWith(ap + '/')) p = '/admin' + p.slice(ap.length);
    else if (p === aap || p.startsWith(aap + '/')) p = '/api/admin' + p.slice(aap.length);
    else if (p === '/admin' || p.startsWith('/admin/') || p === '/api/admin' || p.startsWith('/api/admin/')) return send(res, 404, {message: 'not found'});
  }
  const serveAdminPage = (file) => {
    let h = fs.readFileSync(file, 'utf8');
    if (ADMP) { h = h.replaceAll('/api/admin', '/api/' + ADMP).replaceAll('"/admin/people"', '"/' + ADMP + '/people"').replaceAll('"/admin"', '"/' + ADMP + '"').replaceAll("'/admin/people'", "'/" + ADMP + "/people'").replaceAll("'/admin'", "'/" + ADMP + "'"); }
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...PAGE_HEADERS, 'X-Robots-Tag': 'noindex'});
    return res.end(h);
  };
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
    if (p === '/admin/people') return serveAdminPage(path.join(PUBLIC, 'admin2.html'));
    if (p === '/admin') return serveAdminPage(path.join(PUBLIC, 'admin.html'));
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
if (require.main === module) server.listen(C.PORT, '127.0.0.1', () => console.log(`Dandiya Nights running on :${C.PORT} (${PROD ? 'production' : 'dev'}) · data in ${C.DATA_DIR}`));
module.exports = {server, db, C};

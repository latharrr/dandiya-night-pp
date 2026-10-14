/*
 * Stick Together · Picapool Dandiya match · reference backend
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
const C = {
  PORT: +(ENV.PORT || 8080),
  DATA_DIR: path.resolve(ENV.DATA_DIR || path.join(__dirname, 'data')),
  ADMIN_KEY: ENV.ADMIN_KEY || (PROD ? '' : 'dev-admin'),
  DAILY_RIGHT_CAP: +(ENV.DAILY_RIGHT_CAP || 40),
  OTP_LENGTH: +(ENV.OTP_LENGTH || 4),
  OTP_TTL_MS: 10 * 60e3,
  DELETE_ON: ENV.DELETE_ON || '2026-10-20',
  DEEPLINK: ENV.DEEPLINK || 'picapool://chat/{chatId}',
  CORS_ORIGIN: ENV.CORS_ORIGIN || '*',
  PUBLIC_URL: (ENV.PUBLIC_URL || '').replace(/\/$/, ''),
  REPORT_HIDE: +(ENV.REPORT_HIDE || 3),
  LB_REFRESH_MS: +(ENV.LB_REFRESH_MS ?? 60e3), // leaderboard is recomputed at most once a minute
  STATS_REFRESH_MS: +(ENV.STATS_REFRESH_MS || 5 * 60e3),
  TRUST_PROXY: ENV.TRUST_PROXY === '1',
  DEV_OTP: PROD ? null : (ENV.DEV_OTP || null),
  PICAPOOL_WEBHOOK_SECRET: ENV.PICAPOOL_WEBHOOK_SECRET || '', // shared secret for Picapool's backend to push account changes (§4b of HANDOFF)
  MAX_PHOTOS: 5,        // keep equal to CONFIG.MAX_PHOTOS in the page
  BOARD_SIZE: 20,       // top N per board (Garba Queen / Garba King); keep equal to CONFIG.BOARD_SIZE
  PREVIEW_MAX: 5,       // guests peek at no more than this many people per request (the page also caps them at 5 in total)
  SAMPLE_PROFILES: ENV.SAMPLE_PROFILES !== '0', // fill the guest peek with labelled sample people (samples.json) while there are fewer than 5 real ones
  SHOW_COUNTS: ENV.SHOW_COUNTS !== '0',         // the page shows "184 girls from North Campus are going"; 0 = never send counts
  COUNT_MIN: +(ENV.COUNT_MIN || 20),            // below this many people the count is not sent (the page shows the line without a number)
};
// Women-only colleges: never accepted for a guy's account (the page doesn't offer them either)
const WOMEN_ONLY_COLLEGES = ['daulat ram college', 'daulat ram', 'indraprastha college for women', 'miranda house'];
if (PROD && !C.ADMIN_KEY) { console.error('Set ADMIN_KEY in production.'); process.exit(1); }
const NIGHTS = ['d1','d2','d3','d4','d5','d6','d7','d8','d9'];
// Navratri 2026 (keep equal to CONFIG.NIGHTS in the page). Used to keep sample people on nights that haven't passed.
const NIGHT_DATES = NIGHTS.map((id, i) => [id, `2026-10-${String(11 + i).padStart(2, '0')}`]);
const ENUMS = {
  gender: ['female','male'], lookingFor: ['one','every'], skill: ['learning','hold','main'], style: ['garba','dandiya','both'],
  sticks: ['have','spare','need'], outfit: ['night','own','match'], knuckle: ['tap','click','breaker'], ride: ['own','cab','metro','need'],
  prompt: ['anthem','teach','find','flag'],
};
const SKILL_LEVEL = {learning: 0, hold: 1, main: 2};
const PHOTO_DIR = path.join(C.DATA_DIR, 'photos');
fs.mkdirSync(PHOTO_DIR, {recursive: true});

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

function userJson(u) { return u ? {id: u.id, firstName: u.first_name || '', gender: u.gender || null, college: u.college || '', adult: !!u.adult, hasPicapool: !!u.picapool_id} : null; }
function profileOf(userId) { const r = q('SELECT data FROM profiles WHERE user_id=?').get(userId); return r ? JSON.parse(r.data) : null; }
function card(u, p) {
  return {id: u.id, name: u.first_name, college: u.college, photos: p.photos, nights: p.nights, venue: p.venue, lookingFor: p.lookingFor, skill: p.skill,
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
const ipHits = new Map();
function rateLimit(req) {
  const ip = (C.TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
  const t = now(), w = ipHits.get(ip) || {start: t, n: 0};
  if (t - w.start > 5 * 60e3) { w.start = t; w.n = 0; }
  w.n++; ipHits.set(ip, w);
  if (w.n > 900) bad('Too many requests. Wait a few minutes.', 429);
}
setInterval(() => { const t = now(); for (const [k, w] of ipHits) if (t - w.start > 10 * 60e3) ipHits.delete(k); }, 60e3).unref();
function authUser(req, required = true) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  const s = m && q('SELECT user_id FROM sessions WHERE token_hash=?').get(sha(m[1]));
  const u = s && q('SELECT * FROM users WHERE id=?').get(s.user_id);
  if (!u && required) bad('Please log in again.', 401);
  return u || null;
}
const needComplete = u => { if (!u.first_name || !u.gender || !u.adult) bad('Finish your profile first.', 409); };
const needProfile = u => { needComplete(u); const p = profileOf(u.id); if (!p) bad('Make your Dandiya card first.', 409); return p; };

/* ---------------- caches ---------------- */
let lbCache = {}, statsCache = null;
const bustCaches = () => { lbCache = {}; statsCache = null; if (typeof previewCache !== 'undefined') previewCache = {}; };

/* ---------------- routes ---------------- */
const routes = [];
const route = (method, pattern, handler, opts = {}) => routes.push({method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, limit: opts.limit || 64e3});

route('GET', '/api/health', () => ({ok: true, day: istDay()}));

route('GET', '/api/stats', () => {
  if (statsCache && now() - statsCache.at < C.STATS_REFRESH_MS) return statsCache.body;
  const rows = q(`SELECT u.college, p.data FROM profiles p JOIN users u ON u.id=p.user_id WHERE ${VISIBLE('p')}`).all();
  const byNight = {}, cc = {};
  for (const r of rows) { const d = JSON.parse(r.data); for (const n of d.nights) byNight[n] = (byNight[n] || 0) + 1; cc[r.college] = (cc[r.college] || 0) + 1; }
  const topColleges = Object.entries(cc).filter(([n]) => n && n !== 'Not in college' && n !== 'Other DU college').sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => ({name, count}));
  const body = {total: rows.length, byNight, topColleges};
  statsCache = {at: now(), body};
  return body;
});

/* Guests peek before signing up: the day's top PREVIEW_MAX people of the other side, in Garba Queen/King order
   (tonight's board first, then the all-Navratri board, then everyone else in a daily shuffle).
   First name, college, nights, line and the main photo. Never phones, venues or hidden, paused or photo-less people.
   While there are fewer than PREVIEW_MAX real people, labelled sample people (samples.json) fill the gap: real people always come first.
   `count` is how many real people of that side (on those nights, if given) have a visible card; null below COUNT_MIN or with SHOW_COUNTS=0. */
let previewCache = {};
const SAMPLES = (() => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'samples.json'), 'utf8')); } catch (e) { return {female: [], male: []}; } })();
route('GET', '/api/preview', ({url}) => {
  const gender = url.searchParams.get('gender') === 'male' ? 'male' : 'female';
  const nights = String(url.searchParams.get('nights') || '').split(',').filter(n => NIGHTS.includes(n)).slice(0, 9);
  const key = gender + ':' + nights.sort().join(',') + ':' + istDay();
  const c = previewCache[key]; if (c && now() - c.at < 120e3) return c.body;
  const rows = q(`SELECT u.id, u.first_name, u.college, p.data FROM profiles p JOIN users u ON u.id=p.user_id WHERE ${VISIBLE('p')} AND u.adult=1 AND u.gender=?`).all(gender);
  const eligible = rows.map(r => ({r, p: JSON.parse(r.data)})).filter(({p}) => !nights.length || p.nights.some(n => nights.includes(n)));
  const order = [...rankBoard(gender, 'tonight'), ...rankBoard(gender, 'week')].map(x => x.id);
  const pos = id => { const i = order.indexOf(id); return i < 0 ? Infinity : i; };
  const rest = shuffle(eligible.filter(({r}) => pos(r.id) === Infinity), key);
  let list = [...eligible.filter(({r}) => pos(r.id) < Infinity).sort((a, b) => pos(a.r.id) - pos(b.r.id)), ...rest];
  list = list.slice(0, C.PREVIEW_MAX).map(({r, p}) => ({id: r.id, name: r.first_name, college: r.college, nights: p.nights, prompt: p.prompt || null, photo: p.photos[0]}));
  if (C.SAMPLE_PROFILES && list.length < C.PREVIEW_MAX) {
    const today = istDay(), upcoming = NIGHT_DATES.filter(([, d]) => d >= today).map(([id]) => id);
    const fill = (SAMPLES[gender] || []).slice(0, C.PREVIEW_MAX - list.length).map((x, i) => {
      const ns = (x.nights || []).filter(n => upcoming.includes(n));
      return {id: `sample-${gender[0]}${i + 1}`, name: x.name, college: x.college, nights: ns.length ? ns : upcoming.slice(0, 2), prompt: x.line ? {id: 'flag', text: x.line} : null, photo: x.photo, sample: true};
    });
    list = [...list, ...fill];
  }
  const count = C.SHOW_COUNTS && eligible.length >= C.COUNT_MIN ? eligible.length : null;
  const body = {profiles: list, count};
  previewCache = {[key]: {at: now(), body}, ...Object.fromEntries(Object.entries(previewCache).slice(0, 40))};
  return body;
});

route('POST', '/api/auth/otp', async ({body}) => {
  const phone = String(body.phone || '');
  if (!/^[6-9]\d{9}$/.test(phone)) bad('Enter your 10-digit WhatsApp number.');
  const t = now(), o = q('SELECT * FROM otps WHERE phone=?').get(phone);
  if (o && t - o.last_sent < 30e3) bad('Wait 30 seconds before asking for another code.', 429);
  let windowStart = o ? o.window_start : t, count = o ? o.window_count : 0;
  if (t - windowStart > 3600e3) { windowStart = t; count = 0; }
  if (count >= 5) bad('Too many codes. Try again in an hour.', 429);
  const code = C.DEV_OTP || String(crypto.randomInt(0, 10 ** C.OTP_LENGTH)).padStart(C.OTP_LENGTH, '0');
  try { await integrations.sendOtp(phone, code); } catch (e) { console.error('[otp] send failed', e.message); bad("Couldn't send the code. Try again in a minute.", 502); }
  q(`INSERT INTO otps(phone, code_hash, expires_at, attempts, last_sent, window_start, window_count) VALUES(?,?,?,?,?,?,?)
     ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, last_sent=excluded.last_sent, window_start=excluded.window_start, window_count=excluded.window_count`)
    .run(phone, sha(phone + ':' + code), t + C.OTP_TTL_MS, 0, t, windowStart, count + 1);
  return {ok: true};
});

route('POST', '/api/auth/verify', async ({body}) => {
  const phone = String(body.phone || ''), code = String(body.code || '');
  const o = q('SELECT * FROM otps WHERE phone=?').get(phone);
  if (!o || !o.code_hash || o.expires_at < now()) bad('That code expired. Tap "Resend code".');
  if (o.attempts >= 5) bad('Too many wrong tries. Tap "Resend code".', 429);
  if (sha(phone + ':' + code) !== o.code_hash) { q('UPDATE otps SET attempts=attempts+1 WHERE phone=?').run(phone); bad("That code isn't right. Check the message and try again."); }
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
  if (!C.PICAPOOL_WEBHOOK_SECRET || req.headers['x-picapool-secret'] !== C.PICAPOOL_WEBHOOK_SECRET) bad('Not allowed.', 403);
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

function savePhoto(userId, src, keep) {
  if (typeof src !== 'string') bad('Bad photo.');
  const own = src.replace(C.PUBLIC_URL, '');
  const m0 = /^\/photos\/([\w-]+\.(?:jpg|png|webp))$/.exec(own);
  if (m0) { if (!m0[1].startsWith(userId + '-') || !keep.has(m0[1])) bad('Bad photo.'); return m0[1]; }
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(src);
  if (!m) bad('Photos must be JPG or PNG.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 1.5e6) bad('That photo is too big.');
  const sig = buf.subarray(0, 4).toString('hex');
  if (!(sig.startsWith('ffd8') || sig === '89504e47' || sig === '52494646')) bad('Photos must be JPG or PNG.');
  const name = `${userId}-${crypto.randomBytes(8).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(PHOTO_DIR, name), buf);
  return name;
}
function photoNames(p) { return (p?.photos || []).map(u => (u.split('/photos/')[1] || '')).filter(Boolean); }

route('PUT', '/api/profile', ({req, body}) => {
  const u = authUser(req); needComplete(u);
  const e = (k, v) => ENUMS[k].includes(v) ? v : bad('Please answer every question.');
  const opt = (k, v) => v === null || v === undefined || v === '' ? null : e(k, v); // filled in later from the Me tab
  const nights = [...new Set(Array.isArray(body.nights) ? body.nights : [])].filter(n => NIGHTS.includes(n));
  if (!nights.length) bad('Pick at least one night.');
  const venue = clean(body.venue, 40) || null; if (venue === '__other') bad('Type where you are going.');
  let prompt = null;
  if (body.prompt && ENUMS.prompt.includes(body.prompt.id)) { const t = noContacts(clean(body.prompt.text, 60)); if (t.length >= 2) prompt = {id: body.prompt.id, text: t}; }
  const photosIn = Array.isArray(body.photos) ? body.photos : []; // a card may start without a photo; nobody sees it until it has one
  if (photosIn.length > C.MAX_PHOTOS) bad(`Up to ${C.MAX_PHOTOS} photos.`);
  const old = profileOf(u.id), keep = new Set(photoNames(old));
  const names = photosIn.map(src => savePhoto(u.id, src, keep));
  const ride = opt('ride', body.ride);
  // tiny blurred-preview thumbnail (≤18×22 JPEG): the only image guests ever receive
  const thumb = typeof body.thumb === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]{20,3000}$/.test(body.thumb) ? body.thumb : (old?.thumb || null);
  const p = {photos: names.map(photoUrl), thumb, nights, venue, lookingFor: opt('lookingFor', body.lookingFor), skill: opt('skill', body.skill), style: opt('style', body.style),
    sticks: opt('sticks', body.sticks), outfit: opt('outfit', body.outfit), knuckle: opt('knuckle', body.knuckle), prompt, ride,
    seats: ride === 'own' ? Math.max(1, Math.min(3, +body.seats || 1)) : 0, rideConsent: !!body.rideConsent,
    // new cards are in the Garba Queen/King race unless they say otherwise; an existing card keeps its stored choice unless it is sent
    inBoard: body.inBoard === undefined ? (old ? !!old.inBoard : true) : !!body.inBoard,
    paused: body.paused === undefined ? !!old?.paused : !!body.paused};
  const t = now();
  q(`INSERT INTO profiles(user_id, data, in_board, hidden, created_at, updated_at) VALUES(?,?,?,0,?,?)
     ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, in_board=excluded.in_board, updated_at=excluded.updated_at`).run(u.id, JSON.stringify(p), p.inBoard ? 1 : 0, t, t);
  for (const n of keep) if (!names.includes(n)) fs.rm(path.join(PHOTO_DIR, n), () => {});
  bustCaches();
  return {profile: p};
}, {limit: 12e6});

function rightsUsedToday(uid) { return q(`SELECT COUNT(*) n FROM swipes WHERE from_id=? AND dir='right' AND day=?`).get(uid, istDay()).n; }

route('GET', '/api/feed', ({req, url}) => {
  const u = authUser(req); const me = needProfile(u);
  const all = url.searchParams.get('all') === '1', passed = url.searchParams.get('passed') === '1';
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
    const p = JSON.parse(r.data);
    if (!passed && !all && !p.nights.some(n => me.nights.includes(n))) continue;
    list.push(card(r, p));
  }
  const tier = p => { const night = p.nights.some(n => me.nights.includes(n)); if (night && p.venue && p.venue === me.venue) return 0; if (night) return 1;
    return Math.abs((SKILL_LEVEL[p.skill] ?? 1) - (SKILL_LEVEL[me.skill] ?? 1)) <= 1 ? 2 : 3; };
  const tiers = [[], [], [], []]; list.forEach(p => tiers[tier(p)].push(p));
  list = tiers.flatMap((x, i) => shuffle(x, u.id + ':' + istDay() + ':' + i)).slice(0, 60);
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
      me = {count, rank: i >= 0 ? i + 1 : null};
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
  const k = req.headers['x-admin-key'] || url.searchParams.get('key');
  if (!C.ADMIN_KEY || k !== C.ADMIN_KEY) bad('Wrong admin key.', 403);
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
      inBoard: n('SELECT COUNT(*) n FROM profiles WHERE in_board=1')},
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
      if (p.rideConsent) q('INSERT OR REPLACE INTO ride_intents(user_id, ride, seats, venue, saved_at) VALUES(?,?,?,?,?)').run(r.user_id, p.ride, p.seats || 0, p.venue, now());
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
function serveFile(res, file, type, cache) {
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, {'Content-Type': 'text/plain'}); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type': type, 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin'});
    res.end(buf);
  });
}
const TYPES = {jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', svg: 'image/svg+xml'};

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  res.setHeader('Access-Control-Allow-Origin', C.CORS_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
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
      return out === null ? (res.writeHead(204), res.end()) : send(res, 200, out);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') bad('Not found.', 404);
    if (p.startsWith('/photos/')) {
      const name = p.slice(8);
      if (!/^[\w-]+\.(jpg|png|webp|svg)$/.test(name)) bad('Not found.', 404);
      return serveFile(res, path.join(PHOTO_DIR, name), TYPES[name.split('.').pop()], 'public, max-age=86400');
    }
    if (p === '/admin') return serveFile(res, path.join(PUBLIC, 'admin.html'), 'text/html; charset=utf-8', 'no-store');
    if (p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    return serveFile(res, path.join(PUBLIC, 'index.html'), 'text/html; charset=utf-8', 'no-cache');
  } catch (e) {
    if (e instanceof HttpError) return send(res, e.status, {message: e.message, ...(e.code ? {code: e.code} : {})});
    console.error('[error]', req.method, p, e);
    return send(res, 500, {message: 'Something went wrong on our side. Try again.'});
  }
});
if (require.main === module) server.listen(C.PORT, () => console.log(`Stick Together running on :${C.PORT} (${PROD ? 'production' : 'dev'}) · data in ${C.DATA_DIR}`));
module.exports = {server, db, C};

const _emit = process.emitWarning; process.emitWarning = (w, ...x) => (String(w && w.message || w).includes('SQLite') ? undefined : _emit.call(process, w, ...x));
// Run: npm test   (starts its own server on a temp folder with DEV_OTP=1234; never touches real data)
const {spawn} = require('node:child_process'); const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
const PORT = 8099 + Math.floor(Math.random() * 500);
const ORIGIN = 'http://127.0.0.1:' + PORT, B = ORIGIN + '/api';
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'st-test-'));
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {env: {...process.env, NODE_ENV: 'test', DEV_OTP: '1234', LB_REFRESH_MS: '0', PICAPOOL_WEBHOOK_SECRET: 'hook-secret', SAMPLE_PROFILES: '0', COUNT_MIN: '3', PORT: String(PORT), DATA_DIR: DIR}, stdio: 'ignore'});
const done = () => { srv.kill(); fs.rmSync(DIR, {recursive: true, force: true}); };
const j = async (m, p, body, tok) => { const r = await fetch(B + p, {method: m, headers: {'Content-Type': 'application/json', ...(tok ? {Authorization: 'Bearer ' + tok} : {})}, body: body ? JSON.stringify(body) : undefined});
  const t = await r.text(); let o = {}; try { o = t ? JSON.parse(t) : {}; } catch (e) { o = {raw: t}; } return {s: r.status, o}; };
const ok = (c, msg) => { if (!c) { console.log('FAIL', msg); process.exitCode = 1; } else console.log('ok  ', msg); };
const jpg = 'data:image/jpeg;base64,' + Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3,4,5,6,7,8]).toString('base64');
const {DatabaseSync} = require('node:sqlite');
const hook = (body, secret = 'hook-secret') => fetch(B + '/integrations/picapool-user', {method: 'POST', headers: {'Content-Type': 'application/json', 'X-Picapool-Secret': secret}, body: JSON.stringify(body)}).then(async r => ({s: r.status, o: await r.json().catch(() => ({}))}));
const sql = (q, ...a) => { const d = new DatabaseSync(path.join(DIR, 'dandiya.db')); d.exec('PRAGMA busy_timeout=3000'); try { return /^\s*select/i.test(q) ? d.prepare(q).all(...a) : d.prepare(q).run(...a); } finally { d.close(); } };
(async () => {
  await new Promise(r => setTimeout(r, 900));
  let pass = 0; const _ok = ok;
  ok((await j('GET', '/health')).s === 200, 'health');
  ok((await j('POST', '/auth/otp', {phone: '1234567890'})).s === 400, 'rejects bad phone');
  async function login(phone) { const a = await j('POST', '/auth/otp', {phone}); ok(a.s === 200, 'otp sent ' + phone);
    const w = await j('POST', '/auth/verify', {phone, code: '0000', ref: 'test'}); ok(w.s === 400, 'wrong code rejected');
    const v = await j('POST', '/auth/verify', {phone, code: '1234', ref: 'shraddha', sessionId: 's' + phone}); ok(v.s === 200 && v.o.token && v.o.user === null, 'verify new user'); return v.o.token; }
  const g = await login('9811111111'), b = await login('9822222222');
  ok((await j('POST', '/auth/otp', {phone: '9811111111'})).s === 429, 'otp cooldown');
  ok((await j('PUT', '/profile', {}, g)).s === 409, 'profile before account blocked');
  ok((await j('POST', '/account', {firstName: 'Riya', gender: 'female', college: 'Miranda House', adult: true}, g)).s === 200, 'account girl');
  ok((await j('POST', '/account', {firstName: 'Kabir', gender: 'male', college: 'Hansraj', adult: true}, b)).s === 200, 'account guy');
  ok((await j('POST', '/account', {firstName: 'X1', gender: 'male', college: 'Hansraj', adult: true}, b)).s === 400, 'bad name rejected');
  ok((await j('POST', '/account', {firstName: 'Kabir', gender: 'male', college: 'Miranda House', adult: true}, b)).s === 400, "guy can't pick a women-only college");
  { const lk = await j('POST', '/picapool/lookup', {}, b); ok(lk.s === 200 && lk.o.status === 'unavailable', 'Picapool lookup says "unavailable" while not wired (never fakes a result)'); }
  ok((await j('POST', '/picapool/lookup', {})).s === 401, 'lookup needs login');
  const prof = (extra) => ({photos: [jpg], nights: ['d6', 'd7'], venue: 'College garba', lookingFor: 'one', skill: 'hold', style: 'both', sticks: 'have', outfit: 'night', knuckle: 'click',
    prompt: {id: 'anthem', text: 'Chogada call me 9876543210 @insta'}, ride: 'own', seats: 2, rideConsent: true, inBoard: true, ...extra});
  const pg = await j('PUT', '/profile', prof(), g); ok(pg.s === 200 && pg.o.profile.photos[0].startsWith('/photos/'), 'profile girl saved, photo stored');
  ok(pg.o.profile.prompt.text === 'Chogada call me', 'contacts stripped from prompt: "' + pg.o.profile.prompt.text + '"');
  ok((await j('PUT', '/profile', prof({photos: ['data:image/jpeg;base64,AAAA']}), b)).s === 400, 'fake image rejected');
  ok((await j('PUT', '/profile', prof({nights: []}), b)).s === 400, 'no nights rejected');
  ok((await j('PUT', '/profile', prof(), b)).s === 200, 'profile guy saved');
  const pg2 = await j('PUT', '/profile', {...prof(), photos: [pg.o.profile.photos[0], jpg]}, g); ok(pg2.s === 200 && pg2.o.profile.photos[0] === pg.o.profile.photos[0] && pg2.o.profile.photos.length === 2, 'edit keeps old photo + adds new');
  const photo = await fetch(ORIGIN + '' + pg2.o.profile.photos[0]); ok(photo.status === 200 && photo.headers.get('content-type') === 'image/jpeg', 'photo served');
  ok((await j('PUT', '/profile', {...prof(), photos: ['/photos/u_someoneelse-abc.jpg']}, b)).s === 400, "can't claim someone else's photo");
  const thumb = 'data:image/jpeg;base64,' + Buffer.alloc(120, 7).toString('base64');
  const minimal = await j('PUT', '/profile', {photos: [jpg], nights: ['d6'], knuckle: 'tap', thumb}, b); ok(minimal.s === 200 && minimal.o.profile.skill === null && minimal.o.profile.venue === null && minimal.o.profile.thumb === thumb, 'card with only photo + nights + knuckle is accepted');
  { const bare = await j('PUT', '/profile', {photos: [jpg], nights: ['d6']}, b); ok(bare.s === 200 && bare.o.profile.knuckle === null, 'card needs only photo + nights'); }
  ok((await j('PUT', '/profile', {photos: [jpg], nights: []}, b)).s === 400, 'nights still required');
  ok((await j('PUT', '/profile', {photos: [jpg], nights: ['d6'], knuckle: 'huge'}, b)).s === 400, 'bad optional value rejected');
  const pv = await j('GET', '/preview?gender=male&nights=d6'); ok(pv.s === 200 && pv.o.profiles.length === 1 && /^\/photos\//.test(pv.o.profiles[0].photo), 'guest preview lists the guy with his main photo (clear, v2)');
  const pvc = pv.o.profiles[0]; ok(!('photos' in pvc) && !('phone' in pvc) && !('venue' in pvc), 'guest preview has only the main photo, no phone or venue');
  ok(pv.o.count === null, 'count not sent below COUNT_MIN');
  ok(Object.keys(pvc).sort().join() === 'college,id,name,nights,photo,prompt', 'guest preview sends only name, college, nights, line, main photo');
  { const pp = await login('9855555555');
    ok((await hook({phone: '9855555555', picapoolId: 'pp_sim', firstName: 'Simran Kaur', gender: 'female', college: 'Miranda House'})).o.linked, 'signed up on Picapool before making a card → linked');
    const lk = await j('POST', '/picapool/lookup', {}, pp); ok(lk.o.user.firstName === 'Simran' && lk.o.user.gender === 'female' && lk.o.user.hasPicapool === true, 'page gets the Picapool first name and gender');
    const ac = await j('POST', '/account', {firstName: 'Sim', gender: 'male', college: 'Hindu College', adult: true}, pp);
    ok(ac.s === 200 && ac.o.user.firstName === 'Simran' && ac.o.user.gender === 'female' && ac.o.user.college === 'Hindu College', 'About you can\'t override the Picapool name/gender; college stays theirs'); }
  { const fresh = await login('9844444444'); ok((await j('POST', '/account', {firstName: 'Mira', gender: 'female', college: 'Faculty of Technology', adult: true}, fresh)).s === 200, '"Other college" free text accepted');
    const np = await j('PUT', '/profile', {photos: [jpg], nights: ['d6']}, fresh); ok(np.s === 200 && np.o.profile.inBoard === true, 'a new card joins the race automatically');
    for (let i = 0; i < 7; i++) { const id = 'u_pv' + i; sql(`INSERT INTO users(id, phone, first_name, gender, college, adult, created_at) VALUES(?,?,?,?,?,1,?)`, id, '51000000' + i, 'Guy' + i, 'male', 'Hindu College', Date.now());
      sql(`INSERT INTO profiles(user_id, data, in_board, hidden, created_at, updated_at) VALUES(?,?,1,0,?,?)`, id, JSON.stringify({photos: ['/photos/x.jpg'], nights: ['d8'], inBoard: true}), Date.now(), Date.now()); }
    { const p5 = await j('GET', '/preview?gender=male&nights=d8'); ok(p5.o.profiles.length === 5, 'guest preview returns at most 5 people');
      ok(p5.o.count === 7, 'guest preview counts everyone on those nights (' + p5.o.count + ')'); }
    { const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata'}).format(new Date()), mira = sql("SELECT id FROM users WHERE phone='9844444444'")[0].id;
      sql(`INSERT INTO swipes(from_id, to_id, dir, day, at) VALUES(?,?,?,?,?)`, mira, 'u_pv3', 'right', day, Date.now());
      sql(`INSERT INTO swipes(from_id, to_id, dir, day, at) VALUES(?,?,?,?,?)`, sql("SELECT id FROM users WHERE phone='9811111111'")[0].id, 'u_pv3', 'right', day, Date.now());
      sql(`INSERT INTO swipes(from_id, to_id, dir, day, at) VALUES(?,?,?,?,?)`, mira, 'u_pv5', 'right', day, Date.now() + 5);
      const tp = (await j('GET', '/preview?gender=male&nights=')).o.profiles.map(p => p.name);
      ok(tp[0] === 'Guy3' && tp[1] === 'Guy5' && tp.length === 5, 'guests see the day\'s top guys first: ' + tp.join(', '));
      sql("DELETE FROM swipes WHERE to_id IN ('u_pv3','u_pv5')"); }
    for (let i = 0; i < 7; i++) { sql('DELETE FROM profiles WHERE user_id=?', 'u_pv' + i); sql('DELETE FROM users WHERE id=?', 'u_pv' + i); }
    ok((await j('DELETE', '/profile', null, fresh)).s === 200, 'cleanup'); }
  ok((await j('GET', '/preview?gender=male&nights=d1')).o.profiles.length === 0, 'guest preview filters by night');
  ok((await j('PUT', '/profile', prof(), b)).s === 200, 'guy fills in the rest of his card later');
  { const five = await j('PUT', '/profile', {photos: [jpg, jpg, jpg, jpg, jpg], nights: ['d6']}, b); ok(five.s === 200 && five.o.profile.photos.length === 5, '5 photos accepted'); }
  { const six = await j('PUT', '/profile', {photos: [jpg, jpg, jpg, jpg, jpg, jpg], nights: ['d6']}, b); ok(six.s === 400 && /5 photos/.test(six.o.message), '6 photos rejected: "' + six.o.message + '"'); }
  ok((await j('PUT', '/profile', prof(), b)).s === 200, 'guy card restored');
  ok((await j('GET', '/preview?gender=male&nights=d6')).o.profiles[0].photo.startsWith('/photos/'), 'preview photo is the main photo');
  // v2: a card can start without a photo (asked after the first swipe); nobody sees it until it has one
  { const np = await login('9866666666');
    ok((await j('POST', '/account', {firstName: 'Dev', gender: 'male', college: 'Ramjas College', adult: true}, np)).s === 200, 'account for a photo-less card');
    const c0 = await j('PUT', '/profile', {photos: [], nights: ['d6']}, np); ok(c0.s === 200 && c0.o.profile.photos.length === 0, 'card without a photo is accepted');
    ok(!(await j('GET', '/preview?gender=male&nights=d6')).o.profiles.some(p => p.name === 'Dev'), 'photo-less card not in the guest preview');
    ok(!(await j('GET', '/feed?all=1', null, g)).o.profiles.some(p => p.name === 'Dev'), 'photo-less card not in anyone\'s feed');
    const devId = sql("SELECT id FROM users WHERE phone='9866666666'")[0].id;
    ok((await j('POST', '/swipe', {targetId: devId, dir: 'right'}, g)).s === 404, "can't pick a photo-less card");
    ok((await j('GET', '/feed?all=1', null, np)).s === 200, 'photo-less person can still see the feed');
    const c1 = await j('PUT', '/profile', {photos: [jpg], nights: ['d6']}, np); ok(c1.s === 200, 'photo added later');
    ok((await j('GET', '/feed?all=1', null, g)).o.profiles.some(p => p.name === 'Dev'), 'card visible once it has a photo');
    ok((await j('POST', '/profile/pause', {paused: true}, np)).o.paused === true, 'pause');
    ok(!(await j('GET', '/feed?all=1', null, g)).o.profiles.some(p => p.name === 'Dev'), 'paused card leaves the feed');
    ok(!(await j('GET', '/preview?gender=male&nights=d6')).o.profiles.some(p => p.name === 'Dev'), 'paused card leaves the guest preview');
    const kept = await j('PUT', '/profile', {photos: c1.o.profile.photos, nights: ['d6', 'd7']}, np); ok(kept.o.profile.paused === true, 'editing a card keeps it paused');
    ok((await j('POST', '/profile/pause', {paused: false}, np)).o.paused === false, 'unpause');
    ok((await j('GET', '/feed?all=1', null, g)).o.profiles.some(p => p.name === 'Dev'), 'unpaused card is back');
    ok((await j('POST', '/profile/pause', {paused: true})).s === 401, 'pause needs login');
    ok((await j('DELETE', '/profile', null, np)).s === 200, 'cleanup photo-less test'); }
  const fg = await j('GET', '/feed?all=0', null, g); ok(fg.s === 200 && fg.o.profiles.length === 1 && fg.o.profiles[0].name === 'Kabir' && fg.o.rightsLeftToday === 40, 'girl sees guy in feed');
  ok(!('phone' in fg.o.profiles[0]) && !('rideConsent' in fg.o.profiles[0]), 'card has no phone / private fields');
  const kid = fg.o.profiles[0].id, rid = (await j('GET', '/feed?all=0', null, b)).o.profiles[0].id;
  // pass first, then review passed profiles and like after all: one swipe row, no duplicate
  ok((await j('POST', '/swipe', {targetId: kid, dir: 'left'}, g)).s === 200, 'girl passes on guy');
  { const rv = await j('GET', '/feed?passed=1', null, g); ok(rv.s === 200 && rv.o.profiles.length === 1 && rv.o.profiles[0].id === kid, 'review passed lists him'); }
  ok((await j('GET', '/likes/sent', null, g)).o.sent.length === 0, 'nothing in Sent while passed');
  const s1 = await j('POST', '/swipe', {targetId: kid, dir: 'right'}, g); ok(s1.s === 200 && s1.o.match === null && s1.o.rightsLeftToday === 39, 'girl changes the pass to a like, no match yet');
  ok(sql('SELECT COUNT(*) n FROM swipes WHERE from_id=? AND to_id=?', rid, kid)[0].n === 1, 'still one swipe row after pass → like');
  { const rc = await j('GET', '/likes/received', null, b); ok(rc.s === 200 && rc.o.received.length === 1 && rc.o.received[0].person.name === 'Riya' && !('phone' in rc.o.received[0].person), 'Likes you: he sees Riya liked him (no phone)'); }
  ok((await j('POST', '/likes/dismiss', {targetId: rid}, b)).s === 200 && (await j('GET', '/likes/received', null, b)).o.received.length === 0, '"Not for me" removes her from Likes you');
  sql('DELETE FROM dismissed'); ok((await j('GET', '/likes/received', null, b)).o.received.length === 1, 'back in Likes you after undo (test only)');
  ok((await j('GET', '/feed?passed=1', null, g)).o.profiles.length === 0, 'liked person leaves review list');
  { const sl = await j('GET', '/likes/sent', null, g); ok(sl.s === 200 && sl.o.sent.length === 1 && sl.o.sent[0].person.name === 'Kabir' && !('phone' in sl.o.sent[0].person), 'Sent lists him (no phone)'); }
  ok((await j('GET', '/feed?all=1', null, g)).o.profiles.length === 0, 'swiped profile gone from feed');
  const s2 = await j('POST', '/swipe', {targetId: rid, dir: 'right'}, b); ok(s2.s === 200 && s2.o.match && s2.o.match.person.name === 'Riya' && s2.o.match.numberStatus === 'none' && s2.o.match.person.hasPicapool === false, 'guy swipes right → match (she has no Picapool account)');
  ok((await j('POST', '/swipe', {targetId: rid, dir: 'right'}, b)).o.match === null && sql('SELECT COUNT(*) n FROM matches')[0].n === 1, 'liking again makes no second match');
  ok((await j('GET', '/likes/sent', null, g)).o.sent.length === 0, 'matched person leaves Sent');
  ok((await j('GET', '/likes/received', null, b)).o.received.length === 0, 'liking back moves her from Likes you to Mutual');
  const mg = await j('GET', '/matches', null, g); ok(mg.o.matches.length === 1 && mg.o.matches[0].person.name === 'Kabir', 'girl sees match via GET /matches');
  const mid = mg.o.matches[0].id;
  { const no = await j('POST', `/matches/${mid}/chat`, {opener: 'Hi'}, g); ok(no.s === 409 && no.o.code === 'need_account', 'chat needs your own Picapool account first'); }
  sql("UPDATE users SET picapool_id='pp_riya' WHERE id=?", rid);
  { const rq = await j('POST', `/matches/${mid}/chat`, {opener: 'Hey Kabir! Fri? call 9999999999'}, g); ok(rq.s === 200 && rq.o.status === 'requested' && !rq.o.chatId, 'he has no Picapool yet → message request, no chat claimed'); }
  { const mg2 = (await j('GET', '/matches', null, g)).o.matches[0]; ok(mg2.chatRequest === 'sent' && mg2.requestMessage === 'Hey Kabir! Fri? call' && mg2.chatId === null, 'sender sees "request sent" with her message (contacts stripped)'); }
  { const mb = (await j('GET', '/matches', null, b)).o.matches[0]; ok(mb.chatRequest === 'received' && !('requestMessage' in mb) && mb.person.hasPicapool === true, 'he sees a waiting message request'); }
  ok((await j('POST', `/matches/${mid}/chat`, {}, b)).o.code === 'need_account', 'he still needs a Picapool account to open it');
  ok((await hook({phone: '9822222222', picapoolId: 'pp_kabir'}, 'wrong')).s === 403, 'Picapool push needs the shared secret');
  ok((await hook({phone: '9877777777', picapoolId: 'pp_x'})).o.linked === false, 'Picapool push for someone not on Stick Together is ignored');
  { const hk = await hook({phone: '+91 98222 22222', picapoolId: 'pp_kabir', firstName: 'Kabir Singh', gender: 'male'}); ok(hk.s === 200 && hk.o.linked && !hk.o.nameChanged && !hk.o.conflict, 'he signs up in the Picapool app → pushed and linked in real time'); }
  await new Promise(r => setTimeout(r, 150));
  { const auto = (await j('GET', '/matches', null, g)).o.matches[0]; ok(auto.chatId && auto.chatRequest === null && auto.person.hasPicapool === true, 'her waiting message became a real chat the moment he joined'); }
  ok((await j('POST', '/picapool/lookup', {}, b)).o.status === 'found', 'lookup says found for a linked account');
  const ch = await j('POST', `/matches/${mid}/chat`, {}, b); ok(ch.s === 200 && ch.o.status === 'created' && ch.o.chatId && ch.o.deepLink.includes(encodeURIComponent(ch.o.chatId)), 'he opens it → same chat + deep link');
  { const after = (await j('GET', '/matches', null, g)).o.matches[0]; ok(after.chatId === ch.o.chatId && after.chatRequest === null, 'both share the chat, request cleared'); }
  // identity clashes after the card exists
  { const nm = await hook({phone: '9822222222', picapoolId: 'pp_kabir', firstName: 'Kabeer', gender: 'male'}); ok(nm.o.nameChanged === true && (await j('GET', '/matches', null, g)).o.matches[0].person.name === 'Kabeer', 'name changed in Picapool → his card and matches show the Picapool name'); }
  { const gc = await hook({phone: '9822222222', picapoolId: 'pp_kabir', firstName: 'Kabeer', gender: 'female'}); const me = sql('SELECT gender, identity_conflict FROM users WHERE id=?', kid)[0];
    ok(gc.o.conflict === 'gender' && me.gender === 'male' && me.identity_conflict === 'gender', 'gender clash after the card exists → card keeps working, flagged for admin'); }
  { const cf = await fetch(B + '/admin/conflicts', {headers: {'X-Admin-Key': 'dev-admin'}}).then(r => r.json()); ok(cf.rows.length === 1 && cf.rows[0].conflict === 'gender', 'admin sees the clash'); }
  ok((await hook({phone: '9822222222', picapoolId: 'pp_kabir', firstName: 'Kabeer', gender: 'male'})).o.conflict === null, 'fixed in the app → clash cleared');
  ok((await hook({phone: '9822222222', deleted: true})).s === 200 && (await j('GET', '/matches', null, g)).o.matches[0].person.hasPicapool === false, 'Picapool account deleted → unlinked');
  await hook({phone: '9822222222', picapoolId: 'pp_kabir', firstName: 'Kabir', gender: 'male'});
  ok((await j('POST', `/matches/${mid}/chat`, {}, g)).o.chatId === ch.o.chatId, 'opening again returns the same chat');
  const n1 = await j('POST', `/matches/${mid}/share-number`, {}, g); ok(n1.o.status === 'waiting', 'number waiting after one side');
  ok((await j('GET', '/matches', null, b)).o.matches[0].phone === undefined, 'no phone leaked before both agree');
  const n2 = await j('POST', `/matches/${mid}/share-number`, {}, b); ok(n2.o.status === 'shared' && n2.o.phone === '9811111111', 'number shared after both agree');
  // 25 more girls each with a like from Kabir today: the board shows the top 20
  { const day = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata'}).format(new Date());
    for (let i = 0; i < 25; i++) { const id = 'u_lb' + i; sql(`INSERT INTO users(id, phone, first_name, gender, college, adult, created_at) VALUES(?,?,?,?,?,1,?)`, id, '50000000' + String(i).padStart(2, '0'), 'Girl' + i, 'female', 'Hindu College', Date.now());
      sql(`INSERT INTO profiles(user_id, data, in_board, hidden, created_at, updated_at) VALUES(?,?,1,0,?,?)`, id, JSON.stringify({photos: ['/photos/x.jpg'], nights: ['d6'], inBoard: true}), Date.now(), Date.now());
      sql(`INSERT INTO swipes(from_id, to_id, dir, day, at) VALUES(?,?,?,?,?)`, kid, id, 'right', day, Date.now() + i); }
    const big = await j('GET', '/leaderboard?board=queen&period=tonight'); ok(big.o.top.length === 20, 'board shows top 20 per side (' + big.o.top.length + ')');
    for (let i = 0; i < 25; i++) { sql('DELETE FROM swipes WHERE to_id=?', 'u_lb' + i); sql('DELETE FROM profiles WHERE user_id=?', 'u_lb' + i); sql('DELETE FROM users WHERE id=?', 'u_lb' + i); } }
  const lbq = await j('GET', '/leaderboard?board=queen&period=tonight'); ok(lbq.s === 200 && lbq.o.top.length === 1 && lbq.o.top[0].name === 'Riya' && !('count' in lbq.o.top[0]) && lbq.o.me === null, 'public queen board, no counts');
  const lbme = await j('GET', '/leaderboard?board=queen&period=tonight', null, g); ok(lbme.o.me && lbme.o.me.count === 1 && lbme.o.me.rank === 1 && lbme.o.top[0].isMe, 'my rank + private count');
  ok((await j('POST', '/leaderboard/opt', {optIn: false}, g)).s === 200, 'opt out');
  { const keep = await j('PUT', '/profile', {photos: [jpg], nights: ['d6']}, g); ok(keep.s === 200 && keep.o.profile.inBoard === false, 'editing a card keeps a stored opt-out'); }
  ok((await j('GET', '/leaderboard?board=queen&period=week')).o.top.length === 0, 'opted-out hidden from board');
  const st = await j('GET', '/stats'); ok(st.o.total === 2 && st.o.byNight.d6 === 2, 'stats counts');
  ok((await j('POST', '/report', {targetId: kid, reason: 'Fake profile'}, g)).s === 200, 'report');
  ok((await j('GET', '/matches', null, g)).o.matches.length === 0, 'reported/blocked match disappears');
  const ev = await fetch(B + '/events', {method: 'POST', headers: {'Content-Type': 'text/plain'}, body: JSON.stringify({event: 'landing_view', sessionId: 's9811111111', ref: 'x'})}); ok(ev.status === 204, 'event beacon (text/plain)');
  ok((await j('GET', '/admin/summary')).s === 403, 'admin needs key');
  const ad = await fetch(B + '/admin/summary', {headers: {'X-Admin-Key': 'dev-admin'}}).then(r => r.json()); ok(ad.accounts.completed === 5 && ad.identityConflicts === 0 && ad.topRefs[0].ref === 'shraddha' && ad.matches.chats === 1 && ad.profiles.noPhoto === 0 && ad.profiles.paused === 0, 'admin summary: accounts, refs, chats, photo-less and paused passes');
  ok((await j('DELETE', '/profile', null, b)).s === 200, 'delete profile');
  ok((await j('GET', '/feed', null, b)).s === 409, 'feed needs profile after delete');
  const kidPhotoGone = await fetch(ORIGIN + '/photos/' + 'nope.jpg'); ok(kidPhotoGone.status === 404, '404 on missing photo');
  // under-18 path
  const t3 = await login('9833333333'); ok((await j('POST', '/age-block', {}, t3)).s === 200, 'age block'); ok((await j('GET', '/matches', null, t3)).s === 401, 'age-blocked account removed');
  const page = await fetch(ORIGIN + '/shraddha'); const html = await page.text(); ok(page.status === 200 && html.includes("MODE: 'live'"), 'slug path serves live page');
  ok((await fetch(ORIGIN + '/admin')).status === 200, 'admin page served');
  ok((await j('GET', '/nope')).s === 404, 'unknown api 404');
  // sample people fill the guest peek (a second server with SAMPLE_PROFILES on, fresh data)
  { const P2 = PORT + 600, D2 = fs.mkdtempSync(path.join(os.tmpdir(), 'st-test-s-'));
    const s2 = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {env: {...process.env, NODE_ENV: 'test', DEV_OTP: '1234', PORT: String(P2), DATA_DIR: D2}, stdio: 'ignore'});
    await new Promise(r => setTimeout(r, 900));
    try {
      const r = await fetch(`http://127.0.0.1:${P2}/api/preview?gender=female`).then(x => x.json());
      ok(r.profiles.length === 5 && r.profiles.every(p => p.sample === true && /^sample-f\d$/.test(p.id) && /^https:/.test(p.photo)), 'empty side: 5 labelled sample people fill the guest peek');
      ok(r.count === null, 'samples never count as people going');
      ok(r.profiles.every(p => p.nights.length > 0), 'samples always have a night');
    } finally { s2.kill(); fs.rmSync(D2, {recursive: true, force: true}); } }
  console.log(process.exitCode ? '\nSOME CHECKS FAILED' : '\nALL CHECKS PASSED');
})().catch(e => { console.log('CRASH', e); process.exitCode = 1; }).finally(done);

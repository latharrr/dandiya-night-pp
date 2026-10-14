/*
 * Test data only. Creates fake profiles so you can test the feed, matching and leaderboard.
 *   node seed.js 30          → 30 girls + 30 guys (phones start with 5, so nobody can log in as them)
 *   node seed.js --remove    → delete every seeded profile
 * Refuses to run when NODE_ENV=production unless you add --force.
 * Real launch seeding = real people signing up (see HANDOFF.md §8).
 */
'use strict';
if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) { console.error('Refusing to seed in production. Add --force if you really mean it.'); process.exit(1); }
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {db, C} = require('./server');
const PHOTO_DIR = path.join(C.DATA_DIR, 'photos');
const q = s => db.prepare(s);

if (process.argv.includes('--remove')) {
  const ids = q(`SELECT id FROM users WHERE phone LIKE '5%'`).all().map(r => r.id);
  for (const id of ids) {
    for (const f of fs.readdirSync(PHOTO_DIR)) if (f.startsWith(id + '-')) fs.rmSync(path.join(PHOTO_DIR, f));
    q('DELETE FROM profiles WHERE user_id=?').run(id); q('DELETE FROM swipes WHERE from_id=? OR to_id=?').run(id, id);
    q('DELETE FROM matches WHERE a=? OR b=?').run(id, id); q('DELETE FROM users WHERE id=?').run(id);
  }
  console.log('removed', ids.length, 'seeded users'); process.exit(0);
}
const N = Math.max(1, Math.min(200, +process.argv[2] || 20));
const F = ['Ananya','Ishita','Riya','Kavya','Sneha','Tanvi','Aditi','Meher','Simran','Diya','Khushi','Nandini','Pooja','Saanvi','Avni','Jhanvi','Muskan','Prisha','Radhika','Tara'];
const M = ['Arjun','Kabir','Rohan','Aarav','Vihaan','Dev','Ishaan','Karan','Aditya','Siddharth','Yash','Rahul','Nikhil','Harsh','Pranav','Varun','Ayush','Kunal','Manav','Raghav'];
const COLLEGES = ['Daulat Ram','Hansraj','Hindu','Indraprastha College for Women','Kirori Mal','Miranda House','Ramjas','SGTB Khalsa','Shri Ram College of Commerce',"St. Stephen's"];
const pick = a => a[Math.floor(Math.random() * a.length)];
const today = new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata'}).format(new Date());
const NIGHT_DATES = {d1:'2026-10-11',d2:'2026-10-12',d3:'2026-10-13',d4:'2026-10-14',d5:'2026-10-15',d6:'2026-10-16',d7:'2026-10-17',d8:'2026-10-18',d9:'2026-10-19'};
let up = Object.keys(NIGHT_DATES).filter(k => NIGHT_DATES[k] >= today); if (!up.length) up = ['d9'];
let made = 0;
for (const gender of ['female', 'male']) for (let i = 0; i < N; i++) {
  const id = 'u_' + crypto.randomBytes(10).toString('hex');
  const phone = '5' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  const name = pick(gender === 'female' ? F : M);
  const hue = Math.floor(Math.random() * 360);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500"><rect width="400" height="500" fill="hsl(${hue},70%,60%)"/><circle cx="200" cy="205" r="78" fill="#2B1B14"/><circle cx="200" cy="215" r="64" fill="#C68863"/><path d="M80 500c0-100 54-170 120-170s120 70 120 170z" fill="#1B1410"/><text x="200" y="470" text-anchor="middle" font-family="Arial" font-size="28" fill="#fff">TEST</text></svg>`;
  const file = `${id}-seed.svg`; fs.writeFileSync(path.join(PHOTO_DIR, file), svg);
  const nights = up.filter(() => Math.random() < 0.5); if (!nights.length) nights.push(pick(up));
  const ride = pick(['own','cab','metro','need']);
  const data = {photos: [`${C.PUBLIC_URL}/photos/${file}`], nights, venue: pick(['Main North Campus event','College garba','Society / PG garba',null]),
    lookingFor: pick(['one','every']), skill: pick(['learning','hold','main']), style: pick(['garba','dandiya','both']), sticks: pick(['have','spare','need']),
    outfit: pick(['night','own','match']), knuckle: pick(['tap','click','breaker']), prompt: {id: 'flag', text: 'Test profile'}, ride, seats: ride === 'own' ? 1 : 0,
    rideConsent: false, inBoard: Math.random() < 0.8};
  q(`INSERT INTO users(id, phone, first_name, gender, college, adult, ref, created_at, completed_at) VALUES(?,?,?,?,?,1,'seed',?,?)`).run(id, phone, name, gender, pick(COLLEGES), Date.now(), Date.now());
  q(`INSERT INTO profiles(user_id, data, in_board, hidden, created_at, updated_at) VALUES(?,?,?,0,?,?)`).run(id, JSON.stringify(data), data.inBoard ? 1 : 0, Date.now(), Date.now());
  made++;
}
console.log('seeded', made, 'test profiles (remove with: node seed.js --remove)');
process.exit(0);

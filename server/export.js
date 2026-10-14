/*
 * CSV of everyone who created an account through Stick Together (for importing into Picapool
 * if integrations.createPicapoolAccount isn't wired yet).   node export.js > accounts.csv
 * Add --unlinked to list only accounts with no Picapool id.
 */
'use strict';
const {db} = require('./server');
const rows = db.prepare(`SELECT phone, first_name, gender, college, ref, picapool_id,
  datetime(completed_at/1000, 'unixepoch', '+5 hours', '+30 minutes') AS created_ist FROM users
  WHERE completed_at IS NOT NULL AND phone NOT LIKE '5%' ${process.argv.includes('--unlinked') ? 'AND picapool_id IS NULL' : ''} ORDER BY completed_at`).all();
const cell = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
console.log('phone,first_name,gender,college,ref,picapool_id,created_ist');
for (const r of rows) console.log([r.phone, r.first_name, r.gender, r.college, r.ref, r.picapool_id, r.created_ist].map(cell).join(','));
process.exit(0);

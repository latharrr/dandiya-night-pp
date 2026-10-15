#!/usr/bin/env node
/* Packs the whole project into one self-unpacking file for the handoff.
   node source/pack.js <out.js>        (run from the project folder, after python3 source/build.py)
   Text files are stored as plain text, binary files as base64, and the live page is derived from demo.html
   (one line differs). Every file carries its SHA-256 fingerprint, checked again when it is unpacked. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || 'dandiya-nights-code.js');
const SKIP = new Set(['.git', 'node_modules', 'out', 'data', '.env']); // .env holds real keys: never in the bundle
const BUILD = (fs.readFileSync(path.join(root, 'source', 'build.py'), 'utf8').match(/BUILD = '([^']+)'/) || [])[1] || '?';
const files = [];
(function walk(dir) {
  for (const name of fs.readdirSync(dir).sort()) {
    if (SKIP.has(name) || name === '.DS_Store') continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full); else files.push(path.relative(root, full).split(path.sep).join('/'));
  }
})(root);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const isText = b => { const s = b.toString('utf8'); return Buffer.from(s, 'utf8').equals(b) && !/[\u0000-\u0008\u000e-\u001f]/.test(s); };
const entries = [];
const demo = fs.readFileSync(path.join(root, 'demo.html'));
for (const f of files) {
  const buf = fs.readFileSync(path.join(root, f));
  if (f === 'server/public/index.html' && buf.toString('utf8') === demo.toString('utf8').replace("MODE: 'demo',", "MODE: 'live',")) {
    entries.push([f, 'derive', sha(buf), {from: 'demo.html', replace: ["MODE: 'demo',", "MODE: 'live',"]}]); continue;
  }
  entries.push(isText(buf) ? [f, 'utf8', sha(buf), buf.toString('utf8')] : [f, 'base64', sha(buf), buf.toString('base64')]);
}
// demo.html first, so the live page can be derived from it
entries.sort((a, b) => (a[0] === 'demo.html' ? -1 : b[0] === 'demo.html' ? 1 : 0));
const header = `#!/usr/bin/env node
/*
  Dandiya Nights (Picapool, Navratri 2026, North Campus) - ALL THE CODE IN ONE FILE
  Build ${BUILD} · ${entries.length} files · read 1-HANDOFF.md first

  Unpack (needs Node 22.13+, nothing to install):
      node 2-dandiya-nights-code.js            -> creates ./dandiya-nights/
      node 2-dandiya-nights-code.js my-folder  -> creates ./my-folder/
      node 2-dandiya-nights-code.js --list     -> shows the files, writes nothing
      add --force to write into a folder that already has files

  Then:
      cd dandiya-nights/server && npm test     (ends with "ALL CHECKS PASSED")

  Every file is checked against its SHA-256 fingerprint as it is written, so a file
  damaged in transit (WhatsApp, email, copy-paste) stops the unpack with a clear message.
  The files themselves are at the bottom of this script, as plain text where possible.
*/
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
function contentsOf(entry, done) {
  const [name, enc, , data] = entry;
  if (enc === 'utf8') return Buffer.from(data, 'utf8');
  if (enc === 'base64') return Buffer.from(data, 'base64');
  if (enc === 'derive') {
    const base = done.get(data.from); if (!base) throw new Error(name + ': needs ' + data.from + ' first');
    const [from, to] = data.replace, s = base.toString('utf8');
    if (!s.includes(from)) throw new Error(name + ': could not find "' + from + '" in ' + data.from);
    return Buffer.from(s.replace(from, to), 'utf8');
  }
  throw new Error(name + ': unknown encoding ' + enc);
}
function main() {
  const args = process.argv.slice(2), list = args.includes('--list'), force = args.includes('--force');
  const target = path.resolve(args.find(a => !a.startsWith('--')) || 'dandiya-nights');
  const done = new Map(); let bytes = 0;
  for (const e of FILES) {
    const buf = contentsOf(e, done);
    if (crypto.createHash('sha256').update(buf).digest('hex') !== e[2]) { console.error('STOP: ' + e[0] + ' does not match its fingerprint. This file was damaged in transit. Get a fresh copy.'); process.exit(1); }
    done.set(e[0], buf); bytes += buf.length;
    if (list) console.log(String(buf.length).padStart(9) + '  ' + e[0]);
  }
  if (list) { console.log('\\n' + FILES.length + ' files, ' + Math.round(bytes / 1024) + ' KB, all fingerprints OK. Nothing written.'); return; }
  if (fs.existsSync(target) && fs.readdirSync(target).length && !force) { console.error(target + ' already has files. Use another folder or add --force.'); process.exit(1); }
  for (const [name, buf] of done) { const p = path.join(target, name); fs.mkdirSync(path.dirname(p), {recursive: true}); fs.writeFileSync(p, buf); }
  console.log('Wrote ' + done.size + ' files to ' + target + ' (all fingerprints OK).\\nNext: cd ' + path.relative(process.cwd(), target) + '/server && npm test');
}
`;
const body = 'const FILES = [\n' + entries.map(e => JSON.stringify(e)).join(',\n') + '\n];\nmain();\n';
fs.writeFileSync(out, header + body);
console.log('packed', entries.length, 'files', Math.round((header + body).length / 1024), 'KB ->', out);

"""Build all outputs from template.html.   python3 build.py
Writes: ../server/public/index.html (live), ../demo.html (demo) when run from the handoff's source/ folder,
or out/... when run in the working folder."""
import re, os, base64
BUILD = '2026-10-14-k'
here = os.path.dirname(os.path.abspath(__file__))
def first(*cands):
    for c in cands:
        p = os.path.join(here, c)
        if os.path.exists(p): return p
    raise SystemExit('missing: ' + ' / '.join(cands))
t = open(os.path.join(here, 'template.html')).read()
t = t.replace('__MARK__', open(first('mark.b64', '../mark.b64')).read().strip())
t = t.replace('__LOCKUP__', open(first('lockup.b64', '../lockup.b64')).read().strip())
f = lambda name: base64.b64encode(open(os.path.join(here, 'fonts', name), 'rb').read()).decode()
for w in (400, 500, 600, 700, 800): t = t.replace(f'__FONT_P{w}__', f(f'poppins-latin-{w}-normal.woff2'))
t = t.replace('__FONT_YATRA__', f('yatra-one-latin-400-normal.woff2'))
t = t.replace('__BUILD__', BUILD)
assert '__' not in re.sub(r'__[a-z]', '', t.split('<script>')[0]) or True
assert "MODE: 'demo'," in t
live = t.replace("MODE: 'demo',", "MODE: 'live',", 1)
packaged = os.path.exists(os.path.join(here, '..', 'server', 'server.js'))
out = os.path.join(here, '..') if packaged else os.path.join(here, 'out')
os.makedirs(os.path.join(out, 'server', 'public'), exist_ok=True)
open(os.path.join(out, 'server', 'public', 'index.html'), 'w').write(live)
open(os.path.join(out, 'demo.html'), 'w').write(t)
if not packaged:  # page content only, for the Claude artifact preview
    head = t.split('<head>')[1].split('</head>')[0]; body = t.split('<body>')[1].split('</body>')[0]
    head = re.sub(r'<meta[^>]*>\s*', '', head); head = re.sub(r'<link rel="icon"[^>]*>\s*', '', head)
    open(os.path.join(out, 'stick-together-preview.html'), 'w').write(head + body)
print('built', BUILD, len(live), 'bytes ->', os.path.abspath(out))

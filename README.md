# Dandiya Nights · Picapool

Picapool's Navratri 2026 app for North Campus: see who's going to garba on your nights, pair up, and chat or swap numbers on Picapool.

- **Try it:** open `demo.html` in a browser (sample people, nothing is saved).
- **Run it:** `cd server && npm test && npm run dev` → http://localhost:8080 (login code `1234`). Node 22.13+, nothing to install.
- **Change the page:** edit `source/template.html`, then `python3 source/build.py` (writes `server/public/index.html` and `demo.html`).
- **Everything else** (connecting Picapool, deploying, settings, API, checklist): [`HANDOFF.md`](HANDOFF.md).
- **Handoff bundle:** `node source/pack.js 2-dandiya-nights-code.js` packs the whole project into one self-unpacking file.

Fonts: DM Serif Display and Figtree (SIL Open Font License). Sample photos: Unsplash licence, placeholders to replace before launch.

# Dandiya Nights · Picapool

Picapool's Navratri 2026 web app for Delhi University North Campus. People see who from North Campus is going to garba on their nights, pair up, and chat (on Picapool) or swap numbers. Guests can peek at tonight's top 5 before signing up. Garba Queen / Garba King boards, story posters for Instagram and WhatsApp, everything deleted on 20 Oct.

**Status (15 Oct 2026): product finished and tested. Waiting on Picapool's tech team to connect their systems and deploy.** Current build: `2026-10-15-v2.1` · 160 server checks passing.

---

## Quick start
```bash
open demo.html                       # the whole app in demo mode: sample people, nothing saved

cd server
npm test                             # 160 checks, ends with "ALL CHECKS PASSED"
npm run seed:test                    # optional: 20 fake girls + 20 fake guys
npm run dev                          # http://localhost:8080 · login code is always 1234
                                     # admin: http://localhost:8080/admin · key dev-admin
```
Node 22.13+ only. Nothing to install (built-in SQLite). Add `?new=1` to the page URL to start over in that browser.

**Change the page:** edit `source/template.html` → `python3 source/build.py` (writes `server/public/index.html` + `demo.html`).
**Make the handoff bundle:** `node source/pack.js 2-dandiya-nights-code.js` (one self-unpacking file, every file fingerprinted).
**Full technical guide:** [`HANDOFF.md`](HANDOFF.md) (connecting Picapool, deploy, settings, API, phone checklist, security).

---

## What's left (Picapool tech team, ~5–7 h)
| # | Needed | Why | Where |
|---|---|---|---|
| 1 | **WhatsApp login-code sender** | **Launch blocker.** Nobody can log in without it | `server/integrations.js` → `sendOtp` |
| 2 | Picapool account lookup + creation (Option A or B) | Know who has Picapool; create accounts (the main KPI) | `findPicapoolUser`, `createPicapoolAccount`, set `lookupWired: true` |
| 3 | Picapool chat | Pairs chat in the app with numbers private. Or set `CONFIG.CHAT_ENABLED = false` (numbers only) | `createChat` |
| 4 | Two WhatsApp alerts: new pair, message request | The app promises "We'll message you on WhatsApp" | `notifyMatch`, `notifyMessageRequest` |
| 5 | Picapool backend → `POST /api/integrations/picapool-user` | Sign-ups and name changes in the app reach this site instantly | HANDOFF §4b |
| 6 | Hosting on `dandiya.picapool.tech` | Needs a persistent disk (not Vercel/Netlify), HTTPS, **`NODE_ENV=production`**, long random `ADMIN_KEY` and `PICAPOOL_WEBHOOK_SECRET` | HANDOFF §3 |
| 7 | Real links + content | Store links, deep link, Terms, Privacy, real venue names, replace the Unsplash sample photos | page `CONFIG`, `server/samples.json` |
| 8 | Phone checklist | One Android (opened from WhatsApp) + one iPhone | HANDOFF §13 |

Ready-to-send message for the tech team is the table above; details per item are in HANDOFF §0.

## Open decisions / waiting on
- **Purav:** keep the "184 girls from North Campus are going" counts? (Build k's rule was "no counts".) Off = `SHOW_COUNTS=0`.
- **Deepanshu / team:** design changes for **screens 2, 3, 4** (mentioned in feedback round 1 but not received yet), and which screens those numbers refer to.
- **Krish:** cosmetic changes (coming).
- **"Leaderboard on the right-hand side"** (feedback round 1): the Board tab is live now; if this means a side panel on laptop screens, it's still to build.
- **Recommendation pending:** switch login codes from 4 to 6 digits (`OTP_LENGTH` on the server + `CONFIG.OTP_LENGTH` on the page).

---

## The product (v2.1)
**Look:** two surfaces only. A wine "night" for the welcome and sign-up, calm cream inside the app. DM Serif Display titles with an italic second line, Figtree text (both embedded, OFL). Picapool orange for the one big action on night screens. Modelled on the structure of playgarba.in, with Picapool's own brand, art and copy. Not a dating app: **pick / pair up / paired / pass**; no ages or distances on cards.

**Flow:** Welcome → name → gender (tap moves on) → **guest peek** (tonight's top 5 of the other side, clear photos, SAMPLE tag on samples, picks held) → WhatsApp number → code (fills itself) → Picapool check (only shown when found) → birthday (only "18+" is sent) → college (tap, saves the account) → nights + optional "Where, mostly?" → **reveal** ("26 girls are going on your nights") → app.
Above every sign-up card: blurred faces and a live count. No progress bar (by request).

**App tabs:** Discover · Pairs (Paired / Picked you / You picked) · Board · Profile ("Your pass").

**Features**
- Photo asked on arrival in Discover and again after the first swipe; up to 5; nobody sees a pass without a photo.
- "Add a line" prompt after 5 swipes. "Review skipped profiles" at the end of the deck (change your decision).
- Paired moment → Say hi on Picapool (with an optional **garba plan**: night, place, time, public meeting point) or swap numbers (only when both agree). All chat-request states from build k.
- **Live boards**: Garba Queen / Garba King, tonight / all Navratri, up to 20 a side (15+), refresh every 15 s with ▲▼ movement; only picked people get a rank or crown.
- **Story sharing**: "Share my Dandiya pass" and "Flaunt your crown" open a 1080×1920 story image → Share to Instagram story / WhatsApp status (or Save image).
- Report / block on every card and pair row; pause my pass; delete; 40 picks a day with a limit sheet; invite link with `?ref=` attribution.
- Admin page: numbers, nightly top-20 check, reports, hide/unhide, Picapool clashes.

**Security (v2.1 pass, HANDOFF §17):** dev shortcuts only with `NODE_ENV=development/test`; real client IP behind the proxy; per-session and per-network limits (codes 40/hour per network); 30-day sessions + real logout; constant-time secret checks; admin key by header only; `/api/stats` admin-only; photo type checked from file bytes, photos served sandboxed; contact details stripped from free text; same-origin API; CSP, no framing, HSTS in production; DB indexes; short connection timeouts.

---

## Repo map
| Path | What |
|---|---|
| `server/server.js` | Whole backend: API, page, photos, admin. Zero dependencies |
| `server/integrations.js` | **The only file Picapool's team edits** to connect their systems |
| `server/samples.json` | Sample people for the guest peek (placeholder Unsplash photos) |
| `server/public/index.html` · `admin.html` | Built page (live mode) · admin page |
| `server/test/api.test.js` | 160 checks, own temp server, never touches real data |
| `server/seed.js` · `export.js` · `Dockerfile` | Fake test profiles · CSV export · Docker |
| `source/template.html` | **The one source for the page** (CSS + JS, demo and live) |
| `source/build.py` · `pack.js` · `fonts/` · `*.b64` | Build · handoff packer · embedded fonts · logos |
| `demo.html` | Demo build (sample people, nothing saved) |
| `docs/design/v2-approved-prototype.html` | The clickable v2 design that was approved |
| `docs/history/` | Build k's page and earlier design notes |
| `HANDOFF.md` | Full technical handoff |

Outside the repo (on Deepanshu's Mac): `~/Desktop/Dandiya-Nights-Handoff/` (the 3-file handoff: `1-HANDOFF.md`, `2-dandiya-nights-code.js`, `3-demo.html`), `~/Desktop/Dandiya-Nights-Draft/` (design drafts), `~/Desktop/Stick-Together-Handoff/` (original build k, untouched).

## History
| Build | What changed |
|---|---|
| Stick Together a–k | Original Picapool Dandiya partner match (Purav): server, Picapool sync, board, chat on Picapool |
| v2 (14 Oct) | Renamed Dandiya Nights. New design and sign-up flow, photo after first swipe, clear-photo guest peek + samples + counts, report/block menus, pause, garba plan, daily limit sheet, contrast to WCAG AA |
| v2.1 (15 Oct) | Team feedback round 1: code-screen scroll fix, story sharing restored, live 15+ boards, photo prompt, line prompt, review skipped profiles, Indian sample people. Then a security and performance pass |

## Working on this repo
After any change: `python3 source/build.py` → `cd server && npm test` → commit → push. Repack the handoff with `node source/pack.js` if the team needs a fresh bundle. Sample photos are Unsplash (free licence) placeholders; fonts are SIL OFL.

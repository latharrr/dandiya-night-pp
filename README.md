# Dandiya Nights · Picapool

Picapool's Navratri 2026 web app for Delhi University North Campus. **Find your Dandiya partner:** people say which garba events they're going to (and which day, what time), see who else is going, pair up and swap numbers. Guests can peek at tonight's top 5 before signing up. Garba Queen / Garba King boards, story posters for Instagram and WhatsApp, everything deleted on 20 Oct.

**Status (16 Oct 2026): LIVE at [dandiya.picapool.tech](https://dandiya.picapool.tech) since the evening of 15 Oct.** Login codes over WhatsApp + SMS, pair alerts, Garba Queen / King boards and story sharing all live. Real launch figures at the bottom of this file. Current build: `2026-10-15-v3` · 194 server checks passing + a real-browser run of the whole flow (phone touch swipes, laptop, demo).

---

## Quick start
```bash
open demo.html                       # the whole app in demo mode: sample people, nothing saved

cd server
npm test                             # 194 checks, ends with "ALL CHECKS PASSED"
npm run seed:test                    # optional: 20 fake girls + 20 fake guys
npm run dev                          # http://localhost:8080 · login code is always 1234
                                     # admin: http://localhost:8080/admin · key dev-admin
```
Node 22.13+ only. Nothing to install (built-in SQLite). Add `?new=1` to the page URL to start over in that browser.

**Change the page:** edit `source/template.html` → `python3 source/build.py` (writes `server/public/index.html` + `demo.html`).
**Make the handoff bundle:** `node source/pack.js 2-dandiya-nights-code.js` (one self-unpacking file, every file fingerprinted).
**Full technical guide:** [`HANDOFF.md`](HANDOFF.md) (connecting Picapool, deploy, settings, API, phone checklist, security).

---

## What's left (~1–2 h, details in HANDOFF §0)
| # | Needed | Where |
|---|---|---|
| 1 | **Env vars for login codes and alerts:** `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_OTP_TEMPLATE` (+`_LANG`), `WHATSAPP_MATCH_TEMPLATE` (+`_LANG`, `_VARS`), `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`. Check `/api/health` → `"otp":["whatsapp","sms"]` | HANDOFF §3b |
| 2 | **Deploy on our server** (persistent disk, not Vercel functions): `NODE_ENV=production`, long random `ADMIN_KEY`, `TRUST_PROXY=1`, `DATA_DIR`; DNS `dandiya.picapool.tech` → server; HTTPS | HANDOFF §3 |
| 3 | Replace the Unsplash sample photos (or `SAMPLE_PROFILES=0`) | `server/samples.json` |
| 4 | Phone checklist (Android from WhatsApp + iPhone) | HANDOFF §13 |
| Later | Picapool backend: account lookup/creation, push, in-app chat. Until then pairs swap numbers and signups are exported from `/admin` (CSV) | HANDOFF §4 |

## Open decisions / waiting on
- **Purav:** keep the "184 girls from North Campus are going" counts? Off = `SHOW_COUNTS=0`.
- **Krish:** cosmetic changes (not received yet).

---

## The product (v3)
**Look:** two surfaces only. A wine "night" for the welcome and sign-up, calm cream inside the app. DM Serif Display titles with an italic second line, Figtree text (both embedded, OFL). Picapool orange for the one big action on night screens. Modelled on the structure of playgarba.in, with Picapool's own brand, art and copy. Not a dating app: **pick / pair up / paired / pass**; no ages or distances on cards.

**Flow:** Welcome ("Find your Dandiya partner.") → name → gender (tap moves on) → **guest peek** (tonight's top 5 of the other side, clear photos, SAMPLE tag on samples, picks held) → WhatsApp number → code (WhatsApp, "Send by SMS instead" after 30 s; fills itself) → birthday (only "18+" is sent) → college (tap, saves the account) → **Where are you going for garba?** (pick or type events, multiple; day(s) + time for each) → **reveal** ("26 girls are going to garba this Navratri") → app.
Above every sign-up card: blurred faces and a live count. No progress bar (by request).

**App tabs:** Discover · Pairs (Paired / Picked you / You picked) · Board · Profile ("Your pass").

**Features**
- Photo asked on arrival in Discover and again after the first swipe; up to 5; nobody sees a pass without a photo.
- "Add a line" prompt after 5 swipes. "Review skipped profiles" at the end of the deck (change your decision).
- **Matching by event and day**: the feed shows everyone, people going to the same event on the same day first; shared events are highlighted on cards and pairs ("Both going to Hansraj Garba, Sat 17"). Events 2+ people chose are suggested to everyone.
- Paired moment → **swap numbers** (only when both agree) + a WhatsApp "new pair" alert to the other person. Chat on Picapool (with a garba plan) is built and comes back with `CHAT_ENABLED` once Picapool's chat is connected.
- Swiping: touch, mouse and ← / →; flicks count; each card commits once; a failed save puts the card back.
- Laptops: tonight's Garba Queen / King beside the app.
- **Live boards**: Garba Queen / Garba King, tonight / all Navratri, up to 20 a side (15+), refresh every 15 s with ▲▼ movement; only picked people get a rank or crown.
- **Story sharing**: "Share my Dandiya pass" and "Flaunt your crown" open a 1080×1920 story image → Share to Instagram story / WhatsApp status (or Save image).
- Report / block on every card and pair row; pause my pass; delete; 40 picks a day with a limit sheet; invite link with `?ref=` attribution.
- Admin page: numbers, nightly top-20 check, reports, hide/unhide, Picapool clashes, **signups CSV** for Picapool, popular events.

**Security (v2.1 pass, HANDOFF §17):** dev shortcuts only with `NODE_ENV=development/test`; real client IP behind the proxy; per-session and per-network limits (codes 40/hour per network); 30-day sessions + real logout; constant-time secret checks; admin key by header only; `/api/stats` admin-only; photo type checked from file bytes, photos served sandboxed; contact details stripped from free text; same-origin API; CSP, no framing, HSTS in production; DB indexes; short connection timeouts.

---

## Repo map
| Path | What |
|---|---|
| `server/server.js` | Whole backend: API, page, photos, admin. Zero dependencies |
| `server/integrations.js` | Login codes (WhatsApp + MSG91) and pair alerts, set by env vars; Picapool stubs for later |
| `server/samples.json` | Sample people for the guest peek (placeholder Unsplash photos) |
| `server/public/index.html` · `admin.html` | Built page (live mode) · admin page |
| `server/test/api.test.js` | 194 checks, own temp server, never touches real data (WhatsApp/MSG91 checked against a fake server) |
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
| v3 (15 Oct) | Launch build: "Find your Dandiya partner." landing (no icon rows, outline heart), swipe fix, events (multiple, typed, day + time) replace nights, one-photo-at-a-time uploads, WhatsApp + MSG91 codes and pair alerts, chat/Picapool check off until the backend is connected, real links, laptop side board, signups CSV |

## Working on this repo
After any change: `python3 source/build.py` → `cd server && npm test` → commit → push. Repack the handoff with `node source/pack.js` if the team needs a fresh bundle. Sample photos are Unsplash (free licence) placeholders; fonts are SIL OFL.

## 2026-10-16 - v5 ops batch

### Admin panel (/<ADMIN_PREFIX>/people)
- WhatsApp ops: master toggle, per-user mute, no-photo nudge (free-form inside a 24h window, else queued for the dandiya_photo_nudge template), broadcast, WA log tab
- Analysis tab: avg opens/logins/views per user, per-user table, click-to-expand exact-IST timeline
- Referral links registry with read-only analytics (server/admin3.js)
- Every rendered photo opens full size (global click handler); the person drawer now shows real clickable thumbnails instead of a count

### User app
- Board photos: tap opens a full-screen lightbox (prev/next + counter for multi-photo cards); swipe gestures untouched (tap only fires on a no-move pointerup)

### WhatsApp webhook (live site only)
- GET /api/wa-webhook: Meta verification handshake via WHATSAPP_VERIFY_TOKEN
- POST /api/wa-webhook: inbound messages update users.last_wa_inbound (24h customer-service-window tracking); message status callbacks log to wa_log
- X-Hub-Signature-256 enforced when WHATSAPP_APP_SECRET is set in .env (permissive until it is)

### Clone setup (lpu.picapool.tech)
- /opt/lpu-nights mirrors the same server/ tree; its own .env (PORT 8096, DATA_DIR /var/lib/lpu-nights, APP_URL https://lpu.picapool.tech, clone ADMIN_KEY) stays out of git
- pm2 app: lpu-nights; DB + photos under /var/lib/lpu-nights
- Every code change ships to BOTH /opt/dandiya-nights and /opt/lpu-nights, then pm2 restart both

---

## 2026-10-16 - Launch results (live, real figures)

Pulled from the production DB and WhatsApp status callbacks at ~5 PM IST on 16 Oct, about 23 hours after go-live. Nothing projected, nothing rounded up.

**People**
- 463 accounts created, 452 finished sign-up
- 392 Dandiya passes made, 211 of them with photos (646 photos uploaded)

**Swiping and pairing**
- 12,123 swipes: 3,809 picks, 8,314 passes
- 152 pairs formed
- 42 pairs swapped numbers (both sides agreed)

**Sharing and rewards**
- 30 people earned the share bonus (55 bonus swipes given out)
- 5 people claimed the +10 swipes Picapool popup

**WhatsApp (real sends)**
- 358 login codes sent over WhatsApp/SMS
- Photo-nudge campaign: 238 people messaged -> 67 read, 119 delivered, 46 failed (39 hit Meta's per-person marketing frequency cap, 5 in Meta's experiment group, 1 not on WhatsApp, 1 undeliverable), 6 with no final status yet. The 39 capped sends were retried and accepted; final delivery pending.
- 7 Garba Queen/King Top-3 alerts, 2 profile notices, 84 pair alerts and other template notifications

**Engagement**
- In-app photo prompt shown 748 times, completed 528 times
- 31 feedback notes sent in from users

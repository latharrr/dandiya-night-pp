# Dandiya Nights: Tech Handoff
Picapool's Navratri app for North Campus. **Find your Dandiya partner:** people say which garba events they're going to (and when), see who else is going, pair up and swap numbers. Guests can peek at tonight's top 5 before signing up; the picks they make there are sent once they make their pass.

Build `2026-10-15-v3` · 15 Oct 2026 (v3: launch build, team feedback round 2) · Built on Stick Together build k (same server, same Picapool sync), with the approved v2 design.

## What you've got (3 files)
| File | What it is |
|---|---|
| `1-HANDOFF.md` | This document. Read §0 first |
| `2-dandiya-nights-code.js` | **All the code in one file.** `node 2-dandiya-nights-code.js` creates a `dandiya-nights/` folder: server, page, admin page, tests, design source, fonts, the approved v2 prototype and older notes. Every file is checked against its SHA-256 fingerprint as it is written. `--list` shows what's inside without writing anything |
| `3-demo.html` | The page in demo mode (sample people, nothing saved). Open it on a phone to see every screen. Never use it as the public link |

```bash
node 2-dandiya-nights-code.js          # → ./dandiya-nights/
cd dandiya-nights/server && npm test   # 194 checks, ends with "ALL CHECKS PASSED"
```

## 0. What's left before the public link
The product is finished and tested (194 server checks, plus a real-browser run of the whole flow on a phone and a laptop). Login codes, pair alerts and photos work with nothing but env vars. What's left:

| # | Task | Where | Time |
|---|---|---|---|
| 1 | **Put the WhatsApp + MSG91 values in the server's env** (token, Phone Number ID, template names, MSG91 key + template id). Check `GET /api/health` shows `"otp":["whatsapp","sms"]` | §3b | 10 min |
| 2 | **Deploy on our server** with a persistent disk: `NODE_ENV=production`, long random `ADMIN_KEY`, `TRUST_PROXY=1`, `DATA_DIR`. DNS: `dandiya.picapool.tech` → the server (an A/CNAME record in the Vercel DNS for picapool.tech). HTTPS + `client_max_body_size 3m` in nginx | §3 | 30 min |
| 3 | **Replace the sample photos** in `server/samples.json` (Unsplash placeholders), or `SAMPLE_PROFILES=0` | `server/samples.json` | 30 min |
| 4 | **Purav: counts** ("184 guys from North Campus are going"). On by default; `SHOW_COUNTS=0` hides the number | env var | 1 min |
| 5 | Run the phone checklist on one Android (opened from WhatsApp) and one iPhone | §13 | 30 min |
| 6 | Every night: `/admin` → Top 20 check before posting the boards; **Download signups (CSV)** for Picapool | §10 | 10 min |

**Later, with Picapool's backend** (the site works fully without these; nothing on the page depends on them):
account lookup (`findPicapoolUser` + `lookupWired: true` + `CONFIG.PICAPOOL_LOOKUP = true`), account creation (`createPicapoolAccount`), the push to `/api/integrations/picapool-user`, and in-app chat (`createChat` + `CONFIG.CHAT_ENABLED = true`). Until then: pairs swap numbers, and signups go to Picapool via the CSV.

## 0a. What changed in v3 (15 Oct, launch build)
**Events replace nights.** "Which nights are you going?" is gone. The pass screen is now **"Where are you going for garba?"**: people pick every event they're going to (multiple choice) or type their own, then for each one the **day(s)** and **time** they're getting there. Events that 2+ people chose are suggested to everyone (one-off or misspelt names never are). Up to 5 events. Cards, the profile, pairs ("Both going to Hansraj Garba, Sat 17"), the paired screen, sharing and the story image all use events. Guests only see the days people are going, never where.
**Matching.** The feed shows everyone now (no "My nights / All nights"): people going to the same event on the same day first, then the same event or the same day, then everyone else. Event names match loosely (case, spaces, punctuation).
**Landing page.** Headline **"Find your *Dandiya partner.*"** as the main thing on the page; the three icon rows are gone; the arched-window dandiya illustration is replaced by a light outline heart. The dandiya-sticks icon (pair-up button, Pairs tab, paired screen) is an outline heart too.
**Swiping fixed.** The card no longer lets the browser take over a slightly diagonal swipe (that snapped cards back on phones); a quick flick counts; the next card is drawn the moment one leaves, so fast swipes and taps never hit a card on its way out; each card commits exactly once; if saving fails, the card comes back instead of being lost. ← / → and mouse drag on laptops.
**Photos.** Each photo uploads on its own the moment it's picked (`POST /api/photos`), so requests stay small (under a proxy's 1 MB default) and nothing is lost if the connection drops halfway through five. Unused uploads are cleaned up after an hour. The server refuses to start on serverless hosts or a read-only `DATA_DIR`, where photos would vanish.
**Login codes, ready to switch on.** WhatsApp (Meta Cloud API, Authentication template with a copy-code button) first, **MSG91 SMS** as the fallback; if WhatsApp fails the code goes by SMS automatically, and the code screen offers **"Send by SMS instead"** after 30 s. The screen says how it was sent. **New-pair WhatsApp alert** to the other person. All by env vars (§3b).
**Chat and the Picapool check are off** until Picapool's backend is connected (`CHAT_ENABLED`, `PICAPOOL_LOOKUP` in the page): pairs swap numbers, and nobody sees "Checking for a Picapool account".
**Links filled in:** Play Store (`com.picapool`), App Store (`id6480370782`), Terms and Privacy on picapool.com. The 18+ and "wrap" pages link to the right store for the phone.
**Laptops:** tonight's Garba Queen and Garba King (top 5 each, live) sit to the right of the app.
**Admin:** **Download signups (CSV)** (number, name, gender, college, invite link, events) and "Events people are going to".

## 0b. What changed from build k (v2)
**Design.** Two surfaces only: a wine "night" for the welcome and sign-up, calm cream inside the app. Titles in DM Serif Display with an italic second line ("Which nights / *are you going?*"), text in Figtree, both embedded (no font server). Picapool orange is the one big action on night screens; wine is the action colour inside the app. No day/night toggle any more.

**Sign-up: one question per card, with a live crowd on top.** Name → gender (Girl/Guy, tap moves on) → guest peek → WhatsApp number → code (fills itself, no Verify button) → Picapool check (shown only when an account is found) → birthday (three boxes, shows the age, only "18 or older" is sent) → college (tap a row, moves on; this saves the account) → nights + optional "Where, mostly?" → **reveal** ("26 girls are going on your nights") → app.

**The photo comes after the first swipe** (as Play Garba does). A pass can exist without a photo; until it has one, nobody can see it: it's out of every feed, the guest peek, the board, "Picked you" and "You picked". Discover shows "Add a photo so people can see your pass" until there is one.

**Guest peek shows clear photos** (handoff §0b of build k, done) **and sample people when there aren't 5 real ones** (done): real people first, then samples from `server/samples.json`, each with a SAMPLE tag. Picks on samples go nowhere; samples never appear in the feed, board, pairs, admin or counts. `SAMPLE_PROFILES=0` turns them off.

**New in the app**
- **Report or block** from every card (⋯) and every pair row. The sheet says "If you're in danger, call 112 first".
- **Pause my pass** on the profile: out of everyone's feed, the guest peek and the board; pairs and chats stay. `POST /api/profile/pause`.
- **Add a garba plan** inside "Say hi": a night you share, a place (from `CONFIG.VENUES`), a time (`CONFIG.PLAN_TIMES`) and a public meeting point ("At the main entrance"). It's added to the first message as one line: "Plan: Thu 15 Oct, College garba, 8:00 pm. Meet at the main entrance." No server change.
- **Daily limit sheet** when today's 40 picks are used ("More at midnight", "See who picked you"); the action bar says "more picks at midnight".
- **Look at people you skipped** at the end of the deck (build k's "Review passed profiles", renamed).
- **Log in for returning people** goes code → straight to Discover.
- Words: like → **pick / pair up**, match → **paired**, Matches → **Pairs** (Paired · Picked you · You picked), card → **pass**, Me → **Profile**.

**v2.1 (team feedback, 15 Oct)**
- **Code and birthday boxes can never be wider than the screen** (fixes the sideways scrolling on the code screen in Safari). Code check verified end to end: wrong code → "That code isn't right…" and the boxes clear; resend is held for 30 s; a pasted or auto-filled code checks itself.
- **Story sharing everywhere a pass or crown is shared** (Profile → Share my Dandiya pass, Profile ⤴, Flaunt your crown on Discover, Board and Profile, and "Post my pass to my story" in the invite sheet). A 1080×1920 story image opens first, with **Share to Instagram story** and **Share to WhatsApp status** (the phone's share sheet; the invite link is copied for the Instagram Link sticker). Where a browser can't share files: **Save image**, or long-press. No photo yet → "Add a photo for your story" → photos → straight back to the story.
- **Live boards with at least 15 a side:** each board shows up to 20 people. After everyone who was picked come the rest of the race (most-picked this Navratri, then earliest pass), so it's full from day one. Only people who were actually picked get a rank or a crown. An open board refreshes every 15 s and shows ▲ / ▼ / new next to names that moved; the server recomputes every 15 s (`LB_REFRESH_MS`).
- **Photo upload is asked for, not just offered:** the photo sheet opens on the first arrival in Discover, and once more after the first swipe if they tapped Later; the "Add a photo" bar stays until there is one. The sheet shows "3 of 5 photos" and stops at 5 ("That's the most you can add"; extra picks are left out with a note).
- **"Add a line" after 5 swipes** now shows for everyone without a line (it used to wait for a photo).
- **Review skipped profiles:** at the end of the deck, a main button "Review skipped profiles" (when there are any). Picking someone there changes the decision; the rest stay skipped. A "Reviewing skipped profiles · Done" bar shows while reviewing.
- Demo and samples now use 15 young Indian adults a side (Unsplash licence); replace before launch (§0 step 10).

**v2.1 security and performance pass (15 Oct)** (details in §17)
- Dev shortcuts (fixed login code `1234`, admin key `dev-admin`) only work with `NODE_ENV=development`/`test`. A server started without `NODE_ENV` is production-safe. **Always start production with `NODE_ENV=production`** (`npm start` does).
- Rate limits use the real client IP behind the proxy (a forged `X-Forwarded-For` can't dodge them), count signed-in people per session (a hostel on one Wi-Fi no longer shares one limit), and cap login codes per network per hour (stops bulk sending, which costs money).
- Logins last 30 days; Log out ends the session on the server. Constant-time checks for the admin key, webhook secret and codes. Admin key by header only.
- Photo type detected from the file itself (fake WebP refused, the stored type follows the real bytes); photos served sandboxed. No phone numbers in "Where".
- Same-origin API by default (no `CORS *`), browser security headers (CSP, no framing, HSTS in production), `/api/stats` admin-only, database indexes for polling, shorter connection timeouts.

**Server**: photo-optional passes, `VISIBLE` rule (not hidden, has a photo, not paused) on every list, clear photo + `count` + samples in `/api/preview`, `/api/profile/pause`, admin counts for passes without a photo and paused passes. 24 new checks (137 in total).

## 1. Folder (after unpacking)
| Path | What it is |
|---|---|
| `server/server.js` | The whole backend: API, page hosting, photos, admin. Node 22.13+, **no npm install** (built-in SQLite) |
| `server/integrations.js` | Login codes (WhatsApp + MSG91), the new-pair WhatsApp alert (both set by env vars, §3b), and the Picapool stubs to fill in later (§4) |
| `server/samples.json` | Sample people for the guest peek (replace the photos, §0 step 10) |
| `server/public/index.html` | The page, already in live mode. Mobile-first, full screen on phones, a centred column on laptops |
| `server/public/admin.html` | `/admin`: numbers, nightly top-20 check, reports, Picapool clashes, hide/unhide |
| `server/test/api.test.js` | `npm test`. Own server on a temp folder, 194 checks (including the WhatsApp and MSG91 messages against a fake server). Never touches real data |
| `server/seed.js` · `export.js` · `Dockerfile` | Fake test profiles (`npm run seed:test` / `seed:remove`) · CSV of accounts (`npm run export`) · Docker |
| `demo.html` | Same as `3-demo.html` |
| `source/` | `template.html` (the one source for the page), `build.py`, logo files, `fonts/` (DM Serif Display + Figtree, SIL Open Font License). After a change: `python3 source/build.py` rewrites `server/public/index.html` and `demo.html` |
| `docs/design/v2-approved-prototype.html` | The clickable v2 design that was approved. Reference only |
| `docs/history/` | Build k's page (`template-build-k.html`) and earlier design notes. Background only; **this handoff wins** |

## 2. Run locally
```bash
cd server
npm test                 # 194 checks
npm run seed:test        # 20 fake girls + 20 fake guys (phones start with 5)
npm run dev              # http://localhost:8080 · login code is always 1234 · codes print in the log
```
Use two browsers (or normal + incognito), a girl and a guy, and pick each other to see a pair. Admin: `http://localhost:8080/admin`, key `dev-admin`. Add `?new=1` to the page URL to start over on that browser.

## 3. Deploy
One Node process serves everything: page `/`, API `/api/*`, photos `/photos/*`, admin `/admin`.
**Needs a persistent disk** (SQLite + photos in `DATA_DIR`). Vercel/Netlify functions won't work (the server refuses to start there); use a VPS, the Picapool server, Render/Railway with a volume, or Docker with a volume on `/data`. The DNS for picapool.tech can stay on Vercel: just point `dandiya` at this server.
```bash
NODE_ENV=production ADMIN_KEY=<long-random> PICAPOOL_WEBHOOK_SECRET=<long-random> DATA_DIR=/var/lib/dandiya-nights PORT=8080 TRUST_PROXY=1 node server.js
# keep it running: pm2 start server.js --name dandiya-nights   (or systemd, or Docker)
# or keep the settings in a file: cp .env.example .env, fill it in, npm run start:env
```
HTTPS on `dandiya.picapool.tech` via nginx or Caddy. nginx:
```nginx
server {
  server_name dandiya.picapool.tech;
  client_max_body_size 3m;            # one photo per request (~0.3 MB); nginx's default 1 MB is enough, this leaves room
  location / { proxy_pass http://127.0.0.1:8080; proxy_set_header Host $host; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }
}
```
**One instance only** (SQLite is single-writer); plenty for North Campus. Floater links work as `dandiya.picapool.tech/shraddha` or `?ref=shraddha`; both are saved as the signup's `ref`.

| Env var | Default | Notes |
|---|---|---|
| `NODE_ENV` | — | **`production` on the server** (refuses to start without `ADMIN_KEY`, never fakes codes, sends HSTS). `development` locally (`npm run dev`). Unset = production-safe defaults plus a warning |
| `ADMIN_KEY` | `dev-admin` only in development/test | **Required in production.** Long random value. Protects `/admin` and `/api/stats`; sent as the `X-Admin-Key` header only |
| `PICAPOOL_WEBHOOK_SECRET` | empty (push disabled) | Shared secret for Picapool's backend → `X-Picapool-Secret` header (§4b) |
| `DATA_DIR` | `./data` | Database and photos. Back it up |
| `PORT` | `8080` | |
| `TRUST_PROXY` | off | `1` behind nginx so rate limits use the real IP |
| `DEEPLINK` | `picapool://chat/{chatId}` | Opens a chat in the app |
| `DAILY_RIGHT_CAP` | `40` | Picks per IST day. Keep equal to `CONFIG.DAILY_RIGHT_CAP` |
| `OTP_LENGTH` | `4` | Keep equal to `CONFIG.OTP_LENGTH` |
| `DELETE_ON` | `2026-10-20` | Date (IST) all Dandiya data is deleted |
| `REPORT_HIDE` | `3` | Reports that hide a pass until an admin reviews it |
| `LB_REFRESH_MS` | `15000` | How often the board (and the guest top 5) is recomputed. The page refreshes an open board every 15 s |
| `SAMPLE_PROFILES` | on | **New.** `0` = never fill the guest peek with sample people |
| `SHOW_COUNTS` | on | **New.** `0` = never send "how many are going" counts (§0 step 11) |
| `COUNT_MIN` | `20` | **New.** Below this many people the count isn't sent; the page shows the line without a number |
| `PUBLIC_URL`, `CORS_ORIGIN` | empty, empty | Only if the page and the API are on different domains. Empty `CORS_ORIGIN` = same-origin only |
| `SESSION_DAYS` | `30` | How long a login lasts |
| `OTP_PER_IP_HOUR`, `VERIFY_PER_IP_HOUR` | `40`, `120` | Codes requested / tried per network per hour. Raise if a whole hostel signs up at once from one Wi-Fi |
| `DEV_OTP` | — | Fixed login code for local testing. Only works with `NODE_ENV=development` or `test` |
| `PREVIEW_CACHE_MS` | `120000` | How often the guest peek is recomputed |

### 3b. Login codes and WhatsApp alerts (env vars, no code changes)
| Env var | Example | What it is |
|---|---|---|
| `WHATSAPP_TOKEN` | `EAAG…` | Permanent access token of a system user with `whatsapp_business_messaging`, assigned to the WABA |
| `WHATSAPP_PHONE_NUMBER_ID` | `1234567890` | WhatsApp Manager → API Setup → **Phone Number ID** (not the number itself) |
| `WHATSAPP_OTP_TEMPLATE` | `dandiya_login_code` | Approved **Authentication** template. The code fills `{{1}}` and the copy-code button |
| `WHATSAPP_OTP_LANG` | `en` | The template's language code exactly as approved (`en`, `en_US`, `hi`…) |
| `WHATSAPP_OTP_BUTTON` | `1` | `0` only if the template has no copy-code / one-tap button |
| `WHATSAPP_MATCH_TEMPLATE` | `dandiya_new_pair` | Approved **Utility** template for "you have a new pair". Off when empty |
| `WHATSAPP_MATCH_LANG` | `en` | Its language code |
| `WHATSAPP_MATCH_VARS` | `me,name` | What fills `{{1}}`, `{{2}}`… in order. `me` = the person getting the message, `name` = their new pair, `college` = the pair's college, `link` = `APP_URL`. Example body: "Hi {{1}}, {{2}} picked you back on Dandiya Nights 💃 Open it to swap numbers." → `me,name` |
| `WHATSAPP_MATCH_BUTTON_VAR` | `link` | Only if the template has a URL button with a variable |
| `WHATSAPP_API_VERSION` | `v23.0` | Graph API version |
| `MSG91_AUTH_KEY` | | MSG91 → API → Auth key |
| `MSG91_TEMPLATE_ID` | `6612…` | **MSG91's** template id (not the DLT id) of the template linked to the approved DLT template. The code is `##OTP##` |
| `MSG91_MODE` | `otp` | `otp` if the template is under MSG91 → OTP; `flow` if it's under SMS → Templates |
| `MSG91_OTP_VAR` | `OTP` | Flow mode only: the variable name the template uses for the code |
| `OTP_CHANNELS` | `whatsapp,sms` | Order to try. A channel is used only when its env vars are set. `sms,whatsapp` = SMS first |
| `APP_URL` | `https://dandiya.picapool.tech` | Used for `link` in WhatsApp templates |
The WhatsApp **app secret** isn't needed (it only verifies incoming webhooks, and this server receives none). Check after deploy: `curl https://dandiya.picapool.tech/api/health` → `"otp":["whatsapp","sms"]`. A failed send is logged as `[otp] whatsapp failed for +91 98xxxxxx10: <Meta's error>` and the next channel is tried. For MSG91, the template text must match the DLT text character for character, or operators drop the SMS while the API still says "success".

## 4. Connect Picapool (`server/integrations.js`)
| Function / flag | Called when | If you don't wire it |
|---|---|---|
| `sendOtp(phone, code, prefer)` | Someone asks for a login code | **Done.** WhatsApp, then MSG91 SMS (§3b). With neither set, production refuses to send (dev prints the code) |
| `lookupWired` (flag) + `findPicapoolUser(phone)` → `{picapoolId, firstName?, gender?, college?}` or null | After the code, on "I've signed up", when the page comes back into view, every 5 min while linked | The page skips the "We found your Picapool account" card and carries on. It never claims "no account" unless the lookup really ran |
| `createPicapoolAccount({phone, firstName, gender, college, ref})` → id | Someone picks their college (that saves the account) | No account is made. Run `npm run export -- --unlinked > new.csv` nightly. **This is the main KPI** |
| `createChat(from, to, opener)` → chatId | Both have Picapool and one sends the first message (with the plan line, if they added one), or someone joins Picapool with a message request waiting | Not reachable at launch: `CONFIG.CHAT_ENABLED = false` (pairs swap numbers). Wire it, then set it to `true` |
| `notifyMessageRequest(to, from)` | Someone sends `to` a first message but `to` isn't on Picapool yet | Only with chat on. Wire it (a WhatsApp template) before turning chat on |
| `notifyMatch(to, other)` | A new pair | **Done.** WhatsApp template from `WHATSAPP_MATCH_TEMPLATE` (§3b). Without it, they see the pair next time the page is open (checked every 45 s) |

## 4b. How Dandiya Nights and the Picapool app stay in sync
Unchanged from build k. **The phone number is the join key.** The same 10-digit number on the web and in the app is the same person. `users.picapool_id` is set once they're linked.

**Who owns what**
| Field | Source of truth once linked | Why |
|---|---|---|
| First name | **Picapool** (first word of the app name) | Chats happen in the app; both sides must show the same name |
| Gender | **Picapool**, *before* the pass exists. After that it is never changed automatically (see clash rules) | Feed, picks, pairs and the board all depend on it |
| College | **Dandiya Nights** (Picapool's college only fills an empty one) | Event-specific choice, made on the college screen |
| Photos, events (name, days, time), line, race, pause, picks, pairs | **Dandiya Nights** | Event data, deleted on 20 Oct |
| Date of birth | Never stored anywhere here; only `adult: true` | Privacy |

**When linking happens**
| Moment | How | Speed |
|---|---|---|
| They already had Picapool | `findPicapoolUser` right after the code; the page shows "Hi Simran. We found your Picapool account." and uses its name and gender | Instant |
| They create a Picapool account while the page is open in another tab | The page re-checks when it comes back into view | Instant on return |
| They create it with the page closed, or edit their name/gender in the app | **Picapool's backend pushes** `POST /api/integrations/picapool-user` | Real time |
| Safety net | The page re-checks every 5 min while linked, and on "I've signed up" | ≤ 5 min |

**The push from Picapool's backend.** Call it on: account created, name or gender edited, account deleted or banned.
```
POST https://dandiya.picapool.tech/api/integrations/picapool-user
X-Picapool-Secret: <PICAPOOL_WEBHOOK_SECRET>
{"phone": "9876543210", "picapoolId": "pp_123", "firstName": "Simran Kaur", "gender": "female", "college": "Miranda House"}
{"phone": "9876543210", "deleted": true}      // deleted or banned
```
→ `{ok, linked, nameChanged?, conflict?}`. Unknown phone → `{linked: false}` (they'll be linked when they first log in). Phone may include +91 or spaces.

**The moment someone joins Picapool, every message request waiting for them becomes a real chat** (with the sender's message in it, via `createChat`).

**Option A or B: decide before launch**
- **Option A: create a Picapool account for everyone** (wire `createPicapoolAccount`). Everyone is linked as soon as they pick their college. "One small step before you chat" never shows and chats always open. Simplest for users and best for the KPI.
- **Option B: people create their own Picapool account** (leave `createPicapoolAccount` returning null). Chat asks them to get the app first. Wire `findPicapoolUser` and the push, or nobody can link.

**Edge cases.** All of build k's edge cases still apply and are still covered by tests: name/gender clashes before and after the pass, full names with emoji, deleted/banned accounts, different phone numbers, slow lookups, two devices, under-18 per Picapool (not handled: Picapool's date of birth isn't read; add the check in `linkPicapool()` if Picapool stores it), failed chat creation, blocked pairs, opening a chat twice. v2 adds:
| Situation | What happens |
|---|---|
| Linked to Picapool before the gender screen | The gender buttons are fixed to Picapool's gender: "From your Picapool account. Change it in the Picapool app." |
| Picapool's gender differs from what they picked as a guest | Found at the Picapool check after the code; picks held for the other side are dropped, Picapool's gender is used |
| Pass without a photo | Exists, nobody sees it. Their picks are saved, but they only show up in the other person's "Picked you" once they add a photo |
| Paused pass | Hidden from feeds, guest peek, board, "Picked you" and "You picked". Existing pairs and chats keep working |
| A guest picked a sample person | That pick is dropped silently when the pass is made; samples are never sent to the server |

## 5. Page settings (`CONFIG` at the top of the script in `server/public/index.html`; source: `source/template.html`)
| Key | Set to |
|---|---|
| `PLAY_STORE`, `APP_STORE` | Set: `com.picapool` and `id6480370782` |
| `TERMS_URL`, `PRIVACY_URL` | Set: picapool.com/terms-and-conditions/ and /privacy-policy/ (shown next to "Agree and see who's going") |
| `CHAT_ENABLED` | `false` at launch (pairs swap numbers). `true` once `createChat` is wired |
| `PICAPOOL_LOOKUP` | `false` at launch (no "Checking for a Picapool account"). `true` once `findPicapoolUser` is wired and `lookupWired: true` |
| `APP_DEEPLINK` | Only used with chat on. Same pattern as the `DEEPLINK` env var |
| `EVENT_SUGGESTIONS` | Optional starter event names shown on the events screen before people add their own (empty: events 2+ people chose are suggested automatically) |
| `MAX_PLANS` (5) | Events per person. Must match `C.MAX_PLANS` |
| `TIMES` | Times offered for each event (`'19:30'` style), 5 pm to 10 pm |
| `SHARE_URL` | `https://dandiya.picapool.tech` |
| `COLLEGES_COED`, `COLLEGES_WOMEN` | Guys see the co-ed list only; girls see both. "Other college" lets anyone type theirs |
| `MAX_PHOTOS` (5), `BOARD_SIZE` (20) | Must match `C.MAX_PHOTOS`, `C.BOARD_SIZE` in `server.js` |
| `GUEST_PEEK_LIMIT` (5) | People a guest can see before making a pass |
| `NIGHTS` | Navratri 2026: the days people can pick for an event, and each day's colour. Keep in step with `DATES` in `server.js` |
Don't change `MODE` (`'live'`) or `API_BASE` (`'/api'`).

## 6. Screens, in order
1. **Welcome (night):** outline heart, "Night 5 of 9 · Yellow", **"Find your / *Dandiya partner.*"**, one line, "See who's going", "Already have a pass? Log in".
2. **Name** → 3. **Gender** (Girl / Guy, tap moves on). Above every sign-up card: blurred faces and "184 guys from North Campus are going" (or "North Campus is going to garba" when counts are off or low).
4. **Guest peek (day):** tonight's top 5 of the other side, clear photos, SAMPLE tag on samples, picks held on the phone, "Make my pass to see everyone". After the 5th: "That's tonight's top five. *Everyone else is inside.*"
5. **WhatsApp number** ("3 picks saved" at the top right) → 6. **Code** ("Sent on WhatsApp / by SMS to…", fills itself; after 30 s "Resend code" and "Send by SMS instead") → Picapool check (only when `PICAPOOL_LOOKUP` is on).
7. **Birthday** (DD MM YYYY, shows the age, "I'm 18 or older, continue"; under 18 → "Dandiya Nights is 18+ only" page).
8. **College** (search + tap; "Other college" + type it). Saves the account.
9. **Where are you going for garba?** Suggested events (multiple choice) + "Add an event"; for each event, the day(s) and the time; Terms/Privacy line, "Agree and see who's going". Makes the pass and sends the held picks.
10. **Reveal (night):** "26 girls are going *to garba this Navratri.*" If a held pick already picked them back: "Kavya picked you too, so you're already paired" → "Swap numbers with Kavya".
11. **Discover:** add-photo bar, crown bar, card (photos, college, events with day and time, the ones you share highlighted, line, ⋯ report), skip / pair up bar. Same event + same day first. Arrival → photo sheet; first swipe → photo sheet again if skipped. Fifth swipe → "add a line" sheet (once). 40 picks → daily limit sheet. End of deck → **Review skipped profiles**, invite.
12. **Paired (night overlay):** "You and Kavya *are paired.* You're both going to Hansraj Garba on Saturday." → Swap numbers / Keep exploring (Say hi too, with chat on).
13. **Pairs:** Paired · Picked you · You picked (§9).
14. **Board (live):** Garba Queen / Garba King, tonight / all of Navratri, podium + list of up to 20 a side, ▲/▼ for who moved, "Live · updated 9:41 pm", "You're #3 · 4 people picked you today. Only you see this", Flaunt your crown.
15. **Profile ("Your pass"):** photo, name, college, events; Share my Dandiya pass; Photos (up to 5, make main), Where you're going, College, Your line; In the race; **Pause my pass**; Delete; Log out.
Laptops (1100 px and wider): tonight's Garba Queen and Garba King, top 5 each, beside the app.

## 7. API (JSON; errors are `{message, code?}` written for the user)
| Method, path | Auth | Purpose |
|---|---|---|
| `GET /api/preview?gender=female\|male` | public | Guest peek and sign-up crowd: tonight's top 5 (board order, then a daily shuffle), then samples. `{profiles: [{id, name, college, dates, prompt, photo, sample?}], count}`. Never phones or event names. `count` = real visible people of that side, or `null` (§3). Cached 2 min |
| `GET /api/leaderboard?board=queen\|king&period=tonight\|week` | optional | **Changed.** Up to 20 per board: picked people first, then the rest of the race. Name, college, photo. With a token adds `me: {count, rank}` (private; `rank` only if picked) |
| `POST /api/auth/otp` `{phone, channel?}` · `POST /api/auth/verify` `{phone, code, ref, entry, sessionId}` | public | **Changed.** `channel: 'sms'` = "Send by SMS instead". → `{ok, via: 'whatsapp'\|'sms', alt}` (`alt` = the other way available, or null). Codes: 30 s cooldown, 5/hour per phone, 40/hour per network, 5 tries, 10 min expiry → `{token, user, profile}`. Tokens last 30 days |
| `POST /api/auth/logout` | token | **New.** Ends this session on the server |
| `POST /api/picapool/lookup` | token | → `{status: 'found'\|'not_found'\|'unavailable', user, synced?}` |
| `POST /api/integrations/picapool-user` | `X-Picapool-Secret` | Picapool's push (§4b) |
| `POST /api/account` `{firstName, gender, college, adult:true}` | token | Creates/updates the account (also used to edit the college). Picapool's name and gender win once linked |
| `POST /api/age-block` | token | Under-18: deletes the account, keeps only a count |
| `POST /api/photos {photo}` | token | **New.** One photo (base64 JPG/PNG/WebP, ≤ 1.5 MB) → `{url}`. The page uploads each photo as it's picked, then saves the URLs in the pass. 60 per hour |
| `PUT /api/profile` | token | **Changed.** The pass: `photos` (0 to 5; URLs from `/api/photos` or base64, first = main), `plans` (required, 1 to 5: `[{name, dates: ['2026-10-17'], time: '20:00'}]`, dates within Navratri, same name twice counts once), `prompt {id, text}`, `inBoard`, `paused` (kept if not sent). Strips phones/handles/links from the line and event names |
| `GET /api/events/popular` | token | **New.** Event names 2+ people chose, most popular first (the suggestions on the events screen) |
| `POST /api/profile/pause {paused}` | token | **New.** Pause / resume |
| `GET /api/feed` · `?passed=1` | token | **Changed.** Up to 100 visible passes: same event on the same day first, then same event or same day, then everyone · people I skipped |
| `POST /api/swipe` `{targetId, dir}` | token | 40 picks per IST day. Returns `match` when mutual. 404 for hidden, paused or photo-less passes |
| `GET /api/matches` | token | Pairs, with chat and number states |
| `GET /api/likes/received` · `POST /api/likes/dismiss {targetId}` · `GET /api/likes/sent` | token | Picked you · Not for me · You picked |
| `POST /api/matches/:id/chat {opener}` · `POST /api/matches/:id/share-number` | token | Chat on Picapool (409 `need_account`, `created`, `requested`) · swap numbers |
| `POST /api/leaderboard/opt {optIn}` | token | Join/leave the race |
| `POST /api/report {targetId, reason}` · `POST /api/block` | token | Report also blocks; 3 reports hide the pass |
| `DELETE /api/profile` | token | Deletes pass, photos, picks, pairs. Account stays |
| `POST /api/events` | public | Analytics (§11) |
| `GET /api/stats` | `X-Admin-Key` | Admin only. Counts by date, top events, top colleges |
| `GET /api/admin/export.csv` | `X-Admin-Key` | **New.** Every signup: phone, name, gender, college, ref, signed up (IST), pass, photos, events, Picapool id |
| `/api/admin/summary · top · reports · hide · conflicts` | `X-Admin-Key` | Used by `/admin` |
| `GET /api/health` | public | `{ok, day, storage, otp: ['whatsapp','sms']}`: is the disk writable, which code senders are set |

## 8. Crowns and sharing
- New passes are in the Garba Queen/King race automatically (Profile switch to leave). Top 20 per side, tonight and all of Navratri; no public counts. A pass needs a photo to be crowned.
- Anyone picked into tonight's top 20 sees a gold "#3 Garba King tonight · Flaunt it" bar on Discover, a gold dot on Board, and "Flaunt your crown" on Board and Profile.
- **Story sheet** (crowns and "Share my Dandiya pass"): a 1080×1920 image in the new look (wine night, lights in the nine colours, photo in an arch, DM Serif) opens first → **Share to Instagram story** · **Share to WhatsApp status** (or **Save image**), then **Send on WhatsApp** and **Copy link**.
- The invite sheet (Discover ⤴, end of the deck) leads with the **invite link** (`?ref=st-…`, attributed in `/admin`): Share / Copy invite link, WhatsApp, then "Post my pass to my story".

## 9. Pairs: three tabs, and every chat state
**Paired** (default) · **Picked you** (they picked me; Pair up / Not for me; "You skipped them earlier") · **You picked** (waiting). ⋯ on every row: report or block.
**At launch chat is off** (`CHAT_ENABLED = false`): every pair row has **Swap numbers** (numbers show only when both say yes). The chat states below come back when chat is turned on.

| Situation | What the person sees |
|---|---|
| I'm not on Picapool | "One small step *before you chat*": Get Picapool, "I've signed up" (checks for real), "Swap numbers instead" |
| Both on Picapool | "Say hi to Aditya": first message using the event and day you share, optional **garba plan** (day, event, time, public meeting point) → "Your chat with Aditya *is ready*" → Open Picapool |
| They aren't on Picapool | Same message → "Send message" → "Nikhil is reviewing *your message request*" (row says so too). Becomes a chat the moment they join (§4b) |
| They wrote to me first | Row: "Sent you a message request" + "Read message" |
| Swap numbers | "Swap numbers *with Rohan?* Totally your call…", "Share my number", "Chat on Picapool instead". Numbers show only when both say yes, with "Message on WhatsApp" |

## 10. Admin and the nightly routine (`/admin`, key = `ADMIN_KEY`)
- **Download signups (CSV)** every night and import into Picapool (until account creation is connected). **Events people are going to** shows what's popular.
- **Numbers:** accounts (total, today), passes, **passes without a photo (hidden)**, **paused**, girls/guys, pair-up picks, pairs, chats, numbers shared, reports, under-18 blocked, message requests waiting, Picapool clashes, signups per `ref`.
- **Before posting each night's Garba Queen/King:** Top 20 → check every photo and name → **Hide** anything wrong (hidden people leave the board, the feeds and the guest peek).
- **Reports:** hide, or unhide (clears reports). **Picapool clashes:** §4b.

## 11. Analytics (what's tracked)
Every event goes to `POST /api/events` (live only) and lands in the `events` table with `ts, event, user_id, session_id, ref, data`. Funnel in order:
`landing_view → cta_start → peek_start → peek_swipe{dir} → peek_gate{reason} → peek_to_signup{likes, seen} → otp_sent{via} → otp_verified{existing} → account_created → plan_add → profile_done{events, fromPeek} → pending_likes_sent{sent} → swipe{dir} → photo_prompt → photos_done{count, first}` (`otp_resent{via}` when a code is sent again)
| Area | Events |
|---|---|
| Discover | `swipe{dir, review}`, `review_passed`, `match{from: feed\|review\|peek\|likes_you}`, `line_prompt`, `line_prompt_yes`, `daily_limit` |
| Pairs | `matches_tab{tab}`, `likes_received_view{n}`, `like_back`, `like_dismiss` |
| Chat & numbers | `chat_setup`, `chat_setup_done`, `app_download_click{from}`, `chat_open{withMessage}`, `plan_open`, `plan_sent`, `chat_request_sent`, `number_request` |
| Picapool | `picapool_lookup{status}`, `picapool_synced{status, nameChanged, conflict}` |
| Crowns & sharing | `crown_earned{rank}`, `share_open{kind}`, `share{kind, via}`, `lb_opt{v}` |
| Other | `cta_login`, `card_edit_open{screen}`, `profile_edited`, `pause{v}`, `profile_deleted`, `report`, `block`, `age_blocked` |
Example: peek to pass to photo, by referral link:
```sql
SELECT ref, SUM(event='peek_start') peeks, SUM(event='profile_done') passes, SUM(event='photos_done') photos FROM events GROUP BY ref ORDER BY passes DESC;
```

## 12. Data and privacy
- **Stored:** phone, first name, gender, college, ref, Picapool id; pass (photos, events with days and time, line, race, paused); picks; pairs and message requests; reports; analytics events.
- **Never stored:** date of birth (checked on the phone; only `adult: true` is sent; the boxes are cleared the moment it's used). Under-18 attempts are deleted and only counted.
- **Shown to others:** first name, college, photos and pass (including events, days and times) to signed-in people. **Guests see the top 5's main photo** (clear), first name, college, the days they're going (never where) and line. Board: name, college, main photo, never counts. Numbers only after both agree. Plans share a place and time, never a live location.
- **Counts:** only totals of people going (see §3), never per person.
- **Auto-delete on 20 Oct:** everything Dandiya; accounts and Picapool links stay.
- Terms and Privacy links sit next to "Agree and see who's going". Whoever owns Picapool's privacy policy should check it against the DPDP Act, especially the clear guest photos.

## 13. Phone checklist before the public link
On a real Android phone **opened from a WhatsApp chat**, plus one iPhone:
- [ ] `dandiya.picapool.tech/test?new=1` → welcome fills the screen; "See who's going"
- [ ] Name → gender (tap moves on) → crowd line shows (with or without a number) → **tonight's top 5** with clear photos; samples tagged SAMPLE until there are 5 real people. After the 5th: "Everyone else is inside"; reload shows no more
- [ ] Number → the code arrives **on WhatsApp** (the first box takes a pasted or auto-filled code; it checks itself). Wait 30 s → **Send by SMS instead** → the SMS arrives
- [ ] Birthday shows the age → college tap → **Where are you going**: pick a suggested event, add your own, pick days and a time for each → **reveal** with the count → Discover. "Your picks were sent", or the "already paired" path
- [ ] Swipes on a phone: drag right, drag left, a quick flick, a diagonal swipe, a small drag (snaps back), fast taps on the buttons. Every one moves to the next person exactly once
- [ ] Discover shows "Add a photo"; add several photos at once (each shows as it uploads), make main, Save → "Your pass is live"; the prompt disappears; on the other phone the pass appears **with the photo**
- [ ] Two real accounts pick each other → both see the pair (second within 45 s) and the second person **gets the WhatsApp "new pair" message**. One picks first → the other sees them in **Picked you** → Pair up → paired
- [ ] Swap numbers → numbers only after both agree
- [ ] ⋯ → report → the person is gone from Discover and Pairs. Pause → gone from the other side's Discover; resume → back
- [ ] 40 picks → daily limit sheet. Invite link first in the invite sheet; `?ref=` attributed in `/admin`
- [ ] Share my Dandiya pass and Flaunt your crown → the story image opens → Share to Instagram story lands in IG's story editor; Share to WhatsApp status lands in WhatsApp → My status. In WhatsApp's in-app browser: Save image / long-press works
- [ ] Board open on two phones; pick someone on one → within ~15 s the other shows them move (▲)
- [ ] End of the deck → Review skipped profiles → pick one → they leave the review deck and show in "You picked"
- [ ] Under-18 birthday → "18+ only". `/admin` shows the test accounts; delete the test passes. Don't seed production

**Cold start:** samples cover the guest peek, but aim for 30+ real passes per side before the public push, girls first. No fake people in the feed, ever.

## 14. Known limits
- "Post to story" needs a browser that can share files; WhatsApp/Instagram in-app browsers usually show "Save image" instead. Instagram links need the Link sticker; the page copies the link and says so.
- HEIC photos fail in some Android browsers; the page asks for JPG/PNG.
- No push notifications: pairs arrive by polling (45 s) or `notifyMatch`; Picapool sync by push / return / 5 min.
- The guest 5-person limit lives on the phone (clearing browser data resets it); the server also caps each request at 5.
- Sample photos load from Unsplash's servers until you replace them with your own files.
- Single instance (SQLite). For several servers, move the queries to Postgres; the API stays the same.

## 15. Accessibility (keep it this way)
- Keyboard: everything reachable with a visible outline; ← / → to skip / pair up; sheets and the paired overlay trap Tab, close on Escape, return focus; Pairs tabs switch with arrow keys.
- Choices are real radio groups (`role=radio`, `aria-checked`); toggles are real checkboxes; every icon button has a label.
- Touch targets: main buttons 50+ px, row buttons 40 px, small pills 34 px or more with space around them (WCAG 2.2 AA minimum is 24 px). All text meets WCAG AA contrast (4.5:1 or better, checked on every background); marigold is only used on dark wine.
- Motion: floating crowd, card deal and pop-ins are all turned off with "reduce motion".
- Screen readers: every screen has a heading; dialogs are labelled; the card behind the top one is hidden; the code boxes say "Digit 1 of 4".

## 17. Security and performance (v2.1)
| Area | What's in place |
|---|---|
| Login | WhatsApp code: 30 s cooldown, 5 codes/hour per phone, 40/hour per network, 5 wrong tries then a new code is needed, 10 min expiry, stored as a hash and compared in constant time. Sessions: random 32-byte tokens stored hashed, 30-day expiry, real logout |
| Dev shortcuts | Fixed code and default admin key only with `NODE_ENV=development`/`test`; `integrations.js` never fakes a send otherwise |
| Rate limits | Per session when signed in (900 / 5 min), per IP when not (1,500 / 5 min). Real IP = last `X-Forwarded-For` entry with `TRUST_PROXY=1` |
| Admin & webhook | `X-Admin-Key` header only, constant-time compare; webhook secret constant-time; `/api/stats` admin-only |
| Uploads | One photo per request, max 1.5 MB, 60 per hour per person, 5 in a pass; type from the file's own bytes (JPEG/PNG/WebP only); random file names; only your own uploads can go in your pass; unused uploads removed after an hour; served with a sandbox CSP and `nosniff` |
| Text | Names letters-only; free text stripped of control characters, `<` `>`, phone numbers, @handles and links (line, first message, event names) |
| Browser | CSP (scripts and connections only to this server; images from this server, Unsplash, data/blob), no framing, `nosniff`, strict referrer, permissions off, HSTS in production. No CORS unless `CORS_ORIGIN` is set |
| Privacy | Phones never leave the server except to the other person after both agree. Date of birth never sent. Under-18 attempts deleted |
| Performance | Indexes on pairs (both sides), reports, sessions, the board; board and guest peek cached 15 s / 2 min; open boards refresh every 15 s, pairs every 45 s, both paused when the page is hidden; connections time out after 30 s |
| Still on you | HTTPS at nginx/Caddy; back up `DATA_DIR`; keep `ADMIN_KEY` and `PICAPOOL_WEBHOOK_SECRET` long and random; one instance only (SQLite) |

## 16. Decisions log
| Build | Decision | By |
|---|---|---|
| a–k | See `docs/history/` and build k's handoff: board, chat on Picapool, numbers only when both agree, peek before sign-up, 18+ by date of birth, Picapool sync, Likes you | Purav, 12–14 Oct |
| v2 | Name: **Dandiya Nights**. Not a dating app: pick / pair up / paired / pass; no ages or distances on cards | Deepanshu, 14 Oct |
| v2 | Design modelled on the structure of Play Garba (playgarba.in): wine night for sign-up, cream app, one question per card with an italic second line, tap-to-continue rows, live crowd above the question, reveal before the app, photo after the first swipe. Picapool's own brand, illustration and copy | Deepanshu, 14 Oct |
| v2 | No progress bar | Deepanshu, 14 Oct |
| v2 | Gaps filled: report/block on every card and pair, pause, "Where, mostly?", garba plan in Say hi, WhatsApp-alert line on the reveal, daily limit sheet, look at people you skipped, crown poster kept, log in goes straight to Discover | Deepanshu, 14 Oct |
| v2.1 | Team feedback round 1: code-screen scroll fix, story sharing restored, live boards with 15+ a side, photo upload prompted, line prompt after 5 swipes, review skipped profiles. Design changes for screens 2–4 and Krish's cosmetic changes still to come | Team, 15 Oct |
| v2.1 | Security and performance pass: see §17 | 15 Oct |
| v3 | Team feedback round 2: landing headline "Find your Dandiya partner.", no icon rows, outline heart instead of the dandiya art; swiping fixed; "Which nights" removed; events typed by people (multiple, each with days and time) instead of fixed venues; 4-digit codes kept; WhatsApp + MSG91 codes and pair alerts; chat and the Picapool check off until Picapool's backend is connected; real store/Terms/Privacy links; hosting on our own server | Deepanshu, 15 Oct |
| v2 | **Counts on** (sign-up crowd and reveal), behind `SHOW_COUNTS` and `COUNT_MIN`. Overrides build k's "no counts" rule; **Purav to confirm** | Deepanshu, 14 Oct; Purav to confirm |

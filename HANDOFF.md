# Dandiya Nights: Tech Handoff
Picapool's Navratri app for North Campus. People see who's going to garba on their nights, pair up, and chat or swap numbers on Picapool. Guests can peek at tonight's top 5 before signing up; the picks they make there are sent once they make their pass.

Build `2026-10-15-v2.1` · 15 Oct 2026 (v2.1: team feedback round 1) · Built on Stick Together build k (same server, same Picapool sync), with the approved v2 design and flow.

## What you've got (3 files)
| File | What it is |
|---|---|
| `1-HANDOFF.md` | This document. Read §0 first |
| `2-dandiya-nights-code.js` | **All the code in one file.** `node 2-dandiya-nights-code.js` creates a `dandiya-nights/` folder: server, page, admin page, tests, design source, fonts, the approved v2 prototype and older notes. Every file is checked against its SHA-256 fingerprint as it is written. `--list` shows what's inside without writing anything |
| `3-demo.html` | The page in demo mode (sample people, nothing saved). Open it on a phone to see every screen. Never use it as the public link |

```bash
node 2-dandiya-nights-code.js          # → ./dandiya-nights/
cd dandiya-nights/server && npm test   # 139 checks, ends with "ALL CHECKS PASSED"
```

## 0. Do this (Picapool tech team)
The product side is finished and tested: every screen works in demo mode and against the real server. What's left needs Picapool's systems, accounts or decisions.

| # | Task | Where | Time |
|---|---|---|---|
| 1 | Unpack, run `npm test` | above, §2 | 10 min |
| 2 | **Wire the OTP sender (WhatsApp).** Launch blocker: nobody can log in without it | `integrations.js` → `sendOtp` | 30 to 60 min |
| 3 | **Decide how people get Picapool accounts** (Option A or B in §4b) and wire it | `integrations.js` → `createPicapoolAccount` | 1 h |
| 4 | Wire the account lookup, then set `lookupWired: true` | `integrations.js` → `findPicapoolUser` | 30 min |
| 5 | Make Picapool's backend **push account changes** to `POST /api/integrations/picapool-user`; set `PICAPOOL_WEBHOOK_SECRET` on both sides | Picapool backend, §4b | 1 h |
| 6 | Wire the Picapool chat, **or** set `CONFIG.CHAT_ENABLED = false` (pairs can only swap numbers) | `integrations.js` → `createChat` | 1 to 3 h, or 1 min |
| 7 | Wire the two WhatsApp notices: new pair, and a message request for someone not on Picapool yet. The reveal screen promises "We'll message you on WhatsApp when someone pairs with you" | `notifyMatch`, `notifyMessageRequest` | 1 h |
| 8 | Deploy to `dandiya.picapool.tech` with a persistent disk | §3 | 30 min |
| 9 | Set store links, deep link, Terms and Privacy links, venues | page `CONFIG` (§5) | 10 min |
| 10 | **Replace the sample photos** in `server/samples.json` with your own licensed or AI-generated photos (the current ones are Unsplash placeholders) | `server/samples.json` | 30 min |
| 11 | **Purav decides on counts.** v2 shows "184 girls from North Campus are going" (sign-up) and "26 girls are going on your nights" (reveal). Build k's rule was "never show counts". To turn them off: `SHOW_COUNTS=0` (the page then shows the same lines without a number) | env var | 1 min |
| 12 | Run the phone checklist | §13 | 30 min |

Without steps 3 to 7 the site still runs end to end and never lies to anyone: it says "Couldn't check Picapool right now", keeps first messages as requests, and numbers can still be swapped. Step 2 has no fallback.

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

**Server**: photo-optional passes, `VISIBLE` rule (not hidden, has a photo, not paused) on every list, clear photo + `count` + samples in `/api/preview`, `/api/profile/pause`, admin counts for passes without a photo and paused passes. 24 new checks (137 in total).

## 1. Folder (after unpacking)
| Path | What it is |
|---|---|
| `server/server.js` | The whole backend: API, page hosting, photos, admin. Node 22.13+, **no npm install** (built-in SQLite) |
| `server/integrations.js` | **The only file to edit to connect Picapool.** 6 functions + 1 flag, each with a safe default |
| `server/samples.json` | Sample people for the guest peek (replace the photos, §0 step 10) |
| `server/public/index.html` | The page, already in live mode. Mobile-first, full screen on phones, a centred column on laptops |
| `server/public/admin.html` | `/admin`: numbers, nightly top-20 check, reports, Picapool clashes, hide/unhide |
| `server/test/api.test.js` | `npm test`. Own server on a temp folder, 139 checks. Never touches real data |
| `server/seed.js` · `export.js` · `Dockerfile` | Fake test profiles (`npm run seed:test` / `seed:remove`) · CSV of accounts (`npm run export`) · Docker |
| `demo.html` | Same as `3-demo.html` |
| `source/` | `template.html` (the one source for the page), `build.py`, logo files, `fonts/` (DM Serif Display + Figtree, SIL Open Font License). After a change: `python3 source/build.py` rewrites `server/public/index.html` and `demo.html` |
| `docs/design/v2-approved-prototype.html` | The clickable v2 design that was approved. Reference only |
| `docs/history/` | Build k's page (`template-build-k.html`) and earlier design notes. Background only; **this handoff wins** |

## 2. Run locally
```bash
cd server
npm test                 # 139 checks
npm run seed:test        # 20 fake girls + 20 fake guys (phones start with 5)
npm run dev              # http://localhost:8080 · login code is always 1234 · codes print in the log
```
Use two browsers (or normal + incognito), a girl and a guy, and pick each other to see a pair. Admin: `http://localhost:8080/admin`, key `dev-admin`. Add `?new=1` to the page URL to start over on that browser.

## 3. Deploy
One Node process serves everything: page `/`, API `/api/*`, photos `/photos/*`, admin `/admin`.
**Needs a persistent disk** (SQLite + photos in `DATA_DIR`). Vercel/Netlify functions won't work; use a VPS, the Picapool server, Render/Railway with a volume, or Docker with a volume on `/data`.
```bash
NODE_ENV=production ADMIN_KEY=<long-random> PICAPOOL_WEBHOOK_SECRET=<long-random> DATA_DIR=/var/lib/dandiya-nights PORT=8080 TRUST_PROXY=1 node server.js
# keep it running: pm2 start server.js --name dandiya-nights   (or systemd, or Docker)
```
HTTPS on `dandiya.picapool.tech` via nginx or Caddy. **One instance only** (SQLite is single-writer); plenty for North Campus. Floater links work as `dandiya.picapool.tech/shraddha` or `?ref=shraddha`; both are saved as the signup's `ref`.

| Env var | Default | Notes |
|---|---|---|
| `NODE_ENV` | — | `production`: refuses to start without `ADMIN_KEY`, never fakes codes |
| `ADMIN_KEY` | `dev-admin` in dev | **Required in production.** Protects `/admin` |
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
| `PUBLIC_URL`, `CORS_ORIGIN` | empty, `*` | Only if the page and the API are on different domains |
| `DEV_OTP` | — | Fixed login code for local testing. Ignored in production |

## 4. Connect Picapool (`server/integrations.js`)
| Function / flag | Called when | If you don't wire it |
|---|---|---|
| `sendOtp(phone, code)` | Someone asks for a login code | **Launch blocker.** Production throws; the page says "Couldn't send the code" |
| `lookupWired` (flag) + `findPicapoolUser(phone)` → `{picapoolId, firstName?, gender?, college?}` or null | After the code, on "I've signed up", when the page comes back into view, every 5 min while linked | The page skips the "We found your Picapool account" card and carries on. It never claims "no account" unless the lookup really ran |
| `createPicapoolAccount({phone, firstName, gender, college, ref})` → id | Someone picks their college (that saves the account) | No account is made. Run `npm run export -- --unlinked > new.csv` nightly. **This is the main KPI** |
| `createChat(from, to, opener)` → chatId | Both have Picapool and one sends the first message (with the plan line, if they added one), or someone joins Picapool with a message request waiting | Placeholder id; the app link opens nothing. **Set `CONFIG.CHAT_ENABLED = false`** until ready |
| `notifyMessageRequest(to, from)` | Someone sends `to` a first message but `to` isn't on Picapool yet | Only logs. **Wire it**: the sender's page says "{name} is reviewing your message request", so `to` must actually hear about it |
| `notifyMatch(to, other)` | A new pair | They see it next time the page is open (checked every 45 s). The reveal screen promises a WhatsApp message, so wire it |

## 4b. How Dandiya Nights and the Picapool app stay in sync
Unchanged from build k. **The phone number is the join key.** The same 10-digit number on the web and in the app is the same person. `users.picapool_id` is set once they're linked.

**Who owns what**
| Field | Source of truth once linked | Why |
|---|---|---|
| First name | **Picapool** (first word of the app name) | Chats happen in the app; both sides must show the same name |
| Gender | **Picapool**, *before* the pass exists. After that it is never changed automatically (see clash rules) | Feed, picks, pairs and the board all depend on it |
| College | **Dandiya Nights** (Picapool's college only fills an empty one) | Event-specific choice, made on the college screen |
| Photos, nights, where, line, race, pause, picks, pairs | **Dandiya Nights** | Event data, deleted on 20 Oct |
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
| `PLAY_STORE`, `APP_STORE` | Real store links (currently `REPLACE_ME`) |
| `APP_DEEPLINK` | Same pattern as the `DEEPLINK` env var |
| `TERMS_URL`, `PRIVACY_URL` | **New.** Real links (shown on the nights screen, next to "Agree and see who's going") |
| `VENUES` | **Purav:** the real North Campus events ("Where, mostly?" and the plan in "Say hi"). Keep "Not sure yet" last |
| `PLAN_TIMES` | **New.** Times offered in the plan |
| `SHARE_URL` | `https://dandiya.picapool.tech` |
| `CHAT_ENABLED` | `false` until `createChat` is wired |
| `COLLEGES_COED`, `COLLEGES_WOMEN` | Guys see the co-ed list only; girls see both. "Other college" lets anyone type theirs |
| `MAX_PHOTOS` (5), `BOARD_SIZE` (20) | Must match `C.MAX_PHOTOS`, `C.BOARD_SIZE` in `server.js` |
| `GUEST_PEEK_LIMIT` (5) | People a guest can see before making a pass |
| `NIGHTS` | Navratri 2026. Keep in step with `NIGHT_DATES` in `server.js` |
Don't change `MODE` (`'live'`) or `API_BASE` (`'/api'`).

## 6. Screens, in order
1. **Welcome (night):** arched-window illustration, "Night 4 of 9 · Royal blue", "Your Dandiya night / *starts here.*", three promises (number private · North Campus, 18+ · block or report), "See who's going", "Already have a pass? Log in".
2. **Name** → 3. **Gender** (Girl / Guy, tap moves on). Above every sign-up card: blurred faces and "184 guys from North Campus are going" (or "North Campus is going to garba" when counts are off or low).
4. **Guest peek (day):** tonight's top 5 of the other side, clear photos, SAMPLE tag on samples, picks held on the phone, "Make my pass to see everyone". After the 5th: "That's tonight's top five. *Everyone else is inside.*"
5. **WhatsApp number** ("3 picks saved" at the top right) → 6. **Code** (fills itself; resend after 30 s) → Picapool check (card only when found).
7. **Birthday** (DD MM YYYY, shows the age, "I'm 18 or older, continue"; under 18 → "Dandiya Nights is 18+ only" page).
8. **College** (search + tap; "Other college" + type it). Saves the account.
9. **Nights** (+ "Every night", optional "Where, mostly?"), Terms/Privacy line, "Agree and see who's going". Makes the pass and sends the held picks.
10. **Reveal (night):** "26 girls are going *on your nights.*" If a held pick already picked them back: "Kavya picked you too, so you're already paired" → "Say hi to Kavya".
11. **Discover:** My nights / All nights, add-photo bar, crown bar, card (photos, college, nights with shared ones highlighted, where, line, ⋯ report), skip / pair up bar. Arrival → photo sheet; first swipe → photo sheet again if skipped. Fifth swipe → "add a line" sheet (once). 40 picks → daily limit sheet. End of deck → **Review skipped profiles**, invite, all nights.
12. **Paired (night overlay):** "You and Kavya *are paired.*" → Say hi / Swap numbers / Keep exploring.
13. **Pairs:** Paired · Picked you · You picked (§9).
14. **Board (live):** Garba Queen / Garba King, tonight / all of Navratri, podium + list of up to 20 a side, ▲/▼ for who moved, "Live · updated 9:41 pm", "You're #3 · 4 people picked you today. Only you see this", Flaunt your crown.
15. **Profile ("Your pass"):** photo, name, college, nights, where; Share my Dandiya pass; Photos (up to 5, make main), Nights and where, College, Your line; In the race; **Pause my pass**; Delete; Log out.

## 7. API (JSON; errors are `{message, code?}` written for the user)
| Method, path | Auth | Purpose |
|---|---|---|
| `GET /api/preview?gender=female\|male&nights=d5,d6` | public | **Changed.** Guest peek and sign-up crowd: tonight's top 5 (board order, then a daily shuffle), then samples. `{profiles: [{id, name, college, nights, prompt, photo, sample?}], count}`. Never phones or venues. `count` = real visible people on those nights, or `null` (§3). Cached 2 min |
| `GET /api/leaderboard?board=queen\|king&period=tonight\|week` | optional | **Changed.** Up to 20 per board: picked people first, then the rest of the race. Name, college, photo. With a token adds `me: {count, rank}` (private; `rank` only if picked) |
| `POST /api/auth/otp` `{phone}` · `POST /api/auth/verify` `{phone, code, ref, entry, sessionId}` | public | Codes: 30 s cooldown, 5/hour per phone, 5 tries, 10 min expiry → `{token, user, profile}` |
| `POST /api/picapool/lookup` | token | → `{status: 'found'\|'not_found'\|'unavailable', user, synced?}` |
| `POST /api/integrations/picapool-user` | `X-Picapool-Secret` | Picapool's push (§4b) |
| `POST /api/account` `{firstName, gender, college, adult:true}` | token | Creates/updates the account (also used to edit the college). Picapool's name and gender win once linked |
| `POST /api/age-block` | token | Under-18: deletes the account, keeps only a count |
| `PUT /api/profile` | token | **Changed.** The pass: `photos` (0 to 5; base64 JPG/PNG or your existing photo URLs, first = main), `nights` (required), `venue`, `prompt {id, text}`, `inBoard`, `paused` (kept if not sent). Strips phones/handles from the line |
| `POST /api/profile/pause {paused}` | token | **New.** Pause / resume |
| `GET /api/feed?all=0\|1` · `?passed=1` | token | Up to 60 visible passes, same night + venue first · people I skipped |
| `POST /api/swipe` `{targetId, dir}` | token | 40 picks per IST day. Returns `match` when mutual. 404 for hidden, paused or photo-less passes |
| `GET /api/matches` | token | Pairs, with chat and number states |
| `GET /api/likes/received` · `POST /api/likes/dismiss {targetId}` · `GET /api/likes/sent` | token | Picked you · Not for me · You picked |
| `POST /api/matches/:id/chat {opener}` · `POST /api/matches/:id/share-number` | token | Chat on Picapool (409 `need_account`, `created`, `requested`) · swap numbers |
| `POST /api/leaderboard/opt {optIn}` | token | Join/leave the race |
| `POST /api/report {targetId, reason}` · `POST /api/block` | token | Report also blocks; 3 reports hide the pass |
| `DELETE /api/profile` | token | Deletes pass, photos, picks, pairs. Account stays |
| `POST /api/events` | public | Analytics (§11) |
| `GET /api/stats` | public | Counts (admin use only) |
| `/api/admin/summary · top · reports · hide · conflicts` | `X-Admin-Key` | Used by `/admin` |

## 8. Crowns and sharing
- New passes are in the Garba Queen/King race automatically (Profile switch to leave). Top 20 per side, tonight and all of Navratri; no public counts. A pass needs a photo to be crowned.
- Anyone picked into tonight's top 20 sees a gold "#3 Garba King tonight · Flaunt it" bar on Discover, a gold dot on Board, and "Flaunt your crown" on Board and Profile.
- **Story sheet** (crowns and "Share my Dandiya pass"): a 1080×1920 image in the new look (wine night, lights in the nine colours, photo in an arch, DM Serif) opens first → **Share to Instagram story** · **Share to WhatsApp status** (or **Save image**), then **Send on WhatsApp** and **Copy link**.
- The invite sheet (Discover ⤴, end of the deck) leads with the **invite link** (`?ref=st-…`, attributed in `/admin`): Share / Copy invite link, WhatsApp, then "Post my pass to my story".

## 9. Pairs: three tabs, and every chat state
**Paired** (default) · **Picked you** (they picked me; Pair up / Not for me; "You skipped them earlier") · **You picked** (waiting). ⋯ on every row: report or block. A line on Paired: 🔒 "Your number stays private on Picapool chat."

| Situation | What the person sees |
|---|---|
| I'm not on Picapool | "One small step *before you chat*": Get Picapool, "I've signed up" (checks for real), "Swap numbers instead" |
| Both on Picapool | "Say hi to Aditya": first message using only shared nights, optional **garba plan** (night, place, time, public meeting point) → "Your chat with Aditya *is ready*" → Open Picapool |
| They aren't on Picapool | Same message → "Send message" → "Nikhil is reviewing *your message request*" (row says so too). Becomes a chat the moment they join (§4b) |
| They wrote to me first | Row: "Sent you a message request" + "Read message" |
| Swap numbers | "Swap numbers *with Rohan?* Totally your call…", "Share my number", "Chat on Picapool instead". Numbers show only when both say yes, with "Message on WhatsApp" |

## 10. Admin and the nightly routine (`/admin`, key = `ADMIN_KEY`)
- **Numbers:** accounts (total, today), passes, **passes without a photo (hidden)**, **paused**, girls/guys, pair-up picks, pairs, chats, numbers shared, reports, under-18 blocked, message requests waiting, Picapool clashes, signups per `ref`.
- **Before posting each night's Garba Queen/King:** Top 20 → check every photo and name → **Hide** anything wrong (hidden people leave the board, the feeds and the guest peek).
- **Reports:** hide, or unhide (clears reports). **Picapool clashes:** §4b.

## 11. Analytics (what's tracked)
Every event goes to `POST /api/events` (live only) and lands in the `events` table with `ts, event, user_id, session_id, ref, data`. Funnel in order:
`landing_view → cta_start → peek_start → peek_swipe{dir} → peek_gate{reason} → peek_to_signup{likes, seen} → otp_sent → otp_verified{existing} → picapool_lookup{status} → account_created → profile_done{nights, fromPeek} → pending_likes_sent{sent} → swipe{dir} → photo_prompt → photos_done{count, first}`
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
- **Stored:** phone, first name, gender, college, ref, Picapool id; pass (photos, nights, where, line, race, paused); picks; pairs and message requests; reports; events.
- **Never stored:** date of birth (checked on the phone; only `adult: true` is sent; the boxes are cleared the moment it's used). Under-18 attempts are deleted and only counted.
- **Shown to others:** first name, college, photos and pass to signed-in people. **Guests now see the top 5's main photo** (clear), first name, college, nights and line. Board: name, college, main photo, never counts. Numbers only after both agree. Plans share a place and time, never a live location.
- **Counts:** only totals of people going (see §3), never per person.
- **Auto-delete on 20 Oct:** everything Dandiya; accounts and Picapool links stay.
- Terms and Privacy links sit next to "Agree and see who's going". Whoever owns Picapool's privacy policy should check it against the DPDP Act, especially the clear guest photos.

## 13. Phone checklist before the public link
On a real Android phone **opened from a WhatsApp chat**, plus one iPhone:
- [ ] `dandiya.picapool.tech/test?new=1` → welcome fills the screen; "See who's going"
- [ ] Name → gender (tap moves on) → crowd line shows (with or without a number) → **tonight's top 5** with clear photos; samples tagged SAMPLE until there are 5 real people. After the 5th: "Everyone else is inside"; reload shows no more
- [ ] Number → code (the first box takes a pasted or auto-filled code; it checks itself) → birthday shows the age → college tap → nights → **reveal** with the count → Discover. "Your picks were sent", or the "already paired" path
- [ ] Discover shows "Add a photo"; first swipe opens the photo sheet; add several photos at once, make main, Save → "Your pass is live"; the prompt disappears; the pass now appears for the other side
- [ ] **Sync:** stop at the birthday screen, create a Picapool account with the same number, come back → name/gender from Picapool. Rename yourself in the app → the pass shows the new name within a minute
- [ ] Two real accounts pick each other → both see the pair (second within 45 s). One picks first → the other sees them in **Picked you** → Pair up → paired
- [ ] Say hi with a plan → the message in the Picapool chat ends with "Plan: Thu 15 Oct, College garba, 8:00 pm. Meet at the main entrance."
- [ ] Not on Picapool → "One small step…" → sign up → "I've signed up" finds you. Other not on Picapool → "…is reviewing your message request" → they get the WhatsApp → they sign up → the chat appears for both
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

## 16. Decisions log
| Build | Decision | By |
|---|---|---|
| a–k | See `docs/history/` and build k's handoff: board, chat on Picapool, numbers only when both agree, peek before sign-up, 18+ by date of birth, Picapool sync, Likes you | Purav, 12–14 Oct |
| v2 | Name: **Dandiya Nights**. Not a dating app: pick / pair up / paired / pass; no ages or distances on cards | Deepanshu, 14 Oct |
| v2 | Design modelled on the structure of Play Garba (playgarba.in): wine night for sign-up, cream app, one question per card with an italic second line, tap-to-continue rows, live crowd above the question, reveal before the app, photo after the first swipe. Picapool's own brand, illustration and copy | Deepanshu, 14 Oct |
| v2 | No progress bar | Deepanshu, 14 Oct |
| v2 | Gaps filled: report/block on every card and pair, pause, "Where, mostly?", garba plan in Say hi, WhatsApp-alert line on the reveal, daily limit sheet, look at people you skipped, crown poster kept, log in goes straight to Discover | Deepanshu, 14 Oct |
| v2.1 | Team feedback round 1: code-screen scroll fix, story sharing restored, live boards with 15+ a side, photo upload prompted, line prompt after 5 swipes, review skipped profiles. Design changes for screens 2–4 and Krish's cosmetic changes still to come | Team, 15 Oct |
| v2 | **Counts on** (sign-up crowd and reveal), behind `SHOW_COUNTS` and `COUNT_MIN`. Overrides build k's "no counts" rule; **Purav to confirm** | Deepanshu, 14 Oct; Purav to confirm |

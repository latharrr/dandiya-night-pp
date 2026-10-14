# Stick Together: Tech Handoff
Picapool's Navratri Dandiya partner match for North Campus. Guests peek at the day's top 5 people of the other side (clear photos, no sign-up: see §0b) and like them. They then make a 3-screen card that sends those likes, match, and chat on Picapool.
Build `2026-10-14-k` · 14 Oct 2026 · Owner: Purav · **Target: live by Wed 14 Oct night, public push Thu 15.**

## What you've got (3 files)
| File | What it is |
|---|---|
| `1-HANDOFF.md` | This document. Everything you need to know; read §0 first |
| `2-stick-together-code.js` | **All the code in one file.** Run `node 2-stick-together-code.js` and it creates a `stick-together/` folder with the server, the page, the admin page, tests, the design source and fonts, older design notes, and a copy of this handoff. Every file is checked against its fingerprint as it is written. `--list` shows what's inside without writing anything |
| `3-demo.html` | The page in demo mode (sample people, nothing saved). Open it on a phone to see every screen. Never use it as the public link |

```bash
node 2-stick-together-code.js          # → ./stick-together/
cd stick-together/server && npm test   # 113 checks, ends with "ALL CHECKS PASSED"
```

## 0. Do this today
| # | Task | Where | Time |
|---|---|---|---|
| 1 | Unpack, run `npm test` | above, §2 | 10 min |
| 2 | **Wire the OTP sender.** Required: nobody can log in without it | `integrations.js` → `sendOtp` | 30 to 60 min |
| 3 | **Decide how people get Picapool accounts** (Option A or B in §4b) and wire it | `integrations.js` → `createPicapoolAccount` | 1 h |
| 4 | Wire the account lookup, then set `lookupWired: true` | `integrations.js` → `findPicapoolUser` | 30 min |
| 5 | Make Picapool's backend **push account changes** to `POST /api/integrations/picapool-user`, and set `PICAPOOL_WEBHOOK_SECRET` on both sides | Picapool backend, §4b | 1 h |
| 6 | Wire the Picapool chat, **or** set `CHAT_ENABLED: false` (matches can only share numbers) | `integrations.js` → `createChat` | 1 to 3 h, or 1 min |
| 7 | Wire the two WhatsApp notices: new match, and a message request for someone not on Picapool yet | `notifyMatch`, `notifyMessageRequest` | 1 h |
| 8 | Deploy to `dandiya.picapool.tech` with a persistent disk | §3 | 30 min |
| 9 | Set the store links, deep link and venues | page `CONFIG` (§5) | 10 min |
| 10 | Run the phone checklist | §13 | 30 min |
| 11 | **Guest top 5 with clear (unblurred) photos** | §0b | 1 h |
| 12 | **Never an empty guest preview: sample profiles when there aren't 5 real people** | §0b | 1 to 2 h |

Without steps 3 to 7 the site still runs end to end and never lies to anyone: it says "Couldn't check Picapool right now", keeps first messages as requests, and numbers can still be shared. Step 2 has no fallback.

## 0b. Two changes still to build (from Purav, 14 Oct, after build k)
These are **not in the code yet**. Where this document says the guest top 5 is blurred or shows no photos (top of page, §6, §7 `/api/preview`, §12, §13), this section wins.

**1. The guest top 5 shows real, unblurred photos.**
- The 5 profiles a guest sees before making a card (the day's top 5 of the other side) show their **main photo, clear**, not the blurred 18×22 thumbnail.
- Server: `GET /api/preview` returns the main photo URL for those 5 (still never phones or venues). Hidden or deleted people never appear.
- Page: in the guest preview cards, drop the blur and use the real photo, same as the signed-in feed. The rest stays: max 5 people, likes held on the phone, then "Make your card to see more".

**2. A first visitor always sees something.**
- Right now, if nobody (or fewer than 5 people) of the other side has a card, the guest preview is empty or short. Purav will be among the first users, so this will happen on day one.
- Fill the gap with **sample profiles** so the preview always has 5 cards: real people first (in board order), then samples.
- Photos: AI-generated or stock images (licensed for commercial use, not real students' photos). Plausible first names, North Campus colleges, nights and a line, like the demo's sample people in `demo.html`.
- Show a small **"Sample"** tag on these cards so nobody thinks they're real people. A like on a sample goes nowhere (no match, no notice), and samples never appear on the boards, in the signed-in feed, in Likes you or in admin counts.
- As real cards come in, samples drop out automatically. Add an on/off setting (for example `SAMPLE_PROFILES: true` in `CONFIG`) so they can be switched off once there are enough people.

## 1. Folder (after unpacking)
| Path | What it is |
|---|---|
| `server/server.js` | The whole backend: API, page hosting, photos, admin. Node 22.13+, **no npm install** (built-in SQLite) |
| `server/integrations.js` | **The only file to edit to connect Picapool.** 6 functions + 1 flag, each with a safe default |
| `server/public/index.html` | The page, already in live mode. Mobile-first, fills the screen on any phone or laptop |
| `server/public/admin.html` | `/admin`: numbers, nightly top-20 check, reports, Picapool clashes, hide/unhide |
| `server/test/api.test.js` | `npm test`. Own server on a temp folder, 113 checks. Never touches real data |
| `server/seed.js` · `export.js` · `Dockerfile` | Fake test profiles (`npm run seed:test` / `seed:remove`) · CSV of accounts (`npm run export`) · Docker |
| `demo.html` | Same as `3-demo.html` |
| `source/` | `template.html` (the one source for the page), `build.py`, logo files, `fonts/` (Poppins + Yatra One, SIL Open Font License). After a design change: `python3 source/build.py` rewrites `server/public/index.html` and `demo.html` |
| `docs/history/` | Earlier design notes (onboarding teardown, critiques, accessibility audit of build g). Background only; **this handoff wins** where they differ |

## 2. Run locally
```bash
cd server
npm test                 # 113 checks
npm run seed:test        # 20 fake girls + 20 fake guys (phones start with 5)
npm run dev              # http://localhost:8080 · login code is always 1234 · OTPs print in the log
```
Use two browsers (or normal + incognito), a girl and a guy, and like each other to see a match. Admin: `http://localhost:8080/admin`, key `dev-admin`.

## 3. Deploy
One Node process serves everything: page `/`, API `/api/*`, photos `/photos/*`, admin `/admin`.
**Needs a persistent disk** (SQLite + photos in `DATA_DIR`). Vercel/Netlify functions won't work; use a VPS, the Picapool server, Render/Railway with a volume, or Docker with a volume on `/data`.
```bash
NODE_ENV=production ADMIN_KEY=<long-random> PICAPOOL_WEBHOOK_SECRET=<long-random> DATA_DIR=/var/lib/stick-together PORT=8080 TRUST_PROXY=1 node server.js
# keep it running: pm2 start server.js --name stick-together   (or systemd, or Docker)
```
HTTPS on `dandiya.picapool.tech` via nginx or Caddy. **One instance only** (SQLite is single-writer); plenty for North Campus. Floater links work as `dandiya.picapool.tech/shraddha` or `?ref=shraddha`; both are saved as the signup's `ref`.

| Env var | Default | Notes |
|---|---|---|
| `NODE_ENV` | — | `production`: refuses to start without `ADMIN_KEY`, never fakes OTPs |
| `ADMIN_KEY` | `dev-admin` in dev | **Required in production.** Protects `/admin` |
| `PICAPOOL_WEBHOOK_SECRET` | empty (push disabled) | Shared secret for Picapool's backend → `X-Picapool-Secret` header (§4b) |
| `DATA_DIR` | `./data` | Database and photos. Back it up |
| `PORT` | `8080` | |
| `TRUST_PROXY` | off | `1` behind nginx so rate limits use the real IP |
| `DEEPLINK` | `picapool://chat/{chatId}` | Opens a chat in the app |
| `DAILY_RIGHT_CAP` | `40` | Likes per IST day. Keep equal to `CONFIG.DAILY_RIGHT_CAP` |
| `OTP_LENGTH` | `4` | Keep equal to `CONFIG.OTP_LENGTH` |
| `DELETE_ON` | `2026-10-20` | Date (IST) all Dandiya data is deleted |
| `REPORT_HIDE` | `3` | Reports that hide a profile until an admin reviews it |
| `LB_REFRESH_MS` | `60000` | How often the board (and the guest top 5) is recomputed |
| `PUBLIC_URL`, `CORS_ORIGIN` | empty, `*` | Only if the page and the API are on different domains |
| `DEV_OTP` | — | Fixed login code for local testing. Ignored in production |

## 4. Connect Picapool (`server/integrations.js`)
| Function / flag | Called when | If you don't wire it |
|---|---|---|
| `sendOtp(phone, code)` | Someone asks for a login code | **Launch blocker.** Production throws; the page says "Couldn't send the code" |
| `lookupWired` (flag) + `findPicapoolUser(phone)` → `{picapoolId, firstName?, gender?, college?}` or null | After OTP, on "I've signed up", when the page comes back into view, every 5 min while linked | Page says "Couldn't check Picapool right now" and carries on. It never claims "no account" unless the lookup really ran |
| `createPicapoolAccount({phone, firstName, gender, college, ref})` → id | A new person finishes About you | No account is made. Run `npm run export -- --unlinked > new.csv` nightly. **This is the main KPI** |
| `createChat(from, to, opener)` → chatId | Both have Picapool and one sends the first message, or someone joins Picapool with a message request waiting | Placeholder id; the app link opens nothing. **Set `CONFIG.CHAT_ENABLED = false`** until ready |
| `notifyMessageRequest(to, from)` | Someone sends `to` a first message but `to` isn't on Picapool yet | Only logs. **Wire it**: the sender's page says "{name} is reviewing your message request", so `to` must actually hear about it |
| `notifyMatch(to, other)` | A new match | They see it next time the page is open (checked every 45 s). A WhatsApp template brings them back faster |

## 4b. How Stick Together and the Picapool app stay in sync
**The phone number is the join key.** The same 10-digit number on the web and in the app is the same person. `users.picapool_id` is set once they're linked.

**Who owns what**
| Field | Source of truth once linked | Why |
|---|---|---|
| First name | **Picapool** (first word of the app name) | Chats happen in the app; both sides must show the same name |
| Gender | **Picapool**, *before* the card exists. After the card exists it is never changed automatically (see clash rules) | Feed, likes, matches and the board all depend on gender |
| College | **Stick Together** (Picapool's college only fills an empty one) | Event-specific choice, made on the About you screen |
| Photos, nights, line, race, likes, matches | **Stick Together** | Event data, deleted on 20 Oct |
| Date of birth | Never stored anywhere here; only `adult: true` | Privacy |

**When linking happens (and how fast)**
| Moment | How | Speed |
|---|---|---|
| They already had Picapool | `findPicapoolUser` right after OTP ("Checking for a Picapool account") | Instant |
| They create a Picapool account while the site is open in another tab | The page re-checks when it comes back into view | Instant on return |
| They create it with the site closed, or edit their name/gender in the app | **Picapool's backend pushes** `POST /api/integrations/picapool-user` (below) | Real time |
| Safety net | The page re-checks every 5 min while linked, and on "I've signed up" | ≤ 5 min |

**The push from Picapool's backend.** Call it on: account created, name or gender edited, account deleted or banned.
```
POST https://dandiya.picapool.tech/api/integrations/picapool-user
X-Picapool-Secret: <PICAPOOL_WEBHOOK_SECRET>
{"phone": "9876543210", "picapoolId": "pp_123", "firstName": "Simran Kaur", "gender": "female", "college": "Miranda House"}
{"phone": "9876543210", "deleted": true}      // deleted or banned
```
→ `{ok, linked, nameChanged?, conflict?}`. Unknown phone → `{linked: false}` (they'll be linked when they first log in). Phone may include +91 or spaces.

**The moment someone joins Picapool, every message request waiting for them becomes a real chat** (with the sender's message in it, via `createChat`). So "{name} is reviewing your message request" turns into a chat without anyone tapping anything.

**Option A or B: decide before launch**
- **Option A: create a Picapool account for everyone** (wire `createPicapoolAccount`). Everyone is linked as soon as they finish About you. "One small step before you chat" never shows, chats always open, and message requests only happen for people who skipped it. When they install the app with the same number, their chats are already there. Simplest for users and best for the KPI.
- **Option B: people create their own Picapool account** (leave `createPicapoolAccount` returning null). Chat asks them to download the app first. If the other person isn't on Picapool, the first message waits as a request. Wire `findPicapoolUser` and the push, or nobody can link.
The code supports both. A mix also works: wire it later and existing people link on their next visit.

**Edge cases (all handled in code, all covered by tests unless marked)**
| # | Situation | What happens |
|---|---|---|
| 1 | Logs in on the web, leaves at About you, creates a Picapool account, comes back | On return the page re-checks (or the push already linked them). About you shows "From your Picapool account: Simran · Girl" and the college list follows that gender. The name typed on "Who's dancing?" is replaced |
| 2 | Had a Picapool account before visiting | Found after OTP; About you shows the Picapool name and gender |
| 3 | Name differs between what they typed here and Picapool, before the card | Picapool's wins (server enforces it on `POST /api/account` too) |
| 4 | Name changed in Picapool after the card exists | Card, matches and board show the new name. They see "Your name now matches your Picapool account" once |
| 5 | Gender differs, before the card | Picapool's wins. Likes they picked as a guest for the other side are dropped. A women-only college is cleared for a guy |
| 6 | Gender differs, after the card | **Not applied** (it would break their likes and matches). Flagged `identity_conflict='gender'`; listed in `/admin` → "Name or gender differs from Picapool". The card keeps working. Cleared automatically once the two agree again. A person decides: fix it in the app, or hide the card |
| 7 | Picapool name is a full name ("Simran Kaur") or has digits/emoji | First word only; anything that isn't letters is ignored and the Stick Together name stays |
| 8 | Picapool has no name or gender | Stick Together's values stay |
| 9 | Picapool account deleted or banned | Push `deleted: true` (or the lookup returns null): unlinked. Chat goes back to "One small step before you chat". To remove the card too, hide it in `/admin` |
| 10 | Different phone numbers in the app and here | Treated as two different people; nothing can link them. All copy says "sign up with +91 … (the same number)" |
| 11 | Lookup or push down / slow | Never blocks anything; "Couldn't check right now"; re-checked on the next visit |
| 12 | Pushed before they ever opened the site | Ignored; linked by the lookup at their first login |
| 13 | Two devices (phone + laptop) | Card, likes, matches and chats come from the server. Guest peek and unsaved About you answers stay on the device they were typed on |
| 14 | Under-18 according to Picapool | **Not handled** (Picapool's DOB isn't read). If Picapool stores DOB, add the check in `linkPicapool()` in `server.js` and call the age-block path |
| 15 | `createChat` fails while delivering waiting requests | The request stays; it's retried on their next link or when either person opens the chat |
| 16 | Requester deletes their card or blocks the other person | The match and its request are gone; blocked pairs are never delivered |
| 17 | Opening the chat twice / from both sides | Same `chatId`, never a second chat |
| 18 | Guest switches Girl/Guy on "Who's dancing?" or reloads | Still 5 people in total (counted on the phone). Clearing browser data resets the count (known limit) |
| 19 | Fewer than 5 people on the boards | The guest top 5 is filled from everyone else of that side, in a daily shuffle |
| 20 | Like back from Likes you | A normal like: counts toward 40/day and makes the match instantly |
| 21 | Someone liked you after you passed them | They show in Likes you with "You passed earlier". "Not for me" hides them from that list for good (not a block) |
| 22 | 20 Oct auto-delete | Cards, photos, likes, matches, requests and "Not for me" are deleted. Accounts and Picapool links stay |

## 5. Page settings (`CONFIG` at the top of the script in `server/public/index.html`; source: `source/template.html`)
| Key | Set to |
|---|---|
| `PLAY_STORE`, `APP_STORE` | Real store links (currently `REPLACE_ME`) |
| `APP_DEEPLINK` | Same pattern as the `DEEPLINK` env var |
| `VENUES` | **Purav:** the real North Campus event names (chips on "Where?") |
| `SHARE_URL` | `https://dandiya.picapool.tech` |
| `CHAT_ENABLED` | `false` until `createChat` is wired |
| `COLLEGES_COED`, `COLLEGES_WOMEN` | Guys see the co-ed list only; girls see both. "Other college" lets anyone type theirs |
| `MAX_PHOTOS` (5), `BOARD_SIZE` (20) | Must match `C.MAX_PHOTOS`, `C.BOARD_SIZE` in `server.js` |
| `GUEST_PEEK_LIMIT` (5) | People a guest can see before making a card |
Don't change `MODE` (`'live'`) or `API_BASE` (`'/api'`).

## 6. Screens, in order
1. **Landing:** Garba dancers, "Find your Dandiya partner.", "For North Campus students only · 18+", one button "See who's dancing". Day/night toggle in every header (night by default, remembered).
2. **Who's dancing?** First name + Gender only. "Already made your card? Log in" for returning people.
3. **Preview:** the day's top 5 of the other side (tonight's board, then all-Navratri, then others), faces blurred, likes held on the phone, no counters. After the 5th: "Make your card to see more".
4. **Phone → code → "Checking for a Picapool account"** → found / not found / couldn't check (never blocks).
5. **About you:** date of birth (one DD/MM/YYYY field) → college (filtered by gender, + Other college) → nights. Name and gender only appear here if they logged in without peeking. Shows "From your Picapool account: …" when linked.
6. **Photos:** up to 5, several at once, "Main photo" tag, "Make main". The button makes the card; held likes are sent.
7. **App tabs:** Swipe (portrait cards, My/All nights, a one-time "add a line" prompt after 5 swipes, "Review passed profiles" at the end) · **Matches** (§9) · Board (unchanged) · Me (unchanged).

## 7. API (JSON; errors are `{message, code?}` written for the user)
| Method, path | Auth | Purpose |
|---|---|---|
| `GET /api/preview?gender=female\|male` | public | Guest peek: the day's top 5 (order above). First name, college, nights, line, 18×22 `thumb` only. **Never photos, phones or venues.** Cached 2 min |
| `GET /api/leaderboard?board=queen\|king&period=tonight\|week` | optional | Top 20 per board: name, college, photo. With a token adds `me: {count, rank}` (private) |
| `POST /api/auth/otp` `{phone}` | public | 30 s cooldown, 5/hour per phone |
| `POST /api/auth/verify` `{phone, code, ref, entry, sessionId}` | public | → `{token, user, profile}`. 5 tries, 10 min expiry |
| `POST /api/picapool/lookup` | token | → `{status: 'found'\|'not_found'\|'unavailable', user, synced?: {nameChanged, conflict}}`. Applies the §4b rules |
| `POST /api/integrations/picapool-user` | `X-Picapool-Secret` | Picapool's push (§4b) |
| `POST /api/account` `{firstName, gender, college, adult:true}` | token | Creates/completes the account. Once linked, Picapool's name and gender win. Women-only colleges refused for guys. `user.hasPicapool` in every user object |
| `POST /api/age-block` | token | Under-18: deletes the account, keeps only a count |
| `PUT /api/profile` | token | Card: photos (base64 JPG/PNG, up to 5, 1.5 MB each, first = main), nights (required), venue, prompt, inBoard (new card → in the race by default; edits keep the stored choice), thumb. Strips phones/handles from the line |
| `GET /api/feed?all=0\|1` · `?passed=1` | token | Up to 60 cards, same night + venue first · people I passed, for review (liking one updates the same swipe; one match only) |
| `POST /api/swipe` `{targetId, dir}` | token | 40 likes per IST day. Returns `match` when mutual |
| `GET /api/matches` | token | Mutual. `person.hasPicapool`, `chatId`, `chatRequest: 'sent'\|'received'\|null` (+ `requestMessage` for the sender), `numberStatus`, phone only after both agree |
| `GET /api/likes/received` · `POST /api/likes/dismiss {targetId}` | token | Likes you: people who liked me that I haven't liked back (`passed` if I passed them) · "Not for me" |
| `GET /api/likes/sent` | token | Sent: people I liked who haven't liked me back |
| `POST /api/matches/:id/chat {opener}` | token | 409 `need_account` if I'm not on Picapool · `{status:'created', chatId, deepLink}` if both are · `{status:'requested'}` if they aren't yet (stored; `notifyMessageRequest`; becomes a chat when they join) |
| `POST /api/matches/:id/share-number` | token | `waiting` or `shared` + phone |
| `POST /api/leaderboard/opt {optIn}` | token | Join/leave the board (Me tab switch) |
| `POST /api/report {targetId, reason}` · `POST /api/block` | token | Report also blocks; 3 reports hide the profile |
| `DELETE /api/profile` | token | Deletes card, photos, likes, matches. Account stays |
| `POST /api/events` | public | Analytics (§11) |
| `GET /api/stats` | public | Counts (admin use only; the page never shows participant counts) |
| `/api/admin/summary · top · reports · hide · conflicts` | `X-Admin-Key` | Used by `/admin` |

## 8. Crowns and sharing
- New cards are in the Garba Queen/King race automatically (Me tab switch to leave). Top 20 per side, tonight and all-Navratri; no public counts.
- Anyone in tonight's top 20 sees a gold "#3 Garba Queen tonight · Flaunt it" bar on Swipe, a gold dot on Board, and "Flaunt your crown" on Me and Board. It builds a 1080×1920 story poster in the phone. Its sheet: **Post to story** (share sheet with Instagram/WhatsApp; **Save image** where files can't be shared) · **Send on WhatsApp** · **Copy link**.
- The invite sheet (Me → "Share my Dandiya card", and the end of the feed) leads with the **invite link** (`?ref=st-…`, so signups are attributed): Share/Copy invite link, WhatsApp, then "Or post a story" with the "Looking for a Dandiya partner" poster.

## 9. Matches: three tabs, and what each chat state looks like
**Mutual** (default) · **Likes you** (they liked me; Like back / Not for me) · **Sent** (I liked; waiting).
A short line sits right above the chat button on the match screen and the Mutual list: 🔒 "Your number stays private on Picapool chat."

| Situation | What the person sees |
|---|---|
| I'm not on Picapool | "One small step before you chat": Download Picapool, then "I've signed up" (checks for real) |
| Both on Picapool | Editable first message using only shared dates ("Good call. Picapool chat keeps your number private…") → "Your chat with Aditya is ready" → Open Picapool |
| They aren't on Picapool | Same message → "Send message" → "Nikhil is reviewing your message request" (row says so too). Becomes a chat the moment they join (§4b) |
| They wrote to me first | Row: "Sent you a message request" + "Read message" → opens the chat |
| Share numbers | "Swap numbers with Rohan? Totally your call…", main button "Share my number", quiet link "Chat on Picapool instead". Numbers show only when both say yes |

## 10. Admin and the nightly routine (`/admin`, key = `ADMIN_KEY`)
- **Numbers:** accounts (total, today), cards, girls/guys, likes, matches, chats, numbers shared, reports, under-18 blocked, **message requests waiting**, **Picapool clashes**, signups per `ref`.
- **Before posting each night's Garba Queen/King:** Top 20 → check every photo and name → **Hide** anything wrong (hidden people leave the board, the feed and the guest top 5).
- **Reports:** hide, or unhide (clears reports). **Picapool clashes:** see §4b row 6.

## 11. Analytics (what's tracked)
Every event goes to `POST /api/events` (live only) and lands in the `events` table with `ts, event, user_id, session_id, ref, data`. Funnel in order:
`landing_view → cta_start → peek_start → peek_swipe{dir} → peek_gate{reason} → peek_to_signup{likes, seen} → otp_sent → otp_verified{existing} → picapool_lookup{status} → account_created → photos_done{count} → profile_done → pending_likes_sent{sent}`
| Area | Events |
|---|---|
| Swiping | `swipe{dir, review}`, `review_passed`, `match{from: feed\|review\|peek\|likes_you}`, `line_prompt`, `line_prompt_yes` |
| Matches | `matches_tab{tab}`, `likes_received_view{n}`, `like_back`, `like_dismiss` |
| Chat & numbers | `chat_setup`, `chat_setup_done`, `app_download_click{from}`, `chat_open{withMessage}`, `chat_request_sent`, `number_request` |
| Picapool | `picapool_lookup{status}`, `picapool_synced{status, nameChanged, conflict}` |
| Crowns & sharing | `crown_earned{rank}`, `share_open{kind}`, `share{kind, via}`, `lb_opt{v}` |
| Other | `cta_login`, `card_edit_open{screen}`, `profile_edited`, `profile_deleted`, `report`, `block`, `age_blocked` |
Example: conversion from peek to card by referral link:
```sql
SELECT ref, SUM(event='peek_start') peeks, SUM(event='profile_done') cards FROM events GROUP BY ref ORDER BY cards DESC;
```

## 12. Data and privacy
- **Stored:** phone, first name, gender, college, ref, Picapool id; card and photos; likes; matches and message requests; reports; events.
- **Never stored:** date of birth (checked in memory on the phone; only `adult: true` is sent). Under-18 attempts are deleted and only counted.
- **Shown to others:** first name, college, photos and card to signed-in people; guests get the top 5's first name, college, nights, line and a blurred 18×22 thumbnail. Board: name, college, main photo, never counts. Numbers only after both agree.
- **Auto-delete on 20 Oct:** everything Dandiya; accounts and Picapool links stay.
- The consent line is on About you. Whoever owns Picapool's privacy policy should check it against the DPDP Act.

## 13. Phone checklist before the public link
On a real Android phone **opened from a WhatsApp chat**, plus one iPhone:
- [ ] `dandiya.picapool.tech/test?new=1` → landing fills the screen; toggle day/night and reload: it remembers
- [ ] "See who's dancing" → name + gender → **the day's top 5** of the other side (compare with Board → tonight), blurred, no counters. After the 5th: "Make your card to see more"; reload shows no more
- [ ] Number → code → "Checking for a Picapool account" → About you (DD/MM/YYYY, college, nights) → photos (several at once, Make main) → feed; "Your likes were sent" or the match
- [ ] **Sync:** stop at About you, create a Picapool account in the app with the same number, come back → name/gender from Picapool shown. Then rename yourself in the app → the card shows the new name within a minute (push) or on return
- [ ] Two real accounts like each other → both see the match (second within 45 s). One likes first → the other sees them in **Likes you** → Like back → match
- [ ] Chat without Picapool → "One small step…" → sign up → "I've signed up" finds you. Both on Picapool → chat ready, message in the app. Other not on Picapool → "…is reviewing your message request" → they get the WhatsApp → they sign up → the chat appears for both with the message, without either tapping
- [ ] Share numbers → "Totally your call…" → numbers only after both agree
- [ ] Invite link first in Share; `?ref=` attributed in `/admin`. Crown: get into tonight's top 20 → bar → Flaunt it → post to Instagram story and WhatsApp status
- [ ] Under-18 date → "18+ only". `/admin` shows the test accounts; delete the test cards. Don't seed production

**Cold start:** 30+ real cards per side before the public push, girls first. No fake profiles in production.

## 14. Known limits
- "Post to story" needs a browser that can share files; WhatsApp/Instagram in-app browsers usually show "Save image" instead.
- Instagram links need the Link sticker; the page copies the link and says so.
- HEIC photos fail in some Android browsers; the page asks for JPG/PNG.
- No push notifications: matches arrive by polling (45 s) or `notifyMatch`; Picapool sync by push/return/5 min.
- The guest 5-person limit lives on the phone (clearing browser data resets it); the server also caps each request at 5.
- Single instance (SQLite). For several servers, move the queries to Postgres; the API stays the same.

## 15. Accessibility (keep it this way)
- Keyboard: everything reachable with a visible outline; ← / → swipe; sheets and the match screen trap Tab, close on Escape, return focus; Matches tabs switch with arrow keys.
- Contrast: night and day both pass WCAG AA (axe, every screen, 0 issues at 320/393/1440 px). Orange text uses `--accent-text`, gold text `--gold-text`.
- Touch targets ≥ 44 px (chips, tabs, row buttons, photo × and Make main, theme toggle, card ⋯).
- Motion: dancers sway twice and stop; sticks swing in once; all motion off with "reduce motion".
- Screen readers: every screen has a heading; dialogs are labelled; the card behind the top one is hidden.

## 16. Decisions log
| Build | Decision | By |
|---|---|---|
| a–c | Garba Queen / Garba King board, tonight + all-Navratri, no public counts; chat on Picapool by default, numbers only when both agree; full-screen on every device | Purav |
| d–f | Navratri look and motifs; crowns shared as story posters; peek before sign-up; copy cut to one line per screen, no emojis | Purav's feedback, 12–13 Oct |
| g | Card = 3 screens (Knuckle Meter, ride, vibe, "partner for" removed); accessibility pass to WCAG 2.1 AA | Purav, 13 Oct |
| h | Ink night / cream day theme with toggle; Garba dancers landing, one button, no counts; 5-person guest peek; Picapool lookup after OTP; 5 photos with Main photo; portrait cards; "add a line" prompt; review passed; Matches Mutual/Sent; invite link first; race automatic; top 20 per board. Board and Me layouts untouched | Purav, 14 Oct |
| i | "Who's dancing?" = name + gender only; nights move to About you; "More options" removed, Share numbers is a plain button | Purav, 14 Oct |
| j | One DD/MM/YYYY date field; caring copy ("Good call", "Totally your call"); chat needs your own Picapool first; "{name} is reviewing your message request"; crossed dandiya sticks | Purav, 14 Oct |
| k | **Likes you** tab (people who liked you first); **guest peek = the day's top 5** from the board ranking; privacy line moved onto the chat button as one short line; **Picapool sync** (ownership rules, real-time push, waiting requests become chats on join, clash handling, admin list); match event tracked on every path; handoff cut to 3 files | Purav, 14 Oct |

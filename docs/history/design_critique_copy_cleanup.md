# Design Critique: Stick Together copy and home page (vs playgarba.in)
13 Oct 2026 · Build `2026-10-13-e` reviewed, fixes shipped in `2026-10-13-f`

## Overall Impression
The look was right but the voice was loud. Every screen explained itself in 2 or 3 sentences, and 41 lines of UI code carried emojis. The home page asked people to read five blocks (hero, stats, per-night counts, colleges, crowns) before the button. playgarba.in shows how quiet a festival app can be: its app entry is one card with one headline, one line and one action.

## What playgarba.in does (viewed 13 Oct)
| Element | playgarba.in | Stick Together before | Now |
|---|---|---|---|
| Entry screen | Logo, "Night 3 of 9 · Red" pill, "Find your Garba partner.", one line, 3 trust points with line icons, one sign-in button | Hero, 2-sentence intro, stats block, per-night counts, colleges, crowns panel, button, long login line | Garba circle, "Night 3 of 9 · Red" pill, "Find your Dandiya partner.", "North Campus, all nine nights.", one button, "Log in", one footnote |
| Emojis | None. Thin line icons | 41 lines with emojis (👑🔥💃🎉✨💬🛵😉…) | **0 in the UI.** Drawn icons for heart, crown, lock; the Knuckle Meter is a 3-bar meter |
| Copy length | One idea per block, short declaratives ("Dating is optional. The dance isn't.") | Multi-sentence explanations on most screens | One headline, at most one short line, one action |
| Sign-up | Google sign-in, "five quick taps" | 4-screen card after peeking | Unchanged (already shorter than theirs, and it keeps the peek-first advantage) |
| Marketing vs app | A long marketing site (how it works, safety, plans, colours, FAQ) separate from a minimal app | Everything inside the app | App stays minimal; explanations belong in WhatsApp floats, not on screens |

**Home page words: 82 → 25** (measured on a 393px screen).

## Usability
| Finding | Severity | Fix shipped |
|---|---|---|
| Five content blocks before the main button; the button competed with stats and the crowns panel | 🔴 | Landing = circle, night pill, headline, one line, button. Stats collapsed to a one-line footnote ("40 people are in · 18+ only"); crowns live in the app |
| Emojis did the work of icons and words at once (🛵 Has 1 free seat, 💥 Knuckle breaker, 👑 Flaunt) and looked noisy next to Yatra One | 🔴 | Removed. Line icons where an icon helps (heart count, crown bar, lock); plain words everywhere else |
| Screens explained what the button already said ("This goes as your first message on Picapool", "Tap here for more · tap the photo to flip") | 🟡 | Removed redundant helper text; kept only what changes a decision (date of birth privacy, consent) |
| Night chips read as sentences ("Wed 14 · Royal blue") | 🟡 | "Wed 14" plus its colour dot; the colour shows when selected |
| The match screen stacked five chips (nights, both Knuckle Meters, ride) | 🟡 | One sentence: "You and Rahul, both going Thu." |
| The consent line was 52 words | 🟡 | 22 words, same meaning: 18+, card shown here, photos only to signed-in people, deleted 20 Oct |

## Visual Hierarchy
- **What draws the eye first:** the garba circle, then the headline. Correct.
- **Reading flow:** pill → headline → one line → button. Four stops instead of nine.
- **Emphasis:** gold is now only on crowns and the Knuckle Meter, orange only on actions. No emoji competes with either.

## Consistency
| Element | Before | Now |
|---|---|---|
| Icons | Mixed emojis, Unicode hearts and SVGs | One set of drawn icons, sized to the text |
| Headlines | "Quick intro", "Give them something to reply to", "Add your photos" | Short nouns: "About you", "Your line", "Add a photo", "Who's going?" |
| Button labels | "Make my card · 1 min", "💬 Plan & chat", "Put me in 👑" | "Make my card to send 2 likes", "Chat", "Put me in" |
| Share texts | 5 emojis per message | One crown on the crown message, none on the partner message |

## Accessibility
- **Colour contrast:** unchanged and passing (dark text on orange buttons, cream on aubergine).
- **Touch targets:** unchanged (≥42px chips, 54px buttons).
- **Screen readers:** emojis were being read aloud ("crown", "fire"). The drawn icons are hidden from screen readers and the text carries the meaning.

## What Works Well
- The Navratri visuals (toran, garbo circle, night beads, arch cards) carry the festive mood, so the copy no longer has to.
- The peek-first flow is a structural advantage over playgarba.in, which asks for Google sign-in before anything else.
- The Knuckle Meter as a 3-bar meter reads at a glance and is more ownable than an emoji.

## Next, if there's time
1. **Trust points on the landing.** playgarba.in puts "No phone number, ever · No live location · Block or report" right on the entry card. Our equivalents ("Faces stay private until you join · Block or report anyone · Deleted after Navratri") could sit as a single icon row under the button. Worth testing in the hallway test before adding words back.
2. **Keep explanations out of the app.** Put "how it works" in the WhatsApp float copy and in a story post, as playgarba.in does with its separate site.

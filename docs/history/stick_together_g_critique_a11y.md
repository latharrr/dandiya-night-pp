# Stick Together: fewer questions + accessibility audit
13 Oct 2026 · Build `2026-10-13-g` · Owner: Purav

## Part 1. Design critique: what we stopped asking

### What changed
| | Build f | Build g |
|---|---|---|
| Screens to make a card | 4 (number + code, about you, photo, Knuckle Meter) | **3** (number + code, about you, photo) |
| Where the card gets made | A 4th screen after the photo | **The photo screen's button says "Make my card"** |
| Optional screens on Me | 5 (photos, nights + where, vibe, line, ride) | **3** (photos, nights + where, line) |
| Optional questions asked later | 10 | **2** (your line, where you're going) |
| What sits on top of each card | Knuckle Meter badge | **"Both going Tue"**, only when you share a night |
| Data a guest receives in the peek | Name, college, nights, Knuckle Meter, line, skill, blurred thumb | **Name, college, nights, line, blurred thumb** |

### Removed, and why
| Question | Why it goes |
|---|---|
| **Knuckle Meter** (gentle tap / solid click / knuckle breaker) | A joke, not a decision. Nobody swipes left on a "solid click". It cost a full screen at the most fragile point: right after the photo, just before the card exists |
| **How are you getting there?** (own vehicle, cab, metro, need a ride) + free seats + ride consent | It's about Ride Sharing, not about finding a partner. It also made every card longer. If we want ride intent, ask it **after a match** ("Going together? Split a cab on Picapool"), where it's relevant |
| **Your Dandiya vibe** (skill, style, sticks, outfit) | 4 answers that read as filler on the card and didn't change who people liked |
| **Partner for** (one night / every night) | Already implied by the nights they pick |

### What stays, and what each one earns
| Question | Why it stays |
|---|---|
| Girl / Guy | Decides whose cards you see |
| Nights | The whole product: you only see people going the nights you go. Asked once in the peek, never again |
| Phone + code | Login, and it creates the Picapool account (the real KPI) |
| First name, college | What a card shows. College is the trust signal on North Campus |
| Date of birth + consent | 18+ check (never stored) and DPDP consent. Can't be cut |
| Photo | No photo, no swipe |
| Your line (optional, later) | Gives a match something to reply to. Asked on Me and by a one-time nudge after 6 swipes |
| Where (optional, later) | Ranks same-venue people first in the feed |

### Still worth looking at
- **The photo screen has a lot of empty space** under the three slots. Fine on purpose (one job per screen), but a single line under the slots ("Your face, clearly. Up to 3.") already covers it. Don't add more.
- **"Both going Tue" also shows on blurred peek cards.** It's useful there ("people going my night"), so it stays.
- **Ride intent** is gone from the data. If the Ride Sharing team wants it, add the post-match prompt above rather than bringing the question back into the card.

## Part 2. Accessibility audit
**Standard:** WCAG 2.1 AA | **Date:** 13 Oct 2026 | **Screens:** 17 (landing, peek, preview, gate sheet, phone, code, about you, photo, match, crown-race sheet, feed, matches, board, Me, share sheet, edit nights, edit line)

### Summary
**Issues found:** 16 | **Critical:** 1 | **Major:** 8 | **Minor:** 7 | **Fixed in build g:** 16

**How it was tested:** axe-core 4.10 on all 17 screens at 320, 360, 393, 412 and 1440 px wide (0 violations after fixes; it found 2 before); a script that measures every tap target; keyboard-only runs through peek, sign-up, the gate sheet, the match screen and the delete dialog; contrast computed for every colour pair and all 9 night colours; 320 px reflow check (no sideways scroll on any screen).

### Findings

#### Perceivable
| # | Issue | WCAG Criterion | Severity | Fix shipped |
|---|-------|---------------|----------|-------------|
| 1 | Selected **Red** night chip: dark text on #E0343F was 4.15:1, and cream would be 4.06:1, so no text colour passed | 1.4.3 Contrast | 🟡 Major | The chip's background is deepened just enough (#C62E37) for cream text at 4.99:1. Automatic for any colour |
| 2 | Text colour on night chips was chosen by a brightness threshold, so **Green** got cream text at 3.0:1 | 1.4.3 Contrast | 🟡 Major | Picks whichever text colour has more contrast. Green now 5.62:1 |
| 3 | The card behind the top card was readable by screen readers and its ⋯ button reachable by Tab | 1.3.1 Info and relationships | 🟡 Major | Marked `inert` and hidden from screen readers |
| 4 | Placeholder text at 3.83:1 | 1.4.3 Contrast | 🟢 Minor | Raised to 6.6:1 |
| 5 | Like counters were an icon and a bare number | 1.1.1 Non-text content | 🟢 Minor | Spoken as "3 likes waiting" / "40 likes left today" |
| 6 | Feed, preview and Me screens had no heading | 1.3.1 Info and relationships | 🟢 Minor | Hidden headings added ("People going your nights", "Your card") |

#### Operable
| # | Issue | WCAG Criterion | Severity | Fix shipped |
|---|-------|---------------|----------|-------------|
| 7 | **Sheets and the match screen didn't take focus, didn't keep Tab inside, and didn't close on Escape.** A keyboard or screen-reader user stayed on the page behind | 2.1.2 No keyboard trap / 2.4.3 Focus order | 🔴 Critical | Focus moves into the dialog, Tab cycles inside, Escape closes it, focus goes back to what opened it (or the Like button) |
| 8 | Taps under 44 px: chips 42, filter chips 34, share buttons 38, toggles 34, crown and nudge bar buttons 30 to 36, photo remove 30, card ⋯ 40, "Change" link 21, consent row 39 | 2.5.5 Target size | 🟡 Major | All 44 px or more (photo remove 36, inside its 3-slot grid) |
| 9 | The colour ring spun forever and the lamp flame flickered forever | 2.2.2 Pause, stop, hide | 🟡 Major | Ring turns once on arrival; flame flickers 3 times. All motion stops under "reduce motion" |
| 10 | After closing a sheet opened by keyboard, focus fell to the page body | 2.4.3 Focus order | 🟡 Major | Focus returns to the opener, or to Like |
| 11 | Swiping needed a pointer or the two round buttons | 2.1.1 Keyboard | 🟢 Minor | ← passes, → likes on the peek and feed screens (ignored while typing or when a sheet is open) |
| 12 | The delete dialog focused "Yes, delete" first | 2.4.3 Focus order | 🟢 Minor | "Cancel" gets first focus |

#### Understandable
| # | Issue | WCAG Criterion | Severity | Fix shipped |
|---|-------|---------------|----------|-------------|
| 13 | Phone and code errors weren't tied to their fields | 3.3.1 Error identification | 🟢 Minor | `aria-describedby` links each field to the error, which is also announced |
| 14 | "1 likes waiting" | 3.3.2 Labels or instructions | 🟢 Minor | Correct singular |

#### Robust
| # | Issue | WCAG Criterion | Severity | Fix shipped |
|---|-------|---------------|----------|-------------|
| 15 | Dialogs had `role="dialog"` but no `aria-modal` and no name | 4.1.2 Name, role, value | 🟡 Major | `aria-modal="true"` and named by their heading |
| 16 | Chip groups ("I am a", "Which nights", "Where?") had no group name | 4.1.2 Name, role, value | 🟡 Major | Each group is named after the question above it |

### Color Contrast Check
| Element | Foreground | Background | Ratio | Required | Pass? |
|---------|-----------|------------|-------|----------|-------|
| Body text | #FFF3E6 | #1A0F24 | 16.9:1 | 4.5:1 | ✅ |
| Muted text (hints, college) | #BEAFC3 | #1A0F24 | 8.9:1 | 4.5:1 | ✅ |
| Muted text on raised panels | #BEAFC3 | #322242 | 7.0:1 | 4.5:1 | ✅ |
| Main button label | #1C0C04 | #FF6B22 | 6.7:1 | 4.5:1 | ✅ |
| Orange link | #FF6B22 | #1A0F24 | 6.5:1 | 4.5:1 | ✅ |
| Error text | #FF6B74 | #1A0F24 | 6.7:1 | 4.5:1 | ✅ |
| Gold crown title | #F4C24D | #1A0F24 | 11.1:1 | 3:1 (large) | ✅ |
| Crown bar text | #2A1A00 | #F4C24D | 10.2:1 | 4.5:1 | ✅ |
| "Your line" on card | #1A0F24 | #F2E6D8 | 15.0:1 | 4.5:1 | ✅ |
| Placeholder | cream 60% | #1A0F24 | 6.6:1 | 4.5:1 | ✅ (was 3.8) |
| Night chip: Orange / White / Yellow / Grey | #1A0F24 | night colour | 7.2 / 18.5 / 12.7 / 7.0 | 4.5:1 | ✅ |
| Night chip: Green / Peacock green | #1A0F24 | #1FA34A / #0E9A8C | 5.6 / 5.3 | 4.5:1 | ✅ (Green was 3.0) |
| Night chip: Royal blue / Purple | #FFF3E6 | #2346C8 / #7A3BD1 | 6.9 / 5.7 | 4.5:1 | ✅ |
| Night chip: Red | #FFF3E6 | #C62E37 (deepened) | 5.0:1 | 4.5:1 | ✅ (was 4.15) |

### Keyboard Navigation
| Element | Tab Order | Enter/Space | Escape | Arrow Keys |
|---------|-----------|-------------|--------|------------|
| Landing | See who's going → Log in | Starts peek / log in | — | — |
| Peek chips | Back → Girl → Guy → nights in date order → Continue | Selects | — | — |
| Swipe card (peek, feed) | Pass → Like → Make my card / nav | Pass or like | — | ← pass, → like |
| Gate sheet | Make my card ↔ Keep peeking (trapped) | Activates | Closes, focus to Like | Swipe keys ignored while open |
| Match screen | Plan it on Picapool chat → Share numbers → Keep swiping (trapped) | Activates | Keep swiping, focus to Like | — |
| Delete dialog | Cancel first, then Yes, delete (trapped) | Activates | Closes, focus back to Delete | — |
| Bottom nav | Swipe → Matches → Board → Me | Switches tab | — | — |
| Focus ring | 2 px gold outline, 3 px offset, on every control | | | |

### Screen Reader
Read from the accessibility tree in Chromium; not yet tried on a real phone.
| Element | Announced As | Issue |
|---------|-------------|-------|
| Like counter (peek) | "3 likes waiting, image" | Fixed (was "3") |
| Steps | "Step 2 of 3, image" | — |
| Night chips | "Tue 13, toggle button, pressed" inside group "My nights" | Fixed (group had no name) |
| Gate sheet | "3 likes waiting, dialog" | Fixed (was unnamed, not modal) |
| Match screen | "Partner mil gaya!, dialog" | Fixed |
| Card ⋯ button | "Report or block Meher, button" | — |
| Card stamps "DANCE?" / "PASS" | Hidden | Decorative |
| Card behind the top card | Hidden | Fixed (was read twice) |
| Toasts ("Saved", "Your 2 likes were sent") | Announced politely | — |
| Errors | Announced, and tied to the field | Fixed |

### Priority Fixes
All 16 are fixed in build g. Two things are left for a person to check:
1. **10 minutes with TalkBack on an Android phone and VoiceOver on an iPhone** before the public push. Peek → like → make a card → match. Automated tools and keyboard tests catch most issues, but not all.
2. **Keep it this way.** HANDOFF §13 lists the rules the tech team must not undo: 44 px targets, the night-chip contrast helper, and dialog focus handling.

## Tests run on build g
- `npm test`: **62 checks pass**, including: a card needs only a photo and nights, and the guest peek sends only name, college, nights, line and the blurred thumbnail.
- Two strangers, peek to match, on the real server: likes sent on card creation, match, chat opened, Me shows 3 rows, Escape closes the delete dialog, under-18 blocked. **0 console messages.**
- Demo in the artifact sandbox at 393, 360 and 1440 px: fills the screen, no sideways scroll, **0 console messages**.

# Design Critique: Stick Together (build 2026-10-13-b)
Mobile web app, final polish stage. Audience: North Campus students opening a link from WhatsApp at night during Navratri. Reviewed on every screen at 360×640, 393×873 and 1440×900.

## Overall Impression
It works, but it looks like a form, not a festival. Every element has the same thick black border and hard shadow, so nothing stands out. The cream-and-orange look is the intent form's look and says nothing about Navratri. And the one moment people would screenshot, the Garba Queen/King crown, is a plain orange square with a tilted photo.

## Usability
| Finding | Severity | Recommendation |
|---|---|---|
| A crown is only discoverable by opening the Board tab and scrolling to "You're #1". Nobody is told they ranked | 🔴 Critical (it kills the viral loop) | Show a crown banner on the Swipe tab, a crown button on the Me tab and a dot on the Board tab as soon as someone is in tonight's top 10 |
| Sharing the crown means: tap "Show off your crown", read a text box, then tap a small "Make a status image instead" link. The image is the thing people want, and it is the third option | 🔴 Critical | The crown opens straight to the story image with one big "Post to story" button (Instagram and WhatsApp status both come from the phone's share sheet), "Save image", and "Copy link for the Link sticker" |
| Instagram stories need a link sticker for the link to be tappable. Nothing tells people to add one or hands them the link | 🟡 Moderate | "Copy link" button with the toast "Link copied. Add it with Instagram's Link sticker" |
| Disabled Continue buttons are pale orange with a full shadow, so they read as broken rather than "not yet" | 🟡 Moderate | Disabled = flat surface colour, muted text, no shadow |
| The nights screen is a wall of 7 identical outlined pills, then 5 venue pills, then 2 more. Selected chips turn solid black and compete with the CTA | 🟡 Moderate | Lighter unselected chips; a selected night fills with that night's own colour; a selected option gets a tinted fill instead of black |
| "Who's going" and the top-3 boxes on the landing page have equal weight to each other and to the CTA | 🟢 Minor | Make "who's going" a borderless stat line; keep one quiet surface for the crowns |

## Visual Hierarchy
- **What draws the eye first:** the crossed-sticks clip art and the black-bordered boxes. **Not correct:** the headline and the CTA should come first.
- **Reading flow:** tag → art → headline → box → box → button. Four stacked rectangles of the same weight make the eye stop four times.
- **Emphasis:** the 2px ink borders and hard shadows sit on buttons, chips, cards, panels, toggles, inputs and pills alike. When everything is emphasised, nothing is. The feed card (the core screen) has five bordered or pill elements over the photo: knuckle badge, ⋯ button, SAMPLE tag, prompt bubble and tag pills.
- **Type:** Poppins 800 does every job, from headline to card name to crown. No face carries the festival.

## Consistency
| Element | Issue | Recommendation |
|---|---|---|
| Borders | Same 2px ink border on interactive and non-interactive elements (panels look tappable) | Hairline borders for surfaces; reserve solid fills for actions |
| Shadows | Hard offset shadow on buttons, cards, panels, selected pills and podium | Shadow only on the primary CTA and the swipe card |
| Colour | Orange appears on the CTA, progress bar, tags, selected gender pill, ride pill, rank badges, crown card, badges and the match screen. It no longer marks "the action" | Orange = actions and brand only. Gold = crowns. Tonight's Navratri colour = ambient festive accent |
| Subject | The nine Navratri colours exist in the data and appear only as 12px dots | Make tonight's colour the app's ambient glow, which changes every night. No other app would have this |
| Share images | Partner card and crown card use the same orange template; the crown isn't special | A dedicated crown poster: night background, gold title, photo in an arch (jharokha) frame, rank medallion |

## Accessibility
- **Colour contrast:** white text on #FF6B22 orange buttons is about 2.9:1, which fails WCAG AA for 16px text. Muted grey #6B5D54 on cream passes (6.2:1).
- **Touch targets:** buttons, chips (42px) and nav items (56px) pass. The "Change" link on the OTP screen and the inline "Skip" are small. The ⋯ report button is 40px (acceptable).
- **Text readability:** body 14.5px with 1.45 line height is good. 11px tips on the feed card ("Tap here for more") at 70% opacity are hard to read.
- **Alt text:** decorative images use empty alt; logo has alt. Fine.

## What Works Well
- The flow is short and every screen has one clear job; the Continue button is always visible.
- The Knuckle Meter badge and the "your line" bubble give each card a personality that dating-app cards lack.
- The plan-the-night message bubble is clear and useful.
- Picapool's orange and Poppins are already applied consistently, which is a good base to restyle from.

## Priority Recommendations
1. **Make the crown flauntable.** Detect top-10 status and say so everywhere (banner, Me tab, Board dot). Ship a story-ready crown poster with one-tap "Post to story", "Save" and "Copy link for the sticker". This is the viral loop.
2. **Give it a Navratri identity.** A night palette (deep aubergine), tonight's colour as the ambient glow, gold for crowns, mirror-work dot texture, and a festive display face (Yatra One) for big moments only. Keep Picapool orange for actions and Poppins for everything else.
3. **Strip the chrome.** Remove the borders and shadows from everything except the primary action and the swipe card. Use hairline surfaces for panels and tinted fills for selected chips. Night chips fill with their own colour when selected.
4. **Fix contrast:** dark text on orange buttons (about 7:1).
5. **Replace the clip-art hero** with a "garba circle": nine dots in the nine night colours orbiting slowly, tonight's dot highlighted.

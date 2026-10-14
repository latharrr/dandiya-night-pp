# Stick Together: Onboarding Teardown and Fix
13 Oct 2026 · Build `2026-10-13-e` · Owner: Purav

## 1. The problem, in numbers
| | Before (build d) | Now (build e) |
|---|---|---|
| Screens before seeing a single person | **11** (landing, number, code, about you, photos, nights, vibe, Knuckle Meter, line, ride, crown race) | **2** (landing, "I am a" + nights) |
| When we ask for the phone number | Screen 2, before any value | After they have browsed and liked people |
| Screens to make a card | 10 | **4** (number + code, about you, photo, Knuckle Meter) |
| Questions to make a card | 19 | **9** |
| What pulls people through sign-up | Nothing visible | Their own likes, which are waiting to be sent ("♥ 3 likes waiting") |
| Optional details (line, vibe, venue, ride, crown race) | Required, in the way | Asked later: a checklist on Me, a one-tap nudge, and the crown race as a sheet after the card is made |

## 2. How others handle it
| Product | Order | What we take from it |
|---|---|---|
| Tinder, Hinge, Bumble | Account and profile first, then browsing | Showing faces to anonymous people is a safety risk in a two-sided product. **We keep faces locked for guests.** |
| Partiful | The guest list is hidden until you RSVP | A small commitment unlocks the social proof. **Our "unlock" is making the card.** |
| Timeleft | Sign in first, then the personality test, then booking | The research list described it as activity-first, but its own help page shows sign-in comes first. It is not a model for value-before-login |
| Duolingo | You try a lesson before signing up | Moving the sign-up screen a few steps later produced about **20% more daily active users** |

**Our hybrid:** browse real people first (Duolingo), with faces locked until you make a card (Partiful's unlock, Tinder's safety). Your likes are held until then, so making the card has an immediate payoff.

## 3. The new flow
```
Landing ──"See who's going"──► Peek (I am a + nights, 2 taps)
   │                                │
   └─"Already made your card? Log in"──► Number + code ──► feed
                                    ▼
                     Preview: real cards, faces blurred, swipe freely
                     ♥ likes held on the phone (max 10)
                     After 3 likes or 12 cards: "Your 3 likes are waiting" sheet
                                    ▼
             Make my card: 1 number+code · 2 about you · 3 photo · 4 Knuckle Meter
                                    ▼
             Feed opens → likes sent automatically → any match shows instantly
             → one-tap sheet: "Race for Garba Queen/King?"
                                    ▼
             Later, from Me → "Your card": line, vibe, nights+where, ride (Add / Edit)
             After 6 swipes without a line: "Add your line" nudge on the feed
```

## 4. Guardrails
- **Guests never receive photos.** The preview gets an 18×22-pixel colour thumbnail, shown heavily blurred, plus first name, college, nights, Knuckle Meter, line and skill. No photo URLs, phones or venues. Checked in the tests.
- The consent line on "About you" now says guests can see first name, college and answers, never photos.
- 18+ is still checked before a card exists; under-18 attempts are deleted.
- Pending likes go through the normal swipe rules (daily cap, blocks) once the card exists.

## 5. What to measure (events already sent)
`landing_view → cta_start → peek_start → peek_swipe → peek_gate → peek_to_signup → otp_sent → otp_verified → account_created → photos_done → profile_done → pending_likes_sent → match`
- **Peek-to-card rate:** `profile_done` ÷ `peek_start`. This is the number the change should move.
- **Where people stop:** the step with the biggest drop between consecutive events.
- **Likes-before-signup effect:** compare card completion for people with 0 vs 1+ pending likes (`peek_to_signup.likes`).

## 6. Hallway test before the public push (tonight or tomorrow morning)
**Who:** 5 North Campus students who haven't seen it, at least 2 girls. Their own phones, opening the link from WhatsApp.
**Time:** 10 minutes each. One person runs it, one takes notes. Don't help; ask them to think aloud.

| Task | Say | Watch for |
|---|---|---|
| 1 | "A friend sent you this link. What is it?" | Do they understand it within 5 seconds of the landing page? Do they tap "See who's going"? |
| 2 | "Find someone you'd want to dance with." | Do they understand the blurred faces? Do they swipe, or look for buttons? |
| 3 | "Make sure that person knows." | Do they find "Make my card"? Do they hesitate at the phone number? |
| 4 | Let them finish the card | Time it (target under 90 seconds). Note any field they question, especially date of birth and photo |
| 5 | "Would you join the Garba Queen/King race? Why?" | Willingness, and any worry about being ranked |
| 6 | "Would you share this? Where?" | WhatsApp status, Instagram story, a group chat, or nowhere |

**Ship as-is if** 4 of 5 make a card without help and nobody gets stuck at the same spot. **Fix first if** two or more get stuck at the same step.

Sources: [Duolingo delayed sign-up A/B test (Taplytics)](https://taplytics.com/blog/duolingo-ab-test-onboarding) · [Timeleft: How do I sign up](https://help.timeleft.com/hc/en-150/articles/27949221711132-How-Do-I-Sign-Up) · [Things I hate about Partiful (guest list hidden until RSVP)](https://worldspiritsockpuppet.substack.com/p/things-i-hate-about-partiful)

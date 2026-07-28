# CreditCoachIQ Client Portal — Design Direction (v2)

Superseding the earlier dark/gold direction. Updated brief: easy on the eyes, generous white space, green to represent money, and it should look like something Apple would build. This is the direction for `app/portal/[token]/*` and the coach-facing dashboard.

## Reference point

Think Apple's own product pages and Health/Wallet apps, or Mercury's light mode — not a finance dashboard, not a credit-repair SaaS tool. The category default (Credit Repair Cloud, DisputeFox, CDM) is dense, blue-and-white utility software. The move here is restraint: a mostly-white canvas, one confident green accent, huge breathing room, and content that isn't fighting for attention because there isn't much of it on screen at once.

## Palette

Light-first, not dark:

- Base: near-white (`#FAFAF9`, a hair warmer than pure white — pure white against white cards reads sterile)
- Card surfaces: pure white (`#FFFFFF`) with a hairline border (`#E8E7E3`), no shadow needed at rest — shadow only on hover/lift for interactive cards
- Primary accent — money green: `#0F9D58`-family. Use a true, confident green (not mint, not sage) so it reads as "growth/money" rather than "eco/wellness." Hover/active state a shade darker (`#0C7A45`)
- Success/positive states (score up, milestone hit): same green family, lighter tint for backgrounds (`#E6F4EC`)
- Text: near-black (`#1D1D1F` — Apple's own text color, not pure `#000`) for primary, warm gray (`#6E6E73`) for secondary
- No dark mode as default — this flips the prior direction. Dark mode can exist as a toggle, but light is the primary experience.

## Typography

- One family, San Francisco/system-native feel: SF Pro if licensed, Inter as the practical substitute — Apple's actual trick isn't an exotic font, it's disciplined use of a plain one.
- Numbers get slightly larger, tighter letter-spacing, medium weight — not a separate serif family this time (that was the luxury-gold direction; the Apple direction is single-family discipline, not editorial contrast).
- Scale: big, confident headline numbers (36–48px) for the one thing that matters on a screen (score, capital, days-to-ready), small supporting labels (13px, gray) — nothing in between competing for attention.
- Two weights only: regular and medium. Never bold-everything.

## The Apple feel, concretely

- **One idea per screen.** Apple product pages don't cram five stats into a viewport — they show one hero number, one supporting line, generous margin, then the next idea on scroll. Translate that to the portal: the score is the hero of its own card, not squeezed next to three other stats.
- **Real whitespace, not padding as an afterthought.** Minimum 24–32px around every card, 48px+ between sections. If it feels like there's "too much empty space," that's the point.
- **Green used sparingly, like Apple uses blue.** One primary action per screen in green. Everything else is white/gray/outline. Green everywhere stops meaning "money" and starts meaning "generic app."
- **Motion is a single, precise animation, not decoration.** A number counting up, a card that lifts 2px on hover, a checkmark that draws itself when a task completes. Nothing bounces, nothing spins for effect.
- **Icons are thin-line, not filled.** Consistent stroke weight throughout (this matches SF Symbols' actual design language).
- **Rounded corners, consistently** — 16–20px on cards, matching the soft-but-precise geometry Apple uses on iOS/macOS surfaces.

## Personalization within this restraint

The "personalized but automated" requirement from the first brief still applies — it just expresses through fewer, more confident elements instead of a dense dashboard:

- The coach's name appears once, prominently, near the top — not buried in a sidebar.
- Milestones (score crossing a threshold, an application approved) get their own full-width moment — a dedicated card that appears once, celebrates once, then recedes into history, rather than a toast that flashes and disappears.
- Every number is still computed fresh per client (unchanged from v1 — this is a data-layer property, not a visual one).

## Layout principles

- Single-column on mobile, generous two-column max on desktop — never a dense grid.
- The credit score is still a circular/radial visual, but rendered thin and precise (a single green arc on white, not a filled gauge) — closer to an Apple Watch activity ring than a car dashboard.
- Exactly one primary green button per screen.
- Mobile-first: most opens will be from a text link on a phone.

See the rendered mockup for how this translates to an actual dashboard layout.

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

## v3 addendum — richer fintech direction (flagship screens)

Triggered by explicit user feedback after launch: the v2 restraint read as
under-built for a tool meant to feel like DisputeFox + a private financial
coach combined into one "elite" experience. Confirmed direction: keep the
v2 palette and tone (still light-first, still one confident green, still no
dark-mode-by-default) but add the data-forward polish v2 deliberately left
out — closer to Mercury/Ramp's balance-card pattern than Apple Health's
restraint. Applied first to the two screens people actually live in: the
client portal overview and the coach's caseload + client-detail pages.
Rolling out to the rest of the dashboard (campaigns, templates, analytics,
credit reports, referral partners) is the next pass.

**What changed, concretely:**

- **A dark "hero" card per flagship screen** (`bg-gradient-dark`, near-black
  `#111113` → `#1C1D20`) carrying the one thing that matters most on that
  screen — the client's own score and greeting on the portal, the coach's
  view of a specific client on the detail page. This is new: v2 had no dark
  surface anywhere. Used sparingly — one hero per screen, not a dark app.
- **`RadialScore`** (`components/ui/RadialScore.tsx`) — a real gradient-
  stroke progress ring (green gradient, animates in on mount), replacing the
  flat "score / target" number pair. A small gold marker shows the target
  score on the track when one exists.
- **`Sparkline`** (`components/ui/Sparkline.tsx`) — a real trend line built
  from `credit_report_uploads` score history (one point per parsed report).
  Deliberately renders nothing below 2 data points rather than faking a
  trend — this app doesn't fabricate data, a new client just won't see a
  sparkline yet.
- **A second accent color, iris** (`#6C5CE7`, violet) — used for the
  "premium/coaching" side of stat cards (calls, stacking) so the whole UI
  doesn't lean on green for everything the way v2 did. Green still means
  "money," iris now means "your coaching relationship."
- **`gold` (`#C9A05C`)** — a warm highlight reserved for milestone/target
  markers and one "funding status" stat tile, not used as a primary color
  anywhere.
- **`StatCard`** (`components/ui/StatCard.tsx`) — the shared gradient-tile
  primitive behind all of the above; every instance is fed real numbers
  from an API response already being fetched for that page (stacked
  capital from `credit_stack_applications`, caseload counts derived from
  the coach's own client list, etc.) — no new mock data anywhere.
- **Real bug found and fixed while wiring this**: the portal overview API
  (`app/api/portal/[token]/overview/route.ts`) selected `name`/
  `progress_amount` from `financial_goals`, but the actual schema
  (migration 0002) is `title`/`current_amount` — every goals-list fetch
  silently failed and returned nothing. Fixed as part of this pass since
  the redesigned goals card needed the real field names anyway.

**Still v2, unchanged:** typography scale and weight discipline, card
corner radius (20px), the underlying `paper`/`ink`/`muted`/`line` tokens,
one-primary-action-per-screen. The richer direction adds data density and
one dark surface per screen — it doesn't abandon the restraint everywhere
else.

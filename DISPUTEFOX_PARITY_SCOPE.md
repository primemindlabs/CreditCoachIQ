# DisputeFox Parity — Full Build Scope

Scoping pass for every gap identified in the DisputeFox comparison (see `GAP_ANALYSIS_AND_COMPETITORS.md` for the original competitive table — this doc supersedes several of its findings now that the codebase has moved on: **SMS, a dialer, referral tracking, and single-letter Lob mail are already built**, which changes what's actually left to do). Each section below reflects the real current state, not the marketing-page assumption.

No code in this pass — this is the plan to work from.

---

## Priority summary

| # | Feature | Current state | Scope size | Priority |
|---|---|---|---|---|
| 1 | Pre-enrollment leads/intake pipeline | Doesn't exist | Large | **P1** |
| 2 | True two-way SMS threading | Outbound-only today | Medium | **P1** |
| 3 | Dialer surfaced in UI | Backend exists, no UI | Small | **P1** |
| 4 | Bulk dispute letter batch print & mail | Single-letter send exists | Medium | **P1** |
| 5 | Self-serve affiliate/referral portal | Commission tracking exists, no partner login | Medium-large | **P2** |
| 6 | Pay-per-delete billing model | Subscription-only today | Medium | **P2** |
| 7 | Branded mobile app (or PWA) | Doesn't exist | Large (native) / Small (PWA) | **P2 as PWA, P3 as native** |
| 8 | POA e-notarization | Doesn't exist | Very large (third-party notary network) | **P3 — recommend skip** |

Rationale for the P1 cluster: these four are the ones that would actually change a coach's daily workflow, they're the closest to code you already have (SMS, dialer, and Lob letters all have working backends — this is finishing what's started, not new integrations), and they map to real operational pain (no top-of-funnel means every lead currently gets entered as a full borrower by hand; no bulk mail means multi-round dispute cycles are manual one-letter-at-a-time work).

---

## 1. Pre-enrollment leads/intake pipeline

**Current state:** `borrowers` only exist post-enrollment. There's no stage before that — a prospective client has nowhere to live in the system until a coach manually creates their record. `referred_by_partner_id` and the quiz/booking flow (`credit_quiz_*`, migration 0004) partially cover pre-enrollment *engagement*, but there's no leads list, no status pipeline, no agent assignment, no "hotness" triage the way DisputeFox has it.

**What to build:**
- New table `leads`: `org_id`, `first_name`, `last_name`, `email`, `phone`, `source` (referral partner / quiz / manual / web form), `referred_by_partner_id`, `assigned_to` (profile), `status` (`new` → `contacted` → `qualified` → `converted` → `lost`), `interest_level` (`hot`/`warm`/`cold`, coach-set not AI-guessed — keep it deterministic and coach-controlled like the rest of the system), `last_contacted_at`, `notes`, timestamps.
- `leads_activity_log`: append-only touch history (call, SMS, email, note) — same audit-log pattern as `portal_access_log`/`referral_commission_events` (INSERT-only RLS).
- Convert-to-client action: `POST /api/leads/[id]/convert` — creates the `borrowers` row, carries over `referred_by_partner_id`, marks lead `converted`, links `converted_borrower_id` back onto the lead row for traceability.
- Coach UI: `/leads` list page mirroring `/caseload`'s existing StatCard + filterable-table pattern (you already have this exact shape built twice — caseload and complaints — so this is largely reusing established components), plus a lead detail drawer/page for notes and status changes.
- Intake source: the quiz (`credit_quiz_responses`) should create a `leads` row instead of requiring a coach to manually convert a quiz-taker today — check `lib/quiz` for where that currently terminates and wire it in.
- Optional, deferred: public web form embed for a marketing site to POST directly into `leads` (would need a rate-limited, unauthenticated `POST /api/leads/intake` endpoint with strict field validation — real spam-surface, don't build until there's an actual marketing site driving traffic to it).

**Estimate:** 1 migration, 4-5 API routes, 2 UI pages. Comparable in size to the Today/Inbox build you just finished.

---

## 2. True two-way SMS threading

**Current state:** `lib/sms.ts` sends outbound only, consent-gated. There's no Twilio inbound webhook, so a client reply currently goes nowhere — it just arrives at a Twilio number nobody's watching in-app.

**What to build:**
- `POST /api/webhooks/twilio/inbound` — Twilio's inbound SMS webhook (signature-verified, matching the Stripe webhook's verification pattern). Writes to a new `sms_messages` table (`org_id`, `borrower_id`, `direction`, `body`, `twilio_sid`, `status`, `created_at`) instead of the existing one-way send log if one exists — check `lib/sms.ts` for whether outbound sends are already logged anywhere; if not, that log needs building too.
- Borrower resolution: match inbound `From` number against `borrowers.phone`, scoped by the Twilio number's org (multi-org number pool — check whether you're on a shared Twilio number or per-org numbers before assuming this lookup is a single query).
- Coach UI: an SMS thread view, most naturally added as a tab/panel on the existing `/caseload/[borrowerId]` page next to the Notes/Tasks/Calls panels you already built there — same visual pattern (bordered card, timestamped list), plus a compose box that posts to the existing outbound send function.
- Today/Inbox integration: unread inbound SMS should show up in `/today` the same way unread portal messages already do — `api/coach/today/route.ts` already has the shape for this, it's an additional parallel query, not a new pattern.
- Compliance note: this is a TCPA consent surface exactly like existing outbound SMS — reuse whatever consent-gate logic already guards `lib/sms.ts`'s send path.

**Estimate:** 1 migration (or extend an existing messages table if one already logs outbound), 1 webhook route, UI panel + Today integration. Medium — mostly because Twilio webhook signature verification and number-to-borrower resolution need care, not because there's a lot of surface area.

---

## 3. Dialer surfaced in the UI

**Current state:** `app/api/coach/dialer/route.ts` and `call_logs` (migration 0009) already exist — the backend for click-to-call and call logging is real and working. There's no UI entry point anywhere that calls it.

**What to build:**
- A click-to-call button/icon next to phone numbers on `/caseload/[borrowerId]` and `/leads` (once #1 exists) — small UI addition, not new logic.
- A lightweight "log this call" panel after a call completes (outcome, duration if not already captured via Twilio status callback, notes) — likely a modal, reusing the sticky-note-style floating pattern DisputeFox uses if you want something closer to their UX, or just an inline form matching your existing Notes panel.
- Call history: `call_logs` already has everything needed to render a "Recent calls" list next to the SMS thread from #2 — natural to build these two together since they'll live on the same page.

**Estimate:** Smallest item on this list. No migration needed, 1-2 small UI additions reusing existing components.

---

## 4. Bulk dispute letter batch print & mail

**Current state:** Task #33 wired single dispute-letter generation + Lob send. There's no batch layer — sending a full round of letters across multiple bureaus/creditors for one client (or across multiple clients) means repeating the single-send flow manually each time.

**What to build:**
- `POST /api/coach/disputes/batch-send` — accepts an array of `credit_dispute` IDs (or a filter: "all drafted, unsent letters for enrollment X"), loops the existing single-send Lob call, returns per-letter success/failure (Lob sends aren't atomic as a batch — partial failure is normal and needs surfacing, not swallowing).
- UI: on the dispute-management view (wherever individual letters are currently reviewed/approved — check the existing dispute UI under `/caseload/[borrowerId]` or a dedicated disputes page), add multi-select + a "Send selected" bulk action, matching the same human-approval-gate principle already established (nothing auto-sends without a coach action).
- Batch status tracking: a lightweight `letter_batches` table (`id`, `org_id`, `created_by`, `letter_count`, `sent_count`, `failed_count`, `created_at`) if you want batch-level visibility; optional if per-letter status on `credit_disputes` is enough.
- Certified mail + tracking: confirm whether the existing single-send Lob call already requests certified mail with tracking — if it's currently standard mail, that's a one-field change (`mail_type: 'certified'` in the Lob payload) worth doing regardless of the batch work, since DisputeFox's live-tracking claim is really just this.

**Estimate:** No new integration (Lob's already wired) — this is a loop + a bulk-action UI + failure handling. Medium, mostly because partial-failure UX needs to be done right.

---

## 5. Self-serve affiliate/referral partner portal

**Current state:** `referral_partners` and `referral_commission_events` exist and are solid (append-only commission audit trail, single-touch attribution) — but only coaches/admins can see any of it, via `/referral-partners`. A partner has no login and no way to check their own referral count or what they're owed without asking a coach.

**What to build:**
- Reuse the borrower portal's token-auth pattern (`lib/portal/token.ts`) rather than building new auth — a `referral_partners.portal_token` (hashed, like the borrower token) generated on partner creation, emailed to the partner, same magic-link + optional MFA-step-up shape already proven out.
- `GET /api/partner-portal/[token]/overview` — referral count, converted count, commission owed vs. paid, pulling straight from `referral_commission_events` (already append-only and accurate — no new source of truth needed).
- UI: a single-page partner view, much lighter than the borrower portal (no goals/tradelines/chat) — overview stats + a referral list + a commission history table. Can reuse `StatCard` and the portal shell's visual language directly.
- **Explicitly not in scope for this pass:** automated payouts (DisputeFox does PayPal/Stripe Connect payouts). That's a real payments-infrastructure project on its own — recommend commission events stay coach-marked-as-paid manually until partner volume justifies automating disbursement.

**Estimate:** Medium-large mainly because it's a second portal surface, but the auth and visual patterns are both already proven — this is assembly, not invention.

---

## 6. Pay-per-delete billing model

**Current state:** Billing is Stripe subscription-only (`credit_repair_enrollments` + Stripe customer/subscription, migration 0012's dunning fields). Pay-per-delete — charging per successfully removed negative item instead of (or blended with) a flat monthly fee — doesn't exist as a billable event.

**What to build:**
- `enrollments.billing_model` column: `subscription` / `pay_per_delete` / `hybrid`.
- A billable event fires when a `credit_disputes.response_status` transitions to `item_removed` (you already detect this exact transition for the score-explainer AI feature — same trigger point, second consumer). On that transition, for `pay_per_delete`/`hybrid` enrollments, create a Stripe one-off invoice item (`stripe.invoiceItems.create`) at a per-deletion rate stored on the org or plan tier.
- Coach-facing visibility: surface pending/invoiced per-deletion charges on the existing billing panel you already built into `/caseload/[borrowerId]` (task #61) — additive to what's there, not a new panel.
- **Compliance flag, not optional:** CROA's advance-fee ban (already documented in `STRATEGY.md`) generally makes pay-per-delete *more* compliant than upfront subscription billing in some states, but state-by-state rules vary and `state_compliance_status` is still a schema placeholder per the gap analysis — this billing model should not ship live in any state until that enforcement gate is real, not just scoped.

**Estimate:** Medium. The billing logic itself is a moderate lift; the compliance gate it depends on is the actual blocker and should be sequenced first.

---

## 7. Branded mobile app

**Current state:** Web portal only, responsive but not installable.

**Recommendation: build a PWA (installable web app), not a native app, for this phase.** DisputeFox's mobile app is a real differentiator, but a native iOS/Android app is a categorically bigger project (App Store/Play Store review, native push infrastructure, a separate release cycle) than anything else on this list, and most of what clients actually want from it — home-screen icon, push-style notifications, the existing portal UI at app size — is achievable with a PWA manifest + service worker on top of the portal you've already built.

**What a PWA pass looks like:**
- `manifest.json` (org-branded icon/name — this can even be per-org if you want true white-labeling, matching the "your own logo" branding DisputeFox advertises), service worker for offline shell caching, "Add to Home Screen" prompt on the portal.
- Web Push (not SMS) for score-update/message notifications, using the Push API + a `push_subscriptions` table per borrower — genuinely new infrastructure, but self-contained and doesn't require app-store distribution.
- No native camera/document-upload change needed — the portal's existing document upload already works fine in a mobile browser wrapper.

**Native app** stays a real future option once there's a client base large enough to justify the ongoing app-store maintenance cost — flagging as P3, not ruling out.

---

## 8. POA e-notarization

**Current state:** Doesn't exist. Not aware of anything in the schema that touches this.

**Recommendation: skip, or defer indefinitely.** This is DisputeFox's most niche feature (solving a specific "stall letter" problem tied to their letter-dispute volume) and would require integrating a live video notary network (e.g., Notarize/Proof, Pandadoc Notary) — a real vendor contract, a compliance review of notary-state-licensing rules, and a UI flow with no reuse from anything else in the system. Effort-to-value here is the worst on this list. Only worth reconsidering if EquityNest starts hitting POA-related stall-letter friction often enough that coaches are asking for it by name.

---

## Suggested sequencing

**Phase 1 (P1 cluster — do together, they touch the same pages):** dialer UI (#3) → two-way SMS (#2) → bulk letter send (#4) → leads pipeline (#1). Dialer and SMS land on the same `/caseload/[borrowerId]` panel, so building them back-to-back avoids re-touching that page twice. Leads is the biggest of the four and stands alone — good candidate to do last in this phase or in parallel if you want to split work.

**Phase 2:** affiliate portal (#5) and pay-per-delete billing (#6) — both medium-large, both benefit from Phase 1 being done first (affiliate portal wants leads data flowing in for accurate attribution stats; pay-per-delete wants the state-compliance gate finished, which is its own prerequisite work).

**Phase 3:** PWA (#7) once there's a real client volume signal that mobile matters enough to invest in push infra. Notarization (#8) — revisit only if requested.

---

Say which item you want scoped down to an actual migration + route list (mirroring how #59-#74 got built), or which Phase-1 item to start building first.

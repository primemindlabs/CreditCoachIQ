# CreditCoachIQ — Extraction Notes

Extracted from `conduit-next`'s credit-repair module. This document tracks what's
been ported, the architecture decisions made, and what's still left to bring over.

## Architecture decision: how this project is independent

CreditCoachIQ has **its own Supabase project** and **its own Clerk app** — it does
not read conduit-next's `organizations`, `profiles`, or `leads` tables.

Since there's no local `leads` table, every place that referenced `leads(id)` in
conduit-next now references a new local table, **`borrowers`** — a denormalized
record (name/email/phone) keyed to an optional `external_lead_id` +
`external_source` (e.g. `'conduit-next'`). This means:

- CreditCoachIQ runs fully standalone: an agent can enroll a borrower by hand
  through the UI, no CRM required.
- It can *also* be fed by conduit-next (or any CRM): call `POST /api/enroll`
  with the borrower's name/email/phone and pass `externalSource` +
  `externalLeadId` so re-enrollment attempts stay idempotent.
- `lib/integrations/conduit-client.ts` is an optional bridge if you later want
  CreditCoachIQ to pull live contact-info refreshes from conduit-next. It's
  inert (no-op) until `CONDUIT_API_BASE_URL` / `CONDUIT_API_KEY` are set —
  conduit-next doesn't currently expose those integration endpoints, so
  you'll need to add `GET /api/integrations/leads/:id` and
  `POST /api/integrations/credit-coach-events` there if you want this live.

Billing (Stripe) and credit-monitoring vendor webhooks are **new, independent
accounts** — nothing here reuses conduit-next's Stripe keys or webhook secrets.

## ✅ Ported and adapted

| New path | Ported from (conduit-next) | Change |
|---|---|---|
| `supabase/migrations/0001_init_credit_coach_schema.sql` | `20260606_sprint3_credit_repair.sql`, `20260609_phase47_credit_alerts.sql`, `20260604_origination_suite.sql` (credit tables only) | `lead_id` → `borrower_id`; added local `organizations`/`profiles`/`borrowers` |
| `lib/supabase/{admin,server,client}.ts` | same paths | unchanged |
| `lib/auth/orgContext.ts` | same path | unchanged in shape, now resolves against CreditCoachIQ's own tenants |
| `lib/stripe.ts` | `lib/stripe.ts` | unchanged |
| `lib/creditAlerts/normalize.ts` | same path | unchanged |
| `lib/creditAlerts/rateReengagement.ts` | same path | unchanged |
| `lib/creditAlerts/pipeline.ts` | same path | looks up `borrowers` instead of `leads`/`profiles` |
| `lib/integrations/conduit-client.ts` | — new — | optional API bridge, see above |
| `app/api/enroll/route.ts` | `app/api/credit-repair/enroll/route.ts` | accepts borrower contact info directly instead of looking up a `leads` row |
| `app/api/overview/route.ts` | `app/api/credit-repair/overview/route.ts` | joins `borrowers` instead of `leads` |
| `app/api/settings/route.ts` | `app/api/credit-repair/settings/route.ts` | org resolution via `getOrgContext()` |
| `app/api/credit-monitoring/route.ts` | same path | `lead_id` → `borrower_id` |
| `app/api/credit-alerts/[id]/route.ts` | same path | `lead_id` → `borrower_id` |
| `app/api/webhooks/stripe/route.ts` | `app/api/webhooks/stripe-credit-repair/route.ts` | renamed, reads `STRIPE_WEBHOOK_SECRET` (its own account, not `STRIPE_CREDIT_REPAIR_WEBHOOK_SECRET`) |
| `app/api/webhooks/credit-alert/route.ts` | same path | unchanged logic, downstream tables now use `borrower_id` |

## ⏳ Not yet ported — still lives only in conduit-next

These files exist in `conduit-next` but haven't been copied/adapted yet. Pull
them in the same way as above: read the original, swap `lead_id`/`leads(...)`
for `borrower_id`/`borrowers(...)`, and swap direct `organizations`/`profiles`
lookups for `getOrgContext()`.

**Borrower-portal routes** (all under `conduit-next/app/api/borrower-portal/[token]/credit-repair/`) —
these ran through conduit-next's `borrower_portal_tokens` auth, which doesn't
exist here. CreditCoachIQ needs its **own** borrower-facing auth/token scheme
before these can be ported as-is (or they get folded into a magic-link flow
tied to the `borrowers` table):
- `pull-credit/route.ts`
- `sign-croa/route.ts`
- `generate-letters/route.ts`
- `send-disputes/route.ts`
- `update-score/route.ts`
- `log-outcome/route.ts`
- `subscribe/route.ts`
- `status/route.ts`

**UI pages/components** (all under `conduit-next/app/(dashboard)/` and
`conduit-next/app/(borrower)/`) — these are mostly presentational and fetch
from the API routes above, so porting them should be mechanical once the
borrower-portal auth question (above) is settled:
- `(dashboard)/credit-repair/page.tsx`
- `(dashboard)/credit-repair/CreditRepairClient.tsx`
- `(dashboard)/credit-repair/ConsumerCreditRepairPanel.tsx`
- `(dashboard)/credit-repair/enrollment/[enrollmentId]/page.tsx`
- `(dashboard)/credit-repair/enrollment/[enrollmentId]/EnrollmentDetailClient.tsx`
- `(dashboard)/credit-alerts/page.tsx`
- `(dashboard)/settings/CreditRepairSettingsCard.tsx`
- `(dashboard)/leads/[id]/EnrollCreditRepairButton.tsx` — this one calls
  `POST /api/enroll`; update the fetch body to the new shape
  (`firstName`/`lastName`/`email`/`externalLeadId` instead of `leadId`)
- `(borrower)/status/[token]/CreditRepairTab.tsx` — depends on the
  borrower-portal auth decision above

## Second pass: Client Journey, Credit Stacking, Wealth Coaching, AshleyIQ Handoff

See `FEATURES.md` for the full checklist this build works from. Summary of what landed:

- **`supabase/migrations/0002_client_journey_stacking_wealth.sql`** — adds `plan_tier`/`journey_stage` to `borrowers`, plus `journey_stage_events`, `business_credit_profiles`, `credit_stack_plans`, `credit_stack_applications`, `financial_goals`, `client_debts`, `debt_payoff_plans`, `budgets`/`budget_categories`, `loan_ready_checklist_items`, `handoff_packages`, `coach_tasks`, `state_compliance_status`. Also widens `profiles.role` to `('admin', 'coach')`.
- **`lib/plans.ts`** — server-side tier gating (`credit_coaching` / `wealth_coaching` / `investor_path`); every new module's write routes check this before touching data outside a client's purchased tier.
- **`lib/journey.ts`** — the stage-transition function every stage change routes through. `loan_ready` specifically requires a coach's profile id and a complete required-checklist — it will not advance silently or automatically.
- **Credit stacking** (`app/api/stacking/*`) — business credit profiles, stack plans, per-application tracking, and a summary endpoint that rolls up capital-available + flags promo-APR expirations within 30 days.
- **Wealth coaching** (`app/api/wealth/*`) — goals, debts, a real avalanche/snowball payoff-plan calculator (`payoff-plan/route.ts` — pure arithmetic over the client's own linked debts, deliberately not investment advice), and monthly budgets.
- **Coach ops** (`app/api/coach/*`) — caseload view (assigned clients, current stage, days-in-stage) and a task queue.
- **AshleyIQ handoff** (`app/api/journey/handoff/route.ts` + `lib/integrations/conduit-client.ts`'s new `sendHandoffPackage()`) — packages a `loan_ready` client's credit trajectory, stacked capital, and business entity info and pushes it to conduit-next. **The receiving side was also built**, directly in the conduit-next codebase:
  - `conduit-next/app/api/integrations/credit-coach-handoff/route.ts` — Bearer-token-authenticated (not Clerk), creates/updates a `leads` row (`lead_source = 'credit_coach_iq'`, `stage = 'pre_qual'`), logs the handoff context to `lead_activities`, and — if a business entity was part of the client's credit-stacking work — creates an `investor_entities` row and links it via `borrower_entity_links`.
  - `conduit-next/middleware.ts` — added the new route to the public-route matcher (Bearer-verified in-handler, same pattern as the existing CLOSA partner bridge).
  - `conduit-next/.env.example` — added `CREDIT_COACH_INTEGRATION_KEY` and `CREDIT_COACH_DEFAULT_ORG_ID`.
  - **Open item**: the handoff only passes an EIN's last 4 digits today; full EIN should route through conduit-next's existing `ein_encrypted` flow (`lib/crypto/encrypt`) once CreditCoachIQ is updated to pass the full number instead of a truncated one.

### Still open after this pass
- Borrower-facing auth/portal (unchanged from the first pass — still the biggest remaining gap).
- Coach-facing UI for all of the above (routes are built; pages aren't yet).
- Bank-linking for budgets (Plaid or similar) — deliberately deferred, see `FEATURES.md`.
- Tier upgrade/downgrade billing UI — schema supports `plan_tier`; the Stripe proration flow isn't built.
- State compliance workflow — `state_compliance_status` table exists; no UI/enforcement logic yet.

## Third pass: Automated CRM — campaigns, templates, and messaging automation

Built in response to: "this should function like an automated crm that is seemless and still feels personalized bonded journey. email and text visual campaigns (like the automation and the builder)." See `FEATURES.md` Module J for the full checklist. Summary of what landed:

- **`supabase/migrations/0003_campaigns_automation.sql`** — adds `sms_consent`/`sms_consent_at`/`email_opt_out`/`sms_opt_out`/`unsubscribe_token` to `borrowers`; creates `message_templates`, `campaigns`, `campaign_steps`, `campaign_enrollments`, `campaign_sends`.
- **`lib/resend.ts`, `lib/sms.ts`** — thin singleton wrappers over the Resend and Twilio SDKs.
- **`lib/messaging/render.ts`** — `{{token}}` template interpolation + journey-stage display-label mapping.
- **`lib/messaging/context.ts`** — `buildMessageContext()`, the per-send personalization lookup (fresh score/coach/stacked-capital, not cached at enrollment time — this is the mechanism that keeps automated sequences feeling current rather than canned).
- **`lib/messaging/enroll.ts`** — `enrollBorrowerInCampaign()` (idempotent) and `processDueEnrollments()` (the cron entry point: consent gates, skip-conditions, send, log, advance-or-retry).
- **`lib/messaging/triggers.ts`** — `fireTrigger()`, wired into `lib/journey.ts` (every stage transition, plus a dedicated `loan_ready_reached` fire) and `app/api/enroll/route.ts` (`client_enrolled` on signup). Fire-and-forget by design — a messaging failure never blocks the underlying business action.
- **API routes**: `app/api/templates/route.ts`, `app/api/campaigns/route.ts`, `app/api/campaigns/[id]/steps/route.ts`, `app/api/campaigns/enroll/route.ts` — the CRUD/manual-enrollment surface a visual builder UI would call.
- **Cron**: `app/api/cron/process-campaigns/route.ts` (send-queue worker) and `app/api/cron/promo-expiring/route.ts` (daily date-based trigger scan) — both Bearer `CRON_SECRET`, matching conduit-next's existing `/api/cron/*` pattern exactly.
- **Compliance**: `app/api/messaging/unsubscribe/route.ts` — public, token-gated, no session required.
- **`middleware.ts`** — added `/api/cron(.*)` and `/api/messaging/unsubscribe(.*)` to the public-route matcher (auth handled in-route, same pattern as the Stripe/vendor webhooks entry already there).
- **`.env.example`** — added `RESEND_API_KEY`, `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`.

### Still open after this pass
- The visual drag-and-drop builder canvas itself — the full data model and API it would sit on are built (`campaigns`/`campaign_steps`, with `PUT .../steps` accepting a full reordered array in one call), but there's no React Flow/canvas front end yet.
- AI-assisted template drafting — templates are hand-authored; no Haiku-drafting endpoint for message copy yet (mirrors the dispute-letter AI-drafting pattern already in Module B, just not extended here).
- Scheduling the two new cron routes with an actual scheduler (Vercel Cron, GitHub Actions, etc.) — the routes exist and are Bearer-secured; nothing calls them yet.
- Borrower-facing auth/portal, bank-linking, tier billing UI, state compliance workflow — unchanged from the prior pass, see above.

## Fourth pass: Client Portal — pre-call AI quiz, results, Calendly booking, messaging

Built in response to: "an ai quiz that we send before the first call that determines their path based on their credit report... client needs a portal to see their results, book a call (based on plan limit), send a message. a true interactive experience." See `FEATURES.md` Module K. Two decisions were confirmed with the user before building: call booking uses **Calendly** (not internal slots), and the SmartCredit report pull is **just a referral link** (no API credentials), so the quiz relies on self-reported score + goals rather than a live report feed. Summary of what landed:

- **`supabase/migrations/0004_client_portal_quiz_booking.sql`** — `portal_tokens` (magic-link auth, mirrors conduit-next's `borrower_portal_tokens`), `intake_quiz_questions` (coach-editable, seeded with a default 6-question set per org), `intake_quiz_responses`, `intake_quiz_answers`, `coach_calendly_links`, `call_bookings`, `portal_messages`.
- **`lib/portal/token.ts`** — `issuePortalToken()` / `verifyPortalToken()`, the magic-link auth every `/api/portal/[token]/*` route runs through instead of `getOrgContext()`.
- **`lib/quiz/score.ts`** — deterministic path-scoring (weighted points per answer → `credit_coaching`/`wealth_coaching`/`investor_path`); always produces a recommendation even if the AI call below fails.
- **`lib/quiz/summarize.ts`** — Claude Haiku coach-facing prep brief, same pattern as `lib/creditAlerts/rateReengagement.ts`, with a deterministic fallback string on API failure.
- **`lib/quiz/sendInvite.ts`** — one-off transactional quiz-invite send (email/SMS via the existing Resend/Twilio wrappers), separate from the campaign engine since it's coach-triggered, not a drip.
- **`lib/calendly.ts`** — webhook signature verification (HMAC-SHA256 per Calendly's spec) and prefilled-scheduling-URL building (borrower/org ride along in `utm_content` so the webhook can resolve who booked without name/email matching).
- **Client portal API** (`app/api/portal/[token]/*`, token-authed): `overview`, `quiz` (GET/POST), `messages` (GET/POST), `booking` (GET — serves the Calendly link, gated by remaining call allowance).
- **Coach-side API**: `app/api/quiz/questions` (question-bank CRUD), `app/api/quiz/send`, `app/api/quiz/responses` (review queue + sign-off), `app/api/coach/calendly` (set scheduling link), `app/api/coach/messages/[borrowerId]`.
- **`app/api/webhooks/calendly/route.ts`** — the actual source of truth for bookings; a client clicking the Calendly link doesn't create a `call_bookings` row by itself, only a confirmed `invitee.created` webhook does. Handles cancellation (`invitee.canceled`) too.
- **`lib/plans.ts`** — added `getCallAllowance()`: Credit Coaching 1/mo, Wealth Coaching 2/mo, Investor Path 4/mo, trailing 30-day window.
- **`middleware.ts`** — added `/api/portal(.*)` and `/portal(.*)` to the public-route matcher (Calendly webhook already covered by the existing `/api/webhooks(.*)` entry).
- **`.env.example`** — added `SMARTCREDIT_REFERRAL_URL` (optional) and `CALENDLY_WEBHOOK_SIGNING_KEY`.

### Still open after this pass
- The actual portal UI (`app/portal/[token]/*` pages) — this pass is the full token-auth + API layer the UI will call; no React pages yet.
- Calendly `invitee.rescheduled` handling — reschedules aren't updated on the `call_bookings` row yet, only new bookings and cancellations.
- SmartCredit stays referral-link-only until (if) real API credentials are available.
- Coach onboarding UX for pasting in a Calendly link — works via `POST /api/coach/calendly` today, no settings-page UI.

## Fifth pass: Security hardening

Triggered by: "we need the client portal to be secure because it has personal info. think through every aspect of a credit repair/coaching and financial coach business and identify any gaps in our software. Also compare it to features of all popular systems in these spaces." Three deliverables: `SECURITY_AUDIT.md` (portal-specific + regulatory grounding — this business falls under the FTC Safeguards Rule/GLBA as a credit-counseling/financial-advisory entity), `GAP_ANALYSIS_AND_COMPETITORS.md` (full operational checklist + comparison vs Credit Repair Cloud, DisputeFox, Client Dispute Manager, GoHighLevel), and `DESIGN_DIRECTION.md` (the luxury/dark/gold UI direction for the not-yet-built portal pages, plus a rendered mockup).

Code changes landed alongside the audit (see `SECURITY_AUDIT.md` for the full rationale):
- **`supabase/migrations/0005_security_hardening.sql`** — `portal_tokens` now stores `token_hash` (SHA-256) instead of a plaintext token, plus `revoked_at`; new `portal_access_log` table; `business_credit_profiles.ein` replaced with `ein_encrypted`/`ein_last4`.
- **`lib/crypto/encrypt.ts`** — ported from conduit-next unchanged (AES-256-GCM, `ENCRYPTION_KEY` env var).
- **`lib/portal/token.ts`** — rewritten: `issuePortalToken()` now hashes before storing and logs `token_issued`; `verifyPortalToken()` takes request metadata and logs every attempt; new `revokePortalToken()`.
- **`app/api/coach/portal-access/route.ts`** — coach-facing revoke/reissue + access-history view.
- **`app/api/stacking/business-profiles/route.ts`** — EIN now encrypted on write, masked (`••••1234`) by default on read, full value only via `?reveal=true`.
- **`next.config.mjs`** — added a site-wide `headers()` block (HSTS, CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy).
- **`.env.example`** — added `ENCRYPTION_KEY`.

### Still open after this pass
- MFA/step-up auth for the portal — flagged as GLBA-expected but needs a friction-level decision before building.
- Formal WISP, vendor risk review, data retention/deletion policy, incident response plan — governance documents, not code; see `SECURITY_AUDIT.md` for what each needs.
- The luxury portal UI itself — `DESIGN_DIRECTION.md` + the rendered mockup set the direction; the actual `app/portal/[token]/*` pages are still unbuilt (same gap as the Fourth pass).
- The credit-report-import/OCR, e-signature, and print-and-mail gaps identified in `GAP_ANALYSIS_AND_COMPETITORS.md` — recommended next build priority there, not started this pass.

## Sixth pass: ownership correction, design pivot v2, and closing the two "critical" gaps

Triggered by a multi-part message: (1) correct the design direction to "easy on the eyes, white space, green to represent money... look like something Apple would build" — supersedes the Fifth pass's dark/gold luxury direction; (2) ownership correction — **CreditCoachIQ is not a PrimeMind Labs product.** It's proprietary software owned by **EquityNest Capital**, a separate company. AshleyIQ/conduit-next remains a PrimeMind Labs product; the Stage 4 handoff between the two is therefore a cross-company integration, not an internal one. Every "PrimeMind Labs" reference describing CreditCoachIQ's ownership across `STRATEGY.md`, `FEATURES.md`, `GAP_ANALYSIS_AND_COMPETITORS.md`, and the migration comments was corrected to EquityNest Capital. (No persistent cross-session memory tool was available to record this outside the project files themselves — flagged to the user.) (3) act on the gap analysis: wire the two items marked critical, with the rest queued and sequenced per the user's explicit choice ("critical items first").

- **`DESIGN_DIRECTION.md`** — rewritten (v2): light canvas, money-green accent (`#0F9D58`), Apple-reference restraint (one idea per screen, one primary action, thin-line icons, single font family). A new mockup was rendered showing the light/green dashboard superseding the dark/gold one.
- **`tailwind.config.ts`** — added the actual design-system tokens (`paper`, `ink`, `muted`, `line`, `money`) so the UI code below isn't guessing at hex values.
- **Dispute-letter generation + Lob send flow (critical #1)** — the AI-drafting code existed only in conduit-next's not-yet-ported borrower-portal routes; ported and adapted:
  - `lib/disputes/letters.ts` — `generateDisputeLetter()` (Claude Haiku, FCRA-compliant) + `createDisputeForTradeline()`, drafts only, never sends.
  - `lib/disputes/lob.ts` — `sendCertifiedLetter()` via the Lob REST API, mock-mode when `LOB_API_KEY` is unset.
  - `app/api/disputes/generate/route.ts` — coach-triggered drafting, gated on `croa_disclosure_signed_at` (blocks until e-signature, Task 40, is built).
  - `app/api/disputes/route.ts` — review queue (GET) + letter-body edit before approval (PATCH).
  - `app/api/disputes/send/route.ts` — the explicit, separate approval-to-mail step. AI drafts, a human approves and sends — never merged into one step.
  - `app/api/disputes/log-outcome/route.ts` — logs a bureau's response and auto-escalates ("verified accurate" or "no response" auto-drafts the next-cycle letter — method-of-verification, then a CFPB complaint by cycle 3), and fires the `dispute_response_received` campaign trigger built in the Third pass.
  - `.env.example` — added `LOB_API_KEY`.
- **Visual campaign builder UI (critical #2)** — the Third pass built the API/data model only; this pass adds the actual UI on top:
  - `app/(dashboard)/layout.tsx` — minimal coach shell (top nav, no dense sidebar, per the new design direction).
  - `app/(dashboard)/campaigns/page.tsx` — campaign list, create, status badges.
  - `app/(dashboard)/campaigns/[id]/page.tsx` — the builder itself: native HTML5 drag-and-drop step reordering, add/remove steps, per-step channel/template/delay, a stage picker when the trigger is `journey_stage_enter`, activate/pause.
  - `app/(dashboard)/templates/page.tsx` — template CRUD with one-click token insertion (`{{first_name}}` etc.).
  - `app/api/campaigns/[id]/route.ts` — single-campaign fetch (GET) + archive (DELETE); `app/api/campaigns/route.ts` PATCH extended to accept `trigger_config`.

### Decisions confirmed, not yet built
- **E-signature (Task 40)**: `primemindlabs-core` (the shared SDK the user pointed to) has auth/billing/analytics/API-client/errors/types modules but **no signing module at all** — confirmed by reading its full `index.ts` and README. Decision: build a simple in-house click-to-sign module (typed/drawn signature, IP+timestamp audit trail, PDF generation) as a new `signing/` module inside `primemindlabs-core/typescript`, so it's reusable across all 8 PrimeMind Labs products, not just consumed once here. Not yet built.
- **In-system dialer (Task 41)**: click-to-call + automatic logging via the existing Twilio account (not a full in-browser softphone). Not yet built.

### Still queued (explicit user sequencing: critical items first, this pass; the rest next)
- Credit report import (AI-parsed PDF upload via Anthropic's document support, replacing manual tradeline entry)
- Referral partner tracking
- Owner-facing analytics dashboard (revenue, client outcomes, average time-in-stage, handoff conversion rate)
- CROA/state compliance enforcement (block enrollment in unregistered states; wire the 3-day hold into the live flow)
- The rest of the portal + coach dashboard UI (overview, quiz-taking, messaging, booking, caseload, stacking, wealth pages) in the new v2 design
- The two blocked items above, once built

## Seventh pass: "complete everything" — nudges, compliance, billing, MFA, bank linking, portal UI, governance

Triggered by the user pasting the full remaining 🔜/⏳ list gathered from across this document (and `FEATURES.md`) and saying "we need to complete" it. See `FEATURES.md` Module N for the itemized checklist. Summary of what landed, in build order:

- **`supabase/migrations/0006_nudges_stacking_compliance_billing.sql`** — `credit_disputes.approved_by` (compliance audit trail), `borrowers.state`/`funding_status`/`funding_status_updated_at`, `handoff_packages.last_status_sync_at`, `lender_criteria` (seeded reference table for stack-sequencing), `plaid_linked_accounts`, `plaid_transactions`, `portal_otp_challenges`, `portal_tokens.mfa_verified_until`.
- **`supabase/migrations/0007_plaid_sync_cursor.sql`** — `plaid_linked_accounts.sync_cursor`, needed once the Plaid `/transactions/sync` (cursor-based) integration was actually built out, not just schemed.
- **Readiness nudges** — `app/api/cron/readiness-nudges`, deduped `coach_tasks` entries when a client crosses their score or stack-capital target.
- **AI stack-sequencing** — `lib/stacking/recommend.ts` + `app/api/stacking/recommend`, ranked against the new `lender_criteria` seed table, explicitly caveated as a rules-of-thumb starting point in both code and API response.
- **Cross-company status sync** — `app/api/integrations/funding-status-sync` (CreditCoachIQ receiving side) + `conduit-next/app/api/cron/credit-coach-status-sync` (the sending cron, built directly in the separate conduit-next codebase). Bearer-secret pair: `CONDUIT_STATUS_SYNC_KEY` (CreditCoachIQ) / `CREDIT_COACH_STATUS_SYNC_KEY` (conduit-next) — a cross-company shared secret since AshleyIQ (PrimeMind Labs) and CreditCoachIQ (EquityNest Capital) are separate companies. Found and fixed a real bug while wiring this: `app/api/journey/handoff/route.ts` still selected the plaintext `business_credit_profiles.ein` column dropped in the Fifth pass — fixed to use `ein_last4`.
- **State compliance enforcement** — fail-closed gate in `app/api/enroll` (a state with no `state_compliance_status` row blocks enrollment, doesn't default to allowed) + `app/api/admin/state-compliance` for admins to manage the list.
- **Coach/compliance audit log** — `app/api/admin/audit-log`, admin-only, read-time aggregation over existing actor/timestamp columns (no new parallel audit table).
- **Tier billing** — `app/api/billing/change-tier` (Stripe subscription-item swap with proration, or a Checkout Session if no subscription exists yet) + `app/api/billing/portal` (standard Stripe billing-portal handoff).
- **Governance docs** — `governance/WISP.md`, `governance/VENDOR_RISK_REVIEW.md`, `governance/DATA_RETENTION_POLICY.md`, `governance/INCIDENT_RESPONSE_PLAN.md`. Drafted templates per the FTC Safeguards Rule; each needs a named Qualified Individual + signature before it's a real program.
- **Step-up MFA** — `lib/portal/otp.ts` (email OTP, 10-min expiry, 5-attempt lockout), `app/api/portal/[token]/mfa/{challenge,verify}`, `app/api/portal/[token]/status` (lightweight gate-check endpoint). Every content-bearing portal route now checks `ctx.mfaCurrent` (added to `PortalContext` in `lib/portal/token.ts`) before returning data.
- **Plaid bank linking** — `lib/plaid.ts` (Link token creation, public-token exchange, cursor-based transaction sync, all gated on `PLAID_CLIENT_ID`/`PLAID_SECRET`), `app/api/portal/[token]/plaid/{link-token,exchange,accounts}`, `app/api/cron/plaid-sync`. Access tokens AES-256-GCM encrypted via the existing `lib/crypto/encrypt.ts`.
- **Client portal UI** — `app/portal/[token]/layout.tsx` + `PortalShell.tsx` (MFA gate + nav), `page.tsx` (overview: "you are here" journey map, score/capital/goals, call allowance, bank-linking widget using Plaid's hosted Link script loaded on demand), `quiz/page.tsx`, `messages/page.tsx`, `booking/page.tsx` (Calendly iframe embed). Light/green v2 design tokens used throughout; added a `terra` alert color to `tailwind.config.ts` for validation/error states that weren't covered by the original `paper`/`ink`/`muted`/`line`/`money` set.
- **Calendly reschedule handling** — `app/api/webhooks/calendly/route.ts` now handles `invitee.rescheduled` (cancels the old `call_bookings` row via `calendly_invitee_uri`, inserts the new one).
- **`package.json`** — added `resend` and `twilio` as explicit dependencies; `lib/resend.ts` and `lib/sms.ts` imported these packages since the Third pass but they were never added to `package.json` — would have failed `npm install`/build. Caught while touching this area for the MFA email send.

### Still open after this pass
- Credit report import (AI-parsed PDF upload), referral partner tracking, owner-facing analytics dashboard — not started.
- Rest of the coach dashboard UI (caseload, stacking, wealth-coaching pages) in the v2 design — only the client portal and campaign builder/templates are built.
- Direct lender-application APIs and a SmartCredit partner API — **not feasible with current resources**, not just deferred; see `FEATURES.md`'s "What's infeasible" section for why.
- No-show detection for bookings (Calendly has no distinct webhook for it) and login-notification email — lower priority, noted but not built.

## Eighth pass: e-signature (shared SDK) and the in-system dialer

Closes the two items the Sixth pass explicitly left as "decision made, not yet built."

- **`primemindlabs-core/typescript/src/signing/index.tsx`** (new module in the shared SDK, built in the actual `primemindlabs-core` repo — not just referenced): `SignaturePad` (React, captures typed or drawn signature + built-in ESIGN consent checkbox — consent capture isn't optional under federal law, so the component owns it rather than leaving it to each consuming product), `hashDocument()`, `buildSignatureRecord()` (server-side, produces a SHA-256-hash-chained tamper-evident record), `verifySignatureRecord()`, `stampSignatureCertificate()` (optional PDF certificate page via `pdf-lib`, dynamically imported so it's not a hard dependency for products that only need capture+record). Registered as `@primemind/sdk/signing` in `primemindlabs-core/typescript/package.json`'s `exports` map. **This module does not own storage** — same pattern as `billing` not storing subscriptions — each consuming product persists the `SignatureRecord` in its own database.
- **`primemindlabs-core/README.md`** — noted the new module in the directory tree, and added a note that cross-company consumers (CreditCoachIQ/EquityNest Capital) need explicit repo-read access for the `git+https://...` dependency, since there's no published npm package yet.
- **CreditCoachIQ's wiring**: `lib/legal/croaDisclosure.ts` (Consumer Rights Statement + contract text — explicitly flagged as needing counsel review before production use, not verified verbatim against the statute), `supabase/migrations/0008_croa_signature_record.sql` (`credit_repair_enrollments.croa_signature_record jsonb`), `app/api/portal/[token]/sign-croa` (GET serves the disclosure + contract text and sign status, POST captures the signature and calls the SDK's `buildSignatureRecord`), `app/portal/[token]/sign/page.tsx` (the portal page, using `SignaturePad` from the SDK). The dispute-generate route's existing `croa_disclosure_signed_at` gate is now something a real client can actually satisfy.
- **Dialer**: `supabase/migrations/0009_dialer_call_logs.sql` (`call_logs`), `lib/dialer.ts` (`initiateClickToCall` — Twilio calls the coach's own phone first via `calls.create`, then bridges to the client's number once the coach answers, via `app/api/telephony/twiml`), `app/api/telephony/status` (Twilio's call-status callback, signature-verified with `twilio.validateRequest`, updates the `call_logs` row), `app/api/coach/dialer` (POST to place a call, GET for a borrower's call history). No recording — state consent laws vary (many are two-party-consent), so that's future work with its own consent-capture flow, not a default.
- **Bug fix**: `lib/sms.ts` read `process.env.TWILIO_PHONE_NUMBER`, but `.env.example` (and every doc referencing it) defines `TWILIO_FROM_NUMBER` — every SMS send since the Third pass would have used an empty from-number. Fixed to read the name that's actually documented and set. Found while wiring the dialer, which depends on the same value.
- **`middleware.ts`** — added `/api/telephony(.*)` to the public-route matcher (Twilio can't send a session cookie; the status callback verifies Twilio's own signature in-handler).

### Still open after this pass
- The "Call" button itself isn't wired into any coach-facing UI yet — the API/webhook layer (`app/api/coach/dialer`) is real and callable, but there's no caseload/borrower-detail page to put the button on until the broader coach-dashboard-UI task lands.
- Call recording (opt-in, with its own consent-capture flow) — deliberately not built as part of this pass.
- Everything else listed as still-open above this section is unchanged.

## Ninth pass: credit report import, referral tracking, analytics, and the rest of the coach dashboard

The last four items on the original list. See `FEATURES.md` Module O.

- **`supabase/migrations/0010_credit_report_upload_bucket.sql`** — private Storage bucket for uploaded report PDFs.
- **`lib/creditReport/parse.ts`** — Claude PDF-document extraction (scores + tradelines), matched to `credit_tradelines`' existing columns so imports flow straight into the dispute pipeline built in the Sixth pass. `app/api/credit-reports` (POST uploads + parses + imports; GET lists upload history per enrollment). `app/(dashboard)/credit-reports` — coach picks a client, uploads a PDF, sees parsed scores/tradeline counts and upload history.
- **`supabase/migrations/0011_referral_partners.sql`** — `referral_partners`, `borrowers.referred_by_partner_id` (single-touch attribution — deliberately not a multi-touch model, which would be a materially bigger build than asked for), `referral_commission_events` (append-only, INSERT-only RLS, no UPDATE/DELETE even for service_role — corrections are offsetting entries, not edits, matching the architecture rule for audit tables). `app/api/enroll` accepts an optional `referralCode` and attributes automatically at enrollment. `app/api/referral-partners/*` + `app/(dashboard)/referral-partners` (partner list with rollup stats, create, record commission payments).
- **`lib/analytics.ts`** — revenue pulled live from Stripe (paginated `subscriptions.list`, normalized to a monthly-equivalent regardless of billing interval) rather than approximated from a local tier-price table that could drift from what's actually configured; client-outcome and time-in-stage stats computed from existing `journey_stage_events`/`credit_repair_enrollments` data. `app/api/analytics` (admin-only) + `app/(dashboard)/analytics`.
- **Coach dashboard**: `app/(dashboard)/caseload` (client list) and `app/(dashboard)/caseload/[borrowerId]` (the actual per-client working view: journey-stage buttons wired to `app/api/journey/transition`, the dispute-approval queue wired to `app/api/disputes/send`, the dialer's "Call" button wired to `app/api/coach/dialer` — this is the first place that button actually appears in a UI — and portal-access revoke/reissue). `app/api/coach/client/[borrowerId]` is a new consolidated read (borrower + enrollment + goals + open tasks + recent calls + referral partner name in one call) built specifically to back this page without composing a dozen separate client-side fetches.
- **Scoping call**: stacking and wealth-coaching data are shown per-client on the detail page, not as separate portfolio-wide list pages. That's the workflow a coach actually uses (client-first, not metric-first), and it's a smaller, additive build later if a cross-client view turns out to be wanted — not a rebuild of what's here.

### Still open after this pass
- No-show detection for bookings (Calendly has no distinct webhook for it) and login-notification email for new-device portal access — both noted, neither built.
- Portfolio-wide stacking/wealth list views, if wanted later (see scoping note above).
- Direct lender-application APIs and a SmartCredit partner API remain **infeasible with current resources**, not deferred — see `FEATURES.md`.

This closes every item from the user's original "we need to complete" list. What's left (no-show detection, login notifications, and the two genuinely infeasible vendor-API items) is either explicitly lower-priority or explicitly not buildable without a vendor relationship that doesn't exist today.

## Setup checklist

1. `npm install`
2. Create a new Supabase project, run migrations in order: `0001_init_credit_coach_schema.sql` through `0011_referral_partners.sql`
3. Create a new Clerk application (separate from conduit-next's)
4. Create a new Stripe account/keys for this product, including per-tier price IDs (`STRIPE_PRICE_CREDIT_COACHING`/`STRIPE_PRICE_WEALTH_COACHING`/`STRIPE_PRICE_INVESTOR_PATH`) for the tier-change billing flow
5. Copy `.env.example` → `.env.local` and fill in all values, including `ENCRYPTION_KEY` (generate with `openssl rand -hex 32`)
6. `npm run dev`
7. Coach-facing dashboard pages beyond campaigns/templates (caseload, stacking, wealth-coaching) are still unbuilt in the v2 design — see `FEATURES.md`'s deferred list
8. Set up Resend + Twilio accounts, fill in `RESEND_API_KEY`/`TWILIO_*`/`CRON_SECRET`/`NEXT_PUBLIC_APP_URL`
9. Schedule `POST /api/cron/process-campaigns` (every 5-15 min), `POST /api/cron/promo-expiring` (daily), `POST /api/cron/readiness-nudges` (daily), and `POST /api/cron/plaid-sync` (every few hours, once Plaid keys are set) — all Bearer `CRON_SECRET`
10. Create a Calendly webhook subscription (`invitee.created`, `invitee.canceled`, `invitee.rescheduled`) pointed at `POST /api/webhooks/calendly`, fill in `CALENDLY_WEBHOOK_SIGNING_KEY`; each coach sets their scheduling link via `POST /api/coach/calendly`
11. If using SmartCredit, fill in `SMARTCREDIT_REFERRAL_URL` with your affiliate/referral link — there's no partner API to integrate, this is by design (see `FEATURES.md`)
12. If enabling bank linking, create a Plaid account and fill in `PLAID_CLIENT_ID`/`PLAID_SECRET`/`PLAID_ENV` — leave blank to keep the feature hidden in the portal
13. Fill in the named Qualified Individual and review the four `governance/*.md` documents before handling real (non-test) client data — they're drafted templates, not yet an adopted program
14. Set up the cross-company status-sync pair if using AshleyIQ/conduit-next as the funding partner: `CONDUIT_STATUS_SYNC_KEY` here must match `CREDIT_COACH_STATUS_SYNC_KEY` in conduit-next's own `.env`
15. `git init && git add -A && git commit -m "Initial CreditCoachIQ extraction"`, then push to a new GitHub repo

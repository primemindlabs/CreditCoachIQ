# CreditCoachIQ — Full Feature Spec / Build Checklist

Internal, proprietary coaching-delivery platform. One operator (EquityNest Capital), coaches as users, clients as `borrowers`, three tiers, one flagship journey. This is the working checklist behind the schema/API/UI build — ✅ = built in this pass, ⏳ = designed, not yet built, 🔜 = future phase.

---

## Module A — Client Journey (the spine everything else hangs off)

- ✅ `client_journey_stage` on every client: `credit_coaching` → `credit_stacking` → `loan_ready` → `handed_off` (plus `paused`/`exited`)
- ✅ Stage-transition log (who moved the client, when, why) — audit trail, not just a status field
- ✅ Per-stage entry/exit criteria stored per client (coach can see exactly what's blocking the next stage)
- ✅ Coach sign-off requirement before `loan_ready` — never auto-advances
- ⏳ Automated "ready to advance" nudges to coach when a client crosses stage thresholds (score target hit, stack capital target hit)
- 🔜 Client-facing journey visualization ("you are here" progress map)

## Module B — Credit Coaching (Stage 1)

Already extracted from conduit-next in the prior pass — carried forward unchanged, this pass adds the journey-stage hook:
- ✅ Enrollment, AI-drafted Metro2-aware dispute letters, human-approval gate, Lob mail automation fields, e-OSCAR response-deadline tracking, credit monitoring/alerts, CROA-compliant enrollment (3-day hold, bill-after-service)
- ✅ Now emits a journey-stage event on enrollment and on reaching target score
- ⏳ Borrower-portal auth + client-facing pages (flagged since the first extraction, still open)

## Module C — Credit Stacking (Stage 2) — new this pass

- ✅ `business_credit_profiles`: EIN, D-U-N-S, entity name/type, bureau file status per bureau (D&B PAYDEX, Experian Business, Equifax Business)
- ✅ `credit_stack_plans`: coach-built sequence of target lenders/cards, order, timing, target total capital
- ✅ `credit_stack_applications`: per-application tracking — lender, applied date, approved limit, promo APR, promo end date, status
- ✅ Aggregate capital-available rollup (sum of active approved limits) surfaced per client
- ✅ Promo-APR-expiration alerting (flags applications within N days of converting to standard APR)
- ⏳ AI stack-sequencing recommendation (suggest lender order based on client's current profile + known approval patterns) — needs a seed dataset of lender criteria before this can be more than a rules-of-thumb ranking
- 🔜 Direct lender-application integrations (currently tracked manually/coach-entered; API integrations per lender are a later phase, most stacking lenders don't expose one)

## Module D — Financial / Wealth Coaching (Tier 2, feeds Stage 3 readiness)

- ✅ `financial_goals`: target (e.g., "$40K down payment by Q2"), target date, progress tracking
- ✅ `debt_payoff_plans`: avalanche/snowball modeling against a client's tracked debts, projected payoff date
- ✅ `budgets` + `budget_categories`: monthly budget tracking (coach- or client-entered, no bank-linking automation in this pass — see Open Questions)
- ✅ AI coaching-insight generator: plain-language, education-framed guidance ("paying this card to under 30% utilization moves your DTI by X") — explicitly scoped to avoid personalized securities/investment recommendations (see STRATEGY.md §5)
- 🔜 Bank-account linking (Plaid or similar) for automated transaction categorization — deliberately deferred; adds a real integration + compliance surface (data aggregation consent, security review) that shouldn't block the coaching core

## Module E — Loan-Ready Checklist (Stage 3 gate)

- ✅ `loan_ready_checklist`: coach-configurable checklist per client (score threshold met, DTI in range, stack capital target met, entity docs in order, etc.), each item toggled with a timestamp + who verified it
- ✅ Stage only advances to `loan_ready` once required checklist items are complete AND a coach explicitly signs off (button, not automatic)

## Module F — AshleyIQ Handoff (Stage 4)

- ✅ CreditCoachIQ side: `handoff_packages` table + `POST` trigger that snapshots the client's credit trajectory, stacked capital, and checklist at the moment of handoff, and pushes it to conduit-next via `lib/integrations/conduit-client.ts`
- ✅ conduit-next side (new): `app/api/integrations/credit-coach-handoff/route.ts` — receives the package, creates (or updates) a `leads` row pre-populated with the handoff data, and links it into the existing `investor_entities`/`investor_properties`/`borrower_entity_links` tables so underwriting isn't starting from scratch
- ⏳ Status sync back to CreditCoachIQ once the loan progresses (nice-to-have, not required for v1 — the handoff can be one-directional to start)

## Module G — Internal Coach Ops (replaces "agency SaaS" tooling from the earlier draft)

- ✅ Coach caseload view: every client assigned to a coach, current stage, days-in-stage, flagged blockers
- ✅ Task queue: system-generated tasks (promo APR expiring, dispute response overdue, checklist item pending) + coach-created tasks
- ⏳ Internal messaging/notes thread per client (separate from client-facing communication)
- 🔜 Coach performance reporting (clients advanced per month, average time-in-stage, handoff conversion rate)

## Module H — Compliance & Admin

- ✅ CROA enrollment gate (3-day hold enforced, not just logged) — carried from the credit-repair extraction
- ✅ Per-application deferred-interest disclosure requirement on credit-stack applications (client-facing copy must state promo terms plainly)
- ⏳ State registration/bonding tracker (per STRATEGY.md §5) — schema placeholder this pass, full workflow later
- 🔜 Coach performance/compliance audit log surfaced to admin (who approved which AI-drafted letter, who signed off which loan-ready checklist)

## Module I — Tiered Plans / Billing

- ✅ `plan_tier` on client record: `credit_coaching` | `wealth_coaching` | `investor_path`
- ✅ Feature-gating helper (`lib/plans.ts`) — checks tier before exposing stacking/wealth modules, so a Tier 1 client's UI doesn't show stacking tools they haven't purchased
- 🔜 Tier upgrade/downgrade billing flow (Stripe proration) — schema supports it, billing UI not built this pass

## Module J — Automated CRM: Campaigns & Messaging (visual builder backend)

The "seamless but still personalized" automation layer — every client's automated touchpoints run through this, but each send is personalized at delivery time (fresh score/coach-name/stacked-capital lookup), not baked in when the campaign was created.

- ✅ `message_templates`: reusable email/SMS templates with `{{token}}` personalization (`first_name`, `coach_first_name`, `current_score`, `target_score`, `stacked_capital`, `journey_stage_label`, `unsubscribe_url`, etc.)
- ✅ `campaigns` + `campaign_steps`: named sequences with an ordered list of steps (channel, template, delay_hours, optional skip-condition) — this is the backend a drag-and-drop visual builder sits on; `PUT /api/campaigns/[id]/steps` accepts a full reordered step array in one call so a builder's drag-and-drop reorder maps directly onto it
- ✅ Trigger-based auto-enrollment: campaigns fire on `client_enrolled`, `journey_stage_enter` (with a per-campaign target stage), `dispute_response_received`, `goal_achieved`, `stack_promo_expiring`, `loan_ready_reached`, or `manual` — wired directly into `lib/journey.ts` (every stage transition) and `app/api/enroll/route.ts` (signup), so campaigns fire automatically as clients move through their journey, no cron polling needed for those events
- ✅ `lib/messaging/context.ts`: per-send context builder — queries the client's *current* score, coach name, and stacked capital fresh at send time, so a 6-message drip sent over 3 weeks reflects where the client actually is that day, not where they were when they were enrolled
- ✅ Consent gating baked into the send path: SMS requires `sms_consent` + not `sms_opt_out` + a phone on file; email requires not `email_opt_out` + an email on file — steps that fail consent are skipped (and the enrollment still advances) rather than silently dropped
- ✅ `POST /api/cron/process-campaigns` (Bearer `CRON_SECRET`): the actual send-queue worker, run every 5-15 minutes — sends via Resend (email) / Twilio (SMS), logs every attempt (including failures) to `campaign_sends`, retries failed sends on the next pass instead of skipping
- ✅ `POST /api/cron/promo-expiring` (Bearer `CRON_SECRET`, daily): the one trigger that needs a date-based scan rather than an in-app event — finds `credit_stack_applications` within 30 days of promo-APR expiration and fires `stack_promo_expiring` per client, deduped against existing active enrollments
- ✅ `GET /api/messaging/unsubscribe`: public, token-gated (no session) one-click unsubscribe — CAN-SPAM/TCPA compliance, linked from every rendered template via `unsubscribe_url`
- ✅ `POST /api/campaigns/enroll`: manual enrollment for one-off campaign adds outside the automatic triggers
- ✅ CRUD: `GET/POST/PATCH /api/templates`, `GET/POST/PATCH /api/campaigns` (activation blocked if a campaign has zero steps), `GET/POST/PUT /api/campaigns/[id]/steps`
- 🔜 The actual visual drag-and-drop canvas UI — this pass built the full data model and API surface it sits on, not the React Flow/canvas front end
- 🔜 AI-assisted template drafting (Haiku, same pattern as the dispute-letter drafting) — not built this pass, templates are hand-authored for now
- 🔜 A/B step variants, send-time optimization (best-hour-to-send modeling)

## Module K — Client Portal: Pre-Call AI Quiz, Results, Booking & Messaging

The borrower-facing gap flagged as "still open" in every prior pass — solved here with a magic-link token portal (no client Clerk accounts needed), an AI-scored intake quiz sent before the first call, and real self-service (view results, book within plan limits, message the coach).

- ✅ `portal_tokens`: magic-link auth for the client portal, same pattern as conduit-next's `borrower_portal_tokens` — a long random token in the URL, verified in-handler, 180-day expiry, no session required
- ✅ **Pre-call intake quiz**: `intake_quiz_questions` (coach-editable bank, seeded with a default 6-question set per org), `intake_quiz_responses`, `intake_quiz_answers`. Captures stated goals, a self-reported score, and free-text notes; the SmartCredit link is just an optional referral link in the invite message (not an API integration) — pulling the report is on the client, coaches log real numbers later
- ✅ `lib/quiz/score.ts`: deterministic path-scoring — every quiz answer contributes weighted points toward `credit_coaching` / `wealth_coaching` / `investor_path`, and the highest score wins (ties break toward Investor Path — worth the conversation when signals are mixed). Always available even if the AI call fails
- ✅ `lib/quiz/summarize.ts`: Claude Haiku-generated coach-facing prep brief (stated goal, credit situation, recommended tier + why, suggested opening questions) — same pattern as the existing dispute-letter/re-engagement AI drafting, with a deterministic fallback if the API call errors
- ✅ `POST /api/quiz/send`: coach-triggered quiz invite (email + SMS if consented), reuses the messaging infra (Resend/Twilio) as a one-off transactional send, not a campaign drip
- ✅ `GET/PATCH /api/quiz/responses`: coach review queue — completed quizzes awaiting sign-off before the call
- ✅ Quiz completion auto-creates a `coach_tasks` entry ("review before consultation") on the assigned coach's queue — reuses Module G's existing task infra rather than a parallel notification system
- ✅ **Client portal API** (`app/api/portal/[token]/*`, token-authed, no Clerk): `overview` (stage, score progress, stacked capital, goals, quiz status, upcoming call, unread-message count, call allowance used/remaining), `quiz` (take/view the quiz), `messages` (two-way thread with the coach), `booking` (coach's scheduling link, gated by plan-tier call allowance)
- ✅ **Call booking, Calendly-backed**: `coach_calendly_links` (each coach's scheduling URL), `call_bookings` — the portal serves a prefilled Calendly link (name/email + a borrower-tracking param), but `app/api/webhooks/calendly/route.ts` (signature-verified) is the actual source of truth: a booking only counts once Calendly confirms it, not when the client clicks through
- ✅ Plan-tier call allowances in `lib/plans.ts` (`getCallAllowance`): Credit Coaching 1/mo, Wealth Coaching 2/mo, Investor Path 4/mo (trailing 30-day window) — booking access is blocked once exhausted, with a message pointing the client to the portal messaging thread instead
- ✅ **Two-way portal messaging**: `portal_messages`, `app/api/coach/messages/[borrowerId]` (coach side) + `app/api/portal/[token]/messages` (client side) — each side's unread count and read-receipts tracked; new client messages auto-create a `coach_tasks` entry
- ✅ The client portal UI (`app/portal/[token]/*`): a shared `PortalShell` (nav + step-up MFA gate), overview page with a "you are here" journey progress map + score/capital/goals summary + linked-accounts widget, quiz-taking page, two-way messages thread, and a Calendly-embedded booking page — light/green v2 design
- ✅ Calendly reschedule handling (`invitee.rescheduled`) — cancels the old `call_bookings` row via `calendly_invitee_uri` and inserts the new one; no-show handling is still open (Calendly doesn't fire a distinct webhook event for it — would need a scheduled sweep of past-due `scheduled` bookings)
- ⛔ **SmartCredit API integration — not feasible, not just deferred.** SmartCredit doesn't publish a partner/reseller API for pulling a client's report into a third-party app; what's available is an affiliate referral link, which is what's built. If EquityNest Capital negotiates direct API access with SmartCredit in the future this can be revisited, but there's nothing to build against today.

## Module L — Portal Security Hardening

Triggered by: "we need the client portal to be secure because it has personal info." Full writeup in `SECURITY_AUDIT.md`; this system falls under the FTC Safeguards Rule (GLBA) as a credit-counseling/financial-advisory business, not just generic best practice.

- ✅ Portal tokens hashed at rest (SHA-256) — the raw magic-link token is never stored, only sent once in the client's link
- ✅ `portal_access_log` — every portal verify attempt (success/failure/expired/revoked) recorded with IP + user-agent
- ✅ Coach-triggered revoke/reissue of a client's portal access (`app/api/coach/portal-access`)
- ✅ EIN moved from plaintext to AES-256-GCM encryption at rest (`business_credit_profiles.ein_encrypted`), masked to last-4 by default, full value only on explicit reveal
- ✅ Security headers site-wide (HSTS, CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy) via `next.config.mjs`
- ✅ Step-up MFA for the portal (`lib/portal/otp.ts`, `app/api/portal/[token]/mfa/{challenge,verify}`): 6-digit email OTP, required once per ~30-day session (`portal_tokens.mfa_verified_until`), gates every content-bearing portal route — a magic-link click alone is a possession factor; this adds a second factor (email inbox access) per GLBA's expectation for customer-information-system access
- ✅ Governance docs (`governance/WISP.md`, `governance/VENDOR_RISK_REVIEW.md`, `governance/DATA_RETENTION_POLICY.md`, `governance/INCIDENT_RESPONSE_PLAN.md`) — drafted templates per the Safeguards Rule; each still needs a named Qualified Individual, a signature, and org-specific fill-in before it's a real program rather than a document (marked inline in each file)
- 🔜 Login-notification email (alert the client when the portal is accessed from a new device/location) — lower priority, noted in the audit, not built this pass

## Module M — Dispute Letters (wired) & Visual Campaign Builder UI

Both flagged critical by the user, both closed this pass. Also: the design direction changed to light/white-space/money-green/Apple-inspired (`DESIGN_DIRECTION.md` v2), superseding Module K's original dark/gold direction — nothing built to that direction yet has shipped, so there's no rework debt.

- ✅ Dispute-letter drafting (`lib/disputes/letters.ts`, Claude Haiku, FCRA-compliant) and the separate human-approval-to-mail step (`lib/disputes/lob.ts`, Lob certified mail, mock mode without `LOB_API_KEY`) — `app/api/disputes/{generate,route,send,log-outcome}` — the AI drafts, a coach explicitly approves and sends; those are two different API calls, never merged
- ✅ Bureau-response auto-escalation: logging "verified accurate" or "no response" auto-drafts the next cycle's letter (method-of-verification, then CFPB complaint by cycle 3) and fires the `dispute_response_received` campaign trigger
- ✅ Visual campaign builder UI: `app/(dashboard)/campaigns` (list/create), `app/(dashboard)/campaigns/[id]` (drag-and-drop step reordering, add/remove steps, stage-trigger picker, activate/pause), `app/(dashboard)/templates` (template CRUD with token insertion) — the front end on top of the Third pass's `campaigns`/`campaign_steps` API
- ✅ `tailwind.config.ts` now carries the actual design-system tokens (`paper`/`ink`/`muted`/`line`/`money`)
- ✅ **E-signature** — `@primemind/sdk/signing` (new shared-SDK module, `primemindlabs-core/typescript/src/signing`): `SignaturePad` (typed or drawn signature + built-in ESIGN consent capture), `hashDocument()`/`buildSignatureRecord()`/`verifySignatureRecord()` (tamper-evident, SHA-256-hash-chained record — each product stores the record in its own DB, the SDK doesn't own storage), `stampSignatureCertificate()` (optional PDF certificate page via `pdf-lib`). Wired end-to-end in CreditCoachIQ: `lib/legal/croaDisclosure.ts` (Consumer Rights Statement + contract text — flagged as needing counsel review before real use), `app/api/portal/[token]/sign-croa` (GET/POST), `app/portal/[token]/sign/page.tsx`. The dispute-generate route's `croa_disclosure_signed_at` gate is now actually satisfiable by a real client.
- ✅ **In-system dialer** — click-to-call + auto-logging via the existing Twilio account (not a full softphone), per the decision made. `call_logs` table, `lib/dialer.ts` (`initiateClickToCall` — Twilio calls the coach's phone first, bridges to the client once answered), `app/api/telephony/{twiml,status}` (public webhooks; `status` is Twilio-signature-verified), `app/api/coach/dialer` (POST to place a call, GET for call history). No recording by default — consent requirements vary by state, so that stays a future opt-in with its own consent flow, not a default.
- ✅ Credit report import, referral partner tracking, owner-facing analytics dashboard, and CROA/state compliance enforcement are addressed in Module N below (some shipped this pass, some remain — see the deferred list at the bottom)

## Module N — Full "Complete Everything" Pass: Nudges, Compliance, Billing, MFA, Bank Linking, Portal UI, Governance

Triggered by the user pasting the full remaining 🔜/⏳ list from across this document and saying "we need to complete" all of it. Closed in this pass:

- ✅ **Readiness nudges** (`app/api/cron/readiness-nudges`): scans for clients who've crossed their score target or stack-capital target and opens a deduped `coach_tasks` entry rather than silently tracking it — a coach has to actually see "ready to advance" and act
- ✅ **AI stack-sequencing recommendation** (`lib/stacking/recommend.ts`, `app/api/stacking/recommend`): a hand-seeded reference table of 7 real business-credit-building lenders/products (`lender_criteria`), ranked by whether the client's business profile currently meets each one's criteria. Explicitly labeled a rules-of-thumb starting point in both the code and the API's `disclaimer` field — not a prediction model, no seed dataset of real approval outcomes exists yet to train one
- ✅ **Status sync back from AshleyIQ/conduit-next**: `app/api/integrations/funding-status-sync` (CreditCoachIQ's receiving side, Bearer `CONDUIT_STATUS_SYNC_KEY`) + conduit-next's `app/api/cron/credit-coach-status-sync` (the sending cron) — a real cross-company integration between two separate codebases/companies, not a mock. Found and fixed a real bug in the process: `app/api/journey/handoff/route.ts` still referenced the plaintext `business_credit_profiles.ein` column that an earlier security-hardening pass had already dropped in favor of `ein_last4`
- ✅ **State registration/bonding enforcement**: `state_compliance_status` table + a fail-closed gate in `app/api/enroll` — a state with no compliance row blocks enrollment rather than defaulting to allowed; `app/api/admin/state-compliance` for admins to manage the registration list
- ✅ **Coach/compliance audit log** (`app/api/admin/audit-log`, admin-only): a read-time aggregation of existing actor+timestamp columns (`credit_disputes.approved_by`, `loan_ready_checklist_items.verified_by`, `journey_stage_events.moved_by`) into one sorted feed — deliberately not a second, parallel audit table that could drift out of sync with the real data
- ✅ **Tier upgrade/downgrade billing** (`app/api/billing/change-tier`): Stripe subscription-item swap with `proration_behavior: 'create_prorations'` when a subscription already exists, or a Checkout Session when it doesn't yet; `app/api/billing/portal` for the standard Stripe billing-portal handoff
- ✅ **Step-up MFA, governance docs, portal UI, Calendly reschedule** — see Modules K and L above for the specifics
- ✅ **Plaid bank-account linking** (`lib/plaid.ts`, `app/api/portal/[token]/plaid/{link-token,exchange,accounts}`, `app/api/cron/plaid-sync`): real Plaid integration code (Link token creation, public-token exchange, cursor-based `/transactions/sync`), gated on `PLAID_CLIENT_ID`/`PLAID_SECRET`. Access tokens are AES-256-GCM encrypted at rest, same pattern as EIN. Unlike Lob's mock-mail mode, there's no fake "mock Link" — a fake Link token wouldn't render in Plaid's widget, so unconfigured shows as `{configured: false}` in the portal rather than a fake success
- 🔜 Credit report import (AI-parsed PDF upload), referral partner tracking, owner-facing analytics dashboard, e-signature module, in-system dialer, and the rest of the coach dashboard UI beyond the client portal — still queued, see the deferred list below

---

## Module O — Credit report import, referral tracking, analytics, and the rest of the coach dashboard

Closes the last four items from the original "complete everything" list.

- ✅ **Credit report import**: `lib/creditReport/parse.ts` uses Claude's native PDF document support (no separate OCR step) to extract bureau scores + tradelines directly from an uploaded PDF into the same shape `app/api/disputes/generate` already expects, so imported tradelines flow straight into the existing dispute pipeline. `app/api/credit-reports` (upload + parse + list), a private Supabase Storage bucket (`credit-report-uploads`), and a coach-facing upload page (`app/(dashboard)/credit-reports`). Disputability is an AI-assisted first pass, flagged conservatively — a coach still reviews every flagged tradeline before a letter goes out.
- ✅ **Referral partner tracking**: `referral_partners` (partner directory, referral codes, commission terms), `borrowers.referred_by_partner_id` (single-touch attribution), `referral_commission_events` (append-only commission log, same INSERT-only pattern as other audit tables). `app/api/enroll` now accepts an optional `referralCode` and attributes automatically. `app/api/referral-partners/*` (list with rollup stats, create, update, record a commission event) + `app/(dashboard)/referral-partners` UI.
- ✅ **Owner-facing analytics dashboard**: `lib/analytics.ts` computes MRR from live Stripe subscription data (not an approximated local price table), client outcomes (stage distribution, average score improvement, mortgage-ready count), average time-in-stage (from completed `journey_stage_events` transitions only — a client still sitting in a stage isn't counted until they move, so the average reflects actual duration, not a snapshot), and handoff conversion rate (funded / handoffs sent, via `borrowers.funding_status`). `app/api/analytics` (admin-only) + `app/(dashboard)/analytics` UI.
- ✅ **Rest of the coach dashboard**: `app/(dashboard)/caseload` (client list, sorted by longest-since-stage-change) and `app/(dashboard)/caseload/[borrowerId]` (the actual working view — journey-stage control, credit score + stacked capital + funding status at a glance, dispute-letter approval queue, goals, open tasks, recent calls, the dialer's "Call" button, and portal-access revoke/reissue). `app/api/coach/client/[borrowerId]` is the consolidated read behind it. **Scoping note**: stacking and wealth-coaching data are surfaced per-client on this detail page rather than as separate standalone list pages — that's how a coach actually works day to day, but if a portfolio-wide stacking or wealth view turns out to be wanted later, that's a new, smaller build on top of the same APIs, not a rework.

## What's genuinely deferred (not built this pass, and why)

- **No-show detection for bookings** — Calendly doesn't fire a distinct webhook for no-shows; would need a scheduled sweep of past-due `scheduled` call_bookings.
- **Login-notification email** for new-device portal access — noted in the security audit, not built.

## What's infeasible with current resources (not merely deferred)

These two items came up in the original deferred-items list phrased the same way as the "not built yet" items above, but they're a different category — there's no vendor API to integrate against, not just unbuilt code:

- **Direct lender-application API integrations for credit stacking** — most of the net-30 vendor-credit and small-business-card issuers relevant to stacking (Uline, Grainger, Home Depot Commercial, and most bank/card issuers at this tier) don't publish a partner API for submitting or tracking applications programmatically. This stays a coach-tracked manual workflow (`credit_stack_applications`, coach-entered) indefinitely, not just "until a later phase" — it would require individual lender partnership agreements, not just engineering time.
- **SmartCredit API integration** — SmartCredit doesn't offer a reseller/partner API for pulling a client's credit report into a third-party platform; what exists is an affiliate referral link (already built). Revisit only if EquityNest Capital negotiates direct API access with SmartCredit.

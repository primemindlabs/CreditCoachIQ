# CreditCoachIQ — Business & Product Strategy
### Proprietary credit coaching + wealth building platform, with a built-in path to funding

creditcoachiq.com · a proprietary EquityNest Capital product

**Ownership note:** CreditCoachIQ is not a PrimeMind Labs product. It's proprietary software built for and owned by **EquityNest Capital**, a separate company from PrimeMind Labs (which builds/owns AshleyIQ/conduit-next). The Stage 4 handoff into AshleyIQ (§1 below) is therefore a cross-company integration between two distinct businesses, not an internal handoff within one company — worth keeping in mind for the API-key/data-sharing agreement between the two, not just the technical Bearer-token mechanism already built.

**Revision note:** this replaces the earlier draft's "sell software to other credit repair agencies" framing. CreditCoachIQ is **not** a licensed SaaS product like Credit Repair Cloud or DisputeFox — it's proprietary internal tooling EquityNest Capital uses to deliver its *own* credit coaching and wealth-building service to its *own* clients. It's not a self-serve consumer app either. Real coaches, using this software, deliver a service. Everything below is revised around that.

---

## 1. What CreditCoachIQ actually is

A service-delivery platform for one operator (EquityNest Capital) running two coaching disciplines for one primary audience — people who want to become real estate investors:

- **Credit Coaching** (includes credit repair) — get a client's personal credit to where it needs to be.
- **Financial Coaching / Wealth Building** — get a client's finances, cash flow, and business credit ready to actually invest.

The flagship product isn't either service alone — it's the *path* that connects them to funding:

**Credit Coaching → Credit Stacking → Loan-Ready → handoff into AshleyIQ (conduit-next) to start the funding process.**

Competing with Credit Repair Cloud and DisputeFox is no longer the right comparison — they're tooling vendors with no end-client relationship. CreditCoachIQ's real competitive set is other **credit coaching / business funding consulting operations** (Fund&Grow, Credit Suite, various "credit stacking" shops) — except none of them have a funding-rail partner the way EquityNest Capital does through its AshleyIQ integration. That end-to-end path — coach a client's credit, stack their capital, then hand off into loan origination — is the actual moat, even though it now spans two companies rather than one.

---

## 2. Tiered plans

Three tiers, each mapping to how much of the client's journey they're paying for:

### Tier 1 — Credit Coaching
Personal credit repair/coaching only. AI-assisted dispute engine (see §4.1–4.2 from the prior draft, unchanged — that automation core still applies), score tracking, coach check-ins. Entry price point, broadest audience, not investor-specific.

### Tier 2 — Financial Coaching / Wealth Building
For clients who already have workable credit, or who've graduated Tier 1. Budgeting, debt-payoff strategy, cash-flow planning, savings/goal tracking, general investment-readiness education (see §5's compliance guardrail — coaching/education framing, not personalized securities advice).

### Tier 3 — Investor Path (the flagship, highest-margin tier)
The full pipeline: Credit Coaching → Credit Stacking → Loan-Ready → AshleyIQ handoff. This is the tier built specifically for someone who wants to buy investment property and needs both the credit and the capital to do it. Priced as a premium bundle (materially above Tier 1 + Tier 2 combined, since the AshleyIQ handoff and coach oversight represent the actual value — a client is buying a *path to a funded deal*, not just credit repair).

Each tier should have a defined **automation-to-coach ratio**: Tier 1 can run mostly automated (AI dispute drafting + coach approval), Tier 2 is coach-guided with AI-assisted planning tools, Tier 3 is white-glove — a coach actively manages the client through every stage transition, with automation doing the busywork (score tracking, document collection, stack-application sequencing, handoff packaging) so the coach's time goes to judgment calls, not paperwork.

---

## 3. The Investor Path — flagship client journey

This is the product to build the data model and automation around first, since it's the differentiator nothing else in the market offers end-to-end.

### Stage 1 — Credit Coaching
Same core dispute-automation engine described in the original draft (AI-drafted, Metro2-aware dispute letters; human-approval gate before mailing; e-OSCAR response-deadline tracking; score history). Exit criteria: personal credit score and profile cross a coach-defined threshold (e.g., 680+, no unresolved derogatories, utilization under a target).

### Stage 2 — Credit Stacking
A distinct product surface, not just "more credit repair" — this is business credit building. Business credit stacking is the strategic, sequenced opening of multiple 0% intro-APR business credit lines/cards to access capital (commonly $50K–$250K+) for down payments, rehab costs, or carrying costs, typically executed as a coordinated round of applications over 3–4 weeks. This needs its own tracked entities, distinct from personal credit:
- Business identity setup tracking (EIN, D-U-N-S number, business bureau files — Dun & Bradstreet PAYDEX, Experian Business, Equifax Business — these are different bureaus from personal credit and need their own monitoring).
- A **stack plan**: which lenders/cards, in what sequence, timed to maximize approval odds and total available capital — this is exactly the kind of sequencing problem an AI planner is good at, and it's a genuine automation opportunity nobody in the credit-repair-software space is building (CRC/DisputeFox don't touch business credit at all).
- Application tracking per card: lender, approved limit, 0% promo end date, minimum payment obligations — the promo-period deadline is a hard date that needs proactive client alerts (this isn't free money, it converts to normal APR if not managed).
- Aggregate "capital available" rollup per client — this number is what tells the coach (and eventually AshleyIQ) how much the client can actually bring to a deal.

Exit criteria: target stack capital reached, no revolving utilization red flags, business credit files established.

### Stage 3 — Loan-Ready
A defined, coach-verified checkpoint — not automatic. Combines: personal credit score threshold, DTI within range, stacked capital available, and (if applicable) entity documentation in order. This is a clean place for a coach sign-off step before handoff, both for quality control and because it's the natural moment to package everything AshleyIQ's underwriting will want to see.

### Stage 4 — Handoff into AshleyIQ
This is where `lib/integrations/conduit-client.ts` (already scaffolded in the extraction) earns its keep — not as a loose "referral," but as a structured handoff: push the client's profile, credit trajectory, and stacked-capital summary into conduit-next as a qualified, loan-ready lead, pre-populated rather than starting cold. Worth building the reverse direction too — conduit-next already has `investor_entities`, `investor_properties`, `borrower_entity_links`, and `loan_entity_links` tables from earlier schema review, which suggests AshleyIQ already has investor-specific loan tooling; CreditCoachIQ's Tier 3 output should be shaped to drop directly into those tables rather than requiring re-entry.

**Data model implication:** add a `client_journey_stage` (or similar) field to `borrowers`, plus new tables for `business_credit_profiles`, `credit_stack_plans`, and `credit_stack_applications`. This is a genuinely new domain, not a relabeling of the personal-credit-repair tables already extracted.

---

## 4. Automation requirements (carried over, still applies)

The dispute-automation core from the original draft doesn't change — it's still the engine under Stage 1:

- AI-drafted, Metro2-aware dispute letters with a **human-approval gate before mailing** — non-negotiable; this is what keeps "AI-assisted" from becoming "AI-fabricated disputes" in a regulator's eyes.
- Mail automation via Lob (`lob_letter_id`/`lob_status` already in the schema) and e-OSCAR-aware response-deadline tracking with auto-escalation (initial → method-of-verification → CFPB complaint).
- Outcome capture (OCR bureau responses, update dispute status, feed results back into the letter-drafting model).
- Full audit trail on every AI-generated letter — which item, which legal theory, what evidence — defensible recordkeeping if a furnisher or regulator challenges a dispute.

What changes is *who* this serves: not a multi-tenant SaaS customer base, but EquityNest Capital's own coaching staff working EquityNest Capital's own clients. That actually simplifies a few things — no need to build self-serve org signup, external billing-per-seat, or a white-label theming system. Build internal coach tooling (caseload views, task queues, client messaging) instead of agency-onboarding flows.

---

## 5. Compliance guardrails (carried over, refined)

- **CROA still applies in full**, regardless of the business model correction — no advance fees, mandatory 3-business-day right-to-cancel enforced in the enrollment flow (not just logged), signed Consumer Rights Statement, no guaranteed-results language in any AI-generated client-facing copy.
- **State credit-services-organization laws** — registration/bonding/fee-cap requirements vary by state; track compliance status per state you're actively coaching clients in.
- **Wealth-building/coaching stays education and planning, not personalized securities advice.** The moment guidance becomes "buy this specific investment" for a specific client for compensation, that's RIA-registration territory (SEC/state licensing, fiduciary duty, Form ADV, a compliance officer). Real estate investment *coaching* generally sits outside securities regulation, but stay disciplined about the distinction — frame Tier 2/3 wealth guidance as education, cash-flow planning, and deal-readiness coaching, not "here's what to buy."
- **Credit stacking has its own honesty bar**: 0% promo periods are deferred interest, not free money — client-facing materials need to say so plainly, and the product should proactively alert clients before a promo period converts to standard APR.

---

## 6. Suggested build order (revised)

1. **Finish the personal-credit-repair extraction** — the borrower-portal routes/pages and a client-facing magic-link auth scheme still flagged in `MIGRATION_NOTES.md`.
2. **CROA-compliant enrollment + billing flow** for whichever tier a client signs up for.
3. **AI dispute engine v1 with human-approval gate** — the Stage 1 engine.
4. **Client journey/stage model** — add `client_journey_stage`, wire up coach-facing stage-transition UI (this is now higher priority than it was in the SaaS framing, since the journey *is* the product).
5. **Credit-stacking module** — business credit profile tracking, stack planning, application tracking, promo-deadline alerts. New domain, biggest differentiation opportunity.
6. **AshleyIQ handoff integration** — build both directions of `conduit-client.ts`'s counterpart in conduit-next, mapped to `investor_entities`/`investor_properties`.
7. **Internal coach tooling** — caseload dashboard, task queues, client messaging (replaces the "agency onboarding" priority from the earlier draft, which no longer applies).
8. **Wealth-coaching v1** — budgeting/debt/goal planning, framed as education, under Tier 2/3.
9. **State compliance tracker** — per-state registration/bonding status.

---

## 7. Open questions worth deciding before Stage 2/3 get built

- What's the coach-defined threshold for "loan-ready" — a fixed rubric, or judgment call per client? Worth codifying even loosely, since it's the gate before a client's data flows into AshleyIQ.
- Does credit stacking involve a lending/broker relationship of its own (helping clients apply for business credit cards) — if so, is there a separate compliance posture needed there (some states regulate credit-services referral activity even when no fee is charged for the referral itself)?
- Pricing for Tier 3: flat monthly, or a hybrid with a success fee tied to reaching loan-ready status (common in coaching/consulting models, but revisit against CROA's fee-timing rules if any part of Tier 3 touches personal credit repair specifically).

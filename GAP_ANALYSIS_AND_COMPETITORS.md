# CreditCoachIQ — Full Business-Domain Gap Analysis & Competitive Comparison

CreditCoachIQ isn't trying to be a licensed SaaS competitor to these tools — it's EquityNest Capital's internal platform for its own coaches and clients (see `STRATEGY.md`). But the honest way to know if it can actually replace buying one of these tools is to compare it feature-for-feature anyway. This pass reviewed the built system against every operational area a real credit-repair-and-coaching business runs, plus the three tools most likely to be the "why don't we just use X instead" question: **Credit Repair Cloud**, **DisputeFox**, **Client Dispute Manager (CDM)**, and — because most independently-run credit repair shops actually lean on it for the marketing/automation layer — **GoHighLevel**.

## Competitive feature comparison

| Capability | CreditCoachIQ | Credit Repair Cloud | DisputeFox | Client Dispute Manager | GoHighLevel (credit-repair setups) |
|---|---|---|---|---|---|
| Branded client portal | ✅ (token-auth, API built; UI pending) | ✅ | ✅ (mobile app too) | ✅ | ✅ (via funnels/membership) |
| Dispute letter automation | ✅ (AI-drafted, human-approval gate) | ✅ (150+ templates, questionnaire-driven) | ✅ (Metro2-aware) | ✅ | ⚠️ (not native — bolted on) |
| Print & mail dispute letters | ⚠️ (Lob fields exist, not wired to a send flow this pass) | ✅ | ✅ (print/mail + fax) | ✅ | ❌ |
| Credit report parsing/import | ❌ (manual entry only) | ✅ (import tools) | ✅ (one-click import) | ✅ | ❌ |
| SMS/phone dialer in-app | ✅ (SMS via Twilio, consent-gated) | ✅ | ✅ (built-in dialer, industry-first) | ✅ | ✅ (core strength) |
| Visual campaign/automation builder | ⚠️ (full data model + API; canvas UI pending) | ✅ | ✅ | ⚠️ (email-focused) | ✅ (best-in-class) |
| AI-personalized coaching/consult prep | ✅ (Haiku quiz summary — none of the others do this) | ❌ | ❌ | ❌ | ⚠️ (generic AI add-ons only) |
| Pre-call intake quiz w/ path scoring | ✅ (built this pass — a genuine differentiator) | ❌ | ❌ | ❌ | ⚠️ (buildable via forms, not native) |
| Call booking w/ plan-tier limits | ✅ (Calendly-backed) | ❌ | ❌ | ❌ | ✅ (calendar feature, no tier-limit logic) |
| 2FA / portal security | ⚠️ (hardened this pass — token hashing, access log, revocation; MFA step-up not yet built) | — | ✅ (advertised headline feature) | — | — |
| E-signature (contracts, CROA disclosure) | ❌ | ✅ | ✅ | ✅ | ✅ (via forms/docs) |
| Billing/invoicing, payment history | ⚠️ (Stripe customer + subscription created; no dunning/invoice UI) | ✅ | ✅ | ✅ (cash/check + electronic) | ✅ |
| State compliance rule tracking | ⚠️ (schema placeholder only) | ✅ (tracks state-by-state rules) | ⚠️ | ⚠️ | ❌ |
| Affiliate/reseller management | ❌ (not applicable — proprietary internal tool) | ✅ | — | — | ✅ |
| **Credit stacking / business credit** | ✅ (unique — none of these do this) | ❌ | ❌ | ❌ | ❌ |
| **Wealth coaching (budgets, debt payoff, goals)** | ✅ (unique — none of these do this) | ❌ | ❌ | ❌ | ❌ |
| **Investor-path handoff into a mortgage CRM** | ✅ (unique — this is the actual moat) | ❌ | ❌ | ❌ | ❌ |
| Training / "business in a box" content | ❌ (not needed — internal tool, not sold) | ✅ | ⚠️ | ✅ | ❌ |

**Read on this table:** CreditCoachIQ's real competitive edge isn't matching these tools feature-for-feature on dispute-letter mechanics — it's the four rows at the bottom that none of them touch at all: credit stacking, wealth coaching, an AI-scored intake quiz, and the AshleyIQ handoff. That's the actual product. But it's currently behind all four incumbents on things a credit-repair operator would consider baseline: credit-report import/parsing, e-signature, and a wired-up print-and-mail flow. Those are the gaps most likely to make a coach's day-to-day workflow feel worse than what they'd get from Credit Repair Cloud alone.

## Full operational gap checklist

Organized by what a credit-repair-and-coaching business actually runs, not by module name.

**Sales & intake**
- ✅ Enrollment, journey-stage tracking, intake quiz with AI-scored path recommendation
- ❌ Marketing landing pages / lead-capture funnels — CreditCoachIQ assumes leads arrive already (from conduit-next, a referral, or manual entry); there's no top-of-funnel capture tool. Not necessarily a gap given the proprietary/internal model, but worth confirming marketing lives elsewhere (a GHL-style funnel tool, or conduit-next's own lead gen).
- ❌ E-signature for the enrollment contract and CROA Consumer Rights Statement — this is a **compliance gap, not a nice-to-have**. CROA requires a signed contract and disclosure before work begins; right now that flow isn't built (flagged since the original extraction as the borrower-portal auth gap, and still open even with the portal API now built).

**Credit repair operations**
- ✅ Enrollment, dispute drafting (AI + human approval), monitoring/alerts, e-OSCAR-aware response tracking
- ❌ Credit report import/OCR — every competitor reviewed here can import a bureau PDF and auto-populate tradelines; CreditCoachIQ requires manual entry. This is the single biggest day-to-day efficiency gap versus the incumbents.
- ⚠️ Print-and-mail dispute letters — Lob-related fields exist in the schema from the original extraction, but there's no wired send flow yet (a coach would need to mail letters manually today).

**Financial/wealth coaching**
- ✅ Goals, avalanche/snowball debt-payoff calculator, budgets — none of the competitor tools reviewed offer this at all, so there's nothing to catch up to here; this is greenfield differentiation.

**Credit stacking / investor path**
- ✅ Business credit profiles (now EIN-encrypted), stack plans, application tracking, promo-APR expiration alerts, AshleyIQ handoff — entirely unique in this competitive set.

**Client communication**
- ✅ Two-way portal messaging, campaign/drip automation, SMS+email with consent gating
- ❌ In-app phone dialer / call logging — DisputeFox and GoHighLevel both treat this as core; CreditCoachIQ relies on Calendly + external phone, no call-log record tied to a client.

**Billing & payments**
- ⚠️ Stripe customer + subscription created at enrollment; no dunning/failed-payment recovery flow, no coach-facing invoice history view, no refund workflow. CROA's advance-fee ban means billing timing matters legally, not just operationally — worth a dedicated pass.

**Compliance & recordkeeping**
- ⚠️ `state_compliance_status` exists as a schema placeholder with no enforcement logic (no gate that blocks onboarding a client in a state where the org isn't registered/bonded)
- ❌ No documented record-retention policy or automated retention/deletion (see `SECURITY_AUDIT.md`)
- ❌ No formal complaint-handling/dispute-resolution log — CROA-adjacent best practice, and useful even without a legal mandate

**Team & operations**
- ✅ Coach caseload view, task queue, quiz review queue
- ⚠️ Only two roles exist (`admin`, `coach`) — no processor/sales-rep/closer distinction that many multi-person shops use; fine for a small team, a gap once EquityNest Capital staffs up
- ❌ No owner-facing analytics dashboard (revenue, client outcomes, average time-in-stage, handoff conversion rate) — flagged as 🔜 in `FEATURES.md` Module G, still not built

**Data & security**
- ✅ Addressed this pass — see `SECURITY_AUDIT.md` for the full breakdown (EIN encryption, hashed portal tokens, access logging, revocation, security headers)
- ⚠️ MFA/step-up auth, WISP, vendor review, retention policy, incident response plan — all flagged as decisions needed, not yet built

## Bottom line

The parts of CreditCoachIQ that are unique — credit stacking, wealth coaching, the AI intake quiz, the AshleyIQ handoff — have no equivalent in any of the four tools reviewed, and that's the actual business case for building this instead of just buying Credit Repair Cloud and calling it done. But the parts that are *supposed* to be table stakes — credit report import, e-signature, print-and-mail, billing lifecycle — are behind every one of them right now. If a coach used CreditCoachIQ today for the credit-repair side alone, they'd notice the missing OCR import and e-signature immediately. Recommended next build priority, in order: **(1) e-signature for CROA compliance — this is a legal gap, not a UX one, (2) credit report import/parsing, (3) print-and-mail dispute-letter send flow, (4) billing/invoicing lifecycle.**

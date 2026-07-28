# CreditCoachIQ — Client Portal Security Audit

Triggered by: "we need the client portal to be secure because it has personal info." This covers the portal specifically, but the regulatory findings below (GLBA, FCRA, CROA) apply to CreditCoachIQ as a whole, not just the portal.

## The regulatory ceiling, not just "best practice"

This isn't a generic SaaS security list — CreditCoachIQ almost certainly falls under the **FTC Safeguards Rule (GLBA, 16 CFR Part 314)**. The rule's "financial institution" definition explicitly names **credit counselors** and **investment/financial advisors** among covered entities, and the FTC has applied it broadly to businesses offering financial advisory services. The 2021 amendments (enforceable since June 2023) turned what used to be a flexible guideline into specific technical requirements: a written information security program, a designated "Qualified Individual" who owns it, encryption of customer information at rest and in transit, **multi-factor authentication for access to customer information systems**, access controls, vendor oversight, penetration testing/monitoring, an incident response plan, and — as of the most recent amendments — a **breach notification obligation** to the FTC for incidents affecting 500+ consumers. Regulators are actively enforcing this in 2026; "we're a small shop" is not an exemption.

Two other frameworks apply directly:
- **CROA** (federal) — governs the credit-repair side specifically: written contracts, the Consumer Rights Statement, the 3-day cancellation right, no advance fees. State credit-services-organization laws layer on top (registration, bonding, fee caps) and vary by state — already tracked as a schema placeholder (`state_compliance_status`), not yet enforced.
- **FCRA** — anyone pulling or handling a credit report needs a documented permissible purpose and the consumer's authorization on file. CreditCoachIQ doesn't pull reports directly (SmartCredit referral link only), but if a coach ever manually enters data from a report a client shared, that data is still "consumer report information" and inherits FCRA handling expectations.

## What was fixed in this pass (code, done)

These were concrete gaps found by reading the actual schema/routes, not hypothetical:

1. **EIN was stored in plaintext.** `business_credit_profiles.ein` was a bare `text` column — the one piece of data in the whole schema that looked most like an SSN-adjacent identifier and wasn't encrypted, while conduit-next already has an established AES-256-GCM pattern (`lib/crypto/encrypt.ts`) for exactly this class of data. Ported that pattern, migrated the column to `ein_encrypted` + `ein_last4`, and the API now only returns the full EIN when explicitly requested (`?reveal=true`) — list views show `••••1234` by default.
2. **Portal tokens were stored as plaintext bearer credentials.** The original design stored the raw magic-link token in the database and reused it as a bearer credential on every request. A database leak (backup export, misconfigured replica, insider access) would have handed out live access to every active client portal. Tokens are now hashed (SHA-256) before storage — the raw token exists only in the one-time link sent to the client and is **never written back to the database**, matching how password-reset tokens are supposed to work.
3. **No access logging.** There was no record of who accessed a client's portal, when, from where, or whether an access attempt failed. `portal_access_log` now records every verify attempt (success, failure, expired, revoked) with IP and user-agent — this is table stakes for GLBA's "monitoring" safeguard and for actually investigating an incident if one happens.
4. **No revocation.** Once a portal link existed, there was no way to kill it. `POST /api/coach/portal-access` now lets a coach immediately revoke a client's access (suspected compromise, client offboarded, wrong person on the thread) or reissue a fresh link (which implicitly revokes the old one).
5. **No security headers.** `next.config.mjs` had none. Added HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, a `Permissions-Policy` locking down camera/mic/geolocation, and a `Content-Security-Policy` scoped to what the app actually needs (Supabase, Calendly's embed frame).

## What's still open — needs a decision, not just code

These are real gaps, but each involves a choice (cost, vendor, or UX tradeoff) worth confirming before I build it:

- **Multi-factor / step-up auth for the portal.** GLBA's amended rule specifically calls out MFA for access to customer information systems. A magic link alone doesn't provide a second factor — anyone with the link (forwarded email, shared inbox, browser autofill on a shared device, a screenshot) has full access. The practical fix: require a short email-delivered one-time code the first time a session starts on a new device, then keep the session light after that (don't re-verify on every click). This needs a decision on friction level — a code on every visit is more secure but feels less "seamless."
- **A written WISP (Written Information Security Program).** This is the actual GLBA deliverable — a document, reviewed and owned by a named person, covering risk assessment, safeguards, vendor oversight, and incident response. I can draft one, but adopting it (assigning a Qualified Individual, doing the first risk assessment, getting sign-off) is a business decision, not a code change.
- **Vendor risk review.** GLBA requires oversight of service providers that touch customer information — that's Supabase, Resend, Twilio, Stripe, Calendly, and Anthropic in this stack. Each needs a quick check: do they sign a DPA, where's data hosted, do they support the access controls you need. Worth a short pass, not urgent this week.
- **Data retention & deletion policy.** Nothing currently purges old quiz answers, dispute records, or portal messages. CROA-adjacent recordkeeping generally expects records kept (not deleted) for a period after the relationship ends, but there's no explicit *upper bound* policy either — and if a client requests deletion, there's no delete flow. Needs a retention period decision (state law will set a floor).
- **Formal incident response plan.** The 2023 Safeguards amendments require a documented plan and, above a threshold, breach notification to the FTC. This is a policy document + a designated contact, not code.
- **Annual penetration test / vulnerability scan.** Required under the amended rule for larger programs; worth budgeting even at small scale given the enforcement posture in 2026.

## Lower-priority, worth doing eventually

- Rate-limiting / anomaly detection on portal endpoints beyond what token entropy already provides (the 256-bit token itself is not brute-forceable — the risk is leakage, not guessing, which is why hashing + revocation mattered more than rate limits here).
- Calendly `invitee.rescheduled` webhook handling (currently only create/cancel).
- Login notification email when a portal session starts from a new device — deliberately not built yet since it risks feeling spammy on top of a step-up MFA flow; revisit once the MFA decision is made so they're designed together.

## Competitive note

DisputeFox advertises 2FA as a headline security feature. Whatever CreditCoachIQ ships should at minimum match that bar for anything touching the portal — that's the strongest argument for prioritizing the step-up-auth decision above.

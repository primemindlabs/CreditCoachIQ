# EquityNest Capital — Written Information Security Program (WISP)

Covers CreditCoachIQ and any other system EquityNest Capital uses to handle client credit, financial, and personal information. Required under the FTC Safeguards Rule (16 CFR Part 314), which applies here because EquityNest Capital operates as a credit-counseling/financial-advisory business under the Rule's definition of "financial institution."

**Status: draft template.** This needs a named owner and a signature before it's a real program rather than a document. Fill in the bracketed fields and adopt it formally (dated, signed by the Qualified Individual) to satisfy the Rule's requirement.

## 1. Qualified Individual

The Rule requires one named person responsible for this program.

- **Qualified Individual:** [Name / Title]
- **Reports to:** [Owner / Board, as applicable]
- **Review cadence:** at minimum annually, and after any material system change (new integration, new data type collected, security incident)

## 2. Scope

This program covers: CreditCoachIQ (Next.js/Supabase application), its Supabase database (client PII, credit data, financial goals/budgets, business entity/EIN data), the vendors listed in `VENDOR_RISK_REVIEW.md`, and any staff device used to access client data.

## 3. Risk assessment (initial)

| Risk | Likelihood | Impact | Current mitigation |
|---|---|---|---|
| Portal token leaked via email forwarding/shared device | Medium | High | Token hashed at rest, revocable, access-logged (`SECURITY_AUDIT.md`); MFA step-up on new sessions |
| Database backup/export exposes client PII | Low | High | Supabase encrypts at rest by default; EIN additionally application-layer encrypted (AES-256-GCM) |
| Compromised coach Clerk account | Low | High | Clerk session auth, role-based access (admin/coach); recommend enabling Clerk's MFA requirement for all coach accounts |
| Vendor breach (Resend, Twilio, Supabase, Stripe, Calendly, Anthropic) | Low-Medium | Medium-High | See `VENDOR_RISK_REVIEW.md` |
| Dispute letter mailed with incorrect/AI-hallucinated content | Low | Medium | Human-approval gate — AI drafts, a coach reviews and edits before `POST /api/disputes/send` |
| Lost/stolen staff laptop with an active session | Medium | Medium | [Needs a device policy — recommend disk encryption + short session timeouts, not yet formally adopted] |

Re-run this assessment at least annually and log the date/reviewer below.

| Date | Reviewer | Notes |
|---|---|---|
| [ ] | | |

## 4. Safeguards

**Access controls**
- Coach/admin access is Clerk-session-authenticated; roles (`admin`, `coach`) gate admin-only routes (audit log, state-compliance settings)
- Client portal access is magic-link token based, hashed at rest, individually revocable (`app/api/coach/portal-access`)
- [ ] Recommend: require MFA on all staff Clerk accounts (Clerk supports this natively — a config change, not new code)

**Encryption**
- Data at rest: Supabase-managed encryption (database volume) + application-layer AES-256-GCM for EIN (`lib/crypto/encrypt.ts`)
- Data in transit: TLS enforced by Vercel/Supabase by default; HSTS header set (`next.config.mjs`)

**Monitoring**
- `portal_access_log` records every client-portal access attempt (success/failure/expired/revoked)
- `journey_stage_events`, `credit_disputes.approved_by`, `loan_ready_checklist_items.verified_by` provide an actor+timestamp trail for key actions, surfaced to admins via `app/api/admin/audit-log`

**Disposal**
- [ ] Not yet formally defined — see `DATA_RETENTION_POLICY.md` for the draft retention schedule this program should adopt

**Vendor oversight**
- See `VENDOR_RISK_REVIEW.md`

## 5. Incident response

See `INCIDENT_RESPONSE_PLAN.md`.

## 6. Testing

- [ ] No penetration test or vulnerability scan has been performed yet. The amended Safeguards Rule expects continuous monitoring or annual penetration testing + biannual vulnerability scanning for programs of this scope. Budget for this before/at the point of handling real client data at meaningful volume.

## 7. Training

- [ ] No formal security-awareness training program exists yet for coaches/staff. Minimum viable version: a written onboarding checklist covering password hygiene, phishing awareness, and the "never paste a client's full SSN/EIN into chat/email" rule.

# Incident Response Plan (draft)

The FTC Safeguards Rule's 2023 amendments require a documented incident response plan and, for incidents affecting 500+ consumers, notification to the FTC within 30 days of discovery. This is a draft to adopt and staff, not yet exercised.

## 1. Who to notify first

- **Internal:** [Qualified Individual from `WISP.md`] — immediately upon suspected incident, before public disclosure or client notification
- **Legal counsel:** [Name/firm] — before any external communication, to confirm notification obligations under CROA, GLBA, and applicable state breach-notification laws (these vary by state and by data type involved)

## 2. Immediate containment steps

For a suspected portal-token compromise:
1. `POST /api/coach/portal-access {borrowerId, action: 'revoke'}` for the affected client(s) immediately.
2. Check `portal_access_log` for that borrower to see what was actually accessed (this is why the log exists).
3. Reissue a fresh token only once the compromise vector is understood (don't reissue immediately if the leak source — e.g. a compromised coach account — is still active).

For a suspected Clerk/coach-account compromise:
1. Suspend the affected user in Clerk's dashboard immediately.
2. Review `journey_stage_events`, `credit_disputes` (`approved_by`), and `loan_ready_checklist_items` (`verified_by`) for actions taken by that account in the suspected window — the admin audit log (`app/api/admin/audit-log`) surfaces exactly this.
3. Rotate `SUPABASE_SERVICE_ROLE_KEY` and any API keys the account could have accessed if there's reason to believe secrets were exposed.

For a suspected database/vendor-level breach:
1. Contact the vendor's security team per their incident process.
2. Assess scope using `portal_access_log` and Supabase's own audit logs (if enabled — confirm this is turned on).
3. Determine if the 500-consumer FTC notification threshold is met; if uncertain, involve counsel rather than guessing.

## 3. Client notification

- Determine legal obligation (varies by state — some states require notification regardless of a federal threshold).
- Draft notification: what happened, what data was involved, what's being done, what the client should do (e.g., monitor credit reports — ironic but appropriate given the business).
- [ ] No pre-drafted notification template exists yet — draft one before it's needed under time pressure.

## 4. Post-incident

- Document the incident, root cause, and remediation in a dated log (kept outside the affected system if the system itself was compromised).
- Update `WISP.md`'s risk assessment table with the new/confirmed risk and its mitigation.
- If the incident revealed a gap in this plan, update the plan itself.

## Still needed
- [ ] Fill in the named contacts (Qualified Individual, legal counsel)
- [ ] Confirm whether Supabase's own audit logging is enabled at the project level (separate from `portal_access_log`, which only covers the client-portal surface)
- [ ] Pre-draft a client notification template
- [ ] Run a tabletop exercise at least once before a real incident forces the first real test of this plan

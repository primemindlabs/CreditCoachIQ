# Data Retention & Deletion Policy (draft)

No retention/deletion logic is implemented yet — this document proposes the schedule; implementing the automated purge/export jobs is separate follow-up work once the schedule below is confirmed.

## Proposed retention periods

| Data | Proposed retention | Rationale |
|---|---|---|
| CROA contract + Consumer Rights Statement | 5 years after relationship ends | Matches common state credit-services-organization recordkeeping expectations (varies by state — confirm against each state in `state_compliance_status`) |
| Dispute letters + bureau responses (`credit_disputes`) | 5 years after relationship ends | Same rationale — evidence of compliant dispute handling |
| Portal access logs (`portal_access_log`) | 2 years rolling | Security/incident-response value diminishes after this; balances storage cost against investigative usefulness |
| Portal messages (`portal_messages`) | Retained with the client record; deleted on formal deletion request (see below) | No independent compliance reason to keep beyond the relationship |
| Quiz responses (`intake_quiz_responses`) | Retained with the client record | Low sensitivity beyond what's already in the coaching record |
| Financial data (budgets, debts, goals) | Retained with the client record; deleted on request | No independent regulatory retention requirement identified |
| Plaid-linked transaction data (if enabled) | 90 days rolling, then aggregate-only | Minimizes exposure of granular transaction history; budgeting insights don't need indefinite raw transaction retention |
| EIN (encrypted) | Retained with the business_credit_profile; deleted when the profile is deleted | No independent retention requirement beyond the coaching relationship |

## Deletion requests

No self-service deletion flow exists yet. Proposed process until one is built:
1. Client requests deletion via portal message or direct contact.
2. Coach/admin verifies identity, then manually deletes the `borrowers` row (cascades to nearly all related tables per the schema's `ON DELETE CASCADE` foreign keys — confirm this before relying on it, a few tables use `ON DELETE SET NULL` instead, e.g. `call_bookings.borrower_id`).
3. Log the deletion date and requester outside the database (since the record itself will be gone) — a simple dated entry in an admin-only log is sufficient at this scale.

## Still needed
- [ ] Confirm retention periods against each state's actual credit-services-organization statute (the 5-year figures above are a reasonable default, not verified per-state)
- [ ] Build an automated purge job for the rolling-retention items (portal_access_log, Plaid transactions) once volume makes manual cleanup impractical
- [ ] Build a formal self-service deletion request flow in the client portal

# Vendor Risk Review

GLBA Safeguards Rule requires oversight of service providers that touch customer information. Each vendor CreditCoachIQ relies on, what it touches, and what to verify before (or as soon as possible after) sending it real client data.

| Vendor | What it touches | DPA/BAA available? | Verify |
|---|---|---|---|
| **Supabase** | Full database — all client PII, credit data, financial data, EIN (encrypted) | Yes, standard DPA on paid plans | Confirm the org is on a plan with a signed DPA; confirm database region matches any data-residency expectations |
| **Clerk** | Coach identity, auth tokens (not client PII directly) | Yes | Confirm DPA on file; enable MFA requirement org-wide (see WISP §4) |
| **Stripe** | Payment method, billing history (not full card numbers — Stripe is PCI-compliant by design) | Yes, standard | No action needed beyond standard account setup |
| **Resend** | Client email addresses, message content | Check current DPA availability | Confirm before sending client PII in email bodies (already limited to tokens like score/capital, not SSN/EIN) |
| **Twilio** | Client phone numbers, SMS content | Yes | Confirm DPA; confirm TCPA consent capture (`sms_consent`) is enforced before every send (already is — see `lib/messaging/enroll.ts`) |
| **Anthropic** | Prompts sent for dispute-letter drafting, quiz summaries — includes client name, dispute reason, self-reported score | Check current terms for the account tier in use | Confirm no full SSN/EIN is ever included in a prompt (currently true — dispute letters use name/address/account-last-4, not SSN) |
| **Lob** | Client name, mailing address, dispute letter content (mailed to bureaus) | Yes | Confirm DPA before enabling live (non-mock) sending |
| **Calendly** | Client name, email, booking time | Yes | Standard account-level DPA |
| **Plaid** (if enabled) | Bank account credentials (via Plaid Link, never touches CreditCoachIQ directly) + transaction data | Yes | Required before enabling — Plaid Link tokens are the vendor's mechanism specifically so raw bank credentials never reach CreditCoachIQ's servers |

## Action items
- [ ] Confirm/collect signed DPAs for every vendor above before onboarding real (non-test) clients
- [ ] Re-review this list whenever a new vendor/integration is added (Calendly, Plaid, and Lob were all added in later build passes — this list needs to stay current as part of the same process, not a one-time exercise)
- [ ] Assign an owner (likely the WISP's Qualified Individual) to re-verify this annually

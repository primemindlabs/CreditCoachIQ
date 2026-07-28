# CreditCoachIQ — Go-Live Guide (Core App)

Scope: get the actual product live — auth, database, coach dashboard, client portal,
AI dispute letters — on Supabase + Clerk + Vercel + an Anthropic key. Billing (Stripe),
SMS (Twilio), email (Resend), certified mail (Lob), bank-linking (Plaid), and Calendly
booking are all built to stay **inert** until their env vars are set, so skipping them
today does not break anything — you can turn each on later without a code change.

Project folder (on this Mac): `/Users/ashley/CreditCoachIQ OS`

Anywhere you see `$KEY` below, that's a value you'll paste in from a dashboard —
nothing here asks you to hand credentials to Claude; you're pasting directly into
Vercel's own settings UI.

---

## 0. One-time local check (do this first)

This codebase was authored file-by-file and has never actually been compiled — worth
catching any typo/import error locally before it becomes a broken Vercel deploy.

```bash
cd "/Users/ashley/CreditCoachIQ OS"
npm install
npm run typecheck
npm run build
```

Fix anything that surfaces here before continuing. (If you'd rather I do this pass,
say so once my sandbox terminal is back — it's been down all session; your local
Terminal will work fine in the meantime.)

---

## 1. Push to GitHub

```bash
cd "/Users/ashley/CreditCoachIQ OS"
git init
git add .
git commit -m "Initial commit: CreditCoachIQ"
git branch -M main
gh repo create creditcoachiq --private --source=. --remote=origin --push
```

No `gh` CLI? Create the repo manually at github.com/new (private), then:

```bash
git remote add origin https://github.com/<your-username>/creditcoachiq.git
git push -u origin main
```

---

## 2. Create the Supabase project

1. supabase.com → New project → name it `creditcoachiq` → pick a region → set a
   strong database password (save it somewhere).
2. Once provisioned, go to **Project Settings → API** and copy three values:
   - `Project URL` → this is `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (never expose this client-side)
3. Run the migrations, **in order**, via the SQL Editor (Supabase dashboard → SQL
   Editor → New query → paste → Run), one file at a time:

   ```
   supabase/migrations/0001_init_credit_coach_schema.sql
   supabase/migrations/0002_client_journey_stacking_wealth.sql
   supabase/migrations/0003_campaigns_automation.sql
   supabase/migrations/0004_client_portal_quiz_booking.sql
   supabase/migrations/0005_security_hardening.sql
   supabase/migrations/0006_nudges_stacking_compliance_billing.sql
   supabase/migrations/0007_plaid_sync_cursor.sql
   supabase/migrations/0008_croa_signature_record.sql
   supabase/migrations/0009_dialer_call_logs.sql
   supabase/migrations/0010_credit_report_upload_bucket.sql
   supabase/migrations/0011_referral_partners.sql
   ```

   (If you have the Supabase CLI installed and linked, `supabase db push` runs all
   eleven in order automatically — same result, less clicking.)

4. Sanity check: Table Editor should now show `organizations`, `profiles`,
   `borrowers`, `credit_repair_enrollments`, etc. — 30+ tables.

---

## 3. Create the Clerk app

1. clerk.com → Create application → name it `CreditCoachIQ`.
2. **Configure → Organizations → enable Organizations.** This is required —
   `lib/auth/orgContext.ts` reads the Clerk org claim to resolve every tenant, and
   every table's RLS policy keys off it.
3. **API Keys** page → copy:
   - `Publishable key` → `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
   - `Secret key` → `CLERK_SECRET_KEY`
4. No custom sign-in/sign-up pages exist in this codebase yet — Clerk's own hosted
   Account Portal handles login out of the box, so this isn't a blocker for today.
   (Custom-branded auth pages would be a follow-up, not a launch blocker.)

---

## 4. Get an Anthropic API key

console.anthropic.com → API Keys → Create Key → this is `ANTHROPIC_API_KEY`.
Powers AI dispute-letter drafting, the quiz's coach-prep summary, and the
credit-report PDF parser.

---

## 5. Set environment variables in Vercel and deploy

Vercel → Add New Project → import the `creditcoachiq` GitHub repo → before the
first deploy, open **Environment Variables** and add:

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | from step 2 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from step 2 |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 2 |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | from step 3 |
| `CLERK_SECRET_KEY` | from step 3 |
| `ANTHROPIC_API_KEY` | from step 4 |
| `NEXT_PUBLIC_APP_URL` | your Vercel URL, e.g. `https://creditcoachiq.vercel.app` (set after first deploy, then redeploy) |
| `CRON_SECRET` | any random string — generate with `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | 64 hex chars — generate with `openssl rand -hex 32` (protects EIN/sensitive fields at rest) |
| `CREDIT_ALERTS_LIVE` | `false` |

Everything else in `.env.example` (Stripe, Twilio, Resend, Lob, Plaid, Calendly,
CONDUIT_*) can stay unset — those modules detect the missing keys and degrade
gracefully rather than erroring.

Click **Deploy**.

---

## 6. Smoke test

1. Visit the deployed URL → sign up → confirm a `profiles` + `organizations` row
   appears in Supabase (Table Editor) for your new account.
2. Add a test borrower from the coach dashboard.
3. Try the AI dispute-letter draft flow on a test tradeline — confirms
   `ANTHROPIC_API_KEY` is wired correctly.
4. Check `/api/cron/process-campaigns` and `/api/cron/promo-expiring` are set up as
   Vercel Cron Jobs (Project Settings → Cron Jobs) if you want the automated
   nudge/campaign sends running — they need the `CRON_SECRET` Bearer header, which
   Vercel Cron sends automatically when configured via `vercel.json`.

---

## Deferred until you're ready (all safe to add later, zero code changes)

- **Stripe** — billing/subscriptions (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, three `STRIPE_PRICE_*` IDs)
- **Twilio** — SMS campaigns + click-to-call dialer (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`)
- **Resend** — email campaigns (`RESEND_API_KEY`)
- **Lob** — certified-mail dispute letters; unset = mock mode, letters generate but don't actually mail (`LOB_API_KEY`)
- **Plaid** — bank-linked budget tracking (`PLAID_CLIENT_ID`, `PLAID_SECRET`)
- **Calendly** — client call booking webhook (`CALENDLY_WEBHOOK_SIGNING_KEY`)
- **CONDUIT_API_BASE_URL / CONDUIT_API_KEY / CONDUIT_STATUS_SYNC_KEY** — the Stage 4
  handoff to AshleyIQ (conduit-next) — a cross-company integration with PrimeMind
  Labs, needs coordination on both sides before enabling

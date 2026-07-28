# CreditCoachIQ

Standalone consumer credit-repair platform, extracted from `conduit-next`.

Next.js 14 · Clerk (own app) · Supabase (own project) · Stripe (own account) · Anthropic.

See **MIGRATION_NOTES.md** for what's been ported, the architecture decisions
(notably: no local `leads` table — see `borrowers`), and the checklist of
what's still left to bring over from conduit-next.

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in Clerk / Supabase / Stripe / Anthropic keys
npm run dev
```

Run `supabase/migrations/0001_init_credit_coach_schema.sql` against a new
Supabase project before starting the app.

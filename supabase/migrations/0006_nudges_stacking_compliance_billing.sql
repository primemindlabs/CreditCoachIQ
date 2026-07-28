-- ============================================================================
-- Closes out the remaining deferred items: readiness nudges, stack-sequencing
-- seed data, funding-status sync back from AshleyIQ, compliance-audit
-- traceability, and Plaid-linked budget accounts.
-- ============================================================================

-- ── Who approved a mailed dispute letter (compliance audit trail) ───────────
ALTER TABLE credit_disputes ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES profiles(id);

-- ── Borrower state, for CROA state-registration enforcement at enrollment ───
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS state char(2);

-- ── Funding status synced back from AshleyIQ/conduit-next after handoff ─────
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS funding_status text
  CHECK (funding_status IN ('pre_qual', 'processing', 'underwriting', 'clear_to_close', 'funded', 'declined', 'withdrawn'));
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS funding_status_updated_at timestamptz;
ALTER TABLE handoff_packages ADD COLUMN IF NOT EXISTS last_status_sync_at timestamptz;

-- ── Lender criteria seed data for stack-sequencing recommendations ──────────
-- Rules-of-thumb only, not guaranteed approval criteria — see lib/stacking/recommend.ts.
-- Public, generally-known underwriting patterns as of mid-2026; coaches should
-- treat this as a starting ranking, not a promise, and update as patterns change.
CREATE TABLE IF NOT EXISTS lender_criteria (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_name                 text NOT NULL,
  card_or_product             text NOT NULL,
  min_time_in_business_months int NOT NULL DEFAULT 0,
  min_personal_score          int,
  ein_only_no_pg              boolean NOT NULL DEFAULT false, -- reports to business bureaus only, no personal guaranty impact
  reports_to_dnb              boolean NOT NULL DEFAULT false,
  reports_to_experian_biz     boolean NOT NULL DEFAULT false,
  reports_to_equifax_biz      boolean NOT NULL DEFAULT false,
  typical_starting_limit      numeric(10,2),
  notes                       text,
  sort_priority                int NOT NULL DEFAULT 50, -- lower = generally easier/earlier in a stack sequence
  is_active                   boolean NOT NULL DEFAULT true,
  created_at                   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lender_criteria ENABLE ROW LEVEL SECURITY;
-- Reference data, not tenant-scoped — readable by any authenticated org member via the admin client only.
CREATE POLICY "lender_criteria_service_select" ON lender_criteria FOR SELECT USING (true);

INSERT INTO lender_criteria (lender_name, card_or_product, min_time_in_business_months, min_personal_score, ein_only_no_pg, reports_to_dnb, reports_to_experian_biz, reports_to_equifax_biz, typical_starting_limit, notes, sort_priority) VALUES
  ('Uline', 'Net-30 vendor account', 0, NULL, true, true, false, false, 500, 'Common first-tier trade line — easy approval, builds D&B PAYDEX quickly.', 10),
  ('Grainger', 'Net-30 vendor account', 0, NULL, true, true, false, false, 500, 'Second common starter trade line, similar profile to Uline.', 11),
  ('Home Depot Commercial', 'Net-30 vendor account', 3, NULL, false, true, false, false, 1000, 'Light personal credit check, reports to D&B and sometimes business bureaus.', 15),
  ('Capital One Spark Classic', 'Business credit card', 6, 580, false, false, true, true, 2000, 'Lower personal-score tolerance than most business cards, good early tier-2 step.', 20),
  ('Chase Ink Business Unlimited', 'Business credit card', 24, 680, false, false, true, false, 3000, '0% intro APR common — track promo_apr_ends_at closely once approved.', 30),
  ('American Express Business Gold', 'Business charge card', 12, 670, false, false, true, false, 5000, 'Charge card (no preset spending limit) — good for building without revolving APR pressure.', 25),
  ('Bank of America Business Advantage', 'Business credit card', 24, 700, false, false, false, true, 5000, 'Strong for existing BofA banking relationships; underwriting favors established business banking history.', 35)
ON CONFLICT DO NOTHING;

-- ── Plaid-linked budget accounts (bank-account linking, gated on Plaid keys) ─
CREATE TABLE IF NOT EXISTS plaid_linked_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  plaid_item_id     text NOT NULL,
  plaid_access_token_encrypted text NOT NULL, -- AES-256-GCM via lib/crypto/encrypt.ts, never stored plaintext
  institution_name  text,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  last_synced_at    timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, borrower_id, plaid_item_id)
);
ALTER TABLE plaid_linked_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plaid_linked_accounts_org" ON plaid_linked_accounts FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS plaid_transactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  linked_account_id uuid NOT NULL REFERENCES plaid_linked_accounts(id) ON DELETE CASCADE,
  plaid_transaction_id text NOT NULL UNIQUE,
  amount            numeric(10,2) NOT NULL,
  merchant_name     text,
  category          text,
  budget_category_id uuid REFERENCES budget_categories(id) ON DELETE SET NULL,
  posted_at         date NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_plaid_tx_borrower ON plaid_transactions(org_id, borrower_id, posted_at);
ALTER TABLE plaid_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "plaid_transactions_org" ON plaid_transactions FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

-- ── Portal step-up MFA (email OTP on new session) ────────────────────────────
CREATE TABLE IF NOT EXISTS portal_otp_challenges (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  portal_token_id   uuid REFERENCES portal_tokens(id) ON DELETE CASCADE,
  code_hash         text NOT NULL, -- SHA-256 of the 6-digit code, never stored plaintext
  expires_at        timestamptz NOT NULL,
  verified_at       timestamptz,
  attempts          int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_otp_borrower ON portal_otp_challenges(borrower_id, created_at DESC);
ALTER TABLE portal_otp_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal_otp_service_all" ON portal_otp_challenges FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS mfa_verified_until timestamptz;

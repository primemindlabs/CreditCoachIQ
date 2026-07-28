-- ============================================================================
-- Security hardening pass. See SECURITY_AUDIT.md for the full rationale
-- (GLBA Safeguards Rule 16 CFR 314, FCRA, CROA recordkeeping context).
--
-- 1. Portal tokens: store only a SHA-256 hash, never the raw token. A DB
--    leak (backup, replica, misconfigured export) no longer hands out live
--    portal access — the raw token exists only in the one-time link sent
--    to the client and is never written back to the database.
-- 2. Portal access audit log: every verify attempt (success or failure) is
--    recorded — required in practice for incident response and expected
--    under GLBA's "monitoring" safeguard.
-- 3. EIN moves from plaintext to AES-256-GCM ciphertext at rest, matching
--    the pattern conduit-next already uses for LOS credentials.
-- ============================================================================

-- ── Portal tokens: hash instead of plaintext ────────────────────────────────
ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS token_hash text;
ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
-- Drop the old plaintext-token unique constraint/column now that the app
-- writes token_hash instead. Safe pre-launch (no live client links issued yet).
ALTER TABLE portal_tokens DROP COLUMN IF EXISTS token;
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_tokens_hash ON portal_tokens(token_hash) WHERE token_hash IS NOT NULL;

-- ── Portal access audit log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS portal_access_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid REFERENCES borrowers(id) ON DELETE SET NULL,
  portal_token_id   uuid REFERENCES portal_tokens(id) ON DELETE SET NULL,
  event             text NOT NULL, -- 'verify_success' | 'verify_failed' | 'verify_expired' | 'verify_revoked' | 'token_issued' | 'token_revoked'
  path              text,
  ip_address        text,
  user_agent        text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_access_log_borrower ON portal_access_log(org_id, borrower_id, created_at);
CREATE INDEX IF NOT EXISTS idx_portal_access_log_event ON portal_access_log(event, created_at);
ALTER TABLE portal_access_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal_access_log_org" ON portal_access_log FOR SELECT
  USING (org_id = public.get_org_id());
CREATE POLICY "portal_access_log_service_insert" ON portal_access_log FOR INSERT WITH CHECK (true);

-- ── EIN: plaintext -> encrypted ──────────────────────────────────────────────
ALTER TABLE business_credit_profiles ADD COLUMN IF NOT EXISTS ein_encrypted text;
ALTER TABLE business_credit_profiles ADD COLUMN IF NOT EXISTS ein_last4 text;
ALTER TABLE business_credit_profiles DROP COLUMN IF EXISTS ein;

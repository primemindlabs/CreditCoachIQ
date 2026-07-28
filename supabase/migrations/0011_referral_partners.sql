-- ============================================================================
-- Referral partner tracking — single-touch attribution. A partner (realtor,
-- loan officer, financial advisor, etc.) refers a client via a unique code;
-- the client's borrower record is attributed to that partner at enrollment
-- time and never re-attributed. Commission events are an append-only audit
-- trail, matching the pattern used elsewhere (e.g. portal_access_log).
-- ============================================================================

CREATE TABLE IF NOT EXISTS referral_partners (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  company            text,
  email             text,
  phone             text,
  referral_code     text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(6), 'hex'),
  commission_rate   numeric(5,2), -- percent, or flat — see commission_type
  commission_type   text NOT NULL DEFAULT 'flat' CHECK (commission_type IN ('flat', 'percent')),
  flat_commission_amount numeric(10,2),
  is_active         boolean NOT NULL DEFAULT true,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE referral_partners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "referral_partners_org" ON referral_partners FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS referred_by_partner_id uuid REFERENCES referral_partners(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_borrowers_referral_partner ON borrowers(referred_by_partner_id);

-- Append-only audit trail — INSERT-only RLS, no UPDATE/DELETE even for
-- service_role, matching architecture rule 7.
CREATE TABLE IF NOT EXISTS referral_commission_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  referral_partner_id uuid NOT NULL REFERENCES referral_partners(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  event_type        text NOT NULL CHECK (event_type IN ('enrollment_attributed', 'commission_owed', 'commission_paid', 'commission_reversed')),
  amount            numeric(10,2),
  notes             text,
  created_by        uuid REFERENCES profiles(id),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_commission_events_partner ON referral_commission_events(org_id, referral_partner_id, created_at DESC);
ALTER TABLE referral_commission_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commission_events_select" ON referral_commission_events FOR SELECT
  USING (org_id = public.get_org_id());
CREATE POLICY "commission_events_insert" ON referral_commission_events FOR INSERT
  WITH CHECK (org_id = public.get_org_id());
REVOKE UPDATE, DELETE, TRUNCATE ON referral_commission_events FROM PUBLIC, authenticated, service_role, anon;

DROP TRIGGER IF EXISTS trg_referral_partners_updated_at ON referral_partners;
CREATE TRIGGER trg_referral_partners_updated_at BEFORE UPDATE ON referral_partners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

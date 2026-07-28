-- 0012_complaints_roles_billing.sql
-- Three features, bundled since they're small and independent:
-- (1) a formal complaint/dispute-resolution log (CROA-adjacent best
--     practice — a durable record when a client or bureau dispute
--     escalates beyond normal handling, separate from credit_disputes
--     which is the letter-drafting pipeline itself);
-- (2) additional staff roles (processor, sales) beyond admin/coach;
-- (3) payment-failure tracking columns on credit_repair_enrollments so
--     the Stripe webhook can drive a real dunning flow instead of just
--     recording subscription_status.

CREATE TABLE IF NOT EXISTS complaint_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id         uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  enrollment_id       uuid REFERENCES credit_repair_enrollments(id) ON DELETE SET NULL,
  dispute_id          uuid REFERENCES credit_disputes(id) ON DELETE SET NULL,
  filed_by            text NOT NULL CHECK (filed_by IN ('client', 'coach', 'bureau', 'third_party')),
  category            text NOT NULL CHECK (category IN (
                        'billing', 'service_quality', 'dispute_handling',
                        'communication', 'data_privacy', 'other'
                      )),
  description         text NOT NULL,
  status              text NOT NULL DEFAULT 'open'
                       CHECK (status IN ('open', 'investigating', 'resolved', 'escalated_cfpb')),
  resolution_notes    text,
  opened_by           uuid REFERENCES profiles(id) ON DELETE SET NULL,
  opened_at           timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE complaint_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "complaint_log_org_all" ON complaint_log
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE INDEX IF NOT EXISTS idx_complaint_log_borrower ON complaint_log(borrower_id);
CREATE INDEX IF NOT EXISTS idx_complaint_log_org_status ON complaint_log(org_id, status);

-- Staff roles: processor (back-office dispute/report processing) and
-- sales (intake/lead-facing, pre-enrollment) alongside the existing
-- admin/coach. See lib/auth/permissions.ts for what each can access.
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'coach', 'processor', 'sales'));

-- Billing dunning — the webhook already tracks subscription_status; these
-- add the detail a coach-facing recovery flow actually needs (why it
-- failed, how many times, and when so a nudge task isn't fired twice).
ALTER TABLE credit_repair_enrollments ADD COLUMN IF NOT EXISTS last_payment_failed_at timestamptz;
ALTER TABLE credit_repair_enrollments ADD COLUMN IF NOT EXISTS last_payment_failure_reason text;
ALTER TABLE credit_repair_enrollments ADD COLUMN IF NOT EXISTS payment_retry_count int NOT NULL DEFAULT 0;

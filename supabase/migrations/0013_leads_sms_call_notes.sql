-- ============================================================================
-- Phase 1 of DisputeFox-parity build (see DISPUTEFOX_PARITY_SCOPE.md):
-- pre-enrollment leads pipeline, two-way SMS, and dialer call notes.
-- ============================================================================

-- ── Leads pipeline ────────────────────────────────────────────────────────
-- A "lead" is a borrowers row with lead_status != 'converted' and no
-- credit_repair_enrollments row yet. Deliberately not a separate leads
-- table — borrowers already exist independently of enrollment (see
-- app/api/enroll/route.ts), so tracking status directly on borrowers avoids
-- a second identity record that would need reconciling on conversion.
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS lead_status text NOT NULL DEFAULT 'converted'
  CHECK (lead_status IN ('new', 'contacted', 'qualified', 'converted', 'lost'));
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS interest_level text
  CHECK (interest_level IN ('hot', 'warm', 'cold'));
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS lead_source text NOT NULL DEFAULT 'manual';
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS last_contacted_at timestamptz;

-- Safety net: every borrower created before this column existed was created
-- via /api/enroll, which enrolls immediately — the DEFAULT 'converted' above
-- already covers them going forward, this just guards any edge case.
UPDATE borrowers b SET lead_status = 'converted'
WHERE lead_status = 'new'
  AND EXISTS (SELECT 1 FROM credit_repair_enrollments e WHERE e.borrower_id = b.id);

CREATE INDEX IF NOT EXISTS idx_borrowers_lead_status ON borrowers(org_id, lead_status) WHERE lead_status != 'converted';

-- Append-only touch history — same shape as referral_commission_events.
CREATE TABLE IF NOT EXISTS lead_activity_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id   uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  actor_id      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  type          text NOT NULL CHECK (type IN ('call', 'sms', 'email', 'note', 'status_change')),
  body          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lead_activity_borrower ON lead_activity_log(org_id, borrower_id, created_at DESC);
ALTER TABLE lead_activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lead_activity_select" ON lead_activity_log FOR SELECT USING (org_id = public.get_org_id());
CREATE POLICY "lead_activity_insert" ON lead_activity_log FOR INSERT WITH CHECK (org_id = public.get_org_id());
REVOKE UPDATE, DELETE, TRUNCATE ON lead_activity_log FROM PUBLIC, authenticated, service_role, anon;

-- ── Two-way SMS ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sms_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id   uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  direction     text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body          text NOT NULL,
  to_number     text NOT NULL,
  from_number   text NOT NULL,
  twilio_sid    text UNIQUE,
  status        text NOT NULL DEFAULT 'received' CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'received')),
  sent_by       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  read_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sms_messages_thread ON sms_messages(org_id, borrower_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sms_messages_sid ON sms_messages(twilio_sid);
CREATE INDEX IF NOT EXISTS idx_sms_messages_unread ON sms_messages(org_id, borrower_id) WHERE direction = 'inbound' AND read_at IS NULL;
ALTER TABLE sms_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sms_messages_org" ON sms_messages FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "sms_messages_service_all" ON sms_messages FOR ALL USING (true) WITH CHECK (true);

-- ── Dialer call notes ─────────────────────────────────────────────────────
ALTER TABLE call_logs ADD COLUMN IF NOT EXISTS notes text;

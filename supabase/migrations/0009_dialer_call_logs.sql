-- ============================================================================
-- In-system click-to-call dialer: call history log. No call recording by
-- default (no recording_url column) — GLBA/state two-party-consent exposure
-- is out of scope for this pass; recording can be added later behind an
-- explicit consent-capture flow if the business needs it.
-- ============================================================================

CREATE TABLE IF NOT EXISTS call_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid REFERENCES borrowers(id) ON DELETE SET NULL,
  placed_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  to_number         text NOT NULL,
  from_number       text NOT NULL,
  twilio_call_sid   text UNIQUE,
  direction         text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  status            text NOT NULL DEFAULT 'initiated'
                    CHECK (status IN ('initiated', 'ringing', 'in-progress', 'completed', 'busy', 'failed', 'no-answer', 'canceled')),
  duration_seconds  int,
  started_at        timestamptz NOT NULL DEFAULT now(),
  ended_at          timestamptz
);
CREATE INDEX IF NOT EXISTS idx_call_logs_borrower ON call_logs(org_id, borrower_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_logs_sid ON call_logs(twilio_call_sid);
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "call_logs_org" ON call_logs FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "call_logs_service_all" ON call_logs FOR ALL USING (true) WITH CHECK (true);

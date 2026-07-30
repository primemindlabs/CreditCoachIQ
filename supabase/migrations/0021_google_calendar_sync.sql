-- ============================================================================
-- 0021_google_calendar_sync.sql
--
-- Two-way Google Calendar sync per coach — replaces the one-way Calendly
-- link swap with: (1) push — confirmed Calendly bookings are mirrored onto
-- the coach's own Google Calendar as real events; (2) pull — the coach's
-- Google Calendar events for today are read back into the Today page
-- alongside call_bookings, so calendar-only appointments (not booked
-- through the portal) still show up in the daily call list.
--
-- Tokens are stored AES-256-GCM encrypted (lib/crypto/encrypt.ts, same
-- primitive already used for business_credit_profiles.ein_encrypted) —
-- an OAuth refresh token is a standing credential and gets the same
-- treatment as one.
-- ============================================================================

CREATE TABLE IF NOT EXISTS coach_calendar_connections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  provider        text NOT NULL DEFAULT 'google' CHECK (provider IN ('google')),
  access_token_encrypted  text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  token_expires_at timestamptz NOT NULL,
  calendar_id     text NOT NULL DEFAULT 'primary',
  connected_email text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, profile_id, provider)
);
ALTER TABLE coach_calendar_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach_calendar_connections_org" ON coach_calendar_connections
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

DROP TRIGGER IF EXISTS trg_coach_calendar_connections_updated_at ON coach_calendar_connections;
CREATE TRIGGER trg_coach_calendar_connections_updated_at BEFORE UPDATE ON coach_calendar_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Tracks the mirrored Google event so a Calendly cancellation/reschedule can
-- update or delete the same event instead of leaving orphans on the calendar.
ALTER TABLE call_bookings ADD COLUMN IF NOT EXISTS google_event_id text;

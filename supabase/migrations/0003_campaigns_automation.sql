-- ============================================================================
-- CreditCoachIQ — Automated CRM layer: email/SMS campaigns + triggers
--
-- Goal per the product direction: this should feel like a seamless,
-- automated CRM, but still personalized — not a mass-blast tool. Every send
-- is rendered through a per-client context (coach name, score, stacked
-- capital, journey stage) so a "welcome to credit stacking" email reads like
-- it was written for that client, even though it's system-triggered.
-- ============================================================================

-- ── Consent fields (TCPA/CAN-SPAM) ───────────────────────────────────────────
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS sms_consent boolean NOT NULL DEFAULT false;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS sms_consent_at timestamptz;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS email_opt_out boolean NOT NULL DEFAULT false;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS sms_opt_out boolean NOT NULL DEFAULT false;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS unsubscribe_token text UNIQUE DEFAULT encode(gen_random_bytes(24), 'base64url');

-- ── Message templates — the reusable email/SMS content, with {{tokens}} ─────
CREATE TABLE IF NOT EXISTS message_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('email', 'sms')),
  subject         text, -- email only
  body            text NOT NULL, -- supports {{first_name}}, {{coach_first_name}}, {{current_score}},
                                  -- {{target_score}}, {{stacked_capital}}, {{journey_stage_label}}, {{unsubscribe_url}}
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "templates_org" ON message_templates
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

-- ── Campaigns — the container a visual builder edits ────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  -- What auto-enrolls a client. 'manual' means a coach enrolls one-by-one;
  -- everything else fires automatically off a real event/condition.
  trigger_type    text NOT NULL DEFAULT 'manual'
                  CHECK (trigger_type IN (
                    'manual', 'client_enrolled', 'journey_stage_enter', 'dispute_response_received',
                    'goal_achieved', 'stack_promo_expiring', 'loan_ready_reached', 'scheduled'
                  )),
  -- e.g. {"stage": "credit_stacking"} for journey_stage_enter, or
  -- {"days_before": 30} for stack_promo_expiring.
  trigger_config  jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaigns_trigger ON campaigns(org_id, trigger_type) WHERE status = 'active';
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaigns_org" ON campaigns
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

-- ── Campaign steps — the ordered sequence a visual builder renders as nodes ──
CREATE TABLE IF NOT EXISTS campaign_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id     uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_order      int NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('email', 'sms')),
  template_id     uuid NOT NULL REFERENCES message_templates(id),
  delay_hours     int NOT NULL DEFAULT 0, -- delay after previous step (or enrollment, for step 1)
  -- Optional skip condition, checked at send time — e.g. don't send step 3
  -- if the client already advanced past the stage that triggered this
  -- campaign: {"skip_if_stage_not": "credit_stacking"}
  condition       jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, step_order)
);
CREATE INDEX IF NOT EXISTS idx_campaign_steps_campaign ON campaign_steps(campaign_id, step_order);
ALTER TABLE campaign_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaign_steps_org" ON campaign_steps
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

-- ── Enrollments — one client's progress through one campaign ────────────────
CREATE TABLE IF NOT EXISTS campaign_enrollments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id       uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  current_step_order int NOT NULL DEFAULT 0, -- 0 = not yet sent step 1
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'exited')),
  next_send_at      timestamptz,
  enrolled_at       timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  UNIQUE (campaign_id, borrower_id) -- a client is only ever in one active run of a given campaign
);
CREATE INDEX IF NOT EXISTS idx_enrollments_due ON campaign_enrollments(org_id, next_send_at) WHERE status = 'active';
ALTER TABLE campaign_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "enrollments_org" ON campaign_enrollments
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

-- ── Sends — the actual outbound log (audit trail + deliverability tracking) ─
CREATE TABLE IF NOT EXISTS campaign_sends (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  enrollment_id     uuid NOT NULL REFERENCES campaign_enrollments(id) ON DELETE CASCADE,
  step_id           uuid NOT NULL REFERENCES campaign_steps(id),
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  channel           text NOT NULL CHECK (channel IN ('email', 'sms')),
  to_address        text NOT NULL,
  subject_rendered  text,
  body_rendered     text NOT NULL,
  status            text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'sent', 'delivered', 'opened', 'clicked', 'failed', 'skipped')),
  provider_message_id text,
  error_message     text,
  sent_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sends_borrower ON campaign_sends(borrower_id, created_at DESC);
ALTER TABLE campaign_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sends_org" ON campaign_sends
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

DROP TRIGGER IF EXISTS trg_templates_updated_at ON message_templates;
CREATE TRIGGER trg_templates_updated_at BEFORE UPDATE ON message_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_campaigns_updated_at ON campaigns;
CREATE TRIGGER trg_campaigns_updated_at BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

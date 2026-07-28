-- ============================================================================
-- CreditCoachIQ — Standalone Schema
-- Extracted from Conduit's credit-repair module (sprint3_credit_repair.sql,
-- phase47_credit_alerts.sql, origination_suite.sql).
--
-- KEY CHANGE FROM CONDUIT: this project owns its OWN organizations/profiles
-- (its own Clerk app, its own tenants), and does NOT have a local `leads`
-- table. Any table that referenced `leads(id)` now references `borrowers(id)`
-- instead — a local, denormalized borrower record keyed to an optional
-- external CRM lead id (e.g. conduit-next's leads.id), so this app can run
-- fully standalone or be fed by any originating CRM via API/webhook.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── updated_at trigger helper ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- CORE TENANCY (local to CreditCoachIQ)
-- ============================================================================
CREATE TABLE IF NOT EXISTS organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org_id    text UNIQUE NOT NULL,
  name            text NOT NULL,
  billing_email   text,
  stripe_customer_id text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ── get_org_id(): resolves the current Clerk org claim to organizations.id ──
-- Must be created AFTER organizations exists — this is a LANGUAGE sql
-- function, and Postgres resolves table/column references in a SQL-language
-- function body against the catalog at CREATE TIME (unlike plpgsql, which
-- only checks syntax and defers resolution to first call).
CREATE OR REPLACE FUNCTION public.get_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT id FROM organizations
  WHERE clerk_org_id = (
    SELECT current_setting('request.jwt.claims', true)::json->>'org_id'
  )
  LIMIT 1;
$$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_own" ON organizations
  USING (id = public.get_org_id()) WITH CHECK (id = public.get_org_id());

CREATE TABLE IF NOT EXISTS profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id   text UNIQUE NOT NULL,
  org_id          uuid REFERENCES organizations(id) ON DELETE CASCADE,
  email           text NOT NULL,
  first_name      text NOT NULL DEFAULT '',
  last_name       text NOT NULL DEFAULT '',
  role            text NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'agent')),
  phone           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profile_own_org" ON profiles
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

-- ── Borrowers: local, denormalized record. Replaces conduit-next's `leads`. ──
CREATE TABLE IF NOT EXISTS borrowers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_source    text NOT NULL DEFAULT 'manual', -- e.g. 'conduit-next', 'manual'
  external_lead_id   text,                            -- originating CRM's lead id, if any
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  email              text,
  phone              text,
  assigned_agent_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, external_source, external_lead_id)
);
CREATE INDEX IF NOT EXISTS idx_borrowers_org ON borrowers(org_id);
ALTER TABLE borrowers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "borrowers_org" ON borrowers
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

DROP TRIGGER IF EXISTS trg_borrowers_updated_at ON borrowers;
CREATE TRIGGER trg_borrowers_updated_at BEFORE UPDATE ON borrowers
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================================
-- CREDIT REPAIR — consumer dispute pipeline (from sprint3_credit_repair.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS credit_repair_enrollments (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id            uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,

  stripe_customer_id     text,
  stripe_subscription_id text,
  subscription_status    text NOT NULL DEFAULT 'trial'
                         CHECK (subscription_status IN ('trial','active','past_due','canceled','paused')),
  trial_ends_at          timestamptz,
  billing_started_at     timestamptz,

  croa_disclosure_signed_at timestamptz,
  croa_disclosure_ip        text,
  croa_contract_text        text,

  starting_score_exp     int,
  starting_score_eqx     int,
  starting_score_tu      int,
  current_score_exp      int,
  current_score_eqx      int,
  current_score_tu       int,
  target_score           int NOT NULL DEFAULT 640,
  score_history          jsonb DEFAULT '[]',

  status                 text NOT NULL DEFAULT 'pending_upload'
                         CHECK (status IN ('pending_upload','analyzing','active','mortgage_ready','closed','canceled')),
  mortgage_ready_at      timestamptz,
  closed_at              timestamptz,
  cancel_reason          text,

  notify_score_milestone boolean DEFAULT true,
  notify_item_removed    boolean DEFAULT true,
  notify_dispute_sent    boolean DEFAULT true,
  notify_bureau_response boolean DEFAULT true,
  notify_mortgage_ready  boolean DEFAULT true,
  notify_sms             boolean DEFAULT false,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, borrower_id)
);

CREATE TABLE IF NOT EXISTS credit_report_uploads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id     uuid NOT NULL REFERENCES credit_repair_enrollments(id) ON DELETE CASCADE,
  org_id            uuid NOT NULL,
  borrower_id       uuid NOT NULL,
  storage_path      text NOT NULL,
  source_bureau     text NOT NULL CHECK (source_bureau IN ('experian','equifax','transunion','tri_merge','unknown')),
  report_date       date,
  cycle_number      int NOT NULL DEFAULT 1,
  parse_status      text NOT NULL DEFAULT 'pending'
                    CHECK (parse_status IN ('pending','parsing','parsed','failed')),
  parse_error       text,
  score_exp         int,
  score_eqx         int,
  score_tu          int,
  ai_analysis       jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_tradelines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id     uuid NOT NULL REFERENCES credit_repair_enrollments(id) ON DELETE CASCADE,
  report_upload_id  uuid NOT NULL REFERENCES credit_report_uploads(id) ON DELETE CASCADE,
  org_id            uuid NOT NULL,
  creditor_name     text NOT NULL,
  account_number    text,
  account_type      text,
  bureau            text NOT NULL CHECK (bureau IN ('experian','equifax','transunion','all_three')),
  balance           numeric,
  credit_limit      numeric,
  open_date         date,
  close_date        date,
  status            text,
  payment_status    text,
  negative_remarks  text[],
  is_disputable     boolean NOT NULL DEFAULT false,
  dispute_reason    text,
  dispute_priority  int DEFAULT 5,
  estimated_score_gain int,
  dispute_status    text NOT NULL DEFAULT 'identified'
                    CHECK (dispute_status IN ('identified','queued','letter_sent','verified','removed','updated','not_disputing')),
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_disputes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id     uuid NOT NULL REFERENCES credit_repair_enrollments(id) ON DELETE CASCADE,
  tradeline_id      uuid NOT NULL REFERENCES credit_tradelines(id) ON DELETE CASCADE,
  org_id            uuid NOT NULL,
  bureau            text NOT NULL CHECK (bureau IN ('experian','equifax','transunion')),
  cycle_number      int NOT NULL DEFAULT 1,
  letter_type       text NOT NULL DEFAULT 'initial'
                    CHECK (letter_type IN ('initial','re_dispute','method_of_verification','cfpb_complaint','goodwill','pay_for_delete')),
  letter_body       text NOT NULL,
  borrower_name     text NOT NULL,
  borrower_address  text NOT NULL,
  bureau_address    text NOT NULL,
  lob_letter_id     text,
  lob_status        text,
  sent_at           timestamptz,
  expected_response_by timestamptz,
  response_status   text NOT NULL DEFAULT 'pending'
                    CHECK (response_status IN ('pending','awaiting_response','item_removed','item_updated','verified_accurate','no_response')),
  borrower_outcome  text,
  response_upload_path text,
  response_logged_at timestamptz,
  ai_next_action    text,
  auto_next_letter_id uuid REFERENCES credit_disputes(id),
  approved_by_borrower_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_repair_notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL,
  enrollment_id   uuid NOT NULL REFERENCES credit_repair_enrollments(id) ON DELETE CASCADE,
  borrower_id     uuid,
  type            text NOT NULL,
  payload         jsonb,
  sent_via        text[],
  read_at         timestamptz,
  sent_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credit_repair_org_settings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  notify_score_milestones int[] DEFAULT '{580,620,640,680,720}',
  notify_on_item_removed boolean DEFAULT true,
  notify_on_dispute_sent boolean DEFAULT false,
  notify_on_bureau_response boolean DEFAULT true,
  notify_sms_default     boolean DEFAULT false,
  lo_email_override      text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- CREDIT MONITORING / ALERTS (from phase47_credit_alerts.sql)
-- ============================================================================
CREATE TABLE IF NOT EXISTS credit_monitoring_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_id uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  enrolled_by uuid REFERENCES profiles(id),
  vendor text NOT NULL CHECK (vendor IN ('creditxpert','factual_data','softpull','scoremaster','credco','xactus','meridianlink','other')),
  vendor_borrower_id text NOT NULL,
  monitoring_type text NOT NULL DEFAULT 'inquiry_alert' CHECK (monitoring_type IN ('inquiry_alert','score_change','score_improvement','full')),
  is_active boolean NOT NULL DEFAULT true,
  enrolled_at timestamptz NOT NULL DEFAULT now(), cancelled_at timestamptz,
  UNIQUE(vendor, vendor_borrower_id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_cme_match ON credit_monitoring_enrollments(vendor, vendor_borrower_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_cme_borrower ON credit_monitoring_enrollments(borrower_id);
ALTER TABLE credit_monitoring_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cme_tenant" ON credit_monitoring_enrollments FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS credit_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid REFERENCES credit_monitoring_enrollments(id) ON DELETE SET NULL,
  borrower_id uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  alert_type text NOT NULL CHECK (alert_type IN ('inquiry','score_increase','score_decrease','derogatory','new_account')),
  vendor text NOT NULL, raw_payload jsonb,
  previous_score integer, new_score integer,
  score_delta integer GENERATED ALWAYS AS (new_score - previous_score) STORED,
  inquiring_lender text,
  lo_notified_at timestamptz, borrower_notified_at timestamptz,
  action_taken text, actioned_at timestamptz, actioned_by uuid REFERENCES profiles(id),
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ca_open ON credit_alerts(org_id, received_at DESC) WHERE actioned_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ca_borrower ON credit_alerts(borrower_id, received_at DESC);
ALTER TABLE credit_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ca_select" ON credit_alerts FOR SELECT USING (org_id = public.get_org_id());
CREATE POLICY "ca_insert" ON credit_alerts FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "ca_update" ON credit_alerts FOR UPDATE USING (org_id = public.get_org_id());
REVOKE DELETE, TRUNCATE ON credit_alerts FROM PUBLIC, authenticated, service_role, anon;

-- ============================================================================
-- LEGACY LO-DRIVEN PIPELINE (from origination_suite.sql)
-- Superseded by credit_repair_enrollments above for the consumer-facing
-- product, but ported in case the referral-tracking view is still used.
-- ============================================================================
CREATE TABLE IF NOT EXISTS credit_repair_pipeline (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id               uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  target_program            text NOT NULL,
  target_score              integer NOT NULL CHECK (target_score BETWEEN 300 AND 850),
  starting_score            integer NOT NULL CHECK (starting_score BETWEEN 300 AND 850),
  current_score             integer CHECK (current_score BETWEEN 300 AND 850),
  score_history             jsonb NOT NULL DEFAULT '[]',
  known_issues              jsonb NOT NULL DEFAULT '[]',
  status                    text NOT NULL DEFAULT 'enrolled'
                              CHECK (status IN (
                                'enrolled','in_progress','near_qualifying',
                                'qualified','stopped_responding','reactivated'
                              )),
  credit_repair_partner     text,
  checkin_frequency_days    integer NOT NULL DEFAULT 30,
  next_checkin_date         date,
  assigned_to               uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reactivated_at            timestamptz,
  ai_action_plan            text,
  ai_plan_generated_at      timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, borrower_id)
);

CREATE TABLE IF NOT EXISTS credit_repair_partners (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  contact_name      text,
  email             text,
  phone             text,
  website           text,
  avg_timeline_days integer,
  success_rate      numeric(5,2) CHECK (success_rate BETWEEN 0 AND 100),
  notes             text,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── RLS for the credit-repair tables ─────────────────────────────────────────
ALTER TABLE credit_repair_enrollments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_report_uploads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_tradelines          ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_disputes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_repair_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_repair_org_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_repair_pipeline     ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_repair_partners     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cr_enrollments_org_all" ON credit_repair_enrollments
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "cr_uploads_org_all" ON credit_report_uploads
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "cr_tradelines_org_all" ON credit_tradelines
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "cr_disputes_org_all" ON credit_disputes
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "cr_settings_org_all" ON credit_repair_org_settings
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "cr_pipeline_org_all" ON credit_repair_pipeline
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "cr_partners_org_all" ON credit_repair_partners
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE POLICY "cr_notifications_read_org" ON credit_repair_notifications
  FOR SELECT USING (org_id = public.get_org_id());
CREATE POLICY "cr_notifications_insert" ON credit_repair_notifications
  FOR INSERT WITH CHECK (org_id = public.get_org_id());

-- ── Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cr_enrollments_borrower ON credit_repair_enrollments(borrower_id);
CREATE INDEX IF NOT EXISTS idx_cr_enrollments_org ON credit_repair_enrollments(org_id);
CREATE INDEX IF NOT EXISTS idx_cr_tradelines_enrollment ON credit_tradelines(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_cr_disputes_enrollment ON credit_disputes(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_cr_disputes_awaiting ON credit_disputes(response_status) WHERE response_status = 'awaiting_response';
CREATE INDEX IF NOT EXISTS idx_cr_notifications_org ON credit_repair_notifications(org_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_repair_pipeline_org ON credit_repair_pipeline(org_id, status);
CREATE INDEX IF NOT EXISTS idx_credit_repair_partners_org ON credit_repair_partners(org_id);

-- ── updated_at triggers ──────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_cr_enrollments_updated_at ON credit_repair_enrollments;
CREATE TRIGGER trg_cr_enrollments_updated_at BEFORE UPDATE ON credit_repair_enrollments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_cr_disputes_updated_at ON credit_disputes;
CREATE TRIGGER trg_cr_disputes_updated_at BEFORE UPDATE ON credit_disputes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_cr_settings_updated_at ON credit_repair_org_settings;
CREATE TRIGGER trg_cr_settings_updated_at BEFORE UPDATE ON credit_repair_org_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_cr_pipeline_updated_at ON credit_repair_pipeline;
CREATE TRIGGER trg_cr_pipeline_updated_at BEFORE UPDATE ON credit_repair_pipeline
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_cr_partners_updated_at ON credit_repair_partners;
CREATE TRIGGER trg_cr_partners_updated_at BEFORE UPDATE ON credit_repair_partners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_org_updated_at ON organizations;
CREATE TRIGGER trg_org_updated_at BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON profiles;
CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Storage bucket for borrower-uploaded bureau response letters ────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('bureau-responses', 'bureau-responses', false)
ON CONFLICT (id) DO NOTHING;

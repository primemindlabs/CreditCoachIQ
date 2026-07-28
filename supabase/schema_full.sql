-- ============================================================================
-- CreditCoachIQ — Full schema, all 11 migrations concatenated in run order.
-- Corrected version: organizations table is created BEFORE get_org_id()
-- (a LANGUAGE sql function, which Postgres resolves against the catalog at
-- CREATE TIME, unlike plpgsql). Paste this entire file into the Supabase
-- SQL Editor as one script and Run once.
-- ============================================================================

-- ============================================================================
-- 0001_init_credit_coach_schema.sql
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION update_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_org_id    text UNIQUE NOT NULL,
  name            text NOT NULL,
  billing_email   text,
  stripe_customer_id text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

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

CREATE TABLE IF NOT EXISTS borrowers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  external_source    text NOT NULL DEFAULT 'manual',
  external_lead_id   text,
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

CREATE INDEX IF NOT EXISTS idx_cr_enrollments_borrower ON credit_repair_enrollments(borrower_id);
CREATE INDEX IF NOT EXISTS idx_cr_enrollments_org ON credit_repair_enrollments(org_id);
CREATE INDEX IF NOT EXISTS idx_cr_tradelines_enrollment ON credit_tradelines(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_cr_disputes_enrollment ON credit_disputes(enrollment_id);
CREATE INDEX IF NOT EXISTS idx_cr_disputes_awaiting ON credit_disputes(response_status) WHERE response_status = 'awaiting_response';
CREATE INDEX IF NOT EXISTS idx_cr_notifications_org ON credit_repair_notifications(org_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_repair_pipeline_org ON credit_repair_pipeline(org_id, status);
CREATE INDEX IF NOT EXISTS idx_credit_repair_partners_org ON credit_repair_partners(org_id);

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

INSERT INTO storage.buckets (id, name, public)
VALUES ('bureau-responses', 'bureau-responses', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 0002_client_journey_stacking_wealth.sql
-- ============================================================================
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'coach'));

ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'credit_coaching'
  CHECK (plan_tier IN ('credit_coaching', 'wealth_coaching', 'investor_path'));
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS journey_stage text NOT NULL DEFAULT 'credit_coaching'
  CHECK (journey_stage IN ('credit_coaching', 'credit_stacking', 'loan_ready', 'handed_off', 'paused', 'exited'));
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS journey_stage_updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS journey_stage_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id     uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  from_stage      text,
  to_stage        text NOT NULL,
  moved_by        uuid REFERENCES profiles(id),
  reason          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_journey_events_borrower ON journey_stage_events(borrower_id, created_at DESC);
ALTER TABLE journey_stage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "journey_events_org" ON journey_stage_events
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS business_credit_profiles (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id           uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  entity_name           text NOT NULL,
  entity_type           text CHECK (entity_type IN ('llc', 's_corp', 'c_corp', 'sole_prop', 'partnership', 'other')),
  ein                   text,
  duns_number           text,
  dnb_paydex_score      int,
  experian_biz_score    int,
  equifax_biz_score     int,
  bureau_files_established boolean NOT NULL DEFAULT false,
  formation_date        date,
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, borrower_id, entity_name)
);
CREATE INDEX IF NOT EXISTS idx_bcp_borrower ON business_credit_profiles(borrower_id);
ALTER TABLE business_credit_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bcp_org" ON business_credit_profiles
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS credit_stack_plans (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id           uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  business_credit_profile_id uuid REFERENCES business_credit_profiles(id) ON DELETE SET NULL,
  target_capital        numeric(12,2) NOT NULL,
  planned_sequence      jsonb NOT NULL DEFAULT '[]',
  status                text NOT NULL DEFAULT 'planning'
                        CHECK (status IN ('planning', 'in_progress', 'completed', 'paused', 'abandoned')),
  created_by            uuid REFERENCES profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_csp_borrower ON credit_stack_plans(borrower_id);
ALTER TABLE credit_stack_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "csp_org" ON credit_stack_plans
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS credit_stack_applications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  stack_plan_id         uuid NOT NULL REFERENCES credit_stack_plans(id) ON DELETE CASCADE,
  borrower_id           uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  lender_name           text NOT NULL,
  product_name          text,
  applied_at            date,
  status                text NOT NULL DEFAULT 'planned'
                        CHECK (status IN ('planned', 'applied', 'approved', 'denied', 'active', 'promo_expired', 'closed')),
  approved_limit         numeric(12,2),
  promo_apr_months       int,
  promo_apr_ends_at       date,
  standard_apr           numeric(5,2),
  minimum_payment_notes   text,
  denial_reason           text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_csa_plan ON credit_stack_applications(stack_plan_id);
CREATE INDEX IF NOT EXISTS idx_csa_promo_expiring ON credit_stack_applications(org_id, promo_apr_ends_at)
  WHERE status = 'active';
ALTER TABLE credit_stack_applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "csa_org" ON credit_stack_applications
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

DROP TRIGGER IF EXISTS trg_bcp_updated_at ON business_credit_profiles;
CREATE TRIGGER trg_bcp_updated_at BEFORE UPDATE ON business_credit_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_csp_updated_at ON credit_stack_plans;
CREATE TRIGGER trg_csp_updated_at BEFORE UPDATE ON credit_stack_plans
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_csa_updated_at ON credit_stack_applications;
CREATE TRIGGER trg_csa_updated_at BEFORE UPDATE ON credit_stack_applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS financial_goals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  title             text NOT NULL,
  target_amount     numeric(12,2),
  target_date       date,
  current_amount    numeric(12,2) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'achieved', 'abandoned')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE financial_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fg_org" ON financial_goals
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS client_debts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  creditor_name     text NOT NULL,
  balance           numeric(12,2) NOT NULL,
  apr               numeric(5,2),
  minimum_payment   numeric(10,2),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE client_debts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "debts_org" ON client_debts
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS debt_payoff_plans (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  strategy          text NOT NULL DEFAULT 'avalanche' CHECK (strategy IN ('avalanche', 'snowball')),
  monthly_budget    numeric(10,2) NOT NULL,
  projected_payoff_date date,
  projection_snapshot jsonb,
  generated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE debt_payoff_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dpp_org" ON debt_payoff_plans
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS budgets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  month             date NOT NULL,
  monthly_income    numeric(12,2),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, borrower_id, month)
);
ALTER TABLE budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "budgets_org" ON budgets
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS budget_categories (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  budget_id         uuid NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  category          text NOT NULL,
  planned_amount    numeric(10,2) NOT NULL DEFAULT 0,
  actual_amount     numeric(10,2) NOT NULL DEFAULT 0
);
ALTER TABLE budget_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "budget_cat_org" ON budget_categories
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS loan_ready_checklist_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  label             text NOT NULL,
  is_required        boolean NOT NULL DEFAULT true,
  completed_at        timestamptz,
  verified_by         uuid REFERENCES profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lrci_borrower ON loan_ready_checklist_items(borrower_id);
ALTER TABLE loan_ready_checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lrci_org" ON loan_ready_checklist_items
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS handoff_packages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id           uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  snapshot              jsonb NOT NULL,
  sent_to_conduit_at    timestamptz,
  conduit_lead_id       text,
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'sent', 'failed', 'acknowledged')),
  error_message         text,
  created_by            uuid REFERENCES profiles(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_handoff_borrower ON handoff_packages(borrower_id);
ALTER TABLE handoff_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "handoff_org" ON handoff_packages
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS coach_tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid REFERENCES borrowers(id) ON DELETE CASCADE,
  assigned_to       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  source            text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'system')),
  type              text,
  title             text NOT NULL,
  due_date          date,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coach_tasks_open ON coach_tasks(org_id, assigned_to) WHERE completed_at IS NULL;
ALTER TABLE coach_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach_tasks_org" ON coach_tasks
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS state_compliance_status (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  state             char(2) NOT NULL,
  registered         boolean NOT NULL DEFAULT false,
  bond_on_file       boolean NOT NULL DEFAULT false,
  fee_cap_notes       text,
  active_clients_allowed boolean NOT NULL DEFAULT false,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, state)
);
ALTER TABLE state_compliance_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scs_org" ON state_compliance_status
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

-- ============================================================================
-- 0003_campaigns_automation.sql
-- ============================================================================
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS sms_consent boolean NOT NULL DEFAULT false;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS sms_consent_at timestamptz;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS email_opt_out boolean NOT NULL DEFAULT false;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS sms_opt_out boolean NOT NULL DEFAULT false;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS unsubscribe_token text UNIQUE DEFAULT encode(gen_random_bytes(24), 'base64url');

CREATE TABLE IF NOT EXISTS message_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('email', 'sms')),
  subject         text,
  body            text NOT NULL,
  created_by      uuid REFERENCES profiles(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE message_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "templates_org" ON message_templates
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  trigger_type    text NOT NULL DEFAULT 'manual'
                  CHECK (trigger_type IN (
                    'manual', 'client_enrolled', 'journey_stage_enter', 'dispute_response_received',
                    'goal_achieved', 'stack_promo_expiring', 'loan_ready_reached', 'scheduled'
                  )),
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

CREATE TABLE IF NOT EXISTS campaign_steps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id     uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  step_order      int NOT NULL,
  channel         text NOT NULL CHECK (channel IN ('email', 'sms')),
  template_id     uuid NOT NULL REFERENCES message_templates(id),
  delay_hours     int NOT NULL DEFAULT 0,
  condition       jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, step_order)
);
CREATE INDEX IF NOT EXISTS idx_campaign_steps_campaign ON campaign_steps(campaign_id, step_order);
ALTER TABLE campaign_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaign_steps_org" ON campaign_steps
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS campaign_enrollments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  campaign_id       uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  current_step_order int NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'exited')),
  next_send_at      timestamptz,
  enrolled_at       timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  UNIQUE (campaign_id, borrower_id)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_due ON campaign_enrollments(org_id, next_send_at) WHERE status = 'active';
ALTER TABLE campaign_enrollments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "enrollments_org" ON campaign_enrollments
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

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

-- ============================================================================
-- 0004_client_portal_quiz_booking.sql
-- ============================================================================
CREATE TABLE IF NOT EXISTS portal_tokens (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL UNIQUE REFERENCES borrowers(id) ON DELETE CASCADE,
  token             text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at        timestamptz DEFAULT (now() + interval '180 days'),
  last_accessed_at  timestamptz,
  page_views        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_tokens_token ON portal_tokens(token);
ALTER TABLE portal_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal_tokens_org_all" ON portal_tokens FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "portal_tokens_service_select" ON portal_tokens FOR SELECT USING (true);
CREATE POLICY "portal_tokens_service_update" ON portal_tokens FOR UPDATE USING (true);

CREATE TABLE IF NOT EXISTS intake_quiz_questions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  question_order    integer NOT NULL,
  question_key      text,
  prompt            text NOT NULL,
  question_type     text NOT NULL CHECK (question_type IN ('single_choice', 'multi_choice', 'scale', 'text', 'number')),
  options           jsonb,
  helper_text       text,
  is_required       boolean NOT NULL DEFAULT true,
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, question_order)
);
ALTER TABLE intake_quiz_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intake_quiz_questions_org" ON intake_quiz_questions FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "intake_quiz_questions_service_select" ON intake_quiz_questions FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS intake_quiz_responses (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id               uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  status                    text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'started', 'completed', 'expired')),
  sent_at                   timestamptz NOT NULL DEFAULT now(),
  started_at                timestamptz,
  completed_at              timestamptz,
  smartcredit_link_clicked_at timestamptz,
  self_reported_score       integer,
  primary_goal              text,
  recommended_plan_tier     text CHECK (recommended_plan_tier IN ('credit_coaching', 'wealth_coaching', 'investor_path')),
  recommended_focus         text,
  path_score                jsonb,
  ai_summary                text,
  coach_reviewed_at         timestamptz,
  coach_reviewed_by         uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_borrower ON intake_quiz_responses(org_id, borrower_id);
CREATE INDEX IF NOT EXISTS idx_quiz_responses_review_queue ON intake_quiz_responses(org_id, status) WHERE status = 'completed' AND coach_reviewed_at IS NULL;
ALTER TABLE intake_quiz_responses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intake_quiz_responses_org" ON intake_quiz_responses FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "intake_quiz_responses_service_all" ON intake_quiz_responses FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS intake_quiz_answers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  response_id       uuid NOT NULL REFERENCES intake_quiz_responses(id) ON DELETE CASCADE,
  question_id       uuid NOT NULL REFERENCES intake_quiz_questions(id) ON DELETE CASCADE,
  answer            jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (response_id, question_id)
);
ALTER TABLE intake_quiz_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "intake_quiz_answers_org" ON intake_quiz_answers FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "intake_quiz_answers_service_all" ON intake_quiz_answers FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS coach_calendly_links (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id                uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  scheduling_url            text NOT NULL,
  calendly_event_type_uri   text,
  is_active                 boolean NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, profile_id)
);
ALTER TABLE coach_calendly_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach_calendly_links_org" ON coach_calendly_links FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "coach_calendly_links_service_select" ON coach_calendly_links FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS call_bookings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id           uuid REFERENCES borrowers(id) ON DELETE SET NULL,
  coach_id              uuid REFERENCES profiles(id) ON DELETE SET NULL,
  plan_tier_at_booking  text,
  calendly_event_uri    text UNIQUE,
  calendly_invitee_uri  text,
  scheduled_at          timestamptz,
  status                text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'canceled', 'no_show')),
  booked_via            text NOT NULL DEFAULT 'portal',
  created_at            timestamptz NOT NULL DEFAULT now(),
  canceled_at           timestamptz
);
CREATE INDEX IF NOT EXISTS idx_call_bookings_borrower ON call_bookings(org_id, borrower_id);
CREATE INDEX IF NOT EXISTS idx_call_bookings_coach ON call_bookings(coach_id, scheduled_at);
ALTER TABLE call_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "call_bookings_org" ON call_bookings FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "call_bookings_service_select" ON call_bookings FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS portal_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  sender            text NOT NULL CHECK (sender IN ('borrower', 'coach')),
  sender_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  body              text NOT NULL,
  read_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_messages_thread ON portal_messages(org_id, borrower_id, created_at);
ALTER TABLE portal_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal_messages_org" ON portal_messages FOR ALL
  USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());
CREATE POLICY "portal_messages_service_all" ON portal_messages FOR ALL USING (true) WITH CHECK (true);

INSERT INTO intake_quiz_questions (org_id, question_order, question_key, prompt, question_type, options, helper_text, is_required)
SELECT o.id, q.question_order, q.question_key, q.prompt, q.question_type, q.options::jsonb, q.helper_text, q.is_required
FROM organizations o
CROSS JOIN (VALUES
  (1, 'primary_goal', 'What''s your main goal right now?', 'single_choice',
    '[
      {"value":"buy_home","label":"Buy a home in the next 12 months","path_weight":{"tier":"credit_coaching","points":2}},
      {"value":"build_wealth","label":"Build savings / pay off debt","path_weight":{"tier":"wealth_coaching","points":2}},
      {"value":"investor","label":"Become a real estate investor","path_weight":{"tier":"investor_path","points":3}},
      {"value":"not_sure","label":"Not sure yet — I need guidance","path_weight":{"tier":"credit_coaching","points":1}}
    ]', NULL, true),
  (2, 'self_reported_score', 'What''s your approximate credit score today? (Check your SmartCredit report if you''ve pulled one — otherwise your best estimate is fine.)', 'number',
    NULL, 'Optional but helps us prep. Not required to continue.', false),
  (3, NULL, 'Which of these currently apply to you? (select all that apply)', 'multi_choice',
    '[
      {"value":"collections_on_report","label":"I have collections or negative items on my report","path_weight":{"tier":"credit_coaching","points":3}},
      {"value":"own_llc_or_planning_to","label":"I own or plan to open a business entity (LLC)","path_weight":{"tier":"investor_path","points":3}},
      {"value":"no_budget_tracking","label":"I don''t currently track a budget","path_weight":{"tier":"wealth_coaching","points":2}},
      {"value":"good_standing_ready_to_grow","label":"My credit is in good standing and I want to grow capital","path_weight":{"tier":"investor_path","points":2}}
    ]', NULL, false),
  (4, 'business_credit_interest', 'Are you interested in building business credit for real estate investing (credit stacking)?', 'single_choice',
    '[
      {"value":"yes","label":"Yes, that''s exactly why I''m here","path_weight":{"tier":"investor_path","points":4}},
      {"value":"maybe","label":"Maybe — tell me more","path_weight":{"tier":"wealth_coaching","points":1}},
      {"value":"no","label":"No, I just want to fix my credit / manage money better","path_weight":{"tier":"wealth_coaching","points":1}}
    ]', NULL, true),
  (5, 'timeline', 'How soon do you want to be loan-ready?', 'single_choice',
    '[
      {"value":"0_6mo","label":"0–6 months","path_weight":{"tier":"investor_path","points":2}},
      {"value":"6_12mo","label":"6–12 months","path_weight":{"tier":"wealth_coaching","points":1}},
      {"value":"12mo_plus","label":"12+ months / just exploring","path_weight":{"tier":"credit_coaching","points":1}}
    ]', NULL, true),
  (6, 'goal_notes', 'Anything else you want your coach to know before your first call?', 'text',
    NULL, 'Optional — share as much or as little as you''d like.', false)
) AS q(question_order, question_key, prompt, question_type, options, helper_text, is_required)
ON CONFLICT (org_id, question_order) DO NOTHING;

-- ============================================================================
-- 0005_security_hardening.sql
-- ============================================================================
ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS token_hash text;
ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE portal_tokens DROP COLUMN IF EXISTS token;
CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_tokens_hash ON portal_tokens(token_hash) WHERE token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS portal_access_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid REFERENCES borrowers(id) ON DELETE SET NULL,
  portal_token_id   uuid REFERENCES portal_tokens(id) ON DELETE SET NULL,
  event             text NOT NULL,
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

ALTER TABLE business_credit_profiles ADD COLUMN IF NOT EXISTS ein_encrypted text;
ALTER TABLE business_credit_profiles ADD COLUMN IF NOT EXISTS ein_last4 text;
ALTER TABLE business_credit_profiles DROP COLUMN IF EXISTS ein;

-- ============================================================================
-- 0006_nudges_stacking_compliance_billing.sql
-- ============================================================================
ALTER TABLE credit_disputes ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES profiles(id);
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS state char(2);
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS funding_status text
  CHECK (funding_status IN ('pre_qual', 'processing', 'underwriting', 'clear_to_close', 'funded', 'declined', 'withdrawn'));
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS funding_status_updated_at timestamptz;
ALTER TABLE handoff_packages ADD COLUMN IF NOT EXISTS last_status_sync_at timestamptz;

CREATE TABLE IF NOT EXISTS lender_criteria (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lender_name                 text NOT NULL,
  card_or_product             text NOT NULL,
  min_time_in_business_months int NOT NULL DEFAULT 0,
  min_personal_score          int,
  ein_only_no_pg              boolean NOT NULL DEFAULT false,
  reports_to_dnb              boolean NOT NULL DEFAULT false,
  reports_to_experian_biz     boolean NOT NULL DEFAULT false,
  reports_to_equifax_biz      boolean NOT NULL DEFAULT false,
  typical_starting_limit      numeric(10,2),
  notes                       text,
  sort_priority                int NOT NULL DEFAULT 50,
  is_active                   boolean NOT NULL DEFAULT true,
  created_at                   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE lender_criteria ENABLE ROW LEVEL SECURITY;
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

CREATE TABLE IF NOT EXISTS plaid_linked_accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  plaid_item_id     text NOT NULL,
  plaid_access_token_encrypted text NOT NULL,
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

CREATE TABLE IF NOT EXISTS portal_otp_challenges (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  portal_token_id   uuid REFERENCES portal_tokens(id) ON DELETE CASCADE,
  code_hash         text NOT NULL,
  expires_at        timestamptz NOT NULL,
  verified_at       timestamptz,
  attempts          int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_portal_otp_borrower ON portal_otp_challenges(borrower_id, created_at DESC);
ALTER TABLE portal_otp_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal_otp_service_all" ON portal_otp_challenges FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE portal_tokens ADD COLUMN IF NOT EXISTS mfa_verified_until timestamptz;

-- ============================================================================
-- 0007_plaid_sync_cursor.sql
-- ============================================================================
ALTER TABLE plaid_linked_accounts ADD COLUMN IF NOT EXISTS sync_cursor text;

-- ============================================================================
-- 0008_croa_signature_record.sql
-- ============================================================================
ALTER TABLE credit_repair_enrollments ADD COLUMN IF NOT EXISTS croa_signature_record jsonb;

-- ============================================================================
-- 0009_dialer_call_logs.sql
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

-- ============================================================================
-- 0010_credit_report_upload_bucket.sql
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('credit-report-uploads', 'credit-report-uploads', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 0011_referral_partners.sql
-- ============================================================================
CREATE TABLE IF NOT EXISTS referral_partners (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              text NOT NULL,
  company            text,
  email             text,
  phone             text,
  referral_code     text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(6), 'hex'),
  commission_rate   numeric(5,2),
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

-- ============================================================================
-- 0012_complaints_roles_billing.sql
-- ============================================================================
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

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'coach', 'processor', 'sales'));

ALTER TABLE credit_repair_enrollments ADD COLUMN IF NOT EXISTS last_payment_failed_at timestamptz;
ALTER TABLE credit_repair_enrollments ADD COLUMN IF NOT EXISTS last_payment_failure_reason text;
ALTER TABLE credit_repair_enrollments ADD COLUMN IF NOT EXISTS payment_retry_count int NOT NULL DEFAULT 0;
CREATE POLICY "commission_events_insert" ON referral_commission_events FOR INSERT
  WITH CHECK (org_id = public.get_org_id());
REVOKE UPDATE, DELETE, TRUNCATE ON referral_commission_events FROM PUBLIC, authenticated, service_role, anon;

DROP TRIGGER IF EXISTS trg_referral_partners_updated_at ON referral_partners;
CREATE TRIGGER trg_referral_partners_updated_at BEFORE UPDATE ON referral_partners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

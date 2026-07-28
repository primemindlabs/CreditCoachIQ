-- ============================================================================
-- CreditCoachIQ — Client Journey, Credit Stacking, Wealth Coaching, Coach Ops
-- Builds on 0001_init_credit_coach_schema.sql.
--
-- Reframes the platform per the business-model correction: this is proprietary
-- internal tooling for EquityNest Capital's own coaches and clients, not a
-- multi-tenant SaaS sold to other agencies. `profiles.role` now includes
-- 'coach'; `borrowers` gains a plan tier + journey stage; and three new
-- domains are added: credit stacking, wealth coaching, and the AshleyIQ
-- handoff.
-- ============================================================================

-- ── Coach role ────────────────────────────────────────────────────────────
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check CHECK (role IN ('admin', 'coach'));

-- ── Tier + journey stage on the client record ───────────────────────────────
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS plan_tier text NOT NULL DEFAULT 'credit_coaching'
  CHECK (plan_tier IN ('credit_coaching', 'wealth_coaching', 'investor_path'));
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS journey_stage text NOT NULL DEFAULT 'credit_coaching'
  CHECK (journey_stage IN ('credit_coaching', 'credit_stacking', 'loan_ready', 'handed_off', 'paused', 'exited'));
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS journey_stage_updated_at timestamptz NOT NULL DEFAULT now();

-- Audit trail of every stage move — who, when, why. Never overwritten.
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

-- ============================================================================
-- CREDIT STACKING (Stage 2)
-- ============================================================================
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
  planned_sequence      jsonb NOT NULL DEFAULT '[]', -- [{lender, order, target_limit, notes}]
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

-- ============================================================================
-- WEALTH / FINANCIAL COACHING (Tier 2)
-- ============================================================================
CREATE TABLE IF NOT EXISTS financial_goals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  title             text NOT NULL, -- e.g. "$40K down payment"
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
  projection_snapshot jsonb, -- computed per-debt payoff order + payoff dates at generation time
  generated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE debt_payoff_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dpp_org" ON debt_payoff_plans
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

CREATE TABLE IF NOT EXISTS budgets (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  month             date NOT NULL, -- first-of-month marker
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
  category          text NOT NULL, -- e.g. "housing", "transportation"
  planned_amount    numeric(10,2) NOT NULL DEFAULT 0,
  actual_amount     numeric(10,2) NOT NULL DEFAULT 0
);
ALTER TABLE budget_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "budget_cat_org" ON budget_categories
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

-- ============================================================================
-- LOAN-READY CHECKLIST (Stage 3 gate)
-- ============================================================================
CREATE TABLE IF NOT EXISTS loan_ready_checklist_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  label             text NOT NULL, -- e.g. "Score >= 680 on all 3 bureaus"
  is_required        boolean NOT NULL DEFAULT true,
  completed_at        timestamptz,
  verified_by         uuid REFERENCES profiles(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lrci_borrower ON loan_ready_checklist_items(borrower_id);
ALTER TABLE loan_ready_checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lrci_org" ON loan_ready_checklist_items
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

-- ============================================================================
-- ASHLEYIQ HANDOFF (Stage 4)
-- ============================================================================
CREATE TABLE IF NOT EXISTS handoff_packages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id           uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  snapshot              jsonb NOT NULL, -- credit trajectory, stacked capital, checklist, entity info at handoff time
  sent_to_conduit_at    timestamptz,
  conduit_lead_id       text, -- the id conduit-next returns for the created/updated lead
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

-- ============================================================================
-- COACH OPS
-- ============================================================================
CREATE TABLE IF NOT EXISTS coach_tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id       uuid REFERENCES borrowers(id) ON DELETE CASCADE,
  assigned_to       uuid REFERENCES profiles(id) ON DELETE SET NULL,
  source            text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'system')),
  type              text, -- e.g. 'promo_apr_expiring', 'dispute_response_overdue', 'checklist_pending'
  title             text NOT NULL,
  due_date          date,
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coach_tasks_open ON coach_tasks(org_id, assigned_to) WHERE completed_at IS NULL;
ALTER TABLE coach_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach_tasks_org" ON coach_tasks
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

-- ============================================================================
-- COMPLIANCE: state registration/bonding placeholder
-- ============================================================================
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

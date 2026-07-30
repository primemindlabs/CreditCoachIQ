-- ============================================================================
-- 0019_production_goals.sql
--
-- Coach/org-level production goals — distinct from financial_goals (which
-- are per-CLIENT savings/debt targets set by a coach for a borrower).
-- profile_id NULL = an org-wide goal; set = a specific coach's target.
-- ============================================================================

CREATE TABLE IF NOT EXISTS production_goals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id    uuid REFERENCES profiles(id) ON DELETE CASCADE, -- null = org-wide
  metric        text NOT NULL CHECK (metric IN ('clients_funded', 'new_enrollments')),
  period        text NOT NULL CHECK (period IN ('monthly', 'quarterly', 'annual')),
  period_start  date NOT NULL, -- first day of the period this target applies to
  target_value  numeric(12,2) NOT NULL CHECK (target_value > 0),
  created_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_production_goals_org ON production_goals(org_id, period_start DESC);
ALTER TABLE production_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "production_goals_org" ON production_goals
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

DROP TRIGGER IF EXISTS trg_production_goals_updated_at ON production_goals;
CREATE TRIGGER trg_production_goals_updated_at BEFORE UPDATE ON production_goals
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

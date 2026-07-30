-- ============================================================================
-- 0018_document_vault_branding_saved_views.sql
--
-- Three independent pieces from the 2026-07-29 Trulli-teardown build pass:
--   1. borrower_documents — general-purpose document storage per client
--      (client-level when enrollment_id is null, deal-level otherwise),
--      distinct from the single-purpose credit_report_uploads pipeline.
--   2. org_branding columns on credit_repair_org_settings (already the
--      org-level settings singleton — reused rather than a new table) so
--      logo/color/from-name can drive the portal, dispute-letter PDFs, and
--      campaign emails from one place.
--   3. saved_views — user-defined filter presets on the unified Clients
--      list, one row per coach per saved combination.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Document vault
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('borrower-documents', 'borrower-documents', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS borrower_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  borrower_id   uuid NOT NULL REFERENCES borrowers(id) ON DELETE CASCADE,
  enrollment_id uuid REFERENCES credit_repair_enrollments(id) ON DELETE SET NULL, -- null = client-level
  doc_type      text NOT NULL CHECK (doc_type IN (
                  'government_id', 'proof_of_income', 'bank_statement', 'croa_disclosure',
                  'dispute_correspondence', 'credit_report', 'business_formation', 'ein_letter',
                  'voided_check', 'other'
                )),
  storage_path  text NOT NULL,
  file_name     text NOT NULL,
  mime_type     text,
  size_bytes    bigint,
  uploaded_by   uuid REFERENCES profiles(id),
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_borrower_documents_borrower ON borrower_documents(org_id, borrower_id) WHERE deleted_at IS NULL;
ALTER TABLE borrower_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "borrower_documents_org" ON borrower_documents
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

-- ---------------------------------------------------------------------------
-- 2. Branding — one place, applied to portal/PDFs/emails
-- ---------------------------------------------------------------------------
ALTER TABLE credit_repair_org_settings ADD COLUMN IF NOT EXISTS brand_logo_url text;
ALTER TABLE credit_repair_org_settings ADD COLUMN IF NOT EXISTS brand_primary_color text; -- hex, e.g. '#0F9D58'
ALTER TABLE credit_repair_org_settings ADD COLUMN IF NOT EXISTS brand_from_name text;

-- ---------------------------------------------------------------------------
-- 3. Saved views on the Clients pipeline
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_views (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        text NOT NULL,
  segment     text NOT NULL, -- 'leads' | 'active' | 'funded' | 'denied'
  filters     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, name)
);
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
CREATE POLICY "saved_views_org" ON saved_views
  FOR ALL USING (org_id = public.get_org_id()) WITH CHECK (org_id = public.get_org_id());

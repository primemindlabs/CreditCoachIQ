-- ============================================================================
-- 0020_embed_lead_capture.sql
--
-- Public, brandable lead-capture form — creditcoachiq.com/apply/{slug} —
-- writing directly into borrowers with lead_source='embed'. Reuses
-- credit_repair_org_settings (already the org-settings singleton, already
-- carries brand_* columns from migration 0018) rather than a new table.
-- ============================================================================

ALTER TABLE credit_repair_org_settings ADD COLUMN IF NOT EXISTS embed_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE credit_repair_org_settings ADD COLUMN IF NOT EXISTS embed_slug text UNIQUE;
ALTER TABLE credit_repair_org_settings ADD COLUMN IF NOT EXISTS embed_headline text;

-- borrowers.lead_source already exists (0013) — the embed form sets
-- lead_source='embed'. borrowers.external_source (0001) is part of a
-- compound unique key for idempotent external-system imports (Zapier,
-- ad platforms, etc.) and isn't the right place for a free-text referring
-- URL, so a dedicated column carries that instead.
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS lead_referrer text;

-- ============================================================================
-- Adds storage for the CROA disclosure e-signature record captured via the
-- shared @primemind/sdk signing module (primemindlabs-core/typescript/src/signing).
-- The signature record itself (typed/drawn signature, consent text hash,
-- timestamp, IP) is built and hashed by the SDK; this table just persists it,
-- since the SDK module deliberately does not own storage.
-- ============================================================================

ALTER TABLE credit_repair_enrollments ADD COLUMN IF NOT EXISTS croa_signature_record jsonb;

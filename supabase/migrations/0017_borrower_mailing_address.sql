-- ============================================================================
-- 0017_borrower_mailing_address.sql
--
-- credit_disputes.borrower_address (migration 0003) is a required field for
-- every dispute letter — but borrowers never had a persisted mailing address
-- anywhere, so nothing could ever populate it without a coach retyping a
-- full street address by hand on every single generate call. This is what
-- actually made "generate dispute letters" (app/api/disputes/generate)
-- unreachable from any UI — there was nothing to pass for borrowerAddress.
-- Adding it as real persisted fields on the client profile, editable once,
-- reused every time going forward.
-- ============================================================================
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS address_line1 text;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS address_line2 text;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS postal_code text;

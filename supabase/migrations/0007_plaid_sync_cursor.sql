-- ============================================================================
-- Adds the cursor Plaid's /transactions/sync endpoint requires for
-- incremental, non-duplicating syncs. Without it, lib/plaid.ts's
-- syncTransactions() would have no way to resume from the last sync point.
-- ============================================================================

ALTER TABLE plaid_linked_accounts ADD COLUMN IF NOT EXISTS sync_cursor text;

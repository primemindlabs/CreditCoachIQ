-- Persistent freeform coach notes on a client/lead — distinct from
-- per-call notes (call_logs.notes) and the structured lead_activity_log
-- entries. This is the "scratchpad" a coach reaches for first when opening
-- someone's file: general context that doesn't belong to any one call or
-- status change.
ALTER TABLE borrowers ADD COLUMN IF NOT EXISTS coach_notes text;

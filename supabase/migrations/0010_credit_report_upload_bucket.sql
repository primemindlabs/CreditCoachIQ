-- ============================================================================
-- Private Storage bucket for coach-uploaded credit report PDFs, parsed via
-- Claude's native PDF document support (lib/creditReport/parse.ts).
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('credit-report-uploads', 'credit-report-uploads', false)
ON CONFLICT (id) DO NOTHING;

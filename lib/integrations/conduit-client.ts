/**
 * Bridge to AshleyIQ (conduit-next) — the funding/loan-origination product
 * this client eventually graduates into. Two uses:
 *
 *  1. fetchExternalLead() — optional, best-effort refresh of a borrower's
 *     contact info if they were originally referred in from conduit-next.
 *     Inert (no-op) unless CONDUIT_API_BASE_URL/CONDUIT_API_KEY are set.
 *
 *  2. sendHandoffPackage() — the Stage 4 handoff. This is the one that
 *     matters: when a coach marks a client loan_ready and triggers the
 *     handoff, this pushes their credit trajectory + stacked capital +
 *     entity info to conduit-next's
 *     POST /api/integrations/credit-coach-handoff endpoint, which creates a
 *     pre-qualified lead (and investor_entities record, if applicable)
 *     instead of starting that borrower's file from zero.
 */
import 'server-only';

export interface ExternalLeadInfo {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
}

export interface HandoffPayload {
  borrower: { firstName: string; lastName: string; email?: string | null; phone?: string | null };
  creditTrajectory: { startingScore?: number | null; currentScore?: number | null; targetScore?: number | null };
  stackedCapital: { totalAvailable: number; activeApplicationCount: number };
  businessEntity?: { name: string; entityType?: string | null; einLast4?: string | null } | null;
  checklist: { label: string; completedAt: string | null }[];
  planTier: string;
}

export interface HandoffResult {
  ok: boolean;
  conduitLeadId?: string;
  conduitEntityId?: string;
  error?: string;
}

function isConfigured(): boolean {
  return Boolean(process.env.CONDUIT_API_BASE_URL && process.env.CONDUIT_API_KEY);
}

export async function fetchExternalLead(externalLeadId: string): Promise<ExternalLeadInfo | null> {
  if (!isConfigured()) return null;
  try {
    const res = await fetch(
      `${process.env.CONDUIT_API_BASE_URL}/api/integrations/leads/${encodeURIComponent(externalLeadId)}`,
      { headers: { Authorization: `Bearer ${process.env.CONDUIT_API_KEY}` }, cache: 'no-store' }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { lead?: ExternalLeadInfo };
    return data.lead ?? null;
  } catch (err) {
    console.error('[conduit-client] fetchExternalLead failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Push a loan-ready client's handoff package to conduit-next. Throws only on
 * misconfiguration — network/API failures are returned as { ok: false } so
 * the caller can record the failure on the handoff_packages row rather than
 * losing the attempt.
 */
export async function sendHandoffPackage(payload: HandoffPayload): Promise<HandoffResult> {
  if (!isConfigured()) {
    return { ok: false, error: 'CONDUIT_API_BASE_URL/CONDUIT_API_KEY not configured' };
  }
  try {
    const res = await fetch(`${process.env.CONDUIT_API_BASE_URL}/api/integrations/credit-coach-handoff`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.CONDUIT_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as { leadId?: string; entityId?: string; error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? `conduit-next returned ${res.status}` };
    return { ok: true, conduitLeadId: data.leadId, conduitEntityId: data.entityId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

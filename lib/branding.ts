import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { FROM } from '@/lib/resend';

/**
 * Org-level branding — one settings record (credit_repair_org_settings,
 * extended in migration 0018) referenced by every client-facing surface:
 * the borrower portal shell, dispute-letter PDFs, and outbound emails.
 * If EquityNest ever white-labels this for other coaching orgs, this is the
 * single place that changes.
 */
export interface OrgBranding {
  logoUrl: string | null;
  primaryColor: string | null;
  fromName: string | null;
}

const DEFAULT_BRANDING: OrgBranding = { logoUrl: null, primaryColor: null, fromName: null };

export async function getOrgBranding(orgId: string): Promise<OrgBranding> {
  const sb = createAdminClient();
  const { data } = await sb
    .from('credit_repair_org_settings')
    .select('brand_logo_url, brand_primary_color, brand_from_name')
    .eq('org_id', orgId)
    .maybeSingle();
  if (!data) return DEFAULT_BRANDING;
  return {
    logoUrl: (data.brand_logo_url as string | null) ?? null,
    primaryColor: (data.brand_primary_color as string | null) ?? null,
    fromName: (data.brand_from_name as string | null) ?? null,
  };
}

// Every outbound email (portal MFA codes, campaign sends, quiz invites)
// should read from this rather than the raw FROM constant, so a branded
// from-name shows up in the client's inbox without touching each call site's
// send logic.
export async function buildFromHeader(orgId: string): Promise<string> {
  const { fromName } = await getOrgBranding(orgId);
  return fromName ? `${fromName} <${FROM}>` : FROM;
}

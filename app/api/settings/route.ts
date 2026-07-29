import { NextRequest, NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Unchanged in shape from conduit-next's app/api/credit-repair/settings/route.ts —
// org resolution now goes through getOrgContext() (CreditCoachIQ's own tenants)
// instead of a raw Clerk `orgId` -> `organizations` lookup inline.
export const GET = withErrorHandling(async function GET(): Promise<NextResponse> {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const { data } = await sb.from('credit_repair_org_settings').select('*').eq('org_id', orgId).maybeSingle();
  return NextResponse.json({ settings: data ?? null });
});

export const POST = withErrorHandling(async function POST(req: NextRequest): Promise<NextResponse> {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json()) as Record<string, unknown>;
  const allowed = ['notify_on_item_removed', 'notify_on_dispute_sent', 'notify_on_bureau_response', 'notify_sms_default', 'lo_email_override'];
  const patch: Record<string, unknown> = { org_id: orgId };
  for (const k of allowed) if (k in body) patch[k] = body[k];

  const sb = createAdminClient();
  const { error } = await sb.from('credit_repair_org_settings').upsert(patch, { onConflict: 'org_id' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
});

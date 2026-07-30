import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';
import { enrollBorrowerInCampaign } from '@/lib/messaging/enroll';

export const dynamic = 'force-dynamic';

// Manual enrollment. Every other path into campaign_enrollments is automatic
// (fireTrigger on a system event, see lib/messaging/enroll.ts), so this is
// the one route a coach hits directly, one client or a whole selected group
// at once, from the campaign page or the Clients list.
export const GET = withErrorHandling(async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();

  const { data: campaign } = await sb.from('campaigns').select('id').eq('id', params.id).eq('org_id', orgId).maybeSingle();
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data, error } = await sb
    .from('campaign_enrollments')
    .select('id, status, current_step_order, enrolled_at, completed_at, borrowers(id, first_name, last_name)')
    .eq('campaign_id', params.id)
    .eq('org_id', orgId)
    .order('enrolled_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ enrollments: data ?? [] });
});

export const POST = withErrorHandling(async function POST(req: Request, { params }: { params: { id: string } }) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const sb = createAdminClient();

  const { data: campaign } = await sb.from('campaigns').select('id').eq('id', params.id).eq('org_id', orgId).maybeSingle();
  if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { borrowerIds?: string[] };
  const borrowerIds = Array.isArray(body.borrowerIds) ? body.borrowerIds.filter((id) => typeof id === 'string' && id) : [];
  if (borrowerIds.length === 0) return NextResponse.json({ error: 'borrowerIds is required' }, { status: 400 });

  // Confirm every id actually belongs to this org before enrolling, so a
  // stray or spoofed id can't create an enrollment row for someone else's client.
  const { data: owned } = await sb.from('borrowers').select('id').eq('org_id', orgId).in('id', borrowerIds);
  const ownedIds = new Set((owned ?? []).map((b) => b.id));

  let enrolled = 0;
  for (const id of borrowerIds) {
    if (!ownedIds.has(id)) continue;
    await enrollBorrowerInCampaign(orgId, params.id, id);
    enrolled += 1;
  }

  return NextResponse.json({ ok: true, enrolled, skipped: borrowerIds.length - enrolled });
});

import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

// Records a commission event — accrued, paid, or a manual adjustment.
// Append-only by design (see migration 0011): this only inserts, it never
// edits or removes a prior event. A correction is a new offsetting event.
export const POST = withErrorHandling(async function POST(req: Request, { params }: { params: { id: string } }) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    eventType?: 'commission_accrued' | 'commission_paid' | 'commission_adjusted';
    amount?: number;
    borrowerId?: string;
    notes?: string;
  };
  if (!body.eventType || body.amount == null) return NextResponse.json({ error: 'eventType and amount are required' }, { status: 400 });

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).eq('org_id', orgId).maybeSingle();

  const { data: partner } = await sb.from('referral_partners').select('id').eq('id', params.id).eq('org_id', orgId).maybeSingle();
  if (!partner) return NextResponse.json({ error: 'Partner not found' }, { status: 404 });

  const { data, error } = await sb
    .from('referral_commission_events')
    .insert({
      org_id: orgId,
      referral_partner_id: params.id,
      borrower_id: body.borrowerId ?? null,
      event_type: body.eventType,
      amount: body.amount,
      notes: body.notes ?? null,
      created_by: profile?.id ?? null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ event: data });
});

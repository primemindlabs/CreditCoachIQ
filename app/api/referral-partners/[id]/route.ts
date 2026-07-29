import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

export const GET = withErrorHandling(async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const [{ data: partner }, { data: clients }, { data: events }] = await Promise.all([
    sb.from('referral_partners').select('*').eq('id', params.id).eq('org_id', orgId).maybeSingle(),
    sb.from('borrowers').select('id, first_name, last_name, journey_stage, created_at').eq('org_id', orgId).eq('referred_by_partner_id', params.id).order('created_at', { ascending: false }),
    sb.from('referral_commission_events').select('id, event_type, amount, notes, created_at').eq('org_id', orgId).eq('referral_partner_id', params.id).order('created_at', { ascending: false }),
  ]);
  if (!partner) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  return NextResponse.json({ partner, clients: clients ?? [], events: events ?? [] });
});

export const PATCH = withErrorHandling(async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (typeof body.partnerType === 'string') patch.partner_type = body.partnerType;
  if (typeof body.contactEmail === 'string') patch.contact_email = body.contactEmail;
  if (typeof body.contactPhone === 'string') patch.contact_phone = body.contactPhone;
  if (typeof body.commissionType === 'string') patch.commission_type = body.commissionType;
  if (typeof body.commissionValue === 'number') patch.commission_value = body.commissionValue;
  if (typeof body.status === 'string') patch.status = body.status;
  if (typeof body.notes === 'string') patch.notes = body.notes;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });

  const sb = createAdminClient();
  const { data, error } = await sb.from('referral_partners').update(patch).eq('id', params.id).eq('org_id', orgId).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ partner: data });
});

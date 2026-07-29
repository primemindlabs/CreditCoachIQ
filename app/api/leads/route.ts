import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { hasPermission } from '@/lib/auth/permissions';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// Pre-enrollment leads list. A lead is a borrowers row with
// lead_status != 'converted' — see migration 0013 for why this isn't a
// separate table.
export async function GET(req: Request) {
  const { userId, orgId } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');

  const sb = createAdminClient();
  let query = sb
    .from('borrowers')
    .select('id, first_name, last_name, email, phone, lead_status, interest_level, lead_source, last_contacted_at, assigned_agent_id, referred_by_partner_id, created_at')
    .eq('org_id', orgId)
    .neq('lead_status', 'converted')
    .order('created_at', { ascending: false });
  if (status) query = query.eq('lead_status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ leads: data ?? [] });
}

// Manual lead creation — a coach entering a prospect who called in, was
// referred, or came from anywhere other than the (not-yet-built) public
// web-form intake. Deliberately does NOT create a Stripe customer or
// enrollment — that only happens on /api/leads/[id]/convert.
export async function POST(req: Request) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(role, 'manage_intake')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as {
    firstName?: string; lastName?: string; email?: string; phone?: string;
    leadSource?: string; interestLevel?: string; referralCode?: string;
  };
  if (!body.firstName || !body.lastName) {
    return NextResponse.json({ error: 'firstName and lastName are required' }, { status: 400 });
  }

  const sb = createAdminClient();
  const { data: profile } = await sb.from('profiles').select('id').eq('clerk_user_id', userId).maybeSingle();

  let referralPartnerId: string | null = null;
  if (body.referralCode) {
    const { data: partner } = await sb
      .from('referral_partners')
      .select('id')
      .eq('org_id', orgId)
      .eq('referral_code', body.referralCode.trim())
      .eq('is_active', true)
      .maybeSingle();
    referralPartnerId = (partner?.id as string) ?? null;
  }

  const { data: lead, error } = await sb
    .from('borrowers')
    .insert({
      org_id: orgId,
      first_name: body.firstName,
      last_name: body.lastName,
      email: body.email ?? null,
      phone: body.phone ?? null,
      lead_status: 'new',
      lead_source: body.leadSource ?? 'manual',
      interest_level: body.interestLevel ?? null,
      assigned_agent_id: profile?.id ?? null,
      referred_by_partner_id: referralPartnerId,
      external_source: 'manual',
    })
    .select('id')
    .single();
  if (error || !lead) return NextResponse.json({ error: error?.message ?? 'Could not create lead' }, { status: 500 });

  await sb.from('lead_activity_log').insert({
    org_id: orgId, borrower_id: lead.id, actor_id: profile?.id ?? null,
    type: 'status_change', body: 'Lead created',
  });

  return NextResponse.json({ ok: true, id: lead.id });
}

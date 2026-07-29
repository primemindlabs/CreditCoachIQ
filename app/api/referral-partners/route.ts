import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { createAdminClient } from '@/lib/supabase/admin';
import crypto from 'crypto';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';

function generateReferralCode(name: string): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 20);
  const suffix = crypto.randomBytes(2).toString('hex');
  return `${slug || 'partner'}-${suffix}`;
}

// List partners with a rollup of attributed clients + commission totals —
// the summary an owner would actually want, not just the raw partner rows.
export const GET = withErrorHandling(async function GET() {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sb = createAdminClient();
  const [{ data: partners, error }, { data: attributions }, { data: events }] = await Promise.all([
    sb.from('referral_partners').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
    sb.from('borrowers').select('referred_by_partner_id').eq('org_id', orgId).not('referred_by_partner_id', 'is', null),
    sb.from('referral_commission_events').select('referral_partner_id, event_type, amount').eq('org_id', orgId),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const clientCounts = new Map<string, number>();
  for (const a of attributions ?? []) {
    const id = a.referred_by_partner_id as string;
    clientCounts.set(id, (clientCounts.get(id) ?? 0) + 1);
  }

  const accrued = new Map<string, number>();
  const paid = new Map<string, number>();
  for (const e of events ?? []) {
    const id = e.referral_partner_id as string;
    const amt = Number(e.amount) || 0;
    if (e.event_type === 'commission_accrued' || e.event_type === 'commission_adjusted') accrued.set(id, (accrued.get(id) ?? 0) + amt);
    if (e.event_type === 'commission_paid') paid.set(id, (paid.get(id) ?? 0) + amt);
  }

  const withStats = (partners ?? []).map((p) => ({
    ...p,
    clientsReferred: clientCounts.get(p.id as string) ?? 0,
    commissionAccrued: accrued.get(p.id as string) ?? 0,
    commissionPaid: paid.get(p.id as string) ?? 0,
    commissionOutstanding: (accrued.get(p.id as string) ?? 0) - (paid.get(p.id as string) ?? 0),
  }));

  return NextResponse.json({ partners: withStats });
});

export const POST = withErrorHandling(async function POST(req: Request) {
  const { orgId } = await getOrgContext();
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    partnerType?: 'individual' | 'business' | 'affiliate';
    contactEmail?: string;
    contactPhone?: string;
    referralCode?: string;
    commissionType?: 'none' | 'flat_per_enrollment' | 'percent_of_first_payment';
    commissionValue?: number;
    notes?: string;
  };
  if (!body.name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const sb = createAdminClient();
  const code = body.referralCode?.trim() || generateReferralCode(body.name);

  const { data, error } = await sb
    .from('referral_partners')
    .insert({
      org_id: orgId,
      name: body.name,
      partner_type: body.partnerType ?? 'individual',
      contact_email: body.contactEmail ?? null,
      contact_phone: body.contactPhone ?? null,
      referral_code: code,
      commission_type: body.commissionType ?? 'none',
      commission_value: body.commissionValue ?? 0,
      notes: body.notes ?? null,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ partner: data });
});

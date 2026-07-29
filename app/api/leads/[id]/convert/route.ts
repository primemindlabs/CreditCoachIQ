import { NextResponse } from 'next/server';
import { getOrgContext } from '@/lib/auth/orgContext';
import { hasPermission } from '@/lib/auth/permissions';
import { createAdminClient } from '@/lib/supabase/admin';
import getStripe from '@/lib/stripe';
import { fireTrigger } from '@/lib/messaging/triggers';
import { withErrorHandling } from '@/lib/api/withErrorHandling';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Convert an existing lead (borrowers row, lead_status != 'converted') into
 * an enrolled client. Same enrollment side effects as /api/enroll (Stripe
 * customer, trial subscription, CROA state gate) but for a borrower that
 * already exists — no upsert-by-external-id needed since there's only one
 * identity record involved.
 */
export const POST = withErrorHandling(async function POST(req: Request, { params }: { params: { id: string } }) {
  const { userId, orgId, role } = await getOrgContext();
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!hasPermission(role, 'manage_intake')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { targetScore?: number; state?: string };

  const sb = createAdminClient();
  const { data: borrower } = await sb
    .from('borrowers')
    .select('id, first_name, last_name, email, state, lead_status')
    .eq('id', params.id).eq('org_id', orgId).maybeSingle();
  if (!borrower) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (borrower.lead_status === 'converted') return NextResponse.json({ error: 'Already converted' }, { status: 400 });

  const state = (body.state ?? (borrower.state as string | null))?.toUpperCase();

  // Same CROA state-registration gate as /api/enroll — fail closed.
  if (state) {
    const { data: compliance } = await sb.from('state_compliance_status').select('active_clients_allowed').eq('org_id', orgId).eq('state', state).maybeSingle();
    if (!compliance?.active_clients_allowed) {
      return NextResponse.json({ error: `Not yet registered to serve clients in ${state}. Update state_compliance_status before converting this lead.` }, { status: 403 });
    }
  }

  const { data: existingEnrollment } = await sb
    .from('credit_repair_enrollments')
    .select('id')
    .eq('borrower_id', borrower.id).eq('org_id', orgId).maybeSingle();
  if (existingEnrollment) {
    await sb.from('borrowers').update({ lead_status: 'converted' }).eq('id', borrower.id);
    return NextResponse.json({ enrollmentId: existingEnrollment.id, borrowerId: borrower.id, alreadyEnrolled: true });
  }

  let stripeCustomerId: string | null = null;
  try {
    const customer = await getStripe().customers.create({
      email: (borrower.email as string) ?? undefined,
      name: `${borrower.first_name ?? ''} ${borrower.last_name ?? ''}`.trim() || undefined,
      metadata: { borrower_id: borrower.id as string, org_id: orgId },
    });
    stripeCustomerId = customer.id;
  } catch (err) {
    console.error('[leads/convert] Stripe customer create failed:', err instanceof Error ? err.message : err);
  }

  const { data: enrollment, error } = await sb
    .from('credit_repair_enrollments')
    .insert({
      org_id: orgId,
      borrower_id: borrower.id,
      target_score: body.targetScore ?? 640,
      stripe_customer_id: stripeCustomerId,
      subscription_status: 'trial',
      trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'pending_upload',
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sb.from('borrowers').update({ lead_status: 'converted', state: state ?? null }).eq('id', borrower.id);
  await sb.from('credit_repair_org_settings').upsert({ org_id: orgId }, { onConflict: 'org_id', ignoreDuplicates: true });
  await sb.from('lead_activity_log').insert({
    org_id: orgId, borrower_id: borrower.id, type: 'status_change', body: 'Converted to enrolled client',
  });

  void fireTrigger(orgId, 'client_enrolled', { borrowerId: borrower.id as string });

  return NextResponse.json({ enrollmentId: enrollment.id, borrowerId: borrower.id });
});
